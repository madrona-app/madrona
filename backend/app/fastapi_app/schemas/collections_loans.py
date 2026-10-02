"""Pydantic response schemas for collections loans endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class LoanInOut(BaseModel):
    """Serialized loan-in record."""
    loan_in_id: str
    organization_id: str
    loan_number: str | None = None
    lender_id: str | None = None
    lender_name: str | None = None
    lender_contact: Any = None  # Deprecated: use lender relationship
    lender_contact_id: str | None = None
    lender_contact_name: str | None = None
    loan_purpose: str | None = None
    exhibition_id: str | None = None
    exhibition_name: str | None = None
    request_date: str | None = None
    loan_start_date: str | None = None
    loan_end_date: str | None = None
    loan_conditions: str | None = None
    special_requirements: str | None = None
    insurance_value: Any = None
    insurance_currency: str | None = None
    loan_note: str | None = None
    entry_id: str | None = None
    status: str | None = None
    approval_date: str | None = None
    approved_by: str | None = None
    actual_receipt_date: str | None = None
    actual_return_date: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    created_by: str | None = None
    updated_by: str | None = None
    # Closing
    closing_invoice_sent: bool | None = None
    closing_invoice_date: str | None = None
    closing_invoice_reference: str | None = None
    closing_invoice_amount: Any = None
    closing_invoice_currency: str | None = None
    receipt_acknowledged: bool | None = None
    receipt_acknowledged_date: str | None = None
    receipt_acknowledged_reference: str | None = None
    conditions_met_confirmed: bool | None = None
    conditions_met_date: str | None = None
    conditions_met_note: str | None = None
    closing_note: str | None = None

    model_config = {"extra": "allow"}


class LoanInDetailOut(LoanInOut):
    """Loan-in with nested objects list (get single detail)."""
    objects: list[Any] = []


class LoanInListResponse(BaseModel):
    """Paginated loan-in list. `limit` and `offset` echo the query window."""
    items: list[LoanInOut] = []
    total: int
    limit: int = 50
    offset: int = 0


class LoanInObjectOut(BaseModel):
    """Serialized loan-in object link."""
    loan_object_id: str | None = None
    loan_in_id: str | None = None
    organization_id: str | None = None
    object_id: str | None = None
    object_number_lender: str | None = None
    object_title: str | None = None
    object_description: str | None = None
    artist_maker: str | None = None
    date_description: str | None = None
    insurance_value: Any = None
    insurance_currency: str | None = None
    dimensions: str | None = None
    medium: str | None = None
    special_requirements: str | None = None
    display_requirements: str | None = None
    condition_in_note: str | None = None
    condition_out_note: str | None = None
    item_status: str | None = None
    received_date: str | None = None
    returned_date: str | None = None

    model_config = {"extra": "allow"}


class LoanInObjectListResponse(BaseModel):
    """List of loan-in objects."""
    objects: list[LoanInObjectOut]
    total: int


class LoanInEntryOut(BaseModel):
    """Serialized loan-in entry link."""
    loan_in_entry_id: str
    entry_id: str
    entry_number: str | None = None
    entry_date: str | None = None
    depositor_name: str | None = None
    location_name: str | None = None
    objects_description: str | None = None
    status: str | None = None
    notes: str | None = None
    created_at: str | None = None

    model_config = {"extra": "allow"}


class LoanInEntryListResponse(BaseModel):
    """List of loan-in entry links."""
    entries: list[LoanInEntryOut]


class EntryLinkedLoansResponse(BaseModel):
    """Loans linked to an object entry."""
    loans_in: list[Any]
    total: int


class LoanOutItemOut(BaseModel):
    """Serialized loan-out record."""
    loan_out_id: str
    organization_id: str
    loan_number: str | None = None
    borrower_id: str | None = None
    borrower_name: str | None = None
    borrower_contact: Any = None  # Deprecated: use borrower relationship
    venue_name: str | None = None
    venue_address: Any = None  # JSONB column on the model — dict or string accepted
    loan_purpose: str | None = None
    exhibition_title: str | None = None
    request_date: str | None = None
    loan_start_date: str | None = None
    loan_end_date: str | None = None
    loan_conditions: str | None = None
    insurance_requirements: str | None = None
    insurance_value_total: Any = None
    insurance_currency: str | None = None
    loan_note: str | None = None
    status: str | None = None
    approval_date: str | None = None
    approved_by: str | None = None
    actual_dispatch_date: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    created_by: str | None = None
    updated_by: str | None = None

    model_config = {"extra": "allow"}


class LoanOutDetailOut(LoanOutItemOut):
    """Loan-out with nested objects list (get single detail)."""
    objects: list[Any] = []


class LoanOutListResponse(BaseModel):
    """Paginated loan-out list."""
    items: list[LoanOutItemOut] = []
    total: int
    limit: int = 50
    offset: int = 0


class LoanOutObjectOut(BaseModel):
    """Serialized loan-out object link."""
    loan_object_id: str | None = None
    loan_out_id: str | None = None
    organization_id: str | None = None
    object_id: str | None = None
    insurance_value: Any = None
    insurance_currency: str | None = None
    display_credit_line: str | None = None
    display_label: str | None = None
    display_requirements: str | None = None
    installation_requirements: str | None = None
    special_conditions: str | None = None
    handling_requirements: str | None = None
    environmental_requirements: str | None = None
    photography_restrictions: str | None = None
    condition_out_note: str | None = None
    condition_return_note: str | None = None
    item_status: str | None = None
    dispatched_date: str | None = None
    returned_date: str | None = None
    damage_reported: bool | None = None
    damage_note: str | None = None

    model_config = {"extra": "allow"}


class LoanOutObjectListResponse(BaseModel):
    """List of loan-out objects."""
    objects: list[LoanOutObjectOut]
    total: int


class LoanOutObjectsAddedResponse(BaseModel):
    """Response after adding objects to a loan-out."""
    objects: list[LoanOutObjectOut]
    added_count: int
