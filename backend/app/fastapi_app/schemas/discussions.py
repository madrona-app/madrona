"""Pydantic response models for discussions router."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class CommentAuthorOut(BaseModel):
    user_id: str
    display_name: str | None = None
    email: str | None = None


class CommentOut(BaseModel):
    comment_id: str
    entity_type: str
    entity_id: str
    author: CommentAuthorOut
    content: str
    kind: str
    created_at: str | None = None


class CommentListResponse(BaseModel):
    items: list[CommentOut]
    total: int
    has_more: bool
    limit: int
    offset: int


class CommentCreatedResponse(BaseModel):
    comment: CommentOut


class CommentCountResponse(BaseModel):
    count: int


class WatchStatusResponse(BaseModel):
    watching: bool
    watch_id: str | None = None


class ExportCommentOut(BaseModel):
    author_name: str | None = None
    author_email: str | None = None
    content: str
    kind: str
    created_at: str | None = None


class ExportRecordOut(BaseModel):
    entity_type: str
    entity_id: str
    organization_id: str


class CommentExportResponse(BaseModel):
    record: ExportRecordOut
    comments: list[ExportCommentOut]
    total_count: int
    exported_at: str
    exported_by: str
