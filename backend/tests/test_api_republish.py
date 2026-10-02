"""
Tests for POST /api/organizations/<org_id>/runs/<run_id>/republish endpoint.

Covers republish functionality, conflict detection, and status validation.
"""

import pytest
from unittest.mock import patch, MagicMock
from uuid import uuid4

from app.models import (
    Run, Pipeline, PipelineSource,
    ConnectorDefinition, ConnectorInstance,
)


@pytest.fixture
def republish_pipeline(auth_setup, db_session):
    """Create a pipeline in the auth_setup org for republish tests."""
    _, org, _ = auth_setup

    source_def = ConnectorDefinition(
        key="repub_src",
        display_name="Republish Source",
        direction="source",
        implementation_key="test.source:RepubSource",
        capabilities={},
        config_schema={},
        is_enabled=True,
    )
    db_session.add(source_def)
    db_session.flush()

    source_inst = ConnectorInstance(
        organization_id=org.organization_id,
        connector_definition_id=source_def.connector_definition_id,
        name="Republish Source Instance",
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


class TestRepublishRun:
    """Tests for POST /api/organizations/<org_id>/runs/<run_id>/republish."""

    def test_republish_run_conflict_while_running(self, auth_setup, db_session, republish_pipeline):
        """Republish returns 409 when run status is 'running'."""
        auth_client, org, user = auth_setup

        run = Run(
            organization_id=org.organization_id,
            pipeline_id=republish_pipeline.pipeline_id,
            status="running",
            triggered_by="api",
            parameters={},
        )
        db_session.add(run)
        db_session.commit()

        # Patch where the function is imported/used, not where it's defined
        with patch("app.fastapi_app.routers.runs.republish_run") as mock_republish:
            from app.services.pipeline import RunConflictError
            mock_republish.side_effect = RunConflictError("Run is currently running")

            resp = auth_client.post(
                f"/api/organizations/{org.organization_id}/runs/{run.run_id}/republish"
            )

        assert resp.status_code == 409
        data = resp.get_json()
        assert "error" in data

    def test_republish_run_invalid_status(self, auth_setup, db_session, republish_pipeline):
        """Republish returns 400 when run status is not republishable."""
        auth_client, org, user = auth_setup

        run = Run(
            organization_id=org.organization_id,
            pipeline_id=republish_pipeline.pipeline_id,
            status="success",
            triggered_by="api",
            parameters={},
        )
        db_session.add(run)
        db_session.commit()

        with patch("app.fastapi_app.routers.runs.republish_run") as mock_republish:
            from app.services.pipeline import PipelineError
            mock_republish.side_effect = PipelineError("Run is not in a republishable state")

            resp = auth_client.post(
                f"/api/organizations/{org.organization_id}/runs/{run.run_id}/republish"
            )

        assert resp.status_code in (400, 422)
        data = resp.get_json()
        assert "error" in data

    def test_republish_run_not_found(self, auth_setup):
        """Republish returns 404 when run doesn't exist."""
        auth_client, org, user = auth_setup
        fake_id = str(uuid4())

        resp = auth_client.post(
            f"/api/organizations/{org.organization_id}/runs/{fake_id}/republish"
        )

        assert resp.status_code == 404
        data = resp.get_json()
        assert data.get("error", {}).get("code") in ("not_found", "run_not_found")

    def test_republish_run_success(self, auth_setup, db_session, republish_pipeline):
        """Republish returns 200 on successful republish."""
        auth_client, org, user = auth_setup

        # Create run with a republishable status
        run = Run(
            organization_id=org.organization_id,
            pipeline_id=republish_pipeline.pipeline_id,
            status="failed_publish",
            triggered_by="api",
            parameters={},
            processed_count=10,
            created_count=10,
        )
        db_session.add(run)
        db_session.commit()

        with patch("app.fastapi_app.routers.runs.republish_run") as mock_republish:
            from app.services.pipeline import RunResult
            mock_republish.return_value = RunResult(
                run_id=run.run_id,
                status="success",
                duration_ms=500,
                counts={"created": 10, "updated": 0, "noop": 0},
                target_url=None,
            )

            # The mock intercepts the call, but the endpoint reloads the
            # run from DB after the mock returns. Update status so the
            # serialized response reflects "success".
            run.status = "success"
            db_session.commit()

            resp = auth_client.post(
                f"/api/organizations/{org.organization_id}/runs/{run.run_id}/republish"
            )

        assert resp.status_code == 200
        data = resp.get_json()
        assert data["run_id"] == str(run.run_id)
        assert data["status"] == "success"
