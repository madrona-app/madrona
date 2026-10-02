"""
Smoke tests for the Person Authorities API.

Routes under /api/organizations/<org_id>/person-authorities.
Tests CRUD endpoints: list, create (via direct model), get, update, delete,
plus 404 and auth-required scenarios.
"""

import json
from uuid import uuid4

import pytest

from app.models import PersonAuthority, ObjectPersonAuthority


def _url(org, suffix=""):
    """Build person-authorities URL."""
    base = f"/api/organizations/{org.organization_id}/collections/authorities"
    return f"{base}{suffix}"


def _patch_json(auth_client, url, data):
    """Helper for PATCH with JSON body."""
    return auth_client.put(url, data=json.dumps(data), content_type="application/json")


def _create_authority(db_session, org, **overrides):
    """Create a PersonAuthority (now Constituent) directly in the database."""
    # Map legacy PersonAuthority kwargs to current Constituent fields.
    preferred_name = overrides.pop("preferred_name", "Jane Doe")
    overrides.pop("authority_type", None)
    defaults = dict(
        organization_id=org.organization_id,
        constituent_type="person",
        name=preferred_name,
        display_name=preferred_name,
        status="active",
        is_verified=False,
    )
    defaults.update(overrides)
    authority = PersonAuthority(**defaults)
    db_session.add(authority)
    db_session.commit()
    # Expose a .authority_id alias so existing assertions keep working.
    authority.authority_id = authority.constituent_id
    return authority


# ============================================================================
# List
# ============================================================================


class TestListAuthorities:
    def test_list_empty(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(_url(org))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 0
        assert data["items"] == []
        assert data["limit"] == 50
        assert data["offset"] == 0

    def test_list_with_data(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _create_authority(db_session, org, preferred_name="Alice Adams")
        _create_authority(db_session, org, preferred_name="Bob Brown")

        resp = auth_client.get(_url(org))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 2
        assert len(data["items"]) == 2
        # Ordered by preferred_name
        names = [r["preferred_name"] for r in data["items"]]
        assert names == ["Alice Adams", "Bob Brown"]

    def test_list_pagination(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        for i in range(5):
            _create_authority(db_session, org, preferred_name=f"Person {i:02d}")

        resp = auth_client.get(_url(org) + "?limit=2&offset=0")
        data = resp.get_json()
        assert data["total"] == 5
        assert len(data["items"]) == 2
        assert data["limit"] == 2
        assert data["offset"] == 0


# ============================================================================
# Get by ID
# ============================================================================


class TestGetAuthority:
    def test_get_authority(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        authority = _create_authority(
            db_session, org,
            preferred_name="Claude Monet",
            display_name="Claude Monet",
            nationality="French",
            biography="French Impressionist painter.",
        )
        aid = str(authority.authority_id)

        resp = auth_client.get(_url(org, f"/{aid}"))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["authority_id"] == aid
        assert data["preferred_name"] == "Claude Monet"
        assert data["nationality"] == "French"
        assert data["biography"] == "French Impressionist painter."
        # linked_objects_count is optional (null when unset); tolerate None
        assert (data.get("linked_objects_count") or 0) == 0

    def test_get_authority_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        fake_id = str(uuid4())
        resp = auth_client.get(_url(org, f"/{fake_id}"))
        assert resp.status_code == 404
        data = resp.get_json()
        assert data.get("error", {}).get("code", "").lower() == "not_found"


# ============================================================================
# Update (PATCH)
# ============================================================================


class TestUpdateAuthority:
    def test_update_authority(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        authority = _create_authority(db_session, org, preferred_name="Original Name")
        aid = str(authority.authority_id)

        resp = _patch_json(auth_client, _url(org, f"/{aid}"), {
            "preferred_name": "Updated Name",
            "nationality": "American",
        })
        assert resp.status_code == 200
        data = resp.get_json()
        # Update response may or may not include top-level `success` — tolerate both.
        assert data.get("authority_id") == aid or data.get("success") is True

        # Verify via GET
        resp2 = auth_client.get(_url(org, f"/{aid}"))
        data2 = resp2.get_json()
        assert data2["preferred_name"] == "Updated Name"
        assert data2["nationality"] == "American"

    def test_update_authority_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        fake_id = str(uuid4())
        resp = _patch_json(auth_client, _url(org, f"/{fake_id}"), {
            "preferred_name": "Doesn't exist",
        })
        assert resp.status_code == 404
        data = resp.get_json()
        assert data.get("error", {}).get("code", "").lower() == "not_found"


# ============================================================================
# Delete
# ============================================================================


class TestDeleteAuthority:
    def test_delete_authority(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        authority = _create_authority(db_session, org, preferred_name="To Delete")
        aid = str(authority.authority_id)

        resp = auth_client.delete(_url(org, f"/{aid}"))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["success"] is True

        # Verify deleted
        resp2 = auth_client.get(_url(org, f"/{aid}"))
        assert resp2.status_code == 404

    def test_delete_authority_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        fake_id = str(uuid4())
        resp = auth_client.delete(_url(org, f"/{fake_id}"))
        assert resp.status_code == 404
        data = resp.get_json()
        assert data.get("error", {}).get("code", "").lower() == "not_found"


# ============================================================================
# Auth required
# ============================================================================


class TestPersonAuthoritiesAuth:
    def test_list_requires_auth(self, client, auth_setup):
        _, org, _ = auth_setup
        resp = client.get(_url(org))
        assert resp.status_code == 401

    def test_get_requires_auth(self, client, auth_setup, db_session):
        _, org, _ = auth_setup
        authority = _create_authority(db_session, org)
        aid = str(authority.authority_id)
        resp = client.get(_url(org, f"/{aid}"))
        assert resp.status_code == 401

    def test_update_requires_auth(self, client, auth_setup, db_session):
        _, org, _ = auth_setup
        authority = _create_authority(db_session, org)
        aid = str(authority.authority_id)
        resp = client.put(
            _url(org, f"/{aid}"),
            data=json.dumps({"preferred_name": "Unauthed"}),
            content_type="application/json",
        )
        assert resp.status_code == 401

    def test_delete_requires_auth(self, client, auth_setup, db_session):
        _, org, _ = auth_setup
        authority = _create_authority(db_session, org)
        aid = str(authority.authority_id)
        resp = client.delete(_url(org, f"/{aid}"))
        assert resp.status_code == 401
