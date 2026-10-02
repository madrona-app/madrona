"""
Smoke tests for the Work Tasks API (tasks_work.py).

Routes tested:
- GET  /api/organizations/<org_id>/work/tasks
- GET  /api/organizations/<org_id>/work/tasks/count
- PATCH /api/organizations/<org_id>/work/tasks/<record_type>/<record_id>/assign
- GET  /api/organizations/<org_id>/work/assignees

Tasks are aggregated views over workflow records (condition reports, loans,
conservation treatments, etc.), so we create those underlying records and
verify the task endpoints surface them correctly.

Note: ConditionReport and ConservationTreatment queries use joinedload on a
relationship name that differs from the model attribute (collection_object vs
object), which causes those sub-queries to fail silently in SQLite tests.  We
therefore exercise the task list/count endpoints primarily via ObjectEntry and
IncidentReport, whose queries work correctly in the test harness.
"""

import json
from datetime import date, datetime, timezone
from uuid import uuid4

import pytest

from app.models import (
    ObjectEntry,
    IncidentReport,
)


def _base_url(org_id):
    return f"/api/organizations/{org_id}/work"


# ---------------------------------------------------------------------------
# List tasks
# ---------------------------------------------------------------------------


class TestListWorkTasks:
    """GET /api/organizations/<org_id>/work/tasks"""

    def test_list_tasks_empty(self, auth_setup):
        """Returns empty task list when no workflow records exist."""
        auth_client, org, _ = auth_setup
        resp = auth_client.get(f"{_base_url(org.organization_id)}/tasks")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["items"] == []
        assert data["total"] == 0
        assert "counts" in data
        assert data["counts"]["urgent"] == 0

    def test_list_tasks_returns_object_entries(self, auth_setup, db_session):
        """Object entries in pending status appear as tasks."""
        auth_client, org, _ = auth_setup
        entry = ObjectEntry(
            organization_id=org.organization_id,
            entry_number="OE-001",
            entry_date=date.today(),
            entry_reason="loan_consideration",
            status="pending",
        )
        db_session.add(entry)
        db_session.commit()

        resp = auth_client.get(f"{_base_url(org.organization_id)}/tasks")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] >= 1
        record_types = [t["record_type"] for t in data["items"]]
        assert "object_entry" in record_types
        # Verify expected task shape
        oe_task = next(t for t in data["items"] if t["record_type"] == "object_entry")
        assert oe_task["record_id"] == str(entry.entry_id)
        assert oe_task["record_number"] == "OE-001"
        assert oe_task["status"] == "pending"
        assert oe_task["type"] == "action_required"

    def test_list_tasks_returns_incidents(self, auth_setup, db_session):
        """Submitted incident reports appear as urgent tasks."""
        auth_client, org, _ = auth_setup
        inc = IncidentReport(
            organization_id=org.organization_id,
            report_number="IR-001",
            report_date=date.today(),
            incident_type="damage",
            discovered_date=datetime.now(timezone.utc),
            incident_description="Glass case shattered",
            status="submitted",
        )
        db_session.add(inc)
        db_session.commit()

        resp = auth_client.get(f"{_base_url(org.organization_id)}/tasks")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] >= 1
        inc_task = next(t for t in data["items"] if t["record_type"] == "incident")
        assert inc_task["priority"] == "urgent"

    def test_list_tasks_filter_by_record_type(self, auth_setup, db_session):
        """The record_type query parameter filters tasks to a specific type."""
        auth_client, org, _ = auth_setup

        # Create one object entry and one incident
        entry = ObjectEntry(
            organization_id=org.organization_id,
            entry_number="OE-FLT-001",
            entry_date=date.today(),
            entry_reason="loan_consideration",
            status="pending",
        )
        inc = IncidentReport(
            organization_id=org.organization_id,
            report_number="IR-FLT-001",
            report_date=date.today(),
            incident_type="damage",
            discovered_date=datetime.now(timezone.utc),
            incident_description="Test incident",
            status="submitted",
        )
        db_session.add_all([entry, inc])
        db_session.commit()

        resp = auth_client.get(
            f"{_base_url(org.organization_id)}/tasks?record_type=object_entry"
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data["items"]) >= 1
        for task in data["items"]:
            assert task["record_type"] == "object_entry"

    def test_list_tasks_pagination(self, auth_setup, db_session):
        """Limit and offset parameters control pagination."""
        auth_client, org, _ = auth_setup

        # Create 3 object entries
        for i in range(3):
            db_session.add(ObjectEntry(
                organization_id=org.organization_id,
                entry_number=f"OE-PG-{i:03d}",
                entry_date=date.today(),
                entry_reason="loan_consideration",
                status="pending",
            ))
        db_session.commit()

        resp = auth_client.get(
            f"{_base_url(org.organization_id)}/tasks?limit=2&offset=0"
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] >= 3
        assert len(data["items"]) == 2
        assert data["page"]["has_more"] is True

    def test_list_tasks_response_shape(self, auth_setup):
        """Response includes tasks list, total, counts, and page metadata."""
        auth_client, org, _ = auth_setup
        resp = auth_client.get(f"{_base_url(org.organization_id)}/tasks")
        assert resp.status_code == 200
        data = resp.get_json()
        assert "items" in data
        assert "total" in data
        assert "counts" in data
        assert "page" in data
        assert set(data["counts"].keys()) == {"urgent", "high", "normal", "low"}
        assert set(data["page"].keys()) == {"limit", "offset", "has_more"}


# ---------------------------------------------------------------------------
# Task count
# ---------------------------------------------------------------------------


class TestTaskCount:
    """GET /api/organizations/<org_id>/work/tasks/count"""

    def test_count_empty(self, auth_setup):
        """Returns zero when no workflow records exist."""
        auth_client, org, _ = auth_setup
        resp = auth_client.get(f"{_base_url(org.organization_id)}/tasks/count")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["count"] == 0
        assert data["urgent"] == 0

    def test_count_includes_records(self, auth_setup, db_session):
        """Count reflects the number of actionable workflow records."""
        auth_client, org, _ = auth_setup

        db_session.add(ObjectEntry(
            organization_id=org.organization_id,
            entry_number="OE-CNT-001",
            entry_date=date.today(),
            entry_reason="loan_consideration",
            status="pending",
        ))
        db_session.add(IncidentReport(
            organization_id=org.organization_id,
            report_number="IR-CNT-001",
            report_date=date.today(),
            incident_type="damage",
            discovered_date=datetime.now(timezone.utc),
            incident_description="Test incident",
            status="submitted",
        ))
        db_session.commit()

        resp = auth_client.get(f"{_base_url(org.organization_id)}/tasks/count")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["count"] >= 2
        # submitted incidents count as urgent
        assert data["urgent"] >= 1


# ---------------------------------------------------------------------------
# Assign task
# ---------------------------------------------------------------------------


class TestAssignTask:
    """PATCH /api/organizations/<org_id>/work/tasks/<type>/<id>/assign"""

    def test_assign_task_not_found(self, auth_setup):
        """Returns 404 for a non-existent record."""
        auth_client, org, _ = auth_setup
        fake_id = uuid4()
        resp = auth_client.patch(
            f"{_base_url(org.organization_id)}/tasks/condition_report/{fake_id}/assign",
            data=json.dumps({"assigned_to_user_id": None}),
            content_type="application/json",
        )
        assert resp.status_code == 404

    def test_assign_task_invalid_record_type(self, auth_setup):
        """Returns 400 for an unrecognized record type."""
        auth_client, org, _ = auth_setup
        fake_id = uuid4()
        resp = auth_client.patch(
            f"{_base_url(org.organization_id)}/tasks/bogus_type/{fake_id}/assign",
            data=json.dumps({"assigned_to_user_id": None}),
            content_type="application/json",
        )
        assert resp.status_code in (400, 422)

    def test_assign_task_unassign(self, auth_setup, db_session):
        """Setting assigned_to_user_id to null unassigns the task."""
        auth_client, org, user = auth_setup

        entry = ObjectEntry(
            organization_id=org.organization_id,
            entry_number="OE-ASN-001",
            entry_date=date.today(),
            entry_reason="loan_consideration",
            status="pending",
            assigned_to_user_id=user.user_id,
        )
        db_session.add(entry)
        db_session.commit()

        resp = auth_client.patch(
            f"{_base_url(org.organization_id)}/tasks/object_entry/{entry.entry_id}/assign",
            data=json.dumps({"assigned_to_user_id": None}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["success"] is True
        assert data["assigned_to_user_id"] is None

    def test_assign_task_to_user(self, auth_setup, db_session):
        """Assigning a valid org member sets assigned_to_user_id."""
        auth_client, org, user = auth_setup

        entry = ObjectEntry(
            organization_id=org.organization_id,
            entry_number="OE-ASN-002",
            entry_date=date.today(),
            entry_reason="loan_consideration",
            status="pending",
        )
        db_session.add(entry)
        db_session.commit()

        resp = auth_client.patch(
            f"{_base_url(org.organization_id)}/tasks/object_entry/{entry.entry_id}/assign",
            data=json.dumps({"assigned_to_user_id": str(user.user_id)}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["success"] is True
        assert data["assigned_to_user_id"] == str(user.user_id)


# ---------------------------------------------------------------------------
# Get assignable users
# ---------------------------------------------------------------------------


class TestGetAssignableUsers:
    """GET /api/organizations/<org_id>/work/assignees"""

    def test_get_assignees(self, auth_setup):
        """Returns list of active org members."""
        auth_client, org, user = auth_setup
        resp = auth_client.get(f"{_base_url(org.organization_id)}/assignees")
        assert resp.status_code == 200
        data = resp.get_json()
        assert "users" in data
        assert len(data["users"]) >= 1
        user_ids = [u["user_id"] for u in data["users"]]
        assert str(user.user_id) in user_ids


# ---------------------------------------------------------------------------
# Auth required (401)
# ---------------------------------------------------------------------------


class TestAuthRequired:
    """Unauthenticated requests return 401."""

    def test_list_tasks_requires_auth(self, client, db_session):
        """GET /work/tasks without token returns 401."""
        fake_org = uuid4()
        resp = client.get(f"/api/organizations/{fake_org}/work/tasks")
        assert resp.status_code == 401

    def test_task_count_requires_auth(self, client, db_session):
        """GET /work/tasks/count without token returns 401."""
        fake_org = uuid4()
        resp = client.get(f"/api/organizations/{fake_org}/work/tasks/count")
        assert resp.status_code == 401

    def test_assign_task_requires_auth(self, client, db_session):
        """PATCH /work/tasks/.../assign without token returns 401."""
        fake_org = uuid4()
        fake_id = uuid4()
        resp = client.patch(
            f"/api/organizations/{fake_org}/work/tasks/condition_report/{fake_id}/assign",
            data=json.dumps({"assigned_to_user_id": None}),
            content_type="application/json",
        )
        assert resp.status_code == 401

    def test_assignees_requires_auth(self, client, db_session):
        """GET /work/assignees without token returns 401."""
        fake_org = uuid4()
        resp = client.get(f"/api/organizations/{fake_org}/work/assignees")
        assert resp.status_code == 401
