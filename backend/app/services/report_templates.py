"""Report Templates Service.

Pre-built report templates for common museum/collections reporting needs.
Each template defines its data source, default columns, and visualization.
"""
from typing import Any


# ============================================================================
# TEMPLATE DEFINITIONS
# ============================================================================

REPORT_TEMPLATES: dict[str, dict[str, Any]] = {
    # ── Collections ─────────────────────────────────────────────────────────

    "collection_summary": {
        "name": "Collection Summary",
        "description": "Overview of the entire collection with counts by type, status, and classification.",
        "data_source": "collections",
        "category": "Collections",
        "default_columns": [
            "object_number",
            "title",
            "object_type",
            "classification",
            "object_status",
            "current_location_id",
            "accession_date",
        ],
        "default_visualization": "table",
        "visualization_options": ["table", "bar", "pie"],
        "aggregations": [
            {"field": "object_type", "type": "count", "label": "By Type"},
            {"field": "object_status", "type": "count", "label": "By Status"},
            {"field": "classification", "type": "count", "label": "By Classification"},
        ],
    },

    "objects_by_location": {
        "name": "Objects by Location",
        "description": "Distribution of collection objects across storage locations.",
        "data_source": "collections",
        "category": "Collections",
        "default_columns": [
            "current_location_id",
            "object_count",
            "capacity",
            "utilization_percent",
        ],
        "default_visualization": "bar",
        "visualization_options": ["bar", "pie", "table"],
        "group_by": "current_location_id",
        "aggregations": [
            {"field": "object_id", "type": "count", "label": "Object Count"},
        ],
    },

    "acquisition_report": {
        "name": "Acquisition Report",
        "description": "List of all acquisitions with source, method, and value information.",
        "data_source": "acquisitions",
        "category": "Collections",
        "default_columns": [
            "acquisition_number",
            "acquisition_date",
            "acquisition_method",
            "acquisition_source",
            "object_count",
            "total_value",
            "status",
        ],
        "default_visualization": "table",
        "visualization_options": ["table", "bar", "line"],
        "date_field": "acquisition_date",
    },

    "active_loans_in": {
        "name": "Active Loans In",
        "description": "Currently active incoming loans with due dates and lender information.",
        "data_source": "loans_in",
        "category": "Loans",
        "default_columns": [
            "loan_number",
            "lender_name",
            "object_count",
            "start_date",
            "end_date",
            "days_remaining",
            "status",
        ],
        "default_visualization": "table",
        "visualization_options": ["table"],
        "default_filters": {
            "status": ["active", "pending_return"],
        },
        "date_field": "end_date",
    },

    "active_loans_out": {
        "name": "Active Loans Out",
        "description": "Currently active outgoing loans with due dates and borrower information.",
        "data_source": "loans_out",
        "category": "Loans",
        "default_columns": [
            "loan_number",
            "borrower_name",
            "object_count",
            "start_date",
            "end_date",
            "days_remaining",
            "status",
        ],
        "default_visualization": "table",
        "visualization_options": ["table"],
        "default_filters": {
            "status": ["active", "pending_return"],
        },
        "date_field": "end_date",
    },

    "condition_overview": {
        "name": "Condition Overview",
        "description": "Summary of object conditions across the collection.",
        "data_source": "condition_reports",
        "category": "Conservation",
        "default_columns": [
            "condition_rating",
            "object_count",
            "percentage",
        ],
        "default_visualization": "pie",
        "visualization_options": ["pie", "bar", "table"],
        "group_by": "condition_rating",
        "aggregations": [
            {"field": "condition_report_id", "type": "count", "label": "Report Count"},
        ],
    },

    "conservation_needs": {
        "name": "Conservation Needs",
        "description": "Objects requiring conservation attention, sorted by priority.",
        "data_source": "collections",
        "category": "Conservation",
        "default_columns": [
            "object_number",
            "title",
            "condition_rating",
            "conservation_priority",
            "condition_date",
            "current_location_id",
        ],
        "default_visualization": "table",
        "visualization_options": ["table", "bar"],
        "default_filters": {
            "conservation_priority": ["urgent", "high"],
        },
        "sort_config": [
            {"field": "conservation_priority", "direction": "desc"},
            {"field": "condition_date", "direction": "asc"},
        ],
    },

    "movement_history": {
        "name": "Movement History",
        "description": "Complete log of object movements within the organization.",
        "data_source": "movements",
        "category": "Movements",
        "default_columns": [
            "movement_reference_number",
            "object_number",
            "object_title",
            "from_location",
            "to_location",
            "movement_date",
            "reason",
            "moved_by",
        ],
        "default_visualization": "table",
        "visualization_options": ["table", "line"],
        "date_field": "movement_date",
    },

    # ── Media / DAM ─────────────────────────────────────────────────────────

    "media_usage": {
        "name": "Media Usage",
        "description": "Media files usage statistics and distribution by type.",
        "data_source": "media",
        "category": "Media",
        "default_columns": [
            "media_type",
            "file_count",
            "total_size_mb",
            "linked_objects",
            "published_count",
        ],
        "default_visualization": "bar",
        "visualization_options": ["bar", "pie", "table"],
        "group_by": "media_type",
    },

    "media_library": {
        "name": "Media Library Report",
        "description": "Complete inventory of media files with metadata.",
        "data_source": "media",
        "category": "Media",
        "default_columns": [
            "filename",
            "media_type",
            "file_size_mb",
            "resolution",
            "linked_object",
            "created_at",
            "published",
        ],
        "default_visualization": "table",
        "visualization_options": ["table"],
    },

    # ── Exhibitions ─────────────────────────────────────────────────────────

    "exhibition_summary": {
        "name": "Exhibition Summary",
        "description": "Overview of all exhibitions with object counts and dates.",
        "data_source": "exhibitions",
        "category": "Exhibit",
        "default_columns": [
            "exhibition_name",
            "venue_name",
            "start_date",
            "end_date",
            "object_count",
            "status",
        ],
        "default_visualization": "table",
        "visualization_options": ["table", "bar"],
        "date_field": "start_date",
    },

    # ── Administrative ──────────────────────────────────────────────────────

    "valuation_summary": {
        "name": "Valuation Summary",
        "description": "Collection valuation overview with insurance values.",
        "data_source": "collections",
        "category": "Administrative",
        "default_columns": [
            "object_number",
            "title",
            "current_value",
            "insurance_value",
            "current_value_date",
            "acquisition_cost",
        ],
        "default_visualization": "table",
        "visualization_options": ["table", "bar"],
        "aggregations": [
            {"field": "current_value", "type": "sum", "label": "Total Value"},
            {"field": "insurance_value", "type": "sum", "label": "Total Insurance Value"},
        ],
    },

    "deaccession_history": {
        "name": "Deaccession History",
        "description": "Record of deaccessioned items with disposal methods and values.",
        "data_source": "deaccessions",
        "category": "Administrative",
        "default_columns": [
            "deaccession_number",
            "object_number",
            "object_title",
            "deaccession_date",
            "disposal_method",
            "disposal_value",
            "recipient",
            "reason",
        ],
        "default_visualization": "table",
        "visualization_options": ["table"],
        "date_field": "deaccession_date",
    },

    "incident_report": {
        "name": "Incident Report",
        "description": "Summary of damage, loss, and security incidents.",
        "data_source": "incidents",
        "category": "Administrative",
        "default_columns": [
            "incident_number",
            "incident_date",
            "incident_type",
            "severity",
            "affected_objects",
            "location",
            "status",
            "resolution_date",
        ],
        "default_visualization": "table",
        "visualization_options": ["table", "bar", "line"],
        "date_field": "incident_date",
    },
}


# ============================================================================
# DATA SOURCE FIELD DEFINITIONS
# ============================================================================

DATA_SOURCE_FIELDS: dict[str, list[dict[str, Any]]] = {
    "collections": [
        {"name": "object_id", "label": "Object ID", "type": "uuid"},
        {"name": "object_number", "label": "Object Number", "type": "string"},
        {"name": "title", "label": "Title", "type": "string"},
        {"name": "object_type", "label": "Object Type", "type": "string"},
        {"name": "classification", "label": "Classification", "type": "string"},
        {"name": "object_status", "label": "Status", "type": "select", "options": [
            "pending", "accessioned", "on_loan", "deaccessioned", "missing", "destroyed"
        ]},
        {"name": "condition_rating", "label": "Condition", "type": "select", "options": [
            "excellent", "good", "fair", "poor", "unacceptable"
        ]},
        {"name": "conservation_priority", "label": "Conservation Priority", "type": "select", "options": [
            "urgent", "high", "medium", "low", "none"
        ]},
        {"name": "current_location_id", "label": "Current Location", "type": "uuid"},
        {"name": "acquisition_date", "label": "Acquisition Date", "type": "date"},
        {"name": "accession_date", "label": "Accession Date", "type": "date"},
        {"name": "current_value", "label": "Current Value", "type": "number"},
        {"name": "insurance_value", "label": "Insurance Value", "type": "number"},
        {"name": "created_at", "label": "Created At", "type": "datetime"},
    ],
    "movements": [
        {"name": "movement_id", "label": "Movement ID", "type": "uuid"},
        {"name": "movement_reference_number", "label": "Reference Number", "type": "string"},
        {"name": "object_id", "label": "Object", "type": "uuid"},
        {"name": "from_location_id", "label": "From Location", "type": "uuid"},
        {"name": "to_location_id", "label": "To Location", "type": "uuid"},
        {"name": "movement_date", "label": "Movement Date", "type": "datetime"},
        {"name": "reason", "label": "Reason", "type": "select", "options": [
            "exhibition", "storage", "conservation", "loan", "photography",
            "research", "inventory", "rearrangement", "environmental", "security", "access_request", "other"
        ]},
        {"name": "status", "label": "Status", "type": "select", "options": [
            "pending", "in_transit", "completed", "cancelled"
        ]},
    ],
    "acquisitions": [
        {"name": "acquisition_id", "label": "Acquisition ID", "type": "uuid"},
        {"name": "acquisition_number", "label": "Acquisition Number", "type": "string"},
        {"name": "acquisition_date", "label": "Acquisition Date", "type": "date"},
        {"name": "acquisition_method", "label": "Method", "type": "select", "options": [
            "purchase", "gift", "bequest", "transfer", "exchange", "field_collection", "found_in_collection", "unknown"
        ]},
        {"name": "acquisition_source", "label": "Source", "type": "string"},
        {"name": "total_value", "label": "Total Value", "type": "number"},
        {"name": "status", "label": "Status", "type": "string"},
    ],
    "loans_in": [
        {"name": "loan_id", "label": "Loan ID", "type": "uuid"},
        {"name": "loan_number", "label": "Loan Number", "type": "string"},
        {"name": "lender_name", "label": "Lender", "type": "string"},
        {"name": "start_date", "label": "Start Date", "type": "date"},
        {"name": "end_date", "label": "End Date", "type": "date"},
        {"name": "status", "label": "Status", "type": "string"},
    ],
    "loans_out": [
        {"name": "loan_id", "label": "Loan ID", "type": "uuid"},
        {"name": "loan_number", "label": "Loan Number", "type": "string"},
        {"name": "borrower_name", "label": "Borrower", "type": "string"},
        {"name": "start_date", "label": "Start Date", "type": "date"},
        {"name": "end_date", "label": "End Date", "type": "date"},
        {"name": "status", "label": "Status", "type": "string"},
    ],
    "condition_reports": [
        {"name": "condition_report_id", "label": "Report ID", "type": "uuid"},
        {"name": "object_id", "label": "Object", "type": "uuid"},
        {"name": "condition_rating", "label": "Condition Rating", "type": "select", "options": [
            "excellent", "good", "fair", "poor", "unacceptable"
        ]},
        {"name": "report_date", "label": "Report Date", "type": "date"},
        {"name": "examiner", "label": "Examiner", "type": "string"},
    ],
    "media": [
        {"name": "media_id", "label": "Media ID", "type": "uuid"},
        {"name": "filename", "label": "Filename", "type": "string"},
        {"name": "media_type", "label": "Media Type", "type": "string"},
        {"name": "file_size", "label": "File Size", "type": "number"},
        {"name": "published", "label": "Published", "type": "boolean"},
        {"name": "created_at", "label": "Created At", "type": "datetime"},
    ],
    "exhibitions": [
        {"name": "exhibition_id", "label": "Exhibition ID", "type": "uuid"},
        {"name": "exhibition_name", "label": "Exhibition Name", "type": "string"},
        {"name": "venue_id", "label": "Venue", "type": "uuid"},
        {"name": "start_date", "label": "Start Date", "type": "date"},
        {"name": "end_date", "label": "End Date", "type": "date"},
        {"name": "status", "label": "Status", "type": "string"},
    ],
    "deaccessions": [
        {"name": "deaccession_id", "label": "Deaccession ID", "type": "uuid"},
        {"name": "deaccession_number", "label": "Deaccession Number", "type": "string"},
        {"name": "deaccession_date", "label": "Deaccession Date", "type": "date"},
        {"name": "disposal_method", "label": "Disposal Method", "type": "string"},
        {"name": "disposal_value", "label": "Disposal Value", "type": "number"},
        {"name": "reason", "label": "Reason", "type": "string"},
    ],
    "incidents": [
        {"name": "incident_id", "label": "Incident ID", "type": "uuid"},
        {"name": "incident_number", "label": "Incident Number", "type": "string"},
        {"name": "incident_date", "label": "Incident Date", "type": "date"},
        {"name": "incident_type", "label": "Incident Type", "type": "string"},
        {"name": "severity", "label": "Severity", "type": "string"},
        {"name": "status", "label": "Status", "type": "string"},
    ],
}


# ============================================================================
# TEMPLATE SERVICE FUNCTIONS
# ============================================================================

def get_all_templates() -> list[dict[str, Any]]:
    """Get all available report templates with metadata."""
    templates = []
    for key, template in REPORT_TEMPLATES.items():
        templates.append({
            "template_key": key,
            "name": template["name"],
            "description": template["description"],
            "data_source": template["data_source"],
            "category": template["category"],
            "default_visualization": template["default_visualization"],
            "visualization_options": template.get("visualization_options", ["table"]),
        })
    return templates


def get_template(template_key: str) -> dict[str, Any] | None:
    """Get a specific template by key."""
    template = REPORT_TEMPLATES.get(template_key)
    if template:
        return {
            "template_key": template_key,
            **template,
        }
    return None


def get_templates_by_category(category: str) -> list[dict[str, Any]]:
    """Get all templates in a specific category."""
    templates = []
    for key, template in REPORT_TEMPLATES.items():
        if template.get("category") == category:
            templates.append({
                "template_key": key,
                "name": template["name"],
                "description": template["description"],
                "data_source": template["data_source"],
                "default_visualization": template["default_visualization"],
            })
    return templates


def get_template_categories() -> list[str]:
    """Get all unique template categories."""
    categories = set()
    for template in REPORT_TEMPLATES.values():
        if "category" in template:
            categories.add(template["category"])
    return sorted(list(categories))


def get_data_source_fields(data_source: str) -> list[dict[str, Any]]:
    """Get available fields for a data source."""
    return DATA_SOURCE_FIELDS.get(data_source, [])


def get_all_data_sources() -> list[dict[str, Any]]:
    """Get all available data sources with their fields."""
    sources = []
    for source, fields in DATA_SOURCE_FIELDS.items():
        sources.append({
            "source_key": source,
            "name": source.replace("_", " ").title(),
            "field_count": len(fields),
        })
    return sources
