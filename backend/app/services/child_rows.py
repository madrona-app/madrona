"""Edit a record's child-row collection in place.

Used by object saves and by the import connector so both record a change to
a title, measurement or number as one edit, not a removal and an addition.
"""

from sqlalchemy import inspect as sa_inspect
from sqlalchemy.orm import object_session


def blank_to_none(value):
    if isinstance(value, str):
        value = value.strip()
        return value or None
    return value


def reconcile_child_rows(collection, desired, model, fields, org_uuid, user_uuid, key_fields=()):
    """Bring a child-row collection in line with ``desired`` by editing it in place.

    Rows are matched rather than cleared and recreated, so the audit trail
    records what actually changed ("measurement height: 10 cm -> 12 cm")
    instead of every row being removed and added on each save. Matching runs
    in passes: rows whose values are unchanged, then rows with the same key
    (e.g. the same dimension), then the remaining rows in order. Leftover
    desired items become new rows; leftover existing rows are deleted.
    """
    remaining = list(collection)
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
        for f in fields:
            if blank_to_none(getattr(row, f)) != blank_to_none(item.get(f)):
                setattr(row, f, item.get(f))
        if row.display_order != i:
            row.display_order = i
