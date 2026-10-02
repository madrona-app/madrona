"""Pydantic schemas for Media Tags API endpoints."""

from __future__ import annotations

from pydantic import BaseModel

from app.fastapi_app.schemas.common import SuccessResponse


# ---- Tag Definitions ----

class TagDefinitionOut(BaseModel):
    """Serialized tag definition."""
    definition_id: str
    organization_id: str
    tag_key: str
    display_name: str
    description: str | None = None
    field_type: str = "text"
    allow_multiple: bool = False
    is_required: bool = False
    sort_order: int = 0
    is_active: bool = True
    created_at: str | None = None
    created_by: str | None = None
    updated_at: str | None = None
    # Optional counts useful for admin UI; omitted on list endpoints unless requested.
    value_count: int | None = None


class TagDefinitionListResponse(BaseModel):
    """List of tag definitions."""
    definitions: list[TagDefinitionOut]
    total: int


class DeleteTagDefinitionResponse(SuccessResponse):
    """Delete tag definition response."""
    hard_deleted: bool


# ---- Tag Values (allowed values / "nodes") ----

class TagValueOut(BaseModel):
    """Serialized allowed value for a tag definition."""
    value_id: str
    definition_id: str
    parent_id: str | None = None
    value: str
    sort_order: int = 0
    is_active: bool = True
    # Optional hierarchy / usage hints.
    depth: int | None = None
    usage_count: int | None = None


class TagValueListResponse(BaseModel):
    """List of allowed values for a definition."""
    values: list[TagValueOut]
    total: int


# ---- Media Tags ----

class MediaTagOut(BaseModel):
    """Serialized media tag."""
    tag_id: str
    organization_id: str
    media_id: str
    definition_id: str
    value_id: str | None = None
    tag_value: str
    created_at: str | None = None
    created_by: str | None = None
    tag_key: str | None = None
    display_name: str | None = None


class MediaTagListResponse(BaseModel):
    """List of media tags."""
    tags: list[MediaTagOut]
    total: int


# ---- Tag Values autocomplete (legacy shape kept for backward compat) ----

class TagValuesResponse(BaseModel):
    """Tag values autocomplete response."""
    values: list[str]
    total: int
