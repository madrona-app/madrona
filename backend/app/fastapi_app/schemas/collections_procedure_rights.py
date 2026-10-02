"""Pydantic response schemas for collections procedure rights endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


# ============================================================================
# Object Rights
# ============================================================================


class ObjectRightOut(BaseModel):
    """Serialized object right record."""
    right_id: str
    organization_id: str
    object_id: str
    right_type: str | None = None
    right_subtype: str | None = None
    rights_holder_contact_id: str | None = None
    status: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    is_perpetual: bool | None = None
    territory: str | None = None
    territory_note: str | None = None
    license_type: str | None = None
    license_reference: str | None = None
    license_url: str | None = None
    usage_conditions: str | None = None
    restrictions: str | None = None
    fee_required: bool | None = None
    fee_amount: float | None = None
    fee_currency: str | None = None
    fee_note: str | None = None
    is_orphan_work: bool | None = None
    due_diligence_conducted: bool | None = None
    due_diligence_date: str | None = None
    due_diligence_steps: str | None = None
    orphan_works_license_number: str | None = None
    orphan_works_license_date: str | None = None
    orphan_works_license_expiry: str | None = None
    permissions_granted: str | None = None
    agreement_reference: str | None = None
    documentation_references: Any = None
    next_review_date: str | None = None
    last_review_date: str | None = None
    right_note: str | None = None
    internal_note: str | None = None
    created_at: str | None = None
    created_by: str | None = None
    updated_at: str | None = None


class ObjectRightListResponse(BaseModel):
    """Paginated rights list."""
    items: list[ObjectRightOut]
    total: int
    limit: int
    offset: int


# ============================================================================
# Use Requests
# ============================================================================


class UseRequestObjectOut(BaseModel):
    """Serialized use request object link."""
    request_object_id: str
    request_id: str
    object_id: str
    object_note: str | None = None
    special_handling: str | None = None
    approved: bool | None = None
    approval_note: str | None = None
    denial_reason: str | None = None
    fulfilled: bool | None = None
    fulfillment_date: str | None = None
    fulfillment_note: str | None = None
    created_at: str | None = None
    object: Any = None


class UseRequestOut(BaseModel):
    """Serialized use request record."""
    request_id: str
    organization_id: str
    request_number: str | None = None
    request_date: str | None = None
    use_type: str | None = None
    use_subtype: str | None = None
    use_purpose: str | None = None
    use_description: str | None = None
    requester_user_id: str | None = None
    requester_name: str | None = None
    requester_title: str | None = None
    requester_institution: str | None = None
    requester_address: str | None = None
    requester_email: str | None = None
    requester_phone: str | None = None
    access_date_start: str | None = None
    access_date_end: str | None = None
    location_required: str | None = None
    special_requirements: str | None = None
    project_title: str | None = None
    project_description: str | None = None
    project_deadline: str | None = None
    reproduction_type: str | None = None
    reproduction_quantity: int | None = None
    reproduction_format: str | None = None
    reproduction_dimensions: str | None = None
    intended_use: str | None = None
    publication_details: str | None = None
    credit_line: str | None = None
    exhibition_title: str | None = None
    exhibition_venue: str | None = None
    exhibition_dates: str | None = None
    exhibition_organizer: str | None = None
    insurance_value: float | None = None
    insurance_currency: str | None = None
    status: str | None = None
    reviewed_by_id: str | None = None
    review_date: str | None = None
    review_note: str | None = None
    approved_by_id: str | None = None
    approval_date: str | None = None
    approval_conditions: str | None = None
    denial_reason: str | None = None
    fee_quoted: float | None = None
    fee_paid: float | None = None
    fee_currency: str | None = None
    fee_waived: bool | None = None
    fee_waiver_reason: str | None = None
    fulfillment_date: str | None = None
    fulfillment_note: str | None = None
    knowledge_gained: str | None = None
    publication_reference: str | None = None
    created_by: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    requested_objects: list[UseRequestObjectOut] | None = None


class UseRequestListResponse(BaseModel):
    """Paginated use request list."""
    items: list[UseRequestOut]
    total: int
    limit: int
    offset: int


class UseRequestObjectsResponse(BaseModel):
    """List of use request objects."""
    objects: list[UseRequestObjectOut]
