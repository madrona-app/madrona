"""
Auto-link service for evaluating relationship definitions on entity ingest.

This module provides functionality to automatically create entity relationships
when new entities are ingested, based on admin-configured RelationshipDefinitions
with auto_link_on_ingest=True.
"""

import logging
from uuid import UUID
from typing import Sequence

from sqlalchemy.orm import Session

from app.models import RelationshipDefinition, EntityCurrent, EntityRelationship


logger = logging.getLogger(__name__)


def get_auto_link_definitions(
    session: Session,
    organization_id: UUID,
    dataset_id: UUID | None = None,
) -> list[RelationshipDefinition]:
    """
    Get relationship definitions that should auto-link on ingest.

    Args:
        session: Database session
        organization_id: Organization to filter by
        dataset_id: Optional dataset to filter definitions by (source or target)

    Returns:
        List of enabled definitions with auto_link_on_ingest=True
    """
    query = session.query(RelationshipDefinition).filter(
        RelationshipDefinition.organization_id == organization_id,
        RelationshipDefinition.enabled == True,
        RelationshipDefinition.auto_link_on_ingest == True,
    )

    if dataset_id:
        # Include definitions where the dataset is either source or target
        query = query.filter(
            (RelationshipDefinition.source_dataset_id == dataset_id) |
            (RelationshipDefinition.target_dataset_id == dataset_id) |
            # Also include definitions without dataset constraints
            (
                (RelationshipDefinition.source_dataset_id.is_(None)) &
                (RelationshipDefinition.target_dataset_id.is_(None))
            )
        )

    return query.all()


def evaluate_auto_link_for_entities(
    session: Session,
    organization_id: UUID,
    entity_keys: Sequence[str],
    dataset_id: UUID | None = None,
) -> dict:
    """
    Evaluate auto-link definitions for a batch of newly ingested entities.

    For each entity, checks if any auto-link definitions match and creates
    relationships accordingly. This is called after entity upsert completes.

    Args:
        session: Database session
        organization_id: Organization ID
        entity_keys: List of entity keys that were just created/updated
        dataset_id: Optional dataset ID to filter definitions

    Returns:
        Dictionary with counts: {"definitions_evaluated": N, "relationships_created": N}
    """
    from app.services.relationship_definition_service import (
        extract_field_values,
        apply_transform,
    )
    from app.services.relationship_service import create_relationship

    if not entity_keys:
        return {"definitions_evaluated": 0, "relationships_created": 0}

    # Get applicable auto-link definitions
    definitions = get_auto_link_definitions(session, organization_id, dataset_id)

    if not definitions:
        return {"definitions_evaluated": 0, "relationships_created": 0}

    logger.debug(
        "Evaluating %d auto-link definitions for %d entities",
        len(definitions),
        len(entity_keys),
    )

    # Fetch the entities we're linking FROM
    source_entities = session.query(EntityCurrent).filter(
        EntityCurrent.organization_id == organization_id,
        EntityCurrent.entity_key.in_(entity_keys),
        EntityCurrent.deleted_at.is_(None),
    ).all()

    if not source_entities:
        return {"definitions_evaluated": len(definitions), "relationships_created": 0}

    total_created = 0

    for definition in definitions:
        created = _evaluate_definition_for_sources(
            session=session,
            organization_id=organization_id,
            definition=definition,
            source_entities=source_entities,
        )
        total_created += created

    return {
        "definitions_evaluated": len(definitions),
        "relationships_created": total_created,
    }


def _evaluate_definition_for_sources(
    session: Session,
    organization_id: UUID,
    definition: RelationshipDefinition,
    source_entities: list[EntityCurrent],
) -> int:
    """
    Evaluate a single definition against a list of source entities.

    For each source entity, extracts the source field value(s), finds matching
    target entities, and creates relationships.

    Returns:
        Number of relationships created
    """
    from app.services.relationship_definition_service import (
        extract_field_values,
        apply_transform,
    )

    created_count = 0

    # Build a map of source entity values for efficient matching
    source_value_map: dict[str, list[tuple[EntityCurrent, str]]] = {}

    for entity in source_entities:
        # Check entity type filter
        if definition.source_entity_type:
            entity_type = entity.payload.get("entity_type") if entity.payload else None
            if entity_type != definition.source_entity_type:
                continue

        # Check dataset filter
        if definition.source_dataset_id and entity.dataset_id != definition.source_dataset_id:
            continue

        # Extract values from source field path
        values = extract_field_values(entity.payload, definition.source_field_path)

        for value in values:
            if value is None:
                continue

            # Apply transform
            transformed = apply_transform(value, definition.match_transform)
            if not definition.case_sensitive:
                transformed = transformed.lower() if isinstance(transformed, str) else transformed

            # Group by transformed value
            key = str(transformed)
            if key not in source_value_map:
                source_value_map[key] = []
            source_value_map[key].append((entity, str(value)))

    if not source_value_map:
        return 0

    # Build query for potential target entities
    target_query = session.query(EntityCurrent).filter(
        EntityCurrent.organization_id == organization_id,
        EntityCurrent.deleted_at.is_(None),
    )

    # Apply target filters
    if definition.target_dataset_id:
        target_query = target_query.filter(
            EntityCurrent.dataset_id == definition.target_dataset_id
        )

    # Exclude source entities from being targets (no self-references)
    source_entity_keys = {e.entity_key for e in source_entities}

    # Fetch potential targets in batches
    target_entities = target_query.all()

    # Match targets to sources
    for target in target_entities:
        if target.entity_key in source_entity_keys:
            continue  # Skip self-references

        # Check entity type filter
        if definition.target_entity_type:
            entity_type = target.payload.get("entity_type") if target.payload else None
            if entity_type != definition.target_entity_type:
                continue

        # Extract values from target field path
        target_values = extract_field_values(target.payload, definition.target_field_path)

        for target_value in target_values:
            if target_value is None:
                continue

            # Apply transform
            transformed = apply_transform(target_value, definition.match_transform)
            if not definition.case_sensitive:
                transformed = transformed.lower() if isinstance(transformed, str) else transformed

            key = str(transformed)

            # Check for matches
            if key in source_value_map:
                for source_entity, source_value in source_value_map[key]:
                    # Create relationship
                    try:
                        _create_auto_link_relationship(
                            session=session,
                            organization_id=organization_id,
                            definition=definition,
                            source_entity=source_entity,
                            target_entity=target,
                        )
                        created_count += 1

                        # Create inverse if bidirectional
                        if definition.bidirectional and definition.inverse_relationship_type:
                            _create_auto_link_relationship(
                                session=session,
                                organization_id=organization_id,
                                definition=definition,
                                source_entity=target,
                                target_entity=source_entity,
                                relationship_type=definition.inverse_relationship_type,
                            )
                            created_count += 1

                    except Exception as e:
                        # Skip duplicates or other errors
                        logger.debug(
                            "Auto-link skipped: %s -> %s (%s): %s",
                            source_entity.entity_key,
                            target.entity_key,
                            definition.relationship_type,
                            str(e),
                        )

    return created_count


def _create_auto_link_relationship(
    session: Session,
    organization_id: UUID,
    definition: RelationshipDefinition,
    source_entity: EntityCurrent,
    target_entity: EntityCurrent,
    relationship_type: str | None = None,
) -> EntityRelationship:
    """
    Create a single auto-linked relationship.

    Args:
        session: Database session
        organization_id: Organization ID
        definition: The definition that triggered this relationship
        source_entity: Source entity
        target_entity: Target entity
        relationship_type: Override relationship type (for inverse relationships)

    Returns:
        Created EntityRelationship
    """
    from app.services.relationship_service import RelationshipCreate, create_relationship

    rel_data = RelationshipCreate(
        source_entity_key=source_entity.entity_key,
        target_entity_key=target_entity.entity_key,
        relationship_type=relationship_type or definition.relationship_type,
        created_by_source="auto_link",
        confidence=1.0,
        extra_data={"definition_id": str(definition.definition_id)},
    )

    relationship = create_relationship(session, organization_id, rel_data)

    # Link to definition
    relationship.definition_id = definition.definition_id

    return relationship
