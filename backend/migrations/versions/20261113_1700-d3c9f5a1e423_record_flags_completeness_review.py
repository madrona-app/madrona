"""Record flags, completeness rules, cataloging_status column

- collections.record_flag_definitions: flags the administrator defines
  (on view, access restricted, heavy, ...).
- collections.object_flags: flags set on object records, by hand or by a
  completeness rule.
- collections.completeness_rules: organization-defined requirements; records
  that meet one get its flag automatically; a rule can be required before
  publication.
- The review itself uses the existing approval engine (approval_rules /
  approval_requests): no table for it here.
- collection_objects.cataloging_status: promoted from
  extra_metadata['cataloging_status'] (written only by the workspace bulk
  action until now), so the review workflow can own the "In review" state.

All three tables are organization-scoped; their RLS policies come from
seeds/seed_rls_policies.py, which runs on boot.

Revision ID: d3c9f5a1e423
Revises: d2b8e4f0c312
"""
from alembic import op

revision = "d3c9f5a1e423"
down_revision = "d2b8e4f0c312"
branch_labels = None
depends_on = None

_STATUSES = "('not_started', 'in_progress', 'pending_review', 'needs_research', 'cataloged')"


def upgrade() -> None:
    op.execute("""
    CREATE TABLE IF NOT EXISTS collections.record_flag_definitions (
        flag_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
        key varchar(60) NOT NULL,
        label varchar(120) NOT NULL,
        description text,
        sort_order integer NOT NULL DEFAULT 0,
        is_active boolean NOT NULL DEFAULT true,
        is_rule_managed boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        created_by uuid REFERENCES public.users(user_id) ON DELETE SET NULL,
        CONSTRAINT uq_record_flag_definitions_org_key UNIQUE (organization_id, key)
    )""")
    op.execute("CREATE INDEX IF NOT EXISTS ix_record_flag_definitions_org ON collections.record_flag_definitions (organization_id, is_active)")

    op.execute("""
    CREATE TABLE IF NOT EXISTS collections.object_flags (
        object_id uuid NOT NULL REFERENCES collections.collection_objects(object_id) ON DELETE CASCADE,
        flag_id uuid NOT NULL REFERENCES collections.record_flag_definitions(flag_id) ON DELETE CASCADE,
        organization_id uuid NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
        source varchar(10) NOT NULL DEFAULT 'manual',
        note text,
        set_at timestamptz NOT NULL DEFAULT now(),
        set_by uuid REFERENCES public.users(user_id) ON DELETE SET NULL,
        PRIMARY KEY (object_id, flag_id),
        CONSTRAINT ck_object_flags_source CHECK (source IN ('manual', 'rule'))
    )""")
    op.execute("CREATE INDEX IF NOT EXISTS ix_object_flags_org_flag ON collections.object_flags (organization_id, flag_id)")

    op.execute("""
    CREATE TABLE IF NOT EXISTS collections.completeness_rules (
        rule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
        name varchar(120) NOT NULL,
        description text,
        requirements jsonb NOT NULL DEFAULT '[]'::jsonb,
        flag_id uuid NOT NULL REFERENCES collections.record_flag_definitions(flag_id) ON DELETE RESTRICT,
        required_for_publication boolean NOT NULL DEFAULT false,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        created_by uuid REFERENCES public.users(user_id) ON DELETE SET NULL
    )""")
    op.execute("CREATE INDEX IF NOT EXISTS ix_completeness_rules_org ON collections.completeness_rules (organization_id, is_active)")

    for table in ("record_flag_definitions", "object_flags", "completeness_rules"):
        op.execute(f"ALTER TABLE collections.{table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE collections.{table} FORCE ROW LEVEL SECURITY")
        op.execute(f"DROP POLICY IF EXISTS {table}_org_isolation ON collections.{table}")
        op.execute(
            f"CREATE POLICY {table}_org_isolation ON collections.{table} FOR ALL "
            f"USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id())"
        )
        op.execute(f"""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'madrona_app') THEN
                GRANT SELECT, INSERT, UPDATE, DELETE ON collections.{table} TO madrona_app;
            END IF;
        END $$""")

    op.execute("ALTER TABLE collections.collection_objects ADD COLUMN IF NOT EXISTS cataloging_status varchar(30)")
    op.execute(f"""
    DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_cataloging_status') THEN
            ALTER TABLE collections.collection_objects ADD CONSTRAINT check_cataloging_status
                CHECK (cataloging_status IS NULL OR cataloging_status IN {_STATUSES});
        END IF;
    END $$""")
    # Move the bulk action's values into the column. A record left "pending
    # review" by the old action had no reviewer and no review record, so it
    # becomes "in progress" rather than appearing to be in someone's queue.
    op.execute(f"""
    UPDATE collections.collection_objects
       SET cataloging_status = CASE
               WHEN extra_metadata->>'cataloging_status' = 'pending_review' THEN 'in_progress'
               ELSE extra_metadata->>'cataloging_status' END,
           extra_metadata = extra_metadata - 'cataloging_status'
     WHERE cataloging_status IS NULL
       AND extra_metadata ? 'cataloging_status'
       AND extra_metadata->>'cataloging_status' IN {_STATUSES}
    """)


def downgrade() -> None:
    op.execute("""
    UPDATE collections.collection_objects
       SET extra_metadata = COALESCE(extra_metadata, '{}'::jsonb) || jsonb_build_object('cataloging_status', cataloging_status)
     WHERE cataloging_status IS NOT NULL
    """)
    op.execute("ALTER TABLE collections.collection_objects DROP CONSTRAINT IF EXISTS check_cataloging_status")
    op.execute("ALTER TABLE collections.collection_objects DROP COLUMN IF EXISTS cataloging_status")
    for table in ("completeness_rules", "object_flags", "record_flag_definitions"):
        op.execute(f"DROP TABLE IF EXISTS collections.{table}")
