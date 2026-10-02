"""Pydantic response schemas for media_dam router."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


# ============================================================================
# FORMAT CONVERSION / TRANSFORM
# ============================================================================


class DownloadUrlResponse(BaseModel):
    download_url: str


class TransformImageResponse(BaseModel):
    download_url: str
    width: int
    height: int
    file_size: int
    mime_type: str


# ============================================================================
# UPLOAD FROM URL
# ============================================================================


class UploadFromUrlResponse(BaseModel):
    success: bool
    task_id: str
    message: str


# ============================================================================
# ANNOTATIONS
# ============================================================================


class AnnotationOut(BaseModel):
    annotation_id: str
    target_selector: Any
    body: Any | None = None
    motivation: str | None = None
    created_at: str | None = None
    created_by: str | None = None
    updated_at: str | None = None


class AnnotationListResponse(BaseModel):
    media_id: str
    annotations: list[AnnotationOut]


class AnnotationCreatedResponse(BaseModel):
    annotation_id: str
    target_selector: Any
    body: Any | None = None
    motivation: str | None = None
    created_at: str | None = None


class AnnotationUpdatedResponse(BaseModel):
    annotation_id: str
    target_selector: Any
    body: Any | None = None
    motivation: str | None = None


# ============================================================================
# DERIVATIVE SIZE CONFIG
# ============================================================================


class DerivativeSizeOut(BaseModel):
    config_id: str
    organization_id: str | None = None
    name: str
    label: str
    media_type: str | None = None
    max_width: int | None = None
    max_height: int | None = None
    format: str | None = None
    quality: int | None = None
    config: dict | None = None
    is_default: bool | None = None
    sort_order: int | None = None
    is_system: bool | None = None


class DerivativeSizeListResponse(BaseModel):
    derivative_sizes: list[DerivativeSizeOut]


class DerivativeSizeCreatedResponse(BaseModel):
    config_id: str
    name: str
    label: str


# ============================================================================
# MEDIA LOCKING
# ============================================================================


class MediaLockResponse(BaseModel):
    locked: bool
    expires_at: str | None = None


# ============================================================================
# ALTERNATIVE FILES
# ============================================================================


class AlternativeCreatedResponse(BaseModel):
    alternative_id: str
    filename: str | None = None


# ============================================================================
# EMBED CODE
# ============================================================================


class EmbedCodesDetail(BaseModel):
    iframe: str
    url: str


class EmbedCodeResponse(BaseModel):
    media_id: str
    embed_codes: EmbedCodesDetail
