"""
Tests for user activation API endpoint.

Tests the invitation-based activation flow where invited users complete signup.
"""

import pytest
from datetime import datetime, timedelta, timezone
import hashlib

from unittest.mock import patch

from app.models import User, Organization, OrganizationMembership, OrganizationInvitation, Role


@pytest.fixture
def activation_org(db_session):
    """Create organization for activation tests."""
    org = Organization(
        name="Activation Test Org",
        slug="activation-test",
        status="active",
    )
    db_session.add(org)
    db_session.flush()
    return org


@pytest.fixture
def activation_role(db_session):
    """Create a role for activation tests (no organization_id on Role)."""
    role = Role(
        role_key="curator",
        display_name="Data Analyst",
        description="Test role for activation",
        is_system=True,
    )
    db_session.add(role)
    db_session.flush()
    return role


@pytest.fixture
def invited_user(db_session, activation_org, activation_role):
    """Create an invited user with membership and valid invitation."""
    user = User(
        email="newuser@example.com",
        status="invited",
        password_hash="",
    )
    db_session.add(user)
    db_session.flush()

    membership = OrganizationMembership(
        user_id=user.user_id,
        organization_id=activation_org.organization_id,
        role_id=activation_role.role_id,
        role="member",
        status="active",
    )
    db_session.add(membership)
    db_session.flush()

    token = "test-token-123"
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    invitation = OrganizationInvitation(
        organization_id=activation_org.organization_id,
        user_id=user.user_id,
        email="newuser@example.com",
        role="curator",
        token_hash=token_hash,
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
        invited_by=user.user_id,
    )
    db_session.add(invitation)
    db_session.commit()

    return user, invitation, token


class TestActivateUser:
    """Tests for POST /api/auth/activate endpoint."""

    @patch("app.fastapi_app.routers.auth.cognito_admin_set_user_password")
    @patch("app.fastapi_app.routers.auth.activate_limiter")
    @patch("app.fastapi_app.routers.auth.activate_hourly_limiter")
    @patch("app.fastapi_app.routers.auth.activate_token_limiter")
    def test_activate_user_success(
        self, mock_token_lim, mock_hourly_lim, mock_lim,
        mock_cognito, client, db_session, invited_user
    ):
        """Test successful user activation with valid token."""
        mock_lim.allow.return_value = True
        mock_hourly_lim.allow.return_value = True
        mock_token_lim.allow.return_value = True

        user, invitation, token = invited_user

        response = client.post(
            "/api/auth/activate",
            json={
                "token": token,
                "password": "SecurePassword123",
                "name": "New User",
            },
        )

        assert response.status_code == 200
        data = response.get_json()
        assert data["message"] == "Account activated successfully"
        assert data["email"] == "newuser@example.com"
        assert data["access_token"]
        assert data["active_organization_id"]
        # status="active" is a side effect — confirm via DB rather than response
        db_session.refresh(user)
        assert user.status == "active"

    @patch("app.fastapi_app.routers.auth.activate_limiter")
    @patch("app.fastapi_app.routers.auth.activate_hourly_limiter")
    @patch("app.fastapi_app.routers.auth.activate_token_limiter")
    def test_activate_user_invalid_token(
        self, mock_token_lim, mock_hourly_lim, mock_lim, client, db_session
    ):
        """Test activation fails with invalid token."""
        mock_lim.allow.return_value = True
        mock_hourly_lim.allow.return_value = True
        mock_token_lim.allow.return_value = True

        response = client.post(
            "/api/auth/activate",
            json={"token": "invalid-token", "password": "SecurePassword123"},
        )

        assert response.status_code == 404
        data = response.get_json()
        _msg = (data.get("error").get("message", "") if isinstance(data.get("error"), dict) else (data.get("error") or str(data.get("detail", ""))))
        assert "Invalid invitation token" in _msg or "not found" in _msg.lower()

    @patch("app.fastapi_app.routers.auth.activate_limiter")
    @patch("app.fastapi_app.routers.auth.activate_hourly_limiter")
    @patch("app.fastapi_app.routers.auth.activate_token_limiter")
    def test_activate_user_expired_token(
        self, mock_token_lim, mock_hourly_lim, mock_lim,
        client, db_session, activation_org
    ):
        """Test activation fails with expired token."""
        mock_lim.allow.return_value = True
        mock_hourly_lim.allow.return_value = True
        mock_token_lim.allow.return_value = True

        user = User(email="expired@example.com", status="invited", password_hash="")
        db_session.add(user)
        db_session.flush()

        token = "expired-token-123"
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        invitation = OrganizationInvitation(
            organization_id=activation_org.organization_id,
            user_id=user.user_id,
            email="expired@example.com",
            role="curator",
            token_hash=token_hash,
            expires_at=datetime.now(timezone.utc) - timedelta(days=1),
            invited_by=user.user_id,
        )
        db_session.add(invitation)
        db_session.commit()

        response = client.post(
            "/api/auth/activate",
            json={"token": token, "password": "SecurePassword123"},
        )

        assert response.status_code == 410
        data = response.get_json()
        assert "expired" in (data.get("error").get("message", "") if isinstance(data.get("error"), dict) else (data.get("error") or str(data.get("detail", "")))).lower()
        assert data.get("code") == "INVITATION_EXPIRED"
        assert "hint" in data

    @patch("app.fastapi_app.routers.auth.activate_limiter")
    @patch("app.fastapi_app.routers.auth.activate_hourly_limiter")
    @patch("app.fastapi_app.routers.auth.activate_token_limiter")
    def test_activate_user_already_used(
        self, mock_token_lim, mock_hourly_lim, mock_lim,
        client, db_session, activation_org
    ):
        """Test activation fails when invitation already used."""
        mock_lim.allow.return_value = True
        mock_hourly_lim.allow.return_value = True
        mock_token_lim.allow.return_value = True

        user = User(email="used@example.com", status="invited", password_hash="")
        db_session.add(user)
        db_session.flush()

        token = "used-token-123"
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        invitation = OrganizationInvitation(
            organization_id=activation_org.organization_id,
            user_id=user.user_id,
            email="used@example.com",
            role="curator",
            token_hash=token_hash,
            expires_at=datetime.now(timezone.utc) + timedelta(days=7),
            invited_by=user.user_id,
            used_at=datetime.now(timezone.utc),
        )
        db_session.add(invitation)
        db_session.commit()

        response = client.post(
            "/api/auth/activate",
            json={"token": token, "password": "SecurePassword123"},
        )

        assert response.status_code == 409
        data = response.get_json()
        assert "already been used" in (data.get("error").get("message", "") if isinstance(data.get("error"), dict) else (data.get("error") or str(data.get("detail", ""))))

    @patch("app.fastapi_app.routers.auth.activate_limiter")
    @patch("app.fastapi_app.routers.auth.activate_hourly_limiter")
    @patch("app.fastapi_app.routers.auth.activate_token_limiter")
    def test_activate_user_weak_password(
        self, mock_token_lim, mock_hourly_lim, mock_lim,
        client, db_session, invited_user
    ):
        """Test activation fails with weak password."""
        mock_lim.allow.return_value = True
        mock_hourly_lim.allow.return_value = True
        mock_token_lim.allow.return_value = True

        _, _, token = invited_user

        response = client.post(
            "/api/auth/activate",
            json={"token": token, "password": "short"},
        )

        assert response.status_code in (400, 422)
        data = response.get_json()
        _e = data.get("error") or data.get("detail", "")
        _msg = (_e.get("message", "") if isinstance(_e, dict) else str(_e))
        assert "at least 8 characters" in _msg or "password" in _msg.lower()

    @patch("app.fastapi_app.routers.auth.activate_limiter")
    @patch("app.fastapi_app.routers.auth.activate_hourly_limiter")
    def test_activate_user_missing_fields(
        self, mock_hourly_lim, mock_lim, client, db_session
    ):
        """Test activation fails with missing required fields."""
        mock_lim.allow.return_value = True
        mock_hourly_lim.allow.return_value = True

        # Missing token
        response = client.post(
            "/api/auth/activate",
            json={"password": "SecurePassword123"},
        )
        assert response.status_code in (400, 422)
        _d = response.get_json()
        _e = _d.get("error") or _d.get("detail", "")
        _msg = (_e.get("message", "") if isinstance(_e, dict) else str(_e))
        assert "token" in _msg.lower()

        # Missing password
        response = client.post(
            "/api/auth/activate",
            json={"token": "some-token"},
        )
        assert response.status_code in (400, 422)
        _d = response.get_json()
        _e = _d.get("error") or _d.get("detail", "")
        _msg = (_e.get("message", "") if isinstance(_e, dict) else str(_e))
        assert "password" in _msg.lower()


class TestVerifyInvitation:
    """Tests for GET /api/invitations/{token}/verify endpoint."""

    @patch("app.fastapi_app.routers.auth.verify_limiter")
    @patch("app.fastapi_app.routers.auth.verify_hourly_limiter")
    def test_verify_invitation_success(
        self, mock_hourly_lim, mock_lim, client, db_session, invited_user
    ):
        """Test invitation verification returns valid status."""
        mock_lim.allow.return_value = True
        mock_hourly_lim.allow.return_value = True

        _, _, token = invited_user

        response = client.get(f"/api/invitations/{token}/verify")

        assert response.status_code == 200
        data = response.get_json()
        assert data["valid"] is True
        assert data["email"] == "newuser@example.com"
        assert data["user_status"] == "invited"
        assert data["role"] == "curator"

    @patch("app.fastapi_app.routers.auth.verify_limiter")
    @patch("app.fastapi_app.routers.auth.verify_hourly_limiter")
    def test_verify_invitation_invalid_token(
        self, mock_hourly_lim, mock_lim, client, db_session
    ):
        """Test invitation verification fails with invalid token."""
        mock_lim.allow.return_value = True
        mock_hourly_lim.allow.return_value = True

        response = client.get("/api/invitations/invalid-token/verify")

        assert response.status_code == 404
        data = response.get_json()
        _msg = (data.get("error").get("message", "") if isinstance(data.get("error"), dict) else (data.get("error") or str(data.get("detail", ""))))
        assert "Invalid invitation token" in _msg or "not found" in _msg.lower()
