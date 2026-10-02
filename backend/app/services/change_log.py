"""
Change log service for querying and managing change events.

Provides utilities for:
- Querying change events by organization, entity, run, date range
- Formatting change events for target connectors
- Computing change summaries
"""

import logging
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session
from sqlalchemy import desc

from app.models import ChangeEvent, FieldDiff

logger = logging.getLogger(__name__)


def get_change_events_for_run(
    session: Session,
    organization_id: UUID,
    run_id: UUID,
    change_types: list[str] | None = None,
) -> list[ChangeEvent]:
    """
    Get all change events for a specific run.
    
    Args:
        session: SQLAlchemy session
        organization_id: Organization identifier
        run_id: Run identifier
        change_types: Optional filter for specific change types
        
    Returns:
        List of ChangeEvent objects ordered by occurred_at
    """
    query = session.query(ChangeEvent).filter_by(
        organization_id=organization_id,
        run_id=run_id
    )
    
    if change_types:
        query = query.filter(ChangeEvent.change_type.in_(change_types))
    
    return query.order_by(ChangeEvent.occurred_at).all()


def get_change_events_for_entity(
    session: Session,
    organization_id: UUID,
    entity_key: str,
    limit: int = 100,
) -> list[ChangeEvent]:
    """
    Get change history for a specific entity.
    
    Args:
        session: SQLAlchemy session
        organization_id: Organization identifier
        entity_key: Entity key
        limit: Maximum number of events to return
        
    Returns:
        List of ChangeEvent objects ordered by occurred_at descending (newest first)
    """
    return (
        session.query(ChangeEvent)
        .filter_by(organization_id=organization_id, entity_key=entity_key)
        .order_by(desc(ChangeEvent.occurred_at))
        .limit(limit)
        .all()
    )


def get_recent_changes(
    session: Session,
    organization_id: UUID,
    since: datetime | None = None,
    limit: int = 100,
) -> list[ChangeEvent]:
    """
    Get recent change events across all entities.
    
    Args:
        session: SQLAlchemy session
        organization_id: Organization identifier
        since: Optional datetime to filter changes after
        limit: Maximum number of events to return
        
    Returns:
        List of ChangeEvent objects ordered by occurred_at descending
    """
    query = session.query(ChangeEvent).filter_by(organization_id=organization_id)
    
    if since:
        query = query.filter(ChangeEvent.occurred_at >= since)
    
    return query.order_by(desc(ChangeEvent.occurred_at)).limit(limit).all()


def format_change_event_for_target(
    change_event: ChangeEvent,
    include_field_diffs: bool = False,
) -> dict[str, Any]:
    """
    Format change event for target connector consumption.
    
    Args:
        change_event: ChangeEvent object
        include_field_diffs: Whether to include detailed field diffs
        
    Returns:
        Dictionary formatted for target connector publish_change_log()
    """
    formatted = {
        "change_id": str(change_event.change_id),
        "run_id": str(change_event.run_id),  # For idempotent republish
        "entity_key": change_event.entity_key,
        "change_type": change_event.change_type,
        "occurred_at": change_event.occurred_at.isoformat(),
        "changed_fields": change_event.changed_fields or [],
        "summary": change_event.summary or "",
    }
    
    if include_field_diffs and change_event.field_diffs:
        formatted["field_diffs"] = [
            {
                "field_name": diff.field_name,
                "old_value": diff.old_value,
                "new_value": diff.new_value,
            }
            for diff in change_event.field_diffs
        ]
    
    return formatted


def format_change_events_for_target(
    change_events: list[ChangeEvent],
    include_field_diffs: bool = False,
) -> list[dict[str, Any]]:
    """
    Format multiple change events for target connector.
    
    Args:
        change_events: List of ChangeEvent objects
        include_field_diffs: Whether to include detailed field diffs
        
    Returns:
        List of formatted dictionaries
    """
    return [
        format_change_event_for_target(event, include_field_diffs)
        for event in change_events
    ]


def compute_run_summary(
    session: Session,
    organization_id: UUID,
    run_id: UUID,
) -> dict[str, int]:
    """
    Compute summary statistics for a run's change events.
    
    Args:
        session: SQLAlchemy session
        organization_id: Organization identifier
        run_id: Run identifier
        
    Returns:
        Dictionary with counts by change_type
    """
    changes = get_change_events_for_run(session, organization_id, run_id)
    
    summary = {
        "created": 0,
        "updated": 0,
        "deleted": 0,
        "noop": 0,
        "skipped": 0,
        "error": 0,
        "total": len(changes),
    }
    
    for change in changes:
        if change.change_type in summary:
            summary[change.change_type] += 1
    
    return summary
