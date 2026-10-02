"""Organization collection scope profile API (issue #77).

One profile per organization describing collection scope, coverage,
completeness, known gaps, and digitization status. Surfaced to the Guide so it
discloses coverage/limitations instead of presenting partial holdings as
comprehensive (see app/services/collection_scope.py).
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.fastapi_app.schemas.collection_profile import (
    CollectionProfileOut,
    CollectionProfileUpdate,
)
from app.models import Organization, OrganizationCollectionProfile
from app.permissions import Permission

logger = logging.getLogger(__name__)

router = APIRouter(tags=["collection-profile"])

_FIELDS = (
    "scope_note",
    "coverage",
    "completeness",
    "extent_note",
    "known_gaps",
    "digitization_status",
)


def _serialize(org_id: UUID, profile: OrganizationCollectionProfile | None) -> dict:
    if profile is None:
        return {"organization_id": str(org_id)}
    return {
        "organization_id": str(profile.organization_id),
        "scope_note": profile.scope_note,
        "coverage": profile.coverage,
        "completeness": profile.completeness,
        "extent_note": profile.extent_note,
        "known_gaps": profile.known_gaps,
        "digitization_status": profile.digitization_status,
    }


@router.get(
    "/api/organizations/{org_id}/collection-profile",
    response_model=CollectionProfileOut,
    summary="Get collection scope profile",
)
def get_collection_profile(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    """Return the org's collection scope profile (empty shell if none set)."""
    profile = (
        db.query(OrganizationCollectionProfile)
        .filter_by(organization_id=org_id)
        .first()
    )
    return _serialize(org_id, profile)


@router.put(
    "/api/organizations/{org_id}/collection-profile",
    response_model=CollectionProfileOut,
    summary="Update collection scope profile",
)
def update_collection_profile(
    org_id: UUID,
    body: CollectionProfileUpdate,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    """Create or update the org's collection scope profile."""
    org = db.query(Organization).filter_by(organization_id=org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Organization not found"})

    profile = (
        db.query(OrganizationCollectionProfile)
        .filter_by(organization_id=org_id)
        .first()
    )
    if profile is None:
        profile = OrganizationCollectionProfile(organization_id=org_id)
        db.add(profile)

    for field in _FIELDS:
        setattr(profile, field, getattr(body, field))
    profile.updated_by = auth.user_id

    db.commit()
    db.refresh(profile)
    return _serialize(org_id, profile)
