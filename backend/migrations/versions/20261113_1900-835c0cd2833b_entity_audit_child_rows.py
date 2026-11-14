"""Identify the child row on entity audit events

public.entity_audit_events gains child_entity_type, child_entity_id and
child_display_key. Changes to child rows (an object's titles, measurements,
other numbers, inscriptions, media links and flags; a bib record's holdings
and items; a research visit's objects; an indemnity's objects; a policy's
coverages) are recorded as link_added / link_removed / link_updated events on
the parent record, so they appear in the parent's history. These columns say
which child row each event is about.

No RLS change: the table keeps its existing organization_id policy.

Revision ID: 835c0cd2833b
Revises: b7e3a9c41f62
"""
from alembic import op

revision = "835c0cd2833b"
down_revision = "b7e3a9c41f62"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE entity_audit_events ADD COLUMN IF NOT EXISTS child_entity_type VARCHAR(100)")
    op.execute("ALTER TABLE entity_audit_events ADD COLUMN IF NOT EXISTS child_entity_id UUID")
    op.execute("ALTER TABLE entity_audit_events ADD COLUMN IF NOT EXISTS child_display_key VARCHAR(500)")
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_entity_audit_events_child "
        "ON entity_audit_events (child_entity_type, child_entity_id)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_entity_audit_events_child")
    op.execute("ALTER TABLE entity_audit_events DROP COLUMN IF EXISTS child_display_key")
    op.execute("ALTER TABLE entity_audit_events DROP COLUMN IF EXISTS child_entity_id")
    op.execute("ALTER TABLE entity_audit_events DROP COLUMN IF EXISTS child_entity_type")
