"""
Customer and Visitor API endpoints (FastAPI).

  - Customer (6 routes): list datasets, get dataset, list entities, list
    changes, list runs, execute run — the Bridge data API.
  - Visitor (3 routes): identify, profile, interaction — Guide visitor
    sessions.

Prospect/sales-CRM routes were removed (they were vendor-internal, not
museum-facing).
"""

import csv
import hashlib
import io
import logging
import pathlib
import re
import secrets
from datetime import datetime, timezone, timedelta
from urllib.parse import urlparse
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy import func, or_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.fastapi_app.schemas.crm import (
    ChangeEventListResponse,
    DatasetListResponse,
    DatasetSummaryOut,
    EntityListResponse,
    ExecuteRunResponse,
    InteractionRecordResponse,
    VisitorProfileResponse,
    RunListResponse,
    VisitorIdentifyResponse,
)
from app.models import (
    Dataset,
    EntityCurrent,
    ChangeEvent,
    Run,
    Organization,
    User,
    OrganizationMembership,
    OrganizationInvitation,
    Role,
    Application,
    OrganizationApplication,
)
from app.permissions import Permission
from app.services.rls import set_rls_context_for_session

logger = logging.getLogger(__name__)

router = APIRouter(tags=["crm"])

# ============================================================================
# HELPERS
# ============================================================================










# ============================================================================
# CUSTOMER ENDPOINTS
# ============================================================================


@router.get("/api/v1/datasets", response_model=DatasetListResponse, summary="List datasets")
def list_datasets(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.DATA_VIEW)),
    db: Session = Depends(get_db),
):
    """List all datasets for the authenticated organization."""
    if not auth.active_organization_id:
        raise HTTPException(status_code=400, detail="No active organization")

    query = db.query(Dataset).filter_by(
        organization_id=auth.active_organization_id,
    ).order_by(Dataset.created_at.desc())

    total = query.count()
    datasets = query.limit(limit).offset(offset).all()

    # One COUNT query per page rather than a relationship-load. Dataset
    # has no `entities` relationship; counts come from EntityCurrent.
    dataset_ids = [ds.dataset_id for ds in datasets]
    counts: dict = {}
    if dataset_ids:
        rows = (
            db.query(EntityCurrent.dataset_id, func.count(EntityCurrent.entity_key))
            .filter(EntityCurrent.dataset_id.in_(dataset_ids))
            .group_by(EntityCurrent.dataset_id)
            .all()
        )
        counts = {row[0]: row[1] for row in rows}

    return {
        "items": [
            {
                "dataset_id": str(ds.dataset_id),
                "name": ds.name,
                "description": ds.description,
                "entity_count": counts.get(ds.dataset_id, 0),
                "created_at": ds.created_at.isoformat(),
                "updated_at": ds.updated_at.isoformat() if ds.updated_at else None,
            }
            for ds in datasets
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/api/v1/datasets/{dataset_id}", response_model=DatasetSummaryOut, summary="Get dataset")
def get_dataset(
    dataset_id: str,
    auth: AuthContext = Depends(require_permission(Permission.DATA_VIEW)),
    db: Session = Depends(get_db),
):
    """Get a specific dataset by ID."""
    if not auth.active_organization_id:
        raise HTTPException(status_code=400, detail="No active organization")

    dataset = db.query(Dataset).filter_by(
        dataset_id=dataset_id, organization_id=auth.active_organization_id,
    ).first()

    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    entity_count = (
        db.query(func.count(EntityCurrent.entity_key))
        .filter(EntityCurrent.dataset_id == dataset.dataset_id)
        .scalar()
        or 0
    )
    return {
        "dataset_id": str(dataset.dataset_id),
        "name": dataset.name,
        "description": dataset.description,
        "entity_count": entity_count,
        "created_at": dataset.created_at.isoformat(),
        "updated_at": dataset.updated_at.isoformat() if dataset.updated_at else None,
    }


@router.get("/api/v1/entities", response_model=EntityListResponse, summary="List entities")
def list_entities(
    dataset_id: str = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.DATA_VIEW)),
    db: Session = Depends(get_db),
):
    """List entities for the authenticated organization."""
    if not auth.active_organization_id:
        raise HTTPException(status_code=400, detail="No active organization")

    query = db.query(EntityCurrent).filter(
        EntityCurrent.organization_id == auth.active_organization_id,
        EntityCurrent.is_deleted == False,  # noqa: E712
    )

    if dataset_id:
        query = query.filter(EntityCurrent.dataset_id == dataset_id)

    query = query.order_by(EntityCurrent.extracted_at.desc())
    total = query.count()
    entities = query.limit(limit).offset(offset).all()

    return {
        "items": [
            {
                "entity_key": e.entity_key,
                "dataset_id": str(e.dataset_id) if e.dataset_id else None,
                "source_system": e.source_system,
                "source_id": e.source_id,
                "entity_type": e.entity_type,
                "payload": e.payload,
                "extracted_at": e.extracted_at.isoformat(),
                "updated_at": e.updated_at.isoformat() if e.updated_at else None,
            }
            for e in entities
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/api/v1/changes", response_model=ChangeEventListResponse, summary="List changes")
def list_changes(
    dataset_id: str = Query(None),
    run_id: str = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.DATA_VIEW)),
    db: Session = Depends(get_db),
):
    """List changes for the authenticated organization."""
    if not auth.active_organization_id:
        raise HTTPException(status_code=400, detail="No active organization")

    query = db.query(ChangeEvent).filter(
        ChangeEvent.organization_id == auth.active_organization_id,
    )

    if dataset_id:
        query = query.filter(ChangeEvent.dataset_id == dataset_id)
    if run_id:
        query = query.filter(ChangeEvent.run_id == run_id)

    query = query.order_by(ChangeEvent.occurred_at.desc())
    total = query.count()
    changes = query.limit(limit).offset(offset).all()

    return {
        "items": [
            {
                "change_id": str(c.change_id),
                "entity_key": c.entity_key,
                "run_id": str(c.run_id),
                "change_type": c.change_type,
                "changed_fields": c.changed_fields,
                "summary": c.summary,
                "occurred_at": c.occurred_at.isoformat(),
            }
            for c in changes
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/api/v1/runs", response_model=RunListResponse, summary="List runs")
def list_runs(
    dataset_id: str = Query(None),
    status: str = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.DATA_VIEW)),
    db: Session = Depends(get_db),
):
    """List runs for the authenticated organization."""
    if not auth.active_organization_id:
        raise HTTPException(status_code=400, detail="No active organization")

    query = db.query(Run).join(Dataset).filter(
        Dataset.organization_id == auth.active_organization_id,
    )

    if dataset_id:
        query = query.filter(Run.dataset_id == dataset_id)
    if status:
        query = query.filter(Run.status == status)

    query = query.order_by(Run.created_at.desc())
    total = query.count()
    runs = query.limit(limit).offset(offset).all()

    return {
        "items": [
            {
                "run_id": str(r.run_id),
                "dataset_id": str(r.dataset_id),
                "status": r.status,
                "started_at": r.started_at.isoformat() if r.started_at else None,
                "finished_at": r.finished_at.isoformat() if r.finished_at else None,
                "created_at": r.created_at.isoformat(),
            }
            for r in runs
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("/api/v1/runs/{run_id}/execute", response_model=ExecuteRunResponse, summary="Execute run")
def execute_run(
    run_id: str,
    auth: AuthContext = Depends(require_permission(Permission.DATA_MANAGE)),
    db: Session = Depends(get_db),
):
    """Trigger execution of a run."""
    if not auth.active_organization_id:
        raise HTTPException(status_code=400, detail="No active organization")

    run = db.query(Run).join(Dataset).filter(
        Run.run_id == run_id, Dataset.organization_id == auth.active_organization_id,
    ).first()

    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    if run.status == "running":
        raise HTTPException(status_code=400, detail="Run is already executing")

    terminal_states = ["success", "failed", "warning", "failed_publish", "failed_finalize", "canceled"]
    if run.status in terminal_states:
        raise HTTPException(status_code=400, detail=f"Run is already in terminal state: {run.status}")

    from app.services.pipeline import execute_run as pipeline_execute_run, PipelineError
    from app.services.api_security import sanitize_error_message

    try:
        run_uuid = UUID(run_id)
        result = pipeline_execute_run(db, run_uuid)

        response = {
            "run_id": str(result.run_id),
            "status": result.status,
            "duration_ms": result.duration_ms,
            "counts": result.counts,
        }
        if result.target_url:
            response["target_url"] = result.target_url

        if result.status in ["failed", "failed_publish", "failed_finalize"]:
            if result.error:
                response["error"] = result.error
            if result.error_stage:
                response["error_stage"] = result.error_stage
            return JSONResponse(status_code=500, content=response)

        return response

    except PipelineError as e:
        logger.exception(f"Pipeline error executing run {run_id}: {e}")
        return JSONResponse(
            status_code=500,
            content={"run_id": run_id, "status": "failed", "error": sanitize_error_message(e)},
        )


# ============================================================================
# VISITOR ENDPOINTS
# ============================================================================

VALID_INTERACTION_TYPES = frozenset({
    "object_view", "qr_scan", "agent_conversation",
    "exhibition_view", "search", "share",
})
VALID_SOURCES = frozenset({"qr_scan", "website", "ticket"})
_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
_SESSION_ID_RE = re.compile(r"^[\w\-]{1,100}$")


def _validate_session_id(session_id: str | None) -> tuple[str | None, str | None]:
    if not session_id:
        return None, "session_id is required"
    session_id = session_id.strip()
    if not session_id or len(session_id) > 100:
        return None, "session_id must be 1-100 characters"
    if not _SESSION_ID_RE.match(session_id):
        return None, "session_id contains invalid characters"
    return session_id, None


def _get_org_by_slug(db: Session, slug: str) -> Organization | None:
    return db.query(Organization).filter(
        Organization.slug == slug, Organization.status == "active",
    ).first()


@router.post("/api/guide/{org_slug}/visitor/identify", response_model=VisitorIdentifyResponse, summary="Identify visitor")
def identify_visitor(
    org_slug: str,
    body: dict,
    db: Session = Depends(get_db),
):
    """Add identifying information to a visitor profile."""
    org = _get_org_by_slug(db, org_slug)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    set_rls_context_for_session(db, str(org.organization_id))

    session_id, err = _validate_session_id(body.get("session_id"))
    if err:
        raise HTTPException(status_code=400, detail=err)

    email = body.get("email")
    if email is not None:
        email = str(email).strip()
        if not email:
            email = None
        elif len(email) > 255 or not _EMAIL_RE.match(email):
            raise HTTPException(status_code=400, detail="Invalid email format")

    display_name = body.get("display_name")
    if display_name is not None:
        display_name = str(display_name).strip()[:100] or None

    locale = body.get("locale")
    if locale is not None:
        locale = str(locale).strip()[:10] or None

    from app.services.visitor_service import get_visitor_service
    service = get_visitor_service(session=db)
    visitor = service.get_or_create_visitor(organization_id=org.organization_id, session_token=session_id)
    visitor = service.identify_visitor(visitor=visitor, email=email, display_name=display_name, locale=locale)

    return {
        "visitor_id": str(visitor.visitor_id),
        "email": visitor.email,
        "display_name": visitor.display_name,
        "locale": visitor.locale,
    }


@router.get("/api/guide/{org_slug}/visitor/profile", response_model=VisitorProfileResponse, summary="Get visitor profile")
def get_visitor_profile(
    org_slug: str,
    session_id: str = Query(...),
    db: Session = Depends(get_db),
):
    """Get visitor profile by session token."""
    org = _get_org_by_slug(db, org_slug)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    set_rls_context_for_session(db, str(org.organization_id))

    session_id_clean, err = _validate_session_id(session_id)
    if err:
        raise HTTPException(status_code=400, detail=err)

    from app.services.visitor_service import get_visitor_service
    service = get_visitor_service(session=db)
    profile = service.get_visitor_profile(organization_id=org.organization_id, session_token=session_id_clean)

    if not profile:
        raise HTTPException(status_code=404, detail="Visitor not found")

    return profile


@router.post("/api/guide/{org_slug}/visitor/interaction", response_model=InteractionRecordResponse, status_code=201, summary="Record interaction")
def record_interaction(
    org_slug: str,
    body: dict,
    db: Session = Depends(get_db),
):
    """Record a visitor interaction."""
    org = _get_org_by_slug(db, org_slug)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    set_rls_context_for_session(db, str(org.organization_id))

    session_id, err = _validate_session_id(body.get("session_id"))
    if err:
        raise HTTPException(status_code=400, detail=err)

    interaction_type = body.get("interaction_type")
    if not interaction_type:
        raise HTTPException(status_code=400, detail="interaction_type is required")
    if interaction_type not in VALID_INTERACTION_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid interaction_type. Must be one of: {', '.join(sorted(VALID_INTERACTION_TYPES))}",
        )

    source = body.get("source")
    if source is not None and source not in VALID_SOURCES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid source. Must be one of: {', '.join(sorted(VALID_SOURCES))}",
        )

    from app.services.visitor_service import get_visitor_service
    service = get_visitor_service(session=db)
    visitor = service.get_or_create_visitor(organization_id=org.organization_id, session_token=session_id)
    visit = service.get_or_create_active_visit(
        organization_id=org.organization_id, visitor_id=visitor.visitor_id, source=source,
    )

    entity_id = None
    if body.get("entity_id"):
        try:
            entity_id = UUID(body["entity_id"])
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="Invalid entity_id")

    metadata = body.get("metadata")
    if metadata is not None:
        import json
        try:
            if len(json.dumps(metadata, default=str)) > 10240:
                raise HTTPException(status_code=400, detail="metadata too large (max 10KB)")
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Invalid metadata")

    interaction = service.record_interaction(
        organization_id=org.organization_id, visit_id=visit.visit_id,
        interaction_type=interaction_type, entity_type=body.get("entity_type"),
        entity_id=entity_id, metadata=metadata,
    )

    return {"interaction_id": str(interaction.interaction_id), "visit_id": str(visit.visit_id)}
