"""Archival hierarchy API: ancestors, children, tree nodes, re-parenting, ordering."""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.models import CollectionObject
from app.permissions import Permission
from app.services import archival_hierarchy as ah
from app.services.field_access_service import get_write_restricted_fields

router = APIRouter(tags=["Collections: archival hierarchy"])
_BASE = "/api/organizations/{organization_id}/collections/objects/{object_id}"


def _obj(db: Session, org_id: UUID, object_id: UUID) -> CollectionObject:
    obj = ah._get(db, org_id, object_id)
    if obj is None:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Object not found"})
    return obj


def _raise(e: ah.HierarchyError):
    raise HTTPException(status_code=e.status, detail={"code": e.code, "message": str(e)})


def _check_writable(db: Session, auth: AuthContext, org_id: UUID) -> None:
    restricted = get_write_restricted_fields("collection_object", str(org_id), str(auth.user_id),
                                             session=db, role_override=auth.role_override)
    if {"parent_object_id", "sibling_order"} & set(restricted):
        raise HTTPException(status_code=403, detail={
            "code": "field_restricted", "message": "Your role cannot change where records sit in the hierarchy",
        })


@router.get(_BASE + "/hierarchy", response_model=dict, summary="A record's place in the archival hierarchy")
def get_hierarchy(
    organization_id: UUID,
    object_id: UUID,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Ancestors (root first), the record itself, and one page of its children with their child counts."""
    obj = _obj(db, organization_id, object_id)
    chain = ah.ancestors(db, organization_id, obj)
    kids, total = ah.children(db, organization_id, object_id, limit=limit, offset=offset)
    counts = ah.child_counts(db, organization_id, [k.object_id for k in kids] + [obj.object_id])
    return {
        "ancestors": [ah.node(a) for a in chain],
        "node": ah.node(obj, counts.get(obj.object_id, 0)),
        "children": [ah.node(k, counts.get(k.object_id, 0)) for k in kids],
        "children_total": total,
        "limit": limit,
        "offset": offset,
        "levels": [{"value": v, "label": ah.LEVEL_LABELS[v]} for v in ah.CATALOG_LEVELS],
    }


@router.put(_BASE + "/parent", response_model=dict, summary="Move a record in the archival hierarchy")
def set_record_parent(
    organization_id: UUID,
    object_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    _check_writable(db, auth, organization_id)
    obj = _obj(db, organization_id, object_id)
    raw = data.get("parent_object_id")
    try:
        parent_id = UUID(str(raw)) if raw else None
    except ValueError:
        raise HTTPException(status_code=422, detail={"code": "validation_error", "message": "parent_object_id is not valid"})
    try:
        ah.set_parent(db, organization_id, obj, parent_id, data.get("sibling_order"))
    except ah.HierarchyError as e:
        db.rollback()
        _raise(e)
    obj.updated_by = auth.user_id
    db.commit()
    return ah.node(obj, ah.child_counts(db, organization_id, [obj.object_id]).get(obj.object_id, 0))


@router.post(_BASE + "/move", response_model=dict, summary="Move a record up or down among its siblings")
def move_record(
    organization_id: UUID,
    object_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    _check_writable(db, auth, organization_id)
    obj = _obj(db, organization_id, object_id)
    try:
        ah.move_child(db, organization_id, obj, data.get("direction"))
    except ah.HierarchyError as e:
        db.rollback()
        _raise(e)
    db.commit()
    kids, total = ah.children(db, organization_id, obj.parent_object_id, limit=500)
    position = [k.object_id for k in kids].index(obj.object_id) + 1
    return {"object_id": str(obj.object_id), "position": position, "of": total}


@router.post(_BASE + "/children/reorder", response_model=dict, summary="Set the order of a record's children")
def reorder_record_children(
    organization_id: UUID,
    object_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    _check_writable(db, auth, organization_id)
    _obj(db, organization_id, object_id)
    try:
        ids = [UUID(str(x)) for x in data.get("object_ids") or []]
        ah.reorder_children(db, organization_id, object_id, ids)
    except ValueError as e:
        db.rollback()
        if isinstance(e, ah.HierarchyError):
            _raise(e)
        raise HTTPException(status_code=422, detail={"code": "validation_error", "message": "object_ids must be ids"})
    db.commit()
    return {"reordered": len(ids)}
