"""Per-step effort telemetry for agent plans (§2A).

Append-only: one row per step *execution attempt* (steps re-run on
recovery/resume, so effort can't live as mutable columns on the step). The
serializer embeds the latest attempt's metric on each step. Every effort field
is nullable — a deterministic DB tool_call or a pure await legitimately has no
LLM cost, recorded as honest NULL, never a fabricated 0.
"""

import uuid
from datetime import datetime

from sqlalchemy import Index, ForeignKey, Integer, Numeric, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models._helpers import timestamp_now, uuid_pk


class AgentPlanStepMetric(Base):
    """One effort record for a single step execution attempt."""

    __tablename__ = "agent_plan_step_metrics"

    metric_id: Mapped[uuid.UUID] = uuid_pk()
    step_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("agent_plan_steps.step_id", ondelete="CASCADE"),
        nullable=False,
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("agent_plans.plan_id", ondelete="CASCADE"),
        nullable=False,
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # 1 on first run; +1 each time the step re-runs (recovery/resume).
    attempt: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    # Effort signals — all nullable (NULL = no LLM/no measure, not zero).
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    llm_rounds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tool_calls: Mapped[int | None] = mapped_column(Integer, nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    delegation_depth: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cost_estimate_usd: Mapped[float | None] = mapped_column(
        Numeric(12, 6), nullable=True
    )
    # Pre-normalization effort score (weight is normalized within the plan at
    # read time, so it isn't stored).
    raw_effort: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)

    # Which model did the work (v1 §7.4). NULL for deterministic steps.
    model_provider: Mapped[str | None] = mapped_column(Text, nullable=True)
    model_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    model_version: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = timestamp_now()

    # Declared here so `alembic check` matches the database — created by
    # migration SQL and never mirrored back into the model.
    __table_args__ = (
        Index("ix_agent_plan_step_metrics_plan", "plan_id"),
        Index("ix_agent_plan_step_metrics_step", "step_id"),
    )


__all__ = ["AgentPlanStepMetric"]
