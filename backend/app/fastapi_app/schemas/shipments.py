"""Pydantic response schemas for shipment and crate endpoints."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class EnumItem(BaseModel):
    value: str
    label: str


class ShipmentEnumsResponse(BaseModel):
    shipment_types: list[EnumItem]
    directions: list[EnumItem]
    purposes: list[EnumItem]
    statuses: list[EnumItem]
    item_statuses: list[EnumItem]
    shipping_methods: list[EnumItem]
    leg_statuses: list[EnumItem]
    document_types: list[EnumItem]
    procedure_types: list[EnumItem]
    crate_conditions: list[EnumItem]


# ---------------------------------------------------------------------------
# Sub-resources
# ---------------------------------------------------------------------------

class ShipmentLegOut(BaseModel):
    leg_id: str
    shipment_id: str
    leg_number: int | None = None
    shipping_method: str | None = None
    shipping_method_label: str | None = None
    carrier_id: str | None = None
    carrier_name: str | None = None
    tracking_number: str | None = None
    flight_vessel_number: str | None = None
    departure_location: str | None = None
    departure_date: str | None = None
    departure_time: str | None = None
    arrival_location: str | None = None
    arrival_date: str | None = None
    arrival_time: str | None = None
    climate_controlled: bool = False
    status: str | None = None
    status_label: str | None = None
    instructions: str | None = None
    cost: str | None = None
    cost_currency: str | None = None
    notes: str | None = None


class ShipmentItemOut(BaseModel):
    shipment_item_id: str
    shipment_id: str
    object_id: str
    object_number: str | None = None
    object_title: str | None = None
    part_id: str | None = None
    crate_id: str | None = None
    crate_number: str | None = None
    item_number: str | None = None
    insurance_value: str | None = None
    insurance_currency: str | None = None
    status: str | None = None
    status_label: str | None = None
    condition_out_note: str | None = None
    condition_in_note: str | None = None
    special_instructions: str | None = None
    packing_notes: str | None = None


class ShipmentReferenceOut(BaseModel):
    reference_id: str
    shipment_id: str
    procedure_type: str | None = None
    procedure_type_label: str | None = None
    procedure_id: str
    notes: str | None = None
    created_at: str | None = None


class ShipmentDocumentOut(BaseModel):
    document_id: str
    shipment_id: str
    media_id: str
    document_type: str | None = None
    document_type_label: str | None = None
    label: str | None = None
    created_at: str | None = None


# ---------------------------------------------------------------------------
# Shipment
# ---------------------------------------------------------------------------

class ShipmentOut(BaseModel):
    shipment_id: str
    organization_id: str
    department_id: str | None = None
    shipment_number: str | None = None
    shipment_type: str | None = None
    shipment_type_label: str | None = None
    direction: str | None = None
    direction_label: str | None = None
    purpose: str | None = None
    purpose_label: str | None = None
    status: str | None = None
    status_label: str | None = None
    ship_from_contact_id: str | None = None
    ship_from_contact: Any | None = None
    ship_from_location_id: str | None = None
    ship_from_location: Any | None = None
    ship_from_address: str | None = None
    ship_to_contact_id: str | None = None
    ship_to_contact: Any | None = None
    ship_to_location_id: str | None = None
    ship_to_location: Any | None = None
    ship_to_address: str | None = None
    requested_date: str | None = None
    estimated_dispatch_date: str | None = None
    estimated_arrival_date: str | None = None
    actual_dispatch_date: str | None = None
    actual_arrival_date: str | None = None
    insurance_value_total: str | None = None
    insurance_currency: str | None = None
    insurance_note: str | None = None
    courier_required: bool = False
    is_international: bool = False
    is_high_value: bool = False
    authorized_by: str | None = None
    authorization_date: str | None = None
    remarks: str | None = None
    internal_notes: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    created_by: str | None = None
    updated_by: str | None = None
    legs: list[Any] | None = None
    items: list[Any] | None = None
    references: list[Any] | None = None
    documents: list[Any] | None = None
    status_history: list[Any] | None = None
    item_count: int | None = None
    leg_count: int | None = None
    document_count: int | None = None


class ShipmentSummary(BaseModel):
    total: int
    in_transit: int
    delayed: int
    completed: int


class ShipmentListResponse(BaseModel):
    items: list[ShipmentOut]
    summary: ShipmentSummary
    total: int
    limit: int
    offset: int


class ShipmentStatusUpdateResponse(BaseModel):
    shipment_id: str
    old_status: str
    new_status: str
    status_label: str


# ---------------------------------------------------------------------------
# Crate
# ---------------------------------------------------------------------------

class CrateOut(BaseModel):
    crate_id: str
    organization_id: str
    crate_number: str | None = None
    description: str | None = None
    height_cm: str | None = None
    width_cm: str | None = None
    depth_cm: str | None = None
    weight_empty_kg: str | None = None
    interior_height_cm: str | None = None
    interior_width_cm: str | None = None
    interior_depth_cm: str | None = None
    materials: str | None = None
    condition: str | None = None
    condition_label: str | None = None
    climate_controlled: bool = False
    is_stackable: bool = True
    is_oversized: bool = False
    location_id: str | None = None
    location: Any | None = None
    home_location_id: str | None = None
    home_location: Any | None = None
    is_active: bool = True
    notes: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class CrateListResponse(BaseModel):
    items: list[CrateOut]
    total: int
    limit: int
    offset: int
