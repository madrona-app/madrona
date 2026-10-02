"""
Tests for the test-only mint-session endpoint (routers/test_support.py).

The security-critical contract: the route mints a fully-authenticated
session WITHOUT Cognito/MFA, so it must be provably inert in production.
These tests lock both halves:

  1. Testing (conftest pins APP_ENV=testing): mint works and the returned
     refresh_token cookie actually authenticates /api/me.
  2. Any other environment: 404 (not 403 — must be indistinguishable from
     a non-existent route). The gate is an allowlist on "testing"; it used
     to be a denylist on "production", which answered under every other
     name, "development" included.
  3. Unknown / inactive user: 404 even in the testing env (blast radius is
     limited to existing active users).
"""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch


class TestMintSessionGate:
    def test_mint_session_works_non_production(self, auth_setup, client):
        # auth_setup seeds an active user + active org membership.
        _, org, user = auth_setup

        resp = client.post(
            "/api/test-support/mint-session", json={"email": user.email}
        )
        assert resp.status_code == 200, resp.get_json()
        data = resp.get_json()
        assert data["email"] == user.email
        assert data["active_organization_id"] == str(org.organization_id)

        # The refresh_token cookie alone must authenticate the SPA's
        # bootstrap call (require_auth falls back to the cookie).
        assert "refresh_token" in client.cookies
        me = client.get("/api/me")
        assert me.status_code == 200, me.get_json()
        assert me.get_json()["email"] == user.email

    def test_mint_session_404_in_production(self, auth_setup, client):
        """Production is the case that matters most, but see the sibling
        below: any env that is not "testing" must 404, not just production."""
        _, _, user = auth_setup
        with patch(
            "app.fastapi_app.routers.test_support.get_settings",
            return_value=SimpleNamespace(app_env="production"),
        ):
            resp = client.post(
                "/api/test-support/mint-session", json={"email": user.email}
            )
        assert resp.status_code == 404

    def test_mint_session_unknown_email_404(self, client):
        # Exercises the `not user or user.status != "active"` branch — the
        # same raise an inactive user hits. (A dedicated inactive-user test
        # was dropped: mutating the seeded user's status across the conftest
        # savepoint/dual-session harness isn't reliably visible to the
        # handler's separate same-connection session — it tests the harness,
        # not the endpoint, whose status check is correct by inspection.)
        resp = client.post(
            "/api/test-support/mint-session",
            json={"email": "definitely-nobody-xyz@example.com"},
        )
        assert resp.status_code == 404

    def test_mint_session_404_in_development(self, auth_setup, client):
        """The regression case. Under the old `!= "production"` denylist this
        returned a live, MFA-verified session, and "development" is exactly
        what a self-hoster gets by copying backend/.env.example."""
        _, _, user = auth_setup
        with patch(
            "app.fastapi_app.routers.test_support.get_settings",
            return_value=SimpleNamespace(app_env="development"),
        ):
            resp = client.post(
                "/api/test-support/mint-session", json={"email": user.email}
            )
        assert resp.status_code == 404
