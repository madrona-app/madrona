"""
Integration tests for FORCE Row Level Security with madrona_app role.

These tests prove that FORCE RLS works correctly by connecting as madrona_app
(NOBYPASSRLS), NOT the owner role. This is the critical gap in existing tests:
the owner role bypasses RLS, so those tests can't prove FORCE RLS behavior.

Key assertions:
  1. No org context → 0 rows (FORCE RLS blocks everything)
  2. Org A context  → only org A rows visible
  3. Cross-org INSERT is blocked by WITH CHECK

Requires:
  - PostgreSQL via TEST_DATABASE_URL (owner/superuser connection)
  - The test creates madrona_app role and schemas automatically

Run with:
    cd backend && TEST_DATABASE_URL=postgresql://madrona:pw@localhost/madrona_test \
        ./venv/bin/python -m pytest tests/postgres/test_rls_force_integration.py -v
"""

import os
import pytest
from uuid import uuid4

from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool


def _fix_dialect(url: str) -> str:
    """Ensure URL uses psycopg3 dialect (postgresql+psycopg://)."""
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+psycopg://", 1)
    return url


pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        not os.environ.get("TEST_DATABASE_URL"),
        reason="Integration tests require PostgreSQL (TEST_DATABASE_URL not set)",
    ),
]

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def owner_engine():
    """Engine connected as the owner/superuser role (for setup and teardown)."""
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL not set")
    engine = create_engine(_fix_dialect(url), poolclass=NullPool)
    yield engine
    engine.dispose()


@pytest.fixture(scope="module")
def rls_setup(owner_engine):
    """
    One-time setup: create madrona_app role, schema, table, RLS policies.

    Returns (org_a_id, org_b_id) for use in tests.
    """
    org_a_id = uuid4()
    org_b_id = uuid4()
    dataset_a_id = uuid4()
    dataset_b_id = uuid4()

    with owner_engine.connect() as conn:
        # ── 1. Create madrona_app role (NOBYPASSRLS) if not exists ──
        exists = conn.execute(
            text("SELECT 1 FROM pg_roles WHERE rolname = 'madrona_app'")
        ).fetchone()
        if not exists:
            conn.execute(text(
                "CREATE ROLE madrona_app LOGIN PASSWORD 'madrona_app_test' NOBYPASSRLS"
            ))
            conn.commit()

        # Ensure the role has NOBYPASSRLS and a known password
        conn.execute(text("ALTER ROLE madrona_app NOBYPASSRLS PASSWORD 'madrona_app_test'"))
        conn.commit()

        # ── 2. Create test schema + table ──
        conn.execute(text("CREATE SCHEMA IF NOT EXISTS rls_test"))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS rls_test.datasets (
                dataset_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                organization_id UUID NOT NULL,
                name TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        """))
        conn.commit()

        # ── 3. Create current_org_id() function ──
        conn.execute(text("""
            CREATE OR REPLACE FUNCTION public.current_org_id()
            RETURNS uuid
            LANGUAGE plpgsql
            STABLE
            AS $function$
            BEGIN
                RETURN NULLIF(current_setting('app.current_org_id', true), '')::uuid;
            EXCEPTION WHEN OTHERS THEN
                RETURN NULL;
            END;
            $function$
        """))
        conn.commit()

        # ── 4. Enable FORCE RLS + create policy ──
        conn.execute(text("ALTER TABLE rls_test.datasets ENABLE ROW LEVEL SECURITY"))
        conn.execute(text("ALTER TABLE rls_test.datasets FORCE ROW LEVEL SECURITY"))
        conn.execute(text("DROP POLICY IF EXISTS datasets_org_isolation ON rls_test.datasets"))
        conn.execute(text("""
            CREATE POLICY datasets_org_isolation ON rls_test.datasets
            USING (organization_id = current_org_id())
            WITH CHECK (organization_id = current_org_id())
        """))
        conn.commit()

        # ── 5. Grant permissions to madrona_app ──
        conn.execute(text("GRANT USAGE ON SCHEMA rls_test TO madrona_app"))
        conn.execute(text("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA rls_test TO madrona_app"))
        conn.commit()

        # ── 6. Seed test data (as owner, bypasses RLS) ──
        conn.execute(text("DELETE FROM rls_test.datasets"))  # clean slate
        conn.execute(
            text("""
                INSERT INTO rls_test.datasets (dataset_id, organization_id, name)
                VALUES (:id, :org_id, :name)
            """),
            {"id": str(dataset_a_id), "org_id": str(org_a_id), "name": "Dataset A"},
        )
        conn.execute(
            text("""
                INSERT INTO rls_test.datasets (dataset_id, organization_id, name)
                VALUES (:id, :org_id, :name)
            """),
            {"id": str(dataset_b_id), "org_id": str(org_b_id), "name": "Dataset B"},
        )
        conn.commit()

    yield {
        "org_a_id": org_a_id,
        "org_b_id": org_b_id,
        "dataset_a_id": dataset_a_id,
        "dataset_b_id": dataset_b_id,
    }

    # ── Teardown ──
    with owner_engine.connect() as conn:
        conn.execute(text("DROP TABLE IF EXISTS rls_test.datasets CASCADE"))
        conn.execute(text("DROP SCHEMA IF EXISTS rls_test CASCADE"))
        conn.commit()


@pytest.fixture(scope="module")
def app_engine(owner_engine, rls_setup):
    """
    Engine connected as madrona_app (NOBYPASSRLS).

    Derives the connection URL from TEST_DATABASE_URL by replacing the
    username with madrona_app.
    """
    owner_url = os.environ.get("TEST_DATABASE_URL", "")

    # Derive host/port/dbname from the owner URL, connect as madrona_app
    from urllib.parse import urlparse

    parsed = urlparse(owner_url)
    host = parsed.hostname or "localhost"
    port = parsed.port or 5432
    dbname = parsed.path.lstrip("/") if parsed.path else "madrona"
    app_url = f"postgresql+psycopg://madrona_app:madrona_app_test@{host}:{port}/{dbname}"

    engine = create_engine(app_url, poolclass=NullPool)
    yield engine
    engine.dispose()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestForceRLS:
    """
    Prove FORCE RLS behavior when connected as madrona_app (NOBYPASSRLS).

    These tests are the security boundary proof: if they pass, we know that
    the application role cannot bypass RLS even without SET ROLE tricks.
    """

    def test_no_context_returns_zero_rows(self, app_engine, rls_setup):
        """
        With FORCE RLS and no app.current_org_id set, madrona_app sees 0 rows.

        This is the critical difference from the owner-role tests: the owner
        sees ALL rows when no context is set, but madrona_app sees NONE.
        """
        with app_engine.connect() as conn:
            # Explicitly reset any lingering context
            conn.execute(text("RESET app.current_org_id"))

            result = conn.execute(text("SELECT count(*) FROM rls_test.datasets"))
            count = result.scalar()

            assert count == 0, (
                f"FORCE RLS violation: madrona_app saw {count} rows with no org context "
                f"(expected 0). This means FORCE RLS is not working."
            )

    def test_org_context_isolates_rows(self, app_engine, rls_setup):
        """
        With org A context, madrona_app sees only org A rows.
        With org B context, madrona_app sees only org B rows.
        """
        org_a_id = rls_setup["org_a_id"]
        org_b_id = rls_setup["org_b_id"]
        dataset_a_id = rls_setup["dataset_a_id"]
        dataset_b_id = rls_setup["dataset_b_id"]

        with app_engine.connect() as conn:
            # ── Org A context ──
            conn.execute(text(f"SET LOCAL app.current_org_id = '{org_a_id}'"))
            rows = conn.execute(text("SELECT dataset_id, name FROM rls_test.datasets")).fetchall()
            visible_ids = {str(r[0]) for r in rows}

            assert str(dataset_a_id) in visible_ids, "Dataset A should be visible with org A context"
            assert str(dataset_b_id) not in visible_ids, "Dataset B must NOT be visible with org A context"
            assert len(rows) == 1, f"Expected exactly 1 row with org A context, got {len(rows)}"

        with app_engine.connect() as conn:
            # ── Org B context ──
            conn.execute(text(f"SET LOCAL app.current_org_id = '{org_b_id}'"))
            rows = conn.execute(text("SELECT dataset_id, name FROM rls_test.datasets")).fetchall()
            visible_ids = {str(r[0]) for r in rows}

            assert str(dataset_b_id) in visible_ids, "Dataset B should be visible with org B context"
            assert str(dataset_a_id) not in visible_ids, "Dataset A must NOT be visible with org B context"
            assert len(rows) == 1, f"Expected exactly 1 row with org B context, got {len(rows)}"

    def test_cross_org_insert_blocked(self, app_engine, rls_setup):
        """
        WITH CHECK policy blocks inserting data for a different org than
        the current context.
        """
        org_a_id = rls_setup["org_a_id"]
        org_b_id = rls_setup["org_b_id"]

        with app_engine.connect() as conn:
            # Set context to org A
            conn.execute(text(f"SET LOCAL app.current_org_id = '{org_a_id}'"))

            # Try to insert a row belonging to org B → should fail
            with pytest.raises(Exception) as exc_info:
                conn.execute(
                    text("""
                        INSERT INTO rls_test.datasets (organization_id, name)
                        VALUES (:org_id, :name)
                    """),
                    {"org_id": str(org_b_id), "name": "Cross-org attempt"},
                )

            error_msg = str(exc_info.value).lower()
            assert "policy" in error_msg or "permission" in error_msg or "security" in error_msg, (
                f"Expected RLS policy violation, got: {exc_info.value}"
            )

    def test_no_context_insert_blocked(self, app_engine, rls_setup):
        """
        WITH CHECK policy blocks inserts when no org context is set.
        """
        org_a_id = rls_setup["org_a_id"]

        with app_engine.connect() as conn:
            conn.execute(text("RESET app.current_org_id"))

            with pytest.raises(Exception) as exc_info:
                conn.execute(
                    text("""
                        INSERT INTO rls_test.datasets (organization_id, name)
                        VALUES (:org_id, :name)
                    """),
                    {"org_id": str(org_a_id), "name": "No-context insert attempt"},
                )

            error_msg = str(exc_info.value).lower()
            assert "policy" in error_msg or "permission" in error_msg or "security" in error_msg, (
                f"Expected RLS policy violation, got: {exc_info.value}"
            )

    def test_same_org_insert_succeeds(self, app_engine, rls_setup):
        """
        Inserting data for the SAME org as current context should succeed.
        """
        org_a_id = rls_setup["org_a_id"]
        new_id = uuid4()

        with app_engine.connect() as conn:
            conn.execute(text(f"SET LOCAL app.current_org_id = '{org_a_id}'"))

            # This should succeed — same org as context
            conn.execute(
                text("""
                    INSERT INTO rls_test.datasets (dataset_id, organization_id, name)
                    VALUES (:id, :org_id, :name)
                """),
                {"id": str(new_id), "org_id": str(org_a_id), "name": "Same-org insert"},
            )

            # Verify the row is visible
            result = conn.execute(
                text("SELECT name FROM rls_test.datasets WHERE dataset_id = :id"),
                {"id": str(new_id)},
            ).fetchone()
            assert result is not None, "Same-org insert should be visible"
            assert result[0] == "Same-org insert"

            # Don't commit — let the connection close to auto-rollback
            # so we don't pollute other tests
