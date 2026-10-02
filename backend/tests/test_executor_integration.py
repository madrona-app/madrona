"""
Integration tests for executor (pipeline.execute_run).

These tests verify the complete flow: extract -> canonicalize -> publish.
They use stub connectors against PostgreSQL, like the rest of the suite.
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

    Third and last module with this precondition — see the fixture of the
    same name in test_pipeline_service_coverage.py for the full account.
    These tests assert a run reaches `success`, and they feed it through
    StubSourceConnector, whose normalize() returns the raw source record with
    no `type`/`label`. That can never satisfy the canonical schema, so under
    `error` mode the store raises and every run finalizes as `failed` —
    which says nothing about the extract/canonicalize/publish flow the module
    is here to cover.

    Found by running each stub-connector module alone under the job env CI
    declares; two of this file's tests fail that way and pass in whole-suite
    runs only because an earlier-sorting module used to leave `warn` behind.
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


@pytest.fixture
def test_org(db_session):
    """Create a test organization."""
    org = Organization(
        name="Test Organization",
        slug="test-org",
        status="active",
    )
    db_session.add(org)
    db_session.flush()
    return org


@pytest.fixture
def stub_source_connector(db_session, test_org):
    """Create stub source connector definition and instance."""
    definition = ConnectorDefinition(
        key="stub_source",
        display_name="Stub Source",
        direction="source",
        implementation_key="app.connectors.stub:StubSourceConnector",
        capabilities={"extract": True, "incremental": False},
        config_schema={
            "type": "object",
            "properties": {
                "api_key": {"type": "string", "description": "API key"}
            },
            "required": ["api_key"],
        },
        is_enabled=True,
    )
    db_session.add(definition)
    db_session.flush()

    instance = ConnectorInstance(
        organization_id=test_org.organization_id,
        connector_definition_id=definition.connector_definition_id,
        name="Test Stub Source",
        status="active",
        config={"api_key": "test"},
    )
    db_session.add(instance)
    db_session.flush()

    return definition, instance


@pytest.fixture
def stub_target_connector(db_session, test_org):
    """Create stub target connector definition and instance."""
    definition = ConnectorDefinition(
        key="stub_target",
        display_name="Stub Target",
        direction="target",
        implementation_key="app.connectors.stub:StubTargetConnector",
        capabilities={"publish_objects": True, "publish_changes": True},
        config_schema={
            "type": "object",
            "properties": {
                "output_path": {"type": "string", "description": "Output path"}
            },
            "required": ["output_path"],
        },
        is_enabled=True,
    )
    db_session.add(definition)
    db_session.flush()

    instance = ConnectorInstance(
        organization_id=test_org.organization_id,
        connector_definition_id=definition.connector_definition_id,
        name="Test Stub Target",
        status="active",
        config={"output_path": "/tmp/stub_output.json"},
    )
    db_session.add(instance)
    db_session.flush()

    return definition, instance


@pytest.fixture
def integration_route(db_session, test_org, stub_source_connector, stub_target_connector):
    """Create a complete integration route (source -> target)."""
    _, source_instance = stub_source_connector
    _, target_instance = stub_target_connector

    from app.models import PipelineSource, PipelineDestination

    route = Pipeline(
        organization_id=test_org.organization_id,
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

    return route


@pytest.mark.unit
class TestExecutorIntegration:
    """Integration tests for execute_run."""

    def test_complete_flow(
        self, db_session, test_org, integration_route, stub_source_connector, stub_target_connector
    ):
        """Test complete flow from extract to publish."""
        _, source_instance = stub_source_connector
        _, target_instance = stub_target_connector

        run = Run(
            organization_id=test_org.organization_id,
            pipeline_id=integration_route.pipeline_id,
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
        assert result.run_id == run.run_id
        assert result.duration_ms > 0
        assert result.counts["created"] == 10
        assert result.counts["updated"] == 0
        assert result.counts["noop"] == 0

    def test_second_run_detects_no_changes(
        self, db_session, test_org, integration_route, stub_source_connector, stub_target_connector
    ):
        """Second run with identical data shows noop."""
        _, source_instance = stub_source_connector
        _, target_instance = stub_target_connector

        # First run
        run1 = Run(
            organization_id=test_org.organization_id,
            pipeline_id=integration_route.pipeline_id,
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
            organization_id=test_org.organization_id,
            pipeline_id=integration_route.pipeline_id,
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


@pytest.mark.unit
class TestExecutorInvariants:
    """Test invariants that must be enforced by the executor."""

