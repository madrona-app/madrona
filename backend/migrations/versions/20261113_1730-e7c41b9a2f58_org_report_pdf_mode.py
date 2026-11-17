"""Add organizations.report_pdf_mode

Per-organization choice of which PDF report exports are offered:
'all' (default — unchanged behaviour), 'tagged_only' (hide PDFs that are not
tagged for access technology), or 'none' (accessible formats only: HTML,
Word, plain text, CSV, Excel).

Revision ID: e7c41b9a2f58
Revises: 7c4e1a9b2d58
"""
from alembic import op

revision = "e7c41b9a2f58"
down_revision = "7c4e1a9b2d58"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IF NOT EXISTS / guarded constraint: the test harness builds the schema
    # from the models first.
    op.execute(
        "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS report_pdf_mode "
        "varchar(20) NOT NULL DEFAULT 'all'"
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'check_org_report_pdf_mode'
            ) THEN
                ALTER TABLE organizations ADD CONSTRAINT check_org_report_pdf_mode
                    CHECK (report_pdf_mode IN ('all', 'tagged_only', 'none'));
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE organizations DROP CONSTRAINT IF EXISTS check_org_report_pdf_mode")
    op.execute("ALTER TABLE organizations DROP COLUMN IF EXISTS report_pdf_mode")
