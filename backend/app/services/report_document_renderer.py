"""
Document Renderer for on-demand reports.

Generates formatted PDF documents for individual record reports using reportlab.
Madrona-branded page template with forest header and parchment body.
"""
import io
import logging
from datetime import datetime, timezone
from typing import Any
from uuid import UUID
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    Image as RLImage,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

logger = logging.getLogger(__name__)

# Madrona brand colors
FOREST = colors.HexColor("#1F3A2E")
PARCHMENT = colors.HexColor("#F6F2EC")
INK = colors.HexColor("#1C1C1C")
LICHEN = colors.HexColor("#E6E4E1")
STONE = colors.HexColor("#D8D2C8")
ARCHIVE = colors.HexColor("#6B7A7E")
BARK = colors.HexColor("#8E3B2F")


# ============================================================================
# MADRONA STYLES
# ============================================================================

def _get_madrona_styles() -> dict[str, ParagraphStyle]:
    """Get Madrona-branded paragraph styles."""
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "MadronaTitle",
            parent=base["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=22,
            textColor=FOREST,
            spaceAfter=6,
            leading=26,
        ),
        "subtitle": ParagraphStyle(
            "MadronaSubtitle",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=11,
            textColor=ARCHIVE,
            spaceAfter=18,
        ),
        "section_header": ParagraphStyle(
            "MadronaSectionHeader",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=13,
            textColor=FOREST,
            spaceBefore=16,
            spaceAfter=8,
            borderWidth=0,
            borderPadding=0,
        ),
        "field_label": ParagraphStyle(
            "MadronaFieldLabel",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=9,
            textColor=ARCHIVE,
            spaceAfter=2,
        ),
        "field_value": ParagraphStyle(
            "MadronaFieldValue",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10,
            textColor=INK,
            spaceAfter=8,
            leading=14,
        ),
        "body": ParagraphStyle(
            "MadronaBody",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10,
            textColor=INK,
            spaceAfter=6,
            leading=14,
        ),
        "table_header": ParagraphStyle(
            "MadronaTableHeader",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=8,
            textColor=colors.white,
        ),
        "table_cell": ParagraphStyle(
            "MadronaTableCell",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=8,
            textColor=INK,
            leading=11,
        ),
        "signature_label": ParagraphStyle(
            "MadronaSignatureLabel",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=9,
            textColor=ARCHIVE,
            spaceBefore=6,
        ),
        "footer": ParagraphStyle(
            "MadronaFooter",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=8,
            textColor=ARCHIVE,
            alignment=TA_CENTER,
        ),
    }


# ============================================================================
# PAGE TEMPLATE
# ============================================================================

def _make_header_footer(org_name: str | None = None):
    """Create a header/footer callback with the organization name."""
    display_name = org_name or ""

    def _header_footer(canvas, doc):
        canvas.saveState()

        # Header bar
        canvas.setFillColor(FOREST)
        canvas.rect(0, letter[1] - 50, letter[0], 50, fill=1, stroke=0)

        # Header text — org name on left
        canvas.setFont("Helvetica-Bold", 14)
        canvas.setFillColor(colors.white)
        canvas.drawString(0.75 * inch, letter[1] - 33, display_name)

        # Footer
        canvas.setFillColor(LICHEN)
        canvas.rect(0, 0, letter[0], 30, fill=1, stroke=0)

        canvas.setFillColor(ARCHIVE)
        canvas.setFont("Helvetica", 8)
        timestamp = datetime.now(timezone.utc).strftime("%B %d, %Y at %H:%M UTC")
        canvas.drawString(0.75 * inch, 10, f"Generated {timestamp}")
        canvas.drawRightString(letter[0] - 0.75 * inch, 10, f"Page {doc.page}")

        canvas.restoreState()

    return _header_footer


def _create_doc_template(
    output: io.BytesIO,
    org_name: str | None = None,
) -> BaseDocTemplate:
    """Create a Madrona-branded document template."""
    doc = BaseDocTemplate(
        output,
        pagesize=letter,
        rightMargin=0.75 * inch,
        leftMargin=0.75 * inch,
        topMargin=70,  # Below header bar
        bottomMargin=45,  # Above footer bar
    )

    frame = Frame(
        doc.leftMargin,
        doc.bottomMargin,
        doc.width,
        doc.height,
        id="normal",
    )

    on_page = _make_header_footer(org_name)
    doc.addPageTemplates([
        PageTemplate(id="madrona", frames=frame, onPage=on_page),
    ])

    return doc


# ============================================================================
# FIELD RENDERING HELPERS
# ============================================================================

def _render_field(label: str, value: Any, styles: dict) -> list:
    """Render a single label/value pair."""
    if value is None or value == "":
        return []
    str_val = _format_display(value)
    if len(str_val) > 500:
        str_val = str_val[:497] + "..."
    elements = []
    if label:
        elements.append(Paragraph(label, styles["field_label"]))
    elements.append(Paragraph(escape(str_val), styles["field_value"]))
    return elements


def _format_display(value: Any) -> str:
    """Format a value for display in documents."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, datetime):
        return value.strftime("%B %d, %Y")
    return str(value)


def _format_jsonb_list(items: list[dict] | None, key: str = "term") -> str | None:
    """Format a JSONB array of dicts into a comma-separated string."""
    if not items or not isinstance(items, list):
        return None
    values = [str(item.get(key, item)) if isinstance(item, dict) else str(item) for item in items]
    values = [v for v in values if v]
    return ", ".join(values) if values else None


def _format_measurements(measurements: list[dict] | None) -> str | None:
    """Format JSONB measurements array into human-readable dimensions."""
    if not measurements or not isinstance(measurements, list):
        return None
    parts = []
    for m in measurements:
        if not isinstance(m, dict):
            continue
        dims = []
        for dim in ("height", "width", "depth", "diameter", "length", "weight"):
            val = m.get(dim)
            if val is not None and val != "":
                dims.append(f"{dim.title()}: {val}")
        unit = m.get("unit", "")
        part_name = m.get("part", m.get("type", ""))
        if dims:
            line = " x ".join(dims)
            if unit:
                line += f" {unit}"
            if part_name:
                line = f"{part_name}: {line}"
            parts.append(line)
    return "; ".join(parts) if parts else None


def _format_inscriptions(inscriptions: list[dict] | None) -> str | None:
    """Format JSONB inscriptions array."""
    if not inscriptions or not isinstance(inscriptions, list):
        return None
    parts = []
    for insc in inscriptions:
        if not isinstance(insc, dict):
            continue
        text = insc.get("content") or insc.get("text") or insc.get("inscription", "")
        itype = insc.get("type", "")
        location = insc.get("position") or insc.get("location", "")
        if text:
            line = f'"{text}"'
            if itype:
                line = f"{itype}: {line}"
            if location:
                line += f" ({location})"
            parts.append(line)
    return "; ".join(parts) if parts else None


def _format_creators(creators: list[dict] | None) -> str | None:
    """Format JSONB creators array into human-readable string."""
    if not creators or not isinstance(creators, list):
        return None
    parts = []
    for c in creators:
        if not isinstance(c, dict):
            continue
        name = c.get("name") or c.get("display_name", "")
        role = c.get("role", "")
        if name:
            parts.append(f"{name} ({role})" if role else name)
    return "; ".join(parts) if parts else None


def _render_field_grid(
    fields: list[tuple[str, Any]],
    styles: dict,
    columns: int = 2,
    width: float | None = None,
) -> list:
    """Render fields in a multi-column grid layout."""
    elements = []
    # Filter out empty fields
    non_empty = [(l, v) for l, v in fields if v is not None and v != ""]
    if not non_empty:
        return elements

    # Build rows of column pairs
    rows = []
    for i in range(0, len(non_empty), columns):
        row = []
        for j in range(columns):
            idx = i + j
            if idx < len(non_empty):
                label, value = non_empty[idx]
                cell_content = [
                    Paragraph(label, styles["field_label"]),
                    Paragraph(escape(_format_display(value)), styles["field_value"]),
                ]
                row.append(cell_content)
            else:
                row.append("")
        rows.append(row)

    if rows:
        content_width = width if width is not None else (letter[0] - 1.5 * inch)
        col_width = content_width / columns
        table = Table(rows, colWidths=[col_width] * columns)
        table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        elements.append(table)

    return elements


def _section_divider() -> list:
    """Return a horizontal rule between sections."""
    t = Table([[""]],  colWidths=[letter[0] - 1.5 * inch], rowHeights=[1])
    t.setStyle(TableStyle([
        ("LINEBELOW", (0, 0), (-1, -1), 0.5, LICHEN),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return [t, Spacer(1, 8)]


def _get_org_name(metadata: dict[str, Any]) -> str | None:
    """Extract organization name from metadata if available."""
    return metadata.get("organization_name")


def _fetch_primary_image(record: dict[str, Any], metadata: dict[str, Any]) -> RLImage | None:
    """Fetch the primary image for a collection object and return an RLImage."""
    orm_record = metadata.get("record")
    if not orm_record:
        return None

    object_id = record.get("object_id")
    org_id = record.get("organization_id")
    if not object_id or not org_id:
        return None

    try:
        from app.database import current_session
        from app.models.media import CollectionObjectMedia, Media
        from app.services.storage import get_storage_backend
        from sqlalchemy import select

        # Find primary media link
        link = current_session().execute(
            select(CollectionObjectMedia).where(
                CollectionObjectMedia.object_id == object_id,
                CollectionObjectMedia.is_primary.is_(True),
            )
        ).scalars().first()

        if not link:
            # Fall back to first media by sort order
            link = current_session().execute(
                select(CollectionObjectMedia).where(
                    CollectionObjectMedia.object_id == object_id,
                ).order_by(CollectionObjectMedia.sort_order)
            ).scalars().first()

        if not link:
            return None

        media = current_session().execute(
            select(Media).where(Media.media_id == link.media_id)
        ).scalars().first()

        if not media or media.media_type != "image":
            return None

        s3_key = media.thumbnail_s3_key or media.s3_key
        if not s3_key:
            return None

        storage = get_storage_backend(str(org_id), current_session())
        img_data, _ = storage.get_object_sync(s3_key)
        img_io = io.BytesIO(img_data)
        # 2.5 inch wide, proportional height
        return RLImage(img_io, width=2.5 * inch, height=2.5 * inch, kind="proportional")
    except Exception:
        logger.debug("Could not fetch primary image for object %s", object_id, exc_info=True)
        return None


def _render_items_table(
    items: list[dict[str, Any]],
    columns: list[tuple[str, str]],
    styles: dict,
) -> list:
    """Render a list of items as a styled table.

    Args:
        items: List of row dicts
        columns: List of (field_key, header_label) tuples
        styles: Madrona style dict
    """
    if not items:
        return []

    content_width = letter[0] - 1.5 * inch
    col_widths = [content_width / len(columns)] * len(columns)

    # Header row
    header_row = [Paragraph(label, styles["table_header"]) for _, label in columns]
    table_data = [header_row]

    for item in items:
        row = []
        for field_key, _ in columns:
            val = item.get(field_key, "")
            row.append(Paragraph(escape(_format_display(val)), styles["table_cell"]))
        table_data.append(row)

    table = Table(table_data, colWidths=col_widths, repeatRows=1)
    table.setStyle(TableStyle([
        # Header
        ("BACKGROUND", (0, 0), (-1, 0), FOREST),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 8),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
        ("TOPPADDING", (0, 0), (-1, 0), 6),
        # Data
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 1), (-1, -1), 8),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 4),
        ("TOPPADDING", (0, 1), (-1, -1), 4),
        # Grid
        ("GRID", (0, 0), (-1, -1), 0.5, STONE),
        # Alternating rows
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PARCHMENT]),
    ]))
    return [table]


def _render_signature_block(styles: dict, parties: list[tuple[str, str]]) -> list:
    """Render signature blocks for an agreement document.

    Args:
        styles: Madrona style dict
        parties: List of (role_label, name) tuples, e.g. [("Lender", "John Museum")]
    """
    elements = []
    elements.append(Spacer(1, 24))
    elements.extend(_section_divider())
    elements.append(Paragraph("Signatures", styles["section_header"]))
    elements.append(Spacer(1, 8))

    content_width = letter[0] - 1.5 * inch
    col_width = content_width / 2

    for i in range(0, len(parties), 2):
        row = []
        for j in range(2):
            idx = i + j
            if idx < len(parties):
                role, name = parties[idx]
                cell = [
                    Paragraph(f"<b>{escape(role)}</b>", styles["body"]),
                    Spacer(1, 4),
                    Paragraph(escape(name) if name else "", styles["body"]),
                    Spacer(1, 30),
                    # Signature line
                    Table(
                        [[""]],
                        colWidths=[col_width - 20],
                        rowHeights=[1],
                    ),
                    Paragraph("Signature", styles["signature_label"]),
                    Spacer(1, 20),
                    Table(
                        [[""]],
                        colWidths=[col_width - 20],
                        rowHeights=[1],
                    ),
                    Paragraph("Date", styles["signature_label"]),
                ]
                # Style the signature lines
                for item in cell:
                    if isinstance(item, Table):
                        item.setStyle(TableStyle([
                            ("LINEBELOW", (0, 0), (-1, -1), 0.5, INK),
                            ("TOPPADDING", (0, 0), (-1, -1), 0),
                            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                        ]))
                row.append(cell)
            else:
                row.append("")

        sig_table = Table([row], colWidths=[col_width, col_width])
        sig_table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 16),
        ]))
        elements.append(sig_table)

    return elements


# ============================================================================
# DOCUMENT RENDERERS
# ============================================================================

def render_object_record_sheet(
    data: list[dict[str, Any]],
    metadata: dict[str, Any],
    **kwargs,
) -> bytes:
    """Render a full Object Record Sheet PDF."""
    styles = _get_madrona_styles()
    output = io.BytesIO()
    org_name = _get_org_name(metadata)
    doc = _create_doc_template(output, org_name)
    elements = []

    record = data[0] if data else {}

    # Title
    title = record.get("object_number", "Unknown")
    if record.get("object_name"):
        title = f"{title} — {record['object_name']}"
    elements.append(Paragraph("Object Record Sheet", styles["title"]))
    elements.append(Paragraph(escape(title), styles["subtitle"]))
    elements.extend(_section_divider())

    # Primary image — displayed alongside identification
    image = _fetch_primary_image(record, metadata)
    if image:
        # Two-column layout: identification fields left, image right
        content_width = letter[0] - 1.5 * inch
        img_col = 2.7 * inch
        text_col = content_width - img_col - 8

        ident_fields = _render_field_grid([
            ("Object Number", record.get("object_number")),
            ("Object Name", record.get("object_name")),
            ("Object Type", record.get("object_type")),
            ("Category", record.get("category")),
            ("Catalog Level", record.get("catalog_level")),
            ("Number of Objects", record.get("number_of_objects")),
            ("Status", record.get("object_status")),
            ("Department", record.get("department_name")),
        ], styles, columns=1, width=text_col)

        elements.append(Paragraph("Identification", styles["section_header"]))

        layout_table = Table(
            [[ident_fields, image]],
            colWidths=[text_col, img_col],
        )
        layout_table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        elements.append(layout_table)
    else:
        # No image — standard layout
        elements.append(Paragraph("Identification", styles["section_header"]))
        elements.extend(_render_field_grid([
            ("Object Number", record.get("object_number")),
            ("Object Name", record.get("object_name")),
            ("Object Type", record.get("object_type")),
            ("Category", record.get("category")),
            ("Catalog Level", record.get("catalog_level")),
            ("Number of Objects", record.get("number_of_objects")),
            ("Status", record.get("object_status")),
            ("Department", record.get("department_name")),
        ], styles))

    # Creators / Artists
    creators_text = _format_creators(record.get("creators"))
    if creators_text:
        elements.append(Paragraph("Artists / Creators", styles["section_header"]))
        elements.extend(_render_field("", creators_text, styles))

    # Description
    _desc_fields = [record.get(f) for f in ("brief_description", "full_description", "color", "form", "physical_description", "distinguishing_features")]
    if any(v for v in _desc_fields):
        elements.append(Paragraph("Description", styles["section_header"]))
        elements.extend(_render_field("Brief Description", record.get("brief_description"), styles))
        elements.extend(_render_field("Full Description", record.get("full_description"), styles))
        elements.extend(_render_field_grid([
            ("Color", record.get("color")),
            ("Form", record.get("form")),
            ("Physical Description", record.get("physical_description")),
            ("Distinguishing Features", record.get("distinguishing_features")),
        ], styles))

    # Dimensions / Measurements
    dims_text = _format_measurements(record.get("measurements"))
    if dims_text:
        elements.append(Paragraph("Dimensions", styles["section_header"]))
        elements.extend(_render_field("", dims_text, styles))

    # Materials & Techniques
    materials_text = _format_jsonb_list(record.get("materials"), key="name")
    techniques_text = _format_jsonb_list(record.get("techniques"))
    if materials_text or techniques_text:
        elements.append(Paragraph("Materials & Techniques", styles["section_header"]))
        elements.extend(_render_field_grid([
            ("Materials", materials_text),
            ("Techniques", techniques_text),
        ], styles))

    # Inscriptions
    insc_text = _format_inscriptions(record.get("inscriptions"))
    if insc_text:
        elements.append(Paragraph("Inscriptions & Markings", styles["section_header"]))
        elements.extend(_render_field("", insc_text, styles))

    # Edition / Print
    if any(record.get(f) for f in ("edition", "copy_number", "edition_size", "state_number")):
        elements.append(Paragraph("Edition", styles["section_header"]))
        elements.extend(_render_field_grid([
            ("Edition", record.get("edition")),
            ("Copy Number", record.get("copy_number")),
            ("Edition Size", record.get("edition_size")),
            ("State", f"{record.get('state_number')}/{record.get('total_states')}"
             if record.get("state_number") else None),
        ], styles))
        elements.extend(_render_field("State Description", record.get("state_description"), styles))

    # Production
    if any(record.get(f) for f in ("creation_date_display", "creation_place", "style_period", "production_note")):
        elements.append(Paragraph("Production", styles["section_header"]))
        elements.extend(_render_field_grid([
            ("Date", record.get("creation_date_display")),
            ("Place of Creation", record.get("creation_place")),
            ("Style / Period", record.get("style_period")),
        ], styles))
        elements.extend(_render_field("Production Note", record.get("production_note"), styles))

    # Subject & Content
    subjects = record.get("subjects")
    if subjects and isinstance(subjects, list):
        elements.append(Paragraph("Subject", styles["section_header"]))
        elements.extend(_render_field("Subjects", ", ".join(str(s) for s in subjects), styles))
        elements.extend(_render_field("Content Description", record.get("content_description"), styles))

    # History
    if any(record.get(f) for f in ("provenance", "credit_line", "object_history_note", "comments")):
        elements.append(Paragraph("History", styles["section_header"]))
        elements.extend(_render_field("Provenance", record.get("provenance"), styles))
        elements.extend(_render_field("Credit Line", record.get("credit_line"), styles))
        elements.extend(_render_field("Object History", record.get("object_history_note"), styles))
        elements.extend(_render_field("Comments", record.get("comments"), styles))

    # Location
    if record.get("barcode") or record.get("last_inventoried_date"):
        elements.extend(_section_divider())
        elements.append(Paragraph("Location & Inventory", styles["section_header"]))
        elements.extend(_render_field_grid([
            ("Barcode", record.get("barcode")),
            ("Last Inventoried", record.get("last_inventoried_date")),
        ], styles))

    # Condition (inline summary)
    if record.get("condition_rating"):
        elements.extend(_section_divider())
        elements.append(Paragraph("Condition", styles["section_header"]))
        elements.extend(_render_field_grid([
            ("Condition Rating", record.get("condition_rating")),
            ("Condition Date", record.get("condition_date")),
            ("Completeness", record.get("completeness")),
            ("Conservation Priority", record.get("conservation_priority")),
        ], styles))
        elements.extend(_render_field("Condition Note", record.get("condition_note"), styles))
        elements.extend(_render_field("Handling Requirements", record.get("handling_requirements"), styles))

    # Valuation
    if record.get("current_value") or record.get("insurance_value"):
        elements.extend(_section_divider())
        elements.append(Paragraph("Valuation", styles["section_header"]))
        elements.extend(_render_field_grid([
            ("Current Value", f"{record.get('current_value')} {record.get('current_value_currency', '')}".strip()
             if record.get("current_value") else None),
            ("Valuation Date", record.get("current_value_date")),
            ("Insurance Value", f"{record.get('insurance_value')} {record.get('insurance_value_currency', '')}".strip()
             if record.get("insurance_value") else None),
        ], styles))
        elements.extend(_render_field("Insurance Note", record.get("insurance_note"), styles))

    # Record Info
    elements.extend(_section_divider())
    elements.append(Paragraph("Record Information", styles["section_header"]))
    elements.extend(_render_field_grid([
        ("Created", record.get("created_at")),
        ("Updated", record.get("updated_at")),
    ], styles))

    doc.build(elements)
    return output.getvalue()


def render_condition_report(
    data: list[dict[str, Any]],
    metadata: dict[str, Any],
    **kwargs,
) -> bytes:
    """Render a Condition Report document PDF."""
    styles = _get_madrona_styles()
    output = io.BytesIO()
    org_name = _get_org_name(metadata)
    doc = _create_doc_template(output, org_name)
    elements = []

    record = data[0] if data else {}

    elements.append(Paragraph("Condition Report", styles["title"]))
    elements.append(Paragraph(
        escape(record.get("report_number", "")),
        styles["subtitle"],
    ))
    elements.extend(_section_divider())

    # Linked object reference
    object_name = _resolve_linked_object(record, metadata)
    if object_name:
        elements.append(Paragraph("Object", styles["section_header"]))
        elements.extend(_render_field("", object_name, styles))

    # Overview
    elements.append(Paragraph("Report Details", styles["section_header"]))
    elements.extend(_render_field_grid([
        ("Report Number", record.get("report_number")),
        ("Report Type", _format_enum(record.get("report_type"))),
        ("Report Date", record.get("report_date")),
        ("Status", _format_enum(record.get("status"))),
        ("Examiner", record.get("examiner_name")),
        ("Institution", record.get("examiner_institution")),
        ("Method", _format_enum(record.get("examination_method"))),
        ("Place", record.get("examination_place")),
    ], styles))

    # Assessment
    elements.append(Paragraph("Assessment", styles["section_header"]))
    elements.extend(_render_field_grid([
        ("Overall Condition", _format_enum(record.get("overall_condition"))),
        ("Conservation Needed", record.get("conservation_needed")),
        ("Conservation Priority", _format_enum(record.get("conservation_priority"))),
        ("Completed", record.get("completed_date")),
    ], styles))
    elements.extend(_render_field("Condition Summary", record.get("condition_summary"), styles))
    elements.extend(_render_field("Recommendations", record.get("recommendations"), styles))

    # Handling & Requirements
    if any(record.get(f) for f in ("handling_requirements", "packing_requirements", "display_restrictions")):
        elements.append(Paragraph("Handling & Requirements", styles["section_header"]))
        elements.extend(_render_field("Handling Requirements", record.get("handling_requirements"), styles))
        elements.extend(_render_field("Packing Requirements", record.get("packing_requirements"), styles))
        elements.extend(_render_field("Display Restrictions", record.get("display_restrictions"), styles))

    # Notes
    if record.get("report_note"):
        elements.append(Paragraph("Notes", styles["section_header"]))
        elements.extend(_render_field("", record.get("report_note"), styles))

    # Record Info
    elements.extend(_section_divider())
    elements.append(Paragraph("Record Information", styles["section_header"]))
    elements.extend(_render_field_grid([
        ("Assigned To", record.get("assigned_to_name")),
        ("Created", record.get("created_at")),
    ], styles))

    doc.build(elements)
    return output.getvalue()


def render_loan_agreement(
    data: list[dict[str, Any]],
    metadata: dict[str, Any],
    **kwargs,
) -> bytes:
    """Render a Loan Agreement document PDF."""
    styles = _get_madrona_styles()
    output = io.BytesIO()
    org_name = _get_org_name(metadata)
    doc = _create_doc_template(output, org_name)
    elements = []

    record = data[0] if data else {}

    # Determine loan direction
    is_loan_in = "lender_name" in record
    loan_type = "Incoming Loan" if is_loan_in else "Outgoing Loan"

    elements.append(Paragraph(f"{loan_type} Agreement", styles["title"]))
    elements.append(Paragraph(
        escape(record.get("loan_number", "")),
        styles["subtitle"],
    ))
    elements.extend(_section_divider())

    # Parties
    elements.append(Paragraph("Parties", styles["section_header"]))
    if is_loan_in:
        elements.extend(_render_field_grid([
            ("Lender", record.get("lender_name")),
            ("Purpose", _format_enum(record.get("loan_purpose"))),
            ("Exhibition", record.get("exhibition_name")),
            ("Venue", record.get("exhibition_venue")),
            ("Status", _format_enum(record.get("status"))),
        ], styles))
    else:
        elements.extend(_render_field_grid([
            ("Borrower", record.get("borrower_name")),
            ("Purpose", _format_enum(record.get("loan_purpose"))),
            ("Exhibition", record.get("exhibition_title")),
            ("Venue", record.get("venue_name")),
            ("Status", _format_enum(record.get("status"))),
        ], styles))

    # Dates
    elements.append(Paragraph("Dates", styles["section_header"]))
    if is_loan_in:
        elements.extend(_render_field_grid([
            ("Request Date", record.get("request_date")),
            ("Approval Date", record.get("approval_date")),
            ("Start Date", record.get("loan_start_date")),
            ("End Date", record.get("loan_end_date")),
            ("Received", record.get("actual_receipt_date")),
            ("Returned", record.get("actual_return_date")),
        ], styles))
    else:
        elements.extend(_render_field_grid([
            ("Request Date", record.get("request_date")),
            ("Approval Date", record.get("approval_date")),
            ("Start Date", record.get("loan_start_date")),
            ("End Date", record.get("loan_end_date")),
            ("Dispatched", record.get("actual_dispatch_date")),
            ("Returned", record.get("actual_return_date")),
        ], styles))

    # Insurance & Shipping
    elements.append(Paragraph("Insurance & Shipping", styles["section_header"]))
    elements.extend(_render_field_grid([
        ("Insurance Value", record.get("insurance_value") or record.get("insurance_value_total")),
        ("Currency", record.get("insurance_currency")),
        ("Shipping Method", _format_enum(record.get("shipping_method"))),
        ("Courier Required", record.get("courier_required")),
        ("Assigned To", record.get("assigned_to_name")),
    ], styles))

    # Conditions & Requirements
    if any(record.get(f) for f in ("loan_conditions", "special_requirements", "special_conditions",
                                    "display_requirements", "photography_restrictions")):
        elements.append(Paragraph("Conditions & Requirements", styles["section_header"]))
        elements.extend(_render_field("Loan Conditions",
                                       record.get("loan_conditions") or record.get("special_conditions"), styles))
        elements.extend(_render_field("Special Requirements", record.get("special_requirements"), styles))
        elements.extend(_render_field("Display Requirements", record.get("display_requirements"), styles))
        elements.extend(_render_field("Photography Restrictions", record.get("photography_restrictions"), styles))

    # Objects on loan
    loan_objects = _fetch_loan_objects(record, metadata, is_loan_in)
    if loan_objects:
        elements.append(Paragraph("Objects on Loan", styles["section_header"]))
        if is_loan_in:
            elements.extend(_render_items_table(loan_objects, [
                ("object_title", "Title / Description"),
                ("object_number_lender", "Lender No."),
                ("artist_maker", "Artist / Maker"),
                ("medium", "Medium"),
                ("dimensions", "Dimensions"),
                ("insurance_value", "Insurance Value"),
            ], styles))
        else:
            elements.extend(_render_items_table(loan_objects, [
                ("object_number", "Object No."),
                ("object_name", "Name"),
                ("insurance_value", "Insurance Value"),
                ("display_credit_line", "Credit Line"),
            ], styles))

    # Agreement reference
    if record.get("loan_agreement_reference") or record.get("loan_agreement_date"):
        elements.append(Paragraph("Agreement", styles["section_header"]))
        elements.extend(_render_field_grid([
            ("Agreement Reference", record.get("loan_agreement_reference")),
            ("Agreement Date", record.get("loan_agreement_date")),
            ("Signed Date", record.get("loan_agreement_signed_date")),
        ], styles))

    # Notes
    if record.get("loan_note"):
        elements.append(Paragraph("Notes", styles["section_header"]))
        elements.extend(_render_field("", record.get("loan_note"), styles))

    # Signature blocks
    if is_loan_in:
        parties = [
            ("Lender", record.get("lender_name", "")),
            ("Borrower (Institution Representative)", org_name or ""),
        ]
    else:
        parties = [
            ("Lender (Institution Representative)", org_name or ""),
            ("Borrower", record.get("borrower_name", "")),
        ]
    elements.extend(_render_signature_block(styles, parties))

    doc.build(elements)
    return output.getvalue()


def render_object_entry_report(
    data: list[dict[str, Any]],
    metadata: dict[str, Any],
    **kwargs,
) -> bytes:
    """Render an Object Entry report document PDF."""
    styles = _get_madrona_styles()
    output = io.BytesIO()
    org_name = _get_org_name(metadata)
    doc = _create_doc_template(output, org_name)
    elements = []

    record = data[0] if data else {}

    elements.append(Paragraph("Object Entry Record", styles["title"]))
    elements.append(Paragraph(
        escape(record.get("entry_number", "")),
        styles["subtitle"],
    ))
    elements.extend(_section_divider())

    # Entry details
    elements.append(Paragraph("Entry Details", styles["section_header"]))
    elements.extend(_render_field_grid([
        ("Entry Number", record.get("entry_number")),
        ("Entry Date", record.get("entry_date")),
        ("Depositor", record.get("depositor_name")),
        ("Current Owner", record.get("current_owner")),
        ("Entry Reason", _format_enum(record.get("entry_reason"))),
        ("Status", _format_enum(record.get("status"))),
        ("Number of Objects", record.get("objects_count")),
        ("Assigned To", record.get("assigned_to_name")),
    ], styles))

    # Objects description
    elements.extend(_render_field("Objects Description", record.get("objects_description"), styles))

    # Dates & Duration
    elements.append(Paragraph("Dates", styles["section_header"]))
    elements.extend(_render_field_grid([
        ("Expected Return", record.get("expected_return_date")),
        ("Return Date", record.get("return_date")),
        ("Expected Duration", record.get("expected_duration")),
    ], styles))

    # Insurance
    if record.get("insurance_value"):
        elements.append(Paragraph("Insurance", styles["section_header"]))
        elements.extend(_render_field_grid([
            ("Insurance Value", record.get("insurance_value")),
            ("Currency", record.get("insurance_currency")),
        ], styles))

    # Outcome
    if record.get("outcome"):
        elements.append(Paragraph("Outcome", styles["section_header"]))
        elements.extend(_render_field("Outcome", _format_enum(record.get("outcome")), styles))

    # Notes
    if record.get("entry_note"):
        elements.append(Paragraph("Notes", styles["section_header"]))
        elements.extend(_render_field("", record.get("entry_note"), styles))

    # Record Info
    elements.extend(_section_divider())
    elements.append(Paragraph("Record Information", styles["section_header"]))
    elements.extend(_render_field_grid([
        ("Created", record.get("created_at")),
    ], styles))

    doc.build(elements)
    return output.getvalue()


def render_object_exit_report(
    data: list[dict[str, Any]],
    metadata: dict[str, Any],
    **kwargs,
) -> bytes:
    """Render an Object Exit report document PDF."""
    styles = _get_madrona_styles()
    output = io.BytesIO()
    org_name = _get_org_name(metadata)
    doc = _create_doc_template(output, org_name)
    elements = []

    record = data[0] if data else {}

    elements.append(Paragraph("Object Exit Record", styles["title"]))
    elements.append(Paragraph(
        escape(record.get("exit_number", "")),
        styles["subtitle"],
    ))
    elements.extend(_section_divider())

    # Exit details
    elements.append(Paragraph("Exit Details", styles["section_header"]))
    elements.extend(_render_field_grid([
        ("Exit Number", record.get("exit_number")),
        ("Exit Date", record.get("exit_date")),
        ("Recipient", record.get("recipient_name")),
        ("Exit Reason", _format_enum(record.get("exit_reason"))),
        ("Exit Method", _format_enum(record.get("exit_method"))),
        ("Status", _format_enum(record.get("status"))),
        ("Assigned To", record.get("assigned_to_name")),
    ], styles))

    # Shipping
    if any(record.get(f) for f in ("shipping_method", "shipping_company", "tracking_number")):
        elements.append(Paragraph("Shipping", styles["section_header"]))
        elements.extend(_render_field_grid([
            ("Shipping Method", _format_enum(record.get("shipping_method"))),
            ("Shipping Company", record.get("shipping_company")),
            ("Tracking Number", record.get("tracking_number")),
            ("Courier", record.get("courier_name")),
        ], styles))

    # Insurance
    if record.get("insurance_value"):
        elements.append(Paragraph("Insurance", styles["section_header"]))
        elements.extend(_render_field_grid([
            ("Insurance Value", record.get("insurance_value")),
            ("Currency", record.get("insurance_currency")),
        ], styles))

    # Condition
    elements.extend(_render_field("Condition at Exit", record.get("condition_at_exit"), styles))

    # Notes
    if record.get("exit_note"):
        elements.append(Paragraph("Notes", styles["section_header"]))
        elements.extend(_render_field("", record.get("exit_note"), styles))

    # Record Info
    elements.extend(_section_divider())
    elements.append(Paragraph("Record Information", styles["section_header"]))
    elements.extend(_render_field_grid([
        ("Created", record.get("created_at")),
    ], styles))

    doc.build(elements)
    return output.getvalue()


def render_conservation_treatment_report(
    data: list[dict[str, Any]],
    metadata: dict[str, Any],
    **kwargs,
) -> bytes:
    """Render a Conservation Treatment report document PDF."""
    styles = _get_madrona_styles()
    output = io.BytesIO()
    org_name = _get_org_name(metadata)
    doc = _create_doc_template(output, org_name)
    elements = []

    record = data[0] if data else {}

    elements.append(Paragraph("Conservation Treatment Report", styles["title"]))
    elements.append(Paragraph(
        escape(record.get("treatment_number", "")),
        styles["subtitle"],
    ))
    elements.extend(_section_divider())

    # Linked object
    object_name = _resolve_linked_object_by_fk(record, metadata, "object_id")
    if object_name:
        elements.append(Paragraph("Object", styles["section_header"]))
        elements.extend(_render_field("", object_name, styles))

    # Treatment details
    elements.append(Paragraph("Treatment Details", styles["section_header"]))
    elements.extend(_render_field_grid([
        ("Treatment Number", record.get("treatment_number")),
        ("Treatment Type", _format_enum(record.get("treatment_type"))),
        ("Conservator", record.get("conservator_name")),
        ("Institution", record.get("conservator_institution")),
        ("Status", _format_enum(record.get("status"))),
        ("Assigned To", record.get("assigned_to_name")),
    ], styles))

    # Dates
    elements.append(Paragraph("Dates", styles["section_header"]))
    elements.extend(_render_field_grid([
        ("Proposal Date", record.get("proposal_date")),
        ("Start Date", record.get("start_date")),
        ("End Date", record.get("end_date")),
        ("Duration (days)", record.get("actual_duration_days")),
    ], styles))

    # Costs
    if record.get("estimated_cost") or record.get("actual_cost"):
        elements.append(Paragraph("Costs", styles["section_header"]))
        elements.extend(_render_field_grid([
            ("Estimated Cost", f"{record.get('estimated_cost')} {record.get('estimated_cost_currency', '')}".strip()
             if record.get("estimated_cost") else None),
            ("Actual Cost", f"{record.get('actual_cost')} {record.get('actual_cost_currency', '')}".strip()
             if record.get("actual_cost") else None),
        ], styles))

    # Treatment description
    elements.extend(_render_field("Treatment Description", record.get("treatment_description"), styles))
    elements.extend(_render_field("Treatment Rationale", record.get("treatment_rationale"), styles))

    # Materials & Methods
    materials_text = _format_jsonb_list(record.get("materials_used"), key="name")
    techniques_text = _format_jsonb_list(record.get("techniques_used"), key="name")
    if materials_text or techniques_text or record.get("methods_used"):
        elements.append(Paragraph("Materials & Methods", styles["section_header"]))
        elements.extend(_render_field("Materials Used", materials_text, styles))
        elements.extend(_render_field("Techniques Used", techniques_text, styles))
        elements.extend(_render_field("Methods", record.get("methods_used"), styles))

    # Recommendations
    elements.extend(_render_field("Recommendations", record.get("recommendations"), styles))
    elements.extend(_render_field("Future Care Instructions", record.get("future_care_instructions"), styles))

    # Notes
    if record.get("treatment_note"):
        elements.append(Paragraph("Notes", styles["section_header"]))
        elements.extend(_render_field("", record.get("treatment_note"), styles))

    # Record Info
    elements.extend(_section_divider())
    elements.append(Paragraph("Record Information", styles["section_header"]))
    elements.extend(_render_field_grid([
        ("Created", record.get("created_at")),
    ], styles))

    doc.build(elements)
    return output.getvalue()


def render_acquisition_report(
    data: list[dict[str, Any]],
    metadata: dict[str, Any],
    **kwargs,
) -> bytes:
    """Render an Acquisition report document PDF."""
    styles = _get_madrona_styles()
    output = io.BytesIO()
    org_name = _get_org_name(metadata)
    doc = _create_doc_template(output, org_name)
    elements = []

    record = data[0] if data else {}

    elements.append(Paragraph("Acquisition Record", styles["title"]))
    elements.append(Paragraph(
        escape(record.get("acquisition_number", "")),
        styles["subtitle"],
    ))
    elements.extend(_section_divider())

    # Acquisition details
    elements.append(Paragraph("Acquisition Details", styles["section_header"]))
    elements.extend(_render_field_grid([
        ("Acquisition Number", record.get("acquisition_number")),
        ("Method", _format_enum(record.get("acquisition_method"))),
        ("Acquisition Date", record.get("acquisition_date")),
        ("Source", record.get("source_name")),
        ("Source Type", _format_enum(record.get("source_type"))),
        ("Status", _format_enum(record.get("status"))),
        ("Number of Objects", record.get("objects_count")),
        ("Assigned To", record.get("assigned_to_name")),
    ], styles))

    # Accession
    if record.get("accession_number") or record.get("accession_date"):
        elements.append(Paragraph("Accession", styles["section_header"]))
        elements.extend(_render_field_grid([
            ("Accession Number", record.get("accession_number")),
            ("Accession Date", record.get("accession_date")),
        ], styles))

    # Financial
    if record.get("cost") or record.get("funding_source"):
        elements.append(Paragraph("Financial", styles["section_header"]))
        elements.extend(_render_field_grid([
            ("Cost", f"{record.get('cost')} {record.get('cost_currency', '')}".strip()
             if record.get("cost") else None),
            ("Funding Source", record.get("funding_source")),
        ], styles))

    # Legal
    if record.get("legal_status") or record.get("credit_line"):
        elements.append(Paragraph("Legal & Credits", styles["section_header"]))
        elements.extend(_render_field_grid([
            ("Legal Status", _format_enum(record.get("legal_status"))),
            ("Credit Line", record.get("credit_line")),
        ], styles))
        elements.extend(_render_field("Provisos", record.get("provisos"), styles))
        elements.extend(_render_field("Donor Restrictions", record.get("donor_restrictions"), styles))

    # Notes
    if record.get("acquisition_note"):
        elements.append(Paragraph("Notes", styles["section_header"]))
        elements.extend(_render_field("", record.get("acquisition_note"), styles))

    # Record Info
    elements.extend(_section_divider())
    elements.append(Paragraph("Record Information", styles["section_header"]))
    elements.extend(_render_field_grid([
        ("Created", record.get("created_at")),
    ], styles))

    doc.build(elements)
    return output.getvalue()


# ============================================================================
# DATA LOOKUP HELPERS
# ============================================================================

def _format_enum(value: Any) -> str | None:
    """Format an enum/status value for display (e.g. 'pre_treatment' -> 'Pre Treatment')."""
    if not value or not isinstance(value, str):
        return None
    return value.replace("_", " ").title()


def _resolve_linked_object(record: dict, metadata: dict) -> str | None:
    """Resolve the linked collection object for a condition report."""
    object_id = record.get("object_id")
    if not object_id:
        return None
    return _resolve_linked_object_by_fk(record, metadata, "object_id")


def _resolve_linked_object_by_fk(record: dict, metadata: dict, fk_field: str) -> str | None:
    """Resolve a collection object by FK field and return a display string."""
    object_id = record.get(fk_field)
    if not object_id:
        return None
    org_id = record.get("organization_id")
    if not org_id:
        return None

    try:
        from app.database import current_session
        from app.models import CollectionObject
        from sqlalchemy import select

        obj = current_session().execute(
            select(CollectionObject).where(
                CollectionObject.object_id == object_id,
                CollectionObject.organization_id == org_id,
            )
        ).scalars().first()
        if obj:
            parts = [obj.object_number]
            if obj.object_name:
                parts.append(obj.object_name)
            return " — ".join(parts)
    except Exception:
        logger.debug("Could not resolve linked object %s", object_id, exc_info=True)
    return None


def _fetch_loan_objects(
    record: dict[str, Any],
    metadata: dict[str, Any],
    is_loan_in: bool,
) -> list[dict[str, Any]]:
    """Fetch objects associated with a loan."""
    orm_record = metadata.get("record")
    if not orm_record:
        return []

    org_id = record.get("organization_id")
    if not org_id:
        return []

    try:
        from app.database import current_session
        from sqlalchemy import select

        if is_loan_in:
            from app.models.procedures import LoanInObject
            loan_id = record.get("loan_in_id")
            if not loan_id:
                return []
            items = current_session().execute(
                select(LoanInObject).where(
                    LoanInObject.loan_in_id == loan_id,
                    LoanInObject.organization_id == org_id,
                )
            ).scalars().all()
            return [
                {
                    "object_title": item.object_title or item.object_description or "",
                    "object_number_lender": item.object_number_lender or "",
                    "artist_maker": item.artist_maker or "",
                    "medium": item.medium or "",
                    "dimensions": item.dimensions or "",
                    "insurance_value": f"{item.insurance_value} {item.insurance_currency or ''}".strip()
                        if item.insurance_value else "",
                }
                for item in items
            ]
        else:
            from app.models.procedures import LoanOutObject
            from app.models import CollectionObject
            loan_id = record.get("loan_out_id")
            if not loan_id:
                return []
            items = current_session().execute(
                select(LoanOutObject).where(
                    LoanOutObject.loan_out_id == loan_id,
                    LoanOutObject.organization_id == org_id,
                )
            ).scalars().all()

            # Batch-fetch linked collection objects for names
            obj_ids = [i.object_id for i in items if i.object_id]
            objs_by_id = {}
            if obj_ids:
                objs = current_session().execute(
                    select(CollectionObject).where(CollectionObject.object_id.in_(obj_ids))
                ).scalars().all()
                objs_by_id = {o.object_id: o for o in objs}

            return [
                {
                    "object_number": (objs_by_id.get(item.object_id).object_number
                                      if item.object_id and objs_by_id.get(item.object_id) else ""),
                    "object_name": (objs_by_id.get(item.object_id).object_name or ""
                                    if item.object_id and objs_by_id.get(item.object_id) else ""),
                    "insurance_value": f"{item.insurance_value} {item.insurance_currency or ''}".strip()
                        if item.insurance_value else "",
                    "display_credit_line": item.display_credit_line or "",
                }
                for item in items
            ]
    except Exception:
        logger.debug("Could not fetch loan objects", exc_info=True)
        return []


# ============================================================================
# HTML / WEASYPRINT RENDERERS
# ============================================================================

def _get_template_env(org_id: str | None = None):
    """Build a Jinja2 environment with optional per-org template overrides from S3.

    Checks S3 at ``report-templates/{org_id}/{template_name}`` first, then falls
    back to the built-in package templates.  Customers can upload their own HTML
    templates to customise reports; broken uploads are caught and logged so they
    never take down the default renderer.
    """
    import jinja2
    import jinja2.sandbox

    default_loader = jinja2.PackageLoader("app.services", "builtin_report_templates")

    if org_id:
        loader = jinja2.ChoiceLoader([
            _S3TemplateLoader(str(org_id)),
            default_loader,
        ])
        return jinja2.sandbox.SandboxedEnvironment(loader=loader, autoescape=True)

    return jinja2.sandbox.SandboxedEnvironment(loader=default_loader, autoescape=True)


class _S3TemplateLoader:
    """Jinja2-compatible loader that fetches templates from S3.

    Looks for ``report-templates/{org_id}/{template_name}`` in the org's
    platform storage bucket.  Returns ``None`` on any error so the
    ``ChoiceLoader`` falls through to the default package template.
    """

    def __init__(self, org_id: str):
        self.org_id = org_id

    # Jinja2 loader protocol ------------------------------------------------

    def get_source(self, environment, template):
        import jinja2

        source = self._fetch(template)
        if source is None:
            raise jinja2.TemplateNotFound(template)
        # (source, filename, uptodate_callable)
        return source, f"s3://{self.org_id}/{template}", lambda: False

    def load(self, environment, name, globals=None):
        # Let Environment handle it via get_source
        return None  # pragma: no cover

    # S3 fetch ---------------------------------------------------------------

    def _fetch(self, template_name: str) -> str | None:
        try:
            from app.database import current_session
            from app.services.storage import get_storage_backend

            storage = get_storage_backend(self.org_id, current_session(), bucket_type="platform")
            s3_key = f"report-templates/{self.org_id}/{template_name}"
            data, _ = storage.get_object_sync(s3_key)
            return data.decode("utf-8")
        except Exception:
            # Any failure (missing key, no bucket, decode error) → skip
            return None


def _fetch_primary_image_b64(
    record: dict[str, Any],
    metadata: dict[str, Any],
) -> tuple[str, str] | None:
    """Fetch the primary image as a base64 string for HTML embedding.

    Returns (base64_string, mime_type) or None.
    """
    orm_record = metadata.get("record")
    if not orm_record:
        return None

    object_id = record.get("object_id")
    org_id = record.get("organization_id")
    if not object_id or not org_id:
        return None

    try:
        import base64

        from app.database import current_session
        from app.models.media import CollectionObjectMedia, Media
        from app.services.storage import get_storage_backend
        from sqlalchemy import select

        # Find primary media link
        link = current_session().execute(
            select(CollectionObjectMedia).where(
                CollectionObjectMedia.object_id == object_id,
                CollectionObjectMedia.is_primary.is_(True),
            )
        ).scalars().first()

        if not link:
            link = current_session().execute(
                select(CollectionObjectMedia).where(
                    CollectionObjectMedia.object_id == object_id,
                ).order_by(CollectionObjectMedia.sort_order)
            ).scalars().first()

        if not link:
            return None

        media = current_session().execute(
            select(Media).where(Media.media_id == link.media_id)
        ).scalars().first()

        if not media or media.media_type != "image":
            return None

        s3_key = media.thumbnail_s3_key or media.s3_key
        if not s3_key:
            return None

        storage = get_storage_backend(str(org_id), current_session())
        img_data, _ = storage.get_object_sync(s3_key)

        mime = "image/jpeg"
        if s3_key.endswith(".png"):
            mime = "image/png"
        elif s3_key.endswith(".webp"):
            mime = "image/webp"

        return base64.b64encode(img_data).decode("ascii"), mime
    except Exception:
        logger.debug("Could not fetch primary image b64 for object %s", object_id, exc_info=True)
        return None


# ============================================================================
# NATIVE DOCX BUILDERS (python-docx)
# ============================================================================

# Madrona brand colors for DOCX
_FOREST_RGB = (0x1F, 0x3A, 0x2E)
_ARCHIVE_RGB = (0x6B, 0x7A, 0x7E)
_LICHEN_RGB = (0xE6, 0xE4, 0xE1)
_INK_RGB = (0x1C, 0x1C, 0x1C)
_BARK_RGB = (0x8E, 0x3B, 0x2F)


def _docx_setup_styles(doc):
    """Configure Madrona-branded styles on a python-docx Document."""
    from docx.shared import Pt, RGBColor
    from docx.enum.text import WD_ALIGN_PARAGRAPH

    styles = doc.styles

    # Title style
    title_style = styles["Title"]
    title_style.font.size = Pt(22)
    title_style.font.color.rgb = RGBColor(*_FOREST_RGB)
    title_style.font.bold = True
    title_style.paragraph_format.space_after = Pt(2)

    # Subtitle style
    subtitle_style = styles["Subtitle"]
    subtitle_style.font.size = Pt(11)
    subtitle_style.font.color.rgb = RGBColor(*_ARCHIVE_RGB)
    subtitle_style.font.bold = False
    subtitle_style.paragraph_format.space_after = Pt(10)

    # Heading 2 — section headers
    h2 = styles["Heading 2"]
    h2.font.size = Pt(13)
    h2.font.color.rgb = RGBColor(*_FOREST_RGB)
    h2.font.bold = True
    h2.paragraph_format.space_before = Pt(14)
    h2.paragraph_format.space_after = Pt(6)

    # Normal body
    normal = styles["Normal"]
    normal.font.size = Pt(10)
    normal.font.color.rgb = RGBColor(*_INK_RGB)
    normal.paragraph_format.space_after = Pt(4)

    return doc


def _docx_add_field(doc, label: str, value: str | None):
    """Add a label/value field pair to the document."""
    if not value:
        return
    from docx.shared import Pt, RGBColor

    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after = Pt(4)

    label_run = p.add_run(f"{label}: ")
    label_run.font.size = Pt(9)
    label_run.font.bold = True
    label_run.font.color.rgb = RGBColor(*_ARCHIVE_RGB)

    value_run = p.add_run(str(value))
    value_run.font.size = Pt(10)
    value_run.font.color.rgb = RGBColor(*_INK_RGB)


def _docx_add_field_block(doc, label: str, value: str | None):
    """Add a full-width label + block value (for longer text)."""
    if not value:
        return
    from docx.shared import Pt, RGBColor

    lp = doc.add_paragraph()
    lp.paragraph_format.space_before = Pt(2)
    lp.paragraph_format.space_after = Pt(1)
    lr = lp.add_run(label.upper())
    lr.font.size = Pt(9)
    lr.font.bold = True
    lr.font.color.rgb = RGBColor(*_ARCHIVE_RGB)

    vp = doc.add_paragraph(str(value))
    vp.paragraph_format.space_before = Pt(0)
    vp.paragraph_format.space_after = Pt(6)
    for run in vp.runs:
        run.font.size = Pt(10)
        run.font.color.rgb = RGBColor(*_INK_RGB)


def _docx_add_field_pair_row(table, label1, val1, label2, val2):
    """Add a two-column row to a field table."""
    from docx.shared import Pt, RGBColor

    row = table.add_row()
    for idx, (label, val) in enumerate([(label1, val1), (label2, val2)]):
        cell = row.cells[idx]
        if not val:
            cell.text = ""
            continue
        p = cell.paragraphs[0]
        p.paragraph_format.space_after = Pt(4)
        lr = p.add_run(f"{label}\n")
        lr.font.size = Pt(9)
        lr.font.bold = True
        lr.font.color.rgb = RGBColor(*_ARCHIVE_RGB)
        vr = p.add_run(str(val))
        vr.font.size = Pt(10)
        vr.font.color.rgb = RGBColor(*_INK_RGB)


def _docx_make_field_table(doc):
    """Create a borderless two-column table for field pairs."""
    from docx.shared import Inches
    table = doc.add_table(rows=0, cols=2)
    table.columns[0].width = Inches(3.25)
    table.columns[1].width = Inches(3.25)
    # Remove borders
    for cell in table.columns[0].cells + table.columns[1].cells:
        _docx_clear_cell_borders(cell)
    return table


def _docx_clear_cell_borders(cell):
    """Remove all borders from a table cell."""
    from docx.oxml.ns import qn
    tc_pr = cell._element.get_or_add_tcPr()
    tc_borders = tc_pr.find(qn("w:tcBorders"))
    if tc_borders is not None:
        tc_pr.remove(tc_borders)


def _docx_add_section(doc, heading: str):
    """Add a section heading."""
    doc.add_heading(heading, level=2)


def _build_object_record_sheet_docx(context: dict[str, Any]) -> bytes:
    """Build an Object Record Sheet DOCX natively with python-docx."""
    import base64 as _b64
    from docx import Document as DocxDocument
    from docx.shared import Inches, Pt, RGBColor

    doc = DocxDocument()
    _docx_setup_styles(doc)

    # -- Header: org name
    hp = doc.add_paragraph()
    hp.paragraph_format.space_after = Pt(2)
    hr = hp.add_run(context.get("org_name") or "")
    hr.font.size = Pt(14)
    hr.font.bold = True
    hr.font.color.rgb = RGBColor(*_FOREST_RGB)

    # -- Title
    doc.add_paragraph("Object Record Sheet", style="Title")
    doc.add_paragraph(context.get("title", ""), style="Subtitle")

    # -- Identification section with image
    _docx_add_section(doc, "Identification")

    # If there's a primary image, add it right-aligned
    image_b64 = context.get("image_b64")
    if image_b64:
        try:
            img_bytes = _b64.b64decode(image_b64)
            img_stream = io.BytesIO(img_bytes)
            doc.add_picture(img_stream, width=Inches(2.5))
            # Add a small spacer after the image
            doc.add_paragraph().paragraph_format.space_after = Pt(4)
        except Exception:
            logger.debug("Failed to add image to DOCX", exc_info=True)

    # Identification fields
    for label, value in context.get("ident_fields", []):
        _docx_add_field(doc, label, value)

    # -- Creators
    if context.get("creators"):
        _docx_add_section(doc, "Artists / Creators")
        p = doc.add_paragraph(context["creators"])
        for run in p.runs:
            run.font.size = Pt(10)

    # -- Description
    desc_fields = [
        context.get("brief_description"),
        context.get("full_description"),
        context.get("color"),
        context.get("form"),
        context.get("physical_description"),
        context.get("distinguishing_features"),
    ]
    if any(desc_fields):
        _docx_add_section(doc, "Description")
        _docx_add_field_block(doc, "Brief Description", context.get("brief_description"))
        _docx_add_field_block(doc, "Full Description", context.get("full_description"))
        table = _docx_make_field_table(doc)
        _docx_add_field_pair_row(table, "Color", context.get("color"),
                                 "Form", context.get("form"))
        _docx_add_field_pair_row(table, "Physical Description", context.get("physical_description"),
                                 "Distinguishing Features", context.get("distinguishing_features"))

    # -- Dimensions
    if context.get("dimensions"):
        _docx_add_section(doc, "Dimensions")
        p = doc.add_paragraph(context["dimensions"])
        for run in p.runs:
            run.font.size = Pt(10)

    # -- Materials & Techniques
    if context.get("materials") or context.get("techniques"):
        _docx_add_section(doc, "Materials & Techniques")
        table = _docx_make_field_table(doc)
        _docx_add_field_pair_row(table, "Materials", context.get("materials"),
                                 "Techniques", context.get("techniques"))

    # -- Inscriptions
    if context.get("inscriptions"):
        _docx_add_section(doc, "Inscriptions & Markings")
        p = doc.add_paragraph(context["inscriptions"])
        for run in p.runs:
            run.font.size = Pt(10)

    # -- Edition
    edition_fields = [context.get("edition"), context.get("copy_number"),
                      context.get("edition_size"), context.get("state_display")]
    if any(edition_fields):
        _docx_add_section(doc, "Edition")
        table = _docx_make_field_table(doc)
        _docx_add_field_pair_row(table, "Edition", context.get("edition"),
                                 "Copy Number", context.get("copy_number"))
        _docx_add_field_pair_row(table, "Edition Size", context.get("edition_size"),
                                 "State", context.get("state_display"))
        _docx_add_field_block(doc, "State Description", context.get("state_description"))

    # -- Production
    prod_fields = [context.get("creation_date_display"), context.get("creation_place"),
                   context.get("style_period"), context.get("production_note")]
    if any(prod_fields):
        _docx_add_section(doc, "Production")
        table = _docx_make_field_table(doc)
        _docx_add_field_pair_row(table, "Date", context.get("creation_date_display"),
                                 "Place of Creation", context.get("creation_place"))
        _docx_add_field(doc, "Style / Period", context.get("style_period"))
        _docx_add_field_block(doc, "Production Note", context.get("production_note"))

    # -- Subject
    if context.get("subjects_display"):
        _docx_add_section(doc, "Subject")
        _docx_add_field(doc, "Subjects", context.get("subjects_display"))
        _docx_add_field_block(doc, "Content Description", context.get("content_description"))

    # -- History
    history_fields = [context.get("provenance"), context.get("credit_line"),
                      context.get("object_history_note"), context.get("comments")]
    if any(history_fields):
        _docx_add_section(doc, "History")
        _docx_add_field_block(doc, "Provenance", context.get("provenance"))
        _docx_add_field_block(doc, "Credit Line", context.get("credit_line"))
        _docx_add_field_block(doc, "Object History", context.get("object_history_note"))
        _docx_add_field_block(doc, "Comments", context.get("comments"))

    # -- Location & Inventory
    if context.get("barcode") or context.get("last_inventoried_date"):
        _docx_add_section(doc, "Location & Inventory")
        table = _docx_make_field_table(doc)
        _docx_add_field_pair_row(table, "Barcode", context.get("barcode"),
                                 "Last Inventoried", context.get("last_inventoried_date"))

    # -- Condition
    if context.get("condition_rating"):
        _docx_add_section(doc, "Condition")
        table = _docx_make_field_table(doc)
        _docx_add_field_pair_row(table, "Condition Rating", context.get("condition_rating"),
                                 "Condition Date", context.get("condition_date"))
        _docx_add_field_pair_row(table, "Completeness", context.get("completeness"),
                                 "Conservation Priority", context.get("conservation_priority"))
        _docx_add_field_block(doc, "Condition Note", context.get("condition_note"))
        _docx_add_field_block(doc, "Handling Requirements", context.get("handling_requirements"))

    # -- Valuation
    if context.get("current_value_display") or context.get("insurance_value_display"):
        _docx_add_section(doc, "Valuation")
        table = _docx_make_field_table(doc)
        _docx_add_field_pair_row(table, "Current Value", context.get("current_value_display"),
                                 "Valuation Date", context.get("current_value_date"))
        _docx_add_field(doc, "Insurance Value", context.get("insurance_value_display"))
        _docx_add_field_block(doc, "Insurance Note", context.get("insurance_note"))

    # -- Record info footer
    footer_parts = []
    if context.get("created_at"):
        footer_parts.append(f"Created: {context['created_at']}")
    if context.get("updated_at"):
        footer_parts.append(f"Updated: {context['updated_at']}")
    if footer_parts:
        fp = doc.add_paragraph()
        fp.paragraph_format.space_before = Pt(14)
        fr = fp.add_run("  |  ".join(footer_parts))
        fr.font.size = Pt(8)
        fr.font.color.rgb = RGBColor(*_ARCHIVE_RGB)

    # Generated-at footer
    gp = doc.add_paragraph()
    gr = gp.add_run(f"Generated {context.get('generated_at', '')}")
    gr.font.size = Pt(8)
    gr.font.color.rgb = RGBColor(*_ARCHIVE_RGB)

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def _build_generic_report_docx(context: dict[str, Any]) -> bytes:
    """Build a generic report DOCX from a context dict.

    Used by condition reports, loan agreements, entry/exit reports, etc.
    Renders all string-valued context keys as labeled fields.
    """
    from docx import Document as DocxDocument
    from docx.shared import Pt, RGBColor

    doc = DocxDocument()
    _docx_setup_styles(doc)

    # Header
    hp = doc.add_paragraph()
    hp.paragraph_format.space_after = Pt(2)
    hr = hp.add_run(context.get("org_name") or "")
    hr.font.size = Pt(14)
    hr.font.bold = True
    hr.font.color.rgb = RGBColor(*_FOREST_RGB)

    # Use first non-org, non-generated_at key with a value as the title hint
    doc.add_paragraph("Report", style="Title")
    if context.get("generated_at"):
        doc.add_paragraph(context["generated_at"], style="Subtitle")

    # Skip metadata keys; render the rest as fields
    _skip_keys = {"org_name", "generated_at"}
    for key, value in context.items():
        if key in _skip_keys or not value:
            continue
        label = key.replace("_", " ").title()
        if isinstance(value, str) and len(value) > 120:
            _docx_add_field_block(doc, label, value)
        else:
            _docx_add_field(doc, label, str(value) if not isinstance(value, str) else value)

    # Footer
    gp = doc.add_paragraph()
    gp.paragraph_format.space_before = Pt(14)
    gr = gp.add_run(f"Generated {context.get('generated_at', '')}")
    gr.font.size = Pt(8)
    gr.font.color.rgb = RGBColor(*_ARCHIVE_RGB)

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def render_object_record_sheet_html(
    data: list[dict[str, Any]],
    metadata: dict[str, Any],
    export_format: str = "pdf",
    **kwargs,
) -> bytes:
    """Render an Object Record Sheet using an HTML template + WeasyPrint/htmldocx."""
    record = data[0] if data else {}
    org_name = _get_org_name(metadata)

    # Build title
    title = record.get("object_number", "Unknown")
    if record.get("object_name"):
        title = f"{title} — {record['object_name']}"

    # Identification fields as label/value pairs
    ident_fields = [
        ("Object Number", record.get("object_number")),
        ("Object Name", record.get("object_name")),
        ("Object Type", record.get("object_type")),
        ("Category", record.get("category")),
        ("Catalog Level", record.get("catalog_level")),
        ("Number of Objects", record.get("number_of_objects")),
        ("Status", record.get("object_status")),
        ("Department", record.get("responsible_department")),
    ]

    # Format complex JSONB fields using existing helpers
    creators = _format_creators(record.get("creators"))
    dimensions = _format_measurements(record.get("measurements"))
    materials = _format_jsonb_list(record.get("materials"), key="name")
    techniques = _format_jsonb_list(record.get("techniques"))
    inscriptions = _format_inscriptions(record.get("inscriptions"))

    # Edition state display
    state_display = None
    if record.get("state_number"):
        state_display = f"{record['state_number']}/{record.get('total_states', '')}"

    # Subjects
    subjects = record.get("subjects")
    subjects_display = None
    if subjects and isinstance(subjects, list):
        subjects_display = ", ".join(str(s) for s in subjects)

    # Valuation display
    current_value_display = None
    if record.get("current_value"):
        current_value_display = f"{record['current_value']} {record.get('current_value_currency', '')}".strip()

    insurance_value_display = None
    if record.get("insurance_value"):
        insurance_value_display = f"{record['insurance_value']} {record.get('insurance_value_currency', '')}".strip()

    # Fetch image
    image_result = _fetch_primary_image_b64(record, metadata)
    image_b64 = image_result[0] if image_result else None
    image_mime = image_result[1] if image_result else None

    # Timestamp
    generated_at = datetime.now(timezone.utc).strftime("%B %d, %Y at %H:%M UTC")

    # Load template (org-specific S3 override if present, else default)
    org_id = record.get("organization_id")

    context = {
        "org_name": org_name,
        "title": title,
        "object_number": record.get("object_number"),
        "generated_at": generated_at,
        "ident_fields": ident_fields,
        "image_b64": image_b64,
        "image_mime": image_mime,
        # Creators
        "creators": creators,
        # Description
        "brief_description": record.get("brief_description"),
        "full_description": record.get("full_description"),
        "color": record.get("color"),
        "form": record.get("form"),
        "physical_description": record.get("physical_description"),
        "distinguishing_features": record.get("distinguishing_features"),
        # Dimensions
        "dimensions": dimensions,
        # Materials
        "materials": materials,
        "techniques": techniques,
        # Inscriptions
        "inscriptions": inscriptions,
        # Edition
        "edition": record.get("edition"),
        "copy_number": record.get("copy_number"),
        "edition_size": record.get("edition_size"),
        "state_display": state_display,
        "state_description": record.get("state_description"),
        # Production
        "creation_date_display": record.get("creation_date_display"),
        "creation_place": record.get("creation_place"),
        "style_period": record.get("style_period"),
        "production_note": record.get("production_note"),
        # Subject
        "subjects_display": subjects_display,
        "content_description": record.get("content_description"),
        # History
        "provenance": record.get("provenance"),
        "credit_line": record.get("credit_line"),
        "object_history_note": record.get("object_history_note"),
        "comments": record.get("comments"),
        # Location
        "barcode": record.get("barcode"),
        "last_inventoried_date": _format_display(record.get("last_inventoried_date")),
        # Condition
        "condition_rating": record.get("condition_rating"),
        "condition_date": _format_display(record.get("condition_date")),
        "completeness": record.get("completeness"),
        "conservation_priority": record.get("conservation_priority"),
        "condition_note": record.get("condition_note"),
        "handling_requirements": record.get("handling_requirements"),
        # Valuation
        "current_value_display": current_value_display,
        "current_value_date": _format_display(record.get("current_value_date")),
        "insurance_value_display": insurance_value_display,
        "insurance_note": record.get("insurance_note"),
        # Record info
        "created_at": _format_display(record.get("created_at")),
        "updated_at": _format_display(record.get("updated_at")),
    }

    # Try org-specific template; fall back to default if it errors
    template_name = "object_record_sheet.html"
    try:
        env = _get_template_env(org_id)
        template = env.get_template(template_name)
        html = template.render(**context)
    except Exception:
        logger.warning(
            "Custom template failed for org %s, falling back to default",
            org_id, exc_info=True,
        )
        env = _get_template_env(None)
        template = env.get_template(template_name)
        html = template.render(**context)

    if export_format == "docx":
        return _build_object_record_sheet_docx(context)

    # Default: PDF via WeasyPrint
    import weasyprint
    return weasyprint.HTML(string=html).write_pdf()


def _render_html_template(
    template_name: str,
    context: dict[str, Any],
    org_id: str | None,
    export_format: str = "pdf",
) -> bytes:
    """Shared helper: render an HTML template to PDF or DOCX."""
    try:
        env = _get_template_env(org_id)
        template = env.get_template(template_name)
        html = template.render(**context)
    except Exception:
        logger.warning(
            "Custom template failed for org %s, falling back to default",
            org_id, exc_info=True,
        )
        env = _get_template_env(None)
        template = env.get_template(template_name)
        html = template.render(**context)

    if export_format == "docx":
        return _build_generic_report_docx(context)

    import weasyprint
    return weasyprint.HTML(string=html).write_pdf()


def render_condition_report_html(
    data: list[dict[str, Any]],
    metadata: dict[str, Any],
    export_format: str = "pdf",
    **kwargs,
) -> bytes:
    """Render a Condition Report using an HTML template + WeasyPrint/htmldocx."""
    record = data[0] if data else {}
    org_name = _get_org_name(metadata)
    generated_at = datetime.now(timezone.utc).strftime("%B %d, %Y at %H:%M UTC")

    linked_object = _resolve_linked_object(record, metadata)

    context = {
        "org_name": org_name,
        "generated_at": generated_at,
        "report_number": record.get("report_number", ""),
        "linked_object": linked_object,
        # Report details
        "report_type": _format_enum(record.get("report_type")),
        "report_date": _format_display(record.get("report_date")),
        "status": _format_enum(record.get("status")),
        "examiner_name": record.get("examiner_name"),
        "examiner_institution": record.get("examiner_institution"),
        "examination_method": _format_enum(record.get("examination_method")),
        "examination_place": record.get("examination_place"),
        # Assessment
        "overall_condition": _format_enum(record.get("overall_condition")),
        "conservation_needed": _format_display(record.get("conservation_needed")),
        "conservation_priority": _format_enum(record.get("conservation_priority")),
        "completed_date": _format_display(record.get("completed_date")),
        "condition_summary": record.get("condition_summary"),
        "recommendations": record.get("recommendations"),
        # Handling
        "handling_requirements": record.get("handling_requirements"),
        "packing_requirements": record.get("packing_requirements"),
        "display_restrictions": record.get("display_restrictions"),
        # Notes
        "report_note": record.get("report_note"),
        # Record info
        "assigned_to_name": record.get("assigned_to_name"),
        "created_at": _format_display(record.get("created_at")),
    }

    return _render_html_template(
        "condition_report.html", context, record.get("organization_id"), export_format,
    )


def render_loan_agreement_html(
    data: list[dict[str, Any]],
    metadata: dict[str, Any],
    export_format: str = "pdf",
    **kwargs,
) -> bytes:
    """Render a Loan Agreement using an HTML template + WeasyPrint/htmldocx."""
    record = data[0] if data else {}
    org_name = _get_org_name(metadata)
    generated_at = datetime.now(timezone.utc).strftime("%B %d, %Y at %H:%M UTC")

    is_loan_in = "lender_name" in record
    loan_type = "Incoming Loan" if is_loan_in else "Outgoing Loan"

    # Dates: label differs by direction
    if is_loan_in:
        received_dispatched_date = _format_display(record.get("actual_receipt_date"))
        received_dispatched_label = "Received"
    else:
        received_dispatched_date = _format_display(record.get("actual_dispatch_date"))
        received_dispatched_label = "Dispatched"

    # Loan objects
    loan_objects = _fetch_loan_objects(record, metadata, is_loan_in)

    # Signature parties
    if is_loan_in:
        sig_party_1_role = "Lender"
        sig_party_1_name = record.get("lender_name", "")
        sig_party_2_role = "Borrower (Institution Representative)"
        sig_party_2_name = org_name or ""
    else:
        sig_party_1_role = "Lender (Institution Representative)"
        sig_party_1_name = org_name or ""
        sig_party_2_role = "Borrower"
        sig_party_2_name = record.get("borrower_name", "")

    context = {
        "org_name": org_name,
        "generated_at": generated_at,
        "loan_type": loan_type,
        "is_loan_in": is_loan_in,
        "loan_number": record.get("loan_number", ""),
        # Parties (loan-in fields)
        "lender_name": record.get("lender_name"),
        "exhibition_name": record.get("exhibition_name"),
        "exhibition_venue": record.get("exhibition_venue"),
        # Parties (loan-out fields)
        "borrower_name": record.get("borrower_name"),
        "exhibition_title": record.get("exhibition_title"),
        "venue_name": record.get("venue_name"),
        # Common party fields
        "loan_purpose": _format_enum(record.get("loan_purpose")),
        "status": _format_enum(record.get("status")),
        # Dates
        "request_date": _format_display(record.get("request_date")),
        "approval_date": _format_display(record.get("approval_date")),
        "loan_start_date": _format_display(record.get("loan_start_date")),
        "loan_end_date": _format_display(record.get("loan_end_date")),
        "received_dispatched_date": received_dispatched_date,
        "received_dispatched_label": received_dispatched_label,
        "actual_return_date": _format_display(record.get("actual_return_date")),
        # Insurance & Shipping
        "insurance_value": _format_display(
            record.get("insurance_value") or record.get("insurance_value_total")
        ),
        "insurance_currency": record.get("insurance_currency"),
        "shipping_method": _format_enum(record.get("shipping_method")),
        "courier_required": _format_display(record.get("courier_required")),
        "assigned_to_name": record.get("assigned_to_name"),
        # Conditions
        "loan_conditions": record.get("loan_conditions") or record.get("special_conditions"),
        "special_requirements": record.get("special_requirements"),
        "display_requirements": record.get("display_requirements"),
        "photography_restrictions": record.get("photography_restrictions"),
        # Objects
        "loan_objects": loan_objects,
        # Agreement
        "loan_agreement_reference": record.get("loan_agreement_reference"),
        "loan_agreement_date": _format_display(record.get("loan_agreement_date")),
        "loan_agreement_signed_date": _format_display(record.get("loan_agreement_signed_date")),
        # Notes
        "loan_note": record.get("loan_note"),
        # Signatures
        "sig_party_1_role": sig_party_1_role,
        "sig_party_1_name": sig_party_1_name,
        "sig_party_2_role": sig_party_2_role,
        "sig_party_2_name": sig_party_2_name,
    }

    return _render_html_template(
        "loan_agreement.html", context, record.get("organization_id"), export_format,
    )


def render_object_entry_report_html(
    data: list[dict[str, Any]],
    metadata: dict[str, Any],
    export_format: str = "pdf",
    **kwargs,
) -> bytes:
    """Render an Object Entry Report using an HTML template + WeasyPrint/htmldocx."""
    record = data[0] if data else {}
    org_name = _get_org_name(metadata)
    generated_at = datetime.now(timezone.utc).strftime("%B %d, %Y at %H:%M UTC")

    context = {
        "org_name": org_name,
        "generated_at": generated_at,
        # Entry details
        "entry_number": record.get("entry_number", ""),
        "entry_date": _format_display(record.get("entry_date")),
        "depositor_name": record.get("depositor_name"),
        "current_owner": record.get("current_owner"),
        "entry_reason": _format_enum(record.get("entry_reason")),
        "status": _format_enum(record.get("status")),
        "objects_count": _format_display(record.get("objects_count")),
        "assigned_to_name": record.get("assigned_to_name"),
        "objects_description": record.get("objects_description"),
        # Dates
        "expected_return_date": _format_display(record.get("expected_return_date")),
        "return_date": _format_display(record.get("return_date")),
        "expected_duration": _format_display(record.get("expected_duration")),
        # Insurance
        "insurance_value": _format_display(record.get("insurance_value")),
        "insurance_currency": record.get("insurance_currency"),
        # Outcome
        "outcome": _format_enum(record.get("outcome")),
        # Notes
        "entry_note": record.get("entry_note"),
        # Record info
        "created_at": _format_display(record.get("created_at")),
    }

    return _render_html_template(
        "object_entry_report.html", context, record.get("organization_id"), export_format,
    )


def render_object_exit_report_html(
    data: list[dict[str, Any]],
    metadata: dict[str, Any],
    export_format: str = "pdf",
    **kwargs,
) -> bytes:
    """Render an Object Exit Report using an HTML template + WeasyPrint/htmldocx."""
    record = data[0] if data else {}
    org_name = _get_org_name(metadata)
    generated_at = datetime.now(timezone.utc).strftime("%B %d, %Y at %H:%M UTC")

    context = {
        "org_name": org_name,
        "generated_at": generated_at,
        # Exit details
        "exit_number": record.get("exit_number", ""),
        "exit_date": _format_display(record.get("exit_date")),
        "recipient_name": record.get("recipient_name"),
        "exit_reason": _format_enum(record.get("exit_reason")),
        "exit_method": _format_enum(record.get("exit_method")),
        "status": _format_enum(record.get("status")),
        "assigned_to_name": record.get("assigned_to_name"),
        # Shipping
        "shipping_method": _format_enum(record.get("shipping_method")),
        "shipping_company": record.get("shipping_company"),
        "tracking_number": record.get("tracking_number"),
        "courier_name": record.get("courier_name"),
        # Insurance
        "insurance_value": _format_display(record.get("insurance_value")),
        "insurance_currency": record.get("insurance_currency"),
        # Condition
        "condition_at_exit": record.get("condition_at_exit"),
        # Notes
        "exit_note": record.get("exit_note"),
        # Record info
        "created_at": _format_display(record.get("created_at")),
    }

    return _render_html_template(
        "object_exit_report.html", context, record.get("organization_id"), export_format,
    )


def render_conservation_treatment_report_html(
    data: list[dict[str, Any]],
    metadata: dict[str, Any],
    export_format: str = "pdf",
    **kwargs,
) -> bytes:
    """Render a Conservation Treatment Report using an HTML template + WeasyPrint/htmldocx."""
    record = data[0] if data else {}
    org_name = _get_org_name(metadata)
    generated_at = datetime.now(timezone.utc).strftime("%B %d, %Y at %H:%M UTC")

    linked_object = _resolve_linked_object_by_fk(record, metadata, "object_id")

    # Cost formatting
    estimated_cost = None
    if record.get("estimated_cost"):
        estimated_cost = f"{record['estimated_cost']} {record.get('estimated_cost_currency', '')}".strip()
    actual_cost = None
    if record.get("actual_cost"):
        actual_cost = f"{record['actual_cost']} {record.get('actual_cost_currency', '')}".strip()

    context = {
        "org_name": org_name,
        "generated_at": generated_at,
        "linked_object": linked_object,
        # Treatment details
        "treatment_number": record.get("treatment_number", ""),
        "treatment_type": _format_enum(record.get("treatment_type")),
        "conservator_name": record.get("conservator_name"),
        "conservator_institution": record.get("conservator_institution"),
        "status": _format_enum(record.get("status")),
        "assigned_to_name": record.get("assigned_to_name"),
        # Dates
        "proposal_date": _format_display(record.get("proposal_date")),
        "start_date": _format_display(record.get("start_date")),
        "end_date": _format_display(record.get("end_date")),
        "actual_duration_days": _format_display(record.get("actual_duration_days")),
        # Costs
        "estimated_cost": estimated_cost,
        "actual_cost": actual_cost,
        # Description
        "treatment_description": record.get("treatment_description"),
        "treatment_rationale": record.get("treatment_rationale"),
        # Materials & Methods
        "materials_used": _format_jsonb_list(record.get("materials_used"), key="name"),
        "techniques_used": _format_jsonb_list(record.get("techniques_used"), key="name"),
        "methods_used": record.get("methods_used"),
        # Recommendations
        "recommendations": record.get("recommendations"),
        "future_care_instructions": record.get("future_care_instructions"),
        # Notes
        "treatment_note": record.get("treatment_note"),
        # Record info
        "created_at": _format_display(record.get("created_at")),
    }

    return _render_html_template(
        "conservation_treatment_report.html", context, record.get("organization_id"), export_format,
    )


def render_acquisition_report_html(
    data: list[dict[str, Any]],
    metadata: dict[str, Any],
    export_format: str = "pdf",
    **kwargs,
) -> bytes:
    """Render an Acquisition Report using an HTML template + WeasyPrint/htmldocx."""
    record = data[0] if data else {}
    org_name = _get_org_name(metadata)
    generated_at = datetime.now(timezone.utc).strftime("%B %d, %Y at %H:%M UTC")

    # Cost formatting
    cost = None
    if record.get("cost"):
        cost = f"{record['cost']} {record.get('cost_currency', '')}".strip()

    context = {
        "org_name": org_name,
        "generated_at": generated_at,
        # Acquisition details
        "acquisition_number": record.get("acquisition_number", ""),
        "acquisition_method": _format_enum(record.get("acquisition_method")),
        "acquisition_date": _format_display(record.get("acquisition_date")),
        "source_name": record.get("source_name"),
        "source_type": _format_enum(record.get("source_type")),
        "status": _format_enum(record.get("status")),
        "objects_count": _format_display(record.get("objects_count")),
        "assigned_to_name": record.get("assigned_to_name"),
        # Accession
        "accession_number": record.get("accession_number"),
        "accession_date": _format_display(record.get("accession_date")),
        # Financial
        "cost": cost,
        "funding_source": record.get("funding_source"),
        # Legal
        "legal_status": _format_enum(record.get("legal_status")),
        "credit_line": record.get("credit_line"),
        "provisos": record.get("provisos"),
        "donor_restrictions": record.get("donor_restrictions"),
        # Notes
        "acquisition_note": record.get("acquisition_note"),
        # Record info
        "created_at": _format_display(record.get("created_at")),
    }

    return _render_html_template(
        "acquisition_report.html", context, record.get("organization_id"), export_format,
    )
