"""
Coverage tests for the Media Workspaces API (DAM Lightboxes).

Routes under /api/organizations/<org_id>/media/workspaces and
/api/organizations/<org_id>/dam/context.

This file EXTENDS `test_api_media_workspaces.py`, which only smoke-tests
list/create/get/update/delete. These cases drive the large untouched
surface: items endpoints, shares, active-context, bulk actions
(preview/validate/execute/runs), filter+search branches, and
viewer-role 403 enforcement.

S3/FFmpeg/Rekognition are not invoked directly; the bulk-action runner
goes through `get_org_media_url` and the Celery delay path, both of
which are stubbed with autouse fixtures so no external calls happen.
"""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch
from uuid import UUID, uuid4

import pytest

from app.models import (
    Media,
    MediaDerivative,
    MediaWorkspace,
    MediaWorkspaceActionRun,
    MediaWorkspaceItem,
    MediaWorkspaceShare,
    MetadataTemplate,
    UserActiveContext,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _post_json(auth_client, url, data):
    return auth_client.post(url, data=json.dumps(data), content_type="application/json")


def _patch_json(auth_client, url, data):
    return auth_client.patch(url, data=json.dumps(data), content_type="application/json")


def _delete_json(auth_client, url, data):
    return auth_client.delete(url, data=json.dumps(data), content_type="application/json")


def _base_url(org_id) -> str:
    return f"/api/organizations/{org_id}/media/workspaces"


def _ensure_permissions(db_session, role, keys):
    """Idempotently attach a set of permission keys to `role`."""
    from app.models import Permission as PermissionModel, RolePermission

    for key in keys:
        scope, action = key.rsplit(".", 1)
        existing = (
            db_session.query(PermissionModel)
            .filter_by(permission_key=key)
            .first()
        )
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

        exists_rp = (
            db_session.query(RolePermission)
            .filter_by(role_id=role.role_id, permission_id=perm.permission_id)
            .first()
        )
        if not exists_rp:
            db_session.add(
                RolePermission(role_id=role.role_id, permission_id=perm.permission_id)
            )
    db_session.flush()


def _role_for(db_session, org_id, user_id):
    from app.models import OrganizationMembership, Role

    membership = (
        db_session.query(OrganizationMembership)
        .filter_by(organization_id=org_id, user_id=user_id)
        .first()
    )
    assert membership is not None
    role = db_session.query(Role).filter_by(role_id=membership.role_id).first()
    assert role is not None
    return role


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mw_auth_setup(auth_setup, db_session):
    """Admin client + all media_workspaces.* perms (mirrors the sibling file)."""
    auth_client, org, user = auth_setup
    role = _role_for(db_session, org.organization_id, user.user_id)
    _ensure_permissions(
        db_session,
        role,
        [
            "media_workspaces.view",
            "media_workspaces.create",
            "media_workspaces.edit",
            "media_workspaces.delete",
            "media_workspaces.share",
            "media_workspaces.execute",
            "media.view",
        ],
    )
    db_session.commit()
    return auth_client, org, user


@pytest.fixture
def mw_viewer_setup(viewer_auth_setup, db_session):
    """Viewer client with media.view + media_workspaces.view only.

    Used to assert 403 on edit/create/delete/share/execute.
    """
    auth_client, org, user = viewer_auth_setup
    role = _role_for(db_session, org.organization_id, user.user_id)
    _ensure_permissions(
        db_session,
        role,
        ["media_workspaces.view", "media.view"],
    )
    db_session.commit()
    return auth_client, org, user


@pytest.fixture(autouse=True)
def _stub_s3_url():
    """Every code path inside this router that resolves a thumbnail or
    download link funnels through `get_org_media_url`. Stubbing it keeps
    the tests hermetic (no boto3 calls, no AWS config required).
    """
    with patch(
        "app.fastapi_app.routers.media_workspaces.get_org_media_url",
        return_value="https://stub.example.com/signed",
    ):
        yield


@pytest.fixture(autouse=True)
def _stub_bulk_task():
    """The async `create_renditions` path enqueues a Celery task. With
    `_celery_eager` on, that would run the real task body (which opens
    S3, ffmpeg, etc.). Replace the task module attribute with a no-op
    whose `.delay` records calls.
    """
    fake_task = MagicMock()
    fake_task.delay = MagicMock(return_value=MagicMock(id="fake-celery-id"))
    with patch(
        "app.tasks.media.execute_workspace_bulk_action_task",
        fake_task,
        create=True,
    ):
        yield fake_task


# ---------------------------------------------------------------------------
# Row factories
# ---------------------------------------------------------------------------


def _make_workspace(db_session, org_id, user_id, **overrides):
    defaults = dict(
        organization_id=org_id,
        owner_user_id=user_id,
        workspace_type="media",
        name="WS",
        visibility="private",
    )
    defaults.update(overrides)
    ws = MediaWorkspace(**defaults)
    db_session.add(ws)
    db_session.commit()
    return ws


def _make_media(db_session, org_id, **overrides):
    defaults = dict(
        organization_id=org_id,
        s3_key=f"orgs/{org_id}/media/{uuid4().hex}.jpg",
        filename="photo.jpg",
        file_size=2048,
        mime_type="image/jpeg",
        media_type="image",
        processing_status="completed",
    )
    defaults.update(overrides)
    m = Media(**defaults)
    db_session.add(m)
    db_session.commit()
    return m


def _add_item(db_session, workspace, media, user_id, sort_order=0, note=None):
    item = MediaWorkspaceItem(
        workspace_id=workspace.workspace_id,
        media_id=media.media_id,
        added_by_user_id=user_id,
        sort_order=sort_order,
        note=note,
    )
    db_session.add(item)
    db_session.commit()
    return item


def _make_share(db_session, workspace, principal_id, permission="view", created_by=None):
    share = MediaWorkspaceShare(
        workspace_id=workspace.workspace_id,
        organization_id=workspace.organization_id,
        principal_type="user",
        principal_id=principal_id,
        permission=permission,
        created_by=created_by,
    )
    db_session.add(share)
    db_session.commit()
    return share


# ===========================================================================
# LIST workspaces — pagination, search, filter branches
# ===========================================================================


class TestListFilters:
    def test_list_with_search(self, mw_auth_setup, db_session):
        """Search filter matches on name ilike."""
        auth_client, org, user = mw_auth_setup
        _make_workspace(db_session, org.organization_id, user.user_id, name="Photography")
        _make_workspace(db_session, org.organization_id, user.user_id, name="Sculptures")

        resp = auth_client.get(
            _base_url(org.organization_id), params={"search": "phot"}
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1
        assert data["items"][0]["name"] == "Photography"

    def test_list_pagination(self, mw_auth_setup, db_session):
        """limit/offset propagate into response."""
        auth_client, org, user = mw_auth_setup
        for i in range(3):
            _make_workspace(db_session, org.organization_id, user.user_id, name=f"WS {i}")

        resp = auth_client.get(
            _base_url(org.organization_id), params={"limit": 2, "offset": 1}
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["limit"] == 2
        assert data["offset"] == 1
        assert len(data["items"]) == 2
        assert data["total"] == 3

    def test_list_filter_owned(self, mw_auth_setup, db_session):
        """`filter=owned` hides org-visible workspaces owned by others."""
        auth_client, org, user = mw_auth_setup

        from app.models import User

        other_user = User(
            email="other@example.com", password_hash="x", status="active"
        )
        db_session.add(other_user)
        db_session.commit()

        _make_workspace(db_session, org.organization_id, user.user_id, name="Mine")
        _make_workspace(
            db_session,
            org.organization_id,
            other_user.user_id,
            name="Theirs",
            visibility="org",
        )

        resp = auth_client.get(
            _base_url(org.organization_id), params={"filter": "owned"}
        )
        assert resp.status_code == 200
        names = [w["name"] for w in resp.get_json()["items"]]
        assert "Mine" in names
        assert "Theirs" not in names

    def test_list_filter_shared_returns_org_visible(self, mw_auth_setup, db_session):
        """`filter=shared` returns workspaces shared with the user or with
        org-level visibility."""
        auth_client, org, user = mw_auth_setup

        from app.models import User

        other_user = User(
            email="other2@example.com", password_hash="x", status="active"
        )
        db_session.add(other_user)
        db_session.commit()

        _make_workspace(db_session, org.organization_id, user.user_id, name="Own")
        _make_workspace(
            db_session,
            org.organization_id,
            other_user.user_id,
            name="OrgWide",
            visibility="org",
        )

        resp = auth_client.get(
            _base_url(org.organization_id), params={"filter": "shared"}
        )
        assert resp.status_code == 200
        names = [w["name"] for w in resp.get_json()["items"]]
        assert "OrgWide" in names

    def test_list_ignores_soft_deleted(self, mw_auth_setup, db_session):
        """is_deleted=True rows never appear in the listing."""
        auth_client, org, user = mw_auth_setup
        ws = _make_workspace(
            db_session, org.organization_id, user.user_id, name="Gone"
        )
        ws.is_deleted = True
        db_session.commit()

        resp = auth_client.get(_base_url(org.organization_id))
        assert resp.status_code == 200
        assert resp.get_json()["total"] == 0


# ===========================================================================
# GET workspace — 404, wrong-org, access-denied, cover-media fallback
# ===========================================================================


class TestGetWorkspace:
    def test_get_with_pinned_items_returns_asset_count(self, mw_auth_setup, db_session):
        auth_client, org, user = mw_auth_setup
        ws = _make_workspace(
            db_session, org.organization_id, user.user_id, name="WithItems"
        )
        m1 = _make_media(db_session, org.organization_id)
        m2 = _make_media(db_session, org.organization_id)
        _add_item(db_session, ws, m1, user.user_id, sort_order=0)
        _add_item(db_session, ws, m2, user.user_id, sort_order=1)

        url = f"{_base_url(org.organization_id)}/{ws.workspace_id}"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["asset_count"] == 2
        assert len(body["items"]) == 2
        assert body["pagination"]["page"] == 1
        assert body["permission_level"] == "admin"

    def test_get_wrong_org_is_404(self, mw_auth_setup, db_session):
        """A workspace belonging to another org returns 404, not 403."""
        auth_client, org, user = mw_auth_setup

        from app.models import Organization

        other_org = Organization(
            name="Other", slug="other", is_demo=False, status="active"
        )
        db_session.add(other_org)
        db_session.commit()

        ws = _make_workspace(
            db_session, other_org.organization_id, user.user_id, name="NotYours"
        )

        url = f"{_base_url(org.organization_id)}/{ws.workspace_id}"
        resp = auth_client.get(url)
        assert resp.status_code == 404

    def test_get_private_workspace_owned_by_other_user_is_403(
        self, mw_auth_setup, db_session
    ):
        """Private workspace owned by someone else → 403."""
        auth_client, org, _user = mw_auth_setup

        from app.models import User

        other_user = User(
            email="stranger@example.com", password_hash="x", status="active"
        )
        db_session.add(other_user)
        db_session.commit()

        ws = _make_workspace(
            db_session,
            org.organization_id,
            other_user.user_id,
            name="Private",
            visibility="private",
        )

        url = f"{_base_url(org.organization_id)}/{ws.workspace_id}"
        resp = auth_client.get(url)
        assert resp.status_code == 403

    def test_get_shared_workspace_returns_permission_level(self, mw_auth_setup, db_session):
        """A workspace shared via MediaWorkspaceShare returns the matching
        permission_level to the grantee."""
        auth_client, org, user = mw_auth_setup

        from app.models import User

        owner = User(
            email="owner@example.com", password_hash="x", status="active"
        )
        db_session.add(owner)
        db_session.commit()

        ws = _make_workspace(
            db_session, org.organization_id, owner.user_id, name="Shared"
        )
        _make_share(
            db_session, ws, principal_id=user.user_id, permission="edit",
            created_by=owner.user_id,
        )

        url = f"{_base_url(org.organization_id)}/{ws.workspace_id}"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["permission_level"] == "edit"
        assert body["is_owner"] is False


# ===========================================================================
# CREATE workspace with initial media_ids
# ===========================================================================


class TestCreateWorkspaceWithMedia:
    def test_create_with_media_ids_attaches_items(self, mw_auth_setup, db_session):
        auth_client, org, _ = mw_auth_setup
        m1 = _make_media(db_session, org.organization_id)
        m2 = _make_media(db_session, org.organization_id)
        # One ID that doesn't exist — should be silently skipped
        ghost_id = str(uuid4())

        resp = _post_json(
            auth_client,
            _base_url(org.organization_id),
            {
                "name": "Batch",
                "media_ids": [str(m1.media_id), str(m2.media_id), ghost_id, "not-a-uuid"],
            },
        )
        assert resp.status_code == 201
        body = resp.get_json()
        assert body["asset_count"] == 2

    def test_create_default_visibility_is_private(self, mw_auth_setup):
        auth_client, org, _ = mw_auth_setup
        resp = _post_json(
            auth_client, _base_url(org.organization_id), {"name": "Defaults"}
        )
        assert resp.status_code == 201
        assert resp.get_json()["visibility"] == "private"


# ===========================================================================
# UPDATE workspace — visibility gates, cover_media_id
# ===========================================================================


class TestUpdateWorkspace:
    def test_update_visibility_and_description(self, mw_auth_setup, db_session):
        auth_client, org, user = mw_auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)

        url = f"{_base_url(org.organization_id)}/{ws.workspace_id}"
        resp = _patch_json(
            auth_client,
            url,
            {"visibility": "org", "description": "Team wide"},
        )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["visibility"] == "org"
        assert body["description"] == "Team wide"

    def test_update_invalid_visibility_rejected(self, mw_auth_setup, db_session):
        auth_client, org, user = mw_auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)

        url = f"{_base_url(org.organization_id)}/{ws.workspace_id}"
        resp = _patch_json(auth_client, url, {"visibility": "public"})
        assert resp.status_code == 400

    def test_update_empty_name_rejected(self, mw_auth_setup, db_session):
        auth_client, org, user = mw_auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)

        url = f"{_base_url(org.organization_id)}/{ws.workspace_id}"
        resp = _patch_json(auth_client, url, {"name": "   "})
        assert resp.status_code == 422

    def test_update_cover_media_id_set_and_clear(self, mw_auth_setup, db_session):
        auth_client, org, user = mw_auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)
        media = _make_media(db_session, org.organization_id)
        _add_item(db_session, ws, media, user.user_id)

        url = f"{_base_url(org.organization_id)}/{ws.workspace_id}"
        resp_set = _patch_json(auth_client, url, {"cover_media_id": str(media.media_id)})
        assert resp_set.status_code == 200

        resp_clear = _patch_json(auth_client, url, {"cover_media_id": None})
        assert resp_clear.status_code == 200

    def test_non_owner_without_share_cannot_update(self, mw_auth_setup, db_session):
        """An admin user (has media_workspaces.edit) is still blocked from
        editing a private workspace that belongs to someone else and isn't
        shared to them."""
        auth_client, org, _ = mw_auth_setup

        from app.models import User

        owner = User(
            email="someone@example.com", password_hash="x", status="active"
        )
        db_session.add(owner)
        db_session.commit()

        ws = _make_workspace(db_session, org.organization_id, owner.user_id)

        url = f"{_base_url(org.organization_id)}/{ws.workspace_id}"
        resp = _patch_json(auth_client, url, {"name": "Stolen"})
        assert resp.status_code == 403


# ===========================================================================
# DELETE workspace — non-owner
# ===========================================================================


class TestDeleteWorkspace:
    def test_delete_not_found(self, mw_auth_setup):
        auth_client, org, _ = mw_auth_setup
        resp = auth_client.delete(f"{_base_url(org.organization_id)}/{uuid4()}")
        assert resp.status_code == 404

    def test_delete_non_owner_forbidden(self, mw_auth_setup, db_session):
        auth_client, org, _ = mw_auth_setup

        from app.models import User

        owner = User(
            email="delowner@example.com", password_hash="x", status="active"
        )
        db_session.add(owner)
        db_session.commit()
        # `org` visibility so the caller CAN see it but still can't delete it.
        ws = _make_workspace(
            db_session, org.organization_id, owner.user_id, visibility="org"
        )

        resp = auth_client.delete(
            f"{_base_url(org.organization_id)}/{ws.workspace_id}"
        )
        assert resp.status_code == 403


# ===========================================================================
# Workspace ITEMS — list / add / remove / reorder
# ===========================================================================


class TestWorkspaceItems:
    def test_list_items_paginates(self, mw_auth_setup, db_session):
        auth_client, org, user = mw_auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)
        for i in range(3):
            m = _make_media(db_session, org.organization_id)
            _add_item(db_session, ws, m, user.user_id, sort_order=i)

        url = f"{_base_url(org.organization_id)}/{ws.workspace_id}/items"
        resp = auth_client.get(url, params={"limit": 2, "offset": 0})
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["total"] == 3
        assert len(body["items"]) == 2
        assert body["items"][0]["sort_order"] == 0

    def test_add_items(self, mw_auth_setup, db_session):
        auth_client, org, user = mw_auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)
        m1 = _make_media(db_session, org.organization_id)
        m2 = _make_media(db_session, org.organization_id)

        url = f"{_base_url(org.organization_id)}/{ws.workspace_id}/items"
        resp = _post_json(
            auth_client, url,
            {"media_ids": [str(m1.media_id), str(m2.media_id)]},
        )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["added_count"] == 2
        assert len(body["added"]) == 2

    def test_add_items_skips_duplicates_and_unknowns(self, mw_auth_setup, db_session):
        """Adding the same media again + a bogus UUID + an existing-but-other-org
        media should all land in `skipped`, not raise."""
        auth_client, org, user = mw_auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)
        m1 = _make_media(db_session, org.organization_id)
        _add_item(db_session, ws, m1, user.user_id)

        from app.models import Organization

        other_org = Organization(
            name="Other2", slug="other2", is_demo=False, status="active"
        )
        db_session.add(other_org)
        db_session.commit()
        m_other_org = _make_media(db_session, other_org.organization_id)

        url = f"{_base_url(org.organization_id)}/{ws.workspace_id}/items"
        resp = _post_json(
            auth_client, url,
            {
                "media_ids": [
                    str(m1.media_id),                    # already in ws
                    str(m_other_org.media_id),           # wrong org
                    "clearly-not-a-uuid",                # bad format
                    str(uuid4()),                        # unknown
                ]
            },
        )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["added_count"] == 0
        assert len(body["skipped"]) == 4

    def test_add_items_empty_payload_rejected(self, mw_auth_setup, db_session):
        auth_client, org, user = mw_auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)

        url = f"{_base_url(org.organization_id)}/{ws.workspace_id}/items"
        resp = _post_json(auth_client, url, {"media_ids": []})
        assert resp.status_code == 400

    def test_remove_items(self, mw_auth_setup, db_session):
        auth_client, org, user = mw_auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)
        m1 = _make_media(db_session, org.organization_id)
        m2 = _make_media(db_session, org.organization_id)
        _add_item(db_session, ws, m1, user.user_id, sort_order=0)
        _add_item(db_session, ws, m2, user.user_id, sort_order=1)

        url = f"{_base_url(org.organization_id)}/{ws.workspace_id}/items"
        resp = _delete_json(
            auth_client, url, {"media_ids": [str(m1.media_id)]}
        )
        assert resp.status_code == 200
        assert resp.get_json()["removed_count"] == 1

    def test_remove_items_empty_rejected(self, mw_auth_setup, db_session):
        auth_client, org, user = mw_auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)

        url = f"{_base_url(org.organization_id)}/{ws.workspace_id}/items"
        resp = _delete_json(auth_client, url, {"media_ids": []})
        assert resp.status_code == 400

    def test_reorder_items(self, mw_auth_setup, db_session):
        auth_client, org, user = mw_auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)
        m1 = _make_media(db_session, org.organization_id)
        m2 = _make_media(db_session, org.organization_id)
        i1 = _add_item(db_session, ws, m1, user.user_id, sort_order=0)
        i2 = _add_item(db_session, ws, m2, user.user_id, sort_order=1)

        url = f"{_base_url(org.organization_id)}/{ws.workspace_id}/items/reorder"
        # Reverse the order: i2 first.
        resp = _post_json(
            auth_client, url,
            {"item_ids": [str(i2.workspace_item_id), str(i1.workspace_item_id)]},
        )
        assert resp.status_code == 200
        assert resp.get_json()["success"] is True

    def test_reorder_items_empty_rejected(self, mw_auth_setup, db_session):
        auth_client, org, user = mw_auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)

        url = f"{_base_url(org.organization_id)}/{ws.workspace_id}/items/reorder"
        resp = _post_json(auth_client, url, {"item_ids": []})
        assert resp.status_code == 400


# ===========================================================================
# SHARING — list / create / update-existing / delete / 404
# ===========================================================================


class TestSharing:
    def test_create_share_auto_promotes_private_to_shared(self, mw_auth_setup, db_session):
        """Creating a share on a private workspace bumps visibility to 'shared'."""
        auth_client, org, user = mw_auth_setup
        ws = _make_workspace(
            db_session, org.organization_id, user.user_id, visibility="private"
        )

        from app.models import User

        target = User(
            email="target@example.com", password_hash="x", status="active"
        )
        db_session.add(target)
        db_session.commit()

        url = f"{_base_url(org.organization_id)}/{ws.workspace_id}/shares"
        resp = _post_json(
            auth_client, url,
            {"user_id": str(target.user_id), "permission": "edit"},
        )
        assert resp.status_code == 201
        body = resp.get_json()
        assert body["permission"] == "edit"

        db_session.refresh(ws)
        assert ws.visibility == "shared"

    def test_create_share_missing_user_id(self, mw_auth_setup, db_session):
        auth_client, org, user = mw_auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)

        url = f"{_base_url(org.organization_id)}/{ws.workspace_id}/shares"
        resp = _post_json(auth_client, url, {"permission": "view"})
        assert resp.status_code == 422

    def test_create_share_invalid_permission(self, mw_auth_setup, db_session):
        auth_client, org, user = mw_auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)

        url = f"{_base_url(org.organization_id)}/{ws.workspace_id}/shares"
        resp = _post_json(
            auth_client, url,
            {"user_id": str(uuid4()), "permission": "god-mode"},
        )
        assert resp.status_code == 400

    def test_create_share_updates_existing(self, mw_auth_setup, db_session):
        """A second POST for the same principal upgrades the permission in place."""
        auth_client, org, user = mw_auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)

        from app.models import User

        target = User(
            email="upgrade@example.com", password_hash="x", status="active"
        )
        db_session.add(target)
        db_session.commit()

        url = f"{_base_url(org.organization_id)}/{ws.workspace_id}/shares"
        first = _post_json(
            auth_client, url,
            {"user_id": str(target.user_id), "permission": "view"},
        )
        assert first.status_code == 201

        second = _post_json(
            auth_client, url,
            {"user_id": str(target.user_id), "permission": "admin"},
        )
        assert second.status_code == 201
        assert second.get_json()["permission"] == "admin"

        # Exactly one share row.
        count = (
            db_session.query(MediaWorkspaceShare)
            .filter_by(workspace_id=ws.workspace_id)
            .count()
        )
        assert count == 1

    def test_list_shares(self, mw_auth_setup, db_session):
        auth_client, org, user = mw_auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)

        from app.models import User

        t1 = User(email="a@example.com", password_hash="x", status="active")
        t2 = User(email="b@example.com", password_hash="x", status="active")
        db_session.add_all([t1, t2])
        db_session.commit()
        _make_share(db_session, ws, t1.user_id, "view", created_by=user.user_id)
        _make_share(db_session, ws, t2.user_id, "edit", created_by=user.user_id)

        url = f"{_base_url(org.organization_id)}/{ws.workspace_id}/shares"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        body = resp.get_json()
        assert len(body["shares"]) == 2
        perms = sorted(s["permission"] for s in body["shares"])
        assert perms == ["edit", "view"]

    def test_delete_share_demotes_to_private_when_last(self, mw_auth_setup, db_session):
        """Removing the last share on a 'shared' workspace drops it back
        to 'private'."""
        auth_client, org, user = mw_auth_setup
        ws = _make_workspace(
            db_session, org.organization_id, user.user_id, visibility="shared"
        )

        from app.models import User

        target = User(
            email="removeme@example.com", password_hash="x", status="active"
        )
        db_session.add(target)
        db_session.commit()
        share = _make_share(
            db_session, ws, target.user_id, "view", created_by=user.user_id
        )

        url = (
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/shares/{share.share_id}"
        )
        resp = auth_client.delete(url)
        assert resp.status_code == 200
        assert resp.get_json()["success"] is True

        db_session.refresh(ws)
        assert ws.visibility == "private"

    def test_delete_share_not_found(self, mw_auth_setup, db_session):
        auth_client, org, user = mw_auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)

        url = (
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/shares/{uuid4()}"
        )
        resp = auth_client.delete(url)
        assert resp.status_code == 404


# ===========================================================================
# ACTIVE CONTEXT
# ===========================================================================


class TestActiveContext:
    def _context_url(self, org_id):
        return f"/api/organizations/{org_id}/dam/context"

    def test_get_context_when_none_set(self, mw_auth_setup):
        auth_client, org, _ = mw_auth_setup
        resp = auth_client.get(self._context_url(org.organization_id))
        assert resp.status_code == 200
        assert resp.get_json()["context"] is None

    def test_set_workspace_context(self, mw_auth_setup, db_session):
        auth_client, org, user = mw_auth_setup
        ws = _make_workspace(
            db_session, org.organization_id, user.user_id, name="Active"
        )

        url = (
            f"/api/organizations/{org.organization_id}/dam/context/workspace/"
            f"{ws.workspace_id}"
        )
        resp = auth_client.post(url)
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["context"]["type"] == "media_workspace"
        assert body["context"]["id"] == str(ws.workspace_id)

        # GET now reflects it — and translates dam_workspace → media_workspace.
        get_resp = auth_client.get(self._context_url(org.organization_id))
        assert get_resp.status_code == 200
        got = get_resp.get_json()["context"]
        assert got["type"] == "media_workspace"
        assert got["workspace"]["name"] == "Active"

    def test_set_workspace_context_updates_existing(self, mw_auth_setup, db_session):
        """Second POST should update the existing UserActiveContext row in
        place rather than insert a duplicate."""
        auth_client, org, user = mw_auth_setup
        ws1 = _make_workspace(db_session, org.organization_id, user.user_id, name="W1")
        ws2 = _make_workspace(db_session, org.organization_id, user.user_id, name="W2")

        base = f"/api/organizations/{org.organization_id}/dam/context/workspace"
        assert auth_client.post(f"{base}/{ws1.workspace_id}").status_code == 200
        assert auth_client.post(f"{base}/{ws2.workspace_id}").status_code == 200

        rows = (
            db_session.query(UserActiveContext)
            .filter_by(user_id=user.user_id, app="media")
            .count()
        )
        assert rows == 1

    def test_set_asset_context(self, mw_auth_setup, db_session):
        auth_client, org, _ = mw_auth_setup
        media = _make_media(db_session, org.organization_id, title="Cover")

        url = (
            f"/api/organizations/{org.organization_id}/dam/context/asset/"
            f"{media.media_id}"
        )
        resp = auth_client.post(url)
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["context"]["type"] == "asset"
        assert body["context"]["asset"]["title"] == "Cover"

    def test_set_asset_context_not_found(self, mw_auth_setup):
        auth_client, org, _ = mw_auth_setup
        url = (
            f"/api/organizations/{org.organization_id}/dam/context/asset/{uuid4()}"
        )
        resp = auth_client.post(url)
        assert resp.status_code == 404

    def test_clear_context(self, mw_auth_setup, db_session):
        auth_client, org, user = mw_auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)
        # Seed an active context first.
        base = f"/api/organizations/{org.organization_id}/dam/context/workspace"
        assert auth_client.post(f"{base}/{ws.workspace_id}").status_code == 200

        resp = auth_client.delete(self._context_url(org.organization_id))
        assert resp.status_code == 200
        assert resp.get_json()["success"] is True

        # GET returns None after clear.
        get_resp = auth_client.get(self._context_url(org.organization_id))
        assert get_resp.get_json()["context"] is None

    def test_clear_context_no_row_still_succeeds(self, mw_auth_setup):
        """Clearing when the user has never had a context should not 500."""
        auth_client, org, _ = mw_auth_setup
        resp = auth_client.delete(self._context_url(org.organization_id))
        assert resp.status_code == 200


# ===========================================================================
# BULK ACTIONS — list, preview, validate, execute (sync + async), runs
# ===========================================================================


class TestBulkActionsList:
    def test_list_actions_includes_download_options(self, mw_auth_setup, db_session):
        """`download_assets` action_data should include the union of
        derivative types present on the workspace's media."""
        auth_client, org, user = mw_auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)
        media = _make_media(db_session, org.organization_id)
        _add_item(db_session, ws, media, user.user_id)
        db_session.add(
            MediaDerivative(
                media_id=media.media_id,
                organization_id=org.organization_id,
                derivative_type="thumbnail",
                format="jpeg",
                s3_key=f"orgs/{org.organization_id}/derivatives/thumb.jpg",
                width=200,
                height=200,
                file_size=512,
            )
        )
        db_session.commit()

        url = f"{_base_url(org.organization_id)}/{ws.workspace_id}/actions"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        actions = resp.get_json()["actions"]
        keys = [a["key"] for a in actions]
        assert "download_assets" in keys
        dl = next(a for a in actions if a["key"] == "download_assets")
        values = [o["value"] for o in dl["download_options"]]
        assert "original" in values
        assert "thumbnail" in values


class TestBulkActionPreview:
    def test_preview_download_assets_totals_size(self, mw_auth_setup, db_session):
        auth_client, org, user = mw_auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)
        m1 = _make_media(db_session, org.organization_id, file_size=1000)
        m2 = _make_media(db_session, org.organization_id, file_size=2000)
        _add_item(db_session, ws, m1, user.user_id)
        _add_item(db_session, ws, m2, user.user_id)

        url = (
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/actions/"
            f"download_assets/preview"
        )
        resp = _post_json(auth_client, url, {"action_params": {}})
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["total_count"] == 2
        assert body["total_size_bytes"] == 3000

    def test_preview_unknown_action_400(self, mw_auth_setup, db_session):
        auth_client, org, user = mw_auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)

        url = (
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/actions/"
            f"not_a_real_action/preview"
        )
        resp = _post_json(auth_client, url, {"action_params": {}})
        assert resp.status_code == 400

    def test_preview_download_restricted_adds_warning(self, mw_auth_setup, db_session):
        auth_client, org, user = mw_auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)
        m = _make_media(
            db_session,
            org.organization_id,
            copyright_status="rights_reserved",
            file_size=5,
        )
        _add_item(db_session, ws, m, user.user_id)

        url = (
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/actions/"
            f"download_assets/preview"
        )
        resp = _post_json(auth_client, url, {"action_params": {}})
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["has_warnings"] is True
        assert body["assets"][0]["warnings"]


class TestBulkActionValidate:
    def test_validate_missing_required_param(self, mw_auth_setup, db_session):
        """`move_to_folder` requires `folder_id`."""
        auth_client, org, user = mw_auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)

        url = (
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/actions/"
            f"move_to_folder/validate"
        )
        resp = _post_json(auth_client, url, {"action_params": {}})
        assert resp.status_code == 422

    def test_validate_download_blocks_restricted(self, mw_auth_setup, db_session):
        auth_client, org, user = mw_auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)
        allowed = _make_media(db_session, org.organization_id)
        blocked = _make_media(
            db_session, org.organization_id, copyright_status="rights_reserved"
        )
        _add_item(db_session, ws, allowed, user.user_id, sort_order=0)
        _add_item(db_session, ws, blocked, user.user_id, sort_order=1)

        url = (
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/actions/"
            f"download_assets/validate"
        )
        resp = _post_json(auth_client, url, {"action_params": {}})
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["allowed_count"] == 1
        assert body["blocked_count"] == 1
        assert body["blocked"][0]["code"] == "RIGHTS_RESTRICTED"

    def test_validate_apply_metadata_template_missing_template(
        self, mw_auth_setup, db_session
    ):
        """Template that doesn't exist returns action_valid=False with
        error, not an exception."""
        auth_client, org, user = mw_auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)

        url = (
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/actions/"
            f"apply_metadata_template/validate"
        )
        resp = _post_json(
            auth_client, url,
            {"action_params": {"template_id": str(uuid4())}},
        )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["action_valid"] is False
        assert "not found" in body["error"].lower()

    def test_validate_apply_metadata_template_bad_uuid(
        self, mw_auth_setup, db_session
    ):
        auth_client, org, user = mw_auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)

        url = (
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/actions/"
            f"apply_metadata_template/validate"
        )
        resp = _post_json(
            auth_client, url,
            {"action_params": {"template_id": "not-a-uuid"}},
        )
        assert resp.status_code == 400


class TestBulkActionExecute:
    def test_execute_move_to_folder_unfiled(self, mw_auth_setup, db_session):
        """folder_id='unfiled' clears the folder_id on all targeted media."""
        auth_client, org, user = mw_auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)
        m = _make_media(db_session, org.organization_id)
        _add_item(db_session, ws, m, user.user_id)

        url = (
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/actions/"
            f"move_to_folder/execute"
        )
        resp = _post_json(
            auth_client, url,
            {"action_params": {"folder_id": "unfiled"}},
        )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["status"] == "completed"
        assert body["success_count"] == 1

    def test_execute_set_rights_policy(self, mw_auth_setup, db_session):
        auth_client, org, user = mw_auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)
        m = _make_media(db_session, org.organization_id)
        _add_item(db_session, ws, m, user.user_id)

        url = (
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/actions/"
            f"set_rights_policy/execute"
        )
        resp = _post_json(
            auth_client, url,
            {
                "action_params": {
                    "rights_statement": "All rights reserved",
                    "license": "CC-BY-4.0",
                }
            },
        )
        assert resp.status_code == 200
        assert resp.get_json()["success_count"] == 1
        db_session.refresh(m)
        assert m.rights_statement == "All rights reserved"
        assert m.license == "CC-BY-4.0"

    def test_execute_add_to_lightbox(self, mw_auth_setup, db_session):
        auth_client, org, user = mw_auth_setup
        source = _make_workspace(
            db_session, org.organization_id, user.user_id, name="Source"
        )
        target = _make_workspace(
            db_session, org.organization_id, user.user_id, name="Target"
        )
        m = _make_media(db_session, org.organization_id)
        _add_item(db_session, source, m, user.user_id)

        url = (
            f"{_base_url(org.organization_id)}/{source.workspace_id}/actions/"
            f"add_to_lightbox/execute"
        )
        resp = _post_json(
            auth_client, url,
            {
                "action_params": {
                    "target_workspace_id": str(target.workspace_id),
                    "note": "copied",
                }
            },
        )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["success_count"] == 1

        # Target now has the media item.
        n = (
            db_session.query(MediaWorkspaceItem)
            .filter_by(workspace_id=target.workspace_id)
            .count()
        )
        assert n == 1

    def test_execute_add_to_lightbox_skips_existing(self, mw_auth_setup, db_session):
        """Re-adding media already present in the target lightbox is
        reported as skipped, not a failure."""
        auth_client, org, user = mw_auth_setup
        source = _make_workspace(
            db_session, org.organization_id, user.user_id, name="Src"
        )
        target = _make_workspace(
            db_session, org.organization_id, user.user_id, name="Tgt"
        )
        m = _make_media(db_session, org.organization_id)
        _add_item(db_session, source, m, user.user_id)
        _add_item(db_session, target, m, user.user_id)

        url = (
            f"{_base_url(org.organization_id)}/{source.workspace_id}/actions/"
            f"add_to_lightbox/execute"
        )
        resp = _post_json(
            auth_client, url,
            {"action_params": {"target_workspace_id": str(target.workspace_id)}},
        )
        assert resp.status_code == 200
        body = resp.get_json()
        # Item already present → one result with status="skipped"
        statuses = [r["status"] for r in body["results"]]
        assert "skipped" in statuses

    def test_execute_download_original(self, mw_auth_setup, db_session):
        auth_client, org, user = mw_auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)
        m = _make_media(db_session, org.organization_id)
        _add_item(db_session, ws, m, user.user_id)

        url = (
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/actions/"
            f"download_assets/execute"
        )
        resp = _post_json(
            auth_client, url,
            {"action_params": {"derivative_type": "original"}},
        )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["success_count"] == 1
        assert body["results"][0]["artifact_url"].startswith("https://stub")

    def test_execute_download_missing_derivative(self, mw_auth_setup, db_session):
        """Asking for a derivative type that doesn't exist is a per-item
        error, not a 500."""
        auth_client, org, user = mw_auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)
        m = _make_media(db_session, org.organization_id)
        _add_item(db_session, ws, m, user.user_id)

        url = (
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/actions/"
            f"download_assets/execute"
        )
        resp = _post_json(
            auth_client, url,
            {"action_params": {"derivative_type": "medium"}},
        )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["error_count"] == 1
        assert body["results"][0]["status"] == "error"

    def test_execute_apply_metadata_template(self, mw_auth_setup, db_session):
        auth_client, org, user = mw_auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)
        m = _make_media(db_session, org.organization_id, title="Original")
        _add_item(db_session, ws, m, user.user_id)

        tpl = MetadataTemplate(
            organization_id=org.organization_id,
            name="Standard",
            is_active=True,
            template_fields={
                "title_prefix": "[Museum] ",
                "description": "Accessioned item",
                "creator": "Unknown",
            },
            created_by=user.user_id,
        )
        db_session.add(tpl)
        db_session.commit()

        url = (
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/actions/"
            f"apply_metadata_template/execute"
        )
        resp = _post_json(
            auth_client, url,
            {
                "action_params": {
                    "template_id": str(tpl.template_id),
                    "overwrite_existing": True,
                }
            },
        )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["success_count"] == 1
        db_session.refresh(m)
        assert m.title == "[Museum] Original"
        assert m.creator == "Unknown"

    def test_execute_apply_metadata_template_missing(self, mw_auth_setup, db_session):
        """An unknown template_id produces per-item errors, not a 500."""
        auth_client, org, user = mw_auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)
        m = _make_media(db_session, org.organization_id)
        _add_item(db_session, ws, m, user.user_id)

        url = (
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/actions/"
            f"apply_metadata_template/execute"
        )
        resp = _post_json(
            auth_client, url,
            {"action_params": {"template_id": str(uuid4())}},
        )
        assert resp.status_code == 200
        assert resp.get_json()["error_count"] == 1

    def test_execute_async_returns_202_and_creates_run(
        self, mw_auth_setup, db_session, _stub_bulk_task
    ):
        """`create_renditions` is `is_async=True`. The handler should
        queue a run, return 202, and NOT run the task body inline."""
        auth_client, org, user = mw_auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)
        m = _make_media(db_session, org.organization_id)
        _add_item(db_session, ws, m, user.user_id)

        url = (
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/actions/"
            f"create_renditions/execute"
        )
        resp = _post_json(
            auth_client, url,
            {
                "action_params": {
                    "derivative_configs": [{"type": "thumbnail", "width": 200}]
                }
            },
        )
        assert resp.status_code == 202
        body = resp.get_json()
        assert body["status"] == "pending"
        assert body["total_count"] == 1
        assert _stub_bulk_task.delay.called

        run_id = UUID(body["run_id"])
        run = (
            db_session.query(MediaWorkspaceActionRun)
            .filter_by(run_id=run_id)
            .first()
        )
        assert run is not None
        assert run.action_key == "create_renditions"
        assert run.total_items == 1

    def test_execute_unknown_action_400(self, mw_auth_setup, db_session):
        auth_client, org, user = mw_auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)

        url = (
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/actions/"
            f"not_real/execute"
        )
        resp = _post_json(auth_client, url, {"action_params": {}})
        assert resp.status_code == 400


class TestBulkActionRun:
    def test_get_action_run(self, mw_auth_setup, db_session):
        auth_client, org, user = mw_auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)
        run = MediaWorkspaceActionRun(
            workspace_id=ws.workspace_id,
            organization_id=org.organization_id,
            action_key="create_renditions",
            action_params={"foo": "bar"},
            status="completed",
            total_items=3,
            processed_items=3,
            succeeded_items=3,
            failed_items=0,
            results=[{"media_id": str(uuid4()), "status": "success"}],
            created_by=user.user_id,
        )
        db_session.add(run)
        db_session.commit()

        url = (
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/actions/runs/"
            f"{run.run_id}"
        )
        resp = auth_client.get(url)
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["run_id"] == str(run.run_id)
        assert body["status"] == "completed"
        assert body["success_count"] == 3
        assert body["total_count"] == 3

    def test_get_action_run_not_found(self, mw_auth_setup, db_session):
        auth_client, org, user = mw_auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)

        url = (
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/actions/runs/"
            f"{uuid4()}"
        )
        resp = auth_client.get(url)
        assert resp.status_code == 404


# ===========================================================================
# VIEWER role — 403 on edit/create/delete/share/execute surfaces
# ===========================================================================


class TestViewerForbidden:
    def test_viewer_cannot_create(self, mw_viewer_setup):
        auth_client, org, _ = mw_viewer_setup
        resp = _post_json(
            auth_client, _base_url(org.organization_id), {"name": "Blocked"}
        )
        assert resp.status_code == 403

    def test_viewer_cannot_delete(self, mw_viewer_setup, db_session):
        auth_client, org, user = mw_viewer_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)
        resp = auth_client.delete(
            f"{_base_url(org.organization_id)}/{ws.workspace_id}"
        )
        assert resp.status_code == 403

    def test_viewer_cannot_patch(self, mw_viewer_setup, db_session):
        auth_client, org, user = mw_viewer_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)
        url = f"{_base_url(org.organization_id)}/{ws.workspace_id}"
        resp = _patch_json(auth_client, url, {"name": "Nope"})
        assert resp.status_code == 403

    def test_viewer_cannot_add_items(self, mw_viewer_setup, db_session):
        auth_client, org, user = mw_viewer_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)
        url = f"{_base_url(org.organization_id)}/{ws.workspace_id}/items"
        resp = _post_json(auth_client, url, {"media_ids": [str(uuid4())]})
        assert resp.status_code == 403

    def test_viewer_cannot_share(self, mw_viewer_setup, db_session):
        auth_client, org, user = mw_viewer_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)
        url = f"{_base_url(org.organization_id)}/{ws.workspace_id}/shares"
        resp = _post_json(
            auth_client, url,
            {"user_id": str(uuid4()), "permission": "view"},
        )
        assert resp.status_code == 403

    def test_viewer_cannot_execute_bulk_action(self, mw_viewer_setup, db_session):
        auth_client, org, user = mw_viewer_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)
        url = (
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/actions/"
            f"download_assets/execute"
        )
        resp = _post_json(auth_client, url, {"action_params": {}})
        assert resp.status_code == 403

    def test_viewer_can_list(self, mw_viewer_setup):
        """Sanity: viewer with media_workspaces.view CAN list (no 403)."""
        auth_client, org, _ = mw_viewer_setup
        resp = auth_client.get(_base_url(org.organization_id))
        assert resp.status_code == 200
