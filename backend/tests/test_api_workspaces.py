"""
Smoke tests for the Workspaces API.

Routes under /api/organizations/<org_id>/workspaces.
Tests CRUD operations, auth requirements, and basic validation.
"""

import json
from uuid import uuid4

import pytest

from app.models import Workspace


def _post_json(auth_client, url, data):
    """Helper for POST with JSON body."""
    return auth_client.post(url, data=json.dumps(data), content_type="application/json")


def _patch_json(auth_client, url, data):
    """Helper for PATCH with JSON body."""
    return auth_client.patch(url, data=json.dumps(data), content_type="application/json")


# ============================================================================
# List workspaces
# ============================================================================


class TestListWorkspaces:
    def test_list_empty(self, auth_setup):
        """Listing workspaces on a fresh org returns an empty list."""
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/workspaces"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["items"] == []
        assert data["total"] == 0

    def test_list_returns_created_workspace(self, auth_setup):
        """After creating a workspace it appears in the list."""
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/workspaces"
        _post_json(auth_client, url, {"name": "My Set"})
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1
        assert data["items"][0]["name"] == "My Set"


# ============================================================================
# Create workspace
# ============================================================================


class TestCreateWorkspace:
    def test_create_minimal(self, auth_setup):
        """Creating a workspace with just a name succeeds."""
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/workspaces"
        resp = _post_json(auth_client, url, {"name": "Test Workspace"})
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["name"] == "Test Workspace"
        assert data["visibility"] == "private"
        assert data["workspace_type"] == "collections"
        assert "workspace_id" in data

    def test_create_with_description_and_visibility(self, auth_setup):
        """Creating a workspace with optional fields populates them."""
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/workspaces"
        payload = {
            "name": "Shared Set",
            "description": "A shared workspace",
            "visibility": "org",
        }
        resp = _post_json(auth_client, url, payload)
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["description"] == "A shared workspace"
        assert data["visibility"] == "org"

    def test_create_missing_name(self, auth_setup):
        """Creating a workspace without a name returns 400."""
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/workspaces"
        resp = _post_json(auth_client, url, {})
        assert resp.status_code in (400, 422)


# ============================================================================
# Get workspace by ID
# ============================================================================


class TestGetWorkspace:
    def test_get_by_id(self, auth_setup):
        """Fetching a workspace by ID returns its details."""
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/workspaces"
        create_resp = _post_json(auth_client, url, {"name": "Fetch Me"})
        ws_id = create_resp.get_json()["workspace_id"]

        resp = auth_client.get(f"{url}/{ws_id}")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["workspace_id"] == ws_id
        assert data["name"] == "Fetch Me"
        assert data["is_owner"] is True
        assert data["permission_level"] == "admin"

    def test_get_not_found(self, auth_setup):
        """Fetching a non-existent workspace returns 404."""
        auth_client, org, _ = auth_setup
        fake_id = str(uuid4())
        url = f"/api/organizations/{org.organization_id}/workspaces/{fake_id}"
        resp = auth_client.get(url)
        assert resp.status_code == 404


# ============================================================================
# Update workspace
# ============================================================================


class TestUpdateWorkspace:
    def test_update_name(self, auth_setup):
        """Patching a workspace updates its name."""
        auth_client, org, _ = auth_setup
        base_url = f"/api/organizations/{org.organization_id}/workspaces"
        create_resp = _post_json(auth_client, base_url, {"name": "Original"})
        ws_id = create_resp.get_json()["workspace_id"]

        resp = _patch_json(auth_client, f"{base_url}/{ws_id}", {"name": "Renamed"})
        assert resp.status_code == 200
        assert resp.get_json()["name"] == "Renamed"

    def test_update_not_found(self, auth_setup):
        """Patching a non-existent workspace returns 404."""
        auth_client, org, _ = auth_setup
        fake_id = str(uuid4())
        url = f"/api/organizations/{org.organization_id}/workspaces/{fake_id}"
        resp = _patch_json(auth_client, url, {"name": "Nope"})
        assert resp.status_code == 404


# ============================================================================
# Delete workspace
# ============================================================================


class TestDeleteWorkspace:
    def test_delete_workspace(self, auth_setup):
        """Deleting a workspace soft-deletes it (disappears from list)."""
        auth_client, org, _ = auth_setup
        base_url = f"/api/organizations/{org.organization_id}/workspaces"
        create_resp = _post_json(auth_client, base_url, {"name": "To Delete"})
        ws_id = create_resp.get_json()["workspace_id"]

        del_resp = auth_client.delete(f"{base_url}/{ws_id}")
        assert del_resp.status_code == 200
        del_body = del_resp.get_json()
        # Endpoint returns a MessageResponse: {"message": "Workspace deleted"}
        assert "message" in del_body
        assert "delete" in del_body["message"].lower()

        # Verify it no longer appears in listing
        list_resp = auth_client.get(base_url)
        ws_ids = [w["workspace_id"] for w in list_resp.get_json()["items"]]
        assert ws_id not in ws_ids

    def test_delete_not_found(self, auth_setup):
        """Deleting a non-existent workspace returns 404."""
        auth_client, org, _ = auth_setup
        fake_id = str(uuid4())
        url = f"/api/organizations/{org.organization_id}/workspaces/{fake_id}"
        resp = auth_client.delete(url)
        assert resp.status_code == 404


# ============================================================================
# Auth required (no token)
# ============================================================================


class TestAuthRequired:
    def test_list_requires_auth(self, client, db_session):
        """GET workspaces without a token returns 401."""
        fake_org = str(uuid4())
        resp = client.get(f"/api/organizations/{fake_org}/workspaces")
        assert resp.status_code == 401

    def test_create_requires_auth(self, client, db_session):
        """POST workspaces without a token returns 401."""
        fake_org = str(uuid4())
        resp = client.post(
            f"/api/organizations/{fake_org}/workspaces",
            data=json.dumps({"name": "No Auth"}),
            content_type="application/json",
        )
        assert resp.status_code == 401
