"""
Collections Rights API endpoints (FastAPI).

Provides CRUD for:
- Object Rights (Procedure 18) — 6 routes
- Use Requests (Procedure 10) — 9 routes

Migrated from app/api/collections_cdwa_procedure.py.

Key side effects:
  Use Request approve: calls notify_approval().
  Use Request complete: calls notify_status_change().
  Auto-numbering: USE-{year}-NNN for use requests.
"""

import logging
import re
from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.models import (
    CollectionObject,
    ObjectRight,
    UseRequest,
    UseRequestObject,
)
from app.permissions import Permission
from app.services.api_security import escape_ilike
from app.services.entity_notifications import notify_approval, notify_status_change
from app.services.validation_utils import parse_uuid_or_raise
from app.fastapi_app.schemas.collections_procedure_rights import (
    ObjectRightOut,
    ObjectRightListResponse,
    UseRequestOut,
    UseRequestListResponse,
    UseRequestObjectOut,
    UseRequestObjectsResponse,
)
from app.fastapi_app.schemas.common import MessageResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["collections-procedure-rights"])


# ============================================================================
# SERIALIZERS
# ============================================================================

def _serialize_object_right(r: ObjectRight) -> dict:
    return {
        "right_id": str(r.right_id),
        "organization_id": str(r.organization_id),
        "object_id": str(r.object_id),
        "right_type": r.right_type,
        "right_subtype": r.right_subtype,
        "rights_holder_contact_id": str(r.rights_holder_contact_id) if r.rights_holder_contact_id else None,
        "status": r.status,
        "start_date": r.start_date.isoformat() if r.start_date else None,
        "end_date": r.end_date.isoformat() if r.end_date else None,
        "is_perpetual": r.is_perpetual,
        "territory": r.territory,
        "territory_note": r.territory_note,
        "license_type": r.license_type,
        "license_reference": r.license_reference,
        "license_url": r.license_url,
        "usage_conditions": r.usage_conditions,
        "restrictions": r.restrictions,
        "fee_required": r.fee_required,
        "fee_amount": float(r.fee_amount) if r.fee_amount else None,
        "fee_currency": r.fee_currency,
        "fee_note": r.fee_note,
        "is_orphan_work": r.is_orphan_work,
        "due_diligence_conducted": r.due_diligence_conducted,
        "due_diligence_date": r.due_diligence_date.isoformat() if r.due_diligence_date else None,
        "due_diligence_steps": r.due_diligence_steps,
        "orphan_works_license_number": r.orphan_works_license_number,
        "orphan_works_license_date": r.orphan_works_license_date.isoformat() if r.orphan_works_license_date else None,
        "orphan_works_license_expiry": r.orphan_works_license_expiry.isoformat() if r.orphan_works_license_expiry else None,
        "permissions_granted": r.permissions_granted,
        "agreement_reference": r.agreement_reference,
        "documentation_references": r.documentation_references,
        "next_review_date": r.next_review_date.isoformat() if r.next_review_date else None,
        "last_review_date": r.last_review_date.isoformat() if r.last_review_date else None,
        "right_note": r.right_note,
        "internal_note": r.internal_note,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "created_by": str(r.created_by_id) if r.created_by_id else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


def _serialize_use_request(ur: UseRequest, include_objects: bool = False) -> dict:
    result = {
        "request_id": str(ur.request_id),
        "organization_id": str(ur.organization_id),
        "request_number": ur.request_number,
        "request_date": ur.request_date.isoformat() if ur.request_date else None,
        "use_type": ur.use_type,
        "use_subtype": ur.use_subtype,
        "use_purpose": ur.use_purpose,
        "use_description": ur.use_description,
        "requester_user_id": str(ur.requester_user_id) if ur.requester_user_id else None,
        "requester_name": ur.requester_name,
        "requester_title": ur.requester_title,
        "requester_institution": ur.requester_institution,
        "requester_address": ur.requester_address,
        "requester_email": ur.requester_email,
        "requester_phone": ur.requester_phone,
        "access_date_start": ur.access_date_start.isoformat() if ur.access_date_start else None,
        "access_date_end": ur.access_date_end.isoformat() if ur.access_date_end else None,
        "location_required": ur.location_required,
        "special_requirements": ur.special_requirements,
        "project_title": ur.project_title,
        "project_description": ur.project_description,
        "project_deadline": ur.project_deadline.isoformat() if ur.project_deadline else None,
        "reproduction_type": ur.reproduction_type,
        "reproduction_quantity": ur.reproduction_quantity,
        "reproduction_format": ur.reproduction_format,
        "reproduction_dimensions": ur.reproduction_dimensions,
        "intended_use": ur.intended_use,
        "publication_details": ur.publication_details,
        "credit_line": ur.credit_line,
        "exhibition_title": ur.exhibition_title,
        "exhibition_venue": ur.exhibition_venue,
        "exhibition_dates": ur.exhibition_dates,
        "exhibition_organizer": ur.exhibition_organizer,
        "insurance_value": float(ur.insurance_value) if ur.insurance_value else None,
        "insurance_currency": ur.insurance_currency,
        "status": ur.status,
        "reviewed_by_id": str(ur.reviewed_by_id) if ur.reviewed_by_id else None,
        "review_date": ur.review_date.isoformat() if ur.review_date else None,
        "review_note": ur.review_note,
        "approved_by_id": str(ur.approved_by_id) if ur.approved_by_id else None,
        "approval_date": ur.approval_date.isoformat() if ur.approval_date else None,
        "approval_conditions": ur.approval_conditions,
        "denial_reason": ur.denial_reason,
        "fee_quoted": float(ur.fee_quoted) if ur.fee_quoted else None,
        "fee_paid": float(ur.fee_paid) if ur.fee_paid is not None else 0.0,
        "fee_currency": ur.fee_currency,
        "fee_waived": ur.fee_waived,
        "fee_waiver_reason": ur.fee_waiver_reason,
        "fulfillment_date": ur.fulfillment_date.isoformat() if ur.fulfillment_date else None,
        "fulfillment_note": ur.fulfillment_note,
        "knowledge_gained": ur.knowledge_gained,
        "publication_reference": ur.publication_reference,
        "created_by": str(ur.created_by_id) if ur.created_by_id else None,
        "created_at": ur.created_at.isoformat() if ur.created_at else None,
        "updated_at": ur.updated_at.isoformat() if ur.updated_at else None,
    }
    if include_objects and ur.requested_objects:
        result["requested_objects"] = [_serialize_use_request_object(uro) for uro in ur.requested_objects]
    return result


def _serialize_use_request_object(uro: UseRequestObject, include_object: bool = False) -> dict:
    result = {
        "request_object_id": str(uro.request_object_id),
        "request_id": str(uro.request_id),
        "object_id": str(uro.object_id),
        "object_note": uro.object_note,
        "special_handling": uro.special_handling,
        "approved": uro.approved,
        "approval_note": uro.approval_note,
        "denial_reason": uro.denial_reason,
        "fulfilled": uro.fulfilled,
        "fulfillment_date": uro.fulfillment_date.isoformat() if uro.fulfillment_date else None,
        "fulfillment_note": uro.fulfillment_note,
        "created_at": uro.created_at.isoformat() if uro.created_at else None,
    }
    if include_object and uro.object:
        result["object"] = {
            "object_id": str(uro.object.object_id),
            "object_number": uro.object.object_number,
            "object_name": uro.object.object_name,
        }
    return result


# ============================================================================
# OBJECT RIGHTS (Procedure 18) — 6 routes
# ============================================================================


@router.get("/api/organizations/{org_id}/collections/rights", response_model=ObjectRightListResponse, summary="List all rights")
def list_all_rights(
    org_id: UUID,
    limit: int = Query(100, le=500),
    offset: int = Query(0, ge=0),
    right_type: str | None = None,
    status: str | None = None,
    is_orphan_work: str | None = None,
    q: str | None = None,
    auth: AuthContext = Depends(require_permission(Permission.RIGHTS_VIEW)),
    db: Session = Depends(get_db),
):
    """List all rights."""
    query = db.query(ObjectRight).filter(
        ObjectRight.organization_id == org_id,
    )

    if right_type:
        query = query.filter(ObjectRight.right_type == right_type)
    if status:
        query = query.filter(ObjectRight.status == status)
    if is_orphan_work is not None:
        query = query.filter(ObjectRight.is_orphan_work == (is_orphan_work.lower() == "true"))
    if q:
        term = f"%{escape_ilike(q)}%"
        query = query.filter(or_(
            ObjectRight.right_note.ilike(term, escape="\\"),
            ObjectRight.usage_conditions.ilike(term, escape="\\"),
        ))

    total = query.count()
    rights = query.order_by(ObjectRight.created_at.desc()).offset(offset).limit(limit).all()

    return {
        "items": [_serialize_object_right(r) for r in rights],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/api/organizations/{org_id}/collections/rights/{right_id}", response_model=ObjectRightOut, summary="Get right")
def get_right(
    org_id: UUID,
    right_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.RIGHTS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get right."""
    right = db.query(ObjectRight).filter(
        ObjectRight.right_id == right_id,
        ObjectRight.organization_id == org_id,
    ).first()
    if not right:
        raise HTTPException(status_code=404, detail="Right not found")

    return _serialize_object_right(right)


@router.get("/api/organizations/{org_id}/collections/objects/{object_id}/rights", response_model=list[ObjectRightOut], summary="Get object rights")
def get_object_rights(
    org_id: UUID,
    object_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.RIGHTS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get object rights."""
    rights = db.query(ObjectRight).filter(
        ObjectRight.object_id == object_id,
        ObjectRight.organization_id == org_id,
    ).order_by(ObjectRight.created_at.desc()).all()

    return [_serialize_object_right(r) for r in rights]


@router.post("/api/organizations/{org_id}/collections/objects/{object_id}/rights", status_code=201, response_model=ObjectRightOut, summary="Create object right")
def create_object_right(
    org_id: UUID,
    object_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.RIGHTS_EDIT)),
    db: Session = Depends(get_db),
):
    """Create object right."""
    if not body.get("right_type"):
        raise HTTPException(status_code=400, detail="Missing: right_type")

    obj = db.query(CollectionObject).filter(
        CollectionObject.object_id == object_id,
        CollectionObject.organization_id == org_id,
    ).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Object not found")

    # Validate an optional contact id up front so a malformed id is a 400, not a
    # 500 from the create path (parity with prior behavior).
    if body.get("rights_holder_contact_id"):
        parse_uuid_or_raise(body["rights_holder_contact_id"])

    # Create via the shared service — the same code the draft applier runs. The
    # API route carries object_id in the path; fold it into the payload (the
    # draft path carries it in the payload directly).
    from app.services.collections.creation.object_right import (
        create_object_right as _create_object_right,
    )

    payload = {**body, "object_id": str(object_id)}
    try:
        right = _create_object_right(db, org_id, payload, auth.user_id, open_approval=True)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="This right may already exist")

    db.refresh(right)
    return _serialize_object_right(right)


@router.put("/api/organizations/{org_id}/collections/rights/{right_id}", response_model=ObjectRightOut, summary="Update object right")
def update_object_right(
    org_id: UUID,
    right_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.RIGHTS_EDIT)),
    db: Session = Depends(get_db),
):
    """Update object right."""
    right = db.query(ObjectRight).filter(
        ObjectRight.right_id == right_id,
        ObjectRight.organization_id == org_id,
    ).first()
    if not right:
        raise HTTPException(status_code=404, detail="Right not found")

    protected = {"right_id", "organization_id", "object_id", "created_at", "created_by_id", "created_by", "updated_by_id"}
    for key, value in body.items():
        if key in protected:
            continue
        if key == "rights_holder_contact_id" and value is not None:
            value = UUID(value) if isinstance(value, str) else value
        if key == "fee_amount" and value is not None:
            value = Decimal(str(value))
        if hasattr(right, key):
            setattr(right, key, value)

    right.updated_by_id = auth.user_id
    right.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(right)
    return _serialize_object_right(right)


@router.delete("/api/organizations/{org_id}/collections/rights/{right_id}", response_model=MessageResponse, summary="Delete object right")
def delete_object_right(
    org_id: UUID,
    right_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.RIGHTS_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete object right."""
    right = db.query(ObjectRight).filter(
        ObjectRight.right_id == right_id,
        ObjectRight.organization_id == org_id,
    ).first()
    if not right:
        raise HTTPException(status_code=404, detail="Right not found")

    db.delete(right)
    db.commit()
    return {"message": "Right deleted successfully"}


# ============================================================================
# USE REQUESTS (Procedure 10) — 9 routes
# ============================================================================


def _generate_use_request_number(db: Session, org_id: UUID) -> str:
    """Generate year-based request number: USE-{year}-NNN."""
    year = date.today().year
    prefix = f"USE-{year}-"

    existing = db.query(UseRequest.request_number).filter(
        UseRequest.organization_id == org_id,
        UseRequest.request_number.like(f"{prefix}%"),
    ).all()

    max_num = 0
    for (num_str,) in existing:
        match = re.search(r"USE-\d{4}-(\d+)", num_str)
        if match:
            max_num = max(max_num, int(match.group(1)))

    return f"{prefix}{max_num + 1:03d}"


@router.get("/api/organizations/{org_id}/collections/use-requests", response_model=UseRequestListResponse, summary="List use requests")
def list_use_requests(
    org_id: UUID,
    limit: int = Query(50, le=500),
    offset: int = Query(0, ge=0),
    status: str | None = None,
    use_type: str | None = None,
    q: str | None = None,
    auth: AuthContext = Depends(require_permission(Permission.USE_REQUESTS_VIEW)),
    db: Session = Depends(get_db),
):
    """List use requests."""
    query = db.query(UseRequest).filter(
        UseRequest.organization_id == org_id,
    )

    if status:
        query = query.filter(UseRequest.status == status)
    if use_type:
        query = query.filter(UseRequest.use_type == use_type)
    if q:
        term = f"%{escape_ilike(q)}%"
        query = query.filter(or_(
            UseRequest.request_number.ilike(term, escape="\\"),
            UseRequest.requester_name.ilike(term, escape="\\"),
            UseRequest.requester_institution.ilike(term, escape="\\"),
            UseRequest.use_description.ilike(term, escape="\\"),
            UseRequest.request_note.ilike(term, escape="\\"),
        ))

    total = query.count()
    requests = query.order_by(UseRequest.created_at.desc()).offset(offset).limit(limit).all()

    return {
        "items": [_serialize_use_request(r) for r in requests],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("/api/organizations/{org_id}/collections/use-requests", status_code=201, response_model=UseRequestOut, summary="Create use request")
def create_use_request(
    org_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.USE_REQUESTS_CREATE)),
    db: Session = Depends(get_db),
):
    """Create use request."""
    if not body.get("use_type"):
        raise HTTPException(status_code=400, detail="Missing: use_type")
    if not body.get("requester_name"):
        raise HTTPException(status_code=400, detail="Missing: requester_name")
    if not body.get("use_purpose"):
        raise HTTPException(status_code=400, detail="Missing: use_purpose")

    # Validate the optional requester id up front so a malformed id is a 400.
    if body.get("requester_user_id"):
        parse_uuid_or_raise(body["requester_user_id"])

    # Create via the shared service — the same code the draft applier runs (it
    # owns the USE-{year}-NNN number generation).
    from app.services.collections.creation.use_request import (
        create_use_request as _create_use_request,
    )

    try:
        req = _create_use_request(db, org_id, body, auth.user_id, open_approval=True)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A request with this number may already exist")

    db.refresh(req)
    return _serialize_use_request(req)


@router.get("/api/organizations/{org_id}/collections/use-requests/{request_id}", response_model=UseRequestOut, summary="Get use request")
def get_use_request(
    org_id: UUID,
    request_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.USE_REQUESTS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get use request."""
    req = db.query(UseRequest).options(
        joinedload(UseRequest.requested_objects),
    ).filter(
        UseRequest.request_id == request_id,
        UseRequest.organization_id == org_id,
    ).first()
    if not req:
        raise HTTPException(status_code=404, detail="Use request not found")

    return _serialize_use_request(req, include_objects=True)


@router.put("/api/organizations/{org_id}/collections/use-requests/{request_id}", response_model=UseRequestOut, summary="Update use request")
def update_use_request(
    org_id: UUID,
    request_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.USE_REQUESTS_EDIT)),
    db: Session = Depends(get_db),
):
    """Update use request."""
    req = db.query(UseRequest).filter(
        UseRequest.request_id == request_id,
        UseRequest.organization_id == org_id,
    ).first()
    if not req:
        raise HTTPException(status_code=404, detail="Use request not found")

    # Attribution is server-set and never accepted from the body.
    #
    # These names must be the MAPPED ATTRIBUTE names, not the DB column names.
    # UseRequest declares `approved_by_id: Mapped[...] = mapped_column("approved_by", ...)`,
    # so the entry "approved_by" matched no attribute, `hasattr` was False, and
    # the real `approved_by_id` was left unprotected — letting anyone with
    # USE_REQUESTS_EDIT name a colleague as approver, bypassing the /approve
    # endpoint and its USE_REQUESTS_APPROVE gate. FK-only changes also produce
    # no entity-audit diff, so it left no trace.
    protected = {
        "request_id", "organization_id", "created_at", "created_by", "created_by_id",
        "updated_by_id", "approved_at", "approval_date",
        "approved_by", "approved_by_id",
        "reviewed_by_id", "fulfilled_by_id",
    }
    uuid_fields = {"requester_user_id"}

    for key, value in body.items():
        if key in protected:
            continue
        if key in uuid_fields and value is not None:
            value = UUID(value) if isinstance(value, str) else value
        if hasattr(req, key):
            setattr(req, key, value)

    req.updated_by_id = auth.user_id
    req.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(req)
    return _serialize_use_request(req)


@router.post("/api/organizations/{org_id}/collections/use-requests/{request_id}/objects", status_code=201, response_model=UseRequestObjectOut, summary="Add use request object")
def add_use_request_object(
    org_id: UUID,
    request_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.USE_REQUESTS_EDIT)),
    db: Session = Depends(get_db),
):
    """Add use request object."""
    if not body.get("object_id"):
        raise HTTPException(status_code=400, detail="Missing: object_id")

    object_uuid = parse_uuid_or_raise(body["object_id"])

    req = db.query(UseRequest).filter(
        UseRequest.request_id == request_id,
        UseRequest.organization_id == org_id,
    ).first()
    if not req:
        raise HTTPException(status_code=404, detail="Use request not found")

    obj = db.query(CollectionObject).filter(
        CollectionObject.object_id == object_uuid,
        CollectionObject.organization_id == org_id,
    ).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Object not found")

    link = UseRequestObject(
        request_id=request_id,
        organization_id=org_id,
        object_id=object_uuid,
        object_note=body.get("object_note"),
        special_handling=body.get("special_handling"),
    )

    db.add(link)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="This object is already linked to this request")

    db.refresh(link)
    return _serialize_use_request_object(link)


@router.get("/api/organizations/{org_id}/collections/use-requests/{request_id}/objects", response_model=UseRequestObjectsResponse, summary="Get use request objects")
def get_use_request_objects(
    org_id: UUID,
    request_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.USE_REQUESTS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get use request objects."""
    req = db.query(UseRequest).filter(
        UseRequest.request_id == request_id,
        UseRequest.organization_id == org_id,
    ).first()
    if not req:
        raise HTTPException(status_code=404, detail="Use request not found")

    links = db.query(UseRequestObject).options(
        joinedload(UseRequestObject.object),
    ).filter(
        UseRequestObject.request_id == request_id,
    ).all()

    return {
        "objects": [_serialize_use_request_object(l, include_object=True) for l in links],
    }


@router.delete("/api/organizations/{org_id}/collections/use-requests/{request_id}/objects/{object_id}", response_model=MessageResponse, summary="Remove use request object")
def remove_use_request_object(
    org_id: UUID,
    request_id: UUID,
    object_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.USE_REQUESTS_EDIT)),
    db: Session = Depends(get_db),
):
    """Remove use request object."""
    link = db.query(UseRequestObject).filter(
        UseRequestObject.request_id == request_id,
        UseRequestObject.object_id == object_id,
    ).first()
    if not link:
        raise HTTPException(status_code=404, detail="Use request object link not found")

    db.delete(link)
    db.commit()
    return {"message": "Object removed from use request"}


@router.post("/api/organizations/{org_id}/collections/use-requests/{request_id}/approve", response_model=UseRequestOut, summary="Approve use request")
def approve_use_request(
    org_id: UUID,
    request_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.USE_REQUESTS_APPROVE)),
    db: Session = Depends(get_db),
):
    """Approve use request."""
    req = db.query(UseRequest).filter(
        UseRequest.request_id == request_id,
        UseRequest.organization_id == org_id,
    ).first()
    if not req:
        raise HTTPException(status_code=404, detail="Use request not found")

    if req.status != "submitted":
        raise HTTPException(status_code=400, detail=f"Cannot approve request with status '{req.status}'")

    req.status = "approved"
    req.approved_by_id = auth.user_id
    req.approval_date = date.today()
    req.updated_by_id = auth.user_id
    req.updated_at = datetime.now(timezone.utc)

    db.commit()

    ref = req.request_number
    try:
        notify_approval(org_id, "use_request", req.request_id, ref, auth.user_id, entity=req)
    except Exception:
        logger.warning("Failed to send approval notification for use request %s", request_id)

    db.refresh(req)
    return _serialize_use_request(req)


@router.post("/api/organizations/{org_id}/collections/use-requests/{request_id}/complete", response_model=UseRequestOut, summary="Complete use request")
def complete_use_request(
    org_id: UUID,
    request_id: UUID,
    body: dict | None = None,
    auth: AuthContext = Depends(require_permission(Permission.USE_REQUESTS_EDIT)),
    db: Session = Depends(get_db),
):
    """Complete use request."""
    body = body or {}

    req = db.query(UseRequest).filter(
        UseRequest.request_id == request_id,
        UseRequest.organization_id == org_id,
    ).first()
    if not req:
        raise HTTPException(status_code=404, detail="Use request not found")

    if req.status not in ("approved", "in_progress"):
        raise HTTPException(status_code=400, detail=f"Cannot complete request with status '{req.status}'")

    old_status = req.status
    req.status = "completed"
    req.fulfillment_date = date.today()

    if body.get("knowledge_gained"):
        req.knowledge_gained = body["knowledge_gained"]
    if body.get("publication_reference"):
        req.publication_reference = body["publication_reference"]

    req.updated_by_id = auth.user_id
    req.updated_at = datetime.now(timezone.utc)

    db.commit()

    ref = req.request_number
    try:
        notify_status_change(
            org_id, "use_request", req.request_id, ref,
            old_status, "completed", auth.user_id, entity=req,
        )
    except Exception:
        logger.warning("Failed to send status change notification for use request %s", request_id)

    db.refresh(req)
    return _serialize_use_request(req)
