"""Every tracked record and child-row type records create, update and delete.

Rather than a hand-written case per model (which drifts as types are added),
this builds a row of each tracked model generically: required columns get a
value of their type (the first allowed value when a CHECK constraint lists
them), and required foreign keys get a real parent row built the same way.
It then changes one ordinary column and deletes the row, and asserts that
the history recorded all three steps: created / updated / deleted for a
tracked record, link_added / link_updated / link_removed on the parent for a
child row.
"""
import re
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import Boolean, CheckConstraint, Date, DateTime, Integer, Numeric, String, Text, inspect
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID as PG_UUID

from app import context as ctx
from app.database import Base
from app.models import EntityAuditEvent
from app.services import entity_audit as ea

_BY_NAME = {m.class_.__name__: m.class_ for m in Base.registry.mappers}
_BY_TABLE = {m.local_table.fullname: m.class_ for m in Base.registry.mappers}

# Value overrides where a generic value would not satisfy the schema.
_OVERRIDES: dict[str, dict] = {
    "Location": {"path": "LOC", "location_type": "room"},
    "Department": {"path": "DEP"},
    "VariantTerm": {"entity_type": "place_authority"},
    "EntityImage": {"entity_type": "incident_report"},
    "LoanRenewal": {"loan_type": "loan_in"},
    "ConstituentXref": {"entity_type": "collection_object"},
    # exactly one of object_id / entity_key
    "ExhibitionObject": {"entity_key": "external:1"},
}

# Polymorphic children: the parent id column must point at a real parent.
_POLY_PARENT = {
    "VariantTerm": ("entity_id", "PlaceAuthority"),
    "EntityImage": ("entity_id", "IncidentReport"),
    "LoanRenewal": ("loan_id", "LoanIn"),
}


def _check_values(table) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for c in table.constraints:
        if isinstance(c, CheckConstraint):
            for col, values in re.findall(r"(\w+)\s+IN\s*\(([^)]*)\)", str(c.sqltext), re.S):
                out[col] = re.findall(r"'([^']*)'", values)
    return out


def _value_for(col, allowed):
    if col.name in allowed and allowed[col.name]:
        return allowed[col.name][0]
    t = col.type
    if isinstance(t, (PG_UUID,)) or t.__class__.__name__ == "UUID":
        return uuid.uuid4()
    if isinstance(t, Boolean):
        return False
    if isinstance(t, Integer):
        return 1
    if isinstance(t, Numeric):
        return Decimal("1")
    if isinstance(t, DateTime):
        return datetime.now(timezone.utc)
    if isinstance(t, Date):
        return date.today()
    if isinstance(t, ARRAY):
        return []
    if isinstance(t, JSONB) or t.__class__.__name__ in ("JSON", "JSONType", "JSONB"):
        return {}
    if isinstance(t, String):
        n = t.length or 40
        return f"v{uuid.uuid4().hex}"[: max(1, min(n, 12))]
    if isinstance(t, Text):
        return "text"
    return None


class Factory:
    def __init__(self, db, org_id, user_id):
        self.db, self.org_id, self.user_id = db, org_id, user_id

    def build(self, cls, depth=0, **given):
        if depth > 6:
            raise RuntimeError(f"too deep building {cls.__name__}")
        table = cls.__table__
        allowed = _check_values(table)
        values = dict(_OVERRIDES.get(cls.__name__, {}))
        values.update(given)
        for col in table.columns:
            if col.name in values:
                continue
            if col.name == "organization_id":
                values[col.name] = self.org_id
                continue
            fks = list(col.foreign_keys)
            if fks and not col.nullable and not (col.primary_key and not fks):
                target = fks[0].column.table
                if target.fullname == "organizations":
                    values[col.name] = self.org_id
                elif target.fullname == "users":
                    values[col.name] = self.user_id
                else:
                    parent_cls = _BY_TABLE[target.fullname]
                    parent = self.build(parent_cls, depth + 1)
                    values[col.name] = getattr(parent, fks[0].column.key)
                continue
            if col.primary_key or col.nullable or col.default is not None or col.server_default is not None:
                continue
            values[col.name] = _value_for(col, allowed)
        mapper = inspect(cls)
        kwargs = {}
        for col_name, v in values.items():
            attr = next((p.key for p in mapper.column_attrs if p.columns[0].name == col_name), None)
            if attr:
                kwargs[attr] = v
        row = cls(**kwargs)
        self.db.add(row)
        self.db.flush()
        return row


def _editable_column(cls, rule_excluded, row=None):
    """An ordinary column whose change the history should record.

    (None, None) for a pure link row (only keys), which can be added and
    removed but has nothing to edit.
    """
    table = cls.__table__
    allowed = _check_values(table)
    skip = ea.EXCLUDED_FIELDS | rule_excluded | {"display_order", "organization_id"}
    props = [p for p in inspect(cls).column_attrs
             if not p.columns[0].primary_key and not p.columns[0].foreign_keys and p.key not in skip
             and p.columns[0].computed is None]
    for prop in props:
        col = prop.columns[0]
        if col.name in allowed:
            continue
        if isinstance(col.type, Text) or (isinstance(col.type, String) and (col.type.length or 999) >= 8):
            return prop.key, f"Changed {uuid.uuid4().hex[:4]}"
    for prop in props:
        col = prop.columns[0]
        if col.name in allowed:
            continue
        if isinstance(col.type, Boolean):
            return prop.key, None  # flip
        if isinstance(col.type, Integer):
            return prop.key, 7
    for prop in props:
        options = allowed.get(prop.columns[0].name) or []
        current = getattr(row, prop.key, None) if row is not None else None
        other = next((o for o in options if o != current), None)
        if other is not None:
            return prop.key, other
    return None, None


@pytest.fixture()
def acting(auth_setup, db_session):
    _, org, user = auth_setup
    token = ctx.request_user_id.set(str(user.user_id))
    try:
        yield db_session, org, user
    finally:
        ctx.request_user_id.reset(token)


def _events(db, org_id, entity_type, entity_id, child_type=None):
    db.expire_all()
    q = db.query(EntityAuditEvent).filter(
        EntityAuditEvent.organization_id == org_id,
        EntityAuditEvent.entity_type == entity_type,
        EntityAuditEvent.entity_id == entity_id,
    )
    if child_type:
        q = q.filter(EntityAuditEvent.child_entity_type == child_type)
    return [e.change_type for e in q.order_by(EntityAuditEvent.changed_at).all()]


def _change(row, field, value):
    if value is None:
        setattr(row, field, not bool(getattr(row, field)))
    else:
        setattr(row, field, value)


# Tracked records whose org is the row itself or that cannot be deleted
# generically are exercised by their own test files.
_ENTITY_SKIP = {
    "Organization": "the test organization itself; see test_entity_audit_settings",
}


@pytest.mark.parametrize("name", sorted(ea.TRACKED_ENTITIES))
def test_tracked_record_create_update_delete(acting, name):
    if name in _ENTITY_SKIP:
        pytest.skip(_ENTITY_SKIP[name])
    db, org, user = acting
    cls = _BY_NAME[name]
    cfg = ea.TRACKED_ENTITIES[name]
    excluded, _ = ea._field_rules(name)
    factory = Factory(db, org.organization_id, user.user_id)
    row = factory.build(cls)
    db.commit()
    rid = ea._get_entity_pk(row)
    field, value = _editable_column(cls, excluded, row)
    assert field, f"{name}: no ordinary column to change"
    _change(row, field, value)
    db.commit()
    db.delete(row)
    db.commit()
    assert _events(db, org.organization_id, cfg["entity_type"], rid) == ["created", "updated", "deleted"], (name, field)


_LINK_SKIP: dict[str, str] = {}


@pytest.mark.parametrize("name", sorted(ea.TRACKED_LINKS))
def test_child_row_add_update_remove(acting, name):
    if name in _LINK_SKIP:
        pytest.skip(_LINK_SKIP[name])
    db, org, user = acting
    cls = _BY_NAME[name]
    factory = Factory(db, org.organization_id, user.user_id)
    given = {}
    if name in _POLY_PARENT:
        col, parent_model = _POLY_PARENT[name]
        parent = factory.build(_BY_NAME[parent_model])
        given[col] = ea._get_entity_pk(parent)
    # A nullable parent key (or the first hop of a grandchild's chain) still
    # needs a real parent for the row to be attributed.
    base_cfg = ea.TRACKED_LINKS[name]
    p_fk = base_cfg["parent_fk"]
    if p_fk not in given:
        col = cls.__table__.columns[p_fk]
        fks = list(col.foreign_keys)
        if col.nullable and fks:
            parent = factory.build(_BY_TABLE[fks[0].column.table.fullname])
            given[p_fk] = getattr(parent, fks[0].column.key)
    row = factory.build(cls, **given)
    db.commit()
    cfg = ea.link_config_for(row)
    assert cfg is not None, name
    parent_id = ea._resolve_link_parent_id(db, row, cfg)
    assert parent_id, name
    excluded, _ = ea._field_rules(name)
    keys = {base_cfg.get("parent_type_field"), base_cfg["parent_fk"]} - {None}
    field, value = _editable_column(cls, excluded | ea._link_excluded(cfg) | keys, row)
    if field:
        _change(row, field, value)
        db.commit()
    db.delete(row)
    db.commit()
    child_type = cfg.get("child_type")
    kinds = _events(db, org.organization_id, cfg["parent_type"], parent_id, child_type)
    if not child_type:
        kinds = [k for k in kinds if k.startswith("link_")]
    expected = ["link_added", "link_updated", "link_removed"] if field else ["link_added", "link_removed"]
    assert kinds[-len(expected):] == expected, (name, field, kinds)
