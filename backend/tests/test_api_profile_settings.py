"""
Smoke tests for the Profile Settings API.

Routes under /api/organizations/<org_id>/settings.
Tests cover GET settings list, GET single setting, 404s, and 401 auth.

Note: GET/PUT /profile endpoints were removed when the OrganizationProfile
system was dropped. Settings now return registry defaults only.
"""

import json
from uuid import uuid4

import pytest


# ============================================================================
# GET /api/organizations/<org_id>/settings
# ============================================================================


class TestListOrganizationSettings:
    def test_list_settings_empty(self, auth_setup, db_session):
        """Returns empty dict when no profile-based settings exist."""
        auth_client, org, _ = auth_setup

        url = f"/api/organizations/{org.organization_id}/settings"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data == {}


# ============================================================================
# GET /api/organizations/<org_id>/settings/<key>
# ============================================================================


class TestGetOrganizationSetting:
    def test_get_setting_with_fallback(self, auth_setup, db_session):
        """When no profile setting exists, fallback to registry default."""
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/settings/export.formats.enabled"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["key"] == "export.formats.enabled"
        # Default from registry is ["jsonl", "json"]
        assert isinstance(data["value"], list)

    def test_get_setting_unknown_key(self, auth_setup):
        """Unknown setting key returns 400."""
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/settings/nonexistent.key.here"
        resp = auth_client.get(url)
        assert resp.status_code in (400, 422)
        data = resp.get_json()
        assert "error" in data


# ============================================================================
# Authorization (401)
# ============================================================================


class TestProfileSettingsAuth:
    def test_list_settings_requires_auth(self, client, auth_setup):
        _, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/settings"
        resp = client.get(url)
        assert resp.status_code == 401

    def test_get_setting_requires_auth(self, client, auth_setup):
        _, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/settings/export.formats.enabled"
        resp = client.get(url)
        assert resp.status_code == 401
