"""
Approval workflow API.

Endpoints for viewing pending approvals, approving/rejecting requests,
and managing approval rules per organization.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.fastapi_app.dependencies.auth import require_auth, require_permission, get_db, AuthContext
from app.permissions import Permission

logger = logging.getLogger(__name__)
router = APIRouter()


# =============================================================================
# Response Models
# =============================================================================

class ApprovalRequestOut(BaseModel):
    request_id: str
    rule_id: str
    entity_type: str
    entity_id: str
    requested_by: str
    requester_name: str | None = None
    requested_action: dict
    status: str
    reviewed_by: str | None = None
    reviewer_name: str | None = None
    review_note: str | None = None
    reviewed_at: str | None = None
    created_at: str
    approver_permission: str | None = None
    rule_description: str | None = None


class ApprovalRuleOut(BaseModel):
    rule_id: str
    entity_type: str
    trigger_action: str
    trigger_condition: dict | None = None
    approver_permission: str
    description: str | None = None
    is_active: bool


class ReviewRequest(BaseModel):
    decision: str  # 'approved' or 'rejected'
    note: str | None = None


class AssignRequest(BaseModel):
    assigned_to_user_id: UUID | None = None  # None clears the assignment


class UpdateRuleRequest(BaseModel):
    is_active: bool | None = None
    approver_permission: str | None = None
    description: str | None = None


# =============================================================================
# PENDING APPROVALS
# =============================================================================

@router.get("/api/organizations/{org_id}/approvals/count", summary="Get pending approval count")
def get_pending_approval_count(
    org_id: UUID,
    mine: bool = Query(False, description="Count only approvals awaiting this user"),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Pending-approval count for the nav badge. ``mine=true`` → 'awaiting you'."""
    from app.services.approval_service import get_pending_approvals, needs_review
    if mine:
        _, total = needs_review(org_id, auth.user_id, db, limit=0)
    else:
        _, total = get_pending_approvals(org_id, db, limit=0)
    return {"count": total}


@router.get("/api/organizations/{org_id}/approvals", summary="List approval requests")
def list_approvals(
    org_id: UUID,
    status: str | None = Query(
        'pending',
        description=(
            "Filter by request status. 'pending' (default), 'approved', "
            "'rejected', 'cancelled', 'expired', or 'reviewed' to list "
            "both approved + rejected. Pass 'all' for every status."
        ),
    ),
    entity_type: str | None = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0),
    mine: bool = Query(False, description="Only approvals awaiting this user (directed to them, or unassigned and they hold the permission)"),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """
    List approval requests for the organization.

    Defaults to pending for backwards compatibility, but accepts a ``status``
    query param so the UI can show approval history (reviewed decisions).
    ``mine=true`` returns the "awaiting you" set. Responses include both
    requester and reviewer details.
    """
    from app.services.approval_service import get_approvals, needs_review
    from app.models import User

    if mine:
        requests, total = needs_review(
            org_id, auth.user_id, db,
            status=status if status and status != "reviewed" else "pending",
            limit=limit, offset=offset,
        )
    else:
        requests, total = get_approvals(
            org_id,
            db,
            status=status,
            entity_type=entity_type,
            limit=limit,
            offset=offset,
        )

    # Resolve both requester and reviewer names in a single user query.
    user_ids: set[UUID] = set()
    for r in requests:
        if r.requested_by:
            user_ids.add(r.requested_by)
        if r.reviewed_by:
            user_ids.add(r.reviewed_by)
        if r.assigned_to_user_id:
            user_ids.add(r.assigned_to_user_id)
    users = (
        {u.user_id: u for u in db.query(User).filter(User.user_id.in_(user_ids)).all()}
        if user_ids
        else {}
    )

    items = []
    for req in requests:
        requester = users.get(req.requested_by) if req.requested_by else None
        reviewer = users.get(req.reviewed_by) if req.reviewed_by else None
        items.append({
            "request_id": str(req.request_id),
            "rule_id": str(req.rule_id),
            "entity_type": req.entity_type,
            "entity_id": str(req.entity_id),
            "requested_by": str(req.requested_by) if req.requested_by else None,
            "requester_name": requester.display_name if requester else None,
            "requested_action": req.requested_action,
            "status": req.status,
            "assigned_to_user_id": (
                str(req.assigned_to_user_id) if req.assigned_to_user_id else None
            ),
            "assignee_name": (
                users[req.assigned_to_user_id].display_name
                if req.assigned_to_user_id and req.assigned_to_user_id in users
                else None
            ),
            "created_at": req.created_at.isoformat() if req.created_at else None,
            "reviewed_by": str(req.reviewed_by) if req.reviewed_by else None,
            "reviewer_name": reviewer.display_name if reviewer else None,
            "reviewed_at": req.reviewed_at.isoformat() if req.reviewed_at else None,
            "review_note": req.review_note,
            "approver_permission": req.rule.approver_permission if req.rule else None,
            "rule_description": req.rule.description if req.rule else None,
        })

    return {
        "items": items,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


# Backward-compatible alias for the old function name.
list_pending_approvals = list_approvals


# =============================================================================
# REVIEW (APPROVE/REJECT)
# =============================================================================

@router.post("/api/organizations/{org_id}/approvals/{request_id}/review", summary="Review approval request")
def review_approval_request(
    org_id: UUID,
    request_id: UUID,
    body: ReviewRequest,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Approve or reject an approval request."""
    from app.services.approval_service import review_approval
    from app.models.core_org import ApprovalRequest as ApprovalRequestModel
    from app.services.rbac_service import check_permission

    # Get the request and its rule
    req = db.query(ApprovalRequestModel).filter_by(
        request_id=request_id,
        organization_id=org_id,
    ).first()

    if not req:
        raise HTTPException(status_code=404, detail={
            "code": "not_found", "message": "Approval request not found",
        })

    # Check reviewer has the required permission
    if not check_permission(auth.user_id, org_id, req.rule.approver_permission, session=db):
        raise HTTPException(status_code=403, detail={
            "code": "forbidden",
            "message": f"Reviewing this request requires the {req.rule.approver_permission} permission",
        })

    try:
        updated = review_approval(request_id, auth.user_id, body.decision, body.note, db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail={
            "code": "bad_request", "message": str(e),
        })

    # If approved, advance the entity in the same transaction so both
    # the approval record and the status change commit atomically.
    if updated.status == 'approved':
        _advance_entity_after_approval(db, updated)

    db.commit()

    return {
        "status": updated.status,
        "request_id": str(updated.request_id),
        "reviewed_by": str(updated.reviewed_by),
        "reviewed_at": updated.reviewed_at.isoformat() if updated.reviewed_at else None,
    }


def _advance_entity_after_approval(db: Session, request: "ApprovalRequestModel"):  # noqa: F821 - quoted forward ref, not evaluated at runtime
    """Move entity from pending_approval to its intended initial status.

    Temporarily bypasses department RLS because the approver may not be in
    the same department as the entity.  The approval permission itself
    (e.g. loans.approve) already gates the action.
    """
    from sqlalchemy import text

    initial_status = request.requested_action.get("initial_status", "pending")
    entity_type = request.entity_type
    entity_id = request.entity_id

    # Map entity types to their table models
    model_map = {}
    try:
        from app.models.loans import LoanIn, LoanOut
        model_map['loan_in'] = (LoanIn, 'loan_id')
        model_map['loan_out'] = (LoanOut, 'loan_id')
    except ImportError:
        pass
    try:
        from app.models.objects import Acquisition
        model_map['acquisition'] = (Acquisition, 'acquisition_id')
    except ImportError:
        pass
    try:
        from app.models.objects import Deaccession
        model_map['deaccession'] = (Deaccession, 'deaccession_id')
    except ImportError:
        pass
    try:
        from app.models.objects import ConditionReport
        model_map['condition_report'] = (ConditionReport, 'report_id')
    except ImportError:
        pass
    try:
        from app.models.insurance import InsurancePolicy
        model_map['insurance_policy'] = (InsurancePolicy, 'policy_id')
    except ImportError:
        pass
    try:
        from app.models.objects import Valuation
        model_map['valuation'] = (Valuation, 'valuation_id')
    except ImportError:
        pass
    try:
        from app.models.procedures import ObjectExit
        model_map['object_exit'] = (ObjectExit, 'exit_id')
    except ImportError:
        pass

    if entity_type not in model_map:
        logger.warning(f"No model mapping for entity_type={entity_type}, skipping status advance")
        return

    # Bypass department RLS for this query — the entity may be in a
    # different department than the approver.  SET LOCAL scopes to txn.
    db.execute(text("SELECT set_config('app.dept_bypass', 'true', true)"))

    model_cls, id_col = model_map[entity_type]
    entity = db.query(model_cls).filter(getattr(model_cls, id_col) == entity_id).first()
    if not entity:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": f"{entity_type} {entity_id} not found — it may have been deleted",
        })
    if entity.status != 'pending_approval':
        raise HTTPException(status_code=409, detail={
            "code": "conflict",
            "message": f"{entity_type} status is '{entity.status}', expected 'pending_approval'",
        })
    entity.status = initial_status
    logger.info(
        "approval_advanced entity=%s/%s status=%s",
        entity_type, entity_id, initial_status,
    )


# =============================================================================
# ASSIGN (direct to a specific user)
# =============================================================================

@router.post("/api/organizations/{org_id}/approvals/{request_id}/assign", summary="Direct an approval to a user")
def assign_approval_request(
    org_id: UUID,
    request_id: UUID,
    body: AssignRequest,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Route a pending approval to a specific user (or clear with null). The
    caller, and the assignee, must hold the rule's approver_permission."""
    from app.models.core_org import ApprovalRequest as ApprovalRequestModel
    from app.services.approval_service import assign_approval
    from app.services.rbac_service import check_permission

    req = db.query(ApprovalRequestModel).filter_by(
        request_id=request_id, organization_id=org_id,
    ).first()
    if not req:
        raise HTTPException(status_code=404, detail={
            "code": "not_found", "message": "Approval request not found",
        })
    if not check_permission(auth.user_id, org_id, req.rule.approver_permission, session=db):
        raise HTTPException(status_code=403, detail={
            "code": "forbidden",
            "message": f"Assigning this request requires the {req.rule.approver_permission} permission",
        })
    try:
        updated = assign_approval(request_id, body.assigned_to_user_id, db)
    except ValueError as e:
        raise HTTPException(status_code=422, detail={
            "code": "invalid_assignee", "message": str(e),
        })
    db.commit()
    return {
        "request_id": str(updated.request_id),
        "assigned_to_user_id": (
            str(updated.assigned_to_user_id) if updated.assigned_to_user_id else None
        ),
        "status": updated.status,
    }


@router.get(
    "/api/organizations/{org_id}/approvals/{request_id}/assignees",
    summary="List eligible assignees for an approval",
)
def list_approval_assignees(
    org_id: UUID,
    request_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Staff who hold this request's approver_permission — the valid people to
    direct it to. Populates the assign picker."""
    from app.models import User
    from app.models.core_org import ApprovalRequest as ApprovalRequestModel
    from app.services.rbac_service import users_with_permission

    req = db.query(ApprovalRequestModel).filter_by(
        request_id=request_id, organization_id=org_id,
    ).first()
    if not req:
        raise HTTPException(status_code=404, detail={
            "code": "not_found", "message": "Approval request not found",
        })

    user_ids = users_with_permission(org_id, req.rule.approver_permission, session=db)
    users = (
        db.query(User).filter(User.user_id.in_(user_ids)).all() if user_ids else []
    )
    return {
        "assignees": [
            {
                "user_id": str(u.user_id),
                "display_name": u.display_name,
                "email": u.email,
            }
            for u in users
        ]
    }


# =============================================================================
# CANCEL (by requester)
# =============================================================================

@router.post("/api/organizations/{org_id}/approvals/{request_id}/cancel", summary="Cancel approval")
def cancel_approval(
    org_id: UUID,
    request_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Cancel a pending approval request (by the requester)."""
    from app.services.approval_service import cancel_approval_request
    from app.models.core_org import ApprovalRequest as ApprovalRequestModel

    req = db.query(ApprovalRequestModel).filter_by(
        request_id=request_id,
        organization_id=org_id,
    ).first()
    if not req:
        raise HTTPException(status_code=404, detail={
            "code": "not_found", "message": "Approval request not found",
        })

    # Only the requester or an admin can cancel
    if req.requested_by != auth.user_id:
        from app.services.rbac_service import check_permission
        if not check_permission(auth.user_id, org_id, 'org.manage_roles', session=db):
            raise HTTPException(status_code=403, detail={
                "code": "forbidden", "message": "Only the requester or an admin can cancel this request",
            })

    try:
        cancel_approval_request(request_id, auth.user_id, db)
        db.commit()
    except ValueError as e:
        raise HTTPException(status_code=400, detail={
            "code": "bad_request", "message": str(e),
        })

    return {"status": "cancelled", "request_id": str(request_id)}


# =============================================================================
# APPROVAL RULES MANAGEMENT
# =============================================================================

@router.get("/api/organizations/{org_id}/approval-rules", summary="List approval rules")
def list_approval_rules(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    """List approval rules for the organization."""
    from app.services.approval_service import get_approval_rules

    rules = get_approval_rules(org_id, db)
    return {
        "rules": [
            {
                "rule_id": str(r.rule_id),
                "entity_type": r.entity_type,
                "trigger_action": r.trigger_action,
                "trigger_condition": r.trigger_condition,
                "approver_permission": r.approver_permission,
                "description": r.description,
                "is_active": r.is_active,
            }
            for r in rules
        ],
    }


@router.put("/api/organizations/{org_id}/approval-rules/{rule_id}", summary="Update approval rule")
def update_approval_rule(
    org_id: UUID,
    rule_id: UUID,
    body: UpdateRuleRequest,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    """Update an approval rule (enable/disable, change permission, description)."""
    from app.models.core_org import ApprovalRule

    rule = db.query(ApprovalRule).filter_by(rule_id=rule_id, organization_id=org_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail={
            "code": "not_found", "message": "Approval rule not found",
        })

    if body.is_active is not None:
        rule.is_active = body.is_active
    if body.approver_permission is not None:
        rule.approver_permission = body.approver_permission
    if body.description is not None:
        rule.description = body.description

    db.commit()

    return {
        "rule_id": str(rule.rule_id),
        "entity_type": rule.entity_type,
        "trigger_action": rule.trigger_action,
        "approver_permission": rule.approver_permission,
        "description": rule.description,
        "is_active": rule.is_active,
    }
