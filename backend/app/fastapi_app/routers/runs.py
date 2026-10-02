"""
Runs, Jobs, and Datasets API — FastAPI router.

Migrated from:
- app/api/runs.py (7 routes)
- app/api/jobs.py (2 routes)
- app/api/datasets_api.py (6 routes)
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy import desc, func
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.fastapi_app.dependencies.auth import (
    AuthContext,
    get_authorized_org_id,
    require_auth,
    require_permission,
)
from app.fastapi_app.schemas.runs import (
    CreateRunBody,
    CreateDatasetBody,
    UpdateDatasetBody,
    RunListResponse,
    RunDetailOut,
    RunCreateResponse,
    RunExecuteResponse,
    RetryDestinationResponse,
    JobListResponse,
    JobOut,
    DatasetOut as RunsDatasetOut,
    DatasetListResponse as RunsDatasetListResponse,
    DatasetPreviewResponse as RunsDatasetPreviewResponse,
    DatasetSchemaResponse as RunsDatasetSchemaResponse,
)
from app.models import (
    Run,
    Pipeline,
    ConnectorInstance,
    ConnectorDefinition,
    Dataset,
    RunSourceStep,
    RunDestinationStep,
    PipelineSource,
    PipelineDestination,
    Job,
    Schedule,
)
from app.permissions import Permission
from app.services.api_security import sanitize_error_message
from app.services.pipeline import execute_run, republish_run, retry_destination_publish, PipelineError, RunConflictError
from app.services.audit_service import log_audit_event
from app.services.rate_limiter import execute_limiter

logger = logging.getLogger(__name__)

router = APIRouter()


# =============================================================================
# Helpers
# =============================================================================


def serialize_run(run: Run, include_steps: bool = False) -> dict:
    """
    Serialize a Run model to API response format.

    Ported faithfully from app/api/runs.py.
    """
    response = {
        "run_id": str(run.run_id),
        "pipeline_id": str(run.pipeline_id) if run.pipeline_id else None,
        "target_connector_instance_id": str(run.target_connector_instance_id) if run.target_connector_instance_id else None,
        "status": run.status,
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "published_at": run.published_at.isoformat() if run.published_at else None,
        "finished_at": run.finished_at.isoformat() if run.finished_at else None,
        "duration_ms": run.duration_ms,
        "counts": {
            "processed": run.processed_count or 0,
            "created": run.created_count or 0,
            "updated": run.updated_count or 0,
            "noop": run.skipped_count or 0,
            "failed": run.failed_count or 0,
            "deleted": run.deleted_count or 0,
        },
        "parameters": run.parameters if run.parameters else None,
        "error": run.error,
        "error_stage": run.error_stage,
        "error_at": run.error_at.isoformat() if run.error_at else None,
    }

    # Add target_url from parameters if available
    if run.parameters and isinstance(run.parameters, dict):
        target_url = run.parameters.get("target_url")
        if target_url:
            response["target_url"] = target_url

    if include_steps:
        # Serialize source steps
        sources = []
        for step in run.source_steps:
            sources.append({
                "step_id": str(step.step_id),
                "pipeline_source_id": str(step.pipeline_source_id),
                "connector_instance_id": str(step.pipeline_source.connector_instance_id) if step.pipeline_source else None,
                "status": step.status,
                "counts": step.counts or {},
                "error": step.error,
                "started_at": step.started_at.isoformat() if step.started_at else None,
                "finished_at": step.finished_at.isoformat() if step.finished_at else None,
            })
        response["sources"] = sources

        # Serialize destination steps
        destinations = []
        for step in run.destination_steps:
            destinations.append({
                "step_id": str(step.step_id),
                "pipeline_destination_id": str(step.pipeline_destination_id),
                "connector_instance_id": str(step.pipeline_destination.connector_instance_id) if step.pipeline_destination else None,
                "status": step.status,
                "counts": step.counts or {},
                "error": step.error,
                "started_at": step.started_at.isoformat() if step.started_at else None,
                "finished_at": step.finished_at.isoformat() if step.finished_at else None,
            })
        response["destinations"] = destinations

        # Compute overall run_status based on step statuses
        all_steps = run.source_steps + run.destination_steps
        if all_steps:
            step_statuses = [step.status for step in all_steps]
            if all(status == "success" for status in step_statuses):
                run_status = "succeeded"
            elif any(status == "failed" for status in step_statuses):
                run_status = "partial" if any(status == "success" for status in step_statuses) else "failed"
            else:
                run_status = "succeeded"
        else:
            run_status = "succeeded" if run.status == "success" else "failed" if run.status in ("failed", "failed_publish", "failed_finalize") else "partial"

        response["run_status"] = run_status

    return response


def serialize_job(job: Job, include_run: bool = False) -> dict:
    """Serialize a Job model to API response format."""
    response = {
        "job_id": str(job.job_id),
        "organization_id": str(job.organization_id),
        "schedule_id": str(job.schedule_id) if job.schedule_id else None,
        "pipeline_id": str(job.pipeline_id) if job.pipeline_id else None,
        "status": job.status,
        "scheduled_for": job.scheduled_for.isoformat() if job.scheduled_for else None,
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "finished_at": job.finished_at.isoformat() if job.finished_at else None,
        "attempt": job.attempt,
        "error": job.error,
        "run_id": str(job.run_id) if job.run_id else None,
        "created_at": job.created_at.isoformat(),
        "updated_at": job.updated_at.isoformat() if job.updated_at else None,
    }

    if include_run and job.run:
        response["run_status"] = job.run.status

    return response


def _serialize_dataset(dataset: Dataset) -> dict:
    """Serialize a Dataset model to JSON."""
    return {
        "dataset_id": str(dataset.dataset_id),
        "organization_id": str(dataset.organization_id),
        "name": dataset.name,
        "key": dataset.key,
        "description": dataset.description,
        "source_type": dataset.source_type,
        "schema": dataset.schema,
        "role": dataset.role,
        "created_at": dataset.created_at.isoformat() if dataset.created_at else None,
        "updated_at": dataset.updated_at.isoformat() if dataset.updated_at else None,
    }


def _resolve_org_id(auth: AuthContext, explicit: str | None = None) -> str:
    """Resolve organization_id from explicit value or auth context."""
    org_id = explicit or (str(auth.active_organization_id) if auth.active_organization_id else None)
    if not org_id:
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": "Organization context required",
        })
    return org_id


# =============================================================================
# Route 1: List runs
# =============================================================================

@router.get("/api/organizations/{organization_id}/runs", response_model=RunListResponse, summary="List runs")
def list_runs(
    organization_id: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    status: str | None = None,
    pipeline_id: str | None = None,
    dataset_id: str | None = None,
    auth: AuthContext = Depends(require_permission(Permission.RUNS_VIEW)),
    db: Session = Depends(get_db),
):
    """List runs."""
    try:
        org_uuid = UUID(organization_id)
    except ValueError:
        raise HTTPException(status_code=400, detail={
            "code": "invalid_parameter",
            "message": "Invalid organization_id format",
        })

    query = db.query(Run).filter(Run.organization_id == org_uuid)

    if status:
        query = query.filter(Run.status == status)
    if pipeline_id:
        try:
            query = query.filter(Run.pipeline_id == UUID(pipeline_id))
        except ValueError:
            raise HTTPException(status_code=400, detail={
                "code": "invalid_parameter",
                "message": "Invalid pipeline_id format",
            })
    if dataset_id:
        try:
            query = query.filter(Run.dataset_id == UUID(dataset_id))
        except ValueError:
            raise HTTPException(status_code=400, detail={
                "code": "invalid_parameter",
                "message": "Invalid dataset_id format",
            })

    query = query.order_by(Run.created_at.desc())
    total_count = query.count()
    runs = query.offset(offset).limit(limit).all()

    runs_data = []
    for run in runs:
        runs_data.append({
            "run_id": str(run.run_id),
            "pipeline_id": str(run.pipeline_id) if run.pipeline_id else None,
            "target_connector_instance_id": str(run.target_connector_instance_id) if run.target_connector_instance_id else None,
            "status": run.status,
            "started_at": run.started_at.isoformat() if run.started_at else None,
            "finished_at": run.finished_at.isoformat() if run.finished_at else None,
            "published_at": run.published_at.isoformat() if run.published_at else None,
            "duration_ms": run.duration_ms,
            "counts": {
                "processed": run.processed_count or 0,
                "created": run.created_count or 0,
                "updated": run.updated_count or 0,
                "noop": run.skipped_count or 0,
                "failed": run.failed_count or 0,
                "deleted": run.deleted_count or 0,
            },
        })

    return {
        "items": runs_data,
        "total": total_count,
        "limit": limit,
        "offset": offset,
    }


# =============================================================================
# Route 2: Get run details
# =============================================================================

@router.get("/api/organizations/{organization_id}/runs/{run_id}", response_model=RunDetailOut, summary="Get run")
def get_run(
    organization_id: str,
    run_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.RUNS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get run."""
    try:
        org_uuid = UUID(organization_id)
    except ValueError:
        raise HTTPException(status_code=400, detail={
            "code": "invalid_parameter",
            "message": "Invalid organization_id format",
        })

    run = (
        db.query(Run)
        .filter_by(run_id=run_id, organization_id=org_uuid)
        .options(
            joinedload(Run.source_steps).joinedload(RunSourceStep.pipeline_source),
            joinedload(Run.destination_steps).joinedload(RunDestinationStep.pipeline_destination),
        )
        .first()
    )

    if not run:
        raise HTTPException(status_code=404, detail={
            "code": "run_not_found",
            "message": f"Run {run_id} not found",
        })

    return serialize_run(run, include_steps=True)


# =============================================================================
# Route 3: Create run
# =============================================================================

@router.post("/api/organizations/{organization_id}/runs", status_code=201, response_model=RunCreateResponse, summary="Create run")
def create_run(
    organization_id: str,
    body: CreateRunBody,
    auth: AuthContext = Depends(require_permission(Permission.RUNS_EXECUTE)),
    db: Session = Depends(get_db),
):
    """Create run."""
    try:
        org_uuid = UUID(organization_id)
    except ValueError:
        raise HTTPException(status_code=400, detail={
            "code": "invalid_parameter",
            "message": "Invalid organization_id format",
        })

    # Load pipeline and validate it exists and belongs to the organization
    pipeline = db.query(Pipeline).filter_by(
        pipeline_id=body.pipeline_id,
        organization_id=org_uuid,
    ).first()
    if not pipeline:
        raise HTTPException(status_code=404, detail={
            "code": "pipeline_not_found",
            "message": f"Pipeline {body.pipeline_id} not found in organization {organization_id}",
        })

    # Determine dataset_id for this run
    dataset_id = None
    dataset_match_warning = None
    source_connector = None
    connector_def = None

    if pipeline.dataset_id:
        dataset_id = pipeline.dataset_id
    elif pipeline.sources:
        first_source = pipeline.sources[0]
        source_connector = db.query(ConnectorInstance).filter_by(
            connector_instance_id=first_source.connector_instance_id,
        ).first()
        if source_connector:
            connector_def = db.query(ConnectorDefinition).filter_by(
                connector_definition_id=source_connector.connector_definition_id,
            ).first()
            if connector_def:
                impl_key = connector_def.implementation_key
                source_type = impl_key.split('.')[-1].split(':')[0] if impl_key else None

                if source_type:
                    dataset = db.query(Dataset).filter_by(
                        organization_id=org_uuid,
                        source_type=source_type,
                    ).first()
                    if dataset:
                        dataset_id = dataset.dataset_id
                        dataset_match_warning = f"Using dataset '{dataset.name}' matched by source_type '{source_type}'. Consider setting explicit dataset_id on pipeline."
                    else:
                        dataset_match_warning = f"No dataset found for source_type '{source_type}'. Create a dataset or set explicit dataset_id on pipeline."

    # If we still don't have connector info but pipeline has sources, query it
    if not source_connector and pipeline.sources:
        first_source = pipeline.sources[0]
        source_connector = db.query(ConnectorInstance).filter_by(
            connector_instance_id=first_source.connector_instance_id,
        ).first()
        if source_connector:
            connector_def = db.query(ConnectorDefinition).filter_by(
                connector_definition_id=source_connector.connector_definition_id,
            ).first()

    if not dataset_id:
        logger.warning("Run created without dataset_id. Pipeline: %s, Org: %s", body.pipeline_id, organization_id)

    # Add reproducibility metadata to parameters
    from app.utils.version import get_version_info
    from app.services.run_steps import create_run_steps

    parameters = dict(body.parameters)
    if body.force_full_sync:
        parameters["force_full_sync"] = True

    source_implementation_key = None
    if source_connector and connector_def:
        source_implementation_key = connector_def.implementation_key

    enhanced_parameters = {
        **parameters,
        "_metadata": {
            **get_version_info(),
            **({"source_implementation_key": source_implementation_key} if source_implementation_key else {}),
        }
    }

    try:
        run = Run(
            organization_id=pipeline.organization_id,
            pipeline_id=pipeline.pipeline_id,
            dataset_id=dataset_id,
            source_connector_instance_id=pipeline.sources[0].connector_instance_id if pipeline.sources else None,
            target_connector_instance_id=pipeline.destinations[0].connector_instance_id if pipeline.destinations else None,
            status="pending",
            triggered_by=body.triggered_by,
            parameters=enhanced_parameters,
        )

        db.add(run)
        db.flush()

        create_run_steps(run)

        db.commit()

        logger.info("Created run %s for pipeline %s", run.run_id, body.pipeline_id)

        response = {
            "run_id": str(run.run_id),
            "pipeline_id": str(run.pipeline_id),
            "target_connector_instance_id": str(run.target_connector_instance_id) if run.target_connector_instance_id else None,
            "organization_id": str(run.organization_id),
            "status": run.status,
            "triggered_by": run.triggered_by,
            "parameters": run.parameters,
            "created_at": run.created_at.isoformat(),
        }

        if dataset_match_warning:
            response["warning"] = dataset_match_warning

        return response

    except SQLAlchemyError:
        db.rollback()
        logger.exception("Database error creating run")
        raise HTTPException(status_code=500, detail={
            "code": "database_error",
            "message": "Failed to create run",
        })


# =============================================================================
# Route 4: Delete run
# =============================================================================

@router.delete("/api/organizations/{organization_id}/runs/{run_id}", status_code=204, summary="Delete run")
def delete_run(
    organization_id: str,
    run_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.RUNS_DELETE)),
    db: Session = Depends(get_db),
):
    """Delete run."""
    try:
        org_uuid = UUID(organization_id)
    except ValueError:
        raise HTTPException(status_code=400, detail={
            "code": "invalid_parameter",
            "message": "Invalid organization_id format",
        })

    run = db.query(Run).filter_by(run_id=run_id, organization_id=org_uuid).first()

    if not run:
        raise HTTPException(status_code=404, detail={
            "code": "run_not_found",
            "message": "Run not found or doesn't belong to this organization",
        })

    if run.status in ['queued', 'running', 'publishing']:
        raise HTTPException(status_code=409, detail={
            "code": "run_in_progress",
            "message": "Cannot delete a run that is currently executing",
        })

    try:
        # Clear job references to this run (FK doesn't cascade)
        db.query(Job).filter_by(run_id=run_id).update({'run_id': None})

        db.delete(run)
        db.commit()

        logger.info("Deleted run %s from organization %s", run_id, organization_id)

    except SQLAlchemyError:
        db.rollback()
        logger.exception("Database error deleting run")
        raise HTTPException(status_code=500, detail={
            "code": "database_error",
            "message": "Failed to delete run",
        })


# =============================================================================
# Route 5: Execute run
# =============================================================================

@router.post("/api/organizations/{organization_id}/runs/{run_id}/execute", response_model=RunExecuteResponse, summary="Execute run endpoint")
def execute_run_endpoint(
    organization_id: str,
    run_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.RUNS_EXECUTE)),
    db: Session = Depends(get_db),
):
    """Execute run endpoint."""
    try:
        org_uuid = UUID(organization_id)
    except ValueError:
        raise HTTPException(status_code=400, detail={
            "code": "invalid_parameter",
            "message": "Invalid organization_id format",
        })

    run = db.query(Run).filter_by(run_id=run_id, organization_id=org_uuid).first()

    if not run:
        raise HTTPException(status_code=404, detail={
            "code": "run_not_found",
            "message": f"Run not found: {run_id}",
        })

    # Check rate limit
    if not execute_limiter.allow(organization_id=organization_id, endpoint="execute"):
        raise HTTPException(status_code=429, detail={
            "code": "rate_limit_exceeded",
            "message": "Too many execution requests. Please wait before trying again.",
            "retry_after": 60,
        })

    try:
        result = execute_run(db, run_id)

        if result.status == "success":
            run = db.query(Run).filter_by(run_id=run_id).first()
            response = serialize_run(run)
            if result.target_url:
                response["target_url"] = result.target_url
            return response
        else:
            run = db.query(Run).filter_by(run_id=run_id).first()
            response = serialize_run(run)
            response["error"] = result.error
            response["error_stage"] = result.error_stage
            return JSONResponse(content=response, status_code=500)

    except RunConflictError as e:
        # Before PipelineError: RunConflictError subclasses it, and a state
        # conflict (a run with no pipeline, say) is the caller's to resolve.
        logger.warning("Conflict executing run %s: %s", run_id, str(e))
        raise HTTPException(status_code=409, detail={
            "code": "conflict",
            "message": sanitize_error_message(e),
        })
    except PipelineError as e:
        logger.error("Pipeline error executing run %s: %s", run_id, str(e))
        raise HTTPException(status_code=500, detail={
            "code": "pipeline_error",
            "message": sanitize_error_message(e),
        })
    except SQLAlchemyError:
        logger.exception("Database error executing run %s", run_id)
        raise HTTPException(status_code=500, detail={
            "code": "database_error",
            "message": "Database error during execution",
        })


# =============================================================================
# Route 6: Republish run
# =============================================================================

@router.post("/api/organizations/{organization_id}/runs/{run_id}/republish", response_model=RunExecuteResponse, summary="Republish run endpoint")
def republish_run_endpoint(
    organization_id: str,
    run_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.RUNS_FORCE_FULL)),
    db: Session = Depends(get_db),
):
    """Republish run endpoint."""
    try:
        org_uuid = UUID(organization_id)
    except ValueError:
        raise HTTPException(status_code=400, detail={
            "code": "invalid_parameter",
            "message": "Invalid organization_id format",
        })

    run = db.query(Run).filter_by(run_id=run_id, organization_id=org_uuid).first()

    if not run:
        raise HTTPException(status_code=404, detail={
            "code": "run_not_found",
            "message": f"Run not found: {run_id}",
        })

    if not execute_limiter.allow(organization_id=organization_id, endpoint="republish"):
        raise HTTPException(status_code=429, detail={
            "code": "rate_limit_exceeded",
            "message": "Too many republish requests. Please wait before trying again.",
            "retry_after": 60,
        })

    try:
        result = republish_run(db, run_id)

        run = db.query(Run).filter_by(run_id=run_id).first()
        response = serialize_run(run)

        if result.status == "success":
            if result.target_url:
                response["target_url"] = result.target_url
            return response
        else:
            if hasattr(result, 'target_url') and result.target_url:
                response["target_url"] = result.target_url
            response["error"] = result.error
            response["error_stage"] = result.error_stage
            return JSONResponse(content=response, status_code=500)

    except RunConflictError as e:
        logger.warning("Conflict republishing run %s: %s", run_id, str(e))
        raise HTTPException(status_code=409, detail={
            "code": "conflict",
            "message": sanitize_error_message(e),
        })
    except PipelineError as e:
        logger.error("Pipeline error republishing run %s: %s", run_id, str(e))
        raise HTTPException(status_code=400, detail={
            "code": "pipeline_error",
            "message": sanitize_error_message(e),
        })
    except SQLAlchemyError:
        logger.exception("Database error republishing run %s", run_id)
        raise HTTPException(status_code=500, detail={
            "code": "database_error",
            "message": "Database error during republish",
        })


# =============================================================================
# Route 7: Retry destination
# =============================================================================

@router.post("/api/organizations/{organization_id}/runs/{run_id}/destinations/{pipeline_destination_id}/retry", response_model=RetryDestinationResponse, summary="Retry destination")
def retry_destination(
    organization_id: str,
    run_id: UUID,
    pipeline_destination_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.RUNS_EXECUTE)),
    db: Session = Depends(get_db),
):
    """Retry destination."""
    try:
        org_uuid = UUID(organization_id)
    except ValueError:
        raise HTTPException(status_code=400, detail={
            "code": "invalid_parameter",
            "message": "Invalid organization_id format",
        })

    run = db.query(Run).filter_by(run_id=run_id, organization_id=org_uuid).first()

    if not run:
        raise HTTPException(status_code=404, detail={
            "code": "run_not_found",
            "message": f"Run {run_id} not found in organization {organization_id}",
        })

    try:
        result = retry_destination_publish(
            session=db,
            run_id=run_id,
            pipeline_destination_id=pipeline_destination_id,
        )

        log_audit_event(
            session=db,
            organization_id=org_uuid,
            acting_user_id=auth.user_id,
            action="destination.retry",
            details={
                "run_id": str(run_id),
                "pipeline_destination_id": str(pipeline_destination_id),
                "step_id": result["step_id"],
                "status": result["status"],
            },
        )

        logger.info(
            "Destination retry completed: run=%s, destination=%s, step=%s, status=%s",
            run_id, pipeline_destination_id, result["step_id"], result["status"],
        )

        return result

    except PipelineError as e:
        raise HTTPException(status_code=400, detail={
            "code": "retry_failed",
            "message": sanitize_error_message(e),
        })


# =============================================================================
# Route 8: List jobs
# =============================================================================

@router.get("/api/jobs", response_model=JobListResponse, summary="List jobs")
def list_jobs(
    organization_id: str | None = None,
    pipeline_id: str | None = None,
    schedule_id: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    auth: AuthContext = Depends(require_permission(Permission.RUNS_VIEW)),
    db: Session = Depends(get_db),
):
    """List jobs."""
    if not organization_id:
        raise HTTPException(status_code=400, detail={
            "error": "Missing required parameter",
            "message": "organization_id is required",
        })

    try:
        org_uuid = UUID(organization_id)
    except ValueError:
        raise HTTPException(status_code=400, detail={
            "code": "invalid_parameter",
            "message": "Invalid organization_id format",
        })

    query = db.query(Job).filter(Job.organization_id == org_uuid)

    if pipeline_id:
        try:
            query = query.filter(Job.pipeline_id == UUID(pipeline_id))
        except ValueError:
            raise HTTPException(status_code=400, detail={
                "code": "invalid_parameter",
                "message": "Invalid pipeline_id format",
            })

    if schedule_id:
        try:
            query = query.filter(Job.schedule_id == UUID(schedule_id))
        except ValueError:
            raise HTTPException(status_code=400, detail={
                "code": "invalid_parameter",
                "message": "Invalid schedule_id format",
            })

    total = query.count()

    query = query.order_by(
        desc(Job.scheduled_for),
        desc(Job.created_at),
    )

    jobs = query.limit(limit).all()

    return {
        "items": [serialize_job(job) for job in jobs],
        "total": total,
        "limit": limit,
    }


# =============================================================================
# Route 9: Get job
# =============================================================================

@router.get("/api/jobs/{job_id}", response_model=JobOut, summary="Get job")
def get_job(
    job_id: UUID,
    organization_id: str | None = None,
    auth: AuthContext = Depends(require_permission(Permission.RUNS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get job."""
    org_id = _resolve_org_id(auth, organization_id)

    try:
        org_uuid = UUID(org_id)
    except ValueError:
        raise HTTPException(status_code=400, detail={
            "code": "invalid_parameter",
            "message": "Invalid organization_id format",
        })

    job = (
        db.query(Job)
        .filter(Job.job_id == job_id, Job.organization_id == org_uuid)
        .first()
    )

    if not job:
        raise HTTPException(status_code=404, detail={
            "error": "Job not found",
            "message": f"No job found with id {job_id}",
        })

    response = serialize_job(job, include_run=True)

    if job.schedule:
        response["schedule"] = {
            "schedule_id": str(job.schedule.schedule_id),
            "enabled": job.schedule.enabled,
            "every_n": job.schedule.every_n,
            "unit": job.schedule.unit,
            "timezone": job.schedule.timezone,
        }

    if job.pipeline:
        response["pipeline"] = {
            "pipeline_id": str(job.pipeline.pipeline_id),
            "name": job.pipeline.name,
        }

    return response


# =============================================================================
# Route 10: Create dataset
# =============================================================================

@router.post("/api/datasets", status_code=201, response_model=RunsDatasetOut, summary="Create dataset")
def create_dataset(
    body: CreateDatasetBody,
    auth: AuthContext = Depends(require_permission(Permission.DATA_MANAGE)),
    db: Session = Depends(get_db),
):
    """Create dataset."""
    try:
        dataset = Dataset(
            organization_id=body.organization_id,
            name=body.name,
            key=body.key,
            description=body.description,
            source_type=body.source_type,
            schema=body.schema_def,
        )

        db.add(dataset)
        db.commit()

        return _serialize_dataset(dataset)

    except IntegrityError as e:
        db.rollback()
        logger.error("Dataset creation failed: %s", e)

        error_str = str(e).lower()
        if "ix_datasets_org_key" in error_str or ("unique constraint" in error_str and "organization_id" in error_str and "key" in error_str):
            raise HTTPException(status_code=409, detail={
                "code": "DUPLICATE_KEY",
                "message": f"Dataset with key '{body.key}' already exists for this organization",
            })

        raise HTTPException(status_code=500, detail={
            "code": "DATABASE_ERROR",
            "message": "Failed to create dataset",
        })


# =============================================================================
# Route 11: List datasets
# =============================================================================

@router.get("/api/datasets", response_model=RunsDatasetListResponse, summary="List datasets")
def list_datasets(
    request: Request,
    organization_id: str | None = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.DATA_VIEW)),
    db: Session = Depends(get_db),
):
    """List datasets in the authorized organization, with per-dataset entity counts.

    `organization_id` defaults to the caller's active org. When supplied
    explicitly it must match — `get_authorized_org_id` 403s otherwise so
    a user can't pivot to another org by passing its UUID in the query
    string. RLS is the second line of defense, but the explicit check
    keeps the error contract loud rather than silent (empty list).
    """
    from app.models import EntityCurrent

    org_uuid = get_authorized_org_id(
        request, auth,
        query_org_id=UUID(organization_id) if organization_id else None,
    )

    # Build entity counts subquery, scoped to the authorized org.
    entity_counts_subquery = db.query(
        EntityCurrent.dataset_id,
        func.count(EntityCurrent.entity_key).label('entity_count'),
    ).group_by(EntityCurrent.dataset_id).filter(
        EntityCurrent.organization_id == org_uuid,
    ).subquery()

    query = db.query(
        Dataset,
        func.coalesce(entity_counts_subquery.c.entity_count, 0).label('entity_count'),
    ).outerjoin(
        entity_counts_subquery,
        Dataset.dataset_id == entity_counts_subquery.c.dataset_id,
    ).filter(Dataset.organization_id == org_uuid)

    total = db.query(Dataset).filter_by(organization_id=org_uuid).count()

    # Apply pagination and fetch
    results = query.order_by(Dataset.created_at.asc()).limit(limit).offset(offset).all()

    datasets_with_counts = []
    for dataset, entity_count in results:
        dataset_dict = _serialize_dataset(dataset)
        dataset_dict['entity_count'] = int(entity_count) if entity_count else 0
        datasets_with_counts.append(dataset_dict)

    return {
        "items": datasets_with_counts,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


# =============================================================================
# Route 12: Get dataset
# =============================================================================

@router.get("/api/datasets/{dataset_id}", response_model=RunsDatasetOut, summary="Get dataset")
def get_dataset(
    dataset_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.DATA_VIEW)),
    db: Session = Depends(get_db),
):
    """Get dataset."""
    dataset = db.query(Dataset).filter_by(dataset_id=dataset_id).first()

    if not dataset:
        raise HTTPException(status_code=404, detail={
            "code": "NOT_FOUND",
            "message": f"Dataset {dataset_id} not found",
        })

    return _serialize_dataset(dataset)


# =============================================================================
# Route 13: Update dataset
# =============================================================================

@router.patch("/api/datasets/{dataset_id}", response_model=RunsDatasetOut, summary="Update dataset")
def update_dataset(
    dataset_id: UUID,
    body: UpdateDatasetBody,
    auth: AuthContext = Depends(require_permission(Permission.DATA_MANAGE)),
    db: Session = Depends(get_db),
):
    """Update dataset."""
    dataset = db.query(Dataset).filter_by(dataset_id=dataset_id).first()

    if not dataset:
        raise HTTPException(status_code=404, detail={
            "code": "NOT_FOUND",
            "message": f"Dataset {dataset_id} not found",
        })

    if body.name is not None:
        dataset.name = body.name
    if body.description is not None:
        dataset.description = body.description

    db.commit()

    return _serialize_dataset(dataset)


# =============================================================================
# Route 14: Preview dataset
# =============================================================================

@router.get("/api/datasets/{dataset_id}/preview", response_model=RunsDatasetPreviewResponse, summary="Preview dataset")
def preview_dataset(
    dataset_id: UUID,
    limit: int = Query(10, ge=1, le=50),
    auth: AuthContext = Depends(require_permission(Permission.DATA_VIEW)),
    db: Session = Depends(get_db),
):
    """Preview dataset."""
    from app.models import EntityCurrent, EntityField

    dataset = db.query(Dataset).filter_by(dataset_id=dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail={
            "code": "NOT_FOUND",
            "message": f"Dataset {dataset_id} not found",
        })

    # Get total count of records in this dataset (excluding deleted)
    total_records = (
        db.query(EntityCurrent)
        .filter_by(dataset_id=dataset_id)
        .filter(EntityCurrent.is_deleted == False)  # noqa: E712
        .count()
    )

    # Get sample records with their display fields
    records_query = (
        db.query(EntityCurrent, EntityField)
        .join(
            EntityField,
            (EntityCurrent.organization_id == EntityField.organization_id) &
            (EntityCurrent.entity_key == EntityField.entity_key),
        )
        .filter(EntityCurrent.dataset_id == dataset_id)
        .filter(EntityCurrent.is_deleted == False)  # noqa: E712
        .order_by(EntityCurrent.last_seen_at.desc())
        .limit(limit)
    )

    sample_records = []
    for entity, fields in records_query:
        sample_records.append({
            "entity_key": entity.entity_key,
            "entity_type": entity.entity_type,
            "title": fields.title,
            "object_number": fields.object_number,
            "thumbnail_url": fields.thumbnail_url,
            "modified_at": fields.modified_at.isoformat() if fields.modified_at else None,
            "last_seen_at": entity.last_seen_at.isoformat() if entity.last_seen_at else None,
        })

    return {
        "dataset_id": str(dataset.dataset_id),
        "name": dataset.name,
        "key": dataset.key,
        "description": dataset.description,
        "source_type": dataset.source_type,
        "schema": dataset.schema,
        "sample_records": sample_records,
        "total_records": total_records,
        "sample_count": len(sample_records),
    }


# =============================================================================
# Route 15: Get dataset schema
# =============================================================================

@router.get("/api/datasets/{dataset_id}/schema", response_model=RunsDatasetSchemaResponse, summary="Get dataset schema")
def get_dataset_schema(
    dataset_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.DATA_VIEW)),
    db: Session = Depends(get_db),
):
    """Get dataset schema."""
    dataset = db.query(Dataset).filter_by(dataset_id=dataset_id).first()

    if not dataset:
        raise HTTPException(status_code=404, detail={
            "code": "NOT_FOUND",
            "message": f"Dataset not found: {dataset_id}",
        })

    return {
        "dataset_id": str(dataset.dataset_id),
        "schema_ref": {
            "schema_id": f"dataset-{dataset.dataset_id}",
            "schema_version": "1.0",
            "schema_json": dataset.schema or {},
        },
    }
