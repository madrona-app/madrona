"""DB-level guard: a tool_call/delegate step must carry a tool.

Defense-in-depth below agent_plan_service._validate_steps — a raw insert (the way
a hand-seeded demo plan once produced an unrunnable 'tool_call but no tool' plan)
is rejected by the database itself.
"""

from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError

from app.models import AgentPlan, AgentPlanStep, Conversation, Organization


def _plan(db):
    org = Organization(name="Step Constraint Museum", slug=f"sc-{uuid4().hex[:8]}")
    db.add(org)
    db.flush()
    conv = Conversation(organization_id=org.organization_id, persona="staff")
    db.add(conv)
    db.flush()
    plan = AgentPlan(
        conversation_id=conv.conversation_id,
        organization_id=org.organization_id,
        persona_used="staff",
        goal="g",
        status="pending",
        context_snapshot={"organization_id": str(org.organization_id), "persona": "staff"},
    )
    db.add(plan)
    db.flush()
    return plan


def test_tool_call_without_tool_is_rejected(db_session):
    plan = _plan(db_session)
    db_session.add(AgentPlanStep(
        plan_id=plan.plan_id, idx=0, kind="tool_call", description="no tool", status="pending",
    ))
    with pytest.raises(IntegrityError) as exc:
        db_session.flush()
    assert "check_agent_plan_step_tool_required" in str(exc.value)
    db_session.rollback()


def test_delegate_without_tool_is_rejected(db_session):
    plan = _plan(db_session)
    db_session.add(AgentPlanStep(
        plan_id=plan.plan_id, idx=0, kind="delegate", description="no tool", status="pending",
    ))
    with pytest.raises(IntegrityError):
        db_session.flush()
    db_session.rollback()


def test_await_without_tool_is_allowed(db_session):
    plan = _plan(db_session)
    db_session.add(AgentPlanStep(
        plan_id=plan.plan_id, idx=0, kind="await", description="gate", status="pending",
    ))
    db_session.flush()  # must not raise


def test_tool_call_with_tool_is_allowed(db_session):
    plan = _plan(db_session)
    db_session.add(AgentPlanStep(
        plan_id=plan.plan_id, idx=0, kind="tool_call", description="ok",
        tool="propose_collection_object_draft", status="pending",
    ))
    db_session.flush()  # must not raise
