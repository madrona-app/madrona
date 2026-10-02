"""
Security-focused tests for authentication endpoints.

Tests:
- Password-only login success
- MFA challenge path
- MFA setup enforcement
- Rate limiting with progressive delays
- Cookie security settings
- Secret protection
"""

import pytest
from unittest.mock import patch
from uuid import uuid4
from datetime import datetime, timezone, timedelta

from app.models import User, Organization, OrganizationMembership, RefreshToken, Role
from app.services.cognito import (
    AuthSuccess,
    AuthChallenge,
    AuthResultType,
    AuthTokens,
    InvalidCredentialsError,
    CognitoAuthError,
)
from app.services.rate_limiter import auth_limiter, AuthRateLimiter


@pytest.fixture(autouse=True)
def _disable_rate_limiting():
    """Override conftest autouse fixture — auth security tests need real rate limiting."""
    yield


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    """Reset rate limiter before each test."""
    auth_limiter.reset()
    yield
    auth_limiter.reset()


def _make_user(db_session, role_key="viewer", legacy_role="member"):
    """Create a user with org and membership. Returns dict."""
    email = f"test-{uuid4().hex[:8]}@example.com"
    org = Organization(
        name="Test Org",
        slug=f"test-org-{uuid4().hex[:8]}",
        status="active",
    )
    db_session.add(org)
    db_session.flush()

    role = Role(
        role_key=role_key,
        display_name=role_key.replace("_", " ").title(),
        is_system=True,
    )
    db_session.add(role)
    db_session.flush()

    user = User(email=email, status="active")
    db_session.add(user)
    db_session.flush()

    membership = OrganizationMembership(
        organization_id=org.organization_id,
        user_id=user.user_id,
        role=legacy_role,
        role_id=role.role_id,
        status="active",
    )
    db_session.add(membership)
    db_session.commit()

    return {
        "user_id": str(user.user_id),
        "email": email,
        "org_id": str(org.organization_id),
    }


def _cognito_success_mocks(email):
    """Build mock return values for successful Cognito auth."""
    cognito_sub = f"cognito-{uuid4().hex}"
    tokens = AuthTokens(
        id_token="mock-id-token",
        access_token="mock-access-token",
        refresh_token="mock-refresh-token",
        expires_in=3600,
    )
    auth_result = AuthSuccess(type=AuthResultType.SUCCESS, tokens=tokens)
    id_claims = {
        "sub": cognito_sub,
        "email": email,
        "email_verified": True,
        "token_use": "id",
    }
    return auth_result, id_claims


class TestPasswordOnlyLogin:
    """Tests for password-only login (non-admin users)."""

    @patch("app.fastapi_app.routers.auth.verify_cognito_id_token")
    @patch("app.fastapi_app.routers.auth.cognito_initiate_auth")
    def test_regular_user_login_success(self, mock_auth, mock_verify, client, db_session):
        """Regular user can login without MFA."""
        info = _make_user(db_session, role_key="viewer", legacy_role="member")
        auth_result, id_claims = _cognito_success_mocks(info["email"])
        mock_auth.return_value = auth_result
        mock_verify.return_value = id_claims

        resp = client.post("/api/auth/login", json={
            "email": info["email"],
            "password": "TestPass123!",
        })

        assert resp.status_code == 200
        data = resp.get_json()
        assert data["email"] == info["email"]
        assert "access_token" in data
        assert "mfaRequired" not in data
        assert "mfaSetupRequired" not in data

    @patch("app.fastapi_app.routers.auth.cognito_initiate_auth")
    def test_login_failure_returns_401(self, mock_auth, client, db_session):
        """Failed login returns 401 error."""
        info = _make_user(db_session)
        mock_auth.side_effect = InvalidCredentialsError("Bad password")

        resp = client.post("/api/auth/login", json={
            "email": info["email"],
            "password": "WrongPass",
        })

        assert resp.status_code == 401
        data = resp.get_json()
        assert data["error"]["message"] == "Invalid credentials"


class TestMFAChallengeFlow:
    """Tests for MFA challenge verification flow."""

    @patch("app.fastapi_app.routers.auth.cognito_initiate_auth")
    def test_mfa_challenge_returned_when_required(self, mock_auth, client, db_session):
        """MFA challenge returned when user has MFA enabled."""
        info = _make_user(db_session, role_key="admin", legacy_role="admin")
        mock_auth.return_value = AuthChallenge(
            type=AuthResultType.MFA_REQUIRED,
            challenge_name="SOFTWARE_TOKEN_MFA",
            session="mock-mfa-session",
            challenge_parameters={"USER_ID_FOR_SRP": "test"},
        )

        resp = client.post("/api/auth/login", json={
            "email": info["email"],
            "password": "TestPass123!",
        })

        assert resp.status_code == 200
        data = resp.get_json()
        assert data["mfaRequired"] is True
        assert "session" in data
        assert data["mfaType"] == "totp"

    @patch("app.fastapi_app.routers.auth.verify_cognito_id_token")
    @patch("app.fastapi_app.routers.auth.cognito_respond_to_auth_challenge")
    def test_mfa_verify_success(self, mock_respond, mock_verify, client, db_session):
        """MFA verification completes login."""
        info = _make_user(db_session, role_key="admin", legacy_role="admin")
        cognito_sub = f"cognito-{uuid4().hex}"
        tokens = AuthTokens(
            id_token="mock-id-token",
            access_token="mock-access-token",
            refresh_token="mock-refresh-token",
            expires_in=3600,
        )
        mock_respond.return_value = AuthSuccess(type=AuthResultType.SUCCESS, tokens=tokens)
        mock_verify.return_value = {"sub": cognito_sub, "email": info["email"]}

        resp = client.post("/api/auth/mfa/verify", json={
            "email": info["email"],
            "code": "123456",
            "session": "mock-session",
        })

        assert resp.status_code == 200
        data = resp.get_json()
        assert "access_token" in data
        assert data["email"] == info["email"]

    @patch("app.fastapi_app.routers.auth.cognito_respond_to_auth_challenge")
    def test_mfa_verify_failure_returns_401(self, mock_respond, client, db_session):
        """Failed MFA verification returns 401."""
        info = _make_user(db_session, role_key="admin", legacy_role="admin")
        mock_respond.side_effect = CognitoAuthError(
            message="Invalid code",
            code="CodeMismatchException",
        )

        resp = client.post("/api/auth/mfa/verify", json={
            "email": info["email"],
            "code": "000000",
            "session": "mock-session",
        })

        assert resp.status_code == 401
        data = resp.get_json()
        assert data["error"]["message"] in ("Authentication failed", "Invalid verification code")


class TestMFASetupEnforcement:
    """Tests for admin MFA enforcement (setup required flow)."""

    @patch("app.fastapi_app.routers.auth.cognito_get_user_mfa_status")
    @patch("app.fastapi_app.routers.auth.verify_cognito_id_token")
    @patch("app.fastapi_app.routers.auth.cognito_initiate_auth")
    def test_admin_without_mfa_gets_setup_required(
        self, mock_auth, mock_verify, mock_mfa_status, client, db_session
    ):
        """Admin user without MFA configured gets mfaSetupRequired."""
        info = _make_user(db_session, role_key="admin", legacy_role="admin")
        auth_result, id_claims = _cognito_success_mocks(info["email"])
        mock_auth.return_value = auth_result
        mock_verify.return_value = id_claims
        mock_mfa_status.return_value = {
            "mfa_enabled": False,
            "totp_enabled": False,
            "sms_enabled": False,
            "preferred_mfa": None,
        }

        resp = client.post("/api/auth/login", json={
            "email": info["email"],
            "password": "TestPass123!",
        })

        assert resp.status_code == 200
        data = resp.get_json()
        assert data.get("mfaSetupRequired") is True
        assert "session" in data
        assert data["email"] == info["email"]

    @patch("app.fastapi_app.routers.auth.cognito_get_user_mfa_status")
    @patch("app.fastapi_app.routers.auth.verify_cognito_id_token")
    @patch("app.fastapi_app.routers.auth.cognito_initiate_auth")
    def test_platform_admin_without_mfa_gets_setup_required(
        self, mock_auth, mock_verify, mock_mfa_status, client, db_session
    ):
        """Platform admin (highest privilege) without MFA is also forced to set
        it up — regression guard for the role that slipped the prompt after MFA
        recovery."""
        info = _make_user(db_session, role_key="platform_admin", legacy_role="platform_admin")
        auth_result, id_claims = _cognito_success_mocks(info["email"])
        mock_auth.return_value = auth_result
        mock_verify.return_value = id_claims
        mock_mfa_status.return_value = {
            "mfa_enabled": False,
            "totp_enabled": False,
            "sms_enabled": False,
            "preferred_mfa": None,
        }

        resp = client.post("/api/auth/login", json={
            "email": info["email"],
            "password": "TestPass123!",
        })

        assert resp.status_code == 200
        assert resp.get_json().get("mfaSetupRequired") is True

    @patch("app.fastapi_app.routers.auth.cognito_get_user_mfa_status")
    @patch("app.fastapi_app.routers.auth.verify_cognito_id_token")
    @patch("app.fastapi_app.routers.auth.cognito_initiate_auth")
    def test_admin_with_mfa_enabled_logs_in(
        self, mock_auth, mock_verify, mock_mfa_status, client, db_session
    ):
        """Admin user with MFA enabled can login normally."""
        info = _make_user(db_session, role_key="admin", legacy_role="admin")
        auth_result, id_claims = _cognito_success_mocks(info["email"])
        mock_auth.return_value = auth_result
        mock_verify.return_value = id_claims
        mock_mfa_status.return_value = {
            "mfa_enabled": True,
            "totp_enabled": True,
            "sms_enabled": False,
            "preferred_mfa": "SOFTWARE_TOKEN_MFA",
        }

        resp = client.post("/api/auth/login", json={
            "email": info["email"],
            "password": "TestPass123!",
        })

        assert resp.status_code == 200
        data = resp.get_json()
        assert "mfaSetupRequired" not in data

    @patch("app.fastapi_app.routers.auth.cognito_get_user")
    def test_mfa_setup_start_requires_valid_session(self, mock_get_user, client, db_session):
        """MFA setup start validates session token."""
        info = _make_user(db_session, role_key="admin", legacy_role="admin")
        mock_get_user.side_effect = InvalidCredentialsError("Invalid token")

        resp = client.post("/api/auth/mfa/setup/start", json={
            "email": info["email"],
            "session": "invalid-session",
        })

        assert resp.status_code == 401


class TestRateLimiting:
    """Tests for rate limiting and brute-force protection."""

    def test_rate_limit_returns_not_allowed(self):
        """Rate limit returns not-allowed after many failures."""
        email = f"ratelimit-{uuid4().hex[:8]}@example.com"

        for i in range(25):
            auth_limiter.record_failure(email)

        result = auth_limiter.check_rate_limit(email)
        assert result.allowed is False
        assert result.retry_after is not None
        assert result.retry_after > 0

    def test_success_clears_rate_limit(self):
        """Successful auth clears failure count."""
        email = f"clear-{uuid4().hex[:8]}@example.com"

        for i in range(5):
            auth_limiter.record_failure(email)

        status = auth_limiter.get_status(email)
        assert status["failures"] == 5

        auth_limiter.record_success(email)

        status = auth_limiter.get_status(email)
        assert status["failures"] == 0
        assert status["locked_out"] is False

    def test_progressive_delay_schedule(self):
        """Verify progressive delay schedule."""
        limiter = AuthRateLimiter()

        # 1-3 failures: no delay
        assert limiter._get_delay_for_failures(1) == 0
        assert limiter._get_delay_for_failures(3) == 0

        # 4-5 failures: 5s delay
        assert limiter._get_delay_for_failures(4) == 5
        assert limiter._get_delay_for_failures(5) == 5

        # 6-7 failures: 15s delay
        assert limiter._get_delay_for_failures(6) == 15
        assert limiter._get_delay_for_failures(7) == 15

        # 8-9 failures: 30s delay
        assert limiter._get_delay_for_failures(8) == 30
        assert limiter._get_delay_for_failures(9) == 30

        # 10+ failures: 60s delay
        assert limiter._get_delay_for_failures(10) == 60
        assert limiter._get_delay_for_failures(15) == 60


class TestCookieSecurity:
    """Tests for secure cookie settings."""

    @patch("app.fastapi_app.routers.auth.verify_cognito_id_token")
    @patch("app.fastapi_app.routers.auth.cognito_initiate_auth")
    def test_refresh_cookie_is_httponly(self, mock_auth, mock_verify, client, db_session):
        """Refresh token cookie has HttpOnly flag."""
        info = _make_user(db_session)
        auth_result, id_claims = _cognito_success_mocks(info["email"])
        mock_auth.return_value = auth_result
        mock_verify.return_value = id_claims

        resp = client.post("/api/auth/login", json={
            "email": info["email"],
            "password": "TestPass123!",
        })

        assert resp.status_code == 200
        cookie_header = resp.headers.get("Set-Cookie", "")
        assert "refresh_token=" in cookie_header
        assert "HttpOnly" in cookie_header

    @patch("app.fastapi_app.routers.auth.verify_cognito_id_token")
    @patch("app.fastapi_app.routers.auth.cognito_initiate_auth")
    def test_refresh_cookie_has_samesite(self, mock_auth, mock_verify, client, db_session):
        """Refresh token cookie has SameSite attribute."""
        info = _make_user(db_session)
        auth_result, id_claims = _cognito_success_mocks(info["email"])
        mock_auth.return_value = auth_result
        mock_verify.return_value = id_claims

        resp = client.post("/api/auth/login", json={
            "email": info["email"],
            "password": "TestPass123!",
        })

        assert resp.status_code == 200
        cookie_header = resp.headers.get("Set-Cookie", "")
        assert "SameSite=" in cookie_header

    def test_logout_clears_cookie(self, client, db_session):
        """Logout clears refresh token cookie."""
        resp = client.post("/api/auth/logout")
        assert resp.status_code == 200

        logout_cookie = resp.headers.get("Set-Cookie", "")
        assert "refresh_token=" in logout_cookie
        assert "Max-Age=0" in logout_cookie


class TestSecretProtection:
    """Tests to verify secrets are not leaked in responses."""

    @patch("app.fastapi_app.routers.auth.cognito_respond_to_auth_challenge")
    def test_mfa_session_not_in_error_response(self, mock_respond, client, db_session):
        """MFA session token not leaked in error responses."""
        info = _make_user(db_session, role_key="admin", legacy_role="admin")
        mock_respond.side_effect = CognitoAuthError(
            message="Invalid code",
            code="CodeMismatchException",
        )

        resp = client.post("/api/auth/mfa/verify", json={
            "email": info["email"],
            "code": "000000",
            "session": "secret-session-token-12345",
        })

        assert resp.status_code == 401
        data = resp.get_json()
        assert "secret-session-token" not in str(data)
        assert "session" not in data

    @patch("app.fastapi_app.routers.auth.cognito_set_user_mfa_preference")
    @patch("app.fastapi_app.routers.auth.cognito_verify_software_token")
    @patch("app.fastapi_app.routers.auth.cognito_get_user")
    def test_totp_secret_not_in_verify_response(
        self, mock_get_user, mock_verify, mock_set_pref, client, db_session
    ):
        """TOTP secret is not returned in verify response."""
        info = _make_user(db_session, role_key="admin", legacy_role="admin")
        mock_get_user.return_value = {"email": info["email"]}
        mock_verify.return_value = {"status": "SUCCESS"}

        resp = client.post("/api/auth/mfa/setup/verify", json={
            "email": info["email"],
            "code": "123456",
            "session": "mock-token",
        })

        assert resp.status_code == 200
        data = resp.get_json()
        assert "secret" not in data
        assert data.get("ok") is True
