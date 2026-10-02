"""
Organization Branding API endpoints (FastAPI).

Provides endpoints for:
- Viewing and editing organization branding settings
- Uploading/deleting logos and signatures
- Managing document templates

Migrated from app/api/branding.py.
"""

import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Form, Query
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.fastapi_app.schemas.branding import (
    BrandingOut,
    DocumentTemplateListResponse,
    DocumentTemplateOut,
    LogoDeleteResponse,
    LogoUploadResponse,
    SignatureDeleteResponse,
    SignatureUploadResponse,
)
from app.fastapi_app.schemas.common import SuccessResponse
from app.models import Organization, OrganizationBranding, DocumentTemplate
from app.permissions import Permission

logger = logging.getLogger(__name__)

router = APIRouter(tags=["branding"])


# ============================================================================
# SERIALIZERS
# ============================================================================


def _serialize_branding(branding: OrganizationBranding, org_media_url_fn=None) -> dict:
    """Serialize branding to dict."""
    logo_url = None
    signature_url = None

    if org_media_url_fn:
        if branding.logo_s3_key:
            try:
                logo_url = org_media_url_fn(branding.logo_s3_key)
            except Exception:
                pass
        if branding.signature_s3_key:
            try:
                signature_url = org_media_url_fn(branding.signature_s3_key)
            except Exception:
                pass

    return {
        "branding_id": str(branding.branding_id),
        "organization_id": str(branding.organization_id),
        "logo_url": logo_url,
        "logo_s3_key": branding.logo_s3_key,
        "logo_width_px": branding.logo_width_px,
        "letterhead_name": branding.letterhead_name,
        "letterhead_address_line1": branding.letterhead_address_line1,
        "letterhead_address_line2": branding.letterhead_address_line2,
        "letterhead_city_state_zip": branding.letterhead_city_state_zip,
        "letterhead_country": branding.letterhead_country,
        "letterhead_phone": branding.letterhead_phone,
        "letterhead_email": branding.letterhead_email,
        "letterhead_website": branding.letterhead_website,
        "footer_text": branding.footer_text,
        "primary_color": branding.primary_color or "#1a365d",
        "secondary_color": branding.secondary_color or "#2d3748",
        "accent_color": branding.accent_color or "#3182ce",
        "signature_url": signature_url,
        "signature_s3_key": branding.signature_s3_key,
        "signature_name": branding.signature_name,
        "signature_title": branding.signature_title,
        "created_at": branding.created_at.isoformat() if branding.created_at else None,
        "updated_at": branding.updated_at.isoformat() if branding.updated_at else None,
    }


def _serialize_template(template: DocumentTemplate) -> dict:
    """Serialize a document template to dict."""
    return {
        "template_id": str(template.template_id),
        "organization_id": str(template.organization_id),
        "name": template.name,
        "template_type": template.template_type,
        "description": template.description,
        "is_default": template.is_default,
        "is_active": template.is_active,
        "created_at": template.created_at.isoformat() if template.created_at else None,
        "updated_at": template.updated_at.isoformat() if template.updated_at else None,
    }


# ============================================================================
# BRANDING SETTINGS
# ============================================================================


@router.get("/api/organizations/{org_id}/branding", response_model=BrandingOut, summary="Get branding")
def get_branding(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.BRANDING_VIEW)),
    db: Session = Depends(get_db),
):
    """Get organization branding settings."""
    from app.services.uploads import get_org_media_url

    branding = db.query(OrganizationBranding).filter_by(
        organization_id=org_id,
    ).first()

    if not branding:
        return {
            "branding_id": None,
            "organization_id": str(org_id),
            "logo_url": None,
            "logo_width_px": None,
            "letterhead_name": None,
            "letterhead_address_line1": None,
            "letterhead_address_line2": None,
            "letterhead_city_state_zip": None,
            "letterhead_country": None,
            "letterhead_phone": None,
            "letterhead_email": None,
            "letterhead_website": None,
            "footer_text": None,
            "primary_color": "#1a365d",
            "secondary_color": "#2d3748",
            "accent_color": "#3182ce",
            "signature_url": None,
            "signature_name": None,
            "signature_title": None,
            "message": "No branding configured. Using defaults.",
        }

    def _url_fn(key):
        return get_org_media_url(
            key, organization_id=str(org_id), db_session=db, expiry_seconds=3600,
        )

    return _serialize_branding(branding, org_media_url_fn=_url_fn)


@router.put("/api/organizations/{org_id}/branding", response_model=BrandingOut, summary="Update branding")
def update_branding(
    org_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.BRANDING_EDIT)),
    db: Session = Depends(get_db),
):
    """Create or update organization branding settings."""
    org = db.query(Organization).filter_by(organization_id=org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    branding = db.query(OrganizationBranding).filter_by(
        organization_id=org_id,
    ).first()

    if not branding:
        branding = OrganizationBranding(organization_id=org_id)
        db.add(branding)

    updatable_fields = [
        "letterhead_name", "letterhead_address_line1", "letterhead_address_line2",
        "letterhead_city_state_zip", "letterhead_country", "letterhead_phone",
        "letterhead_email", "letterhead_website", "footer_text",
        "primary_color", "secondary_color", "accent_color",
        "signature_name", "signature_title", "logo_width_px",
    ]

    for field in updatable_fields:
        if field in body:
            setattr(branding, field, body[field])

    db.commit()

    from app.services.uploads import get_org_media_url

    def _url_fn(key):
        return get_org_media_url(
            key, organization_id=str(org_id), db_session=db, expiry_seconds=3600,
        )

    return _serialize_branding(branding, org_media_url_fn=_url_fn)


# ============================================================================
# LOGO UPLOAD / DELETE
# ============================================================================


@router.post("/api/organizations/{org_id}/branding/logo", response_model=LogoUploadResponse, summary="Upload logo")
async def upload_logo(
    org_id: UUID,
    file: UploadFile = File(...),
    auth: AuthContext = Depends(require_permission(Permission.BRANDING_EDIT)),
    db: Session = Depends(get_db),
):
    """Upload organization logo."""
    from app.services.uploads import upload_org_branding_file, get_org_media_url

    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    branding = db.query(OrganizationBranding).filter_by(
        organization_id=org_id,
    ).first()

    if not branding:
        branding = OrganizationBranding(organization_id=org_id)
        db.add(branding)

    file_bytes = await file.read()
    s3_key = upload_org_branding_file(
        file_bytes=file_bytes,
        filename=file.filename,
        content_type=file.content_type,
        organization_id=str(org_id),
        file_type="logo",
    )

    branding.logo_s3_key = s3_key
    db.commit()

    logo_url = get_org_media_url(
        s3_key, organization_id=str(org_id), db_session=db, expiry_seconds=3600,
    )

    return {"success": True, "logo_s3_key": s3_key, "logo_url": logo_url}


@router.delete("/api/organizations/{org_id}/branding/logo", response_model=LogoDeleteResponse, summary="Delete logo")
def delete_logo(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.BRANDING_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete organization logo."""
    branding = db.query(OrganizationBranding).filter_by(
        organization_id=org_id,
    ).first()

    if not branding or not branding.logo_s3_key:
        raise HTTPException(status_code=404, detail="No logo found")

    branding.logo_s3_key = None
    db.commit()

    return {"success": True, "message": "Logo deleted"}


# ============================================================================
# SIGNATURE UPLOAD / DELETE
# ============================================================================


@router.post("/api/organizations/{org_id}/branding/signature", response_model=SignatureUploadResponse, summary="Upload signature")
async def upload_signature(
    org_id: UUID,
    file: UploadFile = File(...),
    auth: AuthContext = Depends(require_permission(Permission.BRANDING_EDIT)),
    db: Session = Depends(get_db),
):
    """Upload signature image."""
    from app.services.uploads import upload_org_branding_file, get_org_media_url

    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    branding = db.query(OrganizationBranding).filter_by(
        organization_id=org_id,
    ).first()

    if not branding:
        branding = OrganizationBranding(organization_id=org_id)
        db.add(branding)

    file_bytes = await file.read()
    s3_key = upload_org_branding_file(
        file_bytes=file_bytes,
        filename=file.filename,
        content_type=file.content_type,
        organization_id=str(org_id),
        file_type="signature",
    )

    branding.signature_s3_key = s3_key
    db.commit()

    signature_url = get_org_media_url(
        s3_key, organization_id=str(org_id), db_session=db, expiry_seconds=3600,
    )

    return {"success": True, "signature_s3_key": s3_key, "signature_url": signature_url}


@router.delete("/api/organizations/{org_id}/branding/signature", response_model=SignatureDeleteResponse, summary="Delete signature")
def delete_signature(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.BRANDING_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete signature image."""
    branding = db.query(OrganizationBranding).filter_by(
        organization_id=org_id,
    ).first()

    if not branding or not branding.signature_s3_key:
        raise HTTPException(status_code=404, detail="No signature found")

    branding.signature_s3_key = None
    db.commit()

    return {"success": True, "message": "Signature deleted"}


# ============================================================================
# DOCUMENT TEMPLATES
# ============================================================================


@router.get("/api/organizations/{org_id}/branding/templates", response_model=DocumentTemplateListResponse, summary="List templates")
def list_templates(
    org_id: UUID,
    template_type: str = Query(None),
    auth: AuthContext = Depends(require_permission(Permission.BRANDING_VIEW)),
    db: Session = Depends(get_db),
):
    """List document templates."""
    query = db.query(DocumentTemplate).filter(
        DocumentTemplate.organization_id == org_id,
        DocumentTemplate.is_active == True,
    )

    if template_type:
        query = query.filter(DocumentTemplate.template_type == template_type)

    templates = query.order_by(DocumentTemplate.name).all()
    return {"templates": [_serialize_template(t) for t in templates]}


@router.post("/api/organizations/{org_id}/branding/templates", response_model=DocumentTemplateOut, status_code=201, summary="Create template")
def create_template(
    org_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.BRANDING_EDIT)),
    db: Session = Depends(get_db),
):
    """Create a document template."""
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Template name is required")

    template = DocumentTemplate(
        organization_id=org_id,
        name=name,
        template_type=body.get("template_type", "general"),
        description=body.get("description"),
        is_default=body.get("is_default", False),
        is_active=True,
    )
    db.add(template)
    db.commit()

    return _serialize_template(template)


@router.put("/api/organizations/{org_id}/branding/templates/{template_id}", response_model=DocumentTemplateOut, summary="Update template")
def update_template(
    org_id: UUID,
    template_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.BRANDING_EDIT)),
    db: Session = Depends(get_db),
):
    """Update a document template."""
    template = db.query(DocumentTemplate).filter(
        DocumentTemplate.template_id == template_id,
        DocumentTemplate.organization_id == org_id,
    ).first()

    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    for field in ["name", "template_type", "description", "is_default", "is_active"]:
        if field in body:
            setattr(template, field, body[field])

    db.commit()
    return _serialize_template(template)


@router.delete("/api/organizations/{org_id}/branding/templates/{template_id}", response_model=SuccessResponse, summary="Delete template")
def delete_template(
    org_id: UUID,
    template_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.BRANDING_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete a document template."""
    template = db.query(DocumentTemplate).filter(
        DocumentTemplate.template_id == template_id,
        DocumentTemplate.organization_id == org_id,
    ).first()

    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    db.delete(template)
    db.commit()
    return {"success": True}
