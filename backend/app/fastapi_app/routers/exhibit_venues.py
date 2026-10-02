"""Exhibit Venues, Floor Plans, Frame Styles, Mount Configs — 20 routes migrated from Flask.

Sources:
- app/api/exhibit.py (exhibit_bp)
"""

import logging
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import and_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.models import (
    ExhibitionFloorPlan,
    FloorPlan,
    FrameStyle,
    MountConfig,
    Venue,
)
from app.permissions import Permission
from app.fastapi_app.schemas.exhibit_venues import (
    FloorPlanBackgroundRemovedResponse,
    FloorPlanBackgroundResponse,
    FloorPlanCreatedResponse,
    FloorPlanDeleteResponse,
    FloorPlanDetailResponse,
    FloorPlanUpdateResponse,
    FrameStyleCreatedResponse,
    FrameStyleDeleteResponse,
    FrameStyleListResponse,
    FrameStyleUpdateResponse,
    GeometryValidationResponse,
    MountConfigCreatedResponse,
    MountConfigDeleteResponse,
    MountConfigListResponse,
    MountConfigUpdateResponse,
    VenueCreatedResponse,
    VenueDeleteResponse,
    VenueDetailOut,
    VenueListResponse,
    VenueUpdateResponse,
)
from app.services.public_cache import invalidate_org_cache_by_id

logger = logging.getLogger(__name__)

router = APIRouter(tags=["exhibit_venues"])

PREFIX = "/api/organizations/{org_id}/exhibit"


# ============================================================================
# VENUES
# ============================================================================


@router.get(PREFIX + "/venues", response_model=VenueListResponse, summary="List venues")
def list_venues(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.VENUES_VIEW)),
    db: Session = Depends(get_db),
):
    """List all venues for the organization."""
    venues = (
        db.query(Venue)
        .filter(Venue.organization_id == org_id)
        .order_by(Venue.name)
        .all()
    )

    return {
        "venues": [
            {
                "venue_id": str(v.venue_id),
                "name": v.name,
                "description": v.description,
                "address": v.address,
                "default_ceiling_height_cm": v.default_ceiling_height_cm,
                "default_wall_color": v.default_wall_color,
                "floor_plan_count": len(v.floor_plans),
                "created_at": v.created_at.isoformat() if v.created_at else None,
            }
            for v in venues
        ]
    }


@router.post(PREFIX + "/venues", status_code=201, response_model=VenueCreatedResponse, summary="Create venue")
async def create_venue(
    org_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.VENUES_EDIT)),
    db: Session = Depends(get_db),
):
    """Create a new venue."""
    data = await request.json()
    if not data or "name" not in data:
        raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "name is required"})

    try:
        venue = Venue(
            organization_id=org_id,
            name=data["name"],
            description=data.get("description"),
            address=data.get("address"),
            default_ceiling_height_cm=data.get("default_ceiling_height_cm", 300),
            default_wall_color=data.get("default_wall_color", "#FFFFFF"),
            created_by=auth.user_id,
        )

        db.add(venue)
        db.commit()
        invalidate_org_cache_by_id(org_id, section="venue")

        logger.info(f"Created venue {venue.venue_id} for org {org_id}")

        return {
            "venue_id": str(venue.venue_id),
            "name": venue.name,
            "message": "Venue created successfully",
        }

    except IntegrityError as e:
        db.rollback()
        if "unique" in str(e).lower():
            raise HTTPException(status_code=409, detail={"code": "duplicate", "message": "A venue with this name already exists"})
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Database constraint violation"})


@router.get(PREFIX + "/venues/{venue_id}", response_model=VenueDetailOut, summary="Get venue")
def get_venue(
    org_id: UUID,
    venue_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.VENUES_VIEW)),
    db: Session = Depends(get_db),
):
    """Get venue details with floor plans."""
    venue = (
        db.query(Venue)
        .options(joinedload(Venue.floor_plans))
        .filter(and_(Venue.venue_id == venue_id, Venue.organization_id == org_id))
        .first()
    )

    if not venue:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Venue not found"})

    return {
        "venue_id": str(venue.venue_id),
        "name": venue.name,
        "description": venue.description,
        "address": venue.address,
        "default_ceiling_height_cm": venue.default_ceiling_height_cm,
        "default_wall_color": venue.default_wall_color,
        "created_at": venue.created_at.isoformat() if venue.created_at else None,
        "floor_plans": [
            {
                "floor_plan_id": str(fp.floor_plan_id),
                "name": fp.name,
                "floor_number": fp.floor_number,
                "geometry": fp.geometry,
                "ceiling_height_cm": fp.ceiling_height_cm or venue.default_ceiling_height_cm,
                "wall_color": fp.wall_color or venue.default_wall_color,
                "model_url": fp.model_url,
                "model_scale": float(fp.model_scale) if fp.model_scale else 1.0,
            }
            for fp in sorted(venue.floor_plans, key=lambda x: (x.floor_number, x.name))
        ],
    }


@router.patch(PREFIX + "/venues/{venue_id}", response_model=VenueUpdateResponse, summary="Update venue")
async def update_venue(
    org_id: UUID,
    venue_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.VENUES_EDIT)),
    db: Session = Depends(get_db),
):
    """Update venue details."""
    venue = (
        db.query(Venue)
        .filter(and_(Venue.venue_id == venue_id, Venue.organization_id == org_id))
        .first()
    )

    if not venue:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Venue not found"})

    data = await request.json()
    if not data:
        raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "No data provided"})

    if "name" in data:
        venue.name = data["name"]
    if "description" in data:
        venue.description = data["description"]
    if "address" in data:
        venue.address = data["address"]
    if "default_ceiling_height_cm" in data:
        venue.default_ceiling_height_cm = data["default_ceiling_height_cm"]
    if "default_wall_color" in data:
        venue.default_wall_color = data["default_wall_color"]

    try:
        db.commit()
        invalidate_org_cache_by_id(org_id, section="venue")

        return {"status": "success", "message": "Venue updated successfully", "venue_id": str(venue.venue_id)}

    except IntegrityError as e:
        db.rollback()
        if "unique" in str(e).lower():
            raise HTTPException(status_code=409, detail={"code": "duplicate", "message": "A venue with this name already exists"})
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Database constraint violation"})


@router.delete(PREFIX + "/venues/{venue_id}", response_model=VenueDeleteResponse, summary="Delete venue")
def delete_venue(
    org_id: UUID,
    venue_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.VENUES_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete a venue and all its floor plans."""
    venue = (
        db.query(Venue)
        .filter(and_(Venue.venue_id == venue_id, Venue.organization_id == org_id))
        .first()
    )

    if not venue:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Venue not found"})

    try:
        db.delete(venue)
        db.commit()
        invalidate_org_cache_by_id(org_id, section="venue")

        logger.info(f"Deleted venue {venue_id}")

        return {"status": "success", "message": "Venue deleted successfully"}

    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Cannot delete venue: it is still in use"})


# ============================================================================
# FLOOR PLANS
# ============================================================================


@router.post(PREFIX + "/venues/{venue_id}/floor-plans", status_code=201, response_model=FloorPlanCreatedResponse, summary="Create floor plan")
async def create_floor_plan(
    org_id: UUID,
    venue_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.VENUES_EDIT)),
    db: Session = Depends(get_db),
):
    """Create a new floor plan in a venue."""
    # Verify venue exists and belongs to org
    venue = (
        db.query(Venue)
        .filter(and_(Venue.venue_id == venue_id, Venue.organization_id == org_id))
        .first()
    )

    if not venue:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Venue not found"})

    data = await request.json()
    if not data or "name" not in data:
        raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "name is required"})

    try:
        floor_plan = FloorPlan(
            venue_id=venue_id,
            name=data["name"],
            floor_number=data.get("floor_number", 0),
            geometry=data.get("geometry"),
            ceiling_height_cm=data.get("ceiling_height_cm"),
            wall_color=data.get("wall_color"),
            floor_texture=data.get("floor_texture"),
            model_url=data.get("model_url"),
            model_scale=data.get("model_scale", 1.0),
        )

        db.add(floor_plan)
        db.commit()

        logger.info(f"Created floor plan {floor_plan.floor_plan_id} in venue {venue_id}")

        return {
            "floor_plan_id": str(floor_plan.floor_plan_id),
            "name": floor_plan.name,
            "message": "Floor plan created successfully",
        }

    except IntegrityError as e:
        db.rollback()
        if "unique" in str(e).lower():
            raise HTTPException(status_code=409, detail={"code": "duplicate", "message": "A floor plan with this name already exists in this venue"})
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Database constraint violation"})


@router.get(PREFIX + "/floor-plans/{floor_plan_id}", response_model=FloorPlanDetailResponse, summary="Get floor plan")
def get_floor_plan(
    org_id: UUID,
    floor_plan_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.VENUES_VIEW)),
    db: Session = Depends(get_db),
):
    """Get floor plan details."""
    floor_plan = (
        db.query(FloorPlan)
        .options(joinedload(FloorPlan.venue))
        .filter(FloorPlan.floor_plan_id == floor_plan_id)
        .first()
    )

    if not floor_plan or floor_plan.venue.organization_id != org_id:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Floor plan not found"})

    # Check if this floor plan is associated with any exhibition
    exhibition_assoc = (
        db.query(ExhibitionFloorPlan)
        .filter(ExhibitionFloorPlan.floor_plan_id == floor_plan_id)
        .first()
    )

    return {
        "floor_plan": {
            "floor_plan_id": str(floor_plan.floor_plan_id),
            "venue_id": str(floor_plan.venue_id),
            "venue_name": floor_plan.venue.name,
            "exhibition_id": str(exhibition_assoc.exhibition_id) if exhibition_assoc else None,
            "name": floor_plan.name,
            "floor_number": floor_plan.floor_number,
            "geometry": floor_plan.geometry,
            "ceiling_height_cm": floor_plan.effective_ceiling_height,
            "wall_color": floor_plan.effective_wall_color,
            "floor_texture": floor_plan.floor_texture,
            "model_url": floor_plan.model_url,
            "model_scale": float(floor_plan.model_scale) if floor_plan.model_scale else 1.0,
            "appearance_settings": floor_plan.appearance_settings,
        }
    }


@router.patch(PREFIX + "/floor-plans/{floor_plan_id}", response_model=FloorPlanUpdateResponse, summary="Update floor plan")
async def update_floor_plan(
    org_id: UUID,
    floor_plan_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.VENUES_EDIT)),
    db: Session = Depends(get_db),
):
    """Update floor plan details."""
    floor_plan = (
        db.query(FloorPlan)
        .options(joinedload(FloorPlan.venue))
        .filter(FloorPlan.floor_plan_id == floor_plan_id)
        .first()
    )

    if not floor_plan or floor_plan.venue.organization_id != org_id:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Floor plan not found"})

    data = await request.json()
    if not data:
        raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "No data provided"})

    if "name" in data:
        floor_plan.name = data["name"]
    if "floor_number" in data:
        floor_plan.floor_number = data["floor_number"]
    if "geometry" in data:
        floor_plan.geometry = data["geometry"]
    if "ceiling_height_cm" in data:
        floor_plan.ceiling_height_cm = data["ceiling_height_cm"]
    if "wall_color" in data:
        floor_plan.wall_color = data["wall_color"]
    if "floor_texture" in data:
        floor_plan.floor_texture = data["floor_texture"]
    if "model_url" in data:
        floor_plan.model_url = data["model_url"]
    if "model_scale" in data:
        floor_plan.model_scale = data["model_scale"]
    if "appearance_settings" in data:
        floor_plan.appearance_settings = data["appearance_settings"]

    try:
        db.commit()

        return {"status": "success", "message": "Floor plan updated successfully", "floor_plan_id": str(floor_plan.floor_plan_id)}

    except IntegrityError as e:
        db.rollback()
        if "unique" in str(e).lower():
            raise HTTPException(status_code=409, detail={"code": "duplicate", "message": "A floor plan with this name already exists in this venue"})
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Database constraint violation"})


@router.delete(PREFIX + "/floor-plans/{floor_plan_id}", response_model=FloorPlanDeleteResponse, summary="Delete floor plan")
def delete_floor_plan(
    org_id: UUID,
    floor_plan_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.VENUES_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete a floor plan."""
    floor_plan = (
        db.query(FloorPlan)
        .options(joinedload(FloorPlan.venue))
        .filter(FloorPlan.floor_plan_id == floor_plan_id)
        .first()
    )

    if not floor_plan or floor_plan.venue.organization_id != org_id:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Floor plan not found"})

    try:
        db.delete(floor_plan)
        db.commit()

        logger.info(f"Deleted floor plan {floor_plan_id}")

        return {"status": "success", "message": "Floor plan deleted successfully"}

    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Cannot delete floor plan: it is still in use by an exhibition"})


@router.post(PREFIX + "/floor-plans/{floor_plan_id}/background", response_model=FloorPlanBackgroundResponse, summary="Set floor plan background")
async def set_floor_plan_background(
    org_id: UUID,
    floor_plan_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.VENUES_EDIT)),
    db: Session = Depends(get_db),
):
    """Set background image for floor plan tracing.

    Accepts JSON body with url, scale_factor, offset_x, offset_y, opacity.
    """
    floor_plan = (
        db.query(FloorPlan)
        .options(joinedload(FloorPlan.venue))
        .filter(FloorPlan.floor_plan_id == floor_plan_id)
        .first()
    )

    if not floor_plan or floor_plan.venue.organization_id != org_id:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Floor plan not found"})

    data = await request.json()
    if not data or "url" not in data:
        raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "url is required"})

    # Update geometry with background image
    geometry = floor_plan.geometry or {}
    geometry["background_image"] = {
        "url": data["url"],
        "scale_factor": data.get("scale_factor", 1.0),
        "offset_x": data.get("offset_x", 0),
        "offset_y": data.get("offset_y", 0),
        "opacity": data.get("opacity", 0.5),
    }
    floor_plan.geometry = geometry

    try:
        db.commit()

        logger.info(f"Set background image for floor plan {floor_plan_id}")

        return {
            "floor_plan_id": str(floor_plan.floor_plan_id),
            "background_image": geometry["background_image"],
            "message": "Background image set successfully",
        }

    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Database constraint violation"})


@router.delete(PREFIX + "/floor-plans/{floor_plan_id}/background", response_model=FloorPlanBackgroundRemovedResponse, summary="Remove floor plan background")
def remove_floor_plan_background(
    org_id: UUID,
    floor_plan_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.VENUES_EDIT)),
    db: Session = Depends(get_db),
):
    """Remove background image from floor plan."""
    floor_plan = (
        db.query(FloorPlan)
        .options(joinedload(FloorPlan.venue))
        .filter(FloorPlan.floor_plan_id == floor_plan_id)
        .first()
    )

    if not floor_plan or floor_plan.venue.organization_id != org_id:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Floor plan not found"})

    try:
        # Remove background image from geometry
        geometry = floor_plan.geometry or {}
        if "background_image" in geometry:
            del geometry["background_image"]
            floor_plan.geometry = geometry
            db.commit()

        logger.info(f"Removed background image from floor plan {floor_plan_id}")

        return {"status": "success", "message": "Background image removed successfully", "floor_plan_id": str(floor_plan.floor_plan_id)}

    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Database constraint violation"})


@router.post(PREFIX + "/floor-plans/validate-geometry", response_model=GeometryValidationResponse, summary="Validate floor plan geometry")
async def validate_floor_plan_geometry(
    org_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.VENUES_VIEW)),
    db: Session = Depends(get_db),
):
    """Validate floor plan geometry.

    Checks:
    - Required fields present (type, vertices, walls for polygon; width_cm, depth_cm for rectangular)
    - Valid vertex references in walls
    - No overlapping walls
    - Polygon is closed (each vertex has exactly 2 connected walls for closed shapes)
    - Reasonable dimensions (not too small or too large)
    """
    data = await request.json()
    if not data or "geometry" not in data:
        raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "geometry is required"})

    geometry = data["geometry"]
    errors: list[str] = []
    warnings: list[str] = []

    geo_type = geometry.get("type")

    if geo_type == "rectangular":
        # Validate rectangular geometry
        if "width_cm" not in geometry:
            errors.append("width_cm is required for rectangular geometry")
        elif geometry["width_cm"] <= 0:
            errors.append("width_cm must be positive")
        elif geometry["width_cm"] < 100:
            warnings.append("Room width is less than 1 meter")
        elif geometry["width_cm"] > 10000:
            warnings.append("Room width is greater than 100 meters")

        if "depth_cm" not in geometry:
            errors.append("depth_cm is required for rectangular geometry")
        elif geometry["depth_cm"] <= 0:
            errors.append("depth_cm must be positive")
        elif geometry["depth_cm"] < 100:
            warnings.append("Room depth is less than 1 meter")
        elif geometry["depth_cm"] > 10000:
            warnings.append("Room depth is greater than 100 meters")

    elif geo_type == "polygon":
        # Validate polygon geometry
        vertices = geometry.get("vertices", [])
        walls = geometry.get("walls", [])

        if len(vertices) < 3:
            errors.append("Polygon must have at least 3 vertices")

        if len(walls) < 3:
            errors.append("Polygon must have at least 3 walls")

        # Check vertex IDs are unique
        vertex_ids = [v.get("id") for v in vertices]
        if len(vertex_ids) != len(set(vertex_ids)):
            errors.append("Vertex IDs must be unique")

        # Check all wall references are valid
        for wall in walls:
            start_vertex = wall.get("start_vertex")
            end_vertex = wall.get("end_vertex")
            if start_vertex not in vertex_ids:
                errors.append(f"Wall {wall.get('id')} references invalid start_vertex {start_vertex!r}")
            if end_vertex not in vertex_ids:
                errors.append(f"Wall {wall.get('id')} references invalid end_vertex {end_vertex!r}")
            if wall.get("start_vertex") == wall.get("end_vertex"):
                errors.append(f"Wall {wall.get('id')} has same start and end vertex")

        # Check for vertex coordinate validity
        for vertex in vertices:
            x, y = vertex.get("x"), vertex.get("y")
            if x is None or y is None:
                errors.append(f"Vertex {vertex.get('id')} missing x or y coordinate")
            elif abs(x) > 100000 or abs(y) > 100000:
                warnings.append(f"Vertex {vertex.get('id')} has very large coordinates")

        # Check columns if present
        columns = geometry.get("columns", [])
        for column in columns:
            if "x" not in column or "y" not in column:
                errors.append(f"Column {column.get('id')} missing x or y coordinate")
            if "radius_cm" not in column or column.get("radius_cm", 0) <= 0:
                errors.append(f"Column {column.get('id')} has invalid radius")

        # Validate openings in walls
        for wall in walls:
            for opening in wall.get("openings", []):
                if opening.get("width_cm", 0) <= 0:
                    errors.append(f"Opening in wall {wall.get('id')} has invalid width")
                if opening.get("height_cm", 0) <= 0:
                    errors.append(f"Opening in wall {wall.get('id')} has invalid height")
                if opening.get("offset_cm", 0) < 0:
                    errors.append(f"Opening in wall {wall.get('id')} has negative offset")

    else:
        errors.append(f"Unknown geometry type: {geo_type}. Must be 'rectangular' or 'polygon'")

    is_valid = len(errors) == 0

    if not is_valid:
        raise HTTPException(status_code=400, detail={
            "valid": False,
            "errors": errors,
            "warnings": warnings,
        })

    return {
        "valid": True,
        "errors": errors,
        "warnings": warnings,
    }


# ============================================================================
# FRAME STYLES
# ============================================================================


@router.get(PREFIX + "/frame-styles", response_model=FrameStyleListResponse, summary="List frame styles")
def list_frame_styles(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_VIEW)),
    db: Session = Depends(get_db),
):
    """List all frame styles (system defaults + organization custom)."""
    styles = (
        db.query(FrameStyle)
        .filter(
            (FrameStyle.organization_id == org_id) | (FrameStyle.is_system == True)  # noqa: E712
        )
        .order_by(FrameStyle.is_system.desc(), FrameStyle.name)
        .all()
    )

    return {
        "frame_styles": [
            {
                "frame_style_id": str(s.frame_style_id),
                "name": s.name,
                "description": s.description,
                "profile_type": s.profile_type,
                "default_width_cm": float(s.default_width_cm),
                "default_depth_cm": float(s.default_depth_cm),
                "material": s.material,
                "color_hex": s.color_hex,
                "preview_image_url": s.preview_image_url,
                "is_system": s.is_system,
            }
            for s in styles
        ]
    }


@router.post(PREFIX + "/frame-styles", status_code=201, response_model=FrameStyleCreatedResponse, summary="Create frame style")
async def create_frame_style(
    org_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Create a custom frame style."""
    data = await request.json()
    if not data or "name" not in data or "profile_type" not in data:
        raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "name and profile_type are required"})

    valid_profiles = ["flat", "stepped", "ornate", "float", "shadowbox"]
    if data["profile_type"] not in valid_profiles:
        raise HTTPException(status_code=400, detail={"code": "validation_error", "message": f"profile_type must be one of: {valid_profiles}"})

    try:
        style = FrameStyle(
            organization_id=org_id,
            name=data["name"],
            description=data.get("description"),
            profile_type=data["profile_type"],
            default_width_cm=Decimal(str(data.get("default_width_cm", 3.0))),
            default_depth_cm=Decimal(str(data.get("default_depth_cm", 2.0))),
            material=data.get("material"),
            color_hex=data.get("color_hex", "#2C2C2C"),
            preview_image_url=data.get("preview_image_url"),
            is_system=False,
            created_by=auth.user_id,
        )

        db.add(style)
        db.commit()

        logger.info(f"Created frame style {style.frame_style_id} for org {org_id}")

        return {
            "frame_style_id": str(style.frame_style_id),
            "name": style.name,
            "message": "Frame style created successfully",
        }

    except IntegrityError as e:
        db.rollback()
        if "unique" in str(e).lower():
            raise HTTPException(status_code=409, detail={"code": "duplicate", "message": "A frame style with this name already exists"})
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Database constraint violation"})


@router.patch(PREFIX + "/frame-styles/{style_id}", response_model=FrameStyleUpdateResponse, summary="Update frame style")
async def update_frame_style(
    org_id: UUID,
    style_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Update a custom frame style (cannot update system styles)."""
    style = (
        db.query(FrameStyle)
        .filter(
            and_(
                FrameStyle.frame_style_id == style_id,
                FrameStyle.organization_id == org_id,
                FrameStyle.is_system == False,  # noqa: E712
            )
        )
        .first()
    )

    if not style:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Frame style not found"})

    data = await request.json()
    if not data:
        raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "No data provided"})

    if "name" in data:
        style.name = data["name"]
    if "description" in data:
        style.description = data["description"]
    if "profile_type" in data:
        valid_profiles = ["flat", "stepped", "ornate", "float", "shadowbox"]
        if data["profile_type"] not in valid_profiles:
            raise HTTPException(status_code=400, detail={"code": "validation_error", "message": f"profile_type must be one of: {valid_profiles}"})
        style.profile_type = data["profile_type"]
    if "default_width_cm" in data:
        style.default_width_cm = Decimal(str(data["default_width_cm"]))
    if "default_depth_cm" in data:
        style.default_depth_cm = Decimal(str(data["default_depth_cm"]))
    if "material" in data:
        style.material = data["material"]
    if "color_hex" in data:
        style.color_hex = data["color_hex"]
    if "preview_image_url" in data:
        style.preview_image_url = data["preview_image_url"]

    try:
        db.commit()

        return {"status": "success", "message": "Frame style updated successfully", "frame_style_id": str(style.frame_style_id)}

    except IntegrityError as e:
        db.rollback()
        if "unique" in str(e).lower():
            raise HTTPException(status_code=409, detail={"code": "duplicate", "message": "A frame style with this name already exists"})
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Database constraint violation"})


@router.delete(PREFIX + "/frame-styles/{style_id}", response_model=FrameStyleDeleteResponse, summary="Delete frame style")
def delete_frame_style(
    org_id: UUID,
    style_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete a custom frame style (cannot delete system styles)."""
    style = (
        db.query(FrameStyle)
        .filter(
            and_(
                FrameStyle.frame_style_id == style_id,
                FrameStyle.organization_id == org_id,
                FrameStyle.is_system == False,  # noqa: E712
            )
        )
        .first()
    )

    if not style:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Frame style not found"})

    try:
        db.delete(style)
        db.commit()

        logger.info(f"Deleted frame style {style_id}")

        return {"status": "success", "message": "Frame style deleted successfully"}

    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Cannot delete frame style: it is still in use"})


# ============================================================================
# MOUNT CONFIGS
# ============================================================================


@router.get(PREFIX + "/mount-configs", response_model=MountConfigListResponse, summary="List mount configs")
def list_mount_configs(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_VIEW)),
    db: Session = Depends(get_db),
):
    """List all mount configurations (system defaults + organization custom)."""
    configs = (
        db.query(MountConfig)
        .filter(
            (MountConfig.organization_id == org_id) | (MountConfig.is_system == True)  # noqa: E712
        )
        .order_by(MountConfig.mount_type, MountConfig.is_system.desc(), MountConfig.name)
        .all()
    )

    return {
        "mount_configs": [
            {
                "mount_config_id": str(c.mount_config_id),
                "name": c.name,
                "mount_type": c.mount_type,
                "config": c.config,
                "preview_image_url": c.preview_image_url,
                "is_system": c.is_system,
            }
            for c in configs
        ]
    }


@router.post(PREFIX + "/mount-configs", status_code=201, response_model=MountConfigCreatedResponse, summary="Create mount config")
async def create_mount_config(
    org_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Create a custom mount configuration."""
    data = await request.json()
    if not data or "name" not in data or "mount_type" not in data or "config" not in data:
        raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "name, mount_type, and config are required"})

    valid_types = ["wall", "plinth", "hanging", "vitrine"]
    if data["mount_type"] not in valid_types:
        raise HTTPException(status_code=400, detail={"code": "validation_error", "message": f"mount_type must be one of: {valid_types}"})

    try:
        mount_config = MountConfig(
            organization_id=org_id,
            name=data["name"],
            mount_type=data["mount_type"],
            config=data["config"],
            preview_image_url=data.get("preview_image_url"),
            is_system=False,
            created_by=auth.user_id,
        )

        db.add(mount_config)
        db.commit()

        logger.info(f"Created mount config {mount_config.mount_config_id} for org {org_id}")

        return {
            "mount_config_id": str(mount_config.mount_config_id),
            "name": mount_config.name,
            "message": "Mount configuration created successfully",
        }

    except IntegrityError as e:
        db.rollback()
        if "unique" in str(e).lower():
            raise HTTPException(status_code=409, detail={"code": "duplicate", "message": "A mount configuration with this name already exists"})
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Database constraint violation"})


@router.patch(PREFIX + "/mount-configs/{config_id}", response_model=MountConfigUpdateResponse, summary="Update mount config")
async def update_mount_config(
    org_id: UUID,
    config_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Update a custom mount configuration (cannot update system configs)."""
    mount_config = (
        db.query(MountConfig)
        .filter(
            and_(
                MountConfig.mount_config_id == config_id,
                MountConfig.organization_id == org_id,
                MountConfig.is_system == False,  # noqa: E712
            )
        )
        .first()
    )

    if not mount_config:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Mount config not found"})

    data = await request.json()
    if not data:
        raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "No data provided"})

    if "name" in data:
        mount_config.name = data["name"]
    if "mount_type" in data:
        valid_types = ["wall", "plinth", "hanging", "vitrine"]
        if data["mount_type"] not in valid_types:
            raise HTTPException(status_code=400, detail={"code": "validation_error", "message": f"mount_type must be one of: {valid_types}"})
        mount_config.mount_type = data["mount_type"]
    if "config" in data:
        mount_config.config = data["config"]
    if "preview_image_url" in data:
        mount_config.preview_image_url = data["preview_image_url"]

    try:
        db.commit()

        return {"status": "success", "message": "Mount configuration updated successfully", "mount_config_id": str(mount_config.mount_config_id)}

    except IntegrityError as e:
        db.rollback()
        if "unique" in str(e).lower():
            raise HTTPException(status_code=409, detail={"code": "duplicate", "message": "A mount configuration with this name already exists"})
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Database constraint violation"})


@router.delete(PREFIX + "/mount-configs/{config_id}", response_model=MountConfigDeleteResponse, summary="Delete mount config")
def delete_mount_config(
    org_id: UUID,
    config_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete a custom mount configuration (cannot delete system configs)."""
    mount_config = (
        db.query(MountConfig)
        .filter(
            and_(
                MountConfig.mount_config_id == config_id,
                MountConfig.organization_id == org_id,
                MountConfig.is_system == False,  # noqa: E712
            )
        )
        .first()
    )

    if not mount_config:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Mount config not found"})

    try:
        db.delete(mount_config)
        db.commit()

        logger.info(f"Deleted mount config {config_id}")

        return {"status": "success", "message": "Mount configuration deleted successfully"}

    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail={"code": "constraint_violation", "message": "Cannot delete mount config: it is still in use"})
