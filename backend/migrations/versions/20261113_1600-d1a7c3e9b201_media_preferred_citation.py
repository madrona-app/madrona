"""Add media.preferred_citation

How researchers should cite a digital asset. Separate from `credit`, which is
a short credit line; a preferred citation is often a full archival citation.
Nullable, no backfill.

Revision ID: d1a7c3e9b201
Revises: c5f1e2a83b47
"""
from alembic import op

revision = "d1a7c3e9b201"
down_revision = "c5f1e2a83b47"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IF NOT EXISTS: the test harness builds the schema from the models first.
    op.execute("ALTER TABLE media.media ADD COLUMN IF NOT EXISTS preferred_citation text")


def downgrade() -> None:
    op.execute("ALTER TABLE media.media DROP COLUMN IF EXISTS preferred_citation")
