"""Archival hierarchy of object records: collection > series > box > folder > item.

Parent/child links live on collection_objects (parent_object_id, sibling_order).
Every write goes through here so the invariants hold whatever the caller:
same organization, no cycles, an item has no children, a collection has no
parent, and depth stays bounded.
"""
from __future__ import annotations

from uuid import UUID

from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.models import CollectionObject

# Order matters: used for "next level down" suggestions and validation messages.
ARCHIVAL_LEVELS = ("collection", "subcollection", "series", "subseries", "file", "box", "folder", "item")
CATALOG_LEVELS = ARCHIVAL_LEVELS + ("group", "component", "volume")
LEVEL_LABELS = {
    "collection": "Collection", "subcollection": "Sub-collection", "series": "Series", "subseries": "Sub-series",
    "file": "File", "box": "Box", "folder": "Folder", "item": "Item", "group": "Group",
    "component": "Component", "volume": "Volume",
}
MAX_DEPTH = 12


class HierarchyError(ValueError):
    def __init__(self, message: str, status: int = 422, code: str = "validation_error"):
        super().__init__(message)
        self.status = status
        self.code = code


def _get(db: Session, org_id: UUID, object_id: UUID) -> CollectionObject | None:
    return db.query(CollectionObject).filter(
        CollectionObject.object_id == object_id,
        CollectionObject.organization_id == org_id,
        CollectionObject.is_deleted.is_(False),
    ).first()


def ancestors(db: Session, org_id: UUID, obj: CollectionObject) -> list[CollectionObject]:
    """Root first, not including ``obj``."""
    chain: list[CollectionObject] = []
    seen = {obj.object_id}
    current = obj
    while current.parent_object_id and len(chain) < MAX_DEPTH + 1:
        parent = _get(db, org_id, current.parent_object_id)
        if parent is None or parent.object_id in seen:
            break
        chain.append(parent)
        seen.add(parent.object_id)
        current = parent
    chain.reverse()
    return chain


def _sibling_query(db: Session, org_id: UUID, parent_id: UUID):
    return db.query(CollectionObject).filter(
        CollectionObject.organization_id == org_id,
        CollectionObject.parent_object_id == parent_id,
        CollectionObject.is_deleted.is_(False),
    )


def children(db: Session, org_id: UUID, parent_id: UUID, limit: int = 100, offset: int = 0):
    q = _sibling_query(db, org_id, parent_id)
    total = q.count()
    rows = (
        q.order_by(
            CollectionObject.sibling_order.is_(None),
            CollectionObject.sibling_order,
            CollectionObject.object_number,
        )
        .offset(offset).limit(limit).all()
    )
    return rows, total


def child_counts(db: Session, org_id: UUID, parent_ids: list[UUID]) -> dict[UUID, int]:
    if not parent_ids:
        return {}
    rows = (
        db.query(CollectionObject.parent_object_id, func.count())
        .filter(
            CollectionObject.organization_id == org_id,
            CollectionObject.parent_object_id.in_(parent_ids),
            CollectionObject.is_deleted.is_(False),
        )
        .group_by(CollectionObject.parent_object_id)
        .all()
    )
    return {pid: n for pid, n in rows}


def descendant_ids(db: Session, org_id: UUID, root_id: UUID) -> list[UUID]:
    """Every descendant of ``root_id`` (not including it), depth bounded."""
    rows = db.execute(text("""
        WITH RECURSIVE tree(object_id, depth) AS (
            SELECT object_id, 1 FROM collections.collection_objects
             WHERE parent_object_id = :root AND organization_id = :org AND NOT is_deleted
            UNION ALL
            SELECT c.object_id, t.depth + 1 FROM collections.collection_objects c
              JOIN tree t ON c.parent_object_id = t.object_id
             WHERE c.organization_id = :org AND NOT c.is_deleted AND t.depth < :max
        )
        SELECT object_id FROM tree
    """), {"root": root_id, "org": org_id, "max": MAX_DEPTH}).fetchall()
    return [r[0] for r in rows]


def _subtree_height(db: Session, org_id: UUID, obj: CollectionObject) -> int:
    """Levels below ``obj`` (0 when it has no children)."""
    row = db.execute(text("""
        WITH RECURSIVE tree(object_id, depth) AS (
            SELECT object_id, 1 FROM collections.collection_objects
             WHERE parent_object_id = :root AND organization_id = :org AND NOT is_deleted
            UNION ALL
            SELECT c.object_id, t.depth + 1 FROM collections.collection_objects c
              JOIN tree t ON c.parent_object_id = t.object_id
             WHERE c.organization_id = :org AND NOT c.is_deleted AND t.depth <= :max
        )
        SELECT COALESCE(MAX(depth), 0) FROM tree
    """), {"root": obj.object_id, "org": org_id, "max": MAX_DEPTH}).scalar()
    return int(row or 0)


def validate_parent(db: Session, org_id: UUID, obj: CollectionObject | None, parent_id: UUID | None,
                    level: str | None) -> CollectionObject | None:
    """Check that ``obj`` (None when creating) may sit under ``parent_id``. Returns the parent."""
    if level is not None and level not in CATALOG_LEVELS:
        raise HierarchyError(f"Level must be one of: {', '.join(CATALOG_LEVELS)}")
    if parent_id is None:
        return None
    if obj is not None and parent_id == obj.object_id:
        raise HierarchyError("A record cannot be its own parent")
    parent = _get(db, org_id, parent_id)
    if parent is None:
        raise HierarchyError("The parent record was not found in this organization", status=404, code="not_found")
    if parent.catalog_level == "item":
        raise HierarchyError(f"{parent.object_number} is an item, and items cannot contain other records")
    if level == "collection":
        raise HierarchyError("A collection is the top level and cannot have a parent")
    chain = ancestors(db, org_id, parent) + [parent]
    if obj is not None and any(a.object_id == obj.object_id for a in chain):
        raise HierarchyError("That would place the record inside itself")
    height = _subtree_height(db, org_id, obj) if obj is not None else 0
    if len(chain) + 1 + height > MAX_DEPTH:
        raise HierarchyError(f"The hierarchy can be at most {MAX_DEPTH} levels deep")
    return parent


def next_sibling_order(db: Session, org_id: UUID, parent_id: UUID) -> int:
    current = db.query(func.max(CollectionObject.sibling_order)).filter(
        CollectionObject.organization_id == org_id,
        CollectionObject.parent_object_id == parent_id,
    ).scalar()
    return (current or 0) + 1


def set_parent(db: Session, org_id: UUID, obj: CollectionObject, parent_id: UUID | None,
               sibling_order: int | None = None) -> None:
    """Move ``obj`` under ``parent_id`` (None = make it a top-level record). Does not commit."""
    validate_parent(db, org_id, obj, parent_id, obj.catalog_level)
    if obj.catalog_level == "item" and child_counts(db, org_id, [obj.object_id]):
        raise HierarchyError("This record has children, so it cannot be an item")
    obj.parent_object_id = parent_id
    if parent_id is None:
        obj.sibling_order = None
    elif sibling_order is not None:
        obj.sibling_order = int(sibling_order)
    elif obj.sibling_order is None:
        obj.sibling_order = next_sibling_order(db, org_id, parent_id)


def check_level_change(db: Session, org_id: UUID, obj: CollectionObject, new_level: str | None) -> None:
    """Changing a record's level must keep the hierarchy valid."""
    if new_level is not None and new_level not in CATALOG_LEVELS:
        raise HierarchyError(f"Level must be one of: {', '.join(CATALOG_LEVELS)}")
    if new_level == "item" and child_counts(db, org_id, [obj.object_id]):
        raise HierarchyError("This record has children, so it cannot be an item")
    if new_level == "collection" and obj.parent_object_id:
        raise HierarchyError("A collection is the top level and cannot have a parent")


def reorder_children(db: Session, org_id: UUID, parent_id: UUID, ordered_ids: list[UUID]) -> None:
    """Set sibling_order 1..n following ``ordered_ids`` (must be exactly the children)."""
    rows, _ = children(db, org_id, parent_id, limit=10_000)
    current = {r.object_id: r for r in rows}
    if set(ordered_ids) != set(current) or len(ordered_ids) != len(current):
        raise HierarchyError("The new order must list every child of this record exactly once")
    for i, oid in enumerate(ordered_ids, start=1):
        current[oid].sibling_order = i


def move_child(db: Session, org_id: UUID, obj: CollectionObject, direction: str) -> None:
    """Swap ``obj`` with its previous or next sibling (accessible reordering)."""
    if not obj.parent_object_id:
        raise HierarchyError("Only records inside another record can be moved up or down")
    if direction not in ("up", "down"):
        raise HierarchyError("Direction must be up or down")
    rows, _ = children(db, org_id, obj.parent_object_id, limit=10_000)
    ids = [r.object_id for r in rows]
    i = ids.index(obj.object_id)
    j = i - 1 if direction == "up" else i + 1
    if j < 0 or j >= len(ids):
        raise HierarchyError("Already at the " + ("top" if direction == "up" else "bottom"), status=409, code="conflict")
    ids[i], ids[j] = ids[j], ids[i]
    reorder_children(db, org_id, obj.parent_object_id, ids)


def display_title(obj: CollectionObject) -> str:
    title = next((t.title for t in (obj.title_links or []) if t.is_preferred and t.title), None) \
        or next((t.title for t in (obj.title_links or []) if t.title), None)
    return title or obj.object_name or obj.object_number or "Untitled"


def node(obj: CollectionObject, child_count: int | None = None) -> dict:
    return {
        "object_id": str(obj.object_id),
        "object_number": obj.object_number,
        "title": display_title(obj),
        "catalog_level": obj.catalog_level,
        "level_label": LEVEL_LABELS.get(obj.catalog_level or "", (obj.catalog_level or "").title() or None),
        "date": obj.creation_date_display if hasattr(obj, "creation_date_display") else None,
        "parent_object_id": str(obj.parent_object_id) if obj.parent_object_id else None,
        "sibling_order": obj.sibling_order,
        "child_count": child_count,
    }
