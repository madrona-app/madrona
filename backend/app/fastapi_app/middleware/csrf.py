"""
CSRF protection middleware (double-submit cookie pattern).

Validates that the X-CSRF-Token header matches the csrf_token cookie
for state-changing requests on /api/* paths.
"""

import re
import secrets

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

# Paths exempt from CSRF validation
CSRF_EXEMPT_PREFIXES = (
    "/api/auth/login",
    "/api/auth/mfa/verify",
    "/api/auth/mfa/recovery/",
    "/api/auth/password-reset/",
    "/api/auth/email-verification/",
    "/api/auth/activate",
    "/api/auth/refresh",
    "/api/webhooks/",
    "/api/discover/",
    "/api/gallery/",
    "/public/",
    # Test-only, hard-gated to non-production (404 in prod via
    # routers/test_support.py). Pre-auth like /api/auth/login, so exempt
    # for the same reason — the e2e auth.setup shouldn't need a CSRF dance.
    "/api/test-support/",
)

# The anonymous visitor widget lives under /api/guide/{org_slug}/… and carries
# its own double-submit session cookie (routers/agent.py). A blanket
# "/api/guide/" prefix exemption also covered every AUTHENTICATED Guide app
# route — chat, document upload and delete, widget settings — and would have
# silently swallowed each new one. These patterns exempt the visitor endpoints
# only.
#
# The reserved-segment guard matters because {org_slug} is client-supplied: an
# org whose slug is literally "chat" would otherwise make
# /api/guide/chat/conversations match the visitor pattern, while FastAPI routes
# it to the authenticated handler (literal segments win over parameters).
GUIDE_APP_SEGMENTS = frozenset({"chat", "documents", "attachments", "preferences", "widget"})

CSRF_EXEMPT_PATTERNS = (
    re.compile(r"^/api/guide/[^/]+/conversations$"),
    re.compile(r"^/api/guide/[^/]+/conversations/[^/]+/chat$"),
    re.compile(r"^/api/guide/[^/]+/visitor-data$"),
    re.compile(r"^/api/guide/[^/]+/visitor/(identify|interaction)$"),
)


def _is_exempt_guide_path(path: str) -> bool:
    parts = path.split("/")
    # ["", "api", "guide", "<slug>", ...]
    if len(parts) < 4 or parts[3] in GUIDE_APP_SEGMENTS:
        return False
    return any(pattern.match(path) for pattern in CSRF_EXEMPT_PATTERNS)


STATE_CHANGING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


class CSRFMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        # Only check state-changing methods on /api/* paths
        if request.method not in STATE_CHANGING_METHODS:
            return await call_next(request)

        path = request.url.path
        if not path.startswith("/api/"):
            return await call_next(request)

        # Skip if API key auth is present (machine-to-machine)
        if request.headers.get("X-API-Key"):
            return await call_next(request)

        # Skip exempt paths
        if any(path.startswith(prefix) for prefix in CSRF_EXEMPT_PREFIXES):
            return await call_next(request)
        if _is_exempt_guide_path(path):
            return await call_next(request)

        # Double-submit cookie validation
        cookie_token = request.cookies.get("csrf_token")
        header_token = request.headers.get("X-CSRF-Token")

        if not cookie_token or not header_token:
            return JSONResponse(
                status_code=403,
                content={"error": {"code": "csrf_error", "message": "CSRF token missing", "details": {}}},
            )

        if not secrets.compare_digest(cookie_token, header_token):
            return JSONResponse(
                status_code=403,
                content={"error": {"code": "csrf_error", "message": "CSRF token mismatch", "details": {}}},
            )

        return await call_next(request)
