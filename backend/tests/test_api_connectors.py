"""
Smoke tests for the Connectors API.

Routes under /api/connector-definitions and /api/connector-instances.
Tests cover CRUD operations for connector instances plus auth checks.
"""

import json
from uuid import uuid4

import pytest

from app.models import ConnectorDefinition, ConnectorInstance


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _post_json(auth_client, url, data):
    """Helper for POST with JSON body."""
    return auth_client.post(url, data=json.dumps(data), content_type="application/json")


def _patch_json(auth_client, url, data):
    """Helper for PATCH with JSON body."""
    return auth_client.patch(url, data=json.dumps(data), content_type="application/json")


def _create_connector_definition(db_session, key="test-source", display_name="Test Source",
                                  direction="source", source_type=None):
    """Create a ConnectorDefinition directly in the DB."""
    defn = ConnectorDefinition(
        key=key,
        display_name=display_name,
        direction=direction,
        implementation_key="app.connectors.test:TestConnector",
        source_type=source_type,
        capabilities={},
        config_schema={},
        is_enabled=True,
    )
    db_session.add(defn)
    db_session.commit()
    db_session.refresh(defn)
    return defn


def _create_connector_instance(db_session, org_id, definition_id, name="My Instance",
                                config=None, status="active"):
    """Create a ConnectorInstance directly in the DB."""
    inst = ConnectorInstance(
        organization_id=org_id,
        connector_definition_id=definition_id,
        name=name,
        status=status,
        config=config or {"host": "localhost", "port": 5432},
    )
    db_session.add(inst)
    db_session.commit()
    db_session.refresh(inst)
    return inst


# ============================================================================
# List Connector Definitions
# ============================================================================


class TestListConnectorDefinitions:
    def test_list_definitions_empty(self, auth_setup, db_session):
        """Listing definitions with none in the DB returns an empty list."""
        auth_client, org, _ = auth_setup
        resp = auth_client.get("/api/connector-definitions")
        assert resp.status_code == 200
        data = resp.get_json()
        assert isinstance(data, list)
        assert len(data) == 0

    def test_list_definitions_with_data(self, auth_setup, db_session):
        """Listing definitions returns all seeded definitions."""
        auth_client, org, _ = auth_setup
        _create_connector_definition(db_session, key="alpha-src", display_name="Alpha Source")
        _create_connector_definition(db_session, key="beta-tgt", display_name="Beta Target", direction="target")

        resp = auth_client.get("/api/connector-definitions")
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data) == 2
        # Ordered by display_name
        assert data[0]["display_name"] == "Alpha Source"
        assert data[1]["display_name"] == "Beta Target"
        # Check shape
        assert "connector_definition_id" in data[0]
        assert "key" in data[0]
        assert "direction" in data[0]


# ============================================================================
# List Connector Instances (empty)
# ============================================================================


class TestListConnectorInstances:
    def test_list_instances_empty(self, auth_setup, db_session):
        """Listing instances when none exist returns an empty list."""
        auth_client, org, _ = auth_setup
        resp = auth_client.get(
            "/api/connector-instances",
            query_string={"organization_id": str(org.organization_id)},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert isinstance(data, list)
        assert len(data) == 0


# ============================================================================
# Create Connector Instance
# ============================================================================


class TestCreateConnectorInstance:
    def test_create_instance(self, auth_setup, db_session):
        """Creating a connector instance returns 201 with redacted config."""
        auth_client, org, _ = auth_setup
        defn = _create_connector_definition(db_session, key="create-test")

        payload = {
            "organization_id": str(org.organization_id),
            "connector_definition_id": str(defn.connector_definition_id),
            "name": "Production DB",
            "config": {"host": "db.example.com", "port": 5432, "password": "s3cret"},
        }
        resp = _post_json(auth_client, "/api/connector-instances", payload)
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["name"] == "Production DB"
        assert data["status"] == "active"
        assert "connector_instance_id" in data
        # Password must be redacted in response
        assert data["config"]["password"] == "***REDACTED***"
        # Non-sensitive fields preserved
        assert data["config"]["host"] == "db.example.com"

    def test_create_instance_missing_fields(self, auth_setup, db_session):
        """Creating an instance without required fields returns 400."""
        auth_client, org, _ = auth_setup
        resp = _post_json(auth_client, "/api/connector-instances", {"name": "Incomplete"})
        assert resp.status_code in (400, 422)

    def test_create_instance_invalid_definition(self, auth_setup, db_session):
        """Creating an instance referencing a non-existent definition returns 404."""
        auth_client, org, _ = auth_setup
        payload = {
            "organization_id": str(org.organization_id),
            "connector_definition_id": str(uuid4()),
            "name": "Bad Ref",
            "config": {},
        }
        resp = _post_json(auth_client, "/api/connector-instances", payload)
        assert resp.status_code == 404


# ============================================================================
# Get Connector Instance by ID / Not Found
# ============================================================================


class TestGetConnectorInstance:
    def test_get_instance(self, auth_setup, db_session):
        """Getting an instance by ID returns the correct data."""
        auth_client, org, _ = auth_setup
        defn = _create_connector_definition(db_session, key="get-test")
        inst = _create_connector_instance(
            db_session, org.organization_id, defn.connector_definition_id,
            name="My Connector", config={"host": "localhost"},
        )

        resp = auth_client.get(
            f"/api/connector-instances/{inst.connector_instance_id}",
            query_string={"organization_id": str(org.organization_id)},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["connector_instance_id"] == str(inst.connector_instance_id)
        assert data["name"] == "My Connector"

    def test_get_instance_not_found(self, auth_setup, db_session):
        """Getting a non-existent instance returns 404."""
        auth_client, org, _ = auth_setup
        resp = auth_client.get(
            f"/api/connector-instances/{uuid4()}",
            query_string={"organization_id": str(org.organization_id)},
        )
        assert resp.status_code == 404


# ============================================================================
# Update Connector Instance
# ============================================================================


class TestUpdateConnectorInstance:
    def test_update_instance_name(self, auth_setup, db_session):
        """Updating an instance name persists the change."""
        auth_client, org, _ = auth_setup
        defn = _create_connector_definition(db_session, key="update-test")
        inst = _create_connector_instance(
            db_session, org.organization_id, defn.connector_definition_id,
            name="Old Name",
        )

        resp = _patch_json(
            auth_client,
            f"/api/connector-instances/{inst.connector_instance_id}",
            {"name": "New Name", "organization_id": str(org.organization_id)},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["name"] == "New Name"

    def test_update_instance_not_found(self, auth_setup, db_session):
        """Updating a non-existent instance returns 404."""
        auth_client, org, _ = auth_setup
        resp = _patch_json(
            auth_client,
            f"/api/connector-instances/{uuid4()}",
            {"name": "Ghost", "organization_id": str(org.organization_id)},
        )
        assert resp.status_code == 404


# ============================================================================
# Delete Connector Instance
# ============================================================================


class TestDeleteConnectorInstance:
    def test_delete_instance(self, auth_setup, db_session):
        """Deleting an instance returns 204 and it is gone afterwards."""
        auth_client, org, _ = auth_setup
        defn = _create_connector_definition(db_session, key="delete-test")
        inst = _create_connector_instance(
            db_session, org.organization_id, defn.connector_definition_id,
        )

        resp = auth_client.delete(
            f"/api/connector-instances/{inst.connector_instance_id}",
            query_string={"organization_id": str(org.organization_id)},
        )
        assert resp.status_code == 204

        # Verify it is gone
        resp = auth_client.get(
            f"/api/connector-instances/{inst.connector_instance_id}",
            query_string={"organization_id": str(org.organization_id)},
        )
        assert resp.status_code == 404

    def test_delete_instance_not_found(self, auth_setup, db_session):
        """Deleting a non-existent instance returns 404."""
        auth_client, org, _ = auth_setup
        resp = auth_client.delete(
            f"/api/connector-instances/{uuid4()}",
            query_string={"organization_id": str(org.organization_id)},
        )
        assert resp.status_code == 404


# ============================================================================
# Authorization (401 for unauthenticated requests)
# ============================================================================


class TestConnectorsAuth:
    def test_list_definitions_requires_auth(self, client):
        """Unauthenticated request to list definitions returns 401."""
        resp = client.get("/api/connector-definitions")
        assert resp.status_code == 401

    def test_list_instances_requires_auth(self, client):
        """Unauthenticated request to list instances returns 401."""
        resp = client.get("/api/connector-instances")
        assert resp.status_code == 401

    def test_create_instance_requires_auth(self, client):
        """Unauthenticated request to create an instance returns 401."""
        resp = client.post(
            "/api/connector-instances",
            data=json.dumps({"name": "No Auth"}),
            content_type="application/json",
        )
        assert resp.status_code == 401

    def test_delete_instance_requires_auth(self, client):
        """Unauthenticated request to delete an instance returns 401."""
        resp = client.delete(f"/api/connector-instances/{uuid4()}")
        assert resp.status_code == 401
