"""
Collections Descriptive API endpoints (FastAPI).

Provides CRUD for:
- Object Materials (CDWA 11.1) — 3 routes (GET, POST, DELETE)
- Object Techniques (CDWA 11.1) — 3 routes (GET, POST, DELETE)
- Object Classifications — 3 routes (GET, POST, DELETE)

Migrated from app/api/collections_cdwa_procedure.py (Domains 8-10).

Key side effects:
  Materials/Techniques POST: increments VocabularyTerm.usage_count and sets last_used_at.
  Materials/Techniques DELETE: does NOT decrement usage_count.
  Classifications POST: validates LookupValue belongs to 'classification' category via JOIN.
"""

import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.models import (
    CollectionObject,
    ObjectMaterial,
    ObjectTechnique,
    ObjectClassification,
    VocabularyTerm,
    LookupValue,
    LookupCategory,
)
from app.permissions import Permission
from app.services.validation_utils import parse_uuid_or_raise
from app.fastapi_app.schemas.collections_descriptive import (
    ObjectMaterialOut,
    ObjectTechniqueOut,
    ObjectClassificationOut,
)
from app.fastapi_app.schemas.common import MessageResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["collections-descriptive"])


# ============================================================================
# SERIALIZERS
# ============================================================================


def _serialize_vocabulary_term(term) -> dict:
    return {
        "term_id": str(term.term_id),
        "vocabulary": term.vocabulary,
        "external_id": term.external_id,
        "external_uri": term.external_uri,
        "preferred_term": term.preferred_term,
        "scope_note": term.scope_note,
        "broader_term": term.broader_term,
    }


def _serialize_object_material(om: ObjectMaterial, include_term: bool = False) -> dict:
    result = {
        "link_id": str(om.link_id),
        "object_id": str(om.object_id),
        "vocabulary_term_id": str(om.vocabulary_term_id),
        "part": om.part,
        "extent": om.extent,
        "notes": om.notes,
        "display_order": om.display_order,
        "created_at": om.created_at.isoformat() if om.created_at else None,
    }
    if include_term and om.vocabulary_term:
        result["vocabulary_term"] = _serialize_vocabulary_term(om.vocabulary_term)
    return result


def _serialize_object_technique(ot: ObjectTechnique, include_term: bool = False) -> dict:
    result = {
        "link_id": str(ot.link_id),
        "object_id": str(ot.object_id),
        "vocabulary_term_id": str(ot.vocabulary_term_id),
        "part": ot.part,
        "extent": ot.extent,
        "notes": ot.notes,
        "display_order": ot.display_order,
        "created_at": ot.created_at.isoformat() if ot.created_at else None,
    }
    if include_term and ot.vocabulary_term:
        result["vocabulary_term"] = _serialize_vocabulary_term(ot.vocabulary_term)
    return result


def _serialize_object_classification(link: ObjectClassification, include_value: bool = False) -> dict:
    result = {
        "link_id": str(link.link_id),
        "object_id": str(link.object_id),
        "value_id": str(link.value_id),
        "display_order": link.display_order,
        "created_at": link.created_at.isoformat() if link.created_at else None,
    }
    if include_value and link.lookup_value:
        result["lookup_value"] = {
            "value_id": str(link.lookup_value.value_id),
            "value_key": link.lookup_value.value_key,
            "label": link.lookup_value.label,
            "description": link.lookup_value.description,
        }
    return result


# ============================================================================
# OBJECT MATERIALS (CDWA 11.1) — 3 routes
# ============================================================================


@router.get("/api/organizations/{org_id}/collections/objects/{object_id}/materials", response_model=list[ObjectMaterialOut], summary="Get object materials")
def get_object_materials(
    org_id: UUID,
    object_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get object materials."""
    obj = db.query(CollectionObject).filter(
        CollectionObject.object_id == object_id,
        CollectionObject.organization_id == org_id,
    ).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Object not found")

    links = db.query(ObjectMaterial).options(
        joinedload(ObjectMaterial.vocabulary_term)
    ).filter(
        ObjectMaterial.object_id == object_id,
    ).order_by(ObjectMaterial.display_order).all()

    return [_serialize_object_material(link, include_term=True) for link in links]


@router.post("/api/organizations/{org_id}/collections/objects/{object_id}/materials", status_code=201, response_model=ObjectMaterialOut, summary="Link object material")
def link_object_material(
    org_id: UUID,
    object_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Link object material."""
    if not body.get("vocabulary_term_id"):
        raise HTTPException(status_code=400, detail="Missing: vocabulary_term_id")

    term_uuid = parse_uuid_or_raise(body["vocabulary_term_id"])

    obj = db.query(CollectionObject).filter(
        CollectionObject.object_id == object_id,
        CollectionObject.organization_id == org_id,
    ).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Object not found")

    term = db.query(VocabularyTerm).filter(
        VocabularyTerm.term_id == term_uuid,
    ).first()
    if not term:
        raise HTTPException(status_code=404, detail="Vocabulary term not found")

    max_order = db.query(func.max(ObjectMaterial.display_order)).filter(
        ObjectMaterial.object_id == object_id,
    ).scalar() or 0

    link = ObjectMaterial(
        organization_id=org_id,
        object_id=object_id,
        vocabulary_term_id=term_uuid,
        part=body.get("part"),
        extent=body.get("extent"),
        notes=body.get("notes"),
        display_order=body.get("display_order", max_order + 1),
        created_by=auth.user_id,
    )

    db.add(link)

    # Update vocabulary term usage count
    term.usage_count = (term.usage_count or 0) + 1
    term.last_used_at = datetime.now(timezone.utc)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="This material link may already exist")

    db.refresh(link)
    return _serialize_object_material(link, include_term=True)


@router.delete("/api/organizations/{org_id}/collections/objects/{object_id}/materials/{link_id}", response_model=MessageResponse, summary="Unlink object material")
def unlink_object_material(
    org_id: UUID,
    object_id: UUID,
    link_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Unlink object material."""
    link = db.query(ObjectMaterial).filter(
        ObjectMaterial.link_id == link_id,
        ObjectMaterial.organization_id == org_id,
    ).first()
    if not link:
        raise HTTPException(status_code=404, detail="Material link not found")

    db.delete(link)
    db.commit()
    return {"message": "Material unlinked successfully"}


# ============================================================================
# OBJECT TECHNIQUES (CDWA 11.1) — 3 routes
# ============================================================================


@router.get("/api/organizations/{org_id}/collections/objects/{object_id}/techniques", response_model=list[ObjectTechniqueOut], summary="Get object techniques")
def get_object_techniques(
    org_id: UUID,
    object_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get object techniques."""
    obj = db.query(CollectionObject).filter(
        CollectionObject.object_id == object_id,
        CollectionObject.organization_id == org_id,
    ).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Object not found")

    links = db.query(ObjectTechnique).options(
        joinedload(ObjectTechnique.vocabulary_term)
    ).filter(
        ObjectTechnique.object_id == object_id,
    ).order_by(ObjectTechnique.display_order).all()

    return [_serialize_object_technique(link, include_term=True) for link in links]


@router.post("/api/organizations/{org_id}/collections/objects/{object_id}/techniques", status_code=201, response_model=ObjectTechniqueOut, summary="Link object technique")
def link_object_technique(
    org_id: UUID,
    object_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Link object technique."""
    if not body.get("vocabulary_term_id"):
        raise HTTPException(status_code=400, detail="Missing: vocabulary_term_id")

    term_uuid = parse_uuid_or_raise(body["vocabulary_term_id"])

    obj = db.query(CollectionObject).filter(
        CollectionObject.object_id == object_id,
        CollectionObject.organization_id == org_id,
    ).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Object not found")

    term = db.query(VocabularyTerm).filter(
        VocabularyTerm.term_id == term_uuid,
    ).first()
    if not term:
        raise HTTPException(status_code=404, detail="Vocabulary term not found")

    max_order = db.query(func.max(ObjectTechnique.display_order)).filter(
        ObjectTechnique.object_id == object_id,
    ).scalar() or 0

    link = ObjectTechnique(
        organization_id=org_id,
        object_id=object_id,
        vocabulary_term_id=term_uuid,
        part=body.get("part"),
        extent=body.get("extent"),
        notes=body.get("notes"),
        display_order=body.get("display_order", max_order + 1),
        created_by=auth.user_id,
    )

    db.add(link)

    # Update vocabulary term usage count
    term.usage_count = (term.usage_count or 0) + 1
    term.last_used_at = datetime.now(timezone.utc)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="This technique link may already exist")

    db.refresh(link)
    return _serialize_object_technique(link, include_term=True)


@router.delete("/api/organizations/{org_id}/collections/objects/{object_id}/techniques/{link_id}", response_model=MessageResponse, summary="Unlink object technique")
def unlink_object_technique(
    org_id: UUID,
    object_id: UUID,
    link_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Unlink object technique."""
    link = db.query(ObjectTechnique).filter(
        ObjectTechnique.link_id == link_id,
        ObjectTechnique.organization_id == org_id,
    ).first()
    if not link:
        raise HTTPException(status_code=404, detail="Technique link not found")

    db.delete(link)
    db.commit()
    return {"message": "Technique unlinked successfully"}


# ============================================================================
# OBJECT CLASSIFICATIONS — 3 routes
# ============================================================================


@router.get("/api/organizations/{org_id}/collections/objects/{object_id}/classifications", response_model=list[ObjectClassificationOut], summary="Get object classifications")
def get_object_classifications(
    org_id: UUID,
    object_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get object classifications."""
    obj = db.query(CollectionObject).filter(
        CollectionObject.object_id == object_id,
        CollectionObject.organization_id == org_id,
    ).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Object not found")

    links = db.query(ObjectClassification).options(
        joinedload(ObjectClassification.lookup_value)
    ).filter(
        ObjectClassification.object_id == object_id,
    ).order_by(ObjectClassification.display_order).all()

    return [_serialize_object_classification(link, include_value=True) for link in links]


@router.post("/api/organizations/{org_id}/collections/objects/{object_id}/classifications", status_code=201, response_model=ObjectClassificationOut, summary="Link object classification")
def link_object_classification(
    org_id: UUID,
    object_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Link object classification."""
    if not body.get("value_id"):
        raise HTTPException(status_code=400, detail="Missing: value_id")

    value_uuid = parse_uuid_or_raise(body["value_id"])

    obj = db.query(CollectionObject).filter(
        CollectionObject.object_id == object_id,
        CollectionObject.organization_id == org_id,
    ).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Object not found")

    # Verify lookup value exists AND belongs to 'classification' category
    value = db.query(LookupValue).join(
        LookupCategory, LookupValue.category_id == LookupCategory.category_id
    ).filter(
        LookupValue.value_id == value_uuid,
        LookupCategory.category_key == 'classification',
    ).first()

    if not value:
        raise HTTPException(status_code=404, detail="Classification lookup value not found")

    max_order = db.query(func.max(ObjectClassification.display_order)).filter(
        ObjectClassification.object_id == object_id,
    ).scalar() or 0

    link = ObjectClassification(
        organization_id=org_id,
        object_id=object_id,
        value_id=value_uuid,
        display_order=body.get("display_order", max_order + 1),
        created_by=auth.user_id,
    )

    db.add(link)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="This classification link may already exist")

    db.refresh(link)
    return _serialize_object_classification(link, include_value=True)


@router.delete("/api/organizations/{org_id}/collections/objects/{object_id}/classifications/{link_id}", response_model=MessageResponse, summary="Unlink object classification")
def unlink_object_classification(
    org_id: UUID,
    object_id: UUID,
    link_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Unlink object classification."""
    link = db.query(ObjectClassification).filter(
        ObjectClassification.link_id == link_id,
        ObjectClassification.organization_id == org_id,
    ).first()
    if not link:
        raise HTTPException(status_code=404, detail="Classification link not found")

    db.delete(link)
    db.commit()
    return {"message": "Classification unlinked successfully"}
