"""
Smoke tests for the Object Parts API.

Routes under /api/organizations/<org_id>/collections/objects/<object_id>/parts.
Tests cover CRUD operations for object parts (multi-part location tracking).
"""

import json
from uuid import uuid4

import pytest

from app.models import CollectionObject, ObjectPart, Location


def _post_json(auth_client, url, data):
    """Helper for POST with JSON body."""
    return auth_client.post(url, data=json.dumps(data), content_type="application/json")


def _put_json(auth_client, url, data):
    """Helper for PUT with JSON body."""
    return auth_client.put(url, data=json.dumps(data), content_type="application/json")


def _create_test_object(db_session, org_id, object_number="TEST.1"):
    """Create a CollectionObject directly in the DB for part tests."""
    obj = CollectionObject(
        organization_id=org_id,
        object_number=object_number,
        object_name="Test Object",
    )
    db_session.add(obj)
    db_session.commit()
    db_session.refresh(obj)
    return obj


def _create_test_part(db_session, org_id, object_id, name="Part A", part_number=None, display_order=0):
    """Create an ObjectPart directly in the DB."""
    part = ObjectPart(
        organization_id=org_id,
        object_id=object_id,
        name=name,
        part_number=part_number,
        display_order=display_order,
    )
    db_session.add(part)
    db_session.commit()
    db_session.refresh(part)
    return part


# ============================================================================
# List Parts
# ============================================================================


class TestListParts:
    def test_list_parts_empty(self, auth_setup, db_session):
        """Listing parts for an object with no parts returns empty list."""
        auth_client, org, _ = auth_setup
        obj = _create_test_object(db_session, org.organization_id)
        url = f"/api/organizations/{org.organization_id}/collections/objects/{obj.object_id}/parts"

        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["parts"] == []
        assert data["total"] == 0

    def test_list_parts_with_data(self, auth_setup, db_session):
        """Listing parts returns all parts for the object."""
        auth_client, org, _ = auth_setup
        obj = _create_test_object(db_session, org.organization_id)
        _create_test_part(db_session, org.organization_id, obj.object_id, name="Teapot", part_number="1", display_order=1)
        _create_test_part(db_session, org.organization_id, obj.object_id, name="Sugar Bowl", part_number="2", display_order=2)

        url = f"/api/organizations/{org.organization_id}/collections/objects/{obj.object_id}/parts"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 2
        assert len(data["parts"]) == 2
        # Parts should be ordered by display_order
        assert data["parts"][0]["name"] == "Teapot"
        assert data["parts"][1]["name"] == "Sugar Bowl"

    def test_list_parts_object_not_found(self, auth_setup):
        """Listing parts for a non-existent object returns 404."""
        auth_client, org, _ = auth_setup
        fake_object_id = uuid4()
        url = f"/api/organizations/{org.organization_id}/collections/objects/{fake_object_id}/parts"

        resp = auth_client.get(url)
        assert resp.status_code == 404


# ============================================================================
# Create Part
# ============================================================================


class TestCreatePart:
    def test_create_part_minimal(self, auth_setup, db_session):
        """Creating a part with minimal data succeeds."""
        auth_client, org, _ = auth_setup
        obj = _create_test_object(db_session, org.organization_id)
        url = f"/api/organizations/{org.organization_id}/collections/objects/{obj.object_id}/parts"

        resp = _post_json(auth_client, url, {"name": "Lid"})
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["name"] == "Lid"
        assert data["object_id"] == str(obj.object_id)
        assert data["organization_id"] == str(org.organization_id)
        assert "part_id" in data
        assert data["part_number"] is not None

    def test_create_part_with_details(self, auth_setup, db_session):
        """Creating a part with full details populates all fields."""
        auth_client, org, _ = auth_setup
        obj = _create_test_object(db_session, org.organization_id, object_number="FULL.1")
        url = f"/api/organizations/{org.organization_id}/collections/objects/{obj.object_id}/parts"

        payload = {
            "name": "Sugar Bowl",
            "description": "Silver sugar bowl with engraved monogram",
            "barcode": "SB-001-2024",
        }
        resp = _post_json(auth_client, url, payload)
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["name"] == "Sugar Bowl"
        assert data["description"] == "Silver sugar bowl with engraved monogram"
        # Backend auto-generates barcode now, ignoring user-supplied value
        assert data.get("barcode")

    def test_create_part_object_not_found(self, auth_setup):
        """Creating a part on a non-existent object returns 404."""
        auth_client, org, _ = auth_setup
        fake_object_id = uuid4()
        url = f"/api/organizations/{org.organization_id}/collections/objects/{fake_object_id}/parts"

        resp = _post_json(auth_client, url, {"name": "Ghost Part"})
        assert resp.status_code == 404


# ============================================================================
# Get Part by ID
# ============================================================================


class TestGetPart:
    def test_get_part(self, auth_setup, db_session):
        """Getting a part by ID returns the correct part."""
        auth_client, org, _ = auth_setup
        obj = _create_test_object(db_session, org.organization_id, object_number="GET.1")
        part = _create_test_part(db_session, org.organization_id, obj.object_id, name="Saucer", part_number="1")

        url = f"/api/organizations/{org.organization_id}/collections/objects/{obj.object_id}/parts/{part.part_id}"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["part_id"] == str(part.part_id)
        assert data["name"] == "Saucer"
        assert data["part_number"] == "1"

    def test_get_part_not_found(self, auth_setup, db_session):
        """Getting a non-existent part returns 404."""
        auth_client, org, _ = auth_setup
        obj = _create_test_object(db_session, org.organization_id, object_number="NF.1")
        fake_part_id = uuid4()

        url = f"/api/organizations/{org.organization_id}/collections/objects/{obj.object_id}/parts/{fake_part_id}"
        resp = auth_client.get(url)
        assert resp.status_code == 404


# ============================================================================
# Update Part
# ============================================================================


class TestUpdatePart:
    def test_update_part_name(self, auth_setup, db_session):
        """Updating a part's name persists the change."""
        auth_client, org, _ = auth_setup
        obj = _create_test_object(db_session, org.organization_id, object_number="UPD.1")
        part = _create_test_part(db_session, org.organization_id, obj.object_id, name="Old Name", part_number="1")

        url = f"/api/organizations/{org.organization_id}/collections/objects/{obj.object_id}/parts/{part.part_id}"
        resp = _put_json(auth_client, url, {"name": "New Name", "description": "Updated description"})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["name"] == "New Name"
        assert data["description"] == "Updated description"

    def test_update_part_not_found(self, auth_setup, db_session):
        """Updating a non-existent part returns 404."""
        auth_client, org, _ = auth_setup
        obj = _create_test_object(db_session, org.organization_id, object_number="UNF.1")
        fake_part_id = uuid4()

        url = f"/api/organizations/{org.organization_id}/collections/objects/{obj.object_id}/parts/{fake_part_id}"
        resp = _put_json(auth_client, url, {"name": "Phantom"})
        assert resp.status_code == 404


# ============================================================================
# Delete Part
# ============================================================================


class TestDeletePart:
    def test_delete_part(self, auth_setup, db_session):
        """Deleting one of multiple parts succeeds and returns 200."""
        auth_client, org, _ = auth_setup
        obj = _create_test_object(db_session, org.organization_id, object_number="DEL.1")
        part1 = _create_test_part(db_session, org.organization_id, obj.object_id, name="Keep", part_number="1", display_order=1)
        part2 = _create_test_part(db_session, org.organization_id, obj.object_id, name="Remove", part_number="2", display_order=2)

        url = f"/api/organizations/{org.organization_id}/collections/objects/{obj.object_id}/parts/{part2.part_id}"
        resp = auth_client.delete(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["success"] is True

        # Verify the deleted part returns 404
        resp = auth_client.get(url)
        assert resp.status_code == 404

    def test_delete_last_part_rejected(self, auth_setup, db_session):
        """Cannot delete the last remaining part of an object (400)."""
        auth_client, org, _ = auth_setup
        obj = _create_test_object(db_session, org.organization_id, object_number="DLR.1")
        part = _create_test_part(db_session, org.organization_id, obj.object_id, name="Only Part")

        url = f"/api/organizations/{org.organization_id}/collections/objects/{obj.object_id}/parts/{part.part_id}"
        resp = auth_client.delete(url)
        assert resp.status_code in (400, 422)
        data = resp.get_json()
        # Code may be "invalid_operation" or the generic "bad_request".
        assert data.get("error", {}).get("code") in ("invalid_operation", "bad_request", "validation_error")


# ============================================================================
# Authorization
# ============================================================================


class TestObjectPartsAuth:
    def test_list_requires_auth(self, client, auth_setup, db_session):
        """Unauthenticated request to list parts returns 401."""
        _, org, _ = auth_setup
        obj = _create_test_object(db_session, org.organization_id, object_number="AUTH.1")
        url = f"/api/organizations/{org.organization_id}/collections/objects/{obj.object_id}/parts"

        resp = client.get(url)
        assert resp.status_code == 401

    def test_create_requires_auth(self, client, auth_setup, db_session):
        """Unauthenticated request to create a part returns 401."""
        _, org, _ = auth_setup
        obj = _create_test_object(db_session, org.organization_id, object_number="AUTH.2")
        url = f"/api/organizations/{org.organization_id}/collections/objects/{obj.object_id}/parts"

        resp = client.post(
            url,
            data=json.dumps({"name": "Unauthorized Part"}),
            content_type="application/json",
        )
        assert resp.status_code == 401
