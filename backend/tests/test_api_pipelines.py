"""
Smoke tests for the pipelines API endpoints.

Covers CRUD operations on pipelines via the authenticated API.
Endpoints are at /api/pipelines (list/create/update/delete)
and /api/organizations/<org_id>/pipelines/<pipeline_id> (get by ID).
"""

import pytest
from uuid import uuid4

from app.models import (
    Pipeline, PipelineSource, PipelineDestination,
    ConnectorDefinition, ConnectorInstance,
)


@pytest.fixture
def org_connector(auth_setup, db_session):
    """Create a connector instance belonging to the auth_setup organization.

    Returns (source_instance, target_instance) for creating pipelines.
    """
    _, org, _ = auth_setup

    source_def = ConnectorDefinition(
        key="pipe_test_src",
        display_name="Pipe Test Source",
        direction="source",
        implementation_key="test.source:PipeTestSource",
        capabilities={},
        config_schema={},
        is_enabled=True,
    )
    target_def = ConnectorDefinition(
        key="pipe_test_tgt",
        display_name="Pipe Test Target",
        direction="target",
        implementation_key="test.target:PipeTestTarget",
        capabilities={},
        config_schema={},
        is_enabled=True,
    )
    db_session.add_all([source_def, target_def])
    db_session.flush()

    source_inst = ConnectorInstance(
        organization_id=org.organization_id,
        connector_definition_id=source_def.connector_definition_id,
        name="Pipe Test Source Instance",
        status="active",
        config={},
    )
    target_inst = ConnectorInstance(
        organization_id=org.organization_id,
        connector_definition_id=target_def.connector_definition_id,
        name="Pipe Test Target Instance",
        status="active",
        config={},
    )
    db_session.add_all([source_inst, target_inst])
    db_session.commit()
    return source_inst, target_inst


@pytest.fixture
def org_pipeline(auth_setup, db_session, org_connector):
    """Create a pipeline with source and destination for the auth org."""
    _, org, _ = auth_setup
    source_inst, target_inst = org_connector

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
    pd = PipelineDestination(
        pipeline_id=pipeline.pipeline_id,
        connector_instance_id=target_inst.connector_instance_id,
        enabled=True,
        parameters={},
        ordering=0,
    )
    db_session.add_all([ps, pd])
    db_session.commit()
    return pipeline


class TestListPipelines:
    """Tests for GET /api/pipelines."""

    def test_list_pipelines_empty(self, auth_setup, db_session):
        """List pipelines returns empty array when none exist."""
        auth_client, org, _ = auth_setup

        resp = auth_client.get(
            f"/api/pipelines?organization_id={org.organization_id}"
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert isinstance(data, list)
        assert len(data) == 0

    def test_list_pipelines_returns_existing(self, auth_setup, db_session, org_pipeline):
        """List pipelines returns the pipeline we created."""
        auth_client, org, _ = auth_setup

        resp = auth_client.get(
            f"/api/pipelines?organization_id={org.organization_id}"
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data) == 1
        assert data[0]["pipeline_id"] == str(org_pipeline.pipeline_id)
        assert data[0]["status"] == "active"
        assert "sources" in data[0]
        assert "destinations" in data[0]


class TestCreatePipeline:
    """Tests for POST /api/pipelines."""

    def test_create_pipeline_success(self, auth_setup, db_session, org_connector):
        """Create a pipeline with source and destination."""
        auth_client, org, _ = auth_setup
        source_inst, target_inst = org_connector

        payload = {
            "organization_id": str(org.organization_id),
            "sources": [
                {
                    "connector_instance_id": str(source_inst.connector_instance_id),
                    "enabled": True,
                    "parameters": {},
                }
            ],
            "destinations": [
                {
                    "connector_instance_id": str(target_inst.connector_instance_id),
                    "enabled": True,
                    "parameters": {},
                }
            ],
        }
        resp = auth_client.post(
            "/api/pipelines",
            json=payload,
            content_type="application/json",
        )
        assert resp.status_code == 201
        data = resp.get_json()
        assert "pipeline_id" in data
        assert data["organization_id"] == str(org.organization_id)
        assert data["status"] == "active"
        assert len(data["sources"]) == 1
        assert len(data["destinations"]) == 1

    def test_create_pipeline_source_only(self, auth_setup, db_session, org_connector):
        """Create a pipeline with source only (data warehouse pattern)."""
        auth_client, org, _ = auth_setup
        source_inst, _ = org_connector

        payload = {
            "organization_id": str(org.organization_id),
            "sources": [
                {
                    "connector_instance_id": str(source_inst.connector_instance_id),
                    "enabled": True,
                    "parameters": {"batch_size": 100},
                }
            ],
        }
        resp = auth_client.post(
            "/api/pipelines",
            json=payload,
            content_type="application/json",
        )
        assert resp.status_code == 201
        data = resp.get_json()
        assert len(data["sources"]) == 1
        assert data["destinations"] == []
        assert data["sources"][0]["parameters"] == {"batch_size": 100}

    def test_create_pipeline_missing_sources(self, auth_setup, db_session):
        """Create pipeline without sources returns 400."""
        auth_client, org, _ = auth_setup

        payload = {
            "organization_id": str(org.organization_id),
        }
        resp = auth_client.post(
            "/api/pipelines",
            json=payload,
            content_type="application/json",
        )
        assert resp.status_code in (400, 422)

    def test_create_pipeline_empty_sources(self, auth_setup, db_session):
        """Create pipeline with empty sources array returns 400."""
        auth_client, org, _ = auth_setup

        payload = {
            "organization_id": str(org.organization_id),
            "sources": [],
        }
        resp = auth_client.post(
            "/api/pipelines",
            json=payload,
            content_type="application/json",
        )
        assert resp.status_code in (400, 422)


class TestGetPipeline:
    """Tests for GET /api/organizations/<org_id>/pipelines/<pipeline_id>."""

    def test_get_pipeline_success(self, auth_setup, db_session, org_pipeline):
        """Get an existing pipeline by ID."""
        auth_client, org, _ = auth_setup

        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/pipelines/{org_pipeline.pipeline_id}"
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["pipeline_id"] == str(org_pipeline.pipeline_id)
        assert data["status"] == "active"
        assert len(data["sources"]) == 1
        assert len(data["destinations"]) == 1

    def test_get_pipeline_response_shape(self, auth_setup, db_session, org_pipeline):
        """Verify response includes all expected keys."""
        auth_client, org, _ = auth_setup

        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/pipelines/{org_pipeline.pipeline_id}"
        )
        assert resp.status_code == 200
        data = resp.get_json()

        expected_keys = {
            "pipeline_id", "organization_id", "name", "sources",
            "destinations", "dataset_id", "status", "created_at",
        }
        assert expected_keys.issubset(data.keys()), (
            f"Missing keys: {expected_keys - data.keys()}"
        )

        # Verify source shape
        source = data["sources"][0]
        assert "source_id" in source
        assert "connector_instance_id" in source
        assert "enabled" in source
        assert "parameters" in source
        assert "ordering" in source

        # Verify destination shape
        dest = data["destinations"][0]
        assert "destination_id" in dest
        assert "connector_instance_id" in dest
        assert "enabled" in dest

    def test_get_pipeline_not_found(self, auth_setup, db_session):
        """Get a non-existent pipeline returns 404."""
        auth_client, org, _ = auth_setup
        fake_id = uuid4()

        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/pipelines/{fake_id}"
        )
        assert resp.status_code == 404


class TestUpdatePipeline:
    """Tests for PATCH /api/pipelines/<pipeline_id>."""

    def test_update_pipeline_no_data(self, auth_setup, db_session, org_pipeline):
        """Update with empty body returns 400."""
        auth_client, org, _ = auth_setup

        resp = auth_client.patch(
            f"/api/pipelines/{org_pipeline.pipeline_id}",
            data="",
            content_type="application/json",
        )
        assert resp.status_code in (400, 422)

    def test_update_pipeline_not_found(self, auth_setup, db_session):
        """Update a non-existent pipeline returns 404."""
        auth_client, org, _ = auth_setup
        fake_id = uuid4()

        resp = auth_client.patch(
            f"/api/pipelines/{fake_id}",
            json={
                "organization_id": str(org.organization_id),
                "status": "paused",
            },
            content_type="application/json",
        )
        assert resp.status_code == 404


class TestDeletePipeline:
    """Tests for DELETE /api/pipelines/<pipeline_id>."""

    def test_delete_pipeline_success(self, auth_setup, db_session, org_pipeline):
        """Delete a pipeline returns 204 and removes it."""
        auth_client, org, _ = auth_setup

        resp = auth_client.delete(
            f"/api/pipelines/{org_pipeline.pipeline_id}"
            f"?organization_id={org.organization_id}"
        )
        assert resp.status_code == 204

        # Confirm it is gone
        get_resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/pipelines/{org_pipeline.pipeline_id}"
        )
        assert get_resp.status_code == 404

    def test_delete_pipeline_not_found(self, auth_setup, db_session):
        """Delete a non-existent pipeline returns 404."""
        auth_client, org, _ = auth_setup
        fake_id = uuid4()

        resp = auth_client.delete(
            f"/api/pipelines/{fake_id}?organization_id={org.organization_id}"
        )
        assert resp.status_code == 404


class TestPipelineAuthRequired:
    """Tests that unauthenticated requests are rejected."""

    def test_list_pipelines_no_auth(self, client, db_session):
        """List pipelines without auth returns 401."""
        resp = client.get("/api/pipelines?organization_id=" + str(uuid4()))
        assert resp.status_code == 401

    def test_create_pipeline_no_auth(self, client, db_session):
        """Create pipeline without auth returns 401."""
        resp = client.post(
            "/api/pipelines",
            json={"organization_id": str(uuid4()), "sources": []},
            content_type="application/json",
        )
        assert resp.status_code == 401

    def test_get_pipeline_no_auth(self, client, db_session):
        """Get pipeline without auth returns 401."""
        resp = client.get(
            f"/api/organizations/{uuid4()}/pipelines/{uuid4()}"
        )
        assert resp.status_code == 401

    def test_delete_pipeline_no_auth(self, client, db_session):
        """Delete pipeline without auth returns 401."""
        resp = client.delete(
            f"/api/pipelines/{uuid4()}?organization_id={uuid4()}"
        )
        assert resp.status_code == 401
