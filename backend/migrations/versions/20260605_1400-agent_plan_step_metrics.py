"""§2A — per-step effort telemetry table.

Append-only: one row per step execution attempt. All effort columns nullable
(NULL = no LLM/no measure, never a fabricated 0).

Revision ID: agent_plan_step_metrics
Revises: agent_drafts_batch
Create Date: 2026-06-05 14:00:00
"""

from typing import Sequence, Union

from alembic import op

revision: str = "agent_plan_step_metrics"
down_revision: Union[str, Sequence[str], None] = "agent_drafts_batch"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS agent_plan_step_metrics (
            metric_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            step_id UUID NOT NULL REFERENCES agent_plan_steps(step_id) ON DELETE CASCADE,
            plan_id UUID NOT NULL REFERENCES agent_plans(plan_id) ON DELETE CASCADE,
            organization_id UUID NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
            attempt INTEGER NOT NULL DEFAULT 1,
            input_tokens INTEGER,
            output_tokens INTEGER,
            llm_rounds INTEGER,
            tool_calls INTEGER,
            latency_ms INTEGER,
            delegation_depth INTEGER,
            cost_estimate_usd NUMERIC(12, 6),
            raw_effort NUMERIC(14, 4),
            model_provider TEXT,
            model_id TEXT,
            model_version TEXT,
            created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_agent_plan_step_metrics_step "
        "ON agent_plan_step_metrics (step_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_agent_plan_step_metrics_plan "
        "ON agent_plan_step_metrics (plan_id)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS agent_plan_step_metrics")
