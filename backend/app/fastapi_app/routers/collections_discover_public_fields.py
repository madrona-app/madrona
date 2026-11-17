"""
Staff choice of which standard object fields are public
(Collections configuration > Public Fields).

GET returns the field catalog grouped for the settings page, which fields
are public now, the defaults, the fields that can never be published, and
the user-defined additional fields with their own public flag (managed on
the Additional Fields page). PUT replaces the public set.

Ordinary authenticated staff routes: RLS-scoped ``get_db`` session,
organization taken from the path and checked by ``require_permission``.
Viewing needs ``data.view``; changing needs ``discover.publish`` or
``org.manage_settings`` (the same as the other Discover settings).
"""

from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.models import DiscoverConfig
from app.permissions import Permission
from app.services import public_object_fields as pof
from app.services.public_cache import invalidate_org_cache_by_id

logger = logging.getLogger(__name__)

router = APIRouter(tags=["discover-public-fields"])

_VIEW = require_permission(
    Permission.DATA_VIEW, Permission.DISCOVER_PUBLISH, Permission.ORG_MANAGE_SETTINGS,
)
_MANAGE = require_permission(Permission.DISCOVER_PUBLISH, Permission.ORG_MANAGE_SETTINGS)
_PATH = "/api/organizations/{organization_id}/collections/discover/public-fields"


class PublicFieldsBody(BaseModel):
    public_fields: list[Any]


def _settings_payload(db: Session, organization_id: UUID, stored: Any) -> dict:
    from app.services.custom_fields import definitions

    keys = pof.resolve_stored(stored)
    return {
        "groups": [{"key": k, "label": label} for k, label in pof.FIELD_GROUPS],
        "fields": pof.catalog_payload(keys),
        "public_fields": [f.key for f in pof.FIELD_CATALOG if f.key in keys],
        "default_fields": [f.key for f in pof.FIELD_CATALOG if f.default],
        "is_default": stored is None,
        "never_public": [
            {"key": k, "label": label, "reason": reason}
            for k, (label, reason) in pof.NEVER_PUBLIC.items()
        ],
        "additional_fields": [
            {"key": d.key, "label": d.label, "is_public": bool(d.is_public)}
            for d in definitions(db, organization_id)
        ],
    }


def _stored(db: Session, organization_id: UUID):
    return (
        db.query(DiscoverConfig.public_object_fields)
        .filter(DiscoverConfig.organization_id == organization_id)
        .scalar()
    )


@router.get(_PATH, summary="Get the public object field settings")
def get_public_fields(
    organization_id: UUID,
    auth: AuthContext = Depends(_VIEW),
    db: Session = Depends(get_db),
):
    return _settings_payload(db, organization_id, _stored(db, organization_id))


@router.put(_PATH, summary="Choose which standard object fields are public")
def update_public_fields(
    organization_id: UUID,
    body: PublicFieldsBody,
    auth: AuthContext = Depends(_MANAGE),
    db: Session = Depends(get_db),
):
    try:
        keys = pof.validate_keys(body.public_fields)
    except pof.PublicFieldsError as e:
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": str(e),
            "details": {"invalid_fields": e.invalid},
        })

    config = db.query(DiscoverConfig).filter(DiscoverConfig.organization_id == organization_id).first()
    if not config:
        config = DiscoverConfig(organization_id=organization_id)
        db.add(config)
    # Stored in catalog order, so the saved value is stable and readable.
    config.public_object_fields = [f.key for f in pof.FIELD_CATALOG if f.key in keys]
    db.commit()
    # Cached public pages (object detail) were built with the old field set.
    invalidate_org_cache_by_id(str(organization_id))
    logger.info(
        "Public object fields set for org %s by user %s: %s",
        organization_id, auth.user_id, ",".join(config.public_object_fields),
    )
    return _settings_payload(db, organization_id, config.public_object_fields)
