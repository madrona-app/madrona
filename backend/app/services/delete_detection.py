"""
Delete detection service for detecting entity deletions during pipeline runs.

Supports two detection strategies:
1. Full Sync Comparison - Compare extracted entity keys against known keys
2. Incremental Delete Markers - Process explicit delete events from source

Supports three delete strategies for handling detected deletes:
1. Remove - Soft-delete entities (set is_deleted=True)
2. Mark - Mark entities with a deletion status while keeping them visible
3. Archive - Move entities to an archive table with deletion metadata

See docs/DELETE_SUPPORT_DESIGN.md for full design details.
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Iterator, Optional
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.models import EntityCurrent, Pipeline, PipelineSource, ChangeEvent

logger = logging.getLogger(__name__)


# =============================================================================
# Enums and Data Classes
# =============================================================================

class DeleteStrategy(str, Enum):
    """Strategy for handling detected deletes."""
    REMOVE = "remove"      # Soft-delete (is_deleted=True)
    MARK = "mark"          # Mark with status, keep visible
    ARCHIVE = "archive"    # Move to archive table


class DeleteDetectionMethod(str, Enum):
    """Method for detecting deletes."""
    FULL_SYNC = "full_sync"        # Compare against known entities
    INCREMENTAL = "incremental"    # Process explicit delete markers


@dataclass
class DeleteMarker:
    """
    Represents an explicit delete marker from a source system.

    Used for incremental delete detection where sources emit
    delete events (CDC, webhooks, deleted records endpoint).
    """
    entity_key: str
    source_id: str
    deleted_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    reason: Optional[str] = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "entity_key": self.entity_key,
            "source_id": self.source_id,
            "deleted_at": self.deleted_at.isoformat(),
            "reason": self.reason,
            "metadata": self.metadata,
        }


@dataclass
class DeleteResult:
    """Result of a delete operation."""
    total_processed: int = 0
    deleted_count: int = 0      # Soft-deleted (remove strategy)
    marked_count: int = 0       # Marked as deleted (mark strategy)
    archived_count: int = 0     # Moved to archive (archive strategy)
    skipped_count: int = 0      # Not found or already deleted
    error_count: int = 0
    errors: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "total_processed": self.total_processed,
            "deleted_count": self.deleted_count,
            "marked_count": self.marked_count,
            "archived_count": self.archived_count,
            "skipped_count": self.skipped_count,
            "error_count": self.error_count,
            "errors": self.errors[:20],  # Limit errors
        }


# =============================================================================
# Full Sync Delete Detector
# =============================================================================

class FullSyncDeleteDetector:
    """
    Detects deletes by comparing current extraction against known entities.

    This is used for sources that don't provide explicit delete markers.
    At the start of a full sync, we load all known entity keys. As records
    are extracted, we mark them as "seen". After extraction, any entities
    that weren't seen are presumed deleted.

    Usage:
        detector = FullSyncDeleteDetector(session, organization_id, dataset_id)

        # Before extraction - load known entities
        detector.begin_sync()

        # During extraction - mark each entity as seen
        for record in connector.extract():
            detector.mark_seen(record["entity_key"])
            yield record

        # After extraction - get entities not seen (deleted)
        deleted_keys = detector.get_deleted_keys()
    """

    def __init__(
        self,
        session: Session,
        organization_id: UUID,
        dataset_id: UUID | None = None,
        source_connector_instance_id: UUID | None = None,
    ):
        """
        Initialize the delete detector.

        Args:
            session: SQLAlchemy session
            organization_id: Organization to scope queries
            dataset_id: Optional dataset to scope queries
            source_connector_instance_id: Optional source connector to scope queries
                (entities are namespaced by source, so this filters to the specific source)
        """
        self.session = session
        self.organization_id = organization_id
        self.dataset_id = dataset_id
        self.source_connector_instance_id = source_connector_instance_id
        self.seen_keys: set[str] = set()
        self.known_keys: set[str] = set()
        self._sync_started = False

    def begin_sync(self) -> int:
        """
        Load all known entity keys for this scope.

        Must be called before extraction starts to capture the baseline
        of known entities.

        Returns:
            Number of known entities loaded
        """
        # Build query for non-deleted entities in scope
        query = (
            select(EntityCurrent.entity_key)
            .where(
                EntityCurrent.organization_id == self.organization_id,
                EntityCurrent.is_deleted == False,
            )
        )

        # Filter by dataset if provided
        if self.dataset_id:
            query = query.where(EntityCurrent.dataset_id == self.dataset_id)

        # Filter by source connector (entity_key is namespaced by connector)
        # Entity keys are formatted as: {source_system}:{connector_instance_id}:{source_id}
        if self.source_connector_instance_id:
            # Use LIKE to match entity keys containing this connector instance ID
            connector_pattern = f"%:{self.source_connector_instance_id}:%"
            query = query.where(EntityCurrent.entity_key.like(connector_pattern))

        result = self.session.execute(query)
        self.known_keys = {row[0] for row in result}
        self.seen_keys = set()
        self._sync_started = True

        logger.info(
            "FullSyncDeleteDetector: Loaded %d known entity keys (org=%s, dataset=%s, source=%s)",
            len(self.known_keys),
            self.organization_id,
            self.dataset_id,
            self.source_connector_instance_id,
        )

        return len(self.known_keys)

    def mark_seen(self, entity_key: str) -> None:
        """
        Mark an entity as present in current extraction.

        Should be called for each record extracted from the source.
        The entity_key should be the namespaced key used in the canonical store.

        Args:
            entity_key: The entity key (namespaced format)
        """
        if not self._sync_started:
            logger.warning("mark_seen called before begin_sync - ignoring")
            return
        self.seen_keys.add(entity_key)

    def mark_seen_batch(self, entity_keys: list[str]) -> None:
        """
        Mark multiple entities as seen in current extraction.

        More efficient than calling mark_seen() repeatedly.

        Args:
            entity_keys: List of entity keys (namespaced format)
        """
        if not self._sync_started:
            logger.warning("mark_seen_batch called before begin_sync - ignoring")
            return
        self.seen_keys.update(entity_keys)

    def get_deleted_keys(self) -> set[str]:
        """
        Return entity keys that were not seen (presumed deleted).

        Should be called after extraction is complete.

        Returns:
            Set of entity keys that existed before but weren't seen in this sync
        """
        if not self._sync_started:
            logger.warning("get_deleted_keys called before begin_sync - returning empty")
            return set()

        deleted = self.known_keys - self.seen_keys

        if deleted:
            logger.info(
                "FullSyncDeleteDetector: Found %d deleted entities (known=%d, seen=%d)",
                len(deleted),
                len(self.known_keys),
                len(self.seen_keys),
            )
        else:
            logger.debug(
                "FullSyncDeleteDetector: No deletes detected (known=%d, seen=%d)",
                len(self.known_keys),
                len(self.seen_keys),
            )

        return deleted

    def get_stats(self) -> dict:
        """
        Get statistics about the delete detection.

        Returns:
            Dict with known_count, seen_count, deleted_count
        """
        deleted = self.known_keys - self.seen_keys if self._sync_started else set()
        return {
            "known_count": len(self.known_keys),
            "seen_count": len(self.seen_keys),
            "deleted_count": len(deleted),
            "sync_started": self._sync_started,
        }


# =============================================================================
# Incremental Delete Detector
# =============================================================================

class IncrementalDeleteDetector:
    """
    Processes explicit delete markers from source systems.

    Used for sources that emit change data capture (CDC) events,
    webhooks, or provide a "deleted records" endpoint.

    Usage:
        detector = IncrementalDeleteDetector(session, organization_id)

        # Process delete markers from source
        for marker in connector.get_delete_markers():
            detector.add_delete_marker(marker)

        # Get all collected delete markers
        markers = detector.get_delete_markers()

        # Or process them directly
        result = detector.process_deletes(run_id, strategy=DeleteStrategy.REMOVE)
    """

    def __init__(
        self,
        session: Session,
        organization_id: UUID,
        dataset_id: UUID | None = None,
        source_connector_instance_id: UUID | None = None,
    ):
        """
        Initialize the incremental delete detector.

        Args:
            session: SQLAlchemy session
            organization_id: Organization to scope operations
            dataset_id: Optional dataset to scope operations
            source_connector_instance_id: Source connector for entity key namespacing
        """
        self.session = session
        self.organization_id = organization_id
        self.dataset_id = dataset_id
        self.source_connector_instance_id = source_connector_instance_id
        self._markers: list[DeleteMarker] = []

    def add_delete_marker(self, marker: DeleteMarker) -> None:
        """
        Add a delete marker to be processed.

        Args:
            marker: DeleteMarker instance
        """
        self._markers.append(marker)

    def add_delete_markers(self, markers: list[DeleteMarker]) -> None:
        """
        Add multiple delete markers.

        Args:
            markers: List of DeleteMarker instances
        """
        self._markers.extend(markers)

    def add_from_dict(self, data: dict[str, Any]) -> DeleteMarker:
        """
        Create and add a delete marker from a dictionary.

        Expected format:
            {
                "entity_key": str,       # Required
                "source_id": str,        # Required
                "deleted_at": datetime,  # Optional, defaults to now
                "reason": str,           # Optional
                "metadata": dict,        # Optional
            }

        Args:
            data: Dictionary with marker data

        Returns:
            Created DeleteMarker
        """
        deleted_at = data.get("deleted_at")
        if isinstance(deleted_at, str):
            deleted_at = datetime.fromisoformat(deleted_at.replace("Z", "+00:00"))
        elif deleted_at is None:
            deleted_at = datetime.now(timezone.utc)

        marker = DeleteMarker(
            entity_key=data["entity_key"],
            source_id=data["source_id"],
            deleted_at=deleted_at,
            reason=data.get("reason"),
            metadata=data.get("metadata", {}),
        )
        self._markers.append(marker)
        return marker

    def get_delete_markers(self) -> list[DeleteMarker]:
        """Get all collected delete markers."""
        return list(self._markers)

    def get_entity_keys(self) -> set[str]:
        """Get set of entity keys to delete."""
        return {m.entity_key for m in self._markers}

    def clear(self) -> None:
        """Clear all collected markers."""
        self._markers.clear()

    def get_stats(self) -> dict:
        """Get statistics about collected markers."""
        return {
            "marker_count": len(self._markers),
            "unique_entity_keys": len(self.get_entity_keys()),
        }


# =============================================================================
# Delete Strategy Implementations
# =============================================================================

def apply_delete_strategy(
    session: Session,
    organization_id: UUID,
    entity_keys: list[str],
    strategy: DeleteStrategy,
    run_id: UUID,
    dataset_id: UUID | None = None,
    pipeline_id: UUID | None = None,
    deleted_at: datetime | None = None,
    archive_reason: str | None = None,
) -> DeleteResult:
    """
    Apply a delete strategy to a list of entity keys.

    Args:
        session: SQLAlchemy session
        organization_id: Organization identifier
        entity_keys: List of entity keys to process
        strategy: Delete strategy to apply
        run_id: Run identifier for tracking
        dataset_id: Optional dataset identifier
        pipeline_id: Optional pipeline identifier
        deleted_at: Deletion timestamp (defaults to now)
        archive_reason: Reason for archival (archive strategy only)

    Returns:
        DeleteResult with counts and any errors
    """
    if strategy == DeleteStrategy.REMOVE:
        return _apply_remove_strategy(
            session, organization_id, entity_keys, run_id,
            dataset_id, pipeline_id, deleted_at
        )
    elif strategy == DeleteStrategy.MARK:
        return _apply_mark_strategy(
            session, organization_id, entity_keys, run_id,
            dataset_id, pipeline_id, deleted_at
        )
    elif strategy == DeleteStrategy.ARCHIVE:
        return _apply_archive_strategy(
            session, organization_id, entity_keys, run_id,
            dataset_id, pipeline_id, deleted_at, archive_reason
        )
    else:
        raise ValueError(f"Unknown delete strategy: {strategy}")


def _apply_remove_strategy(
    session: Session,
    organization_id: UUID,
    entity_keys: list[str],
    run_id: UUID,
    dataset_id: UUID | None = None,
    pipeline_id: UUID | None = None,
    deleted_at: datetime | None = None,
) -> DeleteResult:
    """
    Apply remove (soft-delete) strategy.

    Sets is_deleted=True on entities.
    """
    result = DeleteResult(total_processed=len(entity_keys))

    if not entity_keys:
        return result

    if deleted_at is None:
        deleted_at = datetime.now(timezone.utc)

    # Bulk fetch existing non-deleted entities
    existing_entities = session.query(EntityCurrent).filter(
        EntityCurrent.organization_id == organization_id,
        EntityCurrent.entity_key.in_(entity_keys),
        EntityCurrent.is_deleted == False,
    ).all()

    existing_map = {e.entity_key: e for e in existing_entities}

    for entity_key in entity_keys:
        entity = existing_map.get(entity_key)

        if not entity:
            result.skipped_count += 1
            continue

        try:
            # Soft-delete the entity
            entity.is_deleted = True
            entity.deleted_at = deleted_at
            entity.deleted_by_run_id = run_id

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
                summary=f"Soft-deleted entity {entity_key}",
            )
            session.add(change_event)

            result.deleted_count += 1

        except Exception as e:
            result.error_count += 1
            result.errors.append({
                "entity_key": entity_key,
                "error": str(e),
            })

    session.flush()
    return result


def _apply_mark_strategy(
    session: Session,
    organization_id: UUID,
    entity_keys: list[str],
    run_id: UUID,
    dataset_id: UUID | None = None,
    pipeline_id: UUID | None = None,
    deleted_at: datetime | None = None,
) -> DeleteResult:
    """
    Apply mark strategy.

    Marks entities with deletion_status="deleted" while keeping is_deleted=False.
    This allows the entity to remain visible but flagged as deleted.
    """
    result = DeleteResult(total_processed=len(entity_keys))

    if not entity_keys:
        return result

    if deleted_at is None:
        deleted_at = datetime.now(timezone.utc)

    # Bulk fetch existing non-deleted entities
    existing_entities = session.query(EntityCurrent).filter(
        EntityCurrent.organization_id == organization_id,
        EntityCurrent.entity_key.in_(entity_keys),
        EntityCurrent.is_deleted == False,
    ).all()

    existing_map = {e.entity_key: e for e in existing_entities}

    for entity_key in entity_keys:
        entity = existing_map.get(entity_key)

        if not entity:
            result.skipped_count += 1
            continue

        try:
            # Mark the entity as deleted (but don't soft-delete)
            # Store deletion info in the payload
            payload = entity.payload or {}
            if "meta" not in payload:
                payload["meta"] = {}
            payload["meta"]["deletion_status"] = "deleted"
            payload["meta"]["deletion_marked_at"] = deleted_at.isoformat()
            payload["meta"]["deletion_marked_by_run_id"] = str(run_id)
            entity.payload = payload
            flag_modified(entity, "payload")

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
                summary=f"Marked entity {entity_key} as deleted",
                changed_fields=["meta.deletion_status"],
            )
            session.add(change_event)

            result.marked_count += 1

        except Exception as e:
            result.error_count += 1
            result.errors.append({
                "entity_key": entity_key,
                "error": str(e),
            })

    session.flush()
    return result


def _apply_archive_strategy(
    session: Session,
    organization_id: UUID,
    entity_keys: list[str],
    run_id: UUID,
    dataset_id: UUID | None = None,
    pipeline_id: UUID | None = None,
    deleted_at: datetime | None = None,
    archive_reason: str | None = None,
) -> DeleteResult:
    """
    Apply archive strategy.

    Moves entities to archive by:
    1. Marking with archive metadata
    2. Setting is_deleted=True (to hide from normal queries)
    3. Preserving full entity data for recovery

    The archived entity can be restored if needed.
    """
    result = DeleteResult(total_processed=len(entity_keys))

    if not entity_keys:
        return result

    if deleted_at is None:
        deleted_at = datetime.now(timezone.utc)

    # Bulk fetch existing non-deleted entities
    existing_entities = session.query(EntityCurrent).filter(
        EntityCurrent.organization_id == organization_id,
        EntityCurrent.entity_key.in_(entity_keys),
        EntityCurrent.is_deleted == False,
    ).all()

    existing_map = {e.entity_key: e for e in existing_entities}

    for entity_key in entity_keys:
        entity = existing_map.get(entity_key)

        if not entity:
            result.skipped_count += 1
            continue

        try:
            # Add archive metadata to payload
            payload = entity.payload or {}
            if "meta" not in payload:
                payload["meta"] = {}

            payload["meta"]["archived"] = True
            payload["meta"]["archived_at"] = deleted_at.isoformat()
            payload["meta"]["archived_by_run_id"] = str(run_id)
            payload["meta"]["archive_reason"] = archive_reason or "Detected as deleted from source"

            # Preserve pre-archive state for potential restoration
            payload["meta"]["pre_archive_state"] = {
                "is_deleted": entity.is_deleted,
                "deleted_at": entity.deleted_at.isoformat() if entity.deleted_at else None,
            }

            entity.payload = payload
            flag_modified(entity, "payload")

            # Soft-delete to hide from normal queries
            entity.is_deleted = True
            entity.deleted_at = deleted_at
            entity.deleted_by_run_id = run_id

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
                summary=f"Archived entity {entity_key}: {archive_reason or 'deleted from source'}",
            )
            session.add(change_event)

            result.archived_count += 1

        except Exception as e:
            result.error_count += 1
            result.errors.append({
                "entity_key": entity_key,
                "error": str(e),
            })

    session.flush()
    return result


def restore_archived_entities(
    session: Session,
    organization_id: UUID,
    entity_keys: list[str],
    run_id: UUID,
) -> dict[str, int]:
    """
    Restore archived entities.

    Args:
        session: SQLAlchemy session
        organization_id: Organization identifier
        entity_keys: Entity keys to restore
        run_id: Run identifier for tracking

    Returns:
        Dict with counts: {"restored": N, "skipped": N}
    """
    counts = {"restored": 0, "skipped": 0}

    if not entity_keys:
        return counts

    # Fetch archived (deleted) entities
    entities = session.query(EntityCurrent).filter(
        EntityCurrent.organization_id == organization_id,
        EntityCurrent.entity_key.in_(entity_keys),
        EntityCurrent.is_deleted == True,
    ).all()

    for entity in entities:
        payload = entity.payload or {}
        meta = payload.get("meta", {})

        if not meta.get("archived"):
            counts["skipped"] += 1
            continue

        # Restore from archive
        entity.is_deleted = False
        entity.deleted_at = None
        entity.deleted_by_run_id = None

        # Update metadata
        meta["archived"] = False
        meta["restored_at"] = datetime.now(timezone.utc).isoformat()
        meta["restored_by_run_id"] = str(run_id)
        payload["meta"] = meta
        entity.payload = payload
        flag_modified(entity, "payload")

        counts["restored"] += 1

    session.flush()
    return counts


# =============================================================================
# Helper Functions
# =============================================================================

def should_detect_deletes(pipeline: Pipeline, sync_type: str) -> bool:
    """
    Determine if delete detection should be performed for this pipeline run.

    Args:
        pipeline: Pipeline model with delete detection configuration
        sync_type: "full" or "incremental"

    Returns:
        True if delete detection should be performed
    """
    # Check if delete detection is enabled
    if not pipeline.delete_detection_enabled:
        return False

    # Full sync detection only runs on full syncs
    if pipeline.delete_detection_method == "full_sync":
        if sync_type != "full":
            logger.debug(
                "Pipeline %s: Skipping delete detection (method=full_sync but sync_type=%s)",
                pipeline.pipeline_id,
                sync_type,
            )
            return False
        return True

    # Incremental detection runs on all syncs (source provides delete markers)
    if pipeline.delete_detection_method == "incremental":
        return True

    # Unknown method - don't detect
    logger.warning(
        "Pipeline %s: Unknown delete_detection_method=%s",
        pipeline.pipeline_id,
        pipeline.delete_detection_method,
    )
    return False


def get_delete_strategy(pipeline: Pipeline) -> DeleteStrategy:
    """
    Get the delete strategy for a pipeline.

    Args:
        pipeline: Pipeline model

    Returns:
        DeleteStrategy enum value
    """
    strategy_str = getattr(pipeline, "delete_strategy", "remove") or "remove"
    try:
        return DeleteStrategy(strategy_str)
    except ValueError:
        logger.warning(
            "Pipeline %s: Unknown delete_strategy=%s, defaulting to 'remove'",
            pipeline.pipeline_id,
            strategy_str,
        )
        return DeleteStrategy.REMOVE


def create_delete_detector(
    session: Session,
    pipeline: Pipeline,
    run_dataset_id: UUID | None,
    source_connector_instance_id: UUID | None = None,
) -> FullSyncDeleteDetector | IncrementalDeleteDetector | None:
    """
    Create a delete detector for the pipeline if delete detection is enabled.

    Args:
        session: SQLAlchemy session
        pipeline: Pipeline with delete detection configuration
        run_dataset_id: Dataset ID for the run
        source_connector_instance_id: Optional source connector to scope detection

    Returns:
        FullSyncDeleteDetector or IncrementalDeleteDetector if enabled, None otherwise
    """
    if not pipeline.delete_detection_enabled:
        return None

    if pipeline.delete_detection_method == "full_sync":
        return FullSyncDeleteDetector(
            session=session,
            organization_id=pipeline.organization_id,
            dataset_id=run_dataset_id,
            source_connector_instance_id=source_connector_instance_id,
        )

    if pipeline.delete_detection_method == "incremental":
        return IncrementalDeleteDetector(
            session=session,
            organization_id=pipeline.organization_id,
            dataset_id=run_dataset_id,
            source_connector_instance_id=source_connector_instance_id,
        )

    logger.warning(
        "Pipeline %s: Unknown delete_detection_method=%s",
        pipeline.pipeline_id,
        pipeline.delete_detection_method,
    )
    return None


def process_delete_markers(
    session: Session,
    organization_id: UUID,
    markers: list[DeleteMarker],
    strategy: DeleteStrategy,
    run_id: UUID,
    dataset_id: UUID | None = None,
    pipeline_id: UUID | None = None,
) -> DeleteResult:
    """
    Process a list of delete markers using the specified strategy.

    Convenience function for incremental delete detection.

    Args:
        session: SQLAlchemy session
        organization_id: Organization identifier
        markers: List of DeleteMarker instances
        strategy: Delete strategy to apply
        run_id: Run identifier
        dataset_id: Optional dataset identifier
        pipeline_id: Optional pipeline identifier

    Returns:
        DeleteResult with counts
    """
    entity_keys = [m.entity_key for m in markers]

    # Group by deleted_at for more accurate timestamps
    # For simplicity, use the most recent timestamp
    deleted_at = max(m.deleted_at for m in markers) if markers else None

    return apply_delete_strategy(
        session=session,
        organization_id=organization_id,
        entity_keys=entity_keys,
        strategy=strategy,
        run_id=run_id,
        dataset_id=dataset_id,
        pipeline_id=pipeline_id,
        deleted_at=deleted_at,
    )
