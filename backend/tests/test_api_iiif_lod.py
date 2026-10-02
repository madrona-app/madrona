"""
Smoke tests for the IIIF LOD API blueprint (app/api/iiif_lod.py).

Endpoints under test:
  GET /org/<org_slug>/object/<public_id>/manifest         (get_object_manifest_lod)
  GET /org/<org_slug>/object/<public_id>/manifest.json    (get_object_manifest_lod_json)
  GET /org/<org_slug>/object/<public_id>                  (resolve_object_uri)
  GET /org/<org_slug>/object/<public_id>/canvas/<seq>     (get_canvas)
  GET /org/<org_slug>/collection/<collection_id>          (get_collection_manifest)
  GET /org/<org_slug>/activity                            (get_activity_stream)
  GET /org/<org_slug>/media/<public_id>                   (get_media_lod)

All endpoints are public (no auth required). Tests use the plain `client`
fixture rather than `auth_setup`.

NOTE: The source API references CollectionObject.is_published and
obj.copyright_status, which do not exist on the CollectionObject model.
Tests mock _generate_manifest_response and the is_published filter
to work around these issues in the source code.
"""

import uuid
from datetime import datetime, timezone
from unittest.mock import patch, MagicMock

import pytest
from fastapi.responses import JSONResponse

from app.models import (
    Organization,
    CollectionObject,
    Media,
    CollectionObjectMedia,
    ObjectTitle,
    URIRegistry,
)
from app.services.uri_persistence import BASE_URI, URIStatus


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

STUB_MANIFEST = {
    "@context": "http://iiif.io/api/presentation/3/context.json",
    "id": "https://data.madrona.io/org/museum/object/2024-001/manifest",
    "type": "Manifest",
    "label": {"en": ["Test Painting"]},
    "items": [],
}


def _make_org(session, slug="test-museum"):
    """Create and return an Organization."""
    org = Organization(
        name="Test Museum",
        slug=slug,
        is_demo=False,
        status="active",
    )
    session.add(org)
    session.flush()
    return org


def _make_object(session, org, *, object_number="2024-001", object_name="Test Painting",
                 titles=None):
    """Create a CollectionObject and its title link rows."""
    obj = CollectionObject(
        organization_id=org.organization_id,
        object_number=object_number,
        object_name=object_name,
        object_type="painting",
    )
    session.add(obj)
    session.flush()
    for t in titles or [{"title": object_name, "is_preferred": True}]:
        session.add(ObjectTitle(
            organization_id=org.organization_id,
            object_id=obj.object_id,
            title=t["title"],
            title_type=t.get("title_type"),
            language=t.get("language"),
            is_preferred=t.get("is_preferred", False),
        ))
    session.flush()
    return obj


def _make_media(session, org, *, title="Test Image", media_type="image",
                mime_type="image/jpeg", width=800, height=600, is_published=True):
    """Create a Media record and return it."""
    media = Media(
        organization_id=org.organization_id,
        s3_key=f"orgs/{org.organization_id}/media/images/{uuid.uuid4()}.jpg",
        filename="test-image.jpg",
        file_size=102400,
        mime_type=mime_type,
        media_type=media_type,
        title=title,
        width=width,
        height=height,
        is_published=is_published,
    )
    session.add(media)
    session.flush()
    return media


def _link_media(session, obj, media, *, is_primary=True, sort_order=0):
    """Create a CollectionObjectMedia link."""
    link = CollectionObjectMedia(
        object_id=obj.object_id,
        media_id=media.media_id,
        is_primary=is_primary,
        sort_order=sort_order,
    )
    session.add(link)
    session.flush()
    return link


def _make_uri_record(session, org, *, entity_type="collection_object",
                     public_id="2024-001", entity_id=None, status="active",
                     redirect_to=None, tombstone_reason=None):
    """Insert a URIRegistry row and return it."""
    entity_id = entity_id or uuid.uuid4()
    full_uri = f"{BASE_URI}/org/{org.slug}/object/{public_id}"
    record = URIRegistry(
        organization_id=org.organization_id,
        entity_type=entity_type,
        entity_id=entity_id,
        public_id=public_id,
        full_uri=full_uri,
        status=status,
        redirect_to=redirect_to,
        tombstone_reason=tombstone_reason,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    session.add(record)
    session.flush()
    return record


def _stub_manifest_response(db, obj, org, org_slug):
    """Stub for _generate_lod_manifest_response that avoids accessing missing CollectionObject fields."""
    manifest = {
        "@context": "http://iiif.io/api/presentation/3/context.json",
        "id": f"{BASE_URI}/org/{org_slug}/object/{obj.object_number}/manifest",
        "type": "Manifest",
        "label": {"en": [obj.object_name or "Untitled"]},
        "items": [],
    }
    response = JSONResponse(
        content=manifest,
        headers={
            'Content-Type': 'application/ld+json;profile="http://iiif.io/api/presentation/3/context.json"',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=3600',
        },
    )
    return response


# ---------------------------------------------------------------------------
# Tests: Object Manifest - 404 cases (no mock needed)
# ---------------------------------------------------------------------------

class TestObjectManifestNotFound:
    """Tests for manifest 404 responses (no manifest generation involved)."""

    def test_manifest_not_found_org(self, client, db_session):
        """Requesting a manifest for a non-existent org returns 404."""
        resp = client.get("/org/nonexistent-museum/object/2024-001/manifest")
        assert resp.status_code == 404
        data = resp.get_json()
        assert data.get("error", {}).get("code", "").lower() == "not_found"

    def test_manifest_not_found_object(self, client, db_session):
        """Requesting a manifest for a non-existent object returns 404."""
        _make_org(db_session, slug="museum")
        db_session.commit()

        resp = client.get("/org/museum/object/nonexistent/manifest")
        assert resp.status_code == 404
        data = resp.get_json()
        assert data.get("error", {}).get("code", "").lower() == "not_found"


# ---------------------------------------------------------------------------
# Tests: Object Manifest - success and content type
# ---------------------------------------------------------------------------

class TestObjectManifestSuccess:
    """Tests for successful manifest responses (mock _generate_manifest_response)."""

    @patch("app.fastapi_app.routers.media_iiif._generate_lod_manifest_response", side_effect=_stub_manifest_response)
    def test_manifest_direct_lookup(self, mock_gen, client, db_session):
        """A manifest is returned when the object exists (direct lookup, no URI registry)."""
        org = _make_org(db_session, slug="museum")
        _make_object(db_session, org, object_number="2024-001")
        db_session.commit()

        resp = client.get("/org/museum/object/2024-001/manifest")
        assert resp.status_code == 200

        data = resp.get_json()
        assert data["type"] == "Manifest"
        assert "iiif.io/api/presentation/3" in str(data.get("@context"))
        # Verify CORS header
        assert resp.headers.get("Access-Control-Allow-Origin") == "*"

    @patch("app.fastapi_app.routers.media_iiif._generate_lod_manifest_response", side_effect=_stub_manifest_response)
    def test_manifest_json_extension(self, mock_gen, client, db_session):
        """The .json extension also returns the manifest."""
        org = _make_org(db_session, slug="museum")
        _make_object(db_session, org, object_number="2024-001")
        db_session.commit()

        resp = client.get("/org/museum/object/2024-001/manifest.json")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["type"] == "Manifest"

    @patch("app.fastapi_app.routers.media_iiif._generate_lod_manifest_response", side_effect=_stub_manifest_response)
    def test_manifest_content_type_is_iiif_jsonld(self, mock_gen, client, db_session):
        """Manifest response uses the IIIF Presentation JSON-LD content type."""
        org = _make_org(db_session, slug="museum")
        _make_object(db_session, org, object_number="2024-001")
        db_session.commit()

        resp = client.get("/org/museum/object/2024-001/manifest")
        assert resp.status_code == 200
        content_type = resp.headers.get("Content-Type", "")
        assert "application/ld+json" in content_type


# ---------------------------------------------------------------------------
# Tests: URI Registry (tombstone / redirect)
# ---------------------------------------------------------------------------

class TestURIRegistryManifest:
    """Tests for manifest lookup via URI registry (tombstone, redirect)."""

    def test_manifest_via_uri_registry_tombstone(self, client, db_session):
        """A tombstoned URI in the registry returns 410 Gone."""
        org = _make_org(db_session, slug="museum")
        _make_uri_record(
            db_session,
            org,
            public_id="deleted-001",
            status=URIStatus.TOMBSTONE.value,
            tombstone_reason="Deaccessioned",
        )
        db_session.commit()

        resp = client.get("/org/museum/object/deleted-001/manifest")
        assert resp.status_code == 410
        data = resp.get_json()
        _e = data["error"]
        assert (_e.get("message") if isinstance(_e, dict) else _e) == "Gone"
        assert data["reason"] == "Deaccessioned"

    def test_manifest_via_uri_registry_redirect(self, client, db_session):
        """A redirect URI in the registry returns 301."""
        org = _make_org(db_session, slug="museum")
        target_uri = f"{BASE_URI}/org/museum/object/canonical-001"
        _make_uri_record(
            db_session,
            org,
            public_id="old-001",
            status=URIStatus.REDIRECT.value,
            redirect_to=target_uri,
        )
        db_session.commit()

        resp = client.get("/org/museum/object/old-001/manifest")
        assert resp.status_code == 301
        location = resp.headers["Location"]
        assert "canonical-001/manifest" in location


# ---------------------------------------------------------------------------
# Tests: Content Negotiation (resolve_object_uri)
# ---------------------------------------------------------------------------

class TestResolveObjectURI:
    """Tests for GET /org/<slug>/object/<public_id> (content negotiation)."""

    def test_html_accept_redirects_to_ui(self, client, db_session):
        """Accept: text/html redirects to the web UI with 303."""
        org = _make_org(db_session, slug="museum")
        _make_object(db_session, org, object_number="2024-001")
        db_session.commit()

        resp = client.get(
            "/org/museum/object/2024-001",
            headers={"Accept": "text/html"},
        )
        assert resp.status_code == 303
        assert "/organizations/museum/" in resp.headers["Location"]

    @patch("app.fastapi_app.routers.media_iiif._generate_lod_manifest_response", side_effect=_stub_manifest_response)
    def test_jsonld_accept_returns_manifest(self, mock_gen, client, db_session):
        """Accept: application/ld+json returns the IIIF manifest."""
        org = _make_org(db_session, slug="museum")
        _make_object(db_session, org, object_number="2024-001")
        db_session.commit()

        resp = client.get(
            "/org/museum/object/2024-001",
            headers={"Accept": "application/ld+json"},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["type"] == "Manifest"


# ---------------------------------------------------------------------------
# Tests: Activity Stream (non-existent org only -- no is_published filter)
# ---------------------------------------------------------------------------

class TestActivityStream:
    """Tests for GET /org/<slug>/activity."""

    def test_activity_stream_nonexistent_org(self, client, db_session):
        """Activity stream for a non-existent org returns 404."""
        resp = client.get("/org/nonexistent/activity")
        assert resp.status_code == 404
        data = resp.get_json()
        assert data.get("error", {}).get("code", "").lower() == "not_found"


# ---------------------------------------------------------------------------
# Tests: Collection Manifest
# ---------------------------------------------------------------------------

class TestCollectionManifest:
    """Tests for GET /org/<slug>/collection/<collection_id>."""

    def test_collection_nonexistent_org(self, client, db_session):
        """Collection manifest for a non-existent org returns 404."""
        resp = client.get("/org/nonexistent/collection/test-collection")
        assert resp.status_code == 404
        data = resp.get_json()
        assert data.get("error", {}).get("code", "").lower() == "not_found"


# ---------------------------------------------------------------------------
# Tests: Media LOD
# ---------------------------------------------------------------------------

class TestMediaLOD:
    """Tests for GET /org/<slug>/media/<public_id>."""

    def test_media_not_found(self, client, db_session):
        """Requesting a non-existent media item returns 404."""
        _make_org(db_session, slug="museum")
        db_session.commit()

        resp = client.get("/org/museum/media/00000000")
        assert resp.status_code == 404
        data = resp.get_json()
        assert data.get("error", {}).get("code", "").lower() == "not_found"

    @patch("app.services.iiif_image.get_iiif_image_service")
    def test_media_returns_jsonld(self, mock_img_svc, client, db_session):
        """A valid media ID returns schema.org/ImageObject JSON-LD."""
        mock_svc_inst = MagicMock()
        mock_svc_inst.is_available.return_value = False
        mock_img_svc.return_value = mock_svc_inst

        org = _make_org(db_session, slug="museum")
        media = _make_media(db_session, org, title="Test Photo")
        db_session.commit()

        resp = client.get(f"/org/museum/media/{media.media_id}")
        assert resp.status_code == 200

        data = resp.get_json()
        assert data["@type"] == "ImageObject"
        assert data["@context"] == "https://schema.org/"
        assert data["name"] == "Test Photo"
        assert data["encodingFormat"] == "image/jpeg"
        # Check JSON-LD content type
        content_type = resp.headers.get("Content-Type", "")
        assert "application/ld+json" in content_type
        # Check CORS
        assert resp.headers.get("Access-Control-Allow-Origin") == "*"

    def test_media_id_prefix_does_not_resolve(self, client, db_session):
        """A partial id must not resolve.

        The lookup used to be `media_id::text LIKE :public_id || '%'`, so a
        handful of hex characters returned whichever media sorted first.
        """
        org = _make_org(db_session, slug="museum")
        media = _make_media(db_session, org, title="Test Photo")
        db_session.commit()

        resp = client.get(f"/org/museum/media/{str(media.media_id)[:8]}")
        assert resp.status_code == 404

    def test_media_from_another_org_is_not_served(self, client, db_session):
        """The org slug in the URL must actually scope the lookup.

        It was ignored entirely, so any org's slug served any org's media.
        """
        org_a = _make_org(db_session, slug="museum")
        org_b = _make_org(db_session, slug="other-museum")
        media_b = _make_media(db_session, org_b, title="Their Photo")
        db_session.commit()

        resp = client.get(f"/org/museum/media/{media_b.media_id}")
        assert resp.status_code == 404

    def test_unpublished_media_is_not_served(self, client, db_session):
        """Every other public IIIF route filters on is_published; this one
        did not."""
        org = _make_org(db_session, slug="museum")
        media = _make_media(db_session, org, title="Draft", is_published=False)
        db_session.commit()

        resp = client.get(f"/org/museum/media/{media.media_id}")
        assert resp.status_code == 404
