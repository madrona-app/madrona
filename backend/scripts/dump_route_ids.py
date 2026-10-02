#!/usr/bin/env python3
"""Emit real ids for the frontend route sweep, keyed by its parameter names.

frontend/tests/e2e/specs/route-sweep.spec.ts can only visit a route whose URL it
can build. It resolves the organization itself, which covers 242 of 258
parameterised routes, and skips the rest — 98 routes needing :objectId, :loanId,
:reportId and 37 other ids.

Those are the same ids scripts/api_sweep.py already resolves from the database,
under snake_case names. Rather than write a second resolver in TypeScript that
would drift from this one, this reuses it and writes a map the spec reads:

    {"objectId": "…", "loanId": "…"}

Ids must belong to the organization the spec signs in as, or every page answers
404 and the sweep learns nothing, so the org is resolved the same way — by slug.

    cd backend
    ./venv/bin/python scripts/dump_route_ids.py \\
        --out ../frontend/tests/.auth/route-ids.json
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.api_sweep import DEFAULT_DB, Resolver  # noqa: E402

ROUTE_CONFIG = (
    Path(__file__).resolve().parents[2] / "frontend" / "src" / "app" / "routeConfig.tsx"
)


def route_params(path: Path) -> list[str]:
    """Every :param the frontend declares, minus the ones the spec resolves."""
    source = path.read_text()
    found = set()
    for match in re.finditer(r'<Route\s+path="([^"]+)"', source):
        for param in re.findall(r":([A-Za-z]+)", match.group(1)):
            found.add(param)
    return sorted(found - {"orgId", "orgSlug"})


def snake(name: str) -> str:
    """objectId -> object_id, entityKey -> entity_key."""
    return re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--db", default=os.environ.get("SWEEP_DB_URL", DEFAULT_DB))
    parser.add_argument(
        "--org-slug",
        default="e2e-test-org",
        help="organization the ids must belong to (default: the sweep user's)",
    )
    parser.add_argument("--org", help="organization id, if you already know it")
    parser.add_argument("--out", required=True, help="where to write the JSON map")
    args = parser.parse_args()

    # Resolver needs an org before it can prefer that tenant's rows.
    bootstrap = Resolver(args.db, args.org or "00000000-0000-0000-0000-000000000000")
    org_id = args.org or bootstrap._one(
        "SELECT organization_id FROM organizations WHERE slug = %s", args.org_slug
    )
    if not org_id:
        sys.exit(f"no organization with slug {args.org_slug!r}")

    resolver = Resolver(args.db, str(org_id))
    params = route_params(ROUTE_CONFIG)

    resolved: dict[str, str] = {}
    unresolved: list[str] = []
    for param in params:
        value = resolver.resolve(snake(param))
        if value is None:
            unresolved.append(param)
        else:
            resolved[param] = value

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    # orgSlug too: the spec asks the API for it, and GET /api/organizations/{id}
    # answers 405, so without this every /c/:orgSlug route is skipped.
    org_slug = resolver._one(
        "SELECT slug FROM organizations WHERE organization_id = %s", str(org_id)
    )
    out.write_text(json.dumps(
        {"orgId": str(org_id), "orgSlug": org_slug or args.org_slug, **resolved},
        indent=1, sort_keys=True,
    ))

    print(f"resolved {len(resolved)} of {len(params)} route parameters -> {out}")
    if unresolved:
        print("no row supplies: " + ", ".join(unresolved))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
