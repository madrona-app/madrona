"""Pydantic response schemas for discover/publishing endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class AuditEventOut(BaseModel):
    event_id: str
    change_type: str | None = None
    changed_at: str | None = None
    changed_by: str | None = None
    changed_by_name: str | None = None
    changed_by_email: str | None = None
    changed_fields: list[str] | None = None
    summary: str | None = None
    request_method: str | None = None
    field_diffs: list[Any] | None = None


class EntityAuditHistoryResponse(BaseModel):
    entity_type: str
    entity_id: str
    items: list[AuditEventOut]
    total: int
    limit: int
    offset: int


class DiscoverableToggleResponse(BaseModel):
    object_id: str
    is_discoverable: bool
    discoverable_at: str | None = None


class SkippedDiscoverableObject(BaseModel):
    object_id: str
    reason: str


class BulkDiscoverableResponse(BaseModel):
    updated: int
    is_discoverable: bool
    skipped: list[SkippedDiscoverableObject] = []


class DiscoverConfigOut(BaseModel):
    hero_media_id: str | None = None
    page_title: str | None = None
    page_subtitle: str | None = None
    show_object_count: bool | None = None
    default_view_mode: str | None = None
    default_sort: str | None = None
    header_logo_media_id: str | None = None
    primary_color: str | None = None
    accent_color: str | None = None
    font_family: str | None = None
    nav_items: Any = None
    footer_text: str | None = None
    social_links: Any = None
    featured_object_ids: Any = None
    homepage_page_id: str | None = None
    custom_404_page_id: str | None = None
    secondary_color: str | None = None
    background_color: str | None = None
    text_color: str | None = None
    heading_font_family: str | None = None
    body_font_family: str | None = None
    button_style: str | None = None
    header_style: str | None = None
    google_fonts: Any = None
    custom_css: str | None = None
    footer_columns: Any = None
    land_acknowledgment: str | None = None
    footer_logo_media_id: str | None = None
    external_integrations: Any = None
    analytics_config: Any = None
    cdn_config: Any = None


class DiscoverStatsResponse(BaseModel):
    total_objects: int
    discoverable_count: int
    private_count: int
    pending_schedules: int
    published_last_30_days: int
    unpublished_last_30_days: int


class DiscoverPreviewResponse(BaseModel):
    object_id: str
    object_number: str | None = None
    title: str | None = None
    titles: list[Any] | None = None
    brief_description: str | None = None
    full_description: str | None = None
    object_type: str | None = None
    classification: str | None = None
    classifications: list[Any] | None = None
    creators: list[Any] | None = None
    creation_date_display: str | None = None
    creation_date_earliest: str | None = None
    creation_date_latest: str | None = None
    creation_place: str | None = None
    materials: Any = None
    techniques: Any = None
    measurements: list[Any] | None = None
    inscriptions: list[Any] | None = None
    style_period: str | None = None
    provenance: str | None = None
    credit_line: str | None = None
    media: list[Any] | None = None
    has_image: bool
    is_currently_discoverable: bool
    unpublished_media_count: int
    preview_warnings: list[str]


class PublishByCriteriaDryRunResponse(BaseModel):
    matched_count: int
    restricted_count: int = 0
    sample_objects: list[Any]


class PublishByCriteriaResponse(BaseModel):
    updated_count: int
    is_discoverable: bool
    skipped_restricted: int = 0


class PublishScheduleOut(BaseModel):
    schedule_id: str
    action: str
    scheduled_for: str
    criteria: Any = None
    object_ids: Any = None
    status: str
    result_count: int | None = None
    error_message: str | None = None
    executed_at: str | None = None
    created_at: str
