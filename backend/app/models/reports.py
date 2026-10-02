"""Reports models.

- ReportRun: execution history and status for on-demand reports and
  generated documents.

Report, ReportSchedule and ReportScheduleRecipient lived here for the reports
module — saved report definitions and their scheduled email delivery. That
module was routed but unreachable (no nav entry, no link anywhere in the app)
and has been removed, along with the Celery beat job that polled the schedules.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import (
    DateTime,
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models._helpers import uuid_pk, timestamp_now, timestamp_updated


# ============================================================================
# REPORT MODELS
# ============================================================================


class ReportRun(Base):
    """Report run - execution history and status tracking."""

    __tablename__ = "report_runs"

    run_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    # report_id / schedule_id used to sit here, pointing at reports.reports and
    # reports.report_schedules. Both tables are gone with the reports module,
    # and every surviving caller already passed report_id=None — on-demand runs
    # identify their report by `report_key`, not by a saved definition.

    # Status: 'pending', 'running', 'completed', 'failed', 'cancelled'
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")

    # Trigger type: 'manual', 'scheduled', 'api', 'export', 'on_demand'
    triggered_by: Mapped[str] = mapped_column(String(20), nullable=False)

    # On-demand report fields
    report_key: Mapped[str | None] = mapped_column(String(100), nullable=True)
    context_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    context_params: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    # Execution metrics
    row_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    execution_time_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Export
    export_format: Mapped[str | None] = mapped_column(String(10), nullable=True)
    export_s3_key: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Error handling
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Timestamps
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = timestamp_now()
    dismissed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # User who triggered manual run
    triggered_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    triggered_by_user: Mapped["User | None"] = relationship(
        "User",
        primaryjoin="ReportRun.triggered_by_user_id == User.user_id",
        foreign_keys=[triggered_by_user_id],
    )

    __table_args__ = (
        Index("ix_report_runs_org", "organization_id"),
        Index("ix_report_runs_status", "organization_id", "status"),
        Index("ix_report_runs_report_key", "organization_id", "report_key"),
        CheckConstraint(
            "status IN ('pending', 'running', 'completed', 'failed', 'cancelled')",
            name="check_run_status",
        ),
        CheckConstraint(
            "triggered_by IN ('manual', 'scheduled', 'api', 'export', 'on_demand')",
            name="check_triggered_by",
        ),
        CheckConstraint(
            "context_type IS NULL OR context_type IN ('search', 'workspace', 'record', 'global')",
            name="check_context_type",
        ),
        {"schema": "reports"},
    )


__all__ = [
    "ReportRun",
]
