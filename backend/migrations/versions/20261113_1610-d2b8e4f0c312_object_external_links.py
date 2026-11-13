"""Add collection_objects.external_links

Links to outside sources about an object, such as a Wikipedia page: a JSONB
array of {url, label, link_type}. Nullable, no backfill.

Revision ID: d2b8e4f0c312
Revises: d1a7c3e9b201
"""
from alembic import op

revision = "d2b8e4f0c312"
down_revision = "d1a7c3e9b201"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE collections.collection_objects ADD COLUMN IF NOT EXISTS external_links jsonb")


def downgrade() -> None:
    op.execute("ALTER TABLE collections.collection_objects DROP COLUMN IF EXISTS external_links")
