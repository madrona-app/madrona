"""Pydantic response models for work tasks endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class WorkTaskOut(BaseModel):
    id: str
    type: str
    title: str
    record_type: str
    record_id: str
    record_number: str | None = None
    priority: str
    due_date: str | None = None
    assigned_at: str | None = None
    status: str | None = None
    # Optional fields that vary by record type
    object_id: str | None = None
    accession_number: str | None = None
    object_title: str | None = None
    object_count: int | None = None
    assigned_to_user_id: str | None = None
    assigned_to_name: str | None = None


class PriorityCountsOut(BaseModel):
    urgent: int
    high: int
    normal: int
    low: int


class PageInfoOut(BaseModel):
    limit: int
    offset: int
    has_more: bool


class WorkTaskListResponse(BaseModel):
    items: list[WorkTaskOut]
    total: int
    counts: PriorityCountsOut
    page: PageInfoOut


class TaskCountResponse(BaseModel):
    count: int
    urgent: int


class AssignTaskResponse(BaseModel):
    success: bool = True
    assigned_to_user_id: str | None = None
    assigned_to_name: str | None = None


class AssignableUserOut(BaseModel):
    user_id: str
    name: str
    email: str


class AssignableUsersResponse(BaseModel):
    users: list[AssignableUserOut]
