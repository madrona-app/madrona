"""Shared logic for the sensitive-content metadata review of a media item.

Applying marks ``Media.metadata_reviewed`` and stamps who/when — the review
sign-off that publishing requires. Extracted from the ``review_metadata`` router
so the draft applier and the API route share one implementation.
"""

from __future__ import annotations

from uuid import UUID

from app.models import Media

from ._support import get_media, utcnow


def apply_media_review(
    session,
    organization_id: UUID,
    payload: dict,
    actor,
    *,
    open_approval: bool = True,
    proposed_by=None,
) -> Media:
    """Mark ``payload['media_id']`` reviewed for sensitive content. Caller owns
    the transaction. Raises MediaNotFound if the medium isn't in the org."""
    media = get_media(session, organization_id, payload["media_id"])
    media.metadata_reviewed = True
    media.metadata_reviewed_at = utcnow()
    media.metadata_reviewed_by = actor
    if payload.get("notes") is not None:
        media.metadata_review_notes = payload["notes"]
    session.flush()
    return media
