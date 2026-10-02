"""
Integration tests for the full pipeline execution.

Tests the execute_run service function end to end using stub connectors.
No external APIs. PostgreSQL is required, like the rest of the suite.
"""

import pytest
from uuid import uuid4

from app.models import (
    Organization,
    ConnectorDefinition,
    ConnectorInstance,
    Pipeline,
    Run,
)
from app.services.pipeline import execute_run


@pytest.fixture(autouse=True)
def _canonical_warn_mode(monkeypatch):
    """Pin CANONICAL_VALIDATION_MODE=warn for this module.

    Same precondition, same reasoning, as the fixture of the same name in
    test_pipeline_service_coverage.py — see its docstring for the full
    account. In short: these tests drive the pipeline through
    StubSourceConnector, whose normalize() hands back the raw source record,
    which has no `type`/`label` and so can never satisfy the canonical schema.
    Every stub record legitimately takes the legacy path. Under `error` mode
    the store raises CanonicalValidationError, every run finalizes as
    `failed`, and the assertions here report that instead of anything about
    pipeline execution.

    This module was missed when that leak was fixed. It kept passing in
    whole-suite runs purely because test_connectors_canonical_output.py sorts
    earlier and, at the time, left a `warn` Settings object behind. Run this
    file on its own under the job env CI declares
    (CANONICAL_VALIDATION_MODE=error) and three of its four tests fail; put
    the two files on different xdist workers and the same three fail. The
    tests were right, the green was wrong.
    """
    import app.config

    monkeypatch.setenv("CANONICAL_VALIDATION_MODE", "warn")
    saved = app.config.settings
    # None forces get_settings() to rebuild from the env var set above.
    app.config.settings = None
    yield
    # Restore rather than null: leaving it None would make the *next* test
    # rebuild from ambient env, reintroducing the coupling this removes.
    app.config.settings = saved


@pytest.mark.unit
class TestPipelineExecution:
    """Integration tests for full pipeline execution."""

    def _setup_full_route(self, db_session):
        """Helper to create a full pipeline with stub connectors."""
        organization = Organization(
            name="Test Organization",
            slug="test-org-pipeline",
            is_demo=False,
            status="active",
        )
        db_session.add(organization)
        db_session.flush()

        source_def = ConnectorDefinition(
            key="stub_source_pipe",
            display_name="Stub Source",
            direction="source",
            implementation_key="app.connectors.stub:StubSourceConnector",
            capabilities={"extract": True, "incremental": False},
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
            organization_id=organization.organization_id,
            connector_definition_id=source_def.connector_definition_id,
            name="Test Stub Source",
            status="active",
            config={"api_key": "test"},
        )
        db_session.add(source_instance)
        db_session.flush()

        target_def = ConnectorDefinition(
            key="stub_target_pipe",
            display_name="Stub Target",
            direction="target",
            implementation_key="app.connectors.stub:StubTargetConnector",
            capabilities={"publish_objects": True, "publish_changes": True},
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
            organization_id=organization.organization_id,
            connector_definition_id=target_def.connector_definition_id,
            name="Test Stub Target",
            status="active",
            config={"output_path": "/tmp/stub_output.json"},
        )
        db_session.add(target_instance)
        db_session.flush()

        from app.models import PipelineSource, PipelineDestination

        route = Pipeline(
            organization_id=organization.organization_id,
            status="active",
        )
        db_session.add(route)
        db_session.flush()

        # Link source and destination via join tables
        ps = PipelineSource(
            pipeline_id=route.pipeline_id,
            connector_instance_id=source_instance.connector_instance_id,
            enabled=True,
            parameters={},
            ordering=0,
        )
        pd = PipelineDestination(
            pipeline_id=route.pipeline_id,
            connector_instance_id=target_instance.connector_instance_id,
            enabled=True,
            parameters={},
            ordering=0,
        )
        db_session.add_all([ps, pd])
        db_session.flush()

        return organization, source_instance, target_instance, route

    def test_execute_run_with_stub_connectors(self, db_session):
        """Test full pipeline execution from extract to publish."""
        organization, source_instance, target_instance, route = self._setup_full_route(db_session)

        run = Run(
            organization_id=organization.organization_id,
            pipeline_id=route.pipeline_id,
            source_connector_instance_id=source_instance.connector_instance_id,
            target_connector_instance_id=target_instance.connector_instance_id,
            status="pending",
            triggered_by="api",
            parameters={},
        )
        db_session.add(run)
        db_session.commit()

        result = execute_run(session=db_session, run_id=run.run_id)

        assert result.status == "success"
        assert result.counts["created"] == 10
        assert result.counts["updated"] == 0
        assert result.counts["noop"] == 0
        assert result.duration_ms > 0
        assert str(result.run_id) == str(run.run_id)

    def test_execute_run_second_execution_shows_noop(self, db_session):
        """Test that re-executing the same data shows noop."""
        organization, source_instance, target_instance, route = self._setup_full_route(db_session)

        # First run
        run1 = Run(
            organization_id=organization.organization_id,
            pipeline_id=route.pipeline_id,
            source_connector_instance_id=source_instance.connector_instance_id,
            target_connector_instance_id=target_instance.connector_instance_id,
            status="pending",
            triggered_by="api",
            parameters={},
        )
        db_session.add(run1)
        db_session.commit()

        result1 = execute_run(session=db_session, run_id=run1.run_id)
        assert result1.status == "success"
        assert result1.counts["created"] == 10

        # Second run with same data
        run2 = Run(
            organization_id=organization.organization_id,
            pipeline_id=route.pipeline_id,
            source_connector_instance_id=source_instance.connector_instance_id,
            target_connector_instance_id=target_instance.connector_instance_id,
            status="pending",
            triggered_by="api",
            parameters={},
        )
        db_session.add(run2)
        db_session.commit()

        result2 = execute_run(session=db_session, run_id=run2.run_id)

        assert result2.status == "success"
        assert result2.counts["created"] == 0
        assert result2.counts["updated"] == 0
        assert result2.counts["noop"] == 10

    def test_execute_run_nonexistent_run_id(self, db_session):
        """Test error when run doesn't exist."""
        nonexistent_run_id = uuid4()

        result = execute_run(session=db_session, run_id=nonexistent_run_id)
        assert result.status == "failed"
        assert result.error is not None

    def test_execute_run_status_transitions(self, db_session):
        """Test that run goes through correct status transitions."""
        organization, source_instance, target_instance, route = self._setup_full_route(db_session)

        run = Run(
            organization_id=organization.organization_id,
            pipeline_id=route.pipeline_id,
            source_connector_instance_id=source_instance.connector_instance_id,
            target_connector_instance_id=target_instance.connector_instance_id,
            status="pending",
            triggered_by="api",
            parameters={},
        )
        db_session.add(run)
        db_session.commit()

        # Verify initial state
        assert run.status == "pending"
        assert run.started_at is None
        assert run.finished_at is None

        result = execute_run(session=db_session, run_id=run.run_id)

        assert result.status == "success"

        # Verify final state in database
        db_session.expire_all()
        updated_run = db_session.query(Run).filter_by(run_id=run.run_id).first()

        assert updated_run.status == "success"
        assert updated_run.started_at is not None
        assert updated_run.finished_at is not None
        assert updated_run.finished_at >= updated_run.started_at
        assert updated_run.duration_ms is not None
        assert updated_run.duration_ms > 0
        assert updated_run.processed_count > 0
