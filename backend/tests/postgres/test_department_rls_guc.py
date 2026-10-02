"""The department GUC must round-trip through current_dept_ids().

This is a regression test for a silent, fail-OPEN bug.

`app/services/rls.py` writes the caller's department ids into
`app.current_dept_ids`, and the `current_dept_ids()` SQL function parses them
back with `string_to_array(..., ',')::uuid[]`. The writer used to emit a
Postgres array literal — `'{uuid,uuid}'` — so splitting on ',' produced the
fragments `'{uuid'` and `'uuid}'`, the ::uuid[] cast raised, and the function's
`EXCEPTION WHEN OTHERS THEN RETURN NULL` swallowed it.

Every department policy ends `OR current_dept_ids() IS NULL`, and NULL means
"no department restriction", so the failure granted every department's records
to the user rather than denying them.

It only misfired for users in zero or two-plus departments: a single id happens
to survive the cast because Postgres accepts the '{uuid}' form. A fixture with
one department per user therefore passed while the control was off in
production — which is exactly why this test enumerates all three cases.
"""

from __future__ import annotations

import os

import pytest
from sqlalchemy import text



pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        not os.environ.get("TEST_DATABASE_URL"),
        reason="Requires a migrated PostgreSQL (TEST_DATABASE_URL not set)",
    ),
]

DEPT_A = "11111111-1111-1111-1111-111111111111"
DEPT_B = "22222222-2222-2222-2222-222222222222"
DEPT_C = "33333333-3333-3333-3333-333333333333"


@pytest.fixture(scope="module")
def engine(test_engine):
    """The suite's own engine, not a fresh one built from TEST_DATABASE_URL.

    Building an engine straight from the env var passed serially and failed
    under `pytest -n auto`: xdist gives each worker its own database
    (`madrona_test_gw0`, ...), and conftest applies the RLS seed — which is
    what defines current_dept_ids() — to that worker database. The raw env var
    still points at the base database, which no worker ever seeds, so CI failed
    with "function current_dept_ids() does not exist" while local serial runs
    passed. Taking conftest's session-scoped test_engine keeps the test on the
    database that was actually prepared (postgres_engine is function-scoped
    and cannot be requested from a module-scoped fixture).
    """
    yield test_engine


def _dept_ids_for(conn, raw: str):
    conn.execute(text("SELECT set_config('app.current_dept_ids', :v, true)"), {"v": raw})
    return conn.execute(text("SELECT current_dept_ids()")).scalar()


def _encode(dept_ids: list[str]) -> str:
    """Mirror how app/services/rls.py serialises the list."""
    return ",".join(dept_ids)


def test_two_departments_parse(engine):
    """The case that was broken: two ids must both come back."""
    with engine.connect() as conn:
        got = _dept_ids_for(conn, _encode([DEPT_A, DEPT_B]))
        assert got is not None, (
            "current_dept_ids() returned NULL for a two-department user. "
            "Every department policy treats NULL as 'no restriction', so this "
            "grants access to every department's records."
        )
        assert sorted(str(u) for u in got) == sorted([DEPT_A, DEPT_B])


def test_one_department_parses(engine):
    with engine.connect() as conn:
        got = _dept_ids_for(conn, _encode([DEPT_A]))
        assert got is not None
        assert [str(u) for u in got] == [DEPT_A]


def test_no_departments_is_null(engine):
    """Unchanged behaviour: no department membership means unscoped.

    Orgs that do not use departments leave every department_id NULL, and the
    policies' `department_id IS NULL` clause covers those rows. This asserts
    the existing semantics rather than endorsing them.
    """
    with engine.connect() as conn:
        assert _dept_ids_for(conn, _encode([])) is None


def test_membership_actually_excludes_other_departments(engine):
    """The point of the whole mechanism: a foreign department is not matched.

    set_config(..., is_local => true) is scoped to the transaction, so the
    scope and the two checks have to share one.
    """
    with engine.connect() as conn:
        with conn.begin():
            _dept_ids_for(conn, _encode([DEPT_A, DEPT_B]))
            in_scope = conn.execute(
                text("SELECT CAST(:d AS uuid) = ANY(current_dept_ids())"), {"d": DEPT_A}
            ).scalar()
            out_of_scope = conn.execute(
                text("SELECT CAST(:d AS uuid) = ANY(current_dept_ids())"), {"d": DEPT_C}
            ).scalar()
        assert in_scope is True
        assert out_of_scope is False


def test_writer_and_parser_agree(engine):
    """Guard the actual serialiser, not a copy of it.

    If rls.py starts emitting a different shape, this fails here rather than
    silently disabling department isolation in production.
    """
    from app.services.rls import _encode_dept_ids

    with engine.connect() as conn:
        got = _dept_ids_for(conn, _encode_dept_ids([DEPT_A, DEPT_B]))
        assert got is not None
        assert sorted(str(u) for u in got) == sorted([DEPT_A, DEPT_B])
