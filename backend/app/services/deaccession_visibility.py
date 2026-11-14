"""
Keep deaccessioned records out of general search (an organization setting).

``Organization.hide_deaccessioned_in_search`` is on by default. While it is
on:

* staff general search and object lists (POST /collections/search and
  GET /collections/objects) leave out objects whose ``object_status`` is
  ``deaccessioned``, unless the request asks for them with
  ``include_deaccessioned`` or filters on that status explicitly;
* the public portal (Discover) never shows them: not in search, not on a
  record page, not in related, featured or exhibition lists, not in exports,
  sitemaps or the public MCP server.

The records themselves are untouched. Opening a record by its staff URL,
procedure screens and reports work as before.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import true
from sqlalchemy.orm import Session

DEACCESSIONED = "deaccessioned"


def hides_deaccessioned(db: Session | None, organization_id: UUID | str | None) -> bool:
    """Whether the organization keeps deaccessioned records out of search."""
    if db is None or organization_id is None:
        return True
    from app.models import Organization

    value = (
        db.query(Organization.hide_deaccessioned_in_search)
        .filter(Organization.organization_id == organization_id)
        .scalar()
    )
    return True if value is None else bool(value)


def exclude_from_staff_search(
    hide: bool, include_deaccessioned: bool, object_status: list[str] | None,
) -> bool:
    """Whether a staff search should leave deaccessioned records out.

    An explicit status filter that names deaccessioned is a request for them.
    """
    if not hide or include_deaccessioned:
        return False
    return not (object_status and DEACCESSIONED in object_status)


def apply_to_filters(filters, exclude: bool):
    """Add the exclusion to a CollectionsSearchFilters (creating one if needed)."""
    if not exclude:
        return filters
    from app.search.collections.schemas import CollectionsSearchFilters

    filters = filters or CollectionsSearchFilters()
    existing = list(filters.exclude_object_status or [])
    if DEACCESSIONED not in existing:
        existing.append(DEACCESSIONED)
    filters.exclude_object_status = existing
    return filters


def public_visible_clause(db: Session | None, organization_id: UUID | str | None):
    """SQL condition a public query adds: true(), or status != deaccessioned."""
    from app.models import CollectionObject

    if hides_deaccessioned(db, organization_id):
        return CollectionObject.object_status != DEACCESSIONED
    return true()


def public_object_visible(obj, db: Session | None = None) -> bool:
    """Python-side check for an already-loaded object."""
    if obj is None:
        return False
    if getattr(obj, "object_status", None) != DEACCESSIONED:
        return True
    if db is None:
        from sqlalchemy.orm import object_session

        db = object_session(obj)
    return not hides_deaccessioned(db, obj.organization_id)
