"""User-defined fields on object records

- collections.custom_field_definitions (org-scoped; RLS from the boot seed,
  also enabled here)
- collection_objects.custom_fields jsonb (+ GIN index for search)

Revision ID: d6a3c9e5b127
Revises: d5f2b8c4a016
"""
from alembic import op

revision = "d6a3c9e5b127"
down_revision = "d5f2b8c4a016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    CREATE TABLE IF NOT EXISTS collections.custom_field_definitions (
        field_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
        entity_type varchar(50) NOT NULL DEFAULT 'collection_object',
        key varchar(60) NOT NULL,
        label varchar(120) NOT NULL,
        help_text text,
        field_type varchar(20) NOT NULL DEFAULT 'text',
        options jsonb,
        is_required boolean NOT NULL DEFAULT false,
        is_searchable boolean NOT NULL DEFAULT true,
        is_public boolean NOT NULL DEFAULT false,
        section varchar(60),
        sort_order integer NOT NULL DEFAULT 0,
        is_active boolean NOT NULL DEFAULT true,
        view_roles jsonb,
        edit_roles jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        created_by uuid REFERENCES public.users(user_id) ON DELETE SET NULL,
        CONSTRAINT uq_custom_field_org_entity_key UNIQUE (organization_id, entity_type, key),
        CONSTRAINT ck_custom_field_type CHECK (field_type IN
            ('text', 'long_text', 'number', 'date', 'boolean', 'select', 'multi_select', 'url'))
    )""")
    op.execute("CREATE INDEX IF NOT EXISTS ix_custom_field_definitions_org "
               "ON collections.custom_field_definitions (organization_id, entity_type, is_active)")
    op.execute("ALTER TABLE collections.custom_field_definitions ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE collections.custom_field_definitions FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS custom_field_definitions_org_isolation ON collections.custom_field_definitions")
    op.execute("CREATE POLICY custom_field_definitions_org_isolation ON collections.custom_field_definitions FOR ALL "
               "USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id())")
    op.execute("""
    DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'madrona_app') THEN
            GRANT SELECT, INSERT, UPDATE, DELETE ON collections.custom_field_definitions TO madrona_app;
        END IF;
    END $$""")
    op.execute("ALTER TABLE collections.collection_objects ADD COLUMN IF NOT EXISTS custom_fields jsonb")
    op.execute("CREATE INDEX IF NOT EXISTS ix_objects_custom_fields ON collections.collection_objects USING gin (custom_fields)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS collections.ix_objects_custom_fields")
    op.execute("ALTER TABLE collections.collection_objects DROP COLUMN IF EXISTS custom_fields")
    op.execute("DROP TABLE IF EXISTS collections.custom_field_definitions")
