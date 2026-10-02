"""Shared helpers for the media create/update functions behind the draft factory.

The caller (router endpoint or draft applier) owns the transaction; these never
commit. Coercion helpers tolerate both already-typed values (router path, where
Pydantic/SQLAlchemy may have typed them) and JSON strings (draft payloads).
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from uuid import UUID

from app.models import Media


class MediaNotFound(Exception):
    """The target medium doesn't exist in the organization."""


class MediaPublishBlocked(Exception):
    """A hard publish-gate precondition (rights / review / consent) is unmet."""


def as_uuid(value) -> UUID | None:
    if value is None or isinstance(value, UUID):
        return value
    return UUID(str(value))


def as_date(value) -> date | None:
    if value is None or isinstance(value, date):
        return value
    return date.fromisoformat(str(value))


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def get_media(session, organization_id: UUID, media_id) -> Media:
    media = (
        session.query(Media)
        .filter(
            Media.media_id == as_uuid(media_id),
            Media.organization_id == organization_id,
        )
        .first()
    )
    if media is None:
        raise MediaNotFound(f"media {media_id} not found")
    return media
