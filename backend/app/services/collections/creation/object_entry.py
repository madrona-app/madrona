"""Shared create logic for ObjectEntry (Object Entry, Procedure 1).

Extracted from the inline ``create_object_entry`` router so the draft applier
and the API route share one implementation. (Entry *items* are added through a
separate endpoint, so the create itself is a flat row.) The caller owns the
transaction.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import UUID

from app.models import ObjectEntry


# These coerce raw request/draft payload values. A malformed one is bad input,
# not a server fault, so each names the offending field and raises ValueError;
# the router turns that into a 400. Previously they let UUID()/fromisoformat()
# raise bare, which surfaced as a 500 with no indication of which field was
# wrong. This service is also driven by the draft applier, so it stays free of
# HTTP concepts.
def _blank(value) -> bool:
    """An omitted optional field, however the caller spelled it.

    A cleared <select> or text input posts "" rather than dropping the key, so
    an empty string means "not provided" — not "provided and malformed". These
    used to reach UUID()/fromisoformat() and raise; turning that into a 400
    made the difference visible but still rejected a legitimate save with
    "authorizer_id is not a valid UUID" for a field the user simply left
    blank.
    """
    return value is None or (isinstance(value, str) and not value.strip())


def _as_uuid(value, field: str = "id") -> UUID | None:
    if _blank(value):
        return None
    if isinstance(value, UUID):
        return value
    try:
        return UUID(str(value).strip())
    except (ValueError, AttributeError, TypeError):
        raise ValueError(f"{field} is not a valid UUID") from None


def _as_date(value, field: str = "date") -> date | None:
    if _blank(value):
        return None
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value).strip())
    except (ValueError, TypeError):
        raise ValueError(f"{field} is not a valid ISO date") from None


def _as_decimal(value, field: str = "amount") -> Decimal | None:
    if _blank(value):
        return None
    if isinstance(value, Decimal):
        return value
    try:
        return Decimal(str(value).strip())
    except (ArithmeticError, ValueError, TypeError):
        raise ValueError(f"{field} is not a valid number") from None


def create_object_entry(
    session,
    organization_id: UUID,
    payload: dict,
    actor,
    *,
    open_approval: bool = True,
    proposed_by=None,
) -> ObjectEntry:
    """Create a live ObjectEntry in status='pending'. The caller owns the
    transaction. ``open_approval``/``proposed_by`` are accepted for signature
    uniformity; object entries are not approval-gated and record no separate
    proposer."""
    from app.services.sequence import next_sequential_number

    p = payload
    entry = ObjectEntry(
        organization_id=organization_id,
        entry_number=next_sequential_number(session, organization_id, "E"),
        entry_date=datetime.now(timezone.utc).date(),
        depositor_id=_as_uuid(p.get("depositor_id"), "depositor_id"),
        depositor_name=p.get("depositor_name"),
        current_owner_id=_as_uuid(p.get("current_owner_id"), "current_owner_id"),
        current_owner=p.get("current_owner"),
        entry_reason=p["reason"],
        entry_method=p.get("entry_method"),
        authorizer_id=_as_uuid(p.get("authorizer_id"), "authorizer_id"),
        authorization_date=_as_date(p.get("authorization_date"), "authorization_date"),
        authorization_note=p.get("authorization_note"),
        expected_duration=p.get("expected_duration"),
        expected_return_date=_as_date(p.get("expected_return_date"), "expected_return_date"),
        receipt_reference=p.get("receipt_reference"),
        entry_note=p.get("entry_note"),
        objects_description=p.get("objects_description"),
        insurance_value=_as_decimal(p.get("insurance_value"), "insurance_value"),
        insurance_currency=p.get("insurance_currency", "USD"),
        insurance_note=p.get("insurance_note"),
        conditions=p.get("conditions"),
        status="pending",
        created_by=actor,
        updated_by=actor,
    )
    session.add(entry)
    session.flush()
    return entry
