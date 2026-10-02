"""Shared create logic for ConservationTreatment (Conservation).

Extracted from the inline ``create_conservation_treatment`` router so the draft
applier and the API route share one implementation. The caller owns the
transaction.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from app.models import ConservationTreatment


def _as_uuid(value) -> UUID | None:
    if value is None or isinstance(value, UUID):
        return value
    return UUID(str(value))


def _as_decimal(value) -> Decimal | None:
    if value is None or isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def create_conservation_treatment(
    session,
    organization_id: UUID,
    payload: dict,
    actor,
    *,
    open_approval: bool = True,
    proposed_by=None,
) -> ConservationTreatment:
    """Create a live ConservationTreatment in status='proposed'. The caller owns
    the transaction. ``open_approval``/``proposed_by`` are accepted for signature
    uniformity; treatment creation is not approval-gated and records no separate
    proposer."""
    from app.services.sequence import next_sequential_number

    p = payload
    treatment = ConservationTreatment(
        organization_id=organization_id,
        treatment_number=next_sequential_number(session, organization_id, "CON"),
        object_id=_as_uuid(p.get("object_id")),
        conservator_id=_as_uuid(p.get("conservator_id")),
        conservator_name=p.get("conservator_name"),
        conservator_institution=p.get("conservator_institution"),
        treatment_type=p["treatment_type"],
        proposal_date=datetime.now(timezone.utc).date(),
        proposal_summary=p.get("proposal_summary"),
        estimated_duration_days=p.get("estimated_duration_days"),
        estimated_cost=_as_decimal(p.get("estimated_cost")),
        estimated_cost_currency=p.get("estimated_cost_currency", "USD"),
        treatment_note=p.get("treatment_note"),
        status="proposed",
        created_by=actor,
        updated_by=actor,
    )
    session.add(treatment)
    session.flush()
    return treatment
