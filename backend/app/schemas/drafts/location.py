"""Typed payload for a `location` draft (a supporting collections entity).

The proposable subset of the live Location create shape
(`app/models/locations.py::Location`). Derived fields (path, depth, code when
omitted) are computed by the create function. `extra='forbid'` rejects anything
the model doesn't accept. Constrained fields are `Literal`s mirroring the live
locations CHECK constraints so a bad value fails at draft creation.
"""

from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

LocationType = Literal[
    "building", "wing", "floor", "room", "area", "cabinet", "shelving_unit",
    "shelf", "drawer", "bin", "box", "case", "frame", "rack", "pallet",
    "external", "other",
]
LocationFitness = Literal["suitable", "temporary", "unsuitable"]
LocationCondition = Literal["good", "fair", "poor", "under_repair"]
SecurityLevel = Literal["public", "restricted", "vault", "high_security"]


class LocationDraftPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Required core (mirrors the router's required-field checks).
    name: str = Field(..., max_length=255)
    location_type: LocationType

    # Optional — code auto-generates from type+name when omitted; parent sets
    # the path/depth.
    code: str | None = Field(default=None, max_length=50)
    parent_id: UUID | None = None
    barcode: str | None = Field(default=None, max_length=100)
    is_external: bool = False
    climate_controlled: bool = False

    # Descriptive / capacity.
    description: str | None = None
    note: str | None = None
    address: str | None = None
    capacity: int | None = Field(default=None, ge=0)
    capacity_note: str | None = None

    # Conditions / access (constrained → Literals).
    default_fitness: LocationFitness | None = None
    condition: LocationCondition | None = None
    security_level: SecurityLevel | None = None
    access_restricted: bool | None = None
    access_requirements: str | None = None
    access_note: str | None = None
    accessibility: str | None = None

    established_date: date | None = None
