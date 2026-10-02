"""Tests for Whisper Celery tasks."""

from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest


@pytest.fixture
def mock_session():
    """Shared mock session used by the _patch_task_app fixture."""
    return MagicMock()


@pytest.fixture(autouse=True)
def _patch_task_app(mock_session):
    """Bypass standalone DB session and skip PostgreSQL-only RLS in task base classes."""
    from contextlib import contextmanager

    @contextmanager
    def _noop_session():
        yield mock_session

    with patch("app.tasks.base.get_session", _noop_session), \
         patch("app.database.current_session", return_value=mock_session), \
         patch("app.tasks.whisper.current_session", return_value=mock_session), \
         patch("app.tasks.rls_helpers.set_task_rls_context"):
        yield


class TestTranscribeMediaTask:
    """Tests for transcribe_media_task."""

    @patch("app.config.get_settings")
    def test_disabled_returns_early(self, mock_settings):
        mock_settings.return_value = MagicMock(whisper_enabled=False)

        from app.tasks.whisper import transcribe_media_task
        result = transcribe_media_task(str(uuid4()), str(uuid4()))
        assert result["success"] is False
        assert "not enabled" in result["reason"].lower()

    @patch("app.services.whisper_service.transcribe_media")
    @patch("app.config.get_settings")
    def test_success_calls_service(self, mock_settings, mock_transcribe):
        mock_settings.return_value = MagicMock(whisper_enabled=True)
        mock_transcribe.return_value = {
            "success": True,
            "media_id": "abc",
            "language": "en",
            "text_length": 100,
            "segment_count": 5,
        }

        from app.tasks.whisper import transcribe_media_task
        result = transcribe_media_task(str(uuid4()), str(uuid4()))
        assert result["success"] is True
        mock_transcribe.assert_called_once()

    @patch("app.services.whisper_service.transcribe_media", side_effect=RuntimeError("ffmpeg failed"))
    @patch("app.config.get_settings")
    def test_exception_propagates(self, mock_settings, mock_transcribe):
        mock_settings.return_value = MagicMock(whisper_enabled=True)

        from app.tasks.whisper import transcribe_media_task
        with pytest.raises(RuntimeError, match="ffmpeg failed"):
            transcribe_media_task(str(uuid4()), str(uuid4()))


class TestBulkTranscribe:
    """Tests for bulk_transcribe task.

    bulk_transcribe uses current_session() (FastAPI/standalone session accessor)
    rather than the Flask-era app.db.db.session. The _patch_task_app fixture
    patches current_session to return the shared mock_session.
    """

    @patch("app.tasks.whisper.transcribe_media_task")
    def test_bulk_queues_untranscribed_only(self, mock_task, mock_session):
        org_id = uuid4()
        media2_id = uuid4()

        # Return one untranscribed media
        mock_session.query.return_value.filter.return_value.all.return_value = [
            (media2_id,),
        ]

        mock_task.delay = MagicMock()

        from app.tasks.whisper import bulk_transcribe
        result = bulk_transcribe(str(org_id))
        assert result["success"] is True
        assert result["queued"] == 1
        mock_task.delay.assert_called_once()
