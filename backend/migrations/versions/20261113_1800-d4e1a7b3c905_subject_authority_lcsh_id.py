"""Add subject_authorities.lcsh_id

Keeps the Library of Congress Subject Heading identifier (e.g. sh85015235)
when staff link an LCSH heading to an object in the Subjects section, as
aat_id / iconclass_id / wikidata_id already do. Nullable, no backfill.

Revision ID: d4e1a7b3c905
Revises: c9d1f5c7d7d0
"""
from alembic import op

revision = "d4e1a7b3c905"
down_revision = "c9d1f5c7d7d0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE collections.subject_authorities ADD COLUMN IF NOT EXISTS lcsh_id varchar(50)")


def downgrade() -> None:
    op.execute("ALTER TABLE collections.subject_authorities DROP COLUMN IF EXISTS lcsh_id")
