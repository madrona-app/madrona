"""Pydantic response schemas for procedure compliance endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class CollectionsReviewOut(BaseModel):
    review_id: str
    organization_id: str
    review_number: str | None = None
    title: str
    review_type: str | None = None
    scope: str | None = None
    methodology: str | None = None
    assessment_criteria: Any = None
    scoring_guidance: Any = None
    start_date: str | None = None
    end_date: str | None = None
    objects_total: int | None = None
    objects_reviewed: int | None = None
    findings_summary: str | None = None
    recommendations: Any = None
    follow_up_actions: Any = None
    status: str | None = None
    lead_reviewer: str | None = None
    notes: str | None = None
    created_by: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class CollectionsReviewListResponse(BaseModel):
    items: list[CollectionsReviewOut]
    total: int
    limit: int
    offset: int


class ObjectReviewAssessmentOut(BaseModel):
    assessment_id: str
    review_id: str
    object_id: str
    reviewer_id: str | None = None
    reviewed_at: str | None = None
    scores: Any = None
    overall_score: float | None = None
    recommendation: str | None = None
    justification: str | None = None
    follow_up_required: bool | None = None
    follow_up_notes: str | None = None
    notes: str | None = None


class AssessmentListResponse(BaseModel):
    items: list[ObjectReviewAssessmentOut]
    total: int
    limit: int
    offset: int


class AuditCampaignOut(BaseModel):
    audit_id: str
    organization_id: str
    audit_number: str | None = None
    title: str
    audit_type: str | None = None
    scope: str | None = None
    methodology: str | None = None
    sample_method: str | None = None
    sample_size: int | None = None
    sample_percentage: float | None = None
    start_date: str | None = None
    end_date: str | None = None
    items_total: int | None = None
    items_audited: int | None = None
    discrepancies_found: int | None = None
    accuracy_rate: float | None = None
    findings_summary: str | None = None
    remedial_actions: Any = None
    status: str | None = None
    lead_auditor: str | None = None
    notes: str | None = None
    created_by: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class AuditCampaignListResponse(BaseModel):
    items: list[AuditCampaignOut]
    total: int
    limit: int
    offset: int


class AuditResultOut(BaseModel):
    result_id: str
    audit_id: str
    object_id: str | None = None
    location_id: str | None = None
    auditor_id: str | None = None
    audited_at: str | None = None
    location_verified: bool | None = None
    expected_location_id: str | None = None
    actual_location_id: str | None = None
    condition_verified: bool | None = None
    expected_condition: str | None = None
    actual_condition: str | None = None
    documentation_verified: bool | None = None
    documentation_issues: Any = None
    discrepancy_found: bool | None = None
    discrepancy_type: str | None = None
    discrepancy_description: str | None = None
    resolution_status: str | None = None
    resolution_notes: str | None = None
    resolved_at: str | None = None
    notes: str | None = None


class AuditResultListResponse(BaseModel):
    items: list[AuditResultOut]
    total: int
    limit: int
    offset: int
