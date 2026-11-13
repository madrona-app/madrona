"""Bridge file source: CSV/XLSX parsing, limits, upload/preview API, and a
full run that maps spreadsheet rows into Collections objects."""
from __future__ import annotations

import importlib.util
import io
import json
import pathlib
import re
import zipfile
from contextlib import contextmanager
from datetime import date, datetime

import openpyxl
import pytest

from app.connectors.core import file_source as fs
from app.connectors.core.file_source import (
    FileSourceConnector,
    FileSourceError,
    apply_field_mapping,
    parse_file,
    resolve_field_mapping,
    rules_to_field_mapping,
    suggest_field_mapping,
)

_BACKEND = pathlib.Path(__file__).resolve().parent.parent
_CSV_RULES = _BACKEND.parent / "frontend/src/mapping-engine/examples/csv_row_to_canonical_object.json"


def _rows(table):
    return [r.values for r in table.rows]


def _xlsx(build) -> bytes:
    wb = openpyxl.Workbook()
    build(wb)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _set_cached_values(data: bytes, cached: dict[str, str]) -> bytes:
    """openpyxl writes formulas with an empty cached value; fill some in, as
    Excel would on save, so data_only reads have something to return."""
    src = zipfile.ZipFile(io.BytesIO(data))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as dst:
        for item in src.infolist():
            body = src.read(item.filename)
            if item.filename.startswith("xl/worksheets/sheet"):
                xml = body.decode()
                for formula, value in cached.items():
                    xml = xml.replace(f"<f>{formula}</f><v></v>", f"<f>{formula}</f><v>{value}</v>")
                body = xml.encode()
            dst.writestr(item, body)
    return out.getvalue()


# ── CSV ─────────────────────────────────────────────────────────────────────


class TestCsv:
    def test_utf8_bom_is_stripped_from_first_header(self):
        data = "﻿Object Number,Title\nNFB.1,Braille slate\n".encode("utf-8")
        t = parse_file(data, "a.csv")
        assert t.encoding == "utf-8-sig"
        assert t.columns == ["Object Number", "Title"]
        assert _rows(t) == [{"Object Number": "NFB.1", "Title": "Braille slate"}]

    def test_cp1252_fallback(self):
        data = "Title,Note\nCafé ’s,€5\n".encode("cp1252")
        t = parse_file(data, "a.csv")
        assert t.encoding == "cp1252"
        assert _rows(t) == [{"Title": "Café ’s", "Note": "€5"}]

    def test_semicolon_delimiter_and_quoted_newlines(self):
        data = (
            'Object number;Title;Notes\n'
            'NFB.1;"Slate; pocket";"line one\nline two"\n'
            'NFB.2;Stylus;\n'
        ).encode()
        t = parse_file(data, "export.csv")
        assert t.delimiter == ";"
        assert _rows(t) == [
            {"Object number": "NFB.1", "Title": "Slate; pocket", "Notes": "line one\nline two"},
            {"Object number": "NFB.2", "Title": "Stylus", "Notes": None},
        ]
        # Row numbers are record numbers, stable under quoted newlines.
        assert [r.row_number for r in t.rows] == [2, 3]

    def test_tab_delimiter(self):
        t = parse_file(b"a\tb\n1\t2\n", "x.tsv")
        assert t.delimiter == "\t" and _rows(t) == [{"a": "1", "b": "2"}]

    def test_title_row_above_header_is_skipped(self):
        data = b"NFB archive export 2024\n\nObject number,Title,Date\nNFB.1,Slate,1950\n"
        t = parse_file(data, "x.csv")
        assert t.header_row == 3
        assert t.columns == ["Object number", "Title", "Date"]
        assert len(t.rows) == 1

    def test_header_row_override(self):
        data = b"junk,junk2\nA,B\n1,2\n"
        t = parse_file(data, "x.csv", header_row=2)
        assert t.columns == ["A", "B"] and _rows(t) == [{"A": "1", "B": "2"}]

    def test_blank_and_duplicate_headers(self):
        t = parse_file(b"Title,,Title\n1,2,3\n", "x.csv")
        assert t.columns == ["Title", "Column 2", "Title (2)"]

    def test_empty_rows_skipped_and_whitespace_trimmed(self):
        t = parse_file(b"a,b\n\n , \n  x ,y\n", "x.csv")
        assert _rows(t) == [{"a": "x", "b": "y"}]


# ── XLSX ────────────────────────────────────────────────────────────────────


class TestXlsx:
    def _workbook(self) -> bytes:
        def build(wb):
            ws = wb.active
            ws.title = "Objects"
            ws.append(["Object number", "Title", "Acquired", "Count", "Weight", "Total"])
            ws.append(["NFB.1", "Slate", date(1950, 3, 1), 3.0, 2.5, "=D2*2"])
            ws.append(["NFB.2", "Stylus", datetime(2024, 3, 1, 14, 30), 7, None, "=D3*2"])
            other = wb.create_sheet("People")
            other.append(["Name", "Role"])
            other.append(["Jacobus tenBroek", "Founder"])
        return _set_cached_values(_xlsx(build), {"D2*2": "6"})

    def test_dates_numbers_and_cached_formula_values(self):
        t = parse_file(self._workbook(), "nfb.xlsx")
        assert t.file_format == "xlsx"
        assert t.sheets == ["Objects", "People"]
        assert t.sheet_name == "Objects"
        r1, r2 = _rows(t)
        assert r1["Acquired"] == "1950-03-01"
        assert r2["Acquired"] == "2024-03-01T14:30:00"
        assert r1["Count"] == "3" and r2["Count"] == "7"
        assert r1["Weight"] == "2.5" and r2["Weight"] is None
        # Cached value is returned; the formula is never evaluated.
        assert r1["Total"] == "6"
        # No cached value: empty, not the formula text and not a computed 14.
        assert r2["Total"] is None

    def test_choose_sheet(self):
        t = parse_file(self._workbook(), "nfb.xlsx", sheet_name="People")
        assert t.sheet_name == "People"
        assert _rows(t) == [{"Name": "Jacobus tenBroek", "Role": "Founder"}]

    def test_unknown_sheet(self):
        with pytest.raises(FileSourceError) as e:
            parse_file(self._workbook(), "nfb.xlsx", sheet_name="Nope")
        assert e.value.code == "sheet_not_found"

    def test_header_detection_skips_title_cell(self):
        def build(wb):
            ws = wb.active
            ws.append(["National Federation of the Blind — archive sample"])
            ws.append([])
            ws.append(["Accession number", "Title"])
            ws.append(["1985.4.1", "Perkins brailler"])
        t = parse_file(_xlsx(build), "s.xlsx")
        assert t.header_row == 3
        assert _rows(t) == [{"Accession number": "1985.4.1", "Title": "Perkins brailler"}]
        assert [r.row_number for r in t.rows] == [4]

    def test_not_a_zip(self):
        with pytest.raises(FileSourceError) as e:
            parse_file(b"not a workbook", "x.xlsx")
        assert e.value.code == "invalid_file"


# ── Limits ──────────────────────────────────────────────────────────────────


class TestLimits:
    def test_too_many_rows(self):
        data = b"a\n" + b"".join(f"{i}\n".encode() for i in range(11))
        with pytest.raises(FileSourceError) as e:
            parse_file(data, "x.csv", max_rows=10)
        assert e.value.code == "too_many_rows"
        assert len(parse_file(data, "x.csv", max_rows=11).rows) == 11

    def test_file_too_large(self, monkeypatch):
        monkeypatch.setattr(fs, "MAX_FILE_BYTES", 10)
        with pytest.raises(FileSourceError) as e:
            parse_file(b"a,b\n1,2\n3,4\n", "x.csv")
        assert e.value.code == "file_too_large"

    def test_too_many_columns(self, monkeypatch):
        monkeypatch.setattr(fs, "MAX_COLUMNS", 3)
        with pytest.raises(FileSourceError) as e:
            parse_file(b"a,b,c,d\n1,2,3,4\n", "x.csv")
        assert e.value.code == "too_many_columns"

    def test_cell_too_large(self, monkeypatch):
        monkeypatch.setattr(fs, "MAX_CELL_CHARS", 5)
        with pytest.raises(FileSourceError) as e:
            parse_file(b"a,b\n123456,1\n", "x.csv")
        assert e.value.code in ("cell_too_large", "invalid_file")

    def test_xlsx_zip_bomb_guard(self, monkeypatch):
        monkeypatch.setattr(fs, "MAX_XLSX_UNCOMPRESSED_BYTES", 100)
        data = _xlsx(lambda wb: wb.active.append(["a"]))
        with pytest.raises(FileSourceError) as e:
            parse_file(data, "x.xlsx")
        assert e.value.code == "file_too_large"

    @pytest.mark.parametrize("name,code", [
        ("old.xls", "unsupported_format"), ("doc.pdf", "unsupported_format"), ("noext", "unsupported_format"),
    ])
    def test_unsupported(self, name, code):
        with pytest.raises(FileSourceError) as e:
            parse_file(b"a,b\n", name)
        assert e.value.code == code

    def test_empty(self):
        with pytest.raises(FileSourceError):
            parse_file(b"", "x.csv")
        with pytest.raises(FileSourceError):
            parse_file(b"\n\n", "x.csv")


# ── Mapping ─────────────────────────────────────────────────────────────────


class TestMapping:
    def test_suggest_by_header(self):
        cols = ["Accession No.", "Title", "Artist", "Date", "Notes", "Shelf"]
        assert suggest_field_mapping(cols) == {
            "object_number": "Accession No.", "title": "Title", "creator": "Artist",
            "dated": "Date", "current_location": "Shelf", "notes": "Notes",
        }

    def test_csv_row_to_canonical_object_rules(self):
        rules = json.loads(_CSV_RULES.read_text())["rules"]
        mapping = rules_to_field_mapping(rules)
        assert mapping["object_number"]["columns"] == ["accession_number"]
        assert mapping["title"] == {"columns": ["title", "name", "object_name", "label"], "default": "Untitled"}
        assert mapping["dated"]["columns"][0] == "date_created"
        assert mapping["medium"]["columns"] == ["medium", "material", "materials"]
        sample = json.loads(_CSV_RULES.read_text())["metadata"]["sampleSource"]
        props = apply_field_mapping(sample, mapping)
        assert props["object_number"] == "2024.001"
        assert props["titles"] == [{"title": "Ceramic Vase with Blue Glaze", "title_type": "Primary"}]

    def test_explicit_mapping_wins_and_coalesces(self):
        cfg = {"mapping_rules": [{"type": "SetField", "toPath": "label", "from": "name"}],
               "field_mapping": {"title": ["Main title", "Alt title"], "object_number": "No."}}
        mapping = resolve_field_mapping(cfg, [])
        props = apply_field_mapping({"Main title": None, "Alt title": "Cane", "No.": "7"}, mapping)
        assert props["title"] == "Cane" and props["object_number"] == "7"

    def test_header_matching_is_case_and_punctuation_insensitive(self):
        props = apply_field_mapping({"OBJECT_NUMBER": "9"}, {"object_number": {"columns": ["object number"]}})
        assert props["object_number"] == "9"


def test_migration_definitions_match_module():
    path = next((_BACKEND / "migrations/versions").glob("*_bridge_file_source_connector.py"))
    spec = importlib.util.spec_from_file_location("_mig_bridge_file", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    by_key = {d["key"]: d for d in mod.DEFINITIONS}
    assert by_key[fs.FILE_SOURCE_KEY] == fs.FILE_SOURCE_DEFINITION
    assert by_key[fs.COLLECTIONS_TARGET_KEY] == fs.COLLECTIONS_TARGET_DEFINITION


# ── Connector ───────────────────────────────────────────────────────────────


class TestConnector:
    ORG = "11111111-1111-1111-1111-111111111111"

    def _conn(self, data: bytes, **cfg):
        config = {"storage_key": f"orgs/{self.ORG}/bridge/uploads/x.csv", "filename": "x.csv", **cfg}
        c = FileSourceConnector(config, self.ORG)
        c.load_bytes = lambda: data  # type: ignore[method-assign]
        return c

    def test_storage_key_must_be_this_orgs_upload(self):
        with pytest.raises(ValueError):
            FileSourceConnector({"storage_key": "orgs/other/bridge/uploads/x.csv"}, self.ORG)
        with pytest.raises(ValueError):
            FileSourceConnector({"storage_key": f"orgs/{self.ORG}/bridge/uploads/../../x"}, self.ORG)

    def test_stable_row_ids_and_normalize(self):
        c = self._conn(b"Object number,Title\nNFB.1,Slate\nNFB.2,\n")
        recs = list(c.extract())
        assert [r["row_id"] for r in recs] == ["csv:row-2", "csv:row-3"]
        out = c.normalize(recs[0])
        ok, errors = c.validate_normalized_output(out)
        assert ok, errors
        assert out["entity_key"] == "file:csv:row-2"
        assert out["payload"]["label"] == "Slate"
        assert out["payload"]["properties"]["object_number"] == "NFB.1"
        assert out["payload"]["extensions"][0]["data"]["values"] == {"Object number": "NFB.1", "Title": "Slate"}
        # No title: label falls back to the object number.
        assert c.normalize(recs[1])["payload"]["label"] == "NFB.2"

    def test_id_column_keys_rows_and_dedupes(self):
        c = self._conn(b"ID,Title\nA,x\nA,y\n,z\n", id_column="ID")
        assert [r["row_id"] for r in c.extract()] == ["A", "A#2", "csv:row-4"]

    def test_limit(self):
        c = self._conn(b"a\n1\n2\n3\n")
        assert len(list(c.extract(limit=2))) == 2


# ── API + end to end ────────────────────────────────────────────────────────


class _MemoryStorage:
    def __init__(self):
        self.objects: dict[str, tuple[bytes, dict]] = {}

    def put_object_sync(self, key, body, content_type=None, metadata=None, **_kw):
        from app.services.storage.base import StorageObject
        self.objects[key] = (body, dict(metadata or {}))
        return StorageObject(key=key, size=len(body), content_type=content_type)

    def get_object_sync(self, key):
        from app.services.storage.base import ObjectNotFoundError, StorageObject
        if key not in self.objects:
            raise ObjectNotFoundError("missing", key=key)
        body, meta = self.objects[key]
        return body, StorageObject(key=key, size=len(body), metadata=meta)


@pytest.fixture
def memory_storage(monkeypatch):
    from app.services import storage as storage_mod
    store = _MemoryStorage()
    monkeypatch.setattr(storage_mod, "get_storage_backend", lambda *a, **k: store)
    return store


@pytest.fixture
def definitions(db_session):
    from app.models import ConnectorDefinition
    out = {}
    for d in (fs.FILE_SOURCE_DEFINITION, fs.COLLECTIONS_TARGET_DEFINITION):
        row = db_session.query(ConnectorDefinition).filter_by(key=d["key"]).first()
        if row is None:
            row = ConnectorDefinition(**d, is_enabled=True)
            db_session.add(row)
            db_session.flush()
        out[d["key"]] = row
    return out


def _field(value: str):
    """A plain multipart form field (what a browser FormData sends)."""
    return (io.BytesIO(value.encode()), None)


def _upload(client, org, data: bytes, filename: str, **form):
    return client.post(
        "/api/connector-files/preview",
        data={"file": (io.BytesIO(data), filename), "organization_id": str(org.organization_id), **form},
        content_type="multipart/form-data",
    )


NFB_CSV = (
    "﻿Accession No.;Title;Creator;Date;Notes\n"
    'NFB.2024.001;"Perkins brailler, model 1951";David Abraham;1951;"Gift of the estate;\nsee file"\n'
    "NFB.2024.002;Slate and stylus;;c. 1900;\n"
).encode("utf-8")


class TestApi:
    def test_upload_preview_csv(self, auth_setup, memory_storage):
        client, org, _ = auth_setup
        resp = _upload(client, org, NFB_CSV, "nfb.csv")
        assert resp.status_code == 200, resp.get_json()
        body = resp.get_json()
        assert body["columns"] == ["Accession No.", "Title", "Creator", "Date", "Notes"]
        assert body["delimiter"] == ";" and body["encoding"] == "utf-8-sig"
        assert body["total_rows"] == 2
        assert body["preview_rows"][0]["values"]["Notes"] == "Gift of the estate;\nsee file"
        assert body["suggested_mapping"]["object_number"] == "Accession No."
        assert body["suggested_mapping"]["title"] == "Title"
        key = body["storage_key"]
        assert key.startswith(f"orgs/{org.organization_id}/bridge/uploads/") and key.endswith(".csv")
        assert memory_storage.objects[key][0] == NFB_CSV

    def test_re_preview_xlsx_sheet_by_storage_key(self, auth_setup, memory_storage):
        client, org, _ = auth_setup
        data = TestXlsx()._workbook()
        first = _upload(client, org, data, "nfb.xlsx").get_json()
        assert first["sheets"] == ["Objects", "People"] and first["sheet_name"] == "Objects"
        resp = client.post(
            "/api/connector-files/preview",
            data={"storage_key": _field(first["storage_key"]), "sheet_name": _field("People")},
            content_type="multipart/form-data",
        )
        assert resp.status_code == 200, resp.get_json()
        assert resp.get_json()["columns"] == ["Name", "Role"]
        assert resp.get_json()["filename"] == "nfb.xlsx"
        assert len(memory_storage.objects) == 1

    def test_other_orgs_storage_key_is_404(self, auth_setup, memory_storage):
        client, _org, _ = auth_setup
        resp = client.post(
            "/api/connector-files/preview",
            data={"storage_key": _field("orgs/00000000-0000-0000-0000-000000000000/bridge/uploads/x.csv")},
            content_type="multipart/form-data",
        )
        assert resp.status_code == 404

    def test_rejections_store_nothing(self, auth_setup, memory_storage, monkeypatch):
        client, org, _ = auth_setup
        resp = _upload(client, org, b"\xd0\xcf\x11\xe0", "legacy.xls")
        assert resp.status_code == 422 and resp.get_json()["error"]["code"] == "unsupported_format"
        monkeypatch.setattr(fs, "MAX_ROWS", 1)
        resp = _upload(client, org, NFB_CSV, "nfb.csv")
        assert resp.status_code == 413 and resp.get_json()["error"]["code"] == "too_many_rows"
        monkeypatch.setattr(fs, "MAX_FILE_BYTES", 10)
        resp = _upload(client, org, NFB_CSV, "nfb.csv")
        assert resp.status_code == 413
        assert memory_storage.objects == {}

    def test_instance_with_foreign_storage_key_rejected(self, auth_setup, definitions):
        client, org, _ = auth_setup
        resp = client.post("/api/connector-instances", data=json.dumps({
            "organization_id": str(org.organization_id),
            "connector_definition_id": str(definitions[fs.FILE_SOURCE_KEY].connector_definition_id),
            "name": "Bad",
            "config": {"storage_key": "orgs/elsewhere/bridge/uploads/x.csv"},
        }), content_type="application/json")
        assert resp.status_code == 422

    def test_upload_preview_run_creates_collection_objects(
        self, auth_setup, memory_storage, definitions, db_session, monkeypatch
    ):
        """Upload -> preview -> connector instance -> pipeline run -> CollectionObject."""
        import app.database as database
        from app.models import Pipeline, PipelineDestination, PipelineSource, Run
        from app.models.objects import CollectionObject, ObjectTitle
        from app.services.pipeline import execute_run

        client, org, _ = auth_setup
        preview = _upload(client, org, NFB_CSV, "nfb.csv").get_json()

        resp = client.post("/api/connector-instances", data=json.dumps({
            "organization_id": str(org.organization_id),
            "connector_definition_id": str(definitions[fs.FILE_SOURCE_KEY].connector_definition_id),
            "name": "NFB sample",
            "config": {
                "storage_key": preview["storage_key"],
                "filename": preview["filename"],
                "file_format": preview["file_format"],
                "field_mapping": {
                    "object_number": preview["suggested_mapping"]["object_number"],
                    "title": preview["suggested_mapping"]["title"],
                },
            },
        }), content_type="application/json")
        assert resp.status_code == 201, resp.get_json()
        source_id = resp.get_json()["connector_instance_id"]
        resp = client.post("/api/connector-instances", data=json.dumps({
            "organization_id": str(org.organization_id),
            "connector_definition_id": str(definitions[fs.COLLECTIONS_TARGET_KEY].connector_definition_id),
            "name": "Collections",
            "config": {},
        }), content_type="application/json")
        assert resp.status_code == 201, resp.get_json()
        target_id = resp.get_json()["connector_instance_id"]

        pipeline = Pipeline(organization_id=org.organization_id, status="active")
        db_session.add(pipeline)
        db_session.flush()
        db_session.add_all([
            PipelineSource(pipeline_id=pipeline.pipeline_id, connector_instance_id=source_id,
                           enabled=True, parameters={}, ordering=0),
            PipelineDestination(pipeline_id=pipeline.pipeline_id, connector_instance_id=target_id,
                                enabled=True, parameters={}, ordering=0),
        ])
        run = Run(organization_id=org.organization_id, pipeline_id=pipeline.pipeline_id,
                  source_connector_instance_id=source_id, target_connector_instance_id=target_id,
                  status="pending", triggered_by="api", parameters={})
        db_session.add(run)
        db_session.commit()

        # Connectors open their own sessions; point them at the test transaction.
        @contextmanager
        def _test_session():
            yield db_session
        monkeypatch.setattr(database, "get_session", _test_session)

        result = execute_run(session=db_session, run_id=run.run_id)
        assert result.status == "success", result
        assert result.counts["created"] == 2

        objs = {
            o.object_number: o for o in db_session.query(CollectionObject)
            .filter_by(organization_id=org.organization_id).all()
        }
        assert set(objs) == {"NFB.2024.001", "NFB.2024.002"}
        titles = {
            t.title for t in db_session.query(ObjectTitle)
            .filter(ObjectTitle.object_id == objs["NFB.2024.001"].object_id).all()
        }
        assert titles == {"Perkins brailler, model 1951"}
