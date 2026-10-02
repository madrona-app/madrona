from __future__ import annotations

"""Media and digital asset management models."""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pgvector.sqlalchemy import Vector

from sqlalchemy import (
    DateTime,
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models._helpers import uuid_pk, timestamp_now, timestamp_updated


# ============================================================================
# MEDIA FOLDERS - Hierarchical folder organization
# ============================================================================

class MediaFolder(Base):
    """
    Hierarchical folder structure for organizing media assets.

    Supports nested folders with materialized path for efficient queries.
    """
    __tablename__ = "media_folders"
    __table_args__ = {"schema": "media"}

    folder_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    parent_folder_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media_folders.folder_id", ondelete="CASCADE"),
        nullable=True,
    )

    # Materialized path for efficient hierarchy queries (e.g., "/parent-id/child-id/")
    path: Mapped[str] = mapped_column(String(1000), nullable=False, default="/")
    depth: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Audit
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="MediaFolder.organization_id == Organization.organization_id",
    )
    parent: Mapped["MediaFolder | None"] = relationship(
        "MediaFolder",
        remote_side="MediaFolder.folder_id",
        back_populates="children",
    )
    children: Mapped[list["MediaFolder"]] = relationship(
        "MediaFolder",
        back_populates="parent",
        cascade="all, delete-orphan",
    )
    media_items: Mapped[list["Media"]] = relationship(
        "Media",
        back_populates="folder_ref",
    )
    created_by: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[created_by_id],
    )

    def __repr__(self) -> str:
        return f"<MediaFolder {self.name} ({self.folder_id})>"


# ============================================================================
# MEDIA - Organization media library
# ============================================================================

class Media(Base):
    """
    Organization-level media library.

    This is the central media repository used by both the Media application
    and Collections. Media uploaded through any application is stored
    here and can be linked to various entities.

    S3 Storage: orgs/{org_id}/media/{media_type}s/{date}_{unique_id}.{ext}
    """
    __tablename__ = "media"

    media_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # File information
    s3_key: Mapped[str] = mapped_column(String(500), nullable=False, unique=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    media_type: Mapped[str] = mapped_column(String(20), nullable=False)  # image, video, audio, document

    # Image-specific metadata
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)  # For video/audio
    page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)  # For documents (PDF, etc.)

    # Descriptive metadata
    title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    alt_text: Mapped[str | None] = mapped_column(String(500), nullable=True)  # Accessibility

    # AI-generated descriptions (Cooper Hewitt three-tier pattern).
    # These are never used for writing over curator-authored alt_text/description
    # unless the staff member explicitly promotes them via the frontend action.
    ai_alt_text: Mapped[str | None] = mapped_column(String(500), nullable=True)
    ai_description_long: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_description_emoji: Mapped[str | None] = mapped_column(String(50), nullable=True)
    ai_descriptions_generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ai_descriptions_model: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Attribution
    credit: Mapped[str | None] = mapped_column(String(500), nullable=True)
    creator: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source: Mapped[str | None] = mapped_column(String(500), nullable=True)
    date_created: Mapped[date | None] = mapped_column(Date, nullable=True)  # When media was created (not uploaded)

    # Rights
    copyright_status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    rights_statement: Mapped[str | None] = mapped_column(Text, nullable=True)
    license: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Organization and categorization — free-form `tags` JSONB column was
    # removed in favor of structured MediaTag rows tied to MediaTagDefinition /
    # MediaTagValue. See migration 20260415_1100.
    folder: Mapped[str | None] = mapped_column(String(255), nullable=True)  # Legacy virtual folder (deprecated)
    folder_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media_folders.folder_id", ondelete="SET NULL"),
        nullable=True,
    )
    extra_metadata: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)  # Additional metadata

    # Extracted technical metadata (EXIF for images, codec info for video/audio)
    # Example: { camera_make, camera_model, iso, aperture, shutter_speed, focal_length, gps_lat, gps_lng, ... }
    technical_metadata: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    # IPTC metadata (professional photo metadata standard)
    # Example: { headline, caption, keywords, city, country, copyright_notice, ... }
    iptc_metadata: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    # XMP metadata (extensible metadata platform)
    # Example: { creator_tool, history, rating, label, ... }
    xmp_metadata: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    # Dublin Core metadata (standardized descriptive metadata)
    # Example: { dc_title, dc_creator, dc_subject, dc_description, dc_publisher, dc_date, dc_type, dc_format, ... }
    dublin_core: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    # Processing status
    processing_status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    thumbnail_s3_key: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Current version number (incremented on new file upload)
    current_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    # Publishing status for DAM
    is_published: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    published_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    published_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Metadata review for sensitive content (required before publishing)
    metadata_reviewed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    metadata_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    metadata_reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    metadata_review_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Checksum for integrity verification
    checksum_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # Preservation / fixity tracking
    last_fixity_check: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    fixity_status: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # OAIS format identification (Phase 1)
    pronom_puid: Mapped[str | None] = mapped_column(String(20), nullable=True)
    format_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    format_risk_level: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Multi-algorithm fixity (Phase 4)
    checksum_md5: Mapped[str | None] = mapped_column(String(32), nullable=True)
    checksums: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # Inherited metadata from linked CollectionObjects
    # Denormalized storage for search and XMP embedding
    inherited_metadata: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB,
        nullable=True,
        comment="Denormalized metadata from linked CollectionObject(s)",
    )
    inherited_metadata_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # AI processing status
    ai_processing_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    ai_processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ai_label_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Whisper transcription
    transcript: Mapped[str | None] = mapped_column(Text, nullable=True)
    transcript_language: Mapped[str | None] = mapped_column(String(10), nullable=True)
    transcription_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    transcription_model: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Color extraction
    dominant_colors: Mapped[list | None] = mapped_column(JSONB, nullable=True)  # [{hex, rgb, percentage, name}]
    color_key: Mapped[str | None] = mapped_column(String(10), nullable=True)  # 5-char color key for bucket filtering

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    updated_at: Mapped[datetime] = timestamp_updated()
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="Media.organization_id == Organization.organization_id",
    )
    folder_ref: Mapped["MediaFolder | None"] = relationship(
        "MediaFolder",
        back_populates="media_items",
    )
    created_by_user: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[created_by],
        primaryjoin="Media.created_by == User.user_id",
    )
    updated_by_user: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[updated_by],
        primaryjoin="Media.updated_by == User.user_id",
    )
    collection_object_links: Mapped[list["CollectionObjectMedia"]] = relationship(
        "CollectionObjectMedia",
        back_populates="media",
        cascade="all, delete-orphan",
    )

    @property
    def is_pyramidal_tiff(self) -> bool:
        """True when the original is a tiled multi-resolution TIFF.

        Set at ingest by extract_image_metadata. Cantaloupe can serve
        deep zoom directly from a pyramidal original; flat originals
        are better served via the access_master derivative.
        """
        tm = self.technical_metadata or {}
        return bool(tm.get('is_pyramidal_tiff'))

    # DAM relationships
    derivatives: Mapped[list["MediaDerivative"]] = relationship(
        "MediaDerivative",
        back_populates="media",
        cascade="all, delete-orphan",
    )
    processing_jobs: Mapped[list["MediaProcessingJob"]] = relationship(
        "MediaProcessingJob",
        back_populates="media",
        cascade="all, delete-orphan",
    )
    versions: Mapped[list["MediaVersion"]] = relationship(
        "MediaVersion",
        back_populates="media",
        cascade="all, delete-orphan",
        order_by="MediaVersion.version_number.desc()",
    )
    rights: Mapped[list["MediaRights"]] = relationship(
        "MediaRights",
        back_populates="media",
        cascade="all, delete-orphan",
    )
    consents: Mapped[list["MediaConsent"]] = relationship(
        "MediaConsent",
        back_populates="media",
        cascade="all, delete-orphan",
    )
    structured_tags: Mapped[list["MediaTag"]] = relationship(
        "MediaTag",
        back_populates="media",
        cascade="all, delete-orphan",
    )
    ai_tags: Mapped[list["MediaAITag"]] = relationship(
        "MediaAITag",
        back_populates="media",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_media_org", "organization_id"),
        Index("ix_media_org_type", "organization_id", "media_type"),
        # `folder` is the deprecated virtual-folder string; twelve query sites
        # filter on folder_id (the real FK) and two on folder, so the index
        # covered the column almost nothing uses. Both are kept — the legacy
        # one still has two callers — but folder_id is now indexed too.
        Index("ix_media_org_folder", "organization_id", "folder"),
        Index("ix_media_org_folder_id", "organization_id", "folder_id"),
        Index("ix_media_org_created", "organization_id", "created_at"),
        Index("ix_media_org_format_risk", "organization_id", "format_risk_level"),
        CheckConstraint(
            "media_type IN ('image', 'video', 'audio', 'document', 'model_3d')",
            name="check_media_type",
        ),
        CheckConstraint(
            "processing_status IN ('pending', 'processing', 'completed', 'failed')",
            name="check_media_processing_status",
        ),
        CheckConstraint(
            "copyright_status IS NULL OR copyright_status IN ('public_domain', 'in_copyright', "
            "'copyright_undetermined', 'orphan_work', 'cc_by', 'cc_by_sa', 'cc_by_nc', "
            "'cc_by_nc_sa', 'cc0', 'rights_reserved')",
            name="check_media_copyright_status",
        ),
        {"schema": "media"},
    )


class CollectionObjectMedia(Base):
    """
    Links media to collection objects.

    This is a many-to-many relationship that allows:
    - One object to have multiple media items
    - One media item to be linked to multiple objects
    - Custom sort order and primary designation per object
    - Optional caption override per usage
    """
    __tablename__ = "collection_object_media"

    # Composite primary key
    object_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.collection_objects.object_id", ondelete="CASCADE"),
        primary_key=True,
    )
    media_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media.media_id", ondelete="CASCADE"),
        primary_key=True,
    )

    # Link metadata
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Override caption for this specific usage
    caption_override: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Usage context
    usage_type: Mapped[str | None] = mapped_column(String(50), nullable=True)  # main, detail, context, conservation, etc.

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    object: Mapped["CollectionObject"] = relationship(
        "CollectionObject",
        primaryjoin="CollectionObjectMedia.object_id == CollectionObject.object_id",
    )
    media: Mapped["Media"] = relationship(
        "Media",
        back_populates="collection_object_links",
        primaryjoin="CollectionObjectMedia.media_id == Media.media_id",
    )
    created_by_user: Mapped["User | None"] = relationship(
        "User",
        primaryjoin="CollectionObjectMedia.created_by == User.user_id",
    )

    __table_args__ = (
        Index("ix_object_media_object", "object_id"),
        Index("ix_object_media_media", "media_id"),
        Index("ix_object_media_object_primary", "object_id", "is_primary"),
        Index("ix_object_media_object_sort", "object_id", "sort_order"),
        CheckConstraint(
            "usage_type IS NULL OR usage_type IN ('main', 'detail', 'context', 'conservation', "
            "'installation', 'historical', 'comparison', 'documentation', 'other')",
            name="check_object_media_usage_type",
        ),
        {"schema": "collections"},  # Stays in collections as cross-app link table
    )


# ============================================================================
# DAM - Digital Asset Management
# ============================================================================

class MediaDerivative(Base):
    """
    Generated derivatives of media files.

    Derivatives are generated versions of the original media file at different
    sizes and formats for web display, thumbnails, and tiles for deep zoom.

    The ORIGINAL file (archival master) is stored separately in Media.s3_key.
    Derivatives are access copies generated from the archival master.

    Derivative Hierarchy (based on IIIF/FADGI standards):
    - access_master: 4000px - High-quality for downloads, IIIF deep zoom source
    - large: 2000px - Lightbox / full-screen viewing
    - medium: 1200px - Standard web display
    - small: 600px - Grid views, cards
    - thumbnail: 200px - Lists, navigation
    - square_thumb: 200x200 - Avatar/icon displays (center crop)
    - poster: 800px - Video first frame
    - tile: IIIF deep zoom tiles

    Legacy types (backwards compatibility):
    - preview: Maps to small (600px)
    - web: Maps to medium (1200px)

    S3 Storage: orgs/{org_id}/media/derivatives/{media_id}/{type}.{format}
    """
    __tablename__ = "media_derivatives"

    derivative_id: Mapped[uuid.UUID] = uuid_pk()
    media_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media.media_id", ondelete="CASCADE"),
        nullable=False,
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Derivative type (IIIF/FADGI standard sizes) and format
    derivative_type: Mapped[str] = mapped_column(String(30), nullable=False)
    format: Mapped[str] = mapped_column(String(10), nullable=False)  # jpeg, webp, png, avif

    # File information
    s3_key: Mapped[str] = mapped_column(String(500), nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)

    # Quality settings applied
    quality: Mapped[int | None] = mapped_column(Integer, nullable=True)  # JPEG quality 1-100

    # Audit
    created_at: Mapped[datetime] = timestamp_now()

    # Relationships
    media: Mapped["Media"] = relationship(
        "Media",
        back_populates="derivatives",
        primaryjoin="MediaDerivative.media_id == Media.media_id",
    )

    __table_args__ = (
        Index("ix_media_derivatives_media", "media_id"),
        Index("ix_media_derivatives_org", "organization_id"),
        Index("ix_media_derivatives_media_type", "media_id", "derivative_type"),
        UniqueConstraint("media_id", "derivative_type", "format", name="uq_media_derivative_type_format"),
        CheckConstraint(
            "format IN ('jpeg', 'webp', 'png', 'avif')",
            name="check_derivative_format",
        ),
        {"schema": "media"},
    )


class MediaProcessingJob(Base):
    """
    Track async processing jobs for media files.

    Jobs are created when media is uploaded and processed by Celery workers.
    Supports various job types: derivative generation, transcoding, metadata extraction.
    """
    __tablename__ = "media_processing_jobs"

    job_id: Mapped[uuid.UUID] = uuid_pk()
    media_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media.media_id", ondelete="CASCADE"),
        nullable=False,
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Job configuration
    job_type: Mapped[str] = mapped_column(String(30), nullable=False)  # derivatives, transcode, metadata_extract
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Job parameters and results
    parameters: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Retry handling
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_retries: Mapped[int] = mapped_column(Integer, nullable=False, default=3)

    # Timing
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = timestamp_now()

    # Celery task ID for tracking
    celery_task_id: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Relationships
    media: Mapped["Media"] = relationship(
        "Media",
        back_populates="processing_jobs",
        primaryjoin="MediaProcessingJob.media_id == Media.media_id",
    )

    __table_args__ = (
        Index("ix_media_jobs_media", "media_id"),
        Index("ix_media_jobs_org_status", "organization_id", "status"),
        Index("ix_media_jobs_status_created", "status", "created_at"),
        Index("ix_media_jobs_celery", "celery_task_id"),
        CheckConstraint(
            "job_type IN ('derivatives', 'transcode', 'metadata_extract', 'watermark', 'regenerate', 'model_3d_process', 'metadata_embed')",
            name="check_job_type",
        ),
        CheckConstraint(
            "status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')",
            name="check_job_status",
        ),
        {"schema": "media"},
    )


class MediaVersion(Base):
    """
    Version history for media files.

    When a new file is uploaded to replace an existing media record,
    the previous version is preserved here for potential rollback.
    """
    __tablename__ = "media_versions"

    version_id: Mapped[uuid.UUID] = uuid_pk()
    media_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media.media_id", ondelete="CASCADE"),
        nullable=False,
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Version number (1, 2, 3, etc.)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)

    # File information (from when this was the current version)
    s3_key: Mapped[str] = mapped_column(String(500), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)

    # Integrity
    checksum_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # Metadata at time of versioning
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Version note
    change_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    media: Mapped["Media"] = relationship(
        "Media",
        back_populates="versions",
        primaryjoin="MediaVersion.media_id == Media.media_id",
    )
    created_by_user: Mapped["User | None"] = relationship(
        "User",
        primaryjoin="MediaVersion.created_by == User.user_id",
    )

    __table_args__ = (
        Index("ix_media_versions_media", "media_id"),
        Index("ix_media_versions_org", "organization_id"),
        UniqueConstraint("media_id", "version_number", name="uq_media_version_number"),
        {"schema": "media"},
    )


class WatermarkTemplate(Base):
    """
    Watermark templates for organizations.

    Supports text and image watermarks with configurable position,
    opacity, and styling. Applied during derivative generation.
    """
    __tablename__ = "watermark_templates"

    template_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Template identification
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Watermark type
    watermark_type: Mapped[str] = mapped_column(String(10), nullable=False)  # text, image

    # Configuration (stored as JSONB for flexibility)
    # For text: { text, font, font_size, color, opacity, position, padding }
    # For image: { image_s3_key, opacity, position, padding, scale }
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    updated_at: Mapped[datetime] = timestamp_updated()
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    __table_args__ = (
        Index("ix_watermark_templates_org", "organization_id"),
        Index("ix_watermark_templates_org_default", "organization_id", "is_default"),
        CheckConstraint(
            "watermark_type IN ('text', 'image')",
            name="check_watermark_type",
        ),
        {"schema": "media"},
    )


class MetadataTemplate(Base):
    """
    Metadata templates for organizations.

    Stores reusable metadata configurations that can be applied to media
    assets in bulk operations. Supports flexible field mappings including
    title prefix/suffix, descriptive fields, attribution, rights, and tags.
    """
    __tablename__ = "metadata_templates"

    template_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Template identification
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Template content (JSONB for flexible field configuration)
    # Structure:
    # {
    #     "title_prefix": str | null,      # Prefix to prepend to title
    #     "title_suffix": str | null,      # Suffix to append to title
    #     "description": str | null,       # Full description
    #     "alt_text": str | null,
    #     "creator": str | null,
    #     "credit": str | null,
    #     "source": str | null,
    #     "copyright_status": str | null,  # enum: public_domain, in_copyright, etc.
    #     "rights_statement": str | null,
    #     "license": str | null,
    #     "extra_metadata": dict | null,   # Custom key-value pairs (merged)
    # }
    template_fields: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    updated_at: Mapped[datetime] = timestamp_updated()
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    __table_args__ = (
        Index("ix_metadata_templates_org", "organization_id"),
        Index("ix_metadata_templates_org_default", "organization_id", "is_default"),
        {"schema": "media"},
    )


# ============================================================================
# DAM - Rights Management and Consent Tracking
# ============================================================================

class MediaRights(Base):
    """
    Rights information for media files.

    Supports multiple rights records per media file for complex rights scenarios
    (e.g., different rights for different territories or time periods).

    Based on RightsStatements.org and Creative Commons standards.
    """
    __tablename__ = "media_rights"

    rights_id: Mapped[uuid.UUID] = uuid_pk()
    media_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media.media_id", ondelete="CASCADE"),
        nullable=False,
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Rights type and classification
    rights_type: Mapped[str] = mapped_column(String(30), nullable=False)  # copyright, license, restriction, permission
    rights_status: Mapped[str | None] = mapped_column(String(50), nullable=True)  # in_copyright, public_domain, etc.

    # Rights holder
    rights_holder: Mapped[str | None] = mapped_column(String(255), nullable=True)
    rights_holder_contact: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    # License information
    license_type: Mapped[str | None] = mapped_column(String(50), nullable=True)  # CC-BY, CC0, ARR, etc.
    license_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    license_version: Mapped[str | None] = mapped_column(String(10), nullable=True)

    # Rights statement (free text)
    rights_statement: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Validity period
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Geographic scope
    territory: Mapped[str | None] = mapped_column(String(100), nullable=True)  # ISO 3166-1, or 'worldwide'
    territory_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Usage terms and restrictions
    usage_terms: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    # Example: { commercial_use: true, modification: true, attribution_required: true, ... }
    usage_restrictions: Mapped[list[str] | None] = mapped_column(ARRAY(Text), nullable=True)
    # Simple list of restriction labels: ['No commercial use', 'Attribution required']

    # Status
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")

    # Notes
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    updated_at: Mapped[datetime] = timestamp_updated()
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    media: Mapped["Media"] = relationship(
        "Media",
        back_populates="rights",
        primaryjoin="MediaRights.media_id == Media.media_id",
    )

    __table_args__ = (
        Index("ix_media_rights_media", "media_id"),
        Index("ix_media_rights_org", "organization_id"),
        Index("ix_media_rights_org_license", "organization_id", "license_type"),
        CheckConstraint(
            "rights_type IN ('copyright', 'license', 'restriction', 'permission', 'grant')",
            name="check_rights_type",
        ),
        {"schema": "media"},
    )


class MediaConsent(Base):
    """
    Consent records for media featuring identifiable people.

    Required for publication of media showing individuals.
    Tracks consent forms, scope of consent, and expiration.
    """
    __tablename__ = "media_consent"

    consent_id: Mapped[uuid.UUID] = uuid_pk()
    media_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media.media_id", ondelete="CASCADE"),
        nullable=False,
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Subject information
    subject_name: Mapped[str] = mapped_column(String(255), nullable=False)
    subject_role: Mapped[str | None] = mapped_column(String(100), nullable=True)  # artist, visitor, staff, etc.
    subject_contact: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    # Consent type and scope
    consent_type: Mapped[str] = mapped_column(String(30), nullable=False)  # photo_release, model_release, interview, etc.
    consent_scope: Mapped[str] = mapped_column(String(30), nullable=False)  # internal, public, commercial
    scope_details: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Consent document
    consent_document_key: Mapped[str | None] = mapped_column(String(500), nullable=True)  # S3 key to signed form
    consent_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Validity
    is_valid: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    revocation_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    revocation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Notes
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    updated_at: Mapped[datetime] = timestamp_updated()
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    media: Mapped["Media"] = relationship(
        "Media",
        back_populates="consents",
        primaryjoin="MediaConsent.media_id == Media.media_id",
    )

    __table_args__ = (
        Index("ix_media_consent_media", "media_id"),
        Index("ix_media_consent_org", "organization_id"),
        Index("ix_media_consent_org_valid", "organization_id", "is_valid"),
        CheckConstraint(
            "consent_type IN ('photo_release', 'model_release', 'interview', 'performance', 'general', 'other')",
            name="check_consent_type",
        ),
        CheckConstraint(
            "consent_scope IN ('internal', 'public', 'commercial', 'educational', 'all')",
            name="check_consent_scope",
        ),
        {"schema": "media"},
    )


# ============================================================================
# DAM ENHANCEMENT MODELS - Usage Analytics, Expiration Alerts, Collections
# ============================================================================

class MediaUsageEvent(Base):
    """
    Usage tracking for media files.

    Records views, downloads, embeds, and API access for analytics.
    Supports both authenticated and anonymous tracking.
    """
    __tablename__ = "media_usage_events"

    event_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    media_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media.media_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Event type
    event_type: Mapped[str] = mapped_column(String(30), nullable=False)  # view, download, embed, api_access, share

    # User (null for anonymous/API access)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Access details
    derivative_type: Mapped[str | None] = mapped_column(String(30), nullable=True)  # original, thumbnail, preview
    access_context: Mapped[str | None] = mapped_column(String(30), nullable=True)  # internal, public_api, embed

    # Request metadata
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)  # IPv6 compatible
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)
    referrer: Mapped[str | None] = mapped_column(String(500), nullable=True)
    event_metadata: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    # Timestamp
    created_at: Mapped[datetime] = timestamp_now()

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="MediaUsageEvent.organization_id == Organization.organization_id",
    )
    media: Mapped["Media"] = relationship(
        "Media",
        foreign_keys=[media_id],
    )
    user: Mapped["User | None"] = relationship(
        "User",
        primaryjoin="MediaUsageEvent.user_id == User.user_id",
    )

    __table_args__ = (
        Index("ix_media_usage_events_org_media", "organization_id", "media_id"),
        Index("ix_media_usage_events_created", "created_at"),
        Index("ix_media_usage_events_event_type", "event_type"),
        CheckConstraint(
            "event_type IN ('view', 'download', 'embed', 'api_access', 'share')",
            name="check_media_usage_event_type",
        ),
        {"schema": "media"},
    )


class ExpirationAlert(Base):
    """
    Alerts for expiring rights and consent records.

    Generated by scheduled job to warn about upcoming expirations.
    Supports dismissal, email notifications, and severity levels.
    """
    __tablename__ = "expiration_alerts"

    alert_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    media_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media.media_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Alert type and related record
    alert_type: Mapped[str] = mapped_column(String(30), nullable=False)  # rights, consent
    related_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)  # rights_id or consent_id

    # Expiration details
    expiry_date: Mapped[date] = mapped_column(Date, nullable=False)
    days_until_expiry: Mapped[int] = mapped_column(Integer, nullable=False)

    # Severity: warning (60-90d), urgent (30-60d), critical (<30d)
    severity: Mapped[str] = mapped_column(String(20), nullable=False)

    # Status: active, dismissed, resolved, acknowledged
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")

    # Dismissal tracking
    dismissed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    dismissed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Email notification tracking
    email_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Notes
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="ExpirationAlert.organization_id == Organization.organization_id",
    )
    media: Mapped["Media"] = relationship(
        "Media",
        foreign_keys=[media_id],
    )
    dismissed_by_user: Mapped["User | None"] = relationship(
        "User",
        primaryjoin="ExpirationAlert.dismissed_by == User.user_id",
    )

    __table_args__ = (
        Index("ix_expiration_alerts_org_status", "organization_id", "status"),
        Index("ix_expiration_alerts_expiry", "expiry_date"),
        Index("ix_expiration_alerts_severity", "severity"),
        Index("ix_expiration_alerts_related", "alert_type", "related_id", unique=True),
        CheckConstraint(
            "alert_type IN ('rights', 'consent')",
            name="check_expiration_alert_type",
        ),
        CheckConstraint(
            "severity IN ('warning', 'urgent', 'critical')",
            name="check_expiration_alert_severity",
        ),
        CheckConstraint(
            "status IN ('active', 'dismissed', 'resolved', 'acknowledged')",
            name="check_expiration_alert_status",
        ),
        {"schema": "collections"},
    )


class MediaCollection(Base):
    """
    User-created media collections (lightboxes).

    Supports organizing media into shareable groups with
    visibility controls and consent clearance for public sharing.
    """
    __tablename__ = "media_collections"

    collection_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Collection details
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    cover_media_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media.media_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Visibility: private (owner only), org (organization members), public (shareable link)
    visibility: Mapped[str] = mapped_column(String(20), nullable=False, default="private")

    # Public sharing
    public_share_token: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    public_share_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Optional expiration; after this datetime the public endpoint returns 410.
    public_share_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Optional password (bcrypt/argon2 hash). When set, the public endpoint
    # challenges for the password and returns 401 until accepted.
    public_share_password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # What viewers can do:
    #   'none'        — view metadata/thumbnails only (no originals or derivatives)
    #   'derivatives' — can download derivatives (web-size etc.)
    #   'originals'   — can download originals
    public_share_download_level: Mapped[str] = mapped_column(
        String(20), nullable=False, default="none", server_default="none",
    )

    # Consent clearance for public sharing
    consent_clearance_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    consent_cleared_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    consent_cleared_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Item count (denormalized for performance)
    item_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Smart collection (saved search)
    collection_type: Mapped[str] = mapped_column(String(10), nullable=False, default="manual")  # manual or smart
    saved_search: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # Search criteria for smart collections
    auto_refresh: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    last_refreshed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    refresh_interval_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=15)

    # Owner
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="MediaCollection.organization_id == Organization.organization_id",
    )
    cover_media: Mapped["Media | None"] = relationship(
        "Media",
        foreign_keys=[cover_media_id],
    )
    owner: Mapped["User | None"] = relationship(
        "User",
        primaryjoin="MediaCollection.created_by == User.user_id",
        foreign_keys=[created_by],
    )
    consent_clearer: Mapped["User | None"] = relationship(
        "User",
        primaryjoin="MediaCollection.consent_cleared_by == User.user_id",
        foreign_keys=[consent_cleared_by],
    )
    items: Mapped[list["MediaCollectionItem"]] = relationship(
        "MediaCollectionItem",
        back_populates="collection",
        cascade="all, delete-orphan",
    )
    shares: Mapped[list["MediaCollectionShare"]] = relationship(
        "MediaCollectionShare",
        back_populates="collection",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_media_collections_org", "organization_id"),
        Index("ix_media_collections_created_by", "created_by"),
        Index("ix_media_collections_visibility", "visibility"),
        Index("ix_media_collections_share_token", "public_share_token"),
        Index("ix_media_collections_type", "organization_id", "collection_type"),
        CheckConstraint(
            "visibility IN ('private', 'org', 'public')",
            name="check_media_collection_visibility",
        ),
        CheckConstraint(
            "collection_type IN ('manual', 'smart')",
            name="check_media_collection_type",
        ),
        CheckConstraint(
            "public_share_download_level IN ('none', 'derivatives', 'originals')",
            name="check_media_collection_share_download_level",
        ),
        {"schema": "media"},
    )


class MediaCollectionShareAccess(Base):
    """
    Access audit log for public share tokens on MediaCollection.

    One row per view or download against a public share URL. Used to give
    owners visibility into how their share link is being used and to help
    diagnose abuse.
    """
    __tablename__ = "media_collection_share_access"

    access_id: Mapped[uuid.UUID] = uuid_pk()
    collection_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media_collections.collection_id", ondelete="CASCADE"),
        nullable=False,
    )
    accessed_at: Mapped[datetime] = timestamp_now()
    # 'view' — landed on the public page; 'auth' — password challenge (success/fail);
    # 'download' — downloaded a specific media item.
    action: Mapped[str] = mapped_column(String(20), nullable=False)
    # For downloads: which media item was pulled.
    media_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media.media_id", ondelete="SET NULL"),
        nullable=True,
    )
    # For auth events: true on success, false on failure. Null for other actions.
    auth_success: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    # Best-effort client identification. Stored raw; no PII inference.
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    referrer: Mapped[str | None] = mapped_column(Text, nullable=True)

    collection: Mapped["MediaCollection"] = relationship(
        "MediaCollection",
        foreign_keys=[collection_id],
    )

    __table_args__ = (
        Index("ix_media_collection_share_access_collection", "collection_id", "accessed_at"),
        Index("ix_media_collection_share_access_media", "media_id"),
        CheckConstraint(
            "action IN ('view', 'auth', 'download')",
            name="check_media_collection_share_access_action",
        ),
        {"schema": "media"},
    )


class MediaCollectionItem(Base):
    """
    Items in a media collection.

    Composite primary key (collection_id, media_id) ensures unique items.
    Sort order enables custom arrangement of items.
    """
    __tablename__ = "media_collection_items"

    # Composite primary key
    collection_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media_collections.collection_id", ondelete="CASCADE"),
        primary_key=True,
    )
    media_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media.media_id", ondelete="CASCADE"),
        primary_key=True,
    )

    # Ordering
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Optional notes
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Audit
    added_at: Mapped[datetime] = timestamp_now()
    added_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    collection: Mapped["MediaCollection"] = relationship(
        "MediaCollection",
        back_populates="items",
    )
    media: Mapped["Media"] = relationship(
        "Media",
        foreign_keys=[media_id],
    )
    added_by_user: Mapped["User | None"] = relationship(
        "User",
        primaryjoin="MediaCollectionItem.added_by == User.user_id",
    )

    __table_args__ = (
        Index("ix_media_collection_items_order", "collection_id", "sort_order"),
        {"schema": "media"},
    )


class MediaCollectionShare(Base):
    """
    Sharing permissions for media collections.

    Allows collection owners to share with specific users or roles
    with viewer or editor permission levels.
    """
    __tablename__ = "media_collection_shares"

    share_id: Mapped[uuid.UUID] = uuid_pk()
    collection_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media_collections.collection_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Principal can be a user or a role (one must be set)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="CASCADE"),
        nullable=True,
    )
    role_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("roles.role_id", ondelete="CASCADE"),
        nullable=True,
    )

    # Role/permission level: viewer (read-only), editor (can add/remove items)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="viewer")

    # Who shared
    shared_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    shared_at: Mapped[datetime] = timestamp_now()

    # Relationships
    collection: Mapped["MediaCollection"] = relationship(
        "MediaCollection",
        back_populates="shares",
    )
    user: Mapped["User | None"] = relationship(
        "User",
        primaryjoin="MediaCollectionShare.user_id == User.user_id",
        foreign_keys=[user_id],
    )
    shared_role: Mapped["Role | None"] = relationship(
        "Role",
        foreign_keys=[role_id],
    )
    shared_by_user: Mapped["User | None"] = relationship(
        "User",
        primaryjoin="MediaCollectionShare.shared_by == User.user_id",
        foreign_keys=[shared_by],
    )

    __table_args__ = (
        Index("ix_media_collection_shares_user", "user_id"),
        Index("ix_media_collection_shares_collection", "collection_id"),
        Index("ix_media_collection_shares_role", "role_id"),
        # Unique constraint for user shares (when user_id is set)
        Index(
            "uq_media_collection_shares_collection_user",
            "collection_id", "user_id",
            unique=True,
            postgresql_where=text("user_id IS NOT NULL"),
        ),
        # Unique constraint for role shares (when role_id is set)
        Index(
            "uq_media_collection_shares_collection_role",
            "collection_id", "role_id",
            unique=True,
            postgresql_where=text("role_id IS NOT NULL"),
        ),
        CheckConstraint(
            "role IN ('viewer', 'editor')",
            name="check_media_collection_share_role",
        ),
        # Ensure at least one principal is set
        CheckConstraint(
            "user_id IS NOT NULL OR role_id IS NOT NULL",
            name="check_media_collection_share_principal",
        ),
        {"schema": "media"},
    )


# ============================================================================
# MEDIA TAGS - Flexible organization-level tag system
# ============================================================================

# Tag field types — controls UI rendering and value validation.
# Mirrors ResourceSpace's field_type concept.
MEDIA_TAG_FIELD_TYPES = (
    "text",               # Free text, no controlled vocabulary
    "dropdown",           # Single-select from allowed values
    "multi_select",       # Multi-select from allowed values (implies allow_multiple)
    "category_tree",      # Hierarchical allowed values via parent_id
    "dynamic_keywords",   # Autocomplete from allowed values, can add new on save
    "date",               # Single date value
)


class MediaTagDefinition(Base):
    """
    Organization-level tag key definitions.

    Admins create these to define what tags are available for media items.
    Tag keys are unique per organization, and can be soft-deleted.
    """
    __tablename__ = "media_tag_definitions"

    definition_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Tag key and display
    tag_key: Mapped[str] = mapped_column(String(100), nullable=False)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Configuration
    # field_type drives UX + validation; see MEDIA_TAG_FIELD_TYPES for values.
    field_type: Mapped[str] = mapped_column(String(32), nullable=False, default="text", server_default="text")
    # Whether this definition accepts multiple values per media item.
    # Always True for multi_select/category_tree; optional for others.
    allow_multiple: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    is_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    updated_at: Mapped[datetime] = timestamp_updated()

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="MediaTagDefinition.organization_id == Organization.organization_id",
    )
    created_by_user: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[created_by],
        primaryjoin="MediaTagDefinition.created_by == User.user_id",
    )
    tags: Mapped[list["MediaTag"]] = relationship(
        "MediaTag",
        back_populates="definition",
        cascade="all, delete-orphan",
    )
    allowed_values: Mapped[list["MediaTagValue"]] = relationship(
        "MediaTagValue",
        back_populates="definition",
        cascade="all, delete-orphan",
        order_by="MediaTagValue.sort_order",
    )

    __table_args__ = (
        Index("ix_media_tag_definitions_org", "organization_id"),
        Index("ix_media_tag_definitions_org_active", "organization_id", "is_active"),
        Index("ix_media_tag_definitions_org_sort", "organization_id", "sort_order"),
        UniqueConstraint("organization_id", "tag_key", name="uq_org_tag_key"),
        CheckConstraint(
            "field_type IN ('text','dropdown','multi_select','category_tree','dynamic_keywords','date')",
            name="ck_media_tag_definition_field_type",
        ),
        {"schema": "media"},
    )


class MediaTagValue(Base):
    """
    Controlled allowed-values ("nodes") for a MediaTagDefinition.

    Each value belongs to a single definition; values can be hierarchical via
    `parent_id` (adjacency list, only used by category_tree). `is_active=False`
    is a soft-delete that hides the value from pickers but keeps it displayable
    on existing tagged media.
    """
    __tablename__ = "media_tag_values"

    value_id: Mapped[uuid.UUID] = uuid_pk()
    definition_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media_tag_definitions.definition_id", ondelete="CASCADE"),
        nullable=False,
    )
    # Adjacency-list parent; NULL = root.
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media_tag_values.value_id", ondelete="CASCADE"),
        nullable=True,
    )
    value: Mapped[str] = mapped_column(String(500), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")

    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    definition: Mapped["MediaTagDefinition"] = relationship(
        "MediaTagDefinition",
        back_populates="allowed_values",
    )
    parent: Mapped["MediaTagValue | None"] = relationship(
        "MediaTagValue",
        remote_side="MediaTagValue.value_id",
        back_populates="children",
    )
    children: Mapped[list["MediaTagValue"]] = relationship(
        "MediaTagValue",
        back_populates="parent",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_media_tag_values_definition", "definition_id"),
        Index("ix_media_tag_values_parent", "parent_id"),
        Index("ix_media_tag_values_def_sort", "definition_id", "sort_order"),
        # Siblings (same parent under same definition) must have unique values.
        # NULLS NOT DISTINCT so roots are compared too.
        UniqueConstraint(
            "definition_id",
            "parent_id",
            "value",
            name="uq_media_tag_value_sibling",
            postgresql_nulls_not_distinct=True,
        ),
        {"schema": "media"},
    )


class MediaTag(Base):
    """
    Tag values assigned to media items.

    References a tag definition for the key, ensuring only valid tag keys are used.
    A media item may have multiple tags for the same definition when the
    definition's `allow_multiple` is True.

    For controlled field types (dropdown, multi_select, category_tree,
    dynamic_keywords), `value_id` points at a MediaTagValue row and
    `tag_value` mirrors the value's string for denormalized display.
    For `text`/`date`, `value_id` is NULL and `tag_value` is the free-form value.
    """
    __tablename__ = "media_tags"

    tag_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    media_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media.media_id", ondelete="CASCADE"),
        nullable=False,
    )
    definition_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media_tag_definitions.definition_id", ondelete="CASCADE"),
        nullable=False,
    )
    # References a MediaTagValue row for controlled field types. NULL for
    # text/date. Cascade-deletes when the allowed value is hard-deleted.
    value_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media_tag_values.value_id", ondelete="CASCADE"),
        nullable=True,
    )

    # The actual tag value (denormalized for controlled types; authoritative for text/date)
    tag_value: Mapped[str] = mapped_column(String(500), nullable=False)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="MediaTag.organization_id == Organization.organization_id",
    )
    media: Mapped["Media"] = relationship(
        "Media",
        back_populates="structured_tags",
    )
    definition: Mapped["MediaTagDefinition"] = relationship(
        "MediaTagDefinition",
        back_populates="tags",
    )
    value: Mapped["MediaTagValue | None"] = relationship(
        "MediaTagValue",
        foreign_keys=[value_id],
    )
    created_by_user: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[created_by],
        primaryjoin="MediaTag.created_by == User.user_id",
    )

    __table_args__ = (
        Index("ix_media_tags_org", "organization_id"),
        Index("ix_media_tags_media", "media_id"),
        Index("ix_media_tags_definition", "definition_id"),
        Index("ix_media_tags_def_value", "definition_id", "tag_value"),
        # Free-text / date definitions allow at most one row per (media, definition).
        Index(
            "uq_media_tag_text",
            "media_id",
            "definition_id",
            unique=True,
            postgresql_where="value_id IS NULL",
        ),
        # Controlled definitions allow multiple rows per (media, definition), but
        # each (media, definition, value) tuple must be unique so you can't apply
        # the same value twice.
        Index(
            "uq_media_tag_value",
            "media_id",
            "definition_id",
            "value_id",
            unique=True,
            postgresql_where="value_id IS NOT NULL",
        ),
        {"schema": "media"},
    )


# ============================================================================
# AI TAGGING - Automatic tag detection using AWS Rekognition and pypdfium2
# ============================================================================

class MediaAIConfig(Base):
    """
    Per-organization AI tagging configuration.

    Controls which AI features are enabled (labels, text, faces, etc.),
    confidence thresholds, and optional monthly budget caps.
    """
    __tablename__ = "media_ai_config"

    config_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )

    # Feature toggles
    auto_tag_on_upload: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    detect_labels: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    detect_text: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    detect_faces: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    detect_celebrities: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    detect_moderation: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    extract_pdf_text: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Thresholds
    min_label_confidence: Mapped[Decimal] = mapped_column(
        Numeric(3, 2), nullable=False, default=Decimal("0.70")
    )
    min_text_confidence: Mapped[Decimal] = mapped_column(
        Numeric(3, 2), nullable=False, default=Decimal("0.80")
    )
    max_labels_per_image: Mapped[int] = mapped_column(Integer, nullable=False, default=50)

    # Cost controls
    monthly_budget_usd: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    current_month_usage: Mapped[Decimal] = mapped_column(
        Numeric(10, 4), nullable=False, default=Decimal("0.0000")
    )
    usage_reset_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="MediaAIConfig.organization_id == Organization.organization_id",
    )

    __table_args__ = (
        {"schema": "media"},
    )


class MediaAITagMapping(Base):
    """
    Maps AI labels to organization tag definitions.

    When an AI-detected label matches a mapping, the system can automatically
    create a MediaTag with the mapped value. Allows orgs to customize how
    AI labels translate to their controlled vocabulary.
    """
    __tablename__ = "media_ai_tag_mappings"

    mapping_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # AI side
    ai_tag_type: Mapped[str] = mapped_column(String(50), nullable=False)
    ai_tag_value: Mapped[str] = mapped_column(String(500), nullable=False)

    # Organization side
    definition_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media_tag_definitions.definition_id", ondelete="CASCADE"),
        nullable=False,
    )
    mapped_value: Mapped[str] = mapped_column(String(500), nullable=False)

    # Config
    auto_apply: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    min_confidence: Mapped[Decimal] = mapped_column(
        Numeric(3, 2), nullable=False, default=Decimal("0.80")
    )

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="MediaAITagMapping.organization_id == Organization.organization_id",
    )
    definition: Mapped["MediaTagDefinition"] = relationship(
        "MediaTagDefinition",
        primaryjoin="MediaAITagMapping.definition_id == MediaTagDefinition.definition_id",
    )

    __table_args__ = (
        Index("ix_ai_tag_mappings_org", "organization_id"),
        Index("ix_ai_tag_mappings_lookup", "organization_id", "ai_tag_type", "ai_tag_value"),
        UniqueConstraint("organization_id", "ai_tag_type", "ai_tag_value",
                        name="uq_ai_tag_mapping_org_type_value"),
        CheckConstraint(
            "ai_tag_type IN ('label', 'text', 'face', 'color', 'celebrity', 'moderation')",
            name="check_ai_tag_mapping_type",
        ),
        {"schema": "media"},
    )


class MediaAITag(Base):
    """
    AI-detected tags for media assets.

    Stores raw AI analysis results with confidence scores, separate from
    user-managed MediaTag records. Supports:
    - Label detection (objects, scenes, concepts)
    - Text detection (OCR)
    - Face detection (optional)
    - PDF text extraction

    Each tag includes a confidence score and optional bounding box for
    spatial tags (faces, text regions).
    """
    __tablename__ = "media_ai_tags"

    ai_tag_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    media_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media.media_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Tag details
    tag_type: Mapped[str] = mapped_column(String(50), nullable=False)
    tag_value: Mapped[str] = mapped_column(String(1000), nullable=False)
    confidence: Mapped[Decimal] = mapped_column(Numeric(5, 4), nullable=False)

    # Additional context (JSON)
    # For labels: {"parents": ["Vehicle", "Transportation"]}
    # For faces: {"age_range": {"low": 20, "high": 30}, "emotions": [...]}
    # For text: {"geometry": {...}, "type": "LINE", "page_number": 1}
    tag_metadata: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    # Bounding box (if applicable) - values are 0.0-1.0 representing percentage
    bbox_left: Mapped[Decimal | None] = mapped_column(Numeric(7, 6), nullable=True)
    bbox_top: Mapped[Decimal | None] = mapped_column(Numeric(7, 6), nullable=True)
    bbox_width: Mapped[Decimal | None] = mapped_column(Numeric(7, 6), nullable=True)
    bbox_height: Mapped[Decimal | None] = mapped_column(Numeric(7, 6), nullable=True)

    # Processing info
    provider: Mapped[str] = mapped_column(String(50), nullable=False, default="rekognition")
    model_version: Mapped[str | None] = mapped_column(String(100), nullable=True)
    processed_at: Mapped[datetime] = timestamp_now()

    # Mapping to user tags
    mapped_to_definition_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media_tag_definitions.definition_id", ondelete="SET NULL"),
        nullable=True,
    )
    mapping_status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="MediaAITag.organization_id == Organization.organization_id",
    )
    media: Mapped["Media"] = relationship(
        "Media",
        back_populates="ai_tags",
    )
    mapped_definition: Mapped["MediaTagDefinition | None"] = relationship(
        "MediaTagDefinition",
        primaryjoin="MediaAITag.mapped_to_definition_id == MediaTagDefinition.definition_id",
    )

    __table_args__ = (
        Index("ix_media_ai_tags_org", "organization_id"),
        Index("ix_media_ai_tags_media", "media_id"),
        Index("ix_media_ai_tags_type", "organization_id", "tag_type"),
        Index("ix_media_ai_tags_value", "organization_id", "tag_type", "tag_value"),
        Index("ix_media_ai_tags_confidence", "organization_id", "confidence"),
        Index("ix_media_ai_tags_mapping_status", "organization_id", "mapping_status"),
        CheckConstraint(
            "tag_type IN ('label', 'text', 'face', 'color', 'celebrity', 'moderation')",
            name="check_ai_tag_type",
        ),
        CheckConstraint(
            "mapping_status IN ('pending', 'mapped', 'rejected', 'ignored')",
            name="check_ai_tag_mapping_status",
        ),
        CheckConstraint(
            "confidence >= 0 AND confidence <= 1",
            name="check_ai_tag_confidence_range",
        ),
        {"schema": "media"},
    )


# ============================================================================
# MEDIA FIELD INHERITANCE CONFIG
# ============================================================================

class MediaFieldInheritanceConfig(Base):
    """
    Configuration for inheriting CollectionObject fields on linked Media.

    When Media is linked to CollectionObjects, configurable metadata fields
    from the object can be displayed in the Media app without overwriting
    the Media's own fields. This table defines which fields to inherit
    and how to transform/display them.
    """
    __tablename__ = "media_field_inheritance_config"

    config_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Source field from CollectionObject
    source_field: Mapped[str] = mapped_column(String(100), nullable=False)

    # Display configuration
    display_label: Mapped[str] = mapped_column(String(100), nullable=False)
    display_context: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="both",
    )  # detail, list, both

    # Transform configuration for array/complex fields
    transform_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # array_first, array_join, array_concat_field, null for no transform
    transform_config: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    # e.g., {"separator": ", ", "field": "name"} for array_concat_field

    # Display order and activation
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="MediaFieldInheritanceConfig.organization_id == Organization.organization_id",
    )

    __table_args__ = (
        Index("ix_media_field_inheritance_config_org", "organization_id"),
        Index(
            "ix_media_field_inheritance_config_org_active",
            "organization_id", "is_active", "sort_order",
        ),
        UniqueConstraint(
            "organization_id", "source_field",
            name="uq_media_field_inheritance_config_org_field",
        ),
        CheckConstraint(
            "display_context IN ('detail', 'list', 'both')",
            name="check_field_inheritance_display_context",
        ),
        CheckConstraint(
            "transform_type IS NULL OR transform_type IN "
            "('array_first', 'array_join', 'array_concat_field')",
            name="check_field_inheritance_transform_type",
        ),
        {"schema": "media"},
    )


# ============================================================================
# MEDIA DOWNLOAD REQUESTS - Workflow for requesting high-res downloads
# ============================================================================

class MediaDownloadRequest(Base):
    """
    Download request for high-resolution media from lightboxes.

    Workflow: submitted -> review -> approved/denied -> fulfilled -> (expired)

    Read-only users can request high-res downloads from their lightbox.
    Staff reviews and fulfills requests, generating secure download tokens.
    """
    __tablename__ = "media_download_requests"

    request_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    request_number: Mapped[str] = mapped_column(String(50), nullable=False)
    collection_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media_collections.collection_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Requester info (cached for historical record)
    requester_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="RESTRICT"),
        nullable=False,
    )
    requester_name: Mapped[str] = mapped_column(String(255), nullable=False)
    requester_email: Mapped[str] = mapped_column(String(255), nullable=False)
    requester_institution: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Request details
    purpose: Mapped[str] = mapped_column(String(50), nullable=False)
    # research, publication, exhibition, commercial, educational, personal, other
    intended_use: Mapped[str] = mapped_column(Text, nullable=False)
    project_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    derivative_type_requested: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="access_master",
    )  # access_master, large, original, watermarked

    # Workflow status
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="submitted")
    # submitted, review, approved, denied, fulfilled, expired, cancelled

    # Review stage
    reviewed_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    review_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Approval stage
    approved_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    approval_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approval_conditions: Mapped[str | None] = mapped_column(Text, nullable=True)
    denial_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Fulfillment stage
    fulfilled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    fulfilled_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    fulfillment_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Download access
    download_token: Mapped[str | None] = mapped_column(String(64), nullable=True)
    download_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    download_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_downloads: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Timestamps
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="MediaDownloadRequest.organization_id == Organization.organization_id",
    )
    collection: Mapped["MediaCollection | None"] = relationship(
        "MediaCollection",
        primaryjoin="MediaDownloadRequest.collection_id == MediaCollection.collection_id",
    )
    requester: Mapped["User"] = relationship(
        "User",
        foreign_keys=[requester_id],
        primaryjoin="MediaDownloadRequest.requester_id == User.user_id",
    )
    reviewer: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[reviewed_by_id],
        primaryjoin="MediaDownloadRequest.reviewed_by_id == User.user_id",
    )
    approver: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[approved_by_id],
        primaryjoin="MediaDownloadRequest.approved_by_id == User.user_id",
    )
    fulfiller: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[fulfilled_by_id],
        primaryjoin="MediaDownloadRequest.fulfilled_by_id == User.user_id",
    )
    items: Mapped[list["MediaDownloadRequestItem"]] = relationship(
        "MediaDownloadRequestItem",
        back_populates="request",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_media_download_requests_org", "organization_id"),
        Index("ix_media_download_requests_org_status", "organization_id", "status"),
        Index("ix_media_download_requests_requester", "requester_id"),
        Index(
            "ix_media_download_requests_token",
            "download_token",
            unique=True,
            postgresql_where=text("download_token IS NOT NULL"),
        ),
        UniqueConstraint(
            "organization_id", "request_number",
            name="uq_media_download_requests_org_number",
        ),
        CheckConstraint(
            "purpose IN ('research', 'publication', 'exhibition', 'commercial', "
            "'educational', 'personal', 'other')",
            name="check_download_request_purpose",
        ),
        CheckConstraint(
            "status IN ('submitted', 'review', 'approved', 'denied', 'fulfilled', "
            "'expired', 'cancelled')",
            name="check_download_request_status",
        ),
        CheckConstraint(
            "derivative_type_requested IN ('access_master', 'large', 'original', 'watermarked')",
            name="check_download_request_derivative_type",
        ),
        {"schema": "media"},
    )


class MediaDownloadRequestItem(Base):
    """
    Individual media item within a download request.

    Allows partial approval where some items may be approved while others
    are denied within the same request.
    """
    __tablename__ = "media_download_request_items"

    item_id: Mapped[uuid.UUID] = uuid_pk()
    request_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media_download_requests.request_id", ondelete="CASCADE"),
        nullable=False,
    )
    media_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media.media_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Per-item status for partial approval
    item_status: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="pending",
    )  # pending, approved, denied

    # Per-item notes (e.g., why this item was denied)
    item_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Download tracking
    downloaded: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    downloaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relationships
    request: Mapped["MediaDownloadRequest"] = relationship(
        "MediaDownloadRequest",
        back_populates="items",
    )
    media: Mapped["Media"] = relationship(
        "Media",
        primaryjoin="MediaDownloadRequestItem.media_id == Media.media_id",
    )

    __table_args__ = (
        Index("ix_media_download_request_items_request", "request_id"),
        Index("ix_media_download_request_items_media", "media_id"),
        UniqueConstraint(
            "request_id", "media_id",
            name="uq_media_download_request_items_request_media",
        ),
        CheckConstraint(
            "item_status IN ('pending', 'approved', 'denied')",
            name="check_download_request_item_status",
        ),
        {"schema": "media"},
    )


# ============================================================================
# MEDIA EMBEDDINGS - CLIP / Face / Text vector embeddings (pgvector)
# ============================================================================

class MediaEmbedding(Base):
    """
    Vector embeddings for media items (CLIP image, CLIP text, face embeddings).

    Uses pgvector for approximate nearest neighbor search (IVFFlat index).
    Each media item can have one embedding per type.
    """
    __tablename__ = "media_embeddings"

    embedding_id: Mapped[uuid.UUID] = uuid_pk()
    media_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media.media_id", ondelete="CASCADE"),
        nullable=False,
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Embedding type: clip_image, clip_text, face
    embedding_type: Mapped[str] = mapped_column(String(20), nullable=False)
    model_name: Mapped[str] = mapped_column(String(100), nullable=False, default="ViT-B/32")

    # The embedding vector — pgvector native column for ANN search
    embedding_data: Mapped[list | None] = mapped_column(JSONB, nullable=True, comment="Legacy JSONB storage, kept for migration compatibility")
    embedding_vector = mapped_column(Vector(512), nullable=True, comment="pgvector native column for cosine similarity search")

    # Source derivative used to generate embedding
    source_derivative: Mapped[str | None] = mapped_column(String(50), nullable=True)
    checksum_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)

    created_at: Mapped[datetime] = timestamp_now()

    # Relationships
    media: Mapped["Media"] = relationship(
        "Media",
        primaryjoin="MediaEmbedding.media_id == Media.media_id",
    )

    __table_args__ = (
        UniqueConstraint("media_id", "embedding_type", name="uq_media_embedding_type"),
        Index("ix_media_embeddings_org", "organization_id"),
        Index("ix_media_embeddings_media", "media_id"),
        Index("ix_media_embeddings_type", "organization_id", "embedding_type"),
        CheckConstraint(
            "embedding_type IN ('clip_image', 'clip_text', 'face')",
            name="check_embedding_type",
        ),
        {"schema": "media"},
    )


# ============================================================================
# MEDIA ALTERNATIVES - Transcripts, subtitles, conversions, crops
# ============================================================================

class MediaAlternative(Base):
    """
    Alternative files associated with a media item.

    Types include: transcript_txt, subtitle_srt, subtitle_vtt,
    crop, conversion, ocr_txt, etc. Generated by Whisper, manual upload,
    or format conversion.
    """
    __tablename__ = "media_alternatives"

    alternative_id: Mapped[uuid.UUID] = uuid_pk()
    media_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media.media_id", ondelete="CASCADE"),
        nullable=False,
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Alternative type
    alternative_type: Mapped[str] = mapped_column(String(30), nullable=False)
    label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Storage
    s3_key: Mapped[str] = mapped_column(String(500), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Generation info
    generated_by: Mapped[str | None] = mapped_column(String(50), nullable=True)  # whisper, manual, conversion
    generation_params: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    media: Mapped["Media"] = relationship(
        "Media",
        primaryjoin="MediaAlternative.media_id == Media.media_id",
    )

    __table_args__ = (
        Index("ix_media_alternatives_media", "media_id"),
        Index("ix_media_alternatives_org", "organization_id"),
        Index("ix_media_alternatives_type", "media_id", "alternative_type"),
        CheckConstraint(
            "alternative_type IN ('transcript_txt', 'subtitle_srt', 'subtitle_vtt', "
            "'crop', 'conversion', 'ocr_txt')",
            name="check_alternative_type",
        ),
        {"schema": "media"},
    )


# ============================================================================
# MEDIA ANNOTATIONS - W3C Web Annotation model for image regions
# ============================================================================

class MediaAnnotation(Base):
    """
    Image annotations following the W3C Web Annotation model.

    Supports drawing regions on images and linking to metadata/comments.
    """
    __tablename__ = "media_annotations"

    annotation_id: Mapped[uuid.UUID] = uuid_pk()
    media_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media.media_id", ondelete="CASCADE"),
        nullable=False,
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # W3C Web Annotation model
    target_selector: Mapped[dict] = mapped_column(JSONB, nullable=False)  # Region selector
    body: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # Annotation body (text, tags, etc.)
    motivation: Mapped[str | None] = mapped_column(String(50), nullable=True)  # commenting, tagging, describing

    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    updated_at: Mapped[datetime] = timestamp_updated()

    # Relationships
    media: Mapped["Media"] = relationship(
        "Media",
        primaryjoin="MediaAnnotation.media_id == Media.media_id",
    )

    __table_args__ = (
        Index("ix_media_annotations_media", "media_id"),
        Index("ix_media_annotations_org", "organization_id"),
        {"schema": "media"},
    )


# ============================================================================
# MEDIA LOCK - Pessimistic locking for concurrent edits
# ============================================================================

class MediaLock(Base):
    """
    Resource lock on a media item to prevent concurrent edits.

    Locks auto-expire after 30 minutes. Check on PUT/PATCH and return 409
    if locked by another user.
    """
    __tablename__ = "media_locks"

    lock_id: Mapped[uuid.UUID] = uuid_pk()
    media_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media.media_id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    locked_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="CASCADE"),
        nullable=False,
    )
    locked_at: Mapped[datetime] = timestamp_now()
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    # Relationships
    media: Mapped["Media"] = relationship(
        "Media",
        primaryjoin="MediaLock.media_id == Media.media_id",
    )
    user: Mapped["User"] = relationship(
        "User",
        primaryjoin="MediaLock.locked_by == User.user_id",
    )

    __table_args__ = (
        Index("ix_media_locks_expires", "expires_at"),
        {"schema": "media"},
    )


# ============================================================================
# DERIVATIVE SIZE CONFIG - Admin-managed download size presets
# ============================================================================

class DerivativeSizeConfig(Base):
    """
    Derivative generation and download size presets.

    Rows with ``organization_id IS NULL`` are **system defaults** that ship
    with Madrona.  Per-org rows override them (matched by media_type).

    ``is_processing=True`` rows drive the Celery processing pipeline
    (which derivatives to generate on upload).  ``is_processing=False``
    rows are download-only presets shown to end-users.
    """
    __tablename__ = "derivative_size_configs"

    config_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=True,  # NULL = system default
    )

    name: Mapped[str] = mapped_column(String(50), nullable=False)  # Internal key
    label: Mapped[str] = mapped_column(String(100), nullable=False)  # Display label
    media_type: Mapped[str | None] = mapped_column(String(20), nullable=True)  # image, video, document, model_3d
    max_width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    format: Mapped[str] = mapped_column(String(10), nullable=False, default="jpeg")
    quality: Mapped[int | None] = mapped_column(Integer, nullable=True, default=85)
    config: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # Type-specific params (codec, bitrate, dpi…)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[datetime] = timestamp_now()

    __table_args__ = (
        UniqueConstraint("organization_id", "media_type", "name", name="uq_derivative_size_org_type_name"),
        Index("ix_derivative_size_configs_org", "organization_id"),
        CheckConstraint(
            "media_type IN ('image', 'video', 'audio', 'document', 'model_3d')",
            name="check_derivative_size_media_type",
        ),
        {"schema": "media"},
    )


# ============================================================================
# MEDIA SEARCH SUBSCRIPTION - Saved search notifications
# ============================================================================

class MediaSearchSubscription(Base):
    """
    Subscription for notifications when saved search results change.
    """
    __tablename__ = "media_search_subscriptions"

    subscription_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="CASCADE"),
        nullable=False,
    )

    search_params: Mapped[dict] = mapped_column(JSONB, nullable=False)
    notify_on_new: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    notification_channel: Mapped[str] = mapped_column(String(20), nullable=False, default="email")

    last_result_ids: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = timestamp_now()

    __table_args__ = (
        Index("ix_media_search_subscriptions_user", "user_id"),
        Index("ix_media_search_subscriptions_org", "organization_id"),
        {"schema": "media"},
    )


__all__ = [
    "MediaFolder",
    "Media",
    "CollectionObjectMedia",
    "MediaDerivative",
    "MediaProcessingJob",
    "MediaVersion",
    "WatermarkTemplate",
    "MetadataTemplate",
    "MediaRights",
    "MediaConsent",
    "MediaUsageEvent",
    "ExpirationAlert",
    "MediaCollection",
    "MediaCollectionItem",
    "MediaCollectionShare",
    "MediaCollectionShareAccess",
    "MediaTagDefinition",
    "MediaTagValue",
    "MediaTag",
    "MEDIA_TAG_FIELD_TYPES",
    "MediaAIConfig",
    "MediaAITagMapping",
    "MediaAITag",
    "MediaFieldInheritanceConfig",
    "MediaDownloadRequest",
    "MediaDownloadRequestItem",
    "MediaEmbedding",
    "MediaAlternative",
    "MediaAnnotation",
    "MediaLock",
    "DerivativeSizeConfig",
    "MediaSearchSubscription",
]
