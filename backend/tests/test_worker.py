"""
Tests for worker service functions.

Tests claim_job, execute_job, and worker_tick.
Uses conftest db_session fixture with mocked Redis and pipeline execution.

Note: claim_job uses current_session() (the FastAPI/standalone session
accessor) and with_for_update(skip_locked=True), which is incompatible
with SQLite. Therefore TestClaimJob tests mock current_session() to avoid
SQLite limitations.
"""

import pytest
from datetime import datetime, timezone
from unittest.mock import patch, MagicMock, PropertyMock
from uuid import uuid4

from app.models import (
    Organization,
    Job,
)


class TestClaimJob:
    """Tests for atomic job claiming.

    claim_job() uses app.database.current_session() (the FastAPI/standalone
    session accessor). It uses with_for_update(skip_locked=True) which isn't
    supported in SQLite, so these tests mock the database query chain by
    patching current_session in the worker module.
    """

    @patch("app.services.worker.emit_job_status")
    @patch("app.services.worker._acquire_pipeline_lock", return_value=True)
    @patch("app.services.worker.current_session")
    def test_claim_queued_job(self, mock_current_session, mock_lock, mock_emit):
        """Claiming a queued job sets it to running."""
        from app.services.worker import claim_job

        # Create a mock job
        mock_job = MagicMock(spec=Job)
        mock_job.job_id = uuid4()
        mock_job.pipeline_id = uuid4()
        mock_job.status = "queued"
        mock_job.attempt = 0

        # Set up the query chain: current_session().query().filter().order_by().with_for_update().first()
        mock_session = MagicMock()
        mock_current_session.return_value = mock_session
        mock_query = MagicMock()
        mock_session.query.return_value = mock_query
        mock_query.filter.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.with_for_update.return_value = mock_query
        mock_query.first.return_value = mock_job

        claimed = claim_job()

        assert claimed is not None
        assert claimed.job_id == mock_job.job_id
        assert claimed.status == "running"
        assert claimed.started_at is not None
        assert claimed.attempt == 1

    @patch("app.services.worker.emit_job_status")
    @patch("app.services.worker._acquire_pipeline_lock", return_value=True)
    @patch("app.services.worker.current_session")
    def test_no_queued_jobs_returns_none(self, mock_current_session, mock_lock, mock_emit):
        """Returns None when no queued jobs exist."""
        from app.services.worker import claim_job

        # Set up the query chain to return None (no jobs)
        mock_session = MagicMock()
        mock_current_session.return_value = mock_session
        mock_query = MagicMock()
        mock_session.query.return_value = mock_query
        mock_query.filter.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.with_for_update.return_value = mock_query
        mock_query.first.return_value = None

        claimed = claim_job()
        assert claimed is None

    @patch("app.services.worker.emit_job_status")
    @patch("app.services.worker._acquire_pipeline_lock", return_value=False)
    @patch("app.services.worker.current_session")
    def test_pipeline_lock_prevents_claim(self, mock_current_session, mock_lock, mock_emit):
        """Job is not claimed if pipeline is locked by another worker."""
        from app.services.worker import claim_job

        # Create a mock job that would be claimable
        mock_job = MagicMock(spec=Job)
        mock_job.job_id = uuid4()
        mock_job.pipeline_id = uuid4()
        mock_job.status = "queued"

        # Set up the query chain
        mock_session = MagicMock()
        mock_current_session.return_value = mock_session
        mock_query = MagicMock()
        mock_session.query.return_value = mock_query
        mock_query.filter.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.with_for_update.return_value = mock_query
        mock_query.first.return_value = mock_job

        claimed = claim_job()
        assert claimed is None

    @patch("app.services.worker.emit_job_status")
    @patch("app.services.worker._acquire_pipeline_lock", return_value=True)
    @patch("app.services.worker.current_session")
    def test_claim_increments_attempt(self, mock_current_session, mock_lock, mock_emit):
        """Claiming a job increments its attempt counter."""
        from app.services.worker import claim_job

        mock_job = MagicMock(spec=Job)
        mock_job.job_id = uuid4()
        mock_job.pipeline_id = uuid4()
        mock_job.status = "queued"
        mock_job.attempt = 2  # Already attempted twice

        mock_session = MagicMock()
        mock_current_session.return_value = mock_session
        mock_query = MagicMock()
        mock_session.query.return_value = mock_query
        mock_query.filter.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.with_for_update.return_value = mock_query
        mock_query.first.return_value = mock_job

        claimed = claim_job()

        assert claimed is not None
        assert claimed.attempt == 3


class TestWorkerTick:
    """Tests for the worker_tick function."""

    @patch("app.services.worker._release_pipeline_lock")
    @patch("app.services.worker.claim_job", return_value=None)
    def test_tick_no_jobs(self, mock_claim, mock_release):
        """Worker tick does nothing when no jobs are available."""
        from app.services.worker import worker_tick

        worker_tick()

        mock_claim.assert_called_once()
        # No job means no lock release needed
        mock_release.assert_not_called()

    @patch("app.services.worker._release_pipeline_lock")
    @patch("app.services.worker.execute_job", return_value=True)
    @patch("app.services.worker.claim_job")
    def test_tick_with_job(self, mock_claim, mock_execute, mock_release):
        """Worker tick claims and executes a job."""
        from app.services.worker import worker_tick

        mock_job = MagicMock()
        mock_job.pipeline_id = uuid4()
        mock_claim.return_value = mock_job

        worker_tick()

        mock_claim.assert_called_once()
        mock_execute.assert_called_once_with(mock_job)
        mock_release.assert_called_once_with(mock_job.pipeline_id)


class TestWorkerService:
    """Tests for WorkerService class."""

    def test_start_stop(self):
        """Worker service can start and stop cleanly."""
        from app.services.worker import WorkerService

        service = WorkerService(poll_interval_seconds=1)
        service.start()
        assert service._running is True

        service.stop()
        assert service._running is False

    def test_start_twice_is_idempotent(self):
        """Starting an already running worker is a no-op."""
        from app.services.worker import WorkerService

        service = WorkerService(poll_interval_seconds=1)
        service.start()
        service.start()  # Should not error
        assert service._running is True

        service.stop()


class TestJobModel:
    """Tests for Job model using db_session fixture."""

    def test_create_job(self, db_session):
        """Create a job record in the database."""
        org = Organization(
            name="Job Test Org",
            slug="job-test-org",
            is_demo=False,
            status="active",
        )
        db_session.add(org)
        db_session.flush()

        job = Job(
            organization_id=org.organization_id,
            scheduled_for=datetime.now(timezone.utc),
            status="queued",
            job_type="test_job",
            priority=100,
            payload={"test": True},
            attempt=0,
            max_attempts=3,
        )
        db_session.add(job)
        db_session.commit()

        assert job.job_id is not None
        assert job.status == "queued"
        assert job.attempt == 0
        assert job.payload["test"] is True

    def test_job_status_transitions(self, db_session):
        """Job status can be updated."""
        org = Organization(
            name="Status Test Org",
            slug="status-test-org",
            is_demo=False,
            status="active",
        )
        db_session.add(org)
        db_session.flush()

        job = Job(
            organization_id=org.organization_id,
            status="queued",
            job_type="test_transition",
            priority=100,
            payload={},
            attempt=0,
            max_attempts=3,
        )
        db_session.add(job)
        db_session.commit()

        # Transition to running
        job.status = "running"
        job.started_at = datetime.now(timezone.utc)
        job.attempt = 1
        db_session.commit()

        found = db_session.query(Job).filter_by(job_id=job.job_id).first()
        assert found.status == "running"
        assert found.started_at is not None
        assert found.attempt == 1

    def test_job_error_field(self, db_session):
        """Job can store error information."""
        org = Organization(
            name="Error Test Org",
            slug="error-test-org",
            is_demo=False,
            status="active",
        )
        db_session.add(org)
        db_session.flush()

        job = Job(
            organization_id=org.organization_id,
            status="failed",
            job_type="test_error",
            priority=100,
            payload={},
            attempt=3,
            max_attempts=3,
            error="Connection timeout after 30s",
        )
        db_session.add(job)
        db_session.commit()

        found = db_session.query(Job).filter_by(job_id=job.job_id).first()
        assert found.error == "Connection timeout after 30s"
        assert found.status == "failed"


class TestClaimJobReportsTheRealDatabaseError:
    """
    claim_job's `except SQLAlchemyError` rolls back and then reads `job` to
    release the pipeline lock. `job` is assigned by the query inside the try,
    so when that query is what failed, the handler raised UnboundLocalError on
    top of the original error and the real cause never reached the log.

    This is not hypothetical. The pipeline worker starts as soon as Postgres is
    healthy, which on a cold boot is before the backend has run migrations, so
    its first poll hit `relation "flow.jobs" does not exist`. What the operator
    saw was:

        Worker tick failed: cannot access local variable 'job'

    with no mention of the missing table.
    """

    def test_a_failing_query_returns_none_and_surfaces_the_cause(self, caplog):
        from sqlalchemy.exc import SQLAlchemyError

        from app.services.worker import claim_job

        boom = SQLAlchemyError('relation "flow.jobs" does not exist')
        session = MagicMock()
        session.query.side_effect = boom

        with patch("app.services.worker.current_session", return_value=session):
            with caplog.at_level("ERROR"):
                # The bug made this raise UnboundLocalError instead of returning.
                result = claim_job()

        assert result is None
        assert "flow.jobs" in caplog.text, (
            "the original database error must reach the log; it was being "
            f"replaced by UnboundLocalError. Got: {caplog.text!r}"
        )
        assert "local variable" not in caplog.text

