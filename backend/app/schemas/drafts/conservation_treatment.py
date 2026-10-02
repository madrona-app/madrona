"""Typed payload for a `conservation_treatment` draft (Conservation).

The proposable subset of the live ConservationTreatment create shape
(`app/models/objects.py::ConservationTreatment`). `treatment_type` is a
`Literal` mirroring the live CHECK. `extra='forbid'` rejects anything else.
"""

from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

TreatmentType = Literal[
    "preventive", "remedial", "restoration", "analysis", "stabilization",
    "cleaning", "repair", "documentation", "mount_making", "rehousing",
    "pest_treatment", "other",
]


class ConservationTreatmentDraftPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Required core (mirrors the router's required-field checks).
    object_id: UUID
    treatment_type: TreatmentType

    conservator_id: UUID | None = None
    conservator_name: str | None = None
    conservator_institution: str | None = None

    proposal_summary: str | None = None
    estimated_duration_days: int | None = Field(default=None, ge=0)
    estimated_cost: Decimal | None = Field(default=None, ge=0)
    estimated_cost_currency: str = Field(default="USD", max_length=3)
    treatment_note: str | None = None
