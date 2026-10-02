"""
Selective Sentry cron monitoring.

We deliberately DISABLE Sentry's automatic ``monitor_beat_tasks`` (see
``app/sentry.py``). That flag registers every Celery Beat task (~26 of them)
as its own billable Sentry cron monitor, which is what drove the
pay-as-you-go cron line on the invoice. Sentry bills *per active monitor*,
not per check-in, so the fix is to monitor fewer jobs — not to run them less
often.

Instead we monitor only the handful of jobs where a silent miss causes real
harm: backup / preservation integrity (data loss) and storage metering
(usage accounting). Everything else is a poller or scanner that self-heals on
its next tick — task *errors* are still reported to Sentry by the normal
CeleryIntegration regardless; this module only adds the "did it run on
schedule?" heartbeat.

Each monitored task is decorated with ``@cron_monitor("<slug>")`` placed
directly below ``@celery_app.task`` so it wraps execution in the worker. The
slug and schedule MUST match the corresponding entry in
``celery_app.conf.beat_schedule``; keep them in sync if the schedule changes.

When ``SENTRY_DSN`` is unset (local dev, tests) the decorator is a
transparent no-op — ``sentry_sdk`` never initializes a client, so the
check-in is silently dropped.
"""

from sentry_sdk.crons import monitor

# slug -> Sentry monitor_config. Schedules mirror celery_app.beat_schedule.
# max_runtime is in minutes and is set above each task's Celery time_limit so
# a long-but-healthy run does not produce a false "timed out" alert.
MONITOR_CONFIGS: dict[str, dict] = {
    # Daily 05:00 UTC — time_limit 180s
    "verify-backups": {
        "schedule": {"type": "crontab", "value": "0 5 * * *"},
        "timezone": "UTC",
        "checkin_margin": 30,
        "max_runtime": 10,
    },
    # Weekly Sun 01:00 UTC — time_limit 3900s
    "verify-media-checksums": {
        "schedule": {"type": "crontab", "value": "0 1 * * 0"},
        "timezone": "UTC",
        "checkin_margin": 60,
        "max_runtime": 75,
    },
    # Daily 04:30 UTC — time_limit 3900s
    "replicate-to-backup": {
        "schedule": {"type": "crontab", "value": "30 4 * * *"},
        "timezone": "UTC",
        "checkin_margin": 60,
        "max_runtime": 75,
    },
    # Weekly Sun 01:30 UTC — time_limit 3900s
    "verify-replicas": {
        "schedule": {"type": "crontab", "value": "30 1 * * 0"},
        "timezone": "UTC",
        "checkin_margin": 60,
        "max_runtime": 75,
    },
    # Daily 01:30 UTC — no explicit time_limit
    "collect-storage-metrics": {
        "schedule": {"type": "crontab", "value": "30 1 * * *"},
        "timezone": "UTC",
        "checkin_margin": 30,
        "max_runtime": 30,
    },
}


def cron_monitor(slug: str):
    """Attach a Sentry cron monitor to a Celery task.

    Place BELOW ``@celery_app.task`` so it wraps task execution in the worker::

        @celery_app.task(...)
        @cron_monitor("verify-backups")
        def verify_backups(): ...

    No-op when Sentry is not initialized (empty ``SENTRY_DSN``).
    """
    return monitor(monitor_slug=slug, monitor_config=MONITOR_CONFIGS[slug])
