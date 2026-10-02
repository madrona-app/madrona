"""
Tests for Cognito-based login endpoint.

Tests that /api/auth/login endpoint:
- Authenticates via Cognito
- Verifies ID token
- Creates/links internal user record
- Returns app's own tokens (not Cognito tokens)
- Handles MFA challenges
- Handles rate limiting
"""

import pytest
from unittest.mock import patch, MagicMock
from uuid import uuid4, UUID
from datetime import datetime, timezone, timedelta

from app.models import User, Organization, OrganizationMembership, RefreshToken, Role
from app.services.cognito import (
    AuthSuccess,
    AuthChallenge,
    AuthResultType,
    AuthTokens,
    InvalidCredentialsError,
    UserNotFoundError,
    UserNotConfirmedError,
    CognitoAuthError,
)
from app.services.rate_limiter import auth_limiter


@pytest.fixture(autouse=True)
def _disable_rate_limiting():
    """Override conftest autouse fixture — login tests need real rate limiting."""
    yield


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    """Reset rate limiter before each test to prevent cross-test interference."""
    auth_limiter.reset()
    yield
    auth_limiter.reset()


def _make_user(db_session, email=None, status="active", role_key="admin", legacy_role="admin"):
    """Create a user with org and membership for login tests. Returns dict."""
    email = email or f"test-{uuid4().hex[:8]}@example.com"
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

    user = User(email=email, password_hash="dummy", status=status)
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


def _mock_cognito_success(email, cognito_sub=None):
    """Return mock patches for a successful Cognito auth + ID token verification."""
    cognito_sub = cognito_sub or f"cognito-{uuid4().hex}"
    tokens = AuthTokens(
        id_token="mock-id-token",
        access_token="mock-access-token",
        refresh_token="mock-refresh-token",
        expires_in=3600,
    )
    auth_success = AuthSuccess(type=AuthResultType.SUCCESS, tokens=tokens)
    id_claims = {
        "sub": cognito_sub,
        "email": email,
        "email_verified": True,
        "token_use": "id",
    }
    return auth_success, id_claims, cognito_sub


class TestLoginEndpoint:
    """Tests for /api/auth/login endpoint."""

    @pytest.fixture(autouse=True)
    def _mock_cognito_mfa_status(self):
        """The login handler calls cognito_get_user_mfa_status() for users with
        admin-like roles (see app/fastapi_app/routers/auth.py:334). Our test
        users default to admin, so without this mock boto3 tries to reach AWS
        and fails with NoCredentialsError in CI."""
        with patch(
            "app.fastapi_app.routers.auth.cognito_get_user_mfa_status",
            return_value={"totp_enabled": True},
        ):
            yield

    @patch("app.fastapi_app.routers.auth.verify_cognito_id_token")
    @patch("app.fastapi_app.routers.auth.cognito_initiate_auth")
    def test_login_success(self, mock_auth, mock_verify, client, db_session):
        """Test successful login flow."""
        info = _make_user(db_session)
        auth_success, id_claims, _ = _mock_cognito_success(info["email"])
        mock_auth.return_value = auth_success
        mock_verify.return_value = id_claims

        resp = client.post("/api/auth/login", json={
            "email": info["email"],
            "password": "TestPass123!",
        })

        assert resp.status_code == 200
        data = resp.get_json()
        assert data["email"] == info["email"]
        assert "access_token" in data
        assert "user_id" in data
        mock_auth.assert_called_once()

    @patch("app.fastapi_app.routers.auth.verify_cognito_id_token")
    @patch("app.fastapi_app.routers.auth.cognito_initiate_auth")
    def test_login_links_cognito_sub(self, mock_auth, mock_verify, client, db_session):
        """Test login links cognito_sub to existing user."""
        info = _make_user(db_session)
        auth_success, id_claims, cognito_sub = _mock_cognito_success(info["email"])
        mock_auth.return_value = auth_success
        mock_verify.return_value = id_claims

        resp = client.post("/api/auth/login", json={
            "email": info["email"],
            "password": "TestPass123!",
        })

        assert resp.status_code == 200
        user = db_session.query(User).filter_by(email=info["email"]).first()
        assert user.cognito_sub == cognito_sub

    @patch("app.fastapi_app.routers.auth.cognito_initiate_auth")
    def test_login_invalid_credentials(self, mock_auth, client, db_session):
        """Test login with invalid credentials."""
        info = _make_user(db_session)
        mock_auth.side_effect = InvalidCredentialsError("Invalid password")

        resp = client.post("/api/auth/login", json={
            "email": info["email"],
            "password": "WrongPassword",
        })

        assert resp.status_code == 401
        data = resp.get_json()
        assert data["error"]["message"] == "Invalid credentials"

    @patch("app.fastapi_app.routers.auth.cognito_initiate_auth")
    def test_login_user_not_found(self, mock_auth, client, db_session):
        """Test login with non-existent Cognito user returns generic error."""
        mock_auth.side_effect = UserNotFoundError("User not found")

        resp = client.post("/api/auth/login", json={
            "email": "nonexistent@example.com",
            "password": "TestPass123!",
        })

        assert resp.status_code == 401
        data = resp.get_json()
        assert data["error"]["message"] == "Invalid credentials"

    @patch("app.fastapi_app.routers.auth.cognito_initiate_auth")
    def test_login_user_not_confirmed(self, mock_auth, client, db_session):
        """Test login with unconfirmed Cognito user."""
        info = _make_user(db_session)
        mock_auth.side_effect = UserNotConfirmedError("User not confirmed")

        resp = client.post("/api/auth/login", json={
            "email": info["email"],
            "password": "TestPass123!",
        })

        assert resp.status_code == 401
        data = resp.get_json()
        assert data["error"]["message"] == "Please verify your email address"

    @patch("app.fastapi_app.routers.auth.cognito_initiate_auth")
    def test_login_mfa_required(self, mock_auth, client, db_session):
        """Test login returns MFA challenge."""
        info = _make_user(db_session)
        mock_auth.return_value = AuthChallenge(
            type=AuthResultType.MFA_REQUIRED,
            challenge_name="SOFTWARE_TOKEN_MFA",
            session="mock-mfa-session",
            challenge_parameters={"USER_ID_FOR_SRP": "test-user"},
        )

        resp = client.post("/api/auth/login", json={
            "email": info["email"],
            "password": "TestPass123!",
        })

        assert resp.status_code == 200
        data = resp.get_json()
        assert data["mfaRequired"] is True
        assert data["mfaType"] == "totp"
        assert "session" in data

    def test_login_missing_email(self, client, db_session):
        """Test login with missing email."""
        resp = client.post("/api/auth/login", json={"password": "TestPass123!"})
        assert resp.status_code in (400, 422)

    def test_login_missing_password(self, client, db_session):
        """Test login with missing password."""
        resp = client.post("/api/auth/login", json={"email": "test@example.com"})
        assert resp.status_code in (400, 422)

    @patch("app.fastapi_app.routers.auth.verify_cognito_id_token")
    @patch("app.fastapi_app.routers.auth.cognito_initiate_auth")
    def test_login_inactive_user(self, mock_auth, mock_verify, client, db_session):
        """Test login with inactive user account."""
        info = _make_user(db_session, status="suspended")
        auth_success, id_claims, _ = _mock_cognito_success(info["email"])
        mock_auth.return_value = auth_success
        mock_verify.return_value = id_claims

        resp = client.post("/api/auth/login", json={
            "email": info["email"],
            "password": "TestPass123!",
        })

        assert resp.status_code == 403
        data = resp.get_json()
        assert data["error"]["message"] == "Account is not active"


class TestMFAEndpoint:
    """Tests for the /api/auth/mfa/verify endpoint."""

    @patch("app.fastapi_app.routers.auth.verify_cognito_id_token")
    @patch("app.fastapi_app.routers.auth.cognito_respond_to_auth_challenge")
    def test_mfa_success(self, mock_respond, mock_verify, client, db_session):
        """Test successful MFA verification."""
        info = _make_user(db_session)
        cognito_sub = f"cognito-{uuid4().hex}"
        tokens = AuthTokens(
            id_token="mock-id-token",
            access_token="mock-access-token",
            refresh_token="mock-refresh-token",
            expires_in=3600,
        )
        mock_respond.return_value = AuthSuccess(type=AuthResultType.SUCCESS, tokens=tokens)
        mock_verify.return_value = {"sub": cognito_sub, "email": info["email"], "token_use": "id"}

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
    def test_mfa_invalid_code(self, mock_respond, client, db_session):
        """Test MFA with invalid code returns generic error."""
        mock_respond.side_effect = CognitoAuthError(
            code="CodeMismatchException",
            message="Invalid code",
        )

        resp = client.post("/api/auth/mfa/verify", json={
            "email": "test@example.com",
            "code": "000000",
            "session": "mock-session",
        })

        assert resp.status_code == 401
        data = resp.get_json()
        assert data["error"]["message"] == "Authentication failed"

    @patch("app.fastapi_app.routers.auth.cognito_respond_to_auth_challenge")
    def test_mfa_expired_code(self, mock_respond, client, db_session):
        """Test MFA with expired code returns generic error."""
        mock_respond.side_effect = CognitoAuthError(
            code="ExpiredCodeException",
            message="Code expired",
        )

        resp = client.post("/api/auth/mfa/verify", json={
            "email": "test@example.com",
            "session": "mock-session",
            "code": "123456",
        })

        assert resp.status_code == 401
        data = resp.get_json()
        assert data["error"]["message"] == "Authentication failed"

    def test_mfa_missing_session(self, client, db_session):
        """Test MFA with missing session."""
        resp = client.post("/api/auth/mfa/verify", json={
            "email": "test@example.com",
            "code": "123456",
        })
        assert resp.status_code in (400, 422)

    def test_mfa_missing_code(self, client, db_session):
        """Test MFA with missing code."""
        resp = client.post("/api/auth/mfa/verify", json={
            "email": "test@example.com",
            "session": "mock-session",
        })
        assert resp.status_code in (400, 422)

    def test_mfa_missing_email(self, client, db_session):
        """Test MFA with missing email."""
        resp = client.post("/api/auth/mfa/verify", json={
            "session": "mock-session",
            "code": "123456",
        })
        assert resp.status_code in (400, 422)

    @patch("app.fastapi_app.routers.auth.verify_cognito_id_token")
    @patch("app.fastapi_app.routers.auth.cognito_respond_to_auth_challenge")
    def test_mfa_success_writes_audit_log_under_strict_rls(
        self, mock_respond, mock_verify, client, db_session,
    ):
        """Regression for the production 500 on POST /api/auth/mfa/verify
        (May 2026): the handler bootstraps RLS with organization_id=None
        so the user-aware membership lookup works, but the audit_logs
        INSERT downstream requires (organization_id = current_org_id()).
        Before the fix, the audit-log flush violated WITH CHECK, the
        except-SQLAlchemyError swallowed the row violation, and the
        subsequent db.commit() raised PendingRollbackError → 500.

        We can't reproduce the RLS rejection directly under the
        savepoint test session (it runs as superuser, bypasses RLS), so
        instead we assert the observable contract: by the time
        log_mfa_challenge_success is invoked, the session's
        current_org_id GUC must equal the user's first membership's
        org_id — proving the re-bootstrap ran.
        """
        from sqlalchemy import text as _sa_text

        info = _make_user(db_session)
        cognito_sub = f"cognito-{uuid4().hex}"
        tokens = AuthTokens(
            id_token="mock-id-token",
            access_token="mock-access-token",
            refresh_token="mock-refresh-token",
            expires_in=3600,
        )
        mock_respond.return_value = AuthSuccess(type=AuthResultType.SUCCESS, tokens=tokens)
        mock_verify.return_value = {"sub": cognito_sub, "email": info["email"], "token_use": "id"}

        captured_org_id = {}

        def fake_log_mfa(session, **kwargs):
            row = session.execute(
                _sa_text("SELECT current_setting('app.current_org_id', true)")
            ).scalar()
            captured_org_id["value"] = row
            # Return a minimal AuditLog stand-in so the caller proceeds
            from app.models import AuditLog
            return AuditLog(
                organization_id=kwargs.get("organization_id"),
                action="auth.mfa_challenge_success",
                details={},
            )

        # The handler imports log_mfa_challenge_success lazily inside
        # the function body (`from app.services.audit_service import ...`),
        # so patch at the source module — patching on the auth router
        # raises AttributeError because the name doesn't exist there
        # until the handler runs.
        with patch(
            "app.services.audit_service.log_mfa_challenge_success",
            side_effect=fake_log_mfa,
        ):
            resp = client.post("/api/auth/mfa/verify", json={
                "email": info["email"],
                "code": "123456",
                "session": "mock-session",
            })

        assert resp.status_code == 200, resp.get_json()
        # current_org_id GUC must be the user's first membership org
        assert captured_org_id["value"] == info["org_id"], (
            "Audit log was called with current_org_id="
            f"{captured_org_id['value']!r}; expected {info['org_id']}. "
            "The pre-fix code left current_org_id=NULL, which (under "
            "strict RLS) rejected the audit_logs INSERT and broke "
            "db.commit()."
        )

    @patch("app.fastapi_app.routers.auth.verify_cognito_id_token")
    @patch("app.fastapi_app.routers.auth.cognito_respond_to_auth_challenge")
    def test_mfa_verify_under_strict_rls_no_500(
        self, mock_respond, mock_verify, rls_client, rls_db_session,
    ):
        """End-to-end strict-RLS regression for the May 2026 production 500.

        This test runs the same flow as test_mfa_success but with the
        rls_client + rls_db_session fixtures, which switch the underlying
        DB connection to the `madrona_app` role (NOBYPASSRLS). The
        audit_logs WITH CHECK policy now actually fires — so if anyone
        reverts the re-bootstrap fix in login_mfa, this test returns 500
        with PendingRollbackError exactly like production did.

        Pre-fix verification: replace the
        `set_rls_context_for_session(db, organization_id=..., user_id=...)`
        call in login_mfa with the bootstrap call alone
        (organization_id=None) and this test goes red.
        """
        from sqlalchemy import text as _sa_text

        # Under strict RLS the test-side org INSERT inside _make_user
        # needs current_org_id set first. Pick the id, set the GUC,
        # then seed.
        org_id = uuid4()
        rls_db_session.execute(
            _sa_text("SELECT set_config('app.current_org_id', :v, true)"),
            {"v": str(org_id)},
        )

        from app.models import (
            Organization,
            OrganizationMembership,
            Role,
            User,
        )
        org = Organization(
            organization_id=org_id,
            name="Strict RLS Test Org",
            slug=f"strict-rls-{uuid4().hex[:8]}",
            status="active",
        )
        rls_db_session.add(org)
        # System roles live with organization_id IS NULL and can only
        # be seeded by the BYPASSRLS owner role in prod. Use an
        # org-scoped role here so the standard policy lets the INSERT
        # through — what matters for this test is that login_mfa's
        # audit_logs INSERT works, not the role's scope.
        role = Role(
            role_key="admin",
            display_name="Admin",
            is_system=False,
            organization_id=org_id,
        )
        rls_db_session.add(role)
        rls_db_session.flush()
        user = User(
            email=f"strict-rls-{uuid4().hex[:6]}@example.com",
            password_hash="dummy",
            status="active",
        )
        rls_db_session.add(user)
        rls_db_session.flush()
        membership = OrganizationMembership(
            organization_id=org_id,
            user_id=user.user_id,
            role="admin",
            role_id=role.role_id,
            status="active",
        )
        rls_db_session.add(membership)
        rls_db_session.commit()

        info = {
            "user_id": str(user.user_id),
            "email": user.email,
            "org_id": str(org_id),
        }
        cognito_sub = f"cognito-{uuid4().hex}"
        tokens = AuthTokens(
            id_token="mock-id-token",
            access_token="mock-access-token",
            refresh_token="mock-refresh-token",
            expires_in=3600,
        )
        mock_respond.return_value = AuthSuccess(type=AuthResultType.SUCCESS, tokens=tokens)
        mock_verify.return_value = {"sub": cognito_sub, "email": info["email"], "token_use": "id"}

        # Pre-fix expectation: this returns 500 with PendingRollbackError
        # because audit_logs INSERT violates org-isolation WITH CHECK.
        # Post-fix expectation: 200 with access_token in the body.
        resp = rls_client.post("/api/auth/mfa/verify", json={
            "email": info["email"],
            "code": "123456",
            "session": "mock-session",
        })

        assert resp.status_code == 200, (
            "MFA verify under strict RLS returned "
            f"{resp.status_code}: {resp.get_json()}. The re-bootstrap "
            "fix in login_mfa is broken — audit_logs INSERT is failing "
            "RLS, the except-SQLAlchemyError catch isn't rolling back "
            "the savepoint correctly, or both."
        )
        data = resp.get_json()
        assert "access_token" in data
        assert data["email"] == info["email"]

    @patch("app.fastapi_app.routers.auth.verify_cognito_id_token")
    @patch("app.fastapi_app.routers.auth.cognito_respond_to_auth_challenge")
    def test_mfa_sms_type(self, mock_respond, mock_verify, client, db_session):
        """Test MFA with SMS type uses correct challenge name."""
        info = _make_user(db_session)
        cognito_sub = f"cognito-{uuid4().hex}"
        tokens = AuthTokens(
            id_token="mock-id-token",
            access_token="mock-access-token",
            refresh_token="mock-refresh-token",
            expires_in=3600,
        )
        mock_respond.return_value = AuthSuccess(type=AuthResultType.SUCCESS, tokens=tokens)
        mock_verify.return_value = {"sub": cognito_sub, "email": info["email"], "token_use": "id"}

        resp = client.post("/api/auth/mfa/verify", json={
            "email": info["email"],
            "code": "123456",
            "session": "mock-session",
            "mfaType": "sms",
        })

        assert resp.status_code == 200
        call_kwargs = mock_respond.call_args
        assert call_kwargs.kwargs["challenge_name"] == "SMS_MFA"


class TestRateLimiting:
    """Tests for login rate limiting."""

    @patch("app.fastapi_app.routers.auth.cognito_initiate_auth")
    def test_login_rate_limit_by_email(self, mock_auth, client, db_session):
        """Test rate limiting by email (progressive delays)."""
        test_email = f"ratelimit-{uuid4().hex[:8]}@example.com"
        mock_auth.side_effect = InvalidCredentialsError("Invalid")

        # Record enough failures to trigger lockout (hard limit = 10 requests/window)
        responses = []
        for i in range(12):
            resp = client.post("/api/auth/login", json={
                "email": test_email,
                "password": "wrong",
            })
            responses.append(resp.status_code)

        # At least one response should be 429 (rate limited)
        assert 429 in responses


class TestAdminMFAEnforcement:
    """Tests for admin-only MFA enforcement."""

    @patch("app.fastapi_app.routers.auth.cognito_get_user_mfa_status")
    @patch("app.fastapi_app.routers.auth.verify_cognito_id_token")
    @patch("app.fastapi_app.routers.auth.cognito_initiate_auth")
    def test_admin_without_mfa_gets_setup_required(
        self, mock_auth, mock_verify, mock_mfa_status, client, db_session
    ):
        """Test that admin user without MFA configured gets mfaSetupRequired."""
        info = _make_user(db_session, role_key="admin", legacy_role="admin")
        auth_success, id_claims, _ = _mock_cognito_success(info["email"])
        mock_auth.return_value = auth_success
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

    @patch("app.fastapi_app.routers.auth.verify_cognito_id_token")
    @patch("app.fastapi_app.routers.auth.cognito_initiate_auth")
    def test_non_admin_can_login_without_mfa(self, mock_auth, mock_verify, client, db_session):
        """Test that non-admin user can login without MFA configured."""
        info = _make_user(db_session, role_key="viewer", legacy_role="member")
        auth_success, id_claims, _ = _mock_cognito_success(info["email"])
        mock_auth.return_value = auth_success
        mock_verify.return_value = id_claims

        resp = client.post("/api/auth/login", json={
            "email": info["email"],
            "password": "TestPass123!",
        })

        assert resp.status_code == 200
        data = resp.get_json()
        assert "access_token" in data


class TestMFAEnrollment:
    """Tests for TOTP MFA enrollment endpoints."""

    @patch("app.fastapi_app.routers.auth.cognito_associate_software_token")
    @patch("app.fastapi_app.routers.auth.cognito_get_user")
    def test_mfa_setup_start_success(self, mock_get_user, mock_associate, client, db_session):
        """Test successful MFA setup start."""
        info = _make_user(db_session)
        mock_get_user.return_value = {"username": info["email"], "email": info["email"]}
        mock_associate.return_value = {"secret_code": "JBSWY3DPEHPK3PXP"}

        resp = client.post("/api/auth/mfa/setup/start", json={
            "email": info["email"],
            "session": "mock-access-token",
        })

        assert resp.status_code == 200
        data = resp.get_json()
        assert "secret" in data
        assert "otpauthUrl" in data
        assert "session" in data
        assert data["secret"] == "JBSWY3DPEHPK3PXP"
        assert info["email"] in data["otpauthUrl"]
        assert "otpauth://totp/Madrona:" in data["otpauthUrl"]

    @patch("app.fastapi_app.routers.auth.cognito_get_user")
    def test_mfa_setup_start_email_mismatch(self, mock_get_user, client, db_session):
        """Test MFA setup fails when email doesn't match token."""
        info = _make_user(db_session)
        mock_get_user.return_value = {
            "username": "different@example.com",
            "email": "different@example.com",
        }

        resp = client.post("/api/auth/mfa/setup/start", json={
            "email": info["email"],
            "session": "mock-access-token",
        })

        assert resp.status_code == 401
        data = resp.get_json()
        assert data["error"]["message"] == "Invalid or expired session"

    @patch("app.fastapi_app.routers.auth.cognito_get_user")
    def test_mfa_setup_start_invalid_session(self, mock_get_user, client, db_session):
        """Test MFA setup fails with invalid session."""
        mock_get_user.side_effect = InvalidCredentialsError("Invalid token")

        resp = client.post("/api/auth/mfa/setup/start", json={
            "email": "test@example.com",
            "session": "invalid-token",
        })

        assert resp.status_code == 401
        data = resp.get_json()
        assert data["error"]["message"] == "Invalid or expired session"

    def test_mfa_setup_start_missing_fields(self, client, db_session):
        """Test MFA setup fails with missing fields."""
        # Missing email
        resp = client.post("/api/auth/mfa/setup/start", json={"session": "mock-token"})
        assert resp.status_code in (400, 422)

        # Missing session
        resp = client.post("/api/auth/mfa/setup/start", json={"email": "test@example.com"})
        assert resp.status_code in (400, 422)

    @patch("app.fastapi_app.routers.auth.cognito_set_user_mfa_preference")
    @patch("app.fastapi_app.routers.auth.cognito_verify_software_token")
    @patch("app.fastapi_app.routers.auth.cognito_get_user")
    def test_mfa_setup_verify_success(
        self, mock_get_user, mock_verify_sw, mock_set_pref, client, db_session
    ):
        """Test successful MFA setup verification."""
        info = _make_user(db_session)
        mock_get_user.return_value = {"username": info["email"], "email": info["email"]}
        mock_verify_sw.return_value = {"status": "SUCCESS"}

        resp = client.post("/api/auth/mfa/setup/verify", json={
            "email": info["email"],
            "code": "123456",
            "session": "mock-access-token",
        })

        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        mock_set_pref.assert_called_once_with(
            access_token="mock-access-token",
            totp_enabled=True,
            preferred="SOFTWARE_TOKEN_MFA",
        )

    @patch("app.fastapi_app.routers.auth.cognito_verify_software_token")
    @patch("app.fastapi_app.routers.auth.cognito_get_user")
    def test_mfa_setup_verify_invalid_code(self, mock_get_user, mock_verify_sw, client, db_session):
        """Test MFA setup verify fails with invalid code."""
        info = _make_user(db_session)
        mock_get_user.return_value = {"email": info["email"]}
        mock_verify_sw.side_effect = CognitoAuthError(
            code="InvalidMFACode",
            message="Invalid code",
        )

        resp = client.post("/api/auth/mfa/setup/verify", json={
            "email": info["email"],
            "code": "000000",
            "session": "mock-access-token",
        })

        assert resp.status_code == 401

    @patch("app.fastapi_app.routers.auth.cognito_get_user")
    def test_mfa_setup_verify_email_mismatch(self, mock_get_user, client, db_session):
        """Test MFA setup verify fails when email doesn't match token."""
        info = _make_user(db_session)
        mock_get_user.return_value = {"email": "different@example.com"}

        resp = client.post("/api/auth/mfa/setup/verify", json={
            "email": info["email"],
            "code": "123456",
            "session": "mock-access-token",
        })

        assert resp.status_code == 401
        data = resp.get_json()
        assert data["error"]["message"] == "Invalid or expired session"

    def test_mfa_setup_verify_invalid_code_format(self, client, db_session):
        """Test MFA setup verify fails with invalid code format."""
        resp = client.post("/api/auth/mfa/setup/verify", json={
            "email": "test@example.com",
            "code": "abc123",
            "session": "mock-access-token",
        })
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "Code must be 6 digits" in (_e.get("message", "") if isinstance(_e, dict) else str(_e))

        resp = client.post("/api/auth/mfa/setup/verify", json={
            "email": "test@example.com",
            "code": "12345",
            "session": "mock-access-token",
        })
        assert resp.status_code in (400, 422)

    def test_mfa_setup_verify_missing_fields(self, client, db_session):
        """Test MFA setup verify fails with missing fields."""
        resp = client.post("/api/auth/mfa/setup/verify", json={
            "code": "123456", "session": "mock-token",
        })
        assert resp.status_code in (400, 422)

        resp = client.post("/api/auth/mfa/setup/verify", json={
            "email": "test@example.com", "session": "mock-token",
        })
        assert resp.status_code in (400, 422)

        resp = client.post("/api/auth/mfa/setup/verify", json={
            "email": "test@example.com", "code": "123456",
        })
        assert resp.status_code in (400, 422)


class TestSessionRefreshLogout:
    """Tests for session refresh and logout endpoints."""

    def test_refresh_no_cookie(self, client, db_session):
        """Test refresh fails when no refresh token cookie is present."""
        resp = client.post("/api/auth/refresh")
        assert resp.status_code == 401
        data = resp.get_json()
        assert data["error"]["message"] == "No refresh token"

    def test_refresh_invalid_token(self, client, db_session):
        """Test refresh fails with invalid token."""
        client.set_cookie("refresh_token", "invalid-token-value")
        resp = client.post("/api/auth/refresh")
        assert resp.status_code == 401
        data = resp.get_json()
        assert data["error"]["message"] == "Invalid refresh token"

    def test_refresh_expired_token(self, client, db_session):
        """Test refresh fails with expired token."""
        from app.services.auth_utils import generate_refresh_token, hash_refresh_token

        info = _make_user(db_session)
        refresh_token_value = generate_refresh_token()
        token_hash = hash_refresh_token(refresh_token_value)

        token_record = RefreshToken(
            user_id=UUID(info["user_id"]),
            token_hash=token_hash,
            expires_at=datetime.now(timezone.utc) - timedelta(days=1),
            active_organization_id=UUID(info["org_id"]),
        )
        db_session.add(token_record)
        db_session.commit()

        client.set_cookie("refresh_token", refresh_token_value)
        resp = client.post("/api/auth/refresh")
        assert resp.status_code == 401
        data = resp.get_json()
        assert data["error"]["message"] == "Refresh token expired"

    def test_refresh_valid_token(self, client, db_session):
        """Test refresh succeeds with valid token."""
        from app.services.auth_utils import generate_refresh_token, hash_refresh_token

        info = _make_user(db_session)
        refresh_token_value = generate_refresh_token()
        token_hash = hash_refresh_token(refresh_token_value)

        token_record = RefreshToken(
            user_id=UUID(info["user_id"]),
            token_hash=token_hash,
            expires_at=datetime.now(timezone.utc) + timedelta(days=30),
            active_organization_id=UUID(info["org_id"]),
            mfa_verified=False,
        )
        db_session.add(token_record)
        db_session.commit()

        client.set_cookie("refresh_token", refresh_token_value)
        resp = client.post("/api/auth/refresh")
        assert resp.status_code == 200
        data = resp.get_json()
        assert "access_token" in data
        assert data["mfa_verified"] is False

    def test_logout_revokes_token_and_clears_cookie(self, client, db_session):
        """Test logout revokes token and clears cookie."""
        from app.services.auth_utils import generate_refresh_token, hash_refresh_token

        info = _make_user(db_session)
        refresh_token_value = generate_refresh_token()
        token_hash = hash_refresh_token(refresh_token_value)

        token_record = RefreshToken(
            user_id=UUID(info["user_id"]),
            token_hash=token_hash,
            expires_at=datetime.now(timezone.utc) + timedelta(days=30),
            active_organization_id=UUID(info["org_id"]),
        )
        db_session.add(token_record)
        db_session.commit()
        token_id = token_record.token_id

        client.set_cookie("refresh_token", refresh_token_value)
        resp = client.post("/api/auth/logout")

        assert resp.status_code == 200
        data = resp.get_json()
        assert data["message"] == "Logged out"

        # Verify token was revoked
        token = db_session.query(RefreshToken).filter_by(token_id=token_id).first()
        assert token is not None
        assert token.revoked_at is not None

        # Verify cookie was cleared
        set_cookie_header = resp.headers.get("Set-Cookie", "")
        assert "refresh_token=" in set_cookie_header
        assert "Max-Age=0" in set_cookie_header

    def test_logout_without_cookie_succeeds(self, client, db_session):
        """Test logout succeeds even without a cookie (idempotent)."""
        resp = client.post("/api/auth/logout")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["message"] == "Logged out"

    def test_logout_with_invalid_token_succeeds(self, client, db_session):
        """Test logout succeeds even with invalid token (idempotent)."""
        client.set_cookie("refresh_token", "invalid-token")
        resp = client.post("/api/auth/logout")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["message"] == "Logged out"
