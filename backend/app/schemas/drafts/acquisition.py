"""Typed payload for an `acquisition` draft (Acquisition, Procedure 1).

The proposable subset of the live Acquisition create shape
(`app/models/objects.py::Acquisition`). `acquisition_method` is a `Literal`
mirroring the live CHECK. `extra='forbid'` rejects anything else.

Acquisition is approval-gated: when an org has an acquisition/create approval
rule, the *draft* carries that approval (a human approves the draft), so the
applier creates the live row already approved — it does not open a second gate.
"""

from datetime import date
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

AcquisitionMethod = Literal[
    "gift", "purchase", "bequest", "transfer", "exchange", "field_collection",
    "commission", "found_in_collection", "conversion", "donation", "unknown",
]


class AcquisitionDraftPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Required core (mirrors the router's required-field check).
    acquisition_method: AcquisitionMethod

    acquisition_date: date | None = None

    # Source — linked constituent or free-text.
    source_id: UUID | None = None
    source_name: str | None = None
    source_type: str | None = Field(default=None, max_length=30)

    funding_source: str | None = None
    funding_account: str | None = None
    cost: Decimal | None = Field(default=None, ge=0)
    cost_currency: str = Field(default="USD", max_length=3)

    # NOT defaulted: legal title is a determination a person makes, never an
    # assumption the agent asserts. Unset until someone records it (and the
    # procedure legal_status requirement stays unmet until they do).
    legal_status: str | None = Field(default=None, max_length=30)
    provisos: str | None = None
    credit_line: str | None = None

    # Optional link to the originating object entry.
    entry_id: UUID | None = None
    objects_count: int = Field(default=1, ge=0)
    acquisition_note: str | None = None
