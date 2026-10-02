"""
End-to-end bootstrap regression test for the /api/me handler.

Why this exists
---------------
Across one session we shipped four sequential RLS / auth bootstrap bugs
where ``GET /api/me`` returned 200 but with empty ``organizations`` /
``applications`` / ``permissions`` arrays. Every one of those bugs would
have been caught by a single test that:

  1. seeds a real Org + Role + Permissions + RolePermissions + User +
     OrganizationMembership + Application + OrganizationApplication +
     RefreshToken,
  2. hits ``GET /api/me`` with the refresh_token cookie set, and
  3. asserts the response body actually contains the seeded data.

The recurring failure mode was: handler runs without the right RLS
context for a given query, RLS filters every row out, the LEFT JOIN in
the applications query produces ``enabled=false``, and the
``organizations`` / ``permissions`` lists come back empty. Status code
is 200, frontend silently renders a logged-in user with no apps.

Two tests live in this file:

* ``TestMeBootstrapEndToEnd`` — happy path, asserts every populated key.
* ``TestMeBootstrapNoManualRlsContext`` — same fixture, but the handler
  itself is the *only* code that gets to set RLS context. This is the
  regression guard: if a future refactor removes
  ``set_rls_context_for_session`` from the /me handler, this test fails.

Style / patterns mirrored from ``test_auth_security.py`` (the
``_make_user`` helper, refresh-token cookie pattern from
``test_overview_preferences.py``).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from app.models import (
    Application,
    Organization,
    OrganizationApplication,
    OrganizationMembership,
    Permission,
    RefreshToken,
    Role,
    RolePermission,
    User,
)
from app.services.auth_utils import generate_refresh_token, hash_refresh_token


# ---------------------------------------------------------------------------
# Fixture builder (kept in-file — conftest already has _make_user-shaped
# helpers but none of them seed Application + OrganizationApplication +
# RefreshToken together, which is exactly the surface this regression
# guards. Inlined here to avoid bloating conftest for one test file).
# ---------------------------------------------------------------------------


def _seed_full_bootstrap_state(db_session, *, system_role: bool = False) -> dict:
    """Build the minimum viable state required for /api/me to populate
    every list it returns.

    Args:
        db_session: SQLAlchemy session.
        system_role: When True, seed a canonical *system* role
            (role_key='admin', is_system=True, organization_id=NULL) so
            that ``resolve_permissions_for_role`` routes through
            ``resolve_permissions_with_inheritance`` — the path real
            production /me requests take. When False (default), seed a
            custom (org-scoped) role with a synthetic role_key, which
            routes through the flat-permissions branch.

    Returns a dict with the plain refresh_token, ids of seeded rows, and
    the canonical permission keys / app key the test will assert on.
    """
    suffix = uuid4().hex[:8]

    org = Organization(
        name=f"Bootstrap Org {suffix}",
        slug=f"bootstrap-org-{suffix}",
        is_demo=False,
        status="active",
    )
    db_session.add(org)
    db_session.flush()

    if system_role:
        # Canonical system role — role_key MUST be in ROLE_INHERITANCE_MAP
        # or get_role_inheritance_chain raises ValueError and the resolver
        # returns an empty set. 'admin' is the top of the chain.
        # uq_role_key is unique globally, but conftest's per-test savepoint
        # isolation keeps this hermetic.
        role_key_value = "admin"
        is_system_value = True
        role_org_id_value = None
        role_type_expected = "system"
        role_display = "Admin (system, Bootstrap E2E)"
    else:
        # Custom org-scoped role with a synthetic key. Avoids any reliance
        # on the inheritance map; reads role_permissions rows directly.
        role_key_value = f"admin_e2e_{suffix}"
        is_system_value = False
        role_org_id_value = org.organization_id
        role_type_expected = "custom"
        role_display = "Admin (custom, Bootstrap E2E)"

    role = Role(
        role_key=role_key_value,
        display_name=role_display,
        description="Role used by the bootstrap regression test.",
        is_system=is_system_value,
        organization_id=role_org_id_value,
        is_active=True,
    )
    db_session.add(role)
    db_session.flush()

    # Seed a small but representative permission set. Production /me
    # assertions check that the permissions array is non-empty for the
    # active org; we want the keys to be recognisable so the assertion
    # is meaningful.
    permission_keys = [
        "collections.view",
        "collections.edit",
        "media.view",
        "org.manage_members",
    ]
    perms: list[Permission] = []
    for key in permission_keys:
        scope, action = key.split(".", 1)
        perm = Permission(
            permission_key=key,
            scope=scope,
            action=action,
            display_name=key.replace(".", " ").title(),
            description=f"Permission for {key}",
        )
        db_session.add(perm)
        perms.append(perm)
    db_session.flush()

    for perm in perms:
        db_session.add(
            RolePermission(role_id=role.role_id, permission_id=perm.permission_id)
        )
    db_session.flush()

    user = User(
        email=f"bootstrap-{suffix}@example.com",
        password_hash="not_used_in_tests",
        status="active",
    )
    db_session.add(user)
    db_session.flush()

    membership = OrganizationMembership(
        organization_id=org.organization_id,
        user_id=user.user_id,
        role="admin",  # legacy string column
        role_id=role.role_id,
        status="active",
    )
    db_session.add(membership)
    db_session.flush()

    # Application + OrganizationApplication (enabled=True). This is the
    # row that goes silently-empty when /me's RLS context is wrong: the
    # outer-join sees no OrganizationApplication and reports
    # enabled=false even though the row clearly exists.
    application = Application(
        key=f"flow_e2e_{suffix}",
        display_name="Flow (Bootstrap E2E)",
        description="Test application seeded by the auth bootstrap E2E.",
        icon="workflow",
        default_enabled=True,
        requires_contract=False,
        sort_order=0,
        status="active",
    )
    db_session.add(application)
    db_session.flush()

    org_app = OrganizationApplication(
        organization_id=org.organization_id,
        application_id=application.application_id,
        enabled=True,
    )
    db_session.add(org_app)
    db_session.flush()

    # Refresh token with active_organization_id set to the seeded org.
    # /me uses this both to scope the per-request RLS context AND to
    # decide which org to populate applications/permissions for.
    refresh_plain = generate_refresh_token()
    refresh_record = RefreshToken(
        user_id=user.user_id,
        token_hash=hash_refresh_token(refresh_plain),
        active_organization_id=org.organization_id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
    )
    db_session.add(refresh_record)

    db_session.commit()

    return {
        "refresh_token": refresh_plain,
        "user_id": str(user.user_id),
        "user_email": user.email,
        "org_id": str(org.organization_id),
        "org_name": org.name,
        "role_key": role.role_key,
        "role_id": str(role.role_id),
        "role_type_expected": role_type_expected,
        "permission_keys": permission_keys,
        "application_key": application.key,
    }


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestMeBootstrapEndToEnd:
    """Happy-path bootstrap: fresh DB, full state, /me returns populated
    organizations / applications / permissions / active_organization_id."""

    def test_me_returns_fully_populated_response(self, client, db_session):
        state = _seed_full_bootstrap_state(db_session)

        client.set_cookie("refresh_token", state["refresh_token"])
        resp = client.get("/api/me")

        assert resp.status_code == 200, (
            f"/api/me should succeed for a seeded user, got "
            f"{resp.status_code}: {resp.get_json()!r}"
        )
        data = resp.get_json()

        # ---- identity ----------------------------------------------------
        assert data["user_id"] == state["user_id"]
        assert data["email"] == state["user_email"]
        assert data["active_organization_id"] == state["org_id"], (
            "active_organization_id must be populated from the refresh "
            "token's active_organization_id; this is the field that, when "
            "missing, causes every downstream list to come back empty."
        )

        # ---- organizations -----------------------------------------------
        # The first regression we shipped this session: empty orgs list.
        # The membership query reads from organization_memberships, which
        # is RLS-scoped by user_id. Without the user_id half of the RLS
        # context, the policy filters every row out even though the row
        # exists.
        assert isinstance(data["organizations"], list)
        assert len(data["organizations"]) >= 1, (
            "organizations[] is empty — RLS likely filtered the "
            "OrganizationMembership row. Check that the /me handler "
            "calls set_rls_context_for_session with user_id set BEFORE "
            "the membership query runs."
        )
        seeded_org = next(
            (o for o in data["organizations"] if o["organization_id"] == state["org_id"]),
            None,
        )
        assert seeded_org is not None, (
            f"Seeded org {state['org_id']!r} not present in "
            f"organizations[]: got {data['organizations']!r}"
        )
        assert seeded_org["name"] == state["org_name"]
        assert seeded_org["role_key"] == state["role_key"]
        assert seeded_org["role_id"] == state["role_id"]

        # ---- applications ------------------------------------------------
        # Second + third regressions: organization_applications RLS was
        # the trickiest — without the org_id half of the RLS context the
        # outer-join in /me's app query saw no OrganizationApplication
        # rows and rendered every app as enabled=False even though the
        # row was present.
        assert isinstance(data["applications"], list)
        assert len(data["applications"]) >= 1, (
            "applications[] is empty — Application row missing or "
            "outer-join failed. Check RLS context on organization_applications."
        )
        seeded_app = next(
            (a for a in data["applications"] if a["key"] == state["application_key"]),
            None,
        )
        assert seeded_app is not None, (
            f"Seeded application {state['application_key']!r} missing "
            f"from applications[]: got {[a['key'] for a in data['applications']]!r}"
        )
        assert seeded_app["enabled"] is True, (
            "Application is present but enabled=False — this is the "
            "exact symptom of the RLS-context bug. The "
            "OrganizationApplication row exists in the DB but RLS "
            "filtered it out of the outer join, so the handler defaults "
            "enabled to False."
        )

        # ---- permissions -------------------------------------------------
        # Fourth regression: empty permissions list when role_permissions
        # / permissions tables had the right data but RLS or the get_user
        # _permissions service failed silently. /me catches and swallows
        # SQLAlchemyError so the only signal is an empty list.
        assert isinstance(data["permissions"], list)
        assert len(data["permissions"]) >= 1, (
            "permissions[] is empty — get_user_permissions returned no "
            "rows. Check that role_permissions are seeded AND that the "
            "RLS context lets the join read them."
        )
        for required_key in state["permission_keys"]:
            assert required_key in data["permissions"], (
                f"Expected permission {required_key!r} in /me response; "
                f"got {data['permissions']!r}"
            )

        # ---- role metadata -----------------------------------------------
        assert data["role_key"] == state["role_key"]
        assert data["role_id"] == state["role_id"]
        # Whichever branch the resolver took (system vs custom), /me must
        # round-trip role_type accurately.
        assert data["role_type"] == state["role_type_expected"]


class TestMeBootstrapNoManualRlsContext:
    """Regression guard.

    This test deliberately does NOT touch RLS context anywhere — the only
    code that sets ``app.current_org_id`` / ``app.current_user_id`` is
    the /me handler itself. If a future refactor removes the
    ``set_rls_context_for_session(...)`` call from /me, this test fails
    immediately with empty organizations / applications / permissions.

    The conftest's per-test connection has no app.* GUC set on it; the
    test client's request handler runs ``get_db`` which yields a fresh
    Session bound to the same connection. Whatever RLS context ends up
    visible to the handler's queries is whatever the handler itself sets.
    """

    def test_me_self_bootstraps_rls_without_external_help(
        self, client, db_session
    ):
        state = _seed_full_bootstrap_state(db_session)

        # NOTE: no set_rls_context_for_session call here. No fixture
        # massaging the connection's GUCs. The test deliberately gives
        # the handler nothing but a refresh_token cookie pointing at a
        # row that exists.
        client.set_cookie("refresh_token", state["refresh_token"])
        resp = client.get("/api/me")

        assert resp.status_code == 200
        data = resp.get_json()

        # All four arrays must be populated *purely* by the handler's
        # own bootstrap. If any of these regress to empty, /me has lost
        # its self-bootstrap and the four bugs from this session can
        # ship again.
        assert data["active_organization_id"] == state["org_id"]
        assert any(
            o["organization_id"] == state["org_id"]
            for o in data["organizations"]
        ), "organizations[] empty without external RLS — /me lost self-bootstrap"
        assert any(
            a["key"] == state["application_key"] and a["enabled"] is True
            for a in data["applications"]
        ), "applications[] empty without external RLS — /me lost self-bootstrap"
        assert state["permission_keys"][0] in data["permissions"], (
            "permissions[] empty without external RLS — /me lost self-bootstrap"
        )


class TestMeBootstrapSystemRoleResolution:
    """Regression guard for the *system role* permission-resolution path.

    ``resolve_permissions_for_role`` branches on ``role.is_system``. The
    other tests in this file use ``is_system=False`` (custom org-scoped
    role), which routes through the flat-permissions query that reads
    ``role_permissions`` rows directly. Production /me requests for the
    canonical 'admin' / 'curator' / 'viewer' roles take the *other*
    branch — ``resolve_permissions_with_inheritance`` — which walks
    ``ROLE_INHERITANCE_MAP`` and returns ``set()`` if the role_key
    isn't in the map.

    If the inheritance branch breaks (e.g. someone removes a role from
    the map without removing it from the seeds), the custom-role tests
    above still pass; only this one fails.
    """

    def test_me_resolves_system_role_via_inheritance_chain(
        self, client, db_session
    ):
        state = _seed_full_bootstrap_state(db_session, system_role=True)

        client.set_cookie("refresh_token", state["refresh_token"])
        resp = client.get("/api/me")

        assert resp.status_code == 200, resp.get_json()
        data = resp.get_json()

        # role_type must be 'system' — proves we took the inheritance
        # branch, not the flat one.
        assert data["role_type"] == "system"
        assert data["role_key"] == "admin"
        assert data["role_id"] == state["role_id"]

        # Permissions must come back populated — the regression bug this
        # branch hides is "ValueError caught, returns set()" which would
        # leave permissions[] empty even though role_permissions rows
        # exist.
        assert len(data["permissions"]) >= 1, (
            "permissions[] is empty under system-role resolution — the "
            "inheritance-chain branch may have raised ValueError and "
            "returned set(). Check that role_key is in ROLE_INHERITANCE_MAP."
        )
        for required_key in state["permission_keys"]:
            assert required_key in data["permissions"], (
                f"Expected seeded permission {required_key!r} in /me "
                f"response under system-role resolution; got "
                f"{data['permissions']!r}"
            )


# ---------------------------------------------------------------------------
# Sanity: missing / expired / revoked tokens still return 401. These
# aren't strictly part of the bootstrap regression, but they prove the
# handler's auth gate didn't get bypassed by the fixture's connection
# state. Cheap to include, valuable as a smoke test.
# ---------------------------------------------------------------------------


class TestMeBootstrapAuthGate:
    def test_me_without_cookie_returns_401(self, client, db_session):
        # Don't seed anything; just make sure no stale cookie is around
        # and that the gate fires.
        try:
            client.delete_cookie("refresh_token")
        except Exception:
            pass
        resp = client.get("/api/me")
        assert resp.status_code == 401

    def test_me_with_unknown_cookie_returns_401(self, client, db_session):
        client.set_cookie("refresh_token", "not-a-real-token-" + uuid4().hex)
        resp = client.get("/api/me")
        assert resp.status_code == 401

    def test_me_with_expired_token_returns_401(self, client, db_session):
        org = Organization(
            name=f"Expired Org {uuid4().hex[:6]}",
            slug=f"expired-org-{uuid4().hex[:6]}",
            status="active",
        )
        db_session.add(org)
        db_session.flush()
        user = User(
            email=f"expired-{uuid4().hex[:6]}@example.com",
            password_hash="x",
            status="active",
        )
        db_session.add(user)
        db_session.flush()

        plain = generate_refresh_token()
        rt = RefreshToken(
            user_id=user.user_id,
            token_hash=hash_refresh_token(plain),
            active_organization_id=org.organization_id,
            expires_at=datetime.now(timezone.utc) - timedelta(seconds=1),
        )
        db_session.add(rt)
        db_session.commit()

        client.set_cookie("refresh_token", plain)
        resp = client.get("/api/me")
        assert resp.status_code == 401
