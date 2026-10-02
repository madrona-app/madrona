"""
Email-OTP MFA setup / verify / disable.

Backend coverage for the Phase 1+2 work that adds EMAIL_OTP as an
additive MFA factor alongside the existing TOTP flow. Mocks Cognito
at the boundary (the AdminSetUserMFAPreference + AdminGetUser calls)
and SES at the EmailService.client level so tests stay fast and
don't reach AWS.

The handler functions are invoked directly rather than through the
FastAPI TestClient — same pattern as
``tests/test_provisioning_cancel_rerun.py``, which documents why the
client fixture hangs on macOS via auth_setup.
"""
from __future__ import annotations

import hashlib
import json
import secrets as _secrets_mod
from unittest.mock import MagicMock
from uuid import uuid4

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _seed_user(db_session, *, status: str = "active"):
    from app.models import User
    user = User(
        email=f"mfa-user-{uuid4().hex[:8]}@madrona.test",
        display_name="MFA Test User",
        status=status,
    )
    db_session.add(user)
    db_session.flush()
    return user


def _seed_admin_user_with_role(db_session, role_key: str = "admin"):
    from app.models import (
        Organization,
        OrganizationMembership,
        Role,
        User,
    )
    user = User(
        email=f"mfa-admin-{uuid4().hex[:8]}@madrona.test",
        display_name="Admin",
        status="active",
    )
    db_session.add(user)
    db_session.flush()

    org = Organization(
        name="MFA Test Org",
        slug=f"mfa-org-{uuid4().hex[:8]}",
        status="active",
    )
    db_session.add(org)
    db_session.flush()

    role = Role(
        role_key=role_key,
        display_name=role_key.title(),
        description="role for MFA tests",
        is_system=True,
    )
    db_session.add(role)
    db_session.flush()

    membership = OrganizationMembership(
        organization_id=org.organization_id,
        user_id=user.user_id,
        role=role_key,
        role_id=role.role_id,
        status="active",
    )
    db_session.add(membership)
    db_session.flush()

    return user, org


def _seed_refresh_cookie(db_session, user):
    """Create a refresh-token row + return the plaintext cookie value
    that ``_validate_refresh_cookie`` will accept."""
    from datetime import datetime, timezone, timedelta
    from app.models import RefreshToken
    from app.services.auth_utils import (
        generate_refresh_token,
        hash_refresh_token,
    )

    token = generate_refresh_token()
    token_hash = hash_refresh_token(token)
    record = RefreshToken(
        user_id=user.user_id,
        token_hash=token_hash,
        expires_at=datetime.now(timezone.utc) + timedelta(days=30),
    )
    db_session.add(record)
    db_session.commit()
    return token, record


def _make_request(refresh_cookie: str):
    """Build a MagicMock Request shaped for the auth handlers."""
    req = MagicMock()
    req.cookies = {"refresh_token": refresh_cookie}
    req.headers = {}
    req.client = MagicMock(host="127.0.0.1")
    return req


@pytest.fixture
def fake_redis(monkeypatch):
    """In-memory dict masquerading as a Redis client (subset of API)."""
    store: dict[str, tuple[bytes, float | None]] = {}

    class _FakeRedis:
        def set(self, key, value, ex=None):
            if isinstance(value, str):
                value = value.encode()
            store[key] = (value, ex)

        def get(self, key):
            entry = store.get(key)
            return entry[0] if entry else None

        def delete(self, *keys):
            for k in keys:
                store.pop(k, None)

    fake = _FakeRedis()

    class _FakeRedisClient:
        @property
        def client(self):
            return fake

        def is_available(self):
            return True

    monkeypatch.setattr(
        "app.services.redis_client.get_redis_client",
        lambda: _FakeRedisClient(),
    )
    monkeypatch.setattr(
        "app.services.rate_limiter.get_redis_client",
        lambda: _FakeRedisClient(),
    )
    return store


@pytest.fixture
def aws_mfa_mocks(monkeypatch):
    """Capture Cognito + SES calls."""
    calls = {
        "set_mfa_pref": [],
        "get_user_mfa": [],
        "ses": [],
    }
    # Default MFA state Cognito returns for a brand-new user (no factors).
    state = {"totp_enabled": False, "sms_enabled": False, "email_enabled": False, "preferred": None}

    def fake_set_mfa_pref(email, **kwargs):
        calls["set_mfa_pref"].append({"email": email, **kwargs})
        if kwargs.get("totp_enabled") is not None:
            state["totp_enabled"] = bool(kwargs["totp_enabled"])
        if kwargs.get("sms_enabled") is not None:
            state["sms_enabled"] = bool(kwargs["sms_enabled"])
        if kwargs.get("email_enabled") is not None:
            state["email_enabled"] = bool(kwargs["email_enabled"])
        if kwargs.get("preferred") is not None:
            state["preferred"] = kwargs["preferred"]

    monkeypatch.setattr(
        "app.services.cognito.cognito_admin_set_user_mfa_preference",
        fake_set_mfa_pref,
    )

    # admin_get_user is called by CognitoService.get_user_mfa_status,
    # which is what the DELETE handler invokes. Patch get_user_mfa_status
    # directly to return our test state.
    def fake_get_user_mfa_status(self, username):
        calls["get_user_mfa"].append(username)
        return {
            "mfa_enabled": (
                state["totp_enabled"] or state["sms_enabled"] or state["email_enabled"]
            ),
            "totp_enabled": state["totp_enabled"],
            "sms_enabled": state["sms_enabled"],
            "email_enabled": state["email_enabled"],
            "preferred_mfa": state["preferred"],
        }

    from app.services.cognito import CognitoService
    monkeypatch.setattr(CognitoService, "get_user_mfa_status", fake_get_user_mfa_status)

    # SES — capture but always succeed.
    class _FakeSES:
        def send_email(self, **params):
            calls["ses"].append(params)
            return {"MessageId": "mfa-test-msg"}

    from app.services import email_service as email_mod
    email_mod._email_service = None
    monkeypatch.setattr(
        email_mod.EmailService,
        "client",
        property(lambda self: _FakeSES()),
    )
    monkeypatch.setattr(
        "app.services.email_event_service.check_email_deliverable",
        lambda email: True,
    )

    yield {"calls": calls, "state": state}
    email_mod._email_service = None


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestEmailMfaSetup:
    def test_start_emails_a_code_and_stashes_hash(
        self, db_session, fake_redis, aws_mfa_mocks
    ):
        from app.fastapi_app.routers.auth import mfa_email_setup_start

        user = _seed_user(db_session)
        cookie, _ = _seed_refresh_cookie(db_session, user)

        result = mfa_email_setup_start(request=_make_request(cookie), db=db_session)
        assert result == {"ok": True}

        # One SES call to this user's address
        sent = aws_mfa_mocks["calls"]["ses"]
        assert len(sent) == 1
        body = sent[0]["Content"]["Simple"]["Body"]
        text = body["Text"]["Data"]
        # The 6-digit code lives in the body text — extract it
        import re
        m = re.search(r"\b(\d{6})\b", text)
        assert m, f"no 6-digit code in body: {text!r}"
        sent_code = m.group(1)

        # Redis has the hash, not the plaintext
        key = f"mfa_email_setup:{user.user_id}"
        stored = fake_redis[key][0].decode()
        assert stored == hashlib.sha256(sent_code.encode()).hexdigest()
        # TTL is set to ~5 minutes
        assert fake_redis[key][1] == 300

    def test_verify_happy_path_enables_email_only(
        self, db_session, fake_redis, aws_mfa_mocks
    ):
        from app.fastapi_app.routers.auth import (
            mfa_email_setup_start,
            mfa_email_setup_verify,
        )
        from app.fastapi_app.schemas.auth import MFAEmailSetupVerifyBody

        user = _seed_user(db_session)
        cookie, _ = _seed_refresh_cookie(db_session, user)

        mfa_email_setup_start(request=_make_request(cookie), db=db_session)
        # Pull the emitted code out of the captured SES payload
        import re
        text = aws_mfa_mocks["calls"]["ses"][0]["Content"]["Simple"]["Body"]["Text"]["Data"]
        code = re.search(r"\b(\d{6})\b", text).group(1)

        result = mfa_email_setup_verify(
            body=MFAEmailSetupVerifyBody(code=code),
            request=_make_request(cookie),
            db=db_session,
        )
        assert result == {"ok": True}

        prefs = aws_mfa_mocks["calls"]["set_mfa_pref"]
        assert len(prefs) == 1, f"expected 1 set-pref call, got {prefs}"
        call = prefs[0]
        # Only email_enabled is passed — TOTP/SMS are deliberately omitted
        # so Cognito doesn't touch their settings (additive contract).
        assert call["email_enabled"] is True
        assert "totp_enabled" not in call or call["totp_enabled"] is None
        assert "sms_enabled" not in call or call["sms_enabled"] is None

        # Code is single-use — Redis entry deleted
        assert fake_redis.get(f"mfa_email_setup:{user.user_id}") is None

    def test_verify_wrong_code_does_not_enable(
        self, db_session, fake_redis, aws_mfa_mocks
    ):
        from fastapi import HTTPException
        from app.fastapi_app.routers.auth import (
            mfa_email_setup_start,
            mfa_email_setup_verify,
        )
        from app.fastapi_app.schemas.auth import MFAEmailSetupVerifyBody

        user = _seed_user(db_session)
        cookie, _ = _seed_refresh_cookie(db_session, user)

        mfa_email_setup_start(request=_make_request(cookie), db=db_session)
        with pytest.raises(HTTPException) as exc_info:
            mfa_email_setup_verify(
                body=MFAEmailSetupVerifyBody(code="000000"),
                request=_make_request(cookie),
                db=db_session,
            )
        assert exc_info.value.status_code == 401
        assert aws_mfa_mocks["calls"]["set_mfa_pref"] == []

    def test_verify_without_active_code_400s(
        self, db_session, fake_redis, aws_mfa_mocks
    ):
        from fastapi import HTTPException
        from app.fastapi_app.routers.auth import mfa_email_setup_verify
        from app.fastapi_app.schemas.auth import MFAEmailSetupVerifyBody

        user = _seed_user(db_session)
        cookie, _ = _seed_refresh_cookie(db_session, user)

        with pytest.raises(HTTPException) as exc_info:
            mfa_email_setup_verify(
                body=MFAEmailSetupVerifyBody(code="123456"),
                request=_make_request(cookie),
                db=db_session,
            )
        assert exc_info.value.status_code == 400

    # Rate-limit enforcement is covered by tests/test_rate_limiter.py;
    # conftest globally patches RateLimiter.allow to True so reproducing
    # the 429 in this file is fighting the test harness rather than
    # testing the handler. The handler wires the limiter correctly —
    # the limiter itself is tested in isolation.


class TestEmailMfaDisable:
    def test_disable_removes_email_for_user_with_totp_already_enabled(
        self, db_session, fake_redis, aws_mfa_mocks
    ):
        from app.fastapi_app.routers.auth import mfa_email_disable

        user = _seed_user(db_session)
        cookie, _ = _seed_refresh_cookie(db_session, user)

        # Pre-state: user has both factors enabled.
        aws_mfa_mocks["state"].update({
            "totp_enabled": True,
            "email_enabled": True,
        })

        result = mfa_email_disable(request=_make_request(cookie), db=db_session)
        assert result == {"ok": True}

        prefs = aws_mfa_mocks["calls"]["set_mfa_pref"]
        assert prefs and prefs[-1]["email_enabled"] is False

    def test_disable_refuses_when_email_is_only_factor_on_mfa_required_role(
        self, db_session, fake_redis, aws_mfa_mocks
    ):
        from fastapi import HTTPException
        from app.fastapi_app.routers.auth import mfa_email_disable

        user, _ = _seed_admin_user_with_role(db_session, role_key="admin")
        cookie, _ = _seed_refresh_cookie(db_session, user)

        aws_mfa_mocks["state"].update({
            "totp_enabled": False,
            "sms_enabled": False,
            "email_enabled": True,
        })

        with pytest.raises(HTTPException) as exc_info:
            mfa_email_disable(request=_make_request(cookie), db=db_session)
        assert exc_info.value.status_code == 409
        # No Cognito mutation attempted
        assert aws_mfa_mocks["calls"]["set_mfa_pref"] == []

    def test_disable_allowed_for_registrar_only_factor(
        self, db_session, fake_redis, aws_mfa_mocks
    ):
        """After the scope change MFA is only required for admin —
        registrar can disable email even if it's their only factor."""
        from app.fastapi_app.routers.auth import mfa_email_disable

        user, _ = _seed_admin_user_with_role(db_session, role_key="registrar")
        cookie, _ = _seed_refresh_cookie(db_session, user)

        aws_mfa_mocks["state"].update({
            "totp_enabled": False,
            "sms_enabled": False,
            "email_enabled": True,
        })

        result = mfa_email_disable(request=_make_request(cookie), db=db_session)
        assert result == {"ok": True}
        prefs = aws_mfa_mocks["calls"]["set_mfa_pref"]
        assert prefs and prefs[-1]["email_enabled"] is False

    def test_disable_when_already_off_is_idempotent(
        self, db_session, fake_redis, aws_mfa_mocks
    ):
        from app.fastapi_app.routers.auth import mfa_email_disable

        user = _seed_user(db_session)
        cookie, _ = _seed_refresh_cookie(db_session, user)

        # Pre-state: nothing enabled — DELETE should no-op.
        result = mfa_email_disable(request=_make_request(cookie), db=db_session)
        assert result == {"ok": True}
        # No Cognito mutation needed for the no-op path
        assert aws_mfa_mocks["calls"]["set_mfa_pref"] == []


class TestMfaRequiredRolesScope:
    def test_admin_is_in_required_set(self):
        from app.fastapi_app.routers.auth import MFA_REQUIRED_ROLES
        assert "admin" in MFA_REQUIRED_ROLES

    def test_registrar_is_no_longer_required(self):
        from app.fastapi_app.routers.auth import MFA_REQUIRED_ROLES
        assert "registrar" not in MFA_REQUIRED_ROLES


class TestLoginChallengeMapping:
    """Phase 3: EMAIL_OTP login challenges round-trip through the API."""

    def test_challenge_name_translation_tables(self):
        from app.fastapi_app.routers.auth import (
            _CHALLENGE_TO_MFA_TYPE,
            _MFA_TYPE_TO_CHALLENGE,
            _MFA_TYPE_TO_CODE_KEY,
        )
        assert _CHALLENGE_TO_MFA_TYPE["EMAIL_OTP"] == "email"
        assert _MFA_TYPE_TO_CHALLENGE["email"] == "EMAIL_OTP"
        assert _MFA_TYPE_TO_CODE_KEY["email"] == "EMAIL_OTP_CODE"
        # SMS + TOTP unchanged (regression guard)
        assert _CHALLENGE_TO_MFA_TYPE["SOFTWARE_TOKEN_MFA"] == "totp"
        assert _CHALLENGE_TO_MFA_TYPE["SMS_MFA"] == "sms"

    def test_verify_email_otp_calls_cognito_with_right_challenge_name(
        self, db_session, fake_redis, aws_mfa_mocks, monkeypatch
    ):
        """When the frontend sends mfaType='email', the backend must
        translate to EMAIL_OTP / EMAIL_OTP_CODE on the Cognito side.
        Bug class: silent fallback to SOFTWARE_TOKEN_MFA would 401 the
        user on every email-MFA login."""
        from app.fastapi_app.routers.auth import login_mfa
        from app.fastapi_app.schemas.auth import MFAVerifyRequest
        from app.services.cognito import AuthSuccess, AuthTokens

        captured = {}

        def fake_respond(session, challenge_name, challenge_responses, username):
            captured.update({
                "challenge_name": challenge_name,
                "challenge_responses": challenge_responses,
                "username": username,
            })
            # Stub successful authentication so the handler continues.
            return AuthSuccess(tokens=AuthTokens(
                id_token="id-tok", access_token="acc-tok",
                refresh_token="ref-tok", expires_in=3600,
            ))

        monkeypatch.setattr(
            "app.fastapi_app.routers.auth.cognito_respond_to_auth_challenge",
            fake_respond,
        )
        # Skip JWT verification by stubbing the ID-token verify call.
        def fake_verify_id(_):
            return {"sub": "test-cognito-sub", "email": "challenge-user@madrona.test"}
        monkeypatch.setattr(
            "app.fastapi_app.routers.auth.verify_cognito_id_token",
            fake_verify_id,
        )

        body = MFAVerifyRequest(
            email="challenge-user@madrona.test",
            code="123456",
            session="sess-tok",
            mfaType="email",
        )
        request = MagicMock(cookies={}, headers={}, client=MagicMock(host="127.0.0.1"))
        # Handler returns a JSONResponse with refresh-cookie set; we
        # only care about the captured Cognito args.
        login_mfa(body=body, request=request, db=db_session)

        assert captured["challenge_name"] == "EMAIL_OTP"
        assert captured["challenge_responses"]["EMAIL_OTP_CODE"] == "123456"


class TestMfaPreferenceEndpoint:
    """Phase 4: PUT /api/me/mfa-preferences and /me mfa_factors."""

    def test_switch_preferred_to_email_when_both_enrolled(
        self, db_session, fake_redis, aws_mfa_mocks
    ):
        from app.fastapi_app.routers.auth import set_mfa_preferences
        from app.fastapi_app.schemas.auth import MFAPreferenceBody

        user = _seed_user(db_session)
        cookie, _ = _seed_refresh_cookie(db_session, user)

        # Pre-state: both factors enrolled, TOTP preferred.
        aws_mfa_mocks["state"].update({
            "totp_enabled": True,
            "email_enabled": True,
            "preferred": "SOFTWARE_TOKEN_MFA",
        })

        result = set_mfa_preferences(
            body=MFAPreferenceBody(preferred="email"),
            request=_make_request(cookie),
            db=db_session,
        )
        assert result["preferred"] == "email"
        assert result["totp"] is True
        assert result["email"] is True

        prefs = aws_mfa_mocks["calls"]["set_mfa_pref"]
        # Single call carrying both enrolled blocks; preferred = EMAIL_OTP
        assert prefs and prefs[-1]["preferred"] == "EMAIL_OTP"
        assert prefs[-1]["totp_enabled"] is True
        assert prefs[-1]["email_enabled"] is True

    def test_switch_to_unenrolled_factor_409s(
        self, db_session, fake_redis, aws_mfa_mocks
    ):
        from fastapi import HTTPException
        from app.fastapi_app.routers.auth import set_mfa_preferences
        from app.fastapi_app.schemas.auth import MFAPreferenceBody

        user = _seed_user(db_session)
        cookie, _ = _seed_refresh_cookie(db_session, user)

        # User has only TOTP enrolled.
        aws_mfa_mocks["state"].update({
            "totp_enabled": True,
            "email_enabled": False,
            "preferred": "SOFTWARE_TOKEN_MFA",
        })

        with pytest.raises(HTTPException) as exc_info:
            set_mfa_preferences(
                body=MFAPreferenceBody(preferred="email"),
                request=_make_request(cookie),
                db=db_session,
            )
        assert exc_info.value.status_code == 409
        assert aws_mfa_mocks["calls"]["set_mfa_pref"] == []

    def test_me_response_carries_mfa_factors(
        self, db_session, fake_redis, aws_mfa_mocks
    ):
        """/me must surface the enrolled factors so the frontend can
        render the account-security UI without a separate round-trip."""
        from app.fastapi_app.routers.auth import get_current_user

        user, _ = _seed_admin_user_with_role(db_session, role_key="admin")
        cookie, _ = _seed_refresh_cookie(db_session, user)

        aws_mfa_mocks["state"].update({
            "totp_enabled": True,
            "email_enabled": True,
            "preferred": "EMAIL_OTP",
        })

        result = get_current_user(request=_make_request(cookie), db=db_session)
        factors = result["mfa_factors"]
        assert factors is not None
        assert factors["totp"] is True
        assert factors["email"] is True
        assert factors["sms"] is False
        assert factors["preferred"] == "email"
