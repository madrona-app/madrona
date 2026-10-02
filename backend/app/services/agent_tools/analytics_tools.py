"""
Collection analytics tools for the agent.

Provides aggregate statistics and recent activity across the collection —
things that search_collection can't answer because they require counting,
grouping, or time-range queries.
"""

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, case, select, and_

from app.services.agent_tools import AgentContext, ToolRegistry

logger = logging.getLogger(__name__)


def collection_statistics(args: dict, ctx: AgentContext) -> dict:
    """Get aggregate statistics about the collection."""
    from app.models.objects import CollectionObject
    from app.models.departments import Department
    from app.models.media import Media

    db = ctx.db_session
    org_id = ctx.organization_id

    # Total objects
    total = db.query(func.count(CollectionObject.object_id)).filter(
        CollectionObject.organization_id == org_id,
    ).scalar() or 0

    # By status
    status_counts = dict(
        db.query(CollectionObject.object_status, func.count())
        .filter(CollectionObject.organization_id == org_id)
        .group_by(CollectionObject.object_status)
        .all()
    )

    # By department
    dept_counts = (
        db.query(Department.name, func.count(CollectionObject.object_id))
        .join(CollectionObject, and_(
            CollectionObject.department_id == Department.department_id,
            CollectionObject.organization_id == org_id,
        ))
        .filter(Department.organization_id == org_id)
        .group_by(Department.name)
        .order_by(func.count(CollectionObject.object_id).desc())
        .limit(20)
        .all()
    )

    # Discoverable (public) count
    discoverable = db.query(func.count()).filter(
        CollectionObject.organization_id == org_id,
        CollectionObject.is_discoverable == True,  # noqa: E712
    ).scalar() or 0

    # Media count
    media_count = db.query(func.count(Media.media_id)).filter(
        Media.organization_id == org_id,
    ).scalar() or 0

    # Condition breakdown (derived from latest condition report per object)
    from app.models.objects import ConditionReport
    latest_report = (
        db.query(
            ConditionReport.object_id,
            func.max(ConditionReport.report_date).label("max_date"),
        )
        .filter(
            ConditionReport.organization_id == org_id,
            ConditionReport.overall_condition.isnot(None),
        )
        .group_by(ConditionReport.object_id)
        .subquery()
    )
    condition_counts = dict(
        db.query(ConditionReport.overall_condition, func.count())
        .join(
            latest_report,
            and_(
                ConditionReport.object_id == latest_report.c.object_id,
                ConditionReport.report_date == latest_report.c.max_date,
            ),
        )
        .group_by(ConditionReport.overall_condition)
        .all()
    )

    return {
        "total_objects": total,
        "by_status": status_counts,
        "by_department": [{"department": name, "count": count} for name, count in dept_counts],
        "discoverable": discoverable,
        "media_assets": media_count,
        "by_condition": condition_counts,
    }


def recent_activity(args: dict, ctx: AgentContext) -> dict:
    """Get recent activity across the collection."""
    from app.models.objects import CollectionObject, ConditionReport
    from app.models.procedures import LoanIn, LoanOut, Acquisition
    from app.models.locations import Movement

    db = ctx.db_session
    org_id = ctx.organization_id
    days = min(args.get("days", 7), 90)
    since = datetime.now(timezone.utc) - timedelta(days=days)

    # Recent objects added
    new_objects = (
        db.query(CollectionObject.object_id, CollectionObject.object_name, CollectionObject.object_number)
        .filter(
            CollectionObject.organization_id == org_id,
            CollectionObject.created_at >= since,
        )
        .order_by(CollectionObject.created_at.desc())
        .limit(10)
        .all()
    )

    # Recent movements
    movements = (
        db.query(Movement)
        .filter(
            Movement.organization_id == org_id,
            Movement.created_at >= since,
        )
        .order_by(Movement.created_at.desc())
        .limit(10)
        .all()
    )

    # Active loans
    active_loans_in = db.query(func.count()).filter(
        LoanIn.organization_id == org_id,
        LoanIn.status.in_(["received", "on_loan"]),
    ).scalar() or 0

    active_loans_out = db.query(func.count()).filter(
        LoanOut.organization_id == org_id,
        LoanOut.status.in_(["dispatched", "on_loan"]),
    ).scalar() or 0

    # Recent condition reports
    recent_reports = (
        db.query(ConditionReport.report_id, ConditionReport.report_number,
                 ConditionReport.report_type, ConditionReport.overall_condition,
                 ConditionReport.report_date)
        .filter(
            ConditionReport.organization_id == org_id,
            ConditionReport.created_at >= since,
        )
        .order_by(ConditionReport.created_at.desc())
        .limit(10)
        .all()
    )

    # Recent acquisitions
    recent_acquisitions = db.query(func.count()).filter(
        Acquisition.organization_id == org_id,
        Acquisition.created_at >= since,
    ).scalar() or 0

    return {
        "period_days": days,
        "new_objects": [
            {"object_id": str(o.object_id), "name": o.object_name, "number": o.object_number}
            for o in new_objects
        ],
        "recent_movements": [
            {
                "movement_id": str(m.movement_id),
                "object_id": str(m.object_id),
                "reason": m.reason,
                "status": m.status,
                "date": m.movement_date.isoformat() if m.movement_date else None,
            }
            for m in movements
        ],
        "active_loans_in": active_loans_in,
        "active_loans_out": active_loans_out,
        "recent_condition_reports": [
            {
                "report_id": str(r.report_id), "number": r.report_number,
                "type": r.report_type, "condition": r.overall_condition,
                "date": r.report_date.isoformat() if r.report_date else None,
            }
            for r in recent_reports
        ],
        "recent_acquisitions": recent_acquisitions,
    }


def register_analytics_tools(registry: ToolRegistry) -> None:
    """Register collection analytics tools."""
    registry.register(
        name="collection_statistics",
        description=(
            "Get aggregate statistics about the collection — total objects, "
            "breakdown by department, status, condition rating, number of media "
            "assets, and how many objects are publicly discoverable. Use this for "
            "'how many' and 'what percentage' questions about the collection."
        ),
        parameters={
            "type": "object",
            "properties": {},
        },
        handler=collection_statistics,
        personas=["staff"],
    )

    registry.register(
        name="recent_activity",
        description=(
            "Get recent activity across the collection — newly added objects, "
            "movements, condition reports, acquisitions, and active loan counts. "
            "Use this for 'what happened this week' or 'what's been added recently' "
            "questions."
        ),
        parameters={
            "type": "object",
            "properties": {
                "days": {
                    "type": "integer",
                    "description": "Look back N days (default 7, max 90).",
                },
            },
        },
        handler=recent_activity,
        personas=["staff"],
    )
