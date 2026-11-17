"""Public (Discover) media: what an anonymous visitor may see, play and read.

Discover used to show images only — every non-image file linked to a record
was dropped because it has no image rendition. This module builds the public
media payload for all four display types and serves the public text tracks
(captions, transcripts, OCR text) that go with them.

Access rules, all enforced here rather than in the browser:

* The media must be ``is_published``, belong to the organization, and be
  linked to a discoverable, non-deleted object of that organization. Nothing
  else is reachable, whatever ID a caller guesses.
* Images are displayed from a rendition, never the master (see
  ``build_display_key_for_media``). An image with no rendition is omitted.
* Audio, video and PDFs play or open from an access copy
  (services/public_access_copy.py): a video's transcoded web proxy, an
  audio file's AAC proxy, a PDF's page-image copy. Playing a file transfers
  it as surely as downloading it, so the original plays or opens only when
  the file's public download level is ``originals`` and its rights allow it
  (:func:`public_may_take_original`), the same rule as the original download.
  With no access copy and no right to the original, nothing is served:
  ``url`` is None, ``playback_status`` says whether a copy is being prepared,
  and one is queued (:func:`request_access_copy`).
* A document's text (per page for PDFs) is served as JSON for the record
  page's text view (:func:`public_document_text`), so a page-image PDF never
  leaves screen-reader users without the words.
* Caption and transcript files are served through this API (same origin as
  the page, so ``<track>`` loads without CORS), never as raw storage URLs,
  and are listed whether or not a playable copy exists yet.

Downloads are a separate, per-file decision (``Media.public_download_level``):

* ``none`` (and NULL, the default): no download is offered and the download
  endpoint refuses every variant.
* ``derivatives``: the access copy only — an image's best JPEG rendition, a
  video's or audio file's web proxy, a PDF's page-image copy.
* ``originals``: the access copy and the original master.

Download links point at ``/api/discover/{org}/media/{id}/download``, which
re-checks everything server side; a hidden link is not the control. Rights
are honoured too: expired rights block every public download, and when the
organization has media-rights enforcement on, the original needs an
open-access grant.
"""
from __future__ import annotations

import logging
import re
from uuid import UUID

from sqlalchemy.orm import Session

from app.models import (
    CollectionObject,
    CollectionObjectMedia,
    Media,
    MediaDerivative,
    Organization,
)
from app.models.media import MediaAlternative
from app.services.uploads import get_org_media_url

logger = logging.getLogger(__name__)

# Media types the public record page can present.
PUBLIC_MEDIA_TYPES = ("image", "video", "audio", "document")

# Caption formats served publicly (SRT is converted to WebVTT on the way out).
CAPTION_ALTERNATIVE_TYPES = ("subtitle_vtt", "subtitle_srt")
# Plain-text equivalents served publicly.
TEXT_ALTERNATIVE_TYPES = ("transcript_txt", "ocr_txt")
PUBLIC_ALTERNATIVE_TYPES = CAPTION_ALTERNATIVE_TYPES + TEXT_ALTERNATIVE_TYPES

# Web proxies produced by video transcoding, best first.
_VIDEO_PROXY_ORDER = ("web_mp4_720p", "web_mp4_1080p", "web_mp4_480p", "web_webm_720p")

# Upper bound on a caption/transcript file served through the API.
MAX_TEXT_TRACK_BYTES = 5 * 1024 * 1024

_URL_EXPIRY = 3600


def _sign(key: str | None, org_id: UUID, db: Session) -> str | None:
    if not key:
        return None
    return get_org_media_url(
        key,
        organization_id=str(org_id),
        db_session=db,
        expiry_seconds=_URL_EXPIRY,
    )


def public_object_clauses(db: Session | None, organization_id) -> list:
    """SQL conditions every anonymous object query adds.

    Discoverable, not deleted, and not hidden as deaccessioned (an
    organization setting, services/deaccession_visibility.py). These are the
    Discover gates; every public surface that names or describes an object
    applies all three.
    """
    from app.services.deaccession_visibility import public_visible_clause

    return [
        CollectionObject.is_discoverable == True,  # noqa: E712
        CollectionObject.is_deleted == False,  # noqa: E712
        public_visible_clause(db, organization_id),
    ]


def is_public_object(obj, db: Session | None = None, organization_id=None) -> bool:
    """Python-side form of :func:`public_object_clauses` for a loaded object.

    With ``organization_id`` the object must also belong to that organization.
    """
    from app.services.deaccession_visibility import public_object_visible

    if obj is None:
        return False
    if organization_id is not None and str(obj.organization_id) != str(organization_id):
        return False
    return bool(
        obj.is_discoverable
        and not getattr(obj, "is_deleted", False)
        and public_object_visible(obj, db)
    )


def public_media_query(db: Session, org: Organization):
    """Media an anonymous visitor may reach for ``org``.

    Published, owned by the org, and linked to at least one public object of
    the org (see :func:`public_object_clauses`).
    """
    linked = (
        db.query(CollectionObjectMedia.media_id)
        .join(CollectionObject, CollectionObject.object_id == CollectionObjectMedia.object_id)
        .filter(
            CollectionObject.organization_id == org.organization_id,
            *public_object_clauses(db, org.organization_id),
        )
    )
    return db.query(Media).filter(
        Media.organization_id == org.organization_id,
        Media.is_published == True,  # noqa: E712
        Media.media_id.in_(linked),
    )


def get_public_media(db: Session, org: Organization, media_id: UUID) -> Media | None:
    return public_media_query(db, org).filter(Media.media_id == media_id).first()


def _derivatives(media: Media, db: Session) -> list[MediaDerivative]:
    return db.query(MediaDerivative).filter(MediaDerivative.media_id == media.media_id).all()


def video_proxy(derivs: list[MediaDerivative]) -> MediaDerivative | None:
    """The transcoded web proxy a video should play from, if one exists."""
    for kind in _VIDEO_PROXY_ORDER:
        for d in derivs:
            if d.derivative_type == kind and d.s3_key and not d.s3_key.endswith("/"):
                return d
    for d in derivs:
        if (d.derivative_type or "").startswith("web_") and d.s3_key and not d.s3_key.endswith("/"):
            return d
    return None


def _poster_key(media: Media, derivs: list[MediaDerivative]) -> str | None:
    for kind in ("poster", "large", "medium", "small"):
        for d in derivs:
            if d.derivative_type == kind and d.s3_key:
                return d.s3_key
    # thumbnail_s3_key is always a generated rendition, never the master.
    return media.thumbnail_s3_key


def display_name(media: Media) -> str:
    """A human name for the file: its title, else its filename."""
    return (media.title or "").strip() or (media.filename or "").strip() or "Untitled file"


def _alternatives(media: Media, db: Session) -> list[MediaAlternative]:
    return (
        db.query(MediaAlternative)
        .filter(
            MediaAlternative.media_id == media.media_id,
            MediaAlternative.alternative_type.in_(PUBLIC_ALTERNATIVE_TYPES),
        )
        .order_by(MediaAlternative.sort_order, MediaAlternative.created_at)
        .all()
    )


def _alt_language(alt: MediaAlternative, media: Media) -> str:
    params = alt.generation_params or {}
    lang = params.get("language") if isinstance(params, dict) else None
    return (lang or media.transcript_language or "en")[:10]


def _caption_label(alt: MediaAlternative) -> str:
    if alt.generated_by == "whisper":
        return "Captions (machine-generated)"
    label = (alt.label or "").strip()
    return label or "Captions"


def alternative_path(org_slug: str, media_id, alternative_id) -> str:
    return f"/api/discover/{org_slug}/media/{media_id}/alternatives/{alternative_id}"


def _text_tracks(media: Media, org_slug: str, db: Session) -> tuple[list[dict], list[dict]]:
    """(captions, text_alternatives) for a media item, as public API paths."""
    alts = _alternatives(media, db)
    has_vtt = any(a.alternative_type == "subtitle_vtt" for a in alts)
    captions: list[dict] = []
    texts: list[dict] = []
    for alt in alts:
        if alt.alternative_type in CAPTION_ALTERNATIVE_TYPES:
            # Whisper writes the same cues as both SRT and VTT; offer one.
            if alt.alternative_type == "subtitle_srt" and has_vtt:
                continue
            captions.append({
                "url": alternative_path(org_slug, media.media_id, alt.alternative_id),
                "label": _caption_label(alt),
                "srclang": _alt_language(alt, media),
                "kind": "captions",
            })
        else:
            is_ocr = alt.alternative_type == "ocr_txt"
            texts.append({
                "url": alternative_path(org_slug, media.media_id, alt.alternative_id),
                "label": (alt.label or "").strip() or ("Text version (OCR)" if is_ocr else "Transcript (plain text)"),
                "kind": "ocr" if is_ocr else "transcript",
                "file_size": alt.file_size,
            })
    if len(captions) == 1:
        captions[0]["default"] = True
    return captions, texts


def _image_item(media: Media, db: Session) -> dict | None:
    from app.services.discovery_service import build_display_key_for_media, build_srcset_for_media

    # A rendition, never media.s3_key. This payload is anonymous, so minting
    # the master would hand every visitor the full-resolution original.
    display_key = build_display_key_for_media(media, db)
    if not display_key:
        return None
    return {
        "url": _sign(display_key, media.organization_id, db),
        "srcset": build_srcset_for_media(media.media_id, media.organization_id, db),
    }


def _access_playback(media: Media, derivs: list[MediaDerivative]) -> tuple[str, str] | None:
    """(key, mime type) of the access copy a file plays or opens from, if any."""
    from app.services.public_access_copy import AUDIO_PROXY_MIME, audio_proxy, is_pdf, pdf_access_copy

    if media.media_type == "video":
        proxy = video_proxy(derivs)
        if proxy:
            mime = f"video/{proxy.format}" if proxy.format in ("mp4", "webm") else "video/mp4"
            return proxy.s3_key, mime
    elif media.media_type == "audio":
        proxy = audio_proxy(derivs)
        if proxy:
            return proxy.s3_key, AUDIO_PROXY_MIME
    elif media.media_type == "document" and is_pdf(media):
        copy = pdf_access_copy(derivs)
        if copy:
            return copy.s3_key, "application/pdf"
    return None


def public_playback(media: Media, db: Session, derivs: list[MediaDerivative] | None = None) -> dict:
    """What the public may play or open for an audio, video or document file.

    ``{"key", "mime", "source"}`` where ``source`` is ``"access_copy"``,
    ``"original"`` or None (nothing may be served). The original is chosen
    only when :func:`public_may_take_original` allows it: first for documents
    (the original PDF keeps its text layer and tags), and only as a fallback
    for audio and video (the proxy streams better).
    """
    if derivs is None:
        derivs = _derivatives(media, db)
    access = _access_playback(media, derivs)
    original_ok = public_may_take_original(media, db)
    if media.media_type == "document" and original_ok:
        return {"key": media.s3_key, "mime": media.mime_type, "source": "original"}
    if access:
        return {"key": access[0], "mime": access[1], "source": "access_copy"}
    if original_ok:
        return {"key": media.s3_key, "mime": media.mime_type, "source": "original"}
    return {"key": None, "mime": None, "source": None}


_QUEUE_CLAIM_SECONDS = 3600
_ACTIVE_JOB_STATUSES = ("pending", "processing")


def _claim_queue_slot(media: Media) -> bool:
    """One queue request per file per hour, however many visitors arrive."""
    try:
        from app.services.redis_client import get_redis_client

        redis = get_redis_client()
        if not redis.is_available():
            return True
        return bool(redis.client.set(
            f"madrona:access-copy-queued:{media.media_id}", "1", nx=True, ex=_QUEUE_CLAIM_SECONDS,
        ))
    except Exception:  # noqa: BLE001 - without Redis the task's own checks apply
        return True


def _enqueue_access_copy(media: Media) -> bool:
    if media.media_type == "video":
        try:
            from app.tasks.media import transcode_video_task

            transcode_video_task.delay(
                media_id=str(media.media_id), organization_id=str(media.organization_id),
            )
            return True
        except Exception as e:  # noqa: BLE001
            logger.warning("Could not queue transcode for %s: %s", media.media_id, e)
            return False
    from app.tasks.media import queue_access_copy

    return queue_access_copy(str(media.media_id), str(media.organization_id))


def request_access_copy(media: Media, db: Session) -> str:
    """Make sure an access copy is on its way. Returns the public status.

    ``"preparing"`` when a job is pending or running (or was just queued);
    ``"unavailable"`` when this deployment cannot make one, or an earlier
    attempt finished without one (staff can regenerate it; anonymous traffic
    does not retry a failing job forever).
    """
    from app.models import MediaProcessingJob
    from app.services.public_access_copy import ACCESS_COPY_JOB_TYPE, can_generate

    jobs = (
        db.query(MediaProcessingJob.status)
        .filter(
            MediaProcessingJob.media_id == media.media_id,
            MediaProcessingJob.job_type.in_((ACCESS_COPY_JOB_TYPE, "transcode")),
        )
        .all()
    )
    if any(status in _ACTIVE_JOB_STATUSES for (status,) in jobs):
        return "preparing"
    if jobs or not can_generate(media):
        return "unavailable"
    if not _claim_queue_slot(media):
        return "preparing"
    return "preparing" if _enqueue_access_copy(media) else "unavailable"


def document_text_path(org_slug: str, media_id) -> str:
    return f"/api/discover/{org_slug}/media/{media_id}/text"


def _has_document_text(media: Media) -> bool:
    from app.services.public_access_copy import TEXT_PAGES_KEY

    extra = media.extra_metadata or {}
    pages = extra.get(TEXT_PAGES_KEY)
    if isinstance(pages, list) and any(isinstance(p, str) and p.strip() for p in pages):
        return True
    text = extra.get("extracted_text")
    return isinstance(text, str) and bool(text.strip())


def _time_based_or_document_item(media: Media, org_slug: str, db: Session) -> dict | None:
    derivs = _derivatives(media, db)
    playback = public_playback(media, db, derivs)
    url = _sign(playback["key"], media.organization_id, db) if playback["key"] else None
    from app.services.public_access_copy import is_pdf

    if url:
        status = "ready"
    elif media.media_type == "document" and not is_pdf(media) and _has_document_text(media):
        # The extracted text is this document's whole access copy.
        status = "text_only"
    else:
        status = request_access_copy(media, db)
    if url and media.media_type == "document" and not _has_document_text(media):
        # The text view's text is extracted by the same job, so queue it even
        # when the original may be opened.
        request_access_copy(media, db)
    captions, texts = _text_tracks(media, org_slug, db)
    transcript = (media.transcript or "").strip() or None
    return {
        "url": url,
        "srcset": None,
        "playback_mime_type": playback["mime"] if url else None,
        "playback_source": playback["source"] if url else None,
        "playback_status": status,
        "poster_url": _sign(_poster_key(media, derivs), media.organization_id, db) if media.media_type == "video" else None,
        "captions": captions,
        "transcript": transcript,
        "transcript_machine_generated": bool(transcript and media.transcription_model),
        "text_alternatives": texts,
        "text_url": document_text_path(org_slug, media.media_id)
        if media.media_type == "document" and _has_document_text(media) else None,
    }


def build_public_media_items(
    db: Session,
    org: Organization,
    org_slug: str,
    links: list[CollectionObjectMedia],
) -> list[dict]:
    """Serialize the published media linked to a public object record."""
    items: list[dict] = []
    for link in links:
        media = (
            db.query(Media)
            .filter(
                Media.media_id == link.media_id,
                Media.organization_id == org.organization_id,
                Media.is_published == True,  # noqa: E712
            )
            .first()
        )
        if not media or not media.s3_key or media.media_type not in PUBLIC_MEDIA_TYPES:
            continue
        try:
            if media.media_type == "image":
                specific = _image_item(media, db)
            else:
                specific = _time_based_or_document_item(media, org_slug, db)
        except Exception as e:  # noqa: BLE001 - one bad file must not hide the record
            logger.warning("Failed to build public media for %s: %s", media.media_id, e)
            continue
        if not specific:
            continue
        try:
            downloads = _download_entries(media, org_slug, db, _derivatives(media, db))
        except Exception as e:  # noqa: BLE001 - fail closed: offer nothing
            logger.warning("Failed to build public downloads for %s: %s", media.media_id, e)
            downloads = []
        items.append({
            "media_id": str(media.media_id),
            "media_type": media.media_type,
            "mime_type": media.mime_type,
            "name": display_name(media),
            "description": media.description,
            "width": media.width,
            "height": media.height,
            "duration_seconds": media.duration_seconds,
            "page_count": media.page_count,
            "file_size": media.file_size,
            "alt_text": media.alt_text,
            "credit": media.credit,
            "preferred_citation": media.preferred_citation,
            "is_primary": link.is_primary,
            "caption": link.caption_override,
            "captions": [],
            "transcript": None,
            "transcript_machine_generated": False,
            "text_alternatives": [],
            "poster_url": None,
            "playback_mime_type": None,
            "playback_source": None,
            "playback_status": None,
            "text_url": None,
            "downloads": downloads,
            **specific,
        })
    return items


_SRT_TIMESTAMP = re.compile(r"(\d{2}:\d{2}:\d{2}),(\d{3})")


def srt_to_vtt(text: str) -> str:
    """Convert SubRip cues to WebVTT (header plus comma-to-dot timestamps)."""
    body = text.lstrip("﻿").replace("\r\n", "\n").replace("\r", "\n")
    body = _SRT_TIMESTAMP.sub(r"\1.\2", body)
    return "WEBVTT\n\n" + body.lstrip("\n")


def read_public_alternative(
    db: Session, org: Organization, media_id: UUID, alternative_id: UUID,
) -> tuple[str, str] | None:
    """(body, content_type) of a public caption/text file, or None if not public."""
    media = get_public_media(db, org, media_id)
    if not media:
        return None
    alt = (
        db.query(MediaAlternative)
        .filter(
            MediaAlternative.alternative_id == alternative_id,
            MediaAlternative.media_id == media.media_id,
            MediaAlternative.organization_id == org.organization_id,
            MediaAlternative.alternative_type.in_(PUBLIC_ALTERNATIVE_TYPES),
        )
        .first()
    )
    if not alt or not alt.s3_key:
        return None
    if alt.file_size and alt.file_size > MAX_TEXT_TRACK_BYTES:
        return None

    from app.services.storage import get_storage_backend

    storage = get_storage_backend(str(org.organization_id), db)
    data, _ = storage.get_object_sync(alt.s3_key)
    if len(data) > MAX_TEXT_TRACK_BYTES:
        return None
    text = data.decode("utf-8", errors="replace")
    if alt.alternative_type == "subtitle_srt":
        return srt_to_vtt(text), "text/vtt; charset=utf-8"
    if alt.alternative_type == "subtitle_vtt":
        text = text.lstrip("﻿")
        if not text.startswith("WEBVTT"):
            text = "WEBVTT\n\n" + text
        return text, "text/vtt; charset=utf-8"
    return text, "text/plain; charset=utf-8"


# Upper bound on the document text returned in one response.
MAX_DOCUMENT_TEXT_CHARS = 2_000_000


def public_document_text(db: Session, org: Organization, media_id: UUID) -> dict | None:
    """The text of a public document, for the record page's text view.

    ``{"pages": [{"page": n | None, "text": str}], "truncated": bool}``.
    PDFs give one entry per page (empty text for a page with none, so page
    numbers line up with the page-image copy); other documents give a single
    entry with ``page`` None. None when the file is not public or has no text.
    """
    from app.services.public_access_copy import TEXT_PAGES_KEY

    media = get_public_media(db, org, media_id)
    if not media or media.media_type != "document" or not _has_document_text(media):
        return None
    extra = media.extra_metadata or {}
    pages = extra.get(TEXT_PAGES_KEY)
    if isinstance(pages, list) and any(isinstance(p, str) and p.strip() for p in pages):
        entries = [{"page": i + 1, "text": p if isinstance(p, str) else ""} for i, p in enumerate(pages)]
    else:
        entries = [{"page": None, "text": extra.get("extracted_text") or ""}]

    out: list[dict] = []
    budget = MAX_DOCUMENT_TEXT_CHARS
    truncated = False
    for entry in entries:
        text = entry["text"].strip()
        if len(text) > budget:
            text = text[:budget]
            truncated = True
        out.append({"page": entry["page"], "text": text})
        budget -= len(text)
        if truncated:
            break
    return {"pages": out, "truncated": truncated}


# ---------------------------------------------------------------------------
# Downloads
# ---------------------------------------------------------------------------

PUBLIC_DOWNLOAD_LEVELS = ("none", "derivatives", "originals")
# What Discover does when a file has no level set. 'none' is the safe choice
# and is what Discover did before the per-file setting existed.
DEFAULT_PUBLIC_DOWNLOAD_LEVEL = "none"
DOWNLOAD_VARIANTS = ("access", "original")
_LEVEL_RANK = {"none": 0, "derivatives": 1, "originals": 2}

# Best-quality image access copy first.
_IMAGE_ACCESS_ORDER = ("access_master", "large", "medium")

_DOWNLOAD_URL_EXPIRY = 300


def effective_public_download_level(media: Media) -> str:
    level = getattr(media, "public_download_level", None)
    return level if level in PUBLIC_DOWNLOAD_LEVELS else DEFAULT_PUBLIC_DOWNLOAD_LEVEL


def narrow_share_level(share_level: str | None, media: Media) -> str:
    """A collection share's level, narrowed (never widened) by the file's own."""
    share = share_level if share_level in _LEVEL_RANK else "none"
    own = getattr(media, "public_download_level", None)
    if own not in _LEVEL_RANK:
        return share
    return share if _LEVEL_RANK[share] <= _LEVEL_RANK[own] else own


def access_copy(media: Media, derivs: list[MediaDerivative]) -> MediaDerivative | None:
    """The derivative offered as the "access copy" download, if any."""
    if media.media_type == "image":
        for kind in _IMAGE_ACCESS_ORDER:
            for d in derivs:
                if d.derivative_type == kind and d.format == "jpeg" and d.s3_key:
                    return d
        return None
    if media.media_type == "video":
        return video_proxy(derivs)
    from app.services.public_access_copy import audio_proxy, is_pdf, pdf_access_copy

    if media.media_type == "audio":
        return audio_proxy(derivs)
    if media.media_type == "document" and is_pdf(media):
        return pdf_access_copy(derivs)
    return None


def _access_copy_file_facts(media: Media, d: MediaDerivative) -> tuple[str, str, str]:
    """(extension, format label, mime type) of an access copy."""
    fmt = (d.format or "").lower()
    if media.media_type == "audio":
        return "m4a", "M4A", "audio/mp4"
    if media.media_type == "document":
        return "pdf", "PDF", "application/pdf"
    if media.media_type == "video":
        return fmt, fmt.upper(), f"video/{fmt}"
    return fmt, fmt.upper(), f"image/{fmt}"


def _rights_allow(media: Media, db: Session, variant: str) -> bool:
    from app.services.download_access import compute_download_access
    from app.services.media_rights_enforcement import is_rights_enforcement_enabled

    access = compute_download_access(media.media_id, media.organization_id, [], db)
    if access == "blocked":
        return False
    if variant == "original" and is_rights_enforcement_enabled(media.organization_id, db):
        return access == "direct"
    return True


def allowed_variants(media: Media, db: Session, derivs: list[MediaDerivative] | None = None) -> list[str]:
    """The download variants the public may take for this file, best first."""
    level = effective_public_download_level(media)
    if level == "none":
        return []
    if derivs is None:
        derivs = _derivatives(media, db)
    out: list[str] = []
    if access_copy(media, derivs) is not None and _rights_allow(media, db, "access"):
        out.append("access")
    if level == "originals" and media.s3_key and _rights_allow(media, db, "original"):
        out.append("original")
    return out


def download_path(org_slug: str, media_id, variant: str) -> str:
    return f"/api/discover/{org_slug}/media/{media_id}/download?variant={variant}"


def _safe_filename(name: str) -> str:
    cleaned = re.sub(r'[\\"\r\n\x00-\x1f/]+', "_", name or "").strip(" .")
    return cleaned[:200] or "download"


def _download_entries(media: Media, org_slug: str, db: Session, derivs: list[MediaDerivative]) -> list[dict]:
    entries = []
    for variant in allowed_variants(media, db, derivs):
        if variant == "access":
            d = access_copy(media, derivs)
            _, label, mime = _access_copy_file_facts(media, d)
            has_frame = media.media_type in ("image", "video")
            entries.append({
                "variant": "access",
                "url": download_path(org_slug, media.media_id, "access"),
                "label": "Access copy",
                "format": label or None,
                "mime_type": mime,
                "file_size": d.file_size or None,
                "width": (d.width or None) if has_frame else None,
                "height": (d.height or None) if has_frame else None,
            })
        else:
            ext = (media.filename or "").rsplit(".", 1)[-1] if "." in (media.filename or "") else ""
            entries.append({
                "variant": "original",
                "url": download_path(org_slug, media.media_id, "original"),
                "label": "Original file",
                "format": ext.upper() or None,
                "mime_type": media.mime_type,
                "file_size": media.file_size,
                "width": media.width,
                "height": media.height,
            })
    return entries


class DownloadRefused(Exception):
    """A public download request that must not be served."""

    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def resolve_public_download(
    db: Session, org: Organization, media_id: UUID, variant: str,
) -> tuple[str, str]:
    """(storage key, download filename) for an allowed public download.

    Raises DownloadRefused for anything not allowed. Not-public media is a 404
    (no hint it exists); public media whose level or rights forbid the
    variant is a 403.
    """
    if variant not in DOWNLOAD_VARIANTS:
        raise DownloadRefused(422, "invalid_variant", "variant must be 'access' or 'original'")
    media = get_public_media(db, org, media_id)
    if not media:
        raise DownloadRefused(404, "not_found", "File not found")
    derivs = _derivatives(media, db)
    if variant not in allowed_variants(media, db, derivs):
        raise DownloadRefused(
            403,
            "download_not_permitted",
            "The original file is not available for download"
            if variant == "original"
            else "An access copy is not available for download",
        )
    stem = (media.filename or "download").rsplit(".", 1)[0]
    if variant == "access":
        d = access_copy(media, derivs)
        ext, _, _ = _access_copy_file_facts(media, d)
        return d.s3_key, _safe_filename(f"{stem}_access.{ext}")
    return media.s3_key, _safe_filename(media.filename or "download")


def signed_download_url(key: str, filename: str, org: Organization, db: Session) -> str | None:
    """A short-lived URL that downloads ``key`` as an attachment."""
    from app.services.uploads import get_org_media_url_byob

    return get_org_media_url_byob(
        key,
        organization_id=str(org.organization_id),
        db_session=db,
        expiry_seconds=_DOWNLOAD_URL_EXPIRY,
        filename=filename,
    )


# ---------------------------------------------------------------------------
# Images on anonymous surfaces (logos, heroes, thumbnails, social previews)
# ---------------------------------------------------------------------------


def public_may_take_original(media: Media, db: Session) -> bool:
    """Whether the public may be handed this file's master.

    Only when the file's own public download level is ``originals`` and its
    rights allow it — the same rule the Discover download endpoint enforces.
    """
    if not media or not media.s3_key:
        return False
    try:
        return "original" in allowed_variants(media, db)
    except Exception as e:  # noqa: BLE001 - fail closed
        logger.warning("Could not check public original access for %s: %s", media.media_id, e)
        return False


def public_image_key(media: Media | None, db: Session, *, thumbnail: bool = False) -> str | None:
    """The storage key an anonymous page may show for ``media``.

    A rendition first (display or thumbnail tier), then the generated
    thumbnail, and the uploaded master only when the file's public download
    level allows originals. None means show nothing: a missing image is
    recoverable, a leaked master is not.
    """
    if media is None:
        return None
    from app.serializers.media import (
        _DISPLAY_DERIVATIVE_ORDER,
        _THUMBNAIL_DERIVATIVE_ORDER,
        _display_key_for_image,
    )

    key = _display_key_for_image(
        media, db, prefer=_THUMBNAIL_DERIVATIVE_ORDER if thumbnail else _DISPLAY_DERIVATIVE_ORDER,
    )
    if key:
        return key
    if media.thumbnail_s3_key:
        return media.thumbnail_s3_key
    if public_may_take_original(media, db):
        return media.s3_key
    return None


def sign_public_image(
    media: Media | None, db: Session, *, organization_id=None, thumbnail: bool = False,
) -> str | None:
    """A signed URL for :func:`public_image_key`, or None."""
    key = public_image_key(media, db, thumbnail=thumbnail)
    if not key:
        return None
    try:
        return _sign(key, organization_id or media.organization_id, db)
    except Exception as e:  # noqa: BLE001 - an image must not break the page
        logger.warning("Failed to sign public image for %s: %s", media.media_id, e)
        return None


# A logo is a small graphic staff place in the portal's header or footer on
# purpose. SVG logos never get raster renditions, so requiring one would drop
# the logo; serving the published file is the publish decision itself.
LOGO_MAX_BYTES = 2 * 1024 * 1024


def sign_public_logo(media: Media | None, db: Session, *, organization_id=None) -> str | None:
    """Like :func:`sign_public_image`, but for the header/footer logo slots:
    a published image of at most LOGO_MAX_BYTES with no rendition is served
    as uploaded."""
    url = sign_public_image(media, db, organization_id=organization_id)
    if url or media is None:
        return url
    if (
        media.media_type == "image"
        and media.is_published
        and media.s3_key
        and (media.file_size or 0) <= LOGO_MAX_BYTES
    ):
        try:
            return _sign(media.s3_key, organization_id or media.organization_id, db)
        except Exception as e:  # noqa: BLE001
            logger.warning("Failed to sign public logo for %s: %s", media.media_id, e)
    return None
