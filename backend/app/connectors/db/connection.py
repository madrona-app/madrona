"""
Database connection factory and connectivity testing.

Provides:
- Connection factory with TLS/secrets support
- Connectivity testing with vendor-specific commands
- Consistent timeout enforcement
"""

import logging
import time
from dataclasses import dataclass, field
from typing import Any

from app.connectors.db.errors import DbError, DbErrorCode, normalize_db_error
from app.connectors.db.secrets import (
    SecretResolutionError,
    resolve_certificate,
    resolve_password,
)
from app.schemas.database_source import (
    DEFAULT_PORTS,
    get_database_capabilities,
    validate_database_config,
)

logger = logging.getLogger(__name__)


@dataclass
class ConnectionTestResult:
    """Result of a database connectivity test."""

    ok: bool
    latency_ms: float
    server: dict[str, Any] = field(default_factory=dict)
    capabilities: dict[str, Any] = field(default_factory=dict)
    error: DbError | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to API response format."""
        return {
            "ok": self.ok,
            "latencyMs": round(self.latency_ms, 2),
            "server": self.server,
            "capabilities": self.capabilities,
            "error": self.error.to_dict() if self.error else None,
        }


def _get_postgres_ssl_mode(tls_mode: str) -> str:
    """Map TLS mode to PostgreSQL sslmode parameter."""
    mapping = {
        "disable": "disable",
        "allow": "allow",
        "prefer": "prefer",
        "require": "require",
        "verify-ca": "verify-ca",
        "verify-full": "verify-full",
    }
    return mapping.get(tls_mode, "prefer")


def _get_mysql_ssl_config(tls_config: dict[str, Any]) -> dict[str, Any]:
    """Build MySQL SSL configuration dict."""
    tls_mode = tls_config.get("mode", "prefer")

    if tls_mode == "disable":
        return {}

    ssl_config: dict[str, Any] = {}

    # CA certificate
    ca_cert = resolve_certificate(tls_config.get("caCertRef"))
    if ca_cert:
        ssl_config["ca"] = ca_cert

    # Client certificate
    client_cert = resolve_certificate(tls_config.get("clientCertRef"))
    if client_cert:
        ssl_config["cert"] = client_cert

    # Client key
    client_key = resolve_certificate(tls_config.get("clientKeyRef"))
    if client_key:
        ssl_config["key"] = client_key

    # Verify mode.
    #
    # A supplied CA certificate also turns verification on, whatever the mode.
    # PyMySQL builds its context as
    #     "verify_mode": ssl_verify_cert if ssl_verify_cert is not None else False
    # so passing ssl_ca without ssl_verify_cert loads the CA and then ignores
    # it: the connection is encrypted but the server certificate is never
    # checked, and an operator who uploaded a CA to pin trust gets no warning
    # that nothing is being verified. Uploading a CA has no other meaning, so
    # treat it as the intent it plainly is.
    if tls_mode in ("verify-ca", "verify-full") or ca_cert:
        ssl_config["check_hostname"] = tls_mode == "verify-full"
        ssl_config["verify_mode"] = True

    return ssl_config if ssl_config else {"ssl": True}


def test_postgres_connection(config: dict[str, Any]) -> ConnectionTestResult:
    """
    Test PostgreSQL connectivity.

    Uses psycopg (psycopg3) or psycopg2 for connection testing.
    Executes: SELECT 1
    """
    try:
        import psycopg
    except ImportError:
        try:
            import psycopg2 as psycopg  # type: ignore
        except ImportError:
            return ConnectionTestResult(
                ok=False,
                latency_ms=0,
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
    tls_config = config.get("tls", {})
    driver_opts = config.get("driverOptions", {})

    # Resolve password
    try:
        password = resolve_password(config.get("auth", {}))
    except SecretResolutionError as e:
        return ConnectionTestResult(
            ok=False,
            latency_ms=0,
            error=DbError(DbErrorCode.AUTH_FAILED, str(e), None, False),
        )

    # Build connection parameters
    connect_timeout = driver_opts.get("connectTimeoutMs", 30000) / 1000  # Convert to seconds
    sslmode = _get_postgres_ssl_mode(tls_config.get("mode", "prefer"))

    conn_params: dict[str, Any] = {
        "host": host,
        "port": port,
        "dbname": database,
        "user": username,
        "connect_timeout": int(connect_timeout),
        "sslmode": sslmode,
    }

    if password:
        conn_params["password"] = password

    # CA certificate
    ca_cert = resolve_certificate(tls_config.get("caCertRef"))
    if ca_cert:
        conn_params["sslrootcert"] = ca_cert

    # Client certificate
    client_cert = resolve_certificate(tls_config.get("clientCertRef"))
    if client_cert:
        conn_params["sslcert"] = client_cert

    # Client key
    client_key = resolve_certificate(tls_config.get("clientKeyRef"))
    if client_key:
        conn_params["sslkey"] = client_key

    start_time = time.perf_counter()

    try:
        conn = psycopg.connect(**conn_params)
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT version()")
            version_row = cursor.fetchone()
            version = version_row[0] if version_row else None

            latency_ms = (time.perf_counter() - start_time) * 1000

            return ConnectionTestResult(
                ok=True,
                latency_ms=latency_ms,
                server={
                    "version": version,
                    "vendor": "PostgreSQL",
                },
                capabilities=get_database_capabilities("postgres"),
            )
        finally:
            conn.close()

    except Exception as e:
        latency_ms = (time.perf_counter() - start_time) * 1000
        error = normalize_db_error(e, "postgres")
        return ConnectionTestResult(
            ok=False,
            latency_ms=latency_ms,
            server={"vendor": "PostgreSQL"},
            capabilities=get_database_capabilities("postgres"),
            error=error,
        )


def test_mysql_connection(config: dict[str, Any]) -> ConnectionTestResult:
    """
    Test MySQL connectivity.

    Uses PyMySQL for connection testing.
    Executes: SELECT 1
    """
    try:
        import pymysql
        from pymysql import Error as MySQLError
    except ImportError:
        return ConnectionTestResult(
            ok=False,
            latency_ms=0,
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
    tls_config = config.get("tls", {})
    driver_opts = config.get("driverOptions", {})

    # Resolve password
    try:
        password = resolve_password(config.get("auth", {}))
    except SecretResolutionError as e:
        return ConnectionTestResult(
            ok=False,
            latency_ms=0,
            error=DbError(DbErrorCode.AUTH_FAILED, str(e), None, False),
        )

    connect_timeout = driver_opts.get("connectTimeoutMs", 30000) / 1000

    conn_params: dict[str, Any] = {
        "host": host,
        "port": port,
        "database": database,
        "user": username,
        "connect_timeout": int(connect_timeout),
    }

    if password:
        conn_params["password"] = password

    # SSL configuration
    ssl_config = _get_mysql_ssl_config(tls_config)
    if ssl_config:
        conn_params["ssl_disabled"] = False
        if "ca" in ssl_config:
            conn_params["ssl_ca"] = ssl_config["ca"]
        if "cert" in ssl_config:
            conn_params["ssl_cert"] = ssl_config["cert"]
        if "key" in ssl_config:
            conn_params["ssl_key"] = ssl_config["key"]
        if ssl_config.get("verify_mode"):
            conn_params["ssl_verify_cert"] = True
            conn_params["ssl_verify_identity"] = ssl_config.get("check_hostname", False)
    elif tls_config.get("mode") == "disable":
        conn_params["ssl_disabled"] = True

    start_time = time.perf_counter()

    try:
        conn = pymysql.connect(**conn_params)
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT VERSION()")
            version_row = cursor.fetchone()
            version = version_row[0] if version_row else None

            latency_ms = (time.perf_counter() - start_time) * 1000

            return ConnectionTestResult(
                ok=True,
                latency_ms=latency_ms,
                server={
                    "version": version,
                    "vendor": "MySQL",
                },
                capabilities=get_database_capabilities("mysql"),
            )
        finally:
            conn.close()

    except MySQLError as e:
        latency_ms = (time.perf_counter() - start_time) * 1000
        error = normalize_db_error(e, "mysql")
        return ConnectionTestResult(
            ok=False,
            latency_ms=latency_ms,
            server={"vendor": "MySQL"},
            capabilities=get_database_capabilities("mysql"),
            error=error,
        )
    except Exception as e:
        latency_ms = (time.perf_counter() - start_time) * 1000
        error = normalize_db_error(e, "mysql")
        return ConnectionTestResult(
            ok=False,
            latency_ms=latency_ms,
            server={"vendor": "MySQL"},
            capabilities=get_database_capabilities("mysql"),
            error=error,
        )


def test_sqlserver_connection(config: dict[str, Any]) -> ConnectionTestResult:
    """
    Test SQL Server connectivity.

    Uses pyodbc or pymssql for connection testing.
    Executes: SELECT 1
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
            return ConnectionTestResult(
                ok=False,
                latency_ms=0,
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
    tls_config = config.get("tls", {})
    driver_opts = config.get("driverOptions", {})

    # Resolve password
    try:
        password = resolve_password(config.get("auth", {}))
    except SecretResolutionError as e:
        return ConnectionTestResult(
            ok=False,
            latency_ms=0,
            error=DbError(DbErrorCode.AUTH_FAILED, str(e), None, False),
        )

    connect_timeout = int(driver_opts.get("connectTimeoutMs", 30000) / 1000)

    start_time = time.perf_counter()

    try:
        if driver_name == "pyodbc":
            # Build ODBC connection string
            server = f"{host},{port}" if not instance else f"{host}\\{instance},{port}"

            # Find available ODBC driver
            drivers = pyodbc.drivers()
            odbc_driver = None
            for d in ["ODBC Driver 18 for SQL Server", "ODBC Driver 17 for SQL Server", "SQL Server"]:
                if d in drivers:
                    odbc_driver = d
                    break

            if not odbc_driver:
                return ConnectionTestResult(
                    ok=False,
                    latency_ms=0,
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

            # TLS settings
            tls_mode = tls_config.get("mode", "require")
            if tls_mode != "disable":
                conn_str += ";Encrypt=yes"
                if tls_mode in ("verify-ca", "verify-full"):
                    conn_str += ";TrustServerCertificate=no"
                else:
                    conn_str += ";TrustServerCertificate=yes"

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
            cursor.execute("SELECT @@VERSION")
            version_row = cursor.fetchone()
            version = version_row[0] if version_row else None

            latency_ms = (time.perf_counter() - start_time) * 1000

            return ConnectionTestResult(
                ok=True,
                latency_ms=latency_ms,
                server={
                    "version": version,
                    "vendor": "Microsoft SQL Server",
                },
                capabilities=get_database_capabilities("sqlserver"),
            )
        finally:
            conn.close()

    except Exception as e:
        latency_ms = (time.perf_counter() - start_time) * 1000
        error = normalize_db_error(e, "sqlserver")
        return ConnectionTestResult(
            ok=False,
            latency_ms=latency_ms,
            server={"vendor": "Microsoft SQL Server"},
            capabilities=get_database_capabilities("sqlserver"),
            error=error,
        )


def test_oracle_connection(config: dict[str, Any]) -> ConnectionTestResult:
    """
    Test Oracle connectivity.

    Uses oracledb (python-oracledb) or cx_Oracle for connection testing.
    Executes: SELECT 1 FROM DUAL
    """
    try:
        import oracledb
    except ImportError:
        try:
            import cx_Oracle as oracledb  # type: ignore
        except ImportError:
            return ConnectionTestResult(
                ok=False,
                latency_ms=0,
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

    # Resolve password
    try:
        password = resolve_password(config.get("auth", {}))
    except SecretResolutionError as e:
        return ConnectionTestResult(
            ok=False,
            latency_ms=0,
            error=DbError(DbErrorCode.AUTH_FAILED, str(e), None, False),
        )

    connect_timeout = int(driver_opts.get("connectTimeoutMs", 30000) / 1000)

    # Build DSN
    if connect_string:
        dsn = connect_string
    elif service_name:
        dsn = f"{host}:{port}/{service_name}"
    elif sid:
        dsn = oracledb.makedsn(host, port, sid=sid)
    else:
        return ConnectionTestResult(
            ok=False,
            latency_ms=0,
            error=DbError(
                DbErrorCode.UNKNOWN,
                "Oracle configuration requires serviceName, sid, or connectString",
                None,
                False,
            ),
        )

    start_time = time.perf_counter()

    try:
        # oracledb supports tcp_connect_timeout parameter
        conn_params: dict[str, Any] = {
            "user": username,
            "password": password or "",
            "dsn": dsn,
        }

        # Set timeout if supported
        if hasattr(oracledb, "ConnectParams"):
            # python-oracledb 1.x+
            conn_params["tcp_connect_timeout"] = connect_timeout

        conn = oracledb.connect(**conn_params)

        try:
            cursor = conn.cursor()
            cursor.execute("SELECT banner FROM v$version WHERE ROWNUM = 1")
            version_row = cursor.fetchone()
            version = version_row[0] if version_row else None

            latency_ms = (time.perf_counter() - start_time) * 1000

            return ConnectionTestResult(
                ok=True,
                latency_ms=latency_ms,
                server={
                    "version": version,
                    "vendor": "Oracle",
                },
                capabilities=get_database_capabilities("oracle"),
            )
        finally:
            conn.close()

    except Exception as e:
        latency_ms = (time.perf_counter() - start_time) * 1000
        error = normalize_db_error(e, "oracle")
        return ConnectionTestResult(
            ok=False,
            latency_ms=latency_ms,
            server={"vendor": "Oracle"},
            capabilities=get_database_capabilities("oracle"),
            error=error,
        )


def test_mongodb_connection(config: dict[str, Any]) -> ConnectionTestResult:
    """
    Test MongoDB connectivity.

    Uses pymongo for connection testing.
    Executes: ping command on admin database
    """
    try:
        from pymongo import MongoClient
        from pymongo.errors import PyMongoError
    except ImportError:
        return ConnectionTestResult(
            ok=False,
            latency_ms=0,
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
    tls_config = config.get("tls", {})
    driver_opts = config.get("driverOptions", {})

    # Resolve password
    try:
        password = resolve_password(config.get("auth", {}))
    except SecretResolutionError as e:
        return ConnectionTestResult(
            ok=False,
            latency_ms=0,
            error=DbError(DbErrorCode.AUTH_FAILED, str(e), None, False),
        )

    connect_timeout_ms = driver_opts.get("connectTimeoutMs", 30000)
    server_selection_timeout_ms = connect_timeout_ms  # Use same timeout for server selection

    # Build connection parameters
    if connection_uri:
        # Use connection URI directly
        client_params: dict[str, Any] = {
            "host": connection_uri,
            "serverSelectionTimeoutMS": server_selection_timeout_ms,
            "connectTimeoutMS": connect_timeout_ms,
        }
        # Add auth if provided separately
        if username and password and "authSource" not in connection_uri:
            client_params["username"] = username
            client_params["password"] = password
            client_params["authSource"] = auth_source
    else:
        # Build from individual parameters
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

    # TLS configuration
    tls_mode = tls_config.get("mode", "prefer")
    if tls_mode != "disable":
        client_params["tls"] = True

        if tls_mode in ("verify-ca", "verify-full"):
            client_params["tlsAllowInvalidCertificates"] = False
            client_params["tlsAllowInvalidHostnames"] = tls_mode != "verify-full"
        else:
            # For require/prefer, don't validate certificates
            client_params["tlsAllowInvalidCertificates"] = True

        # CA certificate
        ca_cert = resolve_certificate(tls_config.get("caCertRef"))
        if ca_cert:
            client_params["tlsCAFile"] = ca_cert

        # Client certificate
        client_cert = resolve_certificate(tls_config.get("clientCertRef"))
        if client_cert:
            client_params["tlsCertificateKeyFile"] = client_cert

    start_time = time.perf_counter()

    try:
        client = MongoClient(**client_params)

        try:
            # Run ping command to verify connectivity
            admin_db = client.admin
            server_info = admin_db.command("ping")

            # Get server version
            build_info = admin_db.command("buildInfo")
            version = build_info.get("version")

            latency_ms = (time.perf_counter() - start_time) * 1000

            return ConnectionTestResult(
                ok=True,
                latency_ms=latency_ms,
                server={
                    "version": version,
                    "vendor": "MongoDB",
                },
                capabilities=get_database_capabilities("mongodb"),
            )
        finally:
            client.close()

    except PyMongoError as e:
        latency_ms = (time.perf_counter() - start_time) * 1000
        error = normalize_db_error(e, "mongodb")
        return ConnectionTestResult(
            ok=False,
            latency_ms=latency_ms,
            server={"vendor": "MongoDB"},
            capabilities=get_database_capabilities("mongodb"),
            error=error,
        )
    except Exception as e:
        latency_ms = (time.perf_counter() - start_time) * 1000
        error = normalize_db_error(e, "mongodb")
        return ConnectionTestResult(
            ok=False,
            latency_ms=latency_ms,
            server={"vendor": "MongoDB"},
            capabilities=get_database_capabilities("mongodb"),
            error=error,
        )


# Connection test dispatcher
CONNECTION_TESTERS = {
    "postgres": test_postgres_connection,
    "mysql": test_mysql_connection,
    "sqlserver": test_sqlserver_connection,
    "oracle": test_oracle_connection,
    "mongodb": test_mongodb_connection,
}


def test_database_connection(config: dict[str, Any]) -> ConnectionTestResult:
    """
    Test database connectivity for any supported database type.

    Args:
        config: Database source configuration with 'type' field

    Returns:
        ConnectionTestResult with ok, latency, server info, and any error
    """
    # Validate configuration first
    db_type = config.get("type")
    if not db_type:
        return ConnectionTestResult(
            ok=False,
            latency_ms=0,
            error=DbError(
                DbErrorCode.UNKNOWN,
                "Database type not specified in configuration",
                None,
                False,
            ),
        )

    is_valid, errors = validate_database_config(config)
    if not is_valid:
        return ConnectionTestResult(
            ok=False,
            latency_ms=0,
            error=DbError(
                DbErrorCode.UNKNOWN,
                f"Invalid configuration: {'; '.join(errors)}",
                None,
                False,
            ),
        )

    tester = CONNECTION_TESTERS.get(db_type)
    if not tester:
        return ConnectionTestResult(
            ok=False,
            latency_ms=0,
            error=DbError(
                DbErrorCode.UNSUPPORTED_FEATURE,
                f"Unsupported database type: {db_type}",
                None,
                False,
            ),
        )

    return tester(config)
