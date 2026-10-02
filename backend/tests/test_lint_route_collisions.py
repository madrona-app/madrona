"""
Tests for scripts/lint_route_collisions.py.

The lint exists to catch the bug class where two FastAPI handlers register
against the same (method, path) and one is silently shadowed. May 2026
audit found 8 such collisions; they have all been resolved.

Three contracts to lock down:
  1. find_collisions detects the obvious case (two handlers, same path).
  2. find_collisions tolerates param-name variance (`{org_id}` vs `{organization_id}`).
  3. The live app has NO route collisions. Any new one breaks the test.

A `KNOWN_LEGACY_COLLISIONS` set is kept as scaffolding (currently empty)
in case future cleanup needs the same ratchet pattern again — but the
contract today is simply zero collisions.
"""
from __future__ import annotations

from collections import defaultdict
import importlib
import sys
from pathlib import Path

import pytest


REPO_BACKEND = Path(__file__).resolve().parents[1]
LINT_SCRIPT_DIR = REPO_BACKEND / "scripts"


@pytest.fixture(scope="module")
def find_collisions():
    """Import find_collisions without re-importing on every test."""
    if str(LINT_SCRIPT_DIR) not in sys.path:
        sys.path.insert(0, str(LINT_SCRIPT_DIR))
    mod = importlib.import_module("lint_route_collisions")
    return mod.find_collisions


def _make_app_with_routes(*routes):
    """Build a tiny FastAPI app with the given (method, path) routes."""
    from fastapi import FastAPI
    app = FastAPI()
    for method, path in routes:
        # FastAPI's APIRouter.add_api_route lets us register multiple
        # handlers against the same path — what we actually want to test.
        async def _handler():  # pragma: no cover (no execution path)
            return {}
        app.add_api_route(path, _handler, methods=[method])
    return app


class TestFindCollisions:
    def test_clean_app_has_no_collisions(self, find_collisions):
        app = _make_app_with_routes(
            ("GET", "/api/foo"),
            ("POST", "/api/foo"),  # different method, same path — OK
            ("GET", "/api/bar"),
        )
        assert find_collisions(app) == {}

    def test_two_handlers_same_method_and_path_collide(self, find_collisions):
        app = _make_app_with_routes(
            ("GET", "/api/dup"),
            ("GET", "/api/dup"),
        )
        result = find_collisions(app)
        assert ("GET", "/api/dup") in result
        assert len(result[("GET", "/api/dup")]) == 2

    def test_param_name_variance_treated_as_same_path(self, find_collisions):
        """`/foo/{org_id}` and `/foo/{organization_id}` should collide."""
        app = _make_app_with_routes(
            ("GET", "/api/foo/{org_id}/bar"),
            ("GET", "/api/foo/{organization_id}/bar"),
        )
        result = find_collisions(app)
        assert ("GET", "/api/foo/{p}/bar") in result

    def test_head_is_not_counted_as_collision(self, find_collisions):
        """FastAPI auto-adds HEAD on every GET; that synthetic HEAD must
        not be reported as a duplicate of a real handler."""
        from fastapi import FastAPI
        app = FastAPI()
        async def _g():
            return {}
        # Single GET — FastAPI internally exposes HEAD too. find_collisions
        # must filter HEAD out.
        app.add_api_route("/api/once", _g, methods=["GET"])
        assert find_collisions(app) == {}


# ---------------------------------------------------------------------------
# Live app: zero collisions allowed.
# ---------------------------------------------------------------------------
#
# The May 2026 cleanup brought the live FastAPI app to zero route
# collisions. KNOWN_LEGACY_COLLISIONS is retained (empty) so future
# refactors can re-use the ratchet pattern if needed, but the default
# contract is: no two handlers share the same (method, normalized_path).
#
# DO NOT add entries here to silence a new collision. The point of this
# guard is to make new collisions visible — fix the duplicate, don't
# suppress the test.

KNOWN_LEGACY_COLLISIONS: frozenset[tuple[str, str]] = frozenset()


class TestLiveApp:
    """The live app must have no duplicate route handlers."""

    def test_live_app_has_no_collisions(self, find_collisions):
        from app.asgi import _fastapi_app
        live = frozenset(find_collisions(_fastapi_app).keys())
        unexpected_new = live - KNOWN_LEGACY_COLLISIONS
        unexpected_fixed = KNOWN_LEGACY_COLLISIONS - live
        msg = []
        if unexpected_new:
            msg.append(
                "Route collision(s) detected — two handlers register the "
                "same (method, path). Pick a canonical handler and delete "
                "or move the other:\n  "
                + "\n  ".join(f"[{m}] {p}" for m, p in sorted(unexpected_new))
            )
        if unexpected_fixed:
            msg.append(
                "A previously-known collision is now resolved — please "
                "remove it from KNOWN_LEGACY_COLLISIONS in this file:\n  "
                + "\n  ".join(f"[{m}] {p}" for m, p in sorted(unexpected_fixed))
            )
        assert not msg, "\n\n".join(msg)
