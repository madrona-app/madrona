"""
Unit tests for Madrona Canonical Schema v1.

Tests the Pydantic models, validation functions, and finalization logic.
"""

import pytest
from datetime import datetime, timezone

from app.schemas.canonical import (
    CanonicalRecordType,
    MediaType,
    Identifier,
    Classification,
    Relationship,
    MediaReference,
    Extension,
    Provenance,
    ProvenanceSource,
    Meta,
    CanonicalDraft,
    CanonicalRecord,
    ValidationResult,
    validate_canonical_record,
    validate_canonical_draft,
    finalize_draft,
    is_canonical_payload,
    compute_canonical_hash,
    canonical_hash_material,
    stable_json_dumps,
    HASH_INCLUDE_EXTENSION_DATA,
    create_source_extension,
    create_media_reference,
    CANONICAL_ALLOWED_FIELDS,
    check_unknown_top_level_keys,
)


class TestCanonicalRecordType:
    """Test CanonicalRecordType enum."""

    def test_valid_types(self):
        """All expected types should be valid."""
        assert CanonicalRecordType.OBJECT == "Object"
        assert CanonicalRecordType.WORK == "Work"
        assert CanonicalRecordType.AGENT == "Agent"
        assert CanonicalRecordType.PLACE == "Place"
        assert CanonicalRecordType.EVENT == "Event"
        assert CanonicalRecordType.MEDIA == "Media"

    def test_type_count(self):
        """Should have exactly 6 types."""
        assert len(CanonicalRecordType) == 6


class TestIdentifier:
    """Test Identifier model."""

    def test_valid_identifier(self):
        """Valid identifier should parse correctly."""
        ident = Identifier(scheme="source", value="loc:12345")
        assert ident.scheme == "source"
        assert ident.value == "loc:12345"

    def test_empty_scheme_fails(self):
        """Empty scheme should fail validation."""
        with pytest.raises(ValueError):
            Identifier(scheme="", value="test")

    def test_empty_value_fails(self):
        """Empty value should fail validation."""
        with pytest.raises(ValueError):
            Identifier(scheme="source", value="")


class TestClassification:
    """Test Classification model."""

    def test_with_label(self):
        """Classification with label should be valid."""
        c = Classification(scheme="lcsh", label="Civil War")
        assert c.scheme == "lcsh"
        assert c.label == "Civil War"
        assert c.id is None

    def test_with_id(self):
        """Classification with id should be valid."""
        c = Classification(scheme="aat", id="300015636")
        assert c.id == "300015636"
        assert c.label is None

    def test_with_both(self):
        """Classification with both id and label should be valid."""
        c = Classification(scheme="aat", id="300015636", label="Maps")
        assert c.id == "300015636"
        assert c.label == "Maps"

    def test_neither_id_nor_label_fails(self):
        """Classification with neither id nor label should fail."""
        with pytest.raises(ValueError, match="must have at least"):
            Classification(scheme="test")


class TestMediaReference:
    """Test MediaReference model."""

    def test_valid_media(self):
        """Valid media reference should parse correctly."""
        m = MediaReference(
            id="mdrn:media:loc:123:thumb",
            type=MediaType.IMAGE,
            url="https://example.com/image.jpg",
            role="thumbnail",
        )
        assert m.id == "mdrn:media:loc:123:thumb"
        assert m.type == MediaType.IMAGE
        assert m.url == "https://example.com/image.jpg"
        assert m.role == "thumbnail"

    def test_media_type_enum(self):
        """Media type should accept valid enum values."""
        m = MediaReference(id="test", type="image")
        assert m.type == MediaType.IMAGE


class TestExtension:
    """Test Extension model."""

    def test_valid_extension(self):
        """Valid extension should parse correctly."""
        ext = Extension(
            namespace="source.loc",
            type="LocRaw",
            data={"id": "12345", "title": "Test"},
        )
        assert ext.namespace == "source.loc"
        assert ext.type == "LocRaw"
        assert ext.data["id"] == "12345"

    def test_empty_data_allowed(self):
        """Extension with empty data should be valid."""
        ext = Extension(namespace="test", type="Test", data={})
        assert ext.data == {}


class TestCanonicalDraft:
    """Test CanonicalDraft model."""

    def test_minimal_draft(self):
        """Minimal draft with required fields should be valid."""
        draft = CanonicalDraft(
            id="mdrn:loc:12345",
            type=CanonicalRecordType.WORK,
            label="Test Document",
        )
        assert draft.id == "mdrn:loc:12345"
        assert draft.type == CanonicalRecordType.WORK
        assert draft.label == "Test Document"
        assert draft.provenance is None
        assert draft.meta is None

    def test_full_draft(self):
        """Draft with all fields should be valid."""
        draft = CanonicalDraft(
            id="mdrn:loc:12345",
            type=CanonicalRecordType.WORK,
            label="Test Document",
            description="A test document for unit testing",
            status="active",
            identifiers=[{"scheme": "source", "value": "loc:12345"}],
            classifications=[{"scheme": "lcsh", "label": "Testing"}],
            properties={"date": "2024", "creator": "Test Author"},
            relationships=[{"type": "partOf", "target": "mdrn:collection:1", "label": "Test Collection"}],
            media=[{"id": "mdrn:media:loc:12345:thumb", "type": "image", "role": "thumbnail"}],
            rights="Public Domain",
            extensions=[{"namespace": "source.loc", "type": "LocRaw", "data": {}}],
        )
        assert draft.description == "A test document for unit testing"
        assert len(draft.identifiers) == 1
        assert len(draft.classifications) == 1
        assert draft.properties["date"] == "2024"

    def test_missing_id_fails(self):
        """Draft without id should fail."""
        with pytest.raises(ValueError):
            CanonicalDraft(type=CanonicalRecordType.WORK, label="Test")

    def test_missing_type_fails(self):
        """Draft without type should fail."""
        with pytest.raises(ValueError):
            CanonicalDraft(id="test", label="Test")

    def test_missing_label_fails(self):
        """Draft without label should fail."""
        with pytest.raises(ValueError):
            CanonicalDraft(id="test", type=CanonicalRecordType.WORK)

    def test_empty_label_fails(self):
        """Draft with empty label should fail."""
        with pytest.raises(ValueError):
            CanonicalDraft(id="test", type=CanonicalRecordType.WORK, label="")

    def test_invalid_type_fails(self):
        """Draft with invalid type should fail."""
        with pytest.raises(ValueError):
            CanonicalDraft(id="test", type="InvalidType", label="Test")

    def test_extra_fields_rejected(self):
        """Extra unknown fields should be rejected."""
        with pytest.raises(ValueError):
            CanonicalDraft(
                id="test",
                type=CanonicalRecordType.WORK,
                label="Test",
                unknown_field="value",
            )


class TestCanonicalRecord:
    """Test CanonicalRecord model."""

    def test_requires_provenance(self):
        """Record without provenance should fail."""
        with pytest.raises(ValueError):
            CanonicalRecord(
                id="test",
                type=CanonicalRecordType.WORK,
                label="Test",
                meta=Meta(
                    createdAt=datetime.now(timezone.utc),
                    updatedAt=datetime.now(timezone.utc),
                ),
            )

    def test_requires_meta(self):
        """Record without meta should fail."""
        with pytest.raises(ValueError):
            CanonicalRecord(
                id="test",
                type=CanonicalRecordType.WORK,
                label="Test",
                provenance=Provenance(
                    source=ProvenanceSource(system="loc", recordId="123"),
                    ingestedAt=datetime.now(timezone.utc),
                ),
            )

    def test_full_record(self):
        """Full record with provenance and meta should be valid."""
        now = datetime.now(timezone.utc)
        record = CanonicalRecord(
            id="mdrn:loc:12345",
            type=CanonicalRecordType.WORK,
            label="Test Document",
            provenance=Provenance(
                source=ProvenanceSource(system="loc", recordId="12345"),
                ingestedAt=now,
            ),
            meta=Meta(createdAt=now, updatedAt=now),
        )
        assert record.provenance.source.system == "loc"
        assert record.meta.schemaVersion == "1.0.0"


class TestValidation:
    """Test validation functions."""

    def test_validate_draft_valid(self):
        """Valid draft should pass validation."""
        draft_dict = {
            "id": "mdrn:loc:12345",
            "type": "Work",
            "label": "Test",
        }
        result = validate_canonical_draft(draft_dict)
        assert result.is_valid
        assert len(result.errors) == 0

    def test_validate_draft_invalid(self):
        """Invalid draft should fail validation."""
        draft_dict = {"id": "test"}  # Missing type and label
        result = validate_canonical_draft(draft_dict)
        assert not result.is_valid
        assert len(result.errors) > 0

    def test_validate_record_valid(self):
        """Valid record should pass validation."""
        now = datetime.now(timezone.utc).isoformat()
        record_dict = {
            "id": "mdrn:loc:12345",
            "type": "Work",
            "label": "Test",
            "provenance": {
                "source": {"system": "loc", "recordId": "12345"},
                "ingestedAt": now,
            },
            "meta": {
                "schemaVersion": "1.0.0",
                "createdAt": now,
                "updatedAt": now,
            },
        }
        result = validate_canonical_record(record_dict)
        assert result.is_valid
        assert result.record is not None

    def test_validate_record_invalid(self):
        """Invalid record should fail validation."""
        result = validate_canonical_record({"id": "test"})
        assert not result.is_valid
        assert len(result.errors) > 0


class TestFinalization:
    """Test finalize_draft function."""

    def test_finalize_minimal_draft(self):
        """Finalize should add provenance and meta."""
        draft = CanonicalDraft(
            id="mdrn:loc:12345",
            type=CanonicalRecordType.WORK,
            label="Test Document",
        )
        record = finalize_draft(draft, source_system="loc", source_id="12345")

        assert record.provenance is not None
        assert record.provenance.source.system == "loc"
        assert record.provenance.source.recordId == "12345"
        assert record.meta is not None
        assert record.meta.schemaVersion == "1.0.0"
        assert record.meta.hash is not None

    def test_finalize_from_dict(self):
        """Finalize should work with dict input."""
        draft_dict = {
            "id": "mdrn:loc:12345",
            "type": "Work",
            "label": "Test Document",
        }
        record = finalize_draft(draft_dict, source_system="loc", source_id="12345")
        assert record.provenance.source.system == "loc"

    def test_finalize_preserves_created_at(self):
        """Finalize should preserve existing createdAt."""
        draft = CanonicalDraft(
            id="mdrn:loc:12345",
            type=CanonicalRecordType.WORK,
            label="Test",
        )
        original_time = datetime(2020, 1, 1, tzinfo=timezone.utc)
        record = finalize_draft(
            draft,
            source_system="loc",
            source_id="12345",
            existing_created_at=original_time,
        )
        assert record.meta.createdAt == original_time


class TestIsCanonicalPayload:
    """Test is_canonical_payload detection."""

    def test_canonical_payload(self):
        """Canonical payload should be detected."""
        now = datetime.now(timezone.utc).isoformat()
        payload = {
            "id": "mdrn:loc:12345",
            "type": "Work",
            "label": "Test",
            "provenance": {
                "source": {"system": "loc", "recordId": "12345"},
                "ingestedAt": now,
            },
            "meta": {
                "schemaVersion": "1.0.0",
                "createdAt": now,
                "updatedAt": now,
            },
        }
        assert is_canonical_payload(payload) is True

    def test_legacy_payload(self):
        """Legacy payload should not be detected as canonical."""
        payload = {
            "title": "Test",
            "date": "2024",
            "creator": "Someone",
        }
        assert is_canonical_payload(payload) is False

    def test_draft_not_canonical(self):
        """Draft without provenance/meta is not canonical."""
        payload = {
            "id": "mdrn:loc:12345",
            "type": "Work",
            "label": "Test",
        }
        assert is_canonical_payload(payload) is False

    def test_invalid_type_not_canonical(self):
        """Payload with invalid type is not canonical."""
        now = datetime.now(timezone.utc).isoformat()
        payload = {
            "id": "test",
            "type": "InvalidType",
            "label": "Test",
            "provenance": {"source": {"system": "loc", "recordId": "123"}, "ingestedAt": now},
            "meta": {"schemaVersion": "1.0.0", "createdAt": now, "updatedAt": now},
        }
        assert is_canonical_payload(payload) is False


class TestHelpers:
    """Test helper functions."""

    def test_create_source_extension(self):
        """create_source_extension should create proper extension."""
        raw_data = {"id": "123", "title": "Test"}
        ext = create_source_extension("loc", raw_data)

        assert ext.namespace == "source.loc"
        assert ext.type == "LocRaw"
        assert ext.data == raw_data

    def test_create_media_reference(self):
        """create_media_reference should create proper media ref."""
        ref = create_media_reference(
            source_system="loc",
            source_id="12345",
            url="https://example.com/image.jpg",
            media_type=MediaType.IMAGE,
            role="thumbnail",
        )

        assert ref.id == "mdrn:media:loc:12345:thumbnail"
        assert ref.type == MediaType.IMAGE
        assert ref.url == "https://example.com/image.jpg"
        assert ref.role == "thumbnail"

    def test_compute_canonical_hash_stable(self):
        """Hash should be stable for same content."""
        record = {
            "id": "test",
            "type": "Work",
            "label": "Test",
            "meta": {"createdAt": "2024-01-01T00:00:00Z", "updatedAt": "2024-01-01T00:00:00Z"},
        }
        hash1 = compute_canonical_hash(record)
        hash2 = compute_canonical_hash(record)
        assert hash1 == hash2

    def test_compute_canonical_hash_excludes_updated_at(self):
        """Hash should exclude meta.updatedAt."""
        record1 = {
            "id": "test",
            "type": "Work",
            "label": "Test",
            "meta": {"updatedAt": "2024-01-01T00:00:00Z"},
        }
        record2 = {
            "id": "test",
            "type": "Work",
            "label": "Test",
            "meta": {"updatedAt": "2024-12-31T23:59:59Z"},  # Different updatedAt
        }
        assert compute_canonical_hash(record1) == compute_canonical_hash(record2)

    def test_compute_canonical_hash_excludes_created_at(self):
        """Hash should exclude meta.createdAt."""
        record1 = {
            "id": "test",
            "type": "Work",
            "label": "Test",
            "meta": {"createdAt": "2024-01-01T00:00:00Z"},
        }
        record2 = {
            "id": "test",
            "type": "Work",
            "label": "Test",
            "meta": {"createdAt": "2025-06-15T12:00:00Z"},  # Different createdAt
        }
        assert compute_canonical_hash(record1) == compute_canonical_hash(record2)

    def test_compute_canonical_hash_excludes_ingested_at(self):
        """Hash should exclude provenance.ingestedAt for re-ingest stability."""
        record1 = {
            "id": "test",
            "type": "Work",
            "label": "Test",
            "provenance": {
                "source": {"system": "loc", "recordId": "123"},
                "ingestedAt": "2024-01-01T00:00:00Z",
            },
        }
        record2 = {
            "id": "test",
            "type": "Work",
            "label": "Test",
            "provenance": {
                "source": {"system": "loc", "recordId": "123"},
                "ingestedAt": "2025-12-31T23:59:59Z",  # Different ingestedAt (re-ingest)
            },
        }
        assert compute_canonical_hash(record1) == compute_canonical_hash(record2)

    def test_compute_canonical_hash_same_content_different_timestamps(self):
        """Same content with all different timestamps should produce same hash."""
        record1 = {
            "id": "mdrn:loc:12345",
            "type": "Work",
            "label": "Civil War Map",
            "properties": {"date": "1863", "creator": "Bachelder"},
            "provenance": {
                "source": {"system": "loc", "recordId": "12345"},
                "ingestedAt": "2024-01-01T00:00:00Z",
            },
            "meta": {
                "schemaVersion": "1.0.0",
                "createdAt": "2024-01-01T00:00:00Z",
                "updatedAt": "2024-01-01T00:00:00Z",
                "hash": "abc123",
            },
        }
        record2 = {
            "id": "mdrn:loc:12345",
            "type": "Work",
            "label": "Civil War Map",
            "properties": {"date": "1863", "creator": "Bachelder"},
            "provenance": {
                "source": {"system": "loc", "recordId": "12345"},
                "ingestedAt": "2026-06-15T12:00:00Z",  # Re-ingested 2 years later
            },
            "meta": {
                "schemaVersion": "1.0.0",
                "createdAt": "2024-01-01T00:00:00Z",  # Original creation preserved
                "updatedAt": "2026-06-15T12:00:00Z",  # New update time
                "hash": "different_hash",
            },
        }
        # Same semantic content = same hash, despite different timestamps
        assert compute_canonical_hash(record1) == compute_canonical_hash(record2)

    def test_compute_canonical_hash_different_content_different_hash(self):
        """Different content should produce different hash."""
        record1 = {
            "id": "mdrn:loc:12345",
            "type": "Work",
            "label": "Civil War Map",
        }
        record2 = {
            "id": "mdrn:loc:12345",
            "type": "Work",
            "label": "Civil War Map - Updated Title",  # Content change
        }
        assert compute_canonical_hash(record1) != compute_canonical_hash(record2)


class TestUnknownTopLevelKeys:
    """Test unknown top-level key detection."""

    def test_valid_canonical_keys_pass(self):
        """All allowed canonical keys should pass."""
        payload = {
            "id": "test",
            "type": "Work",
            "label": "Test",
            "description": "Description",
            "identifiers": [],
            "classifications": [],
            "properties": {},
            "relationships": [],
            "media": [],
            "extensions": [],
            "provenance": {},
            "meta": {},
        }
        unknown = check_unknown_top_level_keys(payload)
        assert unknown == []

    def test_source_specific_keys_detected(self):
        """Source-specific keys at top level should be detected."""
        payload = {
            "id": "test",
            "type": "Work",
            "label": "Test",
            "descriptive_non_repeating": {},  # Smithsonian-specific
            "freetext": {},  # Smithsonian-specific
        }
        unknown = check_unknown_top_level_keys(payload)
        assert "descriptive_non_repeating" in unknown
        assert "freetext" in unknown

    def test_legacy_keys_detected(self):
        """Legacy keys that should be migrated are detected."""
        payload = {
            "id": "test",
            "type": "Work",
            "label": "Test",
            "title": "Duplicate title",  # Should be in label
            "thumbnail_url": "https://...",  # Should be in media
            "raw": {},  # Should be in extensions
        }
        unknown = check_unknown_top_level_keys(payload)
        assert "title" in unknown
        assert "thumbnail_url" in unknown
        assert "raw" in unknown

    def test_validation_rejects_unknown_keys(self):
        """validate_canonical_draft should reject unknown keys."""
        payload = {
            "id": "test",
            "type": "Work",
            "label": "Test",
            "indexed_structured": {},  # Smithsonian-specific - not allowed
        }
        result = validate_canonical_draft(payload)
        assert not result.is_valid
        assert any("Unknown top-level keys" in err for err in result.errors)

    def test_allowed_fields_constant_complete(self):
        """CANONICAL_ALLOWED_FIELDS should include all expected fields."""
        expected = {
            "id", "type", "label", "description", "status",
            "identifiers", "classifications", "properties",
            "relationships", "media", "rights", "extensions",
            "provenance", "meta",
        }
        assert CANONICAL_ALLOWED_FIELDS == expected


class TestMultiSourceMerge:
    """Tests for multi-source merge behavior in the canonical schema.

    These tests verify that when multiple sources contribute to the same entity:
    1. Hash computation is stable and deterministic
    2. Provenance tracking works correctly
    3. Field merging follows expected semantics
    """

    def test_hash_consistent_for_same_source_reingest(self):
        """
        Hash should be consistent when re-ingesting same content from same source.
        Only timestamps are excluded - provenance.source is part of identity.
        """
        content = {
            "id": "entity_123",
            "type": "Object",
            "label": "Shared Entity",
            "properties": {"material": "Bronze", "dimensions": "12x8x4 cm"},
            "meta": {
                "schemaVersion": "1.0.0",
                "createdAt": "2024-01-01T00:00:00Z",  # Excluded from hash
                "updatedAt": "2024-01-02T00:00:00Z",  # Excluded from hash
            },
            "provenance": {
                "source": {"system": "source_a", "recordId": "rec_001"},
            },
        }

        # First ingest
        record_first = {
            **content,
            "provenance": {
                **content["provenance"],
                "ingestedAt": "2024-01-01T12:00:00Z",  # Excluded from hash
            },
        }

        # Re-ingest same content later (only timestamp changes)
        record_second = {
            **content,
            "provenance": {
                **content["provenance"],
                "ingestedAt": "2024-06-15T09:30:00Z",  # Different timestamp, excluded from hash
            },
        }

        hash_first = compute_canonical_hash(record_first)
        hash_second = compute_canonical_hash(record_second)

        # Hash should be the SAME because only timestamps differ
        assert hash_first == hash_second, "Re-ingest of same content should produce same hash"

    def test_hash_different_for_different_sources(self):
        """
        Hash should differ when same logical content comes from different sources.
        Provenance.source is intentionally part of the content identity.
        """
        base_content = {
            "id": "entity_123",
            "type": "Object",
            "label": "Shared Entity",
            "properties": {"material": "Bronze"},
            "meta": {
                "schemaVersion": "1.0.0",
                "createdAt": "2024-01-01T00:00:00Z",
                "updatedAt": "2024-01-01T00:00:00Z",
            },
        }

        # Same content from source A
        record_a = {
            **base_content,
            "provenance": {
                "source": {"system": "source_a", "recordId": "rec_001"},
                "ingestedAt": "2024-01-01T12:00:00Z",
            },
        }

        # Same content from source B
        record_b = {
            **base_content,
            "provenance": {
                "source": {"system": "source_b", "recordId": "rec_999"},
                "ingestedAt": "2024-01-01T12:00:00Z",
            },
        }

        hash_a = compute_canonical_hash(record_a)
        hash_b = compute_canonical_hash(record_b)

        # Hash should be DIFFERENT because provenance.source is part of identity
        # This is intentional: different sources = different canonical records
        assert hash_a != hash_b, "Same content from different sources should produce different hash"

    def test_hash_detects_content_changes_during_merge(self):
        """
        When source B provides updated content during merge, hash should change.
        """
        base_record = {
            "id": "entity_123",
            "type": "Object",
            "label": "Original Label",
            "properties": {"material": "Bronze"},
            "meta": {
                "schemaVersion": "1.0.0",
                "createdAt": "2024-01-01T00:00:00Z",
                "updatedAt": "2024-01-01T00:00:00Z",
            },
            "provenance": {
                "source": {"system": "source_a", "recordId": "rec_001"},
                "ingestedAt": "2024-01-01T12:00:00Z",
            },
        }

        # Source B provides updated label
        updated_record = {
            **base_record,
            "label": "Updated Label",  # Content change
            "meta": {
                **base_record["meta"],
                "updatedAt": "2024-01-02T00:00:00Z",  # Timestamp change (excluded)
            },
            "provenance": {
                "source": {"system": "source_b", "recordId": "rec_999"},
                "ingestedAt": "2024-01-02T15:30:00Z",  # Timestamp change (excluded)
            },
        }

        hash_original = compute_canonical_hash(base_record)
        hash_updated = compute_canonical_hash(updated_record)

        # Hash should be DIFFERENT because label changed
        assert hash_original != hash_updated, "Content change should produce different hash"

    def test_identifiers_merge_accumulation(self):
        """
        When merging records, identifiers from multiple sources can accumulate.
        This tests the schema's ability to hold merged identifier arrays.
        """
        # Source A provides accession number
        identifiers_a = [
            Identifier(scheme="accession", value="2024.1.1"),
        ]

        # Source B provides alternate ID
        identifiers_b = [
            Identifier(scheme="alternate-id", value="ALT-001"),
        ]

        # Merged result should contain both
        merged_identifiers = identifiers_a + identifiers_b

        draft = CanonicalDraft(
            id="merged_entity",
            type=CanonicalRecordType.OBJECT,
            label="Merged Entity",
            identifiers=merged_identifiers,
        )

        assert len(draft.identifiers) == 2
        schemes = {ident.scheme for ident in draft.identifiers}
        assert schemes == {"accession", "alternate-id"}

    def test_extensions_preserve_source_origin(self):
        """
        Extensions should allow preserving source-specific data with clear namespacing.
        """
        # Source A's raw data
        source_a_ext = Extension(
            namespace="source_a",
            type="raw_fields",
            data={
                "custom_field_1": "value_from_a",
                "internal_id": "A-12345",
            },
        )

        # Source B's raw data
        source_b_ext = Extension(
            namespace="source_b",
            type="raw_fields",
            data={
                "custom_field_2": "value_from_b",
                "external_ref": "B-67890",
            },
        )

        # Both extensions can coexist
        draft = CanonicalDraft(
            id="multi_source_entity",
            type=CanonicalRecordType.OBJECT,
            label="Multi-Source Entity",
            extensions=[source_a_ext, source_b_ext],
        )

        assert len(draft.extensions) == 2
        namespaces = {ext.namespace for ext in draft.extensions}
        assert namespaces == {"source_a", "source_b"}

    def test_properties_merge_last_write_wins(self):
        """
        Properties dict supports last-write-wins merge strategy.
        Later source's values overwrite earlier source's values.
        """
        # Source A provides initial properties
        props_a = {
            "material": "Bronze",
            "period": "Renaissance",
            "source_a_only": "preserved",
        }

        # Source B provides updated/additional properties
        props_b = {
            "material": "Gilt Bronze",  # Overwrites source A
            "artist": "Unknown",  # New field
            # period is not in B, so A's value would be lost in pure replacement
        }

        # In last-write-wins with merge, we'd combine them
        merged_props = {**props_a, **props_b}

        draft = CanonicalDraft(
            id="merged_props_entity",
            type=CanonicalRecordType.OBJECT,
            label="Entity with Merged Properties",
            properties=merged_props,
        )

        assert draft.properties["material"] == "Gilt Bronze"  # B wins
        assert draft.properties["period"] == "Renaissance"  # A preserved
        assert draft.properties["artist"] == "Unknown"  # B added
        assert draft.properties["source_a_only"] == "preserved"  # A preserved

    def test_hash_stable_after_properties_merge(self):
        """
        After merging properties from two sources, hash should be
        deterministic based on final merged content.
        """
        # Two different merge orderings should produce same final hash
        # if the merged content is the same

        props_final = {
            "artist": "Unknown",
            "material": "Bronze",
            "period": "Renaissance",
        }

        record_1 = {
            "id": "entity_123",
            "type": "Object",
            "label": "Test",
            "properties": props_final,
            "meta": {
                "schemaVersion": "1.0.0",
                "createdAt": "2024-01-01T00:00:00Z",
                "updatedAt": "2024-01-01T00:00:00Z",
            },
            "provenance": {
                "source": {"system": "merged", "recordId": "rec_001"},
                "ingestedAt": "2024-01-01T00:00:00Z",
            },
        }

        # Same content, different construction order (shouldn't matter due to JSON key sorting)
        record_2 = {
            "id": "entity_123",
            "type": "Object",
            "label": "Test",
            "properties": {"period": "Renaissance", "material": "Bronze", "artist": "Unknown"},
            "meta": {
                "schemaVersion": "1.0.0",
                "createdAt": "2024-01-01T00:00:00Z",
                "updatedAt": "2024-01-01T00:00:00Z",
            },
            "provenance": {
                "source": {"system": "merged", "recordId": "rec_001"},
                "ingestedAt": "2024-01-01T00:00:00Z",
            },
        }

        hash_1 = compute_canonical_hash(record_1)
        hash_2 = compute_canonical_hash(record_2)

        assert hash_1 == hash_2, "Same content in different order should produce same hash"

    def test_classifications_merge_deduplication(self):
        """
        When merging classifications from multiple sources, duplicates
        should be identifiable and deduplicatable.
        """
        # Source A provides classification
        class_a = Classification(scheme="aat", id="300033618", label="paintings")

        # Source B provides same classification (duplicate)
        class_b = Classification(scheme="aat", id="300033618", label="paintings")

        # Source B also provides additional classification
        class_c = Classification(scheme="lcsh", id="sh85101348", label="Painting")

        all_classifications = [class_a, class_b, class_c]

        # Deduplicate by (scheme, id)
        seen = set()
        unique = []
        for c in all_classifications:
            key = (c.scheme, c.id)
            if key not in seen:
                seen.add(key)
                unique.append(c)

        assert len(unique) == 2, "Duplicate classification should be removed"

        draft = CanonicalDraft(
            id="dedup_entity",
            type=CanonicalRecordType.OBJECT,
            label="Entity with Deduplicated Classifications",
            classifications=unique,
        )

        assert len(draft.classifications) == 2

    def test_validation_works_on_merged_record(self):
        """
        A record assembled from multiple sources should pass validation
        if it conforms to the canonical schema.
        """
        merged_record = {
            "id": "merged_entity_001",
            "type": "Object",
            "label": "Multi-Source Artwork",
            "description": "An artwork with data from multiple sources",
            "identifiers": [
                {"scheme": "accession", "value": "2024.1.1"},
                {"scheme": "alternate", "value": "ALT-001"},
            ],
            "properties": {
                "material": "Oil on canvas",
                "dimensions": "100 x 80 cm",
                "period": "19th Century",
            },
            "classifications": [
                {"scheme": "aat", "id": "300033618", "label": "paintings"},
            ],
            "extensions": [
                {"namespace": "source_a", "type": "raw", "data": {"original_id": "A-001"}},
                {"namespace": "source_b", "type": "raw", "data": {"original_id": "B-999"}},
            ],
        }

        result = validate_canonical_draft(merged_record)
        assert result.is_valid, f"Merged record should be valid: {result.errors}"

    def test_no_unknown_keys_after_merge(self):
        """
        A properly merged record should not have any unknown top-level keys.
        Source-specific fields should be in extensions, not at top level.
        """
        properly_merged = {
            "id": "clean_merge",
            "type": "Object",
            "label": "Clean Merge",
            "properties": {},
            "extensions": [
                {"namespace": "source_a", "type": "raw", "data": {"source_field": "value"}},
            ],
        }

        unknown = check_unknown_top_level_keys(properly_merged)
        assert len(unknown) == 0, f"Properly merged record should have no unknown keys: {unknown}"

        # Bad merge leaks source data to top level
        bad_merge = {
            "id": "bad_merge",
            "type": "Object",
            "label": "Bad Merge",
            "source_specific_field": "leaked",  # BAD: should be in extensions
            "raw_data": {},  # BAD: should be in extensions
        }

        unknown = check_unknown_top_level_keys(bad_merge)
        assert "source_specific_field" in unknown
        assert "raw_data" in unknown


class TestSemanticHashStability:
    """
    Comprehensive tests for semantic hash stability.

    The semantic hash MUST be stable across:
    - Re-ingests (same content, different timestamps)
    - Retries (same content, potentially different run IDs)
    - Idempotent runs (same content, different ordering)

    The semantic hash MUST change when:
    - Actual content changes (label, properties, etc.)
    - Schema version changes
    - Source system changes

    The semantic hash MUST NOT change when:
    - Timestamps change (createdAt, updatedAt, ingestedAt)
    - Run metadata changes (routeId, snapshotId, mappingId, transformId)
    - Extension raw data changes (by default)
    - List ordering differs (identifiers, classifications, etc.)
    - Dict key ordering differs
    """

    def test_stable_json_dumps_sorts_keys_recursively(self):
        """stable_json_dumps should sort dict keys at all levels."""
        obj1 = {"b": {"d": 1, "c": 2}, "a": {"f": 3, "e": 4}}
        obj2 = {"a": {"e": 4, "f": 3}, "b": {"c": 2, "d": 1}}

        json1 = stable_json_dumps(obj1)
        json2 = stable_json_dumps(obj2)

        assert json1 == json2
        assert json1 == '{"a":{"e":4,"f":3},"b":{"c":2,"d":1}}'

    def test_stable_json_dumps_preserves_list_order(self):
        """stable_json_dumps should preserve list element order."""
        obj = {"items": [3, 1, 2]}
        result = stable_json_dumps(obj)
        assert result == '{"items":[3,1,2]}'

    def test_canonical_hash_material_extracts_semantic_fields(self):
        """canonical_hash_material should extract only semantic content."""
        record = {
            "id": "test-123",
            "type": "Object",
            "label": "Test Object",
            "description": "A test",
            "properties": {"color": "red"},
            "identifiers": [{"scheme": "acc", "value": "001"}],
            "meta": {
                "schemaVersion": "1.0.0",
                "createdAt": "2024-01-01T00:00:00Z",
                "updatedAt": "2024-01-02T00:00:00Z",
                "hash": "abc123",
            },
            "provenance": {
                "source": {"system": "test", "recordId": "123", "dataset": "ds1"},
                "ingestedAt": "2024-01-01T00:00:00Z",
                "routeId": "route-1",
                "snapshotId": "snap-1",
                "mappingId": "map-1",
                "transformId": "trans-1",
            },
        }

        material = canonical_hash_material(record)

        # Semantic fields included
        assert material["id"] == "test-123"
        assert material["type"] == "Object"
        assert material["label"] == "Test Object"
        assert material["description"] == "A test"
        assert material["properties"] == {"color": "red"}
        assert material["identifiers"] == [{"scheme": "acc", "value": "001"}]

        # Only schemaVersion from meta
        assert material["meta"] == {"schemaVersion": "1.0.0"}
        assert "createdAt" not in str(material["meta"])
        assert "updatedAt" not in str(material["meta"])
        assert "hash" not in str(material["meta"])

        # Only source from provenance
        assert material["provenance"]["source"] == {
            "system": "test",
            "recordId": "123",
            "dataset": "ds1",
        }
        assert "ingestedAt" not in str(material["provenance"])
        assert "routeId" not in str(material["provenance"])
        assert "snapshotId" not in str(material["provenance"])

    def test_hash_excludes_all_volatile_provenance_fields(self):
        """Hash should exclude all volatile provenance fields."""
        base = {
            "id": "test",
            "type": "Object",
            "label": "Test",
            "provenance": {"source": {"system": "test", "recordId": "123"}},
        }

        # Add each volatile field and verify hash doesn't change
        record_with_route = {
            **base,
            "provenance": {**base["provenance"], "routeId": "route-abc"},
        }
        record_with_snapshot = {
            **base,
            "provenance": {**base["provenance"], "snapshotId": "snap-xyz"},
        }
        record_with_mapping = {
            **base,
            "provenance": {**base["provenance"], "mappingId": "map-123"},
        }
        record_with_transform = {
            **base,
            "provenance": {**base["provenance"], "transformId": "trans-456"},
        }
        record_with_all = {
            **base,
            "provenance": {
                **base["provenance"],
                "routeId": "route-abc",
                "snapshotId": "snap-xyz",
                "mappingId": "map-123",
                "transformId": "trans-456",
                "ingestedAt": "2024-01-01T00:00:00Z",
            },
        }

        base_hash = compute_canonical_hash(base)
        assert compute_canonical_hash(record_with_route) == base_hash
        assert compute_canonical_hash(record_with_snapshot) == base_hash
        assert compute_canonical_hash(record_with_mapping) == base_hash
        assert compute_canonical_hash(record_with_transform) == base_hash
        assert compute_canonical_hash(record_with_all) == base_hash

    def test_hash_stable_with_different_identifier_order(self):
        """Hash should be same regardless of identifier list order."""
        record1 = {
            "id": "test",
            "type": "Object",
            "label": "Test",
            "identifiers": [
                {"scheme": "acc", "value": "001"},
                {"scheme": "doi", "value": "10.1234"},
                {"scheme": "url", "value": "http://example.com"},
            ],
        }
        record2 = {
            "id": "test",
            "type": "Object",
            "label": "Test",
            "identifiers": [
                {"scheme": "url", "value": "http://example.com"},
                {"scheme": "acc", "value": "001"},
                {"scheme": "doi", "value": "10.1234"},
            ],
        }

        assert compute_canonical_hash(record1) == compute_canonical_hash(record2)

    def test_hash_stable_with_different_classification_order(self):
        """Hash should be same regardless of classification list order."""
        record1 = {
            "id": "test",
            "type": "Object",
            "label": "Test",
            "classifications": [
                {"scheme": "aat", "id": "300033618", "label": "paintings"},
                {"scheme": "lcsh", "id": "sh85101348", "label": "Painting"},
            ],
        }
        record2 = {
            "id": "test",
            "type": "Object",
            "label": "Test",
            "classifications": [
                {"scheme": "lcsh", "id": "sh85101348", "label": "Painting"},
                {"scheme": "aat", "id": "300033618", "label": "paintings"},
            ],
        }

        assert compute_canonical_hash(record1) == compute_canonical_hash(record2)

    def test_hash_stable_with_different_relationship_order(self):
        """Hash should be same regardless of relationship list order."""
        record1 = {
            "id": "test",
            "type": "Object",
            "label": "Test",
            "relationships": [
                {"type": "creator", "target": "agent:1", "label": "John"},
                {"type": "partOf", "target": "collection:2", "label": "Collection A"},
            ],
        }
        record2 = {
            "id": "test",
            "type": "Object",
            "label": "Test",
            "relationships": [
                {"type": "partOf", "target": "collection:2", "label": "Collection A"},
                {"type": "creator", "target": "agent:1", "label": "John"},
            ],
        }

        assert compute_canonical_hash(record1) == compute_canonical_hash(record2)

    def test_hash_stable_with_different_media_order(self):
        """Hash should be same regardless of media list order."""
        record1 = {
            "id": "test",
            "type": "Object",
            "label": "Test",
            "media": [
                {"id": "media:1", "type": "image", "url": "http://a.jpg"},
                {"id": "media:2", "type": "video", "url": "http://b.mp4"},
            ],
        }
        record2 = {
            "id": "test",
            "type": "Object",
            "label": "Test",
            "media": [
                {"id": "media:2", "type": "video", "url": "http://b.mp4"},
                {"id": "media:1", "type": "image", "url": "http://a.jpg"},
            ],
        }

        assert compute_canonical_hash(record1) == compute_canonical_hash(record2)

    def test_hash_stable_with_different_extension_order(self):
        """Hash should be same regardless of extension list order."""
        record1 = {
            "id": "test",
            "type": "Object",
            "label": "Test",
            "extensions": [
                {"namespace": "source.a", "type": "raw", "data": {"x": 1}},
                {"namespace": "source.b", "type": "raw", "data": {"y": 2}},
            ],
        }
        record2 = {
            "id": "test",
            "type": "Object",
            "label": "Test",
            "extensions": [
                {"namespace": "source.b", "type": "raw", "data": {"y": 2}},
                {"namespace": "source.a", "type": "raw", "data": {"x": 1}},
            ],
        }

        assert compute_canonical_hash(record1) == compute_canonical_hash(record2)

    def test_hash_excludes_extension_data_by_default(self):
        """By default, extension.data should NOT affect hash."""
        record1 = {
            "id": "test",
            "type": "Object",
            "label": "Test",
            "extensions": [
                {"namespace": "source.test", "type": "raw", "data": {"x": 1, "y": 2}},
            ],
        }
        record2 = {
            "id": "test",
            "type": "Object",
            "label": "Test",
            "extensions": [
                # Same namespace/type, different data
                {"namespace": "source.test", "type": "raw", "data": {"completely": "different"}},
            ],
        }

        # Default: extension data excluded, so hashes should match
        assert compute_canonical_hash(record1) == compute_canonical_hash(record2)

    def test_hash_includes_extension_data_when_configured(self):
        """When include_extension_data=True, data SHOULD affect hash."""
        record1 = {
            "id": "test",
            "type": "Object",
            "label": "Test",
            "extensions": [
                {"namespace": "source.test", "type": "raw", "data": {"x": 1}},
            ],
        }
        record2 = {
            "id": "test",
            "type": "Object",
            "label": "Test",
            "extensions": [
                {"namespace": "source.test", "type": "raw", "data": {"x": 999}},
            ],
        }

        # With include_extension_data=True, hashes should differ
        hash1 = compute_canonical_hash(record1, include_extension_data=True)
        hash2 = compute_canonical_hash(record2, include_extension_data=True)
        assert hash1 != hash2

    def test_hash_extension_namespace_type_affects_hash(self):
        """Extension namespace and type should affect hash (even without data)."""
        record1 = {
            "id": "test",
            "type": "Object",
            "label": "Test",
            "extensions": [
                {"namespace": "source.a", "type": "raw", "data": {}},
            ],
        }
        record2 = {
            "id": "test",
            "type": "Object",
            "label": "Test",
            "extensions": [
                {"namespace": "source.b", "type": "raw", "data": {}},  # Different namespace
            ],
        }

        assert compute_canonical_hash(record1) != compute_canonical_hash(record2)

    def test_hash_stable_with_different_property_key_order(self):
        """Hash should be same regardless of property dict key order."""
        record1 = {
            "id": "test",
            "type": "Object",
            "label": "Test",
            "properties": {"z": 1, "a": 2, "m": 3},
        }
        record2 = {
            "id": "test",
            "type": "Object",
            "label": "Test",
            "properties": {"a": 2, "m": 3, "z": 1},
        }

        assert compute_canonical_hash(record1) == compute_canonical_hash(record2)

    def test_hash_stable_with_nested_property_key_order(self):
        """Hash should be same with nested property dicts in different order."""
        record1 = {
            "id": "test",
            "type": "Object",
            "label": "Test",
            "properties": {
                "nested": {"z": 1, "a": {"c": 3, "b": 2}},
                "flat": "value",
            },
        }
        record2 = {
            "id": "test",
            "type": "Object",
            "label": "Test",
            "properties": {
                "flat": "value",
                "nested": {"a": {"b": 2, "c": 3}, "z": 1},
            },
        }

        assert compute_canonical_hash(record1) == compute_canonical_hash(record2)

    def test_re_finalize_same_draft_produces_same_hash(self):
        """Re-finalizing the same draft at different times should produce same hash."""
        draft = CanonicalDraft(
            id="test-entity",
            type=CanonicalRecordType.OBJECT,
            label="Test Entity",
            properties={"material": "Bronze", "period": "Renaissance"},
            identifiers=[
                Identifier(scheme="accession", value="2024.1.1"),
            ],
        )

        # Finalize at "time 1"
        record1 = finalize_draft(draft, source_system="test", source_id="123")

        # Finalize at "time 2" (simulated by passing different existing_created_at)
        record2 = finalize_draft(
            draft,
            source_system="test",
            source_id="123",
            existing_created_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
        )

        # Both should have the same semantic hash despite different meta timestamps
        assert record1.meta.hash == record2.meta.hash

    def test_finalize_draft_from_dict_produces_stable_hash(self):
        """Finalize from dict should produce same hash as from CanonicalDraft."""
        draft_dict = {
            "id": "test-entity",
            "type": "Object",
            "label": "Test Entity",
            "properties": {"color": "blue"},
        }
        draft_obj = CanonicalDraft(
            id="test-entity",
            type=CanonicalRecordType.OBJECT,
            label="Test Entity",
            properties={"color": "blue"},
        )

        record1 = finalize_draft(draft_dict, source_system="test", source_id="123")
        record2 = finalize_draft(draft_obj, source_system="test", source_id="123")

        assert record1.meta.hash == record2.meta.hash

    def test_schema_version_affects_hash(self):
        """Different schema versions should produce different hashes."""
        record1 = {
            "id": "test",
            "type": "Object",
            "label": "Test",
            "meta": {"schemaVersion": "1.0.0"},
        }
        record2 = {
            "id": "test",
            "type": "Object",
            "label": "Test",
            "meta": {"schemaVersion": "2.0.0"},
        }

        assert compute_canonical_hash(record1) != compute_canonical_hash(record2)

    def test_source_system_affects_hash(self):
        """Different source systems should produce different hashes."""
        record1 = {
            "id": "test",
            "type": "Object",
            "label": "Test",
            "provenance": {"source": {"system": "system_a", "recordId": "123"}},
        }
        record2 = {
            "id": "test",
            "type": "Object",
            "label": "Test",
            "provenance": {"source": {"system": "system_b", "recordId": "123"}},
        }

        assert compute_canonical_hash(record1) != compute_canonical_hash(record2)

    def test_source_record_id_affects_hash(self):
        """Different source record IDs should produce different hashes."""
        record1 = {
            "id": "test",
            "type": "Object",
            "label": "Test",
            "provenance": {"source": {"system": "test", "recordId": "id_a"}},
        }
        record2 = {
            "id": "test",
            "type": "Object",
            "label": "Test",
            "provenance": {"source": {"system": "test", "recordId": "id_b"}},
        }

        assert compute_canonical_hash(record1) != compute_canonical_hash(record2)

    def test_complete_idempotent_reingest_scenario(self):
        """
        Complete test: simulate re-ingesting same content with all possible
        timestamp and run metadata variations - hash should remain stable.
        """
        base_content = {
            "id": "mdrn:museum:artifact:12345",
            "type": "Object",
            "label": "Bronze Statue of Athena",
            "description": "A classical bronze statue depicting the goddess Athena",
            "status": "active",
            "identifiers": [
                {"scheme": "accession", "value": "2024.001"},
                {"scheme": "url", "value": "https://museum.org/objects/12345"},
            ],
            "classifications": [
                {"scheme": "aat", "id": "300047600", "label": "statues"},
                {"scheme": "local", "label": "Classical Antiquities"},
            ],
            "properties": {
                "material": "Bronze",
                "dimensions": {"height": "75cm", "width": "25cm"},
                "period": "Classical Greek",
                "circa": "450-400 BCE",
            },
            "relationships": [
                {"type": "depicts", "target": "agent:athena", "label": "Athena"},
            ],
            "media": [
                {"id": "media:12345:primary", "type": "image", "role": "primary"},
            ],
            "rights": {"statement": "Public Domain"},
            "extensions": [
                {"namespace": "source.museum", "type": "raw", "data": {"internal_id": "X-123"}},
            ],
        }

        # First ingest: January 2024
        ingest_1 = {
            **base_content,
            "meta": {
                "schemaVersion": "1.0.0",
                "createdAt": "2024-01-15T10:00:00Z",
                "updatedAt": "2024-01-15T10:00:00Z",
                "hash": "will_be_computed",
            },
            "provenance": {
                "source": {"system": "museum", "recordId": "12345", "dataset": "artifacts"},
                "ingestedAt": "2024-01-15T10:00:00Z",
                "routeId": "route-january",
                "snapshotId": "snap-20240115",
                "mappingId": "mapping-v1",
                "transformId": "transform-v1",
            },
        }

        # Re-ingest: June 2024 (6 months later, all volatile metadata different)
        ingest_2 = {
            **base_content,
            "meta": {
                "schemaVersion": "1.0.0",
                "createdAt": "2024-01-15T10:00:00Z",  # Preserved from original
                "updatedAt": "2024-06-20T14:30:00Z",  # New update time
                "hash": "different_hash",
            },
            "provenance": {
                "source": {"system": "museum", "recordId": "12345", "dataset": "artifacts"},
                "ingestedAt": "2024-06-20T14:30:00Z",  # New ingest time
                "routeId": "route-june",  # Different route ID
                "snapshotId": "snap-20240620",  # Different snapshot
                "mappingId": "mapping-v2",  # Updated mapping
                "transformId": "transform-v2",  # Updated transform
            },
        }

        # Retry during second ingest (same day, different run)
        ingest_2_retry = {
            **base_content,
            "meta": {
                "schemaVersion": "1.0.0",
                "createdAt": "2024-01-15T10:00:00Z",
                "updatedAt": "2024-06-20T15:00:00Z",  # 30 minutes later
                "hash": "yet_another_hash",
            },
            "provenance": {
                "source": {"system": "museum", "recordId": "12345", "dataset": "artifacts"},
                "ingestedAt": "2024-06-20T15:00:00Z",
                "routeId": "route-june-retry",  # Different route for retry
                "snapshotId": "snap-20240620-retry",
                "mappingId": "mapping-v2",
                "transformId": "transform-v2",
            },
        }

        hash_1 = compute_canonical_hash(ingest_1)
        hash_2 = compute_canonical_hash(ingest_2)
        hash_2_retry = compute_canonical_hash(ingest_2_retry)

        # All three should produce identical hashes (same semantic content)
        assert hash_1 == hash_2, "Re-ingest should produce same hash"
        assert hash_2 == hash_2_retry, "Retry should produce same hash"
        assert hash_1 == hash_2_retry, "All ingests should produce same hash"
