"""
Canonical store service for upserting entities and emitting change events.

Handles:
- Upsert to entity_current and entity_fields
- Payload hash computation with stable key ordering
- Change detection by comparing hashes
- Change event emission (created/updated/noop)
- Last-seen tracking for diagnostic purposes
- Canonical schema validation (Phase 1: warn-only; Phase 2: enforce)

Architecture decisions:
- Diffs projected fields only (title, object_number, etc.) not full payload
- Updates last_seen_at even on noop to prove entity was processed
- Application-level duplicate check for change events
- Uses query-then-update pattern (TODO: Consider merge() for concurrency)

Canonical Schema (v1):
- In Phase 1, validation is warn-only (CANONICAL_VALIDATION_MODE=warn)
- In Phase 2, validation will reject invalid payloads (CANONICAL_VALIDATION_MODE=error)
- Legacy payloads (pre-canonical) are detected and handled gracefully
- New ingests should produce CanonicalRecord envelope via connector.normalize()
"""

import logging
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.models import EntityCurrent, EntityField, ChangeEvent, FieldDiff
from app.schemas.canonical import (
    CanonicalDraft,
    CanonicalRecord,
    validate_canonical_record,
    validate_canonical_draft,
    finalize_draft,
    is_canonical_payload,
    compute_canonical_hash,
)

# Import classification task (lazy to avoid circular imports)
def _queue_classification(entity_key: str, organization_id: UUID):
    """Queue background classification task."""
    try:
        from app.tasks.classification import classify_entity_task
        classify_entity_task.delay(
            entity_key=entity_key,
            organization_id=str(organization_id),
            force_ai=False
        )
        logger.debug(f"Queued classification for entity {entity_key}")
    except Exception as e:
        logger.warning(f"Failed to queue classification for {entity_key}: {e}")


def _queue_search_index(entity_key: str, organization_id: UUID, payload: dict):
    """Queue search indexing task."""
    try:
        from app.tasks.search import index_entity_task
        index_entity_task.delay(
            entity_key=entity_key,
            organization_id=str(organization_id),
            payload=payload,
        )
        logger.debug(f"Queued search index for entity {entity_key}")
    except Exception as e:
        logger.warning(f"Failed to queue search index for {entity_key}: {e}")


def _queue_search_delete(entity_key: str, organization_id: UUID):
    """Queue search deletion task."""
    try:
        from app.tasks.search import delete_entity_task
        delete_entity_task.delay(
            entity_key=entity_key,
            organization_id=str(organization_id),
        )
        logger.debug(f"Queued search delete for entity {entity_key}")
    except Exception as e:
        logger.warning(f"Failed to queue search delete for {entity_key}: {e}")


def _build_search_payload(entity: EntityCurrent) -> dict:
    """Build payload for search indexing from an entity."""
    return {
        "organization_id": str(entity.organization_id),
        "entity_key": entity.entity_key,
        "entity_type": entity.entity_type,
        "source_system": entity.source_system,
        "source_id": entity.source_id,
        "dataset_id": str(entity.dataset_id) if entity.dataset_id else None,
        "payload": entity.payload,
        "last_seen_at": entity.last_seen_at.isoformat() if entity.last_seen_at else None,
        "updated_at": entity.updated_at.isoformat() if entity.updated_at else None,
    }

logger = logging.getLogger(__name__)

# Projected fields for change detection (user-visible fields only)
# Prevents noise from metadata changes in full payload
PROJECTED_FIELDS_FOR_DIFF = [
    "title",
    "object_number",
    "modified_at",
    "thumbnail_url",
    "canonical_url",
]

# Canonical schema projected fields (used when payload is CanonicalRecord)
CANONICAL_PROJECTED_FIELDS = [
    "label",  # Maps to title in entity_fields
    "description",
    "status",
]

# Mapping from canonical field names to legacy/display field names
# Used for consistent change detection across both payload formats
CANONICAL_TO_LEGACY_FIELD_MAP = {
    "label": "label",  # Canonical uses 'label' directly
    "description": "description",
    "status": "status",
}


def _get_validation_mode() -> str:
    """
    Get canonical validation mode from settings.

    Returns:
        "warn" or "error"
    """
    try:
        from app.config import get_settings
        return get_settings().canonical_validation_mode
    except Exception:
        return "warn"  # Default to warn on settings load failure


class CanonicalValidationError(Exception):
    """
    Raised when canonical validation fails in error mode.

    In Phase 1 (warn mode), this is never raised - only logged.
    In Phase 2 (error mode), this blocks ingestion of invalid records.
    """
    def __init__(self, entity_key: str, errors: list[str]):
        self.entity_key = entity_key
        self.errors = errors
        super().__init__(f"Canonical validation failed for {entity_key}: {errors}")


def validate_and_finalize_payload(
    canonical_record: dict[str, Any],
    source_system: str,
    source_id: str,
    dataset_id: str | None = None,
    pipeline_id: str | None = None,
    existing_created_at: datetime | None = None,
) -> tuple[dict[str, Any], bool, list[str]]:
    """
    Validate and finalize a canonical record payload.

    This function handles both legacy and canonical payload formats:
    1. If payload is already a CanonicalRecord, validate it
    2. If payload looks like a CanonicalDraft, finalize and validate it
    3. If payload is legacy format, pass through with warning

    Args:
        canonical_record: The connector's normalized output
        source_system: Source system identifier (may be namespaced by pipeline)
        source_id: Record ID in source system (may be namespaced by pipeline)
        dataset_id: Optional dataset identifier
        pipeline_id: Optional pipeline identifier
        existing_created_at: Preserve original createdAt if updating

    Returns:
        Tuple of (finalized_payload, is_canonical, validation_errors)
        - finalized_payload: The payload to store (may be unchanged for legacy)
        - is_canonical: True if payload conforms to canonical schema
        - validation_errors: List of validation error messages (empty if valid)
    """
    payload = canonical_record.get("payload", {})
    entity_key = canonical_record.get("entity_key", "unknown")

    # Use original source_system/source_id for provenance if available
    # The pipeline namespaces these for internal storage, but provenance should
    # reflect the actual source system (e.g., "loc" not "loc:connector-uuid")
    provenance_source_system = canonical_record.get("_original_source_system", source_system)
    provenance_source_id = canonical_record.get("_original_source_id", source_id)

    # Quick check: is this already a canonical payload?
    if is_canonical_payload(payload):
        # Already canonical - validate it
        result = validate_canonical_record(payload)
        if result.is_valid:
            return payload, True, []
        else:
            return payload, False, result.errors

    # Check if this is a CanonicalDraft (has id/type/label but missing provenance/meta)
    if all(k in payload for k in ["id", "type", "label"]):
        # Looks like a draft - try to validate and finalize
        draft_result = validate_canonical_draft(payload)
        if draft_result.is_valid:
            try:
                finalized = finalize_draft(
                    draft=payload,
                    source_system=provenance_source_system,
                    source_id=provenance_source_id,
                    dataset_id=str(dataset_id) if dataset_id else None,
                    pipeline_id=str(pipeline_id) if pipeline_id else None,
                    existing_created_at=existing_created_at,
                )
                return finalized.model_dump(mode="json"), True, []
            except Exception as e:
                logger.warning(
                    "Failed to finalize canonical draft for %s: %s",
                    entity_key, str(e)
                )
                return payload, False, [f"Finalization failed: {str(e)}"]
        else:
            # Draft validation failed
            return payload, False, draft_result.errors

    # Legacy payload format - wrap with legacy metadata for tracking
    # This allows UI to show "Legacy record" badge and enables future migration
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    legacy_wrapped = {
        # Preserve all original payload fields
        **payload,
        # Add minimal canonical envelope for tracking
        "meta": {
            "schemaVersion": "legacy",
            "validationStatus": "legacy",
            "createdAt": existing_created_at.isoformat() if existing_created_at else now,
            "updatedAt": now,
            "originalFormat": "pre-canonical",
        },
        "provenance": {
            "source": {
                "system": provenance_source_system,
                "recordId": provenance_source_id,
            },
            "ingestedAt": now,
            "migrationRequired": True,
        },
    }

    # =========================================================================
    # LEGACY PAYLOAD OBSERVABILITY
    # =========================================================================
    # Structured logging for tracking legacy payload encounters.
    # This enables:
    # - Monitoring legacy payload volume
    # - Debugging migration issues
    # - Alerting on unexpected legacy creation
    # =========================================================================
    original_keys = sorted(payload.keys()) if isinstance(payload, dict) else []
    logger.warning(
        "legacy_payload_encountered",
        extra={
            "event_type": "legacy_payload",
            "entity_key": entity_key,
            "source_system": provenance_source_system,
            "source_id": provenance_source_id,
            "dataset_id": dataset_id,
            "pipeline_id": pipeline_id,
            "original_keys": original_keys[:20],  # Limit for log size
            "key_count": len(original_keys),
            "action": "wrapped_with_legacy_metadata",
        },
    )

    return legacy_wrapped, False, ["Legacy payload format: wrapped with legacy metadata, migration recommended"]


def _extract_canonical_fields(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Extract entity_fields values from canonical payload.

    Maps canonical schema fields to entity_fields columns:
    - label -> title
    - properties.thumbnail_url -> thumbnail_url
    - properties.canonical_url -> canonical_url
    - provenance.source.recordId -> object_number (if no explicit identifier)

    Args:
        payload: Canonical payload dict

    Returns:
        Dict with entity_field column names and values
    """
    # Handle canonical format (has label, properties, etc.)
    if "label" in payload:
        fields = {
            "title": payload.get("label"),
            "thumbnail_url": None,
            "canonical_url": None,
            "object_number": None,
            "modified_at": None,
        }

        # Extract from media array (look for thumbnail role)
        media = payload.get("media", [])
        for m in media:
            if isinstance(m, dict) and m.get("role") == "thumbnail" and m.get("url"):
                fields["thumbnail_url"] = m["url"]
                break

        # Extract from identifiers (look for url scheme)
        identifiers = payload.get("identifiers", [])
        for ident in identifiers:
            if isinstance(ident, dict):
                if ident.get("scheme") == "url" and ident.get("value"):
                    fields["canonical_url"] = ident["value"]
                elif ident.get("scheme") == "accession" and ident.get("value"):
                    fields["object_number"] = ident["value"]

        # Fallback canonical_url from properties
        properties = payload.get("properties", {})
        if not fields["canonical_url"] and properties.get("canonical_url"):
            fields["canonical_url"] = properties["canonical_url"]
        if not fields["thumbnail_url"] and properties.get("thumbnail_url"):
            fields["thumbnail_url"] = properties["thumbnail_url"]

        # Extract modified_at from meta
        meta = payload.get("meta", {})
        if meta.get("updatedAt"):
            fields["modified_at"] = meta["updatedAt"]

        return fields

    # Legacy format - return empty, let caller use canonical_record directly
    return {}


def compute_payload_hash(payload: dict[str, Any]) -> str:
    """
    Compute semantic hash of canonical payload for change detection.

    This function delegates to compute_canonical_hash() which:
    - Extracts only semantic fields (id, type, label, properties, etc.)
    - Excludes all volatile fields (timestamps, run IDs, etc.)
    - Sorts lists deterministically (identifiers, classifications, etc.)
    - Recursively sorts dict keys

    The hash is SEMANTICALLY STABLE:
    - Same content → same hash across re-ingests
    - Same content → same hash across retries
    - Same content → same hash regardless of field ordering

    Args:
        payload: Canonical payload dictionary

    Returns:
        Hex-encoded SHA256 hash of semantic content

    Note:
        This wrapper exists for backwards compatibility.
        New code should use compute_canonical_hash() directly.
    """
    return compute_canonical_hash(payload)


def extract_field_value(payload: dict[str, Any], field_name: str) -> Any:
    """
    Extract a field value from payload with dot notation support.
    
    Args:
        payload: Canonical payload dictionary
        field_name: Field name (e.g., "title" or "metadata.description")
        
    Returns:
        Field value or None if not found
    """
    parts = field_name.split(".")
    value = payload
    for part in parts:
        if isinstance(value, dict):
            value = value.get(part)
        else:
            return None
    return value


def _extract_comparable_values(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Extract comparable field values from either canonical or legacy payloads.

    This normalizes field access so we can compare payloads regardless of format:
    - Canonical payloads have: label, description, properties, media, identifiers
    - Legacy payloads have: title, object_number, thumbnail_url, canonical_url

    Returns a dict with normalized field names and values for comparison.
    """
    values = {}

    # Check if this is a canonical payload (has 'label' field)
    if "label" in payload:
        # Canonical format
        values["label"] = payload.get("label")
        values["description"] = payload.get("description")
        values["status"] = payload.get("status")

        # Extract from properties (common domain fields)
        properties = payload.get("properties", {})
        if properties:
            values["properties"] = properties

        # Extract thumbnail_url from media array
        media = payload.get("media", [])
        for m in media:
            if isinstance(m, dict) and m.get("role") == "thumbnail" and m.get("url"):
                values["thumbnail_url"] = m["url"]
                break

        # Extract canonical_url and object_number from identifiers
        identifiers = payload.get("identifiers", [])
        for ident in identifiers:
            if isinstance(ident, dict):
                if ident.get("scheme") == "url" and ident.get("value"):
                    values["canonical_url"] = ident["value"]
                elif ident.get("scheme") == "accession" and ident.get("value"):
                    values["object_number"] = ident["value"]

        # Fallback to properties for URLs if not in identifiers
        if "canonical_url" not in values and properties.get("canonical_url"):
            values["canonical_url"] = properties["canonical_url"]
        if "thumbnail_url" not in values and properties.get("thumbnail_url"):
            values["thumbnail_url"] = properties["thumbnail_url"]
    else:
        # Legacy format - use field names directly
        for field in PROJECTED_FIELDS_FOR_DIFF:
            if field in payload:
                values[field] = payload[field]

    return values


def compute_field_diffs(
    old_payload: dict[str, Any],
    new_payload: dict[str, Any],
    fields_to_compare: list[str] | None = None,
) -> tuple[list[str], list[dict[str, Any]]]:
    """
    Compute field-level differences between old and new payloads.

    Handles both canonical and legacy payload formats by extracting comparable
    values from each and comparing them.

    Args:
        old_payload: Previous payload
        new_payload: New payload
        fields_to_compare: Optional list of fields to compare (defaults to auto-detect)

    Returns:
        Tuple of (changed_field_names, field_diff_records)

    By default, compares user-visible fields while reducing noise from metadata.
    Field diffs include field_name, old_value, new_value for each changed field.
    """
    # Extract comparable values from both payloads (handles canonical vs legacy)
    old_values = _extract_comparable_values(old_payload)
    new_values = _extract_comparable_values(new_payload)

    # Determine which fields to compare
    if fields_to_compare is None:
        # Auto-detect: use all fields present in either payload
        all_fields = set(old_values.keys()) | set(new_values.keys())
        # Prioritize certain fields for user visibility
        priority_fields = ["label", "description", "status", "properties",
                         "title", "object_number", "thumbnail_url", "canonical_url"]
        fields_to_compare = [f for f in priority_fields if f in all_fields]
        # Add any remaining fields
        for f in sorted(all_fields):
            if f not in fields_to_compare:
                fields_to_compare.append(f)

    changed_fields = []
    field_diffs = []

    for field_name in fields_to_compare:
        old_value = old_values.get(field_name)
        new_value = new_values.get(field_name)

        # Skip if values are identical
        if old_value == new_value:
            continue

        # Compute array delta if both values are lists
        array_delta = None
        if isinstance(old_value, list) and isinstance(new_value, list):
            array_delta = len(new_value) - len(old_value)

        changed_fields.append(field_name)
        field_diffs.append({
            "field_name": field_name,
            "old_value": old_value,
            "new_value": new_value,
            "array_delta": array_delta,
        })

    return changed_fields, field_diffs


def upsert_entity(
    session: Session,
    organization_id: UUID,
    run_id: UUID,
    pipeline_id: UUID | None,
    canonical_record: dict[str, Any],
    extracted_at: datetime | None = None,
    dataset_id: UUID | None = None,
    enable_background_classification: bool = True,
    existing_entity: EntityCurrent | None = None,
    source_connector_instance_id: UUID | None = None,
    raw_payload: dict[str, Any] | None = None,
    existing_fields: EntityField | None = None,
) -> tuple[str, ChangeEvent | None]:
    """
    Upsert canonical entity and emit change event if changed.

    Args:
        session: SQLAlchemy session
        organization_id: Organization identifier
        run_id: Run identifier for change tracking
        pipeline_id: Optional pipeline identifier
        canonical_record: Normalized canonical record with required fields
        extracted_at: Extraction timestamp (defaults to now)
        dataset_id: Optional dataset identifier
        enable_background_classification: If True, queue classification task for unclassified entities (default: True)
        existing_entity: Pre-fetched existing entity for performance
        source_connector_instance_id: Connector instance that provided this record (Phase 3: multi-source)
        raw_payload: Original raw payload from source (Phase 3: stored in sources map)
        
    Returns:
        Tuple of (change_type, change_event_or_none)
        
    Change types:
    - "created": New entity inserted
    - "updated": Existing entity modified
    - "noop": Entity unchanged (same payload_hash)
    
    Required fields in canonical_record:
    - entity_key: Unique identifier
    - source_system: Source system name
    - source_id: ID in source system
    - payload: Full canonical payload
    
    Optional fields:
    - entity_type: Type of entity (defaults to "record")
    - canonical_url: URL to view object
    - title, object_number, modified_at, thumbnail_url (extracted to entity_fields)
    
    Phase 3 Multi-source:
    - If source_connector_instance_id provided, stores raw_payload in entity.sources map
    - Supports deterministic merge: later sources win for overlapping canonical fields
    - Preserves per-source provenance in sources[connector_instance_id]
    """
    # Validate required envelope fields
    required_fields = ["entity_key", "source_system", "source_id", "payload"]
    missing = [f for f in required_fields if f not in canonical_record]
    if missing:
        raise ValueError(f"Missing required fields: {missing}")

    entity_key = canonical_record["entity_key"]
    source_system = canonical_record["source_system"]
    source_id = canonical_record["source_id"]
    entity_type = canonical_record.get("entity_type", "record")
    canonical_url = canonical_record.get("canonical_url")

    # Get existing entity's createdAt for preservation during updates
    existing_created_at = None
    if existing_entity and existing_entity.payload:
        meta = existing_entity.payload.get("meta", {})
        if meta.get("createdAt"):
            try:
                existing_created_at = datetime.fromisoformat(
                    str(meta["createdAt"]).replace("Z", "+00:00")
                )
            except (ValueError, TypeError):
                pass

    # Canonical Schema Validation (Phase 1: warn-only; Phase 2: enforce)
    # This validates and potentially finalizes CanonicalDraft -> CanonicalRecord
    payload, is_canonical, validation_errors = validate_and_finalize_payload(
        canonical_record=canonical_record,
        source_system=source_system,
        source_id=source_id,
        dataset_id=str(dataset_id) if dataset_id else None,
        pipeline_id=str(pipeline_id) if pipeline_id else None,
        existing_created_at=existing_created_at,
    )

    if validation_errors:
        validation_mode = _get_validation_mode()
        if validation_mode == "error":
            # Phase 2: Reject invalid payloads
            raise CanonicalValidationError(entity_key, validation_errors)
        else:
            # Phase 1: Warn and continue
            logger.warning(
                "Canonical validation failed for %s (warn mode, storing anyway): %s",
                entity_key,
                validation_errors[:3],  # Limit log noise
            )

    # Extract entity_type from canonical payload if available
    if is_canonical and payload.get("type"):
        # Map canonical type to entity_type
        canonical_type = payload.get("type")
        # Use lowercase of canonical type (Object -> object, Work -> work)
        entity_type = canonical_type.lower() if isinstance(canonical_type, str) else entity_type

    # Compute payload hash
    payload_hash = compute_payload_hash(payload)
    
    # Set extraction timestamp (used for last_seen_at tracking)
    if extracted_at is None:
        extracted_at = datetime.now(timezone.utc)
    
    # Check if entity exists (use pre-fetched if available for performance)
    if existing_entity is not None:
        existing = existing_entity
    else:
        existing = session.query(EntityCurrent).filter_by(
            organization_id=organization_id,
            entity_key=entity_key
        ).first()
    
    change_event = None
    
    if existing is None:
        # NEW ENTITY: Insert into entity_current
        logger.debug("Creating new entity: %s", entity_key)
        
        # Initialize sources map with this source's raw payload
        sources_map = {}
        if source_connector_instance_id and raw_payload:
            sources_map[str(source_connector_instance_id)] = {
                "raw_payload": raw_payload,
                "last_seen_at": extracted_at.isoformat(),
                "run_id": str(run_id),
            }
        
        entity = EntityCurrent(
            organization_id=organization_id,
            entity_key=entity_key,
            dataset_id=dataset_id,
            entity_type=entity_type,
            source_system=source_system,
            source_id=source_id,
            canonical_url=canonical_url,
            payload=payload,
            payload_hash=payload_hash,
            sources=sources_map,
            extracted_at=extracted_at,
            last_seen_at=extracted_at,
            last_run_id=run_id,
        )
        session.add(entity)
        # Removed individual flush - will flush at batch level
        
        # Queue background classification if entity is unclassified
        if enable_background_classification and entity_type == "unclassified":
            _queue_classification(entity_key, organization_id)
        
        # Create change event (will be inserted at batch level)
        change_event = ChangeEvent(
            organization_id=organization_id,
            run_id=run_id,
            dataset_id=dataset_id,
            pipeline_id=pipeline_id,
            entity_key=entity_key,
            entity_type=entity_type,
            change_type="created",
            applied=True,
            changed_fields=None,
            old_hash=None,
            new_hash=payload_hash,
            summary=f"Created entity {entity_key}",
        )
        session.add(change_event)
        change_type = "created"
        
    else:
        # EXISTING ENTITY: Always update tracking fields
        existing.last_seen_at = extracted_at or datetime.now(timezone.utc)
        existing.last_run_id = run_id
        
        # =====================================================================
        # MULTI-SOURCE MERGE POLICY (v1)
        # =====================================================================
        #
        # SOURCES MAP: Additive merge
        # - Each source connector gets its own entry keyed by connector_instance_id
        # - New sources are added; existing source entries are updated
        # - Source entries are never removed (preserves full provenance)
        #
        # CANONICAL PAYLOAD: Last-write-wins
        # - The most recent ingest replaces the entire payload
        # - No field-level merge (label, description, properties, etc.)
        # - Caller is responsible for any pre-merge logic
        #
        # WHY THIS POLICY:
        # - Simple and predictable behavior
        # - Matches SQL UPDATE semantics
        # - No hidden merge logic that could cause confusion
        # - Easy to reason about and debug
        #
        # See tests/test_multisource_merge.py for invariants and test coverage.
        # =====================================================================

        # Sources map: Additive merge - each source gets its own entry
        if source_connector_instance_id and raw_payload:
            if not existing.sources:
                existing.sources = {}
            existing.sources[str(source_connector_instance_id)] = {
                "raw_payload": raw_payload,
                "last_seen_at": extracted_at.isoformat() if extracted_at else datetime.now(timezone.utc).isoformat(),
                "run_id": str(run_id),
            }
            # Mark sources as modified for SQLAlchemy to detect change
            from sqlalchemy.orm.attributes import flag_modified
            flag_modified(existing, "sources")

        hash_changed = existing.payload_hash != payload_hash

        if hash_changed:
            # Hash changed - compute projected field diffs to decide if event needed
            changed_fields, field_diff_records = compute_field_diffs(
                existing.payload,
                payload
            )

            # Store old hash before updating
            old_hash = existing.payload_hash

            # Canonical payload: Last-write-wins - replace entire payload
            # This is intentionally simple: the latest ingest wins.
            # For complex merge logic (prefer non-empty, etc.), caller should
            # pre-merge before calling upsert_canonical.
            existing.source_system = source_system
            existing.source_id = source_id
            existing.canonical_url = canonical_url
            existing.payload = payload
            existing.payload_hash = payload_hash
            existing.extracted_at = extracted_at
            
            if changed_fields:
                # Projected fields changed - emit update event
                logger.debug("Updating entity: %s (%d projected fields changed)", entity_key, len(changed_fields))
                
                # Removed individual flush - will flush at batch level
                
                change_event = ChangeEvent(
                    organization_id=organization_id,
                    run_id=run_id,
                    dataset_id=dataset_id,
                    pipeline_id=pipeline_id,
                    entity_key=entity_key,
                    entity_type=entity_type,
                    change_type="updated",
                    applied=True,
                    changed_fields=changed_fields,
                    old_hash=old_hash,
                    new_hash=payload_hash,
                    summary=f"Updated {len(changed_fields)} field(s): {', '.join(changed_fields[:3])}{'...' if len(changed_fields) > 3 else ''}",
                )
                session.add(change_event)
                
                # Add field diffs (will be inserted at batch level)
                # Note: We can't access change_event.change_id yet, so we'll store these temporarily
                # and bulk insert after the batch flush
                for field_diff in field_diff_records:
                    diff = FieldDiff(
                        organization_id=organization_id,
                        change_id=None,  # Will be set after flush
                        field_name=field_diff["field_name"],
                        old_value=field_diff["old_value"],
                        new_value=field_diff["new_value"],
                        array_delta=field_diff.get("array_delta"),
                    )
                    # Store reference to parent change_event for post-flush linkage
                    if not hasattr(change_event, '_pending_diffs'):
                        change_event._pending_diffs = []
                    change_event._pending_diffs.append(diff)
                
                change_type = "updated"
            else:
                # Hash changed but projected fields didn't - metadata-only change
                logger.debug("Entity %s: payload updated but no projected field changes (metadata-only)", entity_key)
                change_type = "noop"
        else:
            # Hash unchanged - true noop
            logger.debug("Entity unchanged: %s (same hash)", entity_key)
            change_type = "noop"
    
    # Upsert entity_fields (lightweight projection)
    _upsert_entity_fields(
        session=session,
        organization_id=organization_id,
        entity_key=entity_key,
        canonical_record=canonical_record,
        run_id=run_id,
        existing_fields=existing_fields,
    )

    # Persist any accumulated FieldDiffs. batch_upsert_entities does this
    # centrally; the single-record path has to do it inline so callers that
    # don't go through the batch helper still get field-level history.
    if change_event is not None and getattr(change_event, "_pending_diffs", None):
        session.flush()  # ensure change_event.change_id is populated
        for diff in change_event._pending_diffs:
            diff.change_id = change_event.change_id
            session.add(diff)

    return change_type, change_event


def delete_entity(
    session: Session,
    organization_id: UUID,
    entity_key: str,
    run_id: UUID,
    dataset_id: UUID | None = None,
    pipeline_id: UUID | None = None,
    deleted_at: datetime | None = None,
) -> ChangeEvent | None:
    """
    Soft-delete an entity in the canonical store.

    This marks the entity as deleted without removing it from the database,
    preserving full history for auditing and potential restoration.

    Args:
        session: SQLAlchemy session
        organization_id: Organization identifier
        entity_key: Entity to delete
        run_id: Run identifier for change tracking
        dataset_id: Optional dataset identifier for change event
        pipeline_id: Optional pipeline identifier for change event
        deleted_at: Deletion timestamp (defaults to now)

    Returns:
        ChangeEvent with change_type='deleted' if entity existed and wasn't already deleted
        None if entity doesn't exist or was already deleted
    """
    entity = session.query(EntityCurrent).filter_by(
        organization_id=organization_id,
        entity_key=entity_key,
    ).first()

    if not entity:
        logger.debug("Entity not found for deletion: %s", entity_key)
        return None

    if entity.is_deleted:
        logger.debug("Entity already deleted: %s", entity_key)
        return None

    # Set deletion timestamp
    if deleted_at is None:
        deleted_at = datetime.now(timezone.utc)

    # Store the old hash before marking as deleted
    old_hash = entity.payload_hash

    # Mark as deleted (soft delete)
    entity.is_deleted = True
    entity.deleted_at = deleted_at
    entity.deleted_by_run_id = run_id

    logger.info("Soft-deleted entity: %s (run_id=%s)", entity_key, run_id)

    # Create change event
    change_event = ChangeEvent(
        organization_id=organization_id,
        run_id=run_id,
        dataset_id=dataset_id or entity.dataset_id,
        pipeline_id=pipeline_id,
        entity_key=entity_key,
        entity_type=entity.entity_type,
        change_type="deleted",
        applied=True,
        changed_fields=None,
        old_hash=old_hash,
        new_hash=None,
        summary=f"Deleted entity {entity_key}",
    )
    session.add(change_event)

    # Queue for search index removal (via Celery)
    _queue_search_delete(entity_key, organization_id)

    # Remove relationships involving this entity (cascade delete)
    try:
        from app.services.relationship_service import delete_relationships_for_entity
        deleted_count = delete_relationships_for_entity(session, organization_id, entity_key)
        if deleted_count > 0:
            logger.info("Cascade deleted %d relationships for entity: %s", deleted_count, entity_key)
    except Exception as e:
        logger.warning("Failed to cascade delete relationships for %s: %s", entity_key, str(e))

    return change_event


def restore_entity(
    session: Session,
    organization_id: UUID,
    entity_key: str,
    run_id: UUID,
    dataset_id: UUID | None = None,
    pipeline_id: UUID | None = None,
) -> tuple[bool, ChangeEvent | None]:
    """
    Restore a soft-deleted entity (for undo/correction scenarios).

    Args:
        session: SQLAlchemy session
        organization_id: Organization identifier
        entity_key: Entity to restore
        run_id: Run identifier for change tracking
        dataset_id: Optional dataset identifier for change event
        pipeline_id: Optional pipeline identifier for change event

    Returns:
        Tuple of (success, change_event):
        - (True, ChangeEvent) if entity was restored
        - (False, None) if entity not found or not deleted
    """
    entity = session.query(EntityCurrent).filter_by(
        organization_id=organization_id,
        entity_key=entity_key,
        is_deleted=True,
    ).first()

    if not entity:
        logger.debug("Entity not found or not deleted: %s", entity_key)
        return False, None

    # Restore the entity
    entity.is_deleted = False
    entity.deleted_at = None
    entity.deleted_by_run_id = None

    logger.info("Restored entity: %s (run_id=%s)", entity_key, run_id)

    # Create change event for restoration (use "created" or a new type)
    # Using "created" since the entity is effectively re-appearing
    change_event = ChangeEvent(
        organization_id=organization_id,
        run_id=run_id,
        dataset_id=dataset_id or entity.dataset_id,
        pipeline_id=pipeline_id,
        entity_key=entity_key,
        entity_type=entity.entity_type,
        change_type="created",  # Re-appears in active set
        applied=True,
        changed_fields=None,
        old_hash=None,
        new_hash=entity.payload_hash,
        summary=f"Restored entity {entity_key}",
    )
    session.add(change_event)

    # Re-index in search (via Celery)
    _queue_search_index(entity_key, organization_id, _build_search_payload(entity))

    return True, change_event


def batch_delete_entities(
    session: Session,
    organization_id: UUID,
    entity_keys: list[str],
    run_id: UUID,
    dataset_id: UUID | None = None,
    pipeline_id: UUID | None = None,
    deleted_at: datetime | None = None,
) -> dict[str, int]:
    """
    Batch soft-delete multiple entities.

    Args:
        session: SQLAlchemy session
        organization_id: Organization identifier
        entity_keys: List of entity keys to delete
        run_id: Run identifier for change tracking
        dataset_id: Optional dataset identifier for change events
        pipeline_id: Optional pipeline identifier for change events
        deleted_at: Deletion timestamp (defaults to now)

    Returns:
        Dictionary with counts: {"deleted": N, "skipped": N}
        - deleted: Number of entities successfully soft-deleted
        - skipped: Number of entities not found or already deleted
    """
    counts = {"deleted": 0, "skipped": 0}

    if not entity_keys:
        return counts

    if deleted_at is None:
        deleted_at = datetime.now(timezone.utc)

    # Bulk fetch existing non-deleted entities
    existing_entities = session.query(EntityCurrent).filter(
        EntityCurrent.organization_id == organization_id,
        EntityCurrent.entity_key.in_(entity_keys),
        EntityCurrent.is_deleted == False,
    ).all()

    existing_map = {e.entity_key: e for e in existing_entities}

    change_events = []
    deleted_entity_keys = []

    for entity_key in entity_keys:
        entity = existing_map.get(entity_key)

        if not entity:
            counts["skipped"] += 1
            continue

        # Soft-delete the entity
        entity.is_deleted = True
        entity.deleted_at = deleted_at
        entity.deleted_by_run_id = run_id

        # Prepare change event
        change_events.append({
            "organization_id": organization_id,
            "run_id": run_id,
            "dataset_id": dataset_id or entity.dataset_id,
            "pipeline_id": pipeline_id,
            "entity_key": entity_key,
            "entity_type": entity.entity_type,
            "change_type": "deleted",
            "applied": True,
            "changed_fields": None,
            "old_hash": entity.payload_hash,
            "new_hash": None,
            "summary": f"Deleted entity {entity_key}",
        })

        deleted_entity_keys.append(entity_key)
        counts["deleted"] += 1

    # Bulk insert change events
    if change_events:
        session.bulk_insert_mappings(ChangeEvent, change_events)

    # Queue search index deletions (via Celery)
    for entity_key in deleted_entity_keys:
        _queue_search_delete(entity_key, organization_id)

    logger.info(
        "Batch deleted %d entities (%d skipped) for run_id=%s",
        counts["deleted"],
        counts["skipped"],
        run_id,
    )

    return counts


def _upsert_entity_fields(
    session: Session,
    organization_id: UUID,
    entity_key: str,
    canonical_record: dict[str, Any],
    run_id: UUID,
    existing_fields: EntityField | None = None,
) -> None:
    """
    Upsert entity_fields lightweight projection.
    
    Extracts commonly-queried fields from payload for fast filtering.
    Uses pre-fetched existing_fields for performance optimization.
    """
    # Extract fields from canonical record
    entity_type = canonical_record.get("entity_type", "record")
    title = canonical_record.get("title")
    object_number = canonical_record.get("object_number")
    thumbnail_url = canonical_record.get("thumbnail_url")
    
    # Parse modified_at if present
    modified_at = None
    if "modified_at" in canonical_record:
        modified_at_str = canonical_record["modified_at"]
        if isinstance(modified_at_str, str):
            try:
                # Parse ISO format
                modified_at = datetime.fromisoformat(modified_at_str.replace("Z", "+00:00"))
            except ValueError:
                logger.warning("Could not parse modified_at: %s", modified_at_str)
        elif isinstance(modified_at_str, datetime):
            modified_at = modified_at_str
    
    # Use pre-fetched existing_fields if available, otherwise query
    if existing_fields is None:
        existing_fields = session.query(EntityField).filter_by(
            organization_id=organization_id,
            entity_key=entity_key
        ).first()

    if existing_fields:
        # Update existing
        existing_fields.entity_type = entity_type
        existing_fields.title = title
        existing_fields.object_number = object_number
        existing_fields.modified_at = modified_at
        existing_fields.thumbnail_url = thumbnail_url
        existing_fields.last_run_id = run_id
    else:
        # Insert new
        entity_field = EntityField(
            organization_id=organization_id,
            entity_key=entity_key,
            entity_type=entity_type,
            title=title,
            object_number=object_number,
            modified_at=modified_at,
            thumbnail_url=thumbnail_url,
            last_run_id=run_id,
        )
        session.add(entity_field)


def batch_upsert_entities(
    session: Session,
    organization_id: UUID,
    run_id: UUID,
    pipeline_id: UUID | None,
    canonical_records: list[dict[str, Any]],
    extracted_at: datetime | None = None,
    dataset_id: UUID | None = None,
    batch_size: int = 500,
    source_connector_instance_id: UUID | None = None,
    raw_records: list[dict[str, Any]] | None = None,
) -> dict[str, int]:
    """
    Batch upsert multiple entities with optimized bulk operations.

    Performance optimizations (Stage 1):
    - Bulk fetch existing entities in batches
    - Bulk INSERT for new entities using bulk_insert_mappings()
    - Individual UPDATE for existing entities (needed for merge logic)
    - Batch commit every N records (default 500)
    - Reduce per-entity overhead

    Args:
        session: SQLAlchemy session
        organization_id: Organization identifier
        run_id: Run identifier for change tracking
        pipeline_id: Optional pipeline identifier
        canonical_records: List of canonical records
        extracted_at: Extraction timestamp (defaults to now)
        dataset_id: Optional dataset identifier
        batch_size: Number of entities to commit at once (default: 500)
        source_connector_instance_id: Connector instance that provided these records (Phase 3: multi-source)
        raw_records: Original raw payloads from source (Phase 3: stored in sources map)

    Returns:
        Dictionary with counts: {"created": N, "updated": N, "noop": N}

    Phase 3 Multi-source:
    - If source_connector_instance_id provided, stores raw_records in entity.sources map
    - Assumes raw_records align with canonical_records by index
    """
    counts = {"created": 0, "updated": 0, "noop": 0}
    total = len(canonical_records)

    if extracted_at is None:
        extracted_at = datetime.now(timezone.utc)

    # Process in batches for better performance
    for batch_start in range(0, total, batch_size):
        batch_end = min(batch_start + batch_size, total)
        batch = canonical_records[batch_start:batch_end]

        # Bulk fetch existing entities for this batch
        entity_keys = [r["entity_key"] for r in batch]
        existing_entities = session.query(EntityCurrent).filter(
            EntityCurrent.organization_id == organization_id,
            EntityCurrent.entity_key.in_(entity_keys)
        ).all()
        existing_map = {e.entity_key: e for e in existing_entities}

        # Bulk fetch existing entity_fields for this batch
        existing_fields = session.query(EntityField).filter(
            EntityField.organization_id == organization_id,
            EntityField.entity_key.in_(entity_keys)
        ).all()
        existing_fields_map = {ef.entity_key: ef for ef in existing_fields}

        # Separate new entities from updates for bulk optimization
        new_entity_mappings = []
        new_entity_field_mappings = []
        new_change_event_mappings = []
        entities_to_classify = []
        change_events_with_diffs = []  # Track ChangeEvents that have pending field diffs

        # Process each record in batch
        for idx, record in enumerate(batch):
            entity_key = record["entity_key"]
            existing_entity = existing_map.get(entity_key)

            # Get corresponding raw_payload if available
            raw_payload = None
            if raw_records and (batch_start + idx) < len(raw_records):
                raw_payload = raw_records[batch_start + idx]

            if existing_entity is None:
                # NEW ENTITY: Prepare for bulk insert
                new_entity_data = _prepare_new_entity_for_bulk_insert(
                    organization_id=organization_id,
                    run_id=run_id,
                    pipeline_id=pipeline_id,
                    canonical_record=record,
                    extracted_at=extracted_at,
                    dataset_id=dataset_id,
                    source_connector_instance_id=source_connector_instance_id,
                    raw_payload=raw_payload,
                )

                if new_entity_data:
                    new_entity_mappings.append(new_entity_data["entity"])
                    new_entity_field_mappings.append(new_entity_data["entity_field"])
                    new_change_event_mappings.append(new_entity_data["change_event"])

                    if new_entity_data.get("needs_classification"):
                        entities_to_classify.append(entity_key)

                    counts["created"] += 1
            else:
                # EXISTING ENTITY: Use individual update (needed for merge logic and diffs)
                change_type, change_event = upsert_entity(
                    session=session,
                    organization_id=organization_id,
                    run_id=run_id,
                    pipeline_id=pipeline_id,
                    canonical_record=record,
                    extracted_at=extracted_at,
                    dataset_id=dataset_id,
                    existing_entity=existing_entity,
                    source_connector_instance_id=source_connector_instance_id,
                    raw_payload=raw_payload,
                    existing_fields=existing_fields_map.get(entity_key),
                    enable_background_classification=True,
                )
                counts[change_type] += 1

                # Track change events that have pending field diffs
                if change_event and hasattr(change_event, '_pending_diffs'):
                    change_events_with_diffs.append(change_event)

        # Bulk insert new entities
        if new_entity_mappings:
            session.bulk_insert_mappings(EntityCurrent, new_entity_mappings)
            logger.debug("Bulk inserted %d new EntityCurrent records", len(new_entity_mappings))

        if new_entity_field_mappings:
            session.bulk_insert_mappings(EntityField, new_entity_field_mappings)
            logger.debug("Bulk inserted %d new EntityField records", len(new_entity_field_mappings))

        if new_change_event_mappings:
            session.bulk_insert_mappings(ChangeEvent, new_change_event_mappings)
            logger.debug("Bulk inserted %d new ChangeEvent records", len(new_change_event_mappings))

        # Flush to get change_event IDs for updates, then link field_diffs
        session.flush()

        # Link pending field_diffs to their change_events (for updates only)
        # Note: We collected these BEFORE flush since session.new is cleared after flush
        for change_event in change_events_with_diffs:
            for diff in change_event._pending_diffs:
                diff.change_id = change_event.change_id
                session.add(diff)

        # Commit batch
        session.commit()

        # Queue classification tasks for new unclassified entities (after commit)
        for entity_key in entities_to_classify:
            _queue_classification(entity_key, organization_id)

        # Evaluate auto-link relationship definitions for created/updated entities
        # This creates relationships based on field matching rules
        try:
            from app.services.relationship_auto_link import evaluate_auto_link_for_entities
            auto_link_result = evaluate_auto_link_for_entities(
                session=session,
                organization_id=organization_id,
                entity_keys=entity_keys,
                dataset_id=dataset_id,
            )
            if auto_link_result["relationships_created"] > 0:
                logger.info(
                    "Auto-link: created %d relationships from %d definitions",
                    auto_link_result["relationships_created"],
                    auto_link_result["definitions_evaluated"],
                )
                session.commit()  # Commit the new relationships
        except Exception as e:
            logger.warning("Auto-link evaluation failed (non-fatal): %s", str(e))
            session.rollback()

        if batch_end < total:
            logger.info(
                "Batch progress: %d/%d entities processed (%d created, %d updated, %d noop)",
                batch_end,
                total,
                counts["created"],
                counts["updated"],
                counts["noop"]
            )

    logger.info(
        "Final counts: %d created, %d updated, %d noop",
        counts["created"],
        counts["updated"],
        counts["noop"]
    )

    return counts


def _prepare_new_entity_for_bulk_insert(
    organization_id: UUID,
    run_id: UUID,
    pipeline_id: UUID | None,
    canonical_record: dict[str, Any],
    extracted_at: datetime,
    dataset_id: UUID | None,
    source_connector_instance_id: UUID | None,
    raw_payload: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """
    Prepare a new entity for bulk insert, returning mappings for EntityCurrent,
    EntityField, and ChangeEvent.

    This function mirrors the INSERT path of upsert_entity() but returns dicts
    instead of ORM objects for use with bulk_insert_mappings().

    Returns:
        Dict with keys: entity, entity_field, change_event, needs_classification
        Or None if validation fails in error mode
    """
    # Validate required envelope fields
    required_fields = ["entity_key", "source_system", "source_id", "payload"]
    missing = [f for f in required_fields if f not in canonical_record]
    if missing:
        logger.warning("Skipping record with missing fields: %s", missing)
        return None

    entity_key = canonical_record["entity_key"]
    source_system = canonical_record["source_system"]
    source_id = canonical_record["source_id"]
    entity_type = canonical_record.get("entity_type", "record")
    canonical_url = canonical_record.get("canonical_url")

    # Canonical Schema Validation
    payload, is_canonical, validation_errors = validate_and_finalize_payload(
        canonical_record=canonical_record,
        source_system=source_system,
        source_id=source_id,
        dataset_id=str(dataset_id) if dataset_id else None,
        pipeline_id=str(pipeline_id) if pipeline_id else None,
        existing_created_at=None,
    )

    if validation_errors:
        validation_mode = _get_validation_mode()
        if validation_mode == "error":
            raise CanonicalValidationError(entity_key, validation_errors)
        else:
            logger.warning(
                "Canonical validation failed for %s (warn mode, storing anyway): %s",
                entity_key,
                validation_errors[:3],
            )

    # Extract entity_type from canonical payload if available
    if is_canonical and payload.get("type"):
        canonical_type = payload.get("type")
        entity_type = canonical_type.lower() if isinstance(canonical_type, str) else entity_type

    # Compute payload hash
    payload_hash = compute_payload_hash(payload)

    # Initialize sources map with this source's raw payload
    sources_map = {}
    if source_connector_instance_id and raw_payload:
        sources_map[str(source_connector_instance_id)] = {
            "raw_payload": raw_payload,
            "last_seen_at": extracted_at.isoformat(),
            "run_id": str(run_id),
        }

    # Prepare EntityCurrent mapping
    entity_mapping = {
        "organization_id": organization_id,
        "entity_key": entity_key,
        "dataset_id": dataset_id,
        "entity_type": entity_type,
        "source_system": source_system,
        "source_id": source_id,
        "canonical_url": canonical_url,
        "payload": payload,
        "payload_hash": payload_hash,
        "sources": sources_map,
        "extracted_at": extracted_at,
        "last_seen_at": extracted_at,
        "last_run_id": run_id,
    }

    # Prepare EntityField mapping
    title = canonical_record.get("title")
    object_number = canonical_record.get("object_number")
    thumbnail_url = canonical_record.get("thumbnail_url")

    modified_at = None
    if "modified_at" in canonical_record:
        modified_at_str = canonical_record["modified_at"]
        if isinstance(modified_at_str, str):
            try:
                modified_at = datetime.fromisoformat(modified_at_str.replace("Z", "+00:00"))
            except ValueError:
                pass
        elif isinstance(modified_at_str, datetime):
            modified_at = modified_at_str

    entity_field_mapping = {
        "organization_id": organization_id,
        "entity_key": entity_key,
        "entity_type": entity_type,
        "title": title,
        "object_number": object_number,
        "modified_at": modified_at,
        "thumbnail_url": thumbnail_url,
        "last_run_id": run_id,
    }

    # Prepare ChangeEvent mapping
    change_event_mapping = {
        "organization_id": organization_id,
        "run_id": run_id,
        "dataset_id": dataset_id,
        "pipeline_id": pipeline_id,
        "entity_key": entity_key,
        "entity_type": entity_type,
        "change_type": "created",
        "applied": True,
        "changed_fields": None,
        "old_hash": None,
        "new_hash": payload_hash,
        "summary": f"Created entity {entity_key}",
    }

    return {
        "entity": entity_mapping,
        "entity_field": entity_field_mapping,
        "change_event": change_event_mapping,
        "needs_classification": entity_type == "unclassified",
    }


# =============================================================================
# Rollback Helper Functions
# =============================================================================


def revert_create(
    session: Session,
    organization_id: UUID,
    entity_key: str,
    run_id: UUID,
    dataset_id: UUID | None = None,
    pipeline_id: UUID | None = None,
) -> ChangeEvent | None:
    """
    Revert a CREATE change by soft-deleting the entity.

    Used during rollback when the original run created an entity.
    Sets is_deleted=true and creates a ChangeEvent(type=deleted).

    Args:
        session: SQLAlchemy session
        organization_id: Organization identifier
        entity_key: Entity to soft-delete
        run_id: Rollback run identifier for change tracking
        dataset_id: Optional dataset identifier for change event
        pipeline_id: Optional pipeline identifier for change event

    Returns:
        ChangeEvent with change_type='deleted' if entity was soft-deleted
        None if entity doesn't exist or is already deleted
    """
    entity = session.query(EntityCurrent).filter_by(
        organization_id=organization_id,
        entity_key=entity_key,
    ).first()

    if not entity:
        logger.debug("Entity not found for revert_create: %s", entity_key)
        return None

    if entity.is_deleted:
        logger.debug("Entity already deleted for revert_create: %s", entity_key)
        return None

    deleted_at = datetime.now(timezone.utc)
    old_hash = entity.payload_hash

    # Soft-delete the entity
    entity.is_deleted = True
    entity.deleted_at = deleted_at
    entity.deleted_by_run_id = run_id

    logger.info("Reverted CREATE (soft-deleted): %s (rollback_run_id=%s)", entity_key, run_id)

    # Create change event
    change_event = ChangeEvent(
        organization_id=organization_id,
        run_id=run_id,
        dataset_id=dataset_id or entity.dataset_id,
        pipeline_id=pipeline_id,
        entity_key=entity_key,
        entity_type=entity.entity_type,
        change_type="deleted",
        applied=True,
        changed_fields=None,
        old_hash=old_hash,
        new_hash=None,
        summary=f"Rollback: deleted entity {entity_key} (was created)",
    )
    session.add(change_event)

    # Queue for search index removal (via Celery)
    _queue_search_delete(entity_key, organization_id)

    return change_event


def revert_update(
    session: Session,
    organization_id: UUID,
    entity_key: str,
    run_id: UUID,
    field_diffs: list[FieldDiff],
    dataset_id: UUID | None = None,
    pipeline_id: UUID | None = None,
) -> ChangeEvent | None:
    """
    Revert an UPDATE change by restoring previous field values from FieldDiff.

    Used during rollback when the original run updated an entity.
    Restores old_value for each field and creates a ChangeEvent(type=updated).

    Args:
        session: SQLAlchemy session
        organization_id: Organization identifier
        entity_key: Entity to restore
        run_id: Rollback run identifier for change tracking
        field_diffs: List of FieldDiff records from the original change
        dataset_id: Optional dataset identifier for change event
        pipeline_id: Optional pipeline identifier for change event

    Returns:
        ChangeEvent with change_type='updated' if entity was restored
        None if entity doesn't exist or no fields to restore
    """
    entity = session.query(EntityCurrent).filter_by(
        organization_id=organization_id,
        entity_key=entity_key,
    ).first()

    if not entity:
        logger.debug("Entity not found for revert_update: %s", entity_key)
        return None

    if not field_diffs:
        logger.debug("No field_diffs to restore for: %s", entity_key)
        return None

    old_hash = entity.payload_hash
    payload = entity.payload or {}
    restored_fields = []
    reverse_diffs = []

    # Restore each field from its old_value
    for diff in field_diffs:
        field_name = diff.field_name
        old_value = diff.old_value
        new_value = diff.new_value  # What it currently is (before rollback)

        # Apply restoration based on field type
        if field_name in payload:
            payload[field_name] = old_value
            restored_fields.append(field_name)
            reverse_diffs.append({
                "field_name": field_name,
                "old_value": new_value,  # Current value becomes old
                "new_value": old_value,  # Old value becomes new
            })
        elif "." in field_name:
            # Handle nested fields
            parts = field_name.split(".")
            target = payload
            for part in parts[:-1]:
                if part in target and isinstance(target[part], dict):
                    target = target[part]
                else:
                    break
            else:
                if parts[-1] in target:
                    target[parts[-1]] = old_value
                    restored_fields.append(field_name)
                    reverse_diffs.append({
                        "field_name": field_name,
                        "old_value": new_value,
                        "new_value": old_value,
                    })

    if not restored_fields:
        logger.debug("No fields restored for: %s", entity_key)
        return None

    # Update entity
    entity.payload = payload
    entity.payload_hash = compute_payload_hash(payload)

    # Mark payload as modified for SQLAlchemy
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(entity, "payload")

    logger.info(
        "Reverted UPDATE: %s (%d fields restored, rollback_run_id=%s)",
        entity_key, len(restored_fields), run_id
    )

    # Create change event
    change_event = ChangeEvent(
        organization_id=organization_id,
        run_id=run_id,
        dataset_id=dataset_id or entity.dataset_id,
        pipeline_id=pipeline_id,
        entity_key=entity_key,
        entity_type=entity.entity_type,
        change_type="updated",
        applied=True,
        changed_fields=restored_fields,
        old_hash=old_hash,
        new_hash=entity.payload_hash,
        summary=f"Rollback: restored {len(restored_fields)} field(s): {', '.join(restored_fields[:3])}{'...' if len(restored_fields) > 3 else ''}",
    )
    session.add(change_event)

    # Add field diffs for the reverse changes
    session.flush()  # Get change_id
    for diff_data in reverse_diffs:
        diff = FieldDiff(
            organization_id=organization_id,
            change_id=change_event.change_id,
            field_name=diff_data["field_name"],
            old_value=diff_data["old_value"],
            new_value=diff_data["new_value"],
        )
        session.add(diff)

    # Queue for search index update (via Celery)
    _queue_search_index(entity_key, organization_id, _build_search_payload(entity))

    return change_event


def revert_delete(
    session: Session,
    organization_id: UUID,
    entity_key: str,
    run_id: UUID,
    dataset_id: UUID | None = None,
    pipeline_id: UUID | None = None,
) -> ChangeEvent | None:
    """
    Revert a DELETE change by restoring (undeleting) the entity.

    Used during rollback when the original run deleted an entity.
    Sets is_deleted=false and creates a ChangeEvent(type=created).

    Args:
        session: SQLAlchemy session
        organization_id: Organization identifier
        entity_key: Entity to restore
        run_id: Rollback run identifier for change tracking
        dataset_id: Optional dataset identifier for change event
        pipeline_id: Optional pipeline identifier for change event

    Returns:
        ChangeEvent with change_type='created' if entity was restored
        None if entity doesn't exist or is not deleted
    """
    entity = session.query(EntityCurrent).filter_by(
        organization_id=organization_id,
        entity_key=entity_key,
        is_deleted=True,
    ).first()

    if not entity:
        logger.debug("Deleted entity not found for revert_delete: %s", entity_key)
        return None

    # Restore the entity
    entity.is_deleted = False
    entity.deleted_at = None
    entity.deleted_by_run_id = None

    logger.info("Reverted DELETE (restored): %s (rollback_run_id=%s)", entity_key, run_id)

    # Create change event (entity re-appears)
    change_event = ChangeEvent(
        organization_id=organization_id,
        run_id=run_id,
        dataset_id=dataset_id or entity.dataset_id,
        pipeline_id=pipeline_id,
        entity_key=entity_key,
        entity_type=entity.entity_type,
        change_type="created",
        applied=True,
        changed_fields=None,
        old_hash=None,
        new_hash=entity.payload_hash,
        summary=f"Rollback: restored entity {entity_key} (was deleted)",
    )
    session.add(change_event)

    # Re-index in search (via Celery)
    _queue_search_index(entity_key, organization_id, _build_search_payload(entity))

    return change_event
