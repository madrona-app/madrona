from __future__ import annotations

"""Authority models: places, style/periods, subjects."""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
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
from geoalchemy2 import Geometry

from app.database import Base
from app.models._helpers import uuid_pk, timestamp_now, timestamp_updated


# ============================================================================
# PLACE AUTHORITIES - Geographic authority records (CDWA 29)
# ============================================================================

class PlaceAuthority(Base):
    """
    Place/Geographic Authority Record (CDWA Category 29).

    Authority file for geographic locations with TGN integration.
    Supports hierarchical place data (city -> region -> country).

    CDWA Categories covered:
    - 29.1 Geographic Place (names, coordinates)
    - 29.2 Place Type (city, region, etc.)
    - 29.3 Place Hierarchy
    """
    __tablename__ = "place_authorities"

    place_authority_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Names
    preferred_name: Mapped[str] = mapped_column(String(500), nullable=False)
    # variant_names JSONB removed -- use VariantTerm model instead

    # Classification
    place_type: Mapped[str] = mapped_column(String(50), nullable=False, default="place")

    # External identifiers
    tgn_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    geonames_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    wikidata_id: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Geographic coordinates (legacy decimal fields)
    coordinates_lat: Mapped[Decimal | None] = mapped_column(Numeric(10, 7), nullable=True)
    coordinates_lng: Mapped[Decimal | None] = mapped_column(Numeric(10, 7), nullable=True)

    # PostGIS geometry for spatial queries (WGS84 / EPSG:4326)
    # Point geometry for single locations
    geom: Mapped[Any | None] = mapped_column(
        Geometry(geometry_type="POINT", srid=4326, spatial_index=True),
        nullable=True,
    )
    # Polygon geometry for areas (excavation sites, regions, geographic boundaries)
    geom_area: Mapped[Any | None] = mapped_column(
        Geometry(geometry_type="POLYGON", srid=4326, spatial_index=True),
        nullable=True,
    )

    # Hierarchy
    parent_place_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.place_authorities.place_authority_id", ondelete="SET NULL"),
        nullable=True,
    )
    hierarchy_path: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Administrative
    country_code: Mapped[str | None] = mapped_column(String(3), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")

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
        primaryjoin="PlaceAuthority.organization_id == Organization.organization_id",
    )
    parent_place: Mapped["PlaceAuthority | None"] = relationship(
        "PlaceAuthority",
        remote_side="PlaceAuthority.place_authority_id",
        foreign_keys=[parent_place_id],
    )
    object_links: Mapped[list["ObjectPlaceAuthority"]] = relationship(
        "ObjectPlaceAuthority",
        back_populates="place_authority",
        foreign_keys="ObjectPlaceAuthority.place_authority_id",
    )

    __table_args__ = (
        Index("ix_place_authorities_org", "organization_id"),
        Index("ix_place_authorities_name", "preferred_name"),
        Index("ix_place_authorities_tgn", "tgn_id"),
        Index("ix_place_authorities_parent", "parent_place_id"),
        CheckConstraint(
            "place_type IN ('city', 'region', 'country', 'site', 'building', 'district', "
            "'state', 'province', 'continent', 'body_of_water', 'place')",
            name="check_place_type",
        ),
        CheckConstraint(
            "status IN ('active', 'deprecated', 'merged')",
            name="check_place_auth_status",
        ),
        {"schema": "collections"},
    )


class ObjectPlaceAuthority(Base):
    """
    Links collection objects to place authorities with specific roles.

    Roles indicate the relationship between object and place:
    - creation_place: Where the object was made
    - discovery_place: Where the object was found (archaeological)
    - depicted_place: Place shown in the work
    - associated_place: Other significant location
    """
    __tablename__ = "object_place_authorities"

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
    place_authority_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.place_authorities.place_authority_id", ondelete="RESTRICT"),
        nullable=False,
    )

    # Role of place in relation to object
    role: Mapped[str] = mapped_column(String(50), nullable=False)

    # Date range for the association
    date_display: Mapped[str | None] = mapped_column(String(100), nullable=True)
    date_earliest: Mapped[date | None] = mapped_column(Date, nullable=True)
    date_latest: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Administrative
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="ObjectPlaceAuthority.organization_id == Organization.organization_id",
    )
    collection_object: Mapped["CollectionObject"] = relationship(
        "CollectionObject",
        primaryjoin="ObjectPlaceAuthority.object_id == CollectionObject.object_id",
    )
    place_authority: Mapped["PlaceAuthority"] = relationship(
        "PlaceAuthority",
        back_populates="object_links",
        foreign_keys=[place_authority_id],
    )

    __table_args__ = (
        Index("ix_object_place_auth_org", "organization_id"),
        Index("ix_object_place_auth_object", "object_id"),
        Index("ix_object_place_auth_place", "place_authority_id"),
        CheckConstraint(
            "role IN ('creation_place', 'discovery_place', 'depicted_place', 'associated_place', "
            "'former_location', 'original_location', 'intended_location')",
            name="check_place_role",
        ),
        {"schema": "collections"},
    )


# ============================================================================
# STYLE/PERIOD AUTHORITIES - Style and period authority records (CDWA 5)
# ============================================================================

class StylePeriodAuthority(Base):
    """
    Style/Period/Movement Authority Record (CDWA Category 5).

    Authority file for styles, periods, groups, movements, and schools.
    Supports AAT integration and hierarchical relationships.

    CDWA Categories covered:
    - 5.1 Style (artistic style)
    - 5.2 Period (chronological period)
    - 5.3 Group (stylistic grouping)
    - 5.4 Movement (art movement)
    - 5.5 School (artistic school)
    """
    __tablename__ = "style_period_authorities"

    authority_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Terms
    preferred_term: Mapped[str] = mapped_column(String(500), nullable=False)
    # variant_terms JSONB removed -- use VariantTerm model instead

    # Classification
    authority_type: Mapped[str] = mapped_column(String(50), nullable=False, default="style")

    # External identifiers
    aat_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    wikidata_id: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Context
    culture: Mapped[str | None] = mapped_column(String(255), nullable=True)
    date_display: Mapped[str | None] = mapped_column(String(100), nullable=True)
    date_earliest: Mapped[date | None] = mapped_column(Date, nullable=True)
    date_latest: Mapped[date | None] = mapped_column(Date, nullable=True)
    geographic_scope: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Hierarchy
    parent_authority_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.style_period_authorities.authority_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Documentation
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")

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
        primaryjoin="StylePeriodAuthority.organization_id == Organization.organization_id",
    )
    parent_authority: Mapped["StylePeriodAuthority | None"] = relationship(
        "StylePeriodAuthority",
        remote_side="StylePeriodAuthority.authority_id",
        foreign_keys=[parent_authority_id],
    )
    object_links: Mapped[list["ObjectStylePeriod"]] = relationship(
        "ObjectStylePeriod",
        back_populates="authority",
        foreign_keys="ObjectStylePeriod.authority_id",
    )

    __table_args__ = (
        Index("ix_style_period_auth_org", "organization_id"),
        Index("ix_style_period_auth_term", "preferred_term"),
        Index("ix_style_period_auth_aat", "aat_id"),
        Index("ix_style_period_auth_parent", "parent_authority_id"),
        CheckConstraint(
            "authority_type IN ('style', 'period', 'group', 'movement', 'school')",
            name="check_style_authority_type",
        ),
        CheckConstraint(
            "status IN ('active', 'deprecated', 'merged')",
            name="check_style_auth_status",
        ),
        {"schema": "collections"},
    )


class ObjectStylePeriod(Base):
    """
    Links collection objects to style/period authorities.

    Includes attribution certainty for scholarly precision.
    """
    __tablename__ = "object_style_periods"

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
    authority_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.style_period_authorities.authority_id", ondelete="RESTRICT"),
        nullable=False,
    )

    # Attribution
    assignment_certainty: Mapped[str | None] = mapped_column(String(20), nullable=True)
    assignment_note: Mapped[str | None] = mapped_column(Text, nullable=True)

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
        primaryjoin="ObjectStylePeriod.organization_id == Organization.organization_id",
    )
    collection_object: Mapped["CollectionObject"] = relationship(
        "CollectionObject",
        primaryjoin="ObjectStylePeriod.object_id == CollectionObject.object_id",
    )
    authority: Mapped["StylePeriodAuthority"] = relationship(
        "StylePeriodAuthority",
        back_populates="object_links",
        foreign_keys=[authority_id],
    )

    __table_args__ = (
        Index("ix_object_style_periods_org", "organization_id"),
        Index("ix_object_style_periods_object", "object_id"),
        Index("ix_object_style_periods_auth", "authority_id"),
        CheckConstraint(
            "assignment_certainty IS NULL OR assignment_certainty IN ('certain', 'probable', 'possible')",
            name="check_style_certainty",
        ),
        {"schema": "collections"},
    )


# ============================================================================
# SUBJECT AUTHORITIES - Iconographic subject authority records (CDWA 31)
# ============================================================================

class SubjectAuthority(Base):
    """
    Subject/Iconographic Authority Record (CDWA Category 31).

    Authority file for subjects, themes, and iconography.
    Supports AAT and Iconclass integration.

    CDWA Categories covered:
    - 31.1 Subject Matter (what is depicted)
    - 31.2 Iconography (symbolic meaning)
    - 31.3 Narrative (story or scene)
    """
    __tablename__ = "subject_authorities"

    authority_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Terms
    preferred_term: Mapped[str] = mapped_column(String(500), nullable=False)
    # variant_terms JSONB removed -- use VariantTerm model instead

    # Classification
    subject_type: Mapped[str] = mapped_column(String(50), nullable=False, default="thematic")

    # External identifiers
    aat_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    iconclass_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    wikidata_id: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Hierarchy
    broader_subject_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.subject_authorities.authority_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Documentation
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")

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
        primaryjoin="SubjectAuthority.organization_id == Organization.organization_id",
    )
    broader_subject: Mapped["SubjectAuthority | None"] = relationship(
        "SubjectAuthority",
        remote_side="SubjectAuthority.authority_id",
        foreign_keys=[broader_subject_id],
    )
    object_links: Mapped[list["ObjectSubject"]] = relationship(
        "ObjectSubject",
        back_populates="subject_authority",
        foreign_keys="ObjectSubject.subject_authority_id",
    )

    __table_args__ = (
        Index("ix_subject_authorities_org", "organization_id"),
        Index("ix_subject_authorities_term", "preferred_term"),
        Index("ix_subject_authorities_aat", "aat_id"),
        Index("ix_subject_authorities_iconclass", "iconclass_id"),
        Index("ix_subject_authorities_broader", "broader_subject_id"),
        CheckConstraint(
            "subject_type IN ('iconographic', 'narrative', 'thematic', 'genre', 'decorative', 'symbolic')",
            name="check_subject_type",
        ),
        CheckConstraint(
            "status IN ('active', 'deprecated', 'merged')",
            name="check_subject_auth_status",
        ),
        {"schema": "collections"},
    )


class ObjectSubject(Base):
    """
    Links collection objects to subject authorities.

    Includes subject extent for specifying which part of the work
    the subject applies to (e.g., "predella panel").
    """
    __tablename__ = "object_subjects"

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
    subject_authority_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.subject_authorities.authority_id", ondelete="RESTRICT"),
        nullable=False,
    )

    # Context
    subject_extent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    interpretation_note: Mapped[str | None] = mapped_column(Text, nullable=True)

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
        primaryjoin="ObjectSubject.organization_id == Organization.organization_id",
    )
    collection_object: Mapped["CollectionObject"] = relationship(
        "CollectionObject",
        primaryjoin="ObjectSubject.object_id == CollectionObject.object_id",
    )
    subject_authority: Mapped["SubjectAuthority"] = relationship(
        "SubjectAuthority",
        back_populates="object_links",
        foreign_keys=[subject_authority_id],
    )

    __table_args__ = (
        Index("ix_object_subjects_org", "organization_id"),
        Index("ix_object_subjects_object", "object_id"),
        Index("ix_object_subjects_subject", "subject_authority_id"),
        {"schema": "collections"},
    )


# ============================================================================
# VARIANT TERMS - Replaces variant_names/variant_terms JSONB
# ============================================================================

class VariantTerm(Base):
    """Alternate name/term for any authority or constituent entity."""
    __tablename__ = "variant_terms"

    term_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False)
    entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    term: Mapped[str] = mapped_column(String(500), nullable=False)
    term_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    language: Mapped[str | None] = mapped_column(String(10), nullable=True)
    source: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_historical: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        Index("ix_variant_terms_org", "organization_id"),
        Index("ix_variant_terms_entity", "entity_type", "entity_id"),
        Index("ix_variant_terms_term", "term"),
        {"schema": "collections"},
    )


__all__ = [
    "PlaceAuthority",
    "ObjectPlaceAuthority",
    "StylePeriodAuthority",
    "ObjectStylePeriod",
    "SubjectAuthority",
    "ObjectSubject",
    "VariantTerm",
]
