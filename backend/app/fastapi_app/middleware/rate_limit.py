"""
Global rate limiting middleware.

Split buckets:
- Read requests (GET/HEAD/OPTIONS): 600 req/min per IP
- Write requests (POST/PUT/PATCH/DELETE): 200 req/min per IP

Reuses the existing RateLimiter class from app/services/rate_limiter.py.
"""

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.services.rate_limiter import RateLimiter

_read_limiter = RateLimiter(max_requests=600, window_seconds=60)
_write_limiter = RateLimiter(max_requests=200, window_seconds=60)

_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def _get_client_ip(request: Request) -> str:
    """Extract client IP from request headers."""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        ip = forwarded.split(",")[0].strip()
        if ip:
            return ip
    if request.client:
        return request.client.host
    return "unknown"


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        path = request.url.path
        if not path.startswith("/api/"):
            return await call_next(request)

        client_ip = _get_client_ip(request)
        limiter = _read_limiter if request.method in _SAFE_METHODS else _write_limiter
        bucket = "read" if request.method in _SAFE_METHODS else "write"

        if not limiter.allow(client_ip, bucket):
            return JSONResponse(
                status_code=429,
                content={"error": {"code": "rate_limit_exceeded", "message": "Too many requests", "details": {}}},
                headers={"Retry-After": "60"},
            )

        return await call_next(request)
