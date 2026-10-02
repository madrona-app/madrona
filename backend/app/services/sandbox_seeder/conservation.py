"""
Conservation seeder — generate ConservationTreatment records over the
seeded objects so the demo org has a plausible treatment history.

Strategy:
    - Pull seeded MET-/SI-/RIJKS- objects.
    - Pull staff constituents tagged "conservator" to use as primary
      conservator_id; fall back to free-text conservator_name if none.
    - Generate ~7 treatments distributed across the lifecycle:
        * 3 completed (with start_date / end_date / actual_cost)
        * 2 in_progress (with start_date but no end_date)
        * 1 approved (about to start)
        * 1 proposed (still in planning)
    - Treatment types weighted toward conservation-realistic mix:
      cleaning > stabilization > restoration > analysis > pest_treatment.
    - Idempotent: skips if any ConservationTreatment exists for the org.
    - Determinism: random.Random keyed on org_id.
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
from app.models.procedures import ConservationTreatment
from app.services.collections.creation.conservation_treatment import (
    create_conservation_treatment,
)

logger = logging.getLogger(__name__)


# Granular intervention "kinds" drive realistic descriptions and proposal
# summaries. Each maps to a canonical procedure treatment_type (the value the
# API/UI validate against — see frontend procedures.ts treatment_type enum and
# the treatment_type lookup vocabulary). The stored treatment_type is always
# one of: preventive | remedial | restoration | analysis | other.
_KIND_WEIGHTS: list[tuple[str, int]] = [
    ("cleaning", 30),
    ("stabilization", 20),
    ("restoration", 15),
    ("analysis", 10),
    ("repair", 10),
    ("rehousing", 8),
    ("pest_treatment", 5),
    ("documentation", 2),
]

_CANONICAL_TYPE: dict[str, str] = {
    "cleaning": "remedial",
    "stabilization": "remedial",
    "restoration": "restoration",
    "analysis": "analysis",
    "repair": "remedial",
    "rehousing": "preventive",
    "pest_treatment": "remedial",
    "documentation": "analysis",
}


_DESCRIPTION_BY_TYPE: dict[str, list[str]] = {
    "cleaning": [
        "Surface dust and accretion removal using soft brushes and HEPA-filtered vacuum.",
        "Aqueous cleaning of soiled surfaces; varnish reduction with controlled solvents.",
    ],
    "stabilization": [
        "Consolidation of flaking paint layer with dilute Paraloid B-72.",
        "Reinforcement of weakened textile substrate using crepeline overlay.",
    ],
    "restoration": [
        "Inpainting of localized loss areas using reversible conservation pigments.",
        "Reintegration of fragmentary missing elements following research into period analogues.",
    ],
    "analysis": [
        "Cross-section microscopy and FTIR analysis to identify original and later materials.",
        "X-radiography and infrared reflectography prior to treatment planning.",
    ],
    "repair": [
        "Mechanical repair of structural damage; backing reinforcement.",
        "Joining of broken element using a reversible adhesive.",
    ],
    "rehousing": [
        "Construction of custom mount and storage box from archival materials.",
        "Mat and frame upgrade to current preservation standards.",
    ],
    "pest_treatment": [
        "Anoxic treatment in sealed chamber to eradicate active insect infestation.",
    ],
    "documentation": [
        "Comprehensive condition documentation with macro photography and condition mapping.",
    ],
}


def _weighted_choice(rng: random.Random, weighted: list[tuple[str, int]]) -> str:
    population = [v for v, _ in weighted]
    weights = [w for _, w in weighted]
    return rng.choices(population, weights=weights, k=1)[0]


def seed_conservation(
    session: Session,
    *,
    org_id: UUID,
    admin_user_id: UUID,
) -> dict[str, Any]:
    """
    Generate ConservationTreatment records for the demo org.

    Idempotent: skips if any ConservationTreatment already exists.
    """
    if org_id is None or admin_user_id is None:
        raise ValueError("seed_conservation requires org_id and admin_user_id")

    existing = (
        session.query(ConservationTreatment)
        .filter_by(organization_id=org_id)
        .count()
    )
    if existing > 0:
        logger.info(
            "sandbox seeder: conservation treatments already present for org %s "
            "(count=%d), skipping",
            org_id, existing,
        )
        return {
            "treatments_created": 0,
            "treatments_existing": existing,
            "skipped_at_target": True,
        }

    rng = random.Random(int(str(org_id).replace("-", "")[:16], 16))

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
            "sandbox seeder: no seeded objects in org %s; skipping conservation",
            org_id,
        )
        return {
            "treatments_created": 0,
            "skipped_no_objects": True,
        }
    rng.shuffle(objects)

    # Staff conservators (from reference seeder).
    staff_conservators: list[Constituent] = (
        session.query(Constituent)
        .filter(
            Constituent.organization_id == org_id,
            Constituent.contact_categories.op("?")("conservator"),
        )
        .all()
    )

    today = date.today()
    treatment_specs: list[dict[str, Any]] = [
        {
            "status": "completed",
            "start_offset": -540,
            "end_offset": -480,
        },
        {
            "status": "completed",
            "start_offset": -300,
            "end_offset": -250,
        },
        {
            "status": "completed",
            "start_offset": -120,
            "end_offset": -90,
        },
        {
            "status": "in_progress",
            "start_offset": -30,
            "end_offset": None,
        },
        {
            "status": "in_progress",
            "start_offset": -7,
            "end_offset": None,
        },
        {
            "status": "approved",
            "start_offset": None,
            "end_offset": None,
        },
        {
            "status": "proposed",
            "start_offset": None,
            "end_offset": None,
        },
    ]

    treatments_created = 0

    for spec_idx, spec in enumerate(treatment_specs):
        if spec_idx >= len(objects):
            break
        obj = objects[spec_idx]
        kind = _weighted_choice(rng, _KIND_WEIGHTS)
        treatment_type = _CANONICAL_TYPE[kind]

        # Anchor proposal_date earlier than start_date so the timeline
        # reads forward.
        if spec["start_offset"] is not None:
            start_date_val = today + timedelta(days=spec["start_offset"])
            proposal_date = start_date_val - timedelta(days=rng.randint(30, 90))
            approval_date = start_date_val - timedelta(days=rng.randint(7, 25))
        else:
            proposal_date = today - timedelta(days=rng.randint(7, 30))
            approval_date = (
                today - timedelta(days=rng.randint(0, 7))
                if spec["status"] == "approved" else None
            )
            start_date_val = None

        end_date_val = (
            today + timedelta(days=spec["end_offset"])
            if spec["end_offset"] is not None else None
        )

        # Conservator: 70% staff, 30% external (free-text).
        conservator_id = None
        conservator_name = None
        conservator_institution = None
        is_external = False
        if staff_conservators and rng.random() < 0.7:
            con = rng.choice(staff_conservators)
            conservator_id = con.constituent_id
            conservator_name = con.name
        else:
            conservator_name = rng.choice([
                "Eleanor Whitcomb",
                "Antoine Mercier",
                "Yuki Sato",
                "Pavel Borisov",
            ])
            conservator_institution = rng.choice([
                "Northeast Document Conservation Center",
                "Studio Mercier (private practice)",
                "Center for Painting Conservation, Brussels",
            ])
            is_external = True

        cost_for_status = {
            "completed": rng.choice([1500, 4500, 12000, 28000]),
            "in_progress": rng.choice([2000, 6000, 15000]),
        }
        actual_cost = (
            Decimal(cost_for_status[spec["status"]])
            if spec["status"] in cost_for_status else None
        )
        estimated_cost = Decimal(rng.choice([1000, 3500, 10000, 25000]))

        description = rng.choice(_DESCRIPTION_BY_TYPE.get(kind, [""]))

        actual_duration_days = None
        if start_date_val and end_date_val:
            actual_duration_days = (end_date_val - start_date_val).days

        # Route through the shared create service so treatment_number comes
        # from next_sequential_number (CONYYYY.NNNN) and created_by/updated_by
        # are set — identical to a user-created treatment. The service creates
        # in status='proposed' with proposal_date=today; we then backdate the
        # proposal and stamp the lifecycle fields (dates, cost, narrative,
        # end-status) it doesn't own so the demo shows a realistic history.
        treatment = create_conservation_treatment(
            session,
            org_id,
            {
                "object_id": obj.object_id,
                "conservator_id": conservator_id,
                "conservator_name": conservator_name,
                "conservator_institution": conservator_institution,
                "treatment_type": treatment_type,
                "proposal_summary": (
                    f"{kind.replace('_', ' ').capitalize()} treatment proposed "
                    "following condition assessment."
                ),
                "estimated_duration_days": rng.choice([14, 30, 60, 120]),
                "estimated_cost": estimated_cost,
                "estimated_cost_currency": "USD",
            },
            admin_user_id,
        )
        treatment.is_external = is_external
        treatment.proposal_date = proposal_date
        treatment.approval_date = approval_date
        treatment.approved_by = admin_user_id if approval_date else None
        treatment.start_date = start_date_val
        treatment.end_date = end_date_val
        treatment.actual_duration_days = actual_duration_days
        treatment.actual_cost = actual_cost
        treatment.actual_cost_currency = "USD" if actual_cost else None
        treatment.treatment_description = description
        treatment.treatment_rationale = (
            "Treatment recommended to address condition issues identified "
            "during routine collection survey."
        )
        treatment.recommendations = (
            "Continue periodic monitoring; revisit in 3-5 years for "
            "follow-up assessment."
            if spec["status"] == "completed" else None
        )
        treatment.status = spec["status"]
        treatments_created += 1

    session.commit()

    logger.info(
        "sandbox seeder: conservation treatments seeded for org %s (count=%d)",
        org_id, treatments_created,
    )
    return {
        "treatments_created": treatments_created,
        "treatments_existing": existing,
        "skipped_at_target": False,
    }
