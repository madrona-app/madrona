"""
Shared API Security Helpers.

Reusable security utilities for input validation, error sanitization,
and protection against common vulnerabilities across all API modules.

Usage:
    from app.services.api_security import (
        escape_ilike,
        sanitize_error_message,
        validate_email,
        validate_enum,
        validate_positive_int,
        validate_hex_color,
        validate_date_string,
    )
"""

import re
import logging
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)


# =============================================================================
# ILIKE INJECTION PREVENTION
# =============================================================================

def escape_ilike(search_term: str) -> str:
    """
    Escape PostgreSQL ILIKE special characters to prevent pattern injection.

    ILIKE treats %, _, and \\ as wildcards/escape characters.
    This function escapes them so they're treated as literals.

    Usage:
        query = query.filter(
            Model.field.ilike(f"%{escape_ilike(search)}%", escape="\\\\")
        )

    Args:
        search_term: User-provided search string

    Returns:
        Escaped search string safe for ILIKE queries
    """
    if not search_term:
        return search_term
    # Escape backslash first (since it's the escape character)
    search_term = search_term.replace("\\", "\\\\")
    # Escape % and _
    search_term = search_term.replace("%", "\\%")
    search_term = search_term.replace("_", "\\_")
    return search_term


# =============================================================================
# ERROR MESSAGE SANITIZATION
# =============================================================================

# Patterns that indicate internal/sensitive error details
_SENSITIVE_PATTERNS = [
    # Database errors
    "sqlalchemy", "psycopg", "postgresql", "database", "integrity",
    "constraint", "foreign key", "unique violation", "duplicate key",
    # File system errors
    "/users/", "/home/", "/var/", "/tmp/", "/app/", "file not found",
    "permission denied", "no such file", "errno",
    # Connection errors
    "connection refused", "timeout", "unreachable", "network",
    # Stack traces
    "traceback", "line ", "  file ", "raise ", "exception",
    # Internal details
    "internal", "secret", "password", "token", "key",
]


def sanitize_error_message(error: Exception | str) -> str:
    """
    Sanitize error messages for client consumption.

    Removes internal details like file paths, stack traces, and database errors
    while preserving useful information for users.

    Args:
        error: Exception object or error string

    Returns:
        Safe error message suitable for API responses
    """
    error_str = str(error) if error else ""

    if not error_str:
        return "An unexpected error occurred."

    lower_msg = error_str.lower()

    # Check for sensitive patterns
    for pattern in _SENSITIVE_PATTERNS:
        if pattern in lower_msg:
            # Log the full error for debugging
            logger.debug(f"Sanitized error containing '{pattern}': {error_str[:200]}")
            return "An unexpected error occurred. Please try again or contact support."

    # If the error message is very long, it's likely a stack trace
    if len(error_str) > 500:
        return "An error occurred while processing your request."

    # Default to generic message — only MadronaError messages (which are
    # explicitly written for users) should reach clients unmodified.
    # Unknown error strings may contain internal identifiers or third-party
    # details (e.g. Stripe customer IDs, AWS request IDs).
    return "An unexpected error occurred. Please try again or contact support."


def generic_error_response() -> dict:
    """
    Return a generic error response dict for internal server errors.

    Usage:
        except Exception as e:
            logger.error(f"Error: {e}", exc_info=True)
            return jsonify({"error": generic_error_response()}), 500
    """
    return {
        "code": "INTERNAL_ERROR",
        "message": "An unexpected error occurred. Please try again or contact support."
    }


# =============================================================================
# INPUT VALIDATION
# =============================================================================

# Email validation pattern - RFC 5322 simplified
_EMAIL_PATTERN = re.compile(
    r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"
)

# Hex color pattern - #RRGGBB or #RRGGBBAA
_HEX_COLOR_PATTERN = re.compile(
    r"^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$"
)


def validate_email(email: str | None) -> tuple[bool, str | None]:
    """
    Validate email address format.

    Args:
        email: Email string to validate

    Returns:
        Tuple of (is_valid, error_message)
    """
    if not email:
        return True, None  # Empty is allowed (field may be optional)

    if not isinstance(email, str):
        return False, "Email must be a string"

    email = email.strip()
    if len(email) > 254:  # RFC 5321 limit
        return False, "Email address is too long"

    if not _EMAIL_PATTERN.match(email):
        return False, "Invalid email format"

    return True, None


def validate_enum(
    value: str | None,
    valid_values: set[str],
    field_name: str,
    allow_none: bool = True,
) -> tuple[bool, str | None]:
    """
    Validate that a value is one of the allowed enum values.

    Args:
        value: Value to validate
        valid_values: Set of allowed values
        field_name: Name of field for error message
        allow_none: Whether None/empty is allowed

    Returns:
        Tuple of (is_valid, error_message)
    """
    if value is None or value == "":
        if allow_none:
            return True, None
        return False, f"{field_name} is required"

    if value not in valid_values:
        return False, f"{field_name} must be one of: {', '.join(sorted(valid_values))}"

    return True, None


def validate_positive_int(
    value: Any,
    field_name: str,
    min_value: int = 0,
    max_value: int = 1000000,
    allow_none: bool = True,
) -> tuple[bool, str | None]:
    """
    Validate that a value is a positive integer within range.

    Args:
        value: Value to validate
        field_name: Name of field for error message
        min_value: Minimum allowed value (inclusive)
        max_value: Maximum allowed value (inclusive)
        allow_none: Whether None is allowed

    Returns:
        Tuple of (is_valid, error_message)
    """
    if value is None:
        if allow_none:
            return True, None
        return False, f"{field_name} is required"

    try:
        int_val = int(value)
    except (ValueError, TypeError):
        return False, f"{field_name} must be a valid integer"

    if int_val < min_value:
        return False, f"{field_name} must be at least {min_value}"

    if int_val > max_value:
        return False, f"{field_name} cannot exceed {max_value}"

    return True, None


def validate_positive_decimal(
    value: Any,
    field_name: str,
    min_value: float = 0,
    max_value: float = 1000000,
    allow_none: bool = True,
    allow_zero: bool = True,
) -> tuple[bool, str | None]:
    """
    Validate that a value is a positive decimal within range.

    Args:
        value: Value to validate
        field_name: Name of field for error message
        min_value: Minimum allowed value
        max_value: Maximum allowed value
        allow_none: Whether None is allowed
        allow_zero: Whether zero is allowed

    Returns:
        Tuple of (is_valid, error_message)
    """
    if value is None:
        if allow_none:
            return True, None
        return False, f"{field_name} is required"

    try:
        float_val = float(value)
    except (ValueError, TypeError):
        return False, f"{field_name} must be a valid number"

    if not allow_zero and float_val == 0:
        return False, f"{field_name} cannot be zero"

    if float_val < min_value:
        return False, f"{field_name} must be at least {min_value}"

    if float_val > max_value:
        return False, f"{field_name} cannot exceed {max_value}"

    return True, None


def validate_hex_color(color: str | None) -> tuple[bool, str | None]:
    """
    Validate hex color format (#RRGGBB or #RRGGBBAA).

    Args:
        color: Color string to validate

    Returns:
        Tuple of (is_valid, error_message)
    """
    if not color:
        return True, None  # Empty is allowed

    if not isinstance(color, str):
        return False, "Color must be a string"

    if not _HEX_COLOR_PATTERN.match(color):
        return False, "Color must be in hex format (#RRGGBB or #RRGGBBAA)"

    return True, None


def validate_date_string(
    date_str: str | None,
    field_name: str,
    allow_none: bool = True,
) -> tuple[datetime | None, str | None]:
    """
    Validate and parse an ISO format date string.

    Args:
        date_str: Date string in ISO format (YYYY-MM-DD or full ISO)
        field_name: Name of field for error message
        allow_none: Whether None/empty is allowed

    Returns:
        Tuple of (parsed_datetime_or_None, error_message)
    """
    if not date_str:
        if allow_none:
            return None, None
        return None, f"{field_name} is required"

    try:
        # Handle both date-only and full ISO formats
        if "T" in date_str:
            parsed = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
        else:
            parsed = datetime.strptime(date_str, "%Y-%m-%d")
        return parsed, None
    except ValueError:
        return None, f"{field_name} must be a valid date (YYYY-MM-DD format)"


def validate_date_range(
    start_str: str | None,
    end_str: str | None,
    start_field: str = "start_date",
    end_field: str = "end_date",
) -> tuple[tuple[datetime | None, datetime | None] | None, str | None]:
    """
    Validate a date range ensuring start <= end.

    Args:
        start_str: Start date string
        end_str: End date string
        start_field: Name of start field for error message
        end_field: Name of end field for error message

    Returns:
        Tuple of ((start_date, end_date), error_message)
    """
    start_date, start_error = validate_date_string(start_str, start_field)
    if start_error:
        return None, start_error

    end_date, end_error = validate_date_string(end_str, end_field)
    if end_error:
        return None, end_error

    if start_date and end_date and start_date > end_date:
        return None, f"{start_field} must be before or equal to {end_field}"

    return (start_date, end_date), None


# =============================================================================
# PAGINATION VALIDATION
# =============================================================================

def validate_pagination(
    offset: Any,
    limit: Any,
    max_limit: int = 500,
    max_offset: int = 1000000,
) -> tuple[tuple[int, int] | None, str | None]:
    """
    Validate pagination parameters.

    Args:
        offset: Offset value from request
        limit: Limit value from request
        max_limit: Maximum allowed limit
        max_offset: Maximum allowed offset

    Returns:
        Tuple of ((validated_offset, validated_limit), error_message)
    """
    # Validate offset
    try:
        offset_int = int(offset) if offset is not None else 0
    except (ValueError, TypeError):
        return None, "offset must be a valid integer"

    if offset_int < 0:
        return None, "offset cannot be negative"

    if offset_int > max_offset:
        return None, f"offset cannot exceed {max_offset}"

    # Validate limit
    try:
        limit_int = int(limit) if limit is not None else 50
    except (ValueError, TypeError):
        return None, "limit must be a valid integer"

    if limit_int < 1:
        return None, "limit must be at least 1"

    if limit_int > max_limit:
        limit_int = max_limit  # Cap at max rather than error

    return (offset_int, limit_int), None
