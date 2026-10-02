"""
Media IIIF API endpoints (FastAPI).

Phase 9i — 11 routes:
  - IIIF Image API (4 routes): public manifest, collection manifest, media info.json, authenticated manifest
  - IIIF LOD (7 routes): LOD manifest, manifest.json alias, URI resolution, canvas, collection, activity stream, media LOD

Migrated from app/api/iiif.py and app/api/iiif_lod.py.
"""

import logging
import re
import unicodedata
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy.orm import Session, selectinload

from app.database import get_admin_db, get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.models import (
    CollectionObject,
    CollectionObjectMedia,
    Media,
    Organization,
    URIRegistry,
)
from app.permissions import Permission
from app.services.api_security import escape_ilike
from app.services.uri_persistence import URIStatus, BASE_URI

logger = logging.getLogger(__name__)

router = APIRouter(tags=["media-iiif"])


# ============================================================================
# CONTENT TYPE CONSTANTS
# ============================================================================

IIIF_PRESENTATION_CT = 'application/ld+json;profile="http://iiif.io/api/presentation/3/context.json"'
IIIF_IMAGE_CT = 'application/ld+json;profile="http://iiif.io/api/image/3/context.json"'
JSONLD_CONTENT_TYPE = "application/ld+json"


# ============================================================================
# HELPERS
# ============================================================================


def _slugify(text: str) -> str:
    """Convert text to a URL-safe slug."""
    text = unicodedata.normalize("NFKD", str(text))
    text = text.encode("ascii", "ignore").decode("ascii")
    text = text.lower()
    text = re.sub(r"[./\\]", "-", text)
    text = re.sub(r"[^a-z0-9-]", "", text)
    text = re.sub(r"-+", "-", text)
    text = text.strip("-")
    return text or "object"


def _find_object_by_public_id(
    db: Session, org_id: UUID, public_id: str
) -> CollectionObject | None:
    """Find an object by its public ID (slugified object_number)."""
    objects = (
        db.query(CollectionObject)
        .filter(CollectionObject.organization_id == org_id)
        .all()
    )
    for obj in objects:
        if _slugify(obj.object_number) == public_id.lower():
            return obj
    return None


def _get_preferred_format(request: Request) -> str:
    """Determine preferred response format from Accept header."""
    accept = request.headers.get("accept", "")
    if "application/ld+json" in accept:
        return "jsonld"
    if "application/json" in accept:
        return "json"
    if "text/html" in accept:
        return "html"
    return "jsonld"


def _load_media_links(db: Session, object_id: UUID, *, published_only: bool = False) -> list:
    """Load ordered media links with their media objects.

    `published_only=True` is the guard for the anonymous public IIIF routes:
    it includes only `is_published` media, so the BYPASSRLS session those
    routes use can never surface internal/unpublished media. Links whose media
    is unpublished are dropped entirely.
    """
    media_links = (
        db.query(CollectionObjectMedia)
        .filter(CollectionObjectMedia.object_id == object_id)
        .order_by(
            CollectionObjectMedia.is_primary.desc(),
            CollectionObjectMedia.sort_order,
        )
        .all()
    )
    # Eager-load derivatives so the manifest builder can pick a display
    # source (access_master) without N+1 queries.
    result = []
    for link in media_links:
        media_query = db.query(Media).options(selectinload(Media.derivatives)).filter(
            Media.media_id == link.media_id
        )
        if published_only:
            media_query = media_query.filter(Media.is_published.is_(True))
        media = media_query.first()
        if published_only and media is None:
            # Unpublished media never appears in a public manifest. Skip the
            # link WITHOUT assigning to link.media — setting the relationship to
            # None on a persistent row makes autoflush try to null its FK
            # (media_id is part of the PK) and raises.
            continue
        link.media = media
        result.append(link)
    return result


def _iiif_json_response(data: dict, content_type: str = IIIF_PRESENTATION_CT, cache_max_age: int = 300) -> JSONResponse:
    """Create a JSONResponse with IIIF headers."""
    return JSONResponse(
        content=data,
        headers={
            "Content-Type": content_type,
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": f"public, max-age={cache_max_age}",
        },
    )


# ============================================================================
# IIIF IMAGE API ROUTES (from iiif.py)
# ============================================================================


@router.get("/iiif/3/{object_id}/manifest.json", summary="Get object manifest")
def get_object_manifest(
    object_id: UUID,
    db: Session = Depends(get_admin_db),
):
    """Public IIIF Presentation 3.0 manifest for a collection object.

    Anonymous and cross-org by design (IIIF interoperability), so it runs on
    the BYPASSRLS session — which makes the publish-to-expose guards the ONLY
    access control. Both are mandatory:
      * the object must be `is_discoverable` (the institution's deliberate
        publish act) — otherwise 404, indistinguishable from nonexistent;
      * only `is_published` media are included, and a discoverable object with
        no published media is a 404 (no empty public manifest).
    The manifest itself currently exposes only the object title + published
    images; any future descriptive metadata MUST go through a public-safe
    field whitelist before being added here.
    """
    obj = (
        db.query(CollectionObject)
        .filter(
            CollectionObject.object_id == object_id,
            CollectionObject.is_discoverable.is_(True),
        )
        .first()
    )
    if not obj:
        raise HTTPException(status_code=404, detail="Object not found")

    media_links = _load_media_links(db, object_id, published_only=True)
    if not media_links:
        raise HTTPException(status_code=404, detail="No published media for this object")

    # Get organization name for attribution
    org_name = None
    if obj.organization_id:
        org = (
            db.query(Organization)
            .filter(Organization.organization_id == obj.organization_id)
            .first()
        )
        if org:
            org_name = org.name

    from app.services.iiif_presentation import get_iiif_presentation_service

    service = get_iiif_presentation_service()
    service.db_session = db
    service._url_cache = {}
    manifest = service.generate_manifest(obj, media_links, org_name)

    return _iiif_json_response(manifest, IIIF_PRESENTATION_CT, cache_max_age=300)


@router.get("/iiif/3/collection/{collection_id}/manifest.json", summary="Get collection manifest")
def get_collection_manifest(
    collection_id: str,
    label: str = Query("Collection"),
    description: str = Query(None),
    object_ids: str = Query(None),
    db: Session = Depends(get_admin_db),
):
    """Public IIIF Collection manifest for a group of objects.

    Anonymous + BYPASSRLS like the object manifest, so the discoverable gate is
    mandatory: only `is_discoverable` objects are listed; non-discoverable IDs
    are silently dropped rather than leaked.
    """
    objects = []
    if object_ids:
        parsed_ids = [UUID(oid.strip()) for oid in object_ids.split(",")]
        objects = (
            db.query(CollectionObject)
            .filter(
                CollectionObject.object_id.in_(parsed_ids),
                CollectionObject.is_discoverable.is_(True),
            )
            .all()
        )

    from app.services.iiif_presentation import get_iiif_presentation_service

    service = get_iiif_presentation_service()
    manifest = service.generate_collection_manifest(
        collection_id, objects, label, description
    )

    return _iiif_json_response(manifest, IIIF_PRESENTATION_CT, cache_max_age=300)


@router.get("/iiif/3/media/{media_id}/info.json", summary="Get media info")
def get_media_info(
    media_id: UUID,
    request: Request,
    db: Session = Depends(get_admin_db),
):
    """Public IIIF Image API 3.0 info.json for a media item.

    Anonymous + BYPASSRLS, so the `is_published` gate is the access control:
    an unpublished (or nonexistent) media item is an indistinguishable 404.
    """
    media = (
        db.query(Media)
        .filter(Media.media_id == media_id, Media.is_published.is_(True))
        .first()
    )
    if not media:
        raise HTTPException(status_code=404, detail="Media not found")

    if media.media_type != "image":
        raise HTTPException(status_code=400, detail="Only images support IIIF")

    from app.services.iiif_image import IIIFImageService, get_iiif_image_service

    image_service = get_iiif_image_service()
    if IIIFImageService.is_available():
        info_url = image_service.get_info_url(media)
        return RedirectResponse(url=info_url, status_code=302)

    # Return basic info.json
    width = media.width or 1000
    height = media.height or 1000

    info = {
        "@context": "http://iiif.io/api/image/3/context.json",
        "id": str(request.url).replace("/info.json", ""),
        "type": "ImageService3",
        "protocol": "http://iiif.io/api/image",
        "profile": "level0",
        "width": width,
        "height": height,
        "sizes": [
            {"width": 200, "height": int(200 * height / width)},
            {"width": 800, "height": int(800 * height / width)},
            {"width": width, "height": height},
        ],
    }

    return _iiif_json_response(info, IIIF_IMAGE_CT, cache_max_age=3600)


@router.get("/api/organizations/{org_id}/iiif/objects/{object_id}/manifest.json", summary="Get authenticated manifest")
def get_authenticated_manifest(
    org_id: UUID,
    object_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """Get IIIF manifest with authentication (for internal use)."""
    obj = (
        db.query(CollectionObject)
        .filter(
            CollectionObject.object_id == object_id,
            CollectionObject.organization_id == org_id,
        )
        .first()
    )
    if not obj:
        raise HTTPException(status_code=404, detail="Object not found")

    media_links = _load_media_links(db, object_id)

    org = (
        db.query(Organization)
        .filter(Organization.organization_id == org_id)
        .first()
    )
    org_name = org.name if org else None

    from app.services.iiif_presentation import get_iiif_presentation_service

    service = get_iiif_presentation_service()
    service.db_session = db
    service._url_cache = {}
    manifest = service.generate_manifest(obj, media_links, org_name)

    return JSONResponse(
        content=manifest,
        headers={"Content-Type": IIIF_PRESENTATION_CT},
    )


# ============================================================================
# IIIF LOD ROUTES (from iiif_lod.py)
# ============================================================================


def _generate_lod_manifest_response(
    db: Session, obj: CollectionObject, org: Organization, org_slug: str
) -> JSONResponse:
    """Generate and return a LOD manifest response."""
    media_links = _load_media_links(db, obj.object_id)

    from app.services.iiif_lod import get_iiif_lod_service

    service = get_iiif_lod_service()
    manifest = service.generate_manifest(
        obj=obj,
        media_items=media_links,
        organization=org,
        org_slug=org_slug,
    )

    return _iiif_json_response(manifest, IIIF_PRESENTATION_CT, cache_max_age=3600)


@router.get("/org/{org_slug}/object/{public_id}/manifest", summary="Get object manifest lod")
def get_object_manifest_lod(
    org_slug: str,
    public_id: str,
    db: Session = Depends(get_db),
):
    """Get IIIF Presentation 3.0 manifest via stable URI (public LOD)."""
    full_uri = f"{BASE_URI}/org/{org_slug}/object/{public_id}"

    record = db.query(URIRegistry).filter(URIRegistry.full_uri == full_uri).first()

    if not record:
        org = db.query(Organization).filter(Organization.slug == org_slug).first()
        if not org:
            raise HTTPException(status_code=404, detail="Organization not found")

        obj = _find_object_by_public_id(db, org.organization_id, public_id)
        if not obj:
            raise HTTPException(status_code=404, detail="Object not found")

        return _generate_lod_manifest_response(db, obj, org, org_slug)

    # Handle URI registry status
    if record.status == URIStatus.REDIRECT.value:
        new_manifest_uri = f"{record.redirect_to}/manifest"
        return RedirectResponse(url=new_manifest_uri, status_code=301)

    if record.status == URIStatus.TOMBSTONE.value:
        return JSONResponse(
            status_code=410,
            content={
                "error": "Gone",
                "message": "This resource has been deleted",
                "reason": record.tombstone_reason,
            },
        )

    # Active URI
    org = (
        db.query(Organization)
        .filter(Organization.organization_id == record.organization_id)
        .first()
    )
    obj = (
        db.query(CollectionObject)
        .filter(CollectionObject.object_id == record.entity_id)
        .first()
    )
    if not obj:
        raise HTTPException(status_code=404, detail="Object not found")

    return _generate_lod_manifest_response(db, obj, org, org_slug)


@router.get("/org/{org_slug}/object/{public_id}/manifest.json", summary="Get object manifest lod json")
async def get_object_manifest_lod_json(
    org_slug: str,
    public_id: str,
    db: Session = Depends(get_db),
):
    """Get manifest with .json extension (alternative URL pattern)."""
    return get_object_manifest_lod(org_slug, public_id, db)


@router.get("/org/{org_slug}/object/{public_id}", summary="Resolve object uri")
async def resolve_object_uri(
    org_slug: str,
    public_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """Resolve a stable object URI with content negotiation (public LOD)."""
    preferred_format = _get_preferred_format(request)

    if preferred_format == "html":
        return RedirectResponse(
            url=f"/organizations/{org_slug}/collections/objects/{public_id}",
            status_code=303,
        )

    return get_object_manifest_lod(org_slug, public_id, db)


@router.get("/org/{org_slug}/object/{public_id}/canvas/{sequence}", summary="Get canvas")
def get_canvas(
    org_slug: str,
    public_id: str,
    sequence: int,
    db: Session = Depends(get_db),
):
    """Get a specific canvas from an object manifest (public LOD)."""
    org = db.query(Organization).filter(Organization.slug == org_slug).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    obj = _find_object_by_public_id(db, org.organization_id, public_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Object not found")

    media_links = (
        db.query(CollectionObjectMedia)
        .filter(CollectionObjectMedia.object_id == obj.object_id)
        .order_by(
            CollectionObjectMedia.is_primary.desc(),
            CollectionObjectMedia.sort_order,
        )
        .all()
    )

    if sequence < 1 or sequence > len(media_links):
        raise HTTPException(status_code=404, detail="Canvas not found")

    link = media_links[sequence - 1]
    link.media = db.query(Media).filter(Media.media_id == link.media_id).first()

    if not link.media:
        raise HTTPException(status_code=404, detail="Media not found")

    from app.services.iiif_lod import get_iiif_lod_service

    service = get_iiif_lod_service()
    canvas = service._create_canvas(
        link.media, sequence, link.caption_override, obj, org_slug
    )

    return JSONResponse(
        content=canvas,
        headers={
            "Content-Type": IIIF_PRESENTATION_CT,
            "Access-Control-Allow-Origin": "*",
        },
    )


@router.get("/org/{org_slug}/collection/{collection_id}", summary="Get lod collection manifest")
def get_lod_collection_manifest(
    org_slug: str,
    collection_id: str,
    label: str = Query("Collection"),
    description: str = Query(None),
    object_ids: str = Query(None),
    classification: str = Query(None),
    limit: int = Query(100, le=1000),
    db: Session = Depends(get_db),
):
    """Get a IIIF Collection manifest (public LOD)."""
    org = db.query(Organization).filter(Organization.slug == org_slug).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    if object_ids:
        public_ids = [pid.strip() for pid in object_ids.split(",")]
        objects = []
        for pid in public_ids:
            obj = _find_object_by_public_id(db, org.organization_id, pid)
            if obj:
                objects.append(obj)
    else:
        from app.models import ObjectClassification, LookupValue

        query = db.query(CollectionObject).filter(
            CollectionObject.organization_id == org.organization_id,
            CollectionObject.is_discoverable == True,  # noqa: E712
        )

        if classification:
            query = query.filter(
                CollectionObject.object_id.in_(
                    db.query(ObjectClassification.object_id)
                    .join(
                        LookupValue,
                        ObjectClassification.value_id == LookupValue.value_id,
                    )
                    .filter(LookupValue.label.ilike(f"%{escape_ilike(classification)}%", escape="\\"))
                )
            )

        objects = (
            query.order_by(CollectionObject.object_number).limit(limit).all()
        )

    from app.services.iiif_lod import get_iiif_lod_service

    service = get_iiif_lod_service()
    manifest = service.generate_collection_manifest(
        collection_id=collection_id,
        objects=objects,
        label=label,
        description=description,
        organization=org,
        org_slug=org_slug,
    )

    return JSONResponse(
        content=manifest,
        headers={
            "Content-Type": IIIF_PRESENTATION_CT,
            "Access-Control-Allow-Origin": "*",
        },
    )


@router.get("/org/{org_slug}/activity", summary="Get activity stream")
def get_activity_stream(
    org_slug: str,
    since: str = Query(None),
    limit: int = Query(100, le=1000),
    db: Session = Depends(get_db),
):
    """Get IIIF Change Discovery activity stream (public LOD)."""
    org = db.query(Organization).filter(Organization.slug == org_slug).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    query = (
        db.query(CollectionObject)
        .filter(
            CollectionObject.organization_id == org.organization_id,
            CollectionObject.is_discoverable == True,  # noqa: E712
        )
        .order_by(CollectionObject.updated_at.desc())
    )

    if since:
        since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
        query = query.filter(CollectionObject.updated_at > since_dt)

    objects = query.limit(limit).all()

    activities = []
    for obj in objects:
        public_id = _slugify(obj.object_number)
        manifest_uri = f"{BASE_URI}/org/{org_slug}/object/{public_id}/manifest"
        activities.append(
            {
                "type": "Update",
                "object": {"id": manifest_uri, "type": "Manifest"},
                "endTime": obj.updated_at.isoformat() if obj.updated_at else None,
            }
        )

    stream = {
        "@context": "http://iiif.io/api/discovery/1/context.json",
        "id": f"{BASE_URI}/org/{org_slug}/activity",
        "type": "OrderedCollection",
        "totalItems": len(activities),
        "orderedItems": activities,
    }

    return JSONResponse(
        content=stream,
        headers={
            "Content-Type": JSONLD_CONTENT_TYPE,
            "Access-Control-Allow-Origin": "*",
        },
    )


@router.get("/org/{org_slug}/media/{public_id}", summary="Get media lod")
def get_media_lod(
    org_slug: str,
    public_id: str,
    db: Session = Depends(get_db),
):
    """Get LOD representation of a media item (public).

    Three things were wrong with the original lookup and all three only stayed
    harmless because this route runs on an RLS-enforced session with no org
    context, so every query returned nothing and it 404'd unconditionally:

      * it matched `Media.media_id::text LIKE :public_id || '%'` — a PREFIX,
        so a few hex characters resolved to whatever media sorted first;
      * it ignored `org_slug` completely, so the org in the URL was decoration;
      * it had no `is_published` filter, unlike every other public IIIF route.

    Repairing the 404 by handing this an admin session — the obvious fix, and
    what its /iiif/3/ siblings use — would have turned it into a cross-org
    media enumerator. Resolve the org, match the full id, require published.
    """
    org = db.query(Organization).filter(Organization.slug == org_slug).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    try:
        media_uuid = UUID(public_id)
    except (ValueError, AttributeError):
        raise HTTPException(status_code=404, detail="Media not found")

    media = (
        db.query(Media)
        .filter(
            Media.media_id == media_uuid,
            Media.organization_id == org.organization_id,
            Media.is_published == True,  # noqa: E712
        )
        .first()
    )
    if not media:
        raise HTTPException(status_code=404, detail="Media not found")

    # Get parent objects
    links = (
        db.query(CollectionObjectMedia)
        .filter(CollectionObjectMedia.media_id == media.media_id)
        .all()
    )

    parent_objects = []
    for link in links:
        obj = (
            db.query(CollectionObject)
            .filter(CollectionObject.object_id == link.object_id)
            .first()
        )
        if obj:
            obj_public_id = _slugify(obj.object_number)
            parent_objects.append(
                {
                    "@id": f"{BASE_URI}/org/{org_slug}/object/{obj_public_id}",
                    "@type": "VisualArtwork",
                    "name": obj.title_links[0].title
                    if obj.title_links
                    else obj.object_name,
                }
            )

    media_uri = f"{BASE_URI}/org/{org_slug}/media/{public_id}"

    jsonld = {
        "@context": "https://schema.org/",
        "@type": "ImageObject",
        "@id": media_uri,
        "name": media.title or media.filename,
        "description": media.description,
        "encodingFormat": media.mime_type,
        "width": {
            "@type": "QuantitativeValue",
            "value": media.width,
            "unitCode": "E37",
        },
        "height": {
            "@type": "QuantitativeValue",
            "value": media.height,
            "unitCode": "E37",
        },
    }

    if parent_objects:
        jsonld["isPartOf"] = parent_objects

    from app.services.iiif_image import get_iiif_image_service

    image_service = get_iiif_image_service()
    if image_service.is_available():
        jsonld["url"] = image_service.get_info_url(media)

    return JSONResponse(
        content=jsonld,
        headers={
            "Content-Type": JSONLD_CONTENT_TYPE,
            "Access-Control-Allow-Origin": "*",
        },
    )
