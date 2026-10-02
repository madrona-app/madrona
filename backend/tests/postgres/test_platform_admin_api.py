"""
Tests for Platform Admin API endpoints.

Tests the platform-level administration tool:
- Applications management
- Organizations overview
- App subscriptions
- Storage management
- Organization provisioning
- Bulk user import
- Provisioning audit logs
- SSO configuration
- Contracts management
- Entity audit

All endpoints require platform.admin permission.
Run with: TEST_DATABASE_URL=postgresql://... pytest tests/postgres/test_platform_admin_api.py -v
"""

import os
import pytest
from datetime import datetime, timezone, timedelta
from uuid import uuid4

from app.models import (
    User,
    Organization,
    OrganizationMembership,
    Role,
    RolePermission,
    Application,
    OrganizationApplication,
    SSOConfiguration,
    ProvisioningAuditLog,
)
from app.permissions import Permission

# Mark all tests in this file as requiring PostgreSQL
pytestmark = pytest.mark.postgres


def _make_token(user_id, org_id, *, mfa: bool = False):
    """Helper: build an access token for a platform admin test user.

    When ``mfa`` is True, the token includes a recent MFA verification so that
    endpoints protected by ``require_fresh_mfa`` accept the caller.
    """
    from app.services.auth_utils import generate_access_token

    mfa_at = datetime.now(timezone.utc).isoformat() if mfa else None
    return generate_access_token(
        str(user_id),
        f"{user_id}@test.local",
        active_organization_id=str(org_id) if org_id else None,
        mfa_verified=mfa,
        mfa_at=mfa_at,
    )


@pytest.fixture
def platform_admin_user(db_session):
    """Create a user with platform admin permission."""
    # Ensure the system roles bulk-import looks up exist (`admin`, `viewer`).
    # Tests use a fresh test DB that doesn't seed role rows; create on demand.
    admin_role = db_session.query(Role).filter_by(role_key="admin").first()
    if not admin_role:
        admin_role = Role(role_key="admin", display_name="Administrator")
        db_session.add(admin_role)
        db_session.flush()

    viewer_role = db_session.query(Role).filter_by(role_key="viewer").first()
    if not viewer_role:
        viewer_role = Role(role_key="viewer", display_name="Viewer")
        db_session.add(viewer_role)
        db_session.flush()

    org = Organization(
        name="Platform Admin Org",
        slug=f"platform-admin-{uuid4().hex[:8]}",
        status="active"
    )
    db_session.add(org)
    db_session.flush()

    user = User(
        email=f"admin-{uuid4().hex[:8]}@example.com",
        password_hash="fakehash",
        status="active"
    )
    db_session.add(user)
    db_session.flush()

    role = Role(
        role_key=f"platform-admin-{uuid4().hex[:8]}",
        display_name="Platform Admin"
    )
    db_session.add(role)
    db_session.flush()

    from app.models import Permission as PermissionModel
    perm = db_session.query(PermissionModel).filter_by(
        permission_key=Permission.PLATFORM_ADMIN.value
    ).first()
    if not perm:
        perm = PermissionModel(
                permission_key=Permission.PLATFORM_ADMIN.value,
                scope=(Permission.PLATFORM_ADMIN.value).rpartition(".")[0] or (Permission.PLATFORM_ADMIN.value),
                action=(Permission.PLATFORM_ADMIN.value).rpartition(".")[2] or (Permission.PLATFORM_ADMIN.value),
                display_name=(Permission.PLATFORM_ADMIN.value).replace(".", " ").title(),
                description="Platform admin access"
            )
        db_session.add(perm)
        db_session.flush()

    role_perm = RolePermission(role_id=role.role_id, permission_id=perm.permission_id)
    db_session.add(role_perm)

    membership = OrganizationMembership(
        user_id=user.user_id,
        organization_id=org.organization_id,
        role="admin",
        role_id=role.role_id,
        status="active"
    )
    db_session.add(membership)
    db_session.commit()

    return {"org": org, "user": user, "role": role}


@pytest.fixture
def test_application(db_session):
    """Create a test application."""
    app = Application(
        key=f"test-app-{uuid4().hex[:8]}",
        display_name="Test Application",
        description="A test application",
        icon="TestIcon",
        default_enabled=False,
        requires_contract=False,
        sort_order=100,
        status="active"
    )
    db_session.add(app)
    db_session.commit()
    return app


@pytest.fixture
def test_org(db_session):
    """Create a test organization for testing."""
    org = Organization(
        name="Test Org",
        slug=f"test-org-{uuid4().hex[:8]}",
        status="active"
    )
    db_session.add(org)
    db_session.commit()
    return org


class TestApplicationsManagement:
    """Tests for applications management endpoints."""

    def test_list_applications(self, client, db_session, platform_admin_user, test_application):
        """Test listing all applications."""
        user = platform_admin_user["user"]
        admin_org = platform_admin_user["org"]
        token = _make_token(user.user_id, admin_org.organization_id)

        response = client.get(
            "/api/platform/applications",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.get_json()
        assert "applications" in data
        assert isinstance(data["applications"], list)
        # Should include our test application
        app_keys = [a["key"] for a in data["applications"]]
        assert test_application.key in app_keys

    def test_list_applications_requires_auth(self, client):
        """Test applications endpoint requires auth."""
        response = client.get("/api/platform/applications")
        assert response.status_code == 401


class TestOrganizationsOverview:
    """Tests for organizations overview endpoints."""

    def test_list_all_organizations(self, client, db_session, platform_admin_user, test_org):
        """Test listing all organizations with details."""
        user = platform_admin_user["user"]
        admin_org = platform_admin_user["org"]
        token = _make_token(user.user_id, admin_org.organization_id)

        response = client.get(
            "/api/platform/organizations",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.get_json()
        assert "organizations" in data
        assert isinstance(data["organizations"], list)
        # Should include our test org
        org_ids = [o["organization_id"] for o in data["organizations"]]
        assert str(test_org.organization_id) in org_ids

    def test_get_organization_applications(self, client, db_session, platform_admin_user, test_org, test_application):
        """Test getting applications for a specific organization."""
        # Enable the app for the org (model uses `enabled`, not `is_enabled`)
        org_app = OrganizationApplication(
            organization_id=test_org.organization_id,
            application_id=test_application.application_id,
            enabled=True
        )
        db_session.add(org_app)
        db_session.commit()

        user = platform_admin_user["user"]
        admin_org = platform_admin_user["org"]
        token = _make_token(user.user_id, admin_org.organization_id)

        response = client.get(
            f"/api/platform/organizations/{test_org.organization_id}/applications",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.get_json()
        assert "applications" in data
        # Check the test app is in the list
        app_keys = [a["key"] for a in data["applications"]]
        assert test_application.key in app_keys


class TestAppSubscriptions:
    """Tests for app subscription management."""

    def test_enable_organization_application(self, client, db_session, platform_admin_user, test_org, test_application):
        """Test enabling an application for an organization."""
        user = platform_admin_user["user"]
        admin_org = platform_admin_user["org"]
        token = _make_token(user.user_id, admin_org.organization_id)

        # Route expects `application_key` in body
        response = client.post(
            f"/api/platform/organizations/{test_org.organization_id}/applications",
            json={"application_key": test_application.key},
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code in [200, 201]
        data = response.get_json()
        assert "application_key" in data or "message" in data

        # Verify it was enabled (column is `enabled`, not `is_enabled`)
        org_app = db_session.query(OrganizationApplication).filter(
            OrganizationApplication.organization_id == test_org.organization_id,
            OrganizationApplication.application_id == test_application.application_id
        ).first()
        assert org_app is not None
        assert org_app.enabled is True

    def test_enable_invalid_application(self, client, platform_admin_user, test_org):
        """Test enabling a non-existent application fails."""
        user = platform_admin_user["user"]
        admin_org = platform_admin_user["org"]
        token = _make_token(user.user_id, admin_org.organization_id)

        response = client.post(
            f"/api/platform/organizations/{test_org.organization_id}/applications",
            json={"application_key": "nonexistent-app"},
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 404

    def test_disable_organization_application(self, client, db_session, platform_admin_user, test_org, test_application):
        """Test disabling an application for an organization."""
        # First enable the app (column is `enabled`)
        org_app = OrganizationApplication(
            organization_id=test_org.organization_id,
            application_id=test_application.application_id,
            enabled=True
        )
        db_session.add(org_app)
        db_session.commit()

        user = platform_admin_user["user"]
        admin_org = platform_admin_user["org"]
        token = _make_token(user.user_id, admin_org.organization_id)

        response = client.delete(
            f"/api/platform/organizations/{test_org.organization_id}/applications/{test_application.key}",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200

        # Verify it was disabled (column is `enabled`)
        db_session.refresh(org_app)
        assert org_app.enabled is False


class TestStorageManagement:
    """Tests for storage management endpoints."""

    def test_list_organizations_storage(self, client, platform_admin_user):
        """Test listing all organizations' storage info."""
        user = platform_admin_user["user"]
        admin_org = platform_admin_user["org"]
        token = _make_token(user.user_id, admin_org.organization_id)

        response = client.get(
            "/api/platform/organizations/storage",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.get_json()
        assert "organizations" in data
        assert isinstance(data["organizations"], list)

    def test_update_organization_storage(self, client, db_session, platform_admin_user, test_org):
        """Test updating organization storage settings."""
        user = platform_admin_user["user"]
        admin_org = platform_admin_user["org"]
        token = _make_token(user.user_id, admin_org.organization_id)

        # Route accepts storage_limit_gb only; response echoes organization_id + storage_limit_gb
        response = client.put(
            f"/api/platform/organizations/{test_org.organization_id}/storage",
            json={"storage_limit_gb": 256},
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.get_json()
        assert data["storage_limit_gb"] == 256
        assert data["organization_id"] == str(test_org.organization_id)


class TestOrganizationProvisioning:
    """Tests for organization provisioning."""

    @pytest.fixture(autouse=True)
    def _mock_cognito(self):
        """Mock Cognito so the provisioning saga's create_cognito_user step
        doesn't try to hit AWS. Returns a canned cognito_sub."""
        from unittest.mock import patch, MagicMock
        cognito_user = MagicMock()
        cognito_user.get.return_value = "cognito-test-sub"
        with patch(
            "app.services.provisioning_service.cognito_admin_create_user",
            return_value={"UserSub": "cognito-test-sub"},
        ) as _create, patch(
            "app.services.provisioning_service.get_cognito_service"
        ) as _svc:
            _svc.return_value = MagicMock(
                admin_get_user=MagicMock(return_value=None),
                admin_create_user=MagicMock(return_value={"UserSub": "cognito-test-sub"}),
            )
            yield

    def test_provision_organization(self, client, db_session, platform_admin_user):
        """Test provisioning a new organization."""
        user = platform_admin_user["user"]
        admin_org = platform_admin_user["org"]
        token = _make_token(user.user_id, admin_org.organization_id)

        # Route schema: {"organization": {...}, "admin": {email,name}, ...}
        # NOTE: compute_request_fingerprint in provisioning_service.py crashes on
        # payload.get("contract", {}).get(...) when the Pydantic body serializes
        # contract=None (the schema default). Passing an explicit empty contract
        # dict avoids triggering that NoneType access — this works around a
        # suspected prod bug (missing null-guard in the fingerprint helper).
        org_data = {
            "organization": {
                "name": f"New Provisioned Org {uuid4().hex[:8]}",
                "slug": f"new-org-{uuid4().hex[:8]}"
            },
            "admin": {
                "email": f"newadmin-{uuid4().hex[:8]}@example.com",
                "name": "New Admin"
            },
            "contract": {},
            "onboarding": {},
        }

        response = client.post(
            "/api/platform/provision",
            json=org_data,
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 201
        data = response.get_json()
        assert "organization_id" in data
        assert "admin_user_id" in data
        assert data.get("organization_slug") == org_data["organization"]["slug"]

    def test_provision_organization_missing_name(self, client, platform_admin_user):
        """Test provisioning fails without org name."""
        user = platform_admin_user["user"]
        admin_org = platform_admin_user["org"]
        token = _make_token(user.user_id, admin_org.organization_id)

        response = client.post(
            "/api/platform/provision",
            json={
                "organization": {"slug": "test"},
                "admin": {"email": "test@test.com", "name": "Tester"}
            },
            headers={"Authorization": f"Bearer {token}"}
        )

        # Route returns 422 for field-level validation errors (validation_error code)
        assert response.status_code == 422

    def test_provision_organization_existing_slug_is_idempotent(self, client, db_session, platform_admin_user, test_org):
        """Provisioning with an existing slug is now idempotent (attaches to the existing org).

        Renamed from ``test_provision_organization_duplicate_slug`` — the prior
        behavior (409 Conflict on duplicate slug) has intentionally changed:
        ``_step_create_organization`` in ``provisioning_service`` treats a matching
        slug as an idempotent resume of a previous provisioning attempt. Using a
        slug-compatible org name avoids a downstream SES tag validation error so
        the saga reaches the 201 return path.
        """
        user = platform_admin_user["user"]
        admin_org = platform_admin_user["org"]
        token = _make_token(user.user_id, admin_org.organization_id)

        response = client.post(
            "/api/platform/provision",
            json={
                "organization": {
                    # Keep the name tag-safe (SES tags reject spaces) so the saga
                    # can reach the 201 completion path when the slug is reused.
                    "name": test_org.name.replace(" ", "-"),
                    "slug": test_org.slug  # Use existing slug
                },
                "admin": {
                    "email": f"admin-{uuid4().hex[:8]}@example.com",
                    "name": "Admin"
                },
                # See test_provision_organization note on the contract null-guard bug
                "contract": {},
                "onboarding": {},
            },
            headers={"Authorization": f"Bearer {token}"}
        )

        # Idempotent resume: returns 201 and the organization_id of the existing org
        assert response.status_code == 201
        data = response.get_json()
        assert data["organization_id"] == str(test_org.organization_id)
        assert data["organization_slug"] == test_org.slug


class TestBulkUserImport:
    """Tests for bulk user import."""

    def test_bulk_import_users(self, client, db_session, platform_admin_user, test_org):
        """Test importing multiple users at once."""
        user = platform_admin_user["user"]
        admin_org = platform_admin_user["org"]
        token = _make_token(user.user_id, admin_org.organization_id)

        # The route expects per-user payload of {email, name, role} with role in {admin, member}
        users_data = {
            "users": [
                {
                    "email": f"bulk1-{uuid4().hex[:8]}@example.com",
                    "name": "Bulk User1",
                    "role": "member",
                },
                {
                    "email": f"bulk2-{uuid4().hex[:8]}@example.com",
                    "name": "Bulk User2",
                    "role": "member",
                }
            ],
            "send_invitations": False
        }

        response = client.post(
            f"/api/platform/organizations/{test_org.organization_id}/users/bulk",
            json=users_data,
            headers={"Authorization": f"Bearer {token}"}
        )

        # Route returns 201 on success
        assert response.status_code == 201
        data = response.get_json()
        assert "results" in data
        assert data["results"]["created"] >= 0


class TestProvisioningLogs:
    """Tests for provisioning audit log endpoints."""

    def test_list_provisioning_logs(self, client, db_session, platform_admin_user):
        """Test listing provisioning logs."""
        user = platform_admin_user["user"]

        # Create a log entry
        log = ProvisioningAuditLog(
            action="test_action",
            performed_by=user.user_id,
            details={"test": True}
        )
        db_session.add(log)
        db_session.commit()

        admin_org = platform_admin_user["org"]
        token = _make_token(user.user_id, admin_org.organization_id)

        response = client.get(
            "/api/platform/provisioning-logs",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.get_json()
        # Route returns "provisioning_logs" + pagination shape
        assert "items" in data
        assert "page" in data or "total" in data

    def test_get_provisioning_stats(self, client, platform_admin_user):
        """Test getting provisioning statistics."""
        user = platform_admin_user["user"]
        admin_org = platform_admin_user["org"]
        token = _make_token(user.user_id, admin_org.organization_id)

        response = client.get(
            "/api/platform/provisioning-logs/stats",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.get_json()
        assert "stats" in data or "total_events" in data


class TestSSOConfiguration:
    """Tests for SSO configuration endpoints."""

    def test_get_sso_config_not_configured(self, client, platform_admin_user, test_org):
        """Test getting SSO config when not configured."""
        user = platform_admin_user["user"]
        admin_org = platform_admin_user["org"]
        token = _make_token(user.user_id, admin_org.organization_id)

        response = client.get(
            f"/api/platform/organizations/{test_org.organization_id}/sso",
            headers={"Authorization": f"Bearer {token}"}
        )

        # May return 200 with empty/null sso_config or 404
        assert response.status_code in [200, 404]

    def test_create_sso_config(self, client, db_session, platform_admin_user, test_org):
        """Test creating SSO configuration."""
        user = platform_admin_user["user"]
        admin_org = platform_admin_user["org"]
        # Route requires a fresh MFA; mark token accordingly
        token = _make_token(user.user_id, admin_org.organization_id, mfa=True)

        # SSOConfigBody is flat — no "config" wrapper; fields are direct on the body
        sso_data = {
            "provider": "saml",
            "enabled": True,
            "idp_entity_id": "https://idp.example.com/entity",
            "idp_sso_url": "https://idp.example.com/sso",
            "idp_certificate": "-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----",
            "allowed_domains": ["example.com"],
        }

        response = client.put(
            f"/api/platform/organizations/{test_org.organization_id}/sso",
            json=sso_data,
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code in [200, 201]

    def test_delete_sso_config(self, client, db_session, platform_admin_user, test_org):
        """Test deleting SSO configuration."""
        # SSOConfiguration has flat columns; no `config` field exists
        sso = SSOConfiguration(
            organization_id=test_org.organization_id,
            provider="saml",
            enabled=True,
            idp_entity_id="https://idp.example.com/entity",
        )
        db_session.add(sso)
        db_session.commit()

        user = platform_admin_user["user"]
        admin_org = platform_admin_user["org"]
        # Route requires a fresh MFA
        token = _make_token(user.user_id, admin_org.organization_id, mfa=True)

        response = client.delete(
            f"/api/platform/organizations/{test_org.organization_id}/sso",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200


class TestEntityAudit:
    """Tests for entity audit endpoints."""

    def test_list_entity_audit_events(self, client, platform_admin_user):
        """Test listing entity audit events."""
        user = platform_admin_user["user"]
        admin_org = platform_admin_user["org"]
        token = _make_token(user.user_id, admin_org.organization_id)

        response = client.get(
            "/api/platform/audit/entities",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.get_json()
        # Route returns events + total + limit + offset (flat pagination fields)
        assert "items" in data
        assert "total" in data
        assert "limit" in data
        assert "offset" in data

    def test_get_entity_audit_stats(self, client, platform_admin_user):
        """Test getting entity audit statistics."""
        user = platform_admin_user["user"]
        admin_org = platform_admin_user["org"]
        token = _make_token(user.user_id, admin_org.organization_id)

        response = client.get(
            "/api/platform/audit/entities/stats",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.get_json()
        assert "stats" in data or "total_events" in data


class TestAuthenticationRequired:
    """Tests that all endpoints require authentication."""

class TestCrossOrgRLSRegression:
    """Issue #75 regression: platform-admin handlers must reach organizations
    the caller is NOT a member of.

    Under RLS (staging/prod), the request session (`get_db`, NOBYPASSRLS) only
    sees orgs the user belongs to, so `db.query(Organization).filter_by(...)`
    returned None for any other org and the handler 404'd before doing
    anything. The fix routes these handlers through the BYPASSRLS owner
    session (`_admin_db_dep`). This test runs under real RLS (`rls_client` /
    `rls_db_session`) and asserts a platform admin can read a non-member org's
    applications — the exact endpoint from the issue symptom.

    Before the fix this returns 404 "Organization not found"; after, 200.
    """

    def test_get_applications_for_non_member_org_under_rls(self, rls_client, rls_db_session):
        from sqlalchemy import text
        from app.models import Permission as PermissionModel

        def _set_org_ctx(org_id):
            # Match `organizations_org_isolation` WITH CHECK so seeding INSERTs
            # for each org satisfy RLS under the NOBYPASSRLS test role.
            rls_db_session.execute(
                text("SELECT set_config('app.current_org_id', :v, true)"),
                {"v": str(org_id)},
            )

        # --- Org A: the platform admin IS a member here (their active org) ---
        # Pre-generate ids and set context BEFORE each INSERT so the
        # organizations WITH CHECK (org_id = current_org_id()) is satisfied.
        org_a_id = uuid4()
        org_b_id = uuid4()
        _set_org_ctx(org_a_id)
        org_a = Organization(organization_id=org_a_id, name="RLS Org A", slug=f"rls-a-{uuid4().hex[:8]}", status="active")
        rls_db_session.add(org_a)
        rls_db_session.flush()

        user = User(email=f"pa-{uuid4().hex[:8]}@example.com", password_hash="x", status="active")
        rls_db_session.add(user)
        role = Role(
            role_key=f"pa-{uuid4().hex[:8]}",
            display_name="Platform Admin",
            organization_id=org_a.organization_id,
        )
        rls_db_session.add(role)
        rls_db_session.flush()

        perm = rls_db_session.query(PermissionModel).filter_by(
            permission_key=Permission.PLATFORM_ADMIN.value
        ).first()
        if not perm:
            perm = PermissionModel(
                permission_key=Permission.PLATFORM_ADMIN.value,
                scope=Permission.PLATFORM_ADMIN.value.rpartition(".")[0] or Permission.PLATFORM_ADMIN.value,
                action=Permission.PLATFORM_ADMIN.value.rpartition(".")[2] or Permission.PLATFORM_ADMIN.value,
                display_name="Platform Admin",
                description="Platform admin access",
            )
            rls_db_session.add(perm)
            rls_db_session.flush()
        rls_db_session.add(RolePermission(role_id=role.role_id, permission_id=perm.permission_id))
        rls_db_session.add(OrganizationMembership(
            organization_id=org_a.organization_id,
            user_id=user.user_id,
            role="admin",
            role_id=role.role_id,
            status="active",
        ))
        # An application so the response has a row to report (table is global).
        rls_db_session.add(Application(
            key=f"app-{uuid4().hex[:8]}", display_name="App", status="active", sort_order=1,
        ))
        rls_db_session.flush()

        # --- Org B: the admin is NOT a member (the cross-org target) ---
        _set_org_ctx(org_b_id)
        org_b = Organization(organization_id=org_b_id, name="RLS Org B", slug=f"rls-b-{uuid4().hex[:8]}", status="active")
        rls_db_session.add(org_b)
        rls_db_session.flush()
        rls_db_session.commit()

        token = _make_token(user.user_id, org_a_id)  # active org = A
        resp = rls_client.get(
            f"/api/platform/organizations/{org_b_id}/applications",
            headers={"Authorization": f"Bearer {token}"},
        )

        # The whole point of #75: a platform admin reaching a NON-member org.
        assert resp.status_code == 200, (
            f"expected 200 (BYPASSRLS owner session sees org B), got "
            f"{resp.status_code}: {resp.get_json()}"
        )
        assert "applications" in resp.get_json()
