"""
Content CMS models — pages, blog posts, and block editor.

This module defines the SQLAlchemy models for the Content product,
which provides museums with a full CMS for building their public website
with pages, blog posts, and a drag-and-drop block editor.

All tables are in the 'content' PostgreSQL schema.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import (
    DateTime,
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models._helpers import uuid_pk, timestamp_now, timestamp_updated


# ============================================================================
# PAGES — CMS pages and blog posts (unified table)
# ============================================================================

class Page(Base):
    """
    A CMS page or blog post.

    Uses page_type discriminator: 'page' for static pages, 'post' for blog posts.
    Both share the same block-based content structure.
    """
    __tablename__ = "pages"

    page_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Identification
    slug: Mapped[str] = mapped_column(String(255), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    page_type: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="page",
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="draft",
    )

    # Publishing
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    publish_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Featured image (references media.media table by UUID, no FK constraint
    # since media is in a different schema)
    featured_image_media_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True,
    )
    og_image_media_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True,
    )

    # Content metadata
    excerpt: Mapped[str | None] = mapped_column(Text, nullable=True)
    meta_title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    meta_description: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Layout
    template: Mapped[str | None] = mapped_column(String(50), server_default="default")

    # Hierarchy (pages only)
    parent_page_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("content.pages.page_id", ondelete="SET NULL",
                    name="fk_pages_parent_page_id"),
        nullable=True,
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    blocks: Mapped[list["ContentBlock"]] = relationship(
        "ContentBlock",
        back_populates="page",
        cascade="all, delete-orphan",
        order_by="ContentBlock.sort_order",
    )
    children: Mapped[list["Page"]] = relationship(
        "Page",
        back_populates="parent",
        cascade="all, delete-orphan",
        remote_side="Page.parent_page_id",
        foreign_keys="Page.parent_page_id",
    )
    parent: Mapped[Optional["Page"]] = relationship(
        "Page",
        back_populates="children",
        remote_side="Page.page_id",
        foreign_keys="Page.parent_page_id",
    )

    __table_args__ = (
        CheckConstraint("page_type IN ('page', 'post')", name="ck_pages_page_type"),
        CheckConstraint("status IN ('draft', 'published', 'archived')", name="ck_pages_status"),
        Index("ix_content_pages_org_slug", "organization_id", "slug", unique=True),
        Index("ix_content_pages_org_type_status", "organization_id", "page_type", "status"),
        {"schema": "content"},
    )


# ============================================================================
# CONTENT BLOCKS — ordered content blocks within pages
# ============================================================================

class ContentBlock(Base):
    """
    A single content block within a page.

    Block types: rich_text, image, hero_banner, gallery, video,
    divider, quote, html, call_to_action.
    Content is stored as JSONB with block-type-specific structure.
    """
    __tablename__ = "content_blocks"

    block_id: Mapped[uuid.UUID] = uuid_pk()
    page_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("content.pages.page_id", ondelete="CASCADE"),
        nullable=False,
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    block_type: Mapped[str] = mapped_column(String(50), nullable=False)
    content: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default="{}")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()

    # Relationships
    page: Mapped["Page"] = relationship("Page", back_populates="blocks")

    __table_args__ = (
        Index("ix_content_blocks_page_order", "page_id", "sort_order"),
        {"schema": "content"},
    )


# ============================================================================
# CATEGORIES — blog post categories
# ============================================================================

class Category(Base):
    """A blog post category for organizing content."""
    __tablename__ = "categories"

    category_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()

    __table_args__ = (
        Index("ix_content_categories_org_slug", "organization_id", "slug", unique=True),
        {"schema": "content"},
    )


# ============================================================================
# PAGE CATEGORIES — junction table
# ============================================================================

class PageCategory(Base):
    """Junction table linking pages (blog posts) to categories."""
    __tablename__ = "page_categories"

    page_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("content.pages.page_id", ondelete="CASCADE"),
        primary_key=True,
    )
    category_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("content.categories.category_id", ondelete="CASCADE"),
        primary_key=True,
    )

    __table_args__ = (
        {"schema": "content"},
    )


# ============================================================================
# MENUS — Navigation menus (header / footer)
# ============================================================================

class Menu(Base):
    """A navigation menu (header or footer) for an organization's public site."""
    __tablename__ = "menus"

    menu_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    location: Mapped[str] = mapped_column(String(20), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False, server_default="")

    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()

    # Relationships
    items: Mapped[list["MenuItem"]] = relationship(
        "MenuItem",
        back_populates="menu",
        cascade="all, delete-orphan",
        order_by="MenuItem.sort_order",
    )

    __table_args__ = (
        CheckConstraint("location IN ('header', 'footer')", name="ck_menus_location"),
        UniqueConstraint("organization_id", "location", name="uq_menus_org_location"),
        {"schema": "content"},
    )


class MenuItem(Base):
    """A single item in a navigation menu, supporting one level of nesting."""
    __tablename__ = "menu_items"

    menu_item_id: Mapped[uuid.UUID] = uuid_pk()
    menu_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("content.menus.menu_id", ondelete="CASCADE"),
        nullable=False,
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    parent_item_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("content.menu_items.menu_item_id", ondelete="CASCADE",
                    name="fk_menu_items_parent"),
        nullable=True,
    )

    label: Mapped[str] = mapped_column(String(100), nullable=False)
    link_type: Mapped[str] = mapped_column(String(20), nullable=False)
    page_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("content.pages.page_id", ondelete="SET NULL"),
        nullable=True,
    )
    url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")

    # Mega menu fields (Phase 1B)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_media_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True,
    )
    highlight: Mapped[bool] = mapped_column(server_default="false", nullable=False)

    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()

    # Relationships
    menu: Mapped["Menu"] = relationship("Menu", back_populates="items")
    page: Mapped[Optional["Page"]] = relationship("Page", foreign_keys=[page_id])
    children: Mapped[list["MenuItem"]] = relationship(
        "MenuItem",
        back_populates="parent",
        cascade="all, delete-orphan",
        order_by="MenuItem.sort_order",
    )
    parent: Mapped[Optional["MenuItem"]] = relationship(
        "MenuItem",
        back_populates="children",
        remote_side="MenuItem.menu_item_id",
    )

    __table_args__ = (
        CheckConstraint(
            "link_type IN ('page', 'url', 'collection', 'category', 'exhibition', 'event')",
            name="ck_menu_items_link_type",
        ),
        Index("ix_content_menu_items_menu", "menu_id", "sort_order"),
        Index("ix_content_menu_items_parent", "parent_item_id"),
        {"schema": "content"},
    )


# ============================================================================
# REDIRECTS — URL redirect rules for slug changes and manual redirects
# ============================================================================

class Redirect(Base):
    """
    A URL redirect rule for the public site.

    Automatically created when a page slug changes, or manually managed
    by content editors. source_path stores the path after /c/{orgSlug},
    e.g. '/pages/old-slug'.
    """
    __tablename__ = "redirects"

    redirect_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    source_path: Mapped[str] = mapped_column(String(500), nullable=False)
    target_path: Mapped[str] = mapped_column(String(500), nullable=False)
    redirect_type: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="301",
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true",
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    __table_args__ = (
        CheckConstraint(
            "redirect_type IN (301, 302)",
            name="ck_redirects_redirect_type",
        ),
        UniqueConstraint("organization_id", "source_path", name="uq_redirects_org_source"),
        Index("ix_content_redirects_org_source", "organization_id", "source_path"),
        {"schema": "content"},
    )
