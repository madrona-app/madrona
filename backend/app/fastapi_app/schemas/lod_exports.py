"""Pydantic schemas for LOD Exports, Export Profiles, JSON-LD, and URI Resolution."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


# ---- LOD Readiness ----

class LodReadinessOut(BaseModel):
    """Full LOD readiness assessment result."""
    score: float
    level: str
    hints: list[Any] | None = None
    fields: Any | None = None
    # Allow extra fields from .to_dict()
    model_config = {"extra": "allow"}


class LodScoreOut(BaseModel):
    """LOD readiness score only."""
    objectId: str
    score: float
    level: str


class LodFieldHintsOut(BaseModel):
    """LOD hints for a specific field."""
    field: str
    hints: list[Any]


class CollectionLodReadinessOut(BaseModel):
    """Aggregate LOD readiness for a collection."""
    averageScore: float
    objectCount: int
    hintsByCategory: dict[str, Any]
    levelDistribution: dict[str, int] | None = None
    objects: list[Any] | None = None


class BatchLodAssessmentOut(BaseModel):
    """Batch LOD assessment result."""
    averageScore: float
    objects: list[Any]


class DismissedHintsOut(BaseModel):
    """List of dismissed hint IDs."""
    dismissedHints: list[str]


class DismissHintOut(BaseModel):
    """Dismiss hint response."""
    dismissed: bool
    hintId: str
    scope: str


# ---- Export Profiles ----

class ExportProfileListOut(BaseModel):
    """List of export profiles."""
    profiles: list[Any]
    categories: list[str]
    authoritySources: list[str]
    mediaOptions: list[str]


class ExportProfileOut(BaseModel):
    """Single export profile."""
    profile: Any


class ExportProfilePreviewOut(BaseModel):
    """Preview of a profile export."""
    original: Any
    exported: Any
    removedFields: list[str]
    transformedFields: list[str]
    profile: Any


class ProfileComparisonOut(BaseModel):
    """Compare profile exports."""
    comparisons: dict[str, Any]
    fieldCoverage: dict[str, Any]
    profileCount: int


class BatchExportOut(BaseModel):
    """Batch export result."""
    objects: list[Any]
    profile: str
    count: int


class CollectionExportJsonLdOut(BaseModel):
    """Collection export in JSON-LD format."""
    model_config = {"extra": "allow", "populate_by_name": True}


# ---- URI Resolution ----

class UriHistoryEntryOut(BaseModel):
    """A single URI history entry."""
    uri: str
    status: str
    created_at: str | None = None
    redirect_to: str | None = None
    tombstone_reason: str | None = None


class UriHistoryOut(BaseModel):
    """URI history response."""
    uri: str
    entity_id: str
    entity_type: str
    history: list[UriHistoryEntryOut]
