"""
Entity relationship service for managing cross-entity links.

Provides CRUD operations for EntityRelationship records, enabling entities
to be linked within or across datasets without data duplication.

Relationship types:
- hasMedia: Object has associated media files
- inExhibition: Object is part of an exhibition
- hasDonor: Object was donated by a person/organization
- relatedTo: General relationship between entities

Creation sources:
- manual: User-created through UI
- migration: Created during Flow migration
- rule: Created by automated matching rules (future)
"""

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import UUID

from sqlalchemy import and_, or_, desc, func
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.models import EntityRelationship, EntityCurrent, Dataset

logger = logging.getLogger(__name__)


# =============================================================================
# Data Classes
# =============================================================================


@dataclass
class RelationshipCreate:
    """Data for creating a new relationship."""
    source_entity_key: str
    target_entity_key: str
    relationship_type: str
    source_dataset_id: UUID | None = None
    target_dataset_id: UUID | None = None
    created_by_source: Literal["manual", "migration", "rule", "auto_link"] = "manual"
    confidence: float | None = None
    extra_data: dict | None = None
    created_by_user_id: UUID | None = None


@dataclass
class RelationshipResult:
    """Result of a relationship query with entity context."""
    relationship: EntityRelationship
    source_entity: EntityCurrent | None = None
    target_entity: EntityCurrent | None = None


# =============================================================================
# Core CRUD Operations
# =============================================================================


def create_relationship(
    session: Session,
    organization_id: UUID,
    data: RelationshipCreate,
    validate_entities: bool = False,
) -> EntityRelationship:
    """
    Create a new entity relationship.

    Args:
        session: Database session
        organization_id: Organization owning the relationship
        data: Relationship data
        validate_entities: If True, verify that referenced entities exist

    Returns:
        Created EntityRelationship

    Raises:
        ValueError: If relationship already exists or validation fails
        IntegrityError: If database constraint violated
    """
    # Validate source and target are different
    if data.source_entity_key == data.target_entity_key:
        raise ValueError("Source and target entity cannot be the same")

    # Validate confidence range if provided
    if data.confidence is not None and not (0.0 <= data.confidence <= 1.0):
        raise ValueError("Confidence must be between 0.0 and 1.0")

    # Optionally validate that entities exist
    if validate_entities:
        missing = []
        source_exists = session.query(EntityCurrent).filter_by(
            organization_id=organization_id,
            entity_key=data.source_entity_key,
        ).first()
        if not source_exists or source_exists.is_deleted:
            missing.append(f"source entity '{data.source_entity_key}'")

        target_exists = session.query(EntityCurrent).filter_by(
            organization_id=organization_id,
            entity_key=data.target_entity_key,
        ).first()
        if not target_exists or target_exists.is_deleted:
            missing.append(f"target entity '{data.target_entity_key}'")

        if missing:
            raise ValueError(f"Referenced entities not found: {', '.join(missing)}")

    relationship = EntityRelationship(
        organization_id=organization_id,
        source_entity_key=data.source_entity_key,
        source_dataset_id=data.source_dataset_id,
        target_entity_key=data.target_entity_key,
        target_dataset_id=data.target_dataset_id,
        relationship_type=data.relationship_type,
        created_by_source=data.created_by_source,
        confidence=data.confidence,
        extra_data=data.extra_data,
        created_by_user_id=data.created_by_user_id,
    )

    try:
        session.add(relationship)
        session.flush()
    except IntegrityError as e:
        session.rollback()
        # Handle unique constraint violation (index name differs between PostgreSQL and SQLite)
        error_str = str(e).lower()
        if "unique" in error_str and (
            "ix_entity_relationships_unique" in error_str
            or "entity_relationships.organization_id" in error_str
        ):
            raise ValueError(
                f"Relationship already exists: {data.source_entity_key} "
                f"--[{data.relationship_type}]--> {data.target_entity_key}"
            )
        raise

    logger.info(
        "Created relationship: %s --[%s]--> %s (org=%s, source=%s)",
        data.source_entity_key,
        data.relationship_type,
        data.target_entity_key,
        organization_id,
        data.created_by_source,
    )

    return relationship


def get_relationship(
    session: Session,
    organization_id: UUID,
    relationship_id: UUID,
) -> EntityRelationship | None:
    """
    Get a relationship by ID.

    Args:
        session: Database session
        organization_id: Organization to scope query
        relationship_id: Relationship UUID

    Returns:
        EntityRelationship or None if not found
    """
    return (
        session.query(EntityRelationship)
        .filter_by(
            organization_id=organization_id,
            relationship_id=relationship_id,
        )
        .first()
    )


def delete_relationship(
    session: Session,
    organization_id: UUID,
    relationship_id: UUID,
) -> bool:
    """
    Delete a relationship by ID.

    Args:
        session: Database session
        organization_id: Organization to scope query
        relationship_id: Relationship UUID

    Returns:
        True if deleted, False if not found
    """
    relationship = get_relationship(session, organization_id, relationship_id)
    if not relationship:
        return False

    session.delete(relationship)
    session.flush()

    logger.info(
        "Deleted relationship %s: %s --[%s]--> %s",
        relationship_id,
        relationship.source_entity_key,
        relationship.relationship_type,
        relationship.target_entity_key,
    )

    return True


# =============================================================================
# Query Operations
# =============================================================================


def get_outgoing_relationships(
    session: Session,
    organization_id: UUID,
    entity_key: str,
    relationship_type: str | None = None,
    include_entities: bool = False,
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[RelationshipResult], int]:
    """
    Get relationships where the entity is the source (outgoing).

    Args:
        session: Database session
        organization_id: Organization to scope query
        entity_key: Source entity key
        relationship_type: Optional filter by type
        include_entities: Whether to load related entity data
        limit: Maximum results
        offset: Skip N results

    Returns:
        Tuple of (results, total_count)
    """
    query = (
        session.query(EntityRelationship)
        .filter_by(organization_id=organization_id, source_entity_key=entity_key)
    )

    if relationship_type:
        query = query.filter(EntityRelationship.relationship_type == relationship_type)

    total_count = query.count()

    relationships = (
        query
        .order_by(EntityRelationship.relationship_type, EntityRelationship.created_at.desc())
        .limit(limit)
        .offset(offset)
        .all()
    )

    results = []
    for rel in relationships:
        result = RelationshipResult(relationship=rel)

        if include_entities:
            # Load target entity
            result.target_entity = (
                session.query(EntityCurrent)
                .filter_by(
                    organization_id=organization_id,
                    entity_key=rel.target_entity_key,
                )
                .first()
            )

        results.append(result)

    return results, total_count


def get_incoming_relationships(
    session: Session,
    organization_id: UUID,
    entity_key: str,
    relationship_type: str | None = None,
    include_entities: bool = False,
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[RelationshipResult], int]:
    """
    Get relationships where the entity is the target (incoming).

    Args:
        session: Database session
        organization_id: Organization to scope query
        entity_key: Target entity key
        relationship_type: Optional filter by type
        include_entities: Whether to load related entity data
        limit: Maximum results
        offset: Skip N results

    Returns:
        Tuple of (results, total_count)
    """
    query = (
        session.query(EntityRelationship)
        .filter_by(organization_id=organization_id, target_entity_key=entity_key)
    )

    if relationship_type:
        query = query.filter(EntityRelationship.relationship_type == relationship_type)

    total_count = query.count()

    relationships = (
        query
        .order_by(EntityRelationship.relationship_type, EntityRelationship.created_at.desc())
        .limit(limit)
        .offset(offset)
        .all()
    )

    results = []
    for rel in relationships:
        result = RelationshipResult(relationship=rel)

        if include_entities:
            # Load source entity
            result.source_entity = (
                session.query(EntityCurrent)
                .filter_by(
                    organization_id=organization_id,
                    entity_key=rel.source_entity_key,
                )
                .first()
            )

        results.append(result)

    return results, total_count


def get_all_relationships_for_entity(
    session: Session,
    organization_id: UUID,
    entity_key: str,
    relationship_type: str | None = None,
    include_entities: bool = False,
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[RelationshipResult], int]:
    """
    Get all relationships involving an entity (both directions).

    Args:
        session: Database session
        organization_id: Organization to scope query
        entity_key: Entity key (as source or target)
        relationship_type: Optional filter by type
        include_entities: Whether to load related entity data
        limit: Maximum results
        offset: Skip N results

    Returns:
        Tuple of (results, total_count)
    """
    query = (
        session.query(EntityRelationship)
        .filter(
            EntityRelationship.organization_id == organization_id,
            or_(
                EntityRelationship.source_entity_key == entity_key,
                EntityRelationship.target_entity_key == entity_key,
            )
        )
    )

    if relationship_type:
        query = query.filter(EntityRelationship.relationship_type == relationship_type)

    total_count = query.count()

    relationships = (
        query
        .order_by(EntityRelationship.relationship_type, EntityRelationship.created_at.desc())
        .limit(limit)
        .offset(offset)
        .all()
    )

    results = []
    for rel in relationships:
        result = RelationshipResult(relationship=rel)

        if include_entities:
            # Load the "other" entity (not the one we queried for)
            if rel.source_entity_key == entity_key:
                result.target_entity = (
                    session.query(EntityCurrent)
                    .filter_by(
                        organization_id=organization_id,
                        entity_key=rel.target_entity_key,
                    )
                    .first()
                )
            else:
                result.source_entity = (
                    session.query(EntityCurrent)
                    .filter_by(
                        organization_id=organization_id,
                        entity_key=rel.source_entity_key,
                    )
                    .first()
                )

        results.append(result)

    return results, total_count


def get_relationships_between_datasets(
    session: Session,
    organization_id: UUID,
    source_dataset_id: UUID,
    target_dataset_id: UUID,
    relationship_type: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[EntityRelationship], int]:
    """
    Get relationships between two datasets.

    Args:
        session: Database session
        organization_id: Organization to scope query
        source_dataset_id: Source dataset UUID
        target_dataset_id: Target dataset UUID
        relationship_type: Optional filter by type
        limit: Maximum results
        offset: Skip N results

    Returns:
        Tuple of (relationships, total_count)
    """
    query = (
        session.query(EntityRelationship)
        .filter_by(
            organization_id=organization_id,
            source_dataset_id=source_dataset_id,
            target_dataset_id=target_dataset_id,
        )
    )

    if relationship_type:
        query = query.filter(EntityRelationship.relationship_type == relationship_type)

    total_count = query.count()

    relationships = (
        query
        .order_by(EntityRelationship.created_at.desc())
        .limit(limit)
        .offset(offset)
        .all()
    )

    return relationships, total_count


def get_relationship_type_counts(
    session: Session,
    organization_id: UUID,
    entity_key: str | None = None,
    dataset_id: UUID | None = None,
) -> dict[str, int]:
    """
    Get counts of relationships by type.

    Args:
        session: Database session
        organization_id: Organization to scope query
        entity_key: Optional - count for specific entity
        dataset_id: Optional - count for specific dataset

    Returns:
        Dict mapping relationship_type to count
    """
    query = (
        session.query(
            EntityRelationship.relationship_type,
            func.count(EntityRelationship.relationship_id).label("count"),
        )
        .filter_by(organization_id=organization_id)
    )

    if entity_key:
        query = query.filter(
            or_(
                EntityRelationship.source_entity_key == entity_key,
                EntityRelationship.target_entity_key == entity_key,
            )
        )

    if dataset_id:
        query = query.filter(
            or_(
                EntityRelationship.source_dataset_id == dataset_id,
                EntityRelationship.target_dataset_id == dataset_id,
            )
        )

    query = query.group_by(EntityRelationship.relationship_type)

    return {row.relationship_type: row.count for row in query.all()}


# =============================================================================
# Batch Operations
# =============================================================================


def create_relationships_batch(
    session: Session,
    organization_id: UUID,
    relationships: list[RelationshipCreate],
    skip_duplicates: bool = True,
) -> tuple[int, int, list[str]]:
    """
    Create multiple relationships in a batch.

    Args:
        session: Database session
        organization_id: Organization owning the relationships
        relationships: List of relationship data
        skip_duplicates: If True, skip duplicates; if False, raise error

    Returns:
        Tuple of (created_count, skipped_count, errors)
    """
    created_count = 0
    skipped_count = 0
    errors = []

    for data in relationships:
        try:
            create_relationship(session, organization_id, data)
            created_count += 1
        except ValueError as e:
            if "already exists" in str(e) and skip_duplicates:
                skipped_count += 1
            else:
                errors.append(f"{data.source_entity_key} -> {data.target_entity_key}: {e}")
        except Exception as e:
            errors.append(f"{data.source_entity_key} -> {data.target_entity_key}: {e}")

    logger.info(
        "Batch create relationships: %d created, %d skipped, %d errors (org=%s)",
        created_count,
        skipped_count,
        len(errors),
        organization_id,
    )

    return created_count, skipped_count, errors


def delete_relationships_for_entity(
    session: Session,
    organization_id: UUID,
    entity_key: str,
) -> int:
    """
    Delete all relationships involving an entity.

    Used when an entity is deleted to clean up orphaned relationships.

    Args:
        session: Database session
        organization_id: Organization to scope query
        entity_key: Entity key to remove relationships for

    Returns:
        Number of relationships deleted
    """
    deleted_count = (
        session.query(EntityRelationship)
        .filter(
            EntityRelationship.organization_id == organization_id,
            or_(
                EntityRelationship.source_entity_key == entity_key,
                EntityRelationship.target_entity_key == entity_key,
            )
        )
        .delete(synchronize_session=False)
    )

    if deleted_count > 0:
        logger.info(
            "Deleted %d relationships for entity %s (org=%s)",
            deleted_count,
            entity_key,
            organization_id,
        )

    return deleted_count


# =============================================================================
# Validation Helpers
# =============================================================================


def validate_entity_exists(
    session: Session,
    organization_id: UUID,
    entity_key: str,
) -> bool:
    """
    Check if an entity exists.

    Args:
        session: Database session
        organization_id: Organization to scope query
        entity_key: Entity key to check

    Returns:
        True if entity exists
    """
    return (
        session.query(EntityCurrent)
        .filter_by(organization_id=organization_id, entity_key=entity_key)
        .first()
    ) is not None


def validate_relationship_type(relationship_type: str) -> bool:
    """
    Validate relationship type against known types.

    For now, accepts any non-empty string. In the future, this could
    enforce a controlled vocabulary from RelationshipTypeConfig.

    Args:
        relationship_type: Type to validate

    Returns:
        True if valid
    """
    if not relationship_type or not relationship_type.strip():
        return False

    # Reserved types that have semantic meaning
    KNOWN_TYPES = {
        "hasMedia",
        "inExhibition",
        "hasDonor",
        "hasAgent",
        "relatedTo",
        "partOf",
        "hasPart",
        "derivedFrom",
        "references",
    }

    # Accept known types or any camelCase/snake_case identifier
    if relationship_type in KNOWN_TYPES:
        return True

    # Accept custom types that look like identifiers
    import re
    return bool(re.match(r'^[a-zA-Z][a-zA-Z0-9_]*$', relationship_type))
