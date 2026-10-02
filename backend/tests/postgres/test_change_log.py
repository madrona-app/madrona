"""
Tests for change log service.

Tests querying and formatting change events.

Requires PostgreSQL with TEST_DATABASE_URL set.
"""

from datetime import datetime, timezone, timedelta
from uuid import uuid4

import pytest

from app.models import ChangeEvent, FieldDiff, Run
from app.services.change_log import (
    get_change_events_for_run,
    get_change_events_for_entity,
    get_recent_changes,
    format_change_event_for_target,
    format_change_events_for_target,
    compute_run_summary,
)

pytestmark = pytest.mark.postgres


class TestGetChangeEventsForRun:
    """Test retrieving change events for a specific run."""

    def test_get_all_change_events_for_run(self, db_session, test_tenant, test_run):
        """Retrieve all change events for a run."""
        # Create multiple change events
        event1 = ChangeEvent(
            organization_id=test_tenant.organization_id,
            run_id=test_run.run_id,
            pipeline_id=None,
            entity_key="test:1",
            change_type="created",
            applied=True,
            summary="Created entity 1",
        )
        event2 = ChangeEvent(
            organization_id=test_tenant.organization_id,
            run_id=test_run.run_id,
            pipeline_id=None,
            entity_key="test:2",
            change_type="updated",
            applied=True,
            summary="Updated entity 2",
        )
        db_session.add_all([event1, event2])
        db_session.commit()
        
        # Get events
        events = get_change_events_for_run(
            session=db_session,
            organization_id=test_tenant.organization_id,
            run_id=test_run.run_id,
        )
        
        assert len(events) == 2
        assert events[0].entity_key == "test:1"
        assert events[1].entity_key == "test:2"

    def test_filter_by_change_type(self, db_session, test_tenant, test_run):
        """Filter change events by type."""
        event1 = ChangeEvent(
            organization_id=test_tenant.organization_id,
            run_id=test_run.run_id,
            pipeline_id=None,
            entity_key="test:1",
            change_type="created",
            applied=True,
        )
        event2 = ChangeEvent(
            organization_id=test_tenant.organization_id,
            run_id=test_run.run_id,
            pipeline_id=None,
            entity_key="test:2",
            change_type="updated",
            applied=True,
        )
        db_session.add_all([event1, event2])
        db_session.commit()
        
        # Get only created events
        events = get_change_events_for_run(
            session=db_session,
            organization_id=test_tenant.organization_id,
            run_id=test_run.run_id,
            change_types=["created"],
        )
        
        assert len(events) == 1
        assert events[0].change_type == "created"


class TestGetChangeEventsForEntity:
    """Test retrieving change history for an entity."""

    def test_get_entity_history(self, db_session, test_tenant, test_run):
        """Retrieve change history for a single entity."""
        # Create a second run for the update event
        run2 = Run(
            organization_id=test_tenant.organization_id,
            pipeline_id=None,
            status="success",
            parameters={},
        )
        db_session.add(run2)
        db_session.flush()
        
        # Create events for same entity in different runs with explicit timestamps
        event1 = ChangeEvent(
            organization_id=test_tenant.organization_id,
            run_id=test_run.run_id,
            pipeline_id=None,
            entity_key="test:123",
            change_type="created",
            applied=True,
            occurred_at=datetime(2025, 1, 1, 12, 0, 0, tzinfo=timezone.utc),
        )
        event2 = ChangeEvent(
            organization_id=test_tenant.organization_id,
            run_id=run2.run_id,  # Different run
            pipeline_id=None,
            entity_key="test:123",
            change_type="updated",
            applied=True,
            occurred_at=datetime(2025, 1, 2, 12, 0, 0, tzinfo=timezone.utc),  # One day later
        )
        event3 = ChangeEvent(
            organization_id=test_tenant.organization_id,
            run_id=test_run.run_id,
            pipeline_id=None,
            entity_key="test:456",  # Different entity
            change_type="created",
            applied=True,
            occurred_at=datetime(2025, 1, 1, 12, 0, 0, tzinfo=timezone.utc),
        )
        db_session.add_all([event1, event2, event3])
        db_session.commit()
        
        # Get history for test:123
        events = get_change_events_for_entity(
            session=db_session,
            organization_id=test_tenant.organization_id,
            entity_key="test:123",
        )
        
        assert len(events) == 2
        # Should be ordered newest first (by occurred_at)
        assert events[0].change_type == "updated"
        assert events[1].change_type == "created"

    def test_limit_entity_history(self, db_session, test_tenant, test_run):
        """Limit number of events returned."""
        # Create 5 events in different runs (one meaningful change per run)
        for i in range(5):
            run = Run(
                organization_id=test_tenant.organization_id,
                pipeline_id=None,
                status="success",
                parameters={},
            )
            db_session.add(run)
            db_session.flush()
            
            event = ChangeEvent(
                organization_id=test_tenant.organization_id,
                run_id=run.run_id,  # Different run for each event
                pipeline_id=None,
                entity_key="test:limited",
                change_type="updated",
                applied=True,
                occurred_at=datetime(2025, 1, i+1, 12, 0, 0, tzinfo=timezone.utc),  # Different timestamps
            )
            db_session.add(event)
        db_session.commit()
        
        # Get only 3
        events = get_change_events_for_entity(
            session=db_session,
            organization_id=test_tenant.organization_id,
            entity_key="test:limited",
            limit=3,
        )
        
        assert len(events) == 3


class TestGetRecentChanges:
    """Test retrieving recent changes across all entities."""

    def test_get_all_recent_changes(self, db_session, test_tenant, test_run):
        """Retrieve recent changes."""
        event1 = ChangeEvent(
            organization_id=test_tenant.organization_id,
            run_id=test_run.run_id,
            pipeline_id=None,
            entity_key="test:1",
            change_type="created",
            applied=True,
        )
        event2 = ChangeEvent(
            organization_id=test_tenant.organization_id,
            run_id=test_run.run_id,
            pipeline_id=None,
            entity_key="test:2",
            change_type="updated",
            applied=True,
        )
        db_session.add_all([event1, event2])
        db_session.commit()
        
        events = get_recent_changes(
            session=db_session,
            organization_id=test_tenant.organization_id,
        )
        
        assert len(events) == 2

    def test_filter_by_since_date(self, db_session, test_tenant, test_run):
        """Filter changes by date."""
        now = datetime.now(timezone.utc)
        yesterday = now - timedelta(days=1)
        
        # Create old event
        old_event = ChangeEvent(
            organization_id=test_tenant.organization_id,
            run_id=test_run.run_id,
            pipeline_id=None,
            entity_key="test:old",
            change_type="created",
            applied=True,
            occurred_at=yesterday,
        )
        # Create new event
        new_event = ChangeEvent(
            organization_id=test_tenant.organization_id,
            run_id=test_run.run_id,
            pipeline_id=None,
            entity_key="test:new",
            change_type="created",
            applied=True,
            occurred_at=now,
        )
        db_session.add_all([old_event, new_event])
        db_session.commit()
        
        # Get changes since 1 hour ago
        one_hour_ago = now - timedelta(hours=1)
        events = get_recent_changes(
            session=db_session,
            organization_id=test_tenant.organization_id,
            since=one_hour_ago,
        )
        
        # Should only get new event
        assert len(events) == 1
        assert events[0].entity_key == "test:new"


class TestFormatChangeEventForTarget:
    """Test formatting change events for target connectors."""

    def test_format_basic_change_event(self, db_session, test_tenant, test_run):
        """Format a basic change event."""
        event = ChangeEvent(
            organization_id=test_tenant.organization_id,
            run_id=test_run.run_id,
            pipeline_id=None,
            entity_key="test:format",
            change_type="updated",
            applied=True,
            changed_fields=["title", "year"],
            summary="Updated 2 fields",
        )
        db_session.add(event)
        db_session.commit()
        
        formatted = format_change_event_for_target(event)
        
        assert formatted["entity_key"] == "test:format"
        assert formatted["change_type"] == "updated"
        assert formatted["changed_fields"] == ["title", "year"]
        assert formatted["summary"] == "Updated 2 fields"
        assert "occurred_at" in formatted
        assert "change_id" in formatted

    def test_format_with_field_diffs(self, db_session, test_tenant, test_run):
        """Format change event with field diffs."""
        event = ChangeEvent(
            organization_id=test_tenant.organization_id,
            run_id=test_run.run_id,
            pipeline_id=None,
            entity_key="test:diffs",
            change_type="updated",
            applied=True,
            changed_fields=["title"],
        )
        db_session.add(event)
        db_session.flush()
        
        # Add field diff
        diff = FieldDiff(
            organization_id=test_tenant.organization_id,
            change_id=event.change_id,
            field_name="title",
            old_value="Old Title",
            new_value="New Title",
        )
        db_session.add(diff)
        db_session.commit()
        
        # Format without diffs
        formatted_no_diffs = format_change_event_for_target(event, include_field_diffs=False)
        assert "field_diffs" not in formatted_no_diffs
        
        # Format with diffs
        formatted_with_diffs = format_change_event_for_target(event, include_field_diffs=True)
        assert "field_diffs" in formatted_with_diffs
        assert len(formatted_with_diffs["field_diffs"]) == 1
        assert formatted_with_diffs["field_diffs"][0]["field_name"] == "title"
        assert formatted_with_diffs["field_diffs"][0]["old_value"] == "Old Title"
        assert formatted_with_diffs["field_diffs"][0]["new_value"] == "New Title"

    def test_format_multiple_events(self, db_session, test_tenant, test_run):
        """Format multiple change events."""
        event1 = ChangeEvent(
            organization_id=test_tenant.organization_id,
            run_id=test_run.run_id,
            pipeline_id=None,
            entity_key="test:1",
            change_type="created",
            applied=True,
        )
        event2 = ChangeEvent(
            organization_id=test_tenant.organization_id,
            run_id=test_run.run_id,
            pipeline_id=None,
            entity_key="test:2",
            change_type="updated",
            applied=True,
        )
        db_session.add_all([event1, event2])
        db_session.commit()
        
        formatted = format_change_events_for_target([event1, event2])
        
        assert len(formatted) == 2
        assert formatted[0]["entity_key"] == "test:1"
        assert formatted[1]["entity_key"] == "test:2"


class TestComputeRunSummary:
    """Test computing run summary statistics."""

    def test_compute_summary_with_all_types(self, db_session, test_tenant, test_run):
        """Compute summary with all change types."""
        events = [
            ChangeEvent(
                organization_id=test_tenant.organization_id,
                run_id=test_run.run_id,
                pipeline_id=None,
                entity_key=f"test:{i}",
                change_type=change_type,
                applied=True,
            )
            for i, change_type in enumerate(["created", "created", "updated", "noop", "skipped"])
        ]
        db_session.add_all(events)
        db_session.commit()
        
        summary = compute_run_summary(
            session=db_session,
            organization_id=test_tenant.organization_id,
            run_id=test_run.run_id,
        )
        
        assert summary["created"] == 2
        assert summary["updated"] == 1
        assert summary["noop"] == 1
        assert summary["skipped"] == 1
        assert summary["deleted"] == 0
        assert summary["error"] == 0
        assert summary["total"] == 5

    def test_compute_summary_empty_run(self, db_session, test_tenant, test_run):
        """Compute summary for run with no changes."""
        summary = compute_run_summary(
            session=db_session,
            organization_id=test_tenant.organization_id,
            run_id=test_run.run_id,
        )
        
        assert summary["total"] == 0
        assert summary["created"] == 0
        assert summary["updated"] == 0
