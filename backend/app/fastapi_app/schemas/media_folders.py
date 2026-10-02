"""Pydantic schemas for Media Folders API endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel

from app.fastapi_app.schemas.common import SuccessResponse


class MediaFolderOut(BaseModel):
    """Serialized media folder."""
    folder_id: str
    organization_id: str
    name: str
    parent_folder_id: str | None = None
    path: str | None = None
    depth: int | None = None
    sort_order: int | None = None
    created_at: str | None = None
    updated_at: str | None = None
    breadcrumbs: list[Any] | None = None

    model_config = {"extra": "allow"}


class FolderListResponse(BaseModel):
    """List of folders (tree structure)."""
    folders: Any
    unfiled_count: int | None = None


class FolderContentsResponse(BaseModel):
    """Folder contents. Dynamic shape from the service."""
    model_config = {"extra": "allow"}


class DeleteFolderResponse(SuccessResponse):
    """Delete folder response."""
    media_items_affected: int


class MoveItemsResponse(SuccessResponse):
    """Move items response."""
    moved_count: int
