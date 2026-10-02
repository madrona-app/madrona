"""
Shared helper functions for the collections API.

Includes OpenSearch indexing and bulk primary image lookup.

Migrated from app.api.collections._helpers — these functions have no
Flask dependency and work with plain SQLAlchemy sessions.
"""
import logging
from uuid import UUID

from app.models import (
    CollectionObjectMedia,
    CollectionObject,
    Media,
)
from app.models.media import MediaDerivative
from app.services.uploads import get_org_media_url

logger = logging.getLogger(__name__)


def _index_collection_object(obj: CollectionObject) -> None:
    """
    Index a collection object in OpenSearch.

    Runs async and doesn't fail the request if OpenSearch is unavailable.
    """
    try:
        from app.search.collections.service import (
            CollectionsSearchService,
            get_collections_search_service,
        )

        if CollectionsSearchService.is_available():
            service = get_collections_search_service()
            service.index_object(obj)
            logger.debug(f"Indexed collection object {obj.object_id}")
    except Exception as e:
        # Log but don't fail the request
        logger.warning(f"Failed to index collection object {obj.object_id}: {e}")


def _reindex_linked_media(obj: CollectionObject) -> None:
    """
    Re-index all media linked to a collection object in the media search index.

    Called after a collection object is updated so that denormalized object
    metadata (title, creator, type, medium, etc.) stays in sync in the
    media search index.
    """
    try:
        from sqlalchemy.orm import object_session
        from app.search.media import MediaSearchService, get_media_search_service

        if not MediaSearchService.is_available():
            return

        session = object_session(obj)
        if session is None:
            return

        links = (
            session.query(CollectionObjectMedia)
            .filter(CollectionObjectMedia.object_id == obj.object_id)
            .all()
        )
        if not links:
            return

        media_ids = [link.media_id for link in links]
        media_items = (
            session.query(Media)
            .filter(Media.media_id.in_(media_ids))
            .all()
        )

        service = get_media_search_service()
        for media in media_items:
            service.index_media(media)

        logger.debug(
            f"Re-indexed {len(media_items)} linked media for object {obj.object_id}"
        )
    except Exception as e:
        logger.warning(
            f"Failed to re-index linked media for object {obj.object_id}: {e}"
        )


def _delete_collection_object_from_index(object_id, organization_id) -> None:
    """
    Delete a collection object from OpenSearch index.

    Runs async and doesn't fail the request if OpenSearch is unavailable.
    """
    try:
        from app.search.collections.service import (
            CollectionsSearchService,
            get_collections_search_service,
        )

        if CollectionsSearchService.is_available():
            service = get_collections_search_service()
            service.delete_object(object_id, organization_id)
            logger.debug(f"Deleted collection object {object_id} from index")
    except Exception as e:
        # Log but don't fail the request
        logger.warning(f"Failed to delete collection object {object_id} from index: {e}")


def _get_primary_images_bulk(object_ids: list[UUID], organization_id: UUID, session=None) -> dict[str, str]:
    """
    Fetch primary image URLs for multiple objects in a single query.

    Prefers the 'small' (600px) derivative for grid/card views, falling back
    to thumbnail_s3_key, then the original s3_key.

    This prevents N+1 queries when listing objects with images.

    Args:
        object_ids: List of object UUIDs to fetch images for
        organization_id: Organization UUID for URL generation
        session: SQLAlchemy session (required)

    Returns:
        Dict mapping object_id (str) -> primary_image_url (str)
    """
    if not object_ids:
        return {}
    if session is None:
        from app.database import current_session
        session = current_session()

    from sqlalchemy import func as sqla_func

    # Step 1: Get primary media_id for each object (or first by sort_order)
    primary_media = (
        session.query(
            CollectionObjectMedia.object_id,
            Media.media_id,
            Media.s3_key,
            Media.thumbnail_s3_key,
        )
        .join(Media, CollectionObjectMedia.media_id == Media.media_id)
        .filter(
            CollectionObjectMedia.object_id.in_(object_ids),
            CollectionObjectMedia.is_primary == True,
        )
        .all()
    )

    # Build set of objects that have a primary image
    objects_with_primary = {str(row.object_id) for row in primary_media}

    # For objects without primary, get first by sort_order
    objects_needing_fallback = [oid for oid in object_ids if str(oid) not in objects_with_primary]
    fallback_media = []
    if objects_needing_fallback:
        subq = (
            session.query(
                CollectionObjectMedia.object_id,
                sqla_func.min(CollectionObjectMedia.sort_order).label("min_sort")
            )
            .filter(CollectionObjectMedia.object_id.in_(objects_needing_fallback))
            .group_by(CollectionObjectMedia.object_id)
            .subquery()
        )

        fallback_media = (
            session.query(
                CollectionObjectMedia.object_id,
                Media.media_id,
                Media.s3_key,
                Media.thumbnail_s3_key,
            )
            .join(Media, CollectionObjectMedia.media_id == Media.media_id)
            .join(
                subq,
                (CollectionObjectMedia.object_id == subq.c.object_id) &
                (CollectionObjectMedia.sort_order == subq.c.min_sort)
            )
            .all()
        )

    all_media = list(primary_media) + list(fallback_media)
    if not all_media:
        return {}

    # Step 2: Look up 'small' derivatives for these media (preferred for grid views)
    media_ids = [row.media_id for row in all_media]
    small_derivatives = (
        session.query(
            MediaDerivative.media_id,
            MediaDerivative.s3_key,
        )
        .filter(
            MediaDerivative.media_id.in_(media_ids),
            MediaDerivative.derivative_type == "small",
            MediaDerivative.format.in_(["webp", "jpeg"]),
        )
        .all()
    )

    # Build lookup: media_id -> derivative s3_key (prefer webp)
    deriv_map: dict[str, str] = {}
    for d in small_derivatives:
        mid = str(d.media_id)
        # Only overwrite if we don't have one yet, or this is webp
        if mid not in deriv_map or d.s3_key.endswith(".webp"):
            deriv_map[mid] = d.s3_key

    # Step 3: Generate signed URLs, preferring small derivative > thumbnail > original
    result = {}
    for row in all_media:
        mid = str(row.media_id)
        s3_key = deriv_map.get(mid) or row.thumbnail_s3_key or row.s3_key
        if s3_key:
            try:
                url = get_org_media_url(
                    s3_key,
                    organization_id=str(organization_id),
                    db_session=session,
                    expiry_seconds=3600
                )
                result[str(row.object_id)] = url
            except Exception:
                pass

    return result
