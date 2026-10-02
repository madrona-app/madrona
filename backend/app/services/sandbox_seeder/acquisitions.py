"""
Acquisitions seeder — generate realistic Acquisition + AcquisitionObject
records over the seeded objects so the demo org has plausible
ownership/provenance history.

Strategy:
    - Pull all CollectionObject rows seeded by phase 1b (MET-/SI-/RIJKS-).
    - Pull constituents tagged donor / institution to use as `source`.
    - Build ~12 acquisition records covering ~30 of the seeded objects.
      Most acquisitions cover 1-3 objects; a couple cover 5+ to look like
      bequests or single-source institutional transfers.
    - Spread acquisition_date over the past 30 years so the demo shows
      a non-trivial history.
    - Mix methods (gift > purchase > bequest > transfer) and statuses
      (most accessioned/completed; a couple still pending).
    - Idempotent: if any SBX-prefixed acquisition already exists in the
      org, the seeder is a no-op.

Determinism: uses random.Random(seed) keyed on org_id so the same demo
org gets the same acquisitions on re-run, but two demo orgs differ.
"""
from __future__ import annotations

import logging
import random
from datetime import date, timedelta
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.contacts import Constituent
from app.models.objects import CollectionObject
from app.models.procedures import Acquisition, AcquisitionObject
from app.services.collections.creation.acquisition import create_acquisition

logger = logging.getLogger(__name__)


# Acquisition method weights (must reference values in the
# check_acquisition_method_acq CHECK constraint)
_METHOD_WEIGHTS: list[tuple[str, int]] = [
    ("gift", 50),
    ("purchase", 25),
    ("bequest", 15),
    ("transfer", 7),
    ("exchange", 3),
]

# Status mix — most acquisitions in a real museum are completed/accessioned;
# a few are still in flight.
_STATUS_WEIGHTS: list[tuple[str, int]] = [
    ("accessioned", 65),
    ("completed", 20),
    ("approved", 10),
    ("pending_approval", 5),
]

# Acquisition source_type is a DIFFERENT enum from a constituent's
# constituent_type: the frontend validates source_type against
# individual|institution|estate|dealer|other (see procedures.ts), whereas a
# constituent is person|organization|department|... So map, don't copy — a raw
# copy stored person/organization, which the UI rejects with "Invalid input".
_SOURCE_TYPE_BY_CONSTITUENT: dict[str, str] = {
    "person": "individual",
    "organization": "institution",
    "institution": "institution",
    "department": "institution",
    "estate": "estate",
    "dealer": "dealer",
    "auction_house": "dealer",
}

# Acquisition reasons by method — feeds the demo a realistic-sounding
# acquisition_reason field that a curator would actually write.
_REASON_BY_METHOD: dict[str, list[str]] = {
    "gift": [
        "Strengthens the {dept} department's holdings in this period; aligns with the museum's collecting plan.",
        "Donor approached the museum seeking a permanent home for the collection following a long-term loan.",
        "Fills a documented gap in the collection's representation of the artist's mid-career work.",
    ],
    "purchase": [
        "Strategic acquisition to deepen the collection's representation of the period; funded via the {fund}.",
        "Object came to market following a private estate sale; matches active acquisition priorities.",
        "Recommended by the curatorial committee after sustained study; purchased with restricted funds.",
    ],
    "bequest": [
        "Bequeathed under terms of the donor's estate; received with full deed of gift documentation.",
        "Estate transfer following the donor's death; aligns with the donor's lifelong relationship with the museum.",
    ],
    "transfer": [
        "Inter-institutional transfer following deaccession at the lending institution; due-diligence complete.",
    ],
    "exchange": [
        "Object received in exchange for deaccessioned holdings; both parties' boards approved the exchange.",
    ],
}

# Credit-line templates per method. Real museum credit lines vary widely;
# these are representative.
_CREDIT_LINE_TEMPLATES: dict[str, list[str]] = {
    "gift": [
        "Gift of {donor}, {year}",
        "Gift of {donor} in memory of his late wife, {year}",
        "Gift of the {donor}, {year}",
    ],
    "purchase": [
        "Museum purchase, {fund}, {year}",
        "Acquired through the {fund}, {year}",
    ],
    "bequest": [
        "Bequest of {donor}, {year}",
        "Estate of {donor}, {year}",
    ],
    "transfer": [
        "Transfer from {donor}, {year}",
    ],
    "exchange": [
        "Exchange with {donor}, {year}",
    ],
}

_FUNDING_SOURCES = [
    "John & Helen Carmichael Acquisition Fund",
    "Whitfield Foundation Endowment",
    "General Acquisitions Fund",
    "Decorative Arts Purchase Fund",
    "Trustees' Acquisition Fund",
]


def _weighted_choice(rng: random.Random, weighted: list[tuple[str, int]]) -> str:
    population = [v for v, _ in weighted]
    weights = [w for _, w in weighted]
    return rng.choices(population, weights=weights, k=1)[0]


def _accession_number(year: int, sequence: int) -> str:
    """Format a museum *accession* number: YYYY.NNN.

    This is the formal accession identifier (distinct from the system
    ``acquisition_number``, which now comes from ``next_sequential_number``
    via ``create_acquisition``). ``accession_number`` is not uniqueness-
    constrained, so per-run year sequencing is sufficient.
    """
    return f"{year}.{sequence:03d}"


def seed_acquisitions(
    session: Session,
    *,
    org_id: UUID,
    admin_user_id: UUID,
) -> dict[str, Any]:
    """
    Generate Acquisition + AcquisitionObject records for the demo org.

    Idempotent: if any acquisitions already exist for the org, returns
    early with zero counters.

    Returns a counters dict for the saga step.
    """
    if org_id is None or admin_user_id is None:
        raise ValueError("seed_acquisitions requires org_id and admin_user_id")

    # Top-up semantics: target = "every seeded object has an acquisition".
    # Existing acquisitions are kept as-is; we backfill objects that aren't
    # yet attached to one. This matters because the collection-objects
    # seeder is idempotent at the per-object level (it adds newly-bundled
    # SI/Rijks objects to existing orgs), so a richer manifest can leave
    # the old acquisition set stale.
    existing_acq_count = (
        session.query(Acquisition)
        .filter(Acquisition.organization_id == org_id)
        .count()
    )
    existing_obj_ids: set[UUID] = {
        row[0] for row in (
            session.query(AcquisitionObject.object_id)
            .join(
                Acquisition,
                Acquisition.acquisition_id == AcquisitionObject.acquisition_id,
            )
            .filter(Acquisition.organization_id == org_id)
            .all()
        )
    }

    # Deterministic randomness keyed on org_id.
    rng = random.Random(int(str(org_id).replace("-", "")[:16], 16))

    # Pull all phase-1b-seeded objects.
    objects: list[CollectionObject] = (
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
    if not objects:
        logger.warning(
            "sandbox seeder: no seeded objects in org %s; nothing to acquire",
            org_id,
        )
        return {
            "acquisitions_created": 0,
            "acquisition_objects_created": 0,
            "acquisitions_existing": existing_acq_count,
            "skipped_no_objects": True,
        }

    candidates = [obj for obj in objects if obj.object_id not in existing_obj_ids]
    if not candidates:
        logger.info(
            "sandbox seeder: all %d objects already in an acquisition for org %s, "
            "no top-up needed",
            len(objects), org_id,
        )
        return {
            "acquisitions_created": 0,
            "acquisition_objects_created": 0,
            "acquisitions_existing": existing_acq_count,
            "objects_existing": len(existing_obj_ids),
            "skipped_at_target": True,
        }
    objects = candidates  # The grouping logic below operates on uncovered objects only.

    # Pull constituents that look like donors / institutional partners.
    sources: list[Constituent] = (
        session.query(Constituent)
        .filter(
            Constituent.organization_id == org_id,
            or_(
                Constituent.contact_categories.op("?")("donor"),
                Constituent.contact_categories.op("?")("foundation"),
                Constituent.contact_categories.op("?")("institution"),
            ),
        )
        .all()
    )
    # Don't error if there are no sources — some methods (purchase, found)
    # don't require one. But the demo is duller without them.
    if not sources:
        logger.warning(
            "sandbox seeder: no donor/institution constituents in org %s",
            org_id,
        )

    # Aim: every uncovered object gets an acquisition. With the typical
    # 1-3 group size, ~153 objects produces ~60-70 acquisitions, which
    # makes the demo feel like a real collection rather than a toy one.
    rng.shuffle(objects)
    selected = objects

    # Group sizes — most are 1-3 objects, a couple are larger.
    groups: list[list[CollectionObject]] = []
    i = 0
    while i < len(selected):
        # Most groups are small; ~15% are 4-6 objects.
        if rng.random() < 0.15:
            size = rng.randint(4, 6)
        else:
            size = rng.randint(1, 3)
        groups.append(selected[i : i + size])
        i += size

    today = date.today()
    acq_count = 0
    acq_obj_count = 0
    # Per-accession-year counter for the museum-style accession_number
    # (acquisition_number itself is issued by next_sequential_number inside
    # create_acquisition). accession_number isn't unique, so a per-run map
    # is fine.
    year_seq: dict[int, int] = {}

    for group in groups:
        method = _weighted_choice(rng, _METHOD_WEIGHTS)
        status = _weighted_choice(rng, _STATUS_WEIGHTS)

        # Acquisition date: 30 years back, weighted toward the recent
        # half so the demo "feels current."
        years_back = int(rng.triangular(0, 30, 6))
        days_back = rng.randint(0, 364)
        acq_date = today - timedelta(days=years_back * 365 + days_back)
        year = acq_date.year

        # Source is required for gift/bequest/transfer; optional otherwise.
        source = None
        if sources and method in {"gift", "bequest", "transfer", "exchange"}:
            source = rng.choice(sources)

        # Cost only meaningful for purchases; appraised value can show on
        # gifts (donor's appraisal for tax purposes).
        cost = None
        appraised_value = None
        funding_source = None
        if method == "purchase":
            cost = Decimal(rng.choice([2500, 7500, 15000, 35000, 75000, 250000]))
            funding_source = rng.choice(_FUNDING_SOURCES)
        elif method == "gift":
            appraised_value = Decimal(rng.choice([5000, 12000, 25000, 60000, 150000]))

        reason_template = rng.choice(_REASON_BY_METHOD.get(method, [""]))
        reason = reason_template.format(
            dept=rng.choice(["Curatorial", "Decorative Arts", "Asian Art", "European Painting"]),
            fund=funding_source or rng.choice(_FUNDING_SOURCES),
        )

        credit_template = rng.choice(_CREDIT_LINE_TEMPLATES.get(method, ["{donor}, {year}"]))
        credit_line = credit_template.format(
            donor=(source.name if source else "anonymous donor"),
            fund=funding_source or rng.choice(_FUNDING_SOURCES),
            year=year,
        )

        accession_number = None
        accession_date_val = None
        completed_date = None
        if status in {"accessioned", "completed"}:
            # Accessioning typically follows acquisition by 30-180 days.
            accession_date_val = acq_date + timedelta(days=rng.randint(30, 180))
            seq = year_seq.get(year, 0) + 1
            year_seq[year] = seq
            accession_number = _accession_number(year, seq)
            completed_date = accession_date_val

        # Route through the shared create service so the row is identical to a
        # user-created acquisition: acquisition_number from next_sequential_number
        # (ACQYYYY.NNNN), created_by/updated_by set. open_approval=False forces
        # status='proposed' with NO ApprovalRequest — seeded acquisitions are
        # already-decided history, so we then stamp the demo end-status and the
        # accession/appraisal fields the service doesn't own.
        acq = create_acquisition(
            session,
            org_id,
            {
                "acquisition_method": method,
                "acquisition_date": acq_date,
                "source_id": source.constituent_id if source else None,
                "source_name": source.name if source else None,
                "source_type": (
                    _SOURCE_TYPE_BY_CONSTITUENT.get(source.constituent_type, "other")
                    if source else None
                ),
                "cost": cost,
                "cost_currency": "USD" if cost else None,
                "funding_source": funding_source,
                "legal_status": "clear",
                "credit_line": credit_line,
                "objects_count": len(group),
            },
            admin_user_id,
            open_approval=False,
        )
        acq.status = status
        acq.acquisition_reason = reason
        acq.provenance_verified = status in {"accessioned", "completed"}
        acq.appraised_value = appraised_value
        acq.appraised_value_currency = "USD" if appraised_value else None
        acq.accession_number = accession_number
        acq.accession_date = accession_date_val
        acq.accessioning_approved = status in {"accessioned", "completed"}
        acq.completed_date = completed_date
        session.flush()

        for obj in group:
            link = AcquisitionObject(
                acquisition_id=acq.acquisition_id,
                object_id=obj.object_id,
                organization_id=org_id,
                created_by=admin_user_id,
            )
            session.add(link)
            acq_obj_count += 1

        acq_count += 1

    session.commit()

    logger.info(
        "sandbox seeder: acquisitions seeded for org %s (acquisitions=%d, links=%d)",
        org_id, acq_count, acq_obj_count,
    )
    return {
        "acquisitions_created": acq_count,
        "acquisition_objects_created": acq_obj_count,
        "acquisitions_existing": existing_acq_count,
        "objects_existing": len(existing_obj_ids),
        "skipped_at_target": False,
    }
