"""
Regression test for the RLS-context-after-commit bug class (ref 58549a39).

RLS context is applied with SET LOCAL (set_config is_local=true), which
PostgreSQL clears on COMMIT. Before the systemic fix, any query issued after a
mid-request commit ran with no org context, so the org-isolation policy hid the
caller's own rows (symptom: "not found" / empty results). The after_begin
listener (app.services.rls.register_rls_session_hooks) re-applies the stashed
context on every new transaction, so context survives commits.
"""

import os
from uuid import uuid4

import pytest
from sqlalchemy import text

from app.database import _current_session
from app.services.rls import register_rls_session_hooks, set_rls_context_for_session

pytestmark = pytest.mark.skipif(
    not os.environ.get("TEST_DATABASE_URL"),
    reason="RLS context tests require PostgreSQL (TEST_DATABASE_URL not set)",
)


@pytest.fixture
def pg_session(db_session):
    """Bind the session ContextVar and ensure the after_begin hook is live."""
    register_rls_session_hooks()  # idempotent
    token = _current_session.set(db_session)
    try:
        yield db_session
    finally:
        _current_session.reset(token)


def test_org_context_survives_commit(pg_session):
    """current_org_id() must persist across a commit (the core of the fix)."""
    session = pg_session
    org_id = uuid4()

    set_rls_context_for_session(session, str(org_id), None)
    assert session.execute(text("SELECT current_org_id()")).scalar() == org_id

    # Commit clears SET LOCAL; the next statement begins a new transaction and
    # the after_begin hook must re-apply the stashed context.
    session.commit()
    assert session.execute(text("SELECT current_org_id()")).scalar() == org_id, (
        "RLS org context was lost after commit — after_begin re-apply hook "
        "is not restoring it"
    )

    # And again after a second commit, to confirm it is self-perpetuating.
    session.commit()
    assert session.execute(text("SELECT current_org_id()")).scalar() == org_id


def test_user_context_survives_commit(pg_session):
    """current_user_id() must persist across a commit too (e.g. /me bootstrap)."""
    session = pg_session
    user_id = uuid4()

    set_rls_context_for_session(session, None, str(user_id))
    assert session.execute(text("SELECT current_setting('app.current_user_id', true)")).scalar() == str(user_id)

    session.commit()
    assert session.execute(text("SELECT current_setting('app.current_user_id', true)")).scalar() == str(user_id), (
        "RLS user context was lost after commit"
    )


def test_cleared_context_stays_cleared_after_commit(pg_session):
    """Clearing context (org=None, user=None) must not re-apply stale values."""
    session = pg_session
    org_id = uuid4()

    set_rls_context_for_session(session, str(org_id), None)
    assert session.execute(text("SELECT current_org_id()")).scalar() == org_id

    # Clear: the stash is dropped, so post-commit transactions have no context.
    set_rls_context_for_session(session, None, None)
    session.commit()
    assert session.execute(text("SELECT current_org_id()")).scalar() is None, (
        "Context should remain cleared after commit, not re-apply the old org"
    )
