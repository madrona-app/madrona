"""Pydantic schemas for Public Collection Discovery API endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


# ---- Discover Info ----

class DiscoverInfoOut(BaseModel):
    """Public discover configuration/info."""
    organization_name: str | None = None
    organization_slug: str | None = None
    total_discoverable: int = 0
    hero_image_url: str | None = None
    page_title: str | None = None
    page_subtitle: str | None = None
    show_object_count: bool = True
    default_view_mode: str = "grid"
    default_sort: str = "relevance"
    header_logo_url: str | None = None
    primary_color: str | None = None
    accent_color: str | None = None
    font_family: str | None = None
    nav_items: Any | None = None
    footer_text: str | None = None
    social_links: Any | None = None
    homepage_page_id: str | None = None
    custom_404_page_id: str | None = None
    secondary_color: str | None = None
    background_color: str | None = None
    text_color: str | None = None
    heading_font_family: str | None = None
    body_font_family: str | None = None
    button_style: str = "rounded"
    header_style: str = "solid"
    google_fonts: Any | None = None
    custom_css: str | None = None
    footer_columns: Any | None = None
    land_acknowledgment: str | None = None
    footer_logo_url: str | None = None
    external_integrations: Any | None = None
    analytics_config: Any | None = None
    # Guide / visitor widget. guide_enabled = org has the Guide app;
    # widget_enabled additionally requires the per-org widget_enabled config
    # flag (off by default). guide_enabled was previously dropped by this
    # schema (missing field), which silently hid the widget everywhere.
    guide_enabled: bool = False
    widget_enabled: bool = False
    widget_welcome_message: str | None = None


# ---- Search ----

class DiscoverSearchHitOut(BaseModel):
    """Search hit for discover."""
    object_id: str
    object_number: str | None = None
    title: str | None = None
    brief_description: str | None = None
    creators: list[str] | None = None
    creation_date_display: str | None = None
    classification: str | None = None
    object_type: str | None = None
    thumbnail_url: str | None = None
    thumbnail_srcset: Any | None = None
    has_image: bool = False


class DiscoverFacetBucketOut(BaseModel):
    """Facet bucket."""
    key: str
    count: int


class DiscoverFacetOut(BaseModel):
    """Facet field with buckets."""
    field: str
    buckets: list[DiscoverFacetBucketOut]


class DiscoverSearchResponse(BaseModel):
    """Discover search response."""
    hits: list[DiscoverSearchHitOut]
    total: int
    facets: list[DiscoverFacetOut] | None = None
    next_offset: int | None = None


# ---- Object Detail ----

class DiscoverTitleOut(BaseModel):
    """Object title."""
    title: str | None = None
    title_type: str | None = None
    language: str | None = None
    is_preferred: bool | None = None


class DiscoverMeasurementOut(BaseModel):
    """Object measurement."""
    dimension: str | None = None
    value: float | None = None
    unit: str | None = None
    part: str | None = None


class DiscoverMediaOut(BaseModel):
    """Media item in object detail."""
    media_id: str
    url: str | None = None
    srcset: Any | None = None
    media_type: str | None = None
    mime_type: str | None = None
    width: int | None = None
    height: int | None = None
    alt_text: str | None = None
    credit: str | None = None
    is_primary: bool | None = None
    caption: str | None = None


class DiscoverObjectDetailOut(BaseModel):
    """Full object detail for discover."""
    object_id: str
    object_number: str | None = None
    canonical_url: str | None = None
    title: str | None = None
    titles: list[DiscoverTitleOut] | None = None
    brief_description: str | None = None
    full_description: str | None = None
    object_type: str | None = None
    classification: str | None = None
    classifications: list[dict[str, Any]] | None = None
    creators: list[str] | None = None
    creation_date_display: str | None = None
    creation_date_earliest: str | None = None
    creation_date_latest: str | None = None
    creation_place: str | None = None
    materials: Any | None = None
    techniques: Any | None = None
    measurements: list[DiscoverMeasurementOut] | None = None
    inscriptions: list[str] | None = None
    style_period: str | None = None
    provenance: str | None = None
    credit_line: str | None = None
    media: list[DiscoverMediaOut] | None = None
    has_image: bool = False


# ---- Related Objects ----

class RelatedObjectHitOut(BaseModel):
    """Related object hit."""
    object_id: str
    object_number: str | None = None
    title: str | None = None
    creators: list[str] | None = None
    creation_date_display: str | None = None
    classification: str | None = None
    thumbnail_url: str | None = None
    thumbnail_srcset: Any | None = None


class RelatedObjectsResponse(BaseModel):
    """Related objects response."""
    hits: list[RelatedObjectHitOut]


# ---- Featured ----

class FeaturedObjectsResponse(BaseModel):
    """Featured objects response."""
    hits: list[DiscoverSearchHitOut]


# ---- Events ----

class DiscoverEventOut(BaseModel):
    """Public event."""
    event_id: str
    title: str | None = None
    slug: str | None = None
    event_type: str | None = None
    status: str | None = None
    start_at: str | None = None
    end_at: str | None = None
    description: str | None = None
    short_description: str | None = None
    location_name: str | None = None
    venue_name: str | None = None
    venue_slug: str | None = None
    capacity: int | None = None
    registration_url: str | None = None
    price: str | None = None
    price_member: str | None = None
    age_range: str | None = None
    is_featured: bool | None = None
    series_name: str | None = None
    tags: Any | None = None
    hero_image_url: str | None = None
    exhibition: dict[str, Any] | None = None


class DiscoverEventListResponse(BaseModel):
    """Event list."""
    data: list[DiscoverEventOut]
    total: int


class DiscoverEventDetailOut(DiscoverEventOut):
    """Event detail (same shape but may include exhibition info)."""
    pass


# ---- Staff ----

class DiscoverStaffOut(BaseModel):
    """Public staff member."""
    constituent_id: str
    name: str | None = None
    title: str | None = None
    role: str | None = None
    department: str | None = None
    email: str | None = None
    biography: str | None = None


class DiscoverStaffListResponse(BaseModel):
    """Staff list."""
    data: list[DiscoverStaffOut]
    total: int


# ---- Venues ----

class DiscoverVenueOut(BaseModel):
    """Public venue."""
    venue_id: str
    name: str | None = None
    slug: str | None = None
    description: str | None = None
    address: str | None = None
    phone: str | None = None
    email: str | None = None
    website_url: str | None = None
    hours: Any | None = None
    admission: Any | None = None
    accent_color: str | None = None
    parking_info: str | None = None
    accessibility_info: str | None = None
    ticketing_url: str | None = None
    hero_image_url: str | None = None
    thumbnail_url: str | None = None


class DiscoverVenueListResponse(BaseModel):
    """Venue list."""
    data: list[DiscoverVenueOut]
    total: int


class DiscoverExhibitionSummaryOut(BaseModel):
    """Exhibition summary within a venue."""
    exhibition_id: str
    title: str | None = None
    subtitle: str | None = None
    public_url_slug: str | None = None
    planned_start_date: str | None = None
    planned_end_date: str | None = None
    short_description: str | None = None
    thumbnail_url: str | None = None


class DiscoverVenueDetailOut(DiscoverVenueOut):
    """Venue detail with exhibitions."""
    exhibitions: list[DiscoverExhibitionSummaryOut] | None = None


# ---- Exhibitions ----

class DiscoverExhibitionListItemOut(BaseModel):
    """Exhibition list item."""
    exhibition_id: str
    title: str | None = None
    subtitle: str | None = None
    public_url_slug: str | None = None
    exhibition_type: str | None = None
    status: str | None = None
    planned_start_date: str | None = None
    planned_end_date: str | None = None
    actual_start_date: str | None = None
    actual_end_date: str | None = None
    short_description: str | None = None
    venue_name: str | None = None
    venue_slug: str | None = None
    is_featured: bool | None = None
    ticketing_url: str | None = None
    thumbnail_url: str | None = None
    tags: Any | None = None


class DiscoverExhibitionListResponse(BaseModel):
    """Exhibition list."""
    data: list[DiscoverExhibitionListItemOut]
    total: int


class DiscoverRelatedObjectOut(BaseModel):
    """Related object in exhibition detail."""
    object_id: str
    object_number: str | None = None
    title: str | None = None
    creators: list[str] | None = None
    creation_date_display: str | None = None
    thumbnail_url: str | None = None
    thumbnail_srcset: Any | None = None


class DiscoverExhibitionDetailOut(BaseModel):
    """Exhibition detail."""
    exhibition_id: str
    title: str | None = None
    subtitle: str | None = None
    public_url_slug: str | None = None
    exhibition_type: str | None = None
    status: str | None = None
    planned_start_date: str | None = None
    planned_end_date: str | None = None
    actual_start_date: str | None = None
    actual_end_date: str | None = None
    description: str | None = None
    short_description: str | None = None
    credits: str | None = None
    visitor_info: str | None = None
    venue_name: str | None = None
    venue_slug: str | None = None
    is_featured: bool | None = None
    ticketing_url: str | None = None
    hero_image_url: str | None = None
    thumbnail_url: str | None = None
    tags: Any | None = None
    related_objects: list[DiscoverRelatedObjectOut] | None = None


# ---- Gallery ----
