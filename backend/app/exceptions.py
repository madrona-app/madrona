"""
Custom exception hierarchy for Madrona backend.

Provides structured error handling with standardized error codes and HTTP status codes.
All exceptions inherit from MadronaError and are caught by the global error handler
in main.py to return consistent JSON error responses.

Usage:
    from app.exceptions import ValidationError, NotFoundError, DuplicateError

    # Raise with default message
    raise NotFoundError("Object not found")

    # Raise with additional details
    raise ValidationError("Invalid input", details={"field": "email", "issue": "invalid format"})
"""

from typing import Any


class MadronaError(Exception):
    """
    Base exception for all Madrona application errors.

    Attributes:
        code: Machine-readable error code (e.g., "VALIDATION_ERROR")
        status_code: HTTP status code to return
        message: Human-readable error message
        details: Additional error context (optional)
    """

    code: str = "INTERNAL_ERROR"
    status_code: int = 500

    def __init__(
        self,
        message: str = "An internal error occurred",
        details: dict[str, Any] | None = None,
    ):
        super().__init__(message)
        self.message = message
        self.details = details or {}

    def to_dict(self) -> dict[str, Any]:
        """Convert exception to JSON-serializable dictionary."""
        return {
            "error": {
                "code": self.code,
                "message": self.message,
                "details": self.details,
            }
        }


class ValidationError(MadronaError):
    """
    Raised when request data fails validation.

    Examples:
        - Missing required field
        - Invalid field format
        - Value out of range
        - Invalid UUID format
    """

    code = "VALIDATION_ERROR"
    status_code = 400


class NotFoundError(MadronaError):
    """
    Raised when a requested resource does not exist.

    Examples:
        - Object with given ID not found
        - User not found
        - File not found
    """

    code = "NOT_FOUND"
    status_code = 404


class DuplicateError(MadronaError):
    """
    Raised when attempting to create a resource that already exists.

    Examples:
        - Unique constraint violation
        - Duplicate email address
        - Duplicate object number
    """

    code = "DUPLICATE"
    status_code = 409


class AuthorizationError(MadronaError):
    """
    Raised when user lacks permission to perform an action.

    Note: This is for authorization (permission) errors, not authentication.
    For authentication errors (invalid credentials), use 401 Unauthorized.

    Examples:
        - User not a member of organization
        - User lacks required role
        - Resource belongs to different organization
    """

    code = "FORBIDDEN"
    status_code = 403


class AuthenticationError(MadronaError):
    """
    Raised when authentication fails.

    Examples:
        - Invalid or expired token
        - Missing authentication credentials
        - Invalid credentials
    """

    code = "AUTHENTICATION_ERROR"
    status_code = 401


class RateLimitError(MadronaError):
    """
    Raised when rate limit is exceeded.

    Examples:
        - Too many login attempts
        - API rate limit exceeded
    """

    code = "RATE_LIMIT_EXCEEDED"
    status_code = 429


class ConflictError(MadronaError):
    """
    Raised when an action conflicts with current state.

    Examples:
        - Concurrent modification conflict
        - State transition not allowed
        - Resource is locked
    """

    code = "CONFLICT"
    status_code = 409


class ExternalServiceError(MadronaError):
    """
    Raised when an external service call fails.

    Examples:
        - AWS S3 operation failed
        - OpenSearch unavailable
        - Email service error
    """

    code = "EXTERNAL_SERVICE_ERROR"
    status_code = 502


class InvalidUUIDError(ValidationError):
    """
    Raised when a UUID parameter is invalid.

    Convenience subclass of ValidationError for the common case
    of invalid UUID format in path parameters or request body.
    """

    code = "INVALID_UUID"

    def __init__(self, field_name: str = "id"):
        super().__init__(
            message=f"Invalid UUID format for {field_name}",
            details={"field": field_name},
        )
