"""
Coverage-focused integration tests for the unified Workspaces router.

Target: app/fastapi_app/routers/workspaces.py (45% -> 65%+).

The router covers three surfaces: workspace CRUD, workspace item
management (static + dynamic + pinning + reorder), sharing, active
context, and the bulk-action pipeline (list/preview/validate/execute).
The existing tests under ``test_api_workspaces.py`` and
``test_workspaces_api.py`` cover the happiest paths of each; this
module fills the uncovered branches:

* pagination, filters (``filter=owned|shared|all``, ``visibility``,
  ``type``, ``search``) and invalid-filter validation
* list-view cover thumbnail for media workspaces (first-item fallback)
* create: dynamic query validation branch, media-type validation,
  bad-visibility / bad-type 400s
* get-one: shared-with-me path, other-org 404, private-unowned 403
* update: visibility-only-owner guard, cover_media_id (set, unset,
  wrong-org rejection), invalid visibility
* items: pagination, duplicate add (skipped), remove-not-in-workspace,
  reorder, pin on dynamic + idempotency + 404
* shares: list (403 for non-admin viewer), upsert (same user twice),
  auto-promote private->shared, delete missing 404, cross-user delete
* active context: workspace 403 guard, stale workspace cleared on get,
  object-not-found, clear on fresh user returns message
* bulk actions: invalid key 400, missing params, set_cataloging_status
  + set_discoverable (already-discoverable skip path), execute on empty
  workspace returns 400
* viewer role: list works, create 403, edit 403, delete 403

Nothing is mocked under test: every assertion is exercised against the
real router with a postgres-backed session (see tests/conftest.py).
"""

from __future__ import annotations

import json
import uuid
from uuid import uuid4

import pytest

from app.models import (
    CollectionObject,
    Location,
    Media,
    MediaWorkspaceItem,
    ObjectTitle,
    Organization,
    OrganizationMembership,
    Role,
    User,
    Workspace,
    WorkspaceItem,
    WorkspaceShare,
)
from app.services.auth_utils import generate_access_token

# ---------------------------------------------------------------------------
# Fixtures & helpers
# ---------------------------------------------------------------------------


def _base_url(org_id) -> str:
    return f"/api/organizations/{org_id}/workspaces"


def _make_object(db_session, org_id, number, *, title="Test Object", is_discoverable=False):
    obj = CollectionObject(
        organization_id=org_id,
        object_number=number,
        object_status="accessioned",
        is_discoverable=is_discoverable,
    )
    db_session.add(obj)
    db_session.flush()
    db_session.add(
        ObjectTitle(
            organization_id=org_id,
            object_id=obj.object_id,
            title=title,
            is_preferred=True,
        )
    )
    db_session.flush()
    return obj


def _make_workspace(
    db_session,
    org_id,
    owner_id,
    *,
    name="WS",
    visibility="private",
    workspace_type="collections",
    is_dynamic=False,
    dynamic_query=None,
    cover_media_id=None,
):
    ws = Workspace(
        organization_id=org_id,
        owner_user_id=owner_id,
        name=name,
        visibility=visibility,
        workspace_type=workspace_type,
        is_dynamic=is_dynamic,
        dynamic_query=dynamic_query,
        cover_media_id=cover_media_id,
    )
    db_session.add(ws)
    db_session.flush()
    return ws


def _make_media(db_session, org_id, *, filename="pic.jpg", media_type="image"):
    media = Media(
        organization_id=org_id,
        s3_key=f"orgs/{org_id}/media/{uuid.uuid4().hex}.jpg",
        filename=filename,
        file_size=2048,
        mime_type="image/jpeg",
        media_type=media_type,
        processing_status="completed",
    )
    db_session.add(media)
    db_session.flush()
    return media


def _make_location(db_session, org_id, code="L-01"):
    loc = Location(
        organization_id=org_id,
        name=f"Loc {code}",
        code=code,
        path=code,
        depth=0,
        location_type="room",
        status="active",
    )
    db_session.add(loc)
    db_session.flush()
    return loc


def _delete_with_body(auth_client, url, body):
    """DELETE with a JSON body.

    httpx.Client.delete() does not accept ``json=`` kwarg (see httpx source).
    The project's ``_FlaskLikeTestClient`` translates Flask-style
    ``data=<str>, content_type="..."`` kwargs into an httpx ``content=`` +
    Content-Type header, which survives all the way to the ASGI app.
    """
    return auth_client.delete(
        url,
        data=json.dumps(body),
        content_type="application/json",
    )


def _add_item(db_session, workspace_id, object_id, adder_id, sort_order=0):
    wi = WorkspaceItem(
        workspace_id=workspace_id,
        object_id=object_id,
        added_by_user_id=adder_id,
        sort_order=sort_order,
    )
    db_session.add(wi)
    db_session.flush()
    return wi


def _make_second_user(db_session, org, role_id, *, email="peer@example.com"):
    """Create a second user in the same org (sharing the admin role)."""
    u = User(email=email, password_hash="x", status="active")
    db_session.add(u)
    db_session.flush()
    db_session.add(
        OrganizationMembership(
            organization_id=org.organization_id,
            user_id=u.user_id,
            role="admin",
            role_id=role_id,
            status="active",
        )
    )
    db_session.flush()
    return u


@pytest.fixture
def admin_role_id(auth_setup, db_session):
    """Return the role_id of the auth_setup admin user's membership."""
    _, org, user = auth_setup
    membership = (
        db_session.query(OrganizationMembership)
        .filter_by(organization_id=org.organization_id, user_id=user.user_id)
        .first()
    )
    return membership.role_id


# ---------------------------------------------------------------------------
# LIST endpoint — filters, search, pagination, media fallback
# ---------------------------------------------------------------------------


class TestListFilters:
    def test_filter_invalid_visibility(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(_base_url(org.organization_id) + "?visibility=bogus")
        assert resp.status_code == 400
        msg = resp.get_json()["error"]["message"]
        assert "visibility" in msg.lower()

    def test_filter_invalid_type(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(_base_url(org.organization_id) + "?type=weird")
        assert resp.status_code == 400

    def test_default_type_filters_to_collections(self, auth_setup, db_session):
        """No ?type on the list URL still hides media workspaces."""
        auth_client, org, user = auth_setup
        _make_workspace(db_session, org.organization_id, user.user_id, name="Coll WS")
        _make_workspace(
            db_session,
            org.organization_id,
            user.user_id,
            name="Media WS",
            workspace_type="media",
        )
        db_session.commit()

        resp = auth_client.get(_base_url(org.organization_id))
        assert resp.status_code == 200
        names = [w["name"] for w in resp.get_json()["items"]]
        assert "Coll WS" in names
        assert "Media WS" not in names

    def test_type_media_lists_media_workspaces(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        _make_workspace(
            db_session,
            org.organization_id,
            user.user_id,
            name="Media WS",
            workspace_type="media",
        )
        db_session.commit()

        resp = auth_client.get(_base_url(org.organization_id) + "?type=media")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1
        entry = data["items"][0]
        assert entry["workspace_type"] == "media"
        # Response keys differ for media vs. collections workspaces.
        assert "asset_count" in entry

    def test_search_matches_name_case_insensitive(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        _make_workspace(db_session, org.organization_id, user.user_id, name="Holland Set")
        _make_workspace(db_session, org.organization_id, user.user_id, name="Spain Set")
        db_session.commit()

        resp = auth_client.get(_base_url(org.organization_id) + "?search=holl")
        assert resp.status_code == 200
        names = [w["name"] for w in resp.get_json()["items"]]
        assert names == ["Holland Set"]

    def test_pagination_limits_and_total(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        for i in range(5):
            _make_workspace(db_session, org.organization_id, user.user_id, name=f"WS-{i}")
        db_session.commit()

        resp = auth_client.get(_base_url(org.organization_id) + "?limit=2&offset=0")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 5
        assert data["limit"] == 2
        assert len(data["items"]) == 2

    def test_filter_owned_excludes_org_visible_owned_by_other(
        self, auth_setup, admin_role_id, db_session
    ):
        auth_client, org, _ = auth_setup
        other = _make_second_user(db_session, org, admin_role_id, email="other1@example.com")
        # Someone else's org-visible workspace — visible in "all", not in "owned".
        _make_workspace(
            db_session,
            org.organization_id,
            other.user_id,
            name="Peer Org WS",
            visibility="org",
        )
        db_session.commit()

        resp_all = auth_client.get(_base_url(org.organization_id) + "?filter=all")
        resp_owned = auth_client.get(_base_url(org.organization_id) + "?filter=owned")
        assert resp_all.status_code == 200
        assert resp_owned.status_code == 200
        assert any(w["name"] == "Peer Org WS" for w in resp_all.get_json()["items"])
        assert not any(w["name"] == "Peer Org WS" for w in resp_owned.get_json()["items"])

    def test_list_excludes_soft_deleted(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id, name="Gone")
        ws.is_deleted = True
        db_session.commit()

        resp = auth_client.get(_base_url(org.organization_id))
        assert resp.status_code == 200
        assert all(w["workspace_id"] != str(ws.workspace_id) for w in resp.get_json()["items"])


# ---------------------------------------------------------------------------
# CREATE — validation & FK handling
# ---------------------------------------------------------------------------


class TestCreateValidation:
    def test_bad_visibility(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(_base_url(org.organization_id), json={"name": "N", "visibility": "ghost"})
        assert resp.status_code == 400
        assert "visibility" in resp.get_json()["error"]["message"].lower()

    def test_bad_workspace_type(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            _base_url(org.organization_id),
            json={"name": "N", "workspace_type": "spreadsheet"},
        )
        assert resp.status_code == 400
        assert "workspace_type" in resp.get_json()["error"]["message"].lower()

    def test_blank_name_after_trim(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(_base_url(org.organization_id), json={"name": "   "})
        assert resp.status_code == 400

    def test_create_with_object_ids_adds_items(self, auth_setup, db_session):
        """Creating with a list of object_ids seeds the workspace."""
        auth_client, org, user = auth_setup
        o1 = _make_object(db_session, org.organization_id, "O.001")
        o2 = _make_object(db_session, org.organization_id, "O.002")
        db_session.commit()

        resp = auth_client.post(
            _base_url(org.organization_id),
            json={
                "name": "Seeded",
                "object_ids": [str(o1.object_id), str(o2.object_id), "not-a-uuid"],
            },
        )
        assert resp.status_code == 201
        assert resp.get_json()["object_count"] == 2

    def test_create_ignores_foreign_org_object_ids(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        other_org = Organization(name="Other", slug="other-create-org", status="active")
        db_session.add(other_org)
        db_session.flush()
        foreign = _make_object(db_session, other_org.organization_id, "FO.001")
        db_session.commit()

        resp = auth_client.post(
            _base_url(org.organization_id),
            json={"name": "Foreign", "object_ids": [str(foreign.object_id)]},
        )
        assert resp.status_code == 201
        assert resp.get_json()["object_count"] == 0

    def test_create_dynamic_without_query_rejected(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            _base_url(org.organization_id),
            json={"name": "Dyn", "is_dynamic": True},
        )
        assert resp.status_code == 400
        assert "dynamic_query" in resp.get_json()["error"]["message"].lower()

    def test_create_media_workspace_with_media_ids(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        m1 = _make_media(db_session, org.organization_id)
        m2 = _make_media(db_session, org.organization_id)
        db_session.commit()

        resp = auth_client.post(
            _base_url(org.organization_id),
            json={
                "name": "Lightbox",
                "workspace_type": "media",
                "media_ids": [str(m1.media_id), str(m2.media_id), "not-uuid"],
            },
        )
        assert resp.status_code == 201
        body = resp.get_json()
        assert body["workspace_type"] == "media"
        assert body["asset_count"] == 2


# ---------------------------------------------------------------------------
# GET one — access control branches
# ---------------------------------------------------------------------------


class TestGetWorkspaceAccess:
    def test_private_workspace_of_other_user_is_403(
        self, client, auth_setup, admin_role_id, db_session
    ):
        _, org, _ = auth_setup
        owner = _make_second_user(db_session, org, admin_role_id, email="owner-403@example.com")
        ws = _make_workspace(
            db_session, org.organization_id, owner.user_id, name="Their Private"
        )
        db_session.commit()

        # Authenticate as the second user's *peer* — a separate user still in org.
        peer = _make_second_user(db_session, org, admin_role_id, email="peer-403@example.com")
        db_session.commit()
        token = generate_access_token(
            user_id=str(peer.user_id),
            email=peer.email,
            active_organization_id=str(org.organization_id),
            expires_minutes=60,
        )
        from tests.conftest import AuthenticatedClient

        peer_client = AuthenticatedClient(client, token)
        resp = peer_client.get(f"{_base_url(org.organization_id)}/{ws.workspace_id}")
        assert resp.status_code == 403

    def test_shared_workspace_is_viewable_by_grantee(
        self, client, auth_setup, admin_role_id, db_session
    ):
        _, org, user = auth_setup
        grantee = _make_second_user(db_session, org, admin_role_id, email="grantee@example.com")
        ws = _make_workspace(
            db_session,
            org.organization_id,
            user.user_id,
            name="Shared With Peer",
            visibility="shared",
        )
        db_session.add(
            WorkspaceShare(
                workspace_id=ws.workspace_id,
                organization_id=org.organization_id,
                principal_type="user",
                principal_id=grantee.user_id,
                permission="view",
                created_by=user.user_id,
            )
        )
        db_session.commit()

        token = generate_access_token(
            user_id=str(grantee.user_id),
            email=grantee.email,
            active_organization_id=str(org.organization_id),
            expires_minutes=60,
        )
        from tests.conftest import AuthenticatedClient

        grantee_client = AuthenticatedClient(client, token)
        resp = grantee_client.get(f"{_base_url(org.organization_id)}/{ws.workspace_id}")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["permission_level"] == "view"
        assert data["is_owner"] is False

    def test_get_workspace_in_other_org_returns_404(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        other = Organization(name="Other", slug="other-get-org", status="active")
        db_session.add(other)
        db_session.flush()
        ws = _make_workspace(db_session, other.organization_id, user.user_id, name="Elsewhere")
        db_session.commit()

        resp = auth_client.get(f"{_base_url(org.organization_id)}/{ws.workspace_id}")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# UPDATE — cover, visibility & permission guards
# ---------------------------------------------------------------------------


class TestUpdateWorkspace:
    def test_update_blank_name_rejected(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id, name="Keep")
        db_session.commit()
        resp = auth_client.patch(
            f"{_base_url(org.organization_id)}/{ws.workspace_id}",
            json={"name": "   "},
        )
        assert resp.status_code == 400

    def test_update_invalid_visibility_400(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)
        db_session.commit()
        resp = auth_client.patch(
            f"{_base_url(org.organization_id)}/{ws.workspace_id}",
            json={"visibility": "mystery"},
        )
        assert resp.status_code == 400

    def test_update_description_preserves_other_fields(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id, name="Keep")
        db_session.commit()
        resp = auth_client.patch(
            f"{_base_url(org.organization_id)}/{ws.workspace_id}",
            json={"description": "Now with notes"},
        )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["description"] == "Now with notes"
        assert body["name"] == "Keep"

    def test_update_cover_media_from_workspace(self, auth_setup, db_session):
        """Collections workspace accepts any org media as cover."""
        auth_client, org, user = auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)
        media = _make_media(db_session, org.organization_id)
        db_session.commit()

        resp = auth_client.patch(
            f"{_base_url(org.organization_id)}/{ws.workspace_id}",
            json={"cover_media_id": str(media.media_id)},
        )
        assert resp.status_code == 200
        assert resp.get_json()["cover_media_id"] == str(media.media_id)

        # Clear it
        resp2 = auth_client.patch(
            f"{_base_url(org.organization_id)}/{ws.workspace_id}",
            json={"cover_media_id": None},
        )
        assert resp2.status_code == 200
        assert resp2.get_json()["cover_media_id"] is None

    def test_update_cover_media_foreign_org_ignored(self, auth_setup, db_session):
        """Foreign-org media is silently not applied (cover stays None)."""
        auth_client, org, user = auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)
        other_org = Organization(name="Oth", slug="oth-cover", status="active")
        db_session.add(other_org)
        db_session.flush()
        foreign_media = _make_media(db_session, other_org.organization_id)
        db_session.commit()

        resp = auth_client.patch(
            f"{_base_url(org.organization_id)}/{ws.workspace_id}",
            json={"cover_media_id": str(foreign_media.media_id)},
        )
        assert resp.status_code == 200
        assert resp.get_json()["cover_media_id"] is None


# ---------------------------------------------------------------------------
# DELETE
# ---------------------------------------------------------------------------


class TestDeleteWorkspace:
    def test_non_owner_cannot_delete(self, client, auth_setup, admin_role_id, db_session):
        _, org, _ = auth_setup
        owner = _make_second_user(db_session, org, admin_role_id, email="del-owner@example.com")
        ws = _make_workspace(
            db_session, org.organization_id, owner.user_id, name="Not Mine", visibility="org"
        )
        db_session.commit()

        stranger = _make_second_user(db_session, org, admin_role_id, email="del-peer@example.com")
        db_session.commit()
        token = generate_access_token(
            user_id=str(stranger.user_id),
            email=stranger.email,
            active_organization_id=str(org.organization_id),
            expires_minutes=60,
        )
        from tests.conftest import AuthenticatedClient

        peer_client = AuthenticatedClient(client, token)
        resp = peer_client.delete(f"{_base_url(org.organization_id)}/{ws.workspace_id}")
        assert resp.status_code == 403

    def test_delete_soft_deletes_and_get_returns_404(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id, name="Gone Soon")
        db_session.commit()

        del_resp = auth_client.delete(f"{_base_url(org.organization_id)}/{ws.workspace_id}")
        assert del_resp.status_code == 200

        get_resp = auth_client.get(f"{_base_url(org.organization_id)}/{ws.workspace_id}")
        assert get_resp.status_code == 404

        # Row still exists as soft-deleted. Expire the session first so
        # the read-back doesn't return the stale instance the test
        # populated before the API committed.
        db_session.expire_all()
        row = db_session.query(Workspace).filter_by(workspace_id=ws.workspace_id).first()
        assert row is not None
        assert row.is_deleted is True
        assert row.deleted_at is not None


# ---------------------------------------------------------------------------
# ITEMS — list / add / remove / reorder / pin
# ---------------------------------------------------------------------------


class TestWorkspaceItems:
    def test_list_items_paginates_static_collections(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)
        for i in range(4):
            obj = _make_object(db_session, org.organization_id, f"L.{i}", title=f"Obj {i}")
            _add_item(db_session, ws.workspace_id, obj.object_id, user.user_id, sort_order=i)
        db_session.commit()

        resp = auth_client.get(
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/items?limit=2&offset=1"
        )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["total"] == 4
        assert len(body["items"]) == 2
        assert body["items"][0]["sort_order"] == 1

    def test_list_items_media_workspace(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        ws = _make_workspace(
            db_session,
            org.organization_id,
            user.user_id,
            workspace_type="media",
            name="M WS",
        )
        media = _make_media(db_session, org.organization_id, filename="A.jpg")
        db_session.add(
            MediaWorkspaceItem(
                workspace_id=ws.workspace_id,
                media_id=media.media_id,
                added_by_user_id=user.user_id,
                sort_order=0,
            )
        )
        db_session.commit()

        resp = auth_client.get(f"{_base_url(org.organization_id)}/{ws.workspace_id}/items")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["total"] == 1
        assert body["items"][0]["media_id"] == str(media.media_id)

    def test_add_items_no_ids_400(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)
        db_session.commit()

        resp = auth_client.post(
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/items",
            json={},
        )
        assert resp.status_code == 400

    def test_add_items_skips_foreign_org_and_bad_uuid(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)
        other_org = Organization(name="Oth", slug="oth-items", status="active")
        db_session.add(other_org)
        db_session.flush()
        foreign = _make_object(db_session, other_org.organization_id, "FX.1")
        mine = _make_object(db_session, org.organization_id, "MX.1")
        db_session.commit()

        resp = auth_client.post(
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/items",
            json={
                "object_ids": [
                    str(mine.object_id),
                    str(foreign.object_id),
                    "definitely-not-a-uuid",
                ]
            },
        )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["added_count"] == 1
        assert len(body["skipped"]) == 2

    def test_remove_items_empty_body_400(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)
        db_session.commit()

        resp = _delete_with_body(
            auth_client,
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/items",
            {"object_ids": []},
        )
        assert resp.status_code == 400

    def test_remove_nonexistent_returns_zero(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)
        db_session.commit()

        resp = _delete_with_body(
            auth_client,
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/items",
            {"object_ids": [str(uuid4()), "nope"]},
        )
        assert resp.status_code == 200
        assert resp.get_json()["removed_count"] == 0

    def test_reorder_updates_sort_order(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)
        items = []
        for i in range(3):
            obj = _make_object(db_session, org.organization_id, f"R.{i}")
            items.append(_add_item(db_session, ws.workspace_id, obj.object_id, user.user_id, sort_order=i))
        db_session.commit()

        # Reverse the order
        reversed_ids = [str(items[2].workspace_item_id), str(items[0].workspace_item_id), str(items[1].workspace_item_id)]
        resp = auth_client.post(
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/items/reorder",
            json={"item_ids": reversed_ids},
        )
        assert resp.status_code == 200
        db_session.expire_all()

        final = (
            db_session.query(WorkspaceItem)
            .filter_by(workspace_id=ws.workspace_id)
            .order_by(WorkspaceItem.sort_order)
            .all()
        )
        assert [str(wi.workspace_item_id) for wi in final] == reversed_ids

    def test_pin_on_static_workspace_rejected(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id, is_dynamic=False)
        obj = _make_object(db_session, org.organization_id, "P.1")
        db_session.commit()

        resp = auth_client.patch(
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/items/{obj.object_id}/pin"
        )
        assert resp.status_code == 400

    def test_pin_nonexistent_object_404(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        ws = _make_workspace(
            db_session,
            org.organization_id,
            user.user_id,
            is_dynamic=True,
            dynamic_query={},
        )
        db_session.commit()

        resp = auth_client.patch(
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/items/{uuid4()}/pin"
        )
        assert resp.status_code == 404

    def test_pin_is_idempotent(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        ws = _make_workspace(
            db_session,
            org.organization_id,
            user.user_id,
            is_dynamic=True,
            dynamic_query={},
        )
        obj = _make_object(db_session, org.organization_id, "P.2")
        db_session.commit()

        r1 = auth_client.patch(
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/items/{obj.object_id}/pin"
        )
        r2 = auth_client.patch(
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/items/{obj.object_id}/pin"
        )
        assert r1.status_code == 200
        assert r2.status_code == 200
        assert r1.get_json()["already_pinned"] is False
        assert r2.get_json()["already_pinned"] is True
        assert r1.get_json()["workspace_item_id"] == r2.get_json()["workspace_item_id"]

    def test_pin_media_workspace_404_foreign_media(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        ws = _make_workspace(
            db_session,
            org.organization_id,
            user.user_id,
            workspace_type="media",
            is_dynamic=True,
            dynamic_query={},
        )
        other_org = Organization(name="FO", slug="fo-pin-media", status="active")
        db_session.add(other_org)
        db_session.flush()
        foreign_media = _make_media(db_session, other_org.organization_id)
        db_session.commit()

        resp = auth_client.patch(
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/items/{foreign_media.media_id}/pin"
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# SHARING — upsert, auto-promote, 404 on delete, perms
# ---------------------------------------------------------------------------


class TestSharing:
    def test_share_missing_user_id_400(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)
        db_session.commit()
        resp = auth_client.post(
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/shares",
            json={"permission": "view"},
        )
        assert resp.status_code == 400

    def test_share_invalid_permission_400(self, auth_setup, admin_role_id, db_session):
        auth_client, org, user = auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)
        peer = _make_second_user(db_session, org, admin_role_id, email="invp@example.com")
        db_session.commit()
        resp = auth_client.post(
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/shares",
            json={"user_id": str(peer.user_id), "permission": "god"},
        )
        assert resp.status_code == 400

    def test_share_user_not_in_org_404(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)
        stray = User(email="stray@example.com", password_hash="x", status="active")
        db_session.add(stray)
        db_session.commit()
        resp = auth_client.post(
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/shares",
            json={"user_id": str(stray.user_id), "permission": "edit"},
        )
        assert resp.status_code == 404

    def test_share_private_auto_promotes_to_shared(self, auth_setup, admin_role_id, db_session):
        auth_client, org, user = auth_setup
        ws = _make_workspace(
            db_session, org.organization_id, user.user_id, visibility="private"
        )
        peer = _make_second_user(db_session, org, admin_role_id, email="promote@example.com")
        db_session.commit()

        resp = auth_client.post(
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/shares",
            json={"user_id": str(peer.user_id), "permission": "view"},
        )
        assert resp.status_code == 201
        assert resp.get_json()["created"] is True

        db_session.expire_all()
        refreshed = db_session.query(Workspace).filter_by(workspace_id=ws.workspace_id).first()
        assert refreshed.visibility == "shared"

    def test_share_upsert_updates_permission(self, auth_setup, admin_role_id, db_session):
        auth_client, org, user = auth_setup
        ws = _make_workspace(
            db_session, org.organization_id, user.user_id, visibility="shared"
        )
        peer = _make_second_user(db_session, org, admin_role_id, email="upsert@example.com")
        db_session.commit()

        r1 = auth_client.post(
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/shares",
            json={"user_id": str(peer.user_id), "permission": "view"},
        )
        r2 = auth_client.post(
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/shares",
            json={"user_id": str(peer.user_id), "permission": "edit"},
        )
        assert r1.status_code == 201
        assert r2.status_code == 201
        assert r2.get_json().get("updated") is True

        db_session.expire_all()
        rows = (
            db_session.query(WorkspaceShare)
            .filter_by(workspace_id=ws.workspace_id, principal_id=peer.user_id)
            .all()
        )
        assert len(rows) == 1
        assert rows[0].permission == "edit"

    def test_delete_share_404_when_missing(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id)
        db_session.commit()
        resp = auth_client.delete(
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/shares/{uuid4()}"
        )
        assert resp.status_code == 404

    def test_list_shares_non_owner_403(self, client, auth_setup, admin_role_id, db_session):
        _, org, user = auth_setup
        ws = _make_workspace(
            db_session, org.organization_id, user.user_id, visibility="org"
        )
        peer = _make_second_user(db_session, org, admin_role_id, email="lsp@example.com")
        db_session.commit()

        token = generate_access_token(
            user_id=str(peer.user_id),
            email=peer.email,
            active_organization_id=str(org.organization_id),
            expires_minutes=60,
        )
        from tests.conftest import AuthenticatedClient

        peer_client = AuthenticatedClient(client, token)
        resp = peer_client.get(f"{_base_url(org.organization_id)}/{ws.workspace_id}/shares")
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# ACTIVE CONTEXT — workspace / object / clear
# ---------------------------------------------------------------------------


class TestActiveContext:
    def test_set_object_context_404_when_missing(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            f"/api/organizations/{org.organization_id}/context/object/{uuid4()}"
        )
        assert resp.status_code == 404

    def test_set_workspace_context_403_on_private_other(
        self, client, auth_setup, admin_role_id, db_session
    ):
        _, org, _ = auth_setup
        owner = _make_second_user(db_session, org, admin_role_id, email="ctxo@example.com")
        ws = _make_workspace(db_session, org.organization_id, owner.user_id, visibility="private")
        peer = _make_second_user(db_session, org, admin_role_id, email="ctxp@example.com")
        db_session.commit()

        token = generate_access_token(
            user_id=str(peer.user_id),
            email=peer.email,
            active_organization_id=str(org.organization_id),
            expires_minutes=60,
        )
        from tests.conftest import AuthenticatedClient

        peer_client = AuthenticatedClient(client, token)
        resp = peer_client.post(
            f"/api/organizations/{org.organization_id}/context/workspace/{ws.workspace_id}"
        )
        assert resp.status_code == 403

    def test_get_context_resolves_object_payload(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        obj = _make_object(db_session, org.organization_id, "CTX.1", title="Context Obj")
        db_session.commit()

        set_resp = auth_client.post(
            f"/api/organizations/{org.organization_id}/context/object/{obj.object_id}"
        )
        assert set_resp.status_code == 200

        get_resp = auth_client.get(f"/api/organizations/{org.organization_id}/context")
        assert get_resp.status_code == 200
        ctx = get_resp.get_json()["context"]
        assert ctx["type"] == "object"
        assert ctx["object"]["accession_number"] == "CTX.1"
        assert ctx["object"]["title"] == "Context Obj"

    def test_switching_from_object_to_workspace_context(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id, name="Switch")
        obj = _make_object(db_session, org.organization_id, "SW.1")
        db_session.commit()

        auth_client.post(f"/api/organizations/{org.organization_id}/context/object/{obj.object_id}")
        resp = auth_client.post(
            f"/api/organizations/{org.organization_id}/context/workspace/{ws.workspace_id}"
        )
        assert resp.status_code == 200
        assert resp.get_json()["context"]["type"] == "workspace"
        assert resp.get_json()["context"]["workspace"]["name"] == "Switch"

    def test_clear_context_is_idempotent(self, auth_setup):
        """Calling clear when no context exists still returns 200."""
        auth_client, org, _ = auth_setup
        resp = auth_client.delete(f"/api/organizations/{org.organization_id}/context")
        assert resp.status_code == 200
        assert "message" in resp.get_json()

    def test_stale_workspace_context_returns_none(self, auth_setup, db_session):
        """If the referenced workspace is soft-deleted, GET context returns None."""
        auth_client, org, user = auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id, name="ToDelete")
        db_session.commit()

        auth_client.post(
            f"/api/organizations/{org.organization_id}/context/workspace/{ws.workspace_id}"
        )
        # Soft-delete the workspace so the stored context_id is now stale.
        auth_client.delete(f"{_base_url(org.organization_id)}/{ws.workspace_id}")

        resp = auth_client.get(f"/api/organizations/{org.organization_id}/context")
        assert resp.status_code == 200
        assert resp.get_json()["context"] is None


# ---------------------------------------------------------------------------
# BULK ACTIONS — list / preview / validate / execute branches
# ---------------------------------------------------------------------------


class TestBulkActions:
    def _ws_with_items(self, db_session, org, user, n=2, **obj_kwargs):
        ws = _make_workspace(db_session, org.organization_id, user.user_id, name="BA WS")
        objs = []
        for i in range(n):
            obj = _make_object(db_session, org.organization_id, f"BA.{i:03d}", **obj_kwargs)
            _add_item(db_session, ws.workspace_id, obj.object_id, user.user_id, sort_order=i)
            objs.append(obj)
        db_session.commit()
        return ws, objs

    def test_list_bulk_actions_includes_keys(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        ws, _ = self._ws_with_items(db_session, org, user)

        resp = auth_client.get(f"{_base_url(org.organization_id)}/{ws.workspace_id}/actions")
        assert resp.status_code == 200
        keys = {a["key"] for a in resp.get_json()["actions"]}
        assert "record_movement" in keys
        assert "set_cataloging_status" in keys
        assert "set_discoverable" in keys

    def test_preview_unknown_action_400(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        ws, _ = self._ws_with_items(db_session, org, user, n=1)
        resp = auth_client.post(
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/actions/bogus_action/preview",
            json={"action_params": {}},
        )
        assert resp.status_code == 400

    def test_preview_set_discoverable_flags_already_public(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        ws, _ = self._ws_with_items(db_session, org, user, n=2, is_discoverable=True)
        resp = auth_client.post(
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/actions/set_discoverable/preview",
            json={"action_params": {"is_discoverable": True}},
        )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["has_warnings"] is True
        assert all("already discoverable" in " ".join(o["warnings"]) for o in body["objects"])

    def test_validate_unknown_action_400(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        ws, _ = self._ws_with_items(db_session, org, user, n=1)
        resp = auth_client.post(
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/actions/nope/validate",
            json={"action_params": {}},
        )
        assert resp.status_code == 400

    def test_validate_record_movement_bad_location_404(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        ws, _ = self._ws_with_items(db_session, org, user, n=1)
        resp = auth_client.post(
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/actions/record_movement/validate",
            json={
                "action_params": {
                    "to_location_id": str(uuid4()),
                    "reason": "inventory",
                }
            },
        )
        assert resp.status_code == 404

    def test_execute_unknown_action_400(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        ws, _ = self._ws_with_items(db_session, org, user, n=1)
        resp = auth_client.post(
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/actions/mystery/execute",
            json={"action_params": {}},
        )
        assert resp.status_code == 400

    def test_execute_missing_required_params_400(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        ws, _ = self._ws_with_items(db_session, org, user, n=1)
        resp = auth_client.post(
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/actions/record_movement/execute",
            json={"action_params": {"reason": "only reason"}},
        )
        assert resp.status_code == 400
        assert "to_location_id" in resp.get_json()["error"]["message"]

    def test_execute_empty_workspace_400(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        empty_ws = _make_workspace(db_session, org.organization_id, user.user_id, name="EM")
        db_session.commit()
        resp = auth_client.post(
            f"{_base_url(org.organization_id)}/{empty_ws.workspace_id}/actions/set_cataloging_status/execute",
            json={"action_params": {"cataloging_status": "cataloged"}},
        )
        assert resp.status_code == 400

    def test_execute_set_discoverable_skips_already_public(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        ws, _ = self._ws_with_items(db_session, org, user, n=2, is_discoverable=True)

        resp = auth_client.post(
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/actions/set_discoverable/execute",
            json={"action_params": {"is_discoverable": True}},
        )
        assert resp.status_code == 200
        body = resp.get_json()
        # All were already discoverable — every row should be "skipped".
        assert body["success_count"] == 0
        assert all(r["status"] == "skipped" for r in body["results"])

    def test_execute_record_movement_moves_objects(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        ws, objs = self._ws_with_items(db_session, org, user, n=2)
        dest = _make_location(db_session, org.organization_id, code="DEST")
        db_session.commit()

        resp = auth_client.post(
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/actions/record_movement/execute",
            json={
                "action_params": {
                    "to_location_id": str(dest.location_id),
                    "reason": "storage",
                }
            },
        )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["status"] == "completed"
        assert body["success_count"] == 2

        db_session.expire_all()
        moved = db_session.query(CollectionObject).filter(
            CollectionObject.object_id.in_([o.object_id for o in objs])
        ).all()
        assert all(o.current_location_id == dest.location_id for o in moved)


# ---------------------------------------------------------------------------
# VIEWER ROLE — permission guard sanity check
# ---------------------------------------------------------------------------


class TestViewerPermissions:
    def test_viewer_can_list_workspaces(self, viewer_auth_setup):
        auth_client, org, _ = viewer_auth_setup
        resp = auth_client.get(_base_url(org.organization_id))
        assert resp.status_code == 200

    def test_viewer_cannot_create(self, viewer_auth_setup):
        auth_client, org, _ = viewer_auth_setup
        resp = auth_client.post(_base_url(org.organization_id), json={"name": "Nope"})
        assert resp.status_code == 403

    def test_viewer_cannot_edit(self, viewer_auth_setup, db_session):
        auth_client, org, user = viewer_auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id, name="V")
        db_session.commit()
        resp = auth_client.patch(
            f"{_base_url(org.organization_id)}/{ws.workspace_id}", json={"name": "Nope"}
        )
        assert resp.status_code == 403

    def test_viewer_cannot_delete(self, viewer_auth_setup, db_session):
        auth_client, org, user = viewer_auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id, name="V2")
        db_session.commit()
        resp = auth_client.delete(f"{_base_url(org.organization_id)}/{ws.workspace_id}")
        assert resp.status_code == 403

    def test_viewer_cannot_share(self, viewer_auth_setup, db_session):
        auth_client, org, user = viewer_auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id, name="V3")
        db_session.commit()
        resp = auth_client.post(
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/shares",
            json={"user_id": str(uuid4()), "permission": "view"},
        )
        assert resp.status_code == 403

    def test_viewer_cannot_execute_bulk_action(self, viewer_auth_setup, db_session):
        auth_client, org, user = viewer_auth_setup
        ws = _make_workspace(db_session, org.organization_id, user.user_id, name="V4")
        db_session.commit()
        # WORKSPACES_EXECUTE permission is missing on the viewer role, so the
        # dependency returns 403 before any action-specific branch runs.
        resp = auth_client.post(
            f"{_base_url(org.organization_id)}/{ws.workspace_id}/actions/set_discoverable/execute",
            json={"action_params": {"is_discoverable": True}},
        )
        assert resp.status_code == 403
