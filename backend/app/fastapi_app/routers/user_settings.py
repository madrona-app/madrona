"""
Profile Settings and QR Code API endpoints (FastAPI).

Batch F — 4 routes:
  - Profile Settings (2 routes): list settings, get setting
  - QR Codes (2 routes): single object QR, batch label PDF

Migrated from app/api/profile_settings.py and app/api/qr.py.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.models import Organization, CollectionObject
from app.permissions import Permission
from app.services.profile_settings_service import get_org_setting, list_org_settings
from app.services.qr_service import get_qr_service
from app.services.label_pdf_service import get_label_pdf_service, LabelItem
from app.fastapi_app.schemas.user_settings import SettingValueResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["user-settings"])


# ============================================================================
# PROFILE SETTINGS ENDPOINTS
# ============================================================================


@router.get("/api/organizations/{org_id}/settings", response_model=dict, summary="Get organization settings")
def get_organization_settings(
    org_id: UUID,
    scope: str = Query(None),
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    """Get all settings for an organization."""
    settings = list_org_settings(org_id, scope=scope)
    return settings


@router.get("/api/organizations/{org_id}/settings/{key}", response_model=SettingValueResponse, summary="Get organization setting")
def get_organization_setting(
    org_id: UUID,
    key: str,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    """Get a single setting value for an organization."""
    try:
        value = get_org_setting(org_id, key, fallback_to_default=True)
        return {"key": key, "value": value}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ============================================================================
# QR CODE ENDPOINTS
# ============================================================================


def _get_org_slug(db: Session, organization_id: UUID) -> str | None:
    org = db.query(Organization.slug).filter(
        Organization.organization_id == organization_id,
    ).first()
    return org.slug if org else None


@router.get("/api/organizations/{organization_id}/qr/object/{object_id}", summary="Get object qr")
def get_object_qr(
    organization_id: UUID,
    object_id: UUID,
    format: str = Query("svg"),
    scale: int = Query(4, ge=1, le=20),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Generate a QR code for a single object."""
    org_slug = _get_org_slug(db, organization_id)
    if not org_slug:
        raise HTTPException(status_code=404, detail="Organization not found")

    if format not in ("svg", "png"):
        raise HTTPException(status_code=400, detail="format must be 'svg' or 'png'")

    qr_service = get_qr_service()
    data, content_type = qr_service.generate_object_qr(
        org_slug=org_slug, object_id=object_id, fmt=format, scale=scale,
    )

    return Response(content=data, media_type=content_type)


@router.get("/api/organizations/{organization_id}/qr/site", summary="Get museum site qr")
def get_site_qr(
    organization_id: UUID,
    format: str = Query("png"),
    scale: int = Query(6, ge=1, le=20),
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    """Generate a museum-level QR code for the collection's public site."""
    org_slug = _get_org_slug(db, organization_id)
    if not org_slug:
        raise HTTPException(status_code=404, detail="Organization not found")

    if format not in ("svg", "png"):
        raise HTTPException(status_code=400, detail="format must be 'svg' or 'png'")

    qr_service = get_qr_service()
    data, content_type = qr_service.generate_site_qr(
        org_slug=org_slug, fmt=format, scale=scale,
    )

    ext = "png" if format == "png" else "svg"
    return Response(
        content=data,
        media_type=content_type,
        headers={
            "Content-Disposition": f'attachment; filename="{org_slug}-guide-qr.{ext}"',
        },
    )


@router.post("/api/organizations/{organization_id}/qr/labels", summary="Generate label pdf")
def generate_label_pdf(
    organization_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Generate a PDF label sheet for multiple objects."""
    org_slug = _get_org_slug(db, organization_id)
    if not org_slug:
        raise HTTPException(status_code=404, detail="Organization not found")

    object_ids = body.get("object_ids", [])
    layout = body.get("layout", "4up")

    if not object_ids:
        raise HTTPException(status_code=400, detail="object_ids is required")
    if layout not in ("4up", "6up"):
        raise HTTPException(status_code=400, detail="layout must be '4up' or '6up'")
    if len(object_ids) > 100:
        raise HTTPException(status_code=400, detail="Maximum 100 objects per batch")

    try:
        uuids = [UUID(oid) for oid in object_ids]
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid object_id format")

    objects = db.query(CollectionObject).filter(
        CollectionObject.object_id.in_(uuids),
        CollectionObject.organization_id == organization_id,
    ).all()

    obj_map = {obj.object_id: obj for obj in objects}
    items = []
    for uid in uuids:
        obj = obj_map.get(uid)
        if obj:
            title = ""
            if obj.title_links:
                title = obj.title_links[0].title or ""
            elif obj.object_name:
                title = obj.object_name
            items.append(LabelItem(
                object_id=obj.object_id,
                object_number=obj.object_number or "",
                title=title,
                org_slug=org_slug,
            ))

    if not items:
        raise HTTPException(status_code=404, detail="No matching objects found")

    pdf_service = get_label_pdf_service()
    pdf_bytes = pdf_service.generate_label_sheet(items, layout=layout)

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=qr-labels.pdf"},
    )
