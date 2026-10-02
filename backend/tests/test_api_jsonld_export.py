"""
Smoke tests for the JSON-LD Export API blueprint.

Routes under (blueprint registered at /api):
  /api/organizations/<org_id>/collections/objects/<object_id>/jsonld
  /api/organizations/<org_id>/collections/objects/<object_id>.jsonld
  /api/organizations/<org_id>/collections/export/jsonld
  /api/jsonld/context
  /api/jsonld/frames/simple-object
  /api/public/v1/organizations/<org_id>/objects/<object_id>/jsonld
"""

import uuid
from unittest.mock import patch

import pytest

from app.models import CollectionObject


# ============================================================================
# Helpers
# ============================================================================

def _create_object(db_session, org_id, **overrides):
    """Insert a minimal CollectionObject for the given org."""
    defaults = dict(
        organization_id=org_id,
        object_number=f"OBJ-{uuid.uuid4().hex[:6]}",
        object_name="Test Object",
        object_type="painting",
        brief_description="A test painting",
    )
    defaults.update(overrides)
    obj = CollectionObject(**defaults)
    db_session.add(obj)
    db_session.commit()
    return obj


def _stub_jsonld(obj, org_slug, **kwargs):
    """Return a minimal JSON-LD stub for a CollectionObject."""
    include_context = kwargs.get("include_context", True)
    doc = {
        "@type": "Painting",
        "@id": f"https://data.madrona.io/org/{org_slug}/object/{obj.object_number}",
        "identifier": obj.object_number,
    }
    if include_context:
        doc["@context"] = {"@vocab": "https://schema.org/"}
    return doc


def _stub_jsonld_collection(objects, org_slug, **kwargs):
    """Return a minimal JSON-LD collection stub."""
    items = [
        {
            "@type": "Painting",
            "@id": f"https://data.madrona.io/org/{org_slug}/object/{o.object_number}",
            "identifier": o.object_number,
        }
        for o in objects
    ]
    return {
        "@context": {"@vocab": "https://schema.org/"},
        "@type": "Collection",
        "name": kwargs.get("collection_title", "Test Collection Export"),
        "numberOfItems": len(items),
        "hasPart": items,
    }


# Patch targets -- these are the service functions called by the API blueprint
_PATCH_MAP_OBJECT = "app.fastapi_app.routers.lod_exports.map_object_to_jsonld"
_PATCH_MAP_COLLECTION = "app.fastapi_app.routers.lod_exports.map_objects_to_jsonld_collection"


# ============================================================================
# Public (no-auth) endpoints
# ============================================================================


class TestJsonLdContext:
    """GET /api/jsonld/context -- no auth required."""

    def test_returns_context_document(self, client, db_session):
        resp = client.get("/api/jsonld/context")
        assert resp.status_code == 200
        data = resp.get_json()
        assert "@context" in data
        ctx = data["@context"]
        assert "https://schema.org/" in ctx.get("@vocab", "")

    def test_content_type_is_jsonld(self, client, db_session):
        resp = client.get("/api/jsonld/context")
        assert "application/ld+json" in resp.headers.get("content-type", "")

    def test_cors_header_present(self, client, db_session):
        resp = client.get("/api/jsonld/context")
        assert resp.headers.get("Access-Control-Allow-Origin") == "*"


class TestJsonLdSimpleObjectFrame:
    """GET /api/jsonld/frames/simple-object -- no auth required."""

    def test_returns_frame_document(self, client, db_session):
        resp = client.get("/api/jsonld/frames/simple-object")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data.get("@type") == "VisualArtwork"
        assert "creator" in data
        assert "image" in data

    def test_content_type_is_jsonld(self, client, db_session):
        resp = client.get("/api/jsonld/frames/simple-object")
        assert "application/ld+json" in resp.headers.get("content-type", "")


# ============================================================================
# Auth-required endpoints
# ============================================================================


class TestExportObjectJsonLdAuth:
    """Auth guard smoke tests for single-object and bulk export."""

    def test_returns_401_without_auth(self, client, db_session):
        fake_org = uuid.uuid4()
        fake_obj = uuid.uuid4()
        resp = client.get(
            f"/api/organizations/{fake_org}/collections/objects/{fake_obj}/jsonld"
        )
        assert resp.status_code == 401

    def test_returns_401_extension_route(self, client, db_session):
        fake_org = uuid.uuid4()
        fake_obj = uuid.uuid4()
        resp = client.get(
            f"/api/organizations/{fake_org}/collections/objects/{fake_obj}.jsonld"
        )
        assert resp.status_code == 401

    def test_bulk_export_returns_401_without_auth(self, client, db_session):
        fake_org = uuid.uuid4()
        resp = client.get(
            f"/api/organizations/{fake_org}/collections/export/jsonld"
        )
        assert resp.status_code == 401


class TestExportSingleObjectJsonLd:
    """GET /api/organizations/<org>/collections/objects/<obj>/jsonld"""

    def test_object_not_found_returns_404(self, auth_setup):
        auth_client, org, _ = auth_setup
        fake_obj = uuid.uuid4()
        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/collections/objects/{fake_obj}/jsonld"
        )
        assert resp.status_code == 404
        data = resp.get_json()
        assert data.get("error", {}).get("code", "").lower() == "not_found"

    @patch(_PATCH_MAP_OBJECT, side_effect=_stub_jsonld)
    def test_export_existing_object(self, mock_map, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        obj = _create_object(db_session, org.organization_id)
        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/collections/objects/{obj.object_id}/jsonld"
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data.get("@type") == "Painting"
        assert "@id" in data
        assert data.get("identifier") == obj.object_number
        assert "@context" in data
        mock_map.assert_called_once()

    @patch(_PATCH_MAP_OBJECT, side_effect=_stub_jsonld)
    def test_export_with_include_context_false(self, mock_map, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        obj = _create_object(db_session, org.organization_id)
        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/collections/objects/{obj.object_id}/jsonld"
            "?include_context=false"
        )
        assert resp.status_code == 200
        data = resp.get_json()
        # Verify include_context=False was passed to the service
        call_kwargs = mock_map.call_args
        assert call_kwargs[1].get("include_context") is False or (
            len(call_kwargs[0]) >= 4 and call_kwargs[0][3] is False
        )

    @patch(_PATCH_MAP_OBJECT, side_effect=_stub_jsonld)
    def test_content_type_is_ld_json(self, mock_map, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        obj = _create_object(db_session, org.organization_id)
        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/collections/objects/{obj.object_id}/jsonld"
        )
        assert "application/ld+json" in resp.headers.get("content-type", "")


class TestBulkExportJsonLd:
    """GET /api/organizations/<org>/collections/export/jsonld"""

    @patch(_PATCH_MAP_COLLECTION, side_effect=_stub_jsonld_collection)
    def test_empty_collection_returns_empty_list(self, mock_map, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/collections/export/jsonld"
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data.get("@type") == "Collection"
        assert data.get("numberOfItems") == 0
        assert data.get("hasPart") == []

    @patch(_PATCH_MAP_COLLECTION, side_effect=_stub_jsonld_collection)
    def test_bulk_export_returns_objects(self, mock_map, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _create_object(db_session, org.organization_id, object_number="BULK.1")
        _create_object(db_session, org.organization_id, object_number="BULK.2")
        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/collections/export/jsonld"
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["numberOfItems"] == 2
        identifiers = [p["identifier"] for p in data["hasPart"]]
        assert "BULK.1" in identifiers
        assert "BULK.2" in identifiers

    @patch(_PATCH_MAP_COLLECTION, side_effect=_stub_jsonld_collection)
    def test_bulk_export_pagination_view(self, mock_map, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _create_object(db_session, org.organization_id, object_number="PG.1")
        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/collections/export/jsonld?limit=10&offset=0"
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert "view" in data
        assert "first" in data["view"]

    def test_org_not_found_returns_404(self, auth_setup):
        auth_client, _, _ = auth_setup
        fake_org = uuid.uuid4()
        resp = auth_client.get(
            f"/api/organizations/{fake_org}/collections/export/jsonld"
        )
        assert resp.status_code == 404
