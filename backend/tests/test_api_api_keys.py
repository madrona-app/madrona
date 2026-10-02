"""
Smoke tests for the API Keys management endpoints.

Routes:
  POST   /api/organizations/<org_id>/api-keys      Create an API key
  GET    /api/organizations/<org_id>/api-keys       List API keys
  DELETE /api/api-keys/<api_key_id>                 Revoke an API key

Mocks generate_api_key / hash_api_key / get_api_key_prefix so tests
run against SQLite without needing real HMAC secrets.
"""

import json
from unittest.mock import patch
from uuid import uuid4

import pytest

from app.models import APIKey


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _post_json(auth_client, url, data):
    """Helper for POST with JSON body."""
    return auth_client.post(url, data=json.dumps(data), content_type="application/json")


def _put_json(auth_client, url, data):
    """Helper for PUT with JSON body."""
    return auth_client.put(url, data=json.dumps(data), content_type="application/json")


VALID_PAYLOAD = {
    "name": "Production Key",
    "scopes": ["read:datasets", "read:entities"],
}

# Patch targets for the crypto helpers used in the create endpoint
_PATCH_GENERATE = "app.services.auth_utils.generate_api_key"
_PATCH_HASH = "app.services.auth_utils.hash_api_key"
_PATCH_PREFIX = "app.services.auth_utils.get_api_key_prefix"


def _mock_key_helpers():
    """Return a triple of patches for the key-generation helpers."""
    return (
        patch(_PATCH_GENERATE, return_value="mkey_fake1234567890abcdef1234567890abcdef12"),
        patch(_PATCH_HASH, return_value="hashed_value_for_testing"),
        patch(_PATCH_PREFIX, return_value="mkey_fak"),
    )


# ============================================================================
# List API Keys
# ============================================================================


class TestListAPIKeys:
    def test_list_empty(self, auth_setup):
        """GET returns an empty list when no keys exist."""
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/api-keys"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["api_keys"] == []

    def test_list_returns_created_keys(self, auth_setup):
        """GET lists keys previously created via POST."""
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/api-keys"

        with _mock_key_helpers()[0], _mock_key_helpers()[1], _mock_key_helpers()[2]:
            _post_json(auth_client, url, {
                "name": "Key A",
                "scopes": ["read:datasets"],
            })
            _post_json(auth_client, url, {
                "name": "Key B",
                "scopes": ["read:entities"],
            })

        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data["api_keys"]) == 2
        names = {k["name"] for k in data["api_keys"]}
        assert names == {"Key A", "Key B"}


# ============================================================================
# Create API Key
# ============================================================================


class TestCreateAPIKey:
    def test_create_success(self, auth_setup):
        """POST with valid payload returns 201 and the secret key."""
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/api-keys"

        with _mock_key_helpers()[0], _mock_key_helpers()[1], _mock_key_helpers()[2]:
            resp = _post_json(auth_client, url, VALID_PAYLOAD)

        assert resp.status_code == 201
        body = resp.get_json()
        # Response may be wrapped {"data": {...}, "status": "ok"} or flat.
        payload = body.get("data", body)
        assert "api_key_id" in payload
        assert payload["name"] == "Production Key"
        assert len(payload["scopes"]) >= 1
        assert payload["key_prefix"] == "mkey_fak"
        assert "secret_api_key" in payload
        assert payload["status"] == "active"

    def test_create_missing_name(self, auth_setup):
        """POST without 'name' returns 400."""
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/api-keys"
        resp = _post_json(auth_client, url, {"scopes": ["read:datasets"]})
        assert resp.status_code in (400, 422)

    def test_create_missing_scopes(self, auth_setup):
        """POST without 'scopes' returns 400."""
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/api-keys"
        resp = _post_json(auth_client, url, {"name": "No Scopes"})
        assert resp.status_code in (400, 422)

    def test_create_invalid_scopes(self, auth_setup):
        """POST with an unrecognized scope returns 400."""
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/api-keys"

        with _mock_key_helpers()[0], _mock_key_helpers()[1], _mock_key_helpers()[2]:
            resp = _post_json(auth_client, url, {
                "name": "Bad Scope Key",
                "scopes": ["read:datasets", "write:nuclear_codes"],
            })

        assert resp.status_code in (400, 422)

    def test_create_duplicate_name(self, auth_setup):
        """POST with a name that already exists returns 409."""
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/api-keys"

        with _mock_key_helpers()[0], _mock_key_helpers()[1], _mock_key_helpers()[2]:
            resp1 = _post_json(auth_client, url, VALID_PAYLOAD)
            assert resp1.status_code == 201

            resp2 = _post_json(auth_client, url, VALID_PAYLOAD)
            assert resp2.status_code == 409


# ============================================================================
# Get / Not-Found
# ============================================================================


class TestGetAPIKeyNotFound:
    def test_list_does_not_expose_nonexistent_key(self, auth_setup):
        """Listing after creation only returns existing keys; random IDs aren't present."""
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/api-keys"
        resp = auth_client.get(url)
        data = resp.get_json()
        ids = {k["api_key_id"] for k in data["api_keys"]}
        assert str(uuid4()) not in ids

    def test_delete_nonexistent_key_returns_404(self, auth_setup):
        """DELETE for a key ID that does not exist returns 404."""
        auth_client, org, _ = auth_setup
        fake_id = str(uuid4())
        url = f"/api/api-keys/{fake_id}?organization_id={org.organization_id}"
        resp = auth_client.delete(url)
        assert resp.status_code == 404


# ============================================================================
# Delete (Revoke) API Key
# ============================================================================


class TestDeleteAPIKey:
    def test_revoke_key(self, auth_setup, db_session):
        """DELETE revokes an active key (status -> 'revoked')."""
        auth_client, org, _ = auth_setup
        base_url = f"/api/organizations/{org.organization_id}/api-keys"

        with _mock_key_helpers()[0], _mock_key_helpers()[1], _mock_key_helpers()[2]:
            create_resp = _post_json(auth_client, base_url, {
                "name": "Revocable Key",
                "scopes": ["read:datasets"],
            })
        assert create_resp.status_code == 201
        _body = create_resp.get_json()
        api_key_id = _body.get("data", _body)["api_key_id"]

        # Revoke
        delete_url = f"/api/api-keys/{api_key_id}?organization_id={org.organization_id}"
        resp = auth_client.delete(delete_url)
        assert resp.status_code == 200

        # Verify status changed in DB
        key_row = db_session.query(APIKey).filter_by(api_key_id=api_key_id).first()
        assert key_row is not None
        assert key_row.status == "revoked"

    def test_revoked_key_still_in_list(self, auth_setup):
        """After revoking, the key still appears in the list with status 'revoked'."""
        auth_client, org, _ = auth_setup
        base_url = f"/api/organizations/{org.organization_id}/api-keys"

        with _mock_key_helpers()[0], _mock_key_helpers()[1], _mock_key_helpers()[2]:
            create_resp = _post_json(auth_client, base_url, {
                "name": "Soon Revoked",
                "scopes": ["read:datasets"],
            })
        _body = create_resp.get_json()
        api_key_id = _body.get("data", _body)["api_key_id"]

        # Revoke
        delete_url = f"/api/api-keys/{api_key_id}?organization_id={org.organization_id}"
        auth_client.delete(delete_url)

        # List should still include it
        resp = auth_client.get(base_url)
        keys = resp.get_json()["api_keys"]
        revoked = [k for k in keys if k["api_key_id"] == api_key_id]
        assert len(revoked) == 1
        assert revoked[0]["status"] == "revoked"


# ============================================================================
# Auth Required (401)
# ============================================================================


class TestAPIKeysAuth:
    def test_list_requires_auth(self, client, auth_setup):
        """GET without auth token returns 401."""
        _, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/api-keys"
        resp = client.get(url)
        assert resp.status_code == 401

    def test_create_requires_auth(self, client, auth_setup):
        """POST without auth token returns 401."""
        _, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/api-keys"
        resp = client.post(
            url,
            data=json.dumps(VALID_PAYLOAD),
            content_type="application/json",
        )
        assert resp.status_code == 401

    def test_delete_requires_auth(self, client):
        """DELETE without auth token returns 401."""
        fake_id = str(uuid4())
        url = f"/api/api-keys/{fake_id}"
        resp = client.delete(url)
        assert resp.status_code == 401
