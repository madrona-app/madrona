"""Typed payload for a `collection_object` draft (cataloging/enrichment).

A curated subset of the (very wide) CollectionObject create shape
(`app/models/objects.py::CollectionObject`) — the core descriptive fields the
Guide proposes when cataloging. The API route accepts the full dynamic field
set; the draft is intentionally scoped to safe scalar catalog fields with
`extra='forbid'`. Link tables (titles/measurements/inscriptions/other_numbers)
and a default part are handled by the shared create function / router, not
proposed here.
"""

from datetime import date

from pydantic import BaseModel, ConfigDict, Field


class CollectionObjectDraftPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Required.
    object_number: str = Field(..., min_length=1, max_length=100)

    number_of_objects: int = Field(default=1, ge=1)

    # Identity / classification.
    object_name: str | None = Field(default=None, max_length=255)
    object_type: str | None = Field(default=None, max_length=100)
    category: str | None = Field(default=None, max_length=100)
    responsible_department: str | None = Field(default=None, max_length=100)

    # Description.
    brief_description: str | None = None
    full_description: str | None = None
    physical_description: str | None = None
    content_description: str | None = None
    distinguishing_features: str | None = None
    comments: str | None = None

    # Production / dating.
    creation_date_display: str | None = Field(default=None, max_length=100)
    creation_date_earliest: date | None = None
    creation_date_latest: date | None = None
    creation_place: str | None = Field(default=None, max_length=255)
    style_period: str | None = Field(default=None, max_length=100)

    # History.
    provenance: str | None = None
    object_history_note: str | None = None
    credit_line: str | None = Field(default=None, max_length=500)
