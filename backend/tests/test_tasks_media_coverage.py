"""
Coverage tests for app/tasks/media.py.

This is the single biggest coverage gap in the backend (1310 statements, ~9%
covered). These tests call each @celery_app.task function directly with
mocked external services (storage, MediaConvert, PIL, OpenSearch, publishing
APIs) so we exercise the orchestration, branching, and error-handling logic
without needing real S3, FFmpeg, or MediaConvert.

Pattern borrowed from test_tasks_whisper.py / test_tasks_ocr.py:
 * An autouse fixture patches `app.tasks.base.get_session` and
   `app.database.current_session` to return a MagicMock, so OrgTask's
   wrapper doesn't try to open a real DB session.
 * `set_task_rls_context` is patched to a no-op.
 * Tasks are invoked as plain function calls — `task_fn(args)` — which still
   runs the celery Task.__call__ wrapper (auto-wired when the decorator is
   applied). This is the same pattern the whisper/ocr suites use.

Tests focus on pure orchestration: correct services are called, DB fields
mutated on the mock session's objects, return values shaped correctly,
exceptions propagated (not caught) on final retry, etc.

If a test exposes a real bug (e.g. missing imports), the assertion captures
that — we do NOT skip or work around real defects.
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, PropertyMock, patch
from uuid import UUID, uuid4

import pytest


# ---------------------------------------------------------------------------
# Shared mock session + autouse patching
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_session():
    """A MagicMock that behaves like a SQLAlchemy session for our purposes."""
    s = MagicMock(name="session")
    # Common chained-query default: filter_by(...).first() returns None unless
    # a test rewires it.
    s.query.return_value.filter_by.return_value.first.return_value = None
    s.query.return_value.filter.return_value.first.return_value = None
    s.query.return_value.filter.return_value.all.return_value = []
    s.query.return_value.filter_by.return_value.all.return_value = []
    s.query.return_value.all.return_value = []
    s.query.return_value.filter.return_value.scalar.return_value = 0
    return s


@pytest.fixture(autouse=True)
def _patch_task_infra(mock_session):
    """Replace the task base's session machinery with our mock."""

    @contextmanager
    def _fake_get_session():
        yield mock_session

    with patch("app.tasks.base.get_session", _fake_get_session), \
         patch("app.database.current_session", return_value=mock_session), \
         patch("app.tasks.media.current_session", return_value=mock_session), \
         patch("app.tasks.rls_helpers.set_task_rls_context"):
        yield


# ---------------------------------------------------------------------------
# Test helpers
# ---------------------------------------------------------------------------


def _media_stub(**overrides):
    """Build a Media-ish MagicMock with sane default attributes."""
    defaults = dict(
        media_id=uuid4(),
        organization_id=uuid4(),
        media_type="image",
        mime_type="image/jpeg",
        filename="photo.jpg",
        s3_key="orgs/x/media/images/photo.jpg",
        file_size=1024,
        processing_status="pending",
        technical_metadata=None,
        iptc_metadata=None,
        xmp_metadata=None,
        dublin_core=None,
        inherited_metadata=None,
        thumbnail_s3_key=None,
        width=None,
        height=None,
        duration_seconds=None,
        page_count=None,
        checksum_sha256=None,
        dominant_colors=None,
        color_key=None,
        is_published=False,
        published_at=None,
        is_deleted=False,
        deleted_at=None,
        deleted_by=None,
        title=None,
        description=None,
        # Format-identification fields default to None so a stub that
        # never had them set doesn't surface a MagicMock auto-attr in
        # tests that assert "still None after no-match".
        pronom_puid=None,
        format_name=None,
        format_risk_level=None,
    )
    defaults.update(overrides)
    m = MagicMock(**defaults)
    # Make sure direct attribute access returns the initial values even after
    # .configure_mock interactions; MagicMock(**kwargs) already handles this.
    return m


def _job_stub(**overrides):
    defaults = dict(
        job_id=uuid4(),
        media_id=uuid4(),
        organization_id=uuid4(),
        job_type="derivatives",
        status="pending",
        parameters=None,
        result=None,
        error_message=None,
        retry_count=0,
        celery_task_id=None,
        started_at=None,
        completed_at=None,
        created_at=datetime.now(timezone.utc),
    )
    defaults.update(overrides)
    return MagicMock(**defaults)


def _rig_query_first(mock_session, *returns):
    """Program a sequence of return values for `.query(...).filter_by(...).first()`.

    Each call to filter_by(...).first() returns the next value in ``returns``.
    """
    iterator = iter(returns)

    def _first_side_effect(*_args, **_kwargs):
        try:
            return next(iterator)
        except StopIteration:
            return None

    mock_session.query.return_value.filter_by.return_value.first.side_effect = _first_side_effect


# ===========================================================================
# process_upload_task
# ===========================================================================


class TestProcessUploadTask:

    def test_media_not_found_returns_error(self, mock_session):
        """When the Media lookup returns None, the task exits early with a
        helpful error dict rather than crashing."""
        from app.tasks.media import process_upload_task

        mock_session.query.return_value.filter_by.return_value.first.return_value = None
        result = process_upload_task(str(uuid4()), str(uuid4()))

        assert result == {"success": False, "error": "Media not found"}

    def test_video_media_queues_transcoding_when_available(self, mock_session):
        from app.tasks.media import process_upload_task

        media = _media_stub(media_type="video")
        _rig_query_first(mock_session, media, None)  # Media then MediaProcessingJob

        with patch("app.services.video_transcoding.is_video_transcoding_available",
                   return_value=True), \
             patch("app.services.derivative_config.get_derivative_specs",
                   return_value=None), \
             patch("app.tasks.media.transcode_video_task") as mock_transcode:
            mock_transcode.delay = MagicMock()
            media_id = str(uuid4())
            org_id = str(uuid4())
            result = process_upload_task(media_id, org_id)

        assert result["success"] is True
        assert "queued" in result["message"].lower()
        assert media.processing_status == "transcoding"
        mock_transcode.delay.assert_called_once()
        kwargs = mock_transcode.delay.call_args.kwargs
        assert kwargs["extract_poster"] is True
        assert "web_mp4_1080p" in kwargs["derivatives"]

    def test_video_media_fails_when_transcoding_unavailable(self, mock_session):
        from app.tasks.media import process_upload_task

        media = _media_stub(media_type="video")
        _rig_query_first(mock_session, media, None)

        with patch("app.services.video_transcoding.is_video_transcoding_available",
                   return_value=False):
            result = process_upload_task(str(uuid4()), str(uuid4()))

        assert result["success"] is False
        assert "MEDIACONVERT_ROLE_ARN" in result["error"]
        assert media.processing_status == "failed"

    def test_video_media_uses_db_specs_when_present(self, mock_session):
        from app.tasks.media import process_upload_task

        media = _media_stub(media_type="video")
        _rig_query_first(mock_session, media, None)
        spec = SimpleNamespace(name="poster", label="Poster", max_width=800,
                               max_height=600, config={}, quality=85,
                               sort_order=0, format="jpeg")
        codec_spec = SimpleNamespace(name="web_mp4_1080p", label="1080p",
                                     max_width=1920, max_height=1080,
                                     config={"codec": "h264"}, quality=85,
                                     sort_order=1, format="mp4")

        with patch("app.services.video_transcoding.is_video_transcoding_available",
                   return_value=True), \
             patch("app.services.derivative_config.get_derivative_specs",
                   return_value=[spec, codec_spec]), \
             patch("app.services.video_transcoding.specs_to_video_derivatives",
                   return_value=[codec_spec]), \
             patch("app.tasks.media.transcode_video_task") as mock_transcode:
            mock_transcode.delay = MagicMock()
            result = process_upload_task(str(uuid4()), str(uuid4()))

        assert result["success"] is True
        kwargs = mock_transcode.delay.call_args.kwargs
        assert "web_mp4_1080p" in kwargs["derivatives"]
        assert kwargs["extract_poster"] is True

    def test_document_media_success_path(self, mock_session):
        from app.tasks.media import process_upload_task

        media = _media_stub(media_type="document", mime_type="application/pdf")
        _rig_query_first(mock_session, media, None)

        storage = MagicMock()
        storage.get_object_sync.return_value = (b"%PDF-1.4 fake bytes", {})

        doc_result = {
            "page_count": 3,
            "checksum_sha256": "abc" * 20 + "abcd",
            "technical_metadata": {"producer": "LaTeX"},
            "dublin_core": {"dc_title": "Doc"},
            "thumbnail_s3_key": "orgs/x/media/derivatives/doc/thumb.jpeg",
            "derivatives": [{"derivative_type": "thumbnail", "format": "jpeg"}],
        }

        with patch("app.services.storage.get_storage_backend", return_value=storage), \
             patch("app.services.document_processing.process_document_upload",
                   return_value=doc_result), \
             patch("app.tasks.preservation.record_preservation_event"), \
             patch("app.tasks.media._identify_format_at_ingest"), \
             patch("app.search.media.MediaSearchService.is_available", return_value=False), \
             patch("app.tasks.ai_tagging.process_media_ai_tags") as mock_ai, \
             patch("app.config.get_settings",
                   # ai_tagging_enabled is what actually gates the dispatch this
                   # test asserts. It was missing, so reading it raised
                   # AttributeError inside the task's broad "don't block on it"
                   # except, the step was recorded as skipped, and delay() was
                   # never called.
                   return_value=SimpleNamespace(ocr_enabled=False,
                                                ai_tagging_enabled=True)):
            mock_ai.delay = MagicMock()
            result = process_upload_task(str(uuid4()), str(uuid4()))

        assert result["success"] is True
        assert result["page_count"] == 3
        assert result["derivatives_generated"] == 1
        assert media.processing_status == "completed"
        assert media.page_count == 3
        mock_ai.delay.assert_called_once()

    def test_document_media_queues_ocr_when_enabled(self, mock_session):
        from app.tasks.media import process_upload_task

        media = _media_stub(media_type="document", mime_type="application/pdf")
        _rig_query_first(mock_session, media, None)

        storage = MagicMock()
        storage.get_object_sync.return_value = (b"fake", {})
        doc_result = {
            "page_count": 1, "checksum_sha256": "x",
            "technical_metadata": {}, "dublin_core": {},
            "thumbnail_s3_key": None, "derivatives": [],
        }

        with patch("app.services.storage.get_storage_backend", return_value=storage), \
             patch("app.services.document_processing.process_document_upload",
                   return_value=doc_result), \
             patch("app.tasks.preservation.record_preservation_event"), \
             patch("app.tasks.media._identify_format_at_ingest"), \
             patch("app.search.media.MediaSearchService.is_available", return_value=False), \
             patch("app.tasks.ai_tagging.process_media_ai_tags"), \
             patch("app.config.get_settings",
                   return_value=SimpleNamespace(ocr_enabled=True)), \
             patch("app.tasks.ocr.process_media_ocr_task") as mock_ocr:
            mock_ocr.delay = MagicMock()
            process_upload_task(str(uuid4()), str(uuid4()))

        mock_ocr.delay.assert_called_once()

    def test_audio_media_success_path(self, mock_session):
        from app.tasks.media import process_upload_task

        media = _media_stub(media_type="audio", mime_type="audio/mpeg")
        _rig_query_first(mock_session, media, None)

        storage = MagicMock()
        storage.get_object_sync.return_value = (b"id3 bytes", {})
        audio_result = {
            "duration_seconds": 180,
            "checksum_sha256": "h" * 64,
            "technical_metadata": {"codec": "mp3"},
            "dublin_core": {},
        }

        with patch("app.services.storage.get_storage_backend", return_value=storage), \
             patch("app.services.audio_processing.process_audio_upload",
                   return_value=audio_result), \
             patch("app.tasks.preservation.record_preservation_event"), \
             patch("app.tasks.media._identify_format_at_ingest"), \
             patch("app.search.media.MediaSearchService.is_available", return_value=False):
            result = process_upload_task(str(uuid4()), str(uuid4()))

        assert result["success"] is True
        assert result["duration_seconds"] == 180
        assert media.processing_status == "completed"

    def test_unknown_media_type_skips_processing(self, mock_session):
        """Types other than image/video/audio/document get a noop
        completion (defensive path for future additions)."""
        from app.tasks.media import process_upload_task

        media = _media_stub(media_type="unknown_type")
        _rig_query_first(mock_session, media, None)

        result = process_upload_task(str(uuid4()), str(uuid4()))
        assert result["success"] is True
        assert "skipping derivatives" in result["message"]
        assert media.processing_status == "completed"

    def test_image_happy_path_updates_record_and_creates_derivatives(self, mock_session):
        from app.tasks.media import process_upload_task

        media = _media_stub(media_type="image")
        _rig_query_first(mock_session, media, None)
        # When the task queries for *existing* derivatives during "create_records",
        # return None so every derivative is freshly created.
        # (_rig_query_first iterator will be exhausted; side_effect returns None.)

        storage = MagicMock()
        storage.get_object_sync.return_value = (b"JPEGBYTES", {})

        proc_result = {
            "width": 1024,
            "height": 768,
            "checksum_sha256": "c" * 64,
            "technical_metadata": {"camera_make": "Canon"},
            "iptc_metadata": {"headline": "Test"},
            "xmp_metadata": {},
            "dublin_core": {"dc_title": "Photo"},
            "derivatives": [
                {"derivative_type": "thumbnail", "format": "jpeg",
                 "s3_key": "thumb.jpg", "width": 200, "height": 200,
                 "file_size": 5000, "quality": 85},
                {"derivative_type": "square_thumb", "format": "jpeg",
                 "s3_key": "square.jpg", "width": 200, "height": 200,
                 "file_size": 4800, "quality": 85},
            ],
        }

        with patch("app.services.storage.get_storage_backend", return_value=storage), \
             patch("app.services.media_processing.process_image_upload",
                   return_value=proc_result), \
             patch("app.tasks.preservation.record_preservation_event"), \
             patch("app.tasks.media._identify_format_at_ingest"), \
             patch("app.services.color_extraction.extract_dominant_colors",
                   return_value=[{"hex": "#FF0000", "percentage": 0.4}]), \
             patch("app.services.color_extraction._generate_color_key",
                   return_value="RRRRR"), \
             patch("app.search.media.MediaSearchService.is_available", return_value=False), \
             patch("app.tasks.ai_tagging.process_media_ai_tags"), \
             patch("app.config.get_settings",
                   return_value=SimpleNamespace(clip_enabled=False, ocr_enabled=False)):
            result = process_upload_task(str(uuid4()), str(uuid4()))

        assert result["success"] is True
        assert result["derivatives_generated"] == 2
        assert result["width"] == 1024
        assert result["height"] == 768
        assert media.processing_status == "completed"
        assert media.width == 1024
        assert media.checksum_sha256 == "c" * 64
        # Thumbnail priority: prefers "thumbnail" over "square_thumb".
        assert media.thumbnail_s3_key == "thumb.jpg"
        # At least one MediaDerivative was added.
        assert mock_session.add.called

    def test_image_color_extraction_failure_does_not_abort_task(self, mock_session):
        """Dominant color extraction is best-effort; a failure logs and moves on."""
        from app.tasks.media import process_upload_task

        media = _media_stub(media_type="image")
        _rig_query_first(mock_session, media, None)

        storage = MagicMock()
        storage.get_object_sync.return_value = (b"JPEG", {})

        proc_result = {
            "width": 100, "height": 100, "checksum_sha256": "x",
            "technical_metadata": {}, "iptc_metadata": {},
            "xmp_metadata": {}, "dublin_core": {}, "derivatives": [],
        }

        with patch("app.services.storage.get_storage_backend", return_value=storage), \
             patch("app.services.media_processing.process_image_upload",
                   return_value=proc_result), \
             patch("app.tasks.preservation.record_preservation_event"), \
             patch("app.tasks.media._identify_format_at_ingest"), \
             patch("app.services.color_extraction.extract_dominant_colors",
                   side_effect=RuntimeError("PIL missing")), \
             patch("app.search.media.MediaSearchService.is_available", return_value=False), \
             patch("app.tasks.ai_tagging.process_media_ai_tags"), \
             patch("app.config.get_settings",
                   return_value=SimpleNamespace(clip_enabled=False, ocr_enabled=False)):
            result = process_upload_task(str(uuid4()), str(uuid4()))

        assert result["success"] is True
        # Color never set because of the exception
        assert media.color_key is None

    def test_image_triggers_clip_when_enabled(self, mock_session):
        from app.tasks.media import process_upload_task

        media = _media_stub(media_type="image")
        _rig_query_first(mock_session, media, None)

        storage = MagicMock()
        storage.get_object_sync.return_value = (b"JPEG", {})

        proc_result = {
            "width": 100, "height": 100, "checksum_sha256": "y",
            "technical_metadata": {}, "iptc_metadata": {},
            "xmp_metadata": {}, "dublin_core": {}, "derivatives": [],
        }

        with patch("app.services.storage.get_storage_backend", return_value=storage), \
             patch("app.services.media_processing.process_image_upload",
                   return_value=proc_result), \
             patch("app.tasks.preservation.record_preservation_event"), \
             patch("app.tasks.media._identify_format_at_ingest"), \
             patch("app.services.color_extraction.extract_dominant_colors",
                   return_value=[]), \
             patch("app.services.color_extraction._generate_color_key",
                   return_value="00000"), \
             patch("app.search.media.MediaSearchService.is_available", return_value=False), \
             patch("app.tasks.ai_tagging.process_media_ai_tags"), \
             patch("app.config.get_settings",
                   return_value=SimpleNamespace(clip_enabled=True, ocr_enabled=False)), \
             patch("app.tasks.clip.generate_clip_embedding") as mock_clip:
            mock_clip.delay = MagicMock()
            process_upload_task(str(uuid4()), str(uuid4()))

        mock_clip.delay.assert_called_once()

    def test_exception_propagates_and_marks_job_failed(self, mock_session):
        from app.tasks.media import process_upload_task

        media = _media_stub(media_type="image")
        job = _job_stub()
        # Two outer queries (media, job), then the second media lookup in the
        # except-block; give us the media and then the job record there.
        _rig_query_first(mock_session, media, None, media, job)

        storage = MagicMock()
        storage.get_object_sync.return_value = (b"bytes", {})

        with patch("app.services.storage.get_storage_backend", return_value=storage), \
             patch("app.services.media_processing.process_image_upload",
                   side_effect=ValueError("bad PIL")), \
             patch("app.tasks.preservation.record_preservation_event"):
            with pytest.raises(ValueError, match="bad PIL"):
                process_upload_task(str(uuid4()), str(uuid4()))


# ===========================================================================
# upload_from_url_task
# ===========================================================================


class TestUploadFromUrlTask:

    def test_downloads_and_creates_media_record(self, mock_session):
        from app.tasks.media import upload_from_url_task

        fake_resp = MagicMock()
        fake_resp.headers = {
            "Content-Disposition": 'attachment; filename="cat.jpg"',
            "Content-Type": "image/jpeg",
        }
        fake_resp.iter_content = lambda chunk_size: [b"CAT" * 100]
        fake_resp.raise_for_status = MagicMock()

        s3_client = MagicMock()

        with patch("requests.get", return_value=fake_resp), \
             patch("app.services.uploads.detect_media_type", return_value="image"), \
             patch("app.services.uploads.get_s3_client", return_value=s3_client), \
             patch("app.services.uploads.get_media_bucket", return_value="bucket"), \
             patch("app.services.uploads.generate_s3_key",
                   return_value="orgs/x/media/cat.jpg"), \
             patch("app.tasks.media.process_upload_task") as mock_proc:
            mock_proc.delay = MagicMock()
            org_id = str(uuid4())
            result = upload_from_url_task("https://example.com/cat.jpg", org_id)

        assert result["success"] is True
        assert result["filename"] == "cat.jpg"
        s3_client.upload_fileobj.assert_called_once()
        mock_proc.delay.assert_called_once()

    def test_derives_filename_from_url_when_missing_disposition(self, mock_session):
        from app.tasks.media import upload_from_url_task

        fake_resp = MagicMock()
        fake_resp.headers = {"Content-Type": "application/octet-stream"}
        fake_resp.iter_content = lambda chunk_size: [b"x" * 10]
        fake_resp.raise_for_status = MagicMock()

        with patch("requests.get", return_value=fake_resp), \
             patch("app.services.uploads.detect_media_type", return_value="image"), \
             patch("app.services.uploads.get_s3_client"), \
             patch("app.services.uploads.get_media_bucket", return_value="bucket"), \
             patch("app.services.uploads.generate_s3_key", return_value="k"), \
             patch("app.tasks.media.process_upload_task") as mock_proc:
            mock_proc.delay = MagicMock()
            result = upload_from_url_task(
                "https://example.com/path/my-file.png", str(uuid4())
            )

        assert result["filename"] == "my-file.png"

    def test_http_error_propagates(self, mock_session):
        from app.tasks.media import upload_from_url_task

        fake_resp = MagicMock()
        fake_resp.raise_for_status.side_effect = RuntimeError("404")

        # Patch the SSRF guard at its source module (the task imports
        # safe_get inside the function body, so app.tasks.media has no such
        # attribute to patch). safe_get re-validates every redirect hop and
        # urljoins response.url; patching requests.get instead leaves a
        # MagicMock there, which raises TypeError before the assertion under
        # test is reached.
        with patch("app.services.url_guard.safe_get", return_value=fake_resp):
            with pytest.raises(RuntimeError, match="404"):
                upload_from_url_task("https://example.com/missing", str(uuid4()))


# ===========================================================================
# regenerate_derivatives_task
# ===========================================================================


class TestRegenerateDerivativesTask:

    def test_media_not_found_returns_error(self, mock_session):
        from app.tasks.media import regenerate_derivatives_task

        mock_session.query.return_value.filter_by.return_value.first.return_value = None
        result = regenerate_derivatives_task(str(uuid4()), str(uuid4()))
        assert result == {"success": False, "error": "Media not found"}

    def test_non_image_media_rejected(self, mock_session):
        from app.tasks.media import regenerate_derivatives_task

        media = _media_stub(media_type="video")
        mock_session.query.return_value.filter_by.return_value.first.return_value = media

        result = regenerate_derivatives_task(str(uuid4()), str(uuid4()))
        assert result["success"] is False
        assert "Only image" in result["error"]

    def test_success_regenerates_and_creates_records(self, mock_session):
        from app.tasks.media import regenerate_derivatives_task

        media = _media_stub(media_type="image")
        mock_session.query.return_value.filter_by.return_value.first.return_value = media

        storage = MagicMock()
        storage.get_object_sync.return_value = (b"IMG", {})

        deriv_a = SimpleNamespace(
            derivative_type="thumbnail", format="jpeg", s3_key="a.jpg",
            width=200, height=200, file_size=1, quality=85)
        deriv_b = SimpleNamespace(
            derivative_type="medium", format="jpeg", s3_key="b.jpg",
            width=1200, height=900, file_size=50, quality=85)

        with patch("app.services.media_processing.delete_derivatives"), \
             patch("app.services.media_processing.generate_all_derivatives",
                   return_value=[deriv_a, deriv_b]), \
             patch("app.services.storage.get_storage_backend", return_value=storage):
            result = regenerate_derivatives_task(str(uuid4()), str(uuid4()))

        assert result["success"] is True
        assert result["derivatives_generated"] == 2
        assert media.thumbnail_s3_key == "a.jpg"

    def test_exception_propagates(self, mock_session):
        from app.tasks.media import regenerate_derivatives_task

        media = _media_stub(media_type="image")
        mock_session.query.return_value.filter_by.return_value.first.return_value = media

        storage = MagicMock()
        storage.get_object_sync.side_effect = RuntimeError("S3 down")

        with patch("app.services.media_processing.delete_derivatives"), \
             patch("app.services.storage.get_storage_backend", return_value=storage):
            with pytest.raises(RuntimeError, match="S3 down"):
                regenerate_derivatives_task(str(uuid4()), str(uuid4()))


# ===========================================================================
# extract_metadata_task
# ===========================================================================


class TestExtractMetadataTask:

    def test_media_not_found(self, mock_session):
        from app.tasks.media import extract_metadata_task

        mock_session.query.return_value.filter_by.return_value.first.return_value = None
        result = extract_metadata_task(str(uuid4()), str(uuid4()))
        assert result == {"success": False, "error": "Media not found"}

    def test_non_image_rejected(self, mock_session):
        from app.tasks.media import extract_metadata_task

        media = _media_stub(media_type="video")
        mock_session.query.return_value.filter_by.return_value.first.return_value = media
        result = extract_metadata_task(str(uuid4()), str(uuid4()))
        assert result["success"] is False

    def test_success_populates_fields(self, mock_session):
        from app.tasks.media import extract_metadata_task

        media = _media_stub(media_type="image")
        mock_session.query.return_value.filter_by.return_value.first.return_value = media

        storage = MagicMock()
        storage.get_object_sync.return_value = (b"IMG", {})

        meta = SimpleNamespace(
            width=100, height=200,
            technical_metadata={"iso": 400},
            iptc_metadata={"headline": "x"},
            xmp_metadata={"foo": "bar"},
            dublin_core={"dc_title": "t"},
        )

        with patch("app.services.storage.get_storage_backend", return_value=storage), \
             patch("app.services.media_processing.extract_metadata",
                   return_value=meta), \
             patch("app.services.media_processing.compute_checksum",
                   return_value="c" * 64):
            result = extract_metadata_task(str(uuid4()), str(uuid4()))

        assert result["success"] is True
        assert result["width"] == 100
        assert result["height"] == 200
        assert media.width == 100
        assert media.checksum_sha256 == "c" * 64

    def test_exception_propagates(self, mock_session):
        from app.tasks.media import extract_metadata_task

        media = _media_stub(media_type="image")
        mock_session.query.return_value.filter_by.return_value.first.return_value = media

        storage = MagicMock()
        storage.get_object_sync.side_effect = RuntimeError("S3 fail")

        with patch("app.services.storage.get_storage_backend", return_value=storage):
            with pytest.raises(RuntimeError):
                extract_metadata_task(str(uuid4()), str(uuid4()))



class TestProcessBatchTask:

    def test_queues_derivatives_by_default(self, mock_session):
        from app.tasks.media import process_batch_task

        ids = [str(uuid4()) for _ in range(3)]
        with patch("app.tasks.media.process_upload_task") as mock_proc:
            mock_proc.delay = MagicMock()
            result = process_batch_task(ids, str(uuid4()))

        assert result["success"] is True
        assert result["queued"] == 3
        assert result["operation"] == "derivatives"
        assert mock_proc.delay.call_count == 3

    def test_metadata_extract_routes_to_extract_task(self, mock_session):
        from app.tasks.media import process_batch_task

        with patch("app.tasks.media.extract_metadata_task") as mock_ext:
            mock_ext.delay = MagicMock()
            result = process_batch_task(
                [str(uuid4())], str(uuid4()), operation="metadata_extract"
            )

        assert result["queued"] == 1
        mock_ext.delay.assert_called_once()

    def test_regenerate_routes_to_regenerate_task(self, mock_session):
        from app.tasks.media import process_batch_task

        with patch("app.tasks.media.regenerate_derivatives_task") as mock_regen:
            mock_regen.delay = MagicMock()
            result = process_batch_task(
                [str(uuid4()), str(uuid4())], str(uuid4()),
                operation="regenerate",
            )

        assert result["queued"] == 2

    def test_empty_batch(self, mock_session):
        from app.tasks.media import process_batch_task

        result = process_batch_task([], str(uuid4()))
        assert result["success"] is True
        assert result["queued"] == 0


# ===========================================================================
# transcode_video_task
# ===========================================================================


class TestTranscodeVideoTask:

    def test_unavailable_returns_error(self, mock_session):
        from app.tasks.media import transcode_video_task

        with patch("app.services.video_transcoding.is_video_transcoding_available",
                   return_value=False):
            result = transcode_video_task(str(uuid4()), str(uuid4()))

        assert result["success"] is False
        assert "not configured" in result["error"]

    def test_media_not_found(self, mock_session):
        from app.tasks.media import transcode_video_task

        mock_session.query.return_value.filter_by.return_value.first.return_value = None

        with patch("app.services.video_transcoding.is_video_transcoding_available",
                   return_value=True):
            result = transcode_video_task(str(uuid4()), str(uuid4()))
        assert result == {"success": False, "error": "Media not found"}

    def test_rejects_non_video_media(self, mock_session):
        from app.tasks.media import transcode_video_task

        media = _media_stub(media_type="image")
        mock_session.query.return_value.filter_by.return_value.first.return_value = media

        with patch("app.services.video_transcoding.is_video_transcoding_available",
                   return_value=True):
            result = transcode_video_task(str(uuid4()), str(uuid4()))
        assert result["success"] is False
        assert "Only video" in result["error"]

    def test_success_submits_to_mediaconvert(self, mock_session):
        from app.tasks.media import transcode_video_task

        media = _media_stub(media_type="video", file_size=10_000_000)
        _rig_query_first(mock_session, media, None)

        # Scalar queries (count of active transcodes) should return 0.
        mock_session.query.return_value.filter.return_value.scalar.return_value = 0

        video_meta = SimpleNamespace(
            width=1920, height=1080, duration_seconds=60.5,
            video_codec="h264", bitrate=5000, audio_codec="aac",
            fps=30.0, container="mp4",
        )
        svc = MagicMock()
        svc.create_transcode_job.return_value = SimpleNamespace(job_id="mc-123")

        with patch("app.services.video_transcoding.is_video_transcoding_available",
                   return_value=True), \
             patch("app.services.video_transcoding.get_video_transcoding_service",
                   return_value=svc), \
             patch("app.services.uploads.get_media_bucket", return_value="bucket"), \
             patch("app.services.uploads.get_s3_client"), \
             patch("app.services.uploads.get_org_storage_region",
                   return_value="us-west-2"), \
             patch("app.services.video_processing.extract_video_metadata_from_s3",
                   return_value=video_meta), \
             patch("app.services.video_processing.compute_video_checksum",
                   return_value="c" * 64), \
             patch("app.services.video_processing.build_video_technical_metadata",
                   return_value={"codec": "h264"}), \
             patch("app.services.video_processing.build_video_dublin_core",
                   return_value={}), \
             patch("app.services.storage.get_storage_backend") as storage_mod:
            storage = MagicMock()
            storage.get_object_sync.return_value = (b"VIDEO", {})
            storage_mod.return_value = storage
            result = transcode_video_task(str(uuid4()), str(uuid4()))

        assert result["success"] is True
        assert result["status"] == "submitted"
        assert result["job_id"] == "mc-123"
        assert media.width == 1920
        assert media.duration_seconds == 60

    def test_queues_job_when_over_concurrency_limit(self, mock_session):
        from app.tasks.media import transcode_video_task

        media = _media_stub(media_type="video", file_size=1_000_000)
        _rig_query_first(mock_session, media, None)

        # Per-org count over cap (3), global count also over cap just in case.
        mock_session.query.return_value.filter.return_value.scalar.side_effect = [5, 2]

        video_meta = SimpleNamespace(
            width=1280, height=720, duration_seconds=10,
            video_codec="h264", bitrate=1000, audio_codec=None,
            fps=30.0, container="mp4",
        )

        with patch("app.services.video_transcoding.is_video_transcoding_available",
                   return_value=True), \
             patch("app.services.video_transcoding.get_video_transcoding_service"), \
             patch("app.services.uploads.get_media_bucket", return_value="bucket"), \
             patch("app.services.uploads.get_s3_client"), \
             patch("app.services.uploads.get_org_storage_region",
                   return_value="us-west-2"), \
             patch("app.services.video_processing.extract_video_metadata_from_s3",
                   return_value=video_meta), \
             patch("app.services.video_processing.compute_video_checksum",
                   return_value="x"), \
             patch("app.services.video_processing.build_video_technical_metadata",
                   return_value={}), \
             patch("app.services.video_processing.build_video_dublin_core",
                   return_value={}), \
             patch("app.services.storage.get_storage_backend") as storage_mod:
            storage = MagicMock()
            storage.get_object_sync.return_value = (b"V", {})
            storage_mod.return_value = storage
            result = transcode_video_task(str(uuid4()), str(uuid4()))

        assert result["success"] is True
        assert result["status"] == "queued"

    def test_metadata_extraction_failure_does_not_block_submit(self, mock_session):
        """If extract_video_metadata_from_s3 returns None, the task still
        proceeds to submit a job."""
        from app.tasks.media import transcode_video_task

        media = _media_stub(media_type="video", file_size=1_000_000)
        _rig_query_first(mock_session, media, None)

        mock_session.query.return_value.filter.return_value.scalar.return_value = 0

        svc = MagicMock()
        svc.create_transcode_job.return_value = SimpleNamespace(job_id="mc-999")

        with patch("app.services.video_transcoding.is_video_transcoding_available",
                   return_value=True), \
             patch("app.services.video_transcoding.get_video_transcoding_service",
                   return_value=svc), \
             patch("app.services.uploads.get_media_bucket", return_value="bucket"), \
             patch("app.services.uploads.get_s3_client"), \
             patch("app.services.uploads.get_org_storage_region",
                   return_value="us-west-2"), \
             patch("app.services.video_processing.extract_video_metadata_from_s3",
                   return_value=None), \
             patch("app.services.video_processing.compute_video_checksum"), \
             patch("app.services.storage.get_storage_backend") as storage_mod:
            storage = MagicMock()
            storage.get_object_sync.return_value = (b"V", {})
            storage_mod.return_value = storage
            result = transcode_video_task(str(uuid4()), str(uuid4()))

        assert result["success"] is True
        assert result["status"] == "submitted"


# ===========================================================================
# poll_transcode_jobs (system task)
# ===========================================================================


class TestPollTranscodeJobs:

    def test_skipped_when_transcoding_unavailable(self, mock_session):
        from app.tasks.media import poll_transcode_jobs

        with patch("app.services.video_transcoding.is_video_transcoding_available",
                   return_value=False):
            result = poll_transcode_jobs()
        assert result == {"skipped": True, "reason": "transcoding not configured"}

    def test_completes_done_jobs_and_counts_progress(self, mock_session):
        from app.tasks.media import poll_transcode_jobs

        complete_job = _job_stub(
            job_type="transcode", status="processing",
            parameters={"mediaconvert_job_id": "mc-complete"},
        )
        complete_job.media_id = uuid4()
        progress_job = _job_stub(
            job_type="transcode", status="processing",
            parameters={"mediaconvert_job_id": "mc-progress"},
        )
        progress_job.media_id = uuid4()

        admin_session = MagicMock()
        # Two phases of queries — get an answer per call:
        #   1. active_jobs (Phase 1)
        #   2. Media lookup for complete_job
        #   3. Media lookup for progress_job
        #   4. pending_jobs (Phase 2) — empty
        admin_session.query.return_value.filter.return_value.all.side_effect = [
            [complete_job, progress_job],  # active_jobs
            [],                             # pending_jobs
        ]
        # Media lookup for complete_job and progress_job:
        media_for_complete = _media_stub(media_type="video")
        media_for_progress = _media_stub(media_type="video")
        admin_session.query.return_value.filter_by.return_value.first.side_effect = [
            media_for_complete, media_for_progress,
        ]

        @contextmanager
        def fake_admin():
            yield admin_session

        svc = MagicMock()
        svc.get_job_status.side_effect = [
            {"status": "COMPLETE", "outputs": []},
            {"status": "PROGRESSING", "progress": 42},
        ]

        with patch("app.services.video_transcoding.is_video_transcoding_available",
                   return_value=True), \
             patch("app.services.video_transcoding.get_video_transcoding_service",
                   return_value=svc), \
             patch("app.tasks.rls_helpers.admin_db_session", fake_admin), \
             patch("app.tasks.media._complete_transcode") as mock_complete:
            result = poll_transcode_jobs()

        assert result["completed"] == 1
        assert result["still_processing"] == 1
        assert result["failed"] == 0
        mock_complete.assert_called_once()

    def test_fails_jobs_in_error_state(self, mock_session):
        from app.tasks.media import poll_transcode_jobs

        err_job = _job_stub(
            job_type="transcode", status="processing",
            parameters={"mediaconvert_job_id": "mc-err"},
        )
        err_job.media_id = uuid4()

        admin_session = MagicMock()
        admin_session.query.return_value.filter.return_value.all.side_effect = [
            [err_job], [],
        ]
        admin_session.query.return_value.filter_by.return_value.first.return_value = \
            _media_stub(media_type="video")

        @contextmanager
        def fake_admin():
            yield admin_session

        svc = MagicMock()
        svc.get_job_status.return_value = {
            "status": "ERROR", "error_message": "bad input",
        }

        with patch("app.services.video_transcoding.is_video_transcoding_available",
                   return_value=True), \
             patch("app.services.video_transcoding.get_video_transcoding_service",
                   return_value=svc), \
             patch("app.tasks.rls_helpers.admin_db_session", fake_admin):
            result = poll_transcode_jobs()

        assert result["failed"] == 1
        assert err_job.status == "failed"
        assert err_job.error_message == "bad input"

    def test_skips_jobs_missing_mediaconvert_id(self, mock_session):
        from app.tasks.media import poll_transcode_jobs

        bad_job = _job_stub(
            job_type="transcode", status="processing",
            parameters={"mediaconvert_job_id": None},
        )

        admin_session = MagicMock()
        admin_session.query.return_value.filter.return_value.all.side_effect = [
            [bad_job], [],
        ]

        @contextmanager
        def fake_admin():
            yield admin_session

        with patch("app.services.video_transcoding.is_video_transcoding_available",
                   return_value=True), \
             patch("app.services.video_transcoding.get_video_transcoding_service"), \
             patch("app.tasks.rls_helpers.admin_db_session", fake_admin):
            result = poll_transcode_jobs()

        assert result["completed"] == 0
        assert result["failed"] == 0

    def test_submits_queued_job_when_slot_available(self, mock_session):
        from app.tasks.media import poll_transcode_jobs

        queued_job = _job_stub(
            job_type="transcode", status="pending",
            parameters={
                "queued_reason": "concurrency_limit",
                "source_s3_uri": "s3://b/k",
                "output_s3_prefix": "s3://b/out/",
                "derivatives": ["web_mp4_720p"],
                "extract_poster": True,
            },
        )
        queued_job.media_id = uuid4()
        queued_job.organization_id = uuid4()

        admin_session = MagicMock()
        # Phase 1 (active jobs) calls .filter().all(); Phase 2 (pending
        # jobs) calls .filter().order_by().all() — point both at the same
        # side_effect so one returns [] (no active) and the next returns
        # [queued_job] (one pending).
        all_iter = iter([[], [queued_job]])
        admin_session.query.return_value.filter.return_value.all.side_effect = (
            lambda: next(all_iter)
        )
        admin_session.query.return_value.filter.return_value.order_by.return_value.all.side_effect = (
            lambda: next(all_iter)
        )
        # Concurrency counts both under the cap.
        admin_session.query.return_value.filter.return_value.scalar.return_value = 0

        @contextmanager
        def fake_admin():
            yield admin_session

        svc = MagicMock()
        svc.create_transcode_job.return_value = SimpleNamespace(job_id="mc-new")

        with patch("app.services.video_transcoding.is_video_transcoding_available",
                   return_value=True), \
             patch("app.services.video_transcoding.get_video_transcoding_service",
                   return_value=svc), \
             patch("app.tasks.rls_helpers.admin_db_session", fake_admin):
            result = poll_transcode_jobs()

        assert result["submitted"] == 1
        assert queued_job.status == "processing"

    def test_queued_job_missing_params_marked_failed(self, mock_session):
        from app.tasks.media import poll_transcode_jobs

        bad_queued = _job_stub(
            job_type="transcode", status="pending",
            parameters={
                "queued_reason": "concurrency_limit",
                # Missing source_s3_uri / output_s3_prefix
            },
        )

        admin_session = MagicMock()
        all_iter = iter([[], [bad_queued]])
        admin_session.query.return_value.filter.return_value.all.side_effect = (
            lambda: next(all_iter)
        )
        admin_session.query.return_value.filter.return_value.order_by.return_value.all.side_effect = (
            lambda: next(all_iter)
        )
        admin_session.query.return_value.filter.return_value.scalar.return_value = 0

        @contextmanager
        def fake_admin():
            yield admin_session

        with patch("app.services.video_transcoding.is_video_transcoding_available",
                   return_value=True), \
             patch("app.services.video_transcoding.get_video_transcoding_service"), \
             patch("app.tasks.rls_helpers.admin_db_session", fake_admin):
            result = poll_transcode_jobs()

        assert result["failed"] == 1
        assert bad_queued.status == "failed"


# ===========================================================================
# apply_watermark_task
# ===========================================================================


class TestApplyWatermarkTask:

    def test_media_not_found(self, mock_session):
        from app.tasks.media import apply_watermark_task

        mock_session.query.return_value.filter_by.return_value.first.return_value = None
        result = apply_watermark_task(str(uuid4()), str(uuid4()), str(uuid4()))
        assert result["success"] is False

    def test_job_not_found(self, mock_session):
        from app.tasks.media import apply_watermark_task

        media = _media_stub()
        _rig_query_first(mock_session, media, None)

        result = apply_watermark_task(str(uuid4()), str(uuid4()), str(uuid4()))
        assert result == {"success": False, "error": "Processing job not found"}

    def test_success_replaces_original(self, mock_session):
        from app.tasks.media import apply_watermark_task

        media = _media_stub(s3_key="orig.jpg")
        job = _job_stub(job_type="watermark", parameters={
            "template_config": {"text": "Sample"},
            "watermark_type": "text",
            "apply_to_derivatives": False,
            "create_watermarked_copy": False,
        })
        _rig_query_first(mock_session, media, job)

        storage = MagicMock()
        storage.get_object_sync.return_value = (b"ORIGINAL", {})
        storage.put_object_sync = MagicMock()
        # First run: no pristine copy exists yet. This must be explicit — a bare
        # MagicMock returns a truthy object, which would silently exercise the
        # retry branch instead.
        storage.head_object_sync.return_value = None

        with patch("app.services.storage.get_storage_backend", return_value=storage), \
             patch("app.services.media_processing.apply_watermark_to_image",
                   return_value=b"WATERMARKED_BYTES"):
            result = apply_watermark_task(str(uuid4()), str(uuid4()), str(uuid4()))

        assert result["success"] is True
        assert result["original_watermarked"] is True
        # Two writes: the preserved original, then the watermarked master.
        assert storage.put_object_sync.call_count == 2
        written = {c.kwargs["key"] for c in storage.put_object_sync.call_args_list}
        assert written == {"orig.jpg", "orig.jpg.pristine"}
        assert media.file_size == len(b"WATERMARKED_BYTES")

    def test_retry_rederives_from_pristine_and_does_not_stack(self, mock_session):
        """A replay must re-derive from the untouched original.

        The task is `autoretry_for=(Exception,), max_retries=3` and, by
        default, writes the watermarked result back over media.s3_key. Work
        continues after that write (derivatives are deleted and regenerated),
        so a later failure re-entered the task from the top and re-read the
        ALREADY WATERMARKED bytes. Four attempts could burn four stacked
        watermarks into an archival master, irreversibly, and no
        watermark-state column existed to notice.
        """
        from app.tasks.media import apply_watermark_task

        media = _media_stub(s3_key="orig.jpg")
        job = _job_stub(job_type="watermark", parameters={
            "template_config": {"text": "Sample"},
            "watermark_type": "text",
            "apply_to_derivatives": False,
            "create_watermarked_copy": False,
        })
        _rig_query_first(mock_session, media, job)

        storage = MagicMock()
        # The master already holds a watermark from the previous attempt, and
        # the pristine original was preserved before that attempt wrote it.
        storage.head_object_sync.return_value = object()

        def _get(key):
            return (b"WATERMARKED_ONCE", {}) if key == "orig.jpg" else (b"ORIGINAL", {})

        storage.get_object_sync.side_effect = _get
        storage.put_object_sync = MagicMock()

        seen: list[bytes] = []

        def _watermark(data, **kwargs):
            seen.append(data)
            return b"WATERMARKED_ONCE"

        with patch("app.services.storage.get_storage_backend", return_value=storage), \
             patch("app.services.media_processing.apply_watermark_to_image",
                   side_effect=_watermark):
            result = apply_watermark_task(str(uuid4()), str(uuid4()), str(uuid4()))

        assert result["success"] is True
        assert seen == [b"ORIGINAL"], (
            "the retry watermarked the live master instead of the preserved "
            f"original — it would stack. Saw: {seen}"
        )
        # The preserved original must not be overwritten on a retry.
        written = {c.kwargs["key"] for c in storage.put_object_sync.call_args_list}
        assert "orig.jpg.pristine" not in written

    def test_create_watermarked_copy_preserves_original(self, mock_session):
        from app.tasks.media import apply_watermark_task

        media = _media_stub(s3_key="orig.jpg")
        job = _job_stub(parameters={
            "template_config": {},
            "watermark_type": "image",
            "apply_to_derivatives": False,
            "create_watermarked_copy": True,
        })
        _rig_query_first(mock_session, media, job)

        storage = MagicMock()
        storage.get_object_sync.return_value = (b"ORIG", {})
        storage.put_object_sync = MagicMock()

        with patch("app.services.storage.get_storage_backend", return_value=storage), \
             patch("app.services.media_processing.apply_watermark_to_image",
                   return_value=b"WM"):
            result = apply_watermark_task(str(uuid4()), str(uuid4()), str(uuid4()))

        assert result["success"] is True
        assert result["original_watermarked"] is False
        assert "watermarked_copy_key" in result

    def test_exception_marks_job_failed(self, mock_session):
        from app.tasks.media import apply_watermark_task

        media = _media_stub()
        job = _job_stub(parameters={})
        # media+job lookups in outer try, then job lookup in except.
        _rig_query_first(mock_session, media, job, job)

        storage = MagicMock()
        storage.get_object_sync.side_effect = RuntimeError("storage down")

        with patch("app.services.storage.get_storage_backend", return_value=storage):
            with pytest.raises(RuntimeError):
                apply_watermark_task(str(uuid4()), str(uuid4()), str(uuid4()))


# ===========================================================================
# check_expiring_rights_consents_task
# ===========================================================================


class TestCheckExpiringRightsConsentsTask:

    def test_happy_path_creates_and_resolves_alerts(self, mock_session):
        from app.tasks.media import check_expiring_rights_consents_task
        from app.models import MediaRights, MediaConsent, ExpirationAlert

        today = date.today()
        rights = MagicMock(spec=MediaRights)
        rights.rights_id = uuid4()
        rights.media_id = uuid4()
        rights.end_date = today + timedelta(days=20)  # critical

        consent = MagicMock(spec=MediaConsent)
        consent.consent_id = uuid4()
        consent.media_id = uuid4()
        consent.expiry_date = today + timedelta(days=75)  # warning

        expired_alert = MagicMock(spec=ExpirationAlert)
        expired_alert.status = "active"
        expired_alert.expiry_date = today - timedelta(days=5)

        org = SimpleNamespace(organization_id=uuid4())

        admin_session = MagicMock()
        # organizations list
        admin_session.query.return_value.all.side_effect = [[org]]
        # .query(X).filter(...).all() sequence:
        #   expiring_rights -> [rights]
        #   expiring_consents -> [consent]
        #   expired_alerts (resolver) -> [expired_alert]
        admin_session.query.return_value.filter.return_value.all.side_effect = [
            [rights], [consent], [expired_alert],
        ]
        # ExpirationAlert.filter(...).first() existing check returns None for
        # every call so new alerts get created.
        admin_session.query.return_value.filter.return_value.first.return_value = None

        @contextmanager
        def fake_admin():
            yield admin_session

        with patch("app.tasks.rls_helpers.admin_db_session", fake_admin):
            result = check_expiring_rights_consents_task()

        assert result["success"] is True
        assert result["alerts_created"] == 2
        assert result["alerts_resolved"] == 1
        assert expired_alert.status == "resolved"

    def test_updates_existing_active_alert(self, mock_session):
        from app.tasks.media import check_expiring_rights_consents_task
        from app.models import MediaRights

        today = date.today()
        rights = MagicMock(spec=MediaRights)
        rights.rights_id = uuid4()
        rights.media_id = uuid4()
        rights.end_date = today + timedelta(days=10)

        existing = MagicMock()
        existing.status = "active"

        org = SimpleNamespace(organization_id=uuid4())

        admin_session = MagicMock()
        admin_session.query.return_value.all.side_effect = [[org]]
        admin_session.query.return_value.filter.return_value.all.side_effect = [
            [rights], [], [],
        ]
        admin_session.query.return_value.filter.return_value.first.return_value = existing

        @contextmanager
        def fake_admin():
            yield admin_session

        with patch("app.tasks.rls_helpers.admin_db_session", fake_admin):
            result = check_expiring_rights_consents_task()

        assert result["alerts_updated"] == 1
        assert existing.severity == "critical"

    def test_exception_returns_failure_dict(self, mock_session):
        from app.tasks.media import check_expiring_rights_consents_task

        @contextmanager
        def broken():
            raise RuntimeError("db down")
            yield  # pragma: no cover

        with patch("app.tasks.rls_helpers.admin_db_session", broken):
            result = check_expiring_rights_consents_task()

        assert result["success"] is False
        assert "db down" in result["error"]


# ===========================================================================
# execute_workspace_bulk_action_task
# ===========================================================================


class TestExecuteWorkspaceBulkActionTask:
    """The task uses ``MediaWorkspaceActionRun`` (the original
    ``BulkActionRun`` premise was wrong / pre-rename). When called with a
    run_id that doesn't exist, it logs a warning and returns gracefully
    — that's the behavior we lock in here."""

    def test_unknown_run_id_returns_without_raising(self, mock_session):
        from app.tasks.media import execute_workspace_bulk_action_task

        # Mock session returns no row for the run_id lookup.
        mock_session.query.return_value.filter_by.return_value.first.return_value = None
        # Should not raise even when the run record is missing.
        result = execute_workspace_bulk_action_task(
            run_id=str(uuid4()),
            organization_id=str(uuid4()),
            workspace_id=str(uuid4()),
            action="bulk_publish",
            action_params={},
            user_id=str(uuid4()),
            media_ids=[str(uuid4())],
        )
        # Whatever the task chose to return on a missing run is fine; we
        # just need the call to complete without an unhandled exception.
        assert result is None or isinstance(result, dict)


# ===========================================================================
# embed_object_metadata_task
# ===========================================================================


class TestEmbedObjectMetadataTask:

    def test_media_not_found(self, mock_session):
        from app.tasks.media import embed_object_metadata_task

        mock_session.query.return_value.filter_by.return_value.first.return_value = None
        result = embed_object_metadata_task(
            str(uuid4()), str(uuid4()), str(uuid4()),
        )
        assert result == {"success": False, "error": "Media not found"}

    def test_aggregation_failure_fails_job(self, mock_session):
        from app.tasks.media import embed_object_metadata_task

        media = _media_stub()
        mock_session.query.return_value.filter_by.return_value.first.return_value = media

        with patch("app.services.object_metadata_aggregator.aggregate_object_metadata",
                   return_value=None):
            result = embed_object_metadata_task(
                str(uuid4()), str(uuid4()), str(uuid4()),
            )

        assert result["success"] is False
        assert "aggregate" in result["error"]

    def test_image_embeds_xmp_and_reindexes(self, mock_session):
        from app.tasks.media import embed_object_metadata_task

        media = _media_stub(media_type="image", inherited_metadata=None)
        mock_session.query.return_value.filter_by.return_value.first.return_value = media

        object_id = str(uuid4())
        agg = {"object": {"object_id": object_id}, "title": "Vase"}

        index_manager = MagicMock()
        index_manager.is_available.return_value = True

        with patch("app.services.object_metadata_aggregator.aggregate_object_metadata",
                   return_value=agg), \
             patch("app.services.media_metadata_embedder.write_metadata_to_derivatives",
                   return_value={"derivatives_updated": 3, "errors": []}), \
             patch("app.search.media.index_manager.MediaIndexManager",
                   return_value=index_manager):
            result = embed_object_metadata_task(
                str(uuid4()), object_id, str(uuid4()),
            )

        assert result["success"] is True
        assert result["derivatives_updated"] == 3
        assert result["indexed"] is True
        # linked_objects now contains one entry for this object.
        assert media.inherited_metadata["linked_objects"][0] == agg

    def test_merges_with_existing_linked_objects(self, mock_session):
        """When media is already linked to another object, the new aggregation
        is appended; re-embedding the same object updates in place."""
        from app.tasks.media import embed_object_metadata_task

        obj_a = str(uuid4())
        obj_b = str(uuid4())
        existing = {
            "linked_objects": [
                {"object": {"object_id": obj_a}, "title": "A"},
            ],
            "updated_at": "old",
        }
        media = _media_stub(media_type="image", inherited_metadata=existing)
        mock_session.query.return_value.filter_by.return_value.first.return_value = media

        agg = {"object": {"object_id": obj_b}, "title": "B"}

        with patch("app.services.object_metadata_aggregator.aggregate_object_metadata",
                   return_value=agg), \
             patch("app.services.media_metadata_embedder.write_metadata_to_derivatives",
                   return_value={"derivatives_updated": 0, "errors": []}), \
             patch("app.search.media.index_manager.MediaIndexManager"):
            embed_object_metadata_task(
                str(uuid4()), obj_b, str(uuid4()),
            )

        # Both objects linked now.
        linked = media.inherited_metadata["linked_objects"]
        assert len(linked) == 2
        assert {l["object"]["object_id"] for l in linked} == {obj_a, obj_b}

    def test_non_image_skips_xmp_embedding(self, mock_session):
        from app.tasks.media import embed_object_metadata_task

        media = _media_stub(media_type="document", inherited_metadata=None)
        mock_session.query.return_value.filter_by.return_value.first.return_value = media

        with patch("app.services.object_metadata_aggregator.aggregate_object_metadata",
                   return_value={"object": {"object_id": "x"}}), \
             patch("app.services.media_metadata_embedder.write_metadata_to_derivatives") as mock_write, \
             patch("app.search.media.index_manager.MediaIndexManager"):
            result = embed_object_metadata_task(
                str(uuid4()), str(uuid4()), str(uuid4()),
            )

        assert result["success"] is True
        assert result["derivatives_updated"] == 0
        mock_write.assert_not_called()

    def test_reindex_failure_does_not_fail_task(self, mock_session):
        from app.tasks.media import embed_object_metadata_task

        media = _media_stub(media_type="image", inherited_metadata=None)
        mock_session.query.return_value.filter_by.return_value.first.return_value = media

        with patch("app.services.object_metadata_aggregator.aggregate_object_metadata",
                   return_value={"object": {"object_id": "x"}}), \
             patch("app.services.media_metadata_embedder.write_metadata_to_derivatives",
                   return_value={"derivatives_updated": 0, "errors": []}), \
             patch("app.search.media.index_manager.MediaIndexManager",
                   side_effect=RuntimeError("OS unavailable")):
            result = embed_object_metadata_task(
                str(uuid4()), str(uuid4()), str(uuid4()),
            )

        assert result["success"] is True
        assert result["indexed"] is False


# ===========================================================================
# refresh_smart_collections
# ===========================================================================


class TestRefreshSmartCollections:

    def test_skipped_when_search_unavailable(self, mock_session):
        from app.tasks.media import refresh_smart_collections

        with patch("app.search.media.MediaSearchService.is_available",
                   return_value=False):
            result = refresh_smart_collections()

        assert result == {"refreshed": 0, "skipped": True}

    def test_skips_collection_not_due_for_refresh(self, mock_session):
        from app.tasks.media import refresh_smart_collections

        col = MagicMock()
        col.collection_id = uuid4()
        col.organization_id = uuid4()
        col.last_refreshed_at = datetime.now(timezone.utc)  # just now
        col.refresh_interval_minutes = 60
        col.saved_search = {"query": "x"}

        mock_session.query.return_value.filter.return_value.all.return_value = [col]

        with patch("app.search.media.MediaSearchService.is_available",
                   return_value=True), \
             patch("app.search.media.get_media_search_service"):
            result = refresh_smart_collections()

        assert result["refreshed"] == 0

    def test_refreshes_and_updates_membership(self, mock_session):
        from app.tasks.media import refresh_smart_collections

        old_id = str(uuid4())
        new_id = str(uuid4())
        col = MagicMock()
        col.collection_id = uuid4()
        col.organization_id = uuid4()
        col.last_refreshed_at = None  # never refreshed -> due
        col.refresh_interval_minutes = 15
        col.saved_search = {"query": "art"}

        # smart_collections .all() returns [col]; member-id .all() returns one row.
        mock_session.query.return_value.filter.return_value.all.return_value = [col]

        # MediaCollectionItem.media_id rows for current members.
        existing_row = SimpleNamespace(media_id=UUID(old_id))
        mock_session.query.return_value.filter_by.return_value.all.return_value = [
            existing_row,
        ]

        svc = MagicMock()
        svc.search.return_value = SimpleNamespace(
            hits=[SimpleNamespace(media_id=new_id)],
        )

        with patch("app.search.media.MediaSearchService.is_available",
                   return_value=True), \
             patch("app.search.media.get_media_search_service", return_value=svc):
            result = refresh_smart_collections()

        assert result["refreshed"] == 1
        assert col.item_count == 1

    def test_search_exception_is_swallowed(self, mock_session):
        from app.tasks.media import refresh_smart_collections

        col = MagicMock()
        col.collection_id = uuid4()
        col.organization_id = uuid4()
        col.last_refreshed_at = None
        col.refresh_interval_minutes = 15
        col.saved_search = {"query": "x"}

        mock_session.query.return_value.filter.return_value.all.return_value = [col]

        svc = MagicMock()
        svc.search.side_effect = RuntimeError("OS down")

        with patch("app.search.media.MediaSearchService.is_available",
                   return_value=True), \
             patch("app.search.media.get_media_search_service", return_value=svc):
            result = refresh_smart_collections()

        assert result["refreshed"] == 0


# ===========================================================================
# check_search_subscriptions
# ===========================================================================


class TestCheckSearchSubscriptions:

    def test_skipped_when_search_unavailable(self, mock_session):
        from app.tasks.media import check_search_subscriptions

        with patch("app.search.media.MediaSearchService.is_available",
                   return_value=False):
            result = check_search_subscriptions()
        assert result["skipped"] is True

    def test_no_subscriptions_noops(self, mock_session):
        from app.tasks.media import check_search_subscriptions

        mock_session.query.return_value.filter.return_value.all.return_value = []

        with patch("app.search.media.MediaSearchService.is_available",
                   return_value=True), \
             patch("app.search.media.get_media_search_service"):
            result = check_search_subscriptions()

        assert result["checked"] == 0
        assert result["notified"] == 0

    def test_notifies_on_new_results(self, mock_session):
        from app.tasks.media import check_search_subscriptions

        sub = MagicMock()
        sub.subscription_id = uuid4()
        sub.user_id = uuid4()
        sub.organization_id = uuid4()
        sub.search_params = {"query": "paintings"}
        sub.notify_on_new = True
        sub.last_result_ids = ["old1"]

        mock_session.query.return_value.filter.return_value.all.return_value = [sub]

        svc = MagicMock()
        svc.search.return_value = SimpleNamespace(
            hits=[SimpleNamespace(media_id="old1"),
                  SimpleNamespace(media_id="new1")],
        )

        with patch("app.search.media.MediaSearchService.is_available",
                   return_value=True), \
             patch("app.search.media.get_media_search_service", return_value=svc), \
             patch("app.services.notification_service.send_notification") as mock_notify:
            result = check_search_subscriptions()

        assert result["notified"] == 1
        assert result["checked"] == 1
        mock_notify.assert_called_once()
        # last_result_ids updated to the new list
        assert "new1" in sub.last_result_ids

    def test_no_new_ids_skips_notification(self, mock_session):
        from app.tasks.media import check_search_subscriptions

        sub = MagicMock()
        sub.subscription_id = uuid4()
        sub.user_id = uuid4()
        sub.organization_id = uuid4()
        sub.search_params = {"query": "x"}
        sub.notify_on_new = True
        sub.last_result_ids = ["a", "b"]

        mock_session.query.return_value.filter.return_value.all.return_value = [sub]

        svc = MagicMock()
        svc.search.return_value = SimpleNamespace(
            hits=[SimpleNamespace(media_id="a"),
                  SimpleNamespace(media_id="b")],
        )

        with patch("app.search.media.MediaSearchService.is_available",
                   return_value=True), \
             patch("app.search.media.get_media_search_service", return_value=svc), \
             patch("app.services.notification_service.send_notification") as mock_notify:
            result = check_search_subscriptions()

        assert result["notified"] == 0
        mock_notify.assert_not_called()


# ===========================================================================
# cleanup_stuck_media_jobs
# ===========================================================================


class TestCleanupStuckMediaJobs:

    def test_fails_stuck_general_and_transcode_jobs(self, mock_session):
        from app.tasks.media import cleanup_stuck_media_jobs

        general = _job_stub(job_type="derivatives", status="processing")
        general.started_at = datetime.now(timezone.utc) - timedelta(minutes=30)
        transcode = _job_stub(job_type="transcode", status="processing")
        transcode.started_at = datetime.now(timezone.utc) - timedelta(minutes=45)
        orphan_media = _media_stub(processing_status="processing")

        admin_session = MagicMock()
        admin_session.query.return_value.filter.return_value.all.side_effect = [
            [general],       # stuck_general
            [transcode],     # stuck_transcode
            [orphan_media],  # stuck_media
        ]

        @contextmanager
        def fake_admin():
            yield admin_session

        with patch("app.tasks.rls_helpers.admin_db_session", fake_admin):
            result = cleanup_stuck_media_jobs()

        assert result["jobs_failed"] == 2
        assert result["media_failed"] == 1
        assert general.status == "failed"
        assert transcode.status == "failed"
        assert orphan_media.processing_status == "failed"

    def test_nothing_stuck_returns_zero(self, mock_session):
        from app.tasks.media import cleanup_stuck_media_jobs

        admin_session = MagicMock()
        admin_session.query.return_value.filter.return_value.all.side_effect = [
            [], [], [],
        ]

        @contextmanager
        def fake_admin():
            yield admin_session

        with patch("app.tasks.rls_helpers.admin_db_session", fake_admin):
            result = cleanup_stuck_media_jobs()

        assert result == {"jobs_failed": 0, "media_failed": 0}

    def test_exception_propagates(self, mock_session):
        from app.tasks.media import cleanup_stuck_media_jobs

        @contextmanager
        def broken():
            raise RuntimeError("boom")
            yield  # pragma: no cover

        with patch("app.tasks.rls_helpers.admin_db_session", broken):
            with pytest.raises(RuntimeError):
                cleanup_stuck_media_jobs()


# ===========================================================================
# generate_contact_sheet_task
# ===========================================================================


class TestGenerateContactSheetTask:

    def test_run_not_found(self, mock_session):
        from app.tasks.media import generate_contact_sheet_task

        mock_session.query.return_value.filter_by.return_value.first.return_value = None
        result = generate_contact_sheet_task(str(uuid4()), str(uuid4()))
        assert result == {"success": False, "error": "Run not found"}

    def test_cancelled_run_returns_skipped(self, mock_session):
        from app.tasks.media import generate_contact_sheet_task

        run = MagicMock()
        run.status = "cancelled"
        mock_session.query.return_value.filter_by.return_value.first.return_value = run

        result = generate_contact_sheet_task(str(uuid4()), str(uuid4()))
        assert result["success"] is False
        assert result["skipped"] is True

    def test_success_uploads_pdf_and_creates_notification(self, mock_session):
        from app.tasks.media import generate_contact_sheet_task

        run = MagicMock()
        run.status = "pending"
        run.run_id = uuid4()
        run.triggered_by_user_id = uuid4()
        run.context_params = {"collection_id": str(uuid4()), "columns": 3}
        mock_session.query.return_value.filter_by.return_value.first.return_value = run

        with patch("app.services.contact_sheet.generate_contact_sheet",
                   return_value=b"%PDF fake"), \
             patch("app.services.report_storage.upload_report_export",
                   return_value="reports/x.pdf"), \
             patch("app.services.notification_service.create_notification") as mock_notify:
            result = generate_contact_sheet_task(str(uuid4()), str(uuid4()))

        assert result["success"] is True
        assert run.status == "completed"
        assert run.export_s3_key == "reports/x.pdf"
        mock_notify.assert_called_once()

    def test_generation_failure_marks_run_failed_and_raises(self, mock_session):
        from app.tasks.media import generate_contact_sheet_task

        run = MagicMock()
        run.status = "pending"
        run.run_id = uuid4()
        run.triggered_by_user_id = None
        run.context_params = {"collection_id": str(uuid4())}
        mock_session.query.return_value.filter_by.return_value.first.return_value = run

        with patch("app.services.contact_sheet.generate_contact_sheet",
                   side_effect=ValueError("no items")):
            with pytest.raises(ValueError, match="no items"):
                generate_contact_sheet_task(str(uuid4()), str(uuid4()))

        assert run.status == "failed"
        assert "no items" in run.error_message

    def test_notification_failure_does_not_fail_run(self, mock_session):
        from app.tasks.media import generate_contact_sheet_task

        run = MagicMock()
        run.status = "pending"
        run.run_id = uuid4()
        run.triggered_by_user_id = uuid4()
        run.context_params = {"collection_id": str(uuid4())}
        mock_session.query.return_value.filter_by.return_value.first.return_value = run

        with patch("app.services.contact_sheet.generate_contact_sheet",
                   return_value=b"%PDF"), \
             patch("app.services.report_storage.upload_report_export",
                   return_value="k.pdf"), \
             patch("app.services.notification_service.create_notification",
                   side_effect=RuntimeError("notif down")):
            result = generate_contact_sheet_task(str(uuid4()), str(uuid4()))

        assert result["success"] is True



# ===========================================================================
# cleanup_deleted_media (not an OrgTask — plain task)
# ===========================================================================


class TestCleanupDeletedMedia:

    def test_deletes_derivatives_original_and_thumbnail(self, mock_session):
        from app.tasks.media import cleanup_deleted_media

        with patch("app.services.media_processing.delete_derivatives") as mock_delete_derivs, \
             patch("app.services.uploads.delete_org_media") as mock_delete_orig:
            cleanup_deleted_media(
                organization_id=str(uuid4()),
                media_id=str(uuid4()),
                s3_key="orig.jpg",
                thumbnail_key="thumb.jpg",
            )

        mock_delete_derivs.assert_called_once()
        assert mock_delete_orig.call_count == 2  # original + thumbnail

    def test_missing_keys_skips_calls(self, mock_session):
        from app.tasks.media import cleanup_deleted_media

        with patch("app.services.media_processing.delete_derivatives"), \
             patch("app.services.uploads.delete_org_media") as mock_delete:
            cleanup_deleted_media(
                organization_id=str(uuid4()),
                media_id=str(uuid4()),
                s3_key=None,
                thumbnail_key=None,
            )

        mock_delete.assert_not_called()

    def test_derivative_deletion_failure_does_not_stop_cleanup(self, mock_session):
        """A failure deleting derivatives must not prevent original/thumbnail
        cleanup (best-effort cleanup)."""
        from app.tasks.media import cleanup_deleted_media

        with patch("app.services.media_processing.delete_derivatives",
                   side_effect=RuntimeError("S3 down")), \
             patch("app.services.uploads.delete_org_media") as mock_delete:
            cleanup_deleted_media(
                organization_id=str(uuid4()),
                media_id=str(uuid4()),
                s3_key="a.jpg",
                thumbnail_key="b.jpg",
            )

        assert mock_delete.call_count == 2

    def test_original_deletion_failure_does_not_stop_thumbnail(self, mock_session):
        from app.tasks.media import cleanup_deleted_media

        calls = []

        def fake_delete(key):
            calls.append(key)
            if key == "a.jpg":
                raise RuntimeError("not found")

        with patch("app.services.media_processing.delete_derivatives"), \
             patch("app.services.uploads.delete_org_media", side_effect=fake_delete):
            cleanup_deleted_media(
                organization_id=str(uuid4()),
                media_id=str(uuid4()),
                s3_key="a.jpg",
                thumbnail_key="b.jpg",
            )

        # Both were attempted even though the original threw.
        assert calls == ["a.jpg", "b.jpg"]


# ===========================================================================
# _complete_transcode (private helper, but reachable via poll path)
# ===========================================================================


class TestCompleteTranscodeHelper:

    def test_creates_video_derivatives_from_outputs(self, mock_session):
        from app.tasks.media import _complete_transcode

        media = _media_stub(media_type="video")
        job = _job_stub(parameters={"mediaconvert_job_id": "mc-1"})

        storage = MagicMock()
        storage.list_objects_sync.return_value = (
            [SimpleNamespace(key="orgs/a/media/m/derivatives/web_mp4_720p/out.mp4",
                             size=10_000)],
            None,
        )

        outputs = [{"group": "web_mp4_720p"}]

        with patch("app.services.storage.get_storage_backend", return_value=storage), \
             patch("app.search.media.MediaSearchService.is_available", return_value=False):
            count = _complete_transcode(
                media=media, job=job, organization_id=str(uuid4()),
                media_id=str(uuid4()), outputs=outputs, session=mock_session,
            )

        assert count == 1
        assert media.processing_status == "completed"
        assert job.status == "completed"

    def test_creates_poster_derivative(self, mock_session):
        from app.tasks.media import _complete_transcode

        media = _media_stub(media_type="video")
        job = _job_stub(parameters={"mediaconvert_job_id": "mc-1"})

        storage = MagicMock()
        storage.list_objects_sync.return_value = (
            [SimpleNamespace(key="orgs/a/media/m/derivatives/poster/first.jpg",
                             size=5000)],
            None,
        )

        outputs = [{"group": "poster"}]

        with patch("app.services.storage.get_storage_backend", return_value=storage), \
             patch("app.search.media.MediaSearchService.is_available", return_value=False):
            count = _complete_transcode(
                media=media, job=job, organization_id=str(uuid4()),
                media_id=str(uuid4()), outputs=outputs, session=mock_session,
            )

        assert count == 1
        assert media.thumbnail_s3_key == "orgs/a/media/m/derivatives/poster/first.jpg"

    def test_storage_list_failure_is_graceful(self, mock_session):
        """list_objects_sync failure still creates the derivative row with
        a prefix s3_key and zero size — doesn't blow up the helper."""
        from app.tasks.media import _complete_transcode

        media = _media_stub(media_type="video")
        job = _job_stub(parameters={"mediaconvert_job_id": "mc-x"})

        storage = MagicMock()
        storage.list_objects_sync.side_effect = RuntimeError("S3 list failed")

        outputs = [{"group": "web_mp4_720p"}]

        with patch("app.services.storage.get_storage_backend", return_value=storage), \
             patch("app.search.media.MediaSearchService.is_available", return_value=False):
            count = _complete_transcode(
                media=media, job=job, organization_id=str(uuid4()),
                media_id=str(uuid4()), outputs=outputs, session=mock_session,
            )

        assert count == 1


# ===========================================================================
# Private helpers: _record_step, _step, _preserve_steps, _identify_format_at_ingest
# ===========================================================================


class TestStepHelpers:

    def test_record_step_appends_and_computes_duration(self, mock_session):
        from app.tasks.media import _record_step

        job = _job_stub()
        # Pre-seed result with a started entry we can complete.
        started_at = (datetime.now(timezone.utc) - timedelta(milliseconds=500)).isoformat()
        job.result = {"steps": [{
            "name": "extract", "label": "Extract", "status": "started",
            "at": started_at,
        }]}

        _record_step(job, "extract", "Extract", "completed", {"width": 100})

        steps = job.result["steps"]
        assert len(steps) == 2
        assert steps[-1]["status"] == "completed"
        assert steps[-1]["details"] == {"width": 100}
        assert steps[-1]["duration_ms"] >= 400

    def test_record_step_no_prior_started_has_no_duration(self, mock_session):
        from app.tasks.media import _record_step

        job = _job_stub()
        job.result = None

        _record_step(job, "foo", "Foo", "started")
        steps = job.result["steps"]
        assert len(steps) == 1
        assert "duration_ms" not in steps[0]

    def test_step_context_records_start_and_complete(self, mock_session):
        from app.tasks.media import _step

        job = _job_stub()
        job.result = None

        with _step(job, "dl", "Download"):
            pass  # success path

        statuses = [s["status"] for s in job.result["steps"]]
        assert statuses == ["started", "completed"]

    def test_step_context_records_failure_on_exception(self, mock_session):
        from app.tasks.media import _step

        job = _job_stub()
        job.result = None

        with pytest.raises(ValueError):
            with _step(job, "dl", "Download"):
                raise ValueError("nope")

        statuses = [s["status"] for s in job.result["steps"]]
        assert statuses == ["started", "failed"]
        assert job.result["steps"][-1]["details"]["error"] == "nope"

    def test_preserve_steps_keeps_existing(self, mock_session):
        from app.tasks.media import _preserve_steps

        job = _job_stub()
        job.result = {"steps": [{"name": "x"}]}

        merged = _preserve_steps(job, {"foo": 1})
        assert merged == {"foo": 1, "steps": [{"name": "x"}]}

    def test_preserve_steps_with_empty_job_result(self, mock_session):
        from app.tasks.media import _preserve_steps

        job = _job_stub()
        job.result = None

        merged = _preserve_steps(job, {"foo": 1})
        assert merged == {"foo": 1}

    def test_identify_format_at_ingest_sets_pronom_fields(self, mock_session):
        from app.tasks.media import _identify_format_at_ingest

        media = _media_stub(mime_type="image/jpeg", filename="x.jpg")

        result = SimpleNamespace(
            pronom_puid="fmt/42",
            format_name="JPEG File Interchange Format",
            risk_level="low",
        )

        with patch("app.services.format_identification.identify_format_by_mime",
                   return_value=result):
            _identify_format_at_ingest(media, mock_session)

        assert media.pronom_puid == "fmt/42"
        assert media.format_name == "JPEG File Interchange Format"
        assert media.format_risk_level == "low"

    def test_identify_format_at_ingest_silent_on_no_match(self, mock_session):
        from app.tasks.media import _identify_format_at_ingest

        media = _media_stub(mime_type="application/unknown")
        result = SimpleNamespace(pronom_puid=None, format_name=None, risk_level=None)

        with patch("app.services.format_identification.identify_format_by_mime",
                   return_value=result):
            _identify_format_at_ingest(media, mock_session)

        # No change to fields.
        # (MagicMock default attributes don't exist on the stub; we just want
        # to make sure it didn't raise.)
        assert getattr(media, "pronom_puid", None) is None

    def test_identify_format_at_ingest_silent_on_exception(self, mock_session):
        """Format identification errors are logged-and-swallowed; upload
        must never abort because of them."""
        from app.tasks.media import _identify_format_at_ingest

        media = _media_stub()

        with patch("app.services.format_identification.identify_format_by_mime",
                   side_effect=RuntimeError("sig file unreadable")):
            # No exception should escape.
            _identify_format_at_ingest(media, mock_session)
