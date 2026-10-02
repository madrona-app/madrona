"""
Tests for user update and deactivation API endpoints.

Tests the PATCH operations for organization user management.
Note: The PATCH endpoint requires @require_fresh_mfa which makes it
difficult to test the full flow in unit tests. We test auth enforcement
and the list endpoint which doesn't require MFA.

Uses the auth_setup fixture from conftest.py for authenticated requests.
"""

import pytest
import uuid

from app.models import User, OrganizationMembership, Role


class TestUserUpdateAuth:
    """Tests for authentication enforcement on user update endpoints."""

    def test_update_user_role_no_auth(self, client):
        """Test update requires authentication."""
        response = client.patch(
            f"/api/organizations/{uuid.uuid4()}/users/{uuid.uuid4()}",
            json={"role_id": str(uuid.uuid4())},
        )
        assert response.status_code == 401

    def test_deactivate_user_no_auth(self, client):
        """Test deactivation requires authentication."""
        response = client.patch(
            f"/api/organizations/{uuid.uuid4()}/users/{uuid.uuid4()}",
            json={"action": "deactivate"},
        )
        assert response.status_code == 401

    def test_reactivate_user_no_auth(self, client):
        """Test reactivation requires authentication."""
        response = client.patch(
            f"/api/organizations/{uuid.uuid4()}/users/{uuid.uuid4()}",
            json={"action": "reactivate"},
        )
        assert response.status_code == 401


class TestListUsersWithMemberships:
    """Tests for GET /api/organizations/{org_id}/users with various membership states."""

    def test_list_includes_active_members(self, auth_setup, db_session):
        """Test that active members are listed."""
        auth_client, org, user = auth_setup

        response = auth_client.get(
            f"/api/organizations/{org.organization_id}/users"
        )

        assert response.status_code == 200
        data = response.get_json()
        assert data["total"] >= 1

        # The auth_setup user should be there
        user_ids = [u["user_id"] for u in data["users"]]
        assert str(user.user_id) in user_ids

    def test_list_filters_deactivated_by_default(self, auth_setup, db_session):
        """Test that deactivated members are excluded by default."""
        auth_client, org, user = auth_setup

        # Create a deactivated user
        role = db_session.query(Role).filter_by(role_key="admin").first()

        deactivated_user = User(
            email="deactivated-update@example.com",
            password_hash="not_used",
            status="active",
        )
        db_session.add(deactivated_user)
        db_session.flush()

        membership = OrganizationMembership(
            user_id=deactivated_user.user_id,
            organization_id=org.organization_id,
            role_id=role.role_id,
            role="member",
            status="deactivated",
        )
        db_session.add(membership)
        db_session.commit()

        # Default (active only)
        response = auth_client.get(
            f"/api/organizations/{org.organization_id}/users"
        )
        assert response.status_code == 200
        data = response.get_json()
        user_ids = [u["user_id"] for u in data["users"]]
        assert str(deactivated_user.user_id) not in user_ids

        # All users
        response = auth_client.get(
            f"/api/organizations/{org.organization_id}/users?status=all"
        )
        assert response.status_code == 200
        data = response.get_json()
        user_ids = [u["user_id"] for u in data["users"]]
        assert str(deactivated_user.user_id) in user_ids

    def test_list_viewer_forbidden(self, viewer_auth_setup):
        """Test that viewer role cannot list organization users."""
        auth_client, org, user = viewer_auth_setup

        response = auth_client.get(
            f"/api/organizations/{org.organization_id}/users"
        )
        assert response.status_code == 403
