"""
Unit tests for scheduler service.

Tests:
1. Compute next run time (bucketing)
2. Schedule due detection
3. Redis cache key generation
"""

import pytest
from datetime import datetime
from unittest.mock import MagicMock

from app.models import Schedule
from app.services.scheduler import (
    compute_next_run_time,
    is_schedule_due,
    _get_last_job_cache_key,
    _get_dedup_lock_key,
)


class TestComputeNextRunTime:
    """Test bucketing of timestamps for scheduler."""

    def test_hours_bucketing_rounds_down(self):
        """14:30 with 6-hour intervals should bucket to 12:00."""
        schedule = MagicMock(spec=Schedule)
        schedule.every_n = 6
        schedule.unit = "hours"
        schedule.timezone = "UTC"

        current = datetime(2026, 1, 13, 14, 30, 0)
        next_run = compute_next_run_time(schedule, current)

        assert next_run.hour == 12
        assert next_run.minute == 0
        assert next_run.second == 0

    def test_hours_bucketing_on_boundary(self):
        """18:00 with 6-hour intervals should stay at 18:00."""
        schedule = MagicMock(spec=Schedule)
        schedule.every_n = 6
        schedule.unit = "hours"
        schedule.timezone = "UTC"

        current = datetime(2026, 1, 13, 18, 0, 0)
        next_run = compute_next_run_time(schedule, current)

        assert next_run.hour == 18
        assert next_run.minute == 0

    def test_minutes_bucketing(self):
        """14:37 with 15-minute intervals should bucket to 14:30."""
        schedule = MagicMock(spec=Schedule)
        schedule.every_n = 15
        schedule.unit = "minutes"
        schedule.timezone = "UTC"

        current = datetime(2026, 1, 13, 14, 37, 0)
        next_run = compute_next_run_time(schedule, current)

        assert next_run.hour == 14
        assert next_run.minute == 30

    def test_days_bucketing(self):
        """Daily schedule should round to midnight."""
        schedule = MagicMock(spec=Schedule)
        schedule.every_n = 1
        schedule.unit = "days"
        schedule.timezone = "UTC"

        current = datetime(2026, 1, 13, 14, 37, 0)
        next_run = compute_next_run_time(schedule, current)

        assert next_run.hour == 0
        assert next_run.minute == 0
        assert next_run.second == 0

    def test_1_hour_bucketing(self):
        """Every-1-hour schedule: 15:30 should bucket to 15:00."""
        schedule = MagicMock(spec=Schedule)
        schedule.every_n = 1
        schedule.unit = "hours"
        schedule.timezone = "UTC"

        current = datetime(2026, 1, 13, 15, 30, 0)
        next_run = compute_next_run_time(schedule, current)

        assert next_run.hour == 15
        assert next_run.minute == 0


class TestIsScheduleDue:
    """Test schedule due detection logic."""

    def test_first_run_always_due(self):
        """Schedule should be due on first run (no previous job)."""
        schedule = MagicMock(spec=Schedule)
        schedule.every_n = 1
        schedule.unit = "hours"
        schedule.timezone = "UTC"

        current = datetime(2026, 1, 13, 15, 30, 0)
        due = is_schedule_due(schedule, current, last_job_time=None)
        assert due is True

    def test_not_due_in_same_bucket(self):
        """Schedule should NOT be due if last job is in the same time bucket."""
        schedule = MagicMock(spec=Schedule)
        schedule.every_n = 1
        schedule.unit = "hours"
        schedule.timezone = "UTC"

        current = datetime(2026, 1, 13, 15, 30, 0)
        last_job_time = datetime(2026, 1, 13, 15, 0, 0)
        due = is_schedule_due(schedule, current, last_job_time)
        assert due is False

    def test_due_in_new_bucket(self):
        """Schedule should be due if last job is in a previous time bucket."""
        schedule = MagicMock(spec=Schedule)
        schedule.every_n = 1
        schedule.unit = "hours"
        schedule.timezone = "UTC"

        current = datetime(2026, 1, 13, 15, 30, 0)
        last_job_time = datetime(2026, 1, 13, 14, 0, 0)
        due = is_schedule_due(schedule, current, last_job_time)
        assert due is True


class TestCacheKeyGeneration:
    """Test Redis key generation helper functions."""

    def test_last_job_cache_key_format(self):
        """Cache key should follow the expected format."""
        import uuid

        schedule_id = uuid.uuid4()
        key = _get_last_job_cache_key(schedule_id)
        assert key == f"madrona:sched:last_job:{schedule_id}"

    def test_dedup_lock_key_format(self):
        """Dedup lock key should include schedule_id and bucket."""
        import uuid

        schedule_id = uuid.uuid4()
        bucket = "202601131500"
        key = _get_dedup_lock_key(schedule_id, bucket)
        assert key == f"madrona:sched:lock:{schedule_id}:{bucket}"
