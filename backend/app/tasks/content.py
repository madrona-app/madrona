"""
Background tasks for scheduled Content CMS publishing.

Periodically checks for pages/posts with publish_at <= now
and flips their status from 'draft' to 'published'.
"""

import logging
from datetime import datetime, timezone
from typing import Any

from app.celery_app import celery_app
from app.tasks.base import SystemTask

logger = logging.getLogger(__name__)


@celery_app.task(
    base=SystemTask,
    name='app.tasks.content.check_scheduled_content',
    soft_time_limit=60,
    time_limit=120,
)
def check_scheduled_content_task() -> dict[str, Any]:
    """
    Check for content pages scheduled to publish and execute them.

    Runs every minute via Celery Beat. Finds all pages where
    status='draft' AND publish_at <= now, flips them to 'published'.
    """
    from app.database import current_session
    from app.models import Page
    from app.tasks.rls_helpers import admin_db_session

    try:
        now = datetime.now(timezone.utc)

        # System task: scans across all orgs, needs BYPASSRLS
        with admin_db_session() as session:
            due_pages = session.query(Page).filter(
                Page.status == "draft",
                Page.publish_at.isnot(None),
                Page.publish_at <= now,
            ).all()

        if not due_pages:
            return {
                "success": True,
                "checked_at": now.isoformat(),
                "published_count": 0,
            }

        published_count = 0
        for page in due_pages:
            try:
                page.status = "published"
                if not page.published_at:
                    page.published_at = now
                page.publish_at = None  # Clear the schedule
                published_count += 1

                logger.info(
                    "Auto-published scheduled page: page_id=%s, title=%s",
                    page.page_id, page.title,
                )
            except Exception as e:
                logger.error(
                    "Failed to auto-publish page %s: %s",
                    page.page_id, str(e),
                )

        current_session().commit()

        if published_count > 0:
            logger.info(
                "Scheduled content check complete: published=%d",
                published_count,
            )

        return {
            "success": True,
            "checked_at": now.isoformat(),
            "published_count": published_count,
        }

    except Exception as e:
        logger.error("Failed to check scheduled content: %s", str(e), exc_info=True)
        return {
            "success": False,
            "error": str(e),
        }
