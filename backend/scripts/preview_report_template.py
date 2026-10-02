#!/usr/bin/env python3
"""
Preview a report template locally during development.

Renders an HTML template with sample data so you can iterate on the layout
in a browser without uploading to S3 or generating a real report.

Usage:
    # Render the built-in template with sample data, open in browser:
    ./venv/bin/python scripts/preview_report_template.py

    # Render a custom template file:
    ./venv/bin/python scripts/preview_report_template.py path/to/my_template.html

    # Render to PDF (requires weasyprint):
    ./venv/bin/python scripts/preview_report_template.py --pdf

    # Render a custom template to PDF:
    ./venv/bin/python scripts/preview_report_template.py path/to/my_template.html --pdf

    # Write HTML to a file instead of opening browser:
    ./venv/bin/python scripts/preview_report_template.py -o preview.html

The template receives the same Jinja2 context variables that the real
renderer passes. Edit SAMPLE_CONTEXT below to tweak the preview data.
"""
import argparse
import os
import sys
import tempfile
import webbrowser
from datetime import datetime, timezone
from pathlib import Path

# Ensure app is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import jinja2
import jinja2.sandbox

# ---------------------------------------------------------------------------
# Sample context — same shape as render_object_record_sheet_html() produces
# ---------------------------------------------------------------------------
SAMPLE_CONTEXT = {
    "org_name": "Sample Museum",
    "title": "2024.001.0042 — Seated Figure with Offering Bowl",
    "object_number": "2024.001.0042",
    "generated_at": datetime.now(timezone.utc).strftime("%B %d, %Y at %H:%M UTC"),
    "ident_fields": [
        ("Object Number", "2024.001.0042"),
        ("Object Name", "Seated Figure with Offering Bowl"),
        ("Object Type", "Sculpture"),
        ("Category", "Ethnographic"),
        ("Catalog Level", "Item"),
        ("Number of Objects", "1"),
        ("Status", "Accessioned"),
        ("Department", "World Cultures"),
    ],
    "image_b64": None,
    "image_mime": None,
    "creators": "Unknown artist, Akan peoples, Ghana, late 19th century",
    "brief_description": "Terracotta seated figure holding a shallow offering bowl.",
    "full_description": (
        "A terracotta figure depicted in a seated position with crossed legs, "
        "holding a wide, shallow bowl in both hands at chest height. "
        "The surface shows traces of kaolin wash and red ochre pigment. "
        "Facial features are stylised with prominent, half-closed eyes and "
        "horizontal scarification marks across both cheeks."
    ),
    "color": "Reddish-brown with traces of white slip",
    "form": "Figure, seated",
    "physical_description": "Solid-bodied terracotta with coil-built base",
    "distinguishing_features": "Horizontal scarification marks on cheeks; remains of kaolin wash",
    "dimensions": "H 24.5 cm x W 14.0 cm x D 16.2 cm; Weight 1.8 kg",
    "materials": "Terracotta, kaolin, red ochre",
    "techniques": "Hand-built, coil construction, burnished",
    "inscriptions": "None visible",
    "edition": None,
    "copy_number": None,
    "edition_size": None,
    "state_display": None,
    "state_description": None,
    "creation_date_display": "Late 19th century",
    "creation_place": "Akan region, Ghana",
    "style_period": "Late pre-colonial Akan",
    "production_note": None,
    "subjects_display": "Figure, Offering, Ritual",
    "content_description": None,
    "provenance": (
        "Collected by J. H. Robertson, Gold Coast, c. 1910; "
        "by descent to Robertson family; "
        "acquired at Sotheby's London, 14 March 2023, lot 142."
    ),
    "credit_line": "Museum purchase with funds from the Acquisitions Endowment",
    "object_history_note": "Exhibited at the British Empire Exhibition, Wembley, 1924.",
    "comments": None,
    "barcode": "MAD-2024-001-0042",
    "last_inventoried_date": "January 15, 2025",
    "condition_rating": "Good",
    "condition_date": "December 12, 2024",
    "completeness": "Complete",
    "conservation_priority": "Low",
    "condition_note": "Minor surface abrasion on base; stable overall.",
    "handling_requirements": "Support base when lifting. Avoid contact with pigmented surfaces.",
    "current_value_display": "12,500 GBP",
    "current_value_date": "March 14, 2023",
    "insurance_value_display": "15,000 GBP",
    "insurance_note": None,
    "created_at": "April 2, 2024",
    "updated_at": "January 15, 2025",
}


def main():
    parser = argparse.ArgumentParser(
        description="Preview a Jinja2 report template with sample data.",
    )
    parser.add_argument(
        "template",
        nargs="?",
        help="Path to a custom .html template file. "
        "Omit to use the built-in object_record_sheet.html.",
    )
    parser.add_argument(
        "--pdf",
        action="store_true",
        help="Render to PDF (requires weasyprint).",
    )
    parser.add_argument(
        "-o", "--output",
        help="Write output to this file instead of opening browser.",
    )
    args = parser.parse_args()

    # Load template
    if args.template:
        template_path = Path(args.template).resolve()
        if not template_path.exists():
            print(f"Error: {template_path} not found", file=sys.stderr)
            sys.exit(1)
        loader = jinja2.FileSystemLoader(str(template_path.parent))
        template_name = template_path.name
    else:
        # Built-in template
        templates_dir = Path(__file__).resolve().parent.parent / "app" / "services" / "report_templates"
        loader = jinja2.FileSystemLoader(str(templates_dir))
        template_name = "object_record_sheet.html"

    env = jinja2.sandbox.SandboxedEnvironment(loader=loader, autoescape=True)
    template = env.get_template(template_name)
    html = template.render(**SAMPLE_CONTEXT)

    if args.pdf:
        import weasyprint

        pdf_bytes = weasyprint.HTML(string=html).write_pdf()
        if args.output:
            out = Path(args.output)
        else:
            out = Path(tempfile.mktemp(suffix=".pdf", prefix="report_preview_"))
        out.write_bytes(pdf_bytes)
        print(f"PDF written to {out}")
        webbrowser.open(f"file://{out}")
    else:
        if args.output:
            out = Path(args.output)
        else:
            out = Path(tempfile.mktemp(suffix=".html", prefix="report_preview_"))
        out.write_text(html, encoding="utf-8")
        print(f"HTML written to {out}")
        webbrowser.open(f"file://{out}")


if __name__ == "__main__":
    main()
