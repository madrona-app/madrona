from __future__ import annotations

"""Logistics models: crates, shipments, barcodes."""

import uuid
from datetime import date, datetime, time
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
    Time,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from geoalchemy2 import Geometry

from app.database import Base
from app.models._helpers import uuid_pk, timestamp_now, timestamp_updated


# ============================================================================
# CRATES - Reusable shipping/storage containers
# ============================================================================

class Crate(Base):
    """
    Physical shipping/storage container tracked as a reusable asset.

    Museums maintain inventories of custom-built crates for protecting objects
    during transport and storage. Each crate has dimensions, condition, location
    tracking, and climate control capability.

    Equivalent to TMS Crates table.
    """
    __tablename__ = "crates"

    crate_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Identification
    crate_number: Mapped[str] = mapped_column(String(50), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Exterior dimensions
    height_cm: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    width_cm: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    depth_cm: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    weight_empty_kg: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)

    # Interior (usable) dimensions
    interior_height_cm: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    interior_width_cm: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    interior_depth_cm: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)

    # Construction & condition
    materials: Mapped[str | None] = mapped_column(String(255), nullable=True)
    condition: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Features
    climate_controlled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_stackable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_oversized: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Location tracking
    location_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.locations.location_id", ondelete="SET NULL"),
        nullable=True,
    )
    home_location_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.locations.location_id", ondelete="SET NULL"),
        nullable=True,
    )

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
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
    location: Mapped["Location | None"] = relationship(
        "Location", foreign_keys=[location_id],
    )
    home_location: Mapped["Location | None"] = relationship(
        "Location", foreign_keys=[home_location_id],
    )

    __table_args__ = (
        UniqueConstraint("organization_id", "crate_number", name="uq_crates_org_number"),
        Index("ix_crates_org", "organization_id"),
        Index("ix_crates_location", "location_id"),
        Index("ix_crates_home_location", "home_location_id"),
        CheckConstraint(
            "condition IS NULL OR condition IN ('good', 'fair', 'poor', 'damaged')",
            name="check_crate_condition",
        ),
        {"schema": "collections"},
    )


# ============================================================================
# SHIPMENTS - Transport logistics
# ============================================================================

class Shipment(Base):
    """
    Logistics record for transporting objects between locations.

    A shipment groups one or more objects (ShipmentItem) being transported
    together, optionally via multiple legs (ShipmentLeg) with different
    carriers. Links to originating procedures (loans, exits, exhibitions)
    via ShipmentReference.

    Equivalent to TMS Shipments table.
    """
    __tablename__ = "shipments"

    shipment_id: Mapped[uuid.UUID] = uuid_pk()
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
    shipment_number: Mapped[str] = mapped_column(String(50), nullable=False)
    shipment_type: Mapped[str] = mapped_column(String(30), nullable=False)
    direction: Mapped[str | None] = mapped_column(String(20), nullable=True)
    purpose: Mapped[str | None] = mapped_column(String(30), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")

    # Origin
    ship_from_contact_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.constituents.constituent_id", ondelete="SET NULL"),
        nullable=True,
    )
    ship_from_location_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.locations.location_id", ondelete="SET NULL"),
        nullable=True,
    )
    ship_from_address: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    origin_geom = mapped_column(Geometry(geometry_type="POINT", srid=4326), nullable=True)

    # Destination
    ship_to_contact_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.constituents.constituent_id", ondelete="SET NULL"),
        nullable=True,
    )
    ship_to_location_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.locations.location_id", ondelete="SET NULL"),
        nullable=True,
    )
    ship_to_address: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    destination_geom = mapped_column(Geometry(geometry_type="POINT", srid=4326), nullable=True)

    # Dates (estimated vs actual)
    requested_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    estimated_dispatch_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    estimated_arrival_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    actual_dispatch_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    actual_arrival_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Insurance (shipment-level total)
    insurance_value_total: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    insurance_currency: Mapped[str | None] = mapped_column(String(3), nullable=True, default="USD")
    insurance_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Courier (overall flag — per-leg carriers go on ShipmentLeg)
    courier_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Authorization
    authorized_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    authorization_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Flags
    is_international: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_high_value: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    internal_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

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
    department: Mapped["Department | None"] = relationship(
        "Department", foreign_keys=[department_id],
    )
    ship_from_contact: Mapped["Constituent | None"] = relationship(
        "Constituent", foreign_keys=[ship_from_contact_id],
    )
    ship_to_contact: Mapped["Constituent | None"] = relationship(
        "Constituent", foreign_keys=[ship_to_contact_id],
    )
    ship_from_location: Mapped["Location | None"] = relationship(
        "Location", foreign_keys=[ship_from_location_id],
    )
    ship_to_location: Mapped["Location | None"] = relationship(
        "Location", foreign_keys=[ship_to_location_id],
    )
    legs: Mapped[list["ShipmentLeg"]] = relationship(
        "ShipmentLeg", back_populates="shipment",
        cascade="all, delete-orphan", order_by="ShipmentLeg.leg_number",
    )
    items: Mapped[list["ShipmentItem"]] = relationship(
        "ShipmentItem", back_populates="shipment",
        cascade="all, delete-orphan",
    )
    references: Mapped[list["ShipmentReference"]] = relationship(
        "ShipmentReference", back_populates="shipment",
        cascade="all, delete-orphan",
    )
    status_history: Mapped[list["ShipmentStatusHistory"]] = relationship(
        "ShipmentStatusHistory", back_populates="shipment",
        cascade="all, delete-orphan", order_by="ShipmentStatusHistory.changed_at.desc()",
    )
    documents: Mapped[list["ShipmentDocument"]] = relationship(
        "ShipmentDocument", back_populates="shipment",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        UniqueConstraint("organization_id", "shipment_number", name="uq_shipments_org_number"),
        Index("ix_shipments_org_dept", "organization_id", "department_id"),
        Index("ix_shipments_status", "organization_id", "status"),
        Index("ix_shipments_direction", "organization_id", "direction"),
        CheckConstraint(
            "shipment_type IN ('outbound', 'return', 'internal_transfer', 'courier_delivery')",
            name="check_shipment_type",
        ),
        CheckConstraint(
            "direction IS NULL OR direction IN ('inbound', 'outbound')",
            name="check_shipment_direction",
        ),
        CheckConstraint(
            "purpose IS NULL OR purpose IN ('loan', 'exhibition', 'conservation', "
            "'acquisition', 'repatriation', 'other')",
            name="check_shipment_purpose",
        ),
        CheckConstraint(
            "status IN ('draft', 'confirmed', 'dispatched', 'in_transit', "
            "'delayed', 'delivered', 'completed', 'cancelled')",
            name="check_shipment_status",
        ),
        {"schema": "collections"},
    )


class ShipmentLeg(Base):
    """
    Individual leg of a multi-leg shipment journey.

    A direct courier delivery is 1 leg. A complex route (truck -> plane -> truck)
    is 3 legs. Each leg tracks its own carrier, method, departure/arrival, and
    tracking number.

    Equivalent to TMS ShipmentSteps table.
    """
    __tablename__ = "shipment_legs"

    leg_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    shipment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.shipments.shipment_id", ondelete="CASCADE"),
        nullable=False,
    )

    leg_number: Mapped[int] = mapped_column(Integer, nullable=False)

    # Method & carrier
    shipping_method: Mapped[str | None] = mapped_column(String(30), nullable=True)
    carrier_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.constituents.constituent_id", ondelete="SET NULL"),
        nullable=True,
    )
    carrier_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    tracking_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    flight_vessel_number: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Departure
    departure_location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    departure_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    departure_time: Mapped[time | None] = mapped_column(Time, nullable=True)

    # Arrival
    arrival_location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    arrival_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    arrival_time: Mapped[time | None] = mapped_column(Time, nullable=True)

    climate_controlled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="scheduled")
    instructions: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Cost
    cost: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    cost_currency: Mapped[str | None] = mapped_column(String(3), nullable=True, default="USD")

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
    shipment: Mapped["Shipment"] = relationship("Shipment", back_populates="legs")
    carrier: Mapped["Constituent | None"] = relationship("Constituent", foreign_keys=[carrier_id])

    __table_args__ = (
        UniqueConstraint("shipment_id", "leg_number", name="uq_shipment_legs_order"),
        Index("ix_shipment_legs_shipment", "shipment_id"),
        CheckConstraint(
            "shipping_method IS NULL OR shipping_method IN "
            "('air', 'ground', 'sea', 'courier', 'hand_carry')",
            name="check_shipping_method",
        ),
        CheckConstraint(
            "status IN ('scheduled', 'in_transit', 'arrived')",
            name="check_leg_status",
        ),
        {"schema": "collections"},
    )


class ShipmentItem(Base):
    """
    Individual object within a shipment, optionally packed in a crate.

    Per-item tracking of insurance value, status, and condition at
    departure/arrival. Links to condition reports for formal assessment.

    Equivalent to TMS ShipObjXrefs + ShipCompXrefs.
    """
    __tablename__ = "shipment_items"

    shipment_item_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    shipment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.shipments.shipment_id", ondelete="CASCADE"),
        nullable=False,
    )
    object_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.collection_objects.object_id", ondelete="CASCADE"),
        nullable=False,
    )
    part_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.object_parts.part_id", ondelete="SET NULL"),
        nullable=True,
    )
    crate_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.crates.crate_id", ondelete="SET NULL"),
        nullable=True,
    )

    item_number: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Per-item insurance
    insurance_value: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    insurance_currency: Mapped[str | None] = mapped_column(String(3), nullable=True, default="USD")

    # Per-item status
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")

    # Condition at departure and arrival
    condition_out_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    condition_in_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    condition_report_out_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.condition_reports.report_id", ondelete="SET NULL"),
        nullable=True,
    )
    condition_report_in_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.condition_reports.report_id", ondelete="SET NULL"),
        nullable=True,
    )

    special_instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
    packing_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

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
    shipment: Mapped["Shipment"] = relationship("Shipment", back_populates="items")
    object: Mapped["CollectionObject"] = relationship("CollectionObject", foreign_keys=[object_id])
    part: Mapped["ObjectPart | None"] = relationship("ObjectPart", foreign_keys=[part_id])
    crate: Mapped["Crate | None"] = relationship("Crate", foreign_keys=[crate_id])
    condition_report_out: Mapped["ConditionReport | None"] = relationship(
        "ConditionReport", foreign_keys=[condition_report_out_id],
    )
    condition_report_in: Mapped["ConditionReport | None"] = relationship(
        "ConditionReport", foreign_keys=[condition_report_in_id],
    )

    __table_args__ = (
        Index("ix_shipment_items_shipment", "shipment_id"),
        Index("ix_shipment_items_object", "object_id"),
        Index("ix_shipment_items_crate", "crate_id"),
        CheckConstraint(
            "status IN ('pending', 'packed', 'dispatched', 'in_transit', 'delivered')",
            name="check_shipment_item_status",
        ),
        {"schema": "collections"},
    )


class ShipmentReference(Base):
    """
    Links shipments to originating procedures (loans, exits, exhibitions).

    Many-to-many: one shipment can serve multiple procedures (e.g., returning
    objects from 3 different loans), and one procedure can have multiple
    shipments (e.g., outbound + return shipments for a loan).

    Equivalent to TMS ShipLoanXrefs + ShipExhXrefs.
    """
    __tablename__ = "shipment_references"

    reference_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    shipment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.shipments.shipment_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Polymorphic reference to procedure
    procedure_type: Mapped[str] = mapped_column(String(30), nullable=False)
    procedure_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)

    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    shipment: Mapped["Shipment"] = relationship("Shipment", back_populates="references")

    __table_args__ = (
        UniqueConstraint("shipment_id", "procedure_type", "procedure_id",
                         name="uq_shipment_ref_procedure"),
        Index("ix_shipment_refs_shipment", "shipment_id"),
        Index("ix_shipment_refs_procedure", "procedure_type", "procedure_id"),
        CheckConstraint(
            "procedure_type IN ('loan_out', 'loan_in', 'object_exit', 'object_entry', "
            "'exhibition_venue', 'deaccession')",
            name="check_shipment_ref_procedure_type",
        ),
        {"schema": "collections"},
    )


class ShipmentStatusHistory(Base):
    """
    Audit trail of shipment status changes.

    Each status transition is recorded with timestamp, user, and optional notes.
    """
    __tablename__ = "shipment_status_history"

    history_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    shipment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.shipments.shipment_id", ondelete="CASCADE"),
        nullable=False,
    )

    status: Mapped[str] = mapped_column(String(20), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    changed_at: Mapped[datetime] = timestamp_now()
    changed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    shipment: Mapped["Shipment"] = relationship("Shipment", back_populates="status_history")

    __table_args__ = (
        Index("ix_shipment_status_history_shipment", "shipment_id"),
        {"schema": "collections"},
    )


class ShipmentDocument(Base):
    """
    Links shipments to documents (bill of lading, packing list, customs, etc.).

    References media assets in the media schema for actual file storage.
    """
    __tablename__ = "shipment_documents"

    document_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    shipment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.shipments.shipment_id", ondelete="CASCADE"),
        nullable=False,
    )

    media_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    document_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    label: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    shipment: Mapped["Shipment"] = relationship("Shipment", back_populates="documents")

    __table_args__ = (
        Index("ix_shipment_documents_shipment", "shipment_id"),
        Index("ix_shipment_documents_media", "media_id"),
        CheckConstraint(
            "document_type IS NULL OR document_type IN ("
            "'bill_of_lading', 'packing_list', 'condition_report', 'customs_declaration', "
            "'insurance_certificate', 'courier_receipt', 'delivery_receipt', 'crate_specs', 'other')",
            name="check_shipment_document_type",
        ),
        {"schema": "collections"},
    )


# ============================================================================
# BARCODE LABELS - Label management for barcode-driven inventory
# ============================================================================

class BarcodeLabel(Base):
    """
    Manages generated or manual barcode labels for any entity.

    Supports multiple barcode formats (Code 128, QR, DataMatrix, etc.)
    and tracks print status for label management workflows.
    """
    __tablename__ = "barcode_labels"

    label_id: Mapped[UUID] = uuid_pk()
    organization_id: Mapped[UUID] = mapped_column(
        ForeignKey("organizations.organization_id", ondelete="CASCADE"), nullable=False
    )
    department_id: Mapped[UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.departments.department_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Entity reference (polymorphic)
    entity_type: Mapped[str] = mapped_column(String(30), nullable=False)
    entity_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), nullable=False)

    # Barcode value (unique per org)
    barcode_value: Mapped[str] = mapped_column(String(255), nullable=False)

    # Label format
    label_format: Mapped[str] = mapped_column(String(20), nullable=False, default="code128")

    # Print tracking
    is_printed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    print_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_printed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Batch
    batch_id: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    # Status
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="active")

    # Notes
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    created_by_id: Mapped[UUID | None] = mapped_column(
        "created_by", ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[datetime] = timestamp_now()
    updated_by_id: Mapped[UUID | None] = mapped_column(
        "updated_by", ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        Index("ix_barcode_labels_org_value", "organization_id", "barcode_value", unique=True),
        Index("ix_barcode_labels_entity", "entity_type", "entity_id"),
        Index("ix_barcode_labels_batch", "batch_id"),
        Index("ix_barcode_labels_org_status", "organization_id", "status"),
        Index("ix_barcode_labels_org_dept", "organization_id", "department_id"),
        CheckConstraint(
            "entity_type IN ('collection_object', 'object_part', 'location', 'crate')",
            name="check_barcode_entity_type",
        ),
        CheckConstraint(
            "label_format IN ('code128', 'qr', 'datamatrix', 'ean13', 'code39')",
            name="check_barcode_label_format",
        ),
        CheckConstraint(
            "status IN ('active', 'void')",
            name="check_barcode_label_status",
        ),
        {"schema": "collections"},
    )


# ============================================================================
# BARCODE SCANS - Append-only transaction log of every scan
# ============================================================================

class BarcodeScan(Base):
    """
    Append-only transaction log recording every barcode scan.

    Scans are immutable once created -- there is no updated_at column.
    Links to audit campaigns and movements when applicable.
    """
    __tablename__ = "barcode_scans"

    scan_id: Mapped[UUID] = uuid_pk()
    organization_id: Mapped[UUID] = mapped_column(
        ForeignKey("organizations.organization_id", ondelete="CASCADE"), nullable=False
    )
    department_id: Mapped[UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.departments.department_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Scanned barcode
    barcode_value: Mapped[str] = mapped_column(String(255), nullable=False)

    # Resolved entity (nullable if unresolved)
    resolved_entity_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    resolved_entity_id: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    # Action
    action_type: Mapped[str] = mapped_column(String(20), nullable=False)

    # Context
    scan_location_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("collections.locations.location_id", ondelete="SET NULL"), nullable=True
    )
    device_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    device_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Links
    campaign_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("collections.audit_campaigns.campaign_id", ondelete="SET NULL"), nullable=True
    )
    movement_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("collections.movements.movement_id", ondelete="SET NULL"), nullable=True
    )

    # Result
    result_status: Mapped[str] = mapped_column(String(20), nullable=False)

    # Notes
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Timestamp & user (no updated_at -- scans are immutable)
    scanned_at: Mapped[datetime] = timestamp_now()
    scanned_by: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        Index("ix_barcode_scans_org_time", "organization_id", "scanned_at"),
        Index("ix_barcode_scans_barcode", "barcode_value"),
        Index("ix_barcode_scans_campaign", "campaign_id"),
        Index("ix_barcode_scans_action", "action_type"),
        Index("ix_barcode_scans_org_dept", "organization_id", "department_id"),
        CheckConstraint(
            "action_type IN ('verify', 'move', 'audit', 'lookup', 'checkout', 'checkin')",
            name="check_scan_action_type",
        ),
        CheckConstraint(
            "result_status IN ('success', 'not_found', 'mismatch', 'error')",
            name="check_scan_result_status",
        ),
        {"schema": "collections"},
    )


__all__ = [
    "Crate",
    "Shipment",
    "ShipmentLeg",
    "ShipmentItem",
    "ShipmentReference",
    "ShipmentStatusHistory",
    "ShipmentDocument",
    "BarcodeLabel",
    "BarcodeScan",
]
