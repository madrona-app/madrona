"""
Backup verification task.

Periodically checks that database backups exist, are recent, and WAL
archives are flowing.  Sends an email alert if any check fails.

This task is a no-op when BACKUP_S3_BUCKET is not configured (local dev).
"""

import logging
from datetime import datetime, timezone, timedelta

from app.celery_app import celery_app
from app.sentry_crons import cron_monitor
from app.tasks.base import SystemTask

logger = logging.getLogger(__name__)

# Thresholds
BASE_BACKUP_MAX_AGE_DAYS = 8  # Weekly schedule → 8 days = one missed window
WAL_ARCHIVE_MAX_GAP_MINUTES = 10  # archive_timeout=300s + buffer
WAL_MIN_COUNT_24H = 12  # Sanity: at least 12 WAL files in 24h


@celery_app.task(
    base=SystemTask,
    name='app.tasks.backup.verify_backups',
    max_retries=2,
    autoretry_for=(Exception,),
    retry_backoff=True,
    soft_time_limit=120,
    time_limit=180,
)
@cron_monitor("verify-backups")
def verify_backups() -> dict:
    """
    Verify database backups are healthy.

    Checks:
    1. Latest base backup in S3 is < 8 days old
    2. WAL files exist within the last 10 minutes
    3. At least N WAL files archived in the last 24 hours

    Returns a dict with check results.  Sends email on failure.
    """
    from app.config import get_settings

    settings = get_settings()
    bucket = settings.backup_s3_bucket

    if not bucket:
        logger.info("backup_verify_skipped: BACKUP_S3_BUCKET not configured")
        return {'status': 'skipped', 'reason': 'BACKUP_S3_BUCKET not set'}

    import boto3
    from botocore.exceptions import ClientError

    s3 = boto3.client('s3', region_name=settings.aws_region)
    now = datetime.now(timezone.utc)
    checks: dict = {}
    failures: list[str] = []

    # ── Check 1: Base backup recency ──────────────────────────────────
    try:
        response = s3.list_objects_v2(
            Bucket=bucket,
            Prefix='basebackup/',
            Delimiter='/',
        )
        prefixes = response.get('CommonPrefixes', [])
        if not prefixes:
            checks['base_backup'] = 'FAIL: no base backups found'
            failures.append('No base backups found in S3')
        else:
            # Prefixes look like 'basebackup/20260215_020001/'
            latest_prefix = sorted(p['Prefix'] for p in prefixes)[-1]
            # Extract timestamp from prefix
            ts_str = latest_prefix.rstrip('/').split('/')[-1]
            try:
                backup_time = datetime.strptime(ts_str, '%Y%m%d_%H%M%S').replace(
                    tzinfo=timezone.utc
                )
                age = now - backup_time
                age_days = age.total_seconds() / 86400

                if age_days > BASE_BACKUP_MAX_AGE_DAYS:
                    checks['base_backup'] = (
                        f'FAIL: latest backup is {age_days:.1f} days old '
                        f'(threshold: {BASE_BACKUP_MAX_AGE_DAYS}d)'
                    )
                    failures.append(
                        f'Latest base backup ({ts_str}) is {age_days:.1f} days old, '
                        f'exceeds {BASE_BACKUP_MAX_AGE_DAYS}-day threshold'
                    )
                else:
                    checks['base_backup'] = (
                        f'OK: {ts_str} ({age_days:.1f} days old)'
                    )
            except ValueError:
                checks['base_backup'] = f'WARN: could not parse timestamp from {ts_str}'
    except ClientError as e:
        checks['base_backup'] = f'ERROR: {e}'
        failures.append(f'S3 error checking base backups: {e}')

    # ── Check 2: WAL archive recency ─────────────────────────────────
    try:
        # List WAL files in reverse order to find the most recent
        response = s3.list_objects_v2(
            Bucket=bucket,
            Prefix='wal/',
            MaxKeys=100,
        )
        wal_objects = response.get('Contents', [])

        if not wal_objects:
            checks['wal_recency'] = 'FAIL: no WAL files found'
            failures.append('No WAL archive files found in S3')
        else:
            latest_wal = max(wal_objects, key=lambda o: o['LastModified'])
            wal_age = now - latest_wal['LastModified']
            wal_age_minutes = wal_age.total_seconds() / 60

            if wal_age_minutes > WAL_ARCHIVE_MAX_GAP_MINUTES:
                checks['wal_recency'] = (
                    f'FAIL: latest WAL is {wal_age_minutes:.0f} min old '
                    f'(threshold: {WAL_ARCHIVE_MAX_GAP_MINUTES}min)'
                )
                failures.append(
                    f'Latest WAL archive is {wal_age_minutes:.0f} minutes old, '
                    f'exceeds {WAL_ARCHIVE_MAX_GAP_MINUTES}-minute threshold'
                )
            else:
                checks['wal_recency'] = (
                    f'OK: latest WAL {wal_age_minutes:.0f} min ago '
                    f'({latest_wal["Key"]})'
                )
    except ClientError as e:
        checks['wal_recency'] = f'ERROR: {e}'
        failures.append(f'S3 error checking WAL recency: {e}')

    # ── Check 3: WAL volume in last 24h ──────────────────────────────
    try:
        cutoff = now - timedelta(hours=24)
        # Count WAL files modified in the last 24 hours
        # Use pagination in case there are many files
        paginator = s3.get_paginator('list_objects_v2')
        wal_count_24h = 0
        for page in paginator.paginate(Bucket=bucket, Prefix='wal/'):
            for obj in page.get('Contents', []):
                if obj['LastModified'] >= cutoff:
                    wal_count_24h += 1

        if wal_count_24h < WAL_MIN_COUNT_24H:
            checks['wal_volume_24h'] = (
                f'FAIL: only {wal_count_24h} WAL files in last 24h '
                f'(threshold: {WAL_MIN_COUNT_24H})'
            )
            failures.append(
                f'Only {wal_count_24h} WAL files in last 24h, '
                f'expected at least {WAL_MIN_COUNT_24H}'
            )
        else:
            checks['wal_volume_24h'] = (
                f'OK: {wal_count_24h} WAL files in last 24h'
            )
    except ClientError as e:
        checks['wal_volume_24h'] = f'ERROR: {e}'
        failures.append(f'S3 error checking WAL volume: {e}')

    # ── Report results ────────────────────────────────────────────────
    if failures:
        logger.error(
            "backup_verify_failed",
            extra={'checks': checks, 'failures': failures},
        )
        _send_alert(settings, failures, checks)
        return {'status': 'failed', 'checks': checks, 'failures': failures}

    logger.info(
        "backup_verify_passed",
        extra={'checks': checks},
    )
    return {'status': 'passed', 'checks': checks}


def _send_alert(settings, failures: list[str], checks: dict) -> None:
    """Send email alert about backup verification failures."""
    if not settings.backup_alert_emails:
        logger.warning(
            "backup_alert_skipped: BACKUP_ALERT_EMAILS not configured"
        )
        return

    from app.services.email_service import get_email_service

    recipients = [
        e.strip() for e in settings.backup_alert_emails.split(',') if e.strip()
    ]
    if not recipients:
        return

    failure_lines = '\n'.join(f'  - {f}' for f in failures)
    check_lines = '\n'.join(f'  {k}: {v}' for k, v in checks.items())

    subject = 'Madrona Backup Verification FAILED'
    text = (
        f'Backup verification failed at {datetime.now(timezone.utc).isoformat()}\n\n'
        f'Failures:\n{failure_lines}\n\n'
        f'All checks:\n{check_lines}\n\n'
        f'Bucket: {settings.backup_s3_bucket}\n'
        f'Action required: Investigate immediately.\n'
    )
    html = (
        f'<h2>Backup Verification Failed</h2>'
        f'<p>Time: {datetime.now(timezone.utc).isoformat()}</p>'
        f'<h3>Failures</h3><ul>'
        + ''.join(f'<li>{f}</li>' for f in failures)
        + '</ul>'
        f'<h3>All Checks</h3><ul>'
        + ''.join(f'<li><strong>{k}</strong>: {v}</li>' for k, v in checks.items())
        + '</ul>'
        f'<p>Bucket: <code>{settings.backup_s3_bucket}</code></p>'
        f'<p><strong>Action required:</strong> Investigate immediately.</p>'
    )

    email_service = get_email_service()
    email_service.send_email(
        channel='notifications',
        to=recipients,
        subject=subject,
        html=html,
        text=text,
        tags={'type': 'backup-alert'},
    )
