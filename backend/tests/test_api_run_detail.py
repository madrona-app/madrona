"""
Tests for Run Detail API with source/destination steps.

Verifies GET /api/organizations/{org_id}/runs/{run_id} includes:
- sources array with step details
- destinations array with step details
- run_status computed field (succeeded|partial|failed)

Uses the auth_setup fixture from conftest.py for authenticated requests.
"""
import pytest
from uuid import uuid4
from datetime import datetime, timezone

from app.models import (
    Run, Pipeline, PipelineSource,
    RunSourceStep, ConnectorInstance,
    ConnectorDefinition, Dataset,
)


@pytest.fixture
def pipeline_infra(db_session, auth_setup):
    """Create pipeline infrastructure needed for run tests.

    Returns dict with connector_def, source1, source2, dataset, pipeline, ps1, ps2.
    """
    _, org, _ = auth_setup

    # Connector definition
    conn_def = ConnectorDefinition(
        key="test_connector_run",
        display_name="Test Connector",
        direction="source",
        implementation_key="app.connectors.test:TestConnector",
        capabilities={},
        config_schema={},
        is_enabled=True,
    )
    db_session.add(conn_def)
    db_session.flush()

    # Connector instances (two sources)
    source1 = ConnectorInstance(
        organization_id=org.organization_id,
        connector_definition_id=conn_def.connector_definition_id,
        name="Source 1",
        status="active",
        config={},
    )
    source2 = ConnectorInstance(
        organization_id=org.organization_id,
        connector_definition_id=conn_def.connector_definition_id,
        name="Source 2",
        status="active",
        config={},
    )
    db_session.add_all([source1, source2])
    db_session.flush()

    # Dataset
    dataset = Dataset(
        organization_id=org.organization_id,
        name="Test Dataset Run",
        key="test_dataset_run",
    )
    db_session.add(dataset)
    db_session.flush()

    # Pipeline (no source_connector_instance_id field; uses pipeline_sources)
    pipeline = Pipeline(
        organization_id=org.organization_id,
        dataset_id=dataset.dataset_id,
        status="active",
    )
    db_session.add(pipeline)
    db_session.flush()

    # Pipeline sources
    ps1 = PipelineSource(
        pipeline_id=pipeline.pipeline_id,
        connector_instance_id=source1.connector_instance_id,
        enabled=True,
        parameters={},
        ordering=0,
    )
    ps2 = PipelineSource(
        pipeline_id=pipeline.pipeline_id,
        connector_instance_id=source2.connector_instance_id,
        enabled=True,
        parameters={},
        ordering=1,
    )
    db_session.add_all([ps1, ps2])
    db_session.commit()

    return {
        "conn_def": conn_def,
        "source1": source1,
        "source2": source2,
        "dataset": dataset,
        "pipeline": pipeline,
        "ps1": ps1,
        "ps2": ps2,
    }


class TestRunDetailSources:
    """Tests for GET /api/organizations/{org_id}/runs/{run_id} with sources."""

    def test_run_detail_includes_sources_array(
        self, auth_setup, db_session, pipeline_infra
    ):
        """Test GET /runs/{run_id} includes sources array with step details."""
        auth_client, org, user = auth_setup
        now = datetime.now(timezone.utc)
        infra = pipeline_infra

        # Create run
        run = Run(
            organization_id=org.organization_id,
            pipeline_id=infra["pipeline"].pipeline_id,
            status="success",
            started_at=now,
            finished_at=now,
            processed_count=20,
            created_count=10,
            updated_count=5,
            skipped_count=3,
            failed_count=2,
            triggered_by="manual",
            parameters={},
        )
        db_session.add(run)
        db_session.flush()

        # Create source steps
        step1 = RunSourceStep(
            run_id=run.run_id,
            pipeline_source_id=infra["ps1"].source_id,
            status="success",
            counts={"extracted": 10},
            started_at=now,
            finished_at=now,
        )
        step2 = RunSourceStep(
            run_id=run.run_id,
            pipeline_source_id=infra["ps2"].source_id,
            status="success",
            counts={"extracted": 20},
            started_at=now,
            finished_at=now,
        )
        db_session.add_all([step1, step2])
        db_session.commit()

        # Call API
        response = auth_client.get(
            f"/api/organizations/{org.organization_id}/runs/{run.run_id}"
        )

        assert response.status_code == 200
        data = response.get_json()

        # Verify sources array
        assert "sources" in data
        assert len(data["sources"]) == 2

        source1_data = data["sources"][0]
        assert "step_id" in source1_data
        assert "pipeline_source_id" in source1_data
        assert "connector_instance_id" in source1_data
        assert source1_data["status"] == "success"
        assert "started_at" in source1_data
        assert "finished_at" in source1_data
        assert source1_data["error"] is None


class TestRunStatusComputed:
    """Tests for computed run_status field."""

    def test_run_status_succeeded_all_success(
        self, auth_setup, db_session, pipeline_infra
    ):
        """Test run_status = 'succeeded' when all steps succeed."""
        auth_client, org, user = auth_setup
        now = datetime.now(timezone.utc)
        infra = pipeline_infra

        run = Run(
            organization_id=org.organization_id,
            pipeline_id=infra["pipeline"].pipeline_id,
            status="success",
            started_at=now,
            finished_at=now,
            processed_count=10,
            created_count=10,
            updated_count=0,
            skipped_count=0,
            failed_count=0,
            triggered_by="manual",
            parameters={},
        )
        db_session.add(run)
        db_session.flush()

        step = RunSourceStep(
            run_id=run.run_id,
            pipeline_source_id=infra["ps1"].source_id,
            status="success",
            counts={},
            started_at=now,
            finished_at=now,
        )
        db_session.add(step)
        db_session.commit()

        response = auth_client.get(
            f"/api/organizations/{org.organization_id}/runs/{run.run_id}"
        )

        assert response.status_code == 200
        data = response.get_json()
        assert data["run_status"] == "succeeded"

    def test_run_status_partial_some_failed(
        self, auth_setup, db_session, pipeline_infra
    ):
        """Test run_status = 'partial' when some steps fail but not all."""
        auth_client, org, user = auth_setup
        now = datetime.now(timezone.utc)
        infra = pipeline_infra

        run = Run(
            organization_id=org.organization_id,
            pipeline_id=infra["pipeline"].pipeline_id,
            status="success",
            started_at=now,
            finished_at=now,
            processed_count=10,
            created_count=10,
            updated_count=0,
            skipped_count=0,
            failed_count=0,
            triggered_by="manual",
            parameters={},
        )
        db_session.add(run)
        db_session.flush()

        # First source succeeds, second fails
        step1 = RunSourceStep(
            run_id=run.run_id,
            pipeline_source_id=infra["ps1"].source_id,
            status="success",
            counts={"extracted": 10},
            started_at=now,
            finished_at=now,
        )
        step2 = RunSourceStep(
            run_id=run.run_id,
            pipeline_source_id=infra["ps2"].source_id,
            status="failed",
            counts={},
            error="Connection timeout",
            started_at=now,
            finished_at=now,
        )
        db_session.add_all([step1, step2])
        db_session.commit()

        response = auth_client.get(
            f"/api/organizations/{org.organization_id}/runs/{run.run_id}"
        )

        assert response.status_code == 200
        data = response.get_json()
        assert data["run_status"] == "partial"

    def test_run_status_failed_all_failed(
        self, auth_setup, db_session, pipeline_infra
    ):
        """Test run_status = 'failed' when all steps fail."""
        auth_client, org, user = auth_setup
        now = datetime.now(timezone.utc)
        infra = pipeline_infra

        run = Run(
            organization_id=org.organization_id,
            pipeline_id=infra["pipeline"].pipeline_id,
            status="failed",
            started_at=now,
            finished_at=now,
            processed_count=0,
            created_count=0,
            updated_count=0,
            skipped_count=0,
            failed_count=10,
            triggered_by="manual",
            parameters={},
        )
        db_session.add(run)
        db_session.flush()

        step1 = RunSourceStep(
            run_id=run.run_id,
            pipeline_source_id=infra["ps1"].source_id,
            status="failed",
            counts={},
            error="Connection refused",
            started_at=now,
            finished_at=now,
        )
        step2 = RunSourceStep(
            run_id=run.run_id,
            pipeline_source_id=infra["ps2"].source_id,
            status="failed",
            counts={},
            error="Timeout",
            started_at=now,
            finished_at=now,
        )
        db_session.add_all([step1, step2])
        db_session.commit()

        response = auth_client.get(
            f"/api/organizations/{org.organization_id}/runs/{run.run_id}"
        )

        assert response.status_code == 200
        data = response.get_json()
        assert data["run_status"] == "failed"


class TestRunDetailAuth:
    """Tests for authentication on run detail endpoint."""

    def test_requires_auth(self, client):
        """Test that run detail requires authentication."""
        response = client.get(
            f"/api/organizations/{uuid4()}/runs/{uuid4()}"
        )
        assert response.status_code == 401

    def test_run_not_found(self, auth_setup):
        """Test 404 for non-existent run."""
        auth_client, org, user = auth_setup

        response = auth_client.get(
            f"/api/organizations/{org.organization_id}/runs/{uuid4()}"
        )
        assert response.status_code == 404
