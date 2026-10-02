#!/usr/bin/env python3
"""
Lint for duplicate FastAPI route handlers.

Two handlers registered against the same (method, path) is an accident in
99% of cases: FastAPI's router resolves the first one registered, the
second is silently shadowed. The shadowed handler's access controls,
business logic, and response shape never execute — yet the code stays
in the tree, drifts independently, and frontend callers that were
written against its shape return errors at runtime instead of failing
in CI.

This bug class hit us at least three times in May 2026:
  * /api/auth/activate vs /api/activate (different paths, same purpose —
    caught by a test/prod path divergence)
  * GET /media/{id}/download in media_dam.py vs media_library.py (live
    handler had no access controls; the shadowed copy had them all)
  * POST /media/{id}/publish in media_rights_publishing.py vs media_dam.py
    (the second handler implemented a totally different feature — the
    frontend caller targeting that feature has never worked)
  * Five /api/datasets* routes duplicated between datasets.py and runs.py

This lint walks the actual FastAPI ASGI app (the source of truth — it
accounts for `include_router(prefix=...)` and skips disabled routers)
and reports any (method, normalized_path) that has more than one
registered handler.

Exit codes
----------
0 — clean (no collisions)
1 — at least one collision found
"""
from __future__ import annotations

import os
import re
import sys
from collections import defaultdict

# Path parameter normalization: `/foo/{org_id}` and `/foo/{organization_id}`
# both serve the same path; treat them as equivalent for collision detection.
_PARAM_RE = re.compile(r"\{[^}]+\}")


def _normalize_path(path: str) -> str:
    return _PARAM_RE.sub("{p}", path)


def find_collisions(app) -> dict[tuple[str, str], list[str]]:
    """Return collisions as {(method, normalized_path): [endpoint_labels]}."""
    from fastapi.routing import APIRoute

    by_key: dict[tuple[str, str], list[str]] = defaultdict(list)
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        normalized = _normalize_path(route.path)
        endpoint = route.endpoint
        label = f"{endpoint.__module__}:{endpoint.__qualname__}"
        for method in route.methods or ():
            # FastAPI auto-synthesizes HEAD on every GET — those aren't
            # independent handlers and shouldn't trigger the lint.
            if method == "HEAD":
                continue
            by_key[(method, normalized)].append(label)
    return {k: v for k, v in by_key.items() if len(v) > 1}


def _load_app():
    """Import the FastAPI application the same way the test harness does.

    Note: app.asgi exports `application` as a Socket.IO ASGI wrapper that
    doesn't expose `.routes`. The underlying FastAPI app is `_fastapi_app`.
    """
    os.environ.setdefault("APP_ENV", "testing")
    os.environ.setdefault("SECRET_KEY", "lint-route-collisions")
    os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://localhost/devnull")
    from app.asgi import _fastapi_app
    return _fastapi_app


def main() -> int:
    app = _load_app()
    collisions = find_collisions(app)
    if not collisions:
        # One concise line so CI logs stay readable.
        print("lint_route_collisions: clean (no duplicate (method, path) pairs)")
        return 0

    print(f"\nlint_route_collisions: found {len(collisions)} collision(s):\n")
    for (method, path), endpoints in sorted(collisions.items()):
        print(f"  [{method}] {path}")
        for ep in endpoints:
            print(f"      - {ep}")
        print()
    print(
        "Two handlers serving the same (method, path) cause the second to be\n"
        "silently shadowed by registration order. Pick one canonical handler\n"
        "and either delete the other or move it to a distinct path."
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
