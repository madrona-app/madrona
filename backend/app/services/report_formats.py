"""Which export formats an organization is offered for a report.

PDF availability is a per-organization choice (Organization.report_pdf_mode):

- ``all``          every PDF export (default; unchanged behaviour)
- ``tagged_only``  only tagged PDFs — the document reports rendered by
                   WeasyPrint with the PDF/UA-1 variant. Tabular PDFs are
                   drawn by ReportLab and are untagged, so they are hidden.
- ``none``         no PDF; accessible formats only (HTML, Word, plain text,
                   CSV, Excel)

Format order is preserved from the report definition, which lists accessible
formats first.
"""
from __future__ import annotations

from typing import Any

PDF_MODES = ("all", "tagged_only", "none")


def org_pdf_mode(org_id: Any, db) -> str:
    from app.models import Organization

    org = db.query(Organization).filter_by(organization_id=org_id).first()
    mode = getattr(org, "report_pdf_mode", None) or "all"
    return mode if mode in PDF_MODES else "all"


def formats_for(definition, pdf_mode: str) -> list[str]:
    """Formats offered for ``definition`` under ``pdf_mode``."""
    formats = list(definition.supported_formats)
    if "pdf" in formats and (
        pdf_mode == "none" or (pdf_mode == "tagged_only" and not definition.pdf_tagged)
    ):
        formats.remove("pdf")
    return formats


def default_format_for(definition, formats: list[str]) -> str | None:
    if definition.default_format in formats:
        return definition.default_format
    return formats[0] if formats else None
