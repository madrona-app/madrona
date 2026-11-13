"""User-defined fields: definitions created by an organization's administrator.

Values are stored on the record (collection_objects.custom_fields, jsonb keyed
by ``key``); see app.services.custom_fields for validation and permissions.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models._helpers import timestamp_now, timestamp_updated, uuid_pk


class CustomFieldDefinition(Base):
    __tablename__ = "custom_field_definitions"

    field_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.organization_id", ondelete="CASCADE"), nullable=False,
    )
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False, default="collection_object")
    key: Mapped[str] = mapped_column(String(60), nullable=False)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    help_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    field_type: Mapped[str] = mapped_column(String(20), nullable=False, default="text")
    options: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    is_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_searchable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_public: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    section: Mapped[str | None] = mapped_column(String(60), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # Field-level permissions: role keys or custom role ids. Empty = everyone
    # who can view (or edit) objects. Admins always can.
    view_roles: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    edit_roles: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True,
    )

    __table_args__ = (
        UniqueConstraint("organization_id", "entity_type", "key", name="uq_custom_field_org_entity_key"),
        Index("ix_custom_field_definitions_org", "organization_id", "entity_type", "is_active"),
        CheckConstraint(
            "field_type IN ('text', 'long_text', 'number', 'date', 'boolean', 'select', 'multi_select', 'url')",
            name="ck_custom_field_type",
        ),
        {"schema": "collections"},
    )


__all__ = ["CustomFieldDefinition"]
