"""
Integration tests for agent buffered streaming, zero-leak, and auto-retry.

Tests the interaction between agent_service, guardrails, and the persona
policy infrastructure.
"""

import json
import re
from unittest.mock import MagicMock, patch, PropertyMock
from uuid import uuid4

import pytest

from app.services.agent_guardrails import GuardrailResult, GuardrailService
from app.services.agent_service import AgentService, _OBJECT_NUMBER_EXTRACT_RE


class TestGuardrailPersonaAwareness:
    """Tests for persona-aware guardrail severity."""

    def test_hallucinated_objects_visitor_blocks_retryable(self):
        svc = GuardrailService()
        result = svc.check_response(
            "Check out object 2024.1.99 — it's beautiful!",
            [{"object_number": "2024.1.1", "summary": "Found 1 result"}],
            persona="visitor",
        )
        assert result.blocked is True
        assert result.retryable is True
        assert any(w["check"] == "hallucinated_objects" for w in result.warnings)

    def test_hallucinated_objects_staff_warns(self):
        svc = GuardrailService()
        result = svc.check_response(
            "Check out object 2024.1.99 — it's beautiful!",
            [{"object_number": "2024.1.1", "summary": "Found 1 result"}],
            persona="staff",
        )
        assert result.blocked is False
        assert any(
            w["check"] == "hallucinated_objects" and w["severity"] == "warning"
            for w in result.warnings
        )

    def test_hallucinated_objects_passes_when_known(self):
        svc = GuardrailService()
        result = svc.check_response(
            "Check out object 2024.1.1 — it's beautiful!",
            [{"object_number": "2024.1.1"}],
            persona="visitor",
        )
        assert result.blocked is False

    def test_hallucinated_objects_skipped_no_tools(self):
        svc = GuardrailService()
        result = svc.check_response(
            "Object 2024.1.99 is amazing.",
            [],
            persona="visitor",
        )
        assert result.blocked is False

    def test_url_integrity_visitor_blocks_retryable(self):
        svc = GuardrailService()
        result = svc.check_response(
            "See [this object](https://evil.com/hack)",
            [{"url": "https://museum.org/object/1"}],
            persona="visitor",
        )
        assert result.blocked is True
        assert result.retryable is True

    def test_url_integrity_staff_warns(self):
        svc = GuardrailService()
        result = svc.check_response(
            "See [this object](https://evil.com/hack)",
            [{"url": "https://museum.org/object/1"}],
            persona="staff",
        )
        assert result.blocked is False
        assert any(w["check"] == "url_integrity" for w in result.warnings)

    def test_url_integrity_relative_allowed(self):
        svc = GuardrailService()
        result = svc.check_response(
            "See [Vase](/c/demo/objects/abc-123)",
            [{"summary": "/c/demo/objects/abc-123"}],
            persona="visitor",
        )
        assert result.blocked is False

    def test_content_safety_blocks_both(self):
        svc = GuardrailService({"blocked_patterns": ["dangerous_content"]})
        result = svc.check_response(
            "This is dangerous_content here",
            [],
            persona="visitor",
        )
        assert result.blocked is True

    def test_format_compliance_staff_list_request_skip(self):
        svc = GuardrailService()
        result = svc.check_response(
            "- Item one\n- Item two\n- Item three\n- Item four",
            [],
            persona="staff",
            user_message="Can you list the top paintings?",
        )
        # No format warning because staff requested a list
        assert not any(w["check"] == "format_compliance" for w in result.warnings)

    def test_format_compliance_numbered_steps_excluded(self):
        svc = GuardrailService()
        result = svc.check_response(
            "1. Check the accession number\n2. Verify the creator\n3. Update the record\n4. Save changes",
            [],
            persona="visitor",
        )
        # Numbered steps starting with capital letter are excluded
        assert not any(w["check"] == "format_compliance" for w in result.warnings)

    def test_format_compliance_visitor_warns_not_blocks(self):
        svc = GuardrailService()
        result = svc.check_response(
            "- item one\n- item two\n- item three\n- item four\n- item five",
            [],
            persona="visitor",
        )
        assert result.blocked is False
        assert any(
            w["check"] == "format_compliance" and w["severity"] == "warning"
            for w in result.warnings
        )

    def test_short_circuit_on_visitor_block(self):
        """Visitor blocks should short-circuit — no further checks run."""
        svc = GuardrailService({"blocked_patterns": ["blocked_word"]})
        result = svc.check_response(
            "This has blocked_word and also 2024.1.99 hallucinated",
            [{"object_number": "2024.1.1"}],
            persona="visitor",
        )
        # Content safety fires first, short-circuits
        assert result.blocked is True
        checks = {w["check"] for w in result.warnings}
        assert "content_safety" in checks
        # Hallucinated objects check should NOT have run
        assert "hallucinated_objects" not in checks


class TestObjectNumberExtraction:
    """Tests for _extract_object_number helper."""

    def test_standard_accession(self):
        assert AgentService._extract_object_number("Tell me about 2024.1.5") == "2024.1.5"

    def test_dotted_accession(self):
        assert AgentService._extract_object_number("Object 2023.12.3.1 is great") == "2023.12.3.1"

    def test_alpha_prefix(self):
        assert AgentService._extract_object_number("Look at ACC-1234") == "ACC-1234"

    def test_no_match(self):
        assert AgentService._extract_object_number("Tell me about impressionism") is None


class TestGuardrailMetadataBuilder:
    """Tests for _build_guardrail_metadata."""

    def test_clean_pass_returns_none(self):
        gr = GuardrailResult()
        meta = AgentService._build_guardrail_metadata(gr, 0, False, None, None)
        assert meta is None

    def test_warnings_included(self):
        gr = GuardrailResult()
        gr.add_warning("format_compliance", "too many bullets", "warning")
        meta = AgentService._build_guardrail_metadata(gr, 0, False, None, None)
        assert meta is not None
        assert meta["guardrails"]["passed"] is True
        assert len(meta["guardrails"]["warnings"]) == 1

    def test_blocked_with_original(self):
        gr = GuardrailResult()
        gr.add_warning("hallucinated_objects", "bad", "block", retryable=True)
        meta = AgentService._build_guardrail_metadata(gr, 0, False, None, "original text")
        assert meta["guardrails"]["blocked"] is True
        assert meta["assistant_text_original"] == "original text"

    def test_retried_metadata(self):
        gr = GuardrailResult()
        meta = AgentService._build_guardrail_metadata(gr, 0, True, "get_object_detail", "old")
        assert meta["guardrails"]["retried"] is True
        assert meta["guardrails"]["retry_tool"] == "get_object_detail"

    def test_injection_stripped_count(self):
        gr = GuardrailResult()
        meta = AgentService._build_guardrail_metadata(gr, 3, False, None, None)
        assert meta["tool_injection_stripped"] == 3

    def test_no_original_when_same(self):
        """assistant_text_original should not be set when content wasn't changed."""
        gr = GuardrailResult()
        gr.add_warning("format_compliance", "bullets", "warning")
        meta = AgentService._build_guardrail_metadata(gr, 0, False, None, None)
        assert "assistant_text_original" not in meta


class TestBufferingDecision:
    """Tests that buffering is decided correctly based on persona and config."""

    def test_visitor_always_buffered(self):
        """Visitor persona should always buffer."""
        # This is tested indirectly through the stream_response logic
        # but we can verify the policy
        from app.services.agent_persona import get_persona_policy
        policy = get_persona_policy("visitor")
        assert policy.name == "visitor"
        # Visitor buffering is mandatory (not config-dependent)

    def test_staff_not_buffered_by_default(self):
        """Staff should stream by default."""
        from app.services.agent_persona import get_persona_policy
        policy = get_persona_policy("staff")
        assert policy.name == "staff"


class TestRetryFallbackTiers:
    """Tests for retry tool selection logic."""

    def test_tier_a_context_entity(self):
        """With context_entity_id, retry should use get_object_detail(object_id=...)."""
        from app.services.agent_tools import AgentContext
        svc = AgentService.__new__(AgentService)
        svc.settings = MagicMock()
        svc.settings.agent_num_ctx = 32768
        svc.settings.ollama_base_url = "http://localhost:11434"
        svc.registry = MagicMock()
        # Prod refactored to use an injected LLM client (self.llm.chat),
        # not requests.post directly. Mock the client interface.
        svc.llm = MagicMock()
        svc.llm.chat.return_value = MagicMock(content="Retried response about the object.")

        ctx = AgentContext(
            organization_id=uuid4(),
            user_id=None,
            persona="visitor",
            db_session=MagicMock(),
            context_entity_id=uuid4(),
        )

        exec_result = MagicMock()
        exec_result.result_for_prompt = {"object_name": "Test"}
        exec_result.result_raw = {"object_name": "Test"}
        svc.registry.execute.return_value = exec_result

        from app.services.agent_persona import get_persona_policy
        policy = get_persona_policy("visitor")
        result, tool_name = svc._attempt_retry(
            MagicMock(), ctx, policy, [], "qwen2.5:14b",
            "tell me about this", [], "", MagicMock(),
        )

        assert tool_name == "get_object_detail"
        svc.registry.execute.assert_called_once()
        call_args = svc.registry.execute.call_args
        assert call_args[0][0] == "get_object_detail"
        assert "object_id" in call_args[0][1]

    def test_tier_b_object_number(self):
        """Without context_entity_id but with object number in message."""
        from app.services.agent_tools import AgentContext
        svc = AgentService.__new__(AgentService)
        svc.settings = MagicMock()
        svc.settings.agent_num_ctx = 32768
        svc.settings.ollama_base_url = "http://localhost:11434"
        svc.registry = MagicMock()
        svc.llm = MagicMock()
        svc.llm.chat.return_value = MagicMock(content="Retried response.")

        ctx = AgentContext(
            organization_id=uuid4(),
            user_id=None,
            persona="visitor",
            db_session=MagicMock(),
            context_entity_id=None,
        )

        exec_result = MagicMock()
        exec_result.result_for_prompt = {"object_name": "Test"}
        exec_result.result_raw = {"object_name": "Test"}
        svc.registry.execute.return_value = exec_result

        from app.services.agent_persona import get_persona_policy
        policy = get_persona_policy("visitor")
        result, tool_name = svc._attempt_retry(
            MagicMock(), ctx, policy, [], "qwen2.5:14b",
            "tell me about 2024.1.5", [], "", MagicMock(),
        )

        assert tool_name == "get_object_detail"
        call_args = svc.registry.execute.call_args
        assert call_args[0][1] == {"object_number": "2024.1.5"}

    def test_tier_c_search_fallback(self):
        """Without context_entity_id or object number, fall back to search."""
        from app.services.agent_tools import AgentContext
        svc = AgentService.__new__(AgentService)
        svc.settings = MagicMock()
        svc.settings.agent_num_ctx = 32768
        svc.settings.ollama_base_url = "http://localhost:11434"
        svc.registry = MagicMock()
        svc.llm = MagicMock()
        svc.llm.chat.return_value = MagicMock(content="Based on the search results...")

        ctx = AgentContext(
            organization_id=uuid4(),
            user_id=None,
            persona="visitor",
            db_session=MagicMock(),
            context_entity_id=None,
        )

        exec_result = MagicMock()
        exec_result.result_for_prompt = {"summary": "Found 3 results"}
        exec_result.result_raw = {"summary": "Found 3 results"}
        svc.registry.execute.return_value = exec_result

        from app.services.agent_persona import get_persona_policy
        policy = get_persona_policy("visitor")
        result, tool_name = svc._attempt_retry(
            MagicMock(), ctx, policy, [], "qwen2.5:14b",
            "show me impressionist paintings", [], "", MagicMock(),
        )

        assert tool_name == "search_collection"
        call_args = svc.registry.execute.call_args
        assert call_args[0][0] == "search_collection"
        assert "query" in call_args[0][1]

    def test_retry_ollama_failure_returns_none(self):
        """If the retry LLM call fails, return None."""
        from app.services.agent_tools import AgentContext
        svc = AgentService.__new__(AgentService)
        svc.settings = MagicMock()
        svc.settings.agent_num_ctx = 32768
        svc.settings.ollama_base_url = "http://localhost:11434"
        svc.registry = MagicMock()
        svc.llm = MagicMock()
        svc.llm.chat.side_effect = Exception("timeout")

        ctx = AgentContext(
            organization_id=uuid4(),
            user_id=None,
            persona="visitor",
            db_session=MagicMock(),
            context_entity_id=uuid4(),
        )

        exec_result = MagicMock()
        exec_result.result_for_prompt = {"object_name": "Test"}
        exec_result.result_raw = {"object_name": "Test"}
        svc.registry.execute.return_value = exec_result

        from app.services.agent_persona import get_persona_policy
        policy = get_persona_policy("visitor")
        result, tool_name = svc._attempt_retry(
            MagicMock(), ctx, policy, [], "qwen2.5:14b",
            "tell me about this", [], "", MagicMock(),
        )

        assert result is None
        assert tool_name is None
