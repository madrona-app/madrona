"""
Unit tests for delete detection service.
"""

import pytest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch
from uuid import uuid4

from app.services.delete_detection import (
    DeleteStrategy,
    DeleteDetectionMethod,
    DeleteMarker,
    DeleteResult,
    FullSyncDeleteDetector,
    IncrementalDeleteDetector,
    apply_delete_strategy,
    restore_archived_entities,
    should_detect_deletes,
    get_delete_strategy,
    create_delete_detector,
    process_delete_markers,
)


class TestDeleteMarker:
    """Test DeleteMarker dataclass."""

    def test_to_dict(self):
        """to_dict returns all fields."""
        marker = DeleteMarker(
            entity_key="test:conn:123",
            source_id="123",
            reason="User deleted",
            metadata={"user": "admin"},
        )
        d = marker.to_dict()
        assert d["entity_key"] == "test:conn:123"
        assert d["source_id"] == "123"
        assert d["reason"] == "User deleted"
        assert d["metadata"] == {"user": "admin"}
        assert "deleted_at" in d

    def test_default_deleted_at(self):
        """deleted_at defaults to now."""
        marker = DeleteMarker(entity_key="test:1", source_id="1")
        assert marker.deleted_at is not None
        # Should be very recent
        assert (datetime.now(timezone.utc) - marker.deleted_at).total_seconds() < 1

    def test_to_dict_serializes_datetime(self):
        """to_dict serializes datetime as ISO format."""
        deleted_at = datetime(2024, 1, 15, 10, 30, 0, tzinfo=timezone.utc)
        marker = DeleteMarker(
            entity_key="test:1",
            source_id="1",
            deleted_at=deleted_at,
        )
        d = marker.to_dict()
        assert d["deleted_at"] == "2024-01-15T10:30:00+00:00"


class TestDeleteResult:
    """Test DeleteResult dataclass."""

    def test_to_dict(self):
        """to_dict returns all counters."""
        result = DeleteResult(
            total_processed=100,
            deleted_count=50,
            marked_count=30,
            archived_count=10,
            skipped_count=5,
            error_count=5,
        )
        d = result.to_dict()
        assert d["total_processed"] == 100
        assert d["deleted_count"] == 50
        assert d["marked_count"] == 30
        assert d["archived_count"] == 10
        assert d["skipped_count"] == 5
        assert d["error_count"] == 5

    def test_to_dict_limits_errors(self):
        """to_dict limits errors to 20."""
        errors = [{"entity_key": f"key_{i}"} for i in range(30)]
        result = DeleteResult(
            total_processed=30,
            error_count=30,
            errors=errors,
        )
        d = result.to_dict()
        assert len(d["errors"]) == 20

    def test_defaults_to_zero(self):
        """All counters default to zero."""
        result = DeleteResult()
        assert result.total_processed == 0
        assert result.deleted_count == 0
        assert result.marked_count == 0
        assert result.archived_count == 0
        assert result.skipped_count == 0
        assert result.error_count == 0


class TestIncrementalDeleteDetector:
    """Test IncrementalDeleteDetector class."""

    def test_add_delete_marker(self):
        """Adds single marker."""
        session = MagicMock()
        org_id = uuid4()
        detector = IncrementalDeleteDetector(session, org_id)

        marker = DeleteMarker(entity_key="test:1", source_id="1")
        detector.add_delete_marker(marker)

        assert len(detector.get_delete_markers()) == 1
        assert detector.get_delete_markers()[0] == marker

    def test_add_delete_markers_batch(self):
        """Adds multiple markers."""
        session = MagicMock()
        org_id = uuid4()
        detector = IncrementalDeleteDetector(session, org_id)

        markers = [
            DeleteMarker(entity_key=f"test:{i}", source_id=str(i))
            for i in range(5)
        ]
        detector.add_delete_markers(markers)

        assert len(detector.get_delete_markers()) == 5

    def test_add_from_dict(self):
        """Creates marker from dictionary."""
        session = MagicMock()
        org_id = uuid4()
        detector = IncrementalDeleteDetector(session, org_id)

        data = {
            "entity_key": "test:conn:abc",
            "source_id": "abc",
            "reason": "Deleted by admin",
            "metadata": {"source": "webhook"},
        }
        marker = detector.add_from_dict(data)

        assert marker.entity_key == "test:conn:abc"
        assert marker.source_id == "abc"
        assert marker.reason == "Deleted by admin"
        assert marker.metadata == {"source": "webhook"}

    def test_add_from_dict_parses_iso_datetime(self):
        """Parses ISO datetime string."""
        session = MagicMock()
        org_id = uuid4()
        detector = IncrementalDeleteDetector(session, org_id)

        data = {
            "entity_key": "test:1",
            "source_id": "1",
            "deleted_at": "2024-01-15T10:30:00Z",
        }
        marker = detector.add_from_dict(data)

        assert marker.deleted_at.year == 2024
        assert marker.deleted_at.month == 1
        assert marker.deleted_at.day == 15

    def test_get_entity_keys(self):
        """Returns unique entity keys."""
        session = MagicMock()
        org_id = uuid4()
        detector = IncrementalDeleteDetector(session, org_id)

        # Add some markers including duplicates
        detector.add_delete_marker(DeleteMarker(entity_key="test:1", source_id="1"))
        detector.add_delete_marker(DeleteMarker(entity_key="test:2", source_id="2"))
        detector.add_delete_marker(DeleteMarker(entity_key="test:1", source_id="1"))  # Duplicate

        keys = detector.get_entity_keys()

        assert keys == {"test:1", "test:2"}

    def test_clear(self):
        """Clears all markers."""
        session = MagicMock()
        org_id = uuid4()
        detector = IncrementalDeleteDetector(session, org_id)

        detector.add_delete_marker(DeleteMarker(entity_key="test:1", source_id="1"))
        detector.clear()

        assert len(detector.get_delete_markers()) == 0

    def test_get_stats(self):
        """Returns marker statistics."""
        session = MagicMock()
        org_id = uuid4()
        detector = IncrementalDeleteDetector(session, org_id)

        detector.add_delete_marker(DeleteMarker(entity_key="test:1", source_id="1"))
        detector.add_delete_marker(DeleteMarker(entity_key="test:2", source_id="2"))
        detector.add_delete_marker(DeleteMarker(entity_key="test:1", source_id="1"))  # Duplicate

        stats = detector.get_stats()

        assert stats["marker_count"] == 3
        assert stats["unique_entity_keys"] == 2


class TestFullSyncDeleteDetector:
    """Test FullSyncDeleteDetector class."""

    def test_mark_seen_tracks_keys(self):
        """mark_seen adds keys to seen set."""
        session = MagicMock()
        session.execute.return_value = iter([])

        org_id = uuid4()
        detector = FullSyncDeleteDetector(session, org_id)
        detector.begin_sync()

        detector.mark_seen("test:1")
        detector.mark_seen("test:2")

        assert "test:1" in detector.seen_keys
        assert "test:2" in detector.seen_keys

    def test_mark_seen_batch(self):
        """mark_seen_batch adds multiple keys."""
        session = MagicMock()
        session.execute.return_value = iter([])

        org_id = uuid4()
        detector = FullSyncDeleteDetector(session, org_id)
        detector.begin_sync()

        detector.mark_seen_batch(["test:1", "test:2", "test:3"])

        assert len(detector.seen_keys) == 3

    def test_mark_seen_before_begin_sync_warns(self):
        """mark_seen before begin_sync is ignored."""
        session = MagicMock()
        org_id = uuid4()
        detector = FullSyncDeleteDetector(session, org_id)

        detector.mark_seen("test:1")

        # Key should not be tracked
        assert len(detector.seen_keys) == 0

    def test_get_deleted_keys_returns_difference(self):
        """get_deleted_keys returns known - seen."""
        session = MagicMock()
        session.execute.return_value = iter([("test:1",), ("test:2",), ("test:3",)])

        org_id = uuid4()
        detector = FullSyncDeleteDetector(session, org_id)
        detector.begin_sync()

        # Only mark 1 and 2 as seen
        detector.mark_seen("test:1")
        detector.mark_seen("test:2")

        deleted = detector.get_deleted_keys()

        assert deleted == {"test:3"}

    def test_get_deleted_keys_before_begin_sync(self):
        """get_deleted_keys returns empty before begin_sync."""
        session = MagicMock()
        org_id = uuid4()
        detector = FullSyncDeleteDetector(session, org_id)

        deleted = detector.get_deleted_keys()

        assert deleted == set()

    def test_get_stats(self):
        """get_stats returns counts."""
        session = MagicMock()
        session.execute.return_value = iter([("test:1",), ("test:2",)])

        org_id = uuid4()
        detector = FullSyncDeleteDetector(session, org_id)
        detector.begin_sync()
        detector.mark_seen("test:1")

        stats = detector.get_stats()

        assert stats["known_count"] == 2
        assert stats["seen_count"] == 1
        assert stats["deleted_count"] == 1
        assert stats["sync_started"] is True


class TestApplyDeleteStrategy:
    """Test apply_delete_strategy function and strategies."""

    @pytest.fixture
    def mock_entity(self):
        """Create a mock entity."""
        entity = MagicMock()
        entity.entity_key = "test:conn:123"
        entity.organization_id = uuid4()
        entity.dataset_id = uuid4()
        entity.entity_type = "record"
        entity.is_deleted = False
        entity.deleted_at = None
        entity.payload = {"properties": {"title": "Test"}}
        return entity

    def test_remove_strategy_soft_deletes(self, db_session, demo_tenant):
        """Remove strategy sets is_deleted=True."""
        from app.models import EntityCurrent, Run, Dataset

        # Create a dataset first
        dataset = Dataset(
            organization_id=demo_tenant.organization_id,
            name="Test Dataset",
            key="test_dataset",
        )
        db_session.add(dataset)
        db_session.commit()

        # Create a run with required fields
        run = Run(
            organization_id=demo_tenant.organization_id,
            dataset_id=dataset.dataset_id,
            status="running",
            triggered_by="test",
            parameters={},
        )
        db_session.add(run)
        db_session.commit()

        # Create an entity
        entity = EntityCurrent(
            organization_id=demo_tenant.organization_id,
            dataset_id=dataset.dataset_id,
            entity_key="test:conn:123",
            entity_type="record",
            source_system="test",
            source_id="123",
            payload={"properties": {"title": "Test"}},
            payload_hash="abc123",
            sources={},
            extracted_at=datetime.now(timezone.utc),
            last_seen_at=datetime.now(timezone.utc),
            is_deleted=False,
        )
        db_session.add(entity)
        db_session.commit()

        result = apply_delete_strategy(
            session=db_session,
            organization_id=demo_tenant.organization_id,
            entity_keys=["test:conn:123"],
            strategy=DeleteStrategy.REMOVE,
            run_id=run.run_id,
        )

        assert result.deleted_count == 1
        assert result.total_processed == 1

        # Verify entity was soft-deleted
        db_session.refresh(entity)
        assert entity.is_deleted is True
        assert entity.deleted_at is not None

    def test_mark_strategy_marks_without_delete(self, db_session, demo_tenant):
        """Mark strategy sets deletion_status but keeps is_deleted=False."""
        from app.models import EntityCurrent, Run, Dataset

        # Create a dataset first
        dataset = Dataset(
            organization_id=demo_tenant.organization_id,
            name="Test Dataset",
            key="test_dataset_mark",
        )
        db_session.add(dataset)
        db_session.commit()

        # Create a run with required fields
        run = Run(
            organization_id=demo_tenant.organization_id,
            dataset_id=dataset.dataset_id,
            status="running",
            triggered_by="test",
            parameters={},
        )
        db_session.add(run)
        db_session.commit()

        # Create an entity
        entity = EntityCurrent(
            organization_id=demo_tenant.organization_id,
            dataset_id=dataset.dataset_id,
            entity_key="test:conn:456",
            entity_type="record",
            source_system="test",
            source_id="456",
            payload={"properties": {"title": "Test"}},
            payload_hash="abc456",
            sources={},
            extracted_at=datetime.now(timezone.utc),
            last_seen_at=datetime.now(timezone.utc),
            is_deleted=False,
        )
        db_session.add(entity)
        db_session.commit()

        result = apply_delete_strategy(
            session=db_session,
            organization_id=demo_tenant.organization_id,
            entity_keys=["test:conn:456"],
            strategy=DeleteStrategy.MARK,
            run_id=run.run_id,
        )

        assert result.marked_count == 1

        # Verify entity is marked but not deleted
        db_session.refresh(entity)
        assert entity.is_deleted is False
        assert entity.payload["meta"]["deletion_status"] == "deleted"

    def test_archive_strategy_archives_entity(self, db_session, demo_tenant):
        """Archive strategy sets archive metadata and soft-deletes."""
        from app.models import EntityCurrent, Run, Dataset

        # Create a dataset first
        dataset = Dataset(
            organization_id=demo_tenant.organization_id,
            name="Test Dataset",
            key="test_dataset_archive",
        )
        db_session.add(dataset)
        db_session.commit()

        # Create a run with required fields
        run = Run(
            organization_id=demo_tenant.organization_id,
            dataset_id=dataset.dataset_id,
            status="running",
            triggered_by="test",
            parameters={},
        )
        db_session.add(run)
        db_session.commit()

        # Create an entity
        entity = EntityCurrent(
            organization_id=demo_tenant.organization_id,
            dataset_id=dataset.dataset_id,
            entity_key="test:conn:789",
            entity_type="record",
            source_system="test",
            source_id="789",
            payload={"properties": {"title": "Test"}},
            payload_hash="abc789",
            sources={},
            extracted_at=datetime.now(timezone.utc),
            last_seen_at=datetime.now(timezone.utc),
            is_deleted=False,
        )
        db_session.add(entity)
        db_session.commit()

        result = apply_delete_strategy(
            session=db_session,
            organization_id=demo_tenant.organization_id,
            entity_keys=["test:conn:789"],
            strategy=DeleteStrategy.ARCHIVE,
            run_id=run.run_id,
            archive_reason="Test archive",
        )

        assert result.archived_count == 1

        # Verify entity is archived
        db_session.refresh(entity)
        assert entity.is_deleted is True
        assert entity.payload["meta"]["archived"] is True
        assert entity.payload["meta"]["archive_reason"] == "Test archive"

    def test_skips_nonexistent_entity(self, db_session, demo_tenant):
        """Skips entity keys that don't exist."""
        from app.models import Run, Dataset

        # Create a dataset first
        dataset = Dataset(
            organization_id=demo_tenant.organization_id,
            name="Test Dataset",
            key="test_dataset_skip",
        )
        db_session.add(dataset)
        db_session.commit()

        run = Run(
            organization_id=demo_tenant.organization_id,
            dataset_id=dataset.dataset_id,
            status="running",
            triggered_by="test",
            parameters={},
        )
        db_session.add(run)
        db_session.commit()

        result = apply_delete_strategy(
            session=db_session,
            organization_id=demo_tenant.organization_id,
            entity_keys=["nonexistent:key"],
            strategy=DeleteStrategy.REMOVE,
            run_id=run.run_id,
        )

        assert result.skipped_count == 1
        assert result.deleted_count == 0

    def test_empty_entity_keys(self, db_session, demo_tenant):
        """Returns empty result for empty entity keys."""
        run_id = uuid4()

        result = apply_delete_strategy(
            session=db_session,
            organization_id=demo_tenant.organization_id,
            entity_keys=[],
            strategy=DeleteStrategy.REMOVE,
            run_id=run_id,
        )

        assert result.total_processed == 0


class TestRestoreArchivedEntities:
    """Test restore_archived_entities function."""

    def test_restore_archived_entity(self, db_session, demo_tenant):
        """Restores an archived entity."""
        from app.models import EntityCurrent, Run, Dataset

        # Create a dataset first
        dataset = Dataset(
            organization_id=demo_tenant.organization_id,
            name="Test Dataset",
            key="test_dataset_restore",
        )
        db_session.add(dataset)
        db_session.commit()

        # Create a run with required fields
        run = Run(
            organization_id=demo_tenant.organization_id,
            dataset_id=dataset.dataset_id,
            status="running",
            triggered_by="test",
            parameters={},
        )
        db_session.add(run)
        db_session.commit()

        # Create an archived entity
        entity = EntityCurrent(
            organization_id=demo_tenant.organization_id,
            dataset_id=dataset.dataset_id,
            entity_key="test:conn:restore",
            entity_type="record",
            source_system="test",
            source_id="restore",
            payload={
                "properties": {"title": "Test"},
                "meta": {"archived": True},
            },
            payload_hash="abc_restore",
            sources={},
            extracted_at=datetime.now(timezone.utc),
            last_seen_at=datetime.now(timezone.utc),
            is_deleted=True,
            deleted_at=datetime.now(timezone.utc),
        )
        db_session.add(entity)
        db_session.commit()

        counts = restore_archived_entities(
            session=db_session,
            organization_id=demo_tenant.organization_id,
            entity_keys=["test:conn:restore"],
            run_id=run.run_id,
        )

        assert counts["restored"] == 1

        # Verify entity is restored
        db_session.refresh(entity)
        assert entity.is_deleted is False
        assert entity.payload["meta"]["archived"] is False
        assert "restored_at" in entity.payload["meta"]

    def test_skip_non_archived_entity(self, db_session, demo_tenant):
        """Skips entities that aren't archived."""
        from app.models import EntityCurrent, Run, Dataset

        # Create a dataset first
        dataset = Dataset(
            organization_id=demo_tenant.organization_id,
            name="Test Dataset",
            key="test_dataset_skiparchive",
        )
        db_session.add(dataset)
        db_session.commit()

        # Create a run with required fields
        run = Run(
            organization_id=demo_tenant.organization_id,
            dataset_id=dataset.dataset_id,
            status="running",
            triggered_by="test",
            parameters={},
        )
        db_session.add(run)
        db_session.commit()

        # Create a deleted but not archived entity
        entity = EntityCurrent(
            organization_id=demo_tenant.organization_id,
            dataset_id=dataset.dataset_id,
            entity_key="test:conn:notarchived",
            entity_type="record",
            source_system="test",
            source_id="notarchived",
            payload={"properties": {"title": "Test"}},
            payload_hash="abc_notarchived",
            sources={},
            extracted_at=datetime.now(timezone.utc),
            last_seen_at=datetime.now(timezone.utc),
            is_deleted=True,
            deleted_at=datetime.now(timezone.utc),
        )
        db_session.add(entity)
        db_session.commit()

        counts = restore_archived_entities(
            session=db_session,
            organization_id=demo_tenant.organization_id,
            entity_keys=["test:conn:notarchived"],
            run_id=run.run_id,
        )

        assert counts["skipped"] == 1
        assert counts["restored"] == 0


class TestHelperFunctions:
    """Test helper functions."""

    def test_should_detect_deletes_disabled(self):
        """Returns False when delete detection is disabled."""
        pipeline = MagicMock()
        pipeline.delete_detection_enabled = False

        assert should_detect_deletes(pipeline, "full") is False

    def test_should_detect_deletes_full_sync_method(self):
        """Full sync method only runs on full sync type."""
        pipeline = MagicMock()
        pipeline.delete_detection_enabled = True
        pipeline.delete_detection_method = "full_sync"
        pipeline.pipeline_id = uuid4()

        assert should_detect_deletes(pipeline, "full") is True
        assert should_detect_deletes(pipeline, "incremental") is False

    def test_should_detect_deletes_incremental_method(self):
        """Incremental method runs on any sync type."""
        pipeline = MagicMock()
        pipeline.delete_detection_enabled = True
        pipeline.delete_detection_method = "incremental"

        assert should_detect_deletes(pipeline, "full") is True
        assert should_detect_deletes(pipeline, "incremental") is True

    def test_get_delete_strategy_valid(self):
        """Returns correct strategy enum."""
        for strategy_str, expected in [
            ("remove", DeleteStrategy.REMOVE),
            ("mark", DeleteStrategy.MARK),
            ("archive", DeleteStrategy.ARCHIVE),
        ]:
            pipeline = MagicMock()
            pipeline.delete_strategy = strategy_str
            pipeline.pipeline_id = uuid4()

            assert get_delete_strategy(pipeline) == expected

    def test_get_delete_strategy_default(self):
        """Defaults to REMOVE for unknown strategy."""
        pipeline = MagicMock()
        pipeline.delete_strategy = "unknown"
        pipeline.pipeline_id = uuid4()

        assert get_delete_strategy(pipeline) == DeleteStrategy.REMOVE

    def test_get_delete_strategy_none(self):
        """Defaults to REMOVE when strategy is None."""
        pipeline = MagicMock()
        pipeline.delete_strategy = None
        pipeline.pipeline_id = uuid4()

        assert get_delete_strategy(pipeline) == DeleteStrategy.REMOVE

    def test_create_delete_detector_disabled(self):
        """Returns None when delete detection is disabled."""
        session = MagicMock()
        pipeline = MagicMock()
        pipeline.delete_detection_enabled = False

        result = create_delete_detector(session, pipeline, None)

        assert result is None

    def test_create_delete_detector_full_sync(self):
        """Creates FullSyncDeleteDetector for full_sync method."""
        session = MagicMock()
        pipeline = MagicMock()
        pipeline.delete_detection_enabled = True
        pipeline.delete_detection_method = "full_sync"
        pipeline.organization_id = uuid4()

        result = create_delete_detector(session, pipeline, None)

        assert isinstance(result, FullSyncDeleteDetector)

    def test_create_delete_detector_incremental(self):
        """Creates IncrementalDeleteDetector for incremental method."""
        session = MagicMock()
        pipeline = MagicMock()
        pipeline.delete_detection_enabled = True
        pipeline.delete_detection_method = "incremental"
        pipeline.organization_id = uuid4()

        result = create_delete_detector(session, pipeline, None)

        assert isinstance(result, IncrementalDeleteDetector)


class TestProcessDeleteMarkers:
    """Test process_delete_markers convenience function."""

    def test_process_delete_markers(self, db_session, demo_tenant):
        """Processes markers using specified strategy."""
        from app.models import EntityCurrent, Run, Dataset

        # Create a dataset first
        dataset = Dataset(
            organization_id=demo_tenant.organization_id,
            name="Test Dataset",
            key="test_dataset_markers",
        )
        db_session.add(dataset)
        db_session.commit()

        # Create a run with required fields
        run = Run(
            organization_id=demo_tenant.organization_id,
            dataset_id=dataset.dataset_id,
            status="running",
            triggered_by="test",
            parameters={},
        )
        db_session.add(run)
        db_session.commit()

        # Create an entity
        entity = EntityCurrent(
            organization_id=demo_tenant.organization_id,
            dataset_id=dataset.dataset_id,
            entity_key="test:conn:marker",
            entity_type="record",
            source_system="test",
            source_id="marker",
            payload={"properties": {"title": "Test"}},
            payload_hash="abc_marker",
            sources={},
            extracted_at=datetime.now(timezone.utc),
            last_seen_at=datetime.now(timezone.utc),
            is_deleted=False,
        )
        db_session.add(entity)
        db_session.commit()

        markers = [
            DeleteMarker(entity_key="test:conn:marker", source_id="marker")
        ]

        result = process_delete_markers(
            session=db_session,
            organization_id=demo_tenant.organization_id,
            markers=markers,
            strategy=DeleteStrategy.REMOVE,
            run_id=run.run_id,
        )

        assert result.deleted_count == 1

        # Verify entity was deleted
        db_session.refresh(entity)
        assert entity.is_deleted is True
