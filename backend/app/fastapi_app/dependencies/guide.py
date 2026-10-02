"""
Guide application dependency — checks that an organization has Guide enabled.

Also determines whether this is a platform org (has collections) or a
standalone Guide org, which affects persona selection.

Usage:
    @router.get("/api/guide/...")
    def endpoint(
        guide_ctx: GuideContext = Depends(require_guide_app),
    ):
        ...
"""

import logging
from dataclasses import dataclass
from uuid import UUID

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_auth, require_permission
from app.models.core import Application, OrganizationApplication
from app.permissions import Permission

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class GuideContext:
    """Context from a validated Guide app check."""
    auth: AuthContext
    organization_id: UUID
    config: dict | None  # OrganizationApplication.config (tier limits, etc.)
    is_platform: bool  # True if org also has collections (full platform customer)


async def require_guide_app(
    auth: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
) -> GuideContext:
    """
    Dependency that verifies the user's active organization has the Guide app enabled.

    Also checks if the org has the collections app to determine platform vs standalone.
    Raises 403 if the org doesn't have Guide or it's disabled.
    """
    if not auth.active_organization_id:
        raise HTTPException(
            status_code=403,
            detail={"code": "no_organization", "message": "No active organization"},
        )

    org_id = auth.active_organization_id

    # Check Guide is enabled
    row = db.execute(
        select(OrganizationApplication.enabled, OrganizationApplication.config)
        .join(Application, OrganizationApplication.application_id == Application.application_id)
        .where(
            Application.key == "guide",
            OrganizationApplication.organization_id == org_id,
        )
    ).first()

    if not row or not row.enabled:
        raise HTTPException(
            status_code=403,
            detail={"code": "guide_not_enabled", "message": "Guide is not enabled for this organization"},
        )

    # Check if org also has collections (platform customer vs standalone)
    collections_row = db.execute(
        select(OrganizationApplication.enabled)
        .join(Application, OrganizationApplication.application_id == Application.application_id)
        .where(
            Application.key == "collections",
            OrganizationApplication.organization_id == org_id,
        )
    ).first()

    is_platform = bool(collections_row and collections_row.enabled)

    return GuideContext(
        auth=auth,
        organization_id=org_id,
        config=row.config,
        is_platform=is_platform,
    )


async def require_guide_admin(
    guide_ctx: GuideContext = Depends(require_guide_app),
    _auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
) -> GuideContext:
    """
    Guide app enabled AND the caller is an org admin (org.manage_settings).

    Gates building the org's shared Corpus (and its insights/widget config):
    uploading documents to the knowledge base that feeds the staff assistant
    and the public widget is an admin task, not something every Guide user can
    do. Per-user/personal document upload is a separate, ungated path.
    """
    return guide_ctx
