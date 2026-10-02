"""Agent draft envelope (Guide Studio v1 Phase 1).

A polymorphic, reviewable record of write-work the agent proposes. Drafts never
touch live entities directly — `draft_service.apply_draft` cascades an approved
draft to the live entity through the same business logic the API uses (v1 §1.1).

The envelope *is* the audit trail: `payload` + `rationale` + `citations` +
`model_*` are written once and treated as immutable; editing a pending draft
creates a new row with `supersedes_draft_id` set and the prior row marked
'superseded'.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, CheckConstraint, ForeignKey, Index, Text, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models._helpers import uuid_pk, timestamp_now, timestamp_updated

# Mirror the migration's CHECK constraints so the app layer and DB agree.
DRAFT_ACTIONS = ("create", "update", "link")
DRAFT_CARDINALITIES = ("single", "batch")
DRAFT_STATUSES = (
    "pending",
    "approved",
    "rejected",
    "superseded",
    "cancelled",
    "expired",
)


class AgentDraft(Base):
    __tablename__ = "agent_drafts"

    draft_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Provenance — where the draft came from. All nullable: a draft can be
    # plan-driven or free-standing.
    plan_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("agent_plans.plan_id", ondelete="SET NULL"), nullable=True
    )
    plan_step_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("agent_plan_steps.step_id", ondelete="SET NULL"), nullable=True
    )
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("conversations.conversation_id", ondelete="SET NULL"),
        nullable=True,
    )
    proposed_by_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.user_id"), nullable=False
    )
    proposed_by_persona: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # What is being proposed.
    entity_type: Mapped[str] = mapped_column(Text, nullable=False)
    intended_action: Mapped[str] = mapped_column(Text, nullable=False)
    target_entity_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    rationale: Mapped[str | None] = mapped_column(Text, nullable=True)
    citations: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)

    # Cardinality (v1 §1C batch drafts). 'single' targets one entity (the
    # common case); 'batch' applies `payload` to every id in
    # `target_entity_ids` as one all-or-nothing unit. Both columns are
    # nullable/defaulted so existing single drafts are unaffected.
    cardinality: Mapped[str] = mapped_column(Text, nullable=False, default="single")
    target_entity_ids: Mapped[list[Any] | None] = mapped_column(JSONB, nullable=True)

    # Lifecycle.
    status: Mapped[str] = mapped_column(Text, nullable=False, default="pending")
    approval_request_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("approval_requests.request_id", ondelete="SET NULL"),
        nullable=True,
    )
    supersedes_draft_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("agent_drafts.draft_id", ondelete="SET NULL"), nullable=True
    )
    decided_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    applied_entity_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    apply_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Universal "applied" marker (idempotency). A single draft also sets
    # applied_entity_id; a batch draft has no single id, so applied_at is the
    # authoritative "already applied" signal. apply_result holds per-item batch
    # outcomes (null for single drafts).
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    apply_result: Mapped[list[dict[str, Any]] | dict[str, Any] | None] = mapped_column(
        JSONB, nullable=True
    )

    # Forensic reproducibility (v1 §7.4): which model produced this draft.
    model_provider: Mapped[str | None] = mapped_column(Text, nullable=True)
    model_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    model_version: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()

    # Declared here so `alembic check` matches the database. These were created
    # by migration SQL and never mirrored back into the model, which made
    # autogenerate propose dropping them.
    __table_args__ = (
        Index("ix_agent_drafts_org", "organization_id"),
        Index("ix_agent_drafts_org_status", "organization_id", "status"),
        Index("ix_agent_drafts_entity_type", "organization_id", "entity_type"),
        Index("ix_agent_drafts_plan", "plan_id"),
        CheckConstraint(
            "cardinality IN ('single', 'batch')",
            name="check_agent_draft_cardinality",
        ),
    )
