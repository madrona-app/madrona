"""Pydantic response schemas for Preservation API."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel


# ============================================================================
# Shared sub-models
# ============================================================================

class OffsetPaginationPage(BaseModel):
    limit: int
    offset: int
    has_more: bool


# ============================================================================
# Preservation Events
# ============================================================================

class PreservationEventOut(BaseModel):
    event_id: str
    organization_id: str
    event_type: str | None = None
    media_id: str | None = None
    outcome: str | None = None
    outcome_detail: str | None = None
    # detail is JSONB in the DB; accept arbitrary dict shapes.
    detail: dict | None = None
    agent_type: str | None = None
    agent_name: str | None = None
    linked_entity_type: str | None = None
    linked_entity_id: str | None = None
    created_at: str | None = None


class PreservationEventListResponse(BaseModel):
    items: list[PreservationEventOut]
    total: int
    page: OffsetPaginationPage


# ============================================================================
# Format Risk
# ============================================================================

class FormatRiskSummaryResponse(BaseModel):
    formats: list[Any]


class AtRiskMediaItem(BaseModel):
    media_id: str
    filename: str | None = None
    mime_type: str | None = None
    pronom_puid: str | None = None
    format_name: str | None = None
    format_risk_level: str | None = None
    file_size: int | None = None
    created_at: str | None = None


class AtRiskMediaResponse(BaseModel):
    items: list[AtRiskMediaItem]
    total: int
    page: OffsetPaginationPage


# ============================================================================
# Policies
# ============================================================================

class PreservationPolicyOut(BaseModel):
    policy_id: str
    organization_id: str
    name: str | None = None
    description: str | None = None
    policy_type: str | None = None
    scope: Any = None
    rules: Any = None
    is_active: bool | None = None
    priority: int | None = None
    approved_by: str | None = None
    approved_at: str | None = None
    created_by: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class PreservationPolicyListResponse(BaseModel):
    policies: list[PreservationPolicyOut]


# ============================================================================
# Action Plans
# ============================================================================

class PreservationActionPlanOut(BaseModel):
    action_id: str
    organization_id: str
    policy_id: str
    media_id: str
    action_type: str | None = None
    detail: str | None = None
    status: str | None = None
    scheduled_for: str | None = None
    started_at: str | None = None
    completed_at: str | None = None
    result: Any = None
    error_message: str | None = None
    created_at: str | None = None


class ActionPlanListResponse(BaseModel):
    items: list[PreservationActionPlanOut]
    total: int
    page: OffsetPaginationPage


# ============================================================================
# Information Packages
# ============================================================================

class InformationPackageOut(BaseModel):
    package_id: str
    organization_id: str
    media_id: str
    package_type: str | None = None
    status: str | None = None
    structure: Any = None
    provenance_event_ids: Any = None
    export_profile_id: str | None = None
    external_identifier: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    expires_at: str | None = None


class InformationPackageListResponse(BaseModel):
    information_packages: list[InformationPackageOut]


class InformationPackagePaginatedResponse(BaseModel):
    items: list[InformationPackageOut]
    total: int
    page: OffsetPaginationPage


# ============================================================================
# Replication
# ============================================================================

class ReplicationRecordOut(BaseModel):
    record_id: str
    organization_id: str
    media_id: str
    storage_location: str | None = None
    storage_provider: str | None = None
    storage_region: str | None = None
    storage_key: str | None = None
    copy_type: str | None = None
    checksum_sha256: str | None = None
    last_verified_at: str | None = None
    verification_status: str | None = None
    created_at: str | None = None


class ReplicationRecordListResponse(BaseModel):
    replicas: list[ReplicationRecordOut]


class ReplicationSummaryResponse(BaseModel):
    total_media: int
    replicated_media: int
    unreplicated_media: int
    coverage_percent: float
    by_verification_status: dict[str, int]


# ============================================================================
# Retention Report
# ============================================================================

class RetentionReportResponse(BaseModel):
    model_config = {"extra": "allow"}


# ============================================================================
# AIP Manifest
# ============================================================================

class AipManifestResponse(BaseModel):
    model_config = {"extra": "allow"}
