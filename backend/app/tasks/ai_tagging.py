"""
Background tasks for AI-powered media tagging.

Tasks run asynchronously in Celery workers to:
1. Analyze images using AWS Rekognition (labels, text, faces)
2. Extract text from PDFs using pypdfium2
3. Map AI tags to organization tag definitions
4. Support bulk reprocessing of media items
"""

import logging
from datetime import datetime, timezone
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
    name='app.tasks.ai_tagging.process_media',
    max_retries=3,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=300,
    soft_time_limit=240,
    time_limit=300,
)
def process_media_ai_tags(
    self: Task,
    media_id: str,
    organization_id: str,
    force: bool = False,
) -> dict[str, Any]:
    """
    Process AI tagging for a media asset.

    Called automatically after upload processing completes,
    or on-demand via API.

    Supports:
    - Images: AWS Rekognition (labels, text, faces)
    - PDFs: pypdfium2 text extraction (local, no API cost)

    Args:
        media_id: Media UUID as string
        organization_id: Organization UUID as string
        force: If True, reprocess even if already completed

    Returns:
        Dict with processing results
    """
    from app.models import Media
    from app.services.ai_tagging import get_ai_tagging_service

    # Deployment-level gate, checked before anything touches the database or
    # AWS. Rekognition is the only provider, so without it every image would
    # raise UnrecognizedClientException. Per-org MediaAIConfig toggles apply
    # on top of this, not instead of it.
    from app.config import get_settings

    if not get_settings().ai_tagging_enabled:
        logger.debug("AI tagging disabled (AI_TAGGING_ENABLED is false)")
        return {"status": "skipped", "reason": "ai_tagging_disabled"}

    try:
        service = get_ai_tagging_service(UUID(organization_id))

        # Check if AI tagging is enabled
        if not service.config.auto_tag_on_upload and not force:
            logger.debug(f"AI tagging disabled for org {organization_id}")
            return {"status": "skipped", "reason": "disabled"}

        # Get media record
        media = current_session().query(Media).filter_by(
            media_id=UUID(media_id),
            organization_id=UUID(organization_id),
        ).first()

        if not media:
            logger.error(f"Media not found: {media_id}")
            return {"status": "skipped", "reason": "not_found"}

        # Skip if already processed (unless force)
        if media.ai_processing_status == "completed" and not force:
            logger.debug(f"Media {media_id} already processed")
            return {"status": "skipped", "reason": "already_processed"}

        # Check supported media types
        is_image = media.media_type in ('image', 'photo')
        is_pdf = media.mime_type == 'application/pdf'

        if not is_image and not is_pdf:
            logger.debug(f"Unsupported media type for AI tagging: {media.media_type}")
            media.ai_processing_status = "skipped"
            current_session().commit()
            return {"status": "skipped", "reason": "unsupported_type"}

        # Update status to processing
        media.ai_processing_status = "processing"
        current_session().commit()

        try:
            # Run analysis based on media type
            if is_image:
                logger.info(f"Analyzing image {media_id} with Rekognition")
                results = service.analyze_image(UUID(media_id), media.s3_key)
            elif is_pdf:
                logger.info(f"Extracting text from PDF {media_id}")
                results = service.analyze_pdf(UUID(media_id), media.s3_key)
            else:
                # Should not reach here due to earlier check
                media.ai_processing_status = "skipped"
                current_session().commit()
                return {"status": "skipped", "reason": "unsupported_format"}

            # Store raw AI tags
            service.store_ai_tags(UUID(media_id), results)

            # Map and apply to org tags
            mapped = service.map_to_org_tags(results.all_tags)
            service.apply_tags(UUID(media_id), mapped)

            # Update media record
            media.ai_processing_status = "completed"
            media.ai_processed_at = datetime.now(timezone.utc)
            media.ai_label_count = len(results.labels)
            current_session().commit()

            # Reindex media for search (includes AI tags now)
            try:
                from app.search.media.service import MediaSearchService
                search_service = MediaSearchService()
                if search_service.is_available():
                    search_service.index_media(media)
            except Exception as idx_err:
                logger.warning(f"Failed to reindex media {media_id} after AI tagging: {idx_err}")

            result = {
                "status": "completed",
                "media_id": media_id,
                "labels": len(results.labels),
                "text_blocks": len(results.text),
                "faces": len(results.faces),
                "celebrities": len(results.celebrities),
                "moderation": len(results.moderation),
                "mapped_tags": len(mapped),
                "cost_usd": str(results.cost_usd),
            }

            logger.info(
                f"AI tagging completed for media {media_id}: "
                f"{len(results.all_tags)} tags detected, {len(mapped)} mapped"
            )

            return result

        except Exception as e:
            logger.exception(f"AI tagging failed for media {media_id}")
            media.ai_processing_status = "failed"
            current_session().commit()
            raise

    except Exception as e:
        logger.exception(f"Task failed for media {media_id}")
        raise


@celery_app.task(
    base=OrgTask,
    bind=True,
    name='app.tasks.ai_tagging.bulk_process',
    max_retries=1,
    soft_time_limit=3600,
    time_limit=3900,
)
def bulk_process_ai_tags(
    self: Task,
    organization_id: str,
    media_ids: list[str] | None = None,
    media_type: str | None = None,
    status_filter: str | None = None,
    force: bool = False,
    limit: int | None = None,
) -> dict[str, Any]:
    """
    Queue AI tagging tasks for multiple media items.

    Args:
        organization_id: Organization UUID as string
        media_ids: Optional list of specific media IDs to process
        media_type: Optional filter by media type ('image', 'document', etc.)
        status_filter: Optional filter by AI processing status
        force: If True, reprocess even if already completed
        limit: Optional maximum number of items to process

    Returns:
        Dict with count of queued items
    """
    from app.models import Media

    try:
        # Build query
        query = current_session().query(Media).filter(
            Media.organization_id == UUID(organization_id)
        )

        if media_ids:
            query = query.filter(
                Media.media_id.in_([UUID(mid) for mid in media_ids])
            )

        if media_type:
            query = query.filter(Media.media_type == media_type)

        if status_filter:
            query = query.filter(Media.ai_processing_status == status_filter)
        elif not force:
            # By default, only process items that haven't been processed
            query = query.filter(
                (Media.ai_processing_status.is_(None)) |
                (Media.ai_processing_status == 'pending') |
                (Media.ai_processing_status == 'failed')
            )

        # Filter to supported types
        query = query.filter(
            (Media.media_type.in_(['image', 'photo'])) |
            (Media.mime_type == 'application/pdf')
        )

        # Apply limit if specified
        if limit:
            query = query.limit(limit)

        # Get media items
        media_items = query.all()

        # Queue individual tasks
        queued = 0
        for media in media_items:
            process_media_ai_tags.delay(
                str(media.media_id),
                organization_id,
                force=force,
            )
            queued += 1

        logger.info(
            f"Queued {queued} AI tagging tasks for org {organization_id}"
        )

        return {
            "status": "success",
            "queued": queued,
            "organization_id": organization_id,
        }

    except Exception as e:
        logger.exception(f"Bulk process failed for org {organization_id}")
        raise


@celery_app.task(base=OrgTask, name='app.tasks.ai_tagging.reapply_mappings')
def reapply_ai_tag_mappings(
    organization_id: str,
    mapping_id: str | None = None,
) -> dict[str, Any]:
    """
    Re-apply AI tag mappings to existing AI tags.

    Useful after creating or updating mappings to apply them
    to previously detected but unmapped tags.

    Args:
        organization_id: Organization UUID as string
        mapping_id: Optional specific mapping ID to apply (applies all if None)

    Returns:
        Dict with count of applied mappings
    """
    from app.models import MediaAITag, MediaAITagMapping, MediaTag

    try:
        org_uuid = UUID(organization_id)

        # Get mappings to apply
        if mapping_id:
            mappings = current_session().query(MediaAITagMapping).filter_by(
                mapping_id=UUID(mapping_id),
                organization_id=org_uuid,
            ).all()
        else:
            mappings = current_session().query(MediaAITagMapping).filter_by(
                organization_id=org_uuid,
                auto_apply=True,
            ).all()

        applied_count = 0
        for mapping in mappings:
            # Find matching AI tags that aren't already mapped
            ai_tags = current_session().query(MediaAITag).filter(
                MediaAITag.organization_id == org_uuid,
                MediaAITag.tag_type == mapping.ai_tag_type,
                MediaAITag.tag_value.ilike(mapping.ai_tag_value),
                MediaAITag.mapping_status == 'pending',
                MediaAITag.confidence >= mapping.min_confidence,
            ).all()

            for ai_tag in ai_tags:
                # Check if MediaTag already exists
                existing = current_session().query(MediaTag).filter_by(
                    media_id=ai_tag.media_id,
                    definition_id=mapping.definition_id,
                ).first()

                if not existing:
                    # Create MediaTag
                    media_tag = MediaTag(
                        organization_id=org_uuid,
                        media_id=ai_tag.media_id,
                        definition_id=mapping.definition_id,
                        tag_value=mapping.mapped_value,
                    )
                    current_session().add(media_tag)

                # Update AI tag status
                ai_tag.mapped_to_definition_id = mapping.definition_id
                ai_tag.mapping_status = 'mapped'
                applied_count += 1

        current_session().commit()

        logger.info(
            f"Re-applied {applied_count} AI tag mappings for org {organization_id}"
        )

        return {
            "status": "success",
            "applied": applied_count,
            "organization_id": organization_id,
        }

    except Exception as e:
        logger.exception(f"Reapply mappings failed for org {organization_id}")
        current_session().rollback()
        raise
