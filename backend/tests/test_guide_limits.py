"""Guide limits default by whether a query has a marginal cost.

The visitor widget is the only anonymous path to an LLM here. Where inference
is billed per use, an uncapped widget bills the operator for traffic off the
open internet, so an absent cap must not mean unlimited. Where capacity is
already paid for, counting queries protects nobody.
"""
from __future__ import annotations

import pytest

from app.services.guide_limits import (
    DEFAULT_MAX_DOCUMENTS,
    DEFAULT_WIDGET_QUERIES_ON_METERED_PROVIDER,
    default_widget_queries,
    provider_is_fixed_cost,
    resolve_max_documents,
    resolve_widget_queries,
)


class TestProviderClassification:
    @pytest.mark.parametrize("provider", ["ollama", "runpod", "OLLAMA"])
    def test_fixed_cost_providers_are_uncapped(self, provider):
        assert provider_is_fixed_cost(provider) is True
        assert default_widget_queries(provider) is None

    @pytest.mark.parametrize("provider", ["claude", "openai", "anthropic"])
    def test_per_use_billing_gets_a_finite_default(self, provider):
        assert provider_is_fixed_cost(provider) is False
        assert default_widget_queries(provider) == DEFAULT_WIDGET_QUERIES_ON_METERED_PROVIDER

    @pytest.mark.parametrize("provider", [None, "", "something-new"])
    def test_unknown_providers_fail_safe(self, provider):
        """An unrecognised provider is capped, not left open."""
        assert default_widget_queries(provider) == DEFAULT_WIDGET_QUERIES_ON_METERED_PROVIDER


class TestWidgetResolution:
    def test_absent_key_falls_back_to_the_provider_default(self):
        assert resolve_widget_queries({}, "claude") == DEFAULT_WIDGET_QUERIES_ON_METERED_PROVIDER
        assert resolve_widget_queries({}, "ollama") is None

    def test_explicit_null_means_uncapped_even_when_billed_per_use(self):
        """Absent and null are different: null is a deliberate choice.

        config.get() cannot tell these apart, which is the whole reason this
        resolution lives in one place.
        """
        assert resolve_widget_queries({"max_widget_queries": None}, "claude") is None

    def test_explicit_value_wins(self):
        assert resolve_widget_queries({"max_widget_queries": 25}, "claude") == 25
        assert resolve_widget_queries({"max_widget_queries": 25}, "ollama") == 25

    def test_zero_is_honoured_not_treated_as_absent(self):
        assert resolve_widget_queries({"max_widget_queries": 0}, "claude") == 0


class TestDocumentResolution:
    def test_default_when_unset(self):
        assert resolve_max_documents({}) == DEFAULT_MAX_DOCUMENTS
        assert resolve_max_documents({"max_documents": None}) == DEFAULT_MAX_DOCUMENTS

    def test_explicit_value_wins(self):
        assert resolve_max_documents({"max_documents": 500}) == 500
