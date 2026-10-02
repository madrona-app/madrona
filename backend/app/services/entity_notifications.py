"""
Centralized notification dispatch for entity status changes, assignments, and approvals.

All notification functions:
1. Skip self-notifications (actor == recipient)
2. Re-set RLS context before create_notification() (SET LOCAL is cleared after each commit)
3. Call emit_notification() to targeted user rooms for real-time bell refresh
4. Are wrapped in try/except so failures never break the API
5. Determine recipients from watchers + discussion commenters (excluding actor)
"""
import logging
from uuid import UUID

from app.services.rls import set_rls_context_for_session

from app.database import get_session_factory
from app.models import RecordComment, RecordWatch, User
from app.services.notification_service import create_notification
from app.services.event_emitter import emit_notification

logger = logging.getLogger(__name__)

# Cache for user display names within a single request
_user_name_cache: dict[str, str] = {}


def _get_session(session=None):
    """Get a SQLAlchemy session — uses standalone engine."""
    if session is not None:
        return session
    return get_session_factory()()


def _get_user_name(session, user_id) -> str:
    """Get display name for a user, with in-request caching."""
    uid = str(user_id)
    if uid in _user_name_cache:
        return _user_name_cache[uid]

    user = session.get(User, user_id if isinstance(user_id, UUID) else UUID(uid))
    name = (user.display_name or user.email) if user else "Someone"
    _user_name_cache[uid] = name
    return name


def _resolve_recipients(session, org_id, entity_type, entity_id, actor_id) -> set[str]:
    """
    Build a deduplicated set of user IDs who should receive a notification.

    Only includes users who have explicitly opted in:
    - RecordWatch entries for the entity (user clicked "Watch")
    - RecordComment authors on the entity (user participated in discussion)

    Always excludes the actor (the person who made the change).
    """
    recipients: set[str] = set()
    actor_str = str(actor_id) if actor_id else None
    org_uuid = org_id if isinstance(org_id, UUID) else UUID(str(org_id))
    entity_id_uuid = entity_id if isinstance(entity_id, UUID) else UUID(str(entity_id))

    # Watchers
    try:
        watchers = (
            session.query(RecordWatch.user_id)
            .filter(
                RecordWatch.organization_id == org_uuid,
                RecordWatch.entity_type == entity_type,
                RecordWatch.entity_id == entity_id_uuid,
            )
            .all()
        )
        for (watcher_id,) in watchers:
            recipients.add(str(watcher_id))
    except Exception:
        # RecordWatch CHECK constraint may not include this entity_type yet — that's fine
        pass

    # Discussion commenters
    try:
        commenters = (
            session.query(RecordComment.author_id)
            .filter(
                RecordComment.organization_id == org_uuid,
                RecordComment.entity_type == entity_type,
                RecordComment.entity_id == entity_id_uuid,
            )
            .distinct()
            .all()
        )
        for (author_id,) in commenters:
            recipients.add(str(author_id))
    except Exception:
        # RecordComment CHECK constraint may not include this entity_type yet — that's fine
        pass

    # Exclude actor
    if actor_str:
        recipients.discard(actor_str)

    return recipients


def _set_rls_context(session, org_id):
    """Re-set RLS context after a commit has cleared SET LOCAL."""
    set_rls_context_for_session(session, str(org_id))


def _format_entity_label(entity_type: str) -> str:
    """Human-readable label for an entity type."""
    labels = {
        'acquisition': 'acquisition',
        'object_entry': 'object entry',
        'object_exit': 'object exit',
        'loan_in': 'incoming loan',
        'loan_out': 'outgoing loan',
        'condition_report': 'condition report',
        'conservation_treatment': 'conservation treatment',
        'movement': 'movement',
        'deaccession': 'deaccession',
        'use_request': 'use request',
        'reproduction_request': 'reproduction request',
        'incident_report': 'incident report',
        'documentation_plan': 'documentation plan',
        'emergency_plan': 'emergency plan',
        'insurance_policy': 'insurance policy',
        'insurance_coverage': 'insurance coverage',
        'insurance_claim': 'insurance claim',
        'indemnity': 'indemnity',
        'exhibition': 'exhibition',
        'checklist_item': 'checklist item',
        'info_request': 'info request',
        'exhibition_loan': 'exhibition loan',
        'shipment': 'shipment',
        'event': 'event',
    }
    return labels.get(entity_type, entity_type.replace('_', ' '))


def notify_status_change(
    org_id,
    entity_type: str,
    entity_id,
    entity_title: str,
    old_status: str,
    new_status: str,
    actor_id,
    entity=None,
    app_context: str | None = None,
    session=None,
):
    """Notify relevant users about an entity status change."""
    if old_status == new_status:
        return

    try:
        sess = _get_session(session)
        _set_rls_context(sess, org_id)
        org_uuid = org_id if isinstance(org_id, UUID) else UUID(str(org_id))
        entity_id_uuid = entity_id if isinstance(entity_id, UUID) else UUID(str(entity_id))
        actor_uuid = actor_id if isinstance(actor_id, UUID) else UUID(str(actor_id))

        actor_name = _get_user_name(sess, actor_id)
        label = _format_entity_label(entity_type)

        # Determine notification type
        notification_type = 'completed' if new_status in ('completed', 'resolved', 'closed', 'settled') else 'status_changed'

        status_display = new_status.replace('_', ' ')
        title = f'{actor_name} changed {label} status to {status_display}: {entity_title}'

        # Resolve recipients (watchers + commenters only)
        recipients = _resolve_recipients(sess, org_uuid, entity_type, entity_id_uuid, actor_id)

        for recipient_id in recipients:
            _set_rls_context(sess, org_id)
            create_notification(
                organization_id=org_uuid,
                user_id=UUID(recipient_id),
                notification_type=notification_type,
                title=title,
                entity_type=entity_type,
                entity_id=entity_id_uuid,
                actor_id=actor_uuid,
                session=sess,
            )

        # Emit to targeted user rooms so only recipients get the real-time bell refresh
        for recipient_id in recipients:
            emit_notification(
                org_id=org_uuid,
                notification_type=notification_type,
                title=title,
                message='',
                user_id=UUID(recipient_id),
            )
    except Exception:
        logger.exception('Failed to send status change notification for %s/%s', entity_type, entity_id)


def notify_assignment_change(
    org_id,
    entity_type: str,
    entity_id,
    entity_title: str,
    old_assignee_id,
    new_assignee_id,
    actor_id,
    app_context: str | None = None,
    session=None,
):
    """Notify old and new assignees about an assignment change."""
    old_str = str(old_assignee_id) if old_assignee_id else None
    new_str = str(new_assignee_id) if new_assignee_id else None
    actor_str = str(actor_id) if actor_id else None

    if old_str == new_str:
        return

    try:
        sess = _get_session(session)
        _set_rls_context(sess, org_id)
        org_uuid = org_id if isinstance(org_id, UUID) else UUID(str(org_id))
        entity_id_uuid = entity_id if isinstance(entity_id, UUID) else UUID(str(entity_id))
        actor_uuid = actor_id if isinstance(actor_id, UUID) else UUID(str(actor_id))

        actor_name = _get_user_name(sess, actor_id)
        label = _format_entity_label(entity_type)

        # Encode app_context into entity_type for frontend routing (tasks)
        notif_entity_type = f'{entity_type}_{app_context}' if app_context else entity_type

        # Notify new assignee
        if new_str and new_str != actor_str:
            _set_rls_context(sess, org_id)
            create_notification(
                organization_id=org_uuid,
                user_id=UUID(new_str),
                notification_type='assigned',
                title=f'{actor_name} assigned you to {label}: {entity_title}',
                entity_type=notif_entity_type,
                entity_id=entity_id_uuid,
                actor_id=actor_uuid,
                session=sess,
            )

        # Notify old assignee
        if old_str and old_str != actor_str:
            _set_rls_context(sess, org_id)
            create_notification(
                organization_id=org_uuid,
                user_id=UUID(old_str),
                notification_type='unassigned',
                title=f'{actor_name} removed you from {label}: {entity_title}',
                entity_type=notif_entity_type,
                entity_id=entity_id_uuid,
                actor_id=actor_uuid,
                session=sess,
            )

        # Emit to targeted user rooms so only assignees get the real-time bell refresh
        if new_str and new_str != actor_str:
            emit_notification(
                org_id=org_uuid,
                notification_type='assigned',
                title=f'{actor_name} assigned you to {label}: {entity_title}',
                message='',
                user_id=UUID(new_str),
            )
        if old_str and old_str != actor_str:
            emit_notification(
                org_id=org_uuid,
                notification_type='unassigned',
                title=f'{actor_name} removed you from {label}: {entity_title}',
                message='',
                user_id=UUID(old_str),
            )
    except Exception:
        logger.exception('Failed to send assignment notification for %s/%s', entity_type, entity_id)


def notify_approval(
    org_id,
    entity_type: str,
    entity_id,
    entity_title: str,
    actor_id,
    entity=None,
    notification_type: str = 'approved',
    app_context: str | None = None,
    session=None,
):
    """Notify relevant users about an approval action."""
    try:
        sess = _get_session(session)
        _set_rls_context(sess, org_id)
        org_uuid = org_id if isinstance(org_id, UUID) else UUID(str(org_id))
        entity_id_uuid = entity_id if isinstance(entity_id, UUID) else UUID(str(entity_id))
        actor_uuid = actor_id if isinstance(actor_id, UUID) else UUID(str(actor_id))

        actor_name = _get_user_name(sess, actor_id)
        label = _format_entity_label(entity_type)

        if notification_type == 'approved':
            title = f'{actor_name} approved {label}: {entity_title}'
        else:
            title = f'{actor_name} requested approval for {label}: {entity_title}'

        # Resolve recipients (watchers + commenters only)
        recipients = _resolve_recipients(sess, org_uuid, entity_type, entity_id_uuid, actor_id)

        for recipient_id in recipients:
            _set_rls_context(sess, org_id)
            create_notification(
                organization_id=org_uuid,
                user_id=UUID(recipient_id),
                notification_type=notification_type,
                title=title,
                entity_type=entity_type,
                entity_id=entity_id_uuid,
                actor_id=actor_uuid,
                session=sess,
            )

        # Emit to targeted user rooms so only recipients get the real-time bell refresh
        for recipient_id in recipients:
            emit_notification(
                org_id=org_uuid,
                notification_type=notification_type,
                title=title,
                message='',
                user_id=UUID(recipient_id),
            )
    except Exception:
        logger.exception('Failed to send approval notification for %s/%s', entity_type, entity_id)


def notify_task_event(
    org_id,
    user_id,
    notification_type: str,
    title: str,
    task_id,
    app_context: str | None = None,
    message: str | None = None,
    actor_id=None,
    session=None,
):
    """
    Create a notification and emit it via WebSocket for a task event.

    Backwards-compatible wrapper that preserves the existing task notification
    types (task_assigned, task_unassigned, task_updated, task_deleted).

    For task_assigned and task_unassigned, also sends an email to the user.
    """
    # Encode app_context into entity_type so frontend can route correctly
    entity_type = f'task_{app_context}' if app_context else 'task'

    try:
        sess = _get_session(session)
        _set_rls_context(sess, org_id)
        org_uuid = org_id if isinstance(org_id, UUID) else UUID(str(org_id))
        user_uuid = user_id if isinstance(user_id, UUID) else UUID(str(user_id))
        task_uuid = task_id if isinstance(task_id, UUID) else UUID(str(task_id))

        create_notification(
            organization_id=org_uuid,
            user_id=user_uuid,
            notification_type=notification_type,
            title=title,
            message=message,
            entity_type=entity_type,
            entity_id=task_uuid,
            actor_id=actor_id,
            session=sess,
        )

        emit_notification(
            org_id=org_uuid,
            notification_type=notification_type,
            title=title,
            message=message or '',
            user_id=user_uuid,
        )

        # Send email for assignment/unassignment
        if notification_type in ('task_assigned', 'task_unassigned'):
            _send_task_assignment_email(
                sess, org_uuid, user_uuid, task_uuid,
                notification_type=notification_type,
                actor_id=actor_id,
                app_context=app_context,
            )
    except Exception:
        logger.exception('Failed to send task notification')


def _send_task_assignment_email(
    session, org_id, user_id, task_id, *, notification_type, actor_id=None, app_context=None,
):
    """Look up task and user details, then send an assignment email."""
    from app.models import Task, User
    from app.services.email_service import get_email_service
    from app.config import get_settings

    try:
        user = session.get(User, user_id)
        if not user or not user.email:
            return

        task = session.get(Task, task_id)
        if not task:
            return

        actor_name = _get_user_name(session, actor_id) if actor_id else "Someone"
        assigned = notification_type == 'task_assigned'

        # Build task URL
        settings = get_settings()
        task_url = f"{settings.app_base_url}/work/tasks"

        # Priority label
        priority_label = None
        if task.priority and task.priority != 'normal':
            priority_label = task.priority.replace('_', ' ').title()

        # Due date
        due_date_str = None
        if task.due_date:
            due_date_str = task.due_date.strftime('%B %d, %Y')

        email_service = get_email_service()
        email_service.send_task_assignment_email(
            email=user.email,
            assigned=assigned,
            task_title=task.title,
            actor_name=actor_name,
            task_description=task.description,
            task_priority=priority_label,
            task_due_date=due_date_str,
            task_url=task_url if assigned else None,
        )
    except Exception:
        logger.exception('Failed to send task assignment email for task %s', task_id)
