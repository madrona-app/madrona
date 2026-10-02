"""
Smoke tests for the Email Events API.

Routes under /api/email-events and /api/users/email-status.
These endpoints require PLATFORM_ADMIN permission and operate across
organizations for platform-wide email health monitoring.
"""

import json
from datetime import datetime, timezone
from unittest.mock import patch
from uuid import uuid4

import pytest

from app.models import EmailEvent, User


def _post_json(auth_client, url, data):
    """Helper for POST with JSON body."""
    return auth_client.post(url, data=json.dumps(data), content_type="application/json")


def _patch_json(auth_client, url, data):
    """Helper for PATCH with JSON body."""
    return auth_client.patch(url, data=json.dumps(data), content_type="application/json")


def _create_email_event(db_session, **overrides):
    """Create an EmailEvent in the database and return it."""
    defaults = {
        "email": "bounce@example.com",
        "event_type": "bounce",
        "bounce_type": "Permanent",
        "bounce_subtype": "General",
        "complaint_feedback_type": None,
        "message_id": f"msg-{uuid4()}",
        "sns_message_id": f"sns-{uuid4()}",
        "raw_message": {"notificationType": "Bounce"},
        "created_at": datetime.now(timezone.utc),
    }
    defaults.update(overrides)
    event = EmailEvent(**defaults)
    db_session.add(event)
    db_session.commit()
    return event


# ============================================================================
# List Email Events
# ============================================================================


class TestListEmailEvents:
    def test_list_email_events_empty(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get("/api/email-events")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["items"] == []
        assert data["total"] == 0
        assert data["limit"] == 50
        assert data["offset"] == 0

    def test_list_email_events_with_data(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup

        _create_email_event(db_session, email="user1@example.com", event_type="bounce")
        _create_email_event(db_session, email="user2@example.com", event_type="complaint",
                            complaint_feedback_type="abuse")

        resp = auth_client.get("/api/email-events")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 2
        assert len(data["items"]) == 2

    def test_list_email_events_filter_by_type(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup

        _create_email_event(db_session, email="a@example.com", event_type="bounce")
        _create_email_event(db_session, email="b@example.com", event_type="complaint",
                            complaint_feedback_type="abuse")

        resp = auth_client.get("/api/email-events?event_type=bounce")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1
        assert data["items"][0]["event_type"] == "bounce"

    def test_list_email_events_filter_by_email(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup

        _create_email_event(db_session, email="alice@example.com")
        _create_email_event(db_session, email="bob@example.com")

        resp = auth_client.get("/api/email-events?email=alice")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1
        assert "alice" in data["items"][0]["email"]

    def test_list_email_events_requires_auth(self, client):
        resp = client.get("/api/email-events")
        assert resp.status_code == 401


# ============================================================================
# Get Email Event by ID
# ============================================================================


class TestGetEmailEvent:
    def test_get_email_event_by_id(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup

        event = _create_email_event(db_session, email="detail@example.com",
                                    raw_message={"detail": "test"})

        resp = auth_client.get(f"/api/email-events/{event.event_id}")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["email"] == "detail@example.com"
        assert data["event_type"] == "bounce"
        assert data["raw_message"] == {"detail": "test"}
        assert data["sns_message_id"] is not None

    def test_get_email_event_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        fake_id = str(uuid4())
        resp = auth_client.get(f"/api/email-events/{fake_id}")
        assert resp.status_code == 404
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "not found" in (_e.get("message", "") if isinstance(_e, dict) else str(_e)).lower()

    def test_get_email_event_requires_auth(self, client):
        fake_id = str(uuid4())
        resp = client.get(f"/api/email-events/{fake_id}")
        assert resp.status_code == 401


# ============================================================================
# Email Stats
# ============================================================================


class TestEmailStats:
    def test_get_email_stats_empty(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get("/api/email-events/stats")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["last_30_days"]["bounces"] == 0
        assert data["last_30_days"]["complaints"] == 0
        assert data["last_30_days"]["total_events"] == 0
        assert "user_email_status" in data

    def test_get_email_stats_requires_auth(self, client):
        resp = client.get("/api/email-events/stats")
        assert resp.status_code == 401


# ============================================================================
# List Users by Email Status
# ============================================================================


class TestListUsersByEmailStatus:
    def test_list_users_email_status(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get("/api/users/email-status")
        assert resp.status_code == 200
        data = resp.get_json()
        # auth_setup creates one user, so we should have at least one
        assert "items" in data
        assert "total" in data
        assert data["total"] >= 1

    def test_list_users_email_status_requires_auth(self, client):
        resp = client.get("/api/users/email-status")
        assert resp.status_code == 401


# ============================================================================
# Update User Email Status
# ============================================================================


class TestUpdateUserEmailStatus:
    def test_update_user_email_status(self, auth_setup, db_session):
        auth_client, org, user = auth_setup

        resp = _patch_json(auth_client, f"/api/users/{user.user_id}/email-status",
                           {"email_status": "bounced"})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["email_status"] == "bounced"
        assert "bounced" in data["message"]

    def test_update_user_email_status_invalid_value(self, auth_setup, db_session):
        auth_client, org, user = auth_setup

        resp = _patch_json(auth_client, f"/api/users/{user.user_id}/email-status",
                           {"email_status": "invalid"})
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "Invalid" in (_e.get("message", "") if isinstance(_e, dict) else str(_e))

    def test_update_user_email_status_missing_field(self, auth_setup, db_session):
        auth_client, org, user = auth_setup

        resp = _patch_json(auth_client, f"/api/users/{user.user_id}/email-status", {})
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "required" in (_e.get("message", "") if isinstance(_e, dict) else str(_e)).lower()

    def test_update_user_email_status_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        fake_id = str(uuid4())
        resp = _patch_json(auth_client, f"/api/users/{fake_id}/email-status",
                           {"email_status": "active"})
        assert resp.status_code == 404

    def test_update_user_email_status_requires_auth(self, client):
        fake_id = str(uuid4())
        resp = client.patch(f"/api/users/{fake_id}/email-status",
                            data=json.dumps({"email_status": "active"}),
                            content_type="application/json")
        assert resp.status_code == 401


# ============================================================================
# Delete Email Event
# ============================================================================


class TestDeleteEmailEvent:
    def test_delete_email_event(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup

        event = _create_email_event(db_session, email="delete-me@example.com")
        event_id = str(event.event_id)

        resp = auth_client.delete(f"/api/email-events/{event_id}")
        assert resp.status_code == 200
        assert "deleted" in resp.get_json()["message"].lower()

        # Confirm it's gone
        resp = auth_client.get(f"/api/email-events/{event_id}")
        assert resp.status_code == 404

    def test_delete_email_event_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        fake_id = str(uuid4())
        resp = auth_client.delete(f"/api/email-events/{fake_id}")
        assert resp.status_code == 404


# ============================================================================
# Bulk Delete Email Events
# ============================================================================


class TestBulkDeleteEmailEvents:
    def test_bulk_delete_by_event_type(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup

        _create_email_event(db_session, email="a@example.com", event_type="bounce")
        _create_email_event(db_session, email="b@example.com", event_type="bounce")
        _create_email_event(db_session, email="c@example.com", event_type="complaint",
                            complaint_feedback_type="abuse")

        resp = _post_json(auth_client, "/api/email-events/bulk-delete",
                          {"event_type": "bounce"})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["deleted_count"] == 2

        # Verify complaint event remains
        resp = auth_client.get("/api/email-events")
        assert resp.get_json()["total"] == 1

    def test_bulk_delete_requires_filter_or_delete_all(self, auth_setup):
        auth_client, org, _ = auth_setup

        resp = _post_json(auth_client, "/api/email-events/bulk-delete", {})
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "filter" in (_e.get("message", "") if isinstance(_e, dict) else str(_e)).lower() or "delete_all" in resp.get_json()["error"].lower()

    def test_bulk_delete_requires_auth(self, client):
        resp = client.post("/api/email-events/bulk-delete",
                           data=json.dumps({"delete_all": True}),
                           content_type="application/json")
        assert resp.status_code == 401


# ============================================================================
# Permission Denied (viewer without platform.admin)
# ============================================================================


class TestEmailEventsPermissions:
    def test_list_events_denied_for_viewer(self, viewer_auth_setup):
        viewer_client, org, _ = viewer_auth_setup
        resp = viewer_client.get("/api/email-events")
        assert resp.status_code == 403
