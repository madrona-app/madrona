"""
Public Collection Discovery API endpoints (FastAPI).

12 routes — public (unauthenticated) access to discoverable collection objects,
events, exhibitions, venues, and staff for embedding in museum websites.

Access control note
-------------------
Every endpoint here uses ``get_admin_db`` (BYPASSRLS) by design. The
RLS policy on ``organizations`` and downstream collection tables is
``organization_id = current_org_id()`` — meant for authenticated org
users. Public callers have no session and no ``current_org_id`` to
set, so under the standard ``get_db`` (NOBYPASSRLS) session every
lookup returns zero rows and the endpoint 404s.

The real access control for this surface is two app-layer gates:

  1. The URL must carry a valid ``org_slug`` for an org with
     ``status='active'``.
  2. Every downstream filter restricts to published / discoverable
     content (``is_published=True`` / ``is_discoverable=True`` /
     ``status='published'``).

Both gates run in SQL ``WHERE`` clauses, not RLS — the BYPASSRLS
session is intentional and bounded to data the org has explicitly
marked as public.
"""

import logging
from datetime import date, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_admin_db
from app.models import (
    CollectionObject,
    CollectionObjectMedia,
    Constituent,
    DiscoverConfig,
    Event,
    Exhibition,
    ExhibitionFloorPlan,
    ExhibitionObject,
    Location,
    Media,
    MediaDerivative,
    Organization,
    Venue,
)
from app.services.uploads import get_org_media_url
from app.services.public_cache import pub_cache_get, pub_cache_set, pub_cache_key_with_params
from app.fastapi_app.schemas.discover_public import (
    DiscoverEventDetailOut,
    DiscoverEventListResponse,
    DiscoverExhibitionDetailOut,
    DiscoverExhibitionListResponse,
    DiscoverInfoOut,
    DiscoverObjectDetailOut,
    DiscoverSearchResponse,
    DiscoverStaffListResponse,
    DiscoverVenueDetailOut,
    DiscoverVenueListResponse,
    FeaturedObjectsResponse,
    RelatedObjectsResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["discover-public"])


# =============================================================================
# Helpers
# =============================================================================


def _is_guide_enabled(organization_id: UUID, db: Session) -> bool:
    """Check if the organization has the Guide application enabled."""
    from app.models.core import Application, OrganizationApplication
    row = db.query(OrganizationApplication.enabled).join(
        Application, OrganizationApplication.application_id == Application.application_id,
    ).filter(
        Application.key == "guide",
        OrganizationApplication.organization_id == organization_id,
    ).first()
    return bool(row and row.enabled)


def _widget_info(organization_id: UUID, db: Session) -> dict:
    """Visitor-widget fields for the public info payload."""
    from app.services.guide_usage import get_widget_access
    access = get_widget_access(organization_id, db)
    return {
        "widget_enabled": access.enabled,
        "widget_welcome_message": access.welcome_message,
    }


def _get_org_by_slug(db: Session, slug: str) -> Organization | None:
    return db.query(Organization).filter(
        Organization.slug == slug,
        Organization.status == "active",
    ).first()


def _get_media_url(media_id, organization_id: UUID, db: Session) -> str | None:
    from app.services.discovery_service import get_media_url
    return get_media_url(media_id, organization_id, db)


def _get_thumbnail_urls_bulk_with_srcset(
    object_ids: list[UUID], organization_id: UUID, db: Session,
) -> dict[str, dict]:
    if not object_ids:
        return {}

    rows = (
        db.query(
            CollectionObjectMedia.object_id,
            Media.media_id,
            Media.s3_key,
        )
        .join(Media, CollectionObjectMedia.media_id == Media.media_id)
        .filter(
            CollectionObjectMedia.object_id.in_(object_ids),
            Media.is_published == True,  # noqa: E712
        )
        .order_by(
            CollectionObjectMedia.is_primary.desc(),
            CollectionObjectMedia.sort_order,
        )
        .all()
    )

    seen = set()
    primary_media: dict[str, tuple] = {}
    for row in rows:
        oid = str(row.object_id)
        if oid in seen:
            continue
        seen.add(oid)
        if row.s3_key:
            primary_media[oid] = (row.media_id, row.s3_key)

    if not primary_media:
        return {}

    media_ids = [mid for mid, _ in primary_media.values()]
    derivatives = (
        db.query(MediaDerivative)
        .filter(
            MediaDerivative.media_id.in_(media_ids),
            MediaDerivative.derivative_type.in_(["thumbnail", "small", "medium", "large"]),
            MediaDerivative.format.in_(["webp", "jpeg"]),
        )
        .order_by(MediaDerivative.width.asc())
        .all()
    )

    derivs_by_media: dict[UUID, list[MediaDerivative]] = {}
    for d in derivatives:
        derivs_by_media.setdefault(d.media_id, []).append(d)

    org_id_str = str(organization_id)
    result = {}
    for oid, (media_id, s3_key) in primary_media.items():
        # The <img src> fallback must be a rendition too. srcset covers modern
        # browsers, but src is what everything else fetches — and s3_key is the
        # uploaded master, so this handed anonymous visitors a full-resolution
        # original of every published object.
        derivs = derivs_by_media.get(media_id, [])
        fallback = next(
            (
                d
                for kind in ("small", "medium", "large", "thumbnail")
                for d in derivs
                if d.derivative_type == kind and d.format == "jpeg" and d.s3_key
            ),
            None,
        )
        if not fallback:
            continue
        try:
            url = get_org_media_url(fallback.s3_key, organization_id=org_id_str, db_session=db, expiry_seconds=3600)
        except Exception:
            continue

        srcset = None
        media_derivs = derivs_by_media.get(media_id, [])
        if media_derivs:
            srcset_data: dict[str, list[dict]] = {}
            for d in media_derivs:
                try:
                    d_url = get_org_media_url(d.s3_key, organization_id=org_id_str, db_session=db, expiry_seconds=3600)
                    srcset_data.setdefault(d.format, []).append({"url": d_url, "width": d.width, "height": d.height})
                except Exception:
                    pass
            if srcset_data:
                srcset = srcset_data

        result[oid] = {"url": url, "srcset": srcset}

    return result


def _build_srcset_for_media(media_id: UUID, organization_id: UUID, db: Session) -> dict | None:
    from app.services.discovery_service import build_srcset_for_media
    return build_srcset_for_media(media_id, organization_id, db)


def _get_display_title(title_links):
    from app.services.discovery_service import get_display_title
    return get_display_title(title_links)


def _extract_creators_list(creators):
    from app.services.discovery_service import extract_creators_list
    return extract_creators_list(creators)


def _get_primary_classification(obj):
    from app.services.discovery_service import get_primary_classification
    return get_primary_classification(obj)


def _serialize_classifications(obj):
    from app.services.discovery_service import serialize_classifications
    return serialize_classifications(obj)


def _resolve_discover_object(db: Session, org: Organization, identifier: str) -> CollectionObject | None:
    from app.services.discovery_service import resolve_discover_object
    return resolve_discover_object(db, org, identifier)


def _build_related_should_clauses(obj, relationship_type: str = "all") -> list[dict]:
    from app.services.discovery_service import build_related_should_clauses
    return build_related_should_clauses(obj, relationship_type)


def _get_hero_image_url(config: DiscoverConfig, organization_id: UUID, db: Session) -> str | None:
    if not config or not config.hero_media_id:
        return None
    return _get_media_url(config.hero_media_id, organization_id, db)


# =============================================================================
# Endpoints
# =============================================================================


@router.get("/api/discover/{org_slug}/info", response_model=DiscoverInfoOut, summary="Get discover info")
def get_discover_info(
    org_slug: str,
    db: Session = Depends(get_admin_db),
):
    """Get discover info."""
    cache_key = f"{org_slug}:info"
    cached = pub_cache_get(cache_key)
    if cached is not None:
        return cached

    org = _get_org_by_slug(db, org_slug)
    if not org:
        return JSONResponse(status_code=404, content={"error": {"code": "not_found", "message": "Collection not found"}})

    count = db.query(func.count(CollectionObject.object_id)).filter(
        CollectionObject.organization_id == org.organization_id,
        CollectionObject.is_discoverable == True,  # noqa: E712
    ).scalar()

    config = db.query(DiscoverConfig).filter(
        DiscoverConfig.organization_id == org.organization_id,
    ).first()

    hero_image_url = _get_hero_image_url(config, org.organization_id, db)

    data = {
        "organization_name": org.name,
        "organization_slug": org.slug,
        "total_discoverable": count,
        "hero_image_url": hero_image_url,
        "page_title": config.page_title if config else None,
        "page_subtitle": config.page_subtitle if config else None,
        "show_object_count": config.show_object_count if config else True,
        "default_view_mode": config.default_view_mode if config else "grid",
        "default_sort": config.default_sort if config else "relevance",
        "header_logo_url": _get_media_url(config.header_logo_media_id, org.organization_id, db) if config else None,
        "primary_color": config.primary_color if config else None,
        "accent_color": config.accent_color if config else None,
        "font_family": config.font_family if config else None,
        "nav_items": config.nav_items if config else None,
        "footer_text": config.footer_text if config else None,
        "social_links": config.social_links if config else None,
        "homepage_page_id": str(config.homepage_page_id) if config and config.homepage_page_id else None,
        "custom_404_page_id": str(config.custom_404_page_id) if config and config.custom_404_page_id else None,
        "secondary_color": config.secondary_color if config else None,
        "background_color": config.background_color if config else None,
        "text_color": config.text_color if config else None,
        "heading_font_family": config.heading_font_family if config else None,
        "body_font_family": config.body_font_family if config else None,
        "button_style": config.button_style if config else "rounded",
        "header_style": config.header_style if config else "solid",
        "google_fonts": config.google_fonts if config else None,
        "custom_css": config.custom_css if config else None,
        "footer_columns": config.footer_columns if config else None,
        "land_acknowledgment": config.land_acknowledgment if config else None,
        "footer_logo_url": _get_media_url(config.footer_logo_media_id, org.organization_id, db) if config and config.footer_logo_media_id else None,
        "external_integrations": config.external_integrations if config else None,
        "analytics_config": config.analytics_config if config else None,
        # Guide (AI assistant) — only shown when org has purchased Guide
        "guide_enabled": _is_guide_enabled(org.organization_id, db),
        # Visitor widget — distinct from guide_enabled: requires the explicit
        # per-org widget_enabled config flag (off by default until a deal)
        **_widget_info(org.organization_id, db),
    }

    pub_cache_set(cache_key, data)
    return data


@router.get("/api/discover/{org_slug}/search", response_model=DiscoverSearchResponse, summary="Search discover objects")
def search_discover_objects(
    org_slug: str,
    request: Request,
    q: str = Query(""),
    limit: int = Query(24, ge=1, le=60),
    offset: int = Query(0, ge=0),
    include_facets: str = Query("true"),
    sort: str = Query("relevance"),
    db: Session = Depends(get_admin_db),
):
    """Search discover objects."""
    org = _get_org_by_slug(db, org_slug)
    if not org:
        return JSONResponse(status_code=404, content={"error": {"code": "not_found", "message": "Collection not found"}})

    from opensearchpy.exceptions import NotFoundError
    from app.search.collections.index_manager import CollectionsIndexManager
    from app.search.collections.service import CollectionsSearchService, get_collections_search_service
    from app.search.collections.schemas import (
        CollectionsSearchRequest,
        CollectionsSearchQuery,
        CollectionsSearchFilters,
        SearchSort,
    )

    q_str = q.strip() or None

    filters = CollectionsSearchFilters(
        is_discoverable=True,
        object_type=request.query_params.getlist("object_type") or None,
        classification=request.query_params.getlist("classification") or None,
        creator_name=request.query_params.get("creator") or None,
        material=request.query_params.get("material") or None,
        technique=request.query_params.get("technique") or None,
        subject=request.query_params.get("subject") or None,
        style_period=request.query_params.getlist("style_period") or None,
        creation_place=request.query_params.get("creation_place") or None,
        date_from=request.query_params.get("date_from") or None,
        date_to=request.query_params.get("date_to") or None,
    )

    on_display_param = request.query_params.get("on_display")
    if on_display_param is not None:
        filters.on_display = on_display_param.lower() == "true"

    has_image_param = request.query_params.get("has_image")
    if has_image_param is not None:
        filters.has_image = has_image_param.lower() == "true"

    sort_map = {
        "relevance": SearchSort(field="_score", order="desc"),
        "title_asc": SearchSort(field="title.keyword", order="asc"),
        "title_desc": SearchSort(field="title.keyword", order="desc"),
        "date_asc": SearchSort(field="creation_date", order="asc"),
        "date_desc": SearchSort(field="creation_date", order="desc"),
        "newest": SearchSort(field="created_at", order="desc"),
    }
    sort_obj = sort_map.get(sort, sort_map["relevance"])

    search_request = CollectionsSearchRequest(
        query=CollectionsSearchQuery(q=q_str) if q_str else None,
        filters=filters,
        sort=sort_obj if sort != "relevance" or not q_str else None,
        limit=limit,
        offset=offset,
        include_facets=include_facets.lower() != "false",
        highlight=False,
    )

    if not CollectionsSearchService.is_available():
        return {"hits": [], "total": 0, "facets": [], "next_offset": None}

    service = get_collections_search_service()
    try:
        response = service.search(search_request, org.organization_id, db_session=db)
    except NotFoundError:
        # The read alias does not exist — nothing has been indexed for this
        # deployment yet. This handler already answers with an empty page when
        # search is unavailable (just above), and get_related_objects below
        # does the same on any search failure; an index that was never
        # provisioned is the same situation from a visitor's point of view,
        # and a public gallery page should not answer a browse request with a
        # 500.
        #
        # Deliberately NOT the authenticated collections endpoint's approach,
        # which calls setup_index() on every request: a public,
        # unauthenticated endpoint has no business issuing index DDL.
        #
        # Loud on the way out, because an operator does need to see this: the
        # page is serving nothing until the index is built.
        logger.error(
            "Discover search for org %s hit a missing collections index "
            "(alias %s). The public gallery will show no results until the "
            "collections index is provisioned and reindexed.",
            org_slug,
            CollectionsIndexManager.READ_ALIAS,
        )
        return {"hits": [], "total": 0, "facets": [], "next_offset": None}

    hit_ids = [UUID(h.object_id) for h in response.hits]
    thumbnails = _get_thumbnail_urls_bulk_with_srcset(hit_ids, org.organization_id, db)

    hits = []
    for h in response.hits:
        thumb_data = thumbnails.get(h.object_id, {})
        hits.append({
            "object_id": h.object_id,
            "object_number": h.object_number,
            "title": h.title,
            "brief_description": h.brief_description,
            "creators": [c.get("name") for c in (h.creators or []) if c.get("name")],
            "creation_date_display": h.creation_date.get("display") if h.creation_date else None,
            "classification": h.classification,
            "object_type": h.object_type,
            "thumbnail_url": thumb_data.get("url") if thumb_data else None,
            "thumbnail_srcset": thumb_data.get("srcset") if thumb_data else None,
            "has_image": bool(thumb_data),
        })

    facets = None
    if response.facets:
        facets = [
            {
                "field": f.field,
                "buckets": [{"key": b.key, "count": b.doc_count} for b in f.buckets],
            }
            for f in response.facets
        ]

    return {"hits": hits, "total": response.total, "facets": facets, "next_offset": response.next_offset}


@router.get("/api/discover/{org_slug}/objects/{object_id}", response_model=DiscoverObjectDetailOut, summary="Get discover object")
def get_discover_object(
    org_slug: str,
    object_id: str,
    db: Session = Depends(get_admin_db),
):
    """Get discover object."""
    org = _get_org_by_slug(db, org_slug)
    if not org:
        return JSONResponse(status_code=404, content={"error": {"code": "not_found", "message": "Collection not found"}})

    obj = _resolve_discover_object(db, org, object_id)
    if not obj:
        return JSONResponse(status_code=404, content={"error": {"code": "not_found", "message": "Object not found"}})

    cache_id = obj.object_number or str(obj.object_id)
    cache_key = f"{org_slug}:object:{cache_id}"
    cached = pub_cache_get(cache_key)
    if cached is not None:
        return cached

    media_links = (
        db.query(CollectionObjectMedia)
        .join(Media, CollectionObjectMedia.media_id == Media.media_id)
        .filter(
            CollectionObjectMedia.object_id == obj.object_id,
            Media.is_published == True,  # noqa: E712
        )
        .order_by(
            CollectionObjectMedia.is_primary.desc(),
            CollectionObjectMedia.sort_order,
        )
        .all()
    )

    media_items = []
    for link in media_links:
        media = db.query(Media).filter(
            Media.media_id == link.media_id,
            Media.is_published == True,  # noqa: E712
        ).first()
        if media and media.s3_key:
            try:
                # A rendition, never media.s3_key. This endpoint is anonymous,
                # so minting the master handed every visitor a presigned link
                # to the full-resolution original of every published image.
                from app.services.discovery_service import build_display_key_for_media

                display_key = build_display_key_for_media(media, db)
                if not display_key:
                    continue
                url = get_org_media_url(
                    display_key,
                    organization_id=str(org.organization_id),
                    db_session=db,
                    expiry_seconds=3600,
                )
                srcset = _build_srcset_for_media(media.media_id, org.organization_id, db)
                media_items.append({
                    "media_id": str(media.media_id),
                    "url": url,
                    "srcset": srcset,
                    "media_type": media.media_type,
                    "mime_type": media.mime_type,
                    "width": media.width,
                    "height": media.height,
                    "alt_text": media.alt_text,
                    "credit": media.credit,
                    "is_primary": link.is_primary,
                    "caption": link.caption_override,
                })
            except Exception as e:
                logger.warning("Failed to build media URL for %s: %s", media.media_id, e)

    canonical_url = f"/c/{org_slug}/objects/{obj.object_number}" if obj.object_number else f"/c/{org_slug}/objects/{obj.object_id}"

    result = {
        "object_id": str(obj.object_id),
        "object_number": obj.object_number,
        "canonical_url": canonical_url,
        "title": _get_display_title(obj.title_links),
        "titles": [
            {"title": t.title, "title_type": t.title_type, "language": t.language, "is_preferred": t.is_preferred}
            for t in (obj.title_links or [])
        ],
        "brief_description": obj.brief_description,
        "full_description": obj.full_description,
        "object_type": obj.object_type,
        "classification": _get_primary_classification(obj),
        "classifications": _serialize_classifications(obj),
        "creators": _extract_creators_list(obj.creators),
        "creation_date_display": obj.creation_date_display,
        "creation_date_earliest": obj.creation_date_earliest.isoformat() if obj.creation_date_earliest else None,
        "creation_date_latest": obj.creation_date_latest.isoformat() if obj.creation_date_latest else None,
        "creation_place": obj.creation_place,
        "materials": obj.materials,
        "techniques": obj.techniques,
        "measurements": [
            {"dimension": m.dimension, "value": float(m.value), "unit": m.unit, "part": m.part}
            for m in (obj.measurement_links or [])
        ],
        "inscriptions": [i.content for i in (obj.inscription_links or [])],
        "style_period": obj.style_period,
        "provenance": obj.provenance,
        "credit_line": obj.credit_line,
        "media": media_items,
        "has_image": len(media_items) > 0,
    }

    pub_cache_set(cache_key, result)
    return result


@router.get("/api/discover/{org_slug}/objects/{object_id}/related", response_model=RelatedObjectsResponse, summary="Get related objects")
def get_related_objects(
    org_slug: str,
    object_id: str,
    db: Session = Depends(get_admin_db),
):
    """Get related objects."""
    org = _get_org_by_slug(db, org_slug)
    if not org:
        return JSONResponse(status_code=404, content={"error": {"code": "not_found", "message": "Collection not found"}})

    obj = _resolve_discover_object(db, org, object_id)
    if not obj:
        return JSONResponse(status_code=404, content={"error": {"code": "not_found", "message": "Object not found"}})

    from app.search.collections.service import CollectionsSearchService, get_collections_search_service

    if not CollectionsSearchService.is_available():
        return {"hits": []}

    should_clauses = _build_related_should_clauses(obj)
    if not should_clauses:
        return {"hits": []}

    query = {
        "size": 8,
        "_source": ["object_id", "object_number", "title", "creators", "creation_date", "classification"],
        "query": {
            "bool": {
                "must_not": [{"term": {"object_id": str(obj.object_id)}}],
                "filter": [
                    {"term": {"is_discoverable": True}},
                    {"term": {"organization_id": str(org.organization_id)}},
                ],
                "should": should_clauses,
                "minimum_should_match": 1,
            }
        }
    }

    service = get_collections_search_service()
    try:
        response = service.index_manager.search(query, str(org.organization_id))
    except Exception as e:
        logger.warning("Related objects search failed: %s", e)
        return {"hits": []}

    os_hits = response.get("hits", {}).get("hits", [])
    if not os_hits:
        return {"hits": []}

    hit_ids = [UUID(h["_source"]["object_id"]) for h in os_hits]
    thumbnails = _get_thumbnail_urls_bulk_with_srcset(hit_ids, org.organization_id, db)

    hits = []
    for h in os_hits:
        src = h["_source"]
        oid = src["object_id"]
        creators_raw = src.get("creators") or []
        creator_names_list = [c.get("name") for c in creators_raw if isinstance(c, dict) and c.get("name")]
        thumb_data = thumbnails.get(oid, {})
        hits.append({
            "object_id": oid,
            "object_number": src.get("object_number"),
            "title": src.get("title"),
            "creators": creator_names_list,
            "creation_date_display": (src.get("creation_date") or {}).get("display"),
            "classification": src.get("classification"),
            "thumbnail_url": thumb_data.get("url") if thumb_data else None,
            "thumbnail_srcset": thumb_data.get("srcset") if thumb_data else None,
        })

    return {"hits": hits}


@router.get("/api/discover/{org_slug}/featured", response_model=FeaturedObjectsResponse, summary="Get featured objects")
def get_featured_objects(
    org_slug: str,
    db: Session = Depends(get_admin_db),
):
    """Get featured objects."""
    cache_key = f"{org_slug}:featured"
    cached = pub_cache_get(cache_key)
    if cached is not None:
        return cached

    org = _get_org_by_slug(db, org_slug)
    if not org:
        return JSONResponse(status_code=404, content={"error": {"code": "not_found", "message": "Collection not found"}})

    config = db.query(DiscoverConfig).filter(
        DiscoverConfig.organization_id == org.organization_id,
    ).first()

    if not config or not config.featured_object_ids:
        return {"hits": []}

    featured_ids = []
    for fid in config.featured_object_ids:
        try:
            featured_ids.append(UUID(str(fid)))
        except (ValueError, AttributeError):
            continue

    if not featured_ids:
        return {"hits": []}

    objects = db.query(CollectionObject).filter(
        CollectionObject.object_id.in_(featured_ids),
        CollectionObject.organization_id == org.organization_id,
        CollectionObject.is_discoverable == True,  # noqa: E712
    ).all()

    obj_map = {obj.object_id: obj for obj in objects}
    thumbnails = _get_thumbnail_urls_bulk_with_srcset(
        [obj.object_id for obj in objects], org.organization_id, db,
    )

    hits = []
    for fid in featured_ids:
        obj = obj_map.get(fid)
        if not obj:
            continue
        thumb_data = thumbnails.get(str(obj.object_id), {})
        hits.append({
            "object_id": str(obj.object_id),
            "object_number": obj.object_number,
            "title": _get_display_title(obj.title_links),
            "brief_description": obj.brief_description,
            "creators": _extract_creators_list(obj.creators),
            "creation_date_display": obj.creation_date_display,
            "classification": _get_primary_classification(obj),
            "object_type": obj.object_type,
            "thumbnail_url": thumb_data.get("url") if thumb_data else None,
            "thumbnail_srcset": thumb_data.get("srcset") if thumb_data else None,
            "has_image": bool(thumb_data),
        })

    data = {"hits": hits}
    pub_cache_set(cache_key, data)
    return data


@router.get("/api/discover/{org_slug}/events", response_model=DiscoverEventListResponse, summary="List public events")
def list_public_events(
    org_slug: str,
    request: Request,
    event_type: str = Query(""),
    limit: int = Query(10, ge=1, le=50),
    show_past: str = Query(""),
    venue: str = Query(""),
    series: str = Query(""),
    date_from: str = Query(""),
    date_to: str = Query(""),
    db: Session = Depends(get_admin_db),
):
    """List public events."""
    cache_key = pub_cache_key_with_params(
        org_slug, "events",
        event_type=event_type or None,
        limit=str(limit),
        show_past=show_past or None,
        venue=venue or None,
        series=series or None,
        date_from=date_from or None,
        date_to=date_to or None,
    )
    cached = pub_cache_get(cache_key)
    if cached is not None:
        return cached

    org = _get_org_by_slug(db, org_slug)
    if not org:
        return JSONResponse(status_code=404, content={"error": {"code": "not_found", "message": "Collection not found"}})

    event_type_val = event_type.strip() or None
    show_past_val = show_past.lower() == "true"
    venue_slug = venue.strip() or None
    series_val = series.strip() or None
    date_from_val = date_from.strip() or None
    date_to_val = date_to.strip() or None

    query = db.query(Event).filter(
        Event.organization_id == org.organization_id,
        Event.audience == "public",
    )

    if show_past_val:
        query = query.filter(Event.status.in_(["scheduled", "completed"]))
    else:
        query = query.filter(Event.status == "scheduled")

    if event_type_val:
        query = query.filter(Event.event_type == event_type_val)

    if venue_slug:
        query = query.join(Venue, Event.venue_id == Venue.venue_id).filter(Venue.slug == venue_slug)

    if series_val:
        query = query.filter(Event.series_name == series_val)

    if date_from_val:
        try:
            dt_from = datetime.fromisoformat(date_from_val)
            query = query.filter(Event.start_at >= dt_from)
        except (ValueError, TypeError):
            pass

    if date_to_val:
        try:
            dt_to = datetime.fromisoformat(date_to_val)
            query = query.filter(Event.start_at <= dt_to)
        except (ValueError, TypeError):
            pass

    query = query.order_by(Event.start_at.asc()).limit(limit)
    events = query.all()

    location_ids = [e.location_id for e in events if e.location_id]
    location_map = {}
    if location_ids:
        locations = db.query(Location).filter(Location.location_id.in_(location_ids)).all()
        location_map = {str(loc.location_id): loc.name for loc in locations}

    venue_ids = [e.venue_id for e in events if e.venue_id]
    venue_map = {}
    if venue_ids:
        venues = db.query(Venue).filter(Venue.venue_id.in_(venue_ids)).all()
        venue_map = {str(v.venue_id): v for v in venues}

    results = []
    for ev in events:
        v = venue_map.get(str(ev.venue_id)) if ev.venue_id else None
        results.append({
            "event_id": str(ev.event_id),
            "title": ev.title,
            "slug": ev.slug,
            "event_type": ev.event_type,
            "status": ev.status,
            "start_at": ev.start_at.isoformat() if ev.start_at else None,
            "end_at": ev.end_at.isoformat() if ev.end_at else None,
            "description": ev.description,
            "short_description": ev.short_description,
            "location_name": location_map.get(str(ev.location_id)) if ev.location_id else None,
            "venue_name": v.name if v else None,
            "venue_slug": v.slug if v else None,
            "capacity": ev.capacity,
            "registration_url": ev.registration_url,
            "price": ev.price,
            "price_member": ev.price_member,
            "age_range": ev.age_range,
            "is_featured": ev.is_featured,
            "series_name": ev.series_name,
            "tags": ev.tags,
            "hero_image_url": _get_media_url(ev.hero_media_id, org.organization_id, db),
        })

    data = {"data": results, "total": len(results)}
    pub_cache_set(cache_key, data)
    return data


@router.get("/api/discover/{org_slug}/staff", response_model=DiscoverStaffListResponse, summary="List public staff")
def list_public_staff(
    org_slug: str,
    department: str = Query(""),
    limit: int = Query(50, ge=1, le=100),
    ids: str = Query(""),
    db: Session = Depends(get_admin_db),
):
    """List public staff.

    `constituent_type == "person"` is NOT a staff test. Constituent is the
    unified person/organization record: donors, lenders, private collectors,
    artists' estates, conservators and NAGPRA contacts are all persons, and
    this endpoint is anonymous, runs on an admin (BYPASSRLS) session, and
    returns email and biography. Filtering on type alone published the
    institution's entire contact book to the internet.

    A constituent linked to a user account IS a staff member — that is what
    `Constituent.user_id` means (see models/contacts.py). Everyone else is
    excluded. The org still opts in per page by placing a staff_grid block
    and publishing it.
    """
    org = _get_org_by_slug(db, org_slug)
    if not org:
        return JSONResponse(status_code=404, content={"error": {"code": "not_found", "message": "Collection not found"}})

    query = db.query(Constituent).filter(
        Constituent.organization_id == org.organization_id,
        Constituent.constituent_type == "person",
        Constituent.is_active.is_(True),
        Constituent.user_id.isnot(None),
    )

    dept = department.strip() or None
    if dept:
        query = query.filter(Constituent.department == dept)

    ids_val = ids.strip() or None
    if ids_val:
        try:
            constituent_ids = [UUID(cid.strip()) for cid in ids_val.split(",") if cid.strip()]
            query = query.filter(Constituent.constituent_id.in_(constituent_ids))
        except (ValueError, AttributeError):
            pass

    query = query.order_by(Constituent.sort_name.asc(), Constituent.name.asc()).limit(limit)
    constituents = query.all()

    results = []
    for c in constituents:
        results.append({
            "constituent_id": str(c.constituent_id),
            "name": c.display_name or c.name,
            "title": c.title,
            "role": c.role,
            "department": c.department,
            "email": c.email,
            "biography": c.biography,
        })

    return {"data": results, "total": len(results)}


@router.get("/api/discover/{org_slug}/venues", response_model=DiscoverVenueListResponse, summary="List public venues")
def list_public_venues(
    org_slug: str,
    db: Session = Depends(get_admin_db),
):
    """List public venues."""
    cache_key = f"{org_slug}:venues"
    cached = pub_cache_get(cache_key)
    if cached is not None:
        return cached

    org = _get_org_by_slug(db, org_slug)
    if not org:
        return JSONResponse(status_code=404, content={"error": {"code": "not_found", "message": "Collection not found"}})

    venues = db.query(Venue).filter(
        Venue.organization_id == org.organization_id,
        Venue.is_public == True,  # noqa: E712
    ).order_by(Venue.sort_order.asc()).all()

    results = []
    for v in venues:
        results.append({
            "venue_id": str(v.venue_id),
            "name": v.name,
            "slug": v.slug,
            "description": v.description,
            "address": v.address,
            "phone": v.phone,
            "email": v.email,
            "website_url": v.website_url,
            "hours": v.hours,
            "admission": v.admission,
            "accent_color": v.accent_color,
            "parking_info": v.parking_info,
            "accessibility_info": v.accessibility_info,
            "ticketing_url": v.ticketing_url,
            "hero_image_url": _get_media_url(v.hero_media_id, org.organization_id, db),
            "thumbnail_url": _get_media_url(v.thumbnail_media_id, org.organization_id, db),
        })

    data = {"data": results, "total": len(results)}
    pub_cache_set(cache_key, data)
    return data


@router.get("/api/discover/{org_slug}/venues/{venue_slug}", response_model=DiscoverVenueDetailOut, summary="Get public venue")
def get_public_venue(
    org_slug: str,
    venue_slug: str,
    db: Session = Depends(get_admin_db),
):
    """Get public venue."""
    cache_key = f"{org_slug}:venue:{venue_slug}"
    cached = pub_cache_get(cache_key)
    if cached is not None:
        return cached

    org = _get_org_by_slug(db, org_slug)
    if not org:
        return JSONResponse(status_code=404, content={"error": {"code": "not_found", "message": "Collection not found"}})

    v = db.query(Venue).filter(
        Venue.organization_id == org.organization_id,
        Venue.slug == venue_slug,
        Venue.is_public == True,  # noqa: E712
    ).first()

    if not v:
        return JSONResponse(status_code=404, content={"error": {"code": "not_found", "message": "Venue not found"}})

    exhibitions = db.query(Exhibition).filter(
        Exhibition.venue_id == v.venue_id,
        Exhibition.is_public == True,  # noqa: E712
        Exhibition.status.in_(["open", "in_preparation"]),
    ).order_by(Exhibition.planned_start_date.asc()).all()

    exhibition_items = []
    for exh in exhibitions:
        exhibition_items.append({
            "exhibition_id": str(exh.exhibition_id),
            "title": exh.title,
            "subtitle": exh.subtitle,
            "public_url_slug": exh.public_url_slug,
            "planned_start_date": exh.planned_start_date.isoformat() if exh.planned_start_date else None,
            "planned_end_date": exh.planned_end_date.isoformat() if exh.planned_end_date else None,
            "short_description": exh.short_description,
            "thumbnail_url": _get_media_url(exh.thumbnail_media_id, org.organization_id, db),
        })

    result = {
        "venue_id": str(v.venue_id),
        "name": v.name,
        "slug": v.slug,
        "description": v.description,
        "address": v.address,
        "phone": v.phone,
        "email": v.email,
        "website_url": v.website_url,
        "hours": v.hours,
        "admission": v.admission,
        "accent_color": v.accent_color,
        "parking_info": v.parking_info,
        "accessibility_info": v.accessibility_info,
        "ticketing_url": v.ticketing_url,
        "hero_image_url": _get_media_url(v.hero_media_id, org.organization_id, db),
        "thumbnail_url": _get_media_url(v.thumbnail_media_id, org.organization_id, db),
        "exhibitions": exhibition_items,
    }

    pub_cache_set(cache_key, result)
    return result


@router.get("/api/discover/{org_slug}/exhibitions", response_model=DiscoverExhibitionListResponse, summary="List public exhibitions")
def list_public_exhibitions(
    org_slug: str,
    request: Request,
    status: str = Query(""),
    venue: str = Query(""),
    featured: str = Query(""),
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_admin_db),
):
    """List public exhibitions."""
    cache_key = pub_cache_key_with_params(
        org_slug, "exhibitions",
        status=status or None,
        venue=venue or None,
        featured=featured or None,
        limit=str(limit),
        offset=str(offset),
    )
    cached = pub_cache_get(cache_key)
    if cached is not None:
        return cached

    org = _get_org_by_slug(db, org_slug)
    if not org:
        return JSONResponse(status_code=404, content={"error": {"code": "not_found", "message": "Collection not found"}})

    status_filter = status.strip() or None
    venue_slug = venue.strip() or None
    featured_val = featured.lower() == "true"

    query = db.query(Exhibition).filter(
        Exhibition.organization_id == org.organization_id,
        Exhibition.is_public == True,  # noqa: E712
    )

    if status_filter == "open":
        query = query.filter(Exhibition.status == "open")
    elif status_filter == "upcoming":
        query = query.filter(
            Exhibition.status.in_(["authorized", "in_preparation"]),
            Exhibition.planned_start_date > date.today(),
        )
    elif status_filter == "past":
        query = query.filter(Exhibition.status.in_(["closed", "archived"]))

    if venue_slug:
        query = query.join(Venue, Exhibition.venue_id == Venue.venue_id).filter(Venue.slug == venue_slug)

    if featured_val:
        query = query.filter(Exhibition.is_featured == True)  # noqa: E712

    total = query.count()

    exhibitions = query.order_by(
        Exhibition.planned_start_date.desc().nullslast(),
    ).offset(offset).limit(limit).all()

    venue_ids = [e.venue_id for e in exhibitions if e.venue_id]
    venue_map = {}
    if venue_ids:
        venues = db.query(Venue).filter(Venue.venue_id.in_(venue_ids)).all()
        venue_map = {str(v.venue_id): v for v in venues}

    results = []
    for exh in exhibitions:
        v = venue_map.get(str(exh.venue_id)) if exh.venue_id else None
        results.append({
            "exhibition_id": str(exh.exhibition_id),
            "title": exh.title,
            "subtitle": exh.subtitle,
            "public_url_slug": exh.public_url_slug,
            "exhibition_type": exh.exhibition_type,
            "status": exh.status,
            "planned_start_date": exh.planned_start_date.isoformat() if exh.planned_start_date else None,
            "planned_end_date": exh.planned_end_date.isoformat() if exh.planned_end_date else None,
            "actual_start_date": exh.actual_start_date.isoformat() if exh.actual_start_date else None,
            "actual_end_date": exh.actual_end_date.isoformat() if exh.actual_end_date else None,
            "short_description": exh.short_description,
            "venue_name": v.name if v else None,
            "venue_slug": v.slug if v else None,
            "is_featured": exh.is_featured,
            "ticketing_url": exh.ticketing_url,
            "thumbnail_url": _get_media_url(exh.thumbnail_media_id, org.organization_id, db),
            "tags": exh.tags,
        })

    data = {"data": results, "total": total}
    pub_cache_set(cache_key, data)
    return data


@router.get("/api/discover/{org_slug}/exhibitions/{slug}", response_model=DiscoverExhibitionDetailOut, summary="Get public exhibition")
def get_public_exhibition(
    org_slug: str,
    slug: str,
    db: Session = Depends(get_admin_db),
):
    """Get public exhibition."""
    cache_key = f"{org_slug}:exhibition:{slug}"
    cached = pub_cache_get(cache_key)
    if cached is not None:
        return cached

    org = _get_org_by_slug(db, org_slug)
    if not org:
        return JSONResponse(status_code=404, content={"error": {"code": "not_found", "message": "Collection not found"}})

    exh = db.query(Exhibition).filter(
        Exhibition.organization_id == org.organization_id,
        Exhibition.public_url_slug == slug,
        Exhibition.is_public == True,  # noqa: E712
    ).first()

    if not exh:
        return JSONResponse(status_code=404, content={"error": {"code": "not_found", "message": "Exhibition not found"}})

    v = None
    if exh.venue_id:
        v = db.query(Venue).filter(Venue.venue_id == exh.venue_id).first()

    exhibition_objects = db.query(ExhibitionObject).filter(
        ExhibitionObject.exhibition_id == exh.exhibition_id,
        ExhibitionObject.object_id.isnot(None),
    ).order_by(ExhibitionObject.display_order.asc()).limit(8).all()

    related_object_ids = [eo.object_id for eo in exhibition_objects if eo.object_id]
    thumbnails_data = _get_thumbnail_urls_bulk_with_srcset(related_object_ids, org.organization_id, db)

    related_objects = []
    if related_object_ids:
        objects = db.query(CollectionObject).filter(
            CollectionObject.object_id.in_(related_object_ids),
        ).all()
        obj_map = {obj.object_id: obj for obj in objects}

        for eo in exhibition_objects:
            obj = obj_map.get(eo.object_id) if eo.object_id else None
            if obj:
                td = thumbnails_data.get(str(obj.object_id), {})
                related_objects.append({
                    "object_id": str(obj.object_id),
                    "object_number": obj.object_number,
                    "title": _get_display_title(obj.title_links),
                    "creators": _extract_creators_list(obj.creators),
                    "creation_date_display": obj.creation_date_display,
                    "thumbnail_url": td.get("url") if td else None,
                    "thumbnail_srcset": td.get("srcset") if td else None,
                })

    result = {
        "exhibition_id": str(exh.exhibition_id),
        "title": exh.title,
        "subtitle": exh.subtitle,
        "public_url_slug": exh.public_url_slug,
        "exhibition_type": exh.exhibition_type,
        "status": exh.status,
        "planned_start_date": exh.planned_start_date.isoformat() if exh.planned_start_date else None,
        "planned_end_date": exh.planned_end_date.isoformat() if exh.planned_end_date else None,
        "actual_start_date": exh.actual_start_date.isoformat() if exh.actual_start_date else None,
        "actual_end_date": exh.actual_end_date.isoformat() if exh.actual_end_date else None,
        "description": exh.description,
        "short_description": exh.short_description,
        "credits": exh.credits,
        "visitor_info": exh.visitor_info,
        "venue_name": v.name if v else None,
        "venue_slug": v.slug if v else None,
        "is_featured": exh.is_featured,
        "ticketing_url": exh.ticketing_url,
        "hero_image_url": _get_media_url(exh.hero_media_id, org.organization_id, db),
        "thumbnail_url": _get_media_url(exh.thumbnail_media_id, org.organization_id, db),
        "tags": exh.tags,
        "related_objects": related_objects,
    }

    pub_cache_set(cache_key, result)
    return result


@router.get("/api/discover/{org_slug}/events/{slug}", response_model=DiscoverEventDetailOut, summary="Get public event")
def get_public_event(
    org_slug: str,
    slug: str,
    db: Session = Depends(get_admin_db),
):
    """Get public event."""
    cache_key = f"{org_slug}:event:{slug}"
    cached = pub_cache_get(cache_key)
    if cached is not None:
        return cached

    org = _get_org_by_slug(db, org_slug)
    if not org:
        return JSONResponse(status_code=404, content={"error": {"code": "not_found", "message": "Collection not found"}})

    event = db.query(Event).filter(
        Event.organization_id == org.organization_id,
        Event.slug == slug,
        Event.audience == "public",
    ).first()

    if not event:
        return JSONResponse(status_code=404, content={"error": {"code": "not_found", "message": "Event not found"}})

    location_name = None
    if event.location_id:
        location = db.query(Location).filter(Location.location_id == event.location_id).first()
        if location:
            location_name = location.name

    v = None
    if event.venue_id:
        v = db.query(Venue).filter(Venue.venue_id == event.venue_id).first()

    exhibition_info = None
    if event.exhibition_id:
        exh = db.query(Exhibition).filter(
            Exhibition.exhibition_id == event.exhibition_id,
            Exhibition.is_public == True,  # noqa: E712
        ).first()
        if exh:
            exhibition_info = {
                "exhibition_id": str(exh.exhibition_id),
                "title": exh.title,
                "public_url_slug": exh.public_url_slug,
            }

    result = {
        "event_id": str(event.event_id),
        "title": event.title,
        "slug": event.slug,
        "event_type": event.event_type,
        "status": event.status,
        "start_at": event.start_at.isoformat() if event.start_at else None,
        "end_at": event.end_at.isoformat() if event.end_at else None,
        "description": event.description,
        "short_description": event.short_description,
        "location_name": location_name,
        "venue_name": v.name if v else None,
        "venue_slug": v.slug if v else None,
        "capacity": event.capacity,
        "registration_url": event.registration_url,
        "price": event.price,
        "price_member": event.price_member,
        "age_range": event.age_range,
        "is_featured": event.is_featured,
        "series_name": event.series_name,
        "tags": event.tags,
        "hero_image_url": _get_media_url(event.hero_media_id, org.organization_id, db),
        "exhibition": exhibition_info,
    }

    pub_cache_set(cache_key, result)
    return result


