"""Pydantic response schemas for vocabulary endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class VocabularyTermOut(BaseModel):
    term_id: str
    organization_id: str | None = None
    vocabulary: str | None = None
    external_id: str | None = None
    external_uri: str | None = None
    preferred_term: str | None = None
    alternate_terms: Any = None
    scope_note: str | None = None
    term_type: str | None = None
    hierarchy_path: str | None = None
    broader_term: str | None = None
    applicable_fields: Any = None
    usage_count: int | None = None
    status: str | None = None
    is_custom: bool | None = None
    facet: str | None = None
    hierarchy_fetched_at: str | None = None
    getty_modified_at: str | None = None


class VocabularySearchResponse(BaseModel):
    terms: list[Any]
    total: int


class VocabularyLookupTermOut(BaseModel):
    """Returned by lookup — uses to_dict() shape (Any for flexibility)."""


class VocabularyTermHierarchyResponse(BaseModel):
    """Dynamic hierarchy response — varies by term.

    extra="allow" is required here because the hierarchy depth and
    structure vary per vocabulary term (Getty AAT, TGN, ULAN trees).
    """
    class Config:
        extra = "allow"


class VocabularyBrowseByFacetResponse(BaseModel):
    vocabulary: str
    facet: str
    terms: list[VocabularyTermOut]


class VocabularyBrowseFacetsResponse(BaseModel):
    vocabulary: str
    facets: list[Any]


class VocabularyExpandResponse(BaseModel):
    original_count: int
    expanded_count: int
    terms: list[Any]


class VocabularySyncResponse(BaseModel):
    status: str
    task_id: str
    term_id: str
    vocabulary: str
    external_id: str


class VocabularyImportQueuedResponse(BaseModel):
    status: str
    task_id: str | None = None
    term_id: str | None = None
    vocabulary: str
    external_id: str
    preferred_term: str | None = None
