"""
Coverage-focused tests for app/fastapi_app/routers/media_library.py.

Targets routes and branches that existing tests
(test_api_media.py / test_api_media_dam.py / tests/postgres/test_collections_api.py)
do NOT exercise:

- processing-jobs list + stats aggregation
- processing-jobs/{id}/retry (happy, non-failed, not-found)
- processing-status per media (happy + not-found)
- list filters (media_type, folder, folder_id incl. 'unfiled',
  processing_status, is_published, search term)
- search (falls back to _database_media_search when OpenSearch disabled —
  the default in tests — plus filter branches)
- update validation: metadata size limit (422), dublin_core/IPTC merges,
  iptc_metadata editable-key filter
- delete (async cleanup path) returns success
- reindex: no-op when no media + service_unavailable (503) when OS off
- regenerate: rejects non-image (400)
- reprocess: rejects in-progress media (400)
- transcode: rejects non-video (400) and reports 503 when unavailable
- batch: validation errors + unknown operation + happy path (regenerate
  queued, delete clears rows)
- versions: list + upload new + restore
- 403 for viewer (MEDIA_EDIT-gated endpoints)
- wrong-org isolation: a media row in org A returns 404 for org B's caller

All external side effects (S3, Celery, OpenSearch) are mocked so the tests
stay hermetic. Test database is real Postgres.
"""

import io
import json
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from app.models import Media, MediaDerivative, MediaProcessingJob, MediaVersion


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_media(db_session, org_id, **overrides):
    defaults = dict(
        organization_id=org_id,
        s3_key=f"orgs/{org_id}/media/{uuid4().hex}.jpg",
        filename="shot.jpg",
        file_size=2048,
        mime_type="image/jpeg",
        media_type="image",
        processing_status="completed",
        title="Shot",
    )
    defaults.update(overrides)
    media = Media(**defaults)
    db_session.add(media)
    db_session.commit()
    return media


def _make_job(db_session, org_id, media_id, **overrides):
    defaults = dict(
        organization_id=org_id,
        media_id=media_id,
        job_type="derivatives",
        status="pending",
    )
    defaults.update(overrides)
    job = MediaProcessingJob(**defaults)
    db_session.add(job)
    db_session.commit()
    return job


def _grant_perm(db_session, auth_setup, perm_key):
    """Attach an extra permission to the auth_setup role for tests that hit
    endpoints gated by permissions that aren't in the default bundle (e.g.
    media.admin for /reindex)."""
    from tests.conftest import _create_permission, _create_role_permission
    from app.models import Role, OrganizationMembership, Permission as PermissionModel

    _, org, user = auth_setup
    membership = db_session.query(OrganizationMembership).filter_by(
        user_id=user.user_id,
        organization_id=org.organization_id,
    ).first()
    role = db_session.query(Role).filter_by(role_id=membership.role_id).first()
    existing = db_session.query(PermissionModel).filter_by(permission_key=perm_key).first()
    perm = existing or _create_permission(db_session, perm_key)
    _create_role_permission(db_session, role, perm)
    db_session.commit()


# ---------------------------------------------------------------------------
# Processing jobs
# ---------------------------------------------------------------------------


class TestProcessingJobs:
    def test_list_processing_jobs_empty(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/media/processing-jobs"
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["jobs"] == []
        assert data["total"] == 0
        for key in ("pending", "processing", "completed", "failed"):
            assert key in data["stats"]

    def test_list_processing_jobs_with_filters_and_stats(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        media = _make_media(db_session, org.organization_id)
        _make_job(db_session, org.organization_id, media.media_id, status="failed", job_type="derivatives")
        _make_job(db_session, org.organization_id, media.media_id, status="failed", job_type="transcode")
        _make_job(db_session, org.organization_id, media.media_id, status="completed", job_type="derivatives")
        _make_job(db_session, org.organization_id, media.media_id, status="pending", job_type="derivatives")

        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/media/processing-jobs?status=failed"
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 2
        for job in data["jobs"]:
            assert job["status"] == "failed"
        # Stats aggregate across *all* statuses, not just the filter
        assert data["stats"]["failed"] == 2
        assert data["stats"]["completed"] == 1
        assert data["stats"]["pending"] == 1

        # Filter by job_type
        resp2 = auth_client.get(
            f"/api/organizations/{org.organization_id}/media/processing-jobs?job_type=transcode"
        )
        assert resp2.status_code == 200
        data2 = resp2.get_json()
        assert data2["total"] == 1
        assert data2["jobs"][0]["job_type"] == "transcode"

    def test_retry_processing_job_happy_path(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        media = _make_media(db_session, org.organization_id, processing_status="failed")
        job = _make_job(
            db_session, org.organization_id, media.media_id,
            status="failed", error_message="boom",
        )

        with patch("app.tasks.media.process_upload_task") as mock_task:
            mock_task.delay = MagicMock()
            resp = auth_client.post(
                f"/api/organizations/{org.organization_id}/media/processing-jobs/{job.job_id}/retry"
            )

        assert resp.status_code == 200
        data = resp.get_json()
        assert data["success"] is True
        assert data["job_id"] == str(job.job_id)

        db_session.expire_all()
        refreshed = db_session.query(MediaProcessingJob).filter_by(job_id=job.job_id).first()
        assert refreshed.status == "pending"
        assert refreshed.error_message is None
        refreshed_media = db_session.query(Media).filter_by(media_id=media.media_id).first()
        assert refreshed_media.processing_status == "pending"

    def test_retry_processing_job_rejects_non_failed(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        media = _make_media(db_session, org.organization_id)
        job = _make_job(db_session, org.organization_id, media.media_id, status="completed")

        resp = auth_client.post(
            f"/api/organizations/{org.organization_id}/media/processing-jobs/{job.job_id}/retry"
        )
        assert resp.status_code == 400
        assert resp.get_json()["error"]["code"] == "bad_request"

    def test_retry_processing_job_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            f"/api/organizations/{org.organization_id}/media/processing-jobs/{uuid4()}/retry"
        )
        assert resp.status_code == 404
        assert resp.get_json()["error"]["code"] == "not_found"

    def test_processing_status_per_media(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        media = _make_media(db_session, org.organization_id, processing_status="processing")
        _make_job(db_session, org.organization_id, media.media_id, status="completed")
        _make_job(db_session, org.organization_id, media.media_id, status="processing")

        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/media/{media.media_id}/processing-status"
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["media_id"] == str(media.media_id)
        assert data["processing_status"] == "processing"
        assert len(data["jobs"]) == 2

    def test_processing_status_media_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/media/{uuid4()}/processing-status"
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# List filters
# ---------------------------------------------------------------------------


class TestListMediaFilters:
    @patch("app.serializers.media.get_org_media_url", return_value="https://s3/u")
    def test_filter_by_media_type(self, mock_url, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _make_media(db_session, org.organization_id, media_type="image", filename="a.jpg")
        _make_media(db_session, org.organization_id, media_type="video", filename="v.mp4",
                    mime_type="video/mp4")

        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/media?media_type=video"
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1
        assert data["items"][0]["filename"] == "v.mp4"

    @patch("app.serializers.media.get_org_media_url", return_value="https://s3/u")
    def test_filter_by_folder_and_unfiled(self, mock_url, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _make_media(db_session, org.organization_id, folder="exhibitions")
        _make_media(db_session, org.organization_id, folder=None)

        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/media?folder=exhibitions"
        )
        assert resp.status_code == 200
        assert resp.get_json()["total"] == 1

        resp2 = auth_client.get(
            f"/api/organizations/{org.organization_id}/media?folder_id=unfiled"
        )
        assert resp2.status_code == 200
        assert resp2.get_json()["total"] == 2  # folder_id.is_(None) matches both

    @patch("app.serializers.media.get_org_media_url", return_value="https://s3/u")
    def test_filter_by_is_published_and_processing_status(self, mock_url, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _make_media(db_session, org.organization_id, is_published=True)
        _make_media(db_session, org.organization_id, is_published=False,
                    processing_status="failed")

        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/media?is_published=true"
        )
        assert resp.status_code == 200
        assert resp.get_json()["total"] == 1

        resp2 = auth_client.get(
            f"/api/organizations/{org.organization_id}/media?processing_status=failed"
        )
        assert resp2.status_code == 200
        assert resp2.get_json()["total"] == 1

    @patch("app.serializers.media.get_org_media_url", return_value="https://s3/u")
    def test_list_search_ilike(self, mock_url, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _make_media(db_session, org.organization_id, title="Elephant photo", filename="ele.jpg")
        _make_media(db_session, org.organization_id, title="Lion portrait", filename="lion.jpg")

        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/media?search=elephant"
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1
        assert data["items"][0]["title"] == "Elephant photo"


# ---------------------------------------------------------------------------
# Search (DB fallback — OpenSearch disabled in tests)
# ---------------------------------------------------------------------------


class TestSearchMediaDatabaseFallback:
    @patch("app.serializers.media.get_org_media_url", return_value="https://s3/u")
    def test_search_db_fallback_basic(self, mock_url, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _make_media(db_session, org.organization_id, title="Seabird watercolor", creator="Audubon")
        _make_media(db_session, org.organization_id, title="Landscape oil", creator="Bierstadt")

        with patch("app.search.media.MediaSearchService.is_available", return_value=False):
            resp = auth_client.get(
                f"/api/organizations/{org.organization_id}/media/search?q=Audubon"
            )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1
        assert data["took_ms"] == 0  # DB path hard-codes 0
        assert data["hits"][0]["creator"] == "Audubon"

    @patch("app.serializers.media.get_org_media_url", return_value="https://s3/u")
    def test_search_falls_back_when_index_is_missing(self, mock_url, auth_setup, db_session):
        """OpenSearch up, index gone — serve the library, don't call it empty.

        is_available() only proves the server answers. When the read alias
        does not exist (never set up, or a reindex left it unpointed) the
        search used to be swallowed into zero hits, so the library looked
        empty and the workspace asset picker had nothing to offer. The only
        trace was a log line. Fall back to the database instead.
        """
        from opensearchpy.exceptions import NotFoundError

        auth_client, org, _ = auth_setup
        _make_media(db_session, org.organization_id, title="Seabird watercolor", creator="Audubon")

        with patch("app.search.media.MediaSearchService.is_available", return_value=True), patch(
            "app.search.media.MediaSearchService.search",
            side_effect=NotFoundError(404, "index_not_found_exception", "no such index"),
        ):
            resp = auth_client.get(
                f"/api/organizations/{org.organization_id}/media/search"
            )

        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1, "a missing index must not read as an empty library"
        assert data["hits"][0]["creator"] == "Audubon"

    @patch("app.serializers.media.get_org_media_url", return_value="https://s3/u")
    def test_search_db_fallback_filter_and_pagination(self, mock_url, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        for idx in range(4):
            _make_media(db_session, org.organization_id, title=f"pic {idx}",
                        copyright_status="public_domain")
        _make_media(db_session, org.organization_id, title="restricted",
                    copyright_status="rights_reserved")

        with patch("app.search.media.MediaSearchService.is_available", return_value=False):
            resp = auth_client.get(
                f"/api/organizations/{org.organization_id}/media/search"
                f"?copyright_status=public_domain&limit=2&offset=0"
            )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 4
        assert len(data["hits"]) == 2
        assert data["next_offset"] == 2

    @patch("app.serializers.media.get_org_media_url", return_value="https://s3/u")
    def test_search_db_fallback_unfiled_folder_id(self, mock_url, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _make_media(db_session, org.organization_id, title="a")
        _make_media(db_session, org.organization_id, title="b")

        with patch("app.search.media.MediaSearchService.is_available", return_value=False):
            resp = auth_client.get(
                f"/api/organizations/{org.organization_id}/media/search?folder_id=unfiled"
            )
        assert resp.status_code == 200
        assert resp.get_json()["total"] == 2


# ---------------------------------------------------------------------------
# Update validation and metadata paths
# ---------------------------------------------------------------------------


class TestUpdateMediaValidation:
    @patch("app.serializers.media.get_org_media_url", return_value="https://s3/u")
    def test_update_rejects_oversize_metadata(self, mock_url, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        media = _make_media(db_session, org.organization_id)
        # Build > 64KB of JSON content
        big_payload = {"metadata": {"blob": "x" * 80_000}}
        url = f"/api/organizations/{org.organization_id}/media/{media.media_id}"

        resp = auth_client.put(
            url,
            data=json.dumps(big_payload),
            content_type="application/json",
        )
        assert resp.status_code == 422
        assert resp.get_json()["error"]["code"] == "validation_error"

    @patch("app.serializers.media.get_org_media_url", return_value="https://s3/u")
    def test_update_dublin_core_mirrors_to_columns(self, mock_url, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        media = _make_media(db_session, org.organization_id, title="Old")
        url = f"/api/organizations/{org.organization_id}/media/{media.media_id}"

        body = {"dublin_core": {"dc_title": "New", "dc_creator": "Anon"}}
        resp = auth_client.put(url, data=json.dumps(body), content_type="application/json")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["title"] == "New"
        assert data["creator"] == "Anon"

        # Setting a dc_* key to None removes it from the merged dublin_core map
        resp2 = auth_client.put(
            url,
            data=json.dumps({"dublin_core": {"dc_creator": None}}),
            content_type="application/json",
        )
        assert resp2.status_code == 200

    @patch("app.serializers.media.get_org_media_url", return_value="https://s3/u")
    def test_update_iptc_metadata_filters_unknown_keys(self, mock_url, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        media = _make_media(db_session, org.organization_id)
        url = f"/api/organizations/{org.organization_id}/media/{media.media_id}"

        body = {"iptc_metadata": {
            "headline": "OK Headline",
            "not_allowed": "ignored",
        }}
        resp = auth_client.put(url, data=json.dumps(body), content_type="application/json")
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Delete path (async cleanup queued)
# ---------------------------------------------------------------------------


class TestDeleteMediaAsync:
    @patch("app.serializers.media.get_org_media_url", return_value="https://s3/u")
    def test_delete_queues_async_cleanup(self, mock_url, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        media = _make_media(db_session, org.organization_id,
                            thumbnail_s3_key="orgs/x/media/thumb.jpg")
        media_id = media.media_id

        with patch("app.tasks.media.cleanup_deleted_media") as mock_task:
            mock_task.delay = MagicMock()
            resp = auth_client.delete(
                f"/api/organizations/{org.organization_id}/media/{media_id}"
            )
            assert resp.status_code == 200
            assert resp.get_json()["success"] is True
            # Async cleanup receives thumbnail + s3 keys
            assert mock_task.delay.called

        assert db_session.query(Media).filter_by(media_id=media_id).first() is None

    def test_delete_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.delete(
            f"/api/organizations/{org.organization_id}/media/{uuid4()}"
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Reindex
# ---------------------------------------------------------------------------


class TestReindexMedia:
    def test_reindex_returns_503_when_search_unavailable(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _grant_perm(db_session, auth_setup, "media.admin")
        _make_media(db_session, org.organization_id)
        # Force search-unavailable rather than relying on ambient OpenSearch
        # being down (it isn't, wherever the dev/CI stack runs OpenSearch).
        with patch("app.search.media.MediaSearchService.is_available", return_value=False):
            resp = auth_client.post(
                f"/api/organizations/{org.organization_id}/media/reindex"
            )
        assert resp.status_code == 503
        assert resp.get_json()["error"]["code"] == "service_unavailable"

    def test_reindex_empty_org_short_circuits(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _grant_perm(db_session, auth_setup, "media.admin")
        with patch(
            "app.search.media.MediaSearchService.is_available", return_value=True
        ):
            resp = auth_client.post(
                f"/api/organizations/{org.organization_id}/media/reindex"
            )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 0
        assert data["indexed"] == 0


# ---------------------------------------------------------------------------
# Regenerate / Reprocess / Transcode — state-gated branches
# ---------------------------------------------------------------------------


class TestStateGatedTransitions:
    def test_regenerate_rejects_non_image(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        media = _make_media(
            db_session, org.organization_id, media_type="document",
            mime_type="application/pdf", filename="doc.pdf",
        )
        resp = auth_client.post(
            f"/api/organizations/{org.organization_id}/media/{media.media_id}/regenerate",
            data=json.dumps({}),
            content_type="application/json",
        )
        assert resp.status_code == 400
        assert "images" in resp.get_json()["error"]["message"].lower()

    def test_regenerate_happy_path_image(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        media = _make_media(db_session, org.organization_id, media_type="image")

        with patch("app.tasks.media.regenerate_derivatives_task") as mock_task:
            mock_task.delay = MagicMock()
            resp = auth_client.post(
                f"/api/organizations/{org.organization_id}/media/{media.media_id}/regenerate",
                data=json.dumps({"generate_webp": True}),
                content_type="application/json",
            )
        assert resp.status_code == 200
        assert resp.get_json()["success"] is True

    def test_reprocess_rejects_in_progress(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        media = _make_media(db_session, org.organization_id, processing_status="processing")
        resp = auth_client.post(
            f"/api/organizations/{org.organization_id}/media/{media.media_id}/reprocess"
        )
        assert resp.status_code == 400
        assert "currently being processed" in resp.get_json()["error"]["message"].lower()

    def test_reprocess_happy_path_image(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        media = _make_media(db_session, org.organization_id, processing_status="completed")

        with patch("app.tasks.media.process_upload_task") as mock_task:
            mock_task.delay = MagicMock()
            resp = auth_client.post(
                f"/api/organizations/{org.organization_id}/media/{media.media_id}/reprocess"
            )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["success"] is True
        assert data["media_type"] == "image"
        assert "features" in data

    def test_transcode_rejects_non_video(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        media = _make_media(db_session, org.organization_id, media_type="image")
        resp = auth_client.post(
            f"/api/organizations/{org.organization_id}/media/{media.media_id}/transcode",
            data=json.dumps({}),
            content_type="application/json",
        )
        assert resp.status_code == 400
        assert "videos" in resp.get_json()["error"]["message"].lower()

    def test_transcode_returns_503_when_unavailable(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        media = _make_media(
            db_session, org.organization_id, media_type="video",
            mime_type="video/mp4", filename="clip.mp4",
        )
        with patch(
            "app.services.video_transcoding.is_video_transcoding_available",
            return_value=False,
        ):
            resp = auth_client.post(
                f"/api/organizations/{org.organization_id}/media/{media.media_id}/transcode",
                data=json.dumps({}),
                content_type="application/json",
            )
        assert resp.status_code == 503


# ---------------------------------------------------------------------------
# Batch operations
# ---------------------------------------------------------------------------


class TestBatchOperations:
    def test_batch_missing_operation(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            f"/api/organizations/{org.organization_id}/media/batch",
            data=json.dumps({"media_ids": [str(uuid4())]}),
            content_type="application/json",
        )
        assert resp.status_code == 422
        assert resp.get_json()["error"]["code"] == "validation_error"

    def test_batch_missing_media_ids(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            f"/api/organizations/{org.organization_id}/media/batch",
            data=json.dumps({"operation": "delete", "media_ids": []}),
            content_type="application/json",
        )
        assert resp.status_code == 422

    def test_batch_invalid_operation(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        media = _make_media(db_session, org.organization_id)
        resp = auth_client.post(
            f"/api/organizations/{org.organization_id}/media/batch",
            data=json.dumps({
                "operation": "frobnicate",
                "media_ids": [str(media.media_id)],
            }),
            content_type="application/json",
        )
        assert resp.status_code == 400

    def test_batch_missing_ids_returns_404(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        media = _make_media(db_session, org.organization_id)
        missing_id = str(uuid4())
        resp = auth_client.post(
            f"/api/organizations/{org.organization_id}/media/batch",
            data=json.dumps({
                "operation": "regenerate",
                "media_ids": [str(media.media_id), missing_id],
            }),
            content_type="application/json",
        )
        assert resp.status_code == 404

    @patch("app.fastapi_app.routers.media_library.delete_org_media")
    def test_batch_delete_happy_path(self, mock_delete, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        m1 = _make_media(db_session, org.organization_id, filename="a.jpg")
        m2 = _make_media(db_session, org.organization_id, filename="b.jpg",
                         thumbnail_s3_key="thumbs/b.jpg")

        resp = auth_client.post(
            f"/api/organizations/{org.organization_id}/media/batch",
            data=json.dumps({
                "operation": "delete",
                "media_ids": [str(m1.media_id), str(m2.media_id)],
            }),
            content_type="application/json",
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["success"] is True
        assert data["operation"] == "delete"
        assert data["processed"] == 2
        # Both s3_key deletes and one thumbnail delete → 3 calls
        assert mock_delete.call_count == 3

    def test_batch_regenerate_queues(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        media = _make_media(db_session, org.organization_id, media_type="image")
        with patch("app.tasks.media.process_batch_task") as mock_task:
            mock_task.delay = MagicMock()
            resp = auth_client.post(
                f"/api/organizations/{org.organization_id}/media/batch",
                data=json.dumps({
                    "operation": "regenerate",
                    "media_ids": [str(media.media_id)],
                    "params": {"generate_webp": True},
                }),
                content_type="application/json",
            )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["queued"] == 1
        assert data["operation"] == "regenerate"


# ---------------------------------------------------------------------------
# Versions
# ---------------------------------------------------------------------------


class TestMediaVersions:
    def test_list_versions_empty(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        media = _make_media(db_session, org.organization_id)
        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/media/{media.media_id}/versions"
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["media_id"] == str(media.media_id)
        assert data["versions"] == []

    def test_list_versions_with_entries(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        media = _make_media(db_session, org.organization_id, current_version=2)
        v1 = MediaVersion(
            media_id=media.media_id,
            organization_id=org.organization_id,
            version_number=1,
            s3_key=media.s3_key,
            filename=media.filename,
            file_size=media.file_size,
            mime_type=media.mime_type,
            change_note="v1",
        )
        db_session.add(v1)
        db_session.commit()

        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/media/{media.media_id}/versions"
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data["versions"]) == 1
        assert data["current_version"] == 2

    @patch("app.fastapi_app.routers.media_library.upload_org_media",
           return_value=("orgs/new/media/v2.jpg", 4096))
    def test_upload_version_happy_path(self, mock_upload, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        media = _make_media(db_session, org.organization_id, current_version=1)

        data = {
            "file": (io.BytesIO(b"new bytes"), "replacement.jpg", "image/jpeg"),
            "change_note": "Color correction",
        }
        with patch("app.tasks.media.process_upload_task") as mock_task:
            mock_task.delay = MagicMock()
            resp = auth_client.post(
                f"/api/organizations/{org.organization_id}/media/{media.media_id}/versions",
                data=data,
                content_type="multipart/form-data",
            )

        assert resp.status_code == 201
        payload = resp.get_json()
        assert payload["success"] is True
        assert payload["version"] == 2

    def test_restore_version_happy_path(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        media = _make_media(db_session, org.organization_id, current_version=2)
        v1 = MediaVersion(
            media_id=media.media_id,
            organization_id=org.organization_id,
            version_number=1,
            s3_key="orgs/old/media/v1.jpg",
            filename="shot.jpg",
            file_size=1000,
            mime_type="image/jpeg",
            change_note="v1",
        )
        db_session.add(v1)
        db_session.commit()

        with patch("app.tasks.media.regenerate_derivatives_task") as mock_task:
            mock_task.delay = MagicMock()
            resp = auth_client.post(
                f"/api/organizations/{org.organization_id}/media/{media.media_id}"
                f"/versions/{v1.version_id}/restore"
            )
        assert resp.status_code == 200
        payload = resp.get_json()
        assert payload["success"] is True
        assert payload["restored_from_version"] == 1
        assert payload["new_version"] == 3  # current_version incremented

    def test_restore_version_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        media = _make_media(db_session, org.organization_id)
        resp = auth_client.post(
            f"/api/organizations/{org.organization_id}/media/{media.media_id}"
            f"/versions/{uuid4()}/restore"
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Permission enforcement: viewer → 403 on edit/delete routes
# ---------------------------------------------------------------------------


class TestViewerForbidden:
    def test_viewer_cannot_delete(self, viewer_auth_setup, db_session):
        viewer_client, org, _ = viewer_auth_setup
        media = _make_media(db_session, org.organization_id)
        resp = viewer_client.delete(
            f"/api/organizations/{org.organization_id}/media/{media.media_id}"
        )
        assert resp.status_code == 403

    def test_viewer_cannot_update(self, viewer_auth_setup, db_session):
        viewer_client, org, _ = viewer_auth_setup
        media = _make_media(db_session, org.organization_id)
        resp = viewer_client.put(
            f"/api/organizations/{org.organization_id}/media/{media.media_id}",
            data=json.dumps({"title": "x"}),
            content_type="application/json",
        )
        assert resp.status_code == 403

    def test_viewer_cannot_regenerate(self, viewer_auth_setup, db_session):
        viewer_client, org, _ = viewer_auth_setup
        media = _make_media(db_session, org.organization_id, media_type="image")
        resp = viewer_client.post(
            f"/api/organizations/{org.organization_id}/media/{media.media_id}/regenerate",
            data=json.dumps({}),
            content_type="application/json",
        )
        assert resp.status_code == 403

    def test_viewer_cannot_batch(self, viewer_auth_setup, db_session):
        viewer_client, org, _ = viewer_auth_setup
        media = _make_media(db_session, org.organization_id)
        resp = viewer_client.post(
            f"/api/organizations/{org.organization_id}/media/batch",
            data=json.dumps({
                "operation": "delete",
                "media_ids": [str(media.media_id)],
            }),
            content_type="application/json",
        )
        assert resp.status_code == 403

    def test_viewer_cannot_reindex(self, viewer_auth_setup):
        viewer_client, org, _ = viewer_auth_setup
        # media.admin is stricter than media.edit; viewer has neither
        resp = viewer_client.post(
            f"/api/organizations/{org.organization_id}/media/reindex"
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Wrong-org isolation
# ---------------------------------------------------------------------------


class TestWrongOrgIsolation:
    def test_get_with_mismatched_org_returns_404(self, auth_setup, db_session):
        """A media row tied to the caller's org but requested via a *different*
        org_id in the URL path must 404 (not leak).
        """
        auth_client, org, _ = auth_setup
        media = _make_media(db_session, org.organization_id)

        # The caller's JWT authorizes them in `org`, so requests with a
        # different org_id will fail the auth-tenant check before 404 logic.
        # Instead, seed a row whose organization_id is a random UUID and
        # request via the caller's org — the WHERE filter on organization_id
        # rules it out.
        from app.models import Organization
        other_org = Organization(
            name="Other", slug=f"other-{uuid4().hex[:6]}",
            is_demo=False, status="active",
        )
        db_session.add(other_org)
        db_session.commit()
        stranger = _make_media(db_session, other_org.organization_id, filename="s.jpg")

        # Same caller, their org, but the media belongs to another org.
        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/media/{stranger.media_id}"
        )
        assert resp.status_code == 404
