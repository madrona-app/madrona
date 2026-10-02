"""router phase 3: persona_history + widened conversation persona CHECK

Revision ID: c3f4d5e6b7a8
Revises: b2e3f4d5c6a7
Create Date: 2026-04-28 17:00:00

Phase 3 router lets the agent switch a conversation's persona to a specialist
on the first user message. Two schema changes:

1. conversations.persona_history JSONB — audit trail of every persona
   change with {persona, set_at, source, confidence?, rationale?}. Source
   values today: 'initial', 'router'. Future: 'manual_switch'.

2. conversations.persona CHECK widened to allow the 5 specialist personas
   so a router decision actually persists.

Idempotent: column addition uses IF NOT EXISTS, CHECK uses
DROP IF EXISTS + ADD so it succeeds regardless of starting state
(fresh DB via consolidated init OR dev DB upgraded from older state).
"""
from alembic import op


revision = "c3f4d5e6b7a8"
down_revision = "b2e3f4d5c6a7"
branch_labels = None
depends_on = None


_NEW_PERSONAS = (
    "staff",
    "visitor",
    "guide",
    "registrar",
    "loans_registrar",
    "conservator",
    "rights_specialist",
    "curator",
)
_OLD_PERSONAS = ("staff", "visitor", "guide")


def upgrade() -> None:
    op.execute(
        "ALTER TABLE conversations "
        "ADD COLUMN IF NOT EXISTS persona_history JSONB"
    )
    op.execute(
        "ALTER TABLE conversations "
        "DROP CONSTRAINT IF EXISTS check_conversation_persona"
    )
    op.execute(
        "ALTER TABLE conversations "
        "ADD CONSTRAINT check_conversation_persona "
        "CHECK (persona IN ("
        + ", ".join(f"'{v}'" for v in _NEW_PERSONAS)
        + "))"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE conversations "
        "DROP CONSTRAINT IF EXISTS check_conversation_persona"
    )
    op.execute(
        "ALTER TABLE conversations "
        "ADD CONSTRAINT check_conversation_persona "
        "CHECK (persona IN ("
        + ", ".join(f"'{v}'" for v in _OLD_PERSONAS)
        + "))"
    )
    op.execute("ALTER TABLE conversations DROP COLUMN IF EXISTS persona_history")
