"""
Run notification service.

Sends email notifications for run status changes (e.g., failures).

Uses Redis for distributed notification cooldown tracking with
in-memory fallback when Redis is unavailable.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Organization, OrganizationMembership, Run, User, Pipeline
from app.services.email_service import get_email_service
from app.services.redis_client import get_redis_client

logger = logging.getLogger(__name__)

# Cooldown period to avoid spam (30 minutes)
FAILURE_NOTIFICATION_COOLDOWN_MINUTES = 30

# In-memory cache for last notification time per pipeline
# Key: pipeline_id, Value: last notification timestamp
_last_pipeline_notification_cache: dict[UUID, datetime] = {}


def notify_run_failure(
    session: Session,
    run: Run,
) -> None:
    """
    Send failure notification email for a failed run.
    
    Only sends on first failure within cooldown window to avoid spam.
    Notifies org admins (and optionally registrars if policy exists).
    
    Args:
        session: Database session
        run: The failed run
    """
    try:
        # Check cooldown to avoid spam
        if _should_skip_notification(run):
            logger.info(
                "Skipping failure notification for run %s (within cooldown window)",
                run.run_id
            )
            return
        
        # Get pipeline name
        pipeline = session.query(Pipeline).filter_by(pipeline_id=run.pipeline_id).first()
        if not pipeline:
            logger.warning("Cannot send notification: pipeline %s not found", run.pipeline_id)
            return

        pipeline_name = pipeline.name
        
        # Get organization
        org = session.query(Organization).filter_by(
            organization_id=run.organization_id
        ).first()
        if not org:
            logger.warning("Cannot send notification: org %s not found", run.organization_id)
            return
        
        # Get admin emails
        admin_emails = _get_admin_emails(session, run.organization_id)
        if not admin_emails:
            logger.warning(
                "No admin emails found for org %s, skipping notification",
                run.organization_id
            )
            return
        
        # Build email content
        subject = f"Pipeline run failed: {pipeline_name}"
        html_body, text_body = _build_failure_email(run, pipeline_name, org.name)
        
        # Send email
        email_service = get_email_service()
        email_service.send_email(
            channel="notifications",
            to=admin_emails,
            subject=subject,
            html=html_body,
            text=text_body,
        )
        
        # Update cache (Redis + in-memory)
        if run.pipeline_id:
            _record_notification_time(run.pipeline_id)
        
        logger.info(
            "Sent failure notification for run %s to %d recipients",
            run.run_id,
            len(admin_emails)
        )
        
    except Exception as e:
        # Don't fail run execution if notification fails
        logger.error(
            "Failed to send failure notification for run %s: %s",
            run.run_id,
            str(e),
            exc_info=True
        )


def _should_skip_notification(run: Run) -> bool:
    """
    Check if we should skip notification due to cooldown.

    Only send notifications on first failure in a streak.
    Uses Redis for distributed cooldown tracking with in-memory fallback.

    Args:
        run: The run to check

    Returns:
        True if notification should be skipped, False otherwise
    """
    if not run.pipeline_id:
        # Always notify for runs without pipelines
        return False

    now = datetime.now(timezone.utc)

    # Try Redis first for distributed cooldown tracking
    redis = get_redis_client()
    if redis.is_available():
        try:
            key = f"madrona:notify:cooldown:{run.pipeline_id}"
            cached = redis.client.get(key)
            if cached:
                last_notification = datetime.fromisoformat(cached.decode())
                cooldown_end = last_notification + timedelta(minutes=FAILURE_NOTIFICATION_COOLDOWN_MINUTES)
                if now < cooldown_end:
                    return True
            return False
        except Exception as e:
            logger.debug(f"Redis cooldown check failed, using in-memory: {e}")

    # Fallback to in-memory cache
    last_notification = _last_pipeline_notification_cache.get(run.pipeline_id)
    if not last_notification:
        # No previous notification, send it
        return False

    # Check if we're within cooldown window
    cooldown_end = last_notification + timedelta(minutes=FAILURE_NOTIFICATION_COOLDOWN_MINUTES)

    return now < cooldown_end


def _record_notification_time(pipeline_id: UUID) -> None:
    """
    Record notification time in both Redis and in-memory cache.

    Args:
        pipeline_id: The pipeline ID to record notification for
    """
    now = datetime.now(timezone.utc)

    # Update in-memory cache for immediate consistency
    _last_pipeline_notification_cache[pipeline_id] = now

    # Update Redis for distributed tracking
    redis = get_redis_client()
    if redis.is_available():
        try:
            key = f"madrona:notify:cooldown:{pipeline_id}"
            ttl_seconds = FAILURE_NOTIFICATION_COOLDOWN_MINUTES * 60
            redis.client.setex(key, ttl_seconds, now.isoformat())
        except Exception as e:
            logger.debug(f"Failed to set Redis notification cooldown: {e}")


def _get_admin_emails(session: Session, organization_id: UUID) -> list[str]:
    """
    Get email addresses of all admins in the organization.
    
    Args:
        session: Database session
        organization_id: Organization ID
        
    Returns:
        List of admin email addresses
    """
    admin_memberships = (
        session.query(OrganizationMembership)
        .filter_by(organization_id=organization_id, role="admin")
        .all()
    )
    
    if not admin_memberships:
        return []
    
    # Get user emails
    user_ids = [m.user_id for m in admin_memberships]
    users = session.query(User).filter(User.user_id.in_(user_ids)).all()
    
    return [u.email for u in users if u.email]


def _build_failure_email(
    run: Run,
    pipeline_name: str,
    org_name: str,
) -> tuple[str, str]:
    """
    Build HTML and text email bodies for failure notification.

    Args:
        run: The failed run
        pipeline_name: Name of the pipeline
        org_name: Name of the organization

    Returns:
        Tuple of (html_body, text_body)
    """
    settings = get_settings()
    run_detail_url = f"{settings.app_base_url}/app/runs/{run.run_id}"

    # Format timestamps
    started_at_str = run.started_at.strftime("%Y-%m-%d %H:%M:%S UTC") if run.started_at else "N/A"
    finished_at_str = run.finished_at.strftime("%Y-%m-%d %H:%M:%S UTC") if run.finished_at else "N/A"

    # Get error message (first 200 chars)
    error_message = run.error[:200] if run.error else "No error message available"
    if run.error and len(run.error) > 200:
        error_message += "..."

    # Build HTML email
    html_body = f"""
    <html>
    <body style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
        <h2 style="color: #d32f2f;">Run Failed</h2>
        <p>A pipeline run in <strong>{org_name}</strong> has failed.</p>

        <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p style="margin: 5px 0;"><strong>Pipeline:</strong> {pipeline_name}</p>
            <p style="margin: 5px 0;"><strong>Run ID:</strong> {run.run_id}</p>
            <p style="margin: 5px 0;"><strong>Started:</strong> {started_at_str}</p>
            <p style="margin: 5px 0;"><strong>Finished:</strong> {finished_at_str}</p>
        </div>

        <div style="background-color: #ffebee; padding: 15px; border-left: 4px solid #d32f2f; margin: 20px 0;">
            <p style="margin: 5px 0;"><strong>Error:</strong></p>
            <p style="margin: 5px 0; font-family: monospace; font-size: 0.9em;">{error_message}</p>
        </div>

        <p>
            <a href="{run_detail_url}"
               style="display: inline-block; background-color: #1976d2; color: white; padding: 10px 20px;
                      text-decoration: none; border-radius: 5px; margin-top: 10px;">
                View Run Details
            </a>
        </p>

        <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">
        <p style="font-size: 0.9em; color: #666;">
            This is an automated notification from Madrona. You're receiving this because you're an admin
            in the <strong>{org_name}</strong> organization.
        </p>
    </body>
    </html>
    """

    # Build plain text email
    text_body = f"""
Run Failed

A pipeline run in {org_name} has failed.

Pipeline: {pipeline_name}
Run ID: {run.run_id}
Started: {started_at_str}
Finished: {finished_at_str}

Error:
{error_message}

View run details: {run_detail_url}

---
This is an automated notification from Madrona. You're receiving this because you're an admin in the {org_name} organization.
    """

    return html_body.strip(), text_body.strip()


def clear_notification_cache() -> None:
    """
    Clear the notification cache (both Redis and in-memory).

    Useful for testing or manual cache resets.
    """
    # Clear in-memory cache
    _last_pipeline_notification_cache.clear()

    # Clear Redis cache
    redis = get_redis_client()
    if redis.is_available():
        try:
            # Delete all notification cooldown keys
            cursor = 0
            pattern = "madrona:notify:cooldown:*"
            while True:
                cursor, keys = redis.client.scan(cursor, match=pattern, count=100)
                if keys:
                    redis.client.delete(*keys)
                if cursor == 0:
                    break
        except Exception as e:
            logger.debug(f"Failed to clear Redis notification cache: {e}")

    logger.info("Notification cache cleared")
