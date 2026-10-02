"""
Tests for the FastAPI public DAM API endpoints.

Tests the 7 endpoints migrated from the Flask dam_public blueprint.
"""

import uuid
from datetime import datetime, timezone
from unittest.mock import patch

import pytest

from app.database import get_admin_db, get_db
from app.services.auth_utils import hash_api_key, generate_api_key


@pytest.fixture(scope="session")
def fastapi_app():
    """Create a minimal FastAPI app with just the DAM public router.

    Does NOT mount the Flask app (avoids double-creation conflicts with
    the session-scoped Flask ``app`` fixture from conftest.py).
    """
    from fastapi import FastAPI
    from app.fastapi_app.routers.dam_public import router as dam_public_router

    app = FastAPI()
    app.include_router(dam_public_router, prefix="/public/v1")
    return app


@pytest.fixture()
def fastapi_client(fastapi_app, app, db_session):
    """
    Synchronous test client for FastAPI.

    Overrides get_db to use the test db_session (Flask-SQLAlchemy session
    backed by SQLite in-memory).
    """
    from fastapi.testclient import TestClient

    def _override_session():
        # The dam_public router was flipped from get_db to
        # get_admin_db (May 14 2026) so that public DAM access works
        # under strict RLS — the SQL-level is_published filter is the
        # real access control. Wire both names back to db_session in
        # tests.
        yield db_session

    fastapi_app.dependency_overrides[get_db] = _override_session
    fastapi_app.dependency_overrides[get_admin_db] = _override_session

    with TestClient(fastapi_app) as client:
        yield client

    fastapi_app.dependency_overrides.clear()


@pytest.fixture()
def org_and_key(db_session):
    """Create a test organization and API key."""
    from app.models import Organization, APIKey

    org = Organization(
        name="Test Public API Org",
        slug="test-public-api",
        is_demo=False,
        status="active",
    )
    db_session.add(org)
    db_session.flush()

    raw_key = generate_api_key()
    api_key = APIKey(
        organization_id=org.organization_id,
        name="Test Key",
        key_prefix=raw_key[:8],
        key_hash=hash_api_key(raw_key),
        scopes={"media.view": True, "media.edit": True},
        status="active",
    )
    db_session.add(api_key)
    db_session.commit()

    return org, raw_key


# =============================================================================
# Auth tests
# =============================================================================

class TestAuth:
    """Test API key authentication."""

    def test_missing_api_key_returns_422(self, fastapi_client, org_and_key):
        org, _ = org_and_key
        resp = fastapi_client.get(f"/public/v1/{org.organization_id}/media")
        assert resp.status_code == 422

    def test_invalid_api_key_returns_401(self, fastapi_client, org_and_key):
        org, _ = org_and_key
        resp = fastapi_client.get(
            f"/public/v1/{org.organization_id}/media",
            headers={"X-API-Key": "mkey_invalid_key_value_here_1234567890ab"},
        )
        assert resp.status_code == 401

    def test_wrong_org_returns_403(self, fastapi_client, org_and_key):
        _, raw_key = org_and_key
        wrong_org_id = uuid.uuid4()
        resp = fastapi_client.get(
            f"/public/v1/{wrong_org_id}/media",
            headers={"X-API-Key": raw_key},
        )
        assert resp.status_code == 403


# =============================================================================
# Media endpoint tests
# =============================================================================

class TestMediaEndpoints:
    """Test media listing and detail endpoints."""

    def test_list_media_empty(self, fastapi_client, org_and_key):
        org, raw_key = org_and_key
        resp = fastapi_client.get(
            f"/public/v1/{org.organization_id}/media",
            headers={"X-API-Key": raw_key},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["data"] == []
        assert data["pagination"]["total"] == 0

    def test_list_media_with_items(self, fastapi_client, org_and_key, db_session):
        org, raw_key = org_and_key
        from app.models import Media

        media = Media(
            organization_id=org.organization_id,
            title="Test Image",
            media_type="image",
            mime_type="image/jpeg",
            is_published=True,
            file_size=1024,
            s3_key="orgs/test/media/images/test_image.jpg",
            filename="test_image.jpg",
        )
        db_session.add(media)
        db_session.commit()

        resp = fastapi_client.get(
            f"/public/v1/{org.organization_id}/media",
            headers={"X-API-Key": raw_key},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["pagination"]["total"] >= 1
        assert data["data"][0]["title"] == "Test Image"

    def test_get_media_not_found(self, fastapi_client, org_and_key):
        org, raw_key = org_and_key
        fake_id = uuid.uuid4()
        resp = fastapi_client.get(
            f"/public/v1/{org.organization_id}/media/{fake_id}",
            headers={"X-API-Key": raw_key},
        )
        assert resp.status_code == 404


# =============================================================================
# Object endpoint tests
# =============================================================================

class TestObjectEndpoints:
    """Test object listing and detail endpoints."""

    def test_list_objects_empty(self, fastapi_client, org_and_key):
        org, raw_key = org_and_key
        resp = fastapi_client.get(
            f"/public/v1/{org.organization_id}/objects",
            headers={"X-API-Key": raw_key},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["data"] == []
        assert data["pagination"]["total"] == 0

    def test_get_object_not_found(self, fastapi_client, org_and_key):
        org, raw_key = org_and_key
        fake_id = uuid.uuid4()
        resp = fastapi_client.get(
            f"/public/v1/{org.organization_id}/objects/{fake_id}",
            headers={"X-API-Key": raw_key},
        )
        assert resp.status_code == 404

    def test_get_object_media_not_found(self, fastapi_client, org_and_key):
        org, raw_key = org_and_key
        fake_id = uuid.uuid4()
        resp = fastapi_client.get(
            f"/public/v1/{org.organization_id}/objects/{fake_id}/media",
            headers={"X-API-Key": raw_key},
        )
        assert resp.status_code == 404


# =============================================================================
# Sync endpoint tests
# =============================================================================

class TestSyncEndpoint:
    """Test the sync endpoint."""

    def test_sync_requires_since(self, fastapi_client, org_and_key):
        org, raw_key = org_and_key
        resp = fastapi_client.get(
            f"/public/v1/{org.organization_id}/sync",
            headers={"X-API-Key": raw_key},
        )
        assert resp.status_code in (400, 422)

    def test_sync_invalid_since(self, fastapi_client, org_and_key):
        org, raw_key = org_and_key
        resp = fastapi_client.get(
            f"/public/v1/{org.organization_id}/sync?since=not-a-date",
            headers={"X-API-Key": raw_key},
        )
        assert resp.status_code in (400, 422)

    def test_sync_valid(self, fastapi_client, org_and_key):
        org, raw_key = org_and_key
        resp = fastapi_client.get(
            f"/public/v1/{org.organization_id}/sync?since=2020-01-01T00:00:00Z",
            headers={"X-API-Key": raw_key},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "data" in data
        assert "sync" in data
        assert data["sync"]["since"] == "2020-01-01T00:00:00Z"


# =============================================================================
# IIIF endpoint tests
# =============================================================================

class TestIIIFEndpoint:
    """Test IIIF manifest endpoint."""

    def test_iiif_object_not_found(self, fastapi_client, org_and_key):
        org, raw_key = org_and_key
        fake_id = uuid.uuid4()
        resp = fastapi_client.get(
            f"/public/v1/{org.organization_id}/iiif/{fake_id}/manifest.json",
            headers={"X-API-Key": raw_key},
        )
        assert resp.status_code == 404
