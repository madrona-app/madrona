"""Library catalog: bibliographic records, holdings and items.

A library collection (books, serials, braille, large print, audio) is
described at three levels, the way library systems do it:

- ``BibRecord``: the work as published (title, statement of responsibility,
  edition, imprint, identifiers, classification).
- ``BibHolding``: what this organization holds of that record at one location
  (local call number, a holdings statement such as "v.1-12, 1956-1968").
- ``BibItem``: one physical piece (a volume, a copy, a cassette), with its
  barcode, copy number, enumeration/chronology and circulation status.

Subjects and names link to the existing authority files (SubjectAuthority and
Constituent) rather than being stored as text. This is separate from
``Citation``, which describes works *about* collection objects.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models._helpers import timestamp_now, uuid_pk


BIB_RECORD_TYPES = (
    "book", "serial", "pamphlet", "braille", "large_print",
    "audio", "video", "manuscript", "other",
)
BIB_ITEM_STATUSES = ("available", "on_loan", "missing", "withdrawn", "in_processing")
BIB_NAME_ROLES = (
    "author", "editor", "translator", "illustrator", "narrator", "transcriber",
    "compiler", "contributor", "publisher", "other",
)


def _in_list(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


def _org_fk() -> Mapped[uuid.UUID]:
    return mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )


def _user_fk(name: str) -> Mapped[uuid.UUID | None]:
    return mapped_column(
        name, UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )


class BibRecord(Base):
    """A bibliographic record: one published work or edition."""

    __tablename__ = "bib_records"

    bib_record_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = _org_fk()

    record_type: Mapped[str] = mapped_column(String(20), nullable=False, default="book")

    # Title and responsibility
    title: Mapped[str] = mapped_column(String(1000), nullable=False)
    subtitle: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    statement_of_responsibility: Mapped[str | None] = mapped_column(Text, nullable=True)
    edition: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Imprint
    place: Mapped[str | None] = mapped_column(String(255), nullable=True)
    publisher: Mapped[str | None] = mapped_column(String(255), nullable=True)
    date_display: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Publication years (library dates are years far more often than days).
    date_earliest: Mapped[int | None] = mapped_column(Integer, nullable=True)
    date_latest: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Description
    extent: Mapped[str | None] = mapped_column(String(500), nullable=True)
    series_statement: Mapped[str | None] = mapped_column(String(500), nullable=True)
    language: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Identifiers and classification
    isbn: Mapped[str | None] = mapped_column(String(50), nullable=True)
    issn: Mapped[str | None] = mapped_column(String(20), nullable=True)
    lccn: Mapped[str | None] = mapped_column(String(50), nullable=True)
    oclc_number: Mapped[str | None] = mapped_column(String(50), nullable=True)
    call_number: Mapped[str | None] = mapped_column(String(100), nullable=True)

    format_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # MARC fields kept verbatim from an import that have no column here.
    marc_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    created_at: Mapped[datetime] = timestamp_now()
    created_by_id: Mapped[uuid.UUID | None] = _user_fk("created_by")
    updated_at: Mapped[datetime] = timestamp_now()
    updated_by_id: Mapped[uuid.UUID | None] = _user_fk("updated_by")

    holdings: Mapped[list["BibHolding"]] = relationship(
        "BibHolding", back_populates="record", cascade="all, delete-orphan",
    )
    subject_links: Mapped[list["BibRecordSubject"]] = relationship(
        "BibRecordSubject", back_populates="record", cascade="all, delete-orphan",
    )
    name_links: Mapped[list["BibRecordConstituent"]] = relationship(
        "BibRecordConstituent", back_populates="record", cascade="all, delete-orphan",
    )

    __table_args__ = (
        CheckConstraint(_in_list("record_type", BIB_RECORD_TYPES), name="check_bib_record_type"),
        CheckConstraint(
            "date_earliest IS NULL OR date_latest IS NULL OR date_latest >= date_earliest",
            name="check_bib_record_dates",
        ),
        Index("ix_bib_records_org_type", "organization_id", "record_type"),
        Index("ix_bib_records_org_title", "organization_id", "title"),
        Index("ix_bib_records_org_isbn", "organization_id", "isbn"),
        Index("ix_bib_records_org_call_number", "organization_id", "call_number"),
        {"schema": "collections"},
    )


class BibHolding(Base):
    """What the organization holds of a record at one location."""

    __tablename__ = "bib_holdings"

    holding_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = _org_fk()
    bib_record_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.bib_records.bib_record_id", ondelete="CASCADE"),
        nullable=False,
    )
    location_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.locations.location_id", ondelete="SET NULL"),
        nullable=True,
    )

    call_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    holdings_statement: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    shelving_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    public_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    staff_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = timestamp_now()
    created_by_id: Mapped[uuid.UUID | None] = _user_fk("created_by")
    updated_at: Mapped[datetime] = timestamp_now()
    updated_by_id: Mapped[uuid.UUID | None] = _user_fk("updated_by")

    record: Mapped["BibRecord"] = relationship("BibRecord", back_populates="holdings")
    items: Mapped[list["BibItem"]] = relationship(
        "BibItem", back_populates="holding", cascade="all, delete-orphan",
    )
    location = relationship("Location", foreign_keys=[location_id])

    __table_args__ = (
        Index("ix_bib_holdings_record", "organization_id", "bib_record_id"),
        Index("ix_bib_holdings_location", "location_id"),
        {"schema": "collections"},
    )


class BibItem(Base):
    """One physical piece held: a volume, copy, disc or cassette."""

    __tablename__ = "bib_items"

    item_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = _org_fk()
    holding_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.bib_holdings.holding_id", ondelete="CASCADE"),
        nullable=False,
    )

    barcode: Mapped[str | None] = mapped_column(String(100), nullable=True)
    copy_number: Mapped[str | None] = mapped_column(String(50), nullable=True)
    enumeration: Mapped[str | None] = mapped_column(String(255), nullable=True)
    chronology: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="available")
    condition_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # When the same piece is also catalogued as a museum object.
    collection_object_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.collection_objects.object_id", ondelete="SET NULL"),
        nullable=True,
    )

    created_at: Mapped[datetime] = timestamp_now()
    created_by_id: Mapped[uuid.UUID | None] = _user_fk("created_by")
    updated_at: Mapped[datetime] = timestamp_now()
    updated_by_id: Mapped[uuid.UUID | None] = _user_fk("updated_by")

    holding: Mapped["BibHolding"] = relationship("BibHolding", back_populates="items")
    collection_object = relationship("CollectionObject", foreign_keys=[collection_object_id])

    __table_args__ = (
        # NULL barcodes (pieces not yet barcoded) do not collide.
        UniqueConstraint("organization_id", "barcode", name="uq_bib_items_org_barcode"),
        CheckConstraint(_in_list("status", BIB_ITEM_STATUSES), name="check_bib_item_status"),
        Index("ix_bib_items_holding", "organization_id", "holding_id"),
        Index("ix_bib_items_object", "collection_object_id"),
        {"schema": "collections"},
    )


class BibRecordSubject(Base):
    """A subject heading on a record, from the subject authority file."""

    __tablename__ = "bib_record_subjects"

    link_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = _org_fk()
    bib_record_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.bib_records.bib_record_id", ondelete="CASCADE"),
        nullable=False,
    )
    subject_authority_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.subject_authorities.authority_id", ondelete="CASCADE"),
        nullable=False,
    )
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = timestamp_now()
    created_by_id: Mapped[uuid.UUID | None] = _user_fk("created_by")

    record: Mapped["BibRecord"] = relationship("BibRecord", back_populates="subject_links")
    subject = relationship("SubjectAuthority", foreign_keys=[subject_authority_id])

    __table_args__ = (
        UniqueConstraint("bib_record_id", "subject_authority_id", name="uq_bib_record_subjects_record_subject"),
        Index("ix_bib_record_subjects_subject", "organization_id", "subject_authority_id"),
        {"schema": "collections"},
    )


class BibRecordConstituent(Base):
    """A person or body named on a record, with its role (author, narrator...)."""

    __tablename__ = "bib_record_constituents"

    link_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = _org_fk()
    bib_record_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.bib_records.bib_record_id", ondelete="CASCADE"),
        nullable=False,
    )
    constituent_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.constituents.constituent_id", ondelete="CASCADE"),
        nullable=False,
    )
    role: Mapped[str] = mapped_column(String(30), nullable=False, default="author")
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = timestamp_now()
    created_by_id: Mapped[uuid.UUID | None] = _user_fk("created_by")

    record: Mapped["BibRecord"] = relationship("BibRecord", back_populates="name_links")
    constituent = relationship("Constituent", foreign_keys=[constituent_id])

    __table_args__ = (
        UniqueConstraint(
            "bib_record_id", "constituent_id", "role", name="uq_bib_record_constituents_record_name_role",
        ),
        CheckConstraint(_in_list("role", BIB_NAME_ROLES), name="check_bib_record_constituent_role"),
        Index("ix_bib_record_constituents_constituent", "organization_id", "constituent_id"),
        {"schema": "collections"},
    )


__all__ = [
    "BIB_ITEM_STATUSES",
    "BIB_NAME_ROLES",
    "BIB_RECORD_TYPES",
    "BibHolding",
    "BibItem",
    "BibRecord",
    "BibRecordConstituent",
    "BibRecordSubject",
]
