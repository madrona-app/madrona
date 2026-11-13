"""Accessible report formats: HTML, plain text and Word.

These assert the structure access technology relies on — headings, table
headers, captions, alt text, document language — on the actual bytes each
format produces, not on intermediate objects.
"""
import io
import zipfile
from html.parser import HTMLParser

import pytest

from app.services import report_accessible as ra
from app.services import report_document_renderer as rdr
from app.services.report_export import export_report

# 1x1 transparent PNG
_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)


class _Tree(HTMLParser):
    """Collect the tags/attributes/text the assertions need."""

    def __init__(self):
        super().__init__()
        self.tags: list[tuple[str, dict]] = []
        self.text_by_tag: dict[str, list[str]] = {}
        self._stack: list[str] = []

    def handle_starttag(self, tag, attrs):
        self.tags.append((tag, dict(attrs)))
        if tag not in ("img", "meta", "br"):
            self._stack.append(tag)

    def handle_endtag(self, tag):
        if self._stack and self._stack[-1] == tag:
            self._stack.pop()

    def handle_data(self, data):
        if self._stack and data.strip():
            self.text_by_tag.setdefault(self._stack[-1], []).append(data.strip())

    def find(self, tag):
        return [a for t, a in self.tags if t == tag]

    def headings(self):
        return [t for t, _ in self.tags if t in ("h1", "h2", "h3", "h4", "h5", "h6")]


def _parse(content: bytes) -> _Tree:
    tree = _Tree()
    tree.feed(content.decode("utf-8"))
    return tree


def _assert_heading_order(levels: list[str]):
    assert levels and levels[0] == "h1"
    assert levels.count("h1") == 1
    prev = 1
    for h in levels[1:]:
        n = int(h[1])
        assert n <= prev + 1, f"heading level skipped: {levels}"
        prev = n


@pytest.fixture
def record_sheet_context():
    return {
        "org_name": "Test Museum",
        "title": "1999.1 — Bowl",
        "object_number": "1999.1",
        "generated_at": "November 13, 2026 at 10:00 UTC",
        "ident_fields": [("Object Number", "1999.1"), ("Object Name", "Bowl"), ("Category", None)],
        "image_b64": _PNG_B64,
        "image_mime": "image/png",
        "image_alt": "Celadon bowl with a crackled glaze, viewed from above",
        "creators": "Unknown potter (maker)",
        "brief_description": "A small bowl.",
        "provenance": "Line one\nLine two",
        "attachments": [
            {"filename": "bowl-front.tif", "type_label": "Image", "title": "Front view"},
            {"filename": "condition-2019.pdf", "type_label": "Document", "title": None},
        ],
        "created_at": "2026-01-01",
    }


# ============================================================================
# HTML
# ============================================================================

class TestRecordHtml:
    def test_document_skeleton(self, record_sheet_context):
        out = ra.render_html(ra.build_record_document("object_record_sheet.html", record_sheet_context))
        tree = _parse(out)
        assert out.startswith(b"<!DOCTYPE html>")
        assert tree.find("html")[0]["lang"] == "en"
        assert tree.text_by_tag["title"] == ["Object Record Sheet — 1999.1 — Bowl — Test Museum"]
        assert tree.text_by_tag["h1"] == ["Object Record Sheet"]
        _assert_heading_order(tree.headings())
        assert "Identification" in tree.text_by_tag["h2"]
        assert len(tree.find("main")) == 1

    def test_image_uses_media_alt_text(self, record_sheet_context):
        tree = _parse(ra.render_html(ra.build_record_document("object_record_sheet.html", record_sheet_context)))
        imgs = tree.find("img")
        assert len(imgs) == 1
        assert imgs[0]["alt"] == "Celadon bowl with a crackled glaze, viewed from above"

    def test_image_without_alt_text_falls_back_to_object_title(self, record_sheet_context):
        record_sheet_context["image_alt"] = None
        tree = _parse(ra.render_html(ra.build_record_document("object_record_sheet.html", record_sheet_context)))
        alt = tree.find("img")[0]["alt"]
        assert alt == "Image of 1999.1 — Bowl"
        assert "Primary image" not in alt

    def test_attachment_table_has_caption_and_scoped_headers(self, record_sheet_context):
        tree = _parse(ra.render_html(ra.build_record_document("object_record_sheet.html", record_sheet_context)))
        assert "Attached files" in tree.text_by_tag["caption"]
        col_headers = [a for a in tree.find("th") if a.get("scope") == "col"]
        row_headers = [a for a in tree.find("th") if a.get("scope") == "row"]
        assert len(col_headers) == 3
        assert len(row_headers) == 2
        assert all(a.get("scope") in ("col", "row") for a in tree.find("th"))
        assert "bowl-front.tif" in tree.text_by_tag["th"]

    def test_fields_are_definition_lists_not_layout_tables(self, record_sheet_context):
        record_sheet_context["attachments"] = None
        out = ra.render_html(ra.build_record_document("object_record_sheet.html", record_sheet_context))
        tree = _parse(out)
        assert tree.find("table") == []  # no attachments -> no tables at all
        assert "Object Number" in tree.text_by_tag["dt"]
        assert "Category" not in tree.text_by_tag["dt"]  # empty values omitted

    def test_values_are_escaped(self, record_sheet_context):
        record_sheet_context["brief_description"] = '<script>alert("x")</script>'
        out = ra.render_html(ra.build_record_document("object_record_sheet.html", record_sheet_context))
        assert b"<script>" not in out
        assert b"&lt;script&gt;" in out

    @pytest.mark.parametrize("template_name,ctx,h1", [
        ("condition_report.html", {"report_number": "CR-1", "overall_condition": "Good"}, "Condition Report"),
        ("loan_agreement.html", {"loan_type": "Incoming Loan", "is_loan_in": True, "loan_number": "L-1",
                                 "lender_name": "Peer", "sig_party_1_role": "Lender",
                                 "sig_party_2_role": "Borrower",
                                 "loan_objects": [{"object_title": "Vase", "insurance_value": "10 USD"}]},
         "Incoming Loan Agreement"),
        ("object_entry_report.html", {"entry_number": "E-1"}, "Object Entry Record"),
        ("object_exit_report.html", {"exit_number": "X-1"}, "Object Exit Record"),
        ("conservation_treatment_report.html", {"treatment_number": "T-1"}, "Conservation Treatment Report"),
        ("acquisition_report.html", {"acquisition_number": "A-1"}, "Acquisition Record"),
    ])
    def test_every_document_report_has_valid_structure(self, template_name, ctx, h1):
        tree = _parse(ra.render_html(ra.build_record_document(template_name, ctx)))
        assert tree.text_by_tag["h1"] == [h1]
        _assert_heading_order(tree.headings())
        for th in tree.find("th"):
            assert th.get("scope") in ("col", "row")

    def test_loan_signatures_use_h3_under_h2(self):
        ctx = {"loan_type": "Outgoing Loan", "loan_number": "L-2", "sig_party_1_role": "Lender",
               "sig_party_1_name": "Museum", "sig_party_2_role": "Borrower", "sig_party_2_name": "Other"}
        tree = _parse(ra.render_html(ra.build_record_document("loan_agreement.html", ctx)))
        assert tree.text_by_tag["h3"] == ["Lender", "Borrower"]

    def test_renderer_entry_point_returns_html(self):
        out = rdr.render_condition_report_html(
            [{"report_number": "CR-9"}], {"organization_name": "M"}, export_format="html",
        )
        assert out.startswith(b"<!DOCTYPE html>")
        assert b"<h1>Condition Report</h1>" in out


class TestTabularHtml:
    def test_table_structure(self):
        data = [{"object_number": "1", "object_name": "Bowl"}, {"object_number": "2", "object_name": "Cup"}]
        cols = [{"field": "object_number", "label": "Object Number"}, {"field": "object_name", "label": "Name"}]
        content, content_type, ext = export_report(data, "html", cols, report_name="Objects Export")
        assert ext == "html"
        assert content_type.startswith("text/html")
        tree = _parse(content)
        assert tree.find("html")[0]["lang"] == "en"
        assert tree.text_by_tag["h1"] == ["Objects Export"]
        _assert_heading_order(tree.headings())
        assert tree.text_by_tag["caption"] == ["Objects Export (2 rows)"]
        assert [a["scope"] for a in tree.find("th")] == ["col", "col", "row", "row"]
        region = [a for a in tree.find("div") if a.get("role") == "region"][0]
        assert region["tabindex"] == "0"
        assert region["aria-labelledby"] == tree.find("caption")[0]["id"]

    def test_all_rows_and_columns_kept(self):
        cols = [{"field": f"c{i}", "label": f"Column {i}"} for i in range(20)]
        data = [{f"c{i}": f"r{r}c{i}" for i in range(20)} for r in range(600)]
        content, _, _ = export_report(data, "html", cols, report_name="Wide")
        tree = _parse(content)
        assert len([a for a in tree.find("th") if a["scope"] == "col"]) == 20
        assert len(tree.find("tr")) == 601

    def test_empty(self):
        content, _, _ = export_report([], "html", [{"field": "a", "label": "A"}], report_name="Empty")
        assert b"No data available." in content
        assert b"<table" not in content


# ============================================================================
# PLAIN TEXT
# ============================================================================

class TestPlainText:
    def test_record_structure(self, record_sheet_context):
        out = ra.render_text(ra.build_record_document("object_record_sheet.html", record_sheet_context))
        text = out.decode("utf-8")
        lines = text.splitlines()
        assert lines[0] == "Object Record Sheet"
        assert lines[1] == "=" * len("Object Record Sheet")
        assert "1. Identification" in lines
        i = lines.index("1. Identification")
        assert lines[i + 1] == "-" * len("1. Identification")
        assert "Object Number: 1999.1" in lines
        assert "Image: Celadon bowl with a crackled glaze, viewed from above" in lines
        # multi-line values start on their own line
        j = lines.index("Provenance:")
        assert lines[j + 1:j + 3] == ["Line one", "Line two"]
        # Sections are numbered in order
        numbered = [ln for ln in lines if ln[:1].isdigit() and ". " in ln and not ln.startswith("1999")]
        assert [ln.split(".")[0] for ln in numbered] == [str(n) for n in range(1, len(numbered) + 1)]

    def test_tables_become_records_not_grids(self, record_sheet_context):
        text = ra.render_text(
            ra.build_record_document("object_record_sheet.html", record_sheet_context)
        ).decode("utf-8")
        assert "Attached files (2 entries)" in text
        assert "Entry 1 of 2\nFile name: bowl-front.tif\nType: Image\nTitle: Front view" in text
        assert "Entry 2 of 2\nFile name: condition-2019.pdf\nType: Document\nTitle: (none)" in text
        assert "|" not in text and "+--" not in text

    def test_subsections_numbered(self):
        ctx = {"loan_type": "Outgoing Loan", "loan_number": "L-2", "sig_party_1_role": "Lender",
               "sig_party_1_name": "Museum", "sig_party_2_role": "Borrower", "sig_party_2_name": "Other"}
        lines = ra.render_text(ra.build_record_document("loan_agreement.html", ctx)).decode().splitlines()
        sig = [ln for ln in lines if ln.endswith("Signatures")][0]
        n = sig.split(".")[0]
        assert f"{n}.1 Lender" in lines and f"{n}.2 Borrower" in lines

    def test_tabular_utf8_records(self):
        data = [{"name": "Café bowl", "date": "1900"}]
        cols = [{"field": "name", "label": "Name"}, {"field": "date", "label": "Date"}]
        content, content_type, ext = export_report(data, "txt", cols, report_name="Objects")
        assert ext == "txt" and content_type == "text/plain; charset=utf-8"
        text = content.decode("utf-8")
        assert "Total rows: 1" in text
        assert "Entry 1 of 1\nName: Café bowl\nDate: 1900" in text

    def test_renderer_entry_point(self):
        out = rdr.render_acquisition_report_html(
            [{"acquisition_number": "A-7", "source_name": "Donor"}], {"organization_name": "M"},
            export_format="txt",
        )
        assert out.decode().startswith("Acquisition Record\n==================\nA-7\n")
        assert "Source: Donor" in out.decode()


# ============================================================================
# WORD (DOCX) — assert on the generated XML itself
# ============================================================================

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def _docx_parts(content: bytes) -> dict[str, str]:
    with zipfile.ZipFile(io.BytesIO(content)) as z:
        return {n: z.read(n).decode("utf-8") for n in z.namelist() if n.endswith(".xml")}


def _paragraph_styles(document_xml: str) -> list[tuple[str, str]]:
    """(styleId, text) for every body paragraph."""
    from lxml import etree
    root = etree.fromstring(document_xml.encode())
    out = []
    for p in root.iter(f"{W}p"):
        style = p.find(f"{W}pPr/{W}pStyle")
        text = "".join(t.text or "" for t in p.iter(f"{W}t"))
        out.append((style.get(f"{W}val") if style is not None else "", text))
    return out


class TestDocx:
    @pytest.fixture
    def parts(self, record_sheet_context):
        out = ra.render_docx(ra.build_record_document("object_record_sheet.html", record_sheet_context))
        assert out.startswith(b"PK")
        return _docx_parts(out)

    def test_headings_use_real_heading_styles(self, parts):
        styles = _paragraph_styles(parts["word/document.xml"])
        h1 = [t for s, t in styles if s == "Heading1"]
        h2 = [t for s, t in styles if s == "Heading2"]
        assert h1 == ["Object Record Sheet"]
        assert "Identification" in h2 and "Attachments" in h2
        assert not [t for s, t in styles if s == "Title"]
        # Heading 1 comes before any Heading 2
        order = [s for s, _ in styles if s.startswith("Heading")]
        assert order[0] == "Heading1"

    def test_heading3_for_nested_sections(self):
        ctx = {"loan_type": "Outgoing Loan", "loan_number": "L-2", "sig_party_1_role": "Lender",
               "sig_party_2_role": "Borrower"}
        parts = _docx_parts(ra.render_docx(ra.build_record_document("loan_agreement.html", ctx)))
        styles = _paragraph_styles(parts["word/document.xml"])
        assert [t for s, t in styles if s == "Heading3"] == ["Lender", "Borrower"]

    def test_table_header_row_repeats_and_has_caption(self, parts):
        xml = parts["word/document.xml"]
        assert xml.count("<w:tbl>") == 1  # only the attachments data table; no layout tables
        assert '<w:tblHeader w:val="true"/>' in xml
        assert '<w:tblCaption w:val="Attached files"/>' in xml
        styles = _paragraph_styles(xml)
        assert ("Caption", "Attached files") in styles
        # header row is the first row and holds the column labels
        from lxml import etree
        tbl = etree.fromstring(xml.encode()).find(f".//{W}tbl")
        first = tbl.find(f"{W}tr")
        assert first.find(f"{W}trPr/{W}tblHeader") is not None
        assert ["".join(t.text for t in tc.iter(f"{W}t")) for tc in first.findall(f"{W}tc")] == [
            "File name", "Type", "Title"]

    def test_image_has_alt_text(self, parts):
        xml = parts["word/document.xml"]
        assert 'descr="Celadon bowl with a crackled glaze, viewed from above"' in xml
        assert "Primary image" not in xml

    def test_title_and_language(self, parts):
        assert "<dc:title>Object Record Sheet — 1999.1 — Bowl — Test Museum</dc:title>" in parts["docProps/core.xml"]
        assert "<dc:language>en-US</dc:language>" in parts["docProps/core.xml"]
        assert 'w:lang w:val="en-US"' in parts["word/styles.xml"]

    def test_bad_image_keeps_description(self, record_sheet_context):
        record_sheet_context["image_b64"] = "NOT_VALID_BASE64_!!!"
        xml = _docx_parts(ra.render_docx(
            ra.build_record_document("object_record_sheet.html", record_sheet_context)))["word/document.xml"]
        assert "Image: Celadon bowl" in xml

    @pytest.mark.parametrize("fn,record", [
        (rdr.render_condition_report_html, {"report_number": "CR-1", "condition_summary": "Fine"}),
        (rdr.render_object_entry_report_html, {"entry_number": "E-1"}),
        (rdr.render_object_exit_report_html, {"exit_number": "X-1"}),
        (rdr.render_conservation_treatment_report_html, {"treatment_number": "T-1"}),
        (rdr.render_acquisition_report_html, {"acquisition_number": "A-1"}),
        (rdr.render_loan_agreement_html, {"loan_number": "L-1", "lender_name": "P"}),
    ])
    def test_every_document_report_docx(self, fn, record):
        parts = _docx_parts(fn([record], {"organization_name": "M"}, export_format="docx"))
        styles = _paragraph_styles(parts["word/document.xml"])
        assert len([1 for s, _ in styles if s == "Heading1"]) == 1
        assert any(s == "Heading2" for s, _ in styles)
        assert "<dc:title>" in parts["docProps/core.xml"]


# ============================================================================
# Object media threaded from the database (alt text, attachments)
# ============================================================================

class _StubStorage:
    def get_object_sync(self, key):
        import base64
        return base64.b64decode(_PNG_B64), "image/png"


def _make_object_with_media(session, org_id, *, alt_text, title="Front view", caption=None):
    import uuid as _uuid
    from app.models import CollectionObject, CollectionObjectMedia, Media

    obj = CollectionObject(organization_id=org_id, object_number=f"R-{_uuid.uuid4().hex[:6]}",
                           object_name="Bowl")
    session.add(obj)
    session.flush()
    media = Media(organization_id=org_id, s3_key=f"orgs/{org_id}/media/{_uuid.uuid4().hex}.png",
                  filename="bowl-front.png", file_size=10, mime_type="image/png", media_type="image",
                  title=title, alt_text=alt_text, processing_status="completed")
    session.add(media)
    session.flush()
    session.add(CollectionObjectMedia(object_id=obj.object_id, media_id=media.media_id,
                                      is_primary=True, sort_order=0, caption_override=caption))
    session.flush()
    return obj


def _render_record_sheet(obj, org_id, export_format, monkeypatch):
    from app.services.report_resolvers import resolve_record
    import app.services.storage as storage
    monkeypatch.setattr(storage, "get_storage_backend", lambda *a, **k: _StubStorage())
    rows, _, metadata = resolve_record({"record_id": str(obj.object_id), "record_type": "collection_objects"},
                                       org_id)
    return rdr.render_object_record_sheet_html(rows, metadata, export_format=export_format)


class TestObjectMediaInReports:
    def test_alt_text_from_media_record_in_html(self, auth_setup, monkeypatch):
        from app.database import current_session
        _, org, _ = auth_setup
        obj = _make_object_with_media(current_session(), org.organization_id,
                                      alt_text="Bowl seen from above, crackled green glaze")
        tree = _parse(_render_record_sheet(obj, org.organization_id, "html", monkeypatch))
        assert tree.find("img")[0]["alt"] == "Bowl seen from above, crackled green glaze"

    def test_alt_text_in_word(self, auth_setup, monkeypatch):
        from app.database import current_session
        _, org, _ = auth_setup
        obj = _make_object_with_media(current_session(), org.organization_id, alt_text="Green bowl")
        xml = _docx_parts(_render_record_sheet(obj, org.organization_id, "docx", monkeypatch))["word/document.xml"]
        assert 'descr="Green bowl"' in xml

    def test_alt_text_in_pdf_template(self, auth_setup, monkeypatch):
        """The print template receives the media alt text, not a placeholder."""
        import weasyprint
        from app.database import current_session
        _, org, _ = auth_setup
        obj = _make_object_with_media(current_session(), org.organization_id, alt_text="Green bowl")
        seen = {}

        class _HTML:
            def __init__(self, string=None, **kw):
                seen["html"] = string

            def write_pdf(self, **kw):
                return b"%PDF-1.7 stub"

        monkeypatch.setattr(weasyprint, "HTML", _HTML)
        _render_record_sheet(obj, org.organization_id, "pdf", monkeypatch)
        assert 'alt="Green bowl"' in seen["html"]
        assert "Primary image" not in seen["html"]

    def test_falls_back_to_caption_then_title_then_object(self, auth_setup, monkeypatch):
        from app.database import current_session
        _, org, _ = auth_setup
        s = current_session()
        obj = _make_object_with_media(s, org.organization_id, alt_text=None, caption="Detail of rim")
        assert _parse(_render_record_sheet(obj, org.organization_id, "html", monkeypatch)).find("img")[0]["alt"] \
            == "Detail of rim"
        obj = _make_object_with_media(s, org.organization_id, alt_text="  ", title=None)
        alt = _parse(_render_record_sheet(obj, org.organization_id, "html", monkeypatch)).find("img")[0]["alt"]
        assert alt == f"Image of {obj.object_number} — Bowl"


def _attach_document(session, org_id, obj, filename, title):
    import uuid as _uuid
    from app.models import CollectionObjectMedia, Media
    media = Media(organization_id=org_id, s3_key=f"orgs/{org_id}/media/{_uuid.uuid4().hex}.pdf",
                  filename=filename, file_size=10, mime_type="application/pdf", media_type="document",
                  title=title, processing_status="completed")
    session.add(media)
    session.flush()
    session.add(CollectionObjectMedia(object_id=obj.object_id, media_id=media.media_id,
                                      is_primary=False, sort_order=1))
    session.flush()


class TestAttachmentFilenames:
    def test_record_sheet_lists_attachments_in_every_format(self, auth_setup, monkeypatch):
        from app.database import current_session
        _, org, _ = auth_setup
        s = current_session()
        obj = _make_object_with_media(s, org.organization_id, alt_text="Green bowl")
        _attach_document(s, org.organization_id, obj, "condition-2019.pdf", "Condition report 2019")

        tree = _parse(_render_record_sheet(obj, org.organization_id, "html", monkeypatch))
        assert "Attached files" in tree.text_by_tag["caption"]
        assert tree.text_by_tag["th"][3:] == ["bowl-front.png", "condition-2019.pdf"]
        assert "Condition report 2019" in tree.text_by_tag["td"]
        assert "Document" in tree.text_by_tag["td"]

        text = _render_record_sheet(obj, org.organization_id, "txt", monkeypatch).decode()
        assert "File name: bowl-front.png\nType: Image\nTitle: Front view" in text
        assert "File name: condition-2019.pdf\nType: Document\nTitle: Condition report 2019" in text

        xml = _docx_parts(_render_record_sheet(obj, org.organization_id, "docx", monkeypatch))["word/document.xml"]
        assert "condition-2019.pdf" in xml and '<w:tblCaption w:val="Attached files"/>' in xml

    def test_pdf_template_lists_attachments(self, auth_setup, monkeypatch):
        import weasyprint
        from app.database import current_session
        _, org, _ = auth_setup
        s = current_session()
        obj = _make_object_with_media(s, org.organization_id, alt_text="Green bowl")
        _attach_document(s, org.organization_id, obj, "condition-2019.pdf", None)
        seen = {}

        class _HTML:
            def __init__(self, string=None, **kw):
                seen["html"] = string

            def write_pdf(self, **kw):
                return b"%PDF-1.7 stub"

        monkeypatch.setattr(weasyprint, "HTML", _HTML)
        _render_record_sheet(obj, org.organization_id, "pdf", monkeypatch)
        assert "<caption>Attached files</caption>" in seen["html"]
        assert '<th scope="row">condition-2019.pdf</th>' in seen["html"]

    def test_object_without_files_says_so(self, auth_setup, monkeypatch):
        from app.database import current_session
        from app.models import CollectionObject
        _, org, _ = auth_setup
        s = current_session()
        obj = CollectionObject(organization_id=org.organization_id, object_number="NOFILE-1", object_name="Cup")
        s.add(obj)
        s.flush()
        out = _render_record_sheet(obj, org.organization_id, "html", monkeypatch)
        assert b"No files are attached to this object." in out

    def test_attached_files_list_report(self, auth_setup, monkeypatch):
        from app.database import current_session
        from app.models import CollectionObject
        from app.services.report_definitions import tabular_exports
        from app.services.report_registry import get_registry
        _, org, _ = auth_setup
        s = current_session()
        a = _make_object_with_media(s, org.organization_id, alt_text="Green bowl")
        _attach_document(s, org.organization_id, a, "condition-2019.pdf", "Condition report")
        b = CollectionObject(organization_id=org.organization_id, object_number="ZZZ-9", object_name="Cup")
        s.add(b)
        s.flush()
        monkeypatch.setattr(tabular_exports, "search_object_ids", lambda params, org_id: [a.object_id, b.object_id])

        definition = get_registry().get("collection_objects_attachments")
        assert definition.supported_formats[:2] == ["html", "txt"]
        rows, cols, meta = definition.resolver("search", {"search_request": {}}, org.organization_id)
        assert [r["filename"] for r in rows] == ["bowl-front.png", "condition-2019.pdf", "No attached files"]
        assert rows[0]["is_primary"] is True and rows[0]["alt_text"] == "Green bowl"

        content, _, _ = definition.renderer(data=rows, export_format="html", columns=cols,
                                            report_name=definition.name)
        tree = _parse(content)
        assert [h for h in tree.text_by_tag["th"]][:8] == [c["label"] for c in cols]
        assert "condition-2019.pdf" in tree.text_by_tag["td"]

    def test_workspace_not_found(self, auth_setup):
        import uuid as _uuid
        from app.services.report_registry import get_registry
        _, org, _ = auth_setup
        definition = get_registry().get("collection_objects_attachments")
        rows, _, meta = definition.resolver("workspace", {"workspace_id": str(_uuid.uuid4())},
                                            org.organization_id)
        assert rows == [] and meta["error"] == "workspace_not_found"
