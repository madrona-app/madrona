"""Pydantic response schemas for collections exhibitions endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


# ============================================================================
# Exhibition list item (compact)
# ============================================================================


class ExhibitionListItem(BaseModel):
    """Exhibition item in a list response."""
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
    is_public: bool | None = None
    public_url_slug: str | None = None
    placement_count: int | None = None
    created_at: str | None = None


class ExhibitionListResponse(BaseModel):
    """List of exhibitions."""
    total: int
    exhibitions: list[ExhibitionListItem]


# ============================================================================
# Exhibition detail (full)
# ============================================================================


class ExhibitionDetailOut(BaseModel):
    """Full exhibition detail including placements and floor plans."""
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
    status_history: list[Any] = []
    floor_plans: list[Any] = []
    placements: list[Any] = []


# ============================================================================
# Create / Update responses
# ============================================================================


class ExhibitionCreatedResponse(BaseModel):
    """Response after creating an exhibition."""
    exhibition_id: str
    title: str | None = None
    message: str


class ExhibitionUpdatedResponse(BaseModel):
    """Response after updating an exhibition."""
    exhibition_id: str
    message: str


# ============================================================================
# Exhibition objects
# ============================================================================


class ExhibitionObjectOut(BaseModel):
    """Serialized exhibition object."""
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

    model_config = {"extra": "allow"}


class ExhibitionObjectListResponse(BaseModel):
    """List of exhibition objects."""
    exhibition_objects: list[ExhibitionObjectOut]


class ExhibitionObjectAddedResponse(BaseModel):
    """Response after adding an object to an exhibition."""
    exhibition_object_id: str
    source_type: str | None = None
    message: str


class ExhibitionObjectUpdatedResponse(BaseModel):
    """Response after updating an exhibition object."""
    exhibition_object_id: str
    message: str


class ExhibitionObjectsBatchAddedResponse(BaseModel):
    """Response after batch adding objects to an exhibition."""
    added: list[str]
    skipped: list[str]
    source_type: str | None = None
    message: str


# ============================================================================
# Available objects search
# ============================================================================


class AvailableObjectItem(BaseModel):
    """Object available to add to an exhibition."""
    source_type: str | None = None
    source_id: str | None = None
    object_number: str | None = None
    title: str | None = None
    description: str | None = None
    thumbnail_url: str | None = None
    source_system: str | None = None


class AvailableObjectsResponse(BaseModel):
    """Search results for available objects."""
    objects: list[AvailableObjectItem]
    source_mode: str | None = None
    count: int


# ============================================================================
# Label templates
# ============================================================================


class LabelTemplateOut(BaseModel):
    """Serialized label template."""
    template_id: str
    name: str | None = None
    label_type: str | None = None
    template_fields: Any = None
    font_family: str | None = None
    font_size_pt: int | None = None
    width_cm: float | None = None
    height_cm: float | None = None
    is_default: bool | None = None
    created_at: str | None = None


class LabelTemplateListResponse(BaseModel):
    """List of label templates."""
    label_templates: list[LabelTemplateOut]


class LabelTemplateCreatedResponse(BaseModel):
    """Response after creating a label template."""
    template_id: str
    name: str | None = None
    message: str


class LabelTemplateUpdatedResponse(BaseModel):
    """Response after updating a label template."""
    template_id: str
    message: str
