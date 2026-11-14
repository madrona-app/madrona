"""Let organizations choose which standard object fields are public

collections.discover_configs.public_object_fields: JSON list of field keys
from app.services.public_object_fields.FIELD_CATALOG. NULL (every existing
row) means the defaults, which are the fields the public record page
published before this setting existed, so nothing changes until an
organization saves a choice.

discover_configs is already covered by row-level security; no policy change.

Revision ID: e3c71a9f4b28
Revises: 8b5d2e7f1a36
"""
from alembic import op

revision = "e3c71a9f4b28"
down_revision = "8b5d2e7f1a36"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE collections.discover_configs "
        "ADD COLUMN IF NOT EXISTS public_object_fields JSONB"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE collections.discover_configs DROP COLUMN IF EXISTS public_object_fields"
    )
