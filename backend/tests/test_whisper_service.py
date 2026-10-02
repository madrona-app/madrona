"""Tests for Whisper transcription service."""

from unittest.mock import MagicMock, patch

import pytest

from app.services.whisper_service import (
    _convert_to_wav,
    _format_timestamp_srt,
    _format_timestamp_vtt,
    generate_srt,
    generate_vtt,
)


class TestFormatTimestampSrt:
    """Tests for _format_timestamp_srt()."""

    def test_zero(self):
        assert _format_timestamp_srt(0) == "00:00:00,000"

    def test_simple_seconds(self):
        assert _format_timestamp_srt(5.0) == "00:00:05,000"

    def test_with_milliseconds(self):
        assert _format_timestamp_srt(1.5) == "00:00:01,500"

    def test_minutes(self):
        assert _format_timestamp_srt(65.0) == "00:01:05,000"

    def test_hours(self):
        assert _format_timestamp_srt(3661.5) == "01:01:01,500"

    def test_precise_milliseconds(self):
        assert _format_timestamp_srt(0.123) == "00:00:00,123"


class TestFormatTimestampVtt:
    """Tests for _format_timestamp_vtt()."""

    def test_zero(self):
        assert _format_timestamp_vtt(0) == "00:00:00.000"

    def test_uses_dot_separator(self):
        result = _format_timestamp_vtt(1.5)
        assert "." in result
        assert "," not in result
        assert result == "00:00:01.500"

    def test_hours(self):
        assert _format_timestamp_vtt(3661.5) == "01:01:01.500"


class TestGenerateSrt:
    """Tests for generate_srt()."""

    def test_single_segment(self):
        segments = [{"start": 0.0, "end": 2.5, "text": "Hello world"}]
        result = generate_srt(segments)
        assert "1\n" in result
        assert "00:00:00,000 --> 00:00:02,500" in result
        assert "Hello world" in result

    def test_multi_segments(self):
        segments = [
            {"start": 0.0, "end": 2.0, "text": "First"},
            {"start": 2.5, "end": 5.0, "text": "Second"},
        ]
        result = generate_srt(segments)
        assert "1\n" in result
        assert "2\n" in result
        assert "First" in result
        assert "Second" in result

    def test_empty_segments(self):
        result = generate_srt([])
        assert result == ""

    def test_numbering_sequential(self):
        segments = [
            {"start": 0, "end": 1, "text": "A"},
            {"start": 1, "end": 2, "text": "B"},
            {"start": 2, "end": 3, "text": "C"},
        ]
        result = generate_srt(segments)
        lines = result.strip().split("\n")
        # Numbers are at indices 0, 4, 8
        assert lines[0] == "1"
        assert lines[4] == "2"
        assert lines[8] == "3"


class TestGenerateVtt:
    """Tests for generate_vtt()."""

    def test_starts_with_webvtt_header(self):
        segments = [{"start": 0.0, "end": 1.0, "text": "Hi"}]
        result = generate_vtt(segments)
        assert result.startswith("WEBVTT")

    def test_single_segment(self):
        segments = [{"start": 0.0, "end": 2.5, "text": "Hello"}]
        result = generate_vtt(segments)
        assert "00:00:00.000 --> 00:00:02.500" in result
        assert "Hello" in result

    def test_empty_segments(self):
        result = generate_vtt([])
        assert result.startswith("WEBVTT")
        assert result.strip() == "WEBVTT"


class TestConvertToWav:
    """Tests for _convert_to_wav() with mocked subprocess."""

    @patch("app.services.whisper_service.subprocess.run")
    def test_calls_ffmpeg_with_correct_args(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0)
        _convert_to_wav("/tmp/input.mp4", "/tmp/output.wav")

        mock_run.assert_called_once()
        cmd = mock_run.call_args[0][0]
        assert cmd[0] == "ffmpeg"
        assert "-i" in cmd
        assert "/tmp/input.mp4" in cmd
        assert "/tmp/output.wav" in cmd
        assert "-ac" in cmd
        assert "1" in cmd
        assert "-ar" in cmd
        assert "16000" in cmd

    @patch("app.services.whisper_service.subprocess.run")
    def test_raises_on_ffmpeg_failure(self, mock_run):
        mock_run.return_value = MagicMock(
            returncode=1,
            stderr=b"Error: file not found",
        )
        with pytest.raises(RuntimeError, match="ffmpeg conversion failed"):
            _convert_to_wav("/tmp/bad.mp4", "/tmp/out.wav")
