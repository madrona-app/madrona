"""
Celery configuration for background task processing.

Architecture:
- Redis as message broker and result backend
- Named queues for different task types
- Worker can scale horizontally in containers

Queues:
- default: Fallback for unrouted tasks
- ai: AI features (classification, tagging, descriptions via Ollama)
- media: Image processing, thumbnails, metadata extraction
- reports: Report generation and scheduling
- search: OpenSearch indexing
"""

import os
from pathlib import Path

# Load .env file for local development
from dotenv import load_dotenv
env_path = Path(__file__).resolve().parent.parent / '.env'
load_dotenv(env_path)

from celery import Celery

# Initialize Sentry for Celery workers (must be before Celery app creation)
from app.sentry import init_sentry_celery
init_sentry_celery()

# Entity auditing is a SQLAlchemy Session-class listener, and it was registered
# only in asgi.py. Workers import this module instead, so EVERY mutation a
# background task made — scheduled publishing to the public site, the weekly
# ULAN authority sync, media processing — was written with no audit event at
# all. Registering here covers the worker and the beat scheduler. The function
# is idempotent, so a process that somehow loads both entry points registers
# once.
#
# Note this only restores the EVENT. Attribution still depends on
# ctx.request_user_id, which tasks do not set, so task-written events carry a
# null actor; the business records themselves keep their own *_by columns.
from app.services.entity_audit import register_audit_listeners
register_audit_listeners()

# Get Redis URL from environment (avoid circular imports with Settings)
redis_url = os.getenv('REDIS_URL', 'redis://localhost:6379/0')

# Initialize Celery
celery_app = Celery(
    'madrona',
    broker=redis_url,
    backend=redis_url,
    include=[
        'app.tasks.classification',
        'app.tasks.media',
        'app.tasks.reports',
        'app.tasks.search',
        'app.tasks.vocabulary',
        'app.tasks.ulan',
        'app.tasks.ai_tagging',
        'app.tasks.storage_migration',
        'app.tasks.auth',
        'app.tasks.backup',
        'app.tasks.sla',
        'app.tasks.clip',
        'app.tasks.semantic_search',
        'app.tasks.whisper',
        'app.tasks.ocr',
        'app.tasks.content',
        'app.tasks.discover',
        'app.tasks.geo',
        'app.tasks.visitor',
        'app.tasks.preservation',
        'app.tasks.storage_metering',
        'app.tasks.guide_documents',
        'app.tasks.provisioning',
        # Multi-agent orchestration scanners. Referenced in beat_schedule
        # (scan_awaiting_workflow_transitions, recover_stalled_plans_task) —
        # MUST be imported here or the worker rejects them as unregistered.
        'app.tasks.agent_plans',
    ]
)

# Configuration
celery_app.conf.update(
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    timezone='UTC',
    enable_utc=True,
    task_track_started=True,
    task_time_limit=300,  # 5 minutes max per task
    task_soft_time_limit=240,  # Soft limit at 4 minutes
    worker_prefetch_multiplier=4,  # Fetch 4 tasks at a time
    worker_max_tasks_per_child=1000,  # Restart worker after 1000 tasks (prevent memory leaks)
    # Ollama-optimized settings for parallel AI classification
    worker_pool='prefork',  # Use multiprocessing for CPU-bound AI tasks
    worker_concurrency=4,  # Number of parallel workers (adjust based on CPU cores)
    task_acks_late=True,  # Acknowledge task after completion (safer for AI tasks)
    task_reject_on_worker_lost=True,  # Requeue if worker crashes
    # Use 'default' as the default queue name (more descriptive than 'celery')
    task_default_queue='default',
    # Retry publishing if broker connection drops
    task_publish_retry=True,
    task_publish_retry_policy={
        'max_retries': 5,
        'interval_start': 0.2,
        'interval_step': 0.5,
        'interval_max': 5.0,
    },
    # Store results for 24 hours (for idempotency checks and monitoring)
    result_expires=86400,
)

# Task routing - route tasks to named queues
celery_app.conf.task_routes = {
    'app.tasks.classification.*': {'queue': 'ai'},
    'app.tasks.ai_tagging.*': {'queue': 'ai'},  # AI tagging uses the 'ai' queue
    'app.tasks.clip.*': {'queue': 'ai'},         # CLIP embeddings use the 'ai' queue
    # semantic_search now calls remote Voyage (not an in-process model), so it
    # no longer belongs on the heavy 'ai' queue. The deployed worker doesn't
    # consume 'ai' (see app_init.sh -Q), which silently stranded every
    # collection embedding + backfill. Route to 'search' so it actually runs.
    'app.tasks.semantic_search.*': {'queue': 'search'},
    'app.tasks.whisper.*': {'queue': 'ai'},       # Whisper transcription uses the 'ai' queue
    'app.tasks.ocr.*': {'queue': 'ai'},           # OCR uses the 'ai' queue
    'app.tasks.media.*': {'queue': 'media'},
    'app.tasks.preservation.*': {'queue': 'media'},
    'app.tasks.reports.*': {'queue': 'reports'},
    'app.tasks.search.*': {'queue': 'search'},
    'app.tasks.discover.*': {'queue': 'default'},
    'app.tasks.content.*': {'queue': 'default'},
    'app.tasks.visitor.*': {'queue': 'default'},
    # Guide RAG ingestion embeds via remote Voyage too — same reasoning as
    # semantic_search above. Keep it on a queue the deployed worker consumes.
    'app.tasks.guide_documents.*': {'queue': 'search'},
}

# Beat schedule for periodic tasks
from celery.schedules import crontab

celery_app.conf.beat_schedule = {
    'cleanup-expired-report-exports': {
        'task': 'app.tasks.reports.cleanup_expired_exports',
        'schedule': crontab(hour=3, minute=0),  # Run daily at 3am UTC
        'options': {'queue': 'reports'},
    },
    'check-expiring-rights-consents': {
        'task': 'app.tasks.media.check_expiring_rights_consents',
        'schedule': crontab(hour=6, minute=0),  # Run daily at 6am UTC
        'options': {'queue': 'media'},
    },
    # Getty vocabulary/authority sync tasks
    'refresh-stale-vocabulary-terms': {
        'task': 'app.tasks.vocabulary.refresh_stale_terms',
        'schedule': crontab(hour='*/6'),  # Run every 6 hours
        'options': {'queue': 'default'},
    },
    'refresh-stale-ulan-authorities': {
        'task': 'app.tasks.ulan.refresh_stale_ulan_authorities',
        'schedule': crontab(hour=2, minute=0, day_of_week=0),  # Run weekly on Sunday at 2am UTC
        'args': (7,),  # Check for changes in last 7 days
        'options': {'queue': 'default'},
    },
    # Auth token cleanup — purge expired/revoked tokens daily
    'cleanup-expired-tokens': {
        'task': 'app.tasks.auth.cleanup_expired_tokens',
        'schedule': crontab(hour=4, minute=0),  # Run daily at 4am UTC
        'options': {'queue': 'default'},
    },
    # Backup verification — check S3 backups and WAL archiving
    'verify-backups': {
        'task': 'app.tasks.backup.verify_backups',
        'schedule': crontab(hour=5, minute=0),  # Daily at 5 AM UTC
        'options': {'queue': 'default'},
    },
    # Discover publishing schedule check
    'check-due-publish-schedules': {
        'task': 'app.tasks.discover.check_due_publish_schedules',
        'schedule': 60.0,  # Run every minute
        'options': {'queue': 'default'},
    },
    # SLA deadline checking — evaluate policies and send escalation notifications
    'check-sla-deadlines': {
        'task': 'app.tasks.sla.check_sla_deadlines',
        'schedule': crontab(minute='*/15'),  # Run every 15 minutes
        'options': {'queue': 'default'},
    },
    # Multi-agent orchestration: scan agent_plan_steps awaiting workflow
    # transitions and resume plans whose target_status has been reached.
    'scan-awaiting-workflow-transitions': {
        'task': 'app.tasks.agent_plans.scan_awaiting_workflow_transitions',
        'schedule': 60.0,  # Run every minute — same cadence as other status scanners
        'options': {'queue': 'default'},
    },
    # Multi-agent orchestration (§1D): resume/fail plans awaiting an async job
    # (transcription, derivatives, CLIP) by polling the entity's status column.
    'scan-awaiting-jobs': {
        'task': 'app.tasks.agent_plans.scan_awaiting_jobs',
        'schedule': 60.0,  # Same cadence as the workflow-transition scanner
        'options': {'queue': 'default'},
    },
    # Multi-agent orchestration: safety-net recovery of plans whose
    # in-progress step was abandoned (worker crash mid-step).
    'recover-stalled-agent-plans': {
        'task': 'app.tasks.agent_plans.recover_stalled_plans_task',
        'schedule': crontab(minute='*/5'),  # Every 5 minutes
        'options': {'queue': 'default'},
    },
    # Smart collections — refresh saved-search collections every 15 minutes
    'refresh-smart-collections': {
        'task': 'app.tasks.media.refresh_smart_collections',
        'schedule': crontab(minute='*/15'),
        'options': {'queue': 'media'},
    },
    # Checksum verification — weekly fixity check with PREMIS event recording
    'verify-media-checksums': {
        'task': 'app.tasks.preservation.verify_media_checksums',
        'schedule': crontab(hour=1, minute=0, day_of_week=0),  # Weekly Sunday 1am UTC
        'options': {'queue': 'media'},
    },
    # Format identification — daily PRONOM backfill for unidentified media
    'backfill-format-identification': {
        'task': 'app.tasks.preservation.backfill_format_identification',
        'schedule': crontab(hour=2, minute=0),  # Daily at 2am UTC
        'options': {'queue': 'media'},
    },
    # Preservation policy evaluation — daily check for policy-triggered actions
    'evaluate-preservation-policies': {
        'task': 'app.tasks.preservation.evaluate_preservation_policies',
        'schedule': crontab(hour=3, minute=30),  # Daily at 3:30am UTC
        'options': {'queue': 'media'},
    },
    # Backup replication — daily copy unreplicated media to backup storage
    'replicate-to-backup': {
        'task': 'app.tasks.preservation.replicate_to_backup',
        'schedule': crontab(hour=4, minute=30),  # Daily at 4:30am UTC
        'options': {'queue': 'media'},
    },
    # Replica verification — weekly check that backup copies match source
    'verify-replicas': {
        'task': 'app.tasks.preservation.verify_replicas',
        'schedule': crontab(hour=1, minute=30, day_of_week=0),  # Weekly Sunday 1:30am UTC
        'options': {'queue': 'media'},
    },
    # Saved search notifications — check every 4 hours for result changes
    'check-search-subscriptions': {
        'task': 'app.tasks.media.check_search_subscriptions',
        'schedule': crontab(hour='*/4', minute=30),
        'options': {'queue': 'media'},
    },
    # Content CMS scheduled publishing — auto-publish pages at scheduled time
    'check-scheduled-content': {
        'task': 'app.tasks.content.check_scheduled_content',
        'schedule': 60.0,  # Run every minute
        'options': {'queue': 'default'},
    },
    # Poll MediaConvert transcode jobs — complete finished jobs, submit queued ones
    'poll-transcode-jobs': {
        'task': 'app.tasks.media.poll_transcode_jobs',
        'schedule': 60.0,  # Run every 60 seconds
        'options': {'queue': 'media'},
    },
    # Stuck media job cleanup — catch crashed workers and orphaned media
    'cleanup-stuck-media-jobs': {
        'task': 'app.tasks.media.cleanup_stuck_media_jobs',
        'schedule': 600.0,  # Run every 10 minutes
        'options': {'queue': 'media'},
    },
    # Visitor visit lifecycle — detect idle visits and queue recap emails
    'check-ended-visits': {
        'task': 'app.tasks.visitor.check_ended_visits',
        'schedule': crontab(minute='*/15'),  # Run every 15 minutes
        'options': {'queue': 'default'},
    },
    # Agent retention — purge expired visitor/staff conversations daily
    'purge-expired-agent-conversations': {
        'task': 'app.tasks.visitor.purge_expired_agent_conversations',
        'schedule': crontab(hour=2, minute=30),  # Daily at 2:30am UTC
        'options': {'queue': 'default'},
    },
    # Storage metering — daily Postgres + OpenSearch usage per org
    'collect-storage-metrics': {
        'task': 'app.tasks.storage_metering.collect_storage_metrics',
        'schedule': crontab(hour=1, minute=30),  # Daily at 1:30am UTC
        'options': {'queue': 'default'},
    },
}
