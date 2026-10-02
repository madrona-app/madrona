"""
Object Parts API endpoints (FastAPI).

Provides CRUD for object parts with independent location tracking per part.
Parts enable tracking individual components of multi-part objects (tea sets, armor, etc.).
Migrated from app/api/object_parts.py.
"""

import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.models import (
    ObjectPart,
    CollectionObject,
    Location,
    Movement,
)
from app.permissions import Permission
from app.services.validation_utils import parse_uuid_or_raise
from app.fastapi_app.schemas.common import SuccessResponse
from app.fastapi_app.schemas.object_parts import (
    ObjectPartOut,
    ObjectPartListResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["object-parts"])


# ============================================================================
# HELPERS
# ============================================================================


def _next_movement_ref(db: Session, org_uuid: UUID) -> str:
    """Generate the next movement reference number for an org."""
    year = datetime.now(timezone.utc).year
    prefix = f"M.{year}."

    latest = db.query(
        func.max(Movement.movement_reference_number),
    ).filter(
        Movement.organization_id == org_uuid,
        Movement.movement_reference_number.like(f"{prefix}%"),
    ).scalar()

    if latest:
        try:
            last_num = int(latest.split(".")[-1])
        except (ValueError, IndexError):
            last_num = 0
    else:
        last_num = 0

    return f"{prefix}{last_num + 1:04d}"


def _generate_part_number(db: Session, object_id: UUID, org_id: UUID) -> str:
    """Generate the next part number for an object."""
    existing_count = db.query(ObjectPart).filter(
        ObjectPart.object_id == object_id,
        ObjectPart.organization_id == org_id,
        ObjectPart.part_number.isnot(None),
    ).count()

    has_primary = db.query(ObjectPart).filter(
        ObjectPart.object_id == object_id,
        ObjectPart.organization_id == org_id,
        ObjectPart.part_number.is_(None),
    ).count() > 0

    next_number = existing_count + (2 if has_primary else 1)
    return str(next_number)


# ============================================================================
# SERIALIZER
# ============================================================================


def _serialize_part(part: ObjectPart) -> dict:
    """Serialize an ObjectPart to JSON."""
    result = {
        "part_id": str(part.part_id),
        "organization_id": str(part.organization_id),
        "object_id": str(part.object_id),
        "part_number": part.part_number,
        "name": part.name,
        "description": part.description,
        "current_location_id": str(part.current_location_id) if part.current_location_id else None,
        "current_location_fitness": part.current_location_fitness,
        "current_location_note": part.current_location_note,
        "current_location_date": part.current_location_date.isoformat() if part.current_location_date else None,
        "home_location_id": str(part.home_location_id) if part.home_location_id else None,
        "barcode": part.barcode,
        "display_order": part.display_order,
        "created_at": part.created_at.isoformat() if part.created_at else None,
        "created_by": str(part.created_by) if part.created_by else None,
        "updated_at": part.updated_at.isoformat() if part.updated_at else None,
        "updated_by": str(part.updated_by) if part.updated_by else None,
    }

    if part.current_location:
        result["current_location_name"] = part.current_location.name
        result["current_location_path"] = part.current_location.path
        result["current_location_on_display"] = part.current_location.on_display

    if part.home_location:
        result["home_location_name"] = part.home_location.name
        result["home_location_path"] = part.home_location.path

    return result


# ============================================================================
# PARTS CRUD
# ============================================================================


@router.get("/api/organizations/{org_id}/collections/objects/{object_id}/parts", response_model=ObjectPartListResponse, summary="List parts")
def list_parts(
    org_id: str,
    object_id: str,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """List all parts for a collection object."""
    org_uuid = parse_uuid_or_raise(org_id, "org_id")
    object_uuid = parse_uuid_or_raise(object_id, "object_id")

    obj = db.query(CollectionObject).filter(
        CollectionObject.object_id == object_uuid,
        CollectionObject.organization_id == org_uuid,
    ).first()

    if not obj:
        raise HTTPException(status_code=404, detail="Object not found")

    parts = db.query(ObjectPart).filter(
        ObjectPart.object_id == object_uuid,
        ObjectPart.organization_id == org_uuid,
    ).options(
        joinedload(ObjectPart.current_location),
        joinedload(ObjectPart.home_location),
    ).order_by(ObjectPart.display_order).all()

    return {
        "parts": [_serialize_part(p) for p in parts],
        "total": len(parts),
    }


@router.post("/api/organizations/{org_id}/collections/objects/{object_id}/parts", status_code=201, response_model=ObjectPartOut, summary="Create part")
def create_part(
    org_id: str,
    object_id: str,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Add a new part to a collection object."""
    org_uuid = parse_uuid_or_raise(org_id, "org_id")
    object_uuid = parse_uuid_or_raise(object_id, "object_id")
    data = body

    obj = db.query(CollectionObject).filter(
        CollectionObject.object_id == object_uuid,
        CollectionObject.organization_id == org_uuid,
    ).first()

    if not obj:
        raise HTTPException(status_code=404, detail="Object not found")

    # Check if we're converting from single-part to multi-part
    existing_parts = db.query(ObjectPart).filter(
        ObjectPart.object_id == object_uuid,
        ObjectPart.organization_id == org_uuid,
    ).all()

    # If there's exactly one part with NULL part_number, give it number "1"
    if len(existing_parts) == 1 and existing_parts[0].part_number is None:
        existing_parts[0].part_number = "1"
        existing_parts[0].updated_by = auth.user_id
        existing_parts[0].updated_at = datetime.now(timezone.utc)

    part_number = _generate_part_number(db, object_uuid, org_uuid)

    max_order = db.query(func.max(ObjectPart.display_order)).filter(
        ObjectPart.object_id == object_uuid,
        ObjectPart.organization_id == org_uuid,
    ).scalar() or 0

    part = ObjectPart(
        organization_id=org_uuid,
        object_id=object_uuid,
        part_number=part_number,
        name=data.get("name"),
        description=data.get("description"),
        current_location_id=UUID(data["current_location_id"]) if data.get("current_location_id") else obj.current_location_id,
        current_location_fitness=data.get("current_location_fitness"),
        current_location_note=data.get("current_location_note"),
        current_location_date=datetime.now(timezone.utc) if data.get("current_location_id") else obj.current_location_date,
        home_location_id=UUID(data["home_location_id"]) if data.get("home_location_id") else obj.home_location_id,
        display_order=max_order + 1,
        created_by=auth.user_id,
        updated_by=auth.user_id,
    )

    db.add(part)
    db.flush()

    # Auto-assign barcode from part_id (scannable linear barcode)
    if not part.barcode:
        part.barcode = str(part.part_id).replace('-', '').upper()
        db.flush()

    # Create movement record if part has a location
    if part.current_location_id:
        mov = Movement(
            organization_id=org_uuid,
            movement_reference_number=_next_movement_ref(db, org_uuid),
            object_id=object_uuid,
            part_id=part.part_id,
            from_location_id=None,
            to_location_id=part.current_location_id,
            movement_date=datetime.now(timezone.utc),
            reason="storage",
            movement_note="Initial location for new part",
            authorized_by=auth.user_id,
            authorization_date=datetime.now(timezone.utc).date(),
            moved_by=auth.user_id,
            created_by=auth.user_id,
            status="completed",
        )
        db.add(mov)

        to_loc = db.query(Location).filter(
            Location.location_id == part.current_location_id,
        ).first()
        if to_loc:
            to_loc.current_count += 1

    db.commit()

    # Refresh with relationships
    db.refresh(part)
    part = db.query(ObjectPart).options(
        joinedload(ObjectPart.current_location),
        joinedload(ObjectPart.home_location),
    ).filter(ObjectPart.part_id == part.part_id).first()

    return _serialize_part(part)


@router.get("/api/organizations/{org_id}/collections/objects/{object_id}/parts/{part_id}", response_model=ObjectPartOut, summary="Get part")
def get_part(
    org_id: str,
    object_id: str,
    part_id: str,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get a single part by ID."""
    org_uuid = parse_uuid_or_raise(org_id, "org_id")
    object_uuid = parse_uuid_or_raise(object_id, "object_id")
    part_uuid = parse_uuid_or_raise(part_id, "part_id")

    part = db.query(ObjectPart).filter(
        ObjectPart.part_id == part_uuid,
        ObjectPart.object_id == object_uuid,
        ObjectPart.organization_id == org_uuid,
    ).options(
        joinedload(ObjectPart.current_location),
        joinedload(ObjectPart.home_location),
    ).first()

    if not part:
        raise HTTPException(status_code=404, detail="Part not found")

    return _serialize_part(part)


@router.put("/api/organizations/{org_id}/collections/objects/{object_id}/parts/{part_id}", response_model=ObjectPartOut, summary="Update part")
def update_part(
    org_id: str,
    object_id: str,
    part_id: str,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Update a part."""
    org_uuid = parse_uuid_or_raise(org_id, "org_id")
    object_uuid = parse_uuid_or_raise(object_id, "object_id")
    part_uuid = parse_uuid_or_raise(part_id, "part_id")
    data = body

    part = db.query(ObjectPart).filter(
        ObjectPart.part_id == part_uuid,
        ObjectPart.object_id == object_uuid,
        ObjectPart.organization_id == org_uuid,
    ).first()

    if not part:
        raise HTTPException(status_code=404, detail="Part not found")

    if "name" in data:
        part.name = data["name"]
    if "description" in data:
        part.description = data["description"]
    if "current_location_id" in data:
        new_loc_id = UUID(data["current_location_id"]) if data["current_location_id"] else None
        old_loc_id = part.current_location_id
        if new_loc_id != old_loc_id:
            part.current_location_id = new_loc_id
            part.current_location_date = datetime.now(timezone.utc)

            if new_loc_id:
                mov = Movement(
                    organization_id=org_uuid,
                    movement_reference_number=_next_movement_ref(db, org_uuid),
                    object_id=object_uuid,
                    part_id=part.part_id,
                    from_location_id=old_loc_id,
                    to_location_id=new_loc_id,
                    movement_date=datetime.now(timezone.utc),
                    reason="storage",
                    movement_note="Location set via part edit",
                    authorized_by=auth.user_id,
                    authorization_date=datetime.now(timezone.utc).date(),
                    moved_by=auth.user_id,
                    created_by=auth.user_id,
                    status="completed",
                )
                db.add(mov)

                if old_loc_id:
                    old_loc = db.query(Location).filter(
                        Location.location_id == old_loc_id,
                    ).first()
                    if old_loc and old_loc.current_count > 0:
                        old_loc.current_count -= 1

                new_loc = db.query(Location).filter(
                    Location.location_id == new_loc_id,
                ).first()
                if new_loc:
                    new_loc.current_count += 1

            # Keep object's location in sync for single-part objects
            if part.part_number is None:
                obj = db.query(CollectionObject).filter(
                    CollectionObject.object_id == object_uuid,
                    CollectionObject.organization_id == org_uuid,
                ).first()
                if obj:
                    obj.current_location_id = new_loc_id
                    obj.current_location_date = datetime.now(timezone.utc)
                    obj.updated_by = auth.user_id

    if "current_location_fitness" in data:
        part.current_location_fitness = data["current_location_fitness"]
    if "current_location_note" in data:
        part.current_location_note = data["current_location_note"]
    if "home_location_id" in data:
        part.home_location_id = UUID(data["home_location_id"]) if data["home_location_id"] else None
    if "barcode" in data:
        part.barcode = data["barcode"]
    if "display_order" in data:
        part.display_order = data["display_order"]

    part.updated_by = auth.user_id
    part.updated_at = datetime.now(timezone.utc)

    db.commit()

    # Refresh with relationships
    db.refresh(part)
    part = db.query(ObjectPart).options(
        joinedload(ObjectPart.current_location),
        joinedload(ObjectPart.home_location),
    ).filter(ObjectPart.part_id == part.part_id).first()

    return _serialize_part(part)


@router.delete("/api/organizations/{org_id}/collections/objects/{object_id}/parts/{part_id}", response_model=SuccessResponse, summary="Delete part")
def delete_part(
    org_id: str,
    object_id: str,
    part_id: str,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete a part. Cannot delete the last part of an object."""
    org_uuid = parse_uuid_or_raise(org_id, "org_id")
    object_uuid = parse_uuid_or_raise(object_id, "object_id")
    part_uuid = parse_uuid_or_raise(part_id, "part_id")

    part = db.query(ObjectPart).filter(
        ObjectPart.part_id == part_uuid,
        ObjectPart.object_id == object_uuid,
        ObjectPart.organization_id == org_uuid,
    ).first()

    if not part:
        raise HTTPException(status_code=404, detail="Part not found")

    parts_count = db.query(ObjectPart).filter(
        ObjectPart.object_id == object_uuid,
        ObjectPart.organization_id == org_uuid,
    ).count()

    if parts_count <= 1:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete the last part of an object",
        )

    db.delete(part)

    # If only one part remains, reset its part_number to NULL (single-part mode)
    if parts_count == 2:
        remaining_part = db.query(ObjectPart).filter(
            ObjectPart.object_id == object_uuid,
            ObjectPart.organization_id == org_uuid,
            ObjectPart.part_id != part_uuid,
        ).first()
        if remaining_part:
            remaining_part.part_number = None
            remaining_part.updated_at = datetime.now(timezone.utc)

    db.commit()

    return {"success": True}
