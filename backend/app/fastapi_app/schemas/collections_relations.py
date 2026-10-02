"""Pydantic response models for collections-relations endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Object Relationships (CDWA Category 20)
# ---------------------------------------------------------------------------

class ObjectRelationshipOut(BaseModel):
    relationship_id: str
    organization_id: str
    source_object_id: str
    related_object_id: str | None = None
    external_work_title: str | None = None
    external_work_creator: str | None = None
    external_work_date: str | None = None
    external_work_location: str | None = None
    external_work_identifier: str | None = None
    external_work_thumbnail_url: str | None = None
    related_object_summary: dict | None = None
    relationship_type: str | None = None
    relationship_direction: str | None = None
    sequence_number: int | None = None
    notes: str | None = None
    created_at: str | None = None


class ObjectRelationshipsResponse(BaseModel):
    outgoing: list[ObjectRelationshipOut]
    incoming: list[ObjectRelationshipOut]


# ---------------------------------------------------------------------------
# Citations (CDWA Category 27)
# ---------------------------------------------------------------------------

class CitationOut(BaseModel):
    citation_id: str
    organization_id: str
    citation_type: str | None = None
    brief_citation: str | None = None
    full_citation: str | None = None
    author: str | None = None
    title: str | None = None
    publication: str | None = None
    publisher: str | None = None
    publication_place: str | None = None
    publication_year: str | None = None
    volume: str | None = None
    issue: str | None = None
    pages: str | None = None
    url: str | None = None
    doi: str | None = None
    isbn: str | None = None
    works_cited: bool | None = None
    works_illustrated: bool | None = None
    notes: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class CitationListResponse(BaseModel):
    items: list[CitationOut]
    total: int
    limit: int
    offset: int


# ---------------------------------------------------------------------------
# Object-Citation Links
# ---------------------------------------------------------------------------

class ObjectCitationOut(BaseModel):
    link_id: str
    organization_id: str
    object_id: str
    citation_id: str
    page_reference: str | None = None
    figure_reference: str | None = None
    plate_reference: str | None = None
    catalog_number: str | None = None
    works_cited: bool | None = None
    works_illustrated: bool | None = None
    is_primary: bool | None = None
    display_order: int | None = None
    link_note: str | None = None
    created_at: str | None = None
    citation: CitationOut | None = None


class ObjectCitationListResponse(BaseModel):
    citations: list[ObjectCitationOut]
    total: int


# ---------------------------------------------------------------------------
# Critical Responses (CDWA Category 19)
# ---------------------------------------------------------------------------

class CriticalResponseOut(BaseModel):
    response_id: str
    organization_id: str
    object_id: str
    comment_text: str | None = None
    comment_summary: str | None = None
    document_type: str | None = None
    author_name: str | None = None
    author_authority_id: str | None = None
    comment_date_display: str | None = None
    comment_date_earliest: str | None = None
    comment_date_latest: str | None = None
    circumstances: str | None = None
    publication_info: str | None = None
    citation_id: str | None = None
    source_page: str | None = None
    notes: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class CriticalResponseListResponse(BaseModel):
    critical_responses: list[CriticalResponseOut]


# ---------------------------------------------------------------------------
# Cataloging History (CDWA Category 25)
# ---------------------------------------------------------------------------

class CatalogingHistoryOut(BaseModel):
    history_id: str
    organization_id: str
    object_id: str
    cataloger_name: str | None = None
    cataloger_id: str | None = None
    institution: str | None = None
    catalog_date: str | None = None
    catalog_language: str | None = None
    record_type: str | None = None
    fields_modified: Any | None = None
    change_summary: str | None = None
    previous_values: Any | None = None
    notes: str | None = None
    created_at: str | None = None


class CatalogingHistoryListResponse(BaseModel):
    cataloging_history: list[CatalogingHistoryOut]


# ---------------------------------------------------------------------------
# Object Contexts (CDWA Category 17)
# ---------------------------------------------------------------------------

class ObjectContextOut(BaseModel):
    context_id: str
    organization_id: str
    object_id: str
    context_type: str | None = None
    building_name: str | None = None
    site_name: str | None = None
    part_placement: str | None = None
    architectural_date_display: str | None = None
    architectural_date_earliest: str | None = None
    architectural_date_latest: str | None = None
    historical_place_id: str | None = None
    historical_date_display: str | None = None
    historical_date_earliest: str | None = None
    historical_date_latest: str | None = None
    event_id: str | None = None
    event_description: str | None = None
    notes: str | None = None
    display_order: int | None = None
    created_at: str | None = None
    updated_at: str | None = None


class ObjectContextListResponse(BaseModel):
    contexts: list[ObjectContextOut]
