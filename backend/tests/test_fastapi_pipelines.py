"""
Tests for the FastAPI pipeline endpoints (Phase 4).

Tests 11 pipeline routes: pipeline CRUD, schedule CRUD,
schedule enable/disable, permissions, and tenant isolation.
"""

import secrets
import uuid
from datetime import datetime, timezone

import pytest

from app.database import get_db
from app.services.auth_utils import generate_access_token, hash_password


@pytest.fixture(scope="session")
def fastapi_pipelines_app():
    """Create a minimal FastAPI app with the pipelines router."""
    from fastapi import FastAPI
    from app.fastapi_app.routers.pipelines import router as pipelines_router
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
    app.include_router(pipelines_router)

    return app


@pytest.fixture()
def pipe_client(fastapi_pipelines_app, app, db_session):
    """Synchronous test client for FastAPI pipeline endpoints."""
    from fastapi.testclient import TestClient

    def _override_get_db():
        yield db_session

    fastapi_pipelines_app.dependency_overrides[get_db] = _override_get_db

    with TestClient(fastapi_pipelines_app) as client:
        yield client

    fastapi_pipelines_app.dependency_overrides.clear()


@pytest.fixture()
def test_user(db_session):
    """Create a test user."""
    from app.models import User

    user = User(
        email="pipetest@example.com",
        display_name="Pipeline Test User",
        status="active",
        cognito_sub="cognito-pipe-test-123",
        password_hash=hash_password("testpassword123"),
    )
    db_session.add(user)
    db_session.flush()
    return user


@pytest.fixture()
def org_admin_role(db_session):
    """Get or create the org_admin role."""
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
def viewer_role(db_session):
    """Get or create the viewer role."""
    from app.models import Role

    role = db_session.query(Role).filter_by(role_key="viewer").first()
    if not role:
        role = Role(
            role_key="viewer",
            display_name="Viewer",
            is_system=True,
        )
        db_session.add(role)
        db_session.flush()
    return role


@pytest.fixture()
def test_org(db_session):
    """Create a test organization."""
    from app.models import Organization

    org = Organization(
        name="Pipeline Test Org",
        slug=f"pipe-test-{uuid.uuid4().hex[:8]}",
        is_demo=False,
        status="active",
        timezone="America/New_York",
    )
    db_session.add(org)
    db_session.flush()
    return org


@pytest.fixture()
def other_org(db_session):
    """Create another org for tenant isolation tests."""
    from app.models import Organization

    org = Organization(
        name="Other Org",
        slug=f"other-org-{uuid.uuid4().hex[:8]}",
        is_demo=False,
        status="active",
        timezone="UTC",
    )
    db_session.add(org)
    db_session.flush()
    return org


@pytest.fixture()
def test_membership(db_session, test_user, test_org, org_admin_role):
    """Create membership for user in org."""
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
def pipeline_permissions(db_session, org_admin_role):
    """Set up pipeline + schedule permissions for the org_admin role."""
    from app.models.core import Permission as PermissionModel, RolePermission

    permission_keys = [
        "pipelines.view",
        "pipelines.edit",
        "schedules.manage",
    ]

    perms = []
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
        perms.append(perm)

        rp = (
            db_session.query(RolePermission)
            .filter_by(role_id=org_admin_role.role_id, permission_id=perm.permission_id)
            .first()
        )
        if not rp:
            rp = RolePermission(role_id=org_admin_role.role_id, permission_id=perm.permission_id)
            db_session.add(rp)

    db_session.commit()
    return perms


@pytest.fixture()
def test_connector_def(db_session):
    """Create a test connector definition for pipelines."""
    from app.models import ConnectorDefinition

    defn = db_session.query(ConnectorDefinition).filter_by(key="db-postgres").first()
    if not defn:
        defn = ConnectorDefinition(
            key="db-postgres",
            display_name="PostgreSQL",
            direction="source",
            implementation_key="app.connectors.core.postgres:PostgresConnector",
            source_type="postgres",
            version="1.0",
            category="database",
            capabilities={},
            config_schema={},
        )
        db_session.add(defn)
        db_session.flush()
    return defn


@pytest.fixture()
def test_connector_instance(db_session, test_org, test_connector_def):
    """Create a test connector instance for pipeline sources/destinations."""
    from app.models import ConnectorInstance

    instance = ConnectorInstance(
        organization_id=test_org.organization_id,
        connector_definition_id=test_connector_def.connector_definition_id,
        name="Test Source",
        config={"host": "localhost", "port": 5432},
    )
    db_session.add(instance)
    db_session.commit()
    return instance


@pytest.fixture()
def test_pipeline(db_session, test_org, test_connector_instance):
    """Create a test pipeline with a source."""
    from app.models import Pipeline, PipelineSource

    pipeline = Pipeline(
        organization_id=test_org.organization_id,
        status="active",
    )
    db_session.add(pipeline)
    db_session.flush()

    source = PipelineSource(
        pipeline_id=pipeline.pipeline_id,
        connector_instance_id=test_connector_instance.connector_instance_id,
        enabled=True,
        parameters={},
        ordering=0,
    )
    db_session.add(source)
    db_session.commit()
    return pipeline


def _make_bearer_token(user, org=None, mfa=False, mfa_at=None):
    """Generate a Bearer token for testing."""
    return generate_access_token(
        user_id=str(user.user_id),
        email=user.email,
        active_organization_id=str(org.organization_id) if org else None,
        mfa_verified=mfa,
        mfa_at=mfa_at.isoformat() if mfa_at else None,
    )


def _auth_headers(token, csrf=True):
    """Generate auth + CSRF headers."""
    headers = {"Authorization": f"Bearer {token}"}
    if csrf:
        csrf_token = secrets.token_urlsafe(32)
        headers["X-CSRF-Token"] = csrf_token
        headers["Cookie"] = f"csrf_token={csrf_token}"
    return headers


# =============================================================================
# Pipeline CRUD
# =============================================================================


class TestPipelineList:
    def test_list_pipelines(
        self, pipe_client, test_user, test_org, test_membership,
        pipeline_permissions, test_pipeline,
    ):
        token = _make_bearer_token(test_user, test_org)
        resp = pipe_client.get(
            "/api/pipelines",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 1
        assert data[0]["organization_id"] == str(test_org.organization_id)

    def test_list_pipelines_unauthorized(self, pipe_client):
        resp = pipe_client.get("/api/pipelines")
        assert resp.status_code == 401


class TestPipelineGet:
    def test_get_pipeline(
        self, pipe_client, test_user, test_org, test_membership,
        pipeline_permissions, test_pipeline,
    ):
        token = _make_bearer_token(test_user, test_org)
        resp = pipe_client.get(
            f"/api/organizations/{test_org.organization_id}/pipelines/{test_pipeline.pipeline_id}",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["pipeline_id"] == str(test_pipeline.pipeline_id)
        assert len(data["sources"]) >= 1

    def test_get_pipeline_not_found(
        self, pipe_client, test_user, test_org, test_membership,
        pipeline_permissions,
    ):
        token = _make_bearer_token(test_user, test_org)
        fake_id = str(uuid.uuid4())
        resp = pipe_client.get(
            f"/api/organizations/{test_org.organization_id}/pipelines/{fake_id}",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 404


class TestPipelineCreate:
    def test_create_pipeline(
        self, pipe_client, test_user, test_org, test_membership,
        pipeline_permissions, test_connector_instance,
    ):
        token = _make_bearer_token(test_user, test_org)
        resp = pipe_client.post(
            "/api/pipelines",
            json={
                "organization_id": str(test_org.organization_id),
                "sources": [
                    {
                        "connector_instance_id": str(test_connector_instance.connector_instance_id),
                        "enabled": True,
                        "parameters": {"syncMode": "full"},
                    },
                ],
                "destinations": [],
            },
            headers=_auth_headers(token),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["organization_id"] == str(test_org.organization_id)
        assert len(data["sources"]) == 1
        assert data["sources"][0]["parameters"]["syncMode"] == "full"
        assert data["status"] == "active"

    def test_create_pipeline_empty_sources(
        self, pipe_client, test_user, test_org, test_membership,
        pipeline_permissions,
    ):
        token = _make_bearer_token(test_user, test_org)
        resp = pipe_client.post(
            "/api/pipelines",
            json={
                "organization_id": str(test_org.organization_id),
                "sources": [],
            },
            headers=_auth_headers(token),
        )
        assert resp.status_code in (400, 422)


class TestPipelineUpdate:
    def test_update_pipeline_status(
        self, pipe_client, test_user, test_org, test_membership,
        pipeline_permissions, test_pipeline,
    ):
        token = _make_bearer_token(test_user, test_org)
        resp = pipe_client.patch(
            f"/api/pipelines/{test_pipeline.pipeline_id}",
            json={"status": "disabled"},
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "disabled"

    def test_update_pipeline_sources(
        self, pipe_client, test_user, test_org, test_membership,
        pipeline_permissions, test_pipeline, test_connector_instance,
    ):
        token = _make_bearer_token(test_user, test_org)
        resp = pipe_client.patch(
            f"/api/pipelines/{test_pipeline.pipeline_id}",
            json={
                "sources": [
                    {
                        "connector_instance_id": str(test_connector_instance.connector_instance_id),
                        "enabled": False,
                        "parameters": {"syncMode": "incremental"},
                    },
                ],
            },
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["sources"]) == 1
        assert data["sources"][0]["enabled"] is False


class TestPipelineDelete:
    def test_delete_pipeline(
        self, pipe_client, test_user, test_org, test_membership,
        pipeline_permissions, test_pipeline,
    ):
        token = _make_bearer_token(test_user, test_org)
        resp = pipe_client.delete(
            f"/api/pipelines/{test_pipeline.pipeline_id}",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 204


# =============================================================================
# Tenant isolation
# =============================================================================


class TestTenantIsolation:
    def test_cannot_access_other_org_pipeline(
        self, pipe_client, test_user, test_org, test_membership,
        pipeline_permissions, other_org, db_session, test_connector_def,
    ):
        """Pipelines from another org should not be visible."""
        from app.models import Pipeline, ConnectorInstance, PipelineSource

        # Create instance and pipeline in other org
        other_instance = ConnectorInstance(
            organization_id=other_org.organization_id,
            connector_definition_id=test_connector_def.connector_definition_id,
            name="Other Source",
            config={"host": "other"},
        )
        db_session.add(other_instance)
        db_session.flush()

        other_pipeline = Pipeline(
            organization_id=other_org.organization_id,
            status="active",
        )
        db_session.add(other_pipeline)
        db_session.flush()

        source = PipelineSource(
            pipeline_id=other_pipeline.pipeline_id,
            connector_instance_id=other_instance.connector_instance_id,
            enabled=True,
            parameters={},
            ordering=0,
        )
        db_session.add(source)
        db_session.commit()

        # Try to access from test_user's org
        token = _make_bearer_token(test_user, test_org)
        resp = pipe_client.get(
            f"/api/organizations/{other_org.organization_id}/pipelines/{other_pipeline.pipeline_id}",
            headers=_auth_headers(token),
        )
        # Should get 404 (not visible) or 403 (wrong org)
        assert resp.status_code in (403, 404)


# =============================================================================
# Schedule CRUD
# =============================================================================


class TestScheduleCRUD:
    def test_get_schedule_none(
        self, pipe_client, test_user, test_org, test_membership,
        pipeline_permissions, test_pipeline,
    ):
        token = _make_bearer_token(test_user, test_org)
        resp = pipe_client.get(
            f"/api/pipelines/{test_pipeline.pipeline_id}/schedule",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        assert resp.json()["schedule"] is None

    def test_create_interval_schedule(
        self, pipe_client, test_user, test_org, test_membership,
        pipeline_permissions, test_pipeline,
    ):
        token = _make_bearer_token(test_user, test_org)
        resp = pipe_client.post(
            f"/api/pipelines/{test_pipeline.pipeline_id}/schedule",
            json={
                "type": "interval",
                "every_n": 6,
                "unit": "hours",
                "enabled": True,
            },
            headers=_auth_headers(token),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["type"] == "interval"
        assert data["every_n"] == 6
        assert data["unit"] == "hours"
        assert data["enabled"] is True
        assert data["timezone"] == "America/New_York"  # org's default timezone

    def test_create_duplicate_schedule_conflict(
        self, pipe_client, test_user, test_org, test_membership,
        pipeline_permissions, test_pipeline,
    ):
        """Second schedule for same pipeline should fail with 409."""
        token = _make_bearer_token(test_user, test_org)
        # First create
        pipe_client.post(
            f"/api/pipelines/{test_pipeline.pipeline_id}/schedule",
            json={"type": "interval", "every_n": 1, "unit": "hours"},
            headers=_auth_headers(token),
        )
        # Second create should conflict
        resp = pipe_client.post(
            f"/api/pipelines/{test_pipeline.pipeline_id}/schedule",
            json={"type": "interval", "every_n": 2, "unit": "days"},
            headers=_auth_headers(token),
        )
        assert resp.status_code == 409

    def test_update_schedule(
        self, pipe_client, test_user, test_org, test_membership,
        pipeline_permissions, test_pipeline,
    ):
        token = _make_bearer_token(test_user, test_org)
        # Create first
        pipe_client.post(
            f"/api/pipelines/{test_pipeline.pipeline_id}/schedule",
            json={"type": "interval", "every_n": 1, "unit": "hours"},
            headers=_auth_headers(token),
        )
        # Update
        resp = pipe_client.patch(
            f"/api/pipelines/{test_pipeline.pipeline_id}/schedule",
            json={"every_n": 30, "unit": "minutes"},
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["every_n"] == 30
        assert data["unit"] == "minutes"

    def test_delete_schedule(
        self, pipe_client, test_user, test_org, test_membership,
        pipeline_permissions, test_pipeline,
    ):
        token = _make_bearer_token(test_user, test_org)
        # Create first
        pipe_client.post(
            f"/api/pipelines/{test_pipeline.pipeline_id}/schedule",
            json={"type": "interval", "every_n": 1, "unit": "hours"},
            headers=_auth_headers(token),
        )
        # Delete
        resp = pipe_client.delete(
            f"/api/pipelines/{test_pipeline.pipeline_id}/schedule",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 204

        # Verify it's gone
        resp = pipe_client.get(
            f"/api/pipelines/{test_pipeline.pipeline_id}/schedule",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        assert resp.json()["schedule"] is None


# =============================================================================
# Schedule enable/disable
# =============================================================================


class TestScheduleToggle:
    def test_enable_schedule(
        self, pipe_client, test_user, test_org, test_membership,
        pipeline_permissions, test_pipeline,
    ):
        token = _make_bearer_token(test_user, test_org)
        # Create disabled
        pipe_client.post(
            f"/api/pipelines/{test_pipeline.pipeline_id}/schedule",
            json={"type": "interval", "every_n": 1, "unit": "hours", "enabled": False},
            headers=_auth_headers(token),
        )
        # Enable
        resp = pipe_client.post(
            f"/api/pipelines/{test_pipeline.pipeline_id}/schedule/enable",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        assert resp.json()["enabled"] is True

    def test_disable_schedule(
        self, pipe_client, test_user, test_org, test_membership,
        pipeline_permissions, test_pipeline,
    ):
        token = _make_bearer_token(test_user, test_org)
        # Create enabled
        pipe_client.post(
            f"/api/pipelines/{test_pipeline.pipeline_id}/schedule",
            json={"type": "interval", "every_n": 1, "unit": "hours", "enabled": True},
            headers=_auth_headers(token),
        )
        # Disable
        resp = pipe_client.post(
            f"/api/pipelines/{test_pipeline.pipeline_id}/schedule/disable",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        assert resp.json()["enabled"] is False


# =============================================================================
# Validation
# =============================================================================


class TestScheduleValidation:
    def test_invalid_schedule_type(
        self, pipe_client, test_user, test_org, test_membership,
        pipeline_permissions, test_pipeline,
    ):
        token = _make_bearer_token(test_user, test_org)
        resp = pipe_client.post(
            f"/api/pipelines/{test_pipeline.pipeline_id}/schedule",
            json={"type": "cron", "every_n": 1},
            headers=_auth_headers(token),
        )
        assert resp.status_code == 422

    def test_interval_missing_unit(
        self, pipe_client, test_user, test_org, test_membership,
        pipeline_permissions, test_pipeline,
    ):
        token = _make_bearer_token(test_user, test_org)
        resp = pipe_client.post(
            f"/api/pipelines/{test_pipeline.pipeline_id}/schedule",
            json={"type": "interval", "every_n": 1},
            headers=_auth_headers(token),
        )
        assert resp.status_code in (400, 422)

    def test_invalid_unit(
        self, pipe_client, test_user, test_org, test_membership,
        pipeline_permissions, test_pipeline,
    ):
        token = _make_bearer_token(test_user, test_org)
        resp = pipe_client.post(
            f"/api/pipelines/{test_pipeline.pipeline_id}/schedule",
            json={"type": "interval", "every_n": 1, "unit": "weeks"},
            headers=_auth_headers(token),
        )
        assert resp.status_code == 422
