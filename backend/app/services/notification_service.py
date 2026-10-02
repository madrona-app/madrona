"""
Notification service for creating and managing in-app notifications.
"""
import logging
from uuid import UUID

from app.models import Notification, RecordWatch, User

logger = logging.getLogger(__name__)


def _get_session(session=None):
    """Get a SQLAlchemy session — uses standalone engine (works in both Flask and ASGI)."""
    if session is not None:
        return session
    from app.database import get_session_factory
    return get_session_factory()()


def notify_watchers_of_comment(
    organization_id: UUID,
    entity_type: str,
    entity_id: UUID,
    comment_author_id: UUID,
    comment_content: str,
    record_title: str | None = None,
    session=None,
) -> int:
    """
    Create notifications for all users watching a record when a comment is added.

    Returns:
        Number of notifications created
    """
    sess = _get_session(session)

    # Find all watchers except the comment author
    watchers = (
        sess.query(RecordWatch)
        .filter(
            RecordWatch.organization_id == organization_id,
            RecordWatch.entity_type == entity_type,
            RecordWatch.entity_id == entity_id,
            RecordWatch.user_id != comment_author_id,
        )
        .all()
    )

    if not watchers:
        return 0

    # Get author display name
    author = sess.query(User).filter(User.user_id == comment_author_id).first()
    author_name = author.display_name if author else "Someone"

    # Build notification title and message
    entity_label = _format_entity_type(entity_type)
    if record_title:
        title = f"{author_name} commented on {record_title}"
    else:
        title = f"{author_name} commented on a {entity_label}"

    # Truncate comment for preview
    message = comment_content[:200] + "..." if len(comment_content) > 200 else comment_content

    # Create notifications for each watcher
    notifications_created = 0
    for watch in watchers:
        notification = Notification(
            organization_id=organization_id,
            user_id=watch.user_id,
            notification_type="comment",
            title=title,
            message=message,
            entity_type=entity_type,
            entity_id=entity_id,
            actor_id=comment_author_id,
        )
        sess.add(notification)
        notifications_created += 1

    if notifications_created > 0:
        sess.commit()
        logger.info(
            f"Created {notifications_created} notifications for comment on {entity_type}/{entity_id}"
        )

    return notifications_created


def create_notification(
    organization_id: UUID,
    user_id: UUID,
    notification_type: str,
    title: str,
    message: str | None = None,
    entity_type: str | None = None,
    entity_id: UUID | None = None,
    actor_id: UUID | None = None,
    session=None,
) -> Notification:
    """Create a single notification."""
    sess = _get_session(session)

    notification = Notification(
        organization_id=organization_id,
        user_id=user_id,
        notification_type=notification_type,
        title=title,
        message=message,
        entity_type=entity_type,
        entity_id=entity_id,
        actor_id=actor_id,
    )
    sess.add(notification)
    sess.commit()

    return notification


def send_notification(
    user_id: UUID,
    notification_type: str,
    data: dict | None = None,
    organization_id: UUID | None = None,
    session=None,
) -> Notification | None:
    """Lightweight helper used by tasks (search subscription notifier and
    similar) that have a user + a free-form data payload but no specific
    entity. Wraps create_notification by serializing the data dict into a
    title/message and resolving organization_id from the user when not
    given.
    """
    if data is None:
        data = {}

    sess = _get_session(session)

    if organization_id is None:
        from app.models import OrganizationMembership
        membership = (
            sess.query(OrganizationMembership)
            .filter(OrganizationMembership.user_id == user_id)
            .first()
        )
        if membership is None:
            return None
        organization_id = membership.organization_id

    # Compose a human-readable title/message from the data payload.
    if notification_type == "search_results_updated":
        new_count = data.get("new_count", 0)
        query = data.get("search_query") or "your saved search"
        title = f"{new_count} new result{'s' if new_count != 1 else ''} for '{query}'"
        message = None
    else:
        title = notification_type.replace("_", " ").title()
        message = None

    return create_notification(
        organization_id=organization_id,
        user_id=user_id,
        notification_type=notification_type,
        title=title,
        message=message,
        session=sess,
    )


def _format_entity_type(entity_type: str) -> str:
    """Format entity type for display."""
    labels = {
        "collection_object": "object",
        "acquisition": "acquisition",
        "loan_in": "incoming loan",
        "loan_out": "outgoing loan",
        "exhibition": "exhibition",
        "media": "media item",
        "media_rights": "media rights record",
    }
    return labels.get(entity_type, entity_type.replace("_", " "))
