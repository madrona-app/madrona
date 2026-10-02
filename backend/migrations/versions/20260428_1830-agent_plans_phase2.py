"""phase 2.0: agent_plans + agent_plan_steps

Revision ID: d4e5f6a7b8c9
Revises: c3f4d5e6b7a8
Create Date: 2026-04-28 18:30:00

Multi-agent orchestration Phase 2 schema. See
backend/app/models/agent_plans.py for the design rationale.

Tables added:
- agent_plans: one row per plan, with context_snapshot JSONB and a status
  enum gated by CHECK constraint.
- agent_plan_steps: one row per step, with step_state JSONB for durable
  checkpointing and wait_for JSONB for external-signal pauses.

Idempotent: uses CREATE TABLE / CREATE INDEX with IF NOT EXISTS via raw
SQL so it succeeds whether the consolidated init's create_all already
built the tables (fresh DB) or not (older dev DB).
"""
from alembic import op


revision = "d4e5f6a7b8c9"
down_revision = "c3f4d5e6b7a8"
branch_labels = None
depends_on = None


_PLAN_STATUSES = (
    "pending", "running", "paused", "awaiting",
    "completed", "failed", "cancelled",
)
_STEP_STATUSES = (
    "pending", "running", "completed", "failed",
    "awaiting_user", "awaiting_external", "skipped",
)
_STEP_KINDS = ("tool_call", "delegate", "await")

_PLAN_STATUS_LIST = ", ".join(f"'{s}'" for s in _PLAN_STATUSES)
_STEP_STATUS_LIST = ", ".join(f"'{s}'" for s in _STEP_STATUSES)
_STEP_KIND_LIST = ", ".join(f"'{k}'" for k in _STEP_KINDS)


def upgrade() -> None:
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS agent_plans (
            plan_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            conversation_id UUID NOT NULL
                REFERENCES conversations(conversation_id) ON DELETE CASCADE,
            organization_id UUID NOT NULL
                REFERENCES organizations(organization_id) ON DELETE CASCADE,
            parent_message_id UUID
                REFERENCES messages(message_id) ON DELETE SET NULL,
            persona_used VARCHAR(50) NOT NULL,
            goal TEXT NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'pending'
                CHECK (status IN ({_PLAN_STATUS_LIST})),
            context_snapshot JSONB NOT NULL,
            last_error TEXT,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            started_at TIMESTAMP WITH TIME ZONE,
            completed_at TIMESTAMP WITH TIME ZONE
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_agent_plans_conversation_id "
        "ON agent_plans (conversation_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_agent_plans_org_id "
        "ON agent_plans (organization_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_agent_plans_status "
        "ON agent_plans (organization_id, status)"
    )

    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS agent_plan_steps (
            step_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            plan_id UUID NOT NULL
                REFERENCES agent_plans(plan_id) ON DELETE CASCADE,
            idx INTEGER NOT NULL,
            kind VARCHAR(20) NOT NULL
                CHECK (kind IN ({_STEP_KIND_LIST})),
            description TEXT NOT NULL,
            tool VARCHAR(100),
            args JSONB,
            persona VARCHAR(50),
            status VARCHAR(30) NOT NULL DEFAULT 'pending'
                CHECK (status IN ({_STEP_STATUS_LIST})),
            step_state JSONB,
            wait_for JSONB,
            result JSONB,
            error TEXT,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            started_at TIMESTAMP WITH TIME ZONE,
            completed_at TIMESTAMP WITH TIME ZONE
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_agent_plan_steps_plan_id "
        "ON agent_plan_steps (plan_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_agent_plan_steps_status "
        "ON agent_plan_steps (status)"
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_agent_plan_steps_plan_idx "
        "ON agent_plan_steps (plan_id, idx)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_agent_plan_steps_plan_idx")
    op.execute("DROP INDEX IF EXISTS ix_agent_plan_steps_status")
    op.execute("DROP INDEX IF EXISTS ix_agent_plan_steps_plan_id")
    op.execute("DROP TABLE IF EXISTS agent_plan_steps")
    op.execute("DROP INDEX IF EXISTS ix_agent_plans_status")
    op.execute("DROP INDEX IF EXISTS ix_agent_plans_org_id")
    op.execute("DROP INDEX IF EXISTS ix_agent_plans_conversation_id")
    op.execute("DROP TABLE IF EXISTS agent_plans")
