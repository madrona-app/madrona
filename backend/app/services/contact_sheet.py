"""
Contact sheet (proof sheet) generation service.

Generates PDF proof sheets from media collections
using ReportLab (already a dependency).
"""

import io
import logging
import tempfile
from typing import Any
from uuid import UUID

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, letter
from reportlab.lib.units import inch, mm
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image as RLImage
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

from app.database import current_session

logger = logging.getLogger(__name__)


def generate_contact_sheet(
    collection_id: UUID,
    organization_id: UUID,
    layout: str = "grid",  # grid, list, detail
    page_size: str = "letter",
    columns: int = 4,
    include_title: bool = True,
    include_filename: bool = True,
    include_description: bool = False,
    db=None,
) -> bytes:
    """
    Generate a PDF contact sheet from a media collection.

    Args:
        collection_id: Collection UUID
        organization_id: Organization UUID
        layout: Layout style (grid, list, detail)
        page_size: Page size (letter, a4)
        columns: Number of columns for grid layout
        include_title: Include media title
        include_filename: Include filename
        include_description: Include description

    Returns:
        PDF file bytes
    """
    from app.models import MediaCollection, MediaCollectionItem, Media, MediaDerivative
    from app.services.storage import get_storage_backend

    collection = db.query(MediaCollection).filter_by(
        collection_id=collection_id,
        organization_id=organization_id,
    ).first()

    if not collection:
        raise ValueError(f"Collection not found: {collection_id}")

    # Get collection items with their media
    items = (
        db.query(MediaCollectionItem)
        .filter_by(collection_id=collection_id)
        .order_by(MediaCollectionItem.sort_order)
        .all()
    )

    media_ids = [item.media_id for item in items]
    media_items = db.query(Media).filter(
        Media.media_id.in_(media_ids),
    ).all()
    media_map = {m.media_id: m for m in media_items}

    # Setup PDF
    size = letter if page_size == "letter" else A4
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=size,
        leftMargin=0.5 * inch,
        rightMargin=0.5 * inch,
        topMargin=0.5 * inch,
        bottomMargin=0.5 * inch,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "ContactSheetTitle",
        parent=styles["Heading1"],
        fontSize=16,
        spaceAfter=12,
    )
    caption_style = ParagraphStyle(
        "Caption",
        parent=styles["Normal"],
        fontSize=8,
        leading=10,
        alignment=1,  # Center
    )

    elements = []

    # Title
    elements.append(Paragraph(collection.name, title_style))
    if collection.description:
        elements.append(Paragraph(collection.description, styles["Normal"]))
    elements.append(Spacer(1, 12))

    # Build grid of thumbnails
    storage = get_storage_backend(str(organization_id), db)
    thumb_size = (size[0] - 1 * inch) / columns - 10

    row = []
    for item in items:
        media = media_map.get(item.media_id)
        if not media:
            continue

        cell_parts = []

        # Try to get thumbnail
        if media.thumbnail_s3_key:
            try:
                thumb_data, _ = storage.get_object_sync(media.thumbnail_s3_key)
                thumb_io = io.BytesIO(thumb_data)
                img = RLImage(thumb_io, width=thumb_size, height=thumb_size, kind="proportional")
                cell_parts.append(img)
            except Exception:
                cell_parts.append(Paragraph("[No thumbnail]", caption_style))
        else:
            cell_parts.append(Paragraph("[No thumbnail]", caption_style))

        # Caption
        caption_parts = []
        if include_title and media.title:
            caption_parts.append(media.title)
        if include_filename:
            caption_parts.append(media.filename)

        if caption_parts:
            caption = "<br/>".join(caption_parts[:2])
            cell_parts.append(Paragraph(caption, caption_style))

        row.append(cell_parts)

        if len(row) >= columns:
            # Build a table row
            table_data = [row]
            table = Table(table_data, colWidths=[thumb_size + 10] * columns)
            table.setStyle(TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ]))
            elements.append(table)
            elements.append(Spacer(1, 6))
            row = []

    # Handle remaining items
    if row:
        while len(row) < columns:
            row.append([])
        table_data = [row]
        table = Table(table_data, colWidths=[thumb_size + 10] * columns)
        table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ]))
        elements.append(table)

    doc.build(elements)
    return buffer.getvalue()
