"""
Tests for entity browsing API endpoints.

Tests the CRUD operations for entity browsing including:
- GET /api/entities (list with pagination, filtering, search)
- GET /api/entities/{entity_key} (detail)
- GET /api/entities/{entity_key}/history (change history)
- GET /api/organizations/{org_id}/runs/{run_id}/changes (run changes)

Uses the auth_setup fixture from conftest.py for authenticated requests.
"""

import pytest
from datetime import datetime, timezone, timedelta

from app.models import (
    EntityCurrent, EntityField, Run, ChangeEvent, FieldDiff,
)


class TestListEntities:
    """Tests for GET /api/entities endpoint."""

    def test_list_entities_success(self, auth_setup, db_session):
        """Test listing entities with pagination."""
        auth_client, org, user = auth_setup

        for i in range(5):
            entity = EntityCurrent(
                organization_id=org.organization_id,
                entity_key=f"test:{i}",
                entity_type="object",
                source_system="test",
                source_id=str(i),
                payload={"title": f"Entity {i}"},
                payload_hash=f"hash{i}",
                extracted_at=datetime.now(timezone.utc),
                last_seen_at=datetime.now(timezone.utc),
            )
            db_session.add(entity)

            fields = EntityField(
                organization_id=org.organization_id,
                entity_key=f"test:{i}",
                entity_type="object",
                title=f"Entity {i}",
                object_number=f"OBJ-{i}",
            )
            db_session.add(fields)

        db_session.commit()

        response = auth_client.get(
            f"/api/entities?organization_id={org.organization_id}"
        )

        assert response.status_code == 200
        data = response.get_json()

        assert "items" in data
        assert len(data["items"]) == 5
        assert data["total"] == 5
        assert data["limit"] == 50
        assert data["offset"] == 0

        entity = data["items"][0]
        assert "entity_key" in entity
        assert "title" in entity
        assert "object_number" in entity

    def test_list_entities_with_pagination(self, auth_setup, db_session):
        """Test pagination works correctly."""
        auth_client, org, user = auth_setup

        for i in range(10):
            entity = EntityCurrent(
                organization_id=org.organization_id,
                entity_key=f"test:{i}",
                entity_type="object",
                source_system="test",
                source_id=str(i),
                payload={"title": f"Entity {i}"},
                payload_hash=f"hash{i}",
                extracted_at=datetime.now(timezone.utc),
                last_seen_at=datetime.now(timezone.utc),
            )
            db_session.add(entity)

            fields = EntityField(
                organization_id=org.organization_id,
                entity_key=f"test:{i}",
                entity_type="object",
                title=f"Entity {i:02d}",
            )
            db_session.add(fields)

        db_session.commit()

        # Get first page
        response = auth_client.get(
            f"/api/entities?organization_id={org.organization_id}&limit=5&offset=0"
        )
        data = response.get_json()

        assert response.status_code == 200
        assert len(data["items"]) == 5
        assert data["total"] == 10

        # Get second page
        response = auth_client.get(
            f"/api/entities?organization_id={org.organization_id}&limit=5&offset=5"
        )
        data = response.get_json()

        assert response.status_code == 200
        assert len(data["items"]) == 5
        assert data["total"] == 10

    def test_list_entities_with_search(self, auth_setup, db_session):
        """Test search filtering."""
        auth_client, org, user = auth_setup

        for title in ["Portrait of Washington", "Sculpture of Lincoln", "Painting of Jefferson"]:
            entity_key = f"test:{title.lower().replace(' ', '_')}"
            entity = EntityCurrent(
                organization_id=org.organization_id,
                entity_key=entity_key,
                entity_type="object",
                source_system="test",
                source_id=entity_key,
                payload={"title": title},
                payload_hash=f"hash_{entity_key}",
                extracted_at=datetime.now(timezone.utc),
                last_seen_at=datetime.now(timezone.utc),
            )
            db_session.add(entity)

            fields = EntityField(
                organization_id=org.organization_id,
                entity_key=entity_key,
                entity_type="object",
                title=title,
            )
            db_session.add(fields)

        db_session.commit()

        response = auth_client.get(
            f"/api/entities?organization_id={org.organization_id}&q=Portrait"
        )
        data = response.get_json()

        assert response.status_code == 200
        assert len(data["items"]) == 1
        assert data["items"][0]["title"] == "Portrait of Washington"

    def test_list_entities_missing_organization_id(self, auth_setup):
        """Test that missing organization_id returns 400."""
        auth_client, org, user = auth_setup
        response = auth_client.get("/api/entities")

        assert response.status_code in (400, 422)
        data = response.get_json()
        assert (data.get("error", {}).get("code") in ("bad_request", "validation_error", "missing_parameter") or data.get("detail"))

    def test_list_entities_requires_auth(self, client):
        """Test that listing entities requires authentication."""
        response = client.get("/api/entities?organization_id=fake-id")
        assert response.status_code == 401

    def test_list_entities_filter_by_entity_type(self, auth_setup, db_session):
        """Test filtering entities by entity_type."""
        auth_client, org, user = auth_setup

        # Create objects and donors
        for i in range(3):
            entity = EntityCurrent(
                organization_id=org.organization_id,
                entity_key=f"obj:{i}",
                entity_type="object",
                source_system="test",
                source_id=str(i),
                payload={},
                payload_hash=f"hash-obj-{i}",
                extracted_at=datetime.now(timezone.utc),
                last_seen_at=datetime.now(timezone.utc),
            )
            db_session.add(entity)
            db_session.add(EntityField(
                organization_id=org.organization_id,
                entity_key=f"obj:{i}",
                entity_type="object",
                title=f"Object {i}",
            ))

        for i in range(2):
            entity = EntityCurrent(
                organization_id=org.organization_id,
                entity_key=f"donor:{i}",
                entity_type="donor",
                source_system="test",
                source_id=f"d{i}",
                payload={},
                payload_hash=f"hash-donor-{i}",
                extracted_at=datetime.now(timezone.utc),
                last_seen_at=datetime.now(timezone.utc),
            )
            db_session.add(entity)
            db_session.add(EntityField(
                organization_id=org.organization_id,
                entity_key=f"donor:{i}",
                entity_type="donor",
                title=f"Donor {i}",
            ))

        db_session.commit()

        response = auth_client.get(
            f"/api/entities?organization_id={org.organization_id}&entity_type=object"
        )
        data = response.get_json()

        assert response.status_code == 200
        assert data["total"] == 3
        for e in data["items"]:
            assert e["entity_type"] == "object"


class TestGetEntity:
    """Tests for GET /api/entities/{entity_key} endpoint."""

    def test_get_entity_success(self, auth_setup, db_session):
        """Test getting entity details."""
        auth_client, org, user = auth_setup

        entity = EntityCurrent(
            organization_id=org.organization_id,
            entity_key="test:123",
            entity_type="object",
            source_system="test",
            source_id="123",
            canonical_url="https://example.com/123",
            payload={"title": "Test Entity", "description": "Full description"},
            payload_hash="hash123",
            extracted_at=datetime.now(timezone.utc),
            last_seen_at=datetime.now(timezone.utc),
        )
        db_session.add(entity)

        fields = EntityField(
            organization_id=org.organization_id,
            entity_key="test:123",
            entity_type="object",
            title="Test Entity",
            object_number="OBJ-123",
            thumbnail_url="https://example.com/thumb.jpg",
        )
        db_session.add(fields)
        db_session.commit()

        response = auth_client.get(
            f"/api/entities/test:123?organization_id={org.organization_id}"
        )

        assert response.status_code == 200
        data = response.get_json()

        assert data["entity_key"] == "test:123"
        assert data["source_system"] == "test"
        assert data["source_id"] == "123"
        assert data["canonical_url"] == "https://example.com/123"
        assert data["payload"]["title"] == "Test Entity"
        assert data["fields"]["title"] == "Test Entity"
        assert data["fields"]["object_number"] == "OBJ-123"

    def test_get_entity_not_found(self, auth_setup, db_session):
        """Test that non-existent entity returns 404."""
        auth_client, org, user = auth_setup

        response = auth_client.get(
            f"/api/entities/nonexistent:999?organization_id={org.organization_id}"
        )

        assert response.status_code == 404
        data = response.get_json()
        assert data.get("error", {}).get("code") in ("not_found", "entity_not_found")

    def test_get_entity_missing_organization_id(self, auth_setup):
        """Test that missing organization_id returns 400."""
        auth_client, org, user = auth_setup
        response = auth_client.get("/api/entities/test:123")

        assert response.status_code in (400, 422)
        data = response.get_json()
        assert (data.get("error", {}).get("code") in ("bad_request", "validation_error", "missing_parameter") or data.get("detail"))

    def test_get_entity_requires_auth(self, client):
        """Test that getting entity requires authentication."""
        response = client.get("/api/entities/test:123?organization_id=fake-id")
        assert response.status_code == 401


class TestGetEntityHistory:
    """Tests for GET /api/entities/{entity_key}/history endpoint."""

    def test_get_entity_history_success(self, auth_setup, db_session):
        """Test getting change history for an entity."""
        auth_client, org, user = auth_setup

        run1 = Run(
            organization_id=org.organization_id,
            status="success",
            triggered_by="api",
            parameters={},
        )
        db_session.add(run1)
        db_session.flush()

        run2 = Run(
            organization_id=org.organization_id,
            status="success",
            triggered_by="api",
            parameters={},
        )
        db_session.add(run2)
        db_session.flush()

        entity = EntityCurrent(
            organization_id=org.organization_id,
            entity_key="test:entity_123",
            entity_type="object",
            source_system="test",
            source_id="entity_123",
            payload={"title": "Updated Entity"},
            payload_hash="hash_updated",
            extracted_at=datetime.now(timezone.utc),
            last_seen_at=datetime.now(timezone.utc),
            last_run_id=run2.run_id,
        )
        db_session.add(entity)
        db_session.flush()

        now = datetime.now(timezone.utc)
        earlier = now - timedelta(hours=1)

        change1 = ChangeEvent(
            organization_id=org.organization_id,
            run_id=run1.run_id,
            entity_key="test:entity_123",
            entity_type="object",
            change_type="created",
            applied=True,
            changed_fields=None,
            old_hash=None,
            new_hash="hash_created",
            summary="Created entity test:entity_123",
            occurred_at=earlier,
        )
        db_session.add(change1)
        db_session.flush()

        change2 = ChangeEvent(
            organization_id=org.organization_id,
            run_id=run2.run_id,
            entity_key="test:entity_123",
            entity_type="object",
            change_type="updated",
            applied=True,
            changed_fields=["title"],
            old_hash="hash_created",
            new_hash="hash_updated",
            summary="Updated 1 field(s): title",
            occurred_at=now,
        )
        db_session.add(change2)
        db_session.flush()

        diff = FieldDiff(
            organization_id=org.organization_id,
            change_id=change2.change_id,
            field_name="title",
            old_value="Original Entity",
            new_value="Updated Entity",
        )
        db_session.add(diff)
        db_session.commit()

        response = auth_client.get(
            f"/api/entities/test:entity_123/history?organization_id={org.organization_id}"
        )

        assert response.status_code == 200
        data = response.get_json()

        assert data["entity_key"] == "test:entity_123"
        assert len(data["items"]) == 2
        assert data["total"] == 2

        # Events should be newest first
        first_event = data["items"][0]
        assert first_event["event_type"] == "Updated"
        assert len(first_event["field_diffs"]) == 1
        assert first_event["field_diffs"][0]["field_name"] == "title"

        second_event = data["items"][1]
        assert second_event["event_type"] == "Created"

    def test_get_entity_history_not_found(self, auth_setup, db_session):
        """Test that non-existent entity returns 404."""
        auth_client, org, user = auth_setup

        response = auth_client.get(
            f"/api/entities/nonexistent:999/history?organization_id={org.organization_id}"
        )

        assert response.status_code == 404
        data = response.get_json()
        assert data.get("error", {}).get("code") in ("not_found", "entity_not_found")

    def test_get_entity_history_missing_organization_id(self, auth_setup):
        """Test that missing organization_id returns 400."""
        auth_client, org, user = auth_setup

        response = auth_client.get("/api/entities/test:123/history")

        assert response.status_code in (400, 422)
        data = response.get_json()
        assert (data.get("error", {}).get("code") in ("bad_request", "validation_error", "missing_parameter") or data.get("detail"))

    def test_get_entity_history_empty_history(self, auth_setup, db_session):
        """Test entity with no change history."""
        auth_client, org, user = auth_setup

        entity = EntityCurrent(
            organization_id=org.organization_id,
            entity_key="test:no_history",
            entity_type="object",
            source_system="test",
            source_id="no_history",
            payload={"title": "No History Entity"},
            payload_hash="hash_no_history",
            extracted_at=datetime.now(timezone.utc),
            last_seen_at=datetime.now(timezone.utc),
        )
        db_session.add(entity)
        db_session.commit()

        response = auth_client.get(
            f"/api/entities/test:no_history/history?organization_id={org.organization_id}"
        )

        assert response.status_code == 200
        data = response.get_json()

        assert data["entity_key"] == "test:no_history"
        assert len(data["items"]) == 0
        assert data["total"] == 0
        assert data["has_more"] is False

    def test_get_entity_history_pagination(self, auth_setup, db_session):
        """Test pagination of entity history."""
        auth_client, org, user = auth_setup

        run = Run(
            organization_id=org.organization_id,
            status="success",
            triggered_by="api",
            parameters={},
        )
        db_session.add(run)
        db_session.flush()

        entity = EntityCurrent(
            organization_id=org.organization_id,
            entity_key="test:pagination_test",
            entity_type="object",
            source_system="test",
            source_id="pagination_test",
            payload={"title": "Test Entity"},
            payload_hash="hash_pagination",
            extracted_at=datetime.now(timezone.utc),
            last_seen_at=datetime.now(timezone.utc),
        )
        db_session.add(entity)
        db_session.flush()

        base_time = datetime.now(timezone.utc)
        for i in range(25):
            change = ChangeEvent(
                organization_id=org.organization_id,
                run_id=run.run_id,
                entity_key="test:pagination_test",
                entity_type="object",
                change_type="updated" if i > 0 else "created",
                applied=True,
                changed_fields=["field"] if i > 0 else None,
                old_hash=f"hash_{i-1}" if i > 0 else None,
                new_hash=f"hash_{i}",
                summary=f"Change event {i}",
                occurred_at=base_time + timedelta(minutes=i),
            )
            db_session.add(change)

        db_session.commit()

        # Get first page
        response = auth_client.get(
            f"/api/entities/test:pagination_test/history?organization_id={org.organization_id}&limit=10"
        )

        assert response.status_code == 200
        data = response.get_json()

        assert len(data["items"]) == 10
        assert data["total"] == 25
        assert data["has_more"] is True
        assert data["next_cursor"] is not None

        # Get second page using cursor
        cursor = data["next_cursor"]
        response2 = auth_client.get(
            f"/api/entities/test:pagination_test/history?organization_id={org.organization_id}&limit=10&cursor={cursor}"
        )

        assert response2.status_code == 200
        data2 = response2.get_json()

        assert len(data2["items"]) == 10
        assert data2["has_more"] is True

        # Ensure no overlap between pages
        first_page_ids = {e["change_id"] for e in data["items"]}
        second_page_ids = {e["change_id"] for e in data2["items"]}
        assert first_page_ids.isdisjoint(second_page_ids)


class TestGetRunChanges:
    """Tests for GET /api/organizations/{org_id}/runs/{run_id}/changes endpoint."""

    def test_get_run_changes_success(self, auth_setup, db_session):
        """Test getting changes for a run."""
        auth_client, org, user = auth_setup

        run = Run(
            organization_id=org.organization_id,
            status="success",
            triggered_by="api",
            parameters={},
        )
        db_session.add(run)
        db_session.flush()

        change = ChangeEvent(
            organization_id=org.organization_id,
            run_id=run.run_id,
            entity_key="test:123",
            entity_type="object",
            change_type="updated",
            applied=True,
            changed_fields=["title"],
            old_hash="hash1",
            new_hash="hash2",
            summary="Updated 1 field",
        )
        db_session.add(change)
        db_session.flush()

        diff = FieldDiff(
            organization_id=org.organization_id,
            change_id=change.change_id,
            field_name="title",
            old_value="Old Title",
            new_value="New Title",
        )
        db_session.add(diff)
        db_session.commit()

        response = auth_client.get(
            f"/api/organizations/{org.organization_id}/runs/{run.run_id}/changes"
        )

        assert response.status_code == 200
        data = response.get_json()

        assert "items" in data
        assert len(data["items"]) == 1
        assert data["total"] == 1

        change_data = data["items"][0]
        assert change_data["entity_key"] == "test:123"
        assert change_data["change_type"] == "updated"
        assert len(change_data["field_diffs"]) == 1
        assert change_data["field_diffs"][0]["field_name"] == "title"

    def test_get_run_changes_not_found(self, auth_setup):
        """Test that non-existent run returns 404."""
        auth_client, org, user = auth_setup
        import uuid
        fake_run_id = uuid.uuid4()

        response = auth_client.get(
            f"/api/organizations/{org.organization_id}/runs/{fake_run_id}/changes"
        )

        assert response.status_code == 404
        data = response.get_json()
        assert data.get("error", {}).get("code") in ("not_found", "run_not_found")

    def test_get_run_changes_requires_auth(self, client):
        """Test that getting run changes requires authentication."""
        import uuid
        response = client.get(
            f"/api/organizations/{uuid.uuid4()}/runs/{uuid.uuid4()}/changes"
        )
        assert response.status_code == 401
