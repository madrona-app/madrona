"""
WebSocket service for real-time updates using python-socketio AsyncServer.

Provides real-time communication for:
- Run status and progress updates
- Job status changes
- In-app notifications

Uses python-socketio with Redis adapter for multi-instance support.
"""

import logging
from http.cookies import SimpleCookie
from typing import Optional
from uuid import UUID

import socketio

from app.config import get_settings

logger = logging.getLogger(__name__)

settings = get_settings()

def _origin_allowed(origin: str | None, environ: dict | None = None) -> bool:
    """
    Decide whether a Socket.IO handshake origin is acceptable.

    Two cases have to pass:

    1. Cross-origin clients on the configured allowlist (hosted deployments,
       where the SPA and the API sit on different hostnames).
    2. Same-origin clients. In a self-hosted deployment nginx serves the SPA
       and reverse-proxies /socket.io/ to this app, so the browser is talking
       to a single origin — but that origin depends entirely on where the
       operator published the stack (http://localhost, a LAN address, or
       https://collections.example.org behind their own TLS terminator).
       Passing an explicit list to python-engineio disables its built-in
       same-origin check, so we reimplement it here rather than requiring
       every operator to also set CORS_ALLOWED_ORIGINS to match their port.

    Without (2) the handshake 403s and the SPA retries forever — visible to
    the user only as a console full of failed WebSocket connections, since
    the REST calls beside it are same-origin and unaffected.
    """
    if not origin:
        # Non-browser client (curl, server-to-server); no origin to check.
        return True

    if origin in set(settings.cors_origins):
        return True

    if not environ:
        return False

    # Same-origin: rebuild this request's own origin from the proxy headers
    # nginx sets, and compare. Mirrors engineio's default behavior.
    host = environ.get("HTTP_X_FORWARDED_HOST") or environ.get("HTTP_HOST")
    if not host:
        return False
    host = host.split(",")[0].strip()
    scheme = (
        environ.get("HTTP_X_FORWARDED_PROTO")
        or environ.get("wsgi.url_scheme")
        or "http"
    ).split(",")[0].strip()
    return origin == f"{scheme}://{host}"


# Create the async Socket.IO server
sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=_origin_allowed,
    logger=False,
    engineio_logger=False,
)


# -----------------------------------------------------------------------------
# Authentication
# -----------------------------------------------------------------------------


async def authenticate_socket(environ: dict) -> Optional[dict]:
    """
    Authenticate a WebSocket connection from ASGI environ/headers.

    Returns dict with user_id and organization_id on success, None on failure.
    """
    from app.services.auth_utils import decode_access_token, hash_refresh_token
    from app.models import RefreshToken
    from app.database import get_session_factory
    from datetime import datetime, timezone

    user_id = None
    organization_id = None

    # engineio translates ASGI scope into a WSGI-style environ dict
    # Headers are stored as HTTP_<NAME> (uppercased, hyphens replaced with underscores)

    # 1. Authorization header (Bearer token)
    auth_header = environ.get("HTTP_AUTHORIZATION", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
        try:
            payload = decode_access_token(token)
            user_id = payload.get("user_id") or payload.get("sub")
            organization_id = payload.get("organization_id") or payload.get("active_organization_id")
        except Exception as e:
            logger.warning(f"WebSocket: invalid access token - {e}")

    # 2. HttpOnly refresh_token cookie
    if not user_id:
        cookie_header = environ.get("HTTP_COOKIE", "")
        if cookie_header:
            cookies = SimpleCookie()
            cookies.load(cookie_header)
            refresh_morsel = cookies.get("refresh_token")
            if refresh_morsel:
                refresh_token = refresh_morsel.value
                SessionLocal = get_session_factory()
                db = SessionLocal()
                try:
                    token_hash = hash_refresh_token(refresh_token)
                    now = datetime.now(timezone.utc)

                    token_record = (
                        db.query(RefreshToken)
                        .filter_by(token_hash=token_hash, revoked_at=None)
                        .first()
                    )

                    # refresh_tokens.expires_at is timestamptz, so this is
                    # normally a no-op. Kept as a guard: a naive value reaching
                    # the comparison raises, and every cookie-authed socket is
                    # then silently rejected.
                    expires_at = token_record.expires_at if token_record else None
                    if expires_at is not None and expires_at.tzinfo is None:
                        expires_at = expires_at.replace(tzinfo=timezone.utc)

                    if token_record and expires_at and expires_at > now:
                        user_id = str(token_record.user_id)
                        organization_id = (
                            str(token_record.active_organization_id)
                            if token_record.active_organization_id
                            else None
                        )
                        logger.debug(f"WebSocket authenticated via refresh token for user {user_id}")
                except Exception as e:
                    logger.warning(f"WebSocket: refresh token validation failed - {e}")
                finally:
                    db.close()

    if not user_id or not organization_id:
        return None

    return {"user_id": user_id, "organization_id": organization_id}


# -----------------------------------------------------------------------------
# Event Handlers
# -----------------------------------------------------------------------------


@sio.event
async def connect(sid, environ, auth=None):
    """Handle client connection."""
    result = await authenticate_socket(environ)
    if result is None:
        logger.warning("WebSocket connection rejected: no valid auth")
        raise ConnectionRefusedError("authentication failed")

    user_id = result["user_id"]
    org_id = result["organization_id"]

    # Save auth info in session
    await sio.save_session(sid, {"user_id": user_id, "organization_id": org_id})

    logger.info(f"Client {sid} connecting - user={user_id}, org={org_id}")

    # Join organization room for broadcasts
    room = f"org:{org_id}"
    await sio.enter_room(sid, room)
    logger.info(f"Client {sid} joined room {room}")

    await sio.emit("connected", {"status": "ok", "sid": sid}, to=sid)


@sio.event
async def disconnect(sid):
    """Handle client disconnection."""
    logger.debug(f"Client {sid} disconnected")


@sio.on("subscribe:run")
async def handle_subscribe_run(sid, data):
    """Subscribe to updates for a specific run."""
    session = await sio.get_session(sid)
    run_id = data.get("run_id")
    org_id = session.get("organization_id")

    if run_id and org_id:
        room = f"org:{org_id}:run:{run_id}"
        await sio.enter_room(sid, room)
        logger.debug(f"Client {sid} subscribed to run {run_id}")
        await sio.emit("subscribed", {"run_id": run_id}, to=sid)


@sio.on("unsubscribe:run")
async def handle_unsubscribe_run(sid, data):
    """Unsubscribe from a specific run."""
    session = await sio.get_session(sid)
    run_id = data.get("run_id")
    org_id = session.get("organization_id")

    if run_id and org_id:
        room = f"org:{org_id}:run:{run_id}"
        await sio.leave_room(sid, room)
        logger.debug(f"Client {sid} unsubscribed from run {run_id}")


@sio.on("subscribe:pipeline")
async def handle_subscribe_pipeline(sid, data):
    """Subscribe to updates for a specific pipeline."""
    session = await sio.get_session(sid)
    pipeline_id = data.get("pipeline_id")
    org_id = session.get("organization_id")

    if pipeline_id and org_id:
        room = f"org:{org_id}:pipeline:{pipeline_id}"
        await sio.enter_room(sid, room)
        logger.debug(f"Client {sid} subscribed to pipeline {pipeline_id}")
        await sio.emit("subscribed", {"pipeline_id": pipeline_id}, to=sid)


@sio.on("unsubscribe:pipeline")
async def handle_unsubscribe_pipeline(sid, data):
    """Unsubscribe from a specific pipeline."""
    session = await sio.get_session(sid)
    pipeline_id = data.get("pipeline_id")
    org_id = session.get("organization_id")

    if pipeline_id and org_id:
        room = f"org:{org_id}:pipeline:{pipeline_id}"
        await sio.leave_room(sid, room)


# -----------------------------------------------------------------------------
# Event Emission Functions (called from worker/pipeline — sync context)
# -----------------------------------------------------------------------------
# These are called from sync code (pipeline.py, worker.py). python-socketio's
# AsyncServer.emit() can be called from sync context — it schedules the coroutine
# on the running event loop via the server's internal mechanism.


def _emit_to_run_rooms(
    event: str,
    data: dict,
    org_id: UUID,
    run_id: UUID,
    pipeline_id: UUID,
):
    """Emit an event to org, run, and pipeline rooms."""
    import asyncio

    async def _do_emit():
        await sio.emit(event, data, room=f"org:{org_id}")
        await sio.emit(event, data, room=f"org:{org_id}:run:{run_id}")
        await sio.emit(event, data, room=f"org:{org_id}:pipeline:{pipeline_id}")

    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_do_emit())
    except RuntimeError:
        # No running loop — run synchronously
        asyncio.run(_do_emit())


def emit_run_started(
    org_id: UUID,
    run_id: UUID,
    pipeline_id: UUID,
):
    """Emit event when a run starts."""
    data = {
        "event": "run:started",
        "run_id": str(run_id),
        "pipeline_id": str(pipeline_id),
        "status": "running",
    }
    _emit_to_run_rooms("run:started", data, org_id, run_id, pipeline_id)
    logger.debug(f"Emitted run:started for run {run_id}")


def emit_run_progress(
    org_id: UUID,
    run_id: UUID,
    pipeline_id: UUID,
    status: str,
    processed_count: int = 0,
    created_count: int = 0,
    updated_count: int = 0,
    skipped_count: int = 0,
    failed_count: int = 0,
    deleted_count: int = 0,
):
    """Emit run progress update."""
    data = {
        "event": "run:progress",
        "run_id": str(run_id),
        "pipeline_id": str(pipeline_id),
        "status": status,
        "counts": {
            "processed": processed_count,
            "created": created_count,
            "updated": updated_count,
            "skipped": skipped_count,
            "failed": failed_count,
            "deleted": deleted_count,
        },
    }
    _emit_to_run_rooms("run:progress", data, org_id, run_id, pipeline_id)


def emit_run_completed(
    org_id: UUID,
    run_id: UUID,
    pipeline_id: UUID,
    status: str,
    duration_ms: int = None,
    processed_count: int = 0,
    created_count: int = 0,
    updated_count: int = 0,
    skipped_count: int = 0,
    failed_count: int = 0,
    deleted_count: int = 0,
):
    """Emit event when a run completes."""
    data = {
        "event": "run:completed",
        "run_id": str(run_id),
        "pipeline_id": str(pipeline_id),
        "status": status,
        "duration_ms": duration_ms,
        "counts": {
            "processed": processed_count,
            "created": created_count,
            "updated": updated_count,
            "skipped": skipped_count,
            "failed": failed_count,
            "deleted": deleted_count,
        },
    }
    _emit_to_run_rooms("run:completed", data, org_id, run_id, pipeline_id)
    logger.debug(f"Emitted run:completed for run {run_id} with status {status}")


def emit_run_failed(
    org_id: UUID,
    run_id: UUID,
    pipeline_id: UUID,
    error: str,
    error_stage: str = None,
):
    """Emit event when a run fails."""
    data = {
        "event": "run:failed",
        "run_id": str(run_id),
        "pipeline_id": str(pipeline_id),
        "status": "failed",
        "error": error,
        "error_stage": error_stage,
    }
    _emit_to_run_rooms("run:failed", data, org_id, run_id, pipeline_id)
    logger.debug(f"Emitted run:failed for run {run_id}")


def emit_job_status(
    org_id: UUID,
    job_id: UUID,
    pipeline_id: UUID,
    status: str,
):
    """Emit job status change."""
    import asyncio

    data = {
        "event": "job:status",
        "job_id": str(job_id),
        "pipeline_id": str(pipeline_id),
        "status": status,
    }

    async def _do_emit():
        await sio.emit("job:status", data, room=f"org:{org_id}")
        await sio.emit("job:status", data, room=f"org:{org_id}:pipeline:{pipeline_id}")

    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_do_emit())
    except RuntimeError:
        asyncio.run(_do_emit())


def emit_notification(
    org_id: UUID,
    notification_type: str,
    title: str,
    message: str,
    data: dict = None,
    user_id: UUID = None,
):
    """Emit in-app notification."""
    import asyncio

    payload = {
        "event": "notification",
        "type": notification_type,
        "title": title,
        "message": message,
        "data": data or {},
    }

    if user_id:
        room = f"org:{org_id}:user:{user_id}"
    else:
        room = f"org:{org_id}"

    async def _do_emit():
        await sio.emit("notification", payload, room=room)

    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_do_emit())
    except RuntimeError:
        asyncio.run(_do_emit())

    logger.debug(f"Emitted notification to {room}: {title}")


# -----------------------------------------------------------------------------
# External Emission (from Celery workers)
# -----------------------------------------------------------------------------


def create_external_emitter(redis_url: str):
    """Create a Redis manager for emitting events from external processes."""
    mgr = socketio.RedisManager(redis_url, write_only=True)
    return mgr


class ExternalEmitter:
    """
    Emit WebSocket events from external processes (e.g., Celery workers).

    Uses Redis pub/sub to communicate with the main SocketIO server.
    """

    def __init__(self, redis_url: str):
        self._mgr = socketio.RedisManager(redis_url, write_only=True)

    def emit_run_started(self, org_id: UUID, run_id: UUID, pipeline_id: UUID):
        data = {
            "event": "run:started",
            "run_id": str(run_id),
            "pipeline_id": str(pipeline_id),
            "status": "running",
        }
        self._emit_to_rooms(org_id, run_id, pipeline_id, "run:started", data)

    def emit_run_progress(
        self,
        org_id: UUID,
        run_id: UUID,
        pipeline_id: UUID,
        status: str,
        processed_count: int = 0,
        created_count: int = 0,
        updated_count: int = 0,
        skipped_count: int = 0,
        failed_count: int = 0,
        deleted_count: int = 0,
    ):
        data = {
            "event": "run:progress",
            "run_id": str(run_id),
            "pipeline_id": str(pipeline_id),
            "status": status,
            "counts": {
                "processed": processed_count,
                "created": created_count,
                "updated": updated_count,
                "skipped": skipped_count,
                "failed": failed_count,
                "deleted": deleted_count,
            },
        }
        self._emit_to_rooms(org_id, run_id, pipeline_id, "run:progress", data)

    def emit_run_completed(
        self,
        org_id: UUID,
        run_id: UUID,
        pipeline_id: UUID,
        status: str,
        duration_ms: int = None,
        processed_count: int = 0,
        created_count: int = 0,
        updated_count: int = 0,
        skipped_count: int = 0,
        failed_count: int = 0,
        deleted_count: int = 0,
    ):
        data = {
            "event": "run:completed",
            "run_id": str(run_id),
            "pipeline_id": str(pipeline_id),
            "status": status,
            "duration_ms": duration_ms,
            "counts": {
                "processed": processed_count,
                "created": created_count,
                "updated": updated_count,
                "skipped": skipped_count,
                "failed": failed_count,
                "deleted": deleted_count,
            },
        }
        self._emit_to_rooms(org_id, run_id, pipeline_id, "run:completed", data)

    def emit_run_failed(
        self,
        org_id: UUID,
        run_id: UUID,
        pipeline_id: UUID,
        error: str,
        error_stage: str = None,
    ):
        data = {
            "event": "run:failed",
            "run_id": str(run_id),
            "pipeline_id": str(pipeline_id),
            "status": "failed",
            "error": error,
            "error_stage": error_stage,
        }
        self._emit_to_rooms(org_id, run_id, pipeline_id, "run:failed", data)

    def emit_notification(
        self,
        org_id: UUID,
        notification_type: str,
        title: str,
        message: str,
        data: dict = None,
    ):
        payload = {
            "event": "notification",
            "type": notification_type,
            "title": title,
            "message": message,
            "data": data or {},
        }
        self._mgr.emit("notification", payload, room=f"org:{org_id}")

    def _emit_to_rooms(
        self,
        org_id: UUID,
        run_id: UUID,
        pipeline_id: UUID,
        event: str,
        data: dict,
    ):
        self._mgr.emit(event, data, room=f"org:{org_id}")
        self._mgr.emit(event, data, room=f"org:{org_id}:run:{run_id}")
        self._mgr.emit(event, data, room=f"org:{org_id}:pipeline:{pipeline_id}")


_external_emitter: Optional[ExternalEmitter] = None


def get_external_emitter() -> Optional[ExternalEmitter]:
    """Get or create the external emitter for Celery workers."""
    global _external_emitter

    if _external_emitter is None:
        if settings.redis_url:
            _external_emitter = ExternalEmitter(settings.redis_url)

    return _external_emitter
