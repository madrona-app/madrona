"""
Smoke tests for the Exhibit API module.

Covers representative CRUD operations for venues and exhibitions
under /api/organizations/<org_id>/exhibit/.

Uses SQLite in-memory database via the conftest fixtures.
"""

import json
from uuid import uuid4

import pytest

from app.models import Exhibition, Venue


def _post_json(auth_client, url, data):
    """Helper for POST with JSON body."""
    return auth_client.post(url, data=json.dumps(data), content_type="application/json")


def _patch_json(auth_client, url, data):
    """Helper for PATCH with JSON body."""
    return auth_client.patch(url, data=json.dumps(data), content_type="application/json")


def _exhibit_url(org, path=""):
    """Build a URL under the exhibit blueprint."""
    return f"/api/organizations/{org.organization_id}/exhibit{path}"


# ============================================================================
# Exhibitions - List
# ============================================================================


class TestListExhibitions:
    def test_list_exhibitions_empty(self, auth_setup):
        """GET /exhibit/exhibitions returns an empty list when no exhibitions exist."""
        auth_client, org, _ = auth_setup
        resp = auth_client.get(_exhibit_url(org, "/exhibitions"))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["exhibitions"] == []

    def test_list_exhibitions_returns_created(self, auth_setup):
        """After creating an exhibition, list endpoint includes it."""
        auth_client, org, _ = auth_setup
        # Create one exhibition
        _post_json(auth_client, _exhibit_url(org, "/exhibitions"), {
            "title": "Test Exhibition",
        })
        resp = auth_client.get(_exhibit_url(org, "/exhibitions"))
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data["exhibitions"]) >= 1
        titles = [e["title"] for e in data["exhibitions"]]
        assert "Test Exhibition" in titles


# ============================================================================
# Exhibitions - Create
# ============================================================================


class TestCreateExhibition:
    def test_create_exhibition(self, auth_setup):
        """POST /exhibit/exhibitions creates an exhibition and returns 201."""
        auth_client, org, _ = auth_setup
        resp = _post_json(auth_client, _exhibit_url(org, "/exhibitions"), {
            "title": "New Show",
            "description": "A great exhibition",
            "exhibition_type": "temporary",
        })
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["title"] == "New Show"
        assert "exhibition_id" in data
        assert data["message"] == "Exhibition created successfully"

    def test_create_exhibition_missing_title(self, auth_setup):
        """POST /exhibit/exhibitions without title returns 400."""
        auth_client, org, _ = auth_setup
        resp = _post_json(auth_client, _exhibit_url(org, "/exhibitions"), {
            "description": "No title provided",
        })
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "title" in (_e.get("message", "") if isinstance(_e, dict) else str(_e)).lower()

    def test_create_exhibition_empty_body(self, auth_setup):
        """POST /exhibit/exhibitions with empty body returns 400."""
        auth_client, org, _ = auth_setup
        resp = _post_json(auth_client, _exhibit_url(org, "/exhibitions"), {})
        assert resp.status_code in (400, 422)


# ============================================================================
# Exhibitions - Get by ID
# ============================================================================


class TestGetExhibition:
    def test_get_exhibition_by_id(self, auth_setup):
        """GET /exhibit/exhibitions/<id> returns the exhibition details."""
        auth_client, org, _ = auth_setup
        # Create
        create_resp = _post_json(auth_client, _exhibit_url(org, "/exhibitions"), {
            "title": "Fetched Show",
            "exhibition_type": "permanent",
        })
        assert create_resp.status_code == 201
        exhibition_id = create_resp.get_json()["exhibition_id"]

        # Fetch
        resp = auth_client.get(_exhibit_url(org, f"/exhibitions/{exhibition_id}"))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["title"] == "Fetched Show"
        assert data["exhibition_id"] == exhibition_id
        assert data["exhibition_type"] == "permanent"

    def test_get_exhibition_not_found(self, auth_setup):
        """GET /exhibit/exhibitions/<nonexistent-id> returns 404."""
        auth_client, org, _ = auth_setup
        fake_id = str(uuid4())
        resp = auth_client.get(_exhibit_url(org, f"/exhibitions/{fake_id}"))
        assert resp.status_code == 404
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "not found" in (_e.get("message", "") if isinstance(_e, dict) else str(_e)).lower()


# ============================================================================
# Exhibitions - Update
# ============================================================================


class TestUpdateExhibition:
    def test_update_exhibition(self, auth_setup):
        """PATCH /exhibit/exhibitions/<id> updates fields and returns 200."""
        auth_client, org, _ = auth_setup
        # Create
        create_resp = _post_json(auth_client, _exhibit_url(org, "/exhibitions"), {
            "title": "Original Title",
        })
        exhibition_id = create_resp.get_json()["exhibition_id"]

        # Update
        resp = _patch_json(auth_client, _exhibit_url(org, f"/exhibitions/{exhibition_id}"), {
            "title": "Updated Title",
            "description": "Now with a description",
        })
        assert resp.status_code == 200
        assert resp.get_json()["message"] == "Exhibition updated successfully"

        # Verify the update
        get_resp = auth_client.get(_exhibit_url(org, f"/exhibitions/{exhibition_id}"))
        assert get_resp.status_code == 200
        data = get_resp.get_json()
        assert data["title"] == "Updated Title"
        assert data["description"] == "Now with a description"

    def test_update_exhibition_not_found(self, auth_setup):
        """PATCH /exhibit/exhibitions/<nonexistent-id> returns 404."""
        auth_client, org, _ = auth_setup
        fake_id = str(uuid4())
        resp = _patch_json(auth_client, _exhibit_url(org, f"/exhibitions/{fake_id}"), {
            "title": "Ghost",
        })
        assert resp.status_code == 404


# ============================================================================
# Exhibitions - Delete
# ============================================================================


class TestDeleteExhibition:
    def test_delete_exhibition(self, auth_setup):
        """DELETE /exhibit/exhibitions/<id> removes the exhibition."""
        auth_client, org, _ = auth_setup
        # Create
        create_resp = _post_json(auth_client, _exhibit_url(org, "/exhibitions"), {
            "title": "To Be Deleted",
        })
        exhibition_id = create_resp.get_json()["exhibition_id"]

        # Delete
        resp = auth_client.delete(_exhibit_url(org, f"/exhibitions/{exhibition_id}"))
        assert resp.status_code == 200
        assert "deleted" in resp.get_json()["message"].lower()

        # Confirm gone
        get_resp = auth_client.get(_exhibit_url(org, f"/exhibitions/{exhibition_id}"))
        assert get_resp.status_code == 404

    def test_delete_exhibition_not_found(self, auth_setup):
        """DELETE /exhibit/exhibitions/<nonexistent-id> returns 404."""
        auth_client, org, _ = auth_setup
        fake_id = str(uuid4())
        resp = auth_client.delete(_exhibit_url(org, f"/exhibitions/{fake_id}"))
        assert resp.status_code == 404


# ============================================================================
# Authorization
# ============================================================================


class TestExhibitAuth:
    def test_list_exhibitions_requires_auth(self, client, auth_setup):
        """GET /exhibit/exhibitions without auth returns 401."""
        _, org, _ = auth_setup
        resp = client.get(_exhibit_url(org, "/exhibitions"))
        assert resp.status_code == 401

    def test_create_exhibition_requires_auth(self, client, auth_setup):
        """POST /exhibit/exhibitions without auth returns 401."""
        _, org, _ = auth_setup
        resp = client.post(
            _exhibit_url(org, "/exhibitions"),
            data=json.dumps({"title": "Unauthed"}),
            content_type="application/json",
        )
        assert resp.status_code == 401
