"""
Pipeline orchestration service for executing end-to-end data flows.

Coordinates:
1. Source connector extraction + normalization
2. Canonical store upsert (with change detection)
3. Target connector publishing (records + change log)

This is the core Pipeline execution orchestration without worker complexity.
For v1, execution is synchronous - perfect for demo and simple deployments.
"""

import hashlib
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.connectors.base import BaseSourceConnector, BaseTargetConnector
from app.connectors.loader import load_connector_from_db_record
from app.models import (
    Run,
    Pipeline,
    PipelineSource,
    PipelineDestination,
    ConnectorInstance,
    ConnectorDefinition,
    EntityCurrent,
    ChangeEvent,
)
from app.services.canonical_store import batch_upsert_entities, batch_delete_entities
from app.services.delete_detection import (
    FullSyncDeleteDetector,
    should_detect_deletes,
    create_delete_detector,
)
from app.services.change_log import (
    get_change_events_for_run,
    format_change_events_for_target,
)
from app.services.run_notifications import notify_run_failure
from app.services.event_emitter import (
    emit_run_started,
    emit_run_progress,
    emit_run_completed,
    emit_run_failed,
)
from app.services.profile_processor import (
    get_profile_validation_mode,
    process_records_with_profile,
    ProfileProcessingResult,
)

logger = logging.getLogger(__name__)


# Status transition state machine
# Maps (old_status -> [allowed_new_statuses])
ALLOWED_TRANSITIONS = {
    "queued": ["pending", "running", "canceled"],
    "pending": ["running", "canceled"],
    "running": ["publishing", "success", "warning", "failed", "canceled"],
    "publishing": ["success", "warning", "failed_publish", "canceled"],
    "success": ["rolled_back"],  # Can be rolled back
    "warning": ["rolled_back"],  # Can be rolled back
    "failed": [],  # Terminal state
    "failed_publish": [],  # Terminal state
    "failed_finalize": [],  # Terminal state
    "canceled": [],  # Terminal state
    "rolled_back": [],  # Terminal state
}


def validate_transition(old_status: str, new_status: str) -> tuple[bool, str | None]:
    """
    Validate a status transition according to the state machine.
    
    Args:
        old_status: Current status
        new_status: Requested new status
        
    Returns:
        Tuple of (is_valid, error_message).
        If is_valid is False, error_message explains why.
    """
    # Allow self-transitions (idempotent updates)
    if old_status == new_status:
        return True, None
    
    # Check if old_status is in the transition map
    if old_status not in ALLOWED_TRANSITIONS:
        return False, f"Unknown status: {old_status}"
    
    allowed = ALLOWED_TRANSITIONS[old_status]
    
    # Terminal states cannot transition
    if not allowed:
        return False, f"Cannot transition from terminal state '{old_status}'"
    
    # Check if new_status is allowed
    if new_status not in allowed:
        return False, f"Invalid transition from '{old_status}' to '{new_status}'. Allowed: {', '.join(allowed)}"
    
    return True, None


def safe_update_status(run: Run, new_status: str) -> None:
    """
    Safely update run status with state machine validation.
    
    Raises:
        PipelineError: If transition is invalid
    """
    is_valid, error_msg = validate_transition(run.status, new_status)
    if not is_valid:
        raise PipelineError(f"Status transition error for run {run.run_id}: {error_msg}")
    run.status = new_status


@dataclass
class RunResult:
    """Result of executing a run with metrics and status.
    
    IMPORTANT: This is an ephemeral response object, not a database model.
    The `error` and `error_stage` fields are RESPONSE-ONLY (not persisted to DB).
    They provide detailed failure context in API responses but are never stored
    in the Run table. Use these fields only for immediate error reporting in 
    API endpoints, never for database queries or persistence.
    """
    
    run_id: UUID
    status: str  # "success", "failed", "failed_publish"
    duration_ms: int
    counts: dict[str, int]  # created, updated, noop
    target_url: str | None
    error: str | None = None  # RESPONSE-ONLY: Not persisted to database
    error_stage: str | None = None  # RESPONSE-ONLY: Not persisted ("extract", "canonical", "publish", "finalize")


class PipelineError(Exception):
    """Raised when pipeline execution fails."""
    pass


class RunConflictError(PipelineError):
    """Raised when operation conflicts with current run state (HTTP 409)."""
    pass


def find_last_successful_run(
    session: Session,
    organization_id: UUID,
    pipeline_id: UUID,
    query_hash: str,
) -> Run | None:
    """
    Find the most recent successful run for incremental sync watermark.

    Args:
        session: Database session
        organization_id: Organization identifier
        pipeline_id: Pipeline identifier
        query_hash: Query configuration hash (ensures same query parameters)

    Returns:
        Last successful run with matching query_hash, or None
    """
    return (
        session.query(Run)
        .filter(
            Run.organization_id == organization_id,
            Run.pipeline_id == pipeline_id,
            Run.status == "success",
            Run.parameters["query_hash"].as_string() == query_hash,
        )
        .order_by(Run.finished_at.desc())
        .first()
    )


def decide_sync_mode(
    session: Session,
    run: Run,
    pipeline_id: UUID,
    query_hash: str,
) -> tuple[str, int | None, str]:
    """
    Decide whether to perform full or incremental sync.

    Rules:
    1. If run.parameters["force_full_sync"] is true: FULL sync
    2. Else if last successful run exists with same query_hash and has high_watermark: INCREMENTAL
    3. Else: FULL sync

    Args:
        session: Database session
        run: Current run being executed
        pipeline_id: Pipeline identifier
        query_hash: Query configuration hash

    Returns:
        Tuple of (sync_type, last_sync_timestamp, reason)
        - sync_type: "full" or "incremental"
        - last_sync_timestamp: Unix timestamp for incremental, None for full
        - reason: Human-readable explanation of decision
    """
    # Check for force_full_sync override
    force_full = run.parameters.get("force_full_sync", False) if run.parameters else False
    if force_full:
        return ("full", None, "force_full_sync_requested")

    # Look for last successful run with same query config
    last_run = find_last_successful_run(
        session=session,
        organization_id=run.organization_id,
        pipeline_id=pipeline_id,
        query_hash=query_hash,
    )
    
    if last_run and last_run.finished_at:
        # Check if last run has watermark in parameters
        watermark = None
        if last_run.parameters:
            # Check new location first (run.parameters.high_watermark_source_ts)
            watermark = last_run.parameters.get("high_watermark_source_ts")
            # Fallback to old nested location for backward compatibility
            if watermark is None and "stats" in last_run.parameters:
                watermark = last_run.parameters["stats"].get("high_watermark_source_ts")
        
        if watermark:
            # Use watermark from previous run
            return ("incremental", watermark, f"continuing_from_run_{last_run.run_id}")
    
    # Default: full sync
    return ("full", None, "no_previous_successful_run")


def phase_extract_and_canonicalize(
    session: Session,
    run_id: UUID,
) -> dict:
    """
    Phase 1: Extract from source(s) and canonicalize to entity_current.
    
    Phase 3: Multi-source support (fan-in):
    - Iterates over all enabled pipeline_sources (ordered by pipeline_sources.ordering)
    - For each source: extract → normalize → upsert → update run_source_step
    - Implements deterministic merge: later sources win for overlapping canonical fields
    - Stores per-source raw payloads in entity.sources map
    - Tracks per-source execution in run_source_steps table
    
    Args:
        session: Database session
        run_id: Run identifier
        
    Returns:
        Dictionary with aggregated results:
            - processed: total number of records processed across all sources
            - created: number of new entities created
            - updated: number of existing entities updated
            - skipped: number of no-op records (unchanged)
            - entity_keys: list of entity keys changed in this run
            - canonical_hashes: dict mapping entity_key -> payload_hash
            
    Raises:
        PipelineError: If extraction or canonicalization fails
    """
    started_at = datetime.now(timezone.utc)
    
    # Load run
    run = session.query(Run).filter_by(run_id=run_id).first()
    if not run:
        raise PipelineError(f"Run {run_id} not found")
    
    if run.status not in ("pending", "queued", "running"):
        raise PipelineError(f"Run {run_id} has invalid status: {run.status}")
    
    # Mark as running
    run.status = "running"
    run.started_at = started_at
    session.commit()
    logger.info("Run %s marked as running", run_id)

    # Emit WebSocket event for run start
    emit_run_started(
        org_id=run.organization_id,
        run_id=run_id,
        pipeline_id=run.pipeline_id,
    )

    # A run must belong to exactly one pipeline. runs.pipeline_id is nullable, so
    # a run without one is representable and reachable — legacy rows, a partial
    # create — and it is a conflict with the run's state, not a server fault.
    # As a bare PipelineError this surfaced as a 500; RunConflictError is the
    # 409 the caller can act on.
    if not run.pipeline_id:
        raise RunConflictError(
            f"Run {run_id} is not associated with a pipeline and cannot be executed."
        )

    pipeline = session.query(Pipeline).filter_by(pipeline_id=run.pipeline_id).first()
    if not pipeline:
        raise PipelineError(f"Pipeline {run.pipeline_id} not found")
    
    organization_id = run.organization_id

    # Phase 3: Load all enabled pipeline_sources (ordered by ordering)
    from app.models import RunSourceStep
    pipeline_sources = (
        session.query(PipelineSource)
        .filter_by(pipeline_id=pipeline.pipeline_id, enabled=True)
        .order_by(PipelineSource.ordering)
        .all()
    )

    if not pipeline_sources:
        raise PipelineError(f"Pipeline {pipeline.pipeline_id} has no enabled source connectors")

    logger.info("Run %s: Processing %d source(s)", run_id, len(pipeline_sources))
    
    # Aggregate counts across all sources
    total_counts = {"created": 0, "updated": 0, "noop": 0, "deleted": 0}
    total_processed = 0
    all_entity_keys = []

    # Initialize delete detectors for each source (if delete detection enabled)
    # We use per-source detectors since entity keys are namespaced by source
    delete_detectors: dict[UUID, FullSyncDeleteDetector] = {}

    # Initialize run.parameters if needed
    if not run.parameters:
        run.parameters = {}
    
    # Process each source in order
    for source_idx, pipeline_source in enumerate(pipeline_sources):
        source_start_time = datetime.now(timezone.utc)
        connector_instance_id = pipeline_source.connector_instance_id

        logger.info(
            "Run %s: Processing source %d/%d (connector_instance_id=%s, ordering=%d)",
            run_id,
            source_idx + 1,
            len(pipeline_sources),
            connector_instance_id,
            pipeline_source.ordering if hasattr(pipeline_source, 'ordering') else 0,
        )

        # Load run_source_step if it exists (for Phase 3 tracking)
        run_source_step = None
        if pipeline_source.source_id:  # Only if this is a real PipelineSource
            run_source_step = (
                session.query(RunSourceStep)
                .filter_by(run_id=run_id, pipeline_source_id=pipeline_source.source_id)
                .first()
            )
            if run_source_step:
                run_source_step.status = "running"
                run_source_step.started_at = source_start_time
                session.commit()
        
        try:
            # Load connector instance and definition
            source_instance = (
                session.query(ConnectorInstance)
                .filter_by(connector_instance_id=connector_instance_id)
                .first()
            )
            if not source_instance:
                raise PipelineError(
                    f"Source connector instance {connector_instance_id} not found"
                )
            
            source_definition = (
                session.query(ConnectorDefinition)
                .filter_by(connector_definition_id=source_instance.connector_definition_id)
                .first()
            )
            if not source_definition:
                raise PipelineError(
                    f"Source connector definition {source_instance.connector_definition_id} not found"
                )
            
            logger.info(
                "Run %s source %d: extracting from %s",
                run_id,
                source_idx + 1,
                source_definition.display_name,
            )
            
            # Instantiate source connector
            source_connector: BaseSourceConnector = load_connector_from_db_record(
                connector_instance={
                    "connector_instance_id": str(source_instance.connector_instance_id),
                    "config": source_instance.config,
                },
                connector_definition={
                    "implementation_key": source_definition.implementation_key,
                    "config_schema": source_definition.config_schema,
                },
                organization_id=organization_id,
            )
            
            # Compute query_hash and decide sync mode (per-source for Phase 3)
            query_hash = None
            if hasattr(source_connector, "get_query_hash"):
                query_hash = source_connector.get_query_hash()

            sync_type, last_sync_timestamp, sync_reason = decide_sync_mode(
                session=session,
                run=run,
                pipeline_id=pipeline.pipeline_id,
                query_hash=query_hash or f"unknown_source_{source_idx}",
            )
            
            # Store sync metadata in run.parameters (per-source)
            source_key = f"source_{source_idx}"
            run.parameters[source_key] = {
                "connector_instance_id": str(connector_instance_id),
                "sync_type": sync_type,
                "query_hash": query_hash,
                "watermark_from": last_sync_timestamp,
            }
            flag_modified(run, "parameters")
            session.commit()
            
            # Log sync decision
            if sync_type == "full":
                logger.info("Run %s source %d: Starting full sync (reason: %s)", run_id, source_idx + 1, sync_reason)
            else:
                logger.info(
                    "Run %s source %d: Starting incremental sync from timestamp %d (reason: %s)",
                    run_id,
                    source_idx + 1,
                    last_sync_timestamp,
                    sync_reason,
                )

            # Initialize delete detector for this source (if enabled and full sync)
            if should_detect_deletes(pipeline, sync_type):
                detector = FullSyncDeleteDetector(
                    session=session,
                    organization_id=organization_id,
                    dataset_id=run.dataset_id,
                    source_connector_instance_id=connector_instance_id,
                )
                known_count = detector.begin_sync()
                delete_detectors[connector_instance_id] = detector
                logger.info(
                    "Run %s source %d: Delete detection enabled (known_entities=%d)",
                    run_id,
                    source_idx + 1,
                    known_count,
                )

            # Extract data
            logger.info("Run %s source %d: Extracting data", run_id, source_idx + 1)
            
            extract_kwargs = {}
            if last_sync_timestamp and hasattr(source_connector, "extract"):
                import inspect
                sig = inspect.signature(source_connector.extract)
                if "last_sync_timestamp" in sig.parameters:
                    extract_kwargs["last_sync_timestamp"] = last_sync_timestamp
            
            raw_records = list(source_connector.extract(**extract_kwargs))
            logger.info("Run %s source %d: Extracted %d raw records", run_id, source_idx + 1, len(raw_records))
            
            # Capture high watermark from connector but DO NOT commit it yet.
            # The watermark is only persisted after all batches are successfully
            # upserted (see below).  Committing it here would cause data loss if
            # the pipeline crashes between extraction and publish — the next
            # incremental sync would skip the records that were never published.
            _pending_watermark = None
            if hasattr(source_connector, "high_watermark_source_ts"):
                watermark = source_connector.high_watermark_source_ts
                if watermark is not None:
                    _pending_watermark = watermark
                    logger.info(
                        "Run %s source %d: High watermark source timestamp (pending): %d",
                        run_id,
                        source_idx + 1,
                        watermark,
                    )
                elif len(raw_records) == 0 and last_sync_timestamp:
                    _pending_watermark = last_sync_timestamp

            run.parameters[source_key]["records_read"] = len(raw_records)
            flag_modified(run, "parameters")
            session.commit()
            
            # Normalize records
            logger.info("Run %s source %d: Normalizing %d records", run_id, source_idx + 1, len(raw_records))
            canonical_records = []
            for record in raw_records:
                normalized = source_connector.normalize(record)
                
                # Phase 3: Namespace entity_key with connector_instance_id
                # Format: {source_system}:{connector_instance_id}:{source_id}
                original_entity_key = normalized["entity_key"]
                original_source_system = normalized.get("source_system", "unknown")
                original_source_id = normalized.get("source_id", "unknown")
                
                # Generate namespaced values (to prevent UNIQUE constraint violations)
                namespaced_source_system = f"{original_source_system}:{connector_instance_id}"
                namespaced_source_id = f"{connector_instance_id}:{original_source_id}"
                namespaced_entity_key = f"{original_source_system}:{connector_instance_id}:{original_source_id}"
                
                # Update normalized record with namespaced values
                normalized["source_system"] = namespaced_source_system
                normalized["source_id"] = namespaced_source_id
                normalized["entity_key"] = namespaced_entity_key
                
                # Store original values for reference
                normalized["_original_entity_key"] = original_entity_key
                normalized["_original_source_system"] = original_source_system
                normalized["_original_source_id"] = original_source_id
                
                canonical_records.append(normalized)
            
            logger.info("Run %s source %d: Normalized %d canonical records", run_id, source_idx + 1, len(canonical_records))

            # Profile validation and enrichment (if target_profile is configured)
            validation_mode = get_profile_validation_mode(pipeline)
            if pipeline.target_profile and validation_mode != "none":
                logger.info(
                    "Run %s source %d: Validating %d records against profile '%s' (mode=%s)",
                    run_id, source_idx + 1, len(canonical_records), pipeline.target_profile, validation_mode
                )

                canonical_records, profile_result = process_records_with_profile(
                    records=canonical_records,
                    profile_name=pipeline.target_profile,
                    validation_mode=validation_mode,
                    apply_enrichments=True,  # Enable enrichments to help data pass validation
                )

                # Log profile processing results
                if profile_result.validation_issues:
                    logger.warning(
                        "Run %s source %d: Profile validation found %d issues (%d errors, %d valid)",
                        run_id, source_idx + 1, len(profile_result.validation_issues),
                        profile_result.invalid_count, profile_result.valid_count
                    )

                if profile_result.enriched_count > 0:
                    logger.info(
                        "Run %s source %d: Enriched %d records for profile '%s'",
                        run_id, source_idx + 1, profile_result.enriched_count, pipeline.target_profile
                    )

                # Store profile validation summary in run parameters
                profile_summary = {
                    "profile_name": pipeline.target_profile,
                    "validation_mode": validation_mode,
                    "total_records": profile_result.total_records,
                    "valid_count": profile_result.valid_count,
                    "invalid_count": profile_result.invalid_count,
                    "enriched_count": profile_result.enriched_count,
                }
                if validation_mode == "strict" and profile_result.rejected_records:
                    profile_summary["rejected_count"] = len(profile_result.rejected_records)

                run.parameters[source_key]["profile_validation"] = profile_summary
                flag_modified(run, "parameters")
                session.commit()

            # Batch upsert to canonical store with incremental run count updates
            logger.info("Run %s source %d: Upserting %d records to canonical store", run_id, source_idx + 1, len(canonical_records))
            counts = {"created": 0, "updated": 0, "noop": 0}
            batch_size = 100
            
            for batch_start in range(0, len(canonical_records), batch_size):
                batch_end = min(batch_start + batch_size, len(canonical_records))
                batch_records = canonical_records[batch_start:batch_end]
                batch_raw = raw_records[batch_start:batch_end] if raw_records else None
                
                # Process batch
                batch_counts = batch_upsert_entities(
                    session=session,
                    organization_id=organization_id,
                    run_id=run_id,
                    pipeline_id=pipeline.pipeline_id,
                    canonical_records=batch_records,
                    extracted_at=started_at,
                    dataset_id=run.dataset_id,
                    source_connector_instance_id=connector_instance_id,
                    raw_records=batch_raw,
                )

                # Track seen entities for delete detection
                if connector_instance_id in delete_detectors:
                    batch_keys = [r["entity_key"] for r in batch_records]
                    delete_detectors[connector_instance_id].mark_seen_batch(batch_keys)

                # Update running totals
                counts["created"] += batch_counts["created"]
                counts["updated"] += batch_counts["updated"]
                counts["noop"] += batch_counts["noop"]
                total_counts["created"] += batch_counts["created"]
                total_counts["updated"] += batch_counts["updated"]
                total_counts["noop"] += batch_counts["noop"]
                total_processed += len(batch_records)
                
                # Update run counts incrementally so polling sees progress
                run.processed_count = total_processed
                run.created_count = total_counts["created"]
                run.updated_count = total_counts["updated"]
                run.skipped_count = total_counts["noop"]
                session.commit()

                # Emit WebSocket progress event
                emit_run_progress(
                    org_id=run.organization_id,
                    run_id=run_id,
                    pipeline_id=run.pipeline_id,
                    status="running",
                    processed_count=total_processed,
                    created_count=total_counts["created"],
                    updated_count=total_counts["updated"],
                    skipped_count=total_counts["noop"],
                )

                logger.info(
                    "Run %s source %d: Batch %d-%d complete - Total: %d created, %d updated, %d noop",
                    run_id,
                    source_idx + 1,
                    batch_start,
                    batch_end,
                    total_counts["created"],
                    total_counts["updated"],
                    total_counts["noop"],
                )
            
            logger.info(
                "Run %s source %d: Upsert complete - Created: %d, Updated: %d, Noop: %d",
                run_id,
                source_idx + 1,
                counts["created"],
                counts["updated"],
                counts["noop"],
            )
            
            # NOW persist the watermark — all batches have been upserted successfully
            if _pending_watermark is not None:
                run.parameters[source_key]["high_watermark_source_ts"] = _pending_watermark
                flag_modified(run, "parameters")
                logger.info(
                    "Run %s source %d: Committed high watermark: %s",
                    run_id, source_idx + 1, _pending_watermark,
                )

            # Update run_source_step with success
            if run_source_step:
                run_source_step.status = "success"
                run_source_step.finished_at = datetime.now(timezone.utc)
                run_source_step.counts = {
                    "processed": len(canonical_records),
                    "created": counts["created"],
                    "updated": counts["updated"],
                    "skipped": counts["noop"],
                }
                session.commit()
                logger.info("Run %s source %d: Updated run_source_step with success", run_id, source_idx + 1)
        
        except Exception as e:
            # Update run_source_step with failure
            if run_source_step:
                run_source_step.status = "failed"
                run_source_step.finished_at = datetime.now(timezone.utc)
                run_source_step.error = str(e)
                session.commit()
                logger.error("Run %s source %d: Failed with error: %s", run_id, source_idx + 1, str(e))
            raise  # Re-raise to fail the entire run

    # Process deletes for all sources with delete detection enabled
    if delete_detectors:
        logger.info("Run %s: Processing delete detection for %d source(s)", run_id, len(delete_detectors))

        for connector_id, detector in delete_detectors.items():
            deleted_keys = detector.get_deleted_keys()

            if deleted_keys:
                logger.info(
                    "Run %s: Deleting %d entities for source %s",
                    run_id,
                    len(deleted_keys),
                    connector_id,
                )

                delete_result = batch_delete_entities(
                    session=session,
                    organization_id=organization_id,
                    entity_keys=list(deleted_keys),
                    run_id=run_id,
                    dataset_id=run.dataset_id,
                    pipeline_id=pipeline.pipeline_id,
                )

                total_counts["deleted"] += delete_result["deleted"]
                total_processed += delete_result["deleted"]

                # Update run counts with deletes
                run.deleted_count = total_counts["deleted"]
                run.processed_count = total_processed
                session.commit()

                # Emit WebSocket progress event with delete counts
                emit_run_progress(
                    org_id=run.organization_id,
                    run_id=run_id,
                    pipeline_id=run.pipeline_id,
                    status="running",
                    processed_count=total_processed,
                    created_count=total_counts["created"],
                    updated_count=total_counts["updated"],
                    skipped_count=total_counts["noop"],
                    deleted_count=total_counts["deleted"],
                )

                logger.info(
                    "Run %s: Delete detection complete - Deleted: %d, Skipped: %d",
                    run_id,
                    delete_result["deleted"],
                    delete_result["skipped"],
                )

    # Store aggregated counts in run.parameters
    run.parameters["total_sources_processed"] = len(pipeline_sources)
    run.parameters["total_records_read"] = sum(
        run.parameters.get(f"source_{i}", {}).get("records_read", 0)
        for i in range(len(pipeline_sources))
    )
    run.parameters["total_records_upserted"] = total_counts["created"] + total_counts["updated"]
    run.parameters["total_records_deleted"] = total_counts["deleted"]
    flag_modified(run, "parameters")

    # INVARIANT: Canonical phase must complete before publish phase begins
    # Commit canonical store work and update run metrics
    run.status = "publishing"
    run.processed_count = total_processed
    run.created_count = total_counts["created"]
    run.updated_count = total_counts["updated"]
    run.skipped_count = total_counts["noop"]
    run.deleted_count = total_counts["deleted"]
    session.commit()
    logger.info("Run %s: canonical store committed (INVARIANT: canonical before publish)", run_id)
    
    # Fetch entity keys that changed in this run (for publishing)
    change_events = (
        session.query(ChangeEvent)
        .filter_by(run_id=run_id)
        .filter(ChangeEvent.change_type.in_(["created", "updated"]))
        .all()
    )
    entity_keys = [event.entity_key for event in change_events]
    
    # Build canonical_hashes map (entity_key -> payload_hash)
    # Exclude deleted entities to ensure we only report active ones
    canonical_hashes = {}
    if entity_keys:
        changed_entities = (
            session.query(EntityCurrent)
            .filter_by(organization_id=organization_id)
            .filter(EntityCurrent.entity_key.in_(entity_keys))
            .filter(EntityCurrent.is_deleted == False)
            .all()
        )
        for entity in changed_entities:
            canonical_hashes[entity.entity_key] = entity.payload_hash
    
    return {
        "processed": total_processed,
        "created": total_counts["created"],
        "updated": total_counts["updated"],
        "skipped": total_counts["noop"],
        "deleted": total_counts["deleted"],
        "entity_keys": entity_keys,
        "canonical_hashes": canonical_hashes,
    }


def phase_publish_destinations(
    session: Session,
    run_id: UUID,
    canonicalize_result: dict,
) -> dict:
    """
    Phase 2: Publish to destination connectors (multi-destination with continue-on-failure).
    
    Multi-destination execution rules:
    1. Load all enabled pipeline_destinations (ordered by ordering)
    2. For each destination:
       a. Create/update run_destination_step (status=running)
       b. Publish change set (only created+updated entities from this run)
       c. Update run_destination_step (success/failed with counts/error)
    3. Continue on failure - partial success is allowed
    4. Return aggregated results
    
    Args:
        session: SQLAlchemy session
        run_id: Run identifier
        canonicalize_result: Output from phase_extract_and_canonicalize
            with entity_keys that changed
            
    Returns:
        dict with:
            - target_url: URL of first successful destination (if available)
            - published_at: timestamp when publish completed
            - success_count: number of destinations that succeeded
            - failed_count: number of destinations that failed
            - partial: True if some destinations failed
            
    Raises:
        PipelineError: If critical error prevents publishing (e.g., run not found)
    """
    from app.models import RunDestinationStep
    
    run = session.query(Run).filter_by(run_id=run_id).first()
    if not run:
        raise PipelineError(f"Run {run_id} not found")

    pipeline = session.query(Pipeline).filter_by(pipeline_id=run.pipeline_id).first()
    if not pipeline:
        raise PipelineError(f"Pipeline {run.pipeline_id} not found")

    organization_id = run.organization_id

    # Check if pipeline has destinations (skip for source-only pipelines)
    pipeline_destinations = (
        session.query(PipelineDestination)
        .filter_by(pipeline_id=pipeline.pipeline_id, enabled=True)
        .order_by(PipelineDestination.ordering)
        .all()
    )

    if not pipeline_destinations:
        logger.info("Run %s: source-only pipeline (no destinations), skipping publish phase", run_id)
        return {
            "target_url": None,
            "published_at": None,
            "success_count": 0,
            "failed_count": 0,
            "partial": False,
        }

    logger.info("Run %s: Publishing to %d destination(s)", run_id, len(pipeline_destinations))
    
    # Fetch change events for this run (only publish the change set)
    entity_keys_changed = canonicalize_result.get("entity_keys", [])
    deleted_count = canonicalize_result.get("deleted", 0)
    logger.info("Run %s: %d entities changed, %d deleted in this run", run_id, len(entity_keys_changed), deleted_count)

    # Fetch create/update change events
    change_events = get_change_events_for_run(
        session=session,
        organization_id=organization_id,
        run_id=run_id,
        change_types=["created", "updated"],
    )

    # Fetch delete change events separately (for destinations that publish deletes)
    delete_change_events = get_change_events_for_run(
        session=session,
        organization_id=organization_id,
        run_id=run_id,
        change_types=["deleted"],
    )

    # Fetch changed entities for publishing
    # Only publish non-deleted entities (skip any deleted during this run)
    changed_entities = []
    if entity_keys_changed:
        changed_entities = (
            session.query(EntityCurrent)
            .filter_by(organization_id=organization_id)
            .filter(EntityCurrent.entity_key.in_(entity_keys_changed))
            .filter(EntityCurrent.is_deleted == False)
            .all()
        )

    entity_payloads = [entity.payload for entity in changed_entities]

    # Combine all change events for the change log (including deletes)
    all_change_events = change_events + delete_change_events
    change_log = format_change_events_for_target(all_change_events, include_field_diffs=True)
    
    logger.info(
        "Run %s: Publishing %d entity payloads and %d change events",
        run_id,
        len(entity_payloads),
        len(change_events),
    )
    
    # Track results across all destinations
    success_count = 0
    failed_count = 0
    first_target_url = None
    published_at = None
    
    # Process each destination (continue-on-failure)
    for dest_idx, pipeline_destination in enumerate(pipeline_destinations):
        dest_start_time = datetime.now(timezone.utc)
        connector_instance_id = pipeline_destination.connector_instance_id

        logger.info(
            "Run %s: Publishing to destination %d/%d (connector_instance_id=%s, ordering=%d)",
            run_id,
            dest_idx + 1,
            len(pipeline_destinations),
            connector_instance_id,
            pipeline_destination.ordering,
        )

        # Find or create destination step
        dest_step = (
            session.query(RunDestinationStep)
            .filter_by(run_id=run_id, pipeline_destination_id=pipeline_destination.destination_id)
            .first()
        )

        if not dest_step:
            dest_step = RunDestinationStep(
                run_id=run_id,
                pipeline_destination_id=pipeline_destination.destination_id,
                status="pending",
                counts={},
            )
            session.add(dest_step)
            session.flush()
        
        # Mark as running
        dest_step.status = "running"
        dest_step.started_at = dest_start_time
        session.commit()
        
        try:
            # Load destination connector
            target_instance = (
                session.query(ConnectorInstance)
                .filter_by(connector_instance_id=connector_instance_id)
                .first()
            )
            if not target_instance:
                raise PipelineError(
                    f"Target connector instance {connector_instance_id} not found"
                )
            
            target_definition = (
                session.query(ConnectorDefinition)
                .filter_by(connector_definition_id=target_instance.connector_definition_id)
                .first()
            )
            if not target_definition:
                raise PipelineError(
                    f"Target connector definition {target_instance.connector_definition_id} not found"
                )
            
            logger.info(
                "Run %s destination %d: publishing to %s",
                run_id,
                dest_idx + 1,
                target_definition.display_name,
            )
            
            # Instantiate target connector
            target_connector: BaseTargetConnector = load_connector_from_db_record(
                connector_instance={
                    "connector_instance_id": str(target_instance.connector_instance_id),
                    "config": target_instance.config,
                },
                connector_definition={
                    "implementation_key": target_definition.implementation_key,
                    "config_schema": target_definition.config_schema,
                },
                organization_id=organization_id,
            )
            
            # Publish records and change log
            target_connector.publish_records(entity_payloads)
            target_connector.publish_change_log(change_log)

            # Publish deletes if destination is configured and connector supports it
            deletes_published = 0
            if (
                delete_change_events
                and pipeline_destination.publish_deletes
                and target_connector.supports_deletes()
            ):
                # Prepare deleted entity info for connector
                deleted_entities = [
                    {
                        "entity_key": event.entity_key,
                        "entity_type": event.entity_type,
                        "deleted_at": event.occurred_at.isoformat() if event.occurred_at else None,
                    }
                    for event in delete_change_events
                ]

                # Get delete strategy from destination config
                delete_strategy = pipeline_destination.delete_strategy or "remove"

                logger.info(
                    "Run %s destination %d: Publishing %d deletes (strategy=%s)",
                    run_id,
                    dest_idx + 1,
                    len(deleted_entities),
                    delete_strategy,
                )

                delete_result = target_connector.publish_deletes(
                    deleted_entities=deleted_entities,
                    strategy=delete_strategy,
                )
                deletes_published = delete_result.get("deleted", 0)

                logger.info(
                    "Run %s destination %d: Delete publish result - deleted=%d, failed=%d, skipped=%d",
                    run_id,
                    dest_idx + 1,
                    delete_result.get("deleted", 0),
                    delete_result.get("failed", 0),
                    delete_result.get("skipped", 0),
                )

            # Get target URL from connector
            target_url = target_connector.get_target_url()
            if first_target_url is None:
                first_target_url = target_url
                published_at = datetime.now(timezone.utc)

            # Mark destination step as success
            dest_step.status = "success"
            dest_step.finished_at = datetime.now(timezone.utc)
            dest_step.counts = {
                "records_published": len(entity_payloads),
                "changes_published": len(all_change_events),
                "deletes_published": deletes_published,
            }
            session.commit()
            
            success_count += 1
            logger.info(
                "Run %s destination %d: Published successfully (target_url=%s)",
                run_id,
                dest_idx + 1,
                target_url,
            )
            
        except Exception as dest_error:
            # Log error and continue to next destination
            error_message = str(dest_error)[:500]
            logger.error(
                "Run %s destination %d: Failed with error: %s",
                run_id,
                dest_idx + 1,
                error_message,
            )
            
            dest_step.status = "failed"
            dest_step.finished_at = datetime.now(timezone.utc)
            dest_step.error = error_message
            dest_step.counts = {
                "records_published": 0,
                "changes_published": 0,
            }
            session.commit()
            
            failed_count += 1
    
    # Determine if run is partial
    partial = failed_count > 0 and success_count > 0
    
    logger.info(
        "Run %s: Publish phase completed - %d succeeded, %d failed, partial=%s",
        run_id,
        success_count,
        failed_count,
        partial,
    )
    
    return {
        "target_url": first_target_url,
        "published_at": published_at,
        "success_count": success_count,
        "failed_count": failed_count,
        "partial": partial,
    }


def execute_run(
    session: Session,
    run_id: UUID,
) -> RunResult:
    """
    Execute a complete integration run: extract → canonicalize → publish.
    
    Orchestrates two phases:
    1. phase_extract_and_canonicalize: source → canonical store (DB commit)
    2. phase_publish_destinations: canonical store → target (external I/O)
    
    Args:
        session: SQLAlchemy session (manages transaction)
        run_id: Run identifier to execute
        
    Returns:
        RunResult with execution metrics
        
    Raises:
        PipelineError: If run cannot be executed
        
    Example:
        >>> result = execute_run(session, run_id)
        >>> print(f"Created: {result.counts['created']}, Updated: {result.counts['updated']}")
    """
    started_at = datetime.now(timezone.utc)
    
    try:
        # Phase 1: Extract and canonicalize
        canonicalize_result = phase_extract_and_canonicalize(session, run_id)
        
        # Refresh run to get updated state
        run = session.query(Run).filter_by(run_id=run_id).first()
        if not run:
            raise PipelineError(f"Run {run_id} not found after canonicalize phase")

        pipeline = session.query(Pipeline).filter_by(pipeline_id=run.pipeline_id).first()
        pipeline_destinations = (
            session.query(PipelineDestination)
            .filter_by(pipeline_id=pipeline.pipeline_id, enabled=True)
            .all()
        )

        # Check if source-only (skip publish phase)
        if not pipeline_destinations:
            finished_at = datetime.now(timezone.utc)
            duration_ms = int((finished_at - started_at).total_seconds() * 1000)
            
            run.status = "success"
            run.finished_at = finished_at
            run.duration_ms = duration_ms
            run.target_url = None
            session.commit()

            # Emit WebSocket completion event
            emit_run_completed(
                org_id=run.organization_id,
                run_id=run_id,
                pipeline_id=run.pipeline_id,
                status="success",
                duration_ms=duration_ms,
                processed_count=canonicalize_result["processed"],
                created_count=canonicalize_result["created"],
                updated_count=canonicalize_result["updated"],
                skipped_count=canonicalize_result["skipped"],
            )

            return RunResult(
                run_id=run_id,
                status="success",
                duration_ms=duration_ms,
                counts={
                    "created": canonicalize_result["created"],
                    "updated": canonicalize_result["updated"],
                    "noop": canonicalize_result["skipped"],
                },
                target_url=None,
            )

        # Phase 2: Publish to destinations (multi-destination with continue-on-failure)
        try:
            publish_result = phase_publish_destinations(session, run_id, canonicalize_result)
            
            finished_at = datetime.now(timezone.utc)
            duration_ms = int((finished_at - started_at).total_seconds() * 1000)
            
            # Determine final status based on publish results
            success_count = publish_result.get("success_count", 0)
            failed_count = publish_result.get("failed_count", 0)
            partial = publish_result.get("partial", False)
            
            if success_count == 0:
                # All destinations failed
                run.status = "failed_publish"
            elif partial:
                # Some destinations succeeded, some failed
                run.status = "warning"
            else:
                # All destinations succeeded
                run.status = "success"
            
            run.finished_at = finished_at
            run.duration_ms = duration_ms
            run.published_at = publish_result["published_at"]
            run.target_url = publish_result["target_url"]
            session.commit()
            
            logger.info(
                "Run %s completed with status=%s in %dms (destinations: %d succeeded, %d failed)",
                run_id,
                run.status,
                duration_ms,
                success_count,
                failed_count,
            )

            # Emit WebSocket completion event
            emit_run_completed(
                org_id=run.organization_id,
                run_id=run_id,
                pipeline_id=run.pipeline_id,
                status=run.status,
                duration_ms=duration_ms,
                processed_count=run.processed_count or 0,
                created_count=canonicalize_result["created"],
                updated_count=canonicalize_result["updated"],
                skipped_count=canonicalize_result["skipped"],
            )

            return RunResult(
                run_id=run_id,
                status=run.status,
                duration_ms=duration_ms,
                counts={
                    "created": canonicalize_result["created"],
                    "updated": canonicalize_result["updated"],
                    "noop": canonicalize_result["skipped"],
                },
                target_url=publish_result["target_url"],
            )
            
        except Exception as publish_error:
            # Critical publish error (should not happen with continue-on-failure)
            logger.exception("Run %s: critical publish phase error", run_id)
            finished_at = datetime.now(timezone.utc)
            duration_ms = int((finished_at - started_at).total_seconds() * 1000)

            run.status = "failed_publish"
            run.finished_at = finished_at
            run.duration_ms = duration_ms
            run.target_url = None
            session.commit()

            # Emit WebSocket failure event
            emit_run_failed(
                org_id=run.organization_id,
                run_id=run_id,
                pipeline_id=run.pipeline_id,
                error=str(publish_error)[:500],
                error_stage="publish",
            )

            return RunResult(
                run_id=run_id,
                status="failed_publish",
                duration_ms=duration_ms,
                counts={
                    "created": canonicalize_result["created"],
                    "updated": canonicalize_result["updated"],
                    "noop": canonicalize_result["skipped"],
                },
                target_url=None,
                error=str(publish_error),
                error_stage="publish",
            )
        
    except RunConflictError:
        # Propagate, ahead of the blanket handler below. A state conflict — a run
        # with no pipeline, say — means the run should never have started, so it
        # is not a run failure to record and persist. Swallowed here, the router
        # returned 500 with the run serialized as "failed", which both hid the
        # 409 the caller can act on and wrote a misleading failure to the row.
        raise

    except Exception as e:
        logger.exception("Run %s failed with error: %s", run_id, str(e))

        # INVARIANT: Exceptions must mark run failed and persist error details

        # Determine error stage based on exception context
        error_stage = "extract"
        if "canonical" in str(e).lower() or "upsert" in str(e).lower():
            error_stage = "canonical"
        elif "publish" in str(e).lower() or "sheets" in str(e).lower() or "connector config" in str(e).lower():
            error_stage = "publish"

        # Update run with failure status
        finished_at = datetime.now(timezone.utc)
        duration_ms = int((finished_at - started_at).total_seconds() * 1000)

        try:
            # Try to get run and update status
            run = session.query(Run).filter_by(run_id=run_id).first()
            if run:
                # If we were already in publishing phase, use failed_publish status
                # This allows republishing to retry from the publish step
                if run.status == "publishing" or error_stage == "publish":
                    run.status = "failed_publish"
                else:
                    run.status = "failed"
                run.error = str(e)[:500]
                run.error_stage = error_stage
                run.error_at = finished_at
                run.finished_at = finished_at
                run.duration_ms = duration_ms
                session.commit()

                # Emit WebSocket failure event
                emit_run_failed(
                    org_id=run.organization_id,
                    run_id=run_id,
                    pipeline_id=run.pipeline_id,
                    error=str(e)[:500],
                    error_stage=error_stage,
                )

                # Send failure notification
                notify_run_failure(session, run)
                logger.info("Run %s: INVARIANT enforced - exception marked run as failed with error details", run_id)
        except Exception:
            logger.exception("Failed to update run status after error")
        
        return RunResult(
            run_id=run_id,
            status="failed",
            duration_ms=duration_ms,
            counts={"created": 0, "updated": 0, "noop": 0},
            target_url=None,
            error=str(e)[:500],
            error_stage=error_stage,
        )


def republish_run(
    session: Session,
    run_id: UUID,
) -> RunResult:
    """
    Retry publishing for a run that failed during publish phase.
    
    This function skips extraction and canonical store work, only redoing:
    - Phase 2: External publishing (Sheets)
    - Phase 3: Finalize run status
    
    This is safe because:
    - Canonical store + change events already committed (Phase 1 succeeded)
    - Sheets publish is idempotent (clears and rewrites)
    - Can be called multiple times without side effects
    
    Args:
        session: SQLAlchemy session
        run_id: Run identifier to republish
        
    Returns:
        RunResult with execution metrics
        
    Raises:
        PipelineError: If run is not in a republishable state
        
    Example:
        >>> # After a run fails with status="failed_publish"
        >>> result = republish_run(session, run_id)
        >>> print(f"Republish status: {result.status}")
    """
    started_at = datetime.now(timezone.utc)
    
    try:
        # Load run and validate it's in republishable state
        run = session.query(Run).filter_by(run_id=run_id).first()
        if not run:
            raise PipelineError(f"Run {run_id} not found")
        
        # Reject if run is currently executing (prevents double-execution)
        if run.status == "running":
            raise RunConflictError(
                f"Run {run_id} is currently executing (status='running'). "
                f"Cannot republish while execution is in progress."
            )
        
        # Allow republish for these statuses only
        # Also allow 'failed' status if error_stage indicates it failed during publish
        is_republishable_status = run.status in ("failed_publish", "publishing", "failed_finalize")
        failed_during_publish = run.status == "failed" and run.error_stage == "publish"
        if not (is_republishable_status or failed_during_publish):
            raise PipelineError(
                f"Run {run_id} has status '{run.status}' (error_stage={run.error_stage}) - can only republish "
                f"runs with status: failed_publish, publishing, failed_finalize, or failed with error_stage=publish"
            )
        
        logger.info("Republishing run %s (status=%s)", run_id, run.status)

        # Get counts from existing run record
        counts = {
            "created": run.created_count,
            "updated": run.updated_count,
            "noop": run.skipped_count,
        }

        # Load pipeline and target connector
        if not run.pipeline_id:
            raise PipelineError(f"Run {run_id} has no pipeline_id")

        pipeline = session.query(Pipeline).filter_by(pipeline_id=run.pipeline_id).first()
        if not pipeline:
            raise PipelineError(f"Pipeline {run.pipeline_id} not found")

        organization_id = run.organization_id

        # Cannot republish source-only pipelines (they don't have a publish phase)
        pipeline_destinations = (
            session.query(PipelineDestination)
            .filter_by(pipeline_id=pipeline.pipeline_id, enabled=True)
            .all()
        )

        if not pipeline_destinations:
            raise PipelineError(
                f"Run {run_id} is from a source-only pipeline (no destinations). "
                f"Source-only pipelines don't have a publish phase to retry."
            )

        # For now, publish to first destination only (Phase 2: multi-destination fan-out)
        first_destination = pipeline_destinations[0]
        
        # Load target connector
        target_instance = (
            session.query(ConnectorInstance)
            .filter_by(connector_instance_id=first_destination.connector_instance_id)
            .first()
        )
        if not target_instance:
            raise PipelineError(
                f"Target connector instance {first_destination.connector_instance_id} not found"
            )
        
        target_definition = (
            session.query(ConnectorDefinition)
            .filter_by(connector_definition_id=target_instance.connector_definition_id)
            .first()
        )
        if not target_definition:
            raise PipelineError(
                f"Target connector definition {target_instance.connector_definition_id} not found"
            )
        
        # Mark run as publishing (restart Phase 2)
        run.status = "publishing"
        session.commit()
        logger.info("Run %s: restarting publish phase", run_id)
        
        session.refresh(run)
        
        # Instantiate target connector
        target_connector: BaseTargetConnector = load_connector_from_db_record(
            connector_instance={
                "connector_instance_id": str(target_instance.connector_instance_id),
                "config": target_instance.config,
            },
            connector_definition={
                "implementation_key": target_definition.implementation_key,
                "config_schema": target_definition.config_schema,
            },
            organization_id=organization_id,
        )
        
        # PHASE 2: External publishing (idempotent retry)
        target_url = None
        try:
            # Fetch current entities (exclude deleted)
            logger.info("Fetching current entities for republish")
            current_entities = (
                session.query(EntityCurrent)
                .filter_by(organization_id=organization_id)
                .filter(EntityCurrent.is_deleted == False)
                .all()
            )
            entity_payloads = [entity.payload for entity in current_entities]
            logger.info("Republishing %d current entities to target", len(entity_payloads))
            
            target_connector.publish_records(entity_payloads)
            
            # Fetch and publish change log for this run
            logger.info("Fetching change events for republish")
            change_events = get_change_events_for_run(
                session=session,
                organization_id=organization_id,
                run_id=run_id,
                change_types=["created", "updated"],
            )
            logger.info("Republishing %d change events to target", len(change_events))
            
            change_log = format_change_events_for_target(
                change_events,
                include_field_diffs=True,
            )
            target_connector.publish_change_log(change_log)
            
            # Get target URL from connector (if available)
            target_url = target_connector.get_target_url()
            
            # Record successful publish timestamp
            published_at = datetime.now(timezone.utc)
            
            logger.info("Run %s: republish phase completed successfully", run_id)
            
        except Exception as publish_error:
            # Publish failed again
            logger.exception("Run %s: republish phase failed", run_id)
            finished_at = datetime.now(timezone.utc)
            duration_ms = int((finished_at - started_at).total_seconds() * 1000)
            
            run.status = "failed_publish"
            run.finished_at = finished_at
            session.commit()
            
            return RunResult(
                run_id=run_id,
                status="failed_publish",
                duration_ms=duration_ms,
                counts=counts,
                target_url=None,
                error=str(publish_error)[:500],
                error_stage="publish",
            )
        
        # PHASE 3: Finalize with success
        finished_at = datetime.now(timezone.utc)
        duration_ms = int((finished_at - started_at).total_seconds() * 1000)
        
        try:
            run.status = "success"
            run.finished_at = finished_at
            run.duration_ms = (run.duration_ms or 0) + duration_ms  # Add retry time
            run.published_at = published_at  # Record when publish succeeded
            run.target_url = target_url
            session.commit()
            
            logger.info("Run %s republished successfully in %dms", run_id, duration_ms)
            
            return RunResult(
                run_id=run_id,
                status="success",
                duration_ms=duration_ms,
                counts=counts,
                target_url=target_url,
            )
            
        except Exception as finalize_error:
            logger.exception("Run %s: republish finalize failed", run_id)
            
            try:
                run.status = "failed_finalize"
                run.finished_at = finished_at
                run.published_at = published_at  # Publish succeeded, record it
                run.target_url = target_url
                session.commit()
            except Exception:
                logger.exception("Failed to record failed_finalize status")
            
            return RunResult(
                run_id=run_id,
                status="failed_finalize",
                duration_ms=duration_ms,
                counts=counts,
                target_url=target_url,
                error=str(finalize_error)[:500],
                error_stage="finalize",
            )
            
    except (RunConflictError, PipelineError):
        # Re-raise these so API endpoint can handle them with proper status codes
        raise
    
    except Exception as e:
        logger.exception("Run %s republish failed: %s", run_id, str(e))
        
        finished_at = datetime.now(timezone.utc)
        duration_ms = int((finished_at - started_at).total_seconds() * 1000)
        
        try:
            if 'run' in locals() and run:
                session.refresh(run)
                run.status = "failed_publish"
                run.finished_at = finished_at
                session.commit()
        except Exception:
            logger.exception("Failed to update run status after republish error")
        
        return RunResult(
            run_id=run_id,
            status="failed_publish",
            duration_ms=duration_ms,
            counts={"created": 0, "updated": 0, "noop": 0},
            target_url=None,
            error=str(e)[:500],
            error_stage="publish",
        )


def retry_destination_publish(
    session: Session,
    run_id: UUID,
    pipeline_destination_id: UUID,
) -> dict:
    """
    Retry publishing to a single destination without re-running extraction.

    This function:
    1. Validates the run and destination exist
    2. Loads the destination connector
    3. Replays publish using existing change_events for this run
    4. Updates the corresponding run_destination_steps row
    5. Does NOT modify canonical data or rerun sources

    Args:
        session: SQLAlchemy session
        run_id: Run identifier
        pipeline_destination_id: Specific destination to retry

    Returns:
        dict with:
            - step_id: UUID of the destination step
            - status: "success" or "failed"
            - error: Error message if failed, None otherwise
            - counts: dict with publish metrics
            - target_url: URL of published target (if available)

    Raises:
        PipelineError: If retry cannot be performed
    """
    from app.models import RunDestinationStep

    started_at = datetime.now(timezone.utc)

    try:
        # Load run
        run = session.query(Run).filter_by(run_id=run_id).first()
        if not run:
            raise PipelineError(f"Run {run_id} not found")

        # Load pipeline
        if not run.pipeline_id:
            raise PipelineError(f"Run {run_id} has no pipeline_id")

        pipeline = session.query(Pipeline).filter_by(pipeline_id=run.pipeline_id).first()
        if not pipeline:
            raise PipelineError(f"Pipeline {run.pipeline_id} not found")

        organization_id = run.organization_id

        # Load destination
        pipeline_destination = session.query(PipelineDestination).filter_by(
            destination_id=pipeline_destination_id
        ).first()
        if not pipeline_destination:
            raise PipelineError(f"PipelineDestination {pipeline_destination_id} not found")

        # Verify destination belongs to this pipeline
        if pipeline_destination.pipeline_id != run.pipeline_id:
            raise PipelineError(
                f"Destination {pipeline_destination_id} does not belong to pipeline {run.pipeline_id}"
            )

        # Find or create destination step
        dest_step = session.query(RunDestinationStep).filter_by(
            run_id=run_id,
            pipeline_destination_id=pipeline_destination_id
        ).first()
        
        if not dest_step:
            # Create step if it doesn't exist (shouldn't happen normally)
            dest_step = RunDestinationStep(
                run_id=run_id,
                pipeline_destination_id=pipeline_destination_id,
                status="pending",
                counts={},
            )
            session.add(dest_step)
            session.flush()

        logger.info(
            "Retrying destination publish for run %s, destination %s (step %s)",
            run_id,
            pipeline_destination_id,
            dest_step.step_id,
        )

        # Load destination connector
        target_instance = session.query(ConnectorInstance).filter_by(
            connector_instance_id=pipeline_destination.connector_instance_id
        ).first()
        if not target_instance:
            raise PipelineError(
                f"Connector instance {pipeline_destination.connector_instance_id} not found"
            )
        
        target_definition = session.query(ConnectorDefinition).filter_by(
            connector_definition_id=target_instance.connector_definition_id
        ).first()
        if not target_definition:
            raise PipelineError(
                f"Connector definition {target_instance.connector_definition_id} not found"
            )
        
        # Mark step as running
        dest_step.status = "running"
        dest_step.started_at = started_at
        dest_step.error = None
        session.commit()
        
        # Instantiate target connector
        target_connector: BaseTargetConnector = load_connector_from_db_record(
            connector_instance={
                "connector_instance_id": str(target_instance.connector_instance_id),
                "config": target_instance.config,
            },
            connector_definition={
                "implementation_key": target_definition.implementation_key,
                "config_schema": target_definition.config_schema,
            },
            organization_id=organization_id,
        )
        
        # Fetch current entities (same as original publish, exclude deleted)
        logger.info("Fetching current entities for retry publish")
        current_entities = (
            session.query(EntityCurrent)
            .filter_by(organization_id=organization_id)
            .filter(EntityCurrent.is_deleted == False)
            .all()
        )
        entity_payloads = [entity.payload for entity in current_entities]
        logger.info("Retrying publish with %d current entities", len(entity_payloads))
        
        # Publish records
        target_connector.publish_records(entity_payloads)
        
        # Fetch and publish change log for this run (IMPORTANT: same change_events, no new ones)
        logger.info("Fetching change events for retry publish")
        change_events = get_change_events_for_run(
            session=session,
            organization_id=organization_id,
            run_id=run_id,
            change_types=["created", "updated"],
        )
        logger.info("Retrying publish with %d change events (no new events created)", len(change_events))
        
        change_log = format_change_events_for_target(
            change_events,
            include_field_diffs=True,
        )
        target_connector.publish_change_log(change_log)
        
        # Get target URL
        target_url = target_connector.get_target_url()
        finished_at = datetime.now(timezone.utc)
        
        # Update step with success
        dest_step.status = "success"
        dest_step.finished_at = finished_at
        dest_step.counts = {
            "published_entities": len(entity_payloads),
            "published_changes": len(change_events),
        }
        session.commit()
        
        logger.info(
            "Destination retry completed successfully for step %s",
            dest_step.step_id,
        )
        
        return {
            "step_id": str(dest_step.step_id),
            "status": "success",
            "error": None,
            "counts": dest_step.counts,
            "target_url": target_url,
        }
        
    except Exception as error:
        # Mark step as failed
        if 'dest_step' in locals() and dest_step:
            dest_step.status = "failed"
            dest_step.finished_at = datetime.now(timezone.utc)
            dest_step.error = str(error)
            session.commit()
            
            logger.exception(
                "Destination retry failed for step %s",
                dest_step.step_id,
            )
            
            return {
                "step_id": str(dest_step.step_id),
                "status": "failed",
                "error": str(error),
                "counts": dest_step.counts or {},
                "target_url": None,
            }
        else:
            logger.exception("Destination retry failed before step was created")
            raise PipelineError(f"Destination retry failed: {error}") from error


# =============================================================================
# Rollback Functions
# =============================================================================


@dataclass
class RollbackFeasibilityResult:
    """Result of checking rollback feasibility."""
    can_rollback: bool
    partial: bool
    total_changes: int
    rollbackable_changes: int
    conflict_entities: list[str]
    reason: str | None


@dataclass
class RollbackResult:
    """Result of executing a rollback."""
    rollback_run_id: UUID
    status: str  # "success", "partial", "failed"
    reverted_creates: int
    reverted_updates: int
    reverted_deletes: int
    skipped_conflicts: int
    republish_status: str | None  # "success", "failed", "skipped"
    error: str | None = None


class RollbackError(PipelineError):
    """Raised when rollback operation fails."""
    pass


def check_rollback_feasibility(
    session: Session,
    organization_id: UUID,
    run_id: UUID,
) -> RollbackFeasibilityResult:
    """
    Check if a run can be rolled back and identify any conflicts.

    A run can be rolled back if:
    1. Run exists and status is 'success' or 'warning'
    2. Run has not already been rolled back
    3. Run is not itself a rollback run

    Conflicts occur when an entity modified by the target run has been
    subsequently modified by a later run.

    Args:
        session: SQLAlchemy session
        organization_id: Organization identifier
        run_id: Run identifier to check

    Returns:
        RollbackFeasibilityResult with feasibility info and conflict details
    """
    from app.models import FieldDiff

    # Load the run
    run = session.query(Run).filter_by(
        run_id=run_id,
        organization_id=organization_id,
    ).first()

    if not run:
        return RollbackFeasibilityResult(
            can_rollback=False,
            partial=False,
            total_changes=0,
            rollbackable_changes=0,
            conflict_entities=[],
            reason="Run not found",
        )

    # Check status
    if run.status not in ("success", "warning"):
        return RollbackFeasibilityResult(
            can_rollback=False,
            partial=False,
            total_changes=0,
            rollbackable_changes=0,
            conflict_entities=[],
            reason=f"Run status is '{run.status}'. Only 'success' or 'warning' runs can be rolled back.",
        )

    # Check if already rolled back
    if run.rolled_back_at is not None:
        return RollbackFeasibilityResult(
            can_rollback=False,
            partial=False,
            total_changes=0,
            rollbackable_changes=0,
            conflict_entities=[],
            reason="Run has already been rolled back",
        )

    # Check if this is a rollback run
    if run.rollback_of_run_id is not None:
        return RollbackFeasibilityResult(
            can_rollback=False,
            partial=False,
            total_changes=0,
            rollbackable_changes=0,
            conflict_entities=[],
            reason="Cannot rollback a rollback run. Re-run the original pipeline instead.",
        )

    # Get all change_events from this run
    change_events = (
        session.query(ChangeEvent)
        .filter_by(
            run_id=run_id,
            organization_id=organization_id,
        )
        .filter(ChangeEvent.change_type.in_(["created", "updated", "deleted"]))
        .all()
    )

    if not change_events:
        return RollbackFeasibilityResult(
            can_rollback=False,
            partial=False,
            total_changes=0,
            rollbackable_changes=0,
            conflict_entities=[],
            reason="No changes to rollback",
        )

    total_changes = len(change_events)
    entity_keys = [event.entity_key for event in change_events]

    # Find subsequent changes to the same entities (occurred after run.finished_at)
    # These are conflicts that may prevent clean rollback
    conflict_entities = []

    if run.finished_at:
        subsequent_changes = (
            session.query(ChangeEvent.entity_key)
            .filter(
                ChangeEvent.organization_id == organization_id,
                ChangeEvent.entity_key.in_(entity_keys),
                ChangeEvent.run_id != run_id,  # Different run
                ChangeEvent.occurred_at > run.finished_at,  # After this run
            )
            .distinct()
            .all()
        )
        conflict_entities = [row[0] for row in subsequent_changes]

    rollbackable_changes = total_changes - len(conflict_entities)

    if conflict_entities:
        return RollbackFeasibilityResult(
            can_rollback=rollbackable_changes > 0,  # Can still do partial
            partial=True,
            total_changes=total_changes,
            rollbackable_changes=rollbackable_changes,
            conflict_entities=conflict_entities,
            reason=f"{len(conflict_entities)} entities have subsequent changes and cannot be rolled back without force_partial",
        )

    return RollbackFeasibilityResult(
        can_rollback=True,
        partial=False,
        total_changes=total_changes,
        rollbackable_changes=total_changes,
        conflict_entities=[],
        reason=None,
    )


def rollback_run(
    session: Session,
    organization_id: UUID,
    run_id: UUID,
    force_partial: bool = False,
    skip_republish: bool = False,
) -> RollbackResult:
    """
    Execute rollback of a pipeline run, reversing its changes to the canonical store.

    Rollback process:
    1. Check feasibility (reject if conflicts and not force_partial)
    2. Create a new "rollback run" for audit trail
    3. Process change_events in REVERSE chronological order:
       - CREATED -> Soft-delete the entity
       - UPDATED -> Restore previous values from FieldDiff
       - DELETED -> Restore (undelete) the entity
    4. Mark original run status="rolled_back"
    5. Trigger republish to external destinations (unless skip_republish=True)

    Args:
        session: SQLAlchemy session
        organization_id: Organization identifier
        run_id: Run identifier to rollback
        force_partial: If True, skip conflicted entities instead of failing
        skip_republish: If True, skip republishing to external destinations

    Returns:
        RollbackResult with counts and status

    Raises:
        RollbackError: If rollback cannot be performed
    """
    from app.models import FieldDiff
    from app.services.canonical_store import revert_create, revert_update, revert_delete

    # Check feasibility
    feasibility = check_rollback_feasibility(session, organization_id, run_id)

    if not feasibility.can_rollback and not force_partial:
        raise RollbackError(feasibility.reason or "Rollback not feasible")

    if feasibility.conflict_entities and not force_partial:
        raise RollbackError(
            f"Cannot rollback: {len(feasibility.conflict_entities)} entities have been "
            f"modified by subsequent runs. Use force_partial=true to skip these entities."
        )

    # Load the original run
    original_run = session.query(Run).filter_by(
        run_id=run_id,
        organization_id=organization_id,
    ).first()

    if not original_run:
        raise RollbackError(f"Run {run_id} not found")

    logger.info(
        "Starting rollback of run %s (force_partial=%s, skip_republish=%s)",
        run_id, force_partial, skip_republish
    )

    # Create a new "rollback run" for audit trail
    rollback_run_obj = Run(
        organization_id=organization_id,
        pipeline_id=original_run.pipeline_id,
        dataset_id=original_run.dataset_id,
        source_connector_instance_id=original_run.source_connector_instance_id,
        target_connector_instance_id=original_run.target_connector_instance_id,
        status="running",
        triggered_by="rollback",
        parameters={
            "rollback_of_run_id": str(run_id),
            "force_partial": force_partial,
            "skip_republish": skip_republish,
        },
        rollback_of_run_id=run_id,
    )
    rollback_run_obj.started_at = datetime.now(timezone.utc)
    session.add(rollback_run_obj)
    session.flush()  # Get run_id

    rollback_run_id = rollback_run_obj.run_id
    logger.info("Created rollback run %s for original run %s", rollback_run_id, run_id)

    # Get all change_events from the original run in REVERSE chronological order
    change_events = (
        session.query(ChangeEvent)
        .filter_by(
            run_id=run_id,
            organization_id=organization_id,
        )
        .filter(ChangeEvent.change_type.in_(["created", "updated", "deleted"]))
        .order_by(ChangeEvent.occurred_at.desc())  # Reverse order
        .all()
    )

    # Build set of conflict entity_keys for quick lookup
    conflict_set = set(feasibility.conflict_entities)

    # Process each change event
    reverted_creates = 0
    reverted_updates = 0
    reverted_deletes = 0
    skipped_conflicts = 0

    for event in change_events:
        entity_key = event.entity_key

        # Skip conflicted entities if force_partial
        if entity_key in conflict_set:
            logger.info("Skipping conflicted entity: %s", entity_key)
            skipped_conflicts += 1
            continue

        try:
            if event.change_type == "created":
                # CREATED -> Soft-delete the entity
                result = revert_create(
                    session=session,
                    organization_id=organization_id,
                    entity_key=entity_key,
                    run_id=rollback_run_id,
                    dataset_id=event.dataset_id,
                    pipeline_id=event.pipeline_id,
                )
                if result:
                    reverted_creates += 1
                    logger.debug("Reverted CREATE for %s", entity_key)

            elif event.change_type == "updated":
                # UPDATED -> Restore previous values from FieldDiff
                field_diffs = (
                    session.query(FieldDiff)
                    .filter_by(
                        change_id=event.change_id,
                        organization_id=organization_id,
                    )
                    .all()
                )

                result = revert_update(
                    session=session,
                    organization_id=organization_id,
                    entity_key=entity_key,
                    run_id=rollback_run_id,
                    field_diffs=field_diffs,
                    dataset_id=event.dataset_id,
                    pipeline_id=event.pipeline_id,
                )
                if result:
                    reverted_updates += 1
                    logger.debug("Reverted UPDATE for %s", entity_key)

            elif event.change_type == "deleted":
                # DELETED -> Restore (undelete) the entity
                result = revert_delete(
                    session=session,
                    organization_id=organization_id,
                    entity_key=entity_key,
                    run_id=rollback_run_id,
                    dataset_id=event.dataset_id,
                    pipeline_id=event.pipeline_id,
                )
                if result:
                    reverted_deletes += 1
                    logger.debug("Reverted DELETE for %s", entity_key)

        except Exception as e:
            logger.error("Error reverting %s change for %s: %s", event.change_type, entity_key, str(e))
            # Continue with other reversions

    # Mark original run as rolled back
    original_run.status = "rolled_back"
    original_run.rolled_back_at = datetime.now(timezone.utc)
    original_run.rolled_back_by_run_id = rollback_run_id

    # Update rollback run counts
    rollback_run_obj.processed_count = reverted_creates + reverted_updates + reverted_deletes
    rollback_run_obj.created_count = reverted_deletes  # Restores count as creates
    rollback_run_obj.updated_count = reverted_updates
    rollback_run_obj.deleted_count = reverted_creates  # Soft-deletes count as deletes
    rollback_run_obj.skipped_count = skipped_conflicts

    # Commit the rollback changes
    session.commit()

    logger.info(
        "Rollback processed: %d creates reverted, %d updates reverted, %d deletes reverted, %d skipped",
        reverted_creates, reverted_updates, reverted_deletes, skipped_conflicts
    )

    # Trigger republish if needed
    republish_status = None
    if not skip_republish and original_run.pipeline_id:
        try:
            # Check if pipeline has destinations
            pipeline_destinations = (
                session.query(PipelineDestination)
                .filter_by(
                    pipeline_id=original_run.pipeline_id,
                    enabled=True,
                )
                .all()
            )

            if pipeline_destinations:
                logger.info("Triggering republish after rollback")
                # Use the rollback run for republish
                rollback_run_obj.status = "publishing"
                session.commit()

                # Republish current entity state
                republish_result = republish_run(session, rollback_run_id)
                republish_status = republish_result.status
                logger.info("Republish completed with status: %s", republish_status)
            else:
                republish_status = "skipped"
                logger.info("No destinations to republish to")

        except Exception as e:
            logger.error("Republish failed after rollback: %s", str(e))
            republish_status = "failed"

    # Finalize rollback run status
    rollback_run_obj.finished_at = datetime.now(timezone.utc)
    if rollback_run_obj.started_at:
        rollback_run_obj.duration_ms = int(
            (rollback_run_obj.finished_at - rollback_run_obj.started_at).total_seconds() * 1000
        )

    if skipped_conflicts > 0:
        rollback_run_obj.status = "warning"  # Partial rollback
    elif republish_status == "failed":
        rollback_run_obj.status = "failed_publish"
    else:
        rollback_run_obj.status = "success"

    session.commit()

    return RollbackResult(
        rollback_run_id=rollback_run_id,
        status="partial" if skipped_conflicts > 0 else "success",
        reverted_creates=reverted_creates,
        reverted_updates=reverted_updates,
        reverted_deletes=reverted_deletes,
        skipped_conflicts=skipped_conflicts,
        republish_status=republish_status,
    )

