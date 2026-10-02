"""Draft payload for a MediaRights record (Rights management).

Mirrors the fields the ``create_media_rights`` router endpoint accepts, with the
``rights_type`` CHECK enforced as a Literal. ``extra='forbid'`` rejects anything
else so a malformed proposal is refused at create, not at apply.
"""

from __future__ import annotations

from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# Mirrors media_rights.check_rights_type.
RightsType = Literal["copyright", "license", "restriction", "permission", "grant"]


class MediaRightsDraftPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    media_id: UUID = Field(..., description="The media item this rights record is for")
    # Defaults 'copyright' to mirror the router's create default.
    rights_type: RightsType = "copyright"
    # Free-text in the model (in_copyright | public_domain | …). RightsStatements.org
    # URIs are the recommended values for rights_statement below.
    rights_status: str | None = Field(default=None, max_length=50)
    rights_holder: str | None = Field(default=None, max_length=255)
    license_type: str | None = Field(default=None, max_length=50)  # CC-BY, CC0, ARR…
    license_url: str | None = Field(default=None, max_length=500)
    rights_statement: str | None = None  # prefer a rightsstatements.org URI
    start_date: date | None = None
    end_date: date | None = None
    territory: str | None = Field(default=None, max_length=100)  # ISO 3166-1 / 'worldwide'
    usage_restrictions: list[str] | None = None
