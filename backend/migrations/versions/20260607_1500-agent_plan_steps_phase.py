"""Plan-detail redesign: agent_plan_steps.phase (template-authored grouping).

A nullable phase-group label. NULL = ungrouped (ad-hoc/chat plans render flat);
template-authored plans tag steps with a phase ("Receipt", "Due diligence", …)
so the timeline can group + collapse them. Mirrors the `branch` column.

Revision ID: agent_plan_steps_phase
Revises: agent_plan_steps_branching
Create Date: 2026-06-07 15:00:00
"""

from typing import Sequence, Union

from alembic import op

revision: str = "agent_plan_steps_phase"
down_revision: Union[str, Sequence[str], None] = "agent_plan_steps_branching"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE agent_plan_steps ADD COLUMN IF NOT EXISTS phase VARCHAR(60)"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE agent_plan_steps DROP COLUMN IF EXISTS phase")
