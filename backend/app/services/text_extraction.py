"""
Full-text extraction for non-PDF documents.

Supports DOCX, ODT, HTML, RTF, and TXT files.
Stores extracted text in media.extra_metadata['extracted_text']
for OpenSearch indexing.
"""

import io
import logging
from typing import Any
from uuid import UUID

from app.database import current_session

logger = logging.getLogger(__name__)

# MIME types to extraction functions
SUPPORTED_MIME_TYPES = {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.oasis.opendocument.text": "odt",
    "text/html": "html",
    "application/rtf": "rtf",
    "text/rtf": "rtf",
    "text/plain": "txt",
}


def extract_text_from_docx(data: bytes) -> str:
    """Extract text from a DOCX file using python-docx."""
    from docx import Document

    doc = Document(io.BytesIO(data))
    paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
    return "\n\n".join(paragraphs)


def extract_text_from_odt(data: bytes) -> str:
    """Extract text from an ODT file using odfpy."""
    from odf.opendocument import load as odf_load
    from odf.text import P

    doc = odf_load(io.BytesIO(data))
    paragraphs = []
    for element in doc.getElementsByType(P):
        text = ""
        for node in element.childNodes:
            if hasattr(node, "data"):
                text += node.data
            elif hasattr(node, "__str__"):
                text += str(node)
        if text.strip():
            paragraphs.append(text.strip())
    return "\n\n".join(paragraphs)


def extract_text_from_html(data: bytes) -> str:
    """Extract text from HTML using BeautifulSoup."""
    from bs4 import BeautifulSoup

    # Detect encoding
    import chardet
    detected = chardet.detect(data)
    encoding = detected.get("encoding", "utf-8") or "utf-8"

    text = data.decode(encoding, errors="replace")
    soup = BeautifulSoup(text, "html.parser")

    # Remove script and style elements
    for script in soup(["script", "style"]):
        script.decompose()

    return soup.get_text(separator="\n", strip=True)


def extract_text_from_rtf(data: bytes) -> str:
    """Extract text from RTF using striprtf."""
    from striprtf.striprtf import rtf_to_text

    # Detect encoding
    import chardet
    detected = chardet.detect(data)
    encoding = detected.get("encoding", "utf-8") or "utf-8"

    rtf_content = data.decode(encoding, errors="replace")
    return rtf_to_text(rtf_content)


def extract_text_from_txt(data: bytes) -> str:
    """Extract text from plain text with encoding detection."""
    import chardet
    detected = chardet.detect(data)
    encoding = detected.get("encoding", "utf-8") or "utf-8"
    return data.decode(encoding, errors="replace")


def extract_text(data: bytes, mime_type: str) -> str | None:
    """
    Extract text from a file based on its MIME type.

    Args:
        data: Raw file bytes
        mime_type: MIME type of the file

    Returns:
        Extracted text or None if unsupported
    """
    file_type = SUPPORTED_MIME_TYPES.get(mime_type)
    if not file_type:
        return None

    extractors = {
        "docx": extract_text_from_docx,
        "odt": extract_text_from_odt,
        "html": extract_text_from_html,
        "rtf": extract_text_from_rtf,
        "txt": extract_text_from_txt,
    }

    extractor = extractors.get(file_type)
    if not extractor:
        return None

    try:
        text = extractor(data)
        return text.strip() if text else None
    except Exception as e:
        logger.warning("Text extraction failed for %s: %s", mime_type, e)
        return None


def process_text_extraction(
    media_id: UUID,
    organization_id: UUID,
) -> dict[str, Any]:
    """
    Extract text from a media item and store in extra_metadata.

    Args:
        media_id: Media UUID
        organization_id: Organization UUID

    Returns:
        Dict with extraction results
    """
    from app.models import Media
    from app.services.storage import get_storage_backend

    media = current_session().query(Media).filter_by(
        media_id=media_id,
        organization_id=organization_id,
    ).first()

    if not media:
        raise ValueError(f"Media not found: {media_id}")

    if media.mime_type not in SUPPORTED_MIME_TYPES:
        return {"success": False, "reason": "Unsupported MIME type"}

    storage = get_storage_backend(str(organization_id), current_session())
    data, _ = storage.get_object_sync(media.s3_key)

    text = extract_text(data, media.mime_type)
    if not text:
        return {"success": True, "media_id": str(media_id), "text_length": 0}

    extra = media.extra_metadata or {}
    extra["extracted_text"] = text
    media.extra_metadata = extra
    current_session().commit()

    return {
        "success": True,
        "media_id": str(media_id),
        "text_length": len(text),
    }
