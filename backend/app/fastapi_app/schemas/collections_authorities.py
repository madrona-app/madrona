"""Pydantic request and response schemas for collections authorities endpoints."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from pydantic import BaseModel


# ============================================================================
# Request schemas
# ============================================================================


class CreatePersonAuthorityRequest(BaseModel):
    preferred_name: str
    constituent_type: str | None = "person"
    nationality: str | None = None
    culture: str | None = None
    gender: str | None = None
    life_roles: list[str] | None = None
    birth_date_display: str | None = None
    birth_date_earliest: str | None = None
    birth_date_latest: str | None = None
    birth_place: str | None = None
    death_date_display: str | None = None
    death_date_earliest: str | None = None
    death_date_latest: str | None = None
    death_place: str | None = None
    active_date_display: str | None = None
    biography: str | None = None
    ulan_id: str | None = None
    viaf_id: str | None = None
    wikidata_id: str | None = None
    external_uris: list[str] | None = None
    status: str | None = "active"
    is_verified: bool | None = False
    notes: str | None = None
    cataloger_notes: str | None = None


class UpdatePersonAuthorityRequest(BaseModel):
    preferred_name: str | None = None
    name: str | None = None
    constituent_type: str | None = None
    nationality: str | None = None
    culture: str | None = None
    gender: str | None = None
    life_roles: list[str] | None = None
    birth_date_display: str | None = None
    birth_date_earliest: str | None = None
    birth_date_latest: str | None = None
    birth_place: str | None = None
    death_date_display: str | None = None
    death_date_earliest: str | None = None
    death_date_latest: str | None = None
    death_place: str | None = None
    active_date_display: str | None = None
    biography: str | None = None
    ulan_id: str | None = None
    viaf_id: str | None = None
    wikidata_id: str | None = None
    external_uris: list[str] | None = None
    status: str | None = None
    is_verified: bool | None = None
    notes: str | None = None
    cataloger_notes: str | None = None


class MergePersonAuthorityRequest(BaseModel):
    target_authority_id: UUID


class CreateAuthorityRelationRequest(BaseModel):
    related_authority_id: UUID
    relationship_type: str
    start_date: str | None = None
    end_date: str | None = None
    notes: str | None = None


class CreateObjectPersonAuthorityLinkRequest(BaseModel):
    authority_id: UUID
    role: str
    role_qualifier: str | None = None
    attribution_certainty: str | None = None
    display_order: int | None = None
    display_name_override: str | None = None
    notes: str | None = None


class UpdateObjectPersonAuthorityLinkRequest(BaseModel):
    role: str | None = None
    role_qualifier: str | None = None
    attribution_certainty: str | None = None
    display_order: int | None = None
    display_name_override: str | None = None
    notes: str | None = None


# ============================================================================
# Response schemas
# ============================================================================


class PersonAuthorityOut(BaseModel):
    """Serialized person authority (constituent) record."""
    authority_id: str
    organization_id: str
    preferred_name: str | None = None
    variant_names: list[str] | None = None
    nationality: str | None = None
    culture: str | None = None
    gender: str | None = None
    life_roles: list[str] | None = None
    birth_date_display: str | None = None
    birth_date_earliest: str | None = None
    birth_date_latest: str | None = None
    birth_place: str | None = None
    death_date_display: str | None = None
    death_date_earliest: str | None = None
    death_date_latest: str | None = None
    death_place: str | None = None
    active_date_display: str | None = None
    biography: str | None = None
    ulan_id: str | None = None
    viaf_id: str | None = None
    wikidata_id: str | None = None
    external_uris: list[str] | None = None
    status: str | None = None
    merged_into_id: str | None = None
    is_verified: bool | None = None
    notes: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    linked_objects_count: int | None = None


class PersonAuthorityListResponse(BaseModel):
    """Paginated person authority list."""
    items: list[PersonAuthorityOut]
    total: int
    limit: int
    offset: int


class PersonAuthorityDeleteResponse(BaseModel):
    """Delete success with message."""
    success: bool = True
    message: str


class PersonAuthorityMergeResponse(BaseModel):
    """Response after merging two authorities."""
    message: str
    source_authority: PersonAuthorityOut
    target_authority: PersonAuthorityOut


class PersonAuthorityRelationOut(BaseModel):
    """Serialized authority relation."""
    relation_id: str
    source_authority_id: str
    related_authority_id: str
    relationship_type: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    notes: str | None = None


class AuthorityRelationsResponse(BaseModel):
    """Relations for a person authority (outgoing + incoming)."""
    outgoing_relations: list[PersonAuthorityRelationOut]
    incoming_relations: list[PersonAuthorityRelationOut]


class ObjectPersonAuthorityLinkOut(BaseModel):
    """Serialized object-person authority link."""
    link_id: str
    object_id: str
    authority_id: str
    role: str | None = None
    role_qualifier: str | None = None
    attribution_certainty: str | None = None
    display_order: int | None = None
    display_name_override: str | None = None
    notes: str | None = None
    authority: PersonAuthorityOut | None = None
