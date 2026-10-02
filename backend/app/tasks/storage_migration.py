"""
Celery tasks for storage migration.

Provides background task support for migrating organization storage
from managed to BYOB.
"""

import asyncio
import logging
from datetime import datetime, timezone
from uuid import UUID

from app.celery_app import celery_app
from app.database import current_session
from app.tasks.base import OrgTask

logger = logging.getLogger(__name__)


@celery_app.task(base=OrgTask, bind=True, max_retries=0, time_limit=86400)  # 24 hour limit
def migrate_storage_task(
    self,
    organization_id: str,
    dest_provider: str,
    dest_config: dict,
    dry_run: bool = False,
    notify_on_complete: bool = True,
) -> dict:
    """
    Background task for migrating organization storage.

    Args:
        organization_id: Organization UUID
        dest_provider: Destination provider ('s3', 'azure', 'gcs', 's3_compatible')
        dest_config: Destination configuration dict (unencrypted)
        dry_run: If True, only list files without copying
        notify_on_complete: Send notification when complete

    Returns:
        Dict with migration results
    """
    from app.models import Organization
    from app.services.storage.migration import (
        migrate_organization_storage,
        MigrationProgress,
    )

    try:
        logger.info(
            "Starting storage migration for org %s to %s (dry_run=%s)",
            organization_id,
            dest_provider,
            dry_run,
        )

        # Store task ID on organization for progress tracking
        org = current_session().query(Organization).filter(
            Organization.organization_id == organization_id
        ).first()

        if not org:
            return {
                "success": False,
                "error": "Organization not found",
            }

        # Progress callback to update task state
        def progress_callback(progress: MigrationProgress):
            self.update_state(
                state="PROGRESS",
                meta={
                    "total_files": progress.total_files,
                    "files_copied": progress.files_copied,
                    "files_failed": progress.files_failed,
                    "percent_complete": progress.percent_complete,
                    "current_file": progress.current_file,
                    "status": progress.status.value,
                },
            )

        # Run migration (async in sync context)
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        try:
            result = loop.run_until_complete(
                migrate_organization_storage(
                    organization_id=organization_id,
                    dest_provider=dest_provider,
                    dest_config=dest_config,
                    db_session=current_session(),
                    dry_run=dry_run,
                    progress_callback=progress_callback,
                )
            )
        finally:
            loop.close()

        # Send notification if enabled
        if notify_on_complete and not dry_run:
            _send_migration_notification(
                organization_id=organization_id,
                success=result.success,
                progress=result.progress,
            )

        logger.info(
            "Storage migration completed for org %s: success=%s, files=%d, failed=%d",
            organization_id,
            result.success,
            result.progress.files_copied,
            result.progress.files_failed,
        )

        return {
            "success": result.success,
            "total_files": result.progress.total_files,
            "files_copied": result.progress.files_copied,
            "files_failed": result.progress.files_failed,
            "files_skipped": result.progress.files_skipped,
            "bytes_copied": result.progress.bytes_copied,
            "errors": result.errors[:10],  # Limit errors in response
            "started_at": result.progress.started_at.isoformat() if result.progress.started_at else None,
            "completed_at": result.progress.completed_at.isoformat() if result.progress.completed_at else None,
        }

    except Exception as e:
        logger.exception("Storage migration failed for org %s: %s", organization_id, e)
        return {
            "success": False,
            "error": str(e),
        }


@celery_app.task(base=OrgTask, bind=True, max_retries=0, time_limit=3600)  # 1 hour limit
def verify_storage_migration_task(
    self,
    organization_id: str,
    sample_rate: float = 1.0,
) -> dict:
    """
    Background task for verifying storage migration integrity.

    Args:
        organization_id: Organization UUID
        sample_rate: Fraction of files to verify (0.0 to 1.0)

    Returns:
        Dict with verification results
    """
    from app.services.storage.factory import get_storage_backend, get_managed_storage_backend
    from app.services.storage.migration import StorageMigrationService
    from app.models import Organization

    try:
        logger.info(
            "Starting storage verification for org %s (sample_rate=%.2f)",
            organization_id,
            sample_rate,
        )

        # Get organization
        org = current_session().query(Organization).filter(
            Organization.organization_id == organization_id
        ).first()

        if not org:
            return {
                "success": False,
                "error": "Organization not found",
            }

        # Get source (managed) and destination (current) backends
        source_region = org.storage_region or "us-west-2"
        source_backend = get_managed_storage_backend(source_region)
        dest_backend = get_storage_backend(organization_id, current_session())

        # Create migration service for verification
        service = StorageMigrationService(
            organization_id=organization_id,
            source_backend=source_backend,
            dest_backend=dest_backend,
            db_session=current_session(),
        )

        # Run verification (async in sync context)
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        try:
            result = loop.run_until_complete(
                service.verify_integrity(sample_rate=sample_rate)
            )
        finally:
            loop.close()

        logger.info(
            "Storage verification completed for org %s: success=%s, verified=%d, failed=%d",
            organization_id,
            result.success,
            result.verified_files,
            result.failed_files,
        )

        return {
            "success": result.success,
            "total_files": result.total_files,
            "verified_files": result.verified_files,
            "failed_files": result.failed_files,
            "missing_files": result.missing_files[:50],  # Limit list size
            "checksum_mismatches": result.checksum_mismatches[:50],
            "errors": result.errors,
        }

    except Exception as e:
        logger.exception("Storage verification failed for org %s: %s", organization_id, e)
        return {
            "success": False,
            "error": str(e),
        }


def _send_migration_notification(
    organization_id: str,
    success: bool,
    progress,
):
    """Send notification about migration completion."""
    try:
        from app.services.notification_service import send_notification

        if success:
            title = "Storage Migration Complete"
            message = (
                f"Your storage migration completed successfully. "
                f"{progress.files_copied} files ({progress.bytes_copied / (1024**3):.2f} GB) "
                f"were migrated to your new storage."
            )
            notification_type = "success"
        else:
            title = "Storage Migration Failed"
            message = (
                f"Your storage migration encountered errors. "
                f"{progress.files_copied} files were copied, "
                f"{progress.files_failed} files failed. "
                f"Please check the migration logs for details."
            )
            notification_type = "error"

        # Send to organization admins
        send_notification(
            organization_id=organization_id,
            title=title,
            message=message,
            notification_type=notification_type,
            target_role="admin",
        )

    except Exception as e:
        logger.warning("Failed to send migration notification: %s", e)
