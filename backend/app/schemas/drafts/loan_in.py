"""Typed payload for a `loan_in` draft (Loans In, Procedure 7).

The proposable subset of the live LoanIn create shape
(`app/models/objects.py::LoanIn`). `loan_purpose` is a lookup key checked against the organization's
lookup values. `extra='forbid'` rejects anything else. Approval-gated — the draft
carries the approval.
"""

from datetime import date
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.drafts.base import LookupKey

# Lookup-backed (organizations add values): checked against the org's
# active lookup values when the draft is proposed or edited
# (app/services/lookup_fields.check_draft_lookup_values), not a fixed list.
LoanInPurpose = LookupKey


class LoanInDraftPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Required core (mirrors the router's required-field check).
    loan_purpose: LoanInPurpose

    lender_id: UUID | None = None
    lender_name: str | None = None

    exhibition_id: UUID | None = None
    exhibition_name: str | None = None

    loan_start_date: date | None = None
    loan_end_date: date | None = None
    loan_conditions: str | None = None
    special_requirements: str | None = None

    insurance_value: Decimal | None = Field(default=None, ge=0)
    insurance_currency: str = Field(default="USD", max_length=3)
    loan_note: str | None = None

    entry_id: UUID | None = None
