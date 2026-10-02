"""Defense-in-depth: a tool_call/delegate plan step must have a tool.

The service layer already enforces this in agent_plan_service._validate_steps,
but a raw insert (a hand-seeded demo plan) bypassed it and produced tool_call
steps with no tool — unrunnable plans that fail mid-execution with
"step N has kind=tool_call but no tool". This adds a CHECK constraint so the
database itself rejects such rows.

Added NOT VALID: it enforces every new/updated row immediately but does NOT
re-scan existing rows, so the migration applies cleanly regardless of any legacy
malformed data (which can be repaired, then the constraint VALIDATEd separately).

Revision ID: agent_plan_step_tool_required
Revises: guide_user_prefs
Create Date: 2026-06-08 12:00:00
"""

from typing import Sequence, Union

from alembic import op

revision: str = "agent_plan_step_tool_required"
down_revision: Union[str, Sequence[str], None] = "guide_user_prefs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_CONSTRAINT = "check_agent_plan_step_tool_required"


def upgrade() -> None:
    op.execute(
        f"ALTER TABLE agent_plan_steps DROP CONSTRAINT IF EXISTS {_CONSTRAINT}"
    )
    op.execute(
        f"ALTER TABLE agent_plan_steps ADD CONSTRAINT {_CONSTRAINT} "
        "CHECK (kind NOT IN ('tool_call', 'delegate') OR tool IS NOT NULL) "
        "NOT VALID"
    )


def downgrade() -> None:
    op.execute(
        f"ALTER TABLE agent_plan_steps DROP CONSTRAINT IF EXISTS {_CONSTRAINT}"
    )
