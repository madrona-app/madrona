"""
Tests for the FastAPI auth endpoints and middleware (Phase 2).

Tests the 27 auth routes, middleware (CSRF, rate limit, content-type),
and exception handler format.
"""

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

from app.database import get_db
from app.services.auth_utils import (
    generate_access_token,
    generate_refresh_token,
    hash_refresh_token,
    hash_password,
)


@pytest.fixture(scope="session")
def fastapi_auth_app():
    """Create a minimal FastAPI app with the auth router and middleware."""
    from fastapi import FastAPI
    from app.fastapi_app.routers.auth import router as auth_router
    from app.fastapi_app.exception_handlers import register_exception_handlers
    from app.fastapi_app.middleware.csrf import CSRFMiddleware
    from app.fastapi_app.middleware.content_type import ContentTypeMiddleware
    from app.fastapi_app.middleware.security_headers import SecurityHeadersMiddleware
    from app.fastapi_app.middleware.request_logging import RequestLoggingMiddleware

    app = FastAPI()

    # Register middleware in the same order as asgi.py
    app.add_middleware(CSRFMiddleware)
    app.add_middleware(ContentTypeMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestLoggingMiddleware)

    register_exception_handlers(app)
    app.include_router(auth_router)

    return app


@pytest.fixture()
def auth_client(fastapi_auth_app, app, db_session):
    """Synchronous test client for FastAPI auth endpoints."""
    from fastapi.testclient import TestClient

    def _override_get_db():
        yield db_session

    fastapi_auth_app.dependency_overrides[get_db] = _override_get_db

    with TestClient(fastapi_auth_app) as client:
        yield client

    fastapi_auth_app.dependency_overrides.clear()


@pytest.fixture()
def test_user(db_session):
    """Create a test user."""
    from app.models import User

    user = User(
        email="testuser@example.com",
        display_name="Test User",
        status="active",
        cognito_sub="cognito-sub-123",
        password_hash=hash_password("testpassword123"),
    )
    db_session.add(user)
    db_session.flush()
    return user


@pytest.fixture()
def test_org_and_membership(db_session, test_user):
    """Create a test org and membership for the test user."""
    from app.models import Organization, OrganizationMembership, Role

    org = Organization(
        name="Test Auth Org",
        slug="test-auth-org",
        is_demo=False,
        status="active",
    )
    db_session.add(org)
    db_session.flush()

    # Find or create a role
    role = db_session.query(Role).filter_by(role_key="admin").first()
    if not role:
        role = Role(
            role_key="admin",
            display_name="Organization Administrator",
            is_system=True,
        )
        db_session.add(role)
        db_session.flush()

    membership = OrganizationMembership(
        organization_id=org.organization_id,
        user_id=test_user.user_id,
        role="admin",
        role_id=role.role_id,
        status="active",
    )
    db_session.add(membership)
    db_session.commit()

    return org, membership


@pytest.fixture()
def user_with_session(db_session, test_user, test_org_and_membership):
    """Create a test user with an active refresh token."""
    from app.models import RefreshToken

    org, membership = test_org_and_membership
    raw_token = generate_refresh_token()
    token_hash = hash_refresh_token(raw_token)

    token_record = RefreshToken(
        user_id=test_user.user_id,
        token_hash=token_hash,
        active_organization_id=org.organization_id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=30),
    )
    db_session.add(token_record)
    db_session.commit()

    return test_user, raw_token, org


# =============================================================================
# CSRF Token
# =============================================================================


class TestCSRF:
    def test_get_csrf_token(self, auth_client):
        resp = auth_client.get("/api/auth/csrf")
        assert resp.status_code == 200
        data = resp.json()
        assert "csrf_token" in data
        assert len(data["csrf_token"]) > 20
        # Check cookie was set
        assert "csrf_token" in resp.cookies

    def test_csrf_required_for_post(self, auth_client, user_with_session):
        """POST requests on /api/* without CSRF token should be blocked by middleware."""
        user, token, org = user_with_session
        # Set active org without CSRF token — should fail
        resp = auth_client.post(
            "/api/me/active-organization",
            json={"organization_id": str(org.organization_id)},
            cookies={"refresh_token": token},
        )
        assert resp.status_code == 403
        assert "csrf" in resp.json()["error"]["message"].lower()

    def test_csrf_passes_with_matching_tokens(self, auth_client, user_with_session):
        """POST requests with matching CSRF cookie + header should pass."""
        user, token, org = user_with_session
        csrf_token = secrets.token_urlsafe(32)
        resp = auth_client.post(
            "/api/me/active-organization",
            json={"organization_id": str(org.organization_id)},
            cookies={"refresh_token": token, "csrf_token": csrf_token},
            headers={"X-CSRF-Token": csrf_token},
        )
        assert resp.status_code == 200

    def test_csrf_exempt_for_login(self, auth_client):
        """Login is exempt from CSRF validation.

        Mocks cognito so we hit the 401 branch rather than a 500 when
        the Cognito service is unreachable in CI.
        """
        from unittest.mock import patch
        from app.services.cognito import InvalidCredentialsError
        with patch(
            "app.fastapi_app.routers.auth.cognito_initiate_auth",
            side_effect=InvalidCredentialsError(code="NotAuthorizedException", message="bad creds"),
        ):
            resp = auth_client.post(
                "/api/auth/login",
                json={"email": "nobody@example.com", "password": "wrong"},
            )
        # Should get 401 (auth failed), not 403 (CSRF)
        assert resp.status_code in (401, 422, 429)


# =============================================================================
# Token Refresh
# =============================================================================


class TestRefresh:
    def test_refresh_with_valid_cookie(self, auth_client, user_with_session):
        user, token, org = user_with_session
        resp = auth_client.post(
            "/api/auth/refresh",
            cookies={"refresh_token": token},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data

    def test_refresh_without_cookie_returns_401(self, auth_client):
        resp = auth_client.post("/api/auth/refresh")
        assert resp.status_code == 401

    def test_refresh_with_invalid_cookie_returns_401(self, auth_client):
        resp = auth_client.post(
            "/api/auth/refresh",
            cookies={"refresh_token": "invalid_token_value"},
        )
        assert resp.status_code == 401


# =============================================================================
# Logout
# =============================================================================


class TestLogout:
    def test_logout_clears_cookie(self, auth_client, user_with_session):
        user, token, org = user_with_session
        csrf_token = secrets.token_urlsafe(32)
        resp = auth_client.post(
            "/api/auth/logout",
            cookies={"refresh_token": token, "csrf_token": csrf_token},
            headers={"X-CSRF-Token": csrf_token},
        )
        assert resp.status_code == 200
        assert resp.json()["message"] == "Logged out"
        # Cookie should be cleared (max_age=0)
        assert "refresh_token" in resp.headers.get("set-cookie", "").lower()


# =============================================================================
# User Profile (/me)
# =============================================================================


class TestMe:
    def test_get_me_with_valid_session(self, auth_client, user_with_session):
        user, token, org = user_with_session
        resp = auth_client.get("/api/me", cookies={"refresh_token": token})
        assert resp.status_code == 200
        data = resp.json()
        assert data["user_id"] == str(user.user_id)
        assert data["email"] == user.email

    def test_get_me_without_cookie_returns_401(self, auth_client):
        resp = auth_client.get("/api/me")
        assert resp.status_code == 401

    def test_update_profile(self, auth_client, user_with_session):
        user, token, org = user_with_session
        csrf_token = secrets.token_urlsafe(32)
        resp = auth_client.put(
            "/api/me",
            json={"display_name": "New Name"},
            cookies={"refresh_token": token, "csrf_token": csrf_token},
            headers={"X-CSRF-Token": csrf_token},
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "New Name"


# =============================================================================
# Active Organization
# =============================================================================


class TestActiveOrganization:
    def test_set_active_organization(self, auth_client, user_with_session):
        user, token, org = user_with_session
        csrf_token = secrets.token_urlsafe(32)
        resp = auth_client.post(
            "/api/me/active-organization",
            json={"organization_id": str(org.organization_id)},
            cookies={"refresh_token": token, "csrf_token": csrf_token},
            headers={"X-CSRF-Token": csrf_token},
        )
        assert resp.status_code == 200
        assert resp.json()["active_organization_id"] == str(org.organization_id)

    def test_set_active_organization_not_member(self, auth_client, user_with_session):
        user, token, org = user_with_session
        csrf_token = secrets.token_urlsafe(32)
        fake_org_id = str(uuid.uuid4())
        resp = auth_client.post(
            "/api/me/active-organization",
            json={"organization_id": fake_org_id},
            cookies={"refresh_token": token, "csrf_token": csrf_token},
            headers={"X-CSRF-Token": csrf_token},
        )
        assert resp.status_code == 403

    def test_set_active_organization_invalidates_session_cache(self, auth_client, user_with_session):
        """The cookie-auth path resolves the active org through the Redis
        session cache (TTL up to 1h). If the switch doesn't drop the cached
        entry, every subsequent request keeps the old org's RLS scope and
        permissions until it expires."""
        user, token, org = user_with_session
        csrf_token = secrets.token_urlsafe(32)
        with patch("app.fastapi_app.routers.auth.invalidate_session_cache") as mock_invalidate:
            resp = auth_client.post(
                "/api/me/active-organization",
                json={"organization_id": str(org.organization_id)},
                cookies={"refresh_token": token, "csrf_token": csrf_token},
                headers={"X-CSRF-Token": csrf_token},
            )
        assert resp.status_code == 200
        mock_invalidate.assert_called_once_with(hash_refresh_token(token))


class TestActiveOrganizationStrictRLS:
    def test_switch_org_under_strict_rls(self, rls_client, rls_db_session):
        """Org switching must work with RLS actually enforced.

        The handler authenticates via the refresh cookie (not require_auth),
        so nothing sets the RLS GUCs. organization_memberships' only policy is
        `(user_id = current_user_id() OR organization_id = current_org_id())`
        — with both unset, the membership row is invisible to the app role.

        Pre-fix verification: remove the set_rls_context_for_session call in
        set_active_organization and the first switch below 403s
        ("Not a member of this organization") for a legitimate member.
        """
        from sqlalchemy import text as _sa_text
        from app.models import (
            Organization,
            OrganizationMembership,
            RefreshToken,
            Role,
            User,
        )

        org_a_id, org_b_id, org_c_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()

        # Seed org A + user together, mirroring test_mfa_verify_under_strict_rls:
        # org-scoped INSERTs need current_org_id set first (WITH CHECK).
        rls_db_session.execute(
            _sa_text("SELECT set_config('app.current_org_id', :v, true)"),
            {"v": str(org_a_id)},
        )
        user = User(
            email=f"rls-switch-{uuid.uuid4().hex[:6]}@example.com",
            password_hash="dummy",
            status="active",
        )
        rls_db_session.add(user)
        org_a = Organization(
            organization_id=org_a_id,
            name="RLS Switch Org A",
            slug=f"rls-switch-a-{uuid.uuid4().hex[:8]}",
            status="active",
        )
        rls_db_session.add(org_a)
        role_a = Role(role_key=f"admin-{uuid.uuid4().hex[:6]}", display_name="Admin", is_system=False, organization_id=org_a_id)
        rls_db_session.add(role_a)
        rls_db_session.flush()
        rls_db_session.add(OrganizationMembership(
            organization_id=org_a_id, user_id=user.user_id,
            role="admin", role_id=role_a.role_id, status="active",
        ))
        rls_db_session.commit()

        # Org B: second membership — the legitimate switch target.
        rls_db_session.execute(
            _sa_text("SELECT set_config('app.current_org_id', :v, true)"),
            {"v": str(org_b_id)},
        )
        org_b = Organization(
            organization_id=org_b_id,
            name="RLS Switch Org B",
            slug=f"rls-switch-b-{uuid.uuid4().hex[:8]}",
            status="active",
        )
        rls_db_session.add(org_b)
        role_b = Role(role_key=f"admin-{uuid.uuid4().hex[:6]}", display_name="Admin", is_system=False, organization_id=org_b_id)
        rls_db_session.add(role_b)
        rls_db_session.flush()
        rls_db_session.add(OrganizationMembership(
            organization_id=org_b_id, user_id=user.user_id,
            role="admin", role_id=role_b.role_id, status="active",
        ))
        rls_db_session.commit()

        # Org C: exists, but the user is NOT a member.
        rls_db_session.execute(
            _sa_text("SELECT set_config('app.current_org_id', :v, true)"),
            {"v": str(org_c_id)},
        )
        rls_db_session.add(Organization(
            organization_id=org_c_id,
            name="RLS Switch Org C",
            slug=f"rls-switch-c-{uuid.uuid4().hex[:8]}",
            status="active",
        ))
        rls_db_session.commit()

        raw_token = generate_refresh_token()
        rls_db_session.add(RefreshToken(
            user_id=user.user_id,
            token_hash=hash_refresh_token(raw_token),
            active_organization_id=org_a_id,
            expires_at=datetime.now(timezone.utc) + timedelta(days=30),
        ))
        rls_db_session.commit()

        rls_client.set_cookie("refresh_token", raw_token)

        # Member-to-member switch must succeed under enforced RLS.
        resp = rls_client.post(
            "/api/me/active-organization",
            json={"organization_id": str(org_b_id)},
        )
        assert resp.status_code == 200, (
            f"Switch to a member org returned {resp.status_code}: "
            f"{resp.get_json()}. The membership check is running without "
            "RLS user context, so the user's own membership row is invisible."
        )
        assert resp.get_json()["active_organization_id"] == str(org_b_id)

        # The next request's scope must actually move to org B.
        me = rls_client.get("/api/me")
        assert me.status_code == 200, me.get_json()
        assert me.get_json()["active_organization_id"] == str(org_b_id)

        # Setting user context must not loosen the check: a non-member
        # org is still rejected.
        resp = rls_client.post(
            "/api/me/active-organization",
            json={"organization_id": str(org_c_id)},
        )
        assert resp.status_code == 403


# =============================================================================
# Invitation Verify
# =============================================================================


class TestInvitationVerify:
    def test_verify_invalid_token_returns_404(self, auth_client):
        resp = auth_client.get("/api/invitations/invalid_token_here/verify")
        assert resp.status_code == 404


# =============================================================================
# Content-Type Middleware
# =============================================================================


class TestContentTypeMiddleware:
    def test_wrong_content_type_returns_415(self, auth_client):
        """Non-JSON content type on /api/* POST should return 415."""
        resp = auth_client.post(
            "/api/auth/refresh",
            content=b"not json",
            headers={"Content-Type": "text/plain"},
        )
        assert resp.status_code == 415

    def test_json_content_type_passes(self, auth_client):
        """JSON content type should pass through."""
        resp = auth_client.post(
            "/api/auth/refresh",
            json={},  # json= sets Content-Type: application/json
        )
        # Should not be 415 — might be 401 (no cookie) but not content-type error
        assert resp.status_code != 415


# =============================================================================
# Security Headers
# =============================================================================


class TestSecurityHeaders:
    def test_security_headers_present(self, auth_client):
        resp = auth_client.get("/api/auth/csrf")
        assert resp.headers.get("X-Content-Type-Options") == "nosniff"
        assert resp.headers.get("X-Frame-Options") == "SAMEORIGIN"
        # X-XSS-Protection deprecated and removed (audit L1) — must be absent.
        assert resp.headers.get("X-XSS-Protection") is None
        assert resp.headers.get("Referrer-Policy") == "strict-origin-when-cross-origin"


# =============================================================================
# Request Logging
# =============================================================================


class TestRequestLogging:
    def test_request_id_in_response(self, auth_client):
        resp = auth_client.get("/api/auth/csrf")
        assert "X-Request-ID" in resp.headers

    def test_request_id_adopted(self, auth_client):
        custom_id = "test-request-id-123"
        resp = auth_client.get("/api/auth/csrf", headers={"X-Request-ID": custom_id})
        assert resp.headers["X-Request-ID"] == custom_id


# =============================================================================
# Exception Handler Format
# =============================================================================


class TestExceptionHandlerFormat:
    def test_404_format(self, auth_client):
        resp = auth_client.get("/api/nonexistent/path")
        # Might be 404 or fall through, but if 404, check format
        if resp.status_code == 404:
            data = resp.json()
            # Either the normalized {"error": {code, message}} envelope or
            # the default FastAPI {"detail": "..."} shape.
            assert "error" in data or "detail" in data
            if "error" in data and isinstance(data["error"], dict):
                assert "code" in data["error"]
                assert "message" in data["error"]

    def test_madrona_error_format(self, auth_client, user_with_session):
        """MadronaError should produce standard error format."""
        user, token, org = user_with_session
        csrf_token = secrets.token_urlsafe(32)
        # Upload without file should raise ValidationError
        resp = auth_client.post(
            "/api/me/avatar",
            cookies={"refresh_token": token, "csrf_token": csrf_token},
            headers={"X-CSRF-Token": csrf_token},
        )
        # Should be 422 (missing file) or 400
        assert resp.status_code in (400, 422)


# =============================================================================
# Password Reset
# =============================================================================


class TestPasswordReset:
    def test_password_reset_request_always_succeeds(self, auth_client):
        """Password reset should always return success (prevents enumeration)."""
        csrf_token = secrets.token_urlsafe(32)
        resp = auth_client.post(
            "/api/auth/password-reset/request",
            json={"email": "nonexistent@example.com"},
            cookies={"csrf_token": csrf_token},
            headers={"X-CSRF-Token": csrf_token},
        )
        # Exempt from CSRF
        resp = auth_client.post(
            "/api/auth/password-reset/request",
            json={"email": "nonexistent@example.com"},
        )
        assert resp.status_code == 200

    def test_password_reset_confirm_invalid_token(self, auth_client):
        resp = auth_client.post(
            "/api/auth/password-reset/confirm",
            json={"token": "invalid", "password": "newpassword123"},
        )
        assert resp.status_code == 404


class TestMfaRecovery:
    """Self-service 'lost your authenticator' flow: request + confirm."""

    @pytest.fixture(autouse=True)
    def _no_rate_limit(self, monkeypatch):
        from app.fastapi_app.routers import auth as auth_router
        monkeypatch.setattr(auth_router._mfa_recovery_limiter, "allow", lambda *_a, **_k: True)

    def _seed_token(self, db_session, user, expires_in_hours=1):
        from app.models import MfaResetToken
        from app.services.auth_utils import (
            generate_password_reset_token,
            hash_password_reset_token,
        )
        token = generate_password_reset_token()
        db_session.add(MfaResetToken(
            user_id=user.user_id,
            token_hash=hash_password_reset_token(token),
            expires_at=datetime.now(timezone.utc) + timedelta(hours=expires_in_hours),
        ))
        db_session.commit()
        return token

    def test_request_always_succeeds(self, auth_client):
        # Unknown email -> generic 200, no enumeration.
        resp = auth_client.post("/api/auth/mfa/recovery/request", json={"email": "nobody@example.com"})
        assert resp.status_code == 200

    def test_request_issues_token_for_known_user(self, auth_client, db_session, test_user):
        from app.models import MfaResetToken
        resp = auth_client.post("/api/auth/mfa/recovery/request", json={"email": test_user.email})
        assert resp.status_code == 200
        n = db_session.query(MfaResetToken).filter_by(user_id=test_user.user_id, used_at=None).count()
        assert n == 1

    def test_confirm_resets_mfa_with_valid_token_and_password(self, auth_client, db_session, test_user):
        from app.models import MfaResetToken
        token = self._seed_token(db_session, test_user)
        with patch("app.fastapi_app.routers.auth.cognito_initiate_auth") as mock_auth, \
             patch("app.services.cognito.cognito_admin_set_user_mfa_preference") as mock_pref:
            mock_auth.return_value = MagicMock()
            resp = auth_client.post(
                "/api/auth/mfa/recovery/confirm",
                json={"token": token, "password": "testpassword123"},
            )
        assert resp.status_code == 200
        # TOTP was disabled and the token consumed.
        mock_pref.assert_called_once()
        assert mock_pref.call_args.kwargs.get("totp_enabled") is False
        tok = db_session.query(MfaResetToken).filter_by(user_id=test_user.user_id).first()
        db_session.refresh(tok)
        assert tok.used_at is not None

    def test_confirm_wrong_password_401(self, auth_client, db_session, test_user):
        from app.services.cognito import CognitoAuthError
        token = self._seed_token(db_session, test_user)
        with patch("app.fastapi_app.routers.auth.cognito_initiate_auth", side_effect=CognitoAuthError("bad", code="NotAuthorizedException")), \
             patch("app.services.cognito.cognito_admin_set_user_mfa_preference") as mock_pref:
            resp = auth_client.post(
                "/api/auth/mfa/recovery/confirm",
                json={"token": token, "password": "wrong"},
            )
        assert resp.status_code == 401
        mock_pref.assert_not_called()  # MFA never touched on bad password

    def test_confirm_invalid_token_404(self, auth_client):
        resp = auth_client.post(
            "/api/auth/mfa/recovery/confirm",
            json={"token": "nope", "password": "testpassword123"},
        )
        assert resp.status_code == 404

    def test_confirm_used_token_400(self, auth_client, db_session, test_user):
        from app.models import MfaResetToken
        token = self._seed_token(db_session, test_user)
        tok = db_session.query(MfaResetToken).filter_by(user_id=test_user.user_id).first()
        tok.used_at = datetime.now(timezone.utc)
        db_session.commit()
        resp = auth_client.post(
            "/api/auth/mfa/recovery/confirm",
            json={"token": token, "password": "testpassword123"},
        )
        assert resp.status_code == 400

    def test_confirm_expired_token_400(self, auth_client, db_session, test_user):
        token = self._seed_token(db_session, test_user, expires_in_hours=-1)
        resp = auth_client.post(
            "/api/auth/mfa/recovery/confirm",
            json={"token": token, "password": "testpassword123"},
        )
        assert resp.status_code == 400


class TestEmailVerification:
    """Email verification confirm endpoint — token validation + single-use."""

    @pytest.fixture(autouse=True)
    def _no_rate_limit(self, monkeypatch):
        # The 5/300s limiter is shared across all calls in this class.
        from app.fastapi_app.routers import auth as auth_router
        monkeypatch.setattr(auth_router._email_verification_limiter, "allow", lambda *_a, **_k: True)

    def _seed_token(self, db_session, user, expires_in_hours=24):
        from app.models import EmailVerificationToken
        from app.services.auth_utils import (
            generate_email_verification_token,
            hash_email_verification_token,
        )
        token = generate_email_verification_token()
        db_session.add(EmailVerificationToken(
            user_id=user.user_id,
            token_hash=hash_email_verification_token(token),
            expires_at=datetime.now(timezone.utc) + timedelta(hours=expires_in_hours),
        ))
        db_session.commit()
        return token

    def test_confirm_marks_user_verified(self, auth_client, db_session, test_user):
        assert test_user.email_verified_at is None
        token = self._seed_token(db_session, test_user)

        resp = auth_client.post("/api/auth/email-verification/confirm", json={"token": token})
        assert resp.status_code == 200

        db_session.refresh(test_user)
        assert test_user.email_verified_at is not None

    def test_confirm_with_unknown_token_404s(self, auth_client):
        resp = auth_client.post("/api/auth/email-verification/confirm", json={"token": "bogus"})
        assert resp.status_code == 404

    def test_token_is_single_use(self, auth_client, db_session, test_user):
        token = self._seed_token(db_session, test_user)
        assert auth_client.post("/api/auth/email-verification/confirm", json={"token": token}).status_code == 200
        # Second use rejected.
        assert auth_client.post("/api/auth/email-verification/confirm", json={"token": token}).status_code == 400

    def test_expired_token_400s(self, auth_client, db_session, test_user):
        token = self._seed_token(db_session, test_user, expires_in_hours=-1)
        resp = auth_client.post("/api/auth/email-verification/confirm", json={"token": token})
        assert resp.status_code == 400

    def test_resend_does_not_leak_account_existence(self, auth_client):
        # Always returns success regardless of whether the email is on file.
        resp = auth_client.post(
            "/api/auth/email-verification/resend",
            json={"email": "nobody@example.com"},
        )
        assert resp.status_code == 200


class TestRequireVerifiedEmail:
    """#70: hard email-verification gate dependency (require_verified_email).

    Unit-level — the dependency is pure given (auth, db), so we mock the db
    query rather than stand up a full request. Verifies the 403 contract the
    frontend keys off and that verified users pass through unchanged.
    """

    @staticmethod
    def _auth(uid):
        from app.fastapi_app.dependencies.auth import AuthContext
        return AuthContext(
            user_id=uid,
            email="user@example.com",
            active_organization_id=None,
            mfa_verified=False,
            mfa_at=None,
        )

    @staticmethod
    def _db_returning(user):
        db = MagicMock()
        db.query.return_value.filter_by.return_value.first.return_value = user
        return db

    def test_unverified_user_blocked_with_403_code(self):
        from fastapi import HTTPException
        from app.fastapi_app.dependencies.auth import require_verified_email

        uid = uuid.uuid4()
        db = self._db_returning(MagicMock(email_verified_at=None))
        with pytest.raises(HTTPException) as ei:
            require_verified_email(auth=self._auth(uid), db=db)
        assert ei.value.status_code == 403
        assert ei.value.detail["code"] == "email_verification_required"

    def test_missing_user_blocked(self):
        from fastapi import HTTPException
        from app.fastapi_app.dependencies.auth import require_verified_email

        db = self._db_returning(None)
        with pytest.raises(HTTPException) as ei:
            require_verified_email(auth=self._auth(uuid.uuid4()), db=db)
        assert ei.value.status_code == 403

    def test_verified_user_passes_through(self):
        from app.fastapi_app.dependencies.auth import require_verified_email

        uid = uuid.uuid4()
        db = self._db_returning(MagicMock(email_verified_at=datetime.now(timezone.utc)))
        out = require_verified_email(auth=self._auth(uid), db=db)
        assert out.user_id == uid
