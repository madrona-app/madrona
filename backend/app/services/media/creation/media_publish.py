"""Shared logic for publishing a media item — with HARD rights/review gates.

Unlike the legacy publish endpoint (which only appended warnings), this refuses
to publish unless the procedure-derived preconditions are met: active rights on
file AND a completed sensitive-content review (and, when the item depicts
identifiable people, valid consent). Used by both the draft applier (the
orchestrated publish-clearance flow) and the rewired publish endpoint.
"""

from __future__ import annotations

from uuid import UUID

from app.models import Media
from app.models.media import MediaConsent, MediaRights

from ._support import MediaPublishBlocked, get_media, utcnow


def apply_media_publish(
    session,
    organization_id: UUID,
    payload: dict,
    actor,
    *,
    open_approval: bool = True,
    proposed_by=None,
) -> Media:
    """Publish ``payload['media_id']`` after enforcing the publish gates.

    Raises MediaPublishBlocked (failing the draft / returning an error to the
    endpoint) if a precondition is unmet. Caller owns the transaction."""
    p = payload
    media = get_media(session, organization_id, p["media_id"])

    if media.is_published:
        raise MediaPublishBlocked("media is already published")

    # Rights are "documented" by either the descriptive copyright_status field
    # OR a detailed active MediaRights record — the UI gate mirrors this (it
    # gates on copyright_status), and the orchestrated flow records a MediaRights.
    has_rights = media.copyright_status is not None or (
        session.query(MediaRights.rights_id)
        .filter(
            MediaRights.media_id == media.media_id,
            MediaRights.is_active.is_(True),
        )
        .first()
        is not None
    )
    if not has_rights:
        raise MediaPublishBlocked(
            "cannot publish: no rights documented (set the copyright status "
            "or add a rights record)"
        )
    if not media.metadata_reviewed:
        raise MediaPublishBlocked(
            "cannot publish: metadata has not been reviewed for sensitive content"
        )
    if p.get("require_consent"):
        has_valid_consent = (
            session.query(MediaConsent.consent_id)
            .filter(
                MediaConsent.media_id == media.media_id,
                MediaConsent.is_valid.is_(True),
            )
            .first()
            is not None
        )
        if not has_valid_consent:
            raise MediaPublishBlocked(
                "cannot publish: media depicts people but has no valid consent on file"
            )

    media.is_published = True
    media.published_at = utcnow()
    media.published_by = actor
    if p.get("published_url") is not None:
        media.published_url = p["published_url"]
    if p.get("rights_statement") is not None:
        media.rights_statement = p["rights_statement"]
    session.flush()
    return media
