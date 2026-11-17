"""Administrator-defined fields on object records."""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.models import CustomFieldDefinition
from app.permissions import Permission
from app.services import custom_fields as cf

router = APIRouter(tags=["Collections: user-defined fields"])
_BASE = "/api/organizations/{organization_id}/collections/settings/custom-fields"


def _err(e: cf.CustomFieldError):
    raise HTTPException(status_code=e.status, detail={"code": "validation_error", "message": str(e), "field": e.field})


@router.get(_BASE, response_model=dict, summary="List user-defined fields")
def list_custom_fields(
    organization_id: UUID,
    include_inactive: bool = False,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Definitions, with whether the caller may view and edit each one."""
    ctx = cf.role_context(db, organization_id, auth.user_id, auth.role_override)
    items = []
    for d in cf.definitions(db, organization_id, active_only=not include_inactive):
        if not cf.can_view(d, ctx):
            continue
        items.append({**cf.serialize_definition(d), "can_edit": cf.can_edit(d, ctx)})
    return {"items": items, "field_types": list(cf.FIELD_TYPES)}


@router.post(_BASE, status_code=201, response_model=dict, summary="Create a user-defined field")
def create_custom_field(
    organization_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    try:
        values = cf.validate_definition_input(data)
    except cf.CustomFieldError as e:
        _err(e)
    if db.query(CustomFieldDefinition).filter(
        CustomFieldDefinition.organization_id == organization_id,
        CustomFieldDefinition.entity_type == "collection_object",
        CustomFieldDefinition.key == values["key"],
    ).first():
        raise HTTPException(status_code=409, detail={"code": "conflict", "field": "label",
                                                     "message": f"A field with the key “{values['key']}” already exists"})
    values.setdefault("sort_order", len(cf.definitions(db, organization_id, active_only=False)))
    d = CustomFieldDefinition(organization_id=organization_id, entity_type="collection_object",
                              created_by=auth.user_id, **values)
    db.add(d)
    db.commit()
    return cf.serialize_definition(d)


def _get(db: Session, org_id: UUID, field_id: UUID) -> CustomFieldDefinition:
    d = db.query(CustomFieldDefinition).filter(
        CustomFieldDefinition.organization_id == org_id, CustomFieldDefinition.field_id == field_id,
    ).first()
    if not d:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Field not found"})
    return d


@router.put(_BASE + "/{field_id}", response_model=dict, summary="Update a user-defined field")
def update_custom_field(
    organization_id: UUID,
    field_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    d = _get(db, organization_id, field_id)
    try:
        values = cf.validate_definition_input(data, existing=d)
    except cf.CustomFieldError as e:
        _err(e)
    values.pop("key", None)
    for k, v in values.items():
        setattr(d, k, v)
    db.commit()
    return cf.serialize_definition(d)


@router.delete(_BASE + "/{field_id}", response_model=dict, summary="Deactivate a user-defined field")
def deactivate_custom_field(
    organization_id: UUID,
    field_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    """Fields are deactivated, not deleted, so values already recorded are kept."""
    d = _get(db, organization_id, field_id)
    d.is_active = False
    db.commit()
    return {"deactivated": True}
