"""Directed approvals — assign an approval to a specific user (service + API)."""

from uuid import uuid4

import pytest

from app.models import CollectionObject
from app.models.core_org import ApprovalRequest, ApprovalRule
from app.services.agent_tools import AgentContext
from app.services.approval_service import assign_approval, get_approvals
from app.services.drafts.draft_service import create_draft


def _rulebound_draft(db_session, org, user, assignee=None):
    """Seed a condition_report rule (approver = collections.create, which the
    auth_setup admin holds), then propose a draft that binds an approval."""
    from app.services.approval_service import check_approval_required

    if check_approval_required(
        org.organization_id, "condition_report", "create", db_session
    ) is None:
        db_session.add(ApprovalRule(
            organization_id=org.organization_id,
            entity_type="condition_report",
            trigger_action="create",
            approver_permission="collections.create",
        ))
        db_session.flush()
    obj = CollectionObject(
        organization_id=org.organization_id, object_number=f"2026.{uuid4().hex[:4]}"
    )
    db_session.add(obj)
    db_session.flush()
    ctx = AgentContext(
        organization_id=org.organization_id,
        user_id=user.user_id,
        persona="conservator",
        db_session=db_session,
    )
    draft = create_draft(
        ctx,
        entity_type="condition_report",
        intended_action="create",
        payload={
            "object_id": str(obj.object_id),
            "report_type": "conservation",
            "report_date": "2026-05-23",
        },
        assigned_to_user_id=assignee,
    )
    db_session.flush()
    return draft


class TestAssignService:
    def test_create_with_valid_assignee(self, auth_setup, db_session):
        _, org, user = auth_setup
        draft = _rulebound_draft(db_session, org, user, assignee=user.user_id)
        req = db_session.get(ApprovalRequest, draft.approval_request_id)
        assert req.assigned_to_user_id == user.user_id

    def test_create_with_unauthorized_assignee_raises(self, auth_setup, db_session):
        _, org, user = auth_setup
        with pytest.raises(ValueError):
            _rulebound_draft(db_session, org, user, assignee=uuid4())

    def test_assign_existing_then_filter_by_assignee(self, auth_setup, db_session):
        _, org, user = auth_setup
        draft = _rulebound_draft(db_session, org, user)  # unassigned
        assign_approval(draft.approval_request_id, user.user_id, db_session)
        reqs, _ = get_approvals(
            org.organization_id, db_session, status="pending",
            assigned_to_user_id=user.user_id,
        )
        assert any(r.request_id == draft.approval_request_id for r in reqs)

    def test_assign_unauthorized_raises(self, auth_setup, db_session):
        _, org, user = auth_setup
        draft = _rulebound_draft(db_session, org, user)
        with pytest.raises(ValueError):
            assign_approval(draft.approval_request_id, uuid4(), db_session)


def _assign_url(org, rid):
    return f"/api/organizations/{org.organization_id}/approvals/{rid}/assign"


class TestAssignApi:
    def test_assign_endpoint(self, auth_setup, db_session):
        client, org, user = auth_setup
        draft = _rulebound_draft(db_session, org, user)
        db_session.commit()
        resp = client.post(
            _assign_url(org, draft.approval_request_id),
            json={"assigned_to_user_id": str(user.user_id)},
        )
        assert resp.status_code == 200, resp.text
        assert resp.get_json()["assigned_to_user_id"] == str(user.user_id)

    def test_assign_invalid_assignee_is_422(self, auth_setup, db_session):
        client, org, user = auth_setup
        draft = _rulebound_draft(db_session, org, user)
        db_session.commit()
        resp = client.post(
            _assign_url(org, draft.approval_request_id),
            json={"assigned_to_user_id": str(uuid4())},
        )
        assert resp.status_code == 422

    def test_assign_unknown_request_is_404(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.post(_assign_url(org, uuid4()), json={"assigned_to_user_id": None})
        assert resp.status_code == 404


class TestAssigneesApi:
    def test_lists_eligible_assignees(self, auth_setup, db_session):
        client, org, user = auth_setup
        draft = _rulebound_draft(db_session, org, user)
        db_session.commit()
        resp = client.get(
            f"/api/organizations/{org.organization_id}"
            f"/approvals/{draft.approval_request_id}/assignees"
        )
        assert resp.status_code == 200, resp.text
        ids = [a["user_id"] for a in resp.get_json()["assignees"]]
        assert str(user.user_id) in ids

    def test_unknown_request_is_404(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.get(
            f"/api/organizations/{org.organization_id}/approvals/{uuid4()}/assignees"
        )
        assert resp.status_code == 404


class TestNeedsReviewAndNotify:
    def test_assign_creates_notification(self, auth_setup, db_session):
        from app.models import Notification

        _, org, user = auth_setup
        draft = _rulebound_draft(db_session, org, user)
        assign_approval(draft.approval_request_id, user.user_id, db_session)
        db_session.flush()
        notes = (
            db_session.query(Notification)
            .filter_by(user_id=user.user_id, notification_type="approval_assigned")
            .all()
        )
        assert len(notes) >= 1

    def test_needs_review_includes_assigned_and_eligible(self, auth_setup, db_session):
        from app.services.approval_service import needs_review

        _, org, user = auth_setup
        d_unassigned = _rulebound_draft(db_session, org, user)  # eligible by perm
        d_assigned = _rulebound_draft(db_session, org, user, assignee=user.user_id)
        rows, total = needs_review(org.organization_id, user.user_id, db_session)
        ids = {r.request_id for r in rows}
        assert d_unassigned.approval_request_id in ids
        assert d_assigned.approval_request_id in ids
        assert total >= 2


class TestMineCountApi:
    def test_count_mine_true(self, auth_setup, db_session):
        client, org, user = auth_setup
        _rulebound_draft(db_session, org, user)
        db_session.commit()
        resp = client.get(
            f"/api/organizations/{org.organization_id}/approvals/count?mine=true"
        )
        assert resp.status_code == 200, resp.text
        assert resp.get_json()["count"] >= 1


class TestLookupStaff:
    def test_finds_active_member(self, auth_setup, db_session):
        from app.services.agent_tools.staff_tools import lookup_staff

        _, org, user = auth_setup
        ctx = AgentContext(
            organization_id=org.organization_id,
            user_id=user.user_id,
            persona="staff",
            db_session=db_session,
        )
        res = lookup_staff({"query": user.email[:4]}, ctx)
        assert any(s["user_id"] == str(user.user_id) for s in res["staff"])

    def test_permission_filter(self, auth_setup, db_session):
        from app.services.agent_tools.staff_tools import lookup_staff

        _, org, user = auth_setup
        ctx = AgentContext(
            organization_id=org.organization_id,
            user_id=user.user_id,
            persona="staff",
            db_session=db_session,
        )
        held = lookup_staff({"permission": "collections.create"}, ctx)
        assert any(s["user_id"] == str(user.user_id) for s in held["staff"])
        none = lookup_staff({"permission": "nonexistent.permission"}, ctx)
        assert none["staff"] == []
