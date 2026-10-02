"""Guide Studio v1 §1C — batch drafts on agent_drafts.

Adds four nullable/defaulted columns so a draft can apply one payload to many
target entities as an all-or-nothing unit, without affecting existing single
drafts (zero backfill):

- cardinality TEXT NOT NULL DEFAULT 'single' (CHECK single|batch)
- target_entity_ids JSONB           — the N targets when cardinality='batch'
- applied_at TIMESTAMP               — universal "applied" idempotency marker
                                       (a batch draft has no single
                                       applied_entity_id)
- apply_result JSONB                 — per-item batch outcomes (null for single)

Revision ID: agent_drafts_batch
Revises: email_verification
Create Date: 2026-06-05 12:00:00
"""

from typing import Sequence, Union

from alembic import op

revision: str = "agent_drafts_batch"
down_revision: Union[str, Sequence[str], None] = "email_verification"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE agent_drafts
            ADD COLUMN IF NOT EXISTS cardinality TEXT NOT NULL DEFAULT 'single',
            ADD COLUMN IF NOT EXISTS target_entity_ids JSONB,
            ADD COLUMN IF NOT EXISTS applied_at TIMESTAMP WITHOUT TIME ZONE,
            ADD COLUMN IF NOT EXISTS apply_result JSONB
        """
    )
    op.execute(
        """
        ALTER TABLE agent_drafts
            DROP CONSTRAINT IF EXISTS check_agent_draft_cardinality
        """
    )
    op.execute(
        """
        ALTER TABLE agent_drafts
            ADD CONSTRAINT check_agent_draft_cardinality
            CHECK (cardinality IN ('single', 'batch'))
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE agent_drafts
            DROP CONSTRAINT IF EXISTS check_agent_draft_cardinality
        """
    )
    op.execute(
        """
        ALTER TABLE agent_drafts
            DROP COLUMN IF EXISTS apply_result,
            DROP COLUMN IF EXISTS applied_at,
            DROP COLUMN IF EXISTS target_entity_ids,
            DROP COLUMN IF EXISTS cardinality
        """
    )
