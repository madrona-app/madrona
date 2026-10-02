"""
Smoke tests for the Media Workspaces (DAM Workspaces) API.

Routes under /api/organizations/<org_id>/media/workspaces.
"""

import json
from unittest.mock import patch
from uuid import uuid4

import pytest

from app.models import MediaWorkspace, MediaWorkspaceItem, Media


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _post_json(auth_client, url, data):
    """POST JSON helper."""
    return auth_client.post(url, data=json.dumps(data), content_type="application/json")


def _patch_json(auth_client, url, data):
    """PATCH JSON helper."""
    return auth_client.patch(url, data=json.dumps(data), content_type="application/json")


def _add_media_workspace_permissions(db_session, role):
    """Add media_workspaces.* permission keys to the given role."""
    from app.models import Permission as PermissionModel, RolePermission

    keys = [
        "media_workspaces.view",
        "media_workspaces.create",
        "media_workspaces.edit",
        "media_workspaces.delete",
        "media_workspaces.share",
        "media_workspaces.execute",
    ]
    for key in keys:
        scope, action = key.rsplit(".", 1)
        # Check if already exists (avoid unique constraint errors)
        existing = db_session.query(PermissionModel).filter_by(permission_key=key).first()
        if existing:
            perm = existing
        else:
            perm = PermissionModel(
                permission_key=key,
                scope=scope,
                action=action,
                display_name=key.replace(".", " ").title(),
                description=f"Permission for {key}",
            )
            db_session.add(perm)
            db_session.flush()

        # Link to role if not already linked
        existing_rp = db_session.query(RolePermission).filter_by(
            role_id=role.role_id, permission_id=perm.permission_id
        ).first()
        if not existing_rp:
            rp = RolePermission(role_id=role.role_id, permission_id=perm.permission_id)
            db_session.add(rp)
    db_session.flush()


@pytest.fixture
def mw_auth_setup(auth_setup, db_session):
    """Extend auth_setup with media_workspaces.* permissions.

    Returns the same (auth_client, org, user) tuple.
    """
    from app.models import OrganizationMembership

    auth_client, org, user = auth_setup

    # Retrieve the role from the user's membership
    membership = db_session.query(OrganizationMembership).filter_by(
        organization_id=org.organization_id,
        user_id=user.user_id,
    ).first()
    assert membership is not None

    from app.models import Role
    role = db_session.query(Role).filter_by(role_id=membership.role_id).first()
    assert role is not None

    _add_media_workspace_permissions(db_session, role)
    db_session.commit()

    return auth_client, org, user


def _base_url(org_id):
    return f"/api/organizations/{org_id}/media/workspaces"


def _create_workspace_via_db(db_session, org_id, user_id, **overrides):
    """Insert a MediaWorkspace row directly."""
    defaults = dict(
        organization_id=org_id,
        owner_user_id=user_id,
        name="Test Workspace",
        visibility="private",
        workspace_type="media",
    )
    defaults.update(overrides)
    ws = MediaWorkspace(**defaults)
    db_session.add(ws)
    db_session.commit()
    return ws


def _create_media_row(db_session, org_id, **overrides):
    """Insert a Media row directly."""
    defaults = dict(
        organization_id=org_id,
        s3_key=f"orgs/{org_id}/media/{uuid4().hex}.jpg",
        filename="test.jpg",
        file_size=1024,
        mime_type="image/jpeg",
        media_type="image",
        processing_status="completed",
    )
    defaults.update(overrides)
    media = Media(**defaults)
    db_session.add(media)
    db_session.commit()
    return media


# ===========================================================================
# Tests
# ===========================================================================


class TestListMediaWorkspaces:
    def test_list_empty(self, mw_auth_setup):
        """GET returns empty list when no workspaces exist."""
        auth_client, org, _ = mw_auth_setup
        resp = auth_client.get(_base_url(org.organization_id))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["items"] == []
        assert data["total"] == 0

    def test_list_returns_created_workspace(self, mw_auth_setup, db_session):
        """After creating a workspace, list should return it."""
        auth_client, org, user = mw_auth_setup
        _create_workspace_via_db(db_session, org.organization_id, user.user_id, name="WS Alpha")

        resp = auth_client.get(_base_url(org.organization_id))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1
        assert data["items"][0]["name"] == "WS Alpha"


class TestCreateMediaWorkspace:
    def test_create_workspace(self, mw_auth_setup):
        """POST with valid name returns 201."""
        auth_client, org, _ = mw_auth_setup
        resp = _post_json(auth_client, _base_url(org.organization_id), {
            "name": "My Lightbox",
            "description": "A test lightbox",
            "visibility": "private",
        })
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["name"] == "My Lightbox"
        assert "workspace_id" in data

    def test_create_workspace_missing_name(self, mw_auth_setup):
        """POST without name returns 400."""
        auth_client, org, _ = mw_auth_setup
        resp = _post_json(auth_client, _base_url(org.organization_id), {})
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "Name is required" in (_e.get("message", "") if isinstance(_e, dict) else str(_e))

    def test_create_workspace_invalid_visibility(self, mw_auth_setup):
        """POST with invalid visibility returns 400."""
        auth_client, org, _ = mw_auth_setup
        resp = _post_json(auth_client, _base_url(org.organization_id), {
            "name": "Bad Vis",
            "visibility": "bogus",
        })
        assert resp.status_code in (400, 422)


class TestGetMediaWorkspace:
    def test_get_by_id(self, mw_auth_setup, db_session):
        """GET /<id> returns workspace details."""
        auth_client, org, user = mw_auth_setup
        ws = _create_workspace_via_db(db_session, org.organization_id, user.user_id, name="Detail WS")

        url = f"{_base_url(org.organization_id)}/{ws.workspace_id}"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["name"] == "Detail WS"
        assert data["workspace_id"] == str(ws.workspace_id)
        assert data["is_owner"] is True

    def test_get_not_found(self, mw_auth_setup):
        """GET with non-existent ID returns 404."""
        auth_client, org, _ = mw_auth_setup
        url = f"{_base_url(org.organization_id)}/{uuid4()}"
        resp = auth_client.get(url)
        assert resp.status_code == 404


class TestUpdateMediaWorkspace:
    def test_update_name(self, mw_auth_setup, db_session):
        """PATCH with new name updates the workspace."""
        auth_client, org, user = mw_auth_setup
        ws = _create_workspace_via_db(db_session, org.organization_id, user.user_id, name="Old Name")

        url = f"{_base_url(org.organization_id)}/{ws.workspace_id}"
        resp = _patch_json(auth_client, url, {"name": "New Name"})
        assert resp.status_code == 200
        assert resp.get_json()["name"] == "New Name"


class TestDeleteMediaWorkspace:
    def test_delete_workspace(self, mw_auth_setup, db_session):
        """DELETE soft-deletes the workspace, subsequent GET returns 404."""
        auth_client, org, user = mw_auth_setup
        ws = _create_workspace_via_db(db_session, org.organization_id, user.user_id, name="To Delete")

        url = f"{_base_url(org.organization_id)}/{ws.workspace_id}"
        resp = auth_client.delete(url)
        assert resp.status_code == 200
        assert resp.get_json()["success"] is True

        # Verify it no longer appears
        resp2 = auth_client.get(url)
        assert resp2.status_code == 404


class TestAuthRequired:
    def test_list_requires_auth(self, client, db_session):
        """GET without auth token returns 401."""
        # Use a fake org id
        url = f"/api/organizations/{uuid4()}/media/workspaces"
        resp = client.get(url)
        assert resp.status_code == 401
