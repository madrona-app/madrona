"""
Unit tests for schedule next_run_at calculation.

Tests cover:
- Interval schedules with/without pending jobs
- Time-based schedules
- Timezone handling
- Edge cases (boundary conditions, day rollovers)
"""

import pytest
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.models import Schedule, Job
from app.services.schedule_utils import compute_next_run_at


class MockSchedule:
    """Mock Schedule object for testing."""
    def __init__(self, schedule_type='interval', every_n=None, unit=None, 
                 time_hour=None, time_minute=None, timezone='UTC'):
        self.type = schedule_type
        self.every_n = every_n
        self.unit = unit
        self.time_hour = time_hour
        self.time_minute = time_minute
        self.timezone = timezone


class MockJob:
    """Mock Job object for testing."""
    def __init__(self, scheduled_for, status='completed'):
        self.scheduled_for = scheduled_for
        self.status = status


class TestIntervalSchedulesNoPendingJob:
    """Test interval schedules when no job is queued or running."""
    
    def test_every_15_minutes_rounds_up(self):
        """Every 15 minutes: current 14:07 -> next 14:15"""
        schedule = MockSchedule(every_n=15, unit='minutes')
        now = datetime(2026, 1, 13, 14, 7, 0)
        
        next_run = compute_next_run_at(schedule, last_job=None, now=now)
        
        assert next_run == datetime(2026, 1, 13, 14, 15, 0)
    
    def test_every_15_minutes_exactly_on_boundary(self):
        """Exactly on boundary (14:15:00) -> next boundary (14:30)"""
        schedule = MockSchedule(every_n=15, unit='minutes')
        now = datetime(2026, 1, 13, 14, 15, 0)
        
        next_run = compute_next_run_at(schedule, last_job=None, now=now)
        
        assert next_run == datetime(2026, 1, 13, 14, 30, 0)
    
    def test_every_15_minutes_with_seconds(self):
        """On boundary with seconds (14:15:01) -> next boundary (14:30)"""
        schedule = MockSchedule(every_n=15, unit='minutes')
        now = datetime(2026, 1, 13, 14, 15, 1)
        
        next_run = compute_next_run_at(schedule, last_job=None, now=now)
        
        assert next_run == datetime(2026, 1, 13, 14, 30, 0)
    
    def test_every_6_hours_rounds_up(self):
        """Every 6 hours: current 14:30 -> next 18:00"""
        schedule = MockSchedule(every_n=6, unit='hours')
        now = datetime(2026, 1, 13, 14, 30, 0)
        
        next_run = compute_next_run_at(schedule, last_job=None, now=now)
        
        assert next_run == datetime(2026, 1, 13, 18, 0, 0)
    
    def test_every_6_hours_at_boundary(self):
        """Exactly on 6-hour boundary (12:00:00) -> next (18:00)"""
        schedule = MockSchedule(every_n=6, unit='hours')
        now = datetime(2026, 1, 13, 12, 0, 0)
        
        next_run = compute_next_run_at(schedule, last_job=None, now=now)
        
        assert next_run == datetime(2026, 1, 13, 18, 0, 0)
    
    def test_every_6_hours_near_midnight(self):
        """Every 6 hours: 22:00 -> next day 00:00"""
        schedule = MockSchedule(every_n=6, unit='hours')
        now = datetime(2026, 1, 13, 22, 0, 0)
        
        next_run = compute_next_run_at(schedule, last_job=None, now=now)
        
        assert next_run == datetime(2026, 1, 14, 0, 0, 0)
    
    def test_every_1_day_rounds_up(self):
        """Every 1 day: current 14:30 -> tomorrow midnight"""
        schedule = MockSchedule(every_n=1, unit='days')
        now = datetime(2026, 1, 13, 14, 30, 0)
        
        next_run = compute_next_run_at(schedule, last_job=None, now=now)
        
        assert next_run == datetime(2026, 1, 14, 0, 0, 0)
    
    def test_every_1_day_at_midnight(self):
        """Exactly at midnight (00:00:00) -> next midnight"""
        schedule = MockSchedule(every_n=1, unit='days')
        now = datetime(2026, 1, 13, 0, 0, 0)
        
        next_run = compute_next_run_at(schedule, last_job=None, now=now)
        
        assert next_run == datetime(2026, 1, 14, 0, 0, 0)


class TestIntervalSchedulesWithPendingJob:
    """Test interval schedules when a job is queued or running."""
    
    def test_queued_job_adds_interval(self):
        """Queued job at 12:00, every 6 hours -> next 18:00"""
        schedule = MockSchedule(every_n=6, unit='hours')
        last_job = MockJob(
            scheduled_for=datetime(2026, 1, 13, 12, 0, 0),
            status='queued'
        )
        now = datetime(2026, 1, 13, 14, 30, 0)
        
        next_run = compute_next_run_at(schedule, last_job=last_job, now=now)
        
        assert next_run == datetime(2026, 1, 13, 18, 0, 0)
    
    def test_running_job_adds_interval(self):
        """Running job at 12:00, every 6 hours -> next 18:00"""
        schedule = MockSchedule(every_n=6, unit='hours')
        last_job = MockJob(
            scheduled_for=datetime(2026, 1, 13, 12, 0, 0),
            status='running'
        )
        now = datetime(2026, 1, 13, 14, 30, 0)
        
        next_run = compute_next_run_at(schedule, last_job=last_job, now=now)
        
        assert next_run == datetime(2026, 1, 13, 18, 0, 0)
    
    def test_completed_job_ignores_last_job(self):
        """Completed job should not affect calculation - use boundary logic"""
        schedule = MockSchedule(every_n=6, unit='hours')
        last_job = MockJob(
            scheduled_for=datetime(2026, 1, 13, 6, 0, 0),
            status='completed'
        )
        now = datetime(2026, 1, 13, 14, 30, 0)
        
        next_run = compute_next_run_at(schedule, last_job=last_job, now=now)
        
        # Should round up from now, not from last job
        assert next_run == datetime(2026, 1, 13, 18, 0, 0)
    
    def test_failed_job_ignores_last_job(self):
        """Failed job should not affect calculation"""
        schedule = MockSchedule(every_n=15, unit='minutes')
        last_job = MockJob(
            scheduled_for=datetime(2026, 1, 13, 14, 0, 0),
            status='failed'
        )
        now = datetime(2026, 1, 13, 14, 7, 0)
        
        next_run = compute_next_run_at(schedule, last_job=last_job, now=now)
        
        assert next_run == datetime(2026, 1, 13, 14, 15, 0)
    
    def test_queued_job_near_day_boundary(self):
        """Queued job at 23:00, every 2 hours -> next day 01:00"""
        schedule = MockSchedule(every_n=2, unit='hours')
        last_job = MockJob(
            scheduled_for=datetime(2026, 1, 13, 23, 0, 0),
            status='queued'
        )
        now = datetime(2026, 1, 13, 23, 30, 0)
        
        next_run = compute_next_run_at(schedule, last_job=last_job, now=now)
        
        assert next_run == datetime(2026, 1, 14, 1, 0, 0)


class TestTimeBasedSchedules:
    """Test daily time-based schedules."""
    
    def test_future_time_today(self):
        """Current 08:00, scheduled 09:30 -> today 09:30"""
        schedule = MockSchedule(
            schedule_type='time',
            time_hour=9,
            time_minute=30,
            timezone='UTC'
        )
        now = datetime(2026, 1, 13, 8, 0, 0)
        
        next_run = compute_next_run_at(schedule, last_job=None, now=now)
        
        assert next_run == datetime(2026, 1, 13, 9, 30, 0)
    
    def test_past_time_tomorrow(self):
        """Current 10:00, scheduled 09:30 -> tomorrow 09:30"""
        schedule = MockSchedule(
            schedule_type='time',
            time_hour=9,
            time_minute=30,
            timezone='UTC'
        )
        now = datetime(2026, 1, 13, 10, 0, 0)
        
        next_run = compute_next_run_at(schedule, last_job=None, now=now)
        
        assert next_run == datetime(2026, 1, 14, 9, 30, 0)
    
    def test_exactly_at_scheduled_time(self):
        """Current 09:30:00, scheduled 09:30 -> tomorrow 09:30"""
        schedule = MockSchedule(
            schedule_type='time',
            time_hour=9,
            time_minute=30,
            timezone='UTC'
        )
        now = datetime(2026, 1, 13, 9, 30, 0)
        
        next_run = compute_next_run_at(schedule, last_job=None, now=now)
        
        assert next_run == datetime(2026, 1, 14, 9, 30, 0)
    
    def test_midnight_schedule(self):
        """Scheduled for midnight (00:00)"""
        schedule = MockSchedule(
            schedule_type='time',
            time_hour=0,
            time_minute=0,
            timezone='UTC'
        )
        now = datetime(2026, 1, 13, 14, 0, 0)
        
        next_run = compute_next_run_at(schedule, last_job=None, now=now)
        
        assert next_run == datetime(2026, 1, 14, 0, 0, 0)
    
    def test_timezone_conversion_est(self):
        """Schedule in EST timezone (09:00 EST = 14:00 UTC)"""
        schedule = MockSchedule(
            schedule_type='time',
            time_hour=9,  # 9am EST
            time_minute=0,
            timezone='America/New_York'
        )
        # Current time: 13:00 UTC (8am EST)
        now = datetime(2026, 1, 13, 13, 0, 0, tzinfo=ZoneInfo('UTC'))
        
        next_run = compute_next_run_at(schedule, last_job=None, now=now)
        
        # Next 9am EST = 14:00 UTC today
        expected = datetime(2026, 1, 13, 14, 0, 0)
        assert next_run == expected
    
    def test_timezone_conversion_pst(self):
        """Schedule in PST timezone (17:00 PST = 01:00 UTC next day)"""
        schedule = MockSchedule(
            schedule_type='time',
            time_hour=17,  # 5pm PST
            time_minute=0,
            timezone='America/Los_Angeles'
        )
        # Current time: 23:00 UTC (3pm PST)
        now = datetime(2026, 1, 13, 23, 0, 0, tzinfo=ZoneInfo('UTC'))
        
        next_run = compute_next_run_at(schedule, last_job=None, now=now)
        
        # Next 5pm PST = 01:00 UTC next day
        expected = datetime(2026, 1, 14, 1, 0, 0)
        assert next_run == expected


class TestEdgeCases:
    """Test edge cases and error conditions."""
    
    def test_minutes_interval_crosses_hour_boundary(self):
        """Every 45 minutes: 14:50 -> 15:00 (boundaries: 00:00, 00:45, 01:30, ..., 14:15, 15:00)"""
        schedule = MockSchedule(every_n=45, unit='minutes')
        now = datetime(2026, 1, 13, 14, 50, 0)
        
        next_run = compute_next_run_at(schedule, last_job=None, now=now)
        
        assert next_run == datetime(2026, 1, 13, 15, 0, 0)
    
    def test_minutes_interval_crosses_day_boundary(self):
        """Every 30 minutes: 23:50 -> next day 00:00"""
        schedule = MockSchedule(every_n=30, unit='minutes')
        now = datetime(2026, 1, 13, 23, 50, 0)
        
        next_run = compute_next_run_at(schedule, last_job=None, now=now)
        
        assert next_run == datetime(2026, 1, 14, 0, 0, 0)
    
    def test_large_interval_multiple_days(self):
        """Every 3 days from middle of day"""
        schedule = MockSchedule(every_n=3, unit='days')
        now = datetime(2026, 1, 13, 14, 30, 0)
        
        next_run = compute_next_run_at(schedule, last_job=None, now=now)
        
        # Should be 3 days from today's midnight
        assert next_run == datetime(2026, 1, 16, 0, 0, 0)
    
    def test_naive_datetime_handled(self):
        """Function should handle naive datetimes by treating as UTC"""
        schedule = MockSchedule(every_n=1, unit='hours')
        now = datetime(2026, 1, 13, 14, 30, 0)  # Naive
        
        next_run = compute_next_run_at(schedule, last_job=None, now=now)
        
        # Should still work
        assert next_run == datetime(2026, 1, 13, 15, 0, 0)
    
    def test_microseconds_handled(self):
        """Microseconds should be stripped from result"""
        schedule = MockSchedule(every_n=15, unit='minutes')
        now = datetime(2026, 1, 13, 14, 7, 30, 123456)
        
        next_run = compute_next_run_at(schedule, last_job=None, now=now)
        
        assert next_run.microsecond == 0
        assert next_run == datetime(2026, 1, 13, 14, 15, 0)
    
    def test_invalid_schedule_type_raises_error(self):
        """Invalid schedule type should raise ValueError"""
        schedule = MockSchedule(schedule_type='invalid')
        now = datetime(2026, 1, 13, 14, 0, 0)
        
        with pytest.raises(ValueError, match="Unknown schedule type"):
            compute_next_run_at(schedule, last_job=None, now=now)
    
    def test_invalid_unit_raises_error(self):
        """Invalid unit should raise ValueError"""
        schedule = MockSchedule(every_n=5, unit='weeks')
        now = datetime(2026, 1, 13, 14, 0, 0)
        
        with pytest.raises(ValueError, match="Unknown interval unit"):
            compute_next_run_at(schedule, last_job=None, now=now)
