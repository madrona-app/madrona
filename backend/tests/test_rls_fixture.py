"""
Smoke tests for the rls_db_session / rls_client fixtures.

Exists to prove the fixture actually enforces RLS — the whole point is
to catch RLS-bootstrap bugs that the superuser-default fixture misses.
If something here breaks, the strict-RLS test surface in this repo
silently regresses to "no enforcement," which is exactly the gap that
let three production 500s slip through in May 2026.
"""
from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import text


def test_rls_fixture_runs_as_madrona_app(rls_db_session):
    """`SET ROLE madrona_app` should be visible inside the test."""
    current_user = rls_db_session.execute(text("SELECT current_user")).scalar()
    assert current_user == "madrona_app", (
        f"expected current_user='madrona_app', got {current_user!r}. "
        "The rls_db_session fixture should switch role for the test "
        "session; if not, RLS won't enforce and the fixture is useless."
    )


def test_rls_fixture_actually_enforces_org_isolation(rls_db_session):
    """An INSERT into an org-scoped table without current_org_id set
    must be rejected by RLS. This is the contract that catches every
    audit-log-RLS-bootstrap regression — including the May 2026 bug
    in login_mfa that bypassed the existing test suite entirely.

    If this test ever passes silently with the INSERT succeeding, the
    fixture has regressed and the strict-RLS coverage is gone.
    """
    from app.models import AuditLog

    # No current_org_id set on the session → INSERT with a real
    # organization_id should violate audit_logs_org_isolation
    # (organization_id = current_org_id())
    audit = AuditLog(
        organization_id=uuid4(),  # arbitrary; current_org_id is NULL
        acting_user_id=uuid4(),
        target_user_id=uuid4(),
        action="rls_fixture_smoke_test",
        details={"note": "should be rejected by RLS"},
    )
    rls_db_session.add(audit)
    with pytest.raises(Exception) as exc_info:
        rls_db_session.flush()
    msg = str(exc_info.value).lower()
    assert "row-level security" in msg or "row level security" in msg, (
        f"expected RLS rejection, got: {exc_info.value!r}"
    )


def test_rls_fixture_allows_insert_when_org_context_matches(rls_db_session):
    """With current_org_id set to the row's organization_id, the
    INSERT must succeed. Complements the rejection test above so we
    know enforcement is contextual, not blanket-denied."""
    from app.models import AuditLog, Organization, User

    # Set context first so the Organization INSERT itself satisfies
    # `organizations_org_isolation` WITH CHECK.
    org_id = uuid4()
    rls_db_session.execute(
        text("SELECT set_config('app.current_org_id', :v, true)"),
        {"v": str(org_id)},
    )

    org = Organization(
        organization_id=org_id,
        name="RLS Fixture Smoke Org",
        slug=f"rls-smoke-{uuid4().hex[:8]}",
        status="active",
    )
    rls_db_session.add(org)
    user = User(email=f"rls-smoke-{uuid4().hex[:6]}@example.com", status="active")
    rls_db_session.add(user)
    rls_db_session.flush()

    audit = AuditLog(
        organization_id=org_id,
        acting_user_id=user.user_id,
        target_user_id=user.user_id,
        action="rls_fixture_smoke_test_positive",
        details={"note": "should succeed under matching context"},
    )
    rls_db_session.add(audit)
    rls_db_session.flush()  # must not raise

    # Round-trip read back
    row = rls_db_session.execute(
        text("SELECT count(*) FROM audit_logs WHERE action = :a"),
        {"a": "rls_fixture_smoke_test_positive"},
    ).scalar()
    assert row == 1


def test_regular_db_session_still_bypasses_rls(db_session):
    """Make sure the plain ``db_session`` fixture is still the
    superuser path — useful as a regression guard so a future change
    can't accidentally lock down every test by switching the default."""
    current_user = db_session.execute(text("SELECT current_user")).scalar()
    # Local dev uses 'madrona' superuser; CI may differ but it has to
    # be BYPASSRLS-capable to keep the rest of the suite green.
    is_superuser = db_session.execute(
        text("SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user")
    ).scalar()
    assert is_superuser, (
        f"db_session connected as {current_user!r}, which doesn't bypass "
        "RLS — the rest of the test suite (designed for non-strict RLS) "
        "would break. If you intended to lock everything down to RLS, "
        "do it incrementally per-test, not globally."
    )
