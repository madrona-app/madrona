"""
Tests for the navigation catalog loader.

These tests verify that the packaged `nav_catalog.json` loads cleanly and has the
coverage expected by the `navigate_to` agent tool. Drift detection lives in
the frontend vitest snapshot (`src/test/lib/navigationCatalog.test.ts`); the
Python side just asserts we can consume the artifact.
"""

import fnmatch
import pathlib

from app.services.agent_tools.nav_catalog import (
    _CATALOG_PATH,
    SUPPORTED_SCHEMA_VERSION,
    load_nav_catalog,
)


class TestNavCatalogLoader:
    def test_loads_and_is_non_empty(self):
        catalog = load_nav_catalog()
        assert catalog.schema_version == SUPPORTED_SCHEMA_VERSION
        assert len(catalog.entries) >= 20

    def test_ids_are_unique(self):
        catalog = load_nav_catalog()
        ids = [e.id for e in catalog.entries]
        assert len(ids) == len(set(ids))

    def test_covers_critical_destinations(self):
        catalog = load_nav_catalog()
        expected = {
            "collections:objects",
            "collections:conservation",
            "collections:loans-out",
            "collections:loans-in",
            "collections:acquisitions",
            "collections:constituents",
            "media:library",
            "admin:users",
        }
        actual = {e.id for e in catalog.entries}
        missing = expected - actual
        assert not missing, f"Nav catalog missing critical entries: {missing}"

    def test_entries_have_keywords_and_breadcrumb(self):
        catalog = load_nav_catalog()
        for entry in catalog.entries:
            assert entry.path_pattern, f"{entry.id} has no path_pattern"
            assert entry.breadcrumb, f"{entry.id} has no breadcrumb"
            assert entry.keywords, f"{entry.id} has no keywords"

    def test_resolve_path_substitutes_org_id(self):
        catalog = load_nav_catalog()
        entry = catalog.get("collections:conservation")
        assert entry is not None
        resolved = entry.resolve_path("my-org")
        assert ":orgId" not in resolved
        assert "my-org" in resolved

    def test_filter_by_access_drops_unreachable(self):
        catalog = load_nav_catalog()
        # Caller has no permissions at all
        empty = catalog.filter_by_access(permissions=set(), app_keys=set())
        # Anything permission-gated should be dropped
        for entry in empty:
            assert not entry.permission
            assert not entry.app_key

    def test_filter_by_access_includes_granted(self):
        catalog = load_nav_catalog()
        # Grant every permission and app key in the catalog
        all_perms = {e.permission for e in catalog.entries if e.permission}
        all_apps = {e.app_key for e in catalog.entries if e.app_key}
        full = catalog.filter_by_access(permissions=all_perms, app_keys=all_apps)
        assert len(full) == len(catalog.entries)


class TestCatalogShipsInsideTheImage:
    """
    load_nav_catalog() raises FileNotFoundError when the file is missing, and
    the agent navigation and playbook tools call it on a request path — so a
    catalog outside the Docker build context is a 500 in every container, and
    nothing at build time says so.

    That is exactly what shipped: the catalog lived at repo-root shared/ and
    was resolved four parents up from its module, which is the repo root in a
    checkout and "/" in the image. The build context is ./backend, so the file
    was simply not there. These two assertions are the conditions that make it
    present.
    """

    def _backend_root(self) -> pathlib.Path:
        # backend/tests/test_nav_catalog.py -> backend/
        return pathlib.Path(__file__).resolve().parents[1]

    def test_the_catalog_is_inside_the_docker_build_context(self):
        backend = self._backend_root()
        assert _CATALOG_PATH.is_relative_to(backend), (
            f"the catalog resolves to {_CATALOG_PATH}, outside {backend}. The "
            f"backend image is built with ./backend as its context, so nothing "
            f"above it is copied in and load_nav_catalog() will raise in every "
            f"container."
        )
        assert _CATALOG_PATH.exists(), f"{_CATALOG_PATH} does not exist"

    def test_dockerignore_does_not_exclude_the_catalog(self):
        backend = self._backend_root()
        ignore = backend / ".dockerignore"
        if not ignore.exists():
            return
        relative = _CATALOG_PATH.relative_to(backend).as_posix()
        patterns = [
            line.strip()
            for line in ignore.read_text().splitlines()
            if line.strip() and not line.strip().startswith("#")
        ]
        matched = [
            pattern
            for pattern in patterns
            if fnmatch.fnmatch(relative, pattern)
            or fnmatch.fnmatch(_CATALOG_PATH.name, pattern)
            or (pattern.endswith("/") and relative.startswith(pattern))
        ]
        assert not matched, (
            f"backend/.dockerignore patterns {matched} exclude {relative}, so "
            f"it is inside the build context but still not in the image"
        )
