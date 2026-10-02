"""Pydantic response models for exhibition_loans router."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class ExhibitionLoanObjectOut(BaseModel):
    loan_object_id: str
    object_id: str
    object_number: str | None = None
    object_title: str | None = None


class ExhibitionLoanOut(BaseModel):
    link_id: str
    exhibition_id: str
    loan_id: str | None = None
    loan_type: str | None = None
    loan_type_label: str | None = None
    is_linked: bool
    loan_number: str | None = None
    party_name: str | None = None
    party_contact: str | None = None
    status: str | None = None
    status_label: str | None = None
    status_notes: str | None = None
    agreement_document_id: str | None = None
    agreement_signed: bool | None = None
    agreement_signed_date: str | None = None
    insurance_confirmed: bool | None = None
    insurance_policy: str | None = None
    insurance_value: Any = None
    request_date: str | None = None
    loan_start_date: str | None = None
    loan_end_date: str | None = None
    actual_return_date: str | None = None
    object_count: str | None = None
    notes: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    last_synced_at: str | None = None
    is_active: bool
    needs_attention: bool
    objects: list[ExhibitionLoanObjectOut] | None = None


class LoansSummaryOut(BaseModel):
    total: int
    loans_in: int
    loans_out: int
    planning: int
    linked: int
    active: int
    needs_attention: int
    agreements_pending: int
    insurance_pending: int
    by_status: dict[str, int] | None = None


class ExhibitionLoanListResponse(BaseModel):
    loans: list[ExhibitionLoanOut]
    summary: LoansSummaryOut


class LoansSummaryResponse(BaseModel):
    total: int
    loans_in: int
    loans_out: int
    planning: int
    linked: int
    active: int
    needs_attention: int
    agreements_pending: int
    insurance_pending: int


class AgreementResponse(BaseModel):
    link_id: str
    agreement_signed: bool
    agreement_signed_date: str | None = None
    status: str | None = None


class InsuranceResponse(BaseModel):
    link_id: str
    insurance_confirmed: bool
    insurance_policy: str | None = None
    insurance_value: Any = None


class LoanStatusResponse(BaseModel):
    link_id: str
    old_status: str
    new_status: str
    status_label: str


class EnumItem(BaseModel):
    value: str
    label: str


class LoanEnumsResponse(BaseModel):
    loan_types: list[EnumItem]
    statuses: list[EnumItem]
    active_statuses: list[str]
    completed_statuses: list[str]
