"""Typed payload for a `constituent` draft (a supporting collections entity).

The proposable subset of the live Constituent create shape
(`app/models/contacts.py::Constituent`). `extra='forbid'` rejects anything else.
`constituent_type` is a `Literal` mirroring the live CHECK constraint. Variant
names and internal/cataloger notes are intentionally not proposable — those are
advanced, human-curated fields.
"""

from typing import Literal
from uuid import UUID  # noqa: F401  (kept for symmetry; not all fields use it)

from pydantic import BaseModel, ConfigDict, Field

ConstituentType = Literal[
    "person",
    "organization",
    "corporate_body",
    "family",
    "department",
    "estate",
    "dealer",
    "auction_house",
    "unknown",
]


class ConstituentDraftPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Required core (mirrors the router's required-field checks).
    constituent_type: ConstituentType
    name: str = Field(..., max_length=500)

    # Name parts.
    first_name: str | None = None
    last_name: str | None = None
    title: str | None = None
    sort_name: str | None = None
    display_name: str | None = None
    given_name: str | None = None
    family_name: str | None = None
    name_prefix: str | None = None
    name_suffix: str | None = None

    role: str | None = None
    organization_name: str | None = None
    department: str | None = None

    # Contact.
    email: str | None = None
    phone: str | None = None
    phone_secondary: str | None = None
    website: str | None = None
    address: str | None = None

    # Biographical.
    nationality: str | None = None
    culture: str | None = None
    gender: str | None = None
    birth_date_display: str | None = None
    birth_place: str | None = None
    death_date_display: str | None = None
    death_place: str | None = None
    biography: str | None = None
    biography_source: str | None = None

    # Authority identifiers.
    ulan_id: str | None = None
    viaf_id: str | None = None
    wikidata_id: str | None = None
    loc_id: str | None = None

    notes: str | None = None
