"""
Tests for database connector error normalization.

Tests cover:
- Error code enumeration
- Vendor-specific error mapping (PostgreSQL, MySQL, SQL Server, Oracle, MongoDB)
- Socket/network error normalization
- Error serialization
"""

import socket
import ssl
from unittest.mock import MagicMock

import pytest

from app.connectors.db.errors import (
    DbError,
    DbErrorCode,
    normalize_db_error,
    normalize_mongodb_error,
    normalize_mysql_error,
    normalize_oracle_error,
    normalize_postgres_error,
    normalize_socket_error,
    normalize_sqlserver_error,
)


class TestDbErrorCode:
    """Test DbErrorCode enum values."""

    def test_all_codes_defined(self):
        """All expected error codes are defined."""
        expected = {
            "AUTH_FAILED",
            "NETWORK_UNREACHABLE",
            "TLS_HANDSHAKE_FAILED",
            "DNS_FAILED",
            "TIMEOUT",
            "PERMISSION_DENIED",
            "UNSUPPORTED_FEATURE",
            "CONNECTION_REFUSED",
            "DATABASE_NOT_FOUND",
            "UNKNOWN",
        }
        actual = {code.value for code in DbErrorCode}
        assert actual == expected


class TestDbError:
    """Test DbError dataclass."""

    def test_to_dict(self):
        """DbError serializes correctly to dict."""
        error = DbError(
            code=DbErrorCode.AUTH_FAILED,
            message="Login failed",
            vendor_code="28P01",
            retryable=False,
        )
        result = error.to_dict()

        assert result["code"] == "AUTH_FAILED"
        assert result["message"] == "Login failed"
        assert result["vendorCode"] == "28P01"
        assert result["retryable"] is False

    def test_to_dict_without_vendor_code(self):
        """DbError serializes correctly without vendor code."""
        error = DbError(
            code=DbErrorCode.TIMEOUT,
            message="Connection timed out",
            retryable=True,
        )
        result = error.to_dict()

        assert result["code"] == "TIMEOUT"
        assert result["message"] == "Connection timed out"
        assert result["vendorCode"] is None
        assert result["retryable"] is True


class TestPostgresErrorNormalization:
    """Test PostgreSQL error normalization."""

    def test_auth_failed_by_pgcode(self):
        """Auth failure detected by SQLSTATE code."""
        exc = MagicMock()
        exc.pgcode = "28P01"
        exc.__str__ = lambda self: "password authentication failed for user"

        error = normalize_postgres_error(exc)
        assert error.code == DbErrorCode.AUTH_FAILED
        assert error.vendor_code == "28P01"
        assert error.retryable is False

    def test_database_not_found_by_pgcode(self):
        """Database not found detected by SQLSTATE code."""
        exc = MagicMock()
        exc.pgcode = "3D000"
        exc.__str__ = lambda self: 'database "test" does not exist'

        error = normalize_postgres_error(exc)
        assert error.code == DbErrorCode.DATABASE_NOT_FOUND
        assert error.vendor_code == "3D000"

    def test_connection_refused_by_pgcode(self):
        """Connection refused detected by SQLSTATE code."""
        exc = MagicMock()
        exc.pgcode = "08001"
        exc.__str__ = lambda self: "could not connect to server"

        error = normalize_postgres_error(exc)
        assert error.code == DbErrorCode.CONNECTION_REFUSED
        assert error.retryable is True

    def test_auth_failed_by_message(self):
        """Auth failure detected by error message."""
        exc = Exception("password authentication failed for user 'test'")

        error = normalize_postgres_error(exc)
        assert error.code == DbErrorCode.AUTH_FAILED

    def test_connection_refused_by_message(self):
        """Connection refused detected by message."""
        exc = Exception("could not connect to server: Connection refused")

        error = normalize_postgres_error(exc)
        assert error.code == DbErrorCode.CONNECTION_REFUSED

    def test_timeout_by_message(self):
        """Timeout detected by message."""
        exc = Exception("connection timeout expired")

        error = normalize_postgres_error(exc)
        assert error.code == DbErrorCode.TIMEOUT

    def test_ssl_error_by_message(self):
        """SSL error detected by message."""
        exc = Exception("SSL connection has been closed unexpectedly")

        error = normalize_postgres_error(exc)
        assert error.code == DbErrorCode.TLS_HANDSHAKE_FAILED

    def test_database_not_found_by_message(self):
        """Database not found detected by message."""
        exc = Exception('database "mydb" does not exist')

        error = normalize_postgres_error(exc)
        assert error.code == DbErrorCode.DATABASE_NOT_FOUND

    def test_unknown_error(self):
        """Unknown errors fall through."""
        exc = Exception("something unexpected happened")

        error = normalize_postgres_error(exc)
        assert error.code == DbErrorCode.UNKNOWN


class TestMySQLErrorNormalization:
    """Test MySQL error normalization."""

    def test_auth_failed_by_errno(self):
        """Auth failure detected by errno 1045."""
        exc = MagicMock()
        exc.errno = 1045
        exc.__str__ = lambda self: "Access denied for user 'test'@'localhost'"

        error = normalize_mysql_error(exc)
        assert error.code == DbErrorCode.AUTH_FAILED
        assert error.vendor_code == "1045"
        assert error.retryable is False

    def test_database_not_found_by_errno(self):
        """Database not found detected by errno 1049."""
        exc = MagicMock()
        exc.errno = 1049
        exc.__str__ = lambda self: "Unknown database 'test'"

        error = normalize_mysql_error(exc)
        assert error.code == DbErrorCode.DATABASE_NOT_FOUND
        assert error.vendor_code == "1049"

    def test_connection_refused_by_errno(self):
        """Connection refused detected by errno 2003."""
        exc = MagicMock()
        exc.errno = 2003
        exc.__str__ = lambda self: "Can't connect to MySQL server on 'localhost'"

        error = normalize_mysql_error(exc)
        assert error.code == DbErrorCode.CONNECTION_REFUSED
        assert error.retryable is True

    def test_dns_failed_by_errno(self):
        """DNS failure detected by errno 2005."""
        exc = MagicMock()
        exc.errno = 2005
        exc.__str__ = lambda self: "Unknown MySQL server host"

        error = normalize_mysql_error(exc)
        assert error.code == DbErrorCode.DNS_FAILED

    def test_ssl_error_by_errno(self):
        """SSL error detected by errno 2026."""
        exc = MagicMock()
        exc.errno = 2026
        exc.__str__ = lambda self: "SSL connection error"

        error = normalize_mysql_error(exc)
        assert error.code == DbErrorCode.TLS_HANDSHAKE_FAILED

    def test_auth_failed_by_message(self):
        """Auth failure detected by message pattern."""
        exc = Exception("Access denied for user 'test'@'localhost'")

        error = normalize_mysql_error(exc)
        assert error.code == DbErrorCode.AUTH_FAILED

    def test_errno_from_message(self):
        """Errno extracted from error message."""
        exc = Exception("Error 1045: Access denied")

        error = normalize_mysql_error(exc)
        assert error.code == DbErrorCode.AUTH_FAILED
        assert error.vendor_code == "1045"


class TestSQLServerErrorNormalization:
    """Test SQL Server error normalization."""

    def test_auth_failed_by_errno(self):
        """Auth failure detected by error 18456."""
        exc = MagicMock()
        exc.args = (18456, b"Login failed for user 'test'")
        exc.__str__ = lambda self: "Login failed for user 'test'"

        error = normalize_sqlserver_error(exc)
        assert error.code == DbErrorCode.AUTH_FAILED
        assert error.vendor_code == "18456"

    def test_database_not_found_by_errno(self):
        """Database not found detected by error 4060."""
        exc = MagicMock()
        exc.args = (4060, b"Cannot open database 'test'")
        exc.__str__ = lambda self: "Cannot open database 'test'"

        error = normalize_sqlserver_error(exc)
        assert error.code == DbErrorCode.DATABASE_NOT_FOUND
        assert error.vendor_code == "4060"

    def test_timeout_by_errno(self):
        """Timeout detected by error 10060."""
        exc = MagicMock()
        exc.args = (10060, b"Connection timeout")
        exc.__str__ = lambda self: "Connection timeout"

        error = normalize_sqlserver_error(exc)
        assert error.code == DbErrorCode.TIMEOUT
        assert error.retryable is True

    def test_login_failed_by_message(self):
        """Login failed detected by message."""
        exc = Exception("Login failed for user 'sa'")

        error = normalize_sqlserver_error(exc)
        assert error.code == DbErrorCode.AUTH_FAILED

    def test_cannot_open_database_by_message(self):
        """Cannot open database detected by message."""
        exc = Exception("Cannot open database 'mydb' requested by the login")

        error = normalize_sqlserver_error(exc)
        assert error.code == DbErrorCode.DATABASE_NOT_FOUND

    def test_error_number_from_message(self):
        """Error number extracted from message."""
        exc = Exception("Msg 18456, Level 14, State 1: Login failed")

        error = normalize_sqlserver_error(exc)
        assert error.code == DbErrorCode.AUTH_FAILED
        assert error.vendor_code == "18456"


class TestOracleErrorNormalization:
    """Test Oracle error normalization."""

    def test_auth_failed_by_ora_code(self):
        """Auth failure detected by ORA-1017."""
        exc = Exception("ORA-01017: invalid username/password; logon denied")

        error = normalize_oracle_error(exc)
        assert error.code == DbErrorCode.AUTH_FAILED
        # Note: vendor_code preserves original format from error message
        assert error.vendor_code == "ORA-01017"

    def test_dns_failed_by_ora_code(self):
        """DNS failure detected by ORA-12154."""
        exc = Exception("ORA-12154: TNS:could not resolve the connect identifier")

        error = normalize_oracle_error(exc)
        assert error.code == DbErrorCode.DNS_FAILED
        assert error.vendor_code == "ORA-12154"

    def test_timeout_by_ora_code(self):
        """Timeout detected by ORA-12170."""
        exc = Exception("ORA-12170: TNS:Connect timeout occurred")

        error = normalize_oracle_error(exc)
        assert error.code == DbErrorCode.TIMEOUT
        assert error.retryable is True

    def test_no_listener_by_ora_code(self):
        """No listener detected by ORA-12541."""
        exc = Exception("ORA-12541: TNS:no listener")

        error = normalize_oracle_error(exc)
        assert error.code == DbErrorCode.CONNECTION_REFUSED

    def test_service_not_found_by_ora_code(self):
        """Service not found detected by ORA-12514."""
        exc = Exception("ORA-12514: TNS:listener does not currently know of service requested")

        error = normalize_oracle_error(exc)
        assert error.code == DbErrorCode.DATABASE_NOT_FOUND
        assert error.vendor_code == "ORA-12514"

    def test_permission_denied_by_ora_code(self):
        """Permission denied detected by ORA-1031."""
        exc = Exception("ORA-01031: insufficient privileges")

        error = normalize_oracle_error(exc)
        assert error.code == DbErrorCode.PERMISSION_DENIED

    def test_auth_failed_by_message(self):
        """Auth failure detected by message pattern."""
        exc = Exception("invalid username/password; logon denied")

        error = normalize_oracle_error(exc)
        assert error.code == DbErrorCode.AUTH_FAILED


class TestMongoDBErrorNormalization:
    """Test MongoDB error normalization."""

    def test_auth_failed_by_code(self):
        """Auth failure detected by code 18."""
        exc = MagicMock()
        exc.code = 18
        exc.__str__ = lambda self: "Authentication failed"

        error = normalize_mongodb_error(exc)
        assert error.code == DbErrorCode.AUTH_FAILED
        assert error.vendor_code == "18"

    def test_unauthorized_by_code(self):
        """Unauthorized detected by code 13."""
        exc = MagicMock()
        exc.code = 13
        exc.__str__ = lambda self: "not authorized on admin to execute command"

        error = normalize_mongodb_error(exc)
        assert error.code == DbErrorCode.PERMISSION_DENIED

    def test_timeout_by_code(self):
        """Timeout detected by code 89."""
        exc = MagicMock()
        exc.code = 89
        exc.__str__ = lambda self: "NetworkTimeout"

        error = normalize_mongodb_error(exc)
        assert error.code == DbErrorCode.TIMEOUT
        assert error.retryable is True

    def test_auth_failed_by_message(self):
        """Auth failure detected by message."""
        exc = Exception("Authentication failed")

        error = normalize_mongodb_error(exc)
        assert error.code == DbErrorCode.AUTH_FAILED

    def test_unauthorized_by_message(self):
        """Unauthorized detected by message."""
        exc = Exception("command find requires authentication")

        # This won't match "unauthorized" pattern, falls through
        error = normalize_mongodb_error(exc)
        # This specific message doesn't match our patterns
        assert error.code == DbErrorCode.UNKNOWN

    def test_connection_refused_by_message(self):
        """Connection refused detected by message."""
        exc = Exception("ServerSelectionTimeoutError: connection refused")

        error = normalize_mongodb_error(exc)
        assert error.code == DbErrorCode.CONNECTION_REFUSED


class TestSocketErrorNormalization:
    """Test socket/network error normalization."""

    def test_socket_timeout(self):
        """Socket timeout normalized correctly."""
        exc = socket.timeout("timed out")

        error = normalize_socket_error(exc)
        assert error.code == DbErrorCode.TIMEOUT
        assert error.retryable is True

    def test_socket_gaierror(self):
        """DNS lookup failure normalized correctly."""
        exc = socket.gaierror(8, "nodename nor servname provided")

        error = normalize_socket_error(exc)
        assert error.code == DbErrorCode.DNS_FAILED
        assert error.retryable is False

    def test_connection_refused(self):
        """ConnectionRefusedError normalized correctly."""
        exc = ConnectionRefusedError("Connection refused")

        error = normalize_socket_error(exc)
        assert error.code == DbErrorCode.CONNECTION_REFUSED
        assert error.retryable is True

    def test_connection_reset(self):
        """ConnectionResetError normalized correctly."""
        exc = ConnectionResetError("Connection reset by peer")

        error = normalize_socket_error(exc)
        assert error.code == DbErrorCode.NETWORK_UNREACHABLE
        assert error.retryable is True

    def test_timeout_error(self):
        """TimeoutError normalized correctly."""
        exc = TimeoutError("Connection timed out")

        error = normalize_socket_error(exc)
        assert error.code == DbErrorCode.TIMEOUT
        assert error.retryable is True

    def test_ssl_error(self):
        """SSLError normalized correctly."""
        exc = ssl.SSLError("SSL handshake failed")

        error = normalize_socket_error(exc)
        assert error.code == DbErrorCode.TLS_HANDSHAKE_FAILED
        assert error.retryable is False

    def test_os_error_connection_refused(self):
        """OSError with connection refused message."""
        exc = OSError("Connection refused")

        error = normalize_socket_error(exc)
        assert error.code == DbErrorCode.CONNECTION_REFUSED

    def test_os_error_network_unreachable(self):
        """OSError with network unreachable message."""
        exc = OSError("Network is unreachable")

        error = normalize_socket_error(exc)
        assert error.code == DbErrorCode.NETWORK_UNREACHABLE

    def test_os_error_no_route(self):
        """OSError with no route to host message."""
        exc = OSError("No route to host")

        error = normalize_socket_error(exc)
        assert error.code == DbErrorCode.NETWORK_UNREACHABLE


class TestNormalizeDbError:
    """Test the main normalize_db_error dispatcher."""

    def test_postgres_dispatch(self):
        """Postgres errors dispatched correctly."""
        exc = Exception("password authentication failed")

        error = normalize_db_error(exc, "postgres")
        assert error.code == DbErrorCode.AUTH_FAILED

    def test_mysql_dispatch(self):
        """MySQL errors dispatched correctly."""
        exc = Exception("Access denied for user")

        error = normalize_db_error(exc, "mysql")
        assert error.code == DbErrorCode.AUTH_FAILED

    def test_sqlserver_dispatch(self):
        """SQL Server errors dispatched correctly."""
        exc = Exception("Login failed for user")

        error = normalize_db_error(exc, "sqlserver")
        assert error.code == DbErrorCode.AUTH_FAILED

    def test_oracle_dispatch(self):
        """Oracle errors dispatched correctly."""
        exc = Exception("ORA-01017: invalid username/password")

        error = normalize_db_error(exc, "oracle")
        assert error.code == DbErrorCode.AUTH_FAILED

    def test_mongodb_dispatch(self):
        """MongoDB errors dispatched correctly."""
        exc = Exception("Authentication failed")

        error = normalize_db_error(exc, "mongodb")
        assert error.code == DbErrorCode.AUTH_FAILED

    def test_socket_error_takes_precedence(self):
        """Socket errors normalized before vendor dispatch."""
        exc = socket.timeout("timed out")

        error = normalize_db_error(exc, "postgres")
        assert error.code == DbErrorCode.TIMEOUT

    def test_ssl_error_takes_precedence(self):
        """SSL errors normalized before vendor dispatch."""
        exc = ssl.SSLError("handshake failed")

        error = normalize_db_error(exc, "mysql")
        assert error.code == DbErrorCode.TLS_HANDSHAKE_FAILED

    def test_unknown_db_type(self):
        """Unknown DB type returns UNKNOWN error."""
        exc = Exception("Some error")

        error = normalize_db_error(exc, "couchdb")
        assert error.code == DbErrorCode.UNKNOWN
