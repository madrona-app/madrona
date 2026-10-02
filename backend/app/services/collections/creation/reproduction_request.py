"""Shared create logic for ReproductionRequest (Procedure 19).

Extracted from the inline ``create_reproduction_request`` router so the draft
applier and the API route share one implementation. The API requires a
client-supplied ``request_number``; the draft path omits it and the create
function generates one (REP sequence). The caller owns the transaction.
"""

from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from app.models import ReproductionRequest


def _as_uuid(value) -> UUID | None:
    if value is None or isinstance(value, UUID):
        return value
    return UUID(str(value))


def _as_decimal(value) -> Decimal | None:
    if value is None or isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def create_reproduction_request(
    session,
    organization_id: UUID,
    payload: dict,
    actor,
    *,
    open_approval: bool = True,
    proposed_by=None,
) -> ReproductionRequest:
    """Create a live ReproductionRequest in status='submitted'. The caller owns
    the transaction. ``open_approval``/``proposed_by`` are accepted for
    signature uniformity; reproduction requests are not approval-gated and
    record no separate proposer.
    """
    p = payload
    request_number = p.get("request_number")
    if not request_number:
        from app.services.sequence import next_sequential_number

        request_number = next_sequential_number(session, organization_id, "REP")

    rr = ReproductionRequest(
        organization_id=organization_id,
        request_number=request_number,
        use_request_id=_as_uuid(p.get("use_request_id")),
        object_id=_as_uuid(p.get("object_id")),
        requester_name=p["requester_name"],
        requester_institution=p.get("requester_institution"),
        requester_email=p.get("requester_email"),
        requester_phone=p.get("requester_phone"),
        reproduction_type=p["reproduction_type"],
        reproduction_purpose=p.get("reproduction_purpose"),
        intended_use=p.get("intended_use"),
        quantity=p.get("quantity"),
        format_requested=p.get("format_requested"),
        dimensions_requested=p.get("dimensions_requested"),
        credit_line_required=p.get("credit_line_required"),
        fee_type=p.get("fee_type"),
        fee_amount=_as_decimal(p.get("fee_amount")),
        fee_currency=p.get("fee_currency", "USD"),
        notes=p.get("notes"),
        status="submitted",
        created_by=actor,
        updated_by=actor,
    )
    session.add(rr)
    session.flush()
    return rr
