"""Personal conversation attachments: reference_chunks conversation scope.

Adds conversation_id (CASCADE — attachments die with the conversation) and
uploaded_by_user_id to reference_chunks. A non-NULL conversation_id marks a
personal attachment chunk that must NEVER surface in corpus/widget search;
retrieval (reference_tools._search_chunks) filters `conversation_id IS NULL`
by default and only includes a conversation's own chunks when in that chat.

Revision ID: reference_chunks_conv_scope
Revises: agent_plan_steps_phase
Create Date: 2026-06-07 17:00:00
"""

from typing import Sequence, Union

from alembic import op

revision: str = "reference_chunks_conv_scope"
down_revision: Union[str, Sequence[str], None] = "agent_plan_steps_phase"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE reference_chunks
            ADD COLUMN IF NOT EXISTS conversation_id UUID
                REFERENCES conversations(conversation_id) ON DELETE CASCADE,
            ADD COLUMN IF NOT EXISTS uploaded_by_user_id UUID
                REFERENCES users(user_id) ON DELETE SET NULL
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_reference_chunks_conversation "
        "ON reference_chunks (conversation_id)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_reference_chunks_conversation")
    op.execute(
        "ALTER TABLE reference_chunks "
        "DROP COLUMN IF EXISTS conversation_id, "
        "DROP COLUMN IF EXISTS uploaded_by_user_id"
    )
