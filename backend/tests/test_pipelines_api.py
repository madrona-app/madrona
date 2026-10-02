"""
Tests for Pipelines API with multi-source/multi-destination support.

Tests:
- Create pipeline with sources + destinations
- Update pipeline: add/remove destinations
- Delete pipeline cascades to sources/destinations
- API responses contain sources[] and destinations[] (no legacy fields)
- List pipelines
"""
import pytest
from uuid import uuid4
from app.models import (
    Pipeline, PipelineSource, PipelineDestination,
    ConnectorInstance, ConnectorDefinition, Dataset,
)


class TestPipelinesCRUD:
    """Tests for pipeline CRUD via authenticated API."""

    def test_create_pipeline(self, auth_setup, db_session, demo_pipeline):
        """Test creating a pipeline with sources and destinations."""
        auth_client, org, user = auth_setup

        # Reuse connector instances from demo_pipeline's org (demo_tenant)
        # Instead, create connectors in auth_setup's org
        source_def = ConnectorDefinition(
            key="api_src_def",
            display_name="API Source",
            direction="source",
            implementation_key="test.source:Src",
            capabilities={},
            config_schema={},
            is_enabled=True,
        )
        db_session.add(source_def)
        db_session.flush()

        src = ConnectorInstance(
            organization_id=org.organization_id,
            connector_definition_id=source_def.connector_definition_id,
            name="My Source",
            status="active",
            config={},
        )
        db_session.add(src)
        db_session.flush()

        resp = auth_client.post(
            "/api/pipelines",
            json={
                "organization_id": str(org.organization_id),
                "sources": [
                    {
                        "connector_instance_id": str(src.connector_instance_id),
                        "enabled": True,
                        "parameters": {},
                        "ordering": 0,
                    },
                ],
                "status": "active",
            },
        )

        assert resp.status_code == 201
        data = resp.get_json()
        assert "pipeline_id" in data
        assert "sources" in data
        assert "destinations" in data
        assert len(data["sources"]) == 1
        assert data["sources"][0]["connector_instance_id"] == str(src.connector_instance_id)

    def test_list_pipelines(self, auth_setup, db_session):
        """Test listing pipelines for the authenticated organization."""
        auth_client, org, user = auth_setup

        # Create a pipeline directly
        pipeline = Pipeline(
            organization_id=org.organization_id,
            status="active",
        )
        db_session.add(pipeline)
        db_session.commit()

        resp = auth_client.get(
            f"/api/pipelines?organization_id={org.organization_id}"
        )

        assert resp.status_code == 200
        data = resp.get_json()
        assert isinstance(data, list)
        assert len(data) >= 1
        first = data[0]
        assert "pipeline_id" in first
        assert "sources" in first
        assert "destinations" in first

    def test_get_pipeline(self, auth_setup, db_session):
        """Test getting a single pipeline by ID."""
        auth_client, org, user = auth_setup

        pipeline = Pipeline(
            organization_id=org.organization_id,
            status="active",
        )
        db_session.add(pipeline)
        db_session.commit()

        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/pipelines/{pipeline.pipeline_id}"
        )

        assert resp.status_code == 200
        data = resp.get_json()
        assert data["pipeline_id"] == str(pipeline.pipeline_id)
        assert "sources" in data
        assert "destinations" in data

    def test_update_pipeline_add_destination(self, auth_setup, db_session):
        """Test adding a destination to an existing pipeline."""
        auth_client, org, user = auth_setup

        # Create connector definition and instances
        conn_def = ConnectorDefinition(
            key="upd_dest_def",
            display_name="Upd Dest",
            direction="target",
            implementation_key="test.target:Tgt",
            capabilities={},
            config_schema={},
            is_enabled=True,
        )
        db_session.add(conn_def)
        db_session.flush()

        dest = ConnectorInstance(
            organization_id=org.organization_id,
            connector_definition_id=conn_def.connector_definition_id,
            name="Dest Instance",
            status="active",
            config={},
        )
        db_session.add(dest)
        db_session.flush()

        # Create pipeline
        pipeline = Pipeline(
            organization_id=org.organization_id,
            status="active",
        )
        db_session.add(pipeline)
        db_session.commit()

        resp = auth_client.patch(
            f"/api/pipelines/{pipeline.pipeline_id}",
            json={
                "organization_id": str(org.organization_id),
                "destinations": [
                    {
                        "connector_instance_id": str(dest.connector_instance_id),
                        "enabled": True,
                        "parameters": {},
                        "ordering": 0,
                    },
                ],
            },
        )

        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data["destinations"]) == 1

    def test_delete_pipeline(self, auth_setup, db_session):
        """Test deleting a pipeline."""
        auth_client, org, user = auth_setup

        pipeline = Pipeline(
            organization_id=org.organization_id,
            status="active",
        )
        db_session.add(pipeline)
        db_session.commit()
        pipeline_id = pipeline.pipeline_id

        resp = auth_client.delete(
            f"/api/pipelines/{pipeline_id}?organization_id={org.organization_id}"
        )

        assert resp.status_code == 204

        # Verify deleted
        deleted = db_session.query(Pipeline).filter_by(pipeline_id=pipeline_id).first()
        assert deleted is None

    def test_delete_pipeline_cascades(self, auth_setup, db_session):
        """Test that deleting a pipeline cascades to sources/destinations."""
        auth_client, org, user = auth_setup

        conn_def = ConnectorDefinition(
            key="cascade_def",
            display_name="Cascade",
            direction="source",
            implementation_key="test.cascade:Cascade",
            capabilities={},
            config_schema={},
            is_enabled=True,
        )
        db_session.add(conn_def)
        db_session.flush()

        ci = ConnectorInstance(
            organization_id=org.organization_id,
            connector_definition_id=conn_def.connector_definition_id,
            name="Cascade CI",
            status="active",
            config={},
        )
        db_session.add(ci)
        db_session.flush()

        pipeline = Pipeline(
            organization_id=org.organization_id,
            status="active",
        )
        db_session.add(pipeline)
        db_session.flush()

        src = PipelineSource(
            pipeline_id=pipeline.pipeline_id,
            connector_instance_id=ci.connector_instance_id,
            enabled=True,
            parameters={},
            ordering=0,
        )
        db_session.add(src)
        db_session.commit()
        pipeline_id = pipeline.pipeline_id

        resp = auth_client.delete(
            f"/api/pipelines/{pipeline_id}?organization_id={org.organization_id}"
        )

        assert resp.status_code == 204

        # Verify sources also deleted
        sources = db_session.query(PipelineSource).filter_by(pipeline_id=pipeline_id).all()
        assert len(sources) == 0

    def test_get_pipeline_not_found(self, auth_setup):
        """Test 404 for non-existent pipeline."""
        auth_client, org, user = auth_setup
        fake_id = str(uuid4())

        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/pipelines/{fake_id}"
        )

        assert resp.status_code == 404
