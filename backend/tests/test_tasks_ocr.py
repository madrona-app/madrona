"""Tests for OCR Celery tasks."""

from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest


@pytest.fixture(autouse=True)
def _patch_task_app():
    """Bypass standalone DB session and skip PostgreSQL-only RLS in task base classes."""
    from contextlib import contextmanager

    mock_session = MagicMock()

    @contextmanager
    def _noop_session():
        yield mock_session

    with patch("app.tasks.base.get_session", _noop_session), \
         patch("app.database.current_session", return_value=mock_session), \
         patch("app.tasks.rls_helpers.set_task_rls_context"):
        yield


class TestProcessMediaOcrTask:
    """Tests for process_media_ocr_task."""

    @patch("app.config.get_settings")
    def test_disabled_returns_early(self, mock_settings):
        mock_settings.return_value = MagicMock(ocr_enabled=False)

        from app.tasks.ocr import process_media_ocr_task
        result = process_media_ocr_task(str(uuid4()), str(uuid4()))
        assert result["success"] is False
        assert "not enabled" in result["reason"].lower()

    @patch("app.services.ocr_service.process_media_ocr")
    @patch("app.config.get_settings")
    def test_success_calls_service(self, mock_settings, mock_ocr):
        mock_settings.return_value = MagicMock(ocr_enabled=True)
        mock_ocr.return_value = {
            "success": True,
            "media_id": "abc",
            "text_length": 200,
        }

        from app.tasks.ocr import process_media_ocr_task
        result = process_media_ocr_task(str(uuid4()), str(uuid4()))
        assert result["success"] is True
        mock_ocr.assert_called_once()

    @patch("app.services.ocr_service.process_media_ocr", side_effect=ValueError("Media not found"))
    @patch("app.config.get_settings")
    def test_exception_propagates(self, mock_settings, mock_ocr):
        mock_settings.return_value = MagicMock(ocr_enabled=True)

        from app.tasks.ocr import process_media_ocr_task
        with pytest.raises(ValueError, match="Media not found"):
            process_media_ocr_task(str(uuid4()), str(uuid4()))
