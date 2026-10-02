"""Pydantic response models for events router."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class EventOut(BaseModel):
    event_id: str
    organization_id: str
    event_reference_number: str | None = None
    title: str | None = None
    event_type: str | None = None
    status: str | None = None
    start_at: str | None = None
    end_at: str | None = None
    location_id: str | None = None
    owner_user_id: str | None = None
    course_code: str | None = None
    instructor_id: str | None = None
    department: str | None = None
    institution: str | None = None
    headcount: int | None = None
    session_format: str | None = None
    audience: str | None = None
    capacity: int | None = None
    registration_url: str | None = None
    description: str | None = None
    notes: str | None = None
    created_at: str | None = None
    created_by: str | None = None
    updated_at: str | None = None
    updated_by: str | None = None
    location_name: str | None = None
    location_path: str | None = None
    owner_name: str | None = None
    instructor_name: str | None = None
    object_count: int | None = None
    participant_count: int | None = None
    # Detail fields
    object_links: list[Any] | None = None
    participants: list[Any] | None = None
    # Object events reverse lookup
    link: Any | None = None


class EventListResponse(BaseModel):
    items: list[EventOut]
    total: int
    page: int
    limit: int
    offset: int


class EventObjectLinkOut(BaseModel):
    event_object_id: str
    organization_id: str
    event_id: str
    object_id: str
    role: str | None = None
    planned_use: str | None = None
    requirements: str | None = None
    notes: str | None = None
    display_order: int | None = None
    created_at: str | None = None
    created_by: str | None = None
    object: Any | None = None


class EventObjectListResponse(BaseModel):
    objects: list[EventObjectLinkOut]
    total: int


class EventParticipantOut(BaseModel):
    participant_id: str
    xref_id: str
    organization_id: str
    event_id: str
    constituent_id: str
    role: str | None = None
    notes: str | None = None
    display_order: int | None = None
    created_at: str | None = None
    constituent: Any | None = None
    contact: Any | None = None


class EventParticipantListResponse(BaseModel):
    participants: list[EventParticipantOut]
    total: int


class ObjectEventsResponse(BaseModel):
    events: list[EventOut]
    total: int


class CollectionsImpactResponse(BaseModel):
    needs_movement_plan: bool
    needs_condition_checks: bool
    needs_rights_verification: bool
    objects_needing_movement: list[Any] = []
    objects_needing_condition_check: list[Any] = []
    objects_needing_rights_check: list[Any] = []
    event_status: str | None = None
    total_objects: int
