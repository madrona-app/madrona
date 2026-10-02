"""
Smoke tests for the Exhibit Exports API module.

Covers:
- List exports (empty and after creation)
- Export generation endpoints (elevation PDF, installation spec, etc.)
- Execution Pack endpoints (checklist PDF, shipment PDF, object-list CSV/PDF, budget CSV)
- Execution dashboard
- 404 for nonexistent exhibition
- 401 when unauthenticated

Uses SQLite in-memory database via the conftest fixtures.
"""

import json
import uuid
from unittest.mock import patch, MagicMock

import pytest

from app.models import Exhibition, ExhibitionFloorPlan, Export, FloorPlan, Venue


# ============================================================================
# Helpers
# ============================================================================

def _post_json(auth_client, url, data):
    """Helper for POST with JSON body."""
    return auth_client.post(url, data=json.dumps(data), content_type="application/json")


def _collections_exports_url(org, exhibition_id, suffix=""):
    """Build URL under the collections/exhibitions exports path."""
    base = f"/organizations/{org.organization_id}/collections/exhibitions/{exhibition_id}/exports"
    return f"{base}{suffix}"


def _exhibit_exports_url(org, exhibition_id, suffix=""):
    """Build URL under the exhibit/exhibitions exports path."""
    base = f"/organizations/{org.organization_id}/exhibit/exhibitions/{exhibition_id}/exports"
    return f"{base}{suffix}"


def _execution_dashboard_url(org, exhibition_id):
    """Build URL for execution dashboard."""
    return f"/organizations/{org.organization_id}/exhibit/exhibitions/{exhibition_id}/execution-dashboard"


def _create_exhibition(db_session, org):
    """Insert an Exhibition directly via the ORM and return it."""
    exhibition = Exhibition(
        organization_id=org.organization_id,
        title="Test Exhibition",
        description="For export testing",
        status="in_preparation",
        exhibition_type="temporary",
    )
    db_session.add(exhibition)
    db_session.commit()
    db_session.refresh(exhibition)
    return exhibition


# ============================================================================
# _get_exhibition_data — the shared loader behind every export
# ============================================================================

class TestGetExhibitionData:
    """Exercise the real loader. Every export test below mocks it.

    That mocking is why all three PDF exports could return 500 for every
    exhibition while sixteen tests stayed green: the loader queried
    `FloorPlan.exhibition_id`, which is not a column — floor plans belong to a
    venue and reach an exhibition through exhibition_floor_plans — so it raised
    AttributeError before touching a row. A test that patches the loader cannot
    see that, and one of them carried a comment noting the missing column
    rather than treating it as the bug it was.

    These two tests call it for real. The first would have caught the original
    fault on its own: the query was malformed at construction, so it failed
    with no data present at all.
    """

    def test_loads_an_exhibition_with_no_floor_plans(self, auth_setup, db_session):
        from app.fastapi_app.routers.exhibit_exports import _get_exhibition_data

        _, org, _ = auth_setup
        exhibition = _create_exhibition(db_session, org)

        data, floor_plans, placements = _get_exhibition_data(
            db_session, org.organization_id, exhibition.exhibition_id
        )

        assert data["exhibition_id"] == str(exhibition.exhibition_id)
        assert data["title"] == "Test Exhibition"
        assert floor_plans == []
        assert placements == []

    def test_returns_floor_plans_linked_through_the_join_table(self, auth_setup, db_session):
        from app.fastapi_app.routers.exhibit_exports import _get_exhibition_data

        _, org, _ = auth_setup
        exhibition = _create_exhibition(db_session, org)

        venue = Venue(organization_id=org.organization_id, name="Test Venue")
        db_session.add(venue)
        db_session.flush()

        floor_plan = FloorPlan(
            venue_id=venue.venue_id,
            name="Main Hall",
            geometry={"type": "rectangular", "width_cm": 800, "depth_cm": 600},
        )
        db_session.add(floor_plan)
        db_session.flush()

        db_session.add(ExhibitionFloorPlan(
            exhibition_id=exhibition.exhibition_id,
            floor_plan_id=floor_plan.floor_plan_id,
        ))
        db_session.commit()

        _, floor_plans, _ = _get_exhibition_data(
            db_session, org.organization_id, exhibition.exhibition_id
        )

        assert [fp["name"] for fp in floor_plans] == ["Main Hall"]


# ============================================================================
# List Exports
# ============================================================================

class TestListExports:
    def test_list_exports_empty(self, auth_setup, db_session):
        """GET .../exports returns empty list when no exports exist."""
        auth_client, org, _ = auth_setup
        exhibition = _create_exhibition(db_session, org)

        url = _collections_exports_url(org, exhibition.exhibition_id)
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert "exports" in data
        assert data["exports"] == []

    def test_list_exports_exhibition_not_found(self, auth_setup):
        """GET .../exports for nonexistent exhibition returns 404."""
        auth_client, org, _ = auth_setup
        fake_id = str(uuid.uuid4())
        url = _collections_exports_url(org, fake_id)
        resp = auth_client.get(url)
        assert resp.status_code == 404

    def test_list_exports_unauthenticated(self, client, auth_setup, db_session):
        """GET .../exports without auth token returns 401."""
        _, org, _ = auth_setup
        exhibition = _create_exhibition(db_session, org)
        url = _collections_exports_url(org, exhibition.exhibition_id)
        resp = client.get(url)
        assert resp.status_code == 401


# ============================================================================
# Elevation PDF Export
# ============================================================================

class TestElevationPdfExport:
    @patch("app.fastapi_app.routers.exhibit_exports._record_export")
    @patch("app.fastapi_app.routers.exhibit_exports.ElevationPDFGenerator")
    @patch("app.fastapi_app.routers.exhibit_exports._get_exhibition_data")
    def test_generate_elevation_pdf(self, mock_get_data, mock_gen_cls, mock_record, auth_setup, db_session):
        """POST .../exports/elevation-pdf returns a PDF response."""
        auth_client, org, _ = auth_setup
        exhibition = _create_exhibition(db_session, org)

        # Mocked to keep this test on the endpoint's own behaviour. The loader
        # itself is covered for real by TestGetExhibitionData above — it used to
        # be mocked because it was broken, which hid the break.
        mock_get_data.return_value = (
            {
                "exhibition_id": str(exhibition.exhibition_id),
                "title": "Test Exhibition",
                "description": "For export testing",
                "status": "in_preparation",
            },
            [{"floor_plan_id": str(uuid.uuid4()), "name": "Main Hall",
              "geometry": {"type": "rectangular", "width_cm": 800, "depth_cm": 600},
              "wall_color": "#FFFFFF", "ceiling_height_cm": 300}],
            [],
        )

        # Mock the PDF generator
        mock_instance = MagicMock()
        mock_instance.generate.return_value = b"%PDF-1.4 fake content"
        mock_gen_cls.return_value = mock_instance

        # Mock _record_export to avoid Export model constructor issue
        mock_record.return_value = MagicMock()

        url = _collections_exports_url(org, exhibition.exhibition_id, "/elevation-pdf")
        resp = _post_json(auth_client, url, {"scale": 25})
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/pdf"
        assert b"%PDF" in resp.content

    def test_elevation_pdf_exhibition_not_found(self, auth_setup):
        """POST .../exports/elevation-pdf for missing exhibition returns 404."""
        auth_client, org, _ = auth_setup
        fake_id = str(uuid.uuid4())
        url = _collections_exports_url(org, fake_id, "/elevation-pdf")
        resp = _post_json(auth_client, url, {})
        assert resp.status_code == 404

    def test_elevation_pdf_unauthenticated(self, client, auth_setup, db_session):
        """POST .../exports/elevation-pdf without auth returns 401."""
        _, org, _ = auth_setup
        exhibition = _create_exhibition(db_session, org)
        url = _collections_exports_url(org, exhibition.exhibition_id, "/elevation-pdf")
        resp = client.post(url, data=json.dumps({}), content_type="application/json")
        assert resp.status_code == 401


# ============================================================================
# Installation Spec Export
# ============================================================================

class TestInstallationSpecExport:
    @patch("app.fastapi_app.routers.exhibit_exports._record_export")
    @patch("app.fastapi_app.routers.exhibit_exports.InstallationSpecGenerator")
    @patch("app.fastapi_app.routers.exhibit_exports._get_exhibition_data")
    def test_generate_installation_spec(self, mock_get_data, mock_gen_cls, mock_record, auth_setup, db_session):
        """POST .../exports/installation-spec returns a PDF response."""
        auth_client, org, _ = auth_setup
        exhibition = _create_exhibition(db_session, org)

        mock_get_data.return_value = (
            {
                "exhibition_id": str(exhibition.exhibition_id),
                "title": "Test Exhibition",
                "description": "For export testing",
                "status": "in_preparation",
            },
            [{"floor_plan_id": str(uuid.uuid4()), "name": "Gallery A",
              "geometry": {"type": "rectangular", "width_cm": 600, "depth_cm": 400},
              "wall_color": "#FFFFFF", "ceiling_height_cm": 300}],
            [],
        )

        mock_instance = MagicMock()
        mock_instance.generate.return_value = b"%PDF-1.4 install spec"
        mock_gen_cls.return_value = mock_instance

        mock_record.return_value = MagicMock()

        url = _collections_exports_url(org, exhibition.exhibition_id, "/installation-spec")
        resp = _post_json(auth_client, url, {})
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/pdf"


# ============================================================================
# Object Checklist Export
# ============================================================================

class TestObjectChecklistExport:
    @patch("app.fastapi_app.routers.exhibit_exports.ObjectChecklistGenerator")
    @patch("app.fastapi_app.routers.exhibit_exports._get_exhibition_data")
    def test_generate_object_checklist(self, mock_get_data, mock_gen_cls, auth_setup, db_session):
        """POST .../exports/object-checklist returns a PDF response."""
        auth_client, org, _ = auth_setup
        exhibition = _create_exhibition(db_session, org)

        # Mock _get_exhibition_data since the route passes `db` (the extension) not `session`
        mock_get_data.return_value = (
            {
                "exhibition_id": str(exhibition.exhibition_id),
                "title": "Test Exhibition",
                "description": "For export testing",
                "status": "in_preparation",
            },
            [],  # floor_plans
            [],  # placements
        )

        mock_instance = MagicMock()
        mock_instance.generate.return_value = b"%PDF-1.4 checklist"
        mock_gen_cls.return_value = mock_instance

        url = _collections_exports_url(org, exhibition.exhibition_id, "/object-checklist")
        resp = _post_json(auth_client, url, {"include_images": False})
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/pdf"


# ============================================================================
# Execution Pack - Checklist PDF
# ============================================================================

class TestExecutionPackChecklistPdf:
    @patch("app.fastapi_app.routers.exhibit_exports.ChecklistPDFGenerator")
    def test_export_checklist_pdf(self, mock_gen_cls, auth_setup, db_session):
        """POST .../execution-pack/checklist-pdf returns a PDF."""
        auth_client, org, _ = auth_setup
        exhibition = _create_exhibition(db_session, org)

        mock_instance = MagicMock()
        mock_instance.generate.return_value = b"%PDF-1.4 checklist-pack"
        mock_gen_cls.return_value = mock_instance

        url = _exhibit_exports_url(org, exhibition.exhibition_id, "/execution-pack/checklist-pdf")
        resp = _post_json(auth_client, url, {})
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/pdf"

    def test_checklist_pdf_exhibition_not_found(self, auth_setup):
        """POST .../execution-pack/checklist-pdf for missing exhibition returns 404."""
        auth_client, org, _ = auth_setup
        fake_id = str(uuid.uuid4())
        url = _exhibit_exports_url(org, fake_id, "/execution-pack/checklist-pdf")
        resp = _post_json(auth_client, url, {})
        assert resp.status_code == 404


# ============================================================================
# Execution Pack - Shipment PDF
# ============================================================================

class TestExecutionPackShipmentPdf:
    @patch("app.fastapi_app.routers.exhibit_exports.ShipmentSummaryPDFGenerator")
    def test_export_shipment_pdf(self, mock_gen_cls, auth_setup, db_session):
        """POST .../execution-pack/shipment-pdf returns a PDF."""
        auth_client, org, _ = auth_setup
        exhibition = _create_exhibition(db_session, org)

        mock_instance = MagicMock()
        mock_instance.generate.return_value = b"%PDF-1.4 shipments"
        mock_gen_cls.return_value = mock_instance

        url = _exhibit_exports_url(org, exhibition.exhibition_id, "/execution-pack/shipment-pdf")
        resp = _post_json(auth_client, url, {})
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/pdf"


# ============================================================================
# Execution Pack - Object List CSV
# ============================================================================

class TestExecutionPackObjectListCsv:
    @patch("app.fastapi_app.routers.exhibit_exports.export_to_csv")
    def test_export_object_list_csv(self, mock_csv, auth_setup, db_session):
        """POST .../execution-pack/object-list-csv returns CSV content."""
        auth_client, org, _ = auth_setup
        exhibition = _create_exhibition(db_session, org)

        mock_csv.return_value = b"Object Identifier,Title\nP-abc,Test\n"

        url = _exhibit_exports_url(org, exhibition.exhibition_id, "/execution-pack/object-list-csv")
        resp = _post_json(auth_client, url, {})
        assert resp.status_code == 200
        assert "text/csv" in resp.headers["content-type"]


# ============================================================================
# Execution Pack - Budget CSV
# ============================================================================

class TestExecutionPackBudgetCsv:
    def test_export_budget_csv(self, auth_setup, db_session):
        """POST .../execution-pack/budget-csv returns CSV content."""
        auth_client, org, _ = auth_setup
        exhibition = _create_exhibition(db_session, org)

        url = _exhibit_exports_url(org, exhibition.exhibition_id, "/execution-pack/budget-csv")
        resp = _post_json(auth_client, url, {"include_line_items": True})
        assert resp.status_code == 200
        assert "text/csv" in resp.headers["content-type"]


# ============================================================================
# Execution Dashboard
# ============================================================================

class TestExecutionDashboard:
    def test_execution_dashboard(self, auth_setup, db_session):
        """GET .../execution-dashboard returns aggregated metrics."""
        auth_client, org, _ = auth_setup
        exhibition = _create_exhibition(db_session, org)

        url = _execution_dashboard_url(org, exhibition.exhibition_id)
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert "exhibition" in data
        assert "checklist" in data
        assert "shipments" in data
        assert "loans" in data
        assert "budget" in data
        assert data["exhibition"]["title"] == "Test Exhibition"

    def test_execution_dashboard_not_found(self, auth_setup):
        """GET .../execution-dashboard for nonexistent exhibition returns 404."""
        auth_client, org, _ = auth_setup
        fake_id = str(uuid.uuid4())
        url = _execution_dashboard_url(org, fake_id)
        resp = auth_client.get(url)
        assert resp.status_code == 404

    def test_execution_dashboard_unauthenticated(self, client, auth_setup, db_session):
        """GET .../execution-dashboard without auth returns 401."""
        _, org, _ = auth_setup
        exhibition = _create_exhibition(db_session, org)
        url = _execution_dashboard_url(org, exhibition.exhibition_id)
        resp = client.get(url)
        assert resp.status_code == 401
