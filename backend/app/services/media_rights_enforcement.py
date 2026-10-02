"""Media-rights download enforcement — per-org toggle.

When the toggle is OFF (default), the /media/{id}/download endpoint serves
any media the caller can MEDIA_VIEW, no further checks. This matches the
pre-2026-05 behavior and avoids breaking downloads on orgs that haven't
populated MediaRights data yet.

When the toggle is ON, downloads are gated by:
  * MEDIA_VIEW_UNPUBLISHED for unpublished media
  * MEDIA_DOWNLOAD_DERIVATIVES for derivative downloads
  * compute_download_access (rights-based) for originals

Orgs flip the toggle once their rights data is in place. Endpoint pair lives
under /api/organizations/{org_id}/media-rights-enforcement (GET + PUT) and
mirrors the procedure enforcement pattern.
"""
from __future__ import annotations

from uuid import UUID

from sqlalchemy.orm import Session

from app.models.core_org import Organization


def is_rights_enforcement_enabled(
    organization_id: UUID | str,
    db: Session,
) -> bool:
    """Return True if this org has opted into media-rights enforcement."""
    org = db.query(Organization).filter(
        Organization.organization_id == organization_id,
    ).first()
    if not org:
        return False
    return bool(getattr(org, "media_rights_enforcement", False))
