#!/usr/bin/env python3
"""
Retention cleanup for provisioning jobs, audit logs, and email events.

Deletes completed/failed records older than the configured retention period.
Safe to run repeatedly (idempotent).

Usage:
    cd backend
    I_UNDERSTAND_THIS_IS_DESTRUCTIVE=true ./venv/bin/python -m scripts.ops.cleanup_retention

Environment variables:
    PROVISIONING_JOB_RETENTION_DAYS  — default 180
    AUDIT_RETENTION_DAYS             — default 180
    DRY_RUN                          — set to "true" to preview without deleting
"""

import os
import sys
from datetime import datetime, timedelta, timezone

# Add app to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

from scripts.ops.utils import require_confirmation, get_db_session, log_ops_action, logger
from app.models import ProvisioningAuditLog, EmailEvent, OrgProvisioningJob


def cleanup_provisioning_jobs(session, cutoff: datetime, dry_run: bool) -> int:
    """Delete completed/failed provisioning jobs older than cutoff."""
    query = (
        session.query(OrgProvisioningJob)
        .filter(
            OrgProvisioningJob.status.in_(["completed", "failed"]),
            OrgProvisioningJob.created_at < cutoff,
        )
    )
    count = query.count()
    if count and not dry_run:
        query.delete(synchronize_session=False)
    return count


def cleanup_audit_logs(session, cutoff: datetime, dry_run: bool) -> int:
    """Delete provisioning audit logs older than cutoff."""
    query = (
        session.query(ProvisioningAuditLog)
        .filter(ProvisioningAuditLog.created_at < cutoff)
    )
    count = query.count()
    if count and not dry_run:
        query.delete(synchronize_session=False)
    return count


def cleanup_email_events(session, cutoff: datetime, dry_run: bool) -> int:
    """Delete email events older than cutoff."""
    query = (
        session.query(EmailEvent)
        .filter(EmailEvent.created_at < cutoff)
    )
    count = query.count()
    if count and not dry_run:
        query.delete(synchronize_session=False)
    return count


def main():
    dry_run = os.environ.get("DRY_RUN", "").lower() == "true"

    if not dry_run:
        require_confirmation("retention cleanup")

    job_retention = int(os.environ.get("PROVISIONING_JOB_RETENTION_DAYS", "180"))
    audit_retention = int(os.environ.get("AUDIT_RETENTION_DAYS", "180"))

    if job_retention <= 0 and audit_retention <= 0:
        logger.info("Both retention periods set to 0 (keep forever). Nothing to do.")
        return

    now = datetime.now(timezone.utc)
    job_cutoff = now - timedelta(days=job_retention) if job_retention > 0 else None
    audit_cutoff = now - timedelta(days=audit_retention) if audit_retention > 0 else None

    mode = "DRY RUN" if dry_run else "LIVE"
    logger.info("=== Retention Cleanup (%s) ===", mode)
    logger.info("Job retention: %d days (cutoff: %s)", job_retention, job_cutoff)
    logger.info("Audit retention: %d days (cutoff: %s)", audit_retention, audit_cutoff)

    session = get_db_session()
    try:
        totals = {}

        if job_cutoff:
            count = cleanup_provisioning_jobs(session, job_cutoff, dry_run)
            totals["provisioning_jobs"] = count
            logger.info("Provisioning jobs to delete: %d", count)

        if audit_cutoff:
            count = cleanup_audit_logs(session, audit_cutoff, dry_run)
            totals["audit_logs"] = count
            logger.info("Audit logs to delete: %d", count)

            count = cleanup_email_events(session, audit_cutoff, dry_run)
            totals["email_events"] = count
            logger.info("Email events to delete: %d", count)

        if not dry_run:
            session.commit()
            log_ops_action(
                session,
                action="retention_cleanup",
                details={
                    "job_retention_days": job_retention,
                    "audit_retention_days": audit_retention,
                    **totals,
                },
            )
            session.commit()
            logger.info("Cleanup committed.")
        else:
            logger.info("Dry run — no records deleted.")

    except Exception:
        session.rollback()
        logger.exception("Cleanup failed")
        raise
    finally:
        session.close()


if __name__ == "__main__":
    main()
