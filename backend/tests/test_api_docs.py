"""
Tests for page documentation API endpoints.

Tests the CRUD operations for organization-scoped page documentation.
Uses the auth_setup fixture from conftest.py for authenticated requests.
"""

import pytest
from uuid import uuid4

from app.models import OrgScopedDoc


class TestDocsAPI:
    """Tests for the docs API endpoints."""

    @pytest.fixture
    def sample_doc(self, db_session, auth_setup):
        """Create a sample doc for testing."""
        auth_client, org, user = auth_setup
        doc = OrgScopedDoc(
            organization_id=org.organization_id,
            page_key="runs.list",
            title="Run History",
            summary="View and manage pipeline runs",
            body_markdown="## Overview\n\nThis page shows all pipeline runs.",
            audience="all",
            created_by=user.user_id,
        )
        db_session.add(doc)
        db_session.commit()
        return doc

    # =========================================================================
    # GET /api/docs tests
    # =========================================================================

    def test_get_doc_success(self, auth_setup, db_session, sample_doc):
        """Test getting a doc by page key."""
        auth_client, org, user = auth_setup

        response = auth_client.get("/api/docs?pageKey=runs.list")

        assert response.status_code == 200
        data = response.get_json()
        assert data["doc"] is not None
        assert data["doc"]["page_key"] == "runs.list"
        assert data["doc"]["title"] == "Run History"
        assert data["doc"]["body_markdown"] == "## Overview\n\nThis page shows all pipeline runs."

    def test_get_doc_not_found(self, auth_setup, db_session):
        """Test getting a doc that doesn't exist returns null."""
        auth_client, org, user = auth_setup

        response = auth_client.get("/api/docs?pageKey=runs.list")

        assert response.status_code == 200
        data = response.get_json()
        assert data["doc"] is None

    def test_get_doc_missing_page_key(self, auth_setup, db_session):
        """Test getting a doc without pageKey returns 400."""
        auth_client, org, user = auth_setup

        response = auth_client.get("/api/docs")

        assert response.status_code in (400, 422)
        data = response.get_json()
        assert (data.get("error", {}).get("code") in ("bad_request", "validation_error", "missing_page_key") or data.get("detail"))

    def test_get_doc_requires_auth(self, client, db_session):
        """Test that get doc requires authentication."""
        response = client.get("/api/docs?pageKey=runs.list")
        assert response.status_code == 401

    # =========================================================================
    # POST /api/docs tests
    # =========================================================================

    def test_create_doc_success(self, auth_setup, db_session):
        """Test creating a new doc."""
        auth_client, org, user = auth_setup
        doc_data = {
            "page_key": "datasets.list",
            "title": "Datasets",
            "summary": "View all datasets",
            "body_markdown": "## Datasets\n\nThis page shows all datasets.",
            "audience": "all",
        }

        response = auth_client.post(
            "/api/docs",
            json=doc_data,
            content_type="application/json",
        )

        assert response.status_code == 201
        data = response.get_json()
        assert data["doc"]["page_key"] == "datasets.list"
        assert data["doc"]["title"] == "Datasets"
        assert data["doc"]["created_by"] == str(user.user_id)

    def test_create_doc_missing_fields(self, auth_setup, db_session):
        """Test creating doc with missing required fields."""
        auth_client, org, user = auth_setup
        doc_data = {
            "page_key": "datasets.list",
            # Missing title and body_markdown
        }

        response = auth_client.post(
            "/api/docs",
            json=doc_data,
            content_type="application/json",
        )

        assert response.status_code in (400, 422)
        data = response.get_json()
        assert (data.get("error", {}).get("code") in ("bad_request", "validation_error", "missing_fields") or data.get("detail"))

    def test_create_doc_invalid_page_key(self, auth_setup, db_session):
        """Test creating doc with invalid page key."""
        auth_client, org, user = auth_setup
        doc_data = {
            "page_key": "invalid.page.key",
            "title": "Invalid",
            "body_markdown": "Content",
        }

        response = auth_client.post(
            "/api/docs",
            json=doc_data,
            content_type="application/json",
        )

        assert response.status_code in (400, 422)
        data = response.get_json()
        assert (data.get("error", {}).get("code") in ("bad_request", "validation_error", "invalid_page_key") or data.get("detail"))

    def test_create_doc_invalid_audience(self, auth_setup, db_session):
        """Test creating doc with invalid audience."""
        auth_client, org, user = auth_setup
        doc_data = {
            "page_key": "datasets.list",
            "title": "Datasets",
            "body_markdown": "Content",
            "audience": "invalid_audience",
        }

        response = auth_client.post(
            "/api/docs",
            json=doc_data,
            content_type="application/json",
        )

        assert response.status_code in (400, 422)
        data = response.get_json()
        assert (data.get("error", {}).get("code") in ("bad_request", "validation_error", "invalid_audience") or data.get("detail"))

    # =========================================================================
    # PUT /api/docs/{id} tests
    # =========================================================================

    def test_update_doc_success(self, auth_setup, db_session, sample_doc):
        """Test updating an existing doc."""
        auth_client, org, user = auth_setup
        update_data = {
            "title": "Updated Title",
            "body_markdown": "## Updated Content",
        }

        response = auth_client.put(
            f"/api/docs/{sample_doc.doc_id}",
            json=update_data,
            content_type="application/json",
        )

        assert response.status_code == 200
        data = response.get_json()
        assert data["doc"]["title"] == "Updated Title"
        assert data["doc"]["body_markdown"] == "## Updated Content"
        assert data["doc"]["page_key"] == "runs.list"

    def test_update_doc_not_found(self, auth_setup, db_session):
        """Test updating non-existent doc returns 404."""
        auth_client, org, user = auth_setup
        fake_id = str(uuid4())
        update_data = {"title": "New Title"}

        response = auth_client.put(
            f"/api/docs/{fake_id}",
            json=update_data,
            content_type="application/json",
        )

        assert response.status_code == 404

    def test_update_doc_invalid_audience(self, auth_setup, db_session, sample_doc):
        """Test updating doc with invalid audience."""
        auth_client, org, user = auth_setup
        update_data = {"audience": "invalid"}

        response = auth_client.put(
            f"/api/docs/{sample_doc.doc_id}",
            json=update_data,
            content_type="application/json",
        )

        assert response.status_code in (400, 422)
        data = response.get_json()
        assert (data.get("error", {}).get("code") in ("bad_request", "validation_error", "invalid_audience") or data.get("detail"))

    # =========================================================================
    # DELETE /api/docs/{id} tests
    # =========================================================================

    def test_delete_doc_success(self, auth_setup, db_session, sample_doc):
        """Test deleting a doc."""
        auth_client, org, user = auth_setup
        doc_id = sample_doc.doc_id

        response = auth_client.delete(f"/api/docs/{doc_id}")

        assert response.status_code == 200
        data = response.get_json()
        assert data["success"] is True
        assert data["deleted_page_key"] == "runs.list"

    def test_delete_doc_not_found(self, auth_setup, db_session):
        """Test deleting non-existent doc returns 404."""
        auth_client, org, user = auth_setup
        fake_id = str(uuid4())

        response = auth_client.delete(f"/api/docs/{fake_id}")

        assert response.status_code == 404

    # =========================================================================
    # GET /api/docs/keys tests
    # =========================================================================

    def test_list_page_keys(self, auth_setup, db_session):
        """Test listing valid page keys."""
        auth_client, org, user = auth_setup

        response = auth_client.get("/api/docs/keys")

        assert response.status_code == 200
        data = response.get_json()
        assert "page_keys" in data
        assert isinstance(data["page_keys"], list)
        assert "runs.list" in data["page_keys"]
        assert "runs.detail" in data["page_keys"]
        assert "datasets.list" in data["page_keys"]

    # =========================================================================
    # GET /api/docs/all tests
    # =========================================================================

    def test_list_all_docs_admin(self, auth_setup, db_session, sample_doc):
        """Test listing all docs (admin only)."""
        auth_client, org, user = auth_setup

        # Create another doc
        doc2 = OrgScopedDoc(
            organization_id=org.organization_id,
            page_key="datasets.list",
            title="Datasets",
            body_markdown="Content",
            audience="all",
            created_by=user.user_id,
        )
        db_session.add(doc2)
        db_session.commit()

        response = auth_client.get("/api/docs/all")

        assert response.status_code == 200
        data = response.get_json()
        assert "docs" in data
        assert len(data["docs"]) == 2

    def test_list_all_docs_viewer_forbidden(self, viewer_auth_setup, db_session):
        """Test that viewer cannot list all docs."""
        auth_client, org, user = viewer_auth_setup

        response = auth_client.get("/api/docs/all")

        assert response.status_code == 403
