"""
Location and Movement endpoints (FastAPI).

Hierarchical location management and object movement tracking.
"""

import logging
from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_auth, require_permission
from app.models import (
    CollectionObject,
    Location,
    Movement,
    ObjectPart,
)
from app.permissions import Permission
from app.services.api_security import escape_ilike
from app.services.entity_notifications import notify_status_change
from app.services.field_access_service import apply_field_access, get_write_restricted_fields
from app.fastapi_app.schemas.common import MessageResponse
from app.fastapi_app.schemas.collections_locations import (
    LocationFullOut,
    LocationListResponse,
    MovementOut,
    MovementListResponse,
    ObjectMovementsResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["collections-locations"])


# ============================================================================
# SERIALIZERS
# ============================================================================


def _serialize_location(loc: Location, include_children: bool = False) -> dict:
    """Serialize a Location to JSON."""
    result = {
        "location_id": str(loc.location_id),
        "organization_id": str(loc.organization_id),
        "parent_id": str(loc.parent_id) if loc.parent_id else None,
        "path": loc.path,
        "depth": loc.depth,
        "name": loc.name,
        "code": loc.code,
        "barcode": loc.barcode,
        "location_type": loc.location_type,
        "is_external": loc.is_external,
        "capacity": loc.capacity,
        "current_count": loc.current_count,
        "climate_controlled": loc.climate_controlled,
        "default_fitness": loc.default_fitness,
        "condition": loc.condition,
        "security_level": loc.security_level,
        "status": loc.status,
        "on_display": loc.on_display,
        "created_at": loc.created_at.isoformat() if loc.created_at else None,
        "updated_at": loc.updated_at.isoformat() if loc.updated_at else None,
    }

    if include_children and hasattr(loc, 'children') and loc.children:
        result["children"] = [_serialize_location(c, include_children=True) for c in loc.children]

    return result


def _serialize_location_full(loc: Location) -> dict:
    """Serialize a Location with all fields."""
    return {
        "location_id": str(loc.location_id),
        "organization_id": str(loc.organization_id),
        "parent_id": str(loc.parent_id) if loc.parent_id else None,
        "path": loc.path,
        "depth": loc.depth,
        "name": loc.name,
        "code": loc.code,
        "barcode": loc.barcode,
        "alternate_names": loc.alternate_names,
        "location_type": loc.location_type,
        "is_external": loc.is_external,
        "address": loc.address,
        "contact_name": loc.contact_name,
        "contact_email": loc.contact_email,
        "contact_phone": loc.contact_phone,
        "coordinates": loc.coordinates,
        "grid_reference": loc.grid_reference,
        "floor_plan_coordinates": loc.floor_plan_coordinates,
        "capacity": loc.capacity,
        "current_count": loc.current_count,
        "capacity_note": loc.capacity_note,
        "climate_controlled": loc.climate_controlled,
        "temperature_min": float(loc.temperature_min) if loc.temperature_min else None,
        "temperature_max": float(loc.temperature_max) if loc.temperature_max else None,
        "humidity_min": float(loc.humidity_min) if loc.humidity_min else None,
        "humidity_max": float(loc.humidity_max) if loc.humidity_max else None,
        "light_level": loc.light_level,
        "light_level_lux": loc.light_level_lux,
        "uv_filtered": loc.uv_filtered,
        "environment_note": loc.environment_note,
        "default_fitness": loc.default_fitness,
        "condition": loc.condition,
        "condition_note": loc.condition_note,
        "condition_date": loc.condition_date.isoformat() if loc.condition_date else None,
        "pest_control_date": loc.pest_control_date.isoformat() if loc.pest_control_date else None,
        "security_level": loc.security_level,
        "security_note": loc.security_note,
        "access_restricted": loc.access_restricted,
        "access_requirements": loc.access_requirements,
        "access_note": loc.access_note,
        "accessibility": loc.accessibility,
        "description": loc.description,
        "note": loc.note,
        "status": loc.status,
        "on_display": loc.on_display,
        "established_date": loc.established_date.isoformat() if loc.established_date else None,
        "decommissioned_date": loc.decommissioned_date.isoformat() if loc.decommissioned_date else None,
        "created_at": loc.created_at.isoformat() if loc.created_at else None,
        "created_by": str(loc.created_by) if loc.created_by else None,
        "updated_at": loc.updated_at.isoformat() if loc.updated_at else None,
        "updated_by": str(loc.updated_by) if loc.updated_by else None,
    }


def _serialize_movement(mov: Movement) -> dict:
    """Serialize a Movement to JSON."""
    # Get object info for display
    object_number = None
    object_title = None
    if mov.object:
        object_number = mov.object.object_number
        # Get preferred title or first title
        if mov.object.title_links:
            preferred = next((t for t in mov.object.title_links if t.is_preferred), None)
            object_title = preferred.title if preferred else (mov.object.title_links[0].title if mov.object.title_links else None)
        if not object_title:
            object_title = mov.object.object_name

    # Get part info for multi-part objects
    part_id = None
    part_number = None
    part_name = None
    if mov.part:
        part_id = str(mov.part_id)
        part_number = mov.part.part_number
        part_name = mov.part.name

    return {
        "movement_id": str(mov.movement_id),
        "organization_id": str(mov.organization_id),
        "movement_reference_number": mov.movement_reference_number,
        "object_id": str(mov.object_id),
        "object_number": object_number,
        "object_title": object_title,
        "part_id": part_id,
        "part_number": part_number,
        "part_name": part_name,
        "from_location_id": str(mov.from_location_id) if mov.from_location_id else None,
        "from_location_name": mov.from_location.name if mov.from_location else None,
        "from_location_path": mov.from_location.path if mov.from_location else None,
        "to_location_id": str(mov.to_location_id),
        "to_location_name": mov.to_location.name if mov.to_location else None,
        "to_location_path": mov.to_location.path if mov.to_location else None,
        "location_fitness": mov.location_fitness,
        "movement_date": mov.movement_date.isoformat() if mov.movement_date else None,
        "planned_removal_date": mov.planned_removal_date.isoformat() if mov.planned_removal_date else None,
        "removal_date": mov.removal_date.isoformat() if mov.removal_date else None,
        "planned_return_date": mov.planned_return_date.isoformat() if mov.planned_return_date else None,
        "reason": mov.reason,
        "movement_note": mov.movement_note,
        "reference_type": mov.reference_type,
        "reference_id": str(mov.reference_id) if mov.reference_id else None,
        "authorized_by": str(mov.authorized_by) if mov.authorized_by else None,
        "authorizer_id": str(mov.authorizer_id) if mov.authorizer_id else None,
        "authorizer_name": mov.authorizer.name if mov.authorizer else None,
        "authorization_date": mov.authorization_date.isoformat() if mov.authorization_date else None,
        "authorization_note": mov.authorization_note,
        "movement_contact": mov.movement_contact,
        "movement_method": mov.movement_method,
        "moved_by": str(mov.moved_by) if mov.moved_by else None,
        "moved_by_name": mov.moved_by_name,
        "handler_id": str(mov.handler_id) if mov.handler_id else None,
        "handler_name": mov.handler_name or (mov.handler.name if mov.handler else None),
        "organization_courier": mov.organization_courier,
        "courier_name": mov.courier_name,
        "shipper_name": mov.shipper_name or (mov.shipper.name if mov.shipper else None),
        "shipper_id": str(mov.shipper_id) if mov.shipper_id else None,
        "shipping_method": mov.shipping_method,
        "shipping_tracking_number": mov.shipping_tracking_number,
        "shipping_insurance_value": str(mov.shipping_insurance_value) if mov.shipping_insurance_value else None,
        "shipping_insurance_currency": mov.shipping_insurance_currency,
        "shipping_note": mov.shipping_note,
        "condition_note": mov.condition_note,
        "condition_report_id": str(mov.condition_report_id) if mov.condition_report_id else None,
        "status": mov.status,
        "created_at": mov.created_at.isoformat() if mov.created_at else None,
        "created_by": str(mov.created_by) if mov.created_by else None,
    }


# ============================================================================
# LOCATION ROUTES
# ============================================================================


@router.post("/api/organizations/{organization_id}/collections/locations", status_code=201, response_model=LocationFullOut, summary="Create location")
def create_location(
    organization_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.LOCATIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Create a new location."""
    required_fields = ["name", "location_type"]
    missing_fields = [f for f in required_fields if f not in data]
    if missing_fields:
        raise HTTPException(status_code=400, detail={
            "code": "MISSING_FIELDS",
            "message": f"Missing: {', '.join(missing_fields)}",
        })

    # Validate an explicitly-named parent exists (404). Path/depth derivation,
    # code auto-generation, and the optional-field copy live in the shared
    # create function the draft applier also runs.
    parent_id = data.get("parent_id")
    if parent_id:
        parent = db.query(Location).filter(
            Location.location_id == UUID(parent_id),
            Location.organization_id == organization_id,
        ).first()
        if not parent:
            raise HTTPException(status_code=404, detail={
                "code": "not_found",
                "message": "Parent location not found",
            })

    from app.services.collections.creation.location import (
        create_location as _create_location,
    )

    try:
        loc = _create_location(db, organization_id, data, auth.user_id, open_approval=True)
        db.commit()
        return _serialize_location_full(loc)

    except IntegrityError as e:
        db.rollback()
        if "ix_locations_org_code" in str(e).lower():
            raise HTTPException(status_code=409, detail={
                "code": "conflict",
                "message": f"Location code '{data.get('code')}' already exists",
            })
        raise HTTPException(status_code=400, detail={
            "code": "validation_error",
            "message": "Database constraint violation",
        })


@router.get("/api/organizations/{organization_id}/collections/locations", response_model=LocationListResponse, summary="List locations")
def list_locations(
    organization_id: UUID,
    parent_id: str | None = Query(None),
    location_type: str | None = Query(None),
    include_tree: str | None = Query(None),
    tree: str = Query("false"),
    limit: int = Query(100, le=500),
    offset: int = Query(0),
    auth: AuthContext = Depends(require_permission(Permission.LOCATIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """
    List locations with optional tree structure.
    """
    tree_mode = (include_tree or tree).lower() == "true"

    query = db.query(Location).filter(Location.organization_id == organization_id)

    if tree_mode:
        # Return root locations with children loaded
        query = query.filter(Location.parent_id.is_(None))
        query = query.options(joinedload(Location.children))
        locations = query.order_by(Location.name).all()
        return {
            "locations": [_serialize_location(loc, include_children=True) for loc in locations],
            "total": len(locations),
        }

    if parent_id == "null" or parent_id == "":
        query = query.filter(Location.parent_id.is_(None))
    elif parent_id:
        try:
            query = query.filter(Location.parent_id == UUID(parent_id))
        except ValueError:
            raise HTTPException(status_code=400, detail={
                "code": "validation_error",
                "message": f"Invalid parent_id: {parent_id}",
            })

    if location_type:
        query = query.filter(Location.location_type == location_type)

    total = query.count()
    locations = query.order_by(Location.path).offset(offset).limit(limit).all()

    return {
        "items": [_serialize_location(loc) for loc in locations],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/api/organizations/{organization_id}/collections/locations/{location_id}", response_model=LocationFullOut, summary="Get location")
def get_location(
    organization_id: UUID,
    location_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.LOCATIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get a single location with full details."""
    loc = db.query(Location).filter(
        Location.location_id == location_id,
        Location.organization_id == organization_id,
    ).first()

    if not loc:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Location not found",
        })

    result = _serialize_location_full(loc)

    # Include object count at this location
    object_count = db.query(func.count(CollectionObject.object_id)).filter(
        CollectionObject.current_location_id == loc.location_id
    ).scalar()
    result["object_count"] = object_count

    filtered = apply_field_access(result, 'location', str(organization_id), str(auth.user_id), session=db, role_override=auth.role_override)
    return filtered


@router.put("/api/organizations/{organization_id}/collections/locations/{location_id}", response_model=LocationFullOut, summary="Update location")
def update_location(
    organization_id: UUID,
    location_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.LOCATIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Update a location."""
    loc = db.query(Location).filter(
        Location.location_id == location_id,
        Location.organization_id == organization_id,
    ).first()

    if not loc:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Location not found",
        })

    protected_fields = {'location_id', 'organization_id', 'created_at', 'created_by', 'updated_by', 'path', 'depth'}
    protected_fields |= get_write_restricted_fields('collection_location', str(organization_id), str(auth.user_id), session=db, role_override=auth.role_override)
    for key, value in data.items():
        if hasattr(loc, key) and key not in protected_fields:
            setattr(loc, key, value)

    loc.updated_by = auth.user_id
    loc.updated_at = datetime.now(timezone.utc)

    try:
        db.commit()
        return _serialize_location_full(loc)

    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail={
            "code": "validation_error",
            "message": "Database constraint violation",
        })


@router.delete("/api/organizations/{organization_id}/collections/locations/{location_id}", response_model=MessageResponse, summary="Delete location")
def delete_location(
    organization_id: UUID,
    location_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.LOCATIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete a location (must be empty and have no children)."""
    loc = db.query(Location).filter(
        Location.location_id == location_id,
        Location.organization_id == organization_id,
    ).first()

    if not loc:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Location not found",
        })

    # Check for children
    child_count = db.query(func.count(Location.location_id)).filter(
        Location.parent_id == loc.location_id
    ).scalar()
    if child_count > 0:
        raise HTTPException(status_code=400, detail={
            "code": "validation_error",
            "message": "Cannot delete location with child locations",
        })

    # Check for objects
    object_count = db.query(func.count(CollectionObject.object_id)).filter(
        CollectionObject.current_location_id == loc.location_id
    ).scalar()
    if object_count > 0:
        raise HTTPException(status_code=400, detail={
            "code": "validation_error",
            "message": "Cannot delete location containing objects",
        })

    db.delete(loc)
    db.commit()

    return {"message": "Location deleted successfully"}


# ============================================================================
# MOVEMENT ROUTES
# ============================================================================


@router.post("/api/organizations/{organization_id}/collections/movements", status_code=201, response_model=MovementOut, summary="Create movement")
def create_movement(
    organization_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.MOVEMENTS_CREATE)),
    db: Session = Depends(get_db),
):
    """
    Record a movement of an object (or object part) to a new location.

    This also updates the part's current_location_id (and object for backwards compat).
    """
    required_fields = ["object_id", "to_location_id", "reason"]
    missing_fields = [f for f in required_fields if f not in data]
    if missing_fields:
        raise HTTPException(status_code=400, detail={
            "code": "MISSING_FIELDS",
            "message": f"Missing: {', '.join(missing_fields)}",
        })

    # Get the object
    obj = db.query(CollectionObject).filter(
        CollectionObject.object_id == UUID(data["object_id"]),
        CollectionObject.organization_id == organization_id,
    ).first()

    if not obj:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Object not found",
        })

    # Validate an explicitly-named part exists (404). Part *resolution*
    # (primary/first fallback) lives in the shared create function.
    part_id = data.get("part_id")
    if part_id:
        part = db.query(ObjectPart).filter(
            ObjectPart.part_id == UUID(part_id),
            ObjectPart.object_id == obj.object_id,
            ObjectPart.organization_id == organization_id,
        ).first()
        if not part:
            raise HTTPException(status_code=404, detail={
                "code": "not_found",
                "message": "Part not found",
            })

    # Verify destination location
    to_location = db.query(Location).filter(
        Location.location_id == UUID(data["to_location_id"]),
        Location.organization_id == organization_id,
    ).first()

    if not to_location:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Destination location not found",
        })

    # Create via the shared service — the same code the draft applier runs. It
    # owns reference-number generation, part resolution, the location/part/
    # object mutations, and occupancy counts. This router is the thin adapter:
    # validate (400/404), create, commit, serialize.
    from app.services.collections.creation.movement import (
        create_movement as _create_movement,
    )

    mov = _create_movement(db, organization_id, data, auth.user_id, open_approval=True)
    db.commit()

    # Refresh with relationships for proper serialization
    db.refresh(mov)
    mov = db.query(Movement).options(
        joinedload(Movement.from_location),
        joinedload(Movement.to_location),
        joinedload(Movement.handler),
        joinedload(Movement.authorizer),
        joinedload(Movement.shipper),
        joinedload(Movement.object).selectinload(CollectionObject.title_links),
        joinedload(Movement.part),
    ).filter(Movement.movement_id == mov.movement_id).first()

    return _serialize_movement(mov)


@router.get("/api/organizations/{organization_id}/collections/movements", response_model=MovementListResponse, summary="List movements")
def list_movements(
    organization_id: UUID,
    q: str = Query(""),
    object_id: str | None = Query(None),
    location_id: str | None = Query(None),
    reason: str | None = Query(None),
    status: str | None = Query(None),
    limit: int = Query(50, le=500),
    offset: int = Query(0),
    auth: AuthContext = Depends(require_permission(Permission.MOVEMENTS_VIEW)),
    db: Session = Depends(get_db),
):
    """
    List movements with filtering and search.
    """
    query = db.query(Movement).filter(Movement.organization_id == organization_id)

    search = q.strip()
    if search:
        search_term = f"%{escape_ilike(search)}%"
        query = query.join(
            CollectionObject,
            Movement.object_id == CollectionObject.object_id
        ).filter(
            CollectionObject.object_number.ilike(search_term, escape="\\")
        )

    if object_id:
        query = query.filter(Movement.object_id == UUID(object_id))

    if location_id:
        query = query.filter(Movement.to_location_id == UUID(location_id))

    if reason:
        query = query.filter(Movement.reason == reason)

    if status:
        query = query.filter(Movement.status == status)

    total = query.count()
    movements = query.options(
        joinedload(Movement.from_location),
        joinedload(Movement.to_location),
        joinedload(Movement.handler),
        joinedload(Movement.object).selectinload(CollectionObject.title_links),
        joinedload(Movement.part),
    ).order_by(Movement.movement_date.desc()).offset(offset).limit(limit).all()

    return {
        "items": [_serialize_movement(m) for m in movements],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/api/organizations/{organization_id}/collections/movements/{movement_id}", response_model=MovementOut, summary="Get movement")
def get_movement(
    organization_id: UUID,
    movement_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MOVEMENTS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get a single movement by ID."""
    movement = db.query(Movement).options(
        joinedload(Movement.from_location),
        joinedload(Movement.to_location),
        joinedload(Movement.handler),
        joinedload(Movement.authorizer),
        joinedload(Movement.shipper),
        joinedload(Movement.object).selectinload(CollectionObject.title_links),
        joinedload(Movement.part),
    ).filter(
        Movement.movement_id == movement_id,
        Movement.organization_id == organization_id,
    ).first()

    if not movement:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Movement not found",
        })

    return _serialize_movement(movement)


@router.put("/api/organizations/{organization_id}/collections/movements/{movement_id}", response_model=MovementOut, summary="Update movement")
def update_movement(
    organization_id: UUID,
    movement_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.MOVEMENTS_CREATE)),
    db: Session = Depends(get_db),
):
    """Update an existing movement record."""
    movement = db.query(Movement).filter(
        Movement.movement_id == movement_id,
        Movement.organization_id == organization_id,
    ).first()

    if not movement:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Movement not found",
        })

    # Completed movements are locked and cannot be edited
    if movement.status == "completed":
        raise HTTPException(status_code=403, detail={
            "code": "forbidden",
            "message": "Completed movements cannot be edited",
        })

    old_status = movement.status

    # Update allowed fields
    if "reason" in data:
        movement.reason = data["reason"]
    if "movement_note" in data:
        movement.movement_note = data.get("movement_note")
    if "status" in data:
        movement.status = data["status"]
    if "movement_date" in data:
        movement.movement_date = datetime.fromisoformat(data["movement_date"].replace("Z", "+00:00")) if data["movement_date"] else None
    if "from_location_id" in data:
        movement.from_location_id = UUID(data["from_location_id"]) if data["from_location_id"] else None
    if "to_location_id" in data:
        movement.to_location_id = UUID(data["to_location_id"]) if data["to_location_id"] else None
    if "handler_id" in data:
        movement.handler_id = UUID(data["handler_id"]) if data["handler_id"] else None
    if "handler_name" in data:
        movement.handler_name = data.get("handler_name")
    if "location_fitness" in data:
        movement.location_fitness = data.get("location_fitness")
    if "movement_method" in data:
        movement.movement_method = data.get("movement_method")
    if "authorizer_id" in data:
        movement.authorizer_id = UUID(data["authorizer_id"]) if data["authorizer_id"] else None
    if "authorization_date" in data:
        movement.authorization_date = date.fromisoformat(data["authorization_date"]) if data["authorization_date"] else None
    if "authorization_note" in data:
        movement.authorization_note = data.get("authorization_note")
    if "organization_courier" in data:
        movement.organization_courier = bool(data["organization_courier"])
    if "courier_name" in data:
        movement.courier_name = data.get("courier_name")
    if "shipper_id" in data:
        movement.shipper_id = UUID(data["shipper_id"]) if data["shipper_id"] else None
    if "shipper_name" in data:
        movement.shipper_name = data.get("shipper_name")
    if "shipping_method" in data:
        movement.shipping_method = data.get("shipping_method")
    if "shipping_tracking_number" in data:
        movement.shipping_tracking_number = data.get("shipping_tracking_number")
    if "shipping_insurance_value" in data:
        movement.shipping_insurance_value = Decimal(data["shipping_insurance_value"]) if data["shipping_insurance_value"] else None
    if "shipping_insurance_currency" in data:
        movement.shipping_insurance_currency = data.get("shipping_insurance_currency")
    if "shipping_note" in data:
        movement.shipping_note = data.get("shipping_note")
    if "condition_note" in data:
        movement.condition_note = data.get("condition_note")
    if "condition_report_id" in data:
        movement.condition_report_id = UUID(data["condition_report_id"]) if data["condition_report_id"] else None
    if "planned_removal_date" in data:
        movement.planned_removal_date = date.fromisoformat(data["planned_removal_date"]) if data["planned_removal_date"] else None
    if "planned_return_date" in data:
        movement.planned_return_date = date.fromisoformat(data["planned_return_date"]) if data["planned_return_date"] else None

    db.commit()

    if 'status' in data and movement.status != old_status:
        ref = getattr(movement, 'movement_number', None) or str(movement.movement_id)[:8]
        notify_status_change(organization_id, 'movement', movement.movement_id, ref,
                             old_status, movement.status, str(auth.user_id), entity=movement)

    # Refresh with relationships
    movement = db.query(Movement).options(
        joinedload(Movement.from_location),
        joinedload(Movement.to_location),
        joinedload(Movement.handler),
        joinedload(Movement.authorizer),
        joinedload(Movement.shipper),
        joinedload(Movement.object).selectinload(CollectionObject.title_links),
    ).filter(Movement.movement_id == movement_id).first()

    return _serialize_movement(movement)


@router.delete("/api/organizations/{organization_id}/collections/movements/{movement_id}", response_model=MessageResponse, summary="Delete movement")
def delete_movement(
    organization_id: UUID,
    movement_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MOVEMENTS_CREATE)),
    db: Session = Depends(get_db),
):
    """Delete a movement record."""
    movement = db.query(Movement).filter(
        Movement.movement_id == movement_id,
        Movement.organization_id == organization_id,
    ).first()

    if not movement:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Movement not found",
        })

    # Completed movements are locked and cannot be deleted
    if movement.status == "completed":
        raise HTTPException(status_code=409, detail={
            "code": "conflict",
            "message": "Completed movements cannot be deleted",
        })

    db.delete(movement)
    db.commit()

    return {"message": "Movement deleted successfully"}


@router.get("/api/organizations/{organization_id}/collections/objects/{object_id}/movements", response_model=ObjectMovementsResponse, summary="Get object movements")
def get_object_movements(
    organization_id: UUID,
    object_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MOVEMENTS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get movement history for a specific object."""
    # Verify object exists
    obj = db.query(CollectionObject).filter(
        CollectionObject.object_id == object_id,
        CollectionObject.organization_id == organization_id,
    ).first()

    if not obj:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Object not found",
        })

    movements = db.query(Movement).options(
        joinedload(Movement.from_location),
        joinedload(Movement.to_location),
        joinedload(Movement.handler),
        joinedload(Movement.object).selectinload(CollectionObject.title_links),
        joinedload(Movement.part),
    ).filter(
        Movement.object_id == object_id,
        Movement.organization_id == organization_id,
    ).order_by(Movement.movement_date.desc()).all()

    return {
        "movements": [_serialize_movement(m) for m in movements],
        "total": len(movements),
    }
