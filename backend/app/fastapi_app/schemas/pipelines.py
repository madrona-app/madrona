"""Pydantic request/response models for pipeline endpoints."""
from __future__ import annotations

from typing import Any

from uuid import UUID

from pydantic import BaseModel


class PipelineSourceBody(BaseModel):
    connector_instance_id: UUID
    enabled: bool = True
    parameters: dict | None = None
    ordering: int = 0


class PipelineDestinationBody(BaseModel):
    connector_instance_id: UUID
    enabled: bool = True
    parameters: dict | None = None
    ordering: int = 0
    publish_deletes: bool = False
    delete_strategy: str | None = None


class CreatePipelineBody(BaseModel):
    organization_id: UUID
    dataset_id: UUID | None = None
    status: str = "active"
    sources: list[PipelineSourceBody]
    destinations: list[PipelineDestinationBody] = []


class UpdatePipelineBody(BaseModel):
    organization_id: UUID | None = None
    dataset_id: UUID | None = None
    status: str | None = None
    sources: list[PipelineSourceBody] | None = None
    destinations: list[PipelineDestinationBody] | None = None


class CreateScheduleBody(BaseModel):
    type: str = "interval"
    every_n: int | None = None
    unit: str | None = None
    time_hour: int | None = None
    time_minute: int | None = None
    timezone: str | None = None
    enabled: bool = False


class UpdateScheduleBody(BaseModel):
    type: str | None = None
    every_n: int | None = None
    unit: str | None = None
    time_hour: int | None = None
    time_minute: int | None = None
    timezone: str | None = None
    enabled: bool | None = None


# ============================================================================
# Response schemas
# ============================================================================

class PipelineSourceOut(BaseModel):
    source_id: str
    connector_instance_id: str
    enabled: bool
    parameters: Any = None
    ordering: int


class PipelineDestinationOut(BaseModel):
    destination_id: str
    connector_instance_id: str
    enabled: bool
    parameters: Any = None
    ordering: int


class PipelineOut(BaseModel):
    pipeline_id: str
    organization_id: str
    name: str | None = None
    sources: list[PipelineSourceOut]
    destinations: list[PipelineDestinationOut]
    dataset_id: str | None = None
    status: str | None = None
    created_at: str


class LastJobOut(BaseModel):
    job_id: str
    status: str | None = None
    scheduled_for: str | None = None
    run_id: str | None = None
    created_at: str
    completed_at: str | None = None


class ScheduleWithNextRun(BaseModel):
    schedule_id: str
    pipeline_id: str
    enabled: bool
    type: str
    every_n: int | None = None
    unit: str | None = None
    time_hour: int | None = None
    time_minute: int | None = None
    timezone: str | None = None
    created_at: str
    updated_at: str
    next_run_at: str | None = None
    last_job: LastJobOut | None = None


class ScheduleOut(BaseModel):
    schedule_id: str
    pipeline_id: str
    enabled: bool
    type: str
    every_n: int | None = None
    unit: str | None = None
    time_hour: int | None = None
    time_minute: int | None = None
    timezone: str | None = None
    created_at: str
    updated_at: str


class PipelineScheduleResponse(BaseModel):
    schedule: ScheduleWithNextRun | None = None
