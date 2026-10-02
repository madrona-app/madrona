"""
Approval workflow service.

procedure-aligned approval gates for procedures. When an approval rule
exists for an entity_type + action, the entity is created with
status='pending_approval' and an approval request is queued.

Reviewers with the approver_permission can approve/reject.
If no rule exists, the action proceeds normally (backward compatible).
"""

import logging
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select, and_
from sqlalchemy.orm import Session

from app.models.core_org import ApprovalRule, ApprovalRequest

logger = logging.getLogger(__name__)


def check_approval_required(
    org_id: UUID | str,
    entity_type: str,
    trigger_action: str,
    session: Session,
) -> ApprovalRule | None:
    """
    Check if an approval rule exists for this action.

    Returns the active rule if approval is required, None otherwise.
    """
    if isinstance(org_id, str):
        org_id = UUID(org_id)

    stmt = (
        select(ApprovalRule)
        .where(
            and_(
                ApprovalRule.organization_id == org_id,
                ApprovalRule.entity_type == entity_type,
                ApprovalRule.trigger_action == trigger_action,
                ApprovalRule.is_active == True,
            )
        )
    )
    return session.execute(stmt).scalar_one_or_none()


def _assert_can_approve(session, org_id: UUID, user_id: UUID, permission: str) -> None:
    """An approval can only be directed to someone who can actually act on it."""
    from app.services.rbac_service import check_permission

    if not check_permission(user_id, org_id, permission, session=session):
        raise ValueError(
            f"User {user_id} cannot be assigned this approval — they do not hold "
            f"the {permission!r} permission."
        )


def create_approval_request(
    rule: ApprovalRule,
    entity_type: str,
    entity_id: UUID,
    requested_by: UUID | str,
    requested_action: dict,
    session: Session,
    assigned_to_user_id: UUID | str | None = None,
) -> ApprovalRequest:
    """
    Create a pending approval request.

    Called after creating an entity with status='pending_approval'.

    `assigned_to_user_id` directs the request to a specific person (who must
    hold the rule's approver_permission); otherwise it's open to any holder.
    """
    if isinstance(requested_by, str):
        requested_by = UUID(requested_by)
    if isinstance(assigned_to_user_id, str):
        assigned_to_user_id = UUID(assigned_to_user_id)
    if assigned_to_user_id is not None:
        _assert_can_approve(
            session, rule.organization_id, assigned_to_user_id, rule.approver_permission
        )

    request = ApprovalRequest(
        rule_id=rule.rule_id,
        organization_id=rule.organization_id,
        entity_type=entity_type,
        entity_id=entity_id,
        requested_by=requested_by,
        requested_action=requested_action,
        status='pending',
        assigned_to_user_id=assigned_to_user_id,
    )
    session.add(request)
    session.flush()
    if assigned_to_user_id is not None:
        _notify_assignee(session, request, actor_id=requested_by)

    logger.info(
        "approval_request_created request_id=%s entity=%s/%s rule=%s by=%s",
        request.request_id, entity_type, entity_id, rule.rule_id, requested_by,
    )
    return request


def review_approval(
    request_id: UUID | str,
    reviewer_id: UUID | str,
    decision: str,
    note: str | None,
    session: Session,
) -> ApprovalRequest:
    """
    Approve or reject an approval request.

    Args:
        request_id: The approval request UUID
        reviewer_id: The user making the decision
        decision: 'approved' or 'rejected'
        note: Optional review note

    Returns:
        Updated ApprovalRequest

    Raises:
        ValueError: If request not found, already reviewed, or invalid decision
    """
    if isinstance(request_id, str):
        request_id = UUID(request_id)
    if isinstance(reviewer_id, str):
        reviewer_id = UUID(reviewer_id)

    if decision not in ('approved', 'rejected'):
        raise ValueError(f"Invalid decision: {decision}. Must be 'approved' or 'rejected'.")

    request = session.query(ApprovalRequest).filter_by(request_id=request_id).first()
    if not request:
        raise ValueError(f"Approval request {request_id} not found")

    if request.status != 'pending':
        raise ValueError(f"Request already {request.status}")

    request.status = decision
    request.reviewed_by = reviewer_id
    request.reviewed_at = datetime.now(timezone.utc)
    request.review_note = note

    session.flush()

    logger.info(
        "approval_reviewed request_id=%s decision=%s entity=%s/%s by=%s",
        request_id, decision, request.entity_type, request.entity_id, reviewer_id,
    )

    # Multi-agent orchestration: if any plan steps are gated on this
    # approval, signal them now. Best-effort — failure here does not
    # block the approval from being recorded.
    try:
        from app.services.agent_plan_service import handle_approval_decision
        handle_approval_decision(request_id, session)
    except Exception:  # noqa: BLE001
        logger.exception(
            "agent_plan_service.handle_approval_decision raised; "
            "approval_id=%s — approval recorded, plan signal skipped",
            request_id,
        )

    # Guide Studio drafts gated on this approval: apply on approve / reject on
    # reject. Best-effort — failure here does not block the approval record.
    try:
        from app.services.drafts.draft_service import handle_draft_decision
        handle_draft_decision(request_id, session)
    except Exception:  # noqa: BLE001
        logger.exception(
            "draft_service.handle_draft_decision raised; approval_id=%s — "
            "approval recorded, draft apply skipped",
            request_id,
        )

    return request


def _notify_assignee(session, request: ApprovalRequest, actor_id=None) -> None:
    """Best-effort: tell the assignee an approval needs them. Added to the
    session (no commit) so it lands in the caller's transaction."""
    if request.assigned_to_user_id is None:
        return
    try:
        from app.models import Notification

        session.add(Notification(
            organization_id=request.organization_id,
            user_id=request.assigned_to_user_id,
            notification_type="approval_assigned",
            title="An approval needs your review",
            message=f"A {request.entity_type} approval was assigned to you.",
            entity_type=request.entity_type,
            entity_id=request.entity_id,
            actor_id=actor_id,
        ))
    except Exception:  # noqa: BLE001 - never block the assignment on a notify
        logger.exception("failed to create approval-assigned notification")


def needs_review(
    org_id: UUID | str,
    user_id: UUID | str,
    session: Session,
    status: str = "pending",
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[ApprovalRequest], int]:
    """Approvals that need THIS user: directed to them, or unassigned and they
    hold the rule's approver_permission. The 'awaiting you' set."""
    from sqlalchemy import and_, func, or_

    from app.services.rbac_service import get_user_permissions

    if isinstance(org_id, str):
        org_id = UUID(org_id)
    if isinstance(user_id, str):
        user_id = UUID(user_id)

    perms = get_user_permissions(user_id, org_id, session=session) or set()
    perm_list = list(perms) if perms else ["__none__"]

    base = (
        select(ApprovalRequest)
        .join(ApprovalRule, ApprovalRule.rule_id == ApprovalRequest.rule_id)
        .where(
            ApprovalRequest.organization_id == org_id,
            ApprovalRequest.status == status,
            or_(
                ApprovalRequest.assigned_to_user_id == user_id,
                and_(
                    ApprovalRequest.assigned_to_user_id.is_(None),
                    ApprovalRule.approver_permission.in_(perm_list),
                ),
            ),
        )
    )
    total = session.execute(
        select(func.count()).select_from(base.subquery())
    ).scalar() or 0
    rows = list(
        session.execute(
            base.order_by(ApprovalRequest.created_at.desc()).limit(limit).offset(offset)
        ).scalars()
    )
    return rows, total


def assign_approval(
    request_id: UUID | str,
    assignee_user_id: UUID | str | None,
    session: Session,
) -> ApprovalRequest:
    """Direct a pending approval to a specific user (or clear it with None).

    The assignee must hold the rule's approver_permission. Only pending
    requests can be (re)assigned.
    """
    if isinstance(request_id, str):
        request_id = UUID(request_id)
    if isinstance(assignee_user_id, str):
        assignee_user_id = UUID(assignee_user_id)

    request = session.query(ApprovalRequest).filter_by(request_id=request_id).first()
    if not request:
        raise ValueError(f"Approval request {request_id} not found")
    if request.status != 'pending':
        raise ValueError(f"Cannot reassign a {request.status} request")

    if assignee_user_id is not None:
        _assert_can_approve(
            session,
            request.organization_id,
            assignee_user_id,
            request.rule.approver_permission,
        )

    request.assigned_to_user_id = assignee_user_id
    session.flush()
    _notify_assignee(session, request)
    logger.info(
        "approval_assigned request_id=%s assignee=%s", request_id, assignee_user_id
    )
    return request


def get_pending_approvals(
    org_id: UUID | str,
    session: Session,
    entity_type: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[ApprovalRequest], int]:
    """
    Get pending approval requests for an organization.

    Returns (requests, total_count). Thin wrapper around get_approvals for
    backward compatibility.
    """
    return get_approvals(
        org_id,
        session,
        status='pending',
        entity_type=entity_type,
        limit=limit,
        offset=offset,
    )


def get_approvals(
    org_id: UUID | str,
    session: Session,
    status: str | None = 'pending',
    entity_type: str | None = None,
    limit: int = 50,
    offset: int = 0,
    assigned_to_user_id: UUID | str | None = None,
) -> tuple[list[ApprovalRequest], int]:
    """
    List approval requests for an organization.

    Args:
        status: Filter by request status. Pass ``None`` or ``"all"`` to
            return every request; pass ``"reviewed"`` to return both approved
            and rejected requests; otherwise pass the exact status
            (``pending``, ``approved``, ``rejected``, ``cancelled``, or
            ``expired``). Defaults to ``pending``.
        entity_type: Optional entity_type filter.

    Returns: ``(requests, total_count)``. Pending requests are ordered by
    creation date desc; reviewed requests are ordered by reviewed_at desc
    (with creation date as a fallback) so the most recent decisions appear
    first.
    """
    if isinstance(org_id, str):
        org_id = UUID(org_id)

    base = select(ApprovalRequest).where(
        ApprovalRequest.organization_id == org_id
    )

    if status and status != 'all':
        if status == 'reviewed':
            base = base.where(
                ApprovalRequest.status.in_(['approved', 'rejected'])
            )
        else:
            base = base.where(ApprovalRequest.status == status)

    if entity_type:
        base = base.where(ApprovalRequest.entity_type == entity_type)

    if assigned_to_user_id is not None:
        if isinstance(assigned_to_user_id, str):
            assigned_to_user_id = UUID(assigned_to_user_id)
        base = base.where(
            ApprovalRequest.assigned_to_user_id == assigned_to_user_id
        )

    # Count
    from sqlalchemy import func
    count_stmt = select(func.count()).select_from(base.subquery())
    total = session.execute(count_stmt).scalar() or 0

    # Fetch — order by reviewed_at for reviewed lists, created_at for pending/all
    order_col = (
        ApprovalRequest.reviewed_at.desc().nullslast()
        if status in ('reviewed', 'approved', 'rejected')
        else ApprovalRequest.created_at.desc()
    )
    stmt = base.order_by(order_col).limit(limit).offset(offset)
    requests = list(session.execute(stmt).scalars())

    return requests, total


def get_approval_rules(
    org_id: UUID | str,
    session: Session,
) -> list[ApprovalRule]:
    """Get all approval rules for an organization."""
    if isinstance(org_id, str):
        org_id = UUID(org_id)

    stmt = (
        select(ApprovalRule)
        .where(ApprovalRule.organization_id == org_id)
        .order_by(ApprovalRule.entity_type, ApprovalRule.trigger_action)
    )
    return list(session.execute(stmt).scalars())


def cancel_approval_request(
    request_id: UUID | str,
    user_id: UUID | str,
    session: Session,
) -> ApprovalRequest:
    """Cancel a pending approval request (by the requester)."""
    if isinstance(request_id, str):
        request_id = UUID(request_id)

    request = session.query(ApprovalRequest).filter_by(request_id=request_id).first()
    if not request:
        raise ValueError(f"Approval request {request_id} not found")
    if request.status != 'pending':
        raise ValueError(f"Can only cancel pending requests, current status: {request.status}")

    request.status = 'cancelled'
    request.reviewed_at = datetime.now(timezone.utc)
    session.flush()

    logger.info("approval_cancelled request_id=%s by=%s", request_id, user_id)
    return request


def resubmit_approval(
    org_id: UUID | str,
    entity_type: str,
    entity_id: UUID | str,
    user_id: UUID | str,
    session: Session,
    changed_fields: list[str] | None = None,
) -> ApprovalRequest | None:
    """
    Cancel any pending approval for this entity and create a fresh one.

    Called when a requester edits a pending_approval record — ensures the
    approver always reviews the latest version.

    Atomic: cancel + create run inside a SAVEPOINT, and the underlying
    partial unique index ``uq_approval_requests_one_pending`` guarantees
    no more than one pending request per (org, entity_type, entity_id)
    even under concurrent calls. The cancel step uses SELECT FOR UPDATE
    so two callers serialize instead of both cancelling the same row.

    Returns the new approval request, or None if no approval rule exists.
    """
    if isinstance(org_id, str):
        org_id = UUID(org_id)
    if isinstance(entity_id, str):
        entity_id = UUID(entity_id)
    if isinstance(user_id, str):
        user_id = UUID(user_id)

    rule = check_approval_required(org_id, entity_type, 'create', session)
    if not rule:
        return None

    with session.begin_nested():
        existing = (
            session.query(ApprovalRequest)
            .filter(
                ApprovalRequest.organization_id == org_id,
                ApprovalRequest.entity_type == entity_type,
                ApprovalRequest.entity_id == entity_id,
                ApprovalRequest.status == 'pending',
            )
            .with_for_update()
            .first()
        )

        if existing:
            existing.status = 'cancelled'
            existing.reviewed_at = datetime.now(timezone.utc)
            session.flush()
            logger.info(
                "approval_auto_cancelled request_id=%s entity=%s/%s reason=requester_edit",
                existing.request_id, entity_type, entity_id,
            )

        action_data = {
            "action": "create",
            "initial_status": "requested",
            "resubmitted": True,
        }
        if changed_fields:
            action_data["changed_fields"] = changed_fields

        new_request = create_approval_request(
            rule=rule,
            entity_type=entity_type,
            entity_id=entity_id,
            requested_by=user_id,
            requested_action=action_data,
            session=session,
        )

    return new_request


# =============================================================================
# SEEDING
# =============================================================================

DEFAULT_RULES = [
    ('loan_out', 'create', 'loans.approve', 'Loan out requests require registrar approval'),
    ('loan_in', 'create', 'loans.approve', 'Loan in requests require registrar approval'),
    ('acquisition', 'create', 'acquisitions.approve', 'Acquisition proposals require registrar approval'),
    ('deaccession', 'create', 'deaccession.approve', 'Deaccession proposals require admin approval'),
    # procedures
    ('condition_report', 'create', 'conservation.approve', 'Condition reports require conservator approval'),
    ('insurance_policy', 'create', 'insurance.approve', 'Insurance policies require registrar approval'),
    ('valuation', 'create', 'insurance.approve', 'Valuations require registrar approval'),
    ('object_exit', 'create', 'loans.approve', 'Object exits require registrar approval'),
    ('media_rights', 'create', 'media.approve_rights', 'Media rights/license sign-off'),
    ('media_review', 'create', 'media.approve_review', 'Sensitive-content review sign-off (required before publish)'),
    ('media_publish', 'create', 'media.publish', 'Media publish sign-off (hard-gated on rights + review)'),
]


def seed_default_rules(org_id: UUID | str, session: Session) -> int:
    """
    Seed default procedure approval rules for an organization.

    Called when the collections app is enabled for an org.
    Skips rules that already exist (idempotent).

    Returns the number of rules created.
    """
    if isinstance(org_id, str):
        org_id = UUID(org_id)

    created = 0
    for entity_type, trigger_action, approver_perm, description in DEFAULT_RULES:
        existing = session.query(ApprovalRule).filter_by(
            organization_id=org_id,
            entity_type=entity_type,
            trigger_action=trigger_action,
        ).first()
        if not existing:
            session.add(ApprovalRule(
                organization_id=org_id,
                entity_type=entity_type,
                trigger_action=trigger_action,
                approver_permission=approver_perm,
                description=description,
            ))
            created += 1

    if created:
        session.flush()
        logger.info("seeded_approval_rules org_id=%s count=%d", org_id, created)
    return created
