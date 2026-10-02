"""
Dynamic Media Workspace Service.

Parallel to dynamic_workspace.py but for media worksets. Runs a saved
MediaSearchRequest-shaped query against MediaSearchService, merges results
with pinned MediaWorkspaceItem rows, and returns a unified list where each
item is tagged ``source: "pinned"`` or ``source: "dynamic"``.

Pinned items always appear first (ordered by sort_order). Dynamic items
are deduplicated against the pinned set — media IDs that are both pinned
and matched by the search appear only once as pinned, never twice.
"""
from __future__ import annotations

import logging
from uuid import UUID

from sqlalchemy.orm import joinedload, Session

from app.models import MediaWorkspaceItem, MediaDerivative

logger = logging.getLogger(__name__)


# Fields stripped from dynamic_query before storing — they are overridden at
# query time (pagination and display options).
STRIPPED_MEDIA_QUERY_FIELDS = {"limit", "offset", "include_facets", "highlight"}


def sanitize_media_dynamic_query(raw_query: dict) -> dict:
    """Strip pagination/display fields before persisting the saved query."""
    return {
        k: v
        for k, v in raw_query.items()
        if k not in STRIPPED_MEDIA_QUERY_FIELDS
    }


def _get_media_thumbnail_lite(media, db_session: Session) -> str | None:
    """
    Small thumbnail URL for a Media row. Matches _get_media_thumbnail in the
    workspaces router but kept local so this service doesn't import from
    the router package.
    """
    if not media:
        return None
    from app.services.uploads import get_org_media_url

    thumbnail = db_session.query(MediaDerivative).filter(
        MediaDerivative.media_id == media.media_id,
        MediaDerivative.derivative_type == "thumbnail",
    ).first()
    if thumbnail and thumbnail.s3_key:
        return get_org_media_url(thumbnail.s3_key, organization_id=str(media.organization_id))
    if media.media_type == "image" and media.s3_key:
        return get_org_media_url(media.s3_key, organization_id=str(media.organization_id))
    return None


def count_dynamic_media_workspace_total(
    workspace,
    org_id: UUID,
    db_session: Session,
) -> int:
    """
    Cheap total-count for a media workspace, accounting for dynamic results.

    Returns ``pinned_count + dynamic_count`` for dynamic workspaces, or just
    ``pinned_count`` for static ones. Avoids materializing items or fetching
    thumbnails — used by serializers and the active-context endpoints where
    we only need the number, not the rows.

    If the search service is unavailable, falls back to pinned-only count.
    """
    pinned_count = (
        db_session.query(MediaWorkspaceItem)
        .filter(MediaWorkspaceItem.workspace_id == workspace.workspace_id)
        .count()
    )

    if not getattr(workspace, "is_dynamic", False) or not workspace.dynamic_query:
        return pinned_count

    from app.search.media.service import (
        MediaSearchService,
        get_media_search_service,
    )
    from app.search.media.schemas import MediaSearchRequest

    if not MediaSearchService.is_available():
        return pinned_count

    try:
        query_data = dict(workspace.dynamic_query)
        # Smallest possible page — we only need response.total
        query_data["limit"] = 1
        query_data["offset"] = 0
        query_data["include_facets"] = False
        query_data["highlight"] = False

        allowed_fields = set(MediaSearchRequest.__dataclass_fields__.keys())
        cleaned = {k: v for k, v in query_data.items() if k in allowed_fields}

        if "tag_filters" in cleaned and isinstance(cleaned["tag_filters"], list):
            from app.search.media.schemas import TagFilter
            cleaned["tag_filters"] = [
                TagFilter(**tf) if isinstance(tf, dict) else tf
                for tf in cleaned["tag_filters"]
            ]

        search_request = MediaSearchRequest(**cleaned)
        service = get_media_search_service()
        response = service.search(search_request, org_id)

        # Dedupe: subtract pinned media ids that the search would also return
        # (same approximation resolve_dynamic_media_items uses).
        pinned_ids: set[str] = {
            str(row.media_id)
            for row in db_session.query(MediaWorkspaceItem.media_id)
            .filter(MediaWorkspaceItem.workspace_id == workspace.workspace_id)
            .all()
        }
        dynamic_total = max(0, response.total - len(pinned_ids))
        return pinned_count + dynamic_total
    except Exception:
        logger.exception("count_dynamic_media_workspace_total: search failed")
        return pinned_count


def resolve_dynamic_media_workspace_media_ids(
    workspace,
    org_id: UUID,
    db_session: Session,
    *,
    search_page_size: int = 200,
) -> list[UUID]:
    """
    Return all media_ids that belong to a workspace (pinned + dynamic).

    Used by bulk-action endpoints that need to operate on the full effective
    workspace contents, not just the explicitly pinned rows. For static
    workspaces, this is equivalent to selecting media_id from
    MediaWorkspaceItem.

    Pages through the saved search to gather every dynamic hit, deduped
    against the pinned set. Heavy for very large dynamic workspaces but
    correct; callers that only need a count should use
    ``count_dynamic_media_workspace_total`` instead.

    If the search service is unavailable, returns pinned-only IDs (with a
    log warning) — same fallback behavior as resolve_dynamic_media_items.
    """
    pinned_rows = (
        db_session.query(MediaWorkspaceItem.media_id)
        .filter(MediaWorkspaceItem.workspace_id == workspace.workspace_id)
        .all()
    )
    pinned_ids: list[UUID] = [row.media_id for row in pinned_rows]
    pinned_set: set[UUID] = set(pinned_ids)

    if not getattr(workspace, "is_dynamic", False) or not workspace.dynamic_query:
        return pinned_ids

    from app.search.media.service import (
        MediaSearchService,
        get_media_search_service,
    )
    from app.search.media.schemas import MediaSearchRequest

    if not MediaSearchService.is_available():
        logger.warning(
            "resolve_dynamic_media_workspace_media_ids: search unavailable, "
            "returning pinned-only ids for workspace %s",
            workspace.workspace_id,
        )
        return pinned_ids

    dynamic_ids: list[UUID] = []
    offset = 0
    try:
        allowed_fields = set(MediaSearchRequest.__dataclass_fields__.keys())
        base_query = dict(workspace.dynamic_query)
        base_query["include_facets"] = False
        base_query["highlight"] = False

        while True:
            page_query = dict(base_query)
            page_query["limit"] = search_page_size
            page_query["offset"] = offset
            cleaned = {k: v for k, v in page_query.items() if k in allowed_fields}

            if "tag_filters" in cleaned and isinstance(cleaned["tag_filters"], list):
                from app.search.media.schemas import TagFilter
                cleaned["tag_filters"] = [
                    TagFilter(**tf) if isinstance(tf, dict) else tf
                    for tf in cleaned["tag_filters"]
                ]

            search_request = MediaSearchRequest(**cleaned)
            service = get_media_search_service()
            response = service.search(search_request, org_id)

            page_hits = response.hits
            if not page_hits:
                break

            for hit in page_hits:
                hit_uuid = UUID(hit.media_id) if isinstance(hit.media_id, str) else hit.media_id
                if hit_uuid in pinned_set:
                    continue
                dynamic_ids.append(hit_uuid)

            offset += len(page_hits)
            if offset >= response.total or len(page_hits) < search_page_size:
                break
    except Exception:
        logger.exception("resolve_dynamic_media_workspace_media_ids: search failed")
        return pinned_ids

    return pinned_ids + dynamic_ids


def resolve_dynamic_media_items(
    workspace,
    org_id: UUID,
    db_session: Session,
    limit: int = 50,
    offset: int = 0,
):
    """
    Resolve a dynamic media workspace's items.

    Returns a dict with:
        items             – list of item dicts (each has ``source``)
        pinned_count      – number of explicitly pinned media
        dynamic_count     – total dynamic results (excluding pinned duplicates,
                            approximated — see dynamic_workspace.py for the
                            same caveat)
        total             – pinned_count + dynamic_count
        search_unavailable – True when the media search service is down
    """
    from app.search.media.service import (
        MediaSearchService,
        get_media_search_service,
    )
    from app.search.media.schemas import MediaSearchRequest

    # 1. Fetch all pinned items ordered by sort_order
    pinned_query = (
        db_session.query(MediaWorkspaceItem)
        .filter(MediaWorkspaceItem.workspace_id == workspace.workspace_id)
        .options(joinedload(MediaWorkspaceItem.media))
        .order_by(MediaWorkspaceItem.sort_order)
    )
    pinned_rows = pinned_query.all()
    pinned_ids: set[str] = {str(row.media_id) for row in pinned_rows}
    pinned_count = len(pinned_rows)

    pinned_items: list[dict] = []
    for row in pinned_rows:
        media = row.media
        pinned_items.append({
            "workspace_item_id": str(row.workspace_item_id),
            "media_id": str(row.media_id),
            "filename": media.filename if media else None,
            "title": media.title if media else None,
            "mime_type": media.mime_type if media else None,
            "media_type": media.media_type if media else None,
            "thumbnail_url": _get_media_thumbnail_lite(media, db_session) if media else None,
            "note": row.note,
            "sort_order": row.sort_order,
            "added_at": row.added_at.isoformat() if row.added_at else None,
            "source": "pinned",
        })

    # 2. Check if search is available
    search_unavailable = False
    dynamic_items: list[dict] = []
    dynamic_total = 0

    if not MediaSearchService.is_available():
        search_unavailable = True
    elif workspace.dynamic_query:
        # 3. Build a search request from the saved query
        query_data = dict(workspace.dynamic_query)
        # Override pagination/display
        query_data["include_facets"] = False
        query_data["highlight"] = False

        # Calculate how many dynamic items we need for this page.
        # Positions 0..pinned_count-1 are pinned; the rest are dynamic.
        if offset < pinned_count:
            dynamic_needed = limit - (pinned_count - offset)
            dynamic_offset = 0
        else:
            dynamic_needed = limit
            dynamic_offset = offset - pinned_count

        if dynamic_needed > 0:
            query_data["limit"] = min(dynamic_needed, 100)
            query_data["offset"] = max(dynamic_offset, 0)

            try:
                # Drop unknown keys so unexpected persisted fields don't crash
                # the dataclass constructor.
                allowed_fields = set(MediaSearchRequest.__dataclass_fields__.keys())
                cleaned = {k: v for k, v in query_data.items() if k in allowed_fields}

                # Reconstruct tag_filters dataclasses if saved as plain dicts
                if "tag_filters" in cleaned and isinstance(cleaned["tag_filters"], list):
                    from app.search.media.schemas import TagFilter
                    cleaned["tag_filters"] = [
                        TagFilter(**tf) if isinstance(tf, dict) else tf
                        for tf in cleaned["tag_filters"]
                    ]

                search_request = MediaSearchRequest(**cleaned)
                service = get_media_search_service()
                response = service.search(search_request, org_id)

                dynamic_total = response.total

                # Deduplicate: exclude hits that are already pinned
                for hit in response.hits:
                    if hit.media_id in pinned_ids:
                        continue
                    dynamic_items.append({
                        "workspace_item_id": None,
                        "media_id": hit.media_id,
                        "filename": hit.filename,
                        "title": hit.title,
                        "mime_type": hit.mime_type,
                        "media_type": hit.media_type,
                        "thumbnail_url": None,  # filled below via batch lookup
                        "note": None,
                        "sort_order": None,
                        "added_at": None,
                        "source": "dynamic",
                    })

                # Batch-fetch thumbnails for dynamic items (avoids N+1)
                dynamic_media_ids = [
                    UUID(it["media_id"]) for it in dynamic_items
                    if it["media_id"]
                ]
                if dynamic_media_ids:
                    from app.models import Media
                    media_rows = (
                        db_session.query(Media)
                        .filter(Media.media_id.in_(dynamic_media_ids))
                        .all()
                    )
                    thumb_by_id: dict[str, str | None] = {}
                    for media_row in media_rows:
                        thumb_by_id[str(media_row.media_id)] = _get_media_thumbnail_lite(
                            media_row, db_session
                        )
                    for it in dynamic_items:
                        it["thumbnail_url"] = thumb_by_id.get(it["media_id"])

                # Adjust dynamic_total to exclude pinned items that appeared in
                # the search (approximate — same caveat as collections).
                dynamic_total = max(0, dynamic_total - len(pinned_ids))

            except Exception:
                logger.exception("Dynamic media workspace search failed")
                search_unavailable = True

    # 4. Slice for the requested page
    all_items = pinned_items + dynamic_items
    if offset == 0:
        page_items = all_items[:limit]
    elif offset < pinned_count:
        page_items = all_items[offset : offset + limit]
    else:
        page_items = dynamic_items[:limit]

    total = pinned_count + dynamic_total

    return {
        "items": page_items,
        "pinned_count": pinned_count,
        "dynamic_count": dynamic_total,
        "total": total,
        "search_unavailable": search_unavailable,
    }
