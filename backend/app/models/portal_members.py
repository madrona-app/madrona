"""Portal members and their saved personal collections.

A portal member is a person an organization has approved to save objects from
its public Discover portal into personal collections. Members are a separate
identity from staff users on purpose: they have no row in ``users``, no
organization membership, no role and no permissions, so nothing that
authenticates a member can reach the staff application. They sign in with an
emailed one-time link (``PortalMemberLoginToken``); there is no password.

Every table here carries ``organization_id`` and is covered by row-level
security (seeds/seed_rls_policies.py). The public member endpoints resolve the
organization from the portal slug and filter on it explicitly, as the rest of
the public Discover API does.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models._helpers import timestamp_now, uuid_pk

PORTAL_MEMBER_STATUSES = ("invited", "active", "suspended")


class PortalMember(Base):
    """A person approved to keep personal collections on the public portal."""

    __tablename__ = "portal_members"

    member_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    # Stored lower-cased and trimmed; unique per organization.
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="invited", server_default="invited"
    )

    invited_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    approved_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_sign_in_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Carried in the session cookie. Signing out or suspending the member
    # increments it, which ends every session issued before.
    session_version: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )

    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_now()

    collections: Mapped[list["MemberCollection"]] = relationship(
        "MemberCollection",
        back_populates="member",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    __table_args__ = (
        UniqueConstraint("organization_id", "email", name="uq_portal_members_org_email"),
        CheckConstraint(
            "status IN ('invited', 'active', 'suspended')",
            name="check_portal_member_status",
        ),
        Index("ix_portal_members_org_status", "organization_id", "status"),
        {"schema": "collections"},
    )


class PortalMemberLoginToken(Base):
    """A one-time sign-in link. Only a keyed hash of the token is stored."""

    __tablename__ = "portal_member_login_tokens"

    token_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    member_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.portal_members.member_id", ondelete="CASCADE"),
        nullable=False,
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Set when a staff member generated the link instead of the member
    # requesting it by email.
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = timestamp_now()

    __table_args__ = (
        Index("ix_portal_member_login_tokens_member", "member_id"),
        {"schema": "collections"},
    )


class MemberCollection(Base):
    """A member's named personal collection of portal objects."""

    __tablename__ = "member_collections"

    collection_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    member_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.portal_members.member_id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_now()

    member: Mapped["PortalMember"] = relationship("PortalMember", back_populates="collections")
    items: Mapped[list["MemberCollectionItem"]] = relationship(
        "MemberCollectionItem",
        back_populates="collection",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="MemberCollectionItem.sort_order",
    )

    __table_args__ = (
        Index("ix_member_collections_member", "organization_id", "member_id"),
        {"schema": "collections"},
    )


class MemberCollectionItem(Base):
    """An object saved in a member collection.

    The row is kept when the object stops being discoverable; the member API
    hides it instead, so republishing the object brings it back.
    """

    __tablename__ = "member_collection_items"

    item_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    collection_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.member_collections.collection_id", ondelete="CASCADE"),
        nullable=False,
    )
    object_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.collection_objects.object_id", ondelete="CASCADE"),
        nullable=False,
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    created_at: Mapped[datetime] = timestamp_now()

    collection: Mapped["MemberCollection"] = relationship("MemberCollection", back_populates="items")

    __table_args__ = (
        UniqueConstraint("collection_id", "object_id", name="uq_member_collection_items_collection_object"),
        Index("ix_member_collection_items_object", "organization_id", "object_id"),
        {"schema": "collections"},
    )


__all__ = [
    "PORTAL_MEMBER_STATUSES",
    "PortalMember",
    "PortalMemberLoginToken",
    "MemberCollection",
    "MemberCollectionItem",
]
