"""
Pydantic schemas for search API.

Defines request/response models for the OpenSearch-powered entity search.
"""

from typing import Optional, Literal
from pydantic import BaseModel, Field


class SearchQuery(BaseModel):
    """Full-text search query parameters."""
    q: Optional[str] = Field(None, description="Search query string")
    fields: Optional[list[str]] = Field(
        None,
        description="Fields to search (default: title, description, object_number)"
    )
    fuzziness: Optional[str] = Field(
        "AUTO",
        description="Fuzziness for typo tolerance (0, 1, 2, AUTO)"
    )


class SearchFilters(BaseModel):
    """Structured filters for search."""
    dataset_id: Optional[list[str]] = Field(None, description="Filter by dataset IDs")
    entity_type: Optional[list[str]] = Field(None, description="Filter by entity types")
    creator_name: Optional[str] = Field(None, description="Filter by creator name")
    date_from: Optional[str] = Field(None, description="Filter by earliest date (YYYY-MM-DD)")
    date_to: Optional[str] = Field(None, description="Filter by latest date (YYYY-MM-DD)")
    on_display: Optional[bool] = Field(None, description="Filter by on-display status")
    classification_scheme: Optional[str] = Field(None, description="Classification scheme")
    classification_term: Optional[str] = Field(None, description="Classification term ID")


class SearchSort(BaseModel):
    """Sort configuration."""
    field: str = Field("_score", description="Field to sort by")
    order: Literal["asc", "desc"] = Field("desc", description="Sort order")


class AdvancedCriterion(BaseModel):
    """Single advanced search criterion."""
    field: Literal["title", "object_number", "description", "creator", "classification", "any"] = Field(
        description="Field to search"
    )
    operator: Literal["contains", "equals", "starts_with", "not_contains"] = Field(
        "contains", description="Search operator"
    )
    value: str = Field(description="Search value")


class SearchRequest(BaseModel):
    """Complete search request."""
    query: Optional[SearchQuery] = None
    filters: Optional[SearchFilters] = None
    sort: Optional[SearchSort] = None

    # Advanced search criteria
    advanced_criteria: Optional[list[AdvancedCriterion]] = Field(
        None, description="Advanced search criteria (combined with AND)"
    )
    advanced_operator: Literal["and", "or"] = Field(
        "and", description="How to combine advanced criteria"
    )

    # Pagination
    limit: int = Field(20, ge=1, le=100, description="Number of results")
    offset: int = Field(0, ge=0, description="Offset for pagination")

    # Facets
    include_facets: bool = Field(True, description="Include facet aggregations")
    facet_size: int = Field(20, ge=1, le=100, description="Max facet values per field")

    # Options
    highlight: bool = Field(True, description="Include search highlights")
    explain: bool = Field(False, description="Include relevance explanation")


class SearchHit(BaseModel):
    """Single search result."""
    entity_key: str
    entity_type: Optional[str] = None
    dataset_id: Optional[str] = None
    title: Optional[str] = None
    object_number: Optional[str] = None
    description: Optional[str] = None
    thumbnail_url: Optional[str] = None
    creators: Optional[list[dict]] = None
    dates: Optional[dict] = None
    score: float
    highlights: Optional[dict[str, list[str]]] = None


class FacetBucket(BaseModel):
    """Single facet value."""
    key: str
    doc_count: int
    label: Optional[str] = None


class Facet(BaseModel):
    """Facet aggregation result."""
    field: str
    buckets: list[FacetBucket]


class SearchResponse(BaseModel):
    """Search response."""
    hits: list[SearchHit]
    total: int
    facets: Optional[list[Facet]] = None
    took_ms: int

    # For cursor-based pagination
    next_offset: Optional[int] = None


class AutocompleteSuggestion(BaseModel):
    """Single autocomplete suggestion."""
    value: str
    entity_key: str
    highlight: Optional[str] = None


class AutocompleteResponse(BaseModel):
    """Autocomplete response."""
    suggestions: list[AutocompleteSuggestion]


class SimilarEntity(BaseModel):
    """Similar entity result."""
    entity_key: str
    title: Optional[str] = None
    thumbnail_url: Optional[str] = None
    score: float


class SimilarResponse(BaseModel):
    """Similar entities response."""
    similar: list[SimilarEntity]
