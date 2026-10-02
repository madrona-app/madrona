"""Shared create logic for a MediaRights record (Rights management).

Extracted from the ``create_media_rights`` router so the draft applier and the
API route share one implementation. The caller owns the transaction.
"""

from __future__ import annotations

from uuid import UUID

from app.models.media import MediaRights

from ._support import as_date, as_uuid


def create_media_rights(
    session,
    organization_id: UUID,
    payload: dict,
    actor,
    *,
    open_approval: bool = True,
    proposed_by=None,
) -> MediaRights:
    """Create a live MediaRights row for ``payload['media_id']``.

    ``open_approval``/``proposed_by`` are accepted for signature uniformity with
    the other create fns; MediaRights has no approval workflow or separate
    proposer, so ``actor`` is used for created_by. The media FK enforces that
    the medium exists (a bad media_id raises IntegrityError at flush)."""
    p = payload
    rights = MediaRights(
        media_id=as_uuid(p["media_id"]),
        organization_id=organization_id,
        rights_type=p.get("rights_type", "copyright"),
        rights_status=p.get("rights_status"),
        rights_holder=p.get("rights_holder"),
        license_type=p.get("license_type"),
        license_url=p.get("license_url"),
        rights_statement=p.get("rights_statement"),
        start_date=as_date(p.get("start_date")),
        end_date=as_date(p.get("end_date")),
        territory=p.get("territory"),
        usage_restrictions=p.get("usage_restrictions"),
        is_active=True,
        created_by=actor,
    )
    session.add(rights)
    session.flush()
    return rights
