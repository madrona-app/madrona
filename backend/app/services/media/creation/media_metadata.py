"""Batch apply function for media descriptive metadata (§1C).

Applies a partial descriptive-metadata change to ONE medium. The factory's
batch applier calls this per target id in the draft's ``target_entity_ids``,
inside the draft's savepoint — so any target raising rolls the whole batch back.
The caller owns the transaction.

Only the safe descriptive fields are touched; rights/consent/publishing fields
are intentionally out of scope (workflow semantics).
"""

from __future__ import annotations

from uuid import UUID

from app.models import Media

_FIELDS = ("title", "description", "alt_text", "credit", "creator", "source")


def _as_uuid(value) -> UUID:
    return value if isinstance(value, UUID) else UUID(str(value))


def apply_media_metadata(
    session,
    organization_id: UUID,
    target_id,
    payload: dict,
    actor,
) -> Media:
    """Apply the descriptive-metadata change in ``payload`` to one medium.

    Only fields PRESENT in ``payload`` are written (the draft stored a partial
    update via exclude_unset), so unprovided fields are left untouched. Raises
    ValueError if the target medium isn't found in the org — which fails (and
    rolls back) the whole batch."""
    media = (
        session.query(Media)
        .filter(
            Media.media_id == _as_uuid(target_id),
            Media.organization_id == organization_id,
        )
        .first()
    )
    if media is None:
        raise ValueError(f"media {target_id} not found")

    for field in _FIELDS:
        if field in payload:
            setattr(media, field, payload[field])
    media.updated_by = actor
    session.flush()
    return media
