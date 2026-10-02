"""Shared create logic for Deaccession (Procedure 4).

Extracted from the inline ``create_deaccession`` router so the draft applier and
the API route share one implementation, including the approval gate and the
DeaccessionAudit child record. The caller owns the transaction.

Double-gating is avoided exactly as for acquisition (see ``open_approval``).
``proposed_by`` populates Deaccession.proposed_by so a draft preserves its
original proposer distinct from the approving actor.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from app.models import Deaccession, DeaccessionAudit


def _as_uuid(value) -> UUID | None:
    if value is None or isinstance(value, UUID):
        return value
    return UUID(str(value))


def create_deaccession(
    session,
    organization_id: UUID,
    payload: dict,
    actor,
    *,
    open_approval: bool = True,
    proposed_by=None,
) -> Deaccession:
    """Create a live Deaccession proposal (+ its audit record). The caller owns
    the transaction."""
    from app.services.sequence import next_sequential_number

    p = payload
    deacc_number = next_sequential_number(session, organization_id, "DA")

    rule = None
    if open_approval:
        from app.services.approval_service import check_approval_required

        rule = check_approval_required(organization_id, "deaccession", "create", session)

    initial_status = "proposed"
    now = datetime.now(timezone.utc)
    deacc = Deaccession(
        organization_id=organization_id,
        deaccession_number=deacc_number,
        object_id=_as_uuid(p["object_id"]),
        proposal_date=now.date(),
        proposed_by=proposed_by or actor,
        reason=p["reason"],
        reason_detail=p.get("reason_detail"),
        justification=p.get("justification"),
        disposal_method=p.get("disposal_method"),
        disposal_method_detail=p.get("disposal_method_detail"),
        recipient_id=_as_uuid(p.get("recipient_id")),
        recipient_name=p.get("recipient_name"),
        committee_review_required=p.get("committee_review_required", True),
        board_approval_required=p.get("board_approval_required", True),
        deaccession_note=p.get("deaccession_note"),
        status="pending_approval" if rule else initial_status,
        created_by=actor,
        updated_by=actor,
    )
    session.add(deacc)
    session.flush()

    if rule:
        from app.services.approval_service import create_approval_request

        create_approval_request(
            rule=rule,
            entity_type="deaccession",
            entity_id=deacc.deaccession_id,
            requested_by=actor,
            requested_action={"action": "create", "initial_status": initial_status},
            session=session,
        )

    session.add(DeaccessionAudit(
        deaccession_id=deacc.deaccession_id,
        organization_id=organization_id,
        action="created",
        performed_by=actor,
        performed_at=now,
        note="Deaccession proposal created for object",
    ))

    return deacc
