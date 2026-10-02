"""
OCR service using Tesseract.

Provides:
- Text extraction from images via pytesseract
- PDF OCR (rasterise pages via pypdfium2, then Tesseract each page)
- Storage of OCR text in media extra_metadata
"""

import io
import logging
from typing import Any
from uuid import UUID

from app.config import get_settings
from app.database import current_session

logger = logging.getLogger(__name__)


def extract_text_from_image(image_bytes: bytes, lang: str = "eng") -> str:
    """
    Extract text from an image using Tesseract OCR.

    Args:
        image_bytes: Raw image file bytes
        lang: Tesseract language code (default "eng")

    Returns:
        Extracted text string
    """
    import pytesseract
    from PIL import Image

    settings = get_settings()
    if not settings.ocr_enabled:
        raise RuntimeError("OCR is not enabled. Set OCR_ENABLED=true.")

    image = Image.open(io.BytesIO(image_bytes))
    text = pytesseract.image_to_string(image, lang=lang)
    return text.strip()


def extract_text_from_pdf(pdf_bytes: bytes, lang: str = "eng", max_pages: int = 50) -> str:
    """
    Extract text from a scanned PDF using pypdfium2 + Tesseract.

    First attempts to extract embedded text via pypdfium2.
    Falls back to OCR (render page to image, then Tesseract) if embedded text is empty.

    Args:
        pdf_bytes: Raw PDF file bytes
        lang: Tesseract language code
        max_pages: Maximum pages to process

    Returns:
        Combined extracted text from all pages
    """
    import pytesseract
    import pypdfium2 as pdfium

    settings = get_settings()
    if not settings.ocr_enabled:
        raise RuntimeError("OCR is not enabled. Set OCR_ENABLED=true.")

    doc = pdfium.PdfDocument(pdf_bytes)
    pages_text = []

    try:
        for page_num in range(min(len(doc), max_pages)):
            page = doc[page_num]

            # Try embedded text first — cheaper and more accurate than OCR.
            textpage = page.get_textpage()
            try:
                embedded_text = textpage.get_text_range().strip()
            finally:
                textpage.close()

            if len(embedded_text) > 20:
                pages_text.append(embedded_text)
                continue

            # Fall back to OCR: rasterise at 2x for legibility. render()
            # returns a bitmap we can hand straight to PIL, so the round-trip
            # through encoded JPEG bytes that PyMuPDF needed is gone.
            image = page.render(scale=2.0).to_pil()

            ocr_text = pytesseract.image_to_string(image, lang=lang)
            if ocr_text.strip():
                pages_text.append(ocr_text.strip())
    finally:
        doc.close()

    return "\n\n".join(pages_text)


def process_media_ocr(
    media_id: UUID,
    organization_id: UUID,
) -> dict[str, Any]:
    """
    Run OCR on a media item and store results.

    Args:
        media_id: Media UUID
        organization_id: Organization UUID

    Returns:
        Dict with OCR results
    """
    import os
    import tempfile

    from app.models import Media
    from app.services.uploads import get_s3_client, get_media_bucket, get_org_storage_region

    settings = get_settings()
    lang = settings.ocr_languages

    media = current_session().query(Media).filter_by(
        media_id=media_id,
        organization_id=organization_id,
    ).first()

    if not media:
        raise ValueError(f"Media not found: {media_id}")

    # Determine if this media is OCR-eligible
    is_image = media.media_type == "image"
    is_pdf = media.mime_type == "application/pdf"

    if not (is_image or is_pdf):
        return {"success": False, "reason": "Not an OCR-eligible media type"}

    region = get_org_storage_region(str(organization_id), current_session())
    s3_client = get_s3_client(region)
    bucket = get_media_bucket(region)

    with tempfile.TemporaryDirectory() as tmpdir:
        local_path = os.path.join(tmpdir, media.filename)
        s3_client.download_file(bucket, media.s3_key, local_path)

        with open(local_path, "rb") as f:
            file_bytes = f.read()

        if is_pdf:
            text = extract_text_from_pdf(file_bytes, lang=lang)
        else:
            text = extract_text_from_image(file_bytes, lang=lang)

    if not text:
        return {"success": True, "media_id": str(media_id), "text_length": 0}

    # Store in extra_metadata
    extra = media.extra_metadata or {}
    extra["ocr_text"] = text
    media.extra_metadata = extra
    current_session().commit()

    return {
        "success": True,
        "media_id": str(media_id),
        "text_length": len(text),
    }
