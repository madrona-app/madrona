"""Pydantic response schemas for classification endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class ClassifyDatasetResponse(BaseModel):
    dataset_id: str
    queued: int
    task_id: str
    message: str


class ClassifyEntityResponse(BaseModel):
    entity_key: str
    task_id: str
    message: str


class ClassificationStatusResponse(BaseModel):
    dataset_id: str
    total: int
    by_type: dict[str, int]
    unclassified_count: int
    classification_complete: bool


class ClassifyOrganizationResponse(BaseModel):
    organization_id: str
    queued: int
    message: str


class ClassificationStatsResponse(BaseModel):
    total_entities: int
    by_type: dict[str, int]
    classification_rate: float
