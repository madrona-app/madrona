"""
Content-Type enforcement middleware.

Ensures state-changing requests on /api/* paths have
Content-Type: application/json (unless multipart or empty body).
"""

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

STATE_CHANGING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


class ContentTypeMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.method not in STATE_CHANGING_METHODS:
            return await call_next(request)

        path = request.url.path
        if not path.startswith("/api/"):
            return await call_next(request)

        content_type = request.headers.get("Content-Type", "")

        # Skip multipart/form-data (file uploads)
        if content_type.startswith("multipart/form-data"):
            return await call_next(request)

        # Skip empty bodies (Content-Length: 0 or missing)
        content_length = request.headers.get("Content-Length")
        if content_length == "0" or (not content_length and not content_type):
            return await call_next(request)

        # Require application/json
        if not content_type.startswith("application/json"):
            return JSONResponse(
                status_code=415,
                content={
                    "error": {
                        "code": "unsupported_media_type",
                        "message": "Content-Type must be application/json",
                        "details": {},
                    }
                },
            )

        return await call_next(request)
