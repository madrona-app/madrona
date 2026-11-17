"""Typed payload for a `conservation_treatment` draft (Conservation).

The proposable subset of the live ConservationTreatment create shape
(`app/models/objects.py::ConservationTreatment`). `treatment_type` is a
lookup key checked against the organization's lookup values. `extra='forbid'` rejects anything else.
"""

from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.drafts.base import LookupKey

# Lookup-backed (organizations add values): checked against the org's
# active lookup values when the draft is proposed or edited
# (app/services/lookup_fields.check_draft_lookup_values), not a fixed list.
TreatmentType = LookupKey


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
