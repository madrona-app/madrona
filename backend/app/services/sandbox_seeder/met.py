"""
Met Museum collections seeder for sandbox orgs.

Wraps the long-existing CLI script at backend/scripts/seed_met_museum.py
so the saga can call it as a function. The script's seed_met_objects()
already does:
    - idempotency by (org_id, "MET-{met_id}")
    - rate-limiting (200ms between Met API calls)
    - S3 upload via app.services.uploads.upload_org_media
    - Media row creation linked to CollectionObject
    - Celery dispatch of process_upload_task for derivatives

Re-using it (vs duplicating) means improvements to the script flow
through to sandbox seeding for free.
"""
from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def seed_met_collections(
    session: Session,
    *,
    org_id: UUID,
    admin_user_id: UUID,
    skip_images: bool = False,
) -> dict[str, Any]:
    """
    Seed ~75 Met Museum CC0 objects into the demo org.

    Args:
        session: SQLAlchemy session (caller commits).
        org_id: UUID of the demo organization.
        admin_user_id: UUID for created_by/updated_by audit fields.
        skip_images: If True, only create CollectionObject rows; skip
            S3 uploads and Media linking. Useful for fast smoke tests.

    Returns:
        Dict with object/image counters from seed_met_objects().
    """
    if org_id is None or admin_user_id is None:
        raise ValueError(
            "seed_met_collections requires both org_id and admin_user_id"
        )

    # Imported lazily because the script imports app modules that depend
    # on settings (Cognito, S3) which we don't want to touch on cold
    # startup of unrelated callers (e.g. unit tests of the saga step
    # iteration logic).
    #
    # `scripts` is a sibling of `app` under `backend/`. The dev shell
    # runs Python with cwd=backend, so `scripts` is implicitly on
    # sys.path. The Celery worker on staging runs with a different cwd,
    # which breaks the import with `No module named 'scripts'`. Insert
    # the backend root onto sys.path defensively before importing.
    import sys
    from pathlib import Path
    _backend_root = str(Path(__file__).resolve().parents[3])
    if _backend_root not in sys.path:
        sys.path.insert(0, _backend_root)
    from scripts.seed_met_museum import seed_met_objects, MET_OBJECTS

    # Pre-count what's already present so we can report a meaningful
    # delta after the run. The underlying seeder prints its own counters
    # to stdout but doesn't return structured data, so we wrap it.
    from app.models import CollectionObject

    before = (
        session.query(CollectionObject)
        .filter(
            CollectionObject.organization_id == org_id,
            CollectionObject.object_number.like("MET-%"),
        )
        .count()
    )

    seed_met_objects(
        org_id=org_id,
        user_id=admin_user_id,
        dry_run=False,
        skip_images=skip_images,
        session=session,
    )

    after = (
        session.query(CollectionObject)
        .filter(
            CollectionObject.organization_id == org_id,
            CollectionObject.object_number.like("MET-%"),
        )
        .count()
    )

    added = after - before
    # Loud failure when the seeder produced nothing on a fresh org.
    # The script's per-object loop swallows TypeErrors and prints them
    # to stdout, so a model-shape regression (titles=, classifications=,
    # etc.) can leave the saga claiming success on an empty demo. Force
    # the saga step to fail so the timeline shows the problem instead
    # of silently rendering an empty Collections page.
    if before == 0 and added == 0:
        raise RuntimeError(
            "Met seeder added 0 objects on a fresh org. Likely a model-"
            "shape regression in scripts/seed_met_museum.py — check the "
            "celery worker logs for per-object 'Failed to create MET-<id>' "
            "warnings."
        )

    return {
        "source": "met",
        "objects_seeded_total": after,
        "objects_added_this_run": added,
        "objects_in_curated_list": len(MET_OBJECTS),
        "skipped_images": skip_images,
    }
