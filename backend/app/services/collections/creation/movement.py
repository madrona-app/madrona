"""Shared create logic for Movement (Movement, Procedure 6).

Extracted from the inline ``create_movement`` router so the draft applier and
the API route share one implementation. A movement is an aggregate create: it
derives a year-prefixed reference number, resolves the part to move, writes the
Movement row, and mutates the part's / object's current location and the two
affected ``Location.current_count`` values. Applying an approved movement draft
therefore performs the full move. The caller owns the transaction.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func

from app.models import CollectionObject, Location, Movement, ObjectPart


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


def _next_reference_number(session, organization_id: UUID) -> str:
    year = datetime.now(timezone.utc).year
    prefix = f"M.{year}."
    latest = (
        session.query(func.max(Movement.movement_reference_number))
        .filter(
            Movement.organization_id == organization_id,
            Movement.movement_reference_number.like(f"{prefix}%"),
        )
        .scalar()
    )
    last_num = 0
    if latest:
        try:
            last_num = int(latest.split(".")[-1])
        except (ValueError, IndexError):
            pass
    return f"{prefix}{last_num + 1:04d}"


def _resolve_part(session, organization_id: UUID, obj, part_id) -> ObjectPart | None:
    """Explicit part if given; else the primary part (part_number IS NULL);
    else the first part by display_order. Mirrors the router."""
    if part_id:
        return (
            session.query(ObjectPart)
            .filter(
                ObjectPart.part_id == _as_uuid(part_id),
                ObjectPart.object_id == obj.object_id,
                ObjectPart.organization_id == organization_id,
            )
            .first()
        )
    primary = (
        session.query(ObjectPart)
        .filter(
            ObjectPart.object_id == obj.object_id,
            ObjectPart.organization_id == organization_id,
            ObjectPart.part_number.is_(None),
        )
        .first()
    )
    if primary:
        return primary
    return (
        session.query(ObjectPart)
        .filter(
            ObjectPart.object_id == obj.object_id,
            ObjectPart.organization_id == organization_id,
        )
        .order_by(ObjectPart.display_order)
        .first()
    )


def create_movement(
    session,
    organization_id: UUID,
    payload: dict,
    actor,
    *,
    open_approval: bool = True,
    proposed_by=None,
) -> Movement:
    """Create a live Movement and apply its location side effects. The caller
    owns the transaction.

    ``open_approval`` is accepted for signature uniformity; movements are not
    approval-gated at creation (the router opens no approval), so it is a no-op.
    ``proposed_by`` is likewise accepted but unused — ``actor`` populates
    authorized_by / moved_by / created_by.
    """
    p = payload
    object_uuid = _as_uuid(p.get("object_id"))
    to_location_uuid = _as_uuid(p.get("to_location_id"))

    obj = (
        session.query(CollectionObject)
        .filter(
            CollectionObject.object_id == object_uuid,
            CollectionObject.organization_id == organization_id,
        )
        .first()
    )
    if obj is None:
        raise ValueError(f"object {object_uuid} not found")

    to_location = (
        session.query(Location)
        .filter(
            Location.location_id == to_location_uuid,
            Location.organization_id == organization_id,
        )
        .first()
    )
    if to_location is None:
        raise ValueError(f"destination location {to_location_uuid} not found")

    part = _resolve_part(session, organization_id, obj, p.get("part_id"))
    from_location_id = part.current_location_id if part else obj.current_location_id

    now = datetime.now(timezone.utc)
    mov = Movement(
        organization_id=organization_id,
        movement_reference_number=_next_reference_number(session, organization_id),
        object_id=object_uuid,
        part_id=part.part_id if part else None,
        from_location_id=from_location_id,
        to_location_id=to_location_uuid,
        movement_date=now,
        reason=p["reason"],
        movement_note=p.get("movement_note"),
        location_fitness=p.get("location_fitness"),
        movement_method=p.get("movement_method"),
        authorized_by=actor,
        authorizer_id=_as_uuid(p.get("authorizer_id")),
        authorization_date=_as_date(p.get("authorization_date")) or now.date(),
        authorization_note=p.get("authorization_note"),
        moved_by=actor,
        handler_id=_as_uuid(p.get("handler_id")),
        handler_name=p.get("handler_name"),
        organization_courier=bool(p.get("organization_courier", False)),
        courier_name=p.get("courier_name"),
        shipper_id=_as_uuid(p.get("shipper_id")),
        shipper_name=p.get("shipper_name"),
        shipping_method=p.get("shipping_method"),
        shipping_tracking_number=p.get("shipping_tracking_number"),
        shipping_insurance_value=_as_decimal(p.get("shipping_insurance_value")),
        shipping_insurance_currency=p.get("shipping_insurance_currency"),
        shipping_note=p.get("shipping_note"),
        condition_note=p.get("condition_note"),
        condition_report_id=_as_uuid(p.get("condition_report_id")),
        planned_removal_date=_as_date(p.get("planned_removal_date")),
        planned_return_date=_as_date(p.get("planned_return_date")),
        created_by=actor,
        status=p.get("status", "completed"),
    )

    # Update the part's current location (and the object's, for the primary
    # part, for backwards compatibility).
    old_location_id = from_location_id
    if part:
        part.current_location_id = to_location_uuid
        part.current_location_date = now
        part.current_location_fitness = p.get("location_fitness")
        part.updated_by = actor

    if part and part.part_number is None:
        obj.current_location_id = to_location_uuid
        obj.current_location_date = now
        obj.current_location_fitness = p.get("location_fitness")
        obj.updated_by = actor

    # Keep occupancy counts honest.
    if old_location_id:
        old_loc = (
            session.query(Location)
            .filter(Location.location_id == old_location_id)
            .first()
        )
        if old_loc and old_loc.current_count > 0:
            old_loc.current_count -= 1
    to_location.current_count += 1

    session.add(mov)
    session.flush()
    return mov
