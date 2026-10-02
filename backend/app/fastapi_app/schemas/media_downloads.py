"""Pydantic response schemas for media_downloads router."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


# ============================================================================
# DOWNLOAD REQUEST
# ============================================================================


class RequesterDetail(BaseModel):
    user_id: str
    email: str | None = None
    display_name: str | None = None


class CollectionDetail(BaseModel):
    collection_id: str
    name: str | None = None


class DownloadRequestItemMediaDetail(BaseModel):
    media_id: str
    filename: str | None = None
    title: str | None = None
    media_type: str | None = None
    mime_type: str | None = None
    file_size: int | None = None


class DownloadRequestItemOut(BaseModel):
    item_id: str
    request_id: str
    media_id: str
    item_status: str | None = None
    item_note: str | None = None
    downloaded: bool | None = None
    downloaded_at: str | None = None
    media: DownloadRequestItemMediaDetail | None = None


class DownloadRequestOut(BaseModel):
    request_id: str
    organization_id: str
    request_number: str | None = None
    collection_id: str | None = None
    requester_id: str
    requester_name: str | None = None
    requester_email: str | None = None
    requester_institution: str | None = None
    purpose: str | None = None
    intended_use: str | None = None
    project_description: str | None = None
    derivative_type_requested: str | None = None
    status: str | None = None
    reviewed_by_id: str | None = None
    review_date: str | None = None
    review_note: str | None = None
    approved_by_id: str | None = None
    approval_date: str | None = None
    approval_conditions: str | None = None
    denial_reason: str | None = None
    fulfilled_at: str | None = None
    fulfilled_by_id: str | None = None
    fulfillment_note: str | None = None
    download_expires_at: str | None = None
    download_count: int | None = None
    max_downloads: int | None = None
    download_token: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    requester: RequesterDetail | None = None
    collection: CollectionDetail | None = None
    item_count: int | None = None
    items: list[DownloadRequestItemOut] | None = None


class DownloadRequestListResponse(BaseModel):
    items: list[DownloadRequestOut]
    total: int
    limit: int
    offset: int


# ============================================================================
# DOWNLOAD LINKS
# ============================================================================


class DownloadLinkItem(BaseModel):
    media_id: str | None = None
    s3_key: str | None = None
    download_url: str | None = None
    filename: str | None = None
    file_size: int | None = None
    mime_type: str | None = None


class DownloadLinksResponse(BaseModel):
    request_id: str
    downloads: list[Any]
    total: int
