"""Pydantic response schemas for collections NAGPRA endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class NagpraActionOut(BaseModel):
    """Serialized NAGPRA action record."""
    action_id: str
    organization_id: str
    object_id: str
    action_number: str | None = None
    group_reference: str | None = None
    origin_type: str | None = None
    nagpra_category: str | None = None
    funerary_association: str | None = None
    category_basis: str | None = None
    category_determined_date: str | None = None
    category_determined_by: str | None = None
    geographic_origin: str | None = None
    site_name: str | None = None
    state: str | None = None
    county: str | None = None
    affiliation_status: str | None = None
    affiliated_party_id: str | None = None
    affiliation_basis: str | None = None
    affiliation_evidence_types: Any = None
    affiliation_determined_date: str | None = None
    display_consent: str | None = None
    display_consent_date: str | None = None
    access_consent: str | None = None
    access_consent_date: str | None = None
    research_consent: str | None = None
    research_consent_date: str | None = None
    handling_preferences: str | None = None
    storage_preferences: str | None = None
    hold_active: bool | None = None
    notice_type: str | None = None
    notice_submitted_date: str | None = None
    notice_published_date: str | None = None
    notice_fr_citation: str | None = None
    waiting_period_end_date: str | None = None
    transfer_date: str | None = None
    transfer_recipient_id: str | None = None
    transfer_method: str | None = None
    transfer_note: str | None = None
    deaccession_id: str | None = None
    coordinator_id: str | None = None
    identified_date: str | None = None
    consultation_initiated_date: str | None = None
    closed_date: str | None = None
    inventory_deadline: str | None = None
    status: str | None = None
    action_note: str | None = None
    internal_note: str | None = None
    created_by: str | None = None
    updated_by: str | None = None
    created_at: str | None = None
    updated_at: str | None = None

    model_config = {"extra": "allow"}


class NagpraConsultationEventOut(BaseModel):
    """Serialized NAGPRA consultation event."""
    event_id: str
    action_id: str
    organization_id: str | None = None
    consulting_party_id: str | None = None
    consulting_party_name: str | None = None
    event_date: str | None = None
    event_type: str | None = None
    direction: str | None = None
    subject: str | None = None
    description: str | None = None
    participants: Any = None
    outcomes: str | None = None
    follow_up_required: bool | None = None
    follow_up_date: str | None = None
    follow_up_note: str | None = None
    document_references: Any = None
    recorded_by: str | None = None
    created_at: str | None = None

    model_config = {"extra": "allow"}


class ConsultationEventListResponse(BaseModel):
    """List of consultation events."""
    consultation_events: list[NagpraConsultationEventOut]
    total: int
