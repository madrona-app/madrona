"""
Tests for runs API endpoints.

Tests CRUD operations on runs via the authenticated API.
All endpoints are scoped to /organizations/<org_id>/runs.
"""

import pytest
from datetime import datetime, timezone, UTC
from uuid import uuid4

from app.models import (
    Run, Pipeline, PipelineSource, PipelineDestination,
    ConnectorDefinition, ConnectorInstance,
)


@pytest.fixture
def org_pipeline(auth_setup, db_session):
    """Create a pipeline that belongs to the auth_setup organization.

    org_pipeline belongs to demo_tenant's org, which is different from
    auth_setup's org. API endpoints filter by organization_id so the
    pipeline must belong to the same org as the authenticated user.
    """
    _, org, _ = auth_setup

    source_def = ConnectorDefinition(
        key="runs_test_src",
        display_name="Runs Test Source",
        direction="source",
        implementation_key="test.source:RunsTestSource",
        capabilities={},
        config_schema={},
        is_enabled=True,
    )
    db_session.add(source_def)
    db_session.flush()

    source_inst = ConnectorInstance(
        organization_id=org.organization_id,
        connector_definition_id=source_def.connector_definition_id,
        name="Runs Test Source Instance",
        status="active",
        config={},
    )
    db_session.add(source_inst)
    db_session.flush()

    pipeline = Pipeline(
        organization_id=org.organization_id,
        status="active",
    )
    db_session.add(pipeline)
    db_session.flush()

    ps = PipelineSource(
        pipeline_id=pipeline.pipeline_id,
        connector_instance_id=source_inst.connector_instance_id,
        enabled=True,
        parameters={},
        ordering=0,
    )
    db_session.add(ps)
    db_session.commit()
    return pipeline


class TestGetRun:
    """Tests for GET /api/organizations/<org_id>/runs/<run_id> endpoint."""

    def test_get_run_success(self, auth_setup, db_session, org_pipeline):
        """Test successfully retrieving a run with all fields."""
        auth_client, org, user = auth_setup

        run = Run(
            organization_id=org.organization_id,
            pipeline_id=org_pipeline.pipeline_id,
            status="success",
            started_at=datetime(2026, 1, 4, 10, 0, 0, tzinfo=timezone.utc),
            published_at=datetime(2026, 1, 4, 10, 0, 5, tzinfo=timezone.utc),
            finished_at=datetime(2026, 1, 4, 10, 0, 6, tzinfo=timezone.utc),
            duration_ms=6234,
            triggered_by="api",
            parameters={},
            processed_count=100,
            created_count=50,
            updated_count=30,
            skipped_count=20,
            failed_count=0,
        )
        db_session.add(run)
        db_session.commit()

        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/runs/{run.run_id}"
        )

        assert resp.status_code == 200
        data = resp.get_json()
        assert data["run_id"] == str(run.run_id)
        assert data["pipeline_id"] == str(org_pipeline.pipeline_id)
        assert data["status"] == "success"
        assert data["duration_ms"] == 6234
        assert data["counts"]["processed"] == 100
        assert data["counts"]["created"] == 50
        assert data["counts"]["updated"] == 30

    def test_get_run_pending_has_null_timestamps(self, auth_setup, db_session, org_pipeline):
        """Test retrieving a pending run with null timing fields."""
        auth_client, org, user = auth_setup

        run = Run(
            organization_id=org.organization_id,
            pipeline_id=org_pipeline.pipeline_id,
            status="pending",
            triggered_by="api",
            parameters={},
        )
        db_session.add(run)
        db_session.commit()

        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/runs/{run.run_id}"
        )

        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "pending"
        assert data["started_at"] is None
        assert data["published_at"] is None
        assert data["finished_at"] is None

    def test_get_run_not_found(self, auth_setup):
        """Test 404 when run doesn't exist."""
        auth_client, org, user = auth_setup
        fake_id = str(uuid4())

        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/runs/{fake_id}"
        )

        assert resp.status_code == 404
        data = resp.get_json()
        assert data.get("error", {}).get("code") in ("not_found", "run_not_found")

    def test_get_run_with_error_fields(self, auth_setup, db_session, org_pipeline):
        """Test that error fields are returned for failed runs."""
        auth_client, org, user = auth_setup

        error_time = datetime.now(UTC)
        run = Run(
            organization_id=org.organization_id,
            pipeline_id=org_pipeline.pipeline_id,
            status="failed",
            triggered_by="api",
            parameters={},
            error="Connection timeout while fetching data",
            error_stage="extract",
            error_at=error_time,
        )
        db_session.add(run)
        db_session.commit()

        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/runs/{run.run_id}"
        )

        assert resp.status_code == 200
        data = resp.get_json()
        _e = data["error"]
        assert (_e.get("message") if isinstance(_e, dict) else _e) == "Connection timeout while fetching data"
        assert data["error_stage"] == "extract"
        assert data["error_at"] is not None
        assert data["status"] == "failed"

    def test_get_run_success_has_null_error_fields(self, auth_setup, db_session, org_pipeline):
        """Test that successful runs have null error fields."""
        auth_client, org, user = auth_setup

        run = Run(
            organization_id=org.organization_id,
            pipeline_id=org_pipeline.pipeline_id,
            status="success",
            triggered_by="api",
            parameters={},
        )
        db_session.add(run)
        db_session.commit()

        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/runs/{run.run_id}"
        )

        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "success"
        assert data["error"] is None
        assert data["error_stage"] is None
        assert data["error_at"] is None

    def test_get_run_includes_steps(self, auth_setup, db_session, org_pipeline):
        """Test that GET run includes sources/destinations arrays from steps."""
        auth_client, org, user = auth_setup

        run = Run(
            organization_id=org.organization_id,
            pipeline_id=org_pipeline.pipeline_id,
            status="success",
            triggered_by="api",
            parameters={},
        )
        db_session.add(run)
        db_session.commit()

        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/runs/{run.run_id}"
        )

        assert resp.status_code == 200
        data = resp.get_json()
        # With include_steps=True, response should include sources and destinations arrays
        assert "sources" in data
        assert "destinations" in data
        assert isinstance(data["sources"], list)
        assert isinstance(data["destinations"], list)


class TestListRuns:
    """Tests for GET /api/organizations/<org_id>/runs endpoint."""

    def test_list_runs_default(self, auth_setup, db_session, org_pipeline):
        """Test listing runs with default parameters."""
        auth_client, org, user = auth_setup

        for i in range(3):
            run = Run(
                organization_id=org.organization_id,
                pipeline_id=org_pipeline.pipeline_id,
                status="success",
                triggered_by="api",
                parameters={},
                processed_count=10 * (i + 1),
                created_count=5 * (i + 1),
            )
            db_session.add(run)
        db_session.commit()

        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/runs"
        )

        assert resp.status_code == 200
        data = resp.get_json()
        assert "items" in data
        assert "limit" in data
        assert "total" in data
        assert data["limit"] == 50
        assert len(data["items"]) == 3
        assert data["total"] == 3

    def test_list_runs_with_limit(self, auth_setup, db_session, org_pipeline):
        """Test listing runs with custom limit."""
        auth_client, org, user = auth_setup

        for i in range(5):
            run = Run(
                organization_id=org.organization_id,
                pipeline_id=org_pipeline.pipeline_id,
                status="success",
                triggered_by="api",
                parameters={},
            )
            db_session.add(run)
        db_session.commit()

        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/runs?limit=2"
        )

        assert resp.status_code == 200
        data = resp.get_json()
        assert data["limit"] == 2
        assert len(data["items"]) == 2
        assert data["total"] == 5
        assert len(data["items"]) == 2

    def test_list_runs_filter_by_status(self, auth_setup, db_session, org_pipeline):
        """Test filtering runs by status."""
        auth_client, org, user = auth_setup

        run_success = Run(
            organization_id=org.organization_id,
            pipeline_id=org_pipeline.pipeline_id,
            status="success",
            triggered_by="api",
            parameters={},
        )
        run_failed = Run(
            organization_id=org.organization_id,
            pipeline_id=org_pipeline.pipeline_id,
            status="failed",
            triggered_by="api",
            parameters={},
        )
        db_session.add_all([run_success, run_failed])
        db_session.commit()

        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/runs?status=failed"
        )

        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data["items"]) == 1
        assert data["items"][0]["status"] == "failed"
        assert data["items"][0]["run_id"] == str(run_failed.run_id)

    def test_list_runs_filter_by_pipeline(self, auth_setup, db_session, org_pipeline):
        """Test filtering runs by pipeline_id."""
        auth_client, org, user = auth_setup

        run_in = Run(
            organization_id=org.organization_id,
            pipeline_id=org_pipeline.pipeline_id,
            status="success",
            triggered_by="api",
            parameters={},
        )
        run_out = Run(
            organization_id=org.organization_id,
            pipeline_id=None,
            status="success",
            triggered_by="api",
            parameters={},
        )
        db_session.add_all([run_in, run_out])
        db_session.commit()

        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/runs?pipeline_id={org_pipeline.pipeline_id}"
        )

        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data["items"]) == 1
        assert data["items"][0]["pipeline_id"] == str(org_pipeline.pipeline_id)

    def test_list_runs_empty_results(self, auth_setup):
        """Test listing runs when none exist."""
        auth_client, org, user = auth_setup

        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/runs"
        )

        assert resp.status_code == 200
        data = resp.get_json()
        assert data["items"] == []
        assert len(data["items"]) == 0

    def test_list_runs_invalid_limit(self, auth_setup):
        """Test error when limit is invalid."""
        auth_client, org, user = auth_setup

        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/runs?limit=abc"
        )
        assert resp.status_code in (400, 422)
        # FastAPI 422 returns {"detail": [...]}; our normalized envelope uses {"error": {...}}.
        # Either is acceptable as a signal of validation failure.

        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/runs?limit=0"
        )
        assert resp.status_code in (400, 422)

        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/runs?limit=300"
        )
        assert resp.status_code in (400, 422)

    def test_list_runs_with_offset(self, auth_setup, db_session, org_pipeline):
        """Test offset pagination."""
        auth_client, org, user = auth_setup

        for i in range(5):
            run = Run(
                organization_id=org.organization_id,
                pipeline_id=org_pipeline.pipeline_id,
                status="success",
                triggered_by="api",
                parameters={},
            )
            db_session.add(run)
        db_session.commit()

        resp1 = auth_client.get(
            f"/api/organizations/{org.organization_id}/runs?limit=2&offset=0"
        )
        assert resp1.status_code == 200
        data1 = resp1.get_json()
        assert len(data1["items"]) == 2
        assert data1["total"] == 5

        resp2 = auth_client.get(
            f"/api/organizations/{org.organization_id}/runs?limit=2&offset=2"
        )
        assert resp2.status_code == 200
        data2 = resp2.get_json()
        assert len(data2["items"]) == 2
        assert data2["offset"] == 2

        # No overlap
        page1_ids = {r["run_id"] for r in data1["items"]}
        page2_ids = {r["run_id"] for r in data2["items"]}
        assert len(page1_ids & page2_ids) == 0

    def test_list_runs_invalid_offset(self, auth_setup):
        """Test error when offset is invalid."""
        auth_client, org, user = auth_setup

        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/runs?offset=-1"
        )
        assert resp.status_code in (400, 422)

        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/runs?offset=abc"
        )
        assert resp.status_code in (400, 422)

    def test_list_runs_response_shape(self, auth_setup, db_session, org_pipeline):
        """Test that response has expected shape."""
        auth_client, org, user = auth_setup

        run = Run(
            organization_id=org.organization_id,
            pipeline_id=org_pipeline.pipeline_id,
            status="success",
            triggered_by="api",
            parameters={},
        )
        db_session.add(run)
        db_session.commit()

        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/runs"
        )

        assert resp.status_code == 200
        data = resp.get_json()

        # Top-level keys
        assert "items" in data
        assert "limit" in data
        assert "offset" in data
        assert "total" in data

        # Run object shape
        run_obj = data["items"][0]
        assert "run_id" in run_obj
        assert "pipeline_id" in run_obj
        assert "status" in run_obj
        assert "counts" in run_obj


class TestCreateRun:
    """Tests for POST /api/organizations/<org_id>/runs endpoint."""

    @pytest.mark.skip(reason="Route commit pattern invalidates the test's savepoint (InvalidSavepointSpecification); session-management fix needed")
    def test_create_run_success(self, auth_setup, db_session, org_pipeline):
        """Test successfully creating a run."""
        auth_client, org, user = auth_setup

        resp = auth_client.post(
            f"/api/organizations/{org.organization_id}/runs",
            json={
                "pipeline_id": str(org_pipeline.pipeline_id),
                "triggered_by": "manual",
                "parameters": {"test": "value"},
            },
        )

        assert resp.status_code == 201
        data = resp.get_json()
        assert data["pipeline_id"] == str(org_pipeline.pipeline_id)
        assert data["organization_id"] == str(org.organization_id)
        assert data["status"] == "pending"
        assert data["triggered_by"] == "manual"
        assert "run_id" in data
        assert "created_at" in data

    @pytest.mark.skip(reason="Route commit pattern invalidates the test's savepoint (InvalidSavepointSpecification); session-management fix needed")
    def test_create_run_with_defaults(self, auth_setup, db_session, org_pipeline):
        """Test creating a run with default values for optional fields."""
        auth_client, org, user = auth_setup

        resp = auth_client.post(
            f"/api/organizations/{org.organization_id}/runs",
            json={"pipeline_id": str(org_pipeline.pipeline_id)},
        )

        assert resp.status_code == 201
        data = resp.get_json()
        assert data["triggered_by"] == "api"
        assert data["status"] == "pending"

    def test_create_run_missing_pipeline_id(self, auth_setup):
        """Test error when pipeline_id is missing."""
        auth_client, org, user = auth_setup

        resp = auth_client.post(
            f"/api/organizations/{org.organization_id}/runs",
            json={},
        )

        assert resp.status_code in (400, 422)

    def test_create_run_pipeline_not_found(self, auth_setup):
        """Test error when pipeline doesn't exist."""
        auth_client, org, user = auth_setup
        fake_id = str(uuid4())

        resp = auth_client.post(
            f"/api/organizations/{org.organization_id}/runs",
            json={"pipeline_id": fake_id},
        )

        assert resp.status_code == 404
        data = resp.get_json()
        assert data.get("error", {}).get("code") in ("not_found", "pipeline_not_found")

    def test_create_run_missing_body(self, auth_setup):
        """Test error when request body is missing."""
        auth_client, org, user = auth_setup

        resp = auth_client.post(
            f"/api/organizations/{org.organization_id}/runs",
            content_type="application/json",
        )

        assert resp.status_code in (400, 422)


class TestDeleteRun:
    """Tests for DELETE /api/organizations/<org_id>/runs/<run_id> endpoint."""

    def test_delete_run_success(self, auth_setup, db_session, org_pipeline):
        """Test successfully deleting a completed run."""
        auth_client, org, user = auth_setup

        run = Run(
            organization_id=org.organization_id,
            pipeline_id=org_pipeline.pipeline_id,
            status="success",
            triggered_by="api",
            parameters={},
        )
        db_session.add(run)
        db_session.commit()
        run_id = run.run_id

        resp = auth_client.delete(
            f"/api/organizations/{org.organization_id}/runs/{run_id}"
        )

        assert resp.status_code == 204

        # Verify run is deleted
        deleted = db_session.query(Run).filter_by(run_id=run_id).first()
        assert deleted is None

    def test_delete_run_not_found(self, auth_setup):
        """Test 404 when run doesn't exist."""
        auth_client, org, user = auth_setup
        fake_id = str(uuid4())

        resp = auth_client.delete(
            f"/api/organizations/{org.organization_id}/runs/{fake_id}"
        )

        assert resp.status_code == 404

    def test_delete_run_in_progress_rejected(self, auth_setup, db_session, org_pipeline):
        """Test that running runs cannot be deleted."""
        auth_client, org, user = auth_setup

        run = Run(
            organization_id=org.organization_id,
            pipeline_id=org_pipeline.pipeline_id,
            status="running",
            triggered_by="api",
            parameters={},
        )
        db_session.add(run)
        db_session.commit()

        resp = auth_client.delete(
            f"/api/organizations/{org.organization_id}/runs/{run.run_id}"
        )

        assert resp.status_code == 409
        data = resp.get_json()
        assert data.get("error", {}).get("code") == "run_in_progress"
