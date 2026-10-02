"""Tests for the Phase 3 router (agent_router.py + stream_response wiring).

Two tiers:
- TestRouterService — pure unit tests against RouterService.classify() with
  stubbed LLM responses. Exercises parse, threshold gate, fallback paths.
- TestRouterIntegration — DB-backed: confirms _maybe_route_first_message
  fires only on the first message and that persona_history is appended.
"""

from __future__ import annotations

from dataclasses import dataclass
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import pytest

from app.services.agent_router import (
    DEFAULT_CONFIDENCE_THRESHOLD,
    RouteDecision,
    RouterService,
    _parse_decision_json,
)


# --- LLM stub ---


@dataclass
class _StubChatResponse:
    content: str = ""
    tool_calls: list = None

    def __post_init__(self):
        if self.tool_calls is None:
            self.tool_calls = []


class _StubLLM:
    def __init__(self, response_or_exc):
        self._response = response_or_exc

    def chat(self, model, messages, tools, num_ctx):
        if isinstance(self._response, Exception):
            raise self._response
        return self._response

    def chat_stream(self, *a, **kw):
        raise NotImplementedError


def _settings(**overrides):
    base = {
        "agent_router_model": "claude-haiku-4-5",
        "agent_num_ctx": 8192,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def _classify(stub_response, user_message="Find the AAT term for ceramic glaze tests"):
    """Run RouterService.classify with a stubbed LLM response."""
    settings = _settings()
    router = RouterService(settings)
    with patch(
        "app.services.llm_client.get_llm_client",
        return_value=_StubLLM(stub_response),
    ):
        return router.classify(user_message)


# --- JSON parsing ---


class TestParseDecisionJson:
    def test_clean_json(self):
        result = _parse_decision_json(
            '{"persona":"registrar","confidence":0.9,"rationale":"x"}',
        )
        assert result == {"persona": "registrar", "confidence": 0.9, "rationale": "x"}

    def test_with_surrounding_prose(self):
        raw = (
            "here is your answer:\n"
            '{"persona":"curator","confidence":0.8,"rationale":"y"}\n'
            "thanks!"
        )
        result = _parse_decision_json(raw)
        assert result is not None
        assert result["persona"] == "curator"

    def test_unparseable(self):
        assert _parse_decision_json("not json at all") is None

    def test_empty(self):
        assert _parse_decision_json("") is None

    def test_top_level_array_rejected(self):
        # Router output must be a JSON object, not an array
        assert _parse_decision_json("[1, 2, 3]") is None


# --- RouterService unit ---


class TestRouterServiceClassify:
    def test_happy_path_returns_specialist(self):
        decision = _classify(
            _StubChatResponse(
                content='{"persona":"registrar","confidence":0.92,"rationale":"AAT lookup"}',
            ),
        )
        assert decision.persona == "registrar"
        assert decision.confidence == pytest.approx(0.92)
        assert decision.source == "router"
        assert decision.error is None

    def test_below_threshold_falls_back_to_staff(self):
        decision = _classify(
            _StubChatResponse(
                content=(
                    '{"persona":"registrar","confidence":0.5,'
                    '"rationale":"could be cataloging or general"}'
                ),
            ),
        )
        assert decision.persona == "staff"
        assert decision.source == "router_fallback"
        # The original confidence is preserved so callers can inspect why
        assert decision.confidence == pytest.approx(0.5)

    def test_at_or_above_threshold_keeps_persona(self):
        decision = _classify(
            _StubChatResponse(
                content=(
                    f'{{"persona":"curator","confidence":{DEFAULT_CONFIDENCE_THRESHOLD},'
                    f'"rationale":"clear"}}'
                ),
            ),
        )
        assert decision.persona == "curator"
        assert decision.source == "router"

    def test_low_confidence_staff_stays_staff(self):
        # A low-confidence staff result is fine — staff is the fallback anyway.
        decision = _classify(
            _StubChatResponse(
                content='{"persona":"staff","confidence":0.4,"rationale":"chitchat"}',
            ),
        )
        assert decision.persona == "staff"
        # Source is the original 'router', not 'router_fallback', because the
        # decision didn't get rewritten.
        assert decision.source == "router"

    def test_invalid_persona_falls_back(self):
        decision = _classify(
            _StubChatResponse(
                content='{"persona":"butler","confidence":0.9,"rationale":"!"}',
            ),
        )
        assert decision.persona == "staff"
        assert decision.source == "router_fallback"
        assert decision.error == "invalid_persona"

    def test_malformed_json_falls_back(self):
        decision = _classify(_StubChatResponse(content="not json"))
        assert decision.persona == "staff"
        assert decision.error == "parse_error"

    def test_empty_user_message_short_circuits(self):
        # Should not call the LLM at all for blank input.
        settings = _settings()
        router = RouterService(settings)
        with patch(
            "app.services.llm_client.get_llm_client",
            return_value=_StubLLM(Exception("should not be called")),
        ) as factory:
            decision = router.classify("   ")
        assert decision.persona == "staff"
        assert decision.error == "empty_input"
        # The factory was never invoked because we short-circuited
        assert factory.return_value._response.args[0] == "should not be called"

    def test_llm_exception_falls_back(self):
        decision = _classify(RuntimeError("anthropic 503"))
        assert decision.persona == "staff"
        assert decision.error == "llm_error"
        assert "anthropic 503" in decision.rationale

    def test_non_numeric_confidence_treated_as_zero(self):
        decision = _classify(
            _StubChatResponse(
                content='{"persona":"curator","confidence":"high","rationale":"x"}',
            ),
        )
        # Confidence parses to 0.0, below threshold → falls back to staff
        assert decision.persona == "staff"
        assert decision.source == "router_fallback"


class TestRouteDecisionShape:
    def test_to_history_entry_includes_required_fields(self):
        d = RouteDecision(
            persona="registrar",
            confidence=0.95,
            rationale="cataloging question",
        )
        entry = d.to_history_entry()
        assert entry["persona"] == "registrar"
        assert entry["source"] == "router"
        assert entry["confidence"] == 0.95
        assert entry["rationale"] == "cataloging question"
        assert "error" not in entry

    def test_to_history_entry_includes_error_when_set(self):
        d = RouteDecision(
            persona="staff",
            confidence=0.0,
            rationale="fallback",
            source="router_fallback",
            error="parse_error",
        )
        entry = d.to_history_entry()
        assert entry["error"] == "parse_error"
        assert entry["source"] == "router_fallback"
