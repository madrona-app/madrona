"""
Database catalog discovery.

Provides schema/table/collection discovery for database sources.
Returns catalog items with stable object IDs for UI browsing.

Object ID Format:
    Base64-encoded string of: {sourceId}:{vendor}:{database}:{schema}:{objectName}
    This ensures stable, deterministic IDs across discovery runs.

Vendor-specific behavior:
- PostgreSQL: schemas + tables/views (excludes pg_* system schemas)
- MySQL: databases + tables/views (excludes system DBs)
- SQL Server: schemas + tables/views (excludes system schemas)
- Oracle: accessible schemas + tables/views (respects permissions)
- MongoDB: databases + collections

Redis caching:
- Catalog results are cached for 5 minutes by default
- Cache key includes config hash to auto-invalidate on config changes
"""

import base64
import hashlib
import json
import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from app.connectors.db.errors import DbError, DbErrorCode, normalize_db_error
from app.connectors.db.secrets import SecretResolutionError, resolve_password
from app.schemas.database_source import DEFAULT_PORTS
from app.services.redis_client import get_redis_client

logger = logging.getLogger(__name__)

# Default cache TTL for catalog results (5 minutes)
CATALOG_CACHE_TTL_SECONDS = 300


class CatalogItemKind(str, Enum):
    """Types of catalog items."""

    DATABASE = "database"
    SCHEMA = "schema"
    TABLE = "table"
    VIEW = "view"
    COLLECTION = "collection"


@dataclass
class CatalogItem:
    """A single catalog item (database, schema, table, view, or collection)."""

    kind: CatalogItemKind
    name: str
    path: list[str]
    object_id: str
    meta: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Convert to API response format."""
        result = {
            "kind": self.kind.value,
            "name": self.name,
            "path": self.path,
            "objectId": self.object_id,
        }
        if self.meta:
            result["meta"] = self.meta
        return result


@dataclass
class CatalogResult:
    """Result of catalog discovery."""

    source_id: str
    vendor: str
    items: list[CatalogItem] = field(default_factory=list)
    error: DbError | None = None
    discovered_at: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        """Convert to API response format."""
        result: dict[str, Any] = {
            "sourceId": self.source_id,
            "vendor": self.vendor,
            "items": [item.to_dict() for item in self.items],
        }
        if self.error:
            result["error"] = self.error.to_dict()
        return result


def generate_object_id(
    source_id: str,
    vendor: str,
    database: str | None = None,
    schema: str | None = None,
    object_name: str | None = None,
) -> str:
    """
    Generate a stable, deterministic object ID.

    The object ID encodes the full path to the object in a way that is:
    - Stable across discovery runs
    - URL-safe (base64 encoded)
    - Deterministic (same inputs always produce same output)

    Args:
        source_id: The connector instance ID
        vendor: Database vendor (postgres, mysql, etc.)
        database: Database name (if applicable)
        schema: Schema name (if applicable)
        object_name: Object name (table, view, collection)

    Returns:
        Base64-encoded object ID string
    """
    # Build path components, using empty string for None
    components = [
        source_id,
        vendor,
        database or "",
        schema or "",
        object_name or "",
    ]

    # Join with colon separator
    path_string = ":".join(components)

    # Create a short hash for compactness while maintaining uniqueness
    # Use SHA-256 truncated to 16 bytes (128 bits) for good collision resistance
    hash_bytes = hashlib.sha256(path_string.encode("utf-8")).digest()[:16]

    # Encode as URL-safe base64
    object_id = base64.urlsafe_b64encode(hash_bytes).decode("ascii").rstrip("=")

    return object_id


def parse_object_id(object_id: str) -> dict[str, str | None]:
    """
    Parse an object ID back to its components.

    Note: Since we use a hash, we cannot reverse the object ID to get
    the original components. This function is for documentation purposes.
    In practice, the UI should store the path alongside the object ID.

    Returns:
        Empty dict (hash is not reversible)
    """
    # Hash is not reversible - return empty
    return {}


# PostgreSQL system schemas to exclude by default
POSTGRES_SYSTEM_SCHEMAS = {
    "pg_catalog",
    "pg_toast",
    "pg_temp_1",
    "pg_toast_temp_1",
    "information_schema",
}

# MySQL system databases to exclude by default
MYSQL_SYSTEM_DATABASES = {
    "information_schema",
    "mysql",
    "performance_schema",
    "sys",
}

# SQL Server system schemas to exclude by default
SQLSERVER_SYSTEM_SCHEMAS = {
    "sys",
    "INFORMATION_SCHEMA",
    "guest",
    "db_owner",
    "db_accessadmin",
    "db_securityadmin",
    "db_ddladmin",
    "db_backupoperator",
    "db_datareader",
    "db_datawriter",
    "db_denydatareader",
    "db_denydatawriter",
}

# Oracle system schemas to exclude by default
ORACLE_SYSTEM_SCHEMAS = {
    "SYS",
    "SYSTEM",
    "OUTLN",
    "DIP",
    "ORACLE_OCM",
    "DBSNMP",
    "APPQOSSYS",
    "WMSYS",
    "EXFSYS",
    "CTXSYS",
    "XDB",
    "ANONYMOUS",
    "ORDSYS",
    "ORDDATA",
    "ORDPLUGINS",
    "SI_INFORMTN_SCHEMA",
    "MDSYS",
    "OLAPSYS",
    "MDDATA",
    "SPATIAL_WFS_ADMIN_USR",
    "SPATIAL_CSW_ADMIN_USR",
    "APEX_PUBLIC_USER",
    "APEX_040200",
    "FLOWS_FILES",
}

# MongoDB system databases to exclude by default
MONGODB_SYSTEM_DATABASES = {
    "admin",
    "config",
    "local",
}


def discover_postgres_catalog(
    config: dict[str, Any],
    source_id: str,
    include_system: bool = False,
) -> CatalogResult:
    """
    Discover PostgreSQL catalog (schemas, tables, views).

    Uses information_schema for portable discovery.
    """
    try:
        import psycopg
    except ImportError:
        try:
            import psycopg2 as psycopg  # type: ignore
        except ImportError:
            return CatalogResult(
                source_id=source_id,
                vendor="postgres",
                error=DbError(
                    DbErrorCode.UNSUPPORTED_FEATURE,
                    "PostgreSQL driver not installed. Install psycopg or psycopg2.",
                    None,
                    False,
                ),
            )

    host = config.get("host")
    port = config.get("port", DEFAULT_PORTS["postgres"])
    database = config.get("database")
    username = config.get("username")
    driver_opts = config.get("driverOptions", {})

    try:
        password = resolve_password(config.get("auth", {}))
    except SecretResolutionError as e:
        return CatalogResult(
            source_id=source_id,
            vendor="postgres",
            error=DbError(DbErrorCode.AUTH_FAILED, str(e), None, False),
        )

    connect_timeout = driver_opts.get("connectTimeoutMs", 30000) / 1000

    conn_params: dict[str, Any] = {
        "host": host,
        "port": port,
        "dbname": database,
        "user": username,
        "connect_timeout": int(connect_timeout),
    }
    if password:
        conn_params["password"] = password

    items: list[CatalogItem] = []

    try:
        conn = psycopg.connect(**conn_params)
        try:
            cursor = conn.cursor()

            # Discover schemas
            cursor.execute("""
                SELECT schema_name,
                       obj_description(oid, 'pg_namespace') as comment
                FROM information_schema.schemata s
                LEFT JOIN pg_namespace n ON n.nspname = s.schema_name
                ORDER BY schema_name
            """)

            schemas = []
            for row in cursor.fetchall():
                schema_name = row[0]
                comment = row[1] if len(row) > 1 else None

                # Skip system schemas unless requested
                if not include_system and schema_name in POSTGRES_SYSTEM_SCHEMAS:
                    continue
                if not include_system and schema_name.startswith("pg_"):
                    continue

                schemas.append(schema_name)

                items.append(CatalogItem(
                    kind=CatalogItemKind.SCHEMA,
                    name=schema_name,
                    path=[database, schema_name],
                    object_id=generate_object_id(source_id, "postgres", database, schema_name),
                    meta={"comment": comment} if comment else {},
                ))

            # Discover tables and views for each schema
            for schema_name in schemas:
                cursor.execute("""
                    SELECT table_name, table_type,
                           obj_description((quote_ident(table_schema) || '.' || quote_ident(table_name))::regclass, 'pg_class') as comment
                    FROM information_schema.tables
                    WHERE table_schema = %s
                    ORDER BY table_name
                """, (schema_name,))

                for row in cursor.fetchall():
                    table_name = row[0]
                    table_type = row[1]
                    comment = row[2] if len(row) > 2 else None

                    kind = CatalogItemKind.VIEW if table_type == "VIEW" else CatalogItemKind.TABLE

                    items.append(CatalogItem(
                        kind=kind,
                        name=table_name,
                        path=[database, schema_name, table_name],
                        object_id=generate_object_id(source_id, "postgres", database, schema_name, table_name),
                        meta={"comment": comment} if comment else {},
                    ))

            return CatalogResult(source_id=source_id, vendor="postgres", items=items)

        finally:
            conn.close()

    except Exception as e:
        error = normalize_db_error(e, "postgres")
        return CatalogResult(source_id=source_id, vendor="postgres", error=error)


def discover_mysql_catalog(
    config: dict[str, Any],
    source_id: str,
    include_system: bool = False,
) -> CatalogResult:
    """
    Discover MySQL catalog (databases, tables, views).

    MySQL treats databases as the top-level container (like schemas in other DBs).
    """
    try:
        import pymysql
    except ImportError:
        return CatalogResult(
            source_id=source_id,
            vendor="mysql",
            error=DbError(
                DbErrorCode.UNSUPPORTED_FEATURE,
                "MySQL driver not installed. Install pymysql.",
                None,
                False,
            ),
        )

    host = config.get("host")
    port = config.get("port", DEFAULT_PORTS["mysql"])
    database = config.get("database")
    username = config.get("username")
    driver_opts = config.get("driverOptions", {})

    try:
        password = resolve_password(config.get("auth", {}))
    except SecretResolutionError as e:
        return CatalogResult(
            source_id=source_id,
            vendor="mysql",
            error=DbError(DbErrorCode.AUTH_FAILED, str(e), None, False),
        )

    connect_timeout = int(driver_opts.get("connectTimeoutMs", 30000) / 1000)

    conn_params: dict[str, Any] = {
        "host": host,
        "port": port,
        "user": username,
        "connect_timeout": connect_timeout,
    }
    if password:
        conn_params["password"] = password
    if database:
        conn_params["database"] = database

    items: list[CatalogItem] = []

    try:
        conn = pymysql.connect(**conn_params)
        try:
            cursor = conn.cursor()

            # If connected to specific database, only show that one
            if database:
                databases = [database]
            else:
                # Discover all accessible databases
                cursor.execute("SHOW DATABASES")
                databases = []
                for row in cursor.fetchall():
                    db_name = row[0]
                    if not include_system and db_name in MYSQL_SYSTEM_DATABASES:
                        continue
                    databases.append(db_name)

            # Add database items
            for db_name in databases:
                items.append(CatalogItem(
                    kind=CatalogItemKind.DATABASE,
                    name=db_name,
                    path=[db_name],
                    object_id=generate_object_id(source_id, "mysql", db_name),
                ))

            # Discover tables and views for each database
            for db_name in databases:
                try:
                    cursor.execute(f"USE `{db_name}`")
                    cursor.execute("""
                        SELECT TABLE_NAME, TABLE_TYPE, TABLE_COMMENT
                        FROM information_schema.TABLES
                        WHERE TABLE_SCHEMA = %s
                        ORDER BY TABLE_NAME
                    """, (db_name,))

                    for row in cursor.fetchall():
                        table_name = row[0]
                        table_type = row[1]
                        comment = row[2] if row[2] else None

                        kind = CatalogItemKind.VIEW if table_type == "VIEW" else CatalogItemKind.TABLE

                        items.append(CatalogItem(
                            kind=kind,
                            name=table_name,
                            path=[db_name, table_name],
                            object_id=generate_object_id(source_id, "mysql", db_name, None, table_name),
                            meta={"comment": comment} if comment else {},
                        ))
                except Exception as db_error:
                    # Log permission errors for individual databases but continue
                    logger.warning(f"Cannot access database {db_name}: {db_error}")

            return CatalogResult(source_id=source_id, vendor="mysql", items=items)

        finally:
            conn.close()

    except Exception as e:
        error = normalize_db_error(e, "mysql")
        return CatalogResult(source_id=source_id, vendor="mysql", error=error)


def discover_sqlserver_catalog(
    config: dict[str, Any],
    source_id: str,
    include_system: bool = False,
) -> CatalogResult:
    """
    Discover SQL Server catalog (schemas, tables, views).
    """
    # Try pyodbc first, then pymssql
    driver_name = None
    try:
        import pyodbc
        driver_name = "pyodbc"
    except ImportError:
        try:
            import pymssql
            driver_name = "pymssql"
        except ImportError:
            return CatalogResult(
                source_id=source_id,
                vendor="sqlserver",
                error=DbError(
                    DbErrorCode.UNSUPPORTED_FEATURE,
                    "SQL Server driver not installed. Install pyodbc or pymssql.",
                    None,
                    False,
                ),
            )

    host = config.get("host")
    port = config.get("port", DEFAULT_PORTS["sqlserver"])
    database = config.get("database")
    username = config.get("username")
    instance = config.get("instance")
    driver_opts = config.get("driverOptions", {})

    try:
        password = resolve_password(config.get("auth", {}))
    except SecretResolutionError as e:
        return CatalogResult(
            source_id=source_id,
            vendor="sqlserver",
            error=DbError(DbErrorCode.AUTH_FAILED, str(e), None, False),
        )

    connect_timeout = int(driver_opts.get("connectTimeoutMs", 30000) / 1000)

    items: list[CatalogItem] = []

    try:
        if driver_name == "pyodbc":
            server = f"{host},{port}" if not instance else f"{host}\\{instance},{port}"

            drivers = pyodbc.drivers()
            odbc_driver = None
            for d in ["ODBC Driver 18 for SQL Server", "ODBC Driver 17 for SQL Server", "SQL Server"]:
                if d in drivers:
                    odbc_driver = d
                    break

            if not odbc_driver:
                return CatalogResult(
                    source_id=source_id,
                    vendor="sqlserver",
                    error=DbError(
                        DbErrorCode.UNSUPPORTED_FEATURE,
                        f"No SQL Server ODBC driver found. Available: {drivers}",
                        None,
                        False,
                    ),
                )

            conn_str = f"DRIVER={{{odbc_driver}}};SERVER={server};DATABASE={database};UID={username}"
            if password:
                conn_str += f";PWD={password}"
            conn_str += ";Encrypt=yes;TrustServerCertificate=yes"

            conn = pyodbc.connect(conn_str, timeout=connect_timeout)

        else:  # pymssql
            server = f"{host}:{port}" if not instance else f"{host}\\{instance}:{port}"

            conn = pymssql.connect(
                server=server,
                user=username,
                password=password or "",
                database=database,
                timeout=connect_timeout,
                login_timeout=connect_timeout,
            )

        try:
            cursor = conn.cursor()

            # Discover schemas
            cursor.execute("""
                SELECT s.name AS schema_name,
                       ep.value AS comment
                FROM sys.schemas s
                LEFT JOIN sys.extended_properties ep
                    ON ep.major_id = s.schema_id
                    AND ep.minor_id = 0
                    AND ep.name = 'MS_Description'
                WHERE s.name NOT IN ('sys', 'INFORMATION_SCHEMA', 'guest')
                ORDER BY s.name
            """)

            schemas = []
            for row in cursor.fetchall():
                schema_name = row[0]
                comment = row[1] if len(row) > 1 else None

                if not include_system and schema_name in SQLSERVER_SYSTEM_SCHEMAS:
                    continue

                schemas.append(schema_name)

                items.append(CatalogItem(
                    kind=CatalogItemKind.SCHEMA,
                    name=schema_name,
                    path=[database, schema_name],
                    object_id=generate_object_id(source_id, "sqlserver", database, schema_name),
                    meta={"comment": comment} if comment else {},
                ))

            # Discover tables and views
            cursor.execute("""
                SELECT
                    t.TABLE_SCHEMA,
                    t.TABLE_NAME,
                    t.TABLE_TYPE,
                    ep.value AS comment
                FROM INFORMATION_SCHEMA.TABLES t
                LEFT JOIN sys.objects o
                    ON o.name = t.TABLE_NAME
                LEFT JOIN sys.schemas s
                    ON s.schema_id = o.schema_id AND s.name = t.TABLE_SCHEMA
                LEFT JOIN sys.extended_properties ep
                    ON ep.major_id = o.object_id
                    AND ep.minor_id = 0
                    AND ep.name = 'MS_Description'
                WHERE t.TABLE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA')
                ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME
            """)

            for row in cursor.fetchall():
                schema_name = row[0]
                table_name = row[1]
                table_type = row[2]
                comment = row[3] if len(row) > 3 else None

                if not include_system and schema_name in SQLSERVER_SYSTEM_SCHEMAS:
                    continue

                kind = CatalogItemKind.VIEW if table_type == "VIEW" else CatalogItemKind.TABLE

                items.append(CatalogItem(
                    kind=kind,
                    name=table_name,
                    path=[database, schema_name, table_name],
                    object_id=generate_object_id(source_id, "sqlserver", database, schema_name, table_name),
                    meta={"comment": comment} if comment else {},
                ))

            return CatalogResult(source_id=source_id, vendor="sqlserver", items=items)

        finally:
            conn.close()

    except Exception as e:
        error = normalize_db_error(e, "sqlserver")
        return CatalogResult(source_id=source_id, vendor="sqlserver", error=error)


def discover_oracle_catalog(
    config: dict[str, Any],
    source_id: str,
    include_system: bool = False,
) -> CatalogResult:
    """
    Discover Oracle catalog (schemas/owners, tables, views).

    Uses ALL_* views to respect user permissions.
    """
    try:
        import oracledb
    except ImportError:
        try:
            import cx_Oracle as oracledb  # type: ignore
        except ImportError:
            return CatalogResult(
                source_id=source_id,
                vendor="oracle",
                error=DbError(
                    DbErrorCode.UNSUPPORTED_FEATURE,
                    "Oracle driver not installed. Install oracledb or cx_Oracle.",
                    None,
                    False,
                ),
            )

    host = config.get("host")
    port = config.get("port", DEFAULT_PORTS["oracle"])
    username = config.get("username")
    service_name = config.get("serviceName")
    sid = config.get("sid")
    connect_string = config.get("connectString")
    driver_opts = config.get("driverOptions", {})

    try:
        password = resolve_password(config.get("auth", {}))
    except SecretResolutionError as e:
        return CatalogResult(
            source_id=source_id,
            vendor="oracle",
            error=DbError(DbErrorCode.AUTH_FAILED, str(e), None, False),
        )

    # Build DSN
    if connect_string:
        dsn = connect_string
        db_name = "oracle"  # Use generic name for connect string
    elif service_name:
        dsn = f"{host}:{port}/{service_name}"
        db_name = service_name
    elif sid:
        dsn = oracledb.makedsn(host, port, sid=sid)
        db_name = sid
    else:
        return CatalogResult(
            source_id=source_id,
            vendor="oracle",
            error=DbError(
                DbErrorCode.UNKNOWN,
                "Oracle configuration requires serviceName, sid, or connectString",
                None,
                False,
            ),
        )

    items: list[CatalogItem] = []

    try:
        conn = oracledb.connect(user=username, password=password or "", dsn=dsn)

        try:
            cursor = conn.cursor()

            # Discover schemas (owners) the user can access
            cursor.execute("""
                SELECT DISTINCT owner
                FROM all_tables
                UNION
                SELECT DISTINCT owner
                FROM all_views
                ORDER BY 1
            """)

            schemas = []
            for row in cursor.fetchall():
                schema_name = row[0]

                if not include_system and schema_name in ORACLE_SYSTEM_SCHEMAS:
                    continue

                schemas.append(schema_name)

                items.append(CatalogItem(
                    kind=CatalogItemKind.SCHEMA,
                    name=schema_name,
                    path=[db_name, schema_name],
                    object_id=generate_object_id(source_id, "oracle", db_name, schema_name),
                ))

            # Discover tables
            cursor.execute("""
                SELECT owner, table_name, comments
                FROM all_tab_comments
                WHERE table_type = 'TABLE'
                ORDER BY owner, table_name
            """)

            for row in cursor.fetchall():
                schema_name = row[0]
                table_name = row[1]
                comment = row[2] if len(row) > 2 else None

                if not include_system and schema_name in ORACLE_SYSTEM_SCHEMAS:
                    continue

                items.append(CatalogItem(
                    kind=CatalogItemKind.TABLE,
                    name=table_name,
                    path=[db_name, schema_name, table_name],
                    object_id=generate_object_id(source_id, "oracle", db_name, schema_name, table_name),
                    meta={"comment": comment} if comment else {},
                ))

            # Discover views
            cursor.execute("""
                SELECT owner, view_name, comments
                FROM all_tab_comments
                WHERE table_type = 'VIEW'
                ORDER BY owner, view_name
            """)

            for row in cursor.fetchall():
                schema_name = row[0]
                view_name = row[1]
                comment = row[2] if len(row) > 2 else None

                if not include_system and schema_name in ORACLE_SYSTEM_SCHEMAS:
                    continue

                items.append(CatalogItem(
                    kind=CatalogItemKind.VIEW,
                    name=view_name,
                    path=[db_name, schema_name, view_name],
                    object_id=generate_object_id(source_id, "oracle", db_name, schema_name, view_name),
                    meta={"comment": comment} if comment else {},
                ))

            return CatalogResult(source_id=source_id, vendor="oracle", items=items)

        finally:
            conn.close()

    except Exception as e:
        error = normalize_db_error(e, "oracle")
        return CatalogResult(source_id=source_id, vendor="oracle", error=error)


def discover_mongodb_catalog(
    config: dict[str, Any],
    source_id: str,
    include_system: bool = False,
) -> CatalogResult:
    """
    Discover MongoDB catalog (databases, collections).
    """
    try:
        from pymongo import MongoClient
        from pymongo.errors import PyMongoError
    except ImportError:
        return CatalogResult(
            source_id=source_id,
            vendor="mongodb",
            error=DbError(
                DbErrorCode.UNSUPPORTED_FEATURE,
                "MongoDB driver not installed. Install pymongo.",
                None,
                False,
            ),
        )

    connection_uri = config.get("connectionUri")
    host = config.get("host")
    port = config.get("port", DEFAULT_PORTS["mongodb"])
    database = config.get("database")
    username = config.get("username")
    auth_source = config.get("authSource", "admin")
    replica_set = config.get("replicaSet")
    driver_opts = config.get("driverOptions", {})

    try:
        password = resolve_password(config.get("auth", {}))
    except SecretResolutionError as e:
        return CatalogResult(
            source_id=source_id,
            vendor="mongodb",
            error=DbError(DbErrorCode.AUTH_FAILED, str(e), None, False),
        )

    connect_timeout_ms = driver_opts.get("connectTimeoutMs", 30000)
    server_selection_timeout_ms = connect_timeout_ms

    # Build connection parameters
    if connection_uri:
        client_params: dict[str, Any] = {
            "host": connection_uri,
            "serverSelectionTimeoutMS": server_selection_timeout_ms,
            "connectTimeoutMS": connect_timeout_ms,
        }
        if username and password and "authSource" not in connection_uri:
            client_params["username"] = username
            client_params["password"] = password
            client_params["authSource"] = auth_source
    else:
        client_params = {
            "host": host,
            "port": port,
            "serverSelectionTimeoutMS": server_selection_timeout_ms,
            "connectTimeoutMS": connect_timeout_ms,
        }
        if username:
            client_params["username"] = username
        if password:
            client_params["password"] = password
        if auth_source:
            client_params["authSource"] = auth_source
        if replica_set:
            client_params["replicaSet"] = replica_set

    items: list[CatalogItem] = []

    try:
        client = MongoClient(**client_params)

        try:
            # If connected to specific database, only show that one
            if database:
                databases = [database]
            else:
                # Discover all accessible databases
                databases = []
                for db_name in client.list_database_names():
                    if not include_system and db_name in MONGODB_SYSTEM_DATABASES:
                        continue
                    databases.append(db_name)

            # Add database items
            for db_name in databases:
                items.append(CatalogItem(
                    kind=CatalogItemKind.DATABASE,
                    name=db_name,
                    path=[db_name],
                    object_id=generate_object_id(source_id, "mongodb", db_name),
                ))

            # Discover collections for each database
            for db_name in databases:
                try:
                    db = client[db_name]
                    for coll_info in db.list_collections():
                        coll_name = coll_info["name"]

                        # Skip system collections unless requested
                        if not include_system and coll_name.startswith("system."):
                            continue

                        items.append(CatalogItem(
                            kind=CatalogItemKind.COLLECTION,
                            name=coll_name,
                            path=[db_name, coll_name],
                            object_id=generate_object_id(source_id, "mongodb", db_name, None, coll_name),
                        ))
                except PyMongoError as db_error:
                    # Log permission errors for individual databases but continue
                    logger.warning(f"Cannot access database {db_name}: {db_error}")

            return CatalogResult(source_id=source_id, vendor="mongodb", items=items)

        finally:
            client.close()

    except PyMongoError as e:
        error = normalize_db_error(e, "mongodb")
        return CatalogResult(source_id=source_id, vendor="mongodb", error=error)
    except Exception as e:
        error = normalize_db_error(e, "mongodb")
        return CatalogResult(source_id=source_id, vendor="mongodb", error=error)


# Catalog discovery dispatcher
CATALOG_DISCOVERERS = {
    "postgres": discover_postgres_catalog,
    "mysql": discover_mysql_catalog,
    "sqlserver": discover_sqlserver_catalog,
    "oracle": discover_oracle_catalog,
    "mongodb": discover_mongodb_catalog,
}


def _get_catalog_cache_key(source_id: str, config: dict[str, Any], include_system: bool) -> str:
    """
    Generate a cache key for catalog results.

    Includes a hash of the config to auto-invalidate when config changes.
    """
    # Hash config (excluding sensitive fields that don't affect schema)
    config_for_hash = {
        k: v for k, v in config.items()
        if k not in ("password", "secret_arn", "credentials")
    }
    config_hash = hashlib.md5(
        json.dumps(config_for_hash, sort_keys=True).encode()
    ).hexdigest()[:8]
    system_flag = "1" if include_system else "0"
    return f"madrona:catalog:{source_id}:{config_hash}:{system_flag}"


def _get_cached_catalog(cache_key: str) -> CatalogResult | None:
    """
    Get catalog result from Redis cache.

    Returns:
        CatalogResult if cached and valid, None otherwise
    """
    redis = get_redis_client()
    if not redis.is_available():
        return None

    try:
        cached = redis.client.get(cache_key)
        if not cached:
            return None

        data = json.loads(cached.decode())

        # Reconstruct CatalogResult from cached data
        items = [
            CatalogItem(
                kind=CatalogItemKind(item["kind"]),
                name=item["name"],
                path=item["path"],
                object_id=item["objectId"],
                meta=item.get("meta", {}),
            )
            for item in data.get("items", [])
        ]

        error = None
        if data.get("error"):
            err_data = data["error"]
            error = DbError(
                code=DbErrorCode(err_data["code"]),
                message=err_data["message"],
                details=err_data.get("details"),
                retryable=err_data.get("retryable", False),
            )

        return CatalogResult(
            source_id=data["sourceId"],
            vendor=data["vendor"],
            items=items,
            error=error,
            discovered_at=data.get("discovered_at", time.time()),
        )
    except Exception as e:
        logger.debug(f"Failed to get cached catalog: {e}")
        return None


def _cache_catalog_result(cache_key: str, result: CatalogResult, ttl: int = CATALOG_CACHE_TTL_SECONDS) -> None:
    """
    Cache catalog result in Redis.

    Only caches successful results (no error).
    """
    # Don't cache errors
    if result.error:
        return

    redis = get_redis_client()
    if not redis.is_available():
        return

    try:
        data = result.to_dict()
        data["discovered_at"] = result.discovered_at
        redis.client.setex(cache_key, ttl, json.dumps(data))
        logger.debug(f"Cached catalog result for {result.source_id}")
    except Exception as e:
        logger.debug(f"Failed to cache catalog result: {e}")


def invalidate_catalog_cache(source_id: str) -> int:
    """
    Invalidate all cached catalog results for a source.

    Args:
        source_id: The source ID to invalidate cache for

    Returns:
        Number of keys deleted
    """
    redis = get_redis_client()
    if not redis.is_available():
        return 0

    try:
        pattern = f"madrona:catalog:{source_id}:*"
        deleted = 0
        cursor = 0
        while True:
            cursor, keys = redis.client.scan(cursor, match=pattern, count=100)
            if keys:
                deleted += redis.client.delete(*keys)
            if cursor == 0:
                break
        if deleted > 0:
            logger.info(f"Invalidated {deleted} catalog cache entries for {source_id}")
        return deleted
    except Exception as e:
        logger.debug(f"Failed to invalidate catalog cache: {e}")
        return 0


def discover_catalog(
    config: dict[str, Any],
    source_id: str,
    include_system: bool = False,
    use_cache: bool = True,
) -> CatalogResult:
    """
    Discover database catalog for any supported database type.

    Results are cached in Redis for 5 minutes by default to improve
    performance for repeated requests.

    Args:
        config: Database source configuration with 'type' field
        source_id: The connector instance ID for object ID generation
        include_system: Whether to include system schemas/databases
        use_cache: Whether to use Redis caching (default True)

    Returns:
        CatalogResult with discovered items or error
    """
    db_type = config.get("type")
    if not db_type:
        return CatalogResult(
            source_id=source_id,
            vendor="unknown",
            error=DbError(
                DbErrorCode.UNKNOWN,
                "Database type not specified in configuration",
                None,
                False,
            ),
        )

    discoverer = CATALOG_DISCOVERERS.get(db_type)
    if not discoverer:
        return CatalogResult(
            source_id=source_id,
            vendor=db_type,
            error=DbError(
                DbErrorCode.UNSUPPORTED_FEATURE,
                f"Catalog discovery not supported for database type: {db_type}",
                None,
                False,
            ),
        )

    # Try cache first
    cache_key = None
    if use_cache:
        cache_key = _get_catalog_cache_key(source_id, config, include_system)
        cached = _get_cached_catalog(cache_key)
        if cached:
            logger.debug(f"Returning cached catalog for {source_id}")
            return cached

    # Perform discovery
    result = discoverer(config, source_id, include_system)

    # Cache successful results
    if use_cache and cache_key and not result.error:
        _cache_catalog_result(cache_key, result)

    return result
