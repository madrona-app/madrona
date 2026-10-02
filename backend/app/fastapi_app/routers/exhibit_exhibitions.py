"""Exhibit Exhibitions, Objects, Labels, Content, Touring, Placements, PDF Exports — 30 routes migrated from Flask.

Sources:
- app/api/exhibit.py (exhibit_bp)
"""

import logging
from datetime import datetime, timezone
from decimal import Decimal
from io import BytesIO
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_auth, require_permission
from app.models import (
    CollectionObjectMedia,
    Exhibition,
    ExhibitionContentBlock,
    ExhibitionFloorPlan,
    ExhibitionLabel,
    ExhibitionObject,
    ExhibitionStatusHistory,
    ExhibitionVenue,
    FloorPlan,
    Placement,
    Venue,
)
from app.fastapi_app.schemas.common import MessageResponse
from app.fastapi_app.schemas.exhibit_exhibitions import (
    ContentBlockCreatedResponse,
    ContentBlockListResponse,
    EditorObjectListResponse,
    ExhibitionCreatedResponse,
    ExhibitionDetailOut,
    ExhibitionLabelListResponse,
    ExhibitionListResponse,
    ExhibitionObjectCreatedResponse,
    ExhibitionObjectListResponse,
    ExhibitionUpdateResponse,
    ExhibitionVenueListResponse,
    FloorPlanAddedResponse,
    LabelApprovedResponse,
    LabelsGeneratedResponse,
    PlacementCreatedResponse,
    PlacementUpdateResponse,
    TouringVenueCreatedResponse,
)
from app.permissions import Permission
from app.services.exhibit_object_source import ExhibitObjectSourceService
from app.services.public_cache import invalidate_org_cache_by_id
from app.services.entity_notifications import notify_status_change
from app.services.uploads import get_org_media_url

logger = logging.getLogger(__name__)


def _assert_exhibition_in_org(db: Session, org_id: UUID, exhibition_id: UUID) -> None:
    """404 unless the exhibition belongs to `org_id`.

    `exhibition_labels` has no organization_id of its own, so filtering on
    exhibition_id alone reads and writes another institution's rows.
    require_permission proves membership of the org in the PATH only. Backed
    by the exhibition_labels_via_parent RLS policy; this is the app-layer half.
    """
    exists = (
        db.query(Exhibition.exhibition_id)
        .filter(
            Exhibition.exhibition_id == exhibition_id,
            Exhibition.organization_id == org_id,
        )
        .first()
    )
    if not exists:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Exhibition not found"})


router = APIRouter(tags=["exhibit_exhibitions"])


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
    object_id: UUID, org_id: UUID, db_session: Session,
) -> str | None:
    """Get an image URL for a collection object's primary image.

    Returns a CDN URL if MEDIA_CDN_URL is configured, otherwise S3 presigned URL.
    """
    try:
        primary_link = (
            db_session.query(CollectionObjectMedia)
            .options(joinedload(CollectionObjectMedia.media))
            .filter(
                CollectionObjectMedia.object_id == object_id,
                CollectionObjectMedia.is_primary == True,
            )
            .first()
        )

        if not primary_link:
            primary_link = (
                db_session.query(CollectionObjectMedia)
                .options(joinedload(CollectionObjectMedia.media))
                .filter(CollectionObjectMedia.object_id == object_id)
                .order_by(CollectionObjectMedia.sort_order)
                .first()
            )

        if primary_link and primary_link.media:
            return get_org_media_url(
                primary_link.media.s3_key,
                organization_id=str(org_id),
                db_session=db_session,
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


@router.get("/api/organizations/{org_id}/exhibit/exhibitions", response_model=ExhibitionListResponse, summary="List exhibitions")
def list_exhibitions(
    org_id: UUID,
    status: str | None = None,
    exhibition_type: str | None = None,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_VIEW)),
    db: Session = Depends(get_db),
):
    """List all exhibitions for the organization."""
    query = db.query(Exhibition).filter(Exhibition.organization_id == org_id)

    if status:
        query = query.filter(Exhibition.status == status)
    if exhibition_type:
        query = query.filter(Exhibition.exhibition_type == exhibition_type)

    query = query.order_by(Exhibition.created_at.desc())
    exhibitions = query.all()

    return {
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
                "actual_start_date": e.actual_start_date.isoformat() if e.actual_start_date else None,
                "actual_end_date": e.actual_end_date.isoformat() if e.actual_end_date else None,
                "is_public": e.is_public,
                "public_url_slug": e.public_url_slug,
                "placement_count": len(e.placements) if e.placements else 0,
                "created_at": e.created_at.isoformat() if e.created_at else None,
            }
            for e in exhibitions
        ]
    }


# =============================================================================
# Route 2: Create exhibition
# =============================================================================


@router.post("/api/organizations/{org_id}/exhibit/exhibitions", status_code=201, response_model=ExhibitionCreatedResponse, summary="Create exhibition")
async def create_exhibition(
    org_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_CREATE)),
    db: Session = Depends(get_db),
):
    """Create a new exhibition."""
    try:
        data = await request.json()
        if not data:
            raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "Request body is required"})

        title = data.get("title")
        if not title:
            raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "Title is required"})

        exhibition = Exhibition(
            organization_id=org_id,
            title=title,
            description=data.get("description"),
            exhibition_type=data.get("exhibition_type", "temporary"),
            status=data.get("status", "proposed"),
            venue_id=data.get("venue_id"),
            planned_start_date=data.get("planned_start_date"),
            planned_end_date=data.get("planned_end_date"),
            is_public=data.get("is_public", False),
            public_url_slug=data.get("public_url_slug"),
            created_by=auth.user_id,
        )

        db.add(exhibition)
        db.commit()
        invalidate_org_cache_by_id(org_id, section="exhibition")

        return {
            "exhibition_id": str(exhibition.exhibition_id),
            "title": exhibition.title,
            "message": "Exhibition created successfully",
        }

    except IntegrityError as e:
        db.rollback()
        if "unique" in str(e).lower():
            raise HTTPException(status_code=409, detail={"code": "duplicate", "message": "An exhibition with this title already exists"})
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Database constraint violation"})


# =============================================================================
# Route 3: Get exhibition with full details
# =============================================================================


@router.get("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}", response_model=ExhibitionDetailOut, summary="Get exhibition")
def get_exhibition(
    org_id: UUID,
    exhibition_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_VIEW)),
    db: Session = Depends(get_db),
):
    """Get a single exhibition with full details."""
    exhibition = (
        db.query(Exhibition)
        .options(
            joinedload(Exhibition.venue),
            joinedload(Exhibition.placements).joinedload(Placement.floor_plan),
            joinedload(Exhibition.floor_plan_associations).joinedload(
                ExhibitionFloorPlan.floor_plan
            ),
            joinedload(Exhibition.status_history),
        )
        .filter(
            Exhibition.exhibition_id == exhibition_id,
            Exhibition.organization_id == org_id,
        )
        .first()
    )

    if not exhibition:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Exhibition not found"})

    # Build floor plans list with full geometry for 3D rendering
    floor_plans = []
    for assoc in sorted(exhibition.floor_plan_associations, key=lambda a: a.visit_order):
        fp = assoc.floor_plan
        if fp:
            floor_plans.append({
                "floor_plan_id": str(fp.floor_plan_id),
                "name": fp.name,
                "visit_order": assoc.visit_order,
                "geometry": fp.geometry,
                "ceiling_height_cm": fp.effective_ceiling_height,
                "wall_color": fp.effective_wall_color,
                "model_url": fp.model_url,
                "model_scale": float(fp.model_scale) if fp.model_scale else 1.0,
            })

    # Build status history
    status_history = []
    for sh in sorted(exhibition.status_history, key=lambda s: s.status_date, reverse=True):
        status_history.append({
            "status": sh.status,
            "status_date": sh.status_date.isoformat() if sh.status_date else None,
            "changed_by": str(sh.changed_by) if sh.changed_by else None,
            "notes": sh.notes,
        })

    # Build placements with full data for 3D rendering
    placements = []
    for p in exhibition.placements:
        image_url = p.image_url
        if p.source_type in ("collection_object", "collections") and p.source_id:
            fresh_url = _get_collection_object_image_url(p.source_id, org_id, db)
            if fresh_url:
                image_url = fresh_url

        placements.append({
            "placement_id": str(p.placement_id),
            "floor_plan_id": str(p.floor_plan_id) if p.floor_plan_id else None,
            "floor_plan_name": p.floor_plan.name if p.floor_plan else None,
            "source_type": p.source_type,
            "source_id": str(p.source_id) if p.source_id else None,
            "display_title": p.display_title,
            "display_artist": p.display_artist,
            "display_date": p.display_date,
            "display_medium": p.display_medium,
            "image_url": image_url,
            "model_url": p.model_url,
            "model_scale": float(p.model_scale) if p.model_scale else 1.0,
            "width_cm": float(p.width_cm) if p.width_cm else 50,
            "height_cm": float(p.height_cm) if p.height_cm else 70,
            "depth_cm": float(p.depth_cm) if p.depth_cm else 0,
            "wall_id": p.wall_id,
            "position_x": float(p.position_x) if p.position_x else 0,
            "position_y": float(p.position_y) if p.position_y else 150,
            "position_z": float(p.position_z) if p.position_z else 0,
            "rotation_degrees": float(p.rotation_degrees) if p.rotation_degrees else 0,
            "floor_position_x": float(p.floor_position_x) if p.floor_position_x is not None else None,
            "floor_position_y": float(p.floor_position_y) if p.floor_position_y is not None else None,
            "frame_style": p.frame_style,
            "frame_width_cm": float(p.frame_width_cm) if p.frame_width_cm else 0,
            "frame_style_id": str(p.frame_style_id) if p.frame_style_id else None,
            "mount_type": p.mount_type or "wall",
            "mount_config_id": str(p.mount_config_id) if p.mount_config_id else None,
            "label_position": p.label_position or "right",
            "label_text": p.label_text,
            "placement_status": p.placement_status,
            "notes": p.notes,
            "created_by": str(p.created_by) if p.created_by else None,
            "updated_by": str(p.updated_by) if p.updated_by else None,
            "frame_material": p.frame_material,
            "artwork_surface": p.artwork_surface,
            "lighting_fixture_type": p.lighting_fixture_type,
            "lighting_settings": p.lighting_settings,
        })

    return {
        "exhibition_id": str(exhibition.exhibition_id),
        "exhibition_number": exhibition.exhibition_number,
        "title": exhibition.title,
        "description": exhibition.description,
        "curator_notes": exhibition.curator_notes,
        "exhibition_type": exhibition.exhibition_type,
        "status": exhibition.status,
        "organizer_id": str(exhibition.organizer_id) if exhibition.organizer_id else None,
        "authorizer_id": str(exhibition.authorizer_id) if exhibition.authorizer_id else None,
        "authorization_date": exhibition.authorization_date.isoformat() if exhibition.authorization_date else None,
        "provisos": exhibition.provisos,
        "outcome": exhibition.outcome,
        "venue_id": str(exhibition.venue_id) if exhibition.venue_id else None,
        "venue_name": exhibition.venue.name if exhibition.venue else None,
        "planned_start_date": exhibition.planned_start_date.isoformat() if exhibition.planned_start_date else None,
        "planned_end_date": exhibition.planned_end_date.isoformat() if exhibition.planned_end_date else None,
        "actual_start_date": exhibition.actual_start_date.isoformat() if exhibition.actual_start_date else None,
        "actual_end_date": exhibition.actual_end_date.isoformat() if exhibition.actual_end_date else None,
        "is_public": exhibition.is_public,
        "public_url_slug": exhibition.public_url_slug,
        "created_at": exhibition.created_at.isoformat() if exhibition.created_at else None,
        "floor_plans": floor_plans,
        "placements": placements,
        "status_history": status_history,
    }


# =============================================================================
# Route 4: Update exhibition
# =============================================================================


@router.patch("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}", response_model=ExhibitionUpdateResponse, summary="Update exhibition")
async def update_exhibition(
    org_id: UUID,
    exhibition_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Update an exhibition."""
    try:
        exhibition = db.query(Exhibition).filter(
            Exhibition.exhibition_id == exhibition_id,
            Exhibition.organization_id == org_id,
        ).first()

        if not exhibition:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Exhibition not found"})

        data = await request.json()
        if not data:
            raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "Request body is required"})

        allowed_fields = [
            "title", "description", "curator_notes", "exhibition_type",
            "status", "provisos", "outcome", "venue_id",
            "planned_start_date", "planned_end_date",
            "actual_start_date", "actual_end_date",
            "is_public", "public_url_slug",
        ]

        for field in allowed_fields:
            if field in data:
                setattr(exhibition, field, data[field])

        exhibition.updated_at = datetime.now(timezone.utc)
        db.commit()
        invalidate_org_cache_by_id(org_id, section="exhibition")

        return {"exhibition_id": str(exhibition.exhibition_id), "message": "Exhibition updated successfully"}

    except IntegrityError as e:
        db.rollback()
        if "unique" in str(e).lower():
            raise HTTPException(status_code=409, detail={"code": "duplicate", "message": "An exhibition with this title already exists"})
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Database constraint violation"})


# =============================================================================
# Route 5: Delete exhibition
# =============================================================================


@router.delete("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}", response_model=MessageResponse, summary="Delete exhibition")
def delete_exhibition(
    org_id: UUID,
    exhibition_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_DELETE)),
    db: Session = Depends(get_db),
):
    """Delete an exhibition."""
    try:
        exhibition = db.query(Exhibition).filter(
            Exhibition.exhibition_id == exhibition_id,
            Exhibition.organization_id == org_id,
        ).first()

        if not exhibition:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Exhibition not found"})

        db.delete(exhibition)
        db.commit()
        invalidate_org_cache_by_id(org_id, section="exhibition")

        return {"message": "Exhibition deleted successfully"}

    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Cannot delete exhibition: it is still in use"})


# =============================================================================
# Route 6: List exhibition objects
# =============================================================================


@router.get("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/objects", response_model=ExhibitionObjectListResponse, summary="List exhibition objects")
def list_exhibition_objects(
    org_id: UUID,
    exhibition_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_VIEW)),
    db: Session = Depends(get_db),
):
    """List objects linked to an exhibition."""
    exhibition_objects = (
        db.query(ExhibitionObject)
        .filter(
            ExhibitionObject.exhibition_id == exhibition_id,
            ExhibitionObject.organization_id == org_id,
        )
        .order_by(ExhibitionObject.display_order)
        .all()
    )

    service = ExhibitObjectSourceService(db, org_id)

    results = []
    for obj in exhibition_objects:
        serialized = _serialize_exhibition_object_with_source(obj, service)
        if obj.object_id:
            serialized["primary_image_url"] = _get_collection_object_image_url(obj.object_id, org_id, db)
        results.append(serialized)

    return {"exhibition_objects": results}


# =============================================================================
# Route 7: List exhibition objects for 3D editor
# =============================================================================


@router.get("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/objects/for-editor", response_model=EditorObjectListResponse, summary="List exhibition objects for editor")
def list_exhibition_objects_for_editor(
    org_id: UUID,
    exhibition_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_VIEW)),
    db: Session = Depends(get_db),
):
    """List objects linked to an exhibition with data needed for 3D editor."""
    from app.models import CollectionObject

    exhibition_objects = (
        db.query(ExhibitionObject)
        .filter(
            ExhibitionObject.exhibition_id == exhibition_id,
            ExhibitionObject.organization_id == org_id,
        )
        .order_by(ExhibitionObject.display_order)
        .all()
    )

    service = ExhibitObjectSourceService(db, org_id)
    objects_for_editor = []

    for obj in exhibition_objects:
        obj_data = service.get_object_data(obj)

        width_cm = None
        height_cm = None
        depth_cm = None
        creators = []
        primary_image_url = obj_data.thumbnail_url

        if obj.object_id and obj_data.collection_object:
            coll_obj = obj_data.collection_object
            primary_image_url = _get_collection_object_image_url(obj.object_id, org_id, db)

            if coll_obj.creators:
                for c in coll_obj.creators:
                    if c.get("name"):
                        creators.append({"name": c.get("name"), "role": c.get("role")})

            if coll_obj.measurement_links:
                for m in coll_obj.measurement_links:
                    dim = (m.dimension or "").lower()
                    value = float(m.value) if m.value is not None else None
                    unit = (m.unit or "").lower()

                    if value is None:
                        continue

                    if unit == "mm":
                        value = value / 10
                    elif unit == "m":
                        value = value * 100
                    elif unit in ("in", "inch", "inches"):
                        value = value * 2.54

                    if dim in ("width", "w"):
                        width_cm = value
                    elif dim in ("height", "h"):
                        height_cm = value
                    elif dim in ("depth", "d"):
                        depth_cm = value

        elif obj.entity_key and obj_data.payload:
            payload = obj_data.payload
            width_cm = payload.get("width_cm") or payload.get("width")
            height_cm = payload.get("height_cm") or payload.get("height")
            depth_cm = payload.get("depth_cm") or payload.get("depth")

            if payload.get("creators"):
                creators = payload["creators"]
            elif payload.get("artist"):
                creators = [{"name": payload["artist"], "role": "artist"}]

        objects_for_editor.append({
            "exhibition_object_id": str(obj.exhibition_object_id),
            "source_type": obj_data.source_type,
            "object_id": str(obj.object_id) if obj.object_id else None,
            "entity_key": obj.entity_key,
            "object_number": obj_data.object_number,
            "title": obj_data.title,
            "creators": creators,
            "primary_image_url": primary_image_url,
            "width_cm": width_cm,
            "height_cm": height_cm,
            "depth_cm": depth_cm,
            "object_status": obj.object_status,
            "section": obj.section,
        })

    return {"objects": objects_for_editor, "total": len(objects_for_editor)}


# =============================================================================
# Route 8: Add object to exhibition
# =============================================================================


@router.post("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/objects", status_code=201, response_model=ExhibitionObjectCreatedResponse, summary="Add exhibition object")
async def add_exhibition_object(
    org_id: UUID,
    exhibition_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Add an object to an exhibition."""
    try:
        data = await request.json()
        if not data:
            raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "Request body is required"})

        has_object_id = bool(data.get("object_id"))
        has_entity_key = bool(data.get("entity_key"))

        if not has_object_id and not has_entity_key:
            raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "Either object_id or entity_key is required"})
        if has_object_id and has_entity_key:
            raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "Cannot specify both object_id and entity_key"})

        exhibition = db.query(Exhibition).filter(
            Exhibition.exhibition_id == exhibition_id,
            Exhibition.organization_id == org_id,
        ).first()
        if not exhibition:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Exhibition not found"})

        max_order = db.query(func.max(ExhibitionObject.display_order)).filter(
            ExhibitionObject.exhibition_id == exhibition_id
        ).scalar() or 0

        obj = ExhibitionObject(
            exhibition_id=exhibition_id,
            organization_id=org_id,
            object_id=data.get("object_id"),
            entity_key=data.get("entity_key"),
            display_order=data.get("display_order", max_order + 1),
            section=data.get("section"),
            object_status=data.get("object_status", "planned"),
            credit_line_override=data.get("credit_line_override"),
            special_requirements=data.get("special_requirements"),
            installation_notes=data.get("installation_notes"),
            created_by=auth.user_id,
        )
        db.add(obj)
        db.commit()

        source_type = "collections" if has_object_id else "bridge"
        return {
            "exhibition_object_id": str(obj.exhibition_object_id),
            "source_type": source_type,
            "message": "Object added to exhibition",
        }

    except IntegrityError as e:
        db.rollback()
        if "unique" in str(e).lower():
            raise HTTPException(status_code=409, detail={"code": "duplicate", "message": "This object is already linked to the exhibition"})
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Database constraint violation"})


# =============================================================================
# Route 9: Update exhibition object
# =============================================================================


@router.patch("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/objects/{exhibition_object_id}", response_model=MessageResponse, summary="Update exhibition object")
async def update_exhibition_object(
    org_id: UUID,
    exhibition_id: UUID,
    exhibition_object_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Update an exhibition object."""
    try:
        obj = db.query(ExhibitionObject).filter(
            ExhibitionObject.exhibition_object_id == exhibition_object_id,
            ExhibitionObject.exhibition_id == exhibition_id,
            ExhibitionObject.organization_id == org_id,
        ).first()
        if not obj:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Exhibition object not found"})

        data = await request.json()
        for field in [
            "display_order", "section", "object_status", "confirmed_date",
            "credit_line_override", "special_requirements", "installation_notes",
        ]:
            if field in data:
                setattr(obj, field, data[field])

        obj.updated_at = datetime.now(timezone.utc)
        db.commit()

        return {"message": "Exhibition object updated"}

    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Database constraint violation"})


# =============================================================================
# Route 10: Delete exhibition object
# =============================================================================


@router.delete("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/objects/{exhibition_object_id}", response_model=MessageResponse, summary="Delete exhibition object")
def delete_exhibition_object(
    org_id: UUID,
    exhibition_id: UUID,
    exhibition_object_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Remove an object from an exhibition."""
    try:
        obj = db.query(ExhibitionObject).filter(
            ExhibitionObject.exhibition_object_id == exhibition_object_id,
            ExhibitionObject.exhibition_id == exhibition_id,
            ExhibitionObject.organization_id == org_id,
        ).first()
        if not obj:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Exhibition object not found"})

        db.delete(obj)
        db.commit()

        return {"message": "Object removed from exhibition"}

    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Cannot remove object: it is still referenced"})


# =============================================================================
# Route 11: List exhibition labels
# =============================================================================


@router.get("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/labels", response_model=ExhibitionLabelListResponse, summary="List exhibition labels")
def list_exhibition_labels(
    org_id: UUID,
    exhibition_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.LABELS_VIEW)),
    db: Session = Depends(get_db),
):
    """List labels for an exhibition."""
    _assert_exhibition_in_org(db, org_id, exhibition_id)

    labels = (
        db.query(ExhibitionLabel)
        .filter(ExhibitionLabel.exhibition_id == exhibition_id)
        .order_by(ExhibitionLabel.created_at.desc())
        .all()
    )

    return {
        "exhibition_labels": [
            {
                "label_id": str(label.label_id),
                "exhibition_object_id": str(label.exhibition_object_id) if label.exhibition_object_id else None,
                "template_id": str(label.template_id) if label.template_id else None,
                "label_type": label.label_type,
                "generated_text": label.generated_text,
                "custom_text": label.custom_text,
                "status": label.status,
                "print_count": label.print_count,
                "created_at": label.created_at.isoformat() if label.created_at else None,
            }
            for label in labels
        ]
    }


# =============================================================================
# Route 12: Generate exhibition labels
# =============================================================================


@router.post("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/labels/generate", status_code=201, response_model=LabelsGeneratedResponse, summary="Generate exhibition labels")
async def generate_exhibition_labels(
    org_id: UUID,
    exhibition_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.LABELS_EDIT)),
    db: Session = Depends(get_db),
):
    """Generate labels for exhibition objects."""
    try:
        data = await request.json()
        if not data:
            data = {}
        template_id = data.get("template_id")

        objects = db.query(ExhibitionObject).filter(
            ExhibitionObject.exhibition_id == exhibition_id,
            ExhibitionObject.organization_id == org_id,
        ).all()

        labels_created = 0
        for obj in objects:
            label = ExhibitionLabel(
                exhibition_id=exhibition_id,
                exhibition_object_id=obj.exhibition_object_id,
                template_id=template_id,
                label_type=data.get("label_type", "tombstone"),
                generated_text=f"Label for object {obj.object_id}",
                status="draft",
            )
            db.add(label)
            labels_created += 1

        db.commit()

        return {
            "message": f"Generated {labels_created} labels",
            "labels_created": labels_created,
        }

    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Database constraint violation"})


# =============================================================================
# Route 13: Approve exhibition label
# =============================================================================


@router.post("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/labels/{label_id}/approve", response_model=LabelApprovedResponse, summary="Approve exhibition label")
def approve_exhibition_label(
    org_id: UUID,
    exhibition_id: UUID,
    label_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Approve an exhibition label."""
    _assert_exhibition_in_org(db, org_id, exhibition_id)

    try:
        label = db.query(ExhibitionLabel).filter(
            ExhibitionLabel.label_id == label_id,
            ExhibitionLabel.exhibition_id == exhibition_id,
        ).first()

        if not label:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Label not found"})

        label.status = "approved"
        label.approved_by = auth.user_id
        label.approved_at = func.now()

        db.commit()

        return {
            "label_id": str(label.label_id),
            "status": label.status,
            "message": "Label approved successfully",
        }

    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Database constraint violation"})


# =============================================================================
# Route 14: List content blocks
# =============================================================================


@router.get("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/content-blocks", response_model=ContentBlockListResponse, summary="List content blocks")
def list_content_blocks(
    org_id: UUID,
    exhibition_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_CONTENT_VIEW)),
    db: Session = Depends(get_db),
):
    """List content blocks for an exhibition."""
    blocks = (
        db.query(ExhibitionContentBlock)
        .filter(ExhibitionContentBlock.exhibition_id == exhibition_id)
        .order_by(ExhibitionContentBlock.display_order)
        .all()
    )

    return {
        "content_blocks": [
            {
                "block_id": str(block.block_id),
                "block_type": block.block_type,
                "section": block.section,
                "display_order": block.display_order,
                "title": block.title,
                "content": block.content,
                "content_format": block.content_format,
                "status": block.status,
                "is_public": block.is_public,
                "created_at": block.created_at.isoformat() if block.created_at else None,
            }
            for block in blocks
        ]
    }


# =============================================================================
# Route 15: Create content block
# =============================================================================


@router.post("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/content-blocks", status_code=201, response_model=ContentBlockCreatedResponse, summary="Create content block")
async def create_content_block(
    org_id: UUID,
    exhibition_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_CONTENT_EDIT)),
    db: Session = Depends(get_db),
):
    """Create a content block."""
    try:
        data = await request.json()
        if not data:
            raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "Request body required"})

        max_order = db.query(func.max(ExhibitionContentBlock.display_order)).filter(
            ExhibitionContentBlock.exhibition_id == exhibition_id
        ).scalar() or 0

        block = ExhibitionContentBlock(
            exhibition_id=exhibition_id,
            block_type=data.get("block_type", "theme_narrative"),
            section=data.get("section"),
            display_order=data.get("display_order", max_order + 1),
            title=data.get("title"),
            content=data.get("content", ""),
            content_format=data.get("content_format", "markdown"),
            status=data.get("status", "draft"),
            is_public=data.get("is_public", False),
            created_by=auth.user_id,
        )
        db.add(block)
        db.commit()

        return {
            "block_id": str(block.block_id),
            "message": "Content block created",
        }

    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Database constraint violation"})


# =============================================================================
# Route 16: Update content block
# =============================================================================


@router.patch("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/content-blocks/{block_id}", response_model=MessageResponse, summary="Update content block")
async def update_content_block(
    org_id: UUID,
    exhibition_id: UUID,
    block_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_CONTENT_EDIT)),
    db: Session = Depends(get_db),
):
    """Update a content block."""
    try:
        block = db.query(ExhibitionContentBlock).filter(
            ExhibitionContentBlock.block_id == block_id,
            ExhibitionContentBlock.exhibition_id == exhibition_id,
        ).first()
        if not block:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Content block not found"})

        data = await request.json()
        for field in [
            "block_type", "section", "display_order", "title", "content",
            "content_format", "status", "is_public",
        ]:
            if field in data:
                setattr(block, field, data[field])

        db.commit()
        return {"message": "Content block updated"}

    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Database constraint violation"})


# =============================================================================
# Route 17: Delete content block
# =============================================================================


@router.delete("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/content-blocks/{block_id}", response_model=MessageResponse, summary="Delete content block")
def delete_content_block(
    org_id: UUID,
    exhibition_id: UUID,
    block_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_CONTENT_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete a content block."""
    try:
        block = db.query(ExhibitionContentBlock).filter(
            ExhibitionContentBlock.block_id == block_id,
            ExhibitionContentBlock.exhibition_id == exhibition_id,
        ).first()
        if not block:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Content block not found"})

        db.delete(block)
        db.commit()
        return {"message": "Content block deleted"}

    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Cannot delete content block: it is still referenced"})


# =============================================================================
# Route 18: Reorder content blocks
# =============================================================================


@router.patch("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/content-blocks/reorder", response_model=MessageResponse, summary="Reorder content blocks")
async def reorder_content_blocks(
    org_id: UUID,
    exhibition_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_CONTENT_EDIT)),
    db: Session = Depends(get_db),
):
    """Reorder content blocks."""
    try:
        data = await request.json()
        block_ids = data.get("block_ids", [])

        for idx, bid in enumerate(block_ids):
            db.query(ExhibitionContentBlock).filter(
                ExhibitionContentBlock.block_id == bid,
                ExhibitionContentBlock.exhibition_id == exhibition_id,
            ).update({"display_order": idx})

        db.commit()
        return {"message": "Content blocks reordered"}

    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Database constraint violation"})


# =============================================================================
# Route 19: List touring venues
# =============================================================================


@router.get("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/venues", response_model=ExhibitionVenueListResponse, summary="List touring venues")
def list_touring_venues(
    org_id: UUID,
    exhibition_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.TOURING_VIEW)),
    db: Session = Depends(get_db),
):
    """List touring venues for an exhibition."""
    venues = (
        db.query(ExhibitionVenue)
        .filter(ExhibitionVenue.exhibition_id == exhibition_id)
        .order_by(ExhibitionVenue.tour_order)
        .all()
    )

    return {
        "exhibition_venues": [
            {
                "exhibition_venue_id": str(v.exhibition_venue_id),
                "venue_id": str(v.venue_id) if v.venue_id else None,
                "external_venue_name": v.external_venue_name,
                "external_venue_address": v.external_venue_address,
                "tour_order": v.tour_order,
                "planned_start_date": v.planned_start_date.isoformat() if v.planned_start_date else None,
                "planned_end_date": v.planned_end_date.isoformat() if v.planned_end_date else None,
                "actual_start_date": v.actual_start_date.isoformat() if v.actual_start_date else None,
                "actual_end_date": v.actual_end_date.isoformat() if v.actual_end_date else None,
                "status": v.status,
                "fee_amount": float(v.fee_amount) if v.fee_amount else None,
                "fee_currency": v.fee_currency,
                "special_requirements": v.special_requirements,
                "created_at": v.created_at.isoformat() if v.created_at else None,
            }
            for v in venues
        ]
    }


# =============================================================================
# Route 20: Create touring venue
# =============================================================================


@router.post("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/venues", status_code=201, response_model=TouringVenueCreatedResponse, summary="Create touring venue")
async def create_touring_venue(
    org_id: UUID,
    exhibition_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.TOURING_EDIT)),
    db: Session = Depends(get_db),
):
    """Add a touring venue."""
    try:
        data = await request.json()
        if not data:
            raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "Request body required"})

        max_order = db.query(func.max(ExhibitionVenue.tour_order)).filter(
            ExhibitionVenue.exhibition_id == exhibition_id
        ).scalar() or 0

        venue = ExhibitionVenue(
            exhibition_id=exhibition_id,
            venue_id=data.get("venue_id"),
            external_venue_name=data.get("external_venue_name"),
            external_venue_address=data.get("external_venue_address"),
            tour_order=data.get("tour_order", max_order + 1),
            planned_start_date=data.get("planned_start_date"),
            planned_end_date=data.get("planned_end_date"),
            status=data.get("status", "proposed"),
            fee_amount=data.get("fee_amount"),
            fee_currency=data.get("fee_currency"),
            special_requirements=data.get("special_requirements"),
        )
        db.add(venue)
        db.commit()

        return {
            "exhibition_venue_id": str(venue.exhibition_venue_id),
            "message": "Tour venue added",
        }

    except IntegrityError as e:
        db.rollback()
        if "unique" in str(e).lower():
            raise HTTPException(status_code=409, detail={"code": "duplicate", "message": "This venue is already part of the exhibition tour"})
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Database constraint violation"})


# =============================================================================
# Route 21: Update touring venue
# =============================================================================


@router.patch("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/venues/{exhibition_venue_id}", response_model=MessageResponse, summary="Update touring venue")
async def update_touring_venue(
    org_id: UUID,
    exhibition_id: UUID,
    exhibition_venue_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.TOURING_EDIT)),
    db: Session = Depends(get_db),
):
    """Update a touring venue."""
    try:
        venue = db.query(ExhibitionVenue).filter(
            ExhibitionVenue.exhibition_venue_id == exhibition_venue_id,
            ExhibitionVenue.exhibition_id == exhibition_id,
        ).first()
        if not venue:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Tour venue not found"})

        data = await request.json()
        for field in [
            "venue_id", "external_venue_name", "external_venue_address",
            "tour_order", "planned_start_date", "planned_end_date",
            "actual_start_date", "actual_end_date", "status",
            "fee_amount", "fee_currency", "special_requirements",
        ]:
            if field in data:
                setattr(venue, field, data[field])

        db.commit()
        return {"message": "Tour venue updated"}

    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Database constraint violation"})


# =============================================================================
# Route 22: Delete touring venue
# =============================================================================


@router.delete("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/venues/{exhibition_venue_id}", response_model=MessageResponse, summary="Delete touring venue")
def delete_touring_venue(
    org_id: UUID,
    exhibition_id: UUID,
    exhibition_venue_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.TOURING_EDIT)),
    db: Session = Depends(get_db),
):
    """Remove a touring venue."""
    try:
        venue = db.query(ExhibitionVenue).filter(
            ExhibitionVenue.exhibition_venue_id == exhibition_venue_id,
            ExhibitionVenue.exhibition_id == exhibition_id,
        ).first()
        if not venue:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Tour venue not found"})

        db.delete(venue)
        db.commit()
        return {"message": "Tour venue removed"}

    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Cannot remove tour venue: it is still referenced"})


# =============================================================================
# Route 23: Add floor plan to exhibition
# =============================================================================


@router.post("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/floor-plans", status_code=201, response_model=FloorPlanAddedResponse, summary="Add floor plan to exhibition")
async def add_floor_plan_to_exhibition(
    org_id: UUID,
    exhibition_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Add a floor plan to an exhibition."""
    try:
        exhibition = db.query(Exhibition).filter(
            and_(
                Exhibition.exhibition_id == exhibition_id,
                Exhibition.organization_id == org_id,
            )
        ).first()

        if not exhibition:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Exhibition not found"})

        data = await request.json()
        if not data or "floor_plan_id" not in data:
            raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "floor_plan_id is required"})

        floor_plan_id = data["floor_plan_id"]

        # Verify floor plan exists and belongs to org
        floor_plan = (
            db.query(FloorPlan)
            .options(joinedload(FloorPlan.venue))
            .filter(FloorPlan.floor_plan_id == floor_plan_id)
            .first()
        )

        if not floor_plan or floor_plan.venue.organization_id != org_id:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Floor plan not found"})

        # Check if already associated
        existing = db.query(ExhibitionFloorPlan).filter(
            and_(
                ExhibitionFloorPlan.exhibition_id == exhibition_id,
                ExhibitionFloorPlan.floor_plan_id == floor_plan_id,
            )
        ).first()

        if existing:
            raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "Floor plan already in exhibition"})

        max_order = db.query(func.max(ExhibitionFloorPlan.visit_order)).filter(
            ExhibitionFloorPlan.exhibition_id == exhibition_id
        ).scalar()
        next_order = (max_order or 0) + 1

        assoc = ExhibitionFloorPlan(
            exhibition_id=exhibition_id,
            floor_plan_id=floor_plan_id,
            visit_order=data.get("visit_order", next_order),
        )

        db.add(assoc)
        db.commit()

        return {
            "message": "Floor plan added to exhibition",
            "floor_plan_id": str(floor_plan_id),
            "visit_order": assoc.visit_order,
        }

    except IntegrityError as e:
        db.rollback()
        if "unique" in str(e).lower():
            raise HTTPException(status_code=409, detail={"code": "duplicate", "message": "This floor plan is already in the exhibition"})
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Database constraint violation"})


# =============================================================================
# Route 24: Remove floor plan from exhibition
# =============================================================================


@router.delete("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/floor-plans/{floor_plan_id}", response_model=MessageResponse, summary="Remove floor plan from exhibition")
def remove_floor_plan_from_exhibition(
    org_id: UUID,
    exhibition_id: UUID,
    floor_plan_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Remove a floor plan from an exhibition."""
    try:
        exhibition = db.query(Exhibition).filter(
            and_(
                Exhibition.exhibition_id == exhibition_id,
                Exhibition.organization_id == org_id,
            )
        ).first()

        if not exhibition:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Exhibition not found"})

        assoc = db.query(ExhibitionFloorPlan).filter(
            and_(
                ExhibitionFloorPlan.exhibition_id == exhibition_id,
                ExhibitionFloorPlan.floor_plan_id == floor_plan_id,
            )
        ).first()

        if not assoc:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Floor plan in exhibition not found"})

        # Also delete placements for this floor plan in this exhibition
        db.query(Placement).filter(
            and_(
                Placement.exhibition_id == exhibition_id,
                Placement.floor_plan_id == floor_plan_id,
            )
        ).delete()

        db.delete(assoc)
        db.commit()

        return {"message": "Floor plan removed from exhibition"}

    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Cannot remove floor plan: it still has placements"})


# =============================================================================
# Route 25: Create placement
# =============================================================================


@router.post("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/placements", status_code=201, response_model=PlacementCreatedResponse, summary="Create placement")
async def create_placement(
    org_id: UUID,
    exhibition_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Create a new artwork placement in an exhibition."""
    try:
        exhibition = db.query(Exhibition).filter(
            and_(
                Exhibition.exhibition_id == exhibition_id,
                Exhibition.organization_id == org_id,
            )
        ).first()

        if not exhibition:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Exhibition not found"})

        data = await request.json()
        if not data:
            raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "No data provided"})

        required_fields = ["floor_plan_id", "source_type", "width_cm", "height_cm", "wall_id", "position_x", "position_y"]
        for field in required_fields:
            if field not in data:
                raise HTTPException(status_code=400, detail={"code": "validation_error", "message": f"{field} is required"})

        # Verify floor plan is in exhibition
        fp_id = UUID(data["floor_plan_id"])
        assoc = db.query(ExhibitionFloorPlan).filter(
            and_(
                ExhibitionFloorPlan.exhibition_id == exhibition_id,
                ExhibitionFloorPlan.floor_plan_id == fp_id,
            )
        ).first()

        if not assoc:
            raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "Floor plan not in exhibition"})

        source_id = None
        if data.get("source_id"):
            source_id = UUID(data["source_id"])

        # Validate that collection objects must be linked to exhibition first
        if data.get("source_type") == "collections" and source_id:
            linked = db.query(ExhibitionObject).filter(
                and_(
                    ExhibitionObject.exhibition_id == exhibition_id,
                    ExhibitionObject.object_id == source_id,
                )
            ).first()
            if not linked:
                raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "Object must be linked to this exhibition first"})

        placement = Placement(
            exhibition_id=exhibition_id,
            floor_plan_id=fp_id,
            source_type=data["source_type"],
            source_id=source_id,
            external_url=data.get("external_url"),
            display_title=data.get("display_title"),
            display_artist=data.get("display_artist"),
            display_date=data.get("display_date"),
            display_medium=data.get("display_medium"),
            image_url=data.get("image_url"),
            model_url=data.get("model_url"),
            model_scale=Decimal(str(data.get("model_scale", 1.0))),
            width_cm=Decimal(str(data["width_cm"])),
            height_cm=Decimal(str(data["height_cm"])),
            depth_cm=Decimal(str(data.get("depth_cm", 0))),
            wall_id=data["wall_id"],
            position_x=Decimal(str(data["position_x"])),
            position_y=Decimal(str(data["position_y"])),
            position_z=Decimal(str(data.get("position_z", 0))),
            rotation_degrees=Decimal(str(data.get("rotation_degrees", 0))),
            floor_position_x=Decimal(str(data["floor_position_x"])) if data.get("floor_position_x") is not None else None,
            floor_position_y=Decimal(str(data["floor_position_y"])) if data.get("floor_position_y") is not None else None,
            frame_style=data.get("frame_style"),
            frame_width_cm=Decimal(str(data.get("frame_width_cm", 0))),
            frame_style_id=data.get("frame_style_id"),
            mount_type=data.get("mount_type", "wall"),
            mount_config_id=data.get("mount_config_id"),
            label_position=data.get("label_position", "right"),
            label_text=data.get("label_text"),
            placement_status=data.get("placement_status", "draft"),
            notes=data.get("notes"),
            created_by=auth.user_id,
        )

        db.add(placement)
        db.commit()

        logger.info(f"Created placement {placement.placement_id} in exhibition {exhibition_id}")

        return {
            "placement_id": str(placement.placement_id),
            "message": "Placement created successfully",
        }

    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Database constraint violation"})


# =============================================================================
# Route 26: Update placement
# =============================================================================


@router.patch("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/placements/{placement_id}", response_model=PlacementUpdateResponse, summary="Update placement")
async def update_placement(
    org_id: UUID,
    exhibition_id: UUID,
    placement_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Update a placement."""
    try:
        placement = (
            db.query(Placement)
            .options(joinedload(Placement.exhibition))
            .filter(
                and_(
                    Placement.placement_id == placement_id,
                    Placement.exhibition_id == exhibition_id,
                )
            )
            .first()
        )

        if not placement or placement.exhibition.organization_id != org_id:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Placement not found"})

        data = await request.json()
        if not data:
            raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "No data provided"})

        # Decimal fields
        decimal_fields = [
            "position_x", "position_y", "position_z", "rotation_degrees",
            "width_cm", "height_cm", "depth_cm", "model_scale", "frame_width_cm",
        ]
        for field in decimal_fields:
            if field in data:
                setattr(placement, field, Decimal(str(data[field])))

        # Nullable decimal fields
        if "floor_position_x" in data:
            placement.floor_position_x = Decimal(str(data["floor_position_x"])) if data["floor_position_x"] is not None else None
        if "floor_position_y" in data:
            placement.floor_position_y = Decimal(str(data["floor_position_y"])) if data["floor_position_y"] is not None else None

        # String fields
        string_fields = [
            "wall_id", "display_title", "display_artist", "display_date",
            "display_medium", "image_url", "model_url", "frame_style",
            "mount_type", "label_position", "label_text", "notes",
            "frame_material", "artwork_surface", "lighting_fixture_type",
        ]
        for field in string_fields:
            if field in data:
                setattr(placement, field, data[field])

        # UUID fields
        for field in ["frame_style_id", "mount_config_id"]:
            if field in data:
                setattr(placement, field, data[field])

        # JSON fields
        if "lighting_settings" in data:
            placement.lighting_settings = data["lighting_settings"]

        # Status with validation
        if "placement_status" in data:
            if data["placement_status"] not in ("draft", "proposed", "approved"):
                raise HTTPException(status_code=400, detail={"code": "validation_error", "message": "Invalid placement_status"})
            placement.placement_status = data["placement_status"]

        placement.updated_by = auth.user_id

        db.commit()

        return {"placement_id": str(placement.placement_id), "message": "Placement updated successfully"}

    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Database constraint violation"})


# =============================================================================
# Route 27: Delete placement
# =============================================================================


@router.delete("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/placements/{placement_id}", response_model=MessageResponse, summary="Delete placement")
def delete_placement(
    org_id: UUID,
    exhibition_id: UUID,
    placement_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete a placement."""
    try:
        placement = (
            db.query(Placement)
            .options(joinedload(Placement.exhibition))
            .filter(
                and_(
                    Placement.placement_id == placement_id,
                    Placement.exhibition_id == exhibition_id,
                )
            )
            .first()
        )

        if not placement or placement.exhibition.organization_id != org_id:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Placement not found"})

        db.delete(placement)
        db.commit()

        logger.info(f"Deleted placement {placement_id}")

        return {"message": "Placement deleted successfully"}

    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Cannot delete placement: it is still referenced"})


# =============================================================================
# Route 28: Export object checklist PDF
# =============================================================================


@router.post("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/exports/object-checklist", summary="Export object checklist")
async def export_object_checklist(
    org_id: UUID,
    exhibition_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_VIEW)),
    db: Session = Depends(get_db),
):
    """Generate object checklist PDF for installation."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer

    exhibition = (
        db.query(Exhibition)
        .options(joinedload(Exhibition.placements).joinedload(Placement.floor_plan))
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

    try:
        data = await request.json()
    except Exception:
        data = {}
    include_images = data.get("include_images", False)

    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, topMargin=2 * cm, bottomMargin=2 * cm)
    styles = getSampleStyleSheet()
    elements = []

    title_style = ParagraphStyle("Title", parent=styles["Heading1"], fontSize=18, spaceAfter=20)
    elements.append(Paragraph(f"Installation Checklist: {exhibition.title}", title_style))
    elements.append(Paragraph(
        "<i>Planning document - verify positions before installation</i>",
        styles["Italic"],
    ))
    elements.append(Spacer(1, 20))

    # Group placements by floor plan and wall
    placements_by_room: dict = {}
    for p in exhibition.placements:
        room_name = p.floor_plan.name if p.floor_plan else "Unassigned"
        if room_name not in placements_by_room:
            placements_by_room[room_name] = {}
        wall = p.wall_id
        if wall not in placements_by_room[room_name]:
            placements_by_room[room_name][wall] = []
        placements_by_room[room_name][wall].append(p)

    for room_name, walls in placements_by_room.items():
        elements.append(Paragraph(f"<b>{room_name}</b>", styles["Heading2"]))
        elements.append(Spacer(1, 10))

        for wall_id, wall_placements in walls.items():
            elements.append(Paragraph(f"{wall_id.title()} Wall", styles["Heading3"]))

            table_data = [["✓", "Artwork", "Position", "Size", "Status", "Notes"]]

            for p in sorted(wall_placements, key=lambda x: float(x.position_x)):
                status_display = {
                    "draft": "○ Draft",
                    "proposed": "◐ Proposed",
                    "approved": "● Approved",
                }.get(p.placement_status, p.placement_status)

                table_data.append([
                    "☐",
                    f"{p.display_title or 'Untitled'}\n{p.display_artist or ''}",
                    f"X: {float(p.position_x)}cm\nY: {float(p.position_y)}cm",
                    f"{float(p.width_cm)} × {float(p.height_cm)}cm",
                    status_display,
                    p.notes or "",
                ])

            table = Table(table_data, colWidths=[1 * cm, 5 * cm, 3 * cm, 3 * cm, 2.5 * cm, 3 * cm])
            table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.Color(0.9, 0.9, 0.9)),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.black),
                ("ALIGN", (0, 0), (-1, -1), "LEFT"),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, 0), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]))
            elements.append(table)
            elements.append(Spacer(1, 15))

    # Sign-off section
    elements.append(Spacer(1, 30))
    elements.append(Paragraph("<b>Installation Sign-off</b>", styles["Heading2"]))
    signoff_data = [
        ["Installed by:", "_" * 30, "Date:", "_" * 15],
        ["Verified by:", "_" * 30, "Date:", "_" * 15],
    ]
    signoff_table = Table(signoff_data, colWidths=[3 * cm, 7 * cm, 2 * cm, 4 * cm])
    signoff_table.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 15),
    ]))
    elements.append(signoff_table)

    doc.build(elements)
    buffer.seek(0)

    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=checklist_{exhibition_id}.pdf"},
    )


# =============================================================================
# Route 29: Export installation spec PDF
# =============================================================================


@router.post("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/exports/installation-spec", summary="Export installation spec")
def export_installation_spec(
    org_id: UUID,
    exhibition_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_VIEW)),
    db: Session = Depends(get_db),
):
    """Generate installation specification PDF."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer

    exhibition = (
        db.query(Exhibition)
        .options(joinedload(Exhibition.placements).joinedload(Placement.floor_plan))
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

    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, topMargin=2 * cm, bottomMargin=2 * cm)
    styles = getSampleStyleSheet()
    elements = []

    title_style = ParagraphStyle("Title", parent=styles["Heading1"], fontSize=18, spaceAfter=20)
    elements.append(Paragraph(f"Installation Specifications: {exhibition.title}", title_style))
    elements.append(Paragraph(
        "<i>Planning document - verify all measurements before installation</i>",
        styles["Italic"],
    ))
    elements.append(Spacer(1, 20))

    # Group by room
    placements_by_room: dict = {}
    for p in exhibition.placements:
        room_name = p.floor_plan.name if p.floor_plan else "Unassigned"
        if room_name not in placements_by_room:
            placements_by_room[room_name] = []
        placements_by_room[room_name].append(p)

    for room_name, room_placements in placements_by_room.items():
        elements.append(Paragraph(f"<b>{room_name}</b>", styles["Heading2"]))
        elements.append(Spacer(1, 10))

        for p in sorted(room_placements, key=lambda x: (x.wall_id, float(x.position_x))):
            elements.append(Paragraph(
                f"<b>{p.display_title or 'Untitled'}</b> - {p.display_artist or 'Unknown'}",
                styles["Heading3"],
            ))

            spec_data = [
                ["Wall:", p.wall_id.title(), "Mount Type:", p.mount_type.title()],
                ["Position X:", f"{float(p.position_x)} cm from left", "Position Y:", f"{float(p.position_y)} cm from floor"],
                ["Artwork Size:", f"{float(p.width_cm)} × {float(p.height_cm)} cm", "Frame Width:", f"{float(p.frame_width_cm)} cm"],
                ["Total Size:", f"{float(p.width_cm) + float(p.frame_width_cm) * 2} × {float(p.height_cm) + float(p.frame_width_cm) * 2} cm", "Status:", p.placement_status.title()],
            ]

            if p.notes:
                spec_data.append(["Notes:", p.notes, "", ""])

            spec_table = Table(spec_data, colWidths=[3 * cm, 5 * cm, 3 * cm, 5 * cm])
            spec_table.setStyle(TableStyle([
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                ("FONTNAME", (2, 0), (2, -1), "Helvetica-Bold"),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BACKGROUND", (0, 0), (-1, -1), colors.Color(0.97, 0.97, 0.97)),
            ]))
            elements.append(spec_table)
            elements.append(Spacer(1, 15))

    doc.build(elements)
    buffer.seek(0)

    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=install_spec_{exhibition_id}.pdf"},
    )


# =============================================================================
# Route 30: Export elevation PDF
# =============================================================================


@router.post("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/exports/elevation-pdf", summary="Export elevation pdf")
async def export_elevation_pdf(
    org_id: UUID,
    exhibition_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_VIEW)),
    db: Session = Depends(get_db),
):
    """Generate wall elevation drawing PDF."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import cm
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
    from reportlab.graphics.shapes import Drawing, Rect, String, Line

    exhibition = (
        db.query(Exhibition)
        .options(
            joinedload(Exhibition.placements).joinedload(Placement.floor_plan),
            joinedload(Exhibition.venue),
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

    try:
        data = await request.json()
    except Exception:
        data = {}
    floor_plan_id_filter = data.get("floor_plan_id")
    wall_id_filter = data.get("wall_id")
    scale = data.get("scale", 50)
    include_dimensions = data.get("include_dimensions", True)

    # Filter placements
    all_placements = exhibition.placements
    if floor_plan_id_filter:
        all_placements = [p for p in all_placements if str(p.floor_plan_id) == floor_plan_id_filter]
    if wall_id_filter:
        all_placements = [p for p in all_placements if p.wall_id == wall_id_filter]

    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=landscape(A4), topMargin=1 * cm, bottomMargin=1 * cm)
    styles = getSampleStyleSheet()
    elements = []

    elements.append(Paragraph(f"Elevation Drawing: {exhibition.title}", styles["Heading1"]))
    elements.append(Paragraph(f"Scale 1:{scale} - Planning Document", styles["Italic"]))
    elements.append(Spacer(1, 20))

    # Group by wall
    walls: dict = {}
    for p in all_placements:
        if p.wall_id not in walls:
            walls[p.wall_id] = []
        walls[p.wall_id].append(p)

    drawing_width = 25 * cm
    drawing_height = 10 * cm
    wall_height_cm = 300
    if exhibition.venue:
        wall_height_cm = exhibition.venue.default_ceiling_height_cm

    for wall_id, wall_placements in walls.items():
        elements.append(Paragraph(f"<b>{wall_id.title()} Wall</b>", styles["Heading2"]))

        max_x = max(
            float(p.position_x) + float(p.width_cm) / 2 + float(p.frame_width_cm)
            for p in wall_placements
        ) if wall_placements else 800
        wall_width_cm = max(max_x + 100, 800)

        scale_x = drawing_width / wall_width_cm
        scale_y = drawing_height / wall_height_cm
        scale_factor = min(scale_x, scale_y) * 0.9

        d = Drawing(drawing_width, drawing_height + 2 * cm)

        # Wall outline
        d.add(Rect(
            0, 0, wall_width_cm * scale_factor, wall_height_cm * scale_factor,
            strokeColor=colors.black, fillColor=colors.Color(0.98, 0.98, 0.98), strokeWidth=1,
        ))

        # Floor line
        d.add(Line(0, 0, wall_width_cm * scale_factor, 0, strokeColor=colors.black, strokeWidth=2))

        # Add artworks
        for p in wall_placements:
            x = float(p.position_x) - float(p.width_cm) / 2 - float(p.frame_width_cm)
            y = float(p.position_y) - float(p.height_cm) / 2 - float(p.frame_width_cm)
            w = float(p.width_cm) + float(p.frame_width_cm) * 2
            h = float(p.height_cm) + float(p.frame_width_cm) * 2

            fill_color = colors.white
            stroke_dash = None
            if p.placement_status == "draft":
                fill_color = colors.Color(0.95, 0.95, 0.95)
                stroke_dash = [2, 2]
            elif p.placement_status == "proposed":
                fill_color = colors.Color(0.9, 0.95, 1.0)

            d.add(Rect(
                x * scale_factor, y * scale_factor,
                w * scale_factor, h * scale_factor,
                strokeColor=colors.black, fillColor=fill_color, strokeWidth=0.5,
                strokeDashArray=stroke_dash,
            ))

            if float(p.frame_width_cm) > 0:
                d.add(Rect(
                    (x + float(p.frame_width_cm)) * scale_factor,
                    (y + float(p.frame_width_cm)) * scale_factor,
                    float(p.width_cm) * scale_factor,
                    float(p.height_cm) * scale_factor,
                    strokeColor=colors.grey, fillColor=colors.Color(0.85, 0.85, 0.85), strokeWidth=0.25,
                ))

            label = (p.display_title or "Untitled")[:20]
            d.add(String(
                (x + w / 2) * scale_factor,
                (y - 15) * scale_factor if y > 30 else (y + h + 5) * scale_factor,
                label, fontSize=6, textAnchor="middle",
            ))

            if include_dimensions:
                d.add(String(
                    (x - 10) * scale_factor, (float(p.position_y)) * scale_factor,
                    f"{float(p.position_y)}cm", fontSize=5, textAnchor="end",
                ))

        d.add(String(5, drawing_height + 0.5 * cm, f"Scale 1:{scale}", fontSize=8))

        elements.append(d)
        elements.append(Spacer(1, 20))

    doc.build(elements)
    buffer.seek(0)

    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=elevation_{exhibition_id}.pdf"},
    )
