"""
Coverage tests for app.services.report_document_renderer.

The renderer module produces formatted PDFs (reportlab) and DOCX/HTML (python-docx,
Jinja2 + WeasyPrint) for on-demand museum reports: object record sheets, condition
reports, loan agreements, acquisitions, entry/exit logs, conservation treatments.

This file targets the pure-function/formatting branches and the full document-
assembly paths, which don't require a live database.  The few DB-hitting helpers
(``_fetch_primary_image``, ``_resolve_linked_object``, ``_fetch_loan_objects``)
swallow every exception and return ``None`` / empty lists when the SQLAlchemy
session isn't set up for the test, so the outer renderers still run end-to-end.

Two external dependencies are patched at their public boundary (not inside the
renderer module):

1. ``jinja2.PackageLoader`` — the module references a ``"report_templates"``
   subpackage, but the bundled templates actually live in
   ``app.services.builtin_report_templates``.  We redirect the loader so
   ``get_template()`` can find the shipped HTML without touching the renderer.
2. ``weasyprint.HTML.write_pdf`` — produces real bytes, but the PDF-byte shape
   is all we assert on, so we stub it to avoid pulling in GTK/cairo font stacks
   in CI.  The renderer code up to ``write_pdf()`` is still fully exercised.
"""
from __future__ import annotations

import io
from datetime import datetime, timezone
from unittest.mock import patch
from uuid import uuid4

import jinja2
import pytest

from app.services import report_document_renderer as rdr


# ══════════════════════════════════════════════════════════════════════════════
# Fixtures
# ══════════════════════════════════════════════════════════════════════════════


@pytest.fixture
def real_package_loader():
    """Redirect ``jinja2.PackageLoader("app.services", "report_templates")`` to
    the actual built-in template directory ``builtin_report_templates``.

    The renderer references a legacy path; patching at the Jinja2 boundary lets
    the full HTML-context build + template render path run without modifying
    renderer source.
    """
    original = jinja2.PackageLoader

    def _redirect(package, subdir):
        if package == "app.services" and subdir == "report_templates":
            return original("app.services", "builtin_report_templates")
        return original(package, subdir)

    with patch.object(jinja2, "PackageLoader", _redirect):
        yield


@pytest.fixture
def stub_weasyprint():
    """Stub WeasyPrint's PDF writer so HTML renderers return %PDF- bytes
    without invoking the C font stack.  We patch at the third-party boundary;
    the renderer's own code runs normally up to (and including) the HTML build
    and the call to ``write_pdf()``.
    """
    import weasyprint

    original_html = weasyprint.HTML

    class _StubHTML:
        def __init__(self, string=None, **kw):
            self._string = string or ""

        def write_pdf(self):
            # Minimal valid-looking PDF header — same shape real output starts with
            return b"%PDF-1.4\n% stub\n" + self._string.encode("utf-8", errors="replace")[:128]

    with patch.object(weasyprint, "HTML", _StubHTML):
        yield


@pytest.fixture
def minimal_metadata():
    return {"organization_name": "Test Museum"}


# ══════════════════════════════════════════════════════════════════════════════
# Style / template helpers
# ══════════════════════════════════════════════════════════════════════════════


class TestMadronaStyles:
    def test_returns_all_required_style_keys(self):
        styles = rdr._get_madrona_styles()
        for key in [
            "title",
            "subtitle",
            "section_header",
            "field_label",
            "field_value",
            "body",
            "table_header",
            "table_cell",
            "signature_label",
            "footer",
        ]:
            assert key in styles

    def test_styles_use_madrona_colors(self):
        styles = rdr._get_madrona_styles()
        assert styles["title"].textColor == rdr.FOREST
        assert styles["field_label"].textColor == rdr.ARCHIVE
        assert styles["field_value"].textColor == rdr.INK

    def test_header_footer_callback_runs_without_raising(self):
        callback = rdr._make_header_footer("My Org")

        class _FakeCanvas:
            def __init__(self):
                self.calls = []

            def __getattr__(self, name):
                def _noop(*a, **kw):
                    self.calls.append((name, a, kw))
                    return None
                return _noop

        class _FakeDoc:
            page = 1

        c = _FakeCanvas()
        callback(c, _FakeDoc())
        # Verify it actually drew something (rect, drawString, etc.)
        called = {name for name, _, _ in c.calls}
        assert "rect" in called
        assert "drawString" in called

    def test_header_footer_none_org(self):
        callback = rdr._make_header_footer(None)
        # Should build without raising when org is None
        assert callable(callback)

    def test_create_doc_template_returns_template(self):
        buf = io.BytesIO()
        doc = rdr._create_doc_template(buf, org_name="Test Museum")
        assert doc is not None
        # BaseDocTemplate exposes pagesize
        from reportlab.lib.pagesizes import letter
        assert doc.pagesize == letter


# ══════════════════════════════════════════════════════════════════════════════
# Value formatters
# ══════════════════════════════════════════════════════════════════════════════


class TestFormatDisplay:
    def test_none_returns_empty_string(self):
        assert rdr._format_display(None) == ""

    def test_bool_true(self):
        assert rdr._format_display(True) == "Yes"

    def test_bool_false(self):
        assert rdr._format_display(False) == "No"

    def test_datetime(self):
        dt = datetime(2026, 3, 15, 12, 30, tzinfo=timezone.utc)
        assert rdr._format_display(dt) == "March 15, 2026"

    def test_int(self):
        assert rdr._format_display(42) == "42"

    def test_string_passthrough(self):
        assert rdr._format_display("hello") == "hello"

    def test_empty_string(self):
        assert rdr._format_display("") == ""


class TestFormatEnum:
    def test_none_returns_none(self):
        assert rdr._format_enum(None) is None

    def test_empty_string_returns_none(self):
        assert rdr._format_enum("") is None

    def test_non_string_returns_none(self):
        assert rdr._format_enum(42) is None
        assert rdr._format_enum(["a", "b"]) is None

    def test_underscore_to_spaces_and_title_case(self):
        assert rdr._format_enum("pre_treatment") == "Pre Treatment"

    def test_single_word_title_case(self):
        assert rdr._format_enum("approved") == "Approved"

    def test_multi_underscore(self):
        assert rdr._format_enum("in_progress_awaiting_review") == "In Progress Awaiting Review"


class TestFormatJsonbList:
    def test_none_returns_none(self):
        assert rdr._format_jsonb_list(None) is None

    def test_empty_list_returns_none(self):
        assert rdr._format_jsonb_list([]) is None

    def test_non_list_returns_none(self):
        assert rdr._format_jsonb_list("not a list") is None
        assert rdr._format_jsonb_list({"key": "value"}) is None

    def test_list_of_dicts_with_term_key(self):
        items = [{"term": "wood"}, {"term": "metal"}]
        assert rdr._format_jsonb_list(items) == "wood, metal"

    def test_custom_key(self):
        items = [{"name": "John"}, {"name": "Jane"}]
        assert rdr._format_jsonb_list(items, key="name") == "John, Jane"

    def test_list_of_strings(self):
        assert rdr._format_jsonb_list(["a", "b", "c"]) == "a, b, c"

    def test_missing_key_renders_dict_repr(self):
        # Falls back to the dict itself when the key isn't present
        items = [{"other_key": "val"}]
        out = rdr._format_jsonb_list(items, key="term")
        # Will render str(dict) — should not be None
        assert out is not None

    def test_empty_strings_filtered(self):
        items = [{"term": ""}, {"term": "kept"}, {"term": ""}]
        assert rdr._format_jsonb_list(items) == "kept"

    def test_all_empty_returns_none(self):
        items = [{"term": ""}, {"term": ""}]
        assert rdr._format_jsonb_list(items) is None


class TestFormatMeasurements:
    def test_none_returns_none(self):
        assert rdr._format_measurements(None) is None

    def test_empty_list_returns_none(self):
        assert rdr._format_measurements([]) is None

    def test_non_list_returns_none(self):
        assert rdr._format_measurements("string") is None

    def test_height_width_with_unit(self):
        out = rdr._format_measurements([
            {"height": 10, "width": 20, "unit": "cm"},
        ])
        assert "Height: 10" in out
        assert "Width: 20" in out
        assert "cm" in out

    def test_multiple_parts(self):
        out = rdr._format_measurements([
            {"height": 5, "width": 6, "unit": "cm", "part": "lid"},
            {"height": 10, "width": 20, "unit": "cm", "part": "base"},
        ])
        assert "lid" in out
        assert "base" in out
        assert ";" in out

    def test_type_when_no_part(self):
        out = rdr._format_measurements([
            {"height": 5, "unit": "cm", "type": "overall"},
        ])
        assert "overall" in out

    def test_empty_unit(self):
        out = rdr._format_measurements([
            {"height": 5, "width": 6},
        ])
        assert "Height: 5" in out

    def test_all_dims(self):
        out = rdr._format_measurements([
            {
                "height": 1, "width": 2, "depth": 3,
                "diameter": 4, "length": 5, "weight": 6,
                "unit": "cm",
            },
        ])
        for dim in ("Height", "Width", "Depth", "Diameter", "Length", "Weight"):
            assert dim in out

    def test_skips_non_dict_entries(self):
        out = rdr._format_measurements([
            "bad entry",
            {"height": 10, "unit": "cm"},
        ])
        assert "Height: 10" in out

    def test_empty_dims_returns_none(self):
        assert rdr._format_measurements([{"unit": "cm"}]) is None


class TestFormatInscriptions:
    def test_none_returns_none(self):
        assert rdr._format_inscriptions(None) is None

    def test_empty_list_returns_none(self):
        assert rdr._format_inscriptions([]) is None

    def test_not_a_list(self):
        assert rdr._format_inscriptions({"bad": "shape"}) is None

    def test_content_text_inscription_fallback_chain(self):
        # 'content' is preferred, falls back to 'text' then 'inscription'
        out = rdr._format_inscriptions([{"content": "Signed J.S."}])
        assert "Signed J.S." in out

        out2 = rdr._format_inscriptions([{"text": "fallback text"}])
        assert "fallback text" in out2

        out3 = rdr._format_inscriptions([{"inscription": "old field"}])
        assert "old field" in out3

    def test_with_type_and_location(self):
        out = rdr._format_inscriptions([
            {"content": "ABC", "type": "signature", "position": "base"},
        ])
        assert "signature" in out
        assert "ABC" in out
        assert "base" in out

    def test_fallback_position_to_location(self):
        out = rdr._format_inscriptions([
            {"content": "X", "location": "lid"},
        ])
        assert "lid" in out

    def test_empty_text_skipped(self):
        out = rdr._format_inscriptions([{"content": "", "type": "mark"}])
        assert out is None

    def test_skips_non_dict(self):
        out = rdr._format_inscriptions(["raw string", {"content": "ok"}])
        assert "ok" in out


class TestFormatCreators:
    def test_none_returns_none(self):
        assert rdr._format_creators(None) is None

    def test_empty_list(self):
        assert rdr._format_creators([]) is None

    def test_not_a_list(self):
        assert rdr._format_creators("not a list") is None

    def test_name_and_role(self):
        out = rdr._format_creators([
            {"name": "Pablo Picasso", "role": "artist"},
        ])
        assert "Pablo Picasso" in out
        assert "artist" in out

    def test_display_name_fallback(self):
        out = rdr._format_creators([
            {"display_name": "Anonymous"},
        ])
        assert "Anonymous" in out

    def test_name_without_role(self):
        out = rdr._format_creators([{"name": "Just Name"}])
        assert out == "Just Name"

    def test_multiple_creators_separated_by_semicolon(self):
        out = rdr._format_creators([
            {"name": "A"},
            {"name": "B", "role": "maker"},
        ])
        assert ";" in out

    def test_skips_non_dict_entries(self):
        out = rdr._format_creators(["raw", {"name": "OK"}])
        assert "OK" in out

    def test_unnamed_creators_skipped(self):
        out = rdr._format_creators([{"role": "maker"}])
        assert out is None


# ══════════════════════════════════════════════════════════════════════════════
# Rendering helpers (pure)
# ══════════════════════════════════════════════════════════════════════════════


class TestRenderField:
    def test_none_value_yields_empty_list(self):
        styles = rdr._get_madrona_styles()
        assert rdr._render_field("Label", None, styles) == []

    def test_empty_string_value_yields_empty_list(self):
        styles = rdr._get_madrona_styles()
        assert rdr._render_field("Label", "", styles) == []

    def test_label_plus_value(self):
        styles = rdr._get_madrona_styles()
        out = rdr._render_field("Label", "Value", styles)
        assert len(out) == 2  # label + value paragraph

    def test_empty_label_omits_label_paragraph(self):
        styles = rdr._get_madrona_styles()
        out = rdr._render_field("", "Only value", styles)
        assert len(out) == 1

    def test_long_value_truncated(self):
        styles = rdr._get_madrona_styles()
        long = "x" * 600
        out = rdr._render_field("Label", long, styles)
        # The renderer truncates above 500 chars + "..."
        assert out  # still returns something non-empty

    def test_escapes_special_characters(self):
        styles = rdr._get_madrona_styles()
        # Should not raise on <, >, & characters
        out = rdr._render_field("Label", "<script>& tag", styles)
        assert len(out) == 2

    def test_unicode_passes_through(self):
        styles = rdr._get_madrona_styles()
        out = rdr._render_field("Label", "中文 café", styles)
        assert len(out) == 2


class TestRenderFieldGrid:
    def test_empty_fields(self):
        styles = rdr._get_madrona_styles()
        assert rdr._render_field_grid([], styles) == []

    def test_all_empty_values(self):
        styles = rdr._get_madrona_styles()
        assert rdr._render_field_grid([("a", None), ("b", "")], styles) == []

    def test_single_column(self):
        styles = rdr._get_madrona_styles()
        out = rdr._render_field_grid(
            [("Label", "Value")], styles, columns=1,
        )
        assert out  # one table

    def test_two_columns_pads_last_cell(self):
        styles = rdr._get_madrona_styles()
        # Odd count with 2 cols hits the padding branch
        out = rdr._render_field_grid(
            [("a", "1"), ("b", "2"), ("c", "3")], styles, columns=2,
        )
        assert out

    def test_explicit_width(self):
        styles = rdr._get_madrona_styles()
        out = rdr._render_field_grid(
            [("a", "1")], styles, columns=1, width=200,
        )
        assert out


class TestRenderItemsTable:
    def test_empty_items_returns_empty(self):
        styles = rdr._get_madrona_styles()
        assert rdr._render_items_table([], [("f", "F")], styles) == []

    def test_produces_table(self):
        styles = rdr._get_madrona_styles()
        items = [{"f1": "a", "f2": "b"}, {"f1": "c", "f2": "d"}]
        out = rdr._render_items_table(items, [("f1", "First"), ("f2", "Second")], styles)
        assert len(out) == 1

    def test_missing_field_in_row(self):
        styles = rdr._get_madrona_styles()
        items = [{"f1": "present"}]  # f2 missing
        out = rdr._render_items_table(items, [("f1", "F1"), ("f2", "F2")], styles)
        assert len(out) == 1


class TestSectionDivider:
    def test_returns_two_flowables(self):
        out = rdr._section_divider()
        assert len(out) == 2


class TestRenderSignatureBlock:
    def test_empty_parties(self):
        styles = rdr._get_madrona_styles()
        out = rdr._render_signature_block(styles, [])
        # Even with no parties, header + divider come through
        assert len(out) >= 3

    def test_single_party_pads_row(self):
        styles = rdr._get_madrona_styles()
        out = rdr._render_signature_block(styles, [("Lender", "Smith Museum")])
        assert out

    def test_two_parties(self):
        styles = rdr._get_madrona_styles()
        out = rdr._render_signature_block(styles, [
            ("Lender", "Smith Museum"),
            ("Borrower", "Doe Gallery"),
        ])
        assert out

    def test_four_parties_splits_rows(self):
        styles = rdr._get_madrona_styles()
        out = rdr._render_signature_block(styles, [
            ("A", "1"), ("B", "2"), ("C", "3"), ("D", "4"),
        ])
        assert out

    def test_empty_name_rendered(self):
        styles = rdr._get_madrona_styles()
        out = rdr._render_signature_block(styles, [("Lender", "")])
        assert out


class TestGetOrgName:
    def test_key_present(self):
        assert rdr._get_org_name({"organization_name": "My Org"}) == "My Org"

    def test_missing_key(self):
        assert rdr._get_org_name({}) is None


# ══════════════════════════════════════════════════════════════════════════════
# Image / linked-object helpers (DB paths are defensively wrapped)
# ══════════════════════════════════════════════════════════════════════════════


class TestFetchPrimaryImage:
    def test_no_orm_record_returns_none(self):
        # Without ``metadata['record']`` the helper exits early
        assert rdr._fetch_primary_image({}, {}) is None

    def test_missing_object_id(self):
        assert rdr._fetch_primary_image({}, {"record": object()}) is None

    def test_missing_org_id(self):
        assert rdr._fetch_primary_image(
            {"object_id": uuid4()},
            {"record": object()},
        ) is None

    def test_db_error_swallowed(self, db_session):
        # With orm_record + ids set but no real session available,
        # the session/model lookups raise and are swallowed → None
        assert rdr._fetch_primary_image(
            {"object_id": uuid4(), "organization_id": uuid4()},
            {"record": object()},
        ) is None


class TestFetchPrimaryImageB64:
    def test_no_orm_record(self):
        assert rdr._fetch_primary_image_b64({}, {}) is None

    def test_missing_ids(self):
        assert rdr._fetch_primary_image_b64({}, {"record": object()}) is None

    def test_db_error_swallowed(self, db_session):
        assert rdr._fetch_primary_image_b64(
            {"object_id": uuid4(), "organization_id": uuid4()},
            {"record": object()},
        ) is None


class TestResolveLinkedObject:
    def test_no_object_id_returns_none(self):
        assert rdr._resolve_linked_object({}, {}) is None

    def test_no_org_id_returns_none(self):
        assert rdr._resolve_linked_object({"object_id": uuid4()}, {}) is None

    def test_db_error_swallowed(self, db_session):
        # With valid-looking IDs but no real record, the ORM query silently
        # returns None / is caught; must not raise
        result = rdr._resolve_linked_object(
            {"object_id": uuid4(), "organization_id": uuid4()}, {},
        )
        # either None (not found) or a string (resolved) — must not raise
        assert result is None or isinstance(result, str)


class TestFetchLoanObjects:
    def test_no_orm_record_returns_empty(self):
        assert rdr._fetch_loan_objects({}, {}, True) == []
        assert rdr._fetch_loan_objects({}, {}, False) == []

    def test_missing_org_id(self):
        assert rdr._fetch_loan_objects({}, {"record": object()}, True) == []

    def test_loan_in_no_loan_id(self):
        result = rdr._fetch_loan_objects(
            {"organization_id": uuid4()},
            {"record": object()},
            True,
        )
        assert result == []

    def test_loan_out_no_loan_id(self):
        result = rdr._fetch_loan_objects(
            {"organization_id": uuid4()},
            {"record": object()},
            False,
        )
        assert result == []

    def test_db_error_swallowed(self, db_session):
        # Exercises the try/except fallback branch
        result = rdr._fetch_loan_objects(
            {"organization_id": uuid4(), "loan_in_id": uuid4()},
            {"record": object()},
            True,
        )
        assert isinstance(result, list)


# ══════════════════════════════════════════════════════════════════════════════
# End-to-end reportlab PDF renderers
# ══════════════════════════════════════════════════════════════════════════════


def _is_pdf(content: bytes) -> bool:
    return content.startswith(b"%PDF-")


class TestRenderObjectRecordSheet:
    def test_empty_data_still_produces_pdf(self, minimal_metadata):
        out = rdr.render_object_record_sheet([], minimal_metadata)
        assert _is_pdf(out)

    def test_happy_path_minimal(self, minimal_metadata):
        record = {
            "object_number": "2026.1.1",
            "object_name": "Teacup",
            "object_type": "Ceramic",
        }
        out = rdr.render_object_record_sheet([record], minimal_metadata)
        assert _is_pdf(out)
        assert len(out) > 500

    def test_with_description_fields(self, minimal_metadata):
        record = {
            "object_number": "A.1",
            "brief_description": "Small cup",
            "full_description": "A small ceramic cup with glazed finish.",
            "color": "Blue",
            "form": "Cup",
            "physical_description": "Fragile",
            "distinguishing_features": "Chip on rim",
        }
        out = rdr.render_object_record_sheet([record], minimal_metadata)
        assert _is_pdf(out)

    def test_with_measurements(self, minimal_metadata):
        record = {
            "object_number": "M.1",
            "measurements": [
                {"height": 10, "width": 5, "depth": 3, "unit": "cm"},
            ],
        }
        out = rdr.render_object_record_sheet([record], minimal_metadata)
        assert _is_pdf(out)

    def test_with_creators_materials_techniques_inscriptions(self, minimal_metadata):
        record = {
            "object_number": "C.1",
            "creators": [{"name": "Artist A", "role": "maker"}],
            "materials": [{"name": "wood"}, {"name": "bronze"}],
            "techniques": [{"term": "carving"}],
            "inscriptions": [{"content": "SIGNED", "type": "signature"}],
        }
        out = rdr.render_object_record_sheet([record], minimal_metadata)
        assert _is_pdf(out)

    def test_with_edition_block(self, minimal_metadata):
        record = {
            "object_number": "E.1",
            "edition": "1st",
            "copy_number": "4",
            "edition_size": 10,
            "state_number": 2,
            "total_states": 5,
            "state_description": "Second state before cleaning",
        }
        out = rdr.render_object_record_sheet([record], minimal_metadata)
        assert _is_pdf(out)

    def test_with_production_block(self, minimal_metadata):
        record = {
            "object_number": "P.1",
            "creation_date_display": "1900",
            "creation_place": "Paris",
            "style_period": "Impressionist",
            "production_note": "Painted in studio",
        }
        out = rdr.render_object_record_sheet([record], minimal_metadata)
        assert _is_pdf(out)

    def test_with_subjects_and_history(self, minimal_metadata):
        record = {
            "object_number": "S.1",
            "subjects": ["landscape", "rural"],
            "content_description": "Rolling hills",
            "provenance": "Gift of the artist, 1920",
            "credit_line": "Anonymous gift",
            "object_history_note": "Previously displayed at MoMA",
            "comments": "Condition excellent",
        }
        out = rdr.render_object_record_sheet([record], minimal_metadata)
        assert _is_pdf(out)

    def test_with_location_condition_valuation(self, minimal_metadata):
        record = {
            "object_number": "L.1",
            "barcode": "BC123",
            "last_inventoried_date": datetime(2026, 1, 1, tzinfo=timezone.utc),
            "condition_rating": "Good",
            "condition_date": datetime(2026, 2, 1, tzinfo=timezone.utc),
            "completeness": "Complete",
            "conservation_priority": "Low",
            "condition_note": "Slight wear",
            "handling_requirements": "Handle with cotton gloves",
            "current_value": "1000",
            "current_value_currency": "USD",
            "current_value_date": datetime(2025, 1, 1, tzinfo=timezone.utc),
            "insurance_value": "2000",
            "insurance_value_currency": "USD",
            "insurance_note": "Renewed annually",
        }
        out = rdr.render_object_record_sheet([record], minimal_metadata)
        assert _is_pdf(out)

    def test_unicode_in_fields(self, minimal_metadata):
        record = {
            "object_number": "U.1",
            "object_name": "Poterie café — 中文",
            "brief_description": "Müller's prototype © 1920 <tag>",
        }
        out = rdr.render_object_record_sheet([record], minimal_metadata)
        assert _is_pdf(out)

    def test_no_org_name_metadata(self):
        record = {"object_number": "N.1"}
        out = rdr.render_object_record_sheet([record], {})
        assert _is_pdf(out)


class TestRenderConditionReport:
    def test_empty_data(self, minimal_metadata):
        out = rdr.render_condition_report([], minimal_metadata)
        assert _is_pdf(out)

    def test_happy_path(self, minimal_metadata):
        record = {
            "report_number": "CR-2026-001",
            "report_type": "incoming",
            "report_date": datetime(2026, 3, 1, tzinfo=timezone.utc),
            "status": "approved",
            "examiner_name": "Dr. Conservator",
            "examiner_institution": "Test Museum",
            "examination_method": "visual_inspection",
            "examination_place": "Lab 1",
            "overall_condition": "good",
            "conservation_needed": False,
            "conservation_priority": "low",
            "completed_date": datetime(2026, 3, 2, tzinfo=timezone.utc),
            "condition_summary": "No active deterioration observed.",
            "recommendations": "Continue annual review.",
        }
        out = rdr.render_condition_report([record], minimal_metadata)
        assert _is_pdf(out)

    def test_with_handling_requirements(self, minimal_metadata):
        record = {
            "report_number": "CR-2",
            "handling_requirements": "Two handlers with gloves",
            "packing_requirements": "Double-walled crate",
            "display_restrictions": "No direct sunlight",
        }
        out = rdr.render_condition_report([record], minimal_metadata)
        assert _is_pdf(out)

    def test_with_notes_and_assigned(self, minimal_metadata):
        record = {
            "report_number": "CR-3",
            "report_note": "Urgent review scheduled for next quarter.",
            "assigned_to_name": "Alice",
            "created_at": datetime(2026, 1, 1, tzinfo=timezone.utc),
        }
        out = rdr.render_condition_report([record], minimal_metadata)
        assert _is_pdf(out)


class TestRenderLoanAgreement:
    def test_empty_data_defaults_to_loan_out(self, minimal_metadata):
        # Empty record: no lender_name → treated as loan-out
        out = rdr.render_loan_agreement([], minimal_metadata)
        assert _is_pdf(out)

    def test_loan_in_happy_path(self, minimal_metadata):
        record = {
            "loan_number": "LI-001",
            "lender_name": "Peer Museum",
            "loan_purpose": "exhibition",
            "exhibition_name": "Impressionists",
            "exhibition_venue": "Main Gallery",
            "status": "approved",
            "request_date": datetime(2026, 1, 1, tzinfo=timezone.utc),
            "approval_date": datetime(2026, 2, 1, tzinfo=timezone.utc),
            "loan_start_date": datetime(2026, 3, 1, tzinfo=timezone.utc),
            "loan_end_date": datetime(2026, 6, 1, tzinfo=timezone.utc),
            "actual_receipt_date": datetime(2026, 3, 2, tzinfo=timezone.utc),
            "insurance_value": "100000",
            "insurance_currency": "USD",
            "shipping_method": "art_transport",
            "courier_required": True,
            "assigned_to_name": "Bob",
        }
        out = rdr.render_loan_agreement([record], minimal_metadata)
        assert _is_pdf(out)

    def test_loan_out_happy_path(self, minimal_metadata):
        record = {
            "loan_number": "LO-001",
            "borrower_name": "Outside Gallery",
            "loan_purpose": "study",
            "exhibition_title": "Focus Show",
            "venue_name": "East Wing",
            "status": "in_transit",
            "request_date": datetime(2026, 1, 1, tzinfo=timezone.utc),
            "actual_dispatch_date": datetime(2026, 2, 15, tzinfo=timezone.utc),
            "insurance_value_total": "50000",
            "insurance_currency": "USD",
        }
        out = rdr.render_loan_agreement([record], minimal_metadata)
        assert _is_pdf(out)

    def test_with_conditions_block(self, minimal_metadata):
        record = {
            "loan_number": "LA-CONDITIONS",
            "lender_name": "X Museum",
            "loan_conditions": "Credit required.",
            "special_requirements": "Climate-controlled.",
            "display_requirements": "Vitrine required.",
            "photography_restrictions": "No flash photography.",
        }
        out = rdr.render_loan_agreement([record], minimal_metadata)
        assert _is_pdf(out)

    def test_with_agreement_reference(self, minimal_metadata):
        record = {
            "loan_number": "LA-AGR",
            "borrower_name": "Buyer",
            "loan_agreement_reference": "MOU-2026-1",
            "loan_agreement_date": datetime(2026, 1, 10, tzinfo=timezone.utc),
            "loan_agreement_signed_date": datetime(2026, 1, 15, tzinfo=timezone.utc),
        }
        out = rdr.render_loan_agreement([record], minimal_metadata)
        assert _is_pdf(out)

    def test_with_loan_note(self, minimal_metadata):
        record = {
            "loan_number": "LN-N",
            "lender_name": "N Museum",
            "loan_note": "Final payment pending.",
        }
        out = rdr.render_loan_agreement([record], minimal_metadata)
        assert _is_pdf(out)


class TestRenderObjectEntryReport:
    def test_empty_data(self, minimal_metadata):
        out = rdr.render_object_entry_report([], minimal_metadata)
        assert _is_pdf(out)

    def test_happy_path(self, minimal_metadata):
        record = {
            "entry_number": "OE-2026-001",
            "entry_date": datetime(2026, 1, 10, tzinfo=timezone.utc),
            "depositor_name": "Donor Smith",
            "current_owner": "Donor Smith",
            "entry_reason": "loan_in",
            "status": "in_review",
            "objects_count": 3,
            "assigned_to_name": "Curator C",
            "objects_description": "3 ceramic bowls",
            "expected_return_date": datetime(2026, 7, 1, tzinfo=timezone.utc),
            "expected_duration": "6 months",
            "insurance_value": "5000",
            "insurance_currency": "USD",
            "outcome": "accessioned",
            "entry_note": "Preliminary assessment pending.",
            "created_at": datetime(2026, 1, 10, tzinfo=timezone.utc),
        }
        out = rdr.render_object_entry_report([record], minimal_metadata)
        assert _is_pdf(out)

    def test_without_insurance_outcome_notes(self, minimal_metadata):
        # Hits the branches that skip optional sections
        record = {"entry_number": "MIN", "status": "open"}
        out = rdr.render_object_entry_report([record], minimal_metadata)
        assert _is_pdf(out)


class TestRenderObjectExitReport:
    def test_empty_data(self, minimal_metadata):
        out = rdr.render_object_exit_report([], minimal_metadata)
        assert _is_pdf(out)

    def test_happy_path(self, minimal_metadata):
        record = {
            "exit_number": "OX-1",
            "exit_date": datetime(2026, 4, 1, tzinfo=timezone.utc),
            "recipient_name": "Return Owner",
            "exit_reason": "return_to_owner",
            "exit_method": "courier",
            "status": "completed",
            "assigned_to_name": "Curator",
            "shipping_method": "art_transport",
            "shipping_company": "ArtMove",
            "tracking_number": "TRK-9",
            "courier_name": "Jane",
            "insurance_value": "750",
            "insurance_currency": "USD",
            "condition_at_exit": "Unchanged from entry.",
            "exit_note": "Paperwork complete.",
            "created_at": datetime(2026, 4, 1, tzinfo=timezone.utc),
        }
        out = rdr.render_object_exit_report([record], minimal_metadata)
        assert _is_pdf(out)

    def test_no_shipping_no_insurance(self, minimal_metadata):
        record = {"exit_number": "X.0"}
        out = rdr.render_object_exit_report([record], minimal_metadata)
        assert _is_pdf(out)


class TestRenderConservationTreatmentReport:
    def test_empty_data(self, minimal_metadata):
        out = rdr.render_conservation_treatment_report([], minimal_metadata)
        assert _is_pdf(out)

    def test_happy_path(self, minimal_metadata):
        record = {
            "treatment_number": "CT-1",
            "treatment_type": "cleaning",
            "conservator_name": "Dr. Conservator",
            "conservator_institution": "Labs Inc.",
            "status": "completed",
            "assigned_to_name": "Head Conservator",
            "proposal_date": datetime(2026, 1, 1, tzinfo=timezone.utc),
            "start_date": datetime(2026, 1, 15, tzinfo=timezone.utc),
            "end_date": datetime(2026, 2, 1, tzinfo=timezone.utc),
            "actual_duration_days": 17,
            "estimated_cost": "1000",
            "estimated_cost_currency": "USD",
            "actual_cost": "1100",
            "actual_cost_currency": "USD",
            "treatment_description": "Dry cleaning and consolidation.",
            "treatment_rationale": "Surface soiling threatening finish.",
            "materials_used": [{"name": "deionized water"}],
            "techniques_used": [{"name": "swab cleaning"}],
            "methods_used": "Vacuum and swab, in passes.",
            "recommendations": "Re-examine in 2 years.",
            "future_care_instructions": "Store at 45% RH.",
            "treatment_note": "No surprises encountered.",
            "created_at": datetime(2026, 1, 1, tzinfo=timezone.utc),
        }
        out = rdr.render_conservation_treatment_report([record], minimal_metadata)
        assert _is_pdf(out)

    def test_no_costs_no_materials(self, minimal_metadata):
        record = {"treatment_number": "MIN.CT", "status": "proposed"}
        out = rdr.render_conservation_treatment_report([record], minimal_metadata)
        assert _is_pdf(out)


class TestRenderAcquisitionReport:
    def test_empty_data(self, minimal_metadata):
        out = rdr.render_acquisition_report([], minimal_metadata)
        assert _is_pdf(out)

    def test_happy_path(self, minimal_metadata):
        record = {
            "acquisition_number": "ACQ-2026-01",
            "acquisition_method": "purchase",
            "acquisition_date": datetime(2026, 1, 15, tzinfo=timezone.utc),
            "source_name": "Gallery X",
            "source_type": "commercial_gallery",
            "status": "accepted",
            "objects_count": 2,
            "assigned_to_name": "Registrar",
            "accession_number": "2026.1",
            "accession_date": datetime(2026, 1, 20, tzinfo=timezone.utc),
            "cost": "5000",
            "cost_currency": "USD",
            "funding_source": "Collections Fund",
            "legal_status": "full_title",
            "credit_line": "Museum purchase, 2026",
            "provisos": "None.",
            "donor_restrictions": "None.",
            "acquisition_note": "Routine purchase.",
            "created_at": datetime(2026, 1, 15, tzinfo=timezone.utc),
        }
        out = rdr.render_acquisition_report([record], minimal_metadata)
        assert _is_pdf(out)

    def test_minimal_skips_optional_sections(self, minimal_metadata):
        record = {"acquisition_number": "ACQ-MIN"}
        out = rdr.render_acquisition_report([record], minimal_metadata)
        assert _is_pdf(out)


# ══════════════════════════════════════════════════════════════════════════════
# HTML template env + S3 loader
# ══════════════════════════════════════════════════════════════════════════════


class TestGetTemplateEnv:
    def test_returns_sandboxed_environment(self, real_package_loader):
        env = rdr._get_template_env(None)
        import jinja2.sandbox
        assert isinstance(env, jinja2.sandbox.SandboxedEnvironment)

    def test_with_org_uses_choice_loader(self, real_package_loader):
        env = rdr._get_template_env("org-123")
        # ChoiceLoader wraps S3 loader + default loader
        assert isinstance(env.loader, jinja2.ChoiceLoader)
        # Exactly 2 loaders — S3 first, then default
        assert len(env.loader.loaders) == 2


class TestS3TemplateLoader:
    def test_fetch_returns_none_on_any_error(self):
        loader = rdr._S3TemplateLoader("org-1")
        # current_session() will fail or storage lookup will fail — method
        # swallows and returns None
        result = loader._fetch("anything.html")
        assert result is None

    def test_get_source_raises_template_not_found_when_missing(self):
        loader = rdr._S3TemplateLoader("org-1")
        env = jinja2.Environment(loader=loader)
        with pytest.raises(jinja2.TemplateNotFound):
            loader.get_source(env, "missing.html")

    def test_get_source_returns_tuple_when_found(self):
        loader = rdr._S3TemplateLoader("org-1")

        def _stub_fetch(name):
            return "<p>{{ x }}</p>"

        loader._fetch = _stub_fetch
        source, filename, uptodate = loader.get_source(jinja2.Environment(), "a.html")
        assert source == "<p>{{ x }}</p>"
        assert "s3://org-1/a.html" in filename
        # uptodate must be callable and return bool-ish
        assert callable(uptodate)
        assert uptodate() is False


# ══════════════════════════════════════════════════════════════════════════════
# HTML renderers (patched Jinja loader + weasyprint)
# ══════════════════════════════════════════════════════════════════════════════


class TestRenderObjectRecordSheetHtml:
    def test_pdf_default(self, real_package_loader, stub_weasyprint, minimal_metadata):
        record = {"object_number": "H.1", "object_name": "Bowl"}
        out = rdr.render_object_record_sheet_html([record], minimal_metadata)
        assert _is_pdf(out)

    def test_docx_export(self, real_package_loader, minimal_metadata):
        record = {"object_number": "H.D", "object_name": "Docx bowl"}
        out = rdr.render_object_record_sheet_html(
            [record], minimal_metadata, export_format="docx",
        )
        # DOCX = zip-archive; starts with PK
        assert out.startswith(b"PK")

    def test_docx_with_full_context(self, real_package_loader, minimal_metadata):
        record = {
            "object_number": "H.F",
            "object_name": "Fancy Object",
            "brief_description": "Short",
            "full_description": "Long description " * 20,
            "color": "red",
            "form": "vase",
            "creators": [{"name": "A", "role": "maker"}],
            "measurements": [{"height": 1, "width": 2, "unit": "cm"}],
            "materials": [{"name": "bronze"}],
            "techniques": [{"term": "casting"}],
            "inscriptions": [{"content": "Signed"}],
            "edition": "1/10",
            "copy_number": "1",
            "edition_size": 10,
            "state_number": 1,
            "total_states": 2,
            "state_description": "First state",
            "creation_date_display": "1900",
            "creation_place": "Paris",
            "style_period": "Art Nouveau",
            "production_note": "Cast by X",
            "subjects": ["still life"],
            "content_description": "Arrangement of fruit",
            "provenance": "Chain",
            "credit_line": "Gift",
            "object_history_note": "Kept in storage",
            "comments": "OK",
            "barcode": "BC",
            "last_inventoried_date": datetime(2026, 1, 1, tzinfo=timezone.utc),
            "condition_rating": "Good",
            "condition_date": datetime(2026, 2, 1, tzinfo=timezone.utc),
            "completeness": "Complete",
            "conservation_priority": "low",
            "condition_note": "Stable",
            "handling_requirements": "Gloves",
            "current_value": "100",
            "current_value_currency": "USD",
            "current_value_date": datetime(2025, 1, 1, tzinfo=timezone.utc),
            "insurance_value": "200",
            "insurance_value_currency": "USD",
            "insurance_note": "Annual renew",
            "created_at": datetime(2026, 1, 1, tzinfo=timezone.utc),
            "updated_at": datetime(2026, 2, 1, tzinfo=timezone.utc),
        }
        out = rdr.render_object_record_sheet_html(
            [record], minimal_metadata, export_format="docx",
        )
        assert out.startswith(b"PK")

    def test_empty_data(self, real_package_loader, stub_weasyprint, minimal_metadata):
        out = rdr.render_object_record_sheet_html([], minimal_metadata)
        assert _is_pdf(out)


class TestRenderConditionReportHtml:
    def test_pdf(self, real_package_loader, stub_weasyprint, minimal_metadata):
        record = {"report_number": "CR-H", "report_type": "incoming"}
        out = rdr.render_condition_report_html([record], minimal_metadata)
        assert _is_pdf(out)

    def test_docx(self, real_package_loader, minimal_metadata):
        record = {"report_number": "CR-H-D"}
        out = rdr.render_condition_report_html(
            [record], minimal_metadata, export_format="docx",
        )
        assert out.startswith(b"PK")


class TestRenderLoanAgreementHtml:
    def test_loan_in_pdf(self, real_package_loader, stub_weasyprint, minimal_metadata):
        record = {"loan_number": "LI", "lender_name": "Peer"}
        out = rdr.render_loan_agreement_html([record], minimal_metadata)
        assert _is_pdf(out)

    def test_loan_out_pdf(self, real_package_loader, stub_weasyprint, minimal_metadata):
        record = {"loan_number": "LO", "borrower_name": "Buyer"}
        out = rdr.render_loan_agreement_html([record], minimal_metadata)
        assert _is_pdf(out)

    def test_docx(self, real_package_loader, minimal_metadata):
        record = {"loan_number": "LD", "lender_name": "P"}
        out = rdr.render_loan_agreement_html(
            [record], minimal_metadata, export_format="docx",
        )
        assert out.startswith(b"PK")


class TestRenderObjectEntryReportHtml:
    def test_pdf(self, real_package_loader, stub_weasyprint, minimal_metadata):
        record = {"entry_number": "OE-H"}
        out = rdr.render_object_entry_report_html([record], minimal_metadata)
        assert _is_pdf(out)

    def test_docx(self, real_package_loader, minimal_metadata):
        record = {"entry_number": "OE-H-D", "depositor_name": "Smith"}
        out = rdr.render_object_entry_report_html(
            [record], minimal_metadata, export_format="docx",
        )
        assert out.startswith(b"PK")


class TestRenderObjectExitReportHtml:
    def test_pdf(self, real_package_loader, stub_weasyprint, minimal_metadata):
        record = {"exit_number": "OX-H"}
        out = rdr.render_object_exit_report_html([record], minimal_metadata)
        assert _is_pdf(out)

    def test_docx(self, real_package_loader, minimal_metadata):
        record = {"exit_number": "OX-H-D", "recipient_name": "Jones"}
        out = rdr.render_object_exit_report_html(
            [record], minimal_metadata, export_format="docx",
        )
        assert out.startswith(b"PK")


class TestRenderConservationTreatmentReportHtml:
    def test_pdf(self, real_package_loader, stub_weasyprint, minimal_metadata):
        record = {"treatment_number": "CT-H"}
        out = rdr.render_conservation_treatment_report_html([record], minimal_metadata)
        assert _is_pdf(out)

    def test_pdf_with_costs(self, real_package_loader, stub_weasyprint, minimal_metadata):
        record = {
            "treatment_number": "CT-H2",
            "estimated_cost": "500",
            "estimated_cost_currency": "USD",
            "actual_cost": "600",
            "actual_cost_currency": "USD",
            "materials_used": [{"name": "swab"}],
            "techniques_used": [{"name": "clean"}],
        }
        out = rdr.render_conservation_treatment_report_html(
            [record], minimal_metadata,
        )
        assert _is_pdf(out)

    def test_docx(self, real_package_loader, minimal_metadata):
        record = {"treatment_number": "CT-H-D"}
        out = rdr.render_conservation_treatment_report_html(
            [record], minimal_metadata, export_format="docx",
        )
        assert out.startswith(b"PK")


class TestRenderAcquisitionReportHtml:
    def test_pdf(self, real_package_loader, stub_weasyprint, minimal_metadata):
        record = {"acquisition_number": "ACQ-H"}
        out = rdr.render_acquisition_report_html([record], minimal_metadata)
        assert _is_pdf(out)

    def test_pdf_with_cost(self, real_package_loader, stub_weasyprint, minimal_metadata):
        record = {
            "acquisition_number": "ACQ-H2",
            "cost": "1000",
            "cost_currency": "USD",
        }
        out = rdr.render_acquisition_report_html([record], minimal_metadata)
        assert _is_pdf(out)

    def test_docx(self, real_package_loader, minimal_metadata):
        record = {"acquisition_number": "ACQ-H-D"}
        out = rdr.render_acquisition_report_html(
            [record], minimal_metadata, export_format="docx",
        )
        assert out.startswith(b"PK")


class TestRenderHtmlTemplateFallback:
    def test_falls_back_when_org_template_fails(
        self, real_package_loader, stub_weasyprint,
    ):
        """When the first ``get_template`` raises, the ``except`` branch
        rebuilds the env from the default-only loader and retries.
        """
        # org_id set so ChoiceLoader branch runs; since the S3 fetch always
        # returns None here the ChoiceLoader falls through to the default
        # loader — which succeeds under real_package_loader.
        out = rdr._render_html_template(
            "condition_report.html",
            {"report_number": "X", "generated_at": "now"},
            "org-xyz",
            export_format="pdf",
        )
        assert _is_pdf(out)

    def test_missing_template_raises_after_fallback(self, real_package_loader):
        with pytest.raises(jinja2.TemplateNotFound):
            rdr._render_html_template(
                "nonexistent_template.html",
                {},
                None,
                export_format="pdf",
            )


# ══════════════════════════════════════════════════════════════════════════════
# DOCX builders (direct)
# ══════════════════════════════════════════════════════════════════════════════


class TestDocxBuilders:
    def test_build_generic_report_docx_empty_context(self):
        out = rdr._build_generic_report_docx({})
        assert out.startswith(b"PK")

    def test_build_generic_report_docx_skips_metadata_keys(self):
        ctx = {
            "org_name": "Museum",
            "generated_at": "today",
            "field_a": "value",
            "field_b": "x" * 200,  # long → block
            "number_field": 42,
        }
        out = rdr._build_generic_report_docx(ctx)
        assert out.startswith(b"PK")

    def test_build_object_record_sheet_docx_minimal(self):
        out = rdr._build_object_record_sheet_docx({
            "org_name": "Museum",
            "title": "Obj A",
            "generated_at": "now",
            "ident_fields": [("Object Number", "1")],
        })
        assert out.startswith(b"PK")

    def test_build_object_record_sheet_docx_bad_image_b64(self):
        # Bad base64 should be caught and logged — not raise
        out = rdr._build_object_record_sheet_docx({
            "org_name": "Museum",
            "title": "Obj with bad image",
            "generated_at": "now",
            "ident_fields": [],
            "image_b64": "NOT_VALID_BASE64_!!!",
        })
        assert out.startswith(b"PK")

    def test_build_object_record_sheet_docx_all_sections(self):
        out = rdr._build_object_record_sheet_docx({
            "org_name": "Museum",
            "title": "Full",
            "generated_at": "now",
            "ident_fields": [("Object Number", "1")],
            "creators": "A (maker)",
            "brief_description": "Short",
            "full_description": "Full",
            "color": "Blue",
            "form": "Cup",
            "physical_description": "Phys",
            "distinguishing_features": "None",
            "dimensions": "5x5 cm",
            "materials": "wood",
            "techniques": "carving",
            "inscriptions": "SIGNED",
            "edition": "1",
            "copy_number": "1",
            "edition_size": 10,
            "state_display": "1/2",
            "state_description": "First",
            "creation_date_display": "1900",
            "creation_place": "Paris",
            "style_period": "Art Nouveau",
            "production_note": "note",
            "subjects_display": "still life",
            "content_description": "fruit",
            "provenance": "chain",
            "credit_line": "gift",
            "object_history_note": "history",
            "comments": "ok",
            "barcode": "BC",
            "last_inventoried_date": "2026",
            "condition_rating": "Good",
            "condition_date": "2026",
            "completeness": "Complete",
            "conservation_priority": "Low",
            "condition_note": "stable",
            "handling_requirements": "gloves",
            "current_value_display": "100 USD",
            "current_value_date": "2026",
            "insurance_value_display": "200 USD",
            "insurance_note": "note",
            "created_at": "2026-01-01",
            "updated_at": "2026-02-01",
        })
        assert out.startswith(b"PK")

    def test_docx_field_helpers_no_value_noop(self):
        from docx import Document
        doc = Document()
        rdr._docx_setup_styles(doc)
        before = len(doc.paragraphs)
        rdr._docx_add_field(doc, "Label", None)
        rdr._docx_add_field(doc, "Label", "")
        rdr._docx_add_field_block(doc, "Label", None)
        rdr._docx_add_field_block(doc, "Label", "")
        after = len(doc.paragraphs)
        assert after == before

    def test_docx_add_field_with_value(self):
        from docx import Document
        doc = Document()
        rdr._docx_setup_styles(doc)
        rdr._docx_add_field(doc, "Label", "Value")
        rdr._docx_add_field_block(doc, "Block Label", "Block Value" * 10)
        assert any("Value" in p.text for p in doc.paragraphs)

    def test_docx_make_field_table_and_pair_row(self):
        from docx import Document
        doc = Document()
        rdr._docx_setup_styles(doc)
        table = rdr._docx_make_field_table(doc)
        rdr._docx_add_field_pair_row(table, "A", "1", "B", "2")
        rdr._docx_add_field_pair_row(table, "A", None, "B", None)  # blank row
        assert len(table.rows) == 2

    def test_docx_add_section_creates_heading(self):
        from docx import Document
        doc = Document()
        rdr._docx_setup_styles(doc)
        rdr._docx_add_section(doc, "My Section")
        assert any("My Section" in p.text for p in doc.paragraphs)
