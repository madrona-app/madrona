"""
Miscellaneous Reports & Docs API endpoints (FastAPI).

Combined from:
- app/api/on_demand_reports.py — 7 routes (on-demand report generation)
- app/api/report_templates.py — 5 routes (HTML template upload/download)
- app/api/reports.py — 3 routes (dashboard metrics)
- app/api/docs.py — 6 routes (page documentation)

Total: 21 routes.
"""

import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, File
from fastapi.responses import JSONResponse, Response
from sqlalchemy import and_, case, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.models import (
    OrgScopedDoc,
    OrganizationMembership,
    ReportRun,
    Run,
    Dataset,
    Pipeline,
    EntityCurrent,
)
from app.permissions import Permission
from app.fastapi_app.schemas.reports_misc import (
    AvailableReportsResponse,
    GenerateReportResponse,
    OnDemandRunOut,
    OnDemandRunListResponse,
    DownloadUrlResponse,
    ReportTemplateListResponse,
    ReportTemplateUploadedResponse,
    DeleteReportTemplateResponse,
    DashboardSummaryResponse,
    DailyRunsResponse,
    DatasetsSummaryResponse,
    PageKeysResponse,
    DocListResponse,
    DocResponse,
    DocDeleteResponse,
)
from app.fastapi_app.schemas.common import SuccessResponse, MessageResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["reports-misc"])


# ============================================================================
# ON-DEMAND REPORTS
# ============================================================================


def _serialize_run(run) -> dict:
    return {
        "run_id": str(run.run_id),
        "report_key": run.report_key,
        "context_type": run.context_type,
        "status": run.status,
        "triggered_by": run.triggered_by,
        "export_format": run.export_format,
        "row_count": run.row_count,
        "execution_time_ms": run.execution_time_ms,
        "error_message": run.error_message,
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "completed_at": run.completed_at.isoformat() if run.completed_at else None,
        "created_at": run.created_at.isoformat() if run.created_at else None,
        "has_download": bool(run.export_s3_key and run.status == "completed"),
    }


@router.get("/api/organizations/{org_id}/on-demand-reports/available", response_model=AvailableReportsResponse, summary="List available reports")
def list_available_reports(
    org_id: UUID,
    context_type: str = Query(None),
    record_type: str = Query(None),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """List available reports."""
    from app.services.report_registry import get_registry
    import app.services.report_definitions  # noqa: F401

    if not context_type:
        raise HTTPException(status_code=400, detail="context_type is required")

    if context_type not in ("search", "workspace", "record", "global"):
        raise HTTPException(
            status_code=400,
            detail="context_type must be search, workspace, record, or global",
        )

    registry = get_registry()
    definitions = registry.list_for_context(
        context_type=context_type,
        record_type=record_type,
        organization_id=str(org_id),
    )

    return {
        "reports": [
            {
                "report_key": d.report_key,
                "name": d.name,
                "description": d.description,
                "category": d.category,
                "style": d.style,
                "supported_formats": d.supported_formats,
                "default_format": d.default_format,
            }
            for d in definitions
        ],
        "total": len(definitions),
    }


@router.post("/api/organizations/{org_id}/on-demand-reports/generate", response_model=GenerateReportResponse, status_code=202, summary="Generate report")
def generate_report(
    org_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Generate report."""
    from app.services.report_registry import get_registry
    from app.tasks.reports import generate_on_demand_report_task
    import app.services.report_definitions  # noqa: F401

    report_key = body.get("report_key")
    context_type = body.get("context_type")
    context_params = body.get("context_params", {})
    export_format = body.get("export_format")

    if not report_key:
        raise HTTPException(status_code=400, detail="report_key is required")

    if not context_type or context_type not in ("search", "workspace", "record", "global"):
        raise HTTPException(
            status_code=400,
            detail="context_type must be search, workspace, record, or global",
        )

    registry = get_registry()
    definition = registry.get(report_key)
    if not definition:
        raise HTTPException(status_code=404, detail=f"Report '{report_key}' not found")

    if context_type not in definition.context_types:
        raise HTTPException(
            status_code=400,
            detail=f"Report does not support '{context_type}' context",
        )

    required_fields = {
        "search": ["search_request", "record_type"],
        "workspace": ["workspace_id", "record_type"],
        "record": ["record_id", "record_type"],
        "global": [],
    }
    missing = [f for f in required_fields.get(context_type, []) if f not in context_params]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"context_params missing required fields: {', '.join(missing)}",
        )

    _uuid_context_fields = {"workspace": ["workspace_id"], "record": ["record_id"]}
    for field in _uuid_context_fields.get(context_type, []):
        try:
            UUID(str(context_params[field]))
        except (ValueError, AttributeError):
            raise HTTPException(
                status_code=400,
                detail=f"context_params.{field} must be a valid UUID",
            )

    if export_format and export_format not in definition.supported_formats:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported format. Choose from: {definition.supported_formats}",
        )

    if not export_format:
        export_format = definition.default_format

    run = ReportRun(
        organization_id=org_id,
        status="pending",
        triggered_by="on_demand",
        report_key=report_key,
        context_type=context_type,
        context_params=context_params,
        export_format=export_format,
        triggered_by_user_id=auth.user_id,
    )
    db.add(run)
    db.commit()

    generate_on_demand_report_task.delay(
        run_id=str(run.run_id),
        organization_id=str(org_id),
    )

    return {
        "run_id": str(run.run_id),
        "status": "pending",
        "report_key": report_key,
        "export_format": export_format,
    }


@router.get("/api/organizations/{org_id}/on-demand-reports/runs", response_model=OnDemandRunListResponse, summary="List report runs")
def list_report_runs(
    org_id: UUID,
    status: str = Query(None),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """List report runs."""
    ALLOWED_STATUSES = {"pending", "running", "completed", "failed", "cancelled"}
    if status and status not in ALLOWED_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status. Must be one of: {', '.join(sorted(ALLOWED_STATUSES))}",
        )

    cutoff = datetime.now(timezone.utc) - timedelta(days=7)

    from sqlalchemy import or_
    query = db.query(ReportRun).filter(
        ReportRun.organization_id == org_id,
        ReportRun.triggered_by == "on_demand",
        ReportRun.triggered_by_user_id == auth.user_id,
        ReportRun.dismissed_at.is_(None),
        or_(
            ReportRun.status.in_(("pending", "running")),
            ReportRun.created_at >= cutoff,
        ),
    )

    if status:
        query = query.filter(ReportRun.status == status)

    total = query.count()
    runs = query.order_by(ReportRun.created_at.desc()).offset(offset).limit(limit).all()

    return {
        "items": [_serialize_run(r) for r in runs],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/api/organizations/{org_id}/on-demand-reports/runs/{run_id}", response_model=OnDemandRunOut, summary="Get report run")
def get_report_run(
    org_id: UUID,
    run_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get report run."""
    run = db.query(ReportRun).filter_by(
        run_id=run_id,
        organization_id=org_id,
        triggered_by_user_id=auth.user_id,
    ).first()

    if not run:
        raise HTTPException(status_code=404, detail="Report run not found")

    return _serialize_run(run)


@router.post("/api/organizations/{org_id}/on-demand-reports/runs/{run_id}/cancel", response_model=OnDemandRunOut, summary="Cancel report run")
def cancel_report_run(
    org_id: UUID,
    run_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Cancel report run."""
    run = db.query(ReportRun).filter_by(
        run_id=run_id,
        organization_id=org_id,
        triggered_by_user_id=auth.user_id,
    ).first()

    if not run:
        raise HTTPException(status_code=404, detail="Report run not found")

    if run.status not in ("pending", "running"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot cancel a report with status '{run.status}'",
        )

    run.status = "cancelled"
    run.completed_at = datetime.now(timezone.utc)
    db.commit()

    return _serialize_run(run)


@router.post("/api/organizations/{org_id}/on-demand-reports/runs/{run_id}/dismiss", response_model=OnDemandRunOut, summary="Dismiss report run")
def dismiss_report_run(
    org_id: UUID,
    run_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Dismiss report run."""
    run = db.query(ReportRun).filter_by(
        run_id=run_id,
        organization_id=org_id,
        triggered_by_user_id=auth.user_id,
    ).first()

    if not run:
        raise HTTPException(status_code=404, detail="Report run not found")

    if run.status in ("pending", "running"):
        raise HTTPException(
            status_code=400,
            detail="Cannot dismiss an active report. Cancel it first.",
        )

    run.dismissed_at = datetime.now(timezone.utc)
    db.commit()

    return _serialize_run(run)


@router.get("/api/organizations/{org_id}/on-demand-reports/runs/{run_id}/download", response_model=DownloadUrlResponse, summary="Download on demand report")
def download_on_demand_report(
    org_id: UUID,
    run_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Download on demand report."""
    from app.services import report_storage

    run = db.query(ReportRun).filter_by(
        run_id=run_id,
        organization_id=org_id,
        triggered_by_user_id=auth.user_id,
    ).first()

    if not run:
        raise HTTPException(status_code=404, detail="Report run not found")

    if run.status != "completed":
        raise HTTPException(
            status_code=400,
            detail=f"Report is {run.status}, not ready for download",
        )

    if not run.export_s3_key:
        raise HTTPException(status_code=404, detail="Export file not found")

    url = report_storage.generate_download_url(
        run.export_s3_key,
        expires_in=3600,
    )

    if not url:
        raise HTTPException(status_code=500, detail="Failed to generate download URL")

    return {"download_url": url}


# ============================================================================
# REPORT TEMPLATES (HTML upload/download)
# ============================================================================

MAX_TEMPLATE_SIZE = 1 * 1024 * 1024  # 1 MB
BUILTIN_TEMPLATES_DIR = Path(__file__).resolve().parent.parent.parent / "services" / "builtin_report_templates"


def _get_storage(org_id: str, db: Session):
    from app.services.storage import get_storage_backend
    return get_storage_backend(org_id, db, bucket_type="platform")


def _s3_prefix(org_id: str) -> str:
    return f"report-templates/{org_id}/"


@router.get("/api/organizations/{org_id}/report-templates", response_model=ReportTemplateListResponse, summary="List report templates")
def list_report_templates(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.BRANDING_VIEW)),
    db: Session = Depends(get_db),
):
    """List report templates."""
    storage = _get_storage(str(org_id), db)
    prefix = _s3_prefix(str(org_id))

    objects, _ = storage.list_objects_sync(prefix=prefix)

    templates = []
    for obj in objects:
        name = obj.key.removeprefix(prefix)
        if not name:
            continue
        templates.append({
            "name": name,
            "size": obj.size,
            "last_modified": obj.last_modified.isoformat() if obj.last_modified else None,
        })

    return {"templates": templates}


@router.post("/api/organizations/{org_id}/report-templates", response_model=ReportTemplateUploadedResponse, status_code=201, summary="Upload report template")
async def upload_report_template(
    org_id: UUID,
    file: UploadFile = File(...),
    auth: AuthContext = Depends(require_permission(Permission.BRANDING_EDIT)),
    db: Session = Depends(get_db),
):
    """Upload report template."""
    filename = file.filename or ""

    _, ext = os.path.splitext(filename)
    if ext.lower() != ".html":
        raise HTTPException(status_code=400, detail="Only .html files are allowed")

    content = await file.read()
    if len(content) > MAX_TEMPLATE_SIZE:
        raise HTTPException(status_code=400, detail="File must be less than 1 MB")

    if len(content) == 0:
        raise HTTPException(status_code=400, detail="File is empty")

    text_content = content.decode("utf-8", errors="replace").lower()
    if "<html" not in text_content and "<!doctype" not in text_content:
        raise HTTPException(status_code=400, detail="File does not appear to be a valid HTML template")

    safe_name = os.path.basename(filename)
    if not safe_name or safe_name.startswith("."):
        raise HTTPException(status_code=400, detail="Invalid filename")

    s3_key = f"report-templates/{org_id}/{safe_name}"

    try:
        storage = _get_storage(str(org_id), db)
        storage.put_object_sync(
            key=s3_key,
            body=content,
            content_type="text/html",
        )
    except Exception:
        logger.exception("Failed to upload report template %s", s3_key)
        raise HTTPException(status_code=500, detail="Failed to upload template. Please try again.")

    return {
        "name": safe_name,
        "size": len(content),
        "message": "Template uploaded successfully",
    }


# Static "default" path MUST come before parameterized "{filename}" path
@router.get("/api/organizations/{org_id}/report-templates/default/{template_name}", summary="Download default template")
def download_default_template(
    org_id: UUID,
    template_name: str,
    auth: AuthContext = Depends(require_permission(Permission.BRANDING_VIEW)),
    db: Session = Depends(get_db),
):
    """Download default template."""
    safe_name = os.path.basename(template_name)
    template_path = BUILTIN_TEMPLATES_DIR / safe_name

    if not template_path.is_file():
        raise HTTPException(status_code=404, detail=f"Built-in template '{safe_name}' not found")

    data = template_path.read_bytes()
    return Response(
        content=data,
        media_type="text/html",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_name}"',
        },
    )


@router.get("/api/organizations/{org_id}/report-templates/{filename}", summary="Download report template")
def download_report_template(
    org_id: UUID,
    filename: str,
    auth: AuthContext = Depends(require_permission(Permission.BRANDING_VIEW)),
    db: Session = Depends(get_db),
):
    """Download report template."""
    from app.services.storage.base import ObjectNotFoundError

    safe_name = os.path.basename(filename)
    s3_key = f"report-templates/{org_id}/{safe_name}"

    try:
        storage = _get_storage(str(org_id), db)
        data, _ = storage.get_object_sync(s3_key)
    except ObjectNotFoundError:
        raise HTTPException(status_code=404, detail=f"Template '{safe_name}' not found")
    except Exception:
        logger.exception("Failed to download report template %s", s3_key)
        raise HTTPException(status_code=500, detail="Failed to download template.")

    return Response(
        content=data,
        media_type="text/html",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_name}"',
        },
    )


@router.delete("/api/organizations/{org_id}/report-templates/{filename}", response_model=DeleteReportTemplateResponse, summary="Delete report template")
def delete_report_template(
    org_id: UUID,
    filename: str,
    auth: AuthContext = Depends(require_permission(Permission.BRANDING_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete report template."""
    from app.services.storage.base import ObjectNotFoundError

    safe_name = os.path.basename(filename)
    s3_key = f"report-templates/{org_id}/{safe_name}"

    try:
        storage = _get_storage(str(org_id), db)
        storage.delete_object_sync(s3_key)
    except ObjectNotFoundError:
        raise HTTPException(status_code=404, detail=f"Template '{safe_name}' not found")
    except Exception:
        logger.exception("Failed to delete report template %s", s3_key)
        raise HTTPException(status_code=500, detail="Failed to delete template.")

    return {"message": f"Template '{safe_name}' deleted"}


# ============================================================================
# DASHBOARD REPORTS (summary, daily runs, datasets)
# ============================================================================


@router.get("/api/organizations/{org_id}/reports/summary", response_model=DashboardSummaryResponse, summary="Get summary")
def get_summary(
    org_id: UUID,
    days: int = Query(30, ge=1, le=365),
    auth: AuthContext = Depends(require_permission(Permission.RUNS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get summary."""
    since = datetime.now(timezone.utc) - timedelta(days=days)

    run_stats = db.query(
        func.count(Run.run_id).label("total"),
        func.sum(case((Run.status == "success", 1), else_=0)).label("success"),
        func.sum(case((Run.status == "failed", 1), else_=0)).label("failed"),
        func.avg(Run.duration_ms).label("avg_duration"),
    ).filter(
        Run.organization_id == org_id,
        Run.created_at >= since,
    ).first()

    total_runs = run_stats.total or 0
    successful_runs = int(run_stats.success or 0)
    failed_runs = int(run_stats.failed or 0)
    avg_duration = int(run_stats.avg_duration or 0)
    success_rate = round((successful_runs / total_runs * 100), 1) if total_runs > 0 else 0

    total_entities = db.query(
        func.count(EntityCurrent.entity_key)
    ).filter(
        EntityCurrent.organization_id == org_id,
    ).scalar() or 0

    active_pipelines = db.query(
        func.count(Pipeline.pipeline_id)
    ).filter(
        Pipeline.organization_id == org_id,
        Pipeline.status == "active",
    ).scalar() or 0

    return {
        "total_runs": total_runs,
        "successful_runs": successful_runs,
        "failed_runs": failed_runs,
        "success_rate": success_rate,
        "total_entities": total_entities,
        "active_pipelines": active_pipelines,
        "avg_duration_ms": avg_duration,
        "period_days": days,
    }


@router.get("/api/organizations/{org_id}/reports/runs/daily", response_model=DailyRunsResponse, summary="Get daily runs")
def get_daily_runs(
    org_id: UUID,
    days: int = Query(30, ge=1, le=365),
    auth: AuthContext = Depends(require_permission(Permission.RUNS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get daily runs."""
    since = datetime.now(timezone.utc) - timedelta(days=days)

    date_col = func.date_trunc("day", Run.created_at).label("date")

    daily_stats = db.query(
        date_col,
        func.count(Run.run_id).label("total"),
        func.sum(case((Run.status == "success", 1), else_=0)).label("success"),
        func.sum(case((Run.status == "failed", 1), else_=0)).label("failed"),
        func.sum(func.coalesce(Run.processed_count, 0)).label("entities"),
    ).filter(
        Run.organization_id == org_id,
        Run.created_at >= since,
    ).group_by(
        date_col,
    ).order_by(
        date_col.desc(),
    ).all()

    result = []
    for row in daily_stats:
        result.append({
            "date": row.date.strftime("%Y-%m-%d") if row.date else None,
            "total": row.total or 0,
            "success": int(row.success or 0),
            "failed": int(row.failed or 0),
            "entities": int(row.entities or 0),
        })

    return {"days": result}


@router.get("/api/organizations/{org_id}/reports/datasets/summary", response_model=DatasetsSummaryResponse, summary="Get datasets summary")
def get_datasets_summary(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.DATA_VIEW)),
    db: Session = Depends(get_db),
):
    """Get datasets summary."""
    entity_counts = db.query(
        EntityCurrent.dataset_id,
        func.count(EntityCurrent.entity_key).label("entity_count"),
    ).filter(
        EntityCurrent.organization_id == org_id,
    ).group_by(
        EntityCurrent.dataset_id,
    ).subquery()

    since = datetime.now(timezone.utc) - timedelta(days=30)
    run_stats = db.query(
        Run.dataset_id,
        func.count(Run.run_id).label("runs_total"),
        func.sum(case((Run.status == "success", 1), else_=0)).label("runs_success"),
        func.max(Run.created_at).label("last_run_at"),
    ).filter(
        Run.organization_id == org_id,
        Run.created_at >= since,
    ).group_by(
        Run.dataset_id,
    ).subquery()

    results = db.query(
        Dataset,
        func.coalesce(entity_counts.c.entity_count, 0).label("entity_count"),
        func.coalesce(run_stats.c.runs_total, 0).label("runs_total"),
        func.coalesce(run_stats.c.runs_success, 0).label("runs_success"),
        run_stats.c.last_run_at,
    ).outerjoin(
        entity_counts, Dataset.dataset_id == entity_counts.c.dataset_id,
    ).outerjoin(
        run_stats, Dataset.dataset_id == run_stats.c.dataset_id,
    ).filter(
        Dataset.organization_id == org_id,
    ).order_by(
        Dataset.name,
    ).all()

    datasets = []
    for dataset, entity_count, runs_total, runs_success, last_run_at in results:
        runs_total = int(runs_total or 0)
        runs_success = int(runs_success or 0)
        success_rate = round((runs_success / runs_total * 100), 1) if runs_total > 0 else None

        datasets.append({
            "dataset_id": str(dataset.dataset_id),
            "name": dataset.name,
            "entity_count": int(entity_count or 0),
            "last_run_at": last_run_at.isoformat() if last_run_at else None,
            "runs_total": runs_total,
            "runs_successful": runs_success,
            "success_rate": success_rate,
        })

    return {"datasets": datasets}


# ============================================================================
# PAGE DOCUMENTATION (docs)
# ============================================================================

VALID_PAGE_KEYS = {
    "flow.overview",
    "runs.list", "runs.detail",
    "datasets.list", "datasets.detail",
    "entities.search", "entities.detail",
    "setup.wizard", "setup.connectors", "setup.pipelines",
    "pipelines.detail", "connectors.settings",
    "admin.users", "admin.email-events",
    "settings.user",
}

AUDIENCE_HIERARCHY = {
    "all": 0,
    "viewer": 1,
    "engineer": 2,
    "admin": 3,
}


def _get_user_audience_level(db: Session, user_id, organization_id) -> int:
    try:
        if isinstance(user_id, str):
            user_id = UUID(user_id)
        if isinstance(organization_id, str):
            organization_id = UUID(organization_id)

        membership = db.query(OrganizationMembership).filter(
            and_(
                OrganizationMembership.user_id == user_id,
                OrganizationMembership.organization_id == organization_id,
                OrganizationMembership.status == "active",
            )
        ).first()

        if not membership:
            return AUDIENCE_HIERARCHY["viewer"]

        role = membership.role
        if role in ("admin",):
            return AUDIENCE_HIERARCHY["admin"]
        elif role in ("engineer", "registrar"):
            return AUDIENCE_HIERARCHY["engineer"]
        else:
            return AUDIENCE_HIERARCHY["viewer"]
    except Exception as e:
        logger.error(f"Error getting user audience level: {e}")
        return AUDIENCE_HIERARCHY["viewer"]


def _can_user_see_doc(user_audience_level: int, doc_audience: str) -> bool:
    doc_level = AUDIENCE_HIERARCHY.get(doc_audience, 0)
    return doc_level == 0 or user_audience_level >= doc_level


def _serialize_doc(doc: OrgScopedDoc) -> dict:
    return {
        "doc_id": str(doc.doc_id),
        "organization_id": str(doc.organization_id),
        "page_key": doc.page_key,
        "title": doc.title,
        "summary": doc.summary,
        "body_markdown": doc.body_markdown,
        "audience": doc.audience,
        "created_by": str(doc.created_by) if doc.created_by else None,
        "created_at": doc.created_at.isoformat() if doc.created_at else None,
        "updated_at": doc.updated_at.isoformat() if doc.updated_at else None,
    }


# Static paths ("keys", "all") BEFORE parameterized "{doc_id}"
@router.get("/api/docs/keys", response_model=PageKeysResponse, summary="List page keys")
def list_page_keys(
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """List page keys."""
    return {"page_keys": sorted(VALID_PAGE_KEYS)}


@router.get("/api/docs/all", response_model=DocListResponse, summary="List all docs")
def list_all_docs(
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    """List all docs."""
    docs = db.query(OrgScopedDoc).filter(
        OrgScopedDoc.organization_id == auth.active_organization_id,
    ).order_by(OrgScopedDoc.page_key).all()

    return {"docs": [_serialize_doc(doc) for doc in docs]}


@router.get("/api/docs", response_model=DocResponse, summary="Get doc")
def get_doc(
    pageKey: str = Query(None),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get doc."""
    if not pageKey:
        raise HTTPException(status_code=400, detail="pageKey query parameter is required")

    organization_id = auth.active_organization_id
    user_id = auth.user_id

    if not organization_id:
        raise HTTPException(status_code=400, detail="No active organization set.")

    user_audience_level = _get_user_audience_level(db, user_id, organization_id)

    doc = db.query(OrgScopedDoc).filter(
        and_(
            OrgScopedDoc.organization_id == organization_id,
            OrgScopedDoc.page_key == pageKey,
        )
    ).first()

    if doc and not _can_user_see_doc(user_audience_level, doc.audience):
        doc = None

    return {"doc": _serialize_doc(doc) if doc else None}


@router.post("/api/docs", response_model=DocResponse, status_code=201, summary="Create doc")
def create_doc(
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    """Create doc."""
    required_fields = ["page_key", "title", "body_markdown"]
    missing_fields = [f for f in required_fields if not body.get(f)]
    if missing_fields:
        raise HTTPException(
            status_code=400,
            detail=f"Missing required fields: {', '.join(missing_fields)}",
        )

    page_key = body["page_key"]
    audience = body.get("audience", "all")

    if page_key not in VALID_PAGE_KEYS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid page_key. Must be one of: {', '.join(sorted(VALID_PAGE_KEYS))}",
        )

    if audience not in AUDIENCE_HIERARCHY:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid audience. Must be one of: {', '.join(AUDIENCE_HIERARCHY.keys())}",
        )

    doc = OrgScopedDoc(
        organization_id=auth.active_organization_id,
        page_key=page_key,
        title=body["title"],
        summary=body.get("summary"),
        body_markdown=body["body_markdown"],
        audience=audience,
        created_by=auth.user_id,
    )

    db.add(doc)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"Documentation already exists for page_key '{page_key}' in this organization",
        )

    return {"doc": _serialize_doc(doc)}


@router.put("/api/docs/{doc_id}", response_model=DocResponse, summary="Update doc")
def update_doc(
    doc_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    """Update doc."""
    doc = db.query(OrgScopedDoc).filter(
        and_(
            OrgScopedDoc.doc_id == doc_id,
            OrgScopedDoc.organization_id == auth.active_organization_id,
        )
    ).first()

    if not doc:
        raise HTTPException(status_code=404, detail="Documentation not found")

    if "audience" in body:
        if body["audience"] not in AUDIENCE_HIERARCHY:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid audience. Must be one of: {', '.join(AUDIENCE_HIERARCHY.keys())}",
            )

    for field in ["title", "summary", "body_markdown", "audience"]:
        if field in body:
            setattr(doc, field, body[field])

    db.commit()

    return {"doc": _serialize_doc(doc)}


@router.delete("/api/docs/{doc_id}", response_model=DocDeleteResponse, summary="Delete doc")
def delete_doc(
    doc_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    """Delete doc."""
    doc = db.query(OrgScopedDoc).filter(
        and_(
            OrgScopedDoc.doc_id == doc_id,
            OrgScopedDoc.organization_id == auth.active_organization_id,
        )
    ).first()

    if not doc:
        raise HTTPException(status_code=404, detail="Documentation not found")

    page_key = doc.page_key
    db.delete(doc)
    db.commit()

    return {"success": True, "deleted_page_key": page_key}


# ============================================================================
# DOCUMENT GENERATION (PDF)
# ============================================================================


def _resolve_document_data(
    document_type: str,
    data: dict,
    organization_id: UUID,
    db: Session,
) -> dict:
    """Resolve IDs in the request body into full data dicts for the generator."""
    from app.models import (
        ObjectEntry,
        ObjectEntryItem,
        Constituent,
        Organization,
        OrganizationBranding,
    )

    org = db.query(Organization).filter(
        Organization.organization_id == organization_id,
    ).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    org_dict = {
        "name": org.name,
        "organization_id": str(org.organization_id),
    }

    branding_row = db.query(OrganizationBranding).filter(
        OrganizationBranding.organization_id == organization_id,
    ).first()
    branding_dict = None
    if branding_row:
        branding_dict = {
            "letterhead_name": branding_row.letterhead_name,
            "letterhead_address_line1": branding_row.letterhead_address_line1,
            "letterhead_address_line2": branding_row.letterhead_address_line2,
            "letterhead_city_state_zip": branding_row.letterhead_city_state_zip,
            "letterhead_country": branding_row.letterhead_country,
            "letterhead_phone": branding_row.letterhead_phone,
            "letterhead_email": branding_row.letterhead_email,
            "letterhead_website": branding_row.letterhead_website,
            "footer_text": branding_row.footer_text,
            "primary_color": branding_row.primary_color or "#1a365d",
            "secondary_color": branding_row.secondary_color or "#2d3748",
            "accent_color": branding_row.accent_color or "#3182ce",
        }

    resolved: dict = {}

    if document_type == "object_receipt":
        entry_id = data.get("entry_id")
        if not entry_id:
            raise HTTPException(status_code=400, detail="entry_id is required for object_receipt")

        entry = db.query(ObjectEntry).filter(
            ObjectEntry.entry_id == entry_id,
            ObjectEntry.organization_id == organization_id,
        ).first()
        if not entry:
            raise HTTPException(status_code=404, detail="Object entry not found")

        resolved["entry"] = {
            "entry_number": entry.entry_number,
            "entry_date": str(entry.entry_date) if entry.entry_date else None,
            "entry_reason": entry.entry_reason,
            "depositor_name": entry.depositor_name,
            "expected_return_date": str(entry.expected_return_date) if entry.expected_return_date else None,
            "conditions": entry.conditions,
            "objects_description": entry.objects_description,
            "insurance_value": str(entry.insurance_value) if entry.insurance_value else None,
            "insurance_currency": entry.insurance_currency,
        }

        # Resolve depositor contact
        if entry.depositor_id:
            depositor = db.query(Constituent).filter(
                Constituent.constituent_id == entry.depositor_id,
            ).first()
            if depositor:
                resolved["depositor"] = {
                    "name": depositor.name,
                    "organization": depositor.organization_name,
                    "email": depositor.email,
                    "phone": depositor.phone,
                }

        # Resolve entry items
        items = (
            db.query(ObjectEntryItem)
            .filter(ObjectEntryItem.entry_id == entry.entry_id)
            .order_by(ObjectEntryItem.item_number)
            .all()
        )
        resolved["objects"] = [
            {
                "item_number": item.item_number,
                "brief_description": item.brief_description or "",
                "detailed_description": item.detailed_description,
                "lender_object_number": item.lender_object_number,
                "condition_on_entry": item.condition_note,
                "notes": item.item_outcome_note,
            }
            for item in items
        ]

    else:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported document type: {document_type}",
        )

    return {
        "organization": org_dict,
        "branding": branding_dict,
        "data": resolved,
    }


@router.post("/api/organizations/{organization_id}/documents/generate", summary="Generate document", status_code=202)
def generate_document(
    organization_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.ENTRIES_VIEW)),
    db: Session = Depends(get_db),
):
    """Generate a PDF document (receipt, agreement, etc.). Dispatches async Celery task and returns 202."""
    from app.tasks.reports import generate_document_task

    document_type = body.get("document_type")
    if not document_type:
        raise HTTPException(status_code=400, detail="document_type is required")

    # Validate document_type early so we fail fast before dispatching
    request_data = body.get("data", {})
    _resolve_document_data(document_type, request_data, organization_id, db)

    run = ReportRun(
        organization_id=organization_id,
        status="pending",
        triggered_by="on_demand",
        report_key=document_type,
        context_params=body.get("data", {}),
        export_format="pdf",
        triggered_by_user_id=auth.user_id,
    )
    db.add(run)
    db.commit()

    generate_document_task.delay(
        run_id=str(run.run_id),
        organization_id=str(organization_id),
    )

    return {
        "run_id": str(run.run_id),
        "status": "pending",
    }
