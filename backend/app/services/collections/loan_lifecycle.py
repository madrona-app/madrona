"""Shared loan-out lifecycle side-effects.

The ``/dispatch`` router auto-creates Object Exit (5.1) and
Movement (6) records when a loan out is dispatched. That logic used to live
inline in the router, so the sandbox seeder — which sets loans to their final
status directly — produced no exit/movement rows at all, leaving the loan
workspace's exit and movement sections empty.

It is extracted here so the router and the seeder share one implementation.
The caller owns the transaction and the loan's own status transition; this
module only writes the dependent ObjectExit / ObjectExitItem / Movement rows
and the per-object ``exit_id`` back-link, creating the system 'On Loan'
location on first use.
"""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import func

from app.models import CollectionObject
from app.models.locations import Location, Movement
from app.models.procedures import LoanOut, ObjectExit, ObjectExitItem
from app.services.sequence import next_sequential_number


def _as_uuid(value) -> UUID | None:
    if value is None or isinstance(value, UUID):
        return value
    return UUID(str(value))


def _next_movement_seq(session, organization_id: UUID, prefix: str) -> int:
    """Highest existing M.<year>.NNNN counter for the org (0 if none)."""
    latest = (
        session.query(func.max(Movement.movement_reference_number))
        .filter(
            Movement.organization_id == organization_id,
            Movement.movement_reference_number.like(f"{prefix}%"),
        )
        .scalar()
    )
    if latest:
        try:
            return int(latest.split(".")[-1])
        except (ValueError, IndexError):
            pass
    return 0


def ensure_on_loan_location(session, organization_id: UUID, actor) -> Location:
    """Return the org's system 'On Loan' location, creating it on first use."""
    loc = (
        session.query(Location)
        .filter(
            Location.organization_id == organization_id,
            Location.name == "On Loan",
        )
        .first()
    )
    if loc:
        return loc
    loc = Location(
        organization_id=organization_id,
        name="On Loan",
        code="ON-LOAN",
        location_type="other",
        is_external=True,
        description="System location representing objects currently on loan.",
        path="/On Loan",
        depth=0,
        status="active",
        created_by=actor,
    )
    session.add(loc)
    session.flush()
    return loc


def dispatch_loan_out_effects(
    session,
    organization_id: UUID,
    loan: LoanOut,
    actor,
    dispatch_dt: datetime,
) -> None:
    """Create the ObjectExit + Movement records for a dispatched loan out.

    Mirrors the side-effects of the ``/dispatch`` endpoint (the procedure / 6).
    ``dispatch_dt`` is the moment of dispatch — the router passes
    ``datetime.now(timezone.utc)``; the seeder passes the loan's backdated
    dispatch datetime so historical demo loans get historically-dated records.
    ``loan.objects`` must be loaded. The caller owns the transaction.
    """
    today = dispatch_dt.date()

    # --- ObjectExit records (one per object) — the procedure ---
    for loan_obj in loan.objects:
        if loan_obj.exit_id:
            continue  # already exited from a previous dispatch
        exit_rec = ObjectExit(
            organization_id=organization_id,
            exit_number=next_sequential_number(session, organization_id, "EX"),
            exit_date=today,
            exit_reason="loan_out",
            reference_type="loan_out",
            reference_id=loan.loan_out_id,
            recipient_id=loan.borrower_id,
            recipient_name=loan.borrower_name,
            insurance_value=loan_obj.insurance_value,
            insurance_currency=loan_obj.insurance_currency or loan.insurance_currency,
            authorization_id=actor,
            authorization_date=today,
            status="dispatched",
            created_by=actor,
            updated_by=actor,
        )
        session.add(exit_rec)
        session.flush()

        session.add(ObjectExitItem(
            exit_id=exit_rec.exit_id,
            organization_id=organization_id,
            object_id=loan_obj.object_id,
        ))
        loan_obj.exit_id = exit_rec.exit_id

    # --- Movement records (one per object) — procedure 6 ---
    on_loan_location = ensure_on_loan_location(session, organization_id, actor)

    mv_prefix = f"M.{dispatch_dt.year}."
    last_mv_num = _next_movement_seq(session, organization_id, mv_prefix)

    mv_idx = 0
    for loan_obj in loan.objects:
        coll_obj = (
            session.query(CollectionObject)
            .filter(CollectionObject.object_id == loan_obj.object_id)
            .first()
        )
        from_location_id = coll_obj.current_location_id if coll_obj else None

        # Skip if object is already at the On Loan location.
        if from_location_id and from_location_id == on_loan_location.location_id:
            continue

        ref_number = f"{mv_prefix}{last_mv_num + mv_idx + 1:04d}"
        mv_idx += 1
        session.add(Movement(
            organization_id=organization_id,
            movement_reference_number=ref_number,
            object_id=loan_obj.object_id,
            from_location_id=from_location_id,
            to_location_id=on_loan_location.location_id,
            movement_date=dispatch_dt,
            reason="loan",
            reference_type="loan_out",
            reference_id=loan.loan_out_id,
            status="in_transit",
            authorized_by=actor,
            authorization_date=today,
            created_by=actor,
        ))

    session.flush()


def return_loan_out_effects(
    session,
    organization_id: UUID,
    loan: LoanOut,
    actor,
    return_dt: datetime,
    to_location_id,
) -> None:
    """Record a loan-out return as one atomic unit with the caller's transaction.

    A return is not just a status flip: the borrowed objects come back and a
    destination must be chosen for them. So this completes the outbound dispatch
    Movement(s) and creates a return Movement (On Loan -> the caller-chosen
    location) per object. ``to_location_id`` is REQUIRED — a return with nowhere
    to put the objects is not a valid return, and the caller is expected to roll
    back (the /return endpoint returns 400; the user is re-prompted). Shared by
    the /return endpoint and the sandbox seeder.

    Raises ValueError if ``to_location_id`` is missing or not a location in the
    org. ``loan.objects`` must be loaded. The caller owns the transaction and the
    loan's own status/date transition.
    """
    to_uuid = _as_uuid(to_location_id)
    if to_uuid is None:
        raise ValueError("a destination location is required to return a loan")
    to_location = (
        session.query(Location)
        .filter(
            Location.location_id == to_uuid,
            Location.organization_id == organization_id,
        )
        .first()
    )
    if to_location is None:
        raise ValueError(f"destination location {to_uuid} not found")

    object_ids = [lo.object_id for lo in loan.objects]
    if not object_ids:
        return

    # Complete the outbound (dispatch) movements for this loan — the trip out is
    # finished once the objects are back.
    (
        session.query(Movement)
        .filter(
            Movement.organization_id == organization_id,
            Movement.reference_type == "loan_out",
            Movement.reference_id == loan.loan_out_id,
            Movement.status == "in_transit",
        )
        .update({"status": "completed"}, synchronize_session=False)
    )

    on_loan_location = ensure_on_loan_location(session, organization_id, actor)

    today = return_dt.date()
    mv_prefix = f"M.{return_dt.year}."
    last_mv_num = _next_movement_seq(session, organization_id, mv_prefix)

    for i, object_id in enumerate(object_ids):
        session.add(Movement(
            organization_id=organization_id,
            movement_reference_number=f"{mv_prefix}{last_mv_num + i + 1:04d}",
            object_id=object_id,
            from_location_id=on_loan_location.location_id,
            to_location_id=to_location.location_id,
            movement_date=return_dt,
            reason="loan",
            reference_type="loan_out",
            reference_id=loan.loan_out_id,
            status="completed",
            authorized_by=actor,
            authorization_date=today,
            created_by=actor,
        ))

    session.flush()
