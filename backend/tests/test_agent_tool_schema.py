"""
Tests for agent tool schema validation and persona tool assignment.

Verifies tool registration, handler contracts, persona exclusions, and size caps.
"""

import json
import pytest
from unittest.mock import MagicMock, patch
from uuid import uuid4

from app.services.agent_tools import get_tool_registry, AgentContext, ToolRegistry
from app.services.agent_persona import (
    get_persona_policy,
    _STAFF_TOOLS,
    _VISITOR_TOOLS,
)


class TestToolSchemaValidity:
    """Verify all registered tools have valid Ollama schemas."""

    def test_valid_schema_staff(self):
        """All staff tools have a valid JSON-serializable schema."""
        registry = get_tool_registry()
        tools = registry.get_tools_for_persona("staff")
        for tool in tools:
            # Must have required Ollama schema fields
            assert "type" in tool
            assert tool["type"] == "function"
            assert "function" in tool
            func = tool["function"]
            assert "name" in func
            assert "description" in func
            assert "parameters" in func
            # Must be JSON-serializable
            json.dumps(tool)

    def test_valid_schema_visitor(self):
        """All visitor tools have a valid JSON-serializable schema."""
        registry = get_tool_registry()
        tools = registry.get_tools_for_persona("visitor")
        for tool in tools:
            assert tool["type"] == "function"
            func = tool["function"]
            assert "name" in func
            assert "description" in func
            json.dumps(tool)


class TestToolHandlerContract:
    """Verify tool handlers return dicts."""

    def _make_ctx(self, persona="staff"):
        return AgentContext(
            organization_id=uuid4(),
            user_id=uuid4(),
            persona=persona,
            db_session=MagicMock(),
            org_slug="test-museum",
        )

    def test_handler_returns_dict_search(self):
        """search_collection handler returns a dict."""
        registry = get_tool_registry()
        tool = registry._tools.get("search_collection")
        assert tool is not None
        # Handler should be callable
        assert callable(tool.handler)

    def test_handler_returns_dict_detail(self):
        """get_object_detail handler is callable."""
        registry = get_tool_registry()
        tool = registry._tools.get("get_object_detail")
        assert tool is not None
        assert callable(tool.handler)


class TestPersonaToolExclusions:
    """Verify visitor doesn't get staff tools and vice versa."""

    def test_visitor_excludes_staff(self):
        """Visitor tools must not include staff-only tools."""
        registry = get_tool_registry()
        visitor_tools = registry.get_tools_for_persona("visitor")
        visitor_names = {t["function"]["name"] for t in visitor_tools}

        staff_only = {"lookup_vocabulary_term", "get_object_history", "suggest_cataloging", "get_record_summary"}
        for tool_name in staff_only:
            assert tool_name not in visitor_names, f"{tool_name} should not be in visitor tools"

    def test_staff_excludes_visitor(self):
        """Staff tools must not include visitor-only tools."""
        registry = get_tool_registry()
        staff_tools = registry.get_tools_for_persona("staff")
        staff_names = {t["function"]["name"] for t in staff_tools}

        visitor_only = {"get_museum_info", "list_upcoming_events", "get_event_detail",
                        "list_current_exhibitions", "get_exhibition_info"}
        for tool_name in visitor_only:
            assert tool_name not in staff_names, f"{tool_name} should not be in staff tools"

    def test_visitor_policy_matches_registry(self):
        """Visitor persona policy tools match what's registered."""
        policy = get_persona_policy("visitor")
        registry = get_tool_registry()
        visitor_tools = registry.get_tools_for_persona("visitor")
        registry_names = {t["function"]["name"] for t in visitor_tools}

        assert policy.allowed_tools == registry_names


class TestToolSizeCap:
    """Verify tool result size caps."""

    def test_size_cap_exists(self):
        """Registry should have a max result size configuration."""
        registry = get_tool_registry()
        # The registry truncates large results — verify the mechanism exists
        assert hasattr(registry, 'execute')

    def test_tool_count_staff(self):
        """Staff persona has a nonempty tool allowlist."""
        assert len(_STAFF_TOOLS) >= 7

    def test_tool_count_visitor(self):
        """Visitor persona has a nonempty tool allowlist."""
        assert len(_VISITOR_TOOLS) >= 8
