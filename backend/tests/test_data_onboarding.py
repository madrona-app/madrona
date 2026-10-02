"""
Unit tests for data onboarding service.
"""

import pytest
from unittest.mock import MagicMock, patch

from app.services.data_onboarding import (
    DataOnboardingService,
    FieldAnalysis,
    MappingSuggestion,
    OnboardingAnalysis,
    OnboardingPreview,
    OnboardingResult,
    OnboardingStatus,
    normalize_field_name,
    suggest_field_mapping,
    analyze_for_onboarding,
    preview_onboarding,
    onboard_records,
)


class TestFieldAnalysis:
    """Test FieldAnalysis dataclass."""

    def test_to_dict(self):
        """to_dict returns all fields."""
        fa = FieldAnalysis(
            field_name="title",
            record_count=100,
            present_count=95,
            coverage_percent=95.0,
            sample_values=["Sample 1", "Sample 2"],
            value_types=["str"],
            is_empty_count=2,
        )
        d = fa.to_dict()
        assert d["field_name"] == "title"
        assert d["coverage_percent"] == 95.0
        assert d["sample_values"] == ["Sample 1", "Sample 2"]

    def test_to_dict_limits_samples(self):
        """to_dict limits sample_values to 5."""
        fa = FieldAnalysis(
            field_name="test",
            record_count=10,
            present_count=10,
            coverage_percent=100.0,
            sample_values=list(range(10)),
        )
        d = fa.to_dict()
        assert len(d["sample_values"]) == 5


class TestMappingSuggestion:
    """Test MappingSuggestion dataclass."""

    def test_to_dict(self):
        """to_dict returns all fields."""
        ms = MappingSuggestion(
            source_field="artist_name",
            target_field="creator",
            confidence=0.9,
            reason="Common alias",
        )
        d = ms.to_dict()
        assert d["source_field"] == "artist_name"
        assert d["target_field"] == "creator"
        assert d["confidence"] == 0.9


class TestOnboardingAnalysis:
    """Test OnboardingAnalysis dataclass."""

    def test_readiness_score_empty_records(self):
        """Readiness score is 0 for empty records."""
        analysis = OnboardingAnalysis(
            record_count=0,
            target_profile="collections",
            target_profile_version="1.0.0",
        )
        d = analysis.to_dict()
        assert d["readiness_score"] == 0.0

    def test_readiness_score_calculation(self):
        """Readiness score calculated from coverage and validation."""
        analysis = OnboardingAnalysis(
            record_count=100,
            target_profile="collections",
            target_profile_version="1.0.0",
            required_fields_coverage={"title": 100.0},
            recommended_fields_coverage={"description": 50.0},
            valid_count=80,
            invalid_count=20,
        )
        d = analysis.to_dict()
        # Score should be positive
        assert d["readiness_score"] > 0
        assert d["readiness_score"] <= 100


class TestOnboardingPreview:
    """Test OnboardingPreview dataclass."""

    def test_success_rate(self):
        """success_rate calculated correctly."""
        preview = OnboardingPreview(
            record_count=100,
            would_pass_count=75,
            would_fail_count=25,
        )
        d = preview.to_dict()
        assert d["success_rate"] == 75.0

    def test_success_rate_zero_records(self):
        """success_rate is 0 for empty records."""
        preview = OnboardingPreview(record_count=0)
        d = preview.to_dict()
        assert d["success_rate"] == 0


class TestOnboardingResult:
    """Test OnboardingResult dataclass."""

    def test_to_dict(self):
        """to_dict returns result statistics."""
        result = OnboardingResult(
            status=OnboardingStatus.COMPLETED,
            total_records=100,
            successful_count=90,
            failed_count=5,
            skipped_count=5,
            enriched_count=30,
        )
        d = result.to_dict()
        assert d["status"] == "completed"
        assert d["success_rate"] == 90.0

    def test_to_dict_limits_errors(self):
        """to_dict limits errors to 20."""
        errors = [{"index": i} for i in range(30)]
        result = OnboardingResult(
            status=OnboardingStatus.COMPLETED,
            total_records=30,
            errors=errors,
        )
        d = result.to_dict()
        assert len(d["errors"]) == 20


class TestNormalizeFieldName:
    """Test normalize_field_name function."""

    def test_lowercase(self):
        """Converts to lowercase."""
        assert normalize_field_name("Title") == "title"

    def test_replace_hyphens(self):
        """Replaces hyphens with underscores."""
        assert normalize_field_name("date-created") == "date_created"

    def test_replace_spaces(self):
        """Replaces spaces with underscores."""
        assert normalize_field_name("date created") == "date_created"

    def test_strips_whitespace(self):
        """Strips leading/trailing whitespace."""
        assert normalize_field_name("  title  ") == "title"


class TestSuggestFieldMapping:
    """Test suggest_field_mapping function."""

    def test_exact_match(self):
        """Suggests exact name match."""
        suggestion = suggest_field_mapping("title", ["title", "description"])
        assert suggestion is not None
        assert suggestion.target_field == "title"
        assert suggestion.confidence == 1.0

    def test_case_insensitive_match(self):
        """Matches case-insensitively."""
        suggestion = suggest_field_mapping("Title", ["title", "description"])
        assert suggestion is not None
        assert suggestion.target_field == "title"

    def test_alias_match(self):
        """Suggests based on common aliases."""
        suggestion = suggest_field_mapping("artist", ["title", "creator"])
        assert suggestion is not None
        assert suggestion.target_field == "creator"
        assert suggestion.confidence == 0.9

    def test_partial_match(self):
        """Suggests partial name matches."""
        # Use a field that won't match aliases but will partial match
        suggestion = suggest_field_mapping("title_field", ["title", "description"])
        assert suggestion is not None
        assert suggestion.target_field == "title"
        assert suggestion.confidence == 0.6

    def test_no_match(self):
        """Returns None when no match found."""
        suggestion = suggest_field_mapping("xyz_field", ["title", "description"])
        assert suggestion is None


class TestDataOnboardingService:
    """Test DataOnboardingService class."""

    def test_analyze_records_basic(self):
        """Analyzes records and returns field coverage."""
        service = DataOnboardingService()
        records = [
            {"properties": {"title": "Item 1", "artist": "Artist A"}},
            {"properties": {"title": "Item 2", "artist": "Artist B"}},
            {"properties": {"title": "Item 3"}},  # Missing artist
        ]

        analysis = service.analyze_records(records, "collections")

        assert analysis.record_count == 3
        assert analysis.target_profile == "collections"

        # Check source fields were detected
        field_names = [f.field_name for f in analysis.source_fields]
        assert "title" in field_names
        assert "artist" in field_names

        # Check coverage
        title_field = next(f for f in analysis.source_fields if f.field_name == "title")
        assert title_field.present_count == 3
        assert title_field.coverage_percent == 100.0

        artist_field = next(f for f in analysis.source_fields if f.field_name == "artist")
        assert artist_field.present_count == 2

    def test_analyze_records_suggests_mappings(self):
        """Suggests field mappings based on names."""
        service = DataOnboardingService()
        records = [
            {"properties": {"artist_name": "Van Gogh", "object_title": "Starry Night"}},
        ]

        analysis = service.analyze_records(records, "collections")

        # Should suggest artist_name -> creator
        mappings = {m.source_field: m.target_field for m in analysis.suggested_mappings}
        assert mappings.get("artist_name") == "creator" or "creator" in mappings.values()

    def test_analyze_records_empty_list(self):
        """Handles empty record list."""
        service = DataOnboardingService()
        analysis = service.analyze_records([], "collections")
        assert analysis.record_count == 0

    def test_analyze_records_invalid_profile(self):
        """Raises error for invalid profile."""
        service = DataOnboardingService()
        with pytest.raises(ValueError):
            service.analyze_records([{}], "nonexistent_profile")

    def test_preview_onboarding(self):
        """Previews onboarding transformation."""
        service = DataOnboardingService()
        records = [
            {"id": "1", "properties": {"old_title": "Test Item", "artist": "Test Artist"}},
        ]
        mappings = {"old_title": "title", "artist": "creator"}

        preview = service.preview_onboarding(
            records=records,
            target_profile="collections",
            field_mappings=mappings,
            sample_size=1,
        )

        assert preview.record_count == 1
        assert len(preview.sample_records) == 1

        # Check transformation applied
        sample = preview.sample_records[0]
        assert sample["properties"]["title"] == "Test Item"
        assert sample["properties"]["creator"] == "Test Artist"

    def test_execute_onboarding_basic(self):
        """Executes basic onboarding transformation."""
        service = DataOnboardingService()
        records = [
            {"id": "1", "properties": {"old_title": "Item 1"}},
            {"id": "2", "properties": {"old_title": "Item 2"}},
        ]
        mappings = {"old_title": "title"}

        result = service.execute_onboarding(
            records=records,
            target_profile="collections",
            field_mappings=mappings,
        )

        assert result.status == OnboardingStatus.COMPLETED
        assert result.total_records == 2
        assert result.successful_count == 2
        assert len(result.onboarded_records) == 2

        # Check records transformed
        for record in result.onboarded_records:
            assert "title" in record["properties"]
            assert record["meta"]["profile"] == "collections"

    def test_execute_onboarding_skip_invalid(self):
        """Skips invalid records when skip_invalid=True."""
        service = DataOnboardingService()
        records = [
            {"id": "1", "properties": {"title": "Valid"}},  # Valid
            {"id": "2", "properties": {}},  # Invalid (missing title)
        ]
        mappings = {}

        result = service.execute_onboarding(
            records=records,
            target_profile="collections",
            field_mappings=mappings,
            skip_invalid=True,
        )

        assert result.successful_count == 1
        assert result.skipped_count == 1

    def test_execute_onboarding_with_enrichment(self):
        """Applies AI enrichment when requested."""
        from app.services.ai_enrichment import EnrichmentSuggestion

        mock_enrichment = MagicMock()
        mock_enrichment.suggest_missing_fields.return_value = [
            EnrichmentSuggestion(
                field="object_type",
                value="painting",
                confidence=0.9,
            )
        ]

        service = DataOnboardingService()
        service._enrichment_service = mock_enrichment

        records = [{"id": "1", "properties": {"title": "Test"}}]
        mappings = {}

        result = service.execute_onboarding(
            records=records,
            target_profile="collections",
            field_mappings=mappings,
            auto_enrich=True,
        )

        assert result.enriched_count == 1
        # Check enrichment was applied
        record = result.onboarded_records[0]
        assert record["properties"]["object_type"] == "painting"
        assert "enrichments" in record["meta"]

    def test_apply_mappings_preserves_unmapped(self):
        """Unmapped source fields are preserved."""
        service = DataOnboardingService()
        record = {
            "id": "1",
            "properties": {"old_field": "value", "other_field": "keep"},
        }
        mappings = {"old_field": "new_field"}

        result = service._apply_mappings(record, mappings)

        assert result["properties"]["new_field"] == "value"
        assert result["properties"]["other_field"] == "keep"
        assert "old_field" not in result["properties"]

    def test_prepare_for_profile_sets_metadata(self):
        """Sets profile metadata on record."""
        service = DataOnboardingService()
        record = {"id": "1", "properties": {"title": "Test"}}

        result = service._prepare_for_profile(record, "collections")

        assert result["meta"]["profile"] == "collections"
        assert result["meta"]["profile_version"] == "1.0.0"
        assert result["type"] == "OBJECT"

    def test_prepare_for_profile_sets_label(self):
        """Sets label from title if not present."""
        service = DataOnboardingService()
        record = {"id": "1", "properties": {"title": "My Title"}}

        result = service._prepare_for_profile(record, "collections")

        assert result["label"] == "My Title"


class TestConvenienceFunctions:
    """Test module-level convenience functions."""

    def test_analyze_for_onboarding(self):
        """analyze_for_onboarding calls service."""
        records = [{"properties": {"title": "Test"}}]
        analysis = analyze_for_onboarding(records, "collections")
        assert analysis.record_count == 1

    def test_preview_onboarding(self):
        """preview_onboarding calls service."""
        records = [{"properties": {"title": "Test"}}]
        preview = preview_onboarding(records, "collections", {})
        assert preview.record_count == 1

    def test_onboard_records(self):
        """onboard_records calls service."""
        records = [{"properties": {"title": "Test"}}]
        result = onboard_records(records, "collections", {})
        assert result.total_records == 1


class TestFieldMappingAliases:
    """Test field mapping alias coverage."""

    def test_title_aliases(self):
        """Title field aliases are recognized."""
        for alias in ["name", "object_title", "display_title", "label"]:
            suggestion = suggest_field_mapping(alias, ["title"])
            assert suggestion is not None, f"'{alias}' should map to title"
            assert suggestion.target_field == "title"

    def test_creator_aliases(self):
        """Creator field aliases are recognized."""
        for alias in ["artist", "author", "maker", "artist_name"]:
            suggestion = suggest_field_mapping(alias, ["creator"])
            assert suggestion is not None, f"'{alias}' should map to creator"
            assert suggestion.target_field == "creator"

    def test_accession_aliases(self):
        """Accession number aliases are recognized."""
        for alias in ["accession", "acc_no", "object_number"]:
            suggestion = suggest_field_mapping(alias, ["accession_number"])
            assert suggestion is not None, f"'{alias}' should map to accession_number"
            assert suggestion.target_field == "accession_number"
