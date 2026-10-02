"""
Video transcoding service using AWS MediaConvert.

Provides automated video transcoding to web-optimized formats:
- MP4 (H.264) for broad compatibility
- WebM (VP9) for modern browsers
- HLS for adaptive streaming (optional)

Also extracts poster images from video frames.
"""

import logging
import os
from dataclasses import dataclass
from typing import Any
from uuid import UUID

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)


@dataclass
class TranscodeOutput:
    """Result of a transcode operation."""
    job_id: str
    status: str
    outputs: list[dict[str, Any]]


@dataclass
class VideoDerivative:
    """Specification for a video derivative."""
    name: str
    container: str  # 'mp4', 'webm'
    codec: str  # 'H_264', 'VP9'
    width: int | None  # None = preserve aspect ratio
    height: int | None
    bitrate_kbps: int
    audio_bitrate_kbps: int = 128


# Standard derivative presets
DERIVATIVE_PRESETS = {
    "web_mp4_1080p": VideoDerivative(
        name="web_mp4_1080p",
        container="mp4",
        codec="H_264",
        width=1920,
        height=1080,
        bitrate_kbps=5000,
    ),
    "web_mp4_720p": VideoDerivative(
        name="web_mp4_720p",
        container="mp4",
        codec="H_264",
        width=1280,
        height=720,
        bitrate_kbps=2500,
    ),
    "web_mp4_480p": VideoDerivative(
        name="web_mp4_480p",
        container="mp4",
        codec="H_264",
        width=854,
        height=480,
        bitrate_kbps=1000,
    ),
    "web_webm_720p": VideoDerivative(
        name="web_webm_720p",
        container="webm",
        codec="VP9",
        width=1280,
        height=720,
        bitrate_kbps=2000,
    ),
}


def specs_to_video_derivatives(specs: list) -> list[VideoDerivative]:
    """Convert DerivativeSpec objects (from DB) to VideoDerivative objects.

    Each spec's ``config`` JSONB provides codec, container, and bitrate.
    Specs whose config lacks a ``codec`` key are skipped (e.g. poster frames
    are handled separately).
    """
    results = []
    for spec in specs:
        cfg = spec.config or {}
        codec = cfg.get("codec")
        if not codec:
            continue  # poster / non-video spec
        results.append(VideoDerivative(
            name=spec.name,
            container=cfg.get("container", "mp4"),
            codec=codec,
            width=spec.max_width,
            height=spec.max_height,
            bitrate_kbps=cfg.get("bitrate_kbps", 2500),
            audio_bitrate_kbps=cfg.get("audio_bitrate_kbps", 128),
        ))
    return results


class VideoTranscodingService:
    """
    Service for video transcoding using AWS MediaConvert.

    MediaConvert is a serverless video transcoding service that automatically
    scales to handle any workload.
    """

    def __init__(self):
        self._client = None
        self._endpoint = None

    @property
    def client(self):
        """Get MediaConvert client with endpoint discovery."""
        if self._client is None:
            # MediaConvert requires endpoint discovery
            if self._endpoint is None:
                mediaconvert = boto3.client(
                    "mediaconvert",
                    region_name=os.getenv("AWS_REGION", "us-west-2")
                )
                endpoints = mediaconvert.describe_endpoints()
                self._endpoint = endpoints["Endpoints"][0]["Url"]

            self._client = boto3.client(
                "mediaconvert",
                region_name=os.getenv("AWS_REGION", "us-west-2"),
                endpoint_url=self._endpoint
            )
        return self._client

    def create_transcode_job(
        self,
        source_s3_uri: str,
        output_s3_prefix: str,
        media_id: UUID,
        derivatives: list[str] | None = None,
        extract_poster: bool = True,
        poster_timestamp_seconds: float = 1.0,
    ) -> TranscodeOutput:
        """
        Create a MediaConvert transcoding job.

        Args:
            source_s3_uri: S3 URI of source video (s3://bucket/key)
            output_s3_prefix: S3 prefix for outputs (s3://bucket/prefix/)
            media_id: Media ID for tracking
            derivatives: List of derivative preset names (default: all presets)
            extract_poster: Whether to extract a poster image
            poster_timestamp_seconds: Time offset for poster extraction

        Returns:
            TranscodeOutput with job details
        """
        role_arn = os.getenv("MEDIACONVERT_ROLE_ARN")
        if not role_arn:
            raise ValueError("MEDIACONVERT_ROLE_ARN environment variable not set")

        # Use default derivatives if not specified
        if derivatives is None:
            derivatives = ["web_mp4_720p", "web_mp4_480p"]

        # Build output groups
        output_groups = []

        # Video outputs — resolve names to presets (supports runtime-registered presets)
        for derivative_name in derivatives:
            preset = DERIVATIVE_PRESETS.get(derivative_name)
            if not preset:
                logger.warning(f"Unknown derivative preset: {derivative_name}")
                continue

            output_group = self._build_output_group(preset, output_s3_prefix)
            output_groups.append(output_group)

        # Poster image output
        if extract_poster:
            poster_group = self._build_poster_output_group(
                output_s3_prefix,
                poster_timestamp_seconds
            )
            output_groups.append(poster_group)

        # Build job settings
        job_settings = {
            "Inputs": [
                {
                    "FileInput": source_s3_uri,
                    "AudioSelectors": {
                        "Audio Selector 1": {
                            "DefaultSelection": "DEFAULT"
                        }
                    },
                    "VideoSelector": {},
                    "TimecodeSource": "ZEROBASED"
                }
            ],
            "OutputGroups": output_groups
        }

        # Create the job
        try:
            response = self.client.create_job(
                Role=role_arn,
                Settings=job_settings,
                StatusUpdateInterval="SECONDS_60",
                UserMetadata={
                    "media_id": str(media_id),
                }
            )

            job = response["Job"]
            return TranscodeOutput(
                job_id=job["Id"],
                status=job["Status"],
                outputs=[]
            )

        except ClientError as e:
            logger.error(f"Failed to create transcode job: {e}")
            raise

    def _build_output_group(
        self,
        preset: VideoDerivative,
        output_prefix: str
    ) -> dict:
        """Build MediaConvert output group for a derivative."""
        if preset.container == "mp4":
            return self._build_mp4_output_group(preset, output_prefix)
        elif preset.container == "webm":
            return self._build_webm_output_group(preset, output_prefix)
        else:
            raise ValueError(f"Unsupported container: {preset.container}")

    def _build_mp4_output_group(
        self,
        preset: VideoDerivative,
        output_prefix: str
    ) -> dict:
        """Build MP4 output group."""
        return {
            "Name": preset.name,
            "OutputGroupSettings": {
                "Type": "FILE_GROUP_SETTINGS",
                "FileGroupSettings": {
                    "Destination": f"{output_prefix}{preset.name}/"
                }
            },
            "Outputs": [
                {
                    "ContainerSettings": {
                        "Container": "MP4",
                        "Mp4Settings": {
                            "CslgAtom": "INCLUDE",
                            "FreeSpaceBox": "EXCLUDE",
                            "MoovPlacement": "PROGRESSIVE_DOWNLOAD"
                        }
                    },
                    "VideoDescription": {
                        "CodecSettings": {
                            "Codec": "H_264",
                            "H264Settings": {
                                "RateControlMode": "VBR",
                                "Bitrate": preset.bitrate_kbps * 1000,
                                "MaxBitrate": int(preset.bitrate_kbps * 1.5 * 1000),
                                "CodecProfile": "HIGH",
                                "CodecLevel": "AUTO",
                                "InterlaceMode": "PROGRESSIVE",
                                "QualityTuningLevel": "SINGLE_PASS_HQ",
                            }
                        },
                        "Width": preset.width,
                        "Height": preset.height,
                        "ScalingBehavior": "DEFAULT",
                        "AntiAlias": "ENABLED",
                        "Sharpness": 50,
                    },
                    "AudioDescriptions": [
                        {
                            "CodecSettings": {
                                "Codec": "AAC",
                                "AacSettings": {
                                    "Bitrate": preset.audio_bitrate_kbps * 1000,
                                    "CodingMode": "CODING_MODE_2_0",
                                    "SampleRate": 48000,
                                }
                            },
                            "AudioSourceName": "Audio Selector 1"
                        }
                    ],
                    "NameModifier": f"_{preset.name}"
                }
            ]
        }

    def _build_webm_output_group(
        self,
        preset: VideoDerivative,
        output_prefix: str
    ) -> dict:
        """Build WebM output group."""
        return {
            "Name": preset.name,
            "OutputGroupSettings": {
                "Type": "FILE_GROUP_SETTINGS",
                "FileGroupSettings": {
                    "Destination": f"{output_prefix}{preset.name}/"
                }
            },
            "Outputs": [
                {
                    "ContainerSettings": {
                        "Container": "WEBM"
                    },
                    "VideoDescription": {
                        "CodecSettings": {
                            "Codec": "VP9",
                            "Vp9Settings": {
                                "RateControlMode": "VBR",
                                "Bitrate": preset.bitrate_kbps * 1000,
                                "QualityTuningLevel": "MULTI_PASS_HQ",
                            }
                        },
                        "Width": preset.width,
                        "Height": preset.height,
                        "ScalingBehavior": "DEFAULT",
                    },
                    "AudioDescriptions": [
                        {
                            "CodecSettings": {
                                "Codec": "OPUS",
                                "OpusSettings": {
                                    "Bitrate": preset.audio_bitrate_kbps * 1000,
                                    "Channels": 2,
                                    "SampleRate": 48000,
                                }
                            },
                            "AudioSourceName": "Audio Selector 1"
                        }
                    ],
                    "NameModifier": f"_{preset.name}"
                }
            ]
        }

    def _build_poster_output_group(
        self,
        output_prefix: str,
        timestamp_seconds: float
    ) -> dict:
        """Build output group for poster image extraction."""
        return {
            "Name": "poster",
            "OutputGroupSettings": {
                "Type": "FILE_GROUP_SETTINGS",
                "FileGroupSettings": {
                    "Destination": f"{output_prefix}poster/"
                }
            },
            "Outputs": [
                {
                    "ContainerSettings": {
                        "Container": "RAW"
                    },
                    "VideoDescription": {
                        "CodecSettings": {
                            "Codec": "FRAME_CAPTURE",
                            "FrameCaptureSettings": {
                                "FramerateNumerator": 1,
                                "FramerateDenominator": 1,
                                "MaxCaptures": 1,
                                "Quality": 90
                            }
                        },
                        "Width": 1280,
                        "Height": 720,
                        "ScalingBehavior": "DEFAULT",
                    },
                    "NameModifier": "_poster"
                }
            ]
        }

    def get_job_status(self, job_id: str) -> dict[str, Any]:
        """
        Get status of a transcode job.

        Returns:
            Dict with job status and output details
        """
        try:
            response = self.client.get_job(Id=job_id)
            job = response["Job"]

            result = {
                "job_id": job["Id"],
                "status": job["Status"],
                "progress": job.get("JobPercentComplete", 0),
                "created_at": job["CreatedAt"].isoformat() if job.get("CreatedAt") else None,
                "error_code": job.get("ErrorCode"),
                "error_message": job.get("ErrorMessage"),
            }

            # Extract output file paths if completed
            if job["Status"] == "COMPLETE":
                outputs = []
                for output_group in job["Settings"]["OutputGroups"]:
                    group_name = output_group["Name"]
                    destination = output_group["OutputGroupSettings"].get(
                        "FileGroupSettings", {}
                    ).get("Destination", "")

                    for output in output_group["Outputs"]:
                        name_modifier = output.get("NameModifier", "")
                        outputs.append({
                            "group": group_name,
                            "path": destination,
                            "modifier": name_modifier,
                        })

                result["outputs"] = outputs

            return result

        except ClientError as e:
            logger.error(f"Failed to get job status: {e}")
            raise

    def cancel_job(self, job_id: str) -> bool:
        """
        Cancel a transcode job.

        Returns:
            True if cancelled successfully
        """
        try:
            self.client.cancel_job(Id=job_id)
            return True
        except ClientError as e:
            logger.error(f"Failed to cancel job: {e}")
            return False


# Service singleton
_service: VideoTranscodingService | None = None


def get_video_transcoding_service() -> VideoTranscodingService:
    """Get the video transcoding service singleton."""
    global _service
    if _service is None:
        _service = VideoTranscodingService()
    return _service


def is_video_transcoding_available() -> bool:
    """Check if video transcoding is available (MediaConvert role configured)."""
    return bool(os.getenv("MEDIACONVERT_ROLE_ARN"))
