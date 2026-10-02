"""Pydantic response schemas for object parts endpoints."""

from __future__ import annotations

from pydantic import BaseModel


class ObjectPartOut(BaseModel):
    part_id: str
    organization_id: str
    object_id: str
    part_number: str | None = None
    name: str | None = None
    description: str | None = None
    current_location_id: str | None = None
    current_location_fitness: str | None = None
    current_location_note: str | None = None
    current_location_date: str | None = None
    home_location_id: str | None = None
    barcode: str | None = None
    display_order: int | None = None
    created_at: str | None = None
    created_by: str | None = None
    updated_at: str | None = None
    updated_by: str | None = None
    current_location_name: str | None = None
    current_location_path: str | None = None
    current_location_on_display: bool | None = None
    home_location_name: str | None = None
    home_location_path: str | None = None


class ObjectPartListResponse(BaseModel):
    parts: list[ObjectPartOut]
    total: int
