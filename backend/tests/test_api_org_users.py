"""
Tests for organization user management API.

Tests the org-admin user listing flow.
The user creation endpoint requires @require_fresh_mfa which is hard to mock
in unit tests, so we focus on the GET endpoint and auth enforcement.

Uses the auth_setup fixture from conftest.py for authenticated requests.
"""

import pytest
from app.models import User, OrganizationMembership, Role


class TestListOrganizationUsers:
    """Tests for GET /api/organizations/{org_id}/users endpoint."""

    def test_list_users_success(self, auth_setup, db_session):
        """Test listing users in an organization."""
        auth_client, org, user = auth_setup

        response = auth_client.get(
            f"/api/organizations/{org.organization_id}/users"
        )

        assert response.status_code == 200
        data = response.get_json()

        assert "users" in data
        assert "total" in data
        # The auth_setup user should be listed
        assert data["total"] >= 1

        # Verify user structure
        user_data = data["users"][0]
        assert "user_id" in user_data
        assert "email" in user_data
        assert "role_id" in user_data
        assert "role_key" in user_data
        assert "status" in user_data

    def test_list_users_filter_by_status(self, auth_setup, db_session):
        """Test filtering users by membership status."""
        auth_client, org, user = auth_setup

        # Create a second user with deactivated membership
        role = db_session.query(Role).filter_by(role_key="admin").first()

        deactivated_user = User(
            email="deactivated@example.com",
            password_hash="not_used",
            status="active",
        )
        db_session.add(deactivated_user)
        db_session.flush()

        deactivated_membership = OrganizationMembership(
            user_id=deactivated_user.user_id,
            organization_id=org.organization_id,
            role_id=role.role_id,
            role="member",
            status="deactivated",
        )
        db_session.add(deactivated_membership)
        db_session.commit()

        # Get active users only (default)
        response = auth_client.get(
            f"/api/organizations/{org.organization_id}/users"
        )
        assert response.status_code == 200
        data = response.get_json()
        assert all(u["status"] == "active" for u in data["users"])

        # Get all users
        response = auth_client.get(
            f"/api/organizations/{org.organization_id}/users?status=all"
        )
        assert response.status_code == 200
        data = response.get_json()
        assert data["total"] >= 2

    def test_list_users_requires_auth(self, client):
        """Test that listing users requires authentication."""
        import uuid
        response = client.get(
            f"/api/organizations/{uuid.uuid4()}/users"
        )
        assert response.status_code == 401

    def test_list_users_viewer_forbidden(self, viewer_auth_setup, db_session):
        """Test that viewer cannot list users (needs ORG_MANAGE_MEMBERS)."""
        auth_client, org, user = viewer_auth_setup

        response = auth_client.get(
            f"/api/organizations/{org.organization_id}/users"
        )

        # Viewer doesn't have org.manage_members permission
        assert response.status_code == 403


class TestCreateUserValidation:
    """Tests for POST /api/organizations/{org_id}/users input validation.

    Note: The create endpoint requires @require_fresh_mfa which cannot be
    easily mocked in unit tests. We test that unauthenticated requests fail.
    """

    def test_create_user_requires_auth(self, client):
        """Test that creating users requires authentication."""
        import uuid
        response = client.post(
            f"/api/organizations/{uuid.uuid4()}/users",
            json={
                "email": "test@example.com",
                "role_id": str(uuid.uuid4()),
            },
        )
        assert response.status_code == 401


class TestUserDeactivation:
    """Tests for PATCH /api/organizations/{org_id}/users/{user_id} deactivation.

    Note: The PATCH endpoint requires @require_fresh_mfa. We test auth enforcement.
    """

    def test_deactivate_requires_auth(self, client):
        """Test that deactivation requires authentication."""
        import uuid
        response = client.patch(
            f"/api/organizations/{uuid.uuid4()}/users/{uuid.uuid4()}",
            json={"action": "deactivate"},
        )
        assert response.status_code == 401

    def test_role_update_requires_auth(self, client):
        """Test that role update requires authentication."""
        import uuid
        response = client.patch(
            f"/api/organizations/{uuid.uuid4()}/users/{uuid.uuid4()}",
            json={"role_id": str(uuid.uuid4())},
        )
        assert response.status_code == 401
