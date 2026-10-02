"""Exhibition Loans API — 11 routes migrated from Flask.

Sources:
- app/api/exhibition_loans.py
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.permissions import Permission
from app.models import (
    Exhibition,
    ExhibitionLoan,
    ExhibitionLoanObject,
    LoanType,
    LoanStatus,
)
from app.fastapi_app.schemas.exhibition_loans import (
    AgreementResponse,
    ExhibitionLoanListResponse,
    ExhibitionLoanOut,
    InsuranceResponse,
    LoanEnumsResponse,
    LoansSummaryResponse,
    LoanStatusResponse,
)
from app.services.entity_notifications import notify_status_change
from app.services.field_access_service import apply_field_access, get_write_restricted_fields

router = APIRouter(tags=["exhibition_loans"])


def serialize_loan(loan: ExhibitionLoan, include_objects: bool = False) -> dict:
    data = {
        'link_id': str(loan.link_id),
        'exhibition_id': str(loan.exhibition_id),
        'loan_id': str(loan.loan_id) if loan.loan_id else None,
        'loan_type': loan.loan_type,
        'loan_type_label': LoanType.LABELS.get(loan.loan_type, loan.loan_type) if loan.loan_type else None,
        'is_linked': loan.loan_id is not None,
        'loan_number': loan.loan_number,
        'party_name': loan.party_name,
        'party_contact': loan.party_contact,
        'status': loan.status,
        'status_label': LoanStatus.LABELS.get(loan.status, loan.status),
        'status_notes': loan.status_notes,
        'agreement_document_id': str(loan.agreement_document_id) if loan.agreement_document_id else None,
        'agreement_signed': loan.agreement_signed,
        'agreement_signed_date': loan.agreement_signed_date.isoformat() if loan.agreement_signed_date else None,
        'insurance_confirmed': loan.insurance_confirmed,
        'insurance_policy': loan.insurance_policy,
        'insurance_value': loan.insurance_value,
        'request_date': loan.request_date.isoformat() if loan.request_date else None,
        'loan_start_date': loan.loan_start_date.isoformat() if loan.loan_start_date else None,
        'loan_end_date': loan.loan_end_date.isoformat() if loan.loan_end_date else None,
        'actual_return_date': loan.actual_return_date.isoformat() if loan.actual_return_date else None,
        'object_count': loan.object_count,
        'notes': loan.notes,
        'created_at': loan.created_at.isoformat() if loan.created_at else None,
        'updated_at': loan.updated_at.isoformat() if loan.updated_at else None,
        'last_synced_at': loan.last_synced_at.isoformat() if loan.last_synced_at else None,
        'is_active': loan.status in LoanStatus.ACTIVE,
        'needs_attention': _loan_needs_attention(loan),
    }

    if include_objects:
        data['objects'] = [
            {
                'loan_object_id': str(obj.loan_object_id),
                'object_id': str(obj.object_id),
                'object_number': obj.object_number,
                'object_title': obj.object_title,
            }
            for obj in (loan.objects or [])
        ]

    return data


def _loan_needs_attention(loan: ExhibitionLoan) -> bool:
    if loan.status in [LoanStatus.AGREEMENT_SENT] and not loan.agreement_signed:
        return True
    if loan.status in [LoanStatus.APPROVED, LoanStatus.AGREEMENT_SIGNED, LoanStatus.IN_TRANSIT] and not loan.insurance_confirmed:
        return True
    if loan.loan_end_date and loan.status == LoanStatus.ON_LOAN:
        days_until_end = (loan.loan_end_date - datetime.now(timezone.utc).date()).days
        if days_until_end <= 30:
            return True
    return False


# ---------------------------------------------------------------------------
# 1. GET /api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/loans
# ---------------------------------------------------------------------------

@router.get("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/loans", response_model=ExhibitionLoanListResponse, summary="List exhibition loans")
def list_exhibition_loans(
    org_id: str,
    exhibition_id: str,
    loan_type: str | None = None,
    status: str | None = None,
    active_only: str | None = None,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_VIEW)),
):
    """List exhibition loans."""
    exhibition = db.query(Exhibition).filter(
        Exhibition.exhibition_id == exhibition_id,
        Exhibition.organization_id == org_id,
    ).first()

    if not exhibition:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Exhibition not found"})

    query = db.query(ExhibitionLoan).filter(
        ExhibitionLoan.exhibition_id == exhibition_id,
    )

    if loan_type and loan_type in LoanType.ALL:
        query = query.filter(ExhibitionLoan.loan_type == loan_type)

    if status and status in LoanStatus.ALL:
        query = query.filter(ExhibitionLoan.status == status)

    if active_only == 'true':
        query = query.filter(ExhibitionLoan.status.in_(LoanStatus.ACTIVE))

    query = query.order_by(
        ExhibitionLoan.loan_type,
        ExhibitionLoan.status,
        ExhibitionLoan.party_name,
    )

    loans = query.all()

    all_loans = db.query(ExhibitionLoan).filter(
        ExhibitionLoan.exhibition_id == exhibition_id,
    ).all()

    summary = {
        'total': len(all_loans),
        'loans_in': len([l for l in all_loans if l.loan_type == LoanType.LOAN_IN]),
        'loans_out': len([l for l in all_loans if l.loan_type == LoanType.LOAN_OUT]),
        'planning': len([l for l in all_loans if l.loan_id is None]),
        'linked': len([l for l in all_loans if l.loan_id is not None]),
        'active': len([l for l in all_loans if l.status in LoanStatus.ACTIVE]),
        'needs_attention': len([l for l in all_loans if _loan_needs_attention(l)]),
        'agreements_pending': len([l for l in all_loans if l.status in LoanStatus.ACTIVE and not l.agreement_signed]),
        'insurance_pending': len([l for l in all_loans if l.status in LoanStatus.ACTIVE and not l.insurance_confirmed]),
        'by_status': {},
    }
    for l in all_loans:
        summary['by_status'][l.status] = summary['by_status'].get(l.status, 0) + 1

    return {
        'loans': [
            apply_field_access(serialize_loan(l), 'exhibition_loan', org_id, str(auth.user_id), session=db, role_override=auth.role_override)
            for l in loans
        ],
        'summary': summary,
    }


# ---------------------------------------------------------------------------
# 2. GET  .../loans/summary
# ---------------------------------------------------------------------------

@router.get("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/loans/summary", response_model=LoansSummaryResponse, summary="Get loans summary")
def get_loans_summary(
    org_id: str,
    exhibition_id: str,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_VIEW)),
):
    """Get loans summary."""
    exhibition = db.query(Exhibition).filter(
        Exhibition.exhibition_id == exhibition_id,
        Exhibition.organization_id == org_id,
    ).first()

    if not exhibition:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Exhibition not found"})

    loans = db.query(ExhibitionLoan).filter(
        ExhibitionLoan.exhibition_id == exhibition_id,
    ).all()

    active = [l for l in loans if l.status in LoanStatus.ACTIVE]
    needs_attention = [l for l in loans if _loan_needs_attention(l)]

    return {
        'total': len(loans),
        'loans_in': len([l for l in loans if l.loan_type == LoanType.LOAN_IN]),
        'loans_out': len([l for l in loans if l.loan_type == LoanType.LOAN_OUT]),
        'planning': len([l for l in loans if l.loan_id is None]),
        'linked': len([l for l in loans if l.loan_id is not None]),
        'active': len(active),
        'needs_attention': len(needs_attention),
        'agreements_pending': len([l for l in active if not l.agreement_signed]),
        'insurance_pending': len([l for l in active if not l.insurance_confirmed]),
    }


# ---------------------------------------------------------------------------
# 3. POST .../loans
# ---------------------------------------------------------------------------

@router.post("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/loans", status_code=201, response_model=ExhibitionLoanOut, summary="Create exhibition loan")
async def create_exhibition_loan(
    org_id: str,
    exhibition_id: str,
    request: Request,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
):
    """Create exhibition loan."""
    user_id = auth.user_id

    exhibition = db.query(Exhibition).filter(
        Exhibition.exhibition_id == exhibition_id,
        Exhibition.organization_id == org_id,
    ).first()

    if not exhibition:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Exhibition not found"})

    data = await request.json()

    loan_id = data.get('loan_id')
    loan_type = data.get('loan_type')

    # Enforce ck_exhibition_loans_loan_consistency: loan_id and loan_type must
    # both be set (linked loan) or both be null (planning phase). Reject
    # half-set payloads before the DB does so clients get a clear 422.
    if loan_id and not loan_type:
        raise HTTPException(status_code=422, detail={"code": "validation_error", "message": "Loan type is required when a loan is provided", "field": "loan_type"})
    if loan_type and not loan_id:
        raise HTTPException(status_code=422, detail={"code": "validation_error", "message": "Loan id is required when a loan type is provided", "field": "loan_id"})

    if loan_type and loan_type not in LoanType.ALL:
        raise HTTPException(status_code=422, detail={"code": "validation_error", "message": f"Invalid loan type. Must be one of: {', '.join(LoanType.ALL)}", "field": "loan_type"})

    status = data.get('status', LoanStatus.REQUESTED)
    if status not in LoanStatus.ALL:
        raise HTTPException(status_code=422, detail={"code": "validation_error", "message": f"Invalid status. Must be one of: {LoanStatus.ALL}", "field": "status"})

    if loan_id:
        existing = db.query(ExhibitionLoan).filter(
            ExhibitionLoan.exhibition_id == exhibition_id,
            ExhibitionLoan.loan_id == loan_id,
        ).first()

        if existing:
            raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "Loan is already linked to this exhibition"})

    loan = ExhibitionLoan(
        organization_id=org_id,
        exhibition_id=exhibition_id,
        loan_id=loan_id,
        loan_type=loan_type,
        loan_number=data.get('loan_number'),
        party_name=data.get('party_name'),
        party_contact=data.get('party_contact'),
        status=status,
        status_notes=data.get('status_notes'),
        agreement_document_id=data.get('agreement_document_id'),
        agreement_signed=data.get('agreement_signed', False),
        insurance_confirmed=data.get('insurance_confirmed', False),
        insurance_policy=data.get('insurance_policy'),
        insurance_value=data.get('insurance_value'),
        request_date=data.get('request_date'),
        loan_start_date=data.get('loan_start_date'),
        loan_end_date=data.get('loan_end_date'),
        object_count=data.get('object_count'),
        notes=data.get('notes'),
        created_by=user_id,
        updated_by=user_id,
    )

    db.add(loan)
    db.flush()

    for obj_data in data.get('objects', []):
        if obj_data.get('object_id'):
            obj = ExhibitionLoanObject(
                link_id=loan.link_id,
                object_id=obj_data['object_id'],
                object_number=obj_data.get('object_number'),
                object_title=obj_data.get('object_title'),
            )
            db.add(obj)

    db.commit()
    db.refresh(loan)

    return apply_field_access(serialize_loan(loan, include_objects=True), 'exhibition_loan', org_id, str(auth.user_id), session=db, role_override=auth.role_override)


# ---------------------------------------------------------------------------
# 4. GET .../loans/{link_id}
# ---------------------------------------------------------------------------

@router.get("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/loans/{link_id}", response_model=ExhibitionLoanOut, summary="Get exhibition loan")
def get_exhibition_loan(
    org_id: str,
    exhibition_id: str,
    link_id: str,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_VIEW)),
):
    """Get exhibition loan."""
    loan = db.query(ExhibitionLoan).filter(
        ExhibitionLoan.link_id == link_id,
        ExhibitionLoan.exhibition_id == exhibition_id,
    ).first()

    if not loan:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Loan link not found"})

    exhibition = db.query(Exhibition).filter(
        Exhibition.exhibition_id == exhibition_id,
        Exhibition.organization_id == org_id,
    ).first()

    if not exhibition:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Exhibition not found"})

    return apply_field_access(serialize_loan(loan, include_objects=True), 'exhibition_loan', org_id, str(auth.user_id), session=db, role_override=auth.role_override)


# ---------------------------------------------------------------------------
# 5. PATCH .../loans/{link_id}
# ---------------------------------------------------------------------------

@router.patch("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/loans/{link_id}", response_model=ExhibitionLoanOut, summary="Update exhibition loan")
async def update_exhibition_loan(
    org_id: str,
    exhibition_id: str,
    link_id: str,
    request: Request,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
):
    """Update exhibition loan."""
    user_id = auth.user_id

    loan = db.query(ExhibitionLoan).filter(
        ExhibitionLoan.link_id == link_id,
        ExhibitionLoan.exhibition_id == exhibition_id,
    ).first()

    if not loan:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Loan link not found"})

    exhibition = db.query(Exhibition).filter(
        Exhibition.exhibition_id == exhibition_id,
        Exhibition.organization_id == org_id,
    ).first()

    if not exhibition:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Exhibition not found"})

    data = await request.json()

    # Strip write-restricted fields before applying updates
    write_restricted = get_write_restricted_fields('exhibition_loan', org_id, str(auth.user_id), session=db, role_override=auth.role_override)
    for field in write_restricted:
        data.pop(field, None)

    if 'loan_type' in data:
        if data['loan_type'] not in LoanType.ALL:
            raise HTTPException(status_code=422, detail={"code": "validation_error", "message": "Invalid loan_type", "field": "loan_type"})
        loan.loan_type = data['loan_type']

    if 'status' in data:
        if data['status'] not in LoanStatus.ALL:
            raise HTTPException(status_code=422, detail={"code": "validation_error", "message": "Invalid status", "field": "status"})
        loan.status = data['status']

    if 'loan_number' in data:
        loan.loan_number = data['loan_number']
    if 'party_name' in data:
        loan.party_name = data['party_name']
    if 'party_contact' in data:
        loan.party_contact = data['party_contact']
    if 'status_notes' in data:
        loan.status_notes = data['status_notes']
    if 'agreement_document_id' in data:
        loan.agreement_document_id = data['agreement_document_id']
    if 'agreement_signed' in data:
        loan.agreement_signed = data['agreement_signed']
    # agreement_signed_date is deliberately NOT settable here. It records when
    # a legal agreement was signed and is stamped server-side by the
    # /agreement endpoint; accepting it on the generic update path would
    # reopen the backdating hole that endpoint just closed.
    if 'insurance_confirmed' in data:
        loan.insurance_confirmed = data['insurance_confirmed']
    if 'insurance_policy' in data:
        loan.insurance_policy = data['insurance_policy']
    if 'insurance_value' in data:
        loan.insurance_value = data['insurance_value']
    if 'request_date' in data:
        loan.request_date = data['request_date']
    if 'loan_start_date' in data:
        loan.loan_start_date = data['loan_start_date']
    if 'loan_end_date' in data:
        loan.loan_end_date = data['loan_end_date']
    if 'actual_return_date' in data:
        loan.actual_return_date = data['actual_return_date']
    if 'object_count' in data:
        loan.object_count = data['object_count']
    if 'notes' in data:
        loan.notes = data['notes']

    loan.updated_at = datetime.now(timezone.utc)
    loan.updated_by = user_id

    db.commit()
    db.refresh(loan)

    return apply_field_access(serialize_loan(loan, include_objects=True), 'exhibition_loan', org_id, str(auth.user_id), session=db, role_override=auth.role_override)


# ---------------------------------------------------------------------------
# 6. DELETE .../loans/{link_id}
# ---------------------------------------------------------------------------

@router.delete("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/loans/{link_id}", summary="Unlink loan from exhibition")
def unlink_loan_from_exhibition(
    org_id: str,
    exhibition_id: str,
    link_id: str,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
):
    """Unlink loan from exhibition."""
    loan = db.query(ExhibitionLoan).filter(
        ExhibitionLoan.link_id == link_id,
        ExhibitionLoan.exhibition_id == exhibition_id,
    ).first()

    if not loan:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Loan link not found"})

    exhibition = db.query(Exhibition).filter(
        Exhibition.exhibition_id == exhibition_id,
        Exhibition.organization_id == org_id,
    ).first()

    if not exhibition:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Exhibition not found"})

    db.delete(loan)
    db.commit()

    return Response(status_code=204)


# ---------------------------------------------------------------------------
# 7. POST .../loans/{link_id}/agreement
# ---------------------------------------------------------------------------

@router.post("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/loans/{link_id}/agreement", response_model=AgreementResponse, summary="Mark agreement signed")
async def mark_agreement_signed(
    org_id: str,
    exhibition_id: str,
    link_id: str,
    request: Request,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
):
    """Mark agreement signed."""
    user_id = auth.user_id

    loan = db.query(ExhibitionLoan).filter(
        ExhibitionLoan.link_id == link_id,
        ExhibitionLoan.exhibition_id == exhibition_id,
    ).first()

    if not loan:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Loan link not found"})

    data = await request.json()

    loan.agreement_signed = data.get('signed', True)
    # Server clock, not the client's. This is the date a legal agreement was
    # signed; accepting it from the request body let any caller backdate it to
    # an arbitrary day, and ExhibitionLoan is not an audit-tracked entity, so
    # nothing recorded that they had.
    loan.agreement_signed_date = datetime.now(timezone.utc).date()
    if data.get('document_id'):
        loan.agreement_document_id = data['document_id']

    if loan.agreement_signed and loan.status == LoanStatus.AGREEMENT_SENT:
        loan.status = LoanStatus.AGREEMENT_SIGNED

    loan.updated_at = datetime.now(timezone.utc)
    loan.updated_by = user_id

    db.commit()

    return {
        'link_id': str(loan.link_id),
        'agreement_signed': loan.agreement_signed,
        'agreement_signed_date': loan.agreement_signed_date.isoformat() if loan.agreement_signed_date else None,
        'status': loan.status,
    }


# ---------------------------------------------------------------------------
# 8. POST .../loans/{link_id}/insurance
# ---------------------------------------------------------------------------

@router.post("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/loans/{link_id}/insurance", response_model=InsuranceResponse, summary="Confirm insurance")
async def confirm_insurance(
    org_id: str,
    exhibition_id: str,
    link_id: str,
    request: Request,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
):
    """Confirm insurance."""
    user_id = auth.user_id

    loan = db.query(ExhibitionLoan).filter(
        ExhibitionLoan.link_id == link_id,
        ExhibitionLoan.exhibition_id == exhibition_id,
    ).first()

    if not loan:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Loan link not found"})

    data = await request.json()

    loan.insurance_confirmed = data.get('confirmed', True)
    if data.get('policy'):
        loan.insurance_policy = data['policy']
    if data.get('value') is not None:
        # insurance_value is a String(50) column; coerce so numeric and string
        # payloads round-trip the same on subsequent GETs.
        loan.insurance_value = str(data['value'])

    loan.updated_at = datetime.now(timezone.utc)
    loan.updated_by = user_id

    db.commit()

    return {
        'link_id': str(loan.link_id),
        'insurance_confirmed': loan.insurance_confirmed,
        'insurance_policy': loan.insurance_policy,
        'insurance_value': loan.insurance_value,
    }


# ---------------------------------------------------------------------------
# 9. POST .../loans/{link_id}/status
# ---------------------------------------------------------------------------

@router.post("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/loans/{link_id}/status", response_model=LoanStatusResponse, summary="Update loan status")
async def update_loan_status(
    org_id: str,
    exhibition_id: str,
    link_id: str,
    request: Request,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
):
    """Update loan status."""
    user_id = auth.user_id

    loan = db.query(ExhibitionLoan).filter(
        ExhibitionLoan.link_id == link_id,
        ExhibitionLoan.exhibition_id == exhibition_id,
    ).first()

    if not loan:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Loan link not found"})

    data = await request.json()

    new_status = data.get('status')
    if not new_status or new_status not in LoanStatus.ALL:
        raise HTTPException(status_code=422, detail={"code": "validation_error", "message": f"Invalid status. Must be one of: {LoanStatus.ALL}", "field": "status"})

    old_status = loan.status
    loan.status = new_status
    if data.get('notes'):
        loan.status_notes = data['notes']

    loan.updated_at = datetime.now(timezone.utc)
    loan.updated_by = user_id

    db.commit()

    if new_status != old_status:
        ref = getattr(loan, 'lender_name', None) or getattr(loan, 'borrower_name', None) or str(loan.link_id)[:8]
        notify_status_change(org_id, 'exhibition_loan', loan.link_id, ref,
                             old_status, new_status, auth.user_id, entity=loan)

    return {
        'link_id': str(loan.link_id),
        'old_status': old_status,
        'new_status': new_status,
        'status_label': LoanStatus.LABELS.get(new_status, new_status),
    }


# ---------------------------------------------------------------------------
# 10. POST .../loans/{link_id}/link
# ---------------------------------------------------------------------------

@router.post("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/loans/{link_id}/link", response_model=ExhibitionLoanOut, summary="Link to formal loan")
async def link_to_formal_loan(
    org_id: str,
    exhibition_id: str,
    link_id: str,
    request: Request,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
):
    """Link to formal loan."""
    user_id = auth.user_id

    loan = db.query(ExhibitionLoan).filter(
        ExhibitionLoan.link_id == link_id,
        ExhibitionLoan.exhibition_id == exhibition_id,
    ).first()

    if not loan:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Loan entry not found"})

    exhibition = db.query(Exhibition).filter(
        Exhibition.exhibition_id == exhibition_id,
        Exhibition.organization_id == org_id,
    ).first()

    if not exhibition:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Exhibition not found"})

    data = await request.json()

    if not data.get('loan_id'):
        raise HTTPException(status_code=422, detail={"code": "validation_error", "message": "Loan is required", "field": "loan_id"})

    if not data.get('loan_type'):
        raise HTTPException(status_code=422, detail={"code": "validation_error", "message": "Loan type is required", "field": "loan_type"})

    if data['loan_type'] not in LoanType.ALL:
        raise HTTPException(status_code=422, detail={"code": "validation_error", "message": f"Invalid loan type. Must be one of: {', '.join(LoanType.ALL)}", "field": "loan_type"})

    existing = db.query(ExhibitionLoan).filter(
        ExhibitionLoan.exhibition_id == exhibition_id,
        ExhibitionLoan.loan_id == data['loan_id'],
        ExhibitionLoan.link_id != link_id,
    ).first()

    if existing:
        raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "This formal loan is already linked to another entry"})

    loan.loan_id = data['loan_id']
    loan.loan_type = data['loan_type']
    if data.get('loan_number'):
        loan.loan_number = data['loan_number']

    loan.updated_at = datetime.now(timezone.utc)
    loan.updated_by = user_id

    db.commit()
    db.refresh(loan)

    return apply_field_access(serialize_loan(loan, include_objects=True), 'exhibition_loan', org_id, str(auth.user_id), session=db, role_override=auth.role_override)


# ---------------------------------------------------------------------------
# 11. GET /api/organizations/{org_id}/exhibit/loans/enums
# ---------------------------------------------------------------------------

@router.get("/api/organizations/{org_id}/exhibit/loans/enums", response_model=LoanEnumsResponse, summary="Get loan enums")
def get_loan_enums(
    org_id: str,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_VIEW)),
):
    """Get loan enums."""
    return {
        'loan_types': [
            {'value': t, 'label': LoanType.LABELS[t]}
            for t in LoanType.ALL
        ],
        'statuses': [
            {'value': s, 'label': LoanStatus.LABELS[s]}
            for s in LoanStatus.ALL
        ],
        'active_statuses': LoanStatus.ACTIVE,
        'completed_statuses': LoanStatus.COMPLETED,
    }
