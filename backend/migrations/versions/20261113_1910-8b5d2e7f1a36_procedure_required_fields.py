"""Add org-configurable extra required fields per procedure

organizations.procedure_required_fields (JSONB, default {}): fields an
organization admin has made required for a procedure on top of its fixed
baseline. Shape: {"loan_out": ["venue_name", ...]}. Lives on the
organizations row beside procedure_enforcement, so no new table and no new
row-level-security policy.

Revision ID: 8b5d2e7f1a36
Revises: 3c8e1f6a9d24
"""
from alembic import op

revision = "8b5d2e7f1a36"
down_revision = "3c8e1f6a9d24"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE public.organizations "
        "ADD COLUMN IF NOT EXISTS procedure_required_fields JSONB DEFAULT '{}'::jsonb"
    )
    op.execute(
        "COMMENT ON COLUMN public.organizations.procedure_required_fields IS "
        "'Org-added required fields per procedure. Key = procedure_type, value = list of field names.'"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE public.organizations DROP COLUMN IF EXISTS procedure_required_fields")
