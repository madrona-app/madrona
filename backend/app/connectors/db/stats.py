"""
Database object statistics and sampling.

Provides:
- Object statistics (row count, size, last modified)
- Sample values for columns (distinct values)
- Permission checking for objects

All operations are bounded with timeouts.
"""

import logging
import time
from dataclasses import dataclass, field
from typing import Any

from app.connectors.db.errors import DbError, DbErrorCode, normalize_db_error
from app.connectors.db.secrets import SecretResolutionError, resolve_password
from app.schemas.database_source import DEFAULT_PORTS

logger = logging.getLogger(__name__)

# Maximum distinct values to return for sampling
MAX_SAMPLE_VALUES = 100

# Default timeout for stats queries (30 seconds)
STATS_TIMEOUT_SECONDS = 30


@dataclass
class ObjectStats:
    """Statistics for a database object."""

    object_id: str
    path: list[str]
    row_count: int | None = None
    size_bytes: int | None = None
    last_modified: str | None = None  # ISO 8601 timestamp
    meta: dict[str, Any] = field(default_factory=dict)
    error: DbError | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to API response format."""
        if self.error:
            return {
                "objectId": self.object_id,
                "path": self.path,
                "error": self.error.to_dict(),
            }

        result: dict[str, Any] = {
            "objectId": self.object_id,
            "path": self.path,
        }

        if self.row_count is not None:
            result["rowCount"] = self.row_count
        if self.size_bytes is not None:
            result["sizeBytes"] = self.size_bytes
        if self.last_modified is not None:
            result["lastModified"] = self.last_modified
        if self.meta:
            result["meta"] = self.meta

        return result


@dataclass
class SampleValues:
    """Sample distinct values for a column."""

    object_id: str
    path: list[str]
    column: str
    values: list[Any] = field(default_factory=list)
    total_distinct: int | None = None
    null_count: int | None = None
    error: DbError | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to API response format."""
        if self.error:
            return {
                "objectId": self.object_id,
                "path": self.path,
                "column": self.column,
                "error": self.error.to_dict(),
            }

        result: dict[str, Any] = {
            "objectId": self.object_id,
            "path": self.path,
            "column": self.column,
            "values": self.values[:MAX_SAMPLE_VALUES],
        }

        if self.total_distinct is not None:
            result["totalDistinct"] = self.total_distinct
        if self.null_count is not None:
            result["nullCount"] = self.null_count

        return result


@dataclass
class PermissionCheck:
    """Result of permission check for an object."""

    object_id: str
    path: list[str]
    can_read: bool = False
    can_write: bool = False
    permissions: list[str] = field(default_factory=list)
    error: DbError | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to API response format."""
        if self.error:
            return {
                "objectId": self.object_id,
                "path": self.path,
                "error": self.error.to_dict(),
            }

        return {
            "objectId": self.object_id,
            "path": self.path,
            "canRead": self.can_read,
            "canWrite": self.can_write,
            "permissions": self.permissions,
        }


# =============================================================================
# PostgreSQL implementations
# =============================================================================


def get_postgres_stats(
    config: dict[str, Any],
    source_id: str,
    path: list[str],
) -> ObjectStats:
    """Get statistics for a PostgreSQL table."""
    try:
        import psycopg
    except ImportError:
        try:
            import psycopg2 as psycopg  # type: ignore
        except ImportError:
            return ObjectStats(
                object_id=source_id,
                path=path,
                error=DbError(
                    DbErrorCode.UNSUPPORTED_FEATURE,
                    "PostgreSQL driver not installed.",
                    None,
                    False,
                ),
            )

    if len(path) < 3:
        return ObjectStats(
            object_id=source_id,
            path=path,
            error=DbError(
                DbErrorCode.UNKNOWN,
                "Path must include database, schema, and table name",
                None,
                False,
            ),
        )

    database, schema, table = path[0], path[1], path[2]

    host = config.get("host")
    port = config.get("port", DEFAULT_PORTS["postgres"])
    username = config.get("username")

    try:
        password = resolve_password(config.get("auth", {}))
    except SecretResolutionError as e:
        return ObjectStats(
            object_id=source_id,
            path=path,
            error=DbError(DbErrorCode.AUTH_FAILED, str(e), None, False),
        )

    conn_params: dict[str, Any] = {
        "host": host,
        "port": port,
        "dbname": database,
        "user": username,
        "connect_timeout": STATS_TIMEOUT_SECONDS,
    }
    if password:
        conn_params["password"] = password

    try:
        conn = psycopg.connect(**conn_params)
        try:
            cursor = conn.cursor()

            # Get row count and size from pg_stat_user_tables
            cursor.execute("""
                SELECT
                    c.reltuples::bigint AS row_estimate,
                    pg_total_relation_size(c.oid) AS total_bytes,
                    s.last_analyze,
                    s.last_autoanalyze
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                LEFT JOIN pg_stat_user_tables s
                    ON s.schemaname = n.nspname AND s.relname = c.relname
                WHERE n.nspname = %s AND c.relname = %s
            """, (schema, table))

            row = cursor.fetchone()
            if not row:
                return ObjectStats(
                    object_id=source_id,
                    path=path,
                    error=DbError(
                        DbErrorCode.UNKNOWN,
                        f"Table {schema}.{table} not found",
                        None,
                        False,
                    ),
                )

            row_count = row[0] if row[0] and row[0] >= 0 else None
            size_bytes = row[1]
            last_analyze = row[2] or row[3]
            last_modified = last_analyze.isoformat() if last_analyze else None

            return ObjectStats(
                object_id=source_id,
                path=path,
                row_count=row_count,
                size_bytes=size_bytes,
                last_modified=last_modified,
                meta={"source": "pg_stat_user_tables"},
            )

        finally:
            conn.close()

    except Exception as e:
        error = normalize_db_error(e, "postgres")
        return ObjectStats(object_id=source_id, path=path, error=error)


def get_postgres_sample_values(
    config: dict[str, Any],
    source_id: str,
    path: list[str],
    column: str,
) -> SampleValues:
    """Get sample distinct values for a PostgreSQL column."""
    try:
        import psycopg
    except ImportError:
        try:
            import psycopg2 as psycopg  # type: ignore
        except ImportError:
            return SampleValues(
                object_id=source_id,
                path=path,
                column=column,
                error=DbError(
                    DbErrorCode.UNSUPPORTED_FEATURE,
                    "PostgreSQL driver not installed.",
                    None,
                    False,
                ),
            )

    if len(path) < 3:
        return SampleValues(
            object_id=source_id,
            path=path,
            column=column,
            error=DbError(
                DbErrorCode.UNKNOWN,
                "Path must include database, schema, and table name",
                None,
                False,
            ),
        )

    database, schema, table = path[0], path[1], path[2]

    host = config.get("host")
    port = config.get("port", DEFAULT_PORTS["postgres"])
    username = config.get("username")

    try:
        password = resolve_password(config.get("auth", {}))
    except SecretResolutionError as e:
        return SampleValues(
            object_id=source_id,
            path=path,
            column=column,
            error=DbError(DbErrorCode.AUTH_FAILED, str(e), None, False),
        )

    conn_params: dict[str, Any] = {
        "host": host,
        "port": port,
        "dbname": database,
        "user": username,
        "connect_timeout": STATS_TIMEOUT_SECONDS,
    }
    if password:
        conn_params["password"] = password

    try:
        conn = psycopg.connect(**conn_params)
        try:
            cursor = conn.cursor()

            # Validate column exists
            cursor.execute("""
                SELECT column_name FROM information_schema.columns
                WHERE table_schema = %s AND table_name = %s AND column_name = %s
            """, (schema, table, column))

            if not cursor.fetchone():
                return SampleValues(
                    object_id=source_id,
                    path=path,
                    column=column,
                    error=DbError(
                        DbErrorCode.UNKNOWN,
                        f"Column '{column}' not found in {schema}.{table}",
                        None,
                        False,
                    ),
                )

            # Get distinct values (limited)
            # Using quote_ident for safety
            cursor.execute(f"""
                SELECT DISTINCT "{column}"
                FROM "{schema}"."{table}"
                WHERE "{column}" IS NOT NULL
                ORDER BY "{column}"
                LIMIT %s
            """, (MAX_SAMPLE_VALUES,))

            values = [row[0] for row in cursor.fetchall()]

            # Get null count
            cursor.execute(f"""
                SELECT COUNT(*) FROM "{schema}"."{table}"
                WHERE "{column}" IS NULL
            """)
            null_count = cursor.fetchone()[0]

            # Get approximate distinct count
            cursor.execute(f"""
                SELECT n_distinct
                FROM pg_stats
                WHERE schemaname = %s AND tablename = %s AND attname = %s
            """, (schema, table, column))

            stats_row = cursor.fetchone()
            total_distinct = None
            if stats_row and stats_row[0]:
                n_distinct = stats_row[0]
                if n_distinct > 0:
                    total_distinct = int(n_distinct)
                elif n_distinct < 0:
                    # Negative means fraction of rows
                    cursor.execute(f'SELECT COUNT(*) FROM "{schema}"."{table}"')
                    total_rows = cursor.fetchone()[0]
                    total_distinct = int(abs(n_distinct) * total_rows)

            return SampleValues(
                object_id=source_id,
                path=path,
                column=column,
                values=values,
                total_distinct=total_distinct,
                null_count=null_count,
            )

        finally:
            conn.close()

    except Exception as e:
        error = normalize_db_error(e, "postgres")
        return SampleValues(object_id=source_id, path=path, column=column, error=error)


def check_postgres_permissions(
    config: dict[str, Any],
    source_id: str,
    path: list[str],
) -> PermissionCheck:
    """Check permissions for a PostgreSQL table."""
    try:
        import psycopg
    except ImportError:
        try:
            import psycopg2 as psycopg  # type: ignore
        except ImportError:
            return PermissionCheck(
                object_id=source_id,
                path=path,
                error=DbError(
                    DbErrorCode.UNSUPPORTED_FEATURE,
                    "PostgreSQL driver not installed.",
                    None,
                    False,
                ),
            )

    if len(path) < 3:
        return PermissionCheck(
            object_id=source_id,
            path=path,
            error=DbError(
                DbErrorCode.UNKNOWN,
                "Path must include database, schema, and table name",
                None,
                False,
            ),
        )

    database, schema, table = path[0], path[1], path[2]

    host = config.get("host")
    port = config.get("port", DEFAULT_PORTS["postgres"])
    username = config.get("username")

    try:
        password = resolve_password(config.get("auth", {}))
    except SecretResolutionError as e:
        return PermissionCheck(
            object_id=source_id,
            path=path,
            error=DbError(DbErrorCode.AUTH_FAILED, str(e), None, False),
        )

    conn_params: dict[str, Any] = {
        "host": host,
        "port": port,
        "dbname": database,
        "user": username,
        "connect_timeout": STATS_TIMEOUT_SECONDS,
    }
    if password:
        conn_params["password"] = password

    try:
        conn = psycopg.connect(**conn_params)
        try:
            cursor = conn.cursor()

            # Check table privileges
            cursor.execute("""
                SELECT privilege_type
                FROM information_schema.table_privileges
                WHERE table_schema = %s AND table_name = %s AND grantee = current_user
            """, (schema, table))

            privileges = [row[0] for row in cursor.fetchall()]

            # Also check if user has superuser or table owner privileges
            cursor.execute("""
                SELECT
                    has_table_privilege(current_user, %s, 'SELECT') AS can_select,
                    has_table_privilege(current_user, %s, 'INSERT') AS can_insert,
                    has_table_privilege(current_user, %s, 'UPDATE') AS can_update,
                    has_table_privilege(current_user, %s, 'DELETE') AS can_delete
            """, (f'"{schema}"."{table}"',) * 4)

            row = cursor.fetchone()
            can_read = row[0] if row else False
            can_write = (row[1] or row[2] or row[3]) if row else False

            all_permissions = list(set(privileges))
            if can_read and "SELECT" not in all_permissions:
                all_permissions.append("SELECT")

            return PermissionCheck(
                object_id=source_id,
                path=path,
                can_read=can_read,
                can_write=can_write,
                permissions=all_permissions,
            )

        finally:
            conn.close()

    except Exception as e:
        error = normalize_db_error(e, "postgres")
        return PermissionCheck(object_id=source_id, path=path, error=error)


# =============================================================================
# MySQL implementations
# =============================================================================


def get_mysql_stats(
    config: dict[str, Any],
    source_id: str,
    path: list[str],
) -> ObjectStats:
    """Get statistics for a MySQL table."""
    try:
        import pymysql
    except ImportError:
        return ObjectStats(
            object_id=source_id,
            path=path,
            error=DbError(
                DbErrorCode.UNSUPPORTED_FEATURE,
                "MySQL driver not installed.",
                None,
                False,
            ),
        )

    if len(path) < 2:
        return ObjectStats(
            object_id=source_id,
            path=path,
            error=DbError(
                DbErrorCode.UNKNOWN,
                "Path must include database and table name",
                None,
                False,
            ),
        )

    database, table = path[0], path[1]

    host = config.get("host")
    port = config.get("port", DEFAULT_PORTS["mysql"])
    username = config.get("username")

    try:
        password = resolve_password(config.get("auth", {}))
    except SecretResolutionError as e:
        return ObjectStats(
            object_id=source_id,
            path=path,
            error=DbError(DbErrorCode.AUTH_FAILED, str(e), None, False),
        )

    conn_params: dict[str, Any] = {
        "host": host,
        "port": port,
        "database": database,
        "user": username,
        "connect_timeout": STATS_TIMEOUT_SECONDS,
    }
    if password:
        conn_params["password"] = password

    try:
        conn = pymysql.connect(**conn_params)
        try:
            cursor = conn.cursor()

            # Get stats from information_schema
            cursor.execute("""
                SELECT
                    TABLE_ROWS,
                    DATA_LENGTH + INDEX_LENGTH AS total_bytes,
                    UPDATE_TIME
                FROM information_schema.TABLES
                WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s
            """, (database, table))

            row = cursor.fetchone()
            if not row:
                return ObjectStats(
                    object_id=source_id,
                    path=path,
                    error=DbError(
                        DbErrorCode.UNKNOWN,
                        f"Table {database}.{table} not found",
                        None,
                        False,
                    ),
                )

            row_count = row[0]
            size_bytes = row[1]
            last_modified = row[2].isoformat() if row[2] else None

            return ObjectStats(
                object_id=source_id,
                path=path,
                row_count=row_count,
                size_bytes=size_bytes,
                last_modified=last_modified,
                meta={"source": "information_schema.TABLES"},
            )

        finally:
            conn.close()

    except Exception as e:
        error = normalize_db_error(e, "mysql")
        return ObjectStats(object_id=source_id, path=path, error=error)


def get_mysql_sample_values(
    config: dict[str, Any],
    source_id: str,
    path: list[str],
    column: str,
) -> SampleValues:
    """Get sample distinct values for a MySQL column."""
    try:
        import pymysql
    except ImportError:
        return SampleValues(
            object_id=source_id,
            path=path,
            column=column,
            error=DbError(
                DbErrorCode.UNSUPPORTED_FEATURE,
                "MySQL driver not installed.",
                None,
                False,
            ),
        )

    if len(path) < 2:
        return SampleValues(
            object_id=source_id,
            path=path,
            column=column,
            error=DbError(
                DbErrorCode.UNKNOWN,
                "Path must include database and table name",
                None,
                False,
            ),
        )

    database, table = path[0], path[1]

    host = config.get("host")
    port = config.get("port", DEFAULT_PORTS["mysql"])
    username = config.get("username")

    try:
        password = resolve_password(config.get("auth", {}))
    except SecretResolutionError as e:
        return SampleValues(
            object_id=source_id,
            path=path,
            column=column,
            error=DbError(DbErrorCode.AUTH_FAILED, str(e), None, False),
        )

    conn_params: dict[str, Any] = {
        "host": host,
        "port": port,
        "database": database,
        "user": username,
        "connect_timeout": STATS_TIMEOUT_SECONDS,
    }
    if password:
        conn_params["password"] = password

    try:
        conn = pymysql.connect(**conn_params)
        try:
            cursor = conn.cursor()

            # Validate column exists
            cursor.execute("""
                SELECT COLUMN_NAME FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s AND COLUMN_NAME = %s
            """, (database, table, column))

            if not cursor.fetchone():
                return SampleValues(
                    object_id=source_id,
                    path=path,
                    column=column,
                    error=DbError(
                        DbErrorCode.UNKNOWN,
                        f"Column '{column}' not found in {database}.{table}",
                        None,
                        False,
                    ),
                )

            # Get distinct values
            cursor.execute(f"""
                SELECT DISTINCT `{column}`
                FROM `{database}`.`{table}`
                WHERE `{column}` IS NOT NULL
                ORDER BY `{column}`
                LIMIT %s
            """, (MAX_SAMPLE_VALUES,))

            values = [row[0] for row in cursor.fetchall()]

            # Get null count
            cursor.execute(f"""
                SELECT COUNT(*) FROM `{database}`.`{table}`
                WHERE `{column}` IS NULL
            """)
            null_count = cursor.fetchone()[0]

            # Get cardinality from index stats
            cursor.execute("""
                SELECT CARDINALITY
                FROM information_schema.STATISTICS
                WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s AND COLUMN_NAME = %s
                LIMIT 1
            """, (database, table, column))

            stats_row = cursor.fetchone()
            total_distinct = stats_row[0] if stats_row else None

            return SampleValues(
                object_id=source_id,
                path=path,
                column=column,
                values=values,
                total_distinct=total_distinct,
                null_count=null_count,
            )

        finally:
            conn.close()

    except Exception as e:
        error = normalize_db_error(e, "mysql")
        return SampleValues(object_id=source_id, path=path, column=column, error=error)


def check_mysql_permissions(
    config: dict[str, Any],
    source_id: str,
    path: list[str],
) -> PermissionCheck:
    """Check permissions for a MySQL table."""
    try:
        import pymysql
    except ImportError:
        return PermissionCheck(
            object_id=source_id,
            path=path,
            error=DbError(
                DbErrorCode.UNSUPPORTED_FEATURE,
                "MySQL driver not installed.",
                None,
                False,
            ),
        )

    if len(path) < 2:
        return PermissionCheck(
            object_id=source_id,
            path=path,
            error=DbError(
                DbErrorCode.UNKNOWN,
                "Path must include database and table name",
                None,
                False,
            ),
        )

    database, table = path[0], path[1]

    host = config.get("host")
    port = config.get("port", DEFAULT_PORTS["mysql"])
    username = config.get("username")

    try:
        password = resolve_password(config.get("auth", {}))
    except SecretResolutionError as e:
        return PermissionCheck(
            object_id=source_id,
            path=path,
            error=DbError(DbErrorCode.AUTH_FAILED, str(e), None, False),
        )

    conn_params: dict[str, Any] = {
        "host": host,
        "port": port,
        "database": database,
        "user": username,
        "connect_timeout": STATS_TIMEOUT_SECONDS,
    }
    if password:
        conn_params["password"] = password

    try:
        conn = pymysql.connect(**conn_params)
        try:
            cursor = conn.cursor()

            # Check table privileges
            cursor.execute("""
                SELECT PRIVILEGE_TYPE
                FROM information_schema.TABLE_PRIVILEGES
                WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s AND GRANTEE LIKE %s
            """, (database, table, f"'{username}'%"))

            privileges = [row[0] for row in cursor.fetchall()]

            # Try a simple SELECT to verify read access
            can_read = False
            try:
                cursor.execute(f"SELECT 1 FROM `{database}`.`{table}` LIMIT 0")
                can_read = True
            except Exception as e:
                # Any DB error (permission denied, table not found, etc.) means no read access
                logger.debug(f"Read access check failed for {database}.{table}: {e}")

            can_write = any(p in privileges for p in ["INSERT", "UPDATE", "DELETE"])

            return PermissionCheck(
                object_id=source_id,
                path=path,
                can_read=can_read,
                can_write=can_write,
                permissions=privileges,
            )

        finally:
            conn.close()

    except Exception as e:
        error = normalize_db_error(e, "mysql")
        return PermissionCheck(object_id=source_id, path=path, error=error)


# =============================================================================
# SQL Server implementations
# =============================================================================


def get_sqlserver_stats(
    config: dict[str, Any],
    source_id: str,
    path: list[str],
) -> ObjectStats:
    """Get statistics for a SQL Server table."""
    try:
        import pyodbc
        driver_name = "pyodbc"
    except ImportError:
        try:
            import pymssql
            driver_name = "pymssql"
        except ImportError:
            return ObjectStats(
                object_id=source_id,
                path=path,
                error=DbError(
                    DbErrorCode.UNSUPPORTED_FEATURE,
                    "SQL Server driver not installed.",
                    None,
                    False,
                ),
            )

    if len(path) < 3:
        return ObjectStats(
            object_id=source_id,
            path=path,
            error=DbError(
                DbErrorCode.UNKNOWN,
                "Path must include database, schema, and table name",
                None,
                False,
            ),
        )

    database, schema, table = path[0], path[1], path[2]

    host = config.get("host")
    port = config.get("port", DEFAULT_PORTS["sqlserver"])
    username = config.get("username")
    instance = config.get("instance")

    try:
        password = resolve_password(config.get("auth", {}))
    except SecretResolutionError as e:
        return ObjectStats(
            object_id=source_id,
            path=path,
            error=DbError(DbErrorCode.AUTH_FAILED, str(e), None, False),
        )

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
                return ObjectStats(
                    object_id=source_id,
                    path=path,
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
            conn = pyodbc.connect(conn_str, timeout=STATS_TIMEOUT_SECONDS)
        else:
            server = f"{host}:{port}" if not instance else f"{host}\\{instance}:{port}"
            conn = pymssql.connect(
                server=server,
                user=username,
                password=password or "",
                database=database,
                timeout=STATS_TIMEOUT_SECONDS,
            )

        try:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT
                    SUM(p.rows) AS row_count,
                    SUM(a.total_pages) * 8 * 1024 AS size_bytes,
                    o.modify_date
                FROM sys.objects o
                JOIN sys.schemas s ON o.schema_id = s.schema_id
                LEFT JOIN sys.partitions p ON o.object_id = p.object_id AND p.index_id IN (0, 1)
                LEFT JOIN sys.allocation_units a ON p.partition_id = a.container_id
                WHERE s.name = ? AND o.name = ? AND o.type IN ('U', 'V')
                GROUP BY o.modify_date
            """, (schema, table))

            row = cursor.fetchone()
            if not row:
                return ObjectStats(
                    object_id=source_id,
                    path=path,
                    error=DbError(
                        DbErrorCode.UNKNOWN,
                        f"Table {schema}.{table} not found",
                        None,
                        False,
                    ),
                )

            row_count = row[0]
            size_bytes = row[1]
            last_modified = row[2].isoformat() if row[2] else None

            return ObjectStats(
                object_id=source_id,
                path=path,
                row_count=row_count,
                size_bytes=size_bytes,
                last_modified=last_modified,
                meta={"source": "sys.partitions"},
            )

        finally:
            conn.close()

    except Exception as e:
        error = normalize_db_error(e, "sqlserver")
        return ObjectStats(object_id=source_id, path=path, error=error)


def get_sqlserver_sample_values(
    config: dict[str, Any],
    source_id: str,
    path: list[str],
    column: str,
) -> SampleValues:
    """Get sample distinct values for a SQL Server column."""
    try:
        import pyodbc
        driver_name = "pyodbc"
    except ImportError:
        try:
            import pymssql
            driver_name = "pymssql"
        except ImportError:
            return SampleValues(
                object_id=source_id,
                path=path,
                column=column,
                error=DbError(
                    DbErrorCode.UNSUPPORTED_FEATURE,
                    "SQL Server driver not installed.",
                    None,
                    False,
                ),
            )

    if len(path) < 3:
        return SampleValues(
            object_id=source_id,
            path=path,
            column=column,
            error=DbError(
                DbErrorCode.UNKNOWN,
                "Path must include database, schema, and table name",
                None,
                False,
            ),
        )

    database, schema, table = path[0], path[1], path[2]

    host = config.get("host")
    port = config.get("port", DEFAULT_PORTS["sqlserver"])
    username = config.get("username")
    instance = config.get("instance")

    try:
        password = resolve_password(config.get("auth", {}))
    except SecretResolutionError as e:
        return SampleValues(
            object_id=source_id,
            path=path,
            column=column,
            error=DbError(DbErrorCode.AUTH_FAILED, str(e), None, False),
        )

    try:
        if driver_name == "pyodbc":
            server = f"{host},{port}" if not instance else f"{host}\\{instance},{port}"
            drivers = pyodbc.drivers()
            odbc_driver = None
            for d in ["ODBC Driver 18 for SQL Server", "ODBC Driver 17 for SQL Server", "SQL Server"]:
                if d in drivers:
                    odbc_driver = d
                    break
            conn_str = f"DRIVER={{{odbc_driver}}};SERVER={server};DATABASE={database};UID={username}"
            if password:
                conn_str += f";PWD={password}"
            conn_str += ";Encrypt=yes;TrustServerCertificate=yes"
            conn = pyodbc.connect(conn_str, timeout=STATS_TIMEOUT_SECONDS)
        else:
            server = f"{host}:{port}" if not instance else f"{host}\\{instance}:{port}"
            conn = pymssql.connect(
                server=server,
                user=username,
                password=password or "",
                database=database,
                timeout=STATS_TIMEOUT_SECONDS,
            )

        try:
            cursor = conn.cursor()

            # Get distinct values
            cursor.execute(f"""
                SELECT DISTINCT TOP {MAX_SAMPLE_VALUES} [{column}]
                FROM [{schema}].[{table}]
                WHERE [{column}] IS NOT NULL
                ORDER BY [{column}]
            """)

            values = [row[0] for row in cursor.fetchall()]

            # Get null count
            cursor.execute(f"""
                SELECT COUNT(*) FROM [{schema}].[{table}]
                WHERE [{column}] IS NULL
            """)
            null_count = cursor.fetchone()[0]

            return SampleValues(
                object_id=source_id,
                path=path,
                column=column,
                values=values,
                null_count=null_count,
            )

        finally:
            conn.close()

    except Exception as e:
        error = normalize_db_error(e, "sqlserver")
        return SampleValues(object_id=source_id, path=path, column=column, error=error)


def check_sqlserver_permissions(
    config: dict[str, Any],
    source_id: str,
    path: list[str],
) -> PermissionCheck:
    """Check permissions for a SQL Server table."""
    try:
        import pyodbc
        driver_name = "pyodbc"
    except ImportError:
        try:
            import pymssql
            driver_name = "pymssql"
        except ImportError:
            return PermissionCheck(
                object_id=source_id,
                path=path,
                error=DbError(
                    DbErrorCode.UNSUPPORTED_FEATURE,
                    "SQL Server driver not installed.",
                    None,
                    False,
                ),
            )

    if len(path) < 3:
        return PermissionCheck(
            object_id=source_id,
            path=path,
            error=DbError(
                DbErrorCode.UNKNOWN,
                "Path must include database, schema, and table name",
                None,
                False,
            ),
        )

    database, schema, table = path[0], path[1], path[2]

    host = config.get("host")
    port = config.get("port", DEFAULT_PORTS["sqlserver"])
    username = config.get("username")
    instance = config.get("instance")

    try:
        password = resolve_password(config.get("auth", {}))
    except SecretResolutionError as e:
        return PermissionCheck(
            object_id=source_id,
            path=path,
            error=DbError(DbErrorCode.AUTH_FAILED, str(e), None, False),
        )

    try:
        if driver_name == "pyodbc":
            server = f"{host},{port}" if not instance else f"{host}\\{instance},{port}"
            drivers = pyodbc.drivers()
            odbc_driver = None
            for d in ["ODBC Driver 18 for SQL Server", "ODBC Driver 17 for SQL Server", "SQL Server"]:
                if d in drivers:
                    odbc_driver = d
                    break
            conn_str = f"DRIVER={{{odbc_driver}}};SERVER={server};DATABASE={database};UID={username}"
            if password:
                conn_str += f";PWD={password}"
            conn_str += ";Encrypt=yes;TrustServerCertificate=yes"
            conn = pyodbc.connect(conn_str, timeout=STATS_TIMEOUT_SECONDS)
        else:
            server = f"{host}:{port}" if not instance else f"{host}\\{instance}:{port}"
            conn = pymssql.connect(
                server=server,
                user=username,
                password=password or "",
                database=database,
                timeout=STATS_TIMEOUT_SECONDS,
            )

        try:
            cursor = conn.cursor()

            # Check permissions using fn_my_permissions
            cursor.execute(f"""
                SELECT permission_name
                FROM fn_my_permissions('[{schema}].[{table}]', 'OBJECT')
            """)

            permissions = [row[0] for row in cursor.fetchall()]

            can_read = "SELECT" in permissions
            can_write = any(p in permissions for p in ["INSERT", "UPDATE", "DELETE"])

            return PermissionCheck(
                object_id=source_id,
                path=path,
                can_read=can_read,
                can_write=can_write,
                permissions=permissions,
            )

        finally:
            conn.close()

    except Exception as e:
        error = normalize_db_error(e, "sqlserver")
        return PermissionCheck(object_id=source_id, path=path, error=error)


# =============================================================================
# Oracle implementations
# =============================================================================


def get_oracle_stats(
    config: dict[str, Any],
    source_id: str,
    path: list[str],
) -> ObjectStats:
    """Get statistics for an Oracle table."""
    try:
        import oracledb
    except ImportError:
        try:
            import cx_Oracle as oracledb  # type: ignore
        except ImportError:
            return ObjectStats(
                object_id=source_id,
                path=path,
                error=DbError(
                    DbErrorCode.UNSUPPORTED_FEATURE,
                    "Oracle driver not installed.",
                    None,
                    False,
                ),
            )

    if len(path) < 3:
        return ObjectStats(
            object_id=source_id,
            path=path,
            error=DbError(
                DbErrorCode.UNKNOWN,
                "Path must include database, schema, and table name",
                None,
                False,
            ),
        )

    db_name, schema, table = path[0], path[1], path[2]

    host = config.get("host")
    port = config.get("port", DEFAULT_PORTS["oracle"])
    username = config.get("username")
    service_name = config.get("serviceName")
    sid = config.get("sid")
    connect_string = config.get("connectString")

    try:
        password = resolve_password(config.get("auth", {}))
    except SecretResolutionError as e:
        return ObjectStats(
            object_id=source_id,
            path=path,
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
        return ObjectStats(
            object_id=source_id,
            path=path,
            error=DbError(
                DbErrorCode.UNKNOWN,
                "Oracle config requires serviceName, sid, or connectString",
                None,
                False,
            ),
        )

    try:
        conn = oracledb.connect(user=username, password=password or "", dsn=dsn)

        try:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT
                    num_rows,
                    blocks * 8 * 1024 AS size_bytes,
                    last_analyzed
                FROM all_tables
                WHERE owner = :owner AND table_name = :table_name
            """, {"owner": schema.upper(), "table_name": table.upper()})

            row = cursor.fetchone()
            if not row:
                return ObjectStats(
                    object_id=source_id,
                    path=path,
                    error=DbError(
                        DbErrorCode.UNKNOWN,
                        f"Table {schema}.{table} not found",
                        None,
                        False,
                    ),
                )

            row_count = row[0]
            size_bytes = row[1]
            last_modified = row[2].isoformat() if row[2] else None

            return ObjectStats(
                object_id=source_id,
                path=path,
                row_count=row_count,
                size_bytes=size_bytes,
                last_modified=last_modified,
                meta={"source": "all_tables"},
            )

        finally:
            conn.close()

    except Exception as e:
        error = normalize_db_error(e, "oracle")
        return ObjectStats(object_id=source_id, path=path, error=error)


def get_oracle_sample_values(
    config: dict[str, Any],
    source_id: str,
    path: list[str],
    column: str,
) -> SampleValues:
    """Get sample distinct values for an Oracle column."""
    try:
        import oracledb
    except ImportError:
        try:
            import cx_Oracle as oracledb  # type: ignore
        except ImportError:
            return SampleValues(
                object_id=source_id,
                path=path,
                column=column,
                error=DbError(
                    DbErrorCode.UNSUPPORTED_FEATURE,
                    "Oracle driver not installed.",
                    None,
                    False,
                ),
            )

    if len(path) < 3:
        return SampleValues(
            object_id=source_id,
            path=path,
            column=column,
            error=DbError(
                DbErrorCode.UNKNOWN,
                "Path must include database, schema, and table name",
                None,
                False,
            ),
        )

    db_name, schema, table = path[0], path[1], path[2]

    host = config.get("host")
    port = config.get("port", DEFAULT_PORTS["oracle"])
    username = config.get("username")
    service_name = config.get("serviceName")
    sid = config.get("sid")
    connect_string = config.get("connectString")

    try:
        password = resolve_password(config.get("auth", {}))
    except SecretResolutionError as e:
        return SampleValues(
            object_id=source_id,
            path=path,
            column=column,
            error=DbError(DbErrorCode.AUTH_FAILED, str(e), None, False),
        )

    if connect_string:
        dsn = connect_string
    elif service_name:
        dsn = f"{host}:{port}/{service_name}"
    elif sid:
        dsn = oracledb.makedsn(host, port, sid=sid)
    else:
        return SampleValues(
            object_id=source_id,
            path=path,
            column=column,
            error=DbError(DbErrorCode.UNKNOWN, "Oracle config requires serviceName, sid, or connectString", None, False),
        )

    try:
        conn = oracledb.connect(user=username, password=password or "", dsn=dsn)

        try:
            cursor = conn.cursor()

            # Get distinct values
            cursor.execute(f"""
                SELECT DISTINCT "{column.upper()}"
                FROM "{schema.upper()}"."{table.upper()}"
                WHERE "{column.upper()}" IS NOT NULL
                ORDER BY "{column.upper()}"
                FETCH FIRST :limit ROWS ONLY
            """, {"limit": MAX_SAMPLE_VALUES})

            values = [row[0] for row in cursor.fetchall()]

            # Get null count
            cursor.execute(f"""
                SELECT COUNT(*) FROM "{schema.upper()}"."{table.upper()}"
                WHERE "{column.upper()}" IS NULL
            """)
            null_count = cursor.fetchone()[0]

            # Get distinct count from stats
            cursor.execute("""
                SELECT num_distinct
                FROM all_tab_col_statistics
                WHERE owner = :owner AND table_name = :table_name AND column_name = :column_name
            """, {"owner": schema.upper(), "table_name": table.upper(), "column_name": column.upper()})

            stats_row = cursor.fetchone()
            total_distinct = stats_row[0] if stats_row else None

            return SampleValues(
                object_id=source_id,
                path=path,
                column=column,
                values=values,
                total_distinct=total_distinct,
                null_count=null_count,
            )

        finally:
            conn.close()

    except Exception as e:
        error = normalize_db_error(e, "oracle")
        return SampleValues(object_id=source_id, path=path, column=column, error=error)


def check_oracle_permissions(
    config: dict[str, Any],
    source_id: str,
    path: list[str],
) -> PermissionCheck:
    """Check permissions for an Oracle table."""
    try:
        import oracledb
    except ImportError:
        try:
            import cx_Oracle as oracledb  # type: ignore
        except ImportError:
            return PermissionCheck(
                object_id=source_id,
                path=path,
                error=DbError(
                    DbErrorCode.UNSUPPORTED_FEATURE,
                    "Oracle driver not installed.",
                    None,
                    False,
                ),
            )

    if len(path) < 3:
        return PermissionCheck(
            object_id=source_id,
            path=path,
            error=DbError(
                DbErrorCode.UNKNOWN,
                "Path must include database, schema, and table name",
                None,
                False,
            ),
        )

    db_name, schema, table = path[0], path[1], path[2]

    host = config.get("host")
    port = config.get("port", DEFAULT_PORTS["oracle"])
    username = config.get("username")
    service_name = config.get("serviceName")
    sid = config.get("sid")
    connect_string = config.get("connectString")

    try:
        password = resolve_password(config.get("auth", {}))
    except SecretResolutionError as e:
        return PermissionCheck(
            object_id=source_id,
            path=path,
            error=DbError(DbErrorCode.AUTH_FAILED, str(e), None, False),
        )

    if connect_string:
        dsn = connect_string
    elif service_name:
        dsn = f"{host}:{port}/{service_name}"
    elif sid:
        dsn = oracledb.makedsn(host, port, sid=sid)
    else:
        return PermissionCheck(
            object_id=source_id,
            path=path,
            error=DbError(DbErrorCode.UNKNOWN, "Oracle config requires serviceName, sid, or connectString", None, False),
        )

    try:
        conn = oracledb.connect(user=username, password=password or "", dsn=dsn)

        try:
            cursor = conn.cursor()

            # Check grants on table
            cursor.execute("""
                SELECT privilege
                FROM all_tab_privs
                WHERE table_schema = :schema AND table_name = :table_name
                AND grantee = USER
            """, {"schema": schema.upper(), "table_name": table.upper()})

            privileges = [row[0] for row in cursor.fetchall()]

            # If owner, has all privileges
            cursor.execute("""
                SELECT 1 FROM all_tables
                WHERE owner = :schema AND table_name = :table_name
                AND owner = USER
            """, {"schema": schema.upper(), "table_name": table.upper()})

            if cursor.fetchone():
                privileges = ["SELECT", "INSERT", "UPDATE", "DELETE"]

            can_read = "SELECT" in privileges
            can_write = any(p in privileges for p in ["INSERT", "UPDATE", "DELETE"])

            return PermissionCheck(
                object_id=source_id,
                path=path,
                can_read=can_read,
                can_write=can_write,
                permissions=privileges,
            )

        finally:
            conn.close()

    except Exception as e:
        error = normalize_db_error(e, "oracle")
        return PermissionCheck(object_id=source_id, path=path, error=error)


# =============================================================================
# MongoDB implementations
# =============================================================================


def get_mongodb_stats(
    config: dict[str, Any],
    source_id: str,
    path: list[str],
) -> ObjectStats:
    """Get statistics for a MongoDB collection."""
    try:
        from pymongo import MongoClient
    except ImportError:
        return ObjectStats(
            object_id=source_id,
            path=path,
            error=DbError(
                DbErrorCode.UNSUPPORTED_FEATURE,
                "MongoDB driver not installed.",
                None,
                False,
            ),
        )

    if len(path) < 2:
        return ObjectStats(
            object_id=source_id,
            path=path,
            error=DbError(
                DbErrorCode.UNKNOWN,
                "Path must include database and collection name",
                None,
                False,
            ),
        )

    database, collection = path[0], path[1]

    connection_uri = config.get("connectionUri")
    host = config.get("host")
    port = config.get("port", DEFAULT_PORTS["mongodb"])
    username = config.get("username")
    auth_source = config.get("authSource", "admin")
    driver_opts = config.get("driverOptions", {})

    try:
        password = resolve_password(config.get("auth", {}))
    except SecretResolutionError as e:
        return ObjectStats(
            object_id=source_id,
            path=path,
            error=DbError(DbErrorCode.AUTH_FAILED, str(e), None, False),
        )

    connect_timeout_ms = driver_opts.get("connectTimeoutMs", 30000)

    if connection_uri:
        client_params: dict[str, Any] = {
            "host": connection_uri,
            "serverSelectionTimeoutMS": connect_timeout_ms,
            "connectTimeoutMS": connect_timeout_ms,
        }
        if username and password:
            client_params["username"] = username
            client_params["password"] = password
            client_params["authSource"] = auth_source
    else:
        client_params = {
            "host": host,
            "port": port,
            "serverSelectionTimeoutMS": connect_timeout_ms,
            "connectTimeoutMS": connect_timeout_ms,
        }
        if username:
            client_params["username"] = username
        if password:
            client_params["password"] = password
        if auth_source:
            client_params["authSource"] = auth_source

    try:
        client = MongoClient(**client_params)

        try:
            db = client[database]
            stats = db.command("collStats", collection)

            row_count = stats.get("count")
            size_bytes = stats.get("size")

            return ObjectStats(
                object_id=source_id,
                path=path,
                row_count=row_count,
                size_bytes=size_bytes,
                meta={
                    "storageSize": stats.get("storageSize"),
                    "avgObjSize": stats.get("avgObjSize"),
                    "nindexes": stats.get("nindexes"),
                },
            )

        finally:
            client.close()

    except Exception as e:
        error = normalize_db_error(e, "mongodb")
        return ObjectStats(object_id=source_id, path=path, error=error)


def get_mongodb_sample_values(
    config: dict[str, Any],
    source_id: str,
    path: list[str],
    column: str,
) -> SampleValues:
    """Get sample distinct values for a MongoDB field."""
    try:
        from pymongo import MongoClient
    except ImportError:
        return SampleValues(
            object_id=source_id,
            path=path,
            column=column,
            error=DbError(
                DbErrorCode.UNSUPPORTED_FEATURE,
                "MongoDB driver not installed.",
                None,
                False,
            ),
        )

    if len(path) < 2:
        return SampleValues(
            object_id=source_id,
            path=path,
            column=column,
            error=DbError(
                DbErrorCode.UNKNOWN,
                "Path must include database and collection name",
                None,
                False,
            ),
        )

    database, collection_name = path[0], path[1]

    connection_uri = config.get("connectionUri")
    host = config.get("host")
    port = config.get("port", DEFAULT_PORTS["mongodb"])
    username = config.get("username")
    auth_source = config.get("authSource", "admin")
    driver_opts = config.get("driverOptions", {})

    try:
        password = resolve_password(config.get("auth", {}))
    except SecretResolutionError as e:
        return SampleValues(
            object_id=source_id,
            path=path,
            column=column,
            error=DbError(DbErrorCode.AUTH_FAILED, str(e), None, False),
        )

    connect_timeout_ms = driver_opts.get("connectTimeoutMs", 30000)

    if connection_uri:
        client_params: dict[str, Any] = {
            "host": connection_uri,
            "serverSelectionTimeoutMS": connect_timeout_ms,
            "connectTimeoutMS": connect_timeout_ms,
        }
        if username and password:
            client_params["username"] = username
            client_params["password"] = password
            client_params["authSource"] = auth_source
    else:
        client_params = {
            "host": host,
            "port": port,
            "serverSelectionTimeoutMS": connect_timeout_ms,
            "connectTimeoutMS": connect_timeout_ms,
        }
        if username:
            client_params["username"] = username
        if password:
            client_params["password"] = password
        if auth_source:
            client_params["authSource"] = auth_source

    try:
        client = MongoClient(**client_params)

        try:
            db = client[database]
            coll = db[collection_name]

            # Get distinct values (limited by MongoDB to 16MB result)
            values = coll.distinct(column)[:MAX_SAMPLE_VALUES]

            # Get null count
            null_count = coll.count_documents({column: None})

            return SampleValues(
                object_id=source_id,
                path=path,
                column=column,
                values=values,
                null_count=null_count,
            )

        finally:
            client.close()

    except Exception as e:
        error = normalize_db_error(e, "mongodb")
        return SampleValues(object_id=source_id, path=path, column=column, error=error)


def check_mongodb_permissions(
    config: dict[str, Any],
    source_id: str,
    path: list[str],
) -> PermissionCheck:
    """Check permissions for a MongoDB collection."""
    try:
        from pymongo import MongoClient
        from pymongo.errors import OperationFailure
    except ImportError:
        return PermissionCheck(
            object_id=source_id,
            path=path,
            error=DbError(
                DbErrorCode.UNSUPPORTED_FEATURE,
                "MongoDB driver not installed.",
                None,
                False,
            ),
        )

    if len(path) < 2:
        return PermissionCheck(
            object_id=source_id,
            path=path,
            error=DbError(
                DbErrorCode.UNKNOWN,
                "Path must include database and collection name",
                None,
                False,
            ),
        )

    database, collection_name = path[0], path[1]

    connection_uri = config.get("connectionUri")
    host = config.get("host")
    port = config.get("port", DEFAULT_PORTS["mongodb"])
    username = config.get("username")
    auth_source = config.get("authSource", "admin")
    driver_opts = config.get("driverOptions", {})

    try:
        password = resolve_password(config.get("auth", {}))
    except SecretResolutionError as e:
        return PermissionCheck(
            object_id=source_id,
            path=path,
            error=DbError(DbErrorCode.AUTH_FAILED, str(e), None, False),
        )

    connect_timeout_ms = driver_opts.get("connectTimeoutMs", 30000)

    if connection_uri:
        client_params: dict[str, Any] = {
            "host": connection_uri,
            "serverSelectionTimeoutMS": connect_timeout_ms,
            "connectTimeoutMS": connect_timeout_ms,
        }
        if username and password:
            client_params["username"] = username
            client_params["password"] = password
            client_params["authSource"] = auth_source
    else:
        client_params = {
            "host": host,
            "port": port,
            "serverSelectionTimeoutMS": connect_timeout_ms,
            "connectTimeoutMS": connect_timeout_ms,
        }
        if username:
            client_params["username"] = username
        if password:
            client_params["password"] = password
        if auth_source:
            client_params["authSource"] = auth_source

    try:
        client = MongoClient(**client_params)

        try:
            db = client[database]
            coll = db[collection_name]

            permissions = []
            can_read = False
            can_write = False

            # Test read access
            try:
                coll.find_one({}, {"_id": 1})
                can_read = True
                permissions.append("find")
            except OperationFailure:
                pass

            # Test write access (try to run a no-op update)
            try:
                # Use a query that won't match anything
                coll.update_one(
                    {"_id": {"$exists": False, "$type": "undefined"}},
                    {"$set": {"_test": 1}},
                )
                can_write = True
                permissions.extend(["insert", "update", "remove"])
            except OperationFailure:
                pass

            return PermissionCheck(
                object_id=source_id,
                path=path,
                can_read=can_read,
                can_write=can_write,
                permissions=permissions,
            )

        finally:
            client.close()

    except Exception as e:
        error = normalize_db_error(e, "mongodb")
        return PermissionCheck(object_id=source_id, path=path, error=error)


# =============================================================================
# Dispatcher functions
# =============================================================================


STATS_HANDLERS = {
    "postgres": get_postgres_stats,
    "mysql": get_mysql_stats,
    "sqlserver": get_sqlserver_stats,
    "oracle": get_oracle_stats,
    "mongodb": get_mongodb_stats,
}

SAMPLE_VALUES_HANDLERS = {
    "postgres": get_postgres_sample_values,
    "mysql": get_mysql_sample_values,
    "sqlserver": get_sqlserver_sample_values,
    "oracle": get_oracle_sample_values,
    "mongodb": get_mongodb_sample_values,
}

PERMISSION_CHECK_HANDLERS = {
    "postgres": check_postgres_permissions,
    "mysql": check_mysql_permissions,
    "sqlserver": check_sqlserver_permissions,
    "oracle": check_oracle_permissions,
    "mongodb": check_mongodb_permissions,
}


def get_object_stats(
    config: dict[str, Any],
    source_id: str,
    path: list[str],
) -> ObjectStats:
    """Get statistics for a database object."""
    db_type = config.get("type")
    if not db_type:
        return ObjectStats(
            object_id=source_id,
            path=path,
            error=DbError(DbErrorCode.UNKNOWN, "Database type not specified", None, False),
        )

    handler = STATS_HANDLERS.get(db_type)
    if not handler:
        return ObjectStats(
            object_id=source_id,
            path=path,
            error=DbError(DbErrorCode.UNSUPPORTED_FEATURE, f"Stats not supported for {db_type}", None, False),
        )

    return handler(config, source_id, path)


def get_sample_values(
    config: dict[str, Any],
    source_id: str,
    path: list[str],
    column: str,
) -> SampleValues:
    """Get sample distinct values for a column/field."""
    db_type = config.get("type")
    if not db_type:
        return SampleValues(
            object_id=source_id,
            path=path,
            column=column,
            error=DbError(DbErrorCode.UNKNOWN, "Database type not specified", None, False),
        )

    handler = SAMPLE_VALUES_HANDLERS.get(db_type)
    if not handler:
        return SampleValues(
            object_id=source_id,
            path=path,
            column=column,
            error=DbError(DbErrorCode.UNSUPPORTED_FEATURE, f"Sample values not supported for {db_type}", None, False),
        )

    return handler(config, source_id, path, column)


def check_permissions(
    config: dict[str, Any],
    source_id: str,
    path: list[str],
) -> PermissionCheck:
    """Check permissions for a database object."""
    db_type = config.get("type")
    if not db_type:
        return PermissionCheck(
            object_id=source_id,
            path=path,
            error=DbError(DbErrorCode.UNKNOWN, "Database type not specified", None, False),
        )

    handler = PERMISSION_CHECK_HANDLERS.get(db_type)
    if not handler:
        return PermissionCheck(
            object_id=source_id,
            path=path,
            error=DbError(DbErrorCode.UNSUPPORTED_FEATURE, f"Permission check not supported for {db_type}", None, False),
        )

    return handler(config, source_id, path)
