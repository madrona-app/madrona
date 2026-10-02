"""
PostgreSQL storage metering per organization.

Estimates per-org database storage by apportioning table sizes
proportionally based on row counts. Uses pg_total_relation_size()
for table-level totals, then splits by org using COUNT(*).
"""

import logging
from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Registry of org-scoped tables: (schema, table_name)
# All tables here have an organization_id column.
ORG_SCOPED_TABLES = [
    # collections schema
    ("collections", "collection_objects"),
    ("collections", "object_titles"),
    ("collections", "object_other_numbers"),
    ("collections", "object_measurements"),
    ("collections", "object_inscriptions"),
    ("collections", "object_classifications"),
    ("collections", "constituents"),
    ("collections", "constituent_xrefs"),
    ("collections", "constituent_relations"),
    ("collections", "place_authorities"),
    ("collections", "object_place_authorities"),
    ("collections", "style_period_authorities"),
    ("collections", "object_style_periods"),
    ("collections", "subject_authorities"),
    ("collections", "object_subjects"),
    ("collections", "events"),
    ("collections", "event_object_links"),
    ("collections", "workspaces"),
    ("collections", "workspace_shares"),
    ("collections", "user_active_context"),
    ("collections", "insurance_policies"),
    ("collections", "insurance_coverages"),
    ("collections", "indemnity_arrangements"),
    ("collections", "insurance_claims"),
    ("collections", "discover_configs"),
    ("collections", "publish_schedules"),
    ("collections", "documentation_plans"),
    ("collections", "emergency_plans"),
    ("collections", "incident_reports"),
    ("collections", "incident_report_objects"),
    ("collections", "collections_reviews"),
    ("collections", "crates"),
    ("collections", "shipments"),
    ("collections", "shipment_legs"),
    ("collections", "shipment_items"),
    ("collections", "shipment_references"),
    ("collections", "shipment_status_history"),
    ("collections", "shipment_documents"),
    # media schema
    ("media", "collection_feedback_requests"),
    ("media", "workspace_shares"),
    ("media", "workspace_action_runs"),
    # content schema
    ("content", "pages"),
    ("content", "content_blocks"),
    ("content", "categories"),
    ("content", "menus"),
    ("content", "menu_items"),
    ("content", "redirects"),
    # reports schema
    ("reports", "reports"),
    ("reports", "report_schedules"),
    ("reports", "report_runs"),
    # public schema
    ("public", "entity_audit_events"),
    ("public", "entity_audit_field_diffs"),
    ("public", "conversations"),
    ("public", "messages"),
    ("public", "tasks"),
    ("public", "visitors"),
    ("public", "visits"),
    ("public", "visit_interactions"),
    ("public", "uri_registry"),
    ("public", "entity_merge_log"),
    ("public", "sla_policies"),
    ("public", "sla_events"),
    # flow schema
    ("flow", "entity_current"),
    ("flow", "change_events"),
    ("flow", "field_diffs"),
]


def measure_org_postgres_bytes(organization_id: str, session: Session) -> int:
    """
    Estimate PostgreSQL storage used by a single organization.

    For each org-scoped table:
    1. Get total table size via pg_total_relation_size()
    2. Get total row count from pg_stat_user_tables.n_live_tup
    3. Count org-specific rows
    4. Proportional: org_bytes = (org_rows / total_rows) * table_size

    Returns estimated bytes.
    """
    total_org_bytes = 0

    # Cache table sizes — same for all orgs in a single run
    for schema, table in ORG_SCOPED_TABLES:
        try:
            qualified = f"{schema}.{table}"

            # Get total table size (data + indexes + toast)
            size_result = session.execute(
                text("SELECT pg_total_relation_size(:table_name)"),
                {"table_name": qualified},
            ).scalar()

            if not size_result or size_result == 0:
                continue

            # Get estimated total row count (fast, from stats collector)
            total_rows = session.execute(
                text(
                    "SELECT COALESCE(n_live_tup, 0) "
                    "FROM pg_stat_user_tables "
                    "WHERE schemaname = :schema AND relname = :table"
                ),
                {"schema": schema, "table": table},
            ).scalar()

            if not total_rows or total_rows == 0:
                continue

            # Count org rows (exact count for this org)
            org_rows = session.execute(
                text(f"SELECT COUNT(*) FROM {qualified} WHERE organization_id = :org_id"),
                {"org_id": organization_id},
            ).scalar()

            if not org_rows or org_rows == 0:
                continue

            # Proportional estimate
            org_bytes = int((org_rows / total_rows) * size_result)
            total_org_bytes += org_bytes

        except Exception:
            logger.warning(
                "db_metering_table_error",
                extra={"schema": schema, "table": table, "organization_id": organization_id},
                exc_info=True,
            )
            continue

    return total_org_bytes


def measure_all_orgs_postgres_bytes(
    org_ids: list[str], session: Session
) -> dict[str, int]:
    """
    Batch-measure PostgreSQL storage for all orgs efficiently.

    Pre-fetches table sizes and total row counts, then only runs
    per-org COUNT queries. Significantly faster than calling
    measure_org_postgres_bytes() in a loop.
    """
    results = {org_id: 0 for org_id in org_ids}

    for schema, table in ORG_SCOPED_TABLES:
        try:
            qualified = f"{schema}.{table}"

            # Table size (shared across all orgs)
            table_size = session.execute(
                text("SELECT pg_total_relation_size(:table_name)"),
                {"table_name": qualified},
            ).scalar()

            if not table_size or table_size == 0:
                continue

            # Estimated total rows
            total_rows = session.execute(
                text(
                    "SELECT COALESCE(n_live_tup, 0) "
                    "FROM pg_stat_user_tables "
                    "WHERE schemaname = :schema AND relname = :table"
                ),
                {"schema": schema, "table": table},
            ).scalar()

            if not total_rows or total_rows == 0:
                continue

            # Get per-org row counts in one query
            rows = session.execute(
                text(
                    f"SELECT organization_id, COUNT(*) as cnt "
                    f"FROM {qualified} "
                    f"GROUP BY organization_id"
                ),
            ).fetchall()

            for org_id, cnt in rows:
                org_id_str = str(org_id)
                if org_id_str in results:
                    results[org_id_str] += int((cnt / total_rows) * table_size)

        except Exception:
            logger.warning(
                "db_metering_table_error",
                extra={"schema": schema, "table": table},
                exc_info=True,
            )
            continue

    return results
