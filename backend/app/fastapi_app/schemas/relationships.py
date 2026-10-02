"""Pydantic response models for relationships router."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class RelationshipOut(BaseModel):
    relationship_id: str
    organization_id: str
    source_entity_key: str | None = None
    source_dataset_id: str | None = None
    target_entity_key: str | None = None
    target_dataset_id: str | None = None
    relationship_type: str | None = None
    created_by_source: str | None = None
    confidence: float | None = None
    extra_data: Any = None
    created_by_user_id: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class RelationshipDetailResponse(BaseModel):
    relationship: RelationshipOut
    source_entity: Any = None
    target_entity: Any = None


class RelationshipCreatedResponse(BaseModel):
    relationship: RelationshipOut


class RelationshipListResponse(BaseModel):
    items: list[RelationshipOut]
    limit: int
    offset: int
    total: int


class EntityRelationshipItem(BaseModel):
    relationship: RelationshipOut
    direction: str
    related_entity: Any = None


class EntityRelationshipsResponse(BaseModel):
    entity_key: str
    items: list[EntityRelationshipItem]
    limit: int
    offset: int
    total: int


class RelationshipTypeItem(BaseModel):
    type: str
    count: int


class RelationshipTypesResponse(BaseModel):
    organization_id: str
    relationship_types: list[RelationshipTypeItem]
    total_relationships: int


class BatchCreateResponse(BaseModel):
    created: int
    skipped: int
    errors: list[Any]


class TopEntityItem(BaseModel):
    entity_key: str
    label: str
    relationship_count: int


class ByTypeItem(BaseModel):
    type: str
    count: int


class BySourceItem(BaseModel):
    source: str
    count: int


class RelationshipAnalyticsResponse(BaseModel):
    organization_id: str
    total_relationships: int
    by_type: list[ByTypeItem]
    by_source: list[BySourceItem]
    top_entities: list[TopEntityItem]
    recent_relationships: list[RelationshipOut]


# ---------------------------------------------------------------------------
# Relationship definitions
# ---------------------------------------------------------------------------

class DefinitionOut(BaseModel):
    definition_id: str
    organization_id: str
    name: str | None = None
    description: str | None = None
    relationship_type: str | None = None
    source_dataset_id: str | None = None
    source_entity_type: str | None = None
    source_field_path: str | None = None
    target_dataset_id: str | None = None
    target_entity_type: str | None = None
    target_field_path: str | None = None
    match_transform: str | None = None
    case_sensitive: bool | None = None
    enabled: bool | None = None
    auto_link_on_ingest: bool | None = None
    bidirectional: bool | None = None
    inverse_relationship_type: str | None = None
    created_by_user_id: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class DefinitionCreatedResponse(BaseModel):
    definition: DefinitionOut


class DefinitionDetailResponse(BaseModel):
    definition: DefinitionOut


class DefinitionListResponse(BaseModel):
    items: list[DefinitionOut]
    limit: int
    offset: int
    total: int


class EvaluateDefinitionResponse(BaseModel):
    created: int
    skipped: int
    errors: list[Any]


class PreviewMatchItem(BaseModel):
    source_entity_key: str
    target_entity_key: str
    source_value: str | None = None
    target_value: str | None = None
    confidence: float | None = None


class PreviewDefinitionResponse(BaseModel):
    items: list[PreviewMatchItem]
    has_more: bool
