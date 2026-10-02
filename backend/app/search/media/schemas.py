"""
Media Search Schemas.

Defines request/response models for media search operations.
"""

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class TagFilter:
    """Filter for structured tags."""
    key: str
    value: str


@dataclass
class MediaSearchRequest:
    """Request for searching media library."""

    # Search query
    query: str = ""

    # Filters
    media_type: Optional[str] = None  # image, video, audio, document
    folder: Optional[str] = None
    copyright_status: Optional[str] = None
    creator: Optional[str] = None
    license_type: Optional[str] = None
    is_published: Optional[bool] = None
    processing_status: Optional[str] = None
    ai_processing_status: Optional[str] = None  # pending, processing, completed, failed, skipped
    color_key: Optional[str] = None  # Color bucket filter

    # Date range filters
    date_from: Optional[str] = None  # ISO date
    date_to: Optional[str] = None

    # Metadata filters
    has_exif: Optional[bool] = None
    has_iptc: Optional[bool] = None

    # Structured tag filters (list of key/value pairs)
    tag_filters: Optional[list[TagFilter]] = None

    # Pagination
    offset: int = 0
    limit: int = 50

    # Sorting
    sort_by: str = "relevance"  # relevance, created_at, title, file_size
    sort_order: str = "desc"

    # Options
    include_facets: bool = False
    highlight: bool = True


@dataclass
class StructuredTag:
    """A structured tag with key and value."""
    key: str
    value: str


@dataclass
class MediaSearchHit:
    """A single search result."""

    media_id: str
    filename: str
    title: Optional[str]
    description: Optional[str]
    media_type: str
    mime_type: str
    file_size: int
    width: Optional[int]
    height: Optional[int]
    creator: Optional[str]
    copyright_status: Optional[str]
    folder: Optional[str]
    structured_tags: Optional[list[StructuredTag]]
    processing_status: str
    is_published: bool
    created_at: Optional[str]
    score: float
    highlights: Optional[dict] = None


@dataclass
class FacetBucket:
    """A bucket in a facet."""

    key: str
    doc_count: int


@dataclass
class Facet:
    """A facet with buckets."""

    field: str
    buckets: list[FacetBucket]


@dataclass
class MediaSearchResponse:
    """Response from media search."""

    hits: list[MediaSearchHit]
    total: int
    facets: Optional[list[Facet]] = None
    took_ms: int = 0
    next_offset: Optional[int] = None
