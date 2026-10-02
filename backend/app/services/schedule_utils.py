"""
Utility functions for schedule next_run_at calculation.

These functions compute when a schedule will run next, used for display
and scheduling logic.
"""

from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from app.models import Schedule, Job


def compute_next_run_at(
    schedule: Schedule,
    last_job: Optional[Job] = None,
    now: Optional[datetime] = None
) -> datetime:
    """
    Compute the next run time for a schedule.
    
    Rules (MVP):
    - For interval schedules:
      - If there is a queued or running job: next_run = last scheduled_for + interval
      - Otherwise: next_run = now rounded up to the next interval boundary
    - For time-based schedules:
      - Next occurrence of the specified hour:minute in the schedule's timezone
      - If that time has already passed today, return tomorrow's occurrence
    
    All calculations use UTC timestamps internally. Timezone is only relevant
    for time-based schedules and display purposes.
    
    Args:
        schedule: Schedule configuration with type, interval/time settings
        last_job: Most recent Job for this schedule (optional)
        now: Current time in UTC (defaults to datetime.now(timezone.utc))
        
    Returns:
        Next run time as a UTC datetime (naive)
        
    Examples:
        Interval schedule (every 6 hours):
        - With queued job at 12:00: returns 18:00
        - Without jobs at 14:30: returns 18:00 (next 6-hour boundary)
        
        Time-based schedule (daily at 09:30):
        - Current time 08:00: returns today at 09:30
        - Current time 10:00: returns tomorrow at 09:30
    """
    if now is None:
        now = datetime.now(timezone.utc)
    
    # Ensure now is timezone-aware UTC
    utc_tz = ZoneInfo('UTC')
    if now.tzinfo is None:
        now = now.replace(tzinfo=utc_tz)
    
    if schedule.type == 'interval':
        return _compute_interval_next_run(schedule, last_job, now)
    elif schedule.type == 'time':
        return _compute_time_based_next_run(schedule, now)
    else:
        raise ValueError(f"Unknown schedule type: {schedule.type}")


def _compute_interval_next_run(
    schedule: Schedule,
    last_job: Optional[Job],
    now: datetime
) -> datetime:
    """
    Compute next run for interval-based schedules.
    
    If there's a queued or running job, increment from its scheduled_for time.
    Otherwise, round up to the next interval boundary from now.
    """
    # Check if there's a pending or running job
    if last_job and last_job.status in ('queued', 'running'):
        # Next run = last scheduled_for + interval
        base_time = last_job.scheduled_for
        if base_time.tzinfo is None:
            base_time = base_time.replace(tzinfo=ZoneInfo('UTC'))
        
        interval_delta = _get_interval_delta(schedule.every_n, schedule.unit)
        next_run = base_time + interval_delta
        return next_run.replace(tzinfo=None)
    
    # No pending job: round up to next interval boundary
    return _round_up_to_interval_boundary(schedule, now)


def _compute_time_based_next_run(schedule: Schedule, now: datetime) -> datetime:
    """
    Compute next run for time-based schedules (daily at specific hour:minute).
    
    Returns the next occurrence of the specified time in the schedule's timezone.
    """
    tz = ZoneInfo(schedule.timezone)
    local_now = now.astimezone(tz)
    
    # Create target time for today
    target_time = local_now.replace(
        hour=schedule.time_hour,
        minute=schedule.time_minute,
        second=0,
        microsecond=0
    )
    
    # If target time has passed today, move to tomorrow
    if target_time <= local_now:
        target_time = target_time + timedelta(days=1)
    
    # Convert back to UTC and remove tzinfo
    utc_tz = ZoneInfo('UTC')
    return target_time.astimezone(utc_tz).replace(tzinfo=None)


def _get_interval_delta(every_n: int, unit: str) -> timedelta:
    """Convert schedule interval to timedelta."""
    if unit == 'minutes':
        return timedelta(minutes=every_n)
    elif unit == 'hours':
        return timedelta(hours=every_n)
    elif unit == 'days':
        return timedelta(days=every_n)
    else:
        raise ValueError(f"Unknown interval unit: {unit}")


def _round_up_to_interval_boundary(schedule: Schedule, now: datetime) -> datetime:
    """
    Round current time up to the next interval boundary.
    
    Strategy: Find the last boundary, then add one interval.
    Boundaries align to start of day in the schedule's timezone.
    
    Example:
        - every 6 hours, now = 14:30
        - Boundaries: 00:00, 06:00, 12:00, 18:00, ...
        - Last boundary = 12:00
        - Next boundary = 18:00
    """
    tz = ZoneInfo(schedule.timezone)
    local_now = now.astimezone(tz)
    
    if schedule.unit == 'minutes':
        # Calculate total minutes since start of day
        minutes_since_midnight = local_now.hour * 60 + local_now.minute
        
        # Find how many complete intervals have passed
        intervals_passed = minutes_since_midnight // schedule.every_n
        
        # If we have any seconds/microseconds, we need the next interval
        if local_now.second > 0 or local_now.microsecond > 0:
            intervals_passed += 1
        # If we're exactly on a boundary, move to the next one
        elif minutes_since_midnight % schedule.every_n == 0:
            intervals_passed += 1
        # Otherwise we're between boundaries, round up
        else:
            intervals_passed += 1
        
        # Calculate next boundary in minutes
        next_boundary_minutes = intervals_passed * schedule.every_n
        
        # Handle day overflow
        if next_boundary_minutes >= 24 * 60:
            days_ahead = next_boundary_minutes // (24 * 60)
            next_boundary_minutes = next_boundary_minutes % (24 * 60)
            next_boundary = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
            next_boundary = next_boundary + timedelta(days=days_ahead)
            next_boundary = next_boundary.replace(
                hour=next_boundary_minutes // 60,
                minute=next_boundary_minutes % 60
            )
        else:
            next_boundary = local_now.replace(
                hour=next_boundary_minutes // 60,
                minute=next_boundary_minutes % 60,
                second=0,
                microsecond=0
            )
        
    elif schedule.unit == 'hours':
        # Calculate which interval we're in
        hour_of_day = local_now.hour
        intervals_passed = hour_of_day // schedule.every_n
        
        # If we have minutes/seconds/microseconds, we need the next interval
        if local_now.minute > 0 or local_now.second > 0 or local_now.microsecond > 0:
            intervals_passed += 1
        # If we're exactly on a boundary, move to the next one
        elif hour_of_day % schedule.every_n == 0:
            intervals_passed += 1
        # Otherwise round up
        else:
            intervals_passed += 1
        
        next_boundary_hour = intervals_passed * schedule.every_n
        
        if next_boundary_hour >= 24:
            days_ahead = next_boundary_hour // 24
            next_boundary_hour = next_boundary_hour % 24
            next_boundary = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
            next_boundary = next_boundary + timedelta(days=days_ahead)
            next_boundary = next_boundary.replace(hour=next_boundary_hour)
        else:
            next_boundary = local_now.replace(hour=next_boundary_hour, minute=0, second=0, microsecond=0)
        
    elif schedule.unit == 'days':
        # Round up to next midnight in schedule timezone
        next_boundary = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
        
        # If we're past midnight (any time has elapsed), move to tomorrow
        if local_now.hour > 0 or local_now.minute > 0 or local_now.second > 0 or local_now.microsecond > 0:
            next_boundary = next_boundary + timedelta(days=schedule.every_n)
        else:
            # We're exactly at midnight, so next run is N days from now
            next_boundary = next_boundary + timedelta(days=schedule.every_n)
    
    else:
        raise ValueError(f"Unknown interval unit: {schedule.unit}")
    
    # Convert back to UTC and remove tzinfo
    utc_tz = ZoneInfo('UTC')
    return next_boundary.astimezone(utc_tz).replace(tzinfo=None)
