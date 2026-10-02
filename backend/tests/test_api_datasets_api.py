"""
Smoke tests for the Datasets API.

Routes under /api/datasets.
Tests cover CRUD operations for datasets (list, create, get, update)
plus auth checks and not-found handling.
"""

import json
from uuid import uuid4

import pytest

from app.models import Dataset


def _post_json(auth_client, url, data):
    """Helper for POST with JSON body."""
    return auth_client.post(url, data=json.dumps(data), content_type="application/json")


def _patch_json(auth_client, url, data):
    """Helper for PATCH with JSON body."""
    return auth_client.patch(url, data=json.dumps(data), content_type="application/json")


def _create_test_dataset(db_session, org_id, name="Test Dataset", key="test-ds"):
    """Create a Dataset directly in the DB for tests."""
    ds = Dataset(
        organization_id=org_id,
        name=name,
        key=key,
        description="A test dataset",
        source_type="test_source",
    )
    db_session.add(ds)
    db_session.commit()
    db_session.refresh(ds)
    return ds


# ============================================================================
# List Datasets
# ============================================================================


class TestListDatasets:
    def test_list_datasets_empty(self, auth_setup, db_session):
        """Listing datasets when none exist returns empty list."""
        auth_client, org, _ = auth_setup
        url = f"/api/datasets?organization_id={org.organization_id}"

        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["items"] == []
        assert data["total"] == 0

    def test_list_datasets_with_data(self, auth_setup, db_session):
        """Listing datasets returns all datasets for the organization."""
        auth_client, org, _ = auth_setup
        _create_test_dataset(db_session, org.organization_id, name="Dataset A", key="ds-a")
        _create_test_dataset(db_session, org.organization_id, name="Dataset B", key="ds-b")

        url = f"/api/datasets?organization_id={org.organization_id}"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 2
        assert len(data["items"]) == 2
        names = {d["name"] for d in data["items"]}
        assert names == {"Dataset A", "Dataset B"}


# ============================================================================
# Create Dataset
# ============================================================================


class TestCreateDataset:
    def test_create_dataset(self, auth_setup, db_session):
        """Creating a dataset with valid data returns 201."""
        auth_client, org, _ = auth_setup
        url = "/api/datasets"

        payload = {
            "organization_id": str(org.organization_id),
            "name": "New Collection",
            "key": "new-collection",
            "description": "Freshly created dataset",
            "source_type": "manual",
        }
        resp = _post_json(auth_client, url, payload)
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["name"] == "New Collection"
        assert data["key"] == "new-collection"
        assert data["organization_id"] == str(org.organization_id)
        assert "dataset_id" in data
        assert data["description"] == "Freshly created dataset"
        assert data["source_type"] == "manual"

    def test_create_dataset_missing_fields(self, auth_setup, db_session):
        """Creating a dataset without required fields returns 400."""
        auth_client, org, _ = auth_setup
        url = "/api/datasets"

        # Missing 'name' and 'key'
        payload = {"organization_id": str(org.organization_id)}
        resp = _post_json(auth_client, url, payload)
        assert resp.status_code in (400, 422)
        data = resp.get_json()
        assert (data.get("error", {}).get("code") in ("bad_request", "validation_error", "missing_fields") or data.get("detail"))


# ============================================================================
# Get Dataset by ID
# ============================================================================


class TestGetDataset:
    def test_get_dataset(self, auth_setup, db_session):
        """Getting a dataset by ID returns the correct dataset."""
        auth_client, org, _ = auth_setup
        ds = _create_test_dataset(db_session, org.organization_id, name="Objects", key="objects")

        url = f"/api/datasets/{ds.dataset_id}"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["dataset_id"] == str(ds.dataset_id)
        assert data["name"] == "Objects"
        assert data["key"] == "objects"

    def test_get_dataset_not_found(self, auth_setup):
        """Getting a non-existent dataset returns 404."""
        auth_client, org, _ = auth_setup
        fake_id = uuid4()

        url = f"/api/datasets/{fake_id}"
        resp = auth_client.get(url)
        assert resp.status_code == 404
        data = resp.get_json()
        assert data.get("error", {}).get("code", "").lower() == "not_found"


# ============================================================================
# Update Dataset
# ============================================================================


class TestUpdateDataset:
    def test_update_dataset(self, auth_setup, db_session):
        """Updating a dataset name and description succeeds."""
        auth_client, org, _ = auth_setup
        ds = _create_test_dataset(db_session, org.organization_id, name="Old Name", key="upd-ds")

        url = f"/api/datasets/{ds.dataset_id}"
        resp = _patch_json(auth_client, url, {"name": "New Name", "description": "Updated"})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["name"] == "New Name"
        assert data["description"] == "Updated"

    def test_update_dataset_not_found(self, auth_setup):
        """Updating a non-existent dataset returns 404."""
        auth_client, org, _ = auth_setup
        fake_id = uuid4()

        url = f"/api/datasets/{fake_id}"
        resp = _patch_json(auth_client, url, {"name": "Ghost"})
        assert resp.status_code == 404


# ============================================================================
# Authorization
# ============================================================================


class TestDatasetsAuth:
    def test_list_requires_auth(self, client):
        """Unauthenticated request to list datasets returns 401."""
        resp = client.get("/api/datasets")
        assert resp.status_code == 401

    def test_create_requires_auth(self, client):
        """Unauthenticated request to create a dataset returns 401."""
        resp = client.post(
            "/api/datasets",
            data=json.dumps({"organization_id": str(uuid4()), "name": "x", "key": "x"}),
            content_type="application/json",
        )
        assert resp.status_code == 401

    def test_get_requires_auth(self, client):
        """Unauthenticated request to get a dataset returns 401."""
        resp = client.get(f"/api/datasets/{uuid4()}")
        assert resp.status_code == 401
