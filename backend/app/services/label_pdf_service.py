"""
PDF label sheet generation service.

Generates printable label sheets (4-up or 6-up per page) with QR codes,
object numbers, and titles using reportlab.
"""

import io
import logging
from dataclasses import dataclass
from uuid import UUID

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

from app.services.qr_service import get_qr_service

logger = logging.getLogger(__name__)


@dataclass
class LabelItem:
    """Data for a single label."""
    object_id: UUID
    object_number: str
    title: str
    org_slug: str


class LabelPDFService:
    """Generates PDF label sheets with QR codes."""

    def generate_label_sheet(
        self,
        items: list[LabelItem],
        layout: str = "4up",
    ) -> bytes:
        """Generate a PDF label sheet.

        Args:
            items: List of objects to generate labels for.
            layout: '4up' (2x2) or '6up' (2x3) per page.

        Returns:
            PDF file as bytes.
        """
        buf = io.BytesIO()
        c = canvas.Canvas(buf, pagesize=letter)
        page_w, page_h = letter

        if layout == "6up":
            cols, rows = 2, 3
        else:
            cols, rows = 2, 2

        margin = 0.5 * inch
        gutter = 0.25 * inch
        cell_w = (page_w - 2 * margin - (cols - 1) * gutter) / cols
        cell_h = (page_h - 2 * margin - (rows - 1) * gutter) / rows

        qr_service = get_qr_service()
        per_page = cols * rows

        for page_idx in range(0, len(items), per_page):
            if page_idx > 0:
                c.showPage()

            page_items = items[page_idx:page_idx + per_page]

            for i, item in enumerate(page_items):
                col = i % cols
                row = i // cols

                x = margin + col * (cell_w + gutter)
                y = page_h - margin - (row + 1) * cell_h - row * gutter

                # Draw cell border (light dashed line for cutting guides)
                c.saveState()
                c.setDash(3, 3)
                c.setStrokeGray(0.7)
                c.rect(x, y, cell_w, cell_h)
                c.restoreState()

                # Generate QR code as PNG for embedding
                qr_data, _ = qr_service.generate_object_qr(
                    org_slug=item.org_slug,
                    object_id=item.object_id,
                    fmt="png",
                    scale=8,
                )
                qr_img = ImageReader(io.BytesIO(qr_data))
                qr_size = min(cell_w * 0.5, cell_h * 0.5)
                qr_x = x + (cell_w - qr_size) / 2
                qr_y = y + cell_h - qr_size - 10
                c.drawImage(qr_img, qr_x, qr_y, width=qr_size, height=qr_size)

                # Object number (bold)
                text_y = qr_y - 16
                c.setFont("Helvetica-Bold", 10)
                c.drawCentredString(x + cell_w / 2, text_y, item.object_number or "")

                # Title (truncated)
                text_y -= 14
                c.setFont("Helvetica", 8)
                title = item.title or ""
                if len(title) > 50:
                    title = title[:47] + "..."
                c.drawCentredString(x + cell_w / 2, text_y, title)

        c.save()
        buf.seek(0)
        return buf.getvalue()


# Singleton
_label_pdf_service: LabelPDFService | None = None


def get_label_pdf_service() -> LabelPDFService:
    global _label_pdf_service
    if _label_pdf_service is None:
        _label_pdf_service = LabelPDFService()
    return _label_pdf_service
