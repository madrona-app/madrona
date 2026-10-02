"""Pydantic request/response models for runs, jobs, and datasets endpoints."""

from __future__ import annotations

from typing import Any

from uuid import UUID

from pydantic import BaseModel, Field


class CreateRunBody(BaseModel):
    pipeline_id: UUID
    triggered_by: str = "api"
    parameters: dict = {}
    force_full_sync: bool = False


class CreateDatasetBody(BaseModel):
    organization_id: UUID
    name: str
    key: str
    description: str | None = None
    source_type: str | None = None
    schema_def: dict | None = Field(None, alias="schema")


class UpdateDatasetBody(BaseModel):
    name: str | None = None
    description: str | None = None


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class RunCountsOut(BaseModel):
    processed: int = 0
    created: int = 0
    updated: int = 0
    noop: int = 0
    failed: int = 0
    deleted: int = 0


class RunSummaryOut(BaseModel):
    run_id: str
    pipeline_id: str | None = None
    target_connector_instance_id: str | None = None
    status: str
    started_at: str | None = None
    finished_at: str | None = None
    published_at: str | None = None
    duration_ms: int | None = None
    counts: RunCountsOut


class RunListResponse(BaseModel):
    items: list[RunSummaryOut]
    total: int
    limit: int
    offset: int


class StepOut(BaseModel):
    step_id: str
    pipeline_source_id: str | None = None
    pipeline_destination_id: str | None = None
    connector_instance_id: str | None = None
    status: str | None = None
    counts: Any | None = None
    error: str | None = None
    started_at: str | None = None
    finished_at: str | None = None


class RunDetailOut(BaseModel):
    run_id: str
    pipeline_id: str | None = None
    target_connector_instance_id: str | None = None
    status: str
    started_at: str | None = None
    published_at: str | None = None
    finished_at: str | None = None
    duration_ms: int | None = None
    counts: RunCountsOut
    parameters: Any | None = None
    error: str | None = None
    error_stage: str | None = None
    error_at: str | None = None
    target_url: str | None = None
    sources: list[StepOut] | None = None
    destinations: list[StepOut] | None = None
    run_status: str | None = None


class RunCreateResponse(BaseModel):
    run_id: str
    pipeline_id: str
    target_connector_instance_id: str | None = None
    organization_id: str
    status: str
    triggered_by: str | None = None
    parameters: Any | None = None
    created_at: str
    warning: str | None = None


class RunExecuteResponse(RunDetailOut):
    pass


class RetryDestinationResponse(BaseModel):
    step_id: str
    status: str
    counts: Any | None = None
    error: str | None = None


class ScheduleOut(BaseModel):
    schedule_id: str
    enabled: bool
    every_n: int | None = None
    unit: str | None = None
    timezone: str | None = None


class PipelineSummaryOut(BaseModel):
    pipeline_id: str
    name: str


class JobOut(BaseModel):
    job_id: str
    organization_id: str
    schedule_id: str | None = None
    pipeline_id: str | None = None
    status: str
    scheduled_for: str | None = None
    started_at: str | None = None
    finished_at: str | None = None
    attempt: int | None = None
    error: str | None = None
    run_id: str | None = None
    created_at: str
    updated_at: str | None = None
    run_status: str | None = None
    schedule: ScheduleOut | None = None
    pipeline: PipelineSummaryOut | None = None


class JobListResponse(BaseModel):
    items: list[JobOut]
    total: int
    limit: int


class DatasetOut(BaseModel):
    dataset_id: str
    organization_id: str
    name: str
    key: str
    description: str | None = None
    source_type: str | None = None
    schema_: Any | None = Field(None, alias="schema")
    role: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    entity_count: int | None = None

    class Config:
        populate_by_name = True


class DatasetListResponse(BaseModel):
    items: list[DatasetOut]
    total: int
    limit: int
    offset: int


class SampleRecordOut(BaseModel):
    entity_key: str
    entity_type: str | None = None
    title: str | None = None
    object_number: str | None = None
    thumbnail_url: str | None = None
    modified_at: str | None = None
    last_seen_at: str | None = None


class DatasetPreviewResponse(BaseModel):
    dataset_id: str
    name: str
    key: str
    description: str | None = None
    source_type: str | None = None
    schema_: Any | None = Field(None, alias="schema")
    sample_records: list[SampleRecordOut]
    total_records: int
    sample_count: int

    class Config:
        populate_by_name = True


class SchemaRefOut(BaseModel):
    schema_id: str
    schema_version: str
    schema_definition: Any = Field(alias="schema_json")


class DatasetSchemaResponse(BaseModel):
    dataset_id: str
    schema_ref: SchemaRefOut
