"""
Tests for legacy payload handling.

Tests cover:
- Legacy payload detection (is_canonical_payload, is_legacy_payload)
- Legacy wrapping during ingest
- API serialization of legacy payloads
- Structured logging for legacy encounters
"""

import pytest
from datetime import datetime, timezone
from uuid import uuid4
import logging

from app.schemas.canonical import (
    is_canonical_payload,
    is_legacy_payload,
    get_payload_status,
    PayloadStatus,
    LegacyPayloadInfo,
    validate_canonical_record,
)
from app.services.canonical_store import validate_and_finalize_payload
from app.services.entity_serializer import (
    serialize_entity_payload,
    get_payload_display_info,
)


class TestLegacyDetection:
    """Tests for legacy payload detection functions."""

    def test_is_canonical_payload_with_valid_canonical(self):
        """Valid canonical payload should return True."""
        payload = {
            "id": "mdrn:test:123",
            "type": "Object",
            "label": "Test Object",
            "provenance": {
                "source": {"system": "test", "recordId": "123"},
                "ingestedAt": "2024-01-15T00:00:00Z",
            },
            "meta": {
                "schemaVersion": "1.0.0",
                "createdAt": "2024-01-15T00:00:00Z",
                "updatedAt": "2024-01-15T00:00:00Z",
            },
        }
        assert is_canonical_payload(payload) is True

    def test_is_canonical_payload_with_legacy(self):
        """Legacy payload should return False."""
        payload = {
            "title": "Old Record",
            "data": {"foo": "bar"},
        }
        assert is_canonical_payload(payload) is False

    def test_is_canonical_payload_with_missing_required_fields(self):
        """Payload missing required fields should return False."""
        # Missing type
        payload = {
            "id": "123",
            "label": "Test",
            "provenance": {"source": {"system": "test", "recordId": "123"}},
            "meta": {"schemaVersion": "1.0.0"},
        }
        assert is_canonical_payload(payload) is False

    def test_is_legacy_payload_with_legacy_markers(self):
        """Payload with legacy markers should return True."""
        # schemaVersion = "legacy"
        payload1 = {
            "meta": {"schemaVersion": "legacy"},
            "provenance": {},
        }
        assert is_legacy_payload(payload1) is True

        # validationStatus = "legacy"
        payload2 = {
            "meta": {"validationStatus": "legacy"},
            "provenance": {},
        }
        assert is_legacy_payload(payload2) is True

        # migrationRequired = true
        payload3 = {
            "meta": {},
            "provenance": {"migrationRequired": True},
        }
        assert is_legacy_payload(payload3) is True

    def test_is_legacy_payload_with_canonical(self):
        """Canonical payload should return False."""
        payload = {
            "id": "mdrn:test:123",
            "type": "Object",
            "label": "Test",
            "meta": {"schemaVersion": "1.0.0"},
            "provenance": {"source": {"system": "test", "recordId": "123"}},
        }
        assert is_legacy_payload(payload) is False

    def test_is_legacy_payload_with_raw_legacy(self):
        """Raw legacy payload (no markers) should return False."""
        # is_legacy_payload checks for markers, not structure
        payload = {"title": "Old", "data": {}}
        assert is_legacy_payload(payload) is False


class TestPayloadStatus:
    """Tests for get_payload_status function."""

    def test_status_canonical_valid(self):
        """Valid canonical payload should have CANONICAL status."""
        payload = {
            "id": "mdrn:test:123",
            "type": "Object",
            "label": "Test Object",
            "provenance": {
                "source": {"system": "test", "recordId": "123"},
                "ingestedAt": "2024-01-15T00:00:00Z",
            },
            "meta": {
                "schemaVersion": "1.0.0",
                "createdAt": "2024-01-15T00:00:00Z",
                "updatedAt": "2024-01-15T00:00:00Z",
            },
        }
        info = get_payload_status(payload)
        assert info.status == PayloadStatus.CANONICAL
        assert info.entity_key == "mdrn:test:123"
        assert info.source_system == "test"

    def test_status_legacy_wrapped(self):
        """Wrapped legacy payload should have LEGACY status with is_wrapped=True."""
        payload = {
            "title": "Old Record",
            "data": {},
            "meta": {"schemaVersion": "legacy", "validationStatus": "legacy"},
            "provenance": {
                "source": {"system": "old_source", "recordId": "abc"},
                "migrationRequired": True,
            },
        }
        info = get_payload_status(payload)
        assert info.status == PayloadStatus.LEGACY
        assert info.is_wrapped is True
        assert info.source_system == "old_source"

    def test_status_legacy_unwrapped(self):
        """Raw legacy payload should have LEGACY status with is_wrapped=False."""
        payload = {"title": "Old Record", "data": {"foo": "bar"}}
        info = get_payload_status(payload)
        assert info.status == PayloadStatus.LEGACY
        assert info.is_wrapped is False

    def test_status_unknown_for_non_dict(self):
        """Non-dict payload should have UNKNOWN status."""
        info = get_payload_status("not a dict")
        assert info.status == PayloadStatus.UNKNOWN


class TestLegacyWrapping:
    """Tests for legacy payload wrapping during ingest."""

    def test_legacy_payload_is_wrapped(self):
        """Legacy payload should be wrapped with legacy markers."""
        canonical_record = {
            "entity_key": "test:legacy:001",
            "source_system": "old_source",
            "source_id": "legacy_001",
            "payload": {
                "title": "Legacy Record",
                "description": "This is a legacy record",
                "custom_field": "value",
            },
        }

        payload, is_canonical, errors = validate_and_finalize_payload(
            canonical_record=canonical_record,
            source_system="old_source",
            source_id="legacy_001",
        )

        # Should not be canonical
        assert is_canonical is False

        # Should have legacy markers
        assert payload["meta"]["schemaVersion"] == "legacy"
        assert payload["meta"]["validationStatus"] == "legacy"
        assert payload["provenance"]["migrationRequired"] is True

        # Original fields should be preserved
        assert payload["title"] == "Legacy Record"
        assert payload["custom_field"] == "value"

    def test_canonical_draft_is_finalized(self):
        """Canonical draft should be finalized to canonical record."""
        canonical_record = {
            "entity_key": "mdrn:test:001",
            "source_system": "test",
            "source_id": "001",
            "payload": {
                "id": "mdrn:test:001",
                "type": "Object",
                "label": "Test Object",
            },
        }

        payload, is_canonical, errors = validate_and_finalize_payload(
            canonical_record=canonical_record,
            source_system="test",
            source_id="001",
        )

        # Should be canonical
        assert is_canonical is True
        assert errors == []

        # Should have canonical structure
        assert payload["meta"]["schemaVersion"] == "1.0.0"
        assert "provenance" in payload
        assert payload["provenance"]["source"]["system"] == "test"


class TestAPISerializer:
    """Tests for API serialization of payloads."""

    def test_serialize_canonical_payload(self):
        """Canonical payload should serialize with status=canonical."""
        payload = {
            "id": "mdrn:test:123",
            "type": "Object",
            "label": "Test",
            "meta": {"schemaVersion": "1.0.0"},
            "provenance": {"source": {"system": "test", "recordId": "123"}},
        }

        result = serialize_entity_payload(payload)
        assert result["_status"] == "canonical"
        assert result["id"] == "mdrn:test:123"

    def test_serialize_legacy_payload(self):
        """Legacy payload should serialize with status=legacy."""
        payload = {
            "title": "Legacy",
            "meta": {"schemaVersion": "legacy"},
            "provenance": {"migrationRequired": True},
        }

        result = serialize_entity_payload(payload)
        assert result["_status"] == "legacy"

    def test_serialize_without_status(self):
        """Can serialize without _status field."""
        payload = {"id": "test", "type": "Object", "label": "Test"}

        result = serialize_entity_payload(payload, include_status=False)
        assert "_status" not in result

    def test_get_payload_display_info(self):
        """Display info should extract correct fields."""
        canonical = {
            "id": "mdrn:test:123",
            "type": "Object",
            "label": "My Object",
            "meta": {"schemaVersion": "1.0.0"},
            "provenance": {"source": {"system": "test", "recordId": "123"}},
        }

        info = get_payload_display_info(canonical)
        assert info["is_canonical"] is True
        assert info["is_legacy"] is False
        assert info["label"] == "My Object"
        assert info["type"] == "Object"
        assert info["schema_version"] == "1.0.0"

    def test_get_payload_display_info_legacy(self):
        """Display info for legacy should show legacy type."""
        legacy = {
            "title": "Old Item",
            "meta": {"schemaVersion": "legacy"},
        }

        info = get_payload_display_info(legacy)
        assert info["is_legacy"] is True
        assert info["label"] == "Old Item"
        assert info["type"] == "legacy"


class TestLegacyLogging:
    """Tests for structured logging of legacy payload encounters."""

    def test_legacy_wrapping_logs_warning(self, caplog):
        """Legacy payload wrapping should log structured warning."""
        with caplog.at_level(logging.WARNING):
            canonical_record = {
                "entity_key": "test:legacy:log_test",
                "source_system": "legacy_source",
                "source_id": "log_001",
                "payload": {"title": "Legacy for logging"},
            }

            validate_and_finalize_payload(
                canonical_record=canonical_record,
                source_system="legacy_source",
                source_id="log_001",
                dataset_id="dataset_123",
                pipeline_id="route_456",
            )

        # Check warning was logged
        assert "legacy_payload_encountered" in caplog.text

        # Check structured data in log records
        legacy_records = [r for r in caplog.records if "legacy_payload" in r.getMessage()]
        assert len(legacy_records) >= 1

        # Check extra data if available (depends on log config)
        record = legacy_records[0]
        if hasattr(record, "source_system"):
            assert record.source_system == "legacy_source"

    def test_canonical_does_not_log_legacy_warning(self, caplog):
        """Canonical payload should not log legacy warning."""
        with caplog.at_level(logging.WARNING):
            canonical_record = {
                "entity_key": "mdrn:test:no_warn",
                "source_system": "test",
                "source_id": "001",
                "payload": {
                    "id": "mdrn:test:no_warn",
                    "type": "Object",
                    "label": "No Warning",
                },
            }

            validate_and_finalize_payload(
                canonical_record=canonical_record,
                source_system="test",
                source_id="001",
            )

        # Should not log legacy warning
        assert "legacy_payload_encountered" not in caplog.text


class TestLegacyPayloadInfo:
    """Tests for LegacyPayloadInfo model."""

    def test_info_model_defaults(self):
        """LegacyPayloadInfo should have sensible defaults."""
        info = LegacyPayloadInfo()
        assert info.entity_key is None
        assert info.source_system is None
        assert info.status == PayloadStatus.UNKNOWN
        assert info.is_wrapped is False
        assert info.validation_errors == []
        assert info.original_keys == []

    def test_info_from_payload_status(self):
        """get_payload_status should populate info correctly."""
        payload = {
            "id": "test:123",
            "title": "Test",
            "custom": "value",
            "meta": {"schemaVersion": "legacy"},
            "provenance": {
                "source": {"system": "old", "recordId": "123"},
            },
        }

        info = get_payload_status(payload)
        assert info.entity_key == "test:123"
        assert info.source_system == "old"
        assert info.source_id == "123"
        assert info.status == PayloadStatus.LEGACY
        assert info.is_wrapped is True
        assert "id" in info.original_keys
        assert "custom" in info.original_keys
