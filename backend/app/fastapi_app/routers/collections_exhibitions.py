"""Collections Exhibitions, Objects, Label Templates — routes migrated from Flask.

Sources:
- app/api/exhibit.py (collections_exhibitions_bp + label templates from exhibit_bp)
"""

import logging
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import and_, or_, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_auth, require_permission
from app.models import (
    CollectionObject,
    CollectionObjectMedia,
    EntityCurrent,
    Exhibition,
    ExhibitionFloorPlan,
    ExhibitionObject,
    ExhibitionStatusHistory,
    LabelTemplate,
    Placement,
    Venue,
)
from app.permissions import Permission
from app.services.exhibit_object_source import ExhibitObjectSourceService
from app.services.api_security import escape_ilike
from app.services.entity_notifications import notify_status_change
from app.services.field_access_service import apply_field_access, get_write_restricted_fields
from app.services.uploads import get_org_media_url
from app.fastapi_app.schemas.collections_exhibitions import (
    ExhibitionListResponse,
    ExhibitionDetailOut,
    ExhibitionCreatedResponse,
    ExhibitionUpdatedResponse,
    ExhibitionObjectListResponse,
    ExhibitionObjectAddedResponse,
    ExhibitionObjectUpdatedResponse,
    ExhibitionObjectsBatchAddedResponse,
    AvailableObjectsResponse,
    LabelTemplateListResponse,
    LabelTemplateCreatedResponse,
    LabelTemplateUpdatedResponse,
)
from app.fastapi_app.schemas.common import MessageResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["collections_exhibitions"])


# =============================================================================
# Helper functions
# =============================================================================


def _serialize_exhibition_object_with_source(
    exhibition_obj: ExhibitionObject,
    service: ExhibitObjectSourceService,
    include_full_details: bool = False,
) -> dict:
    """Serialize an ExhibitionObject with unified object data from either source.

    Works for both Collections objects (object_id) and Bridge entities (entity_key).
    """
    obj_data = service.get_object_data(exhibition_obj)

    result = {
        "exhibition_object_id": str(exhibition_obj.exhibition_object_id),
        "display_order": exhibition_obj.display_order,
        "section": exhibition_obj.section,
        "object_status": exhibition_obj.object_status,
        "confirmed_date": exhibition_obj.confirmed_date.isoformat() if exhibition_obj.confirmed_date else None,
        "credit_line_override": exhibition_obj.credit_line_override,
        "special_requirements": exhibition_obj.special_requirements,
        "installation_notes": exhibition_obj.installation_notes,
        "loan_in_id": str(exhibition_obj.loan_in_id) if exhibition_obj.loan_in_id else None,
        "condition_in_report_id": str(exhibition_obj.condition_in_report_id) if exhibition_obj.condition_in_report_id else None,
        "condition_out_report_id": str(exhibition_obj.condition_out_report_id) if exhibition_obj.condition_out_report_id else None,
        "created_at": exhibition_obj.created_at.isoformat() if exhibition_obj.created_at else None,
        # Source identification
        "source_type": obj_data.source_type,
        "object_id": str(exhibition_obj.object_id) if exhibition_obj.object_id else None,
        "entity_key": exhibition_obj.entity_key,
        # Unified object fields
        "object_number": obj_data.object_number,
        "title": obj_data.title,
        "description": obj_data.description,
        "thumbnail_url": obj_data.thumbnail_url,
    }

    if include_full_details:
        if obj_data.source_type == "bridge" and obj_data.payload:
            result["bridge_payload"] = obj_data.payload
            result["bridge_source_system"] = obj_data.source_system
        elif obj_data.collection_object:
            coll_obj = obj_data.collection_object
            result["creator"] = None
            if coll_obj.creators:
                for c in coll_obj.creators:
                    if c.get("name"):
                        result["creator"] = c.get("name")
                        break

    return result


def _get_collection_object_image_url(
    object_id: UUID, org_id: UUID, db: Session,
) -> str | None:
    """Get an image URL for a collection object's primary image."""
    try:
        primary_link = (
            db.query(CollectionObjectMedia)
            .options(joinedload(CollectionObjectMedia.media))
            .filter(
                CollectionObjectMedia.object_id == object_id,
                CollectionObjectMedia.is_primary == True,
            )
            .first()
        )

        if not primary_link:
            primary_link = (
                db.query(CollectionObjectMedia)
                .options(joinedload(CollectionObjectMedia.media))
                .filter(CollectionObjectMedia.object_id == object_id)
                .order_by(CollectionObjectMedia.sort_order)
                .first()
            )

        if primary_link and primary_link.media:
            return get_org_media_url(
                primary_link.media.s3_key,
                organization_id=str(org_id),
                db_session=db,
                expiry_seconds=3600,
            )
        else:
            logger.warning(f"No media found for object {object_id}")
    except Exception as e:
        logger.warning(f"Failed to get image URL for object {object_id}: {e}")

    return None


# =============================================================================
# Route 1: List exhibitions
# =============================================================================


@router.get("/api/organizations/{org_id}/collections/exhibitions", response_model=ExhibitionListResponse, summary="List exhibitions")
def list_exhibitions(
    org_id: UUID,
    status: str | None = Query(None),
    exhibition_type: str | None = Query(None),
    q: str | None = Query(None),
    limit: int | None = Query(None),
    offset: int | None = Query(None),
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_VIEW)),
    db: Session = Depends(get_db),
):
    """List all exhibitions for the organization."""
    query = (
        db.query(Exhibition)
        .options(joinedload(Exhibition.venue))
        .filter(Exhibition.organization_id == org_id)
    )

    if status:
        query = query.filter(Exhibition.status == status)

    if exhibition_type:
        query = query.filter(Exhibition.exhibition_type == exhibition_type)

    if q:
        search_term = f"%{escape_ilike(q)}%"
        query = query.filter(
            or_(
                Exhibition.title.ilike(search_term, escape="\\"),
                func.coalesce(Exhibition.exhibition_number, "").ilike(search_term, escape="\\"),
            )
        )

    query = query.order_by(Exhibition.created_at.desc())

    total = query.count()

    if offset:
        query = query.offset(offset)

    if limit:
        query = query.limit(limit)

    exhibitions = query.all()

    return {
        "total": total,
        "exhibitions": [
            {
                "exhibition_id": str(e.exhibition_id),
                "exhibition_number": e.exhibition_number,
                "title": e.title,
                "description": e.description,
                "exhibition_type": e.exhibition_type,
                "status": e.status,
                "venue_id": str(e.venue_id) if e.venue_id else None,
                "venue_name": e.venue.name if e.venue else None,
                "planned_start_date": e.planned_start_date.isoformat() if e.planned_start_date else None,
                "planned_end_date": e.planned_end_date.isoformat() if e.planned_end_date else None,
                "is_public": e.is_public,
                "public_url_slug": e.public_url_slug,
                "placement_count": len(e.placements),
                "created_at": e.created_at.isoformat() if e.created_at else None,
            }
            for e in exhibitions
        ]
    }


# =============================================================================
# Route 1b: Search available objects
#
# Declared BEFORE /exhibitions/{exhibition_id} so the literal `available-objects`
# segment doesn't get parsed as a UUID by the parameterized handler. Moving
# this earlier was a behavior fix, not a refactor — calls to this endpoint
# previously 422'd on UUID parsing.
# =============================================================================


@router.get(
    "/api/organizations/{org_id}/collections/exhibitions/available-objects",
    response_model=AvailableObjectsResponse,
    summary="Search available objects",
)
def search_available_objects(
    org_id: UUID,
    q: str = Query(""),
    source: str | None = Query(None),
    limit: int = Query(50),
    offset: int = Query(0),
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_VIEW)),
    db: Session = Depends(get_db),
):
    """Search for objects available to add to exhibitions."""
    limit = min(limit, 100)

    service = ExhibitObjectSourceService(db, org_id)

    # Determine source type
    source_type = source if source in ("collections", "bridge") else None

    results = service.search_available_objects(
        query=q if q else None,
        limit=limit,
        offset=offset,
        source_type=source_type,
    )

    return {
        "objects": [
            {
                "source_type": obj.source_type,
                "source_id": obj.source_id,
                "object_number": obj.object_number,
                "title": obj.title,
                "description": obj.description,
                "thumbnail_url": obj.thumbnail_url,
                "source_system": obj.source_system if obj.source_type == "bridge" else None,
            }
            for obj in results
        ],
        "source_mode": service.get_source_mode(),
        "count": len(results),
    }


# =============================================================================
# Route 2: Create exhibition
# =============================================================================


@router.post("/api/organizations/{org_id}/collections/exhibitions", status_code=201, response_model=ExhibitionCreatedResponse, summary="Create exhibition")
async def create_exhibition(
    org_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_CREATE)),
    db: Session = Depends(get_db),
):
    """Create a new exhibition."""
    try:
        data = await request.json()
        if not data or "title" not in data:
            raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "title is required"})

        # Validate venue if provided
        venue_id = data.get("venue_id")
        if venue_id:
            venue = (
                db.query(Venue)
                .filter(and_(Venue.venue_id == venue_id, Venue.organization_id == org_id))
                .first()
            )
            if not venue:
                raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Venue not found"})

        user_id = auth.user_id
        initial_status = data.get("status", "proposed")

        exhibition = Exhibition(
            organization_id=org_id,
            venue_id=venue_id,
            exhibition_number=data.get("exhibition_number"),
            title=data["title"],
            description=data.get("description"),
            curator_notes=data.get("curator_notes"),
            exhibition_type=data.get("exhibition_type", "temporary"),
            organizer_id=data.get("organizer_id") or user_id,
            provisos=data.get("provisos"),
            status=initial_status,
            created_by=user_id,
        )

        # Parse dates if provided
        if data.get("planned_start_date"):
            exhibition.planned_start_date = datetime.fromisoformat(data["planned_start_date"]).date()
        if data.get("planned_end_date"):
            exhibition.planned_end_date = datetime.fromisoformat(data["planned_end_date"]).date()

        db.add(exhibition)
        db.flush()

        # Create initial status history entry
        status_history = ExhibitionStatusHistory(
            exhibition_id=exhibition.exhibition_id,
            status=initial_status,
            changed_by=user_id,
            notes="Exhibition created",
        )
        db.add(status_history)

        db.commit()

        logger.info(f"Created exhibition {exhibition.exhibition_id} for org {org_id}")

        return {
            "exhibition_id": str(exhibition.exhibition_id),
            "title": exhibition.title,
            "message": "Exhibition created successfully",
        }

    except ValueError as e:
        raise HTTPException(status_code=400, detail={"code": "validation_error", "message": f"Invalid date format: {e}"})
    except IntegrityError as e:
        db.rollback()
        if "unique" in str(e).lower():
            raise HTTPException(status_code=409, detail={"code": "duplicate", "message": "An exhibition with this title already exists"})
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Database constraint violation"})


# =============================================================================
# Route 3: Get exhibition
# =============================================================================


@router.get("/api/organizations/{org_id}/collections/exhibitions/{exhibition_id}", response_model=ExhibitionDetailOut, summary="Get exhibition")
def get_exhibition(
    org_id: UUID,
    exhibition_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_VIEW)),
    db: Session = Depends(get_db),
):
    """Get exhibition details with placements."""
    exhibition = (
        db.query(Exhibition)
        .options(
            joinedload(Exhibition.venue),
            joinedload(Exhibition.placements).joinedload(Placement.floor_plan),
            joinedload(Exhibition.floor_plan_associations).joinedload(ExhibitionFloorPlan.floor_plan),
            joinedload(Exhibition.status_history),
        )
        .filter(
            and_(
                Exhibition.exhibition_id == exhibition_id,
                Exhibition.organization_id == org_id,
            )
        )
        .first()
    )

    if not exhibition:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Exhibition not found"})

    serialized = {
        "exhibition_id": str(exhibition.exhibition_id),
        "exhibition_number": exhibition.exhibition_number,
        "title": exhibition.title,
        "description": exhibition.description,
        "curator_notes": exhibition.curator_notes,
        "exhibition_type": exhibition.exhibition_type,
        "status": exhibition.status,
        # Procedure: Use organizer / Use authorizer
        "organizer_id": str(exhibition.organizer_id) if exhibition.organizer_id else None,
        "authorizer_id": str(exhibition.authorizer_id) if exhibition.authorizer_id else None,
        "authorization_date": exhibition.authorization_date.isoformat() if exhibition.authorization_date else None,
        "provisos": exhibition.provisos,
        "outcome": exhibition.outcome,
        # Venue
        "venue_id": str(exhibition.venue_id) if exhibition.venue_id else None,
        "venue_name": exhibition.venue.name if exhibition.venue else None,
        # Dates
        "planned_start_date": exhibition.planned_start_date.isoformat() if exhibition.planned_start_date else None,
        "planned_end_date": exhibition.planned_end_date.isoformat() if exhibition.planned_end_date else None,
        "actual_start_date": exhibition.actual_start_date.isoformat() if exhibition.actual_start_date else None,
        "actual_end_date": exhibition.actual_end_date.isoformat() if exhibition.actual_end_date else None,
        # Public gallery
        "is_public": exhibition.is_public,
        "public_url_slug": exhibition.public_url_slug,
        "created_at": exhibition.created_at.isoformat() if exhibition.created_at else None,
        # Procedure: Use status history
        "status_history": [
            {
                "status": sh.status,
                "status_date": sh.status_date.isoformat() if sh.status_date else None,
                "changed_by": str(sh.changed_by) if sh.changed_by else None,
                "notes": sh.notes,
            }
            for sh in sorted(exhibition.status_history, key=lambda x: x.status_date, reverse=True)
        ],
        # An association whose floor plan row is gone is orphaned data, not a
        # reason to 500 the whole exhibition. The placements block below
        # already guards the same relationship; this one did not.
        "floor_plans": [
            {
                "floor_plan_id": str(assoc.floor_plan.floor_plan_id),
                "name": assoc.floor_plan.name,
                "visit_order": assoc.visit_order,
                "geometry": assoc.floor_plan.geometry,
                "ceiling_height_cm": assoc.floor_plan.effective_ceiling_height,
                "wall_color": assoc.floor_plan.effective_wall_color,
                "model_url": assoc.floor_plan.model_url,
                "model_scale": float(assoc.floor_plan.model_scale) if assoc.floor_plan.model_scale else 1.0,
            }
            for assoc in sorted(
                (a for a in exhibition.floor_plan_associations if a.floor_plan),
                key=lambda a: a.visit_order,
            )
        ],
        "placements": [
            {
                "placement_id": str(p.placement_id),
                "floor_plan_id": str(p.floor_plan_id),
                "floor_plan_name": p.floor_plan.name if p.floor_plan else None,
                "source_type": p.source_type,
                "source_id": str(p.source_id) if p.source_id else None,
                "display_title": p.display_title,
                "display_artist": p.display_artist,
                "display_date": p.display_date,
                "display_medium": p.display_medium,
                "image_url": (
                    _get_collection_object_image_url(p.source_id, org_id, db)
                    if p.source_type in ("collection_object", "collections") and p.source_id
                    else p.image_url
                ) or p.image_url,
                # 3D model fields
                "model_url": p.model_url,
                "model_scale": float(p.model_scale) if p.model_scale else 1.0,
                "width_cm": float(p.width_cm),
                "height_cm": float(p.height_cm),
                "depth_cm": float(p.depth_cm),
                "wall_id": p.wall_id,
                "position_x": float(p.position_x),
                "position_y": float(p.position_y),
                "position_z": float(p.position_z),
                "rotation_degrees": float(p.rotation_degrees),
                # Floor position for freestanding objects
                "floor_position_x": float(p.floor_position_x) if p.floor_position_x is not None else None,
                "floor_position_y": float(p.floor_position_y) if p.floor_position_y is not None else None,
                "frame_style": p.frame_style,
                "frame_width_cm": float(p.frame_width_cm),
                "frame_style_id": str(p.frame_style_id) if p.frame_style_id else None,
                "mount_type": p.mount_type,
                "mount_config_id": str(p.mount_config_id) if p.mount_config_id else None,
                "label_position": p.label_position,
                "label_text": p.label_text,
                # V1 workflow fields
                "placement_status": p.placement_status,
                "notes": p.notes,
                "created_by": str(p.created_by) if p.created_by else None,
                "updated_by": str(p.updated_by) if p.updated_by else None,
                # 3D visualization settings (Ortelia-style)
                "frame_material": p.frame_material,
                "artwork_surface": p.artwork_surface,
                "lighting_fixture_type": p.lighting_fixture_type,
                "lighting_settings": p.lighting_settings,
            }
            for p in exhibition.placements
        ],
    }

    return apply_field_access(serialized, 'exhibition', str(org_id), str(auth.user_id), session=db, role_override=auth.role_override)


# =============================================================================
# Route 4: Update exhibition
# =============================================================================


@router.patch("/api/organizations/{org_id}/collections/exhibitions/{exhibition_id}", response_model=ExhibitionUpdatedResponse, summary="Update exhibition")
async def update_exhibition(
    org_id: UUID,
    exhibition_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Update exhibition details."""
    try:
        exhibition = (
            db.query(Exhibition)
            .filter(
                and_(
                    Exhibition.exhibition_id == exhibition_id,
                    Exhibition.organization_id == org_id,
                )
            )
            .first()
        )

        if not exhibition:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Exhibition not found"})

        data = await request.json()
        if not data:
            raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "No data provided"})

        # Strip write-restricted fields before applying updates
        write_restricted = get_write_restricted_fields('exhibition', str(org_id), str(auth.user_id), session=db, role_override=auth.role_override)
        for field in write_restricted:
            data.pop(field, None)

        user_id = auth.user_id
        old_status = exhibition.status

        # Basic fields
        if "title" in data:
            exhibition.title = data["title"]
        if "description" in data:
            exhibition.description = data["description"]
        if "curator_notes" in data:
            exhibition.curator_notes = data["curator_notes"]
        if "venue_id" in data:
            exhibition.venue_id = data["venue_id"]

        # procedure fields
        if "exhibition_number" in data:
            exhibition.exhibition_number = data["exhibition_number"]
        if "exhibition_type" in data:
            exhibition.exhibition_type = data["exhibition_type"]
        if "organizer_id" in data:
            exhibition.organizer_id = data["organizer_id"]
        if "provisos" in data:
            exhibition.provisos = data["provisos"]
        if "outcome" in data:
            exhibition.outcome = data["outcome"]

        # Authorization
        if "authorizer_id" in data:
            exhibition.authorizer_id = data["authorizer_id"]
        if "authorization_date" in data:
            exhibition.authorization_date = (
                datetime.fromisoformat(data["authorization_date"]).date()
                if data["authorization_date"]
                else None
            )

        # Status with history tracking
        if "status" in data and data["status"] != old_status:
            exhibition.status = data["status"]
            status_history = ExhibitionStatusHistory(
                exhibition_id=exhibition.exhibition_id,
                status=data["status"],
                changed_by=user_id,
                notes=data.get("status_notes"),
            )
            db.add(status_history)

        # Dates
        if "planned_start_date" in data:
            exhibition.planned_start_date = (
                datetime.fromisoformat(data["planned_start_date"]).date()
                if data["planned_start_date"]
                else None
            )
        if "planned_end_date" in data:
            exhibition.planned_end_date = (
                datetime.fromisoformat(data["planned_end_date"]).date()
                if data["planned_end_date"]
                else None
            )
        if "actual_start_date" in data:
            exhibition.actual_start_date = (
                datetime.fromisoformat(data["actual_start_date"]).date()
                if data["actual_start_date"]
                else None
            )
        if "actual_end_date" in data:
            exhibition.actual_end_date = (
                datetime.fromisoformat(data["actual_end_date"]).date()
                if data["actual_end_date"]
                else None
            )

        # Public gallery
        if "is_public" in data:
            exhibition.is_public = data["is_public"]
        if "public_url_slug" in data:
            exhibition.public_url_slug = data["public_url_slug"]

        db.commit()

        if "status" in data and exhibition.status != old_status:
            notify_status_change(
                org_id, "exhibition", exhibition.exhibition_id,
                exhibition.title, old_status, exhibition.status,
                auth.user_id, entity=exhibition,
            )

        return {
            "exhibition_id": str(exhibition.exhibition_id),
            "message": "Exhibition updated successfully",
        }

    except ValueError as e:
        raise HTTPException(status_code=400, detail={"code": "validation_error", "message": f"Invalid date format: {e}"})
    except IntegrityError as e:
        db.rollback()
        if "unique" in str(e).lower():
            raise HTTPException(status_code=409, detail={"code": "duplicate", "message": "An exhibition with this title already exists"})
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Database constraint violation"})


# =============================================================================
# Route 5: Delete exhibition
# =============================================================================


@router.delete("/api/organizations/{org_id}/collections/exhibitions/{exhibition_id}", response_model=MessageResponse, summary="Delete exhibition")
def delete_exhibition(
    org_id: UUID,
    exhibition_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_DELETE)),
    db: Session = Depends(get_db),
):
    """Delete an exhibition."""
    try:
        exhibition = (
            db.query(Exhibition)
            .filter(
                and_(
                    Exhibition.exhibition_id == exhibition_id,
                    Exhibition.organization_id == org_id,
                )
            )
            .first()
        )

        if not exhibition:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Exhibition not found"})

        db.delete(exhibition)
        db.commit()

        logger.info(f"Deleted exhibition {exhibition_id}")

        return {"message": "Exhibition deleted successfully"}

    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Cannot delete exhibition: it is still in use"})


# =============================================================================
# Route 6: List exhibition objects
# =============================================================================


@router.get("/api/organizations/{org_id}/collections/exhibitions/{exhibition_id}/objects", response_model=ExhibitionObjectListResponse, summary="List exhibition objects")
def list_exhibition_objects(
    org_id: UUID,
    exhibition_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_VIEW)),
    db: Session = Depends(get_db),
):
    """List all objects linked to an exhibition."""
    exhibition = (
        db.query(Exhibition)
        .filter(
            and_(
                Exhibition.exhibition_id == exhibition_id,
                Exhibition.organization_id == org_id,
            )
        )
        .first()
    )

    if not exhibition:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Exhibition not found"})

    exhibition_objects = (
        db.query(ExhibitionObject)
        .filter(ExhibitionObject.exhibition_id == exhibition_id)
        .order_by(ExhibitionObject.display_order, ExhibitionObject.created_at)
        .all()
    )

    service = ExhibitObjectSourceService(db, org_id)

    results = []
    for eo in exhibition_objects:
        serialized = _serialize_exhibition_object_with_source(eo, service, include_full_details=True)
        if eo.object_id:
            serialized["primary_image_url"] = _get_collection_object_image_url(eo.object_id, org_id, db)
        results.append(serialized)

    return {"exhibition_objects": results}


# =============================================================================
# Route 7: Add object to exhibition
# =============================================================================


@router.post("/api/organizations/{org_id}/collections/exhibitions/{exhibition_id}/objects", status_code=201, response_model=ExhibitionObjectAddedResponse, summary="Add exhibition object")
async def add_exhibition_object(
    org_id: UUID,
    exhibition_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Add an object to an exhibition.

    Supports both Collections objects (object_id) and Bridge entities (entity_key).
    Exactly one of object_id or entity_key must be provided.
    """
    try:
        exhibition = (
            db.query(Exhibition)
            .filter(
                and_(
                    Exhibition.exhibition_id == exhibition_id,
                    Exhibition.organization_id == org_id,
                )
            )
            .first()
        )

        if not exhibition:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Exhibition not found"})

        data = await request.json()
        if not data:
            raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "Request body is required"})

        # Validate source - exactly one must be provided
        has_object_id = bool(data.get("object_id"))
        has_entity_key = bool(data.get("entity_key"))

        if not has_object_id and not has_entity_key:
            raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "Either object_id or entity_key is required"})
        if has_object_id and has_entity_key:
            raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "Cannot specify both object_id and entity_key"})

        # Verify source exists
        if has_object_id:
            collection_object = (
                db.query(CollectionObject)
                .filter(
                    and_(
                        CollectionObject.object_id == data["object_id"],
                        CollectionObject.organization_id == org_id,
                    )
                )
                .first()
            )

            if not collection_object:
                raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Collection object not found"})

            # Check if already linked by object_id
            existing = (
                db.query(ExhibitionObject)
                .filter(
                    and_(
                        ExhibitionObject.exhibition_id == exhibition_id,
                        ExhibitionObject.object_id == data["object_id"],
                    )
                )
                .first()
            )
        else:
            entity = (
                db.query(EntityCurrent)
                .filter(
                    and_(
                        EntityCurrent.organization_id == org_id,
                        EntityCurrent.entity_key == data["entity_key"],
                    )
                )
                .first()
            )

            if not entity:
                raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Bridge entity not found"})

            # Check if already linked by entity_key
            existing = (
                db.query(ExhibitionObject)
                .filter(
                    and_(
                        ExhibitionObject.exhibition_id == exhibition_id,
                        ExhibitionObject.entity_key == data["entity_key"],
                    )
                )
                .first()
            )

        if existing:
            raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "Object already in exhibition"})

        # Get next display order
        max_order = (
            db.query(func.max(ExhibitionObject.display_order))
            .filter(ExhibitionObject.exhibition_id == exhibition_id)
            .scalar()
        )
        next_order = (max_order or 0) + 1

        user_id = auth.user_id

        exhibition_object = ExhibitionObject(
            exhibition_id=exhibition_id,
            organization_id=org_id,
            object_id=data.get("object_id"),
            entity_key=data.get("entity_key"),
            display_order=data.get("display_order", next_order),
            section=data.get("section"),
            loan_in_id=data.get("loan_in_id"),
            credit_line_override=data.get("credit_line_override"),
            special_requirements=data.get("special_requirements"),
            installation_notes=data.get("installation_notes"),
            object_status=data.get("object_status", "planned"),
            created_by=user_id,
        )

        db.add(exhibition_object)
        db.commit()

        source_type = "collections" if has_object_id else "bridge"
        source_id = data.get("object_id") or data.get("entity_key")
        logger.info(f"Added {source_type} object {source_id} to exhibition {exhibition_id}")

        return {
            "exhibition_object_id": str(exhibition_object.exhibition_object_id),
            "source_type": source_type,
            "message": "Object added to exhibition",
        }

    except IntegrityError as e:
        db.rollback()
        if "unique" in str(e).lower():
            raise HTTPException(status_code=409, detail={"code": "duplicate", "message": "This object is already in the exhibition"})
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Database constraint violation"})


# =============================================================================
# Route 8: Update exhibition object
# =============================================================================


@router.patch("/api/organizations/{org_id}/collections/exhibitions/{exhibition_id}/objects/{exhibition_object_id}", response_model=ExhibitionObjectUpdatedResponse, summary="Update exhibition object")
async def update_exhibition_object(
    org_id: UUID,
    exhibition_id: UUID,
    exhibition_object_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Update an exhibition object link."""
    try:
        exhibition_object = (
            db.query(ExhibitionObject)
            .filter(
                and_(
                    ExhibitionObject.exhibition_object_id == exhibition_object_id,
                    ExhibitionObject.exhibition_id == exhibition_id,
                    ExhibitionObject.organization_id == org_id,
                )
            )
            .first()
        )

        if not exhibition_object:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Exhibition object not found"})

        data = await request.json()
        if not data:
            raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "No data provided"})

        if "display_order" in data:
            exhibition_object.display_order = data["display_order"]
        if "section" in data:
            exhibition_object.section = data["section"]
        if "loan_in_id" in data:
            exhibition_object.loan_in_id = data["loan_in_id"]
        if "credit_line_override" in data:
            exhibition_object.credit_line_override = data["credit_line_override"]
        if "special_requirements" in data:
            exhibition_object.special_requirements = data["special_requirements"]
        if "installation_notes" in data:
            exhibition_object.installation_notes = data["installation_notes"]
        if "object_status" in data:
            exhibition_object.object_status = data["object_status"]
            if data["object_status"] == "confirmed" and not exhibition_object.confirmed_date:
                from datetime import date as date_type
                exhibition_object.confirmed_date = date_type.today()
        if "confirmed_date" in data:
            exhibition_object.confirmed_date = (
                datetime.fromisoformat(data["confirmed_date"]).date()
                if data["confirmed_date"]
                else None
            )
        if "condition_in_report_id" in data:
            exhibition_object.condition_in_report_id = data["condition_in_report_id"]
        if "condition_out_report_id" in data:
            exhibition_object.condition_out_report_id = data["condition_out_report_id"]

        db.commit()

        return {
            "exhibition_object_id": str(exhibition_object.exhibition_object_id),
            "message": "Exhibition object updated",
        }

    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Database constraint violation"})


# =============================================================================
# Route 9: Remove exhibition object
# =============================================================================


@router.delete("/api/organizations/{org_id}/collections/exhibitions/{exhibition_id}/objects/{exhibition_object_id}", response_model=MessageResponse, summary="Remove exhibition object")
def remove_exhibition_object(
    org_id: UUID,
    exhibition_id: UUID,
    exhibition_object_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Remove an object from an exhibition."""
    try:
        exhibition_object = (
            db.query(ExhibitionObject)
            .filter(
                and_(
                    ExhibitionObject.exhibition_object_id == exhibition_object_id,
                    ExhibitionObject.exhibition_id == exhibition_id,
                    ExhibitionObject.organization_id == org_id,
                )
            )
            .first()
        )

        if not exhibition_object:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Exhibition object not found"})

        db.delete(exhibition_object)
        db.commit()

        logger.info(f"Removed exhibition object {exhibition_object_id}")

        return {"message": "Object removed from exhibition"}

    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Cannot remove object: it is still referenced"})


# =============================================================================
# Route 10: Batch add exhibition objects
# =============================================================================


@router.post("/api/organizations/{org_id}/collections/exhibitions/{exhibition_id}/objects/batch", status_code=201, response_model=ExhibitionObjectsBatchAddedResponse, summary="Batch add exhibition objects")
async def batch_add_exhibition_objects(
    org_id: UUID,
    exhibition_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Add multiple objects to an exhibition at once.

    Supports both Collections objects (object_ids) and Bridge entities (entity_keys).
    Provide exactly one of object_ids or entity_keys array.
    """
    try:
        exhibition = (
            db.query(Exhibition)
            .filter(
                and_(
                    Exhibition.exhibition_id == exhibition_id,
                    Exhibition.organization_id == org_id,
                )
            )
            .first()
        )

        if not exhibition:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Exhibition not found"})

        data = await request.json()
        if not data:
            raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "Request body is required"})

        # Validate source arrays - exactly one must be provided
        has_object_ids = "object_ids" in data and data["object_ids"]
        has_entity_keys = "entity_keys" in data and data["entity_keys"]

        if not has_object_ids and not has_entity_keys:
            raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "Either object_ids or entity_keys array is required"})
        if has_object_ids and has_entity_keys:
            raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "Cannot specify both object_ids and entity_keys"})

        source_type = "collections" if has_object_ids else "bridge"
        source_ids = data.get("object_ids") or data.get("entity_keys")

        if not isinstance(source_ids, list):
            field = "object_ids" if has_object_ids else "entity_keys"
            raise HTTPException(status_code=400, detail={"code": "validation_error", "message": f"{field} must be an array"})

        # Get existing links for deduplication
        if has_object_ids:
            existing = (
                db.query(ExhibitionObject.object_id)
                .filter(
                    ExhibitionObject.exhibition_id == exhibition_id,
                    ExhibitionObject.object_id.isnot(None),
                )
                .all()
            )
            existing_ids = {str(e[0]) for e in existing if e[0]}
        else:
            existing = (
                db.query(ExhibitionObject.entity_key)
                .filter(
                    ExhibitionObject.exhibition_id == exhibition_id,
                    ExhibitionObject.entity_key.isnot(None),
                )
                .all()
            )
            existing_ids = {e[0] for e in existing if e[0]}

        # Get next display order
        max_order = (
            db.query(func.max(ExhibitionObject.display_order))
            .filter(ExhibitionObject.exhibition_id == exhibition_id)
            .scalar()
        ) or 0

        user_id = auth.user_id
        added = []
        skipped = []

        for i, source_id in enumerate(source_ids):
            if source_id in existing_ids:
                skipped.append(source_id)
                continue

            exhibition_object = ExhibitionObject(
                exhibition_id=exhibition_id,
                organization_id=org_id,
                object_id=source_id if has_object_ids else None,
                entity_key=source_id if has_entity_keys else None,
                display_order=max_order + i + 1,
                section=data.get("section"),
                object_status="planned",
                created_by=user_id,
            )
            db.add(exhibition_object)
            added.append(source_id)

        db.commit()

        return {
            "added": added,
            "skipped": skipped,
            "source_type": source_type,
            "message": f"Added {len(added)} objects, skipped {len(skipped)} existing",
        }

    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Database constraint violation"})


# =============================================================================
# =============================================================================
# Route 12: List label templates
# =============================================================================


@router.get("/api/organizations/{org_id}/exhibit/label-templates", response_model=LabelTemplateListResponse, summary="List label templates")
def list_label_templates(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.LABELS_VIEW)),
    db: Session = Depends(get_db),
):
    """List all label templates for the organization."""
    templates = (
        db.query(LabelTemplate)
        .filter(LabelTemplate.organization_id == org_id)
        .order_by(LabelTemplate.is_default.desc(), LabelTemplate.name)
        .all()
    )

    return {
        "label_templates": [
            {
                "template_id": str(t.template_id),
                "name": t.name,
                "label_type": t.label_type,
                "template_fields": t.template_fields,
                "font_family": t.font_family,
                "font_size_pt": t.font_size_pt,
                "width_cm": float(t.width_cm) if t.width_cm else None,
                "height_cm": float(t.height_cm) if t.height_cm else None,
                "is_default": t.is_default,
                "created_at": t.created_at.isoformat() if t.created_at else None,
            }
            for t in templates
        ]
    }


# =============================================================================
# Route 13: Create label template
# =============================================================================


@router.post("/api/organizations/{org_id}/exhibit/label-templates", status_code=201, response_model=LabelTemplateCreatedResponse, summary="Create label template")
async def create_label_template(
    org_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.LABELS_EDIT)),
    db: Session = Depends(get_db),
):
    """Create a new label template."""
    try:
        data = await request.json()
        if not data or "name" not in data or "label_type" not in data:
            raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "name and label_type are required"})

        valid_types = ["tombstone", "extended", "wall", "didactic"]
        if data["label_type"] not in valid_types:
            raise HTTPException(status_code=400, detail={"code": "validation_error", "message": f"label_type must be one of: {valid_types}"})

        user_id = auth.user_id

        template = LabelTemplate(
            organization_id=org_id,
            name=data["name"],
            label_type=data["label_type"],
            template_fields=data.get("template_fields", {"fields": [], "layout": "vertical"}),
            font_family=data.get("font_family", "Arial"),
            font_size_pt=data.get("font_size_pt", 12),
            width_cm=Decimal(str(data["width_cm"])) if data.get("width_cm") else None,
            height_cm=Decimal(str(data["height_cm"])) if data.get("height_cm") else None,
            is_default=data.get("is_default", False),
            created_by=user_id,
        )

        db.add(template)
        db.commit()

        logger.info(f"Created label template {template.template_id}")

        return {
            "template_id": str(template.template_id),
            "name": template.name,
            "message": "Label template created",
        }

    except IntegrityError as e:
        db.rollback()
        if "unique" in str(e).lower():
            raise HTTPException(status_code=409, detail={"code": "duplicate", "message": "A label template with this name already exists"})
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Database constraint violation"})


# =============================================================================
# Route 14: Update label template
# =============================================================================


@router.patch("/api/organizations/{org_id}/exhibit/label-templates/{template_id}", response_model=LabelTemplateUpdatedResponse, summary="Update label template")
async def update_label_template(
    org_id: UUID,
    template_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.LABELS_EDIT)),
    db: Session = Depends(get_db),
):
    """Update a label template."""
    try:
        template = (
            db.query(LabelTemplate)
            .filter(
                and_(
                    LabelTemplate.template_id == template_id,
                    LabelTemplate.organization_id == org_id,
                )
            )
            .first()
        )

        if not template:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Label template not found"})

        data = await request.json()
        if not data:
            raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "No data provided"})

        if "name" in data:
            template.name = data["name"]
        if "label_type" in data:
            valid_types = ["tombstone", "extended", "wall", "didactic"]
            if data["label_type"] not in valid_types:
                raise HTTPException(status_code=400, detail={"code": "validation_error", "message": f"label_type must be one of: {valid_types}"})
            template.label_type = data["label_type"]
        if "template_fields" in data:
            template.template_fields = data["template_fields"]
        if "font_family" in data:
            template.font_family = data["font_family"]
        if "font_size_pt" in data:
            template.font_size_pt = data["font_size_pt"]
        if "width_cm" in data:
            template.width_cm = Decimal(str(data["width_cm"])) if data["width_cm"] else None
        if "height_cm" in data:
            template.height_cm = Decimal(str(data["height_cm"])) if data["height_cm"] else None
        if "is_default" in data:
            template.is_default = data["is_default"]

        db.commit()

        return {
            "template_id": str(template.template_id),
            "message": "Label template updated",
        }

    except IntegrityError as e:
        db.rollback()
        if "unique" in str(e).lower():
            raise HTTPException(status_code=409, detail={"code": "duplicate", "message": "A label template with this name already exists"})
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Database constraint violation"})


# =============================================================================
# Route 15: Delete label template
# =============================================================================


@router.delete("/api/organizations/{org_id}/exhibit/label-templates/{template_id}", response_model=MessageResponse, summary="Delete label template")
def delete_label_template(
    org_id: UUID,
    template_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.LABELS_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete a label template."""
    try:
        template = (
            db.query(LabelTemplate)
            .filter(
                and_(
                    LabelTemplate.template_id == template_id,
                    LabelTemplate.organization_id == org_id,
                )
            )
            .first()
        )

        if not template:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Label template not found"})

        db.delete(template)
        db.commit()

        logger.info(f"Deleted label template {template_id}")

        return {"message": "Label template deleted"}

    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Cannot delete template: it is still in use by exhibition labels"})
