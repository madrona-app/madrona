"""
Exhibition tools for the agent (primarily visitor persona).
"""

import logging
from datetime import date

from app.services.agent_tools import AgentContext, ToolRegistry

logger = logging.getLogger(__name__)


def list_current_exhibitions(args: dict, ctx: AgentContext) -> dict:
    """List currently open and upcoming public exhibitions."""
    from app.models import Exhibition

    query = ctx.db_session.query(Exhibition).filter(
        Exhibition.organization_id == ctx.organization_id,
        Exhibition.is_public == True,  # noqa: E712
        Exhibition.status.in_(["open", "in_preparation"]),
    )

    exhibitions = query.order_by(Exhibition.planned_start_date.asc()).limit(20).all()

    results = []
    for ex in exhibitions:
        info = {
            "exhibition_id": str(ex.exhibition_id),
            "title": ex.title,
            "status": ex.status,
            "exhibition_type": getattr(ex, "exhibition_type", None),
            "start_date": str(ex.actual_start_date or ex.planned_start_date or ""),
            "end_date": str(ex.actual_end_date or ex.planned_end_date or ""),
            "description": (getattr(ex, "description", None) or "")[:500],
        }

        # Enrich with venue information
        if ex.venue_id:
            from app.models import Venue
            venue = ctx.db_session.query(Venue).filter(
                Venue.venue_id == ex.venue_id,
                Venue.organization_id == ctx.organization_id,
            ).first()
            if venue:
                info["venue_name"] = venue.name
                if venue.address:
                    info["location"] = venue.address
                if venue.admission:
                    info["admission"] = venue.admission

        results.append(info)

    return {"exhibitions": results, "total": len(results)}


def get_exhibition_info(args: dict, ctx: AgentContext) -> dict:
    """Get details about a specific exhibition including its objects."""
    from uuid import UUID as _UUID
    from app.models import Exhibition, ExhibitionObject, CollectionObject

    exhibition_id = args.get("exhibition_id")
    if not exhibition_id:
        return {"error": "exhibition_id is required"}

    try:
        eid = _UUID(exhibition_id)
    except (ValueError, TypeError):
        return {"error": "Invalid exhibition_id format"}

    ex = ctx.db_session.query(Exhibition).filter(
        Exhibition.exhibition_id == eid,
        Exhibition.organization_id == ctx.organization_id,
        Exhibition.is_public == True,  # noqa: E712
    ).first()

    if not ex:
        return {"error": "Exhibition not found"}

    result = {
        "exhibition_id": str(ex.exhibition_id),
        "title": ex.title,
        "status": ex.status,
        "exhibition_type": getattr(ex, "exhibition_type", None),
        "start_date": str(ex.actual_start_date or ex.planned_start_date or ""),
        "end_date": str(ex.actual_end_date or ex.planned_end_date or ""),
        "description": (getattr(ex, "description", None) or "")[:1000],
    }

    # Visitor-facing fields
    if getattr(ex, "visitor_info", None):
        result["visitor_info"] = ex.visitor_info
    if getattr(ex, "ticketing_url", None):
        result["ticketing_url"] = ex.ticketing_url

    # Venue information
    if ex.venue_id:
        from app.models import Venue
        venue = ctx.db_session.query(Venue).filter(
            Venue.venue_id == ex.venue_id,
            Venue.organization_id == ctx.organization_id,
        ).first()
        if venue:
            result["venue_name"] = venue.name
            if venue.address:
                result["venue_address"] = venue.address
            if venue.hours:
                result["venue_hours"] = venue.hours
            if venue.admission:
                result["admission"] = venue.admission
            if venue.ticketing_url:
                result["venue_ticketing_url"] = venue.ticketing_url

    # Get exhibition objects (only discoverable ones for visitors)
    ex_objects = (
        ctx.db_session.query(ExhibitionObject, CollectionObject)
        .join(CollectionObject, ExhibitionObject.object_id == CollectionObject.object_id, isouter=True)
        .filter(
            ExhibitionObject.exhibition_id == eid,
            ExhibitionObject.organization_id == ctx.organization_id,
        )
    )
    if ctx.persona == "visitor":
        ex_objects = ex_objects.filter(CollectionObject.is_discoverable == True)  # noqa: E712

    objects = []
    for exo, obj in ex_objects.limit(30).all():
        if obj:
            if ctx.persona == "visitor" and ctx.org_slug:
                obj_url = f"/c/{ctx.org_slug}/objects/{obj.object_id}"
            else:
                obj_url = f"/organizations/{ctx.organization_id}/collections/objects/{obj.object_id}"
            obj_info = {
                "object_id": str(obj.object_id),
                "object_number": obj.object_number,
                "title": (obj.title_links[0].title if obj.title_links else None) or obj.object_name or "",
                "object_type": getattr(obj, "object_type", None),
                "url": obj_url,
            }
            if obj.brief_description:
                obj_info["description"] = obj.brief_description[:200]
            objects.append(obj_info)
    result["objects"] = objects
    result["object_count"] = len(objects)

    return result


def register_exhibition_tools(registry: ToolRegistry) -> None:
    """Register exhibition tools with the registry."""
    registry.register(
        name="list_current_exhibitions",
        description=(
            "List currently open and upcoming exhibitions at the museum. "
            "Returns exhibition titles, dates, descriptions, and status."
        ),
        parameters={
            "type": "object",
            "properties": {},
        },
        handler=list_current_exhibitions,
        personas=["visitor"],
    )

    registry.register(
        name="get_exhibition_info",
        description=(
            "Get detailed information about a specific exhibition, including "
            "its description, dates, and the objects on display."
        ),
        parameters={
            "type": "object",
            "properties": {
                "exhibition_id": {
                    "type": "string",
                    "description": "The UUID of the exhibition",
                },
            },
            "required": ["exhibition_id"],
        },
        handler=get_exhibition_info,
        personas=["visitor"],
    )
