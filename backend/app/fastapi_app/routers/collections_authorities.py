"""
Person Authorities API endpoints (FastAPI).

Provides CRUD for person authority records (Constituents), inter-authority relations,
and object-person authority links (CDWA Category 28).
Migrated from app/api/collections_cdwa_procedure.py (Domain 1).

Model mapping (API names → actual models):
  PersonAuthority → Constituent (constituent_id, name)
  ObjectPersonAuthority → ConstituentXref (xref_id, constituent_id, entity_type/entity_id)
  PersonAuthorityRelation → ConstituentRelation (from_constituent_id, to_constituent_id)
"""

import logging
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.models import (
    PersonAuthority,
    PersonAuthorityRelation,
    ObjectPersonAuthority,
    CollectionObject,
)
from app.permissions import Permission
from app.services.api_security import escape_ilike
from app.services.field_access_service import apply_field_access, get_write_restricted_fields
from app.services.validation_utils import parse_uuid_or_raise
from app.fastapi_app.schemas.collections_authorities import (
    CreatePersonAuthorityRequest,
    UpdatePersonAuthorityRequest,
    MergePersonAuthorityRequest,
    CreateAuthorityRelationRequest,
    CreateObjectPersonAuthorityLinkRequest,
    UpdateObjectPersonAuthorityLinkRequest,
    PersonAuthorityOut,
    PersonAuthorityListResponse,
    PersonAuthorityDeleteResponse,
    PersonAuthorityMergeResponse,
    PersonAuthorityRelationOut,
    AuthorityRelationsResponse,
    ObjectPersonAuthorityLinkOut,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["collections-authorities"])

# Actual model is Constituent; aliases: PersonAuthority, ObjectPersonAuthority (ConstituentXref),
# PersonAuthorityRelation (ConstituentRelation)


# ============================================================================
# NORMALIZERS
# ============================================================================


def _normalize_variant_names(variant_names: list | None) -> list[str] | None:
    """Convert variant_names to simple string array for API responses."""
    if not variant_names:
        return None
    result = []
    for item in variant_names:
        if isinstance(item, dict):
            result.append(item.get("name", ""))
        elif isinstance(item, str):
            result.append(item)
    return result if result else None


def _normalize_life_roles(life_roles: list | None) -> list[str] | None:
    """Convert life_roles to simple string array for API responses."""
    if not life_roles:
        return None
    result = []
    for item in life_roles:
        if isinstance(item, dict):
            result.append(item.get("role", ""))
        elif isinstance(item, str):
            result.append(item)
    return result if result else None


def _normalize_external_uris(external_uris: list | None) -> list[str] | None:
    """Convert external_uris to simple string array for API responses."""
    if not external_uris:
        return None
    result = []
    for item in external_uris:
        if isinstance(item, dict):
            result.append(item.get("uri", ""))
        elif isinstance(item, str):
            result.append(item)
    return result if result else None


# ============================================================================
# SERIALIZERS
# ============================================================================


def _serialize_person_authority(pa, linked_objects_count: int | None = None) -> dict:
    """Serialize a Constituent (PersonAuthority) to JSON.

    Maps model fields to the API contract expected by the frontend.
    """
    result = {
        "authority_id": str(pa.constituent_id),
        "organization_id": str(pa.organization_id),
        "preferred_name": pa.name,
        "variant_names": _normalize_variant_names([vt.term for vt in pa.variant_names_list]) if pa.variant_names_list else None,
        "nationality": pa.nationality,
        "culture": pa.culture,
        "gender": pa.gender,
        "life_roles": _normalize_life_roles(pa.life_roles),
        "birth_date_display": pa.birth_date_display,
        "birth_date_earliest": pa.birth_date_earliest.isoformat() if pa.birth_date_earliest else None,
        "birth_date_latest": pa.birth_date_latest.isoformat() if pa.birth_date_latest else None,
        "birth_place": pa.birth_place,
        "death_date_display": pa.death_date_display,
        "death_date_earliest": pa.death_date_earliest.isoformat() if pa.death_date_earliest else None,
        "death_date_latest": pa.death_date_latest.isoformat() if pa.death_date_latest else None,
        "death_place": pa.death_place,
        "active_date_display": pa.active_date_display,
        "biography": pa.biography,
        "ulan_id": pa.ulan_id,
        "viaf_id": pa.viaf_id,
        "wikidata_id": pa.wikidata_id,
        "external_uris": _normalize_external_uris(pa.external_uris),
        "status": pa.status,
        "merged_into_id": None,
        "is_verified": pa.is_verified,
        "notes": pa.cataloger_notes,
        "created_at": pa.created_at.isoformat() if pa.created_at else None,
        "updated_at": pa.updated_at.isoformat() if pa.updated_at else None,
    }
    if linked_objects_count is not None:
        result["linked_objects_count"] = linked_objects_count
    return result


def _serialize_person_authority_relation(rel) -> dict:
    """Serialize a ConstituentRelation (PersonAuthorityRelation) to JSON."""
    return {
        "relation_id": str(rel.relation_id),
        "source_authority_id": str(rel.from_constituent_id),
        "related_authority_id": str(rel.to_constituent_id),
        "relationship_type": rel.relationship_type,
        "start_date": rel.start_date,
        "end_date": rel.end_date,
        "notes": rel.relationship_note,
    }


def _serialize_object_person_authority(opa, include_authority: bool = False) -> dict:
    """Serialize a ConstituentXref (ObjectPersonAuthority) to JSON."""
    result = {
        "link_id": str(opa.xref_id),
        "object_id": str(opa.entity_id),
        "authority_id": str(opa.constituent_id),
        "role": opa.role,
        "role_qualifier": opa.role_qualifier,
        "attribution_certainty": opa.attribution_certainty,
        "display_order": opa.display_order,
        "display_name_override": opa.display_name_override,
        "notes": opa.attribution_note,
    }
    if include_authority and opa.constituent:
        result["authority"] = _serialize_person_authority(opa.constituent)
    return result


# ============================================================================
# PERSON AUTHORITIES CRUD
# ============================================================================


@router.get("/api/organizations/{organization_id}/collections/authorities", response_model=PersonAuthorityListResponse, summary="List person authorities")
def list_person_authorities(
    organization_id: str,
    search: str | None = Query(None),
    status: str | None = Query(None),
    is_verified: str | None = Query(None),
    limit: int = Query(50, le=500),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.AUTHORITIES_VIEW)),
    db: Session = Depends(get_db),
):
    """List person authorities with filtering and search."""
    org_uuid = parse_uuid_or_raise(organization_id, "organization_id")

    # Subquery for linked-objects count via ConstituentXref (entity_type='collection_object')
    linked_count_subq = (
        db.query(
            ObjectPersonAuthority.constituent_id,
            func.count(ObjectPersonAuthority.xref_id).label("linked_count"),
        )
        .filter(ObjectPersonAuthority.entity_type == "collection_object")
        .group_by(ObjectPersonAuthority.constituent_id)
        .subquery()
    )

    query = db.query(
        PersonAuthority,
        func.coalesce(linked_count_subq.c.linked_count, 0).label("linked_objects_count"),
    ).outerjoin(
        linked_count_subq,
        PersonAuthority.constituent_id == linked_count_subq.c.constituent_id,
    ).filter(
        PersonAuthority.organization_id == org_uuid,
    )

    if search:
        search_term = f"%{escape_ilike(search)}%"
        query = query.filter(
            or_(
                PersonAuthority.name.ilike(search_term, escape="\\"),
                PersonAuthority.nationality.ilike(search_term, escape="\\"),
                PersonAuthority.culture.ilike(search_term, escape="\\"),
            )
        )

    if status:
        query = query.filter(PersonAuthority.status == status)

    if is_verified is not None:
        query = query.filter(PersonAuthority.is_verified == (is_verified.lower() == "true"))

    total = query.count()
    results = query.order_by(PersonAuthority.name).offset(offset).limit(limit).all()

    return {
        "items": [
            _serialize_person_authority(pa, linked_objects_count=count)
            for pa, count in results
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("/api/organizations/{organization_id}/collections/authorities", status_code=201, response_model=PersonAuthorityOut, summary="Create person authority")
def create_person_authority(
    organization_id: str,
    body: CreatePersonAuthorityRequest,
    auth: AuthContext = Depends(require_permission(Permission.AUTHORITIES_CREATE)),
    db: Session = Depends(get_db),
):
    """Create a new person authority record."""
    org_uuid = parse_uuid_or_raise(organization_id, "organization_id")

    authority = PersonAuthority(
        organization_id=org_uuid,
        constituent_type=body.constituent_type,
        name=body.preferred_name,
        nationality=body.nationality,
        culture=body.culture,
        gender=body.gender,
        life_roles=body.life_roles,
        birth_date_display=body.birth_date_display,
        birth_date_earliest=body.birth_date_earliest,
        birth_date_latest=body.birth_date_latest,
        birth_place=body.birth_place,
        death_date_display=body.death_date_display,
        death_date_earliest=body.death_date_earliest,
        death_date_latest=body.death_date_latest,
        death_place=body.death_place,
        active_date_display=body.active_date_display,
        biography=body.biography,
        ulan_id=body.ulan_id,
        viaf_id=body.viaf_id,
        wikidata_id=body.wikidata_id,
        external_uris=body.external_uris,
        status=body.status,
        is_verified=body.is_verified,
        cataloger_notes=body.notes or body.cataloger_notes,
        created_by=auth.user_id,
        updated_by=auth.user_id,
    )

    try:
        db.add(authority)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A similar authority may already exist")

    return _serialize_person_authority(authority)


@router.get("/api/organizations/{organization_id}/collections/authorities/{authority_id}", response_model=PersonAuthorityOut, summary="Get person authority")
def get_person_authority(
    organization_id: str,
    authority_id: str,
    auth: AuthContext = Depends(require_permission(Permission.AUTHORITIES_VIEW)),
    db: Session = Depends(get_db),
):
    """Get a person authority by ID."""
    org_uuid = parse_uuid_or_raise(organization_id, "organization_id")
    authority_uuid = parse_uuid_or_raise(authority_id, "authority_id")

    authority = db.query(PersonAuthority).filter(
        PersonAuthority.constituent_id == authority_uuid,
        PersonAuthority.organization_id == org_uuid,
    ).first()

    if not authority:
        raise HTTPException(status_code=404, detail="Authority not found")

    serialized = _serialize_person_authority(authority)
    return apply_field_access(serialized, 'constituent', organization_id, str(auth.user_id), session=db, role_override=auth.role_override)


@router.put("/api/organizations/{organization_id}/collections/authorities/{authority_id}", response_model=PersonAuthorityOut, summary="Update person authority")
def update_person_authority(
    organization_id: str,
    authority_id: str,
    body: UpdatePersonAuthorityRequest,
    auth: AuthContext = Depends(require_permission(Permission.AUTHORITIES_EDIT)),
    db: Session = Depends(get_db),
):
    """Update a person authority."""
    org_uuid = parse_uuid_or_raise(organization_id, "organization_id")
    authority_uuid = parse_uuid_or_raise(authority_id, "authority_id")

    authority = db.query(PersonAuthority).filter(
        PersonAuthority.constituent_id == authority_uuid,
        PersonAuthority.organization_id == org_uuid,
    ).first()

    if not authority:
        raise HTTPException(status_code=404, detail="Authority not found")

    # Map API field names to model field names
    protected_fields = {"constituent_id", "organization_id", "created_at", "created_by", "updated_by"}
    protected_fields |= get_write_restricted_fields('constituent', organization_id, str(auth.user_id), session=db)
    field_mapping = {
        "notes": "cataloger_notes",
        "preferred_name": "name",
    }
    for key, value in body.model_dump(exclude_unset=True).items():
        mapped_key = field_mapping.get(key, key)
        if hasattr(authority, mapped_key) and mapped_key not in protected_fields:
            setattr(authority, mapped_key, value)

    authority.updated_by = auth.user_id
    authority.updated_at = datetime.now(timezone.utc)

    db.commit()
    return _serialize_person_authority(authority)


@router.delete("/api/organizations/{organization_id}/collections/authorities/{authority_id}", response_model=PersonAuthorityDeleteResponse, summary="Delete person authority")
def delete_person_authority(
    organization_id: str,
    authority_id: str,
    auth: AuthContext = Depends(require_permission(Permission.AUTHORITIES_DELETE)),
    db: Session = Depends(get_db),
):
    """Delete a person authority."""
    org_uuid = parse_uuid_or_raise(organization_id, "organization_id")
    authority_uuid = parse_uuid_or_raise(authority_id, "authority_id")

    authority = db.query(PersonAuthority).filter(
        PersonAuthority.constituent_id == authority_uuid,
        PersonAuthority.organization_id == org_uuid,
    ).first()

    if not authority:
        raise HTTPException(status_code=404, detail="Authority not found")

    # Check for linked objects via ConstituentXref
    linked_count = db.query(ObjectPersonAuthority).filter(
        ObjectPersonAuthority.constituent_id == authority_uuid,
    ).count()

    if linked_count > 0:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete: authority is linked to {linked_count} object(s)",
        )

    db.delete(authority)
    db.commit()

    return {"success": True, "message": "Authority deleted successfully"}


@router.post("/api/organizations/{organization_id}/collections/authorities/{authority_id}/verify", response_model=PersonAuthorityOut, summary="Verify person authority")
def verify_person_authority(
    organization_id: str,
    authority_id: str,
    auth: AuthContext = Depends(require_permission(Permission.AUTHORITIES_EDIT)),
    db: Session = Depends(get_db),
):
    """Mark a person authority as verified."""
    org_uuid = parse_uuid_or_raise(organization_id, "organization_id")
    authority_uuid = parse_uuid_or_raise(authority_id, "authority_id")

    authority = db.query(PersonAuthority).filter(
        PersonAuthority.constituent_id == authority_uuid,
        PersonAuthority.organization_id == org_uuid,
    ).first()

    if not authority:
        raise HTTPException(status_code=404, detail="Authority not found")

    if authority.status != "active":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot verify authority with status '{authority.status}'",
        )

    if authority.is_verified:
        raise HTTPException(status_code=409, detail="Authority is already verified")

    authority.is_verified = True
    authority.verified_by = auth.user_id
    authority.verified_at = datetime.now(timezone.utc)
    authority.updated_by = auth.user_id
    authority.updated_at = datetime.now(timezone.utc)

    db.commit()

    return _serialize_person_authority(authority)


@router.post("/api/organizations/{organization_id}/collections/authorities/{authority_id}/merge", response_model=PersonAuthorityMergeResponse, summary="Merge person authorities")
def merge_person_authorities(
    organization_id: str,
    authority_id: str,
    body: MergePersonAuthorityRequest,
    auth: AuthContext = Depends(require_permission(Permission.AUTHORITIES_MERGE)),
    db: Session = Depends(get_db),
):
    """Merge one authority into another. Transfers all object links to the target."""
    org_uuid = parse_uuid_or_raise(organization_id, "organization_id")
    source_uuid = parse_uuid_or_raise(authority_id, "authority_id")

    target_uuid = body.target_authority_id

    if source_uuid == target_uuid:
        raise HTTPException(status_code=400, detail="Cannot merge authority into itself")

    source = db.query(PersonAuthority).filter(
        PersonAuthority.constituent_id == source_uuid,
        PersonAuthority.organization_id == org_uuid,
    ).first()

    target = db.query(PersonAuthority).filter(
        PersonAuthority.constituent_id == target_uuid,
        PersonAuthority.organization_id == org_uuid,
    ).first()

    if not source:
        raise HTTPException(status_code=404, detail="Source authority not found")
    if not target:
        raise HTTPException(status_code=404, detail="Target authority not found")

    # Transfer all xrefs from source to target
    links_updated = db.query(ObjectPersonAuthority).filter(
        ObjectPersonAuthority.constituent_id == source_uuid,
    ).update({ObjectPersonAuthority.constituent_id: target_uuid})

    source.status = "merged"
    source.updated_by = auth.user_id
    source.updated_at = datetime.now(timezone.utc)

    # Migrate variant terms from source to target
    from app.models import VariantTerm
    from sqlalchemy import update as sa_update
    db.execute(
        sa_update(VariantTerm)
        .where(VariantTerm.entity_type == 'constituent')
        .where(VariantTerm.entity_id == source.constituent_id)
        .values(entity_id=target.constituent_id)
    )
    # Add source name as a variant of target
    db.add(VariantTerm(
        organization_id=target.organization_id,
        entity_type='constituent', entity_id=target.constituent_id,
        term=source.name, term_type='merged',
    ))

    db.commit()

    return {
        "message": f"Merged successfully. {links_updated} object link(s) transferred.",
        "source_authority": _serialize_person_authority(source),
        "target_authority": _serialize_person_authority(target),
    }


# ============================================================================
# PERSON AUTHORITY RELATIONS
# ============================================================================


@router.get("/api/organizations/{organization_id}/collections/authorities/{authority_id}/relations", response_model=AuthorityRelationsResponse, summary="Get authority relations")
def get_authority_relations(
    organization_id: str,
    authority_id: str,
    auth: AuthContext = Depends(require_permission(Permission.AUTHORITIES_VIEW)),
    db: Session = Depends(get_db),
):
    """Get all relations for a person authority."""
    org_uuid = parse_uuid_or_raise(organization_id, "organization_id")
    authority_uuid = parse_uuid_or_raise(authority_id, "authority_id")

    authority = db.query(PersonAuthority).filter(
        PersonAuthority.constituent_id == authority_uuid,
        PersonAuthority.organization_id == org_uuid,
    ).first()

    if not authority:
        raise HTTPException(status_code=404, detail="Authority not found")

    outgoing = db.query(PersonAuthorityRelation).options(
        joinedload(PersonAuthorityRelation.to_constituent),
    ).filter(
        PersonAuthorityRelation.from_constituent_id == authority_uuid,
    ).all()

    incoming = db.query(PersonAuthorityRelation).options(
        joinedload(PersonAuthorityRelation.from_constituent),
    ).filter(
        PersonAuthorityRelation.to_constituent_id == authority_uuid,
    ).all()

    return {
        "outgoing_relations": [_serialize_person_authority_relation(r) for r in outgoing],
        "incoming_relations": [_serialize_person_authority_relation(r) for r in incoming],
    }


@router.post("/api/organizations/{organization_id}/collections/authorities/{authority_id}/relations", status_code=201, response_model=PersonAuthorityRelationOut, summary="Create authority relation")
def create_authority_relation(
    organization_id: str,
    authority_id: str,
    body: CreateAuthorityRelationRequest,
    auth: AuthContext = Depends(require_permission(Permission.AUTHORITIES_EDIT)),
    db: Session = Depends(get_db),
):
    """Create a relation between two authorities."""
    org_uuid = parse_uuid_or_raise(organization_id, "organization_id")
    source_uuid = parse_uuid_or_raise(authority_id, "authority_id")

    related_uuid = body.related_authority_id

    source = db.query(PersonAuthority).filter(
        PersonAuthority.constituent_id == source_uuid,
        PersonAuthority.organization_id == org_uuid,
    ).first()

    related = db.query(PersonAuthority).filter(
        PersonAuthority.constituent_id == related_uuid,
        PersonAuthority.organization_id == org_uuid,
    ).first()

    if not source:
        raise HTTPException(status_code=404, detail="Source authority not found")
    if not related:
        raise HTTPException(status_code=404, detail="Related authority not found")

    relation = PersonAuthorityRelation(
        organization_id=org_uuid,
        from_constituent_id=source_uuid,
        to_constituent_id=related_uuid,
        relationship_type=body.relationship_type,
        start_date=body.start_date,
        end_date=body.end_date,
        relationship_note=body.notes,
    )

    try:
        db.add(relation)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="This relation may already exist")

    return _serialize_person_authority_relation(relation)


@router.delete("/api/organizations/{organization_id}/collections/authorities/{authority_id}/relations/{relation_id}", response_model=PersonAuthorityDeleteResponse, summary="Delete authority relation")
def delete_authority_relation(
    organization_id: str,
    authority_id: str,
    relation_id: str,
    auth: AuthContext = Depends(require_permission(Permission.AUTHORITIES_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete a relation between authorities."""
    parse_uuid_or_raise(organization_id, "organization_id")
    relation_uuid = parse_uuid_or_raise(relation_id, "relation_id")

    relation = db.query(PersonAuthorityRelation).filter(
        PersonAuthorityRelation.relation_id == relation_uuid,
    ).first()

    if not relation:
        raise HTTPException(status_code=404, detail="Relation not found")

    db.delete(relation)
    db.commit()

    return {"success": True, "message": "Relation deleted successfully"}


# ============================================================================
# OBJECT-AUTHORITY LINKS (via ConstituentXref)
# ============================================================================


@router.get("/api/organizations/{organization_id}/collections/objects/{object_id}/authorities", response_model=list[ObjectPersonAuthorityLinkOut], summary="Get object authorities")
def get_object_authorities(
    organization_id: str,
    object_id: str,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get all authorities linked to an object."""
    org_uuid = parse_uuid_or_raise(organization_id, "organization_id")
    object_uuid = parse_uuid_or_raise(object_id, "object_id")

    obj = db.query(CollectionObject).filter(
        CollectionObject.object_id == object_uuid,
        CollectionObject.organization_id == org_uuid,
    ).first()

    if not obj:
        raise HTTPException(status_code=404, detail="Object not found")

    links = db.query(ObjectPersonAuthority).options(
        joinedload(ObjectPersonAuthority.constituent),
    ).filter(
        ObjectPersonAuthority.entity_id == object_uuid,
        ObjectPersonAuthority.entity_type == "collection_object",
    ).order_by(ObjectPersonAuthority.display_order).all()

    return [_serialize_object_person_authority(link, include_authority=True) for link in links]


@router.post("/api/organizations/{organization_id}/collections/objects/{object_id}/authorities", status_code=201, response_model=ObjectPersonAuthorityLinkOut, summary="Link object authority")
def link_object_authority(
    organization_id: str,
    object_id: str,
    body: CreateObjectPersonAuthorityLinkRequest,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Link an authority to an object."""
    org_uuid = parse_uuid_or_raise(organization_id, "organization_id")
    object_uuid = parse_uuid_or_raise(object_id, "object_id")

    authority_uuid = body.authority_id

    obj = db.query(CollectionObject).filter(
        CollectionObject.object_id == object_uuid,
        CollectionObject.organization_id == org_uuid,
    ).first()

    authority = db.query(PersonAuthority).filter(
        PersonAuthority.constituent_id == authority_uuid,
        PersonAuthority.organization_id == org_uuid,
    ).first()

    if not obj:
        raise HTTPException(status_code=404, detail="Object not found")
    if not authority:
        raise HTTPException(status_code=404, detail="Authority not found")

    max_order = db.query(func.max(ObjectPersonAuthority.display_order)).filter(
        ObjectPersonAuthority.entity_id == object_uuid,
        ObjectPersonAuthority.entity_type == "collection_object",
    ).scalar() or 0

    link = ObjectPersonAuthority(
        organization_id=org_uuid,
        constituent_id=authority_uuid,
        entity_type="collection_object",
        entity_id=object_uuid,
        role=body.role,
        role_qualifier=body.role_qualifier,
        attribution_certainty=body.attribution_certainty,
        display_order=body.display_order if body.display_order is not None else max_order + 1,
        display_name_override=body.display_name_override,
        attribution_note=body.notes,
        created_by=auth.user_id,
    )

    try:
        db.add(link)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="This link may already exist")

    return _serialize_object_person_authority(link, include_authority=True)


@router.put("/api/organizations/{organization_id}/collections/objects/{object_id}/authorities/{link_id}", response_model=ObjectPersonAuthorityLinkOut, summary="Update object authority link")
def update_object_authority_link(
    organization_id: str,
    object_id: str,
    link_id: str,
    body: UpdateObjectPersonAuthorityLinkRequest,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Update an object-authority link."""
    org_uuid = parse_uuid_or_raise(organization_id, "organization_id")
    link_uuid = parse_uuid_or_raise(link_id, "link_id")

    link = db.query(ObjectPersonAuthority).filter(
        ObjectPersonAuthority.xref_id == link_uuid,
        ObjectPersonAuthority.organization_id == org_uuid,
    ).first()

    if not link:
        raise HTTPException(status_code=404, detail="Link not found")

    # Map API field names to model field names
    field_mapping = {"notes": "attribution_note"}
    for key, value in body.model_dump(exclude_unset=True).items():
        model_key = field_mapping.get(key, key)
        setattr(link, model_key, value)

    db.commit()
    return _serialize_object_person_authority(link, include_authority=True)


@router.delete("/api/organizations/{organization_id}/collections/objects/{object_id}/authorities/{link_id}", response_model=PersonAuthorityDeleteResponse, summary="Unlink object authority")
def unlink_object_authority(
    organization_id: str,
    object_id: str,
    link_id: str,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Remove an authority link from an object."""
    org_uuid = parse_uuid_or_raise(organization_id, "organization_id")
    link_uuid = parse_uuid_or_raise(link_id, "link_id")

    link = db.query(ObjectPersonAuthority).filter(
        ObjectPersonAuthority.xref_id == link_uuid,
        ObjectPersonAuthority.organization_id == org_uuid,
    ).first()

    if not link:
        raise HTTPException(status_code=404, detail="Link not found")

    db.delete(link)
    db.commit()

    return {"success": True, "message": "Authority link removed successfully"}
