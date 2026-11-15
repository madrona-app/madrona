"""Turn an IntegrityError into the HTTP error that describes it.

Routes used to answer every IntegrityError with 409 "may already exist", so a
value a CHECK constraint refused, a reference to a missing record, or a
missing required field all read as a duplicate. Only a unique violation is a
conflict; the others are bad input and are reported as 400 naming the field.
"""

from __future__ import annotations

import re
from functools import lru_cache

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

UNIQUE_VIOLATION = "23505"
CHECK_VIOLATION = "23514"
FOREIGN_KEY_VIOLATION = "23503"
NOT_NULL_VIOLATION = "23502"

_FK_KEY = re.compile(r"Key \(([^)]+)\)=")
_FIRST_IDENT = re.compile(r"\(*\s*([A-Za-z_][A-Za-z0-9_]*)")


@lru_cache(maxsize=None)
def _check_columns() -> dict[str, str]:
    """CHECK constraint name -> the column it constrains, from the models."""
    import app.models  # noqa: F401 - populate the metadata
    from app.database import Base

    out: dict[str, str] = {}
    for table in Base.metadata.tables.values():
        for constraint in table.constraints:
            if type(constraint).__name__ != "CheckConstraint" or not constraint.name:
                continue
            match = _FIRST_IDENT.match(str(constraint.sqltext))
            if match:
                out.setdefault(str(constraint.name), match.group(1))
    return out


def _sqlstate(exc: IntegrityError) -> str | None:
    orig = exc.orig
    return getattr(orig, "sqlstate", None) or getattr(orig, "pgcode", None)


def integrity_field(exc: IntegrityError) -> str | None:
    """The column an integrity violation is about, when the driver says."""
    diag = getattr(exc.orig, "diag", None)
    if diag is None:
        return None
    state = _sqlstate(exc)
    if state == NOT_NULL_VIOLATION:
        return diag.column_name
    if state == FOREIGN_KEY_VIOLATION:
        match = _FK_KEY.search(diag.message_detail or "")
        return match.group(1) if match else diag.column_name
    if state == CHECK_VIOLATION and diag.constraint_name:
        return _check_columns().get(diag.constraint_name, diag.constraint_name)
    return diag.column_name


def integrity_http_error(exc: IntegrityError, conflict_detail) -> HTTPException:
    """409 ``conflict_detail`` for a unique violation; 400 naming the field otherwise.

    The caller has already rolled back. Use as ``raise integrity_http_error(exc, ...)``.
    """
    state = _sqlstate(exc)
    text = str(exc.orig if exc.orig is not None else exc).lower()
    if state == UNIQUE_VIOLATION or (state is None and ("duplicate key" in text or "unique" in text)):
        return HTTPException(status_code=409, detail=conflict_detail)

    field = integrity_field(exc)
    if state == CHECK_VIOLATION or (state is None and "check constraint" in text):
        code, message = "invalid_value", f"Invalid value for {field}" if field else "Invalid value"
    elif state == FOREIGN_KEY_VIOLATION or (state is None and "foreign key" in text):
        code = "invalid_reference"
        message = f"{field} does not refer to an existing record" if field else "Referenced record does not exist"
    elif state == NOT_NULL_VIOLATION or (state is None and "null value" in text):
        code, message = "missing_field", f"Missing: {field}" if field else "A required field is missing"
    else:
        code, message = "constraint_violation", "The record could not be saved"
    detail = {"code": code, "message": message}
    if field:
        detail["field"] = field
    return HTTPException(status_code=400, detail=detail)
