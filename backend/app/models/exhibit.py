"""
Exhibition models - planning and virtual gallery system.

This module defines the SQLAlchemy models for the Exhibit product,
which provides museums and galleries with exhibition planning tools,
virtual gallery walkthroughs, and installation documentation.

All tables are in the 'collections' PostgreSQL schema (merged from 'exhibit').

Exhibit can operate in two modes:
- Integrated: Uses collection_objects from Collections
- Standalone: Uses entity_current from Bridge (external CMS integration)
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional

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
from typing import TYPE_CHECKING

from app.database import Base
from app.models._helpers import uuid_pk, timestamp_now, timestamp_updated


# ============================================================================
# VENUES - Physical gallery spaces
# ============================================================================

class Venue(Base):
    """
    A physical gallery space that can host exhibitions.

    Venues contain floor plans (individual rooms/galleries).
    An organization can have multiple venues (e.g., main building, annex).
    """
    __tablename__ = "venues"

    venue_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)

    # PostGIS geometry for spatial queries (WGS84 / EPSG:4326)
    geom: Mapped[Any | None] = mapped_column(
        Geometry(geometry_type="POINT", srid=4326, spatial_index=True),
        nullable=True,
    )

    # Default room settings
    default_ceiling_height_cm: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="300"
    )
    default_wall_color: Mapped[str] = mapped_column(
        String(7), nullable=False, server_default="#FFFFFF"
    )

    # Phase 3: Public-facing fields
    slug: Mapped[str | None] = mapped_column(String(100), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    website_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    hours = mapped_column(JSONB, nullable=True)  # { monday: { open, close }, ... }
    admission = mapped_column(JSONB, nullable=True)  # { tiers: [{ label, price }], free_days, note }
    hero_media_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    thumbnail_media_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    accent_color: Mapped[str | None] = mapped_column(String(7), nullable=True)
    is_public: Mapped[bool] = mapped_column(server_default="false", nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    parking_info: Mapped[str | None] = mapped_column(Text, nullable=True)
    accessibility_info: Mapped[str | None] = mapped_column(Text, nullable=True)
    ticketing_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Timestamps
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    floor_plans: Mapped[list["FloorPlan"]] = relationship(
        "FloorPlan",
        back_populates="venue",
        cascade="all, delete-orphan",
    )
    exhibitions: Mapped[list["Exhibition"]] = relationship(
        "Exhibition",
        back_populates="venue",
    )

    __table_args__ = (
        Index("ix_exhibit_venues_org_id", "organization_id"),
        Index("ix_venues_org_slug", "organization_id", "slug", unique=True,
              postgresql_where=text("slug IS NOT NULL")),
        {"schema": "collections"},
    )


# ============================================================================
# FLOOR PLANS - Individual rooms/galleries
# ============================================================================

class FloorPlan(Base):
    """
    An individual room or gallery within a venue.

    For Phase 1, geometry is simple rectangular rooms stored as JSON:
    {
        "type": "rectangular",
        "width_cm": 800,
        "depth_cm": 600,
        "walls": {
            "north": {"length": 800},
            "south": {"length": 800},
            "east": {"length": 600},
            "west": {"length": 600}
        }
    }

    Future phases will support complex polygonal rooms with doors/windows.
    """
    __tablename__ = "floor_plans"

    floor_plan_id: Mapped[uuid.UUID] = uuid_pk()
    venue_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.venues.venue_id", ondelete="CASCADE"),
        nullable=False,
    )

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    floor_number: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")

    # Room geometry as JSON (legacy — nullable for GLB-only floor plans)
    geometry: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    # Override venue defaults (nullable = use venue default)
    ceiling_height_cm: Mapped[int | None] = mapped_column(Integer, nullable=True)
    wall_color: Mapped[str | None] = mapped_column(String(7), nullable=True)
    floor_texture: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # 3D model (GLB/GLTF) — primary floor plan representation
    model_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    model_scale: Mapped[Decimal] = mapped_column(
        Numeric(8, 4), nullable=False, server_default="1.0"
    )

    # 3D visualization settings (lighting, materials, post-processing)
    appearance_settings: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    # Timestamps
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()

    # Relationships
    venue: Mapped["Venue"] = relationship("Venue", back_populates="floor_plans")
    placements: Mapped[list["Placement"]] = relationship(
        "Placement",
        back_populates="floor_plan",
        cascade="all, delete-orphan",
    )
    exhibition_associations: Mapped[list["ExhibitionFloorPlan"]] = relationship(
        "ExhibitionFloorPlan",
        back_populates="floor_plan",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_exhibit_floor_plans_venue_id", "venue_id"),
        {"schema": "collections"},
    )

    @property
    def effective_ceiling_height(self) -> int:
        """Get ceiling height, falling back to venue default."""
        if self.ceiling_height_cm is not None:
            return self.ceiling_height_cm
        return self.venue.default_ceiling_height_cm if self.venue else 300

    @property
    def effective_wall_color(self) -> str:
        """Get wall color, falling back to venue default."""
        if self.wall_color is not None:
            return self.wall_color
        return self.venue.default_wall_color if self.venue else "#FFFFFF"


# ============================================================================
# EXHIBITIONS - Planned or active exhibitions
# ============================================================================

class Exhibition(Base):
    """
    An exhibition being planned or displayed.

    "Use of collections" procedure compliance:
    - exhibition_number: Use reference number
    - title: Use title
    - exhibition_type: Use type (controlled vocabulary)
    - organizer_id: Use organizer
    - authorizer_id: Use authorizer
    - authorization_date: Use authorization date
    - provisos: Use provisos (special conditions)
    - outcome: Use result

    Exhibitions have a lifecycle (Use status):
    - proposed: Initial request/proposal
    - authorized: Approved for planning
    - in_preparation: Active setup and installation
    - open: Currently on display
    - closed: Exhibition ended
    - archived: Past exhibition, preserved for records
    """
    __tablename__ = "exhibitions"

    exhibition_id: Mapped[uuid.UUID] = uuid_pk()
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
    venue_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.venues.venue_id", ondelete="SET NULL"),
        nullable=True,
    )

    # ══════════════════════════════════════════════════════════════════════════
    # Procedure: Use reference number / Use title
    # ══════════════════════════════════════════════════════════════════════════
    exhibition_number: Mapped[str | None] = mapped_column(
        String(50), nullable=True, unique=True
    )  # Formal identifier e.g., "EXH.2026.001"
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    curator_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ══════════════════════════════════════════════════════════════════════════
    # Procedure: Use type (controlled vocabulary)
    # ══════════════════════════════════════════════════════════════════════════
    exhibition_type: Mapped[str] = mapped_column(
        String(50), nullable=False, server_default="temporary"
    )  # permanent, temporary, touring, traveling, online, pop_up

    # ══════════════════════════════════════════════════════════════════════════
    # Procedure: Use organizer / Use authorizer
    # ══════════════════════════════════════════════════════════════════════════
    organizer_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )  # Who organized/curated this exhibition
    authorizer_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )  # Who authorized/approved this exhibition
    authorization_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # ══════════════════════════════════════════════════════════════════════════
    # Procedure: Use provisos / Use result
    # ══════════════════════════════════════════════════════════════════════════
    provisos: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Special conditions, restrictions, requirements for this exhibition
    outcome: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Post-exhibition notes: attendance, feedback, lessons learned

    # ══════════════════════════════════════════════════════════════════════════
    # Procedure: Use status
    # ══════════════════════════════════════════════════════════════════════════
    status: Mapped[str] = mapped_column(
        String(50), nullable=False, server_default="proposed"
    )  # proposed, authorized, in_preparation, open, closed, archived

    # ══════════════════════════════════════════════════════════════════════════
    # Dates (Procedure: Use begin date / Use end date)
    # ══════════════════════════════════════════════════════════════════════════
    planned_start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    planned_end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    actual_start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    actual_end_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Public gallery
    public_url_slug: Mapped[str | None] = mapped_column(
        String(100), nullable=True, unique=True
    )
    is_public: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")

    # Phase 4: Public display fields
    hero_media_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    thumbnail_media_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    ticketing_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    subtitle: Mapped[str | None] = mapped_column(String(500), nullable=True)
    short_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    credits: Mapped[str | None] = mapped_column(Text, nullable=True)
    tags = mapped_column(JSONB, nullable=True)
    is_featured: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    visitor_info: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Timestamps
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    venue: Mapped[Optional["Venue"]] = relationship("Venue", back_populates="exhibitions")
    placements: Mapped[list["Placement"]] = relationship(
        "Placement",
        back_populates="exhibition",
        cascade="all, delete-orphan",
    )
    floor_plan_associations: Mapped[list["ExhibitionFloorPlan"]] = relationship(
        "ExhibitionFloorPlan",
        back_populates="exhibition",
        cascade="all, delete-orphan",
    )
    status_history: Mapped[list["ExhibitionStatusHistory"]] = relationship(
        "ExhibitionStatusHistory",
        back_populates="exhibition",
        cascade="all, delete-orphan",
        order_by="ExhibitionStatusHistory.status_date.desc()",
    )
    exhibition_objects: Mapped[list["ExhibitionObject"]] = relationship(
        "ExhibitionObject",
        back_populates="exhibition",
        cascade="all, delete-orphan",
    )
    content_blocks: Mapped[list["ExhibitionContentBlock"]] = relationship(
        "ExhibitionContentBlock",
        back_populates="exhibition",
        cascade="all, delete-orphan",
        order_by="ExhibitionContentBlock.display_order",
    )
    tour_venues: Mapped[list["ExhibitionVenue"]] = relationship(
        "ExhibitionVenue",
        back_populates="exhibition",
        cascade="all, delete-orphan",
        order_by="ExhibitionVenue.tour_order",
    )
    department: Mapped[Any] = relationship(
        "Department",
        foreign_keys=[department_id],
    )

    __table_args__ = (
        CheckConstraint(
            "status IN ('proposed', 'authorized', 'in_preparation', 'open', 'closed', 'archived')",
            name="check_exhibition_status",
        ),
        CheckConstraint(
            "exhibition_type IN ('permanent', 'temporary', 'touring', 'traveling', 'online', 'pop_up')",
            name="check_exhibition_type",
        ),
        Index("ix_collections_exhibitions_org_id", "organization_id"),
        Index("ix_collections_exhibitions_org_dept", "organization_id", "department_id"),
        Index("ix_collections_exhibitions_venue_id", "venue_id"),
        Index("ix_collections_exhibitions_status", "status"),
        Index("ix_collections_exhibitions_public_slug", "public_url_slug"),
        Index("ix_collections_exhibitions_number", "exhibition_number"),
        {"schema": "collections"},
    )

    @property
    def floor_plans(self) -> list["FloorPlan"]:
        """Get floor plans in visit order."""
        return [
            assoc.floor_plan
            for assoc in sorted(self.floor_plan_associations, key=lambda a: a.visit_order)
        ]


# ============================================================================
# EXHIBITION FLOOR PLANS - Junction table
# ============================================================================

class ExhibitionFloorPlan(Base):
    """
    Associates floor plans with exhibitions and defines visit order.
    """
    __tablename__ = "exhibition_floor_plans"

    exhibition_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.exhibitions.exhibition_id", ondelete="CASCADE"),
        primary_key=True,
    )
    floor_plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.floor_plans.floor_plan_id", ondelete="CASCADE"),
        primary_key=True,
    )
    visit_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")

    # Relationships
    exhibition: Mapped["Exhibition"] = relationship(
        "Exhibition", back_populates="floor_plan_associations"
    )
    floor_plan: Mapped["FloorPlan"] = relationship(
        "FloorPlan", back_populates="exhibition_associations"
    )

    __table_args__ = (
        {"schema": "collections"},
    )


# ============================================================================
# EXHIBITION STATUS HISTORY - Use status tracking
# ============================================================================

class ExhibitionStatusHistory(Base):
    """
    Tracks exhibition status changes over time.

    Use status date is recorded for each status change.
    This provides a complete audit trail of the exhibition lifecycle.
    """
    __tablename__ = "exhibition_status_history"

    history_id: Mapped[uuid.UUID] = uuid_pk()
    exhibition_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.exhibitions.exhibition_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Status at this point in time
    status: Mapped[str] = mapped_column(String(50), nullable=False)
    status_date: Mapped[datetime] = timestamp_now()

    # Who made the change
    changed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Optional notes about this status change
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    exhibition: Mapped["Exhibition"] = relationship(
        "Exhibition", back_populates="status_history"
    )

    __table_args__ = (
        CheckConstraint(
            "status IN ('proposed', 'authorized', 'in_preparation', 'open', 'closed', 'archived')",
            name="check_status_history_status",
        ),
        Index("ix_collections_status_history_exhibition_id", "exhibition_id"),
        Index("ix_collections_status_history_date", "status_date"),
        {"schema": "collections"},
    )


# ============================================================================
# PLACEMENTS - Artwork positions
# ============================================================================

class Placement(Base):
    """
    Where an artwork is placed in an exhibition.

    Tracks:
    - Source artwork (from Collections, Media, or external URL)
    - Physical dimensions (can override source)
    - Position on a specific wall
    - Frame/mount configuration
    - Label information
    """
    __tablename__ = "placements"

    placement_id: Mapped[uuid.UUID] = uuid_pk()
    exhibition_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.exhibitions.exhibition_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    floor_plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.floor_plans.floor_plan_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Source artwork reference
    source_type: Mapped[str] = mapped_column(String(50), nullable=False)  # collections, media, external
    source_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    external_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Display properties (override source or for external)
    display_title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    display_artist: Mapped[str | None] = mapped_column(String(255), nullable=True)
    display_date: Mapped[str | None] = mapped_column(String(100), nullable=True)
    display_medium: Mapped[str | None] = mapped_column(String(255), nullable=True)
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    # 3D model support (for sculptures, installations, etc.)
    model_url: Mapped[str | None] = mapped_column(Text, nullable=True)  # URL to GLB/GLTF file
    model_scale: Mapped[Decimal] = mapped_column(Numeric(8, 4), nullable=False, server_default="1.0")

    # Physical dimensions in centimeters
    width_cm: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    height_cm: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    depth_cm: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, server_default="0")

    # Position on wall (centimeters) - for wall-mounted artworks
    wall_id: Mapped[str] = mapped_column(String(100), nullable=False)  # north, south, east, west, or 'floor'
    position_x: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)  # Along wall from left
    position_y: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)  # Height from floor (center)
    position_z: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, server_default="0")  # From wall
    rotation_degrees: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, server_default="0")

    # Floor position (centimeters) - for freestanding objects (sculptures, vitrines)
    # Uses floor plan coordinate system (origin at room center)
    floor_position_x: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    floor_position_y: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)

    # Frame/mount
    frame_style: Mapped[str | None] = mapped_column(String(100), nullable=True)
    frame_width_cm: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, server_default="0")
    mount_type: Mapped[str] = mapped_column(String(50), nullable=False, server_default="wall")

    # 3D visualization settings (Ortelia-style)
    frame_material: Mapped[str | None] = mapped_column(
        String(50), nullable=True
    )  # wood_natural, wood_dark, metal_silver, gilt, etc.
    artwork_surface: Mapped[str | None] = mapped_column(
        String(50), nullable=True
    )  # matte, satin, glossy, varnished, glass
    lighting_fixture_type: Mapped[str | None] = mapped_column(
        String(50), nullable=True
    )  # fresnel, display_profile, wall_washer, beam_spot, led_track, flood
    lighting_settings: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB, nullable=True
    )  # {power, zoom, focus, temperature, colorGel}

    # Phase 2: References to FrameStyle and MountConfig
    frame_style_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.frame_styles.frame_style_id", ondelete="SET NULL"),
        nullable=True,
    )
    mount_config_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.mount_configs.mount_config_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Label
    label_position: Mapped[str] = mapped_column(String(50), nullable=False, server_default="right")
    label_text: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Placement workflow status: draft → proposed → approved
    # NOTE: No "installed" status - this is a planning tool, not location authority
    placement_status: Mapped[str] = mapped_column(
        String(30), nullable=False, server_default="draft"
    )

    # Installer notes (free-text for installation instructions)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Timestamps
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()

    # Audit trail
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    exhibition: Mapped["Exhibition"] = relationship("Exhibition", back_populates="placements")
    floor_plan: Mapped["FloorPlan"] = relationship("FloorPlan", back_populates="placements")
    frame_style_ref: Mapped[Optional["FrameStyle"]] = relationship(
        "FrameStyle",
        back_populates="placements",
        foreign_keys=[frame_style_id],
    )
    mount_config_ref: Mapped[Optional["MountConfig"]] = relationship(
        "MountConfig",
        back_populates="placements",
        foreign_keys=[mount_config_id],
    )

    __table_args__ = (
        CheckConstraint(
            "source_type IN ('collections', 'media', 'external')",
            name="check_placement_source_type",
        ),
        CheckConstraint(
            "mount_type IN ('wall', 'plinth', 'hanging', 'vitrine', 'floor')",
            name="check_placement_mount_type",
        ),
        CheckConstraint(
            "placement_status IN ('draft', 'proposed', 'approved')",
            name="check_placement_status",
        ),
        Index("ix_exhibit_placements_exhibition_id", "exhibition_id"),
        Index("ix_exhibit_placements_floor_plan_id", "floor_plan_id"),
        Index("ix_exhibit_placements_source", "source_type", "source_id"),
        Index("ix_exhibit_placements_status", "placement_status"),
        {"schema": "collections"},
    )

    @property
    def total_width_with_frame(self) -> Decimal:
        """Total width including frame."""
        return self.width_cm + (self.frame_width_cm * 2)

    @property
    def total_height_with_frame(self) -> Decimal:
        """Total height including frame."""
        return self.height_cm + (self.frame_width_cm * 2)


# ============================================================================
# FRAME STYLES - Reusable frame definitions (Phase 2)
# ============================================================================

class FrameStyle(Base):
    """
    Reusable frame style definition.

    Frame styles can be:
    - System defaults (is_system=True) - available to all organizations
    - Organization-specific custom frames (is_system=False)

    Profile types:
    - flat: Simple flat profile
    - stepped: Profile with stepped edge
    - ornate: Decorative traditional frame
    - float: Float mount with gap between art and frame
    - shadowbox: Deep frame creating shadow box effect
    """
    __tablename__ = "frame_styles"

    frame_style_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Frame characteristics
    profile_type: Mapped[str] = mapped_column(String(50), nullable=False)
    default_width_cm: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, server_default="3.0"
    )
    default_depth_cm: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, server_default="2.0"
    )
    material: Mapped[str | None] = mapped_column(String(50), nullable=True)
    color_hex: Mapped[str] = mapped_column(
        String(7), nullable=False, server_default="#2C2C2C"
    )

    # Ortelia-style geometry settings
    overhang_outside_cm: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, server_default="0"
    )  # How far frame extends beyond artwork
    overhang_inside_cm: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, server_default="0.5"
    )  # Rabbet depth - frame overlap on artwork

    # Mat board configuration
    mat_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    mat_width_cm: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, server_default="5.0"
    )
    mat_color: Mapped[str] = mapped_column(
        String(7), nullable=False, server_default="#F5F5F0"
    )  # Museum off-white
    inner_mat_width_cm: Mapped[Decimal | None] = mapped_column(
        Numeric(5, 2), nullable=True
    )  # Optional inner mat/accent liner
    inner_mat_color: Mapped[str | None] = mapped_column(
        String(7), nullable=True
    )

    # PBR material for 3D rendering
    pbr_material: Mapped[str | None] = mapped_column(
        String(50), nullable=True
    )  # wood_natural, gilt, metal_silver, etc.

    # Preview image
    preview_image_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    # System vs custom
    is_system: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )

    # Timestamps
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    placements: Mapped[list["Placement"]] = relationship(
        "Placement",
        back_populates="frame_style_ref",
        foreign_keys="Placement.frame_style_id",
    )

    __table_args__ = (
        CheckConstraint(
            "profile_type IN ('flat', 'stepped', 'ornate', 'float', 'shadowbox')",
            name="check_frame_profile_type",
        ),
        Index("ix_exhibit_frame_styles_org_id", "organization_id"),
        Index("ix_exhibit_frame_styles_system", "is_system"),
        {"schema": "collections"},
    )


# ============================================================================
# MOUNT CONFIGS - Mount type configurations (Phase 2)
# ============================================================================

class MountConfig(Base):
    """
    Mount configuration for different display methods.

    Mount types:
    - wall: Standard wall mounting
    - plinth: Free-standing pedestal
    - hanging: Suspended from ceiling
    - vitrine: Display case/cabinet

    The config JSONB stores type-specific parameters:

    wall config:
    {
        "wire_type": "d-ring" | "steel_cable" | "picture_wire",
        "hardware": "french_cleat" | "z_bar" | "keyhole"
    }

    plinth config:
    {
        "height_cm": 100,
        "width_cm": 60,
        "depth_cm": 60,
        "material": "wood" | "acrylic" | "metal",
        "color_hex": "#ffffff"
    }

    hanging config:
    {
        "wire_length_cm": 150,
        "offset_from_ceiling_cm": 10,
        "wire_type": "steel_cable" | "nylon" | "chain"
    }

    vitrine config:
    {
        "height_cm": 60,
        "width_cm": 50,
        "depth_cm": 50,
        "has_pedestal": true,
        "pedestal_height_cm": 80
    }
    """
    __tablename__ = "mount_configs"

    mount_config_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    mount_type: Mapped[str] = mapped_column(String(50), nullable=False)

    # Type-specific configuration
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)

    # Preview image
    preview_image_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    # System vs custom
    is_system: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )

    # Timestamps
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    placements: Mapped[list["Placement"]] = relationship(
        "Placement",
        back_populates="mount_config_ref",
        foreign_keys="Placement.mount_config_id",
    )

    __table_args__ = (
        CheckConstraint(
            "mount_type IN ('wall', 'plinth', 'hanging', 'vitrine', 'floor')",
            name="check_mount_config_type",
        ),
        Index("ix_exhibit_mount_configs_org_id", "organization_id"),
        Index("ix_exhibit_mount_configs_type", "mount_type"),
        {"schema": "collections"},
    )


# ============================================================================
# EXPORTS - Export history (Phase 2)
# ============================================================================

class Export(Base):
    """
    Track generated PDF exports for exhibitions.

    Export types:
    - elevation_pdf: Wall elevation drawings
    - install_spec: Installation specifications document
    - object_checklist: Artwork checklist with condition fields
    """
    __tablename__ = "exports"

    export_id: Mapped[uuid.UUID] = uuid_pk()
    exhibition_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.exhibitions.exhibition_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    export_type: Mapped[str] = mapped_column(String(50), nullable=False)
    floor_plan_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.floor_plans.floor_plan_id", ondelete="SET NULL"),
        nullable=True,
    )
    wall_id: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Generated file
    file_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    file_size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Export options used
    export_metadata: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    # Timestamps
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    exhibition: Mapped["Exhibition"] = relationship("Exhibition")
    floor_plan: Mapped[Optional["FloorPlan"]] = relationship("FloorPlan")

    __table_args__ = (
        CheckConstraint(
            "export_type IN ('elevation_pdf', 'install_spec', 'object_checklist')",
            name="check_export_type",
        ),
        Index("ix_exhibit_exports_exhibition_id", "exhibition_id"),
        Index("ix_exhibit_exports_type", "export_type"),
        {"schema": "collections"},
    )


# ============================================================================
# EXHIBITION OBJECTS - Junction table for exhibition-object relationships
# ============================================================================

class ExhibitionObject(Base):
    """
    Links objects to exhibitions from either Collections or Bridge sources.

    This junction table allows objects to be added to an exhibition's object
    list independently of physical placement decisions. Objects can be planned,
    confirmed, displayed, and returned through a status workflow.

    Polymorphic object source:
    - object_id: References collections.collection_objects (native Collections)
    - entity_key: References flow.entity_current (Bridge-imported from external CMS)

    Exactly one of object_id or entity_key must be set (enforced by check constraint).

    For borrowed objects, links to the incoming loan record.
    Condition reports track object state entering and leaving the exhibition.
    """
    __tablename__ = "exhibition_objects"

    exhibition_object_id: Mapped[uuid.UUID] = uuid_pk()
    exhibition_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.exhibitions.exhibition_id", ondelete="CASCADE"),
        nullable=False,
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Polymorphic object source - exactly one must be set
    # For Collections-native objects:
    object_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.collection_objects.object_id", ondelete="CASCADE"),
        nullable=True,
    )
    # For Bridge-imported objects (references flow.entity_current via org_id + entity_key):
    entity_key: Mapped[str | None] = mapped_column(String, nullable=True)

    # Exhibition-specific metadata
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    section: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Loan tracking (for borrowed objects)
    loan_in_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.loans_in.loan_in_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Object-specific exhibition info
    credit_line_override: Mapped[str | None] = mapped_column(Text, nullable=True)
    special_requirements: Mapped[str | None] = mapped_column(Text, nullable=True)
    installation_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Status workflow: planned → confirmed → on_display → returned
    object_status: Mapped[str] = mapped_column(
        String(30), nullable=False, server_default="planned"
    )
    confirmed_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Condition tracking
    condition_in_report_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.condition_reports.report_id", ondelete="SET NULL"),
        nullable=True,
    )
    condition_out_report_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.condition_reports.report_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Timestamps
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    updated_at: Mapped[datetime] = timestamp_updated()

    # Relationships
    exhibition: Mapped["Exhibition"] = relationship(
        "Exhibition", back_populates="exhibition_objects"
    )

    @property
    def source_type(self) -> str:
        """Returns 'collections' or 'bridge' based on which source is set."""
        return "collections" if self.object_id else "bridge"

    __table_args__ = (
        CheckConstraint(
            "object_status IN ('planned', 'confirmed', 'on_display', 'returned')",
            name="check_exhibition_object_status",
        ),
        # Polymorphic source constraint: exactly one of object_id or entity_key must be set
        CheckConstraint(
            "(object_id IS NOT NULL AND entity_key IS NULL) OR "
            "(object_id IS NULL AND entity_key IS NOT NULL)",
            name="chk_exhibition_objects_source",
        ),
        Index("ix_exhibition_objects_exhibition", "exhibition_id"),
        Index("ix_exhibition_objects_org", "organization_id"),
        Index("ix_exhibition_objects_object", "object_id"),
        Index("ix_exhibition_objects_entity_key", "organization_id", "entity_key",
              postgresql_where="entity_key IS NOT NULL"),
        Index("ix_exhibition_objects_status", "object_status"),
        {"schema": "collections"},
    )


# ============================================================================
# LABEL TEMPLATES - Reusable label format definitions
# ============================================================================

class LabelTemplate(Base):
    """
    Defines reusable label templates for exhibition labels.

    Label types:
    - tombstone: Standard artwork identification label
    - extended: Extended label with interpretation
    - wall: Large wall text/panel
    - didactic: Educational/interpretive text

    template_fields stores field definitions as JSON:
    {
        "fields": [
            {"name": "artist", "source": "object.creator", "format": "uppercase"},
            {"name": "title", "source": "object.title", "format": "italic"},
            {"name": "date", "source": "object.date_created"},
            {"name": "medium", "source": "object.medium"},
            {"name": "dimensions", "source": "object.dimensions"},
            {"name": "credit", "source": "exhibition_object.credit_line_override || object.credit_line"}
        ],
        "layout": "vertical",
        "alignment": "left"
    }
    """
    __tablename__ = "label_templates"

    template_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    label_type: Mapped[str] = mapped_column(String(50), nullable=False)

    # Template configuration
    template_fields: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)

    # Typography
    font_family: Mapped[str] = mapped_column(
        String(100), nullable=False, server_default="Arial"
    )
    font_size_pt: Mapped[int] = mapped_column(Integer, nullable=False, server_default="12")

    # Physical dimensions
    width_cm: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    height_cm: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)

    # Default template flag
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")

    # Timestamps
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    labels: Mapped[list["ExhibitionLabel"]] = relationship(
        "ExhibitionLabel", back_populates="template"
    )

    __table_args__ = (
        CheckConstraint(
            "label_type IN ('tombstone', 'extended', 'wall', 'didactic')",
            name="check_label_template_type",
        ),
        Index("ix_exhibit_label_templates_org", "organization_id"),
        Index("ix_exhibit_label_templates_type", "label_type"),
        {"schema": "collections"},
    )


# ============================================================================
# EXHIBITION LABELS - Generated labels for exhibitions
# ============================================================================

class ExhibitionLabel(Base):
    """
    Generated labels for exhibition objects.

    Labels go through a workflow:
    - draft: Initial generation from template
    - review: Under editorial review
    - approved: Approved for printing
    - printed: Has been printed

    Custom text allows manual override of generated content.
    """
    __tablename__ = "exhibition_labels"

    label_id: Mapped[uuid.UUID] = uuid_pk()
    exhibition_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.exhibitions.exhibition_id", ondelete="CASCADE"),
        nullable=False,
    )
    exhibition_object_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.exhibition_objects.exhibition_object_id", ondelete="CASCADE"),
        nullable=True,
    )
    template_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.label_templates.template_id", ondelete="SET NULL"),
        nullable=True,
    )

    label_type: Mapped[str] = mapped_column(String(50), nullable=False)
    generated_text: Mapped[str] = mapped_column(Text, nullable=False)
    custom_text: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Workflow status
    status: Mapped[str] = mapped_column(
        String(30), nullable=False, server_default="draft"
    )

    # Review tracking
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Approval tracking
    approved_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Print tracking
    last_printed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    print_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")

    # Timestamps
    created_at: Mapped[datetime] = timestamp_now()

    # Relationships
    exhibition: Mapped["Exhibition"] = relationship("Exhibition")
    exhibition_object: Mapped[Optional["ExhibitionObject"]] = relationship("ExhibitionObject")
    template: Mapped[Optional["LabelTemplate"]] = relationship(
        "LabelTemplate", back_populates="labels"
    )

    __table_args__ = (
        CheckConstraint(
            "label_type IN ('tombstone', 'extended', 'wall', 'didactic')",
            name="check_exhibition_label_type",
        ),
        CheckConstraint(
            "status IN ('draft', 'review', 'approved', 'printed')",
            name="check_exhibition_label_status",
        ),
        Index("ix_exhibit_labels_exhibition", "exhibition_id"),
        Index("ix_exhibit_labels_object", "exhibition_object_id"),
        Index("ix_exhibit_labels_status", "status"),
        {"schema": "collections"},
    )

    @property
    def display_text(self) -> str:
        """Return custom text if set, otherwise generated text."""
        return self.custom_text if self.custom_text else self.generated_text


# ============================================================================
# EXHIBITION CONTENT BLOCKS - Interpretive content for exhibitions
# ============================================================================

class ExhibitionContentBlock(Base):
    """
    Block-based interpretive content for exhibitions.

    Block types:
    - intro_text: Exhibition introduction
    - section_header: Section divider/header
    - theme_narrative: Thematic essay or narrative
    - extended_label: Extended interpretation for specific objects
    - educational_content: Educational material
    - multimedia_embed: Video/audio embed reference
    - quote: Highlighted quotation
    - timeline: Timeline entry
    - credit_panel: Acknowledgments and credits

    Content is stored as Markdown for rich formatting.
    """
    __tablename__ = "exhibition_content_blocks"

    block_id: Mapped[uuid.UUID] = uuid_pk()
    exhibition_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.exhibitions.exhibition_id", ondelete="CASCADE"),
        nullable=False,
    )

    block_type: Mapped[str] = mapped_column(String(50), nullable=False)
    section: Mapped[str | None] = mapped_column(String(100), nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")

    # Content
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    content_format: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="markdown"
    )

    # Media attachment
    media_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media.media_id", ondelete="SET NULL"),
        nullable=True,
    )
    media_caption: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Workflow
    status: Mapped[str] = mapped_column(
        String(30), nullable=False, server_default="draft"
    )
    is_public: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")

    # Related objects (for extended labels or object-specific content)
    related_object_ids: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    # Timestamps
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    updated_at: Mapped[datetime] = timestamp_updated()

    # Relationships
    exhibition: Mapped["Exhibition"] = relationship("Exhibition", back_populates="content_blocks")

    __table_args__ = (
        CheckConstraint(
            "block_type IN ('intro_text', 'section_header', 'theme_narrative', 'extended_label', "
            "'educational_content', 'multimedia_embed', 'quote', 'timeline', 'credit_panel')",
            name="check_content_block_type",
        ),
        CheckConstraint(
            "status IN ('draft', 'review', 'published')",
            name="check_content_block_status",
        ),
        CheckConstraint(
            "content_format IN ('markdown', 'html', 'plain')",
            name="check_content_block_format",
        ),
        Index("ix_exhibit_content_blocks_exhibition", "exhibition_id"),
        Index("ix_exhibit_content_blocks_type", "block_type"),
        Index("ix_exhibit_content_blocks_order", "exhibition_id", "display_order"),
        {"schema": "collections"},
    )


# ============================================================================
# EXHIBITION VENUES - Touring exhibition venue schedule
# ============================================================================

class ExhibitionVenue(Base):
    """
    Tracks venues for touring/traveling exhibitions.

    Supports both internal venues (linked to Venue model) and external
    venues (name/address stored directly for partner institutions).

    Status workflow:
    - proposed: Initial discussion
    - confirmed: Agreement reached
    - in_transit: Objects being shipped
    - installed: Setup complete
    - open: Exhibition open at venue
    - closing: Exhibition ending
    - returned: Objects returned

    Links to outgoing loan records for formal loan agreements.
    """
    __tablename__ = "exhibition_venues"

    exhibition_venue_id: Mapped[uuid.UUID] = uuid_pk()
    exhibition_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.exhibitions.exhibition_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Internal venue reference (for own venues)
    venue_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.venues.venue_id", ondelete="SET NULL"),
        nullable=True,
    )

    # External venue info (for partner institutions)
    external_venue_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    external_venue_address: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Contact at venue
    contact_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.constituents.constituent_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Tour schedule
    tour_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    planned_start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    planned_end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    actual_start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    actual_end_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Status workflow
    status: Mapped[str] = mapped_column(
        String(30), nullable=False, server_default="proposed"
    )

    # Loan agreement (for outgoing loans to external venues)
    loan_agreement_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.loans_out.loan_out_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Financial
    fee_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    fee_currency: Mapped[str | None] = mapped_column(String(3), nullable=True)

    # Notes
    special_requirements: Mapped[str | None] = mapped_column(Text, nullable=True)

    # PostGIS geometry for external venues (WGS84 / EPSG:4326)
    # For internal venues, use venue.geom instead
    geom: Mapped[Any | None] = mapped_column(
        Geometry(geometry_type="POINT", srid=4326, spatial_index=True),
        nullable=True,
    )

    # Timestamps
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    updated_at: Mapped[datetime] = timestamp_updated()

    # Relationships
    exhibition: Mapped["Exhibition"] = relationship("Exhibition", back_populates="tour_venues")
    venue: Mapped[Optional["Venue"]] = relationship("Venue")

    __table_args__ = (
        CheckConstraint(
            "status IN ('proposed', 'confirmed', 'in_transit', 'installed', 'open', 'closing', 'returned')",
            name="check_exhibition_venue_status",
        ),
        Index("ix_exhibition_venues_exhibition", "exhibition_id"),
        Index("ix_exhibition_venues_order", "exhibition_id", "tour_order"),
        Index("ix_exhibition_venues_status", "status"),
        {"schema": "collections"},
    )
