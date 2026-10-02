"""Pydantic schemas for Media Templates & Configuration API endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel

from app.fastapi_app.schemas.common import SuccessResponse


# ---- Watermark Templates ----

class WatermarkTemplateOut(BaseModel):
    """Serialized watermark template."""
    template_id: str
    name: str
    watermark_type: str
    config: Any | None = None
    is_default: bool = False
    created_at: str | None = None


class WatermarkTemplateListResponse(BaseModel):
    """List of watermark templates."""
    templates: list[WatermarkTemplateOut]


class DeleteWatermarkTemplateResponse(SuccessResponse):
    """Delete watermark template response."""
    template_id: str


# ---- Apply Watermark ----

class ApplyWatermarkResponse(BaseModel):
    """Apply watermark response (202 Accepted)."""
    job_id: str
    media_id: str
    template_id: str
    status: str
    message: str


# ---- Inherited Fields ----

class InheritedFieldsResponse(BaseModel):
    """Media inherited fields."""
    inherited_fields: Any


# ---- Field Inheritance Config ----

class FieldInheritanceConfigOut(BaseModel):
    """Serialized field inheritance config."""
    config_id: str
    organization_id: str
    source_field: str
    display_label: str
    display_context: str | None = None
    transform_type: str | None = None
    transform_config: Any | None = None
    sort_order: int = 0
    is_active: bool = True
    created_at: str | None = None
    updated_at: str | None = None


class FieldInheritanceConfigListResponse(BaseModel):
    """List of field inheritance configs."""
    configs: list[FieldInheritanceConfigOut]
    total: int


# ---- Storage Analytics ----

class StorageAnalyticsResponse(BaseModel):
    """Storage analytics. Dynamic shape from the service."""
    model_config = {"extra": "allow"}
