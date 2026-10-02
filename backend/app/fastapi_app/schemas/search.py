"""Pydantic response models for search endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class SearchHitOut(BaseModel):
    entity_key: str
    entity_type: str | None = None
    dataset_id: str | None = None
    title: str | None = None
    object_number: str | None = None
    description: str | None = None
    thumbnail_url: str | None = None
    creators: Any | None = None
    dates: Any | None = None
    score: float
    highlights: Any | None = None


class FacetBucketOut(BaseModel):
    key: str
    doc_count: int
    label: str | None = None


class FacetOut(BaseModel):
    field: str
    buckets: list[FacetBucketOut]


class SearchResponse(BaseModel):
    hits: list[SearchHitOut]
    total: int
    facets: list[FacetOut] | None = None
    took_ms: int
    next_offset: int | None = None


class AutocompleteSuggestionOut(BaseModel):
    value: str
    entity_key: str
    highlight: str | None = None


class AutocompleteResponse(BaseModel):
    suggestions: list[AutocompleteSuggestionOut]


class SimilarEntityOut(BaseModel):
    entity_key: str
    title: str | None = None
    thumbnail_url: str | None = None
    score: float


class SimilarResponse(BaseModel):
    similar: list[SimilarEntityOut]
