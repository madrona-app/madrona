"""Hide deaccessioned records from general search (organization setting)

organizations.hide_deaccessioned_in_search: on by default. While on, staff
general search and object lists leave out deaccessioned objects unless the
request asks for them, and the public portal never shows them.

organizations already has row-level security; no policy change.

Revision ID: f4d82b0a5c39
Revises: e3c71a9f4b28
"""
from alembic import op

revision = "f4d82b0a5c39"
down_revision = "e3c71a9f4b28"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE public.organizations "
        "ADD COLUMN IF NOT EXISTS hide_deaccessioned_in_search BOOLEAN NOT NULL DEFAULT true"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE public.organizations DROP COLUMN IF EXISTS hide_deaccessioned_in_search")
