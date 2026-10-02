"""
Tests for Projection Profiles API endpoints.

Tests:
- RBAC: GET allowed to admin+viewer(data.view), PUT/DELETE admin only
- PUT rejects invalid paths and roles
- DELETE resets to defaults

Uses the auth_setup fixture from conftest.py for authenticated requests.
"""
import pytest
from uuid import uuid4

from app.models import Organization
from app.schemas.projection_config import get_default_projection_config, CURRENT_VERSION


class TestGetProjectionProfiles:
    """Tests for GET /organizations/{org_id}/projection-profiles."""

    def test_get_returns_defaults_when_no_config(self, auth_setup):
        """GET returns system defaults when org has no config."""
        auth_client, org, user = auth_setup

        response = auth_client.get(
            f"/api/organizations/{org.organization_id}/projection-profiles"
        )

        assert response.status_code == 200
        data = response.get_json()

        assert data["is_default"] is True
        assert data["config"]["version"] == CURRENT_VERSION
        assert "profiles" in data["config"]
        assert "entity_detail" in data["config"]["profiles"]
        assert "entities_list" in data["config"]["profiles"]
        assert "search" in data["config"]["profiles"]
        assert "defaults" in data

    def test_get_returns_stored_config(self, auth_setup, db_session):
        """GET returns stored config when org has one."""
        auth_client, org, user = auth_setup

        custom_config = {
            "version": "1.0",
            "profiles": {
                "entity_detail": {"title": ["properties.name"]},
                "entities_list": {"title": ["label"]},
                "search": {"title": ["id"]},
            },
        }

        # Store custom config
        org_record = db_session.query(Organization).filter_by(
            organization_id=org.organization_id
        ).first()
        org_record.display_projections = custom_config
        db_session.commit()

        response = auth_client.get(
            f"/api/organizations/{org.organization_id}/projection-profiles"
        )

        assert response.status_code == 200
        data = response.get_json()

        assert data["is_default"] is False
        assert data["config"]["profiles"]["entity_detail"]["title"] == ["properties.name"]

    def test_get_allowed_for_viewer(self, viewer_auth_setup):
        """GET is allowed for users with DATA_VIEW permission (viewer role)."""
        auth_client, org, user = viewer_auth_setup

        response = auth_client.get(
            f"/api/organizations/{org.organization_id}/projection-profiles"
        )

        assert response.status_code == 200

    def test_get_requires_auth(self, client, auth_setup):
        """GET requires authentication."""
        _, org, _ = auth_setup

        response = client.get(
            f"/api/organizations/{org.organization_id}/projection-profiles"
        )

        assert response.status_code == 401

    def test_get_nonexistent_org_returns_403_or_404(self, auth_setup):
        """GET returns 403 or 404 for nonexistent organization.

        403 is returned because permission check happens before org lookup,
        which is correct security behavior (don't reveal if org exists).
        """
        auth_client, _, _ = auth_setup
        fake_org_id = uuid4()

        response = auth_client.get(
            f"/api/organizations/{fake_org_id}/projection-profiles"
        )

        # Either 403 (permission denied first) or 404 (org not found) is acceptable
        assert response.status_code in [403, 404]


class TestUpdateProjectionProfiles:
    """Tests for PUT /organizations/{org_id}/projection-profiles."""

    def test_put_valid_config(self, auth_setup):
        """PUT with valid config updates the organization."""
        auth_client, org, user = auth_setup

        valid_config = {
            "version": "1.0",
            "profiles": {
                "entity_detail": {
                    "title": ["label", "properties.title"],
                    "subtitle": ["type"],
                },
                "entities_list": {
                    "title": ["label"],
                },
                "search": {
                    "title": ["label"],
                    "snippet": ["description"],
                },
            },
        }

        response = auth_client.put(
            f"/api/organizations/{org.organization_id}/projection-profiles",
            json=valid_config,
        )

        assert response.status_code == 200
        data = response.get_json()

        assert data["is_default"] is False
        assert data["config"]["version"] == "1.0"
        assert "Projection configuration updated" in data["message"]

    def test_put_rejects_extensions_path(self, auth_setup):
        """PUT rejects config with extensions.* paths."""
        auth_client, org, user = auth_setup

        invalid_config = {
            "version": "1.0",
            "profiles": {
                "entity_detail": {"title": ["extensions.source.raw"]},
                "entities_list": {"title": ["label"]},
                "search": {"title": ["label"]},
            },
        }

        response = auth_client.put(
            f"/api/organizations/{org.organization_id}/projection-profiles",
            json=invalid_config,
        )

        assert response.status_code in (400, 422)

    def test_put_rejects_unknown_role(self, auth_setup):
        """PUT rejects config with unknown roles."""
        auth_client, org, user = auth_setup

        invalid_config = {
            "version": "1.0",
            "profiles": {
                "entity_detail": {
                    "title": ["label"],
                    "custom_role": ["properties.foo"],  # Invalid role
                },
                "entities_list": {"title": ["label"]},
                "search": {"title": ["label"]},
            },
        }

        response = auth_client.put(
            f"/api/organizations/{org.organization_id}/projection-profiles",
            json=invalid_config,
        )

        assert response.status_code in (400, 422)

    def test_put_rejects_missing_scope(self, auth_setup):
        """PUT rejects config missing required scopes."""
        auth_client, org, user = auth_setup

        invalid_config = {
            "version": "1.0",
            "profiles": {
                "entity_detail": {"title": ["label"]},
                # Missing entities_list and search
            },
        }

        response = auth_client.put(
            f"/api/organizations/{org.organization_id}/projection-profiles",
            json=invalid_config,
        )

        assert response.status_code in (400, 422)

    def test_put_rejects_empty_title(self, auth_setup):
        """PUT rejects config with empty title array."""
        auth_client, org, user = auth_setup

        invalid_config = {
            "version": "1.0",
            "profiles": {
                "entity_detail": {"title": []},  # Empty title
                "entities_list": {"title": ["label"]},
                "search": {"title": ["label"]},
            },
        }

        response = auth_client.put(
            f"/api/organizations/{org.organization_id}/projection-profiles",
            json=invalid_config,
        )

        assert response.status_code in (400, 422)

    def test_put_denied_for_viewer(self, viewer_auth_setup):
        """PUT is denied for users without ORG_MANAGE_SETTINGS permission."""
        auth_client, org, user = viewer_auth_setup

        valid_config = {
            "version": "1.0",
            "profiles": {
                "entity_detail": {"title": ["label"]},
                "entities_list": {"title": ["label"]},
                "search": {"title": ["label"]},
            },
        }

        response = auth_client.put(
            f"/api/organizations/{org.organization_id}/projection-profiles",
            json=valid_config,
        )

        assert response.status_code == 403

    def test_put_requires_json_body(self, auth_setup):
        """PUT requires a JSON body."""
        auth_client, org, user = auth_setup

        # Send with Content-Type header but null JSON body
        response = auth_client.put(
            f"/api/organizations/{org.organization_id}/projection-profiles",
            data="null",
            content_type="application/json",
        )

        assert response.status_code in (400, 422)


class TestDeleteProjectionProfiles:
    """Tests for DELETE /organizations/{org_id}/projection-profiles."""

    def test_delete_resets_to_defaults(self, auth_setup, db_session):
        """DELETE clears custom config and returns defaults."""
        auth_client, org, user = auth_setup

        custom_config = {
            "version": "1.0",
            "profiles": {
                "entity_detail": {"title": ["properties.custom"]},
                "entities_list": {"title": ["properties.custom"]},
                "search": {"title": ["properties.custom"]},
            },
        }

        # First store a custom config
        org_record = db_session.query(Organization).filter_by(
            organization_id=org.organization_id
        ).first()
        org_record.display_projections = custom_config
        db_session.commit()

        # Verify it's stored
        db_session.refresh(org_record)
        assert org_record.display_projections is not None

        # Now delete
        response = auth_client.delete(
            f"/api/organizations/{org.organization_id}/projection-profiles"
        )

        assert response.status_code == 200
        data = response.get_json()

        assert data["is_default"] is True
        assert "reset" in data["message"].lower()

        # Verify database was cleared
        db_session.refresh(org_record)
        assert org_record.display_projections is None

    def test_delete_when_already_default(self, auth_setup, db_session):
        """DELETE when already using defaults returns appropriate message."""
        auth_client, org, user = auth_setup

        # Ensure no custom config
        org_record = db_session.query(Organization).filter_by(
            organization_id=org.organization_id
        ).first()
        org_record.display_projections = None
        db_session.commit()

        response = auth_client.delete(
            f"/api/organizations/{org.organization_id}/projection-profiles"
        )

        assert response.status_code == 200
        data = response.get_json()

        assert data["is_default"] is True
        assert "already" in data["message"].lower()

    def test_delete_denied_for_viewer(self, viewer_auth_setup):
        """DELETE is denied for users without ORG_MANAGE_SETTINGS permission."""
        auth_client, org, user = viewer_auth_setup

        response = auth_client.delete(
            f"/api/organizations/{org.organization_id}/projection-profiles"
        )

        assert response.status_code == 403

    def test_delete_requires_auth(self, client, auth_setup):
        """DELETE requires authentication."""
        _, org, _ = auth_setup

        response = client.delete(
            f"/api/organizations/{org.organization_id}/projection-profiles"
        )

        assert response.status_code == 401
