"""Pydantic request schemas for condition report endpoints."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel


class CreateConditionReportRequest(BaseModel):
    report_type: str
    object_id: UUID | None = None
    linked_entity_type: str | None = None
    linked_entity_id: UUID | None = None
    overall_condition: str | None = None
    examiner_name: str | None = None
    condition_summary: str | None = None
    detailed_findings: str | None = None
    hazards: str | None = None
    recommendations: str | None = None
    conservation_needed: bool = False
    conservation_priority: str | None = None
    handling_requirements: str | None = None
    packing_requirements: str | None = None
    display_restrictions: str | None = None
    report_note: str | None = None


class UpdateConditionReportRequest(BaseModel):
    """All fields optional — only provided fields are updated."""
    report_type: str | None = None
    check_reason: str | None = None
    completeness: str | None = None
    completeness_date: str | None = None
    next_check_date: str | None = None
    object_id: UUID | None = None
    linked_entity_type: str | None = None
    linked_entity_id: UUID | None = None
    overall_condition: str | None = None
    examiner_name: str | None = None
    condition_summary: str | None = None
    detailed_findings: str | None = None
    hazards: str | None = None
    recommendations: str | None = None
    conservation_needed: bool | None = None
    conservation_priority: str | None = None
    handling_requirements: str | None = None
    packing_requirements: str | None = None
    display_restrictions: str | None = None
    report_note: str | None = None
    status: str | None = None
    authorizer_id: UUID | None = None
    authorization_date: str | None = None
    authorization_note: str | None = None
