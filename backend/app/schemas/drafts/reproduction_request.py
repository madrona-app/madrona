"""Typed payload for a `reproduction_request` draft (Procedure 19).

The proposable subset of the live ReproductionRequest create shape
(`app/models/objects.py::ReproductionRequest`). `reproduction_type` is a
lookup key checked against the organization's lookup values. `request_number` is optional here — when
omitted the create function generates one (REP sequence) rather than asking the
model to invent an institutional number. `extra='forbid'` rejects anything else.
"""

from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.drafts.base import LookupKey

# Lookup-backed (organizations add values): checked against the org's
# active lookup values when the draft is proposed or edited
# (app/services/lookup_fields.check_draft_lookup_values), not a fixed list.
ReproductionType = LookupKey


class ReproductionRequestDraftPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Required core (mirrors the router's required-field checks).
    requester_name: str = Field(..., max_length=255)
    reproduction_type: ReproductionType

    # Generated (REP sequence) when omitted.
    request_number: str | None = Field(default=None, max_length=50)

    use_request_id: UUID | None = None
    object_id: UUID | None = None

    requester_institution: str | None = Field(default=None, max_length=255)
    requester_email: str | None = Field(default=None, max_length=255)
    requester_phone: str | None = None

    reproduction_purpose: str | None = Field(default=None, max_length=30)
    intended_use: str | None = None
    quantity: int | None = Field(default=None, ge=0)
    format_requested: str | None = Field(default=None, max_length=100)
    dimensions_requested: str | None = Field(default=None, max_length=100)
    credit_line_required: str | None = None

    fee_type: str | None = Field(default=None, max_length=30)
    fee_amount: Decimal | None = Field(default=None, ge=0)
    fee_currency: str | None = Field(default=None, max_length=3)

    notes: str | None = None
