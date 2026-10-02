"""Pydantic response models for entities endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class EntityTypeOut(BaseModel):
    entity_type: str
    count: int


class EntityTypeListResponse(BaseModel):
    organization_id: str
    entity_types: list[EntityTypeOut]


class EntitySummaryOut(BaseModel):
    entity_key: str
    entity_type: str | None = None
    dataset_id: str | None = None
    source_system: str | None = None
    title: str | None = None
    object_number: str | None = None
    modified_at: str | None = None
    thumbnail_url: str | None = None
    canonical_url: str | None = None
    last_seen_at: str | None = None
    last_run_id: str | None = None
    payload: Any | None = None


class DisplayProfile(BaseModel):
    primary_field: str
    secondary_field: str
    thumbnail_field: str


class EntityListResponse(BaseModel):
    organization_id: str
    entity_type: str | None = None
    display: DisplayProfile
    items: list[EntitySummaryOut]
    limit: int
    offset: int
    total: int


class FieldDiffOut(BaseModel):
    field_name: str
    old_value: Any | None = None
    new_value: Any | None = None
    array_delta: Any | None = None


class HistoryEventOut(BaseModel):
    change_id: str
    occurred_at: str
    event_type: str
    origin_type: str
    source_label: str | None = None
    pipeline_name: str | None = None
    dataset_name: str | None = None
    run_id: str | None = None
    changed_fields: Any | None = None
    old_hash: str | None = None
    new_hash: str | None = None
    summary: str | None = None
    field_diffs: list[FieldDiffOut]


class EntityHistoryResponse(BaseModel):
    entity_key: str
    items: list[HistoryEventOut]
    next_cursor: str | None = None
    has_more: bool
    total: int


class EntityFieldsOut(BaseModel):
    title: str | None = None
    object_number: str | None = None
    modified_at: str | None = None
    thumbnail_url: str | None = None


class EntityDetailResponse(BaseModel):
    entity_key: str
    entity_type: str | None = None
    dataset_id: str | None = None
    source_system: str | None = None
    source_id: str | None = None
    canonical_url: str | None = None
    payload: Any | None = None
    payload_hash: str | None = None
    extracted_at: str | None = None
    last_seen_at: str | None = None
    last_run_id: str | None = None
    is_deleted: bool
    deleted_at: str | None = None
    fields: EntityFieldsOut


class ChangeEventOut(BaseModel):
    change_id: str
    occurred_at: str
    entity_key: str
    entity_type: str | None = None
    change_type: str
    applied: bool | None = None
    changed_fields: Any | None = None
    old_hash: str | None = None
    new_hash: str | None = None
    summary: str | None = None
    error_code: str | None = None
    error_message: str | None = None
    pipeline_name: str | None = None
    dataset_name: str | None = None
    field_diffs: list[FieldDiffOut]


class RunChangesResponse(BaseModel):
    items: list[ChangeEventOut]
    limit: int
    offset: int
    total: int
