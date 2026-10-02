"""Pydantic response schemas for info-requests endpoints."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class EnumItem(BaseModel):
    value: str
    label: str


# ---------------------------------------------------------------------------
# Template
# ---------------------------------------------------------------------------

class InfoRequestTemplateItemOut(BaseModel):
    template_item_id: str
    request_type: str | None = None
    request_type_label: str | None = None
    title: str | None = None
    description: str | None = None
    default_source_party: str | None = None
    default_due_offset_days: int | None = None
    is_required: bool = True
    sort_order: int = 0


class InfoRequestTemplateOut(BaseModel):
    template_id: str
    name: str | None = None
    description: str | None = None
    exhibition_type: str | None = None
    is_archived: bool = False
    item_count: int = 0
    created_at: str | None = None
    created_by: str | None = None
    items: list[InfoRequestTemplateItemOut] | None = None


class TemplateListResponse(BaseModel):
    templates: list[InfoRequestTemplateOut]


class TemplateResponse(BaseModel):
    template: InfoRequestTemplateOut


class TemplateItemResponse(BaseModel):
    item: InfoRequestTemplateItemOut


# ---------------------------------------------------------------------------
# Info Request Document
# ---------------------------------------------------------------------------

class InfoRequestDocumentOut(BaseModel):
    link_id: str
    media_id: str
    label: str | None = None
    created_at: str | None = None


# ---------------------------------------------------------------------------
# Exhibition Info Request
# ---------------------------------------------------------------------------

class ExhibitionInfoRequestOut(BaseModel):
    request_id: str
    exhibition_id: str
    source_template_item_id: str | None = None
    request_type: str | None = None
    request_type_label: str | None = None
    title: str | None = None
    description: str | None = None
    status: str | None = None
    status_label: str | None = None
    source_party: str | None = None
    due_date: str | None = None
    notes: str | None = None
    is_required: bool = True
    sort_order: int = 0
    received_at: str | None = None
    received_by: str | None = None
    approved_at: str | None = None
    approved_by: str | None = None
    documents: list[InfoRequestDocumentOut] | None = None
    document_count: int = 0
    created_at: str | None = None
    updated_at: str | None = None


class InfoRequestSummary(BaseModel):
    total: int
    received: int
    approved: int
    missing: int
    overdue: int
    incomplete: int


class InfoRequestListResponse(BaseModel):
    info_requests: list[ExhibitionInfoRequestOut]
    summary: InfoRequestSummary


class InfoRequestResponse(BaseModel):
    info_request: ExhibitionInfoRequestOut


class InfoRequestBulkCreateResponse(BaseModel):
    info_requests: list[ExhibitionInfoRequestOut]
    count: int


class InfoRequestDocumentResponse(BaseModel):
    document: InfoRequestDocumentOut


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class InfoRequestEnumsResponse(BaseModel):
    request_types: list[EnumItem]
    statuses: list[EnumItem]
    source_parties: list[EnumItem]
