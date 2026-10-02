"""Pydantic response schemas for the Customer (Bridge data) and Visitor APIs."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel


# ============================================================================
# Customer / Datasets
# ============================================================================

class DatasetSummaryOut(BaseModel):
    dataset_id: str
    name: str | None = None
    description: str | None = None
    entity_count: int
    created_at: str
    updated_at: str | None = None


class DatasetListResponse(BaseModel):
    items: list[DatasetSummaryOut]
    total: int
    limit: int
    offset: int


class EntityOut(BaseModel):
    entity_key: str | None = None
    dataset_id: str | None = None
    source_system: str | None = None
    source_id: str | None = None
    entity_type: str | None = None
    payload: Any = None
    extracted_at: str | None = None
    updated_at: str | None = None


class EntityListResponse(BaseModel):
    items: list[EntityOut]
    total: int
    limit: int
    offset: int


class ChangeEventOut(BaseModel):
    change_id: str
    entity_key: str | None = None
    run_id: str
    change_type: str | None = None
    changed_fields: Any = None
    summary: str | None = None
    occurred_at: str | None = None


class ChangeEventListResponse(BaseModel):
    items: list[ChangeEventOut]
    total: int
    limit: int
    offset: int


class RunSummaryOut(BaseModel):
    run_id: str
    dataset_id: str
    status: str | None = None
    started_at: str | None = None
    finished_at: str | None = None
    created_at: str


class RunListResponse(BaseModel):
    items: list[RunSummaryOut]
    total: int
    limit: int
    offset: int


class ExecuteRunResponse(BaseModel):
    run_id: str
    status: str
    duration_ms: int | None = None
    counts: Any = None
    target_url: str | None = None
    error: str | None = None
    error_stage: str | None = None



class ConversionInfo(BaseModel):
    organization_id: str
    organization_name: str
    organization_slug: str
    contract_id: str
    mode: str
    admin_user_id: str | None = None
    welcome_email_sent: bool | None = None


# ============================================================================
# Visitor
# ============================================================================

class VisitorIdentifyResponse(BaseModel):
    visitor_id: str
    email: str | None = None
    display_name: str | None = None
    locale: str | None = None


class VisitorProfileResponse(BaseModel):
    """Visitor profile, dynamic fields from service."""
    visitor_id: str | None = None
    email: str | None = None
    display_name: str | None = None
    locale: str | None = None
    session_token: str | None = None
    visit_count: int | None = None
    interaction_count: int | None = None
    first_visit: str | None = None
    last_visit: str | None = None
    recent_interactions: list[Any] = []


class InteractionRecordResponse(BaseModel):
    interaction_id: str
    visit_id: str
