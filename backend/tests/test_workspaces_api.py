"""
Tests for Workspaces API endpoints.

Tests workspace functionality including:
- CRUD operations for workspaces
- Workspace item management
- Sharing and permissions
- Active context management
- Bulk actions (preview, validate, execute)

These tests require PostgreSQL due to cross-schema foreign keys.
Run with: pytest -m postgres tests/test_workspaces_api.py
"""

import json

import pytest

# Mark all tests in this module as requiring PostgreSQL
pytestmark = pytest.mark.postgres
from datetime import datetime, timezone
from uuid import uuid4

from app.models import (
    Organization,
    User,
    OrganizationMembership,
    Role,
    Permission as PermissionModel,
    RolePermission,
    CollectionObject,
    Workspace,
    WorkspaceItem,
    WorkspaceShare,
    UserActiveContext,
    Location,
    Movement,
)
from app.services.auth_utils import generate_access_token


class AuthenticatedClient:
    """Wrapper around Flask test client that includes auth headers."""

    def __init__(self, client, token: str):
        self._client = client
        self._token = token
        self._headers = {"Authorization": f"Bearer {token}"}

    def get(self, *args, **kwargs):
        headers = kwargs.pop("headers", {})
        headers.update(self._headers)
        return self._client.get(*args, headers=headers, **kwargs)

    def post(self, *args, **kwargs):
        headers = kwargs.pop("headers", {})
        headers.update(self._headers)
        kwargs.setdefault("content_type", "application/json")
        return self._client.post(*args, headers=headers, **kwargs)

    def patch(self, *args, **kwargs):
        headers = kwargs.pop("headers", {})
        headers.update(self._headers)
        kwargs.setdefault("content_type", "application/json")
        return self._client.patch(*args, headers=headers, **kwargs)

    def delete(self, *args, **kwargs):
        headers = kwargs.pop("headers", {})
        headers.update(self._headers)
        # Starlette's TestClient.delete() — like httpx.Client.delete() — doesn't
        # accept a request body via `json=`/`data=`/`content=`. Route DELETEs
        # with a payload through the underlying raw httpx client via
        # ``request("DELETE", ...)`` so the body is actually sent, then wrap
        # the response with the Flask-style helper the test suite relies on.
        if "json" in kwargs:
            from tests.conftest import _FlaskLikeResponse

            payload = kwargs.pop("json")
            url = args[0] if args else kwargs.pop("url")
            raw_client = self._client._client  # httpx.Client inside _FlaskLikeTestClient
            # Mirror the CSRF auto-injection that _FlaskLikeTestClient does.
            csrf_token = raw_client.cookies.get("csrf_token")
            if csrf_token and not any(k.lower() == "x-csrf-token" for k in headers):
                headers = {**headers, "X-CSRF-Token": csrf_token}
            raw_response = raw_client.request(
                "DELETE",
                url,
                headers=headers,
                json=payload,
                follow_redirects=False,
                **kwargs,
            )
            return _FlaskLikeResponse(raw_response)
        return self._client.delete(*args, headers=headers, **kwargs)


def create_permission(db_session, key: str):
    """Helper to create a permission."""
    scope, action = key.rsplit(".", 1) if "." in key else (key, "view")
    perm = PermissionModel(
        permission_key=key,
        scope=scope,
        action=action,
        display_name=key.replace(".", " ").title(),
        description=f"Permission for {key}",
    )
    db_session.add(perm)
    db_session.flush()
    return perm


def create_role_permission(db_session, role, permission):
    """Helper to link role to permission."""
    rp = RolePermission(
        role_id=role.role_id,
        permission_id=permission.permission_id,
    )
    db_session.add(rp)
    db_session.flush()
    return rp


@pytest.fixture
def test_org(db_session):
    """Create a test organization."""
    org = Organization(
        name="Workspace Test Organization",
        slug="workspace-test-org",
        is_demo=False,
        status="active",
    )
    db_session.add(org)
    db_session.flush()
    return org


@pytest.fixture
def test_role(db_session):
    """Create a test role with workspace permissions."""
    role = Role(
        role_key="workspace_test_role",
        display_name="Workspace Test Role",
        description="Role with workspace permissions",
        is_system=False,
    )
    db_session.add(role)
    db_session.flush()

    # Add workspace permissions
    permissions = [
        "workspaces.view",
        "workspaces.create",
        "workspaces.edit",
        "workspaces.delete",
        "workspaces.share",
        "workspaces.execute",
        "movements.create",
        "condition_reports.create",
        "incidents.create",
        # Active-context endpoints require COLLECTIONS_VIEW.
        "collections.view",
    ]
    for perm_key in permissions:
        perm = create_permission(db_session, perm_key)
        create_role_permission(db_session, role, perm)

    db_session.commit()
    return role


@pytest.fixture
def test_user(db_session, test_org, test_role):
    """Create a test user with workspace permissions."""
    user = User(
        email="workspace-test@example.com",
        password_hash="not_used_in_tests",
        status="active",
    )
    db_session.add(user)
    db_session.flush()

    membership = OrganizationMembership(
        organization_id=test_org.organization_id,
        user_id=user.user_id,
        role="admin",
        role_id=test_role.role_id,
        status="active",
    )
    db_session.add(membership)
    db_session.commit()

    return user


@pytest.fixture
def auth_client(client, db_session, test_org, test_user):
    """Create an authenticated test client."""
    token = generate_access_token(
        user_id=str(test_user.user_id),
        email=test_user.email,
        active_organization_id=str(test_org.organization_id),
        expires_minutes=60,
    )
    return AuthenticatedClient(client, token)


@pytest.fixture
def test_objects(db_session, test_org):
    """Create test collection objects."""
    objects = []
    for i in range(5):
        obj = CollectionObject(
            organization_id=test_org.organization_id,
            object_number=f"OBJ.2024.{i+1:04d}",
            object_status="accessioned",
            is_deleted=False,
        )
        db_session.add(obj)
        objects.append(obj)
    db_session.flush()
    from app.models import ObjectTitle
    for i, obj in enumerate(objects):
        db_session.add(ObjectTitle(
            organization_id=test_org.organization_id,
            object_id=obj.object_id,
            title=f"Test Object {i+1}",
            is_preferred=True,
        ))
    db_session.flush()
    return objects


@pytest.fixture
def test_location(db_session, test_org):
    """Create a test location."""
    location = Location(
        organization_id=test_org.organization_id,
        name="Test Storage Room",
        code="TSR-001",
        path="TSR-001",
        depth=0,
        location_type="room",
        status="active",
    )
    db_session.add(location)
    db_session.flush()
    return location


@pytest.fixture
def test_workspace(db_session, test_org, test_user, test_objects):
    """Create a test workspace with items."""
    workspace = Workspace(
        organization_id=test_org.organization_id,
        owner_user_id=test_user.user_id,
        name="Test Workspace",
        description="A workspace for testing",
        visibility="private",
    )
    db_session.add(workspace)
    db_session.flush()

    # Add objects to workspace
    for i, obj in enumerate(test_objects[:3]):
        item = WorkspaceItem(
            workspace_id=workspace.workspace_id,
            object_id=obj.object_id,
            added_by_user_id=test_user.user_id,
            sort_order=i,
        )
        db_session.add(item)

    db_session.commit()
    return workspace


# =============================================================================
# WORKSPACE CRUD TESTS
# =============================================================================

class TestListWorkspaces:
    """Tests for GET /workspaces endpoint."""

    def test_list_workspaces_empty(self, auth_client, test_org):
        """List workspaces when none exist."""
        response = auth_client.get(f"/api/organizations/{test_org.organization_id}/workspaces")
        assert response.status_code == 200
        data = response.get_json()
        assert data["items"] == []
        assert data["total"] == 0

    def test_list_workspaces_with_data(self, auth_client, test_org, test_workspace):
        """List workspaces returns owned workspaces."""
        response = auth_client.get(f"/api/organizations/{test_org.organization_id}/workspaces")
        assert response.status_code == 200
        data = response.get_json()
        assert data["total"] >= 1
        workspace = data["items"][0]
        assert workspace["name"] == "Test Workspace"
        assert workspace["is_owner"] is True

    def test_list_workspaces_filter_by_visibility(self, auth_client, test_org, test_workspace, db_session, test_user):
        """Filtering by ?visibility=private should exclude org-visible workspaces."""
        org_workspace = Workspace(
            organization_id=test_org.organization_id,
            owner_user_id=test_user.user_id,
            name="Org Visible Workspace",
            visibility="org",
        )
        db_session.add(org_workspace)
        db_session.commit()

        response = auth_client.get(
            f"/api/organizations/{test_org.organization_id}/workspaces?visibility=private"
        )
        assert response.status_code == 200
        data = response.get_json()
        visibilities = {w["visibility"] for w in data["items"]}
        assert visibilities == {"private"}

    def test_list_workspaces_requires_auth(self, client, test_org):
        """List workspaces requires authentication."""
        response = client.get(f"/api/organizations/{test_org.organization_id}/workspaces")
        assert response.status_code == 401


class TestCreateWorkspace:
    """Tests for POST /workspaces endpoint."""

    def test_create_workspace_success(self, auth_client, test_org):
        """Create a new workspace."""
        response = auth_client.post(
            f"/api/organizations/{test_org.organization_id}/workspaces",
            json={
                "name": "New Workspace",
                "description": "A new workspace",
                "visibility": "private",
            }
        )
        assert response.status_code == 201
        data = response.get_json()
        assert data["name"] == "New Workspace"
        assert data["description"] == "A new workspace"
        assert data["visibility"] == "private"
        assert data["is_owner"] is True
        assert "workspace_id" in data

    def test_create_workspace_minimal(self, auth_client, test_org):
        """Create workspace with only required fields."""
        response = auth_client.post(
            f"/api/organizations/{test_org.organization_id}/workspaces",
            json={"name": "Minimal Workspace"}
        )
        assert response.status_code == 201
        data = response.get_json()
        assert data["name"] == "Minimal Workspace"
        assert data["visibility"] == "private"  # Default

    def test_create_workspace_missing_name(self, auth_client, test_org):
        """Create workspace without name fails."""
        response = auth_client.post(
            f"/api/organizations/{test_org.organization_id}/workspaces",
            json={"description": "No name"}
        )
        assert response.status_code in (400, 422)
        # Error envelope: {"error": {"code": "...", "message": "...", "details": {}}}
        assert "name" in response.get_json()["error"]["message"].lower()


class TestGetWorkspace:
    """Tests for GET /workspaces/<id> endpoint."""

    def test_get_workspace_success(self, auth_client, test_org, test_workspace):
        """Get workspace details."""
        response = auth_client.get(
            f"/api/organizations/{test_org.organization_id}/workspaces/{test_workspace.workspace_id}"
        )
        assert response.status_code == 200
        data = response.get_json()
        assert data["name"] == "Test Workspace"
        assert data["is_owner"] is True
        assert "items" in data
        assert len(data["items"]) == 3

    def test_get_workspace_not_found(self, auth_client, test_org):
        """Get non-existent workspace returns 404."""
        fake_id = str(uuid4())
        response = auth_client.get(
            f"/api/organizations/{test_org.organization_id}/workspaces/{fake_id}"
        )
        assert response.status_code == 404


class TestUpdateWorkspace:
    """Tests for PATCH /workspaces/<id> endpoint."""

    def test_update_workspace_name(self, auth_client, test_org, test_workspace):
        """Update workspace name."""
        response = auth_client.patch(
            f"/api/organizations/{test_org.organization_id}/workspaces/{test_workspace.workspace_id}",
            json={"name": "Updated Name"}
        )
        assert response.status_code == 200
        data = response.get_json()
        assert data["name"] == "Updated Name"

    def test_update_workspace_visibility(self, auth_client, test_org, test_workspace):
        """Update workspace visibility."""
        response = auth_client.patch(
            f"/api/organizations/{test_org.organization_id}/workspaces/{test_workspace.workspace_id}",
            json={"visibility": "org"}
        )
        assert response.status_code == 200
        data = response.get_json()
        assert data["visibility"] == "org"


class TestDeleteWorkspace:
    """Tests for DELETE /workspaces/<id> endpoint."""

    def test_delete_workspace_success(self, auth_client, test_org, test_workspace):
        """Delete a workspace."""
        response = auth_client.delete(
            f"/api/organizations/{test_org.organization_id}/workspaces/{test_workspace.workspace_id}"
        )
        assert response.status_code == 200
        # Endpoint returns a MessageResponse {"message": "Workspace deleted"}.
        assert "message" in response.get_json()

        # Verify workspace is deleted
        response = auth_client.get(
            f"/api/organizations/{test_org.organization_id}/workspaces/{test_workspace.workspace_id}"
        )
        assert response.status_code == 404


# =============================================================================
# WORKSPACE ITEMS TESTS
# =============================================================================

class TestWorkspaceItems:
    """Tests for workspace item management endpoints."""

    def test_add_items_to_workspace(self, auth_client, test_org, test_workspace, test_objects):
        """Add items to a workspace."""
        # Add remaining 2 objects
        object_ids = [str(test_objects[3].object_id), str(test_objects[4].object_id)]
        response = auth_client.post(
            f"/api/organizations/{test_org.organization_id}/workspaces/{test_workspace.workspace_id}/items",
            json={"object_ids": object_ids}
        )
        assert response.status_code == 200
        data = response.get_json()
        assert data["added_count"] == 2

    def test_add_duplicate_items(self, auth_client, test_org, test_workspace, test_objects):
        """Adding duplicate items is handled gracefully."""
        # Try to add object that's already in workspace
        object_ids = [str(test_objects[0].object_id)]
        response = auth_client.post(
            f"/api/organizations/{test_org.organization_id}/workspaces/{test_workspace.workspace_id}/items",
            json={"object_ids": object_ids}
        )
        assert response.status_code == 200
        data = response.get_json()
        assert data["added_count"] == 0
        # Router returns a ``skipped`` list rather than a ``skipped_count``.
        assert len(data["skipped"]) == 1

    def test_remove_items_from_workspace(self, auth_client, test_org, test_workspace, test_objects):
        """Remove items from a workspace."""
        object_ids = [str(test_objects[0].object_id)]
        response = auth_client.delete(
            f"/api/organizations/{test_org.organization_id}/workspaces/{test_workspace.workspace_id}/items",
            json={"object_ids": object_ids}
        )
        assert response.status_code == 200
        data = response.get_json()
        assert data["removed_count"] == 1


# =============================================================================
# WORKSPACE SHARING TESTS
# =============================================================================

class TestWorkspaceSharing:
    """Tests for workspace sharing endpoints."""

    def test_list_shares_empty(self, auth_client, test_org, test_workspace):
        """List shares when none exist."""
        response = auth_client.get(
            f"/api/organizations/{test_org.organization_id}/workspaces/{test_workspace.workspace_id}/shares"
        )
        assert response.status_code == 200
        data = response.get_json()
        assert data["shares"] == []

    def test_create_share(
        self, auth_client, test_org, test_workspace, db_session, test_role
    ):
        """Create a workspace share."""
        # Create another user to share with
        other_user = User(
            email="other@example.com",
            password_hash="test",
            status="active",
        )
        db_session.add(other_user)
        db_session.flush()

        # Add them to the org
        membership = OrganizationMembership(
            organization_id=test_org.organization_id,
            user_id=other_user.user_id,
            role="member",
            role_id=test_role.role_id,
            status="active",
        )
        db_session.add(membership)
        db_session.commit()

        response = auth_client.post(
            f"/api/organizations/{test_org.organization_id}/workspaces/{test_workspace.workspace_id}/shares",
            json={
                "user_id": str(other_user.user_id),
                "permission": "edit",
            }
        )
        assert response.status_code == 201
        data = response.get_json()
        assert "share_id" in data

    def test_delete_share(self, auth_client, test_org, test_workspace, db_session, test_user):
        """Delete a workspace share."""
        # Create a share first
        share = WorkspaceShare(
            workspace_id=test_workspace.workspace_id,
            organization_id=test_org.organization_id,
            principal_type="user",
            principal_id=uuid4(),
            permission="view",
            created_by=test_user.user_id,
        )
        db_session.add(share)
        db_session.commit()

        response = auth_client.delete(
            f"/api/organizations/{test_org.organization_id}/workspaces/{test_workspace.workspace_id}/shares/{share.share_id}"
        )
        assert response.status_code == 200
        # Endpoint returns {"message": "Share removed"} per MessageResponse.
        assert "message" in response.get_json()


# =============================================================================
# ACTIVE CONTEXT TESTS
# =============================================================================

class TestActiveContext:
    """Tests for active context management endpoints."""

    def test_get_context_empty(self, auth_client, test_org):
        """Get context when none is set."""
        response = auth_client.get(f"/api/organizations/{test_org.organization_id}/context")
        assert response.status_code == 200
        data = response.get_json()
        # Endpoint returns {"context": None} when nothing is set.
        assert data["context"] is None

    def test_set_workspace_context(self, auth_client, test_org, test_workspace):
        """Set workspace as active context."""
        response = auth_client.post(
            f"/api/organizations/{test_org.organization_id}/context/workspace/{test_workspace.workspace_id}"
        )
        assert response.status_code == 200
        data = response.get_json()
        assert data["context"]["type"] == "workspace"
        assert data["context"]["workspace"]["workspace_id"] == str(test_workspace.workspace_id)

    def test_set_object_context(self, auth_client, test_org, test_objects):
        """Set object as active context."""
        obj = test_objects[0]
        response = auth_client.post(
            f"/api/organizations/{test_org.organization_id}/context/object/{obj.object_id}"
        )
        assert response.status_code == 200
        data = response.get_json()
        assert data["context"]["type"] == "object"
        assert data["context"]["object"]["object_id"] == str(obj.object_id)

    def test_clear_context(self, auth_client, test_org, test_workspace):
        """Clear active context."""
        # First set a context
        auth_client.post(
            f"/api/organizations/{test_org.organization_id}/context/workspace/{test_workspace.workspace_id}"
        )

        # Then clear it. The endpoint is declared with response_model=MessageResponse,
        # so FastAPI filters the body down to just {"message": "..."} — the
        # legacy ``success`` flag is no longer part of the public shape.
        response = auth_client.delete(f"/api/organizations/{test_org.organization_id}/context")
        assert response.status_code == 200
        assert "message" in response.get_json()

        # Verify it's cleared (endpoint returns {"context": None} when empty).
        response = auth_client.get(f"/api/organizations/{test_org.organization_id}/context")
        data = response.get_json()
        assert data["context"] is None


# =============================================================================
# BULK ACTIONS TESTS
# =============================================================================

class TestBulkActions:
    """Tests for bulk action endpoints."""

    def test_list_bulk_actions(self, auth_client, test_org, test_workspace):
        """List available bulk actions."""
        response = auth_client.get(
            f"/api/organizations/{test_org.organization_id}/workspaces/{test_workspace.workspace_id}/actions"
        )
        assert response.status_code == 200
        data = response.get_json()
        assert "actions" in data
        action_keys = [a["key"] for a in data["actions"]]
        assert "record_movement" in action_keys

    def test_preview_bulk_action(self, auth_client, test_org, test_workspace, test_location):
        """Preview a bulk action."""
        response = auth_client.post(
            f"/api/organizations/{test_org.organization_id}/workspaces/{test_workspace.workspace_id}/actions/record_movement/preview",
            json={
                "action_params": {
                    "to_location_id": str(test_location.location_id),
                    "reason": "storage",
                }
            }
        )
        assert response.status_code == 200
        data = response.get_json()
        assert data["action"] == "record_movement"
        assert data["total_count"] == 3
        assert len(data["objects"]) == 3

    def test_validate_bulk_action(self, auth_client, test_org, test_workspace, test_location):
        """Validate a bulk action."""
        response = auth_client.post(
            f"/api/organizations/{test_org.organization_id}/workspaces/{test_workspace.workspace_id}/actions/record_movement/validate",
            json={
                "action_params": {
                    "to_location_id": str(test_location.location_id),
                    "reason": "storage",
                }
            }
        )
        assert response.status_code == 200
        data = response.get_json()
        assert data["action_valid"] is True
        assert data["allowed_count"] == 3

    def test_validate_missing_params(self, auth_client, test_org, test_workspace):
        """Validate with missing required params fails."""
        response = auth_client.post(
            f"/api/organizations/{test_org.organization_id}/workspaces/{test_workspace.workspace_id}/actions/record_movement/validate",
            json={
                "action_params": {
                    "reason": "storage",
                    # Missing to_location_id
                }
            }
        )
        assert response.status_code in (400, 422)
        # Error envelope: {"error": {"code": ..., "message": ..., "details": {}}}
        assert "to_location_id" in response.get_json()["error"]["message"]

    def test_execute_bulk_action(self, auth_client, test_org, test_workspace, test_location):
        """Execute a bulk action."""
        response = auth_client.post(
            f"/api/organizations/{test_org.organization_id}/workspaces/{test_workspace.workspace_id}/actions/record_movement/execute",
            json={
                "action_params": {
                    "to_location_id": str(test_location.location_id),
                    "reason": "storage",
                    "movement_note": "Bulk move for testing",
                }
            }
        )
        assert response.status_code == 200
        data = response.get_json()
        assert data["status"] == "completed"
        assert data["success_count"] == 3
        assert len(data["results"]) == 3
        assert all(r["status"] == "success" for r in data["results"])

    def test_execute_unknown_action(self, auth_client, test_org, test_workspace):
        """Execute unknown action fails."""
        response = auth_client.post(
            f"/api/organizations/{test_org.organization_id}/workspaces/{test_workspace.workspace_id}/actions/unknown_action/execute",
            json={"action_params": {}}
        )
        assert response.status_code in (400, 422)
        assert "unknown" in response.get_json()["error"]["message"].lower()


# =============================================================================
# PERMISSION ENFORCEMENT TESTS
# =============================================================================

class TestPermissionEnforcement:
    """Tests for permission enforcement on workspace operations."""

    def test_cannot_access_other_org_workspace(self, auth_client, db_session, test_user, test_role):
        """Cannot access workspace in different organization."""
        # Create another org
        other_org = Organization(
            name="Other Organization",
            slug="other-org",
            is_demo=False,
            status="active",
        )
        db_session.add(other_org)
        db_session.flush()

        # Create workspace in other org
        other_workspace = Workspace(
            organization_id=other_org.organization_id,
            owner_user_id=test_user.user_id,  # Same user but different org
            name="Other Workspace",
            visibility="private",
        )
        db_session.add(other_workspace)
        db_session.commit()

        response = auth_client.get(
            f"/api/organizations/{other_org.organization_id}/workspaces/{other_workspace.workspace_id}"
        )
        # Should fail due to org mismatch or permission
        assert response.status_code in [403, 404]

    def test_cannot_modify_unowned_private_workspace(
        self, client, db_session, test_org, test_role, test_objects
    ):
        """Cannot modify private workspace owned by another user."""
        # Create owner user
        owner = User(email="owner@example.com", password_hash="test", status="active")
        db_session.add(owner)
        db_session.flush()

        owner_membership = OrganizationMembership(
            organization_id=test_org.organization_id,
            user_id=owner.user_id,
            role="member",
            role_id=test_role.role_id,
            status="active",
        )
        db_session.add(owner_membership)

        # Create workspace owned by owner
        workspace = Workspace(
            organization_id=test_org.organization_id,
            owner_user_id=owner.user_id,
            name="Owner's Private Workspace",
            visibility="private",
        )
        db_session.add(workspace)
        db_session.commit()

        # Create different user who is not the owner
        other_user = User(email="other@example.com", password_hash="test", status="active")
        db_session.add(other_user)
        db_session.flush()

        other_membership = OrganizationMembership(
            organization_id=test_org.organization_id,
            user_id=other_user.user_id,
            role="member",
            role_id=test_role.role_id,
            status="active",
        )
        db_session.add(other_membership)
        db_session.commit()

        # Generate token for other user
        token = generate_access_token(
            user_id=str(other_user.user_id),
            email=other_user.email,
            active_organization_id=str(test_org.organization_id),
            expires_minutes=60,
        )
        other_client = AuthenticatedClient(client, token)

        # Try to access private workspace
        response = other_client.get(
            f"/api/organizations/{test_org.organization_id}/workspaces/{workspace.workspace_id}"
        )
        assert response.status_code == 403

    def test_can_view_org_visible_workspace(
        self, client, db_session, test_org, test_role, test_user
    ):
        """Can view org-visible workspace even if not owner."""
        # Create workspace with org visibility
        workspace = Workspace(
            organization_id=test_org.organization_id,
            owner_user_id=test_user.user_id,
            name="Org Visible Workspace",
            visibility="org",
        )
        db_session.add(workspace)
        db_session.commit()

        # Create another user
        other_user = User(email="viewer@example.com", password_hash="test", status="active")
        db_session.add(other_user)
        db_session.flush()

        other_membership = OrganizationMembership(
            organization_id=test_org.organization_id,
            user_id=other_user.user_id,
            role="member",
            role_id=test_role.role_id,
            status="active",
        )
        db_session.add(other_membership)
        db_session.commit()

        # Generate token for other user
        token = generate_access_token(
            user_id=str(other_user.user_id),
            email=other_user.email,
            active_organization_id=str(test_org.organization_id),
            expires_minutes=60,
        )
        other_client = AuthenticatedClient(client, token)

        # Should be able to view org-visible workspace
        response = other_client.get(
            f"/api/organizations/{test_org.organization_id}/workspaces/{workspace.workspace_id}"
        )
        assert response.status_code == 200
