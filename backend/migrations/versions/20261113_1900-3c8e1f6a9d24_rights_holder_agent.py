"""Add "agent for rights holder" to object rights and media rights

collections.object_rights.rights_holder_agent_contact_id: the contact
(person or organisation) acting for the rights holder, linked the same way
as rights_holder_contact_id.

media.media_rights.rights_holder_agent_contact_id + rights_holder_agent:
the linked contact plus a free-text name fallback, mirroring the free-text
rights_holder column on media rights.

Both tables are already org-scoped and covered by row-level security; no
new tables.

Revision ID: 3c8e1f6a9d24
Revises: 8c4b22beb02f
"""
from alembic import op

revision = "3c8e1f6a9d24"
down_revision = "8c4b22beb02f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE collections.object_rights "
        "ADD COLUMN IF NOT EXISTS rights_holder_agent_contact_id UUID "
        "REFERENCES collections.constituents(constituent_id) ON DELETE SET NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_rights_holder_agent_contact "
        "ON collections.object_rights (rights_holder_agent_contact_id)"
    )

    op.execute(
        "ALTER TABLE media.media_rights "
        "ADD COLUMN IF NOT EXISTS rights_holder_agent_contact_id UUID "
        "REFERENCES collections.constituents(constituent_id) ON DELETE SET NULL"
    )
    op.execute(
        "ALTER TABLE media.media_rights "
        "ADD COLUMN IF NOT EXISTS rights_holder_agent VARCHAR(255)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_media_rights_agent_contact "
        "ON media.media_rights (rights_holder_agent_contact_id)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS media.ix_media_rights_agent_contact")
    op.execute("ALTER TABLE media.media_rights DROP COLUMN IF EXISTS rights_holder_agent")
    op.execute(
        "ALTER TABLE media.media_rights DROP COLUMN IF EXISTS rights_holder_agent_contact_id"
    )
    op.execute("DROP INDEX IF EXISTS collections.ix_rights_holder_agent_contact")
    op.execute(
        "ALTER TABLE collections.object_rights "
        "DROP COLUMN IF EXISTS rights_holder_agent_contact_id"
    )
