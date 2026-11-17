"""Record movements for many objects at once.

Shared by the workspace record_movement bulk action and by applying audit
results ("move these objects' records to where they were found"), so both
create Movement records, update current location and keep location counts
the same way.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any, Iterable
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import CollectionObject, Location, Movement


def next_movement_base(db: Session, org_id: UUID) -> int:
    """Count used to number the next batch of movement references."""
    return db.query(func.count(Movement.movement_id)).filter(Movement.organization_id == org_id).scalar() or 0


def record_bulk_movement(
    db: Session,
    org_id: UUID,
    user_id: UUID | None,
    objects: Iterable[CollectionObject],
    to_location: Location,
    params: dict[str, Any],
    skip_blocked: bool = False,
    base_count: int | None = None,
) -> tuple[list[dict[str, Any]], int, int, int]:
    """Move each object to ``to_location`` with a completed Movement record.

    ``params`` carries reason (required), movement_note, location_fitness and
    movement_method. Objects already at the destination are skipped (or
    reported as errors when ``skip_blocked`` is false). Does not commit.

    Returns (results, success_count, error_count, references_used).
    """
    if base_count is None:
        base_count = next_movement_base(db, org_id)

    results: list[dict[str, Any]] = []
    success_count = 0
    error_count = 0
    used = 0
    now = datetime.now(timezone.utc)

    for obj in objects:
        result: dict[str, Any] = {"object_id": str(obj.object_id), "accession_number": obj.object_number}

        if obj.current_location_id == to_location.location_id:
            result["message"] = "Already at destination"
            if skip_blocked:
                result["status"] = "skipped"
            else:
                result["status"] = "error"
                error_count += 1
            results.append(result)
            continue

        used += 1
        ref_number = f"M.{now.year}.{base_count + used:04d}"
        mov = Movement(
            organization_id=org_id,
            movement_reference_number=ref_number,
            object_id=obj.object_id,
            from_location_id=obj.current_location_id,
            to_location_id=to_location.location_id,
            movement_date=now,
            reason=params["reason"],
            movement_note=params.get("movement_note"),
            location_fitness=params.get("location_fitness"),
            movement_method=params.get("movement_method"),
            authorized_by=user_id,
            authorization_date=now.date(),
            moved_by=user_id,
            created_by=user_id,
            status="completed",
        )

        old_location_id = obj.current_location_id
        obj.current_location_id = to_location.location_id
        obj.current_location_date = now
        obj.current_location_fitness = params.get("location_fitness")
        obj.updated_by = user_id

        if old_location_id:
            old_loc = db.query(Location).filter(Location.location_id == old_location_id).first()
            if old_loc and old_loc.current_count > 0:
                old_loc.current_count -= 1
        to_location.current_count = (to_location.current_count or 0) + 1

        db.add(mov)
        db.flush()
        result["status"] = "success"
        result["record_id"] = str(mov.movement_id)
        result["reference_number"] = ref_number
        results.append(result)
        success_count += 1

    return results, success_count, error_count, used


class FieldWriteRestricted(PermissionError):
    """The user's field-level access forbids writing a field this needs."""


def ensure_object_fields_writable(db: Session, org_id: UUID, user_id: UUID | None, fields: Iterable[str]) -> None:
    """Raise FieldWriteRestricted if any of ``fields`` is write-restricted."""
    if user_id is None:
        return
    from app.services.field_access_service import get_write_restricted_fields
    restricted = get_write_restricted_fields("collection_object", str(org_id), str(user_id), session=db)
    blocked = sorted(set(fields) & restricted)
    if blocked:
        raise FieldWriteRestricted(", ".join(blocked))


def mark_inventoried(
    db: Session,
    org_id: UUID,
    user_id: UUID | None,
    entries: Iterable[tuple[CollectionObject, Any, UUID | None]],
    inventoried_date: Any = None,
) -> tuple[list[dict[str, Any]], int, int]:
    """Set last_inventoried_date / last_inventoried_by on objects.

    Each entry is (object, date or None, user or None); a missing date falls
    back to ``inventoried_date`` and then today, a missing user to
    ``user_id``. Does not commit. Returns (results, success, errors).
    """
    ensure_object_fields_writable(db, org_id, user_id, ["last_inventoried_date", "last_inventoried_by"])

    default_date = inventoried_date
    if isinstance(default_date, str) and default_date:
        default_date = date.fromisoformat(default_date[:10])
    if not default_date:
        default_date = datetime.now(timezone.utc).date()

    results: list[dict[str, Any]] = []
    for obj, when, who in entries:
        when = when or default_date
        if isinstance(when, datetime):
            when = when.date()
        obj.last_inventoried_date = when
        obj.last_inventoried_by = who or user_id
        obj.updated_by = user_id
        results.append({
            "object_id": str(obj.object_id),
            "accession_number": obj.object_number,
            "status": "success",
            "message": f"Inventoried {when.isoformat()}",
        })
    return results, len(results), 0
