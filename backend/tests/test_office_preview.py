"""Tests for office preview service."""

from unittest.mock import MagicMock, patch

import pytest

from app.services.office_preview import (
    CONVERTIBLE_MIME_TYPES,
    convert_to_pdf,
    is_convertible,
)


class TestIsConvertible:
    """Tests for is_convertible()."""

    def test_docx_is_convertible(self):
        assert is_convertible("application/vnd.openxmlformats-officedocument.wordprocessingml.document") is True

    def test_xlsx_is_convertible(self):
        assert is_convertible("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") is True

    def test_pptx_is_convertible(self):
        assert is_convertible("application/vnd.openxmlformats-officedocument.presentationml.presentation") is True

    def test_pdf_not_convertible(self):
        assert is_convertible("application/pdf") is False

    def test_image_not_convertible(self):
        assert is_convertible("image/jpeg") is False

    def test_all_convertible_types(self):
        for mime in CONVERTIBLE_MIME_TYPES:
            assert is_convertible(mime) is True


class TestConvertToPdf:
    """Tests for convert_to_pdf()."""

    @patch("app.services.office_preview.get_settings")
    def test_disabled_raises(self, mock_settings):
        mock_settings.return_value = MagicMock(unoserver_enabled=False)
        with pytest.raises(RuntimeError, match="not enabled"):
            convert_to_pdf("/tmp/test.docx", "/tmp/test.pdf")

    @patch("app.services.office_preview.subprocess.run")
    @patch("app.services.office_preview.get_settings")
    def test_subprocess_error(self, mock_settings, mock_run):
        mock_settings.return_value = MagicMock(
            unoserver_enabled=True,
            unoserver_host="localhost",
            unoserver_port=2003,
        )
        mock_run.return_value = MagicMock(
            returncode=1,
            stderr=b"LibreOffice crashed",
        )
        with pytest.raises(RuntimeError, match="unoconvert failed"):
            convert_to_pdf("/tmp/test.docx", "/tmp/test.pdf")

    @patch("app.services.office_preview.subprocess.run", side_effect=FileNotFoundError)
    @patch("app.services.office_preview.get_settings")
    def test_unoconvert_not_found(self, mock_settings, mock_run):
        mock_settings.return_value = MagicMock(
            unoserver_enabled=True,
            unoserver_host="localhost",
            unoserver_port=2003,
        )
        with pytest.raises(RuntimeError, match="unoconvert not found"):
            convert_to_pdf("/tmp/test.docx", "/tmp/test.pdf")
