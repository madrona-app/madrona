"""Pydantic response models for autocomplete endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class AutocompleteReferenceOut(BaseModel):
    uri: str | None = None
    source: str | None = None
    label: str | None = None
    match_confidence: str | None = None


class AutocompleteSuggestionOut(BaseModel):
    id: str
    label: str
    description: str | None = None
    source: str | None = None
    score: float | None = None
    reference: AutocompleteReferenceOut | None = None
    metadata: dict[str, Any] | None = None


class AutocompleteDebugOut(BaseModel):
    field_type: str
    sources_requested: list[str]
    sources_for_field: list[str]
    query_length: int
    local_count: int
    external_count: int


class AutocompleteSearchResponse(BaseModel):
    query: str
    suggestions: list[AutocompleteSuggestionOut]
    external_searched: bool
    warnings: list[str] | None = None
    search_time_ms: int
    debug: AutocompleteDebugOut


# get_recent / get_popular return list[AutocompleteSuggestionOut] directly
