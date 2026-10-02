"""Per-user Guide preferences — the guide_user_prefs table.

A user's own personalization for the Guide assistant: a freeform "things to
keep in mind" note plus a verbosity preference. Injected BELOW the org/platform
system prompt as subordinate stylistic preferences (see
prompt_service.get_user_preferences + agent_service._build_ollama_messages) —
they shape tone/length, never override org rules, persona, or guardrails.

Private to the owning user: RLS is applied by seeds/seed_rls_policies.py
(guide_user_prefs added to RLS_TABLES + a user-isolation policy keyed on
user_id = current_user_id()), so no other member — including org admins — can
read another user's preferences. No row == no personalization.

Revision ID: guide_user_prefs
Revises: reference_chunks_conv_scope
Create Date: 2026-06-07 20:30:00
"""

from typing import Sequence, Union

from alembic import op

revision: str = "guide_user_prefs"
down_revision: Union[str, Sequence[str], None] = "reference_chunks_conv_scope"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS guide_user_prefs (
            pref_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL
                REFERENCES users(user_id) ON DELETE CASCADE,
            organization_id UUID NOT NULL
                REFERENCES organizations(organization_id) ON DELETE CASCADE,
            instructions TEXT,
            verbosity VARCHAR(20),
            CONSTRAINT check_guide_user_pref_verbosity
                CHECK (verbosity IS NULL OR verbosity IN ('terse', 'normal', 'detailed')),
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
        """
    )
    # One preference row per user per org.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_guide_user_prefs_user_org "
        "ON guide_user_prefs (user_id, organization_id)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_guide_user_prefs_user_org")
    op.execute("DROP TABLE IF EXISTS guide_user_prefs")
