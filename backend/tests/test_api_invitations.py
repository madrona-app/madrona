"""
Smoke tests for the Invitations API.

Routes under /api/organizations/<org_id>/invitations and /api/invitations/accept.
Mocks the email service and invitation token generation so tests run against SQLite.
"""

import json
from unittest.mock import patch, MagicMock
from uuid import uuid4

import pytest

from app.models import OrganizationInvitation


def _post_json(auth_client, url, data):
    """Helper for POST with JSON body."""
    return auth_client.post(url, data=json.dumps(data), content_type="application/json")


def _put_json(auth_client, url, data):
    """Helper for PUT with JSON body."""
    return auth_client.put(url, data=json.dumps(data), content_type="application/json")


# ============================================================================
# Create Invitation
# ============================================================================


class TestCreateInvitation:
    @patch("app.services.invitation_service._send_invitation_email", return_value=True)
    def test_create_invitation_success(self, mock_email, auth_setup):
        """POST /organizations/<org_id>/invitations returns 201 with valid payload."""
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/invitations"
        payload = {"email": "newuser@example.com", "role": "member"}
        resp = _post_json(auth_client, url, payload)
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["email"] == "newuser@example.com"
        assert data["role"] == "member"
        assert "invitation_id" in data
        assert "expires_at" in data
        assert data["organization_id"] == str(org.organization_id)
        mock_email.assert_called_once()

    @patch("app.services.invitation_service._send_invitation_email", return_value=True)
    def test_create_invitation_admin_role(self, mock_email, auth_setup):
        """POST with role=admin creates an admin invitation."""
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/invitations"
        payload = {"email": "admin@example.com", "role": "admin"}
        resp = _post_json(auth_client, url, payload)
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["role"] == "admin"

    @patch("app.services.invitation_service._send_invitation_email", return_value=True)
    def test_create_invitation_defaults_to_member(self, mock_email, auth_setup):
        """POST without explicit role defaults to member."""
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/invitations"
        payload = {"email": "default@example.com"}
        resp = _post_json(auth_client, url, payload)
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["role"] == "member"

    def test_create_invitation_missing_email(self, auth_setup):
        """POST without email returns 400."""
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/invitations"
        resp = _post_json(auth_client, url, {"role": "member"})
        assert resp.status_code in (400, 422)

    def test_create_invitation_invalid_role(self, auth_setup):
        """POST with an invalid role string returns 400."""
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/invitations"
        resp = _post_json(auth_client, url, {"email": "user@example.com", "role": "superuser"})
        assert resp.status_code in (400, 422)

    @patch("app.services.invitation_service._send_invitation_email", return_value=True)
    def test_create_invitation_resend_rotates_token(self, mock_email, auth_setup):
        """Sending a second invitation for the same email rotates the token (still 201)."""
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/invitations"
        payload = {"email": "resend@example.com", "role": "member"}
        resp1 = _post_json(auth_client, url, payload)
        assert resp1.status_code == 201
        id1 = resp1.get_json()["invitation_id"]

        resp2 = _post_json(auth_client, url, payload)
        assert resp2.status_code == 201
        id2 = resp2.get_json()["invitation_id"]
        # Same invitation row is reused (token rotated, not duplicated)
        assert id1 == id2


# ============================================================================
# Accept Invitation
# ============================================================================


class TestAcceptInvitation:
    def test_accept_invitation_invalid_token(self, auth_setup):
        """POST /invitations/accept with a bogus token returns 400."""
        auth_client, _, _ = auth_setup
        url = "/api/invitations/accept"
        resp = _post_json(auth_client, url, {"token": "totally-bogus-token"})
        assert resp.status_code in (400, 422)

    def test_accept_invitation_missing_token(self, auth_setup):
        """POST /invitations/accept without token field returns 400."""
        auth_client, _, _ = auth_setup
        url = "/api/invitations/accept"
        resp = _post_json(auth_client, url, {})
        assert resp.status_code in (400, 422)

    def test_accept_invitation_empty_json_body(self, auth_setup):
        """POST /invitations/accept with empty JSON object returns 400 (no token)."""
        auth_client, _, _ = auth_setup
        url = "/api/invitations/accept"
        resp = _post_json(auth_client, url, {"unrelated": "field"})
        assert resp.status_code in (400, 422)


# ============================================================================
# Authorization
# ============================================================================


class TestInvitationsAuth:
    def test_create_requires_auth(self, client, auth_setup):
        """POST /invitations without auth returns 401."""
        _, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/invitations"
        resp = client.post(
            url,
            data=json.dumps({"email": "noauth@example.com", "role": "member"}),
            content_type="application/json",
        )
        assert resp.status_code == 401

    def test_accept_requires_auth(self, client):
        """POST /invitations/accept without auth returns 401."""
        url = "/api/invitations/accept"
        resp = client.post(
            url,
            data=json.dumps({"token": "some-token"}),
            content_type="application/json",
        )
        assert resp.status_code == 401

    @patch("app.services.invitation_service._send_invitation_email", return_value=True)
    def test_create_requires_manage_members_permission(self, mock_email, viewer_auth_setup):
        """POST /invitations with viewer role (no org.manage_members) returns 403."""
        viewer_client, org, _ = viewer_auth_setup
        url = f"/api/organizations/{org.organization_id}/invitations"
        payload = {"email": "blocked@example.com", "role": "member"}
        resp = _post_json(viewer_client, url, payload)
        assert resp.status_code == 403
