"""
Work Tasks API — FastAPI router.

4 routes for unified workflow task views:
- List aggregated tasks (8 workflow models)
- Task count for badges
- Assign task to user
- List assignable users
"""

import logging
from datetime import datetime, date
from typing import Optional, Dict, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload, selectinload

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.fastapi_app.schemas.misc import AssignTaskBody
from app.fastapi_app.schemas.tasks_work import (
    WorkTaskListResponse,
    TaskCountResponse,
    AssignTaskResponse,
    AssignableUsersResponse,
)
from app.permissions import Permission
from app.models import (
    ConditionReport,
    LoanIn,
    LoanOut,
    ConservationTreatment,
    ObjectEntry,
    ObjectExit,
    Movement,
    UseRequest,
    IncidentReport,
    CollectionObject,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["work-tasks"])


# =============================================================================
# Serializer helpers
# =============================================================================


def _get_object_info(obj: Optional[CollectionObject]) -> Dict[str, Any]:
    """Extract minimal object info for task display."""
    if not obj:
        return {}

    title = None
    if obj.title_links and len(obj.title_links) > 0:
        preferred = next((t for t in obj.title_links if t.is_preferred), None)
        title = preferred.title if preferred else obj.title_links[0].title

    return {
        "object_id": str(obj.object_id),
        "accession_number": obj.object_number,
        "object_title": title or obj.object_name,
    }


def _get_assignee_info(record) -> Dict[str, Any]:
    """Extract assignee information from a record."""
    if not hasattr(record, 'assigned_to_user_id') or not record.assigned_to_user_id:
        return {"assigned_to_user_id": None, "assigned_to_name": None}

    assignee_name = None
    if hasattr(record, 'assigned_to') and record.assigned_to:
        user = record.assigned_to
        assignee_name = user.display_name or user.email

    return {
        "assigned_to_user_id": str(record.assigned_to_user_id),
        "assigned_to_name": assignee_name,
    }


def _condition_report_to_task(cr: ConditionReport, org_id: UUID) -> Dict[str, Any]:
    obj_info = _get_object_info(cr.collection_object) if hasattr(cr, 'collection_object') and cr.collection_object else {}
    assignee_info = _get_assignee_info(cr)

    priority = "normal"
    if cr.status == 'completed':
        priority = "high"

    return {
        "id": str(cr.report_id),
        "type": "review",
        "title": "Review Condition Report",
        "record_type": "condition_report",
        "record_id": str(cr.report_id),
        "record_number": cr.report_number,
        "priority": priority,
        "due_date": None,
        "assigned_at": cr.created_at.isoformat() if cr.created_at else None,
        "status": cr.status,
        **obj_info,
        **assignee_info,
    }


def _loan_in_to_task(loan: LoanIn, org_id: UUID) -> Dict[str, Any]:
    assignee_info = _get_assignee_info(loan)
    priority = "normal"
    title = "Review Loan In"

    if loan.return_date:
        days_until = (loan.return_date - date.today()).days
        if days_until <= 7:
            priority = "urgent"
            title = "Loan Return Due Soon"
        elif days_until <= 30:
            priority = "high"

    if loan.status in ('pending_approval',):
        priority = "high" if priority != "urgent" else "urgent"
        title = "Approve Loan In"
    elif loan.status == 'approved':
        title = "Process Loan Arrival"

    return {
        "id": str(loan.loan_in_id),
        "type": "action_required",
        "title": title,
        "record_type": "loan_in",
        "record_id": str(loan.loan_in_id),
        "record_number": loan.loan_number,
        "priority": priority,
        "due_date": loan.return_date.isoformat() if loan.return_date else None,
        "assigned_at": loan.created_at.isoformat() if loan.created_at else None,
        "status": loan.status,
        "object_count": len(loan.objects) if hasattr(loan, 'objects') and loan.objects else 0,
        **assignee_info,
    }


def _loan_out_to_task(loan: LoanOut, org_id: UUID) -> Dict[str, Any]:
    assignee_info = _get_assignee_info(loan)
    priority = "normal"
    title = "Review Loan Out"

    if loan.return_date:
        days_until = (loan.return_date - date.today()).days
        if days_until <= 7:
            priority = "urgent"
            title = "Loan Return Overdue" if days_until < 0 else "Loan Return Due Soon"
        elif days_until <= 30:
            priority = "high"

    if loan.status == 'pending_approval':
        priority = "high" if priority != "urgent" else "urgent"
        title = "Approve Loan Out"
    elif loan.status == 'approved':
        title = "Prepare Loan for Dispatch"

    return {
        "id": str(loan.loan_out_id),
        "type": "action_required",
        "title": title,
        "record_type": "loan_out",
        "record_id": str(loan.loan_out_id),
        "record_number": loan.loan_number,
        "priority": priority,
        "due_date": loan.return_date.isoformat() if loan.return_date else None,
        "assigned_at": loan.created_at.isoformat() if loan.created_at else None,
        "status": loan.status,
        "object_count": len(loan.objects) if hasattr(loan, 'objects') and loan.objects else 0,
        **assignee_info,
    }


def _conservation_to_task(cons: ConservationTreatment, org_id: UUID) -> Dict[str, Any]:
    obj_info = _get_object_info(cons.collection_object) if hasattr(cons, 'collection_object') and cons.collection_object else {}
    assignee_info = _get_assignee_info(cons)

    priority = "normal"
    title = "Conservation Treatment"

    if cons.status == 'in_progress':
        title = "Continue Conservation Treatment"
    elif cons.status == 'pending_approval':
        title = "Review Conservation Proposal"
        priority = "high"
    elif cons.status == 'approved':
        title = "Begin Approved Treatment"
        if cons.start_date:
            days_until = (cons.start_date - date.today()).days
            if days_until <= 3:
                priority = "high"

    return {
        "id": str(cons.treatment_id),
        "type": "action_required",
        "title": title,
        "record_type": "conservation",
        "record_id": str(cons.treatment_id),
        "record_number": cons.treatment_number,
        "priority": priority,
        "due_date": cons.end_date.isoformat() if cons.end_date else None,
        "assigned_at": cons.created_at.isoformat() if cons.created_at else None,
        "status": cons.status,
        **obj_info,
        **assignee_info,
    }


def _object_entry_to_task(entry: ObjectEntry, org_id: UUID) -> Dict[str, Any]:
    assignee_info = _get_assignee_info(entry)
    priority = "normal"
    title = "Process Object Entry"

    if entry.status == 'pending':
        title = "Review Object Entry"
        priority = "high"
    elif entry.status == 'received':
        title = "Process Received Objects"
    elif entry.status == 'processing':
        title = "Complete Entry Processing"

    return {
        "id": str(entry.entry_id),
        "type": "action_required",
        "title": title,
        "record_type": "object_entry",
        "record_id": str(entry.entry_id),
        "record_number": entry.entry_number,
        "priority": priority,
        "due_date": entry.expected_return_date.isoformat() if entry.expected_return_date else None,
        "assigned_at": entry.created_at.isoformat() if entry.created_at else None,
        "status": entry.status,
        "object_count": len(entry.items) if hasattr(entry, 'items') and entry.items else 0,
        **assignee_info,
    }


def _movement_to_task(mov: Movement, org_id: UUID) -> Dict[str, Any]:
    obj_info = _get_object_info(mov.object) if hasattr(mov, 'object') and mov.object else {}
    assignee_info = _get_assignee_info(mov)

    priority = "normal"
    title = "Complete Movement"

    if mov.status == 'in_transit':
        title = "Complete Movement in Transit"
    elif mov.status == 'pending':
        if hasattr(mov, 'movement_date') and mov.movement_date:
            planned_date = mov.movement_date.date() if isinstance(mov.movement_date, datetime) else mov.movement_date
            days_until = (planned_date - date.today()).days
            if days_until <= 1:
                priority = "urgent"
                title = "Movement Due Today" if days_until == 0 else "Movement Due Tomorrow"
            elif days_until <= 7:
                priority = "high"
                title = "Upcoming Movement"

    return {
        "id": str(mov.movement_id),
        "type": "action_required",
        "title": title,
        "record_type": "movement",
        "record_id": str(mov.movement_id),
        "record_number": mov.movement_reference_number,
        "priority": priority,
        "due_date": mov.movement_date.isoformat() if mov.movement_date else None,
        "assigned_at": mov.created_at.isoformat() if mov.created_at else None,
        "status": mov.status,
        **obj_info,
        **assignee_info,
    }


def _use_request_to_task(req: UseRequest, org_id: UUID) -> Dict[str, Any]:
    assignee_info = _get_assignee_info(req)
    priority = "normal"
    title = "Review Use Request"

    if req.status == 'submitted':
        priority = "high"
    elif req.status == 'under_review':
        title = "Complete Use Request Review"
    elif req.status == 'approved':
        title = "Fulfill Approved Use Request"

    due_date = None
    if hasattr(req, 'access_date_start') and req.access_date_start:
        due_date = req.access_date_start
        days_until = (req.access_date_start - date.today()).days
        if days_until <= 3:
            priority = "urgent"
        elif days_until <= 14:
            priority = "high" if priority != "urgent" else "urgent"

    return {
        "id": str(req.request_id),
        "type": "action_required",
        "title": title,
        "record_type": "use_request",
        "record_id": str(req.request_id),
        "record_number": req.request_number,
        "priority": priority,
        "due_date": due_date.isoformat() if due_date else None,
        "assigned_at": req.created_at.isoformat() if req.created_at else None,
        "status": req.status,
        **assignee_info,
    }


def _incident_to_task(inc: IncidentReport, org_id: UUID) -> Dict[str, Any]:
    assignee_info = _get_assignee_info(inc)
    priority = "high"
    title = "Review Incident Report"

    if inc.status == 'submitted':
        priority = "urgent"
        title = "Respond to Submitted Incident"
    elif inc.status == 'under_investigation':
        title = "Continue Incident Investigation"

    return {
        "id": str(inc.report_id),
        "type": "action_required",
        "title": title,
        "record_type": "incident",
        "record_id": str(inc.report_id),
        "record_number": inc.report_number,
        "priority": priority,
        "due_date": None,
        "assigned_at": inc.created_at.isoformat() if inc.created_at else None,
        "status": inc.status,
        **assignee_info,
    }


RECORD_TYPE_MAP = {
    "condition_report": (ConditionReport, "report_id"),
    "loan_in": (LoanIn, "loan_in_id"),
    "loan_out": (LoanOut, "loan_out_id"),
    "conservation": (ConservationTreatment, "treatment_id"),
    "object_entry": (ObjectEntry, "entry_id"),
    "object_exit": (ObjectExit, "exit_id"),
    "movement": (Movement, "movement_id"),
    "use_request": (UseRequest, "request_id"),
    "incident": (IncidentReport, "report_id"),
}


# =============================================================================
# Routes
# =============================================================================


@router.get("/api/organizations/{org_id}/work/tasks", response_model=WorkTaskListResponse, summary="Get my tasks")
def get_my_tasks(
    org_id: UUID,
    status: str = Query("pending"),
    priority: str | None = Query(None),
    record_type: str | None = Query(None),
    assigned_to: str | None = Query(None),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Aggregated workflow tasks across 8 models."""
    current_user_id = auth.user_id
    MAX_PER_QUERY = 500

    all_tasks = []

    # Condition reports
    try:
        cr_query = db.query(ConditionReport).options(
            joinedload(ConditionReport.collection_object),
            joinedload(ConditionReport.assigned_to),
        ).filter(
            ConditionReport.organization_id == org_id,
            ConditionReport.status.in_(['draft', 'completed']),
        ).limit(MAX_PER_QUERY)

        for cr in cr_query.all():
            all_tasks.append(_condition_report_to_task(cr, org_id))
    except Exception as e:
        logger.warning(f"Error fetching condition reports: {e}")

    # Loans in
    try:
        loan_in_query = db.query(LoanIn).options(
            joinedload(LoanIn.assigned_to),
        ).filter(
            LoanIn.organization_id == org_id,
            LoanIn.status.in_(['requested', 'pending_approval', 'approved', 'received', 'active']),
        ).limit(MAX_PER_QUERY)

        for loan in loan_in_query.all():
            if loan.status == 'active' and loan.return_date:
                days_until = (loan.return_date - date.today()).days
                if days_until > 60:
                    continue
            all_tasks.append(_loan_in_to_task(loan, org_id))
    except Exception as e:
        logger.warning(f"Error fetching loans in: {e}")

    # Loans out
    try:
        loan_out_query = db.query(LoanOut).options(
            joinedload(LoanOut.assigned_to),
        ).filter(
            LoanOut.organization_id == org_id,
            LoanOut.status.in_(['requested', 'pending_approval', 'approved', 'preparing', 'active']),
        ).limit(MAX_PER_QUERY)

        for loan in loan_out_query.all():
            if loan.status == 'active' and loan.return_date:
                days_until = (loan.return_date - date.today()).days
                if days_until > 60:
                    continue
            all_tasks.append(_loan_out_to_task(loan, org_id))
    except Exception as e:
        logger.warning(f"Error fetching loans out: {e}")

    # Conservation
    try:
        cons_query = db.query(ConservationTreatment).options(
            joinedload(ConservationTreatment.collection_object),
            joinedload(ConservationTreatment.assigned_to),
        ).filter(
            ConservationTreatment.organization_id == org_id,
            ConservationTreatment.status.in_(['proposed', 'pending_approval', 'approved', 'in_progress']),
        ).limit(MAX_PER_QUERY)

        for cons in cons_query.all():
            all_tasks.append(_conservation_to_task(cons, org_id))
    except Exception as e:
        logger.warning(f"Error fetching conservation: {e}")

    # Object entries
    try:
        entry_query = db.query(ObjectEntry).options(
            joinedload(ObjectEntry.assigned_to),
        ).filter(
            ObjectEntry.organization_id == org_id,
            ObjectEntry.status.in_(['pending', 'received', 'processing']),
        ).limit(MAX_PER_QUERY)

        for entry in entry_query.all():
            all_tasks.append(_object_entry_to_task(entry, org_id))
    except Exception as e:
        logger.warning(f"Error fetching object entries: {e}")

    # Movements
    try:
        mov_query = db.query(Movement).options(
            joinedload(Movement.object).selectinload(CollectionObject.title_links),
            joinedload(Movement.assigned_to),
        ).filter(
            Movement.organization_id == org_id,
            Movement.status.in_(['pending', 'in_transit']),
        ).limit(MAX_PER_QUERY)

        for mov in mov_query.all():
            all_tasks.append(_movement_to_task(mov, org_id))
    except Exception as e:
        logger.warning(f"Error fetching movements: {e}")

    # Use requests
    try:
        use_query = db.query(UseRequest).options(
            joinedload(UseRequest.assigned_to),
        ).filter(
            UseRequest.organization_id == org_id,
            UseRequest.status.in_(['submitted', 'under_review', 'approved']),
        ).limit(MAX_PER_QUERY)

        for req in use_query.all():
            all_tasks.append(_use_request_to_task(req, org_id))
    except Exception as e:
        logger.warning(f"Error fetching use requests: {e}")

    # Incidents
    try:
        incident_query = db.query(IncidentReport).options(
            joinedload(IncidentReport.assigned_to),
        ).filter(
            IncidentReport.organization_id == org_id,
            IncidentReport.status.in_(['submitted', 'under_investigation']),
        ).limit(MAX_PER_QUERY)

        for inc in incident_query.all():
            all_tasks.append(_incident_to_task(inc, org_id))
    except Exception as e:
        logger.warning(f"Error fetching incidents: {e}")

    # Apply filters
    if priority:
        all_tasks = [t for t in all_tasks if t["priority"] == priority]

    if record_type:
        all_tasks = [t for t in all_tasks if t["record_type"] == record_type]

    if assigned_to:
        if assigned_to == "me":
            all_tasks = [t for t in all_tasks if t.get("assigned_to_user_id") == str(current_user_id)]
        elif assigned_to == "unassigned":
            all_tasks = [t for t in all_tasks if t.get("assigned_to_user_id") is None]
        else:
            all_tasks = [t for t in all_tasks if t.get("assigned_to_user_id") == assigned_to]

    counts = {
        "urgent": sum(1 for t in all_tasks if t["priority"] == "urgent"),
        "high": sum(1 for t in all_tasks if t["priority"] == "high"),
        "normal": sum(1 for t in all_tasks if t["priority"] == "normal"),
        "low": sum(1 for t in all_tasks if t["priority"] == "low"),
    }

    priority_order = {"urgent": 0, "high": 1, "normal": 2, "low": 3}
    all_tasks.sort(key=lambda t: (
        priority_order.get(t["priority"], 2),
        t["due_date"] or "9999-12-31",
    ))

    total = len(all_tasks)
    paginated_tasks = all_tasks[offset:offset + limit]

    return {
        "items": paginated_tasks,
        "total": total,
        "counts": counts,
        "page": {
            "limit": limit,
            "offset": offset,
            "has_more": (offset + limit) < total,
        },
    }


@router.get("/api/organizations/{org_id}/work/tasks/count", response_model=TaskCountResponse, summary="Get task count")
def get_task_count(
    org_id: UUID,
    assigned_to: str | None = Query(None),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Task count for badge display."""
    current_user_id = auth.user_id

    filter_user_id = None
    filter_unassigned = False
    if assigned_to == "me":
        filter_user_id = current_user_id
    elif assigned_to == "unassigned":
        filter_unassigned = True
    elif assigned_to:
        filter_user_id = assigned_to

    def add_assignee_filter(query, model):
        if filter_user_id:
            return query.filter(model.assigned_to_user_id == filter_user_id)
        elif filter_unassigned:
            return query.filter(model.assigned_to_user_id.is_(None))
        return query

    count = 0
    urgent = 0

    try:
        cr_query = db.query(func.count(ConditionReport.report_id)).filter(
            ConditionReport.organization_id == org_id,
            ConditionReport.status.in_(['draft', 'completed']),
        )
        cr_query = add_assignee_filter(cr_query, ConditionReport)
        count += cr_query.scalar() or 0
    except Exception as e:
        logger.warning(f"Error counting condition reports: {e}")

    try:
        loan_in_query = db.query(func.count(LoanIn.loan_in_id)).filter(
            LoanIn.organization_id == org_id,
            LoanIn.status.in_(['requested', 'pending_approval', 'approved', 'received', 'active']),
        )
        loan_in_query = add_assignee_filter(loan_in_query, LoanIn)
        count += loan_in_query.scalar() or 0
    except Exception as e:
        logger.warning(f"Error counting loans in: {e}")

    try:
        loan_out_query = db.query(func.count(LoanOut.loan_out_id)).filter(
            LoanOut.organization_id == org_id,
            LoanOut.status.in_(['requested', 'pending_approval', 'approved', 'preparing', 'active']),
        )
        loan_out_query = add_assignee_filter(loan_out_query, LoanOut)
        count += loan_out_query.scalar() or 0
    except Exception as e:
        logger.warning(f"Error counting loans out: {e}")

    try:
        cons_query = db.query(func.count(ConservationTreatment.treatment_id)).filter(
            ConservationTreatment.organization_id == org_id,
            ConservationTreatment.status.in_(['proposed', 'pending_approval', 'approved', 'in_progress']),
        )
        cons_query = add_assignee_filter(cons_query, ConservationTreatment)
        count += cons_query.scalar() or 0
    except Exception as e:
        logger.warning(f"Error counting conservation treatments: {e}")

    try:
        entry_query = db.query(func.count(ObjectEntry.entry_id)).filter(
            ObjectEntry.organization_id == org_id,
            ObjectEntry.status.in_(['pending', 'received', 'processing']),
        )
        entry_query = add_assignee_filter(entry_query, ObjectEntry)
        count += entry_query.scalar() or 0
    except Exception as e:
        logger.warning(f"Error counting object entries: {e}")

    try:
        incident_query = db.query(func.count(IncidentReport.report_id)).filter(
            IncidentReport.organization_id == org_id,
            IncidentReport.status.in_(['submitted', 'under_investigation']),
        )
        incident_query = add_assignee_filter(incident_query, IncidentReport)
        count += incident_query.scalar() or 0

        urgent_query = db.query(func.count(IncidentReport.report_id)).filter(
            IncidentReport.organization_id == org_id,
            IncidentReport.status == 'submitted',
        )
        urgent_query = add_assignee_filter(urgent_query, IncidentReport)
        urgent += urgent_query.scalar() or 0
    except Exception as e:
        logger.warning(f"Error counting incidents: {e}")

    try:
        use_query = db.query(func.count(UseRequest.request_id)).filter(
            UseRequest.organization_id == org_id,
            UseRequest.status.in_(['submitted', 'under_review', 'approved']),
        )
        use_query = add_assignee_filter(use_query, UseRequest)
        count += use_query.scalar() or 0
    except Exception as e:
        logger.warning(f"Error counting use requests: {e}")

    try:
        mov_query = db.query(func.count(Movement.movement_id)).filter(
            Movement.organization_id == org_id,
            Movement.status.in_(['pending', 'in_transit']),
        )
        mov_query = add_assignee_filter(mov_query, Movement)
        count += mov_query.scalar() or 0
    except Exception as e:
        logger.warning(f"Error counting movements: {e}")

    return {"count": count, "urgent": urgent}


@router.patch("/api/organizations/{org_id}/work/tasks/{record_type}/{record_id}/assign", response_model=AssignTaskResponse, summary="Assign task")
def assign_task(
    org_id: UUID,
    record_type: str,
    record_id: UUID,
    body: AssignTaskBody,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Assign a task to a user."""
    if record_type not in RECORD_TYPE_MAP:
        raise HTTPException(status_code=400, detail=f"Invalid record type: {record_type}")

    model, pk_field = RECORD_TYPE_MAP[record_type]

    record = db.query(model).filter(
        getattr(model, pk_field) == record_id,
        model.organization_id == org_id,
    ).first()

    if not record:
        raise HTTPException(status_code=404, detail="Task not found")

    new_assignee_id = body.assigned_to_user_id

    if new_assignee_id:
        from app.models import User, OrganizationMembership

        user = db.query(User).join(
            OrganizationMembership,
            OrganizationMembership.user_id == User.user_id,
        ).filter(
            User.user_id == UUID(new_assignee_id),
            OrganizationMembership.organization_id == org_id,
            OrganizationMembership.status == 'active',
        ).first()

        if not user:
            raise HTTPException(status_code=400, detail="User not found or not in organization")

        record.assigned_to_user_id = UUID(new_assignee_id)
        assignee_name = user.display_name or user.email
    else:
        record.assigned_to_user_id = None
        assignee_name = None

    db.commit()

    return {
        "success": True,
        "assigned_to_user_id": str(record.assigned_to_user_id) if record.assigned_to_user_id else None,
        "assigned_to_name": assignee_name,
    }


@router.get("/api/organizations/{org_id}/work/assignees", response_model=AssignableUsersResponse, summary="Get assignable users")
def get_assignable_users(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """List users who can be assigned tasks in this organization."""
    from app.models import User, OrganizationMembership

    users = db.query(User).join(
        OrganizationMembership,
        OrganizationMembership.user_id == User.user_id,
    ).filter(
        OrganizationMembership.organization_id == org_id,
        OrganizationMembership.status == 'active',
    ).order_by(User.display_name, User.email).all()

    return {
        "users": [
            {
                "user_id": str(user.user_id),
                "name": user.display_name or user.email,
                "email": user.email,
            }
            for user in users
        ]
    }
