"""
URI Registry Models

SQLAlchemy models for stable URI persistence.
"""

from datetime import datetime
from typing import Optional
from uuid import UUID, uuid4

from sqlalchemy import (
    String, Text, DateTime, ForeignKey, CheckConstraint, Index
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class URIRegistry(Base):
    """
    Registry of all stable URIs assigned to entities.

    This table is the source of truth for URI -> entity mappings.
    Records are never deleted, only status-changed.

    Status lifecycle:
    - active: Normal, resolvable URI
    - redirect: Merged into another entity (301/303)
    - tombstone: Deleted, returns 410 Gone
    - reserved: Reserved but not yet assigned
    """
    __tablename__ = "uri_registry"

    # Primary key
    uri_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid4
    )

    # Organization
    organization_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False
    )

    # Entity reference
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False)
    entity_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)

    # Public identifier (URL-safe)
    public_id: Mapped[str] = mapped_column(String(200), nullable=False)

    # Full URI for quick lookup
    full_uri: Mapped[str] = mapped_column(String(500), nullable=False, unique=True)

    # Status
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")

    # Redirect info
    redirect_to: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    redirect_type: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)

    # Tombstone info
    tombstone_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Audit
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=datetime.utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow
    )
    created_by: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True
    )
    updated_by: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True
    )

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="URIRegistry.organization_id == Organization.organization_id"
    )
    created_by_user: Mapped["User"] = relationship(
        "User",
        foreign_keys=[created_by],
        primaryjoin="URIRegistry.created_by == User.user_id"
    )
    updated_by_user: Mapped["User"] = relationship(
        "User",
        foreign_keys=[updated_by],
        primaryjoin="URIRegistry.updated_by == User.user_id"
    )

    __table_args__ = (
        # Unique public_id within org/type
        Index(
            "ix_uri_registry_public_id",
            "organization_id", "entity_type", "public_id",
            unique=True
        ),
        # Entity lookup
        Index(
            "ix_uri_registry_entity",
            "organization_id", "entity_type", "entity_id"
        ),
        # Status constraints
        CheckConstraint(
            "status IN ('active', 'redirect', 'tombstone', 'reserved')",
            name="check_uri_status"
        ),
        CheckConstraint(
            "(status != 'redirect') OR (redirect_to IS NOT NULL)",
            name="check_redirect_has_target"
        ),
        CheckConstraint(
            "redirect_type IS NULL OR redirect_type IN ('301', '303')",
            name="check_redirect_type"
        ),
    )

    def __repr__(self) -> str:
        return f"<URIRegistry {self.full_uri} ({self.status})>"


class EntityMergeLog(Base):
    """
    Audit log for entity merges.

    When entities are merged:
    1. Source entity URI becomes a redirect
    2. Target entity keeps its URI
    3. This log preserves the merge history
    4. Source snapshot enables recovery if needed
    """
    __tablename__ = "entity_merge_log"

    # Primary key
    merge_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid4
    )

    # Organization
    organization_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False
    )

    # Merge details
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False)
    source_entity_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    target_entity_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    source_uri: Mapped[str] = mapped_column(String(500), nullable=False)
    target_uri: Mapped[str] = mapped_column(String(500), nullable=False)

    # Reason and audit
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    merged_by: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="RESTRICT"),
        nullable=False
    )
    merged_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=datetime.utcnow
    )

    # Snapshot of source entity data at time of merge
    source_snapshot: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="EntityMergeLog.organization_id == Organization.organization_id"
    )
    merged_by_user: Mapped["User"] = relationship(
        "User",
        primaryjoin="EntityMergeLog.merged_by == User.user_id"
    )

    __table_args__ = (
        Index(
            "ix_entity_merge_log_source",
            "organization_id", "entity_type", "source_entity_id"
        ),
        Index(
            "ix_entity_merge_log_target",
            "organization_id", "entity_type", "target_entity_id"
        ),
    )

    def __repr__(self) -> str:
        return f"<EntityMergeLog {self.source_uri} -> {self.target_uri}>"
