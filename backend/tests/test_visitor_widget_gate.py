"""
Visitor-widget gate + cap enforcement on the public guide endpoints.

The widget is off by default: an org needs its Guide app enabled AND the
explicit config["widget_enabled"] flag. Gate (403) is checked strictly
before the monthly cap (429). GDPR deletion stays available while gated.
"""

from __future__ import annotations

import json
from uuid import uuid4

import pytest

from app.config import get_settings
from app.models.agent import Conversation, Message
from app.models.core import Application, OrganizationApplication
from app.services.guide_usage import get_widget_access


@pytest.fixture(autouse=True)
def _agent_enabled(monkeypatch):
    monkeypatch.setattr(get_settings(), "agent_enabled", True)


def _enable_guide(db_session, org_id, config: dict | None):
    app = db_session.query(Application).filter_by(key="guide").first()
    if not app:
        app = Application(key="guide", display_name="Guide")
        db_session.add(app)
        db_session.flush()
    org_app = OrganizationApplication(
        organization_id=org_id,
        application_id=app.application_id,
        enabled=True,
        config=config,
    )
    db_session.add(org_app)
    db_session.commit()
    return org_app


def _create_conversation(client, slug="demo", payload=None):
    return client.post(
        f"/api/guide/{slug}/conversations",
        data=json.dumps(payload or {}),
        content_type="application/json",
    )


class TestWidgetGate:
    def test_no_guide_app_403(self, client, demo_tenant):
        resp = _create_conversation(client)
        assert resp.status_code == 403
        assert "widget_not_enabled" in json.dumps(resp.get_json())

    def test_guide_enabled_but_no_widget_flag_403(self, client, db_session, demo_tenant):
        _enable_guide(db_session, demo_tenant.organization_id, {"tier": "core"})
        resp = _create_conversation(client)
        assert resp.status_code == 403
        assert "widget_not_enabled" in json.dumps(resp.get_json())

    def test_widget_flag_false_403(self, client, db_session, demo_tenant):
        _enable_guide(
            db_session, demo_tenant.organization_id,
            {"tier": "core", "widget_enabled": False},
        )
        resp = _create_conversation(client)
        assert resp.status_code == 403

    def test_widget_enabled_creates_conversation(self, client, db_session, demo_tenant):
        _enable_guide(
            db_session, demo_tenant.organization_id,
            {"tier": "core", "widget_enabled": True},
        )
        resp = _create_conversation(client)
        assert resp.status_code == 201
        body = resp.get_json()
        assert body["conversation_id"]
        assert body["persona"] == "visitor"

    def test_guide_app_disabled_row_403_even_with_flag(self, client, db_session, demo_tenant):
        org_app = _enable_guide(
            db_session, demo_tenant.organization_id,
            {"widget_enabled": True},
        )
        org_app.enabled = False
        db_session.commit()
        resp = _create_conversation(client)
        assert resp.status_code == 403

    def test_gdpr_delete_not_widget_gated(self, client, db_session, demo_tenant):
        # No widget access at all — the data-rights endpoint must not apply the
        # widget gate. (It still enforces its own double-submit session check,
        # so without a session cookie we get ITS 403, never widget_not_enabled.)
        resp = client.delete(
            "/api/guide/demo/visitor-data",
            data=json.dumps({"session_id": "some-session-token"}),
            content_type="application/json",
        )
        body = json.dumps(resp.get_json())
        assert "widget_not_enabled" not in body
        assert resp.status_code == 403
        assert "Invalid session" in body


class TestWidgetCap:
    def _seed_visitor_usage(self, db_session, org_id, n: int):
        conv = Conversation(
            organization_id=org_id,
            persona="visitor",
            session_id="cap-session",
        )
        db_session.add(conv)
        db_session.flush()
        for _ in range(n):
            db_session.add(Message(
                conversation_id=conv.conversation_id,
                organization_id=org_id,
                role="user",
                content="q",
            ))
        db_session.commit()

    def test_cap_reached_429_at_create(self, client, db_session, demo_tenant):
        _enable_guide(
            db_session, demo_tenant.organization_id,
            {"widget_enabled": True, "max_widget_queries": 2},
        )
        self._seed_visitor_usage(db_session, demo_tenant.organization_id, 2)
        resp = _create_conversation(client)
        assert resp.status_code == 429
        assert "widget_limit_reached" in json.dumps(resp.get_json())

    def test_under_cap_allowed(self, client, db_session, demo_tenant):
        _enable_guide(
            db_session, demo_tenant.organization_id,
            {"widget_enabled": True, "max_widget_queries": 5},
        )
        self._seed_visitor_usage(db_session, demo_tenant.organization_id, 2)
        resp = _create_conversation(client)
        assert resp.status_code == 201

    def test_none_cap_unmetered_when_enabled(self, client, db_session, demo_tenant):
        # Platform/enterprise: enabled with no cap — unmetered by design
        _enable_guide(
            db_session, demo_tenant.organization_id,
            {"widget_enabled": True},
        )
        self._seed_visitor_usage(db_session, demo_tenant.organization_id, 50)
        resp = _create_conversation(client)
        assert resp.status_code == 201

    def test_gate_checked_before_cap(self, client, db_session, demo_tenant):
        # Over cap AND gated off → must be the 403, not the 429
        _enable_guide(
            db_session, demo_tenant.organization_id,
            {"widget_enabled": False, "max_widget_queries": 1},
        )
        self._seed_visitor_usage(db_session, demo_tenant.organization_id, 5)
        resp = _create_conversation(client)
        assert resp.status_code == 403


class TestWidgetAccessHelper:
    def test_absent_org_app(self, db_session, demo_tenant):
        access = get_widget_access(demo_tenant.organization_id, db_session)
        assert access.enabled is False
        assert access.over_cap is False

    def test_welcome_message_exposed(self, db_session, demo_tenant):
        _enable_guide(
            db_session, demo_tenant.organization_id,
            {"widget_enabled": True, "widget_welcome_message": "Hi there"},
        )
        access = get_widget_access(demo_tenant.organization_id, db_session)
        assert access.enabled is True
        assert access.welcome_message == "Hi there"
