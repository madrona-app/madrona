"""
Database connector error normalization.

Provides a consistent error classification system for database connectivity errors.
Maps vendor-specific errors to normalized error codes for consistent API responses.
"""

from dataclasses import dataclass
from enum import Enum
from typing import Any
import re
import socket
import ssl


class DbErrorCode(str, Enum):
    """Normalized database error codes."""

    AUTH_FAILED = "AUTH_FAILED"
    NETWORK_UNREACHABLE = "NETWORK_UNREACHABLE"
    TLS_HANDSHAKE_FAILED = "TLS_HANDSHAKE_FAILED"
    DNS_FAILED = "DNS_FAILED"
    TIMEOUT = "TIMEOUT"
    PERMISSION_DENIED = "PERMISSION_DENIED"
    UNSUPPORTED_FEATURE = "UNSUPPORTED_FEATURE"
    CONNECTION_REFUSED = "CONNECTION_REFUSED"
    DATABASE_NOT_FOUND = "DATABASE_NOT_FOUND"
    UNKNOWN = "UNKNOWN"


@dataclass
class DbError(Exception):
    """Normalized database error representation."""

    code: DbErrorCode
    message: str
    vendor_code: str | None = None
    retryable: bool = False

    def __str__(self) -> str:
        return self.message

    def to_dict(self) -> dict[str, Any]:
        """Convert to API response format."""
        return {
            "code": self.code.value,
            "message": self.message,
            "vendorCode": self.vendor_code,
            "retryable": self.retryable,
        }


# PostgreSQL error code mappings (SQLSTATE codes)
POSTGRES_ERROR_MAP: dict[str, tuple[DbErrorCode, bool]] = {
    # Authentication failures
    "28000": (DbErrorCode.AUTH_FAILED, False),  # Invalid authorization specification
    "28P01": (DbErrorCode.AUTH_FAILED, False),  # Invalid password
    # Permission denied
    "42501": (DbErrorCode.PERMISSION_DENIED, False),  # Insufficient privilege
    "42000": (DbErrorCode.PERMISSION_DENIED, False),  # Syntax error or access violation
    # Database not found
    "3D000": (DbErrorCode.DATABASE_NOT_FOUND, False),  # Invalid catalog name
    # Connection issues
    "08000": (DbErrorCode.NETWORK_UNREACHABLE, True),  # Connection exception
    "08001": (DbErrorCode.CONNECTION_REFUSED, True),  # SQL client unable to establish connection
    "08003": (DbErrorCode.NETWORK_UNREACHABLE, True),  # Connection does not exist
    "08004": (DbErrorCode.AUTH_FAILED, False),  # Server rejected connection
    "08006": (DbErrorCode.NETWORK_UNREACHABLE, True),  # Connection failure
    "08007": (DbErrorCode.NETWORK_UNREACHABLE, True),  # Transaction resolution unknown
    # Feature not supported
    "0A000": (DbErrorCode.UNSUPPORTED_FEATURE, False),  # Feature not supported
}

# MySQL error code mappings (errno values)
MYSQL_ERROR_MAP: dict[int, tuple[DbErrorCode, bool]] = {
    # Authentication failures
    1045: (DbErrorCode.AUTH_FAILED, False),  # Access denied for user
    1044: (DbErrorCode.PERMISSION_DENIED, False),  # Access denied for user to database
    1698: (DbErrorCode.AUTH_FAILED, False),  # Access denied (unix_socket auth)
    # Connection issues
    2002: (DbErrorCode.CONNECTION_REFUSED, True),  # Can't connect to server
    2003: (DbErrorCode.CONNECTION_REFUSED, True),  # Can't connect to MySQL server
    2005: (DbErrorCode.DNS_FAILED, False),  # Unknown MySQL server host
    2006: (DbErrorCode.NETWORK_UNREACHABLE, True),  # MySQL server has gone away
    2013: (DbErrorCode.TIMEOUT, True),  # Lost connection during query
    # Database not found
    1049: (DbErrorCode.DATABASE_NOT_FOUND, False),  # Unknown database
    # Permission denied
    1142: (DbErrorCode.PERMISSION_DENIED, False),  # Command denied
    1143: (DbErrorCode.PERMISSION_DENIED, False),  # Column command denied
    1227: (DbErrorCode.PERMISSION_DENIED, False),  # Access denied; need privilege
    # SSL/TLS
    2026: (DbErrorCode.TLS_HANDSHAKE_FAILED, False),  # SSL connection error
}

# SQL Server error code mappings
SQLSERVER_ERROR_MAP: dict[int, tuple[DbErrorCode, bool]] = {
    # Authentication failures
    18456: (DbErrorCode.AUTH_FAILED, False),  # Login failed
    18452: (DbErrorCode.AUTH_FAILED, False),  # Login failed (untrusted domain)
    # Connection issues
    53: (DbErrorCode.NETWORK_UNREACHABLE, True),  # Named Pipes error
    -1: (DbErrorCode.CONNECTION_REFUSED, True),  # Connection timeout
    10054: (DbErrorCode.NETWORK_UNREACHABLE, True),  # Connection reset
    10060: (DbErrorCode.TIMEOUT, True),  # Connection timeout
    10061: (DbErrorCode.CONNECTION_REFUSED, True),  # Connection refused
    # Database not found
    4060: (DbErrorCode.DATABASE_NOT_FOUND, False),  # Cannot open database
    # Permission denied
    229: (DbErrorCode.PERMISSION_DENIED, False),  # Execute permission denied
    262: (DbErrorCode.PERMISSION_DENIED, False),  # CREATE permission denied
}

# Oracle error code mappings (ORA- codes)
ORACLE_ERROR_MAP: dict[int, tuple[DbErrorCode, bool]] = {
    # Authentication failures
    1017: (DbErrorCode.AUTH_FAILED, False),  # Invalid username/password
    1005: (DbErrorCode.AUTH_FAILED, False),  # Null password given
    1031: (DbErrorCode.PERMISSION_DENIED, False),  # Insufficient privileges
    # Connection issues
    12154: (DbErrorCode.DNS_FAILED, False),  # TNS could not resolve
    12170: (DbErrorCode.TIMEOUT, True),  # TNS connect timeout
    12541: (DbErrorCode.CONNECTION_REFUSED, True),  # TNS no listener
    12543: (DbErrorCode.NETWORK_UNREACHABLE, True),  # TNS destination host unreachable
    12547: (DbErrorCode.NETWORK_UNREACHABLE, True),  # TNS lost contact
    12514: (DbErrorCode.DATABASE_NOT_FOUND, False),  # TNS listener does not know of service
    12505: (DbErrorCode.DATABASE_NOT_FOUND, False),  # TNS listener does not know of SID
    # SSL/TLS
    28860: (DbErrorCode.TLS_HANDSHAKE_FAILED, False),  # Fatal SSL error
    28864: (DbErrorCode.TLS_HANDSHAKE_FAILED, False),  # SSL connection closed
}

# MongoDB error code mappings
MONGODB_ERROR_MAP: dict[int, tuple[DbErrorCode, bool]] = {
    # Authentication failures
    18: (DbErrorCode.AUTH_FAILED, False),  # AuthenticationFailed
    # Network issues
    6: (DbErrorCode.NETWORK_UNREACHABLE, True),  # HostUnreachable
    7: (DbErrorCode.NETWORK_UNREACHABLE, True),  # HostNotFound (actually DNS)
    # Permission denied
    13: (DbErrorCode.PERMISSION_DENIED, False),  # Unauthorized
    # Other
    89: (DbErrorCode.TIMEOUT, True),  # NetworkTimeout
}


def normalize_postgres_error(exc: Exception) -> DbError:
    """Normalize a PostgreSQL exception to DbError."""
    error_msg = str(exc)
    vendor_code = None

    # Try to extract SQLSTATE code
    if hasattr(exc, "pgcode"):
        vendor_code = exc.pgcode
        if vendor_code in POSTGRES_ERROR_MAP:
            code, retryable = POSTGRES_ERROR_MAP[vendor_code]
            return DbError(
                code=code,
                message=error_msg,
                vendor_code=vendor_code,
                retryable=retryable,
            )

    # Pattern matching for common error messages
    error_lower = error_msg.lower()

    if "password authentication failed" in error_lower or "authentication failed" in error_lower:
        return DbError(DbErrorCode.AUTH_FAILED, error_msg, vendor_code, False)

    if "could not connect to server" in error_lower or "connection refused" in error_lower:
        return DbError(DbErrorCode.CONNECTION_REFUSED, error_msg, vendor_code, True)

    if "timeout" in error_lower:
        return DbError(DbErrorCode.TIMEOUT, error_msg, vendor_code, True)

    if "ssl" in error_lower or "tls" in error_lower:
        return DbError(DbErrorCode.TLS_HANDSHAKE_FAILED, error_msg, vendor_code, False)

    if "database" in error_lower and "does not exist" in error_lower:
        return DbError(DbErrorCode.DATABASE_NOT_FOUND, error_msg, vendor_code, False)

    return DbError(DbErrorCode.UNKNOWN, error_msg, vendor_code, False)


def normalize_mysql_error(exc: Exception) -> DbError:
    """Normalize a MySQL exception to DbError."""
    error_msg = str(exc)
    vendor_code = None

    # Try to extract errno
    if hasattr(exc, "errno"):
        vendor_code = str(exc.errno)
        errno = exc.errno
        if errno in MYSQL_ERROR_MAP:
            code, retryable = MYSQL_ERROR_MAP[errno]
            return DbError(
                code=code,
                message=error_msg,
                vendor_code=vendor_code,
                retryable=retryable,
            )

    # Extract errno from error message pattern (errno, msg) or Error NNNN
    match = re.search(r"(?:errno[=:\s]+|Error\s+)(\d+)", error_msg, re.IGNORECASE)
    if match:
        vendor_code = match.group(1)
        errno = int(vendor_code)
        if errno in MYSQL_ERROR_MAP:
            code, retryable = MYSQL_ERROR_MAP[errno]
            return DbError(
                code=code,
                message=error_msg,
                vendor_code=vendor_code,
                retryable=retryable,
            )

    # Pattern matching fallback
    error_lower = error_msg.lower()

    if "access denied" in error_lower:
        return DbError(DbErrorCode.AUTH_FAILED, error_msg, vendor_code, False)

    if "can't connect" in error_lower or "connection refused" in error_lower:
        return DbError(DbErrorCode.CONNECTION_REFUSED, error_msg, vendor_code, True)

    if "unknown database" in error_lower:
        return DbError(DbErrorCode.DATABASE_NOT_FOUND, error_msg, vendor_code, False)

    if "ssl" in error_lower:
        return DbError(DbErrorCode.TLS_HANDSHAKE_FAILED, error_msg, vendor_code, False)

    return DbError(DbErrorCode.UNKNOWN, error_msg, vendor_code, False)


def normalize_sqlserver_error(exc: Exception) -> DbError:
    """Normalize a SQL Server exception to DbError."""
    error_msg = str(exc)
    vendor_code = None

    # Try to extract error number from pyodbc/pymssql
    if hasattr(exc, "args") and exc.args:
        # pyodbc format: ('HY000', '[HY000] [Microsoft][ODBC Driver]...')
        # pymssql format: (18456, b'Login failed...')
        if isinstance(exc.args[0], int):
            vendor_code = str(exc.args[0])
            errno = exc.args[0]
            if errno in SQLSERVER_ERROR_MAP:
                code, retryable = SQLSERVER_ERROR_MAP[errno]
                return DbError(
                    code=code,
                    message=error_msg,
                    vendor_code=vendor_code,
                    retryable=retryable,
                )

    # Extract error number from message
    match = re.search(r"(?:Error|Msg)\s+(\d+)", error_msg, re.IGNORECASE)
    if match:
        vendor_code = match.group(1)
        errno = int(vendor_code)
        if errno in SQLSERVER_ERROR_MAP:
            code, retryable = SQLSERVER_ERROR_MAP[errno]
            return DbError(
                code=code,
                message=error_msg,
                vendor_code=vendor_code,
                retryable=retryable,
            )

    # Pattern matching fallback
    error_lower = error_msg.lower()

    if "login failed" in error_lower:
        return DbError(DbErrorCode.AUTH_FAILED, error_msg, vendor_code, False)

    if "cannot open database" in error_lower:
        return DbError(DbErrorCode.DATABASE_NOT_FOUND, error_msg, vendor_code, False)

    if "connection" in error_lower and ("refused" in error_lower or "failed" in error_lower):
        return DbError(DbErrorCode.CONNECTION_REFUSED, error_msg, vendor_code, True)

    if "timeout" in error_lower:
        return DbError(DbErrorCode.TIMEOUT, error_msg, vendor_code, True)

    return DbError(DbErrorCode.UNKNOWN, error_msg, vendor_code, False)


def normalize_oracle_error(exc: Exception) -> DbError:
    """Normalize an Oracle exception to DbError."""
    error_msg = str(exc)
    vendor_code = None

    # Extract ORA-NNNNN from message
    match = re.search(r"ORA-(\d+)", error_msg)
    if match:
        vendor_code = f"ORA-{match.group(1)}"
        errno = int(match.group(1))
        if errno in ORACLE_ERROR_MAP:
            code, retryable = ORACLE_ERROR_MAP[errno]
            return DbError(
                code=code,
                message=error_msg,
                vendor_code=vendor_code,
                retryable=retryable,
            )

    # Pattern matching fallback
    error_lower = error_msg.lower()

    if "invalid username/password" in error_lower or "logon denied" in error_lower:
        return DbError(DbErrorCode.AUTH_FAILED, error_msg, vendor_code, False)

    if "tns" in error_lower:
        if "no listener" in error_lower:
            return DbError(DbErrorCode.CONNECTION_REFUSED, error_msg, vendor_code, True)
        if "could not resolve" in error_lower:
            return DbError(DbErrorCode.DNS_FAILED, error_msg, vendor_code, False)
        if "timeout" in error_lower:
            return DbError(DbErrorCode.TIMEOUT, error_msg, vendor_code, True)

    if "ssl" in error_lower:
        return DbError(DbErrorCode.TLS_HANDSHAKE_FAILED, error_msg, vendor_code, False)

    return DbError(DbErrorCode.UNKNOWN, error_msg, vendor_code, False)


def normalize_mongodb_error(exc: Exception) -> DbError:
    """Normalize a MongoDB exception to DbError."""
    error_msg = str(exc)
    vendor_code = None

    # PyMongo errors often have a 'code' attribute
    if hasattr(exc, "code"):
        vendor_code = str(exc.code)
        code_int = exc.code
        if code_int in MONGODB_ERROR_MAP:
            code, retryable = MONGODB_ERROR_MAP[code_int]
            return DbError(
                code=code,
                message=error_msg,
                vendor_code=vendor_code,
                retryable=retryable,
            )

    # Pattern matching fallback
    error_lower = error_msg.lower()

    if "authentication failed" in error_lower:
        return DbError(DbErrorCode.AUTH_FAILED, error_msg, vendor_code, False)

    if "unauthorized" in error_lower:
        return DbError(DbErrorCode.PERMISSION_DENIED, error_msg, vendor_code, False)

    if "connection refused" in error_lower or "serverselectiontimeouterror" in error_lower:
        return DbError(DbErrorCode.CONNECTION_REFUSED, error_msg, vendor_code, True)

    if "timeout" in error_lower:
        return DbError(DbErrorCode.TIMEOUT, error_msg, vendor_code, True)

    if "ssl" in error_lower or "tls" in error_lower:
        return DbError(DbErrorCode.TLS_HANDSHAKE_FAILED, error_msg, vendor_code, False)

    return DbError(DbErrorCode.UNKNOWN, error_msg, vendor_code, False)


def normalize_socket_error(exc: Exception) -> DbError:
    """Normalize common socket/network exceptions."""
    error_msg = str(exc)

    if isinstance(exc, socket.timeout):
        return DbError(DbErrorCode.TIMEOUT, error_msg, None, True)

    if isinstance(exc, socket.gaierror):
        # getaddrinfo error - typically DNS failure
        return DbError(DbErrorCode.DNS_FAILED, error_msg, None, False)

    if isinstance(exc, ConnectionRefusedError):
        return DbError(DbErrorCode.CONNECTION_REFUSED, error_msg, None, True)

    if isinstance(exc, ConnectionResetError):
        return DbError(DbErrorCode.NETWORK_UNREACHABLE, error_msg, None, True)

    if isinstance(exc, TimeoutError):
        return DbError(DbErrorCode.TIMEOUT, error_msg, None, True)

    if isinstance(exc, ssl.SSLError):
        return DbError(DbErrorCode.TLS_HANDSHAKE_FAILED, error_msg, None, False)

    if isinstance(exc, OSError):
        error_lower = error_msg.lower()
        if "connection refused" in error_lower:
            return DbError(DbErrorCode.CONNECTION_REFUSED, error_msg, None, True)
        if "network is unreachable" in error_lower:
            return DbError(DbErrorCode.NETWORK_UNREACHABLE, error_msg, None, True)
        if "no route to host" in error_lower:
            return DbError(DbErrorCode.NETWORK_UNREACHABLE, error_msg, None, True)

    return DbError(DbErrorCode.UNKNOWN, error_msg, None, False)


def normalize_db_error(exc: Exception, db_type: str) -> DbError:
    """
    Normalize any database exception to a DbError.

    Args:
        exc: The exception to normalize
        db_type: Database type (postgres, mysql, sqlserver, oracle, mongodb)

    Returns:
        Normalized DbError
    """
    # Check for common socket/network errors first
    if isinstance(exc, (socket.error, socket.timeout, socket.gaierror,
                        ConnectionRefusedError, ConnectionResetError,
                        TimeoutError, ssl.SSLError, OSError)):
        return normalize_socket_error(exc)

    # Delegate to vendor-specific normalizer
    normalizers = {
        "postgres": normalize_postgres_error,
        "mysql": normalize_mysql_error,
        "sqlserver": normalize_sqlserver_error,
        "oracle": normalize_oracle_error,
        "mongodb": normalize_mongodb_error,
    }

    normalizer = normalizers.get(db_type)
    if normalizer:
        return normalizer(exc)

    return DbError(DbErrorCode.UNKNOWN, str(exc), None, False)
