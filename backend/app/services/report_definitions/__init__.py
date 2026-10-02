"""
Report Definitions Package.

Importing this module registers all built-in report definitions with the
global ReportRegistry. Each submodule calls registry.register() at import time.
"""
from app.services.report_definitions import tabular_exports  # noqa: F401
from app.services.report_definitions import document_reports  # noqa: F401
from app.services.report_definitions import location_reports  # noqa: F401
