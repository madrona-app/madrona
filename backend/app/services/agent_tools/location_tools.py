"""
Location and logistics tools for the agent.

Helps staff track where objects are and check storage availability.
"""

import logging

from sqlalchemy import func

from app.services.agent_tools import AgentContext, ToolRegistry

logger = logging.getLogger(__name__)


def find_object_location(args: dict, ctx: AgentContext) -> dict:
    """Find the current location of an object, including movement history."""
    from uuid import UUID as _UUID
    from app.models.objects import CollectionObject
    from app.models.locations import Location, Movement

    object_id = args.get("object_id", "").strip()
    if not object_id:
        return {"error": "object_id is required"}

    try:
        oid = _UUID(object_id)
    except (ValueError, TypeError):
        return {"error": "Invalid object_id format"}

    db = ctx.db_session
    org_id = ctx.organization_id

    obj = db.query(CollectionObject).filter(
        CollectionObject.object_id == oid,
        CollectionObject.organization_id == org_id,
    ).first()

    if not obj:
        return {"error": "Object not found"}

    result = {
        "object_id": str(obj.object_id),
        "object_number": obj.object_number,
        "name": obj.object_name,
    }

    # Current location
    if obj.current_location_id:
        loc = db.query(Location).filter(Location.location_id == obj.current_location_id).first()
        if loc:
            result["current_location"] = {
                "location_id": str(loc.location_id),
                "name": loc.name,
                "path": loc.path,
                "type": loc.location_type,
                "on_display": loc.on_display,
                "security_level": loc.security_level,
            }
            if obj.current_location_fitness:
                result["current_location"]["fitness"] = obj.current_location_fitness
            if obj.current_location_note:
                result["current_location"]["note"] = obj.current_location_note
    else:
        result["current_location"] = None

    # Home location
    if obj.home_location_id:
        home = db.query(Location).filter(Location.location_id == obj.home_location_id).first()
        if home:
            result["home_location"] = {
                "location_id": str(home.location_id),
                "name": home.name,
                "path": home.path,
            }

    # Recent movements
    movements = (
        db.query(Movement)
        .filter(
            Movement.object_id == oid,
            Movement.organization_id == org_id,
        )
        .order_by(Movement.movement_date.desc())
        .limit(5)
        .all()
    )

    if movements:
        result["recent_movements"] = []
        for m in movements:
            move = {
                "date": m.movement_date.isoformat() if m.movement_date else None,
                "reason": m.reason,
                "status": m.status,
            }
            if m.from_location_id:
                from_loc = db.query(Location.name).filter(Location.location_id == m.from_location_id).first()
                if from_loc:
                    move["from"] = from_loc.name
            if m.to_location_id:
                to_loc = db.query(Location.name).filter(Location.location_id == m.to_location_id).first()
                if to_loc:
                    move["to"] = to_loc.name
            result["recent_movements"].append(move)

    return result


def check_storage_availability(args: dict, ctx: AgentContext) -> dict:
    """Check available capacity across storage locations."""
    from app.models.locations import Location

    db = ctx.db_session
    org_id = ctx.organization_id

    location_type = args.get("location_type")
    query_text = args.get("query", "").strip()

    q = db.query(Location).filter(
        Location.organization_id == org_id,
        Location.status == "active",
        Location.capacity.isnot(None),
    )

    if location_type:
        q = q.filter(Location.location_type == location_type)

    if query_text:
        q = q.filter(Location.name.ilike(f"%{query_text}%"))

    locations = q.order_by(
        (Location.capacity - Location.current_count).desc()
    ).limit(20).all()

    results = []
    for loc in locations:
        available = (loc.capacity or 0) - (loc.current_count or 0)
        if available < 0:
            available = 0
        results.append({
            "location_id": str(loc.location_id),
            "name": loc.name,
            "path": loc.path,
            "type": loc.location_type,
            "capacity": loc.capacity,
            "current_count": loc.current_count,
            "available": available,
            "climate_controlled": loc.climate_controlled,
            "security_level": loc.security_level,
            "on_display": loc.on_display,
        })

    return {
        "locations": results,
        "total": len(results),
    }


def register_location_tools(registry: ToolRegistry) -> None:
    """Register location tools."""
    registry.register(
        name="find_object_location",
        description=(
            "Find where an object is right now — its current storage or display "
            "location, home location, and recent movement history. Use this when "
            "someone asks 'where is this object?' or 'has this been moved recently?'"
        ),
        parameters={
            "type": "object",
            "properties": {
                "object_id": {
                    "type": "string",
                    "description": "UUID of the collection object.",
                },
            },
            "required": ["object_id"],
        },
        handler=find_object_location,
        personas=["staff"],
    )

    registry.register(
        name="check_storage_availability",
        description=(
            "Check available storage capacity across locations — how much space "
            "is free in each room, cabinet, or vault. Use this when someone asks "
            "'is there space in vault 3?' or 'where can I store this?'"
        ),
        parameters={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search by location name (e.g., 'vault', 'gallery 3').",
                },
                "location_type": {
                    "type": "string",
                    "description": "Filter by type.",
                    "enum": ["building", "wing", "floor", "room", "area", "cabinet",
                             "shelving_unit", "shelf", "drawer", "bin", "box",
                             "case", "frame", "rack", "vault"],
                },
            },
        },
        handler=check_storage_availability,
        personas=["staff"],
    )
