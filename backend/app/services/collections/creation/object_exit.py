"""Shared create logic for ObjectExit (Object Exit, Procedure 5).

Extracted from the inline ``create_object_exit`` router so the draft applier and
the API route share one implementation, including the approval gate and the
entry-outcome sync (the create case of the router's
``_sync_entry_outcome_from_exit``: link the originating entry to this exit).
The caller owns the transaction.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from app.models import ObjectEntry, ObjectExit


def _as_uuid(value) -> UUID | None:
    if value is None or isinstance(value, UUID):
        return value
    return UUID(str(value))


def _as_decimal(value) -> Decimal | None:
    if value is None or isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def create_object_exit(
    session,
    organization_id: UUID,
    payload: dict,
    actor,
    *,
    open_approval: bool = True,
    proposed_by=None,
) -> ObjectExit:
    """Create a live ObjectExit. The caller owns the transaction. Approval gate
    semantics match acquisition (see ``open_approval``)."""
    from app.services.sequence import next_sequential_number

    p = payload
    rule = None
    if open_approval:
        from app.services.approval_service import check_approval_required

        rule = check_approval_required(organization_id, "object_exit", "create", session)

    initial_status = "pending"
    now = datetime.now(timezone.utc)
    exit_rec = ObjectExit(
        organization_id=organization_id,
        exit_number=next_sequential_number(session, organization_id, "EX"),
        exit_date=now.date(),
        recipient_id=_as_uuid(p.get("recipient_id")),
        recipient_name=p.get("recipient_name"),
        recipient_address=p.get("recipient_address"),
        exit_reason=p["exit_reason"],
        entry_id=_as_uuid(p.get("entry_id")),
        reference_type=p.get("reference_type"),
        reference_id=_as_uuid(p.get("reference_id")),
        authorization_id=actor,
        authorization_date=now.date(),
        exit_method=p.get("exit_method"),
        insurance_value=_as_decimal(p.get("insurance_value")),
        insurance_currency=p.get("insurance_currency", "USD"),
        exit_note=p.get("exit_note"),
        status="pending_approval" if rule else initial_status,
        created_by=actor,
        updated_by=actor,
    )
    session.add(exit_rec)
    session.flush()

    if rule:
        from app.services.approval_service import create_approval_request

        create_approval_request(
            rule=rule,
            entity_type="object_exit",
            entity_id=exit_rec.exit_id,
            requested_by=actor,
            requested_action={"action": "create", "initial_status": initial_status},
            session=session,
        )

    # Link the originating entry's outcome to this exit (create case of
    # _sync_entry_outcome_from_exit; no previous link to clear).
    if exit_rec.entry_id:
        entry = (
            session.query(ObjectEntry)
            .filter(ObjectEntry.entry_id == exit_rec.entry_id)
            .first()
        )
        if entry:
            entry.outcome = "returned"
            entry.outcome_reference_id = exit_rec.exit_id
            if exit_rec.exit_date and not entry.return_date:
                entry.return_date = exit_rec.exit_date

    return exit_rec
