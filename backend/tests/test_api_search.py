"""
Integration tests for the Search API.

Routes under /api/search.
Mocks OpenSearch to exercise the HTTP layer, auth, and Postgres fallback.
"""

import json
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from app.models import EntityCurrent, EntityField


def _make_entity_field(db_session, org_id, **overrides):
    """Helper to create an EntityField row (with required EntityCurrent parent) for Postgres fallback search.

    EntityField has a composite FK (organization_id, entity_key) pointing at
    flow.entity_current, so the parent canonical row must exist first.
    """
    defaults = dict(
        organization_id=org_id,
        entity_key=f"obj-{uuid4().hex[:8]}",
        entity_type="object",
        title="Test Object",
        object_number="2024.1.1",
    )
    defaults.update(overrides)

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    parent = EntityCurrent(
        organization_id=defaults["organization_id"],
        entity_key=defaults["entity_key"],
        entity_type=defaults["entity_type"],
        source_system="test",
        source_id=defaults["entity_key"],
        payload={},
        payload_hash="test-hash",
        sources={},
        extracted_at=now,
        last_seen_at=now,
    )
    db_session.add(parent)
    db_session.flush()

    ef = EntityField(**defaults)
    db_session.add(ef)
    db_session.commit()
    return ef


# ── Full-text search ─────────────────────────────────────────────────────


class TestSearch:
    @patch("app.fastapi_app.routers.search.is_opensearch_available", return_value=True)
    @patch("app.fastapi_app.routers.search.get_opensearch_client")
    def test_search_returns_results(self, mock_client_fn, mock_avail, auth_setup):
        auth_client, org, _ = auth_setup
        mock_os = MagicMock()
        mock_client_fn.return_value = mock_os
        mock_os.search.return_value = {
            "hits": {
                "total": {"value": 1},
                "hits": [
                    {
                        "_score": 5.0,
                        "_source": {
                            "entity_key": "abc-123",
                            "entity_type": "object",
                            "title": "Test Painting",
                            "object_number": "2024.1.1",
                        },
                        "highlight": {"title": ["<em>Test</em> Painting"]},
                    }
                ],
            },
            "took": 3,
        }

        resp = auth_client.post(
            f"/api/search?organization_id={org.organization_id}",
            data=json.dumps({"query": {"q": "painting"}, "include_facets": False}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1
        assert data["hits"][0]["entity_key"] == "abc-123"

    def test_search_missing_org_id(self, auth_setup):
        auth_client, _, _ = auth_setup
        resp = auth_client.post(
            "/api/search",
            data=json.dumps({"query": {"q": "test"}}),
            content_type="application/json",
        )
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "organization_id" in (_e.get("message", "") if isinstance(_e, dict) else str(_e))

    @pytest.mark.postgres
    @patch("app.fastapi_app.routers.search.is_opensearch_available", return_value=False)
    def test_search_postgres_fallback(self, mock_avail, auth_setup, db_session):
        """Postgres fallback uses ILIKE which requires PostgreSQL."""
        auth_client, org, _ = auth_setup
        _make_entity_field(
            db_session, org.organization_id, title="Monet Painting", object_number="2024.1.1"
        )

        resp = auth_client.post(
            f"/api/search?organization_id={org.organization_id}",
            data=json.dumps({"query": {"q": "Monet"}}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] >= 1
        assert any("Monet" in h["title"] for h in data["hits"])

    @pytest.mark.postgres
    @patch("app.fastapi_app.routers.search.is_opensearch_available", return_value=False)
    def test_search_pagination(self, mock_avail, auth_setup, db_session):
        """Postgres fallback uses ILIKE which requires PostgreSQL."""
        auth_client, org, _ = auth_setup
        for i in range(5):
            _make_entity_field(
                db_session, org.organization_id,
                entity_key=f"obj-{i}",
                title=f"Object {i}",
                object_number=f"2024.{i}.1",
            )

        resp = auth_client.post(
            f"/api/search?organization_id={org.organization_id}",
            data=json.dumps({"query": {"q": "Object"}, "limit": 2, "offset": 0}),
            content_type="application/json",
        )
        data = resp.get_json()
        assert len(data["hits"]) == 2
        assert data["total"] == 5

    @patch("app.fastapi_app.routers.search.is_opensearch_available", return_value=True)
    @patch("app.fastapi_app.routers.search.get_opensearch_client")
    def test_search_empty_query(self, mock_client_fn, mock_avail, auth_setup):
        """Empty query body should still return 200 (OpenSearch handles it)."""
        auth_client, org, _ = auth_setup
        mock_os = MagicMock()
        mock_client_fn.return_value = mock_os
        mock_os.search.return_value = {
            "took": 1,
            "hits": {"total": {"value": 0}, "hits": []},
        }
        resp = auth_client.post(
            f"/api/search?organization_id={org.organization_id}",
            data=json.dumps({}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 0


# ── Autocomplete ─────────────────────────────────────────────────────────


class TestAutocomplete:
    @patch("app.fastapi_app.routers.search.is_opensearch_available", return_value=False)
    def test_autocomplete_returns_suggestions(self, mock_avail, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _make_entity_field(
            db_session, org.organization_id, title="Monet Water Lilies"
        )

        resp = auth_client.get(
            f"/api/search/autocomplete?organization_id={org.organization_id}&q=Monet"
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert "suggestions" in data
        assert len(data["suggestions"]) >= 1

    def test_autocomplete_requires_query(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(
            f"/api/search/autocomplete?organization_id={org.organization_id}&q=M"
        )
        assert resp.status_code in (400, 422)

    def test_autocomplete_requires_org_id(self, auth_setup):
        auth_client, _, _ = auth_setup
        resp = auth_client.get("/api/search/autocomplete?q=test")
        assert resp.status_code in (400, 422)


# ── Auth ─────────────────────────────────────────────────────────────────


class TestSearchAuth:
    def test_requires_auth(self, client, auth_setup):
        _, org, _ = auth_setup
        resp = client.post(
            f"/api/search?organization_id={org.organization_id}",
            data=json.dumps({"query": {"q": "test"}}),
            content_type="application/json",
        )
        assert resp.status_code == 401
