"""add parent_message_id and delegation_persona to messages

Revision ID: a1d2e3f4b5c6
Revises: 33d81a377dc7
Create Date: 2026-04-28 13:13:00

Multi-agent orchestration Phase 1: a delegated specialist's reply links
back to the parent staff message that triggered the delegation.
Both columns are NULL on ordinary single-agent messages.

Idempotent: the consolidated init uses `Base.metadata.create_all`, which
reflects the current model state. On a fresh DB the columns already
exist after the init runs; on an older dev DB they don't. The IF NOT
EXISTS guards make this migration succeed in both cases.
"""
from alembic import op


revision = "a1d2e3f4b5c6"
down_revision = "33d81a377dc7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE messages "
        "ADD COLUMN IF NOT EXISTS parent_message_id UUID"
    )
    op.execute(
        "ALTER TABLE messages "
        "ADD COLUMN IF NOT EXISTS delegation_persona VARCHAR(50)"
    )
    # FK: Postgres has no IF NOT EXISTS for constraints; gate via catalog lookup.
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints
                WHERE constraint_name = 'fk_messages_parent_message_id'
                  AND table_name = 'messages'
            ) THEN
                ALTER TABLE messages
                ADD CONSTRAINT fk_messages_parent_message_id
                FOREIGN KEY (parent_message_id)
                REFERENCES messages(message_id)
                ON DELETE SET NULL;
            END IF;
        END $$;
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_messages_parent_id "
        "ON messages (parent_message_id)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_messages_parent_id")
    op.execute(
        "ALTER TABLE messages "
        "DROP CONSTRAINT IF EXISTS fk_messages_parent_message_id"
    )
    op.execute("ALTER TABLE messages DROP COLUMN IF EXISTS delegation_persona")
    op.execute("ALTER TABLE messages DROP COLUMN IF EXISTS parent_message_id")
