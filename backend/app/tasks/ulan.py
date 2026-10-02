"""
Background tasks for ULAN authority synchronization.

Handles async fetching and updating of Getty ULAN constituent data:
- sync_ulan_authority_task: Refresh a single authority from ULAN
- refresh_stale_ulan_authorities_task: Periodic refresh of outdated records

These tasks keep locally-stored ULAN data in sync with Getty's authoritative source.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from celery import Task

from app.celery_app import celery_app
from app.models import Constituent
from app.tasks.base import SystemTask

logger = logging.getLogger(__name__)

# How old a record must be before it's considered stale (30 days)
STALE_THRESHOLD_DAYS = 30


@celery_app.task(
    base=SystemTask,
    bind=True,
    name='app.tasks.ulan.sync_ulan_authority',
    max_retries=3,
    default_retry_delay=30,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=300,
    soft_time_limit=60,
    time_limit=120,
    queue='default',
)
def sync_ulan_authority_task(
    self: Task,
    authority_id: str,
    force: bool = False,
) -> dict[str, Any]:
    """
    Refresh a single Constituent record's ULAN data from Getty ULAN.

    Uses a two-phase approach:
    1. Check dct:modified date to see if ULAN has changed
    2. Only fetch full record if needed (or if force=True)

    Args:
        authority_id: UUID of the Constituent to refresh
        force: If True, skip modification date check and always fetch

    Returns:
        Result dict with status and update info
    """
    logger.info(f"Syncing ULAN authority {authority_id} (force={force})")

    try:
        from app.services.constituent_service import (
            fetch_ulan_full_record,
            fetch_ulan_modified_date,
        )
        from app.tasks.rls_helpers import admin_db_session

        # System task: accesses org-scoped constituents, needs BYPASSRLS
        with admin_db_session() as session:
            authority = session.query(Constituent).get(UUID(authority_id))

            if not authority:
                return {
                    "status": "not_found",
                    "authority_id": authority_id,
                }

            if not authority.ulan_id:
                return {
                    "status": "skipped",
                    "reason": "No ULAN ID on record",
                    "authority_id": authority_id,
                }

            # Phase 1: Check modification date (unless forced)
            if not force:
                ulan_modified = fetch_ulan_modified_date(authority.ulan_id)

                if ulan_modified and authority.ulan_modified_at:
                    if ulan_modified <= authority.ulan_modified_at:
                        # ULAN hasn't changed - just update sync timestamp
                        authority.ulan_synced_at = datetime.now(timezone.utc)

                        return {
                            "status": "unchanged",
                            "authority_id": authority_id,
                            "ulan_id": authority.ulan_id,
                            "preferred_name": authority.name,
                            "ulan_modified_at": authority.ulan_modified_at.isoformat(),
                            "ulan_synced_at": authority.ulan_synced_at.isoformat(),
                        }

            # Phase 2: Fetch fresh data from ULAN
            ulan_record = fetch_ulan_full_record(authority.ulan_id)

            if not ulan_record:
                logger.warning(f"Could not fetch ULAN record {authority.ulan_id}")
                return {
                    "status": "fetch_failed",
                    "authority_id": authority_id,
                    "ulan_id": authority.ulan_id,
                }

            # Get the modification date for storage
            ulan_modified = fetch_ulan_modified_date(authority.ulan_id)

            # Track what changed
            changes = []

            # Update fields if they differ
            if ulan_record.preferred_name and ulan_record.preferred_name != authority.name:
                changes.append(f"preferred_name: {authority.name} -> {ulan_record.preferred_name}")
                authority.name = ulan_record.preferred_name

            if ulan_record.display_name and ulan_record.display_name != authority.display_name:
                changes.append("display_name")
                authority.display_name = ulan_record.display_name

            if ulan_record.variant_names:
                from app.models import VariantTerm
                # Replace existing variant terms from ULAN
                session.query(VariantTerm).filter(
                    VariantTerm.entity_type == 'constituent',
                    VariantTerm.entity_id == authority.constituent_id,
                    VariantTerm.source == 'ulan',
                ).delete()
                for idx, vn in enumerate(ulan_record.variant_names):
                    name = vn.get("name", vn) if isinstance(vn, dict) else vn
                    session.add(VariantTerm(
                        organization_id=authority.organization_id,
                        entity_type='constituent', entity_id=authority.constituent_id,
                        term=name,
                        term_type=vn.get("type") if isinstance(vn, dict) else None,
                        language=vn.get("language") if isinstance(vn, dict) else None,
                        source='ulan', display_order=idx,
                    ))
                changes.append("variant_names")

            if ulan_record.nationality and ulan_record.nationality != authority.nationality:
                changes.append(f"nationality: {authority.nationality} -> {ulan_record.nationality}")
                authority.nationality = ulan_record.nationality

            if ulan_record.nationalities and ulan_record.nationalities != authority.nationalities:
                changes.append("nationalities")
                authority.nationalities = ulan_record.nationalities

            if ulan_record.gender and ulan_record.gender != authority.gender:
                changes.append(f"gender: {authority.gender} -> {ulan_record.gender}")
                authority.gender = ulan_record.gender

            if ulan_record.life_roles and ulan_record.life_roles != authority.life_roles:
                changes.append("life_roles")
                authority.life_roles = ulan_record.life_roles

            if ulan_record.birth_date_display and ulan_record.birth_date_display != authority.birth_date_display:
                changes.append(f"birth_date: {authority.birth_date_display} -> {ulan_record.birth_date_display}")
                authority.birth_date_display = ulan_record.birth_date_display

            if ulan_record.birth_place and ulan_record.birth_place != authority.birth_place:
                changes.append(f"birth_place: {authority.birth_place} -> {ulan_record.birth_place}")
                authority.birth_place = ulan_record.birth_place

            if ulan_record.birth_place_tgn_id and ulan_record.birth_place_tgn_id != authority.birth_place_tgn_id:
                authority.birth_place_tgn_id = ulan_record.birth_place_tgn_id

            if ulan_record.death_date_display and ulan_record.death_date_display != authority.death_date_display:
                changes.append(f"death_date: {authority.death_date_display} -> {ulan_record.death_date_display}")
                authority.death_date_display = ulan_record.death_date_display

            if ulan_record.death_place and ulan_record.death_place != authority.death_place:
                changes.append(f"death_place: {authority.death_place} -> {ulan_record.death_place}")
                authority.death_place = ulan_record.death_place

            if ulan_record.death_place_tgn_id and ulan_record.death_place_tgn_id != authority.death_place_tgn_id:
                authority.death_place_tgn_id = ulan_record.death_place_tgn_id

            if ulan_record.biography and ulan_record.biography != authority.biography:
                changes.append("biography")
                authority.biography = ulan_record.biography

            # Update external authority IDs (VIAF, Wikidata)
            if ulan_record.viaf_id and ulan_record.viaf_id != authority.viaf_id:
                changes.append(f"viaf_id: {authority.viaf_id} -> {ulan_record.viaf_id}")
                authority.viaf_id = ulan_record.viaf_id

            if ulan_record.wikidata_id and ulan_record.wikidata_id != authority.wikidata_id:
                changes.append(f"wikidata_id: {authority.wikidata_id} -> {ulan_record.wikidata_id}")
                authority.wikidata_id = ulan_record.wikidata_id

            # Update sync timestamps
            authority.ulan_synced_at = datetime.now(timezone.utc)
            if ulan_modified:
                authority.ulan_modified_at = ulan_modified

            if changes:
                logger.info(f"Updated authority {authority_id} from ULAN: {', '.join(changes)}")

            return {
                "status": "synced",
                "authority_id": authority_id,
                "ulan_id": authority.ulan_id,
                "preferred_name": authority.name,
                "changes": changes,
                "ulan_modified_at": authority.ulan_modified_at.isoformat() if authority.ulan_modified_at else None,
                "ulan_synced_at": authority.ulan_synced_at.isoformat(),
            }

    except Exception as e:
        logger.error(f"Failed to sync ULAN authority {authority_id}: {e}")
        raise


@celery_app.task(
    base=SystemTask,
    name='app.tasks.ulan.refresh_stale_ulan_authorities',
    soft_time_limit=600,
    time_limit=900,
    queue='default',
)
def refresh_stale_ulan_authorities_task(
    since_days: int = 7,
) -> dict[str, Any]:
    """
    Refresh ULAN authorities that have been modified in Getty since our last sync.

    Uses an efficient batch approach:
    1. One SPARQL query to get all ULAN records modified in the last N days
    2. Compare with our local ULAN IDs to find records we have
    3. Only fetch full records for items that have actually changed

    This minimizes API calls by doing one bulk query instead of per-record checks.

    Args:
        since_days: Look for changes in the last N days (default 7)

    Returns:
        Result dict with counts
    """
    since_date = datetime.now(timezone.utc) - timedelta(days=since_days)
    logger.info(f"Checking for ULAN changes since {since_date.isoformat()}")

    try:
        from app.services.constituent_service import (
            fetch_ulan_full_record,
            fetch_ulan_records_modified_since,
        )
        from app.tasks.rls_helpers import admin_db_session

        # Phase 1: Get all ULAN records modified since our cutoff date (one API call)
        modified_records = fetch_ulan_records_modified_since(since_date, limit=2000)

        if not modified_records:
            logger.info("No ULAN records modified in the time window")
            return {
                "status": "completed",
                "ulan_changes": 0,
                "local_matches": 0,
                "updated": 0,
                "failed": 0,
            }

        modified_ulan_ids = {r["ulan_id"]: r["modified"] for r in modified_records}
        logger.info(f"Found {len(modified_ulan_ids)} ULAN records modified since {since_date.date()}")

        # System task: scans constituents across all orgs, needs BYPASSRLS
        with admin_db_session() as session:
            # Phase 2: Find which of these we have locally
            local_authorities = session.query(Constituent).filter(
                Constituent.ulan_id.in_(list(modified_ulan_ids.keys())),
                Constituent.status == "active",
            ).all()

            if not local_authorities:
                logger.info("None of the modified ULAN records are in our database")
                return {
                    "status": "completed",
                    "ulan_changes": len(modified_ulan_ids),
                    "local_matches": 0,
                    "updated": 0,
                    "failed": 0,
                }

            logger.info(f"Found {len(local_authorities)} local records to update")

            updated = 0
            failed = 0

            # Phase 3: Fetch and update each matching record
            for authority in local_authorities:
                try:
                    ulan_modified = modified_ulan_ids.get(authority.ulan_id)

                    # Skip if our record is already up-to-date
                    if authority.ulan_modified_at and ulan_modified:
                        if ulan_modified <= authority.ulan_modified_at:
                            continue

                    # Fetch full record from ULAN
                    ulan_record = fetch_ulan_full_record(authority.ulan_id)

                    if not ulan_record:
                        logger.warning(f"Could not fetch ULAN record {authority.ulan_id}")
                        failed += 1
                        continue

                    # Update fields
                    if ulan_record.preferred_name:
                        authority.name = ulan_record.preferred_name
                    if ulan_record.display_name:
                        authority.display_name = ulan_record.display_name
                    if ulan_record.variant_names:
                        from app.models import VariantTerm
                        session.query(VariantTerm).filter(
                            VariantTerm.entity_type == 'constituent',
                            VariantTerm.entity_id == authority.constituent_id,
                            VariantTerm.source == 'ulan',
                        ).delete()
                        for idx, vn in enumerate(ulan_record.variant_names):
                            name = vn.get("name", vn) if isinstance(vn, dict) else vn
                            session.add(VariantTerm(
                                organization_id=authority.organization_id,
                                entity_type='constituent', entity_id=authority.constituent_id,
                                term=name, source='ulan', display_order=idx,
                            ))
                    if ulan_record.nationality:
                        authority.nationality = ulan_record.nationality
                    if ulan_record.nationalities:
                        authority.nationalities = ulan_record.nationalities
                    if ulan_record.gender:
                        authority.gender = ulan_record.gender
                    if ulan_record.life_roles:
                        authority.life_roles = ulan_record.life_roles
                    if ulan_record.birth_date_display:
                        authority.birth_date_display = ulan_record.birth_date_display
                    if ulan_record.birth_place:
                        authority.birth_place = ulan_record.birth_place
                    if ulan_record.death_date_display:
                        authority.death_date_display = ulan_record.death_date_display
                    if ulan_record.death_place:
                        authority.death_place = ulan_record.death_place
                    if ulan_record.biography:
                        authority.biography = ulan_record.biography
                    if ulan_record.viaf_id:
                        authority.viaf_id = ulan_record.viaf_id
                    if ulan_record.wikidata_id:
                        authority.wikidata_id = ulan_record.wikidata_id

                    # Update sync timestamps
                    authority.ulan_synced_at = datetime.now(timezone.utc)
                    authority.ulan_modified_at = ulan_modified

                    updated += 1
                    logger.info(f"Updated {authority.name} from ULAN")

                except Exception as e:
                    logger.warning(f"Failed to update ULAN authority {authority.ulan_id}: {e}")
                    failed += 1

            logger.info(f"ULAN sync complete: {updated} updated, {failed} failed")

            return {
                "status": "completed",
                "ulan_changes": len(modified_ulan_ids),
                "local_matches": len(local_authorities),
                "updated": updated,
                "failed": failed,
            }

    except Exception as e:
        logger.error(f"Failed to refresh ULAN authorities: {e}")
        return {
            "status": "failed",
            "error": str(e),
        }


@celery_app.task(
    base=SystemTask,
    name='app.tasks.ulan.backfill_ulan_sync_timestamps',
    soft_time_limit=600,
    time_limit=900,
    queue='default',
)
def backfill_ulan_sync_timestamps_task(
    limit: int = 100,
) -> dict[str, Any]:
    """
    Backfill ulan_synced_at and ulan_modified_at for records that don't have them.

    This is a one-time task to initialize sync tracking for existing records.

    Args:
        limit: Maximum records to process per run

    Returns:
        Result dict with counts
    """
    logger.info(f"Backfilling ULAN sync timestamps (limit={limit})")

    try:
        from app.services.constituent_service import fetch_ulan_modified_date
        from app.tasks.rls_helpers import admin_db_session

        # System task: scans constituents across all orgs, needs BYPASSRLS
        with admin_db_session() as session:
            # Find authorities with ULAN ID but no sync timestamp
            authorities = session.query(Constituent).filter(
                Constituent.ulan_id.isnot(None),
                Constituent.status == "active",
                Constituent.ulan_synced_at.is_(None),
            ).limit(limit).all()

            if not authorities:
                logger.info("No records need backfilling")
                return {
                    "status": "completed",
                    "processed": 0,
                    "failed": 0,
                }

            processed = 0
            failed = 0

            for authority in authorities:
                try:
                    ulan_modified = fetch_ulan_modified_date(authority.ulan_id)

                    authority.ulan_synced_at = datetime.now(timezone.utc)
                    authority.ulan_modified_at = ulan_modified

                    processed += 1

                except Exception as e:
                    logger.warning(f"Failed to backfill {authority.ulan_id}: {e}")
                    failed += 1

            logger.info(f"Backfill complete: {processed} processed, {failed} failed")

            return {
                "status": "completed",
                "processed": processed,
                "failed": failed,
            }

    except Exception as e:
        logger.error(f"Failed to backfill ULAN timestamps: {e}")
        return {
            "status": "failed",
            "error": str(e),
        }


# Note: Periodic task registration is in celery_app.py beat_schedule
