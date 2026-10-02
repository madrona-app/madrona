"""Tests for DAM API endpoints (media_dam blueprint)."""

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from app.database import current_session
from app.models import (
    DerivativeSizeConfig,
    Media,
    MediaAnnotation,
)
from tests.conftest import _create_permission, _create_role_permission, _post_json, _put_json



def _create_media(db_session, org_id, **kwargs):
    """Create a Media record with sensible defaults."""
    defaults = dict(
        organization_id=org_id,
        s3_key=f"orgs/{org_id}/media/{uuid4()}/test.jpg",
        filename="test.jpg",
        file_size=1024,
        mime_type="image/jpeg",
        media_type="image",
        processing_status="completed",
    )
    defaults.update(kwargs)
    media = Media(**defaults)
    db_session.add(media)
    db_session.flush()
    return media


def _grant_media_perms(db_session, auth_setup, *perm_keys):
    """Grant additional media permissions to the auth_setup role."""
    from app.models import Role, RolePermission, OrganizationMembership

    _, org, user = auth_setup
    membership = db_session.query(OrganizationMembership).filter_by(
        user_id=user.user_id,
        organization_id=org.organization_id,
    ).first()
    role = db_session.query(Role).filter_by(role_id=membership.role_id).first()
    for key in perm_keys:
        perm = _create_permission(db_session, key)
        _create_role_permission(db_session, role, perm)
    db_session.commit()


# =============================================================================
# Download with Conversion
# =============================================================================

class TestDownloadConversion:
    """Tests for GET /organizations/<org_id>/media/<media_id>/download."""

    @patch("app.config.get_settings")
    @patch("app.services.uploads.get_media_bucket")
    @patch("app.services.uploads.get_s3_client")
    @patch("app.services.storage.get_storage_backend")
    def test_download_no_conversion_returns_presigned_url(
        self, mock_storage, mock_s3, mock_bucket, mock_settings, auth_setup, db_session
    ):
        auth_client, org, _ = auth_setup
        media = _create_media(db_session, org.organization_id)
        db_session.commit()

        mock_storage.return_value.get_object_sync.return_value = (b"fake", {})
        mock_s3.return_value.generate_presigned_url.return_value = "https://s3/presigned"
        mock_bucket.return_value = "test-bucket"
        mock_settings.return_value = MagicMock(s3_url_expiry_seconds=3600)

        url = f"/api/organizations/{org.organization_id}/media/{media.media_id}/download"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        assert "download_url" in resp.get_json()

    def test_download_media_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/media/{uuid4()}/download"
        resp = auth_client.get(url)
        assert resp.status_code == 404

    @patch("app.services.storage.get_storage_backend")
    def test_download_with_format_conversion(self, mock_storage, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        media = _create_media(db_session, org.organization_id)
        db_session.commit()

        # Create a simple image for conversion
        from PIL import Image
        import io
        img = Image.new("RGB", (10, 10), (128, 128, 128))
        buf = io.BytesIO()
        img.save(buf, format="JPEG")
        mock_storage.return_value.get_object_sync.return_value = (buf.getvalue(), {})

        url = f"/api/organizations/{org.organization_id}/media/{media.media_id}/download?format=png"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        assert resp.headers.get("content-type") == "image/png"


# =============================================================================
# Image Transform
# =============================================================================

class TestTransformImage:
    """Tests for POST /organizations/<org_id>/media/<media_id>/transform."""

    @patch("app.config.get_settings")
    @patch("app.services.uploads.get_media_bucket")
    @patch("app.services.uploads.get_s3_client")
    @patch("app.services.storage.get_storage_backend")
    def test_transform_basic(self, mock_storage, mock_s3, mock_bucket, mock_settings, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        media = _create_media(db_session, org.organization_id)
        db_session.commit()

        from PIL import Image
        import io
        img = Image.new("RGB", (100, 100), (128, 128, 128))
        buf = io.BytesIO()
        img.save(buf, format="JPEG")
        mock_storage.return_value.get_object_sync.return_value = (buf.getvalue(), {})
        mock_s3.return_value.generate_presigned_url.return_value = "https://s3/url"
        mock_bucket.return_value = "test-bucket"
        mock_settings.return_value = MagicMock(s3_url_expiry_seconds=3600)

        url = f"/api/organizations/{org.organization_id}/media/{media.media_id}/transform"
        resp = _post_json(auth_client, url, {"rotate": 90, "format": "jpeg"})
        assert resp.status_code == 200
        data = resp.get_json()
        assert "download_url" in data

    def test_transform_non_image_returns_400(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        media = _create_media(
            db_session, org.organization_id,
            media_type="video", mime_type="video/mp4", filename="test.mp4",
        )
        db_session.commit()

        url = f"/api/organizations/{org.organization_id}/media/{media.media_id}/transform"
        resp = _post_json(auth_client, url, {"rotate": 90})
        assert resp.status_code in (400, 422)

    def test_transform_media_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/media/{uuid4()}/transform"
        resp = _post_json(auth_client, url, {"rotate": 90})
        assert resp.status_code == 404


# =============================================================================
# Upload from URL
# =============================================================================

class TestUploadFromUrl:
    """Tests for POST /organizations/<org_id>/media/upload-from-url."""

    @patch("app.tasks.media.upload_from_url_task")
    def test_upload_from_url_success(self, mock_task, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        mock_task.delay.return_value = MagicMock(id="task-123")

        url = f"/api/organizations/{org.organization_id}/media/upload-from-url"
        resp = _post_json(auth_client, url, {"url": "https://example.com/image.jpg"})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["success"] is True
        assert data["task_id"] == "task-123"

    def test_upload_from_url_missing_url(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/media/upload-from-url"
        resp = _post_json(auth_client, url, {})
        assert resp.status_code in (400, 422)


# =============================================================================
# Annotations CRUD
# =============================================================================

class TestAnnotations:
    """Tests for annotation endpoints."""

    def test_create_annotation(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        media = _create_media(db_session, org.organization_id)
        db_session.commit()

        url = f"/api/organizations/{org.organization_id}/media/{media.media_id}/annotations"
        resp = _post_json(auth_client, url, {
            "target_selector": {"type": "FragmentSelector", "value": "xywh=10,10,50,50"},
            "body": {"value": "A note"},
            "motivation": "commenting",
        })
        assert resp.status_code == 201
        data = resp.get_json()
        assert "annotation_id" in data
        assert data["motivation"] == "commenting"

    def test_create_annotation_requires_target_selector(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        media = _create_media(db_session, org.organization_id)
        db_session.commit()

        url = f"/api/organizations/{org.organization_id}/media/{media.media_id}/annotations"
        resp = _post_json(auth_client, url, {"body": {"value": "note"}})
        assert resp.status_code in (400, 422)

    def test_list_annotations(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        media = _create_media(db_session, org.organization_id)
        ann = MediaAnnotation(
            media_id=media.media_id,
            organization_id=org.organization_id,
            target_selector={"type": "FragmentSelector"},
            body={"value": "test"},
            motivation="commenting",
        )
        db_session.add(ann)
        db_session.commit()

        url = f"/api/organizations/{org.organization_id}/media/{media.media_id}/annotations"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data["annotations"]) == 1

    def test_update_annotation(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        media = _create_media(db_session, org.organization_id)
        ann = MediaAnnotation(
            media_id=media.media_id,
            organization_id=org.organization_id,
            target_selector={"type": "FragmentSelector"},
            body={"value": "original"},
        )
        db_session.add(ann)
        db_session.commit()

        url = f"/api/organizations/{org.organization_id}/media/{media.media_id}/annotations/{ann.annotation_id}"
        resp = _put_json(auth_client, url, {"body": {"value": "updated"}})
        assert resp.status_code == 200
        assert resp.get_json()["body"]["value"] == "updated"

    def test_delete_annotation(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        media = _create_media(db_session, org.organization_id)
        ann = MediaAnnotation(
            media_id=media.media_id,
            organization_id=org.organization_id,
            target_selector={"type": "FragmentSelector"},
        )
        db_session.add(ann)
        db_session.commit()

        url = f"/api/organizations/{org.organization_id}/media/{media.media_id}/annotations/{ann.annotation_id}"
        resp = auth_client.delete(url)
        assert resp.status_code == 200
        assert resp.get_json()["success"] is True

    def test_delete_annotation_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        media = _create_media(db_session, org.organization_id)
        db_session.commit()

        url = f"/api/organizations/{org.organization_id}/media/{media.media_id}/annotations/{uuid4()}"
        resp = auth_client.delete(url)
        assert resp.status_code == 404


# =============================================================================
# Derivative Sizes
# =============================================================================

class TestDerivativeSizes:
    """Tests for derivative size configuration endpoints."""

    def test_list_derivative_sizes(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _grant_media_perms(db_session, auth_setup, "media.admin")
        config = DerivativeSizeConfig(
            organization_id=org.organization_id,
            name="small",
            label="Small (600px)",
            max_width=600,
            format="jpeg",
        )
        db_session.add(config)
        db_session.commit()

        url = f"/api/organizations/{org.organization_id}/media/derivative-sizes"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        assert len(resp.get_json()["derivative_sizes"]) == 1

    def test_create_derivative_size(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _grant_media_perms(db_session, auth_setup, "media.admin")

        url = f"/api/organizations/{org.organization_id}/media/derivative-sizes"
        resp = _post_json(auth_client, url, {
            "name": "medium",
            "label": "Medium",
            "max_width": 1200,
        })
        assert resp.status_code == 201

    def test_create_derivative_size_requires_name(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _grant_media_perms(db_session, auth_setup, "media.admin")

        url = f"/api/organizations/{org.organization_id}/media/derivative-sizes"
        resp = _post_json(auth_client, url, {"label": "oops"})
        assert resp.status_code in (400, 422)

    def test_delete_derivative_size(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _grant_media_perms(db_session, auth_setup, "media.admin")
        config = DerivativeSizeConfig(
            organization_id=org.organization_id,
            name="old",
            label="Old",
        )
        db_session.add(config)
        db_session.commit()

        url = f"/api/organizations/{org.organization_id}/media/derivative-sizes/{config.config_id}"
        resp = auth_client.delete(url)
        assert resp.status_code == 200


# =============================================================================
# Media Locking
# =============================================================================

class TestMediaLocking:
    """Tests for media lock/unlock endpoints."""

    def test_lock_media(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        media = _create_media(db_session, org.organization_id)
        db_session.commit()

        url = f"/api/organizations/{org.organization_id}/media/{media.media_id}/lock"
        resp = _post_json(auth_client, url, {})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["locked"] is True
        assert "expires_at" in data

    def test_unlock_media(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        media = _create_media(db_session, org.organization_id)
        db_session.commit()

        # Lock first
        url = f"/api/organizations/{org.organization_id}/media/{media.media_id}/lock"
        _post_json(auth_client, url, {})

        # Unlock
        resp = auth_client.delete(url)
        assert resp.status_code == 200
        assert resp.get_json()["locked"] is False

    def test_unlock_not_locked(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        media = _create_media(db_session, org.organization_id)
        db_session.commit()

        url = f"/api/organizations/{org.organization_id}/media/{media.media_id}/lock"
        resp = auth_client.delete(url)
        assert resp.status_code == 200
        assert resp.get_json()["locked"] is False

    def test_lock_already_locked_by_other_user_returns_409(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        media = _create_media(db_session, org.organization_id)

        from app.models import MediaLock, User

        other_user = User(
            email=f"other-{uuid4().hex[:8]}@example.com",
            password_hash="fakehash",
            status="active",
        )
        db_session.add(other_user)
        db_session.flush()

        lock = MediaLock(
            media_id=media.media_id,
            organization_id=org.organization_id,
            locked_by=other_user.user_id,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
        )
        db_session.add(lock)
        db_session.commit()

        url = f"/api/organizations/{org.organization_id}/media/{media.media_id}/lock"
        resp = _post_json(auth_client, url, {})
        assert resp.status_code == 409

    def test_lock_expired_lock_can_be_reacquired(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        media = _create_media(db_session, org.organization_id)

        from app.models import MediaLock, User

        other_user = User(
            email=f"other-{uuid4().hex[:8]}@example.com",
            password_hash="fakehash",
            status="active",
        )
        db_session.add(other_user)
        db_session.flush()

        lock = MediaLock(
            media_id=media.media_id,
            organization_id=org.organization_id,
            locked_by=other_user.user_id,
            expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),  # expired
        )
        db_session.add(lock)
        db_session.commit()

        url = f"/api/organizations/{org.organization_id}/media/{media.media_id}/lock"
        resp = _post_json(auth_client, url, {})
        assert resp.status_code == 200
        assert resp.get_json()["locked"] is True


# =============================================================================
# Embed Code
# =============================================================================

class TestEmbedCode:
    """Tests for GET /organizations/<org_id>/media/<media_id>/embed-code."""

    def test_get_embed_code(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        media = _create_media(db_session, org.organization_id)
        db_session.commit()

        url = f"/api/organizations/{org.organization_id}/media/{media.media_id}/embed-code"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert "embed_codes" in data
        assert "iframe" in data["embed_codes"]
        assert "url" in data["embed_codes"]
        assert str(media.media_id) in data["embed_codes"]["url"]

    def test_embed_code_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/media/{uuid4()}/embed-code"
        resp = auth_client.get(url)
        assert resp.status_code == 404
