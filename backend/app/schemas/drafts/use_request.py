"""Typed payload for a `use_request` draft (Use of Collections).

The proposable subset of the live UseRequest create shape
(`app/models/objects.py::UseRequest`). `use_type` is a `Literal` mirroring the
live CHECK. `extra='forbid'` rejects anything else. `request_number` is
optional — generated (USE-{year}-NNN) when omitted.
"""

from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

UseType = Literal[
    "research", "exhibition", "reproduction", "education", "publication",
    "broadcast", "commercial", "conservation", "loan", "digitization", "other",
]


class UseRequestDraftPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Required core (mirrors the router's required-field checks).
    use_type: UseType
    requester_name: str = Field(..., max_length=255)
    use_purpose: str

    # Generated (USE-{year}-NNN) when omitted.
    request_number: str | None = Field(default=None, max_length=50)

    use_subtype: str | None = Field(default=None, max_length=50)
    use_description: str | None = None

    requester_user_id: UUID | None = None
    requester_title: str | None = None
    requester_institution: str | None = None
    requester_address: str | None = None
    requester_email: str | None = Field(default=None, max_length=255)
    requester_phone: str | None = None

    access_date_start: date | None = None
    access_date_end: date | None = None
    location_required: str | None = Field(default=None, max_length=100)
    special_requirements: str | None = None

    project_title: str | None = None
    project_description: str | None = None
    project_deadline: date | None = None

    request_note: str | None = None
