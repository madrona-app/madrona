from __future__ import annotations

"""Public discovery and feedback models."""

import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models._helpers import uuid_pk, timestamp_now, timestamp_updated


class DiscoverConfig(Base):
    """
    Configuration for the public Discover collection browser.

    One-to-one relationship with Organization. Controls the hero image,
    page title, subtitle, branding, navigation, and default display settings
    for the public collection browser at /c/<org_slug>.
    """
    __tablename__ = "discover_configs"

    config_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )

    # Hero section
    hero_media_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media.media_id", ondelete="SET NULL"),
        nullable=True,
    )
    page_title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    page_subtitle: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Display options
    show_object_count: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    default_view_mode: Mapped[str] = mapped_column(String(10), nullable=False, default="grid")
    default_sort: Mapped[str] = mapped_column(String(20), nullable=False, default="relevance")

    # Branding
    header_logo_media_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media.media_id", ondelete="SET NULL"),
        nullable=True,
    )
    primary_color: Mapped[str | None] = mapped_column(String(7), nullable=True)
    accent_color: Mapped[str | None] = mapped_column(String(7), nullable=True)
    font_family: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Phase 2A: Extended theming
    secondary_color: Mapped[str | None] = mapped_column(String(7), nullable=True)
    background_color: Mapped[str | None] = mapped_column(String(7), nullable=True)
    text_color: Mapped[str | None] = mapped_column(String(7), nullable=True)
    heading_font_family: Mapped[str | None] = mapped_column(String(50), nullable=True)
    body_font_family: Mapped[str | None] = mapped_column(String(50), nullable=True)
    button_style: Mapped[str] = mapped_column(String(20), nullable=False, server_default="rounded")
    header_style: Mapped[str] = mapped_column(String(20), nullable=False, server_default="solid")
    google_fonts = mapped_column(JSONB, nullable=True)
    custom_css: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Navigation & footer
    nav_items = mapped_column(JSONB, nullable=True)
    footer_text: Mapped[str | None] = mapped_column(String(500), nullable=True)
    social_links = mapped_column(JSONB, nullable=True)

    # Phase 2B: Rich footer
    footer_columns = mapped_column(JSONB, nullable=True)
    land_acknowledgment: Mapped[str | None] = mapped_column(Text, nullable=True)
    footer_logo_media_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True,
    )

    # Landing page
    featured_object_ids = mapped_column(JSONB, nullable=True)

    # CMS homepage override (no FK — cross-schema, same as featured_image_media_id on content.pages)
    homepage_page_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True,
    )

    # Custom 404 page (no FK — cross-schema reference to content.pages)
    custom_404_page_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True,
    )

    # Phase 7: External integration points
    external_integrations = mapped_column(JSONB, nullable=True)

    # Phase 8: Analytics
    analytics_config = mapped_column(JSONB, nullable=True)

    # CDN purge configuration
    # { "provider": "cloudflare"|"cloudfront", "zone_id": "...", "api_token": "...",
    #   "distribution_id": "..." (cloudfront only) }
    cdn_config = mapped_column(JSONB, nullable=True)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="DiscoverConfig.organization_id == Organization.organization_id",
    )
    hero_media: Mapped["Media | None"] = relationship(
        "Media",
        primaryjoin="DiscoverConfig.hero_media_id == Media.media_id",
        foreign_keys=[hero_media_id],
    )
    header_logo_media: Mapped["Media | None"] = relationship(
        "Media",
        primaryjoin="DiscoverConfig.header_logo_media_id == Media.media_id",
        foreign_keys=[header_logo_media_id],
    )

    __table_args__ = (
        Index("ix_discover_configs_org", "organization_id"),
        CheckConstraint(
            "default_view_mode IN ('grid', 'list')",
            name="check_discover_view_mode",
        ),
        CheckConstraint(
            "default_sort IN ('relevance', 'title_asc', 'title_desc', 'date_asc', 'date_desc', 'newest')",
            name="check_discover_sort",
        ),
        {"schema": "collections"},
    )


class PublishSchedule(Base):
    """
    Scheduled publish/unpublish action for Discover.

    Supports two modes:
    - criteria-based: publish all objects matching filter criteria at a future time
    - object_ids-based: publish a specific list of objects at a future time

    Executed by a periodic Celery task that checks for due schedules.
    """

    __tablename__ = "publish_schedules"

    schedule_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    action: Mapped[str] = mapped_column(String(20), nullable=False)
    scheduled_for: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    criteria: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    object_ids: Mapped[list | None] = mapped_column(JSONB, nullable=True)

    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    result_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    executed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="RESTRICT"),
        nullable=False,
    )

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="PublishSchedule.organization_id == Organization.organization_id",
    )

    __table_args__ = (
        Index(
            "ix_publish_schedules_org_status_time",
            "organization_id",
            "status",
            "scheduled_for",
        ),
        CheckConstraint(
            "action IN ('publish', 'unpublish')",
            name="check_publish_schedule_action",
        ),
        CheckConstraint(
            "status IN ('pending', 'executed', 'cancelled', 'failed')",
            name="check_publish_schedule_status",
        ),
        {"schema": "collections"},
    )


class CollectionFeedbackRequest(Base):
    """
    A request for feedback on a media collection.

    Generates a unique token for public feedback submission.
    """
    __tablename__ = "collection_feedback_requests"

    request_id: Mapped[uuid.UUID] = uuid_pk()
    collection_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media_collections.collection_id", ondelete="CASCADE"),
        nullable=False,
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    token: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    recipient_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    recipient_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Feedback fields configuration
    fields: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # e.g. {rating: true, comment: true}

    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    __table_args__ = (
        Index("ix_collection_feedback_requests_token", "token"),
        Index("ix_collection_feedback_requests_collection", "collection_id"),
        {"schema": "media"},
    )


class CollectionFeedbackResponse(Base):
    """
    Per-media feedback response within a collection feedback request.
    """
    __tablename__ = "collection_feedback_responses"

    response_id: Mapped[uuid.UUID] = uuid_pk()
    request_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.collection_feedback_requests.request_id", ondelete="CASCADE"),
        nullable=False,
    )
    media_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media.media_id", ondelete="CASCADE"),
        nullable=False,
    )

    rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    response_data: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # Additional structured feedback

    respondent_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    respondent_email: Mapped[str | None] = mapped_column(String(255), nullable=True)

    created_at: Mapped[datetime] = timestamp_now()

    __table_args__ = (
        Index("ix_collection_feedback_responses_request", "request_id"),
        Index("ix_collection_feedback_responses_media", "media_id"),
        {"schema": "media"},
    )


__all__ = [
    "DiscoverConfig",
    "PublishSchedule",
    "CollectionFeedbackRequest",
    "CollectionFeedbackResponse",
]
