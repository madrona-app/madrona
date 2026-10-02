"""
Collections Value API endpoints (FastAPI).

Provides CRUD for:
- Valuations (Procedure 13) — 6 routes
- Reproduction Requests (Procedure 19) — 7 routes

Migrated from app/api/collections_cdwa_procedure.py.

Key side effects:
  Valuation create: un-marks previous is_current valuations for same object+type.
  Reproduction clear-rights: calls notify_approval().
  Reproduction deliver: calls notify_status_change().
"""

import logging
from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import UUID


def _parse_date(val):
    """Convert a string or date to a Python date object."""
    if val is None:
        return None
    if isinstance(val, date):
        return val
    return date.fromisoformat(val)

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.models import CollectionObject, Valuation, ReproductionRequest
from app.permissions import Permission
from app.services.api_security import escape_ilike
from app.services.entity_notifications import notify_approval, notify_status_change
from app.services.validation_utils import parse_uuid_or_raise
from app.fastapi_app.schemas.collections_procedure_value import (
    ValuationOut,
    ValuationListResponse,
    ObjectValuationListResponse,
    ReproductionRequestOut,
    ReproductionRequestListResponse,
)
from app.fastapi_app.schemas.common import MessageResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["collections-procedure-value"])


# ============================================================================
# SERIALIZERS
# ============================================================================

def _get_object_title(obj: CollectionObject) -> str | None:
    if not obj:
        return None
    if hasattr(obj, "title_links") and obj.title_links:
        preferred = next((t for t in obj.title_links if t.is_preferred), None)
        title = preferred.title if preferred else obj.title_links[0].title
        if title:
            return title
    return obj.object_name


def _serialize_valuation(v: Valuation, object_number: str = None, object_title: str = None) -> dict:
    return {
        "valuation_id": str(v.valuation_id),
        "organization_id": str(v.organization_id),
        "object_id": str(v.object_id) if v.object_id else None,
        "object_number": object_number,
        "object_title": object_title,
        "valuation_type": v.valuation_type,
        "valuation_amount": float(v.valuation_amount) if v.valuation_amount else None,
        "valuation_currency": v.valuation_currency,
        "valuation_date": v.valuation_date.isoformat() if v.valuation_date else None,
        "valuator_id": str(v.valuator_id) if v.valuator_id else None,
        "valuator_name": v.valuator_name,
        "valuator_organization": v.valuator_organization,
        "valuator_credentials": v.valuator_credentials,
        "valuation_method": v.valuation_method,
        "documentation_reference": v.documentation_reference,
        "valuation_note": v.valuation_note,
        "authorizer_id": str(v.authorizer_id) if v.authorizer_id else None,
        "authorization_date": v.authorization_date.isoformat() if v.authorization_date else None,
        "authorization_note": v.authorization_note,
        "valid_from": v.valid_from.isoformat() if v.valid_from else None,
        "valid_until": v.valid_until.isoformat() if v.valid_until else None,
        "is_current": v.is_current,
        "created_by": str(v.created_by) if v.created_by else None,
        "created_at": v.created_at.isoformat() if v.created_at else None,
        "updated_at": v.updated_at.isoformat() if v.updated_at else None,
        "updated_by": str(v.updated_by) if v.updated_by else None,
    }


def _serialize_reproduction_request(rr: ReproductionRequest) -> dict:
    return {
        "reproduction_id": str(rr.reproduction_id),
        "organization_id": str(rr.organization_id),
        "request_number": rr.request_number,
        "use_request_id": str(rr.use_request_id) if rr.use_request_id else None,
        "object_id": str(rr.object_id) if rr.object_id else None,
        "requester_name": rr.requester_name,
        "requester_institution": rr.requester_institution,
        "requester_email": rr.requester_email,
        "requester_phone": rr.requester_phone,
        "reproduction_type": rr.reproduction_type,
        "reproduction_purpose": rr.reproduction_purpose,
        "intended_use": rr.intended_use,
        "quantity": rr.quantity,
        "format_requested": rr.format_requested,
        "dimensions_requested": rr.dimensions_requested,
        "rights_cleared": rr.rights_cleared,
        "rights_check_date": rr.rights_check_date.isoformat() if rr.rights_check_date else None,
        "rights_cleared_by": str(rr.rights_cleared_by) if rr.rights_cleared_by else None,
        "rights_restrictions": rr.rights_restrictions,
        "credit_line_required": rr.credit_line_required,
        "object_right_id": str(rr.object_right_id) if rr.object_right_id else None,
        "fee_type": rr.fee_type,
        "fee_amount": float(rr.fee_amount) if rr.fee_amount else None,
        "fee_currency": rr.fee_currency,
        "fee_paid": rr.fee_paid,
        "payment_date": rr.payment_date.isoformat() if rr.payment_date else None,
        "master_file_reference": rr.master_file_reference,
        "delivery_method": rr.delivery_method,
        "delivery_date": rr.delivery_date.isoformat() if rr.delivery_date else None,
        "quality_approved": rr.quality_approved,
        "status": rr.status,
        "notes": rr.notes,
        "created_by": str(rr.created_by) if rr.created_by else None,
        "created_at": rr.created_at.isoformat() if rr.created_at else None,
        "updated_at": rr.updated_at.isoformat() if rr.updated_at else None,
    }


# ============================================================================
# VALUATIONS (Procedure 13) — 6 routes
# ============================================================================


@router.get("/api/organizations/{org_id}/collections/valuations", response_model=ValuationListResponse, summary="List valuations")
def list_valuations(
    org_id: UUID,
    limit: int = Query(50, le=500),
    offset: int = Query(0, ge=0),
    valuation_type: str | None = None,
    object_id: str | None = None,
    is_current: str | None = None,
    q: str | None = None,
    auth: AuthContext = Depends(require_permission(Permission.VALUATIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """List valuations."""
    query = db.query(Valuation, CollectionObject).outerjoin(
        CollectionObject, Valuation.object_id == CollectionObject.object_id,
    ).filter(
        Valuation.organization_id == org_id,
    )

    if valuation_type:
        query = query.filter(Valuation.valuation_type == valuation_type)
    if object_id:
        obj_uuid = parse_uuid_or_raise(object_id)
        query = query.filter(Valuation.object_id == obj_uuid)
    if is_current is not None:
        query = query.filter(Valuation.is_current == (is_current.lower() == "true"))
    if q:
        term = f"%{escape_ilike(q)}%"
        query = query.filter(or_(
            CollectionObject.object_number.ilike(term, escape="\\"),
            CollectionObject.object_name.ilike(term, escape="\\"),
            Valuation.valuator_name.ilike(term, escape="\\"),
            Valuation.valuator_organization.ilike(term, escape="\\"),
            Valuation.valuation_note.ilike(term, escape="\\"),
        ))

    total = query.count()
    results = query.order_by(Valuation.created_at.desc()).offset(offset).limit(limit).all()

    valuations = []
    for v, obj in results:
        obj_number = obj.object_number if obj else None
        obj_title = _get_object_title(obj)
        valuations.append(_serialize_valuation(v, object_number=obj_number, object_title=obj_title))

    return {
        "items": valuations,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("/api/organizations/{org_id}/collections/valuations", status_code=201, response_model=ValuationOut, summary="Create valuation")
def create_valuation(
    org_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.VALUATIONS_CREATE)),
    db: Session = Depends(get_db),
):
    """Create valuation."""
    if not body.get("object_id"):
        raise HTTPException(status_code=400, detail="Missing: object_id")
    if not body.get("valuation_type"):
        raise HTTPException(status_code=400, detail="Missing: valuation_type")
    if body.get("valuation_amount") is None:
        raise HTTPException(status_code=400, detail="Missing: valuation_amount")
    if not body.get("valuation_date"):
        raise HTTPException(status_code=400, detail="Missing: valuation_date")

    object_uuid = parse_uuid_or_raise(body["object_id"])

    obj = db.query(CollectionObject).filter(
        CollectionObject.object_id == object_uuid,
        CollectionObject.organization_id == org_id,
    ).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Object not found")

    # Validate optional UUID inputs up front so a malformed id is a 400, not a
    # 500 from deep in the create path (parity with prior behavior).
    if body.get("valuator_id"):
        parse_uuid_or_raise(body["valuator_id"])
    if body.get("authorizer_id"):
        parse_uuid_or_raise(body["authorizer_id"])

    # Create via the shared service — the same code the draft applier runs (it
    # owns the un-mark-prior-current side effect and the optional approval
    # gate). This router is the thin adapter: validate, create, commit.
    from app.services.collections.creation.valuation import (
        create_valuation as _create_valuation,
    )

    try:
        valuation = _create_valuation(
            db, org_id, body, auth.user_id, open_approval=True
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="This valuation may already exist")

    db.refresh(valuation)
    return _serialize_valuation(
        valuation,
        object_number=obj.object_number,
        object_title=_get_object_title(obj),
    )


@router.get("/api/organizations/{org_id}/collections/valuations/{valuation_id}", response_model=ValuationOut, summary="Get valuation")
def get_valuation(
    org_id: UUID,
    valuation_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.VALUATIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get valuation."""
    result = db.query(Valuation, CollectionObject).outerjoin(
        CollectionObject, Valuation.object_id == CollectionObject.object_id,
    ).filter(
        Valuation.valuation_id == valuation_id,
        Valuation.organization_id == org_id,
    ).first()
    if not result:
        raise HTTPException(status_code=404, detail="Valuation not found")

    v, obj = result
    return _serialize_valuation(
        v,
        object_number=obj.object_number if obj else None,
        object_title=_get_object_title(obj),
    )


@router.put("/api/organizations/{org_id}/collections/valuations/{valuation_id}", response_model=ValuationOut, summary="Update valuation")
def update_valuation(
    org_id: UUID,
    valuation_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.VALUATIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Update valuation."""
    valuation = db.query(Valuation).filter(
        Valuation.valuation_id == valuation_id,
        Valuation.organization_id == org_id,
    ).first()
    if not valuation:
        raise HTTPException(status_code=404, detail="Valuation not found")

    updatable = {
        "valuation_type", "valuation_currency", "valuation_date",
        "valuator_name", "valuator_organization", "valuator_credentials",
        "valuation_method", "documentation_reference", "valuation_note",
        "valid_from", "valid_until", "is_current",
        "authorization_date", "authorization_note",
    }

    date_fields = {"valuation_date", "valid_from", "valid_until", "authorization_date"}
    for key in updatable:
        if key in body:
            val = body[key]
            if key in date_fields:
                val = _parse_date(val)
            setattr(valuation, key, val)

    if "valuation_amount" in body:
        valuation.valuation_amount = Decimal(str(body["valuation_amount"]))
    if "valuator_id" in body and body["valuator_id"] is not None:
        valuation.valuator_id = parse_uuid_or_raise(body["valuator_id"])
    if "authorizer_id" in body:
        valuation.authorizer_id = parse_uuid_or_raise(body["authorizer_id"]) if body["authorizer_id"] else None
    if "object_id" in body and body["object_id"] is not None:
        valuation.object_id = parse_uuid_or_raise(body["object_id"])

    valuation.updated_by = auth.user_id
    valuation.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(valuation)
    return _serialize_valuation(valuation)


@router.delete("/api/organizations/{org_id}/collections/valuations/{valuation_id}", response_model=MessageResponse, summary="Delete valuation")
def delete_valuation(
    org_id: UUID,
    valuation_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.VALUATIONS_DELETE)),
    db: Session = Depends(get_db),
):
    """Delete valuation."""
    valuation = db.query(Valuation).filter(
        Valuation.valuation_id == valuation_id,
        Valuation.organization_id == org_id,
    ).first()
    if not valuation:
        raise HTTPException(status_code=404, detail="Valuation not found")

    db.delete(valuation)
    db.commit()
    return {"message": "Valuation deleted successfully"}


@router.get("/api/organizations/{org_id}/collections/objects/{object_id}/valuations", response_model=ObjectValuationListResponse, summary="List object valuations")
def list_object_valuations(
    org_id: UUID,
    object_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.VALUATIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """List object valuations."""
    valuations = db.query(Valuation).filter(
        Valuation.object_id == object_id,
        Valuation.organization_id == org_id,
    ).order_by(Valuation.valuation_date.desc()).all()

    return {
        "valuations": [_serialize_valuation(v) for v in valuations],
        "total": len(valuations),
    }


# ============================================================================
# REPRODUCTION REQUESTS (Procedure 19) — 7 routes
# ============================================================================


@router.get("/api/organizations/{org_id}/collections/reproduction-requests", response_model=ReproductionRequestListResponse, summary="List reproduction requests")
def list_reproduction_requests(
    org_id: UUID,
    limit: int = Query(50, le=500),
    offset: int = Query(0, ge=0),
    status: str | None = None,
    reproduction_type: str | None = None,
    object_id: str | None = None,
    q: str | None = None,
    auth: AuthContext = Depends(require_permission(Permission.REPRODUCTION_REQUESTS_VIEW)),
    db: Session = Depends(get_db),
):
    """List reproduction requests."""
    query = db.query(ReproductionRequest).filter(
        ReproductionRequest.organization_id == org_id,
    )

    if status:
        query = query.filter(ReproductionRequest.status == status)
    if reproduction_type:
        query = query.filter(ReproductionRequest.reproduction_type == reproduction_type)
    if object_id:
        obj_uuid = parse_uuid_or_raise(object_id)
        query = query.filter(ReproductionRequest.object_id == obj_uuid)
    if q:
        term = f"%{escape_ilike(q)}%"
        query = query.filter(or_(
            ReproductionRequest.request_number.ilike(term, escape="\\"),
            ReproductionRequest.requester_name.ilike(term, escape="\\"),
            ReproductionRequest.requester_institution.ilike(term, escape="\\"),
            ReproductionRequest.intended_use.ilike(term, escape="\\"),
            ReproductionRequest.notes.ilike(term, escape="\\"),
        ))

    total = query.count()
    requests = query.order_by(ReproductionRequest.created_at.desc()).offset(offset).limit(limit).all()

    return {
        "items": [_serialize_reproduction_request(r) for r in requests],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("/api/organizations/{org_id}/collections/reproduction-requests", status_code=201, response_model=ReproductionRequestOut, summary="Create reproduction request")
def create_reproduction_request(
    org_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.REPRODUCTION_REQUESTS_CREATE)),
    db: Session = Depends(get_db),
):
    """Create reproduction request."""
    if not body.get("request_number"):
        raise HTTPException(status_code=400, detail="Missing: request_number")
    if not body.get("requester_name"):
        raise HTTPException(status_code=400, detail="Missing: requester_name")
    if not body.get("reproduction_type"):
        raise HTTPException(status_code=400, detail="Missing: reproduction_type")

    # Validate optional UUID inputs up front so a malformed id is a 400, not a
    # 500 from the create path (parity with prior behavior).
    if body.get("use_request_id"):
        parse_uuid_or_raise(body["use_request_id"])
    if body.get("object_id"):
        parse_uuid_or_raise(body["object_id"])

    # Create via the shared service — the same code the draft applier runs.
    from app.services.collections.creation.reproduction_request import (
        create_reproduction_request as _create_reproduction_request,
    )

    try:
        rr = _create_reproduction_request(db, org_id, body, auth.user_id, open_approval=True)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A request with this number may already exist")

    db.refresh(rr)
    return _serialize_reproduction_request(rr)


@router.get("/api/organizations/{org_id}/collections/reproduction-requests/{reproduction_id}", response_model=ReproductionRequestOut, summary="Get reproduction request")
def get_reproduction_request(
    org_id: UUID,
    reproduction_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.REPRODUCTION_REQUESTS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get reproduction request."""
    rr = db.query(ReproductionRequest).filter(
        ReproductionRequest.reproduction_id == reproduction_id,
        ReproductionRequest.organization_id == org_id,
    ).first()
    if not rr:
        raise HTTPException(status_code=404, detail="Reproduction request not found")

    return _serialize_reproduction_request(rr)


@router.put("/api/organizations/{org_id}/collections/reproduction-requests/{reproduction_id}", response_model=ReproductionRequestOut, summary="Update reproduction request")
def update_reproduction_request(
    org_id: UUID,
    reproduction_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.REPRODUCTION_REQUESTS_EDIT)),
    db: Session = Depends(get_db),
):
    """Update reproduction request."""
    rr = db.query(ReproductionRequest).filter(
        ReproductionRequest.reproduction_id == reproduction_id,
        ReproductionRequest.organization_id == org_id,
    ).first()
    if not rr:
        raise HTTPException(status_code=404, detail="Reproduction request not found")

    updatable = {
        "requester_name", "requester_institution", "requester_email", "requester_phone",
        "reproduction_type", "reproduction_purpose", "intended_use",
        "quantity", "format_requested", "dimensions_requested",
        "rights_restrictions", "credit_line_required",
        "fee_type", "fee_currency", "fee_paid",
        "master_file_reference", "delivery_method", "quality_approved",
        "notes",
    }

    for key in updatable:
        if key in body:
            setattr(rr, key, body[key])

    if "fee_amount" in body and body["fee_amount"] is not None:
        rr.fee_amount = Decimal(str(body["fee_amount"]))
    if "object_id" in body and body["object_id"] is not None:
        rr.object_id = parse_uuid_or_raise(body["object_id"])
    if "payment_date" in body:
        rr.payment_date = body["payment_date"]
    if "delivery_date" in body:
        rr.delivery_date = body["delivery_date"]

    rr.updated_by = auth.user_id
    rr.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(rr)
    return _serialize_reproduction_request(rr)


@router.delete("/api/organizations/{org_id}/collections/reproduction-requests/{reproduction_id}", response_model=MessageResponse, summary="Delete reproduction request")
def delete_reproduction_request(
    org_id: UUID,
    reproduction_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.REPRODUCTION_REQUESTS_DELETE)),
    db: Session = Depends(get_db),
):
    """Delete reproduction request."""
    rr = db.query(ReproductionRequest).filter(
        ReproductionRequest.reproduction_id == reproduction_id,
        ReproductionRequest.organization_id == org_id,
    ).first()
    if not rr:
        raise HTTPException(status_code=404, detail="Reproduction request not found")

    db.delete(rr)
    db.commit()
    return {"message": "Reproduction request deleted successfully"}


@router.post("/api/organizations/{org_id}/collections/reproduction-requests/{reproduction_id}/clear-rights", response_model=ReproductionRequestOut, summary="Clear reproduction rights")
def clear_reproduction_rights(
    org_id: UUID,
    reproduction_id: UUID,
    body: dict | None = None,
    auth: AuthContext = Depends(require_permission(Permission.REPRODUCTION_REQUESTS_APPROVE)),
    db: Session = Depends(get_db),
):
    """Clear reproduction rights."""
    body = body or {}

    rr = db.query(ReproductionRequest).filter(
        ReproductionRequest.reproduction_id == reproduction_id,
        ReproductionRequest.organization_id == org_id,
    ).first()
    if not rr:
        raise HTTPException(status_code=404, detail="Reproduction request not found")

    rr.rights_cleared = True
    rr.rights_check_date = date.today()
    rr.rights_cleared_by = auth.user_id
    rr.status = "approved"

    if body.get("rights_restrictions"):
        rr.rights_restrictions = body["rights_restrictions"]
    if body.get("credit_line_required"):
        rr.credit_line_required = body["credit_line_required"]
    if body.get("object_right_id"):
        rr.object_right_id = parse_uuid_or_raise(body["object_right_id"])

    rr.updated_by = auth.user_id
    rr.updated_at = datetime.now(timezone.utc)

    db.commit()

    ref = rr.request_number
    try:
        notify_approval(org_id, "reproduction_request", rr.reproduction_id, ref, auth.user_id, entity=rr)
    except Exception:
        logger.warning("Failed to send approval notification for reproduction request %s", reproduction_id)

    db.refresh(rr)
    return _serialize_reproduction_request(rr)


@router.post("/api/organizations/{org_id}/collections/reproduction-requests/{reproduction_id}/deliver", response_model=ReproductionRequestOut, summary="Deliver reproduction")
def deliver_reproduction(
    org_id: UUID,
    reproduction_id: UUID,
    body: dict | None = None,
    auth: AuthContext = Depends(require_permission(Permission.REPRODUCTION_REQUESTS_EDIT)),
    db: Session = Depends(get_db),
):
    """Deliver reproduction."""
    body = body or {}

    rr = db.query(ReproductionRequest).filter(
        ReproductionRequest.reproduction_id == reproduction_id,
        ReproductionRequest.organization_id == org_id,
    ).first()
    if not rr:
        raise HTTPException(status_code=404, detail="Reproduction request not found")

    if rr.status not in ("approved", "in_production"):
        raise HTTPException(status_code=400, detail=f"Cannot deliver with status '{rr.status}'")

    old_status = rr.status
    rr.status = "delivered"
    rr.delivery_date = date.today()

    if body.get("delivery_method"):
        rr.delivery_method = body["delivery_method"]
    elif not rr.delivery_method:
        rr.delivery_method = "download"

    if body.get("master_file_reference"):
        rr.master_file_reference = body["master_file_reference"]

    rr.updated_by = auth.user_id
    rr.updated_at = datetime.now(timezone.utc)

    db.commit()

    ref = rr.request_number
    try:
        notify_status_change(
            org_id, "reproduction_request", rr.reproduction_id, ref,
            old_status, "delivered", auth.user_id, entity=rr,
        )
    except Exception:
        logger.warning("Failed to send status change notification for reproduction request %s", reproduction_id)

    db.refresh(rr)
    return _serialize_reproduction_request(rr)
