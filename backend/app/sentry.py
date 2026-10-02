"""
Sentry integration for error tracking and performance monitoring.

Initializes Sentry SDK for FastAPI and Celery. Only active when SENTRY_DSN
is configured - safe to leave empty in development.

Usage:
    # In asgi.py:
    from app.sentry import init_sentry
    init_sentry(settings)

    # In celery_app.py:
    from app.sentry import init_sentry_celery
    init_sentry_celery()
"""

import logging

logger = logging.getLogger(__name__)


def init_sentry(settings) -> bool:
    """
    Initialize Sentry SDK for the FastAPI application.

    Args:
        settings: Application Settings instance

    Returns:
        True if Sentry was initialized, False if skipped (no DSN configured)
    """
    if not settings.sentry_dsn:
        return False

    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.starlette import StarletteIntegration
    from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
    from sentry_sdk.integrations.celery import CeleryIntegration
    from sentry_sdk.integrations.redis import RedisIntegration

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment or settings.app_env,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        send_default_pii=False,
        integrations=[
            FastApiIntegration(),
            StarletteIntegration(),
            SqlalchemyIntegration(),
            # monitor_beat_tasks=False: we do NOT auto-register every Beat task
            # as a billable Sentry cron monitor. Only the data-integrity and
            # usage-accounting jobs are monitored, via @cron_monitor in app/sentry_crons.py.
            CeleryIntegration(monitor_beat_tasks=False),
            RedisIntegration(),
        ],
        before_send=_before_send,
        traces_sampler=_traces_sampler,
    )

    logger.info(
        "Sentry initialized (env=%s, traces=%.0f%%)",
        settings.sentry_environment or settings.app_env,
        settings.sentry_traces_sample_rate * 100,
    )
    return True


def init_sentry_celery() -> None:
    """
    Initialize Sentry for Celery workers.

    Called from celery_app.py. Reads config directly from env vars
    to avoid circular imports with the Settings singleton.
    """
    import os

    dsn = os.getenv("SENTRY_DSN", "")
    if not dsn:
        return

    import sentry_sdk
    from sentry_sdk.integrations.celery import CeleryIntegration
    from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
    from sentry_sdk.integrations.redis import RedisIntegration

    environment = os.getenv("SENTRY_ENVIRONMENT", "") or os.getenv("APP_ENV", "") or os.getenv("FLASK_ENV", "production")
    traces_sample_rate = float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.1"))

    sentry_sdk.init(
        dsn=dsn,
        environment=environment,
        traces_sample_rate=traces_sample_rate,
        send_default_pii=False,
        integrations=[
            # See note in init_sentry(): selective cron monitoring only.
            CeleryIntegration(monitor_beat_tasks=False),
            SqlalchemyIntegration(),
            RedisIntegration(),
        ],
        before_send=_before_send,
    )

    logger.info("Sentry initialized for Celery worker (env=%s)", environment)


def set_sentry_user(user_id: str, org_id: str | None = None) -> None:
    """
    Set user context on the current Sentry scope.

    Call this after authentication to attach user/org info to error reports.

    Args:
        user_id: Authenticated user ID
        org_id: Current organization ID (optional)
    """
    try:
        import sentry_sdk
        sentry_sdk.set_user({"id": user_id})
        if org_id:
            sentry_sdk.set_tag("organization_id", org_id)
    except Exception:
        pass  # Sentry not initialized or import failed - no-op


def _before_send(event, hint):
    """
    Scrub sensitive data before sending to Sentry.

    Removes authorization headers, cookies, and other PII from events.
    """
    if "request" in event:
        req = event["request"]
        headers = req.get("headers", {})
        # Remove sensitive headers
        for key in list(headers.keys()):
            lower = key.lower() if isinstance(key, str) else ""
            if lower in ("authorization", "cookie", "x-csrf-token"):
                headers[key] = "[Filtered]"
        # Remove query string parameters that might contain tokens
        if "query_string" in req:
            req["query_string"] = "[Filtered]"

    return event


def _traces_sampler(sampling_context):
    """
    Custom sampler that drops health check and metrics transactions.

    These fire constantly and are not useful for performance monitoring.
    """
    try:
        asgi_scope = sampling_context.get("asgi_scope", {})
        path = asgi_scope.get("path", "")
        if path in ("/health", "/health/search", "/metrics", "/"):
            return 0.0
    except Exception:
        pass

    # Fall back to the global traces_sample_rate
    return None
