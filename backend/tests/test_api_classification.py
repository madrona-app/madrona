"""
Smoke tests for the Classification API endpoints.

Routes under /api/datasets/<id>/classify, /api/entities/<key>/classify,
/api/datasets/<id>/classification-status, /api/organizations/<id>/classify-all,
and /api/classification/stats.

Mocks Celery tasks so tests run against SQLite without a broker.
"""

import json
from datetime import datetime, timezone
from unittest.mock import patch, MagicMock
from uuid import uuid4

import pytest

from app.database import current_session
from app.models import Dataset, EntityCurrent


# Removed 2026-04-26: a module-level
# `EntityCurrent.entity_current_id = EntityCurrent.entity_key` monkey-patch
# lived here as a SQLite workaround for `func.count()`. It poisoned every
# postgres test that ran after this file was imported by appending a column
# attribute that SQLAlchemy then folded into mapper config. The classification
# router no longer references `entity_current_id` and the suite runs on
# Postgres now, so the workaround is dead.


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _post_json(auth_client, url, data):
    """Helper for POST with JSON body."""
    return auth_client.post(url, data=json.dumps(data), content_type="application/json")


def _create_dataset(db_session, org_id, name="Test Dataset", key="test-dataset"):
    """Create a Dataset row and return it."""
    dataset = Dataset(
        organization_id=org_id,
        name=name,
        key=key,
    )
    db_session.add(dataset)
    db_session.commit()
    return dataset


def _create_entity(db_session, org_id, dataset_id=None, entity_key="src:1:abc",
                   entity_type="museum_object", is_deleted=False):
    """Create an EntityCurrent row and return it."""
    now = datetime.now(timezone.utc)
    entity = EntityCurrent(
        organization_id=org_id,
        entity_key=entity_key,
        dataset_id=dataset_id,
        entity_type=entity_type,
        source_system="test",
        source_id=entity_key.split(":")[-1] if ":" in entity_key else entity_key,
        payload={"title": "Test Entity"},
        payload_hash="abc123",
        sources={},
        extracted_at=now,
        last_seen_at=now,
        is_deleted=is_deleted,
    )
    db_session.add(entity)
    db_session.commit()
    return entity


# ---------------------------------------------------------------------------
# Dataset classify  (POST /api/datasets/<id>/classify)
# ---------------------------------------------------------------------------

class TestClassifyDataset:

    @patch("app.fastapi_app.routers.classification.classify_dataset_task")
    def test_classify_dataset_queues_task(self, mock_task, auth_setup):
        """POST /api/datasets/<id>/classify returns 202 and queues a task."""
        auth_client, org, _ = auth_setup
        dataset = _create_dataset(current_session(), org.organization_id)

        mock_task.delay.return_value = MagicMock(id="task-123")

        url = f"/api/datasets/{dataset.dataset_id}/classify"
        resp = _post_json(auth_client, url, {})

        assert resp.status_code == 202
        data = resp.get_json()
        assert data["dataset_id"] == str(dataset.dataset_id)
        assert data["task_id"] == "task-123"
        assert data["message"] == "Classification tasks queued"
        mock_task.delay.assert_called_once()

    def test_classify_dataset_not_found(self, auth_setup):
        """POST /api/datasets/<missing>/classify returns 404."""
        auth_client, org, _ = auth_setup
        fake_id = str(uuid4())

        url = f"/api/datasets/{fake_id}/classify"
        resp = _post_json(auth_client, url, {})

        assert resp.status_code == 404
        data = resp.get_json()
        assert data.get("error", {}).get("code") in ("not_found", "dataset_not_found")

    def test_classify_dataset_requires_auth(self, client, auth_setup):
        """POST /api/datasets/<id>/classify without auth returns 401."""
        _, org, _ = auth_setup
        fake_id = str(uuid4())
        url = f"/api/datasets/{fake_id}/classify"
        resp = client.post(url, data=json.dumps({}), content_type="application/json")
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Entity classify  (POST /api/entities/<entity_key>/classify)
# ---------------------------------------------------------------------------

class TestClassifyEntity:

    @patch("app.fastapi_app.routers.classification.classify_entity_task")
    def test_classify_entity_queues_task(self, mock_task, auth_setup):
        """POST /api/entities/<key>/classify returns 202 and queues a task."""
        auth_client, org, _ = auth_setup
        entity = _create_entity(current_session(), org.organization_id, entity_key="src:1:obj1")

        mock_task.delay.return_value = MagicMock(id="task-456")

        url = f"/api/entities/{entity.entity_key}/classify?organization_id={org.organization_id}"
        resp = _post_json(auth_client, url, {})

        assert resp.status_code == 202
        data = resp.get_json()
        assert data["entity_key"] == entity.entity_key
        assert data["task_id"] == "task-456"
        assert data["message"] == "Classification task queued"
        mock_task.delay.assert_called_once()

    def test_classify_entity_not_found(self, auth_setup):
        """POST /api/entities/<missing>/classify returns 404."""
        auth_client, org, _ = auth_setup

        url = f"/api/entities/nonexistent:key/classify?organization_id={org.organization_id}"
        resp = _post_json(auth_client, url, {})

        assert resp.status_code == 404
        data = resp.get_json()
        assert data.get("error", {}).get("code") in ("not_found", "entity_not_found")

    def test_classify_entity_missing_org_id(self, auth_setup):
        """POST /api/entities/<key>/classify without organization_id returns 400."""
        auth_client, org, _ = auth_setup

        url = "/api/entities/some:key/classify"
        resp = _post_json(auth_client, url, {})

        assert resp.status_code in (400, 422)
        data = resp.get_json()
        assert (data.get("error", {}).get("code") in ("bad_request", "validation_error", "missing_organization_id") or data.get("detail"))

    def test_classify_entity_requires_auth(self, client, auth_setup):
        """POST /api/entities/<key>/classify without auth returns 401."""
        _, org, _ = auth_setup
        url = f"/api/entities/key/classify?organization_id={org.organization_id}"
        resp = client.post(url, data=json.dumps({}), content_type="application/json")
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Dataset classification status  (GET /api/datasets/<id>/classification-status)
# ---------------------------------------------------------------------------

class TestDatasetClassificationStatus:

    def test_status_empty_dataset(self, auth_setup):
        """GET classification-status for dataset with no entities."""
        auth_client, org, _ = auth_setup
        dataset = _create_dataset(current_session(), org.organization_id, key="status-empty")

        url = f"/api/datasets/{dataset.dataset_id}/classification-status"
        resp = auth_client.get(url)

        assert resp.status_code == 200
        data = resp.get_json()
        assert data["dataset_id"] == str(dataset.dataset_id)
        assert data["total"] == 0
        assert data["by_type"] == {}
        assert data["unclassified_count"] == 0
        assert data["classification_complete"] is True  # 0 unclassified == complete

    def test_status_with_entities(self, auth_setup):
        """GET classification-status returns type distribution."""
        auth_client, org, _ = auth_setup
        dataset = _create_dataset(current_session(), org.organization_id, key="status-with")

        _create_entity(current_session(), org.organization_id, dataset.dataset_id,
                       entity_key="src:1:a", entity_type="museum_object")
        _create_entity(current_session(), org.organization_id, dataset.dataset_id,
                       entity_key="src:1:b", entity_type="museum_object")
        _create_entity(current_session(), org.organization_id, dataset.dataset_id,
                       entity_key="src:1:c", entity_type="unclassified")

        url = f"/api/datasets/{dataset.dataset_id}/classification-status"
        resp = auth_client.get(url)

        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 3
        assert data["by_type"]["museum_object"] == 2
        assert data["by_type"]["unclassified"] == 1
        assert data["unclassified_count"] == 1
        assert data["classification_complete"] is False

    def test_status_dataset_not_found(self, auth_setup):
        """GET classification-status for missing dataset returns 404."""
        auth_client, org, _ = auth_setup
        fake_id = str(uuid4())

        url = f"/api/datasets/{fake_id}/classification-status"
        resp = auth_client.get(url)

        assert resp.status_code == 404
        data = resp.get_json()
        assert data.get("error", {}).get("code") in ("not_found", "dataset_not_found")

    def test_status_requires_auth(self, client, auth_setup):
        """GET classification-status without auth returns 401."""
        _, org, _ = auth_setup
        fake_id = str(uuid4())
        url = f"/api/datasets/{fake_id}/classification-status"
        resp = client.get(url)
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Classify all org entities  (POST /api/organizations/<id>/classify-all)
# ---------------------------------------------------------------------------

class TestClassifyOrganization:

    @patch("app.fastapi_app.routers.classification.classify_entity_task")
    def test_classify_all_queues_tasks(self, mock_task, auth_setup):
        """POST classify-all queues one task per non-deleted entity."""
        auth_client, org, _ = auth_setup
        _create_entity(current_session(), org.organization_id, entity_key="src:1:x1")
        _create_entity(current_session(), org.organization_id, entity_key="src:1:x2")
        _create_entity(current_session(), org.organization_id, entity_key="src:1:x3",
                       is_deleted=True)  # should be excluded

        mock_task.delay.return_value = MagicMock(id="task-org")

        url = f"/api/organizations/{org.organization_id}/classify-all"
        resp = _post_json(auth_client, url, {})

        assert resp.status_code == 202
        data = resp.get_json()
        assert data["organization_id"] == str(org.organization_id)
        assert data["queued"] == 2  # deleted entity excluded
        assert mock_task.delay.call_count == 2

    def test_classify_all_requires_auth(self, client, auth_setup):
        """POST classify-all without auth returns 401."""
        _, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/classify-all"
        resp = client.post(url, data=json.dumps({}), content_type="application/json")
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Classification stats  (GET /api/classification/stats)
# ---------------------------------------------------------------------------

class TestClassificationStats:

    def test_stats_empty(self, auth_setup):
        """GET /api/classification/stats returns zeros when no entities exist."""
        auth_client, org, _ = auth_setup

        url = "/api/classification/stats"
        resp = auth_client.get(url)

        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total_entities"] == 0
        assert data["by_type"] == {}
        assert data["classification_rate"] == 0

    def test_stats_with_org_filter(self, auth_setup):
        """GET /api/classification/stats?organization_id=... filters correctly."""
        auth_client, org, _ = auth_setup
        _create_entity(current_session(), org.organization_id, entity_key="src:1:s1",
                       entity_type="person")
        _create_entity(current_session(), org.organization_id, entity_key="src:1:s2",
                       entity_type="museum_object")

        url = f"/api/classification/stats?organization_id={org.organization_id}"
        resp = auth_client.get(url)

        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total_entities"] == 2
        assert data["by_type"]["person"] == 1
        assert data["by_type"]["museum_object"] == 1
        assert data["classification_rate"] == 1.0  # 0 unclassified

    def test_stats_requires_auth(self, client):
        """GET /api/classification/stats without auth returns 401."""
        resp = client.get("/api/classification/stats")
        assert resp.status_code == 401
