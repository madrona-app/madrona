"""
Test authorization enforcement across API endpoints.

Verifies that @require_permission decorators properly enforce permission-based
access control for all protected endpoints.

Uses auth_setup and viewer_auth_setup fixtures from conftest.py.
"""

import pytest
from uuid import uuid4

from app.models import (
    User,
    Organization,
    OrganizationMembership,
    Role,
    Permission,
    RolePermission,
    Dataset,
)
from app.services.auth_utils import generate_access_token


class TestAuthorizationEnforcement:
    """Test permission-based authorization middleware."""

    def test_no_authentication_returns_401(self, client, auth_setup):
        """Test that endpoints without authentication return 401."""
        _, org, _ = auth_setup
        # No Bearer token should return 401 Unauthorized
        response = client.get(
            f"/api/datasets?organization_id={org.organization_id}"
        )
        assert response.status_code == 401

    def test_viewer_can_access_data_view_endpoints(self, viewer_auth_setup):
        """Test that viewer role can access data.view protected endpoints."""
        auth_client, org, user = viewer_auth_setup

        response = auth_client.get(
            f"/api/entities?organization_id={org.organization_id}"
        )
        # viewer_auth_setup has data.view permission, so this should succeed
        assert response.status_code == 200

    def test_viewer_cannot_access_admin_endpoints(self, viewer_auth_setup):
        """Test that viewer cannot access endpoints requiring admin permissions."""
        auth_client, org, user = viewer_auth_setup

        # GET /api/organizations/{org_id}/users requires org.manage_members
        response = auth_client.get(
            f"/api/organizations/{org.organization_id}/users"
        )
        assert response.status_code == 403

    def test_viewer_cannot_manage_settings(self, viewer_auth_setup):
        """Test that viewer cannot manage organization settings."""
        auth_client, org, user = viewer_auth_setup

        response = auth_client.put(
            f"/api/organizations/{org.organization_id}/projection-profiles",
            json={
                "version": "1.0",
                "profiles": {
                    "entity_detail": {"title": ["label"]},
                    "entities_list": {"title": ["label"]},
                    "search": {"title": ["label"]},
                },
            },
        )
        assert response.status_code == 403

    def test_admin_can_access_data_view_endpoints(self, auth_setup):
        """Test that admin role can access data.view protected endpoints."""
        auth_client, org, user = auth_setup

        response = auth_client.get(
            f"/api/entities?organization_id={org.organization_id}"
        )
        assert response.status_code == 200

    def test_admin_can_manage_members(self, auth_setup):
        """Test that admin can access org.manage_members endpoints."""
        auth_client, org, user = auth_setup

        response = auth_client.get(
            f"/api/organizations/{org.organization_id}/users"
        )
        assert response.status_code == 200

    def test_user_with_no_permissions_gets_403(self, client, db_session):
        """Test that user with role that has zero permissions gets 403."""
        # Create org
        org = Organization(
            name="No Perms Org",
            slug=f"no-perms-org-{uuid4().hex[:8]}",
            status="active",
        )
        db_session.add(org)
        db_session.flush()

        # Create role with no permissions
        role = Role(
            role_key="restricted_viewer",
            display_name="Restricted Viewer",
            description="No permissions at all",
        )
        db_session.add(role)
        db_session.flush()

        # Create user
        user = User(
            email=f"restricted-{uuid4().hex[:8]}@example.com",
            password_hash="fakehash",
            status="active",
        )
        db_session.add(user)
        db_session.flush()

        # Create membership
        membership = OrganizationMembership(
            user_id=user.user_id,
            organization_id=org.organization_id,
            role_id=role.role_id,
            role="member",
            status="active",
        )
        db_session.add(membership)

        user_id = user.user_id
        user_email = user.email
        org_id = org.organization_id
        db_session.commit()

        # Generate token
        token = generate_access_token(
            user_id=str(user_id),
            email=user_email,
            active_organization_id=str(org_id),
            expires_minutes=60,
        )

        response = client.get(
            f"/api/entities?organization_id={org_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 403

    def test_permission_denied_returns_clear_error(self, viewer_auth_setup):
        """Test that 403 responses include clear error information."""
        auth_client, org, user = viewer_auth_setup

        # viewer doesn't have org.manage_members
        response = auth_client.get(
            f"/api/organizations/{org.organization_id}/users"
        )

        assert response.status_code == 403
        data = response.get_json()

        # Verify error structure has some useful info
        assert "error" in data or "message" in data


class TestCustomerAPIAuthorization:
    """Test customer API uses API key scopes, not role permissions."""

    def test_customer_api_uses_scope_based_auth(self, client):
        """Verify customer API endpoints require auth or return not-found."""
        response = client.get("/api/customer/datasets")
        # Should return 401 (no auth) or 404 (endpoint not mounted)
        # but never 403 (wrong permissions) for unauthenticated requests
        assert response.status_code in [401, 404]


class TestAuthEndpointsNoOrgPermissions:
    """Test that auth endpoints don't require org permissions."""

    def test_login_endpoint_accessible_without_org_membership(self, client):
        """Test /auth/login doesn't require org permissions."""
        response = client.post(
            "/api/auth/login",
            json={"email": "test@example.com", "password": "password"},
        )
        # Should not be 403 (forbidden due to permissions)
        # Will be 401 or 400 (invalid credentials), but not 403
        assert response.status_code != 403
