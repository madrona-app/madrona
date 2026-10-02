"""Pydantic response schemas for collection object media endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class CollectionObjectMediaOut(BaseModel):
    """Serialized collection-object-media link.

    extra="allow" is required here because the serializer dynamically adds
    nested media fields (thumbnail_url, derivatives, etc.) that vary by context.
    """
    class Config:
        extra = "allow"


class ObjectMediaListResponse(BaseModel):
    media: list[Any]
    total: int


class SetPrimaryMediaResponse(BaseModel):
    success: bool
    media_id: str
