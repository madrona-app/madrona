"""Tests for per-user workspace layout overrides.

Covers the deterministic spine: the `FormLayoutDelta` validation contract and
the "at most one active variant per (user, surface, object_type)" partial
unique constraint. (Merge/compliance enforcement lives in the frontend
resolver and is tested there.)
"""

import os
import uuid
from types import SimpleNamespace

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

import app.models as M
from app.fastapi_app.schemas.layout_overrides import (
    FormLayoutDelta,
    LayoutOverrideCreate,
)
from app.models import Organization, User
from app.models.layout_preferences import UserLayoutOverride


# --- FormLayoutDelta validation (pure) --------------------------------------


def test_delta_defaults_empty():
    d = FormLayoutDelta()
    assert d.hidden_sections == []
    assert d.section_order == []
    assert d.group_order == []
    assert d.collapsed_groups == []


def test_delta_dedupes_and_strips():
    d = FormLayoutDelta(
        hidden_sections=["rights", "rights", "  ", "valuations", " nagpra "]
    )
    assert d.hidden_sections == ["rights", "valuations", "nagpra"]


def test_delta_rejects_unknown_keys():
    with pytest.raises(ValidationError):
        FormLayoutDelta(sections=["typo"])  # extra="forbid"


def test_delta_rejects_too_many_ids():
    with pytest.raises(ValidationError):
        FormLayoutDelta(section_order=[f"s{i}" for i in range(201)])


def test_delta_drops_overlong_id():
    d = FormLayoutDelta(hidden_sections=["x" * 81, "ok"])
    assert d.hidden_sections == ["ok"]


def test_create_requires_name_and_surface():
    with pytest.raises(ValidationError):
        LayoutOverrideCreate(surface_key="", name="x", delta=FormLayoutDelta())
    with pytest.raises(ValidationError):
        LayoutOverrideCreate(
            surface_key="collection-object", name="", delta=FormLayoutDelta()
        )


def test_create_make_active_defaults_true():
    c = LayoutOverrideCreate(
        surface_key="collection-object", name="Triage", delta=FormLayoutDelta()
    )
    assert c.make_active is True


# --- partial unique active constraint (DB) ----------------------------------


# Isolated Postgres session — created here rather than via the shared conftest
# fixtures so these constraint tests run independently of unrelated in-flight
# RLS-seed work on this branch. Only the three tables this feature touches are
# created (organizations/users have no outbound FKs).


@pytest.fixture(scope="module")
def _engine():
    eng = create_engine(os.environ["TEST_DATABASE_URL"], future=True)
    M.Base.metadata.create_all(
        eng,
        tables=[
            Organization.__table__,
            User.__table__,
            UserLayoutOverride.__table__,
        ],
        checkfirst=True,
    )
    yield eng
    eng.dispose()


@pytest.fixture()
def db(_engine):
    session = sessionmaker(bind=_engine, future=True, expire_on_commit=False)()
    org = Organization(
        name="Layout Constraint Org",
        slug=f"lyc-{uuid.uuid4().hex[:8]}",
        is_demo=False,
        status="active",
    )
    session.add(org)
    session.flush()
    user = User(
        email=f"c-{uuid.uuid4().hex[:8]}@example.com",
        password_hash="x",
        status="active",
    )
    session.add(user)
    session.flush()
    session.commit()
    ctx = SimpleNamespace(session=session, org=org.organization_id, user=user.user_id)
    yield ctx
    session.rollback()
    session.query(UserLayoutOverride).filter_by(organization_id=ctx.org).delete()
    session.query(User).filter_by(user_id=ctx.user).delete()
    session.query(Organization).filter_by(organization_id=ctx.org).delete()
    session.commit()
    session.close()


def _row(ctx, *, name, is_active, object_type=None, surface="collection-object"):
    return UserLayoutOverride(
        organization_id=ctx.org,
        user_id=ctx.user,
        surface_key=surface,
        object_type=object_type,
        name=name,
        delta={"hidden_sections": ["valuations"]},
        is_active=is_active,
    )


def test_single_active_variant_enforced(db):
    db.session.add(_row(db, name="A", is_active=True))
    db.session.commit()

    # A second ACTIVE variant for the same (user, surface, object_type=NULL)
    # must be rejected by the partial unique index.
    db.session.add(_row(db, name="B", is_active=True))
    with pytest.raises(IntegrityError):
        db.session.commit()
    db.session.rollback()


def test_multiple_inactive_variants_allowed(db):
    db.session.add(_row(db, name="A", is_active=True))
    db.session.add(_row(db, name="B", is_active=False))
    db.session.add(_row(db, name="C", is_active=False))
    db.session.commit()  # no constraint violation

    rows = (
        db.session.query(UserLayoutOverride)
        .filter_by(user_id=db.user, surface_key="collection-object")
        .all()
    )
    assert len(rows) == 3
    assert sum(1 for r in rows if r.is_active) == 1


def test_active_allowed_per_distinct_object_type(db):
    # Distinct object_type values are distinct slots → both may be active.
    db.session.add(_row(db, name="Painting", is_active=True, object_type="painting"))
    db.session.add(_row(db, name="Photo", is_active=True, object_type="photograph"))
    db.session.commit()  # no violation
