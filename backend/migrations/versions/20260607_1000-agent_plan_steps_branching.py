"""Branching primitive: agent_plan_steps.branch + 'decision' step kind.

Adds the `branch` group tag (NULL = unconditional) and widens the kind CHECK to
allow 'decision' steps. The kind CHECK was created inline at table-create time
(Postgres auto-named it `agent_plan_steps_kind_check`); the model declares it as
`check_agent_plan_step_kind`. We drop BOTH candidate names IF EXISTS and re-add a
single named constraint, so this is deterministic regardless of which exists.

Revision ID: agent_plan_steps_branching
Revises: agent_plan_step_metrics
Create Date: 2026-06-07 10:00:00
"""

from typing import Sequence, Union

from alembic import op

revision: str = "agent_plan_steps_branching"
down_revision: Union[str, Sequence[str], None] = "agent_plan_step_metrics"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE agent_plan_steps "
        "ADD COLUMN IF NOT EXISTS branch VARCHAR(60)"
    )
    op.execute(
        "ALTER TABLE agent_plan_steps "
        "DROP CONSTRAINT IF EXISTS agent_plan_steps_kind_check"
    )
    op.execute(
        "ALTER TABLE agent_plan_steps "
        "DROP CONSTRAINT IF EXISTS check_agent_plan_step_kind"
    )
    op.execute(
        "ALTER TABLE agent_plan_steps "
        "ADD CONSTRAINT check_agent_plan_step_kind "
        "CHECK (kind IN ('tool_call', 'delegate', 'await', 'decision'))"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE agent_plan_steps "
        "DROP CONSTRAINT IF EXISTS check_agent_plan_step_kind"
    )
    op.execute(
        "ALTER TABLE agent_plan_steps "
        "ADD CONSTRAINT check_agent_plan_step_kind "
        "CHECK (kind IN ('tool_call', 'delegate', 'await'))"
    )
    op.execute("ALTER TABLE agent_plan_steps DROP COLUMN IF EXISTS branch")
