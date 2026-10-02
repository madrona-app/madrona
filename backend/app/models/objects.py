from __future__ import annotations

"""Collection object models and related records."""

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
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models._helpers import uuid_pk, timestamp_now, timestamp_updated


# ============================================================================
# COLLECTION OBJECTS - Primary object records
# ============================================================================

class CollectionObject(Base):
    """
    Primary object record - the core of Collections.

    This is the main record that users create, edit, and manage.
    Designed to support the procedure cataloging requirements.

    Information Groups covered:
    - Object identification information
    - Object description information
    - Object production information
    - Object location information
    - Object history and association information
    - Object condition and technical assessment information
    - Rights information
    - Object valuation information
    """
    __tablename__ = "collection_objects"

    object_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # ══════════════════════════════════════════════════════════════════════
    # OBJECT IDENTIFICATION (procedures)
    # ══════════════════════════════════════════════════════════════════════

    object_number: Mapped[str] = mapped_column(String(100), nullable=False)
    # Other numbers - now stored in object_other_numbers link table
    # Legacy JSONB column removed; see ObjectOtherNumber model
    number_of_objects: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    # Object name
    object_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    object_name_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    object_name_language: Mapped[str | None] = mapped_column(String(10), nullable=True)

    # Titles - now stored in object_titles link table
    # Legacy JSONB column removed; see ObjectTitle model

    # Description
    brief_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    full_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    comments: Mapped[str | None] = mapped_column(Text, nullable=True)
    distinguishing_features: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Administrative
    responsible_department: Mapped[str | None] = mapped_column(String(100), nullable=True)
    department_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.departments.department_id", ondelete="SET NULL"),
        nullable=True,
    )

    # ══════════════════════════════════════════════════════════════════════
    # OBJECT DESCRIPTION (procedures)
    # ══════════════════════════════════════════════════════════════════════

    # Classification
    object_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Classifications - now stored in object_classifications link table
    # Legacy JSONB column removed; see ObjectClassification model
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Physical characteristics
    physical_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    color: Mapped[str | None] = mapped_column(String(255), nullable=True)
    form: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Materials & Techniques
    materials: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    techniques: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)

    # Measurements - now stored in object_measurements link table
    # Legacy JSONB column removed; see ObjectMeasurement model

    # Parts
    parts_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    components: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)

    # Edition (CDWA 10)
    edition: Mapped[str | None] = mapped_column(String(100), nullable=True)
    copy_number: Mapped[str | None] = mapped_column(String(50), nullable=True)
    edition_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    edition_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Print State (CDWA 9)
    state_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_states: Mapped[int | None] = mapped_column(Integer, nullable=True)
    state_description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Catalog Level (CDWA 1.1)
    catalog_level: Mapped[str | None] = mapped_column(String(20), nullable=True, default="item")

    # Orientation/Arrangement (CDWA 12)
    orientation: Mapped[str | None] = mapped_column(String(50), nullable=True)
    arrangement: Mapped[str | None] = mapped_column(Text, nullable=True)
    installation_instructions: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Age
    age: Mapped[str | None] = mapped_column(String(100), nullable=True)
    age_qualifier: Mapped[str | None] = mapped_column(String(50), nullable=True)
    age_unit: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Style
    style_period: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Technical
    technical_attributes: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)

    # ══════════════════════════════════════════════════════════════════════
    # INSCRIPTIONS & MARKS
    # ══════════════════════════════════════════════════════════════════════

    # Inscriptions - now stored in object_inscriptions link table
    # Legacy JSONB column removed; see ObjectInscription model

    # ══════════════════════════════════════════════════════════════════════
    # SUBJECT & CONTENT
    # ══════════════════════════════════════════════════════════════════════

    subjects: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    content_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    depicted_people: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    depicted_organizations: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    depicted_places: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    depicted_events: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    depicted_objects: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    depicted_activities: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    depicted_concepts: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)

    # ══════════════════════════════════════════════════════════════════════
    # OBJECT PRODUCTION (procedures)
    # ══════════════════════════════════════════════════════════════════════

    creators: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    creation_date_display: Mapped[str | None] = mapped_column(String(100), nullable=True)
    creation_date_earliest: Mapped[date | None] = mapped_column(Date, nullable=True)
    creation_date_latest: Mapped[date | None] = mapped_column(Date, nullable=True)
    creation_place: Mapped[str | None] = mapped_column(String(255), nullable=True)
    creation_place_details: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    production_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    production_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ══════════════════════════════════════════════════════════════════════
    # OBJECT HISTORY (procedures)
    # ══════════════════════════════════════════════════════════════════════

    provenance: Mapped[str | None] = mapped_column(Text, nullable=True)
    provenance_structured: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    exhibition_history: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    publication_history: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    object_history_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    usage: Mapped[str | None] = mapped_column(Text, nullable=True)
    usage_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Associations
    associated_events: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    associated_people: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    associated_organizations: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    associated_places: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    associated_concepts: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    associated_cultural_affinity: Mapped[str | None] = mapped_column(String(255), nullable=True)
    association_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Archaeological context (CDWA compliance)
    excavation_site: Mapped[str | None] = mapped_column(String(255), nullable=True)
    excavation_date: Mapped[str | None] = mapped_column(String(50), nullable=True)
    archaeological_context: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)  # stratum, findspot, excavation_unit
    field_collection_number: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # ══════════════════════════════════════════════════════════════════════
    # ACQUISITION (procedures)
    # ══════════════════════════════════════════════════════════════════════

    acquisition_method: Mapped[str | None] = mapped_column(String(50), nullable=True)
    acquisition_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    acquisition_source: Mapped[str | None] = mapped_column(String(255), nullable=True)
    acquisition_source_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    acquisition_cost: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    acquisition_currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    acquisition_funding_source: Mapped[str | None] = mapped_column(String(255), nullable=True)
    acquisition_provisos: Mapped[str | None] = mapped_column(Text, nullable=True)
    acquisition_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    acquisition_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    credit_line: Mapped[str | None] = mapped_column(String(500), nullable=True)
    accession_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # ══════════════════════════════════════════════════════════════════════
    # LOCATION (procedures)
    # ══════════════════════════════════════════════════════════════════════

    current_location_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.locations.location_id", ondelete="SET NULL"),
        nullable=True,
    )
    current_location_fitness: Mapped[str | None] = mapped_column(String(20), nullable=True)
    current_location_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    current_location_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    home_location_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.locations.location_id", ondelete="SET NULL"),
        nullable=True,
    )

    object_status: Mapped[str] = mapped_column(String(50), nullable=False, default="pending")

    # ══════════════════════════════════════════════════════════════════════
    # BARCODE & INVENTORY
    # ══════════════════════════════════════════════════════════════════════
    barcode: Mapped[str | None] = mapped_column(String(100), nullable=True)
    last_inventoried_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_inventoried_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # ══════════════════════════════════════════════════════════════════════
    # PUBLIC DISCOVERY
    # ══════════════════════════════════════════════════════════════════════
    is_discoverable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    discoverable_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    discoverable_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    # ══════════════════════════════════════════════════════════════════════
    # CONDITION (procedures)
    # ══════════════════════════════════════════════════════════════════════

    condition_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    completeness: Mapped[str | None] = mapped_column(String(20), nullable=True)
    completeness_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    conservation_priority: Mapped[str | None] = mapped_column(String(20), nullable=True)
    next_condition_check_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    hazards: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    salvage_priority: Mapped[str | None] = mapped_column(String(20), nullable=True)
    environmental_requirements: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    handling_requirements: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ══════════════════════════════════════════════════════════════════════
    # RIGHTS (procedures)
    # ══════════════════════════════════════════════════════════════════════
    # Rights management is handled by the ObjectRight model which provides
    # comprehensive tracking including copyright, reproduction, exhibition,
    # publication rights, and more. See ObjectRight for CDWA Category 22.

    # ══════════════════════════════════════════════════════════════════════
    # VALUATION (procedures)
    # ══════════════════════════════════════════════════════════════════════

    current_value: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    current_value_currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    current_value_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    insurance_value: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    insurance_value_currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    insurance_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    valuation_history: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)

    # ══════════════════════════════════════════════════════════════════════
    # CDWA EXTENDED FIELDS
    # ══════════════════════════════════════════════════════════════════════

    # Facture (CDWA 11) - Observations about construction/fabrication technique
    facture_description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Watermarks (CDWA 7.8) - For works on paper
    # Array of {identification, description, date_earliest, date_latest, briquet_number, location_on_work}
    watermarks: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)

    # Free-form key/value store for facts that have no column of their own —
    # bulk-action outputs such as cataloging status, loan availability and the
    # notes that accompany a status change. Named extra_metadata rather than
    # metadata because SQLAlchemy reserves that attribute on a declarative
    # model for the MetaData object; mirrors Media.extra_metadata.
    extra_metadata: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    # ══════════════════════════════════════════════════════════════════════
    # SOFT DELETE
    # ══════════════════════════════════════════════════════════════════════

    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # ══════════════════════════════════════════════════════════════════════
    # AUDIT
    # ══════════════════════════════════════════════════════════════════════

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

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="CollectionObject.organization_id == Organization.organization_id",
    )
    current_location: Mapped["Location | None"] = relationship(
        "Location",
        foreign_keys=[current_location_id],
    )
    home_location: Mapped["Location | None"] = relationship(
        "Location",
        foreign_keys=[home_location_id],
    )
    department: Mapped["Department | None"] = relationship(
        "Department",
        foreign_keys=[department_id],
    )
    created_by_user: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[created_by],
        primaryjoin="CollectionObject.created_by == User.user_id",
    )
    updated_by_user: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[updated_by],
        primaryjoin="CollectionObject.updated_by == User.user_id",
    )
    movements: Mapped[list["Movement"]] = relationship(
        "Movement",
        back_populates="object",
        foreign_keys="Movement.object_id",
        cascade="all, delete-orphan",
    )
    parts: Mapped[list["ObjectPart"]] = relationship(
        "ObjectPart",
        back_populates="object",
        cascade="all, delete-orphan",
        order_by="ObjectPart.display_order",
    )
    media_links: Mapped[list["CollectionObjectMedia"]] = relationship(
        "CollectionObjectMedia",
        primaryjoin="CollectionObject.object_id == CollectionObjectMedia.object_id",
        cascade="all, delete-orphan",
    )
    constituent_xrefs: Mapped[list["ConstituentXref"]] = relationship(
        "ConstituentXref",
        primaryjoin="and_(CollectionObject.object_id == foreign(ConstituentXref.entity_id), "
                    "ConstituentXref.entity_type == 'collection_object')",
        viewonly=True,
    )
    condition_reports: Mapped[list["ConditionReport"]] = relationship(
        "ConditionReport",
        back_populates="object",
        foreign_keys="ConditionReport.object_id",
        order_by="ConditionReport.report_date.desc()",
        viewonly=True,
    )
    acquisitions: Mapped[list["AcquisitionObject"]] = relationship(
        "AcquisitionObject",
        back_populates="object",
        cascade="all, delete-orphan",
    )
    material_links: Mapped[list["ObjectMaterial"]] = relationship(
        "ObjectMaterial",
        primaryjoin="CollectionObject.object_id == ObjectMaterial.object_id",
        back_populates="collection_object",
        cascade="all, delete-orphan",
    )
    technique_links: Mapped[list["ObjectTechnique"]] = relationship(
        "ObjectTechnique",
        primaryjoin="CollectionObject.object_id == ObjectTechnique.object_id",
        back_populates="collection_object",
        cascade="all, delete-orphan",
    )
    classification_links: Mapped[list["ObjectClassification"]] = relationship(
        "ObjectClassification",
        primaryjoin="CollectionObject.object_id == ObjectClassification.object_id",
        back_populates="collection_object",
        cascade="all, delete-orphan",
    )
    title_links: Mapped[list["ObjectTitle"]] = relationship(
        "ObjectTitle",
        primaryjoin="CollectionObject.object_id == ObjectTitle.object_id",
        back_populates="collection_object",
        cascade="all, delete-orphan",
        order_by="ObjectTitle.display_order",
    )
    other_number_links: Mapped[list["ObjectOtherNumber"]] = relationship(
        "ObjectOtherNumber",
        primaryjoin="CollectionObject.object_id == ObjectOtherNumber.object_id",
        back_populates="collection_object",
        cascade="all, delete-orphan",
        order_by="ObjectOtherNumber.display_order",
    )
    measurement_links: Mapped[list["ObjectMeasurement"]] = relationship(
        "ObjectMeasurement",
        primaryjoin="CollectionObject.object_id == ObjectMeasurement.object_id",
        back_populates="collection_object",
        cascade="all, delete-orphan",
        order_by="ObjectMeasurement.display_order",
    )
    inscription_links: Mapped[list["ObjectInscription"]] = relationship(
        "ObjectInscription",
        primaryjoin="CollectionObject.object_id == ObjectInscription.object_id",
        back_populates="collection_object",
        cascade="all, delete-orphan",
        order_by="ObjectInscription.display_order",
    )
    # Subject links defined in authorities.py (ObjectSubject -> SubjectAuthority)

    __table_args__ = (
        Index("ix_objects_org_number", "organization_id", "object_number", unique=True),
        Index("ix_objects_org_status", "organization_id", "object_status"),
        Index("ix_objects_org_type", "organization_id", "object_type"),
        Index("ix_objects_org_location", "organization_id", "current_location_id"),
        Index("ix_objects_org_department", "organization_id", "department_id"),
        Index("ix_objects_org_created", "organization_id", "created_at"),
        # Trigram indexes for the object search box, which builds
        # `%term%` ILIKE predicates. A leading wildcard cannot use a btree
        # index, so these searches were sequential scans of the whole
        # organization. GIN + gin_trgm_ops is the standard answer; the cost is
        # slower writes and a larger index, which for a catalogue that is read
        # far more than written is the right trade.
        Index("ix_objects_name_trgm", "object_name",
              postgresql_using="gin", postgresql_ops={"object_name": "gin_trgm_ops"}),
        Index("ix_objects_number_trgm", "object_number",
              postgresql_using="gin", postgresql_ops={"object_number": "gin_trgm_ops"}),
        CheckConstraint(
            "object_status IN ('pending', 'accessioned', 'on_loan', 'deaccessioned', 'missing', 'destroyed')",
            name="check_object_status",
        ),
        CheckConstraint(
            "conservation_priority IS NULL OR conservation_priority IN ('urgent', 'high', 'medium', 'low', 'none')",
            name="check_conservation_priority",
        ),
        CheckConstraint(
            "completeness IS NULL OR completeness IN ('complete', 'incomplete', 'fragment')",
            name="check_completeness",
        ),
        CheckConstraint(
            "current_location_fitness IS NULL OR current_location_fitness IN ('suitable', 'temporary', 'unsuitable')",
            name="check_obj_location_fitness",
        ),
        CheckConstraint(
            "acquisition_method IS NULL OR acquisition_method IN ('purchase', 'gift', 'bequest', 'transfer', 'exchange', 'field_collection', 'found_in_collection', 'unknown')",
            name="check_acquisition_method",
        ),
        CheckConstraint(
            "catalog_level IS NULL OR catalog_level IN ('item', 'group', 'collection', 'series', 'component', 'volume')",
            name="check_catalog_level",
        ),
        CheckConstraint(
            "orientation IS NULL OR orientation IN ('portrait', 'landscape', 'square', 'vertical', 'horizontal', 'variable', 'site_specific')",
            name="check_orientation",
        ),
        CheckConstraint(
            "salvage_priority IS NULL OR salvage_priority IN ('critical', 'high', 'medium', 'low')",
            name="check_salvage_priority",
        ),
        Index(
            "ix_objects_org_discoverable",
            "organization_id",
            postgresql_where=text("is_discoverable = true"),
        ),
        Index(
            "ix_objects_org_barcode",
            "organization_id",
            "barcode",
            unique=True,
            postgresql_where=text("barcode IS NOT NULL"),
        ),
        {"schema": "collections"},
    )


# ============================================================================
# CONDITION REPORTS - CDWA Category 14, Condition Checking
# ============================================================================

class ConditionReport(Base):
    """
    Condition assessment record.

    Implements CDWA Category 14 (Condition/Examination History) and
    Condition Checking and Technical Assessment procedure.
    """
    __tablename__ = "condition_reports"

    report_id: Mapped[uuid.UUID] = uuid_pk()
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
    report_number: Mapped[str] = mapped_column(String(50), nullable=False)
    report_type: Mapped[str] = mapped_column(String(30), nullable=False)
    check_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    report_date: Mapped[date] = mapped_column(Date, nullable=False)

    # Completeness (procedures)
    completeness: Mapped[str | None] = mapped_column(Text, nullable=True)
    completeness_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Next check
    next_check_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Examiner (CDWA 14.3) — a constituent reference (a staff constituent links
    # back to the user via Constituent.user_id), consistent with conservator/etc.
    examiner_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.constituents.constituent_id", ondelete="SET NULL"),
        nullable=True,
    )
    examiner_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    examiner_institution: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Object link
    object_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.collection_objects.object_id", ondelete="CASCADE"),
        nullable=True,
    )

    # Polymorphic link
    linked_entity_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    linked_entity_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    # Condition (CDWA 14.1)
    overall_condition: Mapped[str | None] = mapped_column(String(20), nullable=True)
    condition_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    detailed_findings: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)

    # Examination (CDWA 14.2)
    examination_method: Mapped[str | None] = mapped_column(String(50), nullable=True)
    examination_methods: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    examination_place: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Hazards
    hazards: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    hazard_summary: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Recommendations
    recommendations: Mapped[str | None] = mapped_column(Text, nullable=True)
    conservation_needed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    conservation_priority: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Requirements
    handling_requirements: Mapped[str | None] = mapped_column(Text, nullable=True)
    packing_requirements: Mapped[str | None] = mapped_column(Text, nullable=True)
    display_restrictions: Mapped[str | None] = mapped_column(Text, nullable=True)
    environmental_requirements: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    # Documentation
    image_references: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    diagram_references: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)

    # Previous report link
    previous_report_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.condition_reports.report_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Status
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    completed_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    reviewed_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Authorization (procedure compliance)
    authorizer_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.constituents.constituent_id", ondelete="SET NULL"),
        nullable=True,
    )
    authorization_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    authorization_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Task assignment
    assigned_to_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    # Remarks (CDWA 14.6)
    report_note: Mapped[str | None] = mapped_column(Text, nullable=True)

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
        primaryjoin="ConditionReport.organization_id == Organization.organization_id",
    )
    object: Mapped["CollectionObject | None"] = relationship(
        "CollectionObject",
        foreign_keys=[object_id],
        back_populates="condition_reports",
    )
    assigned_to: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[assigned_to_user_id],
    )
    department: Mapped["Department | None"] = relationship(
        "Department",
        foreign_keys=[department_id],
    )
    authorizer: Mapped["Constituent | None"] = relationship(
        "Constituent",
        foreign_keys=[authorizer_id],
    )

    __table_args__ = (
        Index("ix_condition_reports_org_number", "organization_id", "report_number", unique=True),
        Index("ix_condition_reports_object", "object_id"),
        Index("ix_condition_reports_org_dept", "organization_id", "department_id"),
        Index("ix_condition_reports_org_status", "organization_id", "status"),
        CheckConstraint(
            "report_type IN ('intake', 'loan_out', 'loan_in', 'loan_return', "
            "'periodic', 'conservation', 'incident', 'pre_treatment', 'post_treatment')",
            name="check_report_type",
        ),
        CheckConstraint(
            "overall_condition IS NULL OR overall_condition IN ('excellent', 'good', 'fair', 'poor', 'unacceptable')",
            name="check_report_overall_condition",
        ),
        CheckConstraint(
            "status IN ('draft', 'completed', 'reviewed', 'superseded')",
            name="check_report_status",
        ),
        {"schema": "collections"},
    )


# ============================================================================
# OBJECT RELATIONSHIPS - CDWA Category 20
# ============================================================================


class ObjectRelationship(Base):
    """
    Relationships between collection objects (CDWA Category 20).

    Tracks relationships between works such as:
    - Preparatory studies (drawings, sketches, models)
    - Copies and versions
    - Component parts of larger works
    - Pendants and pairs
    - Derivatives and adaptations

    CDWA Categories covered:
    - 20.1 Work relationship type
    - 20.2 Related work
    - 20.3 Relationship date
    - 20.4 Relationship remarks
    """
    __tablename__ = "object_relationships"

    relationship_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Source object (the object being described)
    source_object_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.collection_objects.object_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Related object (may be internal or external reference)
    related_object_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.collection_objects.object_id", ondelete="SET NULL"),
        nullable=True,
    )

    # For external works not in the collection
    related_work_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    related_work_title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    related_work_creator: Mapped[str | None] = mapped_column(String(255), nullable=True)
    related_work_location: Mapped[str | None] = mapped_column(String(500), nullable=True)
    related_work_identifier: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Relationship type (CDWA 20.1)
    relationship_type: Mapped[str] = mapped_column(String(50), nullable=False)

    # Relationship direction
    relationship_direction: Mapped[str] = mapped_column(String(10), nullable=False, default="forward")

    # Relationship date (CDWA 20.3)
    relationship_date_display: Mapped[str | None] = mapped_column(String(100), nullable=True)
    relationship_date_earliest: Mapped[date | None] = mapped_column(Date, nullable=True)
    relationship_date_latest: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Order/sequence (for multi-part works)
    sequence_number: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Remarks (CDWA 20.4)
    relationship_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Citation/source for the relationship
    source_citation: Mapped[str | None] = mapped_column(Text, nullable=True)

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
        primaryjoin="ObjectRelationship.organization_id == Organization.organization_id",
    )
    source_object: Mapped["CollectionObject"] = relationship(
        "CollectionObject",
        foreign_keys=[source_object_id],
    )
    related_object: Mapped["CollectionObject | None"] = relationship(
        "CollectionObject",
        foreign_keys=[related_object_id],
    )

    __table_args__ = (
        Index("ix_obj_rel_org", "organization_id"),
        Index("ix_obj_rel_source", "source_object_id"),
        Index("ix_obj_rel_related", "related_object_id"),
        Index("ix_obj_rel_type", "organization_id", "relationship_type"),
        CheckConstraint(
            "relationship_type IN ('study_for', 'preparatory_for', 'copy_of', 'copy_after', "
            "'version_of', 'variant_of', 'part_of', 'component_of', 'pendant_of', 'pair_with', "
            "'derived_from', 'based_on', 'model_for', 'depicts', 'depicted_in', "
            "'related_to', 'companion_to', 'counterpart_of', 'provenance_link')",
            name="check_obj_rel_type",
        ),
        CheckConstraint(
            "relationship_direction IN ('forward', 'reverse')",
            name="check_obj_rel_direction",
        ),
        {"schema": "collections"},
    )


# ============================================================================
# CITATIONS - CDWA Category 27
# ============================================================================


class Citation(Base):
    """
    Bibliographic citations and textual references (CDWA Category 27).

    Tracks published references to objects including:
    - Books and monographs
    - Exhibition catalogs
    - Journal articles
    - Websites and online resources
    - Unpublished manuscripts

    CDWA Categories covered:
    - 27.1 Type (type of reference)
    - 27.2 Brief citation
    - 27.3 Full citation
    - 27.4 Citation remarks
    """
    __tablename__ = "citations"

    citation_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Link to object (nullable - citations can exist as bibliography without object link)
    object_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.collection_objects.object_id", ondelete="CASCADE"),
        nullable=True,
    )

    # Citation type (CDWA 27.1)
    citation_type: Mapped[str] = mapped_column(String(50), nullable=False)

    # Brief citation (CDWA 27.2) - short form for display
    brief_citation: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Full citation (CDWA 27.3) - complete formatted citation
    full_citation: Mapped[str] = mapped_column(Text, nullable=False)

    # Structured fields for building citations
    author: Mapped[str | None] = mapped_column(String(500), nullable=True)
    editor: Mapped[str | None] = mapped_column(String(500), nullable=True)
    title: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    subtitle: Mapped[str | None] = mapped_column(String(500), nullable=True)
    publication: Mapped[str | None] = mapped_column(String(500), nullable=True)
    place_published: Mapped[str | None] = mapped_column(String(255), nullable=True)
    publisher: Mapped[str | None] = mapped_column(String(255), nullable=True)
    publication_date: Mapped[str | None] = mapped_column(String(50), nullable=True)
    publication_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    edition: Mapped[str | None] = mapped_column(String(100), nullable=True)
    volume: Mapped[str | None] = mapped_column(String(50), nullable=True)
    issue: Mapped[str | None] = mapped_column(String(50), nullable=True)
    pages: Mapped[str | None] = mapped_column(String(50), nullable=True)
    plate_number: Mapped[str | None] = mapped_column(String(50), nullable=True)
    catalog_number: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Digital identifiers
    url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    doi: Mapped[str | None] = mapped_column(String(255), nullable=True)
    isbn: Mapped[str | None] = mapped_column(String(50), nullable=True)
    issn: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # How the work is referenced
    works_cited: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    works_illustrated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    illustration_number: Mapped[str | None] = mapped_column(String(50), nullable=True)
    figure_number: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Citation remarks (CDWA 27.4)
    citation_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Access/verification
    verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    verified_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    access_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Display order
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

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
        primaryjoin="Citation.organization_id == Organization.organization_id",
    )
    object: Mapped["CollectionObject"] = relationship(
        "CollectionObject",
        foreign_keys=[object_id],
    )

    __table_args__ = (
        Index("ix_citations_org", "organization_id"),
        Index("ix_citations_object", "object_id"),
        Index("ix_citations_type", "organization_id", "citation_type"),
        Index("ix_citations_year", "organization_id", "publication_year"),
        CheckConstraint(
            "citation_type IN ('book', 'monograph', 'article', 'journal_article', "
            "'exhibition_catalog', 'collection_catalog', 'auction_catalog', "
            "'dissertation', 'thesis', 'website', 'database', 'unpublished', "
            "'correspondence', 'archival', 'newspaper', 'magazine', 'other')",
            name="check_citation_type",
        ),
        {"schema": "collections"},
    )


# ============================================================================
# OBJECT-CITATION LINKING - Many-to-many relationship
# ============================================================================


class ObjectCitation(Base):
    """
    Links collection objects to citations with additional context.

    Enables many-to-many relationships between objects and citations,
    allowing a single citation (e.g., a book) to reference multiple objects
    with specific page/figure references for each.
    """
    __tablename__ = "object_citations"

    link_id: Mapped[uuid.UUID] = uuid_pk()
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
    citation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.citations.citation_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Link-specific metadata (different from citation-level metadata)
    page_reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    figure_reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    plate_reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    catalog_number: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Link-specific flags
    works_cited: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    works_illustrated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Notes
    link_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="ObjectCitation.organization_id == Organization.organization_id",
    )
    object: Mapped["CollectionObject"] = relationship(
        "CollectionObject",
        foreign_keys=[object_id],
    )
    citation: Mapped["Citation"] = relationship(
        "Citation",
        foreign_keys=[citation_id],
    )

    __table_args__ = (
        UniqueConstraint("object_id", "citation_id", name="uq_object_citation"),
        Index("ix_object_citations_org", "organization_id"),
        Index("ix_object_citations_object", "object_id"),
        Index("ix_object_citations_citation", "citation_id"),
        {"schema": "collections"},
    )


# ============================================================================
# OBJECT RIGHTS - Procedure 18
# ============================================================================

class ObjectRight(Base):
    """
    Rights management for collection objects.

    Procedure 18 fields for copyright tracking, licensing,
    and orphan works due diligence compliance.
    """
    __tablename__ = "object_rights"

    right_id: Mapped[UUID] = uuid_pk()
    organization_id: Mapped[UUID] = mapped_column(
        ForeignKey("organizations.organization_id", ondelete="CASCADE"), nullable=False
    )
    object_id: Mapped[UUID] = mapped_column(
        ForeignKey("collections.collection_objects.object_id", ondelete="CASCADE"), nullable=False
    )

    # Right type
    right_type: Mapped[str] = mapped_column(String(30), nullable=False)
    right_subtype: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Rights holder - linked to Contact (person/organization you interact with for permissions)
    rights_holder_contact_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("collections.constituents.constituent_id", ondelete="SET NULL"), nullable=True
    )

    # Status
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="unknown")

    # Dates
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_perpetual: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Territory
    territory: Mapped[str | None] = mapped_column(String(100), nullable=True)
    territory_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # License details
    license_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    license_reference: Mapped[str | None] = mapped_column(String(255), nullable=True)
    license_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    usage_conditions: Mapped[str | None] = mapped_column(Text, nullable=True)
    restrictions: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Fees
    fee_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    fee_amount: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    fee_currency: Mapped[str | None] = mapped_column(String(3), nullable=True, default="USD")
    fee_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Orphan works (UK specific)
    is_orphan_work: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    due_diligence_conducted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    due_diligence_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    due_diligence_steps: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    orphan_works_license_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    orphan_works_license_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    orphan_works_license_expiry: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Permissions granted
    permissions_granted: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)

    # Documentation
    agreement_reference: Mapped[str | None] = mapped_column(String(255), nullable=True)
    documentation_references: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)

    # Review
    next_review_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_review_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Notes
    right_note: Mapped[str | None] = mapped_column(Text, nullable=True)
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
    object: Mapped["CollectionObject"] = relationship(
        "CollectionObject",
        foreign_keys=[object_id],
    )
    rights_holder_contact: Mapped["Constituent | None"] = relationship(
        "Constituent",
        foreign_keys=[rights_holder_contact_id],
    )

    __table_args__ = (
        Index("ix_rights_org", "organization_id"),
        Index("ix_rights_object", "object_id"),
        Index("ix_rights_type", "organization_id", "right_type"),
        Index("ix_rights_status", "organization_id", "status"),
        Index("ix_rights_holder_contact", "rights_holder_contact_id"),
        CheckConstraint(
            "right_type IN ('copyright', 'reproduction', 'exhibition', 'publication', 'broadcast', 'performance', 'adaptation', 'distribution', 'moral_rights', 'database_rights', 'trademark', 'other')",
            name="check_right_type",
        ),
        CheckConstraint(
            "status IN ('unknown', 'public_domain', 'owned', 'licensed', 'granted', 'requested', 'denied', 'expired', 'orphan', 'disputed')",
            name="check_right_status",
        ),
        {"schema": "collections"},
    )


# ============================================================================
# USE REQUESTS - Procedure 10
# ============================================================================

class UseRequest(Base):
    """
    Use of collections request for research, reproduction, exhibition, etc.

    Procedure 10 fields with approval workflow and outcome tracking.

    Workflow: submitted -> under_review -> approved | denied -> in_progress -> completed
    """
    __tablename__ = "use_requests"

    request_id: Mapped[UUID] = uuid_pk()
    organization_id: Mapped[UUID] = mapped_column(
        ForeignKey("organizations.organization_id", ondelete="CASCADE"), nullable=False
    )

    # Identification
    request_number: Mapped[str] = mapped_column(String(50), nullable=False)
    request_date: Mapped[date] = mapped_column(Date, nullable=False)

    # Use type
    use_type: Mapped[str] = mapped_column(String(30), nullable=False)
    use_subtype: Mapped[str | None] = mapped_column(String(50), nullable=True)
    use_purpose: Mapped[str] = mapped_column(Text, nullable=False)
    use_description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Requester
    requester_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    requester_name: Mapped[str] = mapped_column(String(255), nullable=False)
    requester_title: Mapped[str | None] = mapped_column(String(100), nullable=True)
    requester_institution: Mapped[str | None] = mapped_column(String(255), nullable=True)
    requester_address: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    requester_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    requester_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Request details
    access_dates_requested: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    access_date_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    access_date_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    location_required: Mapped[str | None] = mapped_column(String(100), nullable=True)
    special_requirements: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Project details
    project_title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    project_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    project_deadline: Mapped[date | None] = mapped_column(Date, nullable=True)
    funding_source: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Reproduction details
    reproduction_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    reproduction_quantity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reproduction_format: Mapped[str | None] = mapped_column(String(100), nullable=True)
    reproduction_dimensions: Mapped[str | None] = mapped_column(String(100), nullable=True)
    intended_use: Mapped[str | None] = mapped_column(Text, nullable=True)
    publication_details: Mapped[str | None] = mapped_column(Text, nullable=True)
    credit_line: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Exhibition details
    exhibition_title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    exhibition_venue: Mapped[str | None] = mapped_column(String(255), nullable=True)
    exhibition_dates: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    exhibition_organizer: Mapped[str | None] = mapped_column(String(255), nullable=True)
    insurance_value: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    insurance_currency: Mapped[str | None] = mapped_column(String(3), nullable=True, default="USD")

    # Review
    reviewed_by_id: Mapped[UUID | None] = mapped_column(
        "reviewed_by", ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    review_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Approval
    approved_by_id: Mapped[UUID | None] = mapped_column(
        "approved_by", ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    approval_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    approval_conditions: Mapped[str | None] = mapped_column(Text, nullable=True)
    denial_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Fees
    fee_quoted: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    fee_paid: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    fee_currency: Mapped[str | None] = mapped_column(String(3), nullable=True, default="USD")
    fee_waived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    fee_waiver_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    invoice_number: Mapped[str | None] = mapped_column(String(50), nullable=True)
    payment_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Fulfillment
    fulfilled_by_id: Mapped[UUID | None] = mapped_column(
        "fulfilled_by", ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    fulfillment_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    fulfillment_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Outcomes
    knowledge_gained: Mapped[str | None] = mapped_column(Text, nullable=True)
    publication_reference: Mapped[str | None] = mapped_column(Text, nullable=True)
    follow_up_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    follow_up_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Status
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="submitted")

    # Task assignment
    assigned_to_user_id: Mapped[UUID | None] = mapped_column(
        "assigned_to_user_id", ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    # Notes
    request_note: Mapped[str | None] = mapped_column(Text, nullable=True)
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
    requested_objects: Mapped[list["UseRequestObject"]] = relationship(
        "UseRequestObject",
        back_populates="request",
        cascade="all, delete-orphan",
    )
    assigned_to: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[assigned_to_user_id],
        primaryjoin="UseRequest.assigned_to_user_id == User.user_id",
    )

    __table_args__ = (
        Index("ix_use_requests_org_number", "organization_id", "request_number", unique=True),
        Index("ix_use_requests_org_status", "organization_id", "status"),
        Index("ix_use_requests_org_type", "organization_id", "use_type"),
        Index("ix_use_requests_requester", "requester_user_id"),
        CheckConstraint(
            "use_type IN ('research', 'exhibition', 'reproduction', 'education', 'publication', 'broadcast', 'commercial', 'conservation', 'loan', 'digitization', 'other')",
            name="check_use_type",
        ),
        CheckConstraint(
            "status IN ('submitted', 'under_review', 'approved', 'denied', 'in_progress', 'completed', 'cancelled', 'withdrawn')",
            name="check_use_request_status",
        ),
        {"schema": "collections"},
    )


class UseRequestObject(Base):
    """
    Links a use request to specific objects being requested.

    Tracks per-object approval status and fulfillment.
    """
    __tablename__ = "use_request_objects"

    request_object_id: Mapped[UUID] = uuid_pk()
    request_id: Mapped[UUID] = mapped_column(
        ForeignKey("collections.use_requests.request_id", ondelete="CASCADE"), nullable=False
    )
    organization_id: Mapped[UUID] = mapped_column(
        ForeignKey("organizations.organization_id", ondelete="CASCADE"), nullable=False
    )
    object_id: Mapped[UUID] = mapped_column(
        ForeignKey("collections.collection_objects.object_id", ondelete="CASCADE"), nullable=False
    )

    # Object-specific details
    object_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    special_handling: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Approval status (per-object)
    approved: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    approval_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    denial_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Fulfillment
    fulfilled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    fulfillment_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    fulfillment_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Reproduction details
    image_references: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    reproduction_completed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Condition check
    condition_checked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    condition_check_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    condition_report_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("collections.condition_reports.report_id", ondelete="SET NULL"), nullable=True
    )

    # Audit
    created_at: Mapped[datetime] = timestamp_now()

    # Relationships
    request: Mapped["UseRequest"] = relationship(
        "UseRequest",
        back_populates="requested_objects",
    )
    object: Mapped["CollectionObject"] = relationship(
        "CollectionObject",
        foreign_keys=[object_id],
    )

    __table_args__ = (
        Index("ix_use_request_objects_request", "request_id"),
        Index("ix_use_request_objects_object", "object_id"),
        Index("ix_use_request_objects_unique", "request_id", "object_id", unique=True),
        {"schema": "collections"},
    )


# ============================================================================
# VALUATION - Dedicated valuation tracking with history (Procedure 13)
# ============================================================================

class Valuation(Base):
    """
    Dedicated valuation tracking with history (Procedure 13).

    Provides formal valuation records separate from the basic valuation
    fields on CollectionObject. Used for:
    - Insurance valuations with documentation
    - Appraisals for loans and exhibitions
    - Market valuations for potential sales
    - Probate and donation valuations
    """
    __tablename__ = "valuations"

    valuation_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    object_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.collection_objects.object_id", ondelete="CASCADE"),
        nullable=True,  # Can be collection-level
    )

    # Valuation details
    valuation_type: Mapped[str] = mapped_column(String(30), nullable=False)  # insurance, market, replacement, probate, donation, internal
    valuation_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    valuation_currency: Mapped[str] = mapped_column(String(3), nullable=False, default="USD")
    valuation_date: Mapped[date] = mapped_column(Date, nullable=False)

    # Source - linked contact or free-text fields
    valuator_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.constituents.constituent_id", ondelete="SET NULL"),
        nullable=True,
    )
    valuator_name: Mapped[str | None] = mapped_column(String(255), nullable=True)  # Legacy/fallback
    valuator_organization: Mapped[str | None] = mapped_column(String(255), nullable=True)  # Legacy/fallback
    valuator_credentials: Mapped[str | None] = mapped_column(String(255), nullable=True)
    valuation_method: Mapped[str | None] = mapped_column(String(50), nullable=True)  # comparable_sales, replacement_cost, income_approach, expert_opinion

    # Documentation
    documentation_reference: Mapped[str | None] = mapped_column(String(255), nullable=True)
    valuation_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Authorization (procedure compliance)
    authorizer_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.constituents.constituent_id", ondelete="SET NULL"),
        nullable=True,
    )
    authorization_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    authorization_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Validity
    valid_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    valid_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

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

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="Valuation.organization_id == Organization.organization_id",
    )
    object: Mapped["CollectionObject | None"] = relationship(
        "CollectionObject",
        foreign_keys=[object_id],
    )
    valuator: Mapped["Constituent | None"] = relationship(
        "Constituent",
        foreign_keys=[valuator_id],
    )
    authorizer: Mapped["Constituent | None"] = relationship(
        "Constituent",
        foreign_keys=[authorizer_id],
    )

    __table_args__ = (
        Index("ix_valuations_org", "organization_id"),
        Index("ix_valuations_object", "object_id"),
        Index("ix_valuations_org_type", "organization_id", "valuation_type"),
        Index("ix_valuations_org_current", "organization_id", "is_current"),
        CheckConstraint(
            "valuation_type IN ('insurance', 'market', 'replacement', 'probate', 'donation', 'internal')",
            name="check_valuation_type",
        ),
        CheckConstraint(
            "valuation_method IS NULL OR valuation_method IN ('comparable_sales', 'replacement_cost', 'income_approach', 'expert_opinion', 'formula', 'hybrid')",
            name="check_valuation_method",
        ),
        {"schema": "collections"},
    )


# ============================================================================
# REPRODUCTION REQUESTS - Dedicated reproduction workflow (Procedure 19)
# ============================================================================

class ReproductionRequest(Base):
    """
    Reproduction requests with rights clearance (Procedure 19).

    Manages the workflow for reproduction requests including:
    - Rights clearance checking
    - Fee calculation
    - Fulfillment tracking
    - Credit line requirements
    """
    __tablename__ = "reproduction_requests"

    reproduction_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Request number
    request_number: Mapped[str] = mapped_column(String(50), nullable=False)

    # Link to use request (optional - can be standalone)
    use_request_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.use_requests.request_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Object being reproduced
    object_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.collection_objects.object_id", ondelete="CASCADE"),
        nullable=True,
    )

    # Requester
    requester_name: Mapped[str] = mapped_column(String(255), nullable=False)
    requester_institution: Mapped[str | None] = mapped_column(String(255), nullable=True)
    requester_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    requester_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Reproduction details
    reproduction_type: Mapped[str] = mapped_column(String(30), nullable=False)  # photograph, scan, cast, 3d_print, digital_copy, film, video
    reproduction_purpose: Mapped[str | None] = mapped_column(String(30), nullable=True)  # publication, exhibition, research, commercial, educational
    intended_use: Mapped[str | None] = mapped_column(Text, nullable=True)
    quantity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    format_requested: Mapped[str | None] = mapped_column(String(100), nullable=True)
    dimensions_requested: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Rights clearance
    rights_cleared: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    rights_check_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    rights_cleared_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    rights_restrictions: Mapped[str | None] = mapped_column(Text, nullable=True)
    credit_line_required: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Linked rights
    object_right_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.object_rights.right_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Fees
    fee_type: Mapped[str | None] = mapped_column(String(30), nullable=True)  # flat, per_image, commercial_rate, educational_rate, waived
    fee_amount: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    fee_currency: Mapped[str | None] = mapped_column(String(3), nullable=True, default="USD")
    fee_paid: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    payment_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Fulfillment
    master_file_reference: Mapped[str | None] = mapped_column(String(500), nullable=True)
    delivery_method: Mapped[str | None] = mapped_column(String(30), nullable=True)  # download, physical, api
    delivery_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    quality_approved: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    # Status
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="submitted")

    # Notes
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

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

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="ReproductionRequest.organization_id == Organization.organization_id",
    )
    object: Mapped["CollectionObject | None"] = relationship(
        "CollectionObject",
        foreign_keys=[object_id],
    )
    use_request: Mapped["UseRequest | None"] = relationship(
        "UseRequest",
        foreign_keys=[use_request_id],
    )

    __table_args__ = (
        Index("ix_reproduction_req_org", "organization_id"),
        Index("ix_reproduction_req_object", "object_id"),
        Index("ix_reproduction_req_org_status", "organization_id", "status"),
        UniqueConstraint("organization_id", "request_number", name="uq_reproduction_req_number"),
        CheckConstraint(
            "reproduction_type IN ('photograph', 'scan', 'cast', '3d_print', 'digital_copy', 'film', 'video', 'other')",
            name="check_reproduction_type",
        ),
        CheckConstraint(
            "status IN ('submitted', 'rights_review', 'approved', 'denied', 'in_production', 'delivered', 'completed', 'cancelled')",
            name="check_reproduction_status",
        ),
        {"schema": "collections"},
    )


# ============================================================================
# CRITICAL RESPONSES - Scholarly commentary records (CDWA 19)
# ============================================================================

class CriticalResponse(Base):
    """
    Critical Response/Scholarly Commentary Record (CDWA Category 19).

    Records scholarly and critical commentary about works of art.
    Links to citations for source documentation.

    CDWA Categories covered:
    - 19.1 Comment Text (quotation or paraphrase)
    - 19.2 Comment Source (citation)
    - 19.3 Comment Date
    - 19.4 Commentator (author)
    """
    __tablename__ = "critical_responses"

    response_id: Mapped[uuid.UUID] = uuid_pk()
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

    # Comment content
    comment_text: Mapped[str] = mapped_column(Text, nullable=False)
    comment_summary: Mapped[str | None] = mapped_column(String(500), nullable=True)
    document_type: Mapped[str] = mapped_column(String(50), nullable=False, default="essay")

    # Author
    author_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    author_authority_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.constituents.constituent_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Date
    comment_date_display: Mapped[str | None] = mapped_column(String(100), nullable=True)
    comment_date_earliest: Mapped[date | None] = mapped_column(Date, nullable=True)
    comment_date_latest: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Context
    circumstances: Mapped[str | None] = mapped_column(Text, nullable=True)
    publication_info: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Source
    citation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.citations.citation_id", ondelete="SET NULL"),
        nullable=True,
    )
    source_page: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Administrative
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

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
        primaryjoin="CriticalResponse.organization_id == Organization.organization_id",
    )
    collection_object: Mapped["CollectionObject"] = relationship(
        "CollectionObject",
        primaryjoin="CriticalResponse.object_id == CollectionObject.object_id",
    )
    author_authority: Mapped["Constituent | None"] = relationship(
        "Constituent",
        foreign_keys=[author_authority_id],
    )
    citation: Mapped["Citation | None"] = relationship(
        "Citation",
        foreign_keys=[citation_id],
    )

    __table_args__ = (
        Index("ix_critical_responses_org", "organization_id"),
        Index("ix_critical_responses_object", "object_id"),
        Index("ix_critical_responses_author", "author_authority_id"),
        Index("ix_critical_responses_citation", "citation_id"),
        CheckConstraint(
            "document_type IN ('essay', 'review', 'catalog_entry', 'diary', 'letter', "
            "'lecture', 'interview', 'article', 'book', 'other')",
            name="check_document_type",
        ),
        {"schema": "collections"},
    )


# ============================================================================
# CATALOGING HISTORY - Record change tracking (CDWA 25)
# ============================================================================

class CatalogingHistory(Base):
    """
    Cataloging History Record (CDWA Category 25).

    Tracks the history of changes to collection object records.
    Immutable audit trail for scholarly and legal accountability.

    CDWA Categories covered:
    - 25.1 Cataloger (who made changes)
    - 25.2 Catalog Date (when)
    - 25.3 Record Type (type of change)
    - 25.4 Changes (what was modified)
    """
    __tablename__ = "cataloging_history"

    history_id: Mapped[uuid.UUID] = uuid_pk()
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

    # Cataloger info
    cataloger_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    cataloger_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    institution: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Record info
    catalog_date: Mapped[datetime] = timestamp_now()
    catalog_language: Mapped[str | None] = mapped_column(String(10), nullable=True)
    record_type: Mapped[str] = mapped_column(String(30), nullable=False, default="update")

    # Change tracking
    fields_modified: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    change_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    previous_values: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    # Administrative
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Audit (created_at only, these are immutable records)
    created_at: Mapped[datetime] = timestamp_now()

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="CatalogingHistory.organization_id == Organization.organization_id",
    )
    collection_object: Mapped["CollectionObject"] = relationship(
        "CollectionObject",
        primaryjoin="CatalogingHistory.object_id == CollectionObject.object_id",
    )
    cataloger: Mapped["User | None"] = relationship(
        "User",
        primaryjoin="CatalogingHistory.cataloger_id == User.user_id",
    )

    __table_args__ = (
        Index("ix_cataloging_history_org", "organization_id"),
        Index("ix_cataloging_history_object", "object_id"),
        Index("ix_cataloging_history_date", "catalog_date"),
        Index("ix_cataloging_history_cataloger", "cataloger_id"),
        CheckConstraint(
            "record_type IN ('initial', 'update', 'revision', 'migration', 'merge', 'split')",
            name="check_catalog_record_type",
        ),
        {"schema": "collections"},
    )


# ============================================================================
# OBJECT CONTEXTS - Architectural and historical context (CDWA 17)
# ============================================================================

class ObjectContext(Base):
    """
    Object Context Record (CDWA Category 17).

    Records architectural, historical, and event contexts for objects.
    Links to place authorities and events for structured data.

    CDWA Categories covered:
    - 17.1 Event Context (related events)
    - 17.2 Architectural Context (original setting)
    - 17.4 Historical Location (where it was historically)
    """
    __tablename__ = "object_contexts"

    context_id: Mapped[uuid.UUID] = uuid_pk()
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

    # Context type
    context_type: Mapped[str] = mapped_column(String(50), nullable=False)

    # Architectural context (CDWA 17.2)
    building_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    site_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    part_placement: Mapped[str | None] = mapped_column(String(255), nullable=True)
    architectural_date_display: Mapped[str | None] = mapped_column(String(100), nullable=True)
    architectural_date_earliest: Mapped[date | None] = mapped_column(Date, nullable=True)
    architectural_date_latest: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Historical location (CDWA 17.4)
    historical_place_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.place_authorities.place_authority_id", ondelete="SET NULL"),
        nullable=True,
    )
    historical_date_display: Mapped[str | None] = mapped_column(String(100), nullable=True)
    historical_date_earliest: Mapped[date | None] = mapped_column(Date, nullable=True)
    historical_date_latest: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Event context (CDWA 17.1)
    event_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.events.event_id", ondelete="SET NULL"),
        nullable=True,
    )
    event_description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Administrative
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

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
        primaryjoin="ObjectContext.organization_id == Organization.organization_id",
    )
    collection_object: Mapped["CollectionObject"] = relationship(
        "CollectionObject",
        primaryjoin="ObjectContext.object_id == CollectionObject.object_id",
    )
    historical_place: Mapped["PlaceAuthority | None"] = relationship(
        "PlaceAuthority",
        foreign_keys=[historical_place_id],
    )
    event: Mapped["Event | None"] = relationship(
        "Event",
        foreign_keys=[event_id],
    )

    __table_args__ = (
        Index("ix_object_contexts_org", "organization_id"),
        Index("ix_object_contexts_object", "object_id"),
        Index("ix_object_contexts_place", "historical_place_id"),
        Index("ix_object_contexts_event", "event_id"),
        CheckConstraint(
            "context_type IN ('architectural', 'historical_location', 'event', 'archaeological', 'original_site')",
            name="check_context_type",
        ),
        {"schema": "collections"},
    )


# ============================================================================
# OBJECT MATERIALS - Links objects to AAT material vocabulary terms
# ============================================================================


class ObjectMaterial(Base):
    """
    Links collection objects to AAT material vocabulary terms.

    Replaces the JSONB materials[] field with proper relational data
    for CDWA-compliant material tracking.

    CDWA Categories covered:
    - 11.1 Materials and Techniques Description (Materials portion)
    """
    __tablename__ = "object_materials"

    link_id: Mapped[uuid.UUID] = uuid_pk()
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
    vocabulary_term_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.vocabulary_terms.term_id", ondelete="RESTRICT"),
        nullable=False,
    )

    # Material context
    part: Mapped[str | None] = mapped_column(String(255), nullable=True)  # Which part of object (e.g., "support", "medium")
    extent: Mapped[str | None] = mapped_column(String(255), nullable=True)  # Extent of use
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Display
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="ObjectMaterial.organization_id == Organization.organization_id",
    )
    collection_object: Mapped["CollectionObject"] = relationship(
        "CollectionObject",
        primaryjoin="ObjectMaterial.object_id == CollectionObject.object_id",
        back_populates="material_links",
    )
    vocabulary_term: Mapped["VocabularyTerm"] = relationship(
        "VocabularyTerm",
        foreign_keys=[vocabulary_term_id],
    )

    __table_args__ = (
        UniqueConstraint('organization_id', 'object_id', 'vocabulary_term_id', 'part',
                         name='uq_object_material_term_part'),
        Index("ix_object_materials_org", "organization_id"),
        Index("ix_object_materials_object", "object_id"),
        Index("ix_object_materials_term", "vocabulary_term_id"),
        {"schema": "collections"},
    )


# ============================================================================
# OBJECT TECHNIQUES - Links objects to AAT technique vocabulary terms
# ============================================================================


class ObjectTechnique(Base):
    """
    Links collection objects to AAT technique vocabulary terms.

    Replaces the JSONB techniques[] field with proper relational data
    for CDWA-compliant technique tracking.

    CDWA Categories covered:
    - 11.1 Materials and Techniques Description (Techniques portion)
    """
    __tablename__ = "object_techniques"

    link_id: Mapped[uuid.UUID] = uuid_pk()
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
    vocabulary_term_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.vocabulary_terms.term_id", ondelete="RESTRICT"),
        nullable=False,
    )

    # Technique context
    part: Mapped[str | None] = mapped_column(String(255), nullable=True)  # Which part of object
    extent: Mapped[str | None] = mapped_column(String(255), nullable=True)  # Extent of use
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Display
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="ObjectTechnique.organization_id == Organization.organization_id",
    )
    collection_object: Mapped["CollectionObject"] = relationship(
        "CollectionObject",
        primaryjoin="ObjectTechnique.object_id == CollectionObject.object_id",
        back_populates="technique_links",
    )
    vocabulary_term: Mapped["VocabularyTerm"] = relationship(
        "VocabularyTerm",
        foreign_keys=[vocabulary_term_id],
    )

    __table_args__ = (
        UniqueConstraint('organization_id', 'object_id', 'vocabulary_term_id', 'part',
                         name='uq_object_technique_term_part'),
        Index("ix_object_techniques_org", "organization_id"),
        Index("ix_object_techniques_object", "object_id"),
        Index("ix_object_techniques_term", "vocabulary_term_id"),
        {"schema": "collections"},
    )


class ObjectClassification(Base):
    """
    Links collection objects to classification lookup values.

    Replaces the JSONB classifications[] field with proper relational data.
    Each object can have multiple classifications from the 'classification' lookup category.
    """
    __tablename__ = "object_classifications"

    link_id: Mapped[uuid.UUID] = uuid_pk()
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
    value_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.lookup_values.value_id", ondelete="RESTRICT"),
        nullable=False,
    )

    # Display
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="ObjectClassification.organization_id == Organization.organization_id",
    )
    collection_object: Mapped["CollectionObject"] = relationship(
        "CollectionObject",
        primaryjoin="ObjectClassification.object_id == CollectionObject.object_id",
        back_populates="classification_links",
    )
    lookup_value: Mapped["LookupValue"] = relationship(
        "LookupValue",
        foreign_keys=[value_id],
    )

    __table_args__ = (
        UniqueConstraint('organization_id', 'object_id', 'value_id',
                         name='uq_object_classification_value'),
        Index("ix_object_classifications_org", "organization_id"),
        Index("ix_object_classifications_object", "object_id"),
        Index("ix_object_classifications_value", "value_id"),
        {"schema": "collections"},
    )


# ============================================================================
# OBJECT TITLES - Structured title records for objects
# ============================================================================


class ObjectTitle(Base):
    """
    Structured title record for a collection object.

    Replaces the JSONB titles[] field. Each object can have multiple titles
    with type, language, and preferred flag.
    """
    __tablename__ = "object_titles"

    link_id: Mapped[uuid.UUID] = uuid_pk()
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

    title: Mapped[str] = mapped_column(Text, nullable=False)
    title_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    language: Mapped[str | None] = mapped_column(String(10), nullable=True)
    is_preferred: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    collection_object: Mapped["CollectionObject"] = relationship(
        "CollectionObject",
        primaryjoin="ObjectTitle.object_id == CollectionObject.object_id",
        back_populates="title_links",
    )

    __table_args__ = (
        Index("ix_object_titles_org", "organization_id"),
        Index("ix_object_titles_object", "object_id"),
        {"schema": "collections"},
    )


# ============================================================================
# OBJECT OTHER NUMBERS - Alternate identifier records
# ============================================================================


class ObjectOtherNumber(Base):
    """
    Alternate identifier for a collection object.

    Replaces the JSONB other_numbers[] field. Each record links to an
    OtherNumberType for the type classification.
    """
    __tablename__ = "object_other_numbers"

    link_id: Mapped[uuid.UUID] = uuid_pk()
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

    number_type: Mapped[str] = mapped_column(String(100), nullable=False)
    number_value: Mapped[str] = mapped_column(String(255), nullable=False)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    collection_object: Mapped["CollectionObject"] = relationship(
        "CollectionObject",
        primaryjoin="ObjectOtherNumber.object_id == CollectionObject.object_id",
        back_populates="other_number_links",
    )

    __table_args__ = (
        Index("ix_object_other_numbers_org", "organization_id"),
        Index("ix_object_other_numbers_object", "object_id"),
        {"schema": "collections"},
    )


# ============================================================================
# OBJECT MEASUREMENTS - Structured dimension records
# ============================================================================


class ObjectMeasurement(Base):
    """
    Structured measurement/dimension record for a collection object.

    Replaces the JSONB measurements[] field.
    Each record stores a single dimension (height, width, depth, weight, etc.)
    with value, unit, and optional part reference.
    """
    __tablename__ = "object_measurements"

    link_id: Mapped[uuid.UUID] = uuid_pk()
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

    dimension: Mapped[str] = mapped_column(String(50), nullable=False)
    value: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False)
    unit: Mapped[str] = mapped_column(String(20), nullable=False)
    part: Mapped[str | None] = mapped_column(String(255), nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    collection_object: Mapped["CollectionObject"] = relationship(
        "CollectionObject",
        primaryjoin="ObjectMeasurement.object_id == CollectionObject.object_id",
        back_populates="measurement_links",
    )

    __table_args__ = (
        Index("ix_object_measurements_org", "organization_id"),
        Index("ix_object_measurements_object", "object_id"),
        {"schema": "collections"},
    )


# ============================================================================
# OBJECT INSCRIPTIONS - Inscription/marking records
# ============================================================================


class ObjectInscription(Base):
    """
    Inscription or marking on a collection object.

    Replaces the JSONB inscriptions[] field.
    Stores the inscription content with optional type, location, and method.
    """
    __tablename__ = "object_inscriptions"

    link_id: Mapped[uuid.UUID] = uuid_pk()
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

    content: Mapped[str] = mapped_column(Text, nullable=False)
    inscription_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    location_on_object: Mapped[str | None] = mapped_column(String(255), nullable=True)
    method: Mapped[str | None] = mapped_column(String(100), nullable=True)
    language: Mapped[str | None] = mapped_column(String(10), nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    collection_object: Mapped["CollectionObject"] = relationship(
        "CollectionObject",
        primaryjoin="ObjectInscription.object_id == CollectionObject.object_id",
        back_populates="inscription_links",
    )

    __table_args__ = (
        Index("ix_object_inscriptions_org", "organization_id"),
        Index("ix_object_inscriptions_object", "object_id"),
        {"schema": "collections"},
    )


__all__ = [
    "CollectionObject",
    "ConditionReport",
    "ObjectRelationship",
    "Citation",
    "ObjectCitation",
    "ObjectRight",
    "UseRequest",
    "UseRequestObject",
    "Valuation",
    "ReproductionRequest",
    "CriticalResponse",
    "CatalogingHistory",
    "ObjectContext",
    "ObjectMaterial",
    "ObjectTechnique",
    "ObjectClassification",
    "ObjectTitle",
    "ObjectOtherNumber",
    "ObjectMeasurement",
    "ObjectInscription",
]
