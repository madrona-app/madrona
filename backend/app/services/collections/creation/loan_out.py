"""Shared create logic for LoanOut (Loans Out, Procedure 8).

Extracted from the inline ``create_loan_out`` router so the draft applier and
the API route share one implementation, including the approval gate. (Loan
objects are added via a separate endpoint, so the create itself is a flat row.)
The caller owns the transaction.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import UUID

from app.models import LoanOut


def _as_uuid(value) -> UUID | None:
    if value is None or isinstance(value, UUID):
        return value
    return UUID(str(value))


def _as_date(value) -> date | None:
    if value is None or isinstance(value, date):
        return value
    return date.fromisoformat(str(value))


def _as_decimal(value) -> Decimal | None:
    if value is None or isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def create_loan_out(
    session,
    organization_id: UUID,
    payload: dict,
    actor,
    *,
    open_approval: bool = True,
    proposed_by=None,
) -> LoanOut:
    """Create a live LoanOut. The caller owns the transaction. Approval gate
    semantics match acquisition (see ``open_approval``)."""
    from app.services.sequence import next_sequential_number

    p = payload
    rule = None
    if open_approval:
        from app.services.approval_service import check_approval_required

        rule = check_approval_required(organization_id, "loan_out", "create", session)

    initial_status = "requested"
    loan = LoanOut(
        organization_id=organization_id,
        loan_number=next_sequential_number(session, organization_id, "LO"),
        borrower_id=_as_uuid(p.get("borrower_id")),
        borrower_name=p.get("borrower_name"),
        venue_id=_as_uuid(p.get("venue_id")),
        venue_name=p.get("venue_name"),
        venue_address=p.get("venue_address"),
        loan_purpose=p["loan_purpose"],
        exhibition_title=p.get("exhibition_title"),
        request_date=datetime.now(timezone.utc).date(),
        loan_start_date=_as_date(p.get("loan_start_date")),
        loan_end_date=_as_date(p.get("loan_end_date")),
        loan_conditions=p.get("loan_conditions"),
        insurance_requirements=p.get("insurance_requirements"),
        insurance_value_total=_as_decimal(p.get("insurance_value_total")),
        insurance_currency=p.get("insurance_currency", "USD"),
        loan_note=p.get("loan_note"),
        status="pending_approval" if rule else initial_status,
        created_by=actor,
        updated_by=actor,
    )
    session.add(loan)
    session.flush()

    if rule:
        from app.services.approval_service import create_approval_request

        create_approval_request(
            rule=rule,
            entity_type="loan_out",
            entity_id=loan.loan_out_id,
            requested_by=actor,
            requested_action={"action": "create", "initial_status": initial_status},
            session=session,
        )

    return loan
