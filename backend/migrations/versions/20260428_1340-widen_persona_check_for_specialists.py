"""widen guide_system_prompts.persona CHECK to allow specialists

Revision ID: b2e3f4d5c6a7
Revises: a1d2e3f4b5c6
Create Date: 2026-04-28 13:40:00

Multi-agent orchestration Phase 1: allow per-org/platform system prompts
for the 5 specialist personas (registrar, loans_registrar, conservator,
rights_specialist, curator) in addition to the existing staff/visitor/guide.

Idempotent: drops the constraint with IF EXISTS so it works whether
the constraint exists with the old narrow form (dev DB) or the new
widened form (fresh DB built by Base.metadata.create_all in the
consolidated init).
"""
from alembic import op


revision = "b2e3f4d5c6a7"
down_revision = "a1d2e3f4b5c6"
branch_labels = None
depends_on = None


_NEW_VALUES = (
    "staff",
    "visitor",
    "guide",
    "registrar",
    "loans_registrar",
    "conservator",
    "rights_specialist",
    "curator",
)
_OLD_VALUES = ("staff", "visitor", "guide")


def upgrade() -> None:
    op.execute(
        "ALTER TABLE guide_system_prompts "
        "DROP CONSTRAINT IF EXISTS check_guide_system_prompt_persona"
    )
    op.execute(
        "ALTER TABLE guide_system_prompts "
        "ADD CONSTRAINT check_guide_system_prompt_persona "
        "CHECK (persona IN ("
        + ", ".join(f"'{v}'" for v in _NEW_VALUES)
        + "))"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE guide_system_prompts "
        "DROP CONSTRAINT IF EXISTS check_guide_system_prompt_persona"
    )
    op.execute(
        "ALTER TABLE guide_system_prompts "
        "ADD CONSTRAINT check_guide_system_prompt_persona "
        "CHECK (persona IN ("
        + ", ".join(f"'{v}'" for v in _OLD_VALUES)
        + "))"
    )
