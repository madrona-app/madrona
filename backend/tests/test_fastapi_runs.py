"""
Tests for the FastAPI runs, jobs, and datasets endpoints (Phase 6).

Tests 15 routes: runs CRUD/execute/republish/retry, jobs list/get, datasets CRUD/preview/schema.
"""

import secrets
import uuid
from datetime import datetime, timezone
from unittest.mock import patch, MagicMock

import pytest

from app.database import get_db
from app.services.auth_utils import generate_access_token, hash_password


@pytest.fixture(scope="session")
def fastapi_runs_app():
    """Create a minimal FastAPI app with the runs router."""
    from fastapi import FastAPI
    from app.fastapi_app.routers.runs import router as runs_router
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
    app.include_router(runs_router)

    return app


@pytest.fixture()
def runs_client(fastapi_runs_app, app, db_session):
    """Synchronous test client for FastAPI runs endpoints."""
    from fastapi.testclient import TestClient

    def _override_get_db():
        yield db_session

    fastapi_runs_app.dependency_overrides[get_db] = _override_get_db

    with TestClient(fastapi_runs_app) as client:
        yield client

    fastapi_runs_app.dependency_overrides.clear()


@pytest.fixture()
def test_user(db_session):
    """Create a test user."""
    from app.models import User

    user = User(
        email="runtest@example.com",
        display_name="Run Test User",
        status="active",
        cognito_sub="cognito-run-test-123",
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
        name="Runs Test Org",
        slug=f"runs-test-{uuid.uuid4().hex[:8]}",
        is_demo=False,
        status="active",
        timezone="America/New_York",
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
def runs_permissions(db_session, org_admin_role):
    """Set up runs/jobs/datasets permissions for the org_admin role."""
    from app.models.core import Permission as PermissionModel, RolePermission

    permission_keys = [
        "runs.view",
        "runs.execute",
        "runs.delete",
        "runs.force_full",
        "data.view",
        "data.manage",
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
    """Create a test connector definition."""
    from app.models import ConnectorDefinition

    defn = db_session.query(ConnectorDefinition).filter_by(key="test-run-source").first()
    if not defn:
        defn = ConnectorDefinition(
            key="test-run-source",
            display_name="Test Run Source",
            direction="source",
            implementation_key="app.connectors.core.test:TestConnector",
            source_type="test",
            version="1.0",
            category="database",
            capabilities={},
            config_schema={},
        )
        db_session.add(defn)
        db_session.flush()
    return defn


@pytest.fixture()
def test_dest_connector_def(db_session):
    """Create a test destination connector definition."""
    from app.models import ConnectorDefinition

    defn = db_session.query(ConnectorDefinition).filter_by(key="test-run-dest").first()
    if not defn:
        defn = ConnectorDefinition(
            key="test-run-dest",
            display_name="Test Run Dest",
            direction="target",
            implementation_key="app.connectors.core.testdest:TestDestConnector",
            source_type="test_dest",
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
    """Create a test connector instance."""
    from app.models import ConnectorInstance

    instance = ConnectorInstance(
        organization_id=test_org.organization_id,
        connector_definition_id=test_connector_def.connector_definition_id,
        name="Test Run Source",
        config={"host": "localhost"},
    )
    db_session.add(instance)
    db_session.commit()
    return instance


@pytest.fixture()
def test_dest_connector_instance(db_session, test_org, test_dest_connector_def):
    """Create a test destination connector instance."""
    from app.models import ConnectorInstance

    instance = ConnectorInstance(
        organization_id=test_org.organization_id,
        connector_definition_id=test_dest_connector_def.connector_definition_id,
        name="Test Run Dest",
        config={"host": "localhost"},
    )
    db_session.add(instance)
    db_session.commit()
    return instance


@pytest.fixture()
def test_pipeline(db_session, test_org, test_connector_instance, test_dest_connector_instance):
    """Create a test pipeline with source and destination."""
    from app.models import Pipeline, PipelineSource, PipelineDestination

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

    dest = PipelineDestination(
        pipeline_id=pipeline.pipeline_id,
        connector_instance_id=test_dest_connector_instance.connector_instance_id,
        enabled=True,
        parameters={},
        ordering=0,
    )
    db_session.add(dest)

    db_session.commit()
    return pipeline


@pytest.fixture()
def test_run(db_session, test_org, test_pipeline, test_connector_instance, test_dest_connector_instance):
    """Create a test run."""
    from app.models import Run

    run = Run(
        organization_id=test_org.organization_id,
        pipeline_id=test_pipeline.pipeline_id,
        source_connector_instance_id=test_connector_instance.connector_instance_id,
        target_connector_instance_id=test_dest_connector_instance.connector_instance_id,
        status="success",
        triggered_by="api",
        parameters={},
        processed_count=10,
        created_count=5,
        updated_count=3,
        skipped_count=2,
        failed_count=0,
        deleted_count=0,
    )
    db_session.add(run)
    db_session.commit()
    return run


@pytest.fixture()
def test_dataset(db_session, test_org):
    """Create a test dataset."""
    from app.models import Dataset

    dataset = Dataset(
        organization_id=test_org.organization_id,
        name="Test Dataset",
        key=f"test-ds-{uuid.uuid4().hex[:8]}",
        description="A test dataset",
        source_type="test",
        schema={"fields": ["id", "name"]},
    )
    db_session.add(dataset)
    db_session.commit()
    return dataset


@pytest.fixture()
def test_job(db_session, test_org, test_pipeline):
    """Create a test job."""
    from app.models import Job

    job = Job(
        organization_id=test_org.organization_id,
        pipeline_id=test_pipeline.pipeline_id,
        job_type="scheduled_pipeline_execution",
        status="succeeded",
        priority=100,
        attempt=1,
        payload={},
    )
    db_session.add(job)
    db_session.commit()
    return job


def _make_bearer_token(user, org=None):
    """Generate a Bearer token for testing."""
    return generate_access_token(
        user_id=str(user.user_id),
        email=user.email,
        active_organization_id=str(org.organization_id) if org else None,
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
# Runs
# =============================================================================


class TestListRuns:
    def test_list_runs(
        self, runs_client, test_user, test_org, test_membership,
        runs_permissions, test_run,
    ):
        token = _make_bearer_token(test_user, test_org)
        resp = runs_client.get(
            f"/api/organizations/{test_org.organization_id}/runs",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data
        assert "total" in data
        assert "limit" in data
        assert "offset" in data
        assert len(data["items"]) >= 1
        run = data["items"][0]
        assert "run_id" in run
        assert "status" in run
        assert "counts" in run

    def test_list_runs_unauthorized(self, runs_client):
        resp = runs_client.get(f"/api/organizations/{uuid.uuid4()}/runs")
        assert resp.status_code == 401


class TestGetRun:
    def test_get_run(
        self, runs_client, test_user, test_org, test_membership,
        runs_permissions, test_run,
    ):
        token = _make_bearer_token(test_user, test_org)
        resp = runs_client.get(
            f"/api/organizations/{test_org.organization_id}/runs/{test_run.run_id}",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["run_id"] == str(test_run.run_id)
        assert "sources" in data
        assert "destinations" in data
        assert "run_status" in data

    def test_get_run_not_found(
        self, runs_client, test_user, test_org, test_membership,
        runs_permissions,
    ):
        token = _make_bearer_token(test_user, test_org)
        resp = runs_client.get(
            f"/api/organizations/{test_org.organization_id}/runs/{uuid.uuid4()}",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 404


class TestCreateRun:
    def test_create_run(
        self, runs_client, test_user, test_org, test_membership,
        runs_permissions, test_pipeline,
    ):
        token = _make_bearer_token(test_user, test_org)
        with patch("app.services.run_steps.create_run_steps"):
            resp = runs_client.post(
                f"/api/organizations/{test_org.organization_id}/runs",
                json={"pipeline_id": str(test_pipeline.pipeline_id)},
                headers=_auth_headers(token),
            )
        assert resp.status_code == 201
        data = resp.json()
        assert data["pipeline_id"] == str(test_pipeline.pipeline_id)
        assert data["status"] == "pending"

    def test_create_run_pipeline_not_found(
        self, runs_client, test_user, test_org, test_membership,
        runs_permissions,
    ):
        token = _make_bearer_token(test_user, test_org)
        resp = runs_client.post(
            f"/api/organizations/{test_org.organization_id}/runs",
            json={"pipeline_id": str(uuid.uuid4())},
            headers=_auth_headers(token),
        )
        assert resp.status_code == 404


class TestDeleteRun:
    def test_delete_run(
        self, runs_client, test_user, test_org, test_membership,
        runs_permissions, test_run,
    ):
        token = _make_bearer_token(test_user, test_org)
        resp = runs_client.delete(
            f"/api/organizations/{test_org.organization_id}/runs/{test_run.run_id}",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 204

    def test_delete_run_in_progress(
        self, runs_client, test_user, test_org, test_membership,
        runs_permissions, test_pipeline, test_connector_instance,
        test_dest_connector_instance, db_session,
    ):
        from app.models import Run

        run = Run(
            organization_id=test_org.organization_id,
            pipeline_id=test_pipeline.pipeline_id,
            source_connector_instance_id=test_connector_instance.connector_instance_id,
            target_connector_instance_id=test_dest_connector_instance.connector_instance_id,
            status="running",
            triggered_by="api",
            parameters={},
        )
        db_session.add(run)
        db_session.commit()

        token = _make_bearer_token(test_user, test_org)
        resp = runs_client.delete(
            f"/api/organizations/{test_org.organization_id}/runs/{run.run_id}",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 409


class TestExecuteRun:
    def test_execute_run(
        self, runs_client, test_user, test_org, test_membership,
        runs_permissions, test_run,
    ):
        token = _make_bearer_token(test_user, test_org)

        mock_result = MagicMock()
        mock_result.status = "success"
        mock_result.target_url = "https://example.com/sheet"

        with patch("app.fastapi_app.routers.runs.execute_run", return_value=mock_result):
            resp = runs_client.post(
                f"/api/organizations/{test_org.organization_id}/runs/{test_run.run_id}/execute",
                headers=_auth_headers(token),
            )
        assert resp.status_code == 200
        data = resp.json()
        assert "run_id" in data
        assert data["target_url"] == "https://example.com/sheet"


class TestRepublishRun:
    def test_republish_run(
        self, runs_client, test_user, test_org, test_membership,
        runs_permissions, test_run,
    ):
        token = _make_bearer_token(test_user, test_org)

        mock_result = MagicMock()
        mock_result.status = "success"
        mock_result.target_url = "https://example.com/sheet"

        with patch("app.fastapi_app.routers.runs.republish_run", return_value=mock_result):
            resp = runs_client.post(
                f"/api/organizations/{test_org.organization_id}/runs/{test_run.run_id}/republish",
                headers=_auth_headers(token),
            )
        assert resp.status_code == 200
        data = resp.json()
        assert "run_id" in data


class TestRetryDestination:
    def test_retry_destination(
        self, runs_client, test_user, test_org, test_membership,
        runs_permissions, test_run,
    ):
        token = _make_bearer_token(test_user, test_org)
        dest_id = uuid.uuid4()

        mock_result = {
            "step_id": str(uuid.uuid4()),
            "status": "success",
            "error": None,
            "counts": {"published_entities": 10},
        }

        with patch("app.fastapi_app.routers.runs.retry_destination_publish", return_value=mock_result), \
             patch("app.fastapi_app.routers.runs.log_audit_event"):
            resp = runs_client.post(
                f"/api/organizations/{test_org.organization_id}/runs/{test_run.run_id}/destinations/{dest_id}/retry",
                headers=_auth_headers(token),
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "success"


# =============================================================================
# Jobs
# =============================================================================


class TestListJobs:
    def test_list_jobs(
        self, runs_client, test_user, test_org, test_membership,
        runs_permissions, test_job,
    ):
        token = _make_bearer_token(test_user, test_org)
        resp = runs_client.get(
            f"/api/jobs?organization_id={test_org.organization_id}",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data
        assert "total" in data
        assert "limit" in data
        assert len(data["items"]) >= 1

    def test_list_jobs_missing_org(
        self, runs_client, test_user, test_org, test_membership,
        runs_permissions,
    ):
        token = _make_bearer_token(test_user, test_org)
        resp = runs_client.get(
            "/api/jobs",
            headers=_auth_headers(token),
        )
        assert resp.status_code in (400, 422)


class TestGetJob:
    def test_get_job(
        self, runs_client, test_user, test_org, test_membership,
        runs_permissions, test_job,
    ):
        token = _make_bearer_token(test_user, test_org)
        resp = runs_client.get(
            f"/api/jobs/{test_job.job_id}?organization_id={test_org.organization_id}",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["job_id"] == str(test_job.job_id)
        assert data["organization_id"] == str(test_org.organization_id)

    def test_get_job_not_found(
        self, runs_client, test_user, test_org, test_membership,
        runs_permissions,
    ):
        token = _make_bearer_token(test_user, test_org)
        resp = runs_client.get(
            f"/api/jobs/{uuid.uuid4()}?organization_id={test_org.organization_id}",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 404


# =============================================================================
# Datasets
# =============================================================================


class TestCreateDataset:
    def test_create_dataset(
        self, runs_client, test_user, test_org, test_membership,
        runs_permissions,
    ):
        token = _make_bearer_token(test_user, test_org)
        resp = runs_client.post(
            "/api/datasets",
            json={
                "organization_id": str(test_org.organization_id),
                "name": "New Dataset",
                "key": f"new-ds-{uuid.uuid4().hex[:8]}",
                "description": "A new dataset",
                "source_type": "test",
            },
            headers=_auth_headers(token),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "New Dataset"
        assert data["organization_id"] == str(test_org.organization_id)


class TestListDatasets:
    def test_list_datasets(
        self, runs_client, test_user, test_org, test_membership,
        runs_permissions, test_dataset,
    ):
        token = _make_bearer_token(test_user, test_org)
        resp = runs_client.get(
            f"/api/datasets?organization_id={test_org.organization_id}",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data
        assert "total" in data
        assert len(data["items"]) >= 1
        # Check entity_count is included
        assert "entity_count" in data["items"][0]


class TestGetDataset:
    def test_get_dataset(
        self, runs_client, test_user, test_org, test_membership,
        runs_permissions, test_dataset,
    ):
        token = _make_bearer_token(test_user, test_org)
        resp = runs_client.get(
            f"/api/datasets/{test_dataset.dataset_id}",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["dataset_id"] == str(test_dataset.dataset_id)
        assert data["name"] == "Test Dataset"

    def test_get_dataset_not_found(
        self, runs_client, test_user, test_org, test_membership,
        runs_permissions,
    ):
        token = _make_bearer_token(test_user, test_org)
        resp = runs_client.get(
            f"/api/datasets/{uuid.uuid4()}",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 404


class TestUpdateDataset:
    def test_update_dataset(
        self, runs_client, test_user, test_org, test_membership,
        runs_permissions, test_dataset,
    ):
        token = _make_bearer_token(test_user, test_org)
        resp = runs_client.patch(
            f"/api/datasets/{test_dataset.dataset_id}",
            json={"name": "Updated Dataset Name"},
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Updated Dataset Name"


class TestGetDatasetSchema:
    def test_get_dataset_schema(
        self, runs_client, test_user, test_org, test_membership,
        runs_permissions, test_dataset,
    ):
        token = _make_bearer_token(test_user, test_org)
        resp = runs_client.get(
            f"/api/datasets/{test_dataset.dataset_id}/schema",
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["dataset_id"] == str(test_dataset.dataset_id)
        assert "schema_ref" in data
        assert data["schema_ref"]["schema_id"] == f"dataset-{test_dataset.dataset_id}"
        assert data["schema_ref"]["schema_version"] == "1.0"
        assert "schema_json" in data["schema_ref"]
