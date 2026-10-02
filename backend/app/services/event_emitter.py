"""
Service-layer event emitter — abstracts the WebSocket transport.

Services should import emit functions from here instead of from
app.fastapi_app.websocket, so that the service layer does not
depend on the FastAPI/Socket.IO framework layer.
"""
from __future__ import annotations

import logging
from uuid import UUID

logger = logging.getLogger(__name__)


def emit_notification(
    org_id: UUID,
    notification_type: str,
    title: str,
    message: str,
    data: dict | None = None,
    user_id: UUID | None = None,
) -> None:
    """Emit an in-app notification via WebSocket."""
    try:
        from app.fastapi_app.websocket import emit_notification as _ws_emit
        _ws_emit(org_id, notification_type, title, message, data=data, user_id=user_id)
    except Exception as e:
        logger.debug(f"WebSocket emit_notification unavailable: {e}")


def emit_job_status(
    org_id: UUID,
    job_id: UUID,
    pipeline_id: UUID,
    status: str,
) -> None:
    """Emit a job status change via WebSocket."""
    try:
        from app.fastapi_app.websocket import emit_job_status as _ws_emit
        _ws_emit(org_id, job_id, pipeline_id, status)
    except Exception as e:
        logger.debug(f"WebSocket emit_job_status unavailable: {e}")


def emit_run_started(org_id: UUID, run_id: UUID, pipeline_id: UUID) -> None:
    """Emit event when a pipeline run starts."""
    try:
        from app.fastapi_app.websocket import emit_run_started as _ws_emit
        _ws_emit(org_id, run_id, pipeline_id)
    except Exception as e:
        logger.debug(f"WebSocket emit_run_started unavailable: {e}")


def emit_run_progress(
    org_id: UUID, run_id: UUID, pipeline_id: UUID, status: str,
    processed_count: int = 0, created_count: int = 0, updated_count: int = 0,
    skipped_count: int = 0, failed_count: int = 0, deleted_count: int = 0,
) -> None:
    """Emit run progress update."""
    try:
        from app.fastapi_app.websocket import emit_run_progress as _ws_emit
        _ws_emit(
            org_id, run_id, pipeline_id, status,
            processed_count=processed_count, created_count=created_count,
            updated_count=updated_count, skipped_count=skipped_count,
            failed_count=failed_count, deleted_count=deleted_count,
        )
    except Exception as e:
        logger.debug(f"WebSocket emit_run_progress unavailable: {e}")


def emit_run_completed(
    org_id: UUID, run_id: UUID, pipeline_id: UUID, status: str,
    duration_ms: int = None, processed_count: int = 0, created_count: int = 0,
    updated_count: int = 0, skipped_count: int = 0, failed_count: int = 0,
    deleted_count: int = 0,
) -> None:
    """Emit event when a pipeline run completes."""
    try:
        from app.fastapi_app.websocket import emit_run_completed as _ws_emit
        _ws_emit(
            org_id, run_id, pipeline_id, status,
            duration_ms=duration_ms, processed_count=processed_count,
            created_count=created_count, updated_count=updated_count,
            skipped_count=skipped_count, failed_count=failed_count,
            deleted_count=deleted_count,
        )
    except Exception as e:
        logger.debug(f"WebSocket emit_run_completed unavailable: {e}")


def emit_run_failed(
    org_id: UUID, run_id: UUID, pipeline_id: UUID,
    error: str, error_stage: str = None,
) -> None:
    """Emit event when a pipeline run fails."""
    try:
        from app.fastapi_app.websocket import emit_run_failed as _ws_emit
        _ws_emit(org_id, run_id, pipeline_id, error, error_stage=error_stage)
    except Exception as e:
        logger.debug(f"WebSocket emit_run_failed unavailable: {e}")
