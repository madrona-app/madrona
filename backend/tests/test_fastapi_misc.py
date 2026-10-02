"""
Tests for FastAPI Phase 7 routes: notifications, discussions, lookups, audit logs, tasks.
"""

import secrets
import uuid
from datetime import datetime, timezone

import pytest

from app.database import get_db
from app.services.auth_utils import generate_access_token, hash_password


# =============================================================================
# App fixture
# =============================================================================


@pytest.fixture(scope="session")
def fastapi_misc_app():
    """Create a minimal FastAPI app with Phase 7 routers."""
    from fastapi import FastAPI
    from app.fastapi_app.routers.notifications import router as notifications_router
    from app.fastapi_app.routers.discussions import router as discussions_router
    from app.fastapi_app.routers.misc import router as misc_router
    from app.fastapi_app.exception_handlers import register_exception_handlers
    from app.fastapi_app.middleware.csrf import CSRFMiddleware
    from app.fastapi_app.middleware.content_type import ContentTypeMiddleware
    from app.fastapi_app.middleware.security_headers import SecurityHeadersMiddleware
    from app.fastapi_app.middleware.request_logging import RequestLoggingMiddleware

    app = FastAPI()

    app.add_middleware(CSRFMiddleware)
    app.add_middleware(ContentTypeMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestLoggingMiddleware)

    register_exception_handlers(app)
    app.include_router(notifications_router)
    app.include_router(discussions_router)
    app.include_router(misc_router)

    return app


@pytest.fixture()
def misc_client(fastapi_misc_app, app, db_session):
    """Synchronous test client for Phase 7 endpoints."""
    from fastapi.testclient import TestClient

    def _override_get_db():
        yield db_session

    fastapi_misc_app.dependency_overrides[get_db] = _override_get_db

    with TestClient(fastapi_misc_app) as client:
        yield client

    fastapi_misc_app.dependency_overrides.clear()


# =============================================================================
# Shared fixtures
# =============================================================================


@pytest.fixture()
def test_user(db_session):
    from app.models import User

    user = User(
        email=f"misctest-{uuid.uuid4().hex[:8]}@example.com",
        display_name="Misc Test User",
        status="active",
        cognito_sub=f"cognito-misc-{uuid.uuid4().hex[:8]}",
        password_hash=hash_password("testpassword123"),
    )
    db_session.add(user)
    db_session.flush()
    return user


@pytest.fixture()
def other_user(db_session):
    from app.models import User

    user = User(
        email=f"other-{uuid.uuid4().hex[:8]}@example.com",
        display_name="Other User",
        status="active",
        cognito_sub=f"cognito-other-{uuid.uuid4().hex[:8]}",
        password_hash=hash_password("testpassword123"),
    )
    db_session.add(user)
    db_session.flush()
    return user


@pytest.fixture()
def test_org(db_session):
    from app.models import Organization

    org = Organization(
        name="Misc Test Org",
        slug=f"misc-test-{uuid.uuid4().hex[:8]}",
        is_demo=False,
        status="active",
        timezone="America/New_York",
    )
    db_session.add(org)
    db_session.flush()
    return org


@pytest.fixture()
def org_admin_role(db_session):
    from app.models import Role

    role = db_session.query(Role).filter_by(role_key="admin").first()
    if not role:
        role = Role(
            role_key="admin",
            display_name="Organization Administrator",
            is_system=True,
        )
        db_session.add(role)
        db_session.flush()
    return role


@pytest.fixture()
def test_membership(db_session, test_user, test_org, org_admin_role):
    from app.models import OrganizationMembership

    membership = OrganizationMembership(
        organization_id=test_org.organization_id,
        user_id=test_user.user_id,
        role="admin",
        role_id=org_admin_role.role_id,
        status="active",
    )
    db_session.add(membership)
    db_session.commit()
    return membership


@pytest.fixture()
def misc_permissions(db_session, org_admin_role):
    """Set up all permissions needed for Phase 7 routes."""
    from app.models.core import Permission as PermissionModel, RolePermission

    permission_keys = [
        "lookups.view",
        "lookups.manage",
        "org.view_audit_logs",
        "tasks.view",
        "tasks.create",
        "tasks.edit",
        "tasks.delete",
    ]

    for key in permission_keys:
        perm = db_session.query(PermissionModel).filter_by(permission_key=key).first()
        if not perm:
            parts = key.split(".", 1)
            perm = PermissionModel(
                permission_key=key,
                scope=parts[0],
                action=parts[1] if len(parts) > 1 else key,
                display_name=key,
                description=key,
            )
            db_session.add(perm)
            db_session.flush()

        rp = (
            db_session.query(RolePermission)
            .filter_by(role_id=org_admin_role.role_id, permission_id=perm.permission_id)
            .first()
        )
        if not rp:
            rp = RolePermission(role_id=org_admin_role.role_id, permission_id=perm.permission_id)
            db_session.add(rp)

    db_session.commit()


def _make_token(user, org=None):
    return generate_access_token(
        user_id=str(user.user_id),
        email=user.email,
        active_organization_id=str(org.organization_id) if org else None,
        mfa_verified=False,
        mfa_at=None,
    )


def _auth_headers(token, csrf=True):
    headers = {"Authorization": f"Bearer {token}"}
    if csrf:
        csrf_token = secrets.token_urlsafe(32)
        headers["X-CSRF-Token"] = csrf_token
        headers["Cookie"] = f"csrf_token={csrf_token}"
    return headers


# =============================================================================
# Notification Tests
# =============================================================================


class TestNotifications:
    @pytest.fixture()
    def notification(self, db_session, test_user, test_org, test_membership):
        from app.models import Notification

        n = Notification(
            organization_id=test_org.organization_id,
            user_id=test_user.user_id,
            notification_type="comment_added",
            title="New comment on Object #123",
            message="Someone commented on an object you watch.",
            entity_type="collection_object",
            is_read=False,
        )
        db_session.add(n)
        db_session.commit()
        return n

    def test_list_notifications(self, misc_client, test_user, test_org, test_membership, notification):
        token = _make_token(test_user, test_org)
        resp = misc_client.get(
            f"/api/organizations/{test_org.organization_id}/notifications",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data
        assert "unread_count" in data
        assert "total" in data
        assert data["total"] >= 1

    def test_unread_count(self, misc_client, test_user, test_org, test_membership, notification):
        token = _make_token(test_user, test_org)
        resp = misc_client.get(
            f"/api/organizations/{test_org.organization_id}/notifications/unread-count",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "unread_count" in data
        assert data["unread_count"] >= 1

    def test_mark_read(self, misc_client, test_user, test_org, test_membership, notification):
        token = _make_token(test_user, test_org)
        resp = misc_client.post(
            f"/api/organizations/{test_org.organization_id}/notifications/{notification.notification_id}/read",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_mark_all_read(self, misc_client, test_user, test_org, test_membership, notification):
        token = _make_token(test_user, test_org)
        resp = misc_client.post(
            f"/api/organizations/{test_org.organization_id}/notifications/read-all",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert "marked_count" in data

    def test_delete_notification(self, misc_client, test_user, test_org, test_membership, notification):
        token = _make_token(test_user, test_org)
        resp = misc_client.delete(
            f"/api/organizations/{test_org.organization_id}/notifications/{notification.notification_id}",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True


# =============================================================================
# Discussion Tests
# =============================================================================


class TestDiscussions:
    @pytest.fixture()
    def comment(self, db_session, test_user, test_org, test_membership):
        from app.models import RecordComment

        entity_id = uuid.uuid4()
        c = RecordComment(
            organization_id=test_org.organization_id,
            entity_type="collection_object",
            entity_id=entity_id,
            author_id=test_user.user_id,
            content="Test comment",
            kind="user",
        )
        db_session.add(c)
        db_session.commit()
        return c

    def test_list_comments(self, misc_client, test_user, test_org, test_membership, comment):
        token = _make_token(test_user, test_org)
        resp = misc_client.get(
            f"/api/organizations/{test_org.organization_id}/records/{comment.entity_type}/{comment.entity_id}/comments",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data
        assert data["total"] >= 1

    def test_create_comment(self, misc_client, test_user, test_org, test_membership):
        token = _make_token(test_user, test_org)
        entity_id = uuid.uuid4()
        resp = misc_client.post(
            f"/api/organizations/{test_org.organization_id}/records/collection_object/{entity_id}/comments",
            json={"content": "A new comment", "kind": "user"},
            headers=_auth_headers(token),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert "comment" in data
        assert data["comment"]["content"] == "A new comment"

    def test_comment_count(self, misc_client, test_user, test_org, test_membership, comment):
        token = _make_token(test_user, test_org)
        resp = misc_client.get(
            f"/api/organizations/{test_org.organization_id}/records/{comment.entity_type}/{comment.entity_id}/comments/count",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        assert resp.json()["count"] >= 1

    def test_watch_status(self, misc_client, test_user, test_org, test_membership):
        token = _make_token(test_user, test_org)
        entity_id = uuid.uuid4()
        resp = misc_client.get(
            f"/api/organizations/{test_org.organization_id}/records/collection_object/{entity_id}/watch",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        assert resp.json()["watching"] is False

    def test_start_watch(self, misc_client, test_user, test_org, test_membership):
        token = _make_token(test_user, test_org)
        entity_id = uuid.uuid4()
        resp = misc_client.post(
            f"/api/organizations/{test_org.organization_id}/records/collection_object/{entity_id}/watch",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["watching"] is True
        assert "watch_id" in data

    def test_stop_watch(self, misc_client, test_user, test_org, test_membership, db_session):
        from app.models import RecordWatch

        entity_id = uuid.uuid4()
        watch = RecordWatch(
            organization_id=test_org.organization_id,
            user_id=test_user.user_id,
            entity_type="collection_object",
            entity_id=entity_id,
        )
        db_session.add(watch)
        db_session.commit()

        token = _make_token(test_user, test_org)
        resp = misc_client.delete(
            f"/api/organizations/{test_org.organization_id}/records/collection_object/{entity_id}/watch",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        assert resp.json()["watching"] is False

    def test_invalid_entity_type(self, misc_client, test_user, test_org, test_membership):
        token = _make_token(test_user, test_org)
        entity_id = uuid.uuid4()
        resp = misc_client.get(
            f"/api/organizations/{test_org.organization_id}/records/invalid_type/{entity_id}/comments",
            headers=_auth_headers(token),
        )
        assert resp.status_code in (400, 422)


# =============================================================================
# Lookup Tests
# =============================================================================


class TestLookups:
    @pytest.fixture()
    def lookup_category(self, db_session, test_membership, misc_permissions):
        from app.models import LookupCategory

        cat = LookupCategory(
            category_key=f"test_cat_{uuid.uuid4().hex[:8]}",
            display_name="Test Category",
            description="A test lookup category",
            applicable_contexts=["test"],
            supports_icons=True,
        )
        db_session.add(cat)
        db_session.commit()
        return cat

    @pytest.fixture()
    def lookup_value(self, db_session, test_org, lookup_category):
        from app.models import LookupValue

        val = LookupValue(
            category_id=lookup_category.category_id,
            organization_id=test_org.organization_id,
            value_key=f"test_val_{uuid.uuid4().hex[:8]}",
            label="Test Value",
            description="A test value",
            sort_order=0,
            is_active=True,
            is_hidden=False,
        )
        db_session.add(val)
        db_session.commit()
        return val

    def test_list_lookups(self, misc_client, test_user, test_org, lookup_category, lookup_value):
        token = _make_token(test_user, test_org)
        resp = misc_client.get(
            f"/api/organizations/{test_org.organization_id}/lookups",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        # Find our test category
        cat = next((c for c in data if c["category_key"] == lookup_category.category_key), None)
        assert cat is not None
        assert "values" in cat

    def test_get_category_values(self, misc_client, test_user, test_org, lookup_category, lookup_value):
        token = _make_token(test_user, test_org)
        resp = misc_client.get(
            f"/api/organizations/{test_org.organization_id}/lookups/{lookup_category.category_key}",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "category" in data
        assert "values" in data
        assert len(data["values"]) >= 1

    def test_create_value(self, misc_client, test_user, test_org, lookup_category, misc_permissions, test_membership):
        token = _make_token(test_user, test_org)
        resp = misc_client.post(
            f"/api/organizations/{test_org.organization_id}/lookups/{lookup_category.category_key}",
            json={
                "value_key": f"new_val_{uuid.uuid4().hex[:8]}",
                "label": "New Value",
                "description": "Created in test",
            },
            headers=_auth_headers(token),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["label"] == "New Value"

    def test_update_value(self, misc_client, test_user, test_org, lookup_value, misc_permissions, test_membership):
        token = _make_token(test_user, test_org)
        resp = misc_client.put(
            f"/api/organizations/{test_org.organization_id}/lookups/values/{lookup_value.value_id}",
            json={"label": "Updated Label"},
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        assert resp.json()["label"] == "Updated Label"

    def test_delete_value(self, misc_client, test_user, test_org, lookup_value, misc_permissions, test_membership):
        token = _make_token(test_user, test_org)
        resp = misc_client.delete(
            f"/api/organizations/{test_org.organization_id}/lookups/values/{lookup_value.value_id}",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 204


# =============================================================================
# Audit Log Tests
# =============================================================================


class TestAuditLogs:
    @pytest.fixture()
    def audit_event(self, db_session, test_org, test_user, test_membership, misc_permissions):
        from app.models import EntityAuditEvent

        event = EntityAuditEvent(
            organization_id=test_org.organization_id,
            entity_type="collection_object",
            entity_id=uuid.uuid4(),
            entity_display_key="OBJ-001",
            change_type="created",
            changed_at=datetime.now(timezone.utc),
            changed_by=test_user.user_id,
            changed_by_name=test_user.display_name,
            changed_by_email=test_user.email,
            changed_fields=["title", "description"],
            summary="Created object OBJ-001",
        )
        db_session.add(event)
        db_session.commit()
        return event

    def test_list_entity_audit_events(self, misc_client, test_user, test_org, audit_event):
        token = _make_token(test_user, test_org)
        resp = misc_client.get(
            f"/api/organizations/{test_org.organization_id}/entity-audit-events",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data
        assert "total" in data
        assert data["total"] >= 1

    def test_get_entity_audit_event(self, misc_client, test_user, test_org, audit_event, db_session):
        from app.models import EntityAuditFieldDiff

        diff = EntityAuditFieldDiff(
            event_id=audit_event.event_id,
            organization_id=test_org.organization_id,
            field_name="title",
            old_value=None,
            new_value="Object #1",
        )
        db_session.add(diff)
        db_session.commit()

        token = _make_token(test_user, test_org)
        resp = misc_client.get(
            f"/api/organizations/{test_org.organization_id}/entity-audit-events/{audit_event.event_id}",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "event" in data
        assert "field_diffs" in data["event"]
        assert len(data["event"]["field_diffs"]) >= 1


# =============================================================================
# Task Tests
# =============================================================================


class TestTasks:
    @pytest.fixture()
    def task(self, db_session, test_user, test_org, test_membership, misc_permissions):
        from app.models import Task

        t = Task(
            organization_id=test_org.organization_id,
            title="Test Task",
            description="A test task",
            status="todo",
            priority="normal",
            created_by=test_user.user_id,
        )
        db_session.add(t)
        db_session.commit()
        return t

    def test_list_tasks(self, misc_client, test_user, test_org, task):
        token = _make_token(test_user, test_org)
        resp = misc_client.get(
            f"/api/organizations/{test_org.organization_id}/tasks",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data
        assert "total" in data
        assert data["total"] >= 1

    def test_get_task(self, misc_client, test_user, test_org, task):
        token = _make_token(test_user, test_org)
        resp = misc_client.get(
            f"/api/organizations/{test_org.organization_id}/tasks/{task.task_id}",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "task" in data
        assert data["task"]["title"] == "Test Task"

    def test_create_task(self, misc_client, test_user, test_org, test_membership, misc_permissions):
        token = _make_token(test_user, test_org)
        resp = misc_client.post(
            f"/api/organizations/{test_org.organization_id}/tasks",
            json={
                "title": "New Task",
                "description": "Created in test",
                "status": "todo",
                "priority": "high",
            },
            headers=_auth_headers(token),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["task"]["title"] == "New Task"
        assert data["task"]["priority"] == "high"

    def test_update_task(self, misc_client, test_user, test_org, task):
        token = _make_token(test_user, test_org)
        resp = misc_client.patch(
            f"/api/organizations/{test_org.organization_id}/tasks/{task.task_id}",
            json={"title": "Updated Task", "priority": "urgent"},
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["task"]["title"] == "Updated Task"
        assert data["task"]["priority"] == "urgent"

    def test_delete_task(self, misc_client, test_user, test_org, task):
        token = _make_token(test_user, test_org)
        resp = misc_client.delete(
            f"/api/organizations/{test_org.organization_id}/tasks/{task.task_id}",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_get_task_enums(self, misc_client, test_user, test_org, test_membership, misc_permissions):
        token = _make_token(test_user, test_org)
        resp = misc_client.get(
            f"/api/organizations/{test_org.organization_id}/tasks/enums",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "statuses" in data
        assert "priorities" in data
        assert "related_entity_types" in data
