"""Pydantic response schemas for location and movement endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class LocationOut(BaseModel):
    location_id: str
    organization_id: str
    parent_id: str | None = None
    path: str | None = None
    depth: int | None = None
    name: str
    code: str | None = None
    barcode: str | None = None
    location_type: str | None = None
    is_external: bool | None = None
    capacity: int | None = None
    current_count: int | None = None
    climate_controlled: bool | None = None
    default_fitness: str | None = None
    condition: str | None = None
    security_level: str | None = None
    status: str | None = None
    on_display: bool | None = None
    created_at: str | None = None
    updated_at: str | None = None
    children: list[LocationOut] | None = None


class LocationFullOut(BaseModel):
    location_id: str
    organization_id: str
    parent_id: str | None = None
    path: str | None = None
    depth: int | None = None
    name: str
    code: str | None = None
    barcode: str | None = None
    alternate_names: Any = None
    location_type: str | None = None
    is_external: bool | None = None
    address: str | None = None
    contact_name: str | None = None
    contact_email: str | None = None
    contact_phone: str | None = None
    coordinates: Any = None
    grid_reference: str | None = None
    floor_plan_coordinates: Any = None
    capacity: int | None = None
    current_count: int | None = None
    capacity_note: str | None = None
    climate_controlled: bool | None = None
    temperature_min: float | None = None
    temperature_max: float | None = None
    humidity_min: float | None = None
    humidity_max: float | None = None
    light_level: str | None = None
    light_level_lux: Any = None
    uv_filtered: bool | None = None
    environment_note: str | None = None
    default_fitness: str | None = None
    condition: str | None = None
    condition_note: str | None = None
    condition_date: str | None = None
    pest_control_date: str | None = None
    security_level: str | None = None
    security_note: str | None = None
    access_restricted: bool | None = None
    access_requirements: str | None = None
    access_note: str | None = None
    accessibility: str | None = None
    description: str | None = None
    note: str | None = None
    status: str | None = None
    on_display: bool | None = None
    established_date: str | None = None
    decommissioned_date: str | None = None
    created_at: str | None = None
    created_by: str | None = None
    updated_at: str | None = None
    updated_by: str | None = None
    object_count: int | None = None


class LocationListResponse(BaseModel):
    items: list[Any]
    total: int
    limit: int | None = None
    offset: int | None = None


class MovementOut(BaseModel):
    movement_id: str
    organization_id: str
    movement_reference_number: str | None = None
    object_id: str
    object_number: str | None = None
    object_title: str | None = None
    part_id: str | None = None
    part_number: str | None = None
    part_name: str | None = None
    from_location_id: str | None = None
    from_location_name: str | None = None
    from_location_path: str | None = None
    to_location_id: str
    to_location_name: str | None = None
    to_location_path: str | None = None
    location_fitness: str | None = None
    movement_date: str | None = None
    planned_removal_date: str | None = None
    removal_date: str | None = None
    planned_return_date: str | None = None
    reason: str | None = None
    movement_note: str | None = None
    reference_type: str | None = None
    reference_id: str | None = None
    authorized_by: str | None = None
    authorizer_id: str | None = None
    authorizer_name: str | None = None
    authorization_date: str | None = None
    authorization_note: str | None = None
    movement_contact: str | None = None
    movement_method: str | None = None
    moved_by: str | None = None
    moved_by_name: str | None = None
    handler_id: str | None = None
    handler_name: str | None = None
    organization_courier: bool | None = None
    courier_name: str | None = None
    shipper_id: str | None = None
    shipper_name: str | None = None
    shipping_method: str | None = None
    shipping_tracking_number: str | None = None
    shipping_insurance_value: str | None = None
    shipping_insurance_currency: str | None = None
    shipping_note: str | None = None
    condition_note: str | None = None
    condition_report_id: str | None = None
    status: str | None = None
    created_at: str | None = None
    created_by: str | None = None


class MovementListResponse(BaseModel):
    items: list[MovementOut]
    total: int
    limit: int | None = None
    offset: int | None = None


class ObjectMovementsResponse(BaseModel):
    movements: list[MovementOut]
    total: int
