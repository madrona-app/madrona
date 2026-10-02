"""
Smoke tests for the Transformers API.

Routes under /api/datasets/<dataset_id>/transformers and /api/datasets/transformers/<id>.
Tests cover list, get-by-format, update, activate, delete, auth checks, and not-found handling.

The generate endpoint is excluded from smoke tests because it calls an external AI service.
"""

import json
from datetime import datetime, timezone
from uuid import uuid4

import pytest

from app.models import Dataset, DatasetTransformer


def _post_json(auth_client, url, data):
    """Helper for POST with JSON body."""
    return auth_client.post(url, data=json.dumps(data), content_type="application/json")


def _put_json(auth_client, url, data):
    """Helper for PUT with JSON body."""
    return auth_client.put(url, data=json.dumps(data), content_type="application/json")


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


def _create_test_transformer(
    db_session,
    dataset_id,
    org_id,
    target_format="dublin-core",
    status="draft",
    code="def transform(payload): return payload",
):
    """Create a DatasetTransformer directly in the DB for tests."""
    t = DatasetTransformer(
        dataset_id=dataset_id,
        organization_id=org_id,
        target_format=target_format,
        transformer_code=code,
        status=status,
        ai_provider="test",
        sample_count=3,
    )
    db_session.add(t)
    db_session.commit()
    db_session.refresh(t)
    return t


# ============================================================================
# List Transformers
# ============================================================================


class TestListTransformers:
    def test_list_transformers_empty(self, auth_setup, db_session):
        """Listing transformers for a dataset with none returns empty list."""
        auth_client, org, _ = auth_setup
        ds = _create_test_dataset(db_session, org.organization_id)

        url = f"/api/datasets/{ds.dataset_id}/transformers"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["transformers"] == []

    def test_list_transformers_with_data(self, auth_setup, db_session):
        """Listing transformers returns all transformers for the dataset."""
        auth_client, org, _ = auth_setup
        ds = _create_test_dataset(db_session, org.organization_id)
        _create_test_transformer(db_session, ds.dataset_id, org.organization_id, target_format="dublin-core")
        _create_test_transformer(db_session, ds.dataset_id, org.organization_id, target_format="lido")

        url = f"/api/datasets/{ds.dataset_id}/transformers"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data["transformers"]) == 2
        formats = {t["target_format"] for t in data["transformers"]}
        assert formats == {"dublin-core", "lido"}

    def test_list_transformers_filter_by_status(self, auth_setup, db_session):
        """Listing transformers with status filter returns only matching."""
        auth_client, org, _ = auth_setup
        ds = _create_test_dataset(db_session, org.organization_id)
        _create_test_transformer(db_session, ds.dataset_id, org.organization_id, target_format="dublin-core", status="draft")
        _create_test_transformer(db_session, ds.dataset_id, org.organization_id, target_format="lido", status="active")

        url = f"/api/datasets/{ds.dataset_id}/transformers?status=draft"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data["transformers"]) == 1
        assert data["transformers"][0]["target_format"] == "dublin-core"

    def test_list_transformers_dataset_not_found(self, auth_setup):
        """Listing transformers for a non-existent dataset returns 404."""
        auth_client, _, _ = auth_setup
        fake_id = uuid4()

        url = f"/api/datasets/{fake_id}/transformers"
        resp = auth_client.get(url)
        assert resp.status_code == 404


# ============================================================================
# Get Transformer by Format
# ============================================================================


class TestGetTransformer:
    def test_get_active_transformer(self, auth_setup, db_session):
        """Getting an active transformer by format returns it with code."""
        auth_client, org, _ = auth_setup
        ds = _create_test_dataset(db_session, org.organization_id)
        t = _create_test_transformer(
            db_session, ds.dataset_id, org.organization_id,
            target_format="dublin-core", status="active",
        )

        url = f"/api/datasets/{ds.dataset_id}/transformers/dublin-core"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["transformer_id"] == str(t.transformer_id)
        assert data["target_format"] == "dublin-core"
        assert data["status"] == "active"
        assert "transformer_code" in data

    def test_get_transformer_not_found(self, auth_setup, db_session):
        """Getting a transformer for a format with no active transformer returns 404."""
        auth_client, org, _ = auth_setup
        ds = _create_test_dataset(db_session, org.organization_id)
        # Create a draft transformer -- the endpoint only returns active ones
        _create_test_transformer(
            db_session, ds.dataset_id, org.organization_id,
            target_format="dublin-core", status="draft",
        )

        url = f"/api/datasets/{ds.dataset_id}/transformers/dublin-core"
        resp = auth_client.get(url)
        assert resp.status_code == 404


# ============================================================================
# Update Transformer
# ============================================================================


class TestUpdateTransformer:
    def test_update_transformer_code(self, auth_setup, db_session):
        """Updating a transformer's code succeeds."""
        auth_client, org, _ = auth_setup
        ds = _create_test_dataset(db_session, org.organization_id)
        t = _create_test_transformer(db_session, ds.dataset_id, org.organization_id)

        url = f"/api/datasets/transformers/{t.transformer_id}"
        new_code = "def transform(payload): return {'title': payload.get('name')}"
        resp = _put_json(auth_client, url, {"transformer_code": new_code})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["updated"] is True
        assert data["transformer_id"] == str(t.transformer_id)

    def test_update_transformer_not_found(self, auth_setup):
        """Updating a non-existent transformer returns 404."""
        auth_client, _, _ = auth_setup
        fake_id = uuid4()

        url = f"/api/datasets/transformers/{fake_id}"
        resp = _put_json(auth_client, url, {"transformer_code": "def transform(p): pass"})
        assert resp.status_code == 404

    def test_update_transformer_missing_code(self, auth_setup, db_session):
        """Updating without transformer_code returns 400."""
        auth_client, org, _ = auth_setup
        ds = _create_test_dataset(db_session, org.organization_id)
        t = _create_test_transformer(db_session, ds.dataset_id, org.organization_id)

        url = f"/api/datasets/transformers/{t.transformer_id}"
        resp = _put_json(auth_client, url, {})
        assert resp.status_code in (400, 422)


# ============================================================================
# Activate Transformer
# ============================================================================


class TestActivateTransformer:
    def test_activate_draft_transformer(self, auth_setup, db_session):
        """Activating a draft transformer sets status to active."""
        auth_client, org, _ = auth_setup
        ds = _create_test_dataset(db_session, org.organization_id)
        t = _create_test_transformer(
            db_session, ds.dataset_id, org.organization_id,
            target_format="dublin-core", status="draft",
        )

        url = f"/api/datasets/transformers/{t.transformer_id}/activate"
        resp = auth_client.post(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "active"
        assert data["activated_at"] is not None

    def test_activate_already_active(self, auth_setup, db_session):
        """Activating an already-active transformer returns 400."""
        auth_client, org, _ = auth_setup
        ds = _create_test_dataset(db_session, org.organization_id)
        t = _create_test_transformer(
            db_session, ds.dataset_id, org.organization_id,
            target_format="dublin-core", status="active",
        )

        url = f"/api/datasets/transformers/{t.transformer_id}/activate"
        resp = auth_client.post(url)
        assert resp.status_code in (400, 422)

    def test_activate_not_found(self, auth_setup):
        """Activating a non-existent transformer returns 404."""
        auth_client, _, _ = auth_setup
        fake_id = uuid4()

        url = f"/api/datasets/transformers/{fake_id}/activate"
        resp = auth_client.post(url)
        assert resp.status_code == 404


# ============================================================================
# Delete Transformer
# ============================================================================


class TestDeleteTransformer:
    def test_delete_draft_transformer(self, auth_setup, db_session):
        """Deleting a draft transformer succeeds."""
        auth_client, org, _ = auth_setup
        ds = _create_test_dataset(db_session, org.organization_id)
        t = _create_test_transformer(
            db_session, ds.dataset_id, org.organization_id,
            target_format="dublin-core", status="draft",
        )

        url = f"/api/datasets/transformers/{t.transformer_id}"
        resp = auth_client.delete(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["deleted"] is True

    def test_delete_active_transformer_rejected(self, auth_setup, db_session):
        """Deleting an active transformer returns 400."""
        auth_client, org, _ = auth_setup
        ds = _create_test_dataset(db_session, org.organization_id)
        t = _create_test_transformer(
            db_session, ds.dataset_id, org.organization_id,
            target_format="dublin-core", status="active",
        )

        url = f"/api/datasets/transformers/{t.transformer_id}"
        resp = auth_client.delete(url)
        assert resp.status_code in (400, 422)

    def test_delete_not_found(self, auth_setup):
        """Deleting a non-existent transformer returns 404."""
        auth_client, _, _ = auth_setup
        fake_id = uuid4()

        url = f"/api/datasets/transformers/{fake_id}"
        resp = auth_client.delete(url)
        assert resp.status_code == 404


# ============================================================================
# Authorization
# ============================================================================


class TestTransformersAuth:
    def test_list_requires_auth(self, client):
        """Unauthenticated request to list transformers returns 401."""
        fake_id = uuid4()
        resp = client.get(f"/api/datasets/{fake_id}/transformers")
        assert resp.status_code == 401

    def test_get_requires_auth(self, client):
        """Unauthenticated request to get a transformer returns 401."""
        fake_id = uuid4()
        resp = client.get(f"/api/datasets/{fake_id}/transformers/dublin-core")
        assert resp.status_code == 401

    def test_update_requires_auth(self, client):
        """Unauthenticated request to update a transformer returns 401."""
        fake_id = uuid4()
        resp = client.put(
            f"/api/datasets/transformers/{fake_id}",
            data=json.dumps({"transformer_code": "def transform(p): pass"}),
            content_type="application/json",
        )
        assert resp.status_code == 401

    def test_activate_requires_auth(self, client):
        """Unauthenticated request to activate a transformer returns 401."""
        fake_id = uuid4()
        resp = client.post(f"/api/datasets/transformers/{fake_id}/activate")
        assert resp.status_code == 401

    def test_delete_requires_auth(self, client):
        """Unauthenticated request to delete a transformer returns 401."""
        fake_id = uuid4()
        resp = client.delete(f"/api/datasets/transformers/{fake_id}")
        assert resp.status_code == 401
