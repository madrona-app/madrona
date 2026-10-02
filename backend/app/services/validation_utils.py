"""
Validation utilities for safe input parsing.

Provides safe conversion functions that handle invalid input gracefully
instead of raising exceptions that crash the application.

Integration with app.exceptions:
    For exception-based error handling (recommended for new code), use:
    - raise InvalidUUIDError("field_name") instead of returning error dicts
    - raise ValidationError("message", details={...})
"""

import logging
from typing import Optional, Any
from uuid import UUID

from app.exceptions import InvalidUUIDError, ValidationError as MadronaValidationError

logger = logging.getLogger(__name__)


def safe_int(
    value: Optional[str],
    default: int = 0,
    min_val: Optional[int] = None,
    max_val: Optional[int] = None,
) -> int:
    """
    Safely parse an integer from string with bounds checking.

    Args:
        value: String value to parse (or None)
        default: Default value if parsing fails
        min_val: Minimum allowed value (inclusive)
        max_val: Maximum allowed value (inclusive)

    Returns:
        Parsed integer within bounds, or default on failure

    Example:
        limit = safe_int(request.args.get("limit"), default=50, max_val=100)
    """
    if value is None:
        result = default
    else:
        try:
            result = int(value)
        except (ValueError, TypeError):
            result = default

    if min_val is not None and result < min_val:
        result = min_val
    if max_val is not None and result > max_val:
        result = max_val

    return result


def safe_uuid(
    value: Optional[str],
    default: Optional[UUID] = None,
) -> Optional[UUID]:
    """
    Safely parse a UUID from string.

    Args:
        value: String value to parse (or None)
        default: Default value if parsing fails

    Returns:
        Parsed UUID or default on failure

    Example:
        org_id = safe_uuid(request.args.get("organization_id"))
        if org_id is None:
            return jsonify({"error": "Invalid organization_id"}), 400
    """
    if value is None:
        return default

    try:
        return UUID(value)
    except (ValueError, TypeError, AttributeError):
        return default


def require_uuid(value: Optional[str], field_name: str = "id") -> tuple[Optional[UUID], Optional[dict]]:
    """
    Parse a required UUID, returning error response if invalid.

    Args:
        value: String value to parse
        field_name: Field name for error message

    Returns:
        Tuple of (parsed_uuid, error_response)
        - If valid: (uuid, None)
        - If invalid: (None, {"error": "...", "field": "..."})

    Example:
        org_id, error = require_uuid(organization_id, "organization_id")
        if error:
            return jsonify(error), 400

    Note: For new code, consider using parse_uuid_or_raise() instead for cleaner code.
    """
    if value is None:
        return None, {"error": f"{field_name} is required", "field": field_name}

    try:
        return UUID(value), None
    except (ValueError, TypeError, AttributeError):
        return None, {"error": f"Invalid {field_name} format", "field": field_name}


def parse_uuid_or_raise(value: Optional[str], field_name: str = "id") -> UUID:
    """
    Parse a required UUID, raising InvalidUUIDError if invalid.

    This is the exception-based alternative to require_uuid() for cleaner code.
    The raised exception is automatically caught by the global error handler.

    Args:
        value: String value to parse
        field_name: Field name for error message

    Returns:
        Parsed UUID

    Raises:
        InvalidUUIDError: If value is None or not a valid UUID

    Example:
        from app.services.validation_utils import parse_uuid_or_raise

        @bp.route("/<object_id>")
        def get_object(object_id: str):
            obj_uuid = parse_uuid_or_raise(object_id, "object_id")
            # No need for error handling - exception is caught globally
            obj = db.session.query(Object).get(obj_uuid)
            ...
    """
    if value is None:
        raise InvalidUUIDError(field_name)

    try:
        return UUID(value)
    except (ValueError, TypeError, AttributeError):
        raise InvalidUUIDError(field_name)


def require_field(data: dict, field_name: str, field_type: type = str) -> Any:
    """
    Validate that a required field exists in request data.

    Args:
        data: Request data dictionary
        field_name: Name of the required field
        field_type: Expected type of the field (default: str)

    Returns:
        The field value

    Raises:
        MadronaValidationError: If field is missing or wrong type

    Example:
        data = request.get_json()
        name = require_field(data, "name")
        count = require_field(data, "count", int)
    """
    if field_name not in data:
        raise MadronaValidationError(
            f"Missing required field: {field_name}",
            details={"field": field_name}
        )

    value = data[field_name]

    if value is None:
        raise MadronaValidationError(
            f"Field cannot be null: {field_name}",
            details={"field": field_name}
        )

    if not isinstance(value, field_type):
        raise MadronaValidationError(
            f"Field '{field_name}' must be of type {field_type.__name__}",
            details={"field": field_name, "expected_type": field_type.__name__}
        )

    return value


def safe_bool(
    value: Optional[str],
    default: bool = False,
) -> bool:
    """
    Safely parse a boolean from string.

    Accepts: 'true', '1', 'yes', 'on' (case-insensitive) as True
    All other values return False or default.

    Args:
        value: String value to parse (or None)
        default: Default value if value is None

    Returns:
        Parsed boolean

    Example:
        include_deleted = safe_bool(request.args.get("include_deleted"), default=False)
    """
    if value is None:
        return default

    return str(value).lower() in ('true', '1', 'yes', 'on')


def validate_pagination(
    limit: Optional[str] = None,
    offset: Optional[str] = None,
    default_limit: int = 50,
    max_limit: int = 100,
) -> tuple[int, int]:
    """
    Validate and parse pagination parameters.

    Args:
        limit: Limit string from request
        offset: Offset string from request
        default_limit: Default limit if not specified
        max_limit: Maximum allowed limit

    Returns:
        Tuple of (limit, offset) with validated values

    Example:
        limit, offset = validate_pagination(
            request.args.get("limit"),
            request.args.get("offset"),
        )
    """
    return (
        safe_int(limit, default=default_limit, min_val=1, max_val=max_limit),
        safe_int(offset, default=0, min_val=0),
    )


def paginate_query(
    query,
    limit: int,
    offset: int,
    serialize_fn=None,
) -> dict:
    """
    Execute a paginated query and return standardized response.

    Args:
        query: SQLAlchemy query object
        limit: Number of results to return
        offset: Number of results to skip
        serialize_fn: Optional function to serialize each result.
                      If None, results are returned as-is.

    Returns:
        Dict with keys: results, total, limit, offset, has_more

    Example:
        query = db.session.query(Object).filter_by(org_id=org_id)
        limit, offset = validate_pagination(request.args.get("limit"), request.args.get("offset"))
        return jsonify(paginate_query(query, limit, offset, lambda x: x.to_dict()))
    """
    total = query.count()
    items = query.limit(limit).offset(offset).all()

    if serialize_fn:
        results = [serialize_fn(item) for item in items]
    else:
        results = items

    return {
        "results": results,
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": offset + len(items) < total,
    }
