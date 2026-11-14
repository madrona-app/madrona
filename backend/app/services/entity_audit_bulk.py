"""Audit events for SQL-level bulk writes.

The before_flush listener in ``entity_audit`` only sees changes made through
the ORM unit of work. A few paths change many audited rows with a single
UPDATE or DELETE statement so they stay fast on large batches (clearing a
completeness rule's flags across a whole organization, re-pointing records
when two people are merged). Those paths call these helpers first, with the
rows' current values loaded, so each record's history still says who
changed what, field by field.

Lookups needed for readable events (the parent record's display key, the
linked record's name) are batched per chunk, and events and their field
diffs are written with one multi-row INSERT each, so the cost stays
proportional to the number of rows rather than the number of queries.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Iterable, Sequence

from sqlalchemy import insert, inspect
from sqlalchemy.orm import Session

from app.models import EntityAuditEvent, EntityAuditFieldDiff
from app.services import entity_audit as ea

FieldChange = tuple[str, Any, Any]

CHUNK_SIZE = 1000


def _chunks(items: Sequence[Any], size: int = CHUNK_SIZE) -> Iterable[Sequence[Any]]:
    for i in range(0, len(items), size):
        yield items[i:i + size]


def _load_attr_map(session: Session, model_name: str | None, ids: Iterable[Any], attr: str | None) -> dict[Any, Any]:
    """{pk: getattr(row, attr)} for the given ids, one query per chunk."""
    ids = [i for i in dict.fromkeys(ids) if i is not None]
    if not model_name or not attr or not ids:
        return {}
    cls = ea._resolve_model_class(session, model_name)
    if cls is None or not hasattr(cls, attr):
        return {}
    pk = inspect(cls).primary_key[0]
    pk_attr = getattr(cls, pk.key)
    out: dict[Any, Any] = {}
    for chunk in _chunks(ids):
        for row_id, value in session.query(pk_attr, getattr(cls, attr)).filter(pk_attr.in_(list(chunk))):
            out[row_id] = value
    return out


class _Writer:
    """Collects events and diffs, then inserts them in multi-row statements."""

    def __init__(self, session: Session):
        self.session = session
        self.user_id, self.user_name, self.user_email = ea._get_current_user(session)
        self.req = ea._get_request_context()
        self.now = datetime.now(timezone.utc)
        self.events: list[dict[str, Any]] = []
        self.diffs: list[dict[str, Any]] = []

    def add(
        self,
        *,
        organization_id: Any,
        entity_type: str,
        entity_id: Any,
        entity_display_key: str | None,
        change_type: str,
        summary: str,
        changes: list[FieldChange],
        child_type: str | None = None,
        child_id: Any = None,
        child_display: str | None = None,
    ) -> None:
        event_id = uuid.uuid4()
        self.events.append({
            "event_id": event_id,
            "organization_id": organization_id,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "entity_display_key": entity_display_key,
            "change_type": change_type,
            "changed_at": self.now,
            "changed_by": self.user_id,
            "changed_by_name": self.user_name,
            "changed_by_email": self.user_email,
            "request_path": self.req["request_path"],
            "request_method": self.req["request_method"],
            "ip_address": self.req["ip_address"],
            "user_agent": self.req["user_agent"],
            "changed_fields": [c[0] for c in changes] or None,
            "summary": summary[:500],
            "child_entity_type": child_type,
            "child_entity_id": child_id,
            "child_display_key": child_display,
        })
        for field_name, old, new in changes:
            self.diffs.append({
                "diff_id": uuid.uuid4(),
                "event_id": event_id,
                "organization_id": organization_id,
                "field_name": field_name,
                "old_value": ea._serialize_value(old),
                "new_value": ea._serialize_value(new),
            })

    def flush(self) -> int:
        for chunk in _chunks(self.events):
            self.session.execute(insert(EntityAuditEvent), list(chunk))
        for chunk in _chunks(self.diffs):
            self.session.execute(insert(EntityAuditFieldDiff), list(chunk))
        count = len(self.events)
        self.events, self.diffs = [], []
        return count


def record_entity_updates(
    session: Session,
    class_name: str,
    items: Sequence[tuple[Any, list[FieldChange]]],
) -> int:
    """Write ``updated`` events for tracked records changed by a bulk UPDATE.

    ``items`` pairs each record (an ORM instance or any object with the
    record's primary key, organization_id and display-key attributes) with
    its (field, old, new) changes. Rows without changes are skipped.
    Returns the number of events written.
    """
    config = ea.TRACKED_ENTITIES.get(class_name)
    if not config:
        return 0
    writer = _Writer(session)
    for obj, changes in items:
        if not changes:
            continue
        org_id = ea._get_organization_id(obj)
        entity_id = ea._get_entity_pk(obj)
        changes = ea.apply_field_rules(class_name, changes)
        if not org_id or not entity_id or not changes:
            continue
        names = [c[0] for c in changes]
        writer.add(
            organization_id=org_id,
            entity_type=config["entity_type"],
            entity_id=entity_id,
            entity_display_key=ea._get_display_key(obj, config),
            change_type="updated",
            summary=ea._generate_summary("updated", config["entity_type"], names),
            changes=changes,
        )
    return writer.flush()


def record_link_events(
    session: Session,
    class_name: str,
    change_type: str,
    items: Sequence[tuple[Any, list[FieldChange] | None]],
) -> int:
    """Write link_removed / link_updated events on the parent record for child
    rows changed by a bulk DELETE or UPDATE.

    ``items`` pairs each loaded child row with its changes. For link_removed
    the changes may be None: the row's current values are recorded as the old
    values, as the listener does for a single delete. Returns the number of
    events written.
    """
    if not ea.TRACKED_LINKS.get(class_name) or not items:
        return 0
    # Resolve each row's config (a polymorphic row's parent depends on its
    # type column; suppressed or untracked parents drop out), then write
    # each group.
    groups: dict[tuple[str, str], tuple[dict[str, str], list]] = {}
    for obj, changes in items:
        cfg = ea.link_config_for(obj)
        if cfg is None:
            continue
        key = (cfg["parent_model"], cfg["parent_type"])
        groups.setdefault(key, (cfg, []))[1].append((obj, changes))
    return sum(_record_link_group(session, cfg, change_type, group) for cfg, group in groups.values())


def _record_link_group(session: Session, cfg: dict[str, str], change_type: str, items) -> int:
    label = cfg.get("link_label", "linked record")
    parent_model = cfg["parent_model"]
    parent_config = ea.TRACKED_ENTITIES.get(parent_model)

    parent_ids = {id(obj): ea._resolve_link_parent_id(session, obj, cfg) for obj, _ in items}
    parent_display = _load_attr_map(
        session, parent_model, parent_ids.values(),
        parent_config.get("display_key") if parent_config else None,
    )
    parent_org = {}
    if any(ea._get_organization_id(obj) is None for obj, _ in items):
        parent_org = _load_attr_map(session, parent_model, parent_ids.values(), "organization_id")
    linked_fk = cfg.get("linked_fk")
    linked_names = _load_attr_map(
        session, cfg.get("linked_model"),
        (getattr(obj, linked_fk, None) for obj, _ in items) if linked_fk else (),
        cfg.get("linked_display"),
    )

    writer = _Writer(session)
    for obj, changes in items:
        parent_id = parent_ids[id(obj)]
        org_id = ea._get_organization_id(obj) or parent_org.get(parent_id)
        if not parent_id or not org_id:
            continue
        linked = linked_names.get(getattr(obj, linked_fk, None)) if linked_fk else None
        linked = str(linked)[:200] if linked is not None else None

        if changes is not None:
            changes = ea.apply_field_rules(obj.__class__.__name__, changes)
        if changes is None:
            changes = [(f, v, None) for f, v in ea._shape_link_fields(obj, cfg)]
            if linked and change_type == "link_removed":
                changes.insert(0, (label, linked, None))
        if change_type == "link_updated" and not changes:
            continue

        child_type = cfg.get("child_type")
        child_id = child_display = None
        if child_type:
            id_field = cfg.get("child_id_field")
            child_id = getattr(obj, id_field, None) if id_field else ea._get_entity_pk(obj)
            display_field = cfg.get("display_field")
            value = getattr(obj, display_field, None) if display_field else None
            child_display = str(value)[:500] if value not in (None, "") else linked

        display_name = linked
        if not display_name and change_type != "link_removed":
            display_field = cfg.get("display_field")
            value = getattr(obj, display_field, None) if display_field else None
            display_name = str(value)[:200] if value is not None else None
        verb = {"link_removed": "Removed", "link_updated": "Updated", "link_added": "Added"}.get(change_type, "Changed")
        summary = f"{verb} {label}" + (f": {display_name}" if display_name else "")

        pd = parent_display.get(parent_id)
        writer.add(
            organization_id=org_id,
            entity_type=cfg["parent_type"],
            entity_id=parent_id,
            entity_display_key=str(pd)[:500] if pd is not None else None,
            change_type=change_type,
            summary=summary,
            changes=changes,
            child_type=child_type,
            child_id=child_id,
            child_display=child_display,
        )
    return writer.flush()
