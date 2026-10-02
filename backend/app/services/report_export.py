"""Report Export Service.

Handles exporting report results to various formats:
- CSV: Plain text, comma-separated
- Excel: Formatted workbook with styling
- PDF: Professional document with optional charts
"""
import csv
import io
from datetime import datetime, timezone
from typing import Any
from uuid import UUID
from xml.sax.saxutils import escape

# Excel support
try:
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.utils import get_column_letter
    EXCEL_AVAILABLE = True
except ImportError:
    EXCEL_AVAILABLE = False

# PDF support
try:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter, landscape
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.platypus import (
        BaseDocTemplate,
        Frame,
        PageTemplate,
        Table,
        TableStyle,
        Paragraph,
        Spacer,
    )
    PDF_AVAILABLE = True
except ImportError:
    PDF_AVAILABLE = False

# Madrona brand colors (shared with document renderer)
_FOREST = "#1F3A2E"
_PARCHMENT = "#F6F2EC"
_INK = "#1C1C1C"
_LICHEN = "#E6E4E1"
_STONE = "#D8D2C8"
_ARCHIVE = "#6B7A7E"


# ============================================================================
# VALUE FORMATTING
# ============================================================================

def format_value(value: Any) -> str:
    """Format a value for export."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, (dict, list)):
        return str(value)
    return str(value)


_CSV_FORMULA_CHARS = frozenset(('=', '+', '-', '@', '\t', '\r'))


def _sanitize_csv_value(value: str) -> str:
    """Prevent CSV formula injection by prefixing formula trigger characters."""
    if value:
        stripped = value.lstrip()
        if stripped and stripped[0] in _CSV_FORMULA_CHARS:
            return "'" + value
    return value


def get_column_width(values: list[Any], header: str, max_width: int = 50) -> int:
    """Calculate optimal column width based on content."""
    max_len = len(header)
    for value in values[:100]:  # Sample first 100 rows
        val_len = len(format_value(value))
        if val_len > max_len:
            max_len = val_len
    return min(max_len + 2, max_width)


# ============================================================================
# CSV EXPORT
# ============================================================================

# Maximum rows for in-memory exports (Excel, PDF). CSV uses streaming.
MAX_EXPORT_ROWS = 10_000


def export_to_csv(
    data: list[dict[str, Any]],
    columns: list[dict[str, str]] | None = None,
) -> bytes:
    """
    Export data to CSV format.

    Args:
        data: List of row dictionaries
        columns: Optional column definitions with 'field' and 'label' keys

    Returns:
        CSV content as bytes
    """
    if not data:
        return b""

    output = io.StringIO()

    # Determine columns
    if columns:
        fieldnames = [col["field"] for col in columns]
        headers = {col["field"]: col.get("label", col["field"]) for col in columns}
    else:
        fieldnames = list(data[0].keys())
        headers = {f: f.replace("_", " ").title() for f in fieldnames}

    writer = csv.DictWriter(output, fieldnames=fieldnames, extrasaction="ignore")

    # Write header row with labels
    writer.writerow(headers)

    # Write data rows in chunks to limit peak memory from string concatenation
    chunk_size = 1000
    chunks = []
    for i, row in enumerate(data):
        formatted_row = {k: _sanitize_csv_value(format_value(v)) for k, v in row.items()}
        writer.writerow(formatted_row)
        if (i + 1) % chunk_size == 0:
            chunks.append(output.getvalue())
            output.truncate(0)
            output.seek(0)

    # Flush remaining rows
    remaining = output.getvalue()
    if remaining:
        chunks.append(remaining)

    return "".join(chunks).encode("utf-8")


# ============================================================================
# EXCEL EXPORT
# ============================================================================

def export_to_excel(
    data: list[dict[str, Any]],
    columns: list[dict[str, str]] | None = None,
    report_name: str = "Report",
    include_metadata: bool = True,
) -> bytes:
    """
    Export data to Excel format with formatting.

    Args:
        data: List of row dictionaries
        columns: Optional column definitions with 'field' and 'label' keys
        report_name: Name for the report (used in sheet name and header)
        include_metadata: Whether to include report metadata header

    Returns:
        Excel workbook as bytes
    """
    if not EXCEL_AVAILABLE:
        raise ImportError("openpyxl is required for Excel export. Install with: pip install openpyxl")

    # Cap rows to prevent OOM on very large exports
    if len(data) > MAX_EXPORT_ROWS:
        data = data[:MAX_EXPORT_ROWS]

    wb = Workbook()
    ws = wb.active
    ws.title = report_name[:31]  # Excel sheet names limited to 31 chars

    # Styles
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="1F3A2E", end_color="1F3A2E", fill_type="solid")  # Forest green
    header_alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    cell_border = Border(
        left=Side(style="thin", color="D8D2C8"),
        right=Side(style="thin", color="D8D2C8"),
        top=Side(style="thin", color="D8D2C8"),
        bottom=Side(style="thin", color="D8D2C8"),
    )
    alt_row_fill = PatternFill(start_color="F6F2EC", end_color="F6F2EC", fill_type="solid")  # Parchment

    current_row = 1

    # Metadata header
    if include_metadata:
        ws.cell(row=current_row, column=1, value=report_name)
        ws.cell(row=current_row, column=1).font = Font(bold=True, size=14)
        current_row += 1

        ws.cell(row=current_row, column=1, value=f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}")
        ws.cell(row=current_row, column=1).font = Font(italic=True, color="6B7A7E")
        current_row += 1

        ws.cell(row=current_row, column=1, value=f"Total rows: {len(data)}")
        ws.cell(row=current_row, column=1).font = Font(italic=True, color="6B7A7E")
        current_row += 2  # Extra blank row

    if not data:
        ws.cell(row=current_row, column=1, value="No data available")
        output = io.BytesIO()
        wb.save(output)
        return output.getvalue()

    # Determine columns
    if columns:
        fieldnames = [col["field"] for col in columns]
        headers = [col.get("label", col["field"]) for col in columns]
    else:
        fieldnames = list(data[0].keys())
        headers = [f.replace("_", " ").title() for f in fieldnames]

    # Write header row
    for col_idx, header in enumerate(headers, 1):
        cell = ws.cell(row=current_row, column=col_idx, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = header_alignment
        cell.border = cell_border

    header_row = current_row
    current_row += 1

    # Write data rows
    for row_idx, row_data in enumerate(data):
        for col_idx, field in enumerate(fieldnames, 1):
            value = row_data.get(field)
            cell = ws.cell(row=current_row, column=col_idx, value=format_value(value) if value is not None else "")
            cell.border = cell_border
            cell.alignment = Alignment(vertical="center")

            # Alternate row coloring
            if row_idx % 2 == 1:
                cell.fill = alt_row_fill

        current_row += 1

    # Auto-size columns
    for col_idx, field in enumerate(fieldnames, 1):
        col_values = [row.get(field) for row in data]
        width = get_column_width(col_values, headers[col_idx - 1])
        ws.column_dimensions[get_column_letter(col_idx)].width = width

    # Freeze header row
    ws.freeze_panes = ws.cell(row=header_row + 1, column=1)

    # Auto-filter
    if data:
        ws.auto_filter.ref = f"A{header_row}:{get_column_letter(len(fieldnames))}{header_row + len(data)}"

    output = io.BytesIO()
    wb.save(output)
    return output.getvalue()


# ============================================================================
# PDF EXPORT
# ============================================================================

def _make_tabular_header_footer(page_size, report_name: str = "Report"):
    """Create a branded header/footer callback for tabular PDF exports."""
    def _header_footer(canvas, doc):
        canvas.saveState()
        w, h = page_size

        # Header bar
        canvas.setFillColor(colors.HexColor(_FOREST))
        canvas.rect(0, h - 40, w, 40, fill=1, stroke=0)

        canvas.setFillColor(colors.white)
        canvas.setFont("Helvetica-Bold", 11)
        canvas.drawString(0.5 * inch, h - 27, report_name)
        canvas.setFont("Helvetica", 8)
        canvas.drawRightString(w - 0.5 * inch, h - 27, "Madrona")

        # Footer bar
        canvas.setFillColor(colors.HexColor(_LICHEN))
        canvas.rect(0, 0, w, 25, fill=1, stroke=0)

        canvas.setFillColor(colors.HexColor(_ARCHIVE))
        canvas.setFont("Helvetica", 7)
        timestamp = datetime.now(timezone.utc).strftime("%B %d, %Y at %H:%M UTC")
        canvas.drawString(0.5 * inch, 8, f"Generated {timestamp}")
        canvas.drawRightString(w - 0.5 * inch, 8, f"Page {doc.page}")

        canvas.restoreState()

    return _header_footer


def export_to_pdf(
    data: list[dict[str, Any]],
    columns: list[dict[str, str]] | None = None,
    report_name: str = "Report",
    report_description: str | None = None,
    orientation: str = "portrait",
) -> bytes:
    """
    Export data to PDF format with Madrona-branded header and footer.

    Args:
        data: List of row dictionaries
        columns: Optional column definitions with 'field' and 'label' keys
        report_name: Name for the report
        report_description: Optional description
        orientation: 'portrait' or 'landscape'

    Returns:
        PDF document as bytes
    """
    if not PDF_AVAILABLE:
        raise ImportError("reportlab is required for PDF export. Install with: pip install reportlab")

    output = io.BytesIO()

    # Page setup
    page_size = landscape(letter) if orientation == "landscape" else letter
    doc = BaseDocTemplate(
        output,
        pagesize=page_size,
        rightMargin=0.5 * inch,
        leftMargin=0.5 * inch,
        topMargin=55,   # Below header bar
        bottomMargin=35,  # Above footer bar
    )

    frame = Frame(
        doc.leftMargin,
        doc.bottomMargin,
        doc.width,
        doc.height,
        id="normal",
    )
    on_page = _make_tabular_header_footer(page_size, report_name)
    doc.addPageTemplates([
        PageTemplate(id="tabular", frames=frame, onPage=on_page),
    ])

    # Styles
    styles = getSampleStyleSheet()
    subtitle_style = ParagraphStyle(
        "ReportSubtitle",
        parent=styles["Normal"],
        fontSize=10,
        textColor=colors.HexColor(_ARCHIVE),
        spaceAfter=6,
    )
    description_style = ParagraphStyle(
        "Description",
        parent=styles["Normal"],
        fontSize=10,
        textColor=colors.HexColor(_INK),
        spaceAfter=12,
    )

    elements = []

    # Metadata line
    elements.append(Paragraph(
        f"Total rows: {len(data)} | Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}",
        subtitle_style,
    ))

    # Description
    if report_description:
        elements.append(Paragraph(escape(report_description), description_style))

    elements.append(Spacer(1, 8))

    if not data:
        elements.append(Paragraph("No data available", styles["Normal"]))
        doc.build(elements)
        return output.getvalue()

    # Determine columns
    if columns:
        fieldnames = [col["field"] for col in columns]
        headers = [col.get("label", col["field"]) for col in columns]
    else:
        fieldnames = list(data[0].keys())
        headers = [f.replace("_", " ").title() for f in fieldnames]

    # Limit columns for PDF (too many won't fit)
    max_columns = 8 if orientation == "landscape" else 6
    columns_truncated = len(fieldnames) > max_columns
    if columns_truncated:
        total_columns = len(fieldnames)
        fieldnames = fieldnames[:max_columns]
        headers = headers[:max_columns]

    # Limit rows for PDF
    max_rows = 500
    rows_truncated = len(data) > max_rows

    # Build table data
    table_data = [headers]
    for row in data[:max_rows]:
        row_values = []
        for field in fieldnames:
            value = format_value(row.get(field))
            # Truncate long values
            if len(value) > 50:
                value = value[:47] + "..."
            row_values.append(value)
        table_data.append(row_values)

    # Calculate column widths
    available_width = page_size[0] - 1 * inch
    col_width = available_width / len(fieldnames)

    # Create table
    table = Table(table_data, colWidths=[col_width] * len(fieldnames), repeatRows=1)

    # Table styling
    table_style = TableStyle([
        # Header styling
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(_FOREST)),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 9),
        ("ALIGN", (0, 0), (-1, 0), "CENTER"),
        ("VALIGN", (0, 0), (-1, 0), "MIDDLE"),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 8),
        ("TOPPADDING", (0, 0), (-1, 0), 8),

        # Data styling
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 1), (-1, -1), 8),
        ("ALIGN", (0, 1), (-1, -1), "LEFT"),
        ("VALIGN", (0, 1), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 4),
        ("TOPPADDING", (0, 1), (-1, -1), 4),

        # Grid
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor(_STONE)),

        # Alternating row colors
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor(_PARCHMENT)]),
    ])

    table.setStyle(table_style)
    elements.append(table)

    # Truncation notes
    notes = []
    if rows_truncated:
        notes.append(f"Showing first {max_rows} of {len(data)} rows.")
    if columns_truncated:
        notes.append(f"Showing {max_columns} of {total_columns} columns.")
    if notes:
        notes.append("Export to Excel or CSV for complete data.")
        elements.append(Spacer(1, 12))
        elements.append(Paragraph(" ".join(notes), subtitle_style))

    doc.build(elements)
    return output.getvalue()


# ============================================================================
# MAIN EXPORT FUNCTION
# ============================================================================

def export_report(
    data: list[dict[str, Any]],
    format: str,
    columns: list[dict[str, str]] | None = None,
    report_name: str = "Report",
    report_description: str | None = None,
) -> tuple[bytes, str, str]:
    """
    Export report data to the specified format.

    Args:
        data: List of row dictionaries
        format: Export format ('csv', 'excel', 'pdf')
        columns: Optional column definitions
        report_name: Name for the report
        report_description: Optional description

    Returns:
        Tuple of (content_bytes, content_type, file_extension)
    """
    format = format.lower()

    if format == "csv":
        content = export_to_csv(data, columns)
        return content, "text/csv", "csv"

    elif format == "excel":
        content = export_to_excel(data, columns, report_name)
        return content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"

    elif format == "pdf":
        # Auto-detect orientation based on column count
        col_count = len(columns) if columns else (len(data[0]) if data else 0)
        orientation = "landscape" if col_count > 5 else "portrait"
        content = export_to_pdf(data, columns, report_name, report_description, orientation)
        return content, "application/pdf", "pdf"

    else:
        raise ValueError(f"Unsupported export format: {format}")


def get_available_formats() -> list[dict[str, Any]]:
    """Get list of available export formats with their status."""
    return [
        {
            "format": "csv",
            "label": "CSV",
            "description": "Comma-separated values, compatible with any spreadsheet",
            "available": True,
        },
        {
            "format": "excel",
            "label": "Excel",
            "description": "Formatted Excel workbook with styling",
            "available": EXCEL_AVAILABLE,
        },
        {
            "format": "pdf",
            "label": "PDF",
            "description": "Professional PDF document",
            "available": PDF_AVAILABLE,
        },
    ]
