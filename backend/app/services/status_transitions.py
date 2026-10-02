"""
Status transition logic for procedure rollbacks.

Centralizes the field-clearing rules that were previously duplicated
across rollback router endpoints.  Each procedure's WorkflowDefinition
(from workflow_definitions.py) drives the logic.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.services.workflow_definitions import WorkflowDefinition


class InvalidTransitionError(ValueError):
    """Raised when a status transition is not allowed."""
    pass


def require_status(entity, allowed_statuses: list[str], action: str) -> None:
    """Raise InvalidTransitionError if entity.status is not in allowed_statuses.

    Args:
        entity: SQLAlchemy model instance with a ``status`` attribute.
        allowed_statuses: Statuses from which the action is permitted.
        action: Human-readable action name for the error message.
    """
    current = getattr(entity, "status", None)
    if current not in allowed_statuses:
        raise InvalidTransitionError(
            f"Cannot {action} from status '{current}'. "
            f"Allowed statuses: {', '.join(allowed_statuses)}"
        )


def rollback_entity(
    entity,
    target_status: str,
    workflow: WorkflowDefinition,
    user_id: UUID,
    *,
    session: Session | None = None,
    organization_id: UUID | None = None,
) -> str:
    """Roll an entity back to *target_status*, clearing milestone fields.

    When ``session`` and ``organization_id`` are provided, records an audit
    event capturing the old values of every field that is cleared or reset
    so procedure historical facts (authorizer, authorization_date, etc.) can
    be reconstructed from audit history.

    Args:
        entity: SQLAlchemy model instance with a ``status`` attribute.
        target_status: The status to roll back to.
        workflow: The workflow definition for this entity type.
        user_id: ID of the user performing the rollback.
        session: Optional DB session; required for audit logging.
        organization_id: Optional org id; required for audit logging.

    Returns:
        The previous (old) status string.

    Raises:
        InvalidTransitionError: If the target status is not valid.
    """
    if target_status not in workflow.valid_statuses:
        raise InvalidTransitionError(f"Invalid target status: {target_status}")

    target_index = (
        workflow.status_order.index(target_status)
        if target_status in workflow.status_order
        else -1
    )

    current_status = getattr(entity, "status", None)
    current_index = (
        workflow.status_order.index(current_status)
        if current_status in workflow.status_order
        else -1
    )

    # Rollback must move backward in the workflow. Refuse a "rollback" that
    # would actually advance status — callers should use the forward
    # transition endpoints for that, which run the procedure requirement
    # checks. Same status is treated as a no-op (clears nothing) instead of
    # an error so idempotent retries don't surface as 4xx.
    if current_index >= 0 and target_index >= 0 and target_index > current_index:
        raise InvalidTransitionError(
            f"Cannot rollback to {target_status}: not a previous status of {current_status}"
        )

    cleared_values: dict[str, Any] = {}

    for milestone in workflow.milestones:
        milestone_index = workflow.status_order.index(milestone.status)
        if current_index >= milestone_index and target_index < milestone_index:
            for field_name in milestone.fields_to_clear:
                cleared_values[field_name] = _coerce_for_audit(
                    getattr(entity, field_name, None)
                )
                setattr(entity, field_name, None)
            for field_name, default_value in milestone.fields_to_reset.items():
                cleared_values[field_name] = _coerce_for_audit(
                    getattr(entity, field_name, None)
                )
                setattr(entity, field_name, default_value)

    old_status = entity.status
    entity.status = target_status
    entity.updated_by = user_id
    entity.updated_at = datetime.now(timezone.utc)

    if session is not None and organization_id is not None:
        _record_rollback_audit(
            session=session,
            organization_id=organization_id,
            user_id=user_id,
            entity=entity,
            workflow=workflow,
            old_status=old_status,
            new_status=target_status,
            cleared_values=cleared_values,
        )

    return old_status


def _coerce_for_audit(value: Any) -> Any:
    """Convert SQLAlchemy column values to JSON-serializable forms."""
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, (datetime,)):
        return value.isoformat()
    return str(value)


def _record_rollback_audit(
    *,
    session: Session,
    organization_id: UUID,
    user_id: UUID,
    entity,
    workflow: WorkflowDefinition,
    old_status: str,
    new_status: str,
    cleared_values: dict[str, Any],
) -> None:
    """Record a rollback as an audit event with full cleared-field history."""
    from app.services.audit_service import log_audit_event

    entity_id = (
        getattr(entity, f"{workflow.entity_type}_id", None)
        or getattr(entity, "id", None)
    )

    log_audit_event(
        session=session,
        organization_id=organization_id,
        acting_user_id=user_id,
        action=f"{workflow.entity_type}.rolled_back",
        details={
            "entity_type": workflow.entity_type,
            "entity_id": str(entity_id) if entity_id else None,
            "old_status": old_status,
            "new_status": new_status,
            "cleared_values": cleared_values,
        },
    )
