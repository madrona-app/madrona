"""Pydantic response schemas for Workspaces API."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel


# ============================================================================
# Workspace List / Detail
# ============================================================================

class WorkspaceSummaryOut(BaseModel):
    workspace_id: str
    workspace_type: str
    name: str
    description: str | None = None
    visibility: str
    owner_user_id: str
    owner_name: str | None = None
    is_owner: bool
    is_dynamic: bool | None = None
    object_count: int | None = None
    asset_count: int | None = None
    item_count: int
    cover_media_id: str | None = None
    cover_thumbnail_url: str | None = None
    created_at: str
    updated_at: str


class WorkspaceListResponse(BaseModel):
    items: list[WorkspaceSummaryOut]
    total: int
    limit: int
    offset: int


class WorkspaceCreateResponse(BaseModel):
    workspace_id: str
    workspace_type: str
    name: str
    description: str | None = None
    visibility: str
    is_owner: bool
    is_dynamic: bool = False
    created_at: str
    object_count: int | None = None
    asset_count: int | None = None


class WorkspaceDetailOut(BaseModel):
    workspace_id: str
    workspace_type: str
    name: str
    description: str | None = None
    visibility: str
    owner_user_id: str
    owner_name: str | None = None
    is_owner: bool
    permission_level: str
    is_dynamic: bool | None = None
    dynamic_query: Any = None
    search_unavailable: bool | None = None
    pinned_count: int | None = None
    dynamic_count: int | None = None
    items: list[Any]
    object_count: int | None = None
    asset_count: int | None = None
    item_count: int | None = None
    cover_media_id: str | None = None
    cover_thumbnail_url: str | None = None
    created_at: str
    updated_at: str


class WorkspaceUpdateResponse(BaseModel):
    workspace_id: str
    workspace_type: str
    name: str
    description: str | None = None
    visibility: str
    updated_at: str
    cover_media_id: str | None = None


# ============================================================================
# Workspace Items
# ============================================================================

class WorkspaceItemListResponse(BaseModel):
    items: list[Any]
    total: int
    limit: int
    offset: int
    pinned_count: int | None = None
    dynamic_count: int | None = None
    search_unavailable: bool | None = None


class WorkspaceAddItemsResponse(BaseModel):
    added: list[str]
    skipped: list[str]
    added_count: int


class WorkspaceRemoveItemsResponse(BaseModel):
    removed_count: int


class WorkspacePinResponse(BaseModel):
    workspace_item_id: str
    object_id: str
    already_pinned: bool


# ============================================================================
# Shares
# ============================================================================

class ShareOut(BaseModel):
    share_id: str
    principal_type: str
    principal_id: str
    permission: str
    created_at: str
    principal_name: str | None = None
    principal_email: str | None = None


class ShareListResponse(BaseModel):
    shares: list[ShareOut]


class ShareCreateResponse(BaseModel):
    share_id: str
    created: bool | None = None
    updated: bool | None = None


# ============================================================================
# Active Context
# ============================================================================

class ActiveContextResponse(BaseModel):
    context: Any = None


# ============================================================================
# Bulk Actions
# ============================================================================

class BulkActionOut(BaseModel):
    key: str
    label: str
    description: str
    required_params: list[str]
    optional_params: list[str]


class BulkActionListResponse(BaseModel):
    workspace_id: str
    actions: list[BulkActionOut]


class BulkActionPreviewResponse(BaseModel):
    action: str
    action_label: str
    workspace_id: str
    workspace_name: str
    objects: list[Any]
    total_count: int
    has_warnings: bool


class BulkActionValidateResponse(BaseModel):
    action: str
    action_valid: bool
    allowed: list[Any]
    blocked: list[Any]
    allowed_count: int
    blocked_count: int


class BulkActionExecuteResponse(BaseModel):
    action: str
    status: str
    workspace_id: str
    results: list[Any]
    success_count: int
    error_count: int
    total_count: int
