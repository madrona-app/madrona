"""
Standalone SQLAlchemy engine, session, and base class.

Provides:
- Base: DeclarativeBase for all models
- get_db(): FastAPI dependency yielding a session
- get_session(): Context manager for Celery tasks and service code
- current_session(): Access the active session from any context
"""

from collections.abc import AsyncGenerator, Generator
from contextlib import contextmanager
from contextvars import ContextVar

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy models."""

    pass


_engine = None
_SessionLocal = None
_current_session: ContextVar[Session | None] = ContextVar("_current_session", default=None)


def _psycopg3_uri(uri: str) -> str:
    # Driver is psycopg (v3) per requirements.txt; SQLAlchemy defaults to
    # psycopg2 for bare `postgresql://` URLs. Force the v3 dialect.
    if uri.startswith("postgresql://"):
        return "postgresql+psycopg://" + uri[len("postgresql://") :]
    return uri


def get_engine():
    """Create or return the SQLAlchemy engine (singleton)."""
    global _engine
    if _engine is None:
        settings = get_settings()
        _engine = create_engine(
            _psycopg3_uri(settings.sqlalchemy_database_uri),
            pool_size=settings.db_pool_size,
            max_overflow=settings.db_max_overflow,
            pool_recycle=settings.db_pool_recycle,
            pool_pre_ping=True,
            pool_timeout=settings.db_pool_timeout,
            echo=settings.sqlalchemy_echo,
        )
    return _engine


def get_session_factory():
    """Create or return the sessionmaker (singleton)."""
    global _SessionLocal
    if _SessionLocal is None:
        _SessionLocal = sessionmaker(
            bind=get_engine(),
            autocommit=False,
            autoflush=False,
            expire_on_commit=False,
        )
        # Re-apply RLS context on every transaction begin so SET LOCAL org
        # isolation survives mid-request commits (the 58549a39 bug class).
        from app.services.rls import register_rls_session_hooks
        register_rls_session_hooks()
    return _SessionLocal


async def get_db() -> AsyncGenerator[Session, None]:
    """FastAPI dependency that yields a session and binds it as the current one.

    Async on purpose, and this is the whole reason.

    FastAPI runs a *sync* generator dependency in a worker thread. A ContextVar
    set there is set in that thread's own copy of the context, and the copy is
    discarded when the dependency returns — so the endpoint, which runs in a
    different thread with a context copied from the request's async context,
    never sees it. current_session() then raised

        RuntimeError: No database session available.

    from any service that relied on it, on every request. Measured directly:
    with a sync dependency the endpoint reads None whether it is sync or async;
    with an async dependency it reads the value in both cases, because the set
    happens in the request's own async context and anyio copies that context
    into the threadpool when it calls the endpoint.

    That accounted for a family of 500s — sla/status, media/duplicates and the
    media download-request endpoints among them — each of which had previously
    been patched one at a time by threading a session through by hand.

    .set(None) rather than .reset(token): Starlette's BaseHTTPMiddleware can run
    the code after the yield in a different context from the one that created
    the token, and reset() then raises ValueError.
    """
    SessionLocal = get_session_factory()
    session = SessionLocal()
    _current_session.set(session)
    try:
        yield session
    finally:
        _current_session.set(None)
        session.close()


def get_admin_db() -> Generator[Session, None, None]:
    """FastAPI dependency yielding a BYPASSRLS owner-connection session.

    Use sparingly: this skips every RLS policy. Appropriate for pre-auth
    flows (e.g. invitation token lookup before the user has a
    `current_org_id`) and platform-admin endpoints. Anything reachable
    by an authenticated org user should go through `get_db` so tenant
    isolation holds.
    """
    from app.tasks.rls_helpers import admin_db_session
    with admin_db_session() as session:
        yield session


@contextmanager
def get_session() -> Generator[Session, None, None]:
    """Standalone session for service/task code (not FastAPI dependency injection)."""
    SessionLocal = get_session_factory()
    session = SessionLocal()
    token = _current_session.set(session)
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        _current_session.reset(token)
        session.close()


def current_session() -> Session:
    """Get the active session from context (set by get_db or get_session)."""
    session = _current_session.get()
    if session is None:
        raise RuntimeError(
            "No database session available. Ensure code runs within "
            "a FastAPI request (get_db) or a get_session() context manager."
        )
    return session
