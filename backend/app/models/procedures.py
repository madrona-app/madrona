from __future__ import annotations
"""procedure models: entries, acquisitions, loans, conservation, exits, deaccessions."""

import uuid
from datetime import date, datetime, time
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Time,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models._helpers import uuid_pk, timestamp_now, timestamp_updated


# ============================================================================
# OBJECT ENTRY - Object Entry procedure
# ============================================================================

class ObjectEntry(Base):
    """
    Object Entry record for items entering temporary custody.

    Implements Object Entry procedure.
    """
    __tablename__ = "object_entries"

    entry_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    department_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.departments.department_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Identification
    entry_number: Mapped[str] = mapped_column(String(50), nullable=False)
    entry_date: Mapped[date] = mapped_column(Date, nullable=False)

    # Depositor
    depositor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.constituents.constituent_id", ondelete="SET NULL"),
        nullable=True,
    )
    depositor_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Current owner
    current_owner_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.constituents.constituent_id", ondelete="SET NULL"),
        nullable=True,
    )
    current_owner: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Entry details
    entry_reason: Mapped[str] = mapped_column(String(50), nullable=False)
    entry_method: Mapped[str | None] = mapped_column(String(50), nullable=True)
    expected_duration: Mapped[str | None] = mapped_column(String(50), nullable=True)
    expected_return_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Receipt
    receipt_reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    receipt_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    received_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    received_by_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Authorization — who in the institution authorized accepting this deposit (procedures)
    authorizer_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.constituents.constituent_id", ondelete="SET NULL"),
        nullable=True,
    )
    authorization_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    authorization_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Objects (summary description; individual items live in ObjectEntryItem)
    objects_description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Insurance
    insurance_value: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    insurance_currency: Mapped[str | None] = mapped_column(String(3), nullable=True, default="USD")
    insurance_policy: Mapped[str | None] = mapped_column(String(100), nullable=True)
    insurance_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Conditions
    depositor_requirements: Mapped[str | None] = mapped_column(Text, nullable=True)
    conditions: Mapped[str | None] = mapped_column(Text, nullable=True)
    special_conditions: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Packing
    packing_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Hazards (procedures)
    hazards: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)

    # External identifiers (lender numbers, insurance records, etc.)
    # Format: [{"type": "lender_number", "value": "ABC123"}, ...]
    identifiers: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)

    # Manager
    entry_manager_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    entry_manager_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Note
    entry_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Terms and Conditions Acceptance (procedure compliance)
    # "Get their signature to confirm their acceptance of [terms and conditions]"
    terms_accepted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    terms_accepted_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    terms_accepted_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.constituents.constituent_id", ondelete="SET NULL"),
        nullable=True,
    )
    terms_accepted_by: Mapped[str | None] = mapped_column(String(255), nullable=True)  # Deprecated
    # Procedure: how acceptance was captured (signature, email, verbal, online)
    acceptance_method: Mapped[str | None] = mapped_column(String(20), nullable=True)
    acceptance_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Deprecated — signed document attachments now live in the polymorphic
    # signed_documents table. signature_reference stays for one release so
    # old rows keep their text reference until the UI is fully migrated.
    signature_reference: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Status
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    processed_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    processed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    outcome: Mapped[str | None] = mapped_column(String(20), nullable=True)
    outcome_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    outcome_reference_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    # Return
    return_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    returned_to: Mapped[str | None] = mapped_column(String(255), nullable=True)
    return_method: Mapped[str | None] = mapped_column(String(50), nullable=True)
    return_receipt_reference: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Link to Object Exit record
    exit_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.object_exits.exit_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Task assignment
    assigned_to_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[datetime] = timestamp_updated()
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    # Optimistic concurrency control — clients must send current version on update
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="ObjectEntry.organization_id == Organization.organization_id",
    )
    depositor: Mapped["Constituent | None"] = relationship(
        "Constituent",
        foreign_keys=[depositor_id],
    )
    authorizer: Mapped["Constituent | None"] = relationship(
        "Constituent",
        foreign_keys=[authorizer_id],
    )
    assigned_to: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[assigned_to_user_id],
    )
    items: Mapped[list["ObjectEntryItem"]] = relationship(
        "ObjectEntryItem",
        back_populates="entry",
        cascade="all, delete-orphan",
    )
    # Polymorphic signed-document attachments (view-only — writes go through
    # the signed_documents router).
    signed_documents = relationship(
        "SignedDocument",
        primaryjoin=(
            "and_(foreign(SignedDocument.procedure_id) == ObjectEntry.entry_id, "
            "SignedDocument.procedure_type == 'object_entry')"
        ),
        viewonly=True,
    )
    department: Mapped["Department | None"] = relationship(
        "Department",
        foreign_keys=[department_id],
    )

    __table_args__ = (
        Index("ix_object_entries_org_number", "organization_id", "entry_number", unique=True),
        Index("ix_object_entries_org_status", "organization_id", "status"),
        Index("ix_object_entries_org_dept", "organization_id", "department_id"),
        Index("ix_object_entries_depositor", "depositor_id"),
        CheckConstraint(
            "entry_reason IN ('loan_consideration', 'gift_offer', 'purchase_consideration', "
            "'identification', 'conservation', 'photography', 'research', 'enquiry', 'other')",
            name="check_entry_reason",
        ),
        CheckConstraint(
            "status IN ('pending', 'received', 'processing', 'processed', 'returned', 'acquired')",
            name="check_entry_status",
        ),
        {"schema": "collections"},
    )


class ObjectEntryItemMedia(Base):
    """
    Links media to individual object entry items for documentation purposes.

    Each item in an Object Entry can have its own photos (condition
    images, identification shots, packaging, etc.) rather than a single shared
    media set for the whole deposit.
    """
    __tablename__ = "object_entry_item_media"

    # Composite primary key
    entry_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.object_entry_items.entry_item_id", ondelete="CASCADE"),
        primary_key=True,
    )
    media_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media.media_id", ondelete="CASCADE"),
        primary_key=True,
    )

    # Link metadata
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Caption for this specific usage
    caption: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Usage context (entry_condition, packing, identification, etc.)
    usage_type: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    item: Mapped["ObjectEntryItem"] = relationship(
        "ObjectEntryItem",
        primaryjoin="ObjectEntryItemMedia.entry_item_id == ObjectEntryItem.entry_item_id",
        back_populates="media_links",
    )
    media: Mapped["Media"] = relationship(
        "Media",
        primaryjoin="ObjectEntryItemMedia.media_id == Media.media_id",
    )

    __table_args__ = (
        Index("ix_object_entry_item_media_item", "entry_item_id"),
        Index("ix_object_entry_item_media_media", "media_id"),
        {"schema": "collections"},
    )


class ObjectEntryItem(Base):
    """Individual item within an Object Entry."""
    __tablename__ = "object_entry_items"

    entry_item_id: Mapped[uuid.UUID] = uuid_pk()
    entry_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.object_entries.entry_id", ondelete="CASCADE"),
        nullable=False,
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Item identification
    item_number: Mapped[int] = mapped_column(Integer, nullable=False)
    brief_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    detailed_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    lender_object_number: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Links
    object_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.collection_objects.object_id", ondelete="CASCADE"),
        nullable=True,
    )
    acquisition_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    # Value
    declared_value: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    declared_value_currency: Mapped[str | None] = mapped_column(String(3), nullable=True, default="USD")

    # Condition
    condition_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    condition_report_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.condition_reports.report_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Storage location (per-item — a deposit may distribute across locations)
    location_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.locations.location_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Status
    item_status: Mapped[str | None] = mapped_column(String(20), nullable=True, default="pending")
    item_outcome: Mapped[str | None] = mapped_column(String(20), nullable=True)
    item_outcome_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()

    # Relationships
    entry: Mapped["ObjectEntry"] = relationship(
        "ObjectEntry",
        back_populates="items",
    )
    object: Mapped["CollectionObject | None"] = relationship(
        "CollectionObject",
        foreign_keys=[object_id],
    )
    condition_report: Mapped["ConditionReport | None"] = relationship(
        "ConditionReport",
        foreign_keys=[condition_report_id],
    )
    location: Mapped["Location | None"] = relationship(
        "Location",
        foreign_keys=[location_id],
    )
    media_links: Mapped[list["ObjectEntryItemMedia"]] = relationship(
        "ObjectEntryItemMedia",
        back_populates="item",
        cascade="all, delete-orphan",
        order_by="ObjectEntryItemMedia.sort_order",
    )

    __table_args__ = (
        Index("ix_object_entry_items_entry", "entry_id"),
        Index("ix_object_entry_items_org", "organization_id"),
        Index("ix_object_entry_items_location", "location_id"),
        {"schema": "collections"},
    )


# ============================================================================
# ACQUISITIONS - Acquisition + CDWA 23
# ============================================================================

class Acquisition(Base):
    """
    Acquisition record - Legal transfer of ownership to the museum.

    Implements Acquisition procedure with CDWA Category 23
    (Ownership/Collecting History) fields.

    Note: Acquisition (legal title transfer) is distinct from Accessioning
    (formal commitment to permanent collection). An object may be acquired
    but not yet accessioned pending governing body approval.
    """
    __tablename__ = "acquisitions"

    acquisition_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    department_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.departments.department_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Identification
    acquisition_number: Mapped[str] = mapped_column(String(50), nullable=False)
    acquisition_method: Mapped[str] = mapped_column(String(30), nullable=False)
    acquisition_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Accessioning - Formal commitment to permanent collection
    # (Distinct from acquisition - requires governing body approval)
    accession_number: Mapped[str | None] = mapped_column(String(50), nullable=True)
    accession_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    accessioning_approved: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    accessioning_approved_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    accessioning_approved_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    accessioning_resolution: Mapped[str | None] = mapped_column(String(100), nullable=True)
    accessioning_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Source (CDWA 23.5)
    source_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.constituents.constituent_id", ondelete="SET NULL"),
        nullable=True,
    )
    source_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source_type: Mapped[str | None] = mapped_column(String(30), nullable=True)

    # Authorization
    authorization_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    authorization_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    authorization_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Board approval
    board_approval_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    board_approval_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    board_approval_reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    board_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Cost/Value (CDWA 23.3)
    cost: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    cost_currency: Mapped[str | None] = mapped_column(String(3), nullable=True, default="USD")
    funding_source: Mapped[str | None] = mapped_column(String(255), nullable=True)
    funding_account: Mapped[str | None] = mapped_column(String(100), nullable=True)
    funding_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Appraisal
    appraised_value: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    appraised_value_currency: Mapped[str | None] = mapped_column(String(3), nullable=True, default="USD")
    appraised_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    appraiser_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Legal status (CDWA 23.4) — not defaulted: clear title is a human
    # determination, never assumed at record creation.
    legal_status: Mapped[str | None] = mapped_column(String(30), nullable=True)
    legal_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Provenance
    provenance_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    provenance_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Restrictions
    provisos: Mapped[str | None] = mapped_column(Text, nullable=True)
    donor_restrictions: Mapped[str | None] = mapped_column(Text, nullable=True)

    # procedures — Acquisition reason & acknowledgment
    acquisition_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    acknowledgement_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    acknowledgement_reference: Mapped[str | None] = mapped_column(String(200), nullable=True)

    # Credit line (CDWA 23.9)
    credit_line: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Documentation
    deed_of_gift_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    deed_of_gift_reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    transfer_of_title_number: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Entry link
    entry_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.object_entries.entry_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Count
    objects_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    # Notes
    acquisition_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    internal_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Status
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="proposed")
    completed_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[datetime] = timestamp_updated()
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="Acquisition.organization_id == Organization.organization_id",
    )
    source: Mapped["Constituent | None"] = relationship(
        "Constituent",
        foreign_keys=[source_id],
    )
    entry: Mapped["ObjectEntry | None"] = relationship(
        "ObjectEntry",
        foreign_keys=[entry_id],
    )
    objects: Mapped[list["AcquisitionObject"]] = relationship(
        "AcquisitionObject",
        back_populates="acquisition",
        cascade="all, delete-orphan",
    )
    department: Mapped["Department | None"] = relationship(
        "Department",
        foreign_keys=[department_id],
    )
    signed_documents = relationship(
        "SignedDocument",
        primaryjoin=(
            "and_(foreign(SignedDocument.procedure_id) == Acquisition.acquisition_id, "
            "SignedDocument.procedure_type == 'acquisition')"
        ),
        viewonly=True,
    )

    __table_args__ = (
        Index("ix_acquisitions_org_number", "organization_id", "acquisition_number", unique=True),
        Index("ix_acquisitions_org_status", "organization_id", "status"),
        Index("ix_acquisitions_org_dept", "organization_id", "department_id"),
        Index("ix_acquisitions_source", "source_id"),
        CheckConstraint(
            "acquisition_method IN ('gift', 'purchase', 'bequest', 'transfer', 'exchange', "
            "'field_collection', 'commission', 'found_in_collection', 'conversion', 'donation', 'unknown')",
            name="check_acquisition_method_acq",
        ),
        CheckConstraint(
            "status IN ('proposed', 'pending_approval', 'approved', 'completed', 'accessioned', 'cancelled')",
            name="check_acquisition_status",
        ),
        # source_type is its OWN enum (NOT constituent_type) — the UI validates it
        # against individual|institution|estate|dealer|other. Without this CHECK a
        # live edit could persist e.g. 'Auction House' and brick the page on read.
        CheckConstraint(
            "source_type IS NULL OR source_type IN ('individual', 'institution', "
            "'estate', 'dealer', 'other')",
            name="check_acquisition_source_type",
        ),
        CheckConstraint(
            "legal_status IS NULL OR legal_status IN ('clear', 'pending_provenance', "
            "'disputed', 'restricted')",
            name="check_acquisition_legal_status",
        ),
        {"schema": "collections"},
    )


class AcquisitionObject(Base):
    """
    Links objects to acquisitions.

    An acquisition can include multiple objects, and this table tracks
    each object that is part of an acquisition.
    """
    __tablename__ = "acquisition_objects"

    acquisition_object_id: Mapped[uuid.UUID] = uuid_pk()
    acquisition_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.acquisitions.acquisition_id", ondelete="CASCADE"),
        nullable=False,
    )
    object_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.collection_objects.object_id", ondelete="CASCADE"),
        nullable=False,
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Notes specific to this object in the acquisition
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    acquisition: Mapped["Acquisition"] = relationship(
        "Acquisition",
        back_populates="objects",
    )
    object: Mapped["CollectionObject"] = relationship(
        "CollectionObject",
        back_populates="acquisitions",
    )

    __table_args__ = (
        Index("ix_acquisition_objects_acquisition", "acquisition_id"),
        Index("ix_acquisition_objects_object", "object_id"),
        UniqueConstraint("acquisition_id", "object_id", name="uq_acquisition_object"),
        {"schema": "collections"},
    )


# ============================================================================
# LOANS IN - Loans In + CDWA 24
# ============================================================================

class LoanIn(Base):
    """
    Loan In (borrowing) record.

    Implements Loans In (Borrowing Objects) procedure with
    CDWA Category 24 (Exhibition/Loan History) fields.
    """
    __tablename__ = "loans_in"

    loan_in_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    department_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.departments.department_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Identification
    loan_number: Mapped[str] = mapped_column(String(50), nullable=False)

    # Lender
    lender_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.constituents.constituent_id", ondelete="SET NULL"),
        nullable=True,
    )
    lender_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    lender_contact_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.constituents.constituent_id", ondelete="SET NULL"),
        nullable=True,
    )
    lender_contact_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Purpose (CDWA 24.3)
    loan_purpose: Mapped[str] = mapped_column(String(30), nullable=False)
    exhibition_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    exhibition_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    exhibition_venue: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Dates (CDWA 24.7.2)
    request_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    approval_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    approved_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    loan_start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    loan_end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    actual_receipt_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    actual_return_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Renewals
    renewal_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_renewals: Mapped[int | None] = mapped_column(Integer, nullable=True, default=2)

    # Conditions
    loan_conditions: Mapped[str | None] = mapped_column(Text, nullable=True)
    special_requirements: Mapped[str | None] = mapped_column(Text, nullable=True)
    display_requirements: Mapped[str | None] = mapped_column(Text, nullable=True)
    photography_restrictions: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Insurance
    insurance_value: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    insurance_currency: Mapped[str | None] = mapped_column(String(3), nullable=True, default="USD")
    insurance_policy: Mapped[str | None] = mapped_column(String(100), nullable=True)
    insurance_provider: Mapped[str | None] = mapped_column(String(255), nullable=True)
    indemnity: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    indemnity_reference: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Facility report
    facility_report_sent: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    facility_report_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    facility_report_approved: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    facility_report_approved_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    facility_report_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Condition reports
    condition_report_in_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.condition_reports.report_id", ondelete="SET NULL"),
        nullable=True,
    )
    condition_report_out_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.condition_reports.report_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Link to Object Entry (for loans originating from temporary deposits)
    entry_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.object_entries.entry_id", ondelete="SET NULL"),
        nullable=True,
    )

    # External identifiers (lender numbers, insurance records, etc.)
    # Format: [{"type": "lender_number", "value": "ABC123"}, ...]
    identifiers: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)

    # Agreement
    loan_agreement_reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    loan_agreement_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    loan_agreement_signed_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Lender's Authorizer (procedure compliance)
    # "The name of person authorizing the loan on behalf of the lender"
    lender_authorizer_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("collections.constituents.constituent_id", ondelete="SET NULL"), nullable=True
    )
    lender_authorizer_name: Mapped[str | None] = mapped_column(String(255), nullable=True)  # Legacy/fallback
    lender_authorizer_title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    lender_authorization_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Document Location (procedure compliance)
    # "Record the Document location of this file"
    document_location: Mapped[str | None] = mapped_column(String(500), nullable=True)
    document_location_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Loan Contact (procedure compliance)
    # "The person responsible for managing the loan on your behalf"
    loan_contact_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    loan_contact_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    loan_contact_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Status
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="requested")

    # Task assignment
    assigned_to_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    # Notes
    loan_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    internal_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Closing (procedure compliance — closing the loan file)
    closing_invoice_sent: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    closing_invoice_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    closing_invoice_reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    closing_invoice_amount: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    closing_invoice_currency: Mapped[str | None] = mapped_column(String(3), nullable=True, default="USD")
    receipt_acknowledged: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    receipt_acknowledged_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    receipt_acknowledged_reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    conditions_met_confirmed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    conditions_met_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    conditions_met_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    closing_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[datetime] = timestamp_updated()
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    # Optimistic concurrency control — clients must send current version on update
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="LoanIn.organization_id == Organization.organization_id",
    )
    lender: Mapped["Constituent | None"] = relationship(
        "Constituent",
        foreign_keys=[lender_id],
    )
    lender_contact: Mapped["Constituent | None"] = relationship(
        "Constituent",
        foreign_keys=[lender_contact_id],
    )
    assigned_to: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[assigned_to_user_id],
    )
    objects: Mapped[list["LoanInObject"]] = relationship(
        "LoanInObject",
        back_populates="loan",
        cascade="all, delete-orphan",
    )
    entry: Mapped["ObjectEntry | None"] = relationship(
        "ObjectEntry",
        foreign_keys=[entry_id],
    )
    entries: Mapped[list["LoanInEntry"]] = relationship(
        "LoanInEntry",
        back_populates="loan",
        cascade="all, delete-orphan",
    )
    department: Mapped["Department | None"] = relationship(
        "Department",
        foreign_keys=[department_id],
    )
    renewals: Mapped[list["LoanRenewal"]] = relationship(
        "LoanRenewal",
        primaryjoin="and_(LoanRenewal.loan_id == LoanIn.loan_in_id, LoanRenewal.loan_type == 'loan_in')",
        foreign_keys="LoanRenewal.loan_id",
        cascade="all, delete-orphan",
        viewonly=True,
    )
    signed_documents = relationship(
        "SignedDocument",
        primaryjoin=(
            "and_(foreign(SignedDocument.procedure_id) == LoanIn.loan_in_id, "
            "SignedDocument.procedure_type == 'loan_in')"
        ),
        viewonly=True,
    )

    __table_args__ = (
        Index("ix_loans_in_org_number", "organization_id", "loan_number", unique=True),
        Index("ix_loans_in_org_status", "organization_id", "status"),
        Index("ix_loans_in_org_dept", "organization_id", "department_id"),
        Index("ix_loans_in_lender", "lender_id"),
        Index("ix_loans_in_entry", "entry_id"),
        CheckConstraint(
            "loan_purpose IN ('exhibition', 'research', 'conservation', 'long_term', "
            "'photography', 'education', 'study', 'other')",
            name="check_loan_in_purpose",
        ),
        CheckConstraint(
            "status IN ('requested', 'pending_approval', 'approved', 'agreement_sent', "
            "'agreement_signed', 'in_transit', 'received', 'on_loan', 'return_initiated', "
            "'returned', 'closed', 'cancelled', 'overdue')",
            name="check_loan_in_status",
        ),
        {"schema": "collections"},
    )


class LoanInObject(Base):
    """Individual borrowed object in a Loan In."""
    __tablename__ = "loan_in_objects"

    loan_object_id: Mapped[uuid.UUID] = uuid_pk()
    loan_in_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.loans_in.loan_in_id", ondelete="CASCADE"),
        nullable=False,
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Object identification (from lender)
    object_number_lender: Mapped[str | None] = mapped_column(String(100), nullable=True)
    object_title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    object_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    artist_maker: Mapped[str | None] = mapped_column(String(255), nullable=True)
    date_description: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Internal reference
    object_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.collection_objects.object_id", ondelete="CASCADE"),
        nullable=True,
    )

    # Insurance
    insurance_value: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    insurance_currency: Mapped[str | None] = mapped_column(String(3), nullable=True, default="USD")

    # Requirements
    dimensions: Mapped[str | None] = mapped_column(Text, nullable=True)
    medium: Mapped[str | None] = mapped_column(String(255), nullable=True)
    special_requirements: Mapped[str | None] = mapped_column(Text, nullable=True)
    display_requirements: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Condition
    condition_in_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    condition_out_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    condition_report_in_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.condition_reports.report_id", ondelete="SET NULL"),
        nullable=True,
    )
    condition_report_out_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.condition_reports.report_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Location
    current_location_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.locations.location_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Status
    item_status: Mapped[str | None] = mapped_column(String(20), nullable=True, default="pending")
    received_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    returned_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()

    # Relationships
    loan: Mapped["LoanIn"] = relationship(
        "LoanIn",
        back_populates="objects",
    )
    object: Mapped["CollectionObject | None"] = relationship(
        "CollectionObject",
        foreign_keys=[object_id],
    )

    __table_args__ = (
        Index("ix_loan_in_objects_loan", "loan_in_id"),
        Index("ix_loan_in_objects_org", "organization_id"),
        {"schema": "collections"},
    )


class LoanInEntry(Base):
    """Links Loan In records to Object Entry records (many-to-many)."""
    __tablename__ = "loan_in_entries"

    loan_in_entry_id: Mapped[uuid.UUID] = uuid_pk()
    loan_in_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.loans_in.loan_in_id", ondelete="CASCADE"),
        nullable=False,
    )
    entry_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.object_entries.entry_id", ondelete="CASCADE"),
        nullable=False,
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = timestamp_now()

    # Relationships
    loan: Mapped["LoanIn"] = relationship(
        "LoanIn",
        back_populates="entries",
    )
    entry: Mapped["ObjectEntry"] = relationship(
        "ObjectEntry",
        foreign_keys=[entry_id],
    )

    __table_args__ = (
        Index("ix_loan_in_entries_loan", "loan_in_id"),
        Index("ix_loan_in_entries_entry", "entry_id"),
        Index("ix_loan_in_entries_org", "organization_id"),
        UniqueConstraint("loan_in_id", "entry_id", name="uq_loan_in_entry"),
        {"schema": "collections"},
    )


# ============================================================================
# LOANS OUT - Loans Out + CDWA 24
# ============================================================================

class LoanOut(Base):
    """
    Loan Out (lending) record.

    Implements Loans Out (Lending Objects) procedure with
    CDWA Category 24 (Exhibition/Loan History) fields.
    """
    __tablename__ = "loans_out"

    loan_out_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    department_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.departments.department_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Identification
    loan_number: Mapped[str] = mapped_column(String(50), nullable=False)

    # Borrower
    borrower_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.constituents.constituent_id", ondelete="SET NULL"),
        nullable=True,
    )
    borrower_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    borrower_status: Mapped[str | None] = mapped_column(String(30), nullable=True)

    # Venue (CDWA 24.7.1)
    venue_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    venue_address: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    # Venue contact
    venue_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.constituents.constituent_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Purpose (CDWA 24.3)
    loan_purpose: Mapped[str] = mapped_column(String(30), nullable=False)
    exhibition_title: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Dates
    request_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    approval_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    approved_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    board_approval_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    board_approval_reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    loan_start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    loan_end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    actual_dispatch_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    actual_return_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Renewals
    renewal_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_renewals: Mapped[int | None] = mapped_column(Integer, nullable=True, default=2)

    # Conditions
    loan_conditions: Mapped[str | None] = mapped_column(Text, nullable=True)
    special_conditions: Mapped[str | None] = mapped_column(Text, nullable=True)
    display_requirements: Mapped[str | None] = mapped_column(Text, nullable=True)
    installation_requirements: Mapped[str | None] = mapped_column(Text, nullable=True)
    photography_restrictions: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Insurance
    insurance_value_total: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    insurance_currency: Mapped[str | None] = mapped_column(String(3), nullable=True, default="USD")
    insurance_requirements: Mapped[str | None] = mapped_column(Text, nullable=True)
    insurance_coverage_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    certificate_of_insurance_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    certificate_of_insurance_received: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    certificate_of_insurance_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    certificate_of_insurance_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Facility report
    facility_report_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    facility_report_received: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    facility_report_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    facility_report_approved: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    facility_report_approved_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    facility_report_approved_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    facility_report_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Security
    security_conditions_confirmed: Mapped[bool] = mapped_column(default=False, server_default="false")

    # Condition reports
    condition_report_out_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.condition_reports.report_id", ondelete="SET NULL"),
        nullable=True,
    )
    condition_report_return_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.condition_reports.report_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Agreement
    loan_agreement_reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    loan_agreement_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    loan_agreement_signed_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    loan_agreement_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # the procedures — Authorization (Gap 2)
    authorizer_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("collections.constituents.constituent_id", ondelete="SET NULL"), nullable=True
    )
    authorization_date: Mapped[date | None] = mapped_column(nullable=True)
    authorization_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Fee
    loan_fee: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    loan_fee_currency: Mapped[str | None] = mapped_column(String(3), nullable=True, default="USD")
    loan_fee_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Status
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="requested")

    # Task assignment
    assigned_to_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    # Notes
    loan_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    internal_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # the procedures — Closing the Loan (Gap 3)
    closing_invoice_sent: Mapped[bool] = mapped_column(default=False, server_default="false")
    closing_invoice_date: Mapped[date | None] = mapped_column(nullable=True)
    closing_invoice_reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    closing_invoice_amount: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    closing_invoice_currency: Mapped[str | None] = mapped_column(String(3), nullable=True, default="USD")
    receipt_acknowledged: Mapped[bool] = mapped_column(default=False, server_default="false")
    receipt_acknowledged_date: Mapped[date | None] = mapped_column(nullable=True)
    receipt_acknowledged_reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    conditions_met_confirmed: Mapped[bool] = mapped_column(default=False, server_default="false")
    conditions_met_date: Mapped[date | None] = mapped_column(nullable=True)
    conditions_met_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    closing_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # the procedures — Document Location (Gap 7)
    document_location: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # the procedures — Borrower Contact (Gap 8)
    borrower_contact_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("collections.constituents.constituent_id", ondelete="SET NULL"), nullable=True)
    borrower_contact_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # the procedures — Photography/Reproduction Rights (Gap 10)
    photography_permitted: Mapped[bool | None] = mapped_column(nullable=True)
    photography_conditions: Mapped[str | None] = mapped_column(Text, nullable=True)
    reproduction_rights_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[datetime] = timestamp_updated()
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    # Optimistic concurrency control — clients must send current version on update
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="LoanOut.organization_id == Organization.organization_id",
    )
    borrower: Mapped["Constituent | None"] = relationship(
        "Constituent",
        foreign_keys=[borrower_id],
    )
    borrower_contact: Mapped["Constituent | None"] = relationship(
        "Constituent",
        foreign_keys=[borrower_contact_id],
    )
    authorizer: Mapped["Constituent | None"] = relationship(
        "Constituent",
        foreign_keys=[authorizer_id],
    )
    assigned_to: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[assigned_to_user_id],
    )
    objects: Mapped[list["LoanOutObject"]] = relationship(
        "LoanOutObject",
        back_populates="loan",
        cascade="all, delete-orphan",
    )
    department: Mapped["Department | None"] = relationship(
        "Department",
        foreign_keys=[department_id],
    )
    venue: Mapped["Constituent | None"] = relationship(
        "Constituent",
        foreign_keys=[venue_id],
    )
    renewals: Mapped[list["LoanRenewal"]] = relationship(
        "LoanRenewal",
        primaryjoin="and_(LoanRenewal.loan_id == LoanOut.loan_out_id, LoanRenewal.loan_type == 'loan_out')",
        foreign_keys="LoanRenewal.loan_id",
        cascade="all, delete-orphan",
        viewonly=True,
    )
    signed_documents = relationship(
        "SignedDocument",
        primaryjoin=(
            "and_(foreign(SignedDocument.procedure_id) == LoanOut.loan_out_id, "
            "SignedDocument.procedure_type == 'loan_out')"
        ),
        viewonly=True,
    )

    __table_args__ = (
        Index("ix_loans_out_org_number", "organization_id", "loan_number", unique=True),
        Index("ix_loans_out_org_status", "organization_id", "status"),
        Index("ix_loans_out_org_dept", "organization_id", "department_id"),
        Index("ix_loans_out_borrower", "borrower_id"),
        CheckConstraint(
            "loan_purpose IN ('exhibition', 'research', 'conservation', 'education', "
            "'photography', 'touring', 'inter_museum', 'other')",
            name="check_loan_out_purpose",
        ),
        CheckConstraint(
            "status IN ('requested', 'pending_approval', 'approved', 'agreement_sent', "
            "'agreement_signed', 'in_transit', 'on_loan', 'return_scheduled', "
            "'returned', 'closed', 'declined', 'cancelled')",
            name="check_loan_out_status",
        ),
        {"schema": "collections"},
    )


class LoanOutObject(Base):
    """Individual lent object in a Loan Out."""
    __tablename__ = "loan_out_objects"

    loan_object_id: Mapped[uuid.UUID] = uuid_pk()
    loan_out_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.loans_out.loan_out_id", ondelete="CASCADE"),
        nullable=False,
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Link to collection object (required)
    object_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.collection_objects.object_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Insurance
    insurance_value: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    insurance_currency: Mapped[str | None] = mapped_column(String(3), nullable=True, default="USD")

    # Display
    display_credit_line: Mapped[str | None] = mapped_column(String(500), nullable=True)
    display_label: Mapped[str | None] = mapped_column(Text, nullable=True)
    display_requirements: Mapped[str | None] = mapped_column(Text, nullable=True)
    installation_requirements: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Conditions
    special_conditions: Mapped[str | None] = mapped_column(Text, nullable=True)
    handling_requirements: Mapped[str | None] = mapped_column(Text, nullable=True)
    environmental_requirements: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    # Condition
    condition_out_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    condition_return_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    condition_report_out_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.condition_reports.report_id", ondelete="SET NULL"),
        nullable=True,
    )
    condition_report_return_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.condition_reports.report_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Object Exit (per-object, same pattern as condition reports)
    exit_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.object_exits.exit_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Photography
    photography_restrictions: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Status
    item_status: Mapped[str | None] = mapped_column(String(20), nullable=True, default="pending")
    dispatched_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    returned_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    damage_reported: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    damage_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # the procedures — Per-Object Borrower Information (Gap 9)
    valuation: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    valuation_currency: Mapped[str | None] = mapped_column(String(3), nullable=True, default="USD")
    valuation_date: Mapped[date | None] = mapped_column(nullable=True)
    dimensions_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    ip_rights_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    estimated_costs: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    estimated_costs_currency: Mapped[str | None] = mapped_column(String(3), nullable=True, default="USD")
    estimated_costs_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # the procedures — Photography/Reproduction Rights (Gap 10)
    photography_permitted: Mapped[bool | None] = mapped_column(nullable=True)
    reproduction_rights_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()

    # Relationships
    loan: Mapped["LoanOut"] = relationship(
        "LoanOut",
        back_populates="objects",
    )
    object: Mapped["CollectionObject"] = relationship(
        "CollectionObject",
        foreign_keys=[object_id],
    )
    condition_report_out: Mapped["ConditionReport | None"] = relationship(
        "ConditionReport",
        foreign_keys=[condition_report_out_id],
    )
    condition_report_return: Mapped["ConditionReport | None"] = relationship(
        "ConditionReport",
        foreign_keys=[condition_report_return_id],
    )
    exit: Mapped["ObjectExit | None"] = relationship(
        "ObjectExit",
        foreign_keys=[exit_id],
    )

    __table_args__ = (
        Index("ix_loan_out_objects_loan", "loan_out_id"),
        Index("ix_loan_out_objects_org", "organization_id"),
        Index("ix_loan_out_objects_object", "object_id"),
        {"schema": "collections"},
    )


class LoanMonitoringEvent(Base):
    """Scheduled monitoring events for active loans (procedure compliance)."""
    __tablename__ = "loan_monitoring_events"

    event_id: Mapped[uuid.UUID] = uuid_pk()
    loan_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    loan_type: Mapped[str] = mapped_column(String(10), nullable=False)  # 'loan_out' or 'loan_in'
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    event_type: Mapped[str] = mapped_column(String(30), nullable=False)
    due_date: Mapped[date] = mapped_column(nullable=False)
    completed_date: Mapped[date | None] = mapped_column(nullable=True)
    completed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", server_default="pending")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = timestamp_now()

    __table_args__ = (
        Index("ix_loan_monitoring_org_loan", "organization_id", "loan_type", "loan_id"),
        Index("ix_loan_monitoring_status_due", "organization_id", "status", "due_date"),
        {"schema": "collections"},
    )


# ============================================================================
# CONSERVATION TREATMENTS - Conservation + CDWA 15
# ============================================================================

class ConservationTreatment(Base):
    """
    Conservation treatment record.

    Implements Collections Care and Conservation procedure with
    CDWA Category 15 (Conservation/Treatment History) fields.
    """
    __tablename__ = "conservation_treatments"

    treatment_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    department_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.departments.department_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Identification
    treatment_number: Mapped[str] = mapped_column(String(50), nullable=False)

    # Object
    object_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.collection_objects.object_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Conservator (CDWA 15.3)
    conservator_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.constituents.constituent_id", ondelete="SET NULL"),
        nullable=True,
    )
    conservator_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    conservator_institution: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_external: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Treatment type (CDWA 15.2)
    treatment_type: Mapped[str] = mapped_column(String(30), nullable=False)

    # Place (CDWA 15.5)
    treatment_place: Mapped[str | None] = mapped_column(String(255), nullable=True)
    treatment_location_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.locations.location_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Proposal
    proposal_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    proposal_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    proposal_document_ref: Mapped[str | None] = mapped_column(String(100), nullable=True)
    proposed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    # Estimates
    estimated_duration_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    estimated_cost: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    estimated_cost_currency: Mapped[str | None] = mapped_column(String(3), nullable=True, default="USD")

    # Authorization
    approval_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    approved_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    approval_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Dates (CDWA 15.4)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    actual_duration_days: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Actual costs
    actual_cost: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    actual_cost_currency: Mapped[str | None] = mapped_column(String(3), nullable=True, default="USD")

    # Description (CDWA 15.1)
    treatment_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    treatment_rationale: Mapped[str | None] = mapped_column(Text, nullable=True)
    methods_used: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Condition reports
    condition_before_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.condition_reports.report_id", ondelete="SET NULL"),
        nullable=True,
    )
    condition_after_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.condition_reports.report_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Recommendations (CDWA 15.6)
    recommendations: Mapped[str | None] = mapped_column(Text, nullable=True)
    future_care_instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
    restrictions: Mapped[str | None] = mapped_column(Text, nullable=True)
    recall_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # External treatment
    dispatch_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    return_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    shipping_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    insurance_value: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    insurance_currency: Mapped[str | None] = mapped_column(String(3), nullable=True, default="USD")

    # Status
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="proposed")

    # Task assignment
    assigned_to_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    # Notes
    treatment_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    internal_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[datetime] = timestamp_updated()
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    # Optimistic concurrency control — clients must send current version on update
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="ConservationTreatment.organization_id == Organization.organization_id",
    )
    object: Mapped["CollectionObject"] = relationship(
        "CollectionObject",
        foreign_keys=[object_id],
    )
    conservator: Mapped["Constituent | None"] = relationship(
        "Constituent",
        foreign_keys=[conservator_id],
    )
    assigned_to: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[assigned_to_user_id],
    )
    department: Mapped["Department | None"] = relationship(
        "Department",
        foreign_keys=[department_id],
    )
    costs: Mapped[list["TreatmentCost"]] = relationship(
        "TreatmentCost",
        back_populates="treatment",
        cascade="all, delete-orphan",
    )
    materials: Mapped[list["TreatmentMaterial"]] = relationship(
        "TreatmentMaterial",
        back_populates="treatment",
        cascade="all, delete-orphan",
    )
    techniques: Mapped[list["TreatmentTechnique"]] = relationship(
        "TreatmentTechnique",
        back_populates="treatment",
        cascade="all, delete-orphan",
    )
    images: Mapped[list["EntityImage"]] = relationship(
        "EntityImage",
        primaryjoin="and_(EntityImage.entity_id == ConservationTreatment.treatment_id, EntityImage.entity_type == 'conservation_treatment')",
        foreign_keys="EntityImage.entity_id",
        cascade="all, delete-orphan",
        viewonly=True,
    )

    __table_args__ = (
        Index("ix_conservation_org_number", "organization_id", "treatment_number", unique=True),
        Index("ix_conservation_object", "object_id"),
        Index("ix_conservation_org_dept", "organization_id", "department_id"),
        Index("ix_conservation_org_status", "organization_id", "status"),
        CheckConstraint(
            "treatment_type IN ('preventive', 'remedial', 'restoration', 'analysis', "
            "'stabilization', 'cleaning', 'repair', 'documentation', "
            "'mount_making', 'rehousing', 'pest_treatment', 'other')",
            name="check_treatment_type",
        ),
        CheckConstraint(
            "status IN ('proposed', 'pending_approval', 'approved', 'in_progress', "
            "'on_hold', 'completed', 'cancelled')",
            name="check_treatment_status",
        ),
        {"schema": "collections"},
    )


# ============================================================================
# OBJECT EXIT - Object Exit procedure
# ============================================================================

class ObjectExit(Base):
    """
    Object Exit record.

    Implements Object Exit procedure.
    """
    __tablename__ = "object_exits"

    exit_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    department_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.departments.department_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Identification
    exit_number: Mapped[str] = mapped_column(String(50), nullable=False)
    exit_date: Mapped[date] = mapped_column(Date, nullable=False)

    # Recipient
    recipient_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.constituents.constituent_id", ondelete="SET NULL"),
        nullable=True,
    )
    recipient_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    recipient_address: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    # Exit reason
    exit_reason: Mapped[str] = mapped_column(String(30), nullable=False)

    # Link to Object Entry (for returns of temporarily held objects)
    entry_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.object_entries.entry_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Reference (for other linked records - loans, deaccessions, etc.)
    reference_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    reference_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    # Authorization
    authorization_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    authorization_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    authorization_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Method
    exit_method: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Insurance
    insurance_value: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    insurance_currency: Mapped[str | None] = mapped_column(String(3), nullable=True, default="USD")
    insurance_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Condition
    condition_at_exit: Mapped[str | None] = mapped_column(String(20), nullable=True)
    condition_report_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.condition_reports.report_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Receipt acknowledgment
    receipt_acknowledged: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    receipt_acknowledged_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    receipt_acknowledged_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    receipt_reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    receipt_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Expected return
    expected_return_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    expected_return_method: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Status
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")

    # Task assignment
    assigned_to_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    # Notes
    exit_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    internal_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[datetime] = timestamp_updated()
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="ObjectExit.organization_id == Organization.organization_id",
    )
    recipient: Mapped["Constituent | None"] = relationship(
        "Constituent",
        foreign_keys=[recipient_id],
    )
    entry: Mapped["ObjectEntry | None"] = relationship(
        "ObjectEntry",
        foreign_keys=[entry_id],
        backref="exit_record",
    )
    items: Mapped[list["ObjectExitItem"]] = relationship(
        "ObjectExitItem",
        back_populates="exit",
        cascade="all, delete-orphan",
    )
    assigned_to: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[assigned_to_user_id],
        primaryjoin="ObjectExit.assigned_to_user_id == User.user_id",
    )
    department: Mapped["Department | None"] = relationship(
        "Department",
        foreign_keys=[department_id],
    )
    signed_documents = relationship(
        "SignedDocument",
        primaryjoin=(
            "and_(foreign(SignedDocument.procedure_id) == ObjectExit.exit_id, "
            "SignedDocument.procedure_type == 'object_exit')"
        ),
        viewonly=True,
    )

    __table_args__ = (
        Index("ix_object_exits_org_number", "organization_id", "exit_number", unique=True),
        Index("ix_object_exits_org_status", "organization_id", "status"),
        Index("ix_object_exits_org_dept", "organization_id", "department_id"),
        Index("ix_object_exits_recipient", "recipient_id"),
        Index("ix_object_exits_entry", "entry_id"),
        CheckConstraint(
            "exit_reason IN ('loan_return', 'loan_out', 'transfer', 'disposal', 'deaccession', "
            "'conservation', 'photography', 'enquiry_return', 'repatriation', "
            "'destruction', 'theft_loss', 'other')",
            name="check_exit_reason",
        ),
        CheckConstraint(
            "status IN ('pending', 'preparing', 'dispatched', 'in_transit', 'acknowledged', 'cancelled')",
            name="check_exit_status",
        ),
        {"schema": "collections"},
    )


class ObjectExitItem(Base):
    """Individual item in an Object Exit."""
    __tablename__ = "object_exit_items"

    exit_item_id: Mapped[uuid.UUID] = uuid_pk()
    exit_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.object_exits.exit_id", ondelete="CASCADE"),
        nullable=False,
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Object link
    object_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.collection_objects.object_id", ondelete="CASCADE"),
        nullable=True,
    )

    # Item identification (if not linked)
    item_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    brief_description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Condition
    condition_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    condition_report_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.condition_reports.report_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Insurance
    insurance_value: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    insurance_currency: Mapped[str | None] = mapped_column(String(3), nullable=True, default="USD")

    # Status
    item_status: Mapped[str | None] = mapped_column(String(20), nullable=True, default="pending")
    dispatched_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    acknowledged_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()

    # Relationships
    exit: Mapped["ObjectExit"] = relationship(
        "ObjectExit",
        back_populates="items",
    )
    object: Mapped["CollectionObject | None"] = relationship(
        "CollectionObject",
        foreign_keys=[object_id],
    )

    __table_args__ = (
        Index("ix_object_exit_items_exit", "exit_id"),
        Index("ix_object_exit_items_org", "organization_id"),
        {"schema": "collections"},
    )


# ============================================================================
# DEACCESSIONS - Deaccessioning and Disposal
# ============================================================================

class Deaccession(Base):
    """
    Deaccession record.

    Implements Deaccessioning and Disposal procedure.
    """
    __tablename__ = "deaccessions"

    deaccession_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    department_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.departments.department_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Identification
    deaccession_number: Mapped[str] = mapped_column(String(50), nullable=False)

    # Object
    object_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.collection_objects.object_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Proposal
    proposal_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    proposed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    # Reason
    reason: Mapped[str] = mapped_column(String(30), nullable=False)
    reason_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    justification: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Disposal method
    disposal_method: Mapped[str | None] = mapped_column(String(30), nullable=True)
    disposal_method_detail: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Recipient
    recipient_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.constituents.constituent_id", ondelete="SET NULL"),
        nullable=True,
    )
    recipient_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Committee review
    committee_review_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    committee_review_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    committee_recommendation: Mapped[str | None] = mapped_column(String(20), nullable=True)
    committee_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Board approval
    board_approval_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    board_approval_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    board_approval_reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    board_resolution: Mapped[str | None] = mapped_column(Text, nullable=True)
    board_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Legal review
    legal_review_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    legal_review_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    legal_review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    legal_cleared: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    # Provenance review
    provenance_review_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    provenance_review_complete: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    provenance_review_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    provenance_review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    provenance_issues_found: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Donor restrictions
    donor_restrictions_exist: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    donor_restrictions_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    donor_notified: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    donor_notified_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Valuation
    appraised_value: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    appraised_value_currency: Mapped[str | None] = mapped_column(String(3), nullable=True, default="USD")
    appraised_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    appraiser_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.constituents.constituent_id", ondelete="SET NULL"),
        nullable=True,
    )
    appraiser_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Sale details
    sale_method: Mapped[str | None] = mapped_column(String(30), nullable=True)
    sale_price: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    sale_currency: Mapped[str | None] = mapped_column(String(3), nullable=True, default="USD")
    sale_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    sale_reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    buyer_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    proceeds_usage: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Public notice
    public_notice_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    public_notice_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    public_notice_publication: Mapped[str | None] = mapped_column(String(255), nullable=True)
    public_notice_reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    public_notice_period_end: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Exit link
    exit_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.object_exits.exit_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Deaccession date
    deaccession_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Status
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="proposed")
    completion_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Notes
    deaccession_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    internal_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[datetime] = timestamp_updated()
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    # Optimistic concurrency control — clients must send current version on update
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="Deaccession.organization_id == Organization.organization_id",
    )
    object: Mapped["CollectionObject"] = relationship(
        "CollectionObject",
        foreign_keys=[object_id],
    )
    recipient: Mapped["Constituent | None"] = relationship(
        "Constituent",
        foreign_keys=[recipient_id],
    )
    appraiser: Mapped["Constituent | None"] = relationship(
        "Constituent",
        foreign_keys=[appraiser_id],
    )
    exit: Mapped["ObjectExit | None"] = relationship(
        "ObjectExit",
        foreign_keys=[exit_id],
    )
    audit_entries: Mapped[list["DeaccessionAudit"]] = relationship(
        "DeaccessionAudit",
        back_populates="deaccession",
        cascade="all, delete-orphan",
    )
    department: Mapped["Department | None"] = relationship(
        "Department",
        foreign_keys=[department_id],
    )
    votes: Mapped[list["DeaccessionVote"]] = relationship(
        "DeaccessionVote",
        back_populates="deaccession",
        cascade="all, delete-orphan",
    )
    signed_documents = relationship(
        "SignedDocument",
        primaryjoin=(
            "and_(foreign(SignedDocument.procedure_id) == Deaccession.deaccession_id, "
            "SignedDocument.procedure_type == 'deaccession')"
        ),
        viewonly=True,
    )

    __table_args__ = (
        Index("ix_deaccessions_org_number", "organization_id", "deaccession_number", unique=True),
        Index("ix_deaccessions_object", "object_id"),
        Index("ix_deaccessions_org_dept", "organization_id", "department_id"),
        Index("ix_deaccessions_org_status", "organization_id", "status"),
        CheckConstraint(
            "reason IN ('duplicate', 'outside_scope', 'deterioration', 'damage', "
            "'repatriation', 'theft_loss', 'exchange', 'ethical', "
            "'donor_request', 'legal_requirement', 'hazard', 'other')",
            name="check_deaccession_reason",
        ),
        CheckConstraint(
            "status IN ('proposed', 'under_review', 'committee_reviewed', 'pending_board', "
            "'approved', 'in_progress', 'completed', 'cancelled', 'rejected')",
            name="check_deaccession_status",
        ),
        {"schema": "collections"},
    )


class DeaccessionAudit(Base):
    """Audit trail for deaccession changes."""
    __tablename__ = "deaccession_audit"

    audit_id: Mapped[uuid.UUID] = uuid_pk()
    deaccession_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.deaccessions.deaccession_id", ondelete="CASCADE"),
        nullable=False,
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Action
    action: Mapped[str] = mapped_column(String(50), nullable=False)

    # Field changes
    field_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    old_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    new_value: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Who and when
    performed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    performed_by_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    performed_at: Mapped[datetime] = timestamp_now()

    # Context
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    session_id: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Notes
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    deaccession: Mapped["Deaccession"] = relationship(
        "Deaccession",
        back_populates="audit_entries",
    )

    __table_args__ = (
        Index("ix_deaccession_audit_deaccession", "deaccession_id"),
        Index("ix_deaccession_audit_org", "organization_id"),
        Index("ix_deaccession_audit_performed_at", "performed_at"),
        {"schema": "collections"},
    )


# ============================================================================
# LOAN RENEWALS - Replaces renewal_history JSONB
# ============================================================================

class LoanRenewal(Base):
    """Individual renewal record for a loan."""
    __tablename__ = "loan_renewals"

    renewal_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    loan_type: Mapped[str] = mapped_column(String(10), nullable=False)
    loan_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    renewal_number: Mapped[int] = mapped_column(Integer, nullable=False)
    previous_end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    new_end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    approved_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    approval_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        Index("ix_loan_renewals_org", "organization_id"),
        Index("ix_loan_renewals_loan", "loan_type", "loan_id"),
        CheckConstraint(
            "loan_type IN ('loan_in', 'loan_out')",
            name="check_loan_renewal_type",
        ),
        {"schema": "collections"},
    )


# ============================================================================
# TREATMENT DETAIL TABLES - Replace JSONB on conservation_treatments
# ============================================================================

class TreatmentCost(Base):
    """Line item cost for a conservation treatment."""
    __tablename__ = "treatment_costs"

    cost_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    treatment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.conservation_treatments.treatment_id", ondelete="CASCADE"),
        nullable=False,
    )
    cost_category: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    amount: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    currency: Mapped[str | None] = mapped_column(String(3), nullable=True, default="USD")
    vendor: Mapped[str | None] = mapped_column(String(255), nullable=True)
    invoice_reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    treatment: Mapped["ConservationTreatment"] = relationship(
        "ConservationTreatment",
        back_populates="costs",
    )

    __table_args__ = (
        Index("ix_treatment_costs_org", "organization_id"),
        Index("ix_treatment_costs_treatment", "treatment_id"),
        {"schema": "collections"},
    )


class TreatmentMaterial(Base):
    """Material used in a conservation treatment."""
    __tablename__ = "treatment_materials"

    material_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    treatment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.conservation_treatments.treatment_id", ondelete="CASCADE"),
        nullable=False,
    )
    material_name: Mapped[str] = mapped_column(String(255), nullable=False)
    manufacturer: Mapped[str | None] = mapped_column(String(255), nullable=True)
    product_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    quantity: Mapped[str | None] = mapped_column(String(100), nullable=True)
    concentration: Mapped[str | None] = mapped_column(String(100), nullable=True)
    purpose: Mapped[str | None] = mapped_column(Text, nullable=True)
    safety_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    treatment: Mapped["ConservationTreatment"] = relationship(
        "ConservationTreatment",
        back_populates="materials",
    )

    __table_args__ = (
        Index("ix_treatment_materials_org", "organization_id"),
        Index("ix_treatment_materials_treatment", "treatment_id"),
        {"schema": "collections"},
    )


class TreatmentTechnique(Base):
    """Technique used in a conservation treatment."""
    __tablename__ = "treatment_techniques"

    technique_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    treatment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.conservation_treatments.treatment_id", ondelete="CASCADE"),
        nullable=False,
    )
    technique_name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    equipment_used: Mapped[str | None] = mapped_column(String(255), nullable=True)
    duration_hours: Mapped[Decimal | None] = mapped_column(Numeric(8, 2), nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    treatment: Mapped["ConservationTreatment"] = relationship(
        "ConservationTreatment",
        back_populates="techniques",
    )

    __table_args__ = (
        Index("ix_treatment_techniques_org", "organization_id"),
        Index("ix_treatment_techniques_treatment", "treatment_id"),
        {"schema": "collections"},
    )


# ============================================================================
# DEACCESSION VOTES - Replaces committee_members JSONB
# ============================================================================

class DeaccessionVote(Base):
    """Committee member vote on a deaccession decision."""
    __tablename__ = "deaccession_votes"

    vote_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    deaccession_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.deaccessions.deaccession_id", ondelete="CASCADE"),
        nullable=False,
    )
    voter_name: Mapped[str] = mapped_column(String(255), nullable=False)
    voter_title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    voter_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.constituents.constituent_id", ondelete="SET NULL"),
        nullable=True,
    )
    vote: Mapped[str | None] = mapped_column(String(20), nullable=True)
    vote_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    deaccession: Mapped["Deaccession"] = relationship(
        "Deaccession",
        back_populates="votes",
    )
    voter: Mapped["Constituent | None"] = relationship(
        "Constituent",
        foreign_keys=[voter_id],
    )

    __table_args__ = (
        Index("ix_deaccession_votes_org", "organization_id"),
        Index("ix_deaccession_votes_deaccession", "deaccession_id"),
        {"schema": "collections"},
    )


__all__ = [
    "ObjectEntry",
    "ObjectEntryItem",
    "ObjectEntryItemMedia",
    "Acquisition",
    "AcquisitionObject",
    "LoanIn",
    "LoanInObject",
    "LoanInEntry",
    "LoanOut",
    "LoanOutObject",
    "ConservationTreatment",
    "ObjectExit",
    "ObjectExitItem",
    "Deaccession",
    "DeaccessionAudit",
    "LoanRenewal",
    "TreatmentCost",
    "TreatmentMaterial",
    "TreatmentTechnique",
    "DeaccessionVote",
]
