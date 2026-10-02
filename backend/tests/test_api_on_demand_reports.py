"""
Tests for the On-Demand Reports API endpoints.

Routes under /api/organizations/<org_id>/on-demand-reports/*.
Tests run against SQLite in-memory database via the conftest fixtures.
"""

import json
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from app.models import ReportRun
from app.services.report_registry import ReportDefinition, ReportRegistry

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _post_json(auth_client, url, data):
    """Helper for POST with JSON body."""
    return auth_client.post(
        url,
        data=json.dumps(data),
        content_type="application/json",
    )


def _base_url(org, path=""):
    """Build a URL under the on-demand-reports blueprint."""
    return f"/api/organizations/{org.organization_id}/on-demand-reports{path}"


def _make_definition(**overrides) -> ReportDefinition:
    """Create a ReportDefinition with sensible defaults."""
    defaults = dict(
        report_key="test_tabular",
        name="Test Tabular Export",
        description="A tabular export for testing",
        category="Tabular Export",
        style="tabular",
        context_types=["search", "workspace", "record"],
        record_types=["collection_objects", "condition_reports"],
        supported_formats=["csv", "excel", "pdf"],
        resolver=lambda *a, **kw: [],
        renderer=lambda *a, **kw: (b"", "text/csv", "csv"),
        default_format="excel",
    )
    defaults.update(overrides)
    return ReportDefinition(**defaults)


@pytest.fixture(autouse=True)
def _clean_registry():
    """Reset the report registry singleton before each test."""
    original = ReportRegistry._instance
    ReportRegistry._instance = None
    yield
    ReportRegistry._instance = original


@pytest.fixture
def registry_with_definition():
    """Provide a registry that has a test definition registered."""
    registry = ReportRegistry.get_instance()
    registry.register(_make_definition())
    return registry


@pytest.fixture
def mock_celery_task():
    """Mock the Celery task so it doesn't actually run.

    The endpoint uses a deferred import:
        from app.tasks.reports import generate_on_demand_report_task
    so we patch at the source module level.
    """
    mock_task = MagicMock()
    mock_task.delay = MagicMock()
    with patch(
        "app.tasks.reports.generate_on_demand_report_task",
        mock_task,
    ):
        yield mock_task


# ============================================================================
# GET /available — list reports for context
# ============================================================================


class TestListAvailableReports:
    def test_returns_reports_for_context(self, auth_setup, registry_with_definition):
        """GET /available returns reports filtered by context_type and record_type."""
        auth_client, org, _ = auth_setup
        resp = auth_client.get(
            _base_url(org, "/available?context_type=record&record_type=collection_objects")
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] >= 1
        keys = [r["report_key"] for r in data["reports"]]
        assert "test_tabular" in keys

    def test_returns_empty_for_unknown_context(self, auth_setup, registry_with_definition):
        """GET /available returns empty list for unsupported context/record combo."""
        auth_client, org, _ = auth_setup
        # Register a definition that only supports "search" context
        registry = ReportRegistry.get_instance()
        registry.register(_make_definition(
            report_key="search_only",
            context_types=["search"],
            record_types=["some_other_type"],
        ))
        resp = auth_client.get(
            _base_url(org, "/available?context_type=record&record_type=some_other_type")
        )
        assert resp.status_code == 200
        data = resp.get_json()
        # "search_only" should NOT appear for context_type=record
        keys = [r["report_key"] for r in data["reports"]]
        assert "search_only" not in keys

    def test_missing_context_type_returns_400(self, auth_setup):
        """GET /available without context_type returns 400."""
        auth_client, org, _ = auth_setup
        resp = auth_client.get(_base_url(org, "/available"))
        assert resp.status_code in (400, 422)

    def test_invalid_context_type_returns_400(self, auth_setup):
        """GET /available with invalid context_type returns 400."""
        auth_client, org, _ = auth_setup
        resp = auth_client.get(_base_url(org, "/available?context_type=invalid"))
        assert resp.status_code in (400, 422)

    def test_global_context_returns_reports(self, auth_setup):
        """GET /available?context_type=global returns global reports."""
        auth_client, org, _ = auth_setup
        registry = ReportRegistry.get_instance()
        registry.register(_make_definition(
            report_key="global_test",
            context_types=["global"],
            record_types=[],
        ))
        resp = auth_client.get(_base_url(org, "/available?context_type=global"))
        assert resp.status_code == 200
        data = resp.get_json()
        keys = [r["report_key"] for r in data["reports"]]
        assert "global_test" in keys

    def test_global_context_excludes_workspace_only_reports(self, auth_setup, registry_with_definition):
        """GET /available?context_type=global does not return workspace-only reports."""
        auth_client, org, _ = auth_setup
        resp = auth_client.get(_base_url(org, "/available?context_type=global"))
        assert resp.status_code == 200
        data = resp.get_json()
        keys = [r["report_key"] for r in data["reports"]]
        assert "test_tabular" not in keys


# ============================================================================
# POST /generate — trigger report generation
# ============================================================================


class TestGenerateReport:
    def test_creates_run_and_returns_202(
        self, auth_setup, db_session, registry_with_definition, mock_celery_task,
    ):
        """POST /generate creates a ReportRun and returns 202."""
        auth_client, org, _ = auth_setup
        resp = _post_json(auth_client, _base_url(org, "/generate"), {
            "report_key": "test_tabular",
            "context_type": "record",
            "context_params": {
                "record_id": str(uuid4()),
                "record_type": "collection_objects",
            },
            "export_format": "pdf",
        })
        assert resp.status_code == 202
        data = resp.get_json()
        assert data["status"] == "pending"
        assert data["report_key"] == "test_tabular"
        assert data["export_format"] == "pdf"
        assert "run_id" in data

        # Verify Celery task was queued
        mock_celery_task.delay.assert_called_once()

    def test_invalid_report_key_returns_404(
        self, auth_setup, registry_with_definition, mock_celery_task,
    ):
        """POST /generate with nonexistent report_key returns 404."""
        auth_client, org, _ = auth_setup
        resp = _post_json(auth_client, _base_url(org, "/generate"), {
            "report_key": "nonexistent_report",
            "context_type": "record",
            "context_params": {
                "record_id": str(uuid4()),
                "record_type": "collection_objects",
            },
        })
        assert resp.status_code == 404

    def test_missing_report_key_returns_400(self, auth_setup):
        """POST /generate without report_key returns 400."""
        auth_client, org, _ = auth_setup
        resp = _post_json(auth_client, _base_url(org, "/generate"), {
            "context_type": "record",
            "context_params": {"record_id": str(uuid4()), "record_type": "x"},
        })
        assert resp.status_code in (400, 422)

    def test_missing_context_type_returns_400(self, auth_setup, registry_with_definition):
        """POST /generate without context_type returns 400."""
        auth_client, org, _ = auth_setup
        resp = _post_json(auth_client, _base_url(org, "/generate"), {
            "report_key": "test_tabular",
            "context_params": {"record_id": str(uuid4()), "record_type": "x"},
        })
        assert resp.status_code in (400, 422)

    def test_missing_required_context_params_returns_400(
        self, auth_setup, registry_with_definition, mock_celery_task,
    ):
        """POST /generate with missing required context_params fields returns 400."""
        auth_client, org, _ = auth_setup
        # record context requires record_id and record_type
        resp = _post_json(auth_client, _base_url(org, "/generate"), {
            "report_key": "test_tabular",
            "context_type": "record",
            "context_params": {},
        })
        assert resp.status_code in (400, 422)
        data = resp.get_json()
        assert "missing" in (data.get("error").get("message", "") if isinstance(data.get("error"), dict) else (data.get("error") or str(data.get("detail", "")))).lower()

    def test_uses_default_format_when_not_specified(
        self, auth_setup, db_session, registry_with_definition, mock_celery_task,
    ):
        """POST /generate without export_format uses the definition's default."""
        auth_client, org, _ = auth_setup
        resp = _post_json(auth_client, _base_url(org, "/generate"), {
            "report_key": "test_tabular",
            "context_type": "record",
            "context_params": {
                "record_id": str(uuid4()),
                "record_type": "collection_objects",
            },
        })
        assert resp.status_code == 202
        data = resp.get_json()
        assert data["export_format"] == "excel"  # default from definition

    def test_unsupported_format_returns_400(
        self, auth_setup, registry_with_definition, mock_celery_task,
    ):
        """POST /generate with unsupported export_format returns 400."""
        auth_client, org, _ = auth_setup
        resp = _post_json(auth_client, _base_url(org, "/generate"), {
            "report_key": "test_tabular",
            "context_type": "record",
            "context_params": {
                "record_id": str(uuid4()),
                "record_type": "collection_objects",
            },
            "export_format": "docx",
        })
        assert resp.status_code in (400, 422)

    def test_global_context_generates_report(
        self, auth_setup, db_session, mock_celery_task,
    ):
        """POST /generate with global context_type creates a run (no required params)."""
        registry = ReportRegistry.get_instance()
        registry.register(_make_definition(
            report_key="displaced_objects_report",
            context_types=["global"],
            record_types=[],
        ))
        auth_client, org, _ = auth_setup
        resp = _post_json(auth_client, _base_url(org, "/generate"), {
            "report_key": "displaced_objects_report",
            "context_type": "global",
            "context_params": {},
        })
        assert resp.status_code == 202
        data = resp.get_json()
        assert data["status"] == "pending"
        assert data["report_key"] == "displaced_objects_report"
        mock_celery_task.delay.assert_called_once()

    def test_global_context_no_uuid_validation_needed(
        self, auth_setup, db_session, mock_celery_task,
    ):
        """POST /generate with global context passes even with optional params."""
        registry = ReportRegistry.get_instance()
        registry.register(_make_definition(
            report_key="empty_locations_report",
            context_types=["global"],
            record_types=[],
        ))
        auth_client, org, _ = auth_setup
        resp = _post_json(auth_client, _base_url(org, "/generate"), {
            "report_key": "empty_locations_report",
            "context_type": "global",
            "context_params": {"some_filter": "value"},
        })
        assert resp.status_code == 202


# ============================================================================
# GET /runs — list user's report runs
# ============================================================================


class TestListReportRuns:
    def _create_run(self, db_session, org_id, user_id, **overrides):
        """Create a ReportRun directly in the DB."""
        defaults = dict(
            organization_id=org_id,
            status="completed",
            triggered_by="on_demand",
            report_key="test_tabular",
            context_type="record",
            context_params={"record_id": str(uuid4()), "record_type": "x"},
            export_format="csv",
            triggered_by_user_id=user_id,
        )
        defaults.update(overrides)
        run = ReportRun(**defaults)
        db_session.add(run)
        db_session.commit()
        return run

    def test_returns_runs_with_pagination(self, auth_setup, db_session):
        """GET /runs returns the current user's runs."""
        auth_client, org, user = auth_setup
        self._create_run(db_session, org.organization_id, user.user_id)
        self._create_run(db_session, org.organization_id, user.user_id)

        resp = auth_client.get(_base_url(org, "/runs?limit=10&offset=0"))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 2
        assert len(data["items"]) == 2
        assert data["limit"] == 10
        assert data["offset"] == 0

    def test_only_returns_current_users_runs(self, auth_setup, db_session):
        """GET /runs only returns runs belonging to the current user, not other users."""
        from app.models import User
        auth_client, org, user = auth_setup

        # Create a run for the current user
        self._create_run(db_session, org.organization_id, user.user_id)

        # Seed a real second User so the triggered_by_user_id FK resolves.
        other_user = User(
            email=f"other-{uuid4().hex[:8]}@example.com",
            status="active",
            password_hash="",
        )
        db_session.add(other_user)
        db_session.flush()
        self._create_run(
            db_session, org.organization_id, other_user.user_id,
            report_key="other_report",
        )

        resp = auth_client.get(_base_url(org, "/runs"))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1
        # All returned runs should belong to the current user
        for run in data["items"]:
            assert run["report_key"] == "test_tabular"

    def test_filters_by_status(self, auth_setup, db_session):
        """GET /runs?status=completed only returns completed runs."""
        auth_client, org, user = auth_setup
        self._create_run(db_session, org.organization_id, user.user_id, status="completed")
        self._create_run(db_session, org.organization_id, user.user_id, status="pending")

        resp = auth_client.get(_base_url(org, "/runs?status=completed"))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1
        assert data["items"][0]["status"] == "completed"


# ============================================================================
# GET /runs/:id — get single run
# ============================================================================


class TestGetReportRun:
    def test_returns_single_run(self, auth_setup, db_session):
        """GET /runs/<id> returns a single run."""
        auth_client, org, user = auth_setup
        run = ReportRun(
            organization_id=org.organization_id,
            status="completed",
            triggered_by="on_demand",
            report_key="test_tabular",
            context_type="record",
            export_format="csv",
            triggered_by_user_id=user.user_id,
            row_count=42,
        )
        db_session.add(run)
        db_session.commit()
        run_id = run.run_id

        resp = auth_client.get(_base_url(org, f"/runs/{run_id}"))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["run_id"] == str(run_id)
        assert data["row_count"] == 42

    def test_not_found_returns_404(self, auth_setup):
        """GET /runs/<nonexistent> returns 404."""
        auth_client, org, _ = auth_setup
        fake_id = str(uuid4())
        resp = auth_client.get(_base_url(org, f"/runs/{fake_id}"))
        assert resp.status_code == 404


# ============================================================================
# GET /runs/:id/download — download completed report
# ============================================================================


class TestDownloadReport:
    def test_returns_400_when_not_completed(self, auth_setup, db_session):
        """GET /runs/<id>/download returns 400 when run is not completed."""
        auth_client, org, user = auth_setup
        run = ReportRun(
            organization_id=org.organization_id,
            status="pending",
            triggered_by="on_demand",
            report_key="test_tabular",
            context_type="record",
            export_format="csv",
            triggered_by_user_id=user.user_id,
        )
        db_session.add(run)
        db_session.commit()
        run_id = run.run_id

        resp = auth_client.get(_base_url(org, f"/runs/{run_id}/download"))
        assert resp.status_code in (400, 422)
        data = resp.get_json()
        assert "pending" in (data.get("error").get("message", "") if isinstance(data.get("error"), dict) else (data.get("error") or str(data.get("detail", ""))))

    def test_returns_download_url_when_completed(self, auth_setup, db_session):
        """GET /runs/<id>/download returns presigned URL when completed with s3 key."""
        auth_client, org, user = auth_setup
        run = ReportRun(
            organization_id=org.organization_id,
            status="completed",
            triggered_by="on_demand",
            report_key="test_tabular",
            context_type="record",
            export_format="csv",
            export_s3_key="reports/test-org/test_file.csv",
            triggered_by_user_id=user.user_id,
        )
        db_session.add(run)
        db_session.commit()
        run_id = run.run_id

        with patch("app.services.report_storage.generate_download_url") as mock_download:
            mock_download.return_value = "https://s3.example.com/presigned"
            resp = auth_client.get(_base_url(org, f"/runs/{run_id}/download"))

        assert resp.status_code == 200
        data = resp.get_json()
        assert data["download_url"] == "https://s3.example.com/presigned"

    def test_not_found_returns_404(self, auth_setup):
        """GET /runs/<nonexistent>/download returns 404."""
        auth_client, org, _ = auth_setup
        fake_id = str(uuid4())
        resp = auth_client.get(_base_url(org, f"/runs/{fake_id}/download"))
        assert resp.status_code == 404


# ============================================================================
# Auth Required (401)
# ============================================================================


class TestAuthRequired:
    def test_available_unauthenticated(self, client, auth_setup):
        """GET /available without auth token returns 401."""
        _, org, _ = auth_setup
        resp = client.get(_base_url(org, "/available?context_type=record"))
        assert resp.status_code == 401

    def test_generate_unauthenticated(self, client, auth_setup):
        """POST /generate without auth token returns 401."""
        _, org, _ = auth_setup
        resp = client.post(
            _base_url(org, "/generate"),
            data=json.dumps({"report_key": "x", "context_type": "record"}),
            content_type="application/json",
        )
        assert resp.status_code == 401

    def test_runs_unauthenticated(self, client, auth_setup):
        """GET /runs without auth token returns 401."""
        _, org, _ = auth_setup
        resp = client.get(_base_url(org, "/runs"))
        assert resp.status_code == 401
