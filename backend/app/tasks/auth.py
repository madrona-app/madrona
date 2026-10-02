"""
Periodic auth-related cleanup tasks.

- Purge expired/revoked refresh tokens
- Purge used/expired password reset tokens
"""

import logging
from datetime import datetime, timedelta, timezone

from app.celery_app import celery_app
from app.tasks.base import SystemTask

logger = logging.getLogger(__name__)


@celery_app.task(base=SystemTask, name='app.tasks.auth.cleanup_expired_tokens')
def cleanup_expired_tokens(refresh_days: int = 30, reset_days: int = 7) -> dict:
    """
    Delete refresh tokens and password reset tokens that are no longer useful.

    Refresh tokens are deleted if they expired or were revoked more than
    `refresh_days` ago.  Password reset tokens are deleted if they were
    used or expired more than `reset_days` ago.

    Uses admin_db_session() because this is a cross-org system task.
    """
    from app.tasks.rls_helpers import admin_db_session
    from app.models import RefreshToken, PasswordResetToken

    now = datetime.now(timezone.utc)
    refresh_cutoff = now - timedelta(days=refresh_days)
    reset_cutoff = now - timedelta(days=reset_days)

    with admin_db_session() as session:
        # Delete expired refresh tokens (past expiry by cutoff period)
        expired_refresh = (
            session.query(RefreshToken)
            .filter(RefreshToken.expires_at < refresh_cutoff)
            .delete(synchronize_session=False)
        )

        # Delete revoked refresh tokens (revoked before cutoff)
        revoked_refresh = (
            session.query(RefreshToken)
            .filter(
                RefreshToken.revoked_at.isnot(None),
                RefreshToken.revoked_at < refresh_cutoff,
            )
            .delete(synchronize_session=False)
        )

        # Delete used password reset tokens (used before cutoff)
        used_reset = (
            session.query(PasswordResetToken)
            .filter(
                PasswordResetToken.used_at.isnot(None),
                PasswordResetToken.used_at < reset_cutoff,
            )
            .delete(synchronize_session=False)
        )

        # Delete expired password reset tokens (past expiry by cutoff)
        expired_reset = (
            session.query(PasswordResetToken)
            .filter(PasswordResetToken.expires_at < reset_cutoff)
            .delete(synchronize_session=False)
        )

        session.commit()

    total = expired_refresh + revoked_refresh + used_reset + expired_reset
    # `logger` here is a stdlib logger, which rejects arbitrary keyword
    # arguments — passing these directly raised TypeError on every run, after
    # the deletes had already been committed. Counts go through `extra`, the
    # same way app/tasks/backup.py does it.
    logger.info(
        "token_cleanup_complete",
        extra={
            'expired_refresh': expired_refresh,
            'revoked_refresh': revoked_refresh,
            'used_reset': used_reset,
            'expired_reset': expired_reset,
            'total': total,
        },
    )

    return {
        'expired_refresh_deleted': expired_refresh,
        'revoked_refresh_deleted': revoked_refresh,
        'used_reset_deleted': used_reset,
        'expired_reset_deleted': expired_reset,
        'total_deleted': total,
    }
