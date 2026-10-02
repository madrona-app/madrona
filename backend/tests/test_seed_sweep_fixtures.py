"""
Tests for scripts/seed_sweep_fixtures.py.

The seeder fills NOT NULL columns from their types so the API sweep has a row
to address. It typed JSON columns by `python_type`, which SQLAlchemy reports as
`object` for JSON, so every NOT NULL json column fell through to the marker
string. That is valid JSON, the insert succeeded, and the API then failed to
serialize the row: the sweep reported GET /api/layout-overrides as a 500 the
application never produces on its own.
"""
from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest
from sqlalchemy import JSON

from app.models import Base

SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"


@pytest.fixture(scope="module")
def seeder():
    if str(SCRIPT_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPT_DIR))
    return importlib.import_module("seed_sweep_fixtures")


def _required_json_columns():
    """Org-scoped NOT NULL json columns the seeder has to invent a value for."""
    return [
        (table, column)
        for table in Base.metadata.tables.values()
        if "organization_id" in table.c
        for column in table.c
        if isinstance(column.type, JSON)
        and not column.nullable
        and column.default is None
        and column.server_default is None
    ]


def test_there_are_required_json_columns_to_cover():
    # Guards the test below against passing vacuously.
    assert _required_json_columns()


def test_required_json_columns_get_an_empty_object(seeder, db_session):
    org_id = "00000000-0000-0000-0000-000000000001"
    wrong = {
        f"{table.fullname}.{column.name}": value
        for table, column in _required_json_columns()
        if (value := seeder.value_for(db_session, table, column, org_id)) != {}
    }
    assert not wrong, f"json columns not seeded with {{}}: {wrong}"


def test_seeded_layout_override_serializes(seeder, db_session):
    """The row that produced the sweep's 500 now reads back through the API model."""
    from app.fastapi_app.schemas.layout_overrides import FormLayoutDelta
    from app.models.layout_preferences import UserLayoutOverride

    table = UserLayoutOverride.__table__
    delta = seeder.value_for(
        db_session, table, table.c.delta, "00000000-0000-0000-0000-000000000001"
    )
    FormLayoutDelta.model_validate(delta)
