"""
Background tasks for report execution and delivery.

Tasks run asynchronously in Celery workers to:
1. Execute scheduled reports at configured times
2. Generate exports in the configured format
3. Send email with report attachments
4. Generate on-demand reports from search/workspace/record contexts
"""

import logging
from datetime import datetime, date, timedelta, timezone
from typing import Any
from uuid import UUID

from celery import Task

from botocore.exceptions import ClientError
from sqlalchemy.exc import OperationalError

from app.celery_app import celery_app
from app.database import current_session
from app.tasks.base import OrgTask, SystemTask

logger = logging.getLogger(__name__)


@celery_app.task(
    base=SystemTask,
    name='app.tasks.reports.cleanup_expired_exports',
    soft_time_limit=300,
    time_limit=600,
)
def cleanup_expired_exports_task() -> dict[str, Any]:
    """
    Clean up expired report exports from S3.

    This task runs periodically (e.g., daily via Celery Beat) to delete
    exports older than 7 days to manage storage costs.

    Returns:
        Dict with count of deleted exports
    """
    from app.services import report_storage

    try:
        deleted_count = report_storage.cleanup_expired_exports()

        return {
            "success": True,
            "deleted_count": deleted_count,
            "cleaned_at": datetime.now(timezone.utc).isoformat(),
        }

    except Exception as e:
        logger.error("Failed to cleanup expired exports: %s", str(e), exc_info=True)
        raise


# ============================================================================
# ON-DEMAND REPORT GENERATION
# ============================================================================

@celery_app.task(
    base=OrgTask,
    bind=True,
    name='app.tasks.reports.generate_on_demand_report',
    max_retries=2,
    autoretry_for=(OperationalError, ClientError, ConnectionError),
    retry_backoff=True,
    retry_backoff_max=300,
    soft_time_limit=540,  # 9 minutes
    time_limit=600,  # 10 minutes max
)
def generate_on_demand_report_task(
    self: Task,
    run_id: str,
    organization_id: str,
) -> dict[str, Any]:
    """
    Generate an on-demand report from a registry definition.

    This task:
    1. Loads the ReportRun (has report_key, context_type, context_params)
    2. Looks up the ReportDefinition from the registry
    3. Calls the appropriate resolver to get data
    4. Calls the appropriate renderer to produce output
    5. Uploads to S3
    6. Updates ReportRun status
    7. Creates an in-app notification for the user

    Args:
        run_id: ReportRun UUID
        organization_id: Organization UUID

    Returns:
        Dict with execution results
    """
    from app.models import ReportRun
    from app.services.report_registry import get_registry
    from app.services import report_storage
    from app.services.notification_service import create_notification

    # Ensure report definitions are registered
    import app.services.report_definitions  # noqa: F401

    try:
        run = current_session().query(ReportRun).filter_by(
            run_id=UUID(run_id),
            organization_id=UUID(organization_id),
        ).first()

        if not run:
            logger.error("ReportRun not found: %s", run_id)
            return {"success": False, "error": "Run not found"}

        if run.status == "cancelled":
            logger.info("ReportRun %s was cancelled, skipping", run_id)
            return {"success": False, "skipped": True}

        # Mark as running
        run.status = "running"
        run.started_at = datetime.now(timezone.utc)
        current_session().commit()

        try:
            # Look up report definition
            registry = get_registry()
            definition = registry.get(run.report_key)
            if not definition:
                raise ValueError(f"Unknown report key: {run.report_key}")

            # Resolve data — thread user identity for access checks
            start_time = datetime.now(timezone.utc)
            ctx = dict(run.context_params or {})
            if run.triggered_by_user_id:
                ctx["_triggered_by_user_id"] = str(run.triggered_by_user_id)
            rows, col_defs, metadata = definition.resolver(
                run.context_type,
                ctx,
                UUID(organization_id),
            )
            end_time = datetime.now(timezone.utc)
            execution_time_ms = int((end_time - start_time).total_seconds() * 1000)

            # Render output
            export_format = run.export_format or definition.default_format
            if definition.style == "document":
                content, content_type, extension = definition.renderer(
                    data=rows,
                    export_format=export_format,
                    columns=col_defs,
                    report_name=definition.name,
                    metadata=metadata,
                )
            else:
                content, content_type, extension = definition.renderer(
                    data=rows,
                    export_format=export_format,
                    columns=col_defs,
                    report_name=definition.name,
                )

            # Upload to S3
            # Use a synthetic report_id for the S3 path (based on report_key)
            import hashlib
            synthetic_report_id = hashlib.md5(
                run.report_key.encode()
            ).hexdigest()[:32]
            # Format as UUID-like string
            synthetic_report_id = (
                f"{synthetic_report_id[:8]}-{synthetic_report_id[8:12]}-"
                f"{synthetic_report_id[12:16]}-{synthetic_report_id[16:20]}-"
                f"{synthetic_report_id[20:]}"
            )

            s3_key = report_storage.upload_report_export(
                organization_id=organization_id,
                report_id=synthetic_report_id,
                run_id=run.run_id,
                content=content,
                export_format=export_format,
                report_name=definition.name,
            )

            # Update run
            run.status = "completed"
            run.row_count = len(rows)
            run.execution_time_ms = execution_time_ms
            run.export_s3_key = s3_key
            run.completed_at = datetime.now(timezone.utc)
            current_session().commit()

            # Re-scope before the next statement. SET LOCAL app.current_org_id is
            # transaction-scoped, so the commit above discards it and the insert
            # below runs with no org — RLS then refuses it:
            #   InsufficientPrivilege: new row violates row-level security policy
            #   for table "notifications"
            # It was caught and logged as a warning, so the report completed and
            # the user was simply never told it was ready.
            from app.tasks.rls_helpers import set_task_rls_context

            set_task_rls_context(current_session(), str(organization_id))

            # Create notification for the user
            if run.triggered_by_user_id:
                try:
                    create_notification(
                        session=current_session(),
                        organization_id=UUID(organization_id),
                        user_id=run.triggered_by_user_id,
                        notification_type="report_ready",
                        title=f"Report ready: {definition.name}",
                        message=f"Your {definition.name} ({export_format.upper()}) is ready for download. {len(rows)} rows generated.",
                        entity_type="report_run",
                        entity_id=run.run_id,
                    )
                except Exception as e:
                    logger.warning("Failed to create notification for report %s: %s", run_id, e)

            logger.info(
                "On-demand report generated: run=%s, key=%s, rows=%d, format=%s",
                run_id, run.report_key, len(rows), export_format,
            )

            return {
                "success": True,
                "run_id": str(run.run_id),
                "report_key": run.report_key,
                "row_count": len(rows),
                "execution_time_ms": execution_time_ms,
                "export_format": export_format,
            }

        except Exception as e:
            logger.error("On-demand report failed: %s", str(e), exc_info=True)
            run.status = "failed"
            run.error_message = _user_friendly_error(e)
            run.completed_at = datetime.now(timezone.utc)
            current_session().commit()
            raise

    except Exception as e:
        logger.error("On-demand report task failed: %s", str(e), exc_info=True)
        raise


def _user_friendly_error(exc: Exception) -> str:
    """Map exceptions to user-friendly error messages."""
    msg = str(exc)
    if isinstance(exc, ValueError):
        if "report key" in msg.lower():
            return "This report type is no longer available."
        return "Invalid report parameters. Please check your selection and try again."
    if isinstance(exc, RuntimeError) and "unavailable" in msg.lower():
        return "Search service is temporarily unavailable. Please try again in a few minutes."
    if isinstance(exc, (ConnectionError, OSError)):
        return "A connection error occurred. Please try again."
    return "Report generation failed. Please try again or contact support."


# ============================================================================
# MODULE REPORT EXPORT
# ============================================================================


# ============================================================================
# DOCUMENT GENERATION
# ============================================================================

@celery_app.task(
    base=OrgTask,
    bind=True,
    name='app.tasks.reports.generate_document_task',
    max_retries=2,
    autoretry_for=(OperationalError, ClientError, ConnectionError),
    retry_backoff=True,
    retry_backoff_max=300,
    soft_time_limit=540,  # 9 minutes
    time_limit=600,  # 10 minutes max
)
def generate_document_task(
    self: Task,
    run_id: str,
    organization_id: str,
) -> dict[str, Any]:
    """
    Generate a PDF document (receipt, agreement, etc.) asynchronously.

    This task:
    1. Loads the ReportRun (has report_key=document_type, context_params=data)
    2. Resolves document data
    3. Generates the PDF
    4. Uploads to S3
    5. Updates ReportRun status
    6. Creates an in-app notification for the user

    Args:
        run_id: ReportRun UUID
        organization_id: Organization UUID

    Returns:
        Dict with execution results
    """
    import hashlib
    from app.models import ReportRun
    from app.services import report_storage
    from app.services.notification_service import create_notification
    from app.services.document_generation_service import generate_document as gen_doc
    # Import the resolver — it accepts a standard Session so pass current_session()
    from app.fastapi_app.routers.reports_misc import _resolve_document_data

    try:
        run = current_session().query(ReportRun).filter_by(
            run_id=UUID(run_id),
            organization_id=UUID(organization_id),
        ).first()

        if not run:
            logger.error("ReportRun not found: %s", run_id)
            return {"success": False, "error": "Run not found"}

        if run.status == "cancelled":
            logger.info("ReportRun %s was cancelled, skipping", run_id)
            return {"success": False, "skipped": True}

        # Mark as running
        run.status = "running"
        run.started_at = datetime.now(timezone.utc)
        current_session().commit()

        try:
            document_type = run.report_key
            data = run.context_params or {}

            if not document_type:
                raise ValueError("No document_type (report_key) set on ReportRun")

            # Resolve document data
            start_time = datetime.now(timezone.utc)
            resolved = _resolve_document_data(
                document_type, data, UUID(organization_id), current_session(),
            )
            end_time = datetime.now(timezone.utc)

            # Generate PDF
            pdf_bytes = gen_doc(
                document_type=document_type,
                organization=resolved["organization"],
                branding=resolved["branding"],
                data=resolved["data"],
            )

            execution_time_ms = int(
                (datetime.now(timezone.utc) - start_time).total_seconds() * 1000
            )

            # Upload to S3
            # Use a synthetic report_id based on document_type
            synthetic_report_id = hashlib.md5(
                document_type.encode()
            ).hexdigest()[:32]
            synthetic_report_id = (
                f"{synthetic_report_id[:8]}-{synthetic_report_id[8:12]}-"
                f"{synthetic_report_id[12:16]}-{synthetic_report_id[16:20]}-"
                f"{synthetic_report_id[20:]}"
            )

            s3_key = report_storage.upload_report_export(
                organization_id=organization_id,
                report_id=synthetic_report_id,
                run_id=run.run_id,
                content=pdf_bytes,
                export_format="pdf",
                report_name=document_type,
            )

            # Update run
            run.status = "completed"
            run.row_count = 1
            run.execution_time_ms = execution_time_ms
            run.export_s3_key = s3_key
            run.completed_at = datetime.now(timezone.utc)
            current_session().commit()

            # Re-scope: SET LOCAL app.current_org_id is transaction-scoped, so the
            # commit above discards it and the insert below would be refused by
            # the notifications org-isolation policy.
            from app.tasks.rls_helpers import set_task_rls_context

            set_task_rls_context(current_session(), str(organization_id))

            # Create notification for the user
            if run.triggered_by_user_id:
                try:
                    friendly_name = document_type.replace("_", " ").title()
                    create_notification(
                        session=current_session(),
                        organization_id=UUID(organization_id),
                        user_id=run.triggered_by_user_id,
                        notification_type="report_ready",
                        title=f"Document ready: {friendly_name}",
                        message=f"Your {friendly_name} (PDF) is ready for download.",
                        entity_type="report_run",
                        entity_id=run.run_id,
                    )
                except Exception as e:
                    logger.warning("Failed to create notification for document %s: %s", run_id, e)

            logger.info(
                "Document generated: run=%s, type=%s",
                run_id, document_type,
            )

            return {
                "success": True,
                "run_id": str(run.run_id),
                "document_type": document_type,
                "execution_time_ms": execution_time_ms,
            }

        except Exception as e:
            logger.error("Document generation failed: %s", str(e), exc_info=True)
            run.status = "failed"
            run.error_message = _user_friendly_error(e)
            run.completed_at = datetime.now(timezone.utc)
            current_session().commit()
            raise

    except Exception as e:
        logger.error("Generate document task failed: %s", str(e), exc_info=True)
        raise
