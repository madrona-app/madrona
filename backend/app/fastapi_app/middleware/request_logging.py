"""
Request logging middleware.

Generates/adopts X-Request-ID, binds structlog context vars,
and logs request start/completion with duration.
"""

import logging
import time
from uuid import uuid4

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

logger = logging.getLogger("madrona.request")


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        # Generate or adopt request ID
        request_id = request.headers.get("X-Request-ID") or str(uuid4())

        # Store on request state for downstream access
        request.state.request_id = request_id

        start = time.perf_counter()

        logger.debug(
            "request_started method=%s path=%s request_id=%s",
            request.method,
            request.url.path,
            request_id,
        )

        response = await call_next(request)

        duration_ms = (time.perf_counter() - start) * 1000

        logger.info(
            "request_completed method=%s path=%s status=%d duration_ms=%.1f request_id=%s",
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
            request_id,
        )

        # Echo request ID in response
        response.headers["X-Request-ID"] = request_id

        return response
