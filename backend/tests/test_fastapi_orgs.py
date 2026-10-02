"""
Tests for the FastAPI organization admin endpoints (Phase 3).

Tests 21 org admin routes: orgs CRUD, user management, invitations,
API keys, and the require_permission/require_fresh_mfa dependencies.
"""

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

from app.database import get_db
from app.services.auth_utils import (
    generate_access_token,
    generate_refresh_token,
    hash_refresh_token,
    hash_password,
)


@pytest.fixture(scope="session")
def fastapi_orgs_app():
    """Create a minimal FastAPI app with the organizations router."""
    from fastapi import FastAPI
    from app.fastapi_app.routers.organizations import router as orgs_router
    from app.fastapi_app.exception_handlers import register_exception_handlers
    from app.fastapi_app.middleware.csrf import CSRFMiddleware
    from app.fastapi_app.middleware.content_type import ContentTypeMiddleware
    from app.fastapi_app.middleware.security_headers import SecurityHeadersMiddleware
    from app.fastapi_app.middleware.request_logging import RequestLoggingMiddleware

    app = FastAPI()

    app.add_middleware(CSRFMiddleware)
    app.add_middleware(ContentTypeMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestLoggingMiddleware)

    register_exception_handlers(app)
    app.include_router(orgs_router)

    return app


@pytest.fixture()
def orgs_client(fastapi_orgs_app, app, db_session):
    """Synchronous test client for FastAPI org endpoints."""
    from fastapi.testclient import TestClient

    def _override_get_db():
        yield db_session

    fastapi_orgs_app.dependency_overrides[get_db] = _override_get_db

    with TestClient(fastapi_orgs_app) as client:
        yield client

    fastapi_orgs_app.dependency_overrides.clear()


@pytest.fixture()
def test_user(db_session):
    """Create a test user."""
    from app.models import User

    user = User(
        email="orgtest@example.com",
        display_name="Org Test User",
        status="active",
        cognito_sub="cognito-org-test-123",
        password_hash=hash_password("testpassword123"),
        # Verified so require_verified_email-gated endpoints (#70, e.g.
        # POST .../invitations) don't 403 for this authed user.
        email_verified_at=datetime.now(timezone.utc),
    )
    db_session.add(user)
    db_session.flush()
    return user


@pytest.fixture()
def org_admin_role(db_session):
    """Get or create the org_admin role."""
    from app.models import Role

    role = db_session.query(Role).filter_by(role_key="admin").first()
    if not role:
        role = Role(
            role_key="admin",
            display_name="Organization Administrator",
            is_system=True,
        )
        db_session.add(role)
        db_session.flush()
    return role


@pytest.fixture()
def viewer_role(db_session):
    """Get or create the viewer role."""
    from app.models import Role

    role = db_session.query(Role).filter_by(role_key="viewer").first()
    if not role:
        role = Role(
            role_key="viewer",
            display_name="Viewer",
            is_system=True,
        )
        db_session.add(role)
        db_session.flush()
    return role


@pytest.fixture()
def test_org(db_session):
    """Create a test organization."""
    from app.models import Organization

    org = Organization(
        name="Test Org",
        slug="test-org-admin",
        is_demo=False,
        status="active",
        timezone="UTC",
    )
    db_session.add(org)
    db_session.flush()
    return org


@pytest.fixture()
def test_membership(db_session, test_user, test_org, org_admin_role):
    """Create membership for user in org."""
    from app.models import OrganizationMembership

    membership = OrganizationMembership(
        organization_id=test_org.organization_id,
        user_id=test_user.user_id,
        role="admin",
        role_id=org_admin_role.role_id,
        status="active",
    )
    db_session.add(membership)
    db_session.commit()
    return membership


@pytest.fixture()
def platform_admin_permission(db_session, org_admin_role):
    """Set up platform.admin permission for the org_admin role."""
    from app.models.core import Permission as PermissionModel, RolePermission

    perm = db_session.query(PermissionModel).filter_by(permission_key="platform.admin").first()
    if not perm:
        perm = PermissionModel(
            permission_key="platform.admin",
            scope="platform",
            action="admin",
            display_name="Platform Admin",
            description="Platform admin",
        )
        db_session.add(perm)
        db_session.flush()

    rp = (
        db_session.query(RolePermission)
        .filter_by(role_id=org_admin_role.role_id, permission_id=perm.permission_id)
        .first()
    )
    if not rp:
        rp = RolePermission(role_id=org_admin_role.role_id, permission_id=perm.permission_id)
        db_session.add(rp)
        db_session.commit()

    return perm


@pytest.fixture()
def org_permissions(db_session, org_admin_role):
    """Set up org-level permissions for the org_admin role."""
    from app.models.core import Permission as PermissionModel, RolePermission

    permission_keys = [
        "org.manage_members",
        "org.manage_roles",
        "org.users.create",
        "org.users.update",
        "org.users.deactivate",
        "org.manage_api_keys",
        "org.manage_settings",
    ]

    perms = []
    for key in permission_keys:
        perm = db_session.query(PermissionModel).filter_by(permission_key=key).first()
        if not perm:
            # Parse "org.manage_members" -> scope="org", action="manage_members"
            parts = key.split(".", 1)
            scope = parts[0]
            action = parts[1] if len(parts) > 1 else key
            perm = PermissionModel(
                permission_key=key,
                scope=scope,
                action=action,
                display_name=key,
                description=key,
            )
            db_session.add(perm)
            db_session.flush()
        perms.append(perm)

        rp = (
            db_session.query(RolePermission)
            .filter_by(role_id=org_admin_role.role_id, permission_id=perm.permission_id)
            .first()
        )
        if not rp:
            rp = RolePermission(role_id=org_admin_role.role_id, permission_id=perm.permission_id)
            db_session.add(rp)

    db_session.commit()
    return perms


def _make_bearer_token(user, org=None, mfa=False, mfa_at=None):
    """Generate a Bearer token for testing."""
    return generate_access_token(
        user_id=str(user.user_id),
        email=user.email,
        active_organization_id=str(org.organization_id) if org else None,
        mfa_verified=mfa,
        mfa_at=mfa_at.isoformat() if mfa_at else None,
    )


def _auth_headers(token, csrf=True):
    """Generate auth + CSRF headers."""
    headers = {"Authorization": f"Bearer {token}"}
    if csrf:
        csrf_token = secrets.token_urlsafe(32)
        headers["X-CSRF-Token"] = csrf_token
        headers["Cookie"] = f"csrf_token={csrf_token}"
    return headers


# =============================================================================
# Timezone endpoint (public)
# =============================================================================


class TestTimezones:
    def test_list_timezones(self, orgs_client):
        resp = orgs_client.get("/api/timezones")
        assert resp.status_code == 200
        data = resp.json()
        assert "timezones" in data
        assert len(data["timezones"]) > 0

    def test_list_all_timezones(self, orgs_client):
        resp = orgs_client.get("/api/timezones?all=true")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["timezones"]) > 10


# =============================================================================
# Organization CRUD
# =============================================================================


class TestOrganizationCRUD:
    def test_list_organizations(
        self, orgs_client, test_user, test_org, test_membership
    ):
        token = _make_bearer_token(test_user, test_org)
        resp = orgs_client.get(
            "/api/organizations",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert any(o["slug"] == "test-org-admin" for o in data)

    def test_list_organizations_unauthenticated(self, orgs_client):
        resp = orgs_client.get("/api/organizations")
        assert resp.status_code == 401

    def test_create_organization_as_platform_admin(
        self,
        orgs_client,
        test_user,
        test_org,
        test_membership,
        platform_admin_permission,
    ):
        token = _make_bearer_token(test_user, test_org)
        csrf_token = secrets.token_urlsafe(32)
        resp = orgs_client.post(
            "/api/organizations",
            json={"name": "New Org", "slug": "new-org-slug"},
            headers={
                "Authorization": f"Bearer {token}",
                "X-CSRF-Token": csrf_token,
            },
            cookies={"csrf_token": csrf_token},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["slug"] == "new-org-slug"

    def test_create_organization_forbidden(
        self, orgs_client, test_user, test_org, test_membership
    ):
        """Non-platform-admin cannot create orgs."""
        token = _make_bearer_token(test_user, test_org)
        csrf_token = secrets.token_urlsafe(32)
        resp = orgs_client.post(
            "/api/organizations",
            json={"name": "Blocked", "slug": "blocked"},
            headers={
                "Authorization": f"Bearer {token}",
                "X-CSRF-Token": csrf_token,
            },
            cookies={"csrf_token": csrf_token},
        )
        assert resp.status_code == 403

    def test_update_organization(
        self,
        orgs_client,
        test_user,
        test_org,
        test_membership,
        org_permissions,
    ):
        token = _make_bearer_token(test_user, test_org)
        csrf_token = secrets.token_urlsafe(32)
        resp = orgs_client.patch(
            f"/api/organizations/{test_org.organization_id}",
            json={"name": "Updated Name"},
            headers={
                "Authorization": f"Bearer {token}",
                "X-CSRF-Token": csrf_token,
            },
            cookies={"csrf_token": csrf_token},
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "Updated Name"

    def test_update_organization_invalid_timezone(
        self,
        orgs_client,
        test_user,
        test_org,
        test_membership,
        org_permissions,
    ):
        token = _make_bearer_token(test_user, test_org)
        csrf_token = secrets.token_urlsafe(32)
        resp = orgs_client.patch(
            f"/api/organizations/{test_org.organization_id}",
            json={"timezone": "Not/A/Timezone"},
            headers={
                "Authorization": f"Bearer {token}",
                "X-CSRF-Token": csrf_token,
            },
            cookies={"csrf_token": csrf_token},
        )
        assert resp.status_code == 422


# =============================================================================
# Storage
# =============================================================================


class TestStorage:
    def test_get_storage(
        self, orgs_client, test_user, test_org, test_membership
    ):
        token = _make_bearer_token(test_user, test_org)
        resp = orgs_client.get(
            f"/api/organizations/{test_org.organization_id}/storage",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "usage" in data
        assert "region" in data

    def test_get_storage_non_member(self, orgs_client, test_user, test_org):
        """User not a member of the org cannot view storage."""
        token = _make_bearer_token(test_user, test_org)
        fake_org_id = uuid.uuid4()
        resp = orgs_client.get(
            f"/api/organizations/{fake_org_id}/storage",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 404

    def test_list_storage_regions(
        self, orgs_client, test_user, test_org, test_membership
    ):
        token = _make_bearer_token(test_user, test_org)
        resp = orgs_client.get(
            "/api/storage-regions",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "regions" in data
        assert len(data["regions"]) > 0


# =============================================================================
# require_permission dependency
# =============================================================================


class TestRequirePermission:
    def test_permission_granted(
        self,
        orgs_client,
        test_user,
        test_org,
        test_membership,
        org_permissions,
    ):
        """User with org.manage_members can list users."""
        token = _make_bearer_token(test_user, test_org)
        resp = orgs_client.get(
            f"/api/organizations/{test_org.organization_id}/users",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200

    def test_permission_denied(
        self,
        orgs_client,
        db_session,
        test_org,
    ):
        """User without permission gets 403."""
        from app.models import User, OrganizationMembership, Role

        # Create a viewer user with no permissions
        viewer = User(
            email="viewer@example.com",
            display_name="Viewer",
            status="active",
            password_hash=hash_password("password"),
        )
        db_session.add(viewer)
        db_session.flush()

        role = db_session.query(Role).filter_by(role_key="viewer").first()
        if not role:
            role = Role(role_key="viewer", display_name="Viewer", is_system=True)
            db_session.add(role)
            db_session.flush()

        membership = OrganizationMembership(
            organization_id=test_org.organization_id,
            user_id=viewer.user_id,
            role="member",
            role_id=role.role_id,
            status="active",
        )
        db_session.add(membership)
        db_session.commit()

        token = _make_bearer_token(viewer, test_org)
        resp = orgs_client.get(
            f"/api/organizations/{test_org.organization_id}/users",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 403

    def test_platform_admin_bypass(
        self,
        orgs_client,
        test_user,
        test_org,
        test_membership,
        platform_admin_permission,
    ):
        """Platform admin bypasses permission checks."""
        token = _make_bearer_token(test_user, test_org)
        resp = orgs_client.get(
            f"/api/organizations/{test_org.organization_id}/users",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200


# =============================================================================
# require_fresh_mfa dependency
# =============================================================================


class TestRequireFreshMFA:
    def test_mfa_missing(
        self,
        orgs_client,
        test_user,
        test_org,
        test_membership,
        org_permissions,
    ):
        """Request without MFA gets 401."""
        token = _make_bearer_token(test_user, test_org, mfa=False)
        csrf_token = secrets.token_urlsafe(32)
        resp = orgs_client.patch(
            f"/api/organizations/{test_org.organization_id}/users/{test_user.user_id}",
            json={"action": "deactivate"},
            headers={
                "Authorization": f"Bearer {token}",
                "X-CSRF-Token": csrf_token,
            },
            cookies={"csrf_token": csrf_token},
        )
        assert resp.status_code == 401
        assert resp.json()["error"]["mfaRequired"] is True

    def test_mfa_stale(
        self,
        orgs_client,
        test_user,
        test_org,
        test_membership,
        org_permissions,
    ):
        """Request with stale MFA gets 403."""
        stale_time = datetime.now(timezone.utc) - timedelta(minutes=30)
        token = _make_bearer_token(test_user, test_org, mfa=True, mfa_at=stale_time)
        csrf_token = secrets.token_urlsafe(32)
        resp = orgs_client.patch(
            f"/api/organizations/{test_org.organization_id}/users/{test_user.user_id}",
            json={"action": "deactivate"},
            headers={
                "Authorization": f"Bearer {token}",
                "X-CSRF-Token": csrf_token,
            },
            cookies={"csrf_token": csrf_token},
        )
        assert resp.status_code == 403
        assert resp.json()["error"]["mfaStale"] is True


# =============================================================================
# User management
# =============================================================================


class TestUserManagement:
    def test_list_users(
        self,
        orgs_client,
        test_user,
        test_org,
        test_membership,
        org_permissions,
    ):
        token = _make_bearer_token(test_user, test_org)
        resp = orgs_client.get(
            f"/api/organizations/{test_org.organization_id}/users",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "users" in data
        assert data["total"] >= 1

    @patch("app.services.cognito.cognito_admin_create_user")
    def test_create_user(
        self,
        mock_cognito,
        orgs_client,
        test_user,
        test_org,
        test_membership,
        org_permissions,
        org_admin_role,
    ):
        """Create a new user in the org (with mocked Cognito)."""
        mock_cognito.return_value = None
        mfa_at = datetime.now(timezone.utc) - timedelta(minutes=2)
        token = _make_bearer_token(test_user, test_org, mfa=True, mfa_at=mfa_at)
        csrf_token = secrets.token_urlsafe(32)
        resp = orgs_client.post(
            f"/api/organizations/{test_org.organization_id}/users",
            json={
                "email": "newuser@example.com",
                "name": "New User",
                "role_id": str(org_admin_role.role_id),
            },
            headers={
                "Authorization": f"Bearer {token}",
                "X-CSRF-Token": csrf_token,
            },
            cookies={"csrf_token": csrf_token},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["user"]["email"] == "newuser@example.com"
        assert data["user"]["created"] is True


# =============================================================================
# Invitations
# =============================================================================


class TestInvitations:
    @patch("app.services.invitation_service.create_invitation")
    def test_invite_user(
        self,
        mock_create,
        orgs_client,
        test_user,
        test_org,
        test_membership,
        org_permissions,
    ):
        """Invite a user to the org."""
        mock_invitation = MagicMock()
        mock_invitation.invitation_id = uuid.uuid4()
        mock_invitation.organization_id = test_org.organization_id
        mock_invitation.email = "invited@example.com"
        mock_invitation.role = "member"
        mock_invitation.expires_at = datetime.now(timezone.utc) + timedelta(days=7)
        mock_invitation.created_at = datetime.now(timezone.utc)
        mock_create.return_value = (mock_invitation, "test-token")

        token = _make_bearer_token(test_user, test_org)
        csrf_token = secrets.token_urlsafe(32)
        resp = orgs_client.post(
            f"/api/organizations/{test_org.organization_id}/invitations",
            json={"email": "invited@example.com", "role": "member"},
            headers={
                "Authorization": f"Bearer {token}",
                "X-CSRF-Token": csrf_token,
            },
            cookies={"csrf_token": csrf_token},
        )
        assert resp.status_code == 201
        assert resp.json()["email"] == "invited@example.com"


# =============================================================================
# API Keys
# =============================================================================


class TestAPIKeys:
    def test_create_api_key(
        self,
        orgs_client,
        test_user,
        test_org,
        test_membership,
        org_permissions,
    ):
        token = _make_bearer_token(test_user, test_org)
        csrf_token = secrets.token_urlsafe(32)
        resp = orgs_client.post(
            f"/api/organizations/{test_org.organization_id}/api-keys",
            json={
                "name": "Test Key",
                "scopes": ["read:datasets", "read:entities"],
            },
            headers={
                "Authorization": f"Bearer {token}",
                "X-CSRF-Token": csrf_token,
            },
            cookies={"csrf_token": csrf_token},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert "secret_api_key" in data
        assert data["name"] == "Test Key"

    def test_list_api_keys(
        self,
        orgs_client,
        test_user,
        test_org,
        test_membership,
        org_permissions,
    ):
        token = _make_bearer_token(test_user, test_org)
        resp = orgs_client.get(
            f"/api/organizations/{test_org.organization_id}/api-keys",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        assert "api_keys" in resp.json()

    def test_create_api_key_invalid_scopes(
        self,
        orgs_client,
        test_user,
        test_org,
        test_membership,
        org_permissions,
    ):
        token = _make_bearer_token(test_user, test_org)
        csrf_token = secrets.token_urlsafe(32)
        resp = orgs_client.post(
            f"/api/organizations/{test_org.organization_id}/api-keys",
            json={
                "name": "Bad Key",
                "scopes": ["invalid:scope"],
            },
            headers={
                "Authorization": f"Bearer {token}",
                "X-CSRF-Token": csrf_token,
            },
            cookies={"csrf_token": csrf_token},
        )
        assert resp.status_code in (400, 422)

    def test_create_api_key_duplicate_name(
        self,
        orgs_client,
        test_user,
        test_org,
        test_membership,
        org_permissions,
    ):
        token = _make_bearer_token(test_user, test_org)
        csrf_token = secrets.token_urlsafe(32)
        # Create first key
        orgs_client.post(
            f"/api/organizations/{test_org.organization_id}/api-keys",
            json={"name": "Duplicate Key", "scopes": ["read:datasets"]},
            headers={
                "Authorization": f"Bearer {token}",
                "X-CSRF-Token": csrf_token,
            },
            cookies={"csrf_token": csrf_token},
        )
        # Try to create duplicate
        resp = orgs_client.post(
            f"/api/organizations/{test_org.organization_id}/api-keys",
            json={"name": "Duplicate Key", "scopes": ["read:datasets"]},
            headers={
                "Authorization": f"Bearer {token}",
                "X-CSRF-Token": csrf_token,
            },
            cookies={"csrf_token": csrf_token},
        )
        assert resp.status_code == 409


class TestPlatformAdminCannotBeSelfGranted:
    """An org admin must not be able to mint cross-org platform access.

    `create_user_for_org` validated only that the submitted role_id EXISTS.
    The two sibling handlers that assign a role (_handle_role_update,
    _handle_reactivation) both refuse platform_admin, and get_organization_roles
    filters it out of the picker, so this was an omission, not a design choice.

    It matters more than an ordinary missing check: the platform_admin role's
    id is a fixed literal in seeds/seed_roles_and_permissions.py — public the
    moment the repo is — and `_is_platform_admin` matches a membership in ANY
    organization, so one grant inside a single tenant confers platform-wide
    access across all of them.
    """

    @patch("app.services.cognito.cognito_admin_create_user")
    def test_create_user_rejects_the_platform_admin_role(
        self,
        mock_cognito,
        orgs_client,
        test_user,
        test_org,
        test_membership,
        org_permissions,
        db_session,
    ):
        from app.models import Role

        mock_cognito.return_value = None
        platform_role = Role(
            role_id=uuid.uuid4(),
            role_key="platform_admin",
            display_name="Platform Admin",
            description="internal",
            is_system=True,
        )
        db_session.add(platform_role)
        db_session.flush()

        mfa_at = datetime.now(timezone.utc) - timedelta(minutes=2)
        token = _make_bearer_token(test_user, test_org, mfa=True, mfa_at=mfa_at)
        csrf_token = secrets.token_urlsafe(32)
        resp = orgs_client.post(
            f"/api/organizations/{test_org.organization_id}/users",
            json={
                "email": "attacker@example.com",
                "name": "Attacker",
                "role_id": str(platform_role.role_id),
            },
            headers={
                "Authorization": f"Bearer {token}",
                "X-CSRF-Token": csrf_token,
            },
            cookies={"csrf_token": csrf_token},
        )
        assert resp.status_code == 403, (
            "create_user_for_org accepted the platform_admin role "
            f"(got {resp.status_code}). That grants cross-organization "
            "platform access from inside a single tenant."
        )


class TestDeactivationEndsAccess:
    """Deactivating a membership must actually end the person's access.

    Setting `status = "deactivated"` does not, on its own, log anyone out:
    require_auth validates the USER row, which deactivation never touches; the
    Redis session cache is consulted before `revoked_at` is ever read; and RLS
    scopes on the org context the live session already holds. require_permission
    does filter on active membership, but require_org_role and
    _is_platform_admin did not — so a departing employee kept the org
    dashboards, and a platform admin kept everything, until their token expired.
    """

    @patch("app.services.email_service.get_email_service")
    def test_deactivation_revokes_refresh_tokens(
        self,
        mock_email,
        orgs_client,
        test_user,
        test_org,
        test_membership,
        org_permissions,
        db_session,
    ):
        from app.models import RefreshToken, User
        from app.services.auth_utils import generate_refresh_token, hash_refresh_token

        mock_email.return_value = MagicMock()

        # A second member, so the acting admin is not deactivating themselves.
        target = User(
            user_id=uuid.uuid4(),
            email=f"leaver-{uuid.uuid4().hex[:8]}@example.com",
            email_status="verified",
            status="active",
            mfa_version=0,
            recovery_codes_required=False,
        )
        db_session.add(target)
        db_session.flush()

        membership = type(test_membership)(
            membership_id=uuid.uuid4(),
            organization_id=test_org.organization_id,
            user_id=target.user_id,
            role=test_membership.role,
            role_id=test_membership.role_id,
            status="active",
        )
        db_session.add(membership)

        raw = generate_refresh_token()
        db_session.add(
            RefreshToken(
                user_id=target.user_id,
                token_hash=hash_refresh_token(raw),
                active_organization_id=test_org.organization_id,
                expires_at=datetime.now(timezone.utc) + timedelta(days=30),
            )
        )
        db_session.flush()

        mfa_at = datetime.now(timezone.utc) - timedelta(minutes=2)
        token = _make_bearer_token(test_user, test_org, mfa=True, mfa_at=mfa_at)
        csrf_token = secrets.token_urlsafe(32)
        resp = orgs_client.patch(
            f"/api/organizations/{test_org.organization_id}/users/{target.user_id}",
            json={"action": "deactivate"},
            headers={
                "Authorization": f"Bearer {token}",
                "X-CSRF-Token": csrf_token,
            },
            cookies={"csrf_token": csrf_token},
        )
        assert resp.status_code == 200, resp.json()

        live = (
            db_session.query(RefreshToken)
            .filter(
                RefreshToken.user_id == target.user_id,
                RefreshToken.revoked_at.is_(None),
            )
            .count()
        )
        assert live == 0, (
            "Deactivated member still holds a live refresh token; their "
            "session continues to authenticate until it expires."
        )
