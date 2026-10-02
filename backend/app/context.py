"""
Request-scoped context variables.

Replaces Flask's ``g`` and ``request`` for cross-cutting concerns (audit
logging, structured logging, metrics) that need request metadata without
a direct reference to the ASGI request object.

Values are set in FastAPI middleware
(``app.fastapi_app.middleware.request_context``) and read by services.
"""

from contextvars import ContextVar

request_id: ContextVar[str | None] = ContextVar("request_id", default=None)
request_user_id: ContextVar[str | None] = ContextVar("request_user_id", default=None)
request_path: ContextVar[str | None] = ContextVar("request_path", default=None)
request_method: ContextVar[str | None] = ContextVar("request_method", default=None)
request_remote_addr: ContextVar[str | None] = ContextVar("request_remote_addr", default=None)
current_org_id: ContextVar[str | None] = ContextVar("current_org_id", default=None)
request_user_agent: ContextVar[str | None] = ContextVar("request_user_agent", default=None)
