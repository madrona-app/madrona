"""
Scheduler service for enqueuing Pipeline jobs from schedules.

Runs a background loop that:
1. Finds enabled schedules
2. Determines which schedules are due
3. Enqueues jobs with de-duplication
4. Respects pipeline-level concurrency limits

Design:
- Runs every 60 seconds
- Bucketed timestamps for de-duplication
- Pipeline-level concurrency = 1 (no overlapping jobs per pipeline)

Redis Integration:
- Last job time cache: madrona:sched:last_job:{schedule_id} - avoids N queries per tick
- Dedup lock: madrona:sched:lock:{schedule_id}:{bucket} - prevents duplicate job creation
"""

import logging
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import and_, or_
from sqlalchemy.exc import IntegrityError

from app.database import current_session
from app.models import Schedule, Job
from app.services.redis_client import get_redis_client

logger = logging.getLogger(__name__)

# Cache TTL for last job time (1 hour)
LAST_JOB_CACHE_TTL_SECONDS = 3600

# Dedup lock TTL (5 minutes)
DEDUP_LOCK_TTL_SECONDS = 300


def _get_last_job_cache_key(schedule_id: UUID) -> str:
    """Get Redis key for last job time cache."""
    return f"madrona:sched:last_job:{schedule_id}"


def _get_dedup_lock_key(schedule_id: UUID, bucket: str) -> str:
    """Get Redis key for deduplication lock."""
    return f"madrona:sched:lock:{schedule_id}:{bucket}"


def _get_cached_last_job_time(schedule_id: UUID) -> Optional[datetime]:
    """
    Get last job time from Redis cache.

    Returns:
        datetime if cached, None if not cached or Redis unavailable
    """
    redis = get_redis_client()
    if not redis.is_available():
        return None

    try:
        key = _get_last_job_cache_key(schedule_id)
        cached = redis.client.hget(key, 'scheduled_for')
        if cached:
            return datetime.fromisoformat(cached.decode())
    except Exception as e:
        logger.debug(f"Failed to get cached last job time: {e}")

    return None


def _cache_last_job_time(schedule_id: UUID, scheduled_for: datetime, job_id: UUID) -> None:
    """
    Cache last job time for a schedule.

    Args:
        schedule_id: Schedule ID
        scheduled_for: The scheduled_for time of the job
        job_id: Job ID
    """
    redis = get_redis_client()
    if not redis.is_available():
        return

    try:
        key = _get_last_job_cache_key(schedule_id)
        pipe = redis.client.pipeline()
        pipe.hset(key, mapping={
            'scheduled_for': scheduled_for.isoformat(),
            'job_id': str(job_id),
            'cached_at': datetime.now(timezone.utc).isoformat(),
        })
        pipe.expire(key, LAST_JOB_CACHE_TTL_SECONDS)
        pipe.execute()
    except Exception as e:
        logger.debug(f"Failed to cache last job time: {e}")


def _try_acquire_dedup_lock(schedule_id: UUID, scheduled_for: datetime) -> bool:
    """
    Try to acquire deduplication lock for a schedule at a specific time.

    Returns:
        True if lock acquired (we should create the job)
        False if lock not acquired (another scheduler already created it)
        None if Redis unavailable (fall back to DB dedup)
    """
    redis = get_redis_client()
    if not redis.is_available():
        return None

    try:
        bucket = scheduled_for.strftime("%Y%m%d%H%M")
        key = _get_dedup_lock_key(schedule_id, bucket)
        # SET NX (only if not exists) with TTL
        result = redis.client.set(key, "1", nx=True, ex=DEDUP_LOCK_TTL_SECONDS)
        return result is not None
    except Exception as e:
        logger.debug(f"Failed to acquire dedup lock: {e}")
        return None


def compute_next_run_time(schedule: Schedule, current_time: datetime) -> datetime:
    """
    Compute the next run time for a schedule based on its interval configuration.
    
    Returns a bucketed timestamp (rounded down to the interval boundary).
    This ensures consistent scheduled_for values for de-duplication.
    
    Args:
        schedule: Schedule configuration
        current_time: Current time in UTC (naive datetime)
        
    Returns:
        Next run time (UTC) rounded to interval boundary
        
    Example:
        schedule: every_n=6, unit='hours'
        current_time: 2026-01-13 14:30:00
        returns: 2026-01-13 12:00:00 (last 6-hour boundary)
    """
    # Make current_time timezone-aware as UTC
    utc_tz = ZoneInfo('UTC')
    if current_time.tzinfo is None:
        current_time = current_time.replace(tzinfo=utc_tz)
    
    # Convert to schedule's timezone
    tz = ZoneInfo(schedule.timezone)
    local_time = current_time.astimezone(tz)
    
    if schedule.unit == 'minutes':
        # Round down to N-minute boundary
        minutes_since_midnight = local_time.hour * 60 + local_time.minute
        bucket = (minutes_since_midnight // schedule.every_n) * schedule.every_n
        scheduled_time = local_time.replace(hour=bucket // 60, minute=bucket % 60, second=0, microsecond=0)
        
    elif schedule.unit == 'hours':
        # Round down to N-hour boundary from start of day
        hour_bucket = (local_time.hour // schedule.every_n) * schedule.every_n
        scheduled_time = local_time.replace(hour=hour_bucket, minute=0, second=0, microsecond=0)
        
    elif schedule.unit == 'days':
        # Round down to midnight in schedule timezone
        scheduled_time = local_time.replace(hour=0, minute=0, second=0, microsecond=0)
        
    else:
        logger.warning(f"Unknown schedule unit '{schedule.unit}' for schedule {schedule.schedule_id}")
        return current_time.replace(second=0, microsecond=0, tzinfo=None)
    
    # Convert back to UTC and remove tzinfo
    return scheduled_time.astimezone(utc_tz).replace(tzinfo=None)


def is_schedule_due(schedule: Schedule, current_time: datetime, last_job_time: Optional[datetime]) -> bool:
    """
    Determine if a schedule should run at the current time.
    
    A schedule is due if:
    1. The next run time has arrived
    2. No job exists for this schedule at this time bucket
    
    Args:
        schedule: Schedule configuration
        current_time: Current time in UTC
        last_job_time: Most recent scheduled_for time for this schedule (or None)
        
    Returns:
        True if schedule should run now
    """
    next_run = compute_next_run_time(schedule, current_time)
    
    # If we've never run, or the next run time is after the last job time, we're due
    if last_job_time is None:
        return True
    
    # Check if we've moved to a new time bucket
    return next_run > last_job_time


def compute_due_schedules() -> List[tuple[Schedule, datetime]]:
    """
    Find all schedules that are due to run.

    Uses Redis cache to avoid N queries for last job times when available.
    Falls back to DB queries if Redis is unavailable.

    Returns:
        List of (schedule, scheduled_for_time) tuples
    """
    current_time = datetime.now(timezone.utc)
    due_schedules = []

    # Get all enabled schedules
    schedules = (
        current_session().query(Schedule)
        .filter(Schedule.enabled == True)
        .all()
    )

    logger.debug(f"Checking {len(schedules)} enabled schedules")

    for schedule in schedules:
        # Try Redis cache first for last job time
        last_job_time = _get_cached_last_job_time(schedule.schedule_id)

        if last_job_time is None:
            # Cache miss or Redis unavailable - query DB
            last_job = (
                current_session().query(Job)
                .filter(Job.schedule_id == schedule.schedule_id)
                .order_by(Job.scheduled_for.desc())
                .first()
            )
            last_job_time = last_job.scheduled_for if last_job else None

        if is_schedule_due(schedule, current_time, last_job_time):
            scheduled_for = compute_next_run_time(schedule, current_time)
            due_schedules.append((schedule, scheduled_for))
            logger.debug(
                f"Schedule {schedule.schedule_id} is due (pipeline={schedule.pipeline_id}, "
                f"every {schedule.every_n} {schedule.unit})"
            )

    return due_schedules


def can_enqueue_job(schedule: Schedule, scheduled_for: datetime) -> tuple[bool, Optional[str]]:
    """
    Check if a job can be enqueued for the given schedule.

    Enforces:
    1. No running jobs for this pipeline (concurrency = 1)
    2. No queued jobs within the last N minutes for this pipeline

    Args:
        schedule: Schedule to check
        scheduled_for: Proposed scheduled_for time

    Returns:
        (can_enqueue, reason) - reason is None if can enqueue, error message otherwise
    """
    pipeline_id = schedule.pipeline_id

    # Check for running jobs on this pipeline
    running_job = (
        current_session().query(Job)
        .filter(
            Job.pipeline_id == pipeline_id,
            Job.status == 'running'
        )
        .first()
    )

    if running_job:
        return False, f"Pipeline {pipeline_id} already has a running job ({running_job.job_id})"

    # Check for recent queued jobs on this pipeline (within 5 minutes)
    recent_queued_cutoff = datetime.now(timezone.utc) - timedelta(minutes=5)
    recent_queued_job = (
        current_session().query(Job)
        .filter(
            Job.pipeline_id == pipeline_id,
            Job.status == 'queued',
            Job.created_at > recent_queued_cutoff
        )
        .first()
    )

    if recent_queued_job:
        return False, f"Pipeline {pipeline_id} has a recent queued job ({recent_queued_job.job_id})"

    return True, None


def enqueue_job(schedule: Schedule, scheduled_for: datetime) -> Optional[str]:
    """
    Enqueue a job for the given schedule.

    Creates a Job record with:
    - status='queued'
    - scheduled_for=<bucketed timestamp>
    - Links to schedule, route, organization

    Uses Redis dedup lock to prevent duplicate job creation across scheduler instances.
    Falls back to DB IntegrityError for dedup if Redis unavailable.

    Returns:
        job_id if created, None if skipped/failed
    """
    # Try to acquire Redis dedup lock first
    lock_acquired = _try_acquire_dedup_lock(schedule.schedule_id, scheduled_for)
    if lock_acquired is False:
        # Another scheduler already created this job
        logger.debug(
            f"Dedup lock not acquired for schedule {schedule.schedule_id} "
            f"at {scheduled_for.isoformat()} - skipping"
        )
        return None
    # If lock_acquired is None, Redis unavailable - continue with DB dedup

    # Check if we can enqueue (route concurrency check)
    can_enqueue, reason = can_enqueue_job(schedule, scheduled_for)
    if not can_enqueue:
        logger.info(f"Skipping job for schedule {schedule.schedule_id}: {reason}")
        return None

    # Create job
    job = Job(
        organization_id=schedule.organization_id,
        pipeline_id=schedule.pipeline_id,
        schedule_id=schedule.schedule_id,
        scheduled_for=scheduled_for,
        status='queued',
        job_type='scheduled',
        priority=100,
        payload={
            'schedule_id': str(schedule.schedule_id),
            'pipeline_id': str(schedule.pipeline_id),
        },
        attempt=0,
        max_attempts=3,
    )

    try:
        current_session().add(job)
        current_session().commit()

        # Cache the job time for future scheduler ticks
        _cache_last_job_time(schedule.schedule_id, scheduled_for, job.job_id)

        logger.info(
            f"✓ Enqueued job {job.job_id} for schedule {schedule.schedule_id} "
            f"pipeline {schedule.pipeline_id} (scheduled_for={scheduled_for.isoformat()})"
        )
        return str(job.job_id)

    except IntegrityError as e:
        current_session().rollback()
        # De-duplication constraint hit - this is expected and OK
        logger.debug(
            f"Job already exists for schedule {schedule.schedule_id} "
            f"at {scheduled_for.isoformat()} (de-duplication)"
        )
        return None
    except Exception as e:
        current_session().rollback()
        logger.error(
            f"Failed to enqueue job for schedule {schedule.schedule_id}: {e}",
            exc_info=True
        )
        return None


def scheduler_tick():
    """
    Single iteration of the scheduler loop.
    
    Called every 60 seconds to:
    1. Find due schedules
    2. Enqueue jobs
    3. Log results
    """
    logger.info("⏰ Scheduler tick starting...")
    
    try:
        due_schedules = compute_due_schedules()
        
        if not due_schedules:
            logger.info("No schedules due at this time")
            return
        
        logger.info(f"Found {len(due_schedules)} schedule(s) due")
        
        enqueued_count = 0
        skipped_count = 0
        
        for schedule, scheduled_for in due_schedules:
            job_id = enqueue_job(schedule, scheduled_for)
            if job_id:
                enqueued_count += 1
            else:
                skipped_count += 1
        
        logger.info(
            f"✓ Scheduler tick complete: {enqueued_count} enqueued, {skipped_count} skipped"
        )
        
    except Exception as e:
        logger.error(f"Scheduler tick failed: {e}", exc_info=True)


class SchedulerService:
    """
    Background scheduler service that runs the scheduler loop.
    
    Runs in a separate thread, ticking every 60 seconds.
    """
    
    def __init__(self, interval_seconds: int = 60):
        self.interval_seconds = interval_seconds
        self._thread = None
        self._stop_event = threading.Event()
        self._running = False
    
    def start(self):
        """Start the scheduler background thread."""
        if self._running:
            logger.warning("Scheduler already running")
            return
        
        self._running = True
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()
        logger.info(f"✓ Scheduler service started (interval={self.interval_seconds}s)")
    
    def stop(self):
        """Stop the scheduler background thread."""
        if not self._running:
            return
        
        logger.info("Stopping scheduler service...")
        self._running = False
        self._stop_event.set()
        
        if self._thread:
            self._thread.join(timeout=5)
        
        logger.info("✓ Scheduler service stopped")
    
    def _run_loop(self):
        """Main scheduler loop (runs in background thread)."""
        logger.info("Scheduler loop started")
        
        while not self._stop_event.is_set():
            try:
                scheduler_tick()
            except Exception as e:
                logger.error(f"Scheduler loop error: {e}", exc_info=True)
            
            # Wait for next interval (or stop event)
            self._stop_event.wait(self.interval_seconds)
        
        logger.info("Scheduler loop exited")


# Global scheduler instance
_scheduler_instance: Optional[SchedulerService] = None


def start_scheduler(enabled: bool = True, interval_seconds: int = 60):
    """
    Start the global scheduler service.
    
    Args:
        enabled: Whether to start the scheduler (respects SCHEDULER_ENABLED env var)
        interval_seconds: How often to run the scheduler tick
    """
    global _scheduler_instance
    
    if not enabled:
        logger.info("Scheduler disabled (SCHEDULER_ENABLED=false)")
        return
    
    if _scheduler_instance and _scheduler_instance._running:
        logger.warning("Scheduler already started")
        return
    
    _scheduler_instance = SchedulerService(interval_seconds=interval_seconds)
    _scheduler_instance.start()


def stop_scheduler():
    """Stop the global scheduler service."""
    global _scheduler_instance
    
    if _scheduler_instance:
        _scheduler_instance.stop()
        _scheduler_instance = None
