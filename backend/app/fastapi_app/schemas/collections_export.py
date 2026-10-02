"""Pydantic response schemas for collection export endpoints."""

from __future__ import annotations

from pydantic import BaseModel


class ExportColumnOut(BaseModel):
    """Represents an export column definition."""
    field: str
    label: str


class ExportColumnsResponse(BaseModel):
    record_type: str
    columns: list[ExportColumnOut]


class RecordTypeOut(BaseModel):
    """A supported record type."""
    key: str
    label: str


class ExportRecordTypesResponse(BaseModel):
    record_types: list[RecordTypeOut]
