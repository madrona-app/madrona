"""
Smoke tests for the Organizations API.

Routes under /api/organizations, /api/timezones, /api/storage-regions.
Tests run against SQLite in-memory via the auth_setup fixture.
"""

import json
from uuid import uuid4

import pytest

from app.models import Organization, OrganizationMembership


def _post_json(auth_client, url, data):
    """Helper for POST with JSON body."""
    return auth_client.post(url, data=json.dumps(data), content_type="application/json")


def _patch_json(auth_client, url, data):
    """Helper for PATCH with JSON body."""
    return auth_client.patch(url, data=json.dumps(data), content_type="application/json")


# ============================================================================
# List Organizations
# ============================================================================


class TestListOrganizations:
    def test_list_organizations(self, auth_setup):
        """Authenticated user sees their organization."""
        auth_client, org, _ = auth_setup
        resp = auth_client.get("/api/organizations")
        assert resp.status_code == 200
        data = resp.get_json()
        assert isinstance(data, list)
        assert len(data) >= 1
        org_ids = [o["organization_id"] for o in data]
        assert str(org.organization_id) in org_ids

    def test_list_organizations_returns_expected_fields(self, auth_setup):
        """Response includes required fields."""
        auth_client, _, _ = auth_setup
        resp = auth_client.get("/api/organizations")
        assert resp.status_code == 200
        data = resp.get_json()
        first = data[0]
        for field in ("organization_id", "name", "slug", "timezone", "created_at"):
            assert field in first, f"Missing field: {field}"

    def test_list_organizations_requires_auth(self, client, auth_setup):
        """Unauthenticated request returns 401."""
        resp = client.get("/api/organizations")
        assert resp.status_code == 401


# ============================================================================
# Update Organization (PATCH)
# ============================================================================


class TestUpdateOrganization:
    def test_update_organization_name(self, auth_setup):
        """PATCH updates the organization name."""
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}"
        resp = _patch_json(auth_client, url, {"name": "Renamed Org"})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["name"] == "Renamed Org"
        assert data["message"] == "Organization updated successfully"

    def test_update_organization_timezone(self, auth_setup):
        """PATCH updates the organization timezone."""
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}"
        resp = _patch_json(auth_client, url, {"timezone": "America/New_York"})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["timezone"] == "America/New_York"

    def test_update_organization_invalid_timezone(self, auth_setup):
        """PATCH with invalid timezone returns 400."""
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}"
        resp = _patch_json(auth_client, url, {"timezone": "Not/A/Timezone"})
        assert resp.status_code in (400, 422)
        body = resp.get_json()
        # Route may return {"error": "..."} or {"message": "..."} depending on
        # how the response passes through middleware.
        _err = body.get("error")
        err_text = (_err.get("message") if isinstance(_err, dict) else _err) or body.get("message") or ""
        assert "Invalid timezone" in err_text

    def test_update_organization_not_found(self, auth_setup):
        """PATCH on a non-existent org returns 404."""
        auth_client, _, _ = auth_setup
        url = f"/api/organizations/{uuid4()}"
        resp = _patch_json(auth_client, url, {"name": "Ghost"})
        assert resp.status_code == 404

    def test_update_organization_empty_name(self, auth_setup):
        """PATCH with empty name returns 400."""
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}"
        resp = _patch_json(auth_client, url, {"name": "   "})
        assert resp.status_code in (400, 422)
        body = resp.get_json()
        _err = body.get("error")
        err_text = (_err.get("message") if isinstance(_err, dict) else _err) or body.get("message") or ""
        assert "empty" in err_text.lower()


# ============================================================================
# Timezones (public endpoint)
# ============================================================================


class TestTimezones:
    def test_list_common_timezones(self, client, auth_setup):
        """GET /api/timezones returns common timezones by default."""
        resp = client.get("/api/timezones")
        assert resp.status_code == 200
        data = resp.get_json()
        assert "timezones" in data
        assert isinstance(data["timezones"], list)
        assert len(data["timezones"]) > 0

    def test_list_all_timezones(self, client, auth_setup):
        """GET /api/timezones?all=true returns all IANA timezones."""
        resp = client.get("/api/timezones?all=true")
        assert resp.status_code == 200
        data = resp.get_json()
        all_tzs = data["timezones"]

        # "all" set should be at least as large as the common set
        resp_common = client.get("/api/timezones")
        common_tzs = resp_common.get_json()["timezones"]
        assert len(all_tzs) >= len(common_tzs)


# ============================================================================
# Storage Regions
# ============================================================================


class TestStorageRegions:
    def test_list_storage_regions(self, auth_setup):
        """GET /api/storage-regions returns available regions."""
        auth_client, _, _ = auth_setup
        resp = auth_client.get("/api/storage-regions")
        assert resp.status_code == 200
        data = resp.get_json()
        assert "regions" in data
        assert isinstance(data["regions"], list)
        assert len(data["regions"]) > 0
        # Each region should have code, name, default keys
        first = data["regions"][0]
        for field in ("code", "name", "default"):
            assert field in first

    def test_list_storage_regions_requires_auth(self, client, auth_setup):
        """Unauthenticated request returns 401."""
        resp = client.get("/api/storage-regions")
        assert resp.status_code == 401


# ============================================================================
# Organization Storage
# ============================================================================


class TestOrganizationStorage:
    def test_get_storage_for_own_org(self, auth_setup):
        """GET /api/organizations/<org_id>/storage returns data for member org."""
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/storage"
        resp = auth_client.get(url)
        # Should succeed (200) even if no tier is assigned
        assert resp.status_code == 200

    def test_get_storage_not_member(self, auth_setup):
        """Storage request for an org the user is not a member of returns 404."""
        auth_client, _, _ = auth_setup
        # Use a random UUID that the user won't have membership in
        url = f"/api/organizations/{uuid4()}/storage"
        resp = auth_client.get(url)
        assert resp.status_code == 404

    def test_get_storage_requires_auth(self, client, auth_setup):
        """Unauthenticated request returns 401."""
        _, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/storage"
        resp = client.get(url)
        assert resp.status_code == 401


# ============================================================================
# Media-Rights Enforcement Toggle
# ============================================================================


class TestMediaRightsEnforcementToggle:
    """Tests for the per-org media-rights-download enforcement toggle.

    Gates the rights/perm checks inside /media/{id}/download. Default off
    preserves pre-2026-05 behavior; orgs flip it on once their MediaRights
    data is populated. See app/services/media_rights_enforcement.py.
    """

    def test_default_is_off(self, auth_setup):
        """A freshly created org has rights enforcement disabled."""
        auth_client, org, _ = auth_setup
        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/settings/media-rights-enforcement"
        )
        assert resp.status_code == 200
        assert resp.get_json() == {"enabled": False}

    def test_put_enables(self, auth_setup):
        """PUT {enabled: true} flips the flag on; subsequent GET reflects it."""
        auth_client, org, _ = auth_setup
        resp = _put_json(
            auth_client,
            f"/api/organizations/{org.organization_id}/settings/media-rights-enforcement",
            {"enabled": True},
        )
        assert resp.status_code == 200
        assert resp.get_json() == {"status": "ok", "enabled": True}

        # GET should reflect the new state
        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/settings/media-rights-enforcement"
        )
        assert resp.get_json() == {"enabled": True}

    def test_put_rejects_non_bool(self, auth_setup):
        """PUT with `enabled` missing or non-bool → 400."""
        auth_client, org, _ = auth_setup
        # Missing key
        resp = _put_json(
            auth_client,
            f"/api/organizations/{org.organization_id}/settings/media-rights-enforcement",
            {},
        )
        assert resp.status_code == 400
        # Wrong type
        resp = _put_json(
            auth_client,
            f"/api/organizations/{org.organization_id}/settings/media-rights-enforcement",
            {"enabled": "yes"},
        )
        assert resp.status_code == 400


def _put_json(auth_client, url, data):
    """Helper for PUT with JSON body."""
    return auth_client.put(url, data=json.dumps(data), content_type="application/json")
