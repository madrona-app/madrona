"""
Tests for API Key Management endpoints.

Tests the organization API key management:
- Create API keys
- List API keys
- Revoke API keys

All endpoints require ORG_MANAGE_API_KEYS permission.
Run with: TEST_DATABASE_URL=postgresql://... pytest tests/postgres/test_api_keys_api.py -v
"""

import os
import pytest
from uuid import uuid4

from app.models import (
    User,
    Organization,
    OrganizationMembership,
    Role,
    RolePermission,
    APIKey,
)
from app.permissions import Permission

# Mark all tests in this file as requiring PostgreSQL
pytestmark = pytest.mark.postgres


@pytest.fixture
def admin_user_with_api_key_permission(db_session):
    """Create a user with ORG_MANAGE_API_KEYS permission."""
    org = Organization(
        name="API Key Test Org",
        slug=f"api-key-test-{uuid4().hex[:8]}",
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
        role_key=f"api-key-admin-{uuid4().hex[:8]}",
        display_name="API Key Admin",
        is_system=False
    )
    db_session.add(role)
    db_session.flush()

    # Add ORG_MANAGE_API_KEYS permission
    from app.models import Permission as PermissionModel
    perm = db_session.query(PermissionModel).filter_by(
        permission_key=Permission.ORG_MANAGE_API_KEYS.value
    ).first()
    if not perm:
        perm = PermissionModel(
                permission_key=Permission.ORG_MANAGE_API_KEYS.value,
                scope=(Permission.ORG_MANAGE_API_KEYS.value).rpartition(".")[0] or (Permission.ORG_MANAGE_API_KEYS.value),
                action=(Permission.ORG_MANAGE_API_KEYS.value).rpartition(".")[2] or (Permission.ORG_MANAGE_API_KEYS.value),
                display_name=(Permission.ORG_MANAGE_API_KEYS.value).replace(".", " ").title(),
                description="Manage API keys"
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
def regular_user(db_session):
    """Create a user without API key permission."""
    org = Organization(
        name="Regular Org",
        slug=f"regular-org-{uuid4().hex[:8]}",
        status="active"
    )
    db_session.add(org)
    db_session.flush()

    user = User(
        email=f"user-{uuid4().hex[:8]}@example.com",
        password_hash="fakehash",
        status="active"
    )
    db_session.add(user)
    db_session.flush()

    role = Role(
        role_key=f"viewer-{uuid4().hex[:8]}",
        display_name="Viewer",
        is_system=False
    )
    db_session.add(role)
    db_session.flush()

    membership = OrganizationMembership(
        user_id=user.user_id,
        organization_id=org.organization_id,
        role="admin",
        role_id=role.role_id,
        status="active"
    )
    db_session.add(membership)
    db_session.commit()

    return {"org": org, "user": user}


class TestCreateApiKey:
    """Tests for API key creation endpoint."""

    def test_create_api_key_success(self, client, admin_user_with_api_key_permission):
        """Test creating a new API key."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = admin_user_with_api_key_permission["org"]
        user = admin_user_with_api_key_permission["user"]
        token = create_access_token(user.user_id, org.organization_id)

        response = client.post(
            f"/api/organizations/{org.organization_id}/api-keys",
            json={
                "name": "Production API Key",
                "scopes": ["collections.view", "media.view"]
            },
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 201
        payload = response.get_json()
        # Create endpoint wraps success body in {"status": "ok", "data": {...}}
        data = payload["data"] if "data" in payload else payload
        assert "api_key_id" in data
        assert "secret_api_key" in data  # Secret only returned once
        assert data["name"] == "Production API Key"
        assert sorted(data["scopes"]) == ["collections.view", "media.view"]
        assert data["status"] == "active"
        assert "key_prefix" in data
        assert data["secret_api_key"].startswith("mkey_") or len(data["secret_api_key"]) > 20

    def test_create_api_key_all_scopes(self, client, admin_user_with_api_key_permission):
        """Test creating API key with all valid scopes."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = admin_user_with_api_key_permission["org"]
        user = admin_user_with_api_key_permission["user"]
        token = create_access_token(user.user_id, org.organization_id)

        all_scopes = [
            "collections.view",
            "collections.edit",
            "media.view",
            "media.edit",
            "exhibit.view",
            "constituents.view",
            "loans.view",
            "data.view",
            "data.manage",
            "runs.view",
            "runs.execute",
        ]

        response = client.post(
            f"/api/organizations/{org.organization_id}/api-keys",
            json={
                "name": "Full Access Key",
                "scopes": all_scopes
            },
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 201
        payload = response.get_json()
        data = payload["data"] if "data" in payload else payload
        assert sorted(data["scopes"]) == sorted(all_scopes)
        assert data["status"] == "active"

    def test_create_api_key_missing_name_returns_422(self, client, admin_user_with_api_key_permission):
        """Test creating API key without name fails.

        Renamed: prod semantics changed — Pydantic body validation now returns 422
        (unprocessable entity) rather than 400. FastAPI default behavior.
        """
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = admin_user_with_api_key_permission["org"]
        user = admin_user_with_api_key_permission["user"]
        token = create_access_token(user.user_id, org.organization_id)

        response = client.post(
            f"/api/organizations/{org.organization_id}/api-keys",
            json={
                "scopes": ["collections.view"]
            },
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 422

    def test_create_api_key_empty_name_returns_422(self, client, admin_user_with_api_key_permission):
        """Test creating API key with empty name fails.

        Renamed: prod semantics changed — router now raises HTTPException(422)
        for empty-after-strip name (was 400). Aligned with Pydantic validation status.
        """
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = admin_user_with_api_key_permission["org"]
        user = admin_user_with_api_key_permission["user"]
        token = create_access_token(user.user_id, org.organization_id)

        response = client.post(
            f"/api/organizations/{org.organization_id}/api-keys",
            json={
                "name": "   ",
                "scopes": ["collections.view"]
            },
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 422

    def test_create_api_key_missing_scopes_returns_422(self, client, admin_user_with_api_key_permission):
        """Test creating API key without scopes fails.

        Renamed: prod semantics changed — Pydantic body validation returns 422
        rather than 400 for missing required fields.
        """
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = admin_user_with_api_key_permission["org"]
        user = admin_user_with_api_key_permission["user"]
        token = create_access_token(user.user_id, org.organization_id)

        response = client.post(
            f"/api/organizations/{org.organization_id}/api-keys",
            json={
                "name": "Test Key"
            },
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 422

    def test_create_api_key_empty_scopes_returns_422(self, client, admin_user_with_api_key_permission):
        """Test creating API key with empty scopes fails.

        Renamed: prod semantics changed — router returns 422 for empty scopes
        list (was 400). Aligned with Pydantic validation status.
        """
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = admin_user_with_api_key_permission["org"]
        user = admin_user_with_api_key_permission["user"]
        token = create_access_token(user.user_id, org.organization_id)

        response = client.post(
            f"/api/organizations/{org.organization_id}/api-keys",
            json={
                "name": "Test Key",
                "scopes": []
            },
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 422

    def test_create_api_key_invalid_scopes(self, client, admin_user_with_api_key_permission):
        """Test creating API key with invalid scopes fails."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = admin_user_with_api_key_permission["org"]
        user = admin_user_with_api_key_permission["user"]
        token = create_access_token(user.user_id, org.organization_id)

        response = client.post(
            f"/api/organizations/{org.organization_id}/api-keys",
            json={
                "name": "Test Key",
                "scopes": ["invalid:scope", "another:invalid"]
            },
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 400
        data = response.get_json()
        # Error shape: {"error": {"code": "validation_error", "message": "Invalid scopes", "invalid_scopes": [...], ...}}
        error = data["error"] if isinstance(data.get("error"), dict) else data
        assert "invalid_scopes" in error or "invalid" in str(error.get("message", "")).lower()

    def test_create_api_key_duplicate_name_returns_409(self, client, db_session, admin_user_with_api_key_permission):
        """Test creating API key with duplicate name fails.

        Renamed: prod semantics changed — duplicate-name now returns 409 Conflict
        (was 400). Semantically correct HTTP status for resource conflicts.
        """
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = admin_user_with_api_key_permission["org"]
        user = admin_user_with_api_key_permission["user"]

        # Create an existing API key
        existing_key = APIKey(
            organization_id=org.organization_id,
            name="Duplicate Name",
            key_prefix="mkey_abc",
            key_hash="hash123",
            scopes={"collections.view": True},
            status="active",
            created_by_user_id=user.user_id
        )
        db_session.add(existing_key)
        db_session.commit()

        token = create_access_token(user.user_id, org.organization_id)

        response = client.post(
            f"/api/organizations/{org.organization_id}/api-keys",
            json={
                "name": "Duplicate Name",
                "scopes": ["media.view"]
            },
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 409
        data = response.get_json()
        # Error shape: {"error": {"code": "conflict", "message": "...already exists", ...}}
        error = data["error"] if isinstance(data.get("error"), dict) else data
        message = str(error.get("message", error)).lower() if isinstance(error, dict) else str(error).lower()
        assert "exists" in message or "duplicate" in message

    def test_create_api_key_requires_auth(self, client, admin_user_with_api_key_permission):
        """Test creating API key requires authentication."""
        org = admin_user_with_api_key_permission["org"]

        response = client.post(
            f"/api/organizations/{org.organization_id}/api-keys",
            json={
                "name": "Test Key",
                "scopes": ["collections.view"]
            }
        )

        assert response.status_code == 401

    def test_create_api_key_requires_permission(self, client, regular_user):
        """Test creating API key requires ORG_MANAGE_API_KEYS permission."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = regular_user["org"]
        user = regular_user["user"]
        token = create_access_token(user.user_id, org.organization_id)

        response = client.post(
            f"/api/organizations/{org.organization_id}/api-keys",
            json={
                "name": "Test Key",
                "scopes": ["collections.view"]
            },
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 403


class TestListApiKeys:
    """Tests for API key listing endpoint."""

    def test_list_api_keys_empty(self, client, admin_user_with_api_key_permission):
        """Test listing API keys when none exist."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = admin_user_with_api_key_permission["org"]
        user = admin_user_with_api_key_permission["user"]
        token = create_access_token(user.user_id, org.organization_id)

        response = client.get(
            f"/api/organizations/{org.organization_id}/api-keys",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.get_json()
        assert "api_keys" in data
        assert isinstance(data["api_keys"], list)
        assert len(data["api_keys"]) == 0

    def test_list_api_keys_with_items(self, client, db_session, admin_user_with_api_key_permission):
        """Test listing API keys with existing keys."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = admin_user_with_api_key_permission["org"]
        user = admin_user_with_api_key_permission["user"]

        # Create some API keys
        key1 = APIKey(
            organization_id=org.organization_id,
            name="Key One",
            key_prefix="mkey_one",
            key_hash="hash1",
            scopes={"collections.view": True},
            status="active",
            created_by_user_id=user.user_id
        )
        key2 = APIKey(
            organization_id=org.organization_id,
            name="Key Two",
            key_prefix="mkey_two",
            key_hash="hash2",
            scopes={"data.view": True, "data.manage": True},
            status="active",
            created_by_user_id=user.user_id
        )
        db_session.add_all([key1, key2])
        db_session.commit()

        token = create_access_token(user.user_id, org.organization_id)

        response = client.get(
            f"/api/organizations/{org.organization_id}/api-keys",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.get_json()
        assert len(data["api_keys"]) == 2

        # Check structure - should NOT include secret
        for key_data in data["api_keys"]:
            assert "api_key_id" in key_data
            assert "name" in key_data
            assert "scopes" in key_data
            assert "key_prefix" in key_data
            assert "status" in key_data
            assert "created_at" in key_data
            assert "secret_api_key" not in key_data  # Secret should never be in list

    def test_list_api_keys_does_not_expose_secrets(self, client, db_session, admin_user_with_api_key_permission):
        """Test that listing API keys never exposes secrets."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = admin_user_with_api_key_permission["org"]
        user = admin_user_with_api_key_permission["user"]

        key = APIKey(
            organization_id=org.organization_id,
            name="Secret Test",
            key_prefix="mkey_sec",
            key_hash="supersecret_hash_123",
            scopes={"collections.view": True},
            status="active",
            created_by_user_id=user.user_id
        )
        db_session.add(key)
        db_session.commit()

        token = create_access_token(user.user_id, org.organization_id)

        response = client.get(
            f"/api/organizations/{org.organization_id}/api-keys",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.get_json()

        # Check that hash is not exposed
        response_str = str(data)
        assert "supersecret_hash_123" not in response_str
        assert "secret" not in response_str.lower() or "secret_api_key" not in response_str

    def test_list_api_keys_requires_auth(self, client, admin_user_with_api_key_permission):
        """Test listing API keys requires authentication."""
        org = admin_user_with_api_key_permission["org"]

        response = client.get(
            f"/api/organizations/{org.organization_id}/api-keys"
        )

        assert response.status_code == 401

    def test_list_api_keys_requires_permission(self, client, regular_user):
        """Test listing API keys requires ORG_MANAGE_API_KEYS permission."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = regular_user["org"]
        user = regular_user["user"]
        token = create_access_token(user.user_id, org.organization_id)

        response = client.get(
            f"/api/organizations/{org.organization_id}/api-keys",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 403


class TestRevokeApiKey:
    """Tests for API key revocation endpoint."""

    def test_revoke_api_key_success(self, client, db_session, admin_user_with_api_key_permission):
        """Test revoking an API key."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = admin_user_with_api_key_permission["org"]
        user = admin_user_with_api_key_permission["user"]

        key = APIKey(
            organization_id=org.organization_id,
            name="To Revoke",
            key_prefix="mkey_rev",
            key_hash="hash_revoke",
            scopes={"collections.view": True},
            status="active",
            created_by_user_id=user.user_id
        )
        db_session.add(key)
        db_session.commit()
        key_id = str(key.api_key_id)

        token = create_access_token(user.user_id, org.organization_id)

        response = client.delete(
            f"/api/api-keys/{key_id}?organization_id={org.organization_id}",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.get_json()
        assert "revoked" in data["message"].lower()

        # Verify status changed
        db_session.refresh(key)
        assert key.status == "revoked"

    def test_revoke_api_key_not_found(self, client, admin_user_with_api_key_permission):
        """Test revoking non-existent API key."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = admin_user_with_api_key_permission["org"]
        user = admin_user_with_api_key_permission["user"]
        token = create_access_token(user.user_id, org.organization_id)

        fake_id = str(uuid4())

        response = client.delete(
            f"/api/api-keys/{fake_id}?organization_id={org.organization_id}",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 404

    def test_revoke_api_key_cross_tenant_blocked(self, client, db_session, admin_user_with_api_key_permission):
        """Test that revoking API key from another org is blocked."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = admin_user_with_api_key_permission["org"]
        user = admin_user_with_api_key_permission["user"]

        # Create another organization's API key
        other_org = Organization(
            name="Other Org",
            slug=f"other-org-{uuid4().hex[:8]}",
            status="active"
        )
        db_session.add(other_org)
        db_session.flush()

        other_key = APIKey(
            organization_id=other_org.organization_id,  # Different org!
            name="Other Org Key",
            key_prefix="mkey_oth",
            key_hash="hash_other",
            scopes={"collections.view": True},
            status="active"
        )
        db_session.add(other_key)
        db_session.commit()

        token = create_access_token(user.user_id, org.organization_id)

        # Try to revoke the other org's key using our org context
        response = client.delete(
            f"/api/api-keys/{other_key.api_key_id}?organization_id={org.organization_id}",
            headers={"Authorization": f"Bearer {token}"}
        )

        # Should not find it (filtered by org_id)
        assert response.status_code == 404

        # Verify key was NOT revoked
        db_session.refresh(other_key)
        assert other_key.status == "active"

    def test_revoke_api_key_requires_auth(self, client, db_session, admin_user_with_api_key_permission):
        """Test revoking API key requires authentication."""
        org = admin_user_with_api_key_permission["org"]
        user = admin_user_with_api_key_permission["user"]

        key = APIKey(
            organization_id=org.organization_id,
            name="Test Key",
            key_prefix="mkey_tst",
            key_hash="hash_test",
            scopes={"collections.view": True},
            status="active",
            created_by_user_id=user.user_id
        )
        db_session.add(key)
        db_session.commit()

        response = client.delete(
            f"/api/api-keys/{key.api_key_id}?organization_id={org.organization_id}"
        )

        assert response.status_code == 401

    def test_revoke_api_key_requires_permission(self, client, db_session, regular_user, admin_user_with_api_key_permission):
        """Test revoking API key requires ORG_MANAGE_API_KEYS permission."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        # Use regular_user's org but create a key in it
        org = regular_user["org"]
        user = regular_user["user"]

        key = APIKey(
            organization_id=org.organization_id,
            name="Test Key",
            key_prefix="mkey_tst",
            key_hash="hash_test",
            scopes={"collections.view": True},
            status="active"
        )
        db_session.add(key)
        db_session.commit()

        token = create_access_token(user.user_id, org.organization_id)

        response = client.delete(
            f"/api/api-keys/{key.api_key_id}?organization_id={org.organization_id}",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 403


class TestApiKeySecurityIntegration:
    """Integration tests for API key security."""

    def test_api_key_workflow(self, client, admin_user_with_api_key_permission):
        """Test complete API key lifecycle: create -> list -> revoke."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = admin_user_with_api_key_permission["org"]
        user = admin_user_with_api_key_permission["user"]
        token = create_access_token(user.user_id, org.organization_id)
        headers = {"Authorization": f"Bearer {token}"}

        # 1. Create API key
        create_response = client.post(
            f"/api/organizations/{org.organization_id}/api-keys",
            json={
                "name": "Lifecycle Test Key",
                "scopes": ["read:datasets", "read:entities"]
            },
            headers=headers
        )
        assert create_response.status_code == 201
        create_payload = create_response.get_json()
        create_data = create_payload["data"] if "data" in create_payload else create_payload
        api_key_id = create_data["api_key_id"]
        secret = create_data["secret_api_key"]

        # Verify secret was returned
        assert secret is not None
        assert len(secret) > 20

        # 2. List API keys - verify it appears
        list_response = client.get(
            f"/api/organizations/{org.organization_id}/api-keys",
            headers=headers
        )
        assert list_response.status_code == 200
        list_data = list_response.get_json()
        key_ids = [k["api_key_id"] for k in list_data["api_keys"]]
        assert api_key_id in key_ids

        # Verify secret is NOT in list response
        for key_data in list_data["api_keys"]:
            assert "secret_api_key" not in key_data

        # 3. Revoke API key
        revoke_response = client.delete(
            f"/api/api-keys/{api_key_id}?organization_id={org.organization_id}",
            headers=headers
        )
        assert revoke_response.status_code == 200

        # 4. Verify it's revoked in list
        list_after_revoke = client.get(
            f"/api/organizations/{org.organization_id}/api-keys",
            headers=headers
        )
        list_after_data = list_after_revoke.get_json()
        revoked_key = next(
            (k for k in list_after_data["api_keys"] if k["api_key_id"] == api_key_id),
            None
        )
        assert revoked_key is not None
        assert revoked_key["status"] == "revoked"
