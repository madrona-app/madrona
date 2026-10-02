"""
Background tasks for Whisper transcription.

Tasks:
- transcribe_media: Per-media transcription
- bulk_transcribe: Fan-out for backfill
"""

import logging
from typing import Any
from uuid import UUID

from celery import Task

from app.celery_app import celery_app
from app.database import current_session
from app.tasks.base import OrgTask

logger = logging.getLogger(__name__)


@celery_app.task(
    base=OrgTask,
    bind=True,
    name='app.tasks.whisper.transcribe_media',
    max_retries=1,
    soft_time_limit=1800,  # 30 min for long videos
    time_limit=1860,
)
def transcribe_media_task(
    self: Task,
    media_id: str,
    organization_id: str,
) -> dict[str, Any]:
    """
    Transcribe a single media item using Whisper.
    """
    from app.config import get_settings
    from app.services.whisper_service import transcribe_media

    settings = get_settings()
    if not settings.whisper_enabled:
        return {"success": False, "reason": "Whisper not enabled"}

    try:
        result = transcribe_media(
            media_id=UUID(media_id),
            organization_id=UUID(organization_id),
        )
        logger.info("Transcription completed for media %s", media_id)
        return result

    except Exception as e:
        logger.error("Transcription failed for media %s: %s", media_id, e)
        raise


@celery_app.task(
    base=OrgTask,
    bind=True,
    name='app.tasks.whisper.bulk_transcribe',
    soft_time_limit=3600,
    time_limit=3900,
)
def bulk_transcribe(
    self: Task,
    organization_id: str,
) -> dict[str, Any]:
    """
    Fan-out task to transcribe all audio/video media without transcripts.
    """
    from app.models import Media

    media_items = current_session().query(Media.media_id).filter(
        Media.organization_id == UUID(organization_id),
        Media.media_type.in_(["video", "audio"]),
        Media.processing_status == "completed",
        Media.transcription_status.is_(None),
    ).all()

    queued = 0
    for (mid,) in media_items:
        transcribe_media_task.delay(
            media_id=str(mid),
            organization_id=organization_id,
        )
        queued += 1

    logger.info("Queued %d transcription tasks for org %s", queued, organization_id)
    return {"success": True, "queued": queued}
