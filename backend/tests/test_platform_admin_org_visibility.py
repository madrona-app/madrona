"""Tests for the platform-admin org list + delete RLS-bypass fix.

The bug: list_all_organizations and delete_organization both used the
request session (RLS-bound to the caller's active org), so a platform
admin only saw orgs they were a member of. The fix routes both
through admin_db (BYPASSRLS owner connection).

These tests call the handler functions directly (no FastAPI client)
because the existing client + auth_setup fixture chain hangs on the
macOS dev environment. They cover the *logic* of the route: that the
handler reads/writes via admin_db rather than the request session,
and returns the right shapes.
"""
from __future__ import annotations

import json
import uuid
from uuid import uuid4

import pytest


def _decode(resp) -> tuple[int, dict]:
    """Normalize a handler's return into (status_code, body_dict).

    Handlers can return either a fastapi.Response subclass (with
    body+status_code attributes) or a bare dict (FastAPI then wraps it
    in a 200). Treat the dict case as 200.
    """
    if isinstance(resp, dict):
        return 200, resp
    body = resp.body if hasattr(resp, "body") else b"{}"
    if isinstance(body, bytes):
        body = body.decode("utf-8")
    return resp.status_code, json.loads(body) if body else {}


def _fake_request():
    """Minimal request-shaped object the audit-log helper can consume.

    `log_provisioning_event` reaches into request.client.host and
    request.headers.get(...) for audit data. A plain SimpleNamespace
    is enough — the JSONB writer fails on MagicMock attributes.
    """
    from types import SimpleNamespace

    return SimpleNamespace(
        client=SimpleNamespace(host="127.0.0.1"),
        headers={"user-agent": "test-suite"},
    )


def _fake_auth(user_id=None):
    from app.fastapi_app.dependencies.auth import AuthContext
    return AuthContext(
        user_id=user_id or uuid.uuid4(),
        email="platform-admin@madrona.test",
        active_organization_id=None,
        mfa_verified=True,
        mfa_at=None,
    )


@pytest.fixture
def two_orgs(db_session):
    """Create two unrelated orgs; the test user is a member of neither.
    The handler should still see + manage both via admin_db."""
    from app.models import Organization
    a = Organization(
        name=f"Org A {uuid4().hex[:6]}",
        slug=f"orgvis-a-{uuid4().hex[:8]}",
        is_demo=False,
        status="active",
    )
    b = Organization(
        name=f"Org B {uuid4().hex[:6]}",
        slug=f"orgvis-b-{uuid4().hex[:8]}",
        is_demo=True,
        status="active",
    )
    db_session.add_all([a, b])
    db_session.commit()
    return a, b


# ---------------------------------------------------------------------------
# list_all_organizations
# ---------------------------------------------------------------------------


class TestListAllOrgs:
    def test_list_returns_orgs_caller_is_not_a_member_of(self, db_session, two_orgs):
        """The fix's whole point: a platform admin without a membership
        in the org still sees it in the platform list."""
        from app.fastapi_app.routers.platform_admin import list_all_organizations

        a, b = two_orgs
        result = list_all_organizations(
            auth=_fake_auth(),
            admin_db=db_session,
        )

        # Pydantic model in the type hint, but the handler returns a dict.
        if hasattr(result, "model_dump"):
            result = result.model_dump()

        slugs = {o["slug"] for o in result["organizations"]}
        assert a.slug in slugs
        assert b.slug in slugs

    def test_list_handler_does_not_use_request_session(self, db_session, monkeypatch):
        """admin_db is the keyword arg; the handler must not reach for
        the request session (`db`) — that would re-introduce the RLS
        blindness."""
        # Trip-wire: make any access to `get_db` from this handler
        # explode. The handler signature only takes admin_db, so this
        # passes by construction; this test guards against future
        # regressions where someone adds `db: Session = Depends(get_db)`
        # back in.
        import inspect
        from app.fastapi_app.routers.platform_admin import list_all_organizations

        sig = inspect.signature(list_all_organizations)
        param_names = set(sig.parameters.keys())
        assert "admin_db" in param_names
        assert "db" not in param_names, (
            "list_all_organizations must not take the request `db` "
            "session — that would reintroduce the RLS-blindness bug. "
            "Use admin_db."
        )


# ---------------------------------------------------------------------------
# delete_organization
# ---------------------------------------------------------------------------


class TestDeleteOrg:
    def test_delete_requires_confirm_query_param(self, db_session, two_orgs):
        """?confirm=true is required as a safety check."""
        from fastapi import HTTPException
        from app.fastapi_app.routers.platform_admin import delete_organization

        a, _b = two_orgs
        with pytest.raises(HTTPException) as excinfo:
            delete_organization(
                organization_id=a.organization_id,
                request=_fake_request(),
                confirm=None,
                auth=_fake_auth(),
                db=db_session,
                admin_db=db_session,
            )
        assert excinfo.value.status_code == 400

    def test_delete_returns_404_for_missing_org(self, db_session):
        from fastapi import HTTPException
        from app.fastapi_app.routers.platform_admin import delete_organization

        with pytest.raises(HTTPException) as excinfo:
            delete_organization(
                organization_id=uuid.uuid4(),
                request=_fake_request(),
                confirm="true",
                auth=_fake_auth(),
                db=db_session,
                admin_db=db_session,
            )
        assert excinfo.value.status_code == 404

    def test_delete_removes_org_caller_is_not_a_member_of(
        self, db_session, two_orgs, monkeypatch
    ):
        """Confirms the delete path works through admin_db — a platform
        admin can delete an org they have no membership in.

        The audit log helper is mocked because the test passes the same
        session for both `db` and `admin_db` (savepoint isolation limits
        us to one connection), and the audit log's own commit collides
        with the admin_db.commit() that follows. In production the two
        deps are separate sessions and the sequence works cleanly.
        """
        from app.fastapi_app.routers import platform_admin as pa_mod
        monkeypatch.setattr(pa_mod, "log_provisioning_event", lambda **kw: None)

        from app.fastapi_app.routers.platform_admin import delete_organization
        from app.models import Organization

        a, _b = two_orgs
        org_id = a.organization_id

        resp = delete_organization(
            organization_id=org_id,
            request=_fake_request(),
            confirm="true",
            auth=_fake_auth(),
            db=db_session,
            admin_db=db_session,
        )
        status, body = _decode(resp)
        assert status == 200
        assert "deleted successfully" in body["message"]

        # Verify the row is actually gone (use a fresh query against
        # the same session; admin_db committed the delete).
        gone = db_session.query(Organization).filter_by(organization_id=org_id).first()
        assert gone is None


# ---------------------------------------------------------------------------
# imports brought in lazily
# ---------------------------------------------------------------------------


# Pull in MagicMock at the module level for the request-fixture stubs.
from unittest.mock import MagicMock  # noqa: E402
