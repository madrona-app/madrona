"""Typed payload for an `object_right` draft (Rights).

The proposable subset of the live ObjectRight create shape
(`app/models/objects.py::ObjectRight`). `right_type`/`status` are `Literal`s
mirroring the live CHECK constraints. `extra='forbid'` rejects anything else.
Unlike the API route (where object_id is a path param), the draft carries
object_id in the payload.
"""

from datetime import date
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

RightType = Literal[
    "copyright", "reproduction", "exhibition", "publication", "broadcast",
    "performance", "adaptation", "distribution", "moral_rights",
    "database_rights", "trademark", "other",
]
RightStatus = Literal[
    "unknown", "public_domain", "owned", "licensed", "granted", "requested",
    "denied", "expired", "orphan", "disputed",
]


class ObjectRightDraftPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Target + required core.
    object_id: UUID
    right_type: RightType

    right_subtype: str | None = None
    rights_holder_contact_id: UUID | None = None
    status: RightStatus = "unknown"

    start_date: date | None = None
    end_date: date | None = None
    is_perpetual: bool = False

    territory: str | None = None
    territory_note: str | None = None

    license_type: str | None = None
    license_reference: str | None = None
    license_url: str | None = None
    usage_conditions: str | None = None
    restrictions: str | None = None

    fee_required: bool = False
    fee_amount: Decimal | None = Field(default=None, ge=0)
    fee_currency: str | None = Field(default=None, max_length=3)
    fee_note: str | None = None

    permissions_granted: str | None = None
    agreement_reference: str | None = None
    next_review_date: date | None = None
    right_note: str | None = None
