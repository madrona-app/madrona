"""
Middleware that populates request-scoped context variables.

Sets ``app.context`` ContextVars from the current request so that services
(audit, logging, metrics) can access request metadata without importing
Starlette request objects.
"""

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from app import context


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        # Basic request info — use .set() without token reset because
        # Starlette's BaseHTTPMiddleware runs call_next in a different
        # async context, making token.reset() fail with ValueError.
        context.request_path.set(request.url.path)
        context.request_method.set(request.method)
        context.request_remote_addr.set(request.client.host if request.client else None)
        context.request_user_agent.set(request.headers.get("User-Agent", "")[:200])

        # request_id is set by RequestLoggingMiddleware (runs before us)
        req_id = getattr(request.state, "request_id", None)
        if req_id:
            context.request_id.set(req_id)

        try:
            response = await call_next(request)
            return response
        finally:
            context.request_path.set(None)
            context.request_method.set(None)
            context.request_remote_addr.set(None)
            context.request_user_agent.set(None)
            context.request_id.set(None)
