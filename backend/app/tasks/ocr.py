"""
Background tasks for OCR text extraction.

Tasks:
- process_media_ocr: Per-media OCR extraction
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
    name='app.tasks.ocr.process_media_ocr',
    max_retries=2,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=120,
    soft_time_limit=300,
    time_limit=360,
)
def process_media_ocr_task(
    self: Task,
    media_id: str,
    organization_id: str,
) -> dict[str, Any]:
    """
    Run OCR on a single media item and store extracted text.

    Chained after process_upload_task for images and PDFs.
    """
    from app.config import get_settings
    from app.services.ocr_service import process_media_ocr

    settings = get_settings()
    if not settings.ocr_enabled:
        return {"success": False, "reason": "OCR not enabled"}

    try:
        result = process_media_ocr(
            media_id=UUID(media_id),
            organization_id=UUID(organization_id),
        )
        logger.info("OCR completed for media %s: %d chars", media_id, result.get("text_length", 0))
        return result

    except Exception as e:
        logger.error("OCR failed for media %s: %s", media_id, e)
        raise
