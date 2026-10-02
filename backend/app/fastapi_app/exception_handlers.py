"""
Exception handlers for FastAPI matching Flask's error response format.

Error response shape: {"error": {"code": "...", "message": "...", "details": {...}}}
"""

import importlib
import json
import logging
import traceback

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.exceptions import MadronaError

logger = logging.getLogger(__name__)


def _dependency_unavailable_types() -> tuple[type[BaseException], ...]:
    """Exception types that mean "a backing service is unreachable".

    A search cluster, object store or cache that is down is not a fault in the
    request, and answering 500 tells everyone downstream the wrong thing: a
    client retry policy sees a permanent server error, and the on-call reading
    Sentry sees an application bug rather than an outage. These map to 503.

    Each umbrella class below is library-specific — none of them is the builtin
    ConnectionError — so this cannot swallow an ordinary socket error raised by
    application code. Resolution is lazy and tolerant of a missing library so a
    slimmed-down install still imports.

    The database is deliberately absent. SQLAlchemy raises OperationalError for
    an unreachable server but also for statement timeouts and lost connections
    mid-transaction, and calling those "service unavailable" would hide real
    faults.
    """
    resolved: list[type[BaseException]] = []
    for module_name, class_names in (
        ("opensearchpy.exceptions", ("ConnectionError",)),
        ("botocore.exceptions", ("ConnectionError",)),
        ("redis.exceptions", ("ConnectionError", "TimeoutError")),
    ):
        try:
            module = importlib.import_module(module_name)
        except ImportError:
            continue
        for class_name in class_names:
            candidate = getattr(module, class_name, None)
            if isinstance(candidate, type) and issubclass(candidate, BaseException):
                resolved.append(candidate)
    return tuple(resolved)


_DEPENDENCY_UNAVAILABLE = _dependency_unavailable_types()

# Map HTTP status codes to error code strings
_STATUS_CODE_MAP = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    415: "unsupported_media_type",
    422: "validation_error",
    429: "rate_limit_exceeded",
    500: "internal_error",
    502: "bad_gateway",
    503: "service_unavailable",
}


def register_exception_handlers(app: FastAPI) -> None:
    """Register exception handlers on the FastAPI app."""

    @app.exception_handler(MadronaError)
    async def handle_madrona_error(request: Request, exc: MadronaError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=exc.to_dict(),
        )

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_exception(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = _STATUS_CODE_MAP.get(exc.status_code, "error")
        message = str(exc.detail) if exc.detail else code.replace("_", " ").title()

        # If detail is already a dict (from our HTTPException raises), use it
        if isinstance(exc.detail, dict):
            return JSONResponse(
                status_code=exc.status_code,
                content={"error": exc.detail},
            )

        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": {
                    "code": code,
                    "message": message,
                    "details": {},
                }
            },
        )

    @app.exception_handler(IntegrityError)
    async def handle_integrity_error(request: Request, exc: IntegrityError) -> JSONResponse:
        """Map DB integrity violations to HTTP errors.

        - UniqueViolation → 409 Conflict (duplicate insert/update)
        - CheckViolation → 422 Validation Error (bad enum/check value)
        - Everything else → 400 Bad Request (caller sent data the DB rejected)

        Routes that want a more specific response should catch IntegrityError
        locally and raise HTTPException; this handler is the safety net.
        """
        err_str = str(exc.orig) if exc.orig is not None else str(exc)
        lower = err_str.lower()
        if "unique" in lower or "duplicate key" in lower:
            status_code, code, message = 409, "conflict", "Resource already exists"
        elif "check constraint" in lower or "violates check" in lower:
            status_code, code, message = 422, "validation_error", "Invalid value"
        elif "foreign key" in lower:
            status_code, code, message = 422, "validation_error", "Referenced resource does not exist"
        elif "not-null" in lower or "null value in column" in lower:
            status_code, code, message = 422, "validation_error", "Required field missing"
        else:
            status_code, code, message = 400, "bad_request", "Database constraint violation"
        logger.warning(
            "IntegrityError on %s %s: %s",
            request.method, request.url.path, err_str,
        )
        return JSONResponse(
            status_code=status_code,
            content={"error": {"code": code, "message": message, "details": {}}},
        )

    @app.exception_handler(json.JSONDecodeError)
    async def handle_json_decode_error(request: Request, exc: json.JSONDecodeError) -> JSONResponse:
        """Empty or malformed JSON bodies → 400 (not 500)."""
        return JSONResponse(
            status_code=400,
            content={
                "error": {
                    "code": "bad_request",
                    "message": f"Invalid JSON body: {exc.msg}",
                    "details": {},
                }
            },
        )

    @app.exception_handler(ValidationError)
    async def handle_pydantic_validation_error(
        request: Request, exc: ValidationError
    ) -> JSONResponse:
        """A model validated inside a handler still describes bad input.

        FastAPI answers 422 for bodies it validates itself, but a handler that
        takes a raw dict and builds its model by hand raises pydantic's
        ValidationError, which fell through to the catch-all and became a 500.
        A malformed request is the caller's fault: reporting it as a server
        error misleads retry policies and files client mistakes in Sentry as
        application bugs.
        """
        summary = "; ".join(
            f"{'.'.join(str(p) for p in e.get('loc', ()))}: {e.get('msg', '')}".strip(": ")
            for e in exc.errors()[:3]
        )
        logger.info(
            "Invalid request body on %s %s: %s",
            request.method,
            request.url.path,
            summary,
        )
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": "validation_error",
                    "message": f"Invalid request body: {summary}" if summary else "Invalid request body",
                    "details": {},
                }
            },
        )

    @app.exception_handler(Exception)
    async def handle_generic_exception(request: Request, exc: Exception) -> JSONResponse:
        if _DEPENDENCY_UNAVAILABLE and isinstance(exc, _DEPENDENCY_UNAVAILABLE):
            logger.warning(
                "Dependency unavailable on %s %s: %s: %s",
                request.method,
                request.url.path,
                type(exc).__name__,
                exc,
            )
            return JSONResponse(
                status_code=503,
                content={
                    "error": {
                        "code": "service_unavailable",
                        "message": "A required service is temporarily unavailable",
                        "details": {},
                    }
                },
            )

        logger.error(
            "Unhandled exception on %s %s: %s",
            request.method,
            request.url.path,
            exc,
            exc_info=True,
        )
        return JSONResponse(
            status_code=500,
            content={
                "error": {
                    "code": "internal_error",
                    "message": "An internal error occurred",
                    "details": {},
                }
            },
        )
