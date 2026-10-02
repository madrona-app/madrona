"""Single-source enum validation for collections write paths.

Second root cause of the demo "Invalid input" class: routers accept ``data:
dict`` and ``setattr`` enum fields with no write-validation, so an invalid value
(e.g. ``source_type='Auction House'``) either silently persists (for a field
with no CHECK) and bricks the page on read, or raises an opaque IntegrityError /
500 at commit (for a field with a CHECK). Four sources of truth disagreed
(lookup vocab / DB CHECK / backend / Zod) and the backend enforced none of them.

The fix keeps exactly ONE backend source of truth: the DB CHECK constraints
already declared on the SQLAlchemy models. This module introspects them at
runtime and rejects an out-of-set value with a clean 422 *before* the write
reaches the DB. Because the allowed set is derived from the same CHECK the DB
enforces, the backend can never reject a DB-valid value (no false 422 when
re-saving an existing record) nor accept a DB-invalid one (no IntegrityError).

Adding a CHECK to a model column (see Acquisition.source_type / legal_status)
automatically enrolls that column here — no second list to maintain.
"""
from __future__ import annotations

import re
from functools import lru_cache

from fastapi import HTTPException

# Matches the "<col> IN ('a', 'b', ...)" portion of a CHECK constraint, whether
# or not it is prefixed by "<col> IS NULL OR".
_IN_CLAUSE = re.compile(r"(\w+)\s+IN\s*\(([^)]*)\)", re.IGNORECASE)

# ``status`` is CHECK-constrained too, but status transitions are governed by
# workflow_definitions in the routers (which return a more specific 409 with the
# valid-transition context). Leave it to them rather than emit a blunt 422.
_EXCLUDED_COLUMNS = frozenset({"status"})


@lru_cache(maxsize=None)
def _enum_columns(model) -> dict[str, frozenset[str]]:
    """Map each enum-constrained column on ``model`` to its allowed value set,
    parsed from the model's CHECK constraints. Cached per model class."""
    out: dict[str, frozenset[str]] = {}
    for constraint in model.__table__.constraints:
        if type(constraint).__name__ != "CheckConstraint":
            continue
        match = _IN_CLAUSE.search(str(constraint.sqltext))
        if not match:
            continue
        column = match.group(1)
        if column in _EXCLUDED_COLUMNS:
            continue
        values = frozenset(
            v.strip().strip("'\"") for v in match.group(2).split(",") if v.strip()
        )
        # A column may appear in more than one CHECK; union the sets.
        out[column] = out.get(column, frozenset()) | values
    return out


def validate_enum_fields(model, data: dict) -> None:
    """Raise HTTP 422 if any enum-constrained column in ``data`` carries a value
    outside the model's allowed set.

    ``None`` and absent values are ignored — nullability is the column's own
    concern, and a partial update need not touch every field. ``status`` is
    excluded (see module docstring). Safe to call with the raw request ``data``
    dict before the setattr loop.
    """
    allowed = _enum_columns(model)
    if not allowed:
        return

    errors: dict[str, dict] = {}
    for key, value in data.items():
        if value is None or key not in allowed:
            continue
        if str(value) not in allowed[key]:
            errors[key] = {"value": value, "allowed": sorted(allowed[key])}

    if errors:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "invalid_enum_value",
                "message": "One or more fields have a value outside the allowed set.",
                "fields": errors,
            },
        )
