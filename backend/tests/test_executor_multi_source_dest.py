"""
Tests for multi-source + multi-destination pipeline execution.

These tests verify:
1. PipelineSource and PipelineDestination model creation
2. RunSourceStep and RunDestinationStep creation
3. Step tracking infrastructure
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


@pytest.fixture
def test_org(db_session):
    """Create test organization."""
    org = Organization(
        name="Test Org",
        slug="test-org-multi",
        status="active",
    )
    db_session.add(org)
    db_session.flush()
    return org


@pytest.fixture
def source_def(db_session):
    """Create test source connector definition."""
    conn_def = ConnectorDefinition(
        key="test_multi_source",
        display_name="Test Source",
        direction="source",
        implementation_key="app.connectors.stub:StubSourceConnector",
        capabilities={},
        config_schema={
            "type": "object",
            "properties": {"api_key": {"type": "string"}},
            "required": ["api_key"],
        },
        is_enabled=True,
    )
    db_session.add(conn_def)
    db_session.flush()
    return conn_def


@pytest.fixture
def target_def(db_session):
    """Create test target connector definition."""
    conn_def = ConnectorDefinition(
        key="test_multi_target",
        display_name="Test Target",
        direction="target",
        implementation_key="app.connectors.stub:StubTargetConnector",
        capabilities={},
        config_schema={
            "type": "object",
            "properties": {"output_path": {"type": "string"}},
            "required": ["output_path"],
        },
        is_enabled=True,
    )
    db_session.add(conn_def)
    db_session.flush()
    return conn_def


class TestMultiSourceDestModels:
    """Test that multi-source/dest model infrastructure works."""

    def test_pipeline_source_creation(self, db_session, test_org, source_def):
        """Test creating PipelineSource records."""
        source_instance = ConnectorInstance(
            organization_id=test_org.organization_id,
            connector_definition_id=source_def.connector_definition_id,
            name="Source 1",
            status="active",
            config={"api_key": "test"},
        )
        db_session.add(source_instance)
        db_session.flush()

        pipeline = Pipeline(
            organization_id=test_org.organization_id,
            status="active",
        )
        db_session.add(pipeline)
        db_session.flush()

        ps = PipelineSource(
            pipeline_id=pipeline.pipeline_id,
            connector_instance_id=source_instance.connector_instance_id,
            enabled=True,
            ordering=0,
        )
        db_session.add(ps)
        db_session.commit()

        result = db_session.query(PipelineSource).filter_by(pipeline_id=pipeline.pipeline_id).all()
        assert len(result) == 1
        assert result[0].enabled is True
        assert result[0].ordering == 0

    def test_pipeline_destination_creation(self, db_session, test_org, target_def):
        """Test creating PipelineDestination records."""
        target_instance = ConnectorInstance(
            organization_id=test_org.organization_id,
            connector_definition_id=target_def.connector_definition_id,
            name="Target 1",
            status="active",
            config={"output_path": "/tmp/out"},
        )
        db_session.add(target_instance)
        db_session.flush()

        pipeline = Pipeline(
            organization_id=test_org.organization_id,
            status="active",
        )
        db_session.add(pipeline)
        db_session.flush()

        pd = PipelineDestination(
            pipeline_id=pipeline.pipeline_id,
            connector_instance_id=target_instance.connector_instance_id,
            enabled=True,
            ordering=0,
        )
        db_session.add(pd)
        db_session.commit()

        result = db_session.query(PipelineDestination).filter_by(pipeline_id=pipeline.pipeline_id).all()
        assert len(result) == 1
        assert result[0].enabled is True

    def test_run_source_step_creation(self, db_session, test_org, source_def):
        """Test creating RunSourceStep records."""
        source_instance = ConnectorInstance(
            organization_id=test_org.organization_id,
            connector_definition_id=source_def.connector_definition_id,
            name="Source Step Test",
            status="active",
            config={"api_key": "test"},
        )
        db_session.add(source_instance)
        db_session.flush()

        pipeline = Pipeline(
            organization_id=test_org.organization_id,
            status="active",
        )
        db_session.add(pipeline)
        db_session.flush()

        ps = PipelineSource(
            pipeline_id=pipeline.pipeline_id,
            connector_instance_id=source_instance.connector_instance_id,
            enabled=True,
            ordering=0,
        )
        db_session.add(ps)
        db_session.flush()

        run = Run(
            organization_id=test_org.organization_id,
            pipeline_id=pipeline.pipeline_id,
            source_connector_instance_id=source_instance.connector_instance_id,
            status="pending",
            triggered_by="api",
            parameters={},
        )
        db_session.add(run)
        db_session.flush()

        step = RunSourceStep(
            run_id=run.run_id,
            pipeline_source_id=ps.source_id,
            status="pending",
            counts={},
        )
        db_session.add(step)
        db_session.commit()

        result = db_session.query(RunSourceStep).filter_by(run_id=run.run_id).all()
        assert len(result) == 1
        assert result[0].status == "pending"
        assert result[0].counts == {}

    def test_run_destination_step_creation(self, db_session, test_org, target_def):
        """Test creating RunDestinationStep records."""
        target_instance = ConnectorInstance(
            organization_id=test_org.organization_id,
            connector_definition_id=target_def.connector_definition_id,
            name="Target Step Test",
            status="active",
            config={"output_path": "/tmp/out"},
        )
        db_session.add(target_instance)
        db_session.flush()

        pipeline = Pipeline(
            organization_id=test_org.organization_id,
            status="active",
        )
        db_session.add(pipeline)
        db_session.flush()

        pd = PipelineDestination(
            pipeline_id=pipeline.pipeline_id,
            connector_instance_id=target_instance.connector_instance_id,
            enabled=True,
            ordering=0,
        )
        db_session.add(pd)
        db_session.flush()

        run = Run(
            organization_id=test_org.organization_id,
            pipeline_id=pipeline.pipeline_id,
            target_connector_instance_id=target_instance.connector_instance_id,
            status="pending",
            triggered_by="api",
            parameters={},
        )
        db_session.add(run)
        db_session.flush()

        step = RunDestinationStep(
            run_id=run.run_id,
            pipeline_destination_id=pd.destination_id,
            status="pending",
            counts={},
        )
        db_session.add(step)
        db_session.commit()

        result = db_session.query(RunDestinationStep).filter_by(run_id=run.run_id).all()
        assert len(result) == 1
        assert result[0].status == "pending"

    def test_multiple_sources_and_destinations(self, db_session, test_org, source_def, target_def):
        """Test pipeline with multiple sources and destinations."""
        source1 = ConnectorInstance(
            organization_id=test_org.organization_id,
            connector_definition_id=source_def.connector_definition_id,
            name="Source A",
            status="active",
            config={"api_key": "a"},
        )
        source2 = ConnectorInstance(
            organization_id=test_org.organization_id,
            connector_definition_id=source_def.connector_definition_id,
            name="Source B",
            status="active",
            config={"api_key": "b"},
        )
        target1 = ConnectorInstance(
            organization_id=test_org.organization_id,
            connector_definition_id=target_def.connector_definition_id,
            name="Target A",
            status="active",
            config={"output_path": "/tmp/a"},
        )
        target2 = ConnectorInstance(
            organization_id=test_org.organization_id,
            connector_definition_id=target_def.connector_definition_id,
            name="Target B",
            status="active",
            config={"output_path": "/tmp/b"},
        )
        db_session.add_all([source1, source2, target1, target2])
        db_session.flush()

        pipeline = Pipeline(
            organization_id=test_org.organization_id,
            status="active",
        )
        db_session.add(pipeline)
        db_session.flush()

        ps1 = PipelineSource(pipeline_id=pipeline.pipeline_id, connector_instance_id=source1.connector_instance_id, enabled=True, ordering=0)
        ps2 = PipelineSource(pipeline_id=pipeline.pipeline_id, connector_instance_id=source2.connector_instance_id, enabled=True, ordering=1)
        pd1 = PipelineDestination(pipeline_id=pipeline.pipeline_id, connector_instance_id=target1.connector_instance_id, enabled=True, ordering=0)
        pd2 = PipelineDestination(pipeline_id=pipeline.pipeline_id, connector_instance_id=target2.connector_instance_id, enabled=True, ordering=1)
        db_session.add_all([ps1, ps2, pd1, pd2])
        db_session.commit()

        sources = db_session.query(PipelineSource).filter_by(pipeline_id=pipeline.pipeline_id).all()
        dests = db_session.query(PipelineDestination).filter_by(pipeline_id=pipeline.pipeline_id).all()
        assert len(sources) == 2
        assert len(dests) == 2
