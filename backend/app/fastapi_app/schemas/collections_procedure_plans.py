"""Pydantic response schemas for procedure plans endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class DocumentationPlanOut(BaseModel):
    plan_id: str
    organization_id: str
    plan_number: str | None = None
    title: str
    plan_type: str | None = None
    scope_description: str | None = None
    target_collections: Any = None
    target_object_types: Any = None
    priority_criteria: Any = None
    objectives: str | None = None
    measurable_results: Any = None
    actions: Any = None
    milestones: Any = None
    resources_required: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    review_frequency: str | None = None
    next_review_date: str | None = None
    last_review_date: str | None = None
    review_notes: str | None = None
    proposed_by: str | None = None
    proposed_date: str | None = None
    status: str | None = None
    approved_by: str | None = None
    approved_at: str | None = None
    approval_note: str | None = None
    completion_date: str | None = None
    notes: str | None = None
    internal_note: str | None = None
    created_by: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class DocumentationPlanListResponse(BaseModel):
    items: list[DocumentationPlanOut]
    total: int
    limit: int
    offset: int


class EmergencyPlanOut(BaseModel):
    plan_id: str
    organization_id: str
    plan_number: str | None = None
    title: str
    plan_version: str | None = None
    facility_name: str | None = None
    facility_address: str | None = None
    covered_locations: Any = None
    risk_assessments: Any = None
    emergency_contacts: Any = None
    external_services: Any = None
    evacuation_routes: Any = None
    assembly_points: Any = None
    evacuation_procedures: Any = None
    site_plan_references: Any = None
    floor_plan_references: Any = None
    equipment_inventory: Any = None
    salvage_priority_guidance: Any = None
    response_procedures: Any = None
    recovery_procedures: Any = None
    training_requirements: Any = None
    last_drill_date: str | None = None
    next_drill_date: str | None = None
    effective_date: str | None = None
    review_frequency: str | None = None
    next_review_date: str | None = None
    last_review_date: str | None = None
    status: str | None = None
    approved_by: str | None = None
    approval_date: str | None = None
    plan_note: str | None = None
    created_by: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class EmergencyPlanListResponse(BaseModel):
    items: list[EmergencyPlanOut]
    total: int
    limit: int
    offset: int
