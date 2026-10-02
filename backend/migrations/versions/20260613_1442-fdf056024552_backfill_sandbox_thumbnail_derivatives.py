"""backfill_sandbox_thumbnail_derivatives

Revision ID: fdf056024552
Revises: 5efd597cebd4
Create Date: 2026-06-13 14:42:20.024929

"""
import json
from pathlib import Path
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'fdf056024552'
down_revision: Union[str, Sequence[str], None] = '5efd597cebd4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Runs as the DB owner/migrator role (BYPASSRLS), so it backfills every demo
# org. Pure data normalization keyed on the shared fixture s3_key.
# MADRONA_MIGRATION_STRATEGY: owner

_FIXTURES = (
    Path(__file__).resolve().parent.parent.parent
    / "app" / "services" / "sandbox_seeder" / "fixtures"
)


def _thumbnail_map() -> dict[str, dict]:
    """s3_key -> thumbnail metadata, read from the checked-in manifests.

    Same source the seeder uses (build_sandbox_thumbnails.py writes the
    thumbnail_* fields). Empty if manifests predate the thumbnail pass — then
    this migration is a no-op.
    """
    mapping: dict[str, dict] = {}
    for src in ("met", "rijks", "smithsonian"):
        path = _FIXTURES / f"{src}-manifest.json"
        if not path.exists():
            continue
        for entry in json.loads(path.read_text()):
            media = entry.get("media") or {}
            if media.get("s3_key") and media.get("thumbnail_s3_key"):
                mapping[media["s3_key"]] = media
    return mapping


def upgrade() -> None:
    """Backfill thumbnail derivatives + media.thumbnail_s3_key for media that
    was seeded before shared thumbnail fixtures existed.

    Lists/grids read a 'thumbnail' MediaDerivative (or media.thumbnail_s3_key);
    without it the UI serves the full-size original (~1.6 MB). The thumbnail
    bytes now live in S3 alongside each original; here we point the existing
    rows at them. Idempotent: only touches rows missing the data.
    """
    mapping = _thumbnail_map()
    if not mapping:
        return

    conn = op.get_bind()
    for s3_key, m in mapping.items():
        params = {
            "tk": m["thumbnail_s3_key"],
            "w": m.get("width"),
            "h": m.get("height"),
            "tw": int(m.get("thumbnail_width") or 0),
            "th": int(m.get("thumbnail_height") or 0),
            "tsize": int(m.get("thumbnail_file_size") or 0),
            "sk": s3_key,
        }
        conn.execute(sa.text(
            """
            UPDATE media.media
               SET thumbnail_s3_key = :tk,
                   width = COALESCE(width, :w),
                   height = COALESCE(height, :h)
             WHERE s3_key = :sk
               AND thumbnail_s3_key IS NULL
            """
        ), params)
        conn.execute(sa.text(
            """
            INSERT INTO media.media_derivatives
                (derivative_id, media_id, organization_id, derivative_type,
                 format, s3_key, width, height, file_size, created_at)
            SELECT gen_random_uuid(), m.media_id, m.organization_id,
                   'thumbnail', 'jpeg', :tk, :tw, :th, :tsize, now()
              FROM media.media m
             WHERE m.s3_key = :sk
               AND NOT EXISTS (
                   SELECT 1 FROM media.media_derivatives d
                    WHERE d.media_id = m.media_id
                      AND d.derivative_type = 'thumbnail'
                      AND d.format = 'jpeg'
               )
            """
        ), params)


def downgrade() -> None:
    """Not reversed — the backfilled thumbnail derivatives are harmless to keep
    and re-deriving the originals isn't possible from here."""
    pass
