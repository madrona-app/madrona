"""
Extended DAM API endpoints (FastAPI).

Phase 9f — 24 routes:
  - Format conversion on download
  - Image transform (crop, rotate, flip, resize)
  - Upload from URL
  - Contact sheet generation
  - Media annotations (W3C Web Annotation model) — CRUD (4 routes)
  - Derivative size configuration — CRUD (4 routes)
  - Media locking — lock/unlock (2 routes)
  - Alternative files — upload/delete (2 routes)
  - Embed code generation

Migrated from app/api/media_dam.py.
"""

import io
import logging
import os
import tempfile
import uuid as uuid_mod
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, File, Form
from fastapi.responses import JSONResponse, Response, StreamingResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.models import (
    Media,
    MediaAlternative,
    MediaAnnotation,
    MediaDerivative,
    MediaLock,
    DerivativeSizeConfig,
)
from app.fastapi_app.schemas.common import SuccessResponse
from app.fastapi_app.schemas.media_dam import (
    AlternativeCreatedResponse,
    AnnotationCreatedResponse,
    AnnotationListResponse,
    AnnotationUpdatedResponse,
    DerivativeSizeCreatedResponse,
    DerivativeSizeListResponse,
    DownloadUrlResponse,
    EmbedCodeResponse,
    MediaLockResponse,
    TransformImageResponse,
    UploadFromUrlResponse,
)
from app.permissions import Permission

logger = logging.getLogger(__name__)

router = APIRouter(tags=["media-dam"])


# ============================================================================
# HELPERS
# ============================================================================


def _get_media_or_404(db: Session, org_id: UUID, media_id: UUID) -> Media:
    media = db.query(Media).filter(
        Media.media_id == media_id,
        Media.organization_id == org_id,
    ).first()
    if not media:
        raise HTTPException(status_code=404, detail="Media not found")
    return media


# ============================================================================
# SERIALIZERS
# ============================================================================


def _serialize_annotation(a: MediaAnnotation) -> dict:
    return {
        "annotation_id": str(a.annotation_id),
        "target_selector": a.target_selector,
        "body": a.body,
        "motivation": a.motivation,
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "created_by": str(a.created_by) if a.created_by else None,
        "updated_at": a.updated_at.isoformat() if a.updated_at else None,
    }


def _serialize_derivative_size(c: DerivativeSizeConfig) -> dict:
    return {
        "config_id": str(c.config_id),
        "organization_id": str(c.organization_id) if c.organization_id else None,
        "name": c.name,
        "label": c.label,
        "media_type": c.media_type,
        "max_width": c.max_width,
        "max_height": c.max_height,
        "format": c.format,
        "quality": c.quality,
        "config": c.config,
        "is_default": c.is_default,
        "sort_order": c.sort_order,
        "is_system": c.organization_id is None,
    }


# ============================================================================
# FORMAT CONVERSION ON DOWNLOAD
# ============================================================================


@router.get("/api/organizations/{org_id}/media/{media_id}/download", summary="Download media")
def download_with_conversion(
    org_id: UUID,
    media_id: UUID,
    format: str | None = Query(None),
    quality: int = Query(85),
    derivative_type: str | None = Query(None),
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """Download media with optional format conversion or derivative selection.

    Access control:
      - Always: caller must have MEDIA_VIEW (dep injection).
      - When the org has `media_rights_enforcement = true`:
          * Unpublished media → requires MEDIA_VIEW_UNPUBLISHED.
          * Derivative downloads → requires MEDIA_DOWNLOAD_DERIVATIVES.
          * Originals → gated by compute_download_access (rights-based);
            "request"/"blocked" → 403 with a structured error envelope.

    The toggle defaults to OFF. Pre-2026-05 behavior (no rights/perm
    checks beyond MEDIA_VIEW) is preserved when the toggle is OFF —
    flip it on per-org once MediaRights data is populated. See
    Organization.media_rights_enforcement and the
    /api/organizations/{org_id}/settings/media-rights-enforcement endpoint.
    """
    from app.services.media_rights_enforcement import is_rights_enforcement_enabled

    media = _get_media_or_404(db, org_id, media_id)
    enforcement_on = is_rights_enforcement_enabled(org_id, db)
    user_id_str = str(auth.user_id)

    # RBAC gate, independent of the rights-enforcement toggle.
    #
    # media.download_original and media.download_derivatives exist and are
    # deliberately withheld from some roles (viewer holds derivatives but not
    # originals), yet this endpoint only ever required media.view — it builds
    # its presigned URL inline instead of going through get_org_media_url,
    # which is the one place _check_media_url_permission runs. A viewer could
    # therefore download originals.
    #
    # The rights-enforcement toggle is not the right home for this. It exists
    # because compute_download_access needs MediaRights rows populated before
    # it can judge anything; a role check needs no such data, and leaving it
    # behind the toggle means the permission means nothing by default. Note
    # compute_download_access never consults these permissions either — it
    # reasons purely about rights records — so with the toggle ON originals
    # were still ungated by role.
    from app.services.rbac_service import check_permission as _check_perm
    from app.services.rbac_service import is_platform_admin as _is_platform_admin

    _needed = (
        Permission.MEDIA_DOWNLOAD_DERIVATIVES if derivative_type
        else Permission.MEDIA_DOWNLOAD_ORIGINAL
    )
    # require_permission() lets platform admins past every other gate in the
    # app; checking in the handler skips that, which would single this route
    # out as the one place they are refused.
    if not _is_platform_admin(auth.user_id, session=db) and not _check_perm(
        user_id_str, str(org_id), _needed, session=db
    ):
        raise HTTPException(status_code=403, detail={
            "code": "forbidden",
            "message": (
                "Permission denied to download derivatives" if derivative_type
                else "Permission denied to download the original file"
            ),
        })

    # When enforcement is on, additionally gate by unpublished-perm / rights.
    if enforcement_on:
        is_published = bool(getattr(media, "is_published", False))

        if not is_published:
            from app.services.rbac_service import check_permission
            if not check_permission(user_id_str, str(org_id), Permission.MEDIA_VIEW_UNPUBLISHED, session=db):
                raise HTTPException(status_code=403, detail={"code": "forbidden", "message": "Permission denied to view unpublished media"})

        if not derivative_type:
            from app.services.download_access import compute_download_access
            from app.services.rbac_service import get_user_permissions as _get_perms
            user_perms = _get_perms(user_id_str, str(org_id), session=db)
            access = compute_download_access(media_id, org_id, list(user_perms), db)
            if access == "blocked":
                raise HTTPException(status_code=403, detail={"code": "download_blocked", "message": "Rights expired or restricted — download unavailable", "download_access": "blocked"})
            if access == "request":
                raise HTTPException(status_code=403, detail={"code": "download_request_required", "message": "Please submit a download request", "download_access": "request"})

    # Derivative branch — return presigned URL for the derivative file.
    if derivative_type:
        derivative = db.query(MediaDerivative).filter(
            MediaDerivative.media_id == media_id,
            MediaDerivative.derivative_type == derivative_type,
        ).first()
        if not derivative:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Derivative not found"})
        from app.services.uploads import get_s3_client, get_media_bucket, DEFAULT_REGION
        from app.config import get_settings
        settings = get_settings()
        s3_client = get_s3_client(for_presigning=True)
        bucket = get_media_bucket(DEFAULT_REGION)
        derivative_filename = f"{media.filename.rsplit('.', 1)[0]}_{derivative_type}.{derivative.format}"
        url = s3_client.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": bucket,
                "Key": derivative.s3_key,
                "ResponseContentDisposition": f'attachment; filename="{derivative_filename}"',
            },
            ExpiresIn=settings.s3_url_expiry_seconds,
        )
        return {"download_url": url}

    # Format-conversion branch — stream converted bytes.
    if format and media.media_type == "image":
        from app.services.storage import get_storage_backend
        from app.services.media_conversion import convert_image
        storage = get_storage_backend(str(org_id), db)
        file_data, _ = storage.get_object_sync(media.s3_key)
        result = convert_image(file_data, format, quality)
        new_filename = f"{Path(media.filename).stem}.{result['extension']}"
        return Response(
            content=result["converted_bytes"],
            media_type=result["mime_type"],
            headers={
                "Content-Disposition": f'attachment; filename="{new_filename}"',
            },
        )

    # Default: presigned URL for the original.
    from app.services.uploads import get_s3_client, get_media_bucket, DEFAULT_REGION
    from app.config import get_settings
    settings = get_settings()

    s3_client = get_s3_client(for_presigning=True)
    bucket = get_media_bucket(DEFAULT_REGION)

    url = s3_client.generate_presigned_url(
        "get_object",
        Params={
            "Bucket": bucket,
            "Key": media.s3_key,
            "ResponseContentDisposition": f'attachment; filename="{media.filename}"',
        },
        ExpiresIn=settings.s3_url_expiry_seconds,
    )

    return {"download_url": url}


# ============================================================================
# IMAGE TRANSFORM ON DOWNLOAD
# ============================================================================


@router.post("/api/organizations/{org_id}/media/{media_id}/transform", response_model=TransformImageResponse, summary="Transform image")
def transform_image(
    org_id: UUID,
    media_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """Apply transforms (crop, rotate, flip, resize) and return result."""
    media = _get_media_or_404(db, org_id, media_id)

    if media.media_type != "image":
        raise HTTPException(status_code=400, detail="Transforms only apply to images")

    from app.services.storage import get_storage_backend
    from app.services.image_transform import TransformSpec, apply_transforms

    from app.services.storage.base import ObjectNotFoundError

    storage = get_storage_backend(str(org_id), db)
    try:
        file_data, _ = storage.get_object_sync(media.s3_key)
    except ObjectNotFoundError as exc:
        # A media row whose object is missing from storage is a representable
        # state — a failed upload, a bucket restored without its contents, a
        # key rewritten by hand — and it is not a server fault. It was raising
        # 500; the caller needs to know the file is gone.
        raise HTTPException(
            status_code=404,
            detail={"code": "not_found", "message": "Media file not found in storage"},
        ) from exc

    spec = TransformSpec(
        crop_x=body.get("crop_x"),
        crop_y=body.get("crop_y"),
        crop_width=body.get("crop_width"),
        crop_height=body.get("crop_height"),
        crop_unit=body.get("crop_unit", "percent"),
        rotate=body.get("rotate"),
        flip_horizontal=body.get("flip_horizontal", False),
        flip_vertical=body.get("flip_vertical", False),
        gamma=body.get("gamma"),
        max_width=body.get("max_width"),
        max_height=body.get("max_height"),
        format=body.get("format", "jpeg"),
        quality=body.get("quality", 85),
    )

    result = apply_transforms(file_data, spec)

    # Upload result to S3 as a temporary file
    from app.services.uploads import get_s3_client, get_media_bucket, DEFAULT_REGION
    from app.config import get_settings
    settings = get_settings()

    # The presigning client is built against S3_PUBLIC_ENDPOINT_URL and must not be used
    # for real S3 calls — from inside the container that host does not resolve.
    # Real operations use the internal client; only URL minting uses the other.
    s3_client = get_s3_client(DEFAULT_REGION)
    presign_client = get_s3_client(DEFAULT_REGION, for_presigning=True)
    bucket = get_media_bucket(DEFAULT_REGION)

    result_key = f"orgs/{org_id}/media/transforms/{media_id}/{uuid_mod.uuid4()}.{result['extension']}"

    s3_client.put_object(
        Bucket=bucket,
        Key=result_key,
        Body=result["transformed_bytes"],
        ContentType=result["mime_type"],
    )

    url = presign_client.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": result_key},
        ExpiresIn=settings.s3_url_expiry_seconds,
    )

    return {
        "download_url": url,
        "width": result["width"],
        "height": result["height"],
        "file_size": result["file_size"],
        "mime_type": result["mime_type"],
    }


# ============================================================================
# UPLOAD FROM URL
# ============================================================================


@router.post("/api/organizations/{org_id}/media/upload-from-url", response_model=UploadFromUrlResponse, summary="Upload from URL")
def upload_from_url(
    org_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Create media from a remote URL."""
    url = body.get("url")
    title = body.get("title")
    folder_id = body.get("folder_id")

    if not url:
        raise HTTPException(status_code=400, detail="URL is required")

    from app.tasks.media import upload_from_url_task

    task = upload_from_url_task.delay(
        url=url,
        organization_id=str(org_id),
        title=title,
        folder_id=folder_id,
        created_by=str(auth.user_id) if auth.user_id else None,
    )

    return {
        "success": True,
        "task_id": task.id,
        "message": "Upload from URL queued",
    }


# ============================================================================
# CONTACT SHEET GENERATION
# ============================================================================


@router.post("/api/organizations/{org_id}/media/collections/{collection_id}/contact-sheet", status_code=202, summary="Generate contact sheet")
def generate_contact_sheet(
    org_id: UUID,
    collection_id: UUID,
    body: dict | None = None,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """Generate a PDF contact sheet from a collection (async via Celery)."""
    from app.models import ReportRun
    from app.tasks.media import generate_contact_sheet_task

    data = body or {}

    run = ReportRun(
        organization_id=org_id,
        status="pending",
        triggered_by="on_demand",
        report_key="contact_sheet",
        context_params={
            "collection_id": str(collection_id),
            "layout": data.get("layout", "grid"),
            "page_size": data.get("page_size", "letter"),
            "columns": data.get("columns", 4),
            "include_title": data.get("include_title", True),
            "include_filename": data.get("include_filename", True),
            "include_description": data.get("include_description", False),
        },
        export_format="pdf",
        triggered_by_user_id=auth.user_id,
    )
    db.add(run)
    db.commit()

    generate_contact_sheet_task.delay(
        run_id=str(run.run_id),
        organization_id=str(org_id),
    )

    return {"run_id": str(run.run_id), "status": "pending"}


# ============================================================================
# MEDIA ANNOTATIONS (W3C Web Annotation)
# ============================================================================


@router.get("/api/organizations/{org_id}/media/{media_id}/annotations", response_model=AnnotationListResponse, summary="List annotations")
def list_annotations(
    org_id: UUID,
    media_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """List all annotations for a media item."""
    annotations = db.query(MediaAnnotation).filter_by(
        media_id=media_id,
        organization_id=org_id,
    ).order_by(MediaAnnotation.created_at).all()

    return {
        "media_id": str(media_id),
        "annotations": [_serialize_annotation(a) for a in annotations],
    }


@router.post("/api/organizations/{org_id}/media/{media_id}/annotations", response_model=AnnotationCreatedResponse, status_code=201, summary="Create annotation")
def create_annotation(
    org_id: UUID,
    media_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Create a new annotation on a media item."""
    if not body.get("target_selector"):
        raise HTTPException(status_code=400, detail="target_selector is required")

    annotation = MediaAnnotation(
        media_id=media_id,
        organization_id=org_id,
        target_selector=body["target_selector"],
        body=body.get("body"),
        motivation=body.get("motivation", "commenting"),
        created_by=auth.user_id,
    )
    db.add(annotation)
    db.commit()

    return {
        "annotation_id": str(annotation.annotation_id),
        "target_selector": annotation.target_selector,
        "body": annotation.body,
        "motivation": annotation.motivation,
        "created_at": annotation.created_at.isoformat(),
    }


@router.put("/api/organizations/{org_id}/media/{media_id}/annotations/{annotation_id}", response_model=AnnotationUpdatedResponse, summary="Update annotation")
def update_annotation(
    org_id: UUID,
    media_id: UUID,
    annotation_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Update an annotation."""
    annotation = db.query(MediaAnnotation).filter_by(
        annotation_id=annotation_id,
        media_id=media_id,
        organization_id=org_id,
    ).first()

    if not annotation:
        raise HTTPException(status_code=404, detail="Annotation not found")

    if "target_selector" in body:
        annotation.target_selector = body["target_selector"]
    if "body" in body:
        annotation.body = body["body"]
    if "motivation" in body:
        annotation.motivation = body["motivation"]

    db.commit()

    return {
        "annotation_id": str(annotation.annotation_id),
        "target_selector": annotation.target_selector,
        "body": annotation.body,
        "motivation": annotation.motivation,
    }


@router.delete("/api/organizations/{org_id}/media/{media_id}/annotations/{annotation_id}", response_model=SuccessResponse, summary="Delete annotation")
def delete_annotation(
    org_id: UUID,
    media_id: UUID,
    annotation_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete an annotation."""
    annotation = db.query(MediaAnnotation).filter_by(
        annotation_id=annotation_id,
        media_id=media_id,
        organization_id=org_id,
    ).first()

    if not annotation:
        raise HTTPException(status_code=404, detail="Annotation not found")

    db.delete(annotation)
    db.commit()
    return {"success": True}


# ============================================================================
# DERIVATIVE SIZE CONFIGURATION
# ============================================================================


@router.get("/api/organizations/{org_id}/media/derivative-sizes", response_model=DerivativeSizeListResponse, summary="List derivative sizes")
def list_derivative_sizes(
    org_id: UUID,
    media_type: str | None = None,
    include_system: bool = True,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """List derivative size presets (org-specific + system defaults)."""
    from sqlalchemy import or_

    query = db.query(DerivativeSizeConfig).filter(
        or_(
            DerivativeSizeConfig.organization_id == str(org_id),
            DerivativeSizeConfig.organization_id.is_(None),
        ) if include_system else DerivativeSizeConfig.organization_id == str(org_id)
    )
    if media_type:
        query = query.filter(DerivativeSizeConfig.media_type == media_type)
    configs = query.order_by(DerivativeSizeConfig.media_type, DerivativeSizeConfig.sort_order).all()

    return {
        "derivative_sizes": [_serialize_derivative_size(c) for c in configs],
    }


@router.post("/api/organizations/{org_id}/media/derivative-sizes", response_model=DerivativeSizeCreatedResponse, status_code=201, summary="Create derivative size")
def create_derivative_size(
    org_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_ADMIN)),
    db: Session = Depends(get_db),
):
    """Create a new derivative size preset."""
    if not body.get("name") or not body.get("label"):
        raise HTTPException(status_code=400, detail="name and label are required")

    config = DerivativeSizeConfig(
        organization_id=org_id,
        name=body["name"],
        label=body["label"],
        media_type=body.get("media_type", "image"),
        max_width=body.get("max_width"),
        max_height=body.get("max_height"),
        format=body.get("format", "jpeg"),
        quality=body.get("quality", 85),
        config=body.get("config"),
        is_default=body.get("is_default", False),
        sort_order=body.get("sort_order", 0),
    )
    db.add(config)
    db.commit()

    return {
        "config_id": str(config.config_id),
        "name": config.name,
        "label": config.label,
    }


@router.put("/api/organizations/{org_id}/media/derivative-sizes/{config_id}", response_model=SuccessResponse, summary="Update derivative size")
def update_derivative_size(
    org_id: UUID,
    config_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_ADMIN)),
    db: Session = Depends(get_db),
):
    """Update a derivative size preset."""
    config = db.query(DerivativeSizeConfig).filter_by(
        config_id=config_id,
        organization_id=org_id,
    ).first()

    if not config:
        raise HTTPException(status_code=404, detail="Config not found")

    for field in ("label", "media_type", "max_width", "max_height", "format", "quality", "config", "is_default", "sort_order"):
        if field in body:
            setattr(config, field, body[field])

    db.commit()
    return {"success": True}


@router.delete("/api/organizations/{org_id}/media/derivative-sizes/{config_id}", response_model=SuccessResponse, summary="Delete derivative size")
def delete_derivative_size(
    org_id: UUID,
    config_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_ADMIN)),
    db: Session = Depends(get_db),
):
    """Delete a derivative size preset."""
    config = db.query(DerivativeSizeConfig).filter_by(
        config_id=config_id,
        organization_id=org_id,
    ).first()

    if not config:
        raise HTTPException(status_code=404, detail="Config not found")

    db.delete(config)
    db.commit()
    return {"success": True}


# ============================================================================
# MEDIA LOCKING
# ============================================================================


@router.post("/api/organizations/{org_id}/media/{media_id}/lock", response_model=MediaLockResponse, summary="Lock media")
def lock_media(
    org_id: UUID,
    media_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_ADMIN)),
    db: Session = Depends(get_db),
):
    """Acquire a lock on a media item."""
    existing = db.query(MediaLock).filter_by(
        media_id=media_id,
    ).first()

    now = datetime.now(timezone.utc)

    if existing:
        if existing.expires_at > now and str(existing.locked_by) != str(auth.user_id):
            raise HTTPException(
                status_code=409,
                detail="Media is locked by another user",
            )
        # Expired or same user - remove old lock
        db.delete(existing)
        db.flush()

    lock = MediaLock(
        media_id=media_id,
        organization_id=org_id,
        locked_by=auth.user_id,
        expires_at=now + timedelta(minutes=30),
    )
    db.add(lock)
    db.commit()

    return {
        "locked": True,
        "expires_at": lock.expires_at.isoformat(),
    }


@router.delete("/api/organizations/{org_id}/media/{media_id}/lock", response_model=MediaLockResponse, summary="Unlock media")
def unlock_media(
    org_id: UUID,
    media_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_ADMIN)),
    db: Session = Depends(get_db),
):
    """Release a lock on a media item."""
    lock = db.query(MediaLock).filter_by(
        media_id=media_id,
    ).first()

    if not lock:
        return {"locked": False}

    if str(lock.locked_by) != str(auth.user_id):
        raise HTTPException(status_code=403, detail="Lock held by another user")

    db.delete(lock)
    db.commit()
    return {"locked": False}


# ============================================================================
# ALTERNATIVE FILES
# ============================================================================


@router.post("/api/organizations/{org_id}/media/{media_id}/alternatives", response_model=AlternativeCreatedResponse, status_code=201, summary="Upload alternative file")
async def upload_alternative(
    org_id: UUID,
    media_id: UUID,
    file: UploadFile = File(...),
    alternative_type: str = Form("conversion"),
    label: str | None = Form(None),
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Upload a manual alternative file for a media item."""
    from app.services.uploads import get_s3_client, get_media_bucket, DEFAULT_REGION

    file_data = await file.read()
    effective_label = label or file.filename

    # put_object is a real call: internal endpoint, not the public one.
    s3_client = get_s3_client(DEFAULT_REGION)
    bucket = get_media_bucket(DEFAULT_REGION)

    s3_key = f"orgs/{org_id}/media/alternatives/{media_id}/{file.filename}"

    s3_client.put_object(
        Bucket=bucket,
        Key=s3_key,
        Body=file_data,
        ContentType=file.content_type or "application/octet-stream",
    )

    alt = MediaAlternative(
        media_id=media_id,
        organization_id=org_id,
        alternative_type=alternative_type,
        label=effective_label,
        s3_key=s3_key,
        filename=file.filename,
        file_size=len(file_data),
        mime_type=file.content_type,
        generated_by="manual",
        created_by=auth.user_id,
    )
    db.add(alt)
    db.commit()

    return {
        "alternative_id": str(alt.alternative_id),
        "filename": alt.filename,
    }


@router.delete("/api/organizations/{org_id}/media/{media_id}/alternatives/{alt_id}", response_model=SuccessResponse, summary="Delete alternative file")
def delete_alternative(
    org_id: UUID,
    media_id: UUID,
    alt_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete an alternative file."""
    from app.services.uploads import get_s3_client, get_media_bucket, DEFAULT_REGION

    alt = db.query(MediaAlternative).filter_by(
        alternative_id=alt_id,
        media_id=media_id,
        organization_id=org_id,
    ).first()

    if not alt:
        raise HTTPException(status_code=404, detail="Alternative not found")

    # Delete from S3
    try:
        # delete_object is a real call: internal endpoint.
        s3_client = get_s3_client(DEFAULT_REGION)
        bucket = get_media_bucket(DEFAULT_REGION)
        s3_client.delete_object(Bucket=bucket, Key=alt.s3_key)
    except Exception as e:
        logger.warning("Failed to delete S3 object: %s", e)

    db.delete(alt)
    db.commit()
    return {"success": True}


# ============================================================================
# EMBEDDABLE WIDGETS
# ============================================================================


@router.get("/api/organizations/{org_id}/media/{media_id}/embed-code", response_model=EmbedCodeResponse, summary="Get embed code")
def get_embed_code(
    org_id: UUID,
    media_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """Generate embed codes for a media item."""
    from app.config import get_settings
    settings = get_settings()

    media = _get_media_or_404(db, org_id, media_id)

    base_url = settings.app_base_url

    embed_url = f"{base_url}/public/v1/embed/{media_id}"
    iframe_code = (
        f'<iframe src="{embed_url}" '
        f'width="640" height="480" '
        f'frameborder="0" allowfullscreen></iframe>'
    )

    return {
        "media_id": str(media_id),
        "embed_codes": {
            "iframe": iframe_code,
            "url": embed_url,
        },
    }
