"""
Tabular Export Report Definitions.

Registers tabular export reports for each procedure record type.
These support search and workspace contexts, producing CSV/Excel/PDF tables.
"""
from app.services.report_registry import ReportDefinition, get_registry
from app.services.report_resolvers import resolve_search, resolve_workspace
from app.services.report_export import export_report

# Record types and their display labels
_RECORD_TYPES = {
    "collection_objects": "Collection Objects",
    "loans_in": "Incoming Loans",
    "loans_out": "Outgoing Loans",
    "object_entries": "Object Entries",
    "object_exits": "Object Exits",
    "conservation_treatments": "Conservation Treatments",
    "acquisitions": "Acquisitions",
    "condition_reports": "Condition Reports",
    "locations": "Locations",
    "movements": "Movements",
}


def _tabular_resolver(context_type, context_params, org_id):
    """Route to the appropriate resolver based on context type."""
    if context_type == "search":
        return resolve_search(context_params, org_id)
    elif context_type == "workspace":
        return resolve_workspace(context_params, org_id)
    else:
        raise ValueError(f"Unsupported context type for tabular export: {context_type}")


def _tabular_renderer(data, export_format, columns=None, report_name="Export", **kwargs):
    """Render tabular data using the existing report_export service."""
    content, content_type, extension = export_report(
        data=data,
        format=export_format,
        columns=columns,
        report_name=report_name,
    )
    return content, content_type, extension


# Register a tabular export for each record type
registry = get_registry()

for record_type, label in _RECORD_TYPES.items():
    # Only collection_objects supports search context (the search service
    # returns collection object IDs only). All types support workspace context.
    context_types = ["search", "workspace"] if record_type == "collection_objects" else ["workspace"]
    registry.register(ReportDefinition(
        report_key=f"{record_type}_tabular",
        name=f"{label} Export",
        description=f"Export {label.lower()} as a spreadsheet or PDF table.",
        category="Tabular Export",
        style="tabular",
        context_types=context_types,
        record_types=[record_type],
        supported_formats=["csv", "excel", "pdf"],
        resolver=_tabular_resolver,
        renderer=_tabular_renderer,
        default_format="excel",
    ))
