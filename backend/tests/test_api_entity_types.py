"""
Tests for entity-type API endpoints.

Tests the /api/entity-types and /api/entities endpoints with entity_type support.
Uses the auth_setup fixture from conftest.py for authenticated requests.
"""

import pytest
from datetime import datetime, timezone
from uuid import uuid4

from app.models import EntityCurrent, EntityField


@pytest.fixture
def sample_entities(db_session, auth_setup):
    """Create sample entities with different entity types."""
    _, org, _ = auth_setup
    entities = []
    now = datetime.now(timezone.utc)

    # Create 5 objects
    for i in range(5):
        entity = EntityCurrent(
            organization_id=org.organization_id,
            entity_key=f"obj:{i}",
            entity_type="object",
            source_system="test",
            source_id=str(i),
            canonical_url=f"https://example.com/obj/{i}",
            payload={"id": i, "type": "object"},
            payload_hash=f"hash-obj-{i}",
            extracted_at=now,
            last_seen_at=now,
        )
        entities.append(entity)

        entity_field = EntityField(
            organization_id=org.organization_id,
            entity_key=f"obj:{i}",
            entity_type="object",
            title=f"Object {i}",
            object_number=f"OBJ-{i:03d}",
        )
        db_session.add(entity)
        db_session.add(entity_field)

    # Create 3 donors
    for i in range(3):
        entity = EntityCurrent(
            organization_id=org.organization_id,
            entity_key=f"donor:{i}",
            entity_type="donor",
            source_system="test",
            source_id=f"d{i}",
            canonical_url=f"https://example.com/donor/{i}",
            payload={"id": f"d{i}", "type": "donor"},
            payload_hash=f"hash-donor-{i}",
            extracted_at=now,
            last_seen_at=now,
        )
        entities.append(entity)

        entity_field = EntityField(
            organization_id=org.organization_id,
            entity_key=f"donor:{i}",
            entity_type="donor",
            title=f"Donor {i}",
            object_number=f"DNR-{i:03d}",
        )
        db_session.add(entity)
        db_session.add(entity_field)

    # Create 2 members
    for i in range(2):
        entity = EntityCurrent(
            organization_id=org.organization_id,
            entity_key=f"member:{i}",
            entity_type="member",
            source_system="test",
            source_id=f"m{i}",
            canonical_url=f"https://example.com/member/{i}",
            payload={"id": f"m{i}", "type": "member"},
            payload_hash=f"hash-member-{i}",
            extracted_at=now,
            last_seen_at=now,
        )
        entities.append(entity)

        entity_field = EntityField(
            organization_id=org.organization_id,
            entity_key=f"member:{i}",
            entity_type="member",
            title=f"Member {i}",
            object_number=f"MBR-{i:03d}",
        )
        db_session.add(entity)
        db_session.add(entity_field)

    db_session.commit()
    return entities


class TestEntityTypesEndpoint:
    """Tests for GET /api/entity-types endpoint."""

    def test_list_entity_types_success(self, auth_setup, sample_entities):
        """Test listing entity types returns correct counts."""
        auth_client, org, user = auth_setup

        response = auth_client.get(
            f"/api/entity-types?organization_id={org.organization_id}"
        )

        assert response.status_code == 200
        data = response.get_json()

        assert data["organization_id"] == str(org.organization_id)
        assert len(data["entity_types"]) == 3

        types_dict = {et["entity_type"]: et["count"] for et in data["entity_types"]}
        assert types_dict["object"] == 5
        assert types_dict["donor"] == 3
        assert types_dict["member"] == 2

    def test_list_entity_types_missing_organization_id(self, auth_setup):
        """Test error when organization_id is missing."""
        auth_client, org, user = auth_setup

        response = auth_client.get("/api/entity-types")

        assert response.status_code in (400, 422)
        data = response.get_json()
        _e = data.get("error") or data.get("detail", "")
        _msg = (_e.get("message", "") if isinstance(_e, dict) else str(_e)).lower()
        assert "organization_id" in _msg or "organization" in _msg

    def test_list_entity_types_empty_org(self, auth_setup, db_session):
        """Test empty response for org with no entities."""
        auth_client, org, user = auth_setup

        response = auth_client.get(
            f"/api/entity-types?organization_id={org.organization_id}"
        )

        assert response.status_code == 200
        data = response.get_json()
        assert data["organization_id"] == str(org.organization_id)
        assert data["entity_types"] == []

    def test_list_entity_types_requires_auth(self, client):
        """Test that listing entity types requires authentication."""
        response = client.get(f"/api/entity-types?organization_id={uuid4()}")
        assert response.status_code == 401


class TestEntitiesEndpointWithTypes:
    """Tests for GET /api/entities endpoint with entity_type filtering."""

    def test_list_all_entities(self, auth_setup, sample_entities):
        """Test listing all entities without type filter."""
        auth_client, org, user = auth_setup

        response = auth_client.get(
            f"/api/entities?organization_id={org.organization_id}"
        )

        assert response.status_code == 200
        data = response.get_json()

        assert data["organization_id"] == str(org.organization_id)
        assert data["entity_type"] is None
        assert data["total"] == 10  # 5 objects + 3 donors + 2 members
        assert len(data["items"]) == 10
        assert "display" in data
        assert data["display"]["primary_field"] == "title"

    def test_filter_by_entity_type_object(self, auth_setup, sample_entities):
        """Test filtering entities by type: object."""
        auth_client, org, user = auth_setup

        response = auth_client.get(
            f"/api/entities?organization_id={org.organization_id}&entity_type=object"
        )

        assert response.status_code == 200
        data = response.get_json()

        assert data["entity_type"] == "object"
        assert data["total"] == 5
        assert len(data["items"]) == 5

        for entity in data["items"]:
            assert entity["entity_type"] == "object"
            assert entity["entity_key"].startswith("obj:")

    def test_filter_by_entity_type_donor(self, auth_setup, sample_entities):
        """Test filtering entities by type: donor."""
        auth_client, org, user = auth_setup

        response = auth_client.get(
            f"/api/entities?organization_id={org.organization_id}&entity_type=donor"
        )

        assert response.status_code == 200
        data = response.get_json()

        assert data["entity_type"] == "donor"
        assert data["total"] == 3
        assert len(data["items"]) == 3

        for entity in data["items"]:
            assert entity["entity_type"] == "donor"

    def test_filter_nonexistent_entity_type(self, auth_setup, sample_entities):
        """Test filtering by nonexistent entity type returns empty list."""
        auth_client, org, user = auth_setup

        response = auth_client.get(
            f"/api/entities?organization_id={org.organization_id}&entity_type=nonexistent"
        )

        assert response.status_code == 200
        data = response.get_json()

        assert data["entity_type"] == "nonexistent"
        assert data["total"] == 0
        assert data["items"] == []

    def test_pagination_with_entity_type(self, auth_setup, sample_entities):
        """Test pagination works correctly with entity type filter."""
        auth_client, org, user = auth_setup

        response = auth_client.get(
            f"/api/entities?organization_id={org.organization_id}&entity_type=object&limit=2&offset=0"
        )

        assert response.status_code == 200
        data = response.get_json()

        assert data["limit"] == 2
        assert data["offset"] == 0
        assert len(data["items"]) == 2
        assert data["total"] == 5

    def test_search_within_entity_type(self, auth_setup, sample_entities):
        """Test search works correctly within entity type filter."""
        auth_client, org, user = auth_setup

        response = auth_client.get(
            f"/api/entities?organization_id={org.organization_id}&entity_type=object&q=Object 1"
        )

        assert response.status_code == 200
        data = response.get_json()

        assert data["total"] == 1
        assert data["items"][0]["title"] == "Object 1"
        assert data["items"][0]["entity_type"] == "object"

    def test_entity_type_in_response(self, auth_setup, sample_entities):
        """Test that entity_type is included in entity response."""
        auth_client, org, user = auth_setup

        response = auth_client.get(
            f"/api/entities?organization_id={org.organization_id}"
        )

        assert response.status_code == 200
        data = response.get_json()

        assert len(data["items"]) > 0
        entity = data["items"][0]
        assert "entity_type" in entity
        assert entity["entity_type"] in ["object", "donor", "member"]


class TestEntityDetailWithType:
    """Tests for GET /api/entities/<entity_key> with entity_type."""

    def test_get_entity_detail(self, auth_setup, sample_entities):
        """Test getting entity detail includes entity_type."""
        auth_client, org, user = auth_setup

        response = auth_client.get(
            f"/api/entities/obj:0?organization_id={org.organization_id}"
        )

        assert response.status_code == 200
        data = response.get_json()

        assert data["entity_key"] == "obj:0"
        assert data["entity_type"] == "object"
        assert data["source_system"] == "test"
        assert "payload" in data
        assert "fields" in data
        assert data["fields"]["title"] == "Object 0"

    def test_get_donor_entity_detail(self, auth_setup, sample_entities):
        """Test getting donor entity detail."""
        auth_client, org, user = auth_setup

        response = auth_client.get(
            f"/api/entities/donor:0?organization_id={org.organization_id}"
        )

        assert response.status_code == 200
        data = response.get_json()

        assert data["entity_key"] == "donor:0"
        assert data["entity_type"] == "donor"
        assert data["fields"]["title"] == "Donor 0"


class TestEntityTypesIntegration:
    """Integration tests for entity types across multiple endpoints."""

    def test_complete_workflow(self, auth_setup, sample_entities):
        """Test complete workflow: list types, filter by type, get detail."""
        auth_client, org, user = auth_setup

        # Step 1: Get available entity types
        response = auth_client.get(
            f"/api/entity-types?organization_id={org.organization_id}"
        )
        assert response.status_code == 200
        types_data = response.get_json()
        assert len(types_data["entity_types"]) == 3

        # Step 2: Filter entities by first type
        entity_type = types_data["entity_types"][0]["entity_type"]
        expected_count = types_data["entity_types"][0]["count"]

        response = auth_client.get(
            f"/api/entities?organization_id={org.organization_id}&entity_type={entity_type}"
        )
        assert response.status_code == 200
        entities_data = response.get_json()
        assert entities_data["total"] == expected_count

        # Step 3: Get detail of first entity
        first_entity_key = entities_data["items"][0]["entity_key"]
        response = auth_client.get(
            f"/api/entities/{first_entity_key}?organization_id={org.organization_id}"
        )
        assert response.status_code == 200
        detail_data = response.get_json()
        assert detail_data["entity_type"] == entity_type
