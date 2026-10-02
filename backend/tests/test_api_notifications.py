"""
Integration tests for the Notifications API.

Routes under /api/organizations/<org_id>/notifications.
"""

import json
from uuid import uuid4

import pytest

from app.models import Notification


def _make_notification(db_session, org_id, user_id, **overrides):
    """Helper to create a Notification row."""
    defaults = dict(
        organization_id=org_id,
        user_id=user_id,
        notification_type="comment",
        title="Test notification",
        message="You have a new comment",
        entity_type="object",
        entity_id=uuid4(),
        is_read=False,
    )
    defaults.update(overrides)
    notif = Notification(**defaults)
    db_session.add(notif)
    db_session.commit()
    return notif


# ── List ─────────────────────────────────────────────────────────────────


class TestListNotifications:
    def test_list_notifications_empty(self, auth_setup):
        auth_client, org, user = auth_setup
        url = f"/api/organizations/{org.organization_id}/notifications"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["items"] == []
        assert data["total"] == 0
        assert data["unread_count"] == 0
        assert data["has_more"] is False

    def test_list_notifications_with_data(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        n1 = _make_notification(db_session, org.organization_id, user.user_id, title="First")
        n2 = _make_notification(db_session, org.organization_id, user.user_id, title="Second")

        url = f"/api/organizations/{org.organization_id}/notifications"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 2
        assert len(data["items"]) == 2
        # Most recent first
        assert data["items"][0]["title"] == "Second"

    def test_list_notifications_unread_only(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        _make_notification(db_session, org.organization_id, user.user_id, is_read=True, title="Read")
        _make_notification(db_session, org.organization_id, user.user_id, is_read=False, title="Unread")

        url = f"/api/organizations/{org.organization_id}/notifications?unread_only=true"
        resp = auth_client.get(url)
        data = resp.get_json()
        assert data["total"] == 1
        assert data["items"][0]["title"] == "Unread"

    def test_list_notifications_pagination(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        for i in range(5):
            _make_notification(db_session, org.organization_id, user.user_id, title=f"N{i}")

        url = f"/api/organizations/{org.organization_id}/notifications?limit=2&offset=0"
        resp = auth_client.get(url)
        data = resp.get_json()
        assert len(data["items"]) == 2
        assert data["total"] == 5
        assert data["has_more"] is True


# ── Unread count ─────────────────────────────────────────────────────────


class TestUnreadCount:
    def test_unread_count(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        _make_notification(db_session, org.organization_id, user.user_id, is_read=False)
        _make_notification(db_session, org.organization_id, user.user_id, is_read=False)
        _make_notification(db_session, org.organization_id, user.user_id, is_read=True)

        url = f"/api/organizations/{org.organization_id}/notifications/unread-count"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        assert resp.get_json()["unread_count"] == 2


# ── Mark read ────────────────────────────────────────────────────────────


class TestMarkRead:
    def test_mark_notification_read(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        notif = _make_notification(db_session, org.organization_id, user.user_id)

        url = f"/api/organizations/{org.organization_id}/notifications/{notif.notification_id}/read"
        resp = auth_client.post(url)
        assert resp.status_code == 200
        assert resp.get_json()["success"] is True

        db_session.refresh(notif)
        assert notif.is_read is True
        assert notif.read_at is not None

    def test_mark_all_read(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        _make_notification(db_session, org.organization_id, user.user_id)
        _make_notification(db_session, org.organization_id, user.user_id)

        url = f"/api/organizations/{org.organization_id}/notifications/read-all"
        resp = auth_client.post(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["success"] is True
        assert data["marked_count"] == 2


# ── Delete ───────────────────────────────────────────────────────────────


class TestDeleteNotification:
    def test_delete_notification(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        notif = _make_notification(db_session, org.organization_id, user.user_id)
        notif_id = notif.notification_id

        url = f"/api/organizations/{org.organization_id}/notifications/{notif_id}"
        resp = auth_client.delete(url)
        assert resp.status_code == 200

        # Verify deleted
        assert db_session.query(Notification).filter_by(notification_id=notif_id).first() is None

    def test_delete_notification_not_found(self, auth_setup):
        auth_client, org, user = auth_setup
        url = f"/api/organizations/{org.organization_id}/notifications/{uuid4()}"
        resp = auth_client.delete(url)
        assert resp.status_code == 404


# ── Auth ─────────────────────────────────────────────────────────────────


class TestNotificationsAuth:
    def test_requires_auth(self, client, auth_setup):
        _, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/notifications"
        resp = client.get(url)
        assert resp.status_code == 401
