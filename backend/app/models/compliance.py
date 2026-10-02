from __future__ import annotations

"""Compliance and review models: documentation plans, emergency plans, incidents, audits."""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    DateTime,
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models._helpers import uuid_pk, timestamp_now, timestamp_updated


# ============================================================================
# DOCUMENTATION PLAN - Procedure 9
# ============================================================================


class DocumentationPlan(Base):
    """
    Documentation Plan for Procedure 9 (Documentation Planning).

    Supports accreditation requirements for formal documentation strategies
    with measurable objectives, milestones, and review cycles.

    Workflow: draft -> approved -> in_progress -> completed | superseded
    """
    __tablename__ = "documentation_plans"

    plan_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Plan identification
    plan_number: Mapped[str] = mapped_column(String(50), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    plan_type: Mapped[str] = mapped_column(String(30), nullable=False)

    # Scope
    scope_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    target_collections: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    target_object_types: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    priority_criteria: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Objectives (Procedure: Documentation objectives)
    objectives: Mapped[str] = mapped_column(Text, nullable=False)
    measurable_results: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    resources_needed: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)

    # Timeline
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Review cycle
    review_frequency: Mapped[str | None] = mapped_column(String(20), nullable=True)
    next_review_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_review_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    review_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Proposal
    proposed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    proposed_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Approval
    approved_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    approval_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    approval_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Status workflow
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    completion_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    superseded_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.documentation_plans.plan_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Notes
    plan_note: Mapped[str | None] = mapped_column(Text, nullable=True)
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
        primaryjoin="DocumentationPlan.organization_id == Organization.organization_id",
    )

    __table_args__ = (
        Index("ix_doc_plans_org_number", "organization_id", "plan_number", unique=True),
        Index("ix_doc_plans_org_status", "organization_id", "status"),
        Index("ix_doc_plans_org_type", "organization_id", "plan_type"),
        CheckConstraint(
            "plan_type IN ('collection_wide', 'project', 'thematic', 'emergency', 'accreditation')",
            name="check_doc_plan_type",
        ),
        CheckConstraint(
            "status IN ('draft', 'approved', 'in_progress', 'completed', 'superseded', 'cancelled')",
            name="check_doc_plan_status",
        ),
        CheckConstraint(
            "review_frequency IS NULL OR review_frequency IN ('monthly', 'quarterly', 'biannual', 'annual')",
            name="check_doc_plan_review_freq",
        ),
        {"schema": "collections"},
    )


# ============================================================================
# EMERGENCY PLAN - Procedure 15
# ============================================================================


class EmergencyPlan(Base):
    """
    Emergency Plan for Procedure 15 (Emergency Planning).

    Comprehensive emergency preparedness including risk assessments,
    response procedures, and evacuation plans.
    """
    __tablename__ = "emergency_plans"

    plan_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Plan identification
    plan_number: Mapped[str] = mapped_column(String(50), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    plan_version: Mapped[str] = mapped_column(String(20), nullable=False, default="1.0")

    # Scope
    facility_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    facility_address: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    covered_locations: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)

    # Evacuation procedures
    evacuation_procedures: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Site plans
    site_plan_references: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    floor_plan_references: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)

    # Salvage priorities
    salvage_priority_guidance: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Response procedures
    response_procedures: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    recovery_procedures: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Training
    training_requirements: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_drill_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    next_drill_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Review cycle
    effective_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    review_frequency: Mapped[str | None] = mapped_column(String(20), nullable=True)
    next_review_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_review_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Approval
    approved_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    approval_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Status
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    superseded_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.emergency_plans.plan_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Notes
    plan_note: Mapped[str | None] = mapped_column(Text, nullable=True)

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
        primaryjoin="EmergencyPlan.organization_id == Organization.organization_id",
    )
    risk_assessments_list: Mapped[list["EmergencyRiskAssessment"]] = relationship(
        "EmergencyRiskAssessment",
        back_populates="plan",
        cascade="all, delete-orphan",
    )
    contacts: Mapped[list["EmergencyPlanContact"]] = relationship(
        "EmergencyPlanContact",
        back_populates="plan",
        cascade="all, delete-orphan",
    )
    external_services_list: Mapped[list["EmergencyExternalService"]] = relationship(
        "EmergencyExternalService",
        back_populates="plan",
        cascade="all, delete-orphan",
    )
    evacuation_routes_list: Mapped[list["EmergencyEvacuationRoute"]] = relationship(
        "EmergencyEvacuationRoute",
        back_populates="plan",
        cascade="all, delete-orphan",
    )
    assembly_points_list: Mapped[list["EmergencyAssemblyPoint"]] = relationship(
        "EmergencyAssemblyPoint",
        back_populates="plan",
        cascade="all, delete-orphan",
    )
    equipment: Mapped[list["EmergencyEquipment"]] = relationship(
        "EmergencyEquipment",
        back_populates="plan",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_emergency_plans_org_number", "organization_id", "plan_number", unique=True),
        Index("ix_emergency_plans_org_status", "organization_id", "status"),
        CheckConstraint(
            "status IN ('draft', 'approved', 'active', 'superseded', 'archived')",
            name="check_emergency_plan_status",
        ),
        {"schema": "collections"},
    )


# ============================================================================
# INCIDENT REPORT - Procedure 16
# ============================================================================


class IncidentReport(Base):
    """
    Incident Report for Procedure 16 (Damage and Loss).

    Documents incidents affecting collection objects including damage,
    loss, theft, vandalism, and environmental damage.

    Workflow: draft -> submitted -> under_investigation -> resolved
    """
    __tablename__ = "incident_reports"

    report_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Identification
    report_number: Mapped[str] = mapped_column(String(50), nullable=False)
    report_date: Mapped[date] = mapped_column(Date, nullable=False)

    # Incident type
    incident_type: Mapped[str] = mapped_column(String(30), nullable=False)
    incident_subtype: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Incident details
    incident_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    incident_date_approximate: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    incident_location_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.locations.location_id", ondelete="SET NULL"),
        nullable=True,
    )
    incident_location_description: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Discovery
    discovered_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    discovered_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    discovered_by_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    discovery_circumstances: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Description
    incident_description: Mapped[str] = mapped_column(Text, nullable=False)
    cause_analysis: Mapped[str | None] = mapped_column(Text, nullable=True)
    contributing_factors: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)

    # Immediate actions
    immediate_actions: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Police reporting
    police_notified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    police_report_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    police_report_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    police_contact: Mapped[str | None] = mapped_column(String(255), nullable=True)
    police_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Insurance claim
    insurance_claim_filed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    insurance_claim_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    insurance_claim_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    insurance_adjuster: Mapped[str | None] = mapped_column(String(255), nullable=True)
    insurance_claim_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    insurance_claim_amount: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    insurance_settlement_amount: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    insurance_currency: Mapped[str | None] = mapped_column(String(3), nullable=True, default="USD")
    insurance_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Internal notifications
    director_notified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    director_notified_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    board_notified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    board_notified_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Investigation
    investigation_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    investigation_lead: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    investigation_findings: Mapped[str | None] = mapped_column(Text, nullable=True)
    investigation_completed_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Resolution
    resolution_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolved_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Lessons learned
    lessons_learned: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Documentation
    document_references: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)

    # Status
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")

    # Task assignment
    assigned_to_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    # Notes
    report_note: Mapped[str | None] = mapped_column(Text, nullable=True)
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
        primaryjoin="IncidentReport.organization_id == Organization.organization_id",
    )
    incident_location: Mapped["Location | None"] = relationship(
        "Location",
        foreign_keys=[incident_location_id],
    )
    affected_objects: Mapped[list["IncidentReportObject"]] = relationship(
        "IncidentReportObject",
        back_populates="report",
        cascade="all, delete-orphan",
    )
    assigned_to: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[assigned_to_user_id],
        primaryjoin="IncidentReport.assigned_to_user_id == User.user_id",
    )

    __table_args__ = (
        Index("ix_incidents_org_number", "organization_id", "report_number", unique=True),
        Index("ix_incidents_org_status", "organization_id", "status"),
        Index("ix_incidents_org_type", "organization_id", "incident_type"),
        Index("ix_incidents_org_date", "organization_id", "incident_date"),
        CheckConstraint(
            "incident_type IN ('damage', 'loss', 'theft', 'vandalism', 'environmental', 'fire', 'water', 'pest', 'other')",
            name="check_incident_type",
        ),
        CheckConstraint(
            "status IN ('draft', 'submitted', 'under_investigation', 'resolved', 'closed')",
            name="check_incident_status",
        ),
        CheckConstraint(
            "insurance_claim_status IS NULL OR insurance_claim_status IN ('pending', 'approved', 'denied', 'settled', 'withdrawn')",
            name="check_insurance_claim_status",
        ),
        {"schema": "collections"},
    )


class IncidentReportObject(Base):
    """Links incident reports to affected collection objects."""
    __tablename__ = "incident_report_objects"

    incident_object_id: Mapped[uuid.UUID] = uuid_pk()
    report_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.incident_reports.report_id", ondelete="CASCADE"),
        nullable=False,
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    object_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.collection_objects.object_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Damage/loss details
    damage_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    damage_extent: Mapped[str | None] = mapped_column(String(20), nullable=True)
    condition_before: Mapped[str | None] = mapped_column(String(20), nullable=True)
    condition_after: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Linked reports
    condition_report_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.condition_reports.report_id", ondelete="SET NULL"),
        nullable=True,
    )
    treatment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.conservation_treatments.treatment_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Value assessment
    estimated_loss_value: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    estimated_loss_currency: Mapped[str | None] = mapped_column(String(3), nullable=True, default="USD")

    # Recovery
    recovered: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    recovered_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    recovery_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()

    # Relationships
    report: Mapped["IncidentReport"] = relationship(
        "IncidentReport",
        back_populates="affected_objects",
    )
    object: Mapped["CollectionObject"] = relationship(
        "CollectionObject",
        foreign_keys=[object_id],
    )

    __table_args__ = (
        Index("ix_incident_objects_report", "report_id"),
        Index("ix_incident_objects_object", "object_id"),
        CheckConstraint(
            "damage_extent IS NULL OR damage_extent IN ('minor', 'moderate', 'severe', 'total_loss')",
            name="check_incident_damage_extent",
        ),
        {"schema": "collections"},
    )


# ============================================================================
# COLLECTIONS REVIEW - Procedure 20
# ============================================================================

class CollectionsReview(Base):
    """
    Collections review campaign for assessing significance, relevance, and care needs.

    Procedure 20 fields for systematic collections review with
    assessment criteria and per-object scoring.

    Workflow: draft -> approved -> in_progress -> completed
    """
    __tablename__ = "collections_reviews"

    review_id: Mapped[UUID] = uuid_pk()
    organization_id: Mapped[UUID] = mapped_column(
        ForeignKey("organizations.organization_id", ondelete="CASCADE"), nullable=False
    )

    # Identification
    review_number: Mapped[str] = mapped_column(String(50), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    review_type: Mapped[str] = mapped_column(String(30), nullable=False)
    review_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Scope
    scope_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    target_collections: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    target_locations: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    target_object_types: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)

    # Methodology
    methodology: Mapped[str | None] = mapped_column(Text, nullable=True)
    assessment_criteria: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    scoring_guidance: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Team
    review_lead_id: Mapped[UUID | None] = mapped_column(
        "review_lead", ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    review_team: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)

    # Timeline
    planned_start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    planned_end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    actual_start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    actual_end_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Progress tracking
    objects_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    objects_reviewed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Findings
    findings_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    recommendations: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Approval
    approved_by_id: Mapped[UUID | None] = mapped_column(
        "approved_by", ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    approval_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Status
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")

    # Notes
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    internal_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    created_by_id: Mapped[UUID | None] = mapped_column(
        "created_by", ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[datetime] = timestamp_now()
    updated_by_id: Mapped[UUID | None] = mapped_column(
        "updated_by", ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    assessments: Mapped[list["ObjectReviewAssessment"]] = relationship(
        "ObjectReviewAssessment",
        back_populates="review",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_reviews_org_number", "organization_id", "review_number", unique=True),
        Index("ix_reviews_org_status", "organization_id", "status"),
        Index("ix_reviews_org_type", "organization_id", "review_type"),
        CheckConstraint(
            "review_type IN ('significance', 'relevance', 'care', 'deaccession', 'rationalization', 'thematic', 'condition', 'documentation', 'comprehensive')",
            name="check_review_type",
        ),
        CheckConstraint(
            "status IN ('draft', 'approved', 'in_progress', 'completed', 'cancelled')",
            name="check_review_status",
        ),
        {"schema": "collections"},
    )


class ObjectReviewAssessment(Base):
    """
    Per-object assessment within a collections review campaign.

    Records scores, significance ratings, and recommendations for individual objects.
    """
    __tablename__ = "object_review_assessments"

    assessment_id: Mapped[UUID] = uuid_pk()
    review_id: Mapped[UUID] = mapped_column(
        ForeignKey("collections.collections_reviews.review_id", ondelete="CASCADE"), nullable=False
    )
    organization_id: Mapped[UUID] = mapped_column(
        ForeignKey("organizations.organization_id", ondelete="CASCADE"), nullable=False
    )
    object_id: Mapped[UUID] = mapped_column(
        ForeignKey("collections.collection_objects.object_id", ondelete="CASCADE"), nullable=False
    )

    # Assessment scores
    scores: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    overall_score: Mapped[float | None] = mapped_column(Numeric(5, 2), nullable=True)

    # Significance assessment
    historical_significance: Mapped[str | None] = mapped_column(String(20), nullable=True)
    aesthetic_significance: Mapped[str | None] = mapped_column(String(20), nullable=True)
    scientific_significance: Mapped[str | None] = mapped_column(String(20), nullable=True)
    social_significance: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Relevance assessment
    collection_fit: Mapped[str | None] = mapped_column(String(20), nullable=True)
    mission_alignment: Mapped[str | None] = mapped_column(String(20), nullable=True)
    research_value: Mapped[str | None] = mapped_column(String(20), nullable=True)
    exhibition_potential: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Care needs
    conservation_needs: Mapped[str | None] = mapped_column(String(20), nullable=True)
    storage_needs: Mapped[str | None] = mapped_column(String(20), nullable=True)
    documentation_needs: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Recommendation
    recommendation: Mapped[str | None] = mapped_column(String(30), nullable=True)
    recommendation_rationale: Mapped[str | None] = mapped_column(Text, nullable=True)
    priority: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Follow-up
    follow_up_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Assessor
    assessed_by_id: Mapped[UUID | None] = mapped_column(
        "assessed_by", ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    assessed_date: Mapped[datetime] = timestamp_now()

    # Notes
    assessment_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    review: Mapped["CollectionsReview"] = relationship(
        "CollectionsReview",
        back_populates="assessments",
    )
    object: Mapped["CollectionObject"] = relationship(
        "CollectionObject",
        foreign_keys=[object_id],
    )

    __table_args__ = (
        Index("ix_review_assessments_review", "review_id"),
        Index("ix_review_assessments_object", "object_id"),
        Index("ix_review_assessments_review_object", "review_id", "object_id", unique=True),
        CheckConstraint(
            "recommendation IS NULL OR recommendation IN ('retain', 'retain_priority', 'further_review', 'deaccession', 'transfer', 'conservation', 'rehouse', 'document', 'digitize')",
            name="check_assessment_recommendation",
        ),
        CheckConstraint(
            "priority IS NULL OR priority IN ('urgent', 'high', 'medium', 'low')",
            name="check_assessment_priority",
        ),
        {"schema": "collections"},
    )


# ============================================================================
# AUDIT CAMPAIGNS - Procedure 21
# ============================================================================

class AuditCampaign(Base):
    """
    Inventory audit campaign for verifying location, condition, and documentation.

    Procedure 21 fields for systematic audit with sampling methodology
    and discrepancy tracking.

    Workflow: draft -> approved -> in_progress -> completed
    """
    __tablename__ = "audit_campaigns"

    campaign_id: Mapped[UUID] = uuid_pk()
    organization_id: Mapped[UUID] = mapped_column(
        ForeignKey("organizations.organization_id", ondelete="CASCADE"), nullable=False
    )

    # Identification
    campaign_number: Mapped[str] = mapped_column(String(50), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    audit_type: Mapped[str] = mapped_column(String(30), nullable=False)

    # Scope
    scope_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    target_locations: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    target_collections: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    target_object_types: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)

    # Sampling
    sample_method: Mapped[str | None] = mapped_column(String(30), nullable=True)
    sample_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sample_percentage: Mapped[float | None] = mapped_column(Numeric(5, 2), nullable=True)
    sampling_criteria: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Methodology
    methodology: Mapped[str | None] = mapped_column(Text, nullable=True)
    verification_procedures: Mapped[str | None] = mapped_column(Text, nullable=True)
    documentation_standards: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Team
    audit_lead_id: Mapped[UUID | None] = mapped_column(
        "audit_lead", ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    audit_team: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)

    # Timeline
    planned_start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    planned_end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    actual_start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    actual_end_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Progress
    objects_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    objects_audited: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    locations_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    locations_audited: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Results summary
    objects_verified: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    objects_not_found: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    objects_location_discrepancy: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    objects_condition_change: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    discrepancies_found: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    accuracy_rate: Mapped[float | None] = mapped_column(Numeric(5, 2), nullable=True)

    # Findings
    findings_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    recommendations: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Approval
    approved_by_id: Mapped[UUID | None] = mapped_column(
        "approved_by", ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    approval_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Sign-off
    signed_off_by_id: Mapped[UUID | None] = mapped_column(
        "signed_off_by", ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    sign_off_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Status
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")

    # Notes
    campaign_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    internal_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    created_by_id: Mapped[UUID | None] = mapped_column(
        "created_by", ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[datetime] = timestamp_now()
    updated_by_id: Mapped[UUID | None] = mapped_column(
        "updated_by", ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    results: Mapped[list["AuditResult"]] = relationship(
        "AuditResult",
        back_populates="campaign",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_audits_org_number", "organization_id", "campaign_number", unique=True),
        Index("ix_audits_org_status", "organization_id", "status"),
        Index("ix_audits_org_type", "organization_id", "audit_type"),
        CheckConstraint(
            "audit_type IN ('location', 'condition', 'documentation', 'security', 'comprehensive', 'spot_check', 'annual')",
            name="check_audit_type",
        ),
        CheckConstraint(
            "status IN ('draft', 'approved', 'in_progress', 'completed', 'cancelled')",
            name="check_audit_status",
        ),
        CheckConstraint(
            "sample_method IS NULL OR sample_method IN ('complete', 'random', 'stratified', 'systematic', 'targeted')",
            name="check_sample_method",
        ),
        {"schema": "collections"},
    )


class AuditResult(Base):
    """
    Per-object or per-location verification result within an audit campaign.

    Records verification status, discrepancies, and required follow-up actions.
    """
    __tablename__ = "audit_results"

    result_id: Mapped[UUID] = uuid_pk()
    campaign_id: Mapped[UUID] = mapped_column(
        ForeignKey("collections.audit_campaigns.campaign_id", ondelete="CASCADE"), nullable=False
    )
    organization_id: Mapped[UUID] = mapped_column(
        ForeignKey("organizations.organization_id", ondelete="CASCADE"), nullable=False
    )

    # Target (object or location)
    object_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("collections.collection_objects.object_id", ondelete="CASCADE"), nullable=True
    )
    location_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("collections.locations.location_id", ondelete="SET NULL"), nullable=True
    )

    # Verification
    verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    verification_date: Mapped[datetime] = timestamp_now()
    verified_by_id: Mapped[UUID | None] = mapped_column(
        "verified_by", ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    # Location verification
    expected_location_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("collections.locations.location_id", ondelete="SET NULL"), nullable=True
    )
    actual_location_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("collections.locations.location_id", ondelete="SET NULL"), nullable=True
    )
    location_correct: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    location_discrepancy_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Condition verification
    expected_condition: Mapped[str | None] = mapped_column(String(20), nullable=True)
    actual_condition: Mapped[str | None] = mapped_column(String(20), nullable=True)
    condition_changed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    condition_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Documentation verification
    documentation_complete: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    # Security verification
    security_adequate: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    # Overall result
    result_status: Mapped[str] = mapped_column(String(20), nullable=False)
    discrepancy_type: Mapped[str | None] = mapped_column(String(30), nullable=True)

    # Follow-up
    follow_up_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    follow_up_action: Mapped[str | None] = mapped_column(String(50), nullable=True)
    follow_up_completed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    follow_up_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    follow_up_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Notes
    result_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    campaign: Mapped["AuditCampaign"] = relationship(
        "AuditCampaign",
        back_populates="results",
    )
    object: Mapped["CollectionObject | None"] = relationship(
        "CollectionObject",
        foreign_keys=[object_id],
    )
    issue_items: Mapped[list["ComplianceIssueItem"]] = relationship(
        "ComplianceIssueItem",
        back_populates="result",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_audit_results_campaign", "campaign_id"),
        Index("ix_audit_results_object", "object_id"),
        Index("ix_audit_results_location", "location_id"),
        Index("ix_audit_results_status", "campaign_id", "result_status"),
        CheckConstraint(
            "result_status IN ('verified', 'not_found', 'discrepancy', 'inaccessible', 'pending')",
            name="check_audit_result_status",
        ),
        CheckConstraint(
            "discrepancy_type IS NULL OR discrepancy_type IN ('location_mismatch', 'not_found', 'condition_change', 'documentation_gap', 'security_issue', 'duplicate_record', 'orphan_record', 'other')",
            name="check_audit_discrepancy_type",
        ),
        {"schema": "collections"},
    )


# ============================================================================
# EMERGENCY PLAN DETAIL TABLES
# ============================================================================

class EmergencyRiskAssessment(Base):
    """Risk assessment within an emergency plan."""
    __tablename__ = "emergency_risk_assessments"

    assessment_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.emergency_plans.plan_id", ondelete="CASCADE"),
        nullable=False,
    )
    risk_type: Mapped[str] = mapped_column(String(100), nullable=False)
    likelihood: Mapped[str | None] = mapped_column(String(20), nullable=True)
    impact: Mapped[str | None] = mapped_column(String(20), nullable=True)
    risk_level: Mapped[str | None] = mapped_column(String(20), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    mitigation_measures: Mapped[str | None] = mapped_column(Text, nullable=True)
    responsible_party: Mapped[str | None] = mapped_column(String(255), nullable=True)
    review_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    plan: Mapped["EmergencyPlan"] = relationship(
        "EmergencyPlan", back_populates="risk_assessments_list",
    )

    __table_args__ = (
        Index("ix_emergency_risk_org", "organization_id"),
        Index("ix_emergency_risk_plan", "plan_id"),
        {"schema": "collections"},
    )


class EmergencyPlanContact(Base):
    """Emergency contact within an emergency plan."""
    __tablename__ = "emergency_plan_contacts"

    contact_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.emergency_plans.plan_id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    phone_secondary: Mapped[str | None] = mapped_column(String(50), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role: Mapped[str | None] = mapped_column(String(100), nullable=True)
    priority_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    available_24h: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = timestamp_now()

    plan: Mapped["EmergencyPlan"] = relationship(
        "EmergencyPlan", back_populates="contacts",
    )

    __table_args__ = (
        Index("ix_emergency_contacts_org", "organization_id"),
        Index("ix_emergency_contacts_plan", "plan_id"),
        {"schema": "collections"},
    )


class EmergencyExternalService(Base):
    """External service provider for an emergency plan."""
    __tablename__ = "emergency_external_services"

    service_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.emergency_plans.plan_id", ondelete="CASCADE"),
        nullable=False,
    )
    service_type: Mapped[str] = mapped_column(String(100), nullable=False)
    provider_name: Mapped[str] = mapped_column(String(255), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    account_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    response_time: Mapped[str | None] = mapped_column(String(100), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[datetime] = timestamp_now()

    plan: Mapped["EmergencyPlan"] = relationship(
        "EmergencyPlan", back_populates="external_services_list",
    )

    __table_args__ = (
        Index("ix_emergency_services_org", "organization_id"),
        Index("ix_emergency_services_plan", "plan_id"),
        {"schema": "collections"},
    )


class EmergencyEvacuationRoute(Base):
    """Evacuation route within an emergency plan."""
    __tablename__ = "emergency_evacuation_routes"

    route_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.emergency_plans.plan_id", ondelete="CASCADE"),
        nullable=False,
    )
    route_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    floor_plan_reference: Mapped[str | None] = mapped_column(String(255), nullable=True)
    accessibility_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    priority_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[datetime] = timestamp_now()

    plan: Mapped["EmergencyPlan"] = relationship(
        "EmergencyPlan", back_populates="evacuation_routes_list",
    )

    __table_args__ = (
        Index("ix_emergency_routes_org", "organization_id"),
        Index("ix_emergency_routes_plan", "plan_id"),
        {"schema": "collections"},
    )


class EmergencyAssemblyPoint(Base):
    """Assembly point for an emergency plan."""
    __tablename__ = "emergency_assembly_points"

    point_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.emergency_plans.plan_id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    location_reference: Mapped[str | None] = mapped_column(String(255), nullable=True)
    capacity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    accessibility_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[datetime] = timestamp_now()

    plan: Mapped["EmergencyPlan"] = relationship(
        "EmergencyPlan", back_populates="assembly_points_list",
    )

    __table_args__ = (
        Index("ix_emergency_assembly_org", "organization_id"),
        Index("ix_emergency_assembly_plan", "plan_id"),
        {"schema": "collections"},
    )


class EmergencyEquipment(Base):
    """Emergency equipment inventory item."""
    __tablename__ = "emergency_equipment"

    item_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.emergency_plans.plan_id", ondelete="CASCADE"),
        nullable=False,
    )
    equipment_type: Mapped[str] = mapped_column(String(100), nullable=False)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    quantity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    condition: Mapped[str | None] = mapped_column(String(50), nullable=True)
    last_inspection_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    next_inspection_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[datetime] = timestamp_now()

    plan: Mapped["EmergencyPlan"] = relationship(
        "EmergencyPlan", back_populates="equipment",
    )

    __table_args__ = (
        Index("ix_emergency_equipment_org", "organization_id"),
        Index("ix_emergency_equipment_plan", "plan_id"),
        {"schema": "collections"},
    )


# ============================================================================
# ENTITY IMAGES - Polymorphic image links
# ============================================================================

class EntityImage(Base):
    """Image linked to any entity with a phase/type classification."""
    __tablename__ = "entity_images"

    image_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False)
    entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    image_phase: Mapped[str] = mapped_column(String(30), nullable=False)
    media_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media.media_id", ondelete="SET NULL"),
        nullable=True,
    )
    caption: Mapped[str | None] = mapped_column(Text, nullable=True)
    date_taken: Mapped[date | None] = mapped_column(Date, nullable=True)
    taken_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        Index("ix_entity_images_org", "organization_id"),
        Index("ix_entity_images_entity", "entity_type", "entity_id"),
        Index("ix_entity_images_media", "media_id"),
        {"schema": "collections"},
    )


# ============================================================================
# COMPLIANCE ACTIONS - Polymorphic action/milestone/follow-up tracking
# ============================================================================

class ComplianceAction(Base):
    """Trackable action, milestone, or follow-up for any compliance entity."""
    __tablename__ = "compliance_actions"

    action_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False)
    entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    action_type: Mapped[str] = mapped_column(String(30), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    assigned_to: Mapped[str | None] = mapped_column(String(255), nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    completed_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    priority: Mapped[str | None] = mapped_column(String(20), nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        Index("ix_compliance_actions_org", "organization_id"),
        Index("ix_compliance_actions_entity", "entity_type", "entity_id"),
        Index("ix_compliance_actions_status", "organization_id", "status"),
        Index("ix_compliance_actions_due", "organization_id", "due_date"),
        {"schema": "collections"},
    )


# ============================================================================
# COMPLIANCE ISSUE ITEMS - Replace JSONB on audit_results
# ============================================================================

class ComplianceIssueItem(Base):
    """Individual issue found during an audit."""
    __tablename__ = "compliance_issue_items"

    issue_item_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    result_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.audit_results.result_id", ondelete="CASCADE"),
        nullable=False,
    )
    issue_type: Mapped[str] = mapped_column(String(30), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[str | None] = mapped_column(String(20), nullable=True)
    recommendation: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolved: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    resolved_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[datetime] = timestamp_now()

    result: Mapped["AuditResult"] = relationship(
        "AuditResult",
        back_populates="issue_items",
    )

    __table_args__ = (
        Index("ix_compliance_issues_org", "organization_id"),
        Index("ix_compliance_issues_result", "result_id"),
        Index("ix_compliance_issues_type", "issue_type"),
        {"schema": "collections"},
    )


__all__ = [
    "DocumentationPlan",
    "EmergencyPlan",
    "IncidentReport",
    "IncidentReportObject",
    "CollectionsReview",
    "ObjectReviewAssessment",
    "AuditCampaign",
    "AuditResult",
    "EmergencyRiskAssessment",
    "EmergencyPlanContact",
    "EmergencyExternalService",
    "EmergencyEvacuationRoute",
    "EmergencyAssemblyPoint",
    "EmergencyEquipment",
    "EntityImage",
    "ComplianceAction",
    "ComplianceIssueItem",
]
