"""Pydantic response models for collections-constituents endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Constituent models
# ---------------------------------------------------------------------------

class ConstituentOut(BaseModel):
    """Full constituent detail."""
    constituent_id: str
    organization_id: str
    constituent_type: str | None = None

    # Operational
    name: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    title: str | None = None
    role: str | None = None
    organization_name: str | None = None
    department: str | None = None
    email: str | None = None
    phone: str | None = None
    phone_secondary: str | None = None
    website: str | None = None
    address: dict[str, Any] | None = None
    contact_categories: Any | None = None

    # CDWA Identity
    sort_name: str | None = None
    display_name: str | None = None
    given_name: str | None = None
    family_name: str | None = None
    name_prefix: str | None = None
    name_suffix: str | None = None
    name_type: str | None = None
    variant_names: list[str] | None = None
    nationality: str | None = None
    nationalities: Any | None = None
    culture: str | None = None
    life_roles: list[str] | None = None
    gender: str | None = None

    # CDWA Existence
    birth_date_display: str | None = None
    birth_date_earliest: str | None = None
    birth_date_latest: str | None = None
    birth_place: str | None = None
    birth_place_tgn_id: str | None = None
    death_date_display: str | None = None
    death_date_earliest: str | None = None
    death_date_latest: str | None = None
    death_place: str | None = None
    death_place_tgn_id: str | None = None
    active_date_display: str | None = None
    active_date_earliest: str | None = None
    active_date_latest: str | None = None

    # Biography
    biography: str | None = None
    biography_source: str | None = None

    # External authorities
    ulan_id: str | None = None
    viaf_id: str | None = None
    wikidata_id: str | None = None
    loc_id: str | None = None
    external_uris: list[str] | None = None

    # Status
    is_active: bool | None = None
    status: str | None = None
    is_verified: bool | None = None
    verified_at: str | None = None

    # Notes
    notes: str | None = None
    internal_notes: str | None = None
    cataloger_notes: str | None = None

    # Audit
    created_at: str | None = None
    updated_at: str | None = None

    # Extra fields (detail view)
    linked_records_count: int | None = None


class ConstituentBriefOut(BaseModel):
    """Brief constituent for list views."""
    constituent_id: str
    constituent_type: str | None = None
    name: str | None = None
    display_name: str | None = None
    sort_name: str | None = None
    dates: str | None = None
    nationality: str | None = None
    email: str | None = None
    phone: str | None = None
    organization_name: str | None = None
    ulan_id: str | None = None
    is_verified: bool | None = None
    status: str | None = None


class ConstituentListResponse(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[ConstituentBriefOut]


# ---------------------------------------------------------------------------
# Xref models
# ---------------------------------------------------------------------------

class ConstituentBrief(BaseModel):
    constituent_id: str
    constituent_type: str | None = None
    name: str | None = None
    display_name: str | None = None
    email: str | None = None
    phone: str | None = None
    organization_name: str | None = None


class ConstituentXrefOut(BaseModel):
    xref_id: str
    organization_id: str
    constituent_id: str
    entity_type: str | None = None
    entity_id: str
    role: str | None = None
    role_qualifier: str | None = None
    attribution_certainty: str | None = None
    attribution_note: str | None = None
    display_order: int | None = None
    display_name_override: str | None = None
    is_primary: bool | None = None
    start_date: str | None = None
    end_date: str | None = None
    location: str | None = None
    notes: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    constituent: ConstituentBrief | None = None


class ObjectConstituentsResponse(BaseModel):
    object_id: str
    constituents: list[ConstituentXrefOut]


class GenericXrefListResponse(BaseModel):
    entity_type: str
    entity_id: str
    xrefs: list[ConstituentXrefOut]


# ---------------------------------------------------------------------------
# Relation models
# ---------------------------------------------------------------------------

class ConstituentRelationBrief(BaseModel):
    constituent_id: str
    name: str | None = None
    constituent_type: str | None = None


class ConstituentRelationOut(BaseModel):
    relation_id: str
    organization_id: str
    from_constituent_id: str
    to_constituent_id: str
    relationship_type: str | None = None
    relationship_note: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    created_at: str | None = None
    from_constituent: ConstituentRelationBrief | None = None
    to_constituent: ConstituentRelationBrief | None = None


class ConstituentRelationsResponse(BaseModel):
    constituent_id: str
    relations: list[ConstituentRelationOut]


# ---------------------------------------------------------------------------
# Search models
# ---------------------------------------------------------------------------

class SearchResultItem(BaseModel):
    id: str
    source: str | None = None
    label: str | None = None
    description: str | None = None
    dates: str | None = None
    nationality: str | None = None
    roles: list[str] | None = None
    ulan_id: str | None = None
    constituent_id: str | None = None
    uri: str | None = None


class ConstituentSearchResponse(BaseModel):
    query: str
    results: list[SearchResultItem]


class AuthoritySearchResultItem(BaseModel):
    id: str
    label: str | None = None
    description: str | None = None
    authority_id: str | None = None
    uri: str | None = None


class AuthoritySearchResponse(BaseModel):
    query: str
    results: list[AuthoritySearchResultItem]


class UlanSearchResultItem(BaseModel):
    id: str
    source: str | None = None
    label: str | None = None
    description: str | None = None
    dates: str | None = None
    nationality: str | None = None
    ulan_id: str | None = None
    uri: str | None = None


class UlanSearchResponse(BaseModel):
    query: str
    results: list[UlanSearchResultItem]


# ---------------------------------------------------------------------------
# Enums response
# ---------------------------------------------------------------------------

class ConstituentEnumsResponse(BaseModel):
    constituent_types: list[str]
    statuses: list[str]
    entity_types: list[str]
    roles_by_entity_type: dict[str, list[str]]
    relationship_types: list[str]
    attribution_certainty: list[str]


# ---------------------------------------------------------------------------
# ULAN record detail
# ---------------------------------------------------------------------------

class UlanRecordOut(BaseModel):
    ulan_id: str | None = None
    uri: str | None = None
    preferred_name: str | None = None
    display_name: str | None = None
    sort_name: str | None = None
    given_name: str | None = None
    family_name: str | None = None
    variant_names: Any | None = None
    birth_date_display: str | None = None
    birth_place: str | None = None
    death_date_display: str | None = None
    death_place: str | None = None
    nationality: str | None = None
    nationalities: Any | None = None
    gender: str | None = None
    life_roles: Any | None = None
    biography: str | None = None


# ---------------------------------------------------------------------------
# Import / merge / verify responses
# ---------------------------------------------------------------------------

class ImportUlanResponse(BaseModel):
    constituent_id: str
    name: str | None = None
    display_name: str | None = None
    ulan_id: str | None = None
    is_new: bool


class ConstituentUpdateResponse(BaseModel):
    success: bool
    constituent_id: str


class MergeConstituentsResponse(BaseModel):
    success: bool
    primary_id: str
    secondary_id: str
    xrefs_reassigned: int
    xrefs_skipped_duplicate: int


class VerifyConstituentResponse(BaseModel):
    success: bool
    constituent_id: str
    is_verified: bool
    verified_at: str


class ConstituentRolesResponse(BaseModel):
    entity_type: str
    roles: list[Any]
