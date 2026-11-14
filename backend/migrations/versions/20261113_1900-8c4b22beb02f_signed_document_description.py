"""Add signed_documents.description for general procedure attachments

Procedure records (acquisitions first) can now carry general file
attachments (invoices, correspondence, braille-ready copies) alongside
their signed documents. They reuse the polymorphic signed_documents table
with document_type = 'attachment'; label holds the title and this new
nullable column holds an optional longer description. No backfill.

Revision ID: 8c4b22beb02f
Revises: b7e3a9c41f62
"""
from alembic import op

revision = "8c4b22beb02f"
down_revision = "b7e3a9c41f62"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE collections.signed_documents ADD COLUMN IF NOT EXISTS description text")


def downgrade() -> None:
    op.execute("ALTER TABLE collections.signed_documents DROP COLUMN IF EXISTS description")
