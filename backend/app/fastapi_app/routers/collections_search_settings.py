"""
Organization search settings (Collections configuration > General).

GET/PUT /api/organizations/{organization_id}/collections/settings/deaccessioned-search
switches Organization.hide_deaccessioned_in_search (see
services/deaccession_visibility.py). Reading needs collections.view (the
object search page shows the current setting); changing it needs
org.manage_settings.
"""

from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, StrictBool
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.models import Organization
from app.permissions import Permission
from app.services.public_cache import invalidate_org_cache_by_id

logger = logging.getLogger(__name__)

router = APIRouter(tags=["collections-search-settings"])

_PATH = "/api/organizations/{organization_id}/collections/settings/deaccessioned-search"


class DeaccessionedSearchBody(BaseModel):
    hide_deaccessioned: StrictBool


def _org(db: Session, organization_id: UUID) -> Organization:
    org = db.query(Organization).filter(Organization.organization_id == organization_id).first()
    if not org:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Organization not found"})
    return org


@router.get(_PATH, summary="Get whether deaccessioned records are hidden from search")
def get_deaccessioned_search(
    organization_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW, Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    return {"hide_deaccessioned": bool(_org(db, organization_id).hide_deaccessioned_in_search)}


@router.put(_PATH, summary="Hide or show deaccessioned records in search")
def update_deaccessioned_search(
    organization_id: UUID,
    body: DeaccessionedSearchBody,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    org = _org(db, organization_id)
    org.hide_deaccessioned_in_search = body.hide_deaccessioned
    db.commit()
    # The public portal caches record pages and lists.
    invalidate_org_cache_by_id(str(organization_id))
    logger.info(
        "hide_deaccessioned_in_search=%s for org %s by user %s",
        body.hide_deaccessioned, organization_id, auth.user_id,
    )
    return {"hide_deaccessioned": body.hide_deaccessioned}
