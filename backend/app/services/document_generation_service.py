"""
Document Generation Service for Collections Management.

Generates branded PDF documents for museum collections workflows:
- Loan agreements (incoming and outgoing)
- Object receipts
- Packing lists
- Condition reports (printable)
- Facility reports

All documents incorporate organization branding (logo, colors, letterhead).
"""
import io
import logging
from abc import ABC, abstractmethod
from datetime import datetime, date
from typing import Any, BinaryIO
from uuid import UUID

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, LETTER
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm, mm, inch
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    SimpleDocTemplate,
    Table,
    TableStyle,
    Paragraph,
    Spacer,
    PageBreak,
    Image,
    HRFlowable,
    KeepTogether,
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT

logger = logging.getLogger(__name__)


def hex_to_rgb(hex_color: str) -> tuple[float, float, float]:
    """Convert hex color (#RRGGBB) to RGB tuple (0-1 range)."""
    hex_color = hex_color.lstrip('#')
    if len(hex_color) == 3:
        hex_color = ''.join([c*2 for c in hex_color])
    return tuple(int(hex_color[i:i+2], 16) / 255 for i in (0, 2, 4))


def get_color_from_hex(hex_color: str) -> colors.Color:
    """Convert hex color to ReportLab Color object."""
    r, g, b = hex_to_rgb(hex_color)
    return colors.Color(r, g, b)


class BrandedDocumentGenerator(ABC):
    """
    Base class for generating branded PDF documents.

    Subclasses implement specific document types while this base class
    handles common branding elements (letterhead, footer, colors).
    """

    def __init__(
        self,
        organization: dict[str, Any],
        branding: dict[str, Any] | None = None,
        template_config: dict[str, Any] | None = None,
        page_size: tuple = LETTER,
    ):
        """
        Initialize the document generator.

        Args:
            organization: Organization data (name, etc.)
            branding: Branding settings (logo, colors, letterhead, etc.)
            template_config: Template-specific configuration
            page_size: Page size tuple (default: US Letter)
        """
        self.organization = organization
        self.branding = branding or {}
        self.template_config = template_config or {}
        self.page_size = page_size

        # Extract branding colors with defaults
        self.primary_color = get_color_from_hex(
            self.branding.get('primary_color') or '#1a365d'
        )
        self.secondary_color = get_color_from_hex(
            self.branding.get('secondary_color') or '#2d3748'
        )
        self.accent_color = get_color_from_hex(
            self.branding.get('accent_color') or '#3182ce'
        )

        # Setup styles
        self.styles = self._create_styles()

    def _create_styles(self) -> dict[str, ParagraphStyle]:
        """Create document styles incorporating brand colors."""
        base_styles = getSampleStyleSheet()

        return {
            'title': ParagraphStyle(
                'Title',
                parent=base_styles['Title'],
                fontSize=18,
                textColor=self.primary_color,
                spaceAfter=20,
            ),
            'heading1': ParagraphStyle(
                'Heading1',
                parent=base_styles['Heading1'],
                fontSize=14,
                textColor=self.primary_color,
                spaceBefore=15,
                spaceAfter=10,
            ),
            'heading2': ParagraphStyle(
                'Heading2',
                parent=base_styles['Heading2'],
                fontSize=12,
                textColor=self.secondary_color,
                spaceBefore=12,
                spaceAfter=8,
            ),
            'normal': ParagraphStyle(
                'Normal',
                parent=base_styles['Normal'],
                fontSize=10,
                spaceAfter=6,
            ),
            'small': ParagraphStyle(
                'Small',
                parent=base_styles['Normal'],
                fontSize=8,
                textColor=colors.gray,
            ),
            'label': ParagraphStyle(
                'Label',
                parent=base_styles['Normal'],
                fontSize=9,
                textColor=self.secondary_color,
                fontName='Helvetica-Bold',
            ),
            'value': ParagraphStyle(
                'Value',
                parent=base_styles['Normal'],
                fontSize=10,
            ),
            'footer': ParagraphStyle(
                'Footer',
                parent=base_styles['Normal'],
                fontSize=8,
                textColor=colors.gray,
                alignment=TA_CENTER,
            ),
            'letterhead_name': ParagraphStyle(
                'LetterheadName',
                parent=base_styles['Normal'],
                fontSize=12,
                fontName='Helvetica-Bold',
                textColor=self.primary_color,
            ),
            'letterhead_address': ParagraphStyle(
                'LetterheadAddress',
                parent=base_styles['Normal'],
                fontSize=9,
                textColor=self.secondary_color,
            ),
        }

    def _get_logo_image(self, max_width: float = 2*inch, max_height: float = 1*inch) -> Image | None:
        """
        Get logo as ReportLab Image, scaled to fit within bounds.

        Args:
            max_width: Maximum width in points
            max_height: Maximum height in points

        Returns:
            ReportLab Image object or None if no logo
        """
        logo_data = self.branding.get('logo_data')
        if not logo_data:
            return None

        try:
            # logo_data should be a BytesIO or file-like object
            img = Image(logo_data)

            # Scale to fit
            aspect = img.imageWidth / img.imageHeight
            if img.imageWidth > max_width:
                img.drawWidth = max_width
                img.drawHeight = max_width / aspect
            if img.drawHeight > max_height:
                img.drawHeight = max_height
                img.drawWidth = max_height * aspect

            return img
        except Exception as e:
            logger.warning(f"Failed to load logo: {e}")
            return None

    def _build_letterhead(self) -> list:
        """Build letterhead section with logo and address."""
        elements = []

        # Create a table with logo on left, address on right
        logo = self._get_logo_image()

        # Letterhead text
        letterhead_parts = []
        if self.branding.get('letterhead_name'):
            letterhead_parts.append(
                Paragraph(self.branding['letterhead_name'], self.styles['letterhead_name'])
            )

        address_lines = []
        if self.branding.get('letterhead_address_line1'):
            address_lines.append(self.branding['letterhead_address_line1'])
        if self.branding.get('letterhead_address_line2'):
            address_lines.append(self.branding['letterhead_address_line2'])
        if self.branding.get('letterhead_city_state_zip'):
            address_lines.append(self.branding['letterhead_city_state_zip'])
        if self.branding.get('letterhead_country'):
            address_lines.append(self.branding['letterhead_country'])

        if address_lines:
            letterhead_parts.append(
                Paragraph('<br/>'.join(address_lines), self.styles['letterhead_address'])
            )

        contact_parts = []
        if self.branding.get('letterhead_phone'):
            contact_parts.append(f"Tel: {self.branding['letterhead_phone']}")
        if self.branding.get('letterhead_email'):
            contact_parts.append(f"Email: {self.branding['letterhead_email']}")
        if self.branding.get('letterhead_website'):
            contact_parts.append(self.branding['letterhead_website'])

        if contact_parts:
            letterhead_parts.append(
                Paragraph(' | '.join(contact_parts), self.styles['small'])
            )

        # Build layout
        if logo and letterhead_parts:
            # Logo on left, address on right
            data = [[logo, letterhead_parts]]
            table = Table(data, colWidths=[2.5*inch, 4*inch])
            table.setStyle(TableStyle([
                ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                ('ALIGN', (0, 0), (0, 0), 'LEFT'),
                ('ALIGN', (1, 0), (1, 0), 'RIGHT'),
            ]))
            elements.append(table)
        elif logo:
            elements.append(logo)
        elif letterhead_parts:
            for part in letterhead_parts:
                elements.append(part)

        if elements:
            elements.append(Spacer(1, 20))
            elements.append(HRFlowable(
                width="100%",
                thickness=1,
                color=self.primary_color,
                spaceBefore=5,
                spaceAfter=15,
            ))

        return elements

    def _build_footer(self, doc) -> None:
        """Build footer for each page."""
        footer_text = self.branding.get('footer_text', '')

        def add_footer(canvas, doc):
            canvas.saveState()

            # Page number
            page_num = f"Page {doc.page}"
            canvas.setFont('Helvetica', 8)
            canvas.setFillColor(colors.gray)
            canvas.drawRightString(doc.pagesize[0] - 0.75*inch, 0.5*inch, page_num)

            # Footer text
            if footer_text:
                canvas.drawString(0.75*inch, 0.5*inch, footer_text)

            # Date generated
            canvas.drawCentredString(
                doc.pagesize[0] / 2,
                0.5*inch,
                f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}"
            )

            canvas.restoreState()

        return add_footer

    def _build_signature_block(
        self,
        title: str = "Authorized Signature",
        include_date: bool = True,
        include_org_signature: bool = False,
    ) -> list:
        """Build a signature block."""
        elements = []
        elements.append(Spacer(1, 30))

        sig_data = [
            ["", "", ""],  # Spacer row
        ]

        # Signature line
        sig_data.append([
            "_" * 40,
            "",
            "_" * 25 if include_date else "",
        ])
        sig_data.append([
            title,
            "",
            "Date" if include_date else "",
        ])

        # If including organization's stored signature
        if include_org_signature and self.branding.get('signature_name'):
            sig_data.append(["", "", ""])
            sig_data.append([
                f"For: {self.branding.get('letterhead_name', self.organization.get('name', ''))}",
                "",
                "",
            ])
            if self.branding.get('signature_title'):
                sig_data.append([
                    self.branding['signature_title'],
                    "",
                    "",
                ])

        table = Table(sig_data, colWidths=[3*inch, 1*inch, 2*inch])
        table.setStyle(TableStyle([
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('TEXTCOLOR', (0, 2), (0, 2), colors.gray),
            ('TEXTCOLOR', (2, 2), (2, 2), colors.gray),
        ]))
        elements.append(table)

        return elements

    def _format_date(self, date_val: str | date | datetime | None) -> str:
        """Format a date value for display."""
        if not date_val:
            return ""
        if isinstance(date_val, str):
            try:
                date_val = datetime.fromisoformat(date_val.replace('Z', '+00:00'))
            except ValueError:
                return date_val
        if isinstance(date_val, datetime):
            return date_val.strftime('%B %d, %Y')
        if isinstance(date_val, date):
            return date_val.strftime('%B %d, %Y')
        return str(date_val)

    def _format_currency(self, amount: float | int | None, currency: str = 'USD') -> str:
        """Format currency amount for display."""
        if amount is None:
            return ""

        symbols = {
            'USD': '$',
            'EUR': '\u20ac',
            'GBP': '\u00a3',
            'CAD': 'CA$',
        }
        symbol = symbols.get(currency, currency + ' ')
        return f"{symbol}{amount:,.2f}"

    def _build_field_row(self, label: str, value: Any, label_width: float = 2*inch) -> Table:
        """Build a label-value row."""
        data = [[
            Paragraph(label, self.styles['label']),
            Paragraph(str(value) if value else "", self.styles['value']),
        ]]
        table = Table(data, colWidths=[label_width, None])
        table.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ]))
        return table

    @abstractmethod
    def _build_content(self) -> list:
        """Build the main document content. Implemented by subclasses."""
        pass

    def generate(self) -> bytes:
        """Generate the PDF document and return as bytes."""
        buffer = io.BytesIO()

        doc = SimpleDocTemplate(
            buffer,
            pagesize=self.page_size,
            rightMargin=0.75*inch,
            leftMargin=0.75*inch,
            topMargin=0.75*inch,
            bottomMargin=0.75*inch,
        )

        # Build story (content)
        story = []

        # Add letterhead
        story.extend(self._build_letterhead())

        # Add main content
        story.extend(self._build_content())

        # Build document with footer
        doc.build(story, onFirstPage=self._build_footer(doc), onLaterPages=self._build_footer(doc))

        buffer.seek(0)
        return buffer.getvalue()


class LoanAgreementGenerator(BrandedDocumentGenerator):
    """Generate loan agreement documents (both incoming and outgoing)."""

    def __init__(
        self,
        organization: dict[str, Any],
        branding: dict[str, Any] | None,
        loan: dict[str, Any],
        objects: list[dict[str, Any]],
        contact: dict[str, Any] | None = None,
        template_config: dict[str, Any] | None = None,
        terms_and_conditions: str | None = None,
        is_incoming: bool = False,
    ):
        super().__init__(organization, branding, template_config)
        self.loan = loan
        self.objects = objects
        self.contact = contact or {}
        self.terms_and_conditions = terms_and_conditions
        self.is_incoming = is_incoming

    def _build_content(self) -> list:
        elements = []

        # Title
        loan_type = "Incoming" if self.is_incoming else "Outgoing"
        title = f"Loan Agreement - {loan_type}"
        elements.append(Paragraph(title, self.styles['title']))

        # Loan reference
        loan_number = self.loan.get('loan_number', 'N/A')
        elements.append(Paragraph(f"<b>Loan Reference:</b> {loan_number}", self.styles['normal']))
        elements.append(Spacer(1, 15))

        # Parties section
        elements.append(Paragraph("PARTIES", self.styles['heading1']))

        if self.is_incoming:
            lender_name = self.contact.get('name') or self.loan.get('lender_name', '')
            elements.append(self._build_field_row("Lender:", lender_name))
            elements.append(self._build_field_row("Borrower:", self.branding.get('letterhead_name', self.organization.get('name', ''))))
        else:
            elements.append(self._build_field_row("Lender:", self.branding.get('letterhead_name', self.organization.get('name', ''))))
            borrower_name = self.contact.get('name') or self.loan.get('borrower_name', '')
            elements.append(self._build_field_row("Borrower:", borrower_name))

        # Contact details
        if self.contact:
            contact_address = []
            if self.contact.get('address_line1'):
                contact_address.append(self.contact['address_line1'])
            if self.contact.get('city'):
                city_line = self.contact['city']
                if self.contact.get('state'):
                    city_line += f", {self.contact['state']}"
                if self.contact.get('postal_code'):
                    city_line += f" {self.contact['postal_code']}"
                contact_address.append(city_line)
            if self.contact.get('country'):
                contact_address.append(self.contact['country'])

            if contact_address:
                elements.append(self._build_field_row("Address:", '<br/>'.join(contact_address)))

        elements.append(Spacer(1, 15))

        # Loan details section
        elements.append(Paragraph("LOAN DETAILS", self.styles['heading1']))

        elements.append(self._build_field_row("Purpose:", self.loan.get('purpose', '')))
        elements.append(self._build_field_row("Venue/Location:", self.loan.get('venue_name', self.loan.get('display_location', ''))))
        elements.append(self._build_field_row("Loan Period:", f"{self._format_date(self.loan.get('start_date'))} to {self._format_date(self.loan.get('end_date'))}"))

        if self.loan.get('exhibition_title'):
            elements.append(self._build_field_row("Exhibition:", self.loan.get('exhibition_title')))

        elements.append(Spacer(1, 15))

        # Objects section
        elements.append(Paragraph("OBJECTS ON LOAN", self.styles['heading1']))

        # Objects table
        config = self.template_config or {}
        include_images = config.get('include_images', False)
        include_dimensions = config.get('include_dimensions', True)
        include_condition = config.get('include_condition', True)

        headers = ["#", "Object", "Accession No."]
        col_widths = [0.3*inch, 2.5*inch, 1*inch]

        if include_dimensions:
            headers.append("Dimensions")
            col_widths.append(1.2*inch)
        if include_condition:
            headers.append("Condition")
            col_widths.append(1*inch)

        headers.append("Insurance Value")
        col_widths.append(1*inch)

        table_data = [headers]

        for i, obj in enumerate(self.objects, 1):
            row = [
                str(i),
                Paragraph(f"<b>{obj.get('object_name', 'Untitled')}</b><br/>{obj.get('artist_name', '')}", self.styles['small']),
                obj.get('object_number', ''),
            ]

            if include_dimensions:
                dims = []
                if obj.get('height_cm'):
                    dims.append(f"H: {obj['height_cm']}cm")
                if obj.get('width_cm'):
                    dims.append(f"W: {obj['width_cm']}cm")
                if obj.get('depth_cm'):
                    dims.append(f"D: {obj['depth_cm']}cm")
                row.append('\n'.join(dims) if dims else '')

            if include_condition:
                row.append(obj.get('condition_summary', ''))

            row.append(self._format_currency(
                obj.get('insurance_value'),
                obj.get('insurance_currency', 'USD')
            ))

            table_data.append(row)

        table = Table(table_data, colWidths=col_widths)
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), self.primary_color),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 9),
            ('FONTSIZE', (0, 1), (-1, -1), 8),
            ('ALIGN', (0, 0), (0, -1), 'CENTER'),
            ('ALIGN', (-1, 0), (-1, -1), 'RIGHT'),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.gray),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.Color(0.95, 0.95, 0.95)]),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ]))
        elements.append(table)

        # Insurance section
        elements.append(Spacer(1, 15))
        elements.append(Paragraph("INSURANCE", self.styles['heading1']))

        total_value = sum(obj.get('insurance_value', 0) or 0 for obj in self.objects)
        elements.append(self._build_field_row("Total Insurance Value:", self._format_currency(total_value)))
        elements.append(self._build_field_row("Insurance Provider:", self.loan.get('insurance_provider', '')))
        elements.append(self._build_field_row("Policy Number:", self.loan.get('insurance_policy_number', '')))

        # Terms and conditions
        if self.terms_and_conditions:
            elements.append(PageBreak())
            elements.append(Paragraph("TERMS AND CONDITIONS", self.styles['heading1']))
            elements.append(Paragraph(self.terms_and_conditions, self.styles['small']))

        # Signatures
        elements.append(PageBreak())
        elements.append(Paragraph("SIGNATURES", self.styles['heading1']))
        elements.append(Paragraph(
            "By signing below, both parties agree to the terms and conditions of this loan agreement.",
            self.styles['normal']
        ))

        # Lender signature
        elements.append(Spacer(1, 20))
        if self.is_incoming:
            elements.append(Paragraph("LENDER", self.styles['heading2']))
            elements.extend(self._build_signature_block("Authorized Representative"))
        else:
            elements.append(Paragraph("LENDER (This Institution)", self.styles['heading2']))
            elements.extend(self._build_signature_block("Authorized Representative", include_org_signature=True))

        # Borrower signature
        elements.append(Spacer(1, 20))
        if self.is_incoming:
            elements.append(Paragraph("BORROWER (This Institution)", self.styles['heading2']))
            elements.extend(self._build_signature_block("Authorized Representative", include_org_signature=True))
        else:
            elements.append(Paragraph("BORROWER", self.styles['heading2']))
            elements.extend(self._build_signature_block("Authorized Representative"))

        return elements


class ObjectReceiptGenerator(BrandedDocumentGenerator):
    """Generate object receipt documents for deposits."""

    def __init__(
        self,
        organization: dict[str, Any],
        branding: dict[str, Any] | None,
        entry: dict[str, Any],
        objects: list[dict[str, Any]],
        depositor: dict[str, Any] | None = None,
        template_config: dict[str, Any] | None = None,
    ):
        super().__init__(organization, branding, template_config)
        self.entry = entry
        self.objects = objects
        self.depositor = depositor or {}

    def _build_content(self) -> list:
        elements = []

        # Title
        elements.append(Paragraph("Object Receipt", self.styles['title']))

        # Receipt info
        entry_number = self.entry.get('entry_number', 'N/A')
        elements.append(Paragraph(f"<b>Receipt Number:</b> {entry_number}", self.styles['normal']))
        elements.append(Paragraph(f"<b>Date Received:</b> {self._format_date(self.entry.get('entry_date'))}", self.styles['normal']))
        elements.append(Spacer(1, 15))

        # Depositor info
        elements.append(Paragraph("DEPOSITOR INFORMATION", self.styles['heading1']))

        depositor_name = self.depositor.get('name') or self.entry.get('depositor_name', '')
        elements.append(self._build_field_row("Name:", depositor_name))

        if self.depositor.get('organization'):
            elements.append(self._build_field_row("Organization:", self.depositor['organization']))

        if self.depositor.get('email'):
            elements.append(self._build_field_row("Email:", self.depositor['email']))
        if self.depositor.get('phone'):
            elements.append(self._build_field_row("Phone:", self.depositor['phone']))

        elements.append(Spacer(1, 15))

        # Entry details
        elements.append(Paragraph("DEPOSIT DETAILS", self.styles['heading1']))

        elements.append(self._build_field_row("Reason for Deposit:", self.entry.get('entry_reason', '')))
        elements.append(self._build_field_row("Entry Method:", self.entry.get('entry_method', '')))

        if self.entry.get('expected_return_date'):
            elements.append(self._build_field_row("Expected Return:", self._format_date(self.entry.get('expected_return_date'))))

        if self.entry.get('conditions'):
            elements.append(self._build_field_row("Conditions:", self.entry.get('conditions')))

        elements.append(Spacer(1, 15))

        # Objects list
        elements.append(Paragraph("OBJECTS RECEIVED", self.styles['heading1']))

        table_data = [["#", "Description", "Condition on Receipt", "Notes"]]

        for i, obj in enumerate(self.objects, 1):
            table_data.append([
                str(i),
                Paragraph(obj.get('brief_description', obj.get('object_name', '')), self.styles['small']),
                obj.get('condition_on_entry', ''),
                obj.get('notes', ''),
            ])

        table = Table(table_data, colWidths=[0.3*inch, 3*inch, 1.5*inch, 1.5*inch])
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), self.primary_color),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('ALIGN', (0, 0), (0, -1), 'CENTER'),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.gray),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ]))
        elements.append(table)

        # Acknowledgment
        elements.append(Spacer(1, 20))
        elements.append(Paragraph("ACKNOWLEDGMENT", self.styles['heading1']))
        elements.append(Paragraph(
            f"The {self.branding.get('letterhead_name', self.organization.get('name', 'institution'))} "
            "acknowledges receipt of the above-listed object(s) in the condition noted. "
            "The depositor certifies that they have the authority to deposit these objects "
            "and that the information provided is accurate.",
            self.styles['normal']
        ))

        # Signatures
        elements.append(Spacer(1, 30))
        sig_table_data = [
            ["Received by:", "", "Depositor:"],
            ["", "", ""],
            ["_" * 35, "", "_" * 35],
            ["Institution Representative", "", "Signature"],
            ["", "", ""],
            ["Date: _____________", "", "Date: _____________"],
        ]

        sig_table = Table(sig_table_data, colWidths=[2.5*inch, 1*inch, 2.5*inch])
        sig_table.setStyle(TableStyle([
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('TEXTCOLOR', (0, 3), (0, 3), colors.gray),
            ('TEXTCOLOR', (2, 3), (2, 3), colors.gray),
        ]))
        elements.append(sig_table)

        return elements


class PackingListGenerator(BrandedDocumentGenerator):
    """Generate packing list documents for shipments."""

    def __init__(
        self,
        organization: dict[str, Any],
        branding: dict[str, Any] | None,
        shipment: dict[str, Any],
        objects: list[dict[str, Any]],
        template_config: dict[str, Any] | None = None,
    ):
        super().__init__(organization, branding, template_config)
        self.shipment = shipment
        self.objects = objects

    def _build_content(self) -> list:
        elements = []

        # Title
        elements.append(Paragraph("Packing List", self.styles['title']))

        # Shipment info
        ref_number = self.shipment.get('reference_number', self.shipment.get('movement_reference_number', 'N/A'))
        elements.append(Paragraph(f"<b>Reference:</b> {ref_number}", self.styles['normal']))
        elements.append(Paragraph(f"<b>Date:</b> {self._format_date(self.shipment.get('dispatch_date', datetime.now()))}", self.styles['normal']))
        elements.append(Spacer(1, 15))

        # From/To section
        elements.append(Paragraph("SHIPMENT DETAILS", self.styles['heading1']))

        from_to_data = [
            ["FROM:", "TO:"],
            [
                Paragraph(self.shipment.get('origin_location', self.branding.get('letterhead_name', '')), self.styles['normal']),
                Paragraph(self.shipment.get('destination_location', ''), self.styles['normal']),
            ],
        ]

        from_to_table = Table(from_to_data, colWidths=[3*inch, 3*inch])
        from_to_table.setStyle(TableStyle([
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('BACKGROUND', (0, 0), (-1, 0), colors.Color(0.9, 0.9, 0.9)),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ]))
        elements.append(from_to_table)

        if self.shipment.get('carrier'):
            elements.append(self._build_field_row("Carrier:", self.shipment.get('carrier')))
        if self.shipment.get('tracking_number'):
            elements.append(self._build_field_row("Tracking #:", self.shipment.get('tracking_number')))

        elements.append(Spacer(1, 15))

        # Objects list
        elements.append(Paragraph("CONTENTS", self.styles['heading1']))

        include_dimensions = self.template_config.get('include_dimensions', True)
        include_weight = self.template_config.get('include_weight', True)

        headers = ["Crate/Box", "Object", "Accession No."]
        col_widths = [0.8*inch, 2.5*inch, 1*inch]

        if include_dimensions:
            headers.append("Dimensions (cm)")
            col_widths.append(1.2*inch)
        if include_weight:
            headers.append("Weight")
            col_widths.append(0.8*inch)

        table_data = [headers]

        for obj in self.objects:
            row = [
                obj.get('crate_number', obj.get('container_number', '')),
                Paragraph(f"<b>{obj.get('object_name', '')}</b>", self.styles['small']),
                obj.get('object_number', ''),
            ]

            if include_dimensions:
                dims = f"{obj.get('height_cm', '-')} x {obj.get('width_cm', '-')} x {obj.get('depth_cm', '-')}"
                row.append(dims)

            if include_weight:
                weight = obj.get('weight_kg')
                row.append(f"{weight} kg" if weight else '')

            table_data.append(row)

        table = Table(table_data, colWidths=col_widths)
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), self.primary_color),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('ALIGN', (0, 0), (0, -1), 'CENTER'),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.gray),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.Color(0.95, 0.95, 0.95)]),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ]))
        elements.append(table)

        # Summary
        elements.append(Spacer(1, 15))
        elements.append(Paragraph(f"<b>Total Items:</b> {len(self.objects)}", self.styles['normal']))

        # Checklist
        elements.append(Spacer(1, 20))
        elements.append(Paragraph("PACKING CHECKLIST", self.styles['heading1']))

        checklist_items = [
            "All items wrapped in acid-free tissue",
            "Fragile items cushioned with foam/padding",
            "Climate control indicators included",
            "Handling instructions attached to crates",
            "Insurance documentation included",
            "Condition reports included",
        ]

        for item in checklist_items:
            elements.append(Paragraph(f"\u2610 {item}", self.styles['normal']))

        # Signatures
        elements.append(Spacer(1, 30))
        elements.append(Paragraph("VERIFICATION", self.styles['heading1']))

        sig_table_data = [
            ["Packed by:", "Verified by:", "Received by:"],
            ["", "", ""],
            ["_" * 25, "_" * 25, "_" * 25],
            ["Date: _______", "Date: _______", "Date: _______"],
        ]

        sig_table = Table(sig_table_data, colWidths=[2*inch, 2*inch, 2*inch])
        sig_table.setStyle(TableStyle([
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ]))
        elements.append(sig_table)

        return elements


class ConditionReportGenerator(BrandedDocumentGenerator):
    """Generate printable condition report documents."""

    def __init__(
        self,
        organization: dict[str, Any],
        branding: dict[str, Any] | None,
        condition_report: dict[str, Any],
        object_data: dict[str, Any],
        template_config: dict[str, Any] | None = None,
    ):
        super().__init__(organization, branding, template_config)
        self.condition_report = condition_report
        self.object_data = object_data

    def _build_content(self) -> list:
        elements = []

        # Title
        elements.append(Paragraph("Condition Report", self.styles['title']))

        # Report info
        report_number = self.condition_report.get('report_number', 'N/A')
        elements.append(Paragraph(f"<b>Report Number:</b> {report_number}", self.styles['normal']))
        elements.append(Paragraph(f"<b>Date:</b> {self._format_date(self.condition_report.get('examination_date'))}", self.styles['normal']))
        elements.append(Spacer(1, 15))

        # Object information
        elements.append(Paragraph("OBJECT INFORMATION", self.styles['heading1']))

        elements.append(self._build_field_row("Accession Number:", self.object_data.get('object_number', '')))
        elements.append(self._build_field_row("Object Name:", self.object_data.get('object_name', '')))
        elements.append(self._build_field_row("Artist/Maker:", self.object_data.get('artist_name', '')))
        elements.append(self._build_field_row("Date:", self.object_data.get('creation_date_display', '')))
        elements.append(self._build_field_row("Medium:", self.object_data.get('medium', '')))

        # Dimensions
        dims = []
        if self.object_data.get('height_cm'):
            dims.append(f"H: {self.object_data['height_cm']} cm")
        if self.object_data.get('width_cm'):
            dims.append(f"W: {self.object_data['width_cm']} cm")
        if self.object_data.get('depth_cm'):
            dims.append(f"D: {self.object_data['depth_cm']} cm")
        if dims:
            elements.append(self._build_field_row("Dimensions:", ' x '.join(dims)))

        elements.append(Spacer(1, 15))

        # Examination details
        elements.append(Paragraph("EXAMINATION DETAILS", self.styles['heading1']))

        elements.append(self._build_field_row("Examiner:", self.condition_report.get('examiner_name', '')))
        elements.append(self._build_field_row("Purpose:", self.condition_report.get('purpose', '')))
        elements.append(self._build_field_row("Location:", self.condition_report.get('examination_location', '')))
        elements.append(self._build_field_row("Lighting:", self.condition_report.get('lighting_conditions', '')))

        elements.append(Spacer(1, 15))

        # Condition summary
        elements.append(Paragraph("CONDITION SUMMARY", self.styles['heading1']))

        overall = self.condition_report.get('overall_condition', '')
        condition_colors = {
            'excellent': colors.Color(0.2, 0.6, 0.2),
            'good': colors.Color(0.3, 0.5, 0.3),
            'fair': colors.Color(0.6, 0.5, 0.1),
            'poor': colors.Color(0.7, 0.3, 0.1),
            'critical': colors.Color(0.7, 0.1, 0.1),
        }

        overall_style = ParagraphStyle(
            'Condition',
            parent=self.styles['normal'],
            fontSize=12,
            fontName='Helvetica-Bold',
            textColor=condition_colors.get(overall.lower(), colors.black),
        )
        elements.append(Paragraph(f"Overall Condition: {overall.upper()}", overall_style))
        elements.append(Spacer(1, 10))

        # Condition criteria
        criteria = self.condition_report.get('criteria', {})
        if criteria:
            criteria_data = [["Aspect", "Rating", "Notes"]]
            for aspect, data in criteria.items():
                if isinstance(data, dict):
                    criteria_data.append([
                        aspect.replace('_', ' ').title(),
                        data.get('rating', ''),
                        data.get('notes', ''),
                    ])

            if len(criteria_data) > 1:
                criteria_table = Table(criteria_data, colWidths=[2*inch, 1*inch, 3*inch])
                criteria_table.setStyle(TableStyle([
                    ('BACKGROUND', (0, 0), (-1, 0), colors.Color(0.9, 0.9, 0.9)),
                    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                    ('FONTSIZE', (0, 0), (-1, -1), 9),
                    ('GRID', (0, 0), (-1, -1), 0.5, colors.gray),
                    ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                    ('TOPPADDING', (0, 0), (-1, -1), 4),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
                ]))
                elements.append(criteria_table)

        elements.append(Spacer(1, 15))

        # Detailed findings
        elements.append(Paragraph("DETAILED FINDINGS", self.styles['heading1']))

        findings = self.condition_report.get('detailed_findings', self.condition_report.get('condition_description', ''))
        if findings:
            elements.append(Paragraph(findings, self.styles['normal']))

        # Hazards
        hazards = self.condition_report.get('hazards', [])
        if hazards:
            elements.append(Spacer(1, 10))
            elements.append(Paragraph("<b>Hazards Identified:</b>", self.styles['normal']))
            for hazard in hazards:
                elements.append(Paragraph(f"\u2022 {hazard}", self.styles['normal']))

        elements.append(Spacer(1, 15))

        # Recommendations
        elements.append(Paragraph("RECOMMENDATIONS", self.styles['heading1']))

        elements.append(self._build_field_row("Conservation Priority:", self.condition_report.get('conservation_priority', '')))

        recommendations = self.condition_report.get('recommendations', '')
        if recommendations:
            elements.append(Paragraph(recommendations, self.styles['normal']))

        handling = self.condition_report.get('handling_recommendations', '')
        if handling:
            elements.append(Spacer(1, 10))
            elements.append(Paragraph("<b>Handling:</b>", self.styles['normal']))
            elements.append(Paragraph(handling, self.styles['normal']))

        storage = self.condition_report.get('storage_recommendations', '')
        if storage:
            elements.append(Spacer(1, 10))
            elements.append(Paragraph("<b>Storage:</b>", self.styles['normal']))
            elements.append(Paragraph(storage, self.styles['normal']))

        # Examiner signature
        elements.append(Spacer(1, 30))
        elements.extend(self._build_signature_block("Examiner Signature"))

        return elements


class FacilityReportGenerator(BrandedDocumentGenerator):
    """Generate facility report documents for loan requests."""

    def __init__(
        self,
        organization: dict[str, Any],
        branding: dict[str, Any] | None,
        venue: dict[str, Any],
        environmental_data: dict[str, Any] | None = None,
        template_config: dict[str, Any] | None = None,
    ):
        super().__init__(organization, branding, template_config)
        self.venue = venue
        self.environmental_data = environmental_data or {}

    def _build_content(self) -> list:
        elements = []

        # Title
        elements.append(Paragraph("Facility Report", self.styles['title']))

        # Date
        elements.append(Paragraph(f"<b>Date:</b> {self._format_date(datetime.now())}", self.styles['normal']))
        elements.append(Spacer(1, 15))

        # Institution information
        elements.append(Paragraph("INSTITUTION INFORMATION", self.styles['heading1']))

        elements.append(self._build_field_row("Institution:", self.branding.get('letterhead_name', self.organization.get('name', ''))))

        address_parts = []
        if self.branding.get('letterhead_address_line1'):
            address_parts.append(self.branding['letterhead_address_line1'])
        if self.branding.get('letterhead_city_state_zip'):
            address_parts.append(self.branding['letterhead_city_state_zip'])
        if address_parts:
            elements.append(self._build_field_row("Address:", ', '.join(address_parts)))

        if self.branding.get('letterhead_phone'):
            elements.append(self._build_field_row("Phone:", self.branding['letterhead_phone']))
        if self.branding.get('letterhead_email'):
            elements.append(self._build_field_row("Email:", self.branding['letterhead_email']))

        elements.append(Spacer(1, 15))

        # Venue information
        elements.append(Paragraph("VENUE INFORMATION", self.styles['heading1']))

        elements.append(self._build_field_row("Venue Name:", self.venue.get('name', '')))
        elements.append(self._build_field_row("Gallery/Room:", self.venue.get('gallery_name', '')))

        if self.venue.get('dimensions'):
            elements.append(self._build_field_row("Dimensions:", self.venue.get('dimensions')))

        elements.append(Spacer(1, 15))

        # Environmental conditions
        elements.append(Paragraph("ENVIRONMENTAL CONDITIONS", self.styles['heading1']))

        env = self.environmental_data

        # Temperature
        temp_range = ""
        if env.get('temperature_min') or env.get('temperature_max'):
            temp_range = f"{env.get('temperature_min', '--')} - {env.get('temperature_max', '--')} \u00b0F"
        elements.append(self._build_field_row("Temperature Range:", temp_range))

        # Humidity
        humidity_range = ""
        if env.get('humidity_min') or env.get('humidity_max'):
            humidity_range = f"{env.get('humidity_min', '--')} - {env.get('humidity_max', '--')}% RH"
        elements.append(self._build_field_row("Relative Humidity:", humidity_range))

        elements.append(self._build_field_row("Climate Control:", "Yes" if env.get('climate_controlled') else "No"))
        elements.append(self._build_field_row("Light Levels:", f"{env.get('light_level', '--')} lux" if env.get('light_level') else ''))
        elements.append(self._build_field_row("UV Filtering:", "Yes" if env.get('uv_filtered') else "No"))

        elements.append(Spacer(1, 15))

        # Security
        elements.append(Paragraph("SECURITY", self.styles['heading1']))

        security = self.venue.get('security', {})
        elements.append(self._build_field_row("24-Hour Security:", "Yes" if security.get('24_hour') else "No"))
        elements.append(self._build_field_row("Alarm System:", "Yes" if security.get('alarm_system') else "No"))
        elements.append(self._build_field_row("CCTV:", "Yes" if security.get('cctv') else "No"))
        elements.append(self._build_field_row("Guards:", security.get('guard_details', '')))

        elements.append(Spacer(1, 15))

        # Fire protection
        elements.append(Paragraph("FIRE PROTECTION", self.styles['heading1']))

        fire = self.venue.get('fire_protection', {})
        elements.append(self._build_field_row("Smoke Detectors:", "Yes" if fire.get('smoke_detectors') else "No"))
        elements.append(self._build_field_row("Sprinkler System:", fire.get('sprinkler_type', 'No')))
        elements.append(self._build_field_row("Fire Extinguishers:", "Yes" if fire.get('extinguishers') else "No"))
        elements.append(self._build_field_row("Emergency Exits:", fire.get('emergency_exits', '')))

        elements.append(Spacer(1, 15))

        # Handling
        elements.append(Paragraph("HANDLING & ACCESS", self.styles['heading1']))

        handling = self.venue.get('handling', {})
        elements.append(self._build_field_row("Loading Dock:", "Yes" if handling.get('loading_dock') else "No"))
        elements.append(self._build_field_row("Freight Elevator:", "Yes" if handling.get('freight_elevator') else "No"))
        elements.append(self._build_field_row("Crate Storage:", handling.get('crate_storage', '')))
        elements.append(self._build_field_row("Trained Staff:", handling.get('trained_staff_details', '')))

        # Certification
        elements.append(Spacer(1, 30))
        elements.append(Paragraph(
            "I certify that the information provided in this facility report is accurate and complete.",
            self.styles['normal']
        ))

        elements.extend(self._build_signature_block("Authorized Representative", include_org_signature=True))

        return elements


# Factory function for easy document generation
def generate_document(
    document_type: str,
    organization: dict[str, Any],
    branding: dict[str, Any] | None,
    data: dict[str, Any],
    template_config: dict[str, Any] | None = None,
    terms_and_conditions: str | None = None,
) -> bytes:
    """
    Factory function to generate documents by type.

    Args:
        document_type: Type of document to generate
        organization: Organization data
        branding: Branding settings (can include logo_data as BytesIO)
        data: Document-specific data
        template_config: Template configuration
        terms_and_conditions: Terms text (for loan agreements)

    Returns:
        PDF document as bytes
    """
    generators = {
        'loan_agreement_out': lambda: LoanAgreementGenerator(
            organization=organization,
            branding=branding,
            loan=data.get('loan', {}),
            objects=data.get('objects', []),
            contact=data.get('contact'),
            template_config=template_config,
            terms_and_conditions=terms_and_conditions,
            is_incoming=False,
        ),
        'loan_agreement_in': lambda: LoanAgreementGenerator(
            organization=organization,
            branding=branding,
            loan=data.get('loan', {}),
            objects=data.get('objects', []),
            contact=data.get('contact'),
            template_config=template_config,
            terms_and_conditions=terms_and_conditions,
            is_incoming=True,
        ),
        'object_receipt': lambda: ObjectReceiptGenerator(
            organization=organization,
            branding=branding,
            entry=data.get('entry', {}),
            objects=data.get('objects', []),
            depositor=data.get('depositor'),
            template_config=template_config,
        ),
        'packing_list': lambda: PackingListGenerator(
            organization=organization,
            branding=branding,
            shipment=data.get('shipment', {}),
            objects=data.get('objects', []),
            template_config=template_config,
        ),
        'condition_report': lambda: ConditionReportGenerator(
            organization=organization,
            branding=branding,
            condition_report=data.get('condition_report', {}),
            object_data=data.get('object', {}),
            template_config=template_config,
        ),
        'facility_report': lambda: FacilityReportGenerator(
            organization=organization,
            branding=branding,
            venue=data.get('venue', {}),
            environmental_data=data.get('environmental_data'),
            template_config=template_config,
        ),
    }

    generator_factory = generators.get(document_type)
    if not generator_factory:
        raise ValueError(f"Unknown document type: {document_type}. Valid types: {list(generators.keys())}")

    generator = generator_factory()
    return generator.generate()
