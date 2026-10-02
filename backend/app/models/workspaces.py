from __future__ import annotations

"""Workspace models: saved sets of collection objects and media."""

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
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models._helpers import uuid_pk, timestamp_now, timestamp_updated


# ============================================================================
# WORKSPACES - Saveable, shareable sets of collection objects
# ============================================================================

class Workspace(Base):
    """
    Unified Workspace (Working Set) - A saveable collection of objects or media for bulk operations.

    Supports both collections and media workspaces through workspace_type discriminator.
    Workspaces allow users to:
    - Save selections of objects/assets for later use
    - Share sets with other users
    - Execute bulk actions across all items in the workspace
    - Use as active context for quick actions

    workspace_type:
    - 'collections': Contains collection objects (workspace_items table)
    - 'media': Contains media assets (media.workspace_items table)

    Visibility levels:
    - private: Only owner can see
    - shared: Visible to users with explicit share grants
    - org: Visible to all organization members with workspaces.view permission
    """
    __tablename__ = "workspaces"

    workspace_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    owner_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Workspace type discriminator
    workspace_type: Mapped[str] = mapped_column(
        String(20),
        CheckConstraint("workspace_type IN ('collections', 'media')", name="workspaces_workspace_type_check"),
        nullable=False,
        default='collections',
    )

    # Workspace details
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    visibility: Mapped[str] = mapped_column(
        String(20),
        CheckConstraint("visibility IN ('private', 'shared', 'org')", name="workspaces_visibility_check"),
        nullable=False,
        default='private',
    )

    # Media-specific fields (nullable for collections type)
    cover_media_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media.media_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Soft delete
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Timestamps
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()

    # Future: Dynamic/query-based workspaces (v2)
    is_dynamic: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    dynamic_query: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="Workspace.organization_id == Organization.organization_id",
    )
    owner: Mapped["User"] = relationship(
        "User",
        foreign_keys=[owner_user_id],
        primaryjoin="Workspace.owner_user_id == User.user_id",
    )
    deleted_by_user: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[deleted_by],
        primaryjoin="Workspace.deleted_by == User.user_id",
    )
    cover_media: Mapped["Media | None"] = relationship(
        "Media",
        foreign_keys=[cover_media_id],
    )
    items: Mapped[list["WorkspaceItem"]] = relationship(
        "WorkspaceItem",
        back_populates="workspace",
        cascade="all, delete-orphan",
        order_by="WorkspaceItem.sort_order",
    )
    shares: Mapped[list["WorkspaceShare"]] = relationship(
        "WorkspaceShare",
        back_populates="workspace",
        cascade="all, delete-orphan",
    )
    # Media items relationship (for media type workspaces)
    media_items: Mapped[list["MediaWorkspaceItem"]] = relationship(
        "MediaWorkspaceItem",
        back_populates="workspace",
        cascade="all, delete-orphan",
        order_by="MediaWorkspaceItem.sort_order",
        foreign_keys="MediaWorkspaceItem.workspace_id",
    )
    # Media action runs relationship (for media type workspaces)
    action_runs: Mapped[list["MediaWorkspaceActionRun"]] = relationship(
        "MediaWorkspaceActionRun",
        back_populates="workspace",
        cascade="all, delete-orphan",
        foreign_keys="MediaWorkspaceActionRun.workspace_id",
    )

    __table_args__ = (
        Index("ix_workspaces_org", "organization_id"),
        Index("ix_workspaces_owner", "owner_user_id"),
        Index(
            "ix_workspaces_org_visibility",
            "organization_id", "visibility",
            postgresql_where=text("is_deleted = FALSE"),
        ),
        Index(
            "ix_workspaces_org_type",
            "organization_id", "workspace_type",
            postgresql_where=text("is_deleted = FALSE"),
        ),
        {"schema": "collections"},
    )


class WorkspaceItem(Base):
    """
    Object membership in a workspace.

    Each item links a collection object to a workspace, with optional
    notes and sort order for manual arrangement.
    """
    __tablename__ = "workspace_items"

    workspace_item_id: Mapped[uuid.UUID] = uuid_pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.workspaces.workspace_id", ondelete="CASCADE"),
        nullable=False,
    )
    object_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.collection_objects.object_id", ondelete="CASCADE"),
        nullable=False,
    )
    added_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Item metadata
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Timestamps
    added_at: Mapped[datetime] = timestamp_now()

    # Relationships
    workspace: Mapped["Workspace"] = relationship(
        "Workspace",
        back_populates="items",
    )
    object: Mapped["CollectionObject"] = relationship(
        "CollectionObject",
        primaryjoin="WorkspaceItem.object_id == CollectionObject.object_id",
    )
    added_by: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[added_by_user_id],
        primaryjoin="WorkspaceItem.added_by_user_id == User.user_id",
    )

    __table_args__ = (
        Index("ix_workspace_items_workspace", "workspace_id"),
        Index("ix_workspace_items_object", "object_id"),
        Index("ix_workspace_items_sort", "workspace_id", "sort_order"),
        UniqueConstraint("workspace_id", "object_id", name="uq_workspace_object"),
        {"schema": "collections"},
    )


class WorkspaceShare(Base):
    """
    Share grants for workspaces with visibility='shared'.

    Supports sharing with:
    - Individual users (principal_type='user')
    - Roles (principal_type='role') - future
    - Teams (principal_type='team') - future

    Permission levels:
    - view: Can see workspace and objects (subject to object ACL)
    - edit: Can add/remove objects, edit notes
    - execute: Can run bulk actions on objects
    - admin: Can share with others, rename, change visibility
    """
    __tablename__ = "workspace_shares"

    share_id: Mapped[uuid.UUID] = uuid_pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.workspaces.workspace_id", ondelete="CASCADE"),
        nullable=False,
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Principal (who has access)
    principal_type: Mapped[str] = mapped_column(
        String(20),
        CheckConstraint("principal_type IN ('user', 'role', 'team')", name="workspace_shares_principal_type_check"),
        nullable=False,
        default='user',
    )
    principal_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        nullable=False,
    )

    # Permission level
    permission: Mapped[str] = mapped_column(
        String(20),
        CheckConstraint("permission IN ('view', 'edit', 'execute', 'admin')", name="workspace_shares_permission_check"),
        nullable=False,
        default='view',
    )

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    workspace: Mapped["Workspace"] = relationship(
        "Workspace",
        back_populates="shares",
    )
    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="WorkspaceShare.organization_id == Organization.organization_id",
    )
    created_by_user: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[created_by],
        primaryjoin="WorkspaceShare.created_by == User.user_id",
    )

    __table_args__ = (
        Index("ix_workspace_shares_workspace", "workspace_id"),
        Index("ix_workspace_shares_principal", "principal_type", "principal_id"),
        UniqueConstraint(
            "workspace_id", "principal_type", "principal_id",
            name="uq_workspace_share_principal"
        ),
        {"schema": "collections"},
    )


class UserActiveContext(Base):
    """
    Stores the user's current active context per application.

    Each app (collections, media) has its own independent context row.
    The active context determines which record(s) Quick Actions operate on.
    """
    __tablename__ = "user_active_context"

    # Composite PK: one context per user per app
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="CASCADE"),
        primary_key=True,
    )
    app: Mapped[str] = mapped_column(
        String(20),
        primary_key=True,
        server_default="collections",
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Context type and ID
    context_type: Mapped[str | None] = mapped_column(
        String(20),
        nullable=True,
    )
    context_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        nullable=True,
    )

    # When context was set
    set_at: Mapped[datetime] = timestamp_now()

    # Relationships
    user: Mapped["User"] = relationship(
        "User",
        primaryjoin="UserActiveContext.user_id == User.user_id",
    )
    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="UserActiveContext.organization_id == Organization.organization_id",
    )

    __table_args__ = (
        CheckConstraint("app IN ('collections', 'media')", name="check_context_app"),
        {"schema": "collections"},
    )


# =============================================================================
# DAM WORKSPACES - Now unified with Collections Workspaces
# MediaWorkspace is kept as an alias for backwards compatibility
# =============================================================================

# MediaWorkspace is now an alias for Workspace with workspace_type='media'
# This allows existing code to continue working while we migrate to unified API
MediaWorkspace = Workspace


class MediaWorkspaceItem(Base):
    """
    Media asset membership in a DAM workspace.

    Each item links a media asset to a workspace (now in collections.workspaces),
    with optional notes and sort order for manual arrangement.
    """
    __tablename__ = "workspace_items"

    workspace_item_id: Mapped[uuid.UUID] = uuid_pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.workspaces.workspace_id", ondelete="CASCADE"),
        nullable=False,
    )
    media_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media.media_id", ondelete="CASCADE"),
        nullable=False,
    )
    added_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Item metadata
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Timestamps
    added_at: Mapped[datetime] = timestamp_now()

    # Relationships
    workspace: Mapped["Workspace"] = relationship(
        "Workspace",
        back_populates="media_items",
        foreign_keys=[workspace_id],
    )
    media: Mapped["Media"] = relationship(
        "Media",
        primaryjoin="MediaWorkspaceItem.media_id == Media.media_id",
    )
    added_by: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[added_by_user_id],
        primaryjoin="MediaWorkspaceItem.added_by_user_id == User.user_id",
    )

    __table_args__ = (
        Index("ix_media_workspace_items_workspace", "workspace_id"),
        Index("ix_media_workspace_items_media", "media_id"),
        Index("ix_media_workspace_items_sort", "workspace_id", "sort_order"),
        UniqueConstraint("workspace_id", "media_id", name="uq_media_workspace_media"),
        {"schema": "media"},
    )


class MediaWorkspaceShare(Base):
    """
    Share grants for DAM workspaces.

    Note: Now references collections.workspaces via unified table.

    Supports sharing with:
    - Individual users (principal_type='user')
    - Roles (principal_type='role') - future
    - Teams (principal_type='team') - future

    Permission levels:
    - view: Can see workspace and assets (subject to asset ACL)
    - edit: Can add/remove assets, edit notes
    - execute: Can run bulk actions on assets
    - admin: Can share with others, rename, change visibility
    """
    __tablename__ = "workspace_shares"

    share_id: Mapped[uuid.UUID] = uuid_pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.workspaces.workspace_id", ondelete="CASCADE"),
        nullable=False,
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Principal (who has access)
    principal_type: Mapped[str] = mapped_column(
        String(20),
        CheckConstraint("principal_type IN ('user', 'role', 'team')", name="workspace_shares_principal_type_check"),
        nullable=False,
        default='user',
    )
    principal_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        nullable=False,
    )

    # Permission level
    permission: Mapped[str] = mapped_column(
        String(20),
        CheckConstraint("permission IN ('view', 'edit', 'execute', 'admin')", name="workspace_shares_permission_check"),
        nullable=False,
        default='view',
    )

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships - workspace relationship not needed as shares are now in collections.workspace_shares
    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="MediaWorkspaceShare.organization_id == Organization.organization_id",
    )
    created_by_user: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[created_by],
        primaryjoin="MediaWorkspaceShare.created_by == User.user_id",
    )

    __table_args__ = (
        Index("ix_media_workspace_shares_workspace", "workspace_id"),
        Index("ix_media_workspace_shares_principal", "principal_type", "principal_id"),
        UniqueConstraint(
            "workspace_id", "principal_type", "principal_id",
            name="uq_media_workspace_share_principal"
        ),
        {"schema": "media"},
    )


class MediaWorkspaceActionRun(Base):
    """
    Tracks bulk action execution on DAM workspaces.

    Note: Now references collections.workspaces via unified table.

    Used for async job-based operations like:
    - download_assets (package for download)
    - create_renditions (generate derivatives)
    - publish_to_channel (external publishing)

    Status flow: pending -> running -> completed/failed/cancelled
    """
    __tablename__ = "workspace_action_runs"

    run_id: Mapped[uuid.UUID] = uuid_pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.workspaces.workspace_id", ondelete="CASCADE"),
        nullable=False,
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Action details
    action_key: Mapped[str] = mapped_column(String(50), nullable=False)
    action_params: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    # Status
    status: Mapped[str] = mapped_column(
        String(20),
        CheckConstraint("status IN ('pending', 'running', 'completed', 'failed', 'cancelled')", name="workspace_action_runs_status_check"),
        nullable=False,
        default='pending',
    )

    # Progress
    total_items: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    processed_items: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    succeeded_items: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_items: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Results (per-item outcomes)
    results: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Job reference (for Celery/background worker)
    job_id: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Artifact (for downloads, exports)
    artifact_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    artifact_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Timestamps
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    workspace: Mapped["Workspace"] = relationship(
        "Workspace",
        back_populates="action_runs",
        foreign_keys=[workspace_id],
    )
    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="MediaWorkspaceActionRun.organization_id == Organization.organization_id",
    )
    created_by_user: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[created_by],
        primaryjoin="MediaWorkspaceActionRun.created_by == User.user_id",
    )

    __table_args__ = (
        Index("ix_dam_action_runs_workspace", "workspace_id"),
        Index("ix_dam_action_runs_status", "status"),
        Index("ix_dam_action_runs_org", "organization_id"),
        {"schema": "media"},
    )


__all__ = [
    "Workspace",
    "WorkspaceItem",
    "WorkspaceShare",
    "UserActiveContext",
    "MediaWorkspace",
    "MediaWorkspaceItem",
    "MediaWorkspaceShare",
    "MediaWorkspaceActionRun",
]
