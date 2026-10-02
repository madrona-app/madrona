"""§2A/§2D per-step effort telemetry: scoring, capture, and serialization."""

import json
from unittest.mock import patch
from uuid import uuid4

import pytest

from app.models import (
    AgentPlanStepMetric,
    Conversation,
    Organization,
    OrganizationMembership,
    Role,
    User,
)
from app.services.agent_plan_effort import cost_estimate, raw_effort, weight
from app.services.agent_plan_service import PlanService
from app.services.agent_tools import AgentContext
from app.fastapi_app.routers.agent import _serialize_plan


# ── effort model (pure) ──────────────────────────────────────────────────────

def test_raw_effort_zero_without_llm():
    # A deterministic tool_call (one tool, no tokens/rounds) → no AI cost.
    assert raw_effort(None, None, None, 1, None) == 0.0


def test_raw_effort_scales_llm_signals():
    # 150 tokens + 2 rounds*500 + 3 tools*200 + 1 deleg*1000
    assert raw_effort(100, 50, 2, 3, 1) == 2750.0


def test_cost_estimate_priced_and_unpriced():
    assert cost_estimate("claude-haiku-4-5", 1000, 1000) == pytest.approx(0.006)
    assert cost_estimate("qwen2.5:14b", 1000, 1000) is None  # self-hosted → None
    assert cost_estimate(None, 1000, 1000) is None
    assert cost_estimate("claude-haiku-4-5", 0, 0) is None  # no tokens → None


def test_cost_estimate_degrades_on_unpriced_model():
    """An unpriced / newly-appeared model → cost None, never a crash or fake 0.
    (The effort bucket is price-independent, so telemetry stays honest on a
    model we haven't priced.)"""
    assert cost_estimate("some-model-not-yet-priced", 1000, 1000) is None
    assert cost_estimate("madrona-14b", 1000, 1000) is None  # the old mis-key


def test_resolve_model_identity_records_the_served_model():
    """§3 cost-attribution fix: under provider=claude the served model is
    agent_claude_model (the Claude client ignores agent_model), so the metric
    must record that — not a stale AGENT_MODEL — or cost mis-keys to None."""
    from types import SimpleNamespace
    from app.services.agent_plan_service import _resolve_model_identity

    claude = SimpleNamespace(
        agent_provider="claude", agent_claude_model="claude-haiku-4-5",
        agent_model="madrona-14b",
    )
    ident = _resolve_model_identity(claude, claude.agent_model)
    assert ident["model_provider"] == "claude"
    assert ident["model_id"] == "claude-haiku-4-5"  # served, not the stale agent_model
    assert cost_estimate(ident["model_id"], 1000, 1000) == pytest.approx(0.006)

    # ollama/runpod serve the requested model name as-is.
    ollama = SimpleNamespace(agent_provider="ollama", agent_model="qwen2.5:14b")
    assert _resolve_model_identity(ollama, ollama.agent_model)["model_id"] == "qwen2.5:14b"


def test_weight_normalizes_within_plan():
    assert weight(0, 100) == 0.0
    assert weight(2750, 2750) == 1.0  # the heaviest step → ~1.0
    assert 0 < weight(100, 2750) < 1


# ── capture + serialization (integration) ────────────────────────────────────

@pytest.fixture
def org(db_session):
    o = Organization(name="Metric Museum", slug=f"m-{uuid4().hex[:8]}")
    db_session.add(o)
    db_session.commit()
    return o


@pytest.fixture
def user(db_session, org):
    u = User(email=f"u-{uuid4().hex[:8]}@example.com", display_name="U")
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


@pytest.fixture
def conversation(db_session, org, user):
    c = Conversation(
        organization_id=org.organization_id, user_id=user.user_id, persona="staff"
    )
    db_session.add(c)
    db_session.commit()
    return c


def _ctx(db_session, org, user):
    return AgentContext(
        organization_id=org.organization_id, user_id=user.user_id,
        persona="staff", db_session=db_session, org_slug="m",
    )


def test_tool_call_steps_record_deterministic_metrics(db_session, org, user, conversation):
    from app.models import AgentPlan
    from app.services.agent_plan_service import _serialize_context, _validate_steps

    ctx = _ctx(db_session, org, user)
    service = PlanService(db_session, ctx)
    # Two consecutive deterministic draft tool_calls with no await between, so
    # both run to completion and each records a metric — independent of any
    # template's pause structure (draft-chaining templates now park on sign-off).
    validated, err = _validate_steps([
        {"description": "Draft the acquisition", "kind": "tool_call",
         "tool": "propose_acquisition_draft", "persona": "registrar",
         "args": {"acquisition_method": "gift"}},
        {"description": "Draft the object entry", "kind": "tool_call",
         "tool": "propose_object_entry_draft", "persona": "registrar",
         "args": {"reason": "gift_offer"}},
    ])
    assert err is None, err
    plan = AgentPlan(
        conversation_id=conversation.conversation_id,
        organization_id=org.organization_id,
        persona_used="staff", goal="metrics", status="pending",
        context_snapshot=_serialize_context(ctx),
    )
    db_session.add(plan)
    db_session.flush()
    service._persist_steps(plan, validated)
    db_session.commit()

    run = PlanService(db_session).run_plan(plan.plan_id)
    assert not run.halted, run.last_error

    metrics = (
        db_session.query(AgentPlanStepMetric)
        .filter(AgentPlanStepMetric.plan_id == plan.plan_id)
        .all()
    )
    # One metric per executed (tool_call) step.
    assert len(metrics) == 2
    for m in metrics:
        # Deterministic draft tool_calls: one tool call, no measured LLM → honest NULLs.
        assert m.tool_calls == 1
        assert m.llm_rounds is None
        assert m.input_tokens is None
        assert m.cost_estimate_usd is None  # no model → no cost (not a fake 0)
        assert float(m.raw_effort) == 0.0
        assert m.latency_ms is not None and m.latency_ms >= 0

    # Serializer embeds the effort metric + a normalized weight + a rollup.
    serialized = _serialize_plan(plan, include_steps=True)
    assert all(s["effort"] is not None for s in serialized["steps"])
    assert all(s["effort"]["tool_calls"] == 1 for s in serialized["steps"])
    assert all(s["effort"]["weight"] == 0.0 for s in serialized["steps"])  # no AI cost
    assert serialized["effort_summary"]["total_tokens"] == 0
    assert serialized["effort_summary"]["cost_estimate_usd"] is None


def test_delegate_step_records_token_telemetry(db_session, org, user, conversation):
    """A delegate step's metric picks up tokens/rounds from the specialist run."""
    # Plan with a single delegate step.
    output = json.dumps({"goal": "g", "steps": [
        {"description": "Ask registrar", "kind": "delegate",
         "persona": "registrar", "args": {"question": "what's needed?"}},
    ]})
    with patch(
        "app.services.llm_client.get_llm_client",
        return_value=_StubPlanner(output),
    ):
        result = PlanService(db_session, _ctx(db_session, org, user)).create_plan(
            goal="g", conversation=conversation
        )
    assert result.error is None

    # Stub the specialist run to return token telemetry in its payload.
    fake_payload = {
        "specialist": "registrar", "answer": "ok", "rounds_used": 2,
        "_telemetry": {"llm_rounds": 2, "tool_calls": 1,
                       "input_tokens": 1200, "output_tokens": 300,
                       "delegation_depth": 1},
        "tool_calls": [],
    }

    class _Result:
        result_raw = fake_payload
        result_for_prompt = fake_payload

    class _Reg:
        def execute(self, name, args, ctx):
            return _Result()

    with patch("app.services.agent_tools.get_tool_registry", return_value=_Reg()):
        run = PlanService(db_session).run_plan(result.plan.plan_id)
    assert not run.halted

    m = (
        db_session.query(AgentPlanStepMetric)
        .filter(AgentPlanStepMetric.plan_id == result.plan.plan_id)
        .one()
    )
    assert m.input_tokens == 1200
    assert m.output_tokens == 300
    assert m.llm_rounds == 2
    assert m.delegation_depth == 1
    assert float(m.raw_effort) > 0  # real AI work registered


class _StubPlanner:
    def __init__(self, content):
        self._c = content

    def chat(self, *a, **k):
        from types import SimpleNamespace
        return SimpleNamespace(content=self._c, tool_calls=[])

    def chat_stream(self, *a, **k):
        raise NotImplementedError
