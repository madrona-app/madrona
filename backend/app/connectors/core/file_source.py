"""
Bridge file source: read an uploaded spreadsheet (.csv or .xlsx) as a source.

An operator uploads a file (POST /api/connector-files/preview). The file is
stored in the organization's storage backend and a connector instance is
created whose config points at the stored key. On each run the connector
reads that object back, parses it and yields one record per data row, keyed
by the column headers.

Parsing rules
-------------
CSV
  - Encoding: UTF-8 BOM / UTF-16 BOM honoured; otherwise strict UTF-8, then
    cp1252 (what Excel on Windows writes), then latin-1 as a last resort.
  - Delimiter: comma, semicolon, tab or pipe, chosen by parsing the first
    rows with each candidate and keeping the most consistent column count.
    Quoted fields may contain delimiters and newlines.
XLSX
  - openpyxl in read-only mode with ``data_only=True``: formula cells yield
    the value Excel cached when the file was last saved. Formulas are never
    evaluated here, and external links are not loaded.
  - Dates become ISO 8601 (``2024-03-01``, or ``2024-03-01T14:30:00`` when a
    time is present); integral numbers lose their ``.0``.
Both
  - Header row: the first row, within the first 20 non-empty rows, that fills
    at least half as many cells as the widest of those rows. A one-cell title
    row above the real headers is skipped. ``header_row`` (1-based) overrides.
  - Blank headers become ``Column N``; duplicate headers get `` (2)``, ...
  - Values are strings with surrounding whitespace removed; empty cells are
    ``None``. Fully empty rows are skipped.
  - Row ids are stable: ``<sheet>:row-<n>`` where n is the 1-based row in the
    sheet (CSV: the 1-based record number). With ``id_column`` set, the value
    of that column is used instead, so a re-sorted re-upload updates the same
    records rather than creating new ones.

Limits (enforced before anything is stored): 25 MB per file, 50,000 data
rows, 500 columns, 32,767 characters per cell, and 250 MB uncompressed for
an .xlsx package (zip-bomb guard).

Mapping
-------
Rows are mapped to the canonical properties the Collections destination
reads (``object_number``, ``titles``, ``object_name``, ``description`` ...).
The mapping is ``csv_row_to_canonical_object``-style: each target names a
column, or a list of columns tried in order (coalesce), with an optional
default. ``mapping_rules`` accepts ``SetField`` rules in the mapping-engine
JSON format and converts them; explicit ``field_mapping`` entries win. With
no mapping configured, columns are matched to targets by header name.
"""

from __future__ import annotations

import csv
import io
import logging
import math
import re
import zipfile
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Any, Iterable, Iterator, Literal

from app.connectors.base import BaseSourceConnector

logger = logging.getLogger(__name__)

# ── Limits ──────────────────────────────────────────────────────────────────

MAX_FILE_BYTES = 25 * 1024 * 1024
MAX_ROWS = 50_000
MAX_COLUMNS = 500
MAX_CELL_CHARS = 32_767  # Excel's own per-cell limit
MAX_XLSX_UNCOMPRESSED_BYTES = 250 * 1024 * 1024
PREVIEW_ROWS = 20
HEADER_SCAN_ROWS = 20

CSV_EXTENSIONS = {"csv", "tsv", "txt"}
XLSX_EXTENSIONS = {"xlsx", "xlsm"}
ACCEPTED_EXTENSIONS = CSV_EXTENSIONS | XLSX_EXTENSIONS
CSV_DELIMITERS = (",", ";", "\t", "|")

FILE_SOURCE_KEY = "file-upload"
COLLECTIONS_TARGET_KEY = "madrona-collections"
UPLOAD_PREFIX_TEMPLATE = "orgs/{org_id}/bridge/uploads/"

_MAPPING_VALUE_SCHEMA = {
    "anyOf": [
        {"type": "string"},
        {"type": "array", "items": {"type": "string"}},
        {
            "type": "object",
            "properties": {
                "columns": {"type": "array", "items": {"type": "string"}},
                "default": {"type": ["string", "null"]},
            },
            "additionalProperties": False,
        },
    ]
}

# Connector definitions. The data migration that registers them carries a
# frozen copy of these; tests/test_file_source.py asserts the two agree.
FILE_SOURCE_CONFIG_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "storage_key": {"type": "string", "minLength": 1},
        "filename": {"type": ["string", "null"]},
        "file_format": {"type": "string", "enum": ["csv", "xlsx"]},
        "sheet_name": {"type": ["string", "null"]},
        "header_row": {"type": ["integer", "null"], "minimum": 1},
        "id_column": {"type": ["string", "null"]},
        "record_type": {"type": "string", "enum": ["Object", "Work"]},
        "field_mapping": {"type": "object", "additionalProperties": _MAPPING_VALUE_SCHEMA},
        "mapping_rules": {"type": "array", "items": {"type": "object"}},
    },
    "required": ["storage_key"],
    "additionalProperties": False,
}

FILE_SOURCE_DEFINITION: dict[str, Any] = {
    "key": FILE_SOURCE_KEY,
    "display_name": "Spreadsheet file (CSV or Excel)",
    "direction": "source",
    "implementation_key": "app.connectors.core.file_source:FileSourceConnector",
    "source_type": "file",
    "version": "1.0.0",
    "category": "file",
    "capabilities": {"incremental": False, "full_refresh": True, "upload": True,
                     "formats": ["csv", "xlsx"]},
    "config_schema": FILE_SOURCE_CONFIG_SCHEMA,
    "default_config": {"record_type": "Object"},
}

COLLECTIONS_TARGET_DEFINITION: dict[str, Any] = {
    "key": COLLECTIONS_TARGET_KEY,
    "display_name": "Madrona Collections",
    "direction": "target",
    "implementation_key": "app.connectors.core.collections_destination:CollectionsTargetConnector",
    "source_type": "madrona",
    "version": "1.0.0",
    "category": "madrona",
    "capabilities": {"publish_objects": True, "publish_changes": False},
    "config_schema": {
        "type": "object",
        "properties": {"dry_run": {"type": "boolean"}},
        "additionalProperties": False,
    },
    "default_config": {},
}


class FileSourceError(ValueError):
    """A file could not be read as a table. ``code`` is machine-readable."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


# ── Parsed table ────────────────────────────────────────────────────────────


@dataclass
class ParsedRow:
    row_number: int
    values: dict[str, str | None]


@dataclass
class ParsedTable:
    file_format: Literal["csv", "xlsx"]
    columns: list[str]
    rows: list[ParsedRow]
    header_row: int
    sheets: list[str] = field(default_factory=list)
    sheet_name: str | None = None
    encoding: str | None = None
    delimiter: str | None = None

    @property
    def total_rows(self) -> int:
        return len(self.rows)


def file_extension(filename: str | None) -> str:
    if not filename or "." not in filename:
        return ""
    return filename.rsplit(".", 1)[1].lower()


def detect_format(filename: str | None, data: bytes) -> Literal["csv", "xlsx"]:
    ext = file_extension(filename)
    if ext == "xls":
        raise FileSourceError(
            "unsupported_format",
            "Legacy .xls workbooks are not supported. Save the file as .xlsx or .csv and upload it again.",
        )
    if ext in XLSX_EXTENSIONS:
        if not data.startswith(b"PK\x03\x04"):
            raise FileSourceError("invalid_file", "This file is not a valid .xlsx workbook.")
        return "xlsx"
    if ext in CSV_EXTENSIONS:
        return "csv"
    raise FileSourceError(
        "unsupported_format",
        "Unsupported file type. Upload a .csv or .xlsx file.",
    )


def parse_file(
    data: bytes,
    filename: str | None,
    *,
    sheet_name: str | None = None,
    header_row: int | None = None,
    max_rows: int | None = None,
) -> ParsedTable:
    """Parse an uploaded file into columns and rows, enforcing every limit."""
    if max_rows is None:
        max_rows = MAX_ROWS
    if len(data) > MAX_FILE_BYTES:
        raise FileSourceError(
            "file_too_large",
            f"The file is {len(data) / 1_048_576:.1f} MB; the limit is {MAX_FILE_BYTES // 1_048_576} MB.",
        )
    if not data:
        raise FileSourceError("empty_file", "The file is empty.")
    fmt = detect_format(filename, data)
    if fmt == "xlsx":
        return _parse_xlsx(data, sheet_name=sheet_name, header_row=header_row, max_rows=max_rows)
    return _parse_csv(data, header_row=header_row, max_rows=max_rows)


# ── CSV ─────────────────────────────────────────────────────────────────────


def decode_text(data: bytes) -> tuple[str, str]:
    """Decode CSV bytes, returning (text, encoding name)."""
    if data.startswith(b"\xef\xbb\xbf"):
        return data[3:].decode("utf-8", errors="strict"), "utf-8-sig"
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        return data.decode("utf-16"), "utf-16"
    try:
        return data.decode("utf-8"), "utf-8"
    except UnicodeDecodeError:
        pass
    try:
        return data.decode("cp1252"), "cp1252"
    except UnicodeDecodeError:
        # cp1252 leaves five bytes undefined; latin-1 maps every byte.
        return data.decode("latin-1"), "latin-1"


def sniff_delimiter(text: str) -> str:
    """Pick the delimiter whose parse of the first rows is most consistent."""
    sample = text[:65_536]
    best, best_score = ",", (-1.0, 0)
    for delim in CSV_DELIMITERS:
        widths: list[int] = []
        try:
            for i, row in enumerate(csv.reader(io.StringIO(sample, newline=""), delimiter=delim)):
                if i >= 50:
                    break
                if any(c.strip() for c in row):
                    widths.append(len(row))
        except csv.Error:
            continue
        if not widths:
            continue
        # Drop the last sampled row: the 64 KB cut may have split it.
        if len(widths) > 2 and len(sample) < len(text):
            widths = widths[:-1]
        mode = max(set(widths), key=widths.count)
        if mode < 2:
            continue
        consistency = widths.count(mode) / len(widths)
        score = (consistency, mode)
        if score > best_score:
            best, best_score = delim, score
    return best


def _parse_csv(data: bytes, *, header_row: int | None, max_rows: int) -> ParsedTable:
    text, encoding = decode_text(data)
    if "\x00" in text[:65_536]:
        raise FileSourceError("invalid_file", "This file does not look like a text CSV file.")
    delimiter = sniff_delimiter(text)
    csv.field_size_limit(MAX_CELL_CHARS + 1)

    def grid() -> Iterator[tuple[int, list[str | None]]]:
        reader = csv.reader(io.StringIO(text, newline=""), delimiter=delimiter)
        try:
            for idx, row in enumerate(reader, start=1):
                yield idx, [_clean_str(c) for c in row]
        except csv.Error as exc:
            raise FileSourceError(
                "invalid_file", f"Could not read the CSV near record {reader.line_num}: {exc}"
            ) from exc

    columns, rows, header_idx = _rows_from_grid(grid(), header_row=header_row, max_rows=max_rows)
    return ParsedTable(
        file_format="csv", columns=columns, rows=rows, header_row=header_idx,
        encoding=encoding, delimiter=delimiter,
    )


# ── XLSX ────────────────────────────────────────────────────────────────────


def _check_xlsx_package(data: bytes) -> None:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            names = zf.namelist()
            uncompressed = sum(i.file_size for i in zf.infolist())
    except zipfile.BadZipFile as exc:
        raise FileSourceError("invalid_file", "This file is not a valid .xlsx workbook.") from exc
    if "xl/workbook.xml" not in names:
        raise FileSourceError("invalid_file", "This file is not a valid .xlsx workbook.")
    if uncompressed > MAX_XLSX_UNCOMPRESSED_BYTES:
        raise FileSourceError(
            "file_too_large", "The workbook expands to more data than Bridge will read from one file."
        )


def list_xlsx_sheets(data: bytes) -> list[str]:
    import openpyxl

    _check_xlsx_package(data)
    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True, keep_links=False)
    try:
        return [ws.title for ws in wb.worksheets]
    finally:
        wb.close()


def _parse_xlsx(
    data: bytes, *, sheet_name: str | None, header_row: int | None, max_rows: int
) -> ParsedTable:
    import openpyxl

    _check_xlsx_package(data)
    try:
        # data_only=True: read the cached result of each formula, never the
        # formula. keep_links=False: don't load external workbook links.
        wb = openpyxl.load_workbook(
            io.BytesIO(data), read_only=True, data_only=True, keep_links=False
        )
    except Exception as exc:  # openpyxl raises a variety of types on bad input
        raise FileSourceError("invalid_file", "This .xlsx workbook could not be opened.") from exc
    try:
        sheets = [ws.title for ws in wb.worksheets]
        if not sheets:
            raise FileSourceError("empty_file", "The workbook has no worksheets.")
        chosen = sheet_name or sheets[0]
        if chosen not in sheets:
            raise FileSourceError("sheet_not_found", f"The workbook has no sheet named “{chosen}”.")
        ws = wb[chosen]

        def grid() -> Iterator[tuple[int, list[str | None]]]:
            for idx, row in enumerate(ws.iter_rows(values_only=True), start=1):
                yield idx, [_cell_to_str(v) for v in row]

        columns, rows, header_idx = _rows_from_grid(grid(), header_row=header_row, max_rows=max_rows)
    finally:
        wb.close()
    return ParsedTable(
        file_format="xlsx", columns=columns, rows=rows, header_row=header_idx,
        sheets=sheets, sheet_name=chosen,
    )


def _cell_to_str(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, datetime):
        if value.time() == time(0, 0):
            return value.date().isoformat()
        return value.replace(microsecond=0).isoformat() if value.microsecond else value.isoformat()
    if isinstance(value, (date, time)):
        return value.isoformat()
    if isinstance(value, timedelta):
        return str(value)
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        if value.is_integer() and abs(value) < 1e15:
            return str(int(value))
        return repr(value)
    if isinstance(value, Decimal):
        return format(value, "f")
    return _clean_str(str(value))


def _clean_str(value: str | None) -> str | None:
    if value is None:
        return None
    s = value.strip()
    if not s:
        return None
    if len(s) > MAX_CELL_CHARS:
        raise FileSourceError(
            "cell_too_large", f"A cell holds more than {MAX_CELL_CHARS:,} characters."
        )
    return s


# ── Shared grid → table ─────────────────────────────────────────────────────


def _trim(row: list[str | None]) -> list[str | None]:
    end = len(row)
    while end and row[end - 1] is None:
        end -= 1
    return row[:end]


def _detect_header(candidates: list[tuple[int, list[str | None]]]) -> int:
    """Return the index into ``candidates`` of the header row."""
    counts = [sum(1 for c in row if c is not None) for _, row in candidates]
    widest = max(counts)
    threshold = max(2 if widest >= 2 else 1, math.ceil(widest / 2))
    for i, n in enumerate(counts):
        if n >= threshold:
            return i
    return 0


def _make_columns(header: list[str | None]) -> list[str]:
    columns: list[str] = []
    seen: dict[str, int] = {}
    for i, raw in enumerate(header):
        name = raw if raw else f"Column {i + 1}"
        base = name
        if base.lower() in seen:
            seen[base.lower()] += 1
            name = f"{base} ({seen[base.lower()]})"
        else:
            seen[base.lower()] = 1
        columns.append(name)
    return columns


def _rows_from_grid(
    grid: Iterable[tuple[int, list[str | None]]],
    *,
    header_row: int | None,
    max_rows: int,
) -> tuple[list[str], list[ParsedRow], int]:
    it = iter(grid)
    buffered: list[tuple[int, list[str | None]]] = []
    header_idx: int | None = None
    header: list[str | None] | None = None

    if header_row is not None:
        for idx, row in it:
            if idx == header_row:
                header_idx, header = idx, _trim(row)
                break
        if header is None or not any(c is not None for c in header):
            raise FileSourceError("no_header", f"Row {header_row} is empty or beyond the end of the file.")
    else:
        for idx, row in it:
            row = _trim(row)
            if not row:
                continue
            buffered.append((idx, row))
            if len(buffered) >= HEADER_SCAN_ROWS:
                break
        if not buffered:
            raise FileSourceError("empty_file", "The file has no data.")
        h = _detect_header(buffered)
        header_idx, header = buffered[h]
        buffered = buffered[h + 1:]

    if len(header) > MAX_COLUMNS:
        raise FileSourceError("too_many_columns", f"The file has more than {MAX_COLUMNS} columns.")
    columns = _make_columns(header)

    rows: list[ParsedRow] = []

    def add(idx: int, raw: list[str | None]) -> None:
        raw = _trim(raw)
        if not raw:
            return
        if len(raw) > MAX_COLUMNS:
            raise FileSourceError("too_many_columns", f"Row {idx} has more than {MAX_COLUMNS} columns.")
        while len(columns) < len(raw):
            columns.append(_make_columns([None] * (len(columns) + 1))[-1])
        if len(rows) >= max_rows:
            raise FileSourceError(
                "too_many_rows", f"The file has more than {max_rows:,} data rows. Split it into smaller files."
            )
        rows.append(ParsedRow(row_number=idx, values={
            col: (raw[i] if i < len(raw) else None) for i, col in enumerate(columns)
        }))

    for idx, row in buffered:
        add(idx, row)
    for idx, row in it:
        add(idx, row)

    # Columns appended for over-long rows: backfill earlier rows.
    for r in rows:
        for col in columns:
            r.values.setdefault(col, None)
    return columns, rows, header_idx


# ── Mapping ─────────────────────────────────────────────────────────────────

# target key -> (label shown to operators, header synonyms tried in order)
MAPPING_TARGETS: dict[str, tuple[str, list[str]]] = {
    "object_number": ("Object number", [
        "object number", "object no", "object id", "accession number", "accession no",
        "accession", "catalog number", "catalogue number", "catalog no", "inventory number",
        "item number", "item id", "call number", "identifier", "id",
    ]),
    "title": ("Title", ["title", "object title", "item title", "name", "label"]),
    "object_name": ("Object name", ["object name", "object type", "item type", "type"]),
    "description": ("Description", [
        "description", "brief description", "summary", "abstract", "caption", "scope and content",
    ]),
    "creator": ("Creator", ["creator", "artist", "maker", "author", "photographer", "artist name"]),
    "dated": ("Date", ["date", "date created", "creation date", "dated", "date made", "year"]),
    "date_begin": ("Earliest year", ["date begin", "begin date", "start year", "earliest date"]),
    "date_end": ("Latest year", ["date end", "end date", "end year", "latest date"]),
    "classification": ("Classification", ["classification", "category", "subject"]),
    "department": ("Department or collection", ["department", "collection", "collection name", "series"]),
    "medium": ("Medium or material", ["medium", "material", "materials", "physical description"]),
    "dimensions_text": ("Dimensions", ["dimensions", "size", "extent", "measurements"]),
    "credit_line": ("Credit line", ["credit line", "credit"]),
    "provenance": ("Provenance", ["provenance"]),
    "current_location": ("Location", ["location", "current location", "storage location", "shelf"]),
    "inscribed": ("Inscription", ["inscription", "inscribed", "inscriptions"]),
    "notes": ("Notes", ["notes", "note", "comments", "remarks"]),
}


def _norm_header(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", name.lower()).strip()


def suggest_field_mapping(columns: list[str]) -> dict[str, str]:
    """Match columns to mapping targets by header name (each column used once)."""
    by_norm: dict[str, str] = {}
    for col in columns:
        by_norm.setdefault(_norm_header(col), col)
    used: set[str] = set()
    mapping: dict[str, str] = {}
    for target, (_label, synonyms) in MAPPING_TARGETS.items():
        for syn in synonyms:
            col = by_norm.get(syn)
            if col and col not in used:
                mapping[target] = col
                used.add(col)
                break
    return mapping


# Mapping-engine SetField toPath -> target key
_RULE_PATHS = {
    "label": "title",
    "description": "description",
    "dates.created": "dated",
    "properties.medium": "medium",
    "properties.material": "medium",
    "properties.dimensions": "dimensions_text",
    "properties.collection": "department",
    "properties.department": "department",
    "properties.classification": "classification",
    "properties.object_name": "object_name",
    "properties.object_number": "object_number",
    "properties.credit_line": "credit_line",
    "properties.provenance": "provenance",
    "properties.location": "current_location",
    "properties.notes": "notes",
}


def rules_to_field_mapping(rules: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Convert mapping-engine ``SetField`` rules into a field mapping.

    Honours ``from`` + ``coalesce`` (column order) and ``default``. An
    ``identifiers`` rule whose item type is accession/object number maps to
    ``object_number``. Other rule types, and paths with no Collections field,
    are ignored.
    """
    out: dict[str, dict[str, Any]] = {}
    for rule in rules or []:
        if not isinstance(rule, dict) or rule.get("type") != "SetField" or rule.get("enabled") is False:
            continue
        path = rule.get("toPath") or ""
        target = _RULE_PATHS.get(path)
        if path == "identifiers":
            item_type = str((rule.get("itemTemplate") or {}).get("type", "")).lower()
            if item_type in ("accession", "object_number", "objectnumber"):
                target = "object_number"
        if target is None and path.startswith("properties.") and path[11:] in MAPPING_TARGETS:
            target = path[11:]
        if target is None or target in out:
            continue
        cols = [c for c in [rule.get("from"), *(rule.get("coalesce") or [])] if isinstance(c, str) and c]
        entry: dict[str, Any] = {"columns": cols}
        if isinstance(rule.get("default"), str):
            entry["default"] = rule["default"]
        out[target] = entry
    return out


def resolve_field_mapping(config: dict[str, Any], columns: list[str]) -> dict[str, dict[str, Any]]:
    """Effective mapping: target -> {"columns": [...], "default": str|None}."""
    explicit = config.get("field_mapping") or {}
    rules = config.get("mapping_rules") or []
    if not explicit and not rules:
        return {t: {"columns": [c]} for t, c in suggest_field_mapping(columns).items()}
    mapping = rules_to_field_mapping(rules)
    for target, spec in explicit.items():
        if target not in MAPPING_TARGETS:
            continue
        if isinstance(spec, str):
            mapping[target] = {"columns": [spec] if spec else []}
        elif isinstance(spec, list):
            mapping[target] = {"columns": [c for c in spec if isinstance(c, str) and c]}
        elif isinstance(spec, dict):
            mapping[target] = {"columns": list(spec.get("columns") or []), "default": spec.get("default")}
    return mapping


def _match_column(values: dict[str, str | None], name: str) -> str | None:
    if name in values:
        return values[name]
    norm = _norm_header(name)
    for col, val in values.items():
        if _norm_header(col) == norm:
            return val
    return None


def apply_field_mapping(
    values: dict[str, str | None], mapping: dict[str, dict[str, Any]]
) -> dict[str, Any]:
    """Map one row to Collections canonical properties."""
    flat: dict[str, str] = {}
    for target, spec in mapping.items():
        val = None
        for col in spec.get("columns") or []:
            val = _match_column(values, col)
            if val:
                break
        if not val and spec.get("default"):
            val = spec["default"]
        if val:
            flat[target] = val

    props: dict[str, Any] = {}
    for key, val in flat.items():
        if key == "title":
            props["title"] = val
            props["titles"] = [{"title": val, "title_type": "Primary"}]
        elif key == "creator":
            props["creators"] = [{"name": val, "role": "Creator"}]
        else:
            props[key] = val
    return props


# ── Connector ───────────────────────────────────────────────────────────────


def upload_prefix(organization_id: str) -> str:
    return UPLOAD_PREFIX_TEMPLATE.format(org_id=organization_id)


class FileSourceConnector(BaseSourceConnector):
    """Source connector over an uploaded .csv/.xlsx file in org storage."""

    direction: Literal["source"] = "source"

    def __init__(self, config: dict[str, Any], organization_id: str):
        self._table: ParsedTable | None = None
        super().__init__(config, organization_id)

    def validate_config(self) -> None:
        key = self.config.get("storage_key")
        if not key or not isinstance(key, str):
            raise ValueError("File source needs a storage_key: upload a file first.")
        prefix = upload_prefix(str(self.organization_id))
        if not key.startswith(prefix) or ".." in key:
            raise ValueError("storage_key does not belong to this organization's Bridge uploads.")

    # Separated so tests and the preview endpoint can supply bytes directly.
    def load_bytes(self) -> bytes:
        from app.database import get_session
        from app.services import storage as storage_mod
        from app.tasks.rls_helpers import set_task_rls_context

        with get_session() as db:
            set_task_rls_context(db, str(self.organization_id))
            backend = storage_mod.get_storage_backend(str(self.organization_id), db)
            data, _meta = backend.get_object_sync(self.config["storage_key"])
        return data

    def get_query_hash(self) -> str:
        import hashlib
        import json

        basis = {k: self.config.get(k) for k in ("storage_key", "sheet_name", "header_row")}
        return hashlib.sha256(json.dumps(basis, sort_keys=True).encode()).hexdigest()

    def table(self) -> ParsedTable:
        if self._table is None:
            data = self.load_bytes()
            filename = self.config.get("filename") or self.config["storage_key"]
            if self.config.get("file_format") and file_extension(filename) not in ACCEPTED_EXTENSIONS:
                filename = f"upload.{self.config['file_format']}"
            self._table = parse_file(
                data, filename,
                sheet_name=self.config.get("sheet_name"),
                header_row=self.config.get("header_row"),
            )
        return self._table

    def extract(
        self, cursor: dict[str, Any] | None = None, limit: int | None = None
    ) -> Iterable[dict[str, Any]]:
        table = self.table()
        sheet = table.sheet_name or "csv"
        id_column = self.config.get("id_column")
        seen: dict[str, int] = {}
        for i, row in enumerate(table.rows):
            if limit is not None and i >= limit:
                break
            row_id = f"{sheet}:row-{row.row_number}"
            if id_column:
                keyed = _match_column(row.values, id_column)
                if keyed:
                    n = seen.get(keyed, 0) + 1
                    seen[keyed] = n
                    row_id = keyed if n == 1 else f"{keyed}#{n}"
            yield {
                "row_id": row_id,
                "row_number": row.row_number,
                "sheet": table.sheet_name,
                "values": row.values,
            }

    def normalize(self, record: dict[str, Any]) -> dict[str, Any]:
        table = self.table()
        mapping = resolve_field_mapping(self.config, table.columns)
        values = record["values"]
        props = apply_field_mapping(values, mapping)
        props["source_row"] = record["row_number"]
        if record.get("sheet"):
            props["source_sheet"] = record["sheet"]
        label = (
            props.get("title") or props.get("object_name") or props.get("object_number")
            or f"Row {record['row_number']}"
        )
        source_id = record["row_id"]
        payload: dict[str, Any] = {
            "id": f"mdrn:file:{source_id}",
            "type": self.config.get("record_type") or "Object",
            "label": label,
            "properties": props,
            "extensions": [{
                "namespace": "source.file",
                "type": "FileRow",
                "data": {
                    "filename": self.config.get("filename"),
                    "sheet": record.get("sheet"),
                    "row_number": record["row_number"],
                    "values": values,
                },
            }],
        }
        if props.get("description"):
            payload["description"] = props["description"]
        if props.get("object_number"):
            payload["identifiers"] = [{"scheme": "object_number", "value": props["object_number"]}]
        return {
            "entity_key": f"file:{source_id}",
            "source_system": "file",
            "source_id": source_id,
            "object_number": props.get("object_number"),
            "payload": payload,
        }
