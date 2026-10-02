"""Schemas for the organization collection scope profile (issue #77)."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, field_validator

_COMPLETENESS = {"comprehensive", "representative", "partial", "unknown"}
_DIGITIZATION = {"full", "partial", "minimal", "none", "unknown"}


class CollectionProfileOut(BaseModel):
    organization_id: str
    scope_note: str | None = None
    coverage: dict[str, Any] | None = None
    completeness: str | None = None
    extent_note: str | None = None
    known_gaps: str | None = None
    digitization_status: str | None = None


class CollectionProfileUpdate(BaseModel):
    scope_note: str | None = None
    coverage: dict[str, Any] | None = None
    completeness: str | None = None
    extent_note: str | None = None
    known_gaps: str | None = None
    digitization_status: str | None = None

    @field_validator("completeness")
    @classmethod
    def _check_completeness(cls, v: str | None) -> str | None:
        if v is not None and v not in _COMPLETENESS:
            raise ValueError(f"completeness must be one of {sorted(_COMPLETENESS)}")
        return v

    @field_validator("digitization_status")
    @classmethod
    def _check_digitization(cls, v: str | None) -> str | None:
        if v is not None and v not in _DIGITIZATION:
            raise ValueError(f"digitization_status must be one of {sorted(_DIGITIZATION)}")
        return v
