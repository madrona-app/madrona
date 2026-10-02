"""
Taxonomy Authorities API endpoints (FastAPI).

Provides CRUD for place, style/period, and subject authority records,
plus object-authority linking for each type.
Migrated from app/api/collections_cdwa_procedure.py (Domains 14-16).
"""

import logging
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, object_session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.models import (
    PlaceAuthority,
    ObjectPlaceAuthority,
    StylePeriodAuthority,
    ObjectStylePeriod,
    SubjectAuthority,
    ObjectSubject,
)
from app.permissions import Permission
from app.services.api_security import escape_ilike
from app.services.field_access_service import apply_field_access, get_write_restricted_fields
from app.services.validation_utils import parse_uuid_or_raise
from app.fastapi_app.schemas.collections_taxonomy import (
    CreatePlaceAuthorityRequest,
    UpdatePlaceAuthorityRequest,
    CreateObjectPlaceAuthorityLinkRequest,
    CreateStylePeriodAuthorityRequest,
    UpdateStylePeriodAuthorityRequest,
    CreateObjectStylePeriodLinkRequest,
    CreateSubjectAuthorityRequest,
    UpdateSubjectAuthorityRequest,
    CreateObjectSubjectLinkRequest,
    PlaceAuthorityOut,
    PlaceAuthorityListResponse,
    ObjectPlaceAuthorityLinkOut,
    ObjectPlaceAuthorityListResponse,
    TaxonomyDeleteResponse,
    StylePeriodAuthorityOut,
    StylePeriodAuthorityListResponse,
    ObjectStylePeriodLinkOut,
    ObjectStylePeriodListResponse,
    SubjectAuthorityOut,
    SubjectAuthorityListResponse,
    ObjectSubjectLinkOut,
    ObjectSubjectListResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["collections-taxonomy"])


# ============================================================================
# SHARED NORMALIZER
# ============================================================================


# Authority variant names live in the shared variant_terms table (the JSONB
# columns were dropped from the authority models), so serializers must read
# them from there. Sentinel: "caller didn't supply variants, fetch them" —
# distinct from an explicit None/[] passed by a batching list endpoint.
_VARIANTS_UNLOADED = object()


def _variant_terms_map(db, entity_type: str, entity_ids: list) -> dict:
    """Batch-fetch variant terms for a set of authorities.

    Returns {entity_id: [term, ...]} ordered by display_order. Entities with
    no variants are absent from the map.
    """
    if not entity_ids:
        return {}
    from app.models import VariantTerm
    rows = (
        db.query(VariantTerm.entity_id, VariantTerm.term)
        .filter(
            VariantTerm.entity_type == entity_type,
            VariantTerm.entity_id.in_(entity_ids),
        )
        .order_by(VariantTerm.display_order, VariantTerm.created_at)
        .all()
    )
    result: dict = {}
    for entity_id, term in rows:
        result.setdefault(entity_id, []).append(term)
    return result


def _fetch_variants_for(instance, entity_type: str, entity_id) -> list[str] | None:
    """Single-record variant lookup via the instance's own session."""
    session = object_session(instance)
    if session is None:
        return None
    return _variant_terms_map(session, entity_type, [entity_id]).get(entity_id)


def _replace_variant_terms(db, organization_id, entity_type: str, entity_id, variants: list | None) -> None:
    """Replace an authority's variant terms wholesale (update semantics: the
    submitted list is the new complete set; None/[] clears them). Accepts
    dicts keyed by "name" or "term" (matching the create payload shapes) or
    plain strings."""
    from app.models import VariantTerm
    db.query(VariantTerm).filter(
        VariantTerm.organization_id == organization_id,
        VariantTerm.entity_type == entity_type,
        VariantTerm.entity_id == entity_id,
    ).delete()
    for idx, vt in enumerate(variants or []):
        if isinstance(vt, dict):
            term = vt.get("name") or vt.get("term") or ""
            term_type = vt.get("type")
            language = vt.get("language")
        else:
            term, term_type, language = str(vt), None, None
        if not term:
            continue
        db.add(VariantTerm(
            organization_id=organization_id,
            entity_type=entity_type, entity_id=entity_id,
            term=term, term_type=term_type, language=language,
            display_order=idx,
        ))


# ============================================================================
# PLACE AUTHORITY SERIALIZERS
# ============================================================================


def _serialize_place_authority(
    pa: PlaceAuthority,
    linked_objects_count: int | None = None,
    variant_names=_VARIANTS_UNLOADED,
) -> dict:
    """Serialize a PlaceAuthority to JSON.

    Pass variant_names from a _variant_terms_map batch in list endpoints;
    single-record callers can omit it (one lookup query per record).
    """
    if variant_names is _VARIANTS_UNLOADED:
        variant_names = _fetch_variants_for(pa, 'place_authority', pa.place_authority_id)
    result = {
        "place_authority_id": str(pa.place_authority_id),
        "organization_id": str(pa.organization_id),
        "preferred_name": pa.preferred_name,
        "variant_names": variant_names or None,
        "place_type": pa.place_type,
        "tgn_id": pa.tgn_id,
        "geonames_id": pa.geonames_id,
        "wikidata_id": pa.wikidata_id,
        "coordinates_lat": float(pa.coordinates_lat) if pa.coordinates_lat else None,
        "coordinates_lng": float(pa.coordinates_lng) if pa.coordinates_lng else None,
        "parent_place_id": str(pa.parent_place_id) if pa.parent_place_id else None,
        "hierarchy_path": pa.hierarchy_path,
        "country_code": pa.country_code,
        "notes": pa.notes,
        "status": pa.status,
        "created_at": pa.created_at.isoformat() if pa.created_at else None,
        "updated_at": pa.updated_at.isoformat() if pa.updated_at else None,
    }
    if linked_objects_count is not None:
        result["linked_objects_count"] = linked_objects_count
    return result


def _serialize_object_place_authority(opa: ObjectPlaceAuthority, include_place: bool = False) -> dict:
    """Serialize an ObjectPlaceAuthority link to JSON."""
    result = {
        "link_id": str(opa.link_id),
        "object_id": str(opa.object_id),
        "place_authority_id": str(opa.place_authority_id),
        "role": opa.role,
        "date_display": opa.date_display,
        "date_earliest": opa.date_earliest.isoformat() if opa.date_earliest else None,
        "date_latest": opa.date_latest.isoformat() if opa.date_latest else None,
        "notes": opa.notes,
        "display_order": opa.display_order,
        "created_at": opa.created_at.isoformat() if opa.created_at else None,
    }
    if include_place and opa.place_authority:
        result["place_authority"] = _serialize_place_authority(opa.place_authority)
    return result


# ============================================================================
# STYLE/PERIOD AUTHORITY SERIALIZERS
# ============================================================================


def _serialize_style_period_authority(
    spa: StylePeriodAuthority,
    linked_objects_count: int | None = None,
    variant_terms=_VARIANTS_UNLOADED,
) -> dict:
    """Serialize a StylePeriodAuthority to JSON."""
    if variant_terms is _VARIANTS_UNLOADED:
        variant_terms = _fetch_variants_for(spa, 'style_period_authority', spa.authority_id)
    result = {
        "authority_id": str(spa.authority_id),
        "organization_id": str(spa.organization_id),
        "preferred_term": spa.preferred_term,
        "variant_terms": variant_terms or None,
        "authority_type": spa.authority_type,
        "aat_id": spa.aat_id,
        "wikidata_id": spa.wikidata_id,
        "culture": spa.culture,
        "date_display": spa.date_display,
        "date_earliest": spa.date_earliest.isoformat() if spa.date_earliest else None,
        "date_latest": spa.date_latest.isoformat() if spa.date_latest else None,
        "geographic_scope": spa.geographic_scope,
        "parent_authority_id": str(spa.parent_authority_id) if spa.parent_authority_id else None,
        "description": spa.description,
        "notes": spa.notes,
        "status": spa.status,
        "created_at": spa.created_at.isoformat() if spa.created_at else None,
        "updated_at": spa.updated_at.isoformat() if spa.updated_at else None,
    }
    if linked_objects_count is not None:
        result["linked_objects_count"] = linked_objects_count
    return result


def _serialize_object_style_period(osp: ObjectStylePeriod, include_authority: bool = False) -> dict:
    """Serialize an ObjectStylePeriod link to JSON."""
    result = {
        "link_id": str(osp.link_id),
        "object_id": str(osp.object_id),
        "authority_id": str(osp.authority_id),
        "assignment_certainty": osp.assignment_certainty,
        "assignment_note": osp.assignment_note,
        "display_order": osp.display_order,
        "created_at": osp.created_at.isoformat() if osp.created_at else None,
    }
    if include_authority and osp.authority:
        result["authority"] = _serialize_style_period_authority(osp.authority)
    return result


# ============================================================================
# SUBJECT AUTHORITY SERIALIZERS
# ============================================================================


def _serialize_subject_authority(
    sa: SubjectAuthority,
    linked_objects_count: int | None = None,
    variant_terms=_VARIANTS_UNLOADED,
) -> dict:
    """Serialize a SubjectAuthority to JSON."""
    if variant_terms is _VARIANTS_UNLOADED:
        variant_terms = _fetch_variants_for(sa, 'subject_authority', sa.authority_id)
    result = {
        "authority_id": str(sa.authority_id),
        "organization_id": str(sa.organization_id),
        "preferred_term": sa.preferred_term,
        "variant_terms": variant_terms or None,
        "subject_type": sa.subject_type,
        "aat_id": sa.aat_id,
        "iconclass_id": sa.iconclass_id,
        "wikidata_id": sa.wikidata_id,
        "broader_subject_id": str(sa.broader_subject_id) if sa.broader_subject_id else None,
        "description": sa.description,
        "notes": sa.notes,
        "status": sa.status,
        "created_at": sa.created_at.isoformat() if sa.created_at else None,
        "updated_at": sa.updated_at.isoformat() if sa.updated_at else None,
    }
    if linked_objects_count is not None:
        result["linked_objects_count"] = linked_objects_count
    return result


def _serialize_object_subject(os_link: ObjectSubject, include_authority: bool = False) -> dict:
    """Serialize an ObjectSubject link to JSON."""
    result = {
        "link_id": str(os_link.link_id),
        "object_id": str(os_link.object_id),
        "subject_authority_id": str(os_link.subject_authority_id),
        "subject_extent": os_link.subject_extent,
        "interpretation_note": os_link.interpretation_note,
        "display_order": os_link.display_order,
        "created_at": os_link.created_at.isoformat() if os_link.created_at else None,
    }
    if include_authority and os_link.subject_authority:
        result["subject_authority"] = _serialize_subject_authority(os_link.subject_authority)
    return result


# ============================================================================
# PLACE AUTHORITIES ENDPOINTS (CDWA 29)
# ============================================================================


@router.get("/api/organizations/{organization_id}/collections/place-authorities", response_model=PlaceAuthorityListResponse, summary="List place authorities")
def list_place_authorities(
    organization_id: str,
    search: str | None = Query(None),
    place_type: str | None = Query(None),
    status: str | None = Query(None),
    limit: int = Query(50, le=500),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.PLACE_AUTHORITIES_VIEW)),
    db: Session = Depends(get_db),
):
    """List place authorities with filtering and search."""
    org_uuid = parse_uuid_or_raise(organization_id, "organization_id")

    linked_count_subq = (
        db.query(
            ObjectPlaceAuthority.place_authority_id,
            func.count(ObjectPlaceAuthority.link_id).label("linked_count"),
        )
        .group_by(ObjectPlaceAuthority.place_authority_id)
        .subquery()
    )

    query = db.query(
        PlaceAuthority,
        func.coalesce(linked_count_subq.c.linked_count, 0).label("linked_objects_count"),
    ).outerjoin(
        linked_count_subq,
        PlaceAuthority.place_authority_id == linked_count_subq.c.place_authority_id,
    ).filter(
        PlaceAuthority.organization_id == org_uuid,
    )

    if search:
        search_term = f"%{escape_ilike(search)}%"
        query = query.filter(
            or_(
                PlaceAuthority.preferred_name.ilike(search_term, escape="\\"),
                PlaceAuthority.country_code.ilike(search_term, escape="\\"),
            )
        )

    if place_type:
        query = query.filter(PlaceAuthority.place_type == place_type)

    if status:
        query = query.filter(PlaceAuthority.status == status)

    total = query.count()
    results = query.order_by(PlaceAuthority.preferred_name).offset(offset).limit(limit).all()

    variants_by_id = _variant_terms_map(
        db, 'place_authority', [pa.place_authority_id for pa, _ in results]
    )
    return {
        "items": [
            _serialize_place_authority(
                pa,
                linked_objects_count=count,
                variant_names=variants_by_id.get(pa.place_authority_id),
            )
            for pa, count in results
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("/api/organizations/{organization_id}/collections/place-authorities", status_code=201, response_model=PlaceAuthorityOut, summary="Create place authority")
def create_place_authority(
    organization_id: str,
    body: CreatePlaceAuthorityRequest,
    auth: AuthContext = Depends(require_permission(Permission.PLACE_AUTHORITIES_CREATE)),
    db: Session = Depends(get_db),
):
    """Create a new place authority record."""
    org_uuid = parse_uuid_or_raise(organization_id, "organization_id")

    pa = PlaceAuthority(
        organization_id=org_uuid,
        preferred_name=body.preferred_name,
        place_type=body.place_type,
        tgn_id=body.tgn_id,
        geonames_id=body.geonames_id,
        wikidata_id=body.wikidata_id,
        coordinates_lat=body.coordinates_lat,
        coordinates_lng=body.coordinates_lng,
        parent_place_id=body.parent_place_id,
        hierarchy_path=body.hierarchy_path,
        country_code=body.country_code,
        notes=body.notes,
        status=body.status,
        created_by=auth.user_id,
        updated_by=auth.user_id,
    )
    # Maps (geo/collection-origins) read the PostGIS geom column, not the
    # decimal lat/lng pair — keep them in sync or the place never plots.
    if body.coordinates_lat is not None and body.coordinates_lng is not None:
        from app.services.gis_service import create_point
        pa.geom = create_point(float(body.coordinates_lat), float(body.coordinates_lng))

    try:
        db.add(pa)
        db.flush()
    except IntegrityError as e:
        logger.error(f"PlaceAuthority IntegrityError: {e}")
        db.rollback()
        # Try to find the existing record by TGN ID or name
        existing = None
        if body.tgn_id:
            existing = db.execute(
                select(PlaceAuthority).where(
                    PlaceAuthority.organization_id == org_uuid,
                    PlaceAuthority.tgn_id == body.tgn_id,
                )
            ).scalar_one_or_none()
        if not existing and body.preferred_name:
            existing = db.execute(
                select(PlaceAuthority).where(
                    PlaceAuthority.organization_id == org_uuid,
                    PlaceAuthority.preferred_name == body.preferred_name,
                )
            ).scalar_one_or_none()
        if existing:
            return _serialize_place_authority(existing)
        raise HTTPException(status_code=409, detail="A similar place authority may already exist")

    from app.models import VariantTerm
    for idx, vn in enumerate(body.variant_names or []):
        db.add(VariantTerm(
            organization_id=pa.organization_id,
            entity_type='place_authority', entity_id=pa.place_authority_id,
            term=vn.get("name", vn.get("term", "")),
            term_type=vn.get("type"), language=vn.get("language"),
            display_order=idx,
        ))

    db.commit()

    # No coordinates supplied: geocode by name in the background so the place
    # can appear on maps. Best-effort — a dead broker or missing GeoNames
    # account must not fail the create.
    if pa.geom is None:
        try:
            from app.tasks.geo import geocode_place_authority_task
            geocode_place_authority_task.delay(str(pa.place_authority_id))
        except Exception:  # noqa: BLE001
            logger.warning(
                "could not enqueue geocode task for place authority %s",
                pa.place_authority_id,
            )

    return _serialize_place_authority(pa)


@router.get("/api/organizations/{organization_id}/collections/place-authorities/{place_id}", response_model=PlaceAuthorityOut, summary="Get place authority")
def get_place_authority(
    organization_id: str,
    place_id: str,
    auth: AuthContext = Depends(require_permission(Permission.PLACE_AUTHORITIES_VIEW)),
    db: Session = Depends(get_db),
):
    """Get a place authority by ID."""
    org_uuid = parse_uuid_or_raise(organization_id, "organization_id")
    place_uuid = parse_uuid_or_raise(place_id, "place_id")

    pa = db.query(PlaceAuthority).filter(
        PlaceAuthority.place_authority_id == place_uuid,
        PlaceAuthority.organization_id == org_uuid,
    ).first()

    if not pa:
        raise HTTPException(status_code=404, detail="Place authority not found")

    serialized = _serialize_place_authority(pa)
    return apply_field_access(serialized, 'place_authority', organization_id, str(auth.user_id), session=db, role_override=auth.role_override)


@router.put("/api/organizations/{organization_id}/collections/place-authorities/{place_id}", response_model=PlaceAuthorityOut, summary="Update place authority")
def update_place_authority(
    organization_id: str,
    place_id: str,
    body: UpdatePlaceAuthorityRequest,
    auth: AuthContext = Depends(require_permission(Permission.PLACE_AUTHORITIES_EDIT)),
    db: Session = Depends(get_db),
):
    """Update a place authority."""
    org_uuid = parse_uuid_or_raise(organization_id, "organization_id")
    place_uuid = parse_uuid_or_raise(place_id, "place_id")

    pa = db.query(PlaceAuthority).filter(
        PlaceAuthority.place_authority_id == place_uuid,
        PlaceAuthority.organization_id == org_uuid,
    ).first()

    if not pa:
        raise HTTPException(status_code=404, detail="Place authority not found")

    protected_fields = {"place_authority_id", "organization_id", "created_at", "created_by", "updated_by"}
    protected_fields |= get_write_restricted_fields('place_authority', organization_id, str(auth.user_id), session=db)
    updates = body.model_dump(exclude_unset=True)
    # Variant names live in the variant_terms table, not on the model — pull
    # them out of the setattr loop and replace the rows wholesale.
    replace_variants = "variant_names" in updates and "variant_names" not in protected_fields
    variant_names = updates.pop("variant_names", None)
    for key, value in updates.items():
        if hasattr(pa, key) and key not in protected_fields:
            setattr(pa, key, value)
    if replace_variants:
        _replace_variant_terms(db, pa.organization_id, 'place_authority', pa.place_authority_id, variant_names)

    # Keep the PostGIS geom in sync when the decimal coordinates change (maps
    # read geom, not lat/lng).
    if "coordinates_lat" in updates or "coordinates_lng" in updates:
        if pa.coordinates_lat is not None and pa.coordinates_lng is not None:
            from app.services.gis_service import create_point
            pa.geom = create_point(float(pa.coordinates_lat), float(pa.coordinates_lng))
        else:
            pa.geom = None

    pa.updated_by = auth.user_id
    pa.updated_at = datetime.now(timezone.utc)

    db.commit()
    return _serialize_place_authority(pa)


@router.delete("/api/organizations/{organization_id}/collections/place-authorities/{place_id}", response_model=TaxonomyDeleteResponse, summary="Delete place authority")
def delete_place_authority(
    organization_id: str,
    place_id: str,
    auth: AuthContext = Depends(require_permission(Permission.PLACE_AUTHORITIES_DELETE)),
    db: Session = Depends(get_db),
):
    """Delete a place authority."""
    org_uuid = parse_uuid_or_raise(organization_id, "organization_id")
    place_uuid = parse_uuid_or_raise(place_id, "place_id")

    pa = db.query(PlaceAuthority).filter(
        PlaceAuthority.place_authority_id == place_uuid,
        PlaceAuthority.organization_id == org_uuid,
    ).first()

    if not pa:
        raise HTTPException(status_code=404, detail="Place authority not found")

    linked_count = db.query(ObjectPlaceAuthority).filter(
        ObjectPlaceAuthority.place_authority_id == place_uuid,
    ).count()

    if linked_count > 0:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete: authority is linked to {linked_count} object(s)",
        )

    # variant_terms rows are polymorphic (no FK) — clean them up explicitly.
    _replace_variant_terms(db, pa.organization_id, 'place_authority', pa.place_authority_id, None)
    db.delete(pa)
    db.commit()

    return {"success": True, "message": "Place authority deleted successfully"}


@router.get("/api/organizations/{organization_id}/collections/objects/{object_id}/place-authorities", response_model=ObjectPlaceAuthorityListResponse, summary="List object place authorities")
def list_object_place_authorities(
    organization_id: str,
    object_id: str,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """List place authorities linked to an object."""
    org_uuid = parse_uuid_or_raise(organization_id, "organization_id")
    object_uuid = parse_uuid_or_raise(object_id, "object_id")

    links = db.query(ObjectPlaceAuthority).options(
        joinedload(ObjectPlaceAuthority.place_authority),
    ).filter(
        ObjectPlaceAuthority.object_id == object_uuid,
        ObjectPlaceAuthority.organization_id == org_uuid,
    ).order_by(ObjectPlaceAuthority.display_order).all()

    return {
        "place_authorities": [_serialize_object_place_authority(link, include_place=True) for link in links],
    }


@router.post("/api/organizations/{organization_id}/collections/objects/{object_id}/place-authorities", status_code=201, response_model=ObjectPlaceAuthorityLinkOut, summary="Link object place authority")
def link_object_place_authority(
    organization_id: str,
    object_id: str,
    body: CreateObjectPlaceAuthorityLinkRequest,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Link a place authority to an object."""
    org_uuid = parse_uuid_or_raise(organization_id, "organization_id")
    object_uuid = parse_uuid_or_raise(object_id, "object_id")

    link = ObjectPlaceAuthority(
        organization_id=org_uuid,
        object_id=object_uuid,
        place_authority_id=body.place_authority_id,
        role=body.role,
        date_display=body.date_display,
        date_earliest=body.date_earliest,
        date_latest=body.date_latest,
        notes=body.notes,
        display_order=body.display_order,
        created_by=auth.user_id,
    )

    try:
        db.add(link)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Link may already exist or invalid reference")

    return _serialize_object_place_authority(link)


@router.delete("/api/organizations/{organization_id}/collections/objects/{object_id}/place-authorities/{link_id}", response_model=TaxonomyDeleteResponse, summary="Unlink object place authority")
def unlink_object_place_authority(
    organization_id: str,
    object_id: str,
    link_id: str,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Remove a place authority link from an object."""
    org_uuid = parse_uuid_or_raise(organization_id, "organization_id")
    link_uuid = parse_uuid_or_raise(link_id, "link_id")

    link = db.query(ObjectPlaceAuthority).filter(
        ObjectPlaceAuthority.link_id == link_uuid,
        ObjectPlaceAuthority.organization_id == org_uuid,
    ).first()

    if not link:
        raise HTTPException(status_code=404, detail="Link not found")

    db.delete(link)
    db.commit()

    return {"success": True, "message": "Link removed successfully"}


# ============================================================================
# STYLE/PERIOD AUTHORITIES ENDPOINTS (CDWA 5)
# ============================================================================


@router.get("/api/organizations/{organization_id}/collections/style-period-authorities", response_model=StylePeriodAuthorityListResponse, summary="List style period authorities")
def list_style_period_authorities(
    organization_id: str,
    search: str | None = Query(None),
    authority_type: str | None = Query(None),
    status: str | None = Query(None),
    limit: int = Query(50, le=500),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.STYLE_PERIOD_AUTHORITIES_VIEW)),
    db: Session = Depends(get_db),
):
    """List style/period authorities with filtering and search."""
    org_uuid = parse_uuid_or_raise(organization_id, "organization_id")

    linked_count_subq = (
        db.query(
            ObjectStylePeriod.authority_id,
            func.count(ObjectStylePeriod.link_id).label("linked_count"),
        )
        .group_by(ObjectStylePeriod.authority_id)
        .subquery()
    )

    query = db.query(
        StylePeriodAuthority,
        func.coalesce(linked_count_subq.c.linked_count, 0).label("linked_objects_count"),
    ).outerjoin(
        linked_count_subq,
        StylePeriodAuthority.authority_id == linked_count_subq.c.authority_id,
    ).filter(
        StylePeriodAuthority.organization_id == org_uuid,
    )

    if search:
        search_term = f"%{escape_ilike(search)}%"
        query = query.filter(
            or_(
                StylePeriodAuthority.preferred_term.ilike(search_term, escape="\\"),
                StylePeriodAuthority.culture.ilike(search_term, escape="\\"),
            )
        )

    if authority_type:
        query = query.filter(StylePeriodAuthority.authority_type == authority_type)

    if status:
        query = query.filter(StylePeriodAuthority.status == status)

    total = query.count()
    results = query.order_by(StylePeriodAuthority.preferred_term).offset(offset).limit(limit).all()

    variants_by_id = _variant_terms_map(
        db, 'style_period_authority', [spa.authority_id for spa, _ in results]
    )
    return {
        "items": [
            _serialize_style_period_authority(
                spa,
                linked_objects_count=count,
                variant_terms=variants_by_id.get(spa.authority_id),
            )
            for spa, count in results
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("/api/organizations/{organization_id}/collections/style-period-authorities", status_code=201, response_model=StylePeriodAuthorityOut, summary="Create style period authority")
def create_style_period_authority(
    organization_id: str,
    body: CreateStylePeriodAuthorityRequest,
    auth: AuthContext = Depends(require_permission(Permission.STYLE_PERIOD_AUTHORITIES_CREATE)),
    db: Session = Depends(get_db),
):
    """Create a new style/period authority record."""
    org_uuid = parse_uuid_or_raise(organization_id, "organization_id")

    spa = StylePeriodAuthority(
        organization_id=org_uuid,
        preferred_term=body.preferred_term,
        authority_type=body.authority_type,
        aat_id=body.aat_id,
        wikidata_id=body.wikidata_id,
        culture=body.culture,
        date_display=body.date_display,
        date_earliest=body.date_earliest,
        date_latest=body.date_latest,
        geographic_scope=body.geographic_scope,
        parent_authority_id=body.parent_authority_id,
        description=body.description,
        notes=body.notes,
        status=body.status,
        created_by=auth.user_id,
        updated_by=auth.user_id,
    )

    try:
        db.add(spa)
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A similar authority may already exist")

    from app.models import VariantTerm
    for idx, vt in enumerate(body.variant_terms or []):
        db.add(VariantTerm(
            organization_id=spa.organization_id,
            entity_type='style_period_authority', entity_id=spa.authority_id,
            term=vt.get("term", ""),
            language=vt.get("language"),
            display_order=idx,
        ))

    db.commit()
    return _serialize_style_period_authority(spa)


@router.get("/api/organizations/{organization_id}/collections/style-period-authorities/{authority_id}", response_model=StylePeriodAuthorityOut, summary="Get style period authority")
def get_style_period_authority(
    organization_id: str,
    authority_id: str,
    auth: AuthContext = Depends(require_permission(Permission.STYLE_PERIOD_AUTHORITIES_VIEW)),
    db: Session = Depends(get_db),
):
    """Get a style/period authority by ID."""
    org_uuid = parse_uuid_or_raise(organization_id, "organization_id")
    authority_uuid = parse_uuid_or_raise(authority_id, "authority_id")

    spa = db.query(StylePeriodAuthority).filter(
        StylePeriodAuthority.authority_id == authority_uuid,
        StylePeriodAuthority.organization_id == org_uuid,
    ).first()

    if not spa:
        raise HTTPException(status_code=404, detail="Style/period authority not found")

    serialized = _serialize_style_period_authority(spa)
    return apply_field_access(serialized, 'style_period_authority', organization_id, str(auth.user_id), session=db, role_override=auth.role_override)


@router.put("/api/organizations/{organization_id}/collections/style-period-authorities/{authority_id}", response_model=StylePeriodAuthorityOut, summary="Update style period authority")
def update_style_period_authority(
    organization_id: str,
    authority_id: str,
    body: UpdateStylePeriodAuthorityRequest,
    auth: AuthContext = Depends(require_permission(Permission.STYLE_PERIOD_AUTHORITIES_EDIT)),
    db: Session = Depends(get_db),
):
    """Update a style/period authority."""
    org_uuid = parse_uuid_or_raise(organization_id, "organization_id")
    authority_uuid = parse_uuid_or_raise(authority_id, "authority_id")

    spa = db.query(StylePeriodAuthority).filter(
        StylePeriodAuthority.authority_id == authority_uuid,
        StylePeriodAuthority.organization_id == org_uuid,
    ).first()

    if not spa:
        raise HTTPException(status_code=404, detail="Style/period authority not found")

    protected_fields = {"authority_id", "organization_id", "created_at", "created_by", "updated_by"}
    protected_fields |= get_write_restricted_fields('style_period_authority', organization_id, str(auth.user_id), session=db)
    updates = body.model_dump(exclude_unset=True)
    replace_variants = "variant_terms" in updates and "variant_terms" not in protected_fields
    variant_terms = updates.pop("variant_terms", None)
    for key, value in updates.items():
        if hasattr(spa, key) and key not in protected_fields:
            setattr(spa, key, value)
    if replace_variants:
        _replace_variant_terms(db, spa.organization_id, 'style_period_authority', spa.authority_id, variant_terms)

    spa.updated_by = auth.user_id
    spa.updated_at = datetime.now(timezone.utc)

    db.commit()
    return _serialize_style_period_authority(spa)


@router.delete("/api/organizations/{organization_id}/collections/style-period-authorities/{authority_id}", response_model=TaxonomyDeleteResponse, summary="Delete style period authority")
def delete_style_period_authority(
    organization_id: str,
    authority_id: str,
    auth: AuthContext = Depends(require_permission(Permission.STYLE_PERIOD_AUTHORITIES_DELETE)),
    db: Session = Depends(get_db),
):
    """Delete a style/period authority."""
    org_uuid = parse_uuid_or_raise(organization_id, "organization_id")
    authority_uuid = parse_uuid_or_raise(authority_id, "authority_id")

    spa = db.query(StylePeriodAuthority).filter(
        StylePeriodAuthority.authority_id == authority_uuid,
        StylePeriodAuthority.organization_id == org_uuid,
    ).first()

    if not spa:
        raise HTTPException(status_code=404, detail="Style/period authority not found")

    linked_count = db.query(ObjectStylePeriod).filter(
        ObjectStylePeriod.authority_id == authority_uuid,
    ).count()

    if linked_count > 0:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete: authority is linked to {linked_count} object(s)",
        )

    _replace_variant_terms(db, spa.organization_id, 'style_period_authority', spa.authority_id, None)
    db.delete(spa)
    db.commit()

    return {"success": True, "message": "Style/period authority deleted successfully"}


@router.get("/api/organizations/{organization_id}/collections/objects/{object_id}/style-periods", response_model=ObjectStylePeriodListResponse, summary="List object style periods")
def list_object_style_periods(
    organization_id: str,
    object_id: str,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """List style/period authorities linked to an object."""
    org_uuid = parse_uuid_or_raise(organization_id, "organization_id")
    object_uuid = parse_uuid_or_raise(object_id, "object_id")

    links = db.query(ObjectStylePeriod).options(
        joinedload(ObjectStylePeriod.authority),
    ).filter(
        ObjectStylePeriod.object_id == object_uuid,
        ObjectStylePeriod.organization_id == org_uuid,
    ).order_by(ObjectStylePeriod.display_order).all()

    return {
        "style_periods": [_serialize_object_style_period(link, include_authority=True) for link in links],
    }


@router.post("/api/organizations/{organization_id}/collections/objects/{object_id}/style-periods", status_code=201, response_model=ObjectStylePeriodLinkOut, summary="Link object style period")
def link_object_style_period(
    organization_id: str,
    object_id: str,
    body: CreateObjectStylePeriodLinkRequest,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Link a style/period authority to an object."""
    org_uuid = parse_uuid_or_raise(organization_id, "organization_id")
    object_uuid = parse_uuid_or_raise(object_id, "object_id")

    link = ObjectStylePeriod(
        organization_id=org_uuid,
        object_id=object_uuid,
        authority_id=body.authority_id,
        assignment_certainty=body.assignment_certainty,
        assignment_note=body.assignment_note,
        display_order=body.display_order,
        created_by=auth.user_id,
    )

    try:
        db.add(link)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Link may already exist or invalid reference")

    return _serialize_object_style_period(link)


@router.delete("/api/organizations/{organization_id}/collections/objects/{object_id}/style-periods/{link_id}", response_model=TaxonomyDeleteResponse, summary="Unlink object style period")
def unlink_object_style_period(
    organization_id: str,
    object_id: str,
    link_id: str,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Remove a style/period link from an object."""
    org_uuid = parse_uuid_or_raise(organization_id, "organization_id")
    link_uuid = parse_uuid_or_raise(link_id, "link_id")

    link = db.query(ObjectStylePeriod).filter(
        ObjectStylePeriod.link_id == link_uuid,
        ObjectStylePeriod.organization_id == org_uuid,
    ).first()

    if not link:
        raise HTTPException(status_code=404, detail="Link not found")

    db.delete(link)
    db.commit()

    return {"success": True, "message": "Link removed successfully"}


# ============================================================================
# SUBJECT AUTHORITIES ENDPOINTS (CDWA 31)
# ============================================================================


@router.get("/api/organizations/{organization_id}/collections/subject-authorities", response_model=SubjectAuthorityListResponse, summary="List subject authorities")
def list_subject_authorities(
    organization_id: str,
    search: str | None = Query(None),
    subject_type: str | None = Query(None),
    status: str | None = Query(None),
    limit: int = Query(50, le=500),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.SUBJECT_AUTHORITIES_VIEW)),
    db: Session = Depends(get_db),
):
    """List subject authorities with filtering and search."""
    org_uuid = parse_uuid_or_raise(organization_id, "organization_id")

    linked_count_subq = (
        db.query(
            ObjectSubject.subject_authority_id,
            func.count(ObjectSubject.link_id).label("linked_count"),
        )
        .group_by(ObjectSubject.subject_authority_id)
        .subquery()
    )

    query = db.query(
        SubjectAuthority,
        func.coalesce(linked_count_subq.c.linked_count, 0).label("linked_objects_count"),
    ).outerjoin(
        linked_count_subq,
        SubjectAuthority.authority_id == linked_count_subq.c.subject_authority_id,
    ).filter(
        SubjectAuthority.organization_id == org_uuid,
    )

    if search:
        search_term = f"%{escape_ilike(search)}%"
        query = query.filter(
            SubjectAuthority.preferred_term.ilike(search_term, escape="\\"),
        )

    if subject_type:
        query = query.filter(SubjectAuthority.subject_type == subject_type)

    if status:
        query = query.filter(SubjectAuthority.status == status)

    total = query.count()
    results = query.order_by(SubjectAuthority.preferred_term).offset(offset).limit(limit).all()

    variants_by_id = _variant_terms_map(
        db, 'subject_authority', [sa.authority_id for sa, _ in results]
    )
    return {
        "items": [
            _serialize_subject_authority(
                sa,
                linked_objects_count=count,
                variant_terms=variants_by_id.get(sa.authority_id),
            )
            for sa, count in results
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("/api/organizations/{organization_id}/collections/subject-authorities", status_code=201, response_model=SubjectAuthorityOut, summary="Create subject authority")
def create_subject_authority(
    organization_id: str,
    body: CreateSubjectAuthorityRequest,
    auth: AuthContext = Depends(require_permission(Permission.SUBJECT_AUTHORITIES_CREATE)),
    db: Session = Depends(get_db),
):
    """Create a new subject authority record."""
    org_uuid = parse_uuid_or_raise(organization_id, "organization_id")

    sa = SubjectAuthority(
        organization_id=org_uuid,
        preferred_term=body.preferred_term,
        subject_type=body.subject_type,
        aat_id=body.aat_id,
        iconclass_id=body.iconclass_id,
        wikidata_id=body.wikidata_id,
        broader_subject_id=body.broader_subject_id,
        description=body.description,
        notes=body.notes,
        status=body.status,
        created_by=auth.user_id,
        updated_by=auth.user_id,
    )

    try:
        db.add(sa)
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A similar authority may already exist")

    from app.models import VariantTerm
    for idx, vt in enumerate(body.variant_terms or []):
        db.add(VariantTerm(
            organization_id=sa.organization_id,
            entity_type='subject_authority', entity_id=sa.authority_id,
            term=vt.get("term", ""),
            language=vt.get("language"),
            display_order=idx,
        ))

    db.commit()
    return _serialize_subject_authority(sa)


@router.get("/api/organizations/{organization_id}/collections/subject-authorities/{authority_id}", response_model=SubjectAuthorityOut, summary="Get subject authority")
def get_subject_authority(
    organization_id: str,
    authority_id: str,
    auth: AuthContext = Depends(require_permission(Permission.SUBJECT_AUTHORITIES_VIEW)),
    db: Session = Depends(get_db),
):
    """Get a subject authority by ID."""
    org_uuid = parse_uuid_or_raise(organization_id, "organization_id")
    authority_uuid = parse_uuid_or_raise(authority_id, "authority_id")

    sa = db.query(SubjectAuthority).filter(
        SubjectAuthority.authority_id == authority_uuid,
        SubjectAuthority.organization_id == org_uuid,
    ).first()

    if not sa:
        raise HTTPException(status_code=404, detail="Subject authority not found")

    serialized = _serialize_subject_authority(sa)
    return apply_field_access(serialized, 'subject_authority', organization_id, str(auth.user_id), session=db, role_override=auth.role_override)


@router.put("/api/organizations/{organization_id}/collections/subject-authorities/{authority_id}", response_model=SubjectAuthorityOut, summary="Update subject authority")
def update_subject_authority(
    organization_id: str,
    authority_id: str,
    body: UpdateSubjectAuthorityRequest,
    auth: AuthContext = Depends(require_permission(Permission.SUBJECT_AUTHORITIES_EDIT)),
    db: Session = Depends(get_db),
):
    """Update a subject authority."""
    org_uuid = parse_uuid_or_raise(organization_id, "organization_id")
    authority_uuid = parse_uuid_or_raise(authority_id, "authority_id")

    sa = db.query(SubjectAuthority).filter(
        SubjectAuthority.authority_id == authority_uuid,
        SubjectAuthority.organization_id == org_uuid,
    ).first()

    if not sa:
        raise HTTPException(status_code=404, detail="Subject authority not found")

    protected_fields = {"authority_id", "organization_id", "created_at", "created_by", "updated_by"}
    protected_fields |= get_write_restricted_fields('subject_authority', organization_id, str(auth.user_id), session=db)
    updates = body.model_dump(exclude_unset=True)
    replace_variants = "variant_terms" in updates and "variant_terms" not in protected_fields
    variant_terms = updates.pop("variant_terms", None)
    for key, value in updates.items():
        if hasattr(sa, key) and key not in protected_fields:
            setattr(sa, key, value)
    if replace_variants:
        _replace_variant_terms(db, sa.organization_id, 'subject_authority', sa.authority_id, variant_terms)

    sa.updated_by = auth.user_id
    sa.updated_at = datetime.now(timezone.utc)

    db.commit()
    return _serialize_subject_authority(sa)


@router.delete("/api/organizations/{organization_id}/collections/subject-authorities/{authority_id}", response_model=TaxonomyDeleteResponse, summary="Delete subject authority")
def delete_subject_authority(
    organization_id: str,
    authority_id: str,
    auth: AuthContext = Depends(require_permission(Permission.SUBJECT_AUTHORITIES_DELETE)),
    db: Session = Depends(get_db),
):
    """Delete a subject authority."""
    org_uuid = parse_uuid_or_raise(organization_id, "organization_id")
    authority_uuid = parse_uuid_or_raise(authority_id, "authority_id")

    sa = db.query(SubjectAuthority).filter(
        SubjectAuthority.authority_id == authority_uuid,
        SubjectAuthority.organization_id == org_uuid,
    ).first()

    if not sa:
        raise HTTPException(status_code=404, detail="Subject authority not found")

    linked_count = db.query(ObjectSubject).filter(
        ObjectSubject.subject_authority_id == authority_uuid,
    ).count()

    if linked_count > 0:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete: authority is linked to {linked_count} object(s)",
        )

    _replace_variant_terms(db, sa.organization_id, 'subject_authority', sa.authority_id, None)
    db.delete(sa)
    db.commit()

    return {"success": True, "message": "Subject authority deleted successfully"}


@router.get("/api/organizations/{organization_id}/collections/objects/{object_id}/subjects", response_model=ObjectSubjectListResponse, summary="List object subjects")
def list_object_subjects(
    organization_id: str,
    object_id: str,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """List subject authorities linked to an object."""
    org_uuid = parse_uuid_or_raise(organization_id, "organization_id")
    object_uuid = parse_uuid_or_raise(object_id, "object_id")

    links = db.query(ObjectSubject).options(
        joinedload(ObjectSubject.subject_authority),
    ).filter(
        ObjectSubject.object_id == object_uuid,
        ObjectSubject.organization_id == org_uuid,
    ).order_by(ObjectSubject.display_order).all()

    return {
        "subjects": [_serialize_object_subject(link, include_authority=True) for link in links],
    }


@router.post("/api/organizations/{organization_id}/collections/objects/{object_id}/subjects", status_code=201, response_model=ObjectSubjectLinkOut, summary="Link object subject")
def link_object_subject(
    organization_id: str,
    object_id: str,
    body: CreateObjectSubjectLinkRequest,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Link a subject authority to an object."""
    org_uuid = parse_uuid_or_raise(organization_id, "organization_id")
    object_uuid = parse_uuid_or_raise(object_id, "object_id")

    link = ObjectSubject(
        organization_id=org_uuid,
        object_id=object_uuid,
        subject_authority_id=body.subject_authority_id,
        subject_extent=body.subject_extent,
        interpretation_note=body.interpretation_note,
        display_order=body.display_order,
        created_by=auth.user_id,
    )

    try:
        db.add(link)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Link may already exist or invalid reference")

    return _serialize_object_subject(link)


@router.delete("/api/organizations/{organization_id}/collections/objects/{object_id}/subjects/{link_id}", response_model=TaxonomyDeleteResponse, summary="Unlink object subject")
def unlink_object_subject(
    organization_id: str,
    object_id: str,
    link_id: str,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Remove a subject link from an object."""
    org_uuid = parse_uuid_or_raise(organization_id, "organization_id")
    link_uuid = parse_uuid_or_raise(link_id, "link_id")

    link = db.query(ObjectSubject).filter(
        ObjectSubject.link_id == link_uuid,
        ObjectSubject.organization_id == org_uuid,
    ).first()

    if not link:
        raise HTTPException(status_code=404, detail="Link not found")

    db.delete(link)
    db.commit()

    return {"success": True, "message": "Link removed successfully"}
