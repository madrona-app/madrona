"""
Tabular Export Report Definitions.

Registers tabular export reports for each procedure record type.
These support search and workspace contexts, producing accessible HTML,
CSV, Excel and PDF tables.
"""
from app.services.report_registry import ReportDefinition, get_registry
from app.services.report_resolvers import (
    resolve_search,
    resolve_workspace,
    search_object_ids,
    workspace_object_ids,
)
from app.services.report_export import export_report

# Accessible formats first: the order is the order the export menu offers them.
TABULAR_FORMATS = ["html", "txt", "csv", "excel", "pdf"]

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
        description=f"Export {label.lower()} as an accessible web page, spreadsheet or PDF table.",
        category="Tabular Export",
        style="tabular",
        context_types=context_types,
        record_types=[record_type],
        supported_formats=TABULAR_FORMATS,
        resolver=_tabular_resolver,
        renderer=_tabular_renderer,
        default_format="excel",
    ))


# ----------------------------------------------------------------------------
# Attachment filenames for a set of objects
# ----------------------------------------------------------------------------

ATTACHMENT_COLUMNS = [
    {"field": "object_number", "label": "Object Number"},
    {"field": "object_name", "label": "Object Name"},
    {"field": "filename", "label": "File Name"},
    {"field": "type_label", "label": "Type"},
    {"field": "mime_type", "label": "File Format"},
    {"field": "title", "label": "Title"},
    {"field": "alt_text", "label": "Alt Text"},
    {"field": "is_primary", "label": "Primary"},
]


def _attachments_resolver(context_type, context_params, org_id):
    """One row per attached file; objects with no files get one row saying so."""
    from sqlalchemy import select

    from app.database import current_session
    from app.models import CollectionObject
    from app.services.report_document_renderer import fetch_object_attachments

    if context_type == "search":
        object_ids, meta = search_object_ids(context_params, org_id), {"source": "search"}
    elif context_type == "workspace":
        object_ids, meta = workspace_object_ids(context_params, org_id)
        if meta.get("error"):
            return [], ATTACHMENT_COLUMNS, {"total": 0, "error": meta["error"]}
        meta["source"] = "workspace"
    else:
        raise ValueError(f"Unsupported context type for attachment list: {context_type}")

    if not object_ids:
        return [], ATTACHMENT_COLUMNS, {"total": 0, **meta}

    objects = current_session().execute(
        select(CollectionObject)
        .where(CollectionObject.organization_id == org_id, CollectionObject.object_id.in_(object_ids))
        .order_by(CollectionObject.object_number)
    ).scalars().all()
    files = fetch_object_attachments([o.object_id for o in objects], org_id)

    rows = []
    for obj in objects:
        base = {"object_number": obj.object_number, "object_name": obj.object_name or ""}
        attached = files.get(obj.object_id) or []
        if not attached:
            rows.append({**base, "filename": "No attached files", "type_label": "", "mime_type": "",
                         "title": "", "alt_text": "", "is_primary": ""})
        for a in attached:
            rows.append({**base, **{k: a.get(k) or "" for k in
                                    ("filename", "type_label", "mime_type", "title", "alt_text")},
                         "is_primary": a["is_primary"]})
    return rows, ATTACHMENT_COLUMNS, {"total": len(rows), **meta}


registry.register(ReportDefinition(
    report_key="collection_objects_attachments",
    name="Attached Files List",
    description="File name, type and title of every file attached to these objects.",
    category="Tabular Export",
    style="tabular",
    context_types=["search", "workspace"],
    record_types=["collection_objects"],
    supported_formats=TABULAR_FORMATS,
    resolver=_attachments_resolver,
    renderer=_tabular_renderer,
    default_format="excel",
))
