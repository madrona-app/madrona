"""
Background tasks for media processing.

Tasks run asynchronously in Celery workers to:
1. Generate image derivatives (thumbnail, preview, web)
2. Extract metadata (EXIF, IPTC, XMP)
3. Transcode video files
4. Regenerate derivatives on demand
5. Check for expiring rights and consents
"""

import logging
import time as _time
from datetime import datetime, date, timedelta, timezone
from typing import Any
from uuid import UUID

from celery import Task

from app.celery_app import celery_app
from app.database import current_session
from app.tasks.base import OrgTask, SystemTask

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Format identification at ingest
# ---------------------------------------------------------------------------

def _identify_format_at_ingest(media, session) -> None:
    """Set PRONOM format fields on media at ingest time (best-effort)."""
    try:
        from app.services.format_identification import identify_format_by_mime
        result = identify_format_by_mime(media.mime_type, media.filename, session)
        if result.pronom_puid:
            media.pronom_puid = result.pronom_puid
            media.format_name = result.format_name
            media.format_risk_level = result.risk_level
    except Exception as e:
        logger.debug("Format identification skipped at ingest: %s", e)


# ---------------------------------------------------------------------------
# Step-level audit trail helpers
# ---------------------------------------------------------------------------

def _record_step(
    job,
    name: str,
    label: str,
    status: str,
    details: dict[str, Any] | None = None,
) -> None:
    """Append a processing step to job.result["steps"] and commit.

    Each step entry:
        {"name": ..., "label": ..., "status": "started"|"completed"|"skipped"|"failed",
         "at": ISO-8601, "duration_ms": int|None, "details": {...}|None}

    When *status* is ``completed`` or ``failed`` and a matching ``started``
    entry exists, ``duration_ms`` is computed automatically.
    """
    now = datetime.now(timezone.utc)
    result = dict(job.result) if job.result else {}
    steps: list[dict[str, Any]] = list(result.get("steps", []))

    duration_ms = None
    if status in ("completed", "failed"):
        # Find matching "started" entry (last one with same name)
        for s in reversed(steps):
            if s["name"] == name and s["status"] == "started":
                started_at = datetime.fromisoformat(s["at"])
                duration_ms = int((now - started_at).total_seconds() * 1000)
                break

    entry: dict[str, Any] = {
        "name": name,
        "label": label,
        "status": status,
        "at": now.isoformat(),
    }
    if duration_ms is not None:
        entry["duration_ms"] = duration_ms
    if details:
        entry["details"] = details

    steps.append(entry)
    result["steps"] = steps
    job.result = result
    current_session().commit()


def _step(job, name: str, label: str):
    """Context-manager that records started/completed (or failed) for a step."""

    class _StepCtx:
        def __enter__(self):
            _record_step(job, name, label, "started")
            return self

        def __exit__(self, exc_type, exc_val, exc_tb):
            if exc_type is not None:
                _record_step(job, name, label, "failed", {"error": str(exc_val)})
            else:
                _record_step(job, name, label, "completed")
            return False  # don't suppress exceptions

    return _StepCtx()


def _preserve_steps(job, new_result: dict[str, Any]) -> dict[str, Any]:
    """Merge existing steps into a new result dict so they aren't overwritten."""
    existing_steps = (job.result or {}).get("steps", [])
    if existing_steps:
        new_result["steps"] = existing_steps
    return new_result


@celery_app.task(
    base=OrgTask,
    bind=True,
    name='app.tasks.media.process_upload',
    max_retries=3,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=300,
    soft_time_limit=240,
    time_limit=300,
)
def process_upload_task(
    self: Task,
    media_id: str,
    organization_id: str,
    generate_webp: bool = False,
) -> dict[str, Any]:
    """
    Process a newly uploaded media file.

    This task:
    1. Downloads the original file from S3
    2. Extracts metadata (EXIF, IPTC, XMP)
    3. Generates derivatives (thumbnail, preview, web)
    4. Updates the media record with metadata
    5. Creates MediaDerivative records

    Args:
        media_id: Media UUID
        organization_id: Organization UUID
        generate_webp: Whether to generate WebP derivatives

    Returns:
        Dict with processing results
    """
    from app.models import Media, MediaDerivative, MediaProcessingJob
    from app.services.media_processing import process_image_upload

    try:
        # Load media record
        media = current_session().query(Media).filter_by(
            media_id=UUID(media_id),
            organization_id=UUID(organization_id),
        ).first()

        if not media:
            logger.error("Media not found: %s", media_id)
            return {"success": False, "error": "Media not found"}

        # Update status to processing
        media.processing_status = "processing"
        current_session().commit()

        # Create or update processing job
        job = current_session().query(MediaProcessingJob).filter_by(
            media_id=UUID(media_id),
            job_type="derivatives",
        ).first()

        if not job:
            job = MediaProcessingJob(
                media_id=UUID(media_id),
                organization_id=UUID(organization_id),
                job_type="derivatives",
                status="processing",
                celery_task_id=self.request.id,
            )
            current_session().add(job)
        else:
            job.status = "processing"
            job.celery_task_id = self.request.id
            job.started_at = datetime.now(timezone.utc)

        # Initialize steps array
        job.result = {"steps": []}
        current_session().commit()

        _record_step(job, "load_record", "Load media record", "completed",
                      {"media_type": media.media_type, "file_size": media.file_size})

        # Handle video transcoding
        if media.media_type == "video":
            from app.services.video_transcoding import is_video_transcoding_available

            if is_video_transcoding_available():
                _record_step(job, "queue_transcode", "Queue video transcoding", "completed")
                logger.info("Queuing video transcoding for media: %s", media_id)
                media.processing_status = "transcoding"
                job.status = "processing"
                job.result = _preserve_steps(job, {"message": "Video queued for transcoding"})
                current_session().commit()

                # Fetch video derivative specs from DB, fall back to hardcoded
                from app.services.derivative_config import get_derivative_specs as _get_video_specs
                from app.services.video_transcoding import specs_to_video_derivatives, DERIVATIVE_PRESETS as _VIDEO_PRESETS
                video_specs = _get_video_specs(organization_id, 'video', current_session())
                if video_specs:
                    # Register DB specs into DERIVATIVE_PRESETS so transcode_video_task can resolve them
                    for vd in specs_to_video_derivatives(video_specs):
                        _VIDEO_PRESETS[vd.name] = vd
                    video_derivative_names = [s.name for s in video_specs if (s.config or {}).get("codec")]
                    extract_poster = any(s.name == 'poster' for s in video_specs)
                else:
                    video_derivative_names = ["web_mp4_1080p", "web_mp4_720p", "web_mp4_480p"]
                    extract_poster = True

                transcode_video_task.delay(
                    media_id=media_id,
                    organization_id=organization_id,
                    derivatives=video_derivative_names,
                    extract_poster=extract_poster,
                )
                return {
                    "success": True,
                    "media_id": media_id,
                    "message": "Video queued for transcoding",
                }
            else:
                # MediaConvert not configured - fail the upload
                error_msg = (
                    "Video transcoding not available. "
                    "MEDIACONVERT_ROLE_ARN environment variable is not set."
                )
                logger.error(error_msg)
                _record_step(job, "queue_transcode", "Queue video transcoding", "failed",
                              {"error": error_msg})

                media.processing_status = "failed"
                job.status = "failed"
                job.completed_at = datetime.now(timezone.utc)
                job.error_message = error_msg
                current_session().commit()

                return {
                    "success": False,
                    "media_id": media_id,
                    "error": error_msg,
                }

        # Handle document processing (PDF, Word, etc.)
        if media.media_type == "document":
            logger.info("Processing document media: %s", media_id)

            # Download document from storage (BYOB-aware)
            with _step(job, "download", "Download from storage"):
                from app.services.storage import get_storage_backend
                storage = get_storage_backend(str(organization_id), current_session())
                document_data, _ = storage.get_object_sync(media.s3_key)

            # Process document
            with _step(job, "process_document", "Process document"):
                from app.services.document_processing import process_document_upload

                result = process_document_upload(
                    document_data=document_data,
                    organization_id=str(organization_id),
                    media_id=str(media_id),
                    mime_type=media.mime_type or 'application/pdf',
                    db_session=current_session(),
                )

            # Update media record
            media.page_count = result.get('page_count')
            media.checksum_sha256 = result.get('checksum_sha256')
            media.technical_metadata = result.get('technical_metadata')
            media.dublin_core = result.get('dublin_core')
            media.thumbnail_s3_key = result.get('thumbnail_s3_key')
            media.processing_status = "completed"

            # Record PREMIS ingestion event
            from app.tasks.preservation import record_preservation_event
            record_preservation_event(
                current_session(),
                organization_id=UUID(organization_id),
                event_type="ingestion",
                media_id=UUID(media_id),
                outcome="success",
                outcome_detail="Document processed and ingested",
                detail={
                    "checksum_sha256": result.get("checksum_sha256"),
                    "mime_type": media.mime_type,
                    "page_count": result.get("page_count"),
                },
            )

            # Identify PRONOM format at ingest
            _identify_format_at_ingest(media, current_session())

            # Update job status
            job.status = "completed"
            job.completed_at = datetime.now(timezone.utc)
            job.result = _preserve_steps(job, {
                "page_count": result.get('page_count'),
                "derivatives_generated": len(result.get('derivatives', [])),
            })

            current_session().commit()

            # Index in OpenSearch
            with _step(job, "index_search", "Index in search"):
                try:
                    from app.search.media import MediaSearchService, get_media_search_service
                    if MediaSearchService.is_available():
                        current_session().refresh(media)
                        service = get_media_search_service()
                        service.index_media(media)
                        logger.debug(f"Indexed document {media_id} in OpenSearch")
                    else:
                        _record_step(job, "index_search", "Index in search", "skipped",
                                      {"reason": "OpenSearch not available"})
                except Exception as e:
                    logger.warning(f"Failed to index document {media_id} in OpenSearch: {e}")

            # Trigger AI tagging for PDF text extraction (async, don't block on it)
            if media.mime_type == 'application/pdf':
                try:
                    from app.config import get_settings as _ai_settings
                    if _ai_settings().ai_tagging_enabled:
                        from app.tasks.ai_tagging import process_media_ai_tags
                        process_media_ai_tags.delay(media_id, organization_id)
                    _record_step(job, "queue_ai", "Queue AI tagging", "completed")
                    logger.debug(f"Queued AI tagging for PDF {media_id}")
                except Exception as e:
                    _record_step(job, "queue_ai", "Queue AI tagging", "skipped",
                                  {"reason": str(e)})
                    logger.warning(f"Failed to queue AI tagging for PDF {media_id}: {e}")

            # Trigger OCR for scanned PDFs (async)
            try:
                from app.config import get_settings as _get_doc_settings
                _doc_settings = _get_doc_settings()
                if _doc_settings.ocr_enabled:
                    from app.tasks.ocr import process_media_ocr_task
                    process_media_ocr_task.delay(media_id, organization_id)
                    _record_step(job, "queue_ocr", "Queue OCR", "completed")
                    logger.debug(f"Queued OCR for document {media_id}")
                else:
                    _record_step(job, "queue_ocr", "Queue OCR", "skipped",
                                  {"reason": "OCR not enabled"})
            except Exception as e:
                _record_step(job, "queue_ocr", "Queue OCR", "skipped",
                              {"reason": str(e)})
                logger.warning(f"Failed to queue OCR for document {media_id}: {e}")

            logger.info(
                "Processed document %s: %d derivatives, %s pages",
                media_id, len(result.get('derivatives', [])), result.get('page_count')
            )

            return {
                "success": True,
                "media_id": media_id,
                "page_count": result.get('page_count'),
                "derivatives_generated": len(result.get('derivatives', [])),
            }

        # Handle audio processing (metadata extraction, no derivatives)
        if media.media_type == "audio":
            logger.info("Processing audio media: %s", media_id)

            with _step(job, "download", "Download from storage"):
                from app.services.storage import get_storage_backend
                storage = get_storage_backend(str(organization_id), current_session())
                audio_data, _ = storage.get_object_sync(media.s3_key)

            with _step(job, "extract_metadata", "Extract audio metadata"):
                from app.services.audio_processing import process_audio_upload

                result = process_audio_upload(
                    audio_data=audio_data,
                    organization_id=str(organization_id),
                    media_id=str(media_id),
                    mime_type=media.mime_type or "audio/mpeg",
                )

            media.duration_seconds = result.get("duration_seconds")
            media.checksum_sha256 = result.get("checksum_sha256")
            media.technical_metadata = result.get("technical_metadata")
            media.dublin_core = result.get("dublin_core")
            media.processing_status = "completed"

            # Record PREMIS ingestion event
            from app.tasks.preservation import record_preservation_event
            record_preservation_event(
                current_session(),
                organization_id=UUID(organization_id),
                event_type="ingestion",
                media_id=UUID(media_id),
                outcome="success",
                outcome_detail="Audio processed and ingested",
                detail={
                    "checksum_sha256": result.get("checksum_sha256"),
                    "mime_type": media.mime_type,
                    "duration_seconds": result.get("duration_seconds"),
                },
            )

            # Identify PRONOM format at ingest
            _identify_format_at_ingest(media, current_session())

            job.status = "completed"
            job.completed_at = datetime.now(timezone.utc)
            job.result = _preserve_steps(job, {
                "duration_seconds": result.get("duration_seconds"),
                "technical_metadata": result.get("technical_metadata"),
            })

            current_session().commit()

            # Index in OpenSearch
            with _step(job, "index_search", "Index in search"):
                try:
                    from app.search.media import MediaSearchService, get_media_search_service
                    if MediaSearchService.is_available():
                        current_session().refresh(media)
                        service = get_media_search_service()
                        service.index_media(media)
                        logger.debug(f"Indexed audio {media_id} in OpenSearch")
                except Exception as e:
                    logger.warning(f"Failed to index audio {media_id} in OpenSearch: {e}")

            logger.info(
                "Processed audio %s: duration=%ss",
                media_id, result.get("duration_seconds"),
            )

            return {
                "success": True,
                "media_id": media_id,
                "duration_seconds": result.get("duration_seconds"),
            }

        # Skip processing for unknown media types
        if media.media_type not in ("image",):
            logger.info("Skipping derivative generation for %s media: %s", media.media_type, media_id)
            media.processing_status = "completed"
            job.status = "completed"
            job.completed_at = datetime.now(timezone.utc)
            job.result = {"message": f"{media.media_type} media, skipping derivatives"}
            current_session().commit()
            return {
                "success": True,
                "media_id": media_id,
                "message": f"{media.media_type} media, skipping derivatives",
            }

        # Download original file from storage (BYOB-aware)
        with _step(job, "download", "Download from storage"):
            from app.services.storage import get_storage_backend
            storage = get_storage_backend(str(organization_id), current_session())
            image_data, _ = storage.get_object_sync(media.s3_key)

        # Process the image (metadata + derivatives)
        _record_step(job, "extract_metadata", "Extract image metadata", "started")
        _record_step(job, "generate_derivatives", "Generate derivatives", "started")
        result = process_image_upload(
            image_data=image_data,
            organization_id=str(organization_id),
            media_id=str(media_id),
            db_session=current_session(),
            generate_webp=generate_webp,
        )
        _record_step(job, "extract_metadata", "Extract image metadata", "completed",
                      {"width": result.get("width"), "height": result.get("height")})
        _record_step(job, "generate_derivatives", "Generate derivatives", "completed",
                      {"count": len(result.get("derivatives", []))})

        # Update media record with extracted metadata
        media.width = result.get('width')
        media.height = result.get('height')
        media.checksum_sha256 = result.get('checksum_sha256')
        media.technical_metadata = result.get('technical_metadata')
        media.iptc_metadata = result.get('iptc_metadata')
        media.xmp_metadata = result.get('xmp_metadata')
        media.dublin_core = result.get('dublin_core')
        media.processing_status = "completed"

        # Extract dominant colors for the color-bucket search filter.
        # Uses the image bytes already downloaded for derivative generation
        # so there's no extra S3 round-trip.
        with _step(job, "extract_colors", "Extract dominant colors"):
            try:
                from app.services.color_extraction import extract_dominant_colors, _generate_color_key
                colors = extract_dominant_colors(image_data)
                media.dominant_colors = colors
                media.color_key = _generate_color_key(colors)
            except Exception as e:
                logger.warning("Color extraction failed for %s: %s", media_id, e)

        # Record PREMIS ingestion event
        from app.tasks.preservation import record_preservation_event
        record_preservation_event(
            current_session(),
            organization_id=UUID(organization_id),
            event_type="ingestion",
            media_id=UUID(media_id),
            outcome="success",
            outcome_detail="Image processed and ingested",
            detail={
                "checksum_sha256": result.get("checksum_sha256"),
                "mime_type": media.mime_type,
                "width": result.get("width"),
                "height": result.get("height"),
                "derivatives_count": len(result.get("derivatives", [])),
            },
        )

        # Identify PRONOM format at ingest
        _identify_format_at_ingest(media, current_session())

        # Set thumbnail S3 key (prefer JPEG thumbnail for broad compatibility)
        # Priority: square_thumb.jpeg > thumbnail.jpeg > any thumbnail
        thumbnail_key = None
        square_thumb_key = None
        for derivative in result.get('derivatives', []):
            if derivative['derivative_type'] == 'square_thumb' and derivative['format'] == 'jpeg':
                square_thumb_key = derivative['s3_key']
            elif derivative['derivative_type'] == 'thumbnail' and derivative['format'] == 'jpeg':
                thumbnail_key = derivative['s3_key']
            elif derivative['derivative_type'] == 'thumbnail' and not thumbnail_key:
                thumbnail_key = derivative['s3_key']

        # Use regular thumbnail as primary (square_thumb available for UI that needs it)
        media.thumbnail_s3_key = thumbnail_key or square_thumb_key

        # Create MediaDerivative records
        with _step(job, "create_records", "Save derivative records"):
            for derivative in result.get('derivatives', []):
                existing = current_session().query(MediaDerivative).filter_by(
                    media_id=UUID(media_id),
                    derivative_type=derivative['derivative_type'],
                    format=derivative['format'],
                ).first()

                if existing:
                    # Update existing
                    existing.s3_key = derivative['s3_key']
                    existing.width = derivative['width']
                    existing.height = derivative['height']
                    existing.file_size = derivative['file_size']
                    existing.quality = derivative.get('quality')
                else:
                    # Create new
                    deriv = MediaDerivative(
                        media_id=UUID(media_id),
                        organization_id=UUID(organization_id),
                        derivative_type=derivative['derivative_type'],
                        format=derivative['format'],
                        s3_key=derivative['s3_key'],
                        width=derivative['width'],
                        height=derivative['height'],
                        file_size=derivative['file_size'],
                        quality=derivative.get('quality'),
                    )
                    current_session().add(deriv)

        # Update job status
        job.status = "completed"
        job.completed_at = datetime.now(timezone.utc)
        job.result = _preserve_steps(job, {
            "derivatives_generated": len(result.get('derivatives', [])),
            "width": result.get('width'),
            "height": result.get('height'),
        })

        current_session().commit()

        # Index media in OpenSearch now that processing is complete
        with _step(job, "index_search", "Index in search"):
            try:
                from app.search.media import MediaSearchService, get_media_search_service
                if MediaSearchService.is_available():
                    # Refresh to get all updated fields
                    current_session().refresh(media)
                    service = get_media_search_service()
                    service.index_media(media)
                    logger.debug(f"Indexed media {media_id} in OpenSearch")
            except Exception as e:
                logger.warning(f"Failed to index media {media_id} in OpenSearch: {e}")

        # Trigger AI tagging if enabled (async, don't block on it)
        try:
            from app.config import get_settings as _ai_settings2
            if _ai_settings2().ai_tagging_enabled:
                from app.tasks.ai_tagging import process_media_ai_tags
                process_media_ai_tags.delay(media_id, organization_id)
            _record_step(job, "queue_ai", "Queue AI tagging", "completed")
            logger.debug(f"Queued AI tagging for media {media_id}")
        except Exception as e:
            _record_step(job, "queue_ai", "Queue AI tagging", "skipped",
                          {"reason": str(e)})
            logger.warning(f"Failed to queue AI tagging for media {media_id}: {e}")

        # Trigger CLIP embedding generation for images (async)
        try:
            from app.config import get_settings as _get_settings
            _settings = _get_settings()
            if _settings.clip_enabled and media.media_type == "image":
                from app.tasks.clip import generate_clip_embedding
                generate_clip_embedding.delay(media_id, organization_id)
                _record_step(job, "queue_clip", "Queue CLIP embedding", "completed")
                logger.debug(f"Queued CLIP embedding for media {media_id}")
            else:
                _record_step(job, "queue_clip", "Queue CLIP embedding", "skipped",
                              {"reason": "CLIP not enabled"})
        except Exception as e:
            _record_step(job, "queue_clip", "Queue CLIP embedding", "skipped",
                          {"reason": str(e)})
            logger.warning(f"Failed to queue CLIP embedding for media {media_id}: {e}")

        # Trigger OCR for images (async)
        try:
            from app.config import get_settings as _get_settings2
            _settings2 = _get_settings2()
            if _settings2.ocr_enabled and media.media_type == "image":
                from app.tasks.ocr import process_media_ocr_task
                process_media_ocr_task.delay(media_id, organization_id)
                _record_step(job, "queue_ocr", "Queue OCR", "completed")
                logger.debug(f"Queued OCR for media {media_id}")
            else:
                _record_step(job, "queue_ocr", "Queue OCR", "skipped",
                              {"reason": "OCR not enabled"})
        except Exception as e:
            _record_step(job, "queue_ocr", "Queue OCR", "skipped",
                          {"reason": str(e)})
            logger.warning(f"Failed to queue OCR for media {media_id}: {e}")

        logger.info(
            "Processed media %s: %d derivatives generated",
            media_id, len(result.get('derivatives', []))
        )

        return {
            "success": True,
            "media_id": media_id,
            "derivatives_generated": len(result.get('derivatives', [])),
            "width": result.get('width'),
            "height": result.get('height'),
        }

    except Exception as e:
        logger.exception("Failed to process media %s", media_id)

        # Only mark as "failed" on the final retry attempt
        is_final_attempt = self.request.retries >= self.max_retries
        try:
            media = current_session().query(Media).filter_by(media_id=UUID(media_id)).first()
            if media and is_final_attempt:
                media.processing_status = "failed"

            job = current_session().query(MediaProcessingJob).filter_by(
                media_id=UUID(media_id),
                job_type="derivatives",
            ).first()
            if job:
                if is_final_attempt:
                    job.status = "failed"
                job.error_message = str(e)
                job.retry_count = self.request.retries + 1
                _record_step(job, "error", "Processing failed", "failed",
                              {"error": str(e), "retry": self.request.retries})

            current_session().commit()
        except Exception as rollback_err:
            logger.debug(f"Failed to update job status: {rollback_err}")
            current_session().rollback()

        raise


@celery_app.task(
    base=OrgTask,
    bind=True,
    name='app.tasks.media.upload_from_url',
    max_retries=2,
    soft_time_limit=300,
    time_limit=360,
)
def upload_from_url_task(
    self: Task,
    url: str,
    organization_id: str,
    title: str | None = None,
    folder_id: str | None = None,
    created_by: str | None = None,
) -> dict[str, Any]:
    """
    Download a file from a URL and create a Media record.

    Streams the file to a temporary location, uploads to S3,
    creates the Media record, and triggers processing.
    """
    import os
    import tempfile
    import mimetypes

    from app.models import Media
    from app.services.uploads import (
        detect_media_type,
        get_s3_client,
        get_media_bucket,
        generate_s3_key,
            DEFAULT_REGION,
    )
    from app.services.url_guard import UnsafeURLError, safe_get

    try:
        # Stream download. safe_get blocks SSRF to internal/metadata addresses
        # (and revalidates each redirect hop) before any request is made.
        try:
            resp = safe_get(url, stream=True, timeout=120)
        except UnsafeURLError as exc:
            logger.warning("upload_from_url rejected unsafe URL for org %s: %s", organization_id, exc)
            raise ValueError(f"URL not allowed: {exc}") from exc
        resp.raise_for_status()

        # Determine filename from URL or Content-Disposition
        content_disp = resp.headers.get("Content-Disposition", "")
        if "filename=" in content_disp:
            filename = content_disp.split("filename=")[-1].strip('" ')
        else:
            from urllib.parse import urlparse
            filename = os.path.basename(urlparse(url).path) or "download"

        mime_type = resp.headers.get("Content-Type", "").split(";")[0].strip()
        if not mime_type or mime_type == "application/octet-stream":
            mime_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"

        media_type = detect_media_type(mime_type)

        with tempfile.NamedTemporaryFile(delete=False) as tmp:
            for chunk in resp.iter_content(chunk_size=8192):
                tmp.write(chunk)
            tmp_path = tmp.name
            file_size = tmp.tell()

        # Upload to S3
        org_uuid = UUID(organization_id)
        # get_s3_client and get_media_bucket both take an AWS REGION, not an
        # organization id. Passing the org UUID made boto3 raise
        # "expected string or bytes-like object, got 'UUID'", and made the
        # bucket lookup log an "unsupported region" warning on every call.
        s3_client = get_s3_client()
        bucket = get_media_bucket(DEFAULT_REGION)
        s3_key = generate_s3_key(organization_id, media_type, filename)

        with open(tmp_path, "rb") as f:
            s3_client.upload_fileobj(f, bucket, s3_key)

        os.unlink(tmp_path)

        # Create Media record
        media = Media(
            organization_id=org_uuid,
            s3_key=s3_key,
            filename=filename,
            file_size=file_size,
            mime_type=mime_type,
            media_type=media_type,
            title=title or filename,
            folder_id=UUID(folder_id) if folder_id else None,
            processing_status="pending",
            created_by=UUID(created_by) if created_by else None,
        )
        current_session().add(media)
        current_session().commit()

        # Trigger processing
        process_upload_task.delay(
            media_id=str(media.media_id),
            organization_id=organization_id,
        )

        logger.info("Uploaded from URL %s -> media %s", url, media.media_id)
        return {
            "success": True,
            "media_id": str(media.media_id),
            "filename": filename,
        }

    except Exception as e:
        logger.error("Upload from URL failed: %s -> %s", url, e)
        raise


@celery_app.task(
    base=OrgTask,
    bind=True,
    name='app.tasks.media.regenerate_derivatives',
    max_retries=3,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=300,
)
def regenerate_derivatives_task(
    self: Task,
    media_id: str,
    organization_id: str,
    generate_webp: bool = False,
) -> dict[str, Any]:
    """
    Regenerate derivatives for an existing media file.

    This is used when:
    - Derivative settings change
    - A new format is needed
    - Derivatives are corrupted

    Args:
        media_id: Media UUID
        organization_id: Organization UUID
        generate_webp: Whether to generate WebP derivatives

    Returns:
        Dict with regeneration results
    """
    from app.models import Media, MediaDerivative, MediaProcessingJob
    from app.services.media_processing import generate_all_derivatives, delete_derivatives

    try:
        # Load media record
        media = current_session().query(Media).filter_by(
            media_id=UUID(media_id),
            organization_id=UUID(organization_id),
        ).first()

        if not media:
            logger.error("Media not found: %s", media_id)
            return {"success": False, "error": "Media not found"}

        if media.media_type != "image":
            return {"success": False, "error": "Only image media can have derivatives regenerated"}

        # Create regeneration job
        job = MediaProcessingJob(
            media_id=UUID(media_id),
            organization_id=UUID(organization_id),
            job_type="regenerate",
            status="processing",
            celery_task_id=self.request.id,
            started_at=datetime.now(timezone.utc),
        )
        current_session().add(job)
        current_session().commit()

        # Delete existing derivatives from S3
        delete_derivatives(str(organization_id), str(media_id), current_session())

        # Delete derivative records from database
        current_session().query(MediaDerivative).filter_by(
            media_id=UUID(media_id)
        ).delete()
        current_session().commit()

        # Download original (archival master) file from storage (BYOB-aware)
        from app.services.storage import get_storage_backend
        storage = get_storage_backend(str(organization_id), current_session())
        image_data, _ = storage.get_object_sync(media.s3_key)

        # Generate new derivatives using standard set (IIIF/FADGI compliant)
        # WebP is generated alongside JPEG for modern browser support
        derivatives = generate_all_derivatives(
            image_data=image_data,
            organization_id=str(organization_id),
            media_id=str(media_id),
            db_session=current_session(),
            include_webp=generate_webp,
        )

        # Update thumbnail S3 key (prefer JPEG for compatibility)
        thumbnail_key = None
        for derivative in derivatives:
            if derivative.derivative_type == 'thumbnail' and derivative.format == 'jpeg':
                thumbnail_key = derivative.s3_key
                break
            elif derivative.derivative_type == 'thumbnail' and not thumbnail_key:
                thumbnail_key = derivative.s3_key
        media.thumbnail_s3_key = thumbnail_key

        # Create new derivative records
        for derivative in derivatives:
            deriv = MediaDerivative(
                media_id=UUID(media_id),
                organization_id=UUID(organization_id),
                derivative_type=derivative.derivative_type,
                format=derivative.format,
                s3_key=derivative.s3_key,
                width=derivative.width,
                height=derivative.height,
                file_size=derivative.file_size,
                quality=derivative.quality,
            )
            current_session().add(deriv)

        # Update job status
        job.status = "completed"
        job.completed_at = datetime.now(timezone.utc)
        job.result = {"derivatives_generated": len(derivatives)}

        current_session().commit()

        logger.info(
            "Regenerated %d derivatives for media %s",
            len(derivatives), media_id
        )

        return {
            "success": True,
            "media_id": media_id,
            "derivatives_generated": len(derivatives),
        }

    except Exception as e:
        logger.exception("Failed to regenerate derivatives for media %s", media_id)
        raise


@celery_app.task(
    base=OrgTask,
    bind=True,
    name='app.tasks.media.extract_metadata',
    max_retries=3,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=300,
)
def extract_metadata_task(
    self: Task,
    media_id: str,
    organization_id: str,
) -> dict[str, Any]:
    """
    Extract metadata from a media file without generating derivatives.

    Useful for:
    - Re-extracting metadata after format support updates
    - Batch metadata extraction

    Args:
        media_id: Media UUID
        organization_id: Organization UUID

    Returns:
        Dict with extracted metadata
    """
    from app.models import Media, MediaProcessingJob
    from app.services.media_processing import extract_metadata, compute_checksum

    try:
        # Load media record
        media = current_session().query(Media).filter_by(
            media_id=UUID(media_id),
            organization_id=UUID(organization_id),
        ).first()

        if not media:
            logger.error("Media not found: %s", media_id)
            return {"success": False, "error": "Media not found"}

        if media.media_type != "image":
            return {"success": False, "error": "Only image metadata extraction is currently supported"}

        # Create extraction job
        job = MediaProcessingJob(
            media_id=UUID(media_id),
            organization_id=UUID(organization_id),
            job_type="metadata_extract",
            status="processing",
            celery_task_id=self.request.id,
            started_at=datetime.now(timezone.utc),
        )
        current_session().add(job)
        current_session().commit()

        # Download original file from storage (BYOB-aware)
        from app.services.storage import get_storage_backend
        storage = get_storage_backend(str(organization_id), current_session())
        image_data, _ = storage.get_object_sync(media.s3_key)

        # Extract metadata
        result = extract_metadata(image_data)
        checksum = compute_checksum(image_data)

        # Update media record
        media.width = result.width
        media.height = result.height
        media.checksum_sha256 = checksum
        media.technical_metadata = result.technical_metadata
        media.iptc_metadata = result.iptc_metadata
        media.xmp_metadata = result.xmp_metadata
        media.dublin_core = result.dublin_core

        # Update job status
        job.status = "completed"
        job.completed_at = datetime.now(timezone.utc)
        job.result = {
            "width": result.width,
            "height": result.height,
            "has_exif": bool(result.technical_metadata),
        }

        current_session().commit()

        logger.info("Extracted metadata for media %s", media_id)

        return {
            "success": True,
            "media_id": media_id,
            "width": result.width,
            "height": result.height,
        }

    except Exception as e:
        logger.exception("Failed to extract metadata for media %s", media_id)
        raise


@celery_app.task(base=OrgTask, name='app.tasks.media.process_batch')
def process_batch_task(
    media_ids: list[str],
    organization_id: str,
    operation: str = "derivatives",
    generate_webp: bool = True,
) -> dict[str, Any]:
    """
    Queue processing tasks for multiple media files.

    Args:
        media_ids: List of media UUIDs
        organization_id: Organization UUID
        operation: Type of operation (derivatives, metadata_extract, regenerate)
        generate_webp: Whether to generate WebP derivatives (default: True)

    Returns:
        Dict with queued count
    """
    queued = 0

    for media_id in media_ids:
        if operation == "derivatives":
            process_upload_task.delay(media_id, organization_id, generate_webp)
        elif operation == "metadata_extract":
            extract_metadata_task.delay(media_id, organization_id)
        elif operation == "regenerate":
            regenerate_derivatives_task.delay(media_id, organization_id, generate_webp)

        queued += 1

    logger.info("Queued %d %s tasks for organization %s", queued, operation, organization_id)

    return {
        "success": True,
        "queued": queued,
        "operation": operation,
    }


# ---------------------------------------------------------------------------
# Concurrency limits for video transcoding
# ---------------------------------------------------------------------------
MAX_CONCURRENT_TRANSCODES_PER_ORG = 3
MAX_CONCURRENT_TRANSCODES_GLOBAL = 10


@celery_app.task(
    base=OrgTask,
    bind=True,
    name='app.tasks.media.transcode_video',
    max_retries=3,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=600,
    soft_time_limit=300,   # 5 minutes (submit only, no polling)
    time_limit=600,        # 10 minutes hard limit
)
def transcode_video_task(
    self: Task,
    media_id: str,
    organization_id: str,
    derivatives: list[str] | None = None,
    extract_poster: bool = True,
) -> dict[str, Any]:
    """
    Submit a video for transcoding via AWS MediaConvert.

    This task extracts metadata, checks concurrency limits, and submits
    the MediaConvert job. It returns immediately after submission — the
    periodic ``poll_transcode_jobs`` task handles completion.

    If per-org or global concurrency limits are reached, the job is queued
    with status ``pending`` and will be submitted by the poller when a slot
    opens.
    """
    from app.models import Media, MediaProcessingJob
    from app.services.video_transcoding import (
        get_video_transcoding_service,
        is_video_transcoding_available,
    )
    from app.services.uploads import get_media_bucket, get_s3_client, get_org_storage_region
    from sqlalchemy import func

    try:
        # Check if transcoding is available
        if not is_video_transcoding_available():
            logger.error("Video transcoding not available - MEDIACONVERT_ROLE_ARN not set")
            return {"success": False, "error": "Video transcoding not configured"}

        # Load media record
        media = current_session().query(Media).filter_by(
            media_id=UUID(media_id),
            organization_id=UUID(organization_id),
        ).first()

        if not media:
            logger.error("Media not found: %s", media_id)
            return {"success": False, "error": "Media not found"}

        if media.media_type != "video":
            return {"success": False, "error": "Only video media can be transcoded"}

        # Update status to processing
        media.processing_status = "processing"
        current_session().commit()

        # Create or update processing job record
        job = current_session().query(MediaProcessingJob).filter_by(
            media_id=UUID(media_id),
            job_type="transcode",
        ).first()

        if not job:
            job = MediaProcessingJob(
                media_id=UUID(media_id),
                organization_id=UUID(organization_id),
                job_type="transcode",
                status="processing",
                celery_task_id=self.request.id,
                started_at=datetime.now(timezone.utc),
            )
            current_session().add(job)
        else:
            job.status = "processing"
            job.celery_task_id = self.request.id
            job.started_at = datetime.now(timezone.utc)

        # Initialize steps array
        job.result = {"steps": []}
        current_session().commit()

        _record_step(job, "load_record", "Load media record", "completed",
                      {"media_type": media.media_type, "file_size": media.file_size})
        _record_step(job, "check_availability", "Check transcoding service", "completed")

        # Build S3 URIs (MediaConvert requires S3)
        region = get_org_storage_region(str(organization_id), current_session())
        bucket = get_media_bucket(region)
        s3_client = get_s3_client(region)
        source_uri = f"s3://{bucket}/{media.s3_key}"
        output_prefix = f"s3://{bucket}/orgs/{organization_id}/media/{media_id}/derivatives/"

        # Extract video metadata before transcoding
        with _step(job, "extract_metadata", "Extract video metadata"):
            from app.services.video_processing import (
                extract_video_metadata_from_s3,
                compute_video_checksum,
                build_video_technical_metadata,
                build_video_dublin_core,
            )

            logger.info("Extracting video metadata for %s", media_id)
            video_metadata = extract_video_metadata_from_s3(s3_client, bucket, media.s3_key)

            if video_metadata:
                media.width = video_metadata.width
                media.height = video_metadata.height
                media.duration_seconds = int(video_metadata.duration_seconds) if video_metadata.duration_seconds else None
                media.technical_metadata = build_video_technical_metadata(video_metadata)
                media.dublin_core = build_video_dublin_core(video_metadata, media.mime_type)
                logger.info(
                    "Extracted video metadata: %dx%d, %ss, %s",
                    video_metadata.width or 0,
                    video_metadata.height or 0,
                    video_metadata.duration_seconds or 0,
                    video_metadata.video_codec
                )
            else:
                logger.warning("Could not extract video metadata for %s", media_id)

            # Compute checksum (for smaller files only to avoid memory issues)
            if media.file_size and media.file_size < 500 * 1024 * 1024:  # 500MB limit
                try:
                    from app.services.storage import get_storage_backend
                    storage = get_storage_backend(str(organization_id), current_session())
                    video_data, _ = storage.get_object_sync(media.s3_key)
                    media.checksum_sha256 = compute_video_checksum(video_data)
                    logger.info("Computed checksum for video %s", media_id)
                except Exception as e:
                    logger.warning("Failed to compute video checksum: %s", e)

        current_session().commit()

        requested_derivatives = derivatives or ["web_mp4_720p", "web_mp4_480p"]

        # ---- Concurrency cap: queue if limits exceeded ----
        active_org = current_session().query(func.count(MediaProcessingJob.job_id)).filter(
            MediaProcessingJob.organization_id == UUID(organization_id),
            MediaProcessingJob.job_type == "transcode",
            MediaProcessingJob.status == "processing",
        ).scalar()

        active_global = current_session().query(func.count(MediaProcessingJob.job_id)).filter(
            MediaProcessingJob.job_type == "transcode",
            MediaProcessingJob.status == "processing",
        ).scalar()

        if active_org >= MAX_CONCURRENT_TRANSCODES_PER_ORG or active_global >= MAX_CONCURRENT_TRANSCODES_GLOBAL:
            job.status = "pending"
            job.parameters = {
                "derivatives": requested_derivatives,
                "source_s3_uri": source_uri,
                "output_s3_prefix": output_prefix,
                "extract_poster": extract_poster,
                "queued_reason": "concurrency_limit",
            }
            media.processing_status = "processing"  # User still sees "processing"
            _record_step(job, "concurrency_check", "Check concurrency limits", "completed",
                          {"queued": True, "active_org": active_org, "active_global": active_global})
            current_session().commit()

            logger.info(
                "Transcode queued for media %s (org active=%d, global active=%d)",
                media_id, active_org, active_global,
            )
            return {
                "success": True,
                "status": "queued",
                "media_id": media_id,
                "active_org": active_org,
                "active_global": active_global,
            }

        # ---- Submit to MediaConvert ----
        _record_step(job, "submit_transcode", "Submit transcode job", "started")
        service = get_video_transcoding_service()
        transcode_result = service.create_transcode_job(
            source_s3_uri=source_uri,
            output_s3_prefix=output_prefix,
            media_id=UUID(media_id),
            derivatives=derivatives,
            extract_poster=extract_poster,
        )

        job.parameters = {
            "mediaconvert_job_id": transcode_result.job_id,
            "derivatives": requested_derivatives,
            "output_s3_prefix": output_prefix,
        }
        _record_step(job, "submit_transcode", "Submit transcode job", "completed",
                      {"job_id": transcode_result.job_id})
        current_session().commit()

        logger.info(
            "Transcode submitted for media %s, MediaConvert job %s",
            media_id, transcode_result.job_id,
        )

        return {
            "success": True,
            "status": "submitted",
            "media_id": media_id,
            "job_id": transcode_result.job_id,
        }

    except Exception as e:
        logger.exception("Failed to transcode video %s", media_id)

        # Only mark as "failed" on the final retry attempt
        is_final_attempt = self.request.retries >= self.max_retries
        try:
            media = current_session().query(Media).filter_by(media_id=UUID(media_id)).first()
            if media and is_final_attempt:
                media.processing_status = "failed"

            job = current_session().query(MediaProcessingJob).filter_by(
                media_id=UUID(media_id),
                job_type="transcode",
            ).order_by(MediaProcessingJob.created_at.desc()).first()
            if job:
                if is_final_attempt:
                    job.status = "failed"
                job.error_message = str(e)
                job.retry_count = self.request.retries + 1
                _record_step(job, "error", "Transcoding failed", "failed",
                              {"error": str(e), "retry": self.request.retries})

            current_session().commit()
        except Exception as rollback_err:
            logger.debug("Failed to update job status: %s", rollback_err)
            current_session().rollback()

        raise


# ---------------------------------------------------------------------------
# Shared helper: create derivatives from completed MediaConvert outputs
# ---------------------------------------------------------------------------

def _complete_transcode(
    media,
    job,
    organization_id: str,
    media_id: str,
    outputs: list[dict],
    session,
) -> int:
    """Create derivative records from completed MediaConvert outputs.

    Updates the Media and MediaProcessingJob records, creates
    MediaDerivative rows, and indexes in OpenSearch.

    Returns the number of derivatives created.
    """
    from app.models import MediaDerivative
    from app.services.video_transcoding import DERIVATIVE_PRESETS
    from app.services.storage import get_storage_backend

    storage = get_storage_backend(organization_id, session)
    derivatives_created = 0

    for output in outputs:
        group_name = output["group"]

        if group_name == "poster":
            poster_prefix = f"orgs/{organization_id}/media/{media_id}/derivatives/poster/"
            try:
                objects, _ = storage.list_objects_sync(prefix=poster_prefix, max_keys=10)
                poster_files = [obj for obj in objects
                               if obj.key.endswith(('.jpg', '.jpeg', '.png'))]
                if poster_files and media:
                    poster_key = poster_files[0].key
                    media.thumbnail_s3_key = poster_key

                    poster_deriv = MediaDerivative(
                        media_id=UUID(media_id),
                        organization_id=UUID(organization_id),
                        derivative_type='poster',
                        format='jpeg',
                        s3_key=poster_key,
                        width=1280,
                        height=720,
                        file_size=poster_files[0].size,
                    )
                    session.add(poster_deriv)
                    derivatives_created += 1
                    logger.info("Created poster derivative: %s", poster_key)
            except Exception as e:
                logger.warning("Failed to find poster file: %s", e)
        else:
            preset = DERIVATIVE_PRESETS.get(group_name)
            deriv_width = preset.width if preset else 0
            deriv_height = preset.height if preset else 0
            deriv_format = "mp4" if "mp4" in group_name else "webm"

            deriv_prefix = f"orgs/{organization_id}/media/{media_id}/derivatives/{group_name}/"
            deriv_s3_key = deriv_prefix
            deriv_file_size = 0

            try:
                objects, _ = storage.list_objects_sync(prefix=deriv_prefix, max_keys=10)
                video_files = [obj for obj in objects
                              if obj.key.endswith(('.mp4', '.webm'))]
                if video_files:
                    deriv_s3_key = video_files[0].key
                    deriv_file_size = video_files[0].size
            except Exception as e:
                logger.warning("Failed to get derivative file info for %s: %s", group_name, e)

            deriv = MediaDerivative(
                media_id=UUID(media_id),
                organization_id=UUID(organization_id),
                derivative_type=group_name,
                format=deriv_format,
                s3_key=deriv_s3_key,
                width=deriv_width,
                height=deriv_height,
                file_size=deriv_file_size,
            )
            session.add(deriv)
            derivatives_created += 1
            logger.info(
                "Created video derivative: %s (%dx%d, %d bytes)",
                group_name, deriv_width, deriv_height, deriv_file_size,
            )

    # Update job record
    if media:
        media.processing_status = "completed"
    job.status = "completed"
    job.completed_at = datetime.now(timezone.utc)
    job.result = _preserve_steps(job, {
        "mediaconvert_job_id": (job.parameters or {}).get("mediaconvert_job_id"),
        "outputs": outputs,
        "derivatives_created": derivatives_created,
    })
    session.commit()

    # Index in OpenSearch
    try:
        from app.search.media import MediaSearchService, get_media_search_service
        if MediaSearchService.is_available() and media:
            session.refresh(media)
            search_svc = get_media_search_service()
            search_svc.index_media(media)
    except Exception as e:
        logger.warning("Failed to index video %s in OpenSearch: %s", media_id, e)

    return derivatives_created


# ---------------------------------------------------------------------------
# Periodic task: poll all active transcode jobs + submit queued jobs
# ---------------------------------------------------------------------------

@celery_app.task(
    base=SystemTask,
    name='app.tasks.media.poll_transcode_jobs',
    soft_time_limit=55,
    time_limit=60,
)
def poll_transcode_jobs() -> dict[str, Any]:
    """
    Poll MediaConvert for active transcode jobs and submit queued ones.

    Phase 1 — Check active jobs:
      Query processing transcode jobs with a mediaconvert_job_id, check
      their status in MediaConvert, and complete/fail them accordingly.

    Phase 2 — Submit queued jobs:
      For jobs queued due to concurrency limits, submit them when slots
      open up (respecting per-org and global caps).

    Runs every 60s via Celery Beat.
    """
    from app.models import Media, MediaProcessingJob
    from app.services.video_transcoding import (
        get_video_transcoding_service,
        is_video_transcoding_available,
    )
    from app.tasks.rls_helpers import admin_db_session
    from sqlalchemy import func

    if not is_video_transcoding_available():
        return {"skipped": True, "reason": "transcoding not configured"}

    completed = 0
    failed = 0
    still_processing = 0
    submitted = 0

    try:
        service = get_video_transcoding_service()

        with admin_db_session() as session:
            # ---- Phase 1: Check active jobs ----
            active_jobs = session.query(MediaProcessingJob).filter(
                MediaProcessingJob.job_type == "transcode",
                MediaProcessingJob.status == "processing",
                MediaProcessingJob.parameters["mediaconvert_job_id"].astext != None,  # noqa: E711
            ).all()

            for job in active_jobs:
                mc_job_id = job.parameters.get("mediaconvert_job_id")
                if not mc_job_id:
                    continue

                try:
                    status = service.get_job_status(mc_job_id)
                except Exception as e:
                    logger.warning("Failed to poll MediaConvert job %s: %s", mc_job_id, e)
                    continue

                media = session.query(Media).filter_by(media_id=job.media_id).first()

                if status["status"] == "COMPLETE":
                    outputs = status.get("outputs", [])
                    _complete_transcode(
                        media=media,
                        job=job,
                        organization_id=str(job.organization_id),
                        media_id=str(job.media_id),
                        outputs=outputs,
                        session=session,
                    )
                    completed += 1
                    logger.info("Transcode completed for media %s", job.media_id)

                elif status["status"] in ("ERROR", "CANCELED"):
                    error_msg = status.get("error_message", "Transcoding failed")
                    if media:
                        media.processing_status = "failed"
                    job.status = "failed"
                    job.error_message = error_msg
                    job.completed_at = datetime.now(timezone.utc)
                    session.commit()
                    failed += 1
                    logger.error("Transcode failed for media %s: %s", job.media_id, error_msg)

                else:
                    # Still progressing — update progress
                    if status.get("progress"):
                        job.parameters = {
                            **(job.parameters or {}),
                            "progress": status["progress"],
                        }
                        session.commit()
                    still_processing += 1

            # ---- Phase 2: Submit queued jobs ----
            pending_jobs = session.query(MediaProcessingJob).filter(
                MediaProcessingJob.job_type == "transcode",
                MediaProcessingJob.status == "pending",
                MediaProcessingJob.parameters["queued_reason"].astext == "concurrency_limit",
            ).order_by(MediaProcessingJob.created_at.asc()).all()

            for job in pending_jobs:
                # Check per-org limit
                org_active = session.query(func.count(MediaProcessingJob.job_id)).filter(
                    MediaProcessingJob.organization_id == job.organization_id,
                    MediaProcessingJob.job_type == "transcode",
                    MediaProcessingJob.status == "processing",
                ).scalar()

                global_active = session.query(func.count(MediaProcessingJob.job_id)).filter(
                    MediaProcessingJob.job_type == "transcode",
                    MediaProcessingJob.status == "processing",
                ).scalar()

                if org_active >= MAX_CONCURRENT_TRANSCODES_PER_ORG or global_active >= MAX_CONCURRENT_TRANSCODES_GLOBAL:
                    continue  # Still over limit

                # Submit to MediaConvert
                params = job.parameters or {}
                source_uri = params.get("source_s3_uri")
                output_prefix = params.get("output_s3_prefix")
                derivatives_list = params.get("derivatives", ["web_mp4_720p", "web_mp4_480p"])
                extract_poster = params.get("extract_poster", True)

                if not source_uri or not output_prefix:
                    logger.error("Queued transcode job %s missing S3 parameters", job.job_id)
                    job.status = "failed"
                    job.error_message = "Missing S3 parameters for queued job"
                    session.commit()
                    failed += 1
                    continue

                try:
                    transcode_result = service.create_transcode_job(
                        source_s3_uri=source_uri,
                        output_s3_prefix=output_prefix,
                        media_id=job.media_id,
                        derivatives=derivatives_list,
                        extract_poster=extract_poster,
                    )
                    job.status = "processing"
                    job.started_at = datetime.now(timezone.utc)
                    job.parameters = {
                        "mediaconvert_job_id": transcode_result.job_id,
                        "derivatives": derivatives_list,
                        "output_s3_prefix": output_prefix,
                    }
                    session.commit()
                    submitted += 1
                    logger.info(
                        "Submitted queued transcode for media %s, MC job %s",
                        job.media_id, transcode_result.job_id,
                    )
                except Exception as e:
                    logger.exception("Failed to submit queued transcode for media %s", job.media_id)
                    job.status = "failed"
                    job.error_message = f"Failed to submit: {e}"
                    session.commit()
                    failed += 1

    except Exception:
        logger.exception("Error in poll_transcode_jobs")
        raise

    result = {
        "completed": completed,
        "failed": failed,
        "still_processing": still_processing,
        "submitted": submitted,
    }
    logger.info("poll_transcode_jobs: %s", result)
    return result


@celery_app.task(
    base=OrgTask,
    bind=True,
    name='app.tasks.media.apply_watermark',
    max_retries=3,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=300,
    soft_time_limit=180,
    time_limit=240,
)
def apply_watermark_task(
    self: Task,
    media_id: str,
    organization_id: str,
    job_id: str,
) -> dict[str, Any]:
    """
    Apply a watermark to a media item and its derivatives.

    This task:
    1. Loads the watermark template configuration from the processing job
    2. Applies watermark to the original image (if configured)
    3. Regenerates derivatives with watermark applied
    4. Updates the media record

    Args:
        media_id: Media UUID
        organization_id: Organization UUID
        job_id: MediaProcessingJob UUID with watermark configuration

    Returns:
        Dict with watermarking results
    """
    from app.models import Media, MediaDerivative, MediaProcessingJob
    from app.services.media_processing import (
        apply_watermark_to_image,
        generate_all_derivatives,
        delete_derivatives,
        DerivativeFormat,
    )

    try:
        # Load media and job records
        media = current_session().query(Media).filter_by(
            media_id=UUID(media_id),
            organization_id=UUID(organization_id),
        ).first()

        if not media:
            logger.error("Media not found: %s", media_id)
            return {"success": False, "error": "Media not found"}

        job = current_session().query(MediaProcessingJob).filter_by(
            job_id=UUID(job_id)
        ).first()

        if not job:
            logger.error("Processing job not found: %s", job_id)
            return {"success": False, "error": "Processing job not found"}

        # Update job status
        job.status = "processing"
        job.celery_task_id = self.request.id
        job.started_at = datetime.now(timezone.utc)
        current_session().commit()

        # Get watermark configuration from job parameters
        params = job.parameters or {}
        template_config = params.get('template_config', {})
        watermark_type = params.get('watermark_type', 'text')
        apply_to_derivatives = params.get('apply_to_derivatives', True)
        create_watermarked_copy = params.get('create_watermarked_copy', False)

        # Download original image from storage (BYOB-aware)
        from app.services.storage import get_storage_backend
        storage = get_storage_backend(str(organization_id), current_session())

        # Always watermark from a PRISTINE source, never from the live master.
        #
        # This task is `autoretry_for=(Exception,), max_retries=3`, and the
        # default path (create_watermarked_copy is False) writes the result
        # back over media.s3_key. Work continues after that write — derivatives
        # are deleted and regenerated — so any later failure re-entered the
        # task from the top, re-read the ALREADY WATERMARKED bytes, and stamped
        # them again. Up to four stacked watermarks burned into an archival
        # master, with no watermark-state column anywhere to notice.
        #
        # Keeping the untouched original under a sibling key makes the whole
        # task idempotent: a replay re-derives from the same input and produces
        # the same output. It also makes watermarking reversible, which matters
        # more here than idempotency does — a museum master is not a
        # regenerable artifact.
        pristine_key = f"{media.s3_key}.pristine"
        if not create_watermarked_copy:
            if storage.head_object_sync(pristine_key) is None:
                original_bytes, _ = storage.get_object_sync(media.s3_key)
                storage.put_object_sync(
                    key=pristine_key,
                    body=original_bytes,
                    content_type=media.mime_type,
                )
                image_data = original_bytes
            else:
                # A previous attempt already preserved the original; this is a
                # retry. Re-derive from it rather than from the live master.
                image_data, _ = storage.get_object_sync(pristine_key)
        else:
            image_data, _ = storage.get_object_sync(media.s3_key)

        # Apply watermark to original
        watermarked_data = apply_watermark_to_image(
            image_data,
            watermark_type=watermark_type,
            config=template_config,
        )

        results = {
            "original_watermarked": False,
            "derivatives_regenerated": False,
            "derivatives_count": 0,
        }

        if create_watermarked_copy:
            # Save as a separate watermarked version
            watermarked_key = media.s3_key.replace('.', '_watermarked.')
            storage.put_object_sync(
                key=watermarked_key,
                body=watermarked_data,
                content_type=media.mime_type,
            )
            results["watermarked_copy_key"] = watermarked_key
        else:
            # Replace original with watermarked version
            storage.put_object_sync(
                key=media.s3_key,
                body=watermarked_data,
                content_type=media.mime_type,
            )
            media.file_size = len(watermarked_data)
            results["original_watermarked"] = True

        if apply_to_derivatives:
            # Delete existing derivatives
            delete_derivatives(str(organization_id), str(media_id), current_session())

            # Delete derivative records
            current_session().query(MediaDerivative).filter_by(
                media_id=UUID(media_id)
            ).delete()
            current_session().commit()

            # Generate new derivatives from watermarked image
            formats = [DerivativeFormat.JPEG]
            derivative_results = generate_all_derivatives(
                watermarked_data,
                str(organization_id),
                str(media_id),
                formats=formats,
                session=current_session(),
            )

            # Save derivatives
            for deriv_result in derivative_results:
                derivative = MediaDerivative(
                    media_id=UUID(media_id),
                    derivative_type=deriv_result.derivative_type,
                    s3_key=deriv_result.s3_key,
                    width=deriv_result.width,
                    height=deriv_result.height,
                    file_size=deriv_result.file_size,
                    format=deriv_result.format,
                )
                current_session().add(derivative)

            results["derivatives_regenerated"] = True
            results["derivatives_count"] = len(derivative_results)

        # Update job and media
        job.status = "completed"
        job.completed_at = datetime.now(timezone.utc)
        job.result = results

        current_session().commit()

        logger.info("Applied watermark to media %s", media_id)

        return {
            "success": True,
            "media_id": media_id,
            **results,
        }

    except Exception as e:
        logger.exception("Failed to apply watermark to media %s", media_id)

        # Update job status to failed
        try:
            job = current_session().query(MediaProcessingJob).filter_by(
                job_id=UUID(job_id)
            ).first()
            if job:
                job.status = "failed"
                job.error_message = str(e)
                job.retry_count += 1
            current_session().commit()
        except Exception as rollback_err:
            logger.debug(f"Failed to update job status: {rollback_err}")
            current_session().rollback()

        raise


@celery_app.task(
    base=SystemTask,
    name='app.tasks.media.check_expiring_rights_consents',
    soft_time_limit=300,
    time_limit=600,
)
def check_expiring_rights_consents_task() -> dict[str, Any]:
    """
    Check for expiring rights and consent records and create alerts.

    This task runs daily (scheduled via Celery Beat) to:
    1. Find MediaRights/MediaConsent expiring within 90 days
    2. Create/update ExpirationAlert records
    3. Optionally send email digest to org admins

    Severity levels:
    - warning: 60-90 days until expiry
    - urgent: 30-60 days until expiry
    - critical: <30 days until expiry

    Returns:
        Dict with processing results
    """
    from app.models import (
        MediaRights, MediaConsent, ExpirationAlert, Media
    )
    from app.models import Organization
    from app.tasks.rls_helpers import admin_db_session

    try:
        today = date.today()
        cutoff_90 = today + timedelta(days=90)
        cutoff_60 = today + timedelta(days=60)
        cutoff_30 = today + timedelta(days=30)

        alerts_created = 0
        alerts_updated = 0
        alerts_resolved = 0

        # System task: scans all orgs, needs BYPASSRLS
        with admin_db_session() as session:
            organizations = session.query(Organization).all()

            for org in organizations:
                org_id = org.organization_id

                # Check MediaRights with end_date
                expiring_rights = session.query(MediaRights).filter(
                    MediaRights.organization_id == org_id,
                    MediaRights.is_active == True,
                    MediaRights.end_date.isnot(None),
                    MediaRights.end_date <= cutoff_90,
                    MediaRights.end_date >= today,
                ).all()

                for rights in expiring_rights:
                    days_until = (rights.end_date - today).days

                    if days_until < 30:
                        severity = 'critical'
                    elif days_until < 60:
                        severity = 'urgent'
                    else:
                        severity = 'warning'

                    existing = session.query(ExpirationAlert).filter(
                        ExpirationAlert.alert_type == 'rights',
                        ExpirationAlert.related_id == rights.rights_id,
                    ).first()

                    if existing:
                        if existing.status == 'active':
                            existing.days_until_expiry = days_until
                            existing.severity = severity
                            existing.updated_at = datetime.now(timezone.utc)
                            alerts_updated += 1
                    else:
                        alert = ExpirationAlert(
                            organization_id=org_id,
                            media_id=rights.media_id,
                            alert_type='rights',
                            related_id=rights.rights_id,
                            expiry_date=rights.end_date,
                            days_until_expiry=days_until,
                            severity=severity,
                            status='active',
                        )
                        session.add(alert)
                        alerts_created += 1

                # Check MediaConsent with expiry_date
                expiring_consents = session.query(MediaConsent).filter(
                    MediaConsent.organization_id == org_id,
                    MediaConsent.is_valid == True,
                    MediaConsent.expiry_date.isnot(None),
                    MediaConsent.expiry_date <= cutoff_90,
                    MediaConsent.expiry_date >= today,
                ).all()

                for consent in expiring_consents:
                    days_until = (consent.expiry_date - today).days

                    if days_until < 30:
                        severity = 'critical'
                    elif days_until < 60:
                        severity = 'urgent'
                    else:
                        severity = 'warning'

                    existing = session.query(ExpirationAlert).filter(
                        ExpirationAlert.alert_type == 'consent',
                        ExpirationAlert.related_id == consent.consent_id,
                    ).first()

                    if existing:
                        if existing.status == 'active':
                            existing.days_until_expiry = days_until
                            existing.severity = severity
                            existing.updated_at = datetime.now(timezone.utc)
                            alerts_updated += 1
                    else:
                        alert = ExpirationAlert(
                            organization_id=org_id,
                            media_id=consent.media_id,
                            alert_type='consent',
                            related_id=consent.consent_id,
                            expiry_date=consent.expiry_date,
                            days_until_expiry=days_until,
                            severity=severity,
                            status='active',
                        )
                        session.add(alert)
                        alerts_created += 1

                # Mark expired alerts as resolved
                expired_alerts = session.query(ExpirationAlert).filter(
                    ExpirationAlert.organization_id == org_id,
                    ExpirationAlert.status == 'active',
                    ExpirationAlert.expiry_date < today,
                ).all()

                for alert in expired_alerts:
                    alert.status = 'resolved'
                    alert.notes = 'Auto-resolved: expiry date has passed'
                    alerts_resolved += 1

        logger.info(
            "Expiration check completed: %d created, %d updated, %d resolved",
            alerts_created, alerts_updated, alerts_resolved
        )

        return {
            "success": True,
            "alerts_created": alerts_created,
            "alerts_updated": alerts_updated,
            "alerts_resolved": alerts_resolved,
        }

    except Exception as e:
        logger.exception("Failed to check expiring rights/consents")
        return {"success": False, "error": str(e)}


@celery_app.task(
    base=OrgTask,
    bind=True,
    name='app.tasks.media.execute_workspace_bulk_action',
    max_retries=3,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=300,
    soft_time_limit=600,
    time_limit=900,
)
def execute_workspace_bulk_action_task(
    self: Task,
    run_id: str,
    organization_id: str,
    workspace_id: str,
    action: str,
    action_params: dict,
    user_id: str,
    media_ids: list[str] | None = None,
    item_ids: list[str] | None = None,
) -> dict[str, Any]:
    """
    Execute a bulk action on media workspace items.

    This task processes bulk operations like:
    - bulk_tag: Add/remove tags from multiple items
    - bulk_move: Move items to different folder
    - bulk_delete: Delete multiple items
    - bulk_publish: Publish multiple items
    - bulk_unpublish: Unpublish multiple items

    Args:
        run_id: MediaWorkspaceActionRun UUID for tracking progress
        organization_id: Organization UUID
        workspace_id: MediaWorkspace UUID
        action: Action type to execute
        action_params: Action-specific parameters
        user_id: User UUID who initiated the action
        media_ids: Media UUIDs to process. Preferred — works for both
            pinned and dynamic workspace contents.
        item_ids: Legacy MediaWorkspaceItem UUIDs. Resolved to media_ids
            for backward compatibility with any in-flight jobs queued
            before the dynamic-workspace fix.

    Returns:
        Dict with execution results
    """
    from app.models import (
        Media, MediaWorkspace, MediaWorkspaceItem, MediaWorkspaceActionRun
    )

    try:
        # Load the run record
        run = current_session().query(MediaWorkspaceActionRun).filter_by(
            run_id=UUID(run_id)
        ).first()

        if not run:
            logger.error("MediaWorkspaceActionRun not found: %s", run_id)
            return {"success": False, "error": "Run not found"}

        # Resolve legacy item_ids to media_ids if caller used the old shape.
        if media_ids is None:
            if item_ids is None:
                return {"success": False, "error": "media_ids or item_ids required"}
            legacy_rows = current_session().query(MediaWorkspaceItem.media_id).filter(
                MediaWorkspaceItem.workspace_id == UUID(workspace_id),
                MediaWorkspaceItem.workspace_item_id.in_([UUID(i) for i in item_ids]),
            ).all()
            media_ids = [str(row.media_id) for row in legacy_rows]

        # Update status to processing
        run.status = "processing"
        run.started_at = datetime.now(timezone.utc)
        current_session().commit()

        succeeded = 0
        failed = 0
        results = []

        # Process each media id
        for media_id in media_ids:
            try:
                media = current_session().query(Media).filter_by(
                    media_id=UUID(media_id),
                ).first()

                if not media:
                    results.append({
                        "media_id": media_id,
                        "status": "error",
                        "message": "Media not found",
                    })
                    failed += 1
                    continue

                # Execute action based on type.
                # Note: bulk_tag is handled by the synchronous endpoint in
                # media_workspaces.py (registered with is_async=False) because
                # it operates on structured tags and requires on-demand value
                # creation for dynamic_keywords. Do not re-implement it here.
                if action == "bulk_move":
                    folder_id = action_params.get("folder_id")
                    if folder_id:
                        media.folder_id = UUID(folder_id)
                    else:
                        media.folder_id = None
                    media.updated_by = UUID(user_id)

                elif action == "bulk_publish":
                    media.is_published = True
                    media.published_at = datetime.now(timezone.utc)
                    media.updated_by = UUID(user_id)

                elif action == "bulk_unpublish":
                    media.is_published = False
                    media.published_at = None
                    media.updated_by = UUID(user_id)

                elif action == "bulk_delete":
                    media.is_deleted = True
                    media.deleted_at = datetime.now(timezone.utc)
                    media.deleted_by = UUID(user_id)

                results.append({
                    "media_id": str(media.media_id),
                    "status": "success",
                })
                succeeded += 1

            except Exception as e:
                logger.warning(f"Failed to process media {media_id}: {e}")
                results.append({
                    "media_id": media_id,
                    "status": "error",
                    "message": str(e),
                })
                failed += 1

            # Update progress periodically
            if (succeeded + failed) % 10 == 0:
                run.processed_items = succeeded + failed
                current_session().commit()

        # Finalize run
        run.status = "completed" if failed == 0 else "completed_with_errors"
        run.completed_at = datetime.now(timezone.utc)
        run.processed_items = succeeded + failed
        run.succeeded_items = succeeded
        run.failed_items = failed
        run.results = results

        current_session().commit()

        logger.info(
            "Bulk action %s completed: %d succeeded, %d failed",
            action, succeeded, failed
        )

        return {
            "success": True,
            "run_id": run_id,
            "action": action,
            "succeeded": succeeded,
            "failed": failed,
        }

    except Exception as e:
        logger.exception("Failed to execute bulk action %s", run_id)

        # Update run status to failed
        try:
            run = current_session().query(MediaWorkspaceActionRun).filter_by(
                run_id=UUID(run_id)
            ).first()
            if run:
                run.status = "failed"
                run.error_message = str(e)
            current_session().commit()
        except Exception as rollback_err:
            logger.debug(f"Failed to update job status: {rollback_err}")
            current_session().rollback()

        raise


@celery_app.task(
    base=OrgTask,
    bind=True,
    name='app.tasks.media.embed_object_metadata',
    max_retries=3,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=300,
    soft_time_limit=300,
    time_limit=600,
)
def embed_object_metadata_task(
    self: Task,
    media_id: str,
    object_id: str,
    organization_id: str,
) -> dict[str, Any]:
    """
    Embed CollectionObject metadata into media derivatives.

    This task:
    1. Aggregates metadata from CollectionObject and related records
    2. Stores denormalized metadata on Media.inherited_metadata
    3. Embeds XMP metadata into image derivatives
    4. Re-indexes the media in OpenSearch

    Triggered when a CollectionObjectMedia link is created.

    Args:
        media_id: Media UUID
        object_id: CollectionObject UUID
        organization_id: Organization UUID

    Returns:
        Dict with processing results
    """
    from app.models import Media, MediaProcessingJob

    try:
        org_uuid = UUID(organization_id)
        media_uuid = UUID(media_id)

        # Load media record
        media = current_session().query(Media).filter_by(
            media_id=media_uuid,
            organization_id=org_uuid,
        ).first()

        if not media:
            logger.error("Media not found: %s", media_id)
            return {"success": False, "error": "Media not found"}

        # Create processing job for tracking
        job = MediaProcessingJob(
            media_id=media_uuid,
            organization_id=org_uuid,
            job_type="metadata_embed",
            status="processing",
            celery_task_id=self.request.id,
            started_at=datetime.now(timezone.utc),
        )
        current_session().add(job)
        current_session().commit()

        # Step 1: Aggregate metadata from object
        from app.services.object_metadata_aggregator import aggregate_object_metadata

        logger.info("Aggregating metadata for object %s", object_id)
        aggregated_metadata = aggregate_object_metadata(object_id, organization_id)

        if not aggregated_metadata:
            job.status = "failed"
            job.error_message = "Failed to aggregate object metadata"
            job.completed_at = datetime.now(timezone.utc)
            current_session().commit()
            return {"success": False, "error": "Failed to aggregate object metadata"}

        # Step 2: Store denormalized metadata on Media record
        # Merge with existing inherited_metadata if media is linked to multiple objects
        existing_metadata = media.inherited_metadata or {}
        linked_objects = existing_metadata.get('linked_objects', [])

        # Check if this object already exists in the list
        obj_id_str = str(object_id)
        existing_idx = next(
            (i for i, obj in enumerate(linked_objects) if obj.get('object', {}).get('object_id') == obj_id_str),
            None
        )

        if existing_idx is not None:
            # Update existing entry
            linked_objects[existing_idx] = aggregated_metadata
        else:
            # Add new entry
            linked_objects.append(aggregated_metadata)

        media.inherited_metadata = {
            'linked_objects': linked_objects,
            'updated_at': datetime.now(timezone.utc).isoformat(),
        }
        media.inherited_metadata_updated_at = datetime.now(timezone.utc)
        current_session().commit()

        logger.info("Stored inherited metadata for media %s", media_id)

        # Step 3: Embed metadata in derivatives (only for images)
        embed_result = {"derivatives_updated": 0, "errors": []}

        if media.media_type == 'image':
            from app.services.media_metadata_embedder import write_metadata_to_derivatives

            logger.info("Embedding XMP metadata in derivatives for media %s", media_id)
            embed_result = write_metadata_to_derivatives(
                media_id,
                organization_id,
                aggregated_metadata,
            )

            if embed_result.get("errors"):
                logger.warning(
                    "Some derivatives failed XMP embedding: %s",
                    embed_result["errors"]
                )

        # Step 4: Re-index in OpenSearch
        reindex_result = {"indexed": False}
        try:
            from app.search.media.index_manager import MediaIndexManager

            index_manager = MediaIndexManager()
            if index_manager.is_available():
                index_manager.index_media(media)
                reindex_result["indexed"] = True
                logger.info("Re-indexed media %s in OpenSearch", media_id)
        except Exception as idx_err:
            logger.warning("Failed to re-index media %s: %s", media_id, idx_err)
            reindex_result["error"] = str(idx_err)

        # Update job status
        job.status = "completed"
        job.completed_at = datetime.now(timezone.utc)
        job.result = {
            "metadata_aggregated": True,
            "derivatives_updated": embed_result.get("derivatives_updated", 0),
            "indexed": reindex_result.get("indexed", False),
        }
        current_session().commit()

        return {
            "success": True,
            "media_id": media_id,
            "object_id": object_id,
            "metadata_stored": True,
            "derivatives_updated": embed_result.get("derivatives_updated", 0),
            "indexed": reindex_result.get("indexed", False),
        }

    except Exception as e:
        logger.exception("Failed to embed object metadata for media %s", media_id)

        # Update job status to failed
        try:
            job = current_session().query(MediaProcessingJob).filter_by(
                celery_task_id=self.request.id
            ).first()
            if job:
                job.status = "failed"
                job.error_message = str(e)
                job.retry_count = (job.retry_count or 0) + 1
            current_session().commit()
        except Exception as rollback_err:
            logger.debug(f"Failed to update job status: {rollback_err}")
            current_session().rollback()

        raise


# =============================================================================
# Smart Collection Refresh
# =============================================================================

@celery_app.task(
    base=SystemTask,
    name='app.tasks.media.refresh_smart_collections',
    soft_time_limit=300,
    time_limit=360,
)
def refresh_smart_collections() -> dict[str, Any]:
    """
    Periodic task to refresh smart collections (saved-search-based collections).

    Runs every 15 minutes via Celery Beat.
    Re-executes saved searches and diffs collection membership.
    """
    from app.models import MediaCollection, MediaCollectionItem, Media
    from app.search.media import MediaSearchService, get_media_search_service
    from app.search.media.schemas import MediaSearchRequest

    if not MediaSearchService.is_available():
        return {"refreshed": 0, "skipped": True}

    search_service = get_media_search_service()
    now = datetime.now(timezone.utc)

    # Find smart collections due for refresh
    smart_collections = current_session().query(MediaCollection).filter(
        MediaCollection.collection_type == "smart",
        MediaCollection.auto_refresh.is_(True),
        MediaCollection.saved_search.isnot(None),
    ).all()

    refreshed = 0
    for collection in smart_collections:
        # Check if refresh is due
        if collection.last_refreshed_at:
            elapsed = (now - collection.last_refreshed_at).total_seconds() / 60
            if elapsed < collection.refresh_interval_minutes:
                continue

        try:
            search_params = collection.saved_search
            search_request = MediaSearchRequest(
                query=search_params.get("query", ""),
                media_type=search_params.get("media_type"),
                folder=search_params.get("folder"),
                copyright_status=search_params.get("copyright_status"),
                is_published=search_params.get("is_published"),
                limit=500,  # Max items for smart collection
            )

            result = search_service.search(
                search_request,
                collection.organization_id,
            )

            # Get current member IDs
            current_ids = set(
                str(item.media_id) for item in
                current_session().query(MediaCollectionItem.media_id).filter_by(
                    collection_id=collection.collection_id,
                ).all()
            )

            # Get new result IDs
            new_ids = set(hit.media_id for hit in result.hits)

            # Add new members
            to_add = new_ids - current_ids
            for media_id_str in to_add:
                item = MediaCollectionItem(
                    collection_id=collection.collection_id,
                    media_id=UUID(media_id_str),
                    sort_order=0,
                )
                current_session().add(item)

            # Remove stale members
            to_remove = current_ids - new_ids
            if to_remove:
                current_session().query(MediaCollectionItem).filter(
                    MediaCollectionItem.collection_id == collection.collection_id,
                    MediaCollectionItem.media_id.in_([UUID(mid) for mid in to_remove]),
                ).delete(synchronize_session=False)

            # Update collection
            collection.item_count = len(new_ids)
            collection.last_refreshed_at = now
            current_session().commit()
            refreshed += 1

        except Exception as e:
            logger.warning("Failed to refresh smart collection %s: %s", collection.collection_id, e)
            current_session().rollback()

    logger.info("Refreshed %d smart collections", refreshed)
    return {"refreshed": refreshed}


# =============================================================================
# Checksum Verification — moved to app.tasks.preservation
# =============================================================================


# =============================================================================
# Saved Search Notifications
# =============================================================================

@celery_app.task(
    base=SystemTask,
    name='app.tasks.media.check_search_subscriptions',
    soft_time_limit=600,
    time_limit=660,
)
def check_search_subscriptions() -> dict[str, Any]:
    """
    Periodic task to check saved search subscriptions for new results.

    Runs every 4 hours. Diffs results and sends notifications for new matches.
    """
    from app.models import MediaSearchSubscription
    from app.search.media import MediaSearchService, get_media_search_service
    from app.search.media.schemas import MediaSearchRequest

    if not MediaSearchService.is_available():
        return {"checked": 0, "notified": 0, "skipped": True}

    search_service = get_media_search_service()
    now = datetime.now(timezone.utc)

    subs = current_session().query(MediaSearchSubscription).filter(
        MediaSearchSubscription.is_active.is_(True),
    ).all()

    checked = 0
    notified = 0

    for sub in subs:
        try:
            search_params = sub.search_params
            search_request = MediaSearchRequest(
                query=search_params.get("query", ""),
                media_type=search_params.get("media_type"),
                folder=search_params.get("folder"),
                limit=100,
            )

            result = search_service.search(search_request, sub.organization_id)
            current_ids = [hit.media_id for hit in result.hits]

            # Diff with last known results
            previous_ids = set(sub.last_result_ids or [])
            new_ids = [mid for mid in current_ids if mid not in previous_ids]

            if new_ids and sub.notify_on_new:
                # Send notification via existing notification service
                try:
                    from app.services.notification_service import send_notification
                    send_notification(
                        user_id=sub.user_id,
                        notification_type="search_results_updated",
                        data={
                            "new_count": len(new_ids),
                            "search_query": search_params.get("query", ""),
                            "new_media_ids": new_ids[:10],
                        },
                    )
                    notified += 1
                except Exception as e:
                    logger.warning("Failed to send search notification: %s", e)

            # Update subscription
            sub.last_result_ids = current_ids
            sub.last_checked_at = now
            checked += 1

        except Exception as e:
            logger.warning("Failed to check search subscription %s: %s", sub.subscription_id, e)

    current_session().commit()
    logger.info("Checked %d search subscriptions, sent %d notifications", checked, notified)
    return {"checked": checked, "notified": notified}


@celery_app.task(
    base=SystemTask,
    name='app.tasks.media.cleanup_stuck_media_jobs',
    soft_time_limit=120,
    time_limit=180,
)
def cleanup_stuck_media_jobs() -> dict[str, Any]:
    """
    Find and fail media processing jobs that appear stuck.

    Runs periodically to catch jobs where the Celery worker crashed or
    the task timed out without updating the DB. Thresholds:
    - General processing jobs: stuck > 15 minutes
    - Transcode jobs: stuck > 30 minutes (the periodic poller updates
      progress every 60s, so 30 min with no update = genuinely dead)

    Also catches Media records stuck in processing/transcoding with no
    active processing job — these are orphaned from a previous crash.
    """
    from app.models import Media, MediaProcessingJob
    from app.tasks.rls_helpers import admin_db_session

    now = datetime.now(timezone.utc)
    general_cutoff = now - timedelta(minutes=15)
    transcode_cutoff = now - timedelta(minutes=30)

    jobs_failed = 0
    media_failed = 0

    try:
        with admin_db_session() as session:
            # 1. Find stuck general processing jobs (derivatives)
            stuck_general = session.query(MediaProcessingJob).filter(
                MediaProcessingJob.status == "processing",
                MediaProcessingJob.job_type != "transcode",
                MediaProcessingJob.started_at < general_cutoff,
            ).all()

            for job in stuck_general:
                job.status = "failed"
                job.error_message = "Processing timed out — worker may have crashed"
                job.completed_at = now
                jobs_failed += 1
                logger.warning(
                    "Marked stuck job %s as failed (type=%s, media=%s, started=%s)",
                    job.job_id, job.job_type, job.media_id, job.started_at,
                )

            # 2. Find stuck transcode jobs (longer threshold)
            stuck_transcode = session.query(MediaProcessingJob).filter(
                MediaProcessingJob.status == "processing",
                MediaProcessingJob.job_type == "transcode",
                MediaProcessingJob.started_at < transcode_cutoff,
            ).all()

            for job in stuck_transcode:
                job.status = "failed"
                job.error_message = "Transcoding timed out — worker may have crashed"
                job.completed_at = now
                jobs_failed += 1
                logger.warning(
                    "Marked stuck transcode job %s as failed (media=%s, started=%s)",
                    job.job_id, job.media_id, job.started_at,
                )

            # 3. Find orphaned Media records stuck in processing/transcoding
            #    with no active (processing/pending) job
            from sqlalchemy import and_, not_, exists
            from sqlalchemy.orm import aliased

            active_job_exists = session.query(MediaProcessingJob.job_id).filter(
                MediaProcessingJob.media_id == Media.media_id,
                MediaProcessingJob.status.in_(["processing", "pending"]),
            ).exists()

            stuck_media = session.query(Media).filter(
                Media.processing_status.in_(["processing", "transcoding"]),
                ~active_job_exists,
            ).all()

            for media in stuck_media:
                media.processing_status = "failed"
                media_failed += 1
                logger.warning(
                    "Marked orphaned media %s as failed (was %s with no active job)",
                    media.media_id, "processing/transcoding",
                )

    except Exception:
        logger.exception("Error in cleanup_stuck_media_jobs")
        raise

    logger.info(
        "Stuck media cleanup: %d jobs failed, %d orphaned media failed",
        jobs_failed, media_failed,
    )
    return {"jobs_failed": jobs_failed, "media_failed": media_failed}


# ---------------------------------------------------------------------------
# Contact sheet generation (async)
# ---------------------------------------------------------------------------

@celery_app.task(
    base=OrgTask,
    bind=True,
    name='app.tasks.media.generate_contact_sheet_task',
    max_retries=2,
    soft_time_limit=240,
    time_limit=300,
)
def generate_contact_sheet_task(
    self: Task,
    run_id: str,
    organization_id: str,
) -> dict[str, Any]:
    """
    Generate a PDF contact sheet asynchronously.

    Steps:
    1. Load ReportRun, mark as running
    2. Extract params from context_params
    3. Call generate_contact_sheet() service
    4. Upload PDF to S3
    5. Mark run completed, create notification

    Args:
        run_id: ReportRun UUID
        organization_id: Organization UUID

    Returns:
        Dict with execution results
    """
    from app.models import ReportRun
    from app.services.contact_sheet import generate_contact_sheet
    from app.services import report_storage
    from app.services.notification_service import create_notification
    import hashlib

    try:
        run = current_session().query(ReportRun).filter_by(
            run_id=UUID(run_id),
            organization_id=UUID(organization_id),
        ).first()

        if not run:
            logger.error("ReportRun not found: %s", run_id)
            return {"success": False, "error": "Run not found"}

        if run.status == "cancelled":
            logger.info("ReportRun %s was cancelled, skipping", run_id)
            return {"success": False, "skipped": True}

        # Mark as running
        run.status = "running"
        run.started_at = datetime.now(timezone.utc)
        current_session().commit()

        try:
            params = run.context_params or {}
            collection_id = UUID(params["collection_id"])

            start_time = datetime.now(timezone.utc)

            pdf_bytes = generate_contact_sheet(
                collection_id=collection_id,
                organization_id=UUID(organization_id),
                layout=params.get("layout", "grid"),
                page_size=params.get("page_size", "letter"),
                columns=params.get("columns", 4),
                include_title=params.get("include_title", True),
                include_filename=params.get("include_filename", True),
                include_description=params.get("include_description", False),
                db=current_session(),
            )

            end_time = datetime.now(timezone.utc)
            execution_time_ms = int((end_time - start_time).total_seconds() * 1000)

            # Upload to S3
            synthetic_report_id = hashlib.md5(b"contact_sheet").hexdigest()[:32]
            synthetic_report_id = (
                f"{synthetic_report_id[:8]}-{synthetic_report_id[8:12]}-"
                f"{synthetic_report_id[12:16]}-{synthetic_report_id[16:20]}-"
                f"{synthetic_report_id[20:]}"
            )

            s3_key = report_storage.upload_report_export(
                organization_id=organization_id,
                report_id=synthetic_report_id,
                run_id=run.run_id,
                content=pdf_bytes,
                export_format="pdf",
                report_name="Contact_Sheet",
            )

            # Update run
            run.status = "completed"
            run.execution_time_ms = execution_time_ms
            run.export_s3_key = s3_key
            run.completed_at = datetime.now(timezone.utc)
            current_session().commit()

            # Create notification
            if run.triggered_by_user_id:
                try:
                    create_notification(
                        organization_id=UUID(organization_id),
                        user_id=run.triggered_by_user_id,
                        notification_type="report_ready",
                        title="Contact sheet ready",
                        message="Your contact sheet PDF is ready for download.",
                        entity_type="report_run",
                        entity_id=run.run_id,
                    )
                except Exception as e:
                    logger.warning("Failed to create notification for contact sheet %s: %s", run_id, e)

            logger.info(
                "Contact sheet generated: run=%s, collection=%s",
                run_id, params.get("collection_id"),
            )

            return {
                "success": True,
                "run_id": str(run.run_id),
                "execution_time_ms": execution_time_ms,
            }

        except Exception as e:
            logger.error("Contact sheet generation failed: %s", str(e), exc_info=True)
            run.status = "failed"
            run.error_message = str(e)[:500]
            run.completed_at = datetime.now(timezone.utc)
            current_session().commit()
            raise

    except Exception as e:
        logger.error("Contact sheet task failed: %s", str(e), exc_info=True)
        raise


# ---------------------------------------------------------------------------
# Cleanup deleted media
# ---------------------------------------------------------------------------

@celery_app.task(
    name='app.tasks.media.cleanup_deleted_media',
    max_retries=2,
    autoretry_for=(Exception,),
    retry_backoff=True,
    soft_time_limit=120,
    time_limit=180,
    queue='media',
)
def cleanup_deleted_media(
    organization_id: str,
    media_id: str,
    s3_key: str | None,
    thumbnail_key: str | None,
):
    """Clean up S3 files after a media record has been deleted from the DB."""
    from app.services.uploads import delete_org_media

    logger.info("Cleaning up S3 for deleted media %s (org=%s)", media_id, organization_id)

    # Delete derivatives
    try:
        from app.services.media_processing import delete_derivatives
        delete_derivatives(organization_id, media_id)
    except Exception as e:
        logger.warning("Failed to delete derivatives for %s: %s", media_id, e)

    # Delete original
    if s3_key:
        try:
            delete_org_media(s3_key)
        except Exception as e:
            logger.warning("Failed to delete original %s: %s", s3_key, e)

    # Delete thumbnail
    if thumbnail_key:
        try:
            delete_org_media(thumbnail_key)
        except Exception as e:
            logger.warning("Failed to delete thumbnail %s: %s", thumbnail_key, e)
