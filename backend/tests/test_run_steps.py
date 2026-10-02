"""
Tests for run step creation.

Verifies that when a run is created, step tracking rows are automatically
created for each enabled source and destination via create_run_steps().
"""

import pytest
from uuid import uuid4

from app.models import (
    Organization,
    ConnectorDefinition,
    ConnectorInstance,
    Pipeline,
    PipelineSource,
    PipelineDestination,
    Run,
    RunSourceStep,
    RunDestinationStep,
)
from app.services.run_steps import create_run_steps


@pytest.fixture
def step_org(db_session):
    """Create a test organization for run step tests."""
    org = Organization(
        name="Step Test Org",
        slug="step-test-org",
        is_demo=False,
        status="active",
    )
    db_session.add(org)
    db_session.flush()
    return org


@pytest.fixture
def source_connector(db_session, step_org):
    """Create a source connector definition and instance."""
    definition = ConnectorDefinition(
        key="step_test_source",
        display_name="Step Test Source",
        direction="source",
        implementation_key="app.connectors.stub:StubSourceConnector",
        capabilities={"extract": True},
        config_schema={"type": "object", "properties": {}},
        default_config={},
        is_enabled=True,
    )
    db_session.add(definition)
    db_session.flush()

    instance = ConnectorInstance(
        organization_id=step_org.organization_id,
        connector_definition_id=definition.connector_definition_id,
        name="Step Test Source Instance",
        status="active",
        config={},
    )
    db_session.add(instance)
    db_session.flush()
    return instance


@pytest.fixture
def target_connector(db_session, step_org):
    """Create a target connector definition and instance."""
    definition = ConnectorDefinition(
        key="step_test_target",
        display_name="Step Test Target",
        direction="target",
        implementation_key="app.connectors.stub:StubTargetConnector",
        capabilities={"publish_objects": True},
        config_schema={"type": "object", "properties": {}},
        default_config={},
        is_enabled=True,
    )
    db_session.add(definition)
    db_session.flush()

    instance = ConnectorInstance(
        organization_id=step_org.organization_id,
        connector_definition_id=definition.connector_definition_id,
        name="Step Test Target Instance",
        status="active",
        config={},
    )
    db_session.add(instance)
    db_session.flush()
    return instance


class TestRunStepCreation:
    """Test automatic creation of run steps."""

    def test_creates_steps_for_enabled_sources_and_destinations(
        self, db_session, step_org, source_connector, target_connector
    ):
        """Steps are created for each enabled source and destination."""
        pipeline = Pipeline(
            organization_id=step_org.organization_id,
            status="active",
        )
        db_session.add(pipeline)
        db_session.flush()

        # Add 2 enabled sources
        source1 = PipelineSource(
            pipeline_id=pipeline.pipeline_id,
            connector_instance_id=source_connector.connector_instance_id,
            enabled=True,
            ordering=0,
        )
        source2 = PipelineSource(
            pipeline_id=pipeline.pipeline_id,
            connector_instance_id=source_connector.connector_instance_id,
            enabled=True,
            ordering=1,
        )
        db_session.add_all([source1, source2])

        # Add 1 enabled destination
        destination1 = PipelineDestination(
            pipeline_id=pipeline.pipeline_id,
            connector_instance_id=target_connector.connector_instance_id,
            enabled=True,
            ordering=0,
        )
        db_session.add(destination1)
        db_session.flush()

        # Create run
        run = Run(
            organization_id=step_org.organization_id,
            pipeline_id=pipeline.pipeline_id,
            source_connector_instance_id=source_connector.connector_instance_id,
            target_connector_instance_id=target_connector.connector_instance_id,
            status="pending",
            triggered_by="manual",
            parameters={},
        )
        db_session.add(run)
        db_session.flush()

        # Create steps
        create_run_steps(run)
        db_session.commit()

        # Verify 2 source steps created
        source_steps = db_session.query(RunSourceStep).filter_by(run_id=run.run_id).all()
        assert len(source_steps) == 2
        assert all(step.status == "pending" for step in source_steps)
        assert all(step.counts == {} for step in source_steps)
        assert {step.pipeline_source_id for step in source_steps} == {
            source1.source_id,
            source2.source_id,
        }

        # Verify 1 destination step created
        dest_steps = db_session.query(RunDestinationStep).filter_by(run_id=run.run_id).all()
        assert len(dest_steps) == 1
        assert dest_steps[0].status == "pending"
        assert dest_steps[0].counts == {}
        assert dest_steps[0].pipeline_destination_id == destination1.destination_id

    def test_skips_disabled_sources_and_destinations(
        self, db_session, step_org, source_connector, target_connector
    ):
        """Disabled sources and destinations do not get steps created."""
        pipeline = Pipeline(
            organization_id=step_org.organization_id,
            status="active",
        )
        db_session.add(pipeline)
        db_session.flush()

        # Add 1 enabled and 1 disabled source
        source_enabled = PipelineSource(
            pipeline_id=pipeline.pipeline_id,
            connector_instance_id=source_connector.connector_instance_id,
            enabled=True,
            ordering=0,
        )
        source_disabled = PipelineSource(
            pipeline_id=pipeline.pipeline_id,
            connector_instance_id=source_connector.connector_instance_id,
            enabled=False,
            ordering=1,
        )
        db_session.add_all([source_enabled, source_disabled])

        # Add 1 disabled destination
        dest_disabled = PipelineDestination(
            pipeline_id=pipeline.pipeline_id,
            connector_instance_id=target_connector.connector_instance_id,
            enabled=False,
            ordering=0,
        )
        db_session.add(dest_disabled)
        db_session.flush()

        # Create run
        run = Run(
            organization_id=step_org.organization_id,
            pipeline_id=pipeline.pipeline_id,
            source_connector_instance_id=source_connector.connector_instance_id,
            status="pending",
            triggered_by="manual",
            parameters={},
        )
        db_session.add(run)
        db_session.flush()

        # Create steps
        create_run_steps(run)
        db_session.commit()

        # Verify only 1 source step (enabled)
        source_steps = db_session.query(RunSourceStep).filter_by(run_id=run.run_id).all()
        assert len(source_steps) == 1
        assert source_steps[0].pipeline_source_id == source_enabled.source_id

        # Verify no destination steps (all disabled)
        dest_steps = db_session.query(RunDestinationStep).filter_by(run_id=run.run_id).all()
        assert len(dest_steps) == 0

    def test_handles_pipeline_with_no_sources_or_destinations(
        self, db_session, step_org
    ):
        """Pipeline with no normalized sources/destinations is handled gracefully."""
        pipeline = Pipeline(
            organization_id=step_org.organization_id,
            status="active",
        )
        db_session.add(pipeline)
        db_session.flush()

        run = Run(
            organization_id=step_org.organization_id,
            pipeline_id=pipeline.pipeline_id,
            status="pending",
            triggered_by="manual",
            parameters={},
        )
        db_session.add(run)
        db_session.flush()

        # Should not error
        create_run_steps(run)
        db_session.commit()

        source_steps = db_session.query(RunSourceStep).filter_by(run_id=run.run_id).all()
        assert len(source_steps) == 0

        dest_steps = db_session.query(RunDestinationStep).filter_by(run_id=run.run_id).all()
        assert len(dest_steps) == 0

    def test_handles_run_without_pipeline(self, db_session, step_org):
        """Run without a pipeline_id is handled gracefully (no steps created)."""
        run = Run(
            organization_id=step_org.organization_id,
            pipeline_id=None,
            status="pending",
            triggered_by="manual",
            parameters={},
        )
        db_session.add(run)
        db_session.flush()

        # Should not error
        create_run_steps(run)
        db_session.commit()

        source_steps = db_session.query(RunSourceStep).filter_by(run_id=run.run_id).all()
        assert len(source_steps) == 0

        dest_steps = db_session.query(RunDestinationStep).filter_by(run_id=run.run_id).all()
        assert len(dest_steps) == 0
