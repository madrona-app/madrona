"""Shared create logic for Valuation (Procedure 13).

Extracted from the inline ``create_valuation`` router so the draft applier and
the API route share one implementation. Encapsulates the create's own side
effect (un-marking prior ``is_current`` valuations of the same object+type) and
the optional approval gate. The caller owns the transaction.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import UUID

from app.models import Valuation


def _as_uuid(value) -> UUID | None:
    if value is None or isinstance(value, UUID):
        return value
    return UUID(str(value))


def _as_date(value) -> date | None:
    if value is None or isinstance(value, date):
        return value
    return date.fromisoformat(str(value))


def _as_decimal(value) -> Decimal:
    return value if isinstance(value, Decimal) else Decimal(str(value))


def create_valuation(
    session,
    organization_id: UUID,
    payload: dict,
    actor,
    *,
    open_approval: bool = True,
    proposed_by=None,
) -> Valuation:
    """Create a live Valuation. The caller owns the transaction.

    ``open_approval=True`` (the router path) opens a procedure approval request
    when a rule governs valuation/create; ``open_approval=False`` (the draft
    applier) skips it — the draft's own approval gate already ran.
    ``proposed_by`` is accepted for signature uniformity; Valuation records no
    separate proposer, so ``actor`` is used for created_by/updated_by.
    """
    p = payload
    object_uuid = _as_uuid(p.get("object_id"))
    is_current = p.get("is_current", True)

    # Side effect (parity with the router): a new current valuation supersedes
    # any existing current one of the same object+type.
    if is_current and object_uuid is not None:
        existing_current = (
            session.query(Valuation)
            .filter(
                Valuation.object_id == object_uuid,
                Valuation.valuation_type == p["valuation_type"],
                Valuation.is_current.is_(True),
                Valuation.organization_id == organization_id,
            )
            .all()
        )
        for ev in existing_current:
            ev.is_current = False

    valuation = Valuation(
        organization_id=organization_id,
        object_id=object_uuid,
        valuation_type=p["valuation_type"],
        valuation_amount=_as_decimal(p["valuation_amount"]),
        valuation_currency=p.get("valuation_currency", "USD"),
        valuation_date=_as_date(p["valuation_date"]),
        valuator_id=_as_uuid(p.get("valuator_id")),
        valuator_name=p.get("valuator_name"),
        valuator_organization=p.get("valuator_organization"),
        valuator_credentials=p.get("valuator_credentials"),
        valuation_method=p.get("valuation_method"),
        documentation_reference=p.get("documentation_reference"),
        valuation_note=p.get("valuation_note"),
        valid_from=_as_date(p.get("valid_from")),
        valid_until=_as_date(p.get("valid_until")),
        is_current=is_current,
        authorizer_id=_as_uuid(p.get("authorizer_id")),
        authorization_date=_as_date(p.get("authorization_date")),
        authorization_note=p.get("authorization_note"),
        created_by=actor,
        updated_by=actor,
    )
    session.add(valuation)
    session.flush()

    if open_approval:
        from app.services.approval_service import (
            check_approval_required,
            create_approval_request,
        )

        rule = check_approval_required(organization_id, "valuation", "create", session)
        if rule:
            create_approval_request(
                rule=rule,
                entity_type="valuation",
                entity_id=valuation.valuation_id,
                requested_by=actor,
                requested_action={"action": "create", "initial_status": "active"},
                session=session,
            )

    return valuation
