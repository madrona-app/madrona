"""
Navigation catalog — Python mirror of the frontend nav tree.

Loads `nav_catalog.json` from this package, generated from
`frontend/src/lib/navigationCatalog.ts` via
`pnpm run build:nav-catalog`. This gives the backend (specifically the
`navigate_to` agent tool) a permission-aware, searchable list of destinations
without duplicating the nav tree in two places.

Drift protection:
  - The JSON is committed to the repo.
  - The frontend vitest snapshot is the source of truth and fails CI if
    `navigationConfig.ts` changes without regenerating the JSON.
  - `test_nav_catalog.py` verifies the JSON loads and has coverage.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger(__name__)

# Schema version the backend supports. Bump in both TS and Python in lockstep
# when making incompatible changes to the entry shape.
SUPPORTED_SCHEMA_VERSION = 1

# The catalog sits next to this module, so the path is the same in a checkout
# and in the image.
#
# It used to live at repo-root shared/ and be resolved as parents[4] of this
# file. That is the repo root in a checkout and "/" in the container — the
# backend build context is ./backend, so repo-root shared/ was never copied in
# and load_nav_catalog() raised FileNotFoundError for every agent navigation
# and playbook call in any Docker deployment. Only one compose service had
# happened to mount it, and it was the service that does not run agent tools.
#
# It is still generated from the frontend's navigationConfig.ts — see the
# snapshot test in frontend/src/test/lib/navigationCatalog.test.ts, which
# writes this file — but it ships with the code that reads it.
_CATALOG_PATH = Path(__file__).resolve().parent / "nav_catalog.json"


@dataclass(frozen=True)
class NavEntry:
    """One searchable destination in the Madrona UI."""

    id: str
    product: str
    label: str
    path_pattern: str
    breadcrumb: tuple[str, ...]
    keywords: tuple[str, ...]
    permission: str | None = None
    app_key: str | None = None
    description: str | None = None

    def resolve_path(self, org_id: str) -> str:
        """Substitute :orgId placeholder in the path pattern."""
        return self.path_pattern.replace(":orgId", org_id)

    def to_public_dict(self) -> dict:
        """Serializable shape for agent tool responses (no keyword noise)."""
        return {
            "id": self.id,
            "product": self.product,
            "label": self.label,
            "path": self.path_pattern,
            "breadcrumb": list(self.breadcrumb),
            "permission": self.permission,
        }


@dataclass(frozen=True)
class NavCatalog:
    """Immutable catalog of all navigation destinations."""

    schema_version: int
    entries: tuple[NavEntry, ...]
    by_id: dict[str, NavEntry] = field(default_factory=dict)

    @classmethod
    def from_json(cls, payload: dict) -> "NavCatalog":
        version = payload.get("schema_version")
        if version != SUPPORTED_SCHEMA_VERSION:
            raise ValueError(
                f"nav_catalog.json schema_version={version} but backend supports "
                f"{SUPPORTED_SCHEMA_VERSION}. Regenerate via `pnpm run build:nav-catalog`."
            )
        raw_entries = payload.get("entries", [])
        entries = tuple(
            NavEntry(
                id=e["id"],
                product=e["product"],
                label=e["label"],
                path_pattern=e["pathPattern"],
                breadcrumb=tuple(e.get("breadcrumb", [])),
                keywords=tuple(e.get("keywords", [])),
                permission=e.get("permission"),
                app_key=e.get("appKey"),
                description=e.get("description"),
            )
            for e in raw_entries
        )
        return cls(
            schema_version=version,
            entries=entries,
            by_id={entry.id: entry for entry in entries},
        )

    def get(self, entry_id: str) -> NavEntry | None:
        return self.by_id.get(entry_id)

    def filter_by_access(
        self,
        *,
        permissions: set[str],
        app_keys: set[str],
    ) -> tuple[NavEntry, ...]:
        """Return entries the caller can actually reach."""
        return tuple(
            e
            for e in self.entries
            if (not e.app_key or e.app_key in app_keys)
            and (not e.permission or e.permission in permissions)
        )


@lru_cache(maxsize=1)
def load_nav_catalog() -> NavCatalog:
    """Load and cache the nav catalog from disk."""
    if not _CATALOG_PATH.exists():
        raise FileNotFoundError(
            f"Nav catalog not found at {_CATALOG_PATH}. Run "
            "`pnpm run build:nav-catalog` from the frontend directory."
        )
    with _CATALOG_PATH.open("r") as f:
        payload = json.load(f)
    catalog = NavCatalog.from_json(payload)
    logger.info("Loaded nav catalog: %d entries, schema v%d", len(catalog.entries), catalog.schema_version)
    return catalog
