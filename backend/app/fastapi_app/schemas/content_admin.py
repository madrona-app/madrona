"""Pydantic schemas for Content CMS Admin API."""
from __future__ import annotations

from typing import Any

from uuid import UUID

from pydantic import BaseModel


class CreatePageBody(BaseModel):
    title: str
    slug: str | None = None
    page_type: str = "page"
    template: str = "default"
    excerpt: str | None = None
    meta_title: str | None = None
    meta_description: str | None = None
    featured_image_media_id: UUID | None = None
    og_image_media_id: UUID | None = None
    parent_page_id: UUID | None = None
    sort_order: int = 0
    publish_at: str | None = None
    blocks: list[dict] = []


class UpdatePageBody(BaseModel):
    title: str | None = None
    slug: str | None = None
    excerpt: str | None = None
    meta_title: str | None = None
    meta_description: str | None = None
    template: str | None = None
    featured_image_media_id: UUID | None = None
    og_image_media_id: UUID | None = None
    publish_at: str | None = None
    parent_page_id: UUID | None = None
    sort_order: int | None = None
    category_ids: list[UUID] | None = None


class ReplaceBlocksBody(BaseModel):
    blocks: list[dict]


class PublishBody(BaseModel):
    publish_at: str | None = None


class CreateCategoryBody(BaseModel):
    name: str
    slug: str | None = None
    description: str | None = None
    sort_order: int = 0


class UpdateCategoryBody(BaseModel):
    name: str | None = None
    slug: str | None = None
    description: str | None = None
    sort_order: int | None = None


class SaveMenuBody(BaseModel):
    name: str | None = None
    items: list[dict] = []


class CreateRedirectBody(BaseModel):
    source_path: str
    target_path: str
    redirect_type: int = 301
    is_active: bool = True
    note: str | None = None


class UpdateRedirectBody(BaseModel):
    source_path: str | None = None
    target_path: str | None = None
    redirect_type: int | None = None
    is_active: bool | None = None
    note: str | None = None


# ============================================================================
# Response schemas
# ============================================================================

class ContentBlockOut(BaseModel):
    block_id: str
    page_id: str
    block_type: str
    content: Any = None
    sort_order: int


class ContentPageOut(BaseModel):
    page_id: str
    organization_id: str
    slug: str | None = None
    title: str | None = None
    page_type: str | None = None
    status: str | None = None
    published_at: str | None = None
    publish_at: str | None = None
    author_id: str | None = None
    featured_image_media_id: str | None = None
    og_image_media_id: str | None = None
    excerpt: str | None = None
    meta_title: str | None = None
    meta_description: str | None = None
    template: str | None = None
    parent_page_id: str | None = None
    sort_order: int | None = None
    created_at: str | None = None
    updated_at: str | None = None
    created_by: str | None = None
    updated_by: str | None = None
    blocks: list[ContentBlockOut] | None = None
    categories: list[Any] | None = None


class ContentPageDataResponse(BaseModel):
    data: ContentPageOut


class ContentPageListResponse(BaseModel):
    items: list[ContentPageOut]
    total: int
    limit: int
    offset: int


class ContentBlockListResponse(BaseModel):
    data: list[ContentBlockOut]


class PageTreeNode(BaseModel):
    page_id: str
    slug: str | None = None
    title: str | None = None
    status: str | None = None
    template: str | None = None
    sort_order: int | None = None
    depth: int
    updated_at: str | None = None
    children: list[PageTreeNode] = []


class PageTreeResponse(BaseModel):
    data: list[PageTreeNode]


class PreviewTokenData(BaseModel):
    preview_token: str
    preview_expires: str
    page_id: str


class PreviewTokenResponse(BaseModel):
    data: PreviewTokenData


class CategoryOut(BaseModel):
    category_id: str
    organization_id: str
    name: str
    slug: str | None = None
    description: str | None = None
    sort_order: int | None = None
    created_at: str | None = None
    updated_at: str | None = None


class CategoryDataResponse(BaseModel):
    data: CategoryOut


class CategoryListResponse(BaseModel):
    data: list[CategoryOut]


class MenuItemOut(BaseModel):
    menu_item_id: str
    label: str | None = None
    link_type: str | None = None
    page_id: str | None = None
    url: str | None = None
    sort_order: int | None = None
    description: str | None = None
    image_media_id: str | None = None
    highlight: bool | None = None
    children: list[MenuItemOut] = []


class MenuOut(BaseModel):
    menu_id: str | None = None
    location: str | None = None
    name: str | None = None
    items: list[MenuItemOut] = []


class MenuDataResponse(BaseModel):
    data: MenuOut


class RedirectOut(BaseModel):
    redirect_id: str
    organization_id: str
    source_path: str
    target_path: str
    redirect_type: int | None = None
    is_active: bool | None = None
    note: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    created_by: str | None = None


class RedirectDataResponse(BaseModel):
    data: RedirectOut


class RedirectListResponse(BaseModel):
    items: list[RedirectOut]
    total: int
    limit: int
    offset: int
