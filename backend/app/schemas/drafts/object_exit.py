"""Typed payload for an `object_exit` draft (Object Exit, Proc. 5).

The proposable subset of the live ObjectExit create shape
(`app/models/objects.py::ObjectExit`). `exit_reason` is a lookup key checked against
the organization's lookup values. `extra='forbid'` rejects anything else. Like acquisition,
object_exit is approval-gated — the draft carries the approval.
"""

from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.drafts.base import LookupKey

# Lookup-backed (organizations add values): checked against the org's
# active lookup values when the draft is proposed or edited
# (app/services/lookup_fields.check_draft_lookup_values), not a fixed list.
ExitReason = LookupKey


class ObjectExitDraftPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Required core (mirrors the router's required-field check).
    exit_reason: ExitReason

    recipient_id: UUID | None = None
    recipient_name: str | None = None
    recipient_address: str | None = None

    # Optional link back to the originating entry / reference.
    entry_id: UUID | None = None
    reference_type: str | None = Field(default=None, max_length=50)
    reference_id: UUID | None = None

    exit_method: str | None = Field(default=None, max_length=50)
    insurance_value: Decimal | None = Field(default=None, ge=0)
    insurance_currency: str = Field(default="USD", max_length=3)
    exit_note: str | None = None
