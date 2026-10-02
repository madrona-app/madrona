"""
Coverage tests for ``app/services/pipeline.py``.

Targets the pipeline orchestration service directly (no HTTP) so each
test exercises a single branch of the extract/canonicalize/publish
state machine. Tests lean on the StubSourceConnector/StubTargetConnector
pair registered in ``app/connectors/stub.py`` for realistic end-to-end
execution; narrower unit tests hit pure functions (status machine,
sync-mode decider, rollback feasibility) with direct inputs.

Design notes:
- Uses the real ``db_session`` fixture (Postgres, per-conftest) — no code
  under test is mocked. External side-effects (WebSocket emit, Redis,
  notifications, search-index queueing) all degrade gracefully when
  their transports are absent, so the service functions run unmodified.
- Deleted runs are exercised via a custom in-module source connector
  instead of patching the canonical store.
- Canonical validation is pinned to ``warn`` by an autouse fixture. See
  ``_canonical_warn_mode`` below for why that is a precondition of these
  tests rather than an accident.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Iterable
from unittest.mock import patch
from uuid import UUID, uuid4

import pytest

from app.models import (
    ChangeEvent,
    ConnectorDefinition,
    ConnectorInstance,
    EntityCurrent,
    FieldDiff,
    Organization,
    Pipeline,
    PipelineDestination,
    PipelineSource,
    Run,
    RunDestinationStep,
    RunSourceStep,
)
from app.services import pipeline as pipeline_svc
from app.services.pipeline import (
    ALLOWED_TRANSITIONS,
    PipelineError,
    RollbackError,
    RunConflictError,
    check_rollback_feasibility,
    decide_sync_mode,
    execute_run,
    find_last_successful_run,
    phase_extract_and_canonicalize,
    phase_publish_destinations,
    republish_run,
    retry_destination_publish,
    rollback_run,
    safe_update_status,
    validate_transition,
)


@pytest.fixture(autouse=True)
def _canonical_warn_mode(monkeypatch):
    """Pin CANONICAL_VALIDATION_MODE=warn for this module.

    These tests exercise pipeline *orchestration* — the extract/canonicalize/
    publish state machine — using StubSourceConnector, whose `normalize()`
    returns the raw source record as the payload (`{id, title, description,
    modified_date, image_url}`). That has no `type`/`label`, so it can never
    satisfy the canonical schema; every stub record legitimately takes the
    legacy path. Under `error` mode the store raises CanonicalValidationError
    and every run finalizes as `failed`, which says nothing about the state
    machine these tests are here to cover.

    This was previously implicit. CI declares CANONICAL_VALIDATION_MODE=error
    at the job level, and the module only passed because
    test_connectors_canonical_output.py leaked a `warn` Settings object into
    the process-global `app.config.settings` singleton and never restored it.
    Whole-suite runs happened to schedule that file first; running this file
    alone (or on a different xdist worker) removed the leak and produced 9
    failures. The tests were right, the green was wrong.

    Declaring the precondition here makes the module self-contained and
    order-independent. Whether the pipeline *should* reject legacy payloads in
    production is a separate product question — deliberately not decided by a
    test-ordering side effect.
    """
    import app.config

    monkeypatch.setenv("CANONICAL_VALIDATION_MODE", "warn")
    saved = app.config.settings
    # None forces get_settings() to rebuild from the env var set above.
    app.config.settings = None
    yield
    # Restore rather than null: leaving it None would make the *next* test
    # rebuild from ambient env, reintroducing exactly the cross-test coupling
    # this fixture exists to remove.
    app.config.settings = saved


# ---------------------------------------------------------------------------
# Pure-function tests (no DB work)
# ---------------------------------------------------------------------------


class TestValidateTransition:
    """State-machine guardrails for run status transitions."""

    def test_self_transition_is_idempotent(self):
        ok, err = validate_transition("running", "running")
        assert ok is True
        assert err is None

    def test_unknown_old_status_is_rejected(self):
        ok, err = validate_transition("bogus", "running")
        assert ok is False
        assert "Unknown status" in err

    def test_terminal_status_cannot_transition(self):
        ok, err = validate_transition("failed", "running")
        assert ok is False
        assert "terminal state" in err

    def test_disallowed_transition_is_rejected(self):
        # publishing -> running is not in the allowed list
        ok, err = validate_transition("publishing", "running")
        assert ok is False
        assert "Invalid transition" in err
        assert "Allowed:" in err

    def test_allowed_transition_succeeds(self):
        ok, err = validate_transition("pending", "running")
        assert ok is True
        assert err is None

    def test_every_mapped_transition_is_accepted(self):
        # Spot-check the map to ensure every declared transition is
        # reachable through validate_transition().
        for src, dests in ALLOWED_TRANSITIONS.items():
            for dest in dests:
                ok, _ = validate_transition(src, dest)
                assert ok is True, f"{src}->{dest} should be allowed"


class TestSafeUpdateStatus:
    """safe_update_status wraps validate_transition + mutates the run."""

    def test_mutates_run_on_valid_transition(self):
        run = Run(status="pending", run_id=uuid4())
        safe_update_status(run, "running")
        assert run.status == "running"

    def test_raises_pipeline_error_on_invalid_transition(self):
        run = Run(status="failed", run_id=uuid4())
        with pytest.raises(PipelineError) as exc_info:
            safe_update_status(run, "running")
        assert "Status transition error" in str(exc_info.value)
        # Status must not have been mutated
        assert run.status == "failed"


# ---------------------------------------------------------------------------
# Sync-mode decision (watermark / force-full / first-time sync)
# ---------------------------------------------------------------------------


@pytest.fixture
def _org(db_session):
    org = Organization(
        name="Pipeline Test Org",
        slug="pipeline-svc-coverage",
        is_demo=False,
        status="active",
    )
    db_session.add(org)
    db_session.commit()
    return org


def _make_stub_pipeline(
    db_session,
    org,
    *,
    with_destination: bool = True,
    extra_sources: int = 0,
    source_impl: str = "app.connectors.stub:StubSourceConnector",
    target_impl: str = "app.connectors.stub:StubTargetConnector",
    source_config: dict[str, Any] | None = None,
    delete_detection_enabled: bool = False,
    delete_detection_method: str | None = None,
    target_profile: str | None = None,
    profile_validation_mode: str | None = None,
    suffix: str = "",
):
    """Create a pipeline wired to stub connector definitions and instances."""
    # Give each test unique connector keys so parallel fixtures coexist on
    # the same database transaction without hitting unique-key collisions.
    unique = suffix or str(uuid4())[:8]

    source_def = ConnectorDefinition(
        key=f"stub_source_{unique}",
        display_name="Stub Source",
        direction="source",
        implementation_key=source_impl,
        capabilities={"extract": True},
        config_schema={
            "type": "object",
            "properties": {"api_key": {"type": "string"}},
            "required": ["api_key"],
        },
        is_enabled=True,
    )
    db_session.add(source_def)
    db_session.flush()

    source_instance = ConnectorInstance(
        organization_id=org.organization_id,
        connector_definition_id=source_def.connector_definition_id,
        name=f"Source-{unique}",
        status="active",
        config=source_config or {"api_key": "test"},
    )
    db_session.add(source_instance)
    db_session.flush()

    target_instance = None
    if with_destination:
        target_def = ConnectorDefinition(
            key=f"stub_target_{unique}",
            display_name="Stub Target",
            direction="target",
            implementation_key=target_impl,
            capabilities={"publish_objects": True},
            config_schema={
                "type": "object",
                "properties": {"output_path": {"type": "string"}},
                "required": ["output_path"],
            },
            is_enabled=True,
        )
        db_session.add(target_def)
        db_session.flush()

        target_instance = ConnectorInstance(
            organization_id=org.organization_id,
            connector_definition_id=target_def.connector_definition_id,
            name=f"Target-{unique}",
            status="active",
            config={"output_path": "/tmp/out.json"},
        )
        db_session.add(target_instance)
        db_session.flush()

    pipeline = Pipeline(
        organization_id=org.organization_id,
        status="active",
        delete_detection_enabled=delete_detection_enabled,
        delete_detection_method=delete_detection_method,
        target_profile=target_profile,
        profile_validation_mode=profile_validation_mode,
    )
    db_session.add(pipeline)
    db_session.flush()

    ps = PipelineSource(
        pipeline_id=pipeline.pipeline_id,
        connector_instance_id=source_instance.connector_instance_id,
        enabled=True,
        parameters={},
        ordering=0,
    )
    db_session.add(ps)

    for i in range(extra_sources):
        extra = ConnectorInstance(
            organization_id=org.organization_id,
            connector_definition_id=source_def.connector_definition_id,
            name=f"Source-extra-{unique}-{i}",
            status="active",
            config={"api_key": "test"},
        )
        db_session.add(extra)
        db_session.flush()
        db_session.add(
            PipelineSource(
                pipeline_id=pipeline.pipeline_id,
                connector_instance_id=extra.connector_instance_id,
                enabled=True,
                parameters={},
                ordering=i + 1,
            )
        )

    if target_instance is not None:
        db_session.add(
            PipelineDestination(
                pipeline_id=pipeline.pipeline_id,
                connector_instance_id=target_instance.connector_instance_id,
                enabled=True,
                parameters={},
                ordering=0,
            )
        )

    db_session.commit()
    return pipeline, source_instance, target_instance


def _make_run(
    db_session,
    org,
    pipeline,
    *,
    status: str = "pending",
    parameters: dict | None = None,
    finished_at: datetime | None = None,
):
    run = Run(
        organization_id=org.organization_id,
        pipeline_id=pipeline.pipeline_id,
        status=status,
        triggered_by="api",
        parameters=parameters if parameters is not None else {},
        finished_at=finished_at,
    )
    db_session.add(run)
    db_session.commit()
    return run


class TestSyncModeDecision:
    def test_force_full_sync_is_respected(self, db_session, _org):
        pipeline, _, _ = _make_stub_pipeline(db_session, _org, suffix="fforce")
        run = _make_run(
            db_session,
            _org,
            pipeline,
            parameters={"force_full_sync": True},
        )

        sync_type, ts, reason = decide_sync_mode(
            session=db_session,
            run=run,
            pipeline_id=pipeline.pipeline_id,
            query_hash="abc",
        )

        assert sync_type == "full"
        assert ts is None
        assert reason == "force_full_sync_requested"

    def test_no_previous_run_defaults_to_full(self, db_session, _org):
        pipeline, _, _ = _make_stub_pipeline(db_session, _org, suffix="fnone")
        run = _make_run(db_session, _org, pipeline)

        sync_type, ts, reason = decide_sync_mode(
            session=db_session,
            run=run,
            pipeline_id=pipeline.pipeline_id,
            query_hash="q1",
        )
        assert sync_type == "full"
        assert ts is None
        assert reason == "no_previous_successful_run"

    def test_previous_success_with_watermark_returns_incremental(
        self, db_session, _org
    ):
        pipeline, _, _ = _make_stub_pipeline(db_session, _org, suffix="fincr")
        # Seed a completed run with matching query_hash + watermark
        prev = Run(
            organization_id=_org.organization_id,
            pipeline_id=pipeline.pipeline_id,
            status="success",
            triggered_by="api",
            parameters={"query_hash": "q1", "high_watermark_source_ts": 1700000000},
            finished_at=datetime.now(timezone.utc) - timedelta(hours=1),
        )
        db_session.add(prev)
        db_session.commit()

        run = _make_run(db_session, _org, pipeline)
        sync_type, ts, reason = decide_sync_mode(
            session=db_session,
            run=run,
            pipeline_id=pipeline.pipeline_id,
            query_hash="q1",
        )
        assert sync_type == "incremental"
        assert ts == 1700000000
        assert str(prev.run_id) in reason

    def test_legacy_stats_nested_watermark_location(self, db_session, _org):
        pipeline, _, _ = _make_stub_pipeline(db_session, _org, suffix="flegacy")
        prev = Run(
            organization_id=_org.organization_id,
            pipeline_id=pipeline.pipeline_id,
            status="success",
            triggered_by="api",
            parameters={
                "query_hash": "legacy",
                "stats": {"high_watermark_source_ts": 42},
            },
            finished_at=datetime.now(timezone.utc) - timedelta(hours=2),
        )
        db_session.add(prev)
        db_session.commit()

        run = _make_run(db_session, _org, pipeline)
        sync_type, ts, _ = decide_sync_mode(
            session=db_session,
            run=run,
            pipeline_id=pipeline.pipeline_id,
            query_hash="legacy",
        )
        assert sync_type == "incremental"
        assert ts == 42

    def test_previous_run_without_watermark_falls_back_to_full(
        self, db_session, _org
    ):
        pipeline, _, _ = _make_stub_pipeline(db_session, _org, suffix="fnowater")
        prev = Run(
            organization_id=_org.organization_id,
            pipeline_id=pipeline.pipeline_id,
            status="success",
            triggered_by="api",
            parameters={"query_hash": "q1"},  # No watermark recorded
            finished_at=datetime.now(timezone.utc) - timedelta(hours=1),
        )
        db_session.add(prev)
        db_session.commit()

        run = _make_run(db_session, _org, pipeline)
        sync_type, ts, reason = decide_sync_mode(
            session=db_session,
            run=run,
            pipeline_id=pipeline.pipeline_id,
            query_hash="q1",
        )
        assert sync_type == "full"
        assert ts is None
        assert reason == "no_previous_successful_run"


class TestFindLastSuccessfulRun:
    def test_filters_on_query_hash_match(self, db_session, _org):
        pipeline, _, _ = _make_stub_pipeline(db_session, _org, suffix="hquery")
        # Seed two successful runs with different query_hashes
        matching = Run(
            organization_id=_org.organization_id,
            pipeline_id=pipeline.pipeline_id,
            status="success",
            triggered_by="api",
            parameters={"query_hash": "target"},
            finished_at=datetime.now(timezone.utc) - timedelta(hours=1),
        )
        mismatching = Run(
            organization_id=_org.organization_id,
            pipeline_id=pipeline.pipeline_id,
            status="success",
            triggered_by="api",
            parameters={"query_hash": "other"},
            finished_at=datetime.now(timezone.utc),
        )
        db_session.add_all([matching, mismatching])
        db_session.commit()

        found = find_last_successful_run(
            session=db_session,
            organization_id=_org.organization_id,
            pipeline_id=pipeline.pipeline_id,
            query_hash="target",
        )
        assert found is not None
        assert found.run_id == matching.run_id

    def test_skips_failed_runs(self, db_session, _org):
        pipeline, _, _ = _make_stub_pipeline(db_session, _org, suffix="hfail")
        failed = Run(
            organization_id=_org.organization_id,
            pipeline_id=pipeline.pipeline_id,
            status="failed",
            triggered_by="api",
            parameters={"query_hash": "h"},
            finished_at=datetime.now(timezone.utc),
        )
        db_session.add(failed)
        db_session.commit()

        assert (
            find_last_successful_run(
                session=db_session,
                organization_id=_org.organization_id,
                pipeline_id=pipeline.pipeline_id,
                query_hash="h",
            )
            is None
        )


# ---------------------------------------------------------------------------
# phase_extract_and_canonicalize — happy + edge paths
# ---------------------------------------------------------------------------


class TestPhaseExtractAndCanonicalize:
    def test_happy_path_creates_ten_entities_from_stub(self, db_session, _org):
        pipeline, source_instance, _ = _make_stub_pipeline(
            db_session, _org, with_destination=False, suffix="hhappy"
        )
        run = _make_run(db_session, _org, pipeline)

        result = phase_extract_and_canonicalize(db_session, run.run_id)

        assert result["processed"] == 10
        assert result["created"] == 10
        assert result["updated"] == 0
        assert result["skipped"] == 0
        assert result["deleted"] == 0
        assert len(result["entity_keys"]) == 10
        # canonical_hashes has an entry for each created entity
        assert len(result["canonical_hashes"]) == 10
        # Run metadata updated with aggregated counters
        db_session.refresh(run)
        assert run.status == "publishing"
        assert run.created_count == 10
        assert run.parameters.get("total_sources_processed") == 1
        assert run.parameters.get("total_records_read") == 10

    def test_second_run_with_same_data_is_all_noop(self, db_session, _org):
        pipeline, _, _ = _make_stub_pipeline(
            db_session, _org, with_destination=False, suffix="hnoop"
        )

        first = _make_run(db_session, _org, pipeline)
        phase_extract_and_canonicalize(db_session, first.run_id)

        second = _make_run(db_session, _org, pipeline)
        result = phase_extract_and_canonicalize(db_session, second.run_id)

        # Identical payloads hash-match and skip
        assert result["created"] == 0
        assert result["updated"] == 0
        assert result["skipped"] == 10
        assert result["entity_keys"] == []

    def test_missing_run_raises(self, db_session):
        with pytest.raises(PipelineError) as exc:
            phase_extract_and_canonicalize(db_session, uuid4())
        assert "not found" in str(exc.value)

    def test_invalid_status_raises(self, db_session, _org):
        pipeline, _, _ = _make_stub_pipeline(
            db_session, _org, with_destination=False, suffix="hinvstat"
        )
        # "success" is terminal for the extract entry check
        run = _make_run(db_session, _org, pipeline, status="success")
        with pytest.raises(PipelineError) as exc:
            phase_extract_and_canonicalize(db_session, run.run_id)
        assert "invalid status" in str(exc.value)

    def test_pipeline_without_enabled_sources_raises(self, db_session, _org):
        pipeline, _, _ = _make_stub_pipeline(
            db_session, _org, with_destination=False, suffix="hnosrc"
        )
        # Disable the only source
        for ps in (
            db_session.query(PipelineSource)
            .filter_by(pipeline_id=pipeline.pipeline_id)
            .all()
        ):
            ps.enabled = False
        db_session.commit()

        run = _make_run(db_session, _org, pipeline)
        with pytest.raises(PipelineError) as exc:
            phase_extract_and_canonicalize(db_session, run.run_id)
        assert "no enabled source connectors" in str(exc.value)

    def test_unloadable_source_implementation_marks_step_failed(
        self, db_session, _org
    ):
        # Point the source connector at an unimportable implementation_key.
        # load_connector_class raises ConnectorLoadError, which the per-source
        # try/except in phase 1 catches, marks the RunSourceStep as failed,
        # and re-raises to fail the whole run.
        pipeline, source_instance, _ = _make_stub_pipeline(
            db_session,
            _org,
            with_destination=False,
            source_impl="app.connectors.does_not_exist:NopeConnector",
            suffix="hmiss",
        )
        ps = (
            db_session.query(PipelineSource)
            .filter_by(pipeline_id=pipeline.pipeline_id)
            .first()
        )
        run = _make_run(db_session, _org, pipeline)
        step = RunSourceStep(
            run_id=run.run_id,
            pipeline_source_id=ps.source_id,
            status="pending",
            counts={},
        )
        db_session.add(step)
        db_session.commit()

        with pytest.raises(Exception):
            phase_extract_and_canonicalize(db_session, run.run_id)

        db_session.refresh(step)
        assert step.status == "failed"
        assert step.error is not None


# ---------------------------------------------------------------------------
# phase_publish_destinations — source-only + publish flows
# ---------------------------------------------------------------------------


class TestPhasePublishDestinations:
    def test_source_only_pipeline_skips_publish(self, db_session, _org):
        pipeline, _, _ = _make_stub_pipeline(
            db_session, _org, with_destination=False, suffix="psonly"
        )
        run = _make_run(db_session, _org, pipeline)
        # Need at least one commit before the publish phase inspects the run
        result = phase_publish_destinations(
            db_session,
            run.run_id,
            {"entity_keys": [], "deleted": 0},
        )
        assert result["target_url"] is None
        assert result["published_at"] is None
        assert result["success_count"] == 0
        assert result["failed_count"] == 0
        assert result["partial"] is False

    def test_missing_run_raises(self, db_session):
        with pytest.raises(PipelineError):
            phase_publish_destinations(
                db_session,
                uuid4(),
                {"entity_keys": [], "deleted": 0},
            )

    def test_happy_path_publishes_to_stub_target(self, db_session, _org):
        pipeline, _, _ = _make_stub_pipeline(db_session, _org, suffix="phappy")
        run = _make_run(db_session, _org, pipeline)
        # Actually populate the canonical store first — phase 1 emits change
        # events that phase 2 republishes.
        phase_extract_and_canonicalize(db_session, run.run_id)

        canonicalize_result = {
            "entity_keys": [
                ec.entity_key
                for ec in db_session.query(EntityCurrent)
                .filter_by(organization_id=_org.organization_id)
                .all()
            ],
            "deleted": 0,
        }
        assert canonicalize_result["entity_keys"], "phase 1 should have created entities"

        result = phase_publish_destinations(db_session, run.run_id, canonicalize_result)
        assert result["success_count"] == 1
        assert result["failed_count"] == 0
        assert result["partial"] is False
        assert result["target_url"] == "https://example.com/stub-output"
        # Destination step was materialized with success
        steps = (
            db_session.query(RunDestinationStep).filter_by(run_id=run.run_id).all()
        )
        assert len(steps) == 1
        assert steps[0].status == "success"
        assert steps[0].counts["records_published"] == 10

    def test_publish_exception_marks_destination_failed(
        self, db_session, _org
    ):
        pipeline, _, _ = _make_stub_pipeline(db_session, _org, suffix="pbadtgt")
        run = _make_run(db_session, _org, pipeline, status="running")

        def _boom(self, entities):
            raise RuntimeError("destination outage")

        with patch(
            "app.connectors.stub.StubTargetConnector.publish_records",
            _boom,
        ):
            result = phase_publish_destinations(
                db_session,
                run.run_id,
                {"entity_keys": [], "deleted": 0},
            )

        assert result["failed_count"] == 1
        assert result["success_count"] == 0
        # All-failed is not partial (partial requires mix of success+failed)
        assert result["partial"] is False

        steps = (
            db_session.query(RunDestinationStep).filter_by(run_id=run.run_id).all()
        )
        assert steps and steps[0].status == "failed"
        assert "destination outage" in (steps[0].error or "")


# ---------------------------------------------------------------------------
# execute_run — end-to-end orchestration
# ---------------------------------------------------------------------------


class TestExecuteRun:
    def test_source_only_pipeline_finalizes_as_success(self, db_session, _org):
        pipeline, _, _ = _make_stub_pipeline(
            db_session, _org, with_destination=False, suffix="esonly"
        )
        run = _make_run(db_session, _org, pipeline)
        result = execute_run(db_session, run.run_id)
        assert result.status == "success"
        assert result.target_url is None
        assert result.counts["created"] == 10

        db_session.refresh(run)
        assert run.finished_at is not None
        assert run.duration_ms is not None

    def test_nonexistent_run_returns_failed_result(self, db_session):
        result = execute_run(db_session, uuid4())
        assert result.status == "failed"
        assert result.error is not None
        # No run to persist to, so error_stage stays "extract" by default
        assert result.error_stage == "extract"

    def test_full_pipeline_success_with_destination(self, db_session, _org):
        pipeline, _, _ = _make_stub_pipeline(db_session, _org, suffix="efull")
        run = _make_run(db_session, _org, pipeline)

        result = execute_run(db_session, run.run_id)
        assert result.status == "success"
        assert result.target_url == "https://example.com/stub-output"

        db_session.refresh(run)
        assert run.status == "success"
        assert run.published_at is not None
        # Aggregate counts stored on the run
        assert run.created_count == 10

    def test_publish_failure_marks_run_failed_publish(self, db_session, _org):
        pipeline, _, target_instance = _make_stub_pipeline(
            db_session, _org, suffix="epubfail"
        )
        run = _make_run(db_session, _org, pipeline)

        # Monkey-patch the stub target's publish_records to blow up. This
        # doesn't mock the code under test — only the *external* dependency
        # (target connector) called by execute_run.
        def _boom(self, entities):
            raise RuntimeError("simulated destination outage")

        with patch(
            "app.connectors.stub.StubTargetConnector.publish_records",
            _boom,
        ):
            result = execute_run(db_session, run.run_id)

        # Single destination + it failed → all failed → failed_publish
        assert result.status == "failed_publish"
        db_session.refresh(run)
        assert run.status == "failed_publish"

    def test_extract_failure_marks_run_failed(self, db_session, _org):
        pipeline, _, _ = _make_stub_pipeline(
            db_session, _org, with_destination=False, suffix="eextractfail"
        )
        run = _make_run(db_session, _org, pipeline)

        def _boom(self, **kwargs):
            raise RuntimeError("source API is down")

        with patch(
            "app.connectors.stub.StubSourceConnector.extract",
            _boom,
        ):
            result = execute_run(db_session, run.run_id)

        assert result.status == "failed"
        assert "down" in result.error
        db_session.refresh(run)
        assert run.status == "failed"
        assert run.error_stage == "extract"


# ---------------------------------------------------------------------------
# republish_run — guardrails
# ---------------------------------------------------------------------------


class TestRepublishGuards:
    def test_not_found_raises(self, db_session):
        with pytest.raises(PipelineError) as exc:
            republish_run(db_session, uuid4())
        assert "not found" in str(exc.value)

    def test_running_status_raises_conflict(self, db_session, _org):
        pipeline, _, _ = _make_stub_pipeline(db_session, _org, suffix="rrunning")
        run = _make_run(db_session, _org, pipeline, status="running")
        with pytest.raises(RunConflictError):
            republish_run(db_session, run.run_id)

    def test_non_republishable_status_raises_pipeline_error(self, db_session, _org):
        pipeline, _, _ = _make_stub_pipeline(db_session, _org, suffix="rsucc")
        # "success" is not republishable and error_stage is None
        run = _make_run(db_session, _org, pipeline, status="success")
        with pytest.raises(PipelineError) as exc:
            republish_run(db_session, run.run_id)
        assert "can only republish" in str(exc.value)

    def test_source_only_pipeline_rejects_republish(self, db_session, _org):
        pipeline, _, _ = _make_stub_pipeline(
            db_session, _org, with_destination=False, suffix="rsonly"
        )
        run = _make_run(db_session, _org, pipeline, status="failed_publish")
        with pytest.raises(PipelineError) as exc:
            republish_run(db_session, run.run_id)
        assert "source-only pipeline" in str(exc.value)


# ---------------------------------------------------------------------------
# retry_destination_publish
# ---------------------------------------------------------------------------


class TestRetryDestinationPublish:
    def test_run_not_found_raises(self, db_session):
        with pytest.raises(PipelineError):
            retry_destination_publish(db_session, uuid4(), uuid4())

    def test_destination_not_found_raises(self, db_session, _org):
        pipeline, _, _ = _make_stub_pipeline(db_session, _org, suffix="rdnofound")
        run = _make_run(db_session, _org, pipeline, status="failed_publish")
        with pytest.raises(PipelineError) as exc:
            retry_destination_publish(db_session, run.run_id, uuid4())
        assert "PipelineDestination" in str(exc.value)

    def test_destination_belongs_to_different_pipeline(self, db_session, _org):
        # Create two pipelines and attempt to retry the other's destination.
        # The pipeline-mismatch check runs before the dest_step row is
        # created, so the wrapper re-raises as PipelineError rather than
        # returning a failure dict.
        pipeline_a, _, _ = _make_stub_pipeline(db_session, _org, suffix="rdA")
        pipeline_b, _, _ = _make_stub_pipeline(db_session, _org, suffix="rdB")
        other_dest = (
            db_session.query(PipelineDestination)
            .filter_by(pipeline_id=pipeline_b.pipeline_id)
            .first()
        )
        run_a = _make_run(db_session, _org, pipeline_a, status="failed_publish")
        with pytest.raises(PipelineError) as exc:
            retry_destination_publish(
                db_session, run_a.run_id, other_dest.destination_id
            )
        assert "does not belong" in str(exc.value)

    def test_happy_path_retries_successfully(self, db_session, _org):
        pipeline, _, _ = _make_stub_pipeline(db_session, _org, suffix="rdok")
        run = _make_run(db_session, _org, pipeline, status="failed_publish")
        # Populate canonical store with at least one entity so publish has work
        canonicalize_result = phase_extract_and_canonicalize(
            db_session, _make_run(db_session, _org, pipeline).run_id
        )
        assert canonicalize_result["created"] == 10

        dest = (
            db_session.query(PipelineDestination)
            .filter_by(pipeline_id=pipeline.pipeline_id)
            .first()
        )
        result = retry_destination_publish(db_session, run.run_id, dest.destination_id)

        assert result["status"] == "success"
        assert result["target_url"] == "https://example.com/stub-output"
        assert result["error"] is None
        assert result["counts"]["published_entities"] == 10


# ---------------------------------------------------------------------------
# check_rollback_feasibility
# ---------------------------------------------------------------------------


class TestCheckRollbackFeasibility:
    def test_run_not_found(self, db_session, _org):
        result = check_rollback_feasibility(
            db_session, _org.organization_id, uuid4()
        )
        assert result.can_rollback is False
        assert result.reason == "Run not found"

    def test_wrong_status_rejected(self, db_session, _org):
        pipeline, _, _ = _make_stub_pipeline(db_session, _org, suffix="rbwrong")
        run = _make_run(db_session, _org, pipeline, status="failed")
        result = check_rollback_feasibility(
            db_session, _org.organization_id, run.run_id
        )
        assert result.can_rollback is False
        assert "status" in result.reason

    def test_already_rolled_back(self, db_session, _org):
        pipeline, _, _ = _make_stub_pipeline(db_session, _org, suffix="rbdone")
        run = _make_run(db_session, _org, pipeline, status="success")
        run.rolled_back_at = datetime.now(timezone.utc)
        db_session.commit()

        result = check_rollback_feasibility(
            db_session, _org.organization_id, run.run_id
        )
        assert result.can_rollback is False
        assert "already been rolled back" in result.reason

    def test_rollback_run_cannot_be_rolled_back(self, db_session, _org):
        pipeline, _, _ = _make_stub_pipeline(db_session, _org, suffix="rbself")
        target = _make_run(db_session, _org, pipeline, status="success")
        rb = _make_run(db_session, _org, pipeline, status="success")
        rb.rollback_of_run_id = target.run_id
        db_session.commit()

        result = check_rollback_feasibility(
            db_session, _org.organization_id, rb.run_id
        )
        assert result.can_rollback is False
        assert "rollback run" in result.reason

    def test_no_change_events_to_rollback(self, db_session, _org):
        pipeline, _, _ = _make_stub_pipeline(db_session, _org, suffix="rbnoev")
        run = _make_run(
            db_session,
            _org,
            pipeline,
            status="success",
            finished_at=datetime.now(timezone.utc),
        )
        result = check_rollback_feasibility(
            db_session, _org.organization_id, run.run_id
        )
        assert result.can_rollback is False
        assert result.reason == "No changes to rollback"

    def test_feasible_when_no_subsequent_changes(self, db_session, _org):
        pipeline, _, _ = _make_stub_pipeline(
            db_session, _org, with_destination=False, suffix="rbfeas"
        )
        run = _make_run(db_session, _org, pipeline)
        phase_extract_and_canonicalize(db_session, run.run_id)
        run.status = "success"
        run.finished_at = datetime.now(timezone.utc)
        db_session.commit()

        result = check_rollback_feasibility(
            db_session, _org.organization_id, run.run_id
        )
        assert result.can_rollback is True
        assert result.partial is False
        assert result.total_changes == 10
        assert result.rollbackable_changes == 10


# ---------------------------------------------------------------------------
# rollback_run (full execution — happy path)
# ---------------------------------------------------------------------------


class TestRollbackRun:
    def test_rollback_reverts_created_entities(self, db_session, _org):
        pipeline, _, _ = _make_stub_pipeline(
            db_session, _org, with_destination=False, suffix="rbrun"
        )
        run = _make_run(db_session, _org, pipeline)
        phase_extract_and_canonicalize(db_session, run.run_id)
        run.status = "success"
        run.finished_at = datetime.now(timezone.utc)
        db_session.commit()

        result = rollback_run(
            session=db_session,
            organization_id=_org.organization_id,
            run_id=run.run_id,
            skip_republish=True,
        )

        assert result.status == "success"
        assert result.reverted_creates == 10
        assert result.reverted_updates == 0
        assert result.reverted_deletes == 0
        assert result.skipped_conflicts == 0

        db_session.refresh(run)
        assert run.status == "rolled_back"
        assert run.rolled_back_at is not None
        assert run.rolled_back_by_run_id == result.rollback_run_id

        # All created entities are now soft-deleted
        live = (
            db_session.query(EntityCurrent)
            .filter_by(organization_id=_org.organization_id, is_deleted=False)
            .count()
        )
        assert live == 0

    def test_non_feasible_without_force_partial_raises(self, db_session, _org):
        pipeline, _, _ = _make_stub_pipeline(db_session, _org, suffix="rbraise")
        # Run is in failed status — not rollbackable
        run = _make_run(db_session, _org, pipeline, status="failed")
        with pytest.raises(RollbackError):
            rollback_run(
                session=db_session,
                organization_id=_org.organization_id,
                run_id=run.run_id,
                skip_republish=True,
            )
