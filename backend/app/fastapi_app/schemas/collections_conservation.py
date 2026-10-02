"""Pydantic response models for collections-conservation endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Conservation Treatment
# ---------------------------------------------------------------------------

class ConservationTreatmentOut(BaseModel):
    """Serialized conservation treatment — mirrors _serialize_conservation_treatment."""
    model_config = {"extra": "allow"}

    treatment_id: str
    organization_id: str
    treatment_number: str | None = None
    status: str | None = None


class ConservationTreatmentListResponse(BaseModel):
    items: list[Any] = []
    total: int
    limit: int
    offset: int


# ---------------------------------------------------------------------------
# Object Exit
# ---------------------------------------------------------------------------

class ObjectExitOut(BaseModel):
    """Serialized object exit — mirrors _serialize_object_exit."""
    model_config = {"extra": "allow"}

    exit_id: str
    organization_id: str
    exit_number: str | None = None
    status: str | None = None


class ObjectExitListResponse(BaseModel):
    items: list[Any] = []
    total: int
    limit: int
    offset: int


class ObjectExitDetailResponse(BaseModel):
    """Detail view with items and field-access filtering — dynamic keys."""
    model_config = {"extra": "allow"}


# ---------------------------------------------------------------------------
# Deaccession
# ---------------------------------------------------------------------------

class DeaccessionOut(BaseModel):
    """Serialized deaccession — mirrors _serialize_deaccession."""
    model_config = {"extra": "allow"}

    deaccession_id: str
    organization_id: str
    deaccession_number: str | None = None
    status: str | None = None


class DeaccessionListResponse(BaseModel):
    items: list[Any] = []
    total: int
    limit: int
    offset: int


class DeaccessionDetailResponse(BaseModel):
    """Detail view with audit trail and field-access filtering — dynamic keys."""
    model_config = {"extra": "allow"}


class DeaccessionAuditOut(BaseModel):
    """Serialized deaccession audit."""
    model_config = {"extra": "allow"}


class DeaccessionAuditListResponse(BaseModel):
    audit_trail: list[Any]
    total: int
