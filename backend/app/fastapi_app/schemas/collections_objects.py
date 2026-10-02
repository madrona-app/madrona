"""Pydantic response models for collections-objects endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Collection Object
# ---------------------------------------------------------------------------

class CollectionObjectOut(BaseModel):
    """Serialized collection object — mirrors _serialize_collection_object_full."""
    model_config = {"extra": "allow"}

    object_id: str
    organization_id: str
    object_number: str | None = None


class CollectionObjectListResponse(BaseModel):
    items: list[Any]
    total: int
    limit: int
    offset: int
    search_engine: str | None = None


class CollectionObjectDetailResponse(BaseModel):
    """Detail view with field-access filtering — dynamic keys."""
    model_config = {"extra": "allow"}


# ---------------------------------------------------------------------------
# Object Procedures
# ---------------------------------------------------------------------------

class ProcedureSummaryItem(BaseModel):
    model_config = {"extra": "allow"}


class ObjectProceduresResponse(BaseModel):
    object_id: str
    object_number: str | None = None
    acquisitions: list[Any]
    loans_out: list[Any]
    conservation: list[Any]
    condition_reports: list[Any]
    deaccessions: list[Any]
    use_requests: list[Any]
    incident_reports: list[Any]


# ---------------------------------------------------------------------------
# Constituent Objects
# ---------------------------------------------------------------------------

class ConstituentObjectItem(BaseModel):
    xref_id: str
    object_id: str
    object_number: str | None = None
    title: str | None = None
    role: str | None = None
    role_qualifier: str | None = None
    attribution_certainty: str | None = None


class ConstituentObjectsResponse(BaseModel):
    objects: list[ConstituentObjectItem]


# ---------------------------------------------------------------------------
# Other Number Types
# ---------------------------------------------------------------------------

class OtherNumberTypeOut(BaseModel):
    """Serialized other number type — mirrors _serialize_other_number_type."""
    model_config = {"extra": "allow"}


class OtherNumberTypeListResponse(BaseModel):
    types: list[Any]
    total: int


class OtherNumberTypeDeleteResponse(BaseModel):
    success: bool
    deleted: bool
    deactivated: bool
