"""widen guide_system_prompts.persona CHECK to allow planner

Revision ID: e5a6b7c8d9e0
Revises: d4e5f6a7b8c9
Create Date: 2026-04-28 19:00:00

Phase 2.1: the planner persona has a hardcoded fallback prompt; this
widens the CHECK so platform-admin or per-org overrides can be stored
in guide_system_prompts the same way other personas can.

Conversation.persona is *not* widened — planner is invoked as a sub-agent,
never as a conversation persona.

Idempotent: drops the constraint with IF EXISTS so it works whether
the constraint exists with the previous CHECK form or the latest
(model-defined) CHECK form already created via Base.metadata.create_all
during the consolidated init.
"""
from alembic import op


revision = "e5a6b7c8d9e0"
down_revision = "d4e5f6a7b8c9"
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
    "planner",
)
_OLD_VALUES = (
    "staff",
    "visitor",
    "guide",
    "registrar",
    "loans_registrar",
    "conservator",
    "rights_specialist",
    "curator",
)


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
