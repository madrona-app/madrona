"""
Entity browsing API endpoints (FastAPI).

Provides read-only access to canonical entity data for UI browsing.
Migrated from app/api/entities.py.
"""

import base64
import logging
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import or_, and_, func
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission, get_authorized_org_id
from app.models import (
    EntityCurrent, EntityField, ChangeEvent, FieldDiff, Pipeline, Dataset,
    Run, ConnectorInstance, ConnectorDefinition,
)
from app.permissions import Permission
from app.services.api_security import escape_ilike
from app.services.validation_utils import parse_uuid_or_raise
from app.fastapi_app.schemas.entities import (
    EntityTypeListResponse,
    EntityListResponse,
    EntityHistoryResponse,
    EntityDetailResponse,
    RunChangesResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["entities"])


def get_display_profile(pipeline: Pipeline | None) -> dict:
    """Extract display profile from pipeline options with sensible defaults."""
    defaults = {
        "primary_field": "title",
        "secondary_field": "object_number",
        "thumbnail_field": "thumbnail_url",
    }
    if not pipeline or not pipeline.options:
        return defaults
    display_config = pipeline.options.get("display", {})
    return {
        "primary_field": display_config.get("primary_field", defaults["primary_field"]),
        "secondary_field": display_config.get("secondary_field", defaults["secondary_field"]),
        "thumbnail_field": display_config.get("thumbnail_field", defaults["thumbnail_field"]),
    }


@router.get("/api/entity-types", response_model=EntityTypeListResponse, summary="List entity types")
def list_entity_types(
    request: Request,
    organization_id: str = Query(..., description="Organization UUID"),
    auth: AuthContext = Depends(require_permission(Permission.DATA_VIEW)),
    db: Session = Depends(get_db),
):
    """List available entity types with counts for an organization."""
    organization_uuid = get_authorized_org_id(request, auth, query_org_id=parse_uuid_or_raise(organization_id, "organization_id"))

    results = (
        db.query(
            EntityCurrent.entity_type,
            func.count(EntityCurrent.entity_key),
        )
        .filter(EntityCurrent.organization_id == organization_uuid)
        .group_by(EntityCurrent.entity_type)
        .order_by(EntityCurrent.entity_type)
        .all()
    )

    return {
        "organization_id": str(organization_uuid),
        "entity_types": [
            {"entity_type": et, "count": count}
            for et, count in results
        ],
    }


@router.get("/api/entities", response_model=EntityListResponse, summary="List entities")
def list_entities(
    request: Request,
    organization_id: str = Query(..., description="Organization UUID"),
    dataset_id: str | None = Query(None),
    entity_type: str | None = Query(None),
    pipeline_id: str | None = Query(None),
    q: str = Query(""),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.DATA_VIEW)),
    db: Session = Depends(get_db),
):
    """List entities with pagination and filtering."""
    org_uuid = get_authorized_org_id(request, auth, query_org_id=parse_uuid_or_raise(organization_id, "organization_id"))
    ds_uuid = parse_uuid_or_raise(dataset_id, "dataset_id") if dataset_id else None
    pl_uuid = parse_uuid_or_raise(pipeline_id, "pipeline_id") if pipeline_id else None

    # Build query
    query = (
        db.query(EntityCurrent, EntityField)
        .outerjoin(
            EntityField,
            (EntityCurrent.organization_id == EntityField.organization_id)
            & (EntityCurrent.entity_key == EntityField.entity_key)
            & (EntityCurrent.entity_type == EntityField.entity_type),
        )
        .filter(EntityCurrent.organization_id == org_uuid)
    )

    if ds_uuid:
        query = query.filter(EntityCurrent.dataset_id == ds_uuid)
    if entity_type:
        query = query.filter(EntityCurrent.entity_type == entity_type)

    pipeline = None
    if pl_uuid:
        pipeline = db.query(Pipeline).filter_by(
            pipeline_id=pl_uuid, organization_id=org_uuid
        ).first()
        if not pipeline:
            raise HTTPException(status_code=404, detail="Pipeline not found or does not belong to this organization")
        query = query.join(Run, EntityCurrent.last_run_id == Run.run_id).filter(
            Run.pipeline_id == pl_uuid
        )

    search_term = q.strip()
    if search_term:
        pattern = f"%{escape_ilike(search_term)}%"
        query = query.filter(
            or_(
                EntityField.title.ilike(pattern, escape="\\"),
                EntityField.object_number.ilike(pattern, escape="\\"),
            )
        )

    total_count = query.count()
    query = query.order_by(EntityField.title.asc()).limit(limit).offset(offset)
    results = query.all()

    display_profile = get_display_profile(pipeline)

    entities = []
    for entity_current, entity_field in results:
        entities.append({
            "entity_key": entity_current.entity_key,
            "entity_type": entity_current.entity_type,
            "dataset_id": str(entity_current.dataset_id) if entity_current.dataset_id else None,
            "source_system": entity_current.source_system,
            "title": entity_field.title if entity_field else None,
            "object_number": entity_field.object_number if entity_field else None,
            "modified_at": entity_field.modified_at.isoformat() if entity_field and entity_field.modified_at else None,
            "thumbnail_url": entity_field.thumbnail_url if entity_field else None,
            "canonical_url": entity_current.canonical_url,
            "last_seen_at": entity_current.last_seen_at.isoformat() if entity_current.last_seen_at else None,
            "last_run_id": str(entity_current.last_run_id) if entity_current.last_run_id else None,
            "payload": entity_current.payload,
        })

    return {
        "organization_id": str(org_uuid),
        "entity_type": entity_type,
        "display": display_profile,
        "items": entities,
        "limit": limit,
        "offset": offset,
        "total": total_count,
    }


@router.get("/api/entities/{entity_key:path}/history", response_model=EntityHistoryResponse, summary="Get entity history")
def get_entity_history(
    request: Request,
    entity_key: str,
    organization_id: str = Query(..., description="Organization UUID"),
    limit: int = Query(20, ge=1, le=100),
    cursor: str | None = Query(None),
    auth: AuthContext = Depends(require_permission(Permission.DATA_VIEW)),
    db: Session = Depends(get_db),
):
    """Get change history for a specific entity (cursor-paginated)."""
    org_uuid = get_authorized_org_id(request, auth, query_org_id=parse_uuid_or_raise(organization_id, "organization_id"))

    # Parse cursor
    cursor_occurred_at = None
    cursor_change_id = None
    if cursor:
        try:
            decoded = base64.urlsafe_b64decode(cursor.encode()).decode()
            parts = decoded.split("|", 1)
            if len(parts) == 2:
                cursor_occurred_at = datetime.fromisoformat(parts[0].replace("Z", "+00:00"))
                cursor_change_id = UUID(parts[1])
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="Invalid cursor format")

    # Verify entity exists
    entity = db.query(EntityCurrent).filter_by(
        organization_id=org_uuid, entity_key=entity_key
    ).first()
    if not entity:
        raise HTTPException(status_code=404, detail=f"Entity not found: {entity_key}")

    # Build query for change events
    query = (
        db.query(ChangeEvent, Pipeline, Dataset.name.label("dataset_name"), Run)
        .outerjoin(Pipeline, ChangeEvent.pipeline_id == Pipeline.pipeline_id)
        .outerjoin(Dataset, ChangeEvent.dataset_id == Dataset.dataset_id)
        .outerjoin(Run, ChangeEvent.run_id == Run.run_id)
        .filter(ChangeEvent.organization_id == org_uuid)
        .filter(ChangeEvent.entity_key == entity_key)
        .filter(ChangeEvent.change_type.in_(["created", "updated", "deleted"]))
    )

    if cursor_occurred_at and cursor_change_id:
        query = query.filter(
            or_(
                ChangeEvent.occurred_at < cursor_occurred_at,
                and_(
                    ChangeEvent.occurred_at == cursor_occurred_at,
                    ChangeEvent.change_id < cursor_change_id,
                ),
            )
        )

    # Total count (without cursor filter)
    total_count = (
        db.query(ChangeEvent)
        .filter(ChangeEvent.organization_id == org_uuid)
        .filter(ChangeEvent.entity_key == entity_key)
        .filter(ChangeEvent.change_type.in_(["created", "updated", "deleted"]))
        .count()
    )

    query = query.order_by(
        ChangeEvent.occurred_at.desc(), ChangeEvent.change_id.desc()
    )

    results = query.limit(limit + 1).all()
    has_more = len(results) > limit
    results = results[:limit]

    # Pre-fetch connector info
    run_ids = [r[3].run_id for r in results if r[3] is not None]
    connector_info_cache = {}
    if run_ids:
        connector_instances = (
            db.query(
                Run.run_id,
                ConnectorInstance.name.label("connector_name"),
                ConnectorDefinition.display_name.label("definition_name"),
            )
            .join(ConnectorInstance, Run.source_connector_instance_id == ConnectorInstance.connector_instance_id)
            .join(ConnectorDefinition, ConnectorInstance.connector_definition_id == ConnectorDefinition.connector_definition_id)
            .filter(Run.run_id.in_(run_ids))
            .all()
        )
        connector_info_cache = {
            str(ci.run_id): {"connector_name": ci.connector_name, "definition_name": ci.definition_name}
            for ci in connector_instances
        }

    # Serialize
    event_type_map = {"created": "Created", "updated": "Updated", "deleted": "Deleted"}
    events = []
    for change, pipeline, dataset_name, run in results:
        field_diffs = db.query(FieldDiff).filter_by(change_id=change.change_id).all()

        origin_type = "pipeline_run"
        source_label = None
        if run:
            run_id_str = str(run.run_id)
            if run_id_str in connector_info_cache:
                ci = connector_info_cache[run_id_str]
                source_label = ci.get("connector_name") or ci.get("definition_name")
            if run.triggered_by == "api":
                origin_type = "api"
            elif run.triggered_by == "manual":
                origin_type = "manual"

        events.append({
            "change_id": str(change.change_id),
            "occurred_at": change.occurred_at.isoformat(),
            "event_type": event_type_map.get(change.change_type, change.change_type.capitalize()),
            "origin_type": origin_type,
            "source_label": source_label,
            "pipeline_name": pipeline.name if pipeline else None,
            "dataset_name": dataset_name,
            "run_id": str(change.run_id) if change.run_id else None,
            "changed_fields": change.changed_fields,
            "old_hash": change.old_hash,
            "new_hash": change.new_hash,
            "summary": change.summary,
            "field_diffs": [
                {
                    "field_name": d.field_name,
                    "old_value": d.old_value,
                    "new_value": d.new_value,
                    "array_delta": d.array_delta,
                }
                for d in field_diffs
            ],
        })

    next_cursor = None
    if has_more and results:
        last = results[-1][0]
        cursor_str = f"{last.occurred_at.isoformat()}|{str(last.change_id)}"
        next_cursor = base64.urlsafe_b64encode(cursor_str.encode()).decode()

    return {
        "entity_key": entity_key,
        "items": events,
        "next_cursor": next_cursor,
        "has_more": has_more,
        "total": total_count,
    }


@router.get("/api/entities/{entity_key:path}", response_model=EntityDetailResponse, summary="Get entity")
def get_entity(
    request: Request,
    entity_key: str,
    organization_id: str = Query(..., description="Organization UUID"),
    auth: AuthContext = Depends(require_permission(Permission.DATA_VIEW)),
    db: Session = Depends(get_db),
):
    """Get full entity details including canonical payload and projected fields."""
    org_uuid = get_authorized_org_id(request, auth, query_org_id=parse_uuid_or_raise(organization_id, "organization_id"))

    entity_current = db.query(EntityCurrent).filter_by(
        organization_id=org_uuid, entity_key=entity_key
    ).first()
    if not entity_current:
        raise HTTPException(status_code=404, detail=f"Entity not found: {entity_key}")

    entity_field = db.query(EntityField).filter_by(
        organization_id=org_uuid,
        entity_key=entity_key,
        entity_type=entity_current.entity_type,
    ).first()

    return {
        "entity_key": entity_current.entity_key,
        "entity_type": entity_current.entity_type,
        "dataset_id": str(entity_current.dataset_id) if entity_current.dataset_id else None,
        "source_system": entity_current.source_system,
        "source_id": entity_current.source_id,
        "canonical_url": entity_current.canonical_url,
        "payload": entity_current.payload,
        "payload_hash": entity_current.payload_hash,
        "extracted_at": entity_current.extracted_at.isoformat() if entity_current.extracted_at else None,
        "last_seen_at": entity_current.last_seen_at.isoformat() if entity_current.last_seen_at else None,
        "last_run_id": str(entity_current.last_run_id) if entity_current.last_run_id else None,
        "is_deleted": entity_current.is_deleted,
        "deleted_at": entity_current.deleted_at.isoformat() if entity_current.deleted_at else None,
        "fields": {
            "title": entity_field.title if entity_field else None,
            "object_number": entity_field.object_number if entity_field else None,
            "modified_at": entity_field.modified_at.isoformat() if entity_field and entity_field.modified_at else None,
            "thumbnail_url": entity_field.thumbnail_url if entity_field else None,
        },
    }


@router.get("/api/organizations/{organization_id}/runs/{run_id}/changes", response_model=RunChangesResponse, summary="Get run changes")
def get_run_changes(
    organization_id: str,
    run_id: str,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.RUNS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get change events for a run with field diffs inlined."""
    run_uuid = parse_uuid_or_raise(run_id, "run_id")
    org_uuid = parse_uuid_or_raise(organization_id, "organization_id")

    run = db.query(Run).filter_by(run_id=run_uuid, organization_id=org_uuid).first()
    if not run:
        raise HTTPException(status_code=404, detail=f"Run not found: {run_id}")

    query = (
        db.query(ChangeEvent, Pipeline, Dataset.name.label("dataset_name"))
        .outerjoin(Pipeline, ChangeEvent.pipeline_id == Pipeline.pipeline_id)
        .outerjoin(Dataset, ChangeEvent.dataset_id == Dataset.dataset_id)
        .filter(ChangeEvent.run_id == run_uuid)
        .order_by(ChangeEvent.occurred_at.desc())
    )

    total_count = query.count()
    query = query.limit(limit).offset(offset)
    results = query.all()

    changes = []
    for change, pipeline, dataset_name in results:
        field_diffs = db.query(FieldDiff).filter_by(change_id=change.change_id).all()
        changes.append({
            "change_id": str(change.change_id),
            "occurred_at": change.occurred_at.isoformat(),
            "entity_key": change.entity_key,
            "entity_type": change.entity_type,
            "change_type": change.change_type,
            "applied": change.applied,
            "changed_fields": change.changed_fields,
            "old_hash": change.old_hash,
            "new_hash": change.new_hash,
            "summary": change.summary,
            "error_code": change.error_code,
            "error_message": change.error_message,
            "pipeline_name": pipeline.name if pipeline else None,
            "dataset_name": dataset_name,
            "field_diffs": [
                {
                    "field_name": d.field_name,
                    "old_value": d.old_value,
                    "new_value": d.new_value,
                    "array_delta": d.array_delta,
                }
                for d in field_diffs
            ],
        })

    return {
        "items": changes,
        "limit": limit,
        "offset": offset,
        "total": total_count,
    }
