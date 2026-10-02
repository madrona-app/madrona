"""
Smoke tests for the CDWA & Secondary Procedures API.

Covers representative CRUD operations on Person Authorities
(/api/organizations/<org_id>/collections/authorities).

These tests exercise the main code paths in the collections_cdwa_procedure
blueprint: list, create, get, update, delete, not-found, and auth-required.
"""

import json
from uuid import uuid4

import pytest

from app.models import PersonAuthority


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _base_url(org):
    """Build the authorities list/create URL."""
    return f"/api/organizations/{org.organization_id}/collections/authorities"


def _detail_url(org, authority_id):
    """Build the single-authority URL."""
    return f"{_base_url(org)}/{authority_id}"


def _post_json(auth_client, url, data):
    """POST JSON data via authenticated client."""
    return auth_client.post(url, data=json.dumps(data), content_type="application/json")


def _put_json(auth_client, url, data):
    """PUT JSON data via authenticated client."""
    return auth_client.put(url, data=json.dumps(data), content_type="application/json")


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------

class TestListPersonAuthorities:
    def test_list_empty(self, auth_setup):
        """Listing authorities when none exist returns an empty array."""
        auth_client, org, _ = auth_setup
        resp = auth_client.get(_base_url(org))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["items"] == []
        assert data["total"] == 0

    def test_list_returns_created_authority(self, auth_setup):
        """A newly created authority appears in the list."""
        auth_client, org, _ = auth_setup
        _post_json(auth_client, _base_url(org), {"preferred_name": "Jane Doe"})

        resp = auth_client.get(_base_url(org))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] >= 1
        names = [a["preferred_name"] for a in data["items"]]
        assert "Jane Doe" in names


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

class TestCreatePersonAuthority:
    def test_create_basic(self, auth_setup):
        """Creating an authority with just preferred_name succeeds (201)."""
        auth_client, org, _ = auth_setup
        resp = _post_json(auth_client, _base_url(org), {
            "preferred_name": "Claude Monet",
            "nationality": "French",
        })
        assert resp.status_code == 201
        body = resp.get_json()
        assert body["preferred_name"] == "Claude Monet"
        assert body["nationality"] == "French"
        assert "authority_id" in body

    def test_create_missing_name_returns_400(self, auth_setup):
        """Missing preferred_name is rejected with 400."""
        auth_client, org, _ = auth_setup
        resp = _post_json(auth_client, _base_url(org), {"nationality": "French"})
        assert resp.status_code in (400, 422)


# ---------------------------------------------------------------------------
# Get by ID
# ---------------------------------------------------------------------------

class TestGetPersonAuthority:
    def test_get_by_id(self, auth_setup):
        """Fetching a single authority by ID returns the correct record."""
        auth_client, org, _ = auth_setup
        create_resp = _post_json(auth_client, _base_url(org), {
            "preferred_name": "Frida Kahlo",
        })
        assert create_resp.status_code == 201
        authority_id = create_resp.get_json()["authority_id"]

        resp = auth_client.get(_detail_url(org, authority_id))
        assert resp.status_code == 200
        assert resp.get_json()["preferred_name"] == "Frida Kahlo"

    def test_get_not_found(self, auth_setup):
        """Requesting a nonexistent ID returns 404."""
        auth_client, org, _ = auth_setup
        fake_id = str(uuid4())
        resp = auth_client.get(_detail_url(org, fake_id))
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------

class TestUpdatePersonAuthority:
    def test_update_fields(self, auth_setup):
        """PUTting updated fields persists the changes."""
        auth_client, org, _ = auth_setup
        create_resp = _post_json(auth_client, _base_url(org), {
            "preferred_name": "Pablo Picasso",
        })
        assert create_resp.status_code == 201
        authority_id = create_resp.get_json()["authority_id"]

        update_resp = _put_json(auth_client, _detail_url(org, authority_id), {
            "nationality": "Spanish",
            "biography": "Cubist painter",
        })
        assert update_resp.status_code == 200
        body = update_resp.get_json()
        assert body["nationality"] == "Spanish"
        assert body["biography"] == "Cubist painter"
        # preferred_name should remain unchanged
        assert body["preferred_name"] == "Pablo Picasso"


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

class TestDeletePersonAuthority:
    def test_delete_authority(self, auth_setup):
        """Deleting an authority removes it; subsequent GET returns 404."""
        auth_client, org, _ = auth_setup
        create_resp = _post_json(auth_client, _base_url(org), {
            "preferred_name": "Delete Me",
        })
        assert create_resp.status_code == 201
        authority_id = create_resp.get_json()["authority_id"]

        del_resp = auth_client.delete(_detail_url(org, authority_id))
        assert del_resp.status_code == 200

        get_resp = auth_client.get(_detail_url(org, authority_id))
        assert get_resp.status_code == 404

    def test_delete_not_found(self, auth_setup):
        """Deleting a nonexistent authority returns 404."""
        auth_client, org, _ = auth_setup
        fake_id = str(uuid4())
        resp = auth_client.delete(_detail_url(org, fake_id))
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Auth required (unauthenticated requests)
# ---------------------------------------------------------------------------

class TestAuthRequired:
    def test_list_requires_auth(self, client, auth_setup):
        """Unauthenticated GET on the list endpoint returns 401."""
        _, org, _ = auth_setup
        resp = client.get(_base_url(org))
        assert resp.status_code == 401

    def test_create_requires_auth(self, client, auth_setup):
        """Unauthenticated POST returns 401."""
        _, org, _ = auth_setup
        resp = client.post(
            _base_url(org),
            data=json.dumps({"preferred_name": "Unauthorized"}),
            content_type="application/json",
        )
        assert resp.status_code == 401
