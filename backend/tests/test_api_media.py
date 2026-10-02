"""
Integration tests for the Media API.

Routes under /api/organizations/<org_id>/media.
Mocks S3 uploads, Celery tasks, and OpenSearch indexing.
"""

import io
import json
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from app.models import Media


def _create_media_row(db_session, org_id, **overrides):
    """Helper to insert a Media row directly (bypasses upload logic)."""
    defaults = dict(
        organization_id=org_id,
        s3_key=f"orgs/{org_id}/media/{uuid4().hex}.jpg",
        filename="test.jpg",
        file_size=1024,
        mime_type="image/jpeg",
        media_type="image",
        processing_status="completed",
    )
    defaults.update(overrides)
    media = Media(**defaults)
    db_session.add(media)
    db_session.commit()
    return media


# Patches applied to most tests
_S3_PATCHES = {
    "upload": "app.fastapi_app.routers.media_library.upload_org_media",
    "delete": "app.fastapi_app.routers.media_library.delete_org_media",
    "url": "app.fastapi_app.routers.media_library.get_org_media_url",
}


# ============================================================================
# Upload
# ============================================================================


class TestUploadMedia:
    @patch("app.fastapi_app.routers.media_library.get_org_media_url", return_value="https://s3/thumb.jpg")
    @patch("app.fastapi_app.routers.media_library.upload_org_media", return_value=("orgs/test/media/img.jpg", 2048))
    @patch("app.fastapi_app.routers.media_library.detect_media_type")
    def test_upload_media_image(self, mock_detect, mock_upload, mock_url, auth_setup):
        from app.services.uploads import MediaType

        mock_detect.return_value = MediaType.IMAGE
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/media"

        data = {
            "file": (io.BytesIO(b"fake image data"), "photo.jpg", "image/jpeg"),
            "title": "My Photo",
        }
        # Patch the Celery task so it doesn't actually run
        with patch("app.tasks.media.process_upload_task", create=True) as mock_task:
            mock_task.delay = MagicMock()
            with patch("app.tasks.media.process_upload_task", mock_task, create=True):
                resp = auth_client.post(url, data=data, content_type="multipart/form-data")

        assert resp.status_code == 201
        result = resp.get_json()
        assert result["filename"] == "photo.jpg"
        assert result["media_type"] == "image"
        assert "media_id" in result

    def test_upload_media_missing_file(self, auth_setup):
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/media"
        resp = auth_client.post(url, content_type="multipart/form-data")
        assert resp.status_code in (400, 422)
        assert resp.get_json()["error"]["code"] == "bad_request"

    @patch("app.fastapi_app.routers.media_library.get_org_media_url", return_value="https://s3/thumb.jpg")
    @patch("app.fastapi_app.routers.media_library.upload_org_media")
    @patch("app.fastapi_app.routers.media_library.detect_media_type")
    def test_upload_exceeds_storage_limit(self, mock_detect, mock_upload, mock_url, auth_setup):
        from app.services.uploads import MediaType, StorageLimitExceeded

        mock_detect.return_value = MediaType.IMAGE
        mock_upload.side_effect = StorageLimitExceeded(
            message="Storage limit exceeded",
            used_bytes=900_000_000,
            limit_bytes=1_000_000_000,
            file_size=200_000_000,
        )
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/media"
        data = {"file": (io.BytesIO(b"data"), "huge.jpg", "image/jpeg")}
        resp = auth_client.post(url, data=data, content_type="multipart/form-data")
        assert resp.status_code == 413
        assert resp.get_json()["error"]["code"] == "STORAGE_LIMIT_EXCEEDED"


# ============================================================================
# List
# ============================================================================


class TestListMedia:
    @patch("app.fastapi_app.routers.media_library.get_org_media_url", return_value="https://s3/thumb.jpg")
    def test_list_media_empty(self, mock_url, auth_setup):
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/media"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["items"] == []
        assert data["total"] == 0

    @patch("app.fastapi_app.routers.media_library.get_org_media_url", return_value="https://s3/thumb.jpg")
    def test_list_media_with_data(self, mock_url, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _create_media_row(db_session, org.organization_id, title="Image A")
        _create_media_row(db_session, org.organization_id, title="Image B")

        url = f"/api/organizations/{org.organization_id}/media"
        resp = auth_client.get(url)
        data = resp.get_json()
        assert data["total"] == 2
        assert len(data["items"]) == 2

    @patch("app.fastapi_app.routers.media_library.get_org_media_url", return_value="https://s3/thumb.jpg")
    def test_list_media_pagination(self, mock_url, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        for i in range(5):
            _create_media_row(db_session, org.organization_id, title=f"Img {i}")

        url = f"/api/organizations/{org.organization_id}/media?page=1&page_size=2"
        resp = auth_client.get(url)
        data = resp.get_json()
        assert len(data["items"]) == 2
        assert data["total"] == 5
        assert data["total_pages"] == 3


# ============================================================================
# Get / Update / Delete single
# ============================================================================


class TestGetMedia:
    @patch("app.fastapi_app.routers.media_library.get_org_media_url", return_value="https://s3/thumb.jpg")
    def test_get_media_details(self, mock_url, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        media = _create_media_row(db_session, org.organization_id, title="Detail Shot")

        url = f"/api/organizations/{org.organization_id}/media/{media.media_id}"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["title"] == "Detail Shot"
        assert data["media_id"] == str(media.media_id)

    def test_get_media_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/media/{uuid4()}"
        resp = auth_client.get(url)
        assert resp.status_code == 404


class TestUpdateMedia:
    @patch("app.fastapi_app.routers.media_library.get_org_media_url", return_value="https://s3/thumb.jpg")
    def test_update_media_metadata(self, mock_url, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        media = _create_media_row(db_session, org.organization_id, title="Old Title")

        url = f"/api/organizations/{org.organization_id}/media/{media.media_id}"
        resp = auth_client.put(
            url,
            data=json.dumps({"title": "New Title", "description": "Updated"}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["title"] == "New Title"
        assert data["description"] == "Updated"


class TestDeleteMedia:
    @patch("app.fastapi_app.routers.media_library.delete_org_media")
    @patch("app.fastapi_app.routers.media_library.get_org_media_url", return_value="https://s3/thumb.jpg")
    def test_delete_media(self, mock_url, mock_delete, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        media = _create_media_row(db_session, org.organization_id)
        media_id = media.media_id

        url = f"/api/organizations/{org.organization_id}/media/{media_id}"
        resp = auth_client.delete(url)
        assert resp.status_code == 200

        # Verify deleted
        assert db_session.query(Media).filter_by(media_id=media_id).first() is None


# ============================================================================
# Auth
# ============================================================================


class TestMediaAuth:
    def test_requires_auth(self, client, auth_setup):
        _, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/media"
        # GET doesn't need multipart body and exercises the auth middleware directly.
        resp = client.get(url)
        assert resp.status_code == 401
