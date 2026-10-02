"""
Smoke tests for the Platform Admin API (/api/platform/...).

All endpoints require platform.admin permission. Tests verify:
- Basic CRUD on applications and organizations lists
- 404 for non-existent resources
- 401 for unauthenticated requests
- 403 for users without platform.admin permission
"""

import json
from uuid import uuid4

import pytest

from app.models import Application, Organization, OrganizationApplication


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _post_json(auth_client, url, data):
    """Helper for POST with JSON body."""
    return auth_client.post(url, data=json.dumps(data), content_type="application/json")


def _put_json(auth_client, url, data):
    """Helper for PUT with JSON body."""
    return auth_client.put(url, data=json.dumps(data), content_type="application/json")


def _create_application(db_session, key="collections", display_name="Collections", sort_order=1):
    """Helper to insert an Application row and return it."""
    app = Application(
        key=key,
        display_name=display_name,
        description=f"{display_name} module",
        icon="Box",
        default_enabled=False,
        requires_contract=True,
        sort_order=sort_order,
        status="active",
    )
    db_session.add(app)
    db_session.commit()
    # Capture fields before potential expiry
    return {
        "application_id": app.application_id,
        "key": app.key,
        "display_name": app.display_name,
    }


# ============================================================================
# List Applications
# ============================================================================


class TestListApplications:
    def test_list_applications_empty(self, auth_setup):
        """GET /api/platform/applications returns an empty list when no apps exist."""
        auth_client, _org, _user = auth_setup
        resp = auth_client.get("/api/platform/applications")
        assert resp.status_code == 200
        data = resp.get_json()
        assert "applications" in data
        assert isinstance(data["applications"], list)

    def test_list_applications_with_data(self, auth_setup, db_session):
        """GET /api/platform/applications returns inserted apps."""
        auth_client, _org, _user = auth_setup
        _create_application(db_session, key="test_app_1", display_name="Test App 1", sort_order=1)
        _create_application(db_session, key="test_app_2", display_name="Test App 2", sort_order=2)

        resp = auth_client.get("/api/platform/applications")
        assert resp.status_code == 200
        data = resp.get_json()
        keys = [a["key"] for a in data["applications"]]
        assert "test_app_1" in keys
        assert "test_app_2" in keys

    def test_list_applications_unauthenticated(self, client):
        """GET /api/platform/applications returns 401 without auth."""
        resp = client.get("/api/platform/applications")
        assert resp.status_code == 401

    def test_list_applications_forbidden(self, viewer_auth_setup):
        """GET /api/platform/applications returns 403 for non-platform-admin."""
        viewer_client, _org, _user = viewer_auth_setup
        resp = viewer_client.get("/api/platform/applications")
        assert resp.status_code == 403


# ============================================================================
# List Organizations
# ============================================================================


class TestListOrganizations:
    def test_list_organizations(self, auth_setup):
        """GET /api/platform/organizations returns at least the test org."""
        auth_client, org, _user = auth_setup
        resp = auth_client.get("/api/platform/organizations")
        assert resp.status_code == 200
        data = resp.get_json()
        assert "organizations" in data
        org_ids = [o["organization_id"] for o in data["organizations"]]
        assert str(org.organization_id) in org_ids

    def test_list_organizations_unauthenticated(self, client):
        """GET /api/platform/organizations returns 401 without auth."""
        resp = client.get("/api/platform/organizations")
        assert resp.status_code == 401

    def test_list_organizations_forbidden(self, viewer_auth_setup):
        """GET /api/platform/organizations returns 403 for non-platform-admin."""
        viewer_client, _org, _user = viewer_auth_setup
        resp = viewer_client.get("/api/platform/organizations")
        assert resp.status_code == 403


# ============================================================================
# Get Organization Applications
# ============================================================================


class TestGetOrganizationApplications:
    def test_get_org_apps(self, auth_setup):
        """GET /api/platform/organizations/<id>/applications succeeds for known org."""
        auth_client, org, _user = auth_setup
        url = f"/api/platform/organizations/{org.organization_id}/applications"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["organization_id"] == str(org.organization_id)
        assert "applications" in data

    def test_get_org_apps_not_found(self, auth_setup):
        """GET /api/platform/organizations/<id>/applications returns 404 for unknown org."""
        auth_client, _org, _user = auth_setup
        fake_id = str(uuid4())
        resp = auth_client.get(f"/api/platform/organizations/{fake_id}/applications")
        assert resp.status_code == 404


# ============================================================================
# Enable Organization Application
# ============================================================================


class TestEnableOrganizationApplication:
    def test_enable_app(self, auth_setup, db_session):
        """POST /api/platform/organizations/<id>/applications enables an app."""
        auth_client, org, _user = auth_setup
        app_info = _create_application(db_session, key="enable_test", display_name="Enable Test")
        url = f"/api/platform/organizations/{org.organization_id}/applications"
        resp = _post_json(auth_client, url, {"application_key": "enable_test"})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["application_key"] == "enable_test"
        assert data["enabled"] is True

    def test_enable_app_missing_key(self, auth_setup):
        """POST without application_key returns 400."""
        auth_client, org, _user = auth_setup
        url = f"/api/platform/organizations/{org.organization_id}/applications"
        resp = _post_json(auth_client, url, {})
        assert resp.status_code in (400, 422)

    def test_enable_app_unknown_org(self, auth_setup, db_session):
        """POST to unknown org returns 404."""
        auth_client, _org, _user = auth_setup
        _create_application(db_session, key="enable_missing_org", display_name="Missing Org Test")
        fake_id = str(uuid4())
        url = f"/api/platform/organizations/{fake_id}/applications"
        resp = _post_json(auth_client, url, {"application_key": "enable_missing_org"})
        assert resp.status_code == 404

    def test_enable_app_unknown_app(self, auth_setup):
        """POST with non-existent application_key returns 404."""
        auth_client, org, _user = auth_setup
        url = f"/api/platform/organizations/{org.organization_id}/applications"
        resp = _post_json(auth_client, url, {"application_key": "nonexistent_app"})
        assert resp.status_code == 404


# ============================================================================
# Disable Organization Application
# ============================================================================


class TestDisableOrganizationApplication:
    def test_disable_app(self, auth_setup, db_session):
        """DELETE /api/platform/organizations/<id>/applications/<key> disables the app."""
        auth_client, org, _user = auth_setup
        app_info = _create_application(db_session, key="disable_test", display_name="Disable Test")

        # First enable
        enable_url = f"/api/platform/organizations/{org.organization_id}/applications"
        _post_json(auth_client, enable_url, {"application_key": "disable_test"})

        # Then disable
        disable_url = f"/api/platform/organizations/{org.organization_id}/applications/disable_test"
        resp = auth_client.delete(disable_url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["enabled"] is False

    def test_disable_app_not_found(self, auth_setup):
        """DELETE for an app that was never enabled returns 404."""
        auth_client, org, _user = auth_setup
        url = f"/api/platform/organizations/{org.organization_id}/applications/totally_fake_app"
        resp = auth_client.delete(url)
        assert resp.status_code == 404


