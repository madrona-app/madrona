"""Typed payload for an `object_entry` draft (Object Entry, Proc. 1).

The proposable subset of the live ObjectEntry create shape
(`app/models/objects.py::ObjectEntry`). The draft field `reason` maps to the
model's `entry_reason` (a `Literal` mirroring the live CHECK). System-derived
fields (entry_number, entry_date, status) are not proposable. `extra='forbid'`
rejects anything else.
"""

from datetime import date
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

EntryReason = Literal[
    "loan_consideration", "gift_offer", "purchase_consideration",
    "identification", "conservation", "photography", "research", "enquiry",
    "other",
]


class ObjectEntryDraftPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Required core. `reason` maps to the model's entry_reason (the router took
    # data["reason"]).
    reason: EntryReason

    entry_method: str | None = Field(default=None, max_length=50)

    depositor_id: UUID | None = None
    depositor_name: str | None = None
    current_owner_id: UUID | None = None
    current_owner: str | None = None

    authorizer_id: UUID | None = None
    authorization_date: date | None = None
    authorization_note: str | None = None

    expected_duration: str | None = Field(default=None, max_length=50)
    expected_return_date: date | None = None
    receipt_reference: str | None = None
    entry_note: str | None = None
    objects_description: str | None = None

    insurance_value: Decimal | None = Field(default=None, ge=0)
    insurance_currency: str = Field(default="USD", max_length=3)
    insurance_note: str | None = None

    conditions: str | None = None
