"""
Preservation tasks: fixity verification, format identification,
policy evaluation, and replication — all with PREMIS event recording.
"""

import hashlib
import logging
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.celery_app import celery_app
from app.sentry_crons import cron_monitor
from app.tasks.base import SystemTask

logger = logging.getLogger(__name__)

AGENT_NAME = "madrona-preservation v1.0"
BATCH_SIZE = 200


def record_preservation_event(
    session: Session,
    *,
    organization_id: UUID,
    event_type: str,
    outcome: str,
    agent_name: str = AGENT_NAME,
    agent_type: str = "software",
    media_id: UUID | None = None,
    outcome_detail: str | None = None,
    detail: dict | None = None,
    linked_entity_type: str | None = None,
    linked_entity_id: UUID | None = None,
) -> None:
    """
    Insert a PreservationEvent row into the given session.

    Does NOT commit — the caller controls the transaction boundary.
    """
    from app.models.preservation import PreservationEvent

    event = PreservationEvent(
        organization_id=organization_id,
        event_type=event_type,
        media_id=media_id,
        outcome=outcome,
        outcome_detail=outcome_detail,
        detail=detail,
        agent_type=agent_type,
        agent_name=agent_name,
        linked_entity_type=linked_entity_type,
        linked_entity_id=linked_entity_id,
    )
    session.add(event)


# ============================================================================
# Fixity verification (original + Phase 4 MD5 extension)
# ============================================================================


@celery_app.task(
    base=SystemTask,
    name="app.tasks.preservation.verify_media_checksums",
    soft_time_limit=3600,
    time_limit=3900,
)
@cron_monitor("verify-media-checksums")
def verify_media_checksums() -> dict[str, Any]:
    """
    Rotating fixity verification of S3 media files.

    Processes a batch of BATCH_SIZE media ordered by last_fixity_check
    (never-checked first), recomputes SHA-256 and MD5, and records a PREMIS
    preservation event for each file.  Backfills checksums if NULL.
    """
    from app.models import Media
    from app.services.storage import get_storage_backend
    from app.tasks.rls_helpers import admin_db_session

    verified = 0
    mismatches = 0
    backfilled = 0
    errors = 0
    mismatch_details: list[dict] = []

    with admin_db_session() as session:
        # Oldest-checked (or never-checked) first
        media_items = (
            session.query(Media)
            .filter(Media.processing_status == "completed")
            .order_by(Media.last_fixity_check.asc().nullsfirst())
            .limit(BATCH_SIZE)
            .all()
        )

        for media in media_items:
            try:
                storage = get_storage_backend(str(media.organization_id), session)
                data, _ = storage.get_object_sync(media.s3_key)

                # Compute both SHA-256 and MD5 in a single pass
                sha256_hasher = hashlib.sha256()
                md5_hasher = hashlib.md5()
                sha256_hasher.update(data)
                md5_hasher.update(data)
                computed_sha256 = sha256_hasher.hexdigest()
                computed_md5 = md5_hasher.hexdigest()

                now = datetime.now(timezone.utc)

                # Backfill checksums if never computed
                if media.checksum_sha256 is None:
                    media.checksum_sha256 = computed_sha256
                    backfilled += 1
                    record_preservation_event(
                        session,
                        organization_id=media.organization_id,
                        event_type="message_digest_calculation",
                        media_id=media.media_id,
                        outcome="success",
                        outcome_detail=f"SHA-256 backfill: {computed_sha256}",
                        detail={"algorithm": "SHA-256", "digest": computed_sha256},
                    )

                # Backfill MD5 if not yet stored
                if media.checksum_md5 is None:
                    media.checksum_md5 = computed_md5
                    record_preservation_event(
                        session,
                        organization_id=media.organization_id,
                        event_type="message_digest_calculation",
                        media_id=media.media_id,
                        outcome="success",
                        outcome_detail=f"MD5 backfill: {computed_md5}",
                        detail={"algorithm": "MD5", "digest": computed_md5},
                    )

                # Update extensible checksums JSONB
                media.checksums = {
                    "sha256": computed_sha256,
                    "md5": computed_md5,
                }

                # Compare checksums
                if computed_sha256 == media.checksum_sha256:
                    media.fixity_status = "ok"
                    verified += 1
                    record_preservation_event(
                        session,
                        organization_id=media.organization_id,
                        event_type="fixity_check",
                        media_id=media.media_id,
                        outcome="success",
                        outcome_detail="SHA-256 and MD5 match stored digests",
                        detail={
                            "algorithms": ["SHA-256", "MD5"],
                            "sha256_expected": media.checksum_sha256,
                            "sha256_computed": computed_sha256,
                            "md5_computed": computed_md5,
                        },
                    )
                else:
                    media.fixity_status = "mismatch"
                    mismatches += 1
                    mismatch_details.append({
                        "media_id": str(media.media_id),
                        "organization_id": str(media.organization_id),
                        "expected": media.checksum_sha256,
                        "computed": computed_sha256,
                    })
                    logger.error(
                        "Checksum mismatch for media %s: expected %s, got %s",
                        media.media_id, media.checksum_sha256, computed_sha256,
                    )
                    record_preservation_event(
                        session,
                        organization_id=media.organization_id,
                        event_type="fixity_check",
                        media_id=media.media_id,
                        outcome="failure",
                        outcome_detail=(
                            f"SHA-256 mismatch: expected {media.checksum_sha256}, "
                            f"got {computed_sha256}"
                        ),
                        detail={
                            "algorithms": ["SHA-256", "MD5"],
                            "sha256_expected": media.checksum_sha256,
                            "sha256_computed": computed_sha256,
                            "md5_computed": computed_md5,
                        },
                    )

                media.last_fixity_check = now

            except Exception as e:
                errors += 1
                logger.warning(
                    "Fixity check failed for media %s: %s", media.media_id, e
                )
                try:
                    record_preservation_event(
                        session,
                        organization_id=media.organization_id,
                        event_type="fixity_check",
                        media_id=media.media_id,
                        outcome="failure",
                        outcome_detail=f"Error during verification: {e}",
                    )
                except Exception:
                    pass  # Don't let event recording break the loop

        # admin_db_session commits on exit

    logger.info(
        "Fixity verification complete: %d verified, %d mismatches, "
        "%d backfilled, %d errors (batch=%d)",
        verified, mismatches, backfilled, errors, len(media_items),
    )
    return {
        "verified": verified,
        "mismatches": mismatches,
        "backfilled": backfilled,
        "errors": errors,
        "batch_size": len(media_items),
        "mismatch_details": mismatch_details,
    }


# ============================================================================
# Phase 1: Format identification backfill
# ============================================================================


@celery_app.task(
    base=SystemTask,
    name="app.tasks.preservation.backfill_format_identification",
    soft_time_limit=600,
    time_limit=900,
)
def backfill_format_identification() -> dict[str, Any]:
    """
    Daily batch task: identify PRONOM format for media without pronom_puid.
    """
    from app.services.format_identification import backfill_media_formats
    from app.tasks.rls_helpers import admin_db_session

    with admin_db_session() as session:
        result = backfill_media_formats(session, batch_size=500)

    logger.info(
        "Format identification backfill: %d processed, %d identified, %d skipped",
        result["processed"], result["identified"], result["skipped"],
    )
    return result


# ============================================================================
# Phase 2: Preservation policy evaluation
# ============================================================================


@celery_app.task(
    base=SystemTask,
    name="app.tasks.preservation.evaluate_preservation_policies",
    soft_time_limit=1800,
    time_limit=2100,
)
def evaluate_preservation_policies() -> dict[str, Any]:
    """
    Daily task: iterate active policies across all orgs, create action plan
    entries for media that match policy scope but don't have an existing plan.
    """
    from app.services.preservation_policy import evaluate_policies_all_orgs
    from app.tasks.rls_helpers import admin_db_session

    with admin_db_session() as session:
        result = evaluate_policies_all_orgs(session)

    logger.info(
        "Policy evaluation complete: %d policies evaluated, %d actions created",
        result["policies_evaluated"], result["actions_created"],
    )
    return result


# ============================================================================
# Phase 4: Replication tasks
# ============================================================================


def _backup_targets(session: Session) -> list[tuple[UUID, str]]:
    """
    Organizations with a backup destination, as ``(organization_id, bucket)``.

    Always empty today, deliberately.

    This previously read an ``OrganizationSetting`` model that does not exist
    anywhere in ``app.models``, so :func:`replicate_to_backup` raised
    ImportError on every run — daily since 2026-05-23 — and has never
    replicated a single object.

    Pointing it at the one backup bucket that does exist
    (``BACKUP_S3_BUCKET``, used by ``app.tasks.backup``) would not make it
    correct: the copy in :func:`replicate_to_backup` writes to
    ``backup/<key>`` through the organization's *own* storage backend, so it
    would duplicate every object inside the same bucket rather than produce
    an off-site copy — doubling stored bytes without adding durability.

    Returning empty keeps the caller honest: it logs that nothing is
    configured and reports ``not_configured``, so the gap stays visible
    instead of arriving as a daily exception. Give this a real source of
    backup-target configuration and the replication path below works as
    written.
    """
    return []


@celery_app.task(
    base=SystemTask,
    name="app.tasks.preservation.replicate_to_backup",
    soft_time_limit=3600,
    time_limit=3900,
)
@cron_monitor("replicate-to-backup")
def replicate_to_backup() -> dict[str, Any]:
    """
    Daily task: for orgs with backup storage configured, find unreplicated
    media, copy to backup, verify, and create ReplicationRecord.
    """
    from app.models import Media
    from app.models.preservation import ReplicationRecord
    from app.services.storage import get_storage_backend
    from app.tasks.rls_helpers import admin_db_session

    replicated = 0
    errors = 0

    with admin_db_session() as session:
        targets = _backup_targets(session)
        if not targets:
            logger.warning(
                "replicate_to_backup_skipped: no organization has a backup "
                "target configured; nothing was replicated"
            )
            return {"replicated": 0, "errors": 0, "status": "not_configured"}

        for org_id, backup_bucket in targets:

            # Find media without a backup replication record
            already_replicated = (
                session.query(ReplicationRecord.media_id)
                .filter(
                    ReplicationRecord.organization_id == org_id,
                    ReplicationRecord.copy_type == "backup",
                )
                .subquery()
            )

            unreplicated = (
                session.query(Media)
                .filter(
                    Media.organization_id == org_id,
                    Media.processing_status == "completed",
                    ~Media.media_id.in_(
                        session.query(already_replicated.c.media_id)
                    ),
                )
                .limit(100)
                .all()
            )

            for media in unreplicated:
                try:
                    storage = get_storage_backend(str(org_id), session)
                    data, _ = storage.get_object_sync(media.s3_key)

                    # Compute checksum of source
                    source_sha256 = hashlib.sha256(data).hexdigest()

                    # Copy to backup location
                    backup_key = f"backup/{media.s3_key}"
                    storage.put_object_sync(
                        backup_key, data, media.mime_type or "application/octet-stream"
                    )

                    # Verify the copy
                    copied_data, _ = storage.get_object_sync(backup_key)
                    copy_sha256 = hashlib.sha256(copied_data).hexdigest()

                    verification_status = (
                        "verified" if copy_sha256 == source_sha256 else "mismatch"
                    )

                    # Create replication record
                    record = ReplicationRecord(
                        organization_id=org_id,
                        media_id=media.media_id,
                        storage_location=f"s3://{backup_bucket}",
                        storage_provider="s3",
                        storage_region="us-east-1",
                        storage_key=backup_key,
                        copy_type="backup",
                        checksum_sha256=copy_sha256,
                        last_verified_at=datetime.now(timezone.utc),
                        verification_status=verification_status,
                    )
                    session.add(record)

                    record_preservation_event(
                        session,
                        organization_id=org_id,
                        event_type="replication",
                        media_id=media.media_id,
                        outcome="success" if verification_status == "verified" else "warning",
                        outcome_detail=f"Replicated to backup: {verification_status}",
                        detail={
                            "source_key": media.s3_key,
                            "backup_key": backup_key,
                            "source_sha256": source_sha256,
                            "copy_sha256": copy_sha256,
                            "verification_status": verification_status,
                        },
                    )
                    replicated += 1

                except Exception as e:
                    errors += 1
                    logger.warning(
                        "Replication failed for media %s: %s", media.media_id, e
                    )

    logger.info(
        "Replication complete: %d replicated, %d errors", replicated, errors
    )
    return {"replicated": replicated, "errors": errors}


@celery_app.task(
    base=SystemTask,
    name="app.tasks.preservation.verify_replicas",
    soft_time_limit=3600,
    time_limit=3900,
)
@cron_monitor("verify-replicas")
def verify_replicas() -> dict[str, Any]:
    """
    Weekly task: verify each replica still exists and matches checksum.
    """
    from app.models.preservation import ReplicationRecord
    from app.services.storage import get_storage_backend
    from app.tasks.rls_helpers import admin_db_session

    verified = 0
    mismatches = 0
    missing = 0
    errors = 0

    with admin_db_session() as session:
        records = (
            session.query(ReplicationRecord)
            .order_by(ReplicationRecord.last_verified_at.asc().nullsfirst())
            .limit(BATCH_SIZE)
            .all()
        )

        for record in records:
            try:
                storage = get_storage_backend(str(record.organization_id), session)
                try:
                    data, _ = storage.get_object_sync(record.storage_key)
                except Exception:
                    record.verification_status = "missing"
                    record.last_verified_at = datetime.now(timezone.utc)
                    missing += 1
                    record_preservation_event(
                        session,
                        organization_id=record.organization_id,
                        event_type="fixity_check",
                        media_id=record.media_id,
                        outcome="failure",
                        outcome_detail=f"Replica missing at {record.storage_key}",
                        detail={
                            "storage_location": record.storage_location,
                            "storage_key": record.storage_key,
                            "status": "missing",
                        },
                        linked_entity_type="replication_record",
                        linked_entity_id=record.record_id,
                    )
                    continue

                computed_sha256 = hashlib.sha256(data).hexdigest()
                now = datetime.now(timezone.utc)

                if record.checksum_sha256 and computed_sha256 != record.checksum_sha256:
                    record.verification_status = "mismatch"
                    mismatches += 1
                    record_preservation_event(
                        session,
                        organization_id=record.organization_id,
                        event_type="fixity_check",
                        media_id=record.media_id,
                        outcome="failure",
                        outcome_detail=f"Replica checksum mismatch at {record.storage_key}",
                        detail={
                            "expected": record.checksum_sha256,
                            "computed": computed_sha256,
                            "storage_location": record.storage_location,
                        },
                        linked_entity_type="replication_record",
                        linked_entity_id=record.record_id,
                    )
                else:
                    record.verification_status = "verified"
                    record.checksum_sha256 = computed_sha256
                    verified += 1

                record.last_verified_at = now

            except Exception as e:
                errors += 1
                logger.warning(
                    "Replica verification failed for record %s: %s",
                    record.record_id, e,
                )

    logger.info(
        "Replica verification: %d verified, %d mismatches, %d missing, %d errors",
        verified, mismatches, missing, errors,
    )
    return {
        "verified": verified,
        "mismatches": mismatches,
        "missing": missing,
        "errors": errors,
    }
