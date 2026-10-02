"""Pydantic response models for exhibit_venues router."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Venues
# ---------------------------------------------------------------------------

class VenueSummaryOut(BaseModel):
    venue_id: str
    name: str | None = None
    description: str | None = None
    address: str | None = None
    default_ceiling_height_cm: int | None = None
    default_wall_color: str | None = None
    floor_plan_count: int = 0
    created_at: str | None = None


class VenueListResponse(BaseModel):
    venues: list[VenueSummaryOut]


class VenueCreatedResponse(BaseModel):
    venue_id: str
    name: str
    message: str


class FloorPlanOut(BaseModel):
    floor_plan_id: str
    name: str | None = None
    floor_number: int | None = None
    geometry: Any = None
    ceiling_height_cm: int | None = None
    wall_color: str | None = None
    model_url: str | None = None
    model_scale: float = 1.0


class VenueDetailOut(BaseModel):
    venue_id: str
    name: str | None = None
    description: str | None = None
    address: str | None = None
    default_ceiling_height_cm: int | None = None
    default_wall_color: str | None = None
    created_at: str | None = None
    floor_plans: list[FloorPlanOut] = []


class VenueUpdateResponse(BaseModel):
    status: str
    message: str
    venue_id: str


class VenueDeleteResponse(BaseModel):
    status: str
    message: str


# ---------------------------------------------------------------------------
# Floor plans
# ---------------------------------------------------------------------------

class FloorPlanCreatedResponse(BaseModel):
    floor_plan_id: str
    name: str
    message: str


class FloorPlanDetailOut(BaseModel):
    floor_plan_id: str
    venue_id: str
    venue_name: str | None = None
    exhibition_id: str | None = None
    name: str | None = None
    floor_number: int | None = None
    geometry: Any = None
    ceiling_height_cm: int | None = None
    wall_color: str | None = None
    floor_texture: str | None = None
    model_url: str | None = None
    model_scale: float = 1.0
    appearance_settings: Any = None


class FloorPlanDetailResponse(BaseModel):
    floor_plan: FloorPlanDetailOut


class FloorPlanUpdateResponse(BaseModel):
    status: str
    message: str
    floor_plan_id: str


class FloorPlanDeleteResponse(BaseModel):
    status: str
    message: str


class FloorPlanBackgroundResponse(BaseModel):
    floor_plan_id: str
    background_image: Any
    message: str


class FloorPlanBackgroundRemovedResponse(BaseModel):
    status: str
    message: str
    floor_plan_id: str


class GeometryValidationResponse(BaseModel):
    valid: bool
    errors: list[str] = []
    warnings: list[str] = []


# ---------------------------------------------------------------------------
# Frame styles
# ---------------------------------------------------------------------------

class FrameStyleOut(BaseModel):
    frame_style_id: str
    name: str | None = None
    description: str | None = None
    profile_type: str | None = None
    default_width_cm: float | None = None
    default_depth_cm: float | None = None
    material: str | None = None
    color_hex: str | None = None
    preview_image_url: str | None = None
    is_system: bool = False


class FrameStyleListResponse(BaseModel):
    frame_styles: list[FrameStyleOut]


class FrameStyleCreatedResponse(BaseModel):
    frame_style_id: str
    name: str
    message: str


class FrameStyleUpdateResponse(BaseModel):
    status: str
    message: str
    frame_style_id: str


class FrameStyleDeleteResponse(BaseModel):
    status: str
    message: str


# ---------------------------------------------------------------------------
# Mount configs
# ---------------------------------------------------------------------------

class MountConfigOut(BaseModel):
    mount_config_id: str
    name: str | None = None
    mount_type: str | None = None
    config: Any = None
    preview_image_url: str | None = None
    is_system: bool = False


class MountConfigListResponse(BaseModel):
    mount_configs: list[MountConfigOut]


class MountConfigCreatedResponse(BaseModel):
    mount_config_id: str
    name: str
    message: str


class MountConfigUpdateResponse(BaseModel):
    status: str
    message: str
    mount_config_id: str


class MountConfigDeleteResponse(BaseModel):
    status: str
    message: str
