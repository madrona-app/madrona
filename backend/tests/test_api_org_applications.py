"""
Org-admin application enablement (GET/PUT /api/organizations/{id}/applications).

This is the surface an organization uses to choose which apps it runs. The
cases that matter are the ones that stop an admin breaking their own
install: you cannot switch off the last app, you cannot switch off
Collections, and you cannot switch on something this deployment has no
provider for.
"""

from __future__ import annotations

import pytest

from app.models.core import Application, OrganizationApplication


def _app(db_session, key: str, **kw) -> Application:
    app = db_session.query(Application).filter_by(key=key).first()
    if not app:
        app = Application(
            key=key,
            display_name=kw.pop("display_name", key.title()),
            status=kw.pop("status", "active"),
            **kw,
        )
        db_session.add(app)
        db_session.flush()
    return app


def _enable(db_session, org, app, enabled=True):
    row = (
        db_session.query(OrganizationApplication)
        .filter_by(organization_id=org.organization_id, application_id=app.application_id)
        .first()
    )
    if row:
        row.enabled = enabled
    else:
        db_session.add(OrganizationApplication(
            organization_id=org.organization_id,
            application_id=app.application_id,
            enabled=enabled,
        ))
    db_session.commit()
    return row


@pytest.fixture
def org_with_apps(auth_setup, db_session):
    """Collections + Media enabled, Guide registered but off."""
    client, org, user = auth_setup
    collections = _app(db_session, "collections", display_name="Collections")
    media = _app(db_session, "media", display_name="Media")
    _app(db_session, "guide", display_name="Guide")
    _enable(db_session, org, collections, True)
    _enable(db_session, org, media, True)
    return client, org


class TestList:
    def test_lists_apps_with_enabled_state(self, org_with_apps):
        client, org = org_with_apps
        resp = client.get(f"/api/organizations/{org.organization_id}/applications")
        assert resp.status_code == 200
        by_key = {a["key"]: a for a in resp.get_json()["applications"]}

        assert by_key["collections"]["enabled"] is True
        assert by_key["media"]["enabled"] is True
        # Registered but never enabled for this org.
        assert by_key["guide"]["enabled"] is False

    def test_collections_reports_as_undisableable(self, org_with_apps):
        client, org = org_with_apps
        resp = client.get(f"/api/organizations/{org.organization_id}/applications")
        by_key = {a["key"]: a for a in resp.get_json()["applications"]}
        assert by_key["collections"]["can_disable"] is False
        assert by_key["media"]["can_disable"] is True


class TestToggle:
    def test_enable_then_disable(self, org_with_apps):
        client, org = org_with_apps
        base = f"/api/organizations/{org.organization_id}/applications/media"

        resp = client.put(base, json={"enabled": False})
        assert resp.status_code == 200
        assert resp.get_json()["enabled"] is False

        resp = client.put(base, json={"enabled": True})
        assert resp.status_code == 200
        assert resp.get_json()["enabled"] is True

    def test_enabling_creates_row_when_absent(self, org_with_apps, monkeypatch):
        """An app the org has never had should enable, not 404."""
        import app.fastapi_app.routers.organizations as orgs_router

        # Guide needs a provider; this test is about row creation, not capability.
        monkeypatch.setattr(orgs_router, "_app_capability", lambda key: (True, None))

        client, org = org_with_apps
        resp = client.put(
            f"/api/organizations/{org.organization_id}/applications/guide",
            json={"enabled": True},
        )
        assert resp.status_code == 200, resp.get_json()
        assert resp.get_json()["enabled"] is True

    def test_rejects_non_boolean(self, org_with_apps):
        client, org = org_with_apps
        resp = client.put(
            f"/api/organizations/{org.organization_id}/applications/media",
            json={"enabled": "yes"},
        )
        assert resp.status_code == 422

    def test_unknown_app_404s(self, org_with_apps):
        client, org = org_with_apps
        resp = client.put(
            f"/api/organizations/{org.organization_id}/applications/nonesuch",
            json={"enabled": True},
        )
        assert resp.status_code == 404


class TestGuardrails:
    def test_collections_cannot_be_disabled(self, org_with_apps):
        client, org = org_with_apps
        resp = client.put(
            f"/api/organizations/{org.organization_id}/applications/collections",
            json={"enabled": False},
        )
        assert resp.status_code == 409
        assert resp.get_json()["error"]["code"] == "app_required"

    def test_cannot_disable_the_last_application(self, auth_setup, db_session):
        """
        An org with nothing enabled has no landing page, which strands the
        admin who would need to undo it.
        """
        client, org, _ = auth_setup
        media = _app(db_session, "media", display_name="Media")
        _enable(db_session, org, media, True)

        resp = client.put(
            f"/api/organizations/{org.organization_id}/applications/media",
            json={"enabled": False},
        )
        assert resp.status_code == 409
        assert resp.get_json()["error"]["code"] == "last_application"

    def test_guide_refused_when_no_provider_configured(self, org_with_apps, monkeypatch):
        """
        Enabling Guide on a deployment with no model behind it would make
        every conversation 503. Refuse it at the toggle instead.
        """
        import app.fastapi_app.routers.organizations as orgs_router

        monkeypatch.setattr(orgs_router, "_app_capability",
                            lambda key: (False, "Requires an AI provider.")
                            if key == "guide" else (True, None))

        client, org = org_with_apps
        resp = client.put(
            f"/api/organizations/{org.organization_id}/applications/guide",
            json={"enabled": True},
        )
        assert resp.status_code == 409
        assert resp.get_json()["error"]["code"] == "app_unavailable"

    def test_unavailable_app_reports_reason(self, org_with_apps, monkeypatch):
        import app.fastapi_app.routers.organizations as orgs_router

        monkeypatch.setattr(orgs_router, "_app_capability",
                            lambda key: (False, "Requires an AI provider.")
                            if key == "guide" else (True, None))

        client, org = org_with_apps
        resp = client.get(f"/api/organizations/{org.organization_id}/applications")
        guide = next(a for a in resp.get_json()["applications"] if a["key"] == "guide")
        assert guide["available"] is False
        assert "AI provider" in guide["unavailable_reason"]
