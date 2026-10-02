"""
Audit logging service for tracking sensitive operations.

This module provides decorators and utilities for audit logging of
create, update, delete, and other sensitive operations.

Usage:
    from app.services.audit import audit_log, log_audit_event

    @audit_log(action="create", resource_type="collection_object")
    def create_object(data):
        # ... implementation
        return new_object

    # Or log manually:
    log_audit_event(
        action="delete",
        resource_type="collection_object",
        resource_id="123",
        details={"reason": "deaccessioned"}
    )
"""

from datetime import datetime, timezone
from functools import wraps
from typing import Any, Callable, TypeVar

from app import context as ctx
from app.logging import get_logger

logger = get_logger(__name__)

# Type variable for generic function decoration
F = TypeVar('F', bound=Callable[..., Any])


def log_audit_event(
    action: str,
    resource_type: str,
    resource_id: str | None = None,
    details: dict[str, Any] | None = None,
    success: bool = True,
    error_message: str | None = None,
) -> None:
    """
    Log an audit event with structured context.

    Args:
        action: The action performed (create, update, delete, read, etc.)
        resource_type: Type of resource being acted upon
        resource_id: ID of the specific resource (if applicable)
        details: Additional details about the action
        success: Whether the action succeeded
        error_message: Error message if action failed
    """
    event_data: dict[str, Any] = {
        "action": action,
        "resource_type": resource_type,
        "success": success,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    if resource_id:
        event_data["resource_id"] = str(resource_id)

    if details:
        event_data["details"] = details

    if error_message:
        event_data["error_message"] = error_message

    # Add request context if available
    remote_addr = ctx.request_remote_addr.get()
    if remote_addr is not None:
        event_data["ip_address"] = remote_addr
        event_data["user_agent"] = (ctx.request_user_agent.get() or "unknown")[:200]

    # Add user context if available
    user_id = ctx.request_user_id.get()
    if user_id:
        event_data["user_id"] = str(user_id)
    org_id = ctx.current_org_id.get()
    if org_id:
        event_data["org_id"] = str(org_id)

    logger.info("audit_event", **event_data)


def audit_log(
    action: str,
    resource_type: str,
    resource_id_param: str | None = None,
    resource_id_from_result: Callable[[Any], str] | None = None,
    include_request_body: bool = False,
) -> Callable[[F], F]:
    """
    Decorator for automatic audit logging of function calls.

    Args:
        action: The action being performed (create, update, delete, etc.)
        resource_type: Type of resource being acted upon
        resource_id_param: Name of the parameter containing the resource ID
        resource_id_from_result: Function to extract resource ID from result
        include_request_body: Whether to include request body in audit log

    Returns:
        Decorated function that logs audit events

    Example:
        @audit_log(action="create", resource_type="collection_object", resource_id_from_result=lambda r: r.get("object_id"))
        def create_object():
            ...

        @audit_log(action="delete", resource_type="collection_object", resource_id_param="object_id")
        def delete_object(object_id: str):
            ...
    """
    def decorator(func: F) -> F:
        @wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            resource_id = None
            details: dict[str, Any] = {}

            # Try to get resource ID from parameters
            if resource_id_param and resource_id_param in kwargs:
                resource_id = kwargs[resource_id_param]

            # Include request body if configured
            # Note: request body inspection removed during Flask-to-FastAPI migration.
            # FastAPI routes handle body parsing directly.

            try:
                result = func(*args, **kwargs)

                # Try to get resource ID from result
                if resource_id_from_result and result:
                    try:
                        resource_id = resource_id_from_result(result)
                    except Exception:
                        pass

                log_audit_event(
                    action=action,
                    resource_type=resource_type,
                    resource_id=resource_id,
                    details=details if details else None,
                    success=True,
                )

                return result

            except Exception as e:
                log_audit_event(
                    action=action,
                    resource_type=resource_type,
                    resource_id=resource_id,
                    details=details if details else None,
                    success=False,
                    error_message=str(e),
                )
                raise

        return wrapper  # type: ignore

    return decorator


def _redact_sensitive_fields(data: dict[str, Any]) -> dict[str, Any]:
    """
    Redact sensitive fields from data before logging.

    Args:
        data: Dictionary that may contain sensitive fields

    Returns:
        Dictionary with sensitive fields redacted
    """
    sensitive_fields = {
        'password', 'secret', 'token', 'api_key', 'apikey',
        'access_token', 'refresh_token', 'credit_card', 'ssn',
        'social_security', 'credentials', 'private_key',
    }

    redacted = {}
    for key, value in data.items():
        key_lower = key.lower()
        if any(sensitive in key_lower for sensitive in sensitive_fields):
            redacted[key] = '[REDACTED]'
        elif isinstance(value, dict):
            redacted[key] = _redact_sensitive_fields(value)
        elif isinstance(value, list):
            redacted[key] = [
                _redact_sensitive_fields(item) if isinstance(item, dict) else item
                for item in value
            ]
        else:
            redacted[key] = value

    return redacted


# Convenience decorators for common operations
def audit_create(resource_type: str, resource_id_from_result: Callable[[Any], str] | None = None) -> Callable[[F], F]:
    """Decorator for audit logging create operations."""
    return audit_log(
        action="create",
        resource_type=resource_type,
        resource_id_from_result=resource_id_from_result,
    )


def audit_update(resource_type: str, resource_id_param: str = "id") -> Callable[[F], F]:
    """Decorator for audit logging update operations."""
    return audit_log(
        action="update",
        resource_type=resource_type,
        resource_id_param=resource_id_param,
    )


def audit_delete(resource_type: str, resource_id_param: str = "id") -> Callable[[F], F]:
    """Decorator for audit logging delete operations."""
    return audit_log(
        action="delete",
        resource_type=resource_type,
        resource_id_param=resource_id_param,
    )
