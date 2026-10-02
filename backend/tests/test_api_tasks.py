"""
Smoke tests for the Tasks API.

Routes under /api/organizations/<org_id>/tasks.
Tests cover CRUD operations and auth requirements for user tasks.
"""

import json
from uuid import uuid4

import pytest

from app.database import current_session, get_engine
from app.models import Task, TaskStatus, TaskPriority


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _post_json(auth_client, url, data):
    """Helper for POST with JSON body."""
    return auth_client.post(url, data=json.dumps(data), content_type="application/json")


def _patch_json(auth_client, url, data):
    """Helper for PATCH with JSON body."""
    return auth_client.patch(url, data=json.dumps(data), content_type="application/json")


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _register_array_position_sqlite():
    """Register an array_position shim on the SQLite connection.

    The list_tasks endpoint uses ``func.array_position(...)`` which is
    PostgreSQL-specific. This fixture provides a minimal SQLite equivalent
    so the SQL executes without error.
    """
    if get_engine().dialect.name != "sqlite":
        yield
        return

    import json as _json
    import sqlite3

    # Register an adapter so Python lists are serialized to JSON strings
    # when passed as bind parameters. Without this, SQLite raises
    # "type 'list' is not supported".
    sqlite3.register_adapter(list, lambda lst: _json.dumps(lst))

    def _array_position(arr_json, value):
        """Return 1-based index of *value* in *arr_json*, or NULL."""
        if arr_json is None or value is None:
            return None
        try:
            arr = _json.loads(arr_json) if isinstance(arr_json, str) else arr_json
        except (ValueError, TypeError):
            return None
        try:
            return arr.index(value) + 1
        except (ValueError, AttributeError):
            return len(arr) + 1

    raw = get_engine().raw_connection()
    raw.create_function("array_position", 2, _array_position)
    raw.close()
    yield


@pytest.fixture
def tasks_auth_setup(auth_setup, db_session):
    """Extend auth_setup with tasks.* permissions.

    The base auth_setup fixture does not include tasks permissions,
    so this fixture adds them to the existing role.
    """
    from app.models import Permission as PermissionModel, RolePermission, OrganizationMembership

    auth_client, org, user = auth_setup

    # Look up the role via the membership
    membership = db_session.query(OrganizationMembership).filter_by(
        organization_id=org.organization_id,
        user_id=user.user_id,
    ).first()

    task_permission_keys = [
        "tasks.view", "tasks.create", "tasks.edit", "tasks.delete",
    ]
    for key in task_permission_keys:
        scope, action = key.rsplit(".", 1)
        perm = PermissionModel(
            permission_key=key,
            scope=scope,
            action=action,
            display_name=key.replace(".", " ").title(),
            description=f"Permission for {key}",
        )
        db_session.add(perm)
        db_session.flush()

        rp = RolePermission(
            role_id=membership.role_id,
            permission_id=perm.permission_id,
        )
        db_session.add(rp)
        db_session.flush()

    db_session.commit()

    return auth_client, org, user


def _create_task(db_session, org_id, user_id, title="Test Task", **kwargs):
    """Create a Task directly in the DB."""
    task = Task(
        organization_id=org_id,
        title=title,
        status=kwargs.get("status", TaskStatus.TODO),
        priority=kwargs.get("priority", TaskPriority.NORMAL),
        created_by=user_id,
        assigned_user_id=kwargs.get("assigned_user_id"),
        description=kwargs.get("description"),
        due_date=kwargs.get("due_date"),
    )
    db_session.add(task)
    db_session.commit()
    db_session.refresh(task)
    return task


# ============================================================================
# List Tasks
# ============================================================================


class TestListTasks:
    def test_list_tasks_empty(self, tasks_auth_setup, db_session):
        """Listing tasks when none exist returns empty list."""
        auth_client, org, _ = tasks_auth_setup
        url = f"/api/organizations/{org.organization_id}/tasks"

        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["items"] == []
        assert data["total"] == 0

    def test_list_tasks_returns_created_tasks(self, tasks_auth_setup, db_session):
        """Listing tasks returns tasks that were created."""
        auth_client, org, user = tasks_auth_setup
        _create_task(db_session, org.organization_id, user.user_id, title="Task A")
        _create_task(db_session, org.organization_id, user.user_id, title="Task B")

        url = f"/api/organizations/{org.organization_id}/tasks"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 2
        assert len(data["items"]) == 2


# ============================================================================
# Create Task
# ============================================================================


class TestCreateTask:
    def test_create_task_minimal(self, tasks_auth_setup, db_session):
        """Creating a task with only a title succeeds."""
        auth_client, org, _ = tasks_auth_setup
        url = f"/api/organizations/{org.organization_id}/tasks"

        resp = _post_json(auth_client, url, {"title": "Buy acid-free tissue"})
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["task"]["title"] == "Buy acid-free tissue"
        assert data["task"]["status"] == TaskStatus.TODO
        assert data["task"]["priority"] == TaskPriority.NORMAL
        assert "task_id" in data["task"]

    def test_create_task_with_details(self, tasks_auth_setup, db_session):
        """Creating a task with full details populates all fields."""
        auth_client, org, user = tasks_auth_setup
        url = f"/api/organizations/{org.organization_id}/tasks"

        payload = {
            "title": "Condition check",
            "description": "Quarterly condition check for loans",
            "status": TaskStatus.IN_PROGRESS,
            "priority": TaskPriority.HIGH,
            "due_date": "2026-03-15",
        }
        resp = _post_json(auth_client, url, payload)
        assert resp.status_code == 201
        data = resp.get_json()["task"]
        assert data["title"] == "Condition check"
        assert data["description"] == "Quarterly condition check for loans"
        assert data["status"] == TaskStatus.IN_PROGRESS
        assert data["priority"] == TaskPriority.HIGH
        assert data["due_date"] == "2026-03-15"

    def test_create_task_title_required(self, tasks_auth_setup):
        """Creating a task without a title returns 400."""
        auth_client, org, _ = tasks_auth_setup
        url = f"/api/organizations/{org.organization_id}/tasks"

        resp = _post_json(auth_client, url, {"description": "No title here"})
        assert resp.status_code in (400, 422)


# ============================================================================
# Get Task by ID
# ============================================================================


class TestGetTask:
    def test_get_task_by_id(self, tasks_auth_setup, db_session):
        """Getting a task by ID returns the correct task."""
        auth_client, org, user = tasks_auth_setup
        task = _create_task(db_session, org.organization_id, user.user_id, title="Retrieve Me")

        url = f"/api/organizations/{org.organization_id}/tasks/{task.task_id}"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()["task"]
        assert data["task_id"] == str(task.task_id)
        assert data["title"] == "Retrieve Me"

    def test_get_task_not_found(self, tasks_auth_setup):
        """Getting a non-existent task returns 404."""
        auth_client, org, _ = tasks_auth_setup
        fake_id = uuid4()

        url = f"/api/organizations/{org.organization_id}/tasks/{fake_id}"
        resp = auth_client.get(url)
        assert resp.status_code == 404


# ============================================================================
# Update Task
# ============================================================================


class TestUpdateTask:
    def test_update_task_title(self, tasks_auth_setup, db_session):
        """Updating a task's title persists the change."""
        auth_client, org, user = tasks_auth_setup
        task = _create_task(db_session, org.organization_id, user.user_id, title="Old Title")

        url = f"/api/organizations/{org.organization_id}/tasks/{task.task_id}"
        resp = _patch_json(auth_client, url, {"title": "New Title"})
        assert resp.status_code == 200
        data = resp.get_json()["task"]
        assert data["title"] == "New Title"

    def test_update_task_not_found(self, tasks_auth_setup):
        """Updating a non-existent task returns 404."""
        auth_client, org, _ = tasks_auth_setup
        fake_id = uuid4()

        url = f"/api/organizations/{org.organization_id}/tasks/{fake_id}"
        resp = _patch_json(auth_client, url, {"title": "Ghost"})
        assert resp.status_code == 404


# ============================================================================
# Delete Task
# ============================================================================


class TestDeleteTask:
    def test_delete_task(self, tasks_auth_setup, db_session):
        """Deleting a task succeeds and the task is no longer retrievable."""
        auth_client, org, user = tasks_auth_setup
        task = _create_task(db_session, org.organization_id, user.user_id, title="Delete Me")

        url = f"/api/organizations/{org.organization_id}/tasks/{task.task_id}"
        resp = auth_client.delete(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["success"] is True

        # Verify the task is gone
        resp = auth_client.get(url)
        assert resp.status_code == 404

    def test_delete_task_not_found(self, tasks_auth_setup):
        """Deleting a non-existent task returns 404."""
        auth_client, org, _ = tasks_auth_setup
        fake_id = uuid4()

        url = f"/api/organizations/{org.organization_id}/tasks/{fake_id}"
        resp = auth_client.delete(url)
        assert resp.status_code == 404


# ============================================================================
# Authorization
# ============================================================================


class TestTasksAuth:
    def test_list_requires_auth(self, client, tasks_auth_setup):
        """Unauthenticated request to list tasks returns 401."""
        _, org, _ = tasks_auth_setup
        url = f"/api/organizations/{org.organization_id}/tasks"

        resp = client.get(url)
        assert resp.status_code == 401

    def test_create_requires_auth(self, client, tasks_auth_setup):
        """Unauthenticated request to create a task returns 401."""
        _, org, _ = tasks_auth_setup
        url = f"/api/organizations/{org.organization_id}/tasks"

        resp = client.post(
            url,
            data=json.dumps({"title": "Unauthorized Task"}),
            content_type="application/json",
        )
        assert resp.status_code == 401
