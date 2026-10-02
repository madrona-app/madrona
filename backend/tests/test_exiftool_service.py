"""Tests for ExifTool service."""

import json
from unittest.mock import MagicMock, patch

import pytest

from app.services.exiftool_service import (
    embed_madrona_metadata,
    read_all_metadata,
    read_metadata_grouped,
    write_metadata,
)


class TestReadAllMetadata:
    """Tests for read_all_metadata()."""

    @patch("app.services.exiftool_service._run_exiftool")
    def test_parse_json_output(self, mock_run):
        mock_run.return_value = json.dumps([{
            "EXIF:Make": "Canon",
            "EXIF:Model": "EOS R5",
            "IPTC:Caption-Abstract": "A photo",
        }])
        result = read_all_metadata("/tmp/test.jpg")
        assert result["EXIF:Make"] == "Canon"
        assert result["EXIF:Model"] == "EOS R5"

    @patch("app.services.exiftool_service._run_exiftool")
    def test_empty_output(self, mock_run):
        mock_run.return_value = "[]"
        result = read_all_metadata("/tmp/test.jpg")
        assert result == {}

    @patch("app.services.exiftool_service._run_exiftool")
    def test_invalid_json_returns_empty(self, mock_run):
        mock_run.return_value = "not json"
        result = read_all_metadata("/tmp/test.jpg")
        assert result == {}


class TestReadMetadataGrouped:
    """Tests for read_metadata_grouped()."""

    @patch("app.services.exiftool_service._run_exiftool")
    def test_groups_by_category(self, mock_run):
        mock_run.return_value = json.dumps([{
            "EXIF:Make": "Canon",
            "IPTC:Caption-Abstract": "Caption",
            "XMP:Creator": "John",
            "ICC-header:ProfileDescription": "sRGB",
            "File:FileType": "JPEG",
        }])
        result = read_metadata_grouped("/tmp/test.jpg")
        assert result["exif"]["Make"] == "Canon"
        assert result["iptc"]["Caption-Abstract"] == "Caption"
        assert result["xmp"]["Creator"] == "John"
        assert result["file"]["FileType"] == "JPEG"

    @patch("app.services.exiftool_service._run_exiftool")
    def test_empty_metadata(self, mock_run):
        mock_run.return_value = "[]"
        result = read_metadata_grouped("/tmp/test.jpg")
        assert result == {}


class TestWriteMetadata:
    """Tests for write_metadata()."""

    @patch("app.services.exiftool_service._run_exiftool")
    def test_build_write_args(self, mock_run):
        mock_run.return_value = ""
        write_metadata("/tmp/test.jpg", {"IPTC:Caption-Abstract": "My caption"})

        mock_run.assert_called_once()
        args = mock_run.call_args[0][0]
        assert "-overwrite_original" in args
        assert "-IPTC:Caption-Abstract=My caption" in args
        assert "/tmp/test.jpg" in args


class TestEmbedMadronaMetadata:
    """Tests for embed_madrona_metadata()."""

    @patch("app.services.exiftool_service.write_metadata")
    def test_embeds_title(self, mock_write):
        embed_madrona_metadata("/tmp/test.jpg", media_title="Test Title")
        mock_write.assert_called_once()
        metadata = mock_write.call_args[0][1]
        assert metadata["IPTC:ObjectName"] == "Test Title"
        assert metadata["XMP:Title"] == "Test Title"

    @patch("app.services.exiftool_service.write_metadata")
    def test_embeds_all_fields(self, mock_write):
        embed_madrona_metadata(
            "/tmp/test.jpg",
            media_title="Title",
            media_description="Description",
            creator="Author",
            copyright_notice="(c) 2024",
            keywords=["art", "photo"],
        )
        metadata = mock_write.call_args[0][1]
        assert metadata["XMP:Description"] == "Description"
        assert metadata["IPTC:By-line"] == "Author"
        assert metadata["IPTC:CopyrightNotice"] == "(c) 2024"

    @patch("app.services.exiftool_service.write_metadata")
    def test_skips_none_fields(self, mock_write):
        embed_madrona_metadata("/tmp/test.jpg")
        mock_write.assert_not_called()
