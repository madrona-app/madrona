"""
Database object description.

Provides detailed metadata for discovered database objects:
- SQL: columns with types, nullable, primary key info
- MongoDB: sampled fields with inferred types

All operations are bounded with timeouts and max payload sizes.
"""

import logging
import time
from collections import Counter
from dataclasses import dataclass, field
from typing import Any

from app.connectors.db.catalog import generate_object_id
from app.connectors.db.errors import DbError, DbErrorCode, normalize_db_error
from app.connectors.db.secrets import SecretResolutionError, resolve_password
from app.schemas.database_source import DEFAULT_PORTS

logger = logging.getLogger(__name__)

# Maximum documents to sample for MongoDB schema inference
MONGO_SAMPLE_SIZE = 50

# Maximum columns/fields to return
MAX_COLUMNS = 500

# Maximum examples per field for MongoDB
MAX_EXAMPLES_PER_FIELD = 5


@dataclass
class ColumnInfo:
    """SQL column metadata."""

    name: str
    type: str  # Normalized type (string, integer, boolean, etc.)
    nullable: bool
    primary_key: bool = False
    native_type: str = ""  # Original database type
    max_length: int | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to API response format."""
        result: dict[str, Any] = {
            "name": self.name,
            "type": self.type,
            "nullable": self.nullable,
            "nativeType": self.native_type,
        }
        if self.primary_key:
            result["primaryKey"] = True
        if self.max_length is not None:
            result["maxLength"] = self.max_length
        return result


@dataclass
class MongoFieldInfo:
    """MongoDB field metadata (inferred from samples)."""

    name: str
    type: str  # string, number, bool, date, object, array, null, unknown
    examples: list[Any] = field(default_factory=list)
    presence_pct: float | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to API response format."""
        result: dict[str, Any] = {
            "name": self.name,
            "type": self.type,
        }
        if self.examples:
            result["examples"] = self.examples[:MAX_EXAMPLES_PER_FIELD]
        if self.presence_pct is not None:
            result["presencePct"] = round(self.presence_pct, 1)
        return result


@dataclass
class SqlObjectDescription:
    """Description of a SQL table or view."""

    object_id: str
    kind: str  # "table" or "view"
    name: str
    path: list[str]
    columns: list[ColumnInfo] = field(default_factory=list)
    primary_key: list[str] | None = None
    meta: dict[str, Any] = field(default_factory=dict)
    error: DbError | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to API response format."""
        if self.error:
            return {
                "objectId": self.object_id,
                "error": self.error.to_dict(),
            }

        result: dict[str, Any] = {
            "objectId": self.object_id,
            "kind": self.kind,
            "name": self.name,
            "path": self.path,
            "columns": [col.to_dict() for col in self.columns[:MAX_COLUMNS]],
        }
        if self.primary_key:
            result["primaryKey"] = self.primary_key
        if self.meta:
            result["meta"] = self.meta
        return result


@dataclass
class MongoCollectionDescription:
    """Description of a MongoDB collection."""

    object_id: str
    kind: str = "collection"
    name: str = ""
    path: list[str] = field(default_factory=list)
    fields: list[MongoFieldInfo] = field(default_factory=list)
    meta: dict[str, Any] = field(default_factory=dict)
    error: DbError | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to API response format."""
        if self.error:
            return {
                "objectId": self.object_id,
                "error": self.error.to_dict(),
            }

        return {
            "objectId": self.object_id,
            "kind": self.kind,
            "name": self.name,
            "path": self.path,
            "fields": [f.to_dict() for f in self.fields[:MAX_COLUMNS]],
            "meta": self.meta,
        }


# Type normalization mappings for SQL databases
POSTGRES_TYPE_MAP = {
    "integer": "integer",
    "int": "integer",
    "int2": "integer",
    "int4": "integer",
    "int8": "integer",
    "smallint": "integer",
    "bigint": "integer",
    "serial": "integer",
    "bigserial": "integer",
    "real": "number",
    "double precision": "number",
    "float": "number",
    "float4": "number",
    "float8": "number",
    "numeric": "number",
    "decimal": "number",
    "money": "number",
    "boolean": "boolean",
    "bool": "boolean",
    "character varying": "string",
    "varchar": "string",
    "character": "string",
    "char": "string",
    "text": "string",
    "name": "string",
    "uuid": "string",
    "citext": "string",
    "date": "date",
    "timestamp": "datetime",
    "timestamp without time zone": "datetime",
    "timestamp with time zone": "datetime",
    "timestamptz": "datetime",
    "time": "time",
    "time without time zone": "time",
    "time with time zone": "time",
    "interval": "interval",
    "json": "json",
    "jsonb": "json",
    "bytea": "binary",
    "array": "array",
}

MYSQL_TYPE_MAP = {
    "tinyint": "integer",
    "smallint": "integer",
    "mediumint": "integer",
    "int": "integer",
    "integer": "integer",
    "bigint": "integer",
    "float": "number",
    "double": "number",
    "decimal": "number",
    "numeric": "number",
    "bit": "boolean",
    "char": "string",
    "varchar": "string",
    "tinytext": "string",
    "text": "string",
    "mediumtext": "string",
    "longtext": "string",
    "enum": "string",
    "set": "string",
    "date": "date",
    "datetime": "datetime",
    "timestamp": "datetime",
    "time": "time",
    "year": "integer",
    "binary": "binary",
    "varbinary": "binary",
    "tinyblob": "binary",
    "blob": "binary",
    "mediumblob": "binary",
    "longblob": "binary",
    "json": "json",
}

SQLSERVER_TYPE_MAP = {
    "tinyint": "integer",
    "smallint": "integer",
    "int": "integer",
    "bigint": "integer",
    "bit": "boolean",
    "decimal": "number",
    "numeric": "number",
    "money": "number",
    "smallmoney": "number",
    "float": "number",
    "real": "number",
    "char": "string",
    "varchar": "string",
    "text": "string",
    "nchar": "string",
    "nvarchar": "string",
    "ntext": "string",
    "date": "date",
    "datetime": "datetime",
    "datetime2": "datetime",
    "smalldatetime": "datetime",
    "datetimeoffset": "datetime",
    "time": "time",
    "binary": "binary",
    "varbinary": "binary",
    "image": "binary",
    "uniqueidentifier": "string",
    "xml": "xml",
}

ORACLE_TYPE_MAP = {
    "number": "number",
    "float": "number",
    "binary_float": "number",
    "binary_double": "number",
    "char": "string",
    "varchar2": "string",
    "nchar": "string",
    "nvarchar2": "string",
    "clob": "string",
    "nclob": "string",
    "long": "string",
    "date": "datetime",
    "timestamp": "datetime",
    "timestamp with time zone": "datetime",
    "timestamp with local time zone": "datetime",
    "interval year to month": "interval",
    "interval day to second": "interval",
    "raw": "binary",
    "long raw": "binary",
    "blob": "binary",
    "bfile": "binary",
    "rowid": "string",
    "urowid": "string",
}


def normalize_sql_type(native_type: str, type_map: dict[str, str]) -> str:
    """Normalize a native SQL type to a standard type."""
    native_lower = native_type.lower().strip()

    # Direct match
    if native_lower in type_map:
        return type_map[native_lower]

    # Check for type with parameters (e.g., "varchar(255)")
    base_type = native_lower.split("(")[0].strip()
    if base_type in type_map:
        return type_map[base_type]

    # Check for array types
    if "[]" in native_lower or "array" in native_lower:
        return "array"

    return "unknown"


def describe_postgres_object(
    config: dict[str, Any],
    source_id: str,
    database: str,
    schema: str,
    object_name: str,
    object_kind: str,
) -> SqlObjectDescription:
    """Describe a PostgreSQL table or view."""
    try:
        import psycopg
    except ImportError:
        try:
            import psycopg2 as psycopg  # type: ignore
        except ImportError:
            return SqlObjectDescription(
                object_id=generate_object_id(source_id, "postgres", database, schema, object_name),
                kind=object_kind,
                name=object_name,
                path=[database, schema, object_name],
                error=DbError(
                    DbErrorCode.UNSUPPORTED_FEATURE,
                    "PostgreSQL driver not installed.",
                    None,
                    False,
                ),
            )

    object_id = generate_object_id(source_id, "postgres", database, schema, object_name)

    host = config.get("host")
    port = config.get("port", DEFAULT_PORTS["postgres"])
    username = config.get("username")
    driver_opts = config.get("driverOptions", {})

    try:
        password = resolve_password(config.get("auth", {}))
    except SecretResolutionError as e:
        return SqlObjectDescription(
            object_id=object_id,
            kind=object_kind,
            name=object_name,
            path=[database, schema, object_name],
            error=DbError(DbErrorCode.AUTH_FAILED, str(e), None, False),
        )

    connect_timeout = driver_opts.get("connectTimeoutMs", 30000) / 1000
    statement_timeout = driver_opts.get("statementTimeoutMs", 60000)

    conn_params: dict[str, Any] = {
        "host": host,
        "port": port,
        "dbname": database,
        "user": username,
        "connect_timeout": int(connect_timeout),
    }
    if password:
        conn_params["password"] = password

    columns: list[ColumnInfo] = []
    primary_key_cols: list[str] = []
    meta: dict[str, Any] = {}

    try:
        conn = psycopg.connect(**conn_params)
        try:
            cursor = conn.cursor()

            # Set statement timeout
            cursor.execute(f"SET statement_timeout = {statement_timeout}")

            # Get column info
            cursor.execute("""
                SELECT
                    c.column_name,
                    c.data_type,
                    c.is_nullable,
                    c.character_maximum_length,
                    c.udt_name,
                    CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_pk
                FROM information_schema.columns c
                LEFT JOIN (
                    SELECT ku.column_name
                    FROM information_schema.table_constraints tc
                    JOIN information_schema.key_column_usage ku
                        ON tc.constraint_name = ku.constraint_name
                        AND tc.table_schema = ku.table_schema
                        AND tc.table_name = ku.table_name
                    WHERE tc.constraint_type = 'PRIMARY KEY'
                        AND tc.table_schema = %s
                        AND tc.table_name = %s
                ) pk ON c.column_name = pk.column_name
                WHERE c.table_schema = %s AND c.table_name = %s
                ORDER BY c.ordinal_position
            """, (schema, object_name, schema, object_name))

            for row in cursor.fetchall():
                col_name = row[0]
                data_type = row[1]
                is_nullable = row[2] == "YES"
                max_length = row[3]
                udt_name = row[4]
                is_pk = row[5]

                # Use udt_name for more accurate type info
                native_type = udt_name if udt_name else data_type
                normalized_type = normalize_sql_type(native_type, POSTGRES_TYPE_MAP)

                columns.append(ColumnInfo(
                    name=col_name,
                    type=normalized_type,
                    nullable=is_nullable,
                    primary_key=is_pk,
                    native_type=native_type,
                    max_length=max_length,
                ))

                if is_pk:
                    primary_key_cols.append(col_name)

            # Get row count estimate for tables
            if object_kind == "table":
                cursor.execute("""
                    SELECT reltuples::bigint as estimate
                    FROM pg_class
                    WHERE relname = %s
                    AND relnamespace = (
                        SELECT oid FROM pg_namespace WHERE nspname = %s
                    )
                """, (object_name, schema))
                row = cursor.fetchone()
                if row and row[0] >= 0:
                    meta["rowEstimate"] = int(row[0])

            # Get table/view comment
            cursor.execute("""
                SELECT obj_description(
                    (quote_ident(%s) || '.' || quote_ident(%s))::regclass,
                    'pg_class'
                )
            """, (schema, object_name))
            row = cursor.fetchone()
            if row and row[0]:
                meta["comment"] = row[0]

            return SqlObjectDescription(
                object_id=object_id,
                kind=object_kind,
                name=object_name,
                path=[database, schema, object_name],
                columns=columns,
                primary_key=primary_key_cols if primary_key_cols else None,
                meta=meta,
            )

        finally:
            conn.close()

    except Exception as e:
        error = normalize_db_error(e, "postgres")
        return SqlObjectDescription(
            object_id=object_id,
            kind=object_kind,
            name=object_name,
            path=[database, schema, object_name],
            error=error,
        )


def describe_mysql_object(
    config: dict[str, Any],
    source_id: str,
    database: str,
    object_name: str,
    object_kind: str,
) -> SqlObjectDescription:
    """Describe a MySQL table or view."""
    try:
        import pymysql
    except ImportError:
        return SqlObjectDescription(
            object_id=generate_object_id(source_id, "mysql", database, None, object_name),
            kind=object_kind,
            name=object_name,
            path=[database, object_name],
            error=DbError(
                DbErrorCode.UNSUPPORTED_FEATURE,
                "MySQL driver not installed.",
                None,
                False,
            ),
        )

    object_id = generate_object_id(source_id, "mysql", database, None, object_name)

    host = config.get("host")
    port = config.get("port", DEFAULT_PORTS["mysql"])
    username = config.get("username")
    driver_opts = config.get("driverOptions", {})

    try:
        password = resolve_password(config.get("auth", {}))
    except SecretResolutionError as e:
        return SqlObjectDescription(
            object_id=object_id,
            kind=object_kind,
            name=object_name,
            path=[database, object_name],
            error=DbError(DbErrorCode.AUTH_FAILED, str(e), None, False),
        )

    connect_timeout = int(driver_opts.get("connectTimeoutMs", 30000) / 1000)

    conn_params: dict[str, Any] = {
        "host": host,
        "port": port,
        "database": database,
        "user": username,
        "connect_timeout": connect_timeout,
    }
    if password:
        conn_params["password"] = password

    columns: list[ColumnInfo] = []
    primary_key_cols: list[str] = []
    meta: dict[str, Any] = {}

    try:
        conn = pymysql.connect(**conn_params)
        try:
            cursor = conn.cursor()

            # Get column info
            cursor.execute("""
                SELECT
                    c.COLUMN_NAME,
                    c.DATA_TYPE,
                    c.COLUMN_TYPE,
                    c.IS_NULLABLE,
                    c.CHARACTER_MAXIMUM_LENGTH,
                    c.COLUMN_KEY
                FROM information_schema.COLUMNS c
                WHERE c.TABLE_SCHEMA = %s AND c.TABLE_NAME = %s
                ORDER BY c.ORDINAL_POSITION
            """, (database, object_name))

            for row in cursor.fetchall():
                col_name = row[0]
                data_type = row[1]
                column_type = row[2]  # Full type with size info
                is_nullable = row[3] == "YES"
                max_length = row[4]
                column_key = row[5]

                is_pk = column_key == "PRI"
                normalized_type = normalize_sql_type(data_type, MYSQL_TYPE_MAP)

                columns.append(ColumnInfo(
                    name=col_name,
                    type=normalized_type,
                    nullable=is_nullable,
                    primary_key=is_pk,
                    native_type=column_type,
                    max_length=max_length,
                ))

                if is_pk:
                    primary_key_cols.append(col_name)

            # Get table stats
            if object_kind == "table":
                cursor.execute("""
                    SELECT TABLE_ROWS, TABLE_COMMENT
                    FROM information_schema.TABLES
                    WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s
                """, (database, object_name))
                row = cursor.fetchone()
                if row:
                    if row[0] is not None:
                        meta["rowEstimate"] = int(row[0])
                    if row[1]:
                        meta["comment"] = row[1]

            return SqlObjectDescription(
                object_id=object_id,
                kind=object_kind,
                name=object_name,
                path=[database, object_name],
                columns=columns,
                primary_key=primary_key_cols if primary_key_cols else None,
                meta=meta,
            )

        finally:
            conn.close()

    except Exception as e:
        error = normalize_db_error(e, "mysql")
        return SqlObjectDescription(
            object_id=object_id,
            kind=object_kind,
            name=object_name,
            path=[database, object_name],
            error=error,
        )


def describe_sqlserver_object(
    config: dict[str, Any],
    source_id: str,
    database: str,
    schema: str,
    object_name: str,
    object_kind: str,
) -> SqlObjectDescription:
    """Describe a SQL Server table or view."""
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
            return SqlObjectDescription(
                object_id=generate_object_id(source_id, "sqlserver", database, schema, object_name),
                kind=object_kind,
                name=object_name,
                path=[database, schema, object_name],
                error=DbError(
                    DbErrorCode.UNSUPPORTED_FEATURE,
                    "SQL Server driver not installed.",
                    None,
                    False,
                ),
            )

    object_id = generate_object_id(source_id, "sqlserver", database, schema, object_name)

    host = config.get("host")
    port = config.get("port", DEFAULT_PORTS["sqlserver"])
    username = config.get("username")
    instance = config.get("instance")
    driver_opts = config.get("driverOptions", {})

    try:
        password = resolve_password(config.get("auth", {}))
    except SecretResolutionError as e:
        return SqlObjectDescription(
            object_id=object_id,
            kind=object_kind,
            name=object_name,
            path=[database, schema, object_name],
            error=DbError(DbErrorCode.AUTH_FAILED, str(e), None, False),
        )

    connect_timeout = int(driver_opts.get("connectTimeoutMs", 30000) / 1000)

    columns: list[ColumnInfo] = []
    primary_key_cols: list[str] = []
    meta: dict[str, Any] = {}

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
                return SqlObjectDescription(
                    object_id=object_id,
                    kind=object_kind,
                    name=object_name,
                    path=[database, schema, object_name],
                    error=DbError(
                        DbErrorCode.UNSUPPORTED_FEATURE,
                        "No SQL Server ODBC driver found.",
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

            # Get column info
            cursor.execute("""
                SELECT
                    c.COLUMN_NAME,
                    c.DATA_TYPE,
                    c.IS_NULLABLE,
                    c.CHARACTER_MAXIMUM_LENGTH,
                    CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END as IS_PK
                FROM INFORMATION_SCHEMA.COLUMNS c
                LEFT JOIN (
                    SELECT ku.COLUMN_NAME
                    FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                    JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
                        ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
                        AND tc.TABLE_SCHEMA = ku.TABLE_SCHEMA
                        AND tc.TABLE_NAME = ku.TABLE_NAME
                    WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
                        AND tc.TABLE_SCHEMA = ?
                        AND tc.TABLE_NAME = ?
                ) pk ON c.COLUMN_NAME = pk.COLUMN_NAME
                WHERE c.TABLE_SCHEMA = ? AND c.TABLE_NAME = ?
                ORDER BY c.ORDINAL_POSITION
            """, (schema, object_name, schema, object_name))

            for row in cursor.fetchall():
                col_name = row[0]
                data_type = row[1]
                is_nullable = row[2] == "YES"
                max_length = row[3]
                is_pk = row[4] == 1

                normalized_type = normalize_sql_type(data_type, SQLSERVER_TYPE_MAP)

                columns.append(ColumnInfo(
                    name=col_name,
                    type=normalized_type,
                    nullable=is_nullable,
                    primary_key=is_pk,
                    native_type=data_type,
                    max_length=max_length if max_length and max_length > 0 else None,
                ))

                if is_pk:
                    primary_key_cols.append(col_name)

            # Get row count estimate for tables
            if object_kind == "table":
                cursor.execute("""
                    SELECT SUM(p.rows) as row_count
                    FROM sys.tables t
                    JOIN sys.schemas s ON t.schema_id = s.schema_id
                    JOIN sys.partitions p ON t.object_id = p.object_id
                    WHERE s.name = ? AND t.name = ? AND p.index_id IN (0, 1)
                """, (schema, object_name))
                row = cursor.fetchone()
                if row and row[0] is not None:
                    meta["rowEstimate"] = int(row[0])

            # Get object comment (extended property)
            cursor.execute("""
                SELECT ep.value
                FROM sys.extended_properties ep
                JOIN sys.objects o ON ep.major_id = o.object_id
                JOIN sys.schemas s ON o.schema_id = s.schema_id
                WHERE s.name = ? AND o.name = ?
                    AND ep.minor_id = 0
                    AND ep.name = 'MS_Description'
            """, (schema, object_name))
            row = cursor.fetchone()
            if row and row[0]:
                meta["comment"] = str(row[0])

            return SqlObjectDescription(
                object_id=object_id,
                kind=object_kind,
                name=object_name,
                path=[database, schema, object_name],
                columns=columns,
                primary_key=primary_key_cols if primary_key_cols else None,
                meta=meta,
            )

        finally:
            conn.close()

    except Exception as e:
        error = normalize_db_error(e, "sqlserver")
        return SqlObjectDescription(
            object_id=object_id,
            kind=object_kind,
            name=object_name,
            path=[database, schema, object_name],
            error=error,
        )


def describe_oracle_object(
    config: dict[str, Any],
    source_id: str,
    database: str,  # service name or SID
    schema: str,  # owner
    object_name: str,
    object_kind: str,
) -> SqlObjectDescription:
    """Describe an Oracle table or view."""
    try:
        import oracledb
    except ImportError:
        try:
            import cx_Oracle as oracledb  # type: ignore
        except ImportError:
            return SqlObjectDescription(
                object_id=generate_object_id(source_id, "oracle", database, schema, object_name),
                kind=object_kind,
                name=object_name,
                path=[database, schema, object_name],
                error=DbError(
                    DbErrorCode.UNSUPPORTED_FEATURE,
                    "Oracle driver not installed.",
                    None,
                    False,
                ),
            )

    object_id = generate_object_id(source_id, "oracle", database, schema, object_name)

    host = config.get("host")
    port = config.get("port", DEFAULT_PORTS["oracle"])
    username = config.get("username")
    service_name = config.get("serviceName")
    sid = config.get("sid")
    connect_string = config.get("connectString")

    try:
        password = resolve_password(config.get("auth", {}))
    except SecretResolutionError as e:
        return SqlObjectDescription(
            object_id=object_id,
            kind=object_kind,
            name=object_name,
            path=[database, schema, object_name],
            error=DbError(DbErrorCode.AUTH_FAILED, str(e), None, False),
        )

    # Build DSN
    if connect_string:
        dsn = connect_string
    elif service_name:
        dsn = f"{host}:{port}/{service_name}"
    elif sid:
        dsn = oracledb.makedsn(host, port, sid=sid)
    else:
        return SqlObjectDescription(
            object_id=object_id,
            kind=object_kind,
            name=object_name,
            path=[database, schema, object_name],
            error=DbError(
                DbErrorCode.UNKNOWN,
                "Oracle configuration requires serviceName, sid, or connectString",
                None,
                False,
            ),
        )

    columns: list[ColumnInfo] = []
    primary_key_cols: list[str] = []
    meta: dict[str, Any] = {}

    try:
        conn = oracledb.connect(user=username, password=password or "", dsn=dsn)

        try:
            cursor = conn.cursor()

            # Get column info
            cursor.execute("""
                SELECT
                    c.column_name,
                    c.data_type,
                    c.nullable,
                    c.data_length,
                    c.data_precision,
                    c.data_scale,
                    CASE WHEN pk.column_name IS NOT NULL THEN 1 ELSE 0 END as is_pk
                FROM all_tab_columns c
                LEFT JOIN (
                    SELECT acc.column_name
                    FROM all_constraints ac
                    JOIN all_cons_columns acc ON ac.constraint_name = acc.constraint_name
                        AND ac.owner = acc.owner
                    WHERE ac.constraint_type = 'P'
                        AND ac.owner = :owner
                        AND ac.table_name = :table_name
                ) pk ON c.column_name = pk.column_name
                WHERE c.owner = :owner2 AND c.table_name = :table_name2
                ORDER BY c.column_id
            """, {"owner": schema, "table_name": object_name, "owner2": schema, "table_name2": object_name})

            for row in cursor.fetchall():
                col_name = row[0]
                data_type = row[1]
                is_nullable = row[2] == "Y"
                data_length = row[3]
                data_precision = row[4]
                data_scale = row[5]
                is_pk = row[6] == 1

                # Build native type with precision/scale info
                if data_precision is not None and data_scale is not None:
                    native_type = f"{data_type}({data_precision},{data_scale})"
                elif data_precision is not None:
                    native_type = f"{data_type}({data_precision})"
                else:
                    native_type = data_type

                normalized_type = normalize_sql_type(data_type, ORACLE_TYPE_MAP)

                columns.append(ColumnInfo(
                    name=col_name,
                    type=normalized_type,
                    nullable=is_nullable,
                    primary_key=is_pk,
                    native_type=native_type,
                    max_length=data_length if data_type in ("VARCHAR2", "CHAR", "NVARCHAR2", "NCHAR") else None,
                ))

                if is_pk:
                    primary_key_cols.append(col_name)

            # Get row count estimate for tables
            if object_kind == "table":
                cursor.execute("""
                    SELECT num_rows
                    FROM all_tables
                    WHERE owner = :owner AND table_name = :table_name
                """, {"owner": schema, "table_name": object_name})
                row = cursor.fetchone()
                if row and row[0] is not None:
                    meta["rowEstimate"] = int(row[0])

            # Get table/view comment
            cursor.execute("""
                SELECT comments
                FROM all_tab_comments
                WHERE owner = :owner AND table_name = :table_name
            """, {"owner": schema, "table_name": object_name})
            row = cursor.fetchone()
            if row and row[0]:
                meta["comment"] = row[0]

            return SqlObjectDescription(
                object_id=object_id,
                kind=object_kind,
                name=object_name,
                path=[database, schema, object_name],
                columns=columns,
                primary_key=primary_key_cols if primary_key_cols else None,
                meta=meta,
            )

        finally:
            conn.close()

    except Exception as e:
        error = normalize_db_error(e, "oracle")
        return SqlObjectDescription(
            object_id=object_id,
            kind=object_kind,
            name=object_name,
            path=[database, schema, object_name],
            error=error,
        )


def infer_mongo_field_type(value: Any) -> str:
    """Infer MongoDB field type from a value."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, int) or isinstance(value, float):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"

    # Check for BSON types
    type_name = type(value).__name__
    if type_name == "ObjectId":
        return "string"
    if type_name in ("datetime", "Timestamp"):
        return "date"
    if type_name == "Binary":
        return "binary"

    return "unknown"


def describe_mongodb_collection(
    config: dict[str, Any],
    source_id: str,
    database: str,
    collection_name: str,
    sample_size: int = MONGO_SAMPLE_SIZE,
) -> MongoCollectionDescription:
    """
    Describe a MongoDB collection by sampling documents.

    Samples N documents and infers field types and presence.
    """
    try:
        from pymongo import MongoClient
        from pymongo.errors import PyMongoError
    except ImportError:
        return MongoCollectionDescription(
            object_id=generate_object_id(source_id, "mongodb", database, None, collection_name),
            name=collection_name,
            path=[database, collection_name],
            error=DbError(
                DbErrorCode.UNSUPPORTED_FEATURE,
                "MongoDB driver not installed.",
                None,
                False,
            ),
        )

    object_id = generate_object_id(source_id, "mongodb", database, None, collection_name)

    connection_uri = config.get("connectionUri")
    host = config.get("host")
    port = config.get("port", DEFAULT_PORTS["mongodb"])
    username = config.get("username")
    auth_source = config.get("authSource", "admin")
    replica_set = config.get("replicaSet")
    driver_opts = config.get("driverOptions", {})

    try:
        password = resolve_password(config.get("auth", {}))
    except SecretResolutionError as e:
        return MongoCollectionDescription(
            object_id=object_id,
            name=collection_name,
            path=[database, collection_name],
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

    try:
        client = MongoClient(**client_params)

        try:
            db = client[database]
            coll = db[collection_name]

            # Sample documents
            documents = list(coll.find().limit(sample_size))
            total_sampled = len(documents)

            if total_sampled == 0:
                return MongoCollectionDescription(
                    object_id=object_id,
                    name=collection_name,
                    path=[database, collection_name],
                    fields=[],
                    meta={"sampleSize": 0},
                )

            # Analyze fields
            field_types: dict[str, Counter] = {}
            field_examples: dict[str, list[Any]] = {}
            field_presence: dict[str, int] = {}

            for doc in documents:
                seen_fields = set()

                def analyze_field(prefix: str, value: Any):
                    """Recursively analyze a field value."""
                    field_name = prefix

                    if field_name not in field_types:
                        field_types[field_name] = Counter()
                        field_examples[field_name] = []
                        field_presence[field_name] = 0

                    field_type = infer_mongo_field_type(value)
                    field_types[field_name][field_type] += 1

                    # Collect examples (primitives only)
                    if field_type in ("string", "number", "bool", "date") and value is not None:
                        if len(field_examples[field_name]) < MAX_EXAMPLES_PER_FIELD:
                            # Convert to serializable format
                            if field_type == "date":
                                value = str(value)
                            if value not in field_examples[field_name]:
                                field_examples[field_name].append(value)

                    if field_name not in seen_fields:
                        field_presence[field_name] += 1
                        seen_fields.add(field_name)

                # Analyze top-level fields only
                for key, value in doc.items():
                    analyze_field(key, value)

            # Build field list
            fields: list[MongoFieldInfo] = []
            for field_name in sorted(field_types.keys()):
                type_counts = field_types[field_name]

                # Determine dominant type (ignore null)
                non_null_types = {t: c for t, c in type_counts.items() if t != "null"}
                if non_null_types:
                    dominant_type = max(non_null_types, key=lambda t: non_null_types[t])
                else:
                    dominant_type = "null"

                presence_pct = (field_presence[field_name] / total_sampled) * 100

                fields.append(MongoFieldInfo(
                    name=field_name,
                    type=dominant_type,
                    examples=field_examples[field_name],
                    presence_pct=presence_pct,
                ))

            return MongoCollectionDescription(
                object_id=object_id,
                name=collection_name,
                path=[database, collection_name],
                fields=fields,
                meta={"sampleSize": total_sampled},
            )

        finally:
            client.close()

    except PyMongoError as e:
        error = normalize_db_error(e, "mongodb")
        return MongoCollectionDescription(
            object_id=object_id,
            name=collection_name,
            path=[database, collection_name],
            error=error,
        )
    except Exception as e:
        error = normalize_db_error(e, "mongodb")
        return MongoCollectionDescription(
            object_id=object_id,
            name=collection_name,
            path=[database, collection_name],
            error=error,
        )


# Describe dispatcher
def describe_object(
    config: dict[str, Any],
    source_id: str,
    path: list[str],
    object_kind: str,
) -> SqlObjectDescription | MongoCollectionDescription:
    """
    Describe a database object.

    Args:
        config: Database source configuration
        source_id: Connector instance ID
        path: Path to object [database, schema?, object_name]
        object_kind: Type of object (table, view, collection)

    Returns:
        Object description with columns/fields
    """
    db_type = config.get("type")

    if db_type == "postgres":
        if len(path) != 3:
            return SqlObjectDescription(
                object_id="",
                kind=object_kind,
                name=path[-1] if path else "",
                path=path,
                error=DbError(
                    DbErrorCode.UNKNOWN,
                    "PostgreSQL path must be [database, schema, object_name]",
                    None,
                    False,
                ),
            )
        return describe_postgres_object(config, source_id, path[0], path[1], path[2], object_kind)

    elif db_type == "mysql":
        if len(path) != 2:
            return SqlObjectDescription(
                object_id="",
                kind=object_kind,
                name=path[-1] if path else "",
                path=path,
                error=DbError(
                    DbErrorCode.UNKNOWN,
                    "MySQL path must be [database, object_name]",
                    None,
                    False,
                ),
            )
        return describe_mysql_object(config, source_id, path[0], path[1], object_kind)

    elif db_type == "sqlserver":
        if len(path) != 3:
            return SqlObjectDescription(
                object_id="",
                kind=object_kind,
                name=path[-1] if path else "",
                path=path,
                error=DbError(
                    DbErrorCode.UNKNOWN,
                    "SQL Server path must be [database, schema, object_name]",
                    None,
                    False,
                ),
            )
        return describe_sqlserver_object(config, source_id, path[0], path[1], path[2], object_kind)

    elif db_type == "oracle":
        if len(path) != 3:
            return SqlObjectDescription(
                object_id="",
                kind=object_kind,
                name=path[-1] if path else "",
                path=path,
                error=DbError(
                    DbErrorCode.UNKNOWN,
                    "Oracle path must be [service, schema, object_name]",
                    None,
                    False,
                ),
            )
        return describe_oracle_object(config, source_id, path[0], path[1], path[2], object_kind)

    elif db_type == "mongodb":
        if len(path) != 2:
            return MongoCollectionDescription(
                object_id="",
                name=path[-1] if path else "",
                path=path,
                error=DbError(
                    DbErrorCode.UNKNOWN,
                    "MongoDB path must be [database, collection]",
                    None,
                    False,
                ),
            )
        return describe_mongodb_collection(config, source_id, path[0], path[1])

    else:
        return SqlObjectDescription(
            object_id="",
            kind=object_kind,
            name=path[-1] if path else "",
            path=path,
            error=DbError(
                DbErrorCode.UNSUPPORTED_FEATURE,
                f"Describe not supported for database type: {db_type}",
                None,
                False,
            ),
        )
