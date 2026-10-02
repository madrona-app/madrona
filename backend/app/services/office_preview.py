"""
Office document preview service via LibreOffice (unoserver).

Converts DOCX/XLSX/PPTX to PDF, then uses existing pypdfium2
thumbnail pipeline to generate previews.
"""

import logging
import subprocess
import tempfile
from pathlib import Path

from app.config import get_settings

logger = logging.getLogger(__name__)

# MIME types that can be converted via unoserver
CONVERTIBLE_MIME_TYPES = {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/msword",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
    "application/vnd.oasis.opendocument.text",
    "application/vnd.oasis.opendocument.spreadsheet",
    "application/vnd.oasis.opendocument.presentation",
}


def is_convertible(mime_type: str) -> bool:
    """Check if a MIME type can be converted to PDF via unoserver."""
    return mime_type in CONVERTIBLE_MIME_TYPES


def convert_to_pdf(input_path: str, output_path: str) -> None:
    """
    Convert an office document to PDF via unoconvert (unoserver).

    Args:
        input_path: Path to the input document
        output_path: Path for the output PDF

    Raises:
        RuntimeError: If conversion fails or unoserver is not available
    """
    settings = get_settings()

    if not settings.unoserver_enabled:
        raise RuntimeError("Unoserver is not enabled. Set UNOSERVER_ENABLED=true.")

    cmd = [
        "unoconvert",
        "--host", settings.unoserver_host,
        "--port", str(settings.unoserver_port),
        "--convert-to", "pdf",
        input_path,
        output_path,
    ]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            timeout=120,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"unoconvert failed (exit {result.returncode}): "
                f"{result.stderr.decode()[:500]}"
            )
    except FileNotFoundError:
        raise RuntimeError(
            "unoconvert not found. Install it with: pip install unoserver"
        )


def generate_office_preview(
    file_data: bytes,
    original_filename: str,
    organization_id: str,
    media_id: str,
) -> dict | None:
    """
    Generate a PDF preview for an office document, then generate thumbnails.

    Returns:
        Dict with derivative info, or None if conversion not possible
    """
    settings = get_settings()
    if not settings.unoserver_enabled:
        return None

    suffix = Path(original_filename).suffix
    with tempfile.TemporaryDirectory() as tmpdir:
        input_path = str(Path(tmpdir) / f"input{suffix}")
        output_path = str(Path(tmpdir) / "preview.pdf")

        with open(input_path, "wb") as f:
            f.write(file_data)

        convert_to_pdf(input_path, output_path)

        # Read the generated PDF
        with open(output_path, "rb") as f:
            pdf_data = f.read()

        return {
            "pdf_data": pdf_data,
            "pdf_path": output_path,
        }
