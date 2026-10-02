"""
SLA Evaluation and Escalation Service.

Evaluates workflow records against SLA policies and triggers notifications
when warning, breach, or critical thresholds are reached.
"""
import logging
from datetime import date, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from sqlalchemy.orm import Session

from app.database import current_session
from app.models import (
    User,
    Acquisition,
    ConservationTreatment,
    LoanIn,
    LoanOut,
    ObjectEntry,
    ObjectExit,
    SLAEvent,
    SLAPolicy,
)
from app.services.notification_service import create_notification

logger = logging.getLogger(__name__)

# Terminal statuses — records in these states are no longer tracked
TERMINAL_STATUSES: set[str] = {
    "returned", "completed", "cancelled", "accessioned",
    "acknowledged", "closed", "rejected",
}

# Map workflow_type to (model, date_field for SLA clock start)
WORKFLOW_CONFIG: dict[str, tuple[type, str]] = {
    "loan_in": (LoanIn, "request_date"),
    "loan_out": (LoanOut, "request_date"),
    "object_entry": (ObjectEntry, "entry_date"),
    "object_exit": (ObjectExit, "exit_date"),
    "conservation": (ConservationTreatment, "proposal_date"),
    "acquisition": (Acquisition, "acquisition_date"),
}


def evaluate_record(
    policy: SLAPolicy,
    record: Any,
    today: date,
) -> str:
    """
    Evaluate a single record against an SLA policy.

    Returns one of: 'ok', 'warning', 'breach', 'critical'
    """
    config = WORKFLOW_CONFIG.get(policy.workflow_type)
    if not config:
        return "ok"

    _, date_field = config

    # Get the SLA clock start date
    start_date = getattr(record, date_field, None)
    if start_date is None:
        # Fall back to created_at
        start_date = getattr(record, "created_at", None)

    if start_date is None:
        return "ok"

    # Normalize to date
    if isinstance(start_date, datetime):
        start_date = start_date.date()

    days_elapsed = (today - start_date).days

    if days_elapsed >= policy.critical_days:
        return "critical"
    elif days_elapsed >= policy.deadline_days:
        return "breach"
    elif days_elapsed >= policy.warning_days:
        return "warning"
    return "ok"


def get_days_elapsed(record: Any, workflow_type: str) -> int:
    """Calculate days elapsed since SLA clock start for a record."""
    config = WORKFLOW_CONFIG.get(workflow_type)
    if not config:
        return 0

    _, date_field = config
    start_date = getattr(record, date_field, None) or getattr(record, "created_at", None)

    if start_date is None:
        return 0

    if isinstance(start_date, datetime):
        start_date = start_date.date()

    return (date.today() - start_date).days


def _get_record_id(record: Any, workflow_type: str) -> UUID | None:
    """Get the primary key ID from a workflow record."""
    pk_fields = {
        "loan_in": "loan_in_id",
        "loan_out": "loan_out_id",
        "object_entry": "entry_id",
        "object_exit": "exit_id",
        "conservation": "treatment_id",
        "acquisition": "acquisition_id",
    }
    pk_field = pk_fields.get(workflow_type)
    if pk_field:
        return getattr(record, pk_field, None)
    return None


def _get_record_label(record: Any, workflow_type: str) -> str:
    """Get a human-readable label for a workflow record."""
    label_fields = {
        "loan_in": "loan_number",
        "loan_out": "loan_number",
        "object_entry": "entry_number",
        "object_exit": "exit_number",
        "conservation": "treatment_number",
        "acquisition": "acquisition_number",
    }
    field = label_fields.get(workflow_type)
    if field:
        return getattr(record, field, None) or str(_get_record_id(record, workflow_type) or "")
    return ""


def _get_workflow_label(workflow_type: str) -> str:
    """Get a display label for a workflow type."""
    labels = {
        "loan_in": "incoming loan",
        "loan_out": "outgoing loan",
        "object_entry": "object entry",
        "object_exit": "object exit",
        "conservation": "conservation treatment",
        "acquisition": "acquisition",
    }
    return labels.get(workflow_type, workflow_type.replace("_", " "))


def check_organization_slas(org_id: UUID) -> list[dict[str, Any]]:
    """
    Evaluate all active SLA policies for an organization.

    Returns list of results: [{policy, record, sla_status, days_elapsed}, ...]
    Only returns records that are at warning, breach, or critical level.
    """
    session = current_session()
    today = date.today()

    # Get all enabled policies for this org
    policies = session.execute(
        select(SLAPolicy).where(
            SLAPolicy.organization_id == org_id,
            SLAPolicy.enabled == True,
        )
    ).scalars().all()

    if not policies:
        return []

    results = []

    for policy in policies:
        config = WORKFLOW_CONFIG.get(policy.workflow_type)
        if not config:
            continue

        model, _ = config

        # Fetch all in-progress records for this workflow type
        query = select(model).where(model.organization_id == org_id)

        # Filter out terminal statuses
        if hasattr(model, "status"):
            query = query.where(model.status.notin_(TERMINAL_STATUSES))

        records = session.execute(query).scalars().all()

        for record in records:
            sla_status = evaluate_record(policy, record, today)
            if sla_status != "ok":
                results.append({
                    "policy": policy,
                    "record": record,
                    "sla_status": sla_status,
                    "days_elapsed": get_days_elapsed(record, policy.workflow_type),
                })

    return results


def process_escalation(
    org_id: UUID,
    policy: SLAPolicy,
    record: Any,
    sla_status: str,
) -> SLAEvent | None:
    """
    Process an SLA escalation for a record.

    Checks for duplicate events, creates notification, and records the event.
    Returns the SLAEvent if created, None if deduplicated.
    """
    session = current_session()
    record_id = _get_record_id(record, policy.workflow_type)
    if not record_id:
        return None

    # Dedup: check if we already have an event of this type for this record+policy.
    # Uses FOR UPDATE to prevent concurrent processes from both passing this check.
    existing = session.execute(
        select(SLAEvent).where(
            SLAEvent.policy_id == policy.policy_id,
            SLAEvent.record_id == record_id,
            SLAEvent.event_type == sla_status,
        ).with_for_update(skip_locked=True)
    ).scalar_one_or_none()

    if existing:
        return None  # Already notified

    # Determine who to notify
    notified_user_ids = []
    days_elapsed = get_days_elapsed(record, policy.workflow_type)
    record_label = _get_record_label(record, policy.workflow_type)
    workflow_label = _get_workflow_label(policy.workflow_type)

    # Notify assignee if configured
    if policy.notify_assignee and hasattr(record, "assigned_to_user_id"):
        assignee_id = record.assigned_to_user_id
        if assignee_id:
            notified_user_ids.append(str(assignee_id))
            _send_sla_notification(
                org_id=org_id,
                user_id=assignee_id,
                sla_status=sla_status,
                workflow_label=workflow_label,
                record_label=record_label,
                policy_name=policy.name,
                days_elapsed=days_elapsed,
                record_id=record_id,
                workflow_type=policy.workflow_type,
            )

    # Escalate to role on critical
    if sla_status == "critical" and policy.escalate_to_role:
        role_users = session.execute(
            select(User).where(
                User.active_organization_id == org_id,
                User.role == policy.escalate_to_role,
            )
        ).scalars().all()

        for user in role_users:
            if str(user.user_id) not in notified_user_ids:
                notified_user_ids.append(str(user.user_id))
                _send_sla_notification(
                    org_id=org_id,
                    user_id=user.user_id,
                    sla_status=sla_status,
                    workflow_label=workflow_label,
                    record_label=record_label,
                    policy_name=policy.name,
                    days_elapsed=days_elapsed,
                    record_id=record_id,
                    workflow_type=policy.workflow_type,
                )

    # Record the event (catch IntegrityError from concurrent duplicate inserts)
    event = SLAEvent(
        organization_id=org_id,
        policy_id=policy.policy_id,
        workflow_type=policy.workflow_type,
        record_id=record_id,
        event_type=sla_status,
        days_elapsed=days_elapsed,
        notified_user_ids=notified_user_ids,
    )
    session.add(event)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        logger.debug("SLA event already exists (concurrent insert), skipping")
        return None

    logger.info(
        "SLA %s for %s %s (policy=%s, %d days elapsed, %d users notified)",
        sla_status, workflow_label, record_label, policy.name,
        days_elapsed, len(notified_user_ids),
    )

    return event


def _send_sla_notification(
    org_id: UUID,
    user_id: UUID,
    sla_status: str,
    workflow_label: str,
    record_label: str,
    policy_name: str,
    days_elapsed: int,
    record_id: UUID,
    workflow_type: str,
) -> None:
    """Send an SLA notification to a user."""
    status_labels = {
        "warning": "approaching deadline",
        "breach": "past deadline",
        "critical": "CRITICAL - requires immediate attention",
    }
    status_text = status_labels.get(sla_status, sla_status)

    title = f"SLA {sla_status.title()}: {workflow_label.title()} {record_label}"
    message = (
        f"{policy_name}: {workflow_label.title()} {record_label} is {status_text}. "
        f"{days_elapsed} days elapsed."
    )

    create_notification(
        organization_id=org_id,
        user_id=user_id,
        notification_type=f"sla_{sla_status}",
        title=title,
        message=message,
        entity_type=workflow_type,
        entity_id=record_id,
    )


def get_sla_status_for_org(
    org_id: UUID, session: Session | None = None
) -> list[dict[str, Any]]:
    """
    Get SLA status dashboard data for an organization.

    Returns all in-progress workflow records with their SLA status.

    `session` is explicit because the implicit context session is not bound on
    this path: the sibling functions here are driven by Celery, which binds it
    via get_session(), but this one is called from a request handler and raised
    RuntimeError on every call. Callers on a request path must pass their own.
    """
    session = session or current_session()
    today = date.today()

    policies = session.execute(
        select(SLAPolicy).where(
            SLAPolicy.organization_id == org_id,
            SLAPolicy.enabled == True,
        )
    ).scalars().all()

    if not policies:
        return []

    status_records = []

    for policy in policies:
        config = WORKFLOW_CONFIG.get(policy.workflow_type)
        if not config:
            continue

        model, _ = config
        query = select(model).where(model.organization_id == org_id)

        if hasattr(model, "status"):
            query = query.where(model.status.notin_(TERMINAL_STATUSES))

        records = session.execute(query).scalars().all()

        for record in records:
            sla_status = evaluate_record(policy, record, today)
            record_id = _get_record_id(record, policy.workflow_type)
            days = get_days_elapsed(record, policy.workflow_type)

            status_records.append({
                "policy_id": str(policy.policy_id),
                "policy_name": policy.name,
                "workflow_type": policy.workflow_type,
                "record_id": str(record_id) if record_id else None,
                "record_label": _get_record_label(record, policy.workflow_type),
                "status": getattr(record, "status", None),
                "sla_status": sla_status,
                "days_elapsed": days,
                "warning_days": policy.warning_days,
                "deadline_days": policy.deadline_days,
                "critical_days": policy.critical_days,
                "assigned_to_user_id": str(record.assigned_to_user_id)
                    if hasattr(record, "assigned_to_user_id") and record.assigned_to_user_id
                    else None,
            })

    return status_records
