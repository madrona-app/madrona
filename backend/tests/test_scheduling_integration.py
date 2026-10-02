"""
Tests for scheduling integration (jobs/schedules -> runs).

Covers:
1. create_run_for_job creates Run with correct fields and metadata
2. create_run_for_job skips disabled pipelines
3. create_run_for_job includes incremental sync parameters
4. execute_job handles success and failure paths
5. claim_job atomically claims queued jobs
6. compute_next_run_time buckets correctly

Note: worker.py uses current_session() internally with JOINs that produce
schema-qualified SQL (flow.runs) which doesn't exist in SQLite.
Tests that call create_run_for_job directly must therefore mock the
incremental-sync query (the JOIN on RunSourceStep -> Run) to avoid
the schema error, while letting the rest of the function use the real
session.  claim_job uses with_for_update(skip_locked=True) which
SQLite also does not support, so those tests mock at the query level.
"""

import pytest
from uuid import uuid4
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock, patch, PropertyMock

from app.models import (
    Run,
    Pipeline,
    PipelineDestination,
    PipelineSource,
    ConnectorInstance,
    ConnectorDefinition,
    RunSourceStep,
    RunDestinationStep,
    Schedule,
    Job,
    Dataset,
    Organization,
)


@pytest.fixture
def scheduling_scenario(db_session):
    """
    Create a full scheduling scenario with org, pipeline, connectors,
    sources, destinations, dataset, and schedule.
    """
    # Create organization
    org = Organization(
        name="Scheduling Test Org",
        slug="sched-test-org",
        is_demo=False,
        status="active",
    )
    db_session.add(org)
    db_session.flush()
    org_id = org.organization_id

    # Create dataset
    dataset = Dataset(
        organization_id=org_id,
        name="Test Dataset",
        key="test_dataset_sched",
        source_type="test_source",
    )
    db_session.add(dataset)
    db_session.flush()

    # Create source connector
    source_def = ConnectorDefinition(
        key="sched_source_def",
        display_name="Schedule Test Source",
        direction="source",
        implementation_key="test.source:TestSource",
        capabilities={},
        config_schema={},
        is_enabled=True,
    )
    db_session.add(source_def)
    db_session.flush()

    source_instance = ConnectorInstance(
        organization_id=org_id,
        connector_definition_id=source_def.connector_definition_id,
        name="Sched Source Instance",
        status="active",
        config={"api_key": "test"},
    )
    db_session.add(source_instance)
    db_session.flush()

    # Create destination connector
    dest_def = ConnectorDefinition(
        key="sched_dest_def",
        display_name="Schedule Test Destination",
        direction="target",
        implementation_key="test.target:TestTarget",
        capabilities={},
        config_schema={},
        is_enabled=True,
    )
    db_session.add(dest_def)
    db_session.flush()

    dest_instance = ConnectorInstance(
        organization_id=org_id,
        connector_definition_id=dest_def.connector_definition_id,
        name="Sched Dest Instance",
        status="active",
        config={"spreadsheet_id": "test"},
    )
    db_session.add(dest_instance)
    db_session.flush()

    # Create pipeline
    pipeline = Pipeline(
        organization_id=org_id,
        dataset_id=dataset.dataset_id,
        status="active",
    )
    db_session.add(pipeline)
    db_session.flush()

    # Create pipeline source
    pipeline_source = PipelineSource(
        pipeline_id=pipeline.pipeline_id,
        connector_instance_id=source_instance.connector_instance_id,
        enabled=True,
        parameters={},
        ordering=0,
    )
    db_session.add(pipeline_source)

    # Create pipeline destination
    pipeline_dest = PipelineDestination(
        pipeline_id=pipeline.pipeline_id,
        connector_instance_id=dest_instance.connector_instance_id,
        enabled=True,
        parameters={},
        ordering=0,
    )
    db_session.add(pipeline_dest)
    db_session.flush()

    # Create schedule
    schedule = Schedule(
        organization_id=org_id,
        pipeline_id=pipeline.pipeline_id,
        enabled=True,
        type="interval",
        every_n=6,
        unit="hours",
        timezone="UTC",
    )
    db_session.add(schedule)
    db_session.commit()

    return {
        "schedule": schedule,
        "pipeline": pipeline,
        "source": pipeline_source,
        "destination": pipeline_dest,
        "dataset": dataset,
        "organization_id": org_id,
        "source_instance": source_instance,
        "dest_instance": dest_instance,
        "source_def": source_def,
    }


def _make_job(db_session, scenario, **overrides):
    """Helper to create a Job for a scenario with sensible defaults."""
    defaults = dict(
        organization_id=scenario["organization_id"],
        pipeline_id=scenario["pipeline"].pipeline_id,
        schedule_id=scenario["schedule"].schedule_id,
        scheduled_for=datetime.now(timezone.utc),
        status="queued",
        job_type="scheduled",
        priority=100,
        payload={"schedule_id": str(scenario["schedule"].schedule_id)},
        attempt=0,
        max_attempts=3,
    )
    defaults.update(overrides)
    job = Job(**defaults)
    db_session.add(job)
    db_session.commit()
    return job


# ---------------------------------------------------------------------------
# Helpers for mocking the incremental-sync JOIN query
# ---------------------------------------------------------------------------

def _patch_incremental_query(return_step=None):
    """
    Return a context-manager that patches the RunSourceStep JOIN query inside
    create_run_for_job so it returns *return_step* instead of executing the
    schema-qualified JOIN that fails on SQLite.

    The query chain in worker.py is:
        db.session.query(RunSourceStep)
            .join(Run, Run.run_id == RunSourceStep.run_id)
            .filter(...)
            .order_by(...)
            .first()

    We intercept `current_session().query(RunSourceStep)` and short-circuit the
    chain to return return_step.
    """
    from app.database import current_session

    session = current_session()

    # Save the original query method
    _original_query = session.query

    def _patched_query(*args, **kwargs):
        # Only intercept queries for RunSourceStep (the incremental sync query)
        if args and len(args) == 1 and args[0] is RunSourceStep:
            mock_chain = MagicMock()
            mock_chain.join.return_value = mock_chain
            mock_chain.filter.return_value = mock_chain
            mock_chain.order_by.return_value = mock_chain
            mock_chain.first.return_value = return_step
            return mock_chain
        return _original_query(*args, **kwargs)

    return patch.object(session, "query", side_effect=_patched_query)


class TestCreateRunForJob:
    """Tests for create_run_for_job function."""

    def test_creates_run_with_correct_attributes(self, db_session, scheduling_scenario):
        """Job creates run with correct triggered_by, dataset_id, and parameters."""
        scenario = scheduling_scenario
        pipeline = scenario["pipeline"]
        schedule = scenario["schedule"]

        job = _make_job(db_session, scenario)

        with _patch_incremental_query(return_step=None):
            from app.services.worker import create_run_for_job
            run = create_run_for_job(job)

        assert run is not None
        assert run.triggered_by == "scheduled"
        assert run.pipeline_id == pipeline.pipeline_id
        assert run.dataset_id == scenario["dataset"].dataset_id
        assert run.job_id == job.job_id
        assert run.status == "pending"
        assert "_metadata" in run.parameters
        assert run.parameters["_metadata"]["job_id"] == str(job.job_id)
        assert run.parameters["_metadata"]["schedule_id"] == str(schedule.schedule_id)

    def test_creates_steps_for_enabled_sources_and_destinations(
        self, db_session, scheduling_scenario
    ):
        """Run created by job has RunSourceStep and RunDestinationStep rows."""
        scenario = scheduling_scenario

        job = _make_job(db_session, scenario, payload={})

        with _patch_incremental_query(return_step=None):
            from app.services.worker import create_run_for_job
            run = create_run_for_job(job)

        assert run is not None

        source_steps = db_session.query(RunSourceStep).filter_by(run_id=run.run_id).all()
        assert len(source_steps) == 1
        assert source_steps[0].pipeline_source_id == scenario["source"].source_id
        assert source_steps[0].status == "pending"

        dest_steps = db_session.query(RunDestinationStep).filter_by(run_id=run.run_id).all()
        assert len(dest_steps) == 1
        assert dest_steps[0].pipeline_destination_id == scenario["destination"].destination_id
        assert dest_steps[0].status == "pending"

    def test_disabled_pipeline_returns_none(self, db_session, scheduling_scenario):
        """Job for disabled pipeline skips run creation."""
        scenario = scheduling_scenario
        pipeline = scenario["pipeline"]

        # Disable pipeline
        pipeline.status = "disabled"
        db_session.commit()

        job = _make_job(db_session, scenario, payload={})

        with _patch_incremental_query(return_step=None):
            from app.services.worker import create_run_for_job
            run = create_run_for_job(job)

        assert run is None

    def test_incremental_sync_from_last_successful_run(
        self, db_session, scheduling_scenario
    ):
        """Job includes incremental sync params from last successful source step."""
        scenario = scheduling_scenario
        source = scenario["source"]

        # Create a fake "last successful step" that the mocked query will return
        finished_time = datetime.now(timezone.utc) - timedelta(hours=5, minutes=55)
        fake_step = MagicMock()
        fake_step.finished_at = finished_time
        fake_step.pipeline_source_id = source.source_id

        job = _make_job(db_session, scenario, payload={})

        with _patch_incremental_query(return_step=fake_step):
            from app.services.worker import create_run_for_job
            run = create_run_for_job(job)

        assert run is not None

        # Verify incremental sync parameters
        incremental_key = f"source_{source.source_id}_last_sync"
        assert incremental_key in run.parameters
        assert run.parameters[incremental_key] == finished_time.isoformat()

    def test_no_incremental_sync_without_previous_run(
        self, db_session, scheduling_scenario
    ):
        """First run has no incremental sync parameters (full sync)."""
        scenario = scheduling_scenario

        job = _make_job(db_session, scenario, payload={})

        with _patch_incremental_query(return_step=None):
            from app.services.worker import create_run_for_job
            run = create_run_for_job(job)

        assert run is not None

        # Verify NO incremental sync parameters
        source_keys = [
            k for k in run.parameters.keys()
            if k.startswith("source_") and k.endswith("_last_sync")
        ]
        assert len(source_keys) == 0


class TestExecuteJob:
    """Tests for execute_job function."""

    def test_success_updates_job_status(self, db_session, scheduling_scenario):
        """Successful job execution sets status='succeeded'."""
        scenario = scheduling_scenario
        pipeline = scenario["pipeline"]

        job = _make_job(
            db_session, scenario,
            status="running",
            started_at=datetime.now(timezone.utc),
            attempt=1,
            payload={},
        )

        # Create a run that create_run_for_job will "return"
        run = Run(
            organization_id=scenario["organization_id"],
            pipeline_id=pipeline.pipeline_id,
            dataset_id=scenario["dataset"].dataset_id,
            status="success",
            triggered_by="scheduled",
            parameters={},
            job_id=job.job_id,
        )
        db_session.add(run)
        db_session.commit()

        from app.services.pipeline import RunResult

        with patch("app.services.worker.create_run_for_job", return_value=run), \
             patch("app.services.worker.execute_run") as mock_execute, \
             patch("app.services.worker.emit_job_status"):

            mock_execute.return_value = RunResult(
                run_id=run.run_id,
                status="success",
                duration_ms=1000,
                counts={"created": 5, "updated": 3, "noop": 0},
                target_url=None,
            )

            from app.services.worker import execute_job
            success = execute_job(job)

        assert success is True
        db_session.refresh(job)
        assert job.status == "succeeded"
        assert job.finished_at is not None
        assert job.run_id is not None
        assert job.error is None

    def test_failure_updates_job_with_error(self, db_session, scheduling_scenario):
        """Failed job execution sets status and error message."""
        scenario = scheduling_scenario
        pipeline = scenario["pipeline"]

        job = _make_job(
            db_session, scenario,
            status="running",
            started_at=datetime.now(timezone.utc),
            attempt=3,
            max_attempts=3,
            payload={},
        )

        # Create a run that create_run_for_job will "return"
        run = Run(
            organization_id=scenario["organization_id"],
            pipeline_id=pipeline.pipeline_id,
            status="failed",
            triggered_by="scheduled",
            parameters={},
            job_id=job.job_id,
            error="Source connector failed",
        )
        db_session.add(run)
        db_session.commit()

        from app.services.pipeline import PipelineError

        with patch("app.services.worker.create_run_for_job", return_value=run), \
             patch("app.services.worker.execute_run") as mock_execute, \
             patch("app.services.worker.emit_job_status"):

            mock_execute.side_effect = PipelineError("Source connector failed")

            from app.services.worker import execute_job
            success = execute_job(job)

        assert success is False
        db_session.refresh(job)
        assert job.status == "failed"
        assert job.finished_at is not None
        assert "Pipeline error" in job.error
        assert "Source connector failed" in job.error


class TestClaimJob:
    """Tests for claim_job function.

    claim_job uses with_for_update(skip_locked=True) which SQLite does not
    support, so we mock the query chain that finds the queued job while
    letting the status-update logic run against the real session.
    """

    def test_claim_queued_job(self, db_session, scheduling_scenario):
        """Claiming a job sets status=running, started_at, and increments attempt."""
        scenario = scheduling_scenario

        job = _make_job(
            db_session, scenario,
            scheduled_for=datetime.now(timezone.utc) - timedelta(minutes=1),
        )

        from app.database import current_session

        session = current_session()
        _original_query = session.query

        def _patched_query(*args, **kwargs):
            # Intercept the Job query with for_update chain
            if args and len(args) == 1 and args[0] is Job:
                mock_chain = MagicMock()
                mock_chain.filter.return_value = mock_chain
                mock_chain.order_by.return_value = mock_chain
                mock_chain.with_for_update.return_value = mock_chain
                mock_chain.first.return_value = job
                return mock_chain
            return _original_query(*args, **kwargs)

        with patch.object(session, "query", side_effect=_patched_query), \
             patch("app.services.worker._acquire_pipeline_lock", return_value=True), \
             patch("app.services.worker.emit_job_status"):
            from app.services.worker import claim_job
            claimed_job = claim_job()

        assert claimed_job is not None
        assert claimed_job.job_id == job.job_id
        assert claimed_job.status == "running"
        assert claimed_job.started_at is not None
        assert claimed_job.attempt == 1

    def test_claim_returns_none_when_no_jobs(self, db_session):
        """claim_job returns None when no queued jobs exist."""
        from app.database import current_session

        session = current_session()
        _original_query = session.query

        def _patched_query(*args, **kwargs):
            if args and len(args) == 1 and args[0] is Job:
                mock_chain = MagicMock()
                mock_chain.filter.return_value = mock_chain
                mock_chain.order_by.return_value = mock_chain
                mock_chain.with_for_update.return_value = mock_chain
                mock_chain.first.return_value = None
                return mock_chain
            return _original_query(*args, **kwargs)

        with patch.object(session, "query", side_effect=_patched_query):
            from app.services.worker import claim_job
            claimed_job = claim_job()

        assert claimed_job is None


class TestComputeNextRunTime:
    """Tests for compute_next_run_time utility."""

    def test_hourly_schedule_buckets_correctly(self, db_session, scheduling_scenario):
        """Hourly schedule rounds down to hour boundary."""
        schedule = scheduling_scenario["schedule"]
        # schedule is every 6 hours

        from app.services.scheduler import compute_next_run_time

        # 14:30 UTC should bucket to 12:00 UTC (6-hour boundary)
        current_time = datetime(2026, 1, 13, 14, 30, 0)
        next_run = compute_next_run_time(schedule, current_time)

        assert next_run.hour == 12
        assert next_run.minute == 0
        assert next_run.second == 0

    def test_minute_schedule_buckets_correctly(self, db_session, scheduling_scenario):
        """Minute-based schedule rounds down to N-minute boundary."""
        schedule = scheduling_scenario["schedule"]
        # Override to test minute-based scheduling
        schedule.unit = "minutes"
        schedule.every_n = 15
        db_session.commit()

        from app.services.scheduler import compute_next_run_time

        # 14:37 UTC -> should bucket to 14:30 (15-min boundary)
        current_time = datetime(2026, 1, 13, 14, 37, 0)
        next_run = compute_next_run_time(schedule, current_time)

        assert next_run.minute == 30
        assert next_run.second == 0

    def test_daily_schedule_buckets_to_midnight(self, db_session, scheduling_scenario):
        """Daily schedule rounds down to midnight in schedule timezone."""
        schedule = scheduling_scenario["schedule"]
        schedule.unit = "days"
        schedule.every_n = 1
        schedule.timezone = "UTC"
        db_session.commit()

        from app.services.scheduler import compute_next_run_time

        current_time = datetime(2026, 1, 13, 14, 30, 0)
        next_run = compute_next_run_time(schedule, current_time)

        assert next_run.hour == 0
        assert next_run.minute == 0
        assert next_run.second == 0


class TestEnqueueJob:
    """Tests for enqueue_job function."""

    def test_creates_job_record(self, db_session, scheduling_scenario, disabled_redis):
        """enqueue_job creates a Job with correct fields."""
        scenario = scheduling_scenario
        schedule = scenario["schedule"]
        scheduled_for = datetime(2026, 1, 13, 12, 0, 0, tzinfo=timezone.utc)

        from app.services.scheduler import enqueue_job

        job_id = enqueue_job(schedule, scheduled_for)

        assert job_id is not None

        job = db_session.query(Job).filter_by(job_id=job_id).first()
        assert job is not None
        assert job.organization_id == scenario["organization_id"]
        assert job.pipeline_id == scenario["pipeline"].pipeline_id
        assert job.schedule_id == schedule.schedule_id
        assert job.status == "queued"
        assert job.job_type == "scheduled"
        assert job.attempt == 0
        assert job.max_attempts == 3

    def test_skips_when_running_job_exists(self, db_session, scheduling_scenario, disabled_redis):
        """enqueue_job returns None when pipeline already has a running job."""
        scenario = scheduling_scenario
        schedule = scenario["schedule"]

        # Create a running job for the same pipeline
        running_job = Job(
            organization_id=scenario["organization_id"],
            pipeline_id=scenario["pipeline"].pipeline_id,
            schedule_id=schedule.schedule_id,
            scheduled_for=datetime.now(timezone.utc) - timedelta(minutes=5),
            status="running",
            started_at=datetime.now(timezone.utc) - timedelta(minutes=5),
            job_type="scheduled",
            priority=100,
            payload={},
            attempt=1,
            max_attempts=3,
        )
        db_session.add(running_job)
        db_session.commit()

        from app.services.scheduler import enqueue_job

        scheduled_for = datetime(2026, 1, 13, 12, 0, 0, tzinfo=timezone.utc)
        job_id = enqueue_job(schedule, scheduled_for)

        assert job_id is None
