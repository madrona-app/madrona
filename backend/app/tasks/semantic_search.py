"""
Background tasks for semantic search embedding generation.

Tasks:
- generate_object_embedding: Per-object embedding generation + partial index update
- backfill_embeddings: Fan-out for bulk backfill
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
    name='app.tasks.semantic_search.generate_object_embedding',
    max_retries=2,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=120,
    soft_time_limit=60,
    time_limit=90,
)
def generate_object_embedding(
    self: Task,
    object_id: str,
    organization_id: str,
) -> dict[str, Any]:
    """
    Generate a semantic embedding for a single collection object
    and update it in the OpenSearch index.
    """
    from app.config import get_settings
    from app.models import CollectionObject
    from app.services.embedding_service import get_embedding
    from app.search.collections.transformer import CollectionObjectTransformer
    from app.search.collections.service import get_collections_search_service

    settings = get_settings()
    if not settings.semantic_search_enabled:
        return {"success": False, "reason": "Semantic search not enabled"}

    obj = current_session().query(CollectionObject).filter_by(
        object_id=UUID(object_id),
        organization_id=UUID(organization_id),
    ).first()

    if not obj:
        return {"success": False, "error": "Object not found"}

    transformer = CollectionObjectTransformer()
    semantic_text = transformer.compose_semantic_text(obj)
    if not semantic_text:
        return {"success": False, "reason": "No semantic text for object"}

    embedding = get_embedding(semantic_text)
    if not embedding:
        return {"success": False, "reason": "Embedding generation failed"}

    # Partial update in OpenSearch
    service = get_collections_search_service()
    service.index_manager.update_document_partial(
        object_id=object_id,
        organization_id=organization_id,
        fields={"semantic_embedding": embedding},
    )

    logger.info("Semantic embedding generated for object %s", object_id)
    return {"success": True, "object_id": object_id}


@celery_app.task(
    base=OrgTask,
    bind=True,
    name='app.tasks.semantic_search.backfill_embeddings',
    soft_time_limit=3600,
    time_limit=3900,
)
def backfill_embeddings(
    self: Task,
    organization_id: str,
) -> dict[str, Any]:
    """
    Fan-out task to generate semantic embeddings for all objects in an org
    that don't have embeddings in the index yet.
    """
    from app.config import get_settings
    from app.models import CollectionObject
    from app.search.collections.service import (
        CollectionsSearchService,
        get_collections_search_service,
    )

    settings = get_settings()
    if not settings.semantic_search_enabled:
        return {"success": False, "reason": "Semantic search not enabled"}

    if not CollectionsSearchService.is_available():
        return {"success": False, "reason": "Search service unavailable"}

    service = get_collections_search_service()

    # Get all object IDs for this org
    org_uuid = UUID(organization_id)
    all_objects = current_session().query(CollectionObject.object_id).filter_by(
        organization_id=org_uuid,
    ).all()

    all_object_ids = [str(row.object_id) for row in all_objects]
    if not all_object_ids:
        return {"success": True, "queued": 0, "total": 0}

    # Find which objects already have embeddings by checking the index
    existing_ids = set()
    batch_size = 500
    for i in range(0, len(all_object_ids), batch_size):
        batch = all_object_ids[i:i + batch_size]
        query = {
            "query": {
                "bool": {
                    "filter": [
                        {"terms": {"object_id": batch}},
                        {"term": {"organization_id": organization_id}},
                        {"exists": {"field": "semantic_embedding"}},
                    ]
                }
            },
            "size": batch_size,
            "_source": ["object_id"],
        }
        try:
            response = service.index_manager.search(query, organization_id)
            for hit in response.get("hits", {}).get("hits", []):
                existing_ids.add(hit["_source"].get("object_id"))
        except Exception as e:
            logger.warning("Error checking existing embeddings: %s", e)

    # Dispatch tasks for objects missing embeddings
    queued = 0
    for oid in all_object_ids:
        if oid not in existing_ids:
            generate_object_embedding.delay(
                object_id=oid,
                organization_id=organization_id,
            )
            queued += 1

    logger.info(
        "Queued %d semantic embedding tasks for org %s (%d already have embeddings)",
        queued, organization_id, len(existing_ids),
    )
    return {"success": True, "queued": queued, "total": len(all_object_ids)}
