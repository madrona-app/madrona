"""
Video processing service for metadata extraction and integrity verification.

Handles video files for:
- Extracting technical metadata (duration, resolution, codec, framerate)
- Computing checksums for integrity verification
- Retrieving derivative information from S3

Uses FFprobe for metadata extraction when available.
"""

import hashlib
import json
import logging
import os
import subprocess
import tempfile
from dataclasses import dataclass
from typing import Any

import boto3

logger = logging.getLogger(__name__)


@dataclass
class VideoMetadata:
    """Extracted video metadata."""
    duration_seconds: float | None = None
    width: int | None = None
    height: int | None = None
    video_codec: str | None = None
    audio_codec: str | None = None
    video_bitrate: int | None = None
    audio_bitrate: int | None = None
    framerate: float | None = None
    audio_channels: int | None = None
    audio_sample_rate: int | None = None
    container_format: str | None = None
    file_size: int | None = None


def is_ffprobe_available() -> bool:
    """Check if FFprobe is available on the system."""
    try:
        result = subprocess.run(
            ["ffprobe", "-version"],
            capture_output=True,
            timeout=5
        )
        return result.returncode == 0
    except (subprocess.SubprocessError, FileNotFoundError):
        return False


def extract_video_metadata(video_data: bytes) -> VideoMetadata | None:
    """
    Extract metadata from video data using FFprobe.

    Args:
        video_data: Raw video bytes

    Returns:
        VideoMetadata object or None if extraction fails
    """
    if not is_ffprobe_available():
        logger.warning("FFprobe not available - video metadata extraction disabled")
        return None

    try:
        # Write video data to temporary file for FFprobe
        with tempfile.NamedTemporaryFile(suffix='.mp4', delete=False) as tmp_file:
            tmp_file.write(video_data)
            tmp_path = tmp_file.name

        try:
            # Run FFprobe to get JSON metadata
            result = subprocess.run(
                [
                    "ffprobe",
                    "-v", "quiet",
                    "-print_format", "json",
                    "-show_format",
                    "-show_streams",
                    tmp_path
                ],
                capture_output=True,
                text=True,
                timeout=30
            )

            if result.returncode != 0:
                logger.error(f"FFprobe failed: {result.stderr}")
                return None

            probe_data = json.loads(result.stdout)
            return _parse_ffprobe_output(probe_data, len(video_data))

        finally:
            # Clean up temporary file
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)

    except Exception as e:
        logger.error(f"Failed to extract video metadata: {e}")
        return None


def extract_video_metadata_from_s3(
    s3_client,
    bucket: str,
    key: str,
    max_probe_bytes: int = 50 * 1024 * 1024  # 50MB max for probing
) -> VideoMetadata | None:
    """
    Extract metadata from a video file in S3.

    For large files, downloads only the beginning for format detection,
    but reports full file size.

    Args:
        s3_client: Boto3 S3 client
        bucket: S3 bucket name
        key: S3 object key
        max_probe_bytes: Maximum bytes to download for probing

    Returns:
        VideoMetadata object or None if extraction fails
    """
    if not is_ffprobe_available():
        logger.warning("FFprobe not available - video metadata extraction disabled")
        return None

    try:
        # Get object metadata first
        head_response = s3_client.head_object(Bucket=bucket, Key=key)
        file_size = head_response.get('ContentLength', 0)

        # Download file (or partial for large files)
        if file_size <= max_probe_bytes:
            response = s3_client.get_object(Bucket=bucket, Key=key)
            video_data = response['Body'].read()
        else:
            # For large files, download first chunk + seek to get duration
            # This is a simplification; full metadata may require full file
            response = s3_client.get_object(
                Bucket=bucket,
                Key=key,
                Range=f"bytes=0-{max_probe_bytes - 1}"
            )
            video_data = response['Body'].read()
            logger.info(f"Large video file ({file_size} bytes), probing first {max_probe_bytes} bytes")

        metadata = extract_video_metadata(video_data)
        if metadata:
            metadata.file_size = file_size

        return metadata

    except Exception as e:
        logger.error(f"Failed to extract video metadata from S3: {e}")
        return None


def _parse_ffprobe_output(probe_data: dict, file_size: int) -> VideoMetadata:
    """Parse FFprobe JSON output into VideoMetadata."""
    metadata = VideoMetadata(file_size=file_size)

    # Parse format information
    format_info = probe_data.get('format', {})
    if format_info:
        duration = format_info.get('duration')
        if duration:
            metadata.duration_seconds = float(duration)
        metadata.container_format = format_info.get('format_name')

    # Parse streams
    streams = probe_data.get('streams', [])

    for stream in streams:
        codec_type = stream.get('codec_type')

        if codec_type == 'video':
            metadata.video_codec = stream.get('codec_name')
            metadata.width = stream.get('width')
            metadata.height = stream.get('height')

            # Parse framerate (could be "30/1" or "29.97")
            framerate_str = stream.get('r_frame_rate') or stream.get('avg_frame_rate')
            if framerate_str:
                metadata.framerate = _parse_framerate(framerate_str)

            # Video bitrate
            bit_rate = stream.get('bit_rate')
            if bit_rate:
                metadata.video_bitrate = int(bit_rate)

        elif codec_type == 'audio':
            metadata.audio_codec = stream.get('codec_name')
            metadata.audio_channels = stream.get('channels')

            sample_rate = stream.get('sample_rate')
            if sample_rate:
                metadata.audio_sample_rate = int(sample_rate)

            bit_rate = stream.get('bit_rate')
            if bit_rate:
                metadata.audio_bitrate = int(bit_rate)

    return metadata


def _parse_framerate(framerate_str: str) -> float | None:
    """Parse framerate string like '30/1' or '29.97' to float."""
    try:
        if '/' in framerate_str:
            num, den = framerate_str.split('/')
            return float(num) / float(den)
        return float(framerate_str)
    except (ValueError, ZeroDivisionError):
        return None


def compute_video_checksum(video_data: bytes) -> str:
    """Compute SHA-256 checksum of video data."""
    return hashlib.sha256(video_data).hexdigest()


def get_s3_object_size(s3_client, bucket: str, key: str) -> int | None:
    """Get the size of an S3 object."""
    try:
        response = s3_client.head_object(Bucket=bucket, Key=key)
        return response.get('ContentLength')
    except Exception as e:
        logger.warning(f"Failed to get S3 object size for {key}: {e}")
        return None


def get_derivative_info_from_s3(
    s3_client,
    bucket: str,
    derivative_prefix: str,
) -> dict[str, Any]:
    """
    Get information about video derivatives from S3.

    Lists objects under the derivative prefix and returns their sizes.

    Args:
        s3_client: Boto3 S3 client
        bucket: S3 bucket name
        derivative_prefix: S3 prefix where derivatives are stored

    Returns:
        Dict mapping derivative paths to their sizes
    """
    try:
        response = s3_client.list_objects_v2(
            Bucket=bucket,
            Prefix=derivative_prefix
        )

        derivatives = {}
        for obj in response.get('Contents', []):
            key = obj['Key']
            size = obj['Size']
            derivatives[key] = {
                'size': size,
                'last_modified': obj.get('LastModified'),
            }

        return derivatives

    except Exception as e:
        logger.error(f"Failed to list derivatives at {derivative_prefix}: {e}")
        return {}


def build_video_technical_metadata(metadata: VideoMetadata) -> dict[str, Any]:
    """
    Build technical_metadata dict for storage in Media record.

    Args:
        metadata: VideoMetadata object

    Returns:
        Dict suitable for storing in Media.technical_metadata
    """
    result = {
        'file_format': 'Video',
        'container': metadata.container_format,
    }

    if metadata.video_codec:
        result['video_codec'] = metadata.video_codec
    if metadata.audio_codec:
        result['audio_codec'] = metadata.audio_codec
    if metadata.width and metadata.height:
        result['resolution'] = f"{metadata.width}x{metadata.height}"
    if metadata.framerate:
        result['framerate'] = round(metadata.framerate, 2)
    if metadata.video_bitrate:
        result['video_bitrate_kbps'] = metadata.video_bitrate // 1000
    if metadata.audio_bitrate:
        result['audio_bitrate_kbps'] = metadata.audio_bitrate // 1000
    if metadata.audio_channels:
        result['audio_channels'] = metadata.audio_channels
    if metadata.audio_sample_rate:
        result['audio_sample_rate'] = metadata.audio_sample_rate

    return result


def build_video_dublin_core(metadata: VideoMetadata, mime_type: str) -> dict[str, Any]:
    """
    Build Dublin Core metadata dict for video.

    Args:
        metadata: VideoMetadata object
        mime_type: Video MIME type

    Returns:
        Dict suitable for storing in Media.dublin_core
    """
    return {
        'dc_format': mime_type,
        'dc_type': 'MovingImage',
    }
# NOTE: Local video processing (fallback) was removed.
# MediaConvert is required for all video uploads.
