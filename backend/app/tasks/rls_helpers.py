"""RLS context helpers for Celery background tasks."""

import logging
import os
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.services.rls import set_rls_context_for_session

logger = logging.getLogger(__name__)


def set_task_rls_context(session: Session, organization_id: str) -> None:
    """
    Set RLS context for an org-scoped Celery task.

    Uses set_config() so context is scoped to the current transaction.
    """
    set_rls_context_for_session(session, organization_id)


@contextmanager
def admin_db_session():
    """
    DB session as owner role (BYPASSRLS) for cross-org system tasks.

    Uses ALEMBIC_DATABASE_URL (owner credentials). Falls back to DATABASE_URL.
    """
    admin_url = os.environ.get("ALEMBIC_DATABASE_URL") or os.environ.get(
        "DATABASE_URL", ""
    )
    if not admin_url:
        raise RuntimeError("No database URL available for admin session")

    engine = create_engine(admin_url)
    session = Session(engine)
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
        engine.dispose()
