"""Typed payload for a `loan_out` draft (Loans Out, Procedure 8).

The proposable subset of the live LoanOut create shape
(`app/models/objects.py::LoanOut`). `loan_purpose` is a `Literal` mirroring the
live CHECK. `extra='forbid'` rejects anything else. Approval-gated — the draft
carries the approval.
"""

from datetime import date
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

LoanOutPurpose = Literal[
    "exhibition", "research", "conservation", "education", "photography",
    "touring", "inter_museum", "other",
]


class LoanOutDraftPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Required core (mirrors the router's required-field check).
    loan_purpose: LoanOutPurpose

    borrower_id: UUID | None = None
    borrower_name: str | None = None
    # FK → constituent for the venue; venue_name is the free-text fallback.
    venue_id: UUID | None = None
    venue_name: str | None = None
    venue_address: str | None = None
    exhibition_title: str | None = None

    loan_start_date: date | None = None
    loan_end_date: date | None = None
    loan_conditions: str | None = None
    insurance_requirements: str | None = None

    insurance_value_total: Decimal | None = Field(default=None, ge=0)
    insurance_currency: str = Field(default="USD", max_length=3)
    loan_note: str | None = None
