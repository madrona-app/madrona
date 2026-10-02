"""
Background tasks for entity classification.

Tasks run asynchronously in Celery workers to:
1. Apply heuristic rules (fast)
2. Check classification cache (fast)
3. Use AI classification (slow fallback)
"""

import logging
import hashlib
import json
from typing import Any
from uuid import UUID

from celery import Task
from sqlalchemy.orm import Session

from app.celery_app import celery_app
from app.database import current_session
from app.models import EntityCurrent
from app.services.ai_service import get_ai_service
from app.tasks.base import OrgTask

logger = logging.getLogger(__name__)


class ClassificationCache:
    """
    Cache classifications based on payload structure.

    Key insight: Records with identical field structures often have the same type.
    E.g., 10,000 Smithsonian specimens with same schema → classify once, apply to all.
    """

    @staticmethod
    def get_signature(payload: dict) -> str:
        """Generate cache key from payload structure."""
        # Sort keys to get consistent hash for same structure
        keys = sorted(payload.keys())
        # Include types for more specificity
        types = [type(payload[k]).__name__ for k in keys]
        signature = f"{','.join(keys)}:{','.join(types)}"
        return hashlib.md5(signature.encode()).hexdigest()

    @staticmethod
    def get(signature: str) -> str | None:
        """Get cached classification (from Redis)."""
        from app.celery_app import celery_app
        redis = celery_app.backend.client
        cached = redis.get(f"classification:{signature}")
        return cached.decode() if cached else None

    @staticmethod
    def set(signature: str, entity_type: str, ttl: int = 86400):
        """Cache classification for 24 hours."""
        from app.celery_app import celery_app
        redis = celery_app.backend.client
        redis.setex(f"classification:{signature}", ttl, entity_type)


def heuristic_classify(payload: dict) -> str | None:
    """
    Fast heuristic classification based on field patterns.

    Returns entity_type if confident, None if AI needed.
    """
    # Museum objects - very common pattern
    if any(k in payload for k in [
        "object_number", "accession_number", "catalog_number",
        "collection_number", "record_id"
    ]):
        # Additional confidence check
        if any(k in payload for k in ["title", "description", "medium", "dimensions"]):
            return "museum_object"

    # Collections
    if "collection" in str(payload).lower():
        if any(k in payload for k in ["collection_name", "collection_id"]):
            return "collection"

    # People/Artists
    if any(k in payload for k in ["birth_date", "death_date", "birth_place", "death_place"]):
        return "person"
    if "biography" in payload or "artist" in str(payload).lower():
        return "person"

    # Organizations
    if any(k in payload for k in ["organization_name", "institution", "founded_date"]):
        return "organization"

    # Places
    if any(k in payload for k in ["latitude", "longitude", "coordinates", "location"]):
        if not any(k in payload for k in ["object_number", "title"]):  # Not an object with location
            return "place"

    # Events
    if any(k in payload for k in ["event_date", "event_type", "exhibition_date"]):
        return "event"

    # Documents
    if any(k in payload for k in ["document_type", "publication_date", "isbn", "doi"]):
        return "document"

    # Media
    if any(k in payload for k in ["media_type", "file_format", "duration", "resolution"]):
        return "media"

    return None  # Uncertain - needs AI


@celery_app.task(
    base=OrgTask,
    bind=True,
    name='app.tasks.classification.classify_entity',
    max_retries=3,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=300,
)
def classify_entity_task(
    self: Task,
    entity_key: str,
    organization_id: str,
    force_ai: bool = False
) -> dict[str, Any]:
    """
    Classify an entity's type using heuristics, cache, or AI.

    Args:
        entity_key: Entity identifier (e.g., "smithsonian:123")
        organization_id: Organization UUID
        force_ai: Skip heuristics/cache and use AI directly

    Returns:
        dict with classification result and method used
    """
    try:
        # Load entity
        entity = current_session().query(EntityCurrent).filter_by(
            organization_id=UUID(organization_id),
            entity_key=entity_key
        ).first()

        if not entity:
            logger.error(f"Entity not found: {entity_key}")
            return {"success": False, "error": "Entity not found"}

        # Skip if already classified (unless force_ai)
        if entity.entity_type != "unclassified" and not force_ai:
            logger.debug(f"Entity {entity_key} already classified as {entity.entity_type}")
            return {
                "success": True,
                "entity_key": entity_key,
                "entity_type": entity.entity_type,
                "method": "skipped"
            }

        payload = entity.payload
        method = "unknown"
        entity_type = None

        # Step 1: Try heuristics (instant)
        if not force_ai:
            entity_type = heuristic_classify(payload)
            if entity_type:
                method = "heuristic"
                logger.info(f"Classified {entity_key} as {entity_type} using heuristics")

        # Step 2: Try cache (instant)
        if not entity_type and not force_ai:
            signature = ClassificationCache.get_signature(payload)
            entity_type = ClassificationCache.get(signature)
            if entity_type:
                method = "cache"
                logger.info(f"Classified {entity_key} as {entity_type} from cache")

        # Step 3: Use AI (slow)
        if not entity_type:
            try:
                ai_service = get_ai_service()
                entity_type = ai_service.detect_entity_type(
                    payload,
                    source_system=entity.source_system
                )
                method = "ai"
                logger.info(f"Classified {entity_key} as {entity_type} using AI")

                # Cache this classification
                if not force_ai:
                    signature = ClassificationCache.get_signature(payload)
                    ClassificationCache.set(signature, entity_type)

            except Exception as ai_error:
                logger.error(f"AI classification failed for {entity_key}: {ai_error}")
                entity_type = "record"  # Fallback
                method = "fallback"

        # Update entity
        entity.entity_type = entity_type
        current_session().commit()

        return {
            "success": True,
            "entity_key": entity_key,
            "entity_type": entity_type,
            "method": method
        }

    except Exception as e:
        logger.exception(f"Task failed for {entity_key}")
        raise


@celery_app.task(base=OrgTask, name='app.tasks.classification.classify_dataset')
def classify_dataset_task(
    dataset_id: str,
    organization_id: str,
    force_ai: bool = False
) -> dict[str, Any]:
    """
    Queue classification tasks for all entities in a dataset.

    Args:
        dataset_id: Dataset UUID
        organization_id: Organization UUID
        force_ai: Skip heuristics/cache and use AI directly

    Returns:
        dict with queued count
    """
    # Get all entities in dataset (exclude deleted)
    entities = current_session().query(EntityCurrent).filter_by(
        organization_id=UUID(organization_id),
        dataset_id=UUID(dataset_id)
    ).filter(EntityCurrent.is_deleted == False).all()

    # Queue individual classification tasks
    queued = 0
    for entity in entities:
        classify_entity_task.delay(
            entity.entity_key,
            str(entity.organization_id),
            force_ai
        )
        queued += 1

    logger.info(f"Queued {queued} classification tasks for dataset {dataset_id}")

    return {
        "success": True,
        "dataset_id": dataset_id,
        "queued": queued
    }
