"""Branching primitive: `decision` steps + `branch`-tagged paths.

- TestValidateBranching — the static coherence rules.
- TestBranchExecution — run → park on the decision → signal a choice → the
  chosen branch runs and the others are skipped (through the real executor).
"""

from __future__ import annotations

from uuid import uuid4

import pytest

from app.models import (
    AgentDraft,
    AgentPlan,
    AgentPlanStep,
    Conversation,
    Organization,
    OrganizationMembership,
    Role,
    User,
)
from app.services.agent_plan_service import (
    PlanService,
    _serialize_context,
    _validate_steps,
)
from app.services.agent_tools import AgentContext


# ── unit: validation ─────────────────────────────────────────────────────────


def _decision(*keys):
    return {"description": "pick", "kind": "decision",
            "args": {"options": [{"key": k, "label": k.title()} for k in keys]}}


def _tc(branch, **args):
    return {"description": f"step {branch}", "kind": "tool_call",
            "tool": "propose_collection_object_draft", "persona": "registrar",
            "branch": branch, "args": args}


class TestValidateBranching:
    def test_valid_two_branch_plan(self):
        steps, err = _validate_steps([_decision("keep", "ret"), _tc("keep"), _tc("ret")])
        assert err is None
        assert steps[0]["args"]["options"][0]["key"] == "keep"
        assert steps[1]["branch"] == "keep"

    def test_decision_needs_two_options(self):
        _, err = _validate_steps([_decision("only")])
        assert err and ">=2" in err

    def test_duplicate_option_keys_rejected(self):
        _, err = _validate_steps([
            {"description": "p", "kind": "decision",
             "args": {"options": [{"key": "a"}, {"key": "a"}]}},
        ])
        assert err and "unique" in err

    def test_branch_must_follow_its_decision(self):
        _, err = _validate_steps([_tc("a"), _decision("a", "b")])
        assert err and "after its decision" in err

    def test_orphan_branch_rejected(self):
        _, err = _validate_steps([_decision("a", "b"), _tc("c")])
        assert err and "not declared" in err

    def test_cross_branch_threading_rejected(self):
        _, err = _validate_steps([
            _decision("a", "b"),
            _tc("a"),
            {"description": "B", "kind": "tool_call", "tool": "t",
             "persona": "registrar", "branch": "b",
             "args": {"x": {"$from_step": 1}}},
        ])
        assert err and "across branches" in err

    def test_globally_unique_keys_across_decisions(self):
        _, err = _validate_steps([
            _decision("a", "b"), _tc("a"),
            _decision("a", "c"),  # 'a' reused
        ])
        assert err and "globally unique" in err


# ── integration: execution ───────────────────────────────────────────────────


@pytest.fixture
def org(db_session):
    o = Organization(name="Branch Museum", slug=f"br-{uuid4().hex[:8]}")
    db_session.add(o)
    db_session.commit()
    return o


@pytest.fixture
def user(db_session, org):
    u = User(email=f"reg-{uuid4().hex[:8]}@example.com", display_name="Reg", status="active")
    db_session.add(u)
    db_session.flush()
    role = (
        db_session.query(Role)
        .filter(Role.role_key == "member", Role.is_system == True)  # noqa: E712
        .first()
    )
    if role is None:
        role = Role(role_key="member", display_name="Member", is_system=True)
        db_session.add(role)
        db_session.flush()
    db_session.add(OrganizationMembership(
        user_id=u.user_id, organization_id=org.organization_id,
        role="member", role_id=role.role_id,
    ))
    db_session.commit()
    return u


def _ctx(db_session, org, user):
    return AgentContext(
        organization_id=org.organization_id, user_id=user.user_id,
        persona="staff", db_session=db_session,
    )


def _branching_plan(db_session, ctx, org):
    """decision keep/return → [keep: catalog an object] / [return: object exit]."""
    conv = Conversation(
        organization_id=org.organization_id, user_id=ctx.user_id, persona="staff")
    db_session.add(conv)
    db_session.flush()
    raw = [
        {"description": "Keep or return?", "kind": "decision",
         "args": {"options": [{"key": "keep", "label": "Keep"},
                              {"key": "return", "label": "Return"}]}},
        {"description": "Catalog the object", "kind": "tool_call",
         "tool": "propose_collection_object_draft", "persona": "registrar",
         "branch": "keep", "args": {"object_number": f"2026.{uuid4().hex[:5]}"}},
        {"description": "Draft the object exit (return)", "kind": "tool_call",
         "tool": "propose_object_exit_draft", "persona": "registrar",
         "branch": "return", "args": {"exit_reason": "enquiry_return"}},
    ]
    validated, err = _validate_steps(raw)
    assert err is None, err
    svc = PlanService(db_session, context=ctx)
    plan = AgentPlan(
        conversation_id=conv.conversation_id, organization_id=org.organization_id,
        persona_used="staff", goal="intake", status="pending",
        context_snapshot=_serialize_context(ctx),
    )
    db_session.add(plan)
    db_session.flush()
    svc._persist_steps(plan, validated)
    db_session.commit()
    return svc, plan


def _steps(db_session, plan):
    return (
        db_session.query(AgentPlanStep)
        .filter(AgentPlanStep.plan_id == plan.plan_id)
        .order_by(AgentPlanStep.idx)
        .all()
    )


class TestBranchExecution:
    def test_runs_parks_on_decision(self, db_session, org, user):
        svc, plan = _branching_plan(db_session, _ctx(db_session, org, user), org)
        result = svc.run_plan(plan.plan_id)
        assert result.halted and result.halt_reason == "awaiting"
        decision, keep, ret = _steps(db_session, plan)
        assert decision.status == "awaiting_user"
        assert keep.status == "pending" and ret.status == "pending"

    def test_choosing_keep_skips_return(self, db_session, org, user):
        svc, plan = _branching_plan(db_session, _ctx(db_session, org, user), org)
        svc.run_plan(plan.plan_id)
        decision = _steps(db_session, plan)[0]
        svc.signal(plan.plan_id, decision.step_id, {"kind": "decision", "chosen": "keep"})

        db_session.refresh(plan)
        decision, keep, ret = _steps(db_session, plan)
        assert plan.status == "completed"
        assert decision.result == {"kind": "decision", "chosen": "keep"}
        assert keep.status == "completed"
        assert ret.status == "skipped"
        # The kept branch created a catalog draft; the return branch did not.
        types = {d.entity_type for d in db_session.query(AgentDraft)
                 .filter(AgentDraft.plan_id == plan.plan_id).all()}
        assert "collection_object" in types
        assert "object_exit" not in types

    def test_choosing_return_skips_keep(self, db_session, org, user):
        svc, plan = _branching_plan(db_session, _ctx(db_session, org, user), org)
        svc.run_plan(plan.plan_id)
        decision = _steps(db_session, plan)[0]
        svc.signal(plan.plan_id, decision.step_id, {"kind": "decision", "chosen": "return"})

        db_session.refresh(plan)
        decision, keep, ret = _steps(db_session, plan)
        assert plan.status == "completed"
        assert keep.status == "skipped"
        assert ret.status == "completed"
        types = {d.entity_type for d in db_session.query(AgentDraft)
                 .filter(AgentDraft.plan_id == plan.plan_id).all()}
        assert "object_exit" in types
        assert "collection_object" not in types

    def test_invalid_choice_rejected(self, db_session, org, user):
        svc, plan = _branching_plan(db_session, _ctx(db_session, org, user), org)
        svc.run_plan(plan.plan_id)
        decision = _steps(db_session, plan)[0]
        res = svc.signal(plan.plan_id, decision.step_id,
                         {"kind": "decision", "chosen": "nonsense"})
        assert res.halt_reason == "invalid_signal"
        db_session.refresh(plan)
        # Plan stays parked; nothing skipped/run.
        assert plan.status == "awaiting"
        assert _steps(db_session, plan)[0].status == "awaiting_user"
