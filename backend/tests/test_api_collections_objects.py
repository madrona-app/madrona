"""
Smoke tests for Collection Object CRUD operations.

Covers the core CRUD endpoints under:
    /api/organizations/<org_id>/collections/objects

Mocks OpenSearch indexing so tests run against SQLite in-memory DB.
"""

import json
from unittest.mock import patch
from uuid import uuid4

import pytest

from app.models import CollectionObject


def _post_json(auth_client, url, data):
    """Helper for POST with JSON body."""
    return auth_client.post(url, data=json.dumps(data), content_type="application/json")


def _put_json(auth_client, url, data):
    """Helper for PUT with JSON body."""
    return auth_client.put(url, data=json.dumps(data), content_type="application/json")


def _base_url(org):
    """Build the base URL for collection objects."""
    return f"/api/organizations/{org.organization_id}/collections/objects"


# ---------------------------------------------------------------------------
# List objects
# ---------------------------------------------------------------------------


class TestListObjectsEmpty:
    def test_list_returns_empty_when_no_objects(self, auth_setup):
        """GET /collections/objects returns empty list and total=0 when no objects exist."""
        auth_client, org, _ = auth_setup
        resp = auth_client.get(_base_url(org))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["items"] == []
        assert data["total"] == 0


# ---------------------------------------------------------------------------
# Create object
# ---------------------------------------------------------------------------


class TestCreateObject:
    @patch("app.fastapi_app.routers.collections_objects._index_collection_object")
    def test_create_minimal_object(self, mock_index, auth_setup):
        """POST with only object_number succeeds with 201."""
        auth_client, org, _ = auth_setup
        url = _base_url(org)
        resp = _post_json(auth_client, url, {"object_number": "SMOKE.1"})
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["object_number"] == "SMOKE.1"
        assert data["organization_id"] == str(org.organization_id)
        assert "object_id" in data
        mock_index.assert_called_once()

    @patch("app.fastapi_app.routers.collections_objects._index_collection_object")
    def test_create_object_missing_number_returns_400(self, mock_index, auth_setup):
        """POST without object_number returns 400."""
        auth_client, org, _ = auth_setup
        url = _base_url(org)
        resp = _post_json(auth_client, url, {"object_name": "No number provided"})
        assert resp.status_code in (400, 422)


# ---------------------------------------------------------------------------
# Get object by ID
# ---------------------------------------------------------------------------


class TestGetObjectById:
    @patch("app.fastapi_app.routers.collections_objects._index_collection_object")
    def test_get_existing_object(self, mock_index, auth_setup):
        """GET /objects/<id> returns the created object."""
        auth_client, org, _ = auth_setup
        url = _base_url(org)
        create_resp = _post_json(auth_client, url, {
            "object_number": "GETBYID.1",
            "object_name": "Test Object",
        })
        assert create_resp.status_code == 201
        object_id = create_resp.get_json()["object_id"]

        resp = auth_client.get(f"{url}/{object_id}")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["object_number"] == "GETBYID.1"
        assert data["object_name"] == "Test Object"

    def test_get_nonexistent_object_returns_404(self, auth_setup):
        """GET /objects/<random-uuid> returns 404."""
        auth_client, org, _ = auth_setup
        url = f"{_base_url(org)}/{uuid4()}"
        resp = auth_client.get(url)
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Update object
# ---------------------------------------------------------------------------


class TestUpdateObject:
    @patch("app.fastapi_app.routers.collections_objects._index_collection_object")
    def test_update_object_fields(self, mock_index, auth_setup):
        """PUT /objects/<id> updates mutable fields and returns 200."""
        auth_client, org, _ = auth_setup
        url = _base_url(org)
        create_resp = _post_json(auth_client, url, {
            "object_number": "UPD.SMOKE.1",
            "object_name": "Original Name",
        })
        assert create_resp.status_code == 201
        object_id = create_resp.get_json()["object_id"]

        resp = _put_json(auth_client, f"{url}/{object_id}", {
            "object_name": "Updated Name",
            "brief_description": "Now with description",
        })
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["object_name"] == "Updated Name"
        assert data["brief_description"] == "Now with description"
        # object_number should remain unchanged
        assert data["object_number"] == "UPD.SMOKE.1"


# ---------------------------------------------------------------------------
# Delete object
# ---------------------------------------------------------------------------


class TestDeleteObject:
    @patch("app.fastapi_app.routers.collections_objects._delete_collection_object_from_index")
    @patch("app.fastapi_app.routers.collections_objects._index_collection_object")
    def test_delete_object_and_verify_gone(self, mock_index, mock_del_index, auth_setup):
        """DELETE /objects/<id> removes the object; subsequent GET returns 404."""
        auth_client, org, _ = auth_setup
        url = _base_url(org)
        create_resp = _post_json(auth_client, url, {"object_number": "DEL.SMOKE.1"})
        assert create_resp.status_code == 201
        object_id = create_resp.get_json()["object_id"]

        resp = auth_client.delete(f"{url}/{object_id}")
        assert resp.status_code == 200

        # Confirm it is gone
        get_resp = auth_client.get(f"{url}/{object_id}")
        assert get_resp.status_code == 404


# ---------------------------------------------------------------------------
# Auth required (401)
# ---------------------------------------------------------------------------


class TestAuthRequired:
    def test_list_objects_requires_auth(self, client, auth_setup):
        """Unauthenticated GET returns 401."""
        _, org, _ = auth_setup
        resp = client.get(_base_url(org))
        assert resp.status_code == 401

    def test_create_object_requires_auth(self, client, auth_setup):
        """Unauthenticated POST returns 401."""
        _, org, _ = auth_setup
        resp = client.post(
            _base_url(org),
            data=json.dumps({"object_number": "NOAUTH.1"}),
            content_type="application/json",
        )
        assert resp.status_code == 401

    def test_delete_object_requires_auth(self, client, auth_setup):
        """Unauthenticated DELETE returns 401."""
        _, org, _ = auth_setup
        resp = client.delete(f"{_base_url(org)}/{uuid4()}")
        assert resp.status_code == 401
