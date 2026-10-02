"""Unit tests for app/services/db_metering.py.

These functions issue raw SQL via SQLAlchemy. Rather than spin up tables,
we mock `session.execute` and assert the calling shape and aggregation logic.
"""

from unittest.mock import MagicMock

import pytest

from app.services.db_metering import (
    ORG_SCOPED_TABLES,
    measure_all_orgs_postgres_bytes,
    measure_org_postgres_bytes,
)


def _make_session(execute_results=None):
    """Build a mock Session whose execute() returns canned results in order.

    Each entry in `execute_results` is what the next execute() call returns:
    - a non-list value → set scalar() to that value
    - a list           → set fetchall() to that list (and scalar() to None)
    """
    session = MagicMock()
    results = iter(execute_results or [])

    def fake_execute(*_args, **_kwargs):
        try:
            value = next(results)
        except StopIteration:
            value = None
        result = MagicMock()
        if isinstance(value, list):
            result.fetchall.return_value = value
            result.scalar.return_value = None
        else:
            result.scalar.return_value = value
            result.fetchall.return_value = []
        return result

    session.execute.side_effect = fake_execute
    return session


class TestMeasureOrgPostgresBytes:
    def test_returns_zero_when_all_tables_empty(self):
        # Each table emits three execute() calls (size, total_rows, org_rows).
        # Force size=0 so the loop continues without summing anything.
        # When size=0, the function `continue`s and skips the next two queries
        # for that table — so we provide one 0 per table, not three.
        results = [0] * len(ORG_SCOPED_TABLES)
        session = _make_session(execute_results=results)
        assert measure_org_postgres_bytes("org-1", session) == 0

    def test_sums_proportional_bytes_for_one_table(self):
        # First table: size=1000, total_rows=10, org_rows=2 -> 200 bytes
        # Remaining tables: size=0 short-circuits each loop iteration.
        results = [1000, 10, 2]
        results += [0] * (len(ORG_SCOPED_TABLES) - 1)
        session = _make_session(execute_results=results)
        assert measure_org_postgres_bytes("org-1", session) == 200

    def test_sums_across_multiple_tables(self):
        # Two tables contribute, rest skip:
        # Table A: size=1000, total=10, org=2 -> 200
        # Table B: size=2000, total=4, org=1 -> 500
        # Total: 700
        results = [1000, 10, 2, 2000, 4, 1]
        results += [0] * (len(ORG_SCOPED_TABLES) - 2)
        session = _make_session(execute_results=results)
        assert measure_org_postgres_bytes("org-1", session) == 700

    def test_skips_table_when_total_rows_zero(self):
        # size=1000 but total_rows=0 -> skip without counting org_rows
        # First table consumes 2 calls (size, total=0), then `continue` skips org_rows.
        results = [1000, 0]
        results += [0] * (len(ORG_SCOPED_TABLES) - 1)
        session = _make_session(execute_results=results)
        assert measure_org_postgres_bytes("org-1", session) == 0

    def test_skips_table_when_org_rows_zero(self):
        # size=1000, total=10, org=0 -> proportional = 0, skipped
        results = [1000, 10, 0]
        results += [0] * (len(ORG_SCOPED_TABLES) - 1)
        session = _make_session(execute_results=results)
        assert measure_org_postgres_bytes("org-1", session) == 0

    def test_swallows_per_table_exceptions_and_continues(self):
        # First table: size query raises. Second table: 1000/10/5 -> 500.
        session = MagicMock()
        scalar_iter = iter([1000, 10, 5])  # for the second table only

        call_count = {"n": 0}

        def fake_execute(*_args, **_kwargs):
            call_count["n"] += 1
            # First execute() raises (per-table error).
            if call_count["n"] == 1:
                raise RuntimeError("boom")
            result = MagicMock()
            try:
                result.scalar.return_value = next(scalar_iter)
            except StopIteration:
                result.scalar.return_value = 0
            return result

        session.execute.side_effect = fake_execute
        # Should not raise
        result = measure_org_postgres_bytes("org-1", session)
        assert isinstance(result, int)
        assert result >= 0


class TestMeasureAllOrgsPostgresBytes:
    def test_returns_zero_dict_for_each_requested_org_when_empty(self):
        # Each table calls execute once (size=0 short-circuits).
        results = [0] * len(ORG_SCOPED_TABLES)
        session = _make_session(execute_results=results)
        out = measure_all_orgs_postgres_bytes(["a", "b", "c"], session)
        assert out == {"a": 0, "b": 0, "c": 0}

    def test_sums_proportional_bytes_per_org(self):
        # First table: size=1000, total_rows=10, GROUP BY rows.
        # Per-org rows: a=2, b=3, c=5 -> bytes 200, 300, 500
        results = [1000, 10, [("a", 2), ("b", 3), ("c", 5)]]
        results += [0] * (len(ORG_SCOPED_TABLES) - 1)
        session = _make_session(execute_results=results)
        out = measure_all_orgs_postgres_bytes(["a", "b", "c"], session)
        assert out == {"a": 200, "b": 300, "c": 500}

    def test_ignores_orgs_not_in_request_list(self):
        results = [1000, 10, [("a", 2), ("x", 9)]]
        results += [0] * (len(ORG_SCOPED_TABLES) - 1)
        session = _make_session(execute_results=results)
        out = measure_all_orgs_postgres_bytes(["a"], session)
        assert out == {"a": 200}

    def test_swallows_per_table_errors(self):
        session = MagicMock()
        # First execute (size of first table) raises.
        # Second table: size=2000, total=4 -> per-org from fetchall.
        call_count = {"n": 0}

        def fake_execute(*_args, **_kwargs):
            call_count["n"] += 1
            if call_count["n"] == 1:
                raise RuntimeError("boom")
            result = MagicMock()
            if call_count["n"] == 2:
                result.scalar.return_value = 2000
            elif call_count["n"] == 3:
                result.scalar.return_value = 4
            elif call_count["n"] == 4:
                result.fetchall.return_value = [("a", 2)]
                result.scalar.return_value = 0
            else:
                result.scalar.return_value = 0
                result.fetchall.return_value = []
            return result

        session.execute.side_effect = fake_execute
        out = measure_all_orgs_postgres_bytes(["a"], session)
        assert isinstance(out, dict)
        assert "a" in out


def test_org_scoped_tables_well_formed():
    """Each entry must be a (schema, table) tuple of strings — sanity check
    the registry so a typo doesn't silently produce zero coverage for a table.
    """
    assert len(ORG_SCOPED_TABLES) > 0
    for entry in ORG_SCOPED_TABLES:
        assert isinstance(entry, tuple)
        assert len(entry) == 2
        schema, table = entry
        assert isinstance(schema, str) and schema
        assert isinstance(table, str) and table
