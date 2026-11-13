"""Record workflow: administrator-defined flags, completeness rules, and review.

- ``RecordFlagDefinition`` — flags an organization's administrator defines
  (e.g. "On view", "Access restricted", "Heavy"). Not hard-coded.
- ``ObjectFlag`` — a flag set on an object record, either by a person
  (source='manual') or automatically by a completeness rule (source='rule').
- ``CompletenessRule`` — organization-defined requirements a record must meet
  (e.g. "Ready to publish": title, date, subject, alt text on every image).
  Records that meet a rule are flagged automatically with the rule's flag, and
  a rule can be marked as required before publication.
The review workflow itself is built on the approval engine (ApprovalRule /
ApprovalRequest); see app.services.record_workflow.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models._helpers import timestamp_now, timestamp_updated, uuid_pk

FLAG_SOURCES = ("manual", "rule")


class RecordFlagDefinition(Base):
    __tablename__ = "record_flag_definitions"

    flag_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.organization_id", ondelete="CASCADE"), nullable=False,
    )
    key: Mapped[str] = mapped_column(String(60), nullable=False)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # Flags set only by completeness rules cannot be set or cleared by hand.
    is_rule_managed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True,
    )

    __table_args__ = (
        UniqueConstraint("organization_id", "key", name="uq_record_flag_definitions_org_key"),
        Index("ix_record_flag_definitions_org", "organization_id", "is_active"),
        {"schema": "collections"},
    )


class ObjectFlag(Base):
    __tablename__ = "object_flags"

    object_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("collections.collection_objects.object_id", ondelete="CASCADE"), primary_key=True,
    )
    flag_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("collections.record_flag_definitions.flag_id", ondelete="CASCADE"), primary_key=True,
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.organization_id", ondelete="CASCADE"), nullable=False,
    )
    source: Mapped[str] = mapped_column(String(10), nullable=False, default="manual")
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    set_at: Mapped[datetime] = timestamp_now()
    set_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True,
    )

    definition: Mapped[RecordFlagDefinition] = relationship(lazy="joined")

    __table_args__ = (
        CheckConstraint("source IN ('manual', 'rule')", name="ck_object_flags_source"),
        Index("ix_object_flags_org_flag", "organization_id", "flag_id"),
        {"schema": "collections"},
    )


class CompletenessRule(Base):
    __tablename__ = "completeness_rules"

    rule_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.organization_id", ondelete="CASCADE"), nullable=False,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # [{"field": "title", "check": "present"}, {"field": "object_type", "check": "equals", "value": "Book"}]
    requirements: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    # The flag set automatically on records that meet this rule.
    flag_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("collections.record_flag_definitions.flag_id", ondelete="RESTRICT"), nullable=False,
    )
    # When true, a record must meet this rule before it can be published.
    required_for_publication: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True,
    )

    flag: Mapped[RecordFlagDefinition] = relationship(lazy="joined")

    __table_args__ = (
        Index("ix_completeness_rules_org", "organization_id", "is_active"),
        {"schema": "collections"},
    )


__all__ = [
    "FLAG_SOURCES",
    "RecordFlagDefinition",
    "ObjectFlag",
    "CompletenessRule",
]
