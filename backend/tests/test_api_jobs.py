"""
Smoke tests for the Jobs API (/api/jobs).

Read-only endpoints for viewing scheduled job status and execution history.
Routes:
    GET  /api/jobs              - List jobs (requires organization_id query param)
    GET  /api/jobs/<job_id>     - Get single job by ID
"""

import json
from datetime import datetime, timezone
from uuid import uuid4

import pytest

from app.models import Job


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _create_job(db_session, organization_id, **overrides):
    """Insert a Job row directly into the DB and return it."""
    defaults = {
        "organization_id": organization_id,
        "job_type": "pipeline_sync",
        "status": "queued",
        "priority": 100,
        "attempt": 0,
        "max_attempts": 5,
        "payload": {},
    }
    defaults.update(overrides)
    job = Job(**defaults)
    db_session.add(job)
    db_session.commit()
    return job


# ============================================================================
# List Jobs  (GET /api/jobs?organization_id=...)
# ============================================================================


class TestListJobs:
    def test_list_jobs_empty(self, auth_setup):
        """GET /api/jobs returns empty list when no jobs exist."""
        auth_client, org, _ = auth_setup
        url = f"/api/jobs?organization_id={org.organization_id}"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["items"] == []
        assert data["total"] == 0

    def test_list_jobs_with_data(self, auth_setup, db_session):
        """GET /api/jobs returns jobs belonging to the organization."""
        auth_client, org, _ = auth_setup
        _create_job(db_session, org.organization_id, status="queued")
        _create_job(db_session, org.organization_id, status="succeeded")

        url = f"/api/jobs?organization_id={org.organization_id}"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 2
        assert len(data["items"]) == 2

    def test_list_jobs_respects_limit(self, auth_setup, db_session):
        """Limit query parameter caps the number of returned jobs."""
        auth_client, org, _ = auth_setup
        for i in range(5):
            _create_job(db_session, org.organization_id, status="queued")

        url = f"/api/jobs?organization_id={org.organization_id}&limit=2"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data["items"]) == 2
        assert data["total"] == 5
        assert data["limit"] == 2

    def test_list_jobs_missing_org_id(self, auth_setup):
        """GET /api/jobs without organization_id returns 400."""
        auth_client, _, _ = auth_setup
        resp = auth_client.get("/api/jobs")
        assert resp.status_code in (400, 422)
        data = resp.get_json()
        _e = data.get("error") or data.get("detail", "")
        if isinstance(_e, dict):
            msg = _e.get("message", "")
        else:
            msg = str(_e)
        assert "organization_id" in (msg + data.get("message", "")).lower()


# ============================================================================
# Get Job by ID  (GET /api/jobs/<job_id>)
# ============================================================================


class TestGetJob:
    def test_get_job_by_id(self, auth_setup, db_session):
        """GET /api/jobs/<id> returns the job detail."""
        auth_client, org, _ = auth_setup
        job = _create_job(db_session, org.organization_id, status="succeeded")
        job_id = job.job_id

        url = f"/api/jobs/{job_id}?organization_id={org.organization_id}"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["job_id"] == str(job_id)
        assert data["status"] == "succeeded"
        assert data["organization_id"] == str(org.organization_id)

    def test_get_job_not_found(self, auth_setup):
        """GET /api/jobs/<nonexistent> returns 404."""
        auth_client, org, _ = auth_setup
        fake_id = uuid4()
        url = f"/api/jobs/{fake_id}?organization_id={org.organization_id}"
        resp = auth_client.get(url)
        assert resp.status_code == 404
        data = resp.get_json()
        _e = data.get("error")
        msg = _e.get("message", "") if isinstance(_e, dict) else str(_e or "")
        assert "not found" in msg.lower() or "no job" in msg.lower()

    def test_get_job_includes_attempt_and_error(self, auth_setup, db_session):
        """Detail endpoint includes attempt count and error text."""
        auth_client, org, _ = auth_setup
        job = _create_job(
            db_session,
            org.organization_id,
            status="failed",
            attempt=3,
            error="Connection timeout",
        )
        job_id = job.job_id

        url = f"/api/jobs/{job_id}?organization_id={org.organization_id}"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["attempt"] == 3
        _e = data["error"]
        assert (_e.get("message") if isinstance(_e, dict) else _e) == "Connection timeout"


# ============================================================================
# Authentication / Authorization
# ============================================================================


class TestJobsAuth:
    def test_list_requires_auth(self, client, auth_setup):
        """GET /api/jobs without auth token returns 401."""
        _, org, _ = auth_setup
        url = f"/api/jobs?organization_id={org.organization_id}"
        resp = client.get(url)
        assert resp.status_code == 401

    def test_get_requires_auth(self, client, auth_setup):
        """GET /api/jobs/<id> without auth token returns 401."""
        _, org, _ = auth_setup
        url = f"/api/jobs/{uuid4()}?organization_id={org.organization_id}"
        resp = client.get(url)
        assert resp.status_code == 401


# ============================================================================
# Cross-Organization Isolation
# ============================================================================


class TestJobsCrossOrgIsolation:
    def test_job_not_visible_across_orgs(self, auth_setup, db_session):
        """A job in org A is not visible when querying org B."""
        auth_client, org, _ = auth_setup

        # Create a job in the authenticated org
        job = _create_job(db_session, org.organization_id, status="queued")

        # Create a second organization
        from app.models import Organization
        org2 = Organization(
            name="Other Org",
            slug="other-org",
            is_demo=False,
            status="active",
        )
        db_session.add(org2)
        db_session.commit()

        # List jobs in org2 -- should be empty
        url = f"/api/jobs?organization_id={org2.organization_id}"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 0

    def test_get_job_from_other_org_returns_404(self, auth_setup, db_session):
        """Fetching a job by ID with a different org_id returns 404 (tenant isolation)."""
        auth_client, org, _ = auth_setup

        job = _create_job(db_session, org.organization_id, status="queued")
        job_id = job.job_id

        # Create a second org
        from app.models import Organization
        org2 = Organization(
            name="Isolated Org",
            slug="isolated-org",
            is_demo=False,
            status="active",
        )
        db_session.add(org2)
        db_session.commit()

        # Try to fetch the job using org2's ID -- should be 404
        url = f"/api/jobs/{job_id}?organization_id={org2.organization_id}"
        resp = auth_client.get(url)
        assert resp.status_code == 404
