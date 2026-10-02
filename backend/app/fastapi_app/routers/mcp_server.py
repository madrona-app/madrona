"""
MCP (Model Context Protocol) server for Madrona public collection data.

Exposes discoverable collection objects, exhibitions, events, and venues
as MCP tools that any MCP-compatible AI client (Claude Desktop, Cursor, etc.)
can query using natural language.

Authentication: X-API-Key header (same keys used for the DAM public API).
Org context is derived from the API key — clients don't need to know the org slug.
"""

import logging
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import UUID

from mcp.server.fastmcp import FastMCP
from starlette.middleware import Middleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

logger = logging.getLogger(__name__)


# =============================================================================
# Org context (populated by auth middleware, read by tools)
# =============================================================================

@dataclass(frozen=True)
class MCPOrgContext:
    organization_id: UUID
    slug: str


_mcp_org_ctx: ContextVar[MCPOrgContext | None] = ContextVar("_mcp_org_ctx", default=None)


def _get_org_ctx() -> MCPOrgContext:
    """Get the current org context. Raises if not authenticated."""
    ctx = _mcp_org_ctx.get()
    if ctx is None:
        raise RuntimeError("MCP org context not set — authentication middleware did not run")
    return ctx


# =============================================================================
# Auth middleware — validates X-API-Key and sets org context
# =============================================================================

class MCPAuthMiddleware(BaseHTTPMiddleware):
    """Validate API key on every MCP request and populate org context."""

    async def dispatch(self, request: Request, call_next):
        api_key = request.headers.get("x-api-key")
        if not api_key:
            return JSONResponse(
                status_code=401,
                content={"error": "X-API-Key header required"},
            )

        from app.database import get_session
        from app.models.core import APIKey, Organization
        from app.services.auth_utils import hash_api_key
        from app.services.api_key_scopes import normalize_scopes, has_scope

        try:
            with get_session() as db:
                key_hash = hash_api_key(api_key)
                key_record = db.query(APIKey).filter(
                    APIKey.key_hash == key_hash,
                    APIKey.status == "active",
                ).first()

                if not key_record:
                    return JSONResponse(status_code=401, content={"error": "Invalid API key"})

                # api_keys.expires_at is timestamptz; this is a guard
                # rather than a fix, kept in step with dependencies/auth.py.
                if key_record.expires_at:
                    _key_expires_at = key_record.expires_at
                    if _key_expires_at.tzinfo is None:
                        _key_expires_at = _key_expires_at.replace(tzinfo=timezone.utc)
                    if _key_expires_at < datetime.now(timezone.utc):
                        return JSONResponse(status_code=401, content={"error": "API key expired"})

                # Check scope
                scopes = normalize_scopes(key_record.scopes)
                if not has_scope(scopes, "collections.view"):
                    return JSONResponse(
                        status_code=403,
                        content={"error": "API key lacks required scope: collections.view"},
                    )

                org = db.query(Organization).filter(
                    Organization.organization_id == key_record.organization_id,
                    Organization.status == "active",
                ).first()

                if not org:
                    return JSONResponse(status_code=403, content={"error": "Organization not found or inactive"})

                # Update last_used_at
                try:
                    key_record.last_used_at = datetime.now(timezone.utc)
                    db.commit()
                except Exception:
                    db.rollback()

                _mcp_org_ctx.set(MCPOrgContext(
                    organization_id=org.organization_id,
                    slug=org.slug,
                ))
        except Exception:
            logger.exception("MCP auth error")
            return JSONResponse(status_code=500, content={"error": "Authentication error"})

        try:
            return await call_next(request)
        finally:
            _mcp_org_ctx.set(None)


# =============================================================================
# MCP Server
# =============================================================================

mcp = FastMCP(
    "Madrona Collections",
    instructions=(
        "Search and explore museum collection data. All tools operate within "
        "the scope of the museum organization associated with your API key."
    ),
)


# =============================================================================
# Tools
# =============================================================================

@mcp.tool()
def search_objects(
    query: str = "",
    classification: str | None = None,
    object_type: str | None = None,
    creator: str | None = None,
    material: str | None = None,
    style_period: str | None = None,
    creation_place: str | None = None,
    on_display: bool | None = None,
    has_image: bool | None = None,
    sort: str = "relevance",
    limit: int = 20,
    offset: int = 0,
) -> dict:
    """Search collection objects by keyword and filters.

    Args:
        query: Search keywords (empty string returns all objects).
        classification: Filter by classification (e.g. "Paintings", "Sculpture").
        object_type: Filter by object type.
        creator: Filter by artist/creator name.
        material: Filter by material.
        style_period: Filter by style or period.
        creation_place: Filter by place of creation.
        on_display: If true, only objects currently on display.
        has_image: If true, only objects with images.
        sort: Sort order — "relevance", "title_asc", "title_desc", "date_asc", "date_desc", "newest".
        limit: Number of results (1-60, default 20).
        offset: Pagination offset.

    Returns:
        Dict with hits (list of objects), total count, facets, and next_offset.
    """
    org = _get_org_ctx()
    limit = max(1, min(60, limit))

    from app.database import get_session
    from app.search.collections.service import CollectionsSearchService, get_collections_search_service
    from app.search.collections.schemas import (
        CollectionsSearchRequest,
        CollectionsSearchQuery,
        CollectionsSearchFilters,
        SearchSort,
    )

    if not CollectionsSearchService.is_available():
        return {"hits": [], "total": 0, "facets": [], "next_offset": None}

    q_str = query.strip() or None

    filters = CollectionsSearchFilters(
        is_discoverable=True,
        classification=[classification] if classification else None,
        object_type=[object_type] if object_type else None,
        creator_name=creator,
        material=material,
        style_period=[style_period] if style_period else None,
        creation_place=creation_place,
        on_display=on_display,
        has_image=has_image,
    )

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
        include_facets=True,
        highlight=False,
    )

    with get_session() as db:
        service = get_collections_search_service()
        response = service.search(search_request, org.organization_id, db_session=db)

        hits = []
        for h in response.hits:
            hits.append({
                "object_id": h.object_id,
                "object_number": h.object_number,
                "title": h.title,
                "brief_description": h.brief_description,
                "creators": [c.get("name") for c in (h.creators or []) if c.get("name")],
                "creation_date_display": h.creation_date.get("display") if h.creation_date else None,
                "classification": h.classification,
                "object_type": h.object_type,
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


@mcp.tool()
def get_object(object_id: str) -> dict:
    """Get full details for a collection object.

    Args:
        object_id: Object UUID or accession/object number.

    Returns:
        Object detail including titles, description, creators, dates, materials,
        measurements, inscriptions, provenance, and media URLs.
    """
    org = _get_org_ctx()

    from app.database import get_session
    from app.services.discovery_service import (
        resolve_discover_object as _resolve_discover_object,
        get_display_title as _get_display_title,
        extract_creators_list as _extract_creators_list,
        get_primary_classification as _get_primary_classification,
        serialize_classifications as _serialize_classifications,
        build_srcset_for_media as _build_srcset_for_media,
    )
    from app.models import CollectionObjectMedia, Media, Organization
    from app.services.uploads import get_org_media_url

    with get_session() as db:
        org_record = db.query(Organization).filter(
            Organization.organization_id == org.organization_id,
        ).first()
        if not org_record:
            return {"error": "Organization not found"}

        obj = _resolve_discover_object(db, org_record, object_id)
        if not obj:
            return {"error": "Object not found"}

        # Load media
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
                    url = get_org_media_url(
                        media.s3_key,
                        organization_id=str(org.organization_id),
                        db_session=db,
                        expiry_seconds=3600,
                    )
                    media_items.append({
                        "media_id": str(media.media_id),
                        "url": url,
                        "media_type": media.media_type,
                        "alt_text": media.alt_text,
                        "credit": media.credit,
                        "is_primary": link.is_primary,
                    })
                except Exception:
                    pass

        return {
            "object_id": str(obj.object_id),
            "object_number": obj.object_number,
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
        }


@mcp.tool()
def get_related_objects(object_id: str) -> dict:
    """Find objects related to a given object (same artist, period, classification, etc.).

    Args:
        object_id: Object UUID or accession/object number.

    Returns:
        Dict with hits — a list of related objects.
    """
    org = _get_org_ctx()

    from app.database import get_session
    from app.services.discovery_service import (
        resolve_discover_object as _resolve_discover_object,
        build_related_should_clauses as _build_related_should_clauses,
    )
    from app.models import Organization
    from app.search.collections.service import CollectionsSearchService, get_collections_search_service

    if not CollectionsSearchService.is_available():
        return {"hits": []}

    with get_session() as db:
        org_record = db.query(Organization).filter(
            Organization.organization_id == org.organization_id,
        ).first()
        if not org_record:
            return {"hits": []}

        obj = _resolve_discover_object(db, org_record, object_id)
        if not obj:
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
        hits = []
        for h in os_hits:
            src = h["_source"]
            creators_raw = src.get("creators") or []
            hits.append({
                "object_id": src["object_id"],
                "object_number": src.get("object_number"),
                "title": src.get("title"),
                "creators": [c.get("name") for c in creators_raw if isinstance(c, dict) and c.get("name")],
                "creation_date_display": (src.get("creation_date") or {}).get("display"),
                "classification": src.get("classification"),
            })

    return {"hits": hits}


@mcp.tool()
def get_featured_objects() -> dict:
    """Get the museum's featured/highlighted collection objects.

    Returns:
        Dict with hits — a list of featured objects.
    """
    org = _get_org_ctx()

    from app.database import get_session
    from app.services.discovery_service import (
        get_display_title as _get_display_title,
        extract_creators_list as _extract_creators_list,
        get_primary_classification as _get_primary_classification,
    )
    from app.models import CollectionObject, DiscoverConfig

    with get_session() as db:
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
        hits = []
        for fid in featured_ids:
            obj = obj_map.get(fid)
            if not obj:
                continue
            hits.append({
                "object_id": str(obj.object_id),
                "object_number": obj.object_number,
                "title": _get_display_title(obj.title_links),
                "brief_description": obj.brief_description,
                "creators": _extract_creators_list(obj.creators),
                "creation_date_display": obj.creation_date_display,
                "classification": _get_primary_classification(obj),
                "object_type": obj.object_type,
            })

    return {"hits": hits}


@mcp.tool()
def list_exhibitions(
    status: str = "",
    venue: str = "",
    limit: int = 20,
    offset: int = 0,
) -> dict:
    """List public exhibitions.

    Args:
        status: Filter by status — "open", "upcoming", or "past". Empty for all.
        venue: Filter by venue slug.
        limit: Number of results (1-50, default 20).
        offset: Pagination offset.

    Returns:
        Dict with data (list of exhibitions) and total count.
    """
    org = _get_org_ctx()
    limit = max(1, min(50, limit))

    from datetime import date
    from app.database import get_session
    from app.models import Exhibition, Venue

    with get_session() as db:
        query = db.query(Exhibition).filter(
            Exhibition.organization_id == org.organization_id,
            Exhibition.is_public == True,  # noqa: E712
        )

        if status == "open":
            query = query.filter(Exhibition.status == "open")
        elif status == "upcoming":
            query = query.filter(
                Exhibition.status.in_(["authorized", "in_preparation"]),
                Exhibition.planned_start_date > date.today(),
            )
        elif status == "past":
            query = query.filter(Exhibition.status.in_(["closed", "archived"]))

        if venue:
            query = query.join(Venue, Exhibition.venue_id == Venue.venue_id).filter(Venue.slug == venue)

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
                "short_description": exh.short_description,
                "venue_name": v.name if v else None,
                "venue_slug": v.slug if v else None,
                "is_featured": exh.is_featured,
            })

    return {"data": results, "total": total}


@mcp.tool()
def get_exhibition(slug: str) -> dict:
    """Get exhibition details including related objects.

    Args:
        slug: The exhibition's public URL slug.

    Returns:
        Exhibition detail with description, dates, venue, and related objects.
    """
    org = _get_org_ctx()

    from app.database import get_session
    from app.services.discovery_service import (
        get_display_title as _get_display_title,
        extract_creators_list as _extract_creators_list,
        get_media_url as _get_media_url,
    )
    from app.models import CollectionObject, Exhibition, ExhibitionObject, Venue

    with get_session() as db:
        exh = db.query(Exhibition).filter(
            Exhibition.organization_id == org.organization_id,
            Exhibition.public_url_slug == slug,
            Exhibition.is_public == True,  # noqa: E712
        ).first()

        if not exh:
            return {"error": "Exhibition not found"}

        v = None
        if exh.venue_id:
            v = db.query(Venue).filter(Venue.venue_id == exh.venue_id).first()

        exhibition_objects = db.query(ExhibitionObject).filter(
            ExhibitionObject.exhibition_id == exh.exhibition_id,
            ExhibitionObject.object_id.isnot(None),
        ).order_by(ExhibitionObject.display_order.asc()).limit(20).all()

        related_objects = []
        if exhibition_objects:
            obj_ids = [eo.object_id for eo in exhibition_objects if eo.object_id]
            objects = db.query(CollectionObject).filter(
                CollectionObject.object_id.in_(obj_ids),
            ).all()
            obj_map = {obj.object_id: obj for obj in objects}

            for eo in exhibition_objects:
                obj = obj_map.get(eo.object_id) if eo.object_id else None
                if obj:
                    related_objects.append({
                        "object_id": str(obj.object_id),
                        "object_number": obj.object_number,
                        "title": _get_display_title(obj.title_links),
                        "creators": _extract_creators_list(obj.creators),
                        "creation_date_display": obj.creation_date_display,
                    })

        return {
            "exhibition_id": str(exh.exhibition_id),
            "title": exh.title,
            "subtitle": exh.subtitle,
            "public_url_slug": exh.public_url_slug,
            "exhibition_type": exh.exhibition_type,
            "status": exh.status,
            "planned_start_date": exh.planned_start_date.isoformat() if exh.planned_start_date else None,
            "planned_end_date": exh.planned_end_date.isoformat() if exh.planned_end_date else None,
            "description": exh.description,
            "short_description": exh.short_description,
            "credits": exh.credits,
            "visitor_info": exh.visitor_info,
            "venue_name": v.name if v else None,
            "venue_slug": v.slug if v else None,
            "is_featured": exh.is_featured,
            "ticketing_url": exh.ticketing_url,
            "hero_image_url": _get_media_url(exh.hero_media_id, org.organization_id, db),
            "tags": exh.tags,
            "related_objects": related_objects,
        }


@mcp.tool()
def list_events(
    event_type: str = "",
    show_past: bool = False,
    limit: int = 10,
) -> dict:
    """List public museum events.

    Args:
        event_type: Filter by type (e.g. "exhibition", "lecture", "workshop"). Empty for all.
        show_past: Include past/completed events (default false — only upcoming).
        limit: Number of results (1-50, default 10).

    Returns:
        Dict with data (list of events) and total count.
    """
    org = _get_org_ctx()
    limit = max(1, min(50, limit))

    from app.database import get_session
    from app.services.discovery_service import get_media_url as _get_media_url
    from app.models import Event, Location, Venue

    with get_session() as db:
        query = db.query(Event).filter(
            Event.organization_id == org.organization_id,
            Event.audience == "public",
        )

        if show_past:
            query = query.filter(Event.status.in_(["scheduled", "completed"]))
        else:
            query = query.filter(Event.status == "scheduled")

        if event_type:
            query = query.filter(Event.event_type == event_type)

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
                "is_featured": ev.is_featured,
                "hero_image_url": _get_media_url(ev.hero_media_id, org.organization_id, db),
            })

    return {"data": results, "total": len(results)}


# =============================================================================
# Resources
# =============================================================================

@mcp.resource("madrona://museum/info")
def museum_info() -> dict:
    """Museum identity: name, total discoverable objects, branding, and hours."""
    org = _get_org_ctx()

    from app.database import get_session
    from app.services.discovery_service import get_media_url as _get_media_url
    from app.models import CollectionObject, DiscoverConfig, Organization
    from sqlalchemy import func

    with get_session() as db:
        org_record = db.query(Organization).filter(
            Organization.organization_id == org.organization_id,
        ).first()
        if not org_record:
            return {"error": "Organization not found"}

        count = db.query(func.count(CollectionObject.object_id)).filter(
            CollectionObject.organization_id == org.organization_id,
            CollectionObject.is_discoverable == True,  # noqa: E712
        ).scalar()

        config = db.query(DiscoverConfig).filter(
            DiscoverConfig.organization_id == org.organization_id,
        ).first()

        return {
            "organization_name": org_record.name,
            "organization_slug": org_record.slug,
            "total_discoverable_objects": count,
            "page_title": config.page_title if config else None,
            "page_subtitle": config.page_subtitle if config else None,
            "footer_text": config.footer_text if config else None,
            "social_links": config.social_links if config else None,
        }


# =============================================================================
# Build the mountable ASGI app
# =============================================================================

def create_mcp_app():
    """Create the MCP Starlette/ASGI app with auth middleware."""
    from starlette.applications import Starlette
    from starlette.routing import Mount

    mcp_starlette_app = mcp.streamable_http_app()

    # Wrap with auth middleware
    app = Starlette(
        routes=[Mount("/", app=mcp_starlette_app)],
        middleware=[Middleware(MCPAuthMiddleware)],
    )
    return app


mcp_app = create_mcp_app()
