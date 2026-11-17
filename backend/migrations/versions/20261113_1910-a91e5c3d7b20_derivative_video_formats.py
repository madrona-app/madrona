"""Allow video derivative formats (mp4, webm).

The video transcoding task stores web proxies as media_derivatives rows with
format 'mp4' or 'webm', but check_derivative_format only allowed image
formats, so saving a transcoded proxy failed and public video playback had
no access copy to use.

Revision ID: a91e5c3d7b20
Revises: 4c8e2a7f91d3
Create Date: 2026-11-13 19:10:00
"""
from alembic import op

revision = "a91e5c3d7b20"
down_revision = "4c8e2a7f91d3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE media.media_derivatives DROP CONSTRAINT IF EXISTS check_derivative_format")
    op.execute(
        "ALTER TABLE media.media_derivatives ADD CONSTRAINT check_derivative_format "
        "CHECK (format IN ('jpeg', 'webp', 'png', 'avif', 'mp4', 'webm'))"
    )


def downgrade() -> None:
    op.execute("DELETE FROM media.media_derivatives WHERE format IN ('mp4', 'webm')")
    op.execute("ALTER TABLE media.media_derivatives DROP CONSTRAINT IF EXISTS check_derivative_format")
    op.execute(
        "ALTER TABLE media.media_derivatives ADD CONSTRAINT check_derivative_format "
        "CHECK (format IN ('jpeg', 'webp', 'png', 'avif'))"
    )
