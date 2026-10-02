"""
Smoke tests for the Audit Logs API endpoints.

Routes under:
- /api/organizations/<org_id>/audit-logs (GET)
- /api/platform/audit-logs (GET)  -- requires platform admin
- /api/organizations/<org_id>/entity-audit-events (GET)
- /api/organizations/<org_id>/entity-audit-events/<event_id> (GET)

All endpoints are read-only and require authentication + appropriate permissions.
"""

import uuid
from datetime import datetime, timezone
from unittest.mock import patch, MagicMock

import pytest

from app.models import AuditLog, EntityAuditEvent, EntityAuditFieldDiff


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _audit_logs_url(org):
    return f"/api/organizations/{org.organization_id}/audit-logs"


def _entity_events_url(org):
    return f"/api/organizations/{org.organization_id}/entity-audit-events"


def _entity_event_detail_url(org, event_id):
    return f"/api/organizations/{org.organization_id}/entity-audit-events/{event_id}"


def _platform_audit_logs_url():
    return "/api/platform/audit-logs"


def _create_audit_log(db_session, org, user, action="user.invited", details=None):
    """Insert an AuditLog row and return it."""
    log = AuditLog(
        organization_id=org.organization_id,
        acting_user_id=user.user_id,
        target_user_id=user.user_id,
        action=action,
        details=details or {"email": "someone@example.com"},
    )
    db_session.add(log)
    db_session.commit()
    return log


def _create_entity_audit_event(db_session, org, user, entity_type="collection_object",
                                 change_type="created", summary="Object created"):
    """Insert an EntityAuditEvent row and return it."""
    event = EntityAuditEvent(
        organization_id=org.organization_id,
        entity_type=entity_type,
        entity_id=uuid.uuid4(),
        entity_display_key="OBJ-001",
        change_type=change_type,
        changed_by=user.user_id,
        changed_by_name="Test User",
        changed_by_email=user.email,
        changed_fields=["title", "description"],
        summary=summary,
    )
    db_session.add(event)
    db_session.commit()
    return event


# ============================================================================
# GET /api/organizations/<org_id>/audit-logs
# ============================================================================

class TestGetAuditLogs:
    def test_list_audit_logs_empty(self, auth_setup):
        """When no audit logs exist, returns empty list with zero count."""
        auth_client, org, _ = auth_setup
        resp = auth_client.get(_audit_logs_url(org))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["items"] == []
        assert data["total"] == 0
        assert data["page"]["limit"] == 100
        assert data["page"]["offset"] == 0
        assert data["page"]["has_more"] is False

    def test_list_audit_logs_with_data(self, auth_setup, db_session):
        """Returns audit logs when data exists."""
        auth_client, org, user = auth_setup
        log = _create_audit_log(db_session, org, user, action="user.invited")
        resp = auth_client.get(_audit_logs_url(org))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1
        assert len(data["items"]) == 1
        entry = data["items"][0]
        assert entry["action"] == "user.invited"
        assert entry["organization_id"] == str(org.organization_id)
        assert entry["acting_user_id"] == str(user.user_id)

    def test_list_audit_logs_invalid_action_filter(self, auth_setup):
        """Invalid action query parameter returns 400."""
        auth_client, org, _ = auth_setup
        resp = auth_client.get(_audit_logs_url(org) + "?action=bad.action")
        assert resp.status_code in (400, 422)
        data = resp.get_json()
        assert "invalid action" in (data.get("error").get("message", "") if isinstance(data.get("error"), dict) else (data.get("error") or str(data.get("detail", "")))).lower()

    def test_list_audit_logs_invalid_since_date(self, auth_setup):
        """Invalid 'since' date format returns 400."""
        auth_client, org, _ = auth_setup
        resp = auth_client.get(_audit_logs_url(org) + "?since=not-a-date")
        assert resp.status_code in (400, 422)
        data = resp.get_json()
        assert "since" in (data.get("error").get("message", "") if isinstance(data.get("error"), dict) else (data.get("error") or str(data.get("detail", "")))).lower()

    def test_list_audit_logs_requires_auth(self, client, auth_setup):
        """Unauthenticated request returns 401."""
        _, org, _ = auth_setup
        resp = client.get(_audit_logs_url(org))
        assert resp.status_code == 401

    def test_list_audit_logs_viewer_denied(self, viewer_auth_setup):
        """Viewer role (no org.view_audit_logs) gets 403."""
        auth_client, org, _ = viewer_auth_setup
        resp = auth_client.get(_audit_logs_url(org))
        assert resp.status_code == 403


# ============================================================================
# GET /api/organizations/<org_id>/entity-audit-events
# ============================================================================

class TestGetEntityAuditEvents:
    def test_list_entity_events_empty(self, auth_setup):
        """When no entity audit events exist, returns empty list."""
        auth_client, org, _ = auth_setup
        resp = auth_client.get(_entity_events_url(org))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["items"] == []
        assert data["total"] == 0

    def test_list_entity_events_with_data(self, auth_setup, db_session):
        """Returns entity audit events when data exists."""
        auth_client, org, user = auth_setup
        event = _create_entity_audit_event(db_session, org, user)
        resp = auth_client.get(_entity_events_url(org))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1
        assert len(data["items"]) == 1
        entry = data["items"][0]
        assert entry["entity_type"] == "collection_object"
        assert entry["change_type"] == "created"
        assert entry["entity_display_key"] == "OBJ-001"

    def test_list_entity_events_invalid_change_type(self, auth_setup):
        """Invalid change_type query parameter returns 400."""
        auth_client, org, _ = auth_setup
        resp = auth_client.get(_entity_events_url(org) + "?change_type=invalid")
        assert resp.status_code in (400, 422)
        data = resp.get_json()
        assert "change_type" in (data.get("error").get("message", "") if isinstance(data.get("error"), dict) else (data.get("error") or str(data.get("detail", "")))).lower()

    def test_list_entity_events_requires_auth(self, client, auth_setup):
        """Unauthenticated request returns 401."""
        _, org, _ = auth_setup
        resp = client.get(_entity_events_url(org))
        assert resp.status_code == 401


# ============================================================================
# GET /api/organizations/<org_id>/entity-audit-events/<event_id>
# ============================================================================

class TestGetEntityAuditEventDetail:
    def test_get_event_detail(self, auth_setup, db_session):
        """Returns full event detail including field diffs."""
        auth_client, org, user = auth_setup
        event = _create_entity_audit_event(db_session, org, user)

        # Add a field diff
        diff = EntityAuditFieldDiff(
            event_id=event.event_id,
            organization_id=org.organization_id,
            field_name="title",
            old_value=None,
            new_value="New Title",
        )
        db_session.add(diff)
        db_session.commit()

        resp = auth_client.get(_entity_event_detail_url(org, event.event_id))
        assert resp.status_code == 200
        data = resp.get_json()["event"]
        assert data["event_id"] == str(event.event_id)
        assert data["entity_type"] == "collection_object"
        assert len(data["field_diffs"]) == 1
        assert data["field_diffs"][0]["field_name"] == "title"
        assert data["field_diffs"][0]["new_value"] == "New Title"

    def test_get_event_detail_not_found(self, auth_setup):
        """Non-existent event ID returns 404."""
        auth_client, org, _ = auth_setup
        fake_id = str(uuid.uuid4())
        resp = auth_client.get(_entity_event_detail_url(org, fake_id))
        assert resp.status_code == 404
        data = resp.get_json()
        assert "not found" in (data.get("error").get("message", "") if isinstance(data.get("error"), dict) else (data.get("error") or str(data.get("detail", "")))).lower()

    def test_get_event_detail_requires_auth(self, client, auth_setup):
        """Unauthenticated request returns 401."""
        _, org, _ = auth_setup
        fake_id = str(uuid.uuid4())
        resp = client.get(_entity_event_detail_url(org, fake_id))
        assert resp.status_code == 401
