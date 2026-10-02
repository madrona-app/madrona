"""
Collections Export Service.

Provides column definitions and data fetching for bulk export of collection records.
Supports CSV and Excel formats for all major procedure record types.
"""
import logging
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import current_session
from app.models import (
    User,
    Acquisition,
    CollectionObject,
    ConditionReport,
    ConservationTreatment,
    Contact,
    LoanIn,
    LoanOut,
    ObjectEntry,
    ObjectExit,
)
from app.models.locations import Location, Movement

logger = logging.getLogger(__name__)

# Maximum rows for synchronous export (prevents memory/timeout issues)
MAX_EXPORT_ROWS = 10_000


# ============================================================================
# COLUMN DEFINITIONS PER RECORD TYPE
# ============================================================================

EXPORT_COLUMNS: dict[str, list[dict[str, str]]] = {
    "collection_objects": [
        {"field": "object_number", "label": "Object Number"},
        {"field": "object_name", "label": "Object Name"},
        {"field": "object_type", "label": "Object Type"},
        {"field": "category", "label": "Category"},
        {"field": "brief_description", "label": "Brief Description"},
        {"field": "creation_date_display", "label": "Date"},
        {"field": "creation_place", "label": "Place of Creation"},
        {"field": "department_name", "label": "Department"},
        {"field": "catalog_level", "label": "Catalog Level"},
        {"field": "number_of_objects", "label": "Number of Objects"},
        {"field": "color", "label": "Color"},
        {"field": "form", "label": "Form"},
        {"field": "edition", "label": "Edition"},
        {"field": "copy_number", "label": "Copy Number"},
        {"field": "provenance", "label": "Provenance"},
        {"field": "comments", "label": "Comments"},
        {"field": "created_at", "label": "Created"},
        {"field": "updated_at", "label": "Updated"},
    ],
    "loans_in": [
        {"field": "loan_number", "label": "Loan Number"},
        {"field": "lender_name", "label": "Lender"},
        {"field": "loan_purpose", "label": "Purpose"},
        {"field": "exhibition_name", "label": "Exhibition"},
        {"field": "status", "label": "Status"},
        {"field": "request_date", "label": "Request Date"},
        {"field": "approval_date", "label": "Approval Date"},
        {"field": "loan_start_date", "label": "Start Date"},
        {"field": "loan_end_date", "label": "End Date"},
        {"field": "actual_receipt_date", "label": "Received"},
        {"field": "actual_return_date", "label": "Returned"},
        {"field": "insurance_value", "label": "Insurance Value"},
        {"field": "insurance_currency", "label": "Currency"},
        {"field": "shipping_method", "label": "Shipping Method"},
        {"field": "assigned_to_name", "label": "Assigned To"},
        {"field": "loan_note", "label": "Notes"},
        {"field": "created_at", "label": "Created"},
    ],
    "loans_out": [
        {"field": "loan_number", "label": "Loan Number"},
        {"field": "borrower_name", "label": "Borrower"},
        {"field": "loan_purpose", "label": "Purpose"},
        {"field": "exhibition_title", "label": "Exhibition"},
        {"field": "status", "label": "Status"},
        {"field": "request_date", "label": "Request Date"},
        {"field": "approval_date", "label": "Approval Date"},
        {"field": "loan_start_date", "label": "Start Date"},
        {"field": "loan_end_date", "label": "End Date"},
        {"field": "actual_dispatch_date", "label": "Dispatched"},
        {"field": "actual_return_date", "label": "Returned"},
        {"field": "insurance_value_total", "label": "Insurance Value"},
        {"field": "insurance_currency", "label": "Currency"},
        {"field": "shipping_method", "label": "Shipping Method"},
        {"field": "assigned_to_name", "label": "Assigned To"},
        {"field": "loan_note", "label": "Notes"},
        {"field": "created_at", "label": "Created"},
    ],
    "object_entries": [
        {"field": "entry_number", "label": "Entry Number"},
        {"field": "depositor_name", "label": "Depositor"},
        {"field": "entry_date", "label": "Entry Date"},
        {"field": "entry_reason", "label": "Reason"},
        {"field": "status", "label": "Status"},
        {"field": "objects_description", "label": "Description"},
        {"field": "objects_count", "label": "Object Count"},
        {"field": "current_owner", "label": "Current Owner"},
        {"field": "insurance_value", "label": "Insurance Value"},
        {"field": "insurance_currency", "label": "Currency"},
        {"field": "expected_return_date", "label": "Expected Return"},
        {"field": "return_date", "label": "Returned"},
        {"field": "outcome", "label": "Outcome"},
        {"field": "assigned_to_name", "label": "Assigned To"},
        {"field": "entry_note", "label": "Notes"},
        {"field": "created_at", "label": "Created"},
    ],
    "object_exits": [
        {"field": "exit_number", "label": "Exit Number"},
        {"field": "recipient_name", "label": "Recipient"},
        {"field": "exit_date", "label": "Exit Date"},
        {"field": "exit_reason", "label": "Reason"},
        {"field": "status", "label": "Status"},
        {"field": "exit_method", "label": "Exit Method"},
        {"field": "shipping_method", "label": "Shipping Method"},
        {"field": "shipping_company", "label": "Shipping Company"},
        {"field": "tracking_number", "label": "Tracking Number"},
        {"field": "insurance_value", "label": "Insurance Value"},
        {"field": "insurance_currency", "label": "Currency"},
        {"field": "condition_at_exit", "label": "Condition at Exit"},
        {"field": "assigned_to_name", "label": "Assigned To"},
        {"field": "exit_note", "label": "Notes"},
        {"field": "created_at", "label": "Created"},
    ],
    "conservation_treatments": [
        {"field": "treatment_number", "label": "Treatment Number"},
        {"field": "treatment_type", "label": "Type"},
        {"field": "conservator_name", "label": "Conservator"},
        {"field": "conservator_institution", "label": "Institution"},
        {"field": "status", "label": "Status"},
        {"field": "proposal_date", "label": "Proposal Date"},
        {"field": "start_date", "label": "Start Date"},
        {"field": "end_date", "label": "End Date"},
        {"field": "estimated_cost", "label": "Estimated Cost"},
        {"field": "actual_cost", "label": "Actual Cost"},
        {"field": "estimated_cost_currency", "label": "Currency"},
        {"field": "treatment_description", "label": "Description"},
        {"field": "recommendations", "label": "Recommendations"},
        {"field": "assigned_to_name", "label": "Assigned To"},
        {"field": "treatment_note", "label": "Notes"},
        {"field": "created_at", "label": "Created"},
    ],
    "acquisitions": [
        {"field": "acquisition_number", "label": "Acquisition Number"},
        {"field": "acquisition_method", "label": "Method"},
        {"field": "acquisition_date", "label": "Acquisition Date"},
        {"field": "source_name", "label": "Source"},
        {"field": "source_type", "label": "Source Type"},
        {"field": "status", "label": "Status"},
        {"field": "accession_number", "label": "Accession Number"},
        {"field": "accession_date", "label": "Accession Date"},
        {"field": "cost", "label": "Cost"},
        {"field": "cost_currency", "label": "Currency"},
        {"field": "funding_source", "label": "Funding Source"},
        {"field": "credit_line", "label": "Credit Line"},
        {"field": "legal_status", "label": "Legal Status"},
        {"field": "objects_count", "label": "Object Count"},
        {"field": "assigned_to_name", "label": "Assigned To"},
        {"field": "acquisition_note", "label": "Notes"},
        {"field": "created_at", "label": "Created"},
    ],
    "condition_reports": [
        {"field": "report_number", "label": "Report Number"},
        {"field": "report_type", "label": "Report Type"},
        {"field": "report_date", "label": "Report Date"},
        {"field": "overall_condition", "label": "Condition"},
        {"field": "examiner_name", "label": "Examiner"},
        {"field": "examiner_institution", "label": "Institution"},
        {"field": "examination_method", "label": "Method"},
        {"field": "examination_place", "label": "Place"},
        {"field": "condition_summary", "label": "Summary"},
        {"field": "conservation_needed", "label": "Conservation Needed"},
        {"field": "conservation_priority", "label": "Priority"},
        {"field": "recommendations", "label": "Recommendations"},
        {"field": "status", "label": "Status"},
        {"field": "completed_date", "label": "Completed"},
        {"field": "report_note", "label": "Notes"},
        {"field": "created_at", "label": "Created"},
    ],
    "locations": [
        {"field": "code", "label": "Code"},
        {"field": "name", "label": "Name"},
        {"field": "location_type", "label": "Type"},
        {"field": "path", "label": "Path"},
        {"field": "status", "label": "Status"},
        {"field": "capacity", "label": "Capacity"},
        {"field": "current_count", "label": "Current Count"},
        {"field": "climate_controlled", "label": "Climate Controlled"},
        {"field": "security_level", "label": "Security Level"},
        {"field": "condition", "label": "Condition"},
        {"field": "on_display", "label": "On Display"},
        {"field": "description", "label": "Description"},
        {"field": "created_at", "label": "Created"},
    ],
    "movements": [
        {"field": "movement_reference_number", "label": "Reference"},
        {"field": "object_number", "label": "Object Number"},
        {"field": "from_location_name", "label": "From Location"},
        {"field": "to_location_name", "label": "To Location"},
        {"field": "movement_date", "label": "Date"},
        {"field": "reason", "label": "Reason"},
        {"field": "status", "label": "Status"},
        {"field": "movement_method", "label": "Method"},
        {"field": "handler_name", "label": "Handler"},
        {"field": "moved_by_name", "label": "Moved By"},
        {"field": "authorized_by_name", "label": "Authorized By"},
        {"field": "condition_note", "label": "Condition Note"},
        {"field": "movement_note", "label": "Notes"},
        {"field": "created_at", "label": "Created"},
    ],
}

# Model mapping for each record type
RECORD_TYPE_MODELS: dict[str, type] = {
    "collection_objects": CollectionObject,
    "loans_in": LoanIn,
    "loans_out": LoanOut,
    "object_entries": ObjectEntry,
    "object_exits": ObjectExit,
    "conservation_treatments": ConservationTreatment,
    "acquisitions": Acquisition,
    "condition_reports": ConditionReport,
    "locations": Location,
    "movements": Movement,
}

# FK fields that need name resolution from Contact table
_CONTACT_FK_FIELDS = {
    "loans_in": ("lender_id", "lender_name"),
    "loans_out": ("borrower_id", "borrower_name"),
    "object_entries": ("depositor_id", "depositor_name"),
    "object_exits": ("recipient_id", "recipient_name"),
    "acquisitions": ("source_id", "source_name"),
    "conservation_treatments": ("conservator_id", "conservator_name"),
    "movements": ("handler_id", "handler_name"),
    # examiner is now a constituent reference (was users) — resolve via Contact.
    "condition_reports": ("examiner_id", "examiner_name"),
}

# FK fields that need name resolution from User table (not Contact)
_USER_FK_FIELDS = {
    "movements": ("authorized_by", "authorized_by_name"),
}

# FK fields that resolve location names from Location table
_LOCATION_FK_FIELDS = {
    "movements": [("from_location_id", "from_location_name"), ("to_location_id", "to_location_name")],
}

# FK field that resolves object number from CollectionObject table
_OBJECT_FK_FIELDS = {
    "movements": ("object_id", "object_number"),
}

# Maps export record_type keys to field_access_service entity_type keys
_RECORD_TYPE_TO_ENTITY: dict[str, str] = {
    "collection_objects": "collection_object",
    "loans_in": "loan_in",
    "loans_out": "loan_out",
    "object_entries": "object_entry",
    "object_exits": "object_exit",
    "conservation_treatments": "conservation_treatment",
    "acquisitions": "acquisition",
    "condition_reports": "condition_report",
    "locations": "location",
    "movements": "movement",
}

# Default sort field per record type
_DEFAULT_SORT = {
    "collection_objects": "object_number",
    "loans_in": "loan_number",
    "loans_out": "loan_number",
    "object_entries": "entry_number",
    "object_exits": "exit_number",
    "conservation_treatments": "treatment_number",
    "acquisitions": "acquisition_number",
    "condition_reports": "report_number",
    "locations": "code",
    "movements": "-movement_date",
}


# ============================================================================
# DATA FETCHING
# ============================================================================

def _format_value(value: Any) -> Any:
    """Format a value for export (returns native types for dict building)."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, (dict, list)):
        return str(value)
    return value


def fetch_export_data(
    org_id: UUID,
    record_type: str,
    columns: list[dict[str, str]] | None = None,
    filters: dict[str, Any] | None = None,
    sort: str | None = None,
    limit: int = MAX_EXPORT_ROWS,
    user_id: UUID | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    """
    Fetch and format data for export.

    Args:
        org_id: Organization UUID
        record_type: One of the RECORD_TYPE_MODELS keys
        columns: Optional column subset (uses defaults if None)
        filters: Optional dict of {field: value} for simple equality filters
        sort: Optional sort field (prefix with - for descending)
        limit: Maximum rows to return
        user_id: Requesting user UUID (for field-level access filtering)

    Returns:
        Tuple of (rows as flat dicts, column definitions)
    """
    model = RECORD_TYPE_MODELS.get(record_type)
    if model is None:
        raise ValueError(f"Unknown record type: {record_type}")

    # Determine columns — always constrain to the allowlisted defaults
    allowed_columns = EXPORT_COLUMNS.get(record_type, [])
    allowed_field_set = {c["field"] for c in allowed_columns}

    if columns:
        # Only permit columns that appear in the default export allowlist
        col_defs = [c for c in columns if c.get("field") in allowed_field_set]
    else:
        col_defs = allowed_columns

    # Apply field-level access control: strip columns the user cannot read
    if user_id:
        try:
            from app.services.field_access_service import get_restricted_fields
            restricted = get_restricted_fields(
                current_session(), org_id, user_id, _RECORD_TYPE_TO_ENTITY.get(record_type, record_type)
            )
            if restricted:
                col_defs = [c for c in col_defs if c["field"] not in restricted]
        except Exception:
            logger.warning("field_access check failed for export; proceeding with default columns", exc_info=True)

    field_names = [c["field"] for c in col_defs]

    # Build query
    session = current_session()
    query = select(model).where(model.organization_id == org_id)

    # Apply simple equality filters (only on allowed columns)
    if filters:
        for field_name, value in filters.items():
            if field_name in allowed_field_set and hasattr(model, field_name) and value is not None:
                query = query.where(getattr(model, field_name) == value)

    # Apply sort
    sort_field = sort or _DEFAULT_SORT.get(record_type, "created_at")
    descending = False
    if sort_field.startswith("-"):
        sort_field = sort_field[1:]
        descending = True

    if hasattr(model, sort_field):
        col = getattr(model, sort_field)
        query = query.order_by(col.desc() if descending else col.asc())

    # Apply limit
    query = query.limit(min(limit, MAX_EXPORT_ROWS))

    # Execute
    records = session.execute(query).scalars().all()

    if not records:
        return [], col_defs

    # Resolve FK names: assigned_to_user_id → assigned_to_name
    user_ids = set()
    contact_ids = set()
    location_ids = set()
    object_ids = set()

    contact_fk = _CONTACT_FK_FIELDS.get(record_type)
    contact_fk_field = contact_fk[0] if contact_fk else None
    user_fk = _USER_FK_FIELDS.get(record_type)
    user_fk_field = user_fk[0] if user_fk else None
    location_fks = _LOCATION_FK_FIELDS.get(record_type, [])
    object_fk = _OBJECT_FK_FIELDS.get(record_type)

    for record in records:
        if hasattr(record, "assigned_to_user_id") and record.assigned_to_user_id:
            user_ids.add(record.assigned_to_user_id)
        if user_fk_field and hasattr(record, user_fk_field):
            uid = getattr(record, user_fk_field)
            if uid:
                user_ids.add(uid)
        if contact_fk_field and hasattr(record, contact_fk_field):
            cid = getattr(record, contact_fk_field)
            if cid:
                contact_ids.add(cid)
        for fk_field, _ in location_fks:
            if hasattr(record, fk_field):
                lid = getattr(record, fk_field)
                if lid:
                    location_ids.add(lid)
        if object_fk and hasattr(record, object_fk[0]):
            oid = getattr(record, object_fk[0])
            if oid:
                object_ids.add(oid)

    # Batch-fetch user names
    users_by_id: dict[UUID, str] = {}
    if user_ids:
        users = session.execute(
            select(User).where(User.user_id.in_(user_ids))
        ).scalars().all()
        users_by_id = {
            u.user_id: u.display_name or u.email for u in users
        }

    # Batch-fetch contact names
    contacts_by_id: dict[UUID, str] = {}
    if contact_ids:
        contacts = session.execute(
            select(Contact).where(
                Contact.constituent_id.in_(contact_ids),
                Contact.organization_id == org_id,
            )
        ).scalars().all()
        contacts_by_id = {
            c.constituent_id: c.display_name or c.organization_name or c.name or ""
            for c in contacts
        }

    # Batch-fetch location names
    locations_by_id: dict[UUID, str] = {}
    if location_ids:
        locs = session.execute(
            select(Location).where(
                Location.location_id.in_(location_ids),
                Location.organization_id == org_id,
            )
        ).scalars().all()
        locations_by_id = {loc.location_id: loc.name or loc.code or "" for loc in locs}

    # Batch-fetch object numbers
    objects_by_id: dict[UUID, str] = {}
    if object_ids:
        objs = session.execute(
            select(CollectionObject).where(
                CollectionObject.object_id.in_(object_ids),
                CollectionObject.organization_id == org_id,
            )
        ).scalars().all()
        objects_by_id = {o.object_id: o.object_number or "" for o in objs}

    # Build lookup for location FK virtual field names
    _location_fk_map: dict[str, str] = {}  # virtual_name -> fk_field
    for fk_field, virtual_name in location_fks:
        _location_fk_map[virtual_name] = fk_field

    # Build flat rows
    rows = []
    for record in records:
        row: dict[str, Any] = {}
        for field in field_names:
            # Virtual fields resolved from FKs
            if field == "assigned_to_name":
                uid = getattr(record, "assigned_to_user_id", None)
                row[field] = users_by_id.get(uid, "") if uid else ""
            elif user_fk and field == user_fk[1]:
                uid = getattr(record, user_fk[0], None)
                row[field] = users_by_id.get(uid, "") if uid else ""
                if not row[field] and hasattr(record, field):
                    row[field] = _format_value(getattr(record, field))
            elif contact_fk and field == contact_fk[1]:
                cid = getattr(record, contact_fk[0], None)
                row[field] = contacts_by_id.get(cid, "") if cid else ""
                # Also fall back to *_name field on model if contact not found
                if not row[field] and hasattr(record, field):
                    row[field] = _format_value(getattr(record, field))
            elif field in _location_fk_map:
                lid = getattr(record, _location_fk_map[field], None)
                row[field] = locations_by_id.get(lid, "") if lid else ""
            elif object_fk and field == object_fk[1]:
                oid = getattr(record, object_fk[0], None)
                row[field] = objects_by_id.get(oid, "") if oid else ""
            elif hasattr(record, field):
                row[field] = _format_value(getattr(record, field))
            else:
                row[field] = ""
        rows.append(row)

    return rows, col_defs


def get_available_columns(record_type: str) -> list[dict[str, str]]:
    """Get available export columns for a record type."""
    columns = EXPORT_COLUMNS.get(record_type)
    if columns is None:
        raise ValueError(f"Unknown record type: {record_type}")
    return columns


def get_supported_record_types() -> list[dict[str, str]]:
    """Get list of supported record types for export."""
    return [
        {"key": "collection_objects", "label": "Collection Objects"},
        {"key": "loans_in", "label": "Incoming Loans"},
        {"key": "loans_out", "label": "Outgoing Loans"},
        {"key": "object_entries", "label": "Object Entries"},
        {"key": "object_exits", "label": "Object Exits"},
        {"key": "conservation_treatments", "label": "Conservation Treatments"},
        {"key": "acquisitions", "label": "Acquisitions"},
        {"key": "condition_reports", "label": "Condition Reports"},
        {"key": "locations", "label": "Locations"},
        {"key": "movements", "label": "Movements"},
    ]
