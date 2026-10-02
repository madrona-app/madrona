"""
Base class for database source connectors.

Provides common functionality for database connectivity:
- Connection configuration parsing
- Schema/table discovery
- Safe preview with row limits
- Connection testing

This module does NOT implement:
- Scheduling or sync orchestration
- CDC (Change Data Capture)
- Checkpointing or incremental sync
- Data transformation or canonical mapping

Per Madrona API Contract v1.1, database connectors are source connectors
that provide structured data access. The actual data extraction and
normalization should be implemented by subclasses or the pipeline layer.
"""

import logging
from abc import abstractmethod
from typing import Any, Literal

from app.connectors.base import BaseSourceConnector
from app.schemas.database_source import (
    DATABASE_CONFIG_SCHEMAS,
    DATABASE_DISPLAY_NAMES,
    DEFAULT_PORTS,
    get_database_capabilities,
    validate_database_config,
)

logger = logging.getLogger(__name__)


class BaseDatabaseConnector(BaseSourceConnector):
    """
    Base class for database source connectors.

    Subclasses must implement:
    - _create_connection(): Create database-specific connection
    - _close_connection(): Close the connection
    - _test_connection(): Verify connectivity
    - _discover_schemas(): List available schemas (if supported)
    - _discover_tables(): List tables/collections
    - _discover_columns(): Get column metadata for a table
    - _preview_table(): Get sample rows from a table

    The extract() and normalize() methods are not implemented here as they
    depend on pipeline-level decisions (which tables to extract, how to
    map to canonical format). Subclasses can implement these for specific
    use cases.
    """

    direction: Literal["source"] = "source"
    db_type: str  # Set by subclass

    def __init__(self, config: dict[str, Any], organization_id: str):
        """Initialize database connector with configuration."""
        self._connection = None
        super().__init__(config, organization_id)

    def validate_config(self) -> None:
        """
        Validate database configuration.

        Checks both JSON schema compliance and semantic rules.
        """
        is_valid, errors = validate_database_config(self.config, self.db_type)
        if not is_valid:
            raise ValueError(f"Invalid database configuration: {'; '.join(errors)}")

        # Validate database type matches connector
        config_type = self.config.get("type")
        if config_type and config_type != self.db_type:
            raise ValueError(
                f"Configuration type '{config_type}' does not match connector type '{self.db_type}'"
            )

    @property
    def host(self) -> str:
        """Database host from configuration."""
        return self.config.get("host", "")

    @property
    def port(self) -> int:
        """Database port from configuration."""
        return self.config.get("port", DEFAULT_PORTS.get(self.db_type, 5432))

    @property
    def database(self) -> str | None:
        """Database name from configuration."""
        return self.config.get("database")

    @property
    def username(self) -> str | None:
        """Username from configuration."""
        return self.config.get("username")

    @property
    def password(self) -> str | None:
        """
        Get password from configuration.

        Handles both inline password and secretRef patterns.
        For secretRef, the actual secret resolution is delegated to
        the platform's secret service (not implemented here).
        """
        auth = self.config.get("auth", {})

        # Direct password
        if auth.get("password"):
            return auth["password"]

        # Secret reference - would be resolved by secret service
        if auth.get("secretRef"):
            # In production, this would call the secret service
            # For now, log a warning
            logger.warning(
                "secretRef detected but secret resolution not implemented. "
                "Use inline password for testing or implement secret service integration."
            )
            return None

        return None

    @property
    def tls_config(self) -> dict[str, Any]:
        """TLS configuration from config."""
        return self.config.get("tls", {"mode": "prefer"})

    @property
    def driver_options(self) -> dict[str, Any]:
        """Driver options from config."""
        return self.config.get("driverOptions", {})

    @property
    def connect_timeout_ms(self) -> int:
        """Connection timeout in milliseconds."""
        return self.driver_options.get("connectTimeoutMs", 30000)

    @property
    def statement_timeout_ms(self) -> int:
        """Statement timeout in milliseconds."""
        return self.driver_options.get("statementTimeoutMs", 60000)

    @property
    def max_pool_size(self) -> int:
        """Maximum connection pool size."""
        return self.driver_options.get("maxPoolSize", 5)

    def get_capabilities(self) -> dict[str, Any]:
        """Get capabilities for this database type."""
        return get_database_capabilities(self.db_type)

    def _get_ssl_context(self) -> Any:
        """
        Build SSL context based on TLS configuration.

        Returns appropriate SSL settings for the database driver.
        """
        tls_mode = self.tls_config.get("mode", "prefer")

        if tls_mode == "disable":
            return None
        elif tls_mode in ("allow", "prefer"):
            return "prefer"
        elif tls_mode == "require":
            return "require"
        elif tls_mode in ("verify-ca", "verify-full"):
            return "verify-full"

        return "prefer"

    # Abstract methods for subclasses to implement

    @abstractmethod
    def _create_connection(self) -> Any:
        """
        Create a database connection.

        Returns:
            Database connection object (type depends on driver)
        """
        pass

    @abstractmethod
    def _close_connection(self) -> None:
        """Close the database connection."""
        pass

    @abstractmethod
    def test_connection(self) -> tuple[bool, str | None]:
        """
        Test database connectivity.

        Returns:
            Tuple of (success, error_message)
        """
        pass

    @abstractmethod
    def discover_schemas(self) -> list[dict[str, Any]]:
        """
        Discover available schemas in the database.

        Returns:
            List of schema info dicts: [{"name": "public", "owner": "postgres"}, ...]
        """
        pass

    @abstractmethod
    def discover_tables(
        self, schema: str | None = None, include_views: bool = True
    ) -> list[dict[str, Any]]:
        """
        Discover tables and optionally views in the database.

        Args:
            schema: Schema name to filter by (database-specific)
            include_views: Whether to include views

        Returns:
            List of table info dicts:
            [
                {
                    "schema": "public",
                    "name": "users",
                    "type": "table",  # or "view"
                    "row_count_estimate": 1000000,
                },
                ...
            ]
        """
        pass

    @abstractmethod
    def discover_columns(
        self, table: str, schema: str | None = None
    ) -> list[dict[str, Any]]:
        """
        Discover columns for a table.

        Args:
            table: Table name
            schema: Schema name (if applicable)

        Returns:
            List of column info dicts:
            [
                {
                    "name": "id",
                    "type": "integer",
                    "nullable": False,
                    "primary_key": True,
                    "default": "nextval('users_id_seq')",
                },
                ...
            ]
        """
        pass

    @abstractmethod
    def preview_table(
        self,
        table: str,
        schema: str | None = None,
        limit: int = 100,
        columns: list[str] | None = None,
    ) -> dict[str, Any]:
        """
        Get a preview of table data.

        Args:
            table: Table name
            schema: Schema name (if applicable)
            limit: Maximum rows to return
            columns: Specific columns to include (None for all)

        Returns:
            Preview result dict:
            {
                "columns": ["id", "name", "created_at"],
                "rows": [[1, "Alice", "2024-01-01"], ...],
                "row_count": 100,
                "truncated": True,  # True if more rows exist
            }
        """
        pass

    # BaseSourceConnector interface - minimal implementation

    def extract(
        self, cursor: dict[str, Any] | None = None, limit: int | None = None
    ):
        """
        Extract records from the database.

        This base implementation raises NotImplementedError because database
        extraction requires table/query specification at the pipeline level.
        Subclasses can implement specific extraction logic.
        """
        raise NotImplementedError(
            "Database extraction requires table/query specification. "
            "Use discover_tables() and preview_table() for exploration, "
            "or implement extract() in a subclass for specific extraction needs."
        )

    def normalize(self, record: dict[str, Any]) -> dict[str, Any]:
        """
        Normalize a database record to canonical format.

        This base implementation raises NotImplementedError because
        normalization requires canonical mapping configuration.
        """
        raise NotImplementedError(
            "Database record normalization requires canonical mapping configuration. "
            "Implement normalize() in a subclass or use pipeline-level transformation."
        )


# =============================================================================
# PostgreSQL Connector
# =============================================================================

class PostgresConnector(BaseDatabaseConnector):
    """
    PostgreSQL database connector using psycopg3.

    Supports:
    - Schema discovery
    - Table/view discovery with row count estimates
    - Column metadata including primary keys
    - Data preview with configurable limits
    """

    db_type = "postgres"

    def _create_connection(self) -> Any:
        """Create PostgreSQL connection using psycopg."""
        try:
            import psycopg
        except ImportError:
            raise ImportError(
                "psycopg is required for PostgreSQL connections. "
                "Install with: pip install 'psycopg[binary]'"
            )

        # Build connection parameters
        conn_params = {
            "host": self.host,
            "port": self.port,
            "dbname": self.database,
            "user": self.username,
            "connect_timeout": self.connect_timeout_ms // 1000,
        }

        if self.password:
            conn_params["password"] = self.password

        # Handle SSL mode
        ssl_mode = self._get_ssl_context()
        if ssl_mode:
            conn_params["sslmode"] = ssl_mode

        self._connection = psycopg.connect(**conn_params)
        return self._connection

    def _close_connection(self) -> None:
        """Close PostgreSQL connection."""
        if self._connection:
            self._connection.close()
            self._connection = None

    def _ensure_connection(self) -> Any:
        """Ensure we have an active connection."""
        if self._connection is None or self._connection.closed:
            self._create_connection()
        return self._connection

    def test_connection(self) -> tuple[bool, str | None]:
        """Test PostgreSQL connectivity."""
        try:
            conn = self._create_connection()
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                cur.fetchone()
            self._close_connection()
            return True, None
        except Exception as e:
            self._close_connection()
            return False, str(e)

    def discover_schemas(self) -> list[dict[str, Any]]:
        """Discover PostgreSQL schemas."""
        conn = self._ensure_connection()

        query = """
            SELECT
                schema_name,
                schema_owner
            FROM information_schema.schemata
            WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
              AND schema_name NOT LIKE 'pg_temp_%'
              AND schema_name NOT LIKE 'pg_toast_temp_%'
            ORDER BY schema_name
        """

        schemas = []
        with conn.cursor() as cur:
            cur.execute(query)
            for row in cur.fetchall():
                schemas.append({
                    "name": row[0],
                    "owner": row[1],
                })

        return schemas

    def discover_tables(
        self, schema: str | None = None, include_views: bool = True
    ) -> list[dict[str, Any]]:
        """Discover PostgreSQL tables and views."""
        conn = self._ensure_connection()

        # Build query for tables and optionally views
        table_types = ["'BASE TABLE'"]
        if include_views:
            table_types.append("'VIEW'")

        query = f"""
            SELECT
                t.table_schema,
                t.table_name,
                t.table_type,
                COALESCE(
                    (SELECT reltuples::bigint
                     FROM pg_class c
                     JOIN pg_namespace n ON c.relnamespace = n.oid
                     WHERE n.nspname = t.table_schema
                       AND c.relname = t.table_name),
                    0
                ) as row_count_estimate
            FROM information_schema.tables t
            WHERE t.table_type IN ({', '.join(table_types)})
              AND t.table_schema NOT IN ('pg_catalog', 'information_schema')
              {'AND t.table_schema = %s' if schema else ''}
            ORDER BY t.table_schema, t.table_name
        """

        tables = []
        with conn.cursor() as cur:
            if schema:
                cur.execute(query, (schema,))
            else:
                cur.execute(query)

            for row in cur.fetchall():
                tables.append({
                    "schema": row[0],
                    "name": row[1],
                    "type": "table" if row[2] == "BASE TABLE" else "view",
                    "row_count_estimate": max(0, row[3]) if row[3] else 0,
                })

        return tables

    def discover_columns(
        self, table: str, schema: str | None = None
    ) -> list[dict[str, Any]]:
        """Discover PostgreSQL columns with primary key info."""
        conn = self._ensure_connection()
        schema = schema or "public"

        query = """
            SELECT
                c.column_name,
                c.data_type,
                c.is_nullable = 'YES' as nullable,
                c.column_default,
                c.character_maximum_length,
                c.numeric_precision,
                c.numeric_scale,
                COALESCE(
                    (SELECT TRUE
                     FROM information_schema.table_constraints tc
                     JOIN information_schema.key_column_usage kcu
                       ON tc.constraint_name = kcu.constraint_name
                       AND tc.table_schema = kcu.table_schema
                     WHERE tc.constraint_type = 'PRIMARY KEY'
                       AND tc.table_schema = c.table_schema
                       AND tc.table_name = c.table_name
                       AND kcu.column_name = c.column_name),
                    FALSE
                ) as primary_key,
                c.ordinal_position
            FROM information_schema.columns c
            WHERE c.table_schema = %s AND c.table_name = %s
            ORDER BY c.ordinal_position
        """

        columns = []
        with conn.cursor() as cur:
            cur.execute(query, (schema, table))

            for row in cur.fetchall():
                col_info = {
                    "name": row[0],
                    "type": row[1],
                    "nullable": row[2],
                    "default": row[3],
                    "primary_key": row[7],
                    "ordinal_position": row[8],
                }

                # Add length/precision info if available
                if row[4]:  # character_maximum_length
                    col_info["max_length"] = row[4]
                if row[5]:  # numeric_precision
                    col_info["precision"] = row[5]
                if row[6]:  # numeric_scale
                    col_info["scale"] = row[6]

                columns.append(col_info)

        return columns

    def preview_table(
        self,
        table: str,
        schema: str | None = None,
        limit: int = 100,
        columns: list[str] | None = None,
    ) -> dict[str, Any]:
        """Preview PostgreSQL table data."""
        conn = self._ensure_connection()
        schema = schema or "public"

        # Build column list (sanitized)
        if columns:
            # Quote column names to handle reserved words
            col_list = ", ".join(f'"{col}"' for col in columns)
        else:
            col_list = "*"

        # Quote identifiers
        qualified_table = f'"{schema}"."{table}"'

        # Get total count for truncation detection
        count_query = f"SELECT COUNT(*) FROM {qualified_table}"

        # Get preview data
        preview_query = f"SELECT {col_list} FROM {qualified_table} LIMIT %s"

        with conn.cursor() as cur:
            # Get total count
            cur.execute(count_query)
            total_count = cur.fetchone()[0]

            # Get preview rows
            cur.execute(preview_query, (limit,))

            # Get column names from cursor description
            col_names = [desc[0] for desc in cur.description]

            # Fetch rows and convert to serializable format
            rows = []
            for row in cur.fetchall():
                serialized_row = []
                for val in row:
                    # Convert non-serializable types
                    if val is None:
                        serialized_row.append(None)
                    elif isinstance(val, (bytes, bytearray)):
                        serialized_row.append(f"<binary {len(val)} bytes>")
                    elif hasattr(val, 'isoformat'):  # datetime/date/time
                        serialized_row.append(val.isoformat())
                    else:
                        serialized_row.append(val)
                rows.append(serialized_row)

        return {
            "columns": col_names,
            "rows": rows,
            "row_count": len(rows),
            "total_count": total_count,
            "truncated": total_count > limit,
        }


# =============================================================================
# MySQL Connector
# =============================================================================

class MySQLConnector(BaseDatabaseConnector):
    """
    MySQL/MariaDB database connector using PyMySQL.

    Supports:
    - Database discovery (MySQL databases act as schemas)
    - Table/view discovery
    - Column metadata
    - Data preview
    """

    db_type = "mysql"

    def _create_connection(self) -> Any:
        """Create MySQL connection."""
        try:
            import pymysql
        except ImportError:
            raise ImportError(
                "PyMySQL is required for MySQL connections. "
                "Install with: pip install pymysql"
            )

        conn_params = {
            "host": self.host,
            "port": self.port,
            "database": self.database,
            "user": self.username,
            "connect_timeout": self.connect_timeout_ms // 1000,
        }

        if self.password:
            conn_params["password"] = self.password

        # Handle SSL
        ssl_mode = self.tls_config.get("mode", "prefer")
        if ssl_mode == "disable":
            conn_params["ssl_disabled"] = True
        elif ssl_mode in ("require", "verify-ca", "verify-full"):
            conn_params["ssl_disabled"] = False
            if ssl_mode in ("verify-ca", "verify-full"):
                conn_params["ssl_verify_cert"] = True

        self._connection = pymysql.connect(**conn_params)
        return self._connection

    def _close_connection(self) -> None:
        """Close MySQL connection."""
        if self._connection:
            self._connection.close()
            self._connection = None

    def _ensure_connection(self) -> Any:
        """Ensure we have an active connection."""
        # PyMySQL exposes liveness as the `open` attribute; mysql-connector used
        # an is_connected() method.
        if self._connection is None or not self._connection.open:
            self._create_connection()
        return self._connection

    def test_connection(self) -> tuple[bool, str | None]:
        """Test MySQL connectivity."""
        try:
            conn = self._create_connection()
            cursor = conn.cursor()
            cursor.execute("SELECT 1")
            cursor.fetchone()
            cursor.close()
            self._close_connection()
            return True, None
        except Exception as e:
            self._close_connection()
            return False, str(e)

    def discover_schemas(self) -> list[dict[str, Any]]:
        """MySQL uses databases as schemas."""
        conn = self._ensure_connection()

        query = """
            SELECT SCHEMA_NAME
            FROM information_schema.SCHEMATA
            WHERE SCHEMA_NAME NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
            ORDER BY SCHEMA_NAME
        """

        schemas = []
        cursor = conn.cursor()
        cursor.execute(query)
        for row in cursor.fetchall():
            schemas.append({
                "name": row[0],
                "owner": None,  # MySQL doesn't have schema owners
            })
        cursor.close()

        return schemas

    def discover_tables(
        self, schema: str | None = None, include_views: bool = True
    ) -> list[dict[str, Any]]:
        """Discover MySQL tables and views."""
        conn = self._ensure_connection()
        database = schema or self.database

        table_types = ["'BASE TABLE'"]
        if include_views:
            table_types.append("'VIEW'")

        query = f"""
            SELECT
                TABLE_SCHEMA,
                TABLE_NAME,
                TABLE_TYPE,
                TABLE_ROWS
            FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = %s
              AND TABLE_TYPE IN ({', '.join(table_types)})
            ORDER BY TABLE_NAME
        """

        tables = []
        cursor = conn.cursor()
        cursor.execute(query, (database,))
        for row in cursor.fetchall():
            tables.append({
                "schema": row[0],
                "name": row[1],
                "type": "table" if row[2] == "BASE TABLE" else "view",
                "row_count_estimate": row[3] or 0,
            })
        cursor.close()

        return tables

    def discover_columns(
        self, table: str, schema: str | None = None
    ) -> list[dict[str, Any]]:
        """Discover MySQL columns."""
        conn = self._ensure_connection()
        database = schema or self.database

        query = """
            SELECT
                COLUMN_NAME,
                DATA_TYPE,
                IS_NULLABLE = 'YES' as nullable,
                COLUMN_DEFAULT,
                CHARACTER_MAXIMUM_LENGTH,
                NUMERIC_PRECISION,
                NUMERIC_SCALE,
                COLUMN_KEY = 'PRI' as primary_key,
                ORDINAL_POSITION
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s
            ORDER BY ORDINAL_POSITION
        """

        columns = []
        cursor = conn.cursor()
        cursor.execute(query, (database, table))
        for row in cursor.fetchall():
            col_info = {
                "name": row[0],
                "type": row[1],
                "nullable": bool(row[2]),
                "default": row[3],
                "primary_key": bool(row[7]),
                "ordinal_position": row[8],
            }
            if row[4]:
                col_info["max_length"] = row[4]
            if row[5]:
                col_info["precision"] = row[5]
            if row[6]:
                col_info["scale"] = row[6]
            columns.append(col_info)
        cursor.close()

        return columns

    def preview_table(
        self,
        table: str,
        schema: str | None = None,
        limit: int = 100,
        columns: list[str] | None = None,
    ) -> dict[str, Any]:
        """Preview MySQL table data."""
        conn = self._ensure_connection()
        database = schema or self.database

        if columns:
            col_list = ", ".join(f"`{col}`" for col in columns)
        else:
            col_list = "*"

        qualified_table = f"`{database}`.`{table}`"

        count_query = f"SELECT COUNT(*) FROM {qualified_table}"
        preview_query = f"SELECT {col_list} FROM {qualified_table} LIMIT %s"

        cursor = conn.cursor()

        cursor.execute(count_query)
        total_count = cursor.fetchone()[0]

        cursor.execute(preview_query, (limit,))
        col_names = [desc[0] for desc in cursor.description]

        rows = []
        for row in cursor.fetchall():
            serialized_row = []
            for val in row:
                if val is None:
                    serialized_row.append(None)
                elif isinstance(val, (bytes, bytearray)):
                    serialized_row.append(f"<binary {len(val)} bytes>")
                elif hasattr(val, 'isoformat'):
                    serialized_row.append(val.isoformat())
                else:
                    serialized_row.append(val)
            rows.append(serialized_row)

        cursor.close()

        return {
            "columns": col_names,
            "rows": rows,
            "row_count": len(rows),
            "total_count": total_count,
            "truncated": total_count > limit,
        }


# =============================================================================
# SQL Server Connector
# =============================================================================

class SQLServerConnector(BaseDatabaseConnector):
    """
    Microsoft SQL Server database connector using pyodbc.

    Supports:
    - Schema discovery
    - Table/view discovery
    - Column metadata including primary keys
    - Data preview
    """

    db_type = "sqlserver"

    @property
    def instance(self) -> str | None:
        """SQL Server instance name."""
        return self.config.get("instance")

    def _create_connection(self) -> Any:
        """Create SQL Server connection using pyodbc."""
        try:
            import pyodbc
        except ImportError:
            raise ImportError(
                "pyodbc is required for SQL Server connections. "
                "Install with: pip install pyodbc"
            )

        # Build connection string
        server = self.host
        if self.instance:
            server = f"{self.host}\\{self.instance}"

        conn_str_parts = [
            f"DRIVER={{ODBC Driver 18 for SQL Server}}",
            f"SERVER={server},{self.port}",
            f"DATABASE={self.database}",
            f"UID={self.username}",
        ]

        if self.password:
            conn_str_parts.append(f"PWD={self.password}")

        # Handle TLS
        ssl_mode = self.tls_config.get("mode", "prefer")
        if ssl_mode == "disable":
            conn_str_parts.append("Encrypt=no")
        elif ssl_mode in ("require", "verify-ca", "verify-full"):
            conn_str_parts.append("Encrypt=yes")
            if ssl_mode == "verify-full":
                conn_str_parts.append("TrustServerCertificate=no")
            else:
                conn_str_parts.append("TrustServerCertificate=yes")
        else:
            conn_str_parts.append("Encrypt=yes")
            conn_str_parts.append("TrustServerCertificate=yes")

        conn_str_parts.append(f"Connection Timeout={self.connect_timeout_ms // 1000}")

        conn_str = ";".join(conn_str_parts)
        self._connection = pyodbc.connect(conn_str)
        return self._connection

    def _close_connection(self) -> None:
        """Close SQL Server connection."""
        if self._connection:
            self._connection.close()
            self._connection = None

    def _ensure_connection(self) -> Any:
        """Ensure we have an active connection."""
        if self._connection is None:
            self._create_connection()
        return self._connection

    def test_connection(self) -> tuple[bool, str | None]:
        """Test SQL Server connectivity."""
        try:
            conn = self._create_connection()
            cursor = conn.cursor()
            cursor.execute("SELECT 1")
            cursor.fetchone()
            cursor.close()
            self._close_connection()
            return True, None
        except Exception as e:
            self._close_connection()
            return False, str(e)

    def discover_schemas(self) -> list[dict[str, Any]]:
        """Discover SQL Server schemas."""
        conn = self._ensure_connection()

        query = """
            SELECT
                s.name as schema_name,
                p.name as owner_name
            FROM sys.schemas s
            LEFT JOIN sys.database_principals p ON s.principal_id = p.principal_id
            WHERE s.name NOT IN ('sys', 'INFORMATION_SCHEMA', 'guest', 'db_owner',
                                 'db_accessadmin', 'db_securityadmin', 'db_ddladmin',
                                 'db_backupoperator', 'db_datareader', 'db_datawriter',
                                 'db_denydatareader', 'db_denydatawriter')
            ORDER BY s.name
        """

        schemas = []
        cursor = conn.cursor()
        cursor.execute(query)
        for row in cursor.fetchall():
            schemas.append({
                "name": row[0],
                "owner": row[1],
            })
        cursor.close()

        return schemas

    def discover_tables(
        self, schema: str | None = None, include_views: bool = True
    ) -> list[dict[str, Any]]:
        """Discover SQL Server tables and views."""
        conn = self._ensure_connection()

        table_types = ["'BASE TABLE'"]
        if include_views:
            table_types.append("'VIEW'")

        query = f"""
            SELECT
                t.TABLE_SCHEMA,
                t.TABLE_NAME,
                t.TABLE_TYPE,
                COALESCE(
                    (SELECT SUM(p.rows)
                     FROM sys.partitions p
                     JOIN sys.tables st ON p.object_id = st.object_id
                     JOIN sys.schemas ss ON st.schema_id = ss.schema_id
                     WHERE ss.name = t.TABLE_SCHEMA
                       AND st.name = t.TABLE_NAME
                       AND p.index_id IN (0, 1)),
                    0
                ) as row_count_estimate
            FROM INFORMATION_SCHEMA.TABLES t
            WHERE t.TABLE_TYPE IN ({', '.join(table_types)})
              {'AND t.TABLE_SCHEMA = ?' if schema else ''}
            ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME
        """

        tables = []
        cursor = conn.cursor()
        if schema:
            cursor.execute(query, (schema,))
        else:
            cursor.execute(query)

        for row in cursor.fetchall():
            tables.append({
                "schema": row[0],
                "name": row[1],
                "type": "table" if row[2] == "BASE TABLE" else "view",
                "row_count_estimate": row[3] or 0,
            })
        cursor.close()

        return tables

    def discover_columns(
        self, table: str, schema: str | None = None
    ) -> list[dict[str, Any]]:
        """Discover SQL Server columns."""
        conn = self._ensure_connection()
        schema = schema or "dbo"

        query = """
            SELECT
                c.COLUMN_NAME,
                c.DATA_TYPE,
                CASE WHEN c.IS_NULLABLE = 'YES' THEN 1 ELSE 0 END as nullable,
                c.COLUMN_DEFAULT,
                c.CHARACTER_MAXIMUM_LENGTH,
                c.NUMERIC_PRECISION,
                c.NUMERIC_SCALE,
                CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END as primary_key,
                c.ORDINAL_POSITION
            FROM INFORMATION_SCHEMA.COLUMNS c
            LEFT JOIN (
                SELECT ku.TABLE_SCHEMA, ku.TABLE_NAME, ku.COLUMN_NAME
                FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
                  ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
                  AND tc.TABLE_SCHEMA = ku.TABLE_SCHEMA
                WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
            ) pk ON c.TABLE_SCHEMA = pk.TABLE_SCHEMA
                AND c.TABLE_NAME = pk.TABLE_NAME
                AND c.COLUMN_NAME = pk.COLUMN_NAME
            WHERE c.TABLE_SCHEMA = ? AND c.TABLE_NAME = ?
            ORDER BY c.ORDINAL_POSITION
        """

        columns = []
        cursor = conn.cursor()
        cursor.execute(query, (schema, table))
        for row in cursor.fetchall():
            col_info = {
                "name": row[0],
                "type": row[1],
                "nullable": bool(row[2]),
                "default": row[3],
                "primary_key": bool(row[7]),
                "ordinal_position": row[8],
            }
            if row[4]:
                col_info["max_length"] = row[4]
            if row[5]:
                col_info["precision"] = row[5]
            if row[6]:
                col_info["scale"] = row[6]
            columns.append(col_info)
        cursor.close()

        return columns

    def preview_table(
        self,
        table: str,
        schema: str | None = None,
        limit: int = 100,
        columns: list[str] | None = None,
    ) -> dict[str, Any]:
        """Preview SQL Server table data."""
        conn = self._ensure_connection()
        schema = schema or "dbo"

        if columns:
            col_list = ", ".join(f"[{col}]" for col in columns)
        else:
            col_list = "*"

        qualified_table = f"[{schema}].[{table}]"

        count_query = f"SELECT COUNT(*) FROM {qualified_table}"
        preview_query = f"SELECT TOP {limit} {col_list} FROM {qualified_table}"

        cursor = conn.cursor()

        cursor.execute(count_query)
        total_count = cursor.fetchone()[0]

        cursor.execute(preview_query)
        col_names = [desc[0] for desc in cursor.description]

        rows = []
        for row in cursor.fetchall():
            serialized_row = []
            for val in row:
                if val is None:
                    serialized_row.append(None)
                elif isinstance(val, (bytes, bytearray)):
                    serialized_row.append(f"<binary {len(val)} bytes>")
                elif hasattr(val, 'isoformat'):
                    serialized_row.append(val.isoformat())
                else:
                    serialized_row.append(val)
            rows.append(serialized_row)

        cursor.close()

        return {
            "columns": col_names,
            "rows": rows,
            "row_count": len(rows),
            "total_count": total_count,
            "truncated": total_count > limit,
        }


# =============================================================================
# Oracle Connector
# =============================================================================

class OracleConnector(BaseDatabaseConnector):
    """
    Oracle Database connector using python-oracledb.

    Supports:
    - Schema discovery (Oracle users/schemas)
    - Table/view discovery
    - Column metadata
    - Data preview
    """

    db_type = "oracle"

    @property
    def service_name(self) -> str | None:
        """Oracle service name from configuration."""
        return self.config.get("serviceName")

    @property
    def sid(self) -> str | None:
        """Oracle SID from configuration."""
        return self.config.get("sid")

    @property
    def connect_string(self) -> str | None:
        """Oracle TNS connect string from configuration."""
        return self.config.get("connectString")

    def _create_connection(self) -> Any:
        """Create Oracle connection using python-oracledb."""
        try:
            import oracledb
        except ImportError:
            raise ImportError(
                "python-oracledb is required for Oracle connections. "
                "Install with: pip install oracledb"
            )

        # Build DSN
        if self.connect_string:
            dsn = self.connect_string
        elif self.service_name:
            dsn = oracledb.makedsn(
                self.host,
                self.port,
                service_name=self.service_name
            )
        elif self.sid:
            dsn = oracledb.makedsn(
                self.host,
                self.port,
                sid=self.sid
            )
        else:
            raise ValueError("Oracle requires serviceName, sid, or connectString")

        conn_params = {
            "user": self.username,
            "dsn": dsn,
        }

        if self.password:
            conn_params["password"] = self.password

        self._connection = oracledb.connect(**conn_params)
        return self._connection

    def _close_connection(self) -> None:
        """Close Oracle connection."""
        if self._connection:
            self._connection.close()
            self._connection = None

    def _ensure_connection(self) -> Any:
        """Ensure we have an active connection."""
        if self._connection is None:
            self._create_connection()
        return self._connection

    def test_connection(self) -> tuple[bool, str | None]:
        """Test Oracle connectivity."""
        try:
            conn = self._create_connection()
            cursor = conn.cursor()
            cursor.execute("SELECT 1 FROM DUAL")
            cursor.fetchone()
            cursor.close()
            self._close_connection()
            return True, None
        except Exception as e:
            self._close_connection()
            return False, str(e)

    def discover_schemas(self) -> list[dict[str, Any]]:
        """Discover Oracle schemas (users)."""
        conn = self._ensure_connection()

        query = """
            SELECT username
            FROM all_users
            WHERE username NOT IN (
                'SYS', 'SYSTEM', 'OUTLN', 'DIP', 'ORACLE_OCM', 'DBSNMP',
                'APPQOSSYS', 'WMSYS', 'EXFSYS', 'CTXSYS', 'XDB', 'ANONYMOUS',
                'ORDSYS', 'ORDDATA', 'ORDPLUGINS', 'SI_INFORMTN_SCHEMA',
                'MDSYS', 'OLAPSYS', 'MDDATA', 'SPATIAL_WFS_ADMIN_USR',
                'SPATIAL_CSW_ADMIN_USR', 'LBACSYS', 'APEX_PUBLIC_USER',
                'FLOWS_FILES', 'APEX_040000', 'APEX_040200', 'OWBSYS',
                'OWBSYS_AUDIT', 'SCOTT'
            )
            ORDER BY username
        """

        schemas = []
        cursor = conn.cursor()
        cursor.execute(query)
        for row in cursor.fetchall():
            schemas.append({
                "name": row[0],
                "owner": row[0],  # In Oracle, schema owner = schema name
            })
        cursor.close()

        return schemas

    def discover_tables(
        self, schema: str | None = None, include_views: bool = True
    ) -> list[dict[str, Any]]:
        """Discover Oracle tables and views."""
        conn = self._ensure_connection()
        schema = schema or self.username.upper() if self.username else None

        tables = []
        cursor = conn.cursor()

        # Get tables
        table_query = """
            SELECT owner, table_name, num_rows
            FROM all_tables
            WHERE owner = :schema
            ORDER BY table_name
        """
        cursor.execute(table_query, {"schema": schema})
        for row in cursor.fetchall():
            tables.append({
                "schema": row[0],
                "name": row[1],
                "type": "table",
                "row_count_estimate": row[2] or 0,
            })

        # Get views if requested
        if include_views:
            view_query = """
                SELECT owner, view_name
                FROM all_views
                WHERE owner = :schema
                ORDER BY view_name
            """
            cursor.execute(view_query, {"schema": schema})
            for row in cursor.fetchall():
                tables.append({
                    "schema": row[0],
                    "name": row[1],
                    "type": "view",
                    "row_count_estimate": 0,
                })

        cursor.close()
        return tables

    def discover_columns(
        self, table: str, schema: str | None = None
    ) -> list[dict[str, Any]]:
        """Discover Oracle columns."""
        conn = self._ensure_connection()
        schema = schema or self.username.upper() if self.username else None

        query = """
            SELECT
                c.column_name,
                c.data_type,
                CASE WHEN c.nullable = 'Y' THEN 1 ELSE 0 END as nullable,
                c.data_default,
                c.char_length,
                c.data_precision,
                c.data_scale,
                CASE WHEN pk.column_name IS NOT NULL THEN 1 ELSE 0 END as primary_key,
                c.column_id
            FROM all_tab_columns c
            LEFT JOIN (
                SELECT cc.owner, cc.table_name, cc.column_name
                FROM all_constraints con
                JOIN all_cons_columns cc ON con.constraint_name = cc.constraint_name
                  AND con.owner = cc.owner
                WHERE con.constraint_type = 'P'
            ) pk ON c.owner = pk.owner
                AND c.table_name = pk.table_name
                AND c.column_name = pk.column_name
            WHERE c.owner = :schema AND c.table_name = :table
            ORDER BY c.column_id
        """

        columns = []
        cursor = conn.cursor()
        cursor.execute(query, {"schema": schema, "table": table.upper()})
        for row in cursor.fetchall():
            col_info = {
                "name": row[0],
                "type": row[1],
                "nullable": bool(row[2]),
                "default": row[3],
                "primary_key": bool(row[7]),
                "ordinal_position": row[8],
            }
            if row[4]:
                col_info["max_length"] = row[4]
            if row[5]:
                col_info["precision"] = row[5]
            if row[6]:
                col_info["scale"] = row[6]
            columns.append(col_info)
        cursor.close()

        return columns

    def preview_table(
        self,
        table: str,
        schema: str | None = None,
        limit: int = 100,
        columns: list[str] | None = None,
    ) -> dict[str, Any]:
        """Preview Oracle table data."""
        conn = self._ensure_connection()
        schema = schema or self.username.upper() if self.username else None

        if columns:
            col_list = ", ".join(f'"{col}"' for col in columns)
        else:
            col_list = "*"

        qualified_table = f'"{schema}"."{table.upper()}"'

        count_query = f"SELECT COUNT(*) FROM {qualified_table}"
        preview_query = f"SELECT {col_list} FROM {qualified_table} WHERE ROWNUM <= :limit"

        cursor = conn.cursor()

        cursor.execute(count_query)
        total_count = cursor.fetchone()[0]

        cursor.execute(preview_query, {"limit": limit})
        col_names = [desc[0] for desc in cursor.description]

        rows = []
        for row in cursor.fetchall():
            serialized_row = []
            for val in row:
                if val is None:
                    serialized_row.append(None)
                elif isinstance(val, (bytes, bytearray)):
                    serialized_row.append(f"<binary {len(val)} bytes>")
                elif hasattr(val, 'isoformat'):
                    serialized_row.append(val.isoformat())
                else:
                    serialized_row.append(val)
            rows.append(serialized_row)

        cursor.close()

        return {
            "columns": col_names,
            "rows": rows,
            "row_count": len(rows),
            "total_count": total_count,
            "truncated": total_count > limit,
        }


# =============================================================================
# MongoDB Connector
# =============================================================================

class MongoDBConnector(BaseDatabaseConnector):
    """
    MongoDB database connector using pymongo.

    Supports:
    - Database discovery
    - Collection discovery
    - Field sampling (MongoDB is schemaless)
    - Document preview
    """

    db_type = "mongodb"

    @property
    def connection_uri(self) -> str | None:
        """MongoDB connection URI from configuration."""
        return self.config.get("connectionUri")

    @property
    def replica_set(self) -> str | None:
        """MongoDB replica set name from configuration."""
        return self.config.get("replicaSet")

    @property
    def auth_source(self) -> str:
        """MongoDB authentication database."""
        return self.config.get("authSource", "admin")

    def _create_connection(self) -> Any:
        """Create MongoDB connection using pymongo."""
        try:
            from pymongo import MongoClient
        except ImportError:
            raise ImportError(
                "pymongo is required for MongoDB connections. "
                "Install with: pip install pymongo"
            )

        if self.connection_uri:
            self._connection = MongoClient(
                self.connection_uri,
                serverSelectionTimeoutMS=self.connect_timeout_ms,
            )
        else:
            conn_params = {
                "host": self.host,
                "port": self.port,
                "serverSelectionTimeoutMS": self.connect_timeout_ms,
            }

            if self.username and self.password:
                conn_params["username"] = self.username
                conn_params["password"] = self.password
                conn_params["authSource"] = self.auth_source

            if self.replica_set:
                conn_params["replicaSet"] = self.replica_set

            # Handle TLS
            ssl_mode = self.tls_config.get("mode", "prefer")
            if ssl_mode != "disable":
                conn_params["tls"] = True
                if ssl_mode in ("verify-ca", "verify-full"):
                    conn_params["tlsAllowInvalidCertificates"] = False
                else:
                    conn_params["tlsAllowInvalidCertificates"] = True

            self._connection = MongoClient(**conn_params)

        return self._connection

    def _close_connection(self) -> None:
        """Close MongoDB connection."""
        if self._connection:
            self._connection.close()
            self._connection = None

    def _ensure_connection(self) -> Any:
        """Ensure we have an active connection."""
        if self._connection is None:
            self._create_connection()
        return self._connection

    def test_connection(self) -> tuple[bool, str | None]:
        """Test MongoDB connectivity."""
        try:
            client = self._create_connection()
            # Force connection by getting server info
            client.server_info()
            self._close_connection()
            return True, None
        except Exception as e:
            self._close_connection()
            return False, str(e)

    def discover_schemas(self) -> list[dict[str, Any]]:
        """MongoDB returns databases as schemas."""
        client = self._ensure_connection()

        system_dbs = {'admin', 'config', 'local'}

        schemas = []
        for db_name in client.list_database_names():
            if db_name not in system_dbs:
                schemas.append({
                    "name": db_name,
                    "owner": None,
                })

        return schemas

    def discover_tables(
        self, schema: str | None = None, include_views: bool = True
    ) -> list[dict[str, Any]]:
        """Discover MongoDB collections."""
        client = self._ensure_connection()
        database = schema or self.database

        if not database:
            raise ValueError("Database name required for MongoDB collection discovery")

        db = client[database]

        tables = []
        for collection_name in db.list_collection_names():
            # Get estimated document count
            try:
                count = db[collection_name].estimated_document_count()
            except Exception as e:
                logger.debug(f"Failed to get document count for {collection_name}: {e}")
                count = 0

            tables.append({
                "schema": database,
                "name": collection_name,
                "type": "collection",
                "row_count_estimate": count,
            })

        return tables

    def discover_columns(
        self, table: str, schema: str | None = None
    ) -> list[dict[str, Any]]:
        """
        Sample MongoDB collection to discover field structure.

        Since MongoDB is schemaless, we sample documents to infer fields.
        """
        client = self._ensure_connection()
        database = schema or self.database

        if not database:
            raise ValueError("Database name required for MongoDB field discovery")

        collection = client[database][table]

        # Sample documents to discover fields
        sample_size = 100
        field_types: dict[str, set] = {}

        for doc in collection.find().limit(sample_size):
            self._extract_fields(doc, "", field_types)

        # Convert to column format
        columns = []
        for i, (field_path, types) in enumerate(sorted(field_types.items())):
            # Determine predominant type
            type_str = ", ".join(sorted(types)) if len(types) > 1 else next(iter(types))

            columns.append({
                "name": field_path,
                "type": type_str,
                "nullable": True,  # MongoDB fields are always nullable
                "default": None,
                "primary_key": field_path == "_id",
                "ordinal_position": i + 1,
            })

        return columns

    def _extract_fields(
        self,
        doc: dict,
        prefix: str,
        field_types: dict[str, set]
    ) -> None:
        """Recursively extract field paths and types from a document."""
        from bson import ObjectId
        from datetime import datetime

        for key, value in doc.items():
            field_path = f"{prefix}.{key}" if prefix else key

            # Determine type
            if value is None:
                type_name = "null"
            elif isinstance(value, bool):
                type_name = "boolean"
            elif isinstance(value, int):
                type_name = "integer"
            elif isinstance(value, float):
                type_name = "double"
            elif isinstance(value, str):
                type_name = "string"
            elif isinstance(value, datetime):
                type_name = "datetime"
            elif isinstance(value, ObjectId):
                type_name = "objectId"
            elif isinstance(value, list):
                type_name = "array"
            elif isinstance(value, dict):
                type_name = "object"
                # Recurse into nested documents
                self._extract_fields(value, field_path, field_types)
            else:
                type_name = type(value).__name__

            if field_path not in field_types:
                field_types[field_path] = set()
            field_types[field_path].add(type_name)

    def preview_table(
        self,
        table: str,
        schema: str | None = None,
        limit: int = 100,
        columns: list[str] | None = None,
    ) -> dict[str, Any]:
        """Preview MongoDB collection data."""
        client = self._ensure_connection()
        database = schema or self.database

        if not database:
            raise ValueError("Database name required for MongoDB preview")

        collection = client[database][table]

        # Build projection if columns specified
        projection = None
        if columns:
            projection = {col: 1 for col in columns}

        # Get total count
        total_count = collection.estimated_document_count()

        # Get preview documents
        cursor = collection.find(projection=projection).limit(limit)

        # Convert documents to rows
        rows = []
        col_set: set[str] = set()

        for doc in cursor:
            row_dict = self._flatten_document(doc)
            col_set.update(row_dict.keys())
            rows.append(row_dict)

        # Convert to tabular format
        col_names = sorted(col_set)
        tabular_rows = []
        for row_dict in rows:
            tabular_row = []
            for col in col_names:
                val = row_dict.get(col)
                # Serialize special types
                if val is None:
                    tabular_row.append(None)
                elif hasattr(val, 'isoformat'):
                    tabular_row.append(val.isoformat())
                elif hasattr(val, '__str__') and not isinstance(val, (str, int, float, bool)):
                    tabular_row.append(str(val))
                else:
                    tabular_row.append(val)
            tabular_rows.append(tabular_row)

        return {
            "columns": col_names,
            "rows": tabular_rows,
            "row_count": len(tabular_rows),
            "total_count": total_count,
            "truncated": total_count > limit,
        }

    def _flatten_document(self, doc: dict, prefix: str = "") -> dict:
        """Flatten nested document to dot-notation keys."""
        result = {}

        for key, value in doc.items():
            field_path = f"{prefix}.{key}" if prefix else key

            if isinstance(value, dict) and not any(k.startswith("$") for k in value.keys()):
                # Recurse into nested documents (but not MongoDB operators)
                result.update(self._flatten_document(value, field_path))
            else:
                result[field_path] = value

        return result


# =============================================================================
# Connector Registry
# =============================================================================

DATABASE_CONNECTOR_CLASSES: dict[str, type[BaseDatabaseConnector]] = {
    "postgres": PostgresConnector,
    "mysql": MySQLConnector,
    "sqlserver": SQLServerConnector,
    "oracle": OracleConnector,
    "mongodb": MongoDBConnector,
}


def get_database_connector(
    db_type: str,
    config: dict[str, Any],
    organization_id: str,
) -> BaseDatabaseConnector:
    """
    Factory function to create a database connector instance.

    Args:
        db_type: Database type (postgres, mysql, sqlserver, oracle, mongodb)
        config: Connector configuration dictionary
        organization_id: Organization UUID

    Returns:
        Configured database connector instance

    Raises:
        ValueError: If db_type is not supported
    """
    if db_type not in DATABASE_CONNECTOR_CLASSES:
        raise ValueError(
            f"Unsupported database type: {db_type}. "
            f"Supported: {list(DATABASE_CONNECTOR_CLASSES.keys())}"
        )

    connector_class = DATABASE_CONNECTOR_CLASSES[db_type]
    return connector_class(config, organization_id)
