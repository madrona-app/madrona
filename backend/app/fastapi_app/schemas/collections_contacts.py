"""Pydantic response schemas for collections contacts (condition reports) endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class ConditionReportOut(BaseModel):
    """Serialized condition report record."""
    report_id: str | None = None
    organization_id: str | None = None
    report_number: str | None = None
    report_type: str | None = None
    report_date: str | None = None
    examiner_id: str | None = None
    examiner_name: str | None = None
    object_id: str | None = None
    linked_entity_type: str | None = None
    linked_entity_id: str | None = None
    overall_condition: str | None = None
    condition_summary: str | None = None
    detailed_findings: Any = None
    hazards: Any = None
    recommendations: str | None = None
    conservation_needed: bool | None = None
    conservation_priority: str | None = None
    handling_requirements: str | None = None
    packing_requirements: str | None = None
    display_restrictions: str | None = None
    report_note: str | None = None
    status: str | None = None
    reviewed_by: str | None = None
    reviewed_date: str | None = None
    created_by: str | None = None
    updated_by: str | None = None
    created_at: str | None = None
    updated_at: str | None = None

    model_config = {"extra": "allow"}


class ConditionReportListResponse(BaseModel):
    """Paginated condition report list."""
    items: list[ConditionReportOut]
    total: int
    limit: int
    offset: int


class ConditionReportDeleteResponse(BaseModel):
    """Delete success response."""
    success: bool = True
    message: str
