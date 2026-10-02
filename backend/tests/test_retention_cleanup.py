"""
Tests for retention cleanup of provisioning jobs and audit logs.

Uses SQLite in-memory database to verify cleanup logic without touching real data.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from app.models import OrgProvisioningJob, ProvisioningAuditLog, EmailEvent


@pytest.fixture
def session(db_session):
    """The shared Postgres session from conftest.

    This module used to build its own in-memory SQLite engine and create a
    hand-listed subset of tables. SQLite has no schemas and cannot compile
    JSONB, so such a fixture only ever holds a flattened approximation of the
    schema — the reason conftest dropped its own SQLite engine. db_session
    runs each test in a savepoint on madrona_test and rolls back on teardown,
    so the manual delete pass this fixture used to do is unnecessary.
    """
    return db_session


def _make_job(session, created_at, status="completed"):
    job = OrgProvisioningJob(
        job_id=uuid.uuid4(),
        idempotency_key=uuid.uuid4().hex,
        status=status,
        request_payload={},
        steps={},
        event_log=[],
        created_at=created_at,
    )
    session.add(job)
    session.flush()
    return job


def _make_audit_log(session, created_at):
    log = ProvisioningAuditLog(
        id=uuid.uuid4(),
        action="test_action",
        details={},
        created_at=created_at,
    )
    session.add(log)
    session.flush()
    return log


def _make_email_event(session, created_at):
    event = EmailEvent(
        event_id=uuid.uuid4(),
        email="test@example.com",
        event_type="bounce",
        raw_message={},
        created_at=created_at,
    )
    session.add(event)
    session.flush()
    return event


class TestRetentionCleanup:
    """Test the cleanup functions directly (not the CLI wrapper)."""

    def test_old_completed_jobs_deleted(self, session):
        """Completed jobs older than cutoff are removed."""
        from scripts.ops.cleanup_retention import cleanup_provisioning_jobs

        now = datetime.now(timezone.utc)
        old_job = _make_job(session, now - timedelta(days=200), status="completed")
        recent_job = _make_job(session, now - timedelta(days=10), status="completed")
        session.commit()

        cutoff = now - timedelta(days=180)
        count = cleanup_provisioning_jobs(session, cutoff, dry_run=False)
        session.commit()

        assert count == 1
        remaining = session.query(OrgProvisioningJob).all()
        assert len(remaining) == 1
        assert remaining[0].job_id == recent_job.job_id

    def test_old_failed_jobs_deleted(self, session):
        """Failed jobs older than cutoff are removed."""
        from scripts.ops.cleanup_retention import cleanup_provisioning_jobs

        now = datetime.now(timezone.utc)
        _make_job(session, now - timedelta(days=200), status="failed")
        _make_job(session, now - timedelta(days=200), status="running")  # running = kept
        session.commit()

        cutoff = now - timedelta(days=180)
        count = cleanup_provisioning_jobs(session, cutoff, dry_run=False)
        session.commit()

        assert count == 1  # only the failed one
        remaining = session.query(OrgProvisioningJob).all()
        assert len(remaining) == 1
        assert remaining[0].status == "running"

    def test_dry_run_does_not_delete(self, session):
        """Dry run counts but does not delete."""
        from scripts.ops.cleanup_retention import cleanup_provisioning_jobs

        now = datetime.now(timezone.utc)
        _make_job(session, now - timedelta(days=200), status="completed")
        session.commit()

        cutoff = now - timedelta(days=180)
        count = cleanup_provisioning_jobs(session, cutoff, dry_run=True)

        assert count == 1
        remaining = session.query(OrgProvisioningJob).all()
        assert len(remaining) == 1  # still there

    def test_old_audit_logs_deleted(self, session):
        """Audit logs older than cutoff are removed."""
        from scripts.ops.cleanup_retention import cleanup_audit_logs

        now = datetime.now(timezone.utc)
        _make_audit_log(session, now - timedelta(days=200))
        _make_audit_log(session, now - timedelta(days=10))
        session.commit()

        cutoff = now - timedelta(days=180)
        count = cleanup_audit_logs(session, cutoff, dry_run=False)
        session.commit()

        assert count == 1
        assert session.query(ProvisioningAuditLog).count() == 1

    def test_old_email_events_deleted(self, session):
        """Email events older than cutoff are removed."""
        from scripts.ops.cleanup_retention import cleanup_email_events

        now = datetime.now(timezone.utc)
        _make_email_event(session, now - timedelta(days=200))
        _make_email_event(session, now - timedelta(days=10))
        session.commit()

        cutoff = now - timedelta(days=180)
        count = cleanup_email_events(session, cutoff, dry_run=False)
        session.commit()

        assert count == 1
        assert session.query(EmailEvent).count() == 1

    def test_nothing_to_delete_when_all_recent(self, session):
        """No records deleted when everything is within retention window."""
        from scripts.ops.cleanup_retention import (
            cleanup_provisioning_jobs, cleanup_audit_logs, cleanup_email_events,
        )

        now = datetime.now(timezone.utc)
        _make_job(session, now - timedelta(days=10))
        _make_audit_log(session, now - timedelta(days=10))
        _make_email_event(session, now - timedelta(days=10))
        session.commit()

        cutoff = now - timedelta(days=180)
        assert cleanup_provisioning_jobs(session, cutoff, dry_run=False) == 0
        assert cleanup_audit_logs(session, cutoff, dry_run=False) == 0
        assert cleanup_email_events(session, cutoff, dry_run=False) == 0
