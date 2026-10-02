"""
Background tasks for OpenSearch indexing.

Replaces the polling-based sync_worker with event-driven Celery tasks.
Called from canonical_store.py when entities are created/updated/deleted.
"""

import logging
from typing import Any

from celery import Task

from app.celery_app import celery_app
from app.tasks.base import OrgTask
from app.config import get_settings
from app.search.client import get_opensearch_client, is_opensearch_available
from app.search.transformer import EntityDocumentTransformer

logger = logging.getLogger(__name__)


@celery_app.task(
    base=OrgTask,
    bind=True,
    name='app.tasks.search.index_entity',
    max_retries=5,
    default_retry_delay=10,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=300,
    soft_time_limit=30,
    time_limit=60,
)
def index_entity_task(
    self: Task,
    entity_key: str,
    organization_id: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    """
    Index an entity to OpenSearch.

    Args:
        entity_key: Unique entity identifier
        organization_id: Organization UUID
        payload: Entity data to index (includes entity_type, source_system, etc.)

    Returns:
        Result dict with status
    """
    settings = get_settings()
    if not settings.opensearch_enabled:
        logger.debug("OpenSearch disabled, skipping index")
        return {"status": "skipped", "reason": "opensearch_disabled"}

    if not is_opensearch_available():
        logger.warning("OpenSearch not available, will retry")
        raise self.retry(countdown=30)

    client = get_opensearch_client()
    if not client:
        raise self.retry(countdown=30)

    try:
        # Transform payload to OpenSearch document
        transformer = EntityDocumentTransformer()
        doc = transformer.transform(payload)

        # Index the document
        response = client.index(
            index="madrona-entities-write",
            id=entity_key,
            body=doc,
            routing=organization_id,
            refresh=False,
        )

        logger.info(
            "Indexed entity %s (result=%s)",
            entity_key,
            response.get("result", "unknown"),
        )

        return {
            "status": "indexed",
            "entity_key": entity_key,
            "result": response.get("result"),
        }

    except Exception as e:
        logger.error("Failed to index entity %s: %s", entity_key, str(e))
        raise


@celery_app.task(
    base=OrgTask,
    bind=True,
    name='app.tasks.search.delete_entity',
    max_retries=5,
    default_retry_delay=10,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=300,
    soft_time_limit=30,
    time_limit=60,
)
def delete_entity_task(
    self: Task,
    entity_key: str,
    organization_id: str,
) -> dict[str, Any]:
    """
    Delete an entity from OpenSearch.

    Args:
        entity_key: Unique entity identifier
        organization_id: Organization UUID

    Returns:
        Result dict with status
    """
    settings = get_settings()
    if not settings.opensearch_enabled:
        logger.debug("OpenSearch disabled, skipping delete")
        return {"status": "skipped", "reason": "opensearch_disabled"}

    if not is_opensearch_available():
        logger.warning("OpenSearch not available, will retry")
        raise self.retry(countdown=30)

    client = get_opensearch_client()
    if not client:
        raise self.retry(countdown=30)

    try:
        response = client.delete(
            index="madrona-entities-write",
            id=entity_key,
            routing=organization_id,
            refresh=False,
            ignore=[404],  # Don't fail if already deleted
        )

        result = response.get("result", "unknown")
        if result == "not_found":
            logger.debug("Entity %s already deleted from index", entity_key)
        else:
            logger.info("Deleted entity %s from index", entity_key)

        return {
            "status": "deleted",
            "entity_key": entity_key,
            "result": result,
        }

    except Exception as e:
        logger.error("Failed to delete entity %s: %s", entity_key, str(e))
        raise


@celery_app.task(
    base=OrgTask,
    name='app.tasks.search.bulk_index_entities',
    soft_time_limit=300,
    time_limit=600,
)
def bulk_index_entities_task(
    entities: list[dict[str, Any]],
    organization_id: str,
) -> dict[str, Any]:
    """
    Bulk index multiple entities to OpenSearch.

    Args:
        entities: List of entity dicts with entity_key and payload
        organization_id: Organization UUID

    Returns:
        Result dict with success/failure counts
    """
    settings = get_settings()
    if not settings.opensearch_enabled:
        return {"status": "skipped", "reason": "opensearch_disabled"}

    if not is_opensearch_available():
        return {"status": "failed", "reason": "opensearch_unavailable"}

    client = get_opensearch_client()
    if not client:
        return {"status": "failed", "reason": "no_client"}

    transformer = EntityDocumentTransformer()
    bulk_body = []

    for entity in entities:
        entity_key = entity.get("entity_key")
        payload = entity.get("payload", {})
        operation = entity.get("operation", "index")

        if operation == "index":
            try:
                doc = transformer.transform(payload)
                bulk_body.append({
                    "index": {
                        "_index": "madrona-entities-write",
                        "_id": entity_key,
                        "routing": organization_id,
                    }
                })
                bulk_body.append(doc)
            except Exception as e:
                logger.error("Failed to transform entity %s: %s", entity_key, str(e))
        elif operation == "delete":
            bulk_body.append({
                "delete": {
                    "_index": "madrona-entities-write",
                    "_id": entity_key,
                    "routing": organization_id,
                }
            })

    if not bulk_body:
        return {"status": "empty", "count": 0}

    try:
        response = client.bulk(body=bulk_body, refresh=False)

        success = 0
        failed = 0
        for item in response.get("items", []):
            action = list(item.keys())[0]
            if item[action].get("status") in (200, 201):
                success += 1
            else:
                failed += 1
                logger.warning(
                    "Bulk operation failed for %s: %s",
                    item[action].get("_id"),
                    item[action].get("error"),
                )

        logger.info("Bulk indexed %d entities (%d failed)", success, failed)

        return {
            "status": "completed",
            "success": success,
            "failed": failed,
            "errors": response.get("errors", False),
        }

    except Exception as e:
        logger.error("Bulk index failed: %s", str(e))
        return {"status": "failed", "error": str(e)}
