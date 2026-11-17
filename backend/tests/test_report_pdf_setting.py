"""Per-organization PDF report setting (Organization.report_pdf_mode) and
tagged-PDF output for document reports."""
import json
import re
import zlib
from unittest.mock import MagicMock, patch

import pytest

from app.database import current_session
from app.models import Organization
from app.services.report_registry import ReportDefinition, ReportRegistry


def _definition(key, *, pdf_tagged, formats=("html", "txt", "csv", "excel", "pdf"), default="pdf"):
    return ReportDefinition(
        report_key=key, name=key, description="", category="Test", style="tabular",
        context_types=["record"], record_types=["collection_objects"],
        supported_formats=list(formats), resolver=lambda *a, **k: [],
        renderer=lambda *a, **k: (b"", "text/csv", "csv"), default_format=default,
        pdf_tagged=pdf_tagged,
    )


@pytest.fixture(autouse=True)
def _registry():
    original = ReportRegistry._instance
    ReportRegistry._instance = None
    reg = ReportRegistry.get_instance()
    reg.register(_definition("tagged_doc", pdf_tagged=True))
    reg.register(_definition("untagged_table", pdf_tagged=False))
    reg.register(_definition("pdf_only", pdf_tagged=False, formats=("pdf",)))
    yield reg
    ReportRegistry._instance = original


@pytest.fixture
def mock_task():
    task = MagicMock()
    with patch("app.tasks.reports.generate_on_demand_report_task", task):
        yield task


def _set_mode(org, mode):
    o = current_session().query(Organization).filter_by(organization_id=org.organization_id).one()
    o.report_pdf_mode = mode
    current_session().flush()


def _available(auth_client, org):
    resp = auth_client.get(
        f"/api/organizations/{org.organization_id}/on-demand-reports/available"
        "?context_type=record&record_type=collection_objects"
    )
    assert resp.status_code == 200
    return {r["report_key"]: r for r in resp.get_json()["reports"]}


def _generate(auth_client, org, key, fmt=None):
    body = {"report_key": key, "context_type": "record",
            "context_params": {"record_id": "6f1c1d2e-0000-4000-8000-000000000001",
                               "record_type": "collection_objects"}}
    if fmt:
        body["export_format"] = fmt
    return auth_client.post(f"/api/organizations/{org.organization_id}/on-demand-reports/generate",
                            data=json.dumps(body), content_type="application/json")


class TestAvailableFormats:
    def test_default_offers_everything_accessible_first(self, auth_setup):
        auth_client, org, _ = auth_setup
        reports = _available(auth_client, org)
        assert reports["tagged_doc"]["supported_formats"] == ["html", "txt", "csv", "excel", "pdf"]
        assert reports["untagged_table"]["supported_formats"][-1] == "pdf"
        assert reports["tagged_doc"]["default_format"] == "pdf"  # unchanged behaviour

    def test_tagged_only_hides_untagged_pdf(self, auth_setup):
        auth_client, org, _ = auth_setup
        _set_mode(org, "tagged_only")
        reports = _available(auth_client, org)
        assert "pdf" in reports["tagged_doc"]["supported_formats"]
        assert "pdf" not in reports["untagged_table"]["supported_formats"]
        assert reports["untagged_table"]["default_format"] == "html"
        assert "pdf_only" not in reports  # nothing left to offer

    def test_none_hides_all_pdf(self, auth_setup):
        auth_client, org, _ = auth_setup
        _set_mode(org, "none")
        reports = _available(auth_client, org)
        assert all("pdf" not in r["supported_formats"] for r in reports.values())
        assert reports["tagged_doc"]["default_format"] == "html"


class TestGenerateRespectsSetting:
    def test_pdf_rejected_when_hidden(self, auth_setup, mock_task):
        auth_client, org, _ = auth_setup
        _set_mode(org, "none")
        resp = _generate(auth_client, org, "tagged_doc", "pdf")
        assert resp.status_code == 400
        mock_task.delay.assert_not_called()

    def test_untagged_pdf_rejected_in_tagged_only(self, auth_setup, mock_task):
        auth_client, org, _ = auth_setup
        _set_mode(org, "tagged_only")
        assert _generate(auth_client, org, "untagged_table", "pdf").status_code == 400
        assert _generate(auth_client, org, "tagged_doc", "pdf").status_code == 202

    def test_default_falls_back_to_accessible_format(self, auth_setup, mock_task):
        auth_client, org, _ = auth_setup
        _set_mode(org, "none")
        resp = _generate(auth_client, org, "tagged_doc")
        assert resp.status_code == 202
        assert resp.get_json()["export_format"] == "html"

    def test_html_and_txt_accepted(self, auth_setup, mock_task):
        auth_client, org, _ = auth_setup
        assert _generate(auth_client, org, "untagged_table", "html").status_code == 202
        assert _generate(auth_client, org, "untagged_table", "txt").status_code == 202


class TestSettingEndpoints:
    def test_get_and_put(self, auth_setup):
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/settings/report-formats"
        assert auth_client.get(url).get_json() == {"pdf_mode": "all"}
        resp = auth_client.put(url, data=json.dumps({"pdf_mode": "tagged_only"}),
                               content_type="application/json")
        assert resp.status_code == 200 and resp.get_json() == {"pdf_mode": "tagged_only"}
        assert auth_client.get(url).get_json() == {"pdf_mode": "tagged_only"}

    @pytest.mark.parametrize("body", [{}, {"pdf_mode": "maybe"}, {"pdf_mode": True}])
    def test_rejects_invalid(self, auth_setup, body):
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/settings/report-formats"
        resp = auth_client.put(url, data=json.dumps(body), content_type="application/json")
        assert resp.status_code == 422


class TestRegisteredDefinitions:
    def test_document_reports_tagged_tabular_not(self):
        # The autouse fixture restores the previous singleton afterwards.
        import importlib
        import app.services.report_definitions.document_reports as dr
        import app.services.report_definitions.tabular_exports as te
        ReportRegistry._instance = None
        importlib.reload(te)
        importlib.reload(dr)
        reg = ReportRegistry.get_instance()
        assert reg.get("object_record_sheet").pdf_tagged is True
        assert reg.get("object_record_sheet").supported_formats == ["html", "docx", "txt", "pdf"]
        assert reg.get("collection_objects_tabular").pdf_tagged is False
        assert reg.get("collection_objects_tabular").supported_formats == ["html", "txt", "csv", "excel", "pdf"]


# ============================================================================
# Real WeasyPrint output — skipped where the native libraries are missing
# ============================================================================

def _weasyprint_available():
    try:
        import weasyprint  # noqa: F401
        return True
    except OSError:
        return False


def _expand_pdf(b: bytes) -> bytes:
    out = [b]
    for m in re.finditer(rb"stream\r?\n(.*?)\r?\nendstream", b, re.S):
        try:
            out.append(zlib.decompress(m.group(1)))
        except Exception:
            pass
    return b"\n".join(out)


@pytest.mark.skipif(not _weasyprint_available(), reason="WeasyPrint native libraries not installed")
class TestTaggedPdf:
    def test_object_record_sheet_pdf_is_tagged(self):
        from app.services import report_document_renderer as rdr
        png = ("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")
        with patch.object(rdr, "_fetch_primary_image_b64", return_value=(png, "image/png", "Green bowl")), \
                patch.object(rdr, "_fetch_attachments_for_record",
                             return_value=[{"filename": "a.pdf", "type_label": "Document", "title": "T"}]):
            pdf = rdr.render_object_record_sheet_html(
                [{"object_number": "1", "object_name": "Bowl", "color": "green", "form": "round"}],
                {"organization_name": "M"},
            )
        b = _expand_pdf(pdf)
        assert b"/StructTreeRoot" in b
        assert re.search(rb"/Lang \(en\)", b)
        assert b"/DisplayDocTitle true" in b
        assert b"/S /H1" in b and b"/S /H2" in b
        assert re.search(rb"/Alt \(Green bowl\)", b)
        # Exactly one Table element: the attachments data table. Field
        # layout is divs, so nothing is falsely announced as a table.
        assert len(re.findall(rb"/S /Table\b", b)) == 1
        assert b"/S /TH" in b and b"/S /Caption" in b

    def test_loan_agreement_has_no_layout_tables(self):
        from app.services import report_document_renderer as rdr
        with patch.object(rdr, "_fetch_loan_objects", return_value=[]):
            pdf = rdr.render_loan_agreement_html(
                [{"loan_number": "L-1", "lender_name": "P", "loan_purpose": "x", "status": "y"}],
                {"organization_name": "M"},
            )
        b = _expand_pdf(pdf)
        assert b"/StructTreeRoot" in b
        assert len(re.findall(rb"/S /Table\b", b)) == 0
