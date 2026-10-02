"""Pydantic response models for entities-current endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class EntityCurrentOut(BaseModel):
    entity_key: str
    entity_type: str | None = None
    dataset_id: str | None = None
    source_system: str | None = None
    source_id: str | None = None
    canonical_url: str | None = None
    payload: Any | None = None
    extracted_at: str
    last_seen_at: str
    updated_at: str
    last_run_id: str | None = None


class EntityCurrentListResponse(BaseModel):
    items: list[EntityCurrentOut]
    next_cursor: str | None = None
