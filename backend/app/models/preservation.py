from __future__ import annotations

"""
PREMIS-aligned preservation models for OAIS compliance.

Includes:
- PreservationEvent: Immutable audit trail (PREMIS events)
- FormatRegistryEntry: Global PRONOM format lookup table
- PreservationPolicy: Organization retention/migration/normalization rules
- PreservationActionPlan: Scheduled preservation actions from policies
- InformationPackage: OAIS SIP/AIP/DIP tracking
- ReplicationRecord: Multi-location file copy tracking
"""

import uuid
from datetime import datetime

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
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models._helpers import uuid_pk, timestamp_now, timestamp_updated


class PreservationEvent(Base):
    """
    Records a single PREMIS-aligned preservation action.

    Immutable audit trail — rows are INSERT-only (no updated_at column).
    RLS policy scopes queries to the caller's organization.
    """

    __tablename__ = "preservation_events"
    __table_args__ = (
        CheckConstraint(
            "event_type IN ('fixity_check', 'ingestion', 'message_digest_calculation', "
            "'migration', 'validation', 'deletion', 'replication', 'format_identification')",
            name="check_preservation_event_type",
        ),
        CheckConstraint(
            "outcome IN ('success', 'failure', 'warning')",
            name="check_preservation_outcome",
        ),
        CheckConstraint(
            "agent_type IN ('software', 'person', 'organization')",
            name="check_preservation_agent_type",
        ),
        Index("ix_preservation_events_org", "organization_id"),
        Index("ix_preservation_events_media", "media_id"),
        Index("ix_preservation_events_org_type", "organization_id", "event_type"),
        Index("ix_preservation_events_org_created", "organization_id", "created_at"),
        Index("ix_preservation_events_org_outcome", "organization_id", "outcome"),
        {"schema": "media"},
    )

    event_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    event_type: Mapped[str] = mapped_column(String(50), nullable=False)
    media_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media.media_id", ondelete="SET NULL"),
        nullable=True,
    )
    outcome: Mapped[str] = mapped_column(String(20), nullable=False)
    outcome_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    detail: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    agent_type: Mapped[str] = mapped_column(String(30), nullable=False)
    agent_name: Mapped[str] = mapped_column(String(200), nullable=False)
    linked_entity_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    linked_entity_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    created_at: Mapped[datetime] = timestamp_now()


# ============================================================================
# Phase 1: Format Registry & Identification
# ============================================================================


class FormatRegistryEntry(Base):
    """
    Global PRONOM format lookup table.

    Shared across all organizations (no RLS). Maps PRONOM PUIDs to format
    metadata and risk levels for digital preservation planning.
    """

    __tablename__ = "format_registry"
    __table_args__ = (
        CheckConstraint(
            "risk_level IN ('low', 'moderate', 'high', 'critical')",
            name="check_format_risk_level",
        ),
        {"schema": "media"},
    )

    format_id: Mapped[uuid.UUID] = uuid_pk()
    pronom_puid: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    version: Mapped[str | None] = mapped_column(String(50), nullable=True)
    mime_types: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    extensions: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    risk_level: Mapped[str] = mapped_column(String(20), nullable=False, default="low")
    risk_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_open_format: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    recommended_migration_puid: Mapped[str | None] = mapped_column(
        String(20), nullable=True
    )
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()


# ============================================================================
# Phase 2: Preservation Policies & Planning
# ============================================================================


class PreservationPolicy(Base):
    """
    Organization-level preservation policy.

    Defines retention schedules, format migration plans, normalization rules,
    or fixity check frequencies. Evaluated by a daily Celery task.
    """

    __tablename__ = "preservation_policies"
    __table_args__ = (
        CheckConstraint(
            "policy_type IN ('retention', 'format_migration', 'normalization', 'fixity_schedule')",
            name="check_preservation_policy_type",
        ),
        Index("ix_preservation_policies_org", "organization_id"),
        Index("ix_preservation_policies_org_active", "organization_id", "is_active"),
        {"schema": "media"},
    )

    policy_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    policy_type: Mapped[str] = mapped_column(String(30), nullable=False)
    scope: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    rules: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    approved_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()


class PreservationActionPlan(Base):
    """
    A scheduled preservation action derived from a policy.

    Created by policy evaluation, requires approval before execution.
    Tracks full lifecycle: pending → approved → in_progress → completed/failed.
    """

    __tablename__ = "preservation_action_plans"
    __table_args__ = (
        CheckConstraint(
            "action_type IN ('migrate_format', 'review_retention', 'delete', 'archive')",
            name="check_preservation_action_type",
        ),
        CheckConstraint(
            "status IN ('pending', 'approved', 'in_progress', 'completed', 'failed', 'cancelled')",
            name="check_preservation_action_status",
        ),
        Index("ix_preservation_action_plans_org", "organization_id"),
        Index("ix_preservation_action_plans_policy", "policy_id"),
        Index("ix_preservation_action_plans_media", "media_id"),
        Index("ix_preservation_action_plans_org_status", "organization_id", "status"),
        {"schema": "media"},
    )

    action_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    policy_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.preservation_policies.policy_id", ondelete="CASCADE"),
        nullable=False,
    )
    media_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media.media_id", ondelete="CASCADE"),
        nullable=False,
    )
    action_type: Mapped[str] = mapped_column(String(30), nullable=False)
    detail: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    scheduled_for: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()


# ============================================================================
# Phase 3: SIP/AIP/DIP Information Packages
# ============================================================================


class InformationPackage(Base):
    """
    OAIS Information Package: SIP (Submission), AIP (Archival), or DIP (Dissemination).

    Each media asset has at most one active SIP and one active AIP.
    Multiple DIPs can exist (one per export).
    """

    __tablename__ = "information_packages"
    __table_args__ = (
        CheckConstraint(
            "package_type IN ('SIP', 'AIP', 'DIP')",
            name="check_ip_package_type",
        ),
        CheckConstraint(
            "status IN ('validating', 'accepted', 'rejected', 'active', 'superseded', "
            "'generated', 'expired')",
            name="check_ip_status",
        ),
        Index("ix_information_packages_org", "organization_id"),
        Index("ix_information_packages_media", "media_id"),
        Index("ix_information_packages_org_type", "organization_id", "package_type"),
        {"schema": "media"},
    )

    package_id: Mapped[uuid.UUID] = uuid_pk()
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
    package_type: Mapped[str] = mapped_column(String(3), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    structure: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    provenance_event_ids: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    export_profile_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    external_identifier: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


# ============================================================================
# Phase 4: Replication Tracking
# ============================================================================


class ReplicationRecord(Base):
    """
    Tracks copies of media files across storage locations.

    Each record represents one copy of a media file in a specific storage
    location. Verified periodically by the verify_replicas task.
    """

    __tablename__ = "replication_records"
    __table_args__ = (
        CheckConstraint(
            "copy_type IN ('primary', 'backup', 'archive')",
            name="check_replication_copy_type",
        ),
        CheckConstraint(
            "verification_status IN ('unverified', 'verified', 'mismatch', 'missing')",
            name="check_replication_verification_status",
        ),
        UniqueConstraint("media_id", "storage_location", name="uq_replication_media_location"),
        Index("ix_replication_records_org", "organization_id"),
        Index("ix_replication_records_media", "media_id"),
        Index("ix_replication_records_org_status", "organization_id", "verification_status"),
        {"schema": "media"},
    )

    record_id: Mapped[uuid.UUID] = uuid_pk()
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
    storage_location: Mapped[str] = mapped_column(String(200), nullable=False)
    storage_provider: Mapped[str] = mapped_column(String(20), nullable=False)
    storage_region: Mapped[str] = mapped_column(String(50), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    copy_type: Mapped[str] = mapped_column(String(20), nullable=False, default="backup")
    checksum_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    verification_status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="unverified"
    )
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()
