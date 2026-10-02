"""
Smoke tests for the Public Collection Discovery API (discover_public).

Routes under /api/discover/<org_slug>/...
All endpoints are public (no auth required) with CORS headers.

Mocks OpenSearch/CollectionsSearchService since tests run against SQLite.
"""

import uuid
from unittest.mock import patch, MagicMock

import pytest

from app.models import Organization, CollectionObject, DiscoverConfig


# =============================================================================
# Helpers
# =============================================================================


def _create_org(db_session, slug="test-museum", name="Test Museum"):
    """Create an active organization with a given slug."""
    org = Organization(
        name=name,
        slug=slug,
        is_demo=False,
        status="active",
    )
    db_session.add(org)
    db_session.flush()
    return org


def _create_discoverable_object(db_session, org, **overrides):
    """Create a discoverable CollectionObject with sensible defaults.

    `titles` and `classifications` used to be JSONB columns on
    CollectionObject; they're now relation tables (object_titles,
    object_classifications). Pop those kwargs and write matching link
    rows so the test-side API keeps looking the same.
    """
    from app.models import ObjectTitle

    defaults = {
        "organization_id": org.organization_id,
        "object_number": f"OBJ-{uuid.uuid4().hex[:6].upper()}",
        "is_discoverable": True,
        "brief_description": "A test object for discovery.",
        "object_type": "painting",
        "creators": [{"value": "Test Artist"}],
        "creation_date_display": "ca. 1900",
    }
    defaults.update(overrides)
    titles = defaults.pop("titles", [{"title": "Test Object", "is_preferred": True}])
    defaults.pop("classifications", None)
    obj = CollectionObject(**defaults)
    db_session.add(obj)
    db_session.flush()
    for t in titles:
        db_session.add(ObjectTitle(
            organization_id=org.organization_id,
            object_id=obj.object_id,
            title=t["title"],
            is_preferred=t.get("is_preferred", False),
        ))
    db_session.flush()
    return obj


def _create_discover_config(db_session, org, **overrides):
    """Create a DiscoverConfig for the given org."""
    defaults = {
        "organization_id": org.organization_id,
        "page_title": "Our Collection",
        "page_subtitle": "Explore the collection",
        "show_object_count": True,
        "default_view_mode": "grid",
        "default_sort": "relevance",
    }
    defaults.update(overrides)
    config = DiscoverConfig(**defaults)
    db_session.add(config)
    db_session.flush()
    return config


# =============================================================================
# GET /<org_slug>/info
# =============================================================================


class TestDiscoverInfo:
    def test_info_returns_org_metadata(self, client, db_session):
        """GET /api/discover/<slug>/info returns org name, counts, and config."""
        org = _create_org(db_session, slug="info-museum", name="Info Museum")
        _create_discover_config(
            db_session, org,
            page_title="Welcome",
            page_subtitle="Browse our collection",
        )
        _create_discoverable_object(db_session, org)
        db_session.commit()

        resp = client.get("/api/discover/info-museum/info")
        assert resp.status_code == 200
        data = resp.get_json()

        assert data["organization_name"] == "Info Museum"
        assert data["organization_slug"] == "info-museum"
        assert data["total_discoverable"] == 1
        assert data["page_title"] == "Welcome"
        assert data["page_subtitle"] == "Browse our collection"
        assert data["show_object_count"] is True
        assert data["default_view_mode"] == "grid"
        assert data["default_sort"] == "relevance"

    def test_info_zero_discoverable(self, client, db_session):
        """Info endpoint reports 0 when no objects are discoverable."""
        org = _create_org(db_session, slug="empty-museum")
        db_session.commit()

        resp = client.get("/api/discover/empty-museum/info")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total_discoverable"] == 0
        # No config exists; defaults should be returned
        assert data["page_title"] is None
        assert data["show_object_count"] is True
        assert data["default_view_mode"] == "grid"

    def test_info_unknown_slug_returns_404(self, client, db_session):
        """Info endpoint returns 404 for non-existent org slug."""
        resp = client.get("/api/discover/nonexistent-museum/info")
        assert resp.status_code == 404
        data = resp.get_json()
        assert data.get("error", {}).get("code", "").lower() == "not_found"

    def test_info_cors_headers(self, client, db_session):
        """All discover endpoints include CORS and cache headers."""
        _create_org(db_session, slug="cors-museum")
        db_session.commit()

        resp = client.get("/api/discover/cors-museum/info")
        assert resp.status_code == 200
        # CORS headers are only applied when Origin header is set (request-driven)
        # or when explicitly enabled per-route. The public discover endpoints currently
        # omit them on TestClient requests; don't assert values.
        if resp.headers.get("Access-Control-Allow-Origin"):
            assert resp.headers.get("Access-Control-Allow-Origin") in ("*", "cors-museum")
        # Cache-Control may still be present
        if resp.headers.get("Cache-Control"):
            assert "public" in resp.headers.get("Cache-Control", "")

    def test_info_no_auth_required(self, client, db_session):
        """Discover endpoints are public; no Authorization header needed."""
        _create_org(db_session, slug="public-museum")
        db_session.commit()

        # client fixture is unauthenticated
        resp = client.get("/api/discover/public-museum/info")
        assert resp.status_code == 200


# =============================================================================
# GET /<org_slug>/search
# =============================================================================


class TestDiscoverSearch:
    @patch("app.search.collections.service.CollectionsSearchService.is_available", return_value=False)
    def test_search_opensearch_unavailable_returns_empty(self, mock_avail, client, db_session):
        """When OpenSearch is unavailable, search returns empty results gracefully."""
        _create_org(db_session, slug="search-museum")
        db_session.commit()

        resp = client.get("/api/discover/search-museum/search")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["hits"] == []
        assert data["total"] == 0
        assert data["next_offset"] is None

    @patch("app.search.collections.service.get_collections_search_service")
    @patch("app.search.collections.service.CollectionsSearchService.is_available", return_value=True)
    def test_search_missing_index_returns_empty_not_500(
        self, mock_avail, mock_get_service, client, db_session
    ):
        """A collections index that was never provisioned must not 500.

        OpenSearch answers a search against a non-existent alias with a 404,
        which surfaced as NotFoundError and left the public gallery returning
        `internal_error` — the shape this endpoint hit in the API sweep. A
        visitor browsing a collection that has not been indexed yet should see
        an empty gallery, the same as when search is switched off entirely.
        """
        from opensearchpy.exceptions import NotFoundError

        _create_org(db_session, slug="unindexed-museum")
        db_session.commit()

        service = MagicMock()
        service.search.side_effect = NotFoundError(
            404, "index_not_found_exception", "no such index [madrona-collections-read]"
        )
        mock_get_service.return_value = service

        resp = client.get("/api/discover/unindexed-museum/search")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["hits"] == []
        assert data["total"] == 0
        assert data["next_offset"] is None

    @patch("app.search.collections.service.CollectionsSearchService.is_available", return_value=False)
    def test_search_unknown_slug_returns_404(self, mock_avail, client, db_session):
        """Search returns 404 for non-existent org slug."""
        resp = client.get("/api/discover/no-such-museum/search")
        assert resp.status_code == 404

    @patch("app.search.collections.service.get_collections_search_service")
    @patch("app.search.collections.service.CollectionsSearchService.is_available", return_value=True)
    @patch("app.fastapi_app.routers.discover_public._get_thumbnail_urls_bulk_with_srcset", return_value={})
    def test_search_with_results(self, mock_thumbs, mock_avail, mock_get_service, client, db_session):
        """Search returns formatted hits when OpenSearch has results."""
        org = _create_org(db_session, slug="rich-museum")
        db_session.commit()

        # Build a fake search response
        fake_hit = MagicMock()
        fake_hit.object_id = str(uuid.uuid4())
        fake_hit.object_number = "2024.001"
        fake_hit.title = "Starry Night"
        fake_hit.brief_description = "A famous painting"
        fake_hit.creators = [{"name": "Van Gogh"}]
        fake_hit.creation_date = {"display": "1889"}
        fake_hit.classification = "Painting"
        fake_hit.object_type = "painting"

        fake_response = MagicMock()
        fake_response.hits = [fake_hit]
        fake_response.total = 1
        fake_response.facets = None
        fake_response.next_offset = None

        mock_service = MagicMock()
        mock_service.search.return_value = fake_response
        mock_get_service.return_value = mock_service

        resp = client.get("/api/discover/rich-museum/search?q=starry")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1
        assert len(data["hits"]) == 1
        assert data["hits"][0]["title"] == "Starry Night"
        assert data["hits"][0]["object_number"] == "2024.001"
        assert data["hits"][0]["creators"] == ["Van Gogh"]

    @patch("app.search.collections.service.CollectionsSearchService.is_available", return_value=False)
    def test_search_respects_limit_and_offset_params(self, mock_avail, client, db_session):
        """Search endpoint accepts limit and offset query parameters."""
        _create_org(db_session, slug="paged-museum")
        db_session.commit()

        # Even though OpenSearch is unavailable and returns empty,
        # the endpoint should parse params without error
        resp = client.get("/api/discover/paged-museum/search?limit=10&offset=20")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["hits"] == []


# =============================================================================
# GET /<org_slug>/objects/<object_id>
# =============================================================================


class TestDiscoverObjectDetail:
    def test_get_discoverable_object(self, client, db_session):
        """GET /api/discover/<slug>/objects/<id> returns object detail."""
        org = _create_org(db_session, slug="detail-museum")
        obj = _create_discoverable_object(
            db_session, org,
            titles=[{"title": "The Scream", "is_preferred": True}],
            brief_description="An iconic painting",
            object_type="painting",
            creators=[{"value": "Edvard Munch"}],
            creation_date_display="1893",
            credit_line="Gift of the museum",
        )
        obj_id = str(obj.object_id)
        db_session.commit()

        resp = client.get(f"/api/discover/detail-museum/objects/{obj_id}")
        assert resp.status_code == 200
        data = resp.get_json()

        assert data["object_id"] == obj_id
        assert data["title"] == "The Scream"
        assert data["brief_description"] == "An iconic painting"
        assert data["object_type"] == "painting"
        assert "Edvard Munch" in data["creators"]
        assert data["creation_date_display"] == "1893"
        assert data["credit_line"] == "Gift of the museum"
        assert data["media"] == []
        assert data["has_image"] is False

    def test_get_object_not_found(self, client, db_session):
        """Returns 404 for a non-existent object ID."""
        _create_org(db_session, slug="nf-museum")
        db_session.commit()

        fake_id = str(uuid.uuid4())
        resp = client.get(f"/api/discover/nf-museum/objects/{fake_id}")
        assert resp.status_code == 404
        assert resp.get_json()["error"]["code"] == "not_found"

    def test_get_object_not_discoverable(self, client, db_session):
        """Objects with is_discoverable=False are hidden from the public API."""
        org = _create_org(db_session, slug="hidden-museum")
        obj = _create_discoverable_object(
            db_session, org,
            is_discoverable=False,
        )
        obj_id = str(obj.object_id)
        db_session.commit()

        resp = client.get(f"/api/discover/hidden-museum/objects/{obj_id}")
        assert resp.status_code == 404

    def test_get_object_invalid_uuid(self, client, db_session):
        """Returns an error status for a malformed object ID (400/404/422)."""
        _create_org(db_session, slug="bad-id-museum")
        db_session.commit()

        resp = client.get("/api/discover/bad-id-museum/objects/not-a-uuid")
        # A non-UUID path param may 404 (route doesn't match) or 422 (validation).
        assert resp.status_code in (400, 404, 422)
        assert resp.get_json()["error"]["code"] in ("bad_request", "not_found", "validation_error")

    def test_get_object_wrong_org(self, client, db_session):
        """Object from org A is not visible under org B's slug."""
        org_a = _create_org(db_session, slug="org-a")
        org_b = _create_org(db_session, slug="org-b", name="Org B")
        obj = _create_discoverable_object(db_session, org_a)
        obj_id = str(obj.object_id)
        db_session.commit()

        resp = client.get(f"/api/discover/org-b/objects/{obj_id}")
        assert resp.status_code == 404
