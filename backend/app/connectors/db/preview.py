"""
Database preview functionality.

Provides safe, limited data preview for database objects:
- SQL: Parameterized queries with column validation
- MongoDB: Projections and filters with bounded results

All operations enforce strict limits on rows and payload size.
"""

import json
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any

from app.connectors.db.errors import DbError, DbErrorCode, normalize_db_error
from app.connectors.db.secrets import SecretResolutionError, resolve_password
from app.schemas.database_source import DEFAULT_PORTS

logger = logging.getLogger(__name__)

# Safety limits
MAX_PREVIEW_LIMIT = 100
DEFAULT_PREVIEW_LIMIT = 25
MAX_RESPONSE_BYTES = 1_048_576  # 1MB

# Valid identifier pattern (prevents SQL injection)
VALID_IDENTIFIER_PATTERN = re.compile(r'^[a-zA-Z_][a-zA-Z0-9_]*$')


@dataclass
class PreviewFilter:
    """Simple filter for preview queries."""

    type: str  # "equals", "not_equals", "gt", "gte", "lt", "lte", "contains", "is_null", "is_not_null"
    field: str
    value: Any = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "PreviewFilter":
        return cls(
            type=data.get("type", "equals"),
            field=data.get("field", ""),
            value=data.get("value"),
        )


@dataclass
class PreviewSort:
    """Sort specification for preview queries."""

    field: str
    dir: str = "asc"  # "asc" or "desc"

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "PreviewSort":
        return cls(
            field=data.get("field", ""),
            dir=data.get("dir", "asc"),
        )


@dataclass
class PreviewRequest:
    """Request for data preview."""

    object_id: str
    path: list[str]
    kind: str = "table"
    limit: int = DEFAULT_PREVIEW_LIMIT
    columns: list[str] | None = None  # SQL only
    filter: PreviewFilter | None = None
    sort: list[PreviewSort] | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any], path: list[str], kind: str) -> "PreviewRequest":
        limit = min(data.get("limit", DEFAULT_PREVIEW_LIMIT), MAX_PREVIEW_LIMIT)

        filter_data = data.get("filter")
        preview_filter = PreviewFilter.from_dict(filter_data) if filter_data else None

        sort_data = data.get("sort", [])
        preview_sort = [PreviewSort.from_dict(s) for s in sort_data] if sort_data else None

        return cls(
            object_id=data.get("objectId", ""),
            path=path,
            kind=kind,
            limit=limit,
            columns=data.get("columns"),
            filter=preview_filter,
            sort=preview_sort,
        )


@dataclass
class PreviewResult:
    """Result of a data preview operation."""

    object_id: str
    kind: str
    rows: list[dict[str, Any]] | None = None  # For SQL
    docs: list[dict[str, Any]] | None = None  # For MongoDB
    truncated: bool = False
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
            "truncated": self.truncated,
            "meta": self.meta,
        }

        if self.rows is not None:
            result["rows"] = self.rows
        if self.docs is not None:
            result["docs"] = self.docs

        return result


def validate_identifier(name: str) -> bool:
    """
    Validate that a name is a safe SQL identifier.

    Prevents SQL injection by ensuring names match a strict pattern.
    """
    if not name:
        return False
    # Allow quoted identifiers (will be properly escaped)
    if name.startswith('"') and name.endswith('"'):
        inner = name[1:-1]
        # Inner content shouldn't have unescaped quotes
        return '""' not in inner or inner.replace('""', '') != ''
    return bool(VALID_IDENTIFIER_PATTERN.match(name))


def quote_identifier(name: str, vendor: str) -> str:
    """
    Safely quote an identifier for the given database vendor.

    This is the ONLY way identifiers should be included in queries.
    """
    if not name:
        raise ValueError("Empty identifier")

    # Remove any existing quotes
    clean_name = name.strip('"').strip('`').strip('[').strip(']')

    # Validate the cleaned name
    if not VALID_IDENTIFIER_PATTERN.match(clean_name):
        raise ValueError(f"Invalid identifier: {name}")

    # Quote appropriately for vendor
    if vendor == "sqlserver":
        # SQL Server uses square brackets
        return f"[{clean_name}]"
    elif vendor == "mysql":
        # MySQL uses backticks
        return f"`{clean_name}`"
    else:
        # PostgreSQL, Oracle use double quotes
        return f'"{clean_name}"'


def validate_columns_against_schema(
    requested_columns: list[str] | None,
    schema_columns: list[str],
) -> tuple[list[str], DbError | None]:
    """
    Validate requested columns against the known schema.

    Returns the validated column list and any error.
    """
    if not requested_columns:
        return schema_columns, None

    schema_columns_lower = {c.lower(): c for c in schema_columns}
    validated = []
    invalid = []

    for col in requested_columns:
        col_lower = col.lower()
        if col_lower in schema_columns_lower:
            validated.append(schema_columns_lower[col_lower])
        else:
            invalid.append(col)

    if invalid:
        return [], DbError(
            DbErrorCode.UNKNOWN,
            f"Invalid columns: {', '.join(invalid)}. Available: {', '.join(schema_columns[:10])}{'...' if len(schema_columns) > 10 else ''}",
            None,
            False,
        )

    return validated, None


def build_sql_filter(
    filter_spec: PreviewFilter | None,
    vendor: str,
    param_style: str = "pyformat",  # "pyformat" (%s), "named" (:name), "qmark" (?)
) -> tuple[str, list[Any] | dict[str, Any]]:
    """
    Build a SQL WHERE clause from a filter specification.

    Returns (where_clause, parameters) where parameters match the param_style.
    """
    if not filter_spec:
        return "", [] if param_style == "qmark" else {}

    field_name = quote_identifier(filter_spec.field, vendor)
    filter_type = filter_spec.type.lower()

    if param_style == "qmark":
        placeholder = "?"
        params: list[Any] = []
    elif param_style == "named":
        placeholder = ":filter_value"
        params_dict: dict[str, Any] = {}
    else:  # pyformat
        placeholder = "%s"
        params = []

    if filter_type == "equals":
        clause = f"{field_name} = {placeholder}"
        if param_style == "named":
            params_dict["filter_value"] = filter_spec.value
        else:
            params.append(filter_spec.value)
    elif filter_type == "not_equals":
        clause = f"{field_name} != {placeholder}"
        if param_style == "named":
            params_dict["filter_value"] = filter_spec.value
        else:
            params.append(filter_spec.value)
    elif filter_type == "gt":
        clause = f"{field_name} > {placeholder}"
        if param_style == "named":
            params_dict["filter_value"] = filter_spec.value
        else:
            params.append(filter_spec.value)
    elif filter_type == "gte":
        clause = f"{field_name} >= {placeholder}"
        if param_style == "named":
            params_dict["filter_value"] = filter_spec.value
        else:
            params.append(filter_spec.value)
    elif filter_type == "lt":
        clause = f"{field_name} < {placeholder}"
        if param_style == "named":
            params_dict["filter_value"] = filter_spec.value
        else:
            params.append(filter_spec.value)
    elif filter_type == "lte":
        clause = f"{field_name} <= {placeholder}"
        if param_style == "named":
            params_dict["filter_value"] = filter_spec.value
        else:
            params.append(filter_spec.value)
    elif filter_type == "contains":
        # Use LIKE with escaped value
        like_value = f"%{filter_spec.value}%"
        clause = f"{field_name} LIKE {placeholder}"
        if param_style == "named":
            params_dict["filter_value"] = like_value
        else:
            params.append(like_value)
    elif filter_type == "is_null":
        clause = f"{field_name} IS NULL"
        # No parameter needed
        if param_style == "named":
            pass  # Empty params_dict
        else:
            pass  # Empty params list
    elif filter_type == "is_not_null":
        clause = f"{field_name} IS NOT NULL"
        # No parameter needed
    else:
        # Unknown filter type, default to equals
        clause = f"{field_name} = {placeholder}"
        if param_style == "named":
            params_dict["filter_value"] = filter_spec.value
        else:
            params.append(filter_spec.value)

    if param_style == "named":
        return f"WHERE {clause}", params_dict
    else:
        return f"WHERE {clause}", params


def build_sql_order_by(
    sort_specs: list[PreviewSort] | None,
    vendor: str,
    schema_columns: list[str],
) -> str:
    """
    Build a SQL ORDER BY clause from sort specifications.

    Validates sort fields against schema columns.
    """
    if not sort_specs:
        return ""

    schema_columns_lower = {c.lower(): c for c in schema_columns}
    order_parts = []

    for sort in sort_specs:
        field_lower = sort.field.lower()
        if field_lower not in schema_columns_lower:
            continue  # Skip invalid sort fields silently

        field_name = quote_identifier(schema_columns_lower[field_lower], vendor)
        direction = "DESC" if sort.dir.lower() == "desc" else "ASC"
        order_parts.append(f"{field_name} {direction}")

    if not order_parts:
        return ""

    return "ORDER BY " + ", ".join(order_parts)


def estimate_row_size(row: dict[str, Any]) -> int:
    """Estimate the JSON size of a row in bytes."""
    return len(json.dumps(row, default=str))


def preview_postgres(
    config: dict[str, Any],
    request: PreviewRequest,
    schema_columns: list[str],
    max_bytes: int = MAX_RESPONSE_BYTES,
) -> PreviewResult:
    """Preview data from a PostgreSQL table or view."""
    try:
        import psycopg
    except ImportError:
        try:
            import psycopg2 as psycopg  # type: ignore
        except ImportError:
            return PreviewResult(
                object_id=request.object_id,
                kind=request.kind,
                error=DbError(
                    DbErrorCode.UNSUPPORTED_FEATURE,
                    "PostgreSQL driver not installed.",
                    None,
                    False,
                ),
            )

    if len(request.path) != 3:
        return PreviewResult(
            object_id=request.object_id,
            kind=request.kind,
            error=DbError(
                DbErrorCode.UNKNOWN,
                "PostgreSQL path must be [database, schema, table]",
                None,
                False,
            ),
        )

    database, schema, table = request.path

    # Validate columns
    columns, col_error = validate_columns_against_schema(request.columns, schema_columns)
    if col_error:
        return PreviewResult(
            object_id=request.object_id,
            kind=request.kind,
            error=col_error,
        )

    host = config.get("host")
    port = config.get("port", DEFAULT_PORTS["postgres"])
    username = config.get("username")
    driver_opts = config.get("driverOptions", {})

    try:
        password = resolve_password(config.get("auth", {}))
    except SecretResolutionError as e:
        return PreviewResult(
            object_id=request.object_id,
            kind=request.kind,
            error=DbError(DbErrorCode.AUTH_FAILED, str(e), None, False),
        )

    connect_timeout = driver_opts.get("connectTimeoutMs", 30000) / 1000
    # Cast to int: this value is interpolated into `SET statement_timeout` below,
    # so a non-numeric config value must not reach the SQL string.
    statement_timeout = int(driver_opts.get("statementTimeoutMs", 60000))

    conn_params: dict[str, Any] = {
        "host": host,
        "port": port,
        "dbname": database,
        "user": username,
        "connect_timeout": int(connect_timeout),
    }
    if password:
        conn_params["password"] = password

    start_time = time.time()

    try:
        conn = psycopg.connect(**conn_params)
        try:
            cursor = conn.cursor()

            # Set statement timeout
            cursor.execute(f"SET statement_timeout = {statement_timeout}")

            # Build query parts
            column_list = ", ".join(quote_identifier(c, "postgres") for c in columns)
            schema_quoted = quote_identifier(schema, "postgres")
            table_quoted = quote_identifier(table, "postgres")

            # Build WHERE clause
            where_clause, params = build_sql_filter(request.filter, "postgres", "pyformat")

            # Build ORDER BY clause
            order_clause = build_sql_order_by(request.sort, "postgres", schema_columns)

            # Build full query
            query = f"SELECT {column_list} FROM {schema_quoted}.{table_quoted}"
            if where_clause:
                query += f" {where_clause}"
            if order_clause:
                query += f" {order_clause}"
            query += f" LIMIT {request.limit + 1}"  # +1 to detect truncation

            # Execute query
            if params:
                cursor.execute(query, params if isinstance(params, (list, tuple)) else list(params.values()))
            else:
                cursor.execute(query)

            # Fetch results with size limit
            rows: list[dict[str, Any]] = []
            total_bytes = 0
            truncated = False
            column_names = [desc[0] for desc in cursor.description]

            for row_tuple in cursor:
                row = dict(zip(column_names, row_tuple))

                # Convert non-JSON-serializable types
                for key, value in row.items():
                    if hasattr(value, 'isoformat'):
                        row[key] = value.isoformat()
                    elif isinstance(value, bytes):
                        row[key] = f"<binary:{len(value)} bytes>"
                    elif hasattr(value, '__str__') and not isinstance(value, (str, int, float, bool, type(None), list, dict)):
                        row[key] = str(value)

                row_size = estimate_row_size(row)
                if total_bytes + row_size > max_bytes:
                    truncated = True
                    break

                rows.append(row)
                total_bytes += row_size

                if len(rows) > request.limit:
                    truncated = True
                    rows = rows[:request.limit]
                    break

            elapsed_ms = (time.time() - start_time) * 1000

            return PreviewResult(
                object_id=request.object_id,
                kind=request.kind,
                rows=rows,
                truncated=truncated,
                meta={
                    "limit": request.limit,
                    "elapsedMs": round(elapsed_ms, 2),
                    "rowCount": len(rows),
                    "bytesEstimate": total_bytes,
                },
            )

        finally:
            conn.close()

    except Exception as e:
        error = normalize_db_error(e, "postgres")
        return PreviewResult(
            object_id=request.object_id,
            kind=request.kind,
            error=error,
        )


def preview_mysql(
    config: dict[str, Any],
    request: PreviewRequest,
    schema_columns: list[str],
    max_bytes: int = MAX_RESPONSE_BYTES,
) -> PreviewResult:
    """Preview data from a MySQL table or view."""
    try:
        import pymysql
    except ImportError:
        return PreviewResult(
            object_id=request.object_id,
            kind=request.kind,
            error=DbError(
                DbErrorCode.UNSUPPORTED_FEATURE,
                "MySQL driver not installed.",
                None,
                False,
            ),
        )

    if len(request.path) != 2:
        return PreviewResult(
            object_id=request.object_id,
            kind=request.kind,
            error=DbError(
                DbErrorCode.UNKNOWN,
                "MySQL path must be [database, table]",
                None,
                False,
            ),
        )

    database, table = request.path

    # Validate columns
    columns, col_error = validate_columns_against_schema(request.columns, schema_columns)
    if col_error:
        return PreviewResult(
            object_id=request.object_id,
            kind=request.kind,
            error=col_error,
        )

    host = config.get("host")
    port = config.get("port", DEFAULT_PORTS["mysql"])
    username = config.get("username")
    driver_opts = config.get("driverOptions", {})

    try:
        password = resolve_password(config.get("auth", {}))
    except SecretResolutionError as e:
        return PreviewResult(
            object_id=request.object_id,
            kind=request.kind,
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

    start_time = time.time()

    try:
        conn = pymysql.connect(**conn_params)
        try:
            cursor = conn.cursor()

            # Build query parts
            column_list = ", ".join(quote_identifier(c, "mysql") for c in columns)
            table_quoted = quote_identifier(table, "mysql")

            # Build WHERE clause
            where_clause, params = build_sql_filter(request.filter, "mysql", "pyformat")

            # Build ORDER BY clause
            order_clause = build_sql_order_by(request.sort, "mysql", schema_columns)

            # Build full query
            query = f"SELECT {column_list} FROM {table_quoted}"
            if where_clause:
                query += f" {where_clause}"
            if order_clause:
                query += f" {order_clause}"
            query += f" LIMIT {request.limit + 1}"

            # Execute query
            if params:
                cursor.execute(query, params if isinstance(params, (list, tuple)) else list(params.values()))
            else:
                cursor.execute(query)

            # Fetch results with size limit
            rows: list[dict[str, Any]] = []
            total_bytes = 0
            truncated = False
            column_names = [desc[0] for desc in cursor.description]

            for row_tuple in cursor:
                row = dict(zip(column_names, row_tuple))

                # Convert non-JSON-serializable types
                for key, value in row.items():
                    if hasattr(value, 'isoformat'):
                        row[key] = value.isoformat()
                    elif isinstance(value, bytes):
                        row[key] = f"<binary:{len(value)} bytes>"
                    elif hasattr(value, '__str__') and not isinstance(value, (str, int, float, bool, type(None), list, dict)):
                        row[key] = str(value)

                row_size = estimate_row_size(row)
                if total_bytes + row_size > max_bytes:
                    truncated = True
                    break

                rows.append(row)
                total_bytes += row_size

                if len(rows) > request.limit:
                    truncated = True
                    rows = rows[:request.limit]
                    break

            elapsed_ms = (time.time() - start_time) * 1000

            return PreviewResult(
                object_id=request.object_id,
                kind=request.kind,
                rows=rows,
                truncated=truncated,
                meta={
                    "limit": request.limit,
                    "elapsedMs": round(elapsed_ms, 2),
                    "rowCount": len(rows),
                    "bytesEstimate": total_bytes,
                },
            )

        finally:
            conn.close()

    except Exception as e:
        error = normalize_db_error(e, "mysql")
        return PreviewResult(
            object_id=request.object_id,
            kind=request.kind,
            error=error,
        )


def preview_sqlserver(
    config: dict[str, Any],
    request: PreviewRequest,
    schema_columns: list[str],
    max_bytes: int = MAX_RESPONSE_BYTES,
) -> PreviewResult:
    """Preview data from a SQL Server table or view."""
    try:
        import pyodbc
        driver_name = "pyodbc"
    except ImportError:
        try:
            import pymssql
            driver_name = "pymssql"
        except ImportError:
            return PreviewResult(
                object_id=request.object_id,
                kind=request.kind,
                error=DbError(
                    DbErrorCode.UNSUPPORTED_FEATURE,
                    "SQL Server driver not installed.",
                    None,
                    False,
                ),
            )

    if len(request.path) != 3:
        return PreviewResult(
            object_id=request.object_id,
            kind=request.kind,
            error=DbError(
                DbErrorCode.UNKNOWN,
                "SQL Server path must be [database, schema, table]",
                None,
                False,
            ),
        )

    database, schema, table = request.path

    # Validate columns
    columns, col_error = validate_columns_against_schema(request.columns, schema_columns)
    if col_error:
        return PreviewResult(
            object_id=request.object_id,
            kind=request.kind,
            error=col_error,
        )

    host = config.get("host")
    port = config.get("port", DEFAULT_PORTS["sqlserver"])
    username = config.get("username")
    instance = config.get("instance")
    driver_opts = config.get("driverOptions", {})

    try:
        password = resolve_password(config.get("auth", {}))
    except SecretResolutionError as e:
        return PreviewResult(
            object_id=request.object_id,
            kind=request.kind,
            error=DbError(DbErrorCode.AUTH_FAILED, str(e), None, False),
        )

    connect_timeout = int(driver_opts.get("connectTimeoutMs", 30000) / 1000)

    start_time = time.time()

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
                return PreviewResult(
                    object_id=request.object_id,
                    kind=request.kind,
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

            # Build query parts
            column_list = ", ".join(quote_identifier(c, "sqlserver") for c in columns)
            schema_quoted = quote_identifier(schema, "sqlserver")
            table_quoted = quote_identifier(table, "sqlserver")

            # Build WHERE clause (SQL Server uses ? for parameters)
            where_clause, params = build_sql_filter(request.filter, "sqlserver", "qmark")

            # Build ORDER BY clause
            order_clause = build_sql_order_by(request.sort, "sqlserver", schema_columns)

            # Build full query with TOP (SQL Server style)
            query = f"SELECT TOP {request.limit + 1} {column_list} FROM {schema_quoted}.{table_quoted}"
            if where_clause:
                query += f" {where_clause}"
            if order_clause:
                query += f" {order_clause}"

            # Execute query
            if params:
                cursor.execute(query, params)
            else:
                cursor.execute(query)

            # Fetch results with size limit
            rows: list[dict[str, Any]] = []
            total_bytes = 0
            truncated = False
            column_names = [desc[0] for desc in cursor.description]

            for row_tuple in cursor:
                row = dict(zip(column_names, row_tuple))

                # Convert non-JSON-serializable types
                for key, value in row.items():
                    if hasattr(value, 'isoformat'):
                        row[key] = value.isoformat()
                    elif isinstance(value, bytes):
                        row[key] = f"<binary:{len(value)} bytes>"
                    elif hasattr(value, '__str__') and not isinstance(value, (str, int, float, bool, type(None), list, dict)):
                        row[key] = str(value)

                row_size = estimate_row_size(row)
                if total_bytes + row_size > max_bytes:
                    truncated = True
                    break

                rows.append(row)
                total_bytes += row_size

                if len(rows) > request.limit:
                    truncated = True
                    rows = rows[:request.limit]
                    break

            elapsed_ms = (time.time() - start_time) * 1000

            return PreviewResult(
                object_id=request.object_id,
                kind=request.kind,
                rows=rows,
                truncated=truncated,
                meta={
                    "limit": request.limit,
                    "elapsedMs": round(elapsed_ms, 2),
                    "rowCount": len(rows),
                    "bytesEstimate": total_bytes,
                },
            )

        finally:
            conn.close()

    except Exception as e:
        error = normalize_db_error(e, "sqlserver")
        return PreviewResult(
            object_id=request.object_id,
            kind=request.kind,
            error=error,
        )


def preview_oracle(
    config: dict[str, Any],
    request: PreviewRequest,
    schema_columns: list[str],
    max_bytes: int = MAX_RESPONSE_BYTES,
) -> PreviewResult:
    """Preview data from an Oracle table or view."""
    try:
        import oracledb
    except ImportError:
        try:
            import cx_Oracle as oracledb  # type: ignore
        except ImportError:
            return PreviewResult(
                object_id=request.object_id,
                kind=request.kind,
                error=DbError(
                    DbErrorCode.UNSUPPORTED_FEATURE,
                    "Oracle driver not installed.",
                    None,
                    False,
                ),
            )

    if len(request.path) != 3:
        return PreviewResult(
            object_id=request.object_id,
            kind=request.kind,
            error=DbError(
                DbErrorCode.UNKNOWN,
                "Oracle path must be [service, schema, table]",
                None,
                False,
            ),
        )

    service, schema, table = request.path

    # Validate columns
    columns, col_error = validate_columns_against_schema(request.columns, schema_columns)
    if col_error:
        return PreviewResult(
            object_id=request.object_id,
            kind=request.kind,
            error=col_error,
        )

    host = config.get("host")
    port = config.get("port", DEFAULT_PORTS["oracle"])
    username = config.get("username")
    service_name = config.get("serviceName")
    sid = config.get("sid")
    connect_string = config.get("connectString")

    try:
        password = resolve_password(config.get("auth", {}))
    except SecretResolutionError as e:
        return PreviewResult(
            object_id=request.object_id,
            kind=request.kind,
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
        return PreviewResult(
            object_id=request.object_id,
            kind=request.kind,
            error=DbError(
                DbErrorCode.UNKNOWN,
                "Oracle configuration requires serviceName, sid, or connectString",
                None,
                False,
            ),
        )

    start_time = time.time()

    try:
        conn = oracledb.connect(user=username, password=password or "", dsn=dsn)

        try:
            cursor = conn.cursor()

            # Build query parts
            column_list = ", ".join(quote_identifier(c, "oracle") for c in columns)
            schema_quoted = quote_identifier(schema, "oracle")
            table_quoted = quote_identifier(table, "oracle")

            # Build WHERE clause (Oracle uses :name for parameters)
            where_clause, params = build_sql_filter(request.filter, "oracle", "named")

            # Build ORDER BY clause
            order_clause = build_sql_order_by(request.sort, "oracle", schema_columns)

            # Build full query with FETCH FIRST (Oracle 12c+)
            query = f"SELECT {column_list} FROM {schema_quoted}.{table_quoted}"
            if where_clause:
                query += f" {where_clause}"
            if order_clause:
                query += f" {order_clause}"
            query += f" FETCH FIRST {request.limit + 1} ROWS ONLY"

            # Execute query
            if params:
                cursor.execute(query, params)
            else:
                cursor.execute(query)

            # Fetch results with size limit
            rows: list[dict[str, Any]] = []
            total_bytes = 0
            truncated = False
            column_names = [desc[0] for desc in cursor.description]

            for row_tuple in cursor:
                row = dict(zip(column_names, row_tuple))

                # Convert non-JSON-serializable types
                for key, value in row.items():
                    if hasattr(value, 'isoformat'):
                        row[key] = value.isoformat()
                    elif isinstance(value, bytes):
                        row[key] = f"<binary:{len(value)} bytes>"
                    elif hasattr(value, 'read'):
                        # LOB types
                        row[key] = "<LOB>"
                    elif hasattr(value, '__str__') and not isinstance(value, (str, int, float, bool, type(None), list, dict)):
                        row[key] = str(value)

                row_size = estimate_row_size(row)
                if total_bytes + row_size > max_bytes:
                    truncated = True
                    break

                rows.append(row)
                total_bytes += row_size

                if len(rows) > request.limit:
                    truncated = True
                    rows = rows[:request.limit]
                    break

            elapsed_ms = (time.time() - start_time) * 1000

            return PreviewResult(
                object_id=request.object_id,
                kind=request.kind,
                rows=rows,
                truncated=truncated,
                meta={
                    "limit": request.limit,
                    "elapsedMs": round(elapsed_ms, 2),
                    "rowCount": len(rows),
                    "bytesEstimate": total_bytes,
                },
            )

        finally:
            conn.close()

    except Exception as e:
        error = normalize_db_error(e, "oracle")
        return PreviewResult(
            object_id=request.object_id,
            kind=request.kind,
            error=error,
        )


def build_mongo_filter(filter_spec: PreviewFilter | None) -> dict[str, Any]:
    """Build a MongoDB filter from a filter specification."""
    if not filter_spec:
        return {}

    field = filter_spec.field
    value = filter_spec.value
    filter_type = filter_spec.type.lower()

    if filter_type == "equals":
        return {field: value}
    elif filter_type == "not_equals":
        return {field: {"$ne": value}}
    elif filter_type == "gt":
        return {field: {"$gt": value}}
    elif filter_type == "gte":
        return {field: {"$gte": value}}
    elif filter_type == "lt":
        return {field: {"$lt": value}}
    elif filter_type == "lte":
        return {field: {"$lte": value}}
    elif filter_type == "contains":
        # Use regex for contains
        return {field: {"$regex": re.escape(str(value)), "$options": "i"}}
    elif filter_type == "is_null":
        return {field: None}
    elif filter_type == "is_not_null":
        return {field: {"$ne": None}}
    else:
        return {field: value}


def build_mongo_sort(sort_specs: list[PreviewSort] | None) -> list[tuple[str, int]] | None:
    """Build a MongoDB sort specification."""
    if not sort_specs:
        return None

    sort_list = []
    for sort in sort_specs:
        direction = -1 if sort.dir.lower() == "desc" else 1
        sort_list.append((sort.field, direction))

    return sort_list if sort_list else None


def preview_mongodb(
    config: dict[str, Any],
    request: PreviewRequest,
    schema_fields: list[str] | None = None,  # Optional field list for projection
    max_bytes: int = MAX_RESPONSE_BYTES,
) -> PreviewResult:
    """Preview data from a MongoDB collection."""
    try:
        from pymongo import MongoClient
        from pymongo.errors import PyMongoError
    except ImportError:
        return PreviewResult(
            object_id=request.object_id,
            kind=request.kind,
            error=DbError(
                DbErrorCode.UNSUPPORTED_FEATURE,
                "MongoDB driver not installed.",
                None,
                False,
            ),
        )

    if len(request.path) != 2:
        return PreviewResult(
            object_id=request.object_id,
            kind=request.kind,
            error=DbError(
                DbErrorCode.UNKNOWN,
                "MongoDB path must be [database, collection]",
                None,
                False,
            ),
        )

    database, collection = request.path

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
        return PreviewResult(
            object_id=request.object_id,
            kind=request.kind,
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

    start_time = time.time()

    try:
        client = MongoClient(**client_params)

        try:
            db = client[database]
            coll = db[collection]

            # Build query
            mongo_filter = build_mongo_filter(request.filter)
            mongo_sort = build_mongo_sort(request.sort)

            # Build projection if columns specified
            projection = None
            if request.columns:
                projection = {col: 1 for col in request.columns}
                # Always include _id unless explicitly excluded
                if "_id" not in request.columns:
                    projection["_id"] = 0

            # Execute query
            cursor = coll.find(mongo_filter, projection)
            if mongo_sort:
                cursor = cursor.sort(mongo_sort)
            cursor = cursor.limit(request.limit + 1)

            # Fetch results with size limit
            docs: list[dict[str, Any]] = []
            total_bytes = 0
            truncated = False

            for doc in cursor:
                # Convert ObjectId and other BSON types
                clean_doc: dict[str, Any] = {}
                for key, value in doc.items():
                    if hasattr(value, 'isoformat'):
                        clean_doc[key] = value.isoformat()
                    elif type(value).__name__ == "ObjectId":
                        clean_doc[key] = str(value)
                    elif isinstance(value, bytes):
                        clean_doc[key] = f"<binary:{len(value)} bytes>"
                    elif isinstance(value, (dict, list)):
                        # Recursively convert nested objects
                        clean_doc[key] = json.loads(json.dumps(value, default=str))
                    else:
                        clean_doc[key] = value

                doc_size = estimate_row_size(clean_doc)
                if total_bytes + doc_size > max_bytes:
                    truncated = True
                    break

                docs.append(clean_doc)
                total_bytes += doc_size

                if len(docs) > request.limit:
                    truncated = True
                    docs = docs[:request.limit]
                    break

            elapsed_ms = (time.time() - start_time) * 1000

            return PreviewResult(
                object_id=request.object_id,
                kind="collection",
                docs=docs,
                truncated=truncated,
                meta={
                    "limit": request.limit,
                    "elapsedMs": round(elapsed_ms, 2),
                    "docCount": len(docs),
                    "bytesEstimate": total_bytes,
                },
            )

        finally:
            client.close()

    except PyMongoError as e:
        error = normalize_db_error(e, "mongodb")
        return PreviewResult(
            object_id=request.object_id,
            kind="collection",
            error=error,
        )
    except Exception as e:
        error = normalize_db_error(e, "mongodb")
        return PreviewResult(
            object_id=request.object_id,
            kind="collection",
            error=error,
        )


def preview_data(
    config: dict[str, Any],
    request: PreviewRequest,
    schema_columns: list[str] | None = None,
    max_bytes: int = MAX_RESPONSE_BYTES,
) -> PreviewResult:
    """
    Preview data from a database object.

    Args:
        config: Database source configuration
        request: Preview request with path, limit, columns, filter, sort
        schema_columns: List of known columns (for validation)
        max_bytes: Maximum response size in bytes

    Returns:
        PreviewResult with rows (SQL) or docs (MongoDB)
    """
    db_type = config.get("type")

    # Use default columns if not provided
    if schema_columns is None:
        schema_columns = []

    if db_type == "postgres":
        return preview_postgres(config, request, schema_columns, max_bytes)
    elif db_type == "mysql":
        return preview_mysql(config, request, schema_columns, max_bytes)
    elif db_type == "sqlserver":
        return preview_sqlserver(config, request, schema_columns, max_bytes)
    elif db_type == "oracle":
        return preview_oracle(config, request, schema_columns, max_bytes)
    elif db_type == "mongodb":
        return preview_mongodb(config, request, schema_columns, max_bytes)
    else:
        return PreviewResult(
            object_id=request.object_id,
            kind=request.kind,
            error=DbError(
                DbErrorCode.UNSUPPORTED_FEATURE,
                f"Preview not supported for database type: {db_type}",
                None,
                False,
            ),
        )
