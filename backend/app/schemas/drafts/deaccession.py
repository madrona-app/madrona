"""Typed payload for a `deaccession` draft (Deaccessioning, Proc. 4).

The proposable subset of the live Deaccession create shape
(`app/models/objects.py::Deaccession`). `reason` is a `Literal` mirroring the
live CHECK. `extra='forbid'` rejects anything else.

Like acquisition, deaccession is approval-gated: the draft carries the approval,
so the applier creates the live row in its post-approval state without opening a
second gate. (The draft pipeline additionally NAGPRA-gates the object before the
proposal is ever created.)
"""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict

DeaccessionReason = Literal[
    "duplicate", "outside_scope", "deterioration", "damage", "repatriation",
    "theft_loss", "exchange", "ethical", "donor_request", "legal_requirement",
    "hazard", "other",
]


class DeaccessionDraftPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Target + required core (mirrors the router's required-field checks).
    object_id: UUID
    reason: DeaccessionReason

    reason_detail: str | None = None
    justification: str | None = None

    disposal_method: str | None = None
    disposal_method_detail: str | None = None
    recipient_id: UUID | None = None
    recipient_name: str | None = None

    committee_review_required: bool = True
    board_approval_required: bool = True
    deaccession_note: str | None = None
