"""
Exhibition Loan linking models.

Links exhibitions to loan cases (Loan In / Loan Out) and surfaces status.
Loans are managed in their own workspaces; this is the aggregator view.
"""

import uuid
from datetime import date, datetime

from sqlalchemy import (
    DateTime,
    Boolean,
    CheckConstraint,
    Column,
    Date,
    ForeignKey,
    Index,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models._helpers import uuid_pk, uuid_fk, uuid_fk_nullable, timestamp_now, timestamp_updated


class LoanType:
    """Loan type constants."""
    LOAN_IN = 'loan_in'
    LOAN_OUT = 'loan_out'

    ALL = [LOAN_IN, LOAN_OUT]

    LABELS = {
        LOAN_IN: 'Loan In',
        LOAN_OUT: 'Loan Out',
    }


class LoanStatus:
    """Loan status constants (mirrors the loan procedures)."""
    REQUESTED = 'requested'
    PENDING_APPROVAL = 'pending_approval'
    APPROVED = 'approved'
    AGREEMENT_SENT = 'agreement_sent'
    AGREEMENT_SIGNED = 'agreement_signed'
    IN_TRANSIT = 'in_transit'
    ON_LOAN = 'on_loan'
    RETURN_SCHEDULED = 'return_scheduled'
    RETURNED = 'returned'
    CLOSED = 'closed'
    DECLINED = 'declined'
    CANCELLED = 'cancelled'

    ALL = [
        REQUESTED, PENDING_APPROVAL, APPROVED, AGREEMENT_SENT, AGREEMENT_SIGNED,
        IN_TRANSIT, ON_LOAN, RETURN_SCHEDULED, RETURNED, CLOSED, DECLINED, CANCELLED
    ]

    LABELS = {
        REQUESTED: 'Requested',
        PENDING_APPROVAL: 'Pending Approval',
        APPROVED: 'Approved',
        AGREEMENT_SENT: 'Agreement Sent',
        AGREEMENT_SIGNED: 'Agreement Signed',
        IN_TRANSIT: 'In Transit',
        ON_LOAN: 'On Loan',
        RETURN_SCHEDULED: 'Return Scheduled',
        RETURNED: 'Returned',
        CLOSED: 'Closed',
        DECLINED: 'Declined',
        CANCELLED: 'Cancelled',
    }

    # Status categories for filtering
    ACTIVE = [REQUESTED, PENDING_APPROVAL, APPROVED, AGREEMENT_SENT, AGREEMENT_SIGNED, IN_TRANSIT, ON_LOAN, RETURN_SCHEDULED]
    COMPLETED = [RETURNED, CLOSED]
    INACTIVE = [DECLINED, CANCELLED]


class ExhibitionLoan(Base):
    """
    Exhibition loan planning and tracking.

    Represents a planned or active loan for an exhibition. During planning,
    loan_id may be NULL - it gets populated when a formal loan record is
    created in the loans workspace.

    Workflow:
    1. Planning: Create with party_name, object_count, status - loan_id NULL
    2. Negotiation: Update status, track agreement/insurance progress
    3. Formal loan: Link to loans_in/loans_out via loan_id and loan_type
    """

    __tablename__ = 'exhibition_loans'
    __table_args__ = (
        Index('ix_exhibition_loans_exhibition', 'exhibition_id'),
        Index('ix_exhibition_loans_org', 'organization_id'),
        Index('ix_exhibition_loans_loan', 'loan_id'),
        Index('ix_exhibition_loans_status', 'status'),
        # Prevent the same loan from being linked to the same exhibition twice
        Index(
            'ix_exhibition_loans_unique_loan',
            'exhibition_id', 'loan_id',
            unique=True,
            postgresql_where=text("loan_id IS NOT NULL"),
        ),
        CheckConstraint(
            "(loan_id IS NULL AND loan_type IS NULL) OR "
            "(loan_id IS NOT NULL AND loan_type IN ('loan_in', 'loan_out'))",
            name='ck_exhibition_loans_loan_consistency',
        ),
        {'schema': 'collections'}
    )

    link_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('organizations.organization_id', ondelete='CASCADE'),
        nullable=False,
    )
    exhibition_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('collections.exhibitions.exhibition_id', ondelete='CASCADE'),
        nullable=False,
    )

    # Reference to formal loan case (NULL during planning phase)
    loan_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    loan_type: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Denormalized loan info (for display without joining to loans workspace)
    loan_number: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Lender/Borrower info
    party_name: Mapped[str | None] = mapped_column(String(500), nullable=True)
    party_contact: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Status tracking
    status: Mapped[str] = mapped_column(String(50), nullable=False, default=LoanStatus.REQUESTED)
    status_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Agreement tracking
    agreement_document_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    agreement_signed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    agreement_signed_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Insurance tracking
    insurance_confirmed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    insurance_policy: Mapped[str | None] = mapped_column(String(255), nullable=True)
    insurance_value: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Key dates
    request_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    loan_start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    loan_end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    actual_return_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Object count (denormalized for display)
    object_count: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Internal notes
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()
    created_by: Mapped[uuid.UUID | None] = uuid_fk_nullable("users.user_id")
    updated_by: Mapped[uuid.UUID | None] = uuid_fk_nullable("users.user_id")

    # Last sync from source loan record
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="ExhibitionLoan.organization_id == Organization.organization_id",
    )
    objects = relationship(
        'ExhibitionLoanObject',
        back_populates='loan_link',
        cascade='all, delete-orphan',
        lazy='selectin'
    )


class ExhibitionLoanObject(Base):
    """
    Objects included in a loan.

    Denormalized from the loan record for display purposes.
    """

    __tablename__ = 'exhibition_loan_objects'
    __table_args__ = (
        Index('ix_loan_objects_link', 'link_id'),
        Index('ix_loan_objects_object', 'object_id'),
        {'schema': 'collections'}
    )

    loan_object_id: Mapped[uuid.UUID] = uuid_pk()
    link_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('collections.exhibition_loans.link_id', ondelete='CASCADE'),
        nullable=False,
    )
    object_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)

    # Denormalized object info
    object_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    object_title: Mapped[str | None] = mapped_column(String(500), nullable=True)

    created_at: Mapped[datetime] = timestamp_now()

    # Relationships
    loan_link = relationship('ExhibitionLoan', back_populates='objects')
