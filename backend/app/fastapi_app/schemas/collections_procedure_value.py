"""Pydantic response schemas for collections procedure value endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


# ============================================================================
# Valuations
# ============================================================================


class ValuationOut(BaseModel):
    """Serialized valuation record."""
    valuation_id: str
    organization_id: str
    object_id: str | None = None
    object_number: str | None = None
    object_title: str | None = None
    valuation_type: str | None = None
    valuation_amount: float | None = None
    valuation_currency: str | None = None
    valuation_date: str | None = None
    valuator_id: str | None = None
    valuator_name: str | None = None
    valuator_organization: str | None = None
    valuator_credentials: str | None = None
    valuation_method: str | None = None
    documentation_reference: str | None = None
    valuation_note: str | None = None
    valid_from: str | None = None
    valid_until: str | None = None
    is_current: bool | None = None
    # Procedure 13 — formal authorization. Backend columns
    # exist (authorizer_id / authorization_date / authorization_note);
    # the serializer emits them, but the Pydantic response_model
    # was previously stripping them silently. Surfaced for the
    # ValuationWorkspacePage Authorization section.
    authorizer_id: str | None = None
    authorization_date: str | None = None
    authorization_note: str | None = None
    created_by: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    updated_by: str | None = None


class ValuationListResponse(BaseModel):
    """Paginated valuation list."""
    items: list[ValuationOut]
    total: int
    limit: int
    offset: int


class ObjectValuationListResponse(BaseModel):
    """List of valuations for a single object."""
    valuations: list[ValuationOut]
    total: int


# ============================================================================
# Reproduction Requests
# ============================================================================


class ReproductionRequestOut(BaseModel):
    """Serialized reproduction request record."""
    reproduction_id: str
    organization_id: str
    request_number: str | None = None
    use_request_id: str | None = None
    object_id: str | None = None
    requester_name: str | None = None
    requester_institution: str | None = None
    requester_email: str | None = None
    requester_phone: str | None = None
    reproduction_type: str | None = None
    reproduction_purpose: str | None = None
    intended_use: str | None = None
    quantity: int | None = None
    format_requested: str | None = None
    dimensions_requested: str | None = None
    rights_cleared: bool | None = None
    rights_check_date: str | None = None
    rights_cleared_by: str | None = None
    rights_restrictions: str | None = None
    credit_line_required: bool | None = None
    object_right_id: str | None = None
    fee_type: str | None = None
    fee_amount: float | None = None
    fee_currency: str | None = None
    fee_paid: bool | None = None
    payment_date: str | None = None
    master_file_reference: str | None = None
    delivery_method: str | None = None
    delivery_date: str | None = None
    quality_approved: bool | None = None
    status: str | None = None
    notes: str | None = None
    created_by: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class ReproductionRequestListResponse(BaseModel):
    """Paginated reproduction request list."""
    items: list[ReproductionRequestOut]
    total: int
    limit: int
    offset: int
