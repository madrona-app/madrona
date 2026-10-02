"""
SLA Policy and Status API endpoints (FastAPI).

CRUD for SLA policies and dashboard/audit endpoints for SLA status and events.
Migrated from app/api/sla.py — 6 routes.
"""
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.models import SLAEvent, SLAPolicy
from app.permissions import Permission
from app.services.sla_service import WORKFLOW_CONFIG, get_sla_status_for_org
from app.fastapi_app.schemas.common import DeletedResponse
from app.fastapi_app.schemas.sla import (
    SLAPolicyOut,
    SLAPolicyListResponse,
    SLAStatusResponse,
    SLAEventListResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["sla"])

VALID_WORKFLOW_TYPES = set(WORKFLOW_CONFIG.keys())


# ============================================================================
# SERIALIZERS
# ============================================================================


def _serialize_policy(policy: SLAPolicy) -> dict:
    return {
        "policy_id": str(policy.policy_id),
        "organization_id": str(policy.organization_id),
        "workflow_type": policy.workflow_type,
        "name": policy.name,
        "warning_days": policy.warning_days,
        "deadline_days": policy.deadline_days,
        "critical_days": policy.critical_days,
        "escalate_to_role": policy.escalate_to_role,
        "notify_assignee": policy.notify_assignee,
        "enabled": policy.enabled,
        "created_at": policy.created_at.isoformat() if policy.created_at else None,
        "updated_at": policy.updated_at.isoformat() if policy.updated_at else None,
    }


def _serialize_event(event: SLAEvent) -> dict:
    return {
        "event_id": str(event.event_id),
        "policy_id": str(event.policy_id),
        "workflow_type": event.workflow_type,
        "record_id": str(event.record_id),
        "event_type": event.event_type,
        "days_elapsed": event.days_elapsed,
        "notified_user_ids": event.notified_user_ids,
        "triggered_at": event.triggered_at.isoformat() if event.triggered_at else None,
    }


# ============================================================================
# POLICY CRUD
# ============================================================================


@router.get("/api/organizations/{org_id}/sla/policies", response_model=SLAPolicyListResponse, summary="List policies")
def list_policies(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    """List policies."""
    policies = db.execute(
        select(SLAPolicy)
        .where(SLAPolicy.organization_id == org_id)
        .order_by(SLAPolicy.workflow_type, SLAPolicy.name)
    ).scalars().all()

    return {"policies": [_serialize_policy(p) for p in policies]}


@router.post("/api/organizations/{org_id}/sla/policies", response_model=SLAPolicyOut, status_code=201, summary="Create policy")
def create_policy(
    org_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    """Create policy."""
    name = body.get("name")
    workflow_type = body.get("workflow_type")
    warning_days = body.get("warning_days")
    deadline_days = body.get("deadline_days")
    critical_days = body.get("critical_days")

    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    if not workflow_type:
        raise HTTPException(status_code=400, detail="workflow_type is required")
    if workflow_type not in VALID_WORKFLOW_TYPES:
        raise HTTPException(status_code=400, detail=f"workflow_type must be one of: {', '.join(sorted(VALID_WORKFLOW_TYPES))}")
    if warning_days is None or deadline_days is None or critical_days is None:
        raise HTTPException(status_code=400, detail="warning_days, deadline_days, and critical_days are all required")
    if not (0 < warning_days < deadline_days < critical_days):
        raise HTTPException(status_code=400, detail="Days must satisfy: 0 < warning_days < deadline_days < critical_days")

    policy = SLAPolicy(
        organization_id=org_id,
        workflow_type=workflow_type,
        name=name,
        warning_days=warning_days,
        deadline_days=deadline_days,
        critical_days=critical_days,
        escalate_to_role=body.get("escalate_to_role"),
        notify_assignee=body.get("notify_assignee", True),
        enabled=body.get("enabled", True),
    )
    db.add(policy)
    db.commit()
    db.refresh(policy)

    return _serialize_policy(policy)


@router.put("/api/organizations/{org_id}/sla/policies/{policy_id}", response_model=SLAPolicyOut, summary="Update policy")
def update_policy(
    org_id: UUID,
    policy_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    """Update policy."""
    policy = db.execute(
        select(SLAPolicy).where(
            SLAPolicy.policy_id == policy_id,
            SLAPolicy.organization_id == org_id,
        )
    ).scalar_one_or_none()

    if not policy:
        raise HTTPException(status_code=404, detail="SLA policy not found")

    if "name" in body:
        policy.name = body["name"]
    if "workflow_type" in body:
        if body["workflow_type"] not in VALID_WORKFLOW_TYPES:
            raise HTTPException(status_code=400, detail=f"workflow_type must be one of: {', '.join(sorted(VALID_WORKFLOW_TYPES))}")
        policy.workflow_type = body["workflow_type"]
    if "warning_days" in body:
        policy.warning_days = body["warning_days"]
    if "deadline_days" in body:
        policy.deadline_days = body["deadline_days"]
    if "critical_days" in body:
        policy.critical_days = body["critical_days"]
    if "escalate_to_role" in body:
        policy.escalate_to_role = body["escalate_to_role"]
    if "notify_assignee" in body:
        policy.notify_assignee = body["notify_assignee"]
    if "enabled" in body:
        policy.enabled = body["enabled"]

    if not (0 < policy.warning_days < policy.deadline_days < policy.critical_days):
        raise HTTPException(status_code=400, detail="Days must satisfy: 0 < warning_days < deadline_days < critical_days")

    db.commit()
    db.refresh(policy)

    return _serialize_policy(policy)


@router.delete("/api/organizations/{org_id}/sla/policies/{policy_id}", response_model=DeletedResponse, summary="Delete policy")
def delete_policy(
    org_id: UUID,
    policy_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    """Delete policy."""
    policy = db.execute(
        select(SLAPolicy).where(
            SLAPolicy.policy_id == policy_id,
            SLAPolicy.organization_id == org_id,
        )
    ).scalar_one_or_none()

    if not policy:
        raise HTTPException(status_code=404, detail="SLA policy not found")

    db.delete(policy)
    db.commit()

    return {"deleted": True}


# ============================================================================
# STATUS & EVENTS
# ============================================================================


@router.get("/api/organizations/{org_id}/sla/status", response_model=SLAStatusResponse, summary="Get sla status")
def get_sla_status(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get sla status."""
    records = get_sla_status_for_org(org_id, session=db)

    summary = {"ok": 0, "warning": 0, "breach": 0, "critical": 0}
    for r in records:
        status = r.get("sla_status", "ok")
        if status in summary:
            summary[status] += 1

    return {
        "records": records,
        "summary": summary,
        "total": len(records),
    }


@router.get("/api/organizations/{org_id}/sla/events", response_model=SLAEventListResponse, summary="List sla events")
def list_sla_events(
    org_id: UUID,
    workflow_type: str = Query(None),
    event_type: str = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """List sla events."""
    query = (
        select(SLAEvent)
        .where(SLAEvent.organization_id == org_id)
        .order_by(SLAEvent.triggered_at.desc())
    )

    if workflow_type:
        query = query.where(SLAEvent.workflow_type == workflow_type)
    if event_type:
        query = query.where(SLAEvent.event_type == event_type)

    # Counted before the window is applied. This endpoint took limit/offset but
    # reported no total, so a caller could page through it without ever knowing
    # how far it went; every sibling list endpoint returns one.
    total = db.execute(select(func.count()).select_from(query.subquery())).scalar() or 0

    query = query.offset(offset).limit(limit)

    events = db.execute(query).scalars().all()

    return {
        "items": [_serialize_event(e) for e in events],
        "total": total,
        "limit": limit,
        "offset": offset,
    }
