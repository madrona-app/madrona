"""
Asset-level download access control.

Determines whether a user can download an asset directly, must submit a
download request, or is blocked entirely.  The decision combines the
asset's rights status (from MediaRights records) with the user's
permissions.

Three access levels:
    direct  — user can download immediately
    request — user must go through the download request workflow
    blocked — download unavailable (expired rights, etc.)
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Literal
from uuid import UUID

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Rights statuses that qualify for open access (direct download)
OPEN_ACCESS_STATUSES = frozenset({
    "public_domain",
    "cc0",
})

# License types that qualify for open access
OPEN_ACCESS_LICENSES = frozenset({
    "CC0",
    "CC-BY",
    "CC-BY-SA",
    "CC-BY-NC",
    "CC-BY-NC-SA",
    "PDM",  # Public Domain Mark
})

DownloadAccess = Literal["direct", "request", "blocked"]


def compute_download_access(
    media_id: UUID | str,
    organization_id: UUID | str,
    user_permissions: list[str],
    db: Session,
) -> DownloadAccess:
    """
    Compute whether a user can download this asset directly.

    Logic:
        1. Admin bypass — media.admin always gets direct access
        2. No active rights → request (conservative default)
        3. Any expired rights → blocked
        4. Active restrictions → request
        5. Open-access grant (public domain, CC, etc.) → direct
        6. Otherwise → request
    """
    # 1. Admin bypass
    if "media.admin" in user_permissions or "platform.admin" in user_permissions:
        return "direct"

    from app.models.media import MediaRights

    # Query active rights for this asset
    rights = (
        db.query(MediaRights)
        .filter(
            MediaRights.media_id == str(media_id),
            MediaRights.is_active.is_(True),
        )
        .all()
    )

    # 2. No rights records → conservative default
    if not rights:
        return "request"

    today = date.today()

    # 3. Check for expired rights
    has_expired = any(
        r.end_date and r.end_date < today
        for r in rights
    )
    if has_expired:
        return "blocked"

    # 4. Check for active restrictions
    has_restrictions = any(
        r.rights_type == "restriction"
        or (r.usage_restrictions and len(r.usage_restrictions) > 0)
        for r in rights
    )
    if has_restrictions:
        return "request"

    # 5. Check for open-access grant
    has_open_access = any(
        r.rights_status in OPEN_ACCESS_STATUSES
        or (r.license_type and r.license_type.upper() in {lt.upper() for lt in OPEN_ACCESS_LICENSES})
        or (r.rights_type == "permission" and r.rights_status == "granted")
        for r in rights
    )
    if has_open_access:
        return "direct"

    # 6. Default — rights exist but don't qualify for open access
    return "request"
