"""
Background tasks for CLIP embedding generation.

Tasks:
- generate_clip_embedding: Per-media embedding generation
- bulk_generate_embeddings: Fan-out for backfill
"""

import logging
import os
import tempfile
from typing import Any
from uuid import UUID

from celery import Task
from PIL import UnidentifiedImageError

from app.celery_app import celery_app
from app.database import current_session
from app.tasks.base import OrgTask

logger = logging.getLogger(__name__)


@celery_app.task(
    base=OrgTask,
    bind=True,
    name='app.tasks.clip.generate_clip_embedding',
    max_retries=2,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=120,
    soft_time_limit=120,
    time_limit=150,
)
def generate_clip_embedding(
    self: Task,
    media_id: str,
    organization_id: str,
) -> dict[str, Any]:
    """
    Generate a CLIP image embedding for a single media item.

    Chained after process_upload_task for image media.
    """
    from app.config import get_settings
    from app.models import Media
    from app.services.clip_service import encode_image, store_embedding
    from app.services.uploads import get_s3_client, get_media_bucket, get_org_storage_region

    settings = get_settings()
    if not settings.clip_enabled:
        return {"success": False, "reason": "CLIP not enabled"}

    media = current_session().query(Media).filter_by(
        media_id=UUID(media_id),
        organization_id=UUID(organization_id),
    ).first()

    if not media:
        return {"success": False, "error": "Media not found"}

    if media.media_type != "image":
        return {"success": False, "reason": "Not an image"}

    try:
        region = get_org_storage_region(organization_id, current_session())
        s3_client = get_s3_client(region)
        bucket = get_media_bucket(region)

        with tempfile.TemporaryDirectory() as tmpdir:
            local_path = os.path.join(tmpdir, media.filename)
            s3_client.download_file(bucket, media.s3_key, local_path)

            with open(local_path, "rb") as f:
                image_bytes = f.read()

            embedding = encode_image(image_bytes)
            store_embedding(
                media_id=UUID(media_id),
                organization_id=UUID(organization_id),
                embedding=embedding,
                embedding_type="clip_image",
                source_derivative="original",
            )

        logger.info("CLIP embedding generated for media %s", media_id)
        return {"success": True, "media_id": media_id}

    except (UnidentifiedImageError, OSError) as e:
        # File is not a valid image — retrying won't help.
        # Log as warning (not error) to avoid Sentry noise.
        logger.warning(
            "CLIP skipped media %s: not a valid image file (%s)", media_id, e
        )
        return {"success": False, "reason": f"Not a valid image: {e}"}

    except Exception as e:
        logger.error("CLIP embedding failed for media %s: %s", media_id, e)
        raise


@celery_app.task(
    base=OrgTask,
    bind=True,
    name='app.tasks.clip.bulk_generate_embeddings',
    soft_time_limit=3600,
    time_limit=3900,
)
def bulk_generate_embeddings(
    self: Task,
    organization_id: str,
) -> dict[str, Any]:
    """
    Fan-out task to generate CLIP embeddings for all images in an org
    that don't have embeddings yet.
    """
    from app.models import Media, MediaEmbedding

    existing_ids = set(
        str(r.media_id) for r in
        current_session().query(MediaEmbedding.media_id).filter_by(
            organization_id=UUID(organization_id),
            embedding_type="clip_image",
        ).all()
    )

    media_items = current_session().query(Media.media_id).filter(
        Media.organization_id == UUID(organization_id),
        Media.media_type == "image",
        Media.processing_status == "completed",
    ).all()

    queued = 0
    for (mid,) in media_items:
        if str(mid) not in existing_ids:
            generate_clip_embedding.delay(
                media_id=str(mid),
                organization_id=organization_id,
            )
            queued += 1

    logger.info("Queued %d CLIP embedding tasks for org %s", queued, organization_id)
    return {"success": True, "queued": queued}
