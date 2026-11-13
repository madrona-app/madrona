"""Add organizations.vocabulary_strict_fields

Per-organization, per-field strict vocabulary validation toggles for
collection object fields: a JSONB object of {field_key: bool}. A missing key
means lenient, which is the default, so existing free-text data is never
blocked. No backfill.

Revision ID: e7c4a91b5d23
Revises: d2b8e4f0c312
"""
from alembic import op

revision = "e7c4a91b5d23"
down_revision = "d2b8e4f0c312"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE public.organizations "
        "ADD COLUMN IF NOT EXISTS vocabulary_strict_fields jsonb DEFAULT '{}'::jsonb"
    )
    op.execute(
        "COMMENT ON COLUMN public.organizations.vocabulary_strict_fields IS "
        "'Per-field strict vocabulary validation toggles. Key = object field, value = boolean.'"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE public.organizations DROP COLUMN IF EXISTS vocabulary_strict_fields")
