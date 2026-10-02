"""drop_channel_publishing_tables

Revision ID: 38596b1980af
Revises: examiner_to_constituent
Create Date: 2026-06-09 09:22:46.304236

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '38596b1980af'
down_revision: Union[str, Sequence[str], None] = 'examiner_to_constituent'
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
    """Drop the dead channel-publishing tables (YouTube/Vimeo/Flickr).

    The feature was never wired to provider OAuth credentials and no org ever
    configured a channel, so these tables are empty. Drop media_publications
    first — it has an FK to publishing_channels.
    """
    # Idempotent: the consolidated baseline (33d81a377dc7) delegates to
    # Base.metadata.create_all, which no longer builds these (the feature was
    # deleted), so a fresh `alembic upgrade head` has nothing to drop.
    op.execute("DROP TABLE IF EXISTS media.media_publications CASCADE")
    op.execute("DROP TABLE IF EXISTS media.publishing_channels CASCADE")


def downgrade() -> None:
    """Recreate the tables (empty) to keep the migration reversible."""
    op.create_table(
        "publishing_channels",
        sa.Column("channel_id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("platform", sa.String(length=30), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("credentials_encrypted", sa.Text(), nullable=True),
        sa.Column("config", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.organization_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.user_id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("channel_id"),
        sa.CheckConstraint("platform IN ('youtube', 'vimeo', 'flickr')", name="check_publishing_platform"),
        schema="media",
    )
    op.create_index("ix_publishing_channels_org", "publishing_channels", ["organization_id"], schema="media")

    op.create_table(
        "media_publications",
        sa.Column("publication_id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("media_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("channel_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("external_id", sa.String(length=255), nullable=True),
        sa.Column("external_url", sa.String(length=500), nullable=True),
        sa.Column("status", sa.String(length=20), server_default=sa.text("'pending'"), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("published_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["media_id"], ["media.media.media_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["channel_id"], ["media.publishing_channels.channel_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.organization_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["published_by"], ["users.user_id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("publication_id"),
        sa.CheckConstraint("status IN ('pending', 'publishing', 'published', 'failed', 'removed')", name="check_publication_status"),
        schema="media",
    )
    op.create_index("ix_media_publications_media", "media_publications", ["media_id"], schema="media")
    op.create_index("ix_media_publications_channel", "media_publications", ["channel_id"], schema="media")
