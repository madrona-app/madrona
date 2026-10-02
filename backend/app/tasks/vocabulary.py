"""
Background tasks for vocabulary hierarchy synchronization.

Handles async fetching and updating of Getty vocabulary term hierarchies:
- sync_term_hierarchy_task: Fetch hierarchy for a single term
- refresh_stale_terms_task: Periodic refresh of outdated terms

These tasks run asynchronously so that term selection remains fast
while hierarchy data is fetched in the background.
"""

import logging
from typing import Any
from uuid import UUID

from celery import Task

from app.celery_app import celery_app
from app.database import current_session
from app.tasks.base import SystemTask

logger = logging.getLogger(__name__)


@celery_app.task(
    base=SystemTask,
    bind=True,
    name='app.tasks.vocabulary.sync_term_hierarchy',
    max_retries=3,
    default_retry_delay=30,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=300,
    soft_time_limit=60,
    time_limit=120,
    queue='default',
)
def sync_term_hierarchy_task(
    self: Task,
    external_id: str,
    vocabulary: str,
) -> dict[str, Any]:
    """
    Fetch and store the full hierarchy for a Getty vocabulary term.

    Called when a user selects a term from autocomplete, to background-load
    the term's broader/narrower/related terms.

    Args:
        external_id: Getty ID (e.g., "300015050" for oil paint)
        vocabulary: Vocabulary type (aat, ulan, tgn)

    Returns:
        Result dict with status and term info
    """
    logger.info(f"Syncing hierarchy for {vocabulary}/{external_id}")

    if vocabulary not in ("aat", "ulan", "tgn"):
        return {
            "status": "skipped",
            "reason": f"Invalid vocabulary: {vocabulary}",
        }

    try:
        from app.services.vocabulary_hierarchy_service import VocabularyHierarchyService

        service = VocabularyHierarchyService(current_session())
        term = service.fetch_term_with_hierarchy(external_id, vocabulary)

        if term:
            return {
                "status": "synced",
                "term_id": str(term.term_id),
                "vocabulary": vocabulary,
                "external_id": external_id,
                "preferred_term": term.preferred_term,
                "facet": term.facet,
                "hierarchy_fetched_at": term.hierarchy_fetched_at.isoformat() if term.hierarchy_fetched_at else None,
            }
        else:
            return {
                "status": "not_found",
                "vocabulary": vocabulary,
                "external_id": external_id,
            }

    except Exception as e:
        logger.error(f"Failed to sync hierarchy for {vocabulary}/{external_id}: {e}")
        raise


@celery_app.task(
    base=SystemTask,
    bind=True,
    name='app.tasks.vocabulary.sync_term_hierarchy_by_id',
    max_retries=3,
    default_retry_delay=30,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=300,
    soft_time_limit=60,
    time_limit=120,
    queue='default',
)
def sync_term_hierarchy_by_id_task(
    self: Task,
    term_id: str,
) -> dict[str, Any]:
    """
    Fetch and store the full hierarchy for a vocabulary term by term_id.

    Args:
        term_id: UUID of the vocabulary term

    Returns:
        Result dict with status and term info
    """
    logger.info(f"Syncing hierarchy for term {term_id}")

    try:
        from app.services.vocabulary_hierarchy_service import VocabularyHierarchyService
        from app.models import VocabularyTerm

        term = current_session().query(VocabularyTerm).get(UUID(term_id))

        if not term:
            return {
                "status": "not_found",
                "term_id": term_id,
            }

        if not term.external_id:
            return {
                "status": "skipped",
                "reason": "Term has no external_id (local term)",
                "term_id": term_id,
            }

        service = VocabularyHierarchyService(current_session())
        updated_term = service.fetch_term_with_hierarchy(
            term.external_id,
            term.vocabulary,
        )

        if updated_term:
            return {
                "status": "synced",
                "term_id": str(updated_term.term_id),
                "vocabulary": updated_term.vocabulary,
                "external_id": updated_term.external_id,
                "preferred_term": updated_term.preferred_term,
            }
        else:
            return {
                "status": "failed",
                "term_id": term_id,
            }

    except Exception as e:
        logger.error(f"Failed to sync hierarchy for term {term_id}: {e}")
        raise


@celery_app.task(
    base=SystemTask,
    name='app.tasks.vocabulary.refresh_stale_terms',
    soft_time_limit=600,
    time_limit=900,
    queue='default',
)
def refresh_stale_terms_task(
    limit: int = 50,
) -> dict[str, Any]:
    """
    Refresh hierarchy data for terms with stale or missing hierarchy.

    This is a periodic task that runs to keep frequently-used terms up to date.
    It prioritizes terms by usage_count so heavily-used terms are refreshed first.

    Args:
        limit: Maximum number of terms to refresh per run

    Returns:
        Result dict with counts
    """
    logger.info(f"Refreshing stale vocabulary terms (limit={limit})")

    try:
        from app.services.vocabulary_hierarchy_service import VocabularyHierarchyService

        service = VocabularyHierarchyService(current_session())
        stale_terms = service.get_stale_terms(limit=limit)

        if not stale_terms:
            logger.info("No stale terms to refresh")
            return {
                "status": "completed",
                "refreshed": 0,
                "failed": 0,
            }

        refreshed = 0
        failed = 0

        for term in stale_terms:
            try:
                result = service.fetch_term_with_hierarchy(
                    term.external_id,
                    term.vocabulary,
                )
                if result:
                    refreshed += 1
                else:
                    failed += 1
            except Exception as e:
                logger.warning(f"Failed to refresh term {term.external_id}: {e}")
                failed += 1

        logger.info(f"Refreshed {refreshed} terms, {failed} failed")

        return {
            "status": "completed",
            "refreshed": refreshed,
            "failed": failed,
        }

    except Exception as e:
        logger.error(f"Failed to refresh stale terms: {e}")
        return {
            "status": "failed",
            "error": str(e),
        }


@celery_app.task(
    base=SystemTask,
    bind=True,
    name='app.tasks.vocabulary.expand_term_for_search',
    max_retries=2,
    default_retry_delay=10,
    soft_time_limit=30,
    time_limit=60,
    queue='default',
)
def expand_term_for_search_task(
    self: Task,
    term_ids: list[str],
    include_narrower: bool = True,
    max_depth: int = 2,
) -> dict[str, Any]:
    """
    Expand a list of term IDs to include narrower terms for search.

    This task is used to pre-compute search expansion for complex queries.

    Args:
        term_ids: List of term UUID strings to expand
        include_narrower: Whether to include narrower terms
        max_depth: Maximum depth for narrower term traversal

    Returns:
        Dict with expanded term IDs
    """
    logger.info(f"Expanding {len(term_ids)} terms for search (depth={max_depth})")

    try:
        from app.services.vocabulary_hierarchy_service import VocabularyHierarchyService

        service = VocabularyHierarchyService(current_session())

        uuids = [UUID(tid) for tid in term_ids]
        expanded = service.expand_search_terms(
            uuids,
            include_narrower=include_narrower,
            max_depth=max_depth,
        )

        return {
            "status": "completed",
            "original_count": len(term_ids),
            "expanded_count": len(expanded),
            "term_ids": [str(tid) for tid in expanded],
        }

    except Exception as e:
        logger.error(f"Failed to expand terms: {e}")
        raise


@celery_app.task(
    base=SystemTask,
    bind=True,
    name='app.tasks.vocabulary.import_getty_term',
    max_retries=3,
    default_retry_delay=30,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=300,
    soft_time_limit=60,
    time_limit=120,
    queue='default',
)
def import_getty_term_task(
    self: Task,
    external_id: str,
    vocabulary: str,
    preferred_term: str,
    facet: str | None = None,
    scope_note: str | None = None,
    broader_term: str | None = None,
    external_uri: str | None = None,
) -> dict[str, Any]:
    """
    Import a Getty term from the Vocabulary Explorer as a global cached term.

    Creates a VocabularyTerm record if it doesn't exist, then triggers
    hierarchy sync in the background. Used when user clicks "Import" in
    the Vocabulary Explorer.

    Args:
        external_id: Getty ID (e.g., "300015050")
        vocabulary: Vocabulary type (aat, ulan, tgn)
        preferred_term: The term label
        facet: AAT facet category (materials, techniques, styles_periods, object_types)
        scope_note: Definition/scope note from Getty
        broader_term: Parent term label
        external_uri: Full Getty URI

    Returns:
        Result dict with imported term info
    """
    logger.info(f"Importing Getty term {vocabulary}/{external_id}: {preferred_term}")

    if vocabulary not in ("aat", "ulan", "tgn"):
        return {
            "status": "error",
            "reason": f"Invalid vocabulary: {vocabulary}",
        }

    try:
        from app.models import VocabularyTerm
        from app.services.vocabulary_hierarchy_service import VocabularyHierarchyService

        # Check if term already exists
        existing = current_session().query(VocabularyTerm).filter(
            VocabularyTerm.vocabulary == vocabulary,
            VocabularyTerm.external_id == external_id,
        ).first()

        if existing:
            logger.info(f"Term {vocabulary}/{external_id} already exists")
            return {
                "status": "already_exists",
                "term_id": str(existing.term_id),
                "vocabulary": vocabulary,
                "external_id": external_id,
                "preferred_term": existing.preferred_term,
            }

        # Create the term as a global term (no organization)
        term = VocabularyTerm(
            vocabulary=vocabulary,
            external_id=external_id,
            external_uri=external_uri or f"http://vocab.getty.edu/{vocabulary}/{external_id}",
            preferred_term=preferred_term,
            scope_note=scope_note,
            broader_term=broader_term,
            facet=facet,
            organization_id=None,  # Global term
            is_custom=False,
            status="active",
        )
        current_session().add(term)
        current_session().commit()

        logger.info(f"Created term {vocabulary}/{external_id}")

        # Trigger hierarchy sync in background
        sync_term_hierarchy_task.delay(external_id, vocabulary)

        return {
            "status": "imported",
            "term_id": str(term.term_id),
            "vocabulary": vocabulary,
            "external_id": external_id,
            "preferred_term": term.preferred_term,
            "facet": term.facet,
        }

    except Exception as e:
        logger.error(f"Failed to import Getty term {vocabulary}/{external_id}: {e}")
        raise


# Note: Periodic task registration is in celery_app.py beat_schedule
