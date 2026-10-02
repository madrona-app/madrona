"""
Tests for canonical store service.

Tests entity upsert, hash computation, change detection, and event emission.

Pure function tests (hash, diff) run without database.
Integration tests require PostgreSQL with TEST_DATABASE_URL set.
"""

import json
from datetime import datetime, timezone
from uuid import uuid4

import pytest

from app.models import EntityCurrent, EntityField, ChangeEvent, FieldDiff, Organization, Run
from app.services.canonical_store import (
    compute_payload_hash,
    compute_field_diffs,
    upsert_entity,
    batch_upsert_entities,
)

pytestmark = pytest.mark.postgres


@pytest.fixture(autouse=True)
def _force_canonical_warn_mode(monkeypatch):
    """Several tests in this module feed legacy payload shapes to upsert_entity
    to exercise the legacy-fallback wrap path. In CI the env sets
    CANONICAL_VALIDATION_MODE=error which rejects them.

    This fixture pins warn-mode for this module's tests by patching the
    validation-mode resolver directly. The error-mode path is tested
    separately in TestCanonicalIngestionIntegration."""
    monkeypatch.setattr(
        "app.services.canonical_store._get_validation_mode",
        lambda: "warn",
    )
    yield


class TestComputePayloadHash:
    """Test payload hash computation with stable key ordering."""

    def test_hash_is_deterministic(self):
        """Same payload produces same hash."""
        payload = {"title": "Test", "id": 123, "tags": ["a", "b"]}
        
        hash1 = compute_payload_hash(payload)
        hash2 = compute_payload_hash(payload)
        
        assert hash1 == hash2
        assert len(hash1) == 64  # SHA256 hex length

    def test_hash_with_different_key_order(self):
        """Different key order produces same hash (stable ordering)."""
        payload1 = {"title": "Test", "id": 123, "tags": ["a", "b"]}
        payload2 = {"tags": ["a", "b"], "id": 123, "title": "Test"}
        
        hash1 = compute_payload_hash(payload1)
        hash2 = compute_payload_hash(payload2)
        
        assert hash1 == hash2

    def test_hash_changes_with_content(self):
        """Different content produces different hash."""
        # Canonical hash is semantic: uses id/type/label/properties/etc.
        # Must vary a semantic field (e.g. label) for the hash to change.
        payload1 = {"id": "mdrn:test:123", "type": "Object", "label": "Test 1"}
        payload2 = {"id": "mdrn:test:123", "type": "Object", "label": "Test 2"}

        hash1 = compute_payload_hash(payload1)
        hash2 = compute_payload_hash(payload2)

        assert hash1 != hash2

    def test_hash_with_nested_objects(self):
        """Nested objects are hashed correctly."""
        payload = {
            "title": "Test",
            "metadata": {"author": "John", "year": 2026},
            "tags": ["a", "b"],
        }
        
        hash1 = compute_payload_hash(payload)
        assert len(hash1) == 64

    def test_hash_with_special_characters(self):
        """Special characters don't break hashing."""
        payload = {
            "title": "Test \"quoted\" & <special>",
            "description": "Line 1\nLine 2\tTabbed",
        }
        
        hash1 = compute_payload_hash(payload)
        assert len(hash1) == 64


class TestComputeFieldDiffs:
    """Test field-level diff computation."""

    def test_no_differences(self):
        """Identical payloads produce no diffs."""
        old = {"title": "Test", "id": 123}
        new = {"title": "Test", "id": 123}
        
        changed_fields, diffs = compute_field_diffs(old, new)
        
        assert changed_fields == []
        assert diffs == []

    def test_single_field_changed(self):
        """Single field change detected."""
        old = {"title": "Old Title", "id": 123}
        new = {"title": "New Title", "id": 123}
        
        changed_fields, diffs = compute_field_diffs(old, new)
        
        assert changed_fields == ["title"]
        assert len(diffs) == 1
        assert diffs[0]["field_name"] == "title"
        assert diffs[0]["old_value"] == "Old Title"
        assert diffs[0]["new_value"] == "New Title"

    def test_multiple_fields_changed(self):
        """Multiple field changes detected."""
        old = {"title": "Old", "object_number": "123", "author": "John"}
        new = {"title": "New", "object_number": "456", "author": "John"}
        
        changed_fields, diffs = compute_field_diffs(old, new)
        
        assert sorted(changed_fields) == ["object_number", "title"]
        assert len(diffs) == 2

    def test_field_added(self):
        """New field detected as change."""
        old = {"title": "Test"}
        new = {"title": "Test", "thumbnail_url": "https://example.com/img.jpg"}
        
        changed_fields, diffs = compute_field_diffs(old, new)
        
        assert changed_fields == ["thumbnail_url"]
        assert diffs[0]["old_value"] is None
        assert diffs[0]["new_value"] == "https://example.com/img.jpg"

    def test_field_removed(self):
        """Removed field detected as change."""
        old = {"title": "Test", "canonical_url": "https://example.com/1"}
        new = {"title": "Test"}
        
        changed_fields, diffs = compute_field_diffs(old, new)
        
        assert changed_fields == ["canonical_url"]
        assert diffs[0]["old_value"] == "https://example.com/1"
        assert diffs[0]["new_value"] is None

    def test_nested_object_change(self):
        """Non-projected fields are ignored (e.g. metadata)."""
        old = {"title": "Test", "metadata": {"author": "John", "year": 2025}}
        new = {"title": "Test", "metadata": {"author": "Jane", "year": 2026}}
        
        changed_fields, diffs = compute_field_diffs(old, new)
        
        # metadata is not in PROJECTED_FIELDS_FOR_DIFF, so no change detected
        assert changed_fields == []
        assert len(diffs) == 0


class TestUpsertEntityCreated:
    """Test entity creation (new entity)."""

    def test_create_new_entity(self, db_session, test_tenant, test_run):
        """New entity is created with change event."""
        # Use full canonical payload so the service stores it as-is
        # (legacy payloads get wrapped with meta/provenance and fail equality checks).
        canonical_payload = {
            "id": "mdrn:test:123",
            "type": "Object",
            "label": "Test Object",
            "description": "Test description",
            "provenance": {
                "source": {"system": "test", "recordId": "123"},
                "ingestedAt": "2026-01-04T10:00:00Z",
            },
            "meta": {
                "schemaVersion": "1.0.0",
                "createdAt": "2026-01-04T10:00:00Z",
                "updatedAt": "2026-01-04T10:00:00Z",
            },
        }
        canonical_record = {
            "entity_key": "test:123",
            "source_system": "test",
            "source_id": "123",
            "title": "Test Object",
            "payload": canonical_payload,
            "canonical_url": "https://example.com/123",
        }
        
        change_type, change_event = upsert_entity(
            session=db_session,
            organization_id=test_tenant.organization_id,
            run_id=test_run.run_id,
            pipeline_id=None,
            canonical_record=canonical_record,
        )
        
        db_session.commit()
        
        # Check change type
        assert change_type == "created"
        assert change_event is not None
        
        # Check entity_current
        entity = db_session.query(EntityCurrent).filter_by(
            organization_id=test_tenant.organization_id,
            entity_key="test:123"
        ).first()
        assert entity is not None
        assert entity.source_system == "test"
        assert entity.source_id == "123"
        assert entity.canonical_url == "https://example.com/123"
        assert entity.payload == canonical_record["payload"]
        assert len(entity.payload_hash) == 64
        
        # Check change event
        assert change_event.change_type == "created"
        assert change_event.entity_key == "test:123"
        assert change_event.applied is True
        assert change_event.changed_fields is None
        assert change_event.old_hash is None
        assert change_event.new_hash == entity.payload_hash
        assert "Created" in change_event.summary

    def test_create_populates_entity_fields(self, db_session, test_tenant, test_run):
        """Entity fields projection is populated."""
        canonical_record = {
            "entity_key": "test:456",
            "source_system": "test",
            "source_id": "456",
            "title": "Test Title",
            "object_number": "OBJ-456",
            "thumbnail_url": "https://example.com/thumb.jpg",
            "modified_at": "2026-01-04T10:00:00Z",
            "payload": {"title": "Test Title"},
        }
        
        upsert_entity(
            session=db_session,
            organization_id=test_tenant.organization_id,
            run_id=test_run.run_id,
            pipeline_id=None,
            canonical_record=canonical_record,
        )
        
        db_session.commit()
        
        # Check entity_fields
        fields = db_session.query(EntityField).filter_by(
            organization_id=test_tenant.organization_id,
            entity_key="test:456"
        ).first()
        assert fields is not None
        assert fields.title == "Test Title"
        assert fields.object_number == "OBJ-456"
        assert fields.thumbnail_url == "https://example.com/thumb.jpg"
        assert fields.modified_at is not None
        assert fields.last_run_id == test_run.run_id


class TestUpsertEntityUpdated:
    """Test entity update (changed entity)."""

    def test_update_changed_entity(self, db_session, test_tenant, test_run):
        """Changed entity is updated with change event."""
        # Use canonical-format payloads so (a) payload is stored as-is and
        # (b) hash sees semantic changes (label/description/identifiers).
        base_provenance = {
            "source": {"system": "test", "recordId": "789"},
            "ingestedAt": "2026-01-04T10:00:00Z",
        }
        base_meta = {
            "schemaVersion": "1.0.0",
            "createdAt": "2026-01-04T10:00:00Z",
            "updatedAt": "2026-01-04T10:00:00Z",
        }

        canonical_record_v1 = {
            "entity_key": "test:789",
            "source_system": "test",
            "source_id": "789",
            "title": "Original Title",
            "payload": {
                "id": "mdrn:test:789",
                "type": "Object",
                "label": "Original Title",
                "description": "Original description",
                "provenance": base_provenance,
                "meta": base_meta,
            },
        }

        upsert_entity(
            session=db_session,
            organization_id=test_tenant.organization_id,
            run_id=test_run.run_id,
            pipeline_id=None,
            canonical_record=canonical_record_v1,
        )
        db_session.commit()

        # Create second run for the update
        from app.models import Run
        run2 = Run(
            organization_id=test_tenant.organization_id,
            pipeline_id=None,
            status="running",
            parameters={},
        )
        db_session.add(run2)
        db_session.flush()

        # Update with changed data in second run
        canonical_record_v2 = {
            "entity_key": "test:789",
            "source_system": "test",
            "source_id": "789",
            "title": "Updated Title",
            "payload": {
                "id": "mdrn:test:789",
                "type": "Object",
                "label": "Updated Title",
                "description": "Updated description",
                "identifiers": [
                    {"scheme": "accession", "value": "OBJ-456"},
                    {"scheme": "url", "value": "https://example.com/updated"},
                ],
                "provenance": base_provenance,
                "meta": base_meta,
            },
        }

        change_type, change_event = upsert_entity(
            session=db_session,
            organization_id=test_tenant.organization_id,
            run_id=run2.run_id,  # Use second run
            pipeline_id=None,
            canonical_record=canonical_record_v2,
        )

        db_session.commit()

        # Check change type
        assert change_type == "updated"
        assert change_event is not None

        # Check entity_current is updated
        entity = db_session.query(EntityCurrent).filter_by(
            organization_id=test_tenant.organization_id,
            entity_key="test:789"
        ).first()
        assert entity.payload == canonical_record_v2["payload"]

        # Check change event
        assert change_event.change_type == "updated"
        assert change_event.entity_key == "test:789"
        assert change_event.changed_fields is not None
        # Canonical-format comparison uses label/description and identifier-derived fields
        assert set(change_event.changed_fields) == {
            "label", "description", "object_number", "canonical_url"
        }
        assert change_event.old_hash is not None
        assert change_event.new_hash is not None
        assert change_event.old_hash != change_event.new_hash

    def test_update_creates_field_diffs(self, db_session, test_tenant, test_run):
        """Field diffs are created for updated entity."""
        base_provenance = {
            "source": {"system": "test", "recordId": "999"},
            "ingestedAt": "2026-01-04T10:00:00Z",
        }
        base_meta = {
            "schemaVersion": "1.0.0",
            "createdAt": "2026-01-04T10:00:00Z",
            "updatedAt": "2026-01-04T10:00:00Z",
        }

        # Create initial entity in first run
        canonical_record_v1 = {
            "entity_key": "test:999",
            "source_system": "test",
            "source_id": "999",
            "payload": {
                "id": "mdrn:test:999",
                "type": "Object",
                "label": "Old",
                "identifiers": [{"scheme": "accession", "value": "123"}],
                "provenance": base_provenance,
                "meta": base_meta,
            },
        }

        upsert_entity(
            session=db_session,
            organization_id=test_tenant.organization_id,
            run_id=test_run.run_id,
            pipeline_id=None,
            canonical_record=canonical_record_v1,
        )
        db_session.commit()

        # Create second run for the update
        from app.models import Run
        run2 = Run(
            organization_id=test_tenant.organization_id,
            pipeline_id=None,
            status="running",
            parameters={},
        )
        db_session.add(run2)
        db_session.flush()

        # Update in second run
        canonical_record_v2 = {
            "entity_key": "test:999",
            "source_system": "test",
            "source_id": "999",
            "payload": {
                "id": "mdrn:test:999",
                "type": "Object",
                "label": "New",
                "identifiers": [{"scheme": "accession", "value": "456"}],
                "provenance": base_provenance,
                "meta": base_meta,
            },
        }

        _, change_event = upsert_entity(
            session=db_session,
            organization_id=test_tenant.organization_id,
            run_id=run2.run_id,  # Use second run
            pipeline_id=None,
            canonical_record=canonical_record_v2,
        )

        db_session.commit()

        # Check field diffs
        diffs = db_session.query(FieldDiff).filter_by(
            organization_id=test_tenant.organization_id,
            change_id=change_event.change_id
        ).all()

        assert len(diffs) == 2

        # Find label diff (canonical equivalent of legacy "title")
        label_diff = next(d for d in diffs if d.field_name == "label")
        assert label_diff.old_value == "Old"
        assert label_diff.new_value == "New"

        # Find object_number diff (derived from identifiers[scheme=accession])
        obj_num_diff = next(d for d in diffs if d.field_name == "object_number")
        assert obj_num_diff.old_value == "123"
        assert obj_num_diff.new_value == "456"


class TestUpsertEntityUnchanged:
    """Test unchanged entity (noop)."""

    def test_unchanged_entity_noop(self, db_session, test_tenant, test_run):
        """Unchanged entity does not trigger update or event."""
        canonical_record = {
            "entity_key": "test:111",
            "source_system": "test",
            "source_id": "111",
            "payload": {"title": "Unchanged", "id": 111},
        }
        
        # Create initial
        upsert_entity(
            session=db_session,
            organization_id=test_tenant.organization_id,
            run_id=test_run.run_id,
            pipeline_id=None,
            canonical_record=canonical_record,
        )
        db_session.commit()
        
        initial_updated_at = db_session.query(EntityCurrent).filter_by(
            organization_id=test_tenant.organization_id,
            entity_key="test:111"
        ).first().updated_at
        
        # Re-upsert with same data
        change_type, change_event = upsert_entity(
            session=db_session,
            organization_id=test_tenant.organization_id,
            run_id=test_run.run_id,
            pipeline_id=None,
            canonical_record=canonical_record,
        )
        
        db_session.commit()
        
        # Check change type
        assert change_type == "noop"
        assert change_event is None
        
        # Verify no change event created
        events = db_session.query(ChangeEvent).filter_by(
            organization_id=test_tenant.organization_id,
            entity_key="test:111",
            change_type="noop"
        ).all()
        assert len(events) == 0

    def test_unchanged_with_reordered_keys(self, db_session, test_tenant, test_run):
        """Reordered keys don't trigger update (stable hash)."""
        canonical_record_v1 = {
            "entity_key": "test:222",
            "source_system": "test",
            "source_id": "222",
            "payload": {"title": "Test", "year": 2026, "author": "John"},
        }
        
        upsert_entity(
            session=db_session,
            organization_id=test_tenant.organization_id,
            run_id=test_run.run_id,
            pipeline_id=None,
            canonical_record=canonical_record_v1,
        )
        db_session.commit()
        
        # Re-upsert with different key order
        canonical_record_v2 = {
            "entity_key": "test:222",
            "source_system": "test",
            "source_id": "222",
            "payload": {"author": "John", "title": "Test", "year": 2026},
        }
        
        change_type, change_event = upsert_entity(
            session=db_session,
            organization_id=test_tenant.organization_id,
            run_id=test_run.run_id,
            pipeline_id=None,
            canonical_record=canonical_record_v2,
        )
        
        # Should be noop (same hash despite different key order)
        assert change_type == "noop"
        assert change_event is None


class TestBatchUpsertEntities:
    """Test batch upsert operations."""

    def test_batch_upsert_mixed_operations(self, db_session, test_tenant, test_run):
        """Batch upsert with mixed create/update/noop."""
        #  Create one entity initially in a previous run
        from app.models import Run
        run_initial = Run(
            organization_id=test_tenant.organization_id,
            pipeline_id=None,
            status="success",
            parameters={},
        )
        db_session.add(run_initial)
        db_session.flush()
        
        base_meta = {
            "schemaVersion": "1.0.0",
            "createdAt": "2026-01-04T10:00:00Z",
            "updatedAt": "2026-01-04T10:00:00Z",
        }

        def _canonical(entity_id: str, label: str) -> dict:
            return {
                "id": f"mdrn:test:{entity_id}",
                "type": "Object",
                "label": label,
                "provenance": {
                    "source": {"system": "test", "recordId": entity_id},
                    "ingestedAt": "2026-01-04T10:00:00Z",
                },
                "meta": base_meta,
            }

        existing_record = {
            "entity_key": "test:batch1",
            "source_system": "test",
            "source_id": "batch1",
            "payload": _canonical("batch1", "Existing"),
        }

        upsert_entity(
            session=db_session,
            organization_id=test_tenant.organization_id,
            run_id=run_initial.run_id,  # Different run
            pipeline_id=None,
            canonical_record=existing_record,
        )
        db_session.commit()

        # Batch upsert: unchanged, updated, new
        batch_records = [
            {
                "entity_key": "test:batch1",
                "source_system": "test",
                "source_id": "batch1",
                "payload": _canonical("batch1", "Existing"),  # Unchanged
            },
            {
                "entity_key": "test:batch2",
                "source_system": "test",
                "source_id": "batch2",
                "payload": _canonical("batch2", "New Entity"),  # New
            },
            {
                "entity_key": "test:batch1",
                "source_system": "test",
                "source_id": "batch1",
                "payload": _canonical("batch1", "Updated"),  # Updated (processed again)
            },
        ]
        
        counts = batch_upsert_entities(
            session=db_session,
            organization_id=test_tenant.organization_id,
            run_id=test_run.run_id,
            pipeline_id=None,
            canonical_records=batch_records,
        )
        
        db_session.commit()
        
        # batch1 appears twice: first unchanged (noop), second updated (emits event)
        # batch2 is new (created)
        # With unique constraint: only one meaningful change per entity per run
        assert counts["noop"] == 1  # First batch1 is unchanged
        assert counts["created"] == 1  # batch2
        assert counts["updated"] == 1  # Second batch1 is updated


class TestBatchBulkInsertOptimization:
    """Test bulk insert optimization for new entities."""

    def test_bulk_insert_multiple_new_entities(self, db_session, test_tenant, test_run):
        """Bulk insert creates multiple new entities efficiently."""
        batch_records = [
            {
                "entity_key": f"test:bulk{i}",
                "source_system": "test",
                "source_id": f"bulk{i}",
                "title": f"Bulk Entity {i}",
                "object_number": f"OBJ-{i:03d}",
                "payload": {"title": f"Bulk Entity {i}", "index": i},
            }
            for i in range(10)
        ]

        counts = batch_upsert_entities(
            session=db_session,
            organization_id=test_tenant.organization_id,
            run_id=test_run.run_id,
            pipeline_id=None,
            canonical_records=batch_records,
        )

        db_session.commit()

        # All should be created via bulk insert
        assert counts["created"] == 10
        assert counts["updated"] == 0
        assert counts["noop"] == 0

        # Verify EntityCurrent records
        entities = db_session.query(EntityCurrent).filter_by(
            organization_id=test_tenant.organization_id
        ).filter(EntityCurrent.entity_key.like("test:bulk%")).all()
        assert len(entities) == 10

        # Verify each entity has correct data
        for entity in entities:
            idx = int(entity.entity_key.split("bulk")[1])
            assert entity.source_system == "test"
            assert entity.payload["title"] == f"Bulk Entity {idx}"
            assert len(entity.payload_hash) == 64

    def test_bulk_insert_creates_entity_fields(self, db_session, test_tenant, test_run):
        """Bulk insert populates entity_fields table."""
        batch_records = [
            {
                "entity_key": f"test:fields{i}",
                "source_system": "test",
                "source_id": f"fields{i}",
                "title": f"Entity {i}",
                "object_number": f"NUM-{i}",
                "thumbnail_url": f"https://example.com/thumb{i}.jpg",
                "payload": {"title": f"Entity {i}"},
            }
            for i in range(5)
        ]

        batch_upsert_entities(
            session=db_session,
            organization_id=test_tenant.organization_id,
            run_id=test_run.run_id,
            pipeline_id=None,
            canonical_records=batch_records,
        )

        db_session.commit()

        # Verify EntityField records
        fields = db_session.query(EntityField).filter_by(
            organization_id=test_tenant.organization_id
        ).filter(EntityField.entity_key.like("test:fields%")).all()
        assert len(fields) == 5

        for field in fields:
            idx = int(field.entity_key.split("fields")[1])
            assert field.title == f"Entity {idx}"
            assert field.object_number == f"NUM-{idx}"
            assert field.thumbnail_url == f"https://example.com/thumb{idx}.jpg"
            assert field.last_run_id == test_run.run_id

    def test_bulk_insert_creates_change_events(self, db_session, test_tenant, test_run):
        """Bulk insert creates change events for all new entities."""
        batch_records = [
            {
                "entity_key": f"test:events{i}",
                "source_system": "test",
                "source_id": f"events{i}",
                "payload": {"title": f"Event Entity {i}"},
            }
            for i in range(5)
        ]

        batch_upsert_entities(
            session=db_session,
            organization_id=test_tenant.organization_id,
            run_id=test_run.run_id,
            pipeline_id=None,
            canonical_records=batch_records,
        )

        db_session.commit()

        # Verify ChangeEvent records
        events = db_session.query(ChangeEvent).filter_by(
            organization_id=test_tenant.organization_id,
            run_id=test_run.run_id,
            change_type="created",
        ).filter(ChangeEvent.entity_key.like("test:events%")).all()
        assert len(events) == 5

        for event in events:
            assert event.applied is True
            assert event.old_hash is None
            assert event.new_hash is not None
            assert len(event.new_hash) == 64
            assert "Created" in event.summary

    def test_mixed_bulk_insert_and_updates(self, db_session, test_tenant, test_run):
        """Batch with both new entities (bulk insert) and existing entities (updates)."""
        # Create some existing entities in a prior run
        from app.models import Run
        run_prior = Run(
            organization_id=test_tenant.organization_id,
            pipeline_id=None,
            status="success",
            parameters={},
        )
        db_session.add(run_prior)
        db_session.flush()

        base_meta = {
            "schemaVersion": "1.0.0",
            "createdAt": "2026-01-04T10:00:00Z",
            "updatedAt": "2026-01-04T10:00:00Z",
        }

        def _canonical(entity_id: str, label: str) -> dict:
            return {
                "id": f"mdrn:test:{entity_id}",
                "type": "Object",
                "label": label,
                "provenance": {
                    "source": {"system": "test", "recordId": entity_id},
                    "ingestedAt": "2026-01-04T10:00:00Z",
                },
                "meta": base_meta,
            }

        existing_records = [
            {
                "entity_key": f"test:mixed{i}",
                "source_system": "test",
                "source_id": f"mixed{i}",
                "payload": _canonical(f"mixed{i}", f"Original {i}"),
            }
            for i in range(3)  # Create 3 existing
        ]

        for record in existing_records:
            upsert_entity(
                session=db_session,
                organization_id=test_tenant.organization_id,
                run_id=run_prior.run_id,
                pipeline_id=None,
                canonical_record=record,
            )
        db_session.commit()

        # Now batch upsert: 3 existing (1 updated, 2 noop) + 3 new
        batch_records = [
            # Existing - unchanged (noop)
            {
                "entity_key": "test:mixed0",
                "source_system": "test",
                "source_id": "mixed0",
                "payload": _canonical("mixed0", "Original 0"),
            },
            # Existing - updated
            {
                "entity_key": "test:mixed1",
                "source_system": "test",
                "source_id": "mixed1",
                "payload": _canonical("mixed1", "Updated 1"),
            },
            # Existing - unchanged (noop)
            {
                "entity_key": "test:mixed2",
                "source_system": "test",
                "source_id": "mixed2",
                "payload": _canonical("mixed2", "Original 2"),
            },
            # New entities - should use bulk insert path
            {
                "entity_key": "test:mixed3",
                "source_system": "test",
                "source_id": "mixed3",
                "payload": _canonical("mixed3", "New 3"),
            },
            {
                "entity_key": "test:mixed4",
                "source_system": "test",
                "source_id": "mixed4",
                "payload": _canonical("mixed4", "New 4"),
            },
            {
                "entity_key": "test:mixed5",
                "source_system": "test",
                "source_id": "mixed5",
                "payload": _canonical("mixed5", "New 5"),
            },
        ]

        counts = batch_upsert_entities(
            session=db_session,
            organization_id=test_tenant.organization_id,
            run_id=test_run.run_id,
            pipeline_id=None,
            canonical_records=batch_records,
        )

        db_session.commit()

        # Verify counts
        assert counts["created"] == 3  # mixed3, mixed4, mixed5
        assert counts["updated"] == 1  # mixed1
        assert counts["noop"] == 2  # mixed0, mixed2

        # Verify all 6 entities exist
        all_entities = db_session.query(EntityCurrent).filter_by(
            organization_id=test_tenant.organization_id
        ).filter(EntityCurrent.entity_key.like("test:mixed%")).all()
        assert len(all_entities) == 6

        # Verify updated entity has new payload
        updated_entity = db_session.query(EntityCurrent).filter_by(
            organization_id=test_tenant.organization_id,
            entity_key="test:mixed1"
        ).first()
        assert updated_entity.payload["label"] == "Updated 1"
        assert updated_entity.payload["id"] == "mdrn:test:mixed1"


class TestUpsertEntityValidation:
    """Test validation and error handling."""

    def test_missing_required_fields(self, db_session, test_tenant, test_run):
        """Missing required fields raises ValueError."""
        incomplete_record = {
            "entity_key": "test:incomplete",
            # Missing source_system, source_id, payload
        }

        with pytest.raises(ValueError, match="Missing required fields"):
            upsert_entity(
                session=db_session,
                organization_id=test_tenant.organization_id,
                run_id=test_run.run_id,
                pipeline_id=None,
                canonical_record=incomplete_record,
            )
