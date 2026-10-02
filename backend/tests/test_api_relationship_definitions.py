"""
Tests for relationship definitions API endpoints.

Tests the CRUD operations for admin-configured relationship linking rules.
All endpoints require PLATFORM_ADMIN permission.

Uses the auth_setup fixture from conftest.py for authenticated requests.
"""
import pytest
from uuid import uuid4

from app.models import RelationshipDefinition, Dataset


@pytest.fixture
def test_dataset(db_session, auth_setup):
    """Create a test dataset for relationship definition tests."""
    _, org, _ = auth_setup
    ds = Dataset(
        organization_id=org.organization_id,
        name="Test Dataset",
        key="test-dataset-reldef",
    )
    db_session.add(ds)
    db_session.commit()
    return ds


class TestRelationshipDefinitionsAPI:
    """Tests for /api/relationship-definitions endpoints."""

    def test_create_definition(self, auth_setup, test_dataset):
        """Test creating a new relationship definition."""
        auth_client, org, user = auth_setup

        response = auth_client.post(
            "/api/relationship-definitions",
            json={
                "name": "ISBN to Book",
                "description": "Link books by ISBN",
                "relationship_type": "references",
                "source_dataset_id": str(test_dataset.dataset_id),
                "source_field_path": "payload.isbn",
                "target_dataset_id": str(test_dataset.dataset_id),
                "target_field_path": "payload.related_isbn",
                "match_transform": "exact",
                "case_sensitive": True,
                "enabled": True,
            },
        )

        assert response.status_code == 201
        data = response.get_json()
        defn = data["definition"]
        assert defn["name"] == "ISBN to Book"
        assert defn["relationship_type"] == "references"
        assert defn["source_field_path"] == "payload.isbn"
        assert defn["target_field_path"] == "payload.related_isbn"
        assert "definition_id" in defn

    def test_create_definition_minimal(self, auth_setup):
        """Test creating a definition with only required fields."""
        auth_client, org, user = auth_setup

        response = auth_client.post(
            "/api/relationship-definitions",
            json={
                "name": "Minimal Definition",
                "relationship_type": "related_to",
                "source_field_path": "payload.id",
                "target_field_path": "payload.ref_id",
            },
        )

        assert response.status_code == 201
        data = response.get_json()
        defn = data["definition"]
        assert defn["name"] == "Minimal Definition"
        # Defaults
        assert defn["match_transform"] == "exact"
        assert defn["case_sensitive"] is True
        assert defn["enabled"] is True

    def test_create_definition_missing_required_field(self, auth_setup):
        """Test creating a definition without required fields fails."""
        auth_client, _, _ = auth_setup

        response = auth_client.post(
            "/api/relationship-definitions",
            json={
                "name": "Missing Fields",
                # Missing relationship_type, source_field_path, target_field_path
            },
        )

        assert response.status_code in (400, 422)

    def test_list_definitions(self, auth_setup, test_dataset, db_session):
        """Test listing relationship definitions."""
        auth_client, org, user = auth_setup

        # Create a definition directly in the database
        definition = RelationshipDefinition(
            organization_id=org.organization_id,
            name="Test List Definition",
            relationship_type="references",
            source_dataset_id=test_dataset.dataset_id,
            source_field_path="payload.id",
            target_field_path="payload.ref",
            created_by_user_id=user.user_id,
        )
        db_session.add(definition)
        db_session.commit()

        response = auth_client.get("/api/relationship-definitions")

        assert response.status_code == 200
        data = response.get_json()
        assert "items" in data
        assert len(data["items"]) >= 1
        names = [d["name"] for d in data["items"]]
        assert "Test List Definition" in names

    def test_get_definition(self, auth_setup, test_dataset, db_session):
        """Test getting a specific definition."""
        auth_client, org, user = auth_setup

        definition = RelationshipDefinition(
            organization_id=org.organization_id,
            name="Get Test Definition",
            relationship_type="references",
            source_dataset_id=test_dataset.dataset_id,
            source_field_path="payload.id",
            target_field_path="payload.ref",
            created_by_user_id=user.user_id,
        )
        db_session.add(definition)
        db_session.commit()

        response = auth_client.get(
            f"/api/relationship-definitions/{definition.definition_id}"
        )

        assert response.status_code == 200
        data = response.get_json()
        defn = data["definition"]
        assert defn["name"] == "Get Test Definition"
        assert defn["definition_id"] == str(definition.definition_id)

    def test_get_nonexistent_definition(self, auth_setup):
        """Test getting a non-existent definition returns 404."""
        auth_client, _, _ = auth_setup
        fake_id = str(uuid4())
        response = auth_client.get(f"/api/relationship-definitions/{fake_id}")

        assert response.status_code == 404

    def test_update_definition(self, auth_setup, test_dataset, db_session):
        """Test updating a definition."""
        auth_client, org, user = auth_setup

        definition = RelationshipDefinition(
            organization_id=org.organization_id,
            name="Update Test Definition",
            relationship_type="references",
            source_dataset_id=test_dataset.dataset_id,
            source_field_path="payload.id",
            target_field_path="payload.ref",
            created_by_user_id=user.user_id,
        )
        db_session.add(definition)
        db_session.commit()
        definition_id = definition.definition_id

        response = auth_client.put(
            f"/api/relationship-definitions/{definition_id}",
            json={
                "name": "Updated Name",
                "description": "Updated description",
                "enabled": False,
            },
        )

        assert response.status_code == 200
        data = response.get_json()
        defn = data["definition"]
        assert defn["name"] == "Updated Name"
        assert defn["description"] == "Updated description"
        assert defn["enabled"] is False

    def test_delete_definition(self, auth_setup, test_dataset, db_session):
        """Test deleting a definition."""
        auth_client, org, user = auth_setup

        definition = RelationshipDefinition(
            organization_id=org.organization_id,
            name="Delete Test Definition",
            relationship_type="references",
            source_dataset_id=test_dataset.dataset_id,
            source_field_path="payload.id",
            target_field_path="payload.ref",
            created_by_user_id=user.user_id,
        )
        db_session.add(definition)
        db_session.commit()
        definition_id = definition.definition_id

        response = auth_client.delete(
            f"/api/relationship-definitions/{definition_id}"
        )

        assert response.status_code == 204

        # Verify it's deleted
        response = auth_client.get(
            f"/api/relationship-definitions/{definition_id}"
        )
        assert response.status_code == 404

    def test_filter_by_dataset(self, auth_setup, test_dataset, db_session):
        """Test filtering definitions by dataset.

        The API passes dataset_id as both source_dataset_id and target_dataset_id
        in the query, requiring both to match. So we create a definition where
        the same dataset is used for both source and target.
        """
        auth_client, org, user = auth_setup

        definition = RelationshipDefinition(
            organization_id=org.organization_id,
            name="Dataset Filter Test",
            relationship_type="references",
            source_dataset_id=test_dataset.dataset_id,
            target_dataset_id=test_dataset.dataset_id,
            source_field_path="payload.id",
            target_field_path="payload.ref",
            created_by_user_id=user.user_id,
        )
        db_session.add(definition)
        db_session.commit()

        response = auth_client.get(
            f"/api/relationship-definitions?dataset_id={test_dataset.dataset_id}"
        )

        assert response.status_code == 200
        data = response.get_json()
        # Should include definitions where dataset is source AND target
        assert len(data["items"]) >= 1

    def test_filter_by_enabled(self, auth_setup, db_session):
        """Test filtering definitions by enabled status."""
        auth_client, org, user = auth_setup

        # Create enabled and disabled definitions
        enabled_def = RelationshipDefinition(
            organization_id=org.organization_id,
            name="Enabled Definition",
            relationship_type="references",
            source_field_path="payload.id",
            target_field_path="payload.ref",
            enabled=True,
            created_by_user_id=user.user_id,
        )
        disabled_def = RelationshipDefinition(
            organization_id=org.organization_id,
            name="Disabled Definition",
            relationship_type="references2",
            source_field_path="payload.id",
            target_field_path="payload.ref",
            enabled=False,
            created_by_user_id=user.user_id,
        )
        db_session.add_all([enabled_def, disabled_def])
        db_session.commit()

        # Filter by enabled=true
        response = auth_client.get("/api/relationship-definitions?enabled=true")
        assert response.status_code == 200
        data = response.get_json()
        for item in data["items"]:
            assert item["enabled"] is True

        # Filter by enabled=false
        response = auth_client.get("/api/relationship-definitions?enabled=false")
        assert response.status_code == 200
        data = response.get_json()
        for item in data["items"]:
            assert item["enabled"] is False

    def test_requires_auth(self, client):
        """Test that all endpoints require authentication."""
        response = client.get("/api/relationship-definitions")
        assert response.status_code == 401

        response = client.post(
            "/api/relationship-definitions",
            json={"name": "test", "relationship_type": "ref",
                  "source_field_path": "a", "target_field_path": "b"},
        )
        assert response.status_code == 401

    def test_viewer_cannot_access(self, viewer_auth_setup):
        """Test that viewer role (no platform.admin) cannot access relationship definitions."""
        auth_client, org, user = viewer_auth_setup

        response = auth_client.get("/api/relationship-definitions")
        assert response.status_code == 403
