"""Pydantic schemas for the public DAM API.

Matches the exact output shape of the existing Flask serializers
in app/api/dam_public.py.
"""

from typing import Any

from pydantic import BaseModel

from app.fastapi_app.schemas.common import PaginationOut


# ---- Media schemas ----

class MediaRightsOut(BaseModel):
    """Rights information for a media item."""
    type: str | None = None
    holder: str | None = None
    license: str | None = None
    statement: str | None = None


class DerivativeOut(BaseModel):
    """Media derivative."""
    width: int | None = None
    height: int | None = None
    format: str | None = None
    url: str | None = None


class ObjectMetadataLinkOut(BaseModel):
    """Object metadata attached to a media item (when ?include=object_metadata)."""
    object_id: str | None = None
    is_primary: bool | None = None
    caption: str | None = None
    # Additional fields from get_safe_metadata_for_embedding
    model_config = {"extra": "allow"}


class PublicMediaOut(BaseModel):
    """Published media item."""
    id: str
    title: str | None = None
    description: str | None = None
    media_type: str | None = None
    mime_type: str | None = None
    width: int | None = None
    height: int | None = None
    duration: float | None = None
    file_size: int | None = None
    alt_text: str | None = None
    attribution: str | None = None
    created_at: str | None = None
    dublin_core: dict[str, Any] | None = None
    url: str | None = None
    derivatives: dict[str, DerivativeOut] | None = None
    rights: MediaRightsOut | None = None
    object_metadata: list[dict[str, Any]] | None = None

    model_config = {"from_attributes": True}


# ---- Object schemas ----

class ObjectTitleOut(BaseModel):
    """Object title entry."""
    title: str | None = None
    title_type: str | None = None
    language: str | None = None
    is_preferred: bool | None = None


class DimensionOut(BaseModel):
    """Object measurement/dimension."""
    dimension: str | None = None
    value: float | None = None
    unit: str | None = None
    part: str | None = None


class ClassificationOut(BaseModel):
    """Classification term."""
    term: str | None = None


class ObjectMediaLinkOut(BaseModel):
    """Media linked to an object."""
    media: PublicMediaOut
    is_primary: bool | None = None
    caption: str | None = None


class PublicObjectOut(BaseModel):
    """Published collection object."""
    id: str
    object_number: str | None = None
    title: str | None = None
    titles: list[ObjectTitleOut] | None = None
    description: str | None = None
    date_created: str | None = None
    date_created_display: str | None = None
    creator: str | None = None
    medium: str | None = None
    dimensions: list[DimensionOut] | None = None
    credit_line: str | None = None
    classification: str | None = None
    classifications: list[ClassificationOut] | None = None
    created_at: str | None = None
    media: list[ObjectMediaLinkOut] | None = None
    metadata: dict[str, Any] | None = None

    model_config = {"from_attributes": True}


# ---- Response wrappers ----

class PaginatedMediaResponse(BaseModel):
    """Paginated list of media items."""
    data: list[PublicMediaOut]
    pagination: PaginationOut


class SingleMediaResponse(BaseModel):
    """Single media item response."""
    data: PublicMediaOut


class PaginatedObjectResponse(BaseModel):
    """Paginated list of objects."""
    data: list[PublicObjectOut]
    pagination: PaginationOut


class SingleObjectResponse(BaseModel):
    """Single object response."""
    data: PublicObjectOut


class ObjectMediaResponse(BaseModel):
    """Media list for an object."""
    data: list[ObjectMediaLinkOut]


# ---- Sync schemas ----

class SyncDataOut(BaseModel):
    """Sync data payload."""
    media: list[PublicMediaOut]
    objects: list[PublicObjectOut]


class SyncMetaOut(BaseModel):
    """Sync metadata."""
    since: str
    until: str
    media_count: int
    object_count: int
    has_more: bool


class SyncResponse(BaseModel):
    """Sync endpoint response."""
    data: SyncDataOut
    sync: SyncMetaOut
