"""Pydantic response schemas for media_workspaces router."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


# ============================================================================
# WORKSPACE
# ============================================================================


class WorkspaceSummaryOut(BaseModel):
    workspace_id: str
    name: str | None = None
    description: str | None = None
    visibility: str | None = None
    owner_user_id: str | None = None
    owner_name: str | None = None
    is_owner: bool | None = None
    asset_count: int | None = None
    cover_thumbnail_url: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class WorkspaceListResponse(BaseModel):
    workspaces: list[WorkspaceSummaryOut]
    total: int
    limit: int
    offset: int


class WorkspaceCreatedResponse(BaseModel):
    workspace_id: str
    name: str | None = None
    description: str | None = None
    visibility: str | None = None
    asset_count: int | None = None
    created_at: str | None = None


class WorkspaceItemOut(BaseModel):
    workspace_item_id: str
    media_id: str
    filename: str | None = None
    title: str | None = None
    thumbnail_url: str | None = None
    media_type: str | None = None
    mime_type: str | None = None
    width: int | None = None
    height: int | None = None
    file_size: int | None = None
    note: str | None = None
    sort_order: int | None = None
    added_at: str | None = None
    copyright_status: str | None = None
    rights_statement: str | None = None


class WorkspacePagination(BaseModel):
    page: int
    page_size: int
    total: int
    total_pages: int


class WorkspaceDetailResponse(BaseModel):
    workspace_id: str
    name: str | None = None
    description: str | None = None
    visibility: str | None = None
    owner_user_id: str | None = None
    owner_name: str | None = None
    is_owner: bool | None = None
    permission_level: str | None = None
    asset_count: int | None = None
    cover_thumbnail_url: str | None = None
    items: list[WorkspaceItemOut]
    pagination: WorkspacePagination
    created_at: str | None = None
    updated_at: str | None = None


class WorkspaceUpdatedResponse(BaseModel):
    workspace_id: str
    name: str | None = None
    description: str | None = None
    visibility: str | None = None
    updated_at: str | None = None


# ============================================================================
# WORKSPACE ITEMS
# ============================================================================


class WorkspaceItemsAddedResponse(BaseModel):
    added: list[str]
    skipped: list[str]
    added_count: int


class WorkspaceItemsRemovedResponse(BaseModel):
    removed_count: int


# ============================================================================
# SHARING
# ============================================================================


class WorkspaceShareOut(BaseModel):
    share_id: str
    principal_type: str | None = None
    principal_id: str | None = None
    principal_name: str | None = None
    principal_email: str | None = None
    permission: str | None = None
    created_at: str | None = None


class WorkspaceShareListResponse(BaseModel):
    shares: list[WorkspaceShareOut]


class WorkspaceShareCreatedResponse(BaseModel):
    share_id: str
    permission: str | None = None
    created_at: str | None = None


# ============================================================================
# ACTIVE CONTEXT
# ============================================================================


class ContextWorkspaceDetail(BaseModel):
    workspace_id: str
    name: str | None = None
    asset_count: int | None = None


class ContextAssetDetail(BaseModel):
    media_id: str
    filename: str | None = None
    title: str | None = None
    thumbnail_url: str | None = None


class ActiveContextOut(BaseModel):
    type: str | None = None
    id: str | None = None
    set_at: str | None = None
    workspace: ContextWorkspaceDetail | None = None
    asset: ContextAssetDetail | None = None


class ActiveContextResponse(BaseModel):
    context: ActiveContextOut | None = None


# ============================================================================
# BULK ACTIONS
# ============================================================================


class BulkActionConfigOut(BaseModel):
    key: str
    label: str
    description: str | None = None
    required_params: list[str] | None = None
    optional_params: list[str] | None = None
    is_async: bool | None = None
    requires_permission: str | None = None
    category: str | None = None
    download_options: list[Any] | None = None


class BulkActionsListResponse(BaseModel):
    actions: list[BulkActionConfigOut]


class PreviewAssetOut(BaseModel):
    media_id: str
    filename: str | None = None
    title: str | None = None
    thumbnail_url: str | None = None
    file_size: int | None = None
    mime_type: str | None = None
    warnings: list[str] | None = None


class BulkActionPreviewResponse(BaseModel):
    action: str
    action_label: str | None = None
    workspace_id: str
    workspace_name: str | None = None
    assets: list[PreviewAssetOut]
    total_count: int
    has_warnings: bool | None = None
    total_size_bytes: int | None = None
    warnings: list[str] | None = None


class ValidationAllowedItem(BaseModel):
    media_id: str
    filename: str | None = None
    title: str | None = None


class ValidationBlockedItem(BaseModel):
    media_id: str
    filename: str | None = None
    title: str | None = None
    reason: str | None = None
    code: str | None = None


class BulkActionValidateResponse(BaseModel):
    action: str
    action_valid: bool
    allowed: list[ValidationAllowedItem]
    blocked: list[ValidationBlockedItem]
    allowed_count: int
    blocked_count: int
    error: str | None = None


class BulkActionResultItem(BaseModel):
    media_id: str
    status: str
    message: str | None = None
    filename: str | None = None
    artifact_url: str | None = None


class BulkActionExecuteResponse(BaseModel):
    action: str
    status: str
    workspace_id: str
    total_count: int
    success_count: int
    error_count: int
    results: list[BulkActionResultItem]


class BulkActionAsyncResponse(BaseModel):
    run_id: str
    status: str
    total_count: int
    message: str


class ActionRunResponse(BaseModel):
    run_id: str
    action: str | None = None
    action_params: Any | None = None
    status: str | None = None
    total_count: int | None = None
    processed_count: int | None = None
    success_count: int | None = None
    error_count: int | None = None
    results: Any | None = None
    error_message: str | None = None
    artifact_url: str | None = None
    artifact_expires_at: str | None = None
    started_at: str | None = None
    completed_at: str | None = None
    created_at: str | None = None


# ============================================================================
# GENERIC
# ============================================================================


class SuccessMessageResponse(BaseModel):
    success: bool
    message: str
