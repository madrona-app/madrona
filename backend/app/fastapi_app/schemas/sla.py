"""Pydantic response models for SLA endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class SLAPolicyOut(BaseModel):
    policy_id: str
    organization_id: str
    workflow_type: str
    name: str
    warning_days: int
    deadline_days: int
    critical_days: int
    escalate_to_role: str | None = None
    notify_assignee: bool
    enabled: bool
    created_at: str | None = None
    updated_at: str | None = None


class SLAPolicyListResponse(BaseModel):
    policies: list[SLAPolicyOut]


class SLAEventOut(BaseModel):
    event_id: str
    policy_id: str
    workflow_type: str
    record_id: str
    event_type: str
    days_elapsed: int | None = None
    notified_user_ids: Any | None = None
    triggered_at: str | None = None


class SLAStatusSummary(BaseModel):
    ok: int
    warning: int
    breach: int
    critical: int


class SLAStatusResponse(BaseModel):
    records: list[Any]
    summary: SLAStatusSummary
    total: int


class SLAEventListResponse(BaseModel):
    items: list[SLAEventOut]
    total: int
    limit: int
    offset: int
