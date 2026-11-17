"""Access copies: what the public plays or reads instead of the original.

A file's public download level (``Media.public_download_level``) decides
whether the public may take the original. Playing or opening a file in the
browser transfers it just as a download does, so Discover must not play or
open the original either unless the level is ``originals``. This module makes
the lower-quality copies Discover serves instead:

* **Audio**: a web proxy, AAC at 128 kbit/s in an MP4 (``.m4a``) container,
  derivative type ``web_audio_aac`` / format ``mp4``. Every browser JAWS and
  VoiceOver users run (Edge, Chrome, Safari on iOS) plays it natively.
  Generated with ffmpeg where the worker has it, otherwise submitted to AWS
  MediaConvert through the same path as video proxies.
* **PDF**: an image-only PDF of every page rendered at screen resolution
  (``PDF_ACCESS_DPI``, JPEG), derivative type ``access_pdf`` / format ``pdf``.
  It is a genuinely lesser copy: no vector content, no print resolution, no
  embedded files or forms. It also has no text layer, which would shut out
  blind readers, so the text of every page is extracted at the same time and
  stored in ``media.extra_metadata['access_text_pages']``. The record page
  presents that text as HTML with a heading per page (see
  ``discover_media.public_document_text``), which reads better in a screen
  reader than an untagged PDF would.
* **Other documents** (Word, ODT, RTF, HTML, plain text): no file copy. The
  extracted text (``extra_metadata['extracted_text']``) is the access copy.

Video proxies already come from transcoding at upload
(``tasks.media.transcode_video_task``).
"""
from __future__ import annotations

import io
import logging
import os
import shutil
import subprocess
import tempfile

logger = logging.getLogger(__name__)

AUDIO_PROXY_TYPE = "web_audio_aac"
AUDIO_PROXY_FORMAT = "mp4"
AUDIO_PROXY_MIME = "audio/mp4"
AUDIO_PROXY_BITRATE = "128k"

PDF_ACCESS_TYPE = "access_pdf"
PDF_ACCESS_FORMAT = "pdf"
# Screen resolution: legible on a monitor or phone, not a print master.
PDF_ACCESS_DPI = 96
PDF_ACCESS_JPEG_QUALITY = 70

ACCESS_COPY_JOB_TYPE = "access_copy"

# Text of the PDF's pages, kept for the record page's text view.
TEXT_PAGES_KEY = "access_text_pages"

_FFMPEG_TIMEOUT_SECONDS = 1800


def _usable(d) -> bool:
    return bool(d.s3_key) and not d.s3_key.endswith("/")


def audio_proxy(derivs) -> object | None:
    """The audio web proxy derivative, if one exists."""
    for d in derivs:
        if d.derivative_type == AUDIO_PROXY_TYPE and _usable(d):
            return d
    return None


def pdf_access_copy(derivs) -> object | None:
    """The page-image PDF access copy derivative, if one exists."""
    for d in derivs:
        if d.derivative_type == PDF_ACCESS_TYPE and d.format == PDF_ACCESS_FORMAT and _usable(d):
            return d
    return None


def is_pdf(media) -> bool:
    return (media.mime_type or "").lower() == "application/pdf"


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def pdf_rendering_available() -> bool:
    try:
        import pypdfium2  # noqa: F401
    except ImportError:
        return False
    return True


def can_generate(media) -> bool:
    """Whether this deployment can make the access copy ``media`` needs."""
    from app.services.video_transcoding import is_video_transcoding_available

    if media.media_type == "video":
        return is_video_transcoding_available()
    if media.media_type == "audio":
        return ffmpeg_available() or is_video_transcoding_available()
    if media.media_type == "document":
        if is_pdf(media):
            return pdf_rendering_available()
        from app.services.text_extraction import SUPPORTED_MIME_TYPES

        return media.mime_type in SUPPORTED_MIME_TYPES
    return False


# ---------------------------------------------------------------------------
# Builders (pure: bytes in, bytes out)
# ---------------------------------------------------------------------------


def build_audio_proxy(audio_data: bytes, *, source_suffix: str = "") -> bytes:
    """Transcode audio to AAC-in-MP4 with ffmpeg. Tags are not carried over."""
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, f"source{source_suffix}")
        out = os.path.join(tmp, "proxy.m4a")
        with open(src, "wb") as fh:
            fh.write(audio_data)
        proc = subprocess.run(
            [
                "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
                "-i", src,
                "-map", "0:a:0", "-vn", "-sn", "-dn",
                "-map_metadata", "-1",
                "-c:a", "aac", "-b:a", AUDIO_PROXY_BITRATE,
                "-movflags", "+faststart",
                "-f", "mp4", out,
            ],
            capture_output=True,
            timeout=_FFMPEG_TIMEOUT_SECONDS,
        )
        if proc.returncode != 0 or not os.path.exists(out):
            raise RuntimeError(
                "ffmpeg could not make an audio proxy: "
                + proc.stderr.decode(errors="replace")[:300]
            )
        with open(out, "rb") as fh:
            return fh.read()


def build_pdf_access_copy(
    pdf_data: bytes,
    *,
    dpi: int = PDF_ACCESS_DPI,
    quality: int = PDF_ACCESS_JPEG_QUALITY,
) -> tuple[bytes, list[str], tuple[int, int]]:
    """(access PDF bytes, text of each page, first page's pixel size).

    Each page becomes one JPEG at ``dpi`` placed on a page of the same
    physical size. Pages are processed one at a time so memory stays flat.
    """
    import pypdfium2 as pdfium

    src = pdfium.PdfDocument(pdf_data)
    out = pdfium.PdfDocument.new()
    texts: list[str] = []
    first_size = (0, 0)
    try:
        for index in range(len(src)):
            page = src[index]
            try:
                textpage = page.get_textpage()
                try:
                    text = textpage.get_text_bounded() or ""
                finally:
                    textpage.close()
                texts.append(text.replace("\r\n", "\n").replace("\r", "\n").strip())

                image = page.render(scale=dpi / 72).to_pil().convert("RGB")
                px_w, px_h = image.size
                if index == 0:
                    first_size = (px_w, px_h)
                buf = io.BytesIO()
                image.save(buf, format="JPEG", quality=quality, optimize=True)
                image.close()
            finally:
                page.close()

            # Same physical size as the source page (rotation already applied
            # by the render).
            width_pt, height_pt = px_w * 72 / dpi, px_h * 72 / dpi
            new_page = out.new_page(width_pt, height_pt)
            try:
                pdf_image = pdfium.PdfImage.new(out)
                buf.seek(0)
                pdf_image.load_jpeg(buf, inline=True)
                pdf_image.set_matrix(pdfium.PdfMatrix().scale(width_pt, height_pt))
                new_page.insert_obj(pdf_image)
                new_page.gen_content()
            finally:
                new_page.close()

        result = io.BytesIO()
        out.save(result)
        return result.getvalue(), texts, first_size
    finally:
        out.close()
        src.close()


# ---------------------------------------------------------------------------
# Generation (run by tasks.media.generate_access_copy_task)
# ---------------------------------------------------------------------------


def _replace_derivative(session, media, derivative_type: str, fmt: str, key: str, body: bytes,
                        width: int, height: int):
    from app.models import MediaDerivative

    session.query(MediaDerivative).filter(
        MediaDerivative.media_id == media.media_id,
        MediaDerivative.derivative_type == derivative_type,
        MediaDerivative.format == fmt,
    ).delete(synchronize_session=False)
    d = MediaDerivative(
        media_id=media.media_id,
        organization_id=media.organization_id,
        derivative_type=derivative_type,
        format=fmt,
        s3_key=key,
        width=width,
        height=height,
        file_size=len(body),
    )
    session.add(d)
    return d


def generate_access_copy(media, session) -> dict:
    """Make the access copy ``media`` needs and record it. Returns a summary.

    Raises on failure so the caller can record the job as failed. Returns
    ``{"delegated": "transcode"}`` when the work was handed to MediaConvert.
    """
    from app.models import MediaDerivative
    from app.services.storage import get_storage_backend

    org_id = str(media.organization_id)
    derivs = session.query(MediaDerivative).filter(MediaDerivative.media_id == media.media_id).all()
    storage = get_storage_backend(org_id, session)
    base = f"orgs/{org_id}/media/derivatives/{media.media_id}"

    if media.media_type == "audio":
        if audio_proxy(derivs):
            return {"status": "exists"}
        if not ffmpeg_available():
            from app.services.video_transcoding import is_video_transcoding_available

            if not is_video_transcoding_available():
                raise RuntimeError("No audio transcoder: ffmpeg is not installed and MediaConvert is not configured")
            from app.tasks.media import transcode_video_task

            transcode_video_task.delay(
                media_id=str(media.media_id),
                organization_id=org_id,
                derivatives=[AUDIO_PROXY_TYPE],
                extract_poster=False,
            )
            return {"delegated": "transcode"}
        data, _ = storage.get_object_sync(media.s3_key)
        suffix = os.path.splitext(media.filename or "")[1][:10]
        body = build_audio_proxy(data, source_suffix=suffix)
        key = f"{base}/{AUDIO_PROXY_TYPE}.m4a"
        storage.put_object_sync(key=key, body=body, content_type=AUDIO_PROXY_MIME)
        _replace_derivative(session, media, AUDIO_PROXY_TYPE, AUDIO_PROXY_FORMAT, key, body, 0, 0)
        session.commit()
        return {"status": "created", "derivative_type": AUDIO_PROXY_TYPE, "file_size": len(body)}

    if media.media_type == "document" and is_pdf(media):
        if pdf_access_copy(derivs) and (media.extra_metadata or {}).get(TEXT_PAGES_KEY) is not None:
            return {"status": "exists"}
        data, _ = storage.get_object_sync(media.s3_key)
        body, pages, (w, h) = build_pdf_access_copy(data)
        key = f"{base}/{PDF_ACCESS_TYPE}.pdf"
        storage.put_object_sync(key=key, body=body, content_type="application/pdf")
        _replace_derivative(session, media, PDF_ACCESS_TYPE, PDF_ACCESS_FORMAT, key, body, w, h)
        extra = dict(media.extra_metadata or {})
        extra[TEXT_PAGES_KEY] = pages
        joined = "\n\n".join(p for p in pages if p)
        if joined and not extra.get("extracted_text"):
            extra["extracted_text"] = joined
        media.extra_metadata = extra
        session.commit()
        return {
            "status": "created",
            "derivative_type": PDF_ACCESS_TYPE,
            "pages": len(pages),
            "pages_with_text": sum(1 for p in pages if p),
            "file_size": len(body),
        }

    if media.media_type == "document":
        if (media.extra_metadata or {}).get("extracted_text"):
            return {"status": "exists"}
        from app.services.text_extraction import process_text_extraction

        return process_text_extraction(media.media_id, media.organization_id)

    raise ValueError(f"No access copy for media type {media.media_type!r}")
