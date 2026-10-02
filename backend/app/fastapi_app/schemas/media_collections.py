"""Pydantic response schemas for media_collections router."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


# ============================================================================
# MEDIA COLLECTION
# ============================================================================


class MediaCollectionOut(BaseModel):
    collection_id: str
    organization_id: str
    name: str | None = None
    description: str | None = None
    cover_media_id: str | None = None
    visibility: str | None = None
    public_share_token: str | None = None
    public_share_enabled: bool | None = None
    public_share_expires_at: str | None = None
    public_share_has_password: bool | None = None
    public_share_download_level: str | None = None
    consent_clearance_required: bool | None = None
    consent_cleared_at: str | None = None
    item_count: int | None = None
    created_by: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    cover_url: str | None = None


class MediaCollectionListResponse(BaseModel):
    items: list[MediaCollectionOut]
    total: int
    limit: int
    offset: int


class CollectionDeletedResponse(BaseModel):
    success: bool
    collection_id: str


# ============================================================================
# COLLECTION ITEMS
# ============================================================================


class CollectionItemMediaDetail(BaseModel):
    media_id: str
    filename: str | None = None
    title: str | None = None
    media_type: str | None = None
    mime_type: str | None = None
    width: int | None = None
    height: int | None = None
    thumbnail_url: str | None = None


class CollectionItemOut(BaseModel):
    collection_id: str
    media_id: str
    sort_order: int | None = None
    notes: str | None = None
    added_at: str | None = None
    added_by: str | None = None
    media: CollectionItemMediaDetail | None = None


class CollectionItemListResponse(BaseModel):
    items: list[CollectionItemOut]
    total: int


class CollectionItemCreatedResponse(BaseModel):
    collection_id: str
    media_id: str
    sort_order: int | None = None


class CollectionItemRemovedResponse(BaseModel):
    success: bool
    media_id: str


# ============================================================================
# SHARING
# ============================================================================


class CollectionShareOut(BaseModel):
    share_id: str
    collection_id: str
    user_id: str | None = None
    user_name: str | None = None
    user_email: str | None = None
    principal_type: str | None = None
    principal_id: str | None = None
    principal_name: str | None = None
    role: str | None = None
    shared_by: str | None = None
    shared_at: str | None = None


class CollectionShareListResponse(BaseModel):
    shares: list[CollectionShareOut]
    total: int


class ShareRemovedResponse(BaseModel):
    success: bool
    share_id: str


# ============================================================================
# PUBLIC SHARING
# ============================================================================


class PublicSharingEnabledResponse(BaseModel):
    public_share_token: str
    public_url: str


# ============================================================================
# CONSENT CLEARANCE
# ============================================================================


class ConsentMediaItem(BaseModel):
    media_id: str
    title: str | None = None
    filename: str | None = None
    expiry_date: str | None = None


class ConsentClearanceResponse(BaseModel):
    is_cleared: bool
    media_count: int
    media_without_consent: list[ConsentMediaItem]
    media_with_expired_consent: list[ConsentMediaItem]


class ConsentClearedResponse(BaseModel):
    success: bool
    cleared_at: str


# ============================================================================
# PUBLIC COLLECTION VIEW
# ============================================================================


class PublicCollectionResponse(BaseModel):
    collection: MediaCollectionOut
    items: list[CollectionItemOut]


# ============================================================================
# METADATA TEMPLATES
# ============================================================================


class MetadataTemplateOut(BaseModel):
    template_id: str
    name: str | None = None
    description: str | None = None
    template_fields: Any = None
    is_default: bool | None = None
    is_active: bool | None = None
    created_at: str | None = None
    created_by: str | None = None
    updated_at: str | None = None
    updated_by: str | None = None


class MetadataTemplateListResponse(BaseModel):
    templates: list[MetadataTemplateOut]


class MetadataTemplateCreatedResponse(BaseModel):
    template_id: str
    name: str | None = None
    description: str | None = None
    template_fields: Any = None
    is_default: bool | None = None


class MetadataTemplateDeletedResponse(BaseModel):
    success: bool
    template_id: str


class MetadataTemplateSetDefaultResponse(BaseModel):
    success: bool
    template_id: str
    message: str
