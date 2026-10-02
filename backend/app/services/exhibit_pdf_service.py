"""
Exhibit PDF Export Service

Generates professional PDF documents for museum exhibition planning:
- Elevation drawings with artwork positions
- Installation specifications
- Object checklists with condition report fields
"""
import io
import math
from datetime import datetime
from typing import Any
from uuid import UUID

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm, mm
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    SimpleDocTemplate,
    Table,
    TableStyle,
    Paragraph,
    Spacer,
    PageBreak,
    Image,
)


class ElevationPDFGenerator:
    """Generate wall elevation drawings with artwork positions and dimensions."""

    def __init__(
        self,
        exhibition: dict[str, Any],
        floor_plan: dict[str, Any],
        placements: list[dict[str, Any]],
        wall_id: str | None = None,
        scale: float = 50,  # 1:50 default scale
        include_dimensions: bool = True,
    ):
        self.exhibition = exhibition
        self.floor_plan = floor_plan
        self.placements = placements
        self.wall_id = wall_id
        self.scale = scale
        self.include_dimensions = include_dimensions
        self.geometry = floor_plan.get("geometry", {})

    def generate(self) -> bytes:
        """Generate the elevation PDF and return as bytes."""
        buffer = io.BytesIO()
        c = canvas.Canvas(buffer, pagesize=landscape(A4))
        page_width, page_height = landscape(A4)

        # Get walls to render
        walls = self._get_walls()

        for wall in walls:
            self._draw_wall_elevation(c, wall, page_width, page_height)
            c.showPage()

        c.save()
        buffer.seek(0)
        return buffer.getvalue()

    def _get_walls(self) -> list[dict]:
        """Get walls to include in the PDF."""
        if self.geometry.get("type") == "polygon":
            walls = self.geometry.get("walls", [])
        else:
            # Rectangular geometry - create wall representations
            width = self.geometry.get("width_cm", 800)
            depth = self.geometry.get("depth_cm", 600)
            walls = [
                {"id": "north", "length_cm": width},
                {"id": "south", "length_cm": width},
                {"id": "east", "length_cm": depth},
                {"id": "west", "length_cm": depth},
            ]

        if self.wall_id:
            walls = [w for w in walls if w.get("id") == self.wall_id]

        return walls

    def _calculate_wall_length(self, wall: dict) -> float:
        """Calculate wall length in cm."""
        if "length_cm" in wall:
            return wall["length_cm"]

        # Calculate from vertices
        vertices = self.geometry.get("vertices", [])
        start = next(
            (v for v in vertices if v["id"] == wall.get("start_vertex")), None
        )
        end = next((v for v in vertices if v["id"] == wall.get("end_vertex")), None)

        if start and end:
            dx = end["x"] - start["x"]
            dy = end["y"] - start["y"]
            return math.sqrt(dx * dx + dy * dy)

        return 0

    def _draw_wall_elevation(
        self, c: canvas.Canvas, wall: dict, page_width: float, page_height: float
    ):
        """Draw a single wall elevation on the current page."""
        wall_id = wall.get("id", "unknown")
        wall_length_cm = self._calculate_wall_length(wall)
        wall_height_cm = wall.get("height_cm", 300)

        # Scale factor for drawing
        # Convert cm to points (1 cm = 28.35 points)
        cm_to_points = 28.35 / self.scale

        # Calculate drawing dimensions
        drawing_width = wall_length_cm * cm_to_points
        drawing_height = wall_height_cm * cm_to_points

        # Center on page with margins
        margin = 2 * cm
        max_width = page_width - 2 * margin
        max_height = page_height - 4 * margin  # Extra margin for header/footer

        # Adjust scale if drawing is too large
        if drawing_width > max_width or drawing_height > max_height:
            width_scale = max_width / drawing_width
            height_scale = max_height / drawing_height
            adjust_scale = min(width_scale, height_scale)
            cm_to_points *= adjust_scale
            drawing_width *= adjust_scale
            drawing_height *= adjust_scale

        # Origin point (bottom-left of wall)
        origin_x = (page_width - drawing_width) / 2
        origin_y = margin + 2 * cm

        # Draw header
        c.setFont("Helvetica-Bold", 14)
        c.drawString(
            margin,
            page_height - margin,
            f"{self.exhibition.get('title', 'Exhibition')} - Wall Elevation",
        )
        c.setFont("Helvetica", 10)
        c.drawString(margin, page_height - margin - 15, f"Wall: {wall_id}")
        c.drawString(
            margin,
            page_height - margin - 30,
            f"Scale: 1:{self.scale}  |  Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        )

        # Draw wall outline
        c.setStrokeColor(colors.black)
        c.setLineWidth(1)
        c.rect(origin_x, origin_y, drawing_width, drawing_height)

        # Draw floor line
        c.setStrokeColor(colors.gray)
        c.setLineWidth(0.5)
        c.line(origin_x - 20, origin_y, origin_x + drawing_width + 20, origin_y)
        c.setFont("Helvetica", 8)
        c.drawString(origin_x - 40, origin_y - 3, "Floor")

        # Draw openings
        for opening in wall.get("openings", []):
            self._draw_opening(c, opening, origin_x, origin_y, cm_to_points)

        # Draw placements on this wall
        wall_placements = [p for p in self.placements if p.get("wall_id") == wall_id]
        for placement in wall_placements:
            self._draw_placement(c, placement, origin_x, origin_y, cm_to_points)

        # Draw dimensions
        if self.include_dimensions:
            self._draw_wall_dimensions(
                c, wall_length_cm, wall_height_cm, origin_x, origin_y, drawing_width, drawing_height
            )

        # Draw scale bar
        self._draw_scale_bar(c, origin_x, origin_y - 30, cm_to_points)

    def _draw_opening(
        self, c: canvas.Canvas, opening: dict, origin_x: float, origin_y: float, scale: float
    ):
        """Draw a door or window opening."""
        offset = opening.get("offset_cm", 0) * scale
        width = opening.get("width_cm", 100) * scale
        height = opening.get("height_cm", 220) * scale
        sill = opening.get("sill_height_cm", 0) * scale

        x = origin_x + offset
        y = origin_y + sill

        c.setStrokeColor(colors.gray)
        c.setFillColor(colors.white)
        c.setLineWidth(0.5)
        c.rect(x, y, width, height, fill=1)

        # Label
        c.setFont("Helvetica", 7)
        c.setFillColor(colors.gray)
        label = "Door" if opening.get("type") == "door" else "Window"
        c.drawCentredString(x + width / 2, y + height / 2, label)

    def _draw_placement(
        self, c: canvas.Canvas, placement: dict, origin_x: float, origin_y: float, scale: float
    ):
        """Draw an artwork placement with dimensions."""
        pos_x = placement.get("position_x", 0) * scale
        pos_y = placement.get("position_y", 150) * scale
        art_width = placement.get("width_cm", 50) * scale
        art_height = placement.get("height_cm", 40) * scale
        frame_width = placement.get("frame_width_cm", 0) * scale

        total_width = art_width + frame_width * 2
        total_height = art_height + frame_width * 2

        # Center position
        x = origin_x + pos_x - total_width / 2
        y = origin_y + pos_y - total_height / 2

        # Frame
        if frame_width > 0:
            c.setStrokeColor(colors.black)
            c.setFillColor(colors.Color(0.2, 0.2, 0.2))
            c.setLineWidth(0.5)
            c.rect(x, y, total_width, total_height, fill=1)

        # Artwork
        c.setFillColor(colors.Color(0.9, 0.9, 0.85))
        c.rect(x + frame_width, y + frame_width, art_width, art_height, fill=1)

        # Label
        c.setFont("Helvetica", 6)
        c.setFillColor(colors.black)
        title = placement.get("display_title", "")
        if title:
            if len(title) > 20:
                title = title[:17] + "..."
            c.drawCentredString(x + total_width / 2, y - 8, title)

        # Height dimension line
        if self.include_dimensions:
            dim_x = x - 15
            c.setStrokeColor(colors.blue)
            c.setLineWidth(0.3)
            c.line(dim_x, origin_y, dim_x, y + total_height / 2)
            c.setFont("Helvetica", 6)
            c.setFillColor(colors.blue)
            c.drawString(dim_x - 25, y + total_height / 2 - 3, f"{int(placement.get('position_y', 0))}cm")

    def _draw_wall_dimensions(
        self,
        c: canvas.Canvas,
        length_cm: float,
        height_cm: float,
        origin_x: float,
        origin_y: float,
        width: float,
        height: float,
    ):
        """Draw wall dimension lines."""
        c.setStrokeColor(colors.blue)
        c.setFillColor(colors.blue)
        c.setLineWidth(0.5)
        c.setFont("Helvetica", 8)

        # Width dimension (bottom)
        y = origin_y - 15
        c.line(origin_x, y, origin_x + width, y)
        c.line(origin_x, y - 5, origin_x, y + 5)
        c.line(origin_x + width, y - 5, origin_x + width, y + 5)
        c.drawCentredString(origin_x + width / 2, y - 12, f"{length_cm:.0f} cm")

        # Height dimension (right)
        x = origin_x + width + 15
        c.line(x, origin_y, x, origin_y + height)
        c.line(x - 5, origin_y, x + 5, origin_y)
        c.line(x - 5, origin_y + height, x + 5, origin_y + height)
        c.saveState()
        c.translate(x + 12, origin_y + height / 2)
        c.rotate(90)
        c.drawCentredString(0, 0, f"{height_cm:.0f} cm")
        c.restoreState()

    def _draw_scale_bar(self, c: canvas.Canvas, x: float, y: float, scale: float):
        """Draw a scale bar."""
        bar_length_cm = 100  # 1 meter scale bar
        bar_width = bar_length_cm * scale

        c.setStrokeColor(colors.black)
        c.setFillColor(colors.black)
        c.setLineWidth(1)

        # Main bar
        c.rect(x, y, bar_width, 4, fill=1)

        # Tick marks and labels
        c.setFont("Helvetica", 7)
        for i in range(5):
            tick_x = x + (i * bar_width / 4)
            c.line(tick_x, y, tick_x, y + 6)
            c.drawCentredString(tick_x, y - 10, f"{i * 25}")

        c.drawString(x + bar_width + 5, y, "cm")


class InstallationSpecGenerator:
    """Generate installation specifications document."""

    def __init__(
        self,
        exhibition: dict[str, Any],
        floor_plan: dict[str, Any],
        placements: list[dict[str, Any]],
    ):
        self.exhibition = exhibition
        self.floor_plan = floor_plan
        self.placements = placements

    def generate(self) -> bytes:
        """Generate the installation spec PDF and return as bytes."""
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=A4)
        styles = getSampleStyleSheet()
        story = []

        # Title
        title_style = ParagraphStyle(
            "Title",
            parent=styles["Title"],
            fontSize=18,
            spaceAfter=30,
        )
        story.append(
            Paragraph(
                f"Installation Specifications<br/>{self.exhibition.get('title', 'Exhibition')}",
                title_style,
            )
        )

        # Exhibition info
        info_style = ParagraphStyle(
            "Info",
            parent=styles["Normal"],
            fontSize=10,
            spaceAfter=20,
        )
        story.append(
            Paragraph(
                f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}<br/>"
                f"Venue: {self.floor_plan.get('name', 'N/A')}<br/>"
                f"Total artworks: {len(self.placements)}",
                info_style,
            )
        )

        story.append(Spacer(1, 20))

        # Mounting heights table
        story.append(Paragraph("Mounting Heights", styles["Heading2"]))
        story.append(Spacer(1, 10))

        table_data = [["#", "Title", "Artist", "Wall", "Height (cm)", "Mount Type"]]
        for i, p in enumerate(self.placements, 1):
            table_data.append([
                str(i),
                (p.get("display_title") or "Untitled")[:30],
                (p.get("display_artist") or "Unknown")[:25],
                p.get("wall_id", "N/A"),
                str(int(p.get("position_y", 0))),
                p.get("mount_type", "wall").title(),
            ])

        table = Table(table_data, colWidths=[30, 150, 100, 60, 70, 70])
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.Color(0.2, 0.4, 0.3)),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("ALIGN", (0, 0), (-1, -1), "LEFT"),
            ("ALIGN", (0, 0), (0, -1), "CENTER"),
            ("ALIGN", (4, 0), (4, -1), "CENTER"),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, 0), 10),
            ("FONTSIZE", (0, 1), (-1, -1), 9),
            ("BOTTOMPADDING", (0, 0), (-1, 0), 12),
            ("TOPPADDING", (0, 1), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 1), (-1, -1), 6),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.gray),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.Color(0.95, 0.95, 0.95)]),
        ]))
        story.append(table)

        story.append(PageBreak())

        # Hardware requirements
        story.append(Paragraph("Hardware Requirements", styles["Heading2"]))
        story.append(Spacer(1, 10))

        # Group by mount type
        mount_types = {}
        for p in self.placements:
            mt = p.get("mount_type", "wall")
            if mt not in mount_types:
                mount_types[mt] = []
            mount_types[mt].append(p)

        for mount_type, items in mount_types.items():
            story.append(Paragraph(f"{mount_type.title()} Mounted ({len(items)} items)", styles["Heading3"]))

            if mount_type == "wall":
                story.append(Paragraph(
                    "• Picture hooks or D-rings<br/>"
                    "• Security screws (as needed)<br/>"
                    "• Level and measuring tape<br/>"
                    "• Soft padded gloves for handling",
                    styles["Normal"]
                ))
            elif mount_type == "plinth":
                story.append(Paragraph(
                    "• Plinths with specified dimensions<br/>"
                    "• Museum wax or earthquake putty<br/>"
                    "• Protective barriers (if required)<br/>"
                    "• Soft padded gloves for handling",
                    styles["Normal"]
                ))
            elif mount_type == "vitrine":
                story.append(Paragraph(
                    "• Display cases with climate control<br/>"
                    "• Mounting supports for interior display<br/>"
                    "• Security locks<br/>"
                    "• Cotton gloves for handling",
                    styles["Normal"]
                ))
            elif mount_type == "hanging":
                story.append(Paragraph(
                    "• Ceiling anchors rated for weight<br/>"
                    "• Aircraft cable or nylon line<br/>"
                    "• Turnbuckles for height adjustment<br/>"
                    "• Safety cables",
                    styles["Normal"]
                ))

            story.append(Spacer(1, 15))

        # Wall preparation notes
        story.append(Paragraph("Wall Preparation", styles["Heading2"]))
        story.append(Spacer(1, 10))
        story.append(Paragraph(
            "1. Inspect all walls for damage, marks, or holes<br/>"
            "2. Fill and sand any imperfections<br/>"
            "3. Touch up paint as needed (wall color: {color})<br/>"
            "4. Mark mounting positions with painter's tape<br/>"
            "5. Install hanging hardware before artwork arrives".format(
                color=self.floor_plan.get("wall_color", "#FFFFFF")
            ),
            styles["Normal"]
        ))

        doc.build(story)
        buffer.seek(0)
        return buffer.getvalue()


class ObjectChecklistGenerator:
    """Generate artwork checklist with condition report fields."""

    def __init__(
        self,
        exhibition: dict[str, Any],
        placements: list[dict[str, Any]],
        include_images: bool = False,
    ):
        self.exhibition = exhibition
        self.placements = placements
        self.include_images = include_images

    def generate(self) -> bytes:
        """Generate the object checklist PDF and return as bytes."""
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=A4)
        styles = getSampleStyleSheet()
        story = []

        # Title
        title_style = ParagraphStyle(
            "Title",
            parent=styles["Title"],
            fontSize=16,
            spaceAfter=20,
        )
        story.append(
            Paragraph(
                f"Object Checklist<br/>{self.exhibition.get('title', 'Exhibition')}",
                title_style,
            )
        )

        # Header info
        info_style = ParagraphStyle(
            "Info",
            parent=styles["Normal"],
            fontSize=9,
            spaceAfter=15,
        )
        story.append(
            Paragraph(
                f"Date: ________________  |  Checked by: ________________<br/>"
                f"Total objects: {len(self.placements)}",
                info_style,
            )
        )

        story.append(Spacer(1, 10))

        # Create checklist for each placement
        for i, placement in enumerate(self.placements, 1):
            story.append(self._create_checklist_item(i, placement, styles))
            story.append(Spacer(1, 15))

            # Page break every 3 items
            if i % 3 == 0 and i < len(self.placements):
                story.append(PageBreak())

        # Sign-off section
        story.append(PageBreak())
        story.append(Paragraph("Installation Sign-Off", styles["Heading2"]))
        story.append(Spacer(1, 20))

        signoff_data = [
            ["Role", "Name", "Signature", "Date"],
            ["Registrar", "", "", ""],
            ["Curator", "", "", ""],
            ["Installation Lead", "", "", ""],
            ["Security", "", "", ""],
        ]
        signoff_table = Table(signoff_data, colWidths=[100, 150, 150, 80])
        signoff_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.Color(0.2, 0.4, 0.3)),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 10),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.gray),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 15),
            ("TOPPADDING", (0, 1), (-1, -1), 15),
        ]))
        story.append(signoff_table)

        doc.build(story)
        buffer.seek(0)
        return buffer.getvalue()

    def _create_checklist_item(
        self, number: int, placement: dict, styles
    ) -> Table:
        """Create a checklist item for a single artwork."""
        # Main info
        title = placement.get("display_title") or "Untitled"
        artist = placement.get("display_artist") or "Unknown"
        dimensions = f"{placement.get('width_cm', 0)}×{placement.get('height_cm', 0)}×{placement.get('depth_cm', 0)} cm"
        location = f"Wall: {placement.get('wall_id', 'N/A')} | Position: {placement.get('position_x', 0)}cm from start"

        # Condition checkboxes
        conditions = [
            "☐ No visible damage",
            "☐ Frame intact",
            "☐ Glass clean/unbroken",
            "☐ Mounting hardware attached",
            "☐ Label present",
        ]

        data = [
            [f"#{number}", Paragraph(f"<b>{title}</b><br/>{artist}", styles["Normal"])],
            ["Dimensions:", dimensions],
            ["Location:", location],
            ["Mount Type:", placement.get("mount_type", "wall").title()],
            ["Condition:", "\n".join(conditions)],
            ["Notes:", ""],
        ]

        table = Table(data, colWidths=[80, 400])
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (0, 0), colors.Color(0.2, 0.4, 0.3)),
            ("TEXTCOLOR", (0, 0), (0, 0), colors.white),
            ("FONTNAME", (0, 0), (0, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.gray),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, -1), (-1, -1), 30),  # Extra space for notes
        ]))

        return table


# ============================================================================
# EXECUTION PACK - Checklist PDF Generator
# ============================================================================

class ChecklistPDFGenerator:
    """Generate checklist PDF grouped by phase with status and due dates."""

    DISCLAIMER = (
        "Note: This checklist reflects planning status as of the export date. "
        "Task status and due dates are subject to change."
    )

    def __init__(
        self,
        exhibition: dict[str, Any],
        items: list[dict[str, Any]],
        phase_filter: str | None = None,
    ):
        self.exhibition = exhibition
        self.items = items
        self.phase_filter = phase_filter

    def generate(self) -> bytes:
        """Generate the checklist PDF and return as bytes."""
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=A4)
        styles = getSampleStyleSheet()
        story = []

        # Title
        title_style = ParagraphStyle(
            "Title",
            parent=styles["Title"],
            fontSize=16,
            spaceAfter=10,
            textColor=colors.Color(0.12, 0.23, 0.18),  # Forest green
        )
        story.append(
            Paragraph(
                f"Exhibition Checklist<br/>{self.exhibition.get('title', 'Exhibition')}",
                title_style,
            )
        )

        # Metadata
        info_style = ParagraphStyle(
            "Info",
            parent=styles["Normal"],
            fontSize=9,
            spaceAfter=5,
            textColor=colors.gray,
        )
        filter_text = f"Phase: {self.phase_filter.replace('_', ' ').title()}" if self.phase_filter else "All Phases"
        story.append(
            Paragraph(
                f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')} | {filter_text} | Total items: {len(self.items)}",
                info_style,
            )
        )

        # Disclaimer
        disclaimer_style = ParagraphStyle(
            "Disclaimer",
            parent=styles["Normal"],
            fontSize=8,
            spaceAfter=15,
            textColor=colors.gray,
            fontStyle="italic",
        )
        story.append(Paragraph(f"<i>{self.DISCLAIMER}</i>", disclaimer_style))

        story.append(Spacer(1, 10))

        if not self.items:
            story.append(Paragraph("No checklist items found.", styles["Normal"]))
            doc.build(story)
            buffer.seek(0)
            return buffer.getvalue()

        # Group items by phase
        phases: dict[str, list[dict]] = {}
        for item in self.items:
            phase = item["phase"]
            if phase not in phases:
                phases[phase] = []
            phases[phase].append(item)

        # Phase order
        phase_order = ["planning", "pre_install", "install", "open", "close", "deinstall", "travel"]

        for phase in phase_order:
            if phase not in phases:
                continue

            phase_items = phases[phase]
            phase_label = phase_items[0]["phase_label"] if phase_items else phase.replace("_", " ").title()

            # Phase header
            story.append(Paragraph(phase_label, styles["Heading2"]))
            story.append(Spacer(1, 5))

            # Table for this phase
            table_data = [["Task", "Status", "Due Date", "Assigned"]]
            for item in phase_items:
                table_data.append([
                    item["title"][:60] + ("..." if len(item["title"]) > 60 else ""),
                    item["status_label"],
                    item["due_date"] if item["due_date"] else "-",
                    item["assigned_user_name"] or item["responsible_role"],
                ])

            table = Table(table_data, colWidths=[250, 70, 80, 100])
            table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.Color(0.12, 0.23, 0.18)),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, 0), 9),
                ("FONTSIZE", (0, 1), (-1, -1), 8),
                ("ALIGN", (1, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.Color(0.85, 0.82, 0.78)),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.Color(0.96, 0.95, 0.92)]),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
            ]))
            story.append(table)
            story.append(Spacer(1, 15))

        doc.build(story)
        buffer.seek(0)
        return buffer.getvalue()


# ============================================================================
# EXECUTION PACK - Shipment Summary PDF Generator
# ============================================================================

class ShipmentSummaryPDFGenerator:
    """Generate shipment summary PDF grouped by direction."""

    DISCLAIMER = (
        "Note: Tracking information reflects status at export time. "
        "Verify with carriers for real-time updates."
    )

    def __init__(
        self,
        exhibition: dict[str, Any],
        shipments: list[dict[str, Any]],
    ):
        self.exhibition = exhibition
        self.shipments = shipments

    def generate(self) -> bytes:
        """Generate the shipment summary PDF and return as bytes."""
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=A4)
        styles = getSampleStyleSheet()
        story = []

        # Title
        title_style = ParagraphStyle(
            "Title",
            parent=styles["Title"],
            fontSize=16,
            spaceAfter=10,
            textColor=colors.Color(0.12, 0.23, 0.18),
        )
        story.append(
            Paragraph(
                f"Shipment Summary<br/>{self.exhibition.get('title', 'Exhibition')}",
                title_style,
            )
        )

        # Metadata
        info_style = ParagraphStyle(
            "Info",
            parent=styles["Normal"],
            fontSize=9,
            spaceAfter=5,
            textColor=colors.gray,
        )
        story.append(
            Paragraph(
                f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')} | Total shipments: {len(self.shipments)}",
                info_style,
            )
        )

        # Disclaimer
        disclaimer_style = ParagraphStyle(
            "Disclaimer",
            parent=styles["Normal"],
            fontSize=8,
            spaceAfter=15,
            textColor=colors.gray,
        )
        story.append(Paragraph(f"<i>{self.DISCLAIMER}</i>", disclaimer_style))

        story.append(Spacer(1, 10))

        if not self.shipments:
            story.append(Paragraph("No shipments found.", styles["Normal"]))
            doc.build(story)
            buffer.seek(0)
            return buffer.getvalue()

        # Group by direction
        inbound = [s for s in self.shipments if s["direction"] == "inbound"]
        outbound = [s for s in self.shipments if s["direction"] == "outbound"]

        for direction_label, shipment_list in [("Inbound", inbound), ("Outbound", outbound)]:
            if not shipment_list:
                continue

            story.append(Paragraph(direction_label, styles["Heading2"]))
            story.append(Spacer(1, 5))

            # Table
            table_data = [["#", "Carrier", "Tracking #", "Ship Date", "Expected", "Actual", "Status"]]
            for s in shipment_list:
                table_data.append([
                    s["shipment_number"] or "-",
                    s["carrier"][:15] if s["carrier"] else "-",
                    s["tracking_number"][:20] if s["tracking_number"] else "-",
                    s["ship_date"] or "-",
                    s["expected_arrival"] or "-",
                    s["actual_arrival"] or "-",
                    s["status_label"],
                ])

            table = Table(table_data, colWidths=[50, 70, 90, 70, 70, 70, 60])
            table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.Color(0.12, 0.23, 0.18)),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, 0), 8),
                ("FONTSIZE", (0, 1), (-1, -1), 8),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.Color(0.85, 0.82, 0.78)),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.Color(0.96, 0.95, 0.92)]),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
            ]))
            story.append(table)
            story.append(Spacer(1, 15))

        doc.build(story)
        buffer.seek(0)
        return buffer.getvalue()


# ============================================================================
# EXECUTION PACK - Object List PDF Generator
# ============================================================================

class ObjectListPDFGenerator:
    """Generate object list PDF in landscape format."""

    DISCLAIMER = (
        "Note: Placement status reflects planning decisions. "
        "Draft/proposed placements are not final installation positions."
    )

    def __init__(
        self,
        exhibition: dict[str, Any],
        objects: list[dict[str, Any]],
    ):
        self.exhibition = exhibition
        self.objects = objects

    def generate(self) -> bytes:
        """Generate the object list PDF and return as bytes."""
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=landscape(A4))
        styles = getSampleStyleSheet()
        story = []

        # Title
        title_style = ParagraphStyle(
            "Title",
            parent=styles["Title"],
            fontSize=16,
            spaceAfter=10,
            textColor=colors.Color(0.12, 0.23, 0.18),
        )
        story.append(
            Paragraph(
                f"Object List<br/>{self.exhibition.get('title', 'Exhibition')}",
                title_style,
            )
        )

        # Metadata
        info_style = ParagraphStyle(
            "Info",
            parent=styles["Normal"],
            fontSize=9,
            spaceAfter=5,
            textColor=colors.gray,
        )
        story.append(
            Paragraph(
                f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')} | Total objects: {len(self.objects)}",
                info_style,
            )
        )

        # Disclaimer
        disclaimer_style = ParagraphStyle(
            "Disclaimer",
            parent=styles["Normal"],
            fontSize=8,
            spaceAfter=15,
            textColor=colors.gray,
        )
        story.append(Paragraph(f"<i>{self.DISCLAIMER}</i>", disclaimer_style))

        story.append(Spacer(1, 10))

        if not self.objects:
            story.append(Paragraph("No objects found.", styles["Normal"]))
            doc.build(story)
            buffer.seek(0)
            return buffer.getvalue()

        # Table
        table_data = [["Object #", "Title / Artist", "Lender", "Packing Notes", "Placement Status"]]
        for obj in self.objects:
            # Combine title and artist
            title_artist = obj["display_title"]
            if obj["display_artist"] and obj["display_artist"] != "Unknown":
                title_artist += f"\n{obj['display_artist']}"

            table_data.append([
                obj["object_number"],
                title_artist[:50] + ("..." if len(title_artist) > 50 else ""),
                obj["lender_name"][:30] if obj["lender_name"] else "-",
                obj["packing_notes"][:40] + ("..." if len(obj["packing_notes"]) > 40 else "") if obj["packing_notes"] else "-",
                obj["placement_status_label"],
            ])

        table = Table(table_data, colWidths=[80, 200, 130, 180, 90])
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.Color(0.12, 0.23, 0.18)),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, 0), 9),
            ("FONTSIZE", (0, 1), (-1, -1), 8),
            ("ALIGN", (0, 0), (0, -1), "CENTER"),
            ("ALIGN", (-1, 0), (-1, -1), "CENTER"),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.Color(0.85, 0.82, 0.78)),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.Color(0.96, 0.95, 0.92)]),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
        ]))
        story.append(table)

        doc.build(story)
        buffer.seek(0)
        return buffer.getvalue()
