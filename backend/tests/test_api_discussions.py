"""
Integration tests for the Discussions API (record-bound comments and watches).

Routes under /api/organizations/<org_id>/records/<entity_type>/<entity_id>/comments
and /api/organizations/<org_id>/records/<entity_type>/<entity_id>/watch.

Mocks notification service so tests run against SQLite.
"""

import json
from unittest.mock import patch
from uuid import uuid4

import pytest

from app.models import RecordComment, RecordWatch


# A valid entity type from DISCUSSION_ENTITY_TYPES
ENTITY_TYPE = "collection_object"
# A fake entity_id to attach comments/watches to
ENTITY_ID = str(uuid4())


def _post_json(auth_client, url, data):
    """Helper for POST with JSON body."""
    return auth_client.post(url, data=json.dumps(data), content_type="application/json")


def _put_json(auth_client, url, data):
    """Helper for PUT with JSON body."""
    return auth_client.put(url, data=json.dumps(data), content_type="application/json")


def _comments_url(org, entity_type=ENTITY_TYPE, entity_id=ENTITY_ID):
    """Build the comments list/create URL."""
    return f"/api/organizations/{org.organization_id}/records/{entity_type}/{entity_id}/comments"


def _watch_url(org, entity_type=ENTITY_TYPE, entity_id=ENTITY_ID):
    """Build the watch status/toggle URL."""
    return f"/api/organizations/{org.organization_id}/records/{entity_type}/{entity_id}/watch"


# ============================================================================
# Comments - List
# ============================================================================


class TestListComments:
    def test_list_comments_empty(self, auth_setup):
        auth_client, org, _ = auth_setup
        url = _comments_url(org)
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["items"] == []
        assert data["total"] == 0
        assert data["has_more"] is False

    @patch("app.services.notification_service.notify_watchers_of_comment")
    def test_list_comments_with_data(self, mock_notify, auth_setup):
        auth_client, org, _ = auth_setup
        # Unique entity_id per run so the shared ENTITY_ID module constant
        # can't accumulate pollution across tests in a full-suite run.
        from uuid import uuid4 as _uuid4
        entity_id = str(_uuid4())
        url = f"/api/organizations/{org.organization_id}/records/{ENTITY_TYPE}/{entity_id}/comments"

        _post_json(auth_client, url, {"content": "First comment"})
        _post_json(auth_client, url, {"content": "Second comment"})

        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 2
        assert len(data["items"]) == 2
        # Assert both comments are present, not their order. Postgres `now()`
        # returns the same value for all rows in a single transaction, so
        # created_at ASC + random-UUID tiebreak isn't a reliable chronological
        # order under the test fixture's shared-connection pattern.
        contents = {c["content"] for c in data["items"]}
        assert contents == {"First comment", "Second comment"}

    @patch("app.services.notification_service.notify_watchers_of_comment")
    def test_list_comments_pagination(self, mock_notify, auth_setup):
        auth_client, org, _ = auth_setup
        url = _comments_url(org)

        for i in range(5):
            _post_json(auth_client, url, {"content": f"Comment {i}"})

        resp = auth_client.get(f"{url}?limit=2&offset=0")
        data = resp.get_json()
        assert len(data["items"]) == 2
        assert data["total"] == 5
        assert data["has_more"] is True
        assert data["limit"] == 2
        assert data["offset"] == 0

    def test_list_comments_invalid_entity_type(self, auth_setup):
        auth_client, org, _ = auth_setup
        url = _comments_url(org, entity_type="invalid_type")
        resp = auth_client.get(url)
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "Invalid entity type" in (_e.get("message", "") if isinstance(_e, dict) else str(_e))


# ============================================================================
# Comments - Create
# ============================================================================


class TestCreateComment:
    @patch("app.services.notification_service.notify_watchers_of_comment")
    def test_create_comment(self, mock_notify, auth_setup):
        auth_client, org, user = auth_setup
        url = _comments_url(org)
        resp = _post_json(auth_client, url, {"content": "Test comment"})
        assert resp.status_code == 201
        data = resp.get_json()
        comment = data["comment"]
        assert comment["content"] == "Test comment"
        assert comment["kind"] == "user"
        assert comment["entity_type"] == ENTITY_TYPE
        assert comment["entity_id"] == ENTITY_ID
        assert "comment_id" in comment
        assert comment["author"]["user_id"] == str(user.user_id)

    @patch("app.services.notification_service.notify_watchers_of_comment")
    def test_create_comment_system_kind(self, mock_notify, auth_setup):
        auth_client, org, _ = auth_setup
        url = _comments_url(org)
        resp = _post_json(auth_client, url, {"content": "Auto note", "kind": "system"})
        assert resp.status_code == 201
        assert resp.get_json()["comment"]["kind"] == "system"

    def test_create_comment_empty_content(self, auth_setup):
        auth_client, org, _ = auth_setup
        url = _comments_url(org)
        resp = _post_json(auth_client, url, {"content": ""})
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "required" in (_e.get("message", "") if isinstance(_e, dict) else str(_e)).lower()

    def test_create_comment_missing_content(self, auth_setup):
        auth_client, org, _ = auth_setup
        url = _comments_url(org)
        resp = _post_json(auth_client, url, {})
        assert resp.status_code in (400, 422)

    def test_create_comment_invalid_kind(self, auth_setup):
        auth_client, org, _ = auth_setup
        url = _comments_url(org)
        resp = _post_json(auth_client, url, {"content": "Test", "kind": "invalid"})
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "Invalid comment kind" in (_e.get("message", "") if isinstance(_e, dict) else str(_e))

    def test_create_comment_invalid_entity_type(self, auth_setup):
        auth_client, org, _ = auth_setup
        url = _comments_url(org, entity_type="bogus")
        resp = _post_json(auth_client, url, {"content": "Test"})
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "Invalid entity type" in (_e.get("message", "") if isinstance(_e, dict) else str(_e))


# ============================================================================
# Comments - Count
# ============================================================================


class TestCommentCount:
    @patch("app.services.notification_service.notify_watchers_of_comment")
    def test_comment_count(self, mock_notify, auth_setup):
        auth_client, org, _ = auth_setup
        entity_id = str(uuid4())
        url = _comments_url(org, entity_id=entity_id)
        count_url = f"{url}/count"

        # Initially zero
        resp = auth_client.get(count_url)
        assert resp.status_code == 200
        assert resp.get_json()["count"] == 0

        # Add two comments
        _post_json(auth_client, url, {"content": "One"})
        _post_json(auth_client, url, {"content": "Two"})

        resp = auth_client.get(count_url)
        assert resp.status_code == 200
        assert resp.get_json()["count"] == 2


# ============================================================================
# Comments - Export
# ============================================================================


class TestExportComments:
    @patch("app.services.notification_service.notify_watchers_of_comment")
    def test_export_comments(self, mock_notify, auth_setup):
        auth_client, org, _ = auth_setup
        entity_id = str(uuid4())
        url = _comments_url(org, entity_id=entity_id)
        export_url = f"{url}/export"

        _post_json(auth_client, url, {"content": "Exportable note"})

        resp = auth_client.get(export_url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total_count"] == 1
        assert data["comments"][0]["content"] == "Exportable note"
        assert "exported_at" in data
        assert "exported_by" in data
        assert data["record"]["entity_type"] == ENTITY_TYPE
        assert data["record"]["entity_id"] == entity_id


# ============================================================================
# Watch - Toggle
# ============================================================================


class TestWatchRecord:
    def test_watch_status_not_watching(self, auth_setup):
        auth_client, org, _ = auth_setup
        url = _watch_url(org)
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["watching"] is False
        assert data["watch_id"] is None

    def test_watch_then_check_status(self, auth_setup):
        auth_client, org, _ = auth_setup
        entity_id = str(uuid4())
        url = _watch_url(org, entity_id=entity_id)

        # Start watching
        resp = _post_json(auth_client, url, {})
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["watching"] is True
        assert "watch_id" in data

        # Check status
        resp = auth_client.get(url)
        assert resp.status_code == 200
        assert resp.get_json()["watching"] is True

    def test_watch_idempotent(self, auth_setup):
        auth_client, org, _ = auth_setup
        entity_id = str(uuid4())
        url = _watch_url(org, entity_id=entity_id)

        resp1 = _post_json(auth_client, url, {})
        assert resp1.status_code == 201
        watch_id = resp1.get_json()["watch_id"]

        # Second watch returns 200 (already watching) or 201 (idempotent
        # insert) with the same watch_id.
        resp2 = _post_json(auth_client, url, {})
        assert resp2.status_code in (200, 201)
        assert resp2.get_json()["watch_id"] == watch_id

    def test_unwatch_record(self, auth_setup):
        auth_client, org, _ = auth_setup
        entity_id = str(uuid4())
        url = _watch_url(org, entity_id=entity_id)

        # Watch first
        _post_json(auth_client, url, {})

        # Unwatch
        resp = auth_client.delete(url)
        assert resp.status_code == 200
        assert resp.get_json()["watching"] is False

        # Confirm not watching
        resp = auth_client.get(url)
        assert resp.get_json()["watching"] is False

    def test_unwatch_not_watching_returns_404(self, auth_setup):
        auth_client, org, _ = auth_setup
        entity_id = str(uuid4())
        url = _watch_url(org, entity_id=entity_id)

        resp = auth_client.delete(url)
        assert resp.status_code == 404
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        msg = (_e.get("message", "") if isinstance(_e, dict) else str(_e))
        assert "Not watching" in msg or "Watch not found" in msg


# ============================================================================
# Authorization
# ============================================================================


class TestDiscussionsAuth:
    def test_list_comments_requires_auth(self, client, auth_setup):
        _, org, _ = auth_setup
        url = _comments_url(org)
        resp = client.get(url)
        assert resp.status_code == 401

    def test_create_comment_requires_auth(self, client, auth_setup):
        _, org, _ = auth_setup
        url = _comments_url(org)
        resp = client.post(
            url,
            data=json.dumps({"content": "Unauthed"}),
            content_type="application/json",
        )
        assert resp.status_code == 401

    def test_watch_requires_auth(self, client, auth_setup):
        _, org, _ = auth_setup
        url = _watch_url(org)
        resp = client.get(url)
        assert resp.status_code == 401

    def test_export_requires_auth(self, client, auth_setup):
        _, org, _ = auth_setup
        url = f"{_comments_url(org)}/export"
        resp = client.get(url)
        assert resp.status_code == 401
