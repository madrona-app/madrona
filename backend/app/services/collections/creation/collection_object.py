"""Shared create logic for CollectionObject (core cataloging).

Extracted from the inline ``create_collection_object`` router so the draft
applier and the API route share the object-creation core: type coercion, the
CollectionObject row, and the auto-created default (primary) ObjectPart with its
barcode. The caller owns the transaction.

NOT handled here (they stay router-side, being untrusted-input / API concerns):
field-level write restrictions, the link tables
(titles/measurements/inscriptions/other_numbers), and OpenSearch indexing. The
draft payload is a curated scalar subset, so the applier never needs them.
"""

from __future__ import annotations

from uuid import UUID

from app.models import CollectionObject, ObjectPart
from app.services.coerce import coerce_value_for_column


def create_collection_object(
    session,
    organization_id: UUID,
    payload: dict,
    actor,
    *,
    open_approval: bool = True,
    proposed_by=None,
) -> CollectionObject:
    """Create a live CollectionObject + its default part. The caller owns the
    transaction. ``open_approval``/``proposed_by`` are accepted for signature
    uniformity; object creation is not approval-gated and records no separate
    proposer."""
    # Coerce each field to its column type (dates from ISO strings, etc.),
    # ignoring anything that isn't a real column — mirrors the router.
    coerced = {
        k: coerce_value_for_column(CollectionObject, k, v)
        for k, v in payload.items()
        if hasattr(CollectionObject, k)
    }

    obj = CollectionObject(
        organization_id=organization_id,
        created_by=actor,
        updated_by=actor,
        **coerced,
    )
    session.add(obj)
    session.flush()  # need object_id for the part

    # Auto-create the default (single/primary) part with the object's location.
    default_part = ObjectPart(
        organization_id=organization_id,
        object_id=obj.object_id,
        part_number=None,
        name=None,
        current_location_id=obj.current_location_id,
        current_location_fitness=obj.current_location_fitness,
        current_location_note=obj.current_location_note,
        current_location_date=obj.current_location_date,
        home_location_id=obj.home_location_id,
        display_order=0,
        created_by=actor,
        updated_by=actor,
    )
    session.add(default_part)
    session.flush()

    if not default_part.barcode:
        default_part.barcode = str(default_part.part_id).replace("-", "").upper()

    return obj
