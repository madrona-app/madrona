"""
Loan endpoints (procedures) – FastAPI.

Manages incoming and outgoing loan workflows.
"""

import logging
from uuid import UUID
from datetime import date, datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_auth, require_permission
from app.models import (
    CollectionObject,
    LoanIn,
    LoanInObject,
    LoanInEntry,
    LoanOut,
    LoanOutObject,
    ObjectEntry,
)
from app.permissions import Permission
from app.services.api_security import escape_ilike
from app.services.field_access_service import apply_field_access, get_write_restricted_fields
from app.services.entity_notifications import notify_status_change, notify_approval
from app.fastapi_app.serializers.collections import (
    _serialize_loan_in,
    _serialize_loan_in_object,
    _serialize_loan_out,
    _serialize_loan_out_object,
)
from app.services.procedure_enforcement import check_blocking_requirements
from app.fastapi_app.schemas.collections_loans import (
    LoanInOut,
    LoanInDetailOut,
    LoanInListResponse,
    LoanInObjectOut,
    LoanInObjectListResponse,
    LoanInEntryOut,
    LoanInEntryListResponse,
    EntryLinkedLoansResponse,
    LoanOutItemOut,
    LoanOutDetailOut,
    LoanOutListResponse,
    LoanOutObjectOut,
    LoanOutObjectListResponse,
    LoanOutObjectsAddedResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["collections-loans"])


def _enforce_procedure(organization_id: UUID, procedure_type: str, entity, target_status: str, db: Session):
    """Raise 422 if procedure enforcement is enabled and blocking requirements are unmet."""
    missing = check_blocking_requirements(organization_id, procedure_type, entity, target_status, db)
    if missing:
        raise HTTPException(status_code=422, detail={
            "code": "procedure_requirements_not_met",
            "message": f"Cannot advance to {target_status}: unmet requirements",
            "blocking_requirements": missing,
        })


# ============================================================================
# LOANS IN ENDPOINTS
# ============================================================================


@router.post("/api/organizations/{organization_id}/collections/loans-in", status_code=201, response_model=LoanInOut, summary="Create loan in")
def create_loan_in(
    organization_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.LOANS_CREATE)),
    db: Session = Depends(get_db),
):
    """Create a new loan in record."""
    if not data.get("loan_purpose"):
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "Missing: loan_purpose",
        })

    from app.services.collections.field_enums import validate_enum_fields
    validate_enum_fields(LoanIn, data)

    # Create via the shared service — the same code the draft applier runs. It
    # owns the LI number and the loan_in/create approval gate.
    from app.services.collections.creation.loan_in import (
        create_loan_in as _create_loan_in,
    )

    try:
        loan = _create_loan_in(db, organization_id, data, auth.user_id, open_approval=True)
        db.commit()
    except Exception:
        db.rollback()
        raise

    return _serialize_loan_in(loan)


@router.get("/api/organizations/{organization_id}/collections/loans-in", response_model=LoanInListResponse, summary="List loans in")
def list_loans_in(
    organization_id: UUID,
    limit: int = Query(50, le=500),
    offset: int = Query(0),
    status: str | None = Query(None),
    loan_purpose: str | None = Query(None),
    entry_id: str | None = Query(None),
    q: str = Query(""),
    auth: AuthContext = Depends(require_permission(Permission.LOANS_VIEW)),
    db: Session = Depends(get_db),
):
    """List incoming loans with filtering and search."""
    query = db.query(LoanIn).filter(LoanIn.organization_id == organization_id)

    search = q.strip()
    if search:
        search_term = f"%{escape_ilike(search)}%"
        query = query.filter(
            or_(
                LoanIn.loan_number.ilike(search_term, escape="\\"),
                LoanIn.lender_name.ilike(search_term, escape="\\"),
                LoanIn.loan_note.ilike(search_term, escape="\\"),
            )
        )
    if status:
        query = query.filter(LoanIn.status == status)
    if loan_purpose:
        query = query.filter(LoanIn.loan_purpose == loan_purpose)
    if entry_id:
        query = query.filter(LoanIn.entry_id == UUID(entry_id))

    total = query.count()
    loans = (
        query
        .options(selectinload(LoanIn.renewals))
        .order_by(LoanIn.request_date.desc())
        .offset(offset).limit(limit).all()
    )

    serialized = [
        apply_field_access(_serialize_loan_in(l), 'loan_in', str(organization_id), str(auth.user_id), session=db, role_override=auth.role_override)
        for l in loans
    ]
    return {
        "items": serialized,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/api/organizations/{organization_id}/collections/loans-in/{loan_id}", response_model=LoanInDetailOut, summary="Get loan in")
def get_loan_in(
    organization_id: UUID,
    loan_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.LOANS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get a single loan in."""
    loan = (
        db.query(LoanIn)
        .filter(
            LoanIn.loan_in_id == loan_id,
            LoanIn.organization_id == organization_id,
        )
        .options(selectinload(LoanIn.renewals))
        .first()
    )

    if not loan:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Loan not found",
        })

    result = _serialize_loan_in(loan)

    # Include objects with details — eager load object + title_links to avoid N+1
    objects = (
        db.query(LoanInObject)
        .filter(LoanInObject.loan_in_id == loan.loan_in_id)
        .options(
            joinedload(LoanInObject.object).selectinload(CollectionObject.title_links)
        )
        .all()
    )
    result["objects"] = [_serialize_loan_in_object(o, include_object=True) for o in objects]

    filtered = apply_field_access(result, 'loan_in', str(organization_id), str(auth.user_id), session=db, role_override=auth.role_override)
    return filtered


@router.put("/api/organizations/{organization_id}/collections/loans-in/{loan_id}", response_model=LoanInOut, summary="Update loan in")
def update_loan_in(
    organization_id: UUID,
    loan_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.LOANS_EDIT)),
    db: Session = Depends(get_db),
):
    """Update a loan in."""
    loan = db.query(LoanIn).filter(
        LoanIn.loan_in_id == loan_id,
        LoanIn.organization_id == organization_id,
    ).first()

    if not loan:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Loan not found",
        })

    from app.services.collections.field_enums import validate_enum_fields
    validate_enum_fields(LoanIn, data)

    old_status = loan.status

    # Optimistic concurrency — reject stale updates
    from app.services.coerce import coerce_value_for_column, check_version
    check_version(loan, data)

    old_status = loan.status
    new_status = data.pop('status', None)

    protected_fields = {
        'loan_in_id', 'organization_id', 'loan_number', 'created_at', 'created_by',
        'updated_by', 'approved_by', 'approval_date', 'approved_at', 'version',
    }
    protected_fields |= get_write_restricted_fields('loan_in', str(organization_id), str(auth.user_id), session=db, role_override=auth.role_override)
    for key, value in data.items():
        if hasattr(loan, key) and key not in protected_fields:
            if key.endswith('_id') and value:
                setattr(loan, key, UUID(value))
            else:
                setattr(loan, key, coerce_value_for_column(LoanIn, key, value))

    if new_status and new_status != old_status:
        from app.services.workflow_definitions import WORKFLOW_DEFINITIONS
        workflow = WORKFLOW_DEFINITIONS.get('loan_in')
        if workflow and new_status not in workflow.valid_statuses:
            raise HTTPException(status_code=409, detail={"code": "invalid_status", "message": f"'{new_status}' is not a valid status"})
        _enforce_procedure(organization_id, "loan_in", loan, new_status, db)
        loan.status = new_status

    loan.updated_by = auth.user_id
    loan.updated_at = datetime.now(timezone.utc)

    # If edited while pending_approval, resubmit so approver reviews fresh data
    if loan.status == 'pending_approval':
        from app.services.approval_service import resubmit_approval
        changed = [k for k in data.keys() if k not in protected_fields and hasattr(loan, k)]
        resubmit_approval(organization_id, 'loan_in', loan.loan_in_id, auth.user_id, db, changed_fields=changed)

    db.commit()

    if new_status and new_status != old_status:
        notify_status_change(organization_id, 'loan_in', loan.loan_in_id, loan.loan_number,
                             old_status, new_status, str(auth.user_id), entity=loan)

    return _serialize_loan_in(loan)


@router.post("/api/organizations/{organization_id}/collections/loans-in/{loan_id}/approve", response_model=LoanInOut, summary="Approve loan in")
def approve_loan_in(
    organization_id: UUID,
    loan_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.LOANS_APPROVE)),
    db: Session = Depends(get_db),
):
    """Approve a loan in."""
    loan = db.query(LoanIn).filter(
        LoanIn.loan_in_id == loan_id,
        LoanIn.organization_id == organization_id,
    ).first()

    if not loan:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Loan not found",
        })

    _enforce_procedure(organization_id, "loan_in", loan, "approved", db)

    from app.services.status_transitions import require_status, InvalidTransitionError
    try:
        require_status(loan, ["requested", "pending_approval"], "approve")
    except InvalidTransitionError as e:
        raise HTTPException(status_code=409, detail={"code": "invalid_transition", "message": str(e)})

    old_status = loan.status
    loan.status = "approved"
    loan.approval_date = datetime.now(timezone.utc).date()
    loan.approved_by = auth.user_id
    loan.updated_by = auth.user_id
    loan.updated_at = datetime.now(timezone.utc)

    db.commit()

    notify_approval(organization_id, 'loan_in', loan.loan_in_id, loan.loan_number,
                    str(auth.user_id), entity=loan)

    return _serialize_loan_in(loan)


@router.post("/api/organizations/{organization_id}/collections/loans-in/{loan_id}/receive", response_model=LoanInOut, summary="Receive loan in")
def receive_loan_in(
    organization_id: UUID,
    loan_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.LOANS_EDIT)),
    db: Session = Depends(get_db),
):
    """Mark loan objects as received."""
    loan = db.query(LoanIn).filter(
        LoanIn.loan_in_id == loan_id,
        LoanIn.organization_id == organization_id,
    ).first()

    if not loan:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Loan not found",
        })

    from app.services.status_transitions import require_status, InvalidTransitionError
    try:
        require_status(loan, ["agreement_signed", "in_transit"], "receive")
    except InvalidTransitionError as e:
        raise HTTPException(status_code=409, detail={"code": "invalid_transition", "message": str(e)})

    old_status = loan.status
    loan.status = "received"
    loan.actual_receipt_date = datetime.now(timezone.utc).date()
    loan.updated_by = auth.user_id
    loan.updated_at = datetime.now(timezone.utc)

    db.commit()

    notify_status_change(organization_id, 'loan_in', loan.loan_in_id, loan.loan_number,
                         old_status, 'received', str(auth.user_id), entity=loan)

    return _serialize_loan_in(loan)


@router.post("/api/organizations/{organization_id}/collections/loans-in/{loan_id}/rollback", response_model=LoanInOut, summary="Rollback loan in")
def rollback_loan_in(
    organization_id: UUID,
    loan_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.LOANS_ROLLBACK)),
    db: Session = Depends(get_db),
):
    """Rollback a loan in to a previous status."""
    from app.services.workflow_definitions import WORKFLOW_DEFINITIONS
    from app.services.status_transitions import rollback_entity, InvalidTransitionError
    from app.services.audit_service import log_audit_event

    target_status = data.get("target_status")
    if not target_status:
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "Missing: target_status",
        })

    reason = (data.get("reason") or "").strip()
    if not reason:
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "A reason is required when reverting status",
            "field": "reason",
        })

    workflow = WORKFLOW_DEFINITIONS["loan_in"]

    loan = db.query(LoanIn).filter(
        LoanIn.loan_in_id == loan_id,
        LoanIn.organization_id == organization_id,
    ).first()

    if not loan:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Loan not found",
        })

    try:
        old_status = rollback_entity(
            loan, target_status, workflow, auth.user_id,
            session=db, organization_id=organization_id,
        )
    except InvalidTransitionError as e:
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": str(e),
        })

    log_audit_event(
        session=db,
        organization_id=organization_id,
        acting_user_id=auth.user_id,
        action="loan_in.rollback",
        details={
            "entity_id": str(loan_id),
            "old_status": old_status,
            "new_status": target_status,
            "reason": reason,
        },
    )

    db.commit()

    notify_status_change(organization_id, 'loan_in', loan.loan_in_id, loan.loan_number,
                         old_status, target_status, str(auth.user_id), entity=loan)

    return _serialize_loan_in(loan)


# ============================================================================
# LOAN IN OBJECTS ENDPOINTS
# ============================================================================


@router.get("/api/organizations/{organization_id}/collections/loans-in/{loan_id}/objects", response_model=LoanInObjectListResponse, summary="List loan in objects")
def list_loan_in_objects(
    organization_id: UUID,
    loan_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.LOANS_VIEW)),
    db: Session = Depends(get_db),
):
    """List objects in an incoming loan."""
    loan = db.query(LoanIn).filter(
        LoanIn.loan_in_id == loan_id,
        LoanIn.organization_id == organization_id,
    ).first()

    if not loan:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Loan not found",
        })

    objects = db.query(LoanInObject).filter(
        LoanInObject.loan_in_id == loan_id,
        LoanInObject.organization_id == organization_id,
    ).options(
        joinedload(LoanInObject.object).selectinload(CollectionObject.title_links),
    ).all()

    return {
        "objects": [_serialize_loan_in_object(o, include_object=True) for o in objects],
        "total": len(objects),
    }


@router.post("/api/organizations/{organization_id}/collections/loans-in/{loan_id}/objects", status_code=201, response_model=LoanInObjectOut, summary="Add loan in object")
def add_loan_in_object(
    organization_id: UUID,
    loan_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.LOANS_EDIT)),
    db: Session = Depends(get_db),
):
    """Add an object to an incoming loan."""
    loan = db.query(LoanIn).filter(
        LoanIn.loan_in_id == loan_id,
        LoanIn.organization_id == organization_id,
    ).first()

    if not loan:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Loan not found",
        })

    if loan.status == "returned":
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": "Cannot add objects to returned loan",
        })

    # object_id is optional for borrowed objects (they may not be in our collection)
    object_id = UUID(data["object_id"]) if data.get("object_id") else None

    loan_object = LoanInObject(
        loan_in_id=loan_id,
        organization_id=organization_id,
        object_id=object_id,
        object_number_lender=data.get("object_number_lender"),
        object_title=data.get("object_title"),
        object_description=data.get("object_description"),
        artist_maker=data.get("artist_maker"),
        date_description=data.get("date_description"),
        insurance_value=data.get("insurance_value"),
        insurance_currency=data.get("insurance_currency", "USD"),
        dimensions=data.get("dimensions"),
        medium=data.get("medium"),
        special_requirements=data.get("special_requirements"),
        display_requirements=data.get("display_requirements"),
        item_status="pending",
    )

    try:
        db.add(loan_object)
        db.commit()
    except Exception:
        db.rollback()
        raise

    return _serialize_loan_in_object(loan_object, include_object=True)


@router.put("/api/organizations/{organization_id}/collections/loans-in/{loan_id}/objects/{loan_object_id}", response_model=LoanInObjectOut, summary="Update loan in object")
def update_loan_in_object(
    organization_id: UUID,
    loan_id: UUID,
    loan_object_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.LOANS_EDIT)),
    db: Session = Depends(get_db),
):
    """Update a loan object's details."""
    loan_object = db.query(LoanInObject).filter(
        LoanInObject.loan_object_id == loan_object_id,
        LoanInObject.loan_in_id == loan_id,
        LoanInObject.organization_id == organization_id,
    ).first()

    if not loan_object:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Loan object not found",
        })

    # Update allowed fields
    updatable_fields = [
        'object_number_lender', 'object_title', 'object_description',
        'artist_maker', 'date_description', 'insurance_value', 'insurance_currency',
        'dimensions', 'medium', 'special_requirements', 'display_requirements',
        'condition_in_note', 'condition_out_note', 'item_status',
    ]

    for field in updatable_fields:
        if field in data:
            setattr(loan_object, field, data[field])

    # Handle date fields
    if 'received_date' in data:
        loan_object.received_date = datetime.strptime(data['received_date'], '%Y-%m-%d').date() if data['received_date'] else None
    if 'returned_date' in data:
        loan_object.returned_date = datetime.strptime(data['returned_date'], '%Y-%m-%d').date() if data['returned_date'] else None

    # Handle FK fields
    if 'object_id' in data:
        loan_object.object_id = UUID(data['object_id']) if data['object_id'] else None
    if 'condition_report_in_id' in data:
        loan_object.condition_report_in_id = UUID(data['condition_report_in_id']) if data['condition_report_in_id'] else None
    if 'condition_report_out_id' in data:
        loan_object.condition_report_out_id = UUID(data['condition_report_out_id']) if data['condition_report_out_id'] else None
    if 'current_location_id' in data:
        loan_object.current_location_id = UUID(data['current_location_id']) if data['current_location_id'] else None

    db.commit()

    return _serialize_loan_in_object(loan_object, include_object=True)


@router.delete("/api/organizations/{organization_id}/collections/loans-in/{loan_id}/objects/{loan_object_id}", summary="Remove loan in object")
def remove_loan_in_object(
    organization_id: UUID,
    loan_id: UUID,
    loan_object_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.LOANS_EDIT)),
    db: Session = Depends(get_db),
):
    """Remove an object from an incoming loan."""
    loan = db.query(LoanIn).filter(
        LoanIn.loan_in_id == loan_id,
        LoanIn.organization_id == organization_id,
    ).first()

    if not loan:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Loan not found",
        })

    if loan.status == "returned":
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": "Cannot remove objects from returned loan",
        })

    loan_object = db.query(LoanInObject).filter(
        LoanInObject.loan_object_id == loan_object_id,
        LoanInObject.loan_in_id == loan_id,
        LoanInObject.organization_id == organization_id,
    ).first()

    if not loan_object:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Loan object not found",
        })

    db.delete(loan_object)
    db.commit()

    return Response(status_code=204)


# ============================================================================
# LOAN IN - OBJECT ENTRY LINKS
# ============================================================================


@router.get("/api/organizations/{organization_id}/collections/loans-in/{loan_id}/object-entries", response_model=LoanInEntryListResponse, summary="List loan in entries")
def list_loan_in_object_entries(
    organization_id: UUID,
    loan_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.LOANS_VIEW)),
    db: Session = Depends(get_db),
):
    """List object entries linked to a loan in."""
    entries = db.query(LoanInEntry).options(
        joinedload(LoanInEntry.entry).joinedload(ObjectEntry.depositor),
    ).filter(
        LoanInEntry.loan_in_id == loan_id,
        LoanInEntry.organization_id == organization_id,
    ).all()

    def get_depositor_name(entry):
        if not entry:
            return None
        if entry.depositor:
            return entry.depositor.name
        return entry.depositor_name

    def get_location_name(entry):
        # ObjectEntry has no location relationship — individual items each
        # carry their own location on ObjectEntryItem. Return None at the
        # entry level; the UI can show per-item locations if needed.
        return None

    return {
        "entries": [{
            "loan_in_entry_id": str(e.loan_in_entry_id),
            "entry_id": str(e.entry_id),
            "entry_number": e.entry.entry_number if e.entry else None,
            "entry_date": e.entry.entry_date.isoformat() if e.entry and e.entry.entry_date else None,
            "depositor_name": get_depositor_name(e.entry),
            "location_name": get_location_name(e.entry),
            "objects_description": e.entry.objects_description if e.entry else None,
            "status": e.entry.status if e.entry else None,
            "notes": e.notes,
            "created_at": e.created_at.isoformat() if e.created_at else None,
        } for e in entries]
    }


@router.post("/api/organizations/{organization_id}/collections/loans-in/{loan_id}/object-entries", status_code=201, response_model=LoanInEntryOut, summary="Link entry to loan in")
def add_loan_in_object_entry(
    organization_id: UUID,
    loan_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.LOANS_EDIT)),
    db: Session = Depends(get_db),
):
    """Link an object entry to a loan in."""
    entry_id = data.get("entry_id")
    if not entry_id:
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "entry_id is required",
        })

    entry_uuid = UUID(entry_id)

    # Verify loan exists
    loan = db.query(LoanIn).filter(
        LoanIn.loan_in_id == loan_id,
        LoanIn.organization_id == organization_id,
    ).first()

    if not loan:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Loan not found",
        })

    # Verify entry exists
    entry = db.query(ObjectEntry).filter(
        ObjectEntry.entry_id == entry_uuid,
        ObjectEntry.organization_id == organization_id,
    ).first()

    if not entry:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Object entry not found",
        })

    # Check if link already exists
    existing = db.query(LoanInEntry).filter(
        LoanInEntry.loan_in_id == loan_id,
        LoanInEntry.entry_id == entry_uuid,
    ).first()

    if existing:
        raise HTTPException(status_code=409, detail={
            "code": "conflict",
            "message": "Entry is already linked to this loan",
        })

    # Create link
    link = LoanInEntry(
        loan_in_id=loan_id,
        entry_id=entry_uuid,
        organization_id=organization_id,
        notes=data.get("notes"),
    )
    db.add(link)
    try:
        db.commit()

        return {
            "loan_in_entry_id": str(link.loan_in_entry_id),
            "entry_id": str(link.entry_id),
            "entry_number": entry.entry_number,
            "entry_date": entry.entry_date.isoformat() if entry.entry_date else None,
            "depositor_name": entry.depositor_name,
            "notes": link.notes,
            "created_at": link.created_at.isoformat() if link.created_at else None,
        }

    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail={
            "code": "conflict",
            "message": "Entry is already linked to this loan",
        })


@router.delete("/api/organizations/{organization_id}/collections/loans-in/{loan_id}/object-entries/{loan_in_entry_id}", summary="Unlink entry from loan in")
def remove_loan_in_object_entry(
    organization_id: UUID,
    loan_id: UUID,
    loan_in_entry_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.LOANS_EDIT)),
    db: Session = Depends(get_db),
):
    """Remove an object entry link from a loan in."""
    link = db.query(LoanInEntry).filter(
        LoanInEntry.loan_in_entry_id == loan_in_entry_id,
        LoanInEntry.loan_in_id == loan_id,
        LoanInEntry.organization_id == organization_id,
    ).first()

    if not link:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Entry link not found",
        })

    db.delete(link)
    db.commit()

    return Response(status_code=204)


@router.get("/api/organizations/{organization_id}/collections/entries/{entry_id}/loans-in", response_model=EntryLinkedLoansResponse, summary="List entry linked loans")
def get_entry_linked_loans(
    organization_id: UUID,
    entry_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.LOANS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get loans linked to an object entry via the LoanInEntry join table."""
    links = db.query(LoanInEntry).options(
        joinedload(LoanInEntry.loan)
    ).filter(
        LoanInEntry.entry_id == entry_id,
        LoanInEntry.organization_id == organization_id,
    ).all()

    result = []
    for link in links:
        if link.loan:
            loan_data = _serialize_loan_in(link.loan)
            loan_data["loan_in_entry_id"] = str(link.loan_in_entry_id)
            result.append(loan_data)

    return {"loans_in": result, "total": len(result)}


# ============================================================================
# LOANS OUT ENDPOINTS
# ============================================================================


@router.post("/api/organizations/{organization_id}/collections/loans-out", status_code=201, response_model=LoanOutItemOut, summary="Create loan out")
def create_loan_out(
    organization_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.LOANS_CREATE)),
    db: Session = Depends(get_db),
):
    """Create a new loan out record."""
    if not data.get("loan_purpose"):
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "Missing: loan_purpose",
        })

    from app.services.collections.field_enums import validate_enum_fields
    validate_enum_fields(LoanOut, data)

    # Create via the shared service — the same code the draft applier runs. It
    # owns the LO number and the loan_out/create approval gate.
    from app.services.collections.creation.loan_out import (
        create_loan_out as _create_loan_out,
    )

    try:
        loan = _create_loan_out(db, organization_id, data, auth.user_id, open_approval=True)
        db.commit()
    except Exception:
        db.rollback()
        raise

    return _serialize_loan_out(loan)


@router.get("/api/organizations/{organization_id}/collections/loans-out", response_model=LoanOutListResponse, summary="List loans out")
def list_loans_out(
    organization_id: UUID,
    limit: int = Query(50, le=500),
    offset: int = Query(0),
    status: str | None = Query(None),
    loan_purpose: str | None = Query(None),
    q: str = Query(""),
    auth: AuthContext = Depends(require_permission(Permission.LOANS_VIEW)),
    db: Session = Depends(get_db),
):
    """List outgoing loans with filtering and search."""
    query = db.query(LoanOut).filter(LoanOut.organization_id == organization_id)

    search = q.strip()
    if search:
        search_term = f"%{escape_ilike(search)}%"
        query = query.filter(
            or_(
                LoanOut.loan_number.ilike(search_term, escape="\\"),
                LoanOut.borrower_name.ilike(search_term, escape="\\"),
                LoanOut.venue_name.ilike(search_term, escape="\\"),
                LoanOut.exhibition_title.ilike(search_term, escape="\\"),
                LoanOut.loan_note.ilike(search_term, escape="\\"),
            )
        )
    if status:
        query = query.filter(LoanOut.status == status)
    if loan_purpose:
        query = query.filter(LoanOut.loan_purpose == loan_purpose)

    total = query.count()
    loans = (
        query
        .options(selectinload(LoanOut.renewals))
        .order_by(LoanOut.request_date.desc())
        .offset(offset).limit(limit).all()
    )

    serialized = [
        apply_field_access(_serialize_loan_out(l), 'loan_out', str(organization_id), str(auth.user_id), session=db, role_override=auth.role_override)
        for l in loans
    ]
    return {
        "items": serialized,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/api/organizations/{organization_id}/collections/loans-out/{loan_id}", response_model=LoanOutDetailOut, summary="Get loan out")
def get_loan_out(
    organization_id: UUID,
    loan_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.LOANS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get a single loan out."""
    loan = (
        db.query(LoanOut)
        .filter(
            LoanOut.loan_out_id == loan_id,
            LoanOut.organization_id == organization_id,
        )
        .options(selectinload(LoanOut.renewals))
        .first()
    )

    if not loan:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Loan not found",
        })

    result = _serialize_loan_out(loan)

    # Include objects with object details — eager load object + title_links to avoid N+1
    objects = (
        db.query(LoanOutObject)
        .filter(LoanOutObject.loan_out_id == loan.loan_out_id)
        .options(
            joinedload(LoanOutObject.object).selectinload(CollectionObject.title_links),
            joinedload(LoanOutObject.condition_report_out),
            joinedload(LoanOutObject.condition_report_return),
            joinedload(LoanOutObject.exit),
        )
        .all()
    )
    result["objects"] = [_serialize_loan_out_object(o, include_object=True) for o in objects]

    filtered = apply_field_access(result, 'loan_out', str(organization_id), str(auth.user_id), session=db, role_override=auth.role_override)
    return filtered


def _update_object_exhibition_history(db: Session, loan: LoanOut):
    """Append a loan-out entry to each linked object's exhibition_history JSONB field."""
    loan_objects = db.query(LoanOutObject).filter(
        LoanOutObject.loan_out_id == loan.loan_out_id,
    ).all()

    entry = {
        "type": "loan_out",
        "loan_number": loan.loan_number,
        "borrower": loan.borrower_name,
        "exhibition_title": loan.exhibition_title,
        "start_date": loan.loan_start_date.isoformat() if loan.loan_start_date else None,
        "end_date": loan.actual_return_date.isoformat() if loan.actual_return_date else None,
    }

    for lo in loan_objects:
        obj = db.query(CollectionObject).filter(
            CollectionObject.object_id == lo.object_id,
        ).first()
        if not obj:
            continue

        history = obj.exhibition_history or []
        history.append(entry)
        obj.exhibition_history = history

    db.commit()


@router.put("/api/organizations/{organization_id}/collections/loans-out/{loan_id}", response_model=LoanOutItemOut, summary="Update loan out")
def update_loan_out(
    organization_id: UUID,
    loan_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.LOANS_EDIT)),
    db: Session = Depends(get_db),
):
    """Update a loan out."""
    loan = db.query(LoanOut).filter(
        LoanOut.loan_out_id == loan_id,
        LoanOut.organization_id == organization_id,
    ).first()

    if not loan:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Loan not found",
        })

    from app.services.collections.field_enums import validate_enum_fields
    validate_enum_fields(LoanOut, data)

    old_status = loan.status

    # Optimistic concurrency — reject stale updates
    from app.services.coerce import coerce_value_for_column, check_version
    check_version(loan, data)

    protected_fields = {
        'loan_out_id', 'organization_id', 'loan_number', 'created_at', 'created_by',
        'updated_by', 'approved_by', 'approval_date', 'approved_at', 'version',
        'status',  # status changes must go through workflow action endpoints
    }
    protected_fields |= get_write_restricted_fields('loan_out', str(organization_id), str(auth.user_id), session=db, role_override=auth.role_override)
    for key, value in data.items():
        if hasattr(loan, key) and key not in protected_fields:
            if key.endswith('_id') and value:
                setattr(loan, key, UUID(value))
            else:
                setattr(loan, key, coerce_value_for_column(LoanOut, key, value))

    loan.updated_by = auth.user_id
    loan.updated_at = datetime.now(timezone.utc)

    # If edited while pending_approval, resubmit so approver reviews fresh data
    if loan.status == 'pending_approval':
        from app.services.approval_service import resubmit_approval
        changed = [k for k in data.keys() if k not in protected_fields and hasattr(loan, k)]
        resubmit_approval(organization_id, 'loan_out', loan.loan_out_id, auth.user_id, db, changed_fields=changed)

    db.commit()

    if 'status' in data and loan.status != old_status:
        notify_status_change(organization_id, 'loan_out', loan.loan_out_id, loan.loan_number,
                             old_status, loan.status, str(auth.user_id), entity=loan)

        # When closing a loan, update each linked object's exhibition history
        if loan.status == 'closed':
            _update_object_exhibition_history(db, loan)

    return _serialize_loan_out(loan)


@router.post("/api/organizations/{organization_id}/collections/loans-out/{loan_id}/status", response_model=LoanOutItemOut, summary="Change loan out status")
def change_loan_out_status(
    organization_id: UUID,
    loan_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.LOANS_EDIT)),
    db: Session = Depends(get_db),
):
    """Generic status transition for loan out. Validates the transition and enforces procedure requirements."""
    target_status = data.get("status")
    if not target_status:
        raise HTTPException(status_code=400, detail={"code": "missing_field", "message": "Missing: status"})

    # Dispatch has its own endpoint with auto-exit/movement creation
    if target_status == "in_transit":
        raise HTTPException(status_code=400, detail={
            "code": "use_dispatch",
            "message": "Use the /dispatch endpoint to transition to in_transit",
        })

    loan = db.query(LoanOut).filter(
        LoanOut.loan_out_id == loan_id,
        LoanOut.organization_id == organization_id,
    ).first()

    if not loan:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Loan not found"})

    from app.services.workflow_definitions import WORKFLOW_DEFINITIONS
    workflow = WORKFLOW_DEFINITIONS.get('loan_out')
    if workflow and target_status not in workflow.valid_statuses:
        raise HTTPException(status_code=409, detail={
            "code": "invalid_transition",
            "message": f"'{target_status}' is not a valid loan out status",
        })

    _enforce_procedure(organization_id, "loan_out", loan, target_status, db)

    old_status = loan.status
    loan.status = target_status
    loan.updated_by = auth.user_id
    loan.updated_at = datetime.now(timezone.utc)

    # Set actual dates based on status
    if target_status == "returned" and not loan.actual_return_date:
        loan.actual_return_date = datetime.now(timezone.utc).date()

    db.commit()

    notify_status_change(organization_id, 'loan_out', loan.loan_out_id, loan.loan_number,
                         old_status, target_status, str(auth.user_id), entity=loan)

    if target_status == 'closed':
        _update_object_exhibition_history(db, loan)

    return _serialize_loan_out(loan)


@router.post("/api/organizations/{organization_id}/collections/loans-out/{loan_id}/approve", response_model=LoanOutItemOut, summary="Approve loan out")
def approve_loan_out(
    organization_id: UUID,
    loan_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.LOANS_APPROVE)),
    db: Session = Depends(get_db),
):
    """Approve a loan out."""
    loan = db.query(LoanOut).filter(
        LoanOut.loan_out_id == loan_id,
        LoanOut.organization_id == organization_id,
    ).first()

    if not loan:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Loan not found",
        })

    _enforce_procedure(organization_id, "loan_out", loan, "approved", db)

    from app.services.status_transitions import require_status, InvalidTransitionError
    try:
        require_status(loan, ["requested", "pending_approval"], "approve")
    except InvalidTransitionError as e:
        raise HTTPException(status_code=409, detail={"code": "invalid_transition", "message": str(e)})

    old_status = loan.status
    loan.status = "approved"
    loan.approval_date = datetime.now(timezone.utc).date()
    loan.approved_by = auth.user_id
    loan.updated_by = auth.user_id
    loan.updated_at = datetime.now(timezone.utc)

    db.commit()

    notify_approval(organization_id, 'loan_out', loan.loan_out_id, loan.loan_number,
                    str(auth.user_id), entity=loan)

    return _serialize_loan_out(loan)


@router.post("/api/organizations/{organization_id}/collections/loans-out/{loan_id}/dispatch", response_model=LoanOutItemOut, summary="Dispatch loan out")
def dispatch_loan_out(
    organization_id: UUID,
    loan_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.LOANS_EDIT)),
    db: Session = Depends(get_db),
):
    """Mark loan objects as dispatched.

    Auto-creates an ObjectExit record and Movement records per the procedures.
    """
    loan = db.query(LoanOut).filter(
        LoanOut.loan_out_id == loan_id,
        LoanOut.organization_id == organization_id,
    ).options(joinedload(LoanOut.objects)).first()

    if not loan:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Loan not found",
        })

    _enforce_procedure(organization_id, "loan_out", loan, "in_transit", db)

    from app.services.status_transitions import require_status, InvalidTransitionError
    try:
        require_status(loan, ["approved", "agreement_sent", "agreement_signed"], "dispatch")
    except InvalidTransitionError as e:
        raise HTTPException(status_code=409, detail={"code": "invalid_transition", "message": str(e)})

    old_status = loan.status
    loan.status = "in_transit"
    now = datetime.now(timezone.utc)
    loan.actual_dispatch_date = now.date()
    loan.updated_by = auth.user_id
    loan.updated_at = now

    # Auto-create ObjectExit (5.1) + Movement (6) records and the
    # per-object exit_id back-link. Shared with the sandbox seeder so demo loans
    # get identical exit/movement history.
    from app.services.collections.loan_lifecycle import dispatch_loan_out_effects
    dispatch_loan_out_effects(db, organization_id, loan, auth.user_id, now)

    try:
        db.commit()
    except Exception:
        db.rollback()
        raise

    notify_status_change(organization_id, 'loan_out', loan.loan_out_id, loan.loan_number,
                         old_status, 'in_transit', str(auth.user_id), entity=loan)

    # Return full loan with objects (including newly created exit_id per object)
    result = _serialize_loan_out(loan)
    objects = (
        db.query(LoanOutObject)
        .filter(LoanOutObject.loan_out_id == loan.loan_out_id)
        .options(
            joinedload(LoanOutObject.object).selectinload(CollectionObject.title_links),
            joinedload(LoanOutObject.condition_report_out),
            joinedload(LoanOutObject.condition_report_return),
            joinedload(LoanOutObject.exit),
        )
        .all()
    )
    result["objects"] = [_serialize_loan_out_object(o, include_object=True) for o in objects]
    return result


@router.post("/api/organizations/{organization_id}/collections/loans-out/{loan_id}/return", response_model=LoanOutItemOut, summary="Return loan out")
def return_loan_out(
    organization_id: UUID,
    loan_id: UUID,
    data: dict = Body(default=None),
    auth: AuthContext = Depends(require_permission(Permission.LOANS_EDIT)),
    db: Session = Depends(get_db),
):
    """Mark a dispatched loan out as returned.

    A return is one atomic unit of work: the borrowed objects come back and the
    user must choose where they go. This completes the outbound dispatch
    Movement and creates a return Movement (On Loan -> the chosen location) per
    object. ``to_location_id`` is REQUIRED — without it the return is rejected
    (400) and nothing is committed, so cancelling the location prompt leaves the
    loan unchanged.
    """
    body = data or {}
    to_location_id = body.get("to_location_id")
    if not to_location_id:
        raise HTTPException(status_code=400, detail={
            "code": "location_required",
            "message": "A destination location is required to return the loan.",
        })

    loan = db.query(LoanOut).filter(
        LoanOut.loan_out_id == loan_id,
        LoanOut.organization_id == organization_id,
    ).options(joinedload(LoanOut.objects)).first()

    if not loan:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Loan not found"})

    _enforce_procedure(organization_id, "loan_out", loan, "returned", db)

    from app.services.status_transitions import require_status, InvalidTransitionError
    try:
        require_status(loan, ["on_loan", "return_scheduled", "in_transit"], "return")
    except InvalidTransitionError as e:
        raise HTTPException(status_code=409, detail={"code": "invalid_transition", "message": str(e)})

    old_status = loan.status
    now = datetime.now(timezone.utc)
    loan.status = "returned"
    loan.actual_return_date = now.date()
    loan.updated_by = auth.user_id
    loan.updated_at = now

    # Atomic with the status change: complete the outbound movement and record
    # the return movement to the chosen location. Shared with the seeder.
    from app.services.collections.loan_lifecycle import return_loan_out_effects
    try:
        return_loan_out_effects(db, organization_id, loan, auth.user_id, now, to_location_id)
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail={"code": "invalid_location", "message": str(e)})

    try:
        db.commit()
    except Exception:
        db.rollback()
        raise

    notify_status_change(organization_id, 'loan_out', loan.loan_out_id, loan.loan_number,
                         old_status, 'returned', str(auth.user_id), entity=loan)

    result = _serialize_loan_out(loan)
    objects = (
        db.query(LoanOutObject)
        .filter(LoanOutObject.loan_out_id == loan.loan_out_id)
        .options(
            joinedload(LoanOutObject.object).selectinload(CollectionObject.title_links),
            joinedload(LoanOutObject.condition_report_out),
            joinedload(LoanOutObject.condition_report_return),
            joinedload(LoanOutObject.exit),
        )
        .all()
    )
    result["objects"] = [_serialize_loan_out_object(o, include_object=True) for o in objects]
    return result


@router.post("/api/organizations/{organization_id}/collections/loans-out/{loan_id}/rollback", response_model=LoanOutItemOut, summary="Rollback loan out")
def rollback_loan_out(
    organization_id: UUID,
    loan_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.LOANS_ROLLBACK)),
    db: Session = Depends(get_db),
):
    """Rollback a loan out to a previous status."""
    from app.services.workflow_definitions import WORKFLOW_DEFINITIONS
    from app.services.status_transitions import rollback_entity, InvalidTransitionError
    from app.services.audit_service import log_audit_event

    target_status = data.get("target_status")
    if not target_status:
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "Missing: target_status",
        })

    reason = (data.get("reason") or "").strip()
    if not reason:
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "A reason is required when reverting status",
            "field": "reason",
        })

    workflow = WORKFLOW_DEFINITIONS["loan_out"]

    loan = db.query(LoanOut).filter(
        LoanOut.loan_out_id == loan_id,
        LoanOut.organization_id == organization_id,
    ).first()

    if not loan:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Loan not found",
        })

    try:
        old_status = rollback_entity(
            loan, target_status, workflow, auth.user_id,
            session=db, organization_id=organization_id,
        )
    except InvalidTransitionError as e:
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": str(e),
        })

    log_audit_event(
        session=db,
        organization_id=organization_id,
        acting_user_id=auth.user_id,
        action="loan_out.rollback",
        details={
            "entity_id": str(loan_id),
            "old_status": old_status,
            "new_status": target_status,
            "reason": reason,
        },
    )

    db.commit()

    notify_status_change(organization_id, 'loan_out', loan.loan_out_id, loan.loan_number,
                         old_status, target_status, str(auth.user_id), entity=loan)

    return _serialize_loan_out(loan)


# ============================================================================
# LOAN OUT OBJECTS ENDPOINTS
# ============================================================================


@router.get("/api/organizations/{organization_id}/collections/loans-out/{loan_id}/objects", response_model=LoanOutObjectListResponse, summary="List loan out objects")
def list_loan_out_objects(
    organization_id: UUID,
    loan_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.LOANS_VIEW)),
    db: Session = Depends(get_db),
):
    """List objects in an outgoing loan."""
    loan = db.query(LoanOut).filter(
        LoanOut.loan_out_id == loan_id,
        LoanOut.organization_id == organization_id,
    ).first()

    if not loan:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Loan not found",
        })

    objects = db.query(LoanOutObject).filter(
        LoanOutObject.loan_out_id == loan_id,
        LoanOutObject.organization_id == organization_id,
    ).options(
        joinedload(LoanOutObject.object).selectinload(CollectionObject.title_links),
    ).all()

    return {
        "objects": [_serialize_loan_out_object(o, include_object=True) for o in objects],
        "total": len(objects),
    }


@router.post("/api/organizations/{organization_id}/collections/loans-out/{loan_id}/objects", status_code=201, response_model=LoanOutObjectsAddedResponse, summary="Add loan out objects")
def add_loan_out_object(
    organization_id: UUID,
    loan_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.LOANS_EDIT)),
    db: Session = Depends(get_db),
):
    """Add one or more objects to an outgoing loan."""
    loan = db.query(LoanOut).filter(
        LoanOut.loan_out_id == loan_id,
        LoanOut.organization_id == organization_id,
    ).first()

    if not loan:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Loan not found",
        })

    if loan.status in ("returned", "cancelled"):
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": f"Cannot add objects to {loan.status} loan",
        })

    # Support both single object and array of objects
    object_ids = data.get("object_ids", [])
    if data.get("object_id"):
        object_ids = [data["object_id"]]

    if not object_ids:
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "Missing: object_id or object_ids",
        })

    added_objects = []
    for obj_id in object_ids:
        obj_uuid = UUID(obj_id)

        # Verify object exists
        obj = db.query(CollectionObject).filter(
            CollectionObject.object_id == obj_uuid,
            CollectionObject.organization_id == organization_id,
        ).first()

        if not obj:
            raise HTTPException(status_code=404, detail={
                "code": "not_found",
                "message": f"Object {obj_id} not found",
            })

        # Check if already in this loan
        existing = db.query(LoanOutObject).filter(
            LoanOutObject.loan_out_id == loan_id,
            LoanOutObject.object_id == obj_uuid,
        ).first()

        if existing:
            continue  # Skip if already added

        loan_object = LoanOutObject(
            loan_out_id=loan_id,
            organization_id=organization_id,
            object_id=obj_uuid,
            insurance_value=data.get("insurance_value"),
            insurance_currency=data.get("insurance_currency", "USD"),
            display_credit_line=data.get("display_credit_line"),
            display_label=data.get("display_label"),
            display_requirements=data.get("display_requirements"),
            installation_requirements=data.get("installation_requirements"),
            special_conditions=data.get("special_conditions"),
            handling_requirements=data.get("handling_requirements"),
            environmental_requirements=data.get("environmental_requirements"),
            photography_restrictions=data.get("photography_restrictions"),
            item_status="pending",
        )

        db.add(loan_object)
        added_objects.append(loan_object)

    try:
        db.commit()
    except Exception:
        db.rollback()
        raise

    return {
        "objects": [_serialize_loan_out_object(o, include_object=True) for o in added_objects],
        "added_count": len(added_objects),
    }


@router.put("/api/organizations/{organization_id}/collections/loans-out/{loan_id}/objects/{loan_object_id}", response_model=LoanOutObjectOut, summary="Update loan out object")
def update_loan_out_object(
    organization_id: UUID,
    loan_id: UUID,
    loan_object_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.LOANS_EDIT)),
    db: Session = Depends(get_db),
):
    """Update a loan object's details."""
    loan_object = db.query(LoanOutObject).filter(
        LoanOutObject.loan_object_id == loan_object_id,
        LoanOutObject.loan_out_id == loan_id,
        LoanOutObject.organization_id == organization_id,
    ).first()

    if not loan_object:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Loan object not found",
        })

    # Update allowed fields
    updatable_fields = [
        'insurance_value', 'insurance_currency', 'display_credit_line',
        'display_label', 'display_requirements', 'installation_requirements',
        'special_conditions', 'handling_requirements', 'environmental_requirements',
        'condition_out_note', 'condition_return_note', 'photography_restrictions',
        'item_status', 'damage_reported', 'damage_note',
        # the procedures — Per-Object fields (Gap 9 & 10)
        'valuation', 'valuation_currency', 'dimensions_note',
        'ip_rights_note', 'estimated_costs', 'estimated_costs_currency',
        'estimated_costs_note', 'photography_permitted', 'reproduction_rights_note',
    ]

    for field in updatable_fields:
        if field in data:
            setattr(loan_object, field, data[field])

    # Handle date fields
    if 'dispatched_date' in data:
        loan_object.dispatched_date = datetime.strptime(data['dispatched_date'], '%Y-%m-%d').date() if data['dispatched_date'] else None
    if 'returned_date' in data:
        loan_object.returned_date = datetime.strptime(data['returned_date'], '%Y-%m-%d').date() if data['returned_date'] else None
    if 'valuation_date' in data:
        loan_object.valuation_date = datetime.strptime(data['valuation_date'], '%Y-%m-%d').date() if data['valuation_date'] else None

    # Handle FK fields
    if 'condition_report_out_id' in data:
        loan_object.condition_report_out_id = UUID(data['condition_report_out_id']) if data['condition_report_out_id'] else None
    if 'condition_report_return_id' in data:
        loan_object.condition_report_return_id = UUID(data['condition_report_return_id']) if data['condition_report_return_id'] else None

    db.commit()

    # Re-query with eager-loaded relationships so serializer can access report/exit numbers
    loan_object = (
        db.query(LoanOutObject)
        .filter(LoanOutObject.loan_object_id == loan_object_id)
        .options(
            joinedload(LoanOutObject.object).selectinload(CollectionObject.title_links),
            joinedload(LoanOutObject.condition_report_out),
            joinedload(LoanOutObject.condition_report_return),
            joinedload(LoanOutObject.exit),
        )
        .first()
    )

    return _serialize_loan_out_object(loan_object, include_object=True)


@router.delete("/api/organizations/{organization_id}/collections/loans-out/{loan_id}/objects/{loan_object_id}", summary="Remove loan out object")
def remove_loan_out_object(
    organization_id: UUID,
    loan_id: UUID,
    loan_object_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.LOANS_EDIT)),
    db: Session = Depends(get_db),
):
    """Remove an object from an outgoing loan."""
    loan = db.query(LoanOut).filter(
        LoanOut.loan_out_id == loan_id,
        LoanOut.organization_id == organization_id,
    ).first()

    if not loan:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Loan not found",
        })

    if loan.status in ("in_transit", "on_loan", "returned", "closed"):
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": f"Cannot remove objects from {loan.status} loan",
        })

    loan_object = db.query(LoanOutObject).filter(
        LoanOutObject.loan_object_id == loan_object_id,
        LoanOutObject.loan_out_id == loan_id,
        LoanOutObject.organization_id == organization_id,
    ).first()

    if not loan_object:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Loan object not found",
        })

    db.delete(loan_object)
    db.commit()

    return Response(status_code=204)


# =============================================================================
# Loan Monitoring Events (the procedures)
# =============================================================================


@router.get("/api/organizations/{organization_id}/collections/loans-out/{loan_id}/monitoring", summary="List loan out monitoring events")
def list_loan_out_monitoring_events(
    organization_id: UUID,
    loan_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.LOANS_VIEW)),
    db: Session = Depends(get_db),
):
    """List monitoring events for an outgoing loan."""
    from app.models.procedures import LoanMonitoringEvent

    events = (
        db.query(LoanMonitoringEvent)
        .filter(
            LoanMonitoringEvent.organization_id == organization_id,
            LoanMonitoringEvent.loan_id == loan_id,
            LoanMonitoringEvent.loan_type == 'loan_out',
        )
        .order_by(LoanMonitoringEvent.due_date)
        .all()
    )

    return {
        "events": [
            {
                "event_id": str(e.event_id),
                "loan_id": str(e.loan_id),
                "event_type": e.event_type,
                "due_date": e.due_date.isoformat() if e.due_date else None,
                "completed_date": e.completed_date.isoformat() if e.completed_date else None,
                "completed_by": str(e.completed_by) if e.completed_by else None,
                "status": e.status,
                "notes": e.notes,
            }
            for e in events
        ],
        "total": len(events),
    }


@router.patch("/api/organizations/{organization_id}/collections/loans-out/{loan_id}/monitoring/{event_id}", summary="Update loan out monitoring event")
def update_loan_out_monitoring_event(
    organization_id: UUID,
    loan_id: UUID,
    event_id: UUID,
    data: dict = Body(...),
    auth: AuthContext = Depends(require_permission(Permission.LOANS_EDIT)),
    db: Session = Depends(get_db),
):
    """Update a monitoring event for an outgoing loan."""
    from app.models.procedures import LoanMonitoringEvent

    event = db.query(LoanMonitoringEvent).filter(
        LoanMonitoringEvent.event_id == event_id,
        LoanMonitoringEvent.organization_id == organization_id,
        LoanMonitoringEvent.loan_id == loan_id,
    ).first()

    if not event:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Monitoring event not found",
        })

    if "status" in data:
        event.status = data["status"]
        if data["status"] == "completed":
            event.completed_date = date.today()
            event.completed_by = auth.user_id

    if "notes" in data:
        event.notes = data["notes"]

    db.commit()

    return {
        "event_id": str(event.event_id),
        "event_type": event.event_type,
        "due_date": event.due_date.isoformat() if event.due_date else None,
        "completed_date": event.completed_date.isoformat() if event.completed_date else None,
        "completed_by": str(event.completed_by) if event.completed_by else None,
        "status": event.status,
        "notes": event.notes,
    }


# ============================================================================
# LOAN IN MONITORING ENDPOINTS
# ============================================================================


@router.get("/api/organizations/{organization_id}/collections/loans-in/{loan_id}/monitoring", summary="List loan in monitoring events")
def list_loan_in_monitoring_events(
    organization_id: UUID,
    loan_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.LOANS_VIEW)),
    db: Session = Depends(get_db),
):
    """List monitoring events for an incoming loan."""
    from app.models.procedures import LoanMonitoringEvent

    events = (
        db.query(LoanMonitoringEvent)
        .filter(
            LoanMonitoringEvent.organization_id == organization_id,
            LoanMonitoringEvent.loan_id == loan_id,
            LoanMonitoringEvent.loan_type == 'loan_in',
        )
        .order_by(LoanMonitoringEvent.due_date)
        .all()
    )

    return {
        "events": [
            {
                "event_id": str(e.event_id),
                "loan_id": str(e.loan_id),
                "event_type": e.event_type,
                "due_date": e.due_date.isoformat() if e.due_date else None,
                "completed_date": e.completed_date.isoformat() if e.completed_date else None,
                "completed_by": str(e.completed_by) if e.completed_by else None,
                "status": e.status,
                "notes": e.notes,
            }
            for e in events
        ],
        "total": len(events),
    }


@router.patch("/api/organizations/{organization_id}/collections/loans-in/{loan_id}/monitoring/{event_id}", summary="Update loan in monitoring event")
def update_loan_in_monitoring_event(
    organization_id: UUID,
    loan_id: UUID,
    event_id: UUID,
    data: dict = Body(...),
    auth: AuthContext = Depends(require_permission(Permission.LOANS_EDIT)),
    db: Session = Depends(get_db),
):
    """Update a monitoring event for an incoming loan."""
    from app.models.procedures import LoanMonitoringEvent

    event = db.query(LoanMonitoringEvent).filter(
        LoanMonitoringEvent.event_id == event_id,
        LoanMonitoringEvent.organization_id == organization_id,
        LoanMonitoringEvent.loan_id == loan_id,
    ).first()

    if not event:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Monitoring event not found",
        })

    if "status" in data:
        event.status = data["status"]
        if data["status"] == "completed":
            event.completed_date = date.today()
            event.completed_by = auth.user_id

    if "notes" in data:
        event.notes = data["notes"]

    db.commit()

    return {
        "event_id": str(event.event_id),
        "event_type": event.event_type,
        "due_date": event.due_date.isoformat() if event.due_date else None,
        "completed_date": event.completed_date.isoformat() if event.completed_date else None,
        "completed_by": str(event.completed_by) if event.completed_by else None,
        "status": event.status,
        "notes": event.notes,
    }


# ============================================================================
# LOAN OUT RENEWAL ENDPOINTS
# ============================================================================


@router.get("/api/organizations/{organization_id}/collections/loans-out/{loan_id}/renewals", summary="List loan out renewals")
def list_loan_out_renewals(
    organization_id: UUID,
    loan_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.LOANS_VIEW)),
    db: Session = Depends(get_db),
):
    """List renewal history for an outgoing loan."""
    from app.models.procedures import LoanRenewal

    renewals = (
        db.query(LoanRenewal)
        .filter(
            LoanRenewal.organization_id == organization_id,
            LoanRenewal.loan_id == loan_id,
            LoanRenewal.loan_type == 'loan_out',
        )
        .order_by(LoanRenewal.renewal_number)
        .all()
    )

    return {
        "renewals": [
            {
                "renewal_id": str(r.renewal_id),
                "renewal_number": r.renewal_number,
                "previous_end_date": r.previous_end_date.isoformat() if r.previous_end_date else None,
                "new_end_date": r.new_end_date.isoformat() if r.new_end_date else None,
                "approval_date": r.approval_date.isoformat() if r.approval_date else None,
                "approved_by": str(r.approved_by) if r.approved_by else None,
                "reason": r.reason,
                "note": r.note,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in renewals
        ],
        "total": len(renewals),
    }


@router.post("/api/organizations/{organization_id}/collections/loans-out/{loan_id}/renewals", summary="Create loan out renewal")
def create_loan_out_renewal(
    organization_id: UUID,
    loan_id: UUID,
    data: dict = Body(...),
    auth: AuthContext = Depends(require_permission(Permission.LOANS_EDIT)),
    db: Session = Depends(get_db),
):
    """Create a renewal record extending the loan end date."""
    from app.models.procedures import LoanOut, LoanRenewal

    loan = db.query(LoanOut).filter(
        LoanOut.loan_out_id == loan_id,
        LoanOut.organization_id == organization_id,
    ).first()

    if not loan:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Loan not found",
        })

    if loan.max_renewals and loan.renewal_count >= loan.max_renewals:
        raise HTTPException(status_code=400, detail={
            "code": "max_renewals_reached",
            "message": f"Maximum renewals ({loan.max_renewals}) already reached",
        })

    new_end_date = data.get("new_end_date")
    if not new_end_date:
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "new_end_date is required",
        })

    from datetime import date as date_type
    renewal = LoanRenewal(
        organization_id=organization_id,
        loan_type='loan_out',
        loan_id=loan_id,
        renewal_number=(loan.renewal_count or 0) + 1,
        previous_end_date=loan.loan_end_date,
        new_end_date=date_type.fromisoformat(new_end_date),
        reason=data.get("reason"),
        note=data.get("note"),
        created_by=auth.user_id,
    )
    db.add(renewal)

    loan.loan_end_date = date_type.fromisoformat(new_end_date)
    loan.renewal_count = (loan.renewal_count or 0) + 1
    loan.updated_by = auth.user_id
    loan.updated_at = datetime.now(timezone.utc)

    try:
        db.commit()
    except Exception:
        db.rollback()
        raise

    return {
        "renewal_id": str(renewal.renewal_id),
        "renewal_number": renewal.renewal_number,
        "previous_end_date": renewal.previous_end_date.isoformat() if renewal.previous_end_date else None,
        "new_end_date": renewal.new_end_date.isoformat() if renewal.new_end_date else None,
        "reason": renewal.reason,
        "note": renewal.note,
    }
