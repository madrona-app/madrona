"""
Provisioning job tracking model.

Stores the state of organization provisioning jobs with per-step status,
enabling retry-from-failure and inspection of provisioning progress.

Lives in the public schema (platform-level, no RLS).
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func
from sqlalchemy import JSON

from app.database import Base

# Cross-database JSON type (JSONB on PostgreSQL, JSON on SQLite)
JSONType = JSON().with_variant(JSONB(), "postgresql")


class OrgProvisioningJob(Base):
    """Tracks the state of an organization provisioning saga."""

    __tablename__ = "org_provisioning_jobs"

    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    idempotency_key: Mapped[str] = mapped_column(
        String(64), unique=True, nullable=False
    )
    request_fingerprint: Mapped[str | None] = mapped_column(
        String(64), nullable=True
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending"
    )
    initiated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    request_payload: Mapped[dict] = mapped_column(JSONType, nullable=False)
    steps: Mapped[dict] = mapped_column(JSONType, nullable=False, default=dict)
    current_step: Mapped[str | None] = mapped_column(String(50), nullable=True)
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    admin_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    organization_slug: Mapped[str | None] = mapped_column(
        String(50), nullable=True
    )
    admin_email: Mapped[str | None] = mapped_column(
        String(255), nullable=True
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_step: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # retry_count is informational telemetry — incremented each time
    # a platform admin clicks Retry. The retry endpoint no longer
    # enforces a cap (Celery autoretry is also disabled), so
    # max_retries is unused but kept on the row for backwards
    # compatibility with existing API consumers reading the field.
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_retries: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    welcome_email_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    event_log: Mapped[list] = mapped_column(
        JSONType, nullable=False, default=list
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(), nullable=False, default=datetime.utcnow
    )

    __table_args__ = (
        Index("ix_org_provisioning_jobs_status", "status"),
        Index("ix_org_provisioning_jobs_created_at", "created_at"),
        Index("ix_org_provisioning_jobs_organization_id", "organization_id"),
    )

    def __repr__(self) -> str:
        return (
            f"<OrgProvisioningJob {self.job_id} "
            f"slug={self.organization_slug} status={self.status}>"
        )
