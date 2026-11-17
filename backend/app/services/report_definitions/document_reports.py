"""
Document Report Definitions.

Registers formatted document reports for individual records.
These produce documents from single record data: accessible HTML, Word
(DOCX) and branded PDF.
"""
from app.services.report_registry import ReportDefinition, get_registry
from app.services.report_resolvers import resolve_record
from app.services.report_export import FORMAT_INFO
from app.services.report_document_renderer import (
    render_object_record_sheet,
    render_object_record_sheet_html,
    render_condition_report,
    render_condition_report_html,
    render_loan_agreement,
    render_loan_agreement_html,
    render_object_entry_report,
    render_object_entry_report_html,
    render_object_exit_report,
    render_object_exit_report_html,
    render_conservation_treatment_report,
    render_conservation_treatment_report_html,
    render_acquisition_report,
    render_acquisition_report_html,
)


def _record_resolver(context_type, context_params, org_id):
    """Resolve data for a single record."""
    if context_type != "record":
        raise ValueError(f"Document reports only support 'record' context, got: {context_type}")
    return resolve_record(context_params, org_id)


def _make_document_renderer(render_fn):
    """Create a renderer that calls the given document render function."""
    def renderer(data, export_format, columns=None, report_name="Report", metadata=None, **kwargs):
        content = render_fn(data, metadata or {})
        return content, "application/pdf", "pdf"
    return renderer


# Accessible formats first: the order is the order the export menu offers them.
DOCUMENT_FORMATS = ["html", "docx", "txt", "pdf"]


def _make_html_renderer(render_fn):
    """Wrapper for template-based record renderers (HTML, DOCX, PDF)."""
    def renderer(data, export_format, columns=None, report_name="Report", metadata=None, **kwargs):
        if export_format not in FORMAT_INFO:
            raise ValueError(f"Unsupported export format: {export_format}")
        content = render_fn(data, metadata or {}, export_format=export_format)
        extension, content_type = FORMAT_INFO[export_format]
        return content, content_type, extension
    return renderer


registry = get_registry()

# Object Record Sheet (HTML/WeasyPrint — supports PDF and DOCX)
registry.register(ReportDefinition(
    report_key="object_record_sheet",
    name="Object Record Sheet",
    description="Comprehensive object details formatted as an institutional document.",
    category="Document Report",
    style="document",
    context_types=["record"],
    record_types=["collection_objects"],
    supported_formats=DOCUMENT_FORMATS,
    pdf_tagged=True,  # WeasyPrint pdf/ua-1
    resolver=_record_resolver,
    renderer=_make_html_renderer(render_object_record_sheet_html),
    default_format="pdf",
))

# Condition Report (HTML/WeasyPrint — supports PDF and DOCX)
registry.register(ReportDefinition(
    report_key="condition_report_document",
    name="Condition Report",
    description="Formatted condition assessment document.",
    category="Document Report",
    style="document",
    context_types=["record"],
    record_types=["condition_reports"],
    supported_formats=DOCUMENT_FORMATS,
    pdf_tagged=True,  # WeasyPrint pdf/ua-1
    resolver=_record_resolver,
    renderer=_make_html_renderer(render_condition_report_html),
    default_format="pdf",
))

# Loan Agreement (Incoming) (HTML/WeasyPrint — supports PDF and DOCX)
registry.register(ReportDefinition(
    report_key="loan_in_agreement",
    name="Loan Agreement (Incoming)",
    description="Incoming loan agreement document with terms and conditions.",
    category="Document Report",
    style="document",
    context_types=["record"],
    record_types=["loans_in"],
    supported_formats=DOCUMENT_FORMATS,
    pdf_tagged=True,  # WeasyPrint pdf/ua-1
    resolver=_record_resolver,
    renderer=_make_html_renderer(render_loan_agreement_html),
    default_format="pdf",
))

# Loan Agreement (Outgoing) (HTML/WeasyPrint — supports PDF and DOCX)
registry.register(ReportDefinition(
    report_key="loan_out_agreement",
    name="Loan Agreement (Outgoing)",
    description="Outgoing loan agreement document with terms and conditions.",
    category="Document Report",
    style="document",
    context_types=["record"],
    record_types=["loans_out"],
    supported_formats=DOCUMENT_FORMATS,
    pdf_tagged=True,  # WeasyPrint pdf/ua-1
    resolver=_record_resolver,
    renderer=_make_html_renderer(render_loan_agreement_html),
    default_format="pdf",
))

# Object Entry Report (HTML/WeasyPrint — supports PDF and DOCX)
registry.register(ReportDefinition(
    report_key="object_entry_report",
    name="Object Entry Report",
    description="Formal record of objects received into temporary custody.",
    category="Document Report",
    style="document",
    context_types=["record"],
    record_types=["object_entries"],
    supported_formats=DOCUMENT_FORMATS,
    pdf_tagged=True,  # WeasyPrint pdf/ua-1
    resolver=_record_resolver,
    renderer=_make_html_renderer(render_object_entry_report_html),
    default_format="pdf",
))

# Object Exit Report (HTML/WeasyPrint — supports PDF and DOCX)
registry.register(ReportDefinition(
    report_key="object_exit_report",
    name="Object Exit Report",
    description="Formal record of objects dispatched from the institution.",
    category="Document Report",
    style="document",
    context_types=["record"],
    record_types=["object_exits"],
    supported_formats=DOCUMENT_FORMATS,
    pdf_tagged=True,  # WeasyPrint pdf/ua-1
    resolver=_record_resolver,
    renderer=_make_html_renderer(render_object_exit_report_html),
    default_format="pdf",
))

# Conservation Treatment Report (HTML/WeasyPrint — supports PDF and DOCX)
registry.register(ReportDefinition(
    report_key="conservation_treatment_report",
    name="Conservation Treatment Report",
    description="Detailed conservation treatment record with methods and outcomes.",
    category="Document Report",
    style="document",
    context_types=["record"],
    record_types=["conservation_treatments"],
    supported_formats=DOCUMENT_FORMATS,
    pdf_tagged=True,  # WeasyPrint pdf/ua-1
    resolver=_record_resolver,
    renderer=_make_html_renderer(render_conservation_treatment_report_html),
    default_format="pdf",
))

# Acquisition Report (HTML/WeasyPrint — supports PDF and DOCX)
registry.register(ReportDefinition(
    report_key="acquisition_report",
    name="Acquisition Report",
    description="Formal acquisition record with source, financial, and legal details.",
    category="Document Report",
    style="document",
    context_types=["record"],
    record_types=["acquisitions"],
    supported_formats=DOCUMENT_FORMATS,
    pdf_tagged=True,  # WeasyPrint pdf/ua-1
    resolver=_record_resolver,
    renderer=_make_html_renderer(render_acquisition_report_html),
    default_format="pdf",
))
