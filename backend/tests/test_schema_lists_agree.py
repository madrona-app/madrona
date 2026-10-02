"""
The list of Madrona schemas is written down in four places, and they have to
agree.

They did not. `dam`, `exhibit` and `reporting` were dropped — they never held a
table — and three of the four lists were updated. The fourth was the GRANT loop
in docker/postgres/init-db.sh, which kept running `ALTER SCHEMA reporting OWNER
TO madrona` against a schema that no longer gets created. That aborts the init
script, so Postgres exits 3 and the container never becomes healthy: every
service that depends on it fails to start, and a fresh `docker compose up`
brings up nothing at all.

Nothing caught it for two reasons. Postgres only runs /docker-entrypoint-initdb.d
on an empty data directory, so any developer or CI job with an existing volume
skips it entirely — it reproduces only on a genuinely cold boot. And the file is
a shell script wrapping a heredoc of SQL, which no test read.

So these tests read it. They are string comparisons against four files, which is
crude, but the alternative is a class of failure that only appears on a new
install — the one case a self-hoster always hits and the maintainers never do.
"""

from __future__ import annotations

import pathlib
import re

import pytest

_ROOT = pathlib.Path(__file__).resolve().parents[2]
_INIT_DB = _ROOT / "docker" / "postgres" / "init-db.sh"
_CONFTEST = _ROOT / "backend" / "tests" / "conftest.py"
_ENV_PY = _ROOT / "backend" / "migrations" / "env.py"
_CONSOLIDATED = (
    _ROOT
    / "backend"
    / "migrations"
    / "versions"
    / "20260421_1134-33d81a377dc7_initial_consolidated_schema.py"
)

# `public` always exists and is never created, so it is excluded everywhere and
# compared separately where it appears.
_PUBLIC = "public"


def _read(path: pathlib.Path) -> str:
    if not path.exists():
        pytest.skip(f"{path} not found")
    return path.read_text()


def _created_by_init_db() -> set[str]:
    return set(re.findall(r"CREATE SCHEMA IF NOT EXISTS (\w+);", _read(_INIT_DB)))


def _granted_by_init_db() -> set[str]:
    text = _read(_INIT_DB)
    m = re.search(r"FOREACH s IN ARRAY ARRAY\[([^\]]+)\]", text)
    assert m, "could not find the GRANT loop's schema array in init-db.sh"
    return set(re.findall(r"'(\w+)'", m.group(1)))


def _tuple_after(text: str, name: str) -> set[str]:
    """Names in a `NAME = ( "a", "b", ... )` literal."""
    m = re.search(rf"^{name} = \(([^)]*)\)", text, re.MULTILINE)
    assert m, f"could not find {name}"
    return set(re.findall(r'"(\w+)"', m.group(1)))


class TestSchemaListsAgree:
    def test_init_db_grants_only_schemas_it_creates(self):
        """
        The failure that took the stack down. A grant on a schema that is never
        created aborts initdb, and Postgres exits before it ever listens.
        """
        created = _created_by_init_db()
        granted = _granted_by_init_db() - {_PUBLIC}
        assert granted <= created, (
            f"init-db.sh grants on {sorted(granted - created)}, which it does "
            f"not create. ALTER SCHEMA on a missing schema aborts the init "
            f"script and Postgres exits 3 on every fresh database."
        )

    def test_init_db_grants_on_everything_it_creates(self):
        """The other direction: a created schema with no grants leaves the
        NOBYPASSRLS app role unable to read its tables."""
        created = _created_by_init_db()
        granted = _granted_by_init_db()
        assert created <= granted, (
            f"init-db.sh creates {sorted(created - granted)} but grants no "
            f"privileges on them, so the app role cannot use them"
        )

    def test_the_test_harness_builds_the_same_schemas(self):
        conftest = _tuple_after(_read(_CONFTEST), "_SCHEMAS")
        assert conftest == _created_by_init_db(), (
            "conftest.py and init-db.sh disagree about which schemas exist, so "
            "the test database is not shaped like a real one"
        )

    def test_the_consolidated_migration_creates_the_same_schemas(self):
        migration = _tuple_after(_read(_CONSOLIDATED), "_MADRONA_SCHEMAS")
        assert migration == _created_by_init_db(), (
            "the consolidated migration and init-db.sh disagree about which "
            "schemas exist"
        )

    def test_alembic_env_covers_the_same_schemas(self):
        """
        env.py drives autogenerate; a schema missing here is invisible to it.

        It carries `public` and `None` as well, which the others do not —
        autogenerate has to consider the default schema — so those are
        excluded rather than treated as drift.
        """
        m = re.search(r"^MADRONA_SCHEMAS = \{([^}]*)\}", _read(_ENV_PY), re.MULTILINE)
        assert m, "could not find MADRONA_SCHEMAS in migrations/env.py"
        env_schemas = set(re.findall(r'"(\w+)"', m.group(1))) - {_PUBLIC}
        assert env_schemas == _created_by_init_db(), (
            "migrations/env.py and init-db.sh disagree about which schemas "
            "exist, so autogenerate would not see one of them"
        )
