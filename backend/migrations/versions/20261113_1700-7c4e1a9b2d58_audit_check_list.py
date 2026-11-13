"""Audit campaign check lists

Records how a campaign's check list was generated (seed, time, user, and the
effective parameters) so a sample can be reproduced, and gives each generated
audit result its position in the list.

Revision ID: 7c4e1a9b2d58
Revises: d2b8e4f0c312
"""
from alembic import op

revision = "7c4e1a9b2d58"
down_revision = "d2b8e4f0c312"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE collections.audit_campaigns ADD COLUMN IF NOT EXISTS check_list_seed bigint")
    op.execute("ALTER TABLE collections.audit_campaigns ADD COLUMN IF NOT EXISTS check_list_generated_at timestamptz")
    op.execute(
        "ALTER TABLE collections.audit_campaigns ADD COLUMN IF NOT EXISTS check_list_generated_by uuid "
        "REFERENCES public.users(user_id) ON DELETE SET NULL"
    )
    op.execute("ALTER TABLE collections.audit_campaigns ADD COLUMN IF NOT EXISTS check_list_params jsonb")
    op.execute("ALTER TABLE collections.audit_results ADD COLUMN IF NOT EXISTS check_sequence integer")


def downgrade() -> None:
    op.execute("ALTER TABLE collections.audit_results DROP COLUMN IF EXISTS check_sequence")
    op.execute("ALTER TABLE collections.audit_campaigns DROP COLUMN IF EXISTS check_list_params")
    op.execute("ALTER TABLE collections.audit_campaigns DROP COLUMN IF EXISTS check_list_generated_by")
    op.execute("ALTER TABLE collections.audit_campaigns DROP COLUMN IF EXISTS check_list_generated_at")
    op.execute("ALTER TABLE collections.audit_campaigns DROP COLUMN IF EXISTS check_list_seed")
