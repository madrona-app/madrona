"""Shared create logic for ObjectRight (Rights).

Extracted from the inline ``create_object_right`` router so the draft applier
and the API route share one implementation. The API route takes object_id as a
path param; both paths read it from the payload here. The caller owns the
transaction.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import UUID

from app.models import ObjectRight


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


def create_object_right(
    session,
    organization_id: UUID,
    payload: dict,
    actor,
    *,
    open_approval: bool = True,
    proposed_by=None,
) -> ObjectRight:
    """Create a live ObjectRight. The caller owns the transaction.
    ``open_approval``/``proposed_by`` are accepted for signature uniformity;
    object rights are not approval-gated and record no separate proposer.
    """
    p = payload
    right = ObjectRight(
        organization_id=organization_id,
        object_id=_as_uuid(p["object_id"]),
        right_type=p["right_type"],
        right_subtype=p.get("right_subtype"),
        rights_holder_contact_id=_as_uuid(p.get("rights_holder_contact_id")),
        status=p.get("status", "unknown"),
        start_date=_as_date(p.get("start_date")),
        end_date=_as_date(p.get("end_date")),
        is_perpetual=p.get("is_perpetual", False),
        territory=p.get("territory"),
        territory_note=p.get("territory_note"),
        license_type=p.get("license_type"),
        license_reference=p.get("license_reference"),
        license_url=p.get("license_url"),
        usage_conditions=p.get("usage_conditions"),
        restrictions=p.get("restrictions"),
        fee_required=p.get("fee_required", False),
        fee_amount=_as_decimal(p.get("fee_amount")),
        fee_currency=p.get("fee_currency"),
        fee_note=p.get("fee_note"),
        is_orphan_work=p.get("is_orphan_work", False),
        due_diligence_conducted=p.get("due_diligence_conducted", False),
        due_diligence_date=_as_date(p.get("due_diligence_date")),
        due_diligence_steps=p.get("due_diligence_steps"),
        orphan_works_license_number=p.get("orphan_works_license_number"),
        orphan_works_license_date=_as_date(p.get("orphan_works_license_date")),
        orphan_works_license_expiry=_as_date(p.get("orphan_works_license_expiry")),
        permissions_granted=p.get("permissions_granted"),
        agreement_reference=p.get("agreement_reference"),
        documentation_references=p.get("documentation_references"),
        next_review_date=_as_date(p.get("next_review_date")),
        right_note=p.get("right_note"),
        internal_note=p.get("internal_note"),
        created_by_id=actor,
        updated_by_id=actor,
    )
    session.add(right)
    session.flush()
    return right
