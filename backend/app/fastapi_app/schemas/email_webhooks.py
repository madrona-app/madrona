"""Pydantic response models for email webhooks endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class EmailEventOut(BaseModel):
    event_id: str
    email: str
    event_type: str
    bounce_type: str | None = None
    bounce_subtype: str | None = None
    complaint_feedback_type: str | None = None
    message_id: str | None = None
    created_at: str | None = None


class EmailEventDetailOut(EmailEventOut):
    sns_message_id: str | None = None
    raw_message: Any | None = None


class EmailEventListResponse(BaseModel):
    items: list[EmailEventOut]
    total: int
    limit: int
    offset: int


class Last30Days(BaseModel):
    bounces: int
    complaints: int
    total_events: int


class UserEmailStatus(BaseModel):
    active: int
    bounced: int
    complaint: int
    total: int


class EmailStatsResponse(BaseModel):
    last_30_days: Last30Days
    user_email_status: UserEmailStatus


class BulkDeleteResponse(BaseModel):
    message: str
    deleted_count: int


class UserEmailStatusOut(BaseModel):
    user_id: str
    email: str
    email_status: str | None = None
    status: str | None = None
    created_at: str | None = None


class UserEmailStatusListResponse(BaseModel):
    items: list[UserEmailStatusOut]
    total: int
    limit: int
    offset: int


class UserEmailStatusUpdateResponse(BaseModel):
    user_id: str
    email: str
    email_status: str
    message: str


class SesWebhookResponse(BaseModel):
    message: str | None = None
    subscribe_url: str | None = None
    status: str | None = None
