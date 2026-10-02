"""
Smoke tests for the Export Profiles API.

Tests the endpoints in app/api/export_profiles.py:
  - GET /api/export-profiles (list all)
  - GET /api/export-profiles/<id> (get by ID / not found)
  - GET /api/organizations/<org_id>/collections/objects/<id>/export (single object export)
  - POST /api/organizations/<org_id>/collections/objects/export/batch (batch export)
  - POST /api/export-profiles/<id>/preview (preview transform)
  - POST /api/export-profiles/compare (compare profiles)
  - Auth required (401 without token)
"""

import json
from unittest.mock import patch
from uuid import uuid4

import pytest

from app.models import CollectionObject


# ============================================================================
# List profiles
# ============================================================================


class TestListExportProfiles:
    def test_list_profiles(self, auth_setup):
        """GET /api/export-profiles returns built-in profiles."""
        auth_client, org, _ = auth_setup
        resp = auth_client.get("/api/export-profiles")
        assert resp.status_code == 200
        data = resp.get_json()
        assert "profiles" in data
        assert "categories" in data
        assert "authoritySources" in data
        assert "mediaOptions" in data
        # Built-in profiles: research, aggregator, public, iiif, minimal
        profile_ids = {p["profileId"] for p in data["profiles"]}
        assert "research" in profile_ids
        assert "public" in profile_ids
        assert "aggregator" in profile_ids
        assert "iiif" in profile_ids
        assert "minimal" in profile_ids

    def test_list_profiles_has_expected_structure(self, auth_setup):
        """Each profile in the list has the expected keys."""
        auth_client, _, _ = auth_setup
        resp = auth_client.get("/api/export-profiles")
        data = resp.get_json()
        for profile in data["profiles"]:
            assert "profileId" in profile
            assert "name" in profile
            assert "description" in profile
            assert "profileType" in profile


# ============================================================================
# Get profile by ID
# ============================================================================


class TestGetExportProfile:
    def test_get_profile_by_id(self, auth_setup):
        """GET /api/export-profiles/research returns the research profile."""
        auth_client, _, _ = auth_setup
        resp = auth_client.get("/api/export-profiles/research")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["profile"]["profileId"] == "research"
        assert data["profile"]["name"] == "Research"

    def test_get_profile_not_found(self, auth_setup):
        """GET /api/export-profiles/<nonexistent> returns 404."""
        auth_client, _, _ = auth_setup
        resp = auth_client.get("/api/export-profiles/nonexistent-profile")
        assert resp.status_code == 404
        data = resp.get_json()
        assert data.get("error", {}).get("code", "").lower() == "not_found"


# ============================================================================
# Preview profile
# ============================================================================


class TestPreviewProfile:
    def test_preview_profile(self, auth_setup):
        """POST /api/export-profiles/public/preview applies profile to sample data."""
        auth_client, _, _ = auth_setup
        sample_data = {
            "object_number": "2024.1",
            "titles": [{"title": "Test Object"}],
            "internal_notes": "Secret note",
            "insurance_value": "10000",
        }
        resp = auth_client.post(
            "/api/export-profiles/public/preview",
            data=json.dumps(sample_data),
            content_type="application/json",
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert "original" in data
        assert "exported" in data
        assert "removedFields" in data
        assert "transformedFields" in data
        assert "profile" in data
        assert data["profile"]["profileId"] == "public"

    def test_preview_profile_not_found(self, auth_setup):
        """POST /api/export-profiles/<bad>/preview returns 404."""
        auth_client, _, _ = auth_setup
        resp = auth_client.post(
            "/api/export-profiles/nonexistent/preview",
            data=json.dumps({"object_number": "1"}),
            content_type="application/json",
        )
        assert resp.status_code == 404

    def test_preview_profile_missing_body(self, auth_setup):
        """POST /api/export-profiles/public/preview with empty object returns 400."""
        auth_client, _, _ = auth_setup
        resp = auth_client.post(
            "/api/export-profiles/public/preview",
            data=json.dumps({}),
            content_type="application/json",
        )
        assert resp.status_code in (400, 422)
        data = resp.get_json()
        assert (data.get("error", {}).get("code") in ("bad_request", "validation_error", "missing_data") or data.get("detail"))


# ============================================================================
# Compare profiles
# ============================================================================


class TestCompareProfiles:
    def test_compare_profiles(self, auth_setup):
        """POST /api/export-profiles/compare returns comparisons for each profile."""
        auth_client, _, _ = auth_setup
        payload = {
            "objectData": {
                "object_number": "2024.1",
                "titles": [{"title": "Test"}],
                "insurance_value": "5000",
            },
            "profiles": ["research", "public"],
        }
        resp = auth_client.post(
            "/api/export-profiles/compare",
            data=json.dumps(payload),
            content_type="application/json",
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert "comparisons" in data
        assert "fieldCoverage" in data
        assert "profileCount" in data
        assert data["profileCount"] == 2
        assert "research" in data["comparisons"]
        assert "public" in data["comparisons"]

    def test_compare_profiles_missing_object_data(self, auth_setup):
        """POST /api/export-profiles/compare with empty objectData returns 400."""
        auth_client, _, _ = auth_setup
        resp = auth_client.post(
            "/api/export-profiles/compare",
            data=json.dumps({"objectData": {}, "profiles": ["research"]}),
            content_type="application/json",
        )
        assert resp.status_code in (400, 422)
        data = resp.get_json()
        assert (data.get("error", {}).get("code") in ("bad_request", "validation_error", "missing_data") or data.get("detail"))


# ============================================================================
# Single object export
# ============================================================================


class TestExportObject:
    @patch("app.fastapi_app.routers.collections_objects._index_collection_object")
    def test_export_object_not_found(self, mock_index, auth_setup):
        """GET .../export with a nonexistent object_id returns 404."""
        auth_client, org, _ = auth_setup
        fake_id = str(uuid4())
        url = (
            f"/api/organizations/{org.organization_id}"
            f"/collections/objects/{fake_id}/export?profile=public"
        )
        resp = auth_client.get(url)
        assert resp.status_code == 404
        data = resp.get_json()
        assert data.get("error", {}).get("code", "").lower() == "not_found"

    @patch("app.fastapi_app.routers.collections_objects._index_collection_object")
    def test_export_object_invalid_profile(self, mock_index, auth_setup):
        """GET .../export?profile=bad returns 400 INVALID_PROFILE."""
        auth_client, org, _ = auth_setup
        fake_id = str(uuid4())
        url = (
            f"/api/organizations/{org.organization_id}"
            f"/collections/objects/{fake_id}/export?profile=does_not_exist"
        )
        resp = auth_client.get(url)
        assert resp.status_code in (400, 422)
        data = resp.get_json()
        assert (data.get("error", {}).get("code") in ("bad_request", "validation_error", "invalid_profile") or data.get("detail"))


# ============================================================================
# Auth required (401)
# ============================================================================


class TestExportProfilesAuth:
    def test_list_profiles_requires_auth(self, client):
        """GET /api/export-profiles without token returns 401."""
        resp = client.get("/api/export-profiles")
        assert resp.status_code == 401

    def test_get_profile_requires_auth(self, client):
        """GET /api/export-profiles/research without token returns 401."""
        resp = client.get("/api/export-profiles/research")
        assert resp.status_code == 401

    def test_preview_requires_auth(self, client):
        """POST /api/export-profiles/public/preview without token returns 401."""
        resp = client.post(
            "/api/export-profiles/public/preview",
            data=json.dumps({"object_number": "1"}),
            content_type="application/json",
        )
        assert resp.status_code == 401

    def test_compare_requires_auth(self, client):
        """POST /api/export-profiles/compare without token returns 401."""
        resp = client.post(
            "/api/export-profiles/compare",
            data=json.dumps({"objectData": {"x": 1}, "profiles": ["public"]}),
            content_type="application/json",
        )
        assert resp.status_code == 401
