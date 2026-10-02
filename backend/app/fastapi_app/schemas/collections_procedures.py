"""Pydantic response models for collections-procedures endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Object Entry
# ---------------------------------------------------------------------------

class ObjectEntryOut(BaseModel):
    """Serialized object entry — mirrors _serialize_object_entry output."""
    model_config = {"extra": "allow"}

    entry_id: str
    organization_id: str
    entry_number: str | None = None
    status: str | None = None

    # allow extra fields from serializer


class ObjectEntryListResponse(BaseModel):
    items: list[Any] = []
    total: int
    limit: int
    offset: int


class ObjectEntryDetailResponse(BaseModel):
    """Detail view with items and field-access filtering — dynamic keys."""
    model_config = {"extra": "allow"}


# ---------------------------------------------------------------------------
# Object Entry Media
# ---------------------------------------------------------------------------

class EntryMediaItem(BaseModel):
    media_id: str
    filename: str | None = None
    media_type: str | None = None
    mime_type: str | None = None
    thumbnail_url: str | None = None
    preview_url: str | None = None
    is_primary: bool | None = None
    sort_order: int | None = None
    caption: str | None = None
    usage_type: str | None = None
    # Rights-derived gate ('direct' | 'request' | 'blocked') so the Collections
    # object workspace can offer inline download / request actions.
    download_access: str | None = None


class EntryMediaListResponse(BaseModel):
    media: list[EntryMediaItem]
    count: int


class EntryMediaAddedResponse(BaseModel):
    message: str
    data: dict[str, Any]


class EntryMediaSetPrimaryResponse(BaseModel):
    message: str
    data: dict[str, Any]


# ---------------------------------------------------------------------------
# Acquisition
# ---------------------------------------------------------------------------

class AcquisitionOut(BaseModel):
    """Serialized acquisition — mirrors _serialize_acquisition output."""
    model_config = {"extra": "allow"}

    acquisition_id: str
    organization_id: str
    acquisition_number: str | None = None
    status: str | None = None


class AcquisitionListResponse(BaseModel):
    items: list[Any] = []
    total: int
    limit: int
    offset: int


# ---------------------------------------------------------------------------
# Acquisition Objects
# ---------------------------------------------------------------------------

class AcquisitionObjectOut(BaseModel):
    acquisition_object_id: str
    acquisition_id: str
    object_id: str
    organization_id: str
    note: str | None = None
    created_at: str | None = None
    object: dict[str, Any] | None = None


class AcquisitionObjectListResponse(BaseModel):
    objects: list[AcquisitionObjectOut]
    total: int


class ObjectAcquisitionResponse(BaseModel):
    acquisition: Any | None = None
    link: Any | None = None
