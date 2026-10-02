from __future__ import annotations

"""
Location, object-part, and movement models for hierarchical storage
management and procedure-compliant location/movement tracking.
"""

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
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from geoalchemy2 import Geometry

from app.database import Base
from app.models._helpers import uuid_pk, timestamp_now, timestamp_updated


# ============================================================================
# LOCATIONS - Hierarchical location management
# ============================================================================

class Location(Base):
    """
    Physical location within a facility.

    Location Information fields supported:
    - Location reference number (code)
    - Location name
    - Location type
    - Location address (for external locations)
    - Location access note
    - Location condition note
    - Location coordinate
    - Location date
    - Location fitness
    - Location note
    - Location security note
    """
    __tablename__ = "locations"

    location_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Hierarchy
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.locations.location_id", ondelete="SET NULL"),
        nullable=True,
    )
    path: Mapped[str] = mapped_column(String(1000), nullable=False)
    depth: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Identification
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    code: Mapped[str] = mapped_column(String(50), nullable=False)
    barcode: Mapped[str | None] = mapped_column(String(100), nullable=True)
    alternate_names: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)

    # Location type
    location_type: Mapped[str] = mapped_column(String(50), nullable=False)
    is_external: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Address (for external locations)
    address: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    contact_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    contact_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    contact_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Coordinates
    coordinates: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    grid_reference: Mapped[str | None] = mapped_column(String(50), nullable=True)
    floor_plan_coordinates: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    # PostGIS geometry for spatial queries (WGS84 / EPSG:4326)
    geom: Mapped[Any | None] = mapped_column(
        Geometry(geometry_type="POINT", srid=4326, spatial_index=True),
        nullable=True,
    )

    # Capacity
    capacity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    current_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    capacity_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Environment
    climate_controlled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    temperature_min: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    temperature_max: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    humidity_min: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    humidity_max: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    light_level: Mapped[str | None] = mapped_column(String(20), nullable=True)
    light_level_lux: Mapped[int | None] = mapped_column(Integer, nullable=True)
    uv_filtered: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    environment_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Fitness
    default_fitness: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Condition
    condition: Mapped[str | None] = mapped_column(String(20), nullable=True)
    condition_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    condition_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    pest_control_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Security
    security_level: Mapped[str | None] = mapped_column(String(20), nullable=True)
    security_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    access_restricted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    access_requirements: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Access
    access_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    accessibility: Mapped[str | None] = mapped_column(Text, nullable=True)

    # General
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Display
    on_display: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Status
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    established_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    decommissioned_date: Mapped[date | None] = mapped_column(Date, nullable=True)

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
        primaryjoin="Location.organization_id == Organization.organization_id",
    )
    parent: Mapped["Location | None"] = relationship(
        "Location",
        remote_side="Location.location_id",
        foreign_keys=[parent_id],
        back_populates="children",
    )
    children: Mapped[list["Location"]] = relationship(
        "Location",
        back_populates="parent",
        foreign_keys="Location.parent_id",
    )
    created_by_user: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[created_by],
        primaryjoin="Location.created_by == User.user_id",
    )
    updated_by_user: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[updated_by],
        primaryjoin="Location.updated_by == User.user_id",
    )

    __table_args__ = (
        Index("ix_locations_org_code", "organization_id", "code", unique=True),
        Index("ix_locations_org_parent", "organization_id", "parent_id"),
        Index("ix_locations_org_type", "organization_id", "location_type"),
        Index("ix_locations_path", "path"),
        CheckConstraint(
            "location_type IN ('building', 'wing', 'floor', 'room', 'area', "
            "'cabinet', 'shelving_unit', 'shelf', 'drawer', 'bin', 'box', "
            "'case', 'frame', 'rack', 'pallet', 'external', 'other')",
            name="check_location_type",
        ),
        CheckConstraint(
            "status IN ('active', 'maintenance', 'decommissioned', 'planned')",
            name="check_location_status",
        ),
        CheckConstraint(
            "default_fitness IS NULL OR default_fitness IN ('suitable', 'temporary', 'unsuitable')",
            name="check_location_fitness",
        ),
        CheckConstraint(
            "condition IS NULL OR condition IN ('good', 'fair', 'poor', 'under_repair')",
            name="check_location_condition",
        ),
        CheckConstraint(
            "security_level IS NULL OR security_level IN ('public', 'restricted', 'vault', 'high_security')",
            name="check_location_security",
        ),
        CheckConstraint(
            "light_level IS NULL OR light_level IN ('dark', 'low', 'medium', 'controlled', 'daylight')",
            name="check_location_light",
        ),
        {"schema": "collections"},
    )


# ============================================================================
# OBJECT PARTS - Part-level location tracking
# ============================================================================

class ObjectPart(Base):
    """
    Represents an individual part of a collection object for part-level location tracking.

    Every CollectionObject has at least one ObjectPart (auto-created when object is created).
    Location tracking (current, home, movement history) happens at the part level.

    When there's only one part, it's invisible to the user - they just see the object.
    When there are multiple parts (e.g., tea set components, armor pieces, multi-panel works),
    a "Parts" section appears with suffixed numbers (.1, .2, etc.).

    UI term: "Parts" (not components)
    """
    __tablename__ = "object_parts"

    part_id: Mapped[uuid.UUID] = uuid_pk()
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

    # Identification
    part_number: Mapped[str | None] = mapped_column(
        String(20), nullable=True,
        comment="Part suffix like '1', '2', 'a', 'b' - NULL for primary/single part"
    )
    name: Mapped[str | None] = mapped_column(
        String(255), nullable=True,
        comment="Part name like 'Teapot', 'Sugar Bowl' - NULL for single part objects"
    )
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Location tracking (moved from CollectionObject for part-level tracking)
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

    # Physical
    barcode: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Display
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

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
        primaryjoin="ObjectPart.organization_id == Organization.organization_id",
    )
    object: Mapped["CollectionObject"] = relationship(
        "CollectionObject",
        back_populates="parts",
        foreign_keys=[object_id],
    )
    current_location: Mapped["Location | None"] = relationship(
        "Location",
        foreign_keys=[current_location_id],
    )
    home_location: Mapped["Location | None"] = relationship(
        "Location",
        foreign_keys=[home_location_id],
    )
    created_by_user: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[created_by],
        primaryjoin="ObjectPart.created_by == User.user_id",
    )
    updated_by_user: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[updated_by],
        primaryjoin="ObjectPart.updated_by == User.user_id",
    )
    movements: Mapped[list["Movement"]] = relationship(
        "Movement",
        back_populates="part",
        foreign_keys="Movement.part_id",
    )

    __table_args__ = (
        Index("ix_object_parts_org", "organization_id"),
        Index("ix_object_parts_object", "object_id"),
        Index("ix_object_parts_location", "current_location_id"),
        Index(
            "ix_object_parts_number",
            "object_id",
            "part_number",
            unique=True,
            postgresql_where=text("part_number IS NOT NULL"),
        ),
        CheckConstraint(
            "current_location_fitness IS NULL OR current_location_fitness IN ('suitable', 'temporary', 'unsuitable')",
            name="check_part_location_fitness",
        ),
        {"schema": "collections"},
    )


# ============================================================================
# MOVEMENTS - Location change tracking
# ============================================================================

class Movement(Base):
    """
    Record of an object moving between locations.

    Movement Information fields:
    - Movement reference number
    - Current location (destination)
    - Location date
    - Normal location
    - Movement authorizer / authorization date
    - Movement contact
    - Movement method
    - Movement note
    - Movement reason
    - Planned removal date / Removal date
    - Shipper / Shipper contact
    - Shipping note
    """
    __tablename__ = "movements"

    movement_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Movement identification
    movement_reference_number: Mapped[str] = mapped_column(String(50), nullable=False)
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

    # Locations
    from_location_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.locations.location_id", ondelete="SET NULL"),
        nullable=True,
    )
    to_location_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.locations.location_id", ondelete="RESTRICT"),
        nullable=False,
    )
    location_fitness: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Dates
    movement_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    planned_removal_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    removal_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    planned_return_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Reason & Reference
    reason: Mapped[str] = mapped_column(String(50), nullable=False)
    movement_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    reference_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    reference_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    # Authorization
    authorized_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    authorizer_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.constituents.constituent_id", ondelete="SET NULL"),
        nullable=True,
    )
    authorization_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    authorization_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Contacts & Handling
    movement_contact: Mapped[str | None] = mapped_column(String(255), nullable=True)
    movement_contact_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    movement_method: Mapped[str | None] = mapped_column(String(50), nullable=True)
    moved_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    moved_by_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Handler (person who physically handled the object)
    handler_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.constituents.constituent_id", ondelete="SET NULL"),
        nullable=True,
    )
    handler_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    organization_courier: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    courier_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Shipping
    shipper_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    shipper_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.constituents.constituent_id", ondelete="SET NULL"),
        nullable=True,
    )
    shipping_method: Mapped[str | None] = mapped_column(String(20), nullable=True)
    shipping_tracking_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    shipping_insurance_value: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    shipping_insurance_currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    shipping_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Condition
    condition_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    condition_report_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    # Status
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="completed")

    # Task assignment
    assigned_to_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Audit
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = timestamp_now()

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="Movement.organization_id == Organization.organization_id",
    )
    object: Mapped["CollectionObject"] = relationship(
        "CollectionObject",
        back_populates="movements",
        foreign_keys=[object_id],
    )
    part: Mapped["ObjectPart | None"] = relationship(
        "ObjectPart",
        back_populates="movements",
        foreign_keys=[part_id],
    )
    from_location: Mapped["Location | None"] = relationship(
        "Location",
        foreign_keys=[from_location_id],
    )
    to_location: Mapped["Location"] = relationship(
        "Location",
        foreign_keys=[to_location_id],
    )
    authorized_by_user: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[authorized_by],
        primaryjoin="Movement.authorized_by == User.user_id",
    )
    authorizer: Mapped["Constituent | None"] = relationship(
        "Constituent",
        foreign_keys=[authorizer_id],
    )
    movement_contact_user: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[movement_contact_user_id],
        primaryjoin="Movement.movement_contact_user_id == User.user_id",
    )
    moved_by_user: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[moved_by],
        primaryjoin="Movement.moved_by == User.user_id",
    )
    handler: Mapped["Constituent | None"] = relationship(
        "Constituent",
        foreign_keys=[handler_id],
    )
    shipper: Mapped["Constituent | None"] = relationship(
        "Constituent",
        foreign_keys=[shipper_id],
    )
    created_by_user: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[created_by],
        primaryjoin="Movement.created_by == User.user_id",
    )
    assigned_to: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[assigned_to_user_id],
        primaryjoin="Movement.assigned_to_user_id == User.user_id",
    )
    signed_documents = relationship(
        "SignedDocument",
        primaryjoin=(
            "and_(foreign(SignedDocument.procedure_id) == Movement.movement_id, "
            "SignedDocument.procedure_type == 'movement')"
        ),
        viewonly=True,
    )

    __table_args__ = (
        Index("ix_movements_org_ref", "organization_id", "movement_reference_number", unique=True),
        Index("ix_movements_object", "object_id"),
        Index("ix_movements_part", "part_id"),
        Index("ix_movements_org_date", "organization_id", "movement_date"),
        Index("ix_movements_to_location", "to_location_id"),
        Index("ix_movements_from_location", "from_location_id"),
        Index("ix_movements_handler_id", "handler_id"),
        CheckConstraint(
            "reason IN ('exhibition', 'storage', 'conservation', 'loan', 'photography', "
            "'research', 'inventory', 'rearrangement', 'environmental', 'security', 'access_request', 'other')",
            name="check_movement_reason",
        ),
        CheckConstraint(
            "status IN ('pending', 'in_transit', 'completed', 'cancelled')",
            name="check_movement_status",
        ),
        CheckConstraint(
            "movement_method IS NULL OR movement_method IN ('hand_carried', 'cart', 'forklift', 'vehicle', 'shipped', 'courier')",
            name="check_movement_method",
        ),
        CheckConstraint(
            "location_fitness IS NULL OR location_fitness IN ('suitable', 'temporary', 'unsuitable')",
            name="check_movement_fitness",
        ),
        CheckConstraint(
            "shipping_method IS NULL OR shipping_method IN ('ground', 'air', 'sea')",
            name="check_shipping_method",
        ),
        {"schema": "collections"},
    )


__all__ = [
    "Location",
    "ObjectPart",
    "Movement",
]
