"""
Visitor-facing agent tools for museum info, events, and practical details.

These tools let the agent answer questions like "What are your hours?",
"How much is admission?", "What's happening this week?", and "Where is Gallery 3?"
"""

import logging
from datetime import datetime, timedelta, timezone

from app.services.agent_tools import AgentContext, ToolRegistry

logger = logging.getLogger(__name__)


def get_museum_info(args: dict, ctx: AgentContext) -> dict:
    """Get venue hours, admission, address, and accessibility info."""
    from app.models import Venue

    venues = (
        ctx.db_session.query(Venue)
        .filter(
            Venue.organization_id == ctx.organization_id,
            Venue.is_public == True,  # noqa: E712
        )
        .order_by(Venue.sort_order.asc())
        .limit(10)
        .all()
    )

    if not venues:
        return {"message": "No public venue information is available."}

    results = []
    for v in venues:
        info = {
            "name": v.name,
            "description": (v.description or "")[:300],
        }
        if v.address:
            info["address"] = v.address
        if v.phone:
            info["phone"] = v.phone
        if v.email:
            info["email"] = v.email
        if v.website_url:
            info["website"] = v.website_url
        if v.hours:
            info["hours"] = v.hours
        if v.admission:
            info["admission"] = v.admission
        if v.parking_info:
            info["parking"] = v.parking_info
        if v.accessibility_info:
            info["accessibility"] = v.accessibility_info
        if v.ticketing_url:
            info["ticketing_url"] = v.ticketing_url
        results.append(info)

    return {"venues": results, "total": len(results)}


def list_upcoming_events(args: dict, ctx: AgentContext) -> dict:
    """List public events for the next N days."""
    from app.models import Event

    days = min(args.get("days", 30), 90)
    now = datetime.now(timezone.utc)
    cutoff = now + timedelta(days=days)

    events = (
        ctx.db_session.query(Event)
        .filter(
            Event.organization_id == ctx.organization_id,
            Event.audience == "public",
            Event.status == "scheduled",
            Event.start_at >= now,
            Event.start_at <= cutoff,
        )
        .order_by(Event.start_at.asc())
        .limit(20)
        .all()
    )

    results = []
    for ev in events:
        info = {
            "event_id": str(ev.event_id),
            "title": ev.title,
            "event_type": ev.event_type,
            "start": ev.start_at.isoformat() if ev.start_at else None,
            "end": ev.end_at.isoformat() if ev.end_at else None,
            "description": (ev.short_description or ev.description or "")[:400],
        }
        if ev.price:
            info["price"] = ev.price
        if ev.price_member:
            info["price_member"] = ev.price_member
        if ev.registration_url:
            info["registration_url"] = ev.registration_url
        if ev.age_range:
            info["age_range"] = ev.age_range
        if ev.series_name:
            info["series"] = ev.series_name

        results.append(info)

    # Batch-fetch venue names to avoid N+1 queries
    venue_ids = {ev.venue_id for ev in events if ev.venue_id}
    if venue_ids:
        from app.models import Venue
        venues = {
            v.venue_id: v.name
            for v in ctx.db_session.query(Venue.venue_id, Venue.name).filter(
                Venue.venue_id.in_(venue_ids),
                Venue.organization_id == ctx.organization_id,
            ).all()
        }
        for i, ev in enumerate(events):
            if ev.venue_id and ev.venue_id in venues:
                results[i]["venue"] = venues[ev.venue_id]

    return {"events": results, "total": len(results), "days_ahead": days}


def get_event_detail(args: dict, ctx: AgentContext) -> dict:
    """Get detailed information about a specific event, including linked objects."""
    from uuid import UUID as _UUID
    from app.models import Event, EventObjectLink, CollectionObject

    event_id = args.get("event_id")
    if not event_id:
        return {"error": "event_id is required"}

    try:
        eid = _UUID(event_id)
    except (ValueError, TypeError):
        return {"error": "Invalid event_id format"}

    query = ctx.db_session.query(Event).filter(
        Event.event_id == eid,
        Event.organization_id == ctx.organization_id,
    )
    # Visitors can only see public, scheduled events
    if ctx.persona == "visitor":
        query = query.filter(
            Event.audience == "public",
            Event.status == "scheduled",
        )
    ev = query.first()

    if not ev:
        return {"error": "Event not found"}

    result = {
        "event_id": str(ev.event_id),
        "title": ev.title,
        "event_type": ev.event_type,
        "status": ev.status,
        "start": ev.start_at.isoformat() if ev.start_at else None,
        "end": ev.end_at.isoformat() if ev.end_at else None,
        "description": (ev.description or "")[:1000],
    }

    if ev.price:
        result["price"] = ev.price
    if ev.price_member:
        result["price_member"] = ev.price_member
    if ev.registration_url:
        result["registration_url"] = ev.registration_url
    if ev.capacity:
        result["capacity"] = ev.capacity
    if ev.age_range:
        result["age_range"] = ev.age_range

    # Venue info
    if ev.venue_id:
        from app.models import Venue
        venue = ctx.db_session.query(Venue).filter(
            Venue.venue_id == ev.venue_id,
            Venue.organization_id == ctx.organization_id,
        ).first()
        if venue:
            result["venue"] = {
                "name": venue.name,
                "address": venue.address,
            }
            if venue.hours:
                result["venue"]["hours"] = venue.hours

    # Exhibition link
    if ev.exhibition_id:
        from app.models import Exhibition
        ex = ctx.db_session.query(Exhibition.title, Exhibition.exhibition_id).filter(
            Exhibition.exhibition_id == ev.exhibition_id,
            Exhibition.organization_id == ctx.organization_id,
        ).first()
        if ex:
            result["exhibition"] = {
                "exhibition_id": str(ex.exhibition_id),
                "title": ex.title,
            }

    # Linked objects
    obj_links = (
        ctx.db_session.query(EventObjectLink, CollectionObject)
        .join(CollectionObject, EventObjectLink.object_id == CollectionObject.object_id, isouter=True)
        .filter(
            EventObjectLink.event_id == eid,
            EventObjectLink.organization_id == ctx.organization_id,
        )
    )
    if ctx.persona == "visitor":
        obj_links = obj_links.filter(CollectionObject.is_discoverable == True)  # noqa: E712

    objects = []
    for link, obj in obj_links.limit(20).all():
        if obj:
            if ctx.persona == "visitor" and ctx.org_slug:
                obj_url = f"/c/{ctx.org_slug}/objects/{obj.object_id}"
            else:
                obj_url = f"/organizations/{ctx.organization_id}/collections/objects/{obj.object_id}"
            objects.append({
                "object_id": str(obj.object_id),
                "object_number": obj.object_number,
                "title": (obj.title_links[0].title if obj.title_links else None) or obj.object_name or "",
                "role": link.role,
                "url": obj_url,
            })

    if objects:
        result["objects"] = objects
        result["object_count"] = len(objects)

    return result


def register_visitor_tools(registry: ToolRegistry) -> None:
    """Register visitor-facing tools with the registry."""
    registry.register(
        name="get_museum_info",
        description=(
            "Get practical museum information: hours of operation, admission prices, "
            "address, parking, accessibility, and contact details. Use this when a "
            "visitor asks about visiting the museum."
        ),
        parameters={
            "type": "object",
            "properties": {},
        },
        handler=get_museum_info,
        personas=["visitor"],
    )

    registry.register(
        name="list_upcoming_events",
        description=(
            "List upcoming public events at the museum — programs, lectures, openings, "
            "workshops. Returns event titles, dates, descriptions, prices, and "
            "registration links. Optionally filter by number of days ahead."
        ),
        parameters={
            "type": "object",
            "properties": {
                "days": {
                    "type": "integer",
                    "description": "Number of days ahead to look (default 30, max 90)",
                },
            },
        },
        handler=list_upcoming_events,
        personas=["visitor"],
    )

    registry.register(
        name="get_event_detail",
        description=(
            "Get detailed information about a specific event, including its "
            "description, venue, pricing, registration, and any objects featured."
        ),
        parameters={
            "type": "object",
            "properties": {
                "event_id": {
                    "type": "string",
                    "description": "The UUID of the event",
                },
            },
            "required": ["event_id"],
        },
        handler=get_event_detail,
        personas=["visitor"],
    )
