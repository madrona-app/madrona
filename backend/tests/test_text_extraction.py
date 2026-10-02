"""Tests for text extraction service."""

import sys
from unittest.mock import MagicMock, patch

import pytest

from app.services.text_extraction import extract_text


def _install_chardet_mock():
    """Install a mock chardet module that returns utf-8."""
    mock_chardet = MagicMock()
    mock_chardet.detect.return_value = {"encoding": "utf-8"}
    return mock_chardet


class TestExtractTextFromHtml:
    """Tests for HTML extraction via extract_text()."""

    def _setup_mocks(self):
        """Set up mock bs4 and chardet modules."""
        mock_chardet = _install_chardet_mock()

        mock_soup_instance = MagicMock()
        mock_soup_class = MagicMock(return_value=mock_soup_instance)

        mock_bs4 = MagicMock()
        mock_bs4.BeautifulSoup = mock_soup_class

        return mock_chardet, mock_bs4, mock_soup_instance

    def test_html_dispatches_and_strips_scripts(self):
        mock_chardet, mock_bs4, mock_soup = self._setup_mocks()
        mock_soup.get_text.return_value = "Hello content"
        mock_soup.__call__ = MagicMock(return_value=[])

        with patch.dict(sys.modules, {"chardet": mock_chardet, "bs4": mock_bs4}):
            from app.services.text_extraction import extract_text_from_html
            result = extract_text_from_html(b"<script>bad</script><p>Hello content</p>")

        assert isinstance(result, str)

    @patch("app.services.text_extraction.extract_text_from_html")
    def test_html_dispatch(self, mock_html):
        mock_html.return_value = "Extracted text"
        result = extract_text(b"<p>test</p>", "text/html")
        assert result == "Extracted text"

    @patch("app.services.text_extraction.extract_text_from_html")
    def test_html_nested_elements(self, mock_html):
        mock_html.return_value = "Item 1\nItem 2"
        result = extract_text(b"<ul><li>Item 1</li></ul>", "text/html")
        assert "Item 1" in result


class TestExtractTextFromTxt:
    """Tests for TXT extraction."""

    def test_utf8_decode(self):
        mock_chardet = _install_chardet_mock()
        with patch.dict(sys.modules, {"chardet": mock_chardet}):
            from app.services.text_extraction import extract_text_from_txt
            result = extract_text_from_txt("Hello, World!".encode("utf-8"))
        assert result == "Hello, World!"

    def test_encoding_detection_called(self):
        mock_chardet = _install_chardet_mock()
        with patch.dict(sys.modules, {"chardet": mock_chardet}):
            from app.services.text_extraction import extract_text_from_txt
            result = extract_text_from_txt("Test text".encode("utf-8"))
        assert result == "Test text"
        mock_chardet.detect.assert_called()

    @patch("app.services.text_extraction.extract_text_from_txt")
    def test_txt_dispatch(self, mock_txt):
        mock_txt.return_value = "Plain text"
        result = extract_text(b"data", "text/plain")
        assert result == "Plain text"


class TestExtractTextFromDocx:
    """Tests for DOCX/ODT/RTF extraction with mocked parsers."""

    @patch("app.services.text_extraction.extract_text_from_docx")
    def test_docx_extraction(self, mock_docx):
        mock_docx.return_value = "Paragraph 1\n\nParagraph 2"
        result = extract_text(b"fake_data", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        assert "Paragraph 1" in result
        assert "Paragraph 2" in result

    @patch("app.services.text_extraction.extract_text_from_odt")
    def test_odt_extraction(self, mock_odt):
        mock_odt.return_value = "ODT content here"
        result = extract_text(b"fake_data", "application/vnd.oasis.opendocument.text")
        assert result == "ODT content here"

    @patch("app.services.text_extraction.extract_text_from_rtf")
    def test_rtf_extraction(self, mock_rtf):
        mock_rtf.return_value = "RTF content"
        result = extract_text(b"fake_data", "application/rtf")
        assert result == "RTF content"


class TestExtractText:
    """Tests for the main extract_text() dispatcher."""

    def test_unsupported_mime_returns_none(self):
        result = extract_text(b"data", "application/pdf")
        assert result is None

    def test_unknown_mime_returns_none(self):
        result = extract_text(b"data", "video/mp4")
        assert result is None

    @patch("app.services.text_extraction.extract_text_from_docx", side_effect=Exception("parse error"))
    def test_exception_handled_gracefully(self, mock_docx):
        result = extract_text(b"bad_data", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        assert result is None
