"""
Coverage-driving tests for ``app/fastapi_app/routers/media_collections.py``.

The router ships 23 endpoints covering DAM lightbox collections, public
share tokens, consent clearance, metadata templates, and an owner-scoped
"my shares" index. The existing test suite only exercises the router
incidentally (~15% line coverage); this file fills the gap with direct
HTTP tests against the real routes.

Key patterns used here:

* ``auth_setup`` — admin with ``media.view|edit|delete`` (but not
  ``media.admin`` — the ``set-default`` template route is exercised with
  an extended-permission fixture below).
* ``viewer_auth_setup`` — viewer-only; used to confirm edit routes return
  403 when the caller lacks ``media.edit``.
* Public routes under ``/public/collections/...`` are hit with the bare
  ``client`` fixture (no Authorization header).

Media rows are inserted without ``thumbnail_s3_key``/``s3_key`` coverage
URLs, so the serializer's S3 helpers short-circuit to ``None`` and no
network/STS call is made.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from app.models import (
    Media,
    MediaCollection,
    MediaCollectionItem,
    MediaCollectionShare,
    MediaCollectionShareAccess,
    MediaConsent,
    MetadataTemplate,
    Organization,
    Permission as PermissionModel,
    RolePermission,
    OrganizationMembership,
    Role,
    User,
)
from app.services.auth_utils import hash_password


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _base(org_id) -> str:
    return f"/api/organizations/{org_id}/media-collections"


def _templates_base(org_id) -> str:
    return f"/api/organizations/{org_id}/media/metadata-templates"


def _ensure_user(db_session, user_id) -> User:
    """Idempotent: return the existing user, or create a stub row.

    Many tests pass ``uuid4()`` as a 'stranger' owner for collection
    visibility tests. The schema's FK on ``media_collections.created_by``
    requires a real users row, so we materialise one when needed."""
    if user_id is None:
        return None
    user = db_session.query(User).filter(User.user_id == user_id).first()
    if user is not None:
        return user
    user = User(
        user_id=user_id,
        email=f"stranger-{user_id.hex[:8] if hasattr(user_id, 'hex') else str(user_id)[:8]}@example.com",
        password_hash="not_used_in_tests",
        status="active",
    )
    db_session.add(user)
    db_session.flush()
    return user


def _ensure_org(db_session, org_id) -> Organization:
    """Idempotent: return the existing org, or create a stub row.

    Tests that exercise the wrong-org 404 path pass ``uuid4()`` as the
    organization_id of an unrelated collection. The FK on
    ``media_collections.organization_id`` requires the row to exist."""
    if org_id is None:
        return None
    org = db_session.query(Organization).filter(Organization.organization_id == org_id).first()
    if org is not None:
        return org
    slug = f"stub-{org_id.hex[:8] if hasattr(org_id, 'hex') else str(org_id)[:8]}"
    org = Organization(
        organization_id=org_id,
        name=f"Stub Org {slug}",
        slug=slug,
        status="active",
    )
    db_session.add(org)
    db_session.flush()
    return org


def _make_media(db_session, org_id, *, filename: str = "example.jpg") -> Media:
    """Insert a Media row. No s3 key for the thumbnail so the serializer's
    pre-signed-URL helpers return None (no AWS call in tests)."""
    media = Media(
        organization_id=org_id,
        s3_key=f"orgs/{org_id}/media/images/{uuid4().hex}.jpg",
        filename=filename,
        file_size=2048,
        mime_type="image/jpeg",
        media_type="image",
        processing_status="completed",
    )
    db_session.add(media)
    db_session.commit()
    return media


def _make_collection(
    db_session,
    org_id,
    owner_id,
    *,
    name: str | None = None,
    visibility: str = "private",
    consent_clearance_required: bool = True,
    consent_cleared_at: datetime | None = None,
) -> MediaCollection:
    _ensure_org(db_session, org_id)
    _ensure_user(db_session, owner_id)
    coll = MediaCollection(
        organization_id=org_id,
        name=name or f"Collection {uuid4().hex[:6]}",
        description="A test collection",
        visibility=visibility,
        consent_clearance_required=consent_clearance_required,
        consent_cleared_at=consent_cleared_at,
        created_by=owner_id,
    )
    db_session.add(coll)
    db_session.commit()
    return coll


def _make_public_share(
    db_session,
    org_id,
    owner_id,
    *,
    download_level: str = "none",
    password_hash: str | None = None,
    expires_at: datetime | None = None,
    enabled: bool = True,
    token: str | None = None,
) -> MediaCollection:
    coll = _make_collection(
        db_session,
        org_id,
        owner_id,
        visibility="public",
        consent_cleared_at=datetime.now(timezone.utc),
    )
    coll.public_share_token = token or uuid4().hex
    coll.public_share_enabled = enabled
    coll.public_share_download_level = download_level
    coll.public_share_password_hash = password_hash
    coll.public_share_expires_at = expires_at
    db_session.commit()
    return coll


def _add_consent(db_session, org_id, media_id, *, scope: str = "public", expired: bool = False):
    expiry = None
    if expired:
        expiry = (datetime.now(timezone.utc) - timedelta(days=1)).date()
    consent = MediaConsent(
        media_id=media_id,
        organization_id=org_id,
        subject_name="Jane Doe",
        consent_type="photo_release",
        consent_scope=scope,
        is_valid=True,
        expiry_date=expiry,
    )
    db_session.add(consent)
    db_session.commit()
    return consent


def _grant_permission(db_session, role_id, key: str) -> None:
    """Idempotently add a permission key and link it to the role."""
    perm = db_session.query(PermissionModel).filter_by(permission_key=key).first()
    if perm is None:
        scope, action = key.rsplit(".", 1)
        perm = PermissionModel(
            permission_key=key,
            scope=scope,
            action=action,
            display_name=key.replace(".", " ").title(),
            description=f"Permission for {key}",
        )
        db_session.add(perm)
        db_session.flush()
    linked = (
        db_session.query(RolePermission)
        .filter_by(role_id=role_id, permission_id=perm.permission_id)
        .first()
    )
    if linked is None:
        db_session.add(RolePermission(role_id=role_id, permission_id=perm.permission_id))
        db_session.flush()
    db_session.commit()


@pytest.fixture
def admin_with_media_admin(auth_setup, db_session):
    """``auth_setup`` extended with ``media.admin`` so the set-default route is
    reachable (auth_setup's admin role omits ``media.admin`` by default)."""
    auth_client, org, user = auth_setup
    membership = (
        db_session.query(OrganizationMembership)
        .filter_by(organization_id=org.organization_id, user_id=user.user_id)
        .first()
    )
    assert membership is not None
    _grant_permission(db_session, membership.role_id, "media.admin")
    return auth_client, org, user


# ---------------------------------------------------------------------------
# Collection CRUD
# ---------------------------------------------------------------------------


class TestListCollections:
    def test_empty(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(_base(org.organization_id))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data == {"items": [], "total": 0, "limit": 50, "offset": 0}

    def test_returns_owned_and_org_visible(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        own = _make_collection(db_session, org.organization_id, user.user_id, name="Own")
        # Org-visibility collection owned by a different user should still appear.
        other_user_id = uuid4()
        _make_collection(
            db_session,
            org.organization_id,
            other_user_id,
            name="Org-wide",
            visibility="org",
        )
        resp = auth_client.get(_base(org.organization_id))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 2
        names = {c["name"] for c in data["items"]}
        assert names == {"Own", "Org-wide"}
        # Owned collection carries its expected shape.
        own_row = next(c for c in data["items"] if c["collection_id"] == str(own.collection_id))
        assert own_row["visibility"] == "private"
        assert own_row["public_share_enabled"] is False
        assert own_row["public_share_has_password"] is False

    def test_hides_other_users_private_collection(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _make_collection(db_session, org.organization_id, uuid4(), name="Stranger private")
        resp = auth_client.get(_base(org.organization_id))
        assert resp.status_code == 200
        assert resp.get_json()["total"] == 0

    def test_visibility_filter_and_pagination(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        for i in range(3):
            _make_collection(db_session, org.organization_id, user.user_id, name=f"P{i}")
        _make_collection(
            db_session,
            org.organization_id,
            user.user_id,
            name="Org visible",
            visibility="org",
        )

        resp = auth_client.get(
            _base(org.organization_id),
            params={"visibility": "org"},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1
        assert data["items"][0]["name"] == "Org visible"

        # Pagination: limit 2, offset 1 out of 4 accessible rows.
        resp2 = auth_client.get(
            _base(org.organization_id),
            params={"limit": 2, "offset": 1},
        )
        assert resp2.status_code == 200
        body = resp2.get_json()
        assert body["limit"] == 2
        assert body["offset"] == 1
        assert len(body["items"]) == 2


class TestCreateCollection:
    def test_happy_path(self, auth_setup):
        auth_client, org, user = auth_setup
        resp = auth_client.post(
            _base(org.organization_id),
            json={"name": "My Lightbox", "description": "desc"},
        )
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["name"] == "My Lightbox"
        assert data["description"] == "desc"
        assert data["visibility"] == "private"
        assert data["consent_clearance_required"] is True
        assert data["created_by"] == str(user.user_id)
        assert data["organization_id"] == str(org.organization_id)

    def test_rejects_missing_name(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(_base(org.organization_id), json={"description": "nope"})
        assert resp.status_code == 400

    def test_rejects_empty_name(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(_base(org.organization_id), json={"name": ""})
        assert resp.status_code == 400

    def test_viewer_cannot_create(self, viewer_auth_setup):
        auth_client, org, _ = viewer_auth_setup
        resp = auth_client.post(_base(org.organization_id), json={"name": "Nope"})
        assert resp.status_code == 403


class TestGetCollection:
    def test_owner_sees_collection(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        coll = _make_collection(db_session, org.organization_id, user.user_id)
        resp = auth_client.get(f"{_base(org.organization_id)}/{coll.collection_id}")
        assert resp.status_code == 200
        assert resp.get_json()["collection_id"] == str(coll.collection_id)

    def test_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(f"{_base(org.organization_id)}/{uuid4()}")
        assert resp.status_code == 404

    def test_wrong_org_404(self, auth_setup, db_session):
        auth_client, _, user = auth_setup
        # A collection in a different (fake) org should not leak through.
        other_org_id = uuid4()
        coll = _make_collection(db_session, other_org_id, user.user_id)
        # Route scoped to the caller's org so this should 404.
        auth_client_org = auth_setup[1].organization_id
        resp = auth_client.get(f"/api/organizations/{auth_client_org}/media-collections/{coll.collection_id}")
        assert resp.status_code == 404

    def test_stranger_private_is_403(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        stranger_coll = _make_collection(db_session, org.organization_id, uuid4())
        resp = auth_client.get(f"{_base(org.organization_id)}/{stranger_coll.collection_id}")
        assert resp.status_code == 403

    def test_shared_viewer_can_access(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        owner_id = uuid4()
        coll = _make_collection(db_session, org.organization_id, owner_id)
        db_session.add(
            MediaCollectionShare(
                collection_id=coll.collection_id,
                user_id=user.user_id,
                role="viewer",
            )
        )
        db_session.commit()
        resp = auth_client.get(f"{_base(org.organization_id)}/{coll.collection_id}")
        assert resp.status_code == 200


class TestUpdateCollection:
    def test_owner_patch_fields(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        coll = _make_collection(db_session, org.organization_id, user.user_id)
        resp = auth_client.patch(
            f"{_base(org.organization_id)}/{coll.collection_id}",
            json={
                "name": "Renamed",
                "description": "new desc",
                "visibility": "org",
                "consent_clearance_required": False,
            },
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["name"] == "Renamed"
        assert data["description"] == "new desc"
        assert data["visibility"] == "org"
        assert data["consent_clearance_required"] is False

    def test_patch_sets_cover_media_id(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        coll = _make_collection(db_session, org.organization_id, user.user_id)
        media = _make_media(db_session, org.organization_id)
        resp = auth_client.patch(
            f"{_base(org.organization_id)}/{coll.collection_id}",
            json={"cover_media_id": str(media.media_id)},
        )
        assert resp.status_code == 200
        assert resp.get_json()["cover_media_id"] == str(media.media_id)

        # Clearing the cover via null round-trips.
        resp_clear = auth_client.patch(
            f"{_base(org.organization_id)}/{coll.collection_id}",
            json={"cover_media_id": None},
        )
        assert resp_clear.status_code == 200
        assert resp_clear.get_json()["cover_media_id"] is None

    def test_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.patch(
            f"{_base(org.organization_id)}/{uuid4()}",
            json={"name": "x"},
        )
        assert resp.status_code == 404

    def test_viewer_share_cannot_edit(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        owner_id = uuid4()
        coll = _make_collection(db_session, org.organization_id, owner_id)
        db_session.add(
            MediaCollectionShare(
                collection_id=coll.collection_id,
                user_id=user.user_id,
                role="viewer",
            )
        )
        db_session.commit()
        # Shared as viewer — not editor — so PATCH returns 403.
        resp = auth_client.patch(
            f"{_base(org.organization_id)}/{coll.collection_id}",
            json={"name": "Attempted rename"},
        )
        assert resp.status_code == 403

    def test_editor_share_can_edit(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        owner_id = uuid4()
        coll = _make_collection(db_session, org.organization_id, owner_id)
        db_session.add(
            MediaCollectionShare(
                collection_id=coll.collection_id,
                user_id=user.user_id,
                role="editor",
            )
        )
        db_session.commit()
        resp = auth_client.patch(
            f"{_base(org.organization_id)}/{coll.collection_id}",
            json={"name": "Editor rename"},
        )
        assert resp.status_code == 200
        assert resp.get_json()["name"] == "Editor rename"


class TestDeleteCollection:
    def test_owner_can_delete(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        coll = _make_collection(db_session, org.organization_id, user.user_id)
        resp = auth_client.delete(f"{_base(org.organization_id)}/{coll.collection_id}")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["success"] is True
        assert body["collection_id"] == str(coll.collection_id)
        # Subsequent GET is 404.
        after = auth_client.get(f"{_base(org.organization_id)}/{coll.collection_id}")
        assert after.status_code == 404

    def test_non_owner_cannot_delete(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        stranger_coll = _make_collection(
            db_session, org.organization_id, uuid4(), visibility="org"
        )
        resp = auth_client.delete(
            f"{_base(org.organization_id)}/{stranger_coll.collection_id}"
        )
        assert resp.status_code == 403

    def test_delete_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.delete(f"{_base(org.organization_id)}/{uuid4()}")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Collection items
# ---------------------------------------------------------------------------


class TestCollectionItems:
    def test_list_items_empty(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        coll = _make_collection(db_session, org.organization_id, user.user_id)
        resp = auth_client.get(f"{_base(org.organization_id)}/{coll.collection_id}/items")
        assert resp.status_code == 200
        assert resp.get_json() == {"items": [], "total": 0}

    def test_add_item_happy(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        coll = _make_collection(db_session, org.organization_id, user.user_id)
        media = _make_media(db_session, org.organization_id)

        resp = auth_client.post(
            f"{_base(org.organization_id)}/{coll.collection_id}/items",
            json={"media_id": str(media.media_id), "notes": "first"},
        )
        assert resp.status_code == 201
        body = resp.get_json()
        assert body["media_id"] == str(media.media_id)
        assert body["sort_order"] == 1

        # item_count + cover_media_id auto-update on the collection.
        coll_resp = auth_client.get(f"{_base(org.organization_id)}/{coll.collection_id}")
        coll_data = coll_resp.get_json()
        assert coll_data["item_count"] == 1
        assert coll_data["cover_media_id"] == str(media.media_id)

    def test_add_item_missing_media_id(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        coll = _make_collection(db_session, org.organization_id, user.user_id)
        resp = auth_client.post(
            f"{_base(org.organization_id)}/{coll.collection_id}/items",
            json={},
        )
        assert resp.status_code == 400

    def test_add_item_media_not_found(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        coll = _make_collection(db_session, org.organization_id, user.user_id)
        resp = auth_client.post(
            f"{_base(org.organization_id)}/{coll.collection_id}/items",
            json={"media_id": str(uuid4())},
        )
        assert resp.status_code == 404

    def test_add_item_duplicate_rejected(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        coll = _make_collection(db_session, org.organization_id, user.user_id)
        media = _make_media(db_session, org.organization_id)

        first = auth_client.post(
            f"{_base(org.organization_id)}/{coll.collection_id}/items",
            json={"media_id": str(media.media_id)},
        )
        assert first.status_code == 201

        second = auth_client.post(
            f"{_base(org.organization_id)}/{coll.collection_id}/items",
            json={"media_id": str(media.media_id)},
        )
        assert second.status_code == 400

    def test_add_item_collection_404(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        media = _make_media(db_session, org.organization_id)
        resp = auth_client.post(
            f"{_base(org.organization_id)}/{uuid4()}/items",
            json={"media_id": str(media.media_id)},
        )
        assert resp.status_code == 404

    def test_remove_item(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        coll = _make_collection(db_session, org.organization_id, user.user_id)
        media1 = _make_media(db_session, org.organization_id)
        media2 = _make_media(db_session, org.organization_id)

        for m in (media1, media2):
            r = auth_client.post(
                f"{_base(org.organization_id)}/{coll.collection_id}/items",
                json={"media_id": str(m.media_id)},
            )
            assert r.status_code == 201

        # Remove media1 (the current cover) — cover should fall through to media2.
        resp = auth_client.delete(
            f"{_base(org.organization_id)}/{coll.collection_id}/items/{media1.media_id}"
        )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["success"] is True
        assert body["media_id"] == str(media1.media_id)

        coll_body = auth_client.get(
            f"{_base(org.organization_id)}/{coll.collection_id}"
        ).get_json()
        assert coll_body["item_count"] == 1
        assert coll_body["cover_media_id"] == str(media2.media_id)

    def test_remove_item_not_found(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        coll = _make_collection(db_session, org.organization_id, user.user_id)
        resp = auth_client.delete(
            f"{_base(org.organization_id)}/{coll.collection_id}/items/{uuid4()}"
        )
        assert resp.status_code == 404

    def test_reorder_items(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        coll = _make_collection(db_session, org.organization_id, user.user_id)
        m1 = _make_media(db_session, org.organization_id)
        m2 = _make_media(db_session, org.organization_id)

        for m in (m1, m2):
            auth_client.post(
                f"{_base(org.organization_id)}/{coll.collection_id}/items",
                json={"media_id": str(m.media_id)},
            )

        resp = auth_client.patch(
            f"{_base(org.organization_id)}/{coll.collection_id}/items/reorder",
            json={
                "items": [
                    {"media_id": str(m2.media_id), "sort_order": 1},
                    {"media_id": str(m1.media_id), "sort_order": 2},
                ]
            },
        )
        assert resp.status_code == 200
        assert resp.get_json() == {"success": True}

        items = auth_client.get(
            f"{_base(org.organization_id)}/{coll.collection_id}/items"
        ).get_json()["items"]
        ordered_media_ids = [i["media_id"] for i in items]
        assert ordered_media_ids == [str(m2.media_id), str(m1.media_id)]


# ---------------------------------------------------------------------------
# Shares (user-level)
# ---------------------------------------------------------------------------


class TestShares:
    def test_list_requires_owner(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        stranger_coll = _make_collection(db_session, org.organization_id, uuid4())
        resp = auth_client.get(
            f"{_base(org.organization_id)}/{stranger_coll.collection_id}/shares"
        )
        assert resp.status_code == 403

    def test_list_owner_empty(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        coll = _make_collection(db_session, org.organization_id, user.user_id)
        resp = auth_client.get(
            f"{_base(org.organization_id)}/{coll.collection_id}/shares"
        )
        assert resp.status_code == 200
        assert resp.get_json() == {"shares": [], "total": 0}

    def test_share_with_user_creates_then_updates(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        coll = _make_collection(db_session, org.organization_id, user.user_id)
        target_user_id = uuid4()
        _ensure_user(db_session, target_user_id)
        db_session.commit()

        resp = auth_client.post(
            f"{_base(org.organization_id)}/{coll.collection_id}/shares",
            json={"user_id": str(target_user_id), "role": "viewer"},
        )
        assert resp.status_code == 201
        body = resp.get_json()
        assert body["role"] == "viewer"
        assert body["user_id"] == str(target_user_id)
        assert body["principal_type"] == "user"

        # Re-sharing the same user returns the existing row with the new role.
        resp2 = auth_client.post(
            f"{_base(org.organization_id)}/{coll.collection_id}/shares",
            json={"user_id": str(target_user_id), "role": "editor"},
        )
        assert resp2.status_code == 200
        assert resp2.get_json()["role"] == "editor"

        listing = auth_client.get(
            f"{_base(org.organization_id)}/{coll.collection_id}/shares"
        ).get_json()
        assert listing["total"] == 1
        assert listing["shares"][0]["role"] == "editor"

    def test_share_rejects_bad_role(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        coll = _make_collection(db_session, org.organization_id, user.user_id)
        resp = auth_client.post(
            f"{_base(org.organization_id)}/{coll.collection_id}/shares",
            json={"user_id": str(uuid4()), "role": "owner"},
        )
        assert resp.status_code == 400

    def test_share_missing_principal(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        coll = _make_collection(db_session, org.organization_id, user.user_id)
        resp = auth_client.post(
            f"{_base(org.organization_id)}/{coll.collection_id}/shares",
            json={"role": "viewer"},
        )
        assert resp.status_code == 400

    def test_share_bad_principal_type(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        coll = _make_collection(db_session, org.organization_id, user.user_id)
        resp = auth_client.post(
            f"{_base(org.organization_id)}/{coll.collection_id}/shares",
            json={
                "principal_type": "team",
                "principal_id": str(uuid4()),
                "role": "viewer",
            },
        )
        assert resp.status_code == 400

    def test_remove_share(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        coll = _make_collection(db_session, org.organization_id, user.user_id)
        target_user_id = uuid4()
        _ensure_user(db_session, target_user_id)
        share = MediaCollectionShare(
            collection_id=coll.collection_id,
            user_id=target_user_id,
            role="viewer",
        )
        db_session.add(share)
        db_session.commit()

        resp = auth_client.delete(
            f"{_base(org.organization_id)}/{coll.collection_id}/shares/{share.share_id}"
        )
        assert resp.status_code == 200
        assert resp.get_json()["success"] is True

    def test_remove_share_not_found(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        coll = _make_collection(db_session, org.organization_id, user.user_id)
        resp = auth_client.delete(
            f"{_base(org.organization_id)}/{coll.collection_id}/shares/{uuid4()}"
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Public sharing (owner side)
# ---------------------------------------------------------------------------


class TestPublicSharingOwner:
    def test_enable_requires_consent_cleared(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        coll = _make_collection(
            db_session,
            org.organization_id,
            user.user_id,
            consent_clearance_required=True,
        )
        resp = auth_client.post(
            f"{_base(org.organization_id)}/{coll.collection_id}/enable-public",
            json={},
        )
        assert resp.status_code == 400

    def test_enable_public_happy(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        coll = _make_collection(
            db_session,
            org.organization_id,
            user.user_id,
            consent_clearance_required=False,
        )
        resp = auth_client.post(
            f"{_base(org.organization_id)}/{coll.collection_id}/enable-public",
            json={"download_level": "derivatives", "password": "hunter2"},
        )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["public_share_token"]
        assert body["public_url"].startswith("/public/collections/")

        coll_body = auth_client.get(
            f"{_base(org.organization_id)}/{coll.collection_id}"
        ).get_json()
        assert coll_body["public_share_enabled"] is True
        assert coll_body["visibility"] == "public"
        assert coll_body["public_share_download_level"] == "derivatives"
        assert coll_body["public_share_has_password"] is True

    def test_enable_public_rejects_bad_expires(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        coll = _make_collection(
            db_session,
            org.organization_id,
            user.user_id,
            consent_clearance_required=False,
        )
        resp = auth_client.post(
            f"{_base(org.organization_id)}/{coll.collection_id}/enable-public",
            json={"expires_at": "not-a-date"},
        )
        assert resp.status_code == 400

    def test_enable_public_rejects_bad_download_level(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        coll = _make_collection(
            db_session,
            org.organization_id,
            user.user_id,
            consent_clearance_required=False,
        )
        resp = auth_client.post(
            f"{_base(org.organization_id)}/{coll.collection_id}/enable-public",
            json={"download_level": "everything"},
        )
        assert resp.status_code == 400

    def test_update_settings_roundtrip(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        coll = _make_public_share(db_session, org.organization_id, user.user_id)
        expires = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
        resp = auth_client.put(
            f"{_base(org.organization_id)}/{coll.collection_id}/public-share/settings",
            json={
                "expires_at": expires,
                "download_level": "originals",
                "password": "opensesame",
            },
        )
        assert resp.status_code == 200

        coll_body = auth_client.get(
            f"{_base(org.organization_id)}/{coll.collection_id}"
        ).get_json()
        assert coll_body["public_share_download_level"] == "originals"
        assert coll_body["public_share_has_password"] is True
        assert coll_body["public_share_expires_at"] is not None

    def test_update_settings_clear_password(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        coll = _make_public_share(
            db_session,
            org.organization_id,
            user.user_id,
            password_hash=hash_password("oldpw"),
        )
        resp = auth_client.put(
            f"{_base(org.organization_id)}/{coll.collection_id}/public-share/settings",
            json={"password": None, "expires_at": None},
        )
        assert resp.status_code == 200
        coll_body = auth_client.get(
            f"{_base(org.organization_id)}/{coll.collection_id}"
        ).get_json()
        assert coll_body["public_share_has_password"] is False
        assert coll_body["public_share_expires_at"] is None

    def test_rotate_token(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        coll = _make_public_share(db_session, org.organization_id, user.user_id)
        old_token = coll.public_share_token
        resp = auth_client.post(
            f"{_base(org.organization_id)}/{coll.collection_id}/public-share/rotate"
        )
        assert resp.status_code == 200
        new_token = resp.get_json()["public_share_token"]
        assert new_token
        assert new_token != old_token

    def test_disable_public(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        coll = _make_public_share(db_session, org.organization_id, user.user_id)
        resp = auth_client.delete(
            f"{_base(org.organization_id)}/{coll.collection_id}/disable-public"
        )
        assert resp.status_code == 200
        coll_body = auth_client.get(
            f"{_base(org.organization_id)}/{coll.collection_id}"
        ).get_json()
        assert coll_body["public_share_enabled"] is False
        assert coll_body["public_share_token"] is None
        assert coll_body["public_share_download_level"] == "none"
        assert coll_body["visibility"] == "private"

    def test_non_owner_cannot_touch_public(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        stranger_coll = _make_public_share(db_session, org.organization_id, uuid4())
        resp = auth_client.post(
            f"{_base(org.organization_id)}/{stranger_coll.collection_id}/public-share/rotate"
        )
        assert resp.status_code == 403

    def test_access_log_owner_only(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        coll = _make_public_share(db_session, org.organization_id, user.user_id)
        # Seed two access rows.
        for action in ("view", "download"):
            db_session.add(
                MediaCollectionShareAccess(
                    collection_id=coll.collection_id,
                    action=action,
                )
            )
        db_session.commit()
        resp = auth_client.get(
            f"{_base(org.organization_id)}/{coll.collection_id}/public-share/access-log"
        )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["total"] == 2
        assert {e["action"] for e in body["entries"]} == {"view", "download"}

    def test_access_log_403_for_non_owner(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        stranger_coll = _make_public_share(db_session, org.organization_id, uuid4())
        resp = auth_client.get(
            f"{_base(org.organization_id)}/{stranger_coll.collection_id}"
            f"/public-share/access-log"
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Public endpoints (no auth)
# ---------------------------------------------------------------------------


class TestPublicEndpoints:
    def test_get_public_collection_ok(self, client, auth_setup, db_session):
        _, org, user = auth_setup
        coll = _make_public_share(db_session, org.organization_id, user.user_id)
        media = _make_media(db_session, org.organization_id)
        db_session.add(
            MediaCollectionItem(
                collection_id=coll.collection_id,
                media_id=media.media_id,
                sort_order=1,
            )
        )
        db_session.commit()

        resp = client.get(f"/public/collections/{coll.public_share_token}")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["collection"]["collection_id"] == str(coll.collection_id)
        assert len(body["items"]) == 1
        assert body["items"][0]["media_id"] == str(media.media_id)

    def test_unknown_token_is_404(self, client):
        resp = client.get(f"/public/collections/{uuid4().hex}")
        assert resp.status_code == 404

    def test_disabled_share_is_404(self, client, auth_setup, db_session):
        _, org, user = auth_setup
        coll = _make_public_share(
            db_session, org.organization_id, user.user_id, enabled=False
        )
        resp = client.get(f"/public/collections/{coll.public_share_token}")
        assert resp.status_code == 404

    def test_expired_share_is_410(self, client, auth_setup, db_session):
        _, org, user = auth_setup
        coll = _make_public_share(
            db_session,
            org.organization_id,
            user.user_id,
            expires_at=datetime.now(timezone.utc) - timedelta(hours=1),
        )
        resp = client.get(f"/public/collections/{coll.public_share_token}")
        assert resp.status_code == 410

    def test_password_challenge(self, client, auth_setup, db_session):
        _, org, user = auth_setup
        coll = _make_public_share(
            db_session,
            org.organization_id,
            user.user_id,
            password_hash=hash_password("letmein"),
        )
        # No password → 401.
        resp = client.get(f"/public/collections/{coll.public_share_token}")
        assert resp.status_code == 401

        # Wrong password → 401.
        wrong = client.get(
            f"/public/collections/{coll.public_share_token}",
            headers={"X-Share-Password": "nope"},
        )
        assert wrong.status_code == 401

        # Correct password → 200.
        ok = client.get(
            f"/public/collections/{coll.public_share_token}",
            headers={"X-Share-Password": "letmein"},
        )
        assert ok.status_code == 200

    def test_public_download_none_blocked(self, client, auth_setup, db_session):
        _, org, user = auth_setup
        coll = _make_public_share(
            db_session,
            org.organization_id,
            user.user_id,
            download_level="none",
        )
        media = _make_media(db_session, org.organization_id)
        db_session.add(
            MediaCollectionItem(
                collection_id=coll.collection_id,
                media_id=media.media_id,
                sort_order=1,
            )
        )
        db_session.commit()
        resp = client.get(
            f"/public/collections/{coll.public_share_token}/media/{media.media_id}/download"
        )
        assert resp.status_code == 403

    def test_public_download_derivatives_blocks_original(self, client, auth_setup, db_session):
        _, org, user = auth_setup
        coll = _make_public_share(
            db_session,
            org.organization_id,
            user.user_id,
            download_level="derivatives",
        )
        media = _make_media(db_session, org.organization_id)
        db_session.add(
            MediaCollectionItem(
                collection_id=coll.collection_id,
                media_id=media.media_id,
                sort_order=1,
            )
        )
        db_session.commit()
        resp = client.get(
            f"/public/collections/{coll.public_share_token}/media/{media.media_id}/download",
            params={"variant": "original"},
        )
        assert resp.status_code == 403

    def test_public_download_item_not_in_collection(self, client, auth_setup, db_session):
        _, org, user = auth_setup
        coll = _make_public_share(
            db_session,
            org.organization_id,
            user.user_id,
            download_level="originals",
        )
        media = _make_media(db_session, org.organization_id)  # not added as item
        resp = client.get(
            f"/public/collections/{coll.public_share_token}/media/{media.media_id}/download"
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Consent clearance
# ---------------------------------------------------------------------------


class TestConsentClearance:
    def test_empty_collection_is_cleared(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        coll = _make_collection(db_session, org.organization_id, user.user_id)
        resp = auth_client.get(
            f"{_base(org.organization_id)}/{coll.collection_id}/consent-clearance"
        )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["is_cleared"] is True
        assert body["media_count"] == 0

    def test_reports_media_without_consent(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        coll = _make_collection(db_session, org.organization_id, user.user_id)
        media = _make_media(db_session, org.organization_id)
        db_session.add(
            MediaCollectionItem(
                collection_id=coll.collection_id,
                media_id=media.media_id,
                sort_order=1,
            )
        )
        db_session.commit()

        resp = auth_client.get(
            f"{_base(org.organization_id)}/{coll.collection_id}/consent-clearance"
        )
        body = resp.get_json()
        assert body["is_cleared"] is False
        assert body["media_count"] == 1
        assert len(body["media_without_consent"]) == 1
        assert body["media_without_consent"][0]["media_id"] == str(media.media_id)

    def test_reports_expired_consent(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        coll = _make_collection(db_session, org.organization_id, user.user_id)
        media = _make_media(db_session, org.organization_id)
        db_session.add(
            MediaCollectionItem(
                collection_id=coll.collection_id,
                media_id=media.media_id,
                sort_order=1,
            )
        )
        db_session.commit()
        _add_consent(db_session, org.organization_id, media.media_id, expired=True)

        resp = auth_client.get(
            f"{_base(org.organization_id)}/{coll.collection_id}/consent-clearance"
        )
        body = resp.get_json()
        assert body["is_cleared"] is False
        assert len(body["media_with_expired_consent"]) == 1

    def test_cleared_when_all_have_valid_consent(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        coll = _make_collection(db_session, org.organization_id, user.user_id)
        media = _make_media(db_session, org.organization_id)
        db_session.add(
            MediaCollectionItem(
                collection_id=coll.collection_id,
                media_id=media.media_id,
                sort_order=1,
            )
        )
        db_session.commit()
        _add_consent(db_session, org.organization_id, media.media_id, scope="public")

        resp = auth_client.get(
            f"{_base(org.organization_id)}/{coll.collection_id}/consent-clearance"
        )
        body = resp.get_json()
        assert body["is_cleared"] is True

    def test_clear_consent_blocks_on_missing(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        coll = _make_collection(db_session, org.organization_id, user.user_id)
        media = _make_media(db_session, org.organization_id)
        db_session.add(
            MediaCollectionItem(
                collection_id=coll.collection_id,
                media_id=media.media_id,
                sort_order=1,
            )
        )
        db_session.commit()

        resp = auth_client.post(
            f"{_base(org.organization_id)}/{coll.collection_id}/clear-consent"
        )
        assert resp.status_code == 400

    def test_clear_consent_succeeds(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        coll = _make_collection(db_session, org.organization_id, user.user_id)
        media = _make_media(db_session, org.organization_id)
        db_session.add(
            MediaCollectionItem(
                collection_id=coll.collection_id,
                media_id=media.media_id,
                sort_order=1,
            )
        )
        db_session.commit()
        _add_consent(db_session, org.organization_id, media.media_id, scope="public")

        resp = auth_client.post(
            f"{_base(org.organization_id)}/{coll.collection_id}/clear-consent"
        )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["success"] is True
        assert body["cleared_at"]

    def test_clear_consent_non_owner_403(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        stranger_coll = _make_collection(db_session, org.organization_id, uuid4())
        resp = auth_client.post(
            f"{_base(org.organization_id)}/{stranger_coll.collection_id}/clear-consent"
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# My public shares
# ---------------------------------------------------------------------------


class TestMyPublicShares:
    def test_empty(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(f"/api/organizations/{org.organization_id}/media/my-shares")
        assert resp.status_code == 200
        assert resp.get_json() == {"shares": []}

    def test_aggregates_access_stats(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        coll = _make_public_share(db_session, org.organization_id, user.user_id)
        for action in ("view", "view", "download"):
            db_session.add(
                MediaCollectionShareAccess(
                    collection_id=coll.collection_id, action=action
                )
            )
        # Failed auth event.
        db_session.add(
            MediaCollectionShareAccess(
                collection_id=coll.collection_id,
                action="auth",
                auth_success=False,
            )
        )
        db_session.commit()

        resp = auth_client.get(f"/api/organizations/{org.organization_id}/media/my-shares")
        assert resp.status_code == 200
        body = resp.get_json()
        assert len(body["shares"]) == 1
        row = body["shares"][0]
        assert row["collection_id"] == str(coll.collection_id)
        assert row["views"] == 2
        assert row["downloads"] == 1
        assert row["failed_auth"] == 1


# ---------------------------------------------------------------------------
# Metadata templates
# ---------------------------------------------------------------------------


class TestMetadataTemplates:
    def test_list_empty(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(_templates_base(org.organization_id))
        assert resp.status_code == 200
        assert resp.get_json() == {"templates": []}

    def test_create_happy(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            _templates_base(org.organization_id),
            json={
                "name": "Photo defaults",
                "description": "credit line",
                "template_fields": {"credit": "© Test Museum"},
                "is_default": True,
            },
        )
        assert resp.status_code == 201
        body = resp.get_json()
        assert body["name"] == "Photo defaults"
        assert body["is_default"] is True
        assert body["template_fields"] == {"credit": "© Test Museum"}

    def test_create_rejects_missing_name(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            _templates_base(org.organization_id),
            json={"template_fields": {}},
        )
        assert resp.status_code == 400

    def test_create_rejects_invalid_copyright(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            _templates_base(org.organization_id),
            json={
                "name": "Bad fields",
                "template_fields": {"copyright_status": "bogus-value"},
            },
        )
        assert resp.status_code == 422

    def test_get_template(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        t = MetadataTemplate(
            organization_id=org.organization_id,
            name="Dataset",
            template_fields={"credit": "Test"},
            is_default=False,
            is_active=True,
            created_by=user.user_id,
        )
        db_session.add(t)
        db_session.commit()

        resp = auth_client.get(f"{_templates_base(org.organization_id)}/{t.template_id}")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["name"] == "Dataset"

    def test_get_template_404(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(f"{_templates_base(org.organization_id)}/{uuid4()}")
        assert resp.status_code == 404

    def test_update_template_and_flip_default(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        t1 = MetadataTemplate(
            organization_id=org.organization_id,
            name="Old default",
            template_fields={},
            is_default=True,
            is_active=True,
            created_by=user.user_id,
        )
        t2 = MetadataTemplate(
            organization_id=org.organization_id,
            name="Challenger",
            template_fields={},
            is_default=False,
            is_active=True,
            created_by=user.user_id,
        )
        db_session.add_all([t1, t2])
        db_session.commit()

        resp = auth_client.patch(
            f"{_templates_base(org.organization_id)}/{t2.template_id}",
            json={
                "name": "Now default",
                "description": "updated",
                "is_default": True,
                "template_fields": {"credit": "Test"},
            },
        )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["name"] == "Now default"
        assert body["is_default"] is True

        db_session.expire_all()
        assert db_session.get(MetadataTemplate, t1.template_id).is_default is False

    def test_update_template_rejects_invalid_fields(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        t = MetadataTemplate(
            organization_id=org.organization_id,
            name="Fields",
            template_fields={},
            is_active=True,
            created_by=user.user_id,
        )
        db_session.add(t)
        db_session.commit()

        resp = auth_client.patch(
            f"{_templates_base(org.organization_id)}/{t.template_id}",
            json={"template_fields": {"copyright_status": "invalid"}},
        )
        assert resp.status_code == 422

    def test_update_template_404(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.patch(
            f"{_templates_base(org.organization_id)}/{uuid4()}",
            json={"name": "x"},
        )
        assert resp.status_code == 404

    def test_delete_template_soft_deactivates(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        t = MetadataTemplate(
            organization_id=org.organization_id,
            name="To remove",
            template_fields={},
            is_active=True,
            created_by=user.user_id,
        )
        db_session.add(t)
        db_session.commit()

        resp = auth_client.delete(f"{_templates_base(org.organization_id)}/{t.template_id}")
        assert resp.status_code == 200

        # Default listing (include_inactive=false) should omit it.
        listing = auth_client.get(_templates_base(org.organization_id)).get_json()
        ids = {row["template_id"] for row in listing["templates"]}
        assert str(t.template_id) not in ids

        # With include_inactive=true it reappears with is_active=False.
        full_listing = auth_client.get(
            _templates_base(org.organization_id),
            params={"include_inactive": True},
        ).get_json()
        inactive_row = next(
            row for row in full_listing["templates"]
            if row["template_id"] == str(t.template_id)
        )
        assert inactive_row["is_active"] is False

    def test_list_search_filter(self, auth_setup, db_session):
        auth_client, org, user = auth_setup
        for name in ("Photo defaults", "Video metadata", "Other"):
            db_session.add(
                MetadataTemplate(
                    organization_id=org.organization_id,
                    name=name,
                    template_fields={},
                    is_active=True,
                    created_by=user.user_id,
                )
            )
        db_session.commit()

        resp = auth_client.get(
            _templates_base(org.organization_id),
            params={"search": "photo"},
        )
        assert resp.status_code == 200
        names = [row["name"] for row in resp.get_json()["templates"]]
        assert names == ["Photo defaults"]

    def test_set_default_requires_media_admin(self, viewer_auth_setup, db_session):
        """Set-default requires the ``media.admin`` permission. The viewer role
        does not have it (and no platform.admin bypass), so the call 403s."""
        auth_client, org, user = viewer_auth_setup
        t = MetadataTemplate(
            organization_id=org.organization_id,
            name="Candidate",
            template_fields={},
            is_active=True,
            created_by=user.user_id,
        )
        db_session.add(t)
        db_session.commit()

        resp = auth_client.post(
            f"{_templates_base(org.organization_id)}/{t.template_id}/set-default"
        )
        assert resp.status_code == 403

    def test_set_default_with_media_admin(self, admin_with_media_admin, db_session):
        auth_client, org, user = admin_with_media_admin
        t1 = MetadataTemplate(
            organization_id=org.organization_id,
            name="Previous default",
            template_fields={},
            is_default=True,
            is_active=True,
            created_by=user.user_id,
        )
        t2 = MetadataTemplate(
            organization_id=org.organization_id,
            name="New default",
            template_fields={},
            is_default=False,
            is_active=True,
            created_by=user.user_id,
        )
        db_session.add_all([t1, t2])
        db_session.commit()

        resp = auth_client.post(
            f"{_templates_base(org.organization_id)}/{t2.template_id}/set-default"
        )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["success"] is True
        assert body["template_id"] == str(t2.template_id)

        db_session.expire_all()
        assert db_session.get(MetadataTemplate, t1.template_id).is_default is False
        assert db_session.get(MetadataTemplate, t2.template_id).is_default is True

    def test_set_default_404(self, admin_with_media_admin):
        auth_client, org, _ = admin_with_media_admin
        resp = auth_client.post(
            f"{_templates_base(org.organization_id)}/{uuid4()}/set-default"
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Viewer role sanity
# ---------------------------------------------------------------------------


class TestViewerForbiddenOnEdits:
    def test_viewer_can_list(self, viewer_auth_setup):
        auth_client, org, _ = viewer_auth_setup
        resp = auth_client.get(_base(org.organization_id))
        assert resp.status_code == 200

    def test_viewer_cannot_patch(self, viewer_auth_setup):
        auth_client, org, _ = viewer_auth_setup
        resp = auth_client.patch(
            f"{_base(org.organization_id)}/{uuid4()}",
            json={"name": "x"},
        )
        assert resp.status_code == 403

    def test_viewer_cannot_delete(self, viewer_auth_setup):
        auth_client, org, _ = viewer_auth_setup
        resp = auth_client.delete(f"{_base(org.organization_id)}/{uuid4()}")
        assert resp.status_code == 403

    def test_viewer_cannot_enable_public(self, viewer_auth_setup):
        auth_client, org, _ = viewer_auth_setup
        resp = auth_client.post(
            f"{_base(org.organization_id)}/{uuid4()}/enable-public",
            json={},
        )
        assert resp.status_code == 403

    def test_viewer_cannot_create_template(self, viewer_auth_setup):
        auth_client, org, _ = viewer_auth_setup
        resp = auth_client.post(_templates_base(org.organization_id), json={"name": "x"})
        assert resp.status_code == 403
