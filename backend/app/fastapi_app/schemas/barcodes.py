"""Pydantic request and response schemas for barcode endpoints."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from pydantic import BaseModel, field_validator


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class CreateLabelRequest(BaseModel):
    entity_type: str
    entity_id: UUID
    label_format: str = "code128"
    barcode_value: str | None = None
    department_id: UUID | None = None
    note: str | None = None


class BatchLabelEntry(BaseModel):
    entity_type: str
    entity_id: UUID


class CreateLabelsBatchRequest(BaseModel):
    entries: list[BatchLabelEntry]
    label_format: str = "code128"
    department_id: UUID | None = None

    @field_validator('entries')
    @classmethod
    def entries_not_empty(cls, v: list[BatchLabelEntry]) -> list[BatchLabelEntry]:
        if not v:
            raise ValueError('entries list must not be empty')
        return v


class UpdateLabelRequest(BaseModel):
    status: str | None = None
    note: str | None = None
    label_format: str | None = None


class PerformScanRequest(BaseModel):
    barcode_value: str
    action_type: str = "lookup"
    scan_location_id: UUID | None = None
    # The handler always read these five; they were missing from the schema, so
    # they were both undocumented and unreachable — and reading them off the
    # model with .get() raised AttributeError, failing every scan.
    department_id: UUID | None = None
    device_id: str | None = None
    device_name: str | None = None
    campaign_id: UUID | None = None
    note: str | None = None

    @field_validator('barcode_value')
    @classmethod
    def barcode_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError('Barcode value is required')
        return v


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------


class EntitySummaryOut(BaseModel):
    object_number: str | None = None
    title: str | None = None
    part_name: str | None = None
    name: str | None = None
    code: str | None = None


class BarcodeLabelOut(BaseModel):
    label_id: str
    organization_id: str
    department_id: str | None = None
    entity_type: str
    entity_type_label: str
    entity_id: str
    barcode_value: str
    label_format: str
    label_format_label: str
    is_printed: bool
    print_count: int
    last_printed_at: str | None = None
    batch_id: str | None = None
    status: str
    status_label: str
    note: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    created_by: str | None = None
    updated_by: str | None = None
    entity_summary: Any = None
    public_url: str | None = None


class LabelsSummary(BaseModel):
    total_active: int
    total_void: int
    total_printed: int
    total_unprinted: int


class BarcodeLabelListResponse(BaseModel):
    items: list[BarcodeLabelOut]
    summary: LabelsSummary
    total: int
    limit: int
    offset: int


class BarcodeLabelBatchResponse(BaseModel):
    labels: list[BarcodeLabelOut]
    batch_id: str
    count: int


class BarcodeScanOut(BaseModel):
    scan_id: str
    organization_id: str
    department_id: str | None = None
    barcode_value: str
    resolved_entity_type: str | None = None
    resolved_entity_type_label: str | None = None
    resolved_entity_id: str | None = None
    action_type: str
    action_type_label: str
    scan_location_id: str | None = None
    device_id: str | None = None
    device_name: str | None = None
    campaign_id: str | None = None
    movement_id: str | None = None
    result_status: str
    result_status_label: str
    note: str | None = None
    scanned_at: str | None = None
    scanned_by: str | None = None
    entity_summary: Any = None
    action_detail: Any = None


class BarcodeScanListResponse(BaseModel):
    items: list[BarcodeScanOut]
    total: int
    limit: int
    offset: int


class BarcodeLookupResponse(BaseModel):
    found: bool
    barcode_value: str
    entity_type: str
    entity_type_label: str
    entity_id: str
    entity_summary: Any = None


class BarcodeStatsResponse(BaseModel):
    labels_active: int
    labels_void: int
    scans_today: int
    scans_this_week: int
    unresolved_count: int


class EnumValueLabel(BaseModel):
    value: str
    label: str


class BarcodeEnumsResponse(BaseModel):
    entity_types: list[EnumValueLabel]
    label_formats: list[EnumValueLabel]
    label_statuses: list[EnumValueLabel]
    action_types: list[EnumValueLabel]
    result_statuses: list[EnumValueLabel]
