"""
Smoke tests for the LOD Readiness API.

Routes under:
  /api/organizations/<org_id>/collections/objects/<object_id>/lod-readiness
  /api/organizations/<org_id>/collections/lod-readiness
  /api/lod-readiness/preview
  /api/organizations/<org_id>/lod-readiness/dismissed-hints
"""

import json
from uuid import uuid4

import pytest

from app.models import CollectionObject


def _post_json(auth_client, url, data):
    """Helper for POST with JSON body."""
    return auth_client.post(url, data=json.dumps(data), content_type="application/json")


def _create_object(db_session, org_id, object_number="TEST.1", **kwargs):
    """Helper to insert a CollectionObject directly into the database."""
    obj = CollectionObject(
        organization_id=org_id,
        object_number=object_number,
        **kwargs,
    )
    db_session.add(obj)
    db_session.commit()
    return obj


# ============================================================================
# Auth Required (401)
# ============================================================================

class TestLODReadinessAuth:
    def test_single_object_readiness_requires_auth(self, client, db_session):
        """GET /api/organizations/<org>/collections/objects/<obj>/lod-readiness returns 401 without auth."""
        org_id = uuid4()
        obj_id = uuid4()
        url = f"/api/organizations/{org_id}/collections/objects/{obj_id}/lod-readiness"
        resp = client.get(url)
        assert resp.status_code == 401

    def test_collection_readiness_requires_auth(self, client, db_session):
        """GET /api/organizations/<org>/collections/lod-readiness returns 401 without auth."""
        org_id = uuid4()
        url = f"/api/organizations/{org_id}/collections/lod-readiness"
        resp = client.get(url)
        assert resp.status_code == 401

    def test_preview_requires_auth(self, client, db_session):
        """POST /api/lod-readiness/preview returns 401 without auth."""
        resp = client.post(
            "/api/lod-readiness/preview",
            data=json.dumps({"object_number": "X.1"}),
            content_type="application/json",
        )
        assert resp.status_code == 401


# ============================================================================
# Single Object Assessment
# ============================================================================

class TestSingleObjectLODReadiness:
    def test_get_readiness_for_existing_object(self, auth_setup, db_session):
        """Full readiness check returns score, level, hints, and strengths."""
        auth_client, org, _ = auth_setup
        obj = _create_object(db_session, org.organization_id, "LOD.1")
        url = f"/api/organizations/{org.organization_id}/collections/objects/{obj.object_id}/lod-readiness"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert "score" in data
        assert "level" in data
        assert "hints" in data
        assert "strengths" in data
        assert "totalHints" in data
        assert isinstance(data["score"], (int, float))
        assert data["level"] in ("excellent", "good", "fair", "basic", "minimal")

    def test_get_readiness_not_found(self, auth_setup, db_session):
        """Returns 404 for a non-existent object."""
        auth_client, org, _ = auth_setup
        fake_id = uuid4()
        url = f"/api/organizations/{org.organization_id}/collections/objects/{fake_id}/lod-readiness"
        resp = auth_client.get(url)
        assert resp.status_code == 404

    def test_get_score_endpoint(self, auth_setup, db_session):
        """Lightweight score endpoint returns objectId, score, and level."""
        auth_client, org, _ = auth_setup
        obj = _create_object(db_session, org.organization_id, "LOD.SCORE.1")
        url = f"/api/organizations/{org.organization_id}/collections/objects/{obj.object_id}/lod-readiness/score"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert "objectId" in data
        assert "score" in data
        assert "level" in data


# ============================================================================
# Field-Level Hints
# ============================================================================

class TestFieldLODHints:
    def test_get_field_hints(self, auth_setup, db_session):
        """Field hints endpoint returns hints filtered for a specific field."""
        auth_client, org, _ = auth_setup
        obj = _create_object(db_session, org.organization_id, "LOD.FIELD.1")
        url = (
            f"/api/organizations/{org.organization_id}/collections/objects/"
            f"{obj.object_id}/lod-readiness/field/titles"
        )
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["field"] == "titles"
        assert isinstance(data["hints"], list)


# ============================================================================
# Collection / Batch Assessment
# ============================================================================

class TestCollectionLODReadiness:
    def test_collection_readiness_empty(self, auth_setup, db_session):
        """Collection readiness with no objects returns zero averageScore."""
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/collections/lod-readiness"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["averageScore"] == 0
        assert data["objectCount"] == 0

    def test_batch_assessment_empty_ids(self, auth_setup, db_session):
        """POST batch with empty objectIds returns zero averageScore."""
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/collections/lod-readiness/batch"
        resp = _post_json(auth_client, url, {"objectIds": []})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["averageScore"] == 0
        assert data["objects"] == []


# ============================================================================
# Preview (Unsaved Data)
# ============================================================================

class TestLODReadinessPreview:
    def test_preview_with_data(self, auth_setup, db_session):
        """Preview endpoint assesses a dict payload without persisting."""
        auth_client, org, _ = auth_setup
        payload = {
            "object_number": "PREVIEW.1",
            "object_name": "Test Object",
            "titles": [{"title": "A Title", "is_preferred": True}],
            "brief_description": "A brief description of this object that is long enough to pass quality checks easily.",
        }
        resp = _post_json(auth_client, "/api/lod-readiness/preview", payload)
        assert resp.status_code == 200
        data = resp.get_json()
        assert "score" in data
        assert "hints" in data

    def test_preview_empty_body_returns_error(self, auth_setup, db_session):
        """Preview with null JSON body returns 400 (MISSING_DATA)."""
        auth_client, _, _ = auth_setup
        resp = auth_client.post(
            "/api/lod-readiness/preview",
            data="null",
            content_type="application/json",
        )
        # get_json() returns None for "null", triggering the MISSING_DATA branch
        assert resp.status_code in (400, 422)
        data = resp.get_json()
        assert (data.get("error", {}).get("code") in ("bad_request", "validation_error", "missing_data") or data.get("detail"))


# ============================================================================
# Dismissed Hints
# ============================================================================

class TestDismissedHints:
    def test_get_dismissed_hints(self, auth_setup, db_session):
        """GET dismissed hints returns an empty list (stub)."""
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/lod-readiness/dismissed-hints"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["dismissedHints"] == []

    def test_dismiss_hint(self, auth_setup, db_session):
        """POST to dismiss a hint returns acknowledgment."""
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/lod-readiness/dismissed-hints"
        resp = _post_json(auth_client, url, {"hintId": "creator_authority", "scope": "all"})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["dismissed"] is True
        assert data["hintId"] == "creator_authority"
        assert data["scope"] == "all"
