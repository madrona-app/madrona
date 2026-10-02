"""
Widget settings endpoints (GET/PUT /api/guide/widget/settings).

Org-admin surface for the Visitor Guide gate: toggling widget_enabled,
setting the welcome message, and reading the usage meter.
"""

from __future__ import annotations

import json

import pytest

from app.models.core import Application, OrganizationApplication


@pytest.fixture
def guide_org(auth_setup, db_session):
    """auth_setup org with the Guide app enabled (core tier)."""
    client, org, user = auth_setup
    app = db_session.query(Application).filter_by(key="guide").first()
    if not app:
        app = Application(key="guide", display_name="Guide")
        db_session.add(app)
        db_session.flush()
    org_app = OrganizationApplication(
        organization_id=org.organization_id,
        application_id=app.application_id,
        enabled=True,
        config={"tier": "core", "max_widget_queries": 1000},
    )
    db_session.add(org_app)
    db_session.commit()
    return client, org, org_app


class TestGetSettings:
    def test_defaults_off(self, guide_org):
        client, org, _ = guide_org
        resp = client.get("/api/guide/widget/settings")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["enabled"] is False
        assert body["welcome_message"] is None
        assert body["tier"] == "core"
        assert body["max_widget_queries"] == 1000
        assert body["widget_queries_this_month"] == 0

    def test_requires_guide_app(self, auth_setup):
        client, _, _ = auth_setup  # no guide app enabled
        resp = client.get("/api/guide/widget/settings")
        assert resp.status_code == 403


class TestUpdateSettings:
    def test_enable_persists_and_survives_reload(self, guide_org, db_session):
        client, org, org_app = guide_org
        resp = client.put(
            "/api/guide/widget/settings",
            data=json.dumps({"enabled": True, "welcome_message": "  Welcome to our museum!  "}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["enabled"] is True
        assert body["welcome_message"] == "Welcome to our museum!"

        db_session.refresh(org_app)
        assert org_app.config["widget_enabled"] is True
        assert org_app.config["widget_welcome_message"] == "Welcome to our museum!"
        # Pre-existing config keys untouched
        assert org_app.config["tier"] == "core"
        assert org_app.config["max_widget_queries"] == 1000

    def test_disable_and_clear_welcome(self, guide_org, db_session):
        client, org, org_app = guide_org
        client.put(
            "/api/guide/widget/settings",
            data=json.dumps({"enabled": True, "welcome_message": "hi"}),
            content_type="application/json",
        )
        resp = client.put(
            "/api/guide/widget/settings",
            data=json.dumps({"enabled": False, "welcome_message": ""}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        db_session.refresh(org_app)
        assert org_app.config["widget_enabled"] is False
        assert "widget_welcome_message" not in org_app.config

    def test_welcome_message_length_capped(self, guide_org):
        client, _, _ = guide_org
        resp = client.put(
            "/api/guide/widget/settings",
            data=json.dumps({"enabled": True, "welcome_message": "x" * 400}),
            content_type="application/json",
        )
        assert resp.status_code == 422

    def test_toggle_flows_to_public_gate(self, guide_org, db_session, monkeypatch):
        """Enabling via settings makes the public visitor endpoint accept."""
        from app.config import get_settings
        from app.models import Organization
        monkeypatch.setattr(get_settings(), "agent_enabled", True)
        client, org, _ = guide_org
        slug = db_session.query(Organization.slug).filter_by(
            organization_id=org.organization_id,
        ).scalar()

        resp = client.post(
            f"/api/guide/{slug}/conversations",
            data=json.dumps({}),
            content_type="application/json",
        )
        assert resp.status_code == 403  # gated off

        client.put(
            "/api/guide/widget/settings",
            data=json.dumps({"enabled": True}),
            content_type="application/json",
        )
        resp = client.post(
            f"/api/guide/{slug}/conversations",
            data=json.dumps({}),
            content_type="application/json",
        )
        assert resp.status_code == 201
