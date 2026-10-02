"""
SignedDocument model — polymorphic signed-document attachments.

the procedure expects signed documents on seven procedures: Object Entry,
Object Exit, Acquisition, Loans In, Loans Out, Deaccession, and Location and
Movement Control. Rather than scatter signature_media_id columns across each
procedure's table, all signed documents live in this one table with a
polymorphic link (procedure_type + procedure_id).

Each row represents either:
- An uploaded scan of the signed document (media_id set), or
- A text reference to where the signed document lives in the real world
  (reference set) — procedure explicitly allows paper-only workflows.

E-signature metadata columns are nullable in Phase 1. Phase 2 will wire up
a provider integration (Documenso/Dropbox Sign/DocuSign) and populate those
fields automatically via webhooks.

Multiple signed documents per procedure are supported — loans can have
amendments, deaccessions can have both board resolutions and deeds of gift.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models._helpers import timestamp_now, timestamp_updated, uuid_pk


# Valid procedure types (must match the CHECK constraint in the migration)
PROCEDURE_TYPES = {
    "object_entry",
    "object_exit",
    "acquisition",
    "loan_in",
    "loan_out",
    "deaccession",
    "movement",
}

# Conventional document type values per procedure (not enforced by the DB —
# the column is free text so each procedure can define its own set).
DOCUMENT_TYPES_BY_PROCEDURE: dict[str, list[str]] = {
    "object_entry": ["entry_form"],
    "object_exit": ["exit_form"],
    "acquisition": ["deed_of_gift", "transfer_of_title", "bill_of_sale"],
    "loan_in": ["loan_agreement", "amendment"],
    "loan_out": ["loan_agreement", "amendment"],
    "deaccession": ["disposal_decision", "board_resolution", "deed_of_gift_out"],
    "movement": ["custody_transfer"],
}


class SignedDocument(Base):
    """Polymorphic signed-document attachment for any procedure."""

    __tablename__ = "signed_documents"

    signed_document_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Polymorphic link to the procedure this document belongs to
    procedure_type: Mapped[str] = mapped_column(String(30), nullable=False)
    procedure_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    document_type: Mapped[str] = mapped_column(String(50), nullable=False)
    label: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Attached signed file (may be null if the document only has a text reference)
    media_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media.media_id", ondelete="SET NULL"),
        nullable=True,
    )
    # Text alternative for paper-only workflows
    # e.g., "Signed entry form in file F-2026-0041"
    reference: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # E-signature integration (nullable in Phase 1)
    esign_provider: Mapped[str | None] = mapped_column(String(30), nullable=True)
    esign_envelope_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    esign_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    esign_recipients: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    esign_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    esign_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    updated_at: Mapped[datetime] = timestamp_updated()
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    # Relationships
    media = relationship("Media", foreign_keys=[media_id])

    __table_args__ = (
        Index(
            "ix_signed_documents_procedure",
            "organization_id",
            "procedure_type",
            "procedure_id",
        ),
        Index("ix_signed_documents_media", "media_id"),
        Index("ix_signed_documents_esign_envelope", "esign_provider", "esign_envelope_id"),
        CheckConstraint(
            "procedure_type IN ("
            "'object_entry', 'object_exit', 'acquisition', "
            "'loan_in', 'loan_out', 'deaccession', 'movement'"
            ")",
            name="check_signed_doc_procedure_type",
        ),
        CheckConstraint(
            "esign_status IS NULL OR esign_status IN ("
            "'draft', 'sent', 'viewed', 'signed', 'declined', 'expired', 'voided'"
            ")",
            name="check_signed_doc_esign_status",
        ),
        {"schema": "collections"},
    )


__all__ = ["SignedDocument", "PROCEDURE_TYPES", "DOCUMENT_TYPES_BY_PROCEDURE"]
