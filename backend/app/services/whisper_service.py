"""
Whisper transcription service.

Provides:
- Audio/video transcription via faster-whisper
- SRT/VTT subtitle generation
- Transcript storage and alternative file creation
"""

import logging
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any
from uuid import UUID

from app.config import get_settings
from app.database import current_session

logger = logging.getLogger(__name__)

# Module-level model cache
_whisper_model = None


def _load_whisper_model():
    """Load faster-whisper model once per worker process."""
    global _whisper_model

    if _whisper_model is not None:
        return

    settings = get_settings()
    if not settings.whisper_enabled:
        raise RuntimeError("Whisper is not enabled. Set WHISPER_ENABLED=true.")

    from faster_whisper import WhisperModel

    device = settings.whisper_device
    compute_type = "float32" if device == "cpu" else "float16"

    _whisper_model = WhisperModel(
        settings.whisper_model,
        device=device,
        compute_type=compute_type,
    )
    logger.info("Whisper model '%s' loaded on %s", settings.whisper_model, device)


def _convert_to_wav(input_path: str, output_path: str) -> None:
    """Convert audio/video to 16kHz mono WAV via ffmpeg."""
    cmd = [
        "ffmpeg", "-i", input_path,
        "-ac", "1",        # mono
        "-ar", "16000",    # 16kHz
        "-f", "wav",
        "-y",              # overwrite
        output_path,
    ]
    result = subprocess.run(cmd, capture_output=True, timeout=300)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg conversion failed: {result.stderr.decode()[:500]}")


def _format_timestamp_srt(seconds: float) -> str:
    """Format seconds as SRT timestamp HH:MM:SS,mmm."""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def _format_timestamp_vtt(seconds: float) -> str:
    """Format seconds as VTT timestamp HH:MM:SS.mmm."""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{millis:03d}"


def transcribe(audio_path: str) -> dict[str, Any]:
    """
    Transcribe an audio file using faster-whisper.

    Args:
        audio_path: Path to audio file (WAV, MP3, etc.)

    Returns:
        Dict with keys: text, language, segments
    """
    _load_whisper_model()

    segments_iter, info = _whisper_model.transcribe(
        audio_path,
        beam_size=5,
        vad_filter=True,
    )

    segments = []
    full_text_parts = []

    for segment in segments_iter:
        segments.append({
            "start": segment.start,
            "end": segment.end,
            "text": segment.text.strip(),
        })
        full_text_parts.append(segment.text.strip())

    return {
        "text": " ".join(full_text_parts),
        "language": info.language,
        "segments": segments,
        "duration": info.duration,
    }


def generate_srt(segments: list[dict]) -> str:
    """Generate SRT subtitle content from segments."""
    lines = []
    for i, seg in enumerate(segments, 1):
        start = _format_timestamp_srt(seg["start"])
        end = _format_timestamp_srt(seg["end"])
        lines.append(f"{i}")
        lines.append(f"{start} --> {end}")
        lines.append(seg["text"])
        lines.append("")
    return "\n".join(lines)


def generate_vtt(segments: list[dict]) -> str:
    """Generate WebVTT subtitle content from segments."""
    lines = ["WEBVTT", ""]
    for seg in segments:
        start = _format_timestamp_vtt(seg["start"])
        end = _format_timestamp_vtt(seg["end"])
        lines.append(f"{start} --> {end}")
        lines.append(seg["text"])
        lines.append("")
    return "\n".join(lines)


def transcribe_media(
    media_id: UUID,
    organization_id: UUID,
) -> dict[str, Any]:
    """
    Full transcription pipeline for a media item.

    1. Download original from S3
    2. Convert to WAV
    3. Run Whisper
    4. Store transcript in Media record
    5. Generate SRT/VTT and upload as alternatives

    Returns:
        Dict with transcript info
    """
    from app.models import Media, MediaAlternative
    from app.services.uploads import get_s3_client, get_media_bucket, DEFAULT_REGION

    media = current_session().query(Media).filter_by(
        media_id=media_id,
        organization_id=organization_id,
    ).first()

    if not media:
        raise ValueError(f"Media not found: {media_id}")

    if media.media_type not in ("video", "audio"):
        raise ValueError(f"Cannot transcribe media type: {media.media_type}")

    media.transcription_status = "processing"
    current_session().commit()

    try:
        # Region, not organization id — see app/services/uploads.py.
        s3_client = get_s3_client()
        bucket = get_media_bucket(DEFAULT_REGION)

        with tempfile.TemporaryDirectory() as tmpdir:
            # Download original
            original_path = os.path.join(tmpdir, media.filename)
            s3_client.download_file(bucket, media.s3_key, original_path)

            # Convert to WAV
            wav_path = os.path.join(tmpdir, "audio.wav")
            _convert_to_wav(original_path, wav_path)

            # Transcribe
            result = transcribe(wav_path)

            # Update media record
            settings = get_settings()
            media.transcript = result["text"]
            media.transcript_language = result["language"]
            media.transcription_status = "completed"
            media.transcription_model = settings.whisper_model

            # Generate and upload SRT
            if result["segments"]:
                srt_content = generate_srt(result["segments"])
                srt_filename = f"{Path(media.filename).stem}.srt"
                srt_key = f"orgs/{organization_id}/media/alternatives/{media_id}/{srt_filename}"
                srt_bytes = srt_content.encode("utf-8")

                s3_client.put_object(
                    Bucket=bucket,
                    Key=srt_key,
                    Body=srt_bytes,
                    ContentType="application/x-subrip",
                )

                srt_alt = MediaAlternative(
                    media_id=media_id,
                    organization_id=organization_id,
                    alternative_type="subtitle_srt",
                    label="Whisper SRT",
                    s3_key=srt_key,
                    filename=srt_filename,
                    file_size=len(srt_bytes),
                    mime_type="application/x-subrip",
                    generated_by="whisper",
                    generation_params={
                        "model": settings.whisper_model,
                        "language": result["language"],
                    },
                    sort_order=0,
                )
                current_session().add(srt_alt)

                # Generate and upload VTT
                vtt_content = generate_vtt(result["segments"])
                vtt_filename = f"{Path(media.filename).stem}.vtt"
                vtt_key = f"orgs/{organization_id}/media/alternatives/{media_id}/{vtt_filename}"
                vtt_bytes = vtt_content.encode("utf-8")

                s3_client.put_object(
                    Bucket=bucket,
                    Key=vtt_key,
                    Body=vtt_bytes,
                    ContentType="text/vtt",
                )

                vtt_alt = MediaAlternative(
                    media_id=media_id,
                    organization_id=organization_id,
                    alternative_type="subtitle_vtt",
                    label="Whisper VTT",
                    s3_key=vtt_key,
                    filename=vtt_filename,
                    file_size=len(vtt_bytes),
                    mime_type="text/vtt",
                    generated_by="whisper",
                    generation_params={
                        "model": settings.whisper_model,
                        "language": result["language"],
                    },
                    sort_order=1,
                )
                current_session().add(vtt_alt)

            current_session().commit()

            return {
                "success": True,
                "media_id": str(media_id),
                "language": result["language"],
                "text_length": len(result["text"]),
                "segment_count": len(result["segments"]),
            }

    except Exception as e:
        logger.error("Transcription failed for media %s: %s", media_id, e)
        media.transcription_status = "failed"
        current_session().commit()
        raise
