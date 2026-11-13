"""Request and response schemas for the research visit log."""

from __future__ import annotations

from datetime import date, time

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def _blank_to_none(value):
    if isinstance(value, str):
        value = value.strip()
        return value or None
    return value


class _VisitFields(BaseModel):
    model_config = ConfigDict(extra="forbid")

    researcher_constituent_id: str | None = None
    researcher_name: str | None = Field(default=None, max_length=255)
    researcher_affiliation: str | None = Field(default=None, max_length=255)
    visit_date: date | None = None
    arrival_time: time | None = None
    departure_time: time | None = None
    location: str | None = Field(default=None, max_length=255)
    research_topic: str | None = Field(default=None, max_length=500)
    purpose: str | None = None
    supervised_by_user_id: str | None = None
    supervised_by_name: str | None = Field(default=None, max_length=255)
    use_request_id: str | None = None
    notes: str | None = None

    @field_validator(
        "researcher_constituent_id", "researcher_name", "researcher_affiliation",
        "location", "research_topic", "purpose", "supervised_by_user_id",
        "supervised_by_name", "use_request_id", "notes", "arrival_time",
        "departure_time", mode="before",
    )
    @classmethod
    def _strip(cls, value):
        return _blank_to_none(value)

    @model_validator(mode="after")
    def _times_in_order(self):
        if self.arrival_time and self.departure_time and self.departure_time < self.arrival_time:
            raise ValueError("Departure time must be the same as or later than arrival time")
        return self


class ResearchVisitCreate(_VisitFields):
    researcher_name: str = Field(min_length=1, max_length=255)
    visit_date: date

    @field_validator("researcher_name", mode="before")
    @classmethod
    def _name_required(cls, value):
        value = _blank_to_none(value)
        if value is None:
            raise ValueError("Researcher name is required")
        return value


class ResearchVisitUpdate(_VisitFields):
    """Partial update: only the fields sent are changed."""


class ResearchVisitObjectAdd(BaseModel):
    model_config = ConfigDict(extra="forbid")

    object_id: str
    handling_note: str | None = None
    condition_on_return: str | None = None

    @field_validator("handling_note", "condition_on_return", mode="before")
    @classmethod
    def _strip(cls, value):
        return _blank_to_none(value)


class ResearchVisitObjectUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    handling_note: str | None = None
    condition_on_return: str | None = None

    @field_validator("handling_note", "condition_on_return", mode="before")
    @classmethod
    def _strip(cls, value):
        return _blank_to_none(value)


class ResearchVisitObjectOut(BaseModel):
    visit_object_id: str
    visit_id: str
    object_id: str
    object_number: str | None = None
    object_name: str | None = None
    handling_note: str | None = None
    condition_on_return: str | None = None
    created_at: str | None = None


class ResearchVisitOut(BaseModel):
    visit_id: str
    organization_id: str
    researcher_constituent_id: str | None = None
    researcher_constituent_name: str | None = None
    researcher_name: str
    researcher_affiliation: str | None = None
    visit_date: str
    arrival_time: str | None = None
    departure_time: str | None = None
    location: str | None = None
    research_topic: str | None = None
    purpose: str | None = None
    supervised_by_user_id: str | None = None
    supervised_by_name: str | None = None
    use_request_id: str | None = None
    use_request_number: str | None = None
    notes: str | None = None
    object_count: int = 0
    objects: list[ResearchVisitObjectOut] | None = None
    created_at: str | None = None
    updated_at: str | None = None


class ResearchVisitListResponse(BaseModel):
    items: list[ResearchVisitOut]
    total: int
    limit: int
    offset: int


class ObjectResearchVisitOut(BaseModel):
    """A visit as seen from one object's record."""
    visit_id: str
    visit_date: str
    researcher_name: str
    researcher_affiliation: str | None = None
    research_topic: str | None = None
    handling_note: str | None = None
    condition_on_return: str | None = None


class ObjectResearchVisitsResponse(BaseModel):
    items: list[ObjectResearchVisitOut]
