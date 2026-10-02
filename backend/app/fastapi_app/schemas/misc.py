"""
Pydantic request models for notifications, discussions, lookups, audit logs, and tasks.
"""

from uuid import UUID

from pydantic import BaseModel, Field


class CreateCommentBody(BaseModel):
    content: str
    kind: str = "user"


class CreateLookupValueBody(BaseModel):
    label: str
    value_key: str
    description: str | None = None
    icon_name: str | None = None
    sort_order: int = 0


class UpdateLookupValueBody(BaseModel):
    label: str | None = None
    description: str | None = None
    icon_name: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class HideValueBody(BaseModel):
    hidden: bool


class SortOrderBody(BaseModel):
    value_ids: list[str]


class CreateTaskBody(BaseModel):
    title: str = Field(..., max_length=255)
    description: str | None = None
    status: str = "todo"
    priority: str = "normal"
    assigned_user_id: str | None = None
    due_date: str | None = None
    related_entity_type: str | None = None
    related_entity_id: str | None = None
    app_context: str | None = None


class UpdateTaskBody(BaseModel):
    title: str | None = None
    description: str | None = None
    status: str | None = None
    priority: str | None = None
    assigned_user_id: str | None = None
    due_date: str | None = None
    related_entity_type: str | None = None
    related_entity_id: str | None = None


# Phase 7b schemas — Search, Autocomplete, Work Tasks

class AutocompleteSearchBody(BaseModel):
    query: str
    field_type: str
    organization_id: str
    limit: int = 10
    sources: list[str] | None = None


class SelectSuggestionBody(BaseModel):
    suggestion_id: str
    vocabulary: str | None = None
    label: str
    description: str | None = None
    external_uri: str | None = None
    organization_id: str | None = None
    applicable_fields: list[str] | None = None


class AssignTaskBody(BaseModel):
    assigned_to_user_id: str | None = None


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

from typing import Any


class LookupCategoryOut(BaseModel):
    category_id: str
    category_key: str
    display_name: str
    description: str | None = None
    applicable_contexts: list[str]
    supports_icons: bool


class LookupValueOut(BaseModel):
    value_id: str
    category_id: str
    organization_id: str | None = None
    value_key: str
    label: str
    description: str | None = None
    icon_name: str | None = None
    sort_order: int
    is_active: bool
    is_hidden: bool
    is_system: bool


class LookupCategoryWithValuesOut(LookupCategoryOut):
    values: list[LookupValueOut]


class CategoryValuesResponse(BaseModel):
    category: LookupCategoryOut
    values: list[LookupValueOut]


class HideValueResponse(BaseModel):
    message: str
    hidden: bool


class SortOrderResponse(BaseModel):
    message: str
    count: int


class AuditLogOut(BaseModel):
    audit_log_id: str
    organization_id: str
    acting_user_id: str
    target_user_id: str | None = None
    action: str
    details: Any | None = None
    created_at: str


class PageInfoOut(BaseModel):
    limit: int
    offset: int
    has_more: bool


class AuditLogListResponse(BaseModel):
    items: list[AuditLogOut]
    total: int
    page: PageInfoOut


class PlatformAuditLogOut(AuditLogOut):
    organization_name: str | None = None
    acting_user_email: str | None = None


class PlatformAuditLogListResponse(BaseModel):
    items: list[PlatformAuditLogOut]
    total: int
    page: PageInfoOut


class EntityAuditEventOut(BaseModel):
    event_id: str
    organization_id: str
    entity_type: str | None = None
    entity_id: str
    entity_display_key: str | None = None
    change_type: str | None = None
    changed_at: str | None = None
    changed_by: str | None = None
    changed_by_name: str | None = None
    changed_by_email: str | None = None
    changed_fields: Any | None = None
    summary: str | None = None


class EntityAuditEventListResponse(BaseModel):
    items: list[EntityAuditEventOut]
    total: int
    limit: int
    offset: int


class EntityAuditFieldDiffOut(BaseModel):
    diff_id: str
    field_name: str
    old_value: Any | None = None
    new_value: Any | None = None


class EntityAuditEventDetailOut(EntityAuditEventOut):
    field_diffs: list[EntityAuditFieldDiffOut]


class EntityAuditEventDetailResponse(BaseModel):
    event: EntityAuditEventDetailOut


class TaskOut(BaseModel):
    task_id: str
    organization_id: str
    title: str
    description: str | None = None
    status: str
    status_label: str
    priority: str
    priority_label: str
    assigned_user_id: str | None = None
    assigned_user_name: str | None = None
    due_date: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    completed_at: str | None = None
    created_by: str | None = None
    created_by_name: str | None = None
    completed_by: str | None = None
    app_context: str | None = None
    related_entity_type: str | None = None
    related_entity_id: str | None = None
    related_entity_label: str | None = None


class TaskListResponse(BaseModel):
    items: list[TaskOut]
    total: int
    limit: int
    offset: int


class TaskEnumItem(BaseModel):
    value: str
    label: str


class TaskEnumsResponse(BaseModel):
    statuses: list[TaskEnumItem]
    priorities: list[TaskEnumItem]
    related_entity_types: list[str]


class TaskWrapperResponse(BaseModel):
    task: TaskOut
