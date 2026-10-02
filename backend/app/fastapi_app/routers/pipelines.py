"""
Pipelines API — FastAPI router.

Migrated from app/api/pipelines.py (11 routes).
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy import desc
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_auth, require_permission
from app.fastapi_app.schemas.pipelines import (
    CreatePipelineBody,
    UpdatePipelineBody,
    CreateScheduleBody,
    UpdateScheduleBody,
    PipelineOut,
    PipelineScheduleResponse,
    ScheduleOut,
)
from app.models import (
    Pipeline,
    PipelineSource,
    PipelineDestination,
    Schedule,
    Job,
    Organization,
)
from app.permissions import Permission
from app.services.api_security import sanitize_error_message

logger = logging.getLogger(__name__)

router = APIRouter()


def _serialize_pipeline(pipeline: Pipeline) -> dict:
    """Serialize a Pipeline model to API response format."""
    return {
        "pipeline_id": str(pipeline.pipeline_id),
        "organization_id": str(pipeline.organization_id),
        "name": pipeline.name,
        "sources": [
            {
                "source_id": str(s.source_id),
                "connector_instance_id": str(s.connector_instance_id),
                "enabled": s.enabled,
                "parameters": s.parameters,
                "ordering": s.ordering,
            }
            for s in pipeline.sources
        ],
        "destinations": [
            {
                "destination_id": str(d.destination_id),
                "connector_instance_id": str(d.connector_instance_id),
                "enabled": d.enabled,
                "parameters": d.parameters,
                "ordering": d.ordering,
            }
            for d in pipeline.destinations
        ],
        "dataset_id": str(pipeline.dataset_id) if pipeline.dataset_id else None,
        "status": pipeline.status,
        "created_at": pipeline.created_at.isoformat(),
    }


def _serialize_schedule(schedule: Schedule) -> dict:
    """Serialize a Schedule model to API response format."""
    return {
        "schedule_id": str(schedule.schedule_id),
        "pipeline_id": str(schedule.pipeline_id),
        "enabled": schedule.enabled,
        "type": schedule.type,
        "every_n": schedule.every_n,
        "unit": schedule.unit,
        "time_hour": schedule.time_hour,
        "time_minute": schedule.time_minute,
        "timezone": schedule.timezone,
        "created_at": schedule.created_at.isoformat(),
        "updated_at": schedule.updated_at.isoformat(),
    }


def _get_pipeline_for_org(
    db: Session, pipeline_id: UUID, organization_id: str,
) -> Pipeline | None:
    """Fetch pipeline with tenant isolation."""
    return db.query(Pipeline).filter_by(
        pipeline_id=pipeline_id,
        organization_id=organization_id,
    ).first()


def _require_org_id(org_id: str | None) -> str:
    """Raise 400 if org_id is missing."""
    if not org_id:
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": "Organization context required",
        })
    return org_id


def _resolve_org_id(auth: AuthContext, explicit: str | None = None) -> str:
    """Resolve organization_id from explicit value or auth context."""
    return _require_org_id(
        explicit or (str(auth.active_organization_id) if auth.active_organization_id else None)
    )


# =============================================================================
# Route 1: List pipelines
# =============================================================================

@router.get("/api/pipelines", response_model=list[PipelineOut], summary="List pipelines")
def list_pipelines(
    organization_id: str | None = None,
    auth: AuthContext = Depends(require_permission(Permission.PIPELINES_VIEW)),
    db: Session = Depends(get_db),
):
    """List pipelines."""
    org_id = _resolve_org_id(auth, organization_id)

    pipelines = (
        db.query(Pipeline)
        .options(
            joinedload(Pipeline.sources).joinedload(PipelineSource.connector_instance),
            joinedload(Pipeline.destinations).joinedload(PipelineDestination.connector_instance),
            joinedload(Pipeline.dataset),
        )
        .filter_by(organization_id=org_id)
        .order_by(Pipeline.created_at.desc())
        .all()
    )

    return [_serialize_pipeline(p) for p in pipelines]


# =============================================================================
# Route 2: Get pipeline by org + id
# =============================================================================

@router.get("/api/organizations/{organization_id}/pipelines/{pipeline_id}", response_model=PipelineOut, summary="Get pipeline")
def get_pipeline(
    organization_id: str,
    pipeline_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.PIPELINES_VIEW)),
    db: Session = Depends(get_db),
):
    """Get pipeline."""
    pipeline = (
        db.query(Pipeline)
        .options(
            joinedload(Pipeline.sources).joinedload(PipelineSource.connector_instance),
            joinedload(Pipeline.destinations).joinedload(PipelineDestination.connector_instance),
            joinedload(Pipeline.dataset),
        )
        .filter_by(pipeline_id=pipeline_id, organization_id=organization_id)
        .first()
    )

    if not pipeline:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Pipeline not found",
        })

    return _serialize_pipeline(pipeline)


# =============================================================================
# Route 3: Create pipeline
# =============================================================================

@router.post("/api/pipelines", status_code=201, response_model=PipelineOut, summary="Create pipeline")
def create_pipeline(
    body: CreatePipelineBody,
    auth: AuthContext = Depends(require_permission(Permission.PIPELINES_EDIT)),
    db: Session = Depends(get_db),
):
    """Create pipeline."""
    if not body.sources:
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": "sources must be a non-empty array",
        })

    try:
        pipeline = Pipeline(
            organization_id=body.organization_id,
            dataset_id=body.dataset_id,
            status=body.status,
        )
        db.add(pipeline)
        db.flush()

        for i, source_data in enumerate(body.sources):
            source = PipelineSource(
                pipeline_id=pipeline.pipeline_id,
                connector_instance_id=source_data.connector_instance_id,
                enabled=source_data.enabled,
                parameters=source_data.parameters or {},
                ordering=source_data.ordering if source_data.ordering != 0 else i,
            )
            db.add(source)

        for i, dest_data in enumerate(body.destinations):
            destination = PipelineDestination(
                pipeline_id=pipeline.pipeline_id,
                connector_instance_id=dest_data.connector_instance_id,
                enabled=dest_data.enabled,
                parameters=dest_data.parameters or {},
                ordering=dest_data.ordering if dest_data.ordering != 0 else i,
            )
            db.add(destination)

        db.commit()
        db.refresh(pipeline)

        return _serialize_pipeline(pipeline)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail={
            "code": "internal_error",
            "message": f"Failed to create pipeline: {sanitize_error_message(e)}",
        })


# =============================================================================
# Route 4: Update pipeline
# =============================================================================

@router.patch("/api/pipelines/{pipeline_id}", response_model=PipelineOut, summary="Update pipeline")
@router.put("/api/pipelines/{pipeline_id}", response_model=PipelineOut)
def update_pipeline(
    pipeline_id: UUID,
    body: UpdatePipelineBody,
    auth: AuthContext = Depends(require_permission(Permission.PIPELINES_EDIT)),
    db: Session = Depends(get_db),
):
    """Update pipeline."""
    org_id = _resolve_org_id(
        auth,
        str(body.organization_id) if body.organization_id else None,
    )

    pipeline = _get_pipeline_for_org(db, pipeline_id, org_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Pipeline not found",
        })

    try:
        if body.dataset_id is not None:
            pipeline.dataset_id = body.dataset_id
        if body.status is not None:
            pipeline.status = body.status

        if body.sources is not None:
            for source in pipeline.sources:
                db.delete(source)
            db.flush()

            for i, source_data in enumerate(body.sources):
                source = PipelineSource(
                    pipeline_id=pipeline.pipeline_id,
                    connector_instance_id=source_data.connector_instance_id,
                    enabled=source_data.enabled,
                    parameters=source_data.parameters or {},
                    ordering=source_data.ordering if source_data.ordering != 0 else i,
                )
                db.add(source)

        if body.destinations is not None:
            for dest in pipeline.destinations:
                db.delete(dest)
            db.flush()

            for i, dest_data in enumerate(body.destinations):
                destination = PipelineDestination(
                    pipeline_id=pipeline.pipeline_id,
                    connector_instance_id=dest_data.connector_instance_id,
                    enabled=dest_data.enabled,
                    parameters=dest_data.parameters or {},
                    ordering=dest_data.ordering if dest_data.ordering != 0 else i,
                )
                db.add(destination)

        db.commit()
        db.refresh(pipeline)

        return _serialize_pipeline(pipeline)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail={
            "code": "internal_error",
            "message": f"Failed to update pipeline: {sanitize_error_message(e)}",
        })


# =============================================================================
# Route 5: Delete pipeline
# =============================================================================

@router.delete("/api/pipelines/{pipeline_id}", status_code=204, summary="Delete pipeline")
def delete_pipeline(
    pipeline_id: UUID,
    organization_id: str | None = None,
    auth: AuthContext = Depends(require_permission(Permission.PIPELINES_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete pipeline."""
    org_id = _resolve_org_id(auth, organization_id)

    pipeline = _get_pipeline_for_org(db, pipeline_id, org_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Pipeline not found",
        })

    db.delete(pipeline)
    db.commit()


# =============================================================================
# Route 6: Get pipeline schedule
# =============================================================================

@router.get("/api/pipelines/{pipeline_id}/schedule", response_model=PipelineScheduleResponse, summary="Get pipeline schedule")
def get_pipeline_schedule(
    pipeline_id: UUID,
    organization_id: str | None = None,
    auth: AuthContext = Depends(require_permission(Permission.PIPELINES_VIEW)),
    db: Session = Depends(get_db),
):
    """Get pipeline schedule."""
    from app.services.schedule_utils import compute_next_run_at

    org_id = _resolve_org_id(auth, organization_id)

    pipeline = _get_pipeline_for_org(db, pipeline_id, org_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Pipeline not found",
        })

    schedule = db.query(Schedule).filter_by(pipeline_id=pipeline_id).first()

    if not schedule:
        return {"schedule": None}

    last_job = (
        db.query(Job)
        .filter_by(schedule_id=schedule.schedule_id)
        .order_by(desc(Job.created_at))
        .first()
    )

    next_run_at = None
    if schedule.enabled:
        next_run_at = compute_next_run_at(schedule, last_job)

    response = {
        "schedule": {
            **_serialize_schedule(schedule),
            "next_run_at": next_run_at.isoformat() if next_run_at else None,
        },
    }

    if last_job:
        response["schedule"]["last_job"] = {
            "job_id": str(last_job.job_id),
            "status": last_job.status,
            "scheduled_for": last_job.scheduled_for.isoformat() if last_job.scheduled_for else None,
            "run_id": str(last_job.run_id) if last_job.run_id else None,
            "created_at": last_job.created_at.isoformat(),
            "completed_at": last_job.finished_at.isoformat() if last_job.finished_at else None,
        }

    return response


# =============================================================================
# Route 7: Create pipeline schedule
# =============================================================================

@router.post("/api/pipelines/{pipeline_id}/schedule", status_code=201, response_model=ScheduleOut, summary="Create pipeline schedule")
def create_pipeline_schedule(
    pipeline_id: UUID,
    body: CreateScheduleBody,
    auth: AuthContext = Depends(require_permission(Permission.SCHEDULES_MANAGE)),
    db: Session = Depends(get_db),
):
    """Create pipeline schedule."""
    org_id = _resolve_org_id(auth)

    # Validate based on schedule type
    if body.type == "interval":
        if body.every_n is None or body.unit is None:
            raise HTTPException(status_code=400, detail={
                "code": "bad_request",
                "message": "Missing required fields for interval schedule: every_n, unit",
            })
        valid_units = ["minutes", "hours", "days"]
        if body.unit not in valid_units:
            raise HTTPException(status_code=422, detail={
                "code": "validation_error",
                "message": f'Invalid unit. Must be one of: {", ".join(valid_units)}',
                "field": "unit",
            })
        if body.every_n < 1:
            raise HTTPException(status_code=422, detail={
                "code": "validation_error",
                "message": "every_n must be a positive integer",
                "field": "every_n",
            })
    elif body.type == "time":
        if body.time_hour is None or body.time_minute is None:
            raise HTTPException(status_code=400, detail={
                "code": "bad_request",
                "message": "Missing required fields for time-based schedule: time_hour, time_minute",
            })
        if body.time_hour < 0 or body.time_hour > 23:
            raise HTTPException(status_code=422, detail={
                "code": "validation_error",
                "message": "time_hour must be an integer between 0 and 23",
                "field": "time_hour",
            })
        if body.time_minute < 0 or body.time_minute > 59:
            raise HTTPException(status_code=422, detail={
                "code": "validation_error",
                "message": "time_minute must be an integer between 0 and 59",
                "field": "time_minute",
            })
    else:
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": 'Invalid schedule type. Must be "interval" or "time"',
            "field": "type",
        })

    pipeline = _get_pipeline_for_org(db, pipeline_id, org_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Pipeline not found",
        })

    # Get organization for default timezone
    org = db.query(Organization).filter_by(organization_id=pipeline.organization_id).first()
    default_timezone = org.timezone if org else "UTC"

    # Check if schedule already exists
    existing = db.query(Schedule).filter_by(pipeline_id=pipeline_id).first()
    if existing:
        raise HTTPException(status_code=409, detail={
            "code": "conflict",
            "message": "Schedule already exists for this pipeline",
        })

    schedule = Schedule(
        organization_id=pipeline.organization_id,
        pipeline_id=pipeline_id,
        enabled=body.enabled,
        type=body.type,
        every_n=body.every_n if body.type == "interval" else None,
        unit=body.unit if body.type == "interval" else None,
        time_hour=body.time_hour if body.type == "time" else None,
        time_minute=body.time_minute if body.type == "time" else None,
        timezone=body.timezone or default_timezone,
        created_by_user_id=auth.user_id,
        updated_by_user_id=auth.user_id,
    )

    db.add(schedule)
    db.flush()

    job = Job(
        organization_id=pipeline.organization_id,
        pipeline_id=pipeline_id,
        schedule_id=schedule.schedule_id,
        job_type="scheduled_pipeline_execution",
        status="queued" if schedule.enabled else "canceled",
        priority=100,
        payload={
            "schedule_type": schedule.type,
            "every_n": schedule.every_n,
            "unit": schedule.unit,
            "time_hour": schedule.time_hour,
            "time_minute": schedule.time_minute,
            "timezone": schedule.timezone,
        },
    )
    db.add(job)
    db.commit()
    db.refresh(schedule)

    return _serialize_schedule(schedule)


# =============================================================================
# Route 8: Update pipeline schedule
# =============================================================================

@router.patch("/api/pipelines/{pipeline_id}/schedule", response_model=ScheduleOut, summary="Update pipeline schedule")
def update_pipeline_schedule(
    pipeline_id: UUID,
    body: UpdateScheduleBody,
    auth: AuthContext = Depends(require_permission(Permission.SCHEDULES_MANAGE)),
    db: Session = Depends(get_db),
):
    """Update pipeline schedule."""
    org_id = _resolve_org_id(auth)

    pipeline = _get_pipeline_for_org(db, pipeline_id, org_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Pipeline not found",
        })

    schedule = db.query(Schedule).filter_by(pipeline_id=pipeline_id).first()
    if not schedule:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Schedule not found",
        })

    # Validate and update fields
    if body.type is not None:
        valid_types = ["interval", "time"]
        if body.type not in valid_types:
            raise HTTPException(status_code=422, detail={
                "code": "validation_error",
                "message": f'Invalid type. Must be one of: {", ".join(valid_types)}',
                "field": "type",
            })
        schedule.type = body.type

    if body.every_n is not None:
        if body.every_n < 1:
            raise HTTPException(status_code=422, detail={
                "code": "validation_error",
                "message": "every_n must be a positive integer",
                "field": "every_n",
            })
        schedule.every_n = body.every_n

    if body.unit is not None:
        valid_units = ["minutes", "hours", "days"]
        if body.unit not in valid_units:
            raise HTTPException(status_code=422, detail={
                "code": "validation_error",
                "message": f'Invalid unit. Must be one of: {", ".join(valid_units)}',
                "field": "unit",
            })
        schedule.unit = body.unit

    if body.time_hour is not None:
        if body.time_hour < 0 or body.time_hour > 23:
            raise HTTPException(status_code=422, detail={
                "code": "validation_error",
                "message": "time_hour must be an integer between 0 and 23",
                "field": "time_hour",
            })
        schedule.time_hour = body.time_hour

    if body.time_minute is not None:
        if body.time_minute < 0 or body.time_minute > 59:
            raise HTTPException(status_code=422, detail={
                "code": "validation_error",
                "message": "time_minute must be an integer between 0 and 59",
                "field": "time_minute",
            })
        schedule.time_minute = body.time_minute

    if body.timezone is not None:
        schedule.timezone = body.timezone

    if body.enabled is not None:
        schedule.enabled = body.enabled

    schedule.updated_by_user_id = auth.user_id

    # Update corresponding job
    job = db.query(Job).filter_by(schedule_id=schedule.schedule_id).first()
    if job:
        job.status = "queued" if schedule.enabled else "canceled"
        job.payload = {
            "schedule_type": schedule.type,
            "every_n": schedule.every_n,
            "unit": schedule.unit,
            "time_hour": schedule.time_hour,
            "time_minute": schedule.time_minute,
            "timezone": schedule.timezone,
        }

    db.commit()
    db.refresh(schedule)

    return _serialize_schedule(schedule)


# =============================================================================
# Route 9: Delete pipeline schedule
# =============================================================================

@router.delete("/api/pipelines/{pipeline_id}/schedule", status_code=204, summary="Delete pipeline schedule")
def delete_pipeline_schedule(
    pipeline_id: UUID,
    organization_id: str | None = None,
    auth: AuthContext = Depends(require_permission(Permission.SCHEDULES_MANAGE)),
    db: Session = Depends(get_db),
):
    """Delete pipeline schedule."""
    org_id = _resolve_org_id(auth, organization_id)

    pipeline = _get_pipeline_for_org(db, pipeline_id, org_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Pipeline not found",
        })

    schedule = db.query(Schedule).filter_by(pipeline_id=pipeline_id).first()
    if not schedule:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Schedule not found",
        })

    # Delete corresponding job
    job = db.query(Job).filter_by(schedule_id=schedule.schedule_id).first()
    if job:
        db.delete(job)

    db.delete(schedule)
    db.commit()


# =============================================================================
# Route 10: Enable pipeline schedule
# =============================================================================

@router.post("/api/pipelines/{pipeline_id}/schedule/enable", response_model=ScheduleOut, summary="Enable pipeline schedule")
def enable_pipeline_schedule(
    pipeline_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.SCHEDULES_MANAGE)),
    db: Session = Depends(get_db),
):
    """Enable pipeline schedule."""
    org_id = _resolve_org_id(auth)

    pipeline = _get_pipeline_for_org(db, pipeline_id, org_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Pipeline not found",
        })

    schedule = db.query(Schedule).filter_by(pipeline_id=pipeline_id).first()
    if not schedule:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Schedule not found",
        })

    schedule.enabled = True
    schedule.updated_by_user_id = auth.user_id

    job = db.query(Job).filter_by(schedule_id=schedule.schedule_id).first()
    if job:
        job.status = "queued"

    db.commit()
    db.refresh(schedule)

    return _serialize_schedule(schedule)


# =============================================================================
# Route 11: Disable pipeline schedule
# =============================================================================

@router.post("/api/pipelines/{pipeline_id}/schedule/disable", response_model=ScheduleOut, summary="Disable pipeline schedule")
def disable_pipeline_schedule(
    pipeline_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.SCHEDULES_MANAGE)),
    db: Session = Depends(get_db),
):
    """Disable pipeline schedule."""
    org_id = _resolve_org_id(auth)

    pipeline = _get_pipeline_for_org(db, pipeline_id, org_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Pipeline not found",
        })

    schedule = db.query(Schedule).filter_by(pipeline_id=pipeline_id).first()
    if not schedule:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Schedule not found",
        })

    schedule.enabled = False
    schedule.updated_by_user_id = auth.user_id

    job = db.query(Job).filter_by(schedule_id=schedule.schedule_id).first()
    if job:
        job.status = "canceled"

    db.commit()
    db.refresh(schedule)

    return _serialize_schedule(schedule)
