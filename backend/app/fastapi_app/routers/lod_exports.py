"""
LOD Readiness, Export Profiles, JSON-LD Export, and URI Resolution API endpoints (FastAPI).

Batch F — 24 routes:
  - LOD Readiness (8 routes): object assessment, score, field hints, collection,
    batch, preview, dismissed hints GET/POST
  - Export Profiles (7 routes): list, get, object export, batch export, collection export,
    preview, compare
  - JSON-LD Export (6 routes): single object, extension, bulk, context, frame, public
  - URI Resolution (3 routes): resolve, head, history

Migrated from app/api/lod_readiness.py, app/api/export_profiles.py,
app/api/jsonld_export.py, app/api/uri_resolution.py.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse, RedirectResponse, Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.models import (
    Organization,
    CollectionObject,
    CollectionObjectMedia,
    Media,
    ObjectClassification,
    LookupValue,
    URIRegistry,
)
from app.permissions import Permission
from app.services.lod_readiness import (
    assess_lod_readiness,
    get_lod_hints_for_field,
    assess_batch_lod_readiness,
)
from app.services.export_profiles import (
    get_profile,
    get_all_profiles,
    apply_export_profile,
    FieldCategory,
    AuthoritySource,
    MediaInclusion,
)
from app.services.jsonld_export import (
    map_object_to_jsonld,
    map_objects_to_jsonld_collection,
    JSONLD_CONTEXT,
)
from app.services.uri_persistence import (
    URIStatus,
    build_uri,
    BASE_URI,
)
from app.services.api_security import escape_ilike
from app.services.rls import set_rls_context_for_session
from app.fastapi_app.schemas.lod_exports import (
    BatchExportOut,
    BatchLodAssessmentOut,
    CollectionLodReadinessOut,
    DismissedHintsOut,
    DismissHintOut,
    ExportProfileListOut,
    ExportProfileOut,
    ExportProfilePreviewOut,
    LodReadinessOut,
    LodScoreOut,
    LodFieldHintsOut,
    ProfileComparisonOut,
    UriHistoryOut,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["lod-exports"])


# ============================================================================
# HELPERS
# ============================================================================


def _object_to_dict(obj: CollectionObject) -> dict:
    if hasattr(obj, "to_dict"):
        return obj.to_dict()
    data = {}
    for column in obj.__table__.columns:
        value = getattr(obj, column.name, None)
        if value is not None:
            if isinstance(value, UUID):
                value = str(value)
            data[column.name] = value
    return data


def _get_org_and_object(db: Session, org_id: str, object_id: str):
    org_uuid = UUID(org_id)
    obj_uuid = UUID(object_id)
    obj = db.query(CollectionObject).filter(
        CollectionObject.object_id == obj_uuid,
        CollectionObject.organization_id == org_uuid,
    ).first()
    return org_uuid, obj_uuid, obj


# ============================================================================
# LOD READINESS ENDPOINTS
# ============================================================================


@router.get("/api/organizations/{org_id}/collections/objects/{object_id}/lod-readiness", response_model=LodReadinessOut, summary="Get object lod readiness")
def get_object_lod_readiness(
    org_id: str,
    object_id: str,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Assess LOD readiness of a single collection object."""
    set_rls_context_for_session(db, org_id)
    org_uuid, obj_uuid, obj = _get_org_and_object(db, org_id, object_id)

    if not obj:
        raise HTTPException(status_code=404, detail="Object not found")

    result = assess_lod_readiness(obj)
    return result.to_dict()


@router.get("/api/organizations/{org_id}/collections/objects/{object_id}/lod-readiness/score", response_model=LodScoreOut, summary="Get object lod score")
def get_object_lod_score(
    org_id: str,
    object_id: str,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get just the LOD readiness score for an object."""
    set_rls_context_for_session(db, org_id)
    org_uuid, obj_uuid, obj = _get_org_and_object(db, org_id, object_id)

    if not obj:
        raise HTTPException(status_code=404, detail="Object not found")

    result = assess_lod_readiness(obj)
    return {"objectId": object_id, "score": round(result.score, 2), "level": result.level}


@router.get("/api/organizations/{org_id}/collections/objects/{object_id}/lod-readiness/field/{field_name}", response_model=LodFieldHintsOut, summary="Get field lod hints")
def get_field_lod_hints(
    org_id: str,
    object_id: str,
    field_name: str,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get LOD hints for a specific field."""
    set_rls_context_for_session(db, org_id)
    org_uuid, obj_uuid, obj = _get_org_and_object(db, org_id, object_id)

    if not obj:
        raise HTTPException(status_code=404, detail="Object not found")

    hints = get_lod_hints_for_field(obj, field_name)
    return {"field": field_name, "hints": [h.to_dict() for h in hints]}


@router.get("/api/organizations/{org_id}/collections/lod-readiness", response_model=CollectionLodReadinessOut, summary="Get collection lod readiness")
def get_collection_lod_readiness(
    org_id: str,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    include_objects: bool = Query(False),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get aggregate LOD readiness for the collection."""
    set_rls_context_for_session(db, org_id)
    org_uuid = UUID(org_id)

    objects = db.query(CollectionObject).filter(
        CollectionObject.organization_id == org_uuid,
    ).offset(offset).limit(limit).all()

    if not objects:
        return {"averageScore": 0, "objectCount": 0, "hintsByCategory": {}}

    batch_result = assess_batch_lod_readiness(objects)

    level_distribution = {}
    for obj_result in batch_result["objects"]:
        level = obj_result["level"]
        level_distribution[level] = level_distribution.get(level, 0) + 1

    response = {
        "averageScore": batch_result["averageScore"],
        "objectCount": batch_result["objectCount"],
        "hintsByCategory": batch_result["hintsByCategory"],
        "levelDistribution": level_distribution,
    }

    if include_objects:
        response["objects"] = batch_result["objects"]

    return response


@router.post("/api/organizations/{org_id}/collections/lod-readiness/batch", response_model=BatchLodAssessmentOut, summary="Assess batch objects")
def assess_batch_objects(
    org_id: str,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Assess LOD readiness for a specific set of objects."""
    set_rls_context_for_session(db, org_id)
    org_uuid = UUID(org_id)

    object_ids = body.get("objectIds", [])
    if not object_ids:
        return {"averageScore": 0, "objects": []}

    obj_uuids = [UUID(oid) for oid in object_ids]
    objects = db.query(CollectionObject).filter(
        CollectionObject.object_id.in_(obj_uuids),
        CollectionObject.organization_id == org_uuid,
    ).all()

    batch_result = assess_batch_lod_readiness(objects)
    return {"averageScore": batch_result["averageScore"], "objects": batch_result["objects"]}


@router.post("/api/lod-readiness/preview", response_model=LodReadinessOut, summary="Preview lod readiness")
def preview_lod_readiness(
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Preview LOD readiness for unsaved object data."""
    if not body:
        raise HTTPException(status_code=400, detail="Request body required")

    result = assess_lod_readiness(body)
    return result.to_dict()


@router.get("/api/organizations/{org_id}/lod-readiness/dismissed-hints", response_model=DismissedHintsOut, summary="Get dismissed hints")
def get_dismissed_hints(
    org_id: str,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get list of hint IDs the user has dismissed."""
    return {"dismissedHints": []}


@router.post("/api/organizations/{org_id}/lod-readiness/dismissed-hints", response_model=DismissHintOut, summary="Dismiss hint")
def dismiss_hint(
    org_id: str,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Dismiss a hint for the current user."""
    hint_id = body.get("hintId")
    scope = body.get("scope", "object")

    if not hint_id:
        raise HTTPException(status_code=400, detail="hintId required")

    return {"dismissed": True, "hintId": hint_id, "scope": scope}


# ============================================================================
# EXPORT PROFILES ENDPOINTS
# ============================================================================


@router.get("/api/export-profiles", response_model=ExportProfileListOut, summary="List export profiles")
def list_export_profiles(
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """List all available export profiles."""
    profiles = get_all_profiles()
    return {
        "profiles": [p.to_dict() for p in profiles.values()],
        "categories": [c.value for c in FieldCategory],
        "authoritySources": [s.value for s in AuthoritySource],
        "mediaOptions": [m.value for m in MediaInclusion],
    }


@router.get("/api/export-profiles/compare", summary="Compare profile exports")
def compare_profile_exports(
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Placeholder for GET — actual compare is POST."""
    raise HTTPException(status_code=405, detail="Use POST for profile comparison")


@router.post("/api/export-profiles/compare", response_model=ProfileComparisonOut, summary="Compare profile exports post")
def compare_profile_exports_post(
    body: dict,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Compare how different profiles would export the same object."""
    object_data = body.get("objectData", {})
    profile_ids = body.get("profiles", ["research", "public", "aggregator"])

    if not object_data:
        raise HTTPException(status_code=400, detail="objectData required")

    base_url = str(request.base_url).rstrip("/")
    comparisons = {}
    field_coverage = {}

    original_fields = set(object_data.keys())

    for profile_id in profile_ids:
        profile = get_profile(profile_id)
        if not profile:
            continue
        exported = apply_export_profile(object_data, profile, base_url)
        comparisons[profile_id] = exported
        for field in original_fields:
            if field not in field_coverage:
                field_coverage[field] = {}
            field_coverage[field][profile_id] = field in exported

    return {"comparisons": comparisons, "fieldCoverage": field_coverage, "profileCount": len(comparisons)}


@router.get("/api/export-profiles/{profile_id}", response_model=ExportProfileOut, summary="Get export profile")
def get_export_profile(
    profile_id: str,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get a specific export profile by ID."""
    profile = get_profile(profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail=f"Profile '{profile_id}' not found")

    return {"profile": profile.to_dict()}


@router.post("/api/export-profiles/{profile_id}/preview", response_model=ExportProfilePreviewOut, summary="Preview profile export")
def preview_profile_export(
    profile_id: str,
    body: dict,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Preview how a profile would transform object data."""
    profile = get_profile(profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail=f"Profile '{profile_id}' not found")

    if not body:
        raise HTTPException(status_code=400, detail="Request body required")

    base_url = str(request.base_url).rstrip("/")
    exported_data = apply_export_profile(body, profile, base_url)

    original_fields = set(body.keys())
    exported_fields = set(exported_data.keys())
    removed_fields = [f for f in (original_fields - exported_fields) if not f.startswith("_")]
    transformed_fields = [f for f in (original_fields & exported_fields) if body.get(f) != exported_data.get(f)]

    return {
        "original": body,
        "exported": exported_data,
        "removedFields": sorted(removed_fields),
        "transformedFields": sorted(transformed_fields),
        "profile": profile.to_dict(),
    }


@router.get("/api/organizations/{org_id}/collections/objects/{object_id}/export", summary="Export object with profile")
def export_object_with_profile(
    org_id: str,
    object_id: str,
    request: Request,
    profile: str = Query("public"),
    format: str = Query(None),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Export a collection object using a specific profile."""
    set_rls_context_for_session(db, org_id)
    org_uuid, obj_uuid, obj = _get_org_and_object(db, org_id, object_id)

    export_profile = get_profile(profile)
    if not export_profile:
        raise HTTPException(status_code=400, detail=f"Unknown profile: {profile}")

    if not obj:
        raise HTTPException(status_code=404, detail="Object not found")

    obj_data = _object_to_dict(obj)
    base_url = str(request.base_url).rstrip("/")
    exported = apply_export_profile(obj_data, export_profile, base_url)
    exported["@id"] = f"{base_url}/org/{org_id}/object/{obj.object_number or object_id}"
    exported["@type"] = "VisualArtwork"

    return exported


@router.post("/api/organizations/{org_id}/collections/objects/export/batch", response_model=BatchExportOut, summary="Export objects batch")
def export_objects_batch(
    org_id: str,
    body: dict,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Export multiple objects using a profile."""
    set_rls_context_for_session(db, org_id)
    org_uuid = UUID(org_id)

    object_ids = body.get("objectIds", [])
    profile_id = body.get("profile", "public")

    if not object_ids:
        return {"objects": [], "profile": profile_id, "count": 0}

    export_profile = get_profile(profile_id)
    if not export_profile:
        raise HTTPException(status_code=400, detail=f"Unknown profile: {profile_id}")

    obj_uuids = [UUID(oid) for oid in object_ids]
    objects = db.query(CollectionObject).filter(
        CollectionObject.object_id.in_(obj_uuids),
        CollectionObject.organization_id == org_uuid,
    ).all()

    base_url = str(request.base_url).rstrip("/")
    exported_objects = []
    for obj in objects:
        obj_data = _object_to_dict(obj)
        exported = apply_export_profile(obj_data, export_profile, base_url)
        exported["@id"] = f"{base_url}/org/{org_id}/object/{obj.object_number or str(obj.object_id)}"
        exported["@type"] = "VisualArtwork"
        exported_objects.append(exported)

    return {"objects": exported_objects, "profile": profile_id, "count": len(exported_objects)}


@router.get("/api/organizations/{org_id}/collections/export", summary="Export collection with profile")
def export_collection_with_profile(
    org_id: str,
    request: Request,
    profile: str = Query("public"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    format: str = Query("json-ld"),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Export collection objects using a profile."""
    set_rls_context_for_session(db, org_id)
    org_uuid = UUID(org_id)

    export_profile = get_profile(profile)
    if not export_profile:
        raise HTTPException(status_code=400, detail=f"Unknown profile: {profile}")

    objects = db.query(CollectionObject).filter(
        CollectionObject.organization_id == org_uuid,
    ).offset(offset).limit(limit).all()

    base_url = str(request.base_url).rstrip("/")
    exported_objects = []
    for obj in objects:
        obj_data = _object_to_dict(obj)
        exported = apply_export_profile(obj_data, export_profile, base_url)
        exported["@id"] = f"{base_url}/org/{org_id}/object/{obj.object_number or str(obj.object_id)}"
        exported["@type"] = "VisualArtwork"
        exported_objects.append(exported)

    if format == "ndjson":
        import json
        ndjson_lines = [json.dumps(obj) for obj in exported_objects]
        return Response(content="\n".join(ndjson_lines), media_type="application/x-ndjson")

    return {
        "@context": export_profile.context_url,
        "@graph": exported_objects,
        "_meta": {"profile": profile, "count": len(exported_objects), "offset": offset, "limit": limit},
    }


# ============================================================================
# JSON-LD EXPORT ENDPOINTS
# ============================================================================


@router.get("/api/organizations/{org_id}/collections/objects/{object_id}/jsonld", summary="Export object jsonld")
def export_object_jsonld(
    org_id: str,
    object_id: str,
    include_media: bool = Query(True),
    include_context: bool = Query(True),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Export a single collection object as JSON-LD."""
    set_rls_context_for_session(db, org_id)
    org_uuid = UUID(org_id)
    obj_uuid = UUID(object_id)

    org = db.query(Organization).filter(Organization.organization_id == org_uuid).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    obj = db.query(CollectionObject).filter(
        CollectionObject.object_id == obj_uuid,
        CollectionObject.organization_id == org_uuid,
    ).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Object not found")

    if include_media:
        media_links = db.query(CollectionObjectMedia).filter(
            CollectionObjectMedia.object_id == obj_uuid,
        ).order_by(CollectionObjectMedia.is_primary.desc(), CollectionObjectMedia.sort_order).all()
        for link in media_links:
            link.media = db.query(Media).filter(Media.media_id == link.media_id).first()
        obj.media_links = media_links

    org_slug = org.slug or str(org_uuid)[:8]
    jsonld = map_object_to_jsonld(obj=obj, org_slug=org_slug, include_media=include_media, include_context=include_context)

    return JSONResponse(content=jsonld, headers={"Content-Type": "application/ld+json"})


@router.get("/api/organizations/{org_id}/collections/objects/{object_id}.jsonld", summary="Export object jsonld extension")
async def export_object_jsonld_extension(
    org_id: str,
    object_id: str,
    include_media: bool = Query(True),
    include_context: bool = Query(True),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Export object as JSON-LD (file extension style URL)."""
    return await export_object_jsonld(org_id, object_id, include_media, include_context, auth, db)


@router.get("/api/organizations/{org_id}/collections/export/jsonld", summary="Export objects jsonld bulk")
def export_objects_jsonld_bulk(
    org_id: str,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    classification: str = Query(None),
    object_type: str = Query(None),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Export multiple collection objects as a JSON-LD Collection."""
    set_rls_context_for_session(db, org_id)
    org_uuid = UUID(org_id)

    org = db.query(Organization).filter(Organization.organization_id == org_uuid).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    query = db.query(CollectionObject).filter(
        CollectionObject.organization_id == org_uuid,
    ).order_by(CollectionObject.object_number)

    if classification:
        query = query.filter(
            CollectionObject.object_id.in_(
                db.query(ObjectClassification.object_id).join(
                    LookupValue, ObjectClassification.value_id == LookupValue.value_id,
                ).filter(LookupValue.label.ilike(f"%{escape_ilike(classification)}%", escape="\\"))
            )
        )
    if object_type:
        query = query.filter(CollectionObject.object_type == object_type)

    objects = query.offset(offset).limit(limit).all()

    for obj in objects:
        media_links = db.query(CollectionObjectMedia).filter(
            CollectionObjectMedia.object_id == obj.object_id,
        ).order_by(CollectionObjectMedia.is_primary.desc(), CollectionObjectMedia.sort_order).all()
        obj_published_links = []
        for link in media_links:
            media = db.query(Media).filter(
                Media.media_id == link.media_id,
                Media.is_published == True,  # noqa: E712
            ).first()
            if media:
                link.media = media
                obj_published_links.append(link)
        obj.media_links = obj_published_links

    org_slug = org.slug or str(org_uuid)[:8]
    collection_title = f"{org.name} Collection Export"

    jsonld = map_objects_to_jsonld_collection(objects=objects, org_slug=org_slug, collection_title=collection_title)
    jsonld["view"] = {
        "@type": "PartialCollectionView",
        "first": f"/api/organizations/{org_id}/collections/export/jsonld?limit={limit}&offset=0",
    }
    if len(objects) == limit:
        jsonld["view"]["next"] = f"/api/organizations/{org_id}/collections/export/jsonld?limit={limit}&offset={offset + limit}"

    return JSONResponse(content=jsonld, headers={"Content-Type": "application/ld+json"})


@router.get("/api/jsonld/context", summary="Get jsonld context")
def get_jsonld_context():
    """Get the JSON-LD context document."""
    return JSONResponse(
        content={"@context": JSONLD_CONTEXT},
        headers={
            "Content-Type": "application/ld+json",
            "Access-Control-Allow-Origin": "*",
        },
    )


@router.get("/api/jsonld/frames/simple-object", summary="Get simple object frame")
def get_simple_object_frame():
    """Get a JSON-LD frame for simple object representation."""
    frame = {
        "@context": JSONLD_CONTEXT,
        "@type": "VisualArtwork",
        "name": {},
        "creator": {"@embed": "@always", "name": {}, "sameAs": {}},
        "dateCreated": {},
        "material": {},
        "locationCreated": {"@embed": "@always", "name": {}},
        "image": {"@embed": "@always", "contentUrl": {}},
    }
    return JSONResponse(
        content=frame,
        headers={
            "Content-Type": "application/ld+json",
            "Access-Control-Allow-Origin": "*",
        },
    )


@router.get("/api/public/v1/organizations/{org_id}/objects/{object_id}/jsonld", summary="Export object jsonld public")
def export_object_jsonld_public(
    org_id: str,
    object_id: str,
    db: Session = Depends(get_db),
):
    """Export a collection object as JSON-LD (public endpoint)."""
    org_uuid = UUID(org_id)
    obj_uuid = UUID(object_id)

    org = db.query(Organization).filter(Organization.organization_id == org_uuid).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # is_discoverable, not is_published: CollectionObject has no is_published, so
    # this public endpoint raised AttributeError and returned 500 on every call.
    # is_discoverable is the flag the Discover routes gate public visibility on,
    # which is the intent here. (Media does have is_published — hence the sibling
    # filters below, which are correct.)
    obj = db.query(CollectionObject).filter(
        CollectionObject.object_id == obj_uuid,
        CollectionObject.organization_id == org_uuid,
        CollectionObject.is_discoverable == True,  # noqa: E712
    ).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Object not found or not published")

    media_links = db.query(CollectionObjectMedia).filter(
        CollectionObjectMedia.object_id == obj_uuid,
    ).order_by(CollectionObjectMedia.is_primary.desc(), CollectionObjectMedia.sort_order).all()
    published_links = []
    for link in media_links:
        media = db.query(Media).filter(
            Media.media_id == link.media_id,
            Media.is_published == True,  # noqa: E712
        ).first()
        if media:
            link.media = media
            published_links.append(link)
    obj.media_links = published_links

    org_slug = org.slug or str(org_uuid)[:8]
    jsonld = map_object_to_jsonld(obj=obj, org_slug=org_slug, include_media=True, include_context=True)

    return JSONResponse(
        content=jsonld,
        headers={
            "Content-Type": "application/ld+json",
            "Access-Control-Allow-Origin": "*",
        },
    )


# ============================================================================
# URI RESOLUTION ENDPOINTS
# ============================================================================


def _get_preferred_content_type(request: Request) -> str:
    accept = request.headers.get("accept", "text/html")
    if "application/ld+json" in accept:
        return "application/ld+json"
    if "application/json" in accept:
        return "application/json"
    return "text/html"


@router.get("/org/{org_slug}/{entity_type}/{public_id}", summary="Resolve uri")
def resolve_uri(
    org_slug: str,
    entity_type: str,
    public_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """Resolve a stable URI to entity data."""
    try:
        full_uri = f"{BASE_URI}/org/{org_slug}/{entity_type}/{public_id}"

        record = db.query(URIRegistry).filter(URIRegistry.full_uri == full_uri).first()

        if not record:
            from app.services.uri_persistence import URL_SEGMENT_TO_ENTITY
            internal_type = URL_SEGMENT_TO_ENTITY.get(entity_type, entity_type)
            record = db.query(URIRegistry).filter(
                URIRegistry.public_id == public_id,
                URIRegistry.entity_type == internal_type,
            ).first()

        if not record:
            raise HTTPException(status_code=404, detail="URI not found")

        if record.status == URIStatus.REDIRECT.value:
            status_code = 301 if record.redirect_type == "301" else 303
            return RedirectResponse(url=record.redirect_to, status_code=status_code)

        if record.status == URIStatus.TOMBSTONE.value:
            return JSONResponse(
                status_code=410,
                content={
                    "error": "Gone",
                    "message": "This resource has been deleted",
                    "reason": record.tombstone_reason,
                    "deleted_at": record.updated_at.isoformat() if record.updated_at else None,
                },
            )

        content_type = _get_preferred_content_type(request)

        if content_type == "text/html":
            ui_url = f"/organizations/{org_slug}/collections/{entity_type}s/{record.entity_id}"
            return RedirectResponse(url=ui_url, status_code=303)

        # Import entity loaders from uri_resolution module
        from app.serializers.uri_resolution import ENTITY_LOADERS
        loader = ENTITY_LOADERS.get(record.entity_type)
        if not loader:
            raise HTTPException(status_code=500, detail=f"Unknown entity type: {record.entity_type}")

        entity_data = loader(record.entity_id, content_type, org_slug)
        if not entity_data:
            raise HTTPException(status_code=404, detail="Entity not found")

        return JSONResponse(
            content=entity_data,
            headers={
                "Content-Type": content_type,
                "Access-Control-Allow-Origin": "*",
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error resolving URI: {e}")
        raise HTTPException(status_code=500, detail="Error resolving URI")


@router.head("/org/{org_slug}/{entity_type}/{public_id}")
def head_uri(
    org_slug: str,
    entity_type: str,
    public_id: str,
    db: Session = Depends(get_db),
):
    """HEAD request for URI — check if it exists without returning body."""
    try:
        full_uri = f"{BASE_URI}/org/{org_slug}/{entity_type}/{public_id}"

        record = db.query(URIRegistry).filter(URIRegistry.full_uri == full_uri).first()

        if not record:
            from app.services.uri_persistence import URL_SEGMENT_TO_ENTITY
            internal_type = URL_SEGMENT_TO_ENTITY.get(entity_type, entity_type)
            record = db.query(URIRegistry).filter(
                URIRegistry.public_id == public_id,
                URIRegistry.entity_type == internal_type,
            ).first()

        if not record:
            return Response(status_code=404)

        if record.status == URIStatus.REDIRECT.value:
            status_code = 301 if record.redirect_type == "301" else 303
            return Response(status_code=status_code, headers={"Location": record.redirect_to})

        if record.status == URIStatus.TOMBSTONE.value:
            return Response(status_code=410)

        return Response(status_code=200)
    except Exception as e:
        logger.error(f"Error in HEAD request for URI: {e}")
        return Response(status_code=500)


@router.get("/org/{org_slug}/{entity_type}/{public_id}/history", response_model=UriHistoryOut, summary="Get uri history")
def get_uri_history(
    org_slug: str,
    entity_type: str,
    public_id: str,
    db: Session = Depends(get_db),
):
    """Get the history of a URI."""
    try:
        from app.services.uri_persistence import URL_SEGMENT_TO_ENTITY
        internal_type = URL_SEGMENT_TO_ENTITY.get(entity_type, entity_type)

        record = db.query(URIRegistry).filter(
            URIRegistry.public_id == public_id,
            URIRegistry.entity_type == internal_type,
        ).first()

        if not record:
            raise HTTPException(status_code=404, detail="URI not found")

        all_records = db.query(URIRegistry).filter(
            URIRegistry.entity_id == record.entity_id,
            URIRegistry.entity_type == internal_type,
        ).order_by(URIRegistry.created_at).all()

        history = []
        for r in all_records:
            entry = {
                "uri": r.full_uri,
                "status": r.status,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            if r.status == URIStatus.REDIRECT.value:
                entry["redirect_to"] = r.redirect_to
            if r.status == URIStatus.TOMBSTONE.value:
                entry["tombstone_reason"] = r.tombstone_reason
            history.append(entry)

        return {
            "uri": f"{BASE_URI}/org/{org_slug}/{entity_type}/{public_id}",
            "entity_id": str(record.entity_id),
            "entity_type": record.entity_type,
            "history": history,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting URI history: {e}")
        raise HTTPException(status_code=500, detail="Error getting URI history")
