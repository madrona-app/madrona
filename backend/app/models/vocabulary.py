"""
Vocabulary and Controlled Vocabulary Models.

Defines models for cached vocabulary terms (Getty AAT, ULAN, TGN),
vocabulary mappings, and organization-scoped controlled lists (lookups).

All tables are in the 'collections' PostgreSQL schema.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    Boolean,
    CheckConstraint,
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

from app.database import Base
from app.models._helpers import uuid_pk, timestamp_now, timestamp_updated


# ============================================================================
# VOCABULARY TERMS - Controlled vocabulary cache
# ============================================================================

class VocabularyTerm(Base):
    """
    Cached vocabulary term from external sources (Getty AAT, ULAN, TGN).

    Local caching provides:
    - Faster autocomplete (no API latency)
    - Offline capability
    - Custom terms when needed
    - Audit trail of which terms are used

    organization_id = NULL means global term (from Getty, shared across all orgs)
    """
    __tablename__ = "vocabulary_terms"

    term_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=True,
    )

    # Term identification
    vocabulary: Mapped[str] = mapped_column(String(50), nullable=False)  # aat, ulan, tgn, local
    external_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    external_uri: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Term content
    preferred_term: Mapped[str] = mapped_column(String(500), nullable=False)
    alternate_terms: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    scope_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    term_type: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Hierarchy
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.vocabulary_terms.term_id", ondelete="SET NULL"),
        nullable=True,
    )
    hierarchy_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    broader_term: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Field applicability
    applicable_fields: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)

    # Usage tracking
    usage_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Status
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    is_custom: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()

    # Relationships
    organization: Mapped["Organization | None"] = relationship(
        "Organization",
        primaryjoin="VocabularyTerm.organization_id == Organization.organization_id",
    )
    parent: Mapped["VocabularyTerm | None"] = relationship(
        "VocabularyTerm",
        remote_side="VocabularyTerm.term_id",
        foreign_keys=[parent_id],
    )

    # New columns for Getty hierarchy support
    getty_modified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    hierarchy_fetched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    facet: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Relationships for hierarchy navigation
    broader_terms: Mapped[list["VocabularyTermRelationship"]] = relationship(
        "VocabularyTermRelationship",
        foreign_keys="VocabularyTermRelationship.term_id",
        primaryjoin="and_(VocabularyTerm.term_id == VocabularyTermRelationship.term_id, "
                    "VocabularyTermRelationship.relationship_type == 'broader')",
        back_populates="term",
        lazy="dynamic",
    )
    narrower_terms: Mapped[list["VocabularyTermRelationship"]] = relationship(
        "VocabularyTermRelationship",
        foreign_keys="VocabularyTermRelationship.term_id",
        primaryjoin="and_(VocabularyTerm.term_id == VocabularyTermRelationship.term_id, "
                    "VocabularyTermRelationship.relationship_type == 'narrower')",
        back_populates="term",
        lazy="dynamic",
    )
    related_terms: Mapped[list["VocabularyTermRelationship"]] = relationship(
        "VocabularyTermRelationship",
        foreign_keys="VocabularyTermRelationship.term_id",
        primaryjoin="and_(VocabularyTerm.term_id == VocabularyTermRelationship.term_id, "
                    "VocabularyTermRelationship.relationship_type == 'related')",
        back_populates="term",
        lazy="dynamic",
    )

    __table_args__ = (
        Index("ix_vocab_terms_org_vocab", "organization_id", "vocabulary"),
        Index("ix_vocab_terms_external", "vocabulary", "external_id"),
        Index("ix_vocab_terms_preferred", "preferred_term"),
        Index("ix_vocab_terms_facet", "facet"),
        Index("ix_vocab_terms_hierarchy_fetched", "hierarchy_fetched_at"),
        CheckConstraint(
            "vocabulary IN ('aat', 'ulan', 'tgn', 'local')",
            name="check_vocabulary_type",
        ),
        CheckConstraint(
            "status IN ('active', 'deprecated', 'rejected')",
            name="check_vocab_term_status",
        ),
        {"schema": "collections"},
    )


class VocabularyTermRelationship(Base):
    """
    Stores hierarchical relationships between vocabulary terms.

    Supports polyhierarchical vocabularies (terms can have multiple parents)
    like Getty AAT. Enables:
    - Hierarchy navigation (broader/narrower)
    - Search expansion (find narrower terms)
    - Related term suggestions

    Relationship types:
    - broader: Parent term (more general concept)
    - narrower: Child term (more specific concept)
    - related: Associated concept (same level, associative relationship)
    """
    __tablename__ = "vocabulary_term_relationships"

    relationship_id: Mapped[uuid.UUID] = uuid_pk()

    # The term this relationship is FROM
    term_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.vocabulary_terms.term_id", ondelete="CASCADE"),
        nullable=False,
    )

    # The term this relationship is TO
    related_term_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.vocabulary_terms.term_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Relationship type: broader, narrower, related
    relationship_type: Mapped[str] = mapped_column(String(20), nullable=False)

    # Source of this relationship
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="getty")

    # Audit
    created_at: Mapped[datetime] = timestamp_now()

    # Relationships
    term: Mapped["VocabularyTerm"] = relationship(
        "VocabularyTerm",
        foreign_keys=[term_id],
        back_populates="broader_terms",
        overlaps="narrower_terms,related_terms",
    )
    related_term: Mapped["VocabularyTerm"] = relationship(
        "VocabularyTerm",
        foreign_keys=[related_term_id],
    )

    __table_args__ = (
        Index("ix_vocab_rel_term", "term_id"),
        Index("ix_vocab_rel_related", "related_term_id"),
        Index("ix_vocab_rel_type", "relationship_type"),
        Index("ix_vocab_rel_term_type", "term_id", "relationship_type"),
        UniqueConstraint(
            "term_id", "related_term_id", "relationship_type",
            name="uq_vocab_rel_unique",
        ),
        CheckConstraint(
            "relationship_type IN ('broader', 'narrower', 'related')",
            name="check_relationship_type",
        ),
        CheckConstraint(
            "source IN ('getty', 'manual', 'inferred')",
            name="check_relationship_source",
        ),
        {"schema": "collections"},
    )


class VocabularyMapping(Base):
    """
    Maps legacy/source terms to controlled vocabulary terms.

    Used during migration to consistently map source data to standard terms.
    """
    __tablename__ = "vocabulary_mappings"

    mapping_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Source term
    source_term: Mapped[str] = mapped_column(String(500), nullable=False)
    source_field: Mapped[str] = mapped_column(String(100), nullable=False)
    source_system: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Target
    vocabulary_term_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.vocabulary_terms.term_id", ondelete="SET NULL"),
        nullable=True,
    )
    mapped_value: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Mapping metadata
    confidence: Mapped[str | None] = mapped_column(String(20), nullable=True)
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="VocabularyMapping.organization_id == Organization.organization_id",
    )
    vocabulary_term: Mapped["VocabularyTerm | None"] = relationship()
    reviewer: Mapped["User | None"] = relationship(
        "User",
        primaryjoin="VocabularyMapping.reviewed_by == User.user_id",
    )

    __table_args__ = (
        Index("ix_vocab_mappings_org_source", "organization_id", "source_term", "source_field"),
        CheckConstraint(
            "confidence IS NULL OR confidence IN ('exact', 'probable', 'possible', 'manual')",
            name="check_mapping_confidence",
        ),
        {"schema": "collections"},
    )


# ============================================================================
# CONTROLLED VOCABULARIES - Organization-scoped controlled lists
# ============================================================================

class OtherNumberType(Base):
    """
    Controlled vocabulary for Other Number types on collection objects.

    Each organization can define their own number types:
    - Alternate (default)
    - Accession Number
    - Old Inventory Number
    - Donor Number
    - etc.
    """
    __tablename__ = "other_number_types"

    type_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Type definition
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    code: Mapped[str] = mapped_column(String(50), nullable=False)  # Internal code for data
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Display
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)  # Cannot be deleted

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=text("NOW()"),
        onupdate=datetime.utcnow,
        nullable=False,
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    __table_args__ = (
        UniqueConstraint("organization_id", "code", name="uq_other_number_types_org_code"),
        Index("ix_other_number_types_org_active", "organization_id", "is_active"),
        {"schema": "collections"},
    )


class LookupCategory(Base):
    """
    Defines a category of lookup values (e.g., 'acquisition_method', 'condition').

    Categories are system-defined and cannot be created by organizations.
    Each category has metadata about where it's applicable and whether it supports icons.
    """
    __tablename__ = "lookup_categories"

    category_id: Mapped[uuid.UUID] = uuid_pk()
    category_key: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    applicable_contexts: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    supports_icons: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()

    # Relationships
    values: Mapped[list["LookupValue"]] = relationship(
        "LookupValue",
        back_populates="category",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_lookup_categories_key", "category_key"),
        {"schema": "collections"},
    )


class LookupValue(Base):
    """
    Individual lookup value within a category.

    Values can be:
    - System defaults (organization_id = NULL): Visible to all organizations
    - Organization-specific (organization_id = <UUID>): Visible only to that org

    Organizations can hide system defaults via is_hidden flag without deleting them.
    """
    __tablename__ = "lookup_values"

    value_id: Mapped[uuid.UUID] = uuid_pk()
    category_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.lookup_categories.category_id", ondelete="CASCADE"),
        nullable=False,
    )
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=True,
    )

    # Value definition
    value_key: Mapped[str] = mapped_column(String(100), nullable=False)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    icon_name: Mapped[str | None] = mapped_column(String(50), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Status
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_hidden: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()

    # Relationships
    category: Mapped["LookupCategory"] = relationship(
        "LookupCategory",
        back_populates="values",
    )
    organization: Mapped["Organization | None"] = relationship(
        "Organization",
        primaryjoin="LookupValue.organization_id == Organization.organization_id",
    )

    __table_args__ = (
        UniqueConstraint("category_id", "organization_id", "value_key", name="uq_lookup_value"),
        Index("ix_lookup_values_category", "category_id"),
        Index("ix_lookup_values_org", "organization_id"),
        Index("ix_lookup_values_category_org", "category_id", "organization_id"),
        {"schema": "collections"},
    )


class LookupSortOverride(Base):
    """
    Organization-specific sort order override for lookup values.

    Allows orgs to customize the display order of values (including system defaults)
    without modifying the values themselves.
    """
    __tablename__ = "lookup_sort_overrides"

    override_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    category_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.lookup_categories.category_id", ondelete="CASCADE"),
        nullable=False,
    )
    value_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.lookup_values.value_id", ondelete="CASCADE"),
        nullable=False,
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()

    # Relationships
    category: Mapped["LookupCategory"] = relationship("LookupCategory")
    value: Mapped["LookupValue"] = relationship("LookupValue")

    __table_args__ = (
        UniqueConstraint("organization_id", "value_id", name="uq_lookup_sort_override"),
        Index("ix_lookup_sort_overrides_org", "organization_id"),
        Index("ix_lookup_sort_overrides_category", "organization_id", "category_id"),
        {"schema": "collections"},
    )


__all__ = [
    "VocabularyTerm",
    "VocabularyTermRelationship",
    "VocabularyMapping",
    "OtherNumberType",
    "LookupCategory",
    "LookupValue",
    "LookupSortOverride",
]
