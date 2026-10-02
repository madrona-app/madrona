"""User layout preference models.

Per-user, saveable overrides for record-detail workspace layouts. A user keeps
multiple named variants per surface (page archetype); exactly one is active at a
time and is applied as a DELTA over the code-defined base layout
(frontend ``PAGE_SECTION_GROUPS``) at render time.

The delta stores only the user's overrides (hidden / reordered sections, etc.)
relative to the live base — never a full snapshot — so newly-added base
sections (including newly *required* ones) surface automatically. The merge and
the compliance invariant ("a required section can never be hidden") are enforced
by the shared frontend resolver, since the base layout and its required-field
metadata live in frontend constants.

Tenant isolation is enforced in the app layer by always filtering on
(organization_id, user_id). Org-isolation RLS for this table should additionally
be registered at the boot-time RLS seed as a follow-up (same pattern noted in
the organization_collection_profiles migration).
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Index, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models._helpers import JSONType, timestamp_now, timestamp_updated, uuid_pk


class UserLayoutOverride(Base):
    """A named, per-user layout variant for a workspace surface."""

    __tablename__ = "user_layout_overrides"

    id: Mapped[uuid.UUID] = uuid_pk()
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

    # Page archetype the layout applies to, e.g. 'collection-object', 'loan-in'.
    surface_key: Mapped[str] = mapped_column(String(64), nullable=False)
    # Optional applicability filter (e.g. object type). NULL = the wildcard
    # variant that applies to the whole archetype.
    object_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)

    # Renderer-agnostic override ops (FormLayoutDelta). Never a snapshot, never
    # HTML.
    delta: Mapped[dict] = mapped_column(JSONType, nullable=False)
    # Version of the base layout this delta was authored against (drift hint).
    base_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )

    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()

    __table_args__ = (
        Index("ix_user_layout_overrides_owner", "user_id", "surface_key"),
        Index("ix_user_layout_overrides_org", "organization_id"),
        # At most one active variant per (user, surface, object_type). COALESCE
        # so a NULL object_type participates as a single wildcard slot. Mirrored
        # in the migration for prod (alembic); declared here so create_all-based
        # test schemas build it too.
        Index(
            "uq_user_layout_active",
            "user_id",
            "surface_key",
            text("COALESCE(object_type, '')"),
            unique=True,
            postgresql_where=text("is_active"),
        ),
    )


__all__ = ["UserLayoutOverride"]
