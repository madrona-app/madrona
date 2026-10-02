"""Pydantic response models for exhibit_exhibitions router."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Exhibition list / detail
# ---------------------------------------------------------------------------

class ExhibitionSummaryOut(BaseModel):
    exhibition_id: str
    exhibition_number: str | None = None
    title: str | None = None
    description: str | None = None
    exhibition_type: str | None = None
    status: str | None = None
    venue_id: str | None = None
    venue_name: str | None = None
    planned_start_date: str | None = None
    planned_end_date: str | None = None
    actual_start_date: str | None = None
    actual_end_date: str | None = None
    is_public: bool | None = None
    public_url_slug: str | None = None
    placement_count: int = 0
    created_at: str | None = None


class ExhibitionListResponse(BaseModel):
    exhibitions: list[ExhibitionSummaryOut]


class ExhibitionCreatedResponse(BaseModel):
    exhibition_id: str
    title: str
    message: str


class ExhibitionDetailOut(BaseModel):
    exhibition_id: str
    exhibition_number: str | None = None
    title: str | None = None
    description: str | None = None
    curator_notes: str | None = None
    exhibition_type: str | None = None
    status: str | None = None
    organizer_id: str | None = None
    authorizer_id: str | None = None
    authorization_date: str | None = None
    provisos: str | None = None
    outcome: str | None = None
    venue_id: str | None = None
    venue_name: str | None = None
    planned_start_date: str | None = None
    planned_end_date: str | None = None
    actual_start_date: str | None = None
    actual_end_date: str | None = None
    is_public: bool | None = None
    public_url_slug: str | None = None
    created_at: str | None = None
    floor_plans: list[Any] = []
    placements: list[Any] = []
    status_history: list[Any] = []


class ExhibitionUpdateResponse(BaseModel):
    exhibition_id: str
    message: str


# ---------------------------------------------------------------------------
# Exhibition objects
# ---------------------------------------------------------------------------

class ExhibitionObjectOut(BaseModel):
    exhibition_object_id: str
    display_order: int | None = None
    section: str | None = None
    object_status: str | None = None
    confirmed_date: str | None = None
    credit_line_override: str | None = None
    special_requirements: str | None = None
    installation_notes: str | None = None
    loan_in_id: str | None = None
    condition_in_report_id: str | None = None
    condition_out_report_id: str | None = None
    created_at: str | None = None
    source_type: str | None = None
    object_id: str | None = None
    entity_key: str | None = None
    object_number: str | None = None
    title: str | None = None
    description: str | None = None
    thumbnail_url: str | None = None
    primary_image_url: str | None = None
    bridge_payload: Any = None
    bridge_source_system: str | None = None
    creator: str | None = None


class ExhibitionObjectListResponse(BaseModel):
    exhibition_objects: list[ExhibitionObjectOut]


class EditorObjectOut(BaseModel):
    exhibition_object_id: str
    source_type: str | None = None
    object_id: str | None = None
    entity_key: str | None = None
    object_number: str | None = None
    title: str | None = None
    creators: list[Any] = []
    primary_image_url: str | None = None
    width_cm: float | None = None
    height_cm: float | None = None
    depth_cm: float | None = None
    object_status: str | None = None
    section: str | None = None


class EditorObjectListResponse(BaseModel):
    objects: list[EditorObjectOut]
    total: int


class ExhibitionObjectCreatedResponse(BaseModel):
    exhibition_object_id: str
    source_type: str
    message: str


# ---------------------------------------------------------------------------
# Labels
# ---------------------------------------------------------------------------

class ExhibitionLabelOut(BaseModel):
    label_id: str
    exhibition_object_id: str | None = None
    template_id: str | None = None
    label_type: str | None = None
    generated_text: str | None = None
    custom_text: str | None = None
    status: str | None = None
    print_count: int | None = None
    created_at: str | None = None


class ExhibitionLabelListResponse(BaseModel):
    exhibition_labels: list[ExhibitionLabelOut]


class LabelsGeneratedResponse(BaseModel):
    message: str
    labels_created: int


class LabelApprovedResponse(BaseModel):
    label_id: str
    status: str
    message: str


# ---------------------------------------------------------------------------
# Content blocks
# ---------------------------------------------------------------------------

class ContentBlockOut(BaseModel):
    block_id: str
    block_type: str | None = None
    section: str | None = None
    display_order: int | None = None
    title: str | None = None
    content: str | None = None
    content_format: str | None = None
    status: str | None = None
    is_public: bool | None = None
    created_at: str | None = None


class ContentBlockListResponse(BaseModel):
    content_blocks: list[ContentBlockOut]


class ContentBlockCreatedResponse(BaseModel):
    block_id: str
    message: str


# ---------------------------------------------------------------------------
# Touring venues
# ---------------------------------------------------------------------------

class ExhibitionVenueOut(BaseModel):
    exhibition_venue_id: str
    venue_id: str | None = None
    external_venue_name: str | None = None
    external_venue_address: str | None = None
    tour_order: int | None = None
    planned_start_date: str | None = None
    planned_end_date: str | None = None
    actual_start_date: str | None = None
    actual_end_date: str | None = None
    status: str | None = None
    fee_amount: float | None = None
    fee_currency: str | None = None
    special_requirements: str | None = None
    created_at: str | None = None


class ExhibitionVenueListResponse(BaseModel):
    exhibition_venues: list[ExhibitionVenueOut]


class TouringVenueCreatedResponse(BaseModel):
    exhibition_venue_id: str
    message: str


# ---------------------------------------------------------------------------
# Floor plans
# ---------------------------------------------------------------------------

class FloorPlanAddedResponse(BaseModel):
    message: str
    floor_plan_id: str
    visit_order: int


# ---------------------------------------------------------------------------
# Placements
# ---------------------------------------------------------------------------

class PlacementCreatedResponse(BaseModel):
    placement_id: str
    message: str


class PlacementUpdateResponse(BaseModel):
    placement_id: str
    message: str


# ---------------------------------------------------------------------------
# Generic message (used by many update/delete routes)
# ---------------------------------------------------------------------------

from app.fastapi_app.schemas.common import MessageResponse  # noqa: E402, F401
