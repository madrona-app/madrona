"""Typed payload for a `valuation` draft (Procedure 13).

The proposable subset of the live Valuation create shape
(`app/models/objects.py::Valuation`). `extra='forbid'` rejects any field the
model invents — a hallucinated key fails validation at draft creation rather
than surviving into the audit trail.
"""

from datetime import date
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# Documented set on Valuation.valuation_type (String(30) — no DB CHECK, but the
# create routes only ever produce these). Mirroring it here turns a bad type
# into a clear tool error at draft creation.
ValuationType = Literal[
    "insurance",
    "market",
    "replacement",
    "probate",
    "donation",
    "internal",
]


class ValuationDraftPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Target + required core (mirrors the router's required-field checks).
    object_id: UUID = Field(..., description="The collection object being valued")
    valuation_type: ValuationType
    valuation_amount: Decimal = Field(..., ge=0)
    valuation_date: date

    valuation_currency: str = Field(default="USD", max_length=3)

    # Source — linked constituent or free-text.
    valuator_id: UUID | None = None
    valuator_name: str | None = Field(default=None, max_length=255)
    valuator_organization: str | None = Field(default=None, max_length=255)
    valuator_credentials: str | None = Field(default=None, max_length=255)
    valuation_method: str | None = Field(default=None, max_length=50)

    # Documentation.
    documentation_reference: str | None = Field(default=None, max_length=255)
    valuation_note: str | None = None

    # Validity.
    valid_from: date | None = None
    valid_until: date | None = None
    is_current: bool = True

    # Authorization (procedures).
    authorizer_id: UUID | None = None
    authorization_date: date | None = None
    authorization_note: str | None = None
