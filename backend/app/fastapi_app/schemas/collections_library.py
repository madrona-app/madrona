"""Request and response schemas for the library catalog (bib records,
holdings, items, and their subject and name links)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

RecordType = Literal[
    "book", "serial", "pamphlet", "braille", "large_print",
    "audio", "video", "manuscript", "other",
]
ItemStatus = Literal["available", "on_loan", "missing", "withdrawn", "in_processing"]
NameRole = Literal[
    "author", "editor", "translator", "illustrator", "narrator", "transcriber",
    "compiler", "contributor", "publisher", "other",
]

_YEAR = dict(ge=-9999, le=9999)


def _blank_to_none(value):
    if isinstance(value, str):
        value = value.strip()
        return value or None
    return value


# ============================================================================
# Records
# ============================================================================

_RECORD_TEXT_FIELDS = (
    "title", "subtitle", "statement_of_responsibility", "edition", "place",
    "publisher", "date_display", "extent", "series_statement", "language",
    "isbn", "issn", "lccn", "oclc_number", "call_number", "format_notes", "notes",
)


class _RecordFields(BaseModel):
    model_config = ConfigDict(extra="forbid")

    record_type: RecordType | None = None
    title: str | None = Field(default=None, max_length=1000)
    subtitle: str | None = Field(default=None, max_length=1000)
    statement_of_responsibility: str | None = None
    edition: str | None = Field(default=None, max_length=255)
    place: str | None = Field(default=None, max_length=255)
    publisher: str | None = Field(default=None, max_length=255)
    date_display: str | None = Field(default=None, max_length=100)
    date_earliest: int | None = Field(default=None, **_YEAR)
    date_latest: int | None = Field(default=None, **_YEAR)
    extent: str | None = Field(default=None, max_length=500)
    series_statement: str | None = Field(default=None, max_length=500)
    language: str | None = Field(default=None, max_length=100)
    isbn: str | None = Field(default=None, max_length=50)
    issn: str | None = Field(default=None, max_length=20)
    lccn: str | None = Field(default=None, max_length=50)
    oclc_number: str | None = Field(default=None, max_length=50)
    call_number: str | None = Field(default=None, max_length=100)
    format_notes: str | None = None
    notes: str | None = None

    @field_validator(*_RECORD_TEXT_FIELDS, mode="before")
    @classmethod
    def _strip(cls, value):
        return _blank_to_none(value)

    @model_validator(mode="after")
    def _years_in_order(self):
        if self.date_earliest is not None and self.date_latest is not None and self.date_latest < self.date_earliest:
            raise ValueError("Latest year must be the same as or later than earliest year")
        return self


class BibRecordCreate(_RecordFields):
    record_type: RecordType = "book"
    title: str = Field(min_length=1, max_length=1000)

    @field_validator("title", mode="before")
    @classmethod
    def _title_required(cls, value):
        value = _blank_to_none(value)
        if value is None:
            raise ValueError("Title is required")
        return value


class BibRecordUpdate(_RecordFields):
    """Partial update: only the fields sent are changed."""


# ============================================================================
# Holdings and items
# ============================================================================

class _HoldingFields(BaseModel):
    model_config = ConfigDict(extra="forbid")

    location_id: str | None = None
    call_number: str | None = Field(default=None, max_length=100)
    holdings_statement: str | None = Field(default=None, max_length=1000)
    shelving_notes: str | None = None
    public_note: str | None = None
    staff_note: str | None = None

    @field_validator(
        "location_id", "call_number", "holdings_statement", "shelving_notes",
        "public_note", "staff_note", mode="before",
    )
    @classmethod
    def _strip(cls, value):
        return _blank_to_none(value)


class BibHoldingCreate(_HoldingFields):
    pass


class BibHoldingUpdate(_HoldingFields):
    pass


class _ItemFields(BaseModel):
    model_config = ConfigDict(extra="forbid")

    barcode: str | None = Field(default=None, max_length=100)
    copy_number: str | None = Field(default=None, max_length=50)
    enumeration: str | None = Field(default=None, max_length=255)
    chronology: str | None = Field(default=None, max_length=255)
    status: ItemStatus | None = None
    condition_note: str | None = None
    collection_object_id: str | None = None

    @field_validator(
        "barcode", "copy_number", "enumeration", "chronology", "condition_note",
        "collection_object_id", mode="before",
    )
    @classmethod
    def _strip(cls, value):
        return _blank_to_none(value)


class BibItemCreate(_ItemFields):
    status: ItemStatus = "available"


class BibItemUpdate(_ItemFields):
    pass


# ============================================================================
# Authority links
# ============================================================================

class BibSubjectAdd(BaseModel):
    model_config = ConfigDict(extra="forbid")
    subject_authority_id: str


class BibNameAdd(BaseModel):
    model_config = ConfigDict(extra="forbid")
    constituent_id: str
    role: NameRole = "author"


# ============================================================================
# Responses
# ============================================================================

class BibItemOut(BaseModel):
    item_id: str
    holding_id: str
    barcode: str | None = None
    copy_number: str | None = None
    enumeration: str | None = None
    chronology: str | None = None
    status: str
    condition_note: str | None = None
    collection_object_id: str | None = None
    collection_object_number: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class BibHoldingOut(BaseModel):
    holding_id: str
    bib_record_id: str
    location_id: str | None = None
    location_name: str | None = None
    call_number: str | None = None
    holdings_statement: str | None = None
    shelving_notes: str | None = None
    public_note: str | None = None
    staff_note: str | None = None
    items: list[BibItemOut] = Field(default_factory=list)
    created_at: str | None = None
    updated_at: str | None = None


class BibSubjectOut(BaseModel):
    link_id: str
    subject_authority_id: str
    preferred_term: str | None = None
    lcsh_id: str | None = None
    display_order: int = 0


class BibNameOut(BaseModel):
    link_id: str
    constituent_id: str
    name: str | None = None
    role: str
    display_order: int = 0


class BibRecordOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    bib_record_id: str
    organization_id: str
    record_type: str | None = None
    title: str | None = None
    subtitle: str | None = None
    statement_of_responsibility: str | None = None
    edition: str | None = None
    place: str | None = None
    publisher: str | None = None
    date_display: str | None = None
    date_earliest: int | None = None
    date_latest: int | None = None
    extent: str | None = None
    series_statement: str | None = None
    language: str | None = None
    isbn: str | None = None
    issn: str | None = None
    lccn: str | None = None
    oclc_number: str | None = None
    call_number: str | None = None
    format_notes: str | None = None
    notes: str | None = None
    holding_count: int = 0
    item_count: int = 0
    holdings: list[BibHoldingOut] | None = None
    subjects: list[BibSubjectOut] | None = None
    names: list[BibNameOut] | None = None
    created_at: str | None = None
    updated_at: str | None = None
    restricted_fields: list[str] = Field(
        default_factory=list,
        validation_alias="_restricted_fields",
        serialization_alias="_restricted_fields",
    )


class BibRecordListResponse(BaseModel):
    items: list[BibRecordOut]
    total: int
    limit: int
    offset: int
