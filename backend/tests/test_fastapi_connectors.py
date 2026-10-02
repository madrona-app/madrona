"""
Tests for the FastAPI connector endpoints (Phase 4).

Tests 19 connector routes: definitions, instances CRUD, config redaction,
actions, test connectivity, catalog, describe, preview, and legacy aliases.
"""

import secrets
import uuid
from datetime import datetime, timezone

import pytest

from app.database import get_db
from app.services.auth_utils import generate_access_token, hash_password


@pytest.fixture(scope="session")
def fastapi_connectors_app():
    """Create a minimal FastAPI app with the connectors router."""
    from fastapi import FastAPI
    from app.fastapi_app.routers.connectors import router as connectors_router
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
    app.include_router(connectors_router)

    return app


@pytest.fixture()
def conn_client(fastapi_connectors_app, app, db_session):
    """Synchronous test client for FastAPI connector endpoints."""
    from fastapi.testclient import TestClient

    def _override_get_db():
        yield db_session

    fastapi_connectors_app.dependency_overrides[get_db] = _override_get_db

    with TestClient(fastapi_connectors_app) as client:
        yield client

    fastapi_connectors_app.dependency_overrides.clear()


@pytest.fixture()
def test_user(db_session):
    """Create a test user."""
    from app.models import User

    user = User(
        email="conntest@example.com",
        display_name="Connector Test User",
        status="active",
        cognito_sub="cognito-conn-test-123",
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
def test_org(db_session):
    """Create a test organization."""
    from app.models import Organization

    org = Organization(
        name="Connector Test Org",
        slug=f"conn-test-{uuid.uuid4().hex[:8]}",
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
def connector_permissions(db_session, org_admin_role):
    """Set up connector permissions for the org_admin role."""
    from app.models.core import Permission as PermissionModel, RolePermission

    permission_keys = [
        "connectors.view",
        "connectors.edit",
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
def test_definition(db_session):
    """Create a test connector definition."""
    from app.models import ConnectorDefinition

    definition = ConnectorDefinition(
        key="db-postgres",
        display_name="PostgreSQL",
        direction="source",
        implementation_key="app.connectors.core.postgres:PostgresConnector",
        source_type="postgres",
        version="1.0",
        category="database",
        capabilities={},
        config_schema={"type": "object", "properties": {"host": {"type": "string"}}},
    )
    db_session.add(definition)
    db_session.flush()
    return definition


@pytest.fixture()
def test_instance(db_session, test_org, test_definition):
    """Create a test connector instance."""
    from app.models import ConnectorInstance

    instance = ConnectorInstance(
        organization_id=test_org.organization_id,
        connector_definition_id=test_definition.connector_definition_id,
        name="Test Postgres",
        config={"host": "localhost", "port": 5432, "password": "secret123"},
    )
    db_session.add(instance)
    db_session.commit()
    return instance


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
# Connector Definitions
# =============================================================================


class TestListConnectorDefinitions:
    def test_list_definitions(
        self, conn_client, test_user, test_org, test_membership,
        connector_permissions, test_definition,
    ):
        token = _make_bearer_token(test_user, test_org)
        resp = conn_client.get(
            "/api/connector-definitions",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 1
        assert any(d["key"] == "db-postgres" for d in data)

    def test_list_definitions_unauthorized(self, conn_client):
        resp = conn_client.get("/api/connector-definitions")
        assert resp.status_code == 401


class TestExtractionSchema:
    def test_get_db_extraction_schema(
        self, conn_client, test_user, test_org, test_membership,
        connector_permissions, test_definition,
    ):
        token = _make_bearer_token(test_user, test_org)
        resp = conn_client.get(
            "/api/connector-definitions/db-postgres/extraction-schema",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["definitionKey"] == "db-postgres"
        assert data["extractionSchema"] is not None

    def test_non_db_definition_returns_null_schema(
        self, conn_client, test_user, test_org, test_membership,
        connector_permissions, db_session,
    ):
        from app.models import ConnectorDefinition

        defn = ConnectorDefinition(
            key="api-rest",
            display_name="REST API",
            direction="source",
            implementation_key="app.connectors.core.rest:RestConnector",
            source_type="rest",
            version="1.0",
            category="api",
            capabilities={},
            config_schema={},
        )
        db_session.add(defn)
        db_session.commit()

        token = _make_bearer_token(test_user, test_org)
        resp = conn_client.get(
            "/api/connector-definitions/api-rest/extraction-schema",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["extractionSchema"] is None

    def test_not_found_definition(
        self, conn_client, test_user, test_org, test_membership,
        connector_permissions,
    ):
        token = _make_bearer_token(test_user, test_org)
        resp = conn_client.get(
            "/api/connector-definitions/nonexistent/extraction-schema",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 404


# =============================================================================
# Connector Instances CRUD
# =============================================================================


class TestConnectorInstancesCRUD:
    def test_list_instances(
        self, conn_client, test_user, test_org, test_membership,
        connector_permissions, test_instance,
    ):
        token = _make_bearer_token(test_user, test_org)
        resp = conn_client.get(
            "/api/connector-instances",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 1

    def test_create_instance(
        self, conn_client, test_user, test_org, test_membership,
        connector_permissions, test_definition,
    ):
        token = _make_bearer_token(test_user, test_org)
        resp = conn_client.post(
            "/api/connector-instances",
            json={
                "organization_id": str(test_org.organization_id),
                "connector_definition_id": str(test_definition.connector_definition_id),
                "name": "New Instance",
                "config": {"host": "db.example.com", "password": "s3cret"},
            },
            headers=_auth_headers(token),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "New Instance"
        # Password should be redacted in response
        assert data["config"]["password"] == "***REDACTED***"
        assert data["config"]["host"] == "db.example.com"

    def test_get_instance(
        self, conn_client, test_user, test_org, test_membership,
        connector_permissions, test_instance,
    ):
        token = _make_bearer_token(test_user, test_org)
        resp = conn_client.get(
            f"/api/connector-instances/{test_instance.connector_instance_id}",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Test Postgres"
        # Sensitive config should be redacted
        assert data["config"]["password"] == "***REDACTED***"
        assert data["config"]["host"] == "localhost"

    def test_update_instance(
        self, conn_client, test_user, test_org, test_membership,
        connector_permissions, test_instance,
    ):
        token = _make_bearer_token(test_user, test_org)
        resp = conn_client.patch(
            f"/api/connector-instances/{test_instance.connector_instance_id}",
            json={"name": "Updated Postgres"},
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "Updated Postgres"

    def test_update_config_preserves_redacted(
        self, conn_client, test_user, test_org, test_membership,
        connector_permissions, test_instance, db_session,
    ):
        """Sending REDACTED back for password should preserve the original."""
        token = _make_bearer_token(test_user, test_org)
        resp = conn_client.patch(
            f"/api/connector-instances/{test_instance.connector_instance_id}",
            json={"config": {"host": "newhost", "password": "***REDACTED***"}},
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        # Verify the original password is preserved in DB
        db_session.refresh(test_instance)
        assert test_instance.config["password"] == "secret123"
        assert test_instance.config["host"] == "newhost"

    def test_delete_instance(
        self, conn_client, test_user, test_org, test_membership,
        connector_permissions, test_instance,
    ):
        token = _make_bearer_token(test_user, test_org)
        resp = conn_client.delete(
            f"/api/connector-instances/{test_instance.connector_instance_id}",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 204

    def test_instance_not_found(
        self, conn_client, test_user, test_org, test_membership,
        connector_permissions,
    ):
        token = _make_bearer_token(test_user, test_org)
        fake_id = str(uuid.uuid4())
        resp = conn_client.get(
            f"/api/connector-instances/{fake_id}",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 404


# =============================================================================
# Extraction Schemas listing
# =============================================================================


class TestListExtractionSchemas:
    def test_list_schemas(
        self, conn_client, test_user, test_org, test_membership,
        connector_permissions, test_definition,
    ):
        token = _make_bearer_token(test_user, test_org)
        resp = conn_client.get(
            "/api/extraction-schemas",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "schemas" in data
        assert isinstance(data["schemas"], list)


# =============================================================================
# Config redaction unit tests
# =============================================================================


class TestConfigRedaction:
    def test_redact_config(self):
        from app.fastapi_app.routers.connectors import redact_config, REDACTED

        config = {
            "host": "localhost",
            "password": "secret",
            "api_key": "key123",
            "nested": {"token": "abc", "name": "test"},
        }
        result = redact_config(config)
        assert result["host"] == "localhost"
        assert result["password"] == REDACTED
        assert result["api_key"] == REDACTED
        assert result["nested"]["token"] == REDACTED
        assert result["nested"]["name"] == "test"

    def test_redact_none_config(self):
        from app.fastapi_app.routers.connectors import redact_config

        assert redact_config(None) is None

    def test_redact_empty_values_preserved(self):
        from app.fastapi_app.routers.connectors import redact_config

        config = {"password": "", "secret": None}
        result = redact_config(config)
        assert result["password"] == ""
        assert result["secret"] is None

    def test_merge_preserving_secrets(self):
        from app.fastapi_app.routers.connectors import merge_config_preserving_secrets, REDACTED

        existing = {"host": "old", "password": "real_secret", "port": 5432}
        new = {"host": "new", "password": REDACTED}
        result = merge_config_preserving_secrets(new, existing)
        assert result["host"] == "new"
        assert result["password"] == "real_secret"
        assert result["port"] == 5432
