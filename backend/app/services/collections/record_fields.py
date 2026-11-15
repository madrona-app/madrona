"""Apply a procedure form's fields to its record — one path for create and update.

The procedure routers used to copy request fields onto a record only on
update; create went through shared creation services that set a hand-picked
list of columns, so everything else a user entered on a new record was
silently dropped. Both paths now call ``apply_record_fields`` with the same
protected set (system columns, workflow-set columns, and the caller's
write-restricted fields from field access), after the creation service has
done the work only it can do (numbering, approval gate, linked records).
"""
from __future__ import annotations

from typing import Any
from uuid import UUID

import sqlalchemy as sa

from app.services.coerce import coerce_value_for_column

# Never taken from a request body on either path.
SYSTEM_FIELDS = frozenset({
    "organization_id", "created_at", "created_by", "updated_at", "updated_by", "version",
})


def _columns(model) -> frozenset[str]:
    return frozenset(a.key for a in sa.inspect(model).column_attrs)


def apply_record_fields(
    entity,
    model,
    data: dict[str, Any],
    protected: set[str] | frozenset[str],
    *,
    field_mapping: dict[str, str] | None = None,
    blank_to_none: bool = False,
) -> list[tuple[str, Any, Any]]:
    """Copy ``data`` onto ``entity``'s columns, skipping ``protected``.

    ``field_mapping`` maps API names to column names (e.g. object entry
    ``reason`` -> ``entry_reason``); a field is skipped when either name is
    protected. Only real columns are written, never relationships. ``*_id``
    values are parsed as UUIDs (empty means NULL); everything else goes
    through coerce_value_for_column. Returns ``(api_name, old, new)`` for each
    field written, for callers that audit changes.
    """
    mapping = field_mapping or {}
    columns = _columns(model)
    skip = set(protected) | SYSTEM_FIELDS
    written: list[tuple[str, Any, Any]] = []
    for key, value in data.items():
        attr = mapping.get(key, key)
        if attr not in columns or key in skip or attr in skip:
            continue
        if blank_to_none and value == "":
            value = None
        old = getattr(entity, attr)
        if attr.endswith("_id") and value:
            setattr(entity, attr, value if isinstance(value, UUID) else UUID(str(value)))
        elif attr.endswith("_id") and value in (None, ""):
            setattr(entity, attr, None)
        else:
            setattr(entity, attr, coerce_value_for_column(model, attr, value))
        written.append((key, old, value))
    return written
