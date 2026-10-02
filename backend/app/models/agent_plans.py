"""Agent plan + plan-step models (Phase 2 of multi-agent orchestration).

A plan is a multi-step transparent execution that the staff agent decomposes
from a user goal. Plans are durable — checkpointed per step so a process
crash mid-execution recovers cleanly — and can suspend on external signals
(approvals, form submissions, workflow transitions) and resume later.

Schema choices, all driven by the Phase 2 design notes in memory:

- Per-step state in `step_state JSONB`, not a single status enum, so each
  tool-call result and intermediate LLM response is persisted before the
  executor advances.
- `context_snapshot JSONB` on the plan captures the immutable AgentContext
  at plan creation. On resume the executor rehydrates and *re-validates
  permissions* — a user might have lost a role between pause and resume.
- `wait_for JSONB` on a step describes the external signal the executor is
  waiting on. Schemas:
      {kind: "approval_request", request_id: <uuid>}
      {kind: "form_submission", form: <key>, entity: <type>, entity_id: <uuid>}
      {kind: "workflow_transition", entity: <type>, entity_id: <uuid>, target_status: <str>}
- Approval gates bind to the existing `approval_requests` row via FK, never
  parallel — procedure compliance lives in `approval_service.py`.
- Strictly serial in v1; no DAGs, no parallel steps, no retries.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models._helpers import (
    timestamp_now,
    timestamp_updated,
    uuid_fk,
    uuid_fk_nullable,
    uuid_pk,
)


_PLAN_STATUSES = (
    "pending",      # created, not yet running
    "running",      # executor is actively walking steps
    "paused",       # explicit user pause
    "awaiting",     # awaiting an external signal (approval, form, transition)
    "completed",    # all steps done
    "failed",       # a step failed and stop-on-failure took effect
    "cancelled",    # user cancelled
)

_STEP_STATUSES = (
    "pending",
    "running",
    "completed",
    "failed",
    "awaiting_user",       # blocked on an explicit user action (approval, form)
    "awaiting_external",   # blocked on a non-user condition (workflow status)
    "skipped",             # superseded by a prior step's failure
)

_STEP_KINDS = (
    "tool_call",   # invoke a single tool with the given args
    "delegate",    # hand off to a specialist via delegate_to_specialist
    "await",       # pure wait step — does no work, just gates on wait_for
    "decision",    # branch point — parks for a human choice, then skips the
                   # steps tagged with the non-chosen branch keys
)


class AgentPlan(Base):
    """One multi-step plan owned by a conversation.

    Plans always belong to a conversation; the parent_message_id links the
    plan to the user message that triggered it (so the chat UI can render
    the plan inline alongside the staff response).
    """

    __tablename__ = "agent_plans"

    plan_id: Mapped[uuid.UUID] = uuid_pk()
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("conversations.conversation_id", ondelete="CASCADE"),
        nullable=False,
    )
    organization_id: Mapped[uuid.UUID] = uuid_fk("organizations.organization_id")
    parent_message_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("messages.message_id", ondelete="SET NULL"),
        nullable=True,
    )
    persona_used: Mapped[str] = mapped_column(String(50), nullable=False)
    goal: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending",
    )

    # Immutable AgentContext snapshot captured at plan creation.
    # On resume the executor rehydrates and re-validates permissions before
    # the next step runs — a user might have lost a role between pause and
    # resume, and the executor must not blindly trust the original grant.
    context_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)

    # Last error that stopped the plan, if any.
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    # v1 §7.4 model version pinning — the planner LLM call that produced
    # this plan. NULL on rows created before pinning landed; never
    # back-filled (a guessed model would defeat the audit point).
    model_provider: Mapped[str | None] = mapped_column(Text, nullable=True, comment="Provider that served the LLM call (ollama|runpod|claude).")
    model_id: Mapped[str | None] = mapped_column(Text, nullable=True, comment="Model identifier as configured at call time (e.g. claude-opus-4-7, qwen2.5:14b).")
    model_version: Mapped[str | None] = mapped_column(Text, nullable=True, comment="Concrete version when the provider reports one distinct from model_id; NULL otherwise.")

    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relationships
    steps: Mapped[list["AgentPlanStep"]] = relationship(
        "AgentPlanStep",
        back_populates="plan",
        cascade="all, delete-orphan",
        order_by="AgentPlanStep.idx",
    )

    __table_args__ = (
        CheckConstraint(
            "status IN (" + ", ".join(f"'{s}'" for s in _PLAN_STATUSES) + ")",
            name="check_agent_plan_status",
        ),
        Index("ix_agent_plans_conversation_id", "conversation_id"),
        Index("ix_agent_plans_org_id", "organization_id"),
        Index("ix_agent_plans_status", "organization_id", "status"),
    )


class AgentPlanStep(Base):
    """One step within a plan.

    Steps are linear (idx is total-ordered). A step's `step_state JSONB`
    holds checkpoint data — partial tool-call results, intermediate LLM
    responses, last_checkpoint_at — so a process restart can resume the
    plan without re-running completed work.
    """

    __tablename__ = "agent_plan_steps"

    step_id: Mapped[uuid.UUID] = uuid_pk()
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("agent_plans.plan_id", ondelete="CASCADE"),
        nullable=False,
    )
    idx: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)

    # For kind='tool_call': the tool name + args.
    # For kind='delegate': set tool='delegate_to_specialist' and put
    # {specialist, question} into args.
    # For kind='await': tool may be NULL.
    tool: Mapped[str | None] = mapped_column(String(100), nullable=True)
    args: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # Persona under which the step's tool runs. For delegate steps this is
    # the *target* specialist; for tool_call steps it is the persona whose
    # allowlist will gate the call (typically 'staff').
    persona: Mapped[str | None] = mapped_column(String(50), nullable=True)

    status: Mapped[str] = mapped_column(
        String(30), nullable=False, default="pending",
    )

    # Per-step durable checkpoint. Examples:
    #   {"tool_calls_completed": [{"tool":"...", "result": ...}],
    #    "partial_output": "...",
    #    "last_checkpoint_at": "2026-04-28T17:00:00Z"}
    step_state: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # External signal this step is blocked on. NULL means the step can run
    # immediately when the executor reaches it.
    wait_for: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # Branching: the branch-group key this step belongs to. NULL = unconditional
    # (always runs). When a `decision` step resolves to a chosen key, every
    # still-pending step tagged with one of that decision's OTHER keys is
    # skipped. A `decision` step records its option keys in args.options.
    branch: Mapped[str | None] = mapped_column(String(60), nullable=True)

    # Phase-group label for the timeline UI (template-authored only; NULL =
    # ungrouped → flat rail). A property of a *known procedure*, so it comes
    # from template authoring, never from the free-form planner.
    phase: Mapped[str | None] = mapped_column(String(60), nullable=True)

    # Final result preserved separately so it survives if step_state is
    # truncated for size in future. NULL until status='completed'.
    result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    # v1 §7.4 model version pinning — the LLM that ran this step (delegate
    # steps and tool_call steps that invoke an LLM). NULL for pure await
    # steps and for steps recorded before pinning landed.
    model_provider: Mapped[str | None] = mapped_column(Text, nullable=True, comment="Provider that served the LLM call (ollama|runpod|claude).")
    model_id: Mapped[str | None] = mapped_column(Text, nullable=True, comment="Model identifier as configured at call time (e.g. claude-opus-4-7, qwen2.5:14b).")
    model_version: Mapped[str | None] = mapped_column(Text, nullable=True, comment="Concrete version when the provider reports one distinct from model_id; NULL otherwise.")

    created_at: Mapped[datetime] = timestamp_now()
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    plan: Mapped["AgentPlan"] = relationship(
        "AgentPlan", back_populates="steps",
    )

    __table_args__ = (
        CheckConstraint(
            "status IN (" + ", ".join(f"'{s}'" for s in _STEP_STATUSES) + ")",
            name="check_agent_plan_step_status",
        ),
        CheckConstraint(
            "kind IN (" + ", ".join(f"'{k}'" for k in _STEP_KINDS) + ")",
            name="check_agent_plan_step_kind",
        ),
        # A tool_call/delegate step is unrunnable without a tool (the executor
        # rejects it — agent_plan_service _execute). The service layer already
        # enforces this in _validate_steps, but this is defense-in-depth against
        # raw inserts (seeds/fixtures) that bypass the service. await/decision
        # steps legitimately have no tool.
        CheckConstraint(
            "kind NOT IN ('tool_call', 'delegate') OR tool IS NOT NULL",
            name="check_agent_plan_step_tool_required",
        ),
        Index("ix_agent_plan_steps_plan_id", "plan_id"),
        Index("ix_agent_plan_steps_status", "status"),
        Index("ix_agent_plan_steps_plan_idx", "plan_id", "idx", unique=True),
    )


__all__ = [
    "AgentPlan",
    "AgentPlanStep",
]
