"""
Tests for Row Level Security enforcement.

These tests verify that RLS policies correctly isolate data by organization.
Requires PostgreSQL - tests are skipped when using SQLite.
"""

import os
import pytest
from uuid import uuid4
from sqlalchemy import text

from app.database import current_session, _current_session
from app.models import Organization, Dataset
from app.asgi import create_app


# Skip all tests in this module if TEST_DATABASE_URL is not set
pytestmark = pytest.mark.skipif(
    not os.environ.get('TEST_DATABASE_URL'),
    reason="RLS tests require PostgreSQL (TEST_DATABASE_URL not set)"
)


@pytest.fixture
def pg_session(rls_db_session):
    """Bind the session ContextVar the routers & RLS helpers read so the
    tests can call `current_session()` outside a FastAPI request.

    Deliberately `rls_db_session`, not `db_session`. The default session
    connects as the Postgres superuser, which bypasses RLS by design — so
    this test, the one whose name promises tenant isolation is enforced,
    detected that and skipped itself on every run including CI. It proved
    nothing for as long as it has existed. `rls_db_session` applies
    SET ROLE madrona_app (NOBYPASSRLS), which is what production uses.
    """
    token = _current_session.set(rls_db_session)
    try:
        yield rls_db_session
    finally:
        _current_session.reset(token)


class TestRLSEnforcement:
    """Test that RLS correctly isolates data between organizations."""

    def test_rls_isolation(self, pg_session):
        """
        Test that RLS correctly isolates data between organizations.

        This test creates two orgs and datasets, then verifies:
        1. With no context: BYPASSRLS role sees all rows, non-bypass sees 0
        2. With org A context, only org A dataset is visible
        3. With org B context, only org B dataset is visible
        4. Cross-org insert is blocked

        Note: Superusers bypass RLS by PostgreSQL design, so this test
        is skipped when running as a superuser role.
        """
        # Check if running as superuser or BYPASSRLS role - they bypass RLS
        result = current_session().execute(
            text("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user")
        )
        row = list(result)[0]
        is_superuser, has_bypassrls = row[0], row[1]
        # A failure, not a skip. This test skipping is precisely how the gap
        # stayed invisible: a skipped test is green, and nothing distinguishes
        # "isolation verified" from "isolation never checked" in a run summary.
        if is_superuser or has_bypassrls:
            pytest.fail(
                "RLS test is running as a role that bypasses RLS "
                f"(rolsuper={is_superuser}, rolbypassrls={has_bypassrls}). "
                "It would pass without proving anything. The pg_session "
                "fixture must resolve to rls_db_session, which applies "
                "SET ROLE madrona_app."
            )

        # Seed the fixture rows as the OWNER, then assert as the app role.
        #
        # rls_db_session applies SET ROLE madrona_app to the connection, and
        # that role is correctly refused an INSERT into `organizations` when no
        # org context is set — the policy's WITH CHECK is doing its job. So the
        # setup has to run with the role reset; only the assertions below need
        # to run under it. Every statement is inside the fixture's savepoint
        # and rolls back at teardown.
        current_session().execute(text("RESET ROLE"))

        # Create test data using raw SQL to avoid ORM caching issues
        org_a_id = uuid4()
        org_b_id = uuid4()
        dataset_a_id = uuid4()
        dataset_b_id = uuid4()

        try:
            # Reset any previous context using RESET (session-level clear)
            current_session().execute(text("RESET app.current_org_id"))

            # Create two organizations
            current_session().execute(
                text("""
                    INSERT INTO organizations (organization_id, name, slug, is_demo, status, created_at, updated_at)
                    VALUES (:id, :name, :slug, false, 'active', NOW(), NOW())
                """),
                {"id": org_a_id, "name": "RLS Org A", "slug": f"rls-org-a-{uuid4().hex[:8]}"}
            )
            current_session().execute(
                text("""
                    INSERT INTO organizations (organization_id, name, slug, is_demo, status, created_at, updated_at)
                    VALUES (:id, :name, :slug, false, 'active', NOW(), NOW())
                """),
                {"id": org_b_id, "name": "RLS Org B", "slug": f"rls-org-b-{uuid4().hex[:8]}"}
            )
            current_session().commit()

            # Reset context again after commit
            current_session().execute(text("RESET app.current_org_id"))

            # Create datasets (no RLS context — works because role has BYPASSRLS)
            current_session().execute(
                text("""
                    INSERT INTO flow.datasets (dataset_id, organization_id, name, key, source_type, created_at, updated_at)
                    VALUES (:id, :org_id, :name, :key, :source_type, NOW(), NOW())
                """),
                {"id": dataset_a_id, "org_id": org_a_id, "name": "Dataset A", "key": "rls_ds_a", "source_type": "rls_test_a"}
            )
            current_session().execute(
                text("""
                    INSERT INTO flow.datasets (dataset_id, organization_id, name, key, source_type, created_at, updated_at)
                    VALUES (:id, :org_id, :name, :key, :source_type, NOW(), NOW())
                """),
                {"id": dataset_b_id, "org_id": org_b_id, "name": "Dataset B", "key": "rls_ds_b", "source_type": "rls_test_b"}
            )
            current_session().commit()

            # Seeding is done. Back to the unprivileged role — everything from
            # here is the actual subject of the test.
            current_session().execute(text("SET ROLE madrona_app"))

            # TEST 1: With no context, strict policies return 0 rows
            # (BYPASSRLS roles still see all rows — that's expected)
            current_session().execute(text("RESET app.current_org_id"))
            result = current_session().execute(
                text("SELECT dataset_id FROM flow.datasets WHERE dataset_id IN (:a, :b)"),
                {"a": dataset_a_id, "b": dataset_b_id}
            )
            visible_ids = [str(row[0]) for row in result]
            if has_bypassrls:
                # Owner/BYPASSRLS role bypasses RLS regardless of policies
                assert str(dataset_a_id) in visible_ids, "BYPASSRLS: Dataset A should be visible"
                assert str(dataset_b_id) in visible_ids, "BYPASSRLS: Dataset B should be visible"
            else:
                # Strict RLS: no context = no rows
                assert len(visible_ids) == 0, (
                    f"Strict RLS: expected 0 rows with no context, got {len(visible_ids)}"
                )

            # TEST 2: With org A context, only see dataset A
            # Note: SET doesn't support parameters, using string formatting (UUID is safe)
            current_session().execute(text(f"SET app.current_org_id = '{org_a_id}'"))
            result = current_session().execute(
                text("SELECT dataset_id FROM flow.datasets WHERE dataset_id IN (:a, :b)"),
                {"a": dataset_a_id, "b": dataset_b_id}
            )
            visible_ids = [str(row[0]) for row in result]
            assert str(dataset_a_id) in visible_ids, "Dataset A should be visible with org A context"
            assert str(dataset_b_id) not in visible_ids, "Dataset B should NOT be visible with org A context"

            # TEST 3: With org B context, only see dataset B
            current_session().execute(text(f"SET app.current_org_id = '{org_b_id}'"))
            result = current_session().execute(
                text("SELECT dataset_id FROM flow.datasets WHERE dataset_id IN (:a, :b)"),
                {"a": dataset_a_id, "b": dataset_b_id}
            )
            visible_ids = [str(row[0]) for row in result]
            assert str(dataset_b_id) in visible_ids, "Dataset B should be visible with org B context"
            assert str(dataset_a_id) not in visible_ids, "Dataset A should NOT be visible with org B context"

            # TEST 4: Cross-org insert should fail
            current_session().execute(text(f"SET app.current_org_id = '{org_a_id}'"))
            cross_org_insert_failed = False
            try:
                current_session().execute(
                    text("""
                        INSERT INTO flow.datasets (dataset_id, organization_id, name, key, source_type, created_at, updated_at)
                        VALUES (:id, :org_id, :name, :key, :source_type, NOW(), NOW())
                    """),
                    {"id": uuid4(), "org_id": org_b_id, "name": "Cross Org", "key": "rls_cross", "source_type": "rls_cross"}
                )
                current_session().commit()  # This should fail
            except Exception as e:
                cross_org_insert_failed = True
                error_str = str(e).lower()
                assert "policy" in error_str or "security" in error_str, f"Expected RLS error, got: {e}"
                current_session().rollback()

            assert cross_org_insert_failed, "Cross-org insert should have failed"

        finally:
            # Cleanup
            current_session().execute(text("RESET app.current_org_id"))
            current_session().rollback()
            current_session().execute(
                text("DELETE FROM flow.datasets WHERE dataset_id IN (:a, :b)"),
                {"a": dataset_a_id, "b": dataset_b_id}
            )
            current_session().execute(
                text("DELETE FROM organizations WHERE organization_id IN (:a, :b)"),
                {"a": org_a_id, "b": org_b_id}
            )
            current_session().commit()
