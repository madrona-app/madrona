"""Edit a record's child-row collection in place.

Used by object saves and by the import connector so both record a change to
a title, measurement or number as one edit, not a removal and an addition;
and by the other saves that used to replace a set of rows wholesale (variant
terms, portal page blocks and menu items, media tags, lookup sort order).
"""

from sqlalchemy import inspect as sa_inspect
from sqlalchemy.orm import object_session


def blank_to_none(value):
    if isinstance(value, str):
        value = value.strip()
        return value or None
    return value


def _match_rows(existing, desired, fields, key_fields=()):
    """Pair each desired item with an existing row.

    Matching runs in passes: rows whose values are unchanged, then rows with
    the same key (e.g. the same dimension), then the remaining rows in order.
    Returns (assigned, remaining): assigned[i] is the row for desired[i] or
    None (a new row), remaining are existing rows with no desired item.
    """
    remaining = list(existing)
    assigned = [None] * len(desired)

    def row_vals(row, names):
        return tuple(blank_to_none(getattr(row, f)) for f in names)

    def item_vals(item, names):
        return tuple(blank_to_none(item.get(f)) for f in names)

    passes = [fields] + ([key_fields] if key_fields else [])
    for names in passes:
        for i, item in enumerate(desired):
            if assigned[i] is not None:
                continue
            want = item_vals(item, names)
            for row in remaining:
                if row_vals(row, names) == want:
                    assigned[i] = row
                    remaining.remove(row)
                    break
    for i in range(len(desired)):
        if assigned[i] is None and remaining:
            assigned[i] = remaining.pop(0)
    return assigned, remaining


def _apply(row, item, fields, order_field, index):
    for f in fields:
        if blank_to_none(getattr(row, f)) != blank_to_none(item.get(f)):
            setattr(row, f, item.get(f))
    if order_field and getattr(row, order_field) != index:
        setattr(row, order_field, index)


def reconcile_child_rows(collection, desired, model, fields, org_uuid, user_uuid, key_fields=()):
    """Bring a child-row collection in line with ``desired`` by editing it in place.

    Rows are matched rather than cleared and recreated, so the audit trail
    records what actually changed ("measurement height: 10 cm -> 12 cm")
    instead of every row being removed and added on each save. Leftover
    desired items become new rows; leftover existing rows are deleted.
    """
    assigned, remaining = _match_rows(collection, desired, fields, key_fields)

    for row in remaining:
        collection.remove(row)
        # Delete explicitly rather than leaving it to delete-orphan: orphans
        # are only resolved inside the flush, after the audit listener's
        # before_flush has looked at session.deleted.
        sess = object_session(row)
        if sess is not None and sa_inspect(row).persistent:
            sess.delete(row)

    for i, item in enumerate(desired):
        row = assigned[i]
        if row is None:
            collection.append(model(
                organization_id=org_uuid, display_order=i, created_by=user_uuid,
                **{f: item.get(f) for f in fields},
            ))
            continue
        _apply(row, item, fields, "display_order", i)


def reconcile_rows(session, existing, desired, fields, make_row, key_fields=(), order_field="display_order"):
    """``reconcile_child_rows`` for rows with no relationship collection.

    ``existing`` is the current rows (a query result); ``make_row(index,
    item)`` builds a new row for an unmatched desired item. Unmatched
    existing rows are deleted through the session and changed values are
    set in place, so an unchanged save writes (and records) nothing.
    ``order_field`` (or None) is kept equal to each item's position.
    Returns the rows in desired order.
    """
    assigned, remaining = _match_rows(existing, desired, fields, key_fields)
    for row in remaining:
        session.delete(row)
    out = []
    for i, item in enumerate(desired):
        row = assigned[i]
        if row is None:
            row = make_row(i, item)
            session.add(row)
        else:
            _apply(row, item, fields, order_field, i)
        out.append(row)
    return out
