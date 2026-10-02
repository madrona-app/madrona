"""
Contract tests for connector canonical output.

These tests verify that connectors produce output conforming to the
Madrona Canonical Schema v1. They ensure:
1. normalize() returns the expected envelope structure
2. payload contains required canonical fields (id, type, label)
3. extensions contain raw source data
4. No regression in canonical output format

IMPORTANT: If these tests fail, connector output has regressed and may break:
- UI rendering of entities
- API responses
- Destination publishing
"""

import json
import os
import pytest
from pathlib import Path

from app.schemas.canonical import (
    validate_canonical_draft,
    CanonicalRecordType,
    CANONICAL_ALLOWED_FIELDS,
    check_unknown_top_level_keys,
)

# Path to test fixtures
FIXTURES_DIR = Path(__file__).parent / "fixtures"


def load_fixture(filename: str) -> dict:
    """Load a JSON fixture file."""
    fixture_path = FIXTURES_DIR / filename
    with open(fixture_path) as f:
        return json.load(f)


class TestLOCConnectorCanonicalOutput:
    """Contract tests for LOC connector normalize() output."""

    @pytest.fixture
    def loc_connector(self):
        """Create LOC connector instance."""
        from app.connectors.core.loc_digital_collections import LOCDigitalCollectionsConnector
        return LOCDigitalCollectionsConnector(
            config={"collection": "civil-war-maps"},
            organization_id="test-org-id",
        )

    @pytest.fixture
    def loc_record(self):
        """Load LOC fixture record."""
        return load_fixture("loc_item.json")

    def test_normalize_returns_envelope(self, loc_connector, loc_record):
        """normalize() should return envelope with required fields."""
        result = loc_connector.normalize(loc_record)

        assert "entity_key" in result, "Missing entity_key"
        assert "source_system" in result, "Missing source_system"
        assert "source_id" in result, "Missing source_id"
        assert "payload" in result, "Missing payload"

    def test_entity_key_format(self, loc_connector, loc_record):
        """entity_key should follow expected format."""
        result = loc_connector.normalize(loc_record)

        assert result["entity_key"].startswith("loc:"), \
            f"entity_key should start with 'loc:', got {result['entity_key']}"

    def test_source_system_correct(self, loc_connector, loc_record):
        """source_system should be 'loc'."""
        result = loc_connector.normalize(loc_record)
        assert result["source_system"] == "loc"

    def test_payload_is_canonical_draft(self, loc_connector, loc_record):
        """payload should be a valid CanonicalDraft."""
        result = loc_connector.normalize(loc_record)
        payload = result["payload"]

        # Validate against CanonicalDraft schema
        validation = validate_canonical_draft(payload)
        assert validation.is_valid, \
            f"payload is not valid CanonicalDraft: {validation.errors}"

    def test_payload_has_required_fields(self, loc_connector, loc_record):
        """payload should have id, type, and label."""
        result = loc_connector.normalize(loc_record)
        payload = result["payload"]

        assert "id" in payload, "payload missing 'id'"
        assert "type" in payload, "payload missing 'type'"
        assert "label" in payload, "payload missing 'label'"

    def test_payload_id_format(self, loc_connector, loc_record):
        """payload.id should be mdrn:loc:<source_id>."""
        result = loc_connector.normalize(loc_record)
        payload = result["payload"]

        assert payload["id"].startswith("mdrn:loc:"), \
            f"payload.id should start with 'mdrn:loc:', got {payload['id']}"

    def test_payload_type_valid(self, loc_connector, loc_record):
        """payload.type should be a valid CanonicalRecordType."""
        result = loc_connector.normalize(loc_record)
        payload = result["payload"]

        valid_types = {t.value for t in CanonicalRecordType}
        assert payload["type"] in valid_types, \
            f"payload.type '{payload['type']}' not in {valid_types}"

    def test_payload_type_is_work(self, loc_connector, loc_record):
        """LOC items should have type 'Work' (documents/intellectual works)."""
        result = loc_connector.normalize(loc_record)
        payload = result["payload"]

        # LOC items are primarily documents, maps, etc. = Work
        assert payload["type"] == "Work", \
            f"LOC items should be type 'Work', got {payload['type']}"

    def test_payload_label_not_empty(self, loc_connector, loc_record):
        """payload.label should not be empty."""
        result = loc_connector.normalize(loc_record)
        payload = result["payload"]

        assert payload["label"], "payload.label should not be empty"
        assert len(payload["label"]) > 0

    def test_extensions_contain_raw_data(self, loc_connector, loc_record):
        """extensions should contain raw source data."""
        result = loc_connector.normalize(loc_record)
        payload = result["payload"]

        assert "extensions" in payload, "payload missing 'extensions'"
        assert isinstance(payload["extensions"], list), "extensions should be list"
        assert len(payload["extensions"]) > 0, "extensions should not be empty"

        # Find source extension
        source_ext = None
        for ext in payload["extensions"]:
            if ext.get("namespace", "").startswith("source."):
                source_ext = ext
                break

        assert source_ext is not None, \
            "extensions should contain source.* namespace extension"
        assert source_ext["namespace"] == "source.loc", \
            f"source extension namespace should be 'source.loc', got {source_ext['namespace']}"
        assert "data" in source_ext, "source extension should have 'data'"

    def test_identifiers_present(self, loc_connector, loc_record):
        """payload should have identifiers list."""
        result = loc_connector.normalize(loc_record)
        payload = result["payload"]

        assert "identifiers" in payload, "payload missing 'identifiers'"
        assert isinstance(payload["identifiers"], list)
        assert len(payload["identifiers"]) > 0

        # Check source identifier exists
        source_idents = [i for i in payload["identifiers"] if i.get("scheme") == "source"]
        assert len(source_idents) > 0, "identifiers should include source identifier"

    def test_properties_present(self, loc_connector, loc_record):
        """payload should have properties dict."""
        result = loc_connector.normalize(loc_record)
        payload = result["payload"]

        assert "properties" in payload, "payload missing 'properties'"
        assert isinstance(payload["properties"], dict)


class TestNoSourceSpecificTopLevelKeys:
    """
    Contract test: ensure no source-specific keys leak into canonical payload.

    Source-specific data (descriptive_non_repeating, unit_code at top level, etc.)
    should ONLY appear inside extensions[].data, not at the canonical payload root.

    CRITICAL: Uses CANONICAL_ALLOWED_FIELDS from schema - the authoritative list.
    If this test fails, it means the connector is outputting non-canonical keys.
    """

    # Known source-specific keys that must NOT appear at top level
    FORBIDDEN_TOP_LEVEL_KEYS = frozenset({
        # Smithsonian-specific
        "descriptive_non_repeating", "indexed_structured", "freetext",
        "unitCode", "unit_code", "content",
        # LOC-specific
        "subject", "contributor", "location", "original_format",
        "image_url", "date", "url",
        # Legacy keys
        "title", "thumbnail_url", "canonical_url", "raw", "entity_type",
        "modified_at", "object_number",
    })

    @pytest.fixture
    def loc_connector(self):
        from app.connectors.core.loc_digital_collections import LOCDigitalCollectionsConnector
        return LOCDigitalCollectionsConnector(
            config={"collection": "test"},
            organization_id="test-org",
        )

    @pytest.fixture
    def smithsonian_connector(self):
        from app.connectors.core.smithsonian_base import SmithsonianBaseConnector

        class TestSmithsonianConnector(SmithsonianBaseConnector):
            def validate_config(self):
                pass
            def _get_search_params(self):
                return {"q": "test"}

        return TestSmithsonianConnector(config={"api_key": "test"}, organization_id="test-org")

    def test_loc_no_forbidden_keys(self, loc_connector):
        """LOC payload should not have source-specific keys at top level."""
        record = load_fixture("loc_item.json")
        result = loc_connector.normalize(record)
        payload = result["payload"]

        forbidden_found = set(payload.keys()) & self.FORBIDDEN_TOP_LEVEL_KEYS
        assert not forbidden_found, \
            f"LOC payload has forbidden top-level keys: {forbidden_found}"

    def test_loc_only_canonical_keys(self, loc_connector):
        """LOC payload should only have canonical keys at top level."""
        record = load_fixture("loc_item.json")
        result = loc_connector.normalize(record)
        payload = result["payload"]

        # Use the authoritative check from schema module
        unknown_keys = check_unknown_top_level_keys(payload)
        assert not unknown_keys, \
            f"LOC payload has unknown top-level keys: {unknown_keys}"

    def test_smithsonian_no_forbidden_keys(self, smithsonian_connector):
        """Smithsonian payload should not have source-specific keys at top level."""
        record = load_fixture("smithsonian_item.json")
        result = smithsonian_connector.normalize(record)
        payload = result["payload"]

        forbidden_found = set(payload.keys()) & self.FORBIDDEN_TOP_LEVEL_KEYS
        assert not forbidden_found, \
            f"Smithsonian payload has forbidden top-level keys: {forbidden_found}"

    def test_smithsonian_only_canonical_keys(self, smithsonian_connector):
        """Smithsonian payload should only have canonical keys at top level."""
        record = load_fixture("smithsonian_item.json")
        result = smithsonian_connector.normalize(record)
        payload = result["payload"]

        # Use the authoritative check from schema module
        unknown_keys = check_unknown_top_level_keys(payload)
        assert not unknown_keys, \
            f"Smithsonian payload has unknown top-level keys: {unknown_keys}"

    def test_raw_data_only_in_extensions(self, loc_connector):
        """Raw source data should only appear inside extensions."""
        record = load_fixture("loc_item.json")
        result = loc_connector.normalize(record)
        payload = result["payload"]

        # Raw data should be in extensions
        source_extensions = [
            ext for ext in payload.get("extensions", [])
            if ext.get("namespace", "").startswith("source.")
        ]
        assert len(source_extensions) > 0, "Raw data should be in source.* extension"

        # The extension should contain the original record
        raw_ext = source_extensions[0]
        assert "data" in raw_ext
        assert raw_ext["data"].get("id") or raw_ext["data"].get("title"), \
            "Extension data should contain original source fields"


class TestSmithsonianConnectorCanonicalOutput:
    """Contract tests for Smithsonian connector normalize() output."""

    @pytest.fixture
    def smithsonian_connector(self):
        """Create Smithsonian connector instance."""
        from app.connectors.core.smithsonian_base import SmithsonianBaseConnector

        # Create a concrete subclass for testing
        class TestSmithsonianConnector(SmithsonianBaseConnector):
            def validate_config(self):
                pass

            def _get_search_params(self) -> dict:
                return {"q": "test"}

        return TestSmithsonianConnector(
            config={"api_key": "test-key"},
            organization_id="test-org-id",
        )

    @pytest.fixture
    def smithsonian_record(self):
        """Load Smithsonian fixture record."""
        return load_fixture("smithsonian_item.json")

    def test_normalize_returns_envelope(self, smithsonian_connector, smithsonian_record):
        """normalize() should return envelope with required fields."""
        result = smithsonian_connector.normalize(smithsonian_record)

        assert "entity_key" in result, "Missing entity_key"
        assert "source_system" in result, "Missing source_system"
        assert "source_id" in result, "Missing source_id"
        assert "payload" in result, "Missing payload"

    def test_entity_key_format(self, smithsonian_connector, smithsonian_record):
        """entity_key should follow expected format."""
        result = smithsonian_connector.normalize(smithsonian_record)

        assert result["entity_key"].startswith("smithsonian:"), \
            f"entity_key should start with 'smithsonian:', got {result['entity_key']}"

    def test_source_system_correct(self, smithsonian_connector, smithsonian_record):
        """source_system should be 'smithsonian'."""
        result = smithsonian_connector.normalize(smithsonian_record)
        assert result["source_system"] == "smithsonian"

    def test_payload_is_canonical_draft(self, smithsonian_connector, smithsonian_record):
        """payload should be a valid CanonicalDraft."""
        result = smithsonian_connector.normalize(smithsonian_record)
        payload = result["payload"]

        validation = validate_canonical_draft(payload)
        assert validation.is_valid, \
            f"payload is not valid CanonicalDraft: {validation.errors}"

    def test_payload_has_required_fields(self, smithsonian_connector, smithsonian_record):
        """payload should have id, type, and label."""
        result = smithsonian_connector.normalize(smithsonian_record)
        payload = result["payload"]

        assert "id" in payload, "payload missing 'id'"
        assert "type" in payload, "payload missing 'type'"
        assert "label" in payload, "payload missing 'label'"

    def test_payload_id_format(self, smithsonian_connector, smithsonian_record):
        """payload.id should be mdrn:smithsonian:<source_id>."""
        result = smithsonian_connector.normalize(smithsonian_record)
        payload = result["payload"]

        assert payload["id"].startswith("mdrn:smithsonian:"), \
            f"payload.id should start with 'mdrn:smithsonian:', got {payload['id']}"

    def test_payload_type_valid(self, smithsonian_connector, smithsonian_record):
        """payload.type should be a valid CanonicalRecordType."""
        result = smithsonian_connector.normalize(smithsonian_record)
        payload = result["payload"]

        valid_types = {t.value for t in CanonicalRecordType}
        assert payload["type"] in valid_types, \
            f"payload.type '{payload['type']}' not in {valid_types}"

    def test_payload_type_is_object(self, smithsonian_connector, smithsonian_record):
        """Smithsonian items should have type 'Object' (physical museum objects)."""
        result = smithsonian_connector.normalize(smithsonian_record)
        payload = result["payload"]

        # Smithsonian items are primarily physical objects
        assert payload["type"] == "Object", \
            f"Smithsonian items should be type 'Object', got {payload['type']}"

    def test_payload_label_not_empty(self, smithsonian_connector, smithsonian_record):
        """payload.label should not be empty."""
        result = smithsonian_connector.normalize(smithsonian_record)
        payload = result["payload"]

        assert payload["label"], "payload.label should not be empty"

    def test_extensions_contain_raw_data(self, smithsonian_connector, smithsonian_record):
        """extensions should contain raw source data."""
        result = smithsonian_connector.normalize(smithsonian_record)
        payload = result["payload"]

        assert "extensions" in payload, "payload missing 'extensions'"
        assert isinstance(payload["extensions"], list)
        assert len(payload["extensions"]) > 0

        # Find source extension
        source_ext = None
        for ext in payload["extensions"]:
            if ext.get("namespace", "").startswith("source."):
                source_ext = ext
                break

        assert source_ext is not None, \
            "extensions should contain source.* namespace extension"
        assert source_ext["namespace"] == "source.smithsonian", \
            f"source extension namespace should be 'source.smithsonian', got {source_ext['namespace']}"

    def test_identifiers_present(self, smithsonian_connector, smithsonian_record):
        """payload should have identifiers list."""
        result = smithsonian_connector.normalize(smithsonian_record)
        payload = result["payload"]

        assert "identifiers" in payload
        assert isinstance(payload["identifiers"], list)
        assert len(payload["identifiers"]) > 0

    def test_properties_present(self, smithsonian_connector, smithsonian_record):
        """payload should have properties dict."""
        result = smithsonian_connector.normalize(smithsonian_record)
        payload = result["payload"]

        assert "properties" in payload
        assert isinstance(payload["properties"], dict)


class TestCanonicalValidationModes:
    """
    Tests for canonical validation mode behavior (warn vs error).

    These tests explicitly verify the validation mode behavior:
    - CANONICAL_VALIDATION_MODE=error should REJECT non-canonical payloads
    - CANONICAL_VALIDATION_MODE=warn should LOG and CONTINUE

    IMPORTANT: CI runs with CANONICAL_VALIDATION_MODE=error by default.
    Tests that need warn mode must explicitly set it via monkeypatch.
    """

    @pytest.fixture(autouse=True)
    def _restore_settings_singleton(self):
        """Undo this class's mutation of the process-global settings object.

        `app.config.settings` is a module-level singleton, not an lru_cache.
        The tests below null it so `get_settings()` rebuilds from the env var
        monkeypatch just set. monkeypatch restores the *env var* on teardown
        but knows nothing about the singleton, so without this fixture the
        rebuilt Settings — carrying whichever mode the last test picked —
        leaks into every test that runs later in the same process.

        That leak was load-bearing: it silently downgraded validation to
        `warn` for the rest of the session, which is the only reason
        test_pipeline_service_coverage.py passed under a job env that
        declares CANONICAL_VALIDATION_MODE=error. Restoring here makes that
        file's real precondition explicit (it now pins warn mode itself)
        instead of depending on cross-test pollution.
        """
        import app.config

        saved = app.config.settings
        yield
        app.config.settings = saved

    def test_error_mode_rejects_non_canonical_payload(self, app, db_session, monkeypatch):
        """In error mode, non-canonical payloads should raise CanonicalValidationError."""
        # Force error mode
        monkeypatch.setenv("CANONICAL_VALIDATION_MODE", "error")

        # Clear settings cache to pick up new env var
        import app.config
        app.config.settings = None

        from app.services.canonical_store import upsert_entity, CanonicalValidationError
        from app.models import Organization
        from uuid import uuid4

        # Create test org
        org = Organization(name="Test Org Error Mode", slug="test-org-error")
        db_session.add(org)
        db_session.flush()

        # Payload that looks canonical but has invalid type
        invalid_record = {
            "entity_key": "test:invalid:001",
            "source_system": "test",
            "source_id": "invalid_001",
            "payload": {
                "id": "mdrn:test:invalid_001",
                "type": "InvalidType",  # Not a valid CanonicalRecordType
                "label": "Invalid Item",
                "provenance": {
                    "source": {"system": "test", "recordId": "invalid_001"},
                    "ingestedAt": "2024-01-15T00:00:00Z",
                },
                "meta": {
                    "schemaVersion": "1.0.0",
                    "createdAt": "2024-01-15T00:00:00Z",
                    "updatedAt": "2024-01-15T00:00:00Z",
                },
            },
        }

        run_id = uuid4()
        # Should raise in error mode
        with pytest.raises(CanonicalValidationError) as exc_info:
            upsert_entity(
                session=db_session,
                organization_id=org.organization_id,
                run_id=run_id,
                pipeline_id=None,
                canonical_record=invalid_record,
            )

        assert "test:invalid:001" in str(exc_info.value)

class TestCanonicalIngestionIntegration:
    """Integration tests for canonical validation in ingestion."""

    @pytest.fixture
    def mock_settings(self, monkeypatch):
        """Mock settings for testing validation modes."""
        # This allows testing both warn and error modes
        pass

    def test_warn_mode_allows_legacy_payload(self, app, db_session, monkeypatch):
        """In warn mode, legacy payloads should be stored with warning."""
        # Explicitly set warn mode for this test (CI runs with error mode)
        monkeypatch.setenv("CANONICAL_VALIDATION_MODE", "warn")

        # Clear settings cache to pick up new env var
        import app.config
        app.config.settings = None

        from app.services.canonical_store import upsert_entity
        from app.models import Organization
        from uuid import uuid4

        # Create test org
        org = Organization(name="Test Org", slug="test-org")
        db_session.add(org)
        db_session.flush()

        # Legacy payload (not canonical)
        legacy_record = {
            "entity_key": "test:123",
            "source_system": "test",
            "source_id": "123",
            "payload": {
                "title": "Legacy Item",
                "date": "2024",
            },
        }

        run_id = uuid4()
        # Should not raise in warn mode
        change_type, _ = upsert_entity(
            session=db_session,
            organization_id=org.organization_id,
            run_id=run_id,
            pipeline_id=None,
            canonical_record=legacy_record,
        )

        assert change_type == "created"

