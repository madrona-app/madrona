"""
Celery dispatch for the org-provisioning saga.

The synchronous /api/platform/provision path runs `ProvisioningService.run_job`
in the request thread — fine for the existing 6 steps (Cognito + email,
seconds total). Demo provisioning adds the sandbox seeding steps on top.

That seeding used to download collections from the Met, Smithsonian and
Rijksmuseum APIs and generate synthetic media, which took 5–15 minutes and
was the original reason for dispatching async. It no longer does: the
manifests are checked into the repository and the fixture images ship with
it, so seeding is local work. Measured end to end against a local stack on
2026-09-24: **7 seconds** for all nine steps, including the OpenSearch
writes.

The async dispatch is kept regardless, for reasons that survive the speed
change: the admin UI shows step-by-step progress from the job row, a failed
step can be retried without re-running the saga, and a managed database on
the other side of a network is not a laptop. Do not cite a 5–15 minute
runtime as the justification — it is no longer true, and a decision resting
on a stale number is one nobody can re-evaluate.

When `with_demo_data=true` is passed to the endpoint, it dispatches
`run_provisioning_job_task` instead of running the saga inline, then returns
202 with the job_id. The admin UI polls `GET /api/platform/provision/{job_id}`
for step-by-step progress.

This task is a SystemTask (cross-org), not OrgTask. The saga writes to
RLS-protected tables (organizations, users, organization_memberships,
organization_applications, etc.) for an org that does not yet exist in any
membership graph — there is no `current_org_id` that would satisfy the
standard `(organization_id = current_org_id())` policy. So the worker
runs against `admin_db_session()` (the BYPASSRLS owner connection), which
is the same connection migrations and seeds use.
"""
from __future__ import annotations

import logging
from uuid import UUID

from app.celery_app import celery_app
from app.tasks.base import SystemTask

logger = logging.getLogger(__name__)


@celery_app.task(
    base=SystemTask,
    bind=True,
    name="app.tasks.provisioning.run_job",
    # No autoretry — failures should surface as job.status='failed' so the
    # admin UI can show the error and the user can hit Retry intentionally.
    # The saga itself tracks retry_count separately; Celery's retry would
    # double-count.
    max_retries=0,
    soft_time_limit=20 * 60,   # 20 min — sandbox seeding upper bound
    time_limit=25 * 60,
)
def run_provisioning_job_task(self, job_id: str) -> dict:
    """
    Execute a queued ProvisioningJob asynchronously.

    Args:
        job_id: UUID string of an existing OrgProvisioningJob row.

    Returns:
        Result dict with status and job_id. Errors during the saga are
        captured on the job row itself (status='failed', error_message,
        error_step) — this task always returns successfully so Celery
        doesn't retry the saga; retries are admin-driven via the
        platform_admin retry endpoint.
    """
    from app.models.provisioning import OrgProvisioningJob
    from app.services.provisioning_service import (
        ProvisioningService,
        ProvisioningError,
        ConcurrentJobError,
    )
    from app.tasks.rls_helpers import admin_db_session

    # Use the BYPASSRLS owner connection. SystemTask's outer get_session()
    # context manager (set up by base.py) is still active but we don't use
    # that session — we open our own admin session for the saga's writes.
    with admin_db_session() as session:
        job = (
            session.query(OrgProvisioningJob)
            .filter_by(job_id=UUID(job_id))
            .first()
        )
        if job is None:
            logger.error("provisioning task: job_id %s not found in DB", job_id)
            return {"status": "not_found", "job_id": job_id}

        # Already-finished jobs are a no-op. The dispatch path tries to
        # claim 'pending'/'failed' jobs only, so this guard is for safety
        # on retries or doubled-up dispatches.
        if job.status in ("completed",):
            logger.info("provisioning task: job %s already completed", job_id)
            return {"status": "already_completed", "job_id": job_id}

        service = ProvisioningService(session, performer_id=job.initiated_by)

        try:
            service.run_job(job)
            logger.info(
                "provisioning task: job %s completed (slug=%s)",
                job_id,
                job.organization_slug,
            )
            return {"status": "completed", "job_id": job_id}
        except ConcurrentJobError:
            logger.warning(
                "provisioning task: job %s already running elsewhere", job_id
            )
            return {"status": "already_running", "job_id": job_id}
        except ProvisioningError as e:
            # Saga marks the job failed and persists error_message/error_step
            # on its own; we just log and return so Celery records success
            # (no autoretry).
            logger.error(
                "provisioning task: job %s failed at step '%s': %s",
                job_id,
                e.step,
                e,
            )
            return {
                "status": "failed",
                "job_id": job_id,
                "error_step": e.step,
                "error_message": str(e),
            }
