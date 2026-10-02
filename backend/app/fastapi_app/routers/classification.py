"""
Classification API endpoints (FastAPI).

Provides endpoints to trigger and monitor background entity classification tasks.
Migrated from app/api/classification.py.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission, get_authorized_org_id
from app.models import EntityCurrent, Dataset
from app.permissions import Permission
from app.services.api_security import sanitize_error_message
from app.services.validation_utils import parse_uuid_or_raise
from app.tasks.classification import classify_entity_task, classify_dataset_task
from app.fastapi_app.schemas.classification import (
    ClassifyDatasetResponse,
    ClassifyEntityResponse,
    ClassificationStatusResponse,
    ClassifyOrganizationResponse,
    ClassificationStatsResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["classification"])


class ClassifyBody(BaseModel):
    force_ai: bool = False


@router.post("/api/datasets/{dataset_id}/classify", status_code=202, response_model=ClassifyDatasetResponse, summary="Classify dataset")
def classify_dataset(
    dataset_id: str,
    body: ClassifyBody | None = None,
    auth: AuthContext = Depends(require_permission(Permission.DATA_MANAGE)),
    db: Session = Depends(get_db),
):
    """Trigger classification for all entities in a dataset (async, 202)."""
    dataset_uuid = parse_uuid_or_raise(dataset_id, "dataset_id")

    dataset = db.query(Dataset).filter_by(dataset_id=dataset_uuid).first()
    if not dataset:
        raise HTTPException(status_code=404, detail=f"Dataset {dataset_id} not found")

    force_ai = body.force_ai if body else False

    task = classify_dataset_task.delay(
        dataset_id=str(dataset_uuid),
        organization_id=str(dataset.organization_id),
        force_ai=force_ai,
    )

    entity_count = (
        db.query(func.count(EntityCurrent.entity_key))
        .filter_by(dataset_id=dataset_uuid)
        .scalar()
    )

    logger.info("Queued classification for dataset %s (%s entities), task_id=%s", dataset_id, entity_count, task.id)

    return {
        "dataset_id": str(dataset_uuid),
        "queued": entity_count,
        "task_id": task.id,
        "message": "Classification tasks queued",
    }


@router.post("/api/entities/{entity_key:path}/classify", status_code=202, response_model=ClassifyEntityResponse, summary="Classify entity")
def classify_entity(
    request: Request,
    entity_key: str,
    organization_id: str = Query(..., description="Organization UUID"),
    body: ClassifyBody | None = None,
    auth: AuthContext = Depends(require_permission(Permission.DATA_MANAGE)),
    db: Session = Depends(get_db),
):
    """Trigger classification for a single entity (async, 202)."""
    org_uuid = get_authorized_org_id(request, auth, query_org_id=parse_uuid_or_raise(organization_id, "organization_id"))

    entity = db.query(EntityCurrent).filter_by(
        organization_id=org_uuid, entity_key=entity_key
    ).first()
    if not entity:
        raise HTTPException(status_code=404, detail=f"Entity {entity_key} not found")

    force_ai = body.force_ai if body else False

    task = classify_entity_task.delay(
        entity_key=entity_key,
        organization_id=str(org_uuid),
        force_ai=force_ai,
    )

    logger.info("Queued classification for entity %s, task_id=%s", entity_key, task.id)

    return {
        "entity_key": entity_key,
        "task_id": task.id,
        "message": "Classification task queued",
    }


@router.get("/api/datasets/{dataset_id}/classification-status", response_model=ClassificationStatusResponse, summary="Get dataset classification status")
def get_dataset_classification_status(
    dataset_id: str,
    auth: AuthContext = Depends(require_permission(Permission.DATA_VIEW)),
    db: Session = Depends(get_db),
):
    """Get classification status for entities in a dataset."""
    dataset_uuid = parse_uuid_or_raise(dataset_id, "dataset_id")

    dataset = db.query(Dataset).filter_by(dataset_id=dataset_uuid).first()
    if not dataset:
        raise HTTPException(status_code=404, detail=f"Dataset {dataset_id} not found")

    results = (
        db.query(EntityCurrent.entity_type, func.count(EntityCurrent.entity_key))
        .filter(EntityCurrent.dataset_id == dataset_uuid)
        .group_by(EntityCurrent.entity_type)
        .all()
    )

    by_type = {entity_type: count for entity_type, count in results}
    total = sum(by_type.values())
    unclassified_count = by_type.get("unclassified", 0)

    return {
        "dataset_id": str(dataset_uuid),
        "total": total,
        "by_type": by_type,
        "unclassified_count": unclassified_count,
        "classification_complete": unclassified_count == 0,
    }


@router.post("/api/organizations/{organization_id}/classify-all", status_code=202, response_model=ClassifyOrganizationResponse, summary="Classify organization")
def classify_organization(
    organization_id: str,
    body: ClassifyBody | None = None,
    auth: AuthContext = Depends(require_permission(Permission.DATA_MANAGE)),
    db: Session = Depends(get_db),
):
    """Trigger classification for all entities in an organization (async, 202)."""
    org_uuid = parse_uuid_or_raise(organization_id, "organization_id")
    force_ai = body.force_ai if body else False

    entities = (
        db.query(EntityCurrent)
        .filter_by(organization_id=org_uuid)
        .filter(EntityCurrent.is_deleted == False)  # noqa: E712
        .all()
    )

    queued = 0
    for entity in entities:
        classify_entity_task.delay(
            entity.entity_key,
            str(entity.organization_id),
            force_ai,
        )
        queued += 1

    logger.info("Queued classification for %s entities in organization %s", queued, organization_id)

    return {
        "organization_id": str(org_uuid),
        "queued": queued,
        "message": "Classification tasks queued for all entities",
    }


@router.get("/api/classification/stats", response_model=ClassificationStatsResponse, summary="Get classification stats")
def get_classification_stats(
    request: Request,
    organization_id: str | None = Query(None),
    auth: AuthContext = Depends(require_permission(Permission.DATA_VIEW)),
    db: Session = Depends(get_db),
):
    """Get global classification statistics."""
    query = db.query(
        EntityCurrent.entity_type,
        func.count(EntityCurrent.entity_key),
    )

    if organization_id:
        org_uuid = get_authorized_org_id(request, auth, query_org_id=parse_uuid_or_raise(organization_id, "organization_id"))
        query = query.filter(EntityCurrent.organization_id == org_uuid)

    results = query.group_by(EntityCurrent.entity_type).all()

    by_type = {entity_type: count for entity_type, count in results}
    total = sum(by_type.values())
    unclassified = by_type.get("unclassified", 0)
    classification_rate = (total - unclassified) / total if total > 0 else 0

    return {
        "total_entities": total,
        "by_type": by_type,
        "classification_rate": round(classification_rate, 4),
    }
