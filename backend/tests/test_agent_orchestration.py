"""Tests for the multi-agent orchestration tool (delegate_to_specialist).

Phase 1 covers:
- specialists registered with policies and prompts
- delegating-persona-only access (recursion guard via PersonaPolicy.can_delegate)
- input validation (specialist enum, question presence/length)
- per-specialist tool allowlists honored when the specialist runs tool calls
- the bounded tool loop terminates (max rounds enforced)
- tool trace is reported back
"""

from dataclasses import dataclass
import contextlib
from unittest.mock import patch
from uuid import uuid4

import pytest

from app.services.agent_persona import (
    SPECIALIST_PERSONAS,
    get_persona_policy,
)
from app.services.agent_tools import AgentContext
from app.services.agent_tools.orchestration_tools import (
    MAX_SPECIALIST_QUESTION_LENGTH,
    MAX_SPECIALIST_TOOL_ROUNDS,
    delegate_to_specialist,
)


# --- helpers ---


@dataclass
class _StubChatResponse:
    content: str = ""
    tool_calls: list = None

    def __post_init__(self):
        if self.tool_calls is None:
            self.tool_calls = []


class _StubLLM:
    """Returns scripted ChatResponses round-by-round."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []

    def chat(self, model, messages, tools, num_ctx):
        self.calls.append({"messages": list(messages), "tools": tools})
        if not self._responses:
            return _StubChatResponse(content="ran out of scripted responses")
        return self._responses.pop(0)

    def chat_stream(self, *a, **kw):  # not used here
        raise NotImplementedError


def _staff_ctx() -> AgentContext:
    return AgentContext(
        organization_id=uuid4(),
        user_id=uuid4(),
        persona="staff",
        db_session=None,  # specialists' tools won't fire in these unit tests
    )


def _specialist_ctx(persona: str) -> AgentContext:
    return AgentContext(
        organization_id=uuid4(),
        user_id=uuid4(),
        persona=persona,
        db_session=None,
    )


# --- input validation ---


class TestInputValidation:
    def test_unknown_specialist_returns_error(self):
        result = delegate_to_specialist(
            {"specialist": "wizard", "question": "hi"},
            _staff_ctx(),
        )
        assert "error" in result
        assert "wizard" in result["error"]

    def test_specialist_must_be_string(self):
        result = delegate_to_specialist(
            {"specialist": 42, "question": "hi"},
            _staff_ctx(),
        )
        assert "error" in result

    def test_empty_question_rejected(self):
        result = delegate_to_specialist(
            {"specialist": "curator", "question": "   "},
            _staff_ctx(),
        )
        assert "error" in result
        assert "question is required" in result["error"]

    def test_question_too_long_rejected(self):
        big = "x" * (MAX_SPECIALIST_QUESTION_LENGTH + 1)
        result = delegate_to_specialist(
            {"specialist": "curator", "question": big},
            _staff_ctx(),
        )
        assert "error" in result
        assert "exceeds" in result["error"]


# --- recursion guard ---


class TestRecursionGuard:
    @pytest.mark.parametrize("persona", list(SPECIALIST_PERSONAS))
    def test_specialists_cannot_delegate(self, persona):
        ctx = _specialist_ctx(persona)
        result = delegate_to_specialist(
            {"specialist": "curator", "question": "hi"},
            ctx,
        )
        assert "error" in result
        assert "not allowed to delegate" in result["error"]

    def test_visitor_cannot_delegate(self):
        ctx = AgentContext(
            organization_id=uuid4(),
            user_id=uuid4(),
            persona="visitor",
            db_session=None,
        )
        result = delegate_to_specialist(
            {"specialist": "curator", "question": "hi"},
            ctx,
        )
        assert "error" in result
        assert "not allowed to delegate" in result["error"]

    def test_staff_can_delegate(self):
        # The recursion guard alone shouldn't block staff. We mock the runner
        # so we don't actually fire an LLM call.
        with patch(
            "app.services.agent_tools.orchestration_tools._run_specialist"
        ) as run_mock:
            from app.services.agent_tools.orchestration_tools import _SpecialistRun
            run_mock.return_value = _SpecialistRun(
                specialist="curator",
                answer="ok",
                rounds_used=1,
            )
            result = delegate_to_specialist(
                {"specialist": "curator", "question": "context for X?"},
                _staff_ctx(),
            )
        assert "error" not in result
        assert result["specialist"] == "curator"
        assert result["answer"] == "ok"


# --- bounded loop & tool trace ---


@contextlib.contextmanager
def _patch_runner_internals(stub_llm, prompt_text="SYSTEM PROMPT"):
    """Patch the dependencies _run_specialist needs without hitting Anthropic
    or Postgres. The LLM stub goes in at the get_llm_client source seam —
    specialist resolution flows through model_profiles' default profile,
    which constructs via get_llm_client."""
    with patch.multiple(
        "app.services.agent_tools.orchestration_tools",
        get_system_prompt=lambda db, org, persona: prompt_text,
        _get_registry_for_specialist=lambda: _StubRegistry(),
    ), patch(
        "app.services.llm_client.get_llm_client",
        lambda settings: stub_llm,
    ):
        yield


class _StubRegistry:
    """Minimal registry replacement that doesn't hit any real tool handlers."""

    def get_tools_for_persona(self, persona: str) -> list[dict]:
        # Return a couple of harmless schemas so the model has tools to call.
        return [
            {"type": "function", "function": {
                "name": "lookup_reference",
                "description": "ref",
                "parameters": {"type": "object", "properties": {}},
            }},
        ]

    def execute(self, name, arguments, ctx):
        from app.services.agent_tools import ToolExecutionResult
        payload = {"echo": name, "args": arguments}
        return ToolExecutionResult(result_for_prompt=payload, result_raw=payload)


class TestBoundedLoop:
    def test_terminates_when_model_emits_no_tool_calls(self):
        stub = _StubLLM([_StubChatResponse(content="final answer")])
        with _patch_runner_internals(stub):
            result = delegate_to_specialist(
                {"specialist": "curator", "question": "what now"},
                _staff_ctx(),
            )
        assert result["answer"] == "final answer"
        assert result["rounds_used"] == 1
        assert result["tool_calls"] == []
        assert "aborted" not in result

    def test_max_rounds_caps_runaway_loop(self):
        # Always return a tool_call → infinite loop without the cap.
        always_tool = _StubChatResponse(
            content="thinking",
            tool_calls=[{
                "id": "call_1",
                "function": {
                    "name": "lookup_reference",
                    "arguments": {"q": "x"},
                },
            }],
        )
        stub = _StubLLM([always_tool] * (MAX_SPECIALIST_TOOL_ROUNDS + 5))
        with _patch_runner_internals(stub):
            result = delegate_to_specialist(
                {"specialist": "registrar", "question": "?"},
                _staff_ctx(),
            )
        assert result["aborted"] is True
        assert result["rounds_used"] == MAX_SPECIALIST_TOOL_ROUNDS

    def test_tool_trace_records_calls(self):
        round_1 = _StubChatResponse(
            content="",
            tool_calls=[{
                "id": "c1",
                "function": {"name": "lookup_reference", "arguments": {"q": "a"}},
            }],
        )
        round_2 = _StubChatResponse(content="done")
        stub = _StubLLM([round_1, round_2])
        with _patch_runner_internals(stub):
            result = delegate_to_specialist(
                {"specialist": "conservator", "question": "?"},
                _staff_ctx(),
            )
        assert result["answer"] == "done"
        assert result["rounds_used"] == 2
        assert len(result["tool_calls"]) == 1
        assert result["tool_calls"][0]["tool"] == "lookup_reference"
        assert result["tool_calls"][0]["succeeded"] is True


# --- specialist prompt / tools wiring ---


class TestSpecialistWiring:
    @pytest.mark.parametrize("persona", list(SPECIALIST_PERSONAS))
    def test_each_specialist_has_prompt_fallback(self, persona):
        from app.services.prompt_service import _HARDCODED
        policy = get_persona_policy(persona)
        assert policy.system_prompt_key in _HARDCODED
        assert _HARDCODED[policy.system_prompt_key].strip() != ""

    @pytest.mark.parametrize("persona", list(SPECIALIST_PERSONAS))
    def test_each_specialist_cannot_delegate(self, persona):
        assert get_persona_policy(persona).can_delegate is False

    def test_only_staff_can_delegate(self):
        delegating = [
            n for n in (
                "staff", "visitor", "guide",
                *SPECIALIST_PERSONAS,
            ) if get_persona_policy(n).can_delegate
        ]
        assert delegating == ["staff"]

    @pytest.mark.parametrize("persona", list(SPECIALIST_PERSONAS))
    def test_specialist_tool_allowlist_is_subset_of_staff(self, persona):
        from app.services.agent_persona import _STAFF_TOOLS
        specialist = get_persona_policy(persona).allowed_tools
        # delegate_to_specialist isn't part of any specialist's allowlist
        assert "delegate_to_specialist" not in specialist
        # Write tools (propose_*) are intentionally specialist-only: the staff
        # generalist must NOT be able to free-form write (Guide Studio v1 §1.3 —
        # drafts flow through delegation/templates, not staff chat). Exempt them
        # from the "no privilege bumping" subset check, which governs the
        # read/general toolset.
        read_tools = {t for t in specialist if not t.startswith("propose_")}
        assert read_tools.issubset(_STAFF_TOOLS), (
            f"{persona} declares non-write tools the staff persona can't use: "
            f"{read_tools - _STAFF_TOOLS}"
        )
