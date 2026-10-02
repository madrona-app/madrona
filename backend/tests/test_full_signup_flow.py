"""
Full-flow integration test: provision → activate → first login → MFA
setup → sign back in → /me.

Designed to catch the customer-flow seam bugs that unit-level tests
miss. Runs under strict RLS via the rls_client fixture so any
RLS-bootstrap regression in any of the touched endpoints surfaces
the same way it would in production.

In May 2026 three production 500s shipped on staging because no
test walked this full path:
  * login_mfa audit-log INSERT failed RLS (pre-fix 8e65e713)
  * login (non-MFA) audit-log INSERT failed RLS (same root cause)
  * activate_account compared a naive expires_at against tz-aware now

This test is the CI gate that would have caught all three.
"""
from __future__ import annotations

import re
from unittest.mock import MagicMock, patch
from uuid import uuid4
from datetime import datetime, timezone, timedelta

import pytest
from sqlalchemy import text


# ---------------------------------------------------------------------------
# AWS mocks — Cognito + SES at the boundary
# ---------------------------------------------------------------------------


@pytest.fixture
def aws_mocks(monkeypatch):
    """Patch every AWS boundary the auth flow touches.

    Returns a recorder dict so tests can assert on side effects.
    """
    rec = {
        "cognito_create_user": [],
        "cognito_set_password": [],
        "cognito_set_mfa_pref": [],
        "ses_send_email": [],
    }
    # Per-test in-memory user pool. Keyed by lowercase email.
    cognito_users: dict[str, dict] = {}

    # ---- Cognito module-level helpers ----
    def fake_admin_create_user(email, temporary_password, suppress_welcome=False):
        rec["cognito_create_user"].append({
            "email": email,
            "temporary_password": temporary_password,
        })
        cognito_users[email.lower()] = {
            "email": email.lower(),
            "password": temporary_password,
            "status": "FORCE_CHANGE_PASSWORD",
            "mfa": [],
            "preferred_mfa": None,
            "totp_secret": None,
        }
        return {"Username": email.lower(), "UserStatus": "FORCE_CHANGE_PASSWORD"}

    def fake_admin_set_user_password(email, password, permanent=True):
        rec["cognito_set_password"].append({"email": email, "permanent": permanent})
        u = cognito_users.setdefault(
            email.lower(),
            {"email": email.lower(), "mfa": [], "preferred_mfa": None, "totp_secret": None},
        )
        u["password"] = password
        u["status"] = "CONFIRMED" if permanent else "FORCE_CHANGE_PASSWORD"

    def fake_admin_set_user_mfa_preference(email, **kwargs):
        rec["cognito_set_mfa_pref"].append({"email": email, **kwargs})
        u = cognito_users.setdefault(email.lower(), {})
        if kwargs.get("totp_enabled") is True and "SOFTWARE_TOKEN_MFA" not in u.get("mfa", []):
            u.setdefault("mfa", []).append("SOFTWARE_TOKEN_MFA")
        if kwargs.get("preferred") == "SOFTWARE_TOKEN_MFA":
            u["preferred_mfa"] = "SOFTWARE_TOKEN_MFA"

    monkeypatch.setattr(
        "app.services.cognito.cognito_admin_create_user", fake_admin_create_user
    )
    monkeypatch.setattr(
        "app.services.provisioning_service.cognito_admin_create_user",
        fake_admin_create_user,
    )
    monkeypatch.setattr(
        "app.services.cognito.cognito_admin_set_user_password",
        fake_admin_set_user_password,
    )
    # auth.py imports cognito_admin_set_user_password at module load
    # time, so patching the source isn't enough — bind the test fake
    # onto the auth router too.
    monkeypatch.setattr(
        "app.fastapi_app.routers.auth.cognito_admin_set_user_password",
        fake_admin_set_user_password,
    )

    # ---- Cognito instance-level operations (auth flow) ----
    cognito_svc_mock = MagicMock()

    def fake_initiate_auth(username, password):
        u = cognito_users.get(username.lower())
        if not u or u.get("password") != password:
            from app.services.cognito import InvalidCredentialsError
            raise InvalidCredentialsError("Bad credentials", code="NotAuthorizedException")
        from app.services.cognito import AuthSuccess, AuthChallenge, AuthResultType, AuthTokens
        if "SOFTWARE_TOKEN_MFA" in u.get("mfa", []):
            return AuthChallenge(
                type=AuthResultType.MFA_REQUIRED,
                session="mock-mfa-session-" + uuid4().hex[:8],
                challenge_name="SOFTWARE_TOKEN_MFA",
                challenge_parameters={"USER_ID_FOR_SRP": u["email"]},
            )
        return AuthSuccess(
            tokens=AuthTokens(
                id_token="mock-id-token",
                access_token=f"mock-access-{u['email']}",
                refresh_token="mock-refresh",
                expires_in=3600,
            ),
        )

    def fake_respond_to_auth_challenge(session, challenge_name, challenge_responses, username):
        from app.services.cognito import AuthSuccess, AuthTokens
        # Accept any 6-digit code as valid TOTP for the mock; real
        # verification is Cognito's job.
        return AuthSuccess(
            tokens=AuthTokens(
                id_token="mock-id-token",
                access_token=f"mock-access-{username.lower()}",
                refresh_token="mock-refresh",
                expires_in=3600,
            ),
        )

    def fake_get_user_mfa_status(email):
        u = cognito_users.get(email.lower(), {})
        return {
            "mfa_enabled": bool(u.get("mfa")),
            "totp_enabled": "SOFTWARE_TOKEN_MFA" in u.get("mfa", []),
            "sms_enabled": "SMS_MFA" in u.get("mfa", []),
            "email_enabled": "EMAIL_OTP" in u.get("mfa", []),
            "preferred_mfa": u.get("preferred_mfa"),
        }

    def fake_cognito_get_user(access_token):
        # Token shape: mock-access-{email}
        email = access_token.removeprefix("mock-access-")
        return {"email": email, "sub": f"cognito-{email}"}

    def fake_associate_software_token(access_token=None, session=None):
        secret = f"MOCK-TOTP-SECRET-{uuid4().hex[:6]}"
        email = (access_token or "").removeprefix("mock-access-")
        if email and email in cognito_users:
            cognito_users[email]["totp_secret"] = secret
        return {"secret_code": secret}

    def fake_verify_software_token(user_code, access_token=None, session=None, friendly_device_name=None):
        # 6 digits = success for the mock
        if not user_code or not user_code.isdigit() or len(user_code) != 6:
            from app.services.cognito import CognitoAuthError
            raise CognitoAuthError("Bad code", code="InvalidMFACode")
        email = (access_token or "").removeprefix("mock-access-")
        if email and email in cognito_users:
            if "SOFTWARE_TOKEN_MFA" not in cognito_users[email].get("mfa", []):
                cognito_users[email].setdefault("mfa", []).append("SOFTWARE_TOKEN_MFA")
        return {"status": "SUCCESS"}

    def fake_set_user_mfa_preference(access_token, totp_enabled=False, sms_enabled=False, email_enabled=False, preferred=None):
        email = (access_token or "").removeprefix("mock-access-")
        if email and email in cognito_users:
            if totp_enabled:
                cognito_users[email]["preferred_mfa"] = preferred or "SOFTWARE_TOKEN_MFA"

    # auth.py imports these at module load. Patching the source
    # module isn't enough — bind the test fakes onto the router too.
    _cognito_patches = {
        "cognito_initiate_auth": fake_initiate_auth,
        "cognito_respond_to_auth_challenge": fake_respond_to_auth_challenge,
        "cognito_get_user_mfa_status": fake_get_user_mfa_status,
        "cognito_get_user": fake_cognito_get_user,
        "cognito_associate_software_token": fake_associate_software_token,
        "cognito_verify_software_token": fake_verify_software_token,
        "cognito_set_user_mfa_preference": fake_set_user_mfa_preference,
    }
    for name, fake in _cognito_patches.items():
        monkeypatch.setattr(f"app.services.cognito.{name}", fake)
        monkeypatch.setattr(f"app.fastapi_app.routers.auth.{name}", fake)

    # Bypass JWT signature verification — accept the mocked id_token blindly.
    def fake_verify_cognito_id_token(id_token):
        # The fake initiate_auth/respond_to_auth_challenge always sets
        # id_token="mock-id-token". We need to surface the email some
        # other way; use a sentinel.
        # The signing-in code in /api/auth/login reads email from the
        # claim, so embed it via a side-channel: most-recent caller wins.
        return _verify_id_token_state["claims"]

    _verify_id_token_state: dict = {"claims": {}}

    monkeypatch.setattr(
        "app.services.jwt_verify.verify_cognito_id_token", fake_verify_cognito_id_token
    )
    monkeypatch.setattr(
        "app.fastapi_app.routers.auth.verify_cognito_id_token",
        fake_verify_cognito_id_token,
    )

    rec["_id_token_state"] = _verify_id_token_state
    rec["_cognito_users"] = cognito_users

    # ---- SES ----
    fake_ses_client = MagicMock()

    def fake_send_email(**params):
        rec["ses_send_email"].append(params)
        return {"MessageId": f"mock-{uuid4().hex[:8]}"}

    fake_ses_client.send_email.side_effect = fake_send_email
    from app.services import email_service as email_mod
    email_mod._email_service = None
    monkeypatch.setattr(
        email_mod.EmailService,
        "client",
        property(lambda self: fake_ses_client),
    )
    monkeypatch.setattr(
        "app.services.email_event_service.check_email_deliverable",
        lambda email: True,
    )

    yield rec
    email_mod._email_service = None


# ---------------------------------------------------------------------------
# DB seed: org + admin User + Invitation (the state right after the
# provisioning saga's create_admin_user step)
# ---------------------------------------------------------------------------


def _seed_provisioned_state(rls_db_session, admin_email: str) -> dict:
    """Seed the post-provisioning state: org, role, admin User, and
    invitation token. Sets RLS context to the org for the seed phase
    so each INSERT satisfies the strict policies."""
    import hashlib
    import secrets as _secrets
    from app.models import (
        Application,
        Organization,
        OrganizationApplication,
        OrganizationInvitation,
        OrganizationMembership,
        Role,
        User,
    )

    org_id = uuid4()
    rls_db_session.execute(
        text("SELECT set_config('app.current_org_id', :v, true)"),
        {"v": str(org_id)},
    )

    org = Organization(
        organization_id=org_id,
        name="Full Flow Test Org",
        slug=f"full-flow-{uuid4().hex[:6]}",
        status="active",
    )
    rls_db_session.add(org)

    # Use org-scoped role so the INSERT passes strict RLS. Production
    # uses a system role here; for the test the org-scoped one is
    # equivalent for auth-flow purposes.
    admin_role = Role(
        role_key="admin",
        display_name="Admin",
        is_system=False,
        organization_id=org_id,
    )
    rls_db_session.add(admin_role)
    rls_db_session.flush()

    # Admin user is in 'invited' status until they activate via the
    # welcome-email link.
    user = User(
        email=admin_email,
        password_hash="not_set_yet",
        status="invited",
    )
    rls_db_session.add(user)
    rls_db_session.flush()

    membership = OrganizationMembership(
        organization_id=org_id,
        user_id=user.user_id,
        role="admin",
        role_id=admin_role.role_id,
        status="active",
    )
    rls_db_session.add(membership)

    # At least one app enabled — frontends key the dashboard off
    # `applications` and an empty list looks "broken" in /me responses.
    app_row = Application(
        key="collections",
        display_name="Collections",
        description="Test app",
        icon="Database",
        status="active",
    )
    rls_db_session.add(app_row)
    rls_db_session.flush()
    org_app = OrganizationApplication(
        organization_id=org_id,
        application_id=app_row.application_id,
        enabled=True,
        enabled_by=user.user_id,
    )
    rls_db_session.add(org_app)

    # Invitation with plaintext token (the value emailed in the
    # welcome message; only the hash lives in the DB).
    plaintext_token = _secrets.token_urlsafe(32)
    invitation = OrganizationInvitation(
        organization_id=org_id,
        user_id=user.user_id,
        email=admin_email,
        token_hash=hashlib.sha256(plaintext_token.encode()).hexdigest(),
        role="admin",
        invited_by=user.user_id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
    )
    rls_db_session.add(invitation)
    rls_db_session.commit()

    # Clear the org GUC so the rest of the test (which runs through
    # rls_client) starts from production-style "no org context yet".
    rls_db_session.execute(
        text("SELECT set_config('app.current_org_id', '', true)")
    )

    return {
        "org_id": str(org_id),
        "user_id": str(user.user_id),
        "email": admin_email,
        "invitation_token": plaintext_token,
    }


# ---------------------------------------------------------------------------
# The full flow
# ---------------------------------------------------------------------------


class TestFullSignupFlow:
    """End-to-end customer journey from welcome-email click to /me.

    Each step is asserted on its own so a regression at any seam points
    cleanly at the broken step. The test runs under rls_client (strict
    RLS for get_db endpoints; BYPASSRLS for get_admin_db endpoints —
    matching production semantics).
    """

    def test_activate_login_setup_mfa_signin_me(
        self,
        rls_db_session,
        rls_client,
        aws_mocks,
    ):
        admin_email = f"e2e-{uuid4().hex[:6]}@madrona.test"
        seed = _seed_provisioned_state(rls_db_session, admin_email)

        # Cognito side: pretend admin_create_user already ran, so the
        # user exists with a FORCE_CHANGE_PASSWORD status.
        aws_mocks["_cognito_users"][admin_email] = {
            "email": admin_email,
            "password": "temp-pw",
            "status": "FORCE_CHANGE_PASSWORD",
            "mfa": [],
            "preferred_mfa": None,
            "totp_secret": None,
        }

        # --- Step 1: GET /api/invitations/{token}/verify ---
        resp = rls_client.get(f"/api/invitations/{seed['invitation_token']}/verify")
        assert resp.status_code == 200, resp.get_json()
        verify_data = resp.get_json()
        assert verify_data["valid"] is True
        assert verify_data["email"] == admin_email
        assert verify_data["organization_id"] == seed["org_id"]

        # --- Step 2: POST /api/auth/activate ---
        # This is the path the frontend actually calls. The sibling route
        # /api/activate also exists with similar semantics, but only the
        # /auth/activate variant is wired up in src/pages/auth/ActivateAccountPage.tsx.
        # A previous version of this test hit /api/activate and missed a
        # missing-keyword-arg TypeError in /api/auth/activate's call to
        # generate_access_token() — a production 500.
        resp = rls_client.post("/api/auth/activate", json={
            "token": seed["invitation_token"],
            "password": "NewP@ssword-Activation-1",
        })
        assert resp.status_code == 200, resp.get_json()
        activate_data = resp.get_json()
        assert activate_data["user_id"]
        assert activate_data["email"] == admin_email
        assert activate_data["access_token"]
        assert activate_data["active_organization_id"] == seed["org_id"]
        # Cognito must have been told to set the user's permanent password
        assert any(
            c["email"].lower() == admin_email and c["permanent"]
            for c in aws_mocks["cognito_set_password"]
        )

        # --- Step 3: First login (admin role → MFA setup required) ---
        # Stage the id-token claims the fake verify_cognito_id_token returns.
        aws_mocks["_id_token_state"]["claims"] = {
            "sub": f"cognito-{admin_email}",
            "email": admin_email,
            "token_use": "id",
        }
        resp = rls_client.post("/api/auth/login", json={
            "email": admin_email,
            "password": "NewP@ssword-Activation-1",
        })
        assert resp.status_code == 200, resp.get_json()
        login_data = resp.get_json()
        # Admin role + no enrolled MFA → mfaSetupRequired
        assert login_data.get("mfaSetupRequired") is True, (
            f"expected mfaSetupRequired, got {login_data}"
        )
        setup_session = login_data["session"]

        # --- Step 4: Start TOTP setup ---
        resp = rls_client.post("/api/auth/mfa/setup/start", json={
            "email": admin_email,
            "session": setup_session,
        })
        assert resp.status_code == 200, resp.get_json()
        setup_start = resp.get_json()
        assert "secret" in setup_start
        assert "otpauthUrl" in setup_start

        # --- Step 5: Verify TOTP setup ---
        resp = rls_client.post("/api/auth/mfa/setup/verify", json={
            "email": admin_email,
            "code": "123456",  # mock accepts any 6 digits
            "session": setup_session,
        })
        assert resp.status_code == 200, resp.get_json()
        assert resp.get_json() == {"ok": True}

        # --- Step 6: Sign back in (now MFA challenge issued) ---
        resp = rls_client.post("/api/auth/login", json={
            "email": admin_email,
            "password": "NewP@ssword-Activation-1",
        })
        assert resp.status_code == 200, resp.get_json()
        login2_data = resp.get_json()
        assert login2_data.get("mfaRequired") is True, (
            f"expected mfaRequired after setup, got {login2_data}"
        )
        assert login2_data.get("mfaType") == "totp"
        mfa_session = login2_data["session"]

        # --- Step 7: POST /api/auth/mfa/verify ---
        # This is THE step that 500'd in production with PendingRollbackError.
        # Under strict RLS, the audit_logs INSERT for auth.mfa_challenge_success
        # has to satisfy (organization_id = current_org_id()) — pre-fix it
        # didn't and the response was 500.
        resp = rls_client.post("/api/auth/mfa/verify", json={
            "email": admin_email,
            "code": "123456",
            "session": mfa_session,
            "mfaType": "totp",
        })
        assert resp.status_code == 200, (
            f"MFA verify returned {resp.status_code}: {resp.get_json()}. "
            "This is the strict-RLS audit-log bug we shipped a fix for "
            "in 55d1dc2e — if this fails, the fix was reverted."
        )
        mfa_data = resp.get_json()
        assert "access_token" in mfa_data
        assert mfa_data["active_organization_id"] == seed["org_id"]

        # --- Step 8: GET /api/me ---
        # The refresh cookie was set by /mfa/verify; rls_client carries it.
        resp = rls_client.get("/api/me")
        assert resp.status_code == 200, resp.get_json()
        me_data = resp.get_json()
        assert me_data["email"] == admin_email
        assert me_data["active_organization_id"] == seed["org_id"]
        # The org has Collections enabled in the seed — /me must surface
        # it. Pre-fix 8e65e713 returned apps as []. Regression guard.
        assert me_data.get("applications"), (
            "/me returned empty applications list — the RLS-bootstrap "
            "fix from 8e65e713 (set current_org_id after membership lookup) "
            "is broken or got reverted."
        )

        # --- SES sanity ---
        # No welcome-email send under this test (we seeded the post-
        # provisioning state directly), but the activation-accepted
        # notification email may or may not fire depending on invited_by.
        # Just sanity-check that EmailService didn't blow up on tag
        # sanitization when it did run.
        for call in aws_mocks["ses_send_email"]:
            for tag in call.get("EmailTags") or []:
                assert re.fullmatch(r"[A-Za-z0-9_\-.@]+", tag["Value"]), (
                    f"SES tag value {tag['Value']!r} fails the boundary regex"
                )
