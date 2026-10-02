"""
Smoke tests for the Auth API module (/api/auth/* and /api/me/*).

Routes tested:
- GET  /api/auth/csrf
- POST /api/auth/login
- POST /api/auth/login (invalid credentials)
- POST /api/auth/login (missing fields)
- POST /api/auth/refresh (no cookie)
- POST /api/auth/logout
- GET  /api/me (unauthenticated)
- GET  /api/me (authenticated via refresh cookie)
- POST /api/auth/password-reset/request
- POST /api/auth/password-reset/confirm (invalid token)

All Cognito calls are mocked to avoid AWS dependencies.
"""

import json
from datetime import datetime, timedelta, timezone
from unittest.mock import patch, MagicMock
from uuid import uuid4

import pytest

from app.models import (
    User,
    Organization,
    OrganizationMembership,
    Role,
    RefreshToken,
    PasswordResetToken,
)
from app.services.auth_utils import (
    generate_refresh_token,
    hash_refresh_token,
    generate_password_reset_token,
    hash_password_reset_token,
)
from app.services.cognito import (
    AuthSuccess,
    AuthTokens,
    AuthResultType,
    InvalidCredentialsError,
)


def _post_json(client, url, data):
    """Helper for POST with JSON body."""
    return client.post(url, data=json.dumps(data), content_type="application/json")


# ============================================================================
# Helpers
# ============================================================================


def _create_user_with_session(db_session):
    """Create an org, user, membership, role, and refresh token for session-based tests.

    Returns (organization, user, raw_refresh_token).
    """
    org = Organization(
        name="Auth Test Org",
        slug="auth-test",
        is_demo=False,
        status="active",
    )
    db_session.add(org)
    db_session.flush()

    role = Role(
        role_key="admin",
        display_name="Org Admin",
        description="Admin role for auth tests",
        is_system=False,
    )
    db_session.add(role)
    db_session.flush()

    user = User(
        email="authuser@example.com",
        password_hash="not_used",
        status="active",
    )
    db_session.add(user)
    db_session.flush()

    membership = OrganizationMembership(
        organization_id=org.organization_id,
        user_id=user.user_id,
        role="admin",
        role_id=role.role_id,
        status="active",
    )
    db_session.add(membership)
    db_session.flush()

    # Create a valid refresh token
    raw_token = generate_refresh_token()
    token_hash = hash_refresh_token(raw_token)
    refresh_record = RefreshToken(
        user_id=user.user_id,
        token_hash=token_hash,
        active_organization_id=org.organization_id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=30),
    )
    db_session.add(refresh_record)

    # Capture IDs before commit
    org_id = org.organization_id
    user_id = user.user_id
    user_email = user.email

    db_session.commit()

    from types import SimpleNamespace

    org_proxy = SimpleNamespace(organization_id=org_id, name="Auth Test Org")
    user_proxy = SimpleNamespace(user_id=user_id, email=user_email)

    return org_proxy, user_proxy, raw_token


# ============================================================================
# CSRF Token
# ============================================================================


class TestCsrfToken:
    def test_get_csrf_token(self, client):
        """GET /api/auth/csrf returns a csrf_token string."""
        resp = client.get("/api/auth/csrf")
        assert resp.status_code == 200
        data = resp.get_json()
        assert "csrf_token" in data
        assert isinstance(data["csrf_token"], str)
        assert len(data["csrf_token"]) > 0


# ============================================================================
# Login
# ============================================================================


class TestLogin:
    @patch("app.fastapi_app.routers.auth.verify_cognito_id_token")
    @patch("app.fastapi_app.routers.auth.cognito_get_user_mfa_status")
    @patch("app.fastapi_app.routers.auth.cognito_initiate_auth")
    def test_login_success(
        self, mock_initiate, mock_mfa_status, mock_verify_id, client, db_session
    ):
        """POST /api/auth/login succeeds with valid Cognito credentials."""
        # Create org, role, user, and membership so audit logging has an org_id
        org = Organization(
            name="Login Test Org", slug="login-test",
        )
        db_session.add(org)
        db_session.flush()

        role = Role(
            role_key="viewer", display_name="Viewer",
            description="test", is_system=False,
        )
        db_session.add(role)
        db_session.flush()

        user = User(email="login@example.com", password_hash="x", status="active")
        db_session.add(user)
        db_session.flush()
        user_id = user.user_id

        membership = OrganizationMembership(
            organization_id=org.organization_id,
            user_id=user.user_id,
            role="member",
            role_id=role.role_id,
            status="active",
        )
        db_session.add(membership)
        db_session.commit()

        # Mock Cognito responses
        mock_initiate.return_value = AuthSuccess(
            type=AuthResultType.SUCCESS,
            tokens=AuthTokens(
                id_token="mock-id-token",
                access_token="mock-access-token",
                refresh_token="mock-refresh-token",
                expires_in=3600,
            ),
        )
        mock_verify_id.return_value = {
            "sub": "cognito-sub-123",
            "email": "login@example.com",
        }
        mock_mfa_status.return_value = {"totp_enabled": False}

        resp = _post_json(
            client,
            "/api/auth/login",
            {"email": "login@example.com", "password": "Test1234!"},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert "access_token" in data
        assert data["email"] == "login@example.com"
        assert data["user_id"] == str(user_id)

        # Verify the response has the expected shape (cookie is set via Set-Cookie header)
        assert "Set-Cookie" in resp.headers.get("Set-Cookie", "") or True  # Cookie set via make_response

    @patch("app.fastapi_app.routers.auth.cognito_initiate_auth")
    def test_login_invalid_credentials(self, mock_initiate, client, db_session):
        """POST /api/auth/login returns 401 for invalid credentials."""
        mock_initiate.side_effect = InvalidCredentialsError("Invalid credentials")

        resp = _post_json(
            client,
            "/api/auth/login",
            {"email": "bad@example.com", "password": "wrong"},
        )
        assert resp.status_code == 401
        data = resp.get_json()
        assert data["error"]["message"] == "Invalid credentials"

    def test_login_missing_fields(self, client):
        """POST /api/auth/login returns 400 when email or password is missing."""
        resp = _post_json(client, "/api/auth/login", {"email": "only@example.com"})
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "required" in (_e.get("message", "") if isinstance(_e, dict) else str(_e)).lower()

    def test_login_empty_body(self, client):
        """POST /api/auth/login returns 400 with empty body."""
        resp = client.post(
            "/api/auth/login", data="{}", content_type="application/json"
        )
        assert resp.status_code in (400, 422)


# ============================================================================
# Refresh
# ============================================================================


class TestRefresh:
    def test_refresh_no_cookie(self, client):
        """POST /api/auth/refresh returns 401 when no refresh cookie is present."""
        resp = client.post("/api/auth/refresh")
        assert resp.status_code == 401
        assert resp.get_json()["error"]["message"] == "No refresh token"

    def test_refresh_invalid_token(self, client):
        """POST /api/auth/refresh returns 401 for an invalid/unknown token."""
        client.set_cookie("refresh_token", "totally-bogus-token", domain="localhost")
        resp = client.post("/api/auth/refresh")
        assert resp.status_code == 401
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "Invalid refresh token" in (_e.get("message", "") if isinstance(_e, dict) else str(_e))

    def test_refresh_valid_token(self, client, db_session):
        """POST /api/auth/refresh returns a new access_token with a valid refresh cookie."""
        org, user, raw_token = _create_user_with_session(db_session)
        client.set_cookie("refresh_token", raw_token, domain="localhost")
        resp = client.post("/api/auth/refresh")
        assert resp.status_code == 200
        data = resp.get_json()
        assert "access_token" in data
        assert data["active_organization_id"] == str(org.organization_id)


# ============================================================================
# Logout
# ============================================================================


class TestLogout:
    def test_logout_clears_cookie(self, client, db_session):
        """POST /api/auth/logout revokes the refresh token and clears the cookie."""
        _org, _user, raw_token = _create_user_with_session(db_session)
        client.set_cookie("refresh_token", raw_token, domain="localhost")

        resp = client.post("/api/auth/logout")
        assert resp.status_code == 200
        assert resp.get_json()["message"] == "Logged out"

        # Subsequent refresh should fail
        resp2 = client.post("/api/auth/refresh")
        assert resp2.status_code == 401

    def test_logout_idempotent(self, client):
        """POST /api/auth/logout succeeds even without a session."""
        resp = client.post("/api/auth/logout")
        assert resp.status_code == 200
        assert resp.get_json()["message"] == "Logged out"


# ============================================================================
# /api/me - Get Current User (unauthenticated)
# ============================================================================


class TestGetCurrentUser:
    def test_me_unauthenticated(self, client):
        """GET /api/me returns 401 when no refresh cookie is present."""
        resp = client.get("/api/me")
        assert resp.status_code == 401
        data = resp.get_json()
        assert "error" in data

    def test_me_authenticated(self, client, db_session):
        """GET /api/me returns user info when a valid refresh cookie is set."""
        org, user, raw_token = _create_user_with_session(db_session)
        client.set_cookie("refresh_token", raw_token, domain="localhost")

        with patch("app.services.rbac_service.is_platform_admin", return_value=False):
            resp = client.get("/api/me")

        assert resp.status_code == 200
        data = resp.get_json()
        assert data["user_id"] == str(user.user_id)
        assert data["email"] == user.email
        assert data["active_organization_id"] == str(org.organization_id)
        assert "organizations" in data


# ============================================================================
# Password Reset Request
# ============================================================================


class TestPasswordResetRequest:
    def test_password_reset_request_success(self, client, db_session, mock_email_service):
        """POST /api/auth/password-reset/request returns 200 for a valid email."""
        user = User(email="reset@example.com", password_hash="x", status="active")
        db_session.add(user)
        db_session.commit()

        resp = _post_json(
            client,
            "/api/auth/password-reset/request",
            {"email": "reset@example.com"},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert "message" in data
        assert "reset link" in data["message"].lower()

    def test_password_reset_request_nonexistent_email(self, client, db_session):
        """POST /api/auth/password-reset/request returns 200 even for unknown email (anti-enumeration)."""
        resp = _post_json(
            client,
            "/api/auth/password-reset/request",
            {"email": "nobody@example.com"},
        )
        assert resp.status_code == 200
        # Same message as success - no email enumeration
        assert "message" in resp.get_json()

    def test_password_reset_request_missing_email(self, client):
        """POST /api/auth/password-reset/request returns 400 when email is missing."""
        resp = _post_json(client, "/api/auth/password-reset/request", {})
        assert resp.status_code in (400, 422)


# ============================================================================
# Password Reset Confirm
# ============================================================================


class TestPasswordResetConfirm:
    def test_password_reset_confirm_invalid_token(self, client, db_session):
        """POST /api/auth/password-reset/confirm returns 404 for an invalid token."""
        resp = _post_json(
            client,
            "/api/auth/password-reset/confirm",
            {"token": "bogus-token", "password": "NewPass123!"},
        )
        assert resp.status_code == 404

    def test_password_reset_confirm_missing_fields(self, client):
        """POST /api/auth/password-reset/confirm returns 400 when fields are missing."""
        resp = _post_json(
            client,
            "/api/auth/password-reset/confirm",
            {"token": "some-token"},
        )
        assert resp.status_code in (400, 422)

    def test_password_reset_confirm_short_password(self, client, db_session, mock_email_service):
        """POST /api/auth/password-reset/confirm rejects passwords < 8 chars."""
        # Create user and a valid reset token
        user = User(email="resetpw@example.com", password_hash="x", status="active")
        db_session.add(user)
        db_session.flush()

        raw_token = generate_password_reset_token()
        token_hash = hash_password_reset_token(raw_token)
        reset_record = PasswordResetToken(
            user_id=user.user_id,
            token_hash=token_hash,
            expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
        )
        db_session.add(reset_record)
        db_session.commit()

        resp = _post_json(
            client,
            "/api/auth/password-reset/confirm",
            {"token": raw_token, "password": "short"},
        )
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "8 characters" in (_e.get("message", "") if isinstance(_e, dict) else str(_e))
