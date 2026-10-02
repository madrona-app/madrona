"""
Daily storage metering task.

Measures PostgreSQL and OpenSearch storage per organization and writes
the results to the organizations table. Uses admin_db_session() to
bypass RLS for cross-org measurement.
"""

import logging
from datetime import datetime, timezone

from app.celery_app import celery_app
from app.sentry_crons import cron_monitor
from app.tasks.base import SystemTask

logger = logging.getLogger(__name__)


@celery_app.task(base=SystemTask, name='app.tasks.storage_metering.collect_storage_metrics')
@cron_monitor("collect-storage-metrics")
def collect_storage_metrics() -> dict:
    """
    Daily task: measure Postgres + OpenSearch storage for all organizations.

    Writes db_used_bytes, search_used_bytes, and storage_metered_at
    to each organization row.
    """
    from app.tasks.rls_helpers import admin_db_session
    from app.models import Organization
    from app.services.db_metering import measure_all_orgs_postgres_bytes
    from app.services.search_metering import measure_all_orgs_opensearch_bytes

    with admin_db_session() as session:
        orgs = session.query(
            Organization.organization_id
        ).all()
        org_ids = [str(o.organization_id) for o in orgs]

        if not org_ids:
            logger.info("storage_metering_no_orgs")
            return {"orgs_metered": 0}

        # Batch measure — much faster than per-org
        db_usage = measure_all_orgs_postgres_bytes(org_ids, session)
        search_usage = measure_all_orgs_opensearch_bytes(org_ids)

        now = datetime.now(timezone.utc)
        orgs_updated = 0

        for org_id in org_ids:
            db_bytes = db_usage.get(org_id, 0)
            search_bytes = search_usage.get(org_id, 0)

            session.query(Organization).filter(
                Organization.organization_id == org_id
            ).update({
                Organization.db_used_bytes: db_bytes,
                Organization.search_used_bytes: search_bytes,
                Organization.storage_metered_at: now,
            })
            orgs_updated += 1

        session.commit()

    logger.info(
        "storage_metering_complete",
        extra={"orgs_metered": orgs_updated},
    )

    return {"orgs_metered": orgs_updated}
