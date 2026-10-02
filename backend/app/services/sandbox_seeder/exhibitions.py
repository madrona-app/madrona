"""
Exhibitions seeder — generate Venue, Exhibition, and ExhibitionObject
records over the seeded objects so the demo org has a plausible
exhibition history (one currently open, one archived, one upcoming).

Strategy:
    - Ensure a single Venue ("Main Building") exists for the org. The
      Venue is required for Exhibitions to render against; it's separate
      from collections.locations (which models physical storage).
    - Create 3 exhibitions:
        * "Light & Shadow" — currently open (status=open, dates around now)
        * "Threads of Asia" — archived (status=archived, dates ~2y ago)
        * "Modern Encounters" — in preparation (status=in_preparation,
          future dates)
    - Each exhibition uses 5-8 of the seeded objects, distributed by
      object_status across planned/confirmed/on_display/returned to
      mirror the lifecycle.

Constraints handled:
    - Exhibition.exhibition_number has a *global* unique constraint, so
      we suffix with the first 8 chars of the org_id to avoid cross-org
      collisions.
    - Exhibition.public_url_slug is also globally unique; left NULL
      (is_public defaults to false anyway).
    - ExhibitionObject requires either object_id OR entity_key — we
      always set object_id since seeded objects live in the org's own
      collection.

Idempotent: skips if any Exhibition already exists for the org.
Determinism: random.Random keyed on org_id.
"""
from __future__ import annotations

import logging
import random
from datetime import date, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.exhibit import (
    Exhibition,
    ExhibitionObject,
    ExhibitionStatusHistory,
    Venue,
)
from app.models.objects import CollectionObject

logger = logging.getLogger(__name__)


def _ensure_venue(session: Session, org_id: UUID, admin_user_id: UUID) -> Venue:
    """Return the demo venue, creating it if absent."""
    existing = (
        session.query(Venue)
        .filter(Venue.organization_id == org_id, Venue.name == "Main Building")
        .first()
    )
    if existing:
        return existing

    venue = Venue(
        organization_id=org_id,
        name="Main Building",
        description="Primary public-facing venue for exhibitions.",
        created_by=admin_user_id,
    )
    session.add(venue)
    session.flush()
    return venue


def seed_exhibitions(
    session: Session,
    *,
    org_id: UUID,
    admin_user_id: UUID,
) -> dict[str, Any]:
    """
    Generate Venue + Exhibition + ExhibitionObject records for the demo org.

    Idempotent: skips if any Exhibition already exists.
    """
    if org_id is None or admin_user_id is None:
        raise ValueError("seed_exhibitions requires org_id and admin_user_id")

    existing = (
        session.query(Exhibition).filter_by(organization_id=org_id).count()
    )
    if existing > 0:
        logger.info(
            "sandbox seeder: exhibitions already present for org %s (count=%d), skipping",
            org_id, existing,
        )
        return {
            "venues_created": 0,
            "exhibitions_created": 0,
            "exhibition_objects_created": 0,
            "exhibitions_existing": existing,
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
            "sandbox seeder: no seeded objects in org %s; skipping exhibitions",
            org_id,
        )
        return {
            "venues_created": 0,
            "exhibitions_created": 0,
            "exhibition_objects_created": 0,
            "skipped_no_objects": True,
        }

    rng.shuffle(objects)

    # Track venue-creation count separately so the counter dict is honest.
    pre_venue_count = (
        session.query(Venue).filter_by(organization_id=org_id).count()
    )
    venue = _ensure_venue(session, org_id, admin_user_id)
    venues_created = (
        session.query(Venue).filter_by(organization_id=org_id).count()
    ) - pre_venue_count

    today = date.today()
    org_short = str(org_id).replace("-", "")[:8]

    exhibition_specs: list[dict[str, Any]] = [
        {
            "title": "Light & Shadow: European Painting 1700-1900",
            "subtitle": "From the Permanent Collection",
            "description": (
                "An intimate look at the long history of European painters' "
                "engagement with chiaroscuro, from Baroque drama through "
                "Impressionist atmosphere."
            ),
            "exhibition_type": "temporary",
            "status": "open",
            "planned_start_offset": -45,
            "planned_end_offset": 90,
            "actual_start_offset": -45,
            "n_objects": 8,
            "object_status_mix": [("on_display", 1.0)],
        },
        {
            "title": "Threads of Asia: Textiles, Lacquer, and Print",
            "subtitle": "A Survey of East Asian Decorative Arts",
            "description": (
                "Drawn from the museum's deep holdings in Japanese and "
                "Chinese decorative arts, this exhibition traced material "
                "exchange and craft technique across a millennium."
            ),
            "exhibition_type": "temporary",
            "status": "archived",
            "planned_start_offset": -730,
            "planned_end_offset": -540,
            "actual_start_offset": -730,
            "actual_end_offset": -540,
            "n_objects": 6,
            "object_status_mix": [("returned", 1.0)],
        },
        {
            "title": "Modern Encounters",
            "subtitle": "Late 20th-Century Acquisitions",
            "description": (
                "A focused presentation of recent acquisitions in late "
                "20th-century art, exploring how the museum's collecting "
                "strategy has evolved since the 1980s."
            ),
            "exhibition_type": "temporary",
            "status": "in_preparation",
            "planned_start_offset": 60,
            "planned_end_offset": 240,
            "n_objects": 5,
            "object_status_mix": [("planned", 0.7), ("confirmed", 0.3)],
        },
    ]

    exhibitions_created = 0
    exhibition_objects_created = 0
    obj_pos = 0

    for idx, spec in enumerate(exhibition_specs):
        n = min(spec["n_objects"], len(objects) - obj_pos)
        if n <= 0:
            break
        group = objects[obj_pos : obj_pos + n]
        obj_pos += n

        planned_start = today + timedelta(days=spec["planned_start_offset"])
        planned_end = today + timedelta(days=spec["planned_end_offset"])
        year = planned_start.year
        number = f"EXH-{year}.{idx + 1:03d}-{org_short}"

        actual_start = (
            today + timedelta(days=spec["actual_start_offset"])
            if "actual_start_offset" in spec else None
        )
        actual_end = (
            today + timedelta(days=spec["actual_end_offset"])
            if "actual_end_offset" in spec else None
        )

        exhibition = Exhibition(
            organization_id=org_id,
            venue_id=venue.venue_id,
            exhibition_number=number,
            title=spec["title"],
            subtitle=spec["subtitle"],
            description=spec["description"],
            exhibition_type=spec["exhibition_type"],
            status=spec["status"],
            planned_start_date=planned_start,
            planned_end_date=planned_end,
            actual_start_date=actual_start,
            actual_end_date=actual_end,
            authorization_date=planned_start - timedelta(days=120),
            organizer_id=admin_user_id,
            authorizer_id=admin_user_id,
            created_by=admin_user_id,
        )
        session.add(exhibition)
        session.flush()
        exhibitions_created += 1

        # Mirror the create router's side-effect: every exhibition opens with a
        # status-history "created" row so the lifecycle timeline isn't empty
        # (Use status-date audit trail). Without this the demo's
        # exhibition history panel renders blank.
        session.add(ExhibitionStatusHistory(
            exhibition_id=exhibition.exhibition_id,
            status=spec["status"],
            changed_by=admin_user_id,
            notes="Exhibition created",
        ))

        # Distribute ExhibitionObject statuses per spec.
        statuses = spec["object_status_mix"]
        status_pool: list[str] = []
        for status_value, weight in statuses:
            status_pool.extend([status_value] * max(1, int(weight * len(group))))
        # Pad/truncate to len(group)
        while len(status_pool) < len(group):
            status_pool.append(statuses[0][0])
        rng.shuffle(status_pool)

        for display_order, obj in enumerate(group):
            link = ExhibitionObject(
                exhibition_id=exhibition.exhibition_id,
                organization_id=org_id,
                object_id=obj.object_id,
                display_order=display_order,
                object_status=status_pool[display_order],
                confirmed_date=(
                    planned_start - timedelta(days=rng.randint(30, 90))
                    if status_pool[display_order] != "planned"
                    else None
                ),
                created_by=admin_user_id,
            )
            session.add(link)
            exhibition_objects_created += 1

    session.commit()

    logger.info(
        "sandbox seeder: exhibitions seeded for org %s (venues=%d, exhibitions=%d, links=%d)",
        org_id, venues_created, exhibitions_created, exhibition_objects_created,
    )
    return {
        "venues_created": venues_created,
        "exhibitions_created": exhibitions_created,
        "exhibition_objects_created": exhibition_objects_created,
        # One "created" status-history row per exhibition (lifecycle audit trail).
        "status_history_created": exhibitions_created,
        "exhibitions_existing": existing,
        "skipped_at_target": False,
    }
