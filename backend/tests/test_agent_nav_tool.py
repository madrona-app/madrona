"""
Tests for the navigate_to agent tool.

These tests exercise the pure matching logic (no DB, no Ollama) by mocking
out `_resolve_access` so every destination is reachable. Permission/app
filtering is covered by `test_nav_catalog.py` via the catalog's own
`filter_by_access`.
"""

from unittest.mock import patch
from uuid import uuid4

import pytest

from app.services.agent_tools import AgentContext
from app.services.agent_tools.nav_catalog import load_nav_catalog
from app.services.agent_tools.nav_tools import (
    _tokenize,
    navigate_to,
)


def _make_ctx() -> AgentContext:
    return AgentContext(
        organization_id=uuid4(),
        user_id=uuid4(),
        persona="staff",
        db_session=None,
    )


@pytest.fixture
def unrestricted_access():
    """Every destination is reachable — isolates matching behavior from RBAC."""
    catalog = load_nav_catalog()
    all_perms = {e.permission for e in catalog.entries if e.permission}
    all_apps = {e.app_key for e in catalog.entries if e.app_key}
    with patch(
        "app.services.agent_tools.nav_tools._resolve_access",
        return_value=(all_perms, all_apps),
    ):
        yield


class TestTokenize:
    def test_drops_stop_words(self):
        assert _tokenize("take me to conservation") == ["conservation"]
        assert _tokenize("where do I manage roles") == ["manage", "roles"]

    def test_lowercases_and_splits_punctuation(self):
        assert _tokenize("Loans-Out & Shipments!") == ["loans", "out", "shipments"]

    def test_empty(self):
        assert _tokenize("") == []
        assert _tokenize("the and of") == []


class TestNavigateToMatching:
    def test_requires_query(self, unrestricted_access):
        result = navigate_to({}, _make_ctx())
        assert "error" in result

    def test_single_word_exact_match(self, unrestricted_access):
        result = navigate_to({"query": "conservation"}, _make_ctx())
        assert result["best_match"] is not None
        assert result["best_match"]["id"] == "collections:conservation"
        assert "/conservation" in result["best_match"]["path"]
        assert result["_ui"]["kind"] == "navigation"
        assert result["_ui"]["target"]["id"] == "collections:conservation"

    def test_matches_via_synonym(self, unrestricted_access):
        # "lending" is a curated synonym for loans-out
        result = navigate_to({"query": "lending"}, _make_ctx())
        assert result["best_match"] is not None
        assert result["best_match"]["id"] == "collections:loans-out"

    def test_multiword_label_match(self, unrestricted_access):
        result = navigate_to({"query": "condition reports"}, _make_ctx())
        assert result["best_match"] is not None
        assert result["best_match"]["id"] == "collections:condition-reports"

    def test_natural_language_query(self, unrestricted_access):
        result = navigate_to(
            {"query": "take me to outgoing loans"}, _make_ctx()
        )
        assert result["best_match"] is not None
        assert result["best_match"]["id"] == "collections:loans-out"

    def test_where_do_i_phrasing(self, unrestricted_access):
        result = navigate_to(
            {"query": "where do i manage users"}, _make_ctx()
        )
        assert result["best_match"] is not None
        assert result["best_match"]["id"] == "admin:users"

    def test_product_filter_restricts_search(self, unrestricted_access):
        # "search" without filter could match bridge search or collections
        result = navigate_to(
            {"query": "search", "product": "bridge"}, _make_ctx()
        )
        # Either it matched the bridge search page, or nothing strong matched
        # — but the best_match must be in bridge if present.
        if result["best_match"]:
            assert result["best_match"]["product"] == "bridge"

    def test_low_confidence_flag(self, unrestricted_access):
        result = navigate_to({"query": "xyzzy quux"}, _make_ctx())
        assert result["best_match"] is None
        assert "Low confidence" in result["note"] or result["note"].startswith("No ")

    def test_no_ui_hint_on_low_confidence(self, unrestricted_access):
        result = navigate_to({"query": "xyzzy quux"}, _make_ctx())
        assert "_ui" not in result

    def test_alternatives_capped(self, unrestricted_access):
        result = navigate_to({"query": "collections"}, _make_ctx())
        # Many entries have 'collections' in breadcrumb — alternatives still capped
        assert len(result.get("alternatives", [])) <= 3

    def test_best_match_comes_before_alternatives(self, unrestricted_access):
        result = navigate_to({"query": "acquisitions"}, _make_ctx())
        assert result["best_match"] is not None
        assert result["best_match"]["id"] == "collections:acquisitions"
        # The best match should not also appear in alternatives
        alt_ids = [a["id"] for a in result.get("alternatives", [])]
        assert result["best_match"]["id"] not in alt_ids

    def test_path_preserves_orgid_placeholder(self, unrestricted_access):
        """Frontend substitutes :orgId at render time — backend must not pre-fill."""
        result = navigate_to({"query": "conservation"}, _make_ctx())
        assert ":orgId" in result["best_match"]["path"]
        assert ":orgId" in result["_ui"]["target"]["path"]


class TestNavigateToAccessFiltering:
    def test_no_permissions_drops_gated_destinations(self):
        """With zero permissions, only ungated destinations remain reachable."""
        with patch(
            "app.services.agent_tools.nav_tools._resolve_access",
            return_value=(set(), set()),
        ):
            result = navigate_to({"query": "conservation"}, _make_ctx())
            # conservation is permission-gated + app-gated — should not match
            assert result["best_match"] is None or (
                result["best_match"]["id"] != "collections:conservation"
            )

    def test_all_unreachable_returns_note(self):
        """When nothing is accessible, a clear note comes back."""
        catalog = load_nav_catalog()
        # Prove there ARE gated entries (otherwise the test is vacuous)
        gated = [e for e in catalog.entries if e.permission or e.app_key]
        assert gated, "Expected some gated entries in the catalog"

        # Only 'guide' app, no permissions — drops most collections destinations
        with patch(
            "app.services.agent_tools.nav_tools._resolve_access",
            return_value=(set(), set()),
        ):
            # Query that would otherwise match a gated destination
            result = navigate_to({"query": "acquisitions"}, _make_ctx())
            assert result["best_match"] is None
