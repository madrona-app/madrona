"""
Collections Export API (FastAPI).

Endpoints for bulk export of collection records to CSV or Excel format.
Migrated from app/api/collections_export.py.
"""

import logging
from datetime import datetime
from io import BytesIO
from uuid import UUID

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.permissions import Permission
from app.services.collections_export import (
    MAX_EXPORT_ROWS,
    fetch_export_data,
    get_available_columns,
    get_supported_record_types,
)
from app.services.report_export import export_to_csv, export_to_excel
from app.fastapi_app.schemas.collections_export import (
    ExportColumnsResponse,
    ExportRecordTypesResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["collections-export"])


class ObjectExportScope(BaseModel):
    """Which collection objects to export, for staff list/search exports.

    At most one of these may be set; none means "every object" (subject to
    ``filters``):

    - ``object_ids``: an explicit selection.
    - ``workspace_id``: the objects in a collections work set the user can view.
    - ``search``: the current list search — ``query`` / ``filters`` /
      ``advanced_criteria`` / ``advanced_operator`` exactly as sent to
      ``POST /collections/search`` — resolved to the matching objects.
    """

    object_ids: list[UUID] | None = Field(None, max_length=MAX_EXPORT_ROWS)
    workspace_id: UUID | None = None
    search: dict[str, Any] | None = None


class ExportBody(ObjectExportScope):
    record_type: str
    format: str = "csv"
    columns: list[dict[str, str]] | None = None
    filters: dict | None = None
    sort: str | None = None


_SEARCH_SCOPE_KEYS = {"query", "filters", "advanced_criteria", "advanced_operator", "expand_vocabulary"}


def resolve_object_scope(
    db: Session,
    auth: AuthContext,
    org_id: UUID,
    scope: ObjectExportScope,
) -> list[UUID] | None:
    """Resolve an export scope to object IDs (None = no restriction).

    Raises 400 when more than one scope is given, 404/403 for a work set the
    user cannot see, and 503 when a search scope is requested but search is
    unavailable (exporting everything instead would be silently wrong).
    """
    given = [n for n in ("object_ids", "workspace_id", "search") if getattr(scope, n) is not None]
    if len(given) > 1:
        raise HTTPException(
            status_code=400,
            detail="Give only one of object_ids, workspace_id or search",
        )
    if not given:
        return None

    if scope.object_ids is not None:
        return list(dict.fromkeys(scope.object_ids))

    if scope.workspace_id is not None:
        from app.fastapi_app.routers.workspaces import _can_access_workspace
        from app.models.workspaces import Workspace, WorkspaceItem
        from app.services.rbac_service import check_permission, is_platform_admin

        if not is_platform_admin(auth.user_id, session=db) and not check_permission(
            str(auth.user_id), str(org_id), Permission.WORKSPACES_VIEW, session=db
        ):
            raise HTTPException(status_code=403, detail="Permission denied to view work sets")
        workspace = db.query(Workspace).filter(
            Workspace.workspace_id == scope.workspace_id,
            Workspace.organization_id == org_id,
            Workspace.workspace_type == "collections",
            Workspace.is_deleted == False,  # noqa: E712
        ).first()
        if not workspace or not _can_access_workspace(db, workspace, auth.user_id, org_id):
            raise HTTPException(status_code=404, detail="Work set not found")
        rows = db.query(WorkspaceItem.object_id).filter(
            WorkspaceItem.workspace_id == workspace.workspace_id,
        ).limit(MAX_EXPORT_ROWS).all()
        return [r[0] for r in rows]

    # Search scope
    from app.search.collections.schemas import CollectionsSearchRequest
    from app.search.collections.service import (
        CollectionsSearchService,
        get_collections_search_service,
    )

    unknown = set(scope.search or {}) - _SEARCH_SCOPE_KEYS - {"limit", "offset", "sort", "include_facets", "highlight", "facet_size"}
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unsupported search keys: {', '.join(sorted(unknown))}")
    if not CollectionsSearchService.is_available():
        raise HTTPException(status_code=503, detail={
            "code": "SEARCH_UNAVAILABLE",
            "message": "Search service is not available, so the current search cannot be exported",
        })
    params = {k: v for k, v in (scope.search or {}).items() if k in _SEARCH_SCOPE_KEYS}
    try:
        request = CollectionsSearchRequest(**params)
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=f"Invalid search: {e.errors()[0].get('msg', 'invalid')}")
    ids = get_collections_search_service().matching_object_ids(
        request, org_id, db_session=db, max_ids=MAX_EXPORT_ROWS,
    )
    out: list[UUID] = []
    for raw in ids:
        try:
            out.append(UUID(str(raw)))
        except ValueError:
            continue
    return out


@router.post("/api/organizations/{org_id}/collections/export", summary="Export collections")
def export_collections(
    org_id: UUID,
    body: ExportBody,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Export collection records to CSV or Excel.

    For ``record_type=collection_objects`` the export can be limited to a
    selection, a work set, or the current search (see ``ObjectExportScope``).
    """
    export_format = body.format.lower()
    if export_format not in ("csv", "excel"):
        raise HTTPException(status_code=400, detail="format must be 'csv' or 'excel'")

    # record_type was unvalidated, so an unknown one reached fetch_export_data
    # and surfaced its ValueError as a 500. Client error, client status.
    supported = {rt["key"] for rt in get_supported_record_types()}
    if body.record_type not in supported:
        raise HTTPException(
            status_code=400,
            detail=f"record_type must be one of: {', '.join(sorted(supported))}",
        )

    # Rights records carry their own view permission on top of collections view.
    if body.record_type == "object_rights":
        from app.fastapi_app.dependencies.auth import check_permission_for_session
        if not check_permission_for_session(db, auth.user_id, org_id, Permission.RIGHTS_VIEW):
            raise HTTPException(status_code=403, detail="Exporting rights requires rights.view")

    has_scope = any(
        getattr(body, n) is not None for n in ("object_ids", "workspace_id", "search")
    )
    if has_scope and body.record_type != "collection_objects":
        raise HTTPException(
            status_code=400,
            detail="object_ids, workspace_id and search apply only to collection_objects",
        )
    ids = resolve_object_scope(db, auth, org_id, body)

    rows, col_defs = fetch_export_data(
        org_id=org_id,
        record_type=body.record_type,
        columns=body.columns,
        filters=body.filters,
        sort=body.sort,
        user_id=auth.user_id,
        ids=ids,
    )

    type_labels = {rt["key"]: rt["label"] for rt in get_supported_record_types()}
    report_name = type_labels.get(body.record_type, body.record_type.replace("_", " ").title())
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_name = body.record_type.replace(" ", "_")

    if export_format == "csv":
        content = export_to_csv(rows, col_defs)
        filename = f"{safe_name}_{timestamp}.csv"
        return Response(
            content=content,
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    else:
        content = export_to_excel(rows, col_defs, report_name=report_name)
        filename = f"{safe_name}_{timestamp}.xlsx"
        return Response(
            content=content,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )


@router.get("/api/organizations/{org_id}/collections/export/columns", response_model=ExportColumnsResponse, summary="Get export columns")
def get_export_columns(
    org_id: UUID,
    record_type: str = Query(..., description="Record type to get columns for"),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get available export columns for a record type."""
    columns = get_available_columns(record_type)
    return {
        "record_type": record_type,
        "columns": columns,
    }


@router.get("/api/organizations/{org_id}/collections/export/record-types", response_model=ExportRecordTypesResponse, summary="List export record types")
def list_export_record_types(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get list of supported record types for export."""
    return {
        "record_types": get_supported_record_types(),
    }
