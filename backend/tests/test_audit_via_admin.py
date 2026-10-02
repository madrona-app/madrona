"""
Tests for write_audit_via_admin (audit_service.py).

This helper exists to keep failure-path and pre-org-context audit
writes from being silently lost under strict RLS. It opens a
short-lived BYPASSRLS owner session, writes the row, commits.

Contracts to lock down:
  1. A row written via the helper LANDS in the DB.
  2. The row lands even when the calling context has no current_org_id
     set (the production failure mode for login-failure audits).
  3. The helper never raises — failure is logged and returns False.
"""
from __future__ import annotations

from contextlib import contextmanager
from unittest.mock import patch
from uuid import uuid4

import pytest
from sqlalchemy import text

from app.models import AuditLog
from app.services.audit_service import (
    log_login_failure,
    log_mfa_enrollment_started,
    write_audit_via_admin,
)


def test_write_audit_via_admin_persists_a_login_failure_row(db_session, monkeypatch):
    """Smoke test: helper round-trips a no-org audit row to the DB."""
    unique_email = f"audit-via-admin-{uuid4().hex[:8]}@madrona.test"

    # Route the helper's "owner connection" through THIS test's session.
    # Otherwise admin_db_session() opens a fresh engine on ALEMBIC_DATABASE_URL
    # (the owner role → the *dev* `madrona` DB per backend/.env, injected into
    # os.environ by celery_app's load_dotenv) and commits there: the write
    # escapes the test transaction (invisible here, and leaks a row into the
    # dev DB). Binding it to db_session keeps the write visible and rolled back.
    @contextmanager
    def _admin_db_session_on_test_conn():
        yield db_session

    monkeypatch.setattr(
        "app.tasks.rls_helpers.admin_db_session",
        _admin_db_session_on_test_conn,
    )

    ok = write_audit_via_admin(
        log_login_failure,
        email=unique_email,
        reason="invalid_credentials",
        ip_address="127.0.0.1",
    )
    assert ok is True

    # Read back via the regular session — RLS bypass on the write means
    # the row's organization_id is NULL, which the strict policy also
    # rejects on SELECT. Drop into a transaction where current_org_id
    # is empty (matches the production read path for system events).
    db_session.execute(text("SELECT set_config('app.current_org_id', '', true)"))
    rows = (
        db_session.query(AuditLog)
        .filter(AuditLog.action == "auth.login_failure")
        .all()
    )
    matching = [r for r in rows if (r.details or {}).get("email") == unique_email]
    assert matching, (
        f"audit row for {unique_email} not found — helper wrote None or "
        "the row's organization_id is being filtered by RLS"
    )


def test_write_audit_via_admin_succeeds_when_caller_has_no_org_context(
    rls_db_session,
):
    """The whole point of the helper: caller is under strict RLS with
    no current_org_id, and the audit row still lands. Repros the May
    2026 production failure mode (login_failure audit lost) plus
    confirms the BYPASSRLS path is the fix."""
    unique_email = f"audit-no-org-{uuid4().hex[:8]}@madrona.test"

    # rls_db_session is connected as madrona_app with NO current_org_id.
    # Calling write_audit_via_admin from here must still persist the row.
    ok = write_audit_via_admin(
        log_login_failure,
        email=unique_email,
        reason="rate_limited",
        ip_address="127.0.0.1",
    )
    assert ok is True


def test_write_audit_via_admin_returns_false_on_failure(monkeypatch):
    """The helper must NEVER raise — failure is logged + returns False.
    A flaky admin connection should not break the caller's response
    (the caller still has to return its 401/429 etc.)."""
    def boom(*args, **kwargs):
        raise RuntimeError("simulated admin DB outage")

    monkeypatch.setattr(
        "app.tasks.rls_helpers.admin_db_session", boom
    )

    ok = write_audit_via_admin(
        log_login_failure,
        email="anything@example.com",
        reason="invalid_credentials",
        ip_address="127.0.0.1",
    )
    assert ok is False


def test_write_audit_via_admin_reports_to_sentry_on_failure(monkeypatch):
    """A failed audit write is silent at the API layer (the caller's
    401/429 still flies) but a *sustained* rate means the audit trail
    is going dark. Verify the helper at least asks Sentry to notice."""
    def boom(*args, **kwargs):
        raise RuntimeError("simulated admin DB outage")

    monkeypatch.setattr(
        "app.tasks.rls_helpers.admin_db_session", boom
    )

    captured = []

    def fake_capture_exception(exc):
        captured.append(exc)

    # sentry_sdk is imported lazily inside the helper's except branch
    # so we have to monkeypatch the module's attribute.
    import sentry_sdk
    monkeypatch.setattr(sentry_sdk, "capture_exception", fake_capture_exception)
    monkeypatch.setattr(sentry_sdk, "set_tag", lambda *a, **kw: None)

    ok = write_audit_via_admin(
        log_login_failure,
        email="anything@example.com",
        reason="rate_limited",
        ip_address="127.0.0.1",
    )
    assert ok is False
    assert len(captured) == 1, (
        f"expected one Sentry capture, got {len(captured)} — the "
        "helper's exception-handler isn't reporting upstream"
    )
    assert "simulated admin DB outage" in str(captured[0])


def test_sentry_outage_does_not_break_the_helper(monkeypatch):
    """Sentry being broken must NEVER break the audit helper — if
    Sentry's HTTP client throws inside `capture_exception`, the
    audit caller still gets its `False` return and life goes on."""
    def boom_admin(*args, **kwargs):
        raise RuntimeError("admin DB outage")

    def boom_sentry(exc):
        raise RuntimeError("Sentry HTTP layer down")

    monkeypatch.setattr(
        "app.tasks.rls_helpers.admin_db_session", boom_admin
    )
    import sentry_sdk
    monkeypatch.setattr(sentry_sdk, "capture_exception", boom_sentry)
    monkeypatch.setattr(sentry_sdk, "set_tag", lambda *a, **kw: None)

    # Must not raise even when both the admin DB and Sentry are
    # exploding.
    ok = write_audit_via_admin(
        log_login_failure,
        email="x@example.com",
        reason="rate_limited",
        ip_address="127.0.0.1",
    )
    assert ok is False


def test_write_audit_via_admin_works_for_mfa_enrollment_too(rls_db_session):
    """The helper should work for any audit-log function — not just
    log_login_failure. Confirms the signature is generic.

    Pass organization_id=None / target_user_id=None to dodge FK
    constraints — the helper's contract is about RLS, not FK validity.
    """
    ok = write_audit_via_admin(
        log_mfa_enrollment_started,
        organization_id=None,
        target_user_id=None,
        email=f"enroll-{uuid4().hex[:6]}@madrona.test",
        ip_address="127.0.0.1",
        mfa_type="totp",
    )
    assert ok is True
