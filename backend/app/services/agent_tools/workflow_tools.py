"""
Workflow and operational tools for the agent.

Helps staff track workflow status, find overdue items, and stay on top
of operational tasks across the collection.
"""

import logging
from datetime import datetime, timezone

from sqlalchemy import or_

from app.services.agent_tools import AgentContext, ToolRegistry

logger = logging.getLogger(__name__)


def check_workflow_status(args: dict, ctx: AgentContext) -> dict:
    """Check the workflow status of a specific record and what's needed next."""
    from uuid import UUID as _UUID
    from app.models.procedures import LoanIn, LoanOut, Acquisition, ObjectEntry, ObjectExit
    from app.models.objects import CollectionObject, ConditionReport

    record_type = args.get("record_type", "").strip().lower()
    record_id = args.get("record_id", "").strip()

    if not record_type or not record_id:
        return {"error": "record_type and record_id are required"}

    try:
        rid = _UUID(record_id)
    except (ValueError, TypeError):
        return {"error": "Invalid record_id format"}

    db = ctx.db_session
    org_id = ctx.organization_id

    MODEL_MAP = {
        "loan_in": (LoanIn, "loan_in_id"),
        "loan_out": (LoanOut, "loan_out_id"),
        "acquisition": (Acquisition, "acquisition_id"),
        "object_entry": (ObjectEntry, "entry_id"),
        "object_exit": (ObjectExit, "exit_id"),
        "collection_object": (CollectionObject, "object_id"),
        "condition_report": (ConditionReport, "report_id"),
    }

    if record_type not in MODEL_MAP:
        return {"error": f"Unknown record_type: {record_type}. Supported: {', '.join(MODEL_MAP.keys())}"}

    model_cls, id_field = MODEL_MAP[record_type]
    record = db.query(model_cls).filter(
        getattr(model_cls, id_field) == rid,
        model_cls.organization_id == org_id,
    ).first()

    if not record:
        return {"error": f"{record_type} not found"}

    result = {
        "record_type": record_type,
        "record_id": record_id,
        "status": getattr(record, "status", getattr(record, "object_status", None)),
    }

    # Add type-specific workflow details
    if record_type in ("loan_in", "loan_out"):
        result["loan_number"] = record.loan_number
        result["start_date"] = record.loan_start_date.isoformat() if record.loan_start_date else None
        result["end_date"] = record.loan_end_date.isoformat() if record.loan_end_date else None
        if hasattr(record, "facility_report_sent"):
            result["facility_report_sent"] = record.facility_report_sent
            result["facility_report_approved"] = record.facility_report_approved
        if hasattr(record, "condition_report_in_id"):
            result["has_incoming_condition_report"] = record.condition_report_in_id is not None
        if hasattr(record, "condition_report_out_id"):
            result["has_outgoing_condition_report"] = record.condition_report_out_id is not None

    elif record_type == "collection_object":
        result["object_number"] = record.object_number
        # condition_rating derived from latest condition report
        reports = getattr(record, "condition_reports", None)
        result["condition_rating"] = reports[0].overall_condition if reports else None
        result["has_location"] = record.current_location_id is not None
        result["is_discoverable"] = record.is_discoverable

    elif record_type == "condition_report":
        result["report_number"] = record.report_number
        result["report_type"] = record.report_type
        result["overall_condition"] = record.overall_condition
        result["conservation_needed"] = record.conservation_needed

    return result


def find_overdue_items(args: dict, ctx: AgentContext) -> dict:
    """Find overdue loans, pending condition reports, and objects in transit too long."""
    from app.models.procedures import LoanIn, LoanOut
    from app.models.locations import Movement
    from app.models.objects import CollectionObject

    db = ctx.db_session
    org_id = ctx.organization_id
    now = datetime.now(timezone.utc).date()

    results = {}

    # Overdue loans in (past end date, not returned)
    overdue_in = (
        db.query(LoanIn.loan_in_id, LoanIn.loan_number, LoanIn.loan_end_date,
                 LoanIn.lender_name, LoanIn.status)
        .filter(
            LoanIn.organization_id == org_id,
            LoanIn.loan_end_date < now,
            LoanIn.status.in_(["received", "on_loan"]),
        )
        .order_by(LoanIn.loan_end_date.asc())
        .limit(20)
        .all()
    )
    results["overdue_loans_in"] = [
        {
            "loan_id": str(l.loan_in_id), "number": l.loan_number,
            "end_date": l.loan_end_date.isoformat(), "lender": l.lender_name,
            "days_overdue": (now - l.loan_end_date).days,
        }
        for l in overdue_in
    ]

    # Overdue loans out
    overdue_out = (
        db.query(LoanOut.loan_out_id, LoanOut.loan_number, LoanOut.loan_end_date,
                 LoanOut.borrower_name, LoanOut.status)
        .filter(
            LoanOut.organization_id == org_id,
            LoanOut.loan_end_date < now,
            LoanOut.status.in_(["dispatched", "on_loan"]),
        )
        .order_by(LoanOut.loan_end_date.asc())
        .limit(20)
        .all()
    )
    results["overdue_loans_out"] = [
        {
            "loan_id": str(l.loan_out_id), "number": l.loan_number,
            "end_date": l.loan_end_date.isoformat(), "borrower": l.borrower_name,
            "days_overdue": (now - l.loan_end_date).days,
        }
        for l in overdue_out
    ]

    # Objects in transit (movement status = in_transit for more than 7 days)
    from datetime import timedelta
    stale_cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    in_transit = (
        db.query(Movement.movement_id, Movement.object_id, Movement.movement_date,
                 Movement.reason)
        .filter(
            Movement.organization_id == org_id,
            Movement.status == "in_transit",
            Movement.created_at < stale_cutoff,
        )
        .order_by(Movement.created_at.asc())
        .limit(20)
        .all()
    )
    results["stale_in_transit"] = [
        {
            "movement_id": str(m.movement_id), "object_id": str(m.object_id),
            "reason": m.reason,
            "date": m.movement_date.isoformat() if m.movement_date else None,
        }
        for m in in_transit
    ]

    # Objects due for condition check
    overdue_checks = (
        db.query(CollectionObject.object_id, CollectionObject.object_number,
                 CollectionObject.object_name, CollectionObject.next_condition_check_date)
        .filter(
            CollectionObject.organization_id == org_id,
            CollectionObject.next_condition_check_date < now,
        )
        .order_by(CollectionObject.next_condition_check_date.asc())
        .limit(20)
        .all()
    )
    results["overdue_condition_checks"] = [
        {
            "object_id": str(o.object_id), "number": o.object_number,
            "name": o.object_name,
            "due_date": o.next_condition_check_date.isoformat(),
            "days_overdue": (now - o.next_condition_check_date).days,
        }
        for o in overdue_checks
    ]

    # Summary counts
    results["summary"] = {
        "overdue_loans_in": len(results["overdue_loans_in"]),
        "overdue_loans_out": len(results["overdue_loans_out"]),
        "stale_in_transit": len(results["stale_in_transit"]),
        "overdue_condition_checks": len(results["overdue_condition_checks"]),
    }

    return results


def register_workflow_tools(registry: ToolRegistry) -> None:
    """Register workflow tools."""
    registry.register(
        name="check_workflow_status",
        description=(
            "Check the workflow status of a specific record — what stage it's at, "
            "what's been completed, and what's still needed. Works with loans, "
            "acquisitions, object entries/exits, collection objects, and condition "
            "reports. Use this when someone asks 'what's blocking this?' or 'what "
            "do I need to do next?'"
        ),
        parameters={
            "type": "object",
            "properties": {
                "record_type": {
                    "type": "string",
                    "description": "Type of record.",
                    "enum": ["loan_in", "loan_out", "acquisition", "object_entry",
                             "object_exit", "collection_object", "condition_report"],
                },
                "record_id": {
                    "type": "string",
                    "description": "UUID of the record.",
                },
            },
            "required": ["record_type", "record_id"],
        },
        handler=check_workflow_status,
        personas=["staff"],
    )

    registry.register(
        name="find_overdue_items",
        description=(
            "Find overdue and at-risk items across the collection — loans past "
            "their end date, objects stuck in transit, and objects overdue for "
            "condition checks. Use this for operational awareness and when someone "
            "asks 'what's overdue?' or 'what needs attention?'"
        ),
        parameters={
            "type": "object",
            "properties": {},
        },
        handler=find_overdue_items,
        personas=["staff"],
    )
