"""
Tests for FastAPI Phase 7b routes: search, autocomplete, work tasks.
"""

import secrets
import uuid
from datetime import datetime, timezone
from unittest.mock import patch

import pytest

from app.database import get_db
from app.services.auth_utils import generate_access_token, hash_password


# =============================================================================
# App fixture
# =============================================================================


@pytest.fixture(scope="session")
def fastapi_7b_app():
    """Create a minimal FastAPI app with Phase 7b routers."""
    from fastapi import FastAPI
    from app.fastapi_app.routers.search import router as search_router
    from app.fastapi_app.routers.autocomplete import router as autocomplete_router
    from app.fastapi_app.routers.tasks_work import router as tasks_work_router
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
    app.include_router(search_router)
    app.include_router(autocomplete_router)
    app.include_router(tasks_work_router)

    return app


@pytest.fixture()
def client_7b(fastapi_7b_app, app, db_session):
    """Synchronous test client for Phase 7b endpoints."""
    from fastapi.testclient import TestClient

    def _override_get_db():
        yield db_session

    fastapi_7b_app.dependency_overrides[get_db] = _override_get_db

    with TestClient(fastapi_7b_app) as client:
        yield client

    fastapi_7b_app.dependency_overrides.clear()


# =============================================================================
# Shared fixtures
# =============================================================================


@pytest.fixture()
def test_user(db_session):
    from app.models import User

    user = User(
        email=f"p7b-{uuid.uuid4().hex[:8]}@example.com",
        display_name="Phase 7b Test User",
        status="active",
        cognito_sub=f"cognito-p7b-{uuid.uuid4().hex[:8]}",
        password_hash=hash_password("testpassword123"),
    )
    db_session.add(user)
    db_session.flush()
    return user


@pytest.fixture()
def other_user(db_session):
    from app.models import User

    user = User(
        email=f"p7b-other-{uuid.uuid4().hex[:8]}@example.com",
        display_name="Other User",
        status="active",
        cognito_sub=f"cognito-p7b-other-{uuid.uuid4().hex[:8]}",
        password_hash=hash_password("testpassword123"),
    )
    db_session.add(user)
    db_session.flush()
    return user


@pytest.fixture()
def test_org(db_session):
    from app.models import Organization

    org = Organization(
        name="Phase 7b Test Org",
        slug=f"p7b-test-{uuid.uuid4().hex[:8]}",
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
def other_membership(db_session, other_user, test_org, org_admin_role):
    from app.models import OrganizationMembership

    membership = OrganizationMembership(
        organization_id=test_org.organization_id,
        user_id=other_user.user_id,
        role="admin",
        role_id=org_admin_role.role_id,
        status="active",
    )
    db_session.add(membership)
    db_session.commit()
    return membership


@pytest.fixture()
def phase7b_permissions(db_session, org_admin_role):
    """Set up all permissions needed for Phase 7b routes."""
    from app.models.core import Permission as PermissionModel, RolePermission

    permission_keys = [
        "data.view",
        "collections.view",
        "collections.edit",
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
# Search Tests
# =============================================================================


class TestSearch:
    """Tests for the /api/search routes."""

    @patch("app.fastapi_app.routers.search.is_opensearch_available", return_value=False)
    def test_search_pg_fallback(
        self, mock_os, client_7b, test_user, test_org, test_membership, phase7b_permissions
    ):
        """Search falls back to PG when OpenSearch is unavailable."""
        token = _make_token(test_user, test_org)
        resp = client_7b.post(
            f"/api/search?organization_id={test_org.organization_id}",
            json={"query": {"q": "test"}},
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "hits" in data
        assert "total" in data
        assert data["took_ms"] == 0  # PG fallback always 0

    @patch("app.fastapi_app.routers.search.is_opensearch_available", return_value=False)
    def test_autocomplete_pg_fallback(
        self, mock_os, client_7b, test_user, test_org, test_membership, phase7b_permissions
    ):
        """Autocomplete falls back to PG when OpenSearch is unavailable."""
        token = _make_token(test_user, test_org)
        resp = client_7b.get(
            f"/api/search/autocomplete?organization_id={test_org.organization_id}&q=test",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "suggestions" in data

    @patch("app.fastapi_app.routers.search.is_opensearch_available", return_value=False)
    def test_similar_empty_when_no_opensearch(
        self, mock_os, client_7b, test_user, test_org, test_membership, phase7b_permissions
    ):
        """Similar returns empty when OpenSearch is unavailable."""
        token = _make_token(test_user, test_org)
        resp = client_7b.get(
            f"/api/search/similar/some-entity-key?organization_id={test_org.organization_id}",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["similar"] == []

    def test_search_missing_org_id(
        self, client_7b, test_user, test_org, test_membership, phase7b_permissions
    ):
        """Search requires organization_id query param."""
        token = _make_token(test_user, test_org)
        resp = client_7b.post(
            "/api/search",
            json={"query": {"q": "test"}},
            headers=_auth_headers(token),
        )
        assert resp.status_code == 422  # FastAPI validation error


# =============================================================================
# Autocomplete Tests
# =============================================================================


class TestAutocomplete:
    """Tests for the /api/autocomplete routes."""

    def test_search_autocomplete(
        self, client_7b, test_user, test_org, test_membership, phase7b_permissions
    ):
        """Autocomplete search endpoint works."""
        token = _make_token(test_user, test_org)
        resp = client_7b.post(
            "/api/autocomplete/search",
            json={
                "query": "test",
                "field_type": "material",
                "organization_id": str(test_org.organization_id),
                "sources": ["local"],
            },
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "suggestions" in data
        assert "query" in data

    def test_recent(
        self, client_7b, test_user, test_org, test_membership, phase7b_permissions
    ):
        """Recent values endpoint works (returns empty for unsupported field types)."""
        token = _make_token(test_user, test_org)
        # Use a field_type that has no column mapping so it returns [] without hitting PG-specific SQL
        resp = client_7b.get(
            "/api/autocomplete/recent?field_type=unknown_type",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert data == []

    def test_popular(
        self, client_7b, test_user, test_org, test_membership, phase7b_permissions
    ):
        """Popular values endpoint works (returns empty for unsupported field types)."""
        token = _make_token(test_user, test_org)
        # Use a field_type that has no column mapping so it returns [] without hitting PG-specific SQL
        resp = client_7b.get(
            "/api/autocomplete/popular?field_type=unknown_type",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert data == []

    def test_select_missing_params(
        self, client_7b, test_user, test_org, test_membership, phase7b_permissions
    ):
        """Select endpoint requires suggestion_id and label."""
        token = _make_token(test_user, test_org)
        resp = client_7b.post(
            "/api/autocomplete/select",
            json={"suggestion_id": "", "label": ""},
            headers=_auth_headers(token),
        )
        assert resp.status_code in (400, 422)


# =============================================================================
# Work Tasks Tests
# =============================================================================


class TestWorkTasks:
    """Tests for the /api/organizations/{org_id}/work/* routes."""

    def test_list_tasks(
        self, client_7b, test_user, test_org, test_membership, phase7b_permissions
    ):
        """List tasks returns empty when no workflow records exist."""
        token = _make_token(test_user, test_org)
        resp = client_7b.get(
            f"/api/organizations/{test_org.organization_id}/work/tasks",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data
        assert "total" in data
        assert "counts" in data
        assert data["total"] == 0

    def test_task_count(
        self, client_7b, test_user, test_org, test_membership, phase7b_permissions
    ):
        """Task count returns zero when no workflow records exist."""
        token = _make_token(test_user, test_org)
        resp = client_7b.get(
            f"/api/organizations/{test_org.organization_id}/work/tasks/count",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "count" in data
        assert "urgent" in data
        assert data["count"] == 0

    def test_assign_invalid_record_type(
        self, client_7b, test_user, test_org, test_membership, phase7b_permissions
    ):
        """Assigning with invalid record type returns 400."""
        token = _make_token(test_user, test_org)
        fake_id = str(uuid.uuid4())
        resp = client_7b.patch(
            f"/api/organizations/{test_org.organization_id}/work/tasks/invalid_type/{fake_id}/assign",
            json={"assigned_to_user_id": None},
            headers=_auth_headers(token),
        )
        assert resp.status_code in (400, 422)

    def test_assign_not_found(
        self, client_7b, test_user, test_org, test_membership, phase7b_permissions
    ):
        """Assigning a non-existent task returns 404."""
        token = _make_token(test_user, test_org)
        fake_id = str(uuid.uuid4())
        resp = client_7b.patch(
            f"/api/organizations/{test_org.organization_id}/work/tasks/condition_report/{fake_id}/assign",
            json={"assigned_to_user_id": None},
            headers=_auth_headers(token),
        )
        assert resp.status_code == 404

    def test_assignable_users(
        self, client_7b, test_user, test_org, test_membership, phase7b_permissions
    ):
        """List assignable users returns org members."""
        token = _make_token(test_user, test_org)
        resp = client_7b.get(
            f"/api/organizations/{test_org.organization_id}/work/assignees",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "users" in data
        assert len(data["users"]) >= 1
        user_ids = [u["user_id"] for u in data["users"]]
        assert str(test_user.user_id) in user_ids
