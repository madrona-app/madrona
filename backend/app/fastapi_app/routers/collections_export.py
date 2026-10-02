"""
Collections Export API (FastAPI).

Endpoints for bulk export of collection records to CSV or Excel format.
Migrated from app/api/collections_export.py.
"""

import logging
from datetime import datetime
from io import BytesIO
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.permissions import Permission
from app.services.collections_export import (
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


class ExportBody(BaseModel):
    record_type: str
    format: str = "csv"
    columns: list[dict[str, str]] | None = None
    filters: dict | None = None
    sort: str | None = None


@router.post("/api/organizations/{org_id}/collections/export", summary="Export collections")
def export_collections(
    org_id: UUID,
    body: ExportBody,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Export collection records to CSV or Excel."""
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

    rows, col_defs = fetch_export_data(
        org_id=org_id,
        record_type=body.record_type,
        columns=body.columns,
        filters=body.filters,
        sort=body.sort,
        user_id=auth.user_id,
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
