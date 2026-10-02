"""
Dynamic Workspace Service.

Executes a workspace's saved search query and merges results with pinned
(manually added) WorkspaceItem rows. Pinned items appear first, followed
by deduplicated dynamic search results.
"""

import logging
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import joinedload

from app.models import WorkspaceItem, CollectionObject, MediaDerivative, CollectionObjectMedia

logger = logging.getLogger(__name__)

# Fields stripped from dynamic_query before storing — they are overridden at query time
STRIPPED_QUERY_FIELDS = {"limit", "offset", "include_facets", "highlight"}


def sanitize_dynamic_query(raw_query: dict) -> dict:
    """Strip pagination/display fields before persisting."""
    return {k: v for k, v in raw_query.items() if k not in STRIPPED_QUERY_FIELDS}


def resolve_dynamic_items(
    workspace,
    org_id: UUID,
    db_session,
    limit: int = 50,
    offset: int = 0,
):
    """
    Resolve a dynamic workspace's items: pinned first, then search results.

    Returns a dict with:
        items       – list of item dicts (each has `source: "pinned"|"dynamic"`)
        pinned_count – number of pinned items total
        dynamic_count – total dynamic results (excluding pinned duplicates)
        total       – pinned_count + dynamic_count
        search_unavailable – True when OpenSearch is down
    """
    from app.search.collections.service import (
        CollectionsSearchService,
        get_collections_search_service,
    )
    from app.search.collections.schemas import CollectionsSearchRequest

    # 1. Fetch all pinned items ordered by sort_order
    pinned_query = (
        db_session.query(WorkspaceItem)
        .filter(WorkspaceItem.workspace_id == workspace.workspace_id)
        .options(joinedload(WorkspaceItem.object))
        .order_by(WorkspaceItem.sort_order)
    )
    pinned_rows = pinned_query.all()
    pinned_ids = {str(row.object_id) for row in pinned_rows}
    pinned_count = len(pinned_rows)

    # Build pinned item dicts
    from app.models import CollectionObjectMedia
    pinned_items = []
    for row in pinned_rows:
        obj = row.object
        # Look up the primary image media_id so the frontend can expose a
        # "set as cover" action on each pinned item (matches the media
        # workset flow — see WorkspaceDetailPage.ObjectGridItem).
        primary_media_id = None
        if obj:
            primary = db_session.query(CollectionObjectMedia).filter(
                CollectionObjectMedia.object_id == obj.object_id,
                CollectionObjectMedia.is_primary == True,  # noqa: E712
            ).first()
            if primary:
                primary_media_id = str(primary.media_id)
        pinned_items.append({
            "workspace_item_id": str(row.workspace_item_id),
            "object_id": str(row.object_id),
            "accession_number": obj.object_number if obj else None,
            "title": (obj.title_links[0].title if obj.title_links else None) if obj else None,
            "thumbnail_url": _get_object_thumbnail(obj, db_session) if obj else None,
            "primary_media_id": primary_media_id,
            "note": row.note,
            "sort_order": row.sort_order,
            "added_at": row.added_at.isoformat(),
            "source": "pinned",
        })

    # 2. Check if search is available
    search_unavailable = False
    dynamic_items = []
    dynamic_total = 0

    if not CollectionsSearchService.is_available():
        search_unavailable = True
    elif workspace.dynamic_query:
        # 3. Build a search request from saved query
        query_data = dict(workspace.dynamic_query)
        # Override pagination/display
        query_data["include_facets"] = False
        query_data["highlight"] = False

        # Calculate how many dynamic items we need for this page
        # Positions 0..pinned_count-1 are pinned; the rest are dynamic
        if offset < pinned_count:
            # This page includes some pinned items
            dynamic_needed = limit - (pinned_count - offset)
            dynamic_offset = 0
        else:
            dynamic_needed = limit
            dynamic_offset = offset - pinned_count

        if dynamic_needed > 0:
            query_data["limit"] = min(dynamic_needed, 100)
            query_data["offset"] = max(dynamic_offset, 0)

            try:
                search_request = CollectionsSearchRequest(**query_data)
                service = get_collections_search_service()
                response = service.search(search_request, org_id, db_session)

                dynamic_total = response.total

                # Deduplicate: exclude hits that are already pinned
                dynamic_object_ids = [
                    hit.object_id for hit in response.hits
                    if hit.object_id not in pinned_ids
                ]

                # Batch-fetch thumbnails for dynamic items
                thumbnails = _get_object_thumbnails_batch(
                    dynamic_object_ids, org_id, db_session
                )

                for hit in response.hits:
                    if hit.object_id not in pinned_ids:
                        dynamic_items.append({
                            "workspace_item_id": None,
                            "object_id": hit.object_id,
                            "accession_number": hit.object_number,
                            "title": hit.title,
                            "thumbnail_url": thumbnails.get(hit.object_id),
                            "note": None,
                            "sort_order": None,
                            "added_at": None,
                            "source": "dynamic",
                        })

                # Adjust dynamic_total to exclude pinned items that appear in search
                # (approximate — the exact count would require scanning all results)
                dynamic_total = max(0, dynamic_total - len(pinned_ids))

            except Exception:
                logger.exception("Dynamic workspace search failed")
                search_unavailable = True

    # 4. Slice for the requested page
    # Combine: pinned first, then dynamic
    all_items = pinned_items + dynamic_items

    # For the detail endpoint (offset=0), return pinned + first page of dynamic
    if offset == 0:
        page_items = all_items[:limit]
    elif offset < pinned_count:
        page_items = all_items[offset : offset + limit]
    else:
        # Past all pinned items — return only dynamic
        page_items = dynamic_items[:limit]

    total = pinned_count + dynamic_total

    return {
        "items": page_items,
        "pinned_count": pinned_count,
        "dynamic_count": dynamic_total,
        "total": total,
        "search_unavailable": search_unavailable,
    }


def _get_object_thumbnail(obj, db_session) -> str | None:
    """Get thumbnail URL for an object (lightweight version)."""
    if not obj:
        return None

    primary = db_session.query(CollectionObjectMedia).filter(
        CollectionObjectMedia.object_id == obj.object_id,
        CollectionObjectMedia.is_primary == True,
    ).first()

    if primary:
        thumb = db_session.query(MediaDerivative).filter(
            MediaDerivative.media_id == primary.media_id,
            MediaDerivative.derivative_type == "thumbnail",
        ).first()
        if thumb:
            from app.services.uploads import get_org_media_url
            return get_org_media_url(thumb.s3_key, organization_id=str(obj.organization_id))

    return None


def _get_object_thumbnails_batch(
    object_ids: list[str], org_id: UUID, db_session
) -> dict[str, str]:
    """Batch-fetch thumbnail URLs for a list of object IDs.

    Returns a dict mapping object_id -> thumbnail_url.
    """
    if not object_ids:
        return {}

    from app.services.uploads import get_org_media_url

    # Find primary media for all objects in one query
    primaries = (
        db_session.query(
            CollectionObjectMedia.object_id,
            CollectionObjectMedia.media_id,
        )
        .filter(
            CollectionObjectMedia.object_id.in_(object_ids),
            CollectionObjectMedia.is_primary == True,
        )
        .all()
    )

    if not primaries:
        return {}

    media_ids = [p.media_id for p in primaries]
    object_by_media = {p.media_id: str(p.object_id) for p in primaries}

    # Find thumbnail derivatives for all primary media in one query
    thumbs = (
        db_session.query(MediaDerivative)
        .filter(
            MediaDerivative.media_id.in_(media_ids),
            MediaDerivative.derivative_type == "thumbnail",
        )
        .all()
    )

    result = {}
    for thumb in thumbs:
        obj_id = object_by_media.get(thumb.media_id)
        if obj_id and thumb.s3_key:
            result[obj_id] = get_org_media_url(thumb.s3_key, organization_id=str(org_id))

    return result
