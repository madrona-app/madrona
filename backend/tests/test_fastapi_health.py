"""
Tests for the FastAPI health/infra endpoints.

Tests the 6 endpoints migrated from Flask app/main.py.
"""

from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture(scope="session")
def fastapi_app():
    """Create a minimal FastAPI app with just the health router."""
    from fastapi import FastAPI
    from app.fastapi_app.routers.health import router as health_router

    app = FastAPI()
    app.include_router(health_router)
    return app


@pytest.fixture()
def client(fastapi_app):
    """Synchronous test client for FastAPI health routes."""
    from fastapi.testclient import TestClient

    with TestClient(fastapi_app) as c:
        yield c


class TestRoot:
    def test_root(self, client):
        resp = client.get("/")
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Madrona API"
        assert "version" in data
        assert data["docs"] == "/api/_docs"


class TestHealth:
    def test_health(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        # /health intentionally returns only {status} — version and
        # canonical_validation_mode were removed to stop info leak (audit L3).
        assert data == {"status": "healthy"}


class TestSearchHealth:
    @patch("app.fastapi_app.routers.health.get_settings")
    def test_search_health_disabled(self, mock_settings, client):
        mock_settings.return_value = MagicMock(opensearch_enabled=False)
        resp = client.get("/health/search")
        assert resp.status_code == 200
        assert resp.json()["status"] == "disabled"

    @patch("app.search.client.is_opensearch_available", return_value=False)
    @patch("app.fastapi_app.routers.health.get_settings")
    def test_search_health_unavailable(self, mock_settings, mock_avail, client):
        mock_settings.return_value = MagicMock(opensearch_enabled=True)
        resp = client.get("/health/search")
        assert resp.status_code == 503
        assert resp.json()["status"] == "unavailable"

    @patch("app.search.client.get_opensearch_client")
    @patch("app.search.client.is_opensearch_available", return_value=True)
    @patch("app.fastapi_app.routers.health.get_settings")
    def test_search_health_healthy(self, mock_settings, mock_avail, mock_client, client):
        mock_settings.return_value = MagicMock(opensearch_enabled=True)
        mock_client.return_value.cluster.health.return_value = {
            "status": "green",
            "cluster_name": "test",
            "number_of_nodes": 1,
            "active_shards": 5,
            "relocating_shards": 0,
            "initializing_shards": 0,
            "unassigned_shards": 0,
        }
        resp = client.get("/health/search")
        assert resp.status_code == 200
        assert resp.json()["status"] == "green"


class TestDeepHealth:
    @patch("app.fastapi_app.routers.health.get_settings")
    def test_deep_health_all_healthy(self, mock_settings, fastapi_app, client):
        mock_settings.return_value = MagicMock(opensearch_enabled=False)

        mock_session = MagicMock()
        mock_pool = MagicMock()
        mock_pool.size.return_value = 5
        mock_pool.checkedin.return_value = 4
        mock_pool.checkedout.return_value = 1
        mock_pool.overflow.return_value = 0
        mock_bind = MagicMock()
        mock_bind.pool = mock_pool
        mock_session.get_bind.return_value = mock_bind

        mock_redis = MagicMock()
        mock_redis.is_available.return_value = True

        from app.database import get_db

        def _override_get_db():
            yield mock_session

        fastapi_app.dependency_overrides[get_db] = _override_get_db

        with patch("app.services.redis_client.get_redis_client", return_value=mock_redis):
            resp = client.get("/health/deep")

        fastapi_app.dependency_overrides.clear()

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "healthy"
        assert "checks" in data
        assert data["checks"]["database"]["status"] == "healthy"
        assert data["checks"]["redis"]["status"] == "healthy"


class TestMetrics:
    def test_metrics(self, client):
        resp = client.get("/metrics")
        assert resp.status_code == 200
        assert "text/plain" in resp.headers["content-type"]


class TestSecurityTxt:
    @patch("app.fastapi_app.routers.health.get_settings")
    def test_security_txt(self, mock_settings, client):
        mock_settings.return_value = MagicMock(
            security_contact="mailto:security@example.com",
            app_base_url="https://example.com",
        )
        resp = client.get("/.well-known/security.txt")
        assert resp.status_code == 200
        assert "text/plain" in resp.headers["content-type"]
        assert "Contact:" in resp.text
