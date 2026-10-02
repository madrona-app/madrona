"""
Pydantic schemas for Collections search API.

procedure-aware request/response models for collection object search.
"""

from typing import Optional, Literal
from pydantic import BaseModel, Field


class CollectionsSearchQuery(BaseModel):
    """Full-text search query parameters."""
    q: Optional[str] = Field(None, description="Search query string")
    fields: Optional[list[str]] = Field(
        None,
        description="Fields to search (defaults to title, object_number, description, creators, etc.)"
    )


class CollectionsSearchFilters(BaseModel):
    """procedure-aware structured filters for Collections search."""
    object_type: Optional[list[str]] = Field(None, description="Filter by object type")
    classification: Optional[list[str]] = Field(None, description="Filter by classification")
    object_status: Optional[list[str]] = Field(None, description="Filter by object status")
    location_id: Optional[list[str]] = Field(None, description="Filter by location ID")
    on_display: Optional[bool] = Field(None, description="Filter by on-display status")
    creator_name: Optional[str] = Field(None, description="Filter by creator name")
    material: Optional[str] = Field(None, description="Filter by material")
    technique: Optional[str] = Field(None, description="Filter by technique")
    date_from: Optional[str] = Field(None, description="Filter by earliest creation date (YYYY-MM-DD or YYYY)")
    date_to: Optional[str] = Field(None, description="Filter by latest creation date (YYYY-MM-DD or YYYY)")
    acquisition_method: Optional[str] = Field(None, description="Filter by acquisition method")
    condition_rating: Optional[list[str]] = Field(None, description="Filter by condition rating")
    is_discoverable: Optional[bool] = Field(None, description="Filter by public discoverability")
    subject: Optional[str] = Field(None, description="Filter by subject term")
    style_period: Optional[list[str]] = Field(None, description="Filter by style/period")
    creation_place: Optional[str] = Field(None, description="Filter by creation place")
    has_image: Optional[bool] = Field(None, description="Filter by presence of primary image")

    # Vocabulary term filtering with expansion support
    material_term_ids: Optional[list[str]] = Field(
        None, description="Filter by material vocabulary term IDs (UUID strings)"
    )
    technique_term_ids: Optional[list[str]] = Field(
        None, description="Filter by technique vocabulary term IDs (UUID strings)"
    )
    classification_term_ids: Optional[list[str]] = Field(
        None, description="Filter by classification vocabulary term IDs (UUID strings)"
    )


class SearchSort(BaseModel):
    """Sort configuration."""
    field: str = Field("_score", description="Field to sort by")
    order: Literal["asc", "desc"] = Field("desc", description="Sort order")


class CollectionsAdvancedCriterion(BaseModel):
    """Single advanced search criterion for Collections."""
    field: Literal[
        "title", "object_number", "object_name", "description",
        "creator", "material", "technique", "subject",
        "place", "inscription", "provenance", "classification",
        "credit_line", "any"
    ] = Field(description="Field to search")
    operator: Literal["contains", "equals", "starts_with", "not_contains"] = Field(
        "contains", description="Search operator"
    )
    value: str = Field(description="Search value")


class CollectionsSearchRequest(BaseModel):
    """Complete Collections search request."""
    query: Optional[CollectionsSearchQuery] = None
    filters: Optional[CollectionsSearchFilters] = None
    sort: Optional[SearchSort] = None

    # Advanced search criteria
    advanced_criteria: Optional[list[CollectionsAdvancedCriterion]] = Field(
        None, description="Advanced search criteria"
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

    # Vocabulary expansion options
    expand_vocabulary_terms: bool = Field(
        False,
        description="Expand vocabulary term filters to include narrower (more specific) terms"
    )
    vocabulary_expansion_depth: int = Field(
        2, ge=1, le=5,
        description="How many levels deep to expand vocabulary terms (default: 2)"
    )


class CollectionsSearchHit(BaseModel):
    """Single Collections search result."""
    object_id: str
    object_number: Optional[str] = None
    title: Optional[str] = None
    object_name: Optional[str] = None
    brief_description: Optional[str] = None
    object_type: Optional[str] = None
    classification: Optional[str] = None
    object_status: Optional[str] = None
    is_discoverable: Optional[bool] = None
    creators: Optional[list[dict]] = None
    materials: Optional[list[dict]] = None
    creation_date: Optional[dict] = None
    condition: Optional[dict] = None
    current_location: Optional[dict] = None
    primary_image_url: Optional[str] = None
    score: Optional[float] = None
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


class CollectionsSearchResponse(BaseModel):
    """Collections search response."""
    hits: list[CollectionsSearchHit]
    total: int
    facets: Optional[list[Facet]] = None
    took_ms: int
    next_offset: Optional[int] = None
    used_semantic_search: bool = False


class CollectionsAutocompleteSuggestion(BaseModel):
    """Single autocomplete suggestion."""
    value: str
    object_id: str
    object_number: Optional[str] = None
    highlight: Optional[str] = None


class CollectionsAutocompleteResponse(BaseModel):
    """Autocomplete response."""
    suggestions: list[CollectionsAutocompleteSuggestion]
