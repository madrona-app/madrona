"""
Media Templates & Configuration API endpoints (FastAPI).

Phase 9c — 12 routes:
  - Watermark Templates CRUD (3 routes)
  - Apply Watermark to Media (1 route)
  - Field Inheritance Config CRUD + seed (6 routes)
  - Media Inherited Fields (1 route)
  - Storage Analytics (1 route)

Migrated from app/api/media.py.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.models import (
    Media,
    MediaFieldInheritanceConfig,
    MediaProcessingJob,
    WatermarkTemplate,
)
from app.permissions import Permission
from app.fastapi_app.schemas.common import SuccessResponse
from app.fastapi_app.schemas.media_templates_config import (
    ApplyWatermarkResponse,
    DeleteWatermarkTemplateResponse,
    FieldInheritanceConfigListResponse,
    FieldInheritanceConfigOut,
    InheritedFieldsResponse,
    StorageAnalyticsResponse,
    WatermarkTemplateListResponse,
    WatermarkTemplateOut,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["media-templates-config"])


# ============================================================================
# SERIALIZERS
# ============================================================================


def _serialize_watermark_template(t: WatermarkTemplate) -> dict:
    return {
        "template_id": str(t.template_id),
        "name": t.name,
        "watermark_type": t.watermark_type,
        "config": t.config,
        "is_default": t.is_default,
        "created_at": t.created_at.isoformat() if t.created_at else None,
    }


def _serialize_inheritance_config(config: MediaFieldInheritanceConfig) -> dict:
    return {
        "config_id": str(config.config_id),
        "organization_id": str(config.organization_id),
        "source_field": config.source_field,
        "display_label": config.display_label,
        "display_context": config.display_context,
        "transform_type": config.transform_type,
        "transform_config": config.transform_config,
        "sort_order": config.sort_order,
        "is_active": config.is_active,
        "created_at": config.created_at.isoformat() if config.created_at else None,
        "updated_at": config.updated_at.isoformat() if config.updated_at else None,
    }


# ============================================================================
# WATERMARK TEMPLATES
# ============================================================================


@router.get("/api/organizations/{org_id}/media/watermark-templates", response_model=WatermarkTemplateListResponse, summary="List watermark templates")
def list_watermark_templates(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """List watermark templates."""
    templates = db.query(WatermarkTemplate).filter(
        WatermarkTemplate.organization_id == org_id,
        WatermarkTemplate.is_active == True,  # noqa: E712
    ).order_by(WatermarkTemplate.name).all()

    return {
        "templates": [_serialize_watermark_template(t) for t in templates],
    }


@router.post("/api/organizations/{org_id}/media/watermark-templates", response_model=WatermarkTemplateOut, status_code=201, summary="Create watermark template")
def create_watermark_template(
    org_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Create watermark template."""
    name = (body.get("name") or "").strip()
    watermark_type = (body.get("watermark_type") or "").strip()

    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    if not watermark_type:
        raise HTTPException(status_code=400, detail="watermark_type is required")
    if watermark_type not in ("text", "image"):
        raise HTTPException(
            status_code=400,
            detail="watermark_type must be 'text' or 'image'",
        )

    # If setting as default, unset other defaults
    if body.get("is_default"):
        existing_defaults = db.query(WatermarkTemplate).filter(
            WatermarkTemplate.organization_id == org_id,
            WatermarkTemplate.is_default == True,  # noqa: E712
        ).all()
        for t in existing_defaults:
            t.is_default = False

    template = WatermarkTemplate(
        organization_id=org_id,
        name=name,
        watermark_type=watermark_type,
        config=body.get("config", {}),
        is_default=body.get("is_default", False),
        is_active=True,
        created_by=auth.user_id,
    )
    db.add(template)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Watermark template with this name already exists",
        )

    db.refresh(template)
    return _serialize_watermark_template(template)


@router.delete("/api/organizations/{org_id}/media/watermark-templates/{template_id}", response_model=DeleteWatermarkTemplateResponse, summary="Delete watermark template")
def delete_watermark_template(
    org_id: UUID,
    template_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete watermark template."""
    template = db.query(WatermarkTemplate).filter(
        WatermarkTemplate.template_id == template_id,
        WatermarkTemplate.organization_id == org_id,
    ).first()

    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    template.is_active = False

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Cannot delete watermark template with existing references",
        )

    return {"success": True, "template_id": str(template_id)}


# ============================================================================
# APPLY WATERMARK
# ============================================================================


@router.post("/api/organizations/{org_id}/media/{media_id}/watermark", response_model=ApplyWatermarkResponse, status_code=202, summary="Apply watermark to media")
def apply_watermark_to_media(
    org_id: UUID,
    media_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Apply watermark to media."""
    media = db.query(Media).filter(
        Media.media_id == media_id,
        Media.organization_id == org_id,
    ).first()

    if not media:
        raise HTTPException(status_code=404, detail="Media not found")

    if media.media_type != "image":
        raise HTTPException(status_code=400, detail="Only images can be watermarked")

    template_id_str = body.get("template_id")
    if not template_id_str:
        raise HTTPException(status_code=400, detail="template_id is required")

    template_uuid = UUID(template_id_str)

    template = db.query(WatermarkTemplate).filter(
        WatermarkTemplate.template_id == template_uuid,
        WatermarkTemplate.organization_id == org_id,
        WatermarkTemplate.is_active == True,  # noqa: E712
    ).first()

    if not template:
        raise HTTPException(status_code=404, detail="Watermark template not found")

    apply_to_derivatives = body.get("apply_to_derivatives", True)
    create_watermarked_copy = body.get("create_watermarked_copy", False)

    job = MediaProcessingJob(
        media_id=media_id,
        organization_id=org_id,
        job_type="watermark",
        status="pending",
        parameters={
            "template_id": str(template_uuid),
            "template_config": template.config,
            "watermark_type": template.watermark_type,
            "apply_to_derivatives": apply_to_derivatives,
            "create_watermarked_copy": create_watermarked_copy,
        },
    )
    db.add(job)
    db.commit()

    # Queue background task (best-effort)
    try:
        from app.tasks.media import apply_watermark_task
        apply_watermark_task.delay(
            str(media_id),
            str(org_id),
            str(job.job_id),
        )
    except Exception as task_err:
        logger.warning("Failed to queue watermark task: %s", task_err)

    return {
        "job_id": str(job.job_id),
        "media_id": str(media_id),
        "template_id": template_id_str,
        "status": "pending",
        "message": "Watermark application queued",
    }


# ============================================================================
# MEDIA INHERITED FIELDS
# ============================================================================


@router.get("/api/organizations/{org_id}/media/{media_id}/inherited-fields", response_model=InheritedFieldsResponse, summary="Get media inherited fields")
def get_media_inherited_fields(
    org_id: UUID,
    media_id: UUID,
    context: str = Query("detail"),
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """Get media inherited fields."""
    from app.services.media_inheritance import MediaInheritanceService

    fields = MediaInheritanceService.compute_inherited_fields(
        media_id=str(media_id),
        organization_id=str(org_id),
        context=context,
        session=db,
    )

    return {"inherited_fields": fields}


# ============================================================================
# FIELD INHERITANCE CONFIG
# ============================================================================


@router.get("/api/organizations/{org_id}/media/field-inheritance-config", response_model=FieldInheritanceConfigListResponse, summary="List field inheritance config")
def list_field_inheritance_config(
    org_id: UUID,
    context: str = Query(None),
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """List field inheritance config."""
    configs = db.query(MediaFieldInheritanceConfig).filter(
        MediaFieldInheritanceConfig.organization_id == org_id,
    ).order_by(MediaFieldInheritanceConfig.sort_order).all()

    if context and context in ("detail", "list"):
        configs = [
            c for c in configs
            if c.display_context in (context, "both")
        ]

    return {
        "configs": [_serialize_inheritance_config(c) for c in configs],
        "total": len(configs),
    }


@router.post("/api/organizations/{org_id}/media/field-inheritance-config", response_model=FieldInheritanceConfigOut, status_code=201, summary="Create field inheritance config")
def create_field_inheritance_config(
    org_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    """Create field inheritance config."""
    from app.services.media_inheritance import MediaInheritanceService

    for field in ("source_field", "display_label"):
        if not body.get(field):
            raise HTTPException(status_code=400, detail=f"{field} is required")

    try:
        config = MediaInheritanceService.create_config(
            organization_id=str(org_id),
            source_field=body["source_field"],
            display_label=body["display_label"],
            display_context=body.get("display_context", "both"),
            transform_type=body.get("transform_type"),
            transform_config=body.get("transform_config"),
            sort_order=body.get("sort_order", 0),
            is_active=body.get("is_active", True),
            session=db,
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Field configuration already exists")

    return _serialize_inheritance_config(config)


@router.patch("/api/organizations/{org_id}/media/field-inheritance-config/{config_id}", response_model=FieldInheritanceConfigOut, summary="Update field inheritance config")
def update_field_inheritance_config(
    org_id: UUID,
    config_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    """Update field inheritance config."""
    from app.services.media_inheritance import MediaInheritanceService

    try:
        config = MediaInheritanceService.update_config(
            config_id=str(config_id),
            organization_id=str(org_id),
            session=db,
            **body,
        )
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Field inheritance config already exists")

    if not config:
        raise HTTPException(status_code=404, detail="Configuration not found")

    db.commit()
    return _serialize_inheritance_config(config)


@router.delete("/api/organizations/{org_id}/media/field-inheritance-config/{config_id}", response_model=SuccessResponse, summary="Delete field inheritance config")
def delete_field_inheritance_config(
    org_id: UUID,
    config_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    """Delete field inheritance config."""
    from app.services.media_inheritance import MediaInheritanceService

    try:
        deleted = MediaInheritanceService.delete_config(
            config_id=str(config_id),
            organization_id=str(org_id),
            session=db,
        )
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Cannot delete field inheritance config with existing references",
        )

    if not deleted:
        raise HTTPException(status_code=404, detail="Configuration not found")

    db.commit()
    return {"success": True}


@router.post("/api/organizations/{org_id}/media/field-inheritance-config/seed", response_model=FieldInheritanceConfigListResponse, status_code=201, summary="Seed field inheritance config")
def seed_field_inheritance_config(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    """Seed field inheritance config."""
    from app.services.media_inheritance import MediaInheritanceService

    configs = MediaInheritanceService.seed_default_config(str(org_id), session=db)
    db.commit()

    return {
        "configs": [_serialize_inheritance_config(c) for c in configs],
        "total": len(configs),
    }


# ============================================================================
# STORAGE ANALYTICS
# ============================================================================


@router.get("/api/organizations/{org_id}/storage/analytics", response_model=StorageAnalyticsResponse, summary="Get storage analytics")
def get_storage_analytics(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """Get storage analytics."""
    from app.services.storage_analytics import get_organization_storage_analytics

    analytics = get_organization_storage_analytics(
        organization_id=str(org_id),
        db_session=db,
    )

    return analytics
