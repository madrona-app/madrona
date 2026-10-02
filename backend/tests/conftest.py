"""
Pytest fixtures — PostgreSQL only.

The previous conftest maintained a SQLite in-memory engine and a
~60-line `_adapt_metadata_for_sqlite` that flattened schemas and cast
Postgres-specific types (JSONB, ARRAY, Geometry, UUID) down to SQLite-
compatible shapes. That adapter mutated the shared `Base.metadata`,
which poisoned every postgres-marked test that ran in the same process
once any fixture touching `app` had been loaded.

Production uses Postgres with schemas, JSONB, PostGIS geometry, pgvector,
and RLS — none of which SQLite can approximate. Tests passing on SQLite
didn't mean much about production behavior, and the adapter caused more
bugs than it prevented. Ripping it out.

Environment:
    TEST_DATABASE_URL — postgres connection string (required). Example:
        postgresql+psycopg://postgres:postgres@localhost:5432/madrona_test

The session-scoped engine drops and recreates schemas, installs extensions
if missing, and runs `Base.metadata.create_all` once per session. Each
test runs inside a connection-level transaction that rolls back on
teardown, so tests are isolated without repeated DDL.
"""

import os
import sys
import time as _time
import warnings

# Run the suite in UTC, because the application does.
#
# The app and Postgres run in UTC containers, so a server-computed date is a UTC
# date. Tests run on a developer's machine, where date.today() is local. Any
# test that builds a date locally and compares it to one the server computed is
# then wrong for the hours when the two calendars disagree — for UTC-4 that is
# 20:00 to midnight. test_complete_from_in_progress set start_date to
# "today - 5 days" and asserted a 5-day duration; after 20:00 EDT the server
# was already on the next UTC day and returned 6. There are ~100 naive
# date.today() calls across the suite exposed to the same hazard, and CI never
# saw it because CI runners are already UTC.
os.environ["TZ"] = "UTC"
_time.tzset()
import uuid as _uuid
from contextlib import contextmanager
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool


# The suite IS the testing environment — declare it rather than inheriting
# whatever APP_ENV a developer's .env happens to carry. CI already sets
# APP_ENV=testing (.github/workflows/backend-tests.yml), so local runs that
# picked up "development" from a .env were silently diverging from CI. This
# also matters for routers/test_support.py, whose gate is an allowlist on
# "testing" — a denylist would have let it answer under any other name.
os.environ["APP_ENV"] = "testing"

# Sentry off for tests so test failures don't get reported.
os.environ.setdefault("SENTRY_DSN", "")
os.environ.setdefault("_SKIP_AUTO_CREATE_APP", "1")
os.environ.setdefault("_MADRONA_ASGI", "1")
# CognitoService() raises on import when these are unset (see
# app/services/cognito.py:137). Tests that hit auth routes mock the
# underlying client; the defaults below only need to be truthy so the
# constructor doesn't blow up before the mock can take effect.
os.environ.setdefault("COGNITO_USER_POOL_ID", "us-west-2_TEST")
os.environ.setdefault("COGNITO_CLIENT_ID", "test-client-id")
# REDIS_URL is used for Celery, Socket.IO, and rate-limit; leave it as the
# default Redis URL. Celery tasks are configured to always-eager below so
# task.delay() runs in-process (no broker required for tests).


_TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "")

if not _TEST_DATABASE_URL:
    print(
        "\n❌ TEST_DATABASE_URL is required.\n"
        "The test suite now runs exclusively against PostgreSQL (see conftest "
        "module docstring for why).\n"
        "Point TEST_DATABASE_URL at a test DB, e.g.:\n"
        "  export TEST_DATABASE_URL='postgresql+psycopg://postgres:postgres@localhost:5432/madrona_test'\n",
        file=sys.stderr,
    )
    sys.exit(1)

if "postgres" not in _TEST_DATABASE_URL:
    print(
        f"\n❌ TEST_DATABASE_URL must be a PostgreSQL URL. Got: {_TEST_DATABASE_URL}\n",
        file=sys.stderr,
    )
    sys.exit(1)

# Normalize to psycopg v3 dialect.
if _TEST_DATABASE_URL.startswith("postgresql://"):
    _TEST_DATABASE_URL = "postgresql+psycopg://" + _TEST_DATABASE_URL[len("postgresql://") :]


def _ensure_worker_database(base_url: str) -> str:
    """Give each pytest-xdist worker its own database.

    Under `pytest -n N`, xdist sets PYTEST_XDIST_WORKER ("gw0", "gw1", ...) per
    worker process. The per-test transaction rollback in `db_session` isolates
    tests *within* a worker, but parallel workers would still trample each
    other on a shared database — so each worker gets its own DB
    (`<dbname>_gw0`, ...). Per-worker *schemas* aren't viable because the
    models hardcode schema names (collections., media., ...).

    Returns `base_url` unchanged for serial runs (no worker id).
    """
    worker = os.environ.get("PYTEST_XDIST_WORKER")
    if not worker:
        return base_url

    from sqlalchemy import create_engine as _ce, text as _text
    from sqlalchemy.engine import make_url

    url = make_url(base_url)
    worker_db = f"{url.database}_{worker}"
    # CREATE DATABASE is DDL that can't run in a transaction, so connect to the
    # original (already-present) database in AUTOCOMMIT to provision the
    # worker's DB once. Idempotent: skip if it already exists (reused across
    # runs). The worker's own schema/extensions/grants are built later by the
    # test_engine fixture, exactly as for a serial run.
    admin = _ce(base_url, isolation_level="AUTOCOMMIT", future=True)
    try:
        with admin.connect() as conn:
            exists = conn.execute(
                _text("SELECT 1 FROM pg_database WHERE datname = :n"),
                {"n": worker_db},
            ).scalar()
            if not exists:
                conn.execute(_text(f'CREATE DATABASE "{worker_db}"'))
    finally:
        admin.dispose()
    # render_as_string(hide_password=False): plain str(URL) masks the password
    # as "***", which would break the worker's DB connections.
    return url.set(database=worker_db).render_as_string(hide_password=False)


_TEST_DATABASE_URL = _ensure_worker_database(_TEST_DATABASE_URL)

# Settings() instantiates on many module imports and validates DATABASE_URL +
# SECRET_KEY, so wire them from the test URL unless callers set otherwise.
# Under xdist, force DATABASE_URL to the worker DB (overriding any base value
# the CI env exported) so the app engine and the test fixtures share one DB.
if os.environ.get("PYTEST_XDIST_WORKER"):
    os.environ["DATABASE_URL"] = _TEST_DATABASE_URL
os.environ.setdefault("DATABASE_URL", _TEST_DATABASE_URL)

# admin_db_session() (app/tasks/rls_helpers.py) opens its own engine on
# ALEMBIC_DATABASE_URL — the owner role that bypasses RLS. Unlike DATABASE_URL
# that was never pinned here, so on any machine with backend/.env populated it
# resolved to the developer's *development* database on :5432. Four tests then
# ran against the wrong database and failed on credentials, which reads like a
# broken suite to anyone who has ever configured the app locally.
#
# Forced, not setdefault: a stale value in the environment is exactly the
# problem, and tests must never reach a real database.
os.environ["ALEMBIC_DATABASE_URL"] = _TEST_DATABASE_URL
os.environ.setdefault(
    "SECRET_KEY",
    "test-secret-key-not-used-for-signing-anything-in-a-real-environment",
)


from app.database import Base, _current_session  # noqa: E402


# ---------------------------------------------------------------------------
# Markers
# ---------------------------------------------------------------------------

def pytest_configure(config):
    config.addinivalue_line("markers", "unit: Unit-level tests (historical marker)")
    config.addinivalue_line(
        "markers",
        "postgres: Historical marker from the SQLite-split era — now a no-op "
        "since every test runs against postgres.",
    )
    config.addinivalue_line("markers", "performance: Performance benchmark tests")


# ---------------------------------------------------------------------------
# Session engine
# ---------------------------------------------------------------------------

# Every schema that holds a table. dam, exhibit and reporting used to be in
# this list and were always empty — see docker/postgres/init-db.sh.
_SCHEMAS = (
    "collections",
    "content",
    "flow",
    "media",
    "reports",
)

# pg_trgm is required by the trigram indexes the models declare for ILIKE
# search. The test schema is built with create_all(), not by running the
# migrations, so the migration that installs the extension never runs here —
# without this every test errored on "operator class gin_trgm_ops does not
# exist".
_EXTENSIONS = ("vector", "postgis", "pg_trgm")


def _dedupe_indexes(metadata) -> None:
    """Some models declare both `index=True` on a column and an explicit
    `Index(...)` in `__table_args__` covering the same column set. Postgres
    tolerates the duplicates, but this keeps create_all tidy.

    Two indexes are duplicates only when they are functionally identical:
    same expressions, same uniqueness, same partial-index predicate. The
    expression list must come from `idx.expressions` — `idx.columns` holds
    only plain Column elements, so a text() expression like
    COALESCE(object_type, '') is invisible there. Keying on column names
    alone made partial unique indexes (uq_user_layout_active,
    ix_doc_templates_default, ix_jobs_schedule_time_dedup,
    ix_transformers_dataset_format_active) collide with plain indexes on
    the same columns; `table.indexes` is a set, so WHICH of the pair
    survived was PYTHONHASHSEED-dependent and the constraint randomly
    vanished from every create_all schema in the process — including
    test modules with their own engines (the
    test_single_active_variant_enforced flake). Iteration is sorted so
    the survivor of a true duplicate pair is deterministic.
    """
    seen = set()
    to_remove = []
    for table in metadata.tables.values():
        for idx in sorted(table.indexes, key=lambda i: i.name or ""):
            exprs = tuple(sorted(str(e) for e in idx.expressions))
            where = idx.dialect_kwargs.get("postgresql_where")
            key = (
                table.fullname,
                exprs,
                bool(idx.unique),
                str(where) if where is not None else None,
            )
            if key in seen:
                to_remove.append((table, idx))
            else:
                seen.add(key)
    for table, idx in to_remove:
        table.indexes.discard(idx)


_RLS_TEST_ROLE = "madrona_app"
_RLS_GRANTED_SCHEMAS = ("public", "collections", "flow", "media", "reports", "content")


def _grant_madrona_app_for_tests(engine) -> None:
    """Create + grant the NOBYPASSRLS runtime role in the test DB.

    Mirrors the prod-bootstrap migration (20260213_0100_rls_role_separation.py)
    that runs alongside alembic in real deployments. Without this, a
    ``SET ROLE madrona_app`` inside a test would get
    ``InsufficientPrivilege: permission denied for table ...`` instead of
    hitting the RLS policy. The grants are idempotent (PG `GRANT` is a no-op
    if the privilege already exists) and scoped to the schemas the test
    suite actually creates.

    Creates the role if missing — needed because the CI postgres image
    starts without it, and at least one other test module
    (test_rls_force_integration) lazily creates it later in the
    session. Without this helper preemptively making the role, my
    session-scoped grant would skip silently and later tests using
    rls_db_session would SET ROLE successfully (role exists by then)
    but INSERT with `permission denied` because grants never applied.
    """
    # Role creation runs on its OWN autocommit connection, outside the grant
    # transaction below. If it raised inside that transaction the transaction
    # would be aborted, and every statement after it — including the pg_roles
    # check that decides whether grants can proceed — would fail with
    # "current transaction is aborted, commands ignored until end of
    # transaction block". Recovering from a lost race requires not being in
    # the poisoned transaction in the first place.
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        # A failure here does NOT mean the role is unavailable, so do not
        # return on it. `IF NOT EXISTS ... CREATE ROLE` is not atomic: two
        # xdist workers reaching it together both see the role missing and
        # both try to create it, and the loser gets
        #   duplicate key value violates unique constraint "pg_authid_rolname_index"
        # even though the role now exists and grants should proceed. Returning
        # on that left the loser's database with the role but no privileges,
        # which is precisely the "role 'madrona_app' missing or lacks SELECT
        # on audit_logs" failure that made the strict-RLS tests error out in
        # CI while passing locally (locally the role is pre-created by
        # docker/postgres/init-db.sh, so the branch never runs and never
        # races). Ask pg_roles below, and let that be the answer.
        try:
            conn.execute(text(
                "DO $$ BEGIN "
                f"IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{_RLS_TEST_ROLE}') THEN "
                f"CREATE ROLE {_RLS_TEST_ROLE} LOGIN PASSWORD 'madrona_app_test' NOBYPASSRLS; "
                "END IF; END $$;"
            ))
        except Exception as exc:
            # Genuinely unable to create it (non-superuser against a managed
            # DB) or simply lost the race. Say which, rather than swallowing
            # it — this was silent, and the silence cost a long diagnosis.
            print(f"CREATE ROLE {_RLS_TEST_ROLE} did not succeed here: {exc}")

    with engine.begin() as conn:
        role_exists = conn.execute(
            text("SELECT 1 FROM pg_roles WHERE rolname = :r"),
            {"r": _RLS_TEST_ROLE},
        ).fetchone()
        if not role_exists:
            return
        for schema in _RLS_GRANTED_SCHEMAS:
            schema_exists = conn.execute(
                text(
                    "SELECT 1 FROM information_schema.schemata "
                    "WHERE schema_name = :s"
                ),
                {"s": schema},
            ).fetchone()
            if not schema_exists:
                continue
            conn.execute(text(f'GRANT USAGE ON SCHEMA "{schema}" TO {_RLS_TEST_ROLE}'))
            conn.execute(text(
                f'GRANT SELECT, INSERT, UPDATE, DELETE '
                f'ON ALL TABLES IN SCHEMA "{schema}" TO {_RLS_TEST_ROLE}'
            ))
            conn.execute(text(
                f'GRANT USAGE, SELECT '
                f'ON ALL SEQUENCES IN SCHEMA "{schema}" TO {_RLS_TEST_ROLE}'
            ))


def _seed_rls_policies_for_tests(engine) -> None:
    """Apply the production RLS seed against the test DB.

    The test DB setup uses Base.metadata.create_all() directly (not alembic),
    so it misses RLS just like a fresh alembic-only deploy does. Call the
    production seed with DATABASE_URL pointed at the test DB so tests
    exercise the same tenant-isolation surface as prod.
    """
    import os
    prev = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = _TEST_DATABASE_URL
    try:
        from seeds.seed_rls_policies import seed_rls_policies
        seed_rls_policies()
    finally:
        if prev is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = prev


# Cluster-wide advisory-lock key serializing the heavy schema DDL across
# pytest-xdist workers (see _serialize_schema_ddl). Arbitrary but stable.
_XDIST_DDL_LOCK_KEY = 7_280_419


def _maintenance_engine(engine):
    """An engine on a database every xdist worker shares.

    Advisory locks are NOT cluster-scoped — they are per-database. Verified:
    while a session in database A holds key K, another session in A gets
    false from pg_try_advisory_lock(K) while a session in database B gets
    true. Since each worker runs against its own database (madrona_test_gw0,
    _gw1, ...), a lock taken on the worker's own database serializes nothing
    between workers.

    So take it somewhere shared. `postgres` is the maintenance database every
    server has and no worker owns.
    """
    url = engine.url.set(database="postgres")
    return create_engine(url, poolclass=NullPool, future=True)


@contextmanager
def _serialize_schema_ddl(engine):
    """Serialize schema build/teardown across pytest-xdist workers.

    Each worker has its own database, but `DROP SCHEMA ... CASCADE` and
    `create_all` over the full multi-schema model grab enough locks that two
    workers doing it at once exhaust the server-global lock table ("out of
    shared memory"). Holding one advisory lock serializes just the DDL; tests
    still run in parallel once their schema is in place. No-op for serial runs.

    The lock is taken on the shared maintenance database, not the worker's
    own — see _maintenance_engine. This function previously took it on the
    worker's database, on the stated but incorrect belief that advisory locks
    are cluster-scoped, which made it a no-op between workers. Two things
    followed from that: the lock-table exhaustion it exists to prevent had to
    be worked around separately by raising max_locks_per_transaction to 1024
    in CI, and concurrent CREATE ROLE in _grant_madrona_app_for_tests raced.
    """
    if not os.environ.get("PYTEST_XDIST_WORKER"):
        yield
        return
    try:
        lock_engine = _maintenance_engine(engine)
        lock_conn = lock_engine.connect().execution_options(isolation_level="AUTOCOMMIT")
    except Exception:
        # No access to the maintenance database. Degrade to the worker's own
        # connection: useless for cross-worker serialization, but no worse
        # than what this did before, and better than failing the run.
        lock_engine = None
        lock_conn = engine.connect().execution_options(isolation_level="AUTOCOMMIT")
    try:
        lock_conn.execute(text("SELECT pg_advisory_lock(:k)"), {"k": _XDIST_DDL_LOCK_KEY})
        yield
    finally:
        try:
            lock_conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": _XDIST_DDL_LOCK_KEY})
        finally:
            lock_conn.close()
            if lock_engine is not None:
                lock_engine.dispose()


def _terminate_stray_connections(engine):
    """Close every other client connection to this test database.

    Called by test_engine's teardown just before it drops the schemas. DROP
    needs an exclusive lock, so one connection left open in a transaction — a
    leak from some test or code path — made the teardown wait until
    pytest-timeout killed it at 120 s. That failed a shard whose tests had all
    passed, and blamed whichever test the worker ran last (#14).

    The database is about to be thrown away, so stray connections are
    terminated rather than waited on. Each is reported first, with what it was
    doing: the leak should stay visible, not be silently papered over.

    Only client backends on the current database are touched — not this
    connection, not other xdist workers (each has its own database), and not
    the maintenance-database connection holding _serialize_schema_ddl's lock.
    """
    with engine.connect() as conn:
        stray = conn.execute(
            text(
                "SELECT pid, state, now() - state_change, left(query, 200) "
                "FROM pg_stat_activity "
                "WHERE datname = current_database() "
                "AND pid <> pg_backend_pid() "
                "AND backend_type = 'client backend'"
            )
        ).fetchall()
        for pid, state, in_state, query in stray:
            warnings.warn(
                f"test teardown: terminating a connection still open on the test "
                f"database (pid {pid}, {state} for {in_state}): {query!r}",
                stacklevel=1,
            )
            conn.execute(text("SELECT pg_terminate_backend(:pid)"), {"pid": pid})
        conn.commit()


@pytest.fixture(scope="session")
def test_engine():
    """Session-scoped postgres engine with schemas + extensions + full schema."""
    engine = create_engine(_TEST_DATABASE_URL, poolclass=NullPool, future=True)

    with _serialize_schema_ddl(engine):
        with engine.begin() as conn:
            for ext in _EXTENSIONS:
                try:
                    conn.execute(text(f"CREATE EXTENSION IF NOT EXISTS {ext}"))
                except Exception as exc:
                    # PostGIS in particular can be missing at the OS level on some
                    # postgres images. Fail loudly with a clear message.
                    raise RuntimeError(
                        f"Required extension '{ext}' could not be installed: {exc}. "
                        f"The test image needs postgresql-16-{ext} (or equivalent) "
                        f"installed before running the suite."
                    ) from exc

            for schema in _SCHEMAS:
                conn.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
                conn.execute(text(f'CREATE SCHEMA "{schema}"'))

        import app.models  # noqa: F401  — populate Base.metadata
        _dedupe_indexes(Base.metadata)
        Base.metadata.create_all(engine)

        # Mirror prod bootstrap: apply RLS policies after schema is in place.
        # Without this the test DB has no tenant isolation and the RLS coverage
        # tests (tests/postgres/test_rls_coverage.py) fail. Idempotent seed.
        _seed_rls_policies_for_tests(engine)

        # Grant the prod runtime role (`madrona_app`, NOBYPASSRLS) the same
        # permissions it has in staging/prod, so the rls_db_session fixture
        # below can `SET ROLE madrona_app` and have RLS policies actually
        # enforce. The prod migration that grants these permissions
        # (20260213_0100_rls_role_separation.py) doesn't run in the test
        # bootstrap (which uses Base.metadata.create_all, not alembic), so
        # we apply the grants manually here.
        _grant_madrona_app_for_tests(engine)

    yield engine

    # Teardown: the model has mutual FKs (object_entries↔object_exits,
    # runs↔jobs) that postgres handles fine at runtime with deferred
    # constraints but that SQLAlchemy's topo-sort for drop_all can't
    # linearize. DROP SCHEMA CASCADE sidesteps the sort entirely and is
    # equivalent for a test DB we're going to throw away anyway.
    with _serialize_schema_ddl(engine):
        _terminate_stray_connections(engine)
        with engine.begin() as conn:
            conn.execute(text('DROP TABLE IF EXISTS public.alembic_version'))
            for schema in _SCHEMAS:
                conn.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
            # Public has the app's cross-schema tables (users, organizations, …);
            # drop by cascading name rather than nuking schema public itself.
            conn.execute(
                text(
                    "DO $$ DECLARE r record; BEGIN "
                    "FOR r IN SELECT tablename FROM pg_tables "
                    "WHERE schemaname='public' AND tablename NOT IN "
                    "('spatial_ref_sys','geography_columns','geometry_columns') "
                    "LOOP "
                    "EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) "
                    "|| ' CASCADE'; "
                    "END LOOP; END $$;"
                )
            )
    engine.dispose()


@pytest.fixture(scope="session")
def test_session_factory(test_engine):
    return sessionmaker(
        bind=test_engine, autoflush=False, autocommit=False, expire_on_commit=False
    )


# ---------------------------------------------------------------------------
# Per-test session with transaction rollback
# ---------------------------------------------------------------------------


@pytest.fixture()
def db_session(test_engine, test_session_factory):
    """Per-test session wrapped in a connection-scope transaction.

    The connection opens a real transaction; the Session runs inside a
    nested SAVEPOINT so that anything the test commits gets rolled back on
    teardown. This avoids per-test `create_all`/`drop_all` and still gives
    clean isolation.
    """
    connection = test_engine.connect()
    outer_tx = connection.begin()
    connection.begin_nested()

    session = test_session_factory(bind=connection)

    # If the app code commits, SQLAlchemy ends the savepoint. Re-open a new
    # savepoint on each commit so the outer transaction can still be rolled
    # back at the end.
    @event.listens_for(session, "after_transaction_end")
    def _restart_savepoint(sess, transaction):
        if transaction.nested and not transaction._parent.nested:
            connection.begin_nested()

    token = _current_session.set(session)
    try:
        yield session
    finally:
        _current_session.reset(token)
        # Detach the after_transaction_end listener so the closing rollback
        # doesn't accidentally try to open a fresh savepoint on a torn-down
        # connection. Without this, ROLLBACK TO SAVEPOINT during teardown
        # races against handler commits and surfaces as
        # `InvalidSavepointSpecification: savepoint "sa_savepoint_N" does
        # not exist` — the test itself passes but pytest reports a teardown
        # error.
        try:
            event.remove(session, "after_transaction_end", _restart_savepoint)
        except Exception:
            pass
        try:
            session.close()
        except Exception:
            pass
        try:
            outer_tx.rollback()
        except Exception:
            pass
        try:
            connection.close()
        except Exception:
            pass


# Backward-compat alias for tests that expect `postgres_session`.
@pytest.fixture()
def postgres_session(db_session):
    return db_session


@pytest.fixture()
def postgres_engine(test_engine):
    return test_engine


# ---------------------------------------------------------------------------
# Strict-RLS test session
# ---------------------------------------------------------------------------
#
# The default ``db_session`` connects as the Postgres superuser (madrona),
# which bypasses RLS regardless of policy strictness. That mismatch with
# production hid three latent 500s in May 2026 (audit-log INSERT in
# login_mfa, login, mfa_setup_*) — every one of them depended on RLS
# actually enforcing in the affected code path.
#
# ``rls_db_session`` switches to the production runtime role
# ``madrona_app`` (NOBYPASSRLS) inside the test's outer transaction. RLS
# policies now actually fire, so a test that exercises an endpoint with
# a broken RLS-bootstrap will surface the same error production sees.
#
# Use this fixture for:
#   * any test of /api/auth/* that flushes the session (audit_logs etc.)
#   * any test that wants to verify RLS isolation between orgs
#   * the full-flow integration test (P2)
#
# Keep using plain ``db_session`` for tests that need cross-org reads,
# tests that deliberately bypass RLS (platform-admin paths), and
# fixture-setup code that seeds data across orgs.


def _is_madrona_app_available(engine) -> bool:
    """True only when the role exists AND has SELECT on a canonical
    RLS-protected table.

    Checking grants matters because otherwise the rls_db_session
    fixture would happily `SET ROLE madrona_app` and let the test
    proceed under a role that has no table access — every assertion
    downstream would then trip `permission denied` and the test
    would *fail*, but for an infrastructure reason, not an RLS one.
    Better to surface the grant gap with a clear skip message during
    fixture init than to let it look like a real RLS regression.
    """
    with engine.connect() as c:
        role_exists = bool(c.execute(
            text("SELECT 1 FROM pg_roles WHERE rolname = :r"),
            {"r": _RLS_TEST_ROLE},
        ).fetchone())
        if not role_exists:
            return False
        # Probe a canonical table grant. `audit_logs` is the central
        # RLS-protected table used by every strict-RLS test; if the
        # role has SELECT here it has the grants the rest of the
        # suite needs.
        has_grant = bool(c.execute(
            text(
                "SELECT 1 FROM information_schema.role_table_grants "
                "WHERE grantee = :r AND table_name = 'audit_logs' "
                "AND privilege_type = 'SELECT'"
            ),
            {"r": _RLS_TEST_ROLE},
        ).fetchone())
        return has_grant


@pytest.fixture()
def rls_db_session(test_engine, test_session_factory):
    """db_session variant that enforces RLS via SET ROLE madrona_app.

    Identical savepoint pattern to ``db_session`` (commits roll back at
    teardown), but with ``SET ROLE`` applied to the underlying connection
    so RLS policies are actually enforced for the duration of the test.
    """
    if not _is_madrona_app_available(test_engine):
        message = (
            f"role {_RLS_TEST_ROLE!r} missing or lacks SELECT on audit_logs — "
            "strict-RLS tests can't run. Check that _grant_madrona_app_for_tests "
            "was able to create the role and apply grants against this Postgres "
            "instance (requires SUPERUSER on the test DB)."
        )
        # Fail, don't skip.
        #
        # These are the only tests that exercise RLS as the application role;
        # everything else runs as superuser and bypasses policy entirely. If
        # this setup breaks, a skip turns "tenant isolation is unverified" into
        # a green run, which is how the gap survived. Fail loudly instead, with
        # a documented escape hatch for environments that genuinely cannot
        # create roles (a managed Postgres without SUPERUSER).
        if os.environ.get("MADRONA_ALLOW_MISSING_RLS_ROLE") == "1":
            pytest.skip(message + " (skipped via MADRONA_ALLOW_MISSING_RLS_ROLE=1)")
        pytest.fail(
            message
            + " Set MADRONA_ALLOW_MISSING_RLS_ROLE=1 to downgrade this to a "
            "skip if your environment cannot provision the role."
        )

    connection = test_engine.connect()
    outer_tx = connection.begin()
    # `SET ROLE` is connection-scoped; applying it on the outer tx means
    # every savepoint inside inherits the role. RESET ROLE at teardown
    # is belt-and-suspenders — closing the connection drops the role
    # automatically.
    connection.execute(text(f"SET ROLE {_RLS_TEST_ROLE}"))
    connection.begin_nested()

    session = test_session_factory(bind=connection)

    @event.listens_for(session, "after_transaction_end")
    def _restart_savepoint(sess, transaction):
        if transaction.nested and not transaction._parent.nested:
            connection.begin_nested()

    token = _current_session.set(session)
    try:
        yield session
    finally:
        _current_session.set(None)
        try:
            event.remove(session, "after_transaction_end", _restart_savepoint)
        except Exception:
            pass
        try:
            session.close()
        except Exception:
            pass
        try:
            connection.execute(text("RESET ROLE"))
        except Exception:
            pass
        try:
            outer_tx.rollback()
        except Exception:
            pass
        try:
            connection.close()
        except Exception:
            pass


@pytest.fixture(scope="session")
def _session_test_client(app):
    """One TestClient (and its AnyIO portal) shared across the whole session.

    TestClient.__enter__ spawns a persistent AnyIO blocking-portal thread.
    Entering/exiting it per test made __exit__ hang on portal shutdown for
    EVERY client-using test — a hang isn't an exception, so the fixtures'
    `except: pass` did nothing, and pytest-timeout burned the full 30s on
    each teardown, making the suite crawl and look wedged ~23% in
    (#46 / #36).

    The app has no ASGI lifespan/startup/shutdown handlers, so a single
    shared portal is functionally identical to a per-test one — every
    request still runs on one stable portal thread, which the
    connection-bound test-session pattern requires (per-request portals
    run handlers on fresh threads and deadlock the bound connection).

    Net: the portal is created once and the __exit__ hang can happen at
    most once, at session end — and even that is bounded so it can never
    block CI. Per-test fixtures reuse this client and just swap
    dependency_overrides + scrub cookies between tests.
    """
    from starlette.testclient import TestClient
    import threading

    tc = TestClient(app)
    tc.__enter__()
    try:
        yield tc
    finally:
        # tc.__exit__() stops the portal, which can hang on thread.join().
        # Run it in a daemon thread with a hard cap: if it doesn't return
        # quickly, abandon it. We're at process exit; a leaked daemon
        # thread is harmless and infinitely preferable to a hung CI job.
        done = threading.Event()

        def _shutdown():
            try:
                tc.__exit__(None, None, None)
            except Exception:
                pass
            finally:
                done.set()

        threading.Thread(target=_shutdown, daemon=True).start()
        done.wait(timeout=10)


@pytest.fixture()
def rls_client(app, rls_db_session, test_session_factory, _session_test_client):
    """Test client whose request-scoped sessions match production roles.

    Single connection, two role profiles, switched per dependency:
      * `get_db` requests → SET ROLE madrona_app (NOBYPASSRLS). Endpoints
        that read or write under the user's org context hit real RLS.
      * `get_admin_db` requests → RESET ROLE (= test superuser, BYPASSRLS).
        Matches the prod admin_db_session pool which uses the owner role.

    Using one connection means a commit by rls_db_session is visible to
    subsequent admin_db reads (the prod case where the saga writes via
    owner role and the customer flow reads via app role — they see the
    same database). At the SQL level we toggle ROLE per-request rather
    than maintaining two connections in separate transactions whose
    isolation would diverge.

    Use with `rls_db_session` for seeding.
    """
    from app.database import get_admin_db, get_db, _current_session
    from app.fastapi_app.routers.platform_admin import _admin_db_dep

    connection = rls_db_session.connection()

    def _make_test_session():
        session = test_session_factory(bind=connection)
        session.begin_nested()

        @event.listens_for(session, "after_transaction_end")
        def _restart(sess, transaction):
            if transaction.nested and not transaction._parent.nested:
                sess.begin_nested()

        return session, _restart

    async def _override_get_db():
        # async, matching the real get_db, and for the same reason: FastAPI runs
        # a sync generator dependency in a worker thread, so a ContextVar set
        # there never reaches the endpoint. A sync override here would leave the
        # suite exercising the broken propagation the app no longer has, and the
        # family of "No database session available" 500s would stay invisible.
        #
        # rls_db_session already SET ROLE madrona_app on the connection;
        # this dep just hands out a session bound to that connection so
        # RLS is enforced.
        session, restart_handler = _make_test_session()
        _current_session.set(session)
        try:
            yield session
        finally:
            _current_session.set(None)
            event.remove(session, "after_transaction_end", restart_handler)
            session.close()

    def _override_admin_db():
        # BYPASSRLS for the duration of this dep: RESET ROLE before
        # yielding, restore madrona_app after. Matches production where
        # the admin_db pool uses the owner role.
        connection.execute(text("RESET ROLE"))
        session, restart_handler = _make_test_session()
        try:
            yield session
        finally:
            event.remove(session, "after_transaction_end", restart_handler)
            session.close()
            try:
                connection.execute(text(f"SET ROLE {_RLS_TEST_ROLE}"))
            except Exception:
                pass

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[_admin_db_dep] = _override_admin_db
    app.dependency_overrides[get_admin_db] = _override_admin_db
    tc = _session_test_client
    # Shared client: scrub cookies so a prior test's auth/csrf cookies
    # don't bleed in. The _FlaskLikeTestClient ctor re-seeds a fresh
    # per-test csrf cookie on the now-clean jar.
    tc.cookies.clear()
    try:
        yield _FlaskLikeTestClient(tc)
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(_admin_db_dep, None)
        app.dependency_overrides.pop(get_admin_db, None)
        tc.cookies.clear()


def _engine_from_session(session):
    """Pull the bind's engine off a Session for a fresh connection."""
    return session.bind.engine if hasattr(session.bind, "engine") else session.bind


@pytest.fixture(autouse=True)
def _stub_s3_presigning(monkeypatch):
    """Stop tests from calling real boto3/S3.

    Several routers serialize media via ``app.services.uploads.get_org_media_url``,
    which in turn falls back to ``boto3.client("s3").generate_presigned_url``.
    On a CI runner with no AWS credentials that raises ``NoCredentialsError``
    and turns into a 500 — masking the assertion the test was actually trying
    to make. Stub the leaf S3 helpers so every test gets a stable fake URL
    without needing per-test ``@patch`` decorators.

    Tests that explicitly want to exercise the S3 code path can patch it back
    locally; this fixture only fills the default.

    The fake URL embeds the key it was asked for. It used to be one constant
    string for every object, which made "this URL points at that object"
    unassertable — tests that checked it (test_media_display_url.py,
    test_tasks_media_coverage.py) failed against the stub rather than against
    the code, and stayed red. A presigned URL contains its key in reality, so
    echoing it keeps the stub honest and those assertions meaningful."""
    fake_host = "https://test-bucket.s3.amazonaws.com"

    def _fake_url_for(key: str | None) -> str:
        """Shape a presigned URL the way S3 does: the key is in the path."""
        if not key:
            return f"{fake_host}/fake-presigned"
        return f"{fake_host}/{key}?X-Amz-Signature=fake-presigned"

    fake_url = _fake_url_for(None)

    class _FakeS3Client:
        def generate_presigned_url(self, *_args, **kwargs):
            # boto3 signature: generate_presigned_url(ClientMethod, Params={...})
            return _fake_url_for((kwargs.get("Params") or {}).get("Key"))

        def generate_presigned_post(self, *args, **kwargs):
            # boto3 signature: generate_presigned_post(Bucket, Key, ...)
            key = kwargs.get("Key") or (args[1] if len(args) > 1 else None)
            return {"url": _fake_url_for(key), "fields": {}}

        def head_object(self, *_args, **_kwargs):
            return {"ContentLength": 0}

        def delete_object(self, *_args, **_kwargs):
            return {}

        def copy_object(self, *_args, **_kwargs):
            return {}

    def _fake_get_s3_client(*_args, **_kwargs):
        return _FakeS3Client()

    monkeypatch.setattr(
        "app.services.uploads.get_s3_client", _fake_get_s3_client, raising=False
    )

    # Storage backend abstraction also calls into boto3 for BYOB orgs.
    try:
        from app.services import storage as _storage_mod

        class _FakeStorage:
            def generate_presigned_download_url_sync(self, key=None, expires_in=None, **_kw):
                return _fake_url_for(key)

            def generate_presigned_upload_url_sync(self, *args, **kwargs):
                key = kwargs.get("key") or (args[0] if args else None)
                return {"url": _fake_url_for(key), "fields": {}}

            async def generate_presigned_download_url(self, *args, **kwargs):
                key = kwargs.get("key") or (args[0] if args else None)
                return _fake_url_for(key)

        monkeypatch.setattr(
            _storage_mod, "get_storage_backend", lambda *a, **kw: _FakeStorage()
        )
    except Exception:
        # If the storage module isn't importable for some reason, skip the
        # patch silently — the s3-client stub above still covers most paths.
        pass


# ---------------------------------------------------------------------------
# FastAPI app + test client
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def app(test_engine, test_session_factory):
    """Session-scoped FastAPI app bound to the test engine.

    FastAPI compiles each route's Pydantic schema lazily on first dispatch,
    which can take >10s for routes with deep Annotated types. Without warmup
    the *first* test in any file pays that cost and blows past pytest-timeout,
    cascading errors through every dependent test in the same class/file.
    Eagerly resolving each route's `dependant` here pre-builds the schemas
    once per session so individual tests stay snappy.
    """
    import app.database as _db_mod

    original_engine = _db_mod._engine
    original_factory = _db_mod._SessionLocal
    _db_mod._engine = test_engine
    _db_mod._SessionLocal = test_session_factory
    try:
        from app.asgi import create_app as _create_app
        from fastapi.routing import APIRoute

        application = _create_app()
        # Touch each APIRoute's dependant so FastAPI builds the response/body
        # ModelFields up front. `route.dependant` is built at registration time;
        # the slow path is `route.body_field` / `route.response_field`, both of
        # which are cached on first access. Accessing them triggers compilation.
        for route in application.routes:
            if isinstance(route, APIRoute):
                _ = route.body_field
                _ = route.response_field
        yield application
    finally:
        _db_mod._engine = original_engine
        _db_mod._SessionLocal = original_factory


class _FlaskLikeResponse:
    """Adds Flask-style `.get_json()` and `.json` property to httpx responses.

    Retained because the existing test suite was written before the FastAPI
    migration and reaches for both shapes.
    """

    def __init__(self, response):
        self._response = response

    def get_json(self):
        return self._response.json()

    @property
    def json(self):
        return self._response.json()

    def __getattr__(self, name):
        return getattr(self._response, name)


class _FlaskLikeTestClient:
    # State-changing /api/* requests run through CSRFMiddleware (see
    # app/fastapi_app/middleware/csrf.py). We seed a csrf_token cookie at
    # construction time and auto-inject the matching X-CSRF-Token header on
    # every outgoing request so ordinary tests don't have to. Tests that
    # specifically cover missing/mismatched CSRF can pass their own
    # `headers={"X-CSRF-Token": ...}` or clear the cookie via
    # `client.delete_cookie("csrf_token")`.
    _STATE_CHANGING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

    def __init__(self, test_client):
        self._client = test_client
        import secrets as _secrets
        self._csrf_token = _secrets.token_urlsafe(32)
        try:
            self._client.cookies.set("csrf_token", self._csrf_token, path="/")
        except Exception:
            pass

    def _wrap(self, response):
        return _FlaskLikeResponse(response)

    def _auto_csrf(self, method, kwargs):
        if method not in self._STATE_CHANGING_METHODS:
            return kwargs
        # Only auto-inject when the test didn't provide its own token.
        headers = kwargs.get("headers") or {}
        if not any(k.lower() == "x-csrf-token" for k in headers):
            headers = {**headers, "X-CSRF-Token": self._csrf_token}
            kwargs["headers"] = headers
        return kwargs

    @staticmethod
    def _flask_kwargs(kwargs):
        # Flask's test client used `query_string=`; httpx uses `params=`.
        if "query_string" in kwargs:
            kwargs["params"] = kwargs.pop("query_string")
        # Flask's test client accepted `data=<str>, content_type="..."`
        # for JSON bodies. httpx treats `data=` as form-encoded. Without
        # translating the kwargs, the body arrives form-encoded and
        # ContentTypeMiddleware rejects it with 415.
        content_type = kwargs.pop("content_type", None)
        if content_type == "application/json" and isinstance(
            kwargs.get("data"), (str, bytes)
        ):
            body = kwargs.pop("data")
            if isinstance(body, bytes):
                body = body.decode()
            # Always send the raw body with an explicit Content-Type so the
            # server gets exactly what the test wrote. Using httpx's `json=`
            # would re-serialize and would drop None / "null" bodies entirely.
            headers = kwargs.pop("headers", {}) or {}
            headers.setdefault("Content-Type", content_type)
            kwargs["content"] = body
            kwargs["headers"] = headers
        elif content_type == "multipart/form-data" and isinstance(kwargs.get("data"), dict):
            # Flask-style: data={"field": (BytesIO, filename)} or data={"field": (BytesIO, filename, ctype)}.
            # httpx takes `files=` for multipart; let it set the boundary header itself.
            data = kwargs.pop("data")
            files = {}
            form = {}
            for key, val in data.items():
                if isinstance(val, tuple):
                    if len(val) == 2:
                        stream, filename = val
                        files[key] = (filename, stream.read() if hasattr(stream, "read") else stream)
                    elif len(val) == 3:
                        stream, filename, ctype = val
                        files[key] = (filename, stream.read() if hasattr(stream, "read") else stream, ctype)
                else:
                    form[key] = val
            if files:
                kwargs["files"] = files
                if form:
                    kwargs["data"] = form
            elif form:
                kwargs["data"] = form
        elif content_type:
            headers = kwargs.pop("headers", {}) or {}
            headers.setdefault("Content-Type", content_type)
            kwargs["headers"] = headers
        kwargs.setdefault("follow_redirects", False)
        return kwargs

    def get(self, url, **kwargs):
        return self._wrap(self._client.get(url, **self._flask_kwargs(kwargs)))

    def post(self, url, **kwargs):
        return self._wrap(
            self._client.post(url, **self._flask_kwargs(self._auto_csrf("POST", kwargs)))
        )

    def put(self, url, **kwargs):
        return self._wrap(
            self._client.put(url, **self._flask_kwargs(self._auto_csrf("PUT", kwargs)))
        )

    def patch(self, url, **kwargs):
        return self._wrap(
            self._client.patch(url, **self._flask_kwargs(self._auto_csrf("PATCH", kwargs)))
        )

    def delete(self, url, **kwargs):
        # httpx.Client.delete() does not accept json= or content= kwargs.
        # The generic request() method does. Several DELETE endpoints in
        # this codebase accept request bodies (bulk-action removes,
        # role-permission unlinks), so we route through request() to keep
        # the surface Flask-shaped.
        return self._wrap(
            self._client.request(
                "DELETE",
                url,
                **self._flask_kwargs(self._auto_csrf("DELETE", kwargs)),
            )
        )

    def head(self, url, **kwargs):
        return self._wrap(self._client.head(url, **self._flask_kwargs(kwargs)))

    def options(self, url, **kwargs):
        return self._wrap(self._client.options(url, **self._flask_kwargs(kwargs)))

    # Flask-style cookie helpers used by the legacy auth test suite.
    def set_cookie(self, name, value, **kwargs):
        # Flask's test client accepts (name, value, domain=..., path=...);
        # httpx just wants name/value on the session cookie jar.
        self._client.cookies.set(name, value, path=kwargs.get("path", "/"))

    def delete_cookie(self, name, **kwargs):
        self._client.cookies.delete(name)

    @property
    def cookies(self):
        return self._client.cookies


@pytest.fixture()
def client(app, db_session, test_session_factory, _session_test_client):
    """Test client whose app requests see data committed by the current test.

    The test's `db_session` runs inside a connection-scoped outer transaction
    with a nested SAVEPOINT; anything it commits is visible on that connection
    but NOT on a fresh pool connection. We route the app's `get_db` dependency
    through a per-request session bound to that same connection so requests
    observe the test's seeded data.
    """
    from app.database import get_admin_db, get_db, _current_session
    from app.fastapi_app.routers.platform_admin import _admin_db_dep

    connection = db_session.connection()

    def _override_get_db():
        # Hand every request the test's own db_session (already bound to this
        # connection with the savepoint-restart listener). One session for the
        # test seed AND every request means handler commits land at the
        # fixture savepoint level — visible to db_session re-queries and to
        # later requests in the same test — and roll back only when the
        # connection-scoped transaction tears down. A handler depending on
        # BOTH get_db and admin_db then shares one session instead of stacking
        # two sessions' savepoints on the one connection (issue #75), which
        # discarded the inner write on teardown.
        #
        # expire_all() at the request boundary drops the test's in-memory ORM
        # identity map so the handler reloads rows from the DB rather than
        # reusing the test's Python objects. Without it, values the test set
        # in memory (e.g. a tz-aware datetime seeded into a TIMESTAMP WITHOUT
        # TIME ZONE column) would leak into the handler instead of the
        # DB-shaped value it sees in production.
        db_session.expire_all()
        yield db_session

    def _override_admin_db():
        # Same single fixture session (see _override_get_db). admin_db is a
        # BYPASSRLS owner connection in production; under the non-RLS `client`
        # fixture both roles are the test superuser, so one session is faithful.
        db_session.expire_all()
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[_admin_db_dep] = _override_admin_db
    app.dependency_overrides[get_admin_db] = _override_admin_db
    tc = _session_test_client
    # Shared client: scrub cookies so a prior test's auth/csrf cookies
    # don't bleed in. The _FlaskLikeTestClient ctor re-seeds a fresh
    # per-test csrf cookie on the now-clean jar.
    tc.cookies.clear()
    try:
        yield _FlaskLikeTestClient(tc)
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(_admin_db_dep, None)
        app.dependency_overrides.pop(get_admin_db, None)
        tc.cookies.clear()


# ---------------------------------------------------------------------------
# Shared behavioral fixtures (rate limiting, mocks)
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _disable_rate_limiting():
    from unittest.mock import patch
    from app.services.rate_limiter import RateLimitResult

    with patch("app.services.rate_limiter.RateLimiter.allow", return_value=True):
        with patch(
            "app.services.rate_limiter.AuthRateLimiter.check_rate_limit"
        ) as mock_check:
            mock_check.return_value = RateLimitResult(
                allowed=True, remaining=100, retry_after=None
            )
            yield


@pytest.fixture(autouse=True)
def _stub_geocoding(monkeypatch):
    """Keep tests off the network: GeoNames geocoding returns a fast failure.

    With Celery eager (below), routes that enqueue geocode tasks (e.g. place
    authority create without coordinates) would otherwise make a live HTTP
    call to api.geonames.org inside the request. Tests that exercise
    geocoding behavior patch app.services.gis_service.geocode_address
    themselves, which overrides this stub.
    """
    from app.services.gis_service import GeocodeResult

    def _no_geocode(address, country_code=None, use_cache=True):
        return GeocodeResult(success=False, error="geocoding disabled in tests")

    monkeypatch.setattr(
        "app.services.gis_service.geocode_address", _no_geocode, raising=True
    )
    # Same guard for Getty SPARQL: the geocode task resolves tgn_id
    # coordinates through _execute_sparql. Empty bindings = "no results",
    # which every caller handles.
    monkeypatch.setattr(
        "app.services.getty_service._execute_sparql", lambda sparql: [], raising=True
    )


@pytest.fixture(autouse=True)
def _celery_eager(monkeypatch):
    """Configure Celery to run tasks in-process during tests.

    Without a broker in CI, task.delay() raises ConnectionError and routes
    that enqueue tasks return 500. With always_eager, .delay() invokes the
    task function directly; tests that mock the task's external deps
    (S3, FFmpeg, etc.) then work the same in CI as locally.
    """
    from app.celery_app import celery_app
    prev_eager = celery_app.conf.task_always_eager
    prev_propagate = celery_app.conf.task_eager_propagates
    celery_app.conf.task_always_eager = True
    # Don't propagate — so a failing task body doesn't surface in the
    # route response. Tests that care about task exceptions should patch
    # the task function directly.
    celery_app.conf.task_eager_propagates = False
    try:
        yield
    finally:
        celery_app.conf.task_always_eager = prev_eager
        celery_app.conf.task_eager_propagates = prev_propagate


@pytest.fixture
def mock_email_service():
    from unittest.mock import MagicMock, patch

    mock_service = MagicMock()
    mock_service.send_email.return_value = True
    with patch(
        "app.services.email_service.get_email_service", return_value=mock_service
    ):
        yield mock_service


@pytest.fixture
def mock_redis():
    try:
        import fakeredis
    except ImportError:
        pytest.skip("fakeredis not installed")

    from unittest.mock import patch
    from app.services.redis_client import RedisClient

    fake_server = fakeredis.FakeServer()
    fake_client = fakeredis.FakeStrictRedis(server=fake_server)

    mock_client = RedisClient.__new__(RedisClient)
    mock_client._client = fake_client
    mock_client._pool = None
    mock_client._redis_url = "redis://fake:6379/0"
    mock_client._pool_size = 10
    mock_client._cache_enabled = True
    mock_client._available = True
    mock_client._last_check = 0
    mock_client._check_interval = 30

    with patch("app.services.redis_client._redis_client", mock_client):
        with patch(
            "app.services.redis_client.get_redis_client", return_value=mock_client
        ):
            with patch(
                "app.services.scheduler.get_redis_client", return_value=mock_client
            ):
                with patch(
                    "app.services.rate_limiter.get_redis_client",
                    return_value=mock_client,
                ):
                    yield mock_client


@pytest.fixture
def disabled_redis():
    from unittest.mock import MagicMock, patch
    from app.services.redis_client import RedisClient

    mock_client = MagicMock(spec=RedisClient)
    mock_client.is_available.return_value = False
    mock_client.client = None
    mock_client._cache_enabled = False

    with patch("app.services.redis_client._redis_client", mock_client):
        with patch(
            "app.services.redis_client.get_redis_client", return_value=mock_client
        ):
            with patch(
                "app.services.scheduler.get_redis_client", return_value=mock_client
            ):
                with patch(
                    "app.services.rate_limiter.get_redis_client",
                    return_value=mock_client,
                ):
                    yield mock_client


@pytest.fixture
def mock_cognito():
    from unittest.mock import MagicMock, patch

    mock_client = MagicMock()
    mock_client.initiate_auth.return_value = {
        "AuthenticationResult": {
            "AccessToken": "mock-access-token",
            "IdToken": "mock-id-token",
            "RefreshToken": "mock-refresh-token",
            "ExpiresIn": 3600,
        }
    }
    mock_client.get_user.return_value = {
        "Username": "mock-cognito-sub",
        "UserAttributes": [
            {"Name": "email", "Value": "test@example.com"},
            {"Name": "sub", "Value": "mock-cognito-sub"},
        ],
    }
    with patch("app.services.cognito_service._get_client", return_value=mock_client):
        yield mock_client


# ---------------------------------------------------------------------------
# Authenticated client helpers
# ---------------------------------------------------------------------------


class AuthenticatedClient:
    def __init__(self, client, token: str):
        self._client = client
        self._token = token
        # CSRF cookie + X-CSRF-Token header is handled by the underlying
        # _FlaskLikeTestClient (set in __init__, auto-injected on every
        # state-changing request). We only add Authorization here.
        self._headers = {"Authorization": f"Bearer {token}"}

    def _merge_headers(self, kwargs):
        headers = kwargs.pop("headers", {})
        merged = {**self._headers, **headers}
        kwargs["headers"] = merged
        return kwargs

    def get(self, *args, **kwargs):
        return self._client.get(*args, **self._merge_headers(kwargs))

    def post(self, *args, **kwargs):
        return self._client.post(*args, **self._merge_headers(kwargs))

    def put(self, *args, **kwargs):
        return self._client.put(*args, **self._merge_headers(kwargs))

    def patch(self, *args, **kwargs):
        return self._client.patch(*args, **self._merge_headers(kwargs))

    def delete(self, *args, **kwargs):
        return self._client.delete(*args, **self._merge_headers(kwargs))


def _create_permission(db_session, key: str):
    """Get-or-create a Permission row for tests.

    Two fixtures (auth_setup + viewer_auth_setup) both need to seed
    permissions, and several tests depend on them together. Both lists
    intentionally overlap on baseline keys (collections.view, etc.). A
    pure-create helper would UniqueViolation on the second fixture; a
    select-then-insert preserves the test's invariants without changing
    production behavior."""
    from app.models import Permission as PermissionModel

    existing = (
        db_session.query(PermissionModel)
        .filter(PermissionModel.permission_key == key)
        .first()
    )
    if existing is not None:
        return existing

    scope, action = key.rsplit(".", 1) if "." in key else (key, "view")
    perm = PermissionModel(
        permission_key=key,
        scope=scope,
        action=action,
        display_name=key.replace(".", " ").title(),
        description=f"Permission for {key}",
    )
    db_session.add(perm)
    db_session.flush()
    return perm


def _create_role_permission(db_session, role, permission):
    from app.models import RolePermission

    rp = RolePermission(
        role_id=role.role_id, permission_id=permission.permission_id
    )
    db_session.add(rp)
    db_session.flush()
    return rp


@pytest.fixture
def auth_setup(client, db_session):
    """Authenticated test client with org, admin user, and broad permissions."""
    from app.models import (
        Organization,
        OrganizationMembership,
        Role,
        User,
    )
    from app.services.auth_utils import generate_access_token

    organization = Organization(
        name="Test Organization",
        slug="test-org",
        is_demo=False,
        status="active",
    )
    db_session.add(organization)
    db_session.flush()

    role = Role(
        role_key="admin",
        display_name="Org Admin",
        description="Full access for integration tests",
        is_system=False,
    )
    db_session.add(role)
    db_session.flush()

    permission_keys = [
        "collections.view", "collections.create", "collections.edit", "collections.delete",
        "locations.view", "locations.edit",
        "media.view", "media.edit", "media.delete",
        "data.view", "data.query", "data.export", "data.manage",
        "org.manage_settings", "org.manage_members", "org.manage_roles",
        "org.users.create", "org.users.update", "org.users.deactivate",
        "org.manage_api_keys", "org.view_audit_logs",
        "connectors.view", "connectors.edit",
        "pipelines.view", "pipelines.edit", "schedules.manage",
        "runs.view", "runs.view_logs", "runs.execute", "runs.force_full",
        "runs.delete", "runs.rollback",
        "mappings.view", "mappings.edit",
        "reports.view", "reports.create", "reports.edit", "reports.delete",
        "reports.execute", "reports.export", "reports.schedule",
        "notifications.view",
        "workspaces.view", "workspaces.create", "workspaces.edit",
        "workspaces.delete", "workspaces.execute", "workspaces.share",
        "discover.publish",
        "documents.generate", "documents.templates.view", "documents.templates.edit",
        "entries.view", "entries.create", "entries.edit",
        "acquisitions.view", "acquisitions.create", "acquisitions.edit",
        "loans.view", "loans.create", "loans.edit",
        "exits.view", "exits.create", "exits.edit",
        "movements.view", "movements.create", "movements.edit",
        "contacts.view", "contacts.edit",
        "authorities.view", "authorities.create", "authorities.edit", "authorities.delete",
        "exhibit.view", "exhibit.create", "exhibit.edit", "exhibit.delete",
        "conservation.view", "conservation.create", "conservation.edit",
        "condition_reports.view", "condition_reports.create", "condition_reports.edit",
        "platform.admin",
    ]
    for key in permission_keys:
        perm = _create_permission(db_session, key)
        _create_role_permission(db_session, role, perm)

    from datetime import datetime, timezone

    user = User(
        email="testadmin@example.com",
        password_hash="not_used_in_tests",
        status="active",
        # A fully-onboarded admin has a verified email. Endpoints gated by
        # require_verified_email (#70, e.g. POST .../invitations) 403 without
        # this; verified is the realistic state for the authed admin.
        email_verified_at=datetime.now(timezone.utc),
    )
    db_session.add(user)
    db_session.flush()

    membership = OrganizationMembership(
        organization_id=organization.organization_id,
        user_id=user.user_id,
        role="admin",
        role_id=role.role_id,
        status="active",
    )
    db_session.add(membership)

    user_id = user.user_id
    user_email = user.email
    org_id = organization.organization_id

    db_session.commit()

    token = generate_access_token(
        user_id=str(user_id),
        email=user_email,
        active_organization_id=str(org_id),
        expires_minutes=60,
    )

    org_proxy = SimpleNamespace(organization_id=org_id)
    user_proxy = SimpleNamespace(user_id=user_id, email=user_email)
    return AuthenticatedClient(client, token), org_proxy, user_proxy


@pytest.fixture
def viewer_auth_setup(client, db_session):
    """Authenticated client with viewer role (read-only permissions)."""
    from app.models import Organization, OrganizationMembership, Role, User
    from app.services.auth_utils import generate_access_token

    organization = Organization(
        name="Viewer Test Org",
        slug="viewer-org",
        is_demo=False,
        status="active",
    )
    db_session.add(organization)
    db_session.flush()

    role = Role(
        role_key="viewer",
        display_name="Viewer",
        description="Read-only access",
        is_system=True,
    )
    db_session.add(role)
    db_session.flush()

    view_keys = [
        "collections.view", "locations.view", "media.view", "data.view",
        "connectors.view", "pipelines.view", "runs.view", "mappings.view",
        "reports.view", "notifications.view", "workspaces.view",
    ]
    for key in view_keys:
        perm = _create_permission(db_session, key)
        _create_role_permission(db_session, role, perm)

    user = User(
        email="viewer@example.com",
        password_hash="not_used_in_tests",
        status="active",
    )
    db_session.add(user)
    db_session.flush()

    membership = OrganizationMembership(
        organization_id=organization.organization_id,
        user_id=user.user_id,
        role="member",
        role_id=role.role_id,
        status="active",
    )
    db_session.add(membership)

    user_id = user.user_id
    user_email = user.email
    org_id = organization.organization_id
    db_session.commit()

    token = generate_access_token(
        user_id=str(user_id),
        email=user_email,
        active_organization_id=str(org_id),
        expires_minutes=60,
    )

    org_proxy = SimpleNamespace(organization_id=org_id)
    user_proxy = SimpleNamespace(user_id=user_id, email=user_email)
    return AuthenticatedClient(client, token), org_proxy, user_proxy


# ---------------------------------------------------------------------------
# Convenience demo-data fixtures (retained for legacy tests)
# ---------------------------------------------------------------------------


@pytest.fixture()
def demo_tenant(db_session):
    from app.models import Organization

    organization = Organization(
        name="Demo Organization",
        slug="demo",
        is_demo=True,
        status="active",
    )
    db_session.add(organization)
    db_session.commit()
    return organization


@pytest.fixture()
def test_tenant(demo_tenant):
    """Alias used by a handful of legacy postgres-marked tests."""
    demo_tenant.tenant_id = demo_tenant.organization_id
    return demo_tenant


@pytest.fixture()
def demo_pipeline(db_session, demo_tenant):
    from app.models import (
        ConnectorDefinition,
        ConnectorInstance,
        Pipeline,
        PipelineDestination,
        PipelineSource,
    )

    source_def = ConnectorDefinition(
        key="test_source",
        display_name="Test Source",
        direction="source",
        implementation_key="test.source:TestSource",
        capabilities={},
        config_schema={},
        is_enabled=True,
    )
    target_def = ConnectorDefinition(
        key="test_target",
        display_name="Test Target",
        direction="target",
        implementation_key="test.target:TestTarget",
        capabilities={},
        config_schema={},
        is_enabled=True,
    )
    db_session.add_all([source_def, target_def])
    db_session.flush()

    source_instance = ConnectorInstance(
        organization_id=demo_tenant.organization_id,
        connector_definition_id=source_def.connector_definition_id,
        name="Test Source Instance",
        status="active",
        config={},
    )
    target_instance = ConnectorInstance(
        organization_id=demo_tenant.organization_id,
        connector_definition_id=target_def.connector_definition_id,
        name="Test Target Instance",
        status="active",
        config={},
    )
    db_session.add_all([source_instance, target_instance])
    db_session.flush()

    pipeline = Pipeline(
        organization_id=demo_tenant.organization_id, status="active"
    )
    db_session.add(pipeline)
    db_session.flush()

    pipeline_source = PipelineSource(
        pipeline_id=pipeline.pipeline_id,
        connector_instance_id=source_instance.connector_instance_id,
        enabled=True,
        parameters={},
        ordering=0,
    )
    pipeline_dest = PipelineDestination(
        pipeline_id=pipeline.pipeline_id,
        connector_instance_id=target_instance.connector_instance_id,
        enabled=True,
        parameters={},
        ordering=0,
    )
    db_session.add_all([pipeline_source, pipeline_dest])
    db_session.commit()

    pipeline._test_source_instance = source_instance
    pipeline._test_target_instance = target_instance
    pipeline._test_pipeline_source = pipeline_source
    pipeline._test_pipeline_dest = pipeline_dest
    return pipeline


@pytest.fixture()
def demo_route(demo_pipeline):
    return demo_pipeline


@pytest.fixture()
def test_run(db_session, demo_tenant):
    from app.models import Run

    run = Run(
        organization_id=demo_tenant.organization_id,
        status="pending",
        triggered_by="test",
        parameters={},
        processed_count=0,
        created_count=0,
        updated_count=0,
        skipped_count=0,
        failed_count=0,
    )
    db_session.add(run)
    db_session.flush()
    return run


def _post_json(auth_client, url, data):
    return auth_client.post(url, json=data)


def _put_json(auth_client, url, data):
    return auth_client.put(url, json=data)


def pytest_terminal_summary(terminalreporter, exitstatus, config):
    terminalreporter.write_line(
        f"Postgres test backend: {_TEST_DATABASE_URL}", cyan=True
    )
