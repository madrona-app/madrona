"""Pydantic response schemas for insurance endpoints."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class EnumItem(BaseModel):
    value: str
    label: str


class InsuranceEnumsResponse(BaseModel):
    policy_types: list[EnumItem]
    policy_statuses: list[EnumItem]
    covered_entity_types: list[EnumItem]
    coverage_statuses: list[EnumItem]
    indemnity_programs: list[EnumItem]
    indemnity_statuses: list[EnumItem]
    loss_types: list[EnumItem]
    claim_statuses: list[EnumItem]


# ---------------------------------------------------------------------------
# Policy
# ---------------------------------------------------------------------------

class InsurancePolicyOut(BaseModel):
    policy_id: str
    organization_id: str
    policy_number: str | None = None
    policy_name: str | None = None
    policy_type: str | None = None
    policy_type_label: str | None = None
    provider_name: str | None = None
    provider_contact_id: str | None = None
    broker_name: str | None = None
    effective_date: str | None = None
    expiration_date: str | None = None
    coverage_limit: float | None = None
    coverage_limit_currency: str | None = None
    per_occurrence_limit: float | None = None
    deductible: float | None = None
    annual_premium: float | None = None
    status: str | None = None
    status_label: str | None = None
    renewal_of_policy_id: str | None = None
    notes: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    is_active: bool = False
    is_expired: bool = False
    coverages: list[Any] | None = None
    coverage_count: int | None = None


class InsurancePolicyListResponse(BaseModel):
    items: list[InsurancePolicyOut]
    total: int
    limit: int | None = None
    offset: int | None = None


# ---------------------------------------------------------------------------
# Coverage
# ---------------------------------------------------------------------------

class InsuranceCoverageOut(BaseModel):
    coverage_id: str
    organization_id: str
    policy_id: str | None = None
    covered_entity_type: str | None = None
    covered_entity_type_label: str | None = None
    covered_entity_id: str | None = None
    coverage_start_date: str | None = None
    coverage_end_date: str | None = None
    declared_value: float | None = None
    agreed_value: float | None = None
    value_currency: str | None = None
    third_party_provider: str | None = None
    third_party_policy_number: str | None = None
    certificate_requested: bool = False
    certificate_received: bool = False
    certificate_received_date: str | None = None
    certificate_number: str | None = None
    status: str | None = None
    status_label: str | None = None
    notes: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    is_third_party: bool = False
    has_certificate: bool = False
    policy: Any | None = None
    covered_entity: Any | None = None


class InsuranceCoverageListResponse(BaseModel):
    coverages: list[InsuranceCoverageOut]
    total: int


# ---------------------------------------------------------------------------
# Indemnity
# ---------------------------------------------------------------------------

class IndemnityObjectOut(BaseModel):
    link_id: str
    object_id: str
    object_number: str | None = None
    object_title: str | None = None
    declared_value: float | None = None
    approved_value: float | None = None
    value_currency: str | None = None


class IndemnityArrangementOut(BaseModel):
    indemnity_id: str
    organization_id: str
    program: str | None = None
    program_label: str | None = None
    reference_number: str | None = None
    internal_reference: str | None = None
    exhibition_id: str | None = None
    loan_in_id: str | None = None
    application_date: str | None = None
    requested_coverage: float | None = None
    awarded_coverage: float | None = None
    coverage_currency: str | None = None
    coverage_start_date: str | None = None
    coverage_end_date: str | None = None
    commercial_gap_required: bool = False
    gap_coverage_id: str | None = None
    status: str | None = None
    status_label: str | None = None
    notes: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    objects: list[IndemnityObjectOut] | None = None
    object_count: int | None = None
    total_declared_value: float | None = None
    total_approved_value: float | None = None


class IndemnityListResponse(BaseModel):
    indemnities: list[IndemnityArrangementOut]
    total: int


class IndemnityObjectAddedResponse(BaseModel):
    link_id: str
    object_id: str
    declared_value: float | None = None
    approved_value: float | None = None


# ---------------------------------------------------------------------------
# Claims
# ---------------------------------------------------------------------------

class InsuranceClaimOut(BaseModel):
    claim_id: str
    organization_id: str
    claim_number: str | None = None
    insurer_claim_number: str | None = None
    coverage_id: str | None = None
    indemnity_id: str | None = None
    incident_report_id: str | None = None
    date_of_loss: str | None = None
    loss_description: str | None = None
    loss_type: str | None = None
    loss_type_label: str | None = None
    claimed_amount: float | None = None
    settlement_amount: float | None = None
    amount_currency: str | None = None
    adjuster_name: str | None = None
    adjuster_contact: str | None = None
    status: str | None = None
    status_label: str | None = None
    filed_date: str | None = None
    settled_date: str | None = None
    notes: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class InsuranceClaimListResponse(BaseModel):
    claims: list[InsuranceClaimOut]
    total: int
