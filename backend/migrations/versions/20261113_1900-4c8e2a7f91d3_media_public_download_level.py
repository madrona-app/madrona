"""Add a per-file public download level to media

media.media.public_download_level: what the public may download of a file on
Discover record pages and public collection shares — 'none', 'derivatives'
(access copy only) or 'originals'. NULL = not set: Discover treats it as
'none', and a collection share keeps its own level (a set value can only
narrow a share, never widen it).

No RLS change: the column is on an existing org-scoped table.

Revision ID: 4c8e2a7f91d3
Revises: b7e3a9c41f62
"""
from alembic import op

revision = "4c8e2a7f91d3"
down_revision = "b7e3a9c41f62"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE media.media ADD COLUMN IF NOT EXISTS public_download_level VARCHAR(20)")
    op.execute("ALTER TABLE media.media DROP CONSTRAINT IF EXISTS check_media_public_download_level")
    op.execute(
        "ALTER TABLE media.media ADD CONSTRAINT check_media_public_download_level "
        "CHECK (public_download_level IS NULL OR public_download_level IN ('none', 'derivatives', 'originals'))"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE media.media DROP CONSTRAINT IF EXISTS check_media_public_download_level")
    op.execute("ALTER TABLE media.media DROP COLUMN IF EXISTS public_download_level")
