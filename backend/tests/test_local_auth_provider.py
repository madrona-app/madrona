"""
Local auth provider (AUTH_PROVIDER=local) — self-hosted deployments.

Covers: password login against users.password_hash, login failures,
password change, MFA endpoints returning 501, and provider resolution.
The cognito path is covered by test_fastapi_auth.py and must be
unaffected (its tests pin provider behavior via mocks).
"""

import pytest
from unittest.mock import patch

from app.services.auth_utils import hash_password


@pytest.fixture(autouse=True)
def _local_provider(request, monkeypatch):
    """Force the resolved provider to 'local' for every test here (except
    tests marked real_provider, which exercise actual resolution)."""
    if request.node.get_closest_marker("real_provider"):
        yield
        return
    from app.config import get_settings
    settings = get_settings()
    monkeypatch.setattr(type(settings), "resolved_auth_provider", property(lambda self: "local"))
    yield


@pytest.fixture()
def local_user(db_session):
    from app.models import User

    user = User(
        email="localuser@example.com",
        display_name="Local User",
        status="active",
        password_hash=hash_password("correct-horse-battery"),
    )
    db_session.add(user)
    db_session.flush()
    return user


class TestLocalLogin:
    def test_login_success_issues_session(self, client, local_user):
        resp = client.post("/api/auth/login", json={
            "email": "localuser@example.com", "password": "correct-horse-battery",
        })
        assert resp.status_code == 200, resp.get_json()
        data = resp.get_json()
        assert data["email"] == "localuser@example.com"
        assert data["access_token"]
        # refresh cookie set
        assert any("refresh_token" in c for c in resp.headers.get_list("set-cookie"))

    def test_login_wrong_password_401(self, client, local_user):
        resp = client.post("/api/auth/login", json={
            "email": "localuser@example.com", "password": "wrong",
        })
        assert resp.status_code == 401

    def test_login_unknown_user_401(self, client):
        resp = client.post("/api/auth/login", json={
            "email": "nobody@example.com", "password": "whatever",
        })
        assert resp.status_code == 401

    def test_login_user_without_hash_401(self, client, db_session):
        from app.models import User
        u = User(email="cognito-era@example.com", status="active", cognito_sub="legacy-sub")
        db_session.add(u)
        db_session.flush()
        resp = client.post("/api/auth/login", json={
            "email": "cognito-era@example.com", "password": "anything",
        })
        assert resp.status_code == 401

    def test_login_inactive_user_403(self, client, db_session):
        from app.models import User
        u = User(email="inactive@example.com", status="suspended",
                 password_hash=hash_password("pw-good-enough"))
        db_session.add(u)
        db_session.flush()
        resp = client.post("/api/auth/login", json={
            "email": "inactive@example.com", "password": "pw-good-enough",
        })
        assert resp.status_code == 403

    def test_login_never_calls_cognito(self, client, local_user):
        with patch("app.fastapi_app.routers.auth.cognito_initiate_auth") as mock_cog:
            resp = client.post("/api/auth/login", json={
                "email": "localuser@example.com", "password": "correct-horse-battery",
            })
        assert resp.status_code == 200
        mock_cog.assert_not_called()


class TestLocalPasswordChange:
    def _login(self, client):
        resp = client.post("/api/auth/login", json={
            "email": "localuser@example.com", "password": "correct-horse-battery",
        })
        assert resp.status_code == 200
        return resp

    def test_change_password_success(self, client, local_user, db_session):
        self._login(client)
        resp = client.post("/api/auth/password/change", json={
            "current_password": "correct-horse-battery",
            "new_password": "even-better-passphrase-9",
        })
        assert resp.status_code == 200, resp.get_json()
        db_session.refresh(local_user)
        from app.services.auth_utils import verify_password
        assert verify_password("even-better-passphrase-9", local_user.password_hash)

    def test_change_password_wrong_current_401(self, client, local_user):
        self._login(client)
        resp = client.post("/api/auth/password/change", json={
            "current_password": "not-it",
            "new_password": "whatever-new-1",
        })
        assert resp.status_code == 401


class TestMfaUnavailable:
    @pytest.mark.parametrize("path,payload", [
        ("/api/auth/mfa/verify", {"email": "x@example.com", "code": "123456", "session": "s"}),
        ("/api/auth/mfa/setup/start", {"email": "x@example.com", "session": "s"}),
        ("/api/auth/mfa/recovery/request", {"email": "x@example.com"}),
    ])
    def test_mfa_endpoints_501(self, client, path, payload):
        resp = client.post(path, json=payload)
        assert resp.status_code == 501, f"{path} -> {resp.status_code}"
        assert "cognito auth provider" in str(resp.get_json())


@pytest.mark.real_provider
class TestProviderResolution:
    def test_auto_resolves_local_without_pool(self, monkeypatch):
        from app.config import Settings
        monkeypatch.delenv("COGNITO_USER_POOL_ID", raising=False)
        s = Settings(SECRET_KEY="x" * 32, DATABASE_URL="postgresql+psycopg://u:p@h/db", AUTH_PROVIDER="auto")
        assert s.resolved_auth_provider == "local"

    def test_auto_resolves_cognito_with_pool(self, monkeypatch):
        from app.config import Settings
        monkeypatch.setenv("COGNITO_USER_POOL_ID", "us-west-2_test")
        s = Settings(SECRET_KEY="x" * 32, DATABASE_URL="postgresql+psycopg://u:p@h/db", AUTH_PROVIDER="auto")
        assert s.resolved_auth_provider == "cognito"

    def test_explicit_wins(self, monkeypatch):
        from app.config import Settings
        monkeypatch.setenv("COGNITO_USER_POOL_ID", "us-west-2_test")
        s = Settings(SECRET_KEY="x" * 32, DATABASE_URL="postgresql+psycopg://u:p@h/db", AUTH_PROVIDER="local")
        assert s.resolved_auth_provider == "local"
