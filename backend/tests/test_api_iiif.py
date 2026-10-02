"""
Smoke tests for the IIIF API endpoints.

Routes:
- GET /api/iiif/3/<object_id>/manifest.json              (public)
- GET /api/iiif/3/collection/<collection_id>/manifest.json (public)
- GET /api/iiif/3/media/<media_id>/info.json              (public)
- GET /api/organizations/<org_id>/iiif/objects/<object_id>/manifest.json (auth required)
"""

import uuid
from unittest.mock import patch, MagicMock

import pytest

from app.database import current_session
from app.models import CollectionObject, CollectionObjectMedia, Media, ObjectTitle


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _create_object(db_session, org_id, **kwargs):
    """Insert a CollectionObject and return it.

    Titles now live in the `object_titles` link table (ObjectTitle); pass
    `titles=[{"title": ..., "is_preferred": True, ...}]` to seed them.
    """
    titles = kwargs.pop("titles", [{"title": "Test Object Title", "is_preferred": True}])
    defaults = dict(
        organization_id=org_id,
        object_number=kwargs.pop("object_number", f"OBJ-{uuid.uuid4().hex[:6]}"),
        object_name=kwargs.pop("object_name", "Test Object"),
        brief_description=kwargs.pop("brief_description", "A test object"),
    )
    defaults.update(kwargs)
    obj = CollectionObject(**defaults)
    db_session.add(obj)
    db_session.flush()
    for t in titles or []:
        db_session.add(ObjectTitle(
            organization_id=org_id,
            object_id=obj.object_id,
            title=t["title"],
            title_type=t.get("title_type"),
            language=t.get("language"),
            is_preferred=t.get("is_preferred", False),
        ))
    db_session.flush()
    return obj


def _create_media(db_session, org_id, **kwargs):
    """Insert a Media record and return it."""
    defaults = dict(
        organization_id=org_id,
        s3_key=kwargs.pop("s3_key", f"orgs/{org_id}/media/images/{uuid.uuid4().hex}.jpg"),
        filename=kwargs.pop("filename", "test.jpg"),
        file_size=kwargs.pop("file_size", 12345),
        mime_type=kwargs.pop("mime_type", "image/jpeg"),
        media_type=kwargs.pop("media_type", "image"),
        width=kwargs.pop("width", 1920),
        height=kwargs.pop("height", 1080),
        title=kwargs.pop("title", "Test Image"),
        processing_status=kwargs.pop("processing_status", "completed"),
    )
    defaults.update(kwargs)
    media = Media(**defaults)
    db_session.add(media)
    db_session.flush()
    return media


def _link_media(db_session, obj, media, is_primary=True, sort_order=0):
    """Create a CollectionObjectMedia link."""
    link = CollectionObjectMedia(
        object_id=obj.object_id,
        media_id=media.media_id,
        is_primary=is_primary,
        sort_order=sort_order,
    )
    db_session.add(link)
    db_session.flush()
    return link


# ---------------------------------------------------------------------------
# Tests – Public object manifest endpoint
# ---------------------------------------------------------------------------

class TestGetObjectManifest:
    """GET /api/iiif/3/<object_id>/manifest.json"""

    @patch("app.services.iiif_image.IIIF_IMAGE_SERVER_ENABLED", False)
    @patch("app.services.iiif_presentation.get_org_media_url", return_value="https://s3.example.com/signed-url")
    def test_manifest_returns_valid_iiif(self, mock_url, client, auth_setup):
        """A manifest for an existing object returns IIIF 3.0 structure."""
        auth_client, org, _ = auth_setup
        obj = _create_object(current_session(), org.organization_id, is_discoverable=True)
        media = _create_media(current_session(), org.organization_id, is_published=True)
        _link_media(current_session(), obj, media)
        current_session().commit()

        resp = client.get(f"/iiif/3/{obj.object_id}/manifest.json")
        assert resp.status_code == 200

        data = resp.get_json()
        assert data["@context"] == "http://iiif.io/api/presentation/3/context.json"
        assert data["type"] == "Manifest"
        assert "label" in data
        assert "items" in data
        # Should contain at least one canvas for the linked image
        assert len(data["items"]) >= 1
        assert data["items"][0]["type"] == "Canvas"

    def test_manifest_404_for_nonexistent_object(self, client, auth_setup):
        """Requesting a manifest for a non-existent UUID returns 404."""
        fake_id = uuid.uuid4()
        resp = client.get(f"/iiif/3/{fake_id}/manifest.json")
        assert resp.status_code == 404
        data = resp.get_json()
        assert data.get("error", {}).get("code", "").lower() == "not_found"

    def test_manifest_invalid_uuid(self, client, auth_setup):
        """A malformed UUID should return 400 or 500 (validation error)."""
        resp = client.get("/iiif/3/not-a-uuid/manifest.json")
        assert resp.status_code in (400, 422, 500)

    # ---- publish-to-expose guards (anonymous public route) ----

    def test_manifest_404_for_non_discoverable_object(self, client, auth_setup):
        """A non-discoverable object is a 404 even with published media — the
        institution hasn't published it, so it must be indistinguishable from
        nonexistent."""
        _, org, _ = auth_setup
        obj = _create_object(current_session(), org.organization_id, is_discoverable=False)
        media = _create_media(current_session(), org.organization_id, is_published=True)
        _link_media(current_session(), obj, media)
        current_session().commit()

        resp = client.get(f"/iiif/3/{obj.object_id}/manifest.json")
        assert resp.status_code == 404

    def test_manifest_404_when_no_published_media(self, client, auth_setup):
        """A discoverable object whose only media is unpublished yields 404 —
        never an empty public manifest."""
        _, org, _ = auth_setup
        obj = _create_object(current_session(), org.organization_id, is_discoverable=True)
        media = _create_media(current_session(), org.organization_id, is_published=False)
        _link_media(current_session(), obj, media)
        current_session().commit()

        resp = client.get(f"/iiif/3/{obj.object_id}/manifest.json")
        assert resp.status_code == 404

    @patch("app.services.iiif_image.IIIF_IMAGE_SERVER_ENABLED", False)
    @patch("app.services.iiif_presentation.get_org_media_url", return_value="https://s3.example.com/signed-url")
    def test_manifest_excludes_unpublished_media(self, mock_url, client, auth_setup):
        """A discoverable object's manifest includes only published media —
        an unpublished sibling must not leak into the public manifest."""
        _, org, _ = auth_setup
        obj = _create_object(current_session(), org.organization_id, is_discoverable=True)
        pub = _create_media(current_session(), org.organization_id, is_published=True)
        unpub = _create_media(current_session(), org.organization_id, is_published=False)
        _link_media(current_session(), obj, pub, is_primary=True, sort_order=0)
        _link_media(current_session(), obj, unpub, is_primary=False, sort_order=1)
        current_session().commit()

        resp = client.get(f"/iiif/3/{obj.object_id}/manifest.json")
        assert resp.status_code == 200
        data = resp.get_json()
        # Exactly one canvas — the published media only.
        assert len(data["items"]) == 1


# ---------------------------------------------------------------------------
# Tests – Public collection manifest endpoint
# ---------------------------------------------------------------------------

class TestGetCollectionManifest:
    """GET /api/iiif/3/collection/<collection_id>/manifest.json"""

    def test_collection_manifest_empty(self, client, auth_setup):
        """A collection manifest with no object_ids returns an empty items list."""
        coll_id = uuid.uuid4()
        resp = client.get(
            f"/iiif/3/collection/{coll_id}/manifest.json?label=Test+Collection"
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["@context"] == "http://iiif.io/api/presentation/3/context.json"
        assert data["type"] == "Collection"
        assert data["label"]["en"][0] == "Test Collection"
        assert data["items"] == []

    def test_collection_manifest_with_objects(self, client, auth_setup):
        """Collection manifest includes referenced object manifests."""
        auth_client, org, _ = auth_setup
        obj1 = _create_object(current_session(), org.organization_id, object_number="COL.1", is_discoverable=True)
        obj2 = _create_object(current_session(), org.organization_id, object_number="COL.2", is_discoverable=True)
        current_session().commit()

        ids_param = f"{obj1.object_id},{obj2.object_id}"
        resp = client.get(
            f"/iiif/3/collection/{uuid.uuid4()}/manifest.json"
            f"?label=Gallery&object_ids={ids_param}"
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data["items"]) == 2
        for item in data["items"]:
            assert item["type"] == "Manifest"

    def test_collection_manifest_excludes_non_discoverable(self, client, auth_setup):
        """Only discoverable objects appear in a public collection manifest;
        a non-discoverable id in the list is silently dropped, not leaked."""
        _, org, _ = auth_setup
        pub = _create_object(current_session(), org.organization_id, object_number="COL.PUB", is_discoverable=True)
        priv = _create_object(current_session(), org.organization_id, object_number="COL.PRIV", is_discoverable=False)
        current_session().commit()

        resp = client.get(
            f"/iiif/3/collection/{uuid.uuid4()}/manifest.json"
            f"?label=Gallery&object_ids={pub.object_id},{priv.object_id}"
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data["items"]) == 1
        assert str(pub.object_id) in data["items"][0]["id"]


# ---------------------------------------------------------------------------
# Tests – Public media info.json endpoint
# ---------------------------------------------------------------------------

class TestGetMediaInfo:
    """GET /api/iiif/3/media/<media_id>/info.json"""

    @patch("app.services.iiif_image.IIIF_IMAGE_SERVER_ENABLED", False)
    def test_info_json_basic(self, client, auth_setup):
        """info.json returns valid IIIF Image API 3.0 structure for an image."""
        _, org, _ = auth_setup
        media = _create_media(current_session(), org.organization_id, width=2000, height=1500, is_published=True)
        current_session().commit()

        resp = client.get(f"/iiif/3/media/{media.media_id}/info.json")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["@context"] == "http://iiif.io/api/image/3/context.json"
        assert data["type"] == "ImageService3"
        assert data["width"] == 2000
        assert data["height"] == 1500
        assert data["profile"] == "level0"
        assert "sizes" in data

    def test_info_json_404_for_nonexistent_media(self, client, auth_setup):
        """info.json for a non-existent media UUID returns 404."""
        fake_id = uuid.uuid4()
        resp = client.get(f"/iiif/3/media/{fake_id}/info.json")
        assert resp.status_code == 404
        data = resp.get_json()
        assert data.get("error", {}).get("code", "").lower() == "not_found"

    def test_info_json_404_for_unpublished_media(self, client, auth_setup):
        """info.json for an unpublished media item is a 404 — the public image
        API must not expose dimensions/derivatives of internal media."""
        _, org, _ = auth_setup
        media = _create_media(current_session(), org.organization_id, is_published=False)
        current_session().commit()

        resp = client.get(f"/iiif/3/media/{media.media_id}/info.json")
        assert resp.status_code == 404

    @patch("app.services.iiif_image.IIIF_IMAGE_SERVER_ENABLED", False)
    def test_info_json_rejects_non_image(self, client, auth_setup):
        """info.json returns 400 for a non-image media type (e.g. document)."""
        _, org, _ = auth_setup
        media = _create_media(
            current_session(), org.organization_id,
            media_type="document",
            mime_type="application/pdf",
            filename="report.pdf",
            width=None,
            height=None,
            is_published=True,  # published, so the guard passes and we reach the image-type check
        )
        current_session().commit()

        resp = client.get(f"/iiif/3/media/{media.media_id}/info.json")
        assert resp.status_code in (400, 422)
        data = resp.get_json()
        # Route raises HTTPException(400, str) — global handler maps 400 to "bad_request"
        assert data.get("error", {}).get("code") == "bad_request"
        assert "image" in (data.get("error").get("message", "") if isinstance(data.get("error"), dict) else (data.get("error") or str(data.get("detail", "")))).lower()


# ---------------------------------------------------------------------------
# Tests – Authenticated manifest endpoint
# ---------------------------------------------------------------------------

class TestGetAuthenticatedManifest:
    """GET /api/organizations/<org_id>/iiif/objects/<object_id>/manifest.json"""

    def test_auth_required(self, client, auth_setup):
        """Unauthenticated request should be rejected (401)."""
        _, org, _ = auth_setup
        fake_obj_id = uuid.uuid4()
        resp = client.get(
            f"/api/organizations/{org.organization_id}/iiif/objects/{fake_obj_id}/manifest.json"
        )
        assert resp.status_code == 401

    @patch("app.services.iiif_image.IIIF_IMAGE_SERVER_ENABLED", False)
    @patch("app.services.iiif_presentation.get_org_media_url", return_value="https://s3.example.com/signed-url")
    def test_authenticated_manifest_success(self, mock_url, auth_setup):
        """Authenticated user gets a valid manifest for their org's object."""
        auth_client, org, _ = auth_setup
        obj = _create_object(current_session(), org.organization_id, object_number="AUTH.1")
        media = _create_media(current_session(), org.organization_id)
        _link_media(current_session(), obj, media)
        current_session().commit()

        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/iiif/objects/{obj.object_id}/manifest.json"
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["type"] == "Manifest"
        assert data["@context"] == "http://iiif.io/api/presentation/3/context.json"

    def test_authenticated_manifest_404_wrong_org(self, auth_setup, db_session):
        """Object belonging to a different org returns 404."""
        from app.models import Organization
        auth_client, org, _ = auth_setup
        # Seed a real second Organization so the FK from collection_objects
        # can resolve (on Postgres the FK is enforced, unlike the old SQLite).
        other_org = Organization(
            name="Other Org",
            slug=f"other-iiif-{uuid.uuid4().hex[:8]}",
            is_demo=False,
            status="active",
        )
        db_session.add(other_org)
        db_session.flush()
        obj = _create_object(current_session(), other_org.organization_id, object_number="OTHER.1", titles=[])
        current_session().commit()

        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/iiif/objects/{obj.object_id}/manifest.json"
        )
        assert resp.status_code == 404
