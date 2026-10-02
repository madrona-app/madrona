"""
Exhibition Info Request models for tracking inbound information.

Provides structured tracking of required documentation and materials
for traveling exhibitions: loan agreements, facility reports, packing
instructions, etc.
"""
from __future__ import annotations
from datetime import datetime, date
from typing import Optional, List
from uuid import UUID, uuid4

from sqlalchemy import (
    String, Text, Integer, Boolean, Date, DateTime, ForeignKey, UniqueConstraint
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID as PGUUID

from app.database import Base


# === ENUMS (as constants for validation) ===

class InfoRequestType:
    """Types of information/documents that may be requested."""
    LOAN_AGREEMENT = 'loan_agreement'
    FACILITY_REPORT = 'facility_report'
    PACKING_INSTRUCTIONS = 'packing_instructions'
    INSTALLATION_MANUAL = 'installation_manual'
    CRATE_LIST = 'crate_list'
    INSURANCE_CERTIFICATE = 'insurance_certificate'
    CONDITION_REPORT = 'condition_report'
    SHIPPING_SCHEDULE = 'shipping_schedule'
    PRESS_KIT = 'press_kit'
    LABEL_COPY = 'label_copy'
    IMAGE_ASSETS = 'image_assets'
    RIGHTS_DOCS = 'rights_docs'
    OTHER = 'other'

    ALL = [
        LOAN_AGREEMENT, FACILITY_REPORT, PACKING_INSTRUCTIONS, INSTALLATION_MANUAL,
        CRATE_LIST, INSURANCE_CERTIFICATE, CONDITION_REPORT, SHIPPING_SCHEDULE,
        PRESS_KIT, LABEL_COPY, IMAGE_ASSETS, RIGHTS_DOCS, OTHER
    ]

    LABELS = {
        LOAN_AGREEMENT: 'Loan Agreement',
        FACILITY_REPORT: 'Facility Report',
        PACKING_INSTRUCTIONS: 'Packing Instructions',
        INSTALLATION_MANUAL: 'Installation Manual',
        CRATE_LIST: 'Crate List',
        INSURANCE_CERTIFICATE: 'Insurance Certificate',
        CONDITION_REPORT: 'Condition Report',
        SHIPPING_SCHEDULE: 'Shipping Schedule',
        PRESS_KIT: 'Press Kit',
        LABEL_COPY: 'Label Copy',
        IMAGE_ASSETS: 'Image Assets',
        RIGHTS_DOCS: 'Rights Documentation',
        OTHER: 'Other',
    }


class InfoRequestStatus:
    """Status of an info request."""
    REQUESTED = 'requested'
    RECEIVED = 'received'
    INCOMPLETE = 'incomplete'
    APPROVED = 'approved'

    ALL = [REQUESTED, RECEIVED, INCOMPLETE, APPROVED]

    LABELS = {
        REQUESTED: 'Requested',
        RECEIVED: 'Received',
        INCOMPLETE: 'Incomplete',
        APPROVED: 'Approved',
    }


class InfoRequestSourceParty:
    """Common source parties (for suggestions, not enforced)."""
    LENDER = 'lender'
    BORROWER = 'borrower'
    VENUE = 'venue'
    ORGANIZER = 'organizer'
    COURIER = 'courier'
    SHIPPER = 'shipper'
    INSURANCE_PROVIDER = 'insurance_provider'

    ALL = [LENDER, BORROWER, VENUE, ORGANIZER, COURIER, SHIPPER, INSURANCE_PROVIDER]

    LABELS = {
        LENDER: 'Lender',
        BORROWER: 'Borrower',
        VENUE: 'Venue',
        ORGANIZER: 'Organizer',
        COURIER: 'Courier',
        SHIPPER: 'Shipper',
        INSURANCE_PROVIDER: 'Insurance Provider',
    }


# === TEMPLATE MODELS ===

class InfoRequestTemplate(Base):
    """Reusable template for generating info request lists."""
    __tablename__ = 'info_request_templates'

    template_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    organization_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey('organizations.organization_id', ondelete='CASCADE'), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    exhibition_type: Mapped[str] = mapped_column(String(30), nullable=False, server_default='general')
    is_archived: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default='false')
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default='now()', nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default='now()', nullable=False)
    created_by: Mapped[Optional[UUID]] = mapped_column(PGUUID(as_uuid=True), ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True)

    # Relationships
    items: Mapped[List["InfoRequestTemplateItem"]] = relationship(back_populates="template", cascade="all, delete-orphan")


class InfoRequestTemplateItem(Base):
    """Item within an info request template."""
    __tablename__ = 'info_request_template_items'

    template_item_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    template_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey('info_request_templates.template_id', ondelete='CASCADE'), nullable=False)
    request_type: Mapped[str] = mapped_column(String(30), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    default_source_party: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    default_due_offset_days: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    is_required: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default='true')
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default='0')
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default='now()', nullable=False)

    # Relationships
    template: Mapped["InfoRequestTemplate"] = relationship(back_populates="items")


# === EXHIBITION INFO REQUEST MODELS ===

class ExhibitionInfoRequest(Base):
    """Info request attached to an exhibition."""
    __tablename__ = 'exhibition_info_requests'

    request_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    exhibition_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey('collections.exhibitions.exhibition_id', ondelete='CASCADE'), nullable=False)
    source_template_item_id: Mapped[Optional[UUID]] = mapped_column(PGUUID(as_uuid=True), ForeignKey('info_request_template_items.template_item_id', ondelete='SET NULL'), nullable=True)

    request_type: Mapped[str] = mapped_column(String(30), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default='requested')
    source_party: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    due_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_required: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default='true')
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default='0')

    received_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    received_by: Mapped[Optional[UUID]] = mapped_column(PGUUID(as_uuid=True), ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True)
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_by: Mapped[Optional[UUID]] = mapped_column(PGUUID(as_uuid=True), ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default='now()', nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default='now()', nullable=False)
    created_by: Mapped[Optional[UUID]] = mapped_column(PGUUID(as_uuid=True), ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True)

    # Relationships
    documents: Mapped[List["InfoRequestDocument"]] = relationship(back_populates="info_request", cascade="all, delete-orphan")


class InfoRequestDocument(Base):
    """Link between an info request and a media document."""
    __tablename__ = 'info_request_documents'
    __table_args__ = (
        UniqueConstraint('request_id', 'media_id', name='uq_info_request_document'),
    )

    link_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    request_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey('exhibition_info_requests.request_id', ondelete='CASCADE'), nullable=False)
    media_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey('media.media.media_id', ondelete='CASCADE'), nullable=False)
    label: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default='now()', nullable=False)

    # Relationships
    info_request: Mapped["ExhibitionInfoRequest"] = relationship(back_populates="documents")
