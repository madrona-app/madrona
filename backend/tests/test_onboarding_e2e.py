"""
End-to-end onboarding flow test.

Validates the complete happy-path:
  provision -> invite email -> activate -> first login -> correct org landing

Uses the shared conftest.py fixtures (app, client, db_session) with SQLite
in-memory DB. External services (Cognito, SES, Sentry, Redis) are mocked.
"""

import hashlib
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, Mock, patch

import pytest

from app.database import current_session
from app.models import (
    AuditLog,
    Application,
    Organization,
    OrganizationApplication,
    OrganizationInvitation,
    OrganizationMembership,
    Permission as PermissionModel,
    ProvisioningAuditLog,
    RefreshToken,
    Role,
    RolePermission,
    User,
    OrgProvisioningJob,
)
from app.services.cognito import AuthSuccess, AuthResultType


# ---------------------------------------------------------------------------
# Module-level autouse fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _mock_mfa_status():
    """The login handler calls cognito_get_user_mfa_status for admin-role
    users; onboarding tests provision admins and then invoke login, so this
    must be mocked or CI hits NoCredentialsError from boto3."""
    with patch(
        "app.fastapi_app.routers.auth.cognito_get_user_mfa_status",
        return_value={"totp_enabled": True},
    ):
        yield


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _disable_all_rate_limits():
    """Disable every rate limiter that could interfere with E2E tests.

    Rate-limiter singletons are backed by Redis (when available) or in-memory
    storage.  Their state persists across test runs within the same 60-second
    window, which causes spurious 429 responses.  Patching .allow to always
    return True prevents rate-limit interference in E2E tests.

    Patched limiters:
    - api_limiter (global before_request hook in app.main, 200/min/IP)
    - activate_limiter, activate_hourly_limiter, activate_token_limiter (activation endpoint)
    - verify_limiter, verify_hourly_limiter (invitation verify endpoint)
    - resend_daily_limiter, resend_force_daily_limiter (resend-invite endpoint)
    """
    _targets = [
        # Global API rate limiter (lazy-imported in app.main.check_global_rate_limit)
        "app.services.rate_limiter.api_limiter",
        # Activation endpoint limiters
        "app.fastapi_app.routers.auth.activate_limiter",
        "app.fastapi_app.routers.auth.activate_hourly_limiter",
        "app.fastapi_app.routers.auth.activate_token_limiter",
        # Verify endpoint limiters
        "app.fastapi_app.routers.auth.verify_limiter",
        "app.fastapi_app.routers.auth.verify_hourly_limiter",
    ]
    patches = [patch(t) for t in _targets]
    mocks = [p.start() for p in patches]
    for m in mocks:
        m.allow.return_value = True
    yield
    for p in patches:
        p.stop()


@pytest.fixture()
def seed(db_session):
    """Seed reference data: platform admin org, roles, permissions, app catalog."""

    # --- Platform admin's home organization ---------------------------------
    platform_org = Organization(
        name="Madrona Platform",
        slug="madrona-platform",
        status="active",
    )
    db_session.add(platform_org)
    db_session.flush()

    # --- Roles --------------------------------------------------------------
    platform_admin_role = Role(
        role_key="platform_admin",
        display_name="Platform Administrator",
        description="Full platform access",
        is_system=True,
    )
    org_admin_role = Role(
        role_key="admin",
        display_name="Organization Administrator",
        description="Org admin",
        is_system=True,
    )
    db_session.add_all([platform_admin_role, org_admin_role])
    db_session.flush()

    # --- Permissions --------------------------------------------------------
    platform_perm = PermissionModel(
        permission_key="platform.admin",
        scope="platform",
        action="admin",
        display_name="Platform Admin",
        description="Full platform administration access",
    )
    db_session.add(platform_perm)
    db_session.flush()

    # Wire platform_admin role -> platform.admin permission
    rp = RolePermission(
        role_id=platform_admin_role.role_id,
        permission_id=platform_perm.permission_id,
    )
    db_session.add(rp)
    db_session.flush()

    # --- Platform admin user ------------------------------------------------
    admin_user = User(
        email="superadmin@example.com",
        display_name="Platform Super Admin",
        status="active",
    )
    db_session.add(admin_user)
    db_session.flush()

    membership = OrganizationMembership(
        organization_id=platform_org.organization_id,
        user_id=admin_user.user_id,
        role="admin",
        role_id=platform_admin_role.role_id,
        status="active",
    )
    db_session.add(membership)
    db_session.flush()

    # --- Application catalog ------------------------------------------------
    collections_app = Application(
        key="collections",
        display_name="Collections",
        description="Collections management",
        icon="archive",
        status="active",
        sort_order=1,
    )
    db_session.add(collections_app)
    db_session.flush()

    db_session.commit()

    # Capture IDs before they might expire from session
    platform_org_id = platform_org.organization_id
    admin_user_id = admin_user.user_id
    admin_user_email = admin_user.email
    platform_admin_role_id = platform_admin_role.role_id
    org_admin_role_id = org_admin_role.role_id

    return {
        "platform_org": platform_org,
        "platform_org_id": platform_org_id,
        "platform_admin_user": admin_user,
        "platform_admin_user_id": admin_user_id,
        "platform_admin_user_email": admin_user_email,
        "platform_admin_role": platform_admin_role,
        "platform_admin_role_id": platform_admin_role_id,
        "org_admin_role": org_admin_role,
        "org_admin_role_id": org_admin_role_id,
        "platform_perm": platform_perm,
        "collections_app": collections_app,
    }


def _make_bearer_token(user_id, email, org_id):
    """Generate a valid JWT access token for the platform admin."""
    from app.services.auth_utils import generate_access_token

    return generate_access_token(
        user_id=str(user_id),
        email=email,
        active_organization_id=str(org_id),
    )


def _cognito_initiate_auth_success(email, password):
    """Mock cognito_initiate_auth returning AuthSuccess with a fake id_token."""
    return AuthSuccess(
        type=AuthResultType.SUCCESS,
        tokens=Mock(
            id_token="fake-id-token",
            access_token="fake-access-token",
            refresh_token="fake-refresh-token",
        ),
    )


# ---------------------------------------------------------------------------
# PROMPT A: End-to-end happy-path flow test
# ---------------------------------------------------------------------------


class TestOnboardingHappyPath:
    """Full provision -> activate -> login -> /me flow."""

    @patch("app.services.provisioning_service.get_cognito_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.get_settings")
    @patch("app.fastapi_app.routers.auth.cognito_admin_set_user_password")
    @patch("app.fastapi_app.routers.auth.cognito_initiate_auth")
    @patch("app.fastapi_app.routers.auth.verify_cognito_id_token")
    @patch("app.fastapi_app.routers.auth.auth_limiter")
    def test_full_onboarding_flow(
        self,
        mock_rate_limiter,
        mock_verify_id_token,
        mock_cognito_auth,
        mock_cognito_set_pw,
        mock_prov_settings,
        mock_prov_email,
        mock_prov_cognito_create,
        mock_prov_cognito_svc,
        client,
        seed,
    ):
        """
        1) Platform admin provisions org
        2) Extract activation token from mocked email
        3) Activate account with token + password
        4) Login (mock Cognito auth)
        5) GET /me -- verify org, role, permissions
        """
        # ---- Configure mocks -----------------------------------------------

        # Rate limiter: always allow
        mock_rate_limiter.check_rate_limit.return_value = Mock(allowed=True)
        mock_rate_limiter.record_success = Mock()
        mock_rate_limiter.record_failure = Mock()

        # Provisioning: Cognito + email
        mock_prov_settings.return_value = Mock(
            frontend_base_url="https://app.madrona.test",
            app_base_url="https://app.madrona.test",
        )
        mock_prov_email_svc = MagicMock()
        mock_prov_email_svc.send_welcome_email.return_value = True
        mock_prov_email.return_value = mock_prov_email_svc

        mock_prov_cognito_svc_obj = MagicMock()
        mock_prov_cognito_svc_obj.user_pool_id = "test-pool"
        mock_prov_cognito_svc.return_value = mock_prov_cognito_svc_obj

        # Cognito set password (activation): succeed
        mock_cognito_set_pw.return_value = None

        # Login Cognito auth: succeed
        mock_cognito_auth.side_effect = _cognito_initiate_auth_success

        # ================================================================
        # STEP 1: Provision organization
        # ================================================================

        token = _make_bearer_token(
            seed["platform_admin_user_id"],
            seed["platform_admin_user_email"],
            seed["platform_org_id"],
        )

        provision_payload = {
            "organization": {"name": "Acme Museum", "slug": "acme-museum"},
            "applications": [{"key": "collections"}],
            "contract": {"start_date": "2026-03-01", "end_date": "2027-02-28"},
            "admin": {"email": "curator@acme.org", "name": "Alice Curator"},
            "onboarding": {"csm_name": "Alex", "csm_email": "alex@example.com"},
        }

        resp = client.post(
            "/api/platform/provision",
            json=provision_payload,
            headers={"Authorization": f"Bearer {token}"},
        )

        assert resp.status_code == 201, f"Provision failed: {resp.get_json()}"
        prov_data = resp.get_json()

        assert prov_data["organization_slug"] == "acme-museum"
        assert prov_data["welcome_email_sent"] is True
        assert "organization_id" in prov_data
        assert "admin_user_id" in prov_data
        assert "collections" in prov_data["enabled_applications"]

        provisioned_org_id = prov_data["organization_id"]
        provisioned_admin_id = prov_data["admin_user_id"]

        # ---- Verify DB state after provisioning ----------------------------

        org = current_session().query(Organization).filter_by(slug="acme-museum").first()
        assert org is not None
        assert str(org.organization_id) == provisioned_org_id

        admin_user = current_session().query(User).filter_by(email="curator@acme.org").first()
        assert admin_user is not None
        assert admin_user.status == "invited"
        assert str(admin_user.user_id) == provisioned_admin_id

        membership = (
            current_session().query(OrganizationMembership)
            .filter_by(user_id=admin_user.user_id, organization_id=org.organization_id)
            .first()
        )
        assert membership is not None
        assert membership.status == "active"

        invitation = (
            current_session().query(OrganizationInvitation)
            .filter_by(organization_id=org.organization_id, email="curator@acme.org")
            .first()
        )
        assert invitation is not None
        assert invitation.token_hash is not None
        # expires_at is timestamptz since the timestamptz migration, so it
        # comes back aware. Stripping tzinfo from the right-hand side made
        # this an aware-vs-naive comparison, which raises TypeError.
        assert invitation.expires_at > datetime.now(timezone.utc)
        assert invitation.used_at is None

        # Cognito user creation was called
        mock_prov_cognito_create.assert_called_once()

        # Welcome email was sent
        mock_prov_email_svc.send_welcome_email.assert_called_once()

        # ================================================================
        # STEP 2: Extract activation token from email mock
        # ================================================================

        email_call_kwargs = mock_prov_email_svc.send_welcome_email.call_args
        activation_url = email_call_kwargs.kwargs.get(
            "activation_url"
        ) or email_call_kwargs[1].get("activation_url")

        # URL format: https://app.madrona.test/activate?token=<TOKEN>
        assert activation_url is not None
        assert "token=" in activation_url
        raw_token = activation_url.split("token=")[1]

        # Verify this token matches the invitation hash
        expected_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        assert invitation.token_hash == expected_hash

        # ================================================================
        # STEP 3: Verify invitation (frontend preflight)
        # ================================================================

        resp = client.get(f"/api/invitations/{raw_token}/verify")
        assert resp.status_code == 200
        verify_data = resp.get_json()
        assert verify_data["valid"] is True
        assert verify_data["email"] == "curator@acme.org"
        assert verify_data["user_status"] == "invited"
        assert verify_data["organization_id"] == provisioned_org_id

        # ================================================================
        # STEP 4: Activate account
        # ================================================================

        resp = client.post(
            "/api/auth/activate",
            json={
                "token": raw_token,
                "password": "SecureP@ssword123",
                "name": "Alice Curator",
            },
        )

        assert resp.status_code == 200, f"Activation failed: {resp.get_json()}"
        activate_data = resp.get_json()
        assert activate_data["message"] == "Account activated successfully"
        assert activate_data["email"] == "curator@acme.org"
        assert activate_data["access_token"]
        assert activate_data["active_organization_id"] == provisioned_org_id

        # Cognito password was set
        mock_cognito_set_pw.assert_called_once_with(
            email="curator@acme.org",
            password="SecureP@ssword123",
            permanent=True,
        )

        # Verify DB: user is active, invitation is used
        current_session().refresh(admin_user)
        assert admin_user.status == "active"
        assert admin_user.password_hash is not None

        current_session().refresh(invitation)
        assert invitation.used_at is not None

        # ================================================================
        # STEP 5: Login
        # ================================================================

        # Mock verify_cognito_id_token to return claims matching our user
        mock_verify_id_token.return_value = {
            "sub": "cognito-sub-12345",
            "email": "curator@acme.org",
            "email_verified": True,
        }

        resp = client.post(
            "/api/auth/login",
            json={
                "email": "curator@acme.org",
                "password": "SecureP@ssword123",
            },
        )

        assert resp.status_code == 200, f"Login failed: {resp.get_json()}"
        login_data = resp.get_json()
        assert login_data["email"] == "curator@acme.org"
        assert login_data["active_organization_id"] == provisioned_org_id
        assert "access_token" in login_data

        # The response should have set a refresh_token cookie
        refresh_cookie = next(
            (h for h in resp.headers.get_list("Set-Cookie") if "refresh_token=" in h),
            None,
        )
        assert refresh_cookie is not None, "Login should set refresh_token cookie"

        # Verify cognito_sub was linked
        current_session().refresh(admin_user)
        assert admin_user.cognito_sub == "cognito-sub-12345"

        # ================================================================
        # STEP 6: GET /me -- verify org landing
        # ================================================================

        resp = client.get("/api/me")

        assert resp.status_code == 200, f"GET /me failed: {resp.get_json()}"
        me_data = resp.get_json()

        # User identity
        assert me_data["email"] == "curator@acme.org"
        assert me_data["user_id"] == provisioned_admin_id

        # Organization landed correctly
        assert me_data["active_organization_id"] == provisioned_org_id

        # User has org membership
        assert len(me_data["organizations"]) >= 1
        org_entry = next(
            (o for o in me_data["organizations"] if o["organization_id"] == provisioned_org_id),
            None,
        )
        assert org_entry is not None
        assert org_entry["name"] == "Acme Museum"
        assert org_entry["slug"] == "acme-museum"
        assert org_entry["role_key"] == "admin"

        # Applications visible
        app_keys = [a["key"] for a in me_data.get("applications", [])]
        assert "collections" in app_keys

        # Enabled flag on collections
        collections_app = next(
            (a for a in me_data["applications"] if a["key"] == "collections"),
            None,
        )
        assert collections_app is not None
        assert collections_app["enabled"] is True

        # Platform admin should be False for a regular org_admin
        assert me_data["is_platform_admin"] is False


class TestPlatformAdminGating:
    """Platform endpoints must remain @require_platform_admin gated."""

    def test_provision_requires_auth(self, client, seed):
        """POST /provision without auth -> 401."""
        resp = client.post(
            "/api/platform/provision",
            json={"organization": {"name": "X"}, "admin": {"email": "a@b.c", "name": "A"}},
        )
        assert resp.status_code == 401

    def test_provision_requires_platform_admin(self, client, db_session, seed):
        """POST /provision with a non-platform-admin user -> 403."""
        # Create a regular org_admin user (not platform admin)
        org = Organization(name="Reg Org", slug="reg-org", status="active")
        db_session.add(org)
        db_session.flush()

        regular_user = User(
            email="regular@example.com",
            display_name="Regular User",
            status="active",
        )
        db_session.add(regular_user)
        db_session.flush()

        mem = OrganizationMembership(
            organization_id=org.organization_id,
            user_id=regular_user.user_id,
            role="admin",
            role_id=seed["org_admin_role_id"],
            status="active",
        )
        db_session.add(mem)

        # Capture values before commit
        regular_user_id = regular_user.user_id
        regular_user_email = regular_user.email
        org_id = org.organization_id
        db_session.commit()

        token = _make_bearer_token(regular_user_id, regular_user_email, org_id)

        resp = client.post(
            "/api/platform/provision",
            json={"organization": {"name": "X"}, "admin": {"email": "a@b.c", "name": "A"}},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 403

    @patch("app.fastapi_app.routers.auth.auth_limiter")
    def test_job_list_requires_platform_admin(self, mock_limiter, client, seed):
        """GET /provision/jobs requires platform admin."""
        resp = client.get("/api/platform/provision/jobs")
        assert resp.status_code == 401

    @patch("app.fastapi_app.routers.auth.auth_limiter")
    def test_resend_requires_platform_admin(self, mock_limiter, client, seed):
        """POST /provision/<id>/resend-invite requires platform admin."""
        fake_id = str(uuid.uuid4())
        resp = client.post(f"/api/platform/provision/{fake_id}/resend-invite")
        assert resp.status_code == 401

    @patch("app.fastapi_app.routers.auth.auth_limiter")
    def test_reconcile_requires_platform_admin(self, mock_limiter, client, seed):
        """POST /provision/<id>/reconcile requires platform admin."""
        fake_id = str(uuid.uuid4())
        resp = client.post(f"/api/platform/provision/{fake_id}/reconcile")
        assert resp.status_code == 401


class TestActivationEdgeCases:
    """Activation endpoint edge cases as part of the onboarding flow."""

    @patch("app.services.provisioning_service.get_cognito_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.get_settings")
    def test_expired_token_returns_410_with_hint(
        self,
        mock_settings,
        mock_email,
        mock_cognito_create,
        mock_cognito_svc,
        client,
        seed,
    ):
        """Expired invitation returns 410 Gone with code + hint."""
        mock_settings.return_value = Mock(
            frontend_base_url="https://app.madrona.test",
            app_base_url="https://app.madrona.test",
        )
        mock_email.return_value = MagicMock(send_welcome_email=Mock(return_value=True))

        # Provision first
        token = _make_bearer_token(
            seed["platform_admin_user_id"],
            seed["platform_admin_user_email"],
            seed["platform_org_id"],
        )
        resp = client.post(
            "/api/platform/provision",
            json={
                "organization": {"name": "Expiry Test Org", "slug": "expiry-test"},
                "applications": [{"key": "collections"}],
                "admin": {"email": "expired@test.org", "name": "Expiring User"},
                "contract": {"start_date": "2026-01-01", "end_date": "2027-01-01"},
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 201

        # Manually expire the invitation
        inv = (
            current_session().query(OrganizationInvitation)
            .filter_by(email="expired@test.org")
            .first()
        )
        inv.expires_at = datetime.now(timezone.utc) - timedelta(days=1)
        current_session().commit()

        # Find the raw token from the email mock
        email_call = mock_email.return_value.send_welcome_email.call_args
        activation_url = email_call.kwargs.get("activation_url") or email_call[1].get("activation_url")
        raw_token = activation_url.split("token=")[1]

        # Attempt activation
        resp = client.post(
            "/api/auth/activate",
            json={"token": raw_token, "password": "SecurePass123"},
        )
        assert resp.status_code == 410
        data = resp.get_json()
        assert data["code"] == "INVITATION_EXPIRED"
        assert "hint" in data

    def test_double_activation_returns_409(self, client, db_session, seed):
        """Using an already-used invitation returns 409."""
        # Create an invitation that's already used
        org = Organization(name="Double Org", slug="double-org", status="active")
        db_session.add(org)
        db_session.flush()

        user = User(email="double@test.org", status="active")
        db_session.add(user)
        db_session.flush()

        raw_token = "double-test-token"
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        inv = OrganizationInvitation(
            organization_id=org.organization_id,
            user_id=user.user_id,
            email="double@test.org",
            token_hash=token_hash,
            role="admin",
            invited_by=seed["platform_admin_user_id"],
            expires_at=datetime.now(timezone.utc) + timedelta(days=7),
            used_at=datetime.now(timezone.utc),  # Already used
        )
        db_session.add(inv)
        db_session.commit()

        resp = client.post(
            "/api/auth/activate",
            json={"token": raw_token, "password": "SecurePass123"},
        )
        assert resp.status_code == 409
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "already been used" in (_e.get("message", "") if isinstance(_e, dict) else str(_e))


class TestIdempotentProvision:
    """Provisioning the same org twice should be idempotent."""

    @patch("app.services.provisioning_service.get_cognito_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.get_settings")
    def test_same_provision_twice_returns_200(
        self,
        mock_settings,
        mock_email,
        mock_cognito_create,
        mock_cognito_svc,
        client,
        seed,
    ):
        """Second provision with same payload returns 200 (not 201)."""
        mock_settings.return_value = Mock(
            frontend_base_url="https://app.madrona.test",
            app_base_url="https://app.madrona.test",
        )
        mock_email.return_value = MagicMock(send_welcome_email=Mock(return_value=True))

        token = _make_bearer_token(
            seed["platform_admin_user_id"],
            seed["platform_admin_user_email"],
            seed["platform_org_id"],
        )
        payload = {
            "organization": {"name": "Idem Museum", "slug": "idem-museum"},
            "applications": [{"key": "collections"}],
            "admin": {"email": "idem@test.org", "name": "Idem Admin"},
            "contract": {"start_date": "2026-01-01", "end_date": "2027-01-01"},
        }

        resp1 = client.post(
            "/api/platform/provision",
            json=payload,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp1.status_code == 201

        # Second call -- should return 200 (idempotent hit)
        resp2 = client.post(
            "/api/platform/provision",
            json=payload,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp2.status_code == 200
        assert resp2.get_json()["job_id"] == resp1.get_json()["job_id"]


# ---------------------------------------------------------------------------
# Common mock decorator stack for provisioning + resend/reconcile tests
# ---------------------------------------------------------------------------

_PROVISION_PATCHES = [
    "app.services.provisioning_service.get_cognito_service",
    "app.services.provisioning_service.cognito_admin_create_user",
    "app.services.provisioning_service.get_email_service",
    "app.services.provisioning_service.get_settings",
]


def _setup_provision_mocks(mock_settings, mock_email, mock_cognito_create, mock_cognito_svc):
    """Configure the standard provisioning mock stack. Returns email mock."""
    mock_settings.return_value = Mock(
        frontend_base_url="https://app.madrona.test",
        app_base_url="https://app.madrona.test",
    )
    email_svc = MagicMock()
    email_svc.send_welcome_email.return_value = True
    email_svc.send_email.return_value = True
    mock_email.return_value = email_svc

    cognito_svc = MagicMock()
    cognito_svc.user_pool_id = "test-pool"
    cognito_svc.client.admin_get_user.return_value = {
        "Username": "user",
        "UserStatus": "CONFIRMED",
        "UserAttributes": [
            {"Name": "email_verified", "Value": "true"},
        ],
    }
    mock_cognito_svc.return_value = cognito_svc

    return email_svc


def _provision_org(client, seed, slug, admin_email, admin_name="Admin User"):
    """Helper: provisions an org and returns (response_json, bearer_token)."""
    bearer = _make_bearer_token(
        seed["platform_admin_user_id"],
        seed["platform_admin_user_email"],
        seed["platform_org_id"],
    )
    resp = client.post(
        "/api/platform/provision",
        json={
            "organization": {"name": slug.replace("-", " ").title(), "slug": slug},
            "applications": [{"key": "collections"}],
            # provisioning_service.compute_request_fingerprint expects a dict
            # here — omitting "contract" makes the service crash on
            # `contract.get(...)` of NoneType. The happy-path payload always
            # includes one.
            "contract": {"start_date": "2026-01-01", "end_date": "2027-01-01"},
            "admin": {"email": admin_email, "name": admin_name},
        },
        headers={"Authorization": f"Bearer {bearer}"},
    )
    assert resp.status_code == 201, f"Provision failed: {resp.get_json()}"
    return resp.get_json(), bearer


def _extract_token_from_email(email_svc):
    """Pull the raw activation token from the mocked send_welcome_email call."""
    call = email_svc.send_welcome_email.call_args
    url = call.kwargs.get("activation_url") or call[1].get("activation_url")
    assert url and "token=" in url, f"No activation URL in email call: {call}"
    return url.split("token=")[-1]


# ---------------------------------------------------------------------------
# Resend Invite E2E Tests
# ---------------------------------------------------------------------------


class TestResendInviteE2E:
    """End-to-end tests for the resend invite flow."""

    @patch(_PROVISION_PATCHES[0])
    @patch(_PROVISION_PATCHES[1])
    @patch(_PROVISION_PATCHES[2])
    @patch(_PROVISION_PATCHES[3])
    @patch("app.fastapi_app.routers.auth.cognito_admin_set_user_password")
    @patch("app.fastapi_app.routers.auth.cognito_initiate_auth")
    @patch("app.fastapi_app.routers.auth.verify_cognito_id_token")
    @patch("app.fastapi_app.routers.auth.auth_limiter")
    def test_resend_then_activate_then_login(
        self,
        mock_rate_limiter,
        mock_verify_id_token,
        mock_cognito_auth,
        mock_cognito_set_pw,
        mock_settings,
        mock_email,
        mock_cognito_create,
        mock_cognito_svc,
        client,
        seed,
    ):
        """
        Provision -> resend invite -> activate with NEW token -> login -> /me.

        Proves the resent token is the one that works (not the original).
        """
        email_svc = _setup_provision_mocks(
            mock_settings, mock_email, mock_cognito_create, mock_cognito_svc,
        )
        mock_rate_limiter.check_rate_limit.return_value = Mock(allowed=True)
        mock_rate_limiter.record_success = Mock()
        mock_cognito_set_pw.return_value = None
        mock_cognito_auth.side_effect = _cognito_initiate_auth_success
        mock_verify_id_token.return_value = {
            "sub": "cognito-resend-001",
            "email": "resend-user@acme.org",
        }

        # Step 1: Provision
        prov_data, bearer = _provision_org(
            client, seed, "resend-org", "resend-user@acme.org", "Resend User",
        )
        job_id = prov_data["job_id"]
        original_token = _extract_token_from_email(email_svc)

        # Step 2: Resend invite
        email_svc.send_welcome_email.reset_mock()
        resp = client.post(
            f"/api/platform/provision/{job_id}/resend-invite?force=true",
            headers={"Authorization": f"Bearer {bearer}"},
        )
        assert resp.status_code == 200, f"Resend failed: {resp.get_json()}"
        resend_data = resp.get_json()
        assert resend_data["message"] == "Invitation resent successfully"
        assert "invitation_id" in resend_data
        assert resend_data["email"] == "resend-user@acme.org"

        new_token = _extract_token_from_email(email_svc)
        # Token was rotated
        assert new_token != original_token

        # Step 3: Original token should no longer verify (hash was replaced)
        resp = client.get(f"/api/invitations/{original_token}/verify")
        assert resp.status_code == 404, "Old token should be invalid after rotation"

        # New token verifies
        resp = client.get(f"/api/invitations/{new_token}/verify")
        assert resp.status_code == 200
        assert resp.get_json()["valid"] is True

        # Step 4: Activate with new token
        resp = client.post(
            "/api/auth/activate",
            json={"token": new_token, "password": "ResendP@ss123"},
        )
        assert resp.status_code == 200, f"Activation failed: {resp.get_json()}"
        assert resp.get_json()["email"] == "resend-user@acme.org"

        # Step 5: Login
        resp = client.post(
            "/api/auth/login",
            json={"email": "resend-user@acme.org", "password": "ResendP@ss123"},
        )
        assert resp.status_code == 200
        assert resp.get_json()["active_organization_id"] == prov_data["organization_id"]

        # Step 6: GET /me
        resp = client.get("/api/me")
        assert resp.status_code == 200
        me = resp.get_json()
        assert me["active_organization_id"] == prov_data["organization_id"]
        assert me["email"] == "resend-user@acme.org"

    @patch(_PROVISION_PATCHES[0])
    @patch(_PROVISION_PATCHES[1])
    @patch(_PROVISION_PATCHES[2])
    @patch(_PROVISION_PATCHES[3])
    def test_resend_rate_limited_then_force(
        self,
        mock_settings,
        mock_email,
        mock_cognito_create,
        mock_cognito_svc,
        client,
        seed,
    ):
        """Resend within 10 min -> dedupe_skipped. With ?force=true -> sent."""
        email_svc = _setup_provision_mocks(
            mock_settings, mock_email, mock_cognito_create, mock_cognito_svc,
        )

        prov_data, bearer = _provision_org(
            client, seed, "rate-org", "rate@test.org", "Rate User",
        )
        job_id = prov_data["job_id"]

        # First resend (with force to bypass initial 10-min from provisioning)
        resp = client.post(
            f"/api/platform/provision/{job_id}/resend-invite?force=true",
            headers={"Authorization": f"Bearer {bearer}"},
        )
        assert resp.status_code == 200
        assert resp.get_json()["message"] == "Invitation resent successfully"

        # Second resend WITHOUT force -- should be rate-limited
        resp = client.post(
            f"/api/platform/provision/{job_id}/resend-invite",
            headers={"Authorization": f"Bearer {bearer}"},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data.get("dedupe_skipped") is True
        assert "10 min" in data["message"]

        # Third resend WITH force -- bypasses rate limit
        email_svc.send_welcome_email.reset_mock()
        resp = client.post(
            f"/api/platform/provision/{job_id}/resend-invite?force=true",
            headers={"Authorization": f"Bearer {bearer}"},
        )
        assert resp.status_code == 200
        assert resp.get_json()["message"] == "Invitation resent successfully"
        email_svc.send_welcome_email.assert_called_once()

    @patch(_PROVISION_PATCHES[0])
    @patch(_PROVISION_PATCHES[1])
    @patch(_PROVISION_PATCHES[2])
    @patch(_PROVISION_PATCHES[3])
    def test_resend_after_expiry_creates_new_invite(
        self,
        mock_settings,
        mock_email,
        mock_cognito_create,
        mock_cognito_svc,
        client,
        seed,
    ):
        """Resend after invitation expired creates a new invitation record."""
        email_svc = _setup_provision_mocks(
            mock_settings, mock_email, mock_cognito_create, mock_cognito_svc,
        )

        prov_data, bearer = _provision_org(
            client, seed, "expiry-resend-org", "expiry-resend@test.org",
        )
        job_id = prov_data["job_id"]

        # Expire the invitation
        inv = current_session().query(OrganizationInvitation).filter_by(
            email="expiry-resend@test.org",
        ).first()
        original_inv_id = str(inv.invitation_id)
        inv.expires_at = datetime.now(timezone.utc) - timedelta(days=1)
        current_session().commit()

        # Resend -- should create a new invitation record
        resp = client.post(
            f"/api/platform/provision/{job_id}/resend-invite?force=true",
            headers={"Authorization": f"Bearer {bearer}"},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["message"] == "Invitation resent successfully"
        assert data["reused_token"] is False  # New record, not reused
        # New invitation has a different ID
        assert data["invitation_id"] != original_inv_id

    @patch(_PROVISION_PATCHES[0])
    @patch(_PROVISION_PATCHES[1])
    @patch(_PROVISION_PATCHES[2])
    @patch(_PROVISION_PATCHES[3])
    @patch("app.fastapi_app.routers.auth.cognito_admin_set_user_password")
    def test_resend_already_active_user(
        self,
        mock_cognito_set_pw,
        mock_settings,
        mock_email,
        mock_cognito_create,
        mock_cognito_svc,
        client,
        seed,
    ):
        """Resend for an already-activated user returns already_active."""
        email_svc = _setup_provision_mocks(
            mock_settings, mock_email, mock_cognito_create, mock_cognito_svc,
        )
        mock_cognito_set_pw.return_value = None

        prov_data, bearer = _provision_org(
            client, seed, "active-resend-org", "active-resend@test.org",
        )
        job_id = prov_data["job_id"]
        raw_token = _extract_token_from_email(email_svc)

        # Activate
        resp = client.post(
            "/api/auth/activate",
            json={"token": raw_token, "password": "ActivateP@ss1"},
        )
        assert resp.status_code == 200

        # Try resend -- should say already active
        resp = client.post(
            f"/api/platform/provision/{job_id}/resend-invite?force=true",
            headers={"Authorization": f"Bearer {bearer}"},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data.get("already_active") is True
        assert "already active" in data["message"].lower()

    @patch(_PROVISION_PATCHES[0])
    @patch(_PROVISION_PATCHES[1])
    @patch(_PROVISION_PATCHES[2])
    @patch(_PROVISION_PATCHES[3])
    def test_resend_nonexistent_job_returns_404(
        self,
        mock_settings,
        mock_email,
        mock_cognito_create,
        mock_cognito_svc,
        client,
        seed,
    ):
        """Resend for unknown job_id returns 404."""
        bearer = _make_bearer_token(
            seed["platform_admin_user_id"],
            seed["platform_admin_user_email"],
            seed["platform_org_id"],
        )
        fake_id = str(uuid.uuid4())
        resp = client.post(
            f"/api/platform/provision/{fake_id}/resend-invite",
            headers={"Authorization": f"Bearer {bearer}"},
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Reconcile E2E Tests
# ---------------------------------------------------------------------------


class TestReconcileE2E:
    """End-to-end tests for the reconcile flow."""

    @patch(_PROVISION_PATCHES[0])
    @patch(_PROVISION_PATCHES[1])
    @patch(_PROVISION_PATCHES[2])
    @patch(_PROVISION_PATCHES[3])
    @patch("app.fastapi_app.routers.auth.cognito_admin_set_user_password")
    @patch("app.fastapi_app.routers.auth.cognito_initiate_auth")
    @patch("app.fastapi_app.routers.auth.verify_cognito_id_token")
    @patch("app.fastapi_app.routers.auth.auth_limiter")
    def test_reconcile_then_activate_then_login(
        self,
        mock_rate_limiter,
        mock_verify_id_token,
        mock_cognito_auth,
        mock_cognito_set_pw,
        mock_settings,
        mock_email,
        mock_cognito_create,
        mock_cognito_svc,
        client,
        seed,
    ):
        """
        Provision -> delete invitation -> reconcile -> activate with reconciled token -> login.

        Proves reconcile creates a working invitation without sending email.
        """
        email_svc = _setup_provision_mocks(
            mock_settings, mock_email, mock_cognito_create, mock_cognito_svc,
        )
        mock_rate_limiter.check_rate_limit.return_value = Mock(allowed=True)
        mock_rate_limiter.record_success = Mock()
        mock_cognito_set_pw.return_value = None
        mock_cognito_auth.side_effect = _cognito_initiate_auth_success
        mock_verify_id_token.return_value = {
            "sub": "cognito-recon-001",
            "email": "recon-user@acme.org",
        }

        # Step 1: Provision
        prov_data, bearer = _provision_org(
            client, seed, "recon-org", "recon-user@acme.org", "Recon User",
        )
        job_id = prov_data["job_id"]

        # Step 2: Delete the invitation (simulate partial state)
        inv = current_session().query(OrganizationInvitation).filter_by(
            email="recon-user@acme.org",
        ).first()
        assert inv is not None
        current_session().delete(inv)
        current_session().commit()

        # Verify it's gone
        inv_check = current_session().query(OrganizationInvitation).filter_by(
            email="recon-user@acme.org",
        ).first()
        assert inv_check is None

        # Step 3: Reconcile -- should create new invitation (no email sent)
        email_svc.send_welcome_email.reset_mock()
        resp = client.post(
            f"/api/platform/provision/{job_id}/reconcile",
            headers={"Authorization": f"Bearer {bearer}"},
        )
        assert resp.status_code == 200, f"Reconcile failed: {resp.get_json()}"
        recon_data = resp.get_json()
        assert recon_data["message"] == "Reconciliation complete"
        assert recon_data["cognito_user"] == "ensured"
        assert recon_data["invitation"] == "ensured"
        assert "created_invitation" in recon_data["actions"]

        # Reconcile does NOT send email
        email_svc.send_welcome_email.assert_not_called()

        # Step 4: Now resend to get a usable token (reconcile doesn't expose tokens)
        email_svc.send_welcome_email.reset_mock()
        resp = client.post(
            f"/api/platform/provision/{job_id}/resend-invite?force=true",
            headers={"Authorization": f"Bearer {bearer}"},
        )
        assert resp.status_code == 200
        new_token = _extract_token_from_email(email_svc)

        # Step 5: Activate with the token
        resp = client.post(
            "/api/auth/activate",
            json={"token": new_token, "password": "ReconP@ss123"},
        )
        assert resp.status_code == 200
        assert resp.get_json()["email"] == "recon-user@acme.org"

        # Step 6: Login
        resp = client.post(
            "/api/auth/login",
            json={"email": "recon-user@acme.org", "password": "ReconP@ss123"},
        )
        assert resp.status_code == 200
        assert resp.get_json()["active_organization_id"] == prov_data["organization_id"]

        # Step 7: GET /me
        resp = client.get("/api/me")
        assert resp.status_code == 200
        me = resp.get_json()
        assert me["active_organization_id"] == prov_data["organization_id"]
        assert me["email"] == "recon-user@acme.org"

    @patch(_PROVISION_PATCHES[0])
    @patch(_PROVISION_PATCHES[1])
    @patch(_PROVISION_PATCHES[2])
    @patch(_PROVISION_PATCHES[3])
    def test_reconcile_creates_missing_cognito_user(
        self,
        mock_settings,
        mock_email,
        mock_cognito_create,
        mock_cognito_svc,
        client,
        seed,
    ):
        """Reconcile creates Cognito user if missing (UserNotFoundException)."""
        email_svc = _setup_provision_mocks(
            mock_settings, mock_email, mock_cognito_create, mock_cognito_svc,
        )

        prov_data, bearer = _provision_org(
            client, seed, "cognito-miss-org", "cognito-miss@test.org",
        )
        job_id = prov_data["job_id"]

        # Make Cognito report user NOT found on reconcile
        from botocore.exceptions import ClientError
        cognito_svc = mock_cognito_svc.return_value
        cognito_svc.client.admin_get_user.side_effect = ClientError(
            {"Error": {"Code": "UserNotFoundException", "Message": "Not found"}},
            "AdminGetUser",
        )

        resp = client.post(
            f"/api/platform/provision/{job_id}/reconcile",
            headers={"Authorization": f"Bearer {bearer}"},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["cognito_user"] == "ensured"
        assert "created_cognito_user" in data["actions"]

        # Cognito create was called during reconcile
        mock_cognito_create.assert_called()

    @patch(_PROVISION_PATCHES[0])
    @patch(_PROVISION_PATCHES[1])
    @patch(_PROVISION_PATCHES[2])
    @patch(_PROVISION_PATCHES[3])
    def test_reconcile_idempotent_no_actions(
        self,
        mock_settings,
        mock_email,
        mock_cognito_create,
        mock_cognito_svc,
        client,
        seed,
    ):
        """Reconcile on a fully provisioned job takes no actions."""
        email_svc = _setup_provision_mocks(
            mock_settings, mock_email, mock_cognito_create, mock_cognito_svc,
        )

        prov_data, bearer = _provision_org(
            client, seed, "idem-recon-org", "idem-recon@test.org",
        )
        job_id = prov_data["job_id"]

        resp = client.post(
            f"/api/platform/provision/{job_id}/reconcile",
            headers={"Authorization": f"Bearer {bearer}"},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["actions"] == []
        assert data["cognito_user"] == "ensured"
        assert data["invitation"] == "ensured"

    @patch(_PROVISION_PATCHES[0])
    @patch(_PROVISION_PATCHES[1])
    @patch(_PROVISION_PATCHES[2])
    @patch(_PROVISION_PATCHES[3])
    def test_reconcile_ensures_membership(
        self,
        mock_settings,
        mock_email,
        mock_cognito_create,
        mock_cognito_svc,
        client,
        seed,
    ):
        """Reconcile creates missing membership."""
        email_svc = _setup_provision_mocks(
            mock_settings, mock_email, mock_cognito_create, mock_cognito_svc,
        )

        prov_data, bearer = _provision_org(
            client, seed, "mem-miss-org", "mem-miss@test.org",
        )
        job_id = prov_data["job_id"]

        # Delete the membership
        user = current_session().query(User).filter_by(email="mem-miss@test.org").first()
        mem = current_session().query(OrganizationMembership).filter_by(
            user_id=user.user_id,
        ).first()
        current_session().delete(mem)
        current_session().commit()

        resp = client.post(
            f"/api/platform/provision/{job_id}/reconcile",
            headers={"Authorization": f"Bearer {bearer}"},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert "created_membership" in data["actions"]

        # Membership now exists
        mem = current_session().query(OrganizationMembership).filter_by(
            user_id=user.user_id,
            organization_id=uuid.UUID(prov_data["organization_id"]),
        ).first()
        assert mem is not None
        assert mem.status == "active"

    @patch(_PROVISION_PATCHES[0])
    @patch(_PROVISION_PATCHES[1])
    @patch(_PROVISION_PATCHES[2])
    @patch(_PROVISION_PATCHES[3])
    def test_reconcile_nonexistent_job_returns_404(
        self,
        mock_settings,
        mock_email,
        mock_cognito_create,
        mock_cognito_svc,
        client,
        seed,
    ):
        """Reconcile for unknown job_id returns 404."""
        bearer = _make_bearer_token(
            seed["platform_admin_user_id"],
            seed["platform_admin_user_email"],
            seed["platform_org_id"],
        )
        fake_id = str(uuid.uuid4())
        resp = client.post(
            f"/api/platform/provision/{fake_id}/reconcile",
            headers={"Authorization": f"Bearer {bearer}"},
        )
        assert resp.status_code == 404

    @patch(_PROVISION_PATCHES[0])
    @patch(_PROVISION_PATCHES[1])
    @patch(_PROVISION_PATCHES[2])
    @patch(_PROVISION_PATCHES[3])
    def test_reconcile_does_not_send_email(
        self,
        mock_settings,
        mock_email,
        mock_cognito_create,
        mock_cognito_svc,
        client,
        seed,
    ):
        """Reconcile NEVER sends email -- that is resend's job."""
        email_svc = _setup_provision_mocks(
            mock_settings, mock_email, mock_cognito_create, mock_cognito_svc,
        )

        prov_data, bearer = _provision_org(
            client, seed, "no-email-org", "no-email@test.org",
        )
        job_id = prov_data["job_id"]

        # Delete invitation to force reconcile to create one
        inv = current_session().query(OrganizationInvitation).filter_by(
            email="no-email@test.org",
        ).first()
        current_session().delete(inv)
        current_session().commit()

        email_svc.send_welcome_email.reset_mock()
        email_svc.send_email.reset_mock()

        resp = client.post(
            f"/api/platform/provision/{job_id}/reconcile",
            headers={"Authorization": f"Bearer {bearer}"},
        )
        assert resp.status_code == 200
        assert "created_invitation" in resp.get_json()["actions"]

        # No email was sent
        email_svc.send_welcome_email.assert_not_called()
        email_svc.send_email.assert_not_called()
