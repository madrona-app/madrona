"""
Structured logging configuration for Madrona backend.

This module configures structlog for JSON-formatted structured logging with
automatic context binding for request_id, user_id, and organization_id.

Usage:
    from app.logging import get_logger, configure_logging

    logger = get_logger(__name__)
    logger.info("User logged in", user_id="123", action="login")
"""

import logging
import sys
from datetime import datetime, timezone
from functools import lru_cache
from typing import Any
from uuid import uuid4

import structlog

from app import context as ctx
from app.config import get_settings


def add_request_context(
    logger: structlog.types.WrappedLogger,
    method_name: str,
    event_dict: dict[str, Any],
) -> dict[str, Any]:
    """
    Add request context to log entries when in a Flask request context.

    Automatically adds:
    - request_id: Unique ID for the request (from header or generated)
    - user_id: Current user ID if authenticated
    - org_id: Current organization ID if available
    - path: Request path
    - method: HTTP method
    """
    request_id = ctx.request_id.get()
    if request_id is not None:
        event_dict['request_id'] = request_id

        user_id = ctx.request_user_id.get()
        if user_id:
            event_dict['user_id'] = str(user_id)

        org_id = ctx.current_org_id.get()
        if org_id:
            event_dict['org_id'] = str(org_id)

        path = ctx.request_path.get()
        if path:
            event_dict['path'] = path
        method = ctx.request_method.get()
        if method:
            event_dict['method'] = method

    return event_dict


def add_timestamp(
    logger: structlog.types.WrappedLogger,
    method_name: str,
    event_dict: dict[str, Any],
) -> dict[str, Any]:
    """Add ISO format timestamp to log entries."""
    event_dict['timestamp'] = datetime.now(timezone.utc).isoformat()
    return event_dict


def configure_structlog(is_production: bool = False) -> None:
    """
    Configure structlog for the application.

    Args:
        is_production: If True, use JSON output. If False, use colored console output.
    """
    # Shared processors for all environments
    # Note: add_logger_name removed - incompatible with PrintLoggerFactory
    shared_processors: list[structlog.types.Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        add_timestamp,
        add_request_context,
        structlog.processors.StackInfoRenderer(),
        structlog.processors.UnicodeDecoder(),
    ]

    if is_production:
        # Production: JSON output for log aggregation systems
        processors = shared_processors + [
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ]
    else:
        # Development: Colored console output for readability
        processors = shared_processors + [
            structlog.dev.ConsoleRenderer(colors=True),
        ]

    structlog.configure(
        processors=processors,
        wrapper_class=structlog.make_filtering_bound_logger(logging.DEBUG),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


def configure_stdlib_logging() -> None:
    """
    Configure standard library logging to work with structlog.

    Redirects stdlib logging through structlog for consistent formatting.
    """
    settings = get_settings()

    # Configure root logger
    logging.basicConfig(
        format="%(message)s",
        level=getattr(logging, settings.log_level),
        handlers=[logging.StreamHandler(sys.stdout)],
    )

    # Set up structlog to handle stdlib logging
    structlog.configure(
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, settings.log_level)
        ),
    )


def configure_logging() -> None:
    """Configure both structlog and stdlib logging for the application."""
    settings = get_settings()
    is_production = settings.app_env == 'production'

    # Configure structlog
    configure_structlog(is_production=is_production)

    # Configure stdlib logging
    configure_stdlib_logging()


@lru_cache(maxsize=128)
def get_logger(name: str | None = None) -> structlog.BoundLogger:
    """
    Get a structured logger instance.

    Args:
        name: Logger name (usually __name__)

    Returns:
        A structlog BoundLogger instance

    Example:
        logger = get_logger(__name__)
        logger.info("User action", user_id="123", action="login")
    """
    return structlog.get_logger(name)


def bind_request_context(request_id: str | None = None, user_id: str | None = None, org_id: str | None = None) -> None:
    """
    Bind context variables that will be included in all subsequent log messages.

    Call this at the start of request processing to ensure all logs include
    consistent context.

    Args:
        request_id: Unique request identifier
        user_id: Current user ID
        org_id: Current organization ID
    """
    context: dict[str, str] = {}
    if request_id:
        context['request_id'] = request_id
    if user_id:
        context['user_id'] = user_id
    if org_id:
        context['org_id'] = org_id

    if context:
        structlog.contextvars.bind_contextvars(**context)


def clear_request_context() -> None:
    """Clear all bound context variables. Call at the end of request processing."""
    structlog.contextvars.clear_contextvars()
