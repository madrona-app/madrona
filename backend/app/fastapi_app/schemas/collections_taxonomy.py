"""Pydantic request and response schemas for collections taxonomy endpoints."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from pydantic import BaseModel


# ============================================================================
# Place Authority – Request schemas
# ============================================================================


class CreatePlaceAuthorityRequest(BaseModel):
    preferred_name: str
    place_type: str | None = "place"
    tgn_id: str | None = None
    geonames_id: str | None = None
    wikidata_id: str | None = None
    coordinates_lat: float | None = None
    coordinates_lng: float | None = None
    parent_place_id: UUID | None = None
    hierarchy_path: str | None = None
    country_code: str | None = None
    notes: str | None = None
    status: str | None = "active"
    variant_names: list[dict[str, Any]] | None = None


class UpdatePlaceAuthorityRequest(BaseModel):
    preferred_name: str | None = None
    place_type: str | None = None
    tgn_id: str | None = None
    geonames_id: str | None = None
    wikidata_id: str | None = None
    coordinates_lat: float | None = None
    coordinates_lng: float | None = None
    parent_place_id: UUID | None = None
    hierarchy_path: str | None = None
    country_code: str | None = None
    notes: str | None = None
    status: str | None = None
    # Full-replacement semantics: when provided, this list becomes the
    # authority's complete set of variant terms ([] or null clears them).
    variant_names: list[dict[str, Any]] | None = None


class CreateObjectPlaceAuthorityLinkRequest(BaseModel):
    place_authority_id: UUID
    role: str
    date_display: str | None = None
    date_earliest: str | None = None
    date_latest: str | None = None
    notes: str | None = None
    display_order: int | None = 0


# ============================================================================
# Style/Period Authority – Request schemas
# ============================================================================


class CreateStylePeriodAuthorityRequest(BaseModel):
    preferred_term: str
    authority_type: str | None = "style"
    aat_id: str | None = None
    wikidata_id: str | None = None
    culture: str | None = None
    date_display: str | None = None
    date_earliest: str | None = None
    date_latest: str | None = None
    geographic_scope: str | None = None
    parent_authority_id: UUID | None = None
    description: str | None = None
    notes: str | None = None
    status: str | None = "active"
    variant_terms: list[dict[str, Any]] | None = None


class UpdateStylePeriodAuthorityRequest(BaseModel):
    preferred_term: str | None = None
    authority_type: str | None = None
    aat_id: str | None = None
    wikidata_id: str | None = None
    culture: str | None = None
    date_display: str | None = None
    date_earliest: str | None = None
    date_latest: str | None = None
    geographic_scope: str | None = None
    parent_authority_id: UUID | None = None
    description: str | None = None
    notes: str | None = None
    status: str | None = None


class CreateObjectStylePeriodLinkRequest(BaseModel):
    authority_id: UUID
    assignment_certainty: str | None = None
    assignment_note: str | None = None
    display_order: int | None = 0


# ============================================================================
# Subject Authority – Request schemas
# ============================================================================


class CreateSubjectAuthorityRequest(BaseModel):
    preferred_term: str
    subject_type: str | None = "thematic"
    aat_id: str | None = None
    iconclass_id: str | None = None
    wikidata_id: str | None = None
    broader_subject_id: UUID | None = None
    description: str | None = None
    notes: str | None = None
    status: str | None = "active"
    variant_terms: list[dict[str, Any]] | None = None


class UpdateSubjectAuthorityRequest(BaseModel):
    preferred_term: str | None = None
    subject_type: str | None = None
    aat_id: str | None = None
    iconclass_id: str | None = None
    wikidata_id: str | None = None
    broader_subject_id: UUID | None = None
    description: str | None = None
    notes: str | None = None
    status: str | None = None
    # Full-replacement semantics, same as UpdatePlaceAuthorityRequest.
    variant_terms: list[dict[str, Any]] | None = None


class CreateObjectSubjectLinkRequest(BaseModel):
    subject_authority_id: UUID
    subject_extent: str | None = None
    interpretation_note: str | None = None
    display_order: int | None = 0


# ============================================================================
# Place Authority – Response schemas
# ============================================================================


class PlaceAuthorityOut(BaseModel):
    """Serialized place authority record."""
    place_authority_id: str
    organization_id: str
    preferred_name: str | None = None
    variant_names: list[str] | None = None
    place_type: str | None = None
    tgn_id: str | None = None
    geonames_id: str | None = None
    wikidata_id: str | None = None
    coordinates_lat: float | None = None
    coordinates_lng: float | None = None
    parent_place_id: str | None = None
    hierarchy_path: str | None = None
    country_code: str | None = None
    notes: str | None = None
    status: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    linked_objects_count: int | None = None


class PlaceAuthorityListResponse(BaseModel):
    """Paginated place authority list."""
    items: list[PlaceAuthorityOut]
    total: int
    limit: int
    offset: int


class ObjectPlaceAuthorityLinkOut(BaseModel):
    """Serialized object-place authority link."""
    link_id: str
    object_id: str
    place_authority_id: str
    role: str | None = None
    date_display: str | None = None
    date_earliest: str | None = None
    date_latest: str | None = None
    notes: str | None = None
    display_order: int | None = None
    created_at: str | None = None
    place_authority: PlaceAuthorityOut | None = None


class ObjectPlaceAuthorityListResponse(BaseModel):
    """List of object-place authority links."""
    place_authorities: list[ObjectPlaceAuthorityLinkOut]


class TaxonomyDeleteResponse(BaseModel):
    """Delete success with message."""
    success: bool = True
    message: str


# ============================================================================
# Style/Period Authority
# ============================================================================


class StylePeriodAuthorityOut(BaseModel):
    """Serialized style/period authority record."""
    authority_id: str
    organization_id: str
    preferred_term: str | None = None
    variant_terms: list[str] | None = None
    authority_type: str | None = None
    aat_id: str | None = None
    wikidata_id: str | None = None
    culture: str | None = None
    date_display: str | None = None
    date_earliest: str | None = None
    date_latest: str | None = None
    geographic_scope: str | None = None
    parent_authority_id: str | None = None
    description: str | None = None
    notes: str | None = None
    status: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    linked_objects_count: int | None = None


class StylePeriodAuthorityListResponse(BaseModel):
    """Paginated style/period authority list."""
    items: list[StylePeriodAuthorityOut]
    total: int
    limit: int
    offset: int


class ObjectStylePeriodLinkOut(BaseModel):
    """Serialized object-style/period link."""
    link_id: str
    object_id: str
    authority_id: str
    assignment_certainty: str | None = None
    assignment_note: str | None = None
    display_order: int | None = None
    created_at: str | None = None
    authority: StylePeriodAuthorityOut | None = None


class ObjectStylePeriodListResponse(BaseModel):
    """List of object-style/period links."""
    style_periods: list[ObjectStylePeriodLinkOut]


# ============================================================================
# Subject Authority
# ============================================================================


class SubjectAuthorityOut(BaseModel):
    """Serialized subject authority record."""
    authority_id: str
    organization_id: str
    preferred_term: str | None = None
    variant_terms: list[str] | None = None
    subject_type: str | None = None
    aat_id: str | None = None
    iconclass_id: str | None = None
    wikidata_id: str | None = None
    broader_subject_id: str | None = None
    description: str | None = None
    notes: str | None = None
    status: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    linked_objects_count: int | None = None


class SubjectAuthorityListResponse(BaseModel):
    """Paginated subject authority list."""
    items: list[SubjectAuthorityOut]
    total: int
    limit: int
    offset: int


class ObjectSubjectLinkOut(BaseModel):
    """Serialized object-subject link."""
    link_id: str
    object_id: str
    subject_authority_id: str
    subject_extent: str | None = None
    interpretation_note: str | None = None
    display_order: int | None = None
    created_at: str | None = None
    subject_authority: SubjectAuthorityOut | None = None


class ObjectSubjectListResponse(BaseModel):
    """List of object-subject links."""
    subjects: list[ObjectSubjectLinkOut]
