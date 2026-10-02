"""
Relationship definition service for managing admin-configured linking rules.

Provides CRUD operations for RelationshipDefinition records and the matching
logic to evaluate definitions and create EntityRelationship records.

Field path syntax supports:
- Simple paths: "payload.title"
- Nested paths: "payload.identifiers.accession"
- Array wildcards: "payload.media_refs[*].id"
- Filtered arrays: "payload.identifiers[scheme=isbn].value"
"""

import logging
import re
from dataclasses import dataclass
from typing import Any, Callable, Iterator
from uuid import UUID

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.models import RelationshipDefinition, EntityRelationship, EntityCurrent

logger = logging.getLogger(__name__)


# =============================================================================
# Data Classes
# =============================================================================


@dataclass
class DefinitionCreate:
    """Data for creating a new relationship definition."""
    name: str
    relationship_type: str
    source_field_path: str
    target_field_path: str
    description: str | None = None
    source_dataset_id: UUID | None = None
    source_entity_type: str | None = None
    target_dataset_id: UUID | None = None
    target_entity_type: str | None = None
    match_transform: str = "exact"
    case_sensitive: bool = True
    enabled: bool = True
    auto_link_on_ingest: bool = False
    bidirectional: bool = False
    inverse_relationship_type: str | None = None
    created_by_user_id: UUID | None = None


@dataclass
class DefinitionUpdate:
    """Data for updating a relationship definition."""
    name: str | None = None
    description: str | None = None
    source_field_path: str | None = None
    target_field_path: str | None = None
    match_transform: str | None = None
    case_sensitive: bool | None = None
    enabled: bool | None = None
    auto_link_on_ingest: bool | None = None
    bidirectional: bool | None = None
    inverse_relationship_type: str | None = None


@dataclass
class MatchResult:
    """Result of matching entities using a definition."""
    source_entity_key: str
    target_entity_key: str
    source_value: str
    target_value: str
    confidence: float = 1.0


# =============================================================================
# Field Path Extraction
# =============================================================================


def extract_field_values(payload: dict, field_path: str) -> list[str]:
    """
    Extract values from a payload using a field path.

    Supports:
    - Simple: "payload.title" -> single value
    - Nested: "payload.identifiers.accession" -> single value
    - Array wildcard: "payload.media_refs[*].id" -> all values
    - Filtered array: "payload.identifiers[scheme=isbn].value" -> filtered values

    Args:
        payload: Entity payload dict
        field_path: Field path expression

    Returns:
        List of extracted string values (empty list if not found)
    """
    if not payload or not field_path:
        return []

    # Remove "payload." prefix if present (we're already in payload)
    if field_path.startswith("payload."):
        field_path = field_path[8:]

    return _extract_recursive(payload, field_path.split("."))


def _extract_recursive(obj: Any, path_parts: list[str]) -> list[str]:
    """Recursively extract values from nested structure."""
    if not path_parts:
        # Base case: convert to string
        if obj is None:
            return []
        if isinstance(obj, list):
            return [str(v) for v in obj if v is not None]
        return [str(obj)]

    if obj is None:
        return []

    current_part = path_parts[0]
    remaining_parts = path_parts[1:]

    # Handle array notation
    if "[" in current_part:
        return _extract_array(obj, current_part, remaining_parts)

    # Handle dict access
    if isinstance(obj, dict):
        if current_part in obj:
            return _extract_recursive(obj[current_part], remaining_parts)
        return []

    # Handle list (implicit wildcard)
    if isinstance(obj, list):
        results = []
        for item in obj:
            if isinstance(item, dict) and current_part in item:
                results.extend(_extract_recursive(item[current_part], remaining_parts))
        return results

    return []


def _extract_array(obj: Any, array_part: str, remaining_parts: list[str]) -> list[str]:
    """Handle array notation in field path."""
    # Parse array part: "field[*]" or "field[key=value]"
    match = re.match(r"(\w+)\[([^\]]+)\]", array_part)
    if not match:
        return []

    field_name, selector = match.groups()

    # Get the array
    if isinstance(obj, dict):
        arr = obj.get(field_name, [])
    else:
        return []

    if not isinstance(arr, list):
        return []

    # Wildcard: select all
    if selector == "*":
        results = []
        for item in arr:
            results.extend(_extract_recursive(item, remaining_parts))
        return results

    # Filter: key=value
    if "=" in selector:
        filter_key, filter_value = selector.split("=", 1)
        results = []
        for item in arr:
            if isinstance(item, dict):
                if str(item.get(filter_key, "")) == filter_value:
                    results.extend(_extract_recursive(item, remaining_parts))
        return results

    # Index: numeric
    if selector.isdigit():
        idx = int(selector)
        if 0 <= idx < len(arr):
            return _extract_recursive(arr[idx], remaining_parts)
        return []

    return []


# =============================================================================
# Value Transforms
# =============================================================================


def apply_transform(value: str, transform: str, case_sensitive: bool = True) -> str:
    """
    Apply a transform to a value before matching.

    Args:
        value: Value to transform
        transform: Transform type
        case_sensitive: Whether to preserve case

    Returns:
        Transformed value
    """
    if not value:
        return ""

    result = value

    if transform == "lowercase" or not case_sensitive:
        result = result.lower()
    elif transform == "trim":
        result = result.strip()
    elif transform == "normalize_whitespace":
        result = " ".join(result.split())
    elif transform == "normalize_id":
        # Remove common ID prefixes and normalize
        result = re.sub(r"^(id:|ref:|#)", "", result, flags=re.IGNORECASE)
        result = result.strip().lower()
    # "exact" = no transform

    return result


# =============================================================================
# CRUD Operations
# =============================================================================


def create_definition(
    session: Session,
    organization_id: UUID,
    data: DefinitionCreate,
) -> RelationshipDefinition:
    """
    Create a new relationship definition.

    Args:
        session: Database session
        organization_id: Organization owning the definition
        data: Definition data

    Returns:
        Created RelationshipDefinition

    Raises:
        ValueError: If validation fails
    """
    # Validate match_transform
    valid_transforms = ("exact", "lowercase", "trim", "normalize_whitespace", "normalize_id")
    if data.match_transform not in valid_transforms:
        raise ValueError(f"match_transform must be one of: {valid_transforms}")

    # Validate bidirectional requires inverse_relationship_type
    if data.bidirectional and not data.inverse_relationship_type:
        raise ValueError("bidirectional definitions require inverse_relationship_type")

    definition = RelationshipDefinition(
        organization_id=organization_id,
        name=data.name,
        description=data.description,
        relationship_type=data.relationship_type,
        source_dataset_id=data.source_dataset_id,
        source_entity_type=data.source_entity_type,
        source_field_path=data.source_field_path,
        target_dataset_id=data.target_dataset_id,
        target_entity_type=data.target_entity_type,
        target_field_path=data.target_field_path,
        match_transform=data.match_transform,
        case_sensitive=data.case_sensitive,
        enabled=data.enabled,
        auto_link_on_ingest=data.auto_link_on_ingest,
        bidirectional=data.bidirectional,
        inverse_relationship_type=data.inverse_relationship_type,
        created_by_user_id=data.created_by_user_id,
    )

    session.add(definition)
    session.flush()

    logger.info(
        "Created relationship definition '%s' (org=%s, type=%s)",
        data.name,
        organization_id,
        data.relationship_type,
    )

    return definition


def get_definition(
    session: Session,
    organization_id: UUID,
    definition_id: UUID,
) -> RelationshipDefinition | None:
    """Get a definition by ID."""
    return (
        session.query(RelationshipDefinition)
        .filter_by(
            organization_id=organization_id,
            definition_id=definition_id,
        )
        .first()
    )


def update_definition(
    session: Session,
    organization_id: UUID,
    definition_id: UUID,
    data: DefinitionUpdate,
) -> RelationshipDefinition | None:
    """
    Update a relationship definition.

    Args:
        session: Database session
        organization_id: Organization scope
        definition_id: Definition to update
        data: Fields to update (None = no change)

    Returns:
        Updated definition or None if not found
    """
    definition = get_definition(session, organization_id, definition_id)
    if not definition:
        return None

    # Update fields that are provided
    if data.name is not None:
        definition.name = data.name
    if data.description is not None:
        definition.description = data.description
    if data.source_field_path is not None:
        definition.source_field_path = data.source_field_path
    if data.target_field_path is not None:
        definition.target_field_path = data.target_field_path
    if data.match_transform is not None:
        valid_transforms = ("exact", "lowercase", "trim", "normalize_whitespace", "normalize_id")
        if data.match_transform not in valid_transforms:
            raise ValueError(f"match_transform must be one of: {valid_transforms}")
        definition.match_transform = data.match_transform
    if data.case_sensitive is not None:
        definition.case_sensitive = data.case_sensitive
    if data.enabled is not None:
        definition.enabled = data.enabled
    if data.auto_link_on_ingest is not None:
        definition.auto_link_on_ingest = data.auto_link_on_ingest
    if data.bidirectional is not None:
        definition.bidirectional = data.bidirectional
    if data.inverse_relationship_type is not None:
        definition.inverse_relationship_type = data.inverse_relationship_type

    session.flush()

    logger.info(
        "Updated relationship definition '%s' (id=%s)",
        definition.name,
        definition_id,
    )

    return definition


def delete_definition(
    session: Session,
    organization_id: UUID,
    definition_id: UUID,
) -> bool:
    """Delete a definition by ID."""
    definition = get_definition(session, organization_id, definition_id)
    if not definition:
        return False

    session.delete(definition)
    session.flush()

    logger.info(
        "Deleted relationship definition '%s' (id=%s)",
        definition.name,
        definition_id,
    )

    return True


def list_definitions(
    session: Session,
    organization_id: UUID,
    source_dataset_id: UUID | None = None,
    target_dataset_id: UUID | None = None,
    relationship_type: str | None = None,
    enabled_only: bool = False,
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[RelationshipDefinition], int]:
    """
    List relationship definitions with optional filtering.

    Args:
        session: Database session
        organization_id: Organization scope
        source_dataset_id: Filter by source dataset
        target_dataset_id: Filter by target dataset
        relationship_type: Filter by relationship type
        enabled_only: Only return enabled definitions
        limit: Max results
        offset: Skip N results

    Returns:
        Tuple of (definitions, total_count)
    """
    query = (
        session.query(RelationshipDefinition)
        .filter_by(organization_id=organization_id)
    )

    if source_dataset_id:
        query = query.filter(RelationshipDefinition.source_dataset_id == source_dataset_id)

    if target_dataset_id:
        query = query.filter(RelationshipDefinition.target_dataset_id == target_dataset_id)

    if relationship_type:
        query = query.filter(RelationshipDefinition.relationship_type == relationship_type)

    if enabled_only:
        query = query.filter(RelationshipDefinition.enabled == True)

    total_count = query.count()

    definitions = (
        query
        .order_by(RelationshipDefinition.name)
        .limit(limit)
        .offset(offset)
        .all()
    )

    return definitions, total_count


def get_definitions_for_ingest(
    session: Session,
    organization_id: UUID,
    dataset_id: UUID,
    entity_type: str | None = None,
) -> list[RelationshipDefinition]:
    """
    Get definitions that should be evaluated on entity ingest.

    Finds definitions where:
    - auto_link_on_ingest is True
    - enabled is True
    - source_dataset_id matches (or is null for any dataset)
    - source_entity_type matches (or is null for any type)

    Args:
        session: Database session
        organization_id: Organization scope
        dataset_id: Dataset being ingested into
        entity_type: Entity type being ingested

    Returns:
        List of definitions to evaluate
    """
    query = (
        session.query(RelationshipDefinition)
        .filter_by(
            organization_id=organization_id,
            enabled=True,
            auto_link_on_ingest=True,
        )
        .filter(
            or_(
                RelationshipDefinition.source_dataset_id == dataset_id,
                RelationshipDefinition.source_dataset_id.is_(None),
            )
        )
    )

    if entity_type:
        query = query.filter(
            or_(
                RelationshipDefinition.source_entity_type == entity_type,
                RelationshipDefinition.source_entity_type.is_(None),
            )
        )

    return query.all()


# =============================================================================
# Matching / Evaluation
# =============================================================================


def evaluate_definition(
    session: Session,
    organization_id: UUID,
    definition: RelationshipDefinition,
    source_entities: list[EntityCurrent] | None = None,
    batch_size: int = 100,
) -> Iterator[MatchResult]:
    """
    Evaluate a definition and yield matching entity pairs.

    If source_entities is provided, only evaluates those entities.
    Otherwise, evaluates all entities matching the definition's source criteria.

    Args:
        session: Database session
        organization_id: Organization scope
        definition: Definition to evaluate
        source_entities: Optional specific entities to evaluate
        batch_size: Batch size for target entity queries

    Yields:
        MatchResult for each matched pair
    """
    # Get source entities if not provided
    if source_entities is None:
        source_query = (
            session.query(EntityCurrent)
            .filter_by(organization_id=organization_id)
        )

        if definition.source_dataset_id:
            source_query = source_query.filter(
                EntityCurrent.dataset_id == definition.source_dataset_id
            )

        if definition.source_entity_type:
            source_query = source_query.filter(
                EntityCurrent.entity_type == definition.source_entity_type
            )

        source_entities = source_query.yield_per(batch_size)

    # Build target entity lookup
    # For efficiency, we could build an index, but for now we'll query per batch
    for source_entity in source_entities:
        # Extract values from source
        source_values = extract_field_values(
            source_entity.payload or {},
            definition.source_field_path,
        )

        if not source_values:
            continue

        # Transform source values
        transformed_source_values = [
            apply_transform(v, definition.match_transform, definition.case_sensitive)
            for v in source_values
        ]

        # Find matching targets
        target_query = (
            session.query(EntityCurrent)
            .filter_by(organization_id=organization_id)
        )

        if definition.target_dataset_id:
            target_query = target_query.filter(
                EntityCurrent.dataset_id == definition.target_dataset_id
            )

        if definition.target_entity_type:
            target_query = target_query.filter(
                EntityCurrent.entity_type == definition.target_entity_type
            )

        # Exclude self-references
        target_query = target_query.filter(
            EntityCurrent.entity_key != source_entity.entity_key
        )

        for target_entity in target_query.yield_per(batch_size):
            target_values = extract_field_values(
                target_entity.payload or {},
                definition.target_field_path,
            )

            for target_value in target_values:
                transformed_target = apply_transform(
                    target_value,
                    definition.match_transform,
                    definition.case_sensitive,
                )

                if transformed_target in transformed_source_values:
                    # Find the original source value that matched
                    for i, tsv in enumerate(transformed_source_values):
                        if tsv == transformed_target:
                            yield MatchResult(
                                source_entity_key=source_entity.entity_key,
                                target_entity_key=target_entity.entity_key,
                                source_value=source_values[i],
                                target_value=target_value,
                            )
                            break


def create_relationships_from_definition(
    session: Session,
    organization_id: UUID,
    definition: RelationshipDefinition,
    source_entities: list[EntityCurrent] | None = None,
    skip_existing: bool = True,
) -> tuple[int, int, list[str]]:
    """
    Evaluate a definition and create relationships for matches.

    Args:
        session: Database session
        organization_id: Organization scope
        definition: Definition to evaluate
        source_entities: Optional specific entities to evaluate
        skip_existing: Skip if relationship already exists

    Returns:
        Tuple of (created_count, skipped_count, errors)
    """
    from app.services.relationship_service import (
        RelationshipCreate,
        create_relationship,
    )

    created_count = 0
    skipped_count = 0
    errors = []

    for match in evaluate_definition(session, organization_id, definition, source_entities):
        # Create forward relationship
        try:
            rel_data = RelationshipCreate(
                source_entity_key=match.source_entity_key,
                target_entity_key=match.target_entity_key,
                relationship_type=definition.relationship_type,
                source_dataset_id=definition.source_dataset_id,
                target_dataset_id=definition.target_dataset_id,
                created_by_source="rule",
                confidence=match.confidence,
                extra_data={
                    "matched_source_value": match.source_value,
                    "matched_target_value": match.target_value,
                },
            )

            rel = create_relationship(session, organization_id, rel_data)
            rel.definition_id = definition.definition_id
            created_count += 1

        except ValueError as e:
            if "already exists" in str(e) and skip_existing:
                skipped_count += 1
            else:
                errors.append(f"{match.source_entity_key} -> {match.target_entity_key}: {e}")

        # Create inverse relationship if bidirectional
        if definition.bidirectional and definition.inverse_relationship_type:
            try:
                inverse_data = RelationshipCreate(
                    source_entity_key=match.target_entity_key,
                    target_entity_key=match.source_entity_key,
                    relationship_type=definition.inverse_relationship_type,
                    source_dataset_id=definition.target_dataset_id,
                    target_dataset_id=definition.source_dataset_id,
                    created_by_source="rule",
                    confidence=match.confidence,
                    extra_data={
                        "matched_source_value": match.target_value,
                        "matched_target_value": match.source_value,
                        "inverse_of": definition.relationship_type,
                    },
                )

                inverse_rel = create_relationship(session, organization_id, inverse_data)
                inverse_rel.definition_id = definition.definition_id
                created_count += 1

            except ValueError as e:
                if "already exists" in str(e) and skip_existing:
                    skipped_count += 1
                else:
                    errors.append(f"{match.target_entity_key} -> {match.source_entity_key}: {e}")

    logger.info(
        "Evaluated definition '%s': %d created, %d skipped, %d errors",
        definition.name,
        created_count,
        skipped_count,
        len(errors),
    )

    return created_count, skipped_count, errors


def evaluate_for_entity(
    session: Session,
    organization_id: UUID,
    entity: EntityCurrent,
) -> tuple[int, int, list[str]]:
    """
    Evaluate all auto-link definitions for a newly ingested entity.

    Called during pipeline ingestion when auto_link_on_ingest definitions exist.

    Args:
        session: Database session
        organization_id: Organization scope
        entity: Entity that was just ingested

    Returns:
        Tuple of (created_count, skipped_count, errors)
    """
    definitions = get_definitions_for_ingest(
        session,
        organization_id,
        entity.dataset_id,
        entity.entity_type,
    )

    total_created = 0
    total_skipped = 0
    all_errors = []

    for definition in definitions:
        created, skipped, errors = create_relationships_from_definition(
            session,
            organization_id,
            definition,
            source_entities=[entity],
        )
        total_created += created
        total_skipped += skipped
        all_errors.extend(errors)

    return total_created, total_skipped, all_errors
