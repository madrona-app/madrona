"""Pydantic schemas for Public Content CMS API endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


# ---- Pages ----

class PageSummaryOut(BaseModel):
    """Page summary (no blocks)."""
    page_id: str
    slug: str | None = None
    title: str | None = None
    page_type: str | None = None
    status: str | None = None
    published_at: str | None = None
    author_id: str | None = None
    featured_image_media_id: str | None = None
    excerpt: str | None = None
    template: str | None = None
    sort_order: int | None = None


class ContentBlockOut(BaseModel):
    """Content block."""
    block_id: str
    block_type: str | None = None
    content: Any | None = None
    sort_order: int | None = None


class PageAncestorOut(BaseModel):
    """Page ancestor/child reference."""
    page_id: str
    slug: str | None = None
    title: str | None = None


class PageDetailOut(PageSummaryOut):
    """Page detail with blocks."""
    meta_title: str | None = None
    meta_description: str | None = None
    parent_page_id: str | None = None
    blocks: list[ContentBlockOut] | None = None
    ancestors: list[PageAncestorOut] | None = None
    children: list[PageAncestorOut] | None = None
    is_preview: bool | None = None
    categories: list[Any] | None = None
    author_name: str | None = None


class PageListResponse(BaseModel):
    """Published pages list."""
    data: list[PageSummaryOut]
    total: int


class PageDetailResponse(BaseModel):
    """Single page detail."""
    data: PageDetailOut


# ---- Blog Posts ----

class PostSummaryOut(PageSummaryOut):
    """Post summary with categories and author."""
    categories: list[Any] | None = None
    author_name: str | None = None


class PostListResponse(BaseModel):
    """Published posts list."""
    data: list[PostSummaryOut]
    total: int
    limit: int
    offset: int


class PostDetailOut(PageDetailOut):
    """Post detail with categories."""
    pass


class PostDetailResponse(BaseModel):
    """Single post detail."""
    data: PostDetailOut


# ---- Categories ----

class CategoryOut(BaseModel):
    """Category."""
    category_id: str
    name: str | None = None
    slug: str | None = None
    description: str | None = None
    sort_order: int | None = None


class CategoryListResponse(BaseModel):
    """Category list."""
    data: list[CategoryOut]
    total: int


# ---- Menus ----

class MenuItemOut(BaseModel):
    """Menu item."""
    label: str | None = None
    link_type: str | None = None
    page_slug: str | None = None
    url: str | None = None
    description: str | None = None
    image_media_id: str | None = None
    highlight: bool | None = None
    children: list[MenuItemOut] | None = None


class MenuDataOut(BaseModel):
    """Menu data."""
    location: str
    items: list[MenuItemOut]


class MenuResponse(BaseModel):
    """Public menu response."""
    data: MenuDataOut


# ---- Preview ----

class PreviewPageResponse(BaseModel):
    """Preview page response."""
    data: PageDetailOut
