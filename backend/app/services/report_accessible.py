"""Accessible report output.

One structured document model (``ReportDocument``) feeds every format meant to
be read with access technology:

- ``render_html``  — a standalone HTML file: ``lang``, ``<title>``, one ``<h1>``,
  sections at ``<h2>``, label/value pairs as ``<dl>``, data tables with a
  ``<caption>`` and ``<th scope>``, images carrying the media record's alt text.
  No layout tables and no meaning carried by colour alone.
- ``render_text``  — structured UTF-8 plain text for screen readers and braille.
- ``render_docx``  — Word with real heading styles, repeating table header rows,
  image alt text, and document title/language set.

Document reports (one record) are built from the same context dicts the PDF
templates receive (see ``build_record_document``); tabular reports are built
from rows + column definitions (see ``build_tabular_document``).
"""
from __future__ import annotations

import html as _html
import io
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

DEFAULT_LANG = "en"


# ============================================================================
# DOCUMENT MODEL
# ============================================================================

@dataclass
class Field:
    """A label/value pair. ``long`` marks free text that may span paragraphs."""
    label: str
    value: str
    long: bool = False


@dataclass
class DataTable:
    """A real data table: one header row, optional row-header first column."""
    caption: str
    columns: list[str]
    rows: list[list[str]]
    row_header: bool = True
    empty_message: str = "No entries."


@dataclass
class Figure:
    """An embedded image. ``alt`` is always meaningful text (never a placeholder)."""
    data_b64: str
    mime: str
    alt: str


@dataclass
class Section:
    heading: str
    fields: list[Field] = field(default_factory=list)
    paragraphs: list[str] = field(default_factory=list)
    figures: list[Figure] = field(default_factory=list)
    tables: list[DataTable] = field(default_factory=list)
    subsections: list["Section"] = field(default_factory=list)

    def is_empty(self) -> bool:
        return not (self.fields or self.paragraphs or self.figures or self.tables
                    or any(not s.is_empty() for s in self.subsections))


@dataclass
class ReportDocument:
    title: str
    subtitle: str | None = None
    org_name: str | None = None
    generated_at: str | None = None
    meta: list[Field] = field(default_factory=list)
    sections: list[Section] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    lang: str = DEFAULT_LANG

    @property
    def full_title(self) -> str:
        """Title used for <title> / document properties."""
        parts = [self.title]
        if self.subtitle:
            parts.append(self.subtitle)
        if self.org_name:
            parts.append(self.org_name)
        return " — ".join(p for p in parts if p)


def _text(value: Any) -> str:
    """Normalise a context value for display; empty for None/blank."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    return str(value).strip()


def _now_display() -> str:
    return datetime.now(timezone.utc).strftime("%B %d, %Y at %H:%M UTC")


# ============================================================================
# BUILDERS — RECORD (DOCUMENT) REPORTS
# ============================================================================

FieldSpec = tuple  # (label, key) or (label, key, "long")


def _fields(ctx: dict[str, Any], specs: list[FieldSpec]) -> list[Field]:
    out = []
    for spec in specs:
        label, key = spec[0], spec[1]
        long = len(spec) > 2 and spec[2] == "long"
        value = _text(ctx.get(key))
        if value:
            out.append(Field(label, value, long=long))
    return out


def _section(heading: str, ctx: dict[str, Any], specs: list[FieldSpec]) -> Section:
    return Section(heading=heading, fields=_fields(ctx, specs))


def _paragraph_section(heading: str, value: Any) -> Section:
    text = _text(value)
    return Section(heading=heading, paragraphs=[text] if text else [])


def _record_info(ctx: dict[str, Any], specs: list[FieldSpec]) -> Section:
    return _section("Record Information", ctx, specs)


def _object_figure(ctx: dict[str, Any]) -> list[Figure]:
    if not ctx.get("image_b64"):
        return []
    alt = _text(ctx.get("image_alt")) or f"Image of {_text(ctx.get('title')) or 'the object'}"
    return [Figure(data_b64=ctx["image_b64"], mime=ctx.get("image_mime") or "image/jpeg", alt=alt)]


def _attachments_table(ctx: dict[str, Any]) -> DataTable | None:
    attachments = ctx.get("attachments")
    if attachments is None:
        return None
    return DataTable(
        caption="Attached files",
        columns=["File name", "Type", "Title"],
        rows=[[_text(a.get("filename")), _text(a.get("type_label") or a.get("media_type")),
               _text(a.get("title"))] for a in attachments],
        empty_message="No files are attached to this object.",
    )


def _spec_object_record_sheet(ctx: dict[str, Any]) -> list[Section]:
    ident = Section(
        heading="Identification",
        fields=[Field(label, _text(value)) for label, value in ctx.get("ident_fields") or [] if _text(value)],
        figures=_object_figure(ctx),
    )
    attachments = Section(heading="Attachments")
    table = _attachments_table(ctx)
    if table is not None:
        attachments.tables.append(table)
    return [
        ident,
        _paragraph_section("Artists / Creators", ctx.get("creators")),
        _section("Description", ctx, [
            ("Brief Description", "brief_description", "long"),
            ("Full Description", "full_description", "long"),
            ("Color", "color"), ("Form", "form"),
            ("Physical Description", "physical_description", "long"),
            ("Distinguishing Features", "distinguishing_features", "long"),
        ]),
        _paragraph_section("Dimensions", ctx.get("dimensions")),
        _section("Materials & Techniques", ctx, [("Materials", "materials"), ("Techniques", "techniques")]),
        _paragraph_section("Inscriptions & Markings", ctx.get("inscriptions")),
        _section("Edition", ctx, [
            ("Edition", "edition"), ("Copy Number", "copy_number"),
            ("Edition Size", "edition_size"), ("State", "state_display"),
            ("State Description", "state_description", "long"),
        ]),
        _section("Production", ctx, [
            ("Date", "creation_date_display"), ("Place of Creation", "creation_place"),
            ("Style / Period", "style_period"), ("Production Note", "production_note", "long"),
        ]),
        _section("Subject", ctx, [
            ("Subjects", "subjects_display"), ("Content Description", "content_description", "long"),
        ]),
        _section("History", ctx, [
            ("Provenance", "provenance", "long"), ("Credit Line", "credit_line"),
            ("Object History", "object_history_note", "long"), ("Comments", "comments", "long"),
        ]),
        _section("Location & Inventory", ctx, [("Barcode", "barcode"), ("Last Inventoried", "last_inventoried_date")]),
        _section("Condition", ctx, [
            ("Condition Rating", "condition_rating"), ("Condition Date", "condition_date"),
            ("Completeness", "completeness"), ("Conservation Priority", "conservation_priority"),
            ("Condition Note", "condition_note", "long"),
            ("Handling Requirements", "handling_requirements", "long"),
        ]),
        _section("Valuation", ctx, [
            ("Current Value", "current_value_display"), ("Valuation Date", "current_value_date"),
            ("Insurance Value", "insurance_value_display"), ("Insurance Note", "insurance_note", "long"),
        ]),
        attachments,
        _record_info(ctx, [("Created", "created_at"), ("Updated", "updated_at")]),
    ]


def _spec_condition_report(ctx: dict[str, Any]) -> list[Section]:
    return [
        _paragraph_section("Object", ctx.get("linked_object")),
        _section("Report Details", ctx, [
            ("Report Number", "report_number"), ("Report Type", "report_type"),
            ("Report Date", "report_date"), ("Status", "status"),
            ("Examiner", "examiner_name"), ("Institution", "examiner_institution"),
            ("Method", "examination_method"), ("Place", "examination_place"),
        ]),
        _section("Assessment", ctx, [
            ("Overall Condition", "overall_condition"), ("Conservation Needed", "conservation_needed"),
            ("Conservation Priority", "conservation_priority"), ("Completed", "completed_date"),
            ("Condition Summary", "condition_summary", "long"), ("Recommendations", "recommendations", "long"),
        ]),
        _section("Handling & Requirements", ctx, [
            ("Handling Requirements", "handling_requirements", "long"),
            ("Packing Requirements", "packing_requirements", "long"),
            ("Display Restrictions", "display_restrictions", "long"),
        ]),
        _paragraph_section("Notes", ctx.get("report_note")),
        _record_info(ctx, [("Assigned To", "assigned_to_name"), ("Created", "created_at")]),
    ]


def _spec_loan_agreement(ctx: dict[str, Any]) -> list[Section]:
    is_in = bool(ctx.get("is_loan_in"))
    if is_in:
        parties = [("Lender", "lender_name"), ("Purpose", "loan_purpose"),
                   ("Exhibition", "exhibition_name"), ("Venue", "exhibition_venue"), ("Status", "status")]
        columns = ["Title / Description", "Lender No.", "Artist / Maker", "Medium", "Dimensions", "Insurance Value"]
        keys = ["object_title", "object_number_lender", "artist_maker", "medium", "dimensions", "insurance_value"]
    else:
        parties = [("Borrower", "borrower_name"), ("Purpose", "loan_purpose"),
                   ("Exhibition", "exhibition_title"), ("Venue", "venue_name"), ("Status", "status")]
        columns = ["Object No.", "Name", "Insurance Value", "Credit Line"]
        keys = ["object_number", "object_name", "insurance_value", "display_credit_line"]

    objects = Section(heading="Objects on Loan")
    loan_objects = ctx.get("loan_objects") or []
    if loan_objects:
        objects.tables.append(DataTable(
            caption="Objects on loan",
            columns=columns,
            rows=[[_text(o.get(k)) for k in keys] for o in loan_objects],
        ))

    signatures = Section(heading="Signatures", subsections=[
        Section(heading=_text(ctx.get(f"sig_party_{n}_role")) or f"Party {n}", fields=[
            Field("Name", _text(ctx.get(f"sig_party_{n}_name")) or "(blank)"),
            Field("Signature", "(blank — to be signed)"),
            Field("Date", "(blank — to be completed)"),
        ])
        for n in (1, 2)
    ])

    return [
        _section("Parties", ctx, parties),
        _section("Dates", ctx, [
            ("Request Date", "request_date"), ("Approval Date", "approval_date"),
            ("Start Date", "loan_start_date"), ("End Date", "loan_end_date"),
            (_text(ctx.get("received_dispatched_label")) or "Received", "received_dispatched_date"),
            ("Returned", "actual_return_date"),
        ]),
        _section("Insurance & Shipping", ctx, [
            ("Insurance Value", "insurance_value"), ("Currency", "insurance_currency"),
            ("Shipping Method", "shipping_method"), ("Courier Required", "courier_required"),
            ("Assigned To", "assigned_to_name"),
        ]),
        _section("Conditions & Requirements", ctx, [
            ("Loan Conditions", "loan_conditions", "long"),
            ("Special Requirements", "special_requirements", "long"),
            ("Display Requirements", "display_requirements", "long"),
            ("Photography Restrictions", "photography_restrictions", "long"),
        ]),
        objects,
        _section("Agreement", ctx, [
            ("Agreement Reference", "loan_agreement_reference"),
            ("Agreement Date", "loan_agreement_date"), ("Signed Date", "loan_agreement_signed_date"),
        ]),
        _paragraph_section("Notes", ctx.get("loan_note")),
        signatures,
    ]


def _spec_object_entry(ctx: dict[str, Any]) -> list[Section]:
    return [
        _section("Entry Details", ctx, [
            ("Entry Number", "entry_number"), ("Entry Date", "entry_date"),
            ("Depositor", "depositor_name"), ("Current Owner", "current_owner"),
            ("Entry Reason", "entry_reason"), ("Status", "status"),
            ("Number of Objects", "objects_count"), ("Assigned To", "assigned_to_name"),
            ("Objects Description", "objects_description", "long"),
        ]),
        _section("Dates", ctx, [
            ("Expected Return", "expected_return_date"), ("Return Date", "return_date"),
            ("Expected Duration", "expected_duration"),
        ]),
        _section("Insurance", ctx, [("Insurance Value", "insurance_value"), ("Currency", "insurance_currency")]),
        _section("Outcome", ctx, [("Outcome", "outcome")]),
        _paragraph_section("Notes", ctx.get("entry_note")),
        _record_info(ctx, [("Created", "created_at")]),
    ]


def _spec_object_exit(ctx: dict[str, Any]) -> list[Section]:
    return [
        _section("Exit Details", ctx, [
            ("Exit Number", "exit_number"), ("Exit Date", "exit_date"),
            ("Recipient", "recipient_name"), ("Exit Reason", "exit_reason"),
            ("Exit Method", "exit_method"), ("Status", "status"), ("Assigned To", "assigned_to_name"),
        ]),
        _section("Shipping", ctx, [
            ("Shipping Method", "shipping_method"), ("Shipping Company", "shipping_company"),
            ("Tracking Number", "tracking_number"), ("Courier", "courier_name"),
        ]),
        _section("Insurance", ctx, [
            ("Insurance Value", "insurance_value"), ("Currency", "insurance_currency"),
            ("Condition at Exit", "condition_at_exit", "long"),
        ]),
        _paragraph_section("Notes", ctx.get("exit_note")),
        _record_info(ctx, [("Created", "created_at")]),
    ]


def _spec_conservation_treatment(ctx: dict[str, Any]) -> list[Section]:
    return [
        _paragraph_section("Object", ctx.get("linked_object")),
        _section("Treatment Details", ctx, [
            ("Treatment Number", "treatment_number"), ("Treatment Type", "treatment_type"),
            ("Conservator", "conservator_name"), ("Institution", "conservator_institution"),
            ("Status", "status"), ("Assigned To", "assigned_to_name"),
        ]),
        _section("Dates", ctx, [
            ("Proposal Date", "proposal_date"), ("Start Date", "start_date"),
            ("End Date", "end_date"), ("Duration (days)", "actual_duration_days"),
        ]),
        _section("Costs", ctx, [
            ("Estimated Cost", "estimated_cost"), ("Actual Cost", "actual_cost"),
            ("Treatment Description", "treatment_description", "long"),
            ("Treatment Rationale", "treatment_rationale", "long"),
        ]),
        _section("Materials & Methods", ctx, [
            ("Materials Used", "materials_used"), ("Techniques Used", "techniques_used"),
            ("Methods", "methods_used", "long"), ("Recommendations", "recommendations", "long"),
            ("Future Care Instructions", "future_care_instructions", "long"),
        ]),
        _paragraph_section("Notes", ctx.get("treatment_note")),
        _record_info(ctx, [("Created", "created_at")]),
    ]


def _spec_acquisition(ctx: dict[str, Any]) -> list[Section]:
    return [
        _section("Acquisition Details", ctx, [
            ("Acquisition Number", "acquisition_number"), ("Method", "acquisition_method"),
            ("Acquisition Date", "acquisition_date"), ("Source", "source_name"),
            ("Source Type", "source_type"), ("Status", "status"),
            ("Number of Objects", "objects_count"), ("Assigned To", "assigned_to_name"),
        ]),
        _section("Accession", ctx, [("Accession Number", "accession_number"), ("Accession Date", "accession_date")]),
        _section("Financial", ctx, [("Cost", "cost"), ("Funding Source", "funding_source")]),
        _section("Legal & Credits", ctx, [
            ("Legal Status", "legal_status"), ("Credit Line", "credit_line"),
            ("Provisos", "provisos", "long"), ("Donor Restrictions", "donor_restrictions", "long"),
        ]),
        _paragraph_section("Notes", ctx.get("acquisition_note")),
        _record_info(ctx, [("Created", "created_at")]),
    ]


# template name -> (title fn, subtitle key, section spec)
_RECORD_SPECS: dict[str, tuple[Callable[[dict], str], str, Callable[[dict], list[Section]]]] = {
    "object_record_sheet.html": (lambda c: "Object Record Sheet", "title", _spec_object_record_sheet),
    "condition_report.html": (lambda c: "Condition Report", "report_number", _spec_condition_report),
    "loan_agreement.html": (
        lambda c: f"{_text(c.get('loan_type')) or 'Loan'} Agreement", "loan_number", _spec_loan_agreement,
    ),
    "object_entry_report.html": (lambda c: "Object Entry Record", "entry_number", _spec_object_entry),
    "object_exit_report.html": (lambda c: "Object Exit Record", "exit_number", _spec_object_exit),
    "conservation_treatment_report.html": (
        lambda c: "Conservation Treatment Report", "treatment_number", _spec_conservation_treatment,
    ),
    "acquisition_report.html": (lambda c: "Acquisition Record", "acquisition_number", _spec_acquisition),
}


def build_record_document(template_name: str, context: dict[str, Any]) -> ReportDocument:
    """Build the structured document for a single-record report.

    ``context`` is the dict the PDF template receives, so all formats show the
    same data. Empty sections are dropped (except Attachments, which states
    that no files are attached so its absence is never ambiguous).
    """
    if template_name not in _RECORD_SPECS:
        raise ValueError(f"No accessible layout registered for template {template_name!r}")
    title_fn, subtitle_key, spec = _RECORD_SPECS[template_name]
    sections = [
        s for s in spec(context)
        if not s.is_empty() or (s.heading == "Attachments" and context.get("attachments") is not None)
    ]
    return ReportDocument(
        title=title_fn(context),
        subtitle=_text(context.get(subtitle_key)) or None,
        org_name=_text(context.get("org_name")) or None,
        generated_at=_text(context.get("generated_at")) or _now_display(),
        sections=sections,
    )


# ============================================================================
# BUILDERS — TABULAR REPORTS
# ============================================================================

def _format_cell(value: Any) -> str:
    from app.services.report_export import format_value
    return format_value(value).strip()


def build_tabular_document(
    data: list[dict[str, Any]],
    columns: list[dict[str, str]] | None,
    report_name: str,
    report_description: str | None = None,
) -> ReportDocument:
    """Build the structured document for a tabular report (all rows, all columns)."""
    if columns:
        fieldnames = [c["field"] for c in columns]
        headers = [c.get("label", c["field"]) for c in columns]
    elif data:
        fieldnames = list(data[0].keys())
        headers = [f.replace("_", " ").title() for f in fieldnames]
    else:
        fieldnames, headers = [], []

    meta = [Field("Total rows", str(len(data)))]
    table = DataTable(
        caption=f"{report_name} ({len(data)} {'row' if len(data) == 1 else 'rows'})",
        columns=headers,
        rows=[[_format_cell(row.get(f)) for f in fieldnames] for row in data],
        empty_message="No data available.",
    )
    section = Section(heading="Results", tables=[table])
    if report_description:
        section.paragraphs.insert(0, report_description)
    return ReportDocument(
        title=report_name,
        generated_at=_now_display(),
        meta=meta,
        sections=[section],
    )


# ============================================================================
# HTML
# ============================================================================

# Colours from the Madrona palette (frontend/src/index.css). Every text/background
# pair below meets WCAG AA contrast (ink on white 17:1, accessible-gray on white
# 7.6:1, parchment on forest 11:1).
_HTML_CSS = """
:root { color-scheme: light; }
body { margin: 0; background: #FFFFFF; color: #1C1C1A;
  font-family: system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
  font-size: 1rem; line-height: 1.5; }
main { max-width: 60rem; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
.org { margin: 0 0 0.25rem; font-weight: 600; color: #2B3A34; }
h1 { font-size: 1.75rem; margin: 0 0 0.25rem; color: #2B3A34; }
.subtitle { margin: 0 0 1rem; font-size: 1.125rem; }
h2 { font-size: 1.375rem; margin: 2rem 0 0.75rem; padding-bottom: 0.25rem;
  border-bottom: 2px solid #2B3A34; color: #2B3A34; }
h3 { font-size: 1.125rem; margin: 1.25rem 0 0.5rem; color: #2B3A34; }
dl { margin: 0 0 1rem; }
dt { font-weight: 700; margin-top: 0.75rem; }
dd { margin: 0.125rem 0 0; white-space: pre-wrap; }
.meta dt, .meta dd { display: inline; margin: 0; }
.meta div { margin: 0.125rem 0; color: #545452; }
p.text { white-space: pre-wrap; }
figure { margin: 0 0 1rem; }
figure img { max-width: min(100%, 24rem); height: auto; border: 1px solid #63645E; }
.table-scroll { overflow-x: auto; margin: 0 0 1rem; }
.table-scroll:focus-visible { outline: 3px solid #B0533A; outline-offset: 2px; }
table { border-collapse: collapse; min-width: 100%; }
caption { text-align: left; font-weight: 700; padding: 0 0 0.5rem; }
th, td { border: 1px solid #63645E; padding: 0.375rem 0.5rem; text-align: left; vertical-align: top; }
thead th { background: #2B3A34; color: #F7F4ED; }
tbody th { font-weight: 700; }
.notes { margin-top: 2rem; color: #545452; }
@media print {
  main { max-width: none; padding: 0; }
  .table-scroll { overflow: visible; }
  thead { display: table-header-group; }
  h2, h3 { break-after: avoid; }
}
"""


def _e(value: Any) -> str:
    return _html.escape(_text(value), quote=True)


class _Ids:
    def __init__(self) -> None:
        self.n = 0

    def next(self, prefix: str) -> str:
        self.n += 1
        return f"{prefix}-{self.n}"


def _html_fields(fields: list[Field], css_class: str | None = None) -> list[str]:
    if not fields:
        return []
    cls = f' class="{css_class}"' if css_class else ""
    out = [f"<dl{cls}>"]
    for f in fields:
        out.append(f"<div><dt>{_e(f.label)}</dt><dd>{_e(f.value)}</dd></div>")
    out.append("</dl>")
    return out


def _html_table(t: DataTable, ids: _Ids) -> list[str]:
    cap_id = ids.next("table-caption")
    if not t.rows:
        return [f'<p><strong>{_e(t.caption)}:</strong> {_e(t.empty_message)}</p>']
    # The wrapper scrolls wide tables; it is focusable and named by the caption
    # so keyboard users can scroll it (WCAG 2.1.1 / scrollable-region-focusable).
    out = [
        f'<div class="table-scroll" role="region" aria-labelledby="{cap_id}" tabindex="0">',
        "<table>",
        f'<caption id="{cap_id}">{_e(t.caption)}</caption>',
        "<thead><tr>",
    ]
    out.extend(f'<th scope="col">{_e(c)}</th>' for c in t.columns)
    out.append("</tr></thead><tbody>")
    for row in t.rows:
        cells = []
        for i, value in enumerate(row):
            if i == 0 and t.row_header:
                cells.append(f'<th scope="row">{_e(value)}</th>')
            else:
                cells.append(f"<td>{_e(value)}</td>")
        out.append("<tr>" + "".join(cells) + "</tr>")
    out.append("</tbody></table></div>")
    return out


def _html_section(s: Section, level: int, ids: _Ids) -> list[str]:
    hid = ids.next("section")
    out = [f'<section aria-labelledby="{hid}">', f'<h{level} id="{hid}">{_e(s.heading)}</h{level}>']
    for fig in s.figures:
        out.append(
            f'<figure><img src="data:{_e(fig.mime)};base64,{fig.data_b64}" alt="{_e(fig.alt)}"></figure>'
        )
    out.extend(f'<p class="text">{_e(p)}</p>' for p in s.paragraphs)
    out.extend(_html_fields(s.fields))
    for t in s.tables:
        out.extend(_html_table(t, ids))
    for sub in s.subsections:
        if not sub.is_empty():
            out.extend(_html_section(sub, min(level + 1, 6), ids))
    out.append("</section>")
    return out


def render_html(doc: ReportDocument) -> bytes:
    """Render a standalone, accessible HTML file (UTF-8 bytes)."""
    ids = _Ids()
    meta = list(doc.meta)
    if doc.generated_at:
        meta.append(Field("Generated", doc.generated_at))
    parts = [
        "<!DOCTYPE html>",
        f'<html lang="{_e(doc.lang)}">',
        "<head>",
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        f"<title>{_e(doc.full_title)}</title>",
        f"<style>{_HTML_CSS}</style>",
        "</head>",
        "<body>",
        "<main>",
    ]
    if doc.org_name:
        parts.append(f'<p class="org">{_e(doc.org_name)}</p>')
    parts.append(f"<h1>{_e(doc.title)}</h1>")
    if doc.subtitle:
        parts.append(f'<p class="subtitle">{_e(doc.subtitle)}</p>')
    parts.extend(_html_fields(meta, "meta"))
    for s in doc.sections:
        parts.extend(_html_section(s, 2, ids))
    if doc.notes:
        parts.append('<div class="notes">')
        parts.extend(f"<p>{_e(n)}</p>" for n in doc.notes)
        parts.append("</div>")
    parts += ["</main>", "</body>", "</html>", ""]
    return "\n".join(parts).encode("utf-8")


# ============================================================================
# PLAIN TEXT
# ============================================================================
#
# Conventions, chosen to read well in a screen reader and on a braille display:
# - the title is underlined with "=", numbered sections ("1. Identification")
#   with "-", subsections are numbered "1.1 ..." with no underline;
# - one "Label: value" per line; multi-line values start on the next line;
# - tables become records ("Entry 2 of 5" followed by "Column: value" lines),
#   never ASCII grids, so nothing depends on column alignment;
# - no hard wrapping (reflow is left to the reader), blank line between blocks.

def _txt_field(f: Field) -> list[str]:
    if "\n" in f.value:
        return [f"{f.label}:", *f.value.splitlines()]
    return [f"{f.label}: {f.value}"]


def _txt_table(t: DataTable) -> list[str]:
    if not t.rows:
        return [f"{t.caption}: {t.empty_message}", ""]
    n = len(t.rows)
    out = [f"{t.caption} ({n} {'entry' if n == 1 else 'entries'})", ""]
    for i, row in enumerate(t.rows, 1):
        out.append(f"Entry {i} of {n}")
        for label, value in zip(t.columns, row):
            out.append(f"{label}: {value}" if value else f"{label}: (none)")
        out.append("")
    return out


def _txt_section(s: Section, number: str, depth: int) -> list[str]:
    heading = f"{number}. {s.heading}" if depth == 1 else f"{number} {s.heading}"
    out = [heading]
    if depth == 1:
        out.append("-" * len(heading))
    out.append("")
    for fig in s.figures:
        out += [f"Image: {fig.alt}", ""]
    for p in s.paragraphs:
        out += [*p.splitlines(), ""]
    if s.fields:
        for f in s.fields:
            out += _txt_field(f)
        out.append("")
    for t in s.tables:
        out += _txt_table(t)
    subs = [sub for sub in s.subsections if not sub.is_empty()]
    for i, sub in enumerate(subs, 1):
        out += _txt_section(sub, f"{number}.{i}", depth + 1)
    return out


def render_text(doc: ReportDocument) -> bytes:
    """Render structured UTF-8 plain text."""
    out = [doc.title, "=" * len(doc.title)]
    if doc.subtitle:
        out.append(doc.subtitle)
    if doc.org_name:
        out.append(f"Organization: {doc.org_name}")
    for f in doc.meta:
        out += _txt_field(f)
    if doc.generated_at:
        out.append(f"Generated: {doc.generated_at}")
    out.append("")
    for i, s in enumerate(doc.sections, 1):
        out += _txt_section(s, str(i), 1)
    out += doc.notes
    while out and out[-1] == "":
        out.pop()
    return ("\n".join(out) + "\n").encode("utf-8")


# ============================================================================
# WORD (DOCX)
# ============================================================================
#
# What Word, JAWS and NVDA rely on, and what this writer guarantees:
# - the document title is a real "Heading 1"; sections "Heading 2"; nested
#   sections "Heading 3" (never the "Title" style, which is not a heading);
# - core properties carry the title and language, and the default run
#   language (w:lang) is set, so speech uses the right voice;
# - data tables mark the first row as a repeating header row (w:tblHeader)
#   and carry a caption (a "Caption" paragraph plus w:tblCaption);
# - images carry the media record's alt text in wp:docPr/@descr;
# - no tables are used for layout: label/value pairs are paragraphs.

_WORD_LANG = {"en": "en-US"}
_DOCX_FOREST = (0x2B, 0x3A, 0x34)
_DOCX_INK = (0x1C, 0x1C, 0x1A)


def _docx_set_language(document, lang: str) -> None:
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn

    styles = document.styles.element
    defaults = styles.find(qn("w:docDefaults"))
    rpr = None
    if defaults is not None:
        rpr_default = defaults.find(qn("w:rPrDefault"))
        if rpr_default is not None:
            rpr = rpr_default.find(qn("w:rPr"))
    if rpr is None:
        rpr = document.styles["Normal"].element.get_or_add_rPr()
    lang_el = rpr.find(qn("w:lang"))
    if lang_el is None:
        lang_el = OxmlElement("w:lang")
        rpr.append(lang_el)
    lang_el.set(qn("w:val"), lang)
    lang_el.set(qn("w:eastAsia"), lang)


def _docx_style_headings(document) -> None:
    from docx.shared import Pt, RGBColor

    for name, size in (("Heading 1", 20), ("Heading 2", 15), ("Heading 3", 12.5)):
        style = document.styles[name]
        style.font.size = Pt(size)
        style.font.bold = True
        style.font.color.rgb = RGBColor(*_DOCX_FOREST)
    normal = document.styles["Normal"]
    normal.font.size = Pt(11)
    normal.font.color.rgb = RGBColor(*_DOCX_INK)


def _docx_field(document, f: Field) -> None:
    p = document.add_paragraph()
    label = p.add_run(f"{f.label}: ")
    label.bold = True
    lines = f.value.splitlines() or [""]
    if len(lines) > 1:
        label.add_break()
    for i, line in enumerate(lines):
        run = p.add_run(line)
        if i < len(lines) - 1:
            run.add_break()


def _docx_table(document, t: DataTable) -> None:
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn

    if not t.rows:
        p = document.add_paragraph()
        p.add_run(f"{t.caption}: ").bold = True
        p.add_run(t.empty_message)
        return

    document.add_paragraph(t.caption, style="Caption")
    table = document.add_table(rows=1, cols=len(t.columns))
    table.style = document.styles["Table Grid"]

    tbl_pr = table._tbl.tblPr
    caption = OxmlElement("w:tblCaption")
    caption.set(qn("w:val"), t.caption)
    tbl_pr.append(caption)

    header = table.rows[0]
    tr_pr = header._tr.get_or_add_trPr()
    tbl_header = OxmlElement("w:tblHeader")
    tbl_header.set(qn("w:val"), "true")
    tr_pr.append(tbl_header)
    for cell, label in zip(header.cells, t.columns):
        cell.paragraphs[0].add_run(label).bold = True

    for row in t.rows:
        cells = table.add_row().cells
        for i, (cell, value) in enumerate(zip(cells, row)):
            run = cell.paragraphs[0].add_run(value)
            if i == 0 and t.row_header:
                run.bold = True
    document.add_paragraph()


def _docx_figure(document, fig: Figure) -> None:
    import base64
    from docx.shared import Inches

    try:
        document.add_picture(io.BytesIO(base64.b64decode(fig.data_b64)), width=Inches(2.5))
    except Exception:
        # Undecodable image: keep its description so nothing is silently lost.
        document.add_paragraph(f"Image: {fig.alt}")
        return
    doc_pr = document.inline_shapes[-1]._inline.docPr
    doc_pr.set("descr", fig.alt)
    doc_pr.set("title", fig.alt)


def _docx_section(document, s: Section, level: int) -> None:
    document.add_heading(s.heading, level=level)
    for fig in s.figures:
        _docx_figure(document, fig)
    for text in s.paragraphs:
        for line in text.splitlines() or [""]:
            document.add_paragraph(line)
    for f in s.fields:
        _docx_field(document, f)
    for t in s.tables:
        _docx_table(document, t)
    for sub in s.subsections:
        if not sub.is_empty():
            _docx_section(document, sub, min(level + 1, 9))


def render_docx(doc: ReportDocument) -> bytes:
    """Render a Word document with real heading styles and table headers."""
    from docx import Document

    document = Document()
    word_lang = _WORD_LANG.get(doc.lang, doc.lang)
    document.core_properties.title = doc.full_title
    document.core_properties.language = word_lang
    if doc.org_name:
        document.core_properties.author = doc.org_name
    _docx_set_language(document, word_lang)
    _docx_style_headings(document)

    if doc.org_name:
        document.add_paragraph(doc.org_name)
    document.add_heading(doc.title, level=1)
    if doc.subtitle:
        document.add_paragraph(doc.subtitle)
    meta = list(doc.meta)
    if doc.generated_at:
        meta.append(Field("Generated", doc.generated_at))
    for f in meta:
        _docx_field(document, f)
    for s in doc.sections:
        _docx_section(document, s, 2)
    for note in doc.notes:
        document.add_paragraph(note)

    buf = io.BytesIO()
    document.save(buf)
    return buf.getvalue()
