"""
ExifTool service for comprehensive metadata read/write.

Replaces limited Pillow-based EXIF extraction with full
EXIF/IPTC/XMP read via exiftool, plus write-back on download.
"""

import json
import logging
import subprocess
import tempfile
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


def _run_exiftool(args: list[str], timeout: int = 30) -> str:
    """Run exiftool with the given arguments."""
    cmd = ["exiftool"] + args
    result = subprocess.run(
        cmd,
        capture_output=True,
        timeout=timeout,
    )
    if result.returncode != 0 and result.stderr:
        stderr = result.stderr.decode("utf-8", errors="replace")
        # exiftool returns 1 for warnings, only error on 2+
        if result.returncode > 1:
            raise RuntimeError(f"exiftool error: {stderr[:500]}")
    return result.stdout.decode("utf-8", errors="replace")


def read_all_metadata(file_path: str) -> dict[str, Any]:
    """
    Read all metadata from a file using exiftool.

    Returns:
        Dict with all EXIF/IPTC/XMP/ICC metadata
    """
    output = _run_exiftool(["-json", "-a", "-G", file_path])
    try:
        data = json.loads(output)
        return data[0] if data else {}
    except (json.JSONDecodeError, IndexError):
        return {}


def read_metadata_grouped(file_path: str) -> dict[str, dict]:
    """
    Read metadata grouped by category.

    Returns:
        Dict with keys: exif, iptc, xmp, icc, file
    """
    full = read_all_metadata(file_path)
    if not full:
        return {}

    grouped = {
        "exif": {},
        "iptc": {},
        "xmp": {},
        "icc": {},
        "file": {},
    }

    for key, value in full.items():
        key_lower = key.lower()
        if key_lower.startswith("exif:"):
            grouped["exif"][key.split(":", 1)[1]] = value
        elif key_lower.startswith("iptc:"):
            grouped["iptc"][key.split(":", 1)[1]] = value
        elif key_lower.startswith("xmp:"):
            grouped["xmp"][key.split(":", 1)[1]] = value
        elif key_lower.startswith("icc"):
            grouped["icc"][key.split(":", 1)[1] if ":" in key else key] = value
        elif key_lower.startswith("file:"):
            grouped["file"][key.split(":", 1)[1]] = value

    return grouped


def write_metadata(
    file_path: str,
    metadata: dict[str, str],
) -> None:
    """
    Write metadata to a file using exiftool.

    Args:
        file_path: Path to the file
        metadata: Dict of tag=value pairs (e.g. {"IPTC:Caption-Abstract": "My caption"})
    """
    args = ["-overwrite_original"]
    for tag, value in metadata.items():
        args.append(f"-{tag}={value}")
    args.append(file_path)

    _run_exiftool(args)


def embed_madrona_metadata(
    file_path: str,
    media_title: str | None = None,
    media_description: str | None = None,
    creator: str | None = None,
    copyright_notice: str | None = None,
    keywords: list[str] | None = None,
) -> None:
    """
    Embed Madrona-specific metadata into a file for download.

    Writes standard IPTC/XMP fields that are recognized by
    common photo management software.
    """
    metadata = {}

    if media_title:
        metadata["IPTC:ObjectName"] = media_title
        metadata["XMP:Title"] = media_title

    if media_description:
        metadata["IPTC:Caption-Abstract"] = media_description
        metadata["XMP:Description"] = media_description

    if creator:
        metadata["IPTC:By-line"] = creator
        metadata["XMP:Creator"] = creator

    if copyright_notice:
        metadata["IPTC:CopyrightNotice"] = copyright_notice
        metadata["XMP:Rights"] = copyright_notice

    if keywords:
        for kw in keywords:
            metadata[f"IPTC:Keywords+"] = kw

    if metadata:
        write_metadata(file_path, metadata)
