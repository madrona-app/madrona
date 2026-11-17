"""
Report Data Resolvers.

Resolves data for on-demand reports from three context types:
- search: Replays a search query and fetches matching records
- workspace: Gets items from a workspace (pinned + dynamic)
- record: Fetches a single record with full details
"""
import logging
from typing import Any
from uuid import UUID

from app.database import current_session
from app.services.collections_export import (
    EXPORT_COLUMNS,
    RECORD_TYPE_MODELS,
    fetch_export_data,
)

logger = logging.getLogger(__name__)

# Maximum rows for on-demand report export
MAX_REPORT_ROWS = 10_000


def search_object_ids(context_params: dict[str, Any], org_id: UUID) -> list[UUID]:
    """Replay a saved search and return the matching object IDs (capped)."""
    from app.search.collections.service import get_collections_search_service
    from app.search.collections.schemas import CollectionsSearchRequest

    search_request_data = dict(context_params.get("search_request", {}))

    # Disable facets/highlight for export
    search_request_data["include_facets"] = False
    search_request_data["highlight"] = False

    search_service = get_collections_search_service()
    if not search_service.is_available():
        raise RuntimeError("Search service is unavailable. Please try again later.")

    # Paginate through search results (CollectionsSearchRequest enforces limit <= 100)
    page_size = 100
    offset = 0
    all_ids: list[UUID] = []
    while True:
        search_request_data["limit"] = page_size
        search_request_data["offset"] = offset
        request = CollectionsSearchRequest(**search_request_data)
        response = search_service.search(
            request=request,
            organization_id=org_id,
            db_session=current_session(),
        )
        all_ids.extend(UUID(hit.object_id) for hit in response.hits)
        offset += page_size
        if len(response.hits) < page_size or len(all_ids) >= MAX_REPORT_ROWS or response.total <= offset:
            break

    return all_ids[:MAX_REPORT_ROWS]


def resolve_search(
    context_params: dict[str, Any],
    org_id: UUID,
) -> tuple[list[dict[str, Any]], list[dict[str, str]], dict[str, Any]]:
    """
    Resolve data from a search context.

    Replays the search query via OpenSearch to get object IDs, then
    fetches full export data via collections_export.

    Args:
        context_params: Must contain 'search_request' (CollectionsSearchRequest dict)
                        and 'record_type' (str)
        org_id: Organization UUID

    Returns:
        Tuple of (rows, column_definitions, metadata)
    """
    record_type = context_params.get("record_type", "collection_objects")
    object_ids = search_object_ids(context_params, org_id)

    if not object_ids:
        col_defs = EXPORT_COLUMNS.get(record_type, [])
        return [], col_defs, {"total": 0, "source": "search"}

    # Fetch export data for the matched IDs
    rows, col_defs = _fetch_by_ids(org_id, record_type, object_ids)
    return rows, col_defs, {"total": len(rows), "source": "search"}


def workspace_object_ids(
    context_params: dict[str, Any],
    org_id: UUID,
) -> tuple[list[UUID], dict[str, Any]]:
    """Object IDs in a workspace the triggering user may see.

    Returns (ids, metadata); metadata carries ``error`` when the workspace is
    missing or not visible to the user, else ``workspace_name``.
    """
    from app.models import Workspace, WorkspaceShare
    from app.services.dynamic_workspace import resolve_dynamic_items

    workspace_id = UUID(context_params["workspace_id"])

    workspace = current_session().query(Workspace).filter_by(
        workspace_id=workspace_id,
        organization_id=org_id,
    ).first()

    if not workspace:
        return [], {"error": "workspace_not_found"}

    # Enforce workspace visibility (mirrors _can_access_workspace in workspaces.py)
    user_id_str = context_params.get("_triggered_by_user_id")
    if user_id_str:
        user_id = UUID(user_id_str)
        has_access = (
            workspace.owner_user_id == user_id
            or workspace.visibility == "org"
            or (workspace.visibility == "shared" and current_session().query(WorkspaceShare).filter(
                WorkspaceShare.workspace_id == workspace.workspace_id,
                WorkspaceShare.principal_type == "user",
                WorkspaceShare.principal_id == user_id,
            ).first() is not None)
        )
        if not has_access:
            return [], {"error": "workspace_access_denied"}

    # Get all items from workspace (pinned + dynamic)
    result = resolve_dynamic_items(
        workspace=workspace,
        org_id=org_id,
        db_session=current_session(),
        limit=MAX_REPORT_ROWS,
        offset=0,
    )

    items = result.get("items", [])
    object_ids = [UUID(item["object_id"]) for item in items if item.get("object_id")]
    return object_ids, {"workspace_name": workspace.name}


def resolve_workspace(
    context_params: dict[str, Any],
    org_id: UUID,
) -> tuple[list[dict[str, Any]], list[dict[str, str]], dict[str, Any]]:
    """
    Resolve data from a workspace context.

    Fetches all items from the workspace (pinned + dynamic) and
    exports their data.

    Args:
        context_params: Must contain 'workspace_id' and 'record_type'
        org_id: Organization UUID

    Returns:
        Tuple of (rows, column_definitions, metadata)
    """
    record_type = context_params.get("record_type", "collection_objects")
    object_ids, ws_meta = workspace_object_ids(context_params, org_id)

    if ws_meta.get("error"):
        col_defs = EXPORT_COLUMNS.get(record_type, [])
        return [], col_defs, {"total": 0, "error": ws_meta["error"]}

    if not object_ids:
        col_defs = EXPORT_COLUMNS.get(record_type, [])
        return [], col_defs, {"total": 0, "source": "workspace"}

    rows, col_defs = _fetch_by_ids(org_id, record_type, object_ids)
    return rows, col_defs, {
        "total": len(rows),
        "source": "workspace",
        "workspace_name": ws_meta.get("workspace_name"),
    }


def resolve_record(
    context_params: dict[str, Any],
    org_id: UUID,
) -> tuple[list[dict[str, Any]], list[dict[str, str]], dict[str, Any]]:
    """
    Resolve data for a single record.

    Fetches one record with all its details for document-style reports.

    Args:
        context_params: Must contain 'record_id' and 'record_type'
        org_id: Organization UUID

    Returns:
        Tuple of (rows, column_definitions, metadata)
    """
    record_id = UUID(context_params["record_id"])
    record_type = context_params.get("record_type", "collection_objects")

    model = RECORD_TYPE_MODELS.get(record_type)
    if model is None:
        return [], [], {"total": 0, "error": "unknown_record_type"}

    pk_field = _get_pk_field(record_type)
    record = current_session().query(model).filter(
        model.organization_id == org_id,
        getattr(model, pk_field) == record_id,
    ).first()

    if not record:
        col_defs = EXPORT_COLUMNS.get(record_type, [])
        return [], col_defs, {"total": 0, "error": "record_not_found"}

    # For document reports, return the raw model object in a special format
    # so the document renderer has full access to all fields
    col_defs = EXPORT_COLUMNS.get(record_type, [])

    # Build a comprehensive row from the record (column attrs only, avoids lazy-loads)
    from sqlalchemy import inspect as sa_inspect
    row: dict[str, Any] = {}
    for attr in sa_inspect(record).mapper.column_attrs:
        row[attr.key] = getattr(record, attr.key)

    # Resolve FK names (contacts + users) so document renderers show names, not UUIDs
    _resolve_fk_names_for_record(row, record_type, org_id)

    # Look up organization name for branded headers
    org_name = _get_org_name(org_id)

    return [row], col_defs, {
        "total": 1,
        "source": "record",
        "record": record,  # Pass the raw ORM object for document renderers
        "organization_name": org_name,
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_org_name(org_id: UUID) -> str | None:
    """Look up the organization display name."""
    try:
        from app.models import Organization
        from sqlalchemy import select
        org = current_session().execute(
            select(Organization).where(Organization.organization_id == org_id)
        ).scalars().first()
        return org.name if org else None
    except Exception:
        return None


def _resolve_fk_names_for_record(
    row: dict[str, Any],
    record_type: str,
    org_id: UUID,
) -> None:
    """Resolve FK names in a single record row, mutating it in place.

    Looks up contact and user FKs so document renderers show human-readable
    names instead of raw UUIDs.
    """
    from app.services.collections_export import _CONTACT_FK_FIELDS, _USER_FK_FIELDS
    from sqlalchemy import select
    from app.models import User, Contact

    # Resolve contact FK (e.g. lender_id -> lender_name)
    contact_fk = _CONTACT_FK_FIELDS.get(record_type)
    if contact_fk:
        fk_field, name_field = contact_fk
        cid = row.get(fk_field)
        if cid and (not row.get(name_field)):
            contact = current_session().execute(
                select(Contact).where(
                    Contact.constituent_id == cid,
                    Contact.organization_id == org_id,
                )
            ).scalars().first()
            if contact:
                row[name_field] = (
                    contact.display_name or contact.organization_name
                    or contact.name or ""
                )

    # Resolve user FKs (e.g. examiner_id -> examiner_name)
    user_fk = _USER_FK_FIELDS.get(record_type)
    if user_fk:
        fk_field, name_field = user_fk
        uid = row.get(fk_field)
        if uid and (not row.get(name_field)):
            user = current_session().execute(
                select(User).where(User.user_id == uid)
            ).scalars().first()
            if user:
                row[name_field] = user.display_name or user.email

    # Resolve assigned_to_user_id -> assigned_to_name (common across many types)
    uid = row.get("assigned_to_user_id")
    if uid and not row.get("assigned_to_name"):
        from app.models import User as UserModel
        user = current_session().execute(
            select(UserModel).where(UserModel.user_id == uid)
        ).scalars().first()
        if user:
            row["assigned_to_name"] = user.display_name or user.email


def _get_pk_field(record_type: str) -> str:
    """Get the primary key field name for a record type."""
    pk_map = {
        "collection_objects": "object_id",
        "loans_in": "loan_in_id",
        "loans_out": "loan_out_id",
        "object_entries": "entry_id",
        "object_exits": "exit_id",
        "conservation_treatments": "treatment_id",
        "acquisitions": "acquisition_id",
        "condition_reports": "report_id",
    }
    return pk_map.get(record_type, "object_id")


def _fetch_by_ids(
    org_id: UUID,
    record_type: str,
    object_ids: list[UUID],
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    """Fetch export data for a list of specific record IDs."""
    from app.services.collections_export import (
        _CONTACT_FK_FIELDS,
        _USER_FK_FIELDS,
        _format_value,
    )
    from sqlalchemy import select
    from app.models import User
    from app.models import Contact

    model = RECORD_TYPE_MODELS.get(record_type)
    if model is None:
        return [], []

    col_defs = EXPORT_COLUMNS.get(record_type, [])
    field_names = [c["field"] for c in col_defs]

    pk_field = _get_pk_field(record_type)
    pk_attr = getattr(model, pk_field)

    # Query records by IDs
    records = current_session().execute(
        select(model).where(
            model.organization_id == org_id,
            pk_attr.in_(object_ids),
        )
    ).scalars().all()

    if not records:
        return [], col_defs

    # Resolve FK names (same pattern as collections_export)
    user_ids = set()
    contact_ids = set()
    contact_fk = _CONTACT_FK_FIELDS.get(record_type)
    contact_fk_field = contact_fk[0] if contact_fk else None
    user_fk = _USER_FK_FIELDS.get(record_type)
    user_fk_field = user_fk[0] if user_fk else None

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

    users_by_id: dict[UUID, str] = {}
    if user_ids:
        users = current_session().execute(
            select(User).where(User.user_id.in_(user_ids))
        ).scalars().all()
        users_by_id = {u.user_id: u.display_name or u.email for u in users}

    contacts_by_id: dict[UUID, str] = {}
    if contact_ids:
        contacts = current_session().execute(
            select(Contact).where(
                Contact.constituent_id.in_(contact_ids),
                Contact.organization_id == org_id,
            )
        ).scalars().all()
        contacts_by_id = {
            c.constituent_id: c.display_name or c.organization_name or c.name or ""
            for c in contacts
        }

    # Build rows
    rows = []
    for record in records:
        row: dict[str, Any] = {}
        for field in field_names:
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
                if not row[field] and hasattr(record, field):
                    row[field] = _format_value(getattr(record, field))
            elif hasattr(record, field):
                row[field] = _format_value(getattr(record, field))
            else:
                row[field] = ""
        rows.append(row)

    return rows, col_defs
