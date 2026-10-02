"""
Job worker service for executing queued Pipeline jobs.

Polls for queued jobs, claims them atomically, creates runs, and executes them.
Reuses existing run execution logic from pipeline service.

Worker flow:
1. Poll for jobs with status='queued' ordered by scheduled_for
2. Atomically claim one job (set to running, set started_at)
3. Create a run for the job's pipeline
4. Execute the run using Pipeline orchestration
5. Update job on success/failure (status, finished_at, run_id, error)

Concurrency:
- Pipeline-level locking ensures no two jobs run for the same pipeline
- Atomic job claiming prevents race conditions
- Redis-based pipeline locks for fast conflict detection across workers

Redis Integration:
- Pipeline locks: madrona:worker:pipeline:{pipeline_id} - prevents concurrent jobs on same pipeline
- Falls back to DB-based locking when Redis is unavailable
"""

import logging
import os
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional
from uuid import UUID

from sqlalchemy import and_
from sqlalchemy.exc import SQLAlchemyError

from app.database import current_session, get_session
from app.models import (
    Job,
    Run,
    Pipeline,
    Dataset,
    ConnectorInstance,
    ConnectorDefinition,
)
from app.services.pipeline import execute_run, PipelineError, RunConflictError
from app.services.redis_client import get_redis_client
from app.services.event_emitter import emit_job_status
from app.utils.version import get_version_info

logger = logging.getLogger(__name__)

# Pipeline lock TTL (1 hour with 10 minute buffer for long jobs)
PIPELINE_LOCK_TTL_SECONDS = 3600

# Where the polling loop records that it is still running. Read by the
# pipeline-worker healthcheck in docker-compose.yml; keep the two in step.
HEARTBEAT_PATH = Path("/tmp/madrona-worker-heartbeat")  # noqa: S108


def _get_pipeline_lock_key(pipeline_id: UUID) -> str:
    """Get Redis key for pipeline lock."""
    return f"madrona:worker:pipeline:{pipeline_id}"


def _acquire_pipeline_lock(pipeline_id: UUID, job_id: UUID) -> bool:
    """
    Try to acquire pipeline lock via Redis.

    Returns:
        True if lock acquired, False if pipeline already locked or Redis unavailable
    """
    redis = get_redis_client()
    if not redis.is_available():
        return None  # Signal to use DB-based check

    try:
        key = _get_pipeline_lock_key(pipeline_id)
        # SET NX (only if not exists) with TTL
        result = redis.client.set(key, str(job_id), nx=True, ex=PIPELINE_LOCK_TTL_SECONDS)
        return result is not None
    except Exception as e:
        logger.debug(f"Failed to acquire pipeline lock via Redis: {e}")
        return None  # Fall back to DB


def _release_pipeline_lock(pipeline_id: UUID) -> None:
    """Release pipeline lock via Redis."""
    redis = get_redis_client()
    if not redis.is_available():
        return

    try:
        key = _get_pipeline_lock_key(pipeline_id)
        redis.client.delete(key)
    except Exception as e:
        logger.debug(f"Failed to release pipeline lock: {e}")


def claim_job() -> Optional[Job]:
    """
    Atomically claim a queued job for execution.

    Finds the oldest queued job (by scheduled_for) and attempts to claim it
    by setting status='running' and started_at=now.

    Uses Redis for fast pipeline lock checking, falls back to DB if unavailable.
    Only claims jobs where scheduled_for has passed (for retry delays).

    Returns:
        Job if claimed successfully, None if no jobs available or claim failed
    """
    # Bound before the try because the except clause reads it. The query below
    # is the most likely thing to raise, and when it did — `relation
    # "flow.jobs" does not exist`, from a worker that started before
    # migrations had run — the handler's `if job and job.pipeline_id` raised
    # UnboundLocalError on top of it. The loop logged "cannot access local
    # variable 'job'" and the real cause never appeared anywhere.
    job = None
    try:
        now = datetime.now(timezone.utc)

        # Find oldest queued job where scheduled_for has passed
        job = (
            current_session().query(Job)
            .filter(
                Job.status == 'queued',
                Job.scheduled_for <= now
            )
            .order_by(Job.scheduled_for.asc(), Job.created_at.asc())
            .with_for_update(skip_locked=True)  # Skip jobs locked by other workers
            .first()
        )

        if not job:
            return None

        # Check pipeline lock - try Redis first for fast distributed check
        if job.pipeline_id:
            redis_lock_result = _acquire_pipeline_lock(job.pipeline_id, job.job_id)

            if redis_lock_result is False:
                # Redis says pipeline is locked - skip this job
                logger.warning(
                    f"Skipping job {job.job_id}: Pipeline {job.pipeline_id} locked by another worker (Redis)"
                )
                return None
            elif redis_lock_result is None:
                # Redis unavailable — fail closed to prevent duplicate pipeline execution.
                # A DB-based fallback has a TOCTOU race: two workers can both pass the
                # "no running job" check before either commits to 'running'.
                logger.warning(
                    f"Skipping job {job.job_id}: Redis unavailable, cannot guarantee pipeline lock for {job.pipeline_id}"
                )
                return None
            # else: redis_lock_result is True, we got the lock

        # Claim the job
        job.status = 'running'
        job.started_at = now
        job.attempt += 1
        current_session().commit()

        # Emit WebSocket event for job status change
        emit_job_status(
            org_id=job.organization_id,
            job_id=job.job_id,
            pipeline_id=job.pipeline_id,
            status='running',
        )

        logger.info(f"✓ Claimed job {job.job_id} for pipeline {job.pipeline_id} (attempt {job.attempt})")
        return job

    except SQLAlchemyError as e:
        current_session().rollback()
        # Release Redis lock if we acquired it but DB commit failed
        if job and job.pipeline_id:
            _release_pipeline_lock(job.pipeline_id)
        logger.error(f"Failed to claim job: {e}")
        return None


def create_run_for_job(job: Job) -> Optional[Run]:
    """
    Create a run for the job's pipeline.

    Reuses the same logic as manual run creation but marks it as scheduled.

    Args:
        job: Job to create run for

    Returns:
        Run if created successfully, None on failure
    """
    try:
        # Load pipeline
        pipeline = current_session().query(Pipeline).filter_by(
            pipeline_id=job.pipeline_id,
            organization_id=job.organization_id
        ).first()

        if not pipeline:
            logger.error(f"Pipeline {job.pipeline_id} not found for job {job.job_id}")
            return None

        # Check if pipeline is enabled
        if pipeline.status != 'active':
            logger.warning(
                f"Skipping job {job.job_id}: Pipeline {job.pipeline_id} is disabled (status={pipeline.status})"
            )
            return None

        # Determine dataset_id (same logic as manual run creation)
        dataset_id = None
        source_connector = None
        connector_def = None

        if pipeline.dataset_id:
            dataset_id = pipeline.dataset_id
        elif pipeline.sources:
            # Fallback: Look up dataset by matching first source connector type
            first_source = pipeline.sources[0]
            source_connector = current_session().query(ConnectorInstance).filter_by(
                connector_instance_id=first_source.connector_instance_id
            ).first()

            if source_connector:
                connector_def = current_session().query(ConnectorDefinition).filter_by(
                    connector_definition_id=source_connector.connector_definition_id
                ).first()

                if connector_def:
                    impl_key = connector_def.implementation_key
                    source_type = impl_key.split('.')[-1].split(':')[0] if impl_key else None

                    if source_type:
                        dataset = current_session().query(Dataset).filter_by(
                            organization_id=job.organization_id,
                            source_type=source_type
                        ).first()
                        if dataset:
                            dataset_id = dataset.dataset_id

        # Get source connector implementation key for reproducibility
        if not source_connector and pipeline.sources:
            first_source = pipeline.sources[0]
            source_connector = current_session().query(ConnectorInstance).filter_by(
                connector_instance_id=first_source.connector_instance_id
            ).first()
            if source_connector:
                connector_def = current_session().query(ConnectorDefinition).filter_by(
                    connector_definition_id=source_connector.connector_definition_id
                ).first()

        source_implementation_key = None
        if source_connector and connector_def:
            source_implementation_key = connector_def.implementation_key

        # Add incremental sync parameters from last successful run
        incremental_params = {}
        if pipeline.sources:
            for source in pipeline.sources:
                if not source.enabled:
                    continue

                # Find last successful source step for this source
                from app.models import RunSourceStep
                last_successful_step = (
                    current_session().query(RunSourceStep)
                    .join(Run, Run.run_id == RunSourceStep.run_id)
                    .filter(
                        Run.pipeline_id == pipeline.pipeline_id,
                        RunSourceStep.pipeline_source_id == source.source_id,
                        RunSourceStep.status == 'success',
                        RunSourceStep.finished_at.isnot(None)
                    )
                    .order_by(RunSourceStep.finished_at.desc())
                    .first()
                )

                if last_successful_step and last_successful_step.finished_at:
                    # Store last sync time for incremental sync connectors
                    source_key = f"source_{source.source_id}_last_sync"
                    incremental_params[source_key] = last_successful_step.finished_at.isoformat()
                    logger.info(
                        f"Job {job.job_id}: Incremental sync for source {source.source_id} "
                        f"from {last_successful_step.finished_at.isoformat()}"
                    )

        # Build parameters with metadata
        parameters = {
            **(job.payload if isinstance(job.payload, dict) else {}),
            **incremental_params,
            "_metadata": {
                **get_version_info(),
                "job_id": str(job.job_id),
                "schedule_id": str(job.schedule_id) if job.schedule_id else None,
                **({"source_implementation_key": source_implementation_key} if source_implementation_key else {}),
            }
        }

        # Create run
        run = Run(
            organization_id=job.organization_id,
            pipeline_id=job.pipeline_id,
            dataset_id=dataset_id,
            source_connector_instance_id=pipeline.sources[0].connector_instance_id if pipeline.sources else None,
            target_connector_instance_id=pipeline.destinations[0].connector_instance_id if pipeline.destinations else None,
            job_id=job.job_id,
            status="pending",
            triggered_by="scheduled",
            parameters=parameters,
        )
        
        current_session().add(run)
        current_session().flush()  # Flush to get run_id for steps
        
        # Create step tracking rows for sources and destinations
        from app.services.run_steps import create_run_steps
        create_run_steps(run)
        
        current_session().commit()
        
        logger.info(f"✓ Created run {run.run_id} for job {job.job_id}")
        return run
        
    except SQLAlchemyError as e:
        current_session().rollback()
        logger.error(f"Failed to create run for job {job.job_id}: {e}", exc_info=True)
        return None


def execute_job(job: Job) -> bool:
    """
    Execute a job by creating and running its associated run.
    
    Args:
        job: Job to execute
        
    Returns:
        True if execution succeeded, False otherwise
    """
    run = None
    error_message = None
    
    try:
        # Create run for this job
        run = create_run_for_job(job)
        if not run:
            error_message = "Failed to create run for job"
            logger.error(f"Job {job.job_id}: {error_message}")
            return False
        
        # Execute the run using existing pipeline logic
        # Note: execute_run manages its own transactions internally
        logger.info(f"Executing run {run.run_id} for job {job.job_id}...")
        result = execute_run(current_session(), run.run_id)
        
        # Check if run succeeded
        # Refresh run to get updated status
        current_session().refresh(run)
        
        if run.status in ('success', 'warning'):
            # Success
            job.status = 'succeeded'
            job.run_id = run.run_id
            job.finished_at = datetime.now(timezone.utc)
            job.error = None
            current_session().commit()

            # Emit WebSocket event for job success
            emit_job_status(
                org_id=job.organization_id,
                job_id=job.job_id,
                pipeline_id=job.pipeline_id,
                status='succeeded',
            )

            logger.info(
                f"✓ Job {job.job_id} succeeded: Run {run.run_id} completed with status={run.status} "
                f"(created={result.counts.get('created', 0)}, updated={result.counts.get('updated', 0)})"
            )
            return True
        else:
            # Run failed or has unexpected status
            error_message = f"Run completed with status={run.status}"
            if run.error:
                error_message += f": {run.error}"
            
            # Check if we should retry
            if job.attempt < job.max_attempts:
                # Retry: requeue the job with exponential backoff
                retry_delay_minutes = 2 ** (job.attempt - 1)  # 1, 2, 4, 8... minutes
                retry_at = datetime.now(timezone.utc) + timedelta(minutes=retry_delay_minutes)
                
                job.status = 'queued'
                job.scheduled_for = retry_at
                job.error = f"Attempt {job.attempt} failed: {error_message}. Retrying at {retry_at.isoformat()}"
                job.run_id = run.run_id
                current_session().commit()
                
                logger.warning(
                    f"Job {job.job_id} failed (attempt {job.attempt}/{job.max_attempts}). "
                    f"Retrying in {retry_delay_minutes} minutes at {retry_at.isoformat()}"
                )
                return False
            else:
                # Max attempts reached - mark as permanently failed
                job.status = 'failed'
                job.run_id = run.run_id
                job.finished_at = datetime.now(timezone.utc)
                job.error = f"Failed after {job.attempt} attempts: {error_message}"
                current_session().commit()

                # Emit WebSocket event for job failure
                emit_job_status(
                    org_id=job.organization_id,
                    job_id=job.job_id,
                    pipeline_id=job.pipeline_id,
                    status='failed',
                )

                logger.error(
                    f"Job {job.job_id} permanently failed after {job.attempt} attempts: {error_message}"
                )
                return False
            
    except PipelineError as e:
        # Pipeline-specific error
        error_message = f"Pipeline error: {str(e)}"
        logger.error(f"Job {job.job_id} failed: {error_message}", exc_info=True)
        
        # Check if we should retry
        if job.attempt < job.max_attempts:
            # Retry: requeue the job with exponential backoff
            retry_delay_minutes = 2 ** (job.attempt - 1)  # 1, 2, 4, 8... minutes
            retry_at = datetime.now(timezone.utc) + timedelta(minutes=retry_delay_minutes)
            
            job.status = 'queued'
            job.scheduled_for = retry_at
            job.error = f"Attempt {job.attempt} failed: {error_message}. Retrying at {retry_at.isoformat()}"
            if run:
                job.run_id = run.run_id
            current_session().commit()
            
            logger.warning(
                f"Job {job.job_id} failed (attempt {job.attempt}/{job.max_attempts}). "
                f"Retrying in {retry_delay_minutes} minutes at {retry_at.isoformat()}"
            )
        else:
            # Max attempts reached
            job.status = 'failed'
            if run:
                job.run_id = run.run_id
            job.finished_at = datetime.now(timezone.utc)
            job.error = f"Failed after {job.attempt} attempts: {error_message}"
            current_session().commit()

            # Emit WebSocket event for job failure
            emit_job_status(
                org_id=job.organization_id,
                job_id=job.job_id,
                pipeline_id=job.pipeline_id,
                status='failed',
            )

            logger.error(
                f"Job {job.job_id} permanently failed after {job.attempt} attempts: {error_message}"
            )
        return False
        
    except Exception as e:
        # Unexpected error
        error_message = f"Unexpected error: {str(e)}"
        logger.error(f"Job {job.job_id} failed: {error_message}", exc_info=True)
        
        try:
            # Check if we should retry
            if job.attempt < job.max_attempts:
                # Retry: requeue the job with exponential backoff
                retry_delay_minutes = 2 ** (job.attempt - 1)  # 1, 2, 4, 8... minutes
                retry_at = datetime.now(timezone.utc) + timedelta(minutes=retry_delay_minutes)
                
                job.status = 'queued'
                job.scheduled_for = retry_at
                job.error = f"Attempt {job.attempt} failed: {error_message[:500]}. Retrying at {retry_at.isoformat()}"
                if run:
                    job.run_id = run.run_id
                current_session().commit()
                
                logger.warning(
                    f"Job {job.job_id} failed (attempt {job.attempt}/{job.max_attempts}). "
                    f"Retrying in {retry_delay_minutes} minutes at {retry_at.isoformat()}"
                )
            else:
                # Max attempts reached
                job.status = 'failed'
                if run:
                    job.run_id = run.run_id
                job.finished_at = datetime.now(timezone.utc)
                job.error = f"Failed after {job.attempt} attempts: {error_message[:800]}"  # Truncate long errors
                current_session().commit()

                # Emit WebSocket event for job failure
                emit_job_status(
                    org_id=job.organization_id,
                    job_id=job.job_id,
                    pipeline_id=job.pipeline_id,
                    status='failed',
                )

                logger.error(
                    f"Job {job.job_id} permanently failed after {job.attempt} attempts: {error_message}"
                )
        except Exception as commit_error:
            logger.error(f"Failed to update job {job.job_id} after error: {commit_error}")
            current_session().rollback()

        return False


def worker_tick():
    """
    Single iteration of the worker loop.

    Polls for a queued job, claims it, and executes it.
    Releases pipeline lock when job completes (success or failure).
    """
    job = None
    try:
        # Claim a job
        job = claim_job()
        if not job:
            # No jobs available
            return

        # Execute the job
        success = execute_job(job)

        if success:
            logger.info(f"✓ Worker tick complete: Job {job.job_id} executed successfully")
        else:
            logger.warning(f"Worker tick complete: Job {job.job_id} failed")

    except Exception as e:
        logger.error(f"Worker tick failed: {e}", exc_info=True)
    finally:
        # Always release pipeline lock when job execution completes
        if job and job.pipeline_id:
            _release_pipeline_lock(job.pipeline_id)


class WorkerService:
    """
    Background worker service that executes queued jobs.

    Runs in a separate thread, polling for jobs at a configurable interval.
    """

    def __init__(self, poll_interval_seconds: int = 10):
        self.poll_interval_seconds = poll_interval_seconds
        self._thread = None
        self._stop_event = threading.Event()
        self._running = False

    def start(self):
        """Start the worker background thread."""
        if self._running:
            logger.warning("Worker already running")
            return

        self._running = True
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()
        logger.info(f"✓ Worker service started (poll_interval={self.poll_interval_seconds}s)")

    def stop(self):
        """Stop the worker background thread."""
        if not self._running:
            return

        logger.info("Stopping worker service...")
        self._running = False
        self._stop_event.set()

        if self._thread:
            self._thread.join(timeout=10)

        logger.info("✓ Worker service stopped")

    def _run_loop(self):
        """Main worker loop (runs in background thread)."""
        logger.info("Worker loop started")

        while not self._stop_event.is_set():
            try:
                # One session per tick.
                #
                # worker_tick() and everything under it reach the session
                # through current_session(), which reads a contextvar that only
                # get_db (a FastAPI request) or get_session() sets. This loop
                # runs in its own thread where neither had, so every tick raised
                # "No database session available" and the pipeline queue was
                # never drained — the worker looked alive and did nothing.
                #
                # Per tick rather than per worker: a session held for the
                # process lifetime keeps one transaction open for days, which
                # both pins a snapshot and loses any SET LOCAL on first commit.
                with get_session():
                    worker_tick()
            except Exception as e:
                logger.error(f"Worker loop error: {e}", exc_info=True)

            # Heartbeat for the container healthcheck.
            #
            # Touched after the tick whether or not it raised: a tick that
            # fails is a working loop with a failing job, and the two need
            # different alarms. What this proves is that the loop thread is
            # still going round — which is the only thing worth checking here,
            # because the loop runs in a thread while the main thread sleeps,
            # so the process can outlive it and the container would look fine.
            try:
                HEARTBEAT_PATH.touch()
            except OSError:  # pragma: no cover - a read-only /tmp is not fatal
                pass

            # Wait for next interval (or stop event)
            # Use shorter sleep intervals to be more responsive to stop signal
            for _ in range(self.poll_interval_seconds):
                if self._stop_event.is_set():
                    break
                time.sleep(1)

        logger.info("Worker loop exited")


# Global worker instance
_worker_instance: Optional[WorkerService] = None


def start_worker(enabled: bool = True, poll_interval_seconds: int = 10):
    """
    Start the global worker service.

    Args:
        enabled: Whether to start the worker. Decided by the caller — nothing
            in here reads WORKER_ENABLED, whatever this docstring used to say.
        poll_interval_seconds: How often to poll for jobs
    """
    global _worker_instance

    if not enabled:
        logger.info("Worker not started: caller passed enabled=False")
        return

    if _worker_instance and _worker_instance._running:
        logger.warning("Worker already started")
        return

    _worker_instance = WorkerService(poll_interval_seconds=poll_interval_seconds)
    _worker_instance.start()


def stop_worker():
    """Stop the global worker service."""
    global _worker_instance

    if _worker_instance:
        _worker_instance.stop()
        _worker_instance = None


if __name__ == "__main__":
    """Run the worker as a standalone service."""
    import os
    import sys
    import signal

    # Disable embedded worker/scheduler when running standalone
    # (we'll start our own worker below)
    os.environ["WORKER_ENABLED"] = "false"
    os.environ["SCHEDULER_ENABLED"] = "false"

    # Setup logging
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # Initialize database engine.
    #
    # This said `init_engine`, which has never existed in app.database — so the
    # standalone worker raised ImportError on the first line it reached and the
    # pipeline job queue had no consumer at all. get_engine() is the singleton
    # initializer; calling it here fails fast on a bad DATABASE_URL rather than
    # inside the first job.
    from app.database import get_engine
    get_engine()

    logger.info("Starting Madrona worker service...")

    def signal_handler(signum, frame):
        logger.info("Shutting down worker...")
        stop_worker()
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    # Poll interval comes from WORKER_POLL_INTERVAL_SECONDS, not a literal.
    # How hard this process hammers the job table is the one thing an operator
    # running it needs to be able to turn down, and the literal here meant the
    # documented setting did nothing. enabled=True is not configurable on
    # purpose: running this process IS starting the worker.
    from app.config import get_settings

    start_worker(
        enabled=True,
        poll_interval_seconds=get_settings().worker_poll_interval_seconds,
    )

    # Keep main thread alive
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        logger.info("Shutting down worker...")
        stop_worker()