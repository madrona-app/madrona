"""
Loans seeder — generate plausible LoanIn (incoming) and LoanOut
(outgoing) records over the seeded objects + institutional contacts.

Strategy:
    - LoanOut: pick 3-4 seeded CollectionObject rows that are "out on
      loan" to peer institutions (Cleveland, MFA Boston, Rijksmuseum).
      Each loan covers 1-2 objects, mixes statuses (on_loan, returned,
      in_transit, requested) and dates.
    - LoanIn: 3-4 incoming loans of EXTERNAL objects from the same
      peer institutions. object_id stays NULL because borrowed objects
      aren't in our permanent collection — the LoanInObject row carries
      object_title, artist_maker, medium directly.
    - Idempotent: if any loans already exist for the org, skip.
    - Determinism: random.Random keyed on org_id.
"""
from __future__ import annotations

import logging
import random
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.contacts import Constituent
from app.models.locations import Location
from app.models.objects import CollectionObject
from app.models.procedures import LoanIn, LoanInObject, LoanOut, LoanOutObject
from app.services.collections.creation.loan_in import create_loan_in
from app.services.collections.creation.loan_out import create_loan_out
from app.services.collections.loan_lifecycle import (
    dispatch_loan_out_effects,
    return_loan_out_effects,
)

logger = logging.getLogger(__name__)

# Loan-out statuses that imply the objects have physically left the building —
# these get ObjectExit + Movement dispatch side-effects.
_DISPATCHED_OUT_STATUSES = {"in_transit", "on_loan", "returned"}


def _as_dt(d: date) -> datetime:
    """Midnight UTC datetime for a date (Movement.movement_date is a datetime)."""
    return datetime.combine(d, time.min, tzinfo=timezone.utc)


def _pick_storage_location(session: Session, org_id: UUID) -> Location | None:
    """An internal location to return loaned objects to — first non-external
    room (falls back to any non-external location). Seeded by reference data."""
    q = session.query(Location).filter(
        Location.organization_id == org_id,
        Location.is_external.is_(False),
    )
    room = q.filter(Location.location_type == "room").order_by(Location.code).first()
    return room or q.order_by(Location.code).first()


# Borrowed-object templates for LoanIn (representative items a peer
# institution would lend to a museum). These don't need to exist in
# our CollectionObject table — they live only on the loan record.
_LOAN_IN_TEMPLATES: list[dict[str, str]] = [
    {
        "object_title": "Portrait of a Young Woman",
        "artist_maker": "Rembrandt van Rijn (workshop)",
        "date_description": "c. 1640",
        "medium": "Oil on panel",
        "dimensions": "60.5 × 48.2 cm",
    },
    {
        "object_title": "Tea Caddy with Flying Cranes",
        "artist_maker": "Edo period, c. 1780",
        "date_description": "c. 1780",
        "medium": "Lacquer on wood with gold leaf",
        "dimensions": "12.4 × 10.2 × 8.5 cm",
    },
    {
        "object_title": "Landscape with Two Figures",
        "artist_maker": "Camille Pissarro",
        "date_description": "1873",
        "medium": "Oil on canvas",
        "dimensions": "55.0 × 73.5 cm",
    },
    {
        "object_title": "Bronze Figurine of a Hare",
        "artist_maker": "Unknown (German, 16th century)",
        "date_description": "c. 1550-1580",
        "medium": "Bronze with patina",
        "dimensions": "11.2 × 8.0 × 4.5 cm",
    },
    {
        "object_title": "Manuscript Leaf, Book of Hours",
        "artist_maker": "Workshop of the Master of Catherine of Cleves",
        "date_description": "c. 1440",
        "medium": "Tempera and gold on parchment",
        "dimensions": "19.7 × 14.0 cm",
    },
]


def _weighted_choice(rng: random.Random, weighted: list[tuple[str, int]]) -> str:
    population = [v for v, _ in weighted]
    weights = [w for _, w in weighted]
    return rng.choices(population, weights=weights, k=1)[0]


def seed_loans(
    session: Session,
    *,
    org_id: UUID,
    admin_user_id: UUID,
) -> dict[str, Any]:
    """
    Generate LoanIn + LoanOut records for the demo org.

    Idempotent: skips if any loans already exist.
    """
    if org_id is None or admin_user_id is None:
        raise ValueError("seed_loans requires org_id and admin_user_id")

    existing_in = session.query(LoanIn).filter_by(organization_id=org_id).count()
    existing_out = session.query(LoanOut).filter_by(organization_id=org_id).count()
    if existing_in > 0 or existing_out > 0:
        logger.info(
            "sandbox seeder: loans already present for org %s (in=%d, out=%d), skipping",
            org_id, existing_in, existing_out,
        )
        return {
            "loans_in_created": 0,
            "loan_in_objects_created": 0,
            "loans_out_created": 0,
            "loan_out_objects_created": 0,
            "loans_in_existing": existing_in,
            "loans_out_existing": existing_out,
            "skipped_at_target": True,
        }

    rng = random.Random(int(str(org_id).replace("-", "")[:16], 16))

    # Institutional contacts to use as lenders / borrowers / venues.
    institutions: list[Constituent] = (
        session.query(Constituent)
        .filter(
            Constituent.organization_id == org_id,
            Constituent.contact_categories.op("?")("institution"),
        )
        .all()
    )
    if not institutions:
        logger.warning(
            "sandbox seeder: no institutional contacts for org %s; loans demo will be sparse",
            org_id,
        )

    # Seeded objects we own — required for LoanOut (object_id NOT NULL).
    own_objects: list[CollectionObject] = (
        session.query(CollectionObject)
        .filter(
            CollectionObject.organization_id == org_id,
            or_(
                CollectionObject.object_number.like("MET-%"),
                CollectionObject.object_number.like("SI-%"),
                CollectionObject.object_number.like("RIJKS-%"),
            ),
        )
        .all()
    )
    rng.shuffle(own_objects)

    today = date.today()
    loans_in_created = 0
    loan_in_objects_created = 0
    loans_out_created = 0
    loan_out_objects_created = 0
    exits_created = 0
    movements_created = 0

    # ---- LoanIn — borrow 3-4 external objects ----
    # Status mix: 1 on_loan (currently here), 1 returned (past), 1 in_transit
    # (just shipped), 1 approved (agreement signed, not yet shipped).
    loan_in_scenarios: list[dict[str, Any]] = [
        {
            "status": "on_loan",
            "purpose": "exhibition",
            "request_offset_days": -180,
            "approval_offset_days": -150,
            "start_offset_days": -60,
            "end_offset_days": 120,
            "received": True,
        },
        {
            "status": "returned",
            "purpose": "research",
            "request_offset_days": -540,
            "approval_offset_days": -510,
            "start_offset_days": -360,
            "end_offset_days": -180,
            "received": True,
            "returned": True,
        },
        {
            "status": "in_transit",
            "purpose": "exhibition",
            "request_offset_days": -120,
            "approval_offset_days": -90,
            "start_offset_days": 7,
            "end_offset_days": 200,
            "received": False,
        },
        {
            "status": "approved",
            # loan-in purposes validate against exhibition|research|conservation|
            # long_term|other (procedures.ts); "study" isn't in that set.
            "purpose": "research",
            "request_offset_days": -45,
            "approval_offset_days": -20,
            "start_offset_days": 30,
            "end_offset_days": 240,
            "received": False,
        },
    ]

    available_templates = _LOAN_IN_TEMPLATES.copy()
    rng.shuffle(available_templates)

    for idx, scenario in enumerate(loan_in_scenarios):
        if not available_templates:
            break

        lender = rng.choice(institutions) if institutions else None
        request_date = today + timedelta(days=scenario["request_offset_days"])
        approval_date = today + timedelta(days=scenario["approval_offset_days"])
        start_date = today + timedelta(days=scenario["start_offset_days"])
        end_date = today + timedelta(days=scenario["end_offset_days"])

        # Route through the shared create service: canonical LI number from
        # next_sequential_number, created_by/updated_by set. open_approval=False
        # → status='requested', no ApprovalRequest; we then stamp the backdated
        # request/approval dates and the demo end-status the service doesn't own.
        loan = create_loan_in(
            session,
            org_id,
            {
                "loan_purpose": scenario["purpose"],
                "lender_id": lender.constituent_id if lender else None,
                "lender_name": lender.name if lender else None,
                "loan_start_date": start_date,
                "loan_end_date": end_date,
                "insurance_value": Decimal(rng.choice([50000, 125000, 350000, 850000])),
                "insurance_currency": "USD",
                "loan_note": (
                    f"Borrowed for {scenario['purpose']} "
                    f"({'currently on view' if scenario['status'] == 'on_loan' else scenario['status']})."
                ),
            },
            admin_user_id,
            open_approval=False,
        )
        loan.request_date = request_date
        loan.approval_date = approval_date
        loan.actual_receipt_date = start_date if scenario.get("received") else None
        loan.actual_return_date = end_date if scenario.get("returned") else None
        loan.indemnity = rng.random() < 0.3
        loan.facility_report_sent = True
        loan.facility_report_approved = True
        loan.status = scenario["status"]
        session.flush()
        loans_in_created += 1

        # Each LoanIn carries 1-2 borrowed object rows from the template
        # pool. object_id stays NULL because they're not in our collection.
        n_objects = 1 if rng.random() < 0.7 else 2
        for _ in range(n_objects):
            if not available_templates:
                break
            tpl = available_templates.pop()
            link = LoanInObject(
                loan_in_id=loan.loan_in_id,
                organization_id=org_id,
                object_title=tpl["object_title"],
                artist_maker=tpl["artist_maker"],
                date_description=tpl["date_description"],
                medium=tpl["medium"],
                dimensions=tpl["dimensions"],
                object_number_lender=f"{(lender.name[:3].upper() if lender else 'EXT')}-{rng.randint(1000, 9999)}",
                insurance_value=Decimal(rng.choice([25000, 75000, 200000])),
                insurance_currency="USD",
                item_status=(
                    "received" if scenario.get("received") and not scenario.get("returned")
                    else "returned" if scenario.get("returned")
                    else "pending"
                ),
                received_date=start_date if scenario.get("received") else None,
                returned_date=end_date if scenario.get("returned") else None,
            )
            session.add(link)
            loan_in_objects_created += 1

    # ---- LoanOut — lend 3-4 own objects to peer institutions ----
    if own_objects and institutions:
        loan_out_scenarios: list[dict[str, Any]] = [
            {
                "status": "on_loan",
                "purpose": "exhibition",
                "request_offset_days": -210,
                "approval_offset_days": -180,
                "start_offset_days": -90,
                "end_offset_days": 90,
            },
            {
                "status": "returned",
                "purpose": "exhibition",
                "request_offset_days": -720,
                "approval_offset_days": -690,
                "start_offset_days": -540,
                "end_offset_days": -360,
                "returned": True,
            },
            {
                "status": "in_transit",
                "purpose": "touring",
                "request_offset_days": -150,
                "approval_offset_days": -120,
                "start_offset_days": 5,
                "end_offset_days": 180,
            },
            {
                "status": "pending_approval",
                "purpose": "research",
                "request_offset_days": -30,
                "approval_offset_days": None,
                "start_offset_days": 60,
                "end_offset_days": 150,
            },
        ]

        storage = _pick_storage_location(session, org_id)
        obj_pos = 0
        for scenario in loan_out_scenarios:
            if obj_pos >= len(own_objects):
                break
            n_objects = 1 if rng.random() < 0.6 else 2
            group = own_objects[obj_pos : obj_pos + n_objects]
            obj_pos += n_objects
            if not group:
                break

            status = scenario["status"]
            borrower = rng.choice(institutions)
            request_date = today + timedelta(days=scenario["request_offset_days"])
            approval_date = (
                today + timedelta(days=scenario["approval_offset_days"])
                if scenario["approval_offset_days"] is not None
                else None
            )
            start_date = today + timedelta(days=scenario["start_offset_days"])
            end_date = today + timedelta(days=scenario["end_offset_days"])
            dispatch_date = start_date if status in _DISPATCHED_OUT_STATUSES else None

            # Shared create service: canonical LO number + audit fields.
            loan = create_loan_out(
                session,
                org_id,
                {
                    "loan_purpose": scenario["purpose"],
                    "borrower_id": borrower.constituent_id,
                    "borrower_name": borrower.name,
                    "venue_name": borrower.name,
                    "exhibition_title": (
                        "Selected Works from the Permanent Collection"
                        if scenario["purpose"] == "exhibition" else None
                    ),
                    "loan_start_date": start_date,
                    "loan_end_date": end_date,
                    "insurance_value_total": Decimal(
                        rng.choice([100000, 250000, 600000, 1500000])
                    ),
                    "insurance_currency": "USD",
                    "loan_note": (
                        f"Lent for {scenario['purpose']} "
                        f"({status.replace('_', ' ')})."
                    ),
                },
                admin_user_id,
                open_approval=False,
            )
            loan.request_date = request_date
            loan.approval_date = approval_date
            loan.actual_dispatch_date = dispatch_date
            loan.actual_return_date = end_date if scenario.get("returned") else None
            loan.certificate_of_insurance_received = status != "pending_approval"
            loan.facility_report_received = status != "pending_approval"
            loan.facility_report_approved = status != "pending_approval"
            loan.status = status
            session.flush()
            loans_out_created += 1

            for obj in group:
                link = LoanOutObject(
                    loan_out_id=loan.loan_out_id,
                    organization_id=org_id,
                    object_id=obj.object_id,
                    insurance_value=Decimal(rng.choice([50000, 150000, 400000])),
                    insurance_currency="USD",
                )
                session.add(link)
                loan_out_objects_created += 1
            session.flush()

            # procedure dispatch side-effects (ObjectExit + Movement + exit_id)
            # via the shared service the /dispatch endpoint also uses — so the
            # loan workspace's exit/movement sections aren't empty.
            if dispatch_date is not None:
                dispatch_dt = _as_dt(dispatch_date)
                dispatch_loan_out_effects(
                    session, org_id, loan, admin_user_id, dispatch_dt
                )
                exits_created += len(group)
                movements_created += len(group)

                # Returned loans get the round-trip via the same shared service
                # the /return endpoint uses: outbound movement completed + a
                # return movement to a destination (a registrar picks this in the
                # UI; the seeder uses a storage location). Skip if reference data
                # gave us no internal location to return to.
                if (
                    scenario.get("returned")
                    and loan.actual_return_date
                    and storage is not None
                ):
                    return_loan_out_effects(
                        session, org_id, loan, admin_user_id,
                        _as_dt(loan.actual_return_date), storage.location_id,
                    )
                    movements_created += len(group)

    session.commit()

    logger.info(
        "sandbox seeder: loans seeded for org %s (in=%d/%d, out=%d/%d)",
        org_id,
        loans_in_created, loan_in_objects_created,
        loans_out_created, loan_out_objects_created,
    )
    return {
        "loans_in_created": loans_in_created,
        "loan_in_objects_created": loan_in_objects_created,
        "loans_out_created": loans_out_created,
        "loan_out_objects_created": loan_out_objects_created,
        "object_exits_created": exits_created,
        "loan_movements_created": movements_created,
        "loans_in_existing": existing_in,
        "loans_out_existing": existing_out,
        "skipped_at_target": False,
    }
