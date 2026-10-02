"""
Smoke tests for the Autocomplete API endpoints.

Routes under /api/autocomplete:
- POST /search  (main autocomplete search)
- GET  /recent  (recent values for a field type)
- GET  /popular (popular values for a field type)
- POST /resolve (resolve a reference URI)
- POST /select  (record suggestion selection)

All endpoints require authentication via require_auth().
External services (Getty, Wikidata) are mocked to avoid network calls.
"""

import json
from unittest.mock import patch, MagicMock
from uuid import uuid4

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

SEARCH_URL = "/api/autocomplete/search"
RECENT_URL = "/api/autocomplete/recent"
POPULAR_URL = "/api/autocomplete/popular"
RESOLVE_URL = "/api/autocomplete/resolve"
SELECT_URL = "/api/autocomplete/select"


def _post_json(auth_client, url, data):
    return auth_client.post(url, data=json.dumps(data), content_type="application/json")


# ---------------------------------------------------------------------------
# POST /search - Auth required
# ---------------------------------------------------------------------------

class TestSearchAuth:
    def test_search_requires_auth(self, client):
        """Unauthenticated POST to /search returns 401."""
        resp = client.post(
            SEARCH_URL,
            data=json.dumps({
                "query": "test",
                "field_type": "creator",
                "organization_id": str(uuid4()),
            }),
            content_type="application/json",
        )
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# POST /search - Validation
# ---------------------------------------------------------------------------

class TestSearchValidation:
    def test_search_missing_query(self, auth_setup):
        """Empty query returns 400 INVALID_QUERY."""
        auth_client, org, _ = auth_setup
        resp = _post_json(auth_client, SEARCH_URL, {
            "query": "",
            "field_type": "creator",
            "organization_id": str(org.organization_id),
        })
        assert resp.status_code in (400, 422)
        data = resp.get_json()
        assert (data.get("error", {}).get("code") in ("bad_request", "validation_error", "invalid_query") or data.get("detail"))

    def test_search_missing_field_type(self, auth_setup):
        """Missing field_type returns 400 MISSING_FIELD_TYPE."""
        auth_client, org, _ = auth_setup
        resp = _post_json(auth_client, SEARCH_URL, {
            "query": "test",
            "organization_id": str(org.organization_id),
        })
        assert resp.status_code in (400, 422)
        data = resp.get_json()
        assert (data.get("error", {}).get("code") in ("bad_request", "validation_error", "missing_field_type") or data.get("detail"))

    def test_search_missing_org_id(self, auth_setup):
        """Missing organization_id returns 400 MISSING_ORG_ID."""
        auth_client, _, _ = auth_setup
        resp = _post_json(auth_client, SEARCH_URL, {
            "query": "test",
            "field_type": "creator",
        })
        assert resp.status_code in (400, 422)
        data = resp.get_json()
        assert (data.get("error", {}).get("code") in ("bad_request", "validation_error", "missing_org_id") or data.get("detail"))

    def test_search_query_too_long(self, auth_setup):
        """Query exceeding 200 chars returns 400."""
        auth_client, org, _ = auth_setup
        resp = _post_json(auth_client, SEARCH_URL, {
            "query": "x" * 201,
            "field_type": "creator",
            "organization_id": str(org.organization_id),
        })
        assert resp.status_code in (400, 422)


# ---------------------------------------------------------------------------
# POST /search - Local-only (no external, no results)
# ---------------------------------------------------------------------------

class TestSearchLocalOnly:
    @patch("app.fastapi_app.routers.autocomplete.search_external", return_value=[])
    def test_search_empty_results(self, mock_ext, auth_setup):
        """Search with no matching local data returns empty suggestions."""
        auth_client, org, _ = auth_setup
        resp = _post_json(auth_client, SEARCH_URL, {
            "query": "zzz_nonexistent_term",
            "field_type": "material",
            "organization_id": str(org.organization_id),
            "sources": ["local", "recent"],
        })
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["query"] == "zzz_nonexistent_term"
        assert isinstance(data["suggestions"], list)
        assert len(data["suggestions"]) == 0
        assert data["external_searched"] is False

    @patch("app.fastapi_app.routers.autocomplete.search_external", return_value=[])
    def test_search_response_shape(self, mock_ext, auth_setup):
        """Search response has expected top-level keys."""
        auth_client, org, _ = auth_setup
        resp = _post_json(auth_client, SEARCH_URL, {
            "query": "test",
            "field_type": "creator",
            "organization_id": str(org.organization_id),
            "sources": ["local"],
        })
        assert resp.status_code == 200
        data = resp.get_json()
        assert "query" in data
        assert "suggestions" in data
        assert "external_searched" in data
        assert "search_time_ms" in data
        assert "debug" in data


# ---------------------------------------------------------------------------
# POST /search - External sources mocked
# ---------------------------------------------------------------------------

class TestSearchExternal:
    @patch("app.fastapi_app.routers.autocomplete.search_external")
    def test_search_with_external_results(self, mock_ext, auth_setup):
        """When external returns results, they appear in suggestions."""
        mock_ext.return_value = [
            {
                "id": "aat-300015050",
                "label": "oil paint",
                "description": "A type of paint",
                "source": "getty",
                "score": 0.9,
                "reference": {
                    "uri": "http://vocab.getty.edu/aat/300015050",
                    "source": "AAT",
                    "label": "oil paint",
                    "match_confidence": "exact",
                },
            }
        ]
        auth_client, org, _ = auth_setup
        resp = _post_json(auth_client, SEARCH_URL, {
            "query": "oil paint",
            "field_type": "material",
            "organization_id": str(org.organization_id),
            "sources": ["external"],
        })
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["external_searched"] is True
        assert len(data["suggestions"]) >= 1
        assert data["suggestions"][0]["label"] == "oil paint"
        assert data["suggestions"][0]["source"] == "getty"

    @patch("app.fastapi_app.routers.autocomplete.search_external", side_effect=Exception("Network error"))
    def test_search_external_failure_graceful(self, mock_ext, auth_setup):
        """External service failure degrades gracefully, returns 200 with empty results."""
        auth_client, org, _ = auth_setup
        resp = _post_json(auth_client, SEARCH_URL, {
            "query": "test query",
            "field_type": "material",
            "organization_id": str(org.organization_id),
            "sources": ["external"],
        })
        assert resp.status_code == 200
        data = resp.get_json()
        # Should still return a valid response, just without external results
        assert isinstance(data["suggestions"], list)


# ---------------------------------------------------------------------------
# POST /search - Different field types
# ---------------------------------------------------------------------------

class TestSearchFieldTypes:
    @patch("app.fastapi_app.routers.autocomplete.search_external", return_value=[])
    def test_search_creator_field(self, mock_ext, auth_setup):
        """Search with field_type=creator succeeds."""
        auth_client, org, _ = auth_setup
        resp = _post_json(auth_client, SEARCH_URL, {
            "query": "Picasso",
            "field_type": "creator",
            "organization_id": str(org.organization_id),
            "sources": ["local"],
        })
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["debug"]["field_type"] == "creator"

    @patch("app.fastapi_app.routers.autocomplete.search_external", return_value=[])
    def test_search_place_field(self, mock_ext, auth_setup):
        """Search with field_type=place succeeds."""
        auth_client, org, _ = auth_setup
        resp = _post_json(auth_client, SEARCH_URL, {
            "query": "Florence",
            "field_type": "place",
            "organization_id": str(org.organization_id),
            "sources": ["local"],
        })
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["debug"]["field_type"] == "place"


# ---------------------------------------------------------------------------
# GET /recent - Auth and validation
# ---------------------------------------------------------------------------

class TestRecent:
    def test_recent_requires_auth(self, client):
        """Unauthenticated GET to /recent returns 401."""
        resp = client.get(f"{RECENT_URL}?field_type=material")
        assert resp.status_code == 401

    def test_recent_missing_field_type(self, auth_setup):
        """Missing field_type query param returns 400."""
        auth_client, _, _ = auth_setup
        resp = auth_client.get(RECENT_URL)
        assert resp.status_code in (400, 422)
        data = resp.get_json()
        assert (data.get("error", {}).get("code") in ("bad_request", "validation_error", "missing_field_type") or data.get("detail"))


# ---------------------------------------------------------------------------
# GET /popular - Auth and validation
# ---------------------------------------------------------------------------

class TestPopular:
    def test_popular_requires_auth(self, client):
        """Unauthenticated GET to /popular returns 401."""
        resp = client.get(f"{POPULAR_URL}?field_type=material")
        assert resp.status_code == 401

    def test_popular_missing_field_type(self, auth_setup):
        """Missing field_type query param returns 400."""
        auth_client, _, _ = auth_setup
        resp = auth_client.get(POPULAR_URL)
        assert resp.status_code in (400, 422)
        data = resp.get_json()
        assert (data.get("error", {}).get("code") in ("bad_request", "validation_error", "missing_field_type") or data.get("detail"))


# ---------------------------------------------------------------------------
# POST /resolve - Smoke test
# ---------------------------------------------------------------------------

class TestResolve:
    def test_resolve_requires_auth(self, client):
        """Unauthenticated POST to /resolve returns 401."""
        resp = client.post(
            RESOLVE_URL,
            data=json.dumps({"uri": "http://example.com", "source": "AAT"}),
            content_type="application/json",
        )
        assert resp.status_code == 401

    def test_resolve_returns_null(self, auth_setup):
        """Resolve endpoint currently returns null (not yet implemented)."""
        auth_client, _, _ = auth_setup
        resp = _post_json(auth_client, RESOLVE_URL, {
            "uri": "http://vocab.getty.edu/aat/300015050",
            "source": "AAT",
        })
        assert resp.status_code == 200
        # The resolve endpoint currently returns None/null
        assert resp.get_json() is None


# ---------------------------------------------------------------------------
# POST /select - Validation
# ---------------------------------------------------------------------------

class TestSelect:
    def test_select_requires_auth(self, client):
        """Unauthenticated POST to /select returns 401."""
        resp = client.post(
            SELECT_URL,
            data=json.dumps({
                "suggestion_id": "aat-300015050",
                "label": "oil paint",
            }),
            content_type="application/json",
        )
        assert resp.status_code == 401

    def test_select_missing_params(self, auth_setup):
        """Missing suggestion_id or label returns 400."""
        auth_client, org, _ = auth_setup
        resp = _post_json(auth_client, SELECT_URL, {
            "organization_id": str(org.organization_id),
        })
        assert resp.status_code in (400, 422)
        data = resp.get_json()
        assert (data.get("error", {}).get("code") in ("bad_request", "validation_error", "missing_params") or data.get("detail"))
