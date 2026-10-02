"""Pydantic response schemas for checklist endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


# ============================================================================
# Template item
# ============================================================================

class ChecklistTemplateItemOut(BaseModel):
    template_item_id: str
    phase: str
    phase_label: str
    title: str
    description: str | None = None
    responsible_role: str
    responsible_role_label: str
    default_due_offset_days: int | None = None
    sort_order: int
    is_required: bool


# ============================================================================
# Version
# ============================================================================

class ChecklistTemplateVersionOut(BaseModel):
    version_id: str
    template_id: str
    version_number: int
    is_published: bool
    is_locked: bool
    change_notes: str | None = None
    created_at: str | None = None
    created_by: str | None = None
    items: list[ChecklistTemplateItemOut] | None = None
    item_count: int | None = None


# ============================================================================
# Template
# ============================================================================

class ChecklistTemplateOut(BaseModel):
    template_id: str
    name: str
    description: str | None = None
    exhibition_type: str | None = None
    is_archived: bool
    created_at: str | None = None
    created_by: str | None = None
    versions: list[ChecklistTemplateVersionOut] | None = None
    published_version_id: str | None = None
    published_version_number: int | None = None


class ChecklistTemplateListResponse(BaseModel):
    templates: list[ChecklistTemplateOut]


class ChecklistTemplateWrapperResponse(BaseModel):
    template: ChecklistTemplateOut


class ChecklistVersionWrapperResponse(BaseModel):
    version: ChecklistTemplateVersionOut


class ChecklistTemplateItemWrapperResponse(BaseModel):
    item: ChecklistTemplateItemOut


# ============================================================================
# Checklist item link
# ============================================================================

class ChecklistItemLinkOut(BaseModel):
    link_id: str
    linked_entity_type: str
    linked_entity_id: str


# ============================================================================
# Checklist item
# ============================================================================

class ChecklistItemOut(BaseModel):
    item_id: str
    checklist_id: str
    source_template_item_id: str | None = None
    phase: str
    phase_label: str
    title: str
    description: str | None = None
    responsible_role: str
    responsible_role_label: str
    assigned_user_id: str | None = None
    due_date: str | None = None
    status: str
    status_label: str
    notes: str | None = None
    sort_order: int
    completed_at: str | None = None
    completed_by: str | None = None
    links: list[ChecklistItemLinkOut] = []
    links_count: int | None = None


class ChecklistItemWrapperResponse(BaseModel):
    item: ChecklistItemOut


# ============================================================================
# Exhibition checklist
# ============================================================================

class ExhibitionChecklistOut(BaseModel):
    checklist_id: str
    exhibition_id: str
    template_version_id: str | None = None
    name: str
    created_at: str | None = None
    created_by: str | None = None
    items: list[ChecklistItemOut] | None = None
    item_count: int | None = None
    status_summary: dict[str, int] | None = None


class ExhibitionChecklistWrapperResponse(BaseModel):
    checklist: ExhibitionChecklistOut | None = None


class ChecklistItemLinkWrapperResponse(BaseModel):
    link: ChecklistItemLinkOut


class ChecklistItemLinksListResponse(BaseModel):
    links: list[ChecklistItemLinkOut]


# ============================================================================
# Enums
# ============================================================================

class EnumValueLabel(BaseModel):
    value: str
    label: str


class ChecklistEnumsResponse(BaseModel):
    phases: list[EnumValueLabel]
    roles: list[EnumValueLabel]
    statuses: list[EnumValueLabel]
    exhibition_types: list[str]
    link_entity_types: list[str]
