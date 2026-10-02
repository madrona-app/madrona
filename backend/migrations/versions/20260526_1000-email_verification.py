"""Add email verification: users.email_verified_at + email_verification_tokens.

Lets self-serve Guide signups verify their email after the workspace is
created. The verification flow mirrors password reset:

- ``users.email_verified_at`` — NULL until the user clicks the link.
- ``email_verification_tokens`` — single-use tokens (token_hash, expires_at,
  used_at), user-scoped (not org-scoped, no RLS policy needed).

Pure DDL.

Revision ID: email_verification
Revises: guide_voyage_embeddings_1024
Create Date: 2026-05-26 10:00:00
"""

from typing import Sequence, Union

from alembic import op

revision: str = "email_verification"
down_revision: Union[str, Sequence[str], None] = "guide_voyage_embeddings_1024"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE users "
        "ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP WITH TIME ZONE"
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS email_verification_tokens (
            token_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
            token_hash VARCHAR NOT NULL,
            expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
            used_at TIMESTAMP WITH TIME ZONE,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_email_verification_tokens_user_id "
        "ON email_verification_tokens (user_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_email_verification_tokens_token_hash "
        "ON email_verification_tokens (token_hash)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS email_verification_tokens")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS email_verified_at")
