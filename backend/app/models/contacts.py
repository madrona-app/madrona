from __future__ import annotations

"""
Contacts (Constituents) models - Unified person/organization records.

Extracted from models_collections.py.  Covers:
- Constituent (CDWA 28 / TMS Constituents)
- ConstituentXref (TMS ConXrefs - polymorphic entity-constituent links)
- ConstituentRelation (CDWA 28.1.5 - person-to-person relationships)
"""

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    DateTime,
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from geoalchemy2 import Geometry

from app.database import Base
from app.models._helpers import uuid_pk, timestamp_now, timestamp_updated


# ============================================================================
# CONTACTS - External parties (CDWA 23.5 Owner/Agent pattern)
# ============================================================================

class Constituent(Base):
    """
    Unified person/organization record (TMS Constituents pattern).

    Merges the former Contact (operational) and PersonAuthority (CDWA cataloging)
    into a single entity. Linked to any record via ConstituentXref cross-references,
    plus direct FKs on procedure tables for primary-constituent pointers.

    Supports:
    - CDWA Category 28 (Person/Corporate Body Authority)
    - procedure contact management
    - Getty ULAN integration
    """
    __tablename__ = "constituents"

    constituent_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Link to a user account, when this constituent IS a staff member (login
    # user). Lets people-references (examiner, conservator, …) resolve a staff
    # member as a constituent. Unique per org via uq_constituents_org_user.
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Constituent type
    constituent_type: Mapped[str] = mapped_column(String(20), nullable=False)

    # -- Operational fields (from Contact) --
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    first_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    last_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    title: Mapped[str | None] = mapped_column(String(100), nullable=True)
    role: Mapped[str | None] = mapped_column(String(100), nullable=True)
    organization_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    department: Mapped[str | None] = mapped_column(String(100), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    phone_secondary: Mapped[str | None] = mapped_column(String(50), nullable=True)
    website: Mapped[str | None] = mapped_column(String(500), nullable=True)
    address: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    geom: Mapped[Any | None] = mapped_column(
        Geometry(geometry_type="POINT", srid=4326, spatial_index=True),
        nullable=True,
    )
    contact_categories: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)

    # -- CDWA Identity (28.1) --
    sort_name: Mapped[str | None] = mapped_column(String(500), nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(500), nullable=True)
    given_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    family_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    name_prefix: Mapped[str | None] = mapped_column(String(50), nullable=True)
    name_suffix: Mapped[str | None] = mapped_column(String(50), nullable=True)
    name_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # variant_names JSONB removed -- use variant_names_list relationship instead
    nationality: Mapped[str | None] = mapped_column(String(100), nullable=True)
    nationalities: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    culture: Mapped[str | None] = mapped_column(String(100), nullable=True)
    life_roles: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    gender: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # -- CDWA Existence (28.2) --
    birth_date_display: Mapped[str | None] = mapped_column(String(100), nullable=True)
    birth_date_earliest: Mapped[date | None] = mapped_column(Date, nullable=True)
    birth_date_latest: Mapped[date | None] = mapped_column(Date, nullable=True)
    birth_place: Mapped[str | None] = mapped_column(String(255), nullable=True)
    birth_place_tgn_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    death_date_display: Mapped[str | None] = mapped_column(String(100), nullable=True)
    death_date_earliest: Mapped[date | None] = mapped_column(Date, nullable=True)
    death_date_latest: Mapped[date | None] = mapped_column(Date, nullable=True)
    death_place: Mapped[str | None] = mapped_column(String(255), nullable=True)
    death_place_tgn_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    active_date_display: Mapped[str | None] = mapped_column(String(100), nullable=True)
    active_date_earliest: Mapped[date | None] = mapped_column(Date, nullable=True)
    active_date_latest: Mapped[date | None] = mapped_column(Date, nullable=True)

    # -- CDWA Biography (28.4) --
    biography: Mapped[str | None] = mapped_column(Text, nullable=True)
    biography_source: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # -- External authorities (28.5) --
    ulan_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    ulan_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ulan_modified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    viaf_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    wikidata_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    loc_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    external_uris: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)

    # -- Status --
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    is_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    verified_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # -- Notes --
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    internal_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    cataloger_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # -- Audit --
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
        primaryjoin="Constituent.organization_id == Organization.organization_id",
    )
    xrefs: Mapped[list["ConstituentXref"]] = relationship(
        "ConstituentXref",
        back_populates="constituent",
    )
    related_from: Mapped[list["ConstituentRelation"]] = relationship(
        "ConstituentRelation",
        foreign_keys="ConstituentRelation.from_constituent_id",
        back_populates="from_constituent",
    )
    related_to: Mapped[list["ConstituentRelation"]] = relationship(
        "ConstituentRelation",
        foreign_keys="ConstituentRelation.to_constituent_id",
        back_populates="to_constituent",
    )
    variant_names_list: Mapped[list["VariantTerm"]] = relationship(
        "VariantTerm",
        primaryjoin="and_(VariantTerm.entity_id == Constituent.constituent_id, VariantTerm.entity_type == 'constituent')",
        foreign_keys="VariantTerm.entity_id",
        viewonly=True,
    )

    __table_args__ = (
        Index("ix_constituents_org", "organization_id"),
        Index("ix_constituents_org_name", "organization_id", "name"),
        Index("ix_constituents_org_type", "organization_id", "constituent_type"),
        Index("ix_constituents_org_status", "organization_id", "status"),
        Index("ix_constituents_org_ulan", "organization_id", "ulan_id", unique=True,
              postgresql_where=text("ulan_id IS NOT NULL")),
        Index("ix_constituents_user_id", "user_id"),
        # Same reason as the object-name trigram index: constituent search is
        # a `%term%` ILIKE over display_name.
        Index("ix_constituents_display_name_trgm", "display_name",
              postgresql_using="gin", postgresql_ops={"display_name": "gin_trgm_ops"}),
        # One staff constituent per user per org (the user↔constituent link).
        Index("uq_constituents_org_user", "organization_id", "user_id", unique=True,
              postgresql_where=text("user_id IS NOT NULL")),
        CheckConstraint(
            "constituent_type IN ('person', 'organization', 'corporate_body', 'family', "
            "'department', 'estate', 'dealer', 'auction_house', 'unknown')",
            name="check_constituent_type",
        ),
        CheckConstraint(
            "status IN ('active', 'deprecated', 'merged', 'deleted')",
            name="check_constituent_status",
        ),
        {"schema": "collections"},
    )


# ============================================================================
# CONSTITUENT MEDIA - Links media to constituents (portraits, logos, etc.)
# ============================================================================

class ConstituentMedia(Base):
    """
    Links media to constituents.

    Follows the same pattern as CollectionObjectMedia:
    - One constituent can have multiple media items
    - One media item can be linked to multiple constituents
    - Custom sort order and primary designation per constituent
    - Usage types: portrait, headshot, logo, official, other
    """
    __tablename__ = "constituent_media"

    constituent_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.constituents.constituent_id", ondelete="CASCADE"),
        primary_key=True,
    )
    media_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.media.media_id", ondelete="CASCADE"),
        primary_key=True,
    )

    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    caption_override: Mapped[str | None] = mapped_column(String(500), nullable=True)
    usage_type: Mapped[str | None] = mapped_column(String(50), nullable=True)

    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    constituent: Mapped["Constituent"] = relationship(
        "Constituent",
        primaryjoin="ConstituentMedia.constituent_id == Constituent.constituent_id",
    )
    media: Mapped["Media"] = relationship(
        "Media",
        primaryjoin="ConstituentMedia.media_id == Media.media_id",
    )

    __table_args__ = (
        Index("ix_constituent_media_constituent", "constituent_id"),
        Index("ix_constituent_media_media", "media_id"),
        Index("ix_constituent_media_primary", "constituent_id", "is_primary"),
        CheckConstraint(
            "usage_type IS NULL OR usage_type IN ('portrait', 'headshot', 'logo', 'official', 'other')",
            name="check_constituent_media_usage_type",
        ),
        {"schema": "collections"},
    )


# ============================================================================
# CONSTITUENT XREFS - Links constituents to any entity with typed role (TMS ConXrefs)
# ============================================================================

class ConstituentXref(Base):
    """
    Cross-reference linking a constituent to any entity with a typed role.

    Replaces object_contacts, object_person_authorities, procedure_contacts,
    and event_participants with a single polymorphic junction table.

    Follows the TMS ConXrefs pattern: one table handles all entity-constituent links.
    """
    __tablename__ = "constituent_xrefs"

    xref_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # The constituent
    constituent_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.constituents.constituent_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Polymorphic reference to any entity
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False)
    entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)

    # Role and attribution
    role: Mapped[str] = mapped_column(String(50), nullable=False)
    role_qualifier: Mapped[str | None] = mapped_column(String(100), nullable=True)
    attribution_certainty: Mapped[str | None] = mapped_column(String(20), nullable=True)
    attribution_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Display
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    display_name_override: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Context
    start_date: Mapped[str | None] = mapped_column(String(50), nullable=True)
    end_date: Mapped[str | None] = mapped_column(String(50), nullable=True)
    location: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Notes
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        onupdate=datetime.utcnow, nullable=True
    )

    # Relationships
    constituent: Mapped["Constituent"] = relationship(
        "Constituent",
        back_populates="xrefs",
    )

    __table_args__ = (
        UniqueConstraint("organization_id", "entity_type", "entity_id", "constituent_id", "role",
                         name="uq_constituent_xref_role"),
        Index("ix_constituent_xrefs_entity", "entity_type", "entity_id"),
        Index("ix_constituent_xrefs_constituent", "constituent_id"),
        Index("ix_constituent_xrefs_org", "organization_id"),
        Index("ix_constituent_xrefs_org_entity", "organization_id", "entity_type", "entity_id"),
        CheckConstraint(
            "entity_type IN ('collection_object', 'acquisition', 'valuation', 'movement', "
            "'loan_in', 'loan_out', 'shipment', 'object_entry', 'object_exit', "
            "'conservation_treatment', 'condition_report', 'deaccession', 'exhibition', "
            "'exhibition_loan', 'event', 'right', 'reproduction_request', 'use_request')",
            name="check_xref_entity_type",
        ),
        CheckConstraint(
            "attribution_certainty IS NULL OR attribution_certainty IN ('certain', 'probable', 'possible', 'doubtful')",
            name="check_xref_certainty",
        ),
        {"schema": "collections"},
    )


# ============================================================================
# CONSTITUENT RELATIONS - Person-to-person relationships (CDWA 28.1.5)
# ============================================================================

class ConstituentRelation(Base):
    """
    Relationships between constituents.

    CDWA 28.1.5 Related Persons - tracks relationships like:
    - teacher/student, master/apprentice, parent/child
    - spouse, sibling, colleague/collaborator
    - influenced_by/influenced, employed/employed_by
    """
    __tablename__ = "constituent_relations"

    relation_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    from_constituent_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.constituents.constituent_id", ondelete="CASCADE"),
        nullable=False,
    )
    to_constituent_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.constituents.constituent_id", ondelete="CASCADE"),
        nullable=False,
    )

    relationship_type: Mapped[str] = mapped_column(String(50), nullable=False)
    relationship_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    start_date: Mapped[str | None] = mapped_column(String(50), nullable=True)
    end_date: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    from_constituent: Mapped["Constituent"] = relationship(
        "Constituent",
        foreign_keys=[from_constituent_id],
        back_populates="related_from",
    )
    to_constituent: Mapped["Constituent"] = relationship(
        "Constituent",
        foreign_keys=[to_constituent_id],
        back_populates="related_to",
    )

    __table_args__ = (
        Index("ix_constituent_rel_from", "from_constituent_id"),
        Index("ix_constituent_rel_to", "to_constituent_id"),
        CheckConstraint(
            "relationship_type IN ('teacher_of', 'student_of', 'master_of', 'apprentice_of', "
            "'parent_of', 'child_of', 'spouse_of', 'sibling_of', 'collaborator_with', "
            "'influenced', 'influenced_by', 'employed', 'employed_by', 'member_of', 'other')",
            name="check_constituent_relation_type",
        ),
        {"schema": "collections"},
    )


# Backward-compat aliases used throughout the codebase
Contact = Constituent
PersonAuthority = Constituent
PersonAuthorityRelation = ConstituentRelation
ObjectPersonAuthority = ConstituentXref
ObjectContact = ConstituentXref
EventParticipant = ConstituentXref
ProcedureContact = ConstituentXref

__all__ = [
    "Constituent",
    "ConstituentXref",
    "ConstituentRelation",
    "Contact",
    "PersonAuthority",
    "PersonAuthorityRelation",
    "ObjectPersonAuthority",
    "ObjectContact",
    "EventParticipant",
    "ProcedureContact",
]
