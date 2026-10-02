"""mfa_reset_tokens table

Revision ID: 666ad4c46c89
Revises: bdf1c9cfaf27
Create Date: 2026-06-16 11:13:16.652775

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = '666ad4c46c89'
down_revision: Union[str, Sequence[str], None] = 'bdf1c9cfaf27'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# ---------------------------------------------------------------------------
# Migration runs as the DB owner/migrator role (BYPASSRLS).
# Connection URL comes from ALEMBIC_DATABASE_URL (not DATABASE_URL).
#
# IMPORTANT - Data migrations that INSERT/UPDATE/DELETE rows in org-scoped
# tables must set organization_id explicitly on every row.  Do NOT rely on
# SET LOCAL row_security = off (legacy pattern, do not copy).
#
# If your migration touches org-scoped data, add this marker comment so the
# lint check (make lint-migrations) passes:
#   # MADRONA_MIGRATION_STRATEGY: owner
# ---------------------------------------------------------------------------


def upgrade() -> None:
    """Create mfa_reset_tokens (self-service 'lost authenticator' flow).

    Guarded with has_table: the consolidated-schema migration builds tables via
    Base.metadata.create_all on a fresh DB, so the table already exists there;
    only an existing/incrementally-migrated DB needs the create.
    """
    bind = op.get_bind()
    if inspect(bind).has_table("mfa_reset_tokens"):
        return

    op.create_table(
        "mfa_reset_tokens",
        sa.Column("token_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("token_hash", sa.String(), nullable=False),
        # expires_at / used_at are naive (Mapped[datetime]); created_at is
        # tz-aware (timestamp_now()) — matches what create_all builds on a fresh DB.
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("used_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.user_id"]),
        sa.PrimaryKeyConstraint("token_id"),
    )
    op.create_index("ix_mfa_reset_tokens_token_hash", "mfa_reset_tokens", ["token_hash"])


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()
    if not inspect(bind).has_table("mfa_reset_tokens"):
        return
    op.drop_index("ix_mfa_reset_tokens_token_hash", table_name="mfa_reset_tokens")
    op.drop_table("mfa_reset_tokens")
