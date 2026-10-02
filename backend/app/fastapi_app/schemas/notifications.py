"""Pydantic response models for notifications endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class NotificationActorOut(BaseModel):
    user_id: str | None = None
    display_name: str | None = None


class NotificationOut(BaseModel):
    notification_id: str
    notification_type: str | None = None
    title: str | None = None
    message: str | None = None
    entity_type: str | None = None
    entity_id: str | None = None
    actor: NotificationActorOut | None = None
    is_read: bool
    read_at: str | None = None
    created_at: str | None = None


class NotificationListResponse(BaseModel):
    items: list[NotificationOut]
    unread_count: int
    total: int
    has_more: bool
    limit: int
    offset: int


class UnreadCountResponse(BaseModel):
    unread_count: int


class MarkAllReadResponse(BaseModel):
    success: bool = True
    marked_count: int
