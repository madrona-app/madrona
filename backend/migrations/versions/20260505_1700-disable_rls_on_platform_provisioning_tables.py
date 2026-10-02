"""disable RLS on org_provisioning_jobs + provisioning_audit_logs

Revision ID: f1a2b3c4d5e6
Revises: e5a6b7c8d9e0
Create Date: 2026-05-05 17:00:00

The 2026-04-23 RLS bootstrap (seed_rls_policies.py) enabled RLS on
208 tables, including these two — but they are PLATFORM-level, not
org-scoped:

  * org_provisioning_jobs.organization_id is the *target* of provisioning,
    NULL until the saga's create_organization step runs. The standard
    `organization_id = current_org_id()` policy denied every INSERT
    because NULL never matches the requester's current_org_id, which
    is their own admin org (something else entirely).
  * provisioning_audit_logs is the audit trail for the same flow.

Result: every call to /api/platform/provision since 2026-04-23 returned
500 with `psycopg.errors.InsufficientPrivilege: new row violates
row-level security policy`. The endpoint isn't called frequently so
nobody noticed until the first sandbox-org test today (2026-05-05).

This migration:
  1. Drops the org-isolation policies on both tables (if present).
  2. Disables RLS + force-RLS on both tables.
  3. Idempotent: each step is IF EXISTS / NOT EXISTS, safe to re-run.

Authorization comes from FastAPI's `require_platform_admin` dependency
on the affected endpoints, not from RLS — so disabling RLS here does
not weaken the actual access controls.

Forward-only: down_revision exists for ordering but down() is a no-op
because re-enabling broken RLS would just re-break the endpoint.
"""
from alembic import op

revision = "f1a2b3c4d5e6"
down_revision = "e5a6b7c8d9e0"
branch_labels = None
depends_on = None


_TABLES = (
    "org_provisioning_jobs",
    "provisioning_audit_logs",
)


def upgrade() -> None:
    for table in _TABLES:
        # Drop the standard org-isolation policy if present.
        op.execute(
            f"DROP POLICY IF EXISTS {table}_org_isolation ON public.{table}"
        )
        # Disable + un-force RLS so no leftover policies block anything.
        op.execute(f"ALTER TABLE public.{table} DISABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE public.{table} NO FORCE ROW LEVEL SECURITY")


def downgrade() -> None:
    # Intentional no-op. Re-enabling the broken policy would re-break the
    # /api/platform/provision endpoint. If a future caller needs RLS on
    # these tables, design a policy that handles NULL organization_id
    # (e.g. `organization_id IS NULL OR organization_id = current_org_id()`)
    # rather than reverting this migration.
    pass
