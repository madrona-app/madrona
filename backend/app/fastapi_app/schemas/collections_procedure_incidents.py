"""Pydantic response schemas for procedure incidents endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class IncidentObjectOut(BaseModel):
    incident_object_id: str
    report_id: str
    object_id: str
    damage_description: str | None = None
    damage_extent: str | None = None
    condition_before: str | None = None
    condition_after: str | None = None
    condition_report_id: str | None = None
    treatment_id: str | None = None
    estimated_loss_value: float | None = None
    estimated_loss_currency: str | None = None
    recovered: bool | None = None
    recovered_date: str | None = None
    recovery_note: str | None = None
    created_at: str | None = None
    object: Any = None


class IncidentReportOut(BaseModel):
    report_id: str
    organization_id: str
    report_number: str | None = None
    report_date: str | None = None
    incident_type: str | None = None
    incident_subtype: str | None = None
    incident_date: str | None = None
    incident_date_approximate: bool | None = None
    incident_location_id: str | None = None
    incident_location_description: str | None = None
    discovered_date: str | None = None
    discovered_by: str | None = None
    discovered_by_name: str | None = None
    discovery_circumstances: str | None = None
    incident_description: str | None = None
    cause_analysis: str | None = None
    contributing_factors: Any = None
    immediate_actions: str | None = None
    police_notified: bool | None = None
    police_report_number: str | None = None
    police_report_date: str | None = None
    police_contact: str | None = None
    police_note: str | None = None
    insurance_claim_filed: bool | None = None
    insurance_claim_number: str | None = None
    insurance_claim_date: str | None = None
    insurance_adjuster: str | None = None
    insurance_claim_status: str | None = None
    insurance_claim_amount: float | None = None
    insurance_settlement_amount: float | None = None
    insurance_currency: str | None = None
    insurance_note: str | None = None
    director_notified: bool | None = None
    director_notified_date: str | None = None
    board_notified: bool | None = None
    board_notified_date: str | None = None
    investigation_required: bool | None = None
    investigation_lead: str | None = None
    investigation_findings: str | None = None
    investigation_completed_date: str | None = None
    resolution_summary: str | None = None
    resolved_date: str | None = None
    lessons_learned: str | None = None
    preventive_actions: Any = None
    image_references: Any = None
    document_references: Any = None
    status: str | None = None
    assigned_to_user_id: str | None = None
    report_note: str | None = None
    internal_note: str | None = None
    created_by: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    affected_objects: list[IncidentObjectOut] | None = None


class IncidentReportListResponse(BaseModel):
    items: list[IncidentReportOut]
    total: int
    limit: int
    offset: int
