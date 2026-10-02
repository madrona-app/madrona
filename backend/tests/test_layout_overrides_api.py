"""HTTP tests for the per-user layout-overrides router.

These run against a real Postgres session but deliberately bypass the shared
conftest harness (`test_engine` / `_seed_rls_policies_for_tests`): they create
only the three tables this feature touches and stub `require_auth` /
`get_db` via FastAPI dependency overrides. That keeps them runnable
independently of unrelated in-flight RLS-seed work on this branch, while still
exercising the real router handlers + DB (ownership scoping + the single-active
invariant).
"""

import os
import uuid
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import app.models as M
from app.models import Organization, User
from app.models.layout_preferences import UserLayoutOverride
from app.database import get_db
from app.fastapi_app.dependencies.auth import require_auth
from app.fastapi_app.routers.layout_overrides import router

_URL = os.environ["TEST_DATABASE_URL"]


@pytest.fixture(scope="module")
def engine():
    eng = create_engine(_URL, future=True)
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
def ctx(engine):
    """A fresh org + two users, an isolated session, and a TestClient whose
    auth identity can be swapped between the two users."""
    Session = sessionmaker(bind=engine, future=True, expire_on_commit=False)
    session = Session()

    org = Organization(
        name="Layout Test Org",
        slug=f"lyt-{uuid.uuid4().hex[:8]}",
        is_demo=False,
        status="active",
    )
    session.add(org)
    session.flush()
    user_a = User(
        email=f"a-{uuid.uuid4().hex[:8]}@example.com",
        password_hash="x",
        status="active",
    )
    user_b = User(
        email=f"b-{uuid.uuid4().hex[:8]}@example.com",
        password_hash="x",
        status="active",
    )
    session.add_all([user_a, user_b])
    session.flush()
    session.commit()

    ids = SimpleNamespace(
        org=org.organization_id, a=user_a.user_id, b=user_b.user_id
    )
    identity = {"user_id": ids.a, "org": ids.org}

    app = FastAPI()
    app.include_router(router)

    def _get_db_override():
        yield session  # shared session; closed in teardown, not per-request

    def _auth_override():
        return SimpleNamespace(
            user_id=identity["user_id"], active_organization_id=identity["org"]
        )

    app.dependency_overrides[get_db] = _get_db_override
    app.dependency_overrides[require_auth] = _auth_override
    client = TestClient(app)

    yield SimpleNamespace(client=client, ids=ids, identity=identity, session=session)

    session.query(UserLayoutOverride).filter_by(organization_id=ids.org).delete()
    session.query(User).filter(
        User.user_id.in_([ids.a, ids.b])
    ).delete(synchronize_session=False)
    session.query(Organization).filter_by(organization_id=ids.org).delete()
    session.commit()
    session.close()


def _create(client, *, name, surface="collection-object", object_type=None,
            make_active=True, hidden=None):
    return client.post(
        "/api/layout-overrides",
        json={
            "surface_key": surface,
            "object_type": object_type,
            "name": name,
            "delta": {"hidden_sections": hidden or []},
            "make_active": make_active,
        },
    )


def test_create_returns_201_active(ctx):
    r = _create(ctx.client, name="Default", hidden=["valuations"])
    assert r.status_code == 201
    body = r.json()
    assert body["name"] == "Default"
    assert body["is_active"] is True
    assert body["delta"]["hidden_sections"] == ["valuations"]


def test_list_scoped_to_user(ctx):
    _create(ctx.client, name="Mine")
    r = ctx.client.get("/api/layout-overrides")
    assert r.status_code == 200
    assert [o["name"] for o in r.json()] == ["Mine"]


def test_creating_active_deactivates_previous(ctx):
    a = _create(ctx.client, name="A").json()
    b = _create(ctx.client, name="B").json()
    rows = {o["name"]: o["is_active"] for o in ctx.client.get("/api/layout-overrides").json()}
    assert rows == {"A": False, "B": True}
    # exactly one active for the slot
    assert sum(rows.values()) == 1
    assert a["id"] and b["id"]


def test_activate_switches(ctx):
    a = _create(ctx.client, name="A").json()
    _create(ctx.client, name="B")  # B now active
    r = ctx.client.post(f"/api/layout-overrides/{a['id']}/activate")
    assert r.status_code == 200
    rows = {o["name"]: o["is_active"] for o in ctx.client.get("/api/layout-overrides").json()}
    assert rows == {"A": True, "B": False}


def test_distinct_object_type_can_both_be_active(ctx):
    _create(ctx.client, name="Painting", object_type="painting")
    _create(ctx.client, name="Photo", object_type="photograph")
    active = [o["name"] for o in ctx.client.get("/api/layout-overrides").json() if o["is_active"]]
    assert sorted(active) == ["Painting", "Photo"]


def test_update_renames_and_reedits(ctx):
    a = _create(ctx.client, name="Old", hidden=["rights"]).json()
    r = ctx.client.patch(
        f"/api/layout-overrides/{a['id']}",
        json={"name": "New", "delta": {"hidden_sections": ["nagpra"]}},
    )
    assert r.status_code == 200
    assert r.json()["name"] == "New"
    assert r.json()["delta"]["hidden_sections"] == ["nagpra"]


def test_list_filters_by_surface(ctx):
    _create(ctx.client, name="Obj", surface="collection-object")
    _create(ctx.client, name="Loan", surface="loan-in")
    r = ctx.client.get("/api/layout-overrides", params={"surface_key": "loan-in"})
    assert [o["name"] for o in r.json()] == ["Loan"]


def test_delete(ctx):
    a = _create(ctx.client, name="Gone").json()
    assert ctx.client.delete(f"/api/layout-overrides/{a['id']}").status_code == 204
    assert ctx.client.get("/api/layout-overrides").json() == []


def test_deactivate_switches_back_to_default(ctx):
    _create(ctx.client, name="A")  # active
    r = ctx.client.post(
        "/api/layout-overrides/deactivate", json={"surface_key": "collection-object"}
    )
    assert r.status_code == 204
    rows = ctx.client.get("/api/layout-overrides").json()
    assert len(rows) == 1  # variant kept, just not active
    assert [o for o in rows if o["is_active"]] == []


def test_ownership_isolation(ctx):
    a = _create(ctx.client, name="A's variant").json()
    # Switch identity to user B.
    ctx.identity["user_id"] = ctx.ids.b
    assert ctx.client.get("/api/layout-overrides").json() == []  # B sees nothing
    assert ctx.client.post(f"/api/layout-overrides/{a['id']}/activate").status_code == 404
    assert ctx.client.delete(f"/api/layout-overrides/{a['id']}").status_code == 404
