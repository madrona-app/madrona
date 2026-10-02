"""
Background tasks for visitor session management.

Periodic tasks:
- check_ended_visits: Detect visits that have gone idle and mark them ended
- purge_expired_agent_conversations: Daily retention purge for agent conversations
- send_visit_recap_task: Send a post-visit recap email for a specific visit
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from app.celery_app import celery_app
from app.database import current_session
from app.tasks.base import SystemTask

logger = logging.getLogger(__name__)


@celery_app.task(
    base=SystemTask,
    name='app.tasks.visitor.send_visit_recap',
    soft_time_limit=60,
    time_limit=120,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=600,
    max_retries=3,
)
def send_visit_recap_task(visit_id: str) -> dict[str, Any]:
    """Send a post-visit email recap for a specific visit."""
    from app.models.visitor import Visit
    from app.services.visit_recap_service import get_visit_recap_service

    # Idempotency check: skip if recap already sent
    visit = current_session().query(Visit).filter(
        Visit.visit_id == UUID(visit_id),
    ).first()
    if visit and visit.recap_sent_at:
        return {"success": True, "visit_id": visit_id, "skipped": "already_sent"}

    service = get_visit_recap_service()
    success = service.send_recap(UUID(visit_id))
    return {
        "success": success,
        "visit_id": visit_id,
    }


@celery_app.task(
    base=SystemTask,
    name='app.tasks.visitor.check_ended_visits',
    soft_time_limit=120,
    time_limit=180,
)
def check_ended_visits_task() -> dict[str, Any]:
    """
    Check for visits that have gone idle and mark them as ended.

    A visit is considered ended if:
    - It has no ended_at timestamp
    - Its last interaction was more than 2 hours ago (or started_at if no interactions)

    For visits with recap email set, queues a recap email task.
    """
    from app.models.visitor import Visit, VisitInteraction, Visitor
    from app.tasks.rls_helpers import admin_db_session
    from sqlalchemy import func

    try:
        now = datetime.now(timezone.utc)
        idle_threshold = now - timedelta(hours=2)

        with admin_db_session() as session:
            # Find active visits with no recent activity
            active_visits = session.query(Visit).filter(
                Visit.ended_at.is_(None),
                Visit.started_at < idle_threshold,
            ).all()

            ended_count = 0
            recap_queued = 0

            for visit in active_visits:
                # Check for recent interactions
                last_interaction = session.query(
                    func.max(VisitInteraction.created_at)
                ).filter(
                    VisitInteraction.visit_id == visit.visit_id,
                ).scalar()

                last_activity = last_interaction or visit.started_at
                if last_activity and last_activity < idle_threshold:
                    visit.ended_at = last_activity + timedelta(minutes=5)
                    ended_count += 1

                    # Check if visitor has email for recap
                    visitor = session.query(Visitor).filter(
                        Visitor.visitor_id == visit.visitor_id,
                    ).first()

                    should_recap = (
                        visitor
                        and (visit.recap_email or visitor.email)
                        and (visit.recap_sent_at is None)
                    )
                    if should_recap:
                        if not visit.recap_email and visitor.email:
                            visit.recap_email = visitor.email

            # Commit ended visits before queueing async tasks
            # to avoid inconsistent state if commit fails
            session.commit()

            # Now queue recap tasks for visits that were just ended
            for visit in active_visits:
                if visit.ended_at and visit.recap_email and (visit.recap_sent_at is None):
                    send_visit_recap_task.apply_async(
                        args=[str(visit.visit_id)],
                        countdown=300,  # 5 minute delay
                    )
                    recap_queued += 1

        return {
            "success": True,
            "checked_at": now.isoformat(),
            "ended_count": ended_count,
            "recap_queued": recap_queued,
        }
    except Exception as e:
        logger.exception("Failed to check ended visits")
        return {"success": False, "error": "Internal error - see logs"}


@celery_app.task(
    base=SystemTask,
    name='app.tasks.visitor.purge_expired_agent_conversations',
    soft_time_limit=300,
    time_limit=600,
)
def purge_expired_agent_conversations_task() -> dict[str, Any]:
    """Daily retention purge for agent conversations.

    Deletes visitor and staff conversations beyond their configured
    retention window (default: 90 days visitor, 365 days staff).
    """
    from app.tasks.rls_helpers import admin_db_session
    from app.services.agent_retention import purge_expired_conversations

    try:
        with admin_db_session() as session:
            counts = purge_expired_conversations(session=session)
        return {
            "success": True,
            "purged_visitor": counts["visitor"],
            "purged_staff": counts["staff"],
        }
    except Exception as e:
        logger.exception("Failed to purge expired agent conversations")
        return {"success": False, "error": "Internal error - see logs"}
