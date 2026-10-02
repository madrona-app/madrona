"""Shared create logic for Acquisition (Procedure 1).

Extracted from the inline ``create_acquisition`` router so the draft applier and
the API route share one implementation, including the approval gate. The caller
owns the transaction.

Double-gating is avoided via ``open_approval``:

- Router path (``open_approval=True``): if an acquisition/create approval rule
  governs the org, the row is created ``status='pending_approval'`` and a live
  ApprovalRequest is opened — the acquisition itself awaits approval.
- Draft applier path (``open_approval=False``): the draft already passed the
  same procedure gate (a human approved the draft), so the row is created in its
  post-approval ``status='proposed'`` and NO second ApprovalRequest is opened.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import UUID

from app.models import Acquisition


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


def create_acquisition(
    session,
    organization_id: UUID,
    payload: dict,
    actor,
    *,
    open_approval: bool = True,
    proposed_by=None,
) -> Acquisition:
    """Create a live Acquisition. The caller owns the transaction.
    ``proposed_by`` is accepted for signature uniformity; Acquisition records no
    separate proposer."""
    from app.services.sequence import next_sequential_number

    p = payload
    acq_number = next_sequential_number(session, organization_id, "ACQ")

    rule = None
    if open_approval:
        from app.services.approval_service import check_approval_required

        rule = check_approval_required(organization_id, "acquisition", "create", session)

    initial_status = "proposed"
    acquisition = Acquisition(
        organization_id=organization_id,
        acquisition_number=acq_number,
        acquisition_method=p["acquisition_method"],
        acquisition_date=_as_date(p.get("acquisition_date")),
        source_id=_as_uuid(p.get("source_id")),
        source_name=p.get("source_name"),
        source_type=p.get("source_type"),
        funding_source=p.get("funding_source"),
        funding_account=p.get("funding_account"),
        cost=_as_decimal(p.get("cost")),
        cost_currency=p.get("cost_currency", "USD"),
        legal_status=p.get("legal_status"),  # never assume clear title
        provisos=p.get("provisos"),
        credit_line=p.get("credit_line"),
        entry_id=_as_uuid(p.get("entry_id")),
        objects_count=p.get("objects_count", 1),
        acquisition_note=p.get("acquisition_note"),
        status="pending_approval" if rule else initial_status,
        created_by=actor,
        updated_by=actor,
    )
    session.add(acquisition)
    session.flush()

    if rule:
        from app.services.approval_service import create_approval_request

        create_approval_request(
            rule=rule,
            entity_type="acquisition",
            entity_id=acquisition.acquisition_id,
            requested_by=actor,
            requested_action={"action": "create", "initial_status": initial_status},
            session=session,
        )

    return acquisition
