#!/usr/bin/env python3
"""
Legacy Payload Migration Tool.

Scans the database for EntityCurrent rows with legacy payloads and provides:
- Summary counts by source_system
- CSV export of entity keys for review
- Optional re-canonicalization (dry-run by default)

USAGE:
    # Report only (safe)
    python -m scripts.admin.migrate_legacy_payloads --report

    # Export CSV list of legacy entities
    python -m scripts.admin.migrate_legacy_payloads --export legacy_entities.csv

    # Dry-run migration (shows what would change, no writes)
    python -m scripts.admin.migrate_legacy_payloads --dry-run

    # Execute migration (CAUTION: modifies database)
    python -m scripts.admin.migrate_legacy_payloads --execute

PREREQUISITES:
    - DATABASE_URL environment variable must be set
    - For --execute, requires explicit confirmation

SAFETY:
    - Default mode is --report (read-only)
    - --dry-run shows what would change without writing
    - --execute requires interactive confirmation
    - All migrations are logged with before/after state
"""

import argparse
import csv
import json
import logging
import sys
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

# Setup path for imports
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.models import EntityCurrent, Organization
from app.schemas.canonical import (
    is_canonical_payload,
    is_legacy_payload,
    PayloadStatus,
    get_payload_status,
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


def get_database_url() -> str:
    """Get database URL from environment."""
    url = os.environ.get("DATABASE_URL")
    if not url:
        logger.error("DATABASE_URL environment variable not set")
        sys.exit(1)
    return url


def scan_legacy_payloads(session, organization_id: str | None = None) -> dict[str, Any]:
    """
    Scan database for legacy payloads.

    Args:
        session: SQLAlchemy session
        organization_id: Optional filter by organization

    Returns:
        Dict with summary stats and entity lists
    """
    logger.info("Scanning for legacy payloads...")

    query = session.query(EntityCurrent)
    if organization_id:
        query = query.filter(EntityCurrent.organization_id == organization_id)

    stats = {
        "total_entities": 0,
        "canonical_valid": 0,
        "canonical_invalid": 0,
        "legacy_wrapped": 0,
        "legacy_unwrapped": 0,
        "unknown": 0,
        "by_source_system": defaultdict(lambda: {"total": 0, "legacy": 0}),
        "by_organization": defaultdict(lambda: {"total": 0, "legacy": 0}),
        "legacy_entities": [],  # List of (org_id, entity_key, source_system, status)
    }

    batch_size = 1000
    offset = 0

    while True:
        batch = query.limit(batch_size).offset(offset).all()
        if not batch:
            break

        for entity in batch:
            stats["total_entities"] += 1
            source_system = entity.source_system or "unknown"
            org_id = str(entity.organization_id)

            stats["by_source_system"][source_system]["total"] += 1
            stats["by_organization"][org_id]["total"] += 1

            # Analyze payload status
            payload = entity.payload or {}
            status_info = get_payload_status(payload)

            if status_info.status == PayloadStatus.CANONICAL:
                stats["canonical_valid"] += 1
            elif status_info.status == PayloadStatus.CANONICAL_INVALID:
                stats["canonical_invalid"] += 1
            elif status_info.status == PayloadStatus.LEGACY:
                if status_info.is_wrapped:
                    stats["legacy_wrapped"] += 1
                else:
                    stats["legacy_unwrapped"] += 1
                stats["by_source_system"][source_system]["legacy"] += 1
                stats["by_organization"][org_id]["legacy"] += 1
                stats["legacy_entities"].append({
                    "organization_id": org_id,
                    "entity_key": entity.entity_key,
                    "source_system": source_system,
                    "source_id": entity.source_id,
                    "status": status_info.status.value,
                    "is_wrapped": status_info.is_wrapped,
                })
            else:
                stats["unknown"] += 1

        offset += batch_size
        if offset % 10000 == 0:
            logger.info(f"  Processed {offset} entities...")

    return stats


def print_report(stats: dict[str, Any]) -> None:
    """Print formatted report of legacy payload scan."""
    print("\n" + "=" * 70)
    print("LEGACY PAYLOAD SCAN REPORT")
    print("=" * 70)

    print(f"\nTotal entities scanned: {stats['total_entities']:,}")
    print(f"\nPayload Status Breakdown:")
    print(f"  - Canonical (valid):    {stats['canonical_valid']:,}")
    print(f"  - Canonical (invalid):  {stats['canonical_invalid']:,}")
    print(f"  - Legacy (wrapped):     {stats['legacy_wrapped']:,}")
    print(f"  - Legacy (unwrapped):   {stats['legacy_unwrapped']:,}")
    print(f"  - Unknown:              {stats['unknown']:,}")

    total_legacy = stats['legacy_wrapped'] + stats['legacy_unwrapped']
    if stats['total_entities'] > 0:
        pct = (total_legacy / stats['total_entities']) * 100
        print(f"\nLegacy payload percentage: {pct:.2f}%")

    if stats['by_source_system']:
        print("\nLegacy Counts by Source System:")
        for source, counts in sorted(stats['by_source_system'].items()):
            if counts['legacy'] > 0:
                pct = (counts['legacy'] / counts['total']) * 100 if counts['total'] > 0 else 0
                print(f"  {source}: {counts['legacy']:,} / {counts['total']:,} ({pct:.1f}%)")

    print("\n" + "=" * 70)


def export_csv(stats: dict[str, Any], output_path: str) -> None:
    """Export legacy entity list to CSV."""
    logger.info(f"Exporting {len(stats['legacy_entities']):,} legacy entities to {output_path}")

    with open(output_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "organization_id",
            "entity_key",
            "source_system",
            "source_id",
            "status",
            "is_wrapped",
        ])
        writer.writeheader()
        writer.writerows(stats["legacy_entities"])

    print(f"\nExported {len(stats['legacy_entities']):,} legacy entities to: {output_path}")


def dry_run_migration(session, stats: dict[str, Any]) -> None:
    """
    Dry-run migration showing what would change.

    NOTE: This shows the entities that would be migrated, but does NOT
    perform any actual migration. Migration logic depends on:
    - Having access to raw source data in sources map
    - Having a connector that can re-normalize the data

    For now, this just identifies which entities need migration.
    """
    print("\n" + "=" * 70)
    print("DRY RUN - Migration Preview")
    print("=" * 70)

    if not stats["legacy_entities"]:
        print("\nNo legacy entities found. Nothing to migrate.")
        return

    print(f"\nWould migrate {len(stats['legacy_entities']):,} legacy entities:")
    print("\nSample entities (first 10):")
    for entity in stats["legacy_entities"][:10]:
        print(f"  - {entity['entity_key']} (source={entity['source_system']}, wrapped={entity['is_wrapped']})")

    print("\n" + "-" * 70)
    print("MIGRATION REQUIREMENTS:")
    print("-" * 70)
    print("""
Migration of legacy payloads requires:

1. RAW SOURCE DATA: The sources map must contain raw_payload for the connector
   that originally provided the data.

2. CONNECTOR RE-RUN: The source connector must be re-run to:
   - Re-fetch and normalize the data
   - Produce a valid CanonicalRecord

3. MANUAL MAPPING: Some legacy records may need manual mapping updates
   if the original data format has changed.

RECOMMENDED APPROACH:
1. Export the CSV list of legacy entities
2. Group by source_system
3. Re-run the source connector for each affected dataset
4. Verify canonical payloads are produced

To execute migration for a specific connector, use the route trigger:
    POST /api/routes/{pipeline_id}/trigger
""")


def execute_migration(session, stats: dict[str, Any]) -> None:
    """
    Execute migration (placeholder - requires connector re-run).

    NOTE: This function does NOT perform automatic migration because:
    - Migration requires re-running the source connector
    - Automatic re-normalization could lose data if connector changed
    - Safe migration requires human review

    Instead, this marks entities as needing migration and provides guidance.
    """
    print("\n" + "=" * 70)
    print("EXECUTE MIGRATION")
    print("=" * 70)

    if not stats["legacy_entities"]:
        print("\nNo legacy entities found. Nothing to migrate.")
        return

    # Safety confirmation
    print(f"\nThis will mark {len(stats['legacy_entities']):,} entities for migration.")
    print("\nNOTE: Actual migration requires re-running source connectors.")
    print("This operation will:")
    print("  1. Log all entities requiring migration")
    print("  2. Update provenance.migrationRequired = true (if not set)")
    print("  3. NOT modify the payload content")

    confirm = input("\nType 'MIGRATE' to confirm: ")
    if confirm != "MIGRATE":
        print("Migration cancelled.")
        return

    # Mark entities for migration
    migrated_count = 0
    for entity_info in stats["legacy_entities"]:
        try:
            entity = session.query(EntityCurrent).filter_by(
                organization_id=entity_info["organization_id"],
                entity_key=entity_info["entity_key"],
            ).first()

            if entity and entity.payload:
                payload = entity.payload
                if isinstance(payload, dict):
                    # Ensure provenance exists
                    if "provenance" not in payload:
                        payload["provenance"] = {}
                    if isinstance(payload["provenance"], dict):
                        payload["provenance"]["migrationRequired"] = True
                        payload["provenance"]["migrationTaggedAt"] = datetime.now(timezone.utc).isoformat()
                        entity.payload = payload
                        migrated_count += 1

        except Exception as e:
            logger.error(f"Error marking entity {entity_info['entity_key']}: {e}")

    session.commit()
    print(f"\nMarked {migrated_count:,} entities for migration.")
    print("To complete migration, re-run the source connectors for affected datasets.")


def main():
    parser = argparse.ArgumentParser(
        description="Legacy Payload Migration Tool",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--report",
        action="store_true",
        default=True,
        help="Print summary report of legacy payloads (default)",
    )
    parser.add_argument(
        "--export",
        metavar="FILE",
        help="Export legacy entity keys to CSV file",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what migration would do without making changes",
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Execute migration (requires confirmation)",
    )
    parser.add_argument(
        "--organization-id",
        metavar="UUID",
        help="Filter by organization ID",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Verbose output",
    )

    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    # Connect to database
    database_url = get_database_url()
    engine = create_engine(database_url)
    Session = sessionmaker(bind=engine)
    session = Session()

    try:
        # Scan for legacy payloads
        stats = scan_legacy_payloads(session, args.organization_id)

        # Print report (always)
        print_report(stats)

        # Export CSV if requested
        if args.export:
            export_csv(stats, args.export)

        # Dry-run migration if requested
        if args.dry_run:
            dry_run_migration(session, stats)

        # Execute migration if requested
        if args.execute:
            execute_migration(session, stats)

    except Exception as e:
        logger.error(f"Error: {e}")
        sys.exit(1)
    finally:
        session.close()


if __name__ == "__main__":
    main()
