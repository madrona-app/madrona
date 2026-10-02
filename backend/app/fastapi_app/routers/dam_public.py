"""
Public DAM API router (FastAPI).

Replaces the Flask blueprint at /public/v1 with the same 7 endpoints.
Reuses the existing serializers from app.api.dam_public.

Access control note
-------------------
Routes here use ``get_admin_db`` (BYPASSRLS) by design. Public callers
have no session and no ``current_org_id`` to set, so a NOBYPASSRLS
session would 404 every lookup. Access control is at the app layer:

  * URL must carry a valid ``org_id`` path parameter.
  * Media rows are filtered to ``is_published == True``.
  * Object rows are filtered to ``is_discoverable == True``.

That second object filter is not cosmetic. This is a BYPASSRLS session, so
nothing else constrains the query, and ``is_discoverable`` is the flag the
NAGPRA display gate holds at False for objects whose display consent has not
been granted (43 CFR 10). Without it this API returned every object in the
organization — including undiscoverable and NAGPRA-restricted ones — to any
caller holding a ``media.view`` key, while the anonymous Discover and IIIF
endpoints correctly refused them.

See ``discover_public.py`` for the canonical writeup of this pattern.
"""

import logging
from datetime import datetime
from uuid import UUID

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_admin_db
from app.fastapi_app.dependencies.auth import APIKeyContext, require_api_key
from app.fastapi_app.schemas.dam_public import (
    ObjectMediaResponse,
    PaginatedMediaResponse,
    PaginatedObjectResponse,
    SingleMediaResponse,
    SingleObjectResponse,
    SyncResponse,
)
from app.models import (
    CollectionObject,
    CollectionObjectMedia,
    Media,
    Organization,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["dam-public"])


def _verify_org_access(ctx: APIKeyContext, org_id: UUID) -> None:
    """Raise 403 if the API key doesn't belong to the requested org."""
    if ctx.organization_id != org_id:
        raise HTTPException(status_code=403, detail={
            "code": "FORBIDDEN",
            "message": "Access denied to this organization",
        })


def _parse_includes(include: str | None) -> set[str]:
    """Parse comma-separated include parameter."""
    if not include:
        return set()
    return {s.strip() for s in include.split(",") if s.strip()}


# ---------------------------------------------------------------------------
# Media endpoints
# ---------------------------------------------------------------------------

@router.get("/{org_id}/media", response_model=PaginatedMediaResponse, summary="List media")
def list_media(
    org_id: UUID,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    media_type: str | None = Query(None),
    updated_since: str | None = Query(None),
    include: str | None = Query(None),
    ctx: APIKeyContext = Depends(require_api_key("media.view")),
    db: Session = Depends(get_admin_db),
):
    """List published media for an organization."""
    _verify_org_access(ctx, org_id)

    offset = (page - 1) * page_size

    query = db.query(Media).filter(
        Media.organization_id == org_id,
        Media.is_published == True,  # noqa: E712
    )

    if media_type:
        query = query.filter(Media.media_type == media_type)

    if updated_since:
        try:
            ts = datetime.fromisoformat(updated_since.replace("Z", "+00:00"))
            query = query.filter(Media.updated_at >= ts)
        except ValueError:
            pass

    total = query.count()
    media_items = query.order_by(Media.created_at.desc()).offset(offset).limit(page_size).all()

    includes = _parse_includes(include)
    include_obj_meta = "object_metadata" in includes

    # Reuse Flask serializers (they use db.session internally for derivatives/rights)
    from app.serializers.dam_public import serialize_public_media
    data = [serialize_public_media(m, include_object_metadata=include_obj_meta, session=db) for m in media_items]

    return {
        "data": data,
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total": total,
            "total_pages": (total + page_size - 1) // page_size,
        },
    }


@router.get("/{org_id}/media/{media_id}", response_model=SingleMediaResponse, summary="Get media")
def get_media(
    org_id: UUID,
    media_id: UUID,
    include: str | None = Query(None),
    ctx: APIKeyContext = Depends(require_api_key("media.view")),
    db: Session = Depends(get_admin_db),
):
    """Get a single published media item."""
    _verify_org_access(ctx, org_id)

    media = db.query(Media).filter(
        Media.media_id == media_id,
        Media.organization_id == org_id,
        Media.is_published == True,  # noqa: E712
    ).first()

    if not media:
        raise HTTPException(status_code=404, detail={
            "code": "NOT_FOUND",
            "message": "Media not found or not published",
        })

    includes = _parse_includes(include)
    from app.serializers.dam_public import serialize_public_media
    return {"data": serialize_public_media(
        media, include_object_metadata="object_metadata" in includes, session=db
    )}


# ---------------------------------------------------------------------------
# Object endpoints
# ---------------------------------------------------------------------------

@router.get("/{org_id}/objects", response_model=PaginatedObjectResponse, summary="List objects")
def list_objects(
    org_id: UUID,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    classification: str | None = Query(None),
    has_media: str | None = Query(None),
    include: str | None = Query(None),
    ctx: APIKeyContext = Depends(require_api_key("media.view")),
    db: Session = Depends(get_admin_db),
):
    """List collection objects with their published media."""
    _verify_org_access(ctx, org_id)

    offset = (page - 1) * page_size

    query = db.query(CollectionObject).filter(
        CollectionObject.organization_id == org_id,
        CollectionObject.is_discoverable == True,  # noqa: E712
    )

    if classification:
        classification_filter = sa.text(
            "EXISTS (SELECT 1 FROM jsonb_array_elements(classifications) AS c WHERE c->>'term' = :term)"
        ).bindparams(term=classification)
        query = query.filter(classification_filter)

    if has_media == "true":
        query = query.join(
            CollectionObjectMedia,
            CollectionObject.object_id == CollectionObjectMedia.object_id,
        ).join(
            Media,
            CollectionObjectMedia.media_id == Media.media_id,
        ).filter(
            Media.is_published == True,  # noqa: E712
        ).distinct()

    total = query.count()
    objects = query.order_by(
        CollectionObject.created_at.desc()
    ).offset(offset).limit(page_size).all()

    includes = _parse_includes(include)
    include_agg = "object_metadata" in includes

    from app.serializers.dam_public import serialize_public_object
    data = [serialize_public_object(obj, include_aggregated_metadata=include_agg, session=db) for obj in objects]

    return {
        "data": data,
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total": total,
            "total_pages": (total + page_size - 1) // page_size,
        },
    }


@router.get("/{org_id}/objects/{object_id}", response_model=SingleObjectResponse, summary="Get object")
def get_object(
    org_id: UUID,
    object_id: UUID,
    include: str | None = Query(None),
    ctx: APIKeyContext = Depends(require_api_key("media.view")),
    db: Session = Depends(get_admin_db),
):
    """Get a single collection object with its published media."""
    _verify_org_access(ctx, org_id)

    obj = db.query(CollectionObject).filter(
        CollectionObject.object_id == object_id,
        CollectionObject.organization_id == org_id,
        CollectionObject.is_discoverable == True,  # noqa: E712
    ).first()

    if not obj:
        raise HTTPException(status_code=404, detail={
            "code": "NOT_FOUND",
            "message": "Object not found",
        })

    includes = _parse_includes(include)
    from app.serializers.dam_public import serialize_public_object
    return {"data": serialize_public_object(
        obj, include_aggregated_metadata="object_metadata" in includes, session=db
    )}


@router.get("/{org_id}/objects/{object_id}/media", response_model=ObjectMediaResponse, summary="Get object media")
def get_object_media(
    org_id: UUID,
    object_id: UUID,
    ctx: APIKeyContext = Depends(require_api_key("media.view")),
    db: Session = Depends(get_admin_db),
):
    """Get published media for a collection object."""
    _verify_org_access(ctx, org_id)

    obj = db.query(CollectionObject).filter(
        CollectionObject.object_id == object_id,
        CollectionObject.organization_id == org_id,
        CollectionObject.is_discoverable == True,  # noqa: E712
    ).first()

    if not obj:
        raise HTTPException(status_code=404, detail={
            "code": "NOT_FOUND",
            "message": "Object not found",
        })

    media_links = db.query(CollectionObjectMedia).filter(
        CollectionObjectMedia.object_id == object_id,
    ).order_by(
        CollectionObjectMedia.is_primary.desc(),
        CollectionObjectMedia.sort_order,
    ).all()

    result = []
    from app.serializers.dam_public import serialize_public_media
    for link in media_links:
        media = db.query(Media).filter(
            Media.media_id == link.media_id,
            Media.is_published == True,  # noqa: E712
        ).first()
        if media:
            result.append({
                "media": serialize_public_media(media, session=db),
                "is_primary": link.is_primary,
                "caption": link.caption,
            })

    return {"data": result}


# ---------------------------------------------------------------------------
# IIIF endpoint
# ---------------------------------------------------------------------------

@router.get("/{org_id}/iiif/{object_id}/manifest.json", summary="Get iiif manifest")
def get_iiif_manifest(
    org_id: UUID,
    object_id: UUID,
    ctx: APIKeyContext = Depends(require_api_key("media.view")),
    db: Session = Depends(get_admin_db),
):
    """Get IIIF Presentation 3.0 manifest for a collection object."""
    from app.services.iiif_presentation import get_iiif_presentation_service

    _verify_org_access(ctx, org_id)

    obj = db.query(CollectionObject).filter(
        CollectionObject.object_id == object_id,
        CollectionObject.organization_id == org_id,
        CollectionObject.is_discoverable == True,  # noqa: E712
    ).first()

    if not obj:
        raise HTTPException(status_code=404, detail={
            "code": "NOT_FOUND",
            "message": "Object not found",
        })

    media_links = db.query(CollectionObjectMedia).filter(
        CollectionObjectMedia.object_id == object_id,
    ).order_by(
        CollectionObjectMedia.is_primary.desc(),
        CollectionObjectMedia.sort_order,
    ).all()

    published_links = []
    for link in media_links:
        media = db.query(Media).filter(
            Media.media_id == link.media_id,
            Media.is_published == True,  # noqa: E712
        ).first()
        if media:
            link.media = media
            published_links.append(link)

    if not published_links:
        raise HTTPException(status_code=404, detail={
            "code": "NOT_FOUND",
            "message": "No published media for this object",
        })

    org = db.query(Organization).filter(
        Organization.organization_id == org_id,
    ).first()
    org_name = org.name if org else None

    service = get_iiif_presentation_service()
    manifest = service.generate_manifest(obj, published_links, org_name)

    from fastapi.responses import JSONResponse
    return JSONResponse(
        content=manifest,
        media_type='application/ld+json;profile="http://iiif.io/api/presentation/3/context.json"',
        headers={"Access-Control-Allow-Origin": "*"},
    )


# ---------------------------------------------------------------------------
# Sync endpoint
# ---------------------------------------------------------------------------

@router.get("/{org_id}/sync", response_model=SyncResponse, summary="Get sync")
def get_sync(
    org_id: UUID,
    since: str | None = Query(None),
    ctx: APIKeyContext = Depends(require_api_key("media.view")),
    db: Session = Depends(get_admin_db),
):
    """Get recently updated media and objects for incremental sync."""
    _verify_org_access(ctx, org_id)

    if not since:
        raise HTTPException(status_code=400, detail={
            "code": "BAD_REQUEST",
            "message": "'since' parameter is required",
        })

    try:
        since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=400, detail={
            "code": "BAD_REQUEST",
            "message": "Invalid 'since' timestamp format",
        })

    updated_media = db.query(Media).filter(
        Media.organization_id == org_id,
        Media.is_published == True,  # noqa: E712
        Media.updated_at > since_dt,
    ).order_by(Media.updated_at.asc()).limit(1000).all()

    updated_objects = db.query(CollectionObject).filter(
        CollectionObject.organization_id == org_id,
        CollectionObject.updated_at > since_dt,
    ).order_by(CollectionObject.updated_at.asc()).limit(1000).all()

    latest_update = since_dt
    for m in updated_media:
        if m.updated_at and m.updated_at > latest_update:
            latest_update = m.updated_at
    for o in updated_objects:
        if o.updated_at and o.updated_at > latest_update:
            latest_update = o.updated_at

    from app.serializers.dam_public import serialize_public_media, serialize_public_object

    return {
        "data": {
            "media": [serialize_public_media(m, include_derivatives=False, session=db) for m in updated_media],
            "objects": [serialize_public_object(o, include_media=False, session=db) for o in updated_objects],
        },
        "sync": {
            "since": since,
            "until": latest_update.isoformat() if latest_update != since_dt else since,
            "media_count": len(updated_media),
            "object_count": len(updated_objects),
            "has_more": len(updated_media) >= 1000 or len(updated_objects) >= 1000,
        },
    }
