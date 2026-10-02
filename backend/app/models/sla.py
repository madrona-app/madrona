"""
SLA Policy and Event Models.

Tracks Service Level Agreement policies for workflow records and
records escalation events when deadlines are approaching or breached.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models._helpers import uuid_pk, timestamp_now


class SLAPolicy(Base):
    """
    Defines an SLA deadline policy for a workflow type within an organization.

    Each policy specifies warning, deadline, and critical thresholds (in days)
    and controls who gets notified when those thresholds are reached.
    """
    __tablename__ = "sla_policies"

    policy_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    workflow_type: Mapped[str] = mapped_column(String(30), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    warning_days: Mapped[int] = mapped_column(Integer, nullable=False)
    deadline_days: Mapped[int] = mapped_column(Integer, nullable=False)
    critical_days: Mapped[int] = mapped_column(Integer, nullable=False)
    escalate_to_role: Mapped[str | None] = mapped_column(String(50), nullable=True)
    notify_assignee: Mapped[bool] = mapped_column(Boolean, server_default="true", nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, server_default="true", nullable=False)
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("NOW()"), onupdate=datetime.utcnow, nullable=False
    )

    __table_args__ = (
        Index("ix_sla_policies_org_workflow", "organization_id", "workflow_type"),
        Index("ix_sla_policies_org_enabled", "organization_id", "enabled"),
    )


class SLAEvent(Base):
    """
    Records an SLA escalation event (warning, breach, critical, or resolution).

    Used as an audit trail and for deduplication — the service checks for
    existing events before sending duplicate notifications.
    """
    __tablename__ = "sla_events"

    event_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    policy_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("sla_policies.policy_id", ondelete="CASCADE"),
        nullable=False,
    )
    workflow_type: Mapped[str] = mapped_column(String(30), nullable=False)
    record_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    event_type: Mapped[str] = mapped_column(String(20), nullable=False)  # warning, breach, critical, resolved
    days_elapsed: Mapped[int] = mapped_column(Integer, nullable=False)
    notified_user_ids: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    triggered_at: Mapped[datetime] = timestamp_now()

    __table_args__ = (
        Index("ix_sla_events_org_record", "organization_id", "record_id"),
        Index("ix_sla_events_policy", "policy_id"),
        Index("ix_sla_events_org_type", "organization_id", "workflow_type", "event_type"),
    )
