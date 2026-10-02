"""Coerce JSON values to proper Python types for SQLAlchemy model columns."""

from __future__ import annotations

from datetime import date, datetime, time
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import inspect as sa_inspect
from sqlalchemy.types import Date, DateTime, Time


def coerce_value_for_column(model_class, column_name: str, value):
    """Coerce a JSON-deserialized value to match the SQLAlchemy column type.

    Handles the common case where date/datetime/time strings arrive from JSON
    but the model column expects a proper Python date/datetime/time object.
    Without this, setattr stores the raw string and serializers crash calling
    .isoformat() on str objects.
    """
    if value is None:
        return None

    try:
        mapper = sa_inspect(model_class)
        col = mapper.columns.get(column_name)
        if col is None:
            return value
    except Exception:
        return value

    col_type = col.type

    if isinstance(col_type, DateTime) and isinstance(value, str):
        try:
            return datetime.fromisoformat(value)
        except (ValueError, TypeError):
            return value

    if isinstance(col_type, Date) and not isinstance(col_type, DateTime) and isinstance(value, str):
        try:
            return date.fromisoformat(value)
        except (ValueError, TypeError):
            return value

    if isinstance(col_type, Time) and isinstance(value, str):
        try:
            return time.fromisoformat(value)
        except (ValueError, TypeError):
            return value

    return value


def check_version(entity, data: dict) -> None:
    """Check and consume the ``version`` field from *data* for optimistic concurrency.

    If the client sends a ``version`` key, it must match the entity's current
    version.  On mismatch a 409 Conflict is raised.  On match the version is
    incremented on the entity and removed from *data* so the field-update loop
    does not attempt to set it again.

    If the client does *not* send ``version``, the check is silently skipped so
    that existing callers are not broken.
    """
    client_version = data.pop("version", None)
    if client_version is None:
        return  # Client didn't send version — skip check (backwards-compatible)

    try:
        client_version = int(client_version)
    except (TypeError, ValueError):
        return  # Malformed — skip rather than block

    if not hasattr(entity, "version"):
        return  # Entity doesn't support versioning yet

    if entity.version != client_version:
        raise HTTPException(status_code=409, detail={
            "code": "conflict",
            "message": "This record was modified by another user. "
                       "Please refresh and re-apply your changes.",
            "server_version": entity.version,
            "client_version": client_version,
        })

    entity.version = entity.version + 1
