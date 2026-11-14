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
* Video plays from a transcoded web proxy (a ``web_mp4_*`` / ``web_webm_*``
  derivative) when one exists. Audio and documents have no rendition
  pipeline, so the published file itself is what plays or opens; that is
  what publishing an audio file or PDF means. Publishing is the gate.
* Caption and transcript files are served through this API (same origin as
  the page, so ``<track>`` loads without CORS), never as raw storage URLs.

Downloads are a separate, per-file decision (``Media.public_download_level``):

* ``none`` (and NULL, the default): no download is offered and the download
  endpoint refuses every variant.
* ``derivatives``: the access copy only — an image's best JPEG rendition or a
  video's web proxy. Audio and documents have no access copy, so nothing.
* ``originals``: the access copy and the original master.

Download links point at ``/api/discover/{org}/media/{id}/download``, which
re-checks everything server side; a hidden link is not the control. Rights
are honoured too: expired rights block every public download, and when the
organization has media-rights enforcement on, the original needs an
open-access grant.

Limit, stated plainly for operators: the level governs downloads. Playing a
published audio file, or opening a published PDF, necessarily transfers the
file, so a visitor can still save what they can play or read. Do not publish
a file that must not leave the building.
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


def public_media_query(db: Session, org: Organization):
    """Media an anonymous visitor may reach for ``org``.

    Published, owned by the org, and linked to at least one discoverable,
    non-deleted object of the org.
    """
    linked = (
        db.query(CollectionObjectMedia.media_id)
        .join(CollectionObject, CollectionObject.object_id == CollectionObjectMedia.object_id)
        .filter(
            CollectionObject.organization_id == org.organization_id,
            CollectionObject.is_discoverable == True,  # noqa: E712
            CollectionObject.is_deleted == False,  # noqa: E712
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


def _time_based_or_document_item(media: Media, org_slug: str, db: Session) -> dict | None:
    derivs = _derivatives(media, db)
    if media.media_type == "video":
        proxy = video_proxy(derivs)
        # No web proxy: the published file is the only playable source.
        play_key = proxy.s3_key if proxy else media.s3_key
        mime = (f"video/{proxy.format}" if proxy and proxy.format in ("mp4", "webm") else media.mime_type)
    else:
        play_key = media.s3_key
        mime = media.mime_type
    url = _sign(play_key, media.organization_id, db)
    if not url:
        return None
    captions, texts = _text_tracks(media, org_slug, db)
    transcript = (media.transcript or "").strip() or None
    return {
        "url": url,
        "srcset": None,
        "playback_mime_type": mime,
        "poster_url": _sign(_poster_key(media, derivs), media.organization_id, db) if media.media_type == "video" else None,
        "captions": captions,
        "transcript": transcript,
        "transcript_machine_generated": bool(transcript and media.transcription_model),
        "text_alternatives": texts,
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
    return None


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
            fmt = (d.format or "").lower()
            entries.append({
                "variant": "access",
                "url": download_path(org_slug, media.media_id, "access"),
                "label": "Access copy",
                "format": fmt.upper() if fmt else None,
                "mime_type": f"video/{fmt}" if media.media_type == "video" else f"image/{fmt}",
                "file_size": d.file_size or None,
                "width": d.width or None,
                "height": d.height or None,
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
        return d.s3_key, _safe_filename(f"{stem}_access.{d.format}")
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
