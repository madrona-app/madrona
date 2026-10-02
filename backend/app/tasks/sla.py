"""
SLA deadline checking periodic task.

Runs every 15 minutes via Celery Beat to evaluate all SLA policies
across all organizations and send escalation notifications.
"""
import logging
from typing import Any
from uuid import UUID

from app.celery_app import celery_app
from app.tasks.base import SystemTask

logger = logging.getLogger(__name__)


@celery_app.task(
    base=SystemTask,
    name='app.tasks.sla.check_sla_deadlines',
    soft_time_limit=240,
    time_limit=300,
)
def check_sla_deadlines_task() -> dict[str, Any]:
    """
    Check SLA deadlines across all organizations.

    1. Get all orgs with enabled SLA policies
    2. For each org, evaluate all in-progress workflow records
    3. For warning/breach/critical records, process escalation
    4. Return summary counts
    """
    from sqlalchemy import select, distinct

    from app.database import current_session
    from app.models import SLAPolicy
    from app.services.sla_service import check_organization_slas, process_escalation
    from app.tasks.rls_helpers import admin_db_session

    try:
        # Get all orgs with enabled policies (system task, bypass RLS)
        with admin_db_session() as session:
            org_ids = session.execute(
                select(distinct(SLAPolicy.organization_id)).where(
                    SLAPolicy.enabled == True,
                )
            ).scalars().all()

        if not org_ids:
            return {"success": True, "orgs_checked": 0, "escalations": 0}

        total_escalations = 0
        total_warnings = 0
        total_breaches = 0
        total_critical = 0
        errors = 0

        for org_id in org_ids:
            try:
                # Set RLS context for this org
                from app.tasks.rls_helpers import set_task_rls_context
                set_task_rls_context(current_session(), str(org_id))

                results = check_organization_slas(org_id)

                for result in results:
                    sla_status = result["sla_status"]

                    if sla_status == "warning":
                        total_warnings += 1
                    elif sla_status == "breach":
                        total_breaches += 1
                    elif sla_status == "critical":
                        total_critical += 1

                    event = process_escalation(
                        org_id=org_id,
                        policy=result["policy"],
                        record=result["record"],
                        sla_status=sla_status,
                    )
                    if event:
                        total_escalations += 1

            except Exception as e:
                logger.error(
                    "SLA check failed for org %s: %s", org_id, str(e), exc_info=True
                )
                errors += 1

        logger.info(
            "SLA check complete: %d orgs, %d warnings, %d breaches, %d critical, %d new escalations, %d errors",
            len(org_ids), total_warnings, total_breaches, total_critical,
            total_escalations, errors,
        )

        return {
            "success": True,
            "orgs_checked": len(org_ids),
            "warnings": total_warnings,
            "breaches": total_breaches,
            "critical": total_critical,
            "escalations": total_escalations,
            "errors": errors,
        }

    except Exception as e:
        logger.error("SLA deadline check failed: %s", str(e), exc_info=True)
        return {"success": False, "error": str(e)}
