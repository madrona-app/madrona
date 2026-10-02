"""
Unit tests for Profile Processor service.

Tests profile validation, enrichment, and integration with pipeline processing.
"""

import pytest
from unittest.mock import MagicMock

from app.services.profile_processor import (
    get_profile_validation_mode,
    validate_record_against_profile,
    apply_profile_metadata,
    process_records_with_profile,
    enrich_record_for_profile,
    ProfileProcessingResult,
    _normalize_date_string,
    _prepare_record_for_validation,
)


class TestGetProfileValidationMode:
    """Test validation mode retrieval."""

    def test_no_target_profile_returns_none(self):
        """Pipeline without target_profile returns 'none' mode."""
        pipeline = MagicMock()
        pipeline.target_profile = None
        pipeline.profile_validation_mode = "strict"

        assert get_profile_validation_mode(pipeline) == "none"

    def test_with_target_profile_returns_configured_mode(self):
        """Pipeline with target_profile returns configured mode."""
        pipeline = MagicMock()
        pipeline.target_profile = "collections"
        pipeline.profile_validation_mode = "strict"

        assert get_profile_validation_mode(pipeline) == "strict"

    def test_defaults_to_warn_if_mode_not_set(self):
        """Pipeline with target_profile but no mode defaults to 'warn'."""
        pipeline = MagicMock()
        pipeline.target_profile = "collections"
        pipeline.profile_validation_mode = None

        assert get_profile_validation_mode(pipeline) == "warn"


class TestValidateRecordAgainstProfile:
    """Test single record validation."""

    def test_none_mode_skips_validation(self):
        """Validation mode 'none' always returns valid."""
        record = {"entity_key": "test-1"}
        is_valid, result = validate_record_against_profile(
            record, "collections", "none"
        )
        assert is_valid is True
        assert result is None

    def test_warn_mode_returns_valid_with_issues(self):
        """Warn mode returns valid even with errors."""
        record = {
            "entity_key": "test-1",
            "type": "OBJECT",
            "properties": {},  # Missing required title
        }
        is_valid, result = validate_record_against_profile(
            record, "collections", "warn"
        )
        assert is_valid is True
        assert result is not None
        assert len(result.errors) > 0

    def test_strict_mode_returns_invalid_with_errors(self):
        """Strict mode returns invalid when there are errors."""
        record = {
            "entity_key": "test-1",
            "type": "OBJECT",
            "properties": {},  # Missing required title
        }
        is_valid, result = validate_record_against_profile(
            record, "collections", "strict"
        )
        assert is_valid is False
        assert result is not None

    def test_valid_record_passes_strict(self):
        """Valid record passes in strict mode."""
        record = {
            "entity_key": "test-1",
            "type": "OBJECT",
            "properties": {
                "title": "The Starry Night",
                "accession_number": "1941.4.1",
            },
        }
        is_valid, result = validate_record_against_profile(
            record, "collections", "strict"
        )
        assert is_valid is True

    def test_unknown_profile_returns_valid(self):
        """Unknown profile name returns valid with warning."""
        record = {"entity_key": "test-1"}
        is_valid, result = validate_record_against_profile(
            record, "nonexistent_profile", "strict"
        )
        assert is_valid is True
        assert result is None


class TestApplyProfileMetadata:
    """Test profile metadata application."""

    def test_adds_profile_to_meta(self):
        """Adds profile name and version to meta."""
        record = {
            "entity_key": "test-1",
            "canonical_payload": {
                "type": "OBJECT",
                "properties": {"title": "Test"},
            }
        }
        result = apply_profile_metadata(record, "collections", "1.0.0")

        assert result["canonical_payload"]["meta"]["profile"] == "collections"
        assert result["canonical_payload"]["meta"]["profileVersion"] == "1.0.0"

    def test_creates_meta_if_missing(self):
        """Creates meta section if not present."""
        record = {
            "entity_key": "test-1",
            "type": "OBJECT",
            "properties": {"title": "Test"},
        }
        result = apply_profile_metadata(record, "collections", "1.0.0")

        assert result["meta"]["profile"] == "collections"

    def test_preserves_existing_meta(self):
        """Preserves existing meta fields."""
        record = {
            "entity_key": "test-1",
            "canonical_payload": {
                "type": "OBJECT",
                "meta": {"schemaVersion": "1.0.0", "existing": "value"},
                "properties": {"title": "Test"},
            }
        }
        result = apply_profile_metadata(record, "collections", "1.0.0")

        assert result["canonical_payload"]["meta"]["existing"] == "value"
        assert result["canonical_payload"]["meta"]["profile"] == "collections"


class TestProcessRecordsWithProfile:
    """Test batch record processing."""

    def test_processes_valid_records(self):
        """Valid records are processed and tagged."""
        records = [
            {
                "entity_key": "test-1",
                "type": "OBJECT",
                "label": "Test Item 1",
                "properties": {"title": "Test Item 1"},
            },
            {
                "entity_key": "test-2",
                "type": "OBJECT",
                "label": "Test Item 2",
                "properties": {"title": "Test Item 2"},
            },
        ]

        processed, result = process_records_with_profile(
            records, "collections", "warn"
        )

        assert result.total_records == 2
        assert result.valid_count == 2
        assert len(processed) == 2

    def test_strict_mode_filters_invalid(self):
        """Strict mode excludes invalid records."""
        records = [
            {
                "entity_key": "test-1",
                "type": "OBJECT",
                "properties": {"title": "Valid Item"},
            },
            {
                "entity_key": "test-2",
                "type": "OBJECT",
                "properties": {},  # Missing title
            },
        ]

        processed, result = process_records_with_profile(
            records, "collections", "strict"
        )

        assert result.total_records == 2
        assert result.valid_count == 1
        assert result.invalid_count == 1
        assert len(processed) == 1  # Only valid record included
        assert len(result.rejected_records) == 1

    def test_warn_mode_includes_all(self):
        """Warn mode includes all records."""
        records = [
            {
                "entity_key": "test-1",
                "type": "OBJECT",
                "properties": {"title": "Valid Item"},
            },
            {
                "entity_key": "test-2",
                "type": "OBJECT",
                "properties": {},  # Missing title
            },
        ]

        processed, result = process_records_with_profile(
            records, "collections", "warn"
        )

        assert result.total_records == 2
        assert len(processed) == 2  # All records included

    def test_tracks_validation_issues(self):
        """Tracks all validation issues."""
        records = [
            {
                "entity_key": "test-1",
                "type": "OBJECT",
                "properties": {},  # Missing title
            },
        ]

        processed, result = process_records_with_profile(
            records, "collections", "warn"
        )

        assert len(result.validation_issues) > 0
        assert any("title" in issue["field"] for issue in result.validation_issues)


class TestEnrichRecordForProfile:
    """Test record enrichment functions."""

    def test_enriches_title_from_label(self):
        """Copies label to title if title missing."""
        record = {
            "label": "My Collection Item",
            "type": "OBJECT",
            "properties": {},
        }

        enriched, was_enriched = enrich_record_for_profile(record, "collections")

        assert was_enriched is True
        assert enriched["properties"]["title"] == "My Collection Item"

    def test_enriches_name_from_label_for_agent(self):
        """Copies label to name for agent profile."""
        record = {
            "label": "Vincent van Gogh",
            "type": "AGENT",
            "properties": {},
        }

        enriched, was_enriched = enrich_record_for_profile(record, "agent")

        assert was_enriched is True
        assert enriched["properties"]["name"] == "Vincent van Gogh"

    def test_infers_media_type_from_mime(self):
        """Infers media_type from mime_type."""
        record = {
            "type": "MEDIA",
            "properties": {
                "title": "Test Image",
                "mime_type": "image/jpeg",
            },
        }

        enriched, was_enriched = enrich_record_for_profile(record, "media")

        assert was_enriched is True
        assert enriched["properties"]["media_type"] == "image"

    def test_infers_media_type_from_url(self):
        """Infers media_type from URL extension."""
        record = {
            "type": "MEDIA",
            "properties": {
                "title": "Test Video",
                "url": "https://example.com/video.mp4",
            },
        }

        enriched, was_enriched = enrich_record_for_profile(record, "media")

        assert was_enriched is True
        assert enriched["properties"]["media_type"] == "video"

    def test_enriches_accession_from_identifiers(self):
        """Extracts accession_number from identifiers list."""
        record = {
            "type": "OBJECT",
            "properties": {"title": "Test"},
            "identifiers": [
                {"scheme": "accession", "value": "2024.1.1"},
            ],
        }

        enriched, was_enriched = enrich_record_for_profile(record, "collections")

        assert was_enriched is True
        assert enriched["properties"]["accession_number"] == "2024.1.1"

    def test_no_enrichment_if_already_present(self):
        """Doesn't overwrite existing values."""
        record = {
            "label": "Different Label",
            "type": "OBJECT",
            "properties": {
                "title": "Original Title",
            },
        }

        enriched, was_enriched = enrich_record_for_profile(record, "collections")

        # Title enrichment shouldn't apply since title exists
        assert enriched["properties"]["title"] == "Original Title"


class TestNormalizeDateString:
    """Test date normalization function."""

    def test_already_iso_format(self):
        """ISO dates pass through unchanged."""
        assert _normalize_date_string("2024-01-15") == "2024-01-15"

    def test_year_only(self):
        """Year-only dates pass through."""
        assert _normalize_date_string("1889") == "1889"

    def test_preserves_circa(self):
        """Preserves uncertainty markers."""
        assert _normalize_date_string("ca. 1890") == "ca. 1890"
        assert _normalize_date_string("circa 1890") == "circa 1890"

    def test_normalizes_common_formats(self):
        """Normalizes common date formats."""
        assert _normalize_date_string("January 15, 2024") == "2024-01-15"
        # Note: Other formats may vary based on implementation


class TestPrepareRecordForValidation:
    """Test record preparation for validation."""

    def test_already_canonical_structure(self):
        """Records with canonical structure pass through."""
        record = {
            "type": "OBJECT",
            "properties": {"title": "Test"},
            "relationships": [],
        }

        prepared = _prepare_record_for_validation(record, "collections")

        assert prepared["type"] == "OBJECT"
        assert prepared["properties"]["title"] == "Test"

    def test_extracts_properties_from_flat(self):
        """Extracts properties from flat record."""
        record = {
            "title": "Test Item",
            "description": "A test description",
            "label": "Test Label",
        }

        prepared = _prepare_record_for_validation(record, "collections")

        assert "title" in prepared["properties"]

    def test_infers_type_from_profile(self):
        """Infers canonical type from profile name."""
        record = {"properties": {"title": "Test"}}

        prepared = _prepare_record_for_validation(record, "collections")
        assert prepared["type"] == "OBJECT"

        prepared = _prepare_record_for_validation(record, "media")
        assert prepared["type"] == "MEDIA"

        prepared = _prepare_record_for_validation(record, "agent")
        assert prepared["type"] == "AGENT"


class TestProfileProcessingResult:
    """Test ProfileProcessingResult dataclass."""

    def test_default_values(self):
        """Result has sensible defaults."""
        result = ProfileProcessingResult()
        assert result.total_records == 0
        assert result.valid_count == 0
        assert result.invalid_count == 0
        assert result.enriched_count == 0
        assert result.rejected_records == []
        assert result.validation_issues == []

    def test_tracks_all_fields(self):
        """Result tracks all processing statistics."""
        result = ProfileProcessingResult(
            total_records=100,
            valid_count=95,
            invalid_count=5,
            enriched_count=20,
            rejected_records=[{"entity_key": "test"}],
            validation_issues=[{"field": "title", "message": "missing"}],
        )

        assert result.total_records == 100
        assert result.valid_count == 95
        assert result.invalid_count == 5
        assert result.enriched_count == 20
        assert len(result.rejected_records) == 1
        assert len(result.validation_issues) == 1
