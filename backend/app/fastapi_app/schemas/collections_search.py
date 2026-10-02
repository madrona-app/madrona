"""Pydantic response schemas for collection search endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class CollectionSearchResponse(BaseModel):
    """Search response — dynamic shape from OpenSearch service.

    extra="allow" is required here because OpenSearch returns variable
    aggregation buckets, highlights, and scoring metadata per query type.
    """
    class Config:
        extra = "allow"


class AutocompleteResponse(BaseModel):
    """Autocomplete response — dynamic shape from OpenSearch service.

    extra="allow" is required here because suggestion shapes vary by
    completion type (prefix, fuzzy, cross-field).
    """
    suggestions: list[Any] | None = None

    class Config:
        extra = "allow"


class ReindexResponse(BaseModel):
    success: bool
    total: int
    indexed: int
    errors: int
    debug_all_objects: Any = None


class EnableSemanticSearchResponse(BaseModel):
    success: bool
    message: str
    task_id: str
