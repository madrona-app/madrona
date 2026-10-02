"""
Automated coverage test: every table with an ``organization_id`` column
must have row-level security enabled and at least one policy.

This is the guard that would have caught the gaps previously fixed by
the ``add_rls_missing_tables`` and ``add_rls_entity_relationships``
migrations. Run it against a fully-migrated + RLS-seeded database in CI
so any new org-scoped table that ships without a policy fails the build.

Exemptions live in ``EXEMPT_TABLES`` below — each entry needs a reason.

Bootstrap path: the consolidated initial migration
(``33d81a377dc7_initial_consolidated_schema``) deliberately excludes RLS
plumbing. RLS policies live in ``backend/seeds/seed_rls_policies.py`` and
are applied at boot by ``backend/entrypoint.sh`` (and by the test fixture
in ``tests/conftest.py::_seed_rls_policies_for_tests``). If this test
fails, the seed either didn't run or a new org-scoped table was added
without being included in ``RLS_TABLES`` in the seed.
"""

import os

import pytest
from sqlalchemy import text


EXEMPT_TABLES: dict[str, str] = {
    # Global catalog tables that are intentionally org-scope-free.
    # Every exemption must be justified in a comment.
    #
    # Platform-level provisioning saga tables. organization_id is the *target*
    # of provisioning (NULL until create_organization step), so the standard
    # `organization_id = current_org_id()` policy denied every INSERT.
    # Authorization for these endpoints is enforced by FastAPI's
    # require_platform_admin dependency, not RLS. See migration
    # f1a2b3c4d5e6 (20260505_1700-disable_rls_on_platform_provisioning_tables).
    "org_provisioning_jobs": "platform saga: organization_id is target, NULL until create_organization step; authz via require_platform_admin",
    "provisioning_audit_logs": "platform saga audit trail; same rationale as org_provisioning_jobs",
}


# Tables that descend from an org-scoped parent by foreign key but are NOT
# themselves tenant data. Each needs a reason, same as EXEMPT_TABLES.
EXEMPT_DESCENDANT_TABLES: dict[str, str] = {
    "public.refresh_tokens": "auth internals: looked up by token hash before any org context exists, so an org-scoped policy would deny the login it is meant to establish",
    "public.role_permissions": "global role definitions, not tenant data; the same rows apply to every organization",
}


# Tables that intentionally have RLS enabled but NOT FORCED. The owner role
# (BYPASSRLS) can read these for system/admin operations. Everything else
# should be FORCED so the owner can't silently bypass tenant isolation.
FORCE_RLS_EXEMPT_TABLES: dict[str, str] = {
    "collections.user_active_context": "per-user ephemeral state; owner may read for admin tasks",
    "collections.workspaces": "user-owned; owner needs unscoped access for list/transfer tooling",
    "collections.workspace_shares": "user-owned; admin needs to see all shares",
    "media.media": "DAM owner admin ops (reprocessing, bulk migration)",
    "media.media_collections": "DAM admin ops",
    "media.media_consent": "DAM admin ops",
    "media.media_derivatives": "DAM regeneration pipeline runs as owner",
    "media.media_download_requests": "DAM admin ops",
    "media.media_field_inheritance_config": "DAM admin ops",
    "media.media_folders": "DAM admin ops",
    "media.media_processing_jobs": "DAM processing pipeline runs as owner",
    "media.media_rights": "DAM admin ops",
    "media.media_tag_definitions": "DAM admin ops",
    "media.media_tags": "DAM admin ops",
    "media.media_usage_events": "usage logging written by system/owner role",
    "media.media_versions": "DAM admin ops",
    "media.watermark_templates": "DAM admin ops",
    "public.record_comments": "comment surface allows cross-tenant admin moderation",
    "public.record_watches": "user-owned subscriptions",
}


pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        not os.environ.get("TEST_DATABASE_URL"),
        reason="Requires a migrated PostgreSQL (TEST_DATABASE_URL not set)",
    ),
]


@pytest.fixture(scope="module")
def engine(test_engine):
    """The suite's own engine, not a fresh one built from TEST_DATABASE_URL.

    Same fix, same reason, as tests/postgres/test_department_rls_guc.py.
    Under xdist each worker gets its own database (`madrona_test_gw0`, ...)
    and conftest applies the RLS seed to *that* database; the raw env var
    still points at the base database, which no worker seeds. This file
    therefore reported whatever RLS state happened to be left in the base
    database by some earlier run — passing or failing for reasons unrelated
    to the commit under test. Sharding surfaced it: the tables it flagged
    (`public.organizations`, `public.user_layout_overrides`) are fully
    covered in the database the fixtures actually prepared.
    """
    yield test_engine


def _org_scoped_tables(conn) -> list[tuple[str, str]]:
    rows = conn.execute(text("""
        SELECT c.table_schema, c.table_name
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema
         AND t.table_name   = c.table_name
        WHERE c.column_name = 'organization_id'
          AND t.table_type  = 'BASE TABLE'
          AND c.table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY c.table_schema, c.table_name
    """)).all()
    return [
        (schema, name)
        for schema, name in rows
        if name not in EXEMPT_TABLES
    ]


def test_rls_enabled_on_every_org_scoped_table(engine):
    """RLS must be enabled on every table that carries organization_id."""
    with engine.connect() as conn:
        missing = []
        for schema, name in _org_scoped_tables(conn):
            enabled = conn.execute(text("""
                SELECT c.relrowsecurity
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = :s AND c.relname = :t
            """), {"s": schema, "t": name}).scalar()
            if not enabled:
                missing.append(f"{schema}.{name}")

        assert not missing, (
            "RLS is not enabled on these org-scoped tables. "
            "Add `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` in a migration, "
            "or add the table to EXEMPT_TABLES with a documented reason.\n"
            f"Tables: {missing}"
        )


def test_policy_exists_for_every_org_scoped_table(engine):
    """Every org-scoped table must have at least one RLS policy defined."""
    with engine.connect() as conn:
        missing = []
        for schema, name in _org_scoped_tables(conn):
            has_policy = conn.execute(text("""
                SELECT EXISTS (
                    SELECT 1 FROM pg_policies
                    WHERE schemaname = :s AND tablename = :t
                )
            """), {"s": schema, "t": name}).scalar()
            if not has_policy:
                missing.append(f"{schema}.{name}")

        assert not missing, (
            "No RLS policy on these org-scoped tables. "
            "A CREATE POLICY statement is required for tenant isolation.\n"
            f"Tables: {missing}"
        )


def test_rls_is_forced_on_every_org_scoped_table(engine):
    """
    RLS must be FORCED so table owners cannot bypass policies. Without
    ``FORCE ROW LEVEL SECURITY`` a superuser/owner connection (e.g. the
    migration role) silently reads across tenants.

    Tables in ``FORCE_RLS_EXEMPT_TABLES`` are allowed to have RLS enabled
    but not FORCED — each has a documented reason for owner-bypass access.
    """
    with engine.connect() as conn:
        missing = []
        for schema, name in _org_scoped_tables(conn):
            fqn = f"{schema}.{name}"
            if fqn in FORCE_RLS_EXEMPT_TABLES:
                continue
            forced = conn.execute(text("""
                SELECT c.relforcerowsecurity
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = :s AND c.relname = :t
            """), {"s": schema, "t": name}).scalar()
            if not forced:
                missing.append(fqn)

        assert not missing, (
            "RLS is not FORCED on these org-scoped tables. "
            "Add `ALTER TABLE ... FORCE ROW LEVEL SECURITY` so owner/admin "
            "connections cannot bypass tenant isolation, or document an "
            "exemption in FORCE_RLS_EXEMPT_TABLES.\n"
            f"Tables: {missing}"
        )


def _org_descendant_tables(conn) -> list[tuple[str, str]]:
    """Tables with no organization_id that hang off an org-scoped table by FK.

    These inherit tenancy from a parent and are just as much tenant data as a
    table with its own organization_id — but the tests above cannot see them,
    because they look for the column. Sixteen such tables shipped with no
    policy at all, leaving the app layer as the only control; several routers
    scoped their create handler to the org and their delete/update handlers
    not at all, which let one institution edit another's rows.
    """
    rows = conn.execute(text("""
        WITH org_tables AS (
            SELECT c.table_schema, c.table_name
            FROM information_schema.columns c
            JOIN information_schema.tables t
              ON t.table_schema = c.table_schema AND t.table_name = c.table_name
            WHERE c.column_name = 'organization_id'
              AND t.table_type = 'BASE TABLE'
        )
        SELECT DISTINCT tc.table_schema, tc.table_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu
          ON tc.constraint_name = ccu.constraint_name
         AND tc.table_schema = ccu.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND (ccu.table_schema, ccu.table_name) IN (SELECT * FROM org_tables)
          AND (tc.table_schema, tc.table_name) NOT IN (SELECT * FROM org_tables)
          AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY 1, 2
    """)).all()
    return [
        (schema, name)
        for schema, name in rows
        if f"{schema}.{name}" not in EXEMPT_DESCENDANT_TABLES
    ]


def test_policy_exists_for_every_org_descendant_table(engine):
    """Child tables of org-scoped parents need a policy too.

    The policy shape is an FK subquery against the parent — see the
    "_via_parent" entries in seeds/seed_rls_policies.py.
    """
    with engine.connect() as conn:
        missing = []
        for schema, name in _org_descendant_tables(conn):
            has_policy = conn.execute(text("""
                SELECT EXISTS (
                    SELECT 1 FROM pg_policies
                    WHERE schemaname = :s AND tablename = :t
                )
            """), {"s": schema, "t": name}).scalar()
            if not has_policy:
                missing.append(f"{schema}.{name}")

        assert not missing, (
            "These tables inherit tenancy through a foreign key to an "
            "org-scoped table but have no RLS policy. Add an FK-subquery "
            "policy to seeds/seed_rls_policies.py (see the '_via_parent' "
            "entries), or add the table to EXEMPT_DESCENDANT_TABLES with a "
            "documented reason.\n"
            f"Tables: {missing}"
        )


def test_rls_enabled_on_every_org_descendant_table(engine):
    """A policy does nothing unless RLS is actually enabled on the table."""
    with engine.connect() as conn:
        missing = []
        for schema, name in _org_descendant_tables(conn):
            enabled = conn.execute(text("""
                SELECT c.relrowsecurity
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = :s AND c.relname = :t
            """), {"s": schema, "t": name}).scalar()
            if not enabled:
                missing.append(f"{schema}.{name}")

        assert not missing, (
            "RLS is not enabled on these org-descendant tables, so their "
            "policies are inert. Add them to RLS_TABLES in "
            "seeds/seed_rls_policies.py.\n"
            f"Tables: {missing}"
        )
