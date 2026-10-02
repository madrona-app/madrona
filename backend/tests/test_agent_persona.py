"""
Tests for agent persona policies.

Validates tool assignments, context field visibility, and policy lookup.
"""

import pytest

from app.services.agent_persona import (
    PersonaPolicy,
    get_persona_policy,
    _STAFF_TOOLS,
    _VISITOR_TOOLS,
)


class TestPersonaPolicyStaff:
    """Staff persona policy tests."""

    def test_staff_has_tools(self):
        policy = get_persona_policy("staff")
        assert len(policy.allowed_tools) >= 7

    def test_staff_tools_superset(self):
        policy = get_persona_policy("staff")
        # The staff policy has grown beyond the original 7 tools — assert the
        # original baseline is still present rather than pinning an exact set.
        baseline = {
            "search_collection", "get_object_detail", "find_related_objects",
            "lookup_vocabulary_term", "get_object_history", "suggest_cataloging",
            "get_record_summary",
        }
        assert baseline.issubset(policy.allowed_tools)

    def test_staff_no_injection_stripping(self):
        policy = get_persona_policy("staff")
        assert policy.strip_injection_in_prompt is False

    def test_staff_not_rate_limited(self):
        policy = get_persona_policy("staff")
        assert policy.rate_limited is False

    def test_staff_source_grounding_warn(self):
        policy = get_persona_policy("staff")
        assert policy.source_grounding_severity == "warn"

    def test_staff_museum_policy_warn(self):
        policy = get_persona_policy("staff")
        assert policy.museum_policy_severity == "warn"


class TestPersonaPolicyVisitor:
    """Visitor persona policy tests."""

    def test_visitor_has_tools(self):
        policy = get_persona_policy("visitor")
        assert len(policy.allowed_tools) >= 8

    def test_visitor_tools_superset(self):
        policy = get_persona_policy("visitor")
        baseline = {
            "search_collection", "get_object_detail", "find_related_objects",
            "list_current_exhibitions", "get_exhibition_info", "get_museum_info",
            "list_upcoming_events", "get_event_detail",
        }
        assert baseline.issubset(policy.allowed_tools)

    def test_visitor_has_materials(self):
        policy = get_persona_policy("visitor")
        assert "materials" in policy.context_fields

    def test_visitor_has_techniques(self):
        policy = get_persona_policy("visitor")
        assert "techniques" in policy.context_fields

    def test_visitor_has_dimensions(self):
        policy = get_persona_policy("visitor")
        assert "dimensions" in policy.context_fields

    def test_visitor_no_provenance(self):
        policy = get_persona_policy("visitor")
        assert "provenance" not in policy.context_fields

    def test_visitor_no_comments(self):
        policy = get_persona_policy("visitor")
        assert "comments" not in policy.context_fields

    def test_visitor_injection_stripping_enabled(self):
        policy = get_persona_policy("visitor")
        assert policy.strip_injection_in_prompt is True

    def test_visitor_rate_limited(self):
        policy = get_persona_policy("visitor")
        assert policy.rate_limited is True

    def test_visitor_source_grounding_block(self):
        policy = get_persona_policy("visitor")
        assert policy.source_grounding_severity == "block"

    def test_visitor_museum_policy_block(self):
        policy = get_persona_policy("visitor")
        assert policy.museum_policy_severity == "block"


class TestPersonaPolicyLookup:
    """Policy lookup and validation tests."""

    def test_unknown_raises(self):
        with pytest.raises(ValueError, match="Unknown persona"):
            get_persona_policy("admin")

    def test_unknown_empty_raises(self):
        with pytest.raises(ValueError):
            get_persona_policy("")

    def test_policy_is_frozen(self):
        policy = get_persona_policy("staff")
        with pytest.raises(AttributeError):
            policy.name = "hacked"

    def test_all_tools_assigned(self):
        """Every registered tool must appear in at least one persona policy.

        Uses a hardcoded list of all known registered tool names to avoid
        needing the full app context (which requires DB setup).
        """
        all_registered = {
            "search_collection", "get_object_detail", "find_related_objects",
            "lookup_vocabulary_term", "get_object_history", "suggest_cataloging",
            "get_record_summary",
            "list_current_exhibitions", "get_exhibition_info", "get_museum_info",
            "list_upcoming_events", "get_event_detail",
        }
        all_in_policies = _STAFF_TOOLS | _VISITOR_TOOLS
        orphans = all_registered - all_in_policies
        assert orphans == set(), f"Tools not assigned to any persona: {orphans}"

