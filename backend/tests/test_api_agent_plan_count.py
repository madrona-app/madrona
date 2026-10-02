"""API tests for GET /api/organizations/{org}/agent/plans/count.

The "needs you" count behind the Plans nav badge. Must mirror the per-plan
`awaits_user` flag in _serialize_plan: a plan counts only when it has a step
parked on a USER-actionable await (a decision, or an approval/form wait) — not
for other awaiting_user steps (e.g. a workflow-transition wait), and it is
scoped to the requesting user's own plans.
"""

from uuid import uuid4

import pytest

from app.models import AgentPlan, AgentPlanStep, Conversation


@pytest.fixture(autouse=True)
def _agent_enabled(monkeypatch):
    from app.config import get_settings
    monkeypatch.setattr(get_settings(), "agent_enabled", True)


def _count_url(org):
    return f"/api/organizations/{org.organization_id}/agent/plans/count"


def _make_plan(db_session, org_id, user_id, *, status="awaiting", steps=None):
    conv = Conversation(organization_id=org_id, user_id=user_id, persona="staff")
    db_session.add(conv)
    db_session.flush()
    plan = AgentPlan(
        conversation_id=conv.conversation_id,
        organization_id=org_id,
        persona_used="staff",
        goal="Test plan",
        status=status,
        context_snapshot={
            "organization_id": str(org_id),
            "user_id": str(user_id),
            "persona": "staff",
        },
    )
    db_session.add(plan)
    db_session.flush()
    for idx, spec in enumerate(steps or []):
        db_session.add(AgentPlanStep(
            plan_id=plan.plan_id,
            idx=idx,
            kind=spec["kind"],
            description=f"step {idx}",
            wait_for=spec.get("wait_for"),
            status=spec.get("status", "pending"),
        ))
    db_session.commit()
    return plan


_DECISION = {"kind": "decision", "status": "awaiting_user"}
_APPROVAL_AWAIT = {
    "kind": "await",
    "status": "awaiting_user",
    "wait_for": {"kind": "approval_request", "request_id": str(uuid4())},
}
_NON_ACTIONABLE_AWAIT = {
    "kind": "await",
    "status": "awaiting_user",
    "wait_for": {"kind": "workflow_transition", "entity": "x", "target_status": "y"},
}


class TestPlanCount:
    def test_zero_when_no_plans(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.get(_count_url(org))
        assert resp.status_code == 200, resp.text
        assert resp.get_json()["count"] == 0

    def test_counts_decision_await(self, auth_setup, db_session):
        client, org, user = auth_setup
        _make_plan(db_session, org.organization_id, user.user_id, steps=[_DECISION])
        assert client.get(_count_url(org)).get_json()["count"] == 1

    def test_counts_approval_await(self, auth_setup, db_session):
        client, org, user = auth_setup
        _make_plan(db_session, org.organization_id, user.user_id, steps=[_APPROVAL_AWAIT])
        assert client.get(_count_url(org)).get_json()["count"] == 1

    def test_ignores_non_user_actionable_await(self, auth_setup, db_session):
        client, org, user = auth_setup
        _make_plan(db_session, org.organization_id, user.user_id, steps=[_NON_ACTIONABLE_AWAIT])
        assert client.get(_count_url(org)).get_json()["count"] == 0

    def test_distinct_plans_not_steps(self, auth_setup, db_session):
        """A plan with two actionable awaits counts once, not twice."""
        client, org, user = auth_setup
        _make_plan(db_session, org.organization_id, user.user_id,
                   steps=[_DECISION, dict(_APPROVAL_AWAIT)])
        assert client.get(_count_url(org)).get_json()["count"] == 1

    def test_scoped_to_requesting_user(self, auth_setup, db_session):
        """Another user's awaiting plan in the same org is not counted."""
        client, org, _ = auth_setup
        # A different user (FK to users requires a real row).
        from app.models.core_users import User
        other = User(email=f"other-{uuid4().hex[:8]}@example.com")
        db_session.add(other)
        db_session.flush()
        _make_plan(db_session, org.organization_id, other.user_id, steps=[_DECISION])
        assert client.get(_count_url(org)).get_json()["count"] == 0
