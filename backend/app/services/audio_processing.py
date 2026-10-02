"""
Audio processing service for metadata extraction and waveform generation.

Uses mutagen to extract technical metadata from audio files:
- Duration, bitrate, sample rate, channels
- ID3/Vorbis tags (title, artist, album, genre, etc.)
- Dublin Core mapping

Uses ffmpeg to generate pre-computed waveform peaks for instant rendering.
"""

# Annotations are deferred deliberately. mutagen is an OPTIONAL import (it is
# GPL-2.0-or-later and not in the shipped image), but five helpers below
# annotate `mutagen.FileType`. Python evaluates annotations at def time, so
# without this the guarded import is pointless — the module raised NameError
# on import for every default install, taking audio uploads down entirely
# rather than degrading to "no embedded tag metadata" as intended.
from __future__ import annotations
import hashlib
import io
import logging
import struct
import subprocess
import tempfile
from typing import Any

logger = logging.getLogger(__name__)

try:
    import mutagen
    MUTAGEN_AVAILABLE = True
except ImportError:
    MUTAGEN_AVAILABLE = False
    # Expected on a default install. mutagen is GPL-2.0-or-later, so it is not
    # bundled in the shipped image — see requirements-copyleft.txt. Audio
    # uploads still work; they just carry no embedded tag metadata.
    logger.info("mutagen not installed - audio tag extraction disabled")


def process_audio_upload(
    audio_data: bytes,
    organization_id: str,
    media_id: str,
    mime_type: str,
) -> dict[str, Any]:
    """
    Process an audio upload: extract metadata and compute checksum.

    Args:
        audio_data: Raw audio bytes
        organization_id: Organization ID
        media_id: Media record ID
        mime_type: Audio MIME type

    Returns:
        Dict with processing results
    """
    result: dict[str, Any] = {
        "success": True,
        "checksum_sha256": hashlib.sha256(audio_data).hexdigest(),
        "duration_seconds": None,
        "technical_metadata": {},
        "dublin_core": {
            "dc_format": mime_type,
            "dc_type": "Sound",
        },
    }

    if not MUTAGEN_AVAILABLE:
        logger.warning("mutagen not installed, skipping audio metadata for %s", media_id)
        return result

    try:
        audio_file = mutagen.File(io.BytesIO(audio_data))
    except Exception as e:
        logger.warning("Failed to parse audio file %s: %s", media_id, e)
        return result

    if audio_file is None:
        logger.warning("mutagen could not identify audio format for %s", media_id)
        return result

    # -- Technical metadata --
    info = audio_file.info if hasattr(audio_file, "info") else None
    tech: dict[str, Any] = {}

    if info:
        if hasattr(info, "length") and info.length:
            result["duration_seconds"] = round(info.length)
            tech["duration_seconds"] = round(info.length, 2)

        if hasattr(info, "bitrate") and info.bitrate:
            tech["bitrate"] = info.bitrate
            tech["bitrate_kbps"] = round(info.bitrate / 1000)

        if hasattr(info, "sample_rate") and info.sample_rate:
            tech["sample_rate"] = info.sample_rate

        if hasattr(info, "channels") and info.channels:
            tech["channels"] = info.channels

        if hasattr(info, "bits_per_sample") and info.bits_per_sample:
            tech["bits_per_sample"] = info.bits_per_sample

        # Codec info varies by format
        if hasattr(info, "codec"):
            tech["codec"] = str(info.codec)
        elif hasattr(info, "codec_name"):
            tech["codec"] = str(info.codec_name)

    tech["file_format"] = _get_audio_format(mime_type, audio_file)
    result["technical_metadata"] = tech

    # -- Tags → Dublin Core --
    tags = _extract_tags(audio_file)
    dc = result["dublin_core"]

    if tags.get("title"):
        dc["dc_title"] = tags["title"]
    if tags.get("artist"):
        dc["dc_creator"] = tags["artist"]
    if tags.get("album"):
        dc["dc_source"] = tags["album"]
    if tags.get("date"):
        dc["dc_date"] = tags["date"]
    if tags.get("genre"):
        dc["dc_subject"] = tags["genre"]

    result["dublin_core"] = dc

    # Generate waveform peaks for instant frontend rendering
    if is_ffmpeg_available():
        try:
            peaks = _generate_waveform_peaks(audio_data)
            if peaks:
                tech["waveform_peaks"] = peaks
                result["technical_metadata"] = tech
                logger.info("Generated %d waveform peaks for %s", len(peaks), media_id)
        except Exception as e:
            logger.warning("Failed to generate waveform peaks for %s: %s", media_id, e)
    else:
        logger.info("ffmpeg not available, skipping waveform peaks for %s", media_id)

    logger.info(
        "Processed audio %s: duration=%ss, bitrate=%skbps, sample_rate=%s, channels=%s",
        media_id,
        tech.get("duration_seconds"),
        tech.get("bitrate_kbps"),
        tech.get("sample_rate"),
        tech.get("channels"),
    )

    return result


def is_ffmpeg_available() -> bool:
    """Check if ffmpeg is available on the system."""
    try:
        result = subprocess.run(
            ["ffmpeg", "-version"],
            capture_output=True,
            timeout=5,
        )
        return result.returncode == 0
    except (subprocess.SubprocessError, FileNotFoundError):
        return False


def _generate_waveform_peaks(audio_data: bytes, num_bins: int = 800) -> list[float] | None:
    """
    Generate waveform peaks from audio data using ffmpeg.

    Converts audio to raw mono 16-bit PCM at 8kHz, then computes the max
    absolute amplitude per bin. Returns normalized [0.0, 1.0] values.
    """
    with tempfile.NamedTemporaryFile(suffix=".audio", delete=True) as tmp:
        tmp.write(audio_data)
        tmp.flush()

        try:
            proc = subprocess.run(
                [
                    "ffmpeg", "-i", tmp.name,
                    "-ac", "1",           # mono
                    "-ar", "8000",        # 8kHz sample rate
                    "-f", "s16le",        # raw 16-bit signed little-endian PCM
                    "-loglevel", "error",
                    "pipe:1",
                ],
                capture_output=True,
                timeout=60,
            )
        except subprocess.TimeoutExpired:
            logger.warning("ffmpeg timed out generating waveform peaks")
            return None

        if proc.returncode != 0:
            logger.warning("ffmpeg failed: %s", proc.stderr.decode(errors="replace")[:200])
            return None

    raw = proc.stdout
    if len(raw) < 2:
        return None

    # Unpack 16-bit signed samples
    num_samples = len(raw) // 2
    samples = struct.unpack(f"<{num_samples}h", raw[:num_samples * 2])

    if num_samples == 0:
        return None

    # Chunk into bins and compute max absolute amplitude per bin
    samples_per_bin = max(1, num_samples // num_bins)
    peaks: list[float] = []

    for i in range(0, num_samples, samples_per_bin):
        chunk = samples[i:i + samples_per_bin]
        peak = max(abs(s) for s in chunk)
        peaks.append(float(peak))

    if not peaks:
        return None

    # Normalize to [0.0, 1.0]
    max_peak = max(peaks)
    if max_peak > 0:
        peaks = [round(p / max_peak, 3) for p in peaks]
    else:
        peaks = [0.0] * len(peaks)

    return peaks


def _extract_tags(audio_file: mutagen.FileType) -> dict[str, str]:
    """Extract common tags from any audio format mutagen supports."""
    tags: dict[str, str] = {}

    if audio_file.tags is None:
        return tags

    # ID3 tags (MP3, AIFF, etc.)
    _try_id3(audio_file, tags)

    # Vorbis comments (FLAC, OGG)
    _try_vorbis(audio_file, tags)

    # MP4/M4A atoms
    _try_mp4(audio_file, tags)

    return tags


def _try_id3(audio_file: mutagen.FileType, tags: dict[str, str]) -> None:
    """Extract ID3 tags."""
    id3_map = {
        "TIT2": "title",
        "TPE1": "artist",
        "TALB": "album",
        "TDRC": "date",
        "TCON": "genre",
        "TRCK": "track",
    }
    for frame_id, key in id3_map.items():
        frame = audio_file.tags.get(frame_id) if audio_file.tags else None
        if frame:
            tags.setdefault(key, str(frame))


def _try_vorbis(audio_file: mutagen.FileType, tags: dict[str, str]) -> None:
    """Extract Vorbis comments."""
    vorbis_map = {
        "title": "title",
        "artist": "artist",
        "album": "album",
        "date": "date",
        "genre": "genre",
        "tracknumber": "track",
    }
    for vorbis_key, key in vorbis_map.items():
        values = audio_file.tags.get(vorbis_key) if audio_file.tags else None
        if values and isinstance(values, list) and len(values) > 0:
            tags.setdefault(key, str(values[0]))


def _try_mp4(audio_file: mutagen.FileType, tags: dict[str, str]) -> None:
    """Extract MP4/M4A atoms."""
    mp4_map = {
        "\xa9nam": "title",
        "\xa9ART": "artist",
        "\xa9alb": "album",
        "\xa9day": "date",
        "\xa9gen": "genre",
    }
    for atom, key in mp4_map.items():
        values = audio_file.tags.get(atom) if audio_file.tags else None
        if values and isinstance(values, list) and len(values) > 0:
            tags.setdefault(key, str(values[0]))


def _get_audio_format(mime_type: str, audio_file: mutagen.FileType) -> str:
    """Get human-readable format name."""
    mime_to_format = {
        "audio/mpeg": "MP3",
        "audio/mp3": "MP3",
        "audio/mp4": "AAC/M4A",
        "audio/x-m4a": "AAC/M4A",
        "audio/aac": "AAC",
        "audio/flac": "FLAC",
        "audio/x-flac": "FLAC",
        "audio/ogg": "OGG Vorbis",
        "audio/wav": "WAV",
        "audio/x-wav": "WAV",
        "audio/aiff": "AIFF",
        "audio/x-aiff": "AIFF",
        "audio/webm": "WebM Audio",
    }
    fmt = mime_to_format.get(mime_type)
    if fmt:
        return fmt

    # Fall back to mutagen's type detection
    type_name = type(audio_file).__name__
    return type_name if type_name != "FileType" else mime_type
