"""Tests for PlanService and the make_plan tool (Phase 2.1).

Three layers:

- TestParsePlannerJson — pure JSON parser tolerance.
- TestValidateSteps — schema validation rejects malformed plans wholesale.
- TestPlanServiceCreatePlan — end-to-end: stubs the planner LLM, runs
  PlanService.create_plan, asserts AgentPlan + AgentPlanSteps rows land.
- TestMakePlanTool — orchestration_tools handler enforces persona gating
  and conversation ownership.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from types import SimpleNamespace
from unittest.mock import patch
from uuid import UUID, uuid4

import pytest

from app.models import (
    AgentPlan,
    AgentPlanStep,
    Conversation,
    Organization,
    OrganizationMembership,
    Role,
    User,
)
from app.services.agent_plan_service import (
    MAX_PLAN_STEPS,
    PlanRunResult,
    PlanService,
    _parse_planner_json,
    _validate_steps,
    recover_stalled_plans,
)
from app.services.agent_tools import AgentContext


# --- LLM stub ---


@dataclass
class _StubChatResponse:
    content: str = ""
    tool_calls: list = field(default_factory=list)


class _StubLLM:
    def __init__(self, content_or_exc):
        self._payload = content_or_exc

    def chat(self, model, messages, tools, num_ctx):
        if isinstance(self._payload, Exception):
            raise self._payload
        return _StubChatResponse(content=self._payload)

    def chat_stream(self, *a, **kw):
        raise NotImplementedError


# --- fixtures ---


@pytest.fixture
def org(db_session):
    o = Organization(name="Test Museum", slug=f"test-{uuid4().hex[:8]}")
    db_session.add(o)
    db_session.commit()
    return o


@pytest.fixture
def user(db_session, org):
    u = User(
        email=f"user-{uuid4().hex[:8]}@example.com",
        display_name="Test User",
    )
    db_session.add(u)
    db_session.flush()

    # Reuse or create the system 'member' role — RBAC uses role_id (FK)
    # plus a legacy `role` string column. Both must be set for the
    # membership row to satisfy NOT NULL constraints.
    member_role = (
        db_session.query(Role)
        .filter(Role.role_key == "member", Role.is_system == True)  # noqa: E712
        .first()
    )
    if member_role is None:
        member_role = Role(
            role_key="member",
            display_name="Member",
            is_system=True,
        )
        db_session.add(member_role)
        db_session.flush()

    # Seed the org membership so plan permission re-validation passes.
    membership = OrganizationMembership(
        user_id=u.user_id,
        organization_id=org.organization_id,
        role="member",
        role_id=member_role.role_id,
    )
    db_session.add(membership)
    db_session.commit()
    return u


@pytest.fixture
def conversation(db_session, org, user):
    conv = Conversation(
        organization_id=org.organization_id,
        user_id=user.user_id,
        persona="staff",
    )
    db_session.add(conv)
    db_session.commit()
    return conv


@pytest.fixture
def staff_ctx(db_session, org, user):
    return AgentContext(
        organization_id=org.organization_id,
        user_id=user.user_id,
        persona="staff",
        db_session=db_session,
        org_slug="test",
        page_context={"route": "/collections/loans-in", "edit_mode": False},
    )


def _patch_planner_llm(content_or_exc):
    """Patch get_llm_client at its source. agent_plan_service does a
    function-local import, so the lookup happens against
    app.services.llm_client at call time."""
    return patch(
        "app.services.llm_client.get_llm_client",
        return_value=_StubLLM(content_or_exc),
    )


# --- JSON parser ---


class TestParsePlannerJson:
    def test_clean_object(self):
        result = _parse_planner_json('{"goal":"x","steps":[]}')
        assert result == {"goal": "x", "steps": []}

    def test_with_surrounding_prose(self):
        raw = (
            "Sure, here's the plan:\n"
            '{"goal":"x","steps":[]}\n'
            "let me know"
        )
        result = _parse_planner_json(raw)
        assert result is not None
        assert result["goal"] == "x"

    def test_unparseable(self):
        assert _parse_planner_json("definitely not json") is None

    def test_empty(self):
        assert _parse_planner_json("") is None

    def test_top_level_array_rejected(self):
        assert _parse_planner_json("[1,2,3]") is None


# --- step validation ---


class TestValidateSteps:
    def test_accepts_tool_call(self):
        steps, err = _validate_steps([
            {
                "description": "Look up loan workflow",
                "kind": "tool_call",
                "tool": "lookup_playbook",
                "args": {"key": "incoming-loan"},
            },
        ])
        assert err is None
        assert len(steps) == 1
        assert steps[0]["tool"] == "lookup_playbook"

    def test_accepts_delegate(self):
        steps, err = _validate_steps([
            {
                "description": "Ask the registrar",
                "kind": "delegate",
                "persona": "registrar",
                "args": {"question": "What's needed for cataloging?"},
            },
        ])
        assert err is None
        assert steps[0]["tool"] == "delegate_to_specialist"
        assert steps[0]["persona"] == "registrar"
        assert steps[0]["args"]["specialist"] == "registrar"
        assert steps[0]["args"]["question"]

    def test_accepts_await_with_approval(self):
        steps, err = _validate_steps([
            {
                "description": "Wait for registrar approval",
                "kind": "await",
                "wait_for": {
                    "kind": "approval_request",
                    "request_id": "00000000-0000-0000-0000-000000000000",
                },
            },
        ])
        assert err is None
        assert steps[0]["wait_for"]["kind"] == "approval_request"

    def test_rejects_invalid_kind(self):
        _, err = _validate_steps([
            {"description": "x", "kind": "execute"},
        ])
        assert err and "invalid kind" in err

    def test_rejects_missing_description(self):
        _, err = _validate_steps([
            {"kind": "tool_call", "tool": "search_collection"},
        ])
        assert err and "missing description" in err

    def test_rejects_tool_call_without_tool(self):
        _, err = _validate_steps([
            {"description": "x", "kind": "tool_call"},
        ])
        assert err and "missing tool name" in err

    def test_rejects_delegate_to_unknown_specialist(self):
        _, err = _validate_steps([
            {
                "description": "x",
                "kind": "delegate",
                "persona": "wizard",
                "args": {"question": "?"},
            },
        ])
        assert err and "invalid persona" in err

    def test_rejects_await_with_unknown_wait_kind(self):
        _, err = _validate_steps([
            {
                "description": "x",
                "kind": "await",
                "wait_for": {"kind": "skywriting"},
            },
        ])
        assert err and "invalid wait_for.kind" in err

    def test_accepts_await_job_completion(self):
        steps, err = _validate_steps([
            {
                "description": "Wait for transcription",
                "kind": "await",
                "wait_for": {
                    "kind": "job_completion",
                    "job_type": "transcription",
                    "entity": "media",
                    "entity_id": "00000000-0000-0000-0000-000000000001",
                },
            },
        ])
        assert err is None
        assert steps[0]["wait_for"]["kind"] == "job_completion"

    def test_rejects_await_job_completion_missing_fields(self):
        _, err = _validate_steps([
            {
                "description": "x",
                "kind": "await",
                "wait_for": {"kind": "job_completion", "job_type": "transcription"},
            },
        ])
        assert err and "job_completion" in err and "entity" in err

    def test_rejects_too_many_steps(self):
        oversize = [
            {"description": f"step {i}", "kind": "tool_call", "tool": "x"}
            for i in range(MAX_PLAN_STEPS + 1)
        ]
        _, err = _validate_steps(oversize)
        assert err and "exceeds" in err

    def test_zero_steps_is_valid(self):
        # Planner may legitimately punt on ambiguous goals
        steps, err = _validate_steps([])
        assert err is None
        assert steps == []


# --- PlanService.create_plan (DB-backed) ---


class TestPlanServiceCreatePlan:
    def test_persists_plan_and_steps_in_order(
        self, db_session, conversation, staff_ctx,
    ):
        planner_output = json.dumps({
            "goal": "Walk through receiving the Calder loan",
            "steps": [
                {
                    "description": "Pull the incoming-loan playbook",
                    "kind": "tool_call",
                    "tool": "lookup_playbook",
                    "args": {"key": "incoming-loan"},
                },
                {
                    "description": "Ask the loans registrar to confirm facility report",
                    "kind": "delegate",
                    "persona": "loans_registrar",
                    "args": {"question": "Is the facility report on file?"},
                },
                {
                    "description": "Wait for facility report approval",
                    "kind": "await",
                    "wait_for": {
                        "kind": "approval_request",
                        "request_id": "00000000-0000-0000-0000-000000000000",
                    },
                },
            ],
        })

        service = PlanService(db_session, staff_ctx)
        with _patch_planner_llm(planner_output):
            result = service.create_plan(
                goal="Walk through receiving the Calder loan from the Whitney",
                conversation=conversation,
            )

        assert result.error is None
        assert result.plan is not None
        plan = result.plan
        assert plan.status == "pending"
        assert plan.persona_used == "planner"
        assert plan.goal.startswith("Walk through")
        # Context snapshot captures the org/user/persona
        snap = plan.context_snapshot
        assert snap["organization_id"] == str(staff_ctx.organization_id)
        assert snap["persona"] == "staff"
        assert "page_context" in snap

        steps = (
            db_session.query(AgentPlanStep)
            .filter(AgentPlanStep.plan_id == plan.plan_id)
            .order_by(AgentPlanStep.idx)
            .all()
        )
        assert len(steps) == 3
        assert [s.idx for s in steps] == [0, 1, 2]
        assert steps[0].kind == "tool_call"
        assert steps[0].tool == "lookup_playbook"
        assert steps[1].kind == "delegate"
        assert steps[1].tool == "delegate_to_specialist"
        assert steps[1].persona == "loans_registrar"
        assert steps[2].kind == "await"
        assert steps[2].wait_for["kind"] == "approval_request"
        # All start pending
        assert {s.status for s in steps} == {"pending"}

    def test_pins_model_identity_on_plan_and_delegate_step(
        self, db_session, conversation, staff_ctx,
    ):
        """v1 §7.4: the planner's model is recorded on the plan; a
        delegate step records the specialist model. tool_call and await
        steps stay NULL (no inferred-model guess)."""
        planner_output = json.dumps({
            "goal": "Pin-test plan",
            "steps": [
                {
                    "description": "Look up the playbook",
                    "kind": "tool_call",
                    "tool": "lookup_playbook",
                    "args": {"key": "incoming-loan"},
                },
                {
                    "description": "Ask the registrar",
                    "kind": "delegate",
                    "persona": "registrar",
                    "args": {"question": "anything on file?"},
                },
            ],
        })

        service = PlanService(db_session, staff_ctx)
        with _patch_planner_llm(planner_output):
            result = service.create_plan(
                goal="Pin-test", conversation=conversation,
            )

        plan = result.plan
        assert plan is not None
        # Planner identity recorded; provider + id are non-empty, version
        # NULL (no Madrona provider reports a distinct version).
        assert isinstance(plan.model_provider, str) and plan.model_provider
        assert isinstance(plan.model_id, str) and plan.model_id
        assert plan.model_version is None

        steps = (
            db_session.query(AgentPlanStep)
            .filter(AgentPlanStep.plan_id == plan.plan_id)
            .order_by(AgentPlanStep.idx)
            .all()
        )
        # Steps are NULL at creation — pinning happens at execution time.
        assert all(s.model_id is None for s in steps)

        # Execute the delegate step; it should get the specialist model
        # pinned. Stub the specialist LLM so no network call is made.
        delegate_step = steps[1]
        with _patch_planner_llm(json.dumps({"answer": "nothing on file"})):
            ok, _result, _err = service._execute_step(delegate_step, staff_ctx)

        assert delegate_step.model_id is not None
        assert delegate_step.model_provider is not None
        assert delegate_step.model_version is None
        # tool_call step remains unpinned — not an inferred guess.
        assert steps[0].model_id is None

    def test_rejects_malformed_planner_output(
        self, db_session, conversation, staff_ctx,
    ):
        service = PlanService(db_session, staff_ctx)
        with _patch_planner_llm("not json at all"):
            result = service.create_plan(
                goal="Whatever",
                conversation=conversation,
            )
        assert result.plan is None
        assert result.error_kind == "parse_error"
        # Nothing persisted
        assert db_session.query(AgentPlan).count() == 0
        assert db_session.query(AgentPlanStep).count() == 0

    def test_rejects_invalid_step_kind_wholesale(
        self, db_session, conversation, staff_ctx,
    ):
        bad = json.dumps({
            "goal": "x",
            "steps": [
                {"description": "ok", "kind": "tool_call", "tool": "search_collection"},
                {"description": "bad", "kind": "execute"},
            ],
        })
        service = PlanService(db_session, staff_ctx)
        with _patch_planner_llm(bad):
            result = service.create_plan(
                goal="x",
                conversation=conversation,
            )
        assert result.plan is None
        assert result.error_kind == "validation_error"
        # Even the valid first step did not land
        assert db_session.query(AgentPlanStep).count() == 0

    def test_llm_error_falls_through_with_kind(
        self, db_session, conversation, staff_ctx,
    ):
        service = PlanService(db_session, staff_ctx)
        with _patch_planner_llm(RuntimeError("anthropic 503")):
            result = service.create_plan(
                goal="x",
                conversation=conversation,
            )
        assert result.plan is None
        assert result.error_kind == "llm_error"
        assert "anthropic 503" in result.error

    def test_empty_goal_short_circuits(
        self, db_session, conversation, staff_ctx,
    ):
        service = PlanService(db_session, staff_ctx)
        # No LLM patch needed — should not call LLM
        with patch(
            "app.services.llm_client.get_llm_client",
            side_effect=AssertionError("LLM should not be called for empty goal"),
        ):
            result = service.create_plan(
                goal="   ",
                conversation=conversation,
            )
        assert result.error_kind == "validation_error"

    def test_zero_step_plan_persists(
        self, db_session, conversation, staff_ctx,
    ):
        # An ambiguous goal can produce a zero-step plan with a clarifying
        # restatement. The service still persists the plan so the agent can
        # show the user what the planner concluded.
        service = PlanService(db_session, staff_ctx)
        output = json.dumps({
            "goal": "Need clarification: which object?",
            "steps": [],
        })
        with _patch_planner_llm(output):
            result = service.create_plan(
                goal="Help me",
                conversation=conversation,
            )
        assert result.error is None
        assert result.plan is not None
        assert len(result.steps) == 0
        assert "clarification" in result.plan.goal.lower()


# --- make_plan tool handler ---


class TestMakePlanTool:
    def test_staff_prompt_instructs_journey_launch(self):
        """The Guide prompt must tell the agent to launch journeys via make_plan
        for standard procedures, and never to ask for an internal conversation
        id — the guidance that fixes the generic-answer / asks-for-a-UUID
        failure."""
        from app.services.agent_tools.system_prompts import STAFF_SYSTEM_PROMPT
        p = STAFF_SYSTEM_PROMPT.lower()
        assert "make_plan" in p
        assert "journey" in p or "guided procedure" in p
        assert "conversation id" in p  # the explicit don't-ask-for-a-UUID guard

    def test_specialist_cannot_make_plan(self, db_session, org):
        from app.services.agent_tools.orchestration_tools import make_plan
        ctx = AgentContext(
            organization_id=org.organization_id,
            user_id=uuid4(),
            persona="registrar",
            db_session=db_session,
        )
        result = make_plan(
            {"goal": "x", "conversation_id": str(uuid4())},
            ctx,
        )
        assert "error" in result
        assert "not allowed to create plans" in result["error"]

    def test_missing_db_session_rejected(self, org):
        from app.services.agent_tools.orchestration_tools import make_plan
        ctx = AgentContext(
            organization_id=org.organization_id,
            user_id=uuid4(),
            persona="staff",
            db_session=None,
        )
        result = make_plan(
            {"goal": "x", "conversation_id": str(uuid4())},
            ctx,
        )
        assert "error" in result and "DB session" in result["error"]

    def test_missing_conversation_id(self, db_session, staff_ctx):
        # No conversation_id arg AND none on the context → still an error.
        from app.services.agent_tools.orchestration_tools import make_plan
        result = make_plan({"goal": "x"}, staff_ctx)
        assert "error" in result and "conversation_id is required" in result["error"]

    def test_conversation_id_comes_from_context_not_args(
        self, db_session, conversation, org, user,
    ):
        """The model must never be asked for an internal UUID: with no
        conversation_id arg, make_plan uses the active conversation from context.
        Combined with caller-provided params it launches the acquisition journey
        deterministically (no planner LLM) — the conversational trigger that
        previously fell through to a generic answer."""
        from app.services.agent_tools.orchestration_tools import make_plan
        ctx = AgentContext(
            organization_id=org.organization_id,
            user_id=user.user_id,
            persona="staff",
            db_session=db_session,
            conversation_id=conversation.conversation_id,
        )
        result = make_plan(
            {
                "goal": "start a new acquisition by purchase",
                "template_params": {
                    "acquisition_method": "purchase",
                    "object_number": "2026.Test.2",
                },
            },
            ctx,
        )
        assert "error" not in result, result
        # It instantiated the acquisition journey, not a free-form planner plan.
        tools = [s["tool"] for s in result["steps_preview"] if s["kind"] == "tool_call"]
        assert tools[0] == "propose_acquisition_draft"
        assert result["step_count"] == 7

    def test_unknown_conversation_id(self, db_session, staff_ctx):
        from app.services.agent_tools.orchestration_tools import make_plan
        result = make_plan(
            {"goal": "x", "conversation_id": str(uuid4())},
            staff_ctx,
        )
        assert "error" in result and "not found" in result["error"]

    def test_cross_org_conversation_rejected(
        self, db_session, conversation, staff_ctx,
    ):
        from app.services.agent_tools.orchestration_tools import make_plan
        # Conversation belongs to staff_ctx.organization_id; rebuild ctx
        # with a different org.
        other_ctx = AgentContext(
            organization_id=uuid4(),
            user_id=staff_ctx.user_id,
            persona="staff",
            db_session=db_session,
        )
        result = make_plan(
            {
                "goal": "x",
                "conversation_id": str(conversation.conversation_id),
            },
            other_ctx,
        )
        assert "error" in result and "different organization" in result["error"]

    def test_happy_path_returns_plan_id_and_preview(
        self, db_session, conversation, staff_ctx,
    ):
        from app.services.agent_tools.orchestration_tools import make_plan
        planner_output = json.dumps({
            "goal": "Walk through receiving the loan",
            "steps": [
                {
                    "description": "Pull the playbook",
                    "kind": "tool_call",
                    "tool": "lookup_playbook",
                    "args": {"key": "incoming-loan"},
                },
                {
                    "description": "Ask loans registrar",
                    "kind": "delegate",
                    "persona": "loans_registrar",
                    "args": {"question": "facility report?"},
                },
            ],
        })
        with _patch_planner_llm(planner_output):
            result = make_plan(
                {
                    "goal": "Walk me through this loan",
                    "conversation_id": str(conversation.conversation_id),
                },
                staff_ctx,
            )
        assert "error" not in result
        assert UUID(result["plan_id"])
        assert result["status"] == "pending"
        assert result["step_count"] == 2
        assert len(result["steps_preview"]) == 2
        assert result["steps_preview"][0]["idx"] == 0
        assert result["steps_preview"][1]["persona"] == "loans_registrar"


# --- Phase 2.2 executor (DB-backed) ---


def _make_plan_with_steps(
    db_session,
    conversation,
    staff_ctx,
    planner_steps: list[dict],
):
    """Helper: create a plan via PlanService with a scripted planner LLM."""
    output = json.dumps({"goal": "Test goal", "steps": planner_steps})
    service = PlanService(db_session, staff_ctx)
    with _patch_planner_llm(output):
        result = service.create_plan(
            goal="Test goal",
            conversation=conversation,
        )
    assert result.error is None, f"setup failed: {result.error}"
    return result.plan


class _FakeRegistry:
    """Stub tool registry for executor tests. Captures calls and serves
    scripted results without touching real tool handlers."""

    def __init__(self):
        self._results: dict[str, list] = {}
        self.calls: list[dict] = []

    def queue(self, tool_name: str, *results):
        self._results.setdefault(tool_name, []).extend(results)

    def execute(self, name, arguments, ctx):
        self.calls.append({
            "tool": name,
            "arguments": arguments,
            "persona": ctx.persona,
            "organization_id": str(ctx.organization_id) if ctx.organization_id else None,
        })
        queue = self._results.get(name)
        if not queue:
            from app.services.agent_tools import ToolExecutionResult
            err = {"error": f"no scripted result for {name}"}
            return ToolExecutionResult(result_for_prompt=err, result_raw=err)
        next_result = queue.pop(0)
        if isinstance(next_result, Exception):
            raise next_result
        from app.services.agent_tools import ToolExecutionResult
        return ToolExecutionResult(
            result_for_prompt=next_result,
            result_raw=next_result,
        )

    # Methods the registry interface expects but executor doesn't use here:
    def get_tools_for_persona(self, persona):  # pragma: no cover
        return []

    def get_all_tool_names(self):  # pragma: no cover
        return set(self._results)


def _patch_registry(registry):
    """Patch get_tool_registry as imported by agent_plan_service._execute_step."""
    return patch(
        "app.services.agent_tools.get_tool_registry",
        return_value=registry,
    )


class TestPlanExecutor:
    def test_runs_tool_call_steps_to_completion(
        self, db_session, conversation, staff_ctx,
    ):
        plan = _make_plan_with_steps(
            db_session, conversation, staff_ctx,
            [
                {
                    "description": "Look up incoming-loan playbook",
                    "kind": "tool_call",
                    "tool": "lookup_playbook",
                    "args": {"key": "incoming-loan"},
                },
                {
                    "description": "Search for related objects",
                    "kind": "tool_call",
                    "tool": "search_collection",
                    "args": {"q": "Calder"},
                },
            ],
        )

        registry = _FakeRegistry()
        registry.queue("lookup_playbook", {"steps": ["a", "b"]})
        registry.queue("search_collection", {"hits": []})

        service = PlanService(db_session)
        with _patch_registry(registry):
            run = service.run_plan(plan.plan_id)

        assert run is not None
        assert not run.halted
        assert run.steps_executed == 2

        db_session.refresh(plan)
        assert plan.status == "completed"
        assert plan.completed_at is not None

        from app.models import AgentPlanStep
        steps = (
            db_session.query(AgentPlanStep)
            .filter(AgentPlanStep.plan_id == plan.plan_id)
            .order_by(AgentPlanStep.idx)
            .all()
        )
        assert all(s.status == "completed" for s in steps)
        assert all(s.completed_at is not None for s in steps)
        # step_state checkpoint recorded
        assert all(
            s.step_state and "tool_calls_completed" in s.step_state
            for s in steps
        )
        # registry was called with executor-rehydrated persona ('staff')
        assert [c["tool"] for c in registry.calls] == [
            "lookup_playbook", "search_collection",
        ]
        assert all(c["persona"] == "staff" for c in registry.calls)

    def test_delegate_step_invokes_specialist_via_registry(
        self, db_session, conversation, staff_ctx,
    ):
        plan = _make_plan_with_steps(
            db_session, conversation, staff_ctx,
            [
                {
                    "description": "Ask the conservator",
                    "kind": "delegate",
                    "persona": "conservator",
                    "args": {"question": "What's the RH for silver?"},
                },
            ],
        )

        registry = _FakeRegistry()
        registry.queue("delegate_to_specialist", {
            "specialist": "conservator",
            "answer": "Keep RH between 35 and 55%; cite CCI Technical Bulletin 21.",
            "rounds_used": 1,
            "tool_calls": [],
        })

        service = PlanService(db_session)
        with _patch_registry(registry):
            run = service.run_plan(plan.plan_id)

        assert not run.halted
        db_session.refresh(plan)
        assert plan.status == "completed"
        assert registry.calls[0]["tool"] == "delegate_to_specialist"
        assert registry.calls[0]["arguments"]["specialist"] == "conservator"

    def test_mixed_plan_executes_in_order(
        self, db_session, conversation, staff_ctx,
    ):
        plan = _make_plan_with_steps(
            db_session, conversation, staff_ctx,
            [
                {"description": "Pull playbook", "kind": "tool_call",
                 "tool": "lookup_playbook", "args": {"key": "x"}},
                {"description": "Ask registrar", "kind": "delegate",
                 "persona": "registrar", "args": {"question": "?"}},
            ],
        )
        registry = _FakeRegistry()
        registry.queue("lookup_playbook", {"steps": []})
        registry.queue("delegate_to_specialist", {
            "specialist": "registrar", "answer": "ok",
            "rounds_used": 1, "tool_calls": [],
        })
        service = PlanService(db_session)
        with _patch_registry(registry):
            run = service.run_plan(plan.plan_id)
        assert not run.halted
        # Tools were invoked in declared order
        assert [c["tool"] for c in registry.calls] == [
            "lookup_playbook", "delegate_to_specialist",
        ]

    def test_await_step_halts_plan(
        self, db_session, conversation, staff_ctx,
    ):
        plan = _make_plan_with_steps(
            db_session, conversation, staff_ctx,
            [
                {"description": "Pull playbook", "kind": "tool_call",
                 "tool": "lookup_playbook", "args": {}},
                {
                    "description": "Wait for registrar approval",
                    "kind": "await",
                    "wait_for": {
                        "kind": "approval_request",
                        "request_id": "00000000-0000-0000-0000-000000000000",
                    },
                },
                {"description": "Search collection", "kind": "tool_call",
                 "tool": "search_collection", "args": {}},
            ],
        )
        registry = _FakeRegistry()
        registry.queue("lookup_playbook", {"steps": []})
        # search_collection should NEVER be called — await halts before it
        service = PlanService(db_session)
        with _patch_registry(registry):
            run = service.run_plan(plan.plan_id)

        assert run.halted is True
        assert run.halt_reason == "awaiting"
        db_session.refresh(plan)
        assert plan.status == "awaiting"

        from app.models import AgentPlanStep
        steps = (
            db_session.query(AgentPlanStep)
            .filter(AgentPlanStep.plan_id == plan.plan_id)
            .order_by(AgentPlanStep.idx)
            .all()
        )
        assert steps[0].status == "completed"
        # await step parked in awaiting_user (approval is user-driven)
        assert steps[1].status == "awaiting_user"
        # downstream steps stay pending; not skipped
        assert steps[2].status == "pending"
        # search_collection wasn't called
        assert all(c["tool"] != "search_collection" for c in registry.calls)

    def test_failure_halts_and_marks_remaining_skipped(
        self, db_session, conversation, staff_ctx,
    ):
        plan = _make_plan_with_steps(
            db_session, conversation, staff_ctx,
            [
                {"description": "Step 1", "kind": "tool_call",
                 "tool": "lookup_playbook", "args": {}},
                {"description": "Step 2 (fails)", "kind": "tool_call",
                 "tool": "search_collection", "args": {}},
                {"description": "Step 3", "kind": "tool_call",
                 "tool": "search_collection", "args": {}},
            ],
        )
        registry = _FakeRegistry()
        registry.queue("lookup_playbook", {"ok": True})
        # search_collection's first invocation returns an error result
        registry.queue("search_collection", {"error": "elasticsearch unavailable"})

        service = PlanService(db_session)
        with _patch_registry(registry):
            run = service.run_plan(plan.plan_id)

        assert run.halted is True
        assert run.halt_reason == "failed"
        assert run.steps_executed == 2  # step 1 + step 2 (fail)
        assert "elasticsearch unavailable" in (run.last_error or "")

        db_session.refresh(plan)
        assert plan.status == "failed"
        assert plan.last_error and "elasticsearch unavailable" in plan.last_error

        from app.models import AgentPlanStep
        steps = (
            db_session.query(AgentPlanStep)
            .filter(AgentPlanStep.plan_id == plan.plan_id)
            .order_by(AgentPlanStep.idx)
            .all()
        )
        assert steps[0].status == "completed"
        assert steps[1].status == "failed"
        assert steps[1].error and "elasticsearch unavailable" in steps[1].error
        assert steps[2].status == "skipped"  # remaining pending stays pending

    def test_empty_plan_completes_immediately(
        self, db_session, conversation, staff_ctx,
    ):
        plan = _make_plan_with_steps(
            db_session, conversation, staff_ctx, [],
        )
        registry = _FakeRegistry()
        service = PlanService(db_session)
        with _patch_registry(registry):
            run = service.run_plan(plan.plan_id)
        assert not run.halted
        assert run.steps_executed == 0
        db_session.refresh(plan)
        assert plan.status == "completed"
        assert registry.calls == []

    def test_idempotent_on_completed_plan(
        self, db_session, conversation, staff_ctx,
    ):
        plan = _make_plan_with_steps(
            db_session, conversation, staff_ctx,
            [{"description": "x", "kind": "tool_call",
              "tool": "lookup_playbook", "args": {}}],
        )
        registry = _FakeRegistry()
        registry.queue("lookup_playbook", {"ok": True})
        service = PlanService(db_session)
        with _patch_registry(registry):
            first = service.run_plan(plan.plan_id)
        assert not first.halted

        # Second invocation should be a no-op
        second_registry = _FakeRegistry()
        with _patch_registry(second_registry):
            second = service.run_plan(plan.plan_id)
        assert second.halted is True
        assert second.halt_reason == "already_done"
        assert second_registry.calls == []  # no tools invoked

    def test_unknown_plan_id_returns_none(self, db_session):
        service = PlanService(db_session)
        result = service.run_plan(uuid4())
        assert result is None

    def test_rehydrated_context_carries_org_user_persona(
        self, db_session, conversation, staff_ctx,
    ):
        plan = _make_plan_with_steps(
            db_session, conversation, staff_ctx,
            [{"description": "x", "kind": "tool_call",
              "tool": "lookup_playbook", "args": {}}],
        )
        registry = _FakeRegistry()
        registry.queue("lookup_playbook", {"ok": True})
        service = PlanService(db_session)
        with _patch_registry(registry):
            service.run_plan(plan.plan_id)
        assert registry.calls[0]["persona"] == "staff"
        assert registry.calls[0]["organization_id"] == str(staff_ctx.organization_id)


class TestRecoverStalledPlans:
    def test_resets_running_steps_to_pending(
        self, db_session, conversation, staff_ctx,
    ):
        plan = _make_plan_with_steps(
            db_session, conversation, staff_ctx,
            [{"description": "x", "kind": "tool_call",
              "tool": "lookup_playbook", "args": {}}],
        )
        # Manually park a step in 'running' to simulate a process crash
        from app.models import AgentPlanStep
        step = (
            db_session.query(AgentPlanStep)
            .filter(AgentPlanStep.plan_id == plan.plan_id)
            .first()
        )
        from datetime import datetime, timezone
        step.status = "running"
        step.started_at = datetime.now(timezone.utc)
        db_session.commit()

        n = recover_stalled_plans(db_session)
        assert n == 1

        db_session.refresh(step)
        assert step.status == "pending"
        assert step.started_at is None

    def test_noop_when_no_stalled_steps(self, db_session):
        n = recover_stalled_plans(db_session)
        assert n == 0

    def test_resumed_plan_completes_via_run_plan(
        self, db_session, conversation, staff_ctx,
    ):
        # Build a plan, mark its step running, recover, then run_plan
        # should cleanly complete it.
        plan = _make_plan_with_steps(
            db_session, conversation, staff_ctx,
            [{"description": "x", "kind": "tool_call",
              "tool": "lookup_playbook", "args": {}}],
        )
        plan.status = "running"
        from app.models import AgentPlanStep
        step = (
            db_session.query(AgentPlanStep)
            .filter(AgentPlanStep.plan_id == plan.plan_id)
            .first()
        )
        from datetime import datetime, timezone
        step.status = "running"
        step.started_at = datetime.now(timezone.utc)
        db_session.commit()

        recover_stalled_plans(db_session)
        registry = _FakeRegistry()
        registry.queue("lookup_playbook", {"ok": True})
        service = PlanService(db_session)
        with _patch_registry(registry):
            run = service.run_plan(plan.plan_id)
        assert not run.halted
        db_session.refresh(plan)
        assert plan.status == "completed"


# --- Phase 2.3 signal / resume / permission re-validation ---


def _make_awaiting_plan(
    db_session, conversation, staff_ctx,
    wait_for: dict,
    pre_step_tool: str = "lookup_playbook",
    post_steps: list[dict] | None = None,
):
    """Build a plan: tool_call → await(wait_for) → optional post-steps,
    then run it so the await step is parked and remaining steps stay pending.
    """
    steps_yaml = [
        {"description": "Pre", "kind": "tool_call",
         "tool": pre_step_tool, "args": {}},
        {"description": "Wait", "kind": "await", "wait_for": wait_for},
    ]
    if post_steps:
        steps_yaml.extend(post_steps)
    else:
        steps_yaml.append(
            {"description": "Post", "kind": "tool_call",
             "tool": "search_collection", "args": {}},
        )

    plan = _make_plan_with_steps(
        db_session, conversation, staff_ctx, steps_yaml,
    )

    registry = _FakeRegistry()
    registry.queue(pre_step_tool, {"ok": True})
    service = PlanService(db_session)
    with _patch_registry(registry):
        run = service.run_plan(plan.plan_id)
    assert run.halt_reason == "awaiting"
    return plan


class TestSignalAdvancesAwaitingStep:
    def test_signal_advances_then_resumes_plan(
        self, db_session, conversation, staff_ctx,
    ):
        from uuid import uuid4
        request_id = str(uuid4())
        plan = _make_awaiting_plan(
            db_session, conversation, staff_ctx,
            wait_for={"kind": "approval_request", "request_id": request_id},
        )

        # Find the awaiting step
        from app.models import AgentPlanStep
        await_step = (
            db_session.query(AgentPlanStep)
            .filter(
                AgentPlanStep.plan_id == plan.plan_id,
                AgentPlanStep.kind == "await",
            )
            .first()
        )
        assert await_step.status == "awaiting_user"

        # Signal approval — plan should complete via run_plan resumption
        registry = _FakeRegistry()
        registry.queue("search_collection", {"hits": []})
        service = PlanService(db_session)
        with _patch_registry(registry):
            run = service.signal(
                plan.plan_id,
                await_step.step_id,
                {
                    "kind": "approval_request",
                    "request_id": request_id,
                    "outcome": "approved",
                    "reviewed_by": str(uuid4()),
                },
            )

        assert run is not None
        assert not run.halted
        db_session.refresh(plan)
        assert plan.status == "completed"
        # Post-step actually ran
        assert any(c["tool"] == "search_collection" for c in registry.calls)

    def test_rejected_signal_fails_the_plan(
        self, db_session, conversation, staff_ctx,
    ):
        from uuid import uuid4
        request_id = str(uuid4())
        plan = _make_awaiting_plan(
            db_session, conversation, staff_ctx,
            wait_for={"kind": "approval_request", "request_id": request_id},
        )
        from app.models import AgentPlanStep
        await_step = (
            db_session.query(AgentPlanStep)
            .filter(AgentPlanStep.plan_id == plan.plan_id, AgentPlanStep.kind == "await")
            .first()
        )

        service = PlanService(db_session)
        run = service.signal(
            plan.plan_id, await_step.step_id,
            {
                "kind": "approval_request",
                "request_id": request_id,
                "outcome": "rejected",
                "note": "Insufficient documentation",
            },
        )
        assert run.halted is True
        assert run.halt_reason == "failed"
        db_session.refresh(plan)
        assert plan.status == "failed"
        assert "Insufficient documentation" in (plan.last_error or "")
        # Subsequent steps are now skipped
        steps = (
            db_session.query(AgentPlanStep)
            .filter(AgentPlanStep.plan_id == plan.plan_id)
            .order_by(AgentPlanStep.idx)
            .all()
        )
        assert steps[0].status == "completed"
        assert steps[1].status == "failed"
        assert steps[2].status == "skipped"

    def test_job_completion_signal_resumes_plan(
        self, db_session, conversation, staff_ctx,
    ):
        """§1D: a plan parked on a job_completion await (awaiting_external)
        resumes when the job completes — the mechanism scan_awaiting_jobs drives."""
        from uuid import uuid4
        from app.models import AgentPlanStep
        plan = _make_awaiting_plan(
            db_session, conversation, staff_ctx,
            wait_for={
                "kind": "job_completion",
                "job_type": "transcription",
                "entity": "media",
                "entity_id": str(uuid4()),
            },
        )
        await_step = (
            db_session.query(AgentPlanStep)
            .filter(AgentPlanStep.plan_id == plan.plan_id, AgentPlanStep.kind == "await")
            .first()
        )
        assert await_step.status == "awaiting_external"

        registry = _FakeRegistry()
        registry.queue("search_collection", {"hits": []})
        service = PlanService(db_session)
        with _patch_registry(registry):
            run = service.signal(
                plan.plan_id, await_step.step_id,
                {"kind": "job_completion", "outcome": "completed",
                 "job_type": "transcription"},
            )
        assert run is not None and not run.halted
        db_session.refresh(plan)
        assert plan.status == "completed"

    def test_job_completion_failure_fails_plan(
        self, db_session, conversation, staff_ctx,
    ):
        """A failed job (signal outcome=rejected) fails the plan cleanly."""
        from uuid import uuid4
        from app.models import AgentPlanStep
        plan = _make_awaiting_plan(
            db_session, conversation, staff_ctx,
            wait_for={
                "kind": "job_completion",
                "job_type": "transcription",
                "entity": "media",
                "entity_id": str(uuid4()),
            },
        )
        await_step = (
            db_session.query(AgentPlanStep)
            .filter(AgentPlanStep.plan_id == plan.plan_id, AgentPlanStep.kind == "await")
            .first()
        )
        service = PlanService(db_session)
        run = service.signal(
            plan.plan_id, await_step.step_id,
            {"kind": "job_completion", "outcome": "rejected",
             "note": "transcription job failed"},
        )
        assert run.halted and run.halt_reason == "failed"
        db_session.refresh(plan)
        assert plan.status == "failed"

    def test_signal_kind_mismatch_rejected(
        self, db_session, conversation, staff_ctx,
    ):
        from uuid import uuid4
        plan = _make_awaiting_plan(
            db_session, conversation, staff_ctx,
            wait_for={"kind": "approval_request", "request_id": str(uuid4())},
        )
        from app.models import AgentPlanStep
        await_step = (
            db_session.query(AgentPlanStep)
            .filter(AgentPlanStep.plan_id == plan.plan_id, AgentPlanStep.kind == "await")
            .first()
        )
        service = PlanService(db_session)
        run = service.signal(
            plan.plan_id, await_step.step_id,
            {"kind": "form_submission", "form": "x", "outcome": "completed"},
        )
        assert run.halt_reason == "signal_mismatch"
        db_session.refresh(plan)
        assert plan.status == "awaiting"
        db_session.refresh(await_step)
        assert await_step.status == "awaiting_user"

    def test_signal_request_id_mismatch_rejected(
        self, db_session, conversation, staff_ctx,
    ):
        from uuid import uuid4
        good_id = str(uuid4())
        wrong_id = str(uuid4())
        plan = _make_awaiting_plan(
            db_session, conversation, staff_ctx,
            wait_for={"kind": "approval_request", "request_id": good_id},
        )
        from app.models import AgentPlanStep
        await_step = (
            db_session.query(AgentPlanStep)
            .filter(AgentPlanStep.plan_id == plan.plan_id, AgentPlanStep.kind == "await")
            .first()
        )
        service = PlanService(db_session)
        run = service.signal(
            plan.plan_id, await_step.step_id,
            {
                "kind": "approval_request",
                "request_id": wrong_id,  # wrong
                "outcome": "approved",
            },
        )
        assert run.halt_reason == "signal_mismatch"

    def test_signal_on_non_awaiting_plan_rejected(
        self, db_session, conversation, staff_ctx,
    ):
        # A plan that's still 'pending' shouldn't accept signals
        plan = _make_plan_with_steps(
            db_session, conversation, staff_ctx,
            [{"description": "x", "kind": "tool_call",
              "tool": "lookup_playbook", "args": {}}],
        )
        from app.models import AgentPlanStep
        step = (
            db_session.query(AgentPlanStep)
            .filter(AgentPlanStep.plan_id == plan.plan_id)
            .first()
        )
        service = PlanService(db_session)
        run = service.signal(
            plan.plan_id, step.step_id,
            {"kind": "approval_request", "outcome": "approved"},
        )
        assert run.halt_reason == "not_awaiting"

    def test_signal_unknown_step_rejected(
        self, db_session, conversation, staff_ctx,
    ):
        from uuid import uuid4
        plan = _make_awaiting_plan(
            db_session, conversation, staff_ctx,
            wait_for={"kind": "approval_request", "request_id": str(uuid4())},
        )
        service = PlanService(db_session)
        run = service.signal(
            plan.plan_id, uuid4(),
            {"kind": "approval_request", "outcome": "approved"},
        )
        assert run.halt_reason == "invalid_signal"


class TestPermissionRevalidation:
    def test_run_plan_fails_when_user_lost_membership(
        self, db_session, conversation, staff_ctx, org, user,
    ):
        # Build a fresh plan (with the seeded membership in place)
        plan = _make_plan_with_steps(
            db_session, conversation, staff_ctx,
            [{"description": "x", "kind": "tool_call",
              "tool": "lookup_playbook", "args": {}}],
        )

        # Simulate revocation: delete the user's org membership row.
        # On the next run_plan, permission re-validation must catch the
        # missing grant and fail the plan before any tool runs.
        (
            db_session.query(OrganizationMembership)
            .filter(
                OrganizationMembership.user_id == user.user_id,
                OrganizationMembership.organization_id == org.organization_id,
            )
            .delete()
        )
        db_session.commit()

        registry = _FakeRegistry()
        service = PlanService(db_session)
        with _patch_registry(registry):
            run = service.run_plan(plan.plan_id)

        assert run.halted is True
        assert run.halt_reason == "failed"
        assert "membership" in (run.last_error or "")
        # No tool calls happened
        assert registry.calls == []
        # All steps marked skipped
        from app.models import AgentPlanStep
        steps = (
            db_session.query(AgentPlanStep)
            .filter(AgentPlanStep.plan_id == plan.plan_id)
            .all()
        )
        assert all(s.status == "skipped" for s in steps)


class TestApprovalHook:
    def test_approval_decision_signals_awaiting_plan(
        self, db_session, conversation, staff_ctx, org, user,
    ):
        # Membership is seeded by the `user` fixture. Build the approval
        # rule + request that the plan will wait on.
        from app.models.core_org import ApprovalRule, ApprovalRequest
        rule = ApprovalRule(
            organization_id=org.organization_id,
            entity_type="loan_in",
            trigger_action="status_change",
            approver_permission="loans.approve",
        )
        db_session.add(rule)
        db_session.flush()

        from uuid import uuid4
        request = ApprovalRequest(
            rule_id=rule.rule_id,
            organization_id=org.organization_id,
            entity_type="loan_in",
            entity_id=uuid4(),
            requested_by=user.user_id,
            requested_action={"to_status": "approved"},
            status="pending",
        )
        db_session.add(request)
        db_session.flush()
        request_id = request.request_id
        db_session.commit()

        # Build a plan that awaits this request
        plan = _make_awaiting_plan(
            db_session, conversation, staff_ctx,
            wait_for={"kind": "approval_request", "request_id": str(request_id)},
        )

        # Now decide the approval — the hook should signal the plan
        from app.services.approval_service import review_approval

        registry = _FakeRegistry()
        registry.queue("search_collection", {"hits": []})
        with _patch_registry(registry):
            review_approval(
                request_id=request_id,
                reviewer_id=user.user_id,
                decision="approved",
                note="ok",
                session=db_session,
            )
            db_session.commit()

        db_session.refresh(plan)
        assert plan.status == "completed"
        # Post-await step actually executed via the hook → signal → run_plan path
        assert any(c["tool"] == "search_collection" for c in registry.calls)


class TestApprovalForwardPath:
    """Forward path: run_plan creates the ApprovalRequest backing an approval
    await and binds its real id, so the request surfaces in the Approvals UI
    and the existing resume path (TestApprovalHook) can actually fire.

    TestApprovalHook covers resume with a hand-built request; this covers the
    executor *creating* that request — the piece that was previously missing."""

    def test_approval_await_creates_request_then_resumes(
        self, db_session, conversation, staff_ctx, user,
    ):
        plan = _make_plan_with_steps(
            db_session, conversation, staff_ctx,
            [
                {"description": "Pull playbook", "kind": "tool_call",
                 "tool": "lookup_playbook", "args": {}},
                {"description": "Wait for approval", "kind": "await",
                 "wait_for": {
                     "kind": "approval_request",
                     "request_id": "00000000-0000-0000-0000-000000000000",
                 }},
                {"description": "Search collection", "kind": "tool_call",
                 "tool": "search_collection", "args": {}},
            ],
        )
        registry = _FakeRegistry()
        registry.queue("lookup_playbook", {"steps": []})
        registry.queue("search_collection", {"results": []})

        # 1. Run halts at the approval await, having created a real request.
        with _patch_registry(registry):
            run = PlanService(db_session).run_plan(plan.plan_id)
        assert run.halt_reason == "awaiting"

        from app.models.core_org import ApprovalRequest
        steps = (
            db_session.query(AgentPlanStep)
            .filter(AgentPlanStep.plan_id == plan.plan_id)
            .order_by(AgentPlanStep.idx)
            .all()
        )
        await_step = steps[1]
        assert await_step.status == "awaiting_user"

        # Placeholder request_id replaced with the real one.
        rid = await_step.wait_for["request_id"]
        assert rid != "00000000-0000-0000-0000-000000000000"

        req = (
            db_session.query(ApprovalRequest)
            .filter(ApprovalRequest.request_id == UUID(rid))
            .first()
        )
        assert req is not None
        assert req.entity_type == "agent_plan"
        assert req.entity_id == await_step.step_id
        assert req.status == "pending"
        # Downstream step has NOT run yet.
        assert all(c["tool"] != "search_collection" for c in registry.calls)

        # 2. Approve via the real approvals path → plan resumes to completion.
        from app.services.approval_service import review_approval
        with _patch_registry(registry):
            review_approval(req.request_id, user.user_id, "approved", None, db_session)

        db_session.refresh(plan)
        db_session.refresh(await_step)
        assert await_step.status == "completed"
        assert plan.status == "completed"
        assert any(c["tool"] == "search_collection" for c in registry.calls)

    def test_approval_rejected_fails_plan(
        self, db_session, conversation, staff_ctx, user,
    ):
        plan = _make_plan_with_steps(
            db_session, conversation, staff_ctx,
            [
                {"description": "Wait for approval", "kind": "await",
                 "wait_for": {
                     "kind": "approval_request",
                     "request_id": "00000000-0000-0000-0000-000000000000",
                 }},
                {"description": "Search collection", "kind": "tool_call",
                 "tool": "search_collection", "args": {}},
            ],
        )
        registry = _FakeRegistry()
        registry.queue("search_collection", {"results": []})

        with _patch_registry(registry):
            PlanService(db_session).run_plan(plan.plan_id)

        await_step = (
            db_session.query(AgentPlanStep)
            .filter(AgentPlanStep.plan_id == plan.plan_id)
            .order_by(AgentPlanStep.idx)
            .first()
        )
        rid = UUID(await_step.wait_for["request_id"])

        from app.services.approval_service import review_approval
        with _patch_registry(registry):
            review_approval(rid, user.user_id, "rejected", "not now", db_session)

        db_session.refresh(plan)
        assert plan.status == "failed"
        # Downstream step never ran.
        assert all(c["tool"] != "search_collection" for c in registry.calls)


class TestPersonaScopedToolCall:
    """§1E enabler: a tool_call step may run under a specialist's persona so a
    template can deterministically call a specialist-allowlisted tool (e.g. a
    propose_<entity>_draft tool the plan's default 'staff' persona can't)."""

    def test_tool_call_runs_under_step_persona(
        self, db_session, conversation, staff_ctx,
    ):
        plan = _make_plan_with_steps(db_session, conversation, staff_ctx, [
            {
                "description": "Propose a condition report",
                "kind": "tool_call",
                "tool": "propose_condition_report_draft",
                "persona": "conservator",
                "args": {"object_id": "x"},
            },
        ])
        registry = _FakeRegistry()
        registry.queue("propose_condition_report_draft", {"draft_id": "d"})
        with _patch_registry(registry):
            run = PlanService(db_session).run_plan(plan.plan_id)
        assert not run.halted
        # The tool ran under the conservator allowlist, not the plan's staff persona.
        assert registry.calls[0]["persona"] == "conservator"

    def test_tool_call_defaults_to_plan_persona(
        self, db_session, conversation, staff_ctx,
    ):
        plan = _make_plan_with_steps(db_session, conversation, staff_ctx, [
            {
                "description": "Search",
                "kind": "tool_call",
                "tool": "search_collection",
                "args": {},
            },
        ])
        registry = _FakeRegistry()
        registry.queue("search_collection", {"hits": []})
        with _patch_registry(registry):
            PlanService(db_session).run_plan(plan.plan_id)
        assert registry.calls[0]["persona"] == "staff"

    def test_validate_rejects_unknown_tool_call_persona(self):
        _, err = _validate_steps([
            {
                "description": "x",
                "kind": "tool_call",
                "tool": "propose_condition_report_draft",
                "persona": "wizard",
            },
        ])
        assert err and "invalid persona" in err


class TestPlanTemplates:
    """§1E: create_plan instantiates a deterministic template (explicit id or
    trigger-phrase match) instead of free-form planning; the plan then runs
    through the real executor with persona-scoped draft tool_calls."""

    def test_explicit_template_instantiates_multistep_plan(
        self, db_session, conversation, staff_ctx,
    ):
        service = PlanService(db_session, staff_ctx)
        result = service.create_plan(
            goal="acquire a new gift",
            conversation=conversation,
            template_id="acquisition_accession",
            template_params={
                "acquisition_method": "gift", "source_name": "A. Donor",
                "object_number": "2026.9",
            },
        )
        assert result.error is None, result.error
        # Deterministic — no planner LLM produced it.
        assert result.plan.model_id is None
        steps = sorted(result.steps, key=lambda s: s.idx)
        # propose → curator provenance/significance review → board sign-off →
        # entry → catalog → catalog sign-off → intake condition report.
        assert [s.kind for s in steps] == [
            "tool_call", "delegate", "await", "tool_call", "tool_call", "await", "tool_call",
        ]
        assert [s.tool for s in steps if s.kind == "tool_call"] == [
            "propose_acquisition_draft", "propose_object_entry_draft",
            "propose_collection_object_draft", "propose_condition_report_draft",
        ]
        assert steps[0].persona == "registrar"
        assert steps[0].args["acquisition_method"] == "gift"
        assert steps[1].kind == "delegate" and steps[1].persona == "curator"
        assert steps[2].wait_for == {"kind": "draft_approval", "from_step": 0}

    def test_trigger_phrase_match_with_object_context(
        self, db_session, org, user, conversation,
    ):
        from uuid import uuid4
        obj_id = uuid4()
        ctx = AgentContext(
            organization_id=org.organization_id,
            user_id=user.user_id,
            persona="staff",
            db_session=db_session,
            org_slug="test",
            context_entity_type="collection_object",
            context_entity_id=obj_id,
        )
        service = PlanService(db_session, ctx)
        result = service.create_plan(
            goal="we need to receive an incoming loan", conversation=conversation,
        )
        assert result.error is None, result.error
        steps = sorted(result.steps, key=lambda s: s.idx)
        # loan record → signed-agreement sign-off → arrival condition report.
        assert steps[0].tool == "propose_loan_in_draft"
        assert steps[1].kind == "await"
        assert steps[1].wait_for["kind"] == "draft_approval"
        assert steps[2].tool == "propose_condition_report_draft"
        # object_id was pulled from the viewed-object context.
        assert steps[2].args["object_id"] == str(obj_id)

    def test_template_plan_runs_and_pauses_on_signoff(
        self, db_session, conversation, staff_ctx, monkeypatch,
    ):
        """End-to-end: a template plan executes under the real registry and the
        first persona-scoped tool_call actually creates a draft — then the plan
        PAUSES on that draft's sign-off (draft-chaining) rather than firing the
        whole packet. (Full run-to-completion is covered by the chaining suite.)"""
        from app.models import AgentDraft
        service = PlanService(db_session, staff_ctx)
        result = service.create_plan(
            goal="acquire a new gift",
            conversation=conversation,
            template_id="acquisition_accession",
            template_params={
                "acquisition_method": "gift", "source_name": "A. Donor",
                "object_number": "2026.10",
            },
        )
        assert result.error is None

        # Stub the curator delegate (between the proposal draft and the board
        # await) so the run stays LLM-free; the behavior under test is the
        # deterministic draft + pause-on-sign-off.
        from app.services.agent_tools import get_tool_registry, ToolExecutionResult
        _reg = get_tool_registry()
        _orig_execute = _reg.execute

        def _stub_execute(tool_name, arguments, context):
            if tool_name == "delegate_to_specialist":
                advisory = {"answer": "Provenance clear; a significant gift."}
                return ToolExecutionResult(result_for_prompt=advisory, result_raw=advisory)
            return _orig_execute(tool_name, arguments, context)

        monkeypatch.setattr(_reg, "execute", _stub_execute)

        # Run with the REAL registry (no _patch_registry).
        run = PlanService(db_session).run_plan(result.plan.plan_id)
        # Parks on the acquisition (board) sign-off.
        assert run.halted and run.halt_reason == "awaiting"
        db_session.refresh(result.plan)
        assert result.plan.status == "awaiting"

        # Only the acquisition draft exists so far — downstream steps run after
        # the human approves it.
        drafts = (
            db_session.query(AgentDraft)
            .filter(AgentDraft.conversation_id == conversation.conversation_id)
            .all()
        )
        types = sorted(d.entity_type for d in drafts)
        assert types == ["acquisition"]
