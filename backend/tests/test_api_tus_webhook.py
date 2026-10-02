"""Tests for TUS upload webhook handler."""

from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest


TEST_HOOK_SECRET = "test-tus-hook-secret"


def _tus_post(client, url, data, secret=TEST_HOOK_SECRET):
    """POST JSON helper for TUS webhook tests.

    Sends the shared-secret header the handler requires; the webhook fails
    closed (503) when no secret is configured and 403 when it mismatches.
    """
    headers = {"X-Hook-Secret": secret} if secret is not None else {}
    return client.post(
        url,
        json=data,
        content_type="application/json",
        headers=headers,
    )


class TestTusUploadComplete:
    """Tests for POST /hooks/tus/complete."""

    @patch("app.fastapi_app.routers.media_tus_webhook.get_settings")
    def test_disabled_returns_404(self, mock_settings, client):
        mock_settings.return_value = MagicMock(tus_enabled=False)
        resp = _tus_post(client, "/hooks/tus/complete", {})
        assert resp.status_code == 404

    @patch("app.fastapi_app.routers.media_tus_webhook.get_settings")
    def test_missing_body_returns_400(self, mock_settings, client):
        """Empty POST body → 400 (global JSONDecodeError handler)."""
        mock_settings.return_value = MagicMock(tus_enabled=True, tus_webhook_secret=TEST_HOOK_SECRET)
        resp = client.post(
            "/hooks/tus/complete",
            data="",
            content_type="application/json",
            headers={"X-Hook-Secret": TEST_HOOK_SECRET},
        )
        assert resp.status_code == 400
        data = resp.get_json()
        assert data["error"]["code"] == "bad_request"

    @patch("app.fastapi_app.routers.media_tus_webhook.get_settings")
    def test_missing_organization_id_returns_400(self, mock_settings, client):
        mock_settings.return_value = MagicMock(tus_enabled=True, tus_webhook_secret=TEST_HOOK_SECRET)
        resp = _tus_post(client, "/hooks/tus/complete", {
            "Upload": {
                "MetaData": {"filename": "test.jpg"},
                "Storage": {"Path": "/tmp/upload"},
                "Size": 1024,
            },
        })
        assert resp.status_code in (400, 422)

    @patch("app.fastapi_app.routers.media_tus_webhook.os.path.exists", return_value=False)
    @patch("app.fastapi_app.routers.media_tus_webhook.get_settings")
    def test_file_not_found_returns_404(self, mock_settings, mock_exists, client):
        mock_settings.return_value = MagicMock(tus_enabled=True, tus_webhook_secret=TEST_HOOK_SECRET)
        org_id = str(uuid4())
        resp = _tus_post(client, "/hooks/tus/complete", {
            "Upload": {
                "MetaData": {"organization_id": org_id, "filename": "test.jpg"},
                "Storage": {"Path": "/tmp/missing"},
                "Size": 1024,
            },
        })
        assert resp.status_code == 404

    @patch("app.tasks.media.process_upload_task")
    @patch("app.services.uploads.generate_s3_key", return_value="orgs/x/media/test.jpg", create=True)
    @patch("app.services.uploads.detect_media_type", return_value="image")
    @patch("app.services.uploads.get_media_bucket", return_value="test-bucket")
    @patch("app.services.uploads.get_s3_client")
    @patch("app.fastapi_app.routers.media_tus_webhook.os.path.exists", return_value=True)
    @patch("app.fastapi_app.routers.media_tus_webhook.os.remove")
    # Patched in the handler's module, never builtins: replacing builtins.open
    # also replaces it for the standard library, and mimetypes.guess_type
    # reads the system mime.types on its first call in a process. Through a
    # mock that read never ends, so this test hung whenever it happened to be
    # the first to touch mimetypes — which is exactly what a CI shard does.
    @patch("app.fastapi_app.routers.media_tus_webhook.open", create=True)
    @patch("app.fastapi_app.routers.media_tus_webhook.get_settings")
    def test_complete_webhook_success(
        self, mock_settings, mock_open, mock_remove, mock_exists,
        mock_s3, mock_bucket, mock_detect, mock_key, mock_task,
        client, db_session,
    ):
        mock_settings.return_value = MagicMock(tus_enabled=True, tus_webhook_secret=TEST_HOOK_SECRET)
        mock_open.return_value.__enter__ = lambda s: MagicMock()
        mock_open.return_value.__exit__ = MagicMock(return_value=False)
        mock_task.delay.return_value = MagicMock(id="task-1")

        # Media.organization_id FKs to organizations; seed one so the commit succeeds.
        from app.models import Organization
        org = Organization(
            name="TUS Test Org",
            slug=f"tus-{uuid4().hex[:8]}",
            is_demo=False,
            status="active",
        )
        db_session.add(org)
        db_session.commit()

        resp = _tus_post(client, "/hooks/tus/complete", {
            "Upload": {
                "MetaData": {
                    "organization_id": str(org.organization_id),
                    "filename": "photo.jpg",
                    "title": "My Photo",
                },
                "Storage": {"Path": "/tmp/upload/abc123"},
                "Size": 2048,
            },
        })

        assert resp.status_code == 200
        data = resp.get_json()
        assert data["success"] is True
        assert "media_id" in data
        mock_task.delay.assert_called_once()

    @patch("app.fastapi_app.routers.media_tus_webhook.get_settings")
    def test_empty_storage_path_returns_404(self, mock_settings, client):
        mock_settings.return_value = MagicMock(tus_enabled=True, tus_webhook_secret=TEST_HOOK_SECRET)
        org_id = str(uuid4())
        resp = _tus_post(client, "/hooks/tus/complete", {
            "Upload": {
                "MetaData": {"organization_id": org_id, "filename": "test.jpg"},
                "Storage": {"Path": ""},
                "Size": 1024,
            },
        })
        assert resp.status_code == 404


class TestTusWebhookAuth:
    """The webhook fails closed: it must never accept unauthenticated,
    attacker-controlled upload metadata (guard added in 6f3e8f77)."""

    @patch("app.fastapi_app.routers.media_tus_webhook.get_settings")
    def test_unconfigured_secret_returns_503(self, mock_settings, client):
        mock_settings.return_value = MagicMock(tus_enabled=True, tus_webhook_secret=None)
        resp = _tus_post(client, "/hooks/tus/complete", {"Upload": {}})
        assert resp.status_code == 503

    @patch("app.fastapi_app.routers.media_tus_webhook.get_settings")
    def test_wrong_secret_returns_403(self, mock_settings, client):
        mock_settings.return_value = MagicMock(
            tus_enabled=True, tus_webhook_secret=TEST_HOOK_SECRET
        )
        resp = _tus_post(client, "/hooks/tus/complete", {"Upload": {}}, secret="wrong")
        assert resp.status_code == 403

    @patch("app.fastapi_app.routers.media_tus_webhook.get_settings")
    def test_missing_secret_header_returns_403(self, mock_settings, client):
        mock_settings.return_value = MagicMock(
            tus_enabled=True, tus_webhook_secret=TEST_HOOK_SECRET
        )
        resp = _tus_post(client, "/hooks/tus/complete", {"Upload": {}}, secret=None)
        assert resp.status_code == 403
