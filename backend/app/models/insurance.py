"""
Insurance Management Models (Procedure 14).

Centralized insurance management for collection objects, loans, shipments,
exhibitions, and other museum entities.

Models:
- InsurancePolicy: Master policy records for the organization
- InsuranceCoverage: Links policies to covered items (objects, loans, etc.)
- IndemnityArrangement: Government indemnity scheme records
- IndemnityObject: Junction table for indemnity-covered objects
- InsuranceClaim: Claim tracking for losses/damages
"""

from datetime import datetime, date
from decimal import Decimal
from sqlalchemy import (
    Column, String, Text, DateTime, Date, ForeignKey, Boolean,
    Index, Numeric, CheckConstraint
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
import uuid

from app.database import Base


# ============================================================================
# Enum-like Constants
# ============================================================================

class PolicyType:
    """Insurance policy type constants."""
    BLANKET = 'blanket'
    FINE_ARTS = 'fine_arts'
    MARINE = 'marine'
    EXHIBITION = 'exhibition'
    ALL_RISK = 'all_risk'
    NAMED_PERILS = 'named_perils'

    ALL = [BLANKET, FINE_ARTS, MARINE, EXHIBITION, ALL_RISK, NAMED_PERILS]

    LABELS = {
        BLANKET: 'Blanket Coverage',
        FINE_ARTS: 'Fine Arts',
        MARINE: 'Marine',
        EXHIBITION: 'Exhibition',
        ALL_RISK: 'All Risk',
        NAMED_PERILS: 'Named Perils',
    }


class PolicyStatus:
    """Insurance policy status constants."""
    DRAFT = 'draft'
    PENDING_APPROVAL = 'pending_approval'
    ACTIVE = 'active'
    EXPIRED = 'expired'
    CANCELLED = 'cancelled'
    RENEWED = 'renewed'

    ALL = [DRAFT, PENDING_APPROVAL, ACTIVE, EXPIRED, CANCELLED, RENEWED]

    LABELS = {
        DRAFT: 'Draft',
        PENDING_APPROVAL: 'Pending Approval',
        ACTIVE: 'Active',
        EXPIRED: 'Expired',
        CANCELLED: 'Cancelled',
        RENEWED: 'Renewed',
    }

    # Categories
    ACTIVE_STATUSES = [DRAFT, PENDING_APPROVAL, ACTIVE]
    INACTIVE_STATUSES = [EXPIRED, CANCELLED, RENEWED]


class CoveredEntityType:
    """Types of entities that can be covered by insurance."""
    COLLECTION_OBJECT = 'collection_object'
    LOAN_IN = 'loan_in'
    LOAN_OUT = 'loan_out'
    SHIPMENT = 'shipment'
    EXHIBITION = 'exhibition'
    MOVEMENT = 'movement'
    OBJECT_ENTRY = 'object_entry'
    OBJECT_EXIT = 'object_exit'

    ALL = [
        COLLECTION_OBJECT, LOAN_IN, LOAN_OUT, SHIPMENT,
        EXHIBITION, MOVEMENT, OBJECT_ENTRY, OBJECT_EXIT
    ]

    LABELS = {
        COLLECTION_OBJECT: 'Collection Object',
        LOAN_IN: 'Loan In',
        LOAN_OUT: 'Loan Out',
        SHIPMENT: 'Shipment',
        EXHIBITION: 'Exhibition',
        MOVEMENT: 'Movement',
        OBJECT_ENTRY: 'Object Entry',
        OBJECT_EXIT: 'Object Exit',
    }


class CoverageStatus:
    """Insurance coverage status constants."""
    PENDING = 'pending'
    CONFIRMED = 'confirmed'
    CERTIFICATE_ISSUED = 'certificate_issued'
    EXPIRED = 'expired'
    CANCELLED = 'cancelled'
    CLAIMED = 'claimed'

    ALL = [PENDING, CONFIRMED, CERTIFICATE_ISSUED, EXPIRED, CANCELLED, CLAIMED]

    LABELS = {
        PENDING: 'Pending',
        CONFIRMED: 'Confirmed',
        CERTIFICATE_ISSUED: 'Certificate Issued',
        EXPIRED: 'Expired',
        CANCELLED: 'Cancelled',
        CLAIMED: 'Claimed',
    }


class IndemnityProgram:
    """Government indemnity program constants."""
    US_ARTS = 'us_arts'  # Arts and Artifacts Indemnity Program
    UK_GIS = 'uk_gis'  # UK Government Indemnity Scheme
    CANADA_SPECIAL = 'canada_special'  # Special Operating Agencies
    EU_NATIONAL = 'eu_national'  # EU national schemes
    AUSTRALIA_INDEMNITY = 'australia_indemnity'
    OTHER = 'other'

    ALL = [US_ARTS, UK_GIS, CANADA_SPECIAL, EU_NATIONAL, AUSTRALIA_INDEMNITY, OTHER]

    LABELS = {
        US_ARTS: 'US Arts & Artifacts Indemnity',
        UK_GIS: 'UK Government Indemnity Scheme',
        CANADA_SPECIAL: 'Canada Special',
        EU_NATIONAL: 'EU National',
        AUSTRALIA_INDEMNITY: 'Australia Indemnity',
        OTHER: 'Other',
    }


class IndemnityStatus:
    """Indemnity arrangement status constants."""
    DRAFT = 'draft'
    SUBMITTED = 'submitted'
    UNDER_REVIEW = 'under_review'
    APPROVED = 'approved'
    REJECTED = 'rejected'
    ACTIVE = 'active'
    EXPIRED = 'expired'

    ALL = [DRAFT, SUBMITTED, UNDER_REVIEW, APPROVED, REJECTED, ACTIVE, EXPIRED]

    LABELS = {
        DRAFT: 'Draft',
        SUBMITTED: 'Submitted',
        UNDER_REVIEW: 'Under Review',
        APPROVED: 'Approved',
        REJECTED: 'Rejected',
        ACTIVE: 'Active',
        EXPIRED: 'Expired',
    }


class LossType:
    """Loss type constants for claims."""
    DAMAGE = 'damage'
    THEFT = 'theft'
    LOSS = 'loss'
    DESTRUCTION = 'destruction'
    VANDALISM = 'vandalism'

    ALL = [DAMAGE, THEFT, LOSS, DESTRUCTION, VANDALISM]

    LABELS = {
        DAMAGE: 'Damage',
        THEFT: 'Theft',
        LOSS: 'Loss',
        DESTRUCTION: 'Total Destruction',
        VANDALISM: 'Vandalism',
    }


class ClaimStatus:
    """Insurance claim status constants."""
    DRAFT = 'draft'
    FILED = 'filed'
    UNDER_INVESTIGATION = 'under_investigation'
    APPROVED = 'approved'
    DENIED = 'denied'
    SETTLED = 'settled'
    CLOSED = 'closed'

    ALL = [DRAFT, FILED, UNDER_INVESTIGATION, APPROVED, DENIED, SETTLED, CLOSED]

    LABELS = {
        DRAFT: 'Draft',
        FILED: 'Filed',
        UNDER_INVESTIGATION: 'Under Investigation',
        APPROVED: 'Approved',
        DENIED: 'Denied',
        SETTLED: 'Settled',
        CLOSED: 'Closed',
    }


# ============================================================================
# Models
# ============================================================================

class InsurancePolicy(Base):
    """Master insurance policy record for an organization."""

    __tablename__ = 'insurance_policies'
    __table_args__ = (
        Index('ix_insurance_policies_org', 'organization_id'),
        Index('ix_insurance_policies_status', 'status'),
        Index('ix_insurance_policies_expiration', 'expiration_date'),
        Index('ix_insurance_policies_org_number', 'organization_id', 'policy_number', unique=True),
        CheckConstraint(
            f"policy_type IN ({', '.join(repr(t) for t in PolicyType.ALL)})",
            name='check_policy_type'
        ),
        CheckConstraint(
            f"status IN ({', '.join(repr(s) for s in PolicyStatus.ALL)})",
            name='check_policy_status'
        ),
        {'schema': 'collections'}
    )

    policy_id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )
    organization_id = Column(
        UUID(as_uuid=True),
        ForeignKey('organizations.organization_id', ondelete='CASCADE'),
        nullable=False
    )

    # Policy identification
    policy_number = Column(String(100), nullable=False)
    policy_name = Column(String(255), nullable=True)
    policy_type = Column(String(30), nullable=False, default=PolicyType.FINE_ARTS)

    # Provider/broker info
    provider_name = Column(String(255), nullable=True)
    provider_contact_id = Column(
        UUID(as_uuid=True),
        ForeignKey('collections.constituents.constituent_id', ondelete='SET NULL'),
        nullable=True
    )
    broker_name = Column(String(255), nullable=True)

    # Coverage period
    effective_date = Column(Date, nullable=False)
    expiration_date = Column(Date, nullable=False)

    # Financial terms
    coverage_limit = Column(Numeric(15, 2), nullable=True)
    coverage_limit_currency = Column(String(3), nullable=False, default='USD')
    per_occurrence_limit = Column(Numeric(15, 2), nullable=True)
    deductible = Column(Numeric(15, 2), nullable=True)
    annual_premium = Column(Numeric(15, 2), nullable=True)

    # Status and renewal tracking
    status = Column(String(30), nullable=False, default=PolicyStatus.DRAFT)
    renewal_of_policy_id = Column(
        UUID(as_uuid=True),
        ForeignKey('collections.insurance_policies.policy_id', ondelete='SET NULL'),
        nullable=True
    )

    # Authorization (procedure compliance)
    authorizer_id = Column(
        UUID(as_uuid=True),
        ForeignKey('collections.constituents.constituent_id', ondelete='SET NULL'),
        nullable=True
    )
    authorization_date = Column(Date, nullable=True)
    authorization_note = Column(Text, nullable=True)

    # Notes
    notes = Column(Text, nullable=True)

    # Audit fields
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by = Column(UUID(as_uuid=True), nullable=True)
    updated_by = Column(UUID(as_uuid=True), nullable=True)

    # Relationships
    coverages = relationship(
        'InsuranceCoverage',
        back_populates='policy',
        cascade='all, delete-orphan',
        lazy='selectin'
    )
    renewed_from = relationship(
        'InsurancePolicy',
        remote_side=[policy_id],
        foreign_keys=[renewal_of_policy_id],
        lazy='selectin'
    )
    authorizer = relationship(
        'Constituent',
        foreign_keys=[authorizer_id],
    )


class InsuranceCoverage(Base):
    """Links insurance policies to covered entities (objects, loans, etc.)."""

    __tablename__ = 'insurance_coverages'
    __table_args__ = (
        Index('ix_insurance_coverages_org', 'organization_id'),
        Index('ix_insurance_coverages_policy', 'policy_id'),
        Index('ix_insurance_coverages_entity', 'covered_entity_type', 'covered_entity_id'),
        Index('ix_insurance_coverages_status', 'status'),
        CheckConstraint(
            f"covered_entity_type IN ({', '.join(repr(t) for t in CoveredEntityType.ALL)})",
            name='check_covered_entity_type'
        ),
        CheckConstraint(
            f"status IN ({', '.join(repr(s) for s in CoverageStatus.ALL)})",
            name='check_coverage_status'
        ),
        {'schema': 'collections'}
    )

    coverage_id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )
    organization_id = Column(
        UUID(as_uuid=True),
        ForeignKey('organizations.organization_id', ondelete='CASCADE'),
        nullable=False
    )

    # Policy link (nullable for third-party coverage)
    policy_id = Column(
        UUID(as_uuid=True),
        ForeignKey('collections.insurance_policies.policy_id', ondelete='SET NULL'),
        nullable=True
    )

    # Covered entity (polymorphic)
    covered_entity_type = Column(String(30), nullable=False)
    covered_entity_id = Column(UUID(as_uuid=True), nullable=False)

    # Coverage period (may differ from policy)
    coverage_start_date = Column(Date, nullable=True)
    coverage_end_date = Column(Date, nullable=True)

    # Values
    declared_value = Column(Numeric(15, 2), nullable=True)
    agreed_value = Column(Numeric(15, 2), nullable=True)
    value_currency = Column(String(3), nullable=False, default='USD')

    # Third-party coverage (for borrower's insurance, etc.)
    third_party_provider = Column(String(255), nullable=True)
    third_party_policy_number = Column(String(100), nullable=True)

    # Certificate of Insurance tracking
    certificate_requested = Column(Boolean, nullable=False, default=False)
    certificate_received = Column(Boolean, nullable=False, default=False)
    certificate_received_date = Column(Date, nullable=True)
    certificate_number = Column(String(100), nullable=True)

    # Status
    status = Column(String(30), nullable=False, default=CoverageStatus.PENDING)

    # Notes
    notes = Column(Text, nullable=True)

    # Audit fields
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by = Column(UUID(as_uuid=True), nullable=True)
    updated_by = Column(UUID(as_uuid=True), nullable=True)

    # Relationships
    policy = relationship('InsurancePolicy', back_populates='coverages')
    claims = relationship(
        'InsuranceClaim',
        back_populates='coverage',
        lazy='selectin'
    )


class IndemnityArrangement(Base):
    """Government indemnity arrangement record."""

    __tablename__ = 'indemnity_arrangements'
    __table_args__ = (
        Index('ix_indemnity_org', 'organization_id'),
        Index('ix_indemnity_exhibition', 'exhibition_id'),
        Index('ix_indemnity_loan', 'loan_in_id'),
        Index('ix_indemnity_status', 'status'),
        CheckConstraint(
            f"program IN ({', '.join(repr(p) for p in IndemnityProgram.ALL)})",
            name='check_indemnity_program'
        ),
        CheckConstraint(
            f"status IN ({', '.join(repr(s) for s in IndemnityStatus.ALL)})",
            name='check_indemnity_status'
        ),
        {'schema': 'collections'}
    )

    indemnity_id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )
    organization_id = Column(
        UUID(as_uuid=True),
        ForeignKey('organizations.organization_id', ondelete='CASCADE'),
        nullable=False
    )

    # Program identification
    program = Column(String(30), nullable=False)
    reference_number = Column(String(100), nullable=True)  # Agency's reference
    internal_reference = Column(String(50), nullable=True)  # Our tracking number

    # Related records (optional links to exhibition or loan)
    exhibition_id = Column(
        UUID(as_uuid=True),
        ForeignKey('collections.exhibitions.exhibition_id', ondelete='SET NULL'),
        nullable=True
    )
    loan_in_id = Column(
        UUID(as_uuid=True),
        ForeignKey('collections.loans_in.loan_in_id', ondelete='SET NULL'),
        nullable=True
    )

    # Application tracking
    application_date = Column(Date, nullable=True)
    requested_coverage = Column(Numeric(15, 2), nullable=True)
    awarded_coverage = Column(Numeric(15, 2), nullable=True)
    coverage_currency = Column(String(3), nullable=False, default='USD')

    # Coverage period
    coverage_start_date = Column(Date, nullable=True)
    coverage_end_date = Column(Date, nullable=True)

    # Gap coverage (commercial insurance for difference)
    commercial_gap_required = Column(Boolean, nullable=False, default=False)
    gap_coverage_id = Column(
        UUID(as_uuid=True),
        ForeignKey('collections.insurance_coverages.coverage_id', ondelete='SET NULL'),
        nullable=True
    )

    # Status
    status = Column(String(30), nullable=False, default=IndemnityStatus.DRAFT)

    # Authorization (procedure compliance)
    authorizer_id = Column(
        UUID(as_uuid=True),
        ForeignKey('collections.constituents.constituent_id', ondelete='SET NULL'),
        nullable=True
    )
    authorization_date = Column(Date, nullable=True)
    authorization_note = Column(Text, nullable=True)

    # Notes
    notes = Column(Text, nullable=True)

    # Audit fields
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by = Column(UUID(as_uuid=True), nullable=True)
    updated_by = Column(UUID(as_uuid=True), nullable=True)

    # Relationships
    objects = relationship(
        'IndemnityObject',
        back_populates='indemnity',
        cascade='all, delete-orphan',
        lazy='selectin'
    )
    gap_coverage = relationship('InsuranceCoverage', foreign_keys=[gap_coverage_id])
    authorizer = relationship(
        'Constituent',
        foreign_keys=[authorizer_id],
    )
    claims = relationship(
        'InsuranceClaim',
        back_populates='indemnity',
        lazy='selectin'
    )


class IndemnityObject(Base):
    """Junction table linking IndemnityArrangement to covered objects."""

    __tablename__ = 'indemnity_objects'
    __table_args__ = (
        Index('ix_indemnity_objects_indemnity', 'indemnity_id'),
        Index('ix_indemnity_objects_object', 'object_id'),
        {'schema': 'collections'}
    )

    link_id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )
    indemnity_id = Column(
        UUID(as_uuid=True),
        ForeignKey('collections.indemnity_arrangements.indemnity_id', ondelete='CASCADE'),
        nullable=False
    )
    object_id = Column(UUID(as_uuid=True), nullable=False)

    # Per-object values
    declared_value = Column(Numeric(15, 2), nullable=True)
    approved_value = Column(Numeric(15, 2), nullable=True)
    value_currency = Column(String(3), nullable=False, default='USD')

    # Denormalized object info for display
    object_number = Column(String(100), nullable=True)
    object_title = Column(String(500), nullable=True)

    # Notes
    notes = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    # Relationships
    indemnity = relationship('IndemnityArrangement', back_populates='objects')


class InsuranceClaim(Base):
    """Insurance claim record for tracking loss/damage claims."""

    __tablename__ = 'insurance_claims'
    __table_args__ = (
        Index('ix_insurance_claims_org', 'organization_id'),
        Index('ix_insurance_claims_coverage', 'coverage_id'),
        Index('ix_insurance_claims_indemnity', 'indemnity_id'),
        Index('ix_insurance_claims_status', 'status'),
        CheckConstraint(
            f"loss_type IN ({', '.join(repr(t) for t in LossType.ALL)})",
            name='check_loss_type'
        ),
        CheckConstraint(
            f"status IN ({', '.join(repr(s) for s in ClaimStatus.ALL)})",
            name='check_claim_status'
        ),
        {'schema': 'collections'}
    )

    claim_id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )
    organization_id = Column(
        UUID(as_uuid=True),
        ForeignKey('organizations.organization_id', ondelete='CASCADE'),
        nullable=False
    )

    # Claim identification
    claim_number = Column(String(100), nullable=True)  # Our reference
    insurer_claim_number = Column(String(100), nullable=True)  # Insurer's reference

    # Links to coverage source (one of these should be set)
    coverage_id = Column(
        UUID(as_uuid=True),
        ForeignKey('collections.insurance_coverages.coverage_id', ondelete='SET NULL'),
        nullable=True
    )
    indemnity_id = Column(
        UUID(as_uuid=True),
        ForeignKey('collections.indemnity_arrangements.indemnity_id', ondelete='SET NULL'),
        nullable=True
    )

    # Link to incident report (if one exists)
    incident_report_id = Column(UUID(as_uuid=True), nullable=True)

    # Loss details
    date_of_loss = Column(Date, nullable=True)
    loss_description = Column(Text, nullable=True)
    loss_type = Column(String(30), nullable=True)

    # Financial
    claimed_amount = Column(Numeric(15, 2), nullable=True)
    settlement_amount = Column(Numeric(15, 2), nullable=True)
    amount_currency = Column(String(3), nullable=False, default='USD')

    # Adjuster info
    adjuster_name = Column(String(255), nullable=True)
    adjuster_contact = Column(String(255), nullable=True)

    # Status tracking
    status = Column(String(30), nullable=False, default=ClaimStatus.DRAFT)
    filed_date = Column(Date, nullable=True)
    settled_date = Column(Date, nullable=True)

    # Notes
    notes = Column(Text, nullable=True)

    # Audit fields
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by = Column(UUID(as_uuid=True), nullable=True)
    updated_by = Column(UUID(as_uuid=True), nullable=True)

    # Relationships
    coverage = relationship('InsuranceCoverage', back_populates='claims')
    indemnity = relationship('IndemnityArrangement', back_populates='claims')
