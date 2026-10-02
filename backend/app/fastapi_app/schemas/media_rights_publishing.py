"""Pydantic response schemas for media_rights_publishing router."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


# ============================================================================
# PUBLISHING
# ============================================================================


class PublishMediaResponse(BaseModel):
    success: bool
    media_id: str
    is_published: bool
    warnings: list[str] | None = None


class UnpublishMediaResponse(BaseModel):
    success: bool
    media_id: str
    is_published: bool


class ReviewMetadataResponse(BaseModel):
    success: bool
    media_id: str
    metadata_reviewed: bool
    metadata_reviewed_at: str | None = None
    metadata_reviewed_by: str | None = None


class ClearMetadataReviewResponse(BaseModel):
    success: bool
    media_id: str
    metadata_reviewed: bool


# ============================================================================
# MEDIA RIGHTS
# ============================================================================


class MediaRightsOut(BaseModel):
    rights_id: str
    media_id: str
    organization_id: str
    rights_type: str | None = None
    rights_status: str | None = None
    rights_holder: str | None = None
    license_type: str | None = None
    license_url: str | None = None
    rights_statement: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    territory: str | None = None
    usage_restrictions: str | None = None
    is_active: bool | None = None
    created_at: str | None = None


class MediaRightsListResponse(BaseModel):
    media_id: str
    rights: list[MediaRightsOut]


class MediaRightsCreatedResponse(BaseModel):
    rights_id: str
    media_id: str
    rights_type: str | None = None


class MediaRightsUpdatedResponse(BaseModel):
    rights_id: str


# ============================================================================
# MEDIA CONSENT
# ============================================================================


class MediaConsentOut(BaseModel):
    consent_id: str
    media_id: str
    subject_name: str | None = None
    subject_role: str | None = None
    consent_type: str | None = None
    consent_scope: str | None = None
    consent_date: str | None = None
    expiry_date: str | None = None
    consent_document_key: str | None = None
    is_valid: bool | None = None
    revocation_date: str | None = None
    revocation_reason: str | None = None
    notes: str | None = None
    created_at: str | None = None


class MediaConsentListResponse(BaseModel):
    media_id: str
    consent_records: list[MediaConsentOut]
    total: int
    has_valid_consent: bool


class MediaConsentCreatedResponse(BaseModel):
    consent_id: str
    media_id: str
    subject_name: str | None = None
    consent_type: str | None = None
    consent_scope: str | None = None
    is_valid: bool | None = None


class MediaConsentUpdatedResponse(BaseModel):
    consent_id: str
    media_id: str
    subject_name: str | None = None
    is_valid: bool | None = None
    message: str | None = None


class MediaConsentDeletedResponse(BaseModel):
    success: bool
    consent_id: str


class MediaConsentRevokedResponse(BaseModel):
    consent_id: str
    media_id: str
    subject_name: str | None = None
    is_valid: bool
    revocation_date: str | None = None
    message: str | None = None


# ============================================================================
# USAGE ANALYTICS
# ============================================================================


class UsageEventCreatedResponse(BaseModel):
    event_id: str
    media_id: str
    event_type: str
    logged_at: str | None = None


class EventTypeCounts(BaseModel):
    views: int = 0
    downloads: int = 0
    embeds: int = 0
    api_accesses: int = 0
    shares: int = 0


class MediaUsageStatsResponse(BaseModel):
    media_id: str
    period_days: int
    total_events: int
    unique_users: int
    by_event_type: EventTypeCounts


class TopMediaItem(BaseModel):
    media_id: str
    title: str | None = None
    filename: str | None = None
    event_count: int


class MediaUsageReportResponse(BaseModel):
    organization_id: str
    period_start: str
    period_end: str
    period_days: int
    total_events: int
    by_event_type: EventTypeCounts
    top_media: list[TopMediaItem]


# ============================================================================
# EXPIRATION ALERTS
# ============================================================================


class ExpirationAlertOut(BaseModel):
    alert_id: str
    media_id: str
    alert_type: str | None = None
    related_id: str | None = None
    expiry_date: str | None = None
    days_until_expiry: int | None = None
    severity: str | None = None
    status: str | None = None
    email_sent_at: str | None = None
    created_at: str | None = None
    media_title: str | None = None
    media_filename: str | None = None


class ExpirationAlertListResponse(BaseModel):
    items: list[ExpirationAlertOut]
    total: int
    limit: int
    offset: int


class SeverityCounts(BaseModel):
    critical: int = 0
    urgent: int = 0
    warning: int = 0


class AlertTypeCounts(BaseModel):
    rights: int = 0
    consent: int = 0


class ExpirationAlertSummaryResponse(BaseModel):
    total_active: int
    by_severity: SeverityCounts
    by_type: AlertTypeCounts


class ExpirationAlertActionResponse(BaseModel):
    alert_id: str
    status: str
    dismissed_at: str | None = None
    message: str | None = None
