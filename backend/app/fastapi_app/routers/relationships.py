"""
Entity Relationships and Relationship Definitions API endpoints (FastAPI).

Batch F — 15 routes:
  - Relationships CRUD (8 routes): create, get, delete, list, entity relationships,
    relationship types, batch create, analytics
  - Relationship Definitions CRUD (7 routes): create, get, update, delete, list,
    evaluate, preview

Migrated from app/api/relationships.py and app/api/relationship_definitions.py.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission, get_authorized_org_id
from app.models import EntityRelationship, EntityCurrent, Dataset, RelationshipDefinition
from app.permissions import Permission
from app.services.relationship_service import (
    RelationshipCreate,
    create_relationship,
    get_relationship,
    delete_relationship,
    get_outgoing_relationships,
    get_incoming_relationships,
    get_all_relationships_for_entity,
    get_relationship_type_counts,
    create_relationships_batch,
)
from app.fastapi_app.schemas.common import DeletedResponse
from app.fastapi_app.schemas.relationships import (
    BatchCreateResponse,
    DefinitionCreatedResponse,
    DefinitionDetailResponse,
    DefinitionListResponse,
    EntityRelationshipsResponse,
    EvaluateDefinitionResponse,
    PreviewDefinitionResponse,
    RelationshipAnalyticsResponse,
    RelationshipCreatedResponse,
    RelationshipDetailResponse,
    RelationshipListResponse,
    RelationshipTypesResponse,
)
from app.services.relationship_definition_service import (
    DefinitionCreate,
    DefinitionUpdate,
    create_definition,
    get_definition,
    update_definition,
    delete_definition,
    list_definitions,
    evaluate_definition,
    create_relationships_from_definition,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["relationships"])


# ============================================================================
# SERIALIZERS
# ============================================================================


def _serialize_relationship(rel: EntityRelationship) -> dict:
    return {
        "relationship_id": str(rel.relationship_id),
        "organization_id": str(rel.organization_id),
        "source_entity_key": rel.source_entity_key,
        "source_dataset_id": str(rel.source_dataset_id) if rel.source_dataset_id else None,
        "target_entity_key": rel.target_entity_key,
        "target_dataset_id": str(rel.target_dataset_id) if rel.target_dataset_id else None,
        "relationship_type": rel.relationship_type,
        "created_by_source": rel.created_by_source,
        "confidence": rel.confidence,
        "extra_data": rel.extra_data,
        "created_by_user_id": str(rel.created_by_user_id) if rel.created_by_user_id else None,
        "created_at": rel.created_at.isoformat() if rel.created_at else None,
        "updated_at": rel.updated_at.isoformat() if rel.updated_at else None,
    }


def _serialize_entity_summary(entity: EntityCurrent | None) -> dict | None:
    if not entity:
        return None
    return {
        "entity_key": entity.entity_key,
        "entity_type": entity.entity_type,
        "source_system": entity.source_system,
        "source_id": entity.source_id,
        "canonical_url": entity.canonical_url,
        "title": entity.payload.get("title") if entity.payload else None,
    }


def _serialize_definition(defn: RelationshipDefinition) -> dict:
    return {
        "definition_id": str(defn.definition_id),
        "organization_id": str(defn.organization_id),
        "name": defn.name,
        "description": defn.description,
        "relationship_type": defn.relationship_type,
        "source_dataset_id": str(defn.source_dataset_id) if defn.source_dataset_id else None,
        "source_entity_type": defn.source_entity_type,
        "source_field_path": defn.source_field_path,
        "target_dataset_id": str(defn.target_dataset_id) if defn.target_dataset_id else None,
        "target_entity_type": defn.target_entity_type,
        "target_field_path": defn.target_field_path,
        "match_transform": defn.match_transform,
        "case_sensitive": defn.case_sensitive,
        "enabled": defn.enabled,
        "auto_link_on_ingest": defn.auto_link_on_ingest,
        "bidirectional": defn.bidirectional,
        "inverse_relationship_type": defn.inverse_relationship_type,
        "created_by_user_id": str(defn.created_by_user_id) if defn.created_by_user_id else None,
        "created_at": defn.created_at.isoformat() if defn.created_at else None,
        "updated_at": defn.updated_at.isoformat() if defn.updated_at else None,
    }


# ============================================================================
# RELATIONSHIP ENDPOINTS
# ============================================================================


@router.post("/api/relationships", status_code=201, response_model=RelationshipCreatedResponse, summary="Create relationship endpoint")
def create_relationship_endpoint(
    request: Request,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.DATA_MANAGE)),
    db: Session = Depends(get_db),
):
    """Create a new entity relationship."""
    if not body:
        raise HTTPException(status_code=400, detail="Request body is required")

    required_fields = ["organization_id", "source_entity_key", "target_entity_key", "relationship_type"]
    for field in required_fields:
        if not body.get(field):
            raise HTTPException(status_code=400, detail=f"{field} is required")

    try:
        body_org_id = UUID(body["organization_id"])
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid UUID format for organization_id")

    # Enforce body org_id matches the authorized org context
    organization_id = get_authorized_org_id(request, auth, query_org_id=body_org_id)

    source_dataset_id = None
    if body.get("source_dataset_id"):
        try:
            source_dataset_id = UUID(body["source_dataset_id"])
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid UUID format for source_dataset_id")

    target_dataset_id = None
    if body.get("target_dataset_id"):
        try:
            target_dataset_id = UUID(body["target_dataset_id"])
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid UUID format for target_dataset_id")

    rel_data = RelationshipCreate(
        source_entity_key=body["source_entity_key"],
        target_entity_key=body["target_entity_key"],
        relationship_type=body["relationship_type"],
        source_dataset_id=source_dataset_id,
        target_dataset_id=target_dataset_id,
        created_by_source=body.get("created_by_source", "manual"),
        confidence=body.get("confidence"),
        extra_data=body.get("extra_data"),
        created_by_user_id=auth.user_id,
    )

    try:
        relationship = create_relationship(db, organization_id, rel_data)
        db.commit()
        return {"relationship": _serialize_relationship(relationship)}
    except ValueError as e:
        db.rollback()
        error_msg = str(e)
        if "already exists" in error_msg:
            raise HTTPException(status_code=409, detail=error_msg)
        raise HTTPException(status_code=400, detail=error_msg)


@router.get("/api/relationships/{relationship_id}", response_model=RelationshipDetailResponse, summary="Get relationship endpoint")
def get_relationship_endpoint(
    request: Request,
    relationship_id: UUID,
    organization_id: UUID = Query(...),
    include_entities: bool = Query(False),
    auth: AuthContext = Depends(require_permission(Permission.DATA_VIEW)),
    db: Session = Depends(get_db),
):
    """Get a specific relationship by ID."""
    org_id = get_authorized_org_id(request, auth, query_org_id=organization_id)
    relationship = get_relationship(db, org_id, relationship_id)
    if not relationship:
        raise HTTPException(status_code=404, detail=f"Relationship not found: {relationship_id}")

    response = {"relationship": _serialize_relationship(relationship)}

    if include_entities:
        source_entity = db.query(EntityCurrent).filter_by(
            organization_id=org_id,
            entity_key=relationship.source_entity_key,
        ).first()
        response["source_entity"] = _serialize_entity_summary(source_entity)

        target_entity = db.query(EntityCurrent).filter_by(
            organization_id=org_id,
            entity_key=relationship.target_entity_key,
        ).first()
        response["target_entity"] = _serialize_entity_summary(target_entity)

    return response


@router.delete("/api/relationships/{relationship_id}", response_model=DeletedResponse, summary="Delete relationship endpoint")
def delete_relationship_endpoint(
    request: Request,
    relationship_id: UUID,
    organization_id: UUID = Query(...),
    auth: AuthContext = Depends(require_permission(Permission.DATA_MANAGE)),
    db: Session = Depends(get_db),
):
    """Delete a relationship."""
    org_id = get_authorized_org_id(request, auth, query_org_id=organization_id)
    deleted = delete_relationship(db, org_id, relationship_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Relationship not found: {relationship_id}")

    db.commit()
    return {"deleted": True}


@router.get("/api/relationships", response_model=RelationshipListResponse, summary="List relationships")
def list_relationships(
    request: Request,
    organization_id: UUID = Query(...),
    source_dataset_id: UUID = Query(None),
    target_dataset_id: UUID = Query(None),
    relationship_type: str = Query(None),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.DATA_VIEW)),
    db: Session = Depends(get_db),
):
    """List relationships with filtering."""
    org_id = get_authorized_org_id(request, auth, query_org_id=organization_id)
    query = db.query(EntityRelationship).filter_by(organization_id=org_id)

    if source_dataset_id:
        query = query.filter(EntityRelationship.source_dataset_id == source_dataset_id)
    if target_dataset_id:
        query = query.filter(EntityRelationship.target_dataset_id == target_dataset_id)
    if relationship_type:
        query = query.filter(EntityRelationship.relationship_type == relationship_type)

    total_count = query.count()
    relationships = query.order_by(EntityRelationship.created_at.desc()).limit(limit).offset(offset).all()

    return {
        "items": [_serialize_relationship(rel) for rel in relationships],
        "limit": limit,
        "offset": offset,
        "total": total_count,
    }


@router.get("/api/entities/{entity_key:path}/relationships", response_model=EntityRelationshipsResponse, summary="Get entity relationships")
def get_entity_relationships(
    request: Request,
    entity_key: str,
    organization_id: UUID = Query(...),
    direction: str = Query("all"),
    relationship_type: str = Query(None),
    include_entities: bool = Query(False),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.DATA_VIEW)),
    db: Session = Depends(get_db),
):
    """Get all relationships for a specific entity."""
    org_id = get_authorized_org_id(request, auth, query_org_id=organization_id)
    if direction not in ("outgoing", "incoming", "all"):
        raise HTTPException(status_code=400, detail="direction must be 'outgoing', 'incoming', or 'all'")

    if direction == "outgoing":
        results, total_count = get_outgoing_relationships(
            db, org_id, entity_key,
            relationship_type=relationship_type,
            include_entities=include_entities,
            limit=limit, offset=offset,
        )
    elif direction == "incoming":
        results, total_count = get_incoming_relationships(
            db, org_id, entity_key,
            relationship_type=relationship_type,
            include_entities=include_entities,
            limit=limit, offset=offset,
        )
    else:
        results, total_count = get_all_relationships_for_entity(
            db, org_id, entity_key,
            relationship_type=relationship_type,
            include_entities=include_entities,
            limit=limit, offset=offset,
        )

    relationships = []
    for result in results:
        rel = result.relationship
        item = {
            "relationship": _serialize_relationship(rel),
            "direction": "outgoing" if rel.source_entity_key == entity_key else "incoming",
        }
        if include_entities:
            if rel.source_entity_key == entity_key:
                item["related_entity"] = _serialize_entity_summary(result.target_entity)
            else:
                item["related_entity"] = _serialize_entity_summary(result.source_entity)
        relationships.append(item)

    return {
        "entity_key": entity_key,
        "items": relationships,
        "limit": limit,
        "offset": offset,
        "total": total_count,
    }


@router.get("/api/relationship-types", response_model=RelationshipTypesResponse, summary="List relationship types")
def list_relationship_types(
    request: Request,
    organization_id: UUID = Query(...),
    entity_key: str = Query(None),
    dataset_id: UUID = Query(None),
    auth: AuthContext = Depends(require_permission(Permission.DATA_VIEW)),
    db: Session = Depends(get_db),
):
    """List relationship types with counts."""
    org_id = get_authorized_org_id(request, auth, query_org_id=organization_id)
    counts = get_relationship_type_counts(
        db, org_id,
        entity_key=entity_key,
        dataset_id=dataset_id,
    )

    relationship_types = [
        {"type": rel_type, "count": count}
        for rel_type, count in sorted(counts.items())
    ]
    total = sum(counts.values())

    return {
        "organization_id": str(org_id),
        "relationship_types": relationship_types,
        "total_relationships": total,
    }


@router.post("/api/relationships/batch", response_model=BatchCreateResponse, summary="Create relationships batch endpoint")
def create_relationships_batch_endpoint(
    request: Request,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.DATA_MANAGE)),
    db: Session = Depends(get_db),
):
    """Create multiple relationships in a batch."""
    if not body:
        raise HTTPException(status_code=400, detail="Request body is required")

    if not body.get("organization_id"):
        raise HTTPException(status_code=400, detail="organization_id is required")

    if not body.get("relationships") or not isinstance(body["relationships"], list):
        raise HTTPException(status_code=400, detail="relationships array is required")

    try:
        body_org_id = UUID(body["organization_id"])
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid UUID format for organization_id")

    # Enforce body org_id matches the authorized org context
    organization_id = get_authorized_org_id(request, auth, query_org_id=body_org_id)

    skip_duplicates = body.get("skip_duplicates", True)

    rel_data_list = []
    for i, rel in enumerate(body["relationships"]):
        if not rel.get("source_entity_key") or not rel.get("target_entity_key") or not rel.get("relationship_type"):
            raise HTTPException(status_code=400, detail=f"Relationship at index {i} missing required fields")

        source_dataset_id = None
        if rel.get("source_dataset_id"):
            try:
                source_dataset_id = UUID(rel["source_dataset_id"])
            except ValueError:
                raise HTTPException(status_code=400, detail=f"Invalid UUID at index {i}")

        target_dataset_id = None
        if rel.get("target_dataset_id"):
            try:
                target_dataset_id = UUID(rel["target_dataset_id"])
            except ValueError:
                raise HTTPException(status_code=400, detail=f"Invalid UUID at index {i}")

        rel_data_list.append(RelationshipCreate(
            source_entity_key=rel["source_entity_key"],
            target_entity_key=rel["target_entity_key"],
            relationship_type=rel["relationship_type"],
            source_dataset_id=source_dataset_id,
            target_dataset_id=target_dataset_id,
            created_by_source=rel.get("created_by_source", "manual"),
            confidence=rel.get("confidence"),
            extra_data=rel.get("extra_data"),
            created_by_user_id=auth.user_id,
        ))

    created, skipped, errors = create_relationships_batch(
        db, organization_id, rel_data_list,
        skip_duplicates=skip_duplicates,
    )
    db.commit()

    return {"created": created, "skipped": skipped, "errors": errors}


@router.get("/api/relationships/analytics", response_model=RelationshipAnalyticsResponse, summary="Get relationship analytics")
def get_relationship_analytics(
    organization_id: UUID = Query(...),
    auth: AuthContext = Depends(require_permission(Permission.PLATFORM_ADMIN)),
    db: Session = Depends(get_db),
):
    """Get relationship analytics for an organization."""
    total_count = (
        db.query(func.count(EntityRelationship.relationship_id))
        .filter(EntityRelationship.organization_id == organization_id)
        .scalar()
    ) or 0

    type_counts = (
        db.query(EntityRelationship.relationship_type, func.count(EntityRelationship.relationship_id).label("count"))
        .filter(EntityRelationship.organization_id == organization_id)
        .group_by(EntityRelationship.relationship_type)
        .order_by(func.count(EntityRelationship.relationship_id).desc())
        .all()
    )
    by_type = [{"type": t, "count": c} for t, c in type_counts]

    source_counts = (
        db.query(EntityRelationship.created_by_source, func.count(EntityRelationship.relationship_id).label("count"))
        .filter(EntityRelationship.organization_id == organization_id)
        .group_by(EntityRelationship.created_by_source)
        .order_by(func.count(EntityRelationship.relationship_id).desc())
        .all()
    )
    by_source = [{"source": s, "count": c} for s, c in source_counts]

    source_counts_sq = (
        db.query(
            EntityRelationship.source_entity_key.label("entity_key"),
            func.count().label("rel_count"),
        )
        .filter(EntityRelationship.organization_id == organization_id)
        .group_by(EntityRelationship.source_entity_key)
        .subquery()
    )

    target_counts_sq = (
        db.query(
            EntityRelationship.target_entity_key.label("entity_key"),
            func.count().label("rel_count"),
        )
        .filter(EntityRelationship.organization_id == organization_id)
        .group_by(EntityRelationship.target_entity_key)
        .subquery()
    )

    combined = (
        db.query(
            func.coalesce(source_counts_sq.c.entity_key, target_counts_sq.c.entity_key).label("entity_key"),
            (func.coalesce(source_counts_sq.c.rel_count, 0) + func.coalesce(target_counts_sq.c.rel_count, 0)).label("total_count"),
        )
        .outerjoin(target_counts_sq, source_counts_sq.c.entity_key == target_counts_sq.c.entity_key)
        .order_by((func.coalesce(source_counts_sq.c.rel_count, 0) + func.coalesce(target_counts_sq.c.rel_count, 0)).desc())
        .limit(10)
        .all()
    )

    top_entity_keys = [row.entity_key for row in combined if row.entity_key]
    entity_labels = {}
    if top_entity_keys:
        entities = (
            db.query(EntityCurrent.entity_key, EntityCurrent.payload)
            .filter(
                EntityCurrent.organization_id == organization_id,
                EntityCurrent.entity_key.in_(top_entity_keys),
            )
            .all()
        )
        for e in entities:
            label = e.payload.get("label") if e.payload else None
            entity_labels[e.entity_key] = label or e.entity_key

    top_entities = [
        {
            "entity_key": row.entity_key,
            "label": entity_labels.get(row.entity_key, row.entity_key),
            "relationship_count": row.total_count,
        }
        for row in combined if row.entity_key
    ]

    recent = (
        db.query(EntityRelationship)
        .filter(EntityRelationship.organization_id == organization_id)
        .order_by(EntityRelationship.created_at.desc())
        .limit(10)
        .all()
    )
    recent_relationships = [_serialize_relationship(rel) for rel in recent]

    return {
        "organization_id": str(organization_id),
        "total_relationships": total_count,
        "by_type": by_type,
        "by_source": by_source,
        "top_entities": top_entities,
        "recent_relationships": recent_relationships,
    }


# ============================================================================
# RELATIONSHIP DEFINITION ENDPOINTS
# ============================================================================


@router.post("/api/relationship-definitions", status_code=201, response_model=DefinitionCreatedResponse, summary="Create definition endpoint")
def create_definition_endpoint(
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.PLATFORM_ADMIN)),
    db: Session = Depends(get_db),
):
    """Create a new relationship definition."""
    if not body:
        raise HTTPException(status_code=400, detail="Request body is required")

    if not auth.active_organization_id:
        raise HTTPException(status_code=400, detail="No active organization in session")

    required_fields = ["name", "relationship_type", "source_field_path", "target_field_path"]
    for field in required_fields:
        if not body.get(field):
            raise HTTPException(status_code=400, detail=f"{field} is required")

    source_dataset_id = None
    if body.get("source_dataset_id"):
        try:
            source_dataset_id = UUID(body["source_dataset_id"])
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid UUID format for source_dataset_id")

    target_dataset_id = None
    if body.get("target_dataset_id"):
        try:
            target_dataset_id = UUID(body["target_dataset_id"])
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid UUID format for target_dataset_id")

    defn_data = DefinitionCreate(
        name=body["name"],
        description=body.get("description"),
        relationship_type=body["relationship_type"],
        source_dataset_id=source_dataset_id,
        source_entity_type=body.get("source_entity_type"),
        source_field_path=body["source_field_path"],
        target_dataset_id=target_dataset_id,
        target_entity_type=body.get("target_entity_type"),
        target_field_path=body["target_field_path"],
        match_transform=body.get("match_transform", "exact"),
        case_sensitive=body.get("case_sensitive", True),
        enabled=body.get("enabled", True),
        auto_link_on_ingest=body.get("auto_link_on_ingest", False),
        bidirectional=body.get("bidirectional", False),
        inverse_relationship_type=body.get("inverse_relationship_type"),
        created_by_user_id=auth.user_id,
    )

    try:
        definition = create_definition(db, auth.active_organization_id, defn_data)
        db.commit()
        return {"definition": _serialize_definition(definition)}
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/api/relationship-definitions", response_model=DefinitionListResponse, summary="List definitions endpoint")
def list_definitions_endpoint(
    dataset_id: UUID = Query(None),
    relationship_type: str = Query(None),
    enabled: str = Query(None),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.PLATFORM_ADMIN)),
    db: Session = Depends(get_db),
):
    """List relationship definitions with optional filtering."""
    if not auth.active_organization_id:
        raise HTTPException(status_code=400, detail="No active organization in session")

    enabled_only = None
    if enabled is not None:
        enabled_only = enabled.lower() == "true"

    definitions, total_count = list_definitions(
        db,
        auth.active_organization_id,
        source_dataset_id=dataset_id,
        target_dataset_id=dataset_id,
        relationship_type=relationship_type,
        enabled_only=enabled_only if enabled_only is True else False,
        limit=limit,
        offset=offset,
    )

    if enabled_only is False:
        definitions = [d for d in definitions if not d.enabled]
        total_count = len(definitions)

    return {
        "items": [_serialize_definition(d) for d in definitions],
        "limit": limit,
        "offset": offset,
        "total": total_count,
    }


@router.get("/api/relationship-definitions/{definition_id}", response_model=DefinitionDetailResponse, summary="Get definition endpoint")
def get_definition_endpoint(
    definition_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.PLATFORM_ADMIN)),
    db: Session = Depends(get_db),
):
    """Get a specific relationship definition."""
    if not auth.active_organization_id:
        raise HTTPException(status_code=400, detail="No active organization in session")

    definition = get_definition(db, auth.active_organization_id, definition_id)
    if not definition:
        raise HTTPException(status_code=404, detail=f"Definition not found: {definition_id}")

    return {"definition": _serialize_definition(definition)}


@router.put("/api/relationship-definitions/{definition_id}", response_model=DefinitionDetailResponse, summary="Update definition endpoint")
def update_definition_endpoint(
    definition_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.PLATFORM_ADMIN)),
    db: Session = Depends(get_db),
):
    """Update a relationship definition."""
    if not body:
        raise HTTPException(status_code=400, detail="Request body is required")

    if not auth.active_organization_id:
        raise HTTPException(status_code=400, detail="No active organization in session")

    update_data = DefinitionUpdate(
        name=body.get("name"),
        description=body.get("description"),
        source_field_path=body.get("source_field_path"),
        target_field_path=body.get("target_field_path"),
        match_transform=body.get("match_transform"),
        case_sensitive=body.get("case_sensitive"),
        enabled=body.get("enabled"),
        auto_link_on_ingest=body.get("auto_link_on_ingest"),
        bidirectional=body.get("bidirectional"),
        inverse_relationship_type=body.get("inverse_relationship_type"),
    )

    try:
        definition = update_definition(db, auth.active_organization_id, definition_id, update_data)
        if not definition:
            raise HTTPException(status_code=404, detail=f"Definition not found: {definition_id}")

        db.commit()
        return {"definition": _serialize_definition(definition)}
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/api/relationship-definitions/{definition_id}", summary="Delete definition endpoint")
def delete_definition_endpoint(
    definition_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.PLATFORM_ADMIN)),
    db: Session = Depends(get_db),
):
    """Delete a relationship definition."""
    if not auth.active_organization_id:
        raise HTTPException(status_code=400, detail="No active organization in session")

    deleted = delete_definition(db, auth.active_organization_id, definition_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Definition not found: {definition_id}")

    db.commit()
    return JSONResponse(status_code=204, content=None)


@router.post("/api/relationship-definitions/{definition_id}/evaluate", response_model=EvaluateDefinitionResponse, summary="Evaluate definition endpoint")
def evaluate_definition_endpoint(
    definition_id: UUID,
    body: dict = None,
    auth: AuthContext = Depends(require_permission(Permission.PLATFORM_ADMIN)),
    db: Session = Depends(get_db),
):
    """Evaluate a definition and create relationships for all matches."""
    if not auth.active_organization_id:
        raise HTTPException(status_code=400, detail="No active organization in session")

    body = body or {}

    definition = get_definition(db, auth.active_organization_id, definition_id)
    if not definition:
        raise HTTPException(status_code=404, detail=f"Definition not found: {definition_id}")

    skip_existing = body.get("skip_existing", True)

    created, skipped, errors = create_relationships_from_definition(
        db, auth.active_organization_id, definition, skip_existing=skip_existing,
    )
    db.commit()

    return {"created": created, "skipped": skipped, "errors": errors}


@router.post("/api/relationship-definitions/{definition_id}/preview", response_model=PreviewDefinitionResponse, summary="Preview definition endpoint")
def preview_definition_endpoint(
    definition_id: UUID,
    body: dict = None,
    auth: AuthContext = Depends(require_permission(Permission.PLATFORM_ADMIN)),
    db: Session = Depends(get_db),
):
    """Preview matches for a definition without creating relationships."""
    if not auth.active_organization_id:
        raise HTTPException(status_code=400, detail="No active organization in session")

    body = body or {}

    definition = get_definition(db, auth.active_organization_id, definition_id)
    if not definition:
        raise HTTPException(status_code=404, detail=f"Definition not found: {definition_id}")

    limit = min(body.get("limit", 100), 500)

    matches = []
    for match in evaluate_definition(db, auth.active_organization_id, definition):
        matches.append({
            "source_entity_key": match.source_entity_key,
            "target_entity_key": match.target_entity_key,
            "source_value": match.source_value,
            "target_value": match.target_value,
            "confidence": match.confidence,
        })
        if len(matches) > limit:
            break

    has_more = len(matches) > limit
    if has_more:
        matches = matches[:limit]

    return {"items": matches, "has_more": has_more}
