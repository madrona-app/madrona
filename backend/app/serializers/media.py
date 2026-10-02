"""
Media serialization functions.

Extracted from app/api/media.py for use by FastAPI routers, services, and
collections serializers without pulling in Flask route dependencies.
"""
from __future__ import annotations

from app.models import Media, MediaDerivative
from app.services.uploads import get_org_media_url, MediaUrlType


# Derivative preferred for on-screen display, best first. Any of these is a
# generated rendition, never the uploaded master.
_DISPLAY_DERIVATIVE_ORDER = ("large", "medium", "small")

# Smallest usable rendition first, for slots that render at thumbnail size.
# The display order above falls *up* to `large`, so reusing it for a thumbnail
# fallback puts a megabyte-scale image in an 80-pixel box. Both orders end at
# the same tiers, so a thumbnail slot still degrades to something rather than
# nothing when the small renditions are missing.
_THUMBNAIL_DERIVATIVE_ORDER = ("thumbnail", "square_thumb", "small", "medium", "large")


def _display_key_for_image(media, session, *, prefer=_DISPLAY_DERIVATIVE_ORDER) -> str | None:
    """
    The key an image should be *displayed* from.

    `url` used to carry the original master, minted with url_type=VIEW and so
    needing only media.view. Everything that rendered an image therefore also
    handed every viewer a working link to the full-resolution file — which is
    what let Copy Direct Link and the Download button hand out originals
    regardless of media.download_original or the asset's rights.

    Display now comes from a rendition; the master is reachable only through
    the permission-gated download route.

    Returns None when no rendition can be found, and callers fall back to the
    thumbnail rather than the master — a degraded image is recoverable, a
    leaked original is not.

    `prefer` sets the tier order. Pass _THUMBNAIL_DERIVATIVE_ORDER for slots
    that render small; the default is best-quality-first for full display.
    """
    derivatives = getattr(media, "derivatives", None)

    # Not loaded (list serializers don't eager-load them): one bounded query
    # rather than silently falling back to the original.
    if not derivatives and session is not None:
        try:
            from app.models.media import MediaDerivative

            derivatives = (
                session.query(MediaDerivative)
                .filter(MediaDerivative.media_id == media.media_id)
                .all()
            )
        except Exception:  # noqa: BLE001 - display must not break on this
            derivatives = None

    if not derivatives:
        return None

    for kind in prefer:
        for d in derivatives:
            if d.derivative_type == kind and d.format == "jpeg" and d.s3_key:
                return d.s3_key
    return None


def _serialize_media(
    media: Media,
    include_url: bool = True,
    include_derivatives: bool = False,
    user_id: str | None = None,
    session=None,
    *,
    include_preview_url: bool = False,
    include_lock: bool = False,
    include_download_access: bool = False,
) -> dict:
    """
    Serialize a Media object to JSON.

    Optional flags add fields that some callers (notably the media_library
    router serving the per-asset detail view) need but other callers
    (collection nesting, procedure attachments) don't:

        include_preview_url:    fold in the 'small' jpeg derivative URL
        include_lock:           include MediaLock status (locked_by, etc.)
        include_download_access: include rights-derived 'direct|request|blocked'
    """
    if session is None:
        from app.database import current_session
        session = current_session()

    is_published = getattr(media, 'is_published', False)

    result = {
        "media_id": str(media.media_id),
        "organization_id": str(media.organization_id),
        "s3_key": media.s3_key,
        "filename": media.filename,
        "file_size": media.file_size,
        "mime_type": media.mime_type,
        "media_type": media.media_type,
        "width": media.width,
        "height": media.height,
        "duration_seconds": media.duration_seconds,
        "title": media.title,
        "description": media.description,
        "alt_text": media.alt_text,
        "ai_alt_text": media.ai_alt_text,
        "ai_description_long": media.ai_description_long,
        "ai_description_emoji": media.ai_description_emoji,
        "ai_descriptions_generated_at": (
            media.ai_descriptions_generated_at.isoformat()
            if media.ai_descriptions_generated_at else None
        ),
        "ai_descriptions_model": media.ai_descriptions_model,
        "caption": (media.iptc_metadata or {}).get("caption"),
        "copyright_notice": (media.iptc_metadata or {}).get("copyright_notice"),
        "credit": media.credit,
        "creator": media.creator,
        "source": media.source,
        "date_created": media.date_created.isoformat() if media.date_created else None,
        "copyright_status": media.copyright_status,
        "rights_statement": media.rights_statement,
        "license": media.license,
        "folder": media.folder,
        "metadata": media.extra_metadata,
        "processing_status": media.processing_status,
        "thumbnail_s3_key": media.thumbnail_s3_key,
        "created_at": media.created_at.isoformat() if media.created_at else None,
        "created_by": str(media.created_by) if media.created_by else None,
        "updated_at": media.updated_at.isoformat() if media.updated_at else None,
        # DAM extended fields
        "current_version": getattr(media, 'current_version', 1),
        "checksum_sha256": getattr(media, 'checksum_sha256', None),
        "is_published": is_published,
        "published_at": media.published_at.isoformat() if getattr(media, 'published_at', None) else None,
        "published_url": getattr(media, 'published_url', None),
        "published_by": str(media.published_by) if getattr(media, 'published_by', None) else None,
        # Metadata review status
        "metadata_reviewed": getattr(media, 'metadata_reviewed', False),
        "metadata_reviewed_at": media.metadata_reviewed_at.isoformat() if getattr(media, 'metadata_reviewed_at', None) else None,
        "metadata_reviewed_by": str(media.metadata_reviewed_by) if getattr(media, 'metadata_reviewed_by', None) else None,
        "metadata_review_notes": getattr(media, 'metadata_review_notes', None),
        # Extended metadata
        "technical_metadata": getattr(media, 'technical_metadata', None),
        "iptc_metadata": getattr(media, 'iptc_metadata', None),
        "xmp_metadata": getattr(media, 'xmp_metadata', None),
        "dublin_core": getattr(media, 'dublin_core', None),
    }

    if include_url:
        # Images display from a rendition so the master never travels in the
        # payload. Other types have no image rendition to stand in — video
        # and audio play from this URL and a PDF is read from it — so they
        # keep the original, and closing that needs transcoded proxies rather
        # than a serializer change.
        display_key = media.s3_key
        if getattr(media, "media_type", None) == "image":
            display_key = (
                _display_key_for_image(media, session)
                or media.thumbnail_s3_key
                or None
            )

        result["url"] = get_org_media_url(
            display_key,
            organization_id=str(media.organization_id),
            db_session=session,
            expiry_seconds=3600,
            user_id=user_id,
            media_id=str(media.media_id),
            url_type=MediaUrlType.VIEW,
            is_published=is_published,
        ) if display_key else None
        if media.thumbnail_s3_key:
            result["thumbnail_url"] = get_org_media_url(
                media.thumbnail_s3_key,
                organization_id=str(media.organization_id),
                db_session=session,
                expiry_seconds=3600,
                user_id=user_id,
                media_id=str(media.media_id),
                url_type=MediaUrlType.THUMBNAIL,
                is_published=is_published,
            )
        # preview_url: the 'small' jpeg derivative (600px). Right size for
        # grid cards and mid-size displays — bigger than the 200px
        # square_thumb but doesn't pull the original.
        if include_preview_url and hasattr(media, 'derivatives') and media.derivatives:
            small_deriv = next(
                (d for d in media.derivatives
                 if d.derivative_type == 'small' and d.format == 'jpeg'),
                None,
            )
            if small_deriv:
                result["preview_url"] = get_org_media_url(
                    small_deriv.s3_key,
                    organization_id=str(media.organization_id),
                    db_session=session,
                    expiry_seconds=3600,
                    user_id=user_id,
                    media_id=str(media.media_id),
                    url_type=MediaUrlType.VIEW,
                    is_published=is_published,
                )

    if include_derivatives and hasattr(media, 'derivatives') and media.derivatives:
        result["derivatives"] = [
            _serialize_derivative(d, user_id=user_id, is_published=is_published)
            for d in media.derivatives
        ]

    # MediaLock status — only meaningful for the per-asset detail view.
    if include_lock:
        from datetime import datetime, timezone
        from app.models.media import MediaLock
        lock = session.query(MediaLock).filter_by(media_id=media.media_id).first()
        # MediaLock.expires_at is timestamptz; guard retained for values
        # read. Coerce before comparing against tz-aware now().
        _lock_expires_at = None
        if lock:
            _lock_expires_at = lock.expires_at
            if _lock_expires_at and _lock_expires_at.tzinfo is None:
                _lock_expires_at = _lock_expires_at.replace(tzinfo=timezone.utc)
        if lock and _lock_expires_at and _lock_expires_at > datetime.now(timezone.utc):
            from app.models import User
            lock_user = session.query(User).filter_by(user_id=lock.locked_by).first()
            result["locked_by"] = str(lock.locked_by)
            result["locked_by_name"] = lock_user.display_name if lock_user else str(lock.locked_by)
            result["lock_expires_at"] = lock.expires_at.isoformat()
        else:
            result["locked_by"] = None
            result["locked_by_name"] = None
            result["lock_expires_at"] = None

    if user_id:
        result["current_user_id"] = user_id

    # Download access (direct | request | blocked) derived from MediaRights +
    # the requesting user's permissions.
    if include_download_access:
        if user_id:
            from app.services.download_access import compute_download_access
            from app.services.rbac_service import get_user_permissions
            perms = get_user_permissions(user_id, str(media.organization_id), session=session)
            result["download_access"] = compute_download_access(
                media.media_id, media.organization_id, perms, session,
            )
        else:
            result["download_access"] = "request"

    return result


def _serialize_derivative(
    derivative: MediaDerivative,
    include_url: bool = True,
    user_id: str | None = None,
    is_published: bool | None = None,
    session=None,
) -> dict:
    """Serialize a MediaDerivative object to JSON."""
    if session is None:
        from app.database import current_session
        session = current_session()

    result = {
        "derivative_id": str(derivative.derivative_id),
        "media_id": str(derivative.media_id),
        "derivative_type": derivative.derivative_type,
        "format": derivative.format,
        "s3_key": derivative.s3_key,
        "width": derivative.width,
        "height": derivative.height,
        "file_size": derivative.file_size,
        "quality": derivative.quality,
        "created_at": derivative.created_at.isoformat() if derivative.created_at else None,
    }

    if include_url:
        result["url"] = get_org_media_url(
            derivative.s3_key,
            organization_id=str(derivative.organization_id),
            db_session=session,
            expiry_seconds=3600,
            user_id=user_id,
            media_id=str(derivative.media_id),
            url_type=MediaUrlType.THUMBNAIL,
            is_published=is_published,
        )

    return result
