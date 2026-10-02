"""
Unit tests for AI-assisted enrichment service.

Tests the AI enrichment functionality with mocked API responses.
"""

import pytest
from unittest.mock import MagicMock, patch, PropertyMock
import json

from app.services.ai_enrichment import (
    EnrichmentSuggestion,
    EnrichmentResult,
    AIEnrichmentService,
    suggest_missing_fields,
    enrich_record,
)


class TestEnrichmentSuggestion:
    """Test EnrichmentSuggestion dataclass."""

    def test_to_dict_includes_all_fields(self):
        """to_dict includes all fields."""
        suggestion = EnrichmentSuggestion(
            field="object_type",
            value="painting",
            confidence=0.9,
            reasoning="Based on medium 'oil on canvas'",
            source="ai",
        )
        d = suggestion.to_dict()
        assert d["field"] == "object_type"
        assert d["value"] == "painting"
        assert d["confidence"] == 0.9
        assert d["reasoning"] == "Based on medium 'oil on canvas'"
        assert d["source"] == "ai"

    def test_to_dict_omits_none_reasoning(self):
        """to_dict omits None reasoning."""
        suggestion = EnrichmentSuggestion(
            field="object_type",
            value="painting",
            confidence=0.9,
        )
        d = suggestion.to_dict()
        assert "reasoning" not in d


class TestEnrichmentResult:
    """Test EnrichmentResult dataclass."""

    def test_to_dict(self):
        """to_dict includes all statistics."""
        result = EnrichmentResult(
            record={"properties": {"title": "Test"}},
            suggestions=[
                EnrichmentSuggestion(field="object_type", value="painting", confidence=0.9)
            ],
            applied_count=1,
            skipped_count=2,
        )
        d = result.to_dict()
        assert len(d["suggestions"]) == 1
        assert d["applied_count"] == 1
        assert d["skipped_count"] == 2


class TestAIEnrichmentService:
    """Test AIEnrichmentService class."""

    def test_build_context_extracts_fields(self):
        """_build_context extracts relevant fields."""
        service = AIEnrichmentService()
        record = {
            "label": "The Starry Night",
            "type": "OBJECT",
            "properties": {
                "medium": "Oil on canvas",
                "date_display": "June 1889",
                "creator": "Vincent van Gogh",
            },
        }
        context = service._build_context(record)
        assert context["title"] == "The Starry Night"
        assert context["entity_type"] == "OBJECT"
        assert context["medium"] == "Oil on canvas"
        assert context["date_display"] == "June 1889"

    def test_build_context_limits_size(self):
        """_build_context limits context to prevent huge prompts."""
        service = AIEnrichmentService()
        # Create record with many properties
        record = {
            "properties": {f"field_{i}": f"value_{i}" for i in range(30)},
        }
        context = service._build_context(record)
        assert len(context) <= 15

    def test_parse_suggestions_valid_json(self):
        """_parse_suggestions handles valid JSON."""
        service = AIEnrichmentService()
        response = json.dumps({
            "suggestions": [
                {"field": "object_type", "value": "painting", "confidence": 0.9},
                {"field": "classification", "value": "Paintings", "confidence": 0.8},
            ]
        })
        suggestions = service._parse_suggestions(
            response, ["object_type", "classification"]
        )
        assert len(suggestions) == 2
        assert suggestions[0].field == "object_type"
        assert suggestions[0].value == "painting"

    def test_parse_suggestions_extracts_from_markdown(self):
        """_parse_suggestions extracts JSON from markdown."""
        service = AIEnrichmentService()
        response = """Here are my suggestions:

```json
{
  "suggestions": [
    {"field": "object_type", "value": "sculpture", "confidence": 0.85}
  ]
}
```

Hope this helps!"""
        suggestions = service._parse_suggestions(response, ["object_type"])
        assert len(suggestions) == 1
        assert suggestions[0].value == "sculpture"

    def test_parse_suggestions_handles_invalid_json(self):
        """_parse_suggestions handles invalid JSON gracefully."""
        service = AIEnrichmentService()
        response = "I think the object type is painting."
        suggestions = service._parse_suggestions(response, ["object_type"])
        assert suggestions == []

    def test_parse_suggestions_filters_unexpected_fields(self):
        """_parse_suggestions filters fields not in expected list."""
        service = AIEnrichmentService()
        response = json.dumps({
            "suggestions": [
                {"field": "object_type", "value": "painting", "confidence": 0.9},
                {"field": "unexpected_field", "value": "value", "confidence": 0.8},
            ]
        })
        suggestions = service._parse_suggestions(response, ["object_type"])
        assert len(suggestions) == 1
        assert suggestions[0].field == "object_type"

    @patch.object(AIEnrichmentService, 'anthropic_client', new_callable=PropertyMock)
    def test_suggest_missing_fields_no_client(self, mock_client):
        """Returns empty list when Anthropic client unavailable."""
        mock_client.return_value = None
        service = AIEnrichmentService()

        record = {"properties": {"title": "Test"}}
        suggestions = service.suggest_missing_fields(
            record, fields_to_suggest=["object_type"]
        )
        assert suggestions == []

    @patch.object(AIEnrichmentService, 'anthropic_client', new_callable=PropertyMock)
    def test_suggest_missing_fields_success(self, mock_client):
        """Returns suggestions from AI response."""
        mock_response = MagicMock()
        mock_response.content = [MagicMock(text=json.dumps({
            "suggestions": [
                {"field": "object_type", "value": "painting", "confidence": 0.9},
            ]
        }))]

        mock_anthropic = MagicMock()
        mock_anthropic.messages.create.return_value = mock_response
        mock_client.return_value = mock_anthropic

        service = AIEnrichmentService()
        record = {"properties": {"title": "Portrait", "medium": "Oil on canvas"}}
        suggestions = service.suggest_missing_fields(
            record, fields_to_suggest=["object_type"]
        )

        assert len(suggestions) == 1
        assert suggestions[0].field == "object_type"
        assert suggestions[0].value == "painting"

    @patch.object(AIEnrichmentService, 'anthropic_client', new_callable=PropertyMock)
    def test_suggest_filters_by_confidence(self, mock_client):
        """Filters out low-confidence suggestions."""
        mock_response = MagicMock()
        mock_response.content = [MagicMock(text=json.dumps({
            "suggestions": [
                {"field": "object_type", "value": "painting", "confidence": 0.9},
                {"field": "classification", "value": "Art", "confidence": 0.4},
            ]
        }))]

        mock_anthropic = MagicMock()
        mock_anthropic.messages.create.return_value = mock_response
        mock_client.return_value = mock_anthropic

        service = AIEnrichmentService()
        record = {"properties": {"title": "Test"}}
        suggestions = service.suggest_missing_fields(
            record,
            fields_to_suggest=["object_type", "classification"],
            min_confidence=0.6,
        )

        assert len(suggestions) == 1
        assert suggestions[0].field == "object_type"

    def test_suggest_skips_existing_fields(self):
        """Skips fields that already have values."""
        service = AIEnrichmentService()
        record = {
            "properties": {
                "object_type": "painting",  # Already has value
                "title": "Test",
            }
        }
        # Mock to avoid actual API call
        with patch.object(service, '_suggest_with_ai', return_value=[]) as mock_suggest:
            service.suggest_missing_fields(
                record, fields_to_suggest=["object_type", "classification"]
            )
            # Should only ask for classification, not object_type
            if mock_suggest.called:
                args = mock_suggest.call_args
                assert "object_type" not in args[1].get("missing_fields", [])


class TestEnrichRecord:
    """Test enrich_record function."""

    @patch.object(AIEnrichmentService, 'suggest_missing_fields')
    def test_enrich_without_auto_apply(self, mock_suggest):
        """Returns suggestions without modifying record."""
        mock_suggest.return_value = [
            EnrichmentSuggestion(field="object_type", value="painting", confidence=0.9)
        ]

        record = {"properties": {"title": "Test"}}
        result = enrich_record(record, auto_apply=False)

        assert len(result.suggestions) == 1
        assert result.applied_count == 0
        assert "object_type" not in result.record.get("properties", {})

    @patch.object(AIEnrichmentService, 'suggest_missing_fields')
    def test_enrich_with_auto_apply(self, mock_suggest):
        """Applies high-confidence suggestions when auto_apply=True."""
        mock_suggest.return_value = [
            EnrichmentSuggestion(field="object_type", value="painting", confidence=0.9),
            EnrichmentSuggestion(field="classification", value="Art", confidence=0.5),
        ]

        record = {"properties": {"title": "Test"}}
        result = enrich_record(record, auto_apply=True, min_confidence=0.7)

        assert result.applied_count == 1
        assert result.skipped_count == 1
        assert result.record["properties"]["object_type"] == "painting"
        assert "classification" not in result.record["properties"]


class TestEnhanceDescription:
    """Test description enhancement."""

    @patch.object(AIEnrichmentService, 'anthropic_client', new_callable=PropertyMock)
    def test_enhance_description_success(self, mock_client):
        """Successfully enhances description."""
        mock_response = MagicMock()
        mock_response.content = [MagicMock(text=json.dumps({
            "description": "A masterful oil painting depicting a starry night sky.",
            "confidence": 0.85,
        }))]

        mock_anthropic = MagicMock()
        mock_anthropic.messages.create.return_value = mock_response
        mock_client.return_value = mock_anthropic

        service = AIEnrichmentService()
        result = service.enhance_description(
            title="The Starry Night",
            context={"medium": "Oil on canvas", "date_display": "June 1889"},
        )

        assert result is not None
        assert result.field == "description"
        assert "starry" in result.value.lower()
        assert result.confidence == 0.85

    @patch.object(AIEnrichmentService, 'anthropic_client', new_callable=PropertyMock)
    def test_enhance_description_no_client(self, mock_client):
        """Returns None when client unavailable."""
        mock_client.return_value = None
        service = AIEnrichmentService()
        result = service.enhance_description(title="Test")
        assert result is None


class TestClassifyObjectType:
    """Test object type classification."""

    @patch.object(AIEnrichmentService, '_suggest_with_ai')
    def test_classify_returns_suggestion(self, mock_suggest):
        """Returns object_type suggestion."""
        mock_suggest.return_value = [
            EnrichmentSuggestion(field="object_type", value="painting", confidence=0.9),
            EnrichmentSuggestion(field="classification", value="Paintings", confidence=0.8),
        ]

        service = AIEnrichmentService()
        record = {"properties": {"medium": "Oil on canvas"}}
        result = service.classify_object_type(record)

        assert result is not None
        assert result.field == "object_type"
        assert result.value == "painting"

    def test_classify_skips_if_exists(self):
        """Returns None if object_type already set."""
        service = AIEnrichmentService()
        record = {"properties": {"object_type": "sculpture"}}
        result = service.classify_object_type(record)
        assert result is None
