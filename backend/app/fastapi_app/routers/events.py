"""
Events API endpoints (FastAPI).

14 routes:
  - Events CRUD (5): list, get, create, update, delete
  - Event Object Links (4): list, add, update, remove
  - Event Participants (3): list, add, remove
  - Object Events reverse lookup (1)
  - Collections Impact (1)

Migrated from app/api/events.py.
"""

import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.models import (
    Event,
    EventObjectLink,
    ConstituentXref,
    Constituent,
    CollectionObject,
)
from app.permissions import Permission
from app.services.api_security import escape_ilike, sanitize_error_message
from app.services.public_cache import invalidate_org_cache_by_id
from app.services.constituent_role_service import validate_role, get_valid_roles
from app.fastapi_app.schemas.events import (
    CollectionsImpactResponse,
    EventListResponse,
    EventObjectLinkOut,
    EventObjectListResponse,
    EventOut,
    EventParticipantOut,
    EventParticipantListResponse,
    ObjectEventsResponse,
)
from app.services.rls import set_rls_context_for_session

logger = logging.getLogger(__name__)

router = APIRouter(tags=["events"])


# ============================================================================
# SERIALIZERS
# ============================================================================


def _serialize_event(event: Event, include_counts: bool = False, db: Session = None) -> dict:
    result = {
        "event_id": str(event.event_id),
        "organization_id": str(event.organization_id),
        "event_reference_number": event.event_reference_number,
        "title": event.title,
        "event_type": event.event_type,
        "status": event.status,
        "start_at": event.start_at.isoformat() if event.start_at else None,
        "end_at": event.end_at.isoformat() if event.end_at else None,
        "location_id": str(event.location_id) if event.location_id else None,
        "owner_user_id": str(event.owner_user_id) if event.owner_user_id else None,
        "course_code": event.course_code,
        "instructor_id": str(event.instructor_id) if event.instructor_id else None,
        "department": event.department,
        "institution": event.institution,
        "headcount": event.headcount,
        "session_format": event.session_format,
        "audience": event.audience,
        "capacity": event.capacity,
        "registration_url": event.registration_url,
        "description": event.description,
        "notes": event.notes,
        "created_at": event.created_at.isoformat() if event.created_at else None,
        "created_by": str(event.created_by) if event.created_by else None,
        "updated_at": event.updated_at.isoformat() if event.updated_at else None,
        "updated_by": str(event.updated_by) if event.updated_by else None,
    }

    if event.location:
        result["location_name"] = event.location.name
        result["location_path"] = event.location.path

    if event.owner:
        result["owner_name"] = event.owner.display_name or event.owner.email

    if event.instructor:
        result["instructor_name"] = event.instructor.display_name

    if include_counts and db:
        result["object_count"] = len(event.object_links) if event.object_links else 0
        result["participant_count"] = db.query(func.count(ConstituentXref.xref_id)).filter(
            ConstituentXref.entity_type == "event",
            ConstituentXref.entity_id == event.event_id,
            ConstituentXref.organization_id == event.organization_id,
        ).scalar() or 0

    return result


def _serialize_event_object_link(link: EventObjectLink, include_object: bool = False) -> dict:
    result = {
        "event_object_id": str(link.event_object_id),
        "organization_id": str(link.organization_id),
        "event_id": str(link.event_id),
        "object_id": str(link.object_id),
        "role": link.role,
        "planned_use": link.planned_use,
        "requirements": link.requirements,
        "notes": link.notes,
        "display_order": link.display_order,
        "created_at": link.created_at.isoformat() if link.created_at else None,
        "created_by": str(link.created_by) if link.created_by else None,
    }

    if include_object and link.collection_object:
        obj = link.collection_object
        display_title = None
        if obj.title_links:
            preferred = next((t for t in obj.title_links if t.is_preferred), None)
            display_title = preferred.title if preferred else obj.title_links[0].title
        result["object"] = {
            "object_id": str(obj.object_id),
            "object_number": obj.object_number,
            "title": display_title,
            "object_name": obj.object_name,
            "object_status": obj.object_status,
            "current_location_id": str(obj.current_location_id) if obj.current_location_id else None,
        }
        if obj.current_location:
            result["object"]["current_location_name"] = obj.current_location.name

    return result


def _serialize_event_participant(xref: ConstituentXref, include_constituent: bool = False) -> dict:
    result = {
        "participant_id": str(xref.xref_id),
        "xref_id": str(xref.xref_id),
        "organization_id": str(xref.organization_id),
        "event_id": str(xref.entity_id),
        "constituent_id": str(xref.constituent_id),
        "role": xref.role,
        "notes": xref.notes,
        "display_order": xref.display_order,
        "created_at": xref.created_at.isoformat() if xref.created_at else None,
    }

    if include_constituent and xref.constituent:
        c = xref.constituent
        result["constituent"] = {
            "constituent_id": str(c.constituent_id),
            "name": c.name,
            "constituent_type": c.constituent_type,
            "email": c.email,
            "phone": c.phone,
        }
        result["contact"] = result["constituent"]

    return result


def _generate_event_reference_number(org_id: UUID, db: Session) -> str:
    year = datetime.now(timezone.utc).year

    result = db.query(
        func.max(Event.event_reference_number)
    ).filter(
        Event.organization_id == org_id,
        Event.event_reference_number.like(f"EVT.{year}.%"),
    ).scalar()

    if result:
        try:
            seq = int(result.split(".")[-1])
            next_seq = seq + 1
        except (ValueError, IndexError):
            next_seq = 1
    else:
        next_seq = 1

    return f"EVT.{year}.{next_seq:04d}"


# ============================================================================
# EVENTS CRUD
# ============================================================================


@router.get("/api/organizations/{org_id}/collections/events", response_model=EventListResponse, summary="List events")
def list_events(
    org_id: UUID,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=500),
    q: str = Query(""),
    status: str = Query(None),
    event_type: str = Query(None),
    owner_user_id: UUID = Query(None),
    sort: str = Query("start_at"),
    order: str = Query("desc"),
    auth: AuthContext = Depends(require_permission(Permission.EVENTS_VIEW)),
    db: Session = Depends(get_db),
):
    """List events for an organization."""
    set_rls_context_for_session(db, str(org_id), str(auth.user_id))

    offset = (page - 1) * limit

    query = db.query(Event).filter(
        Event.organization_id == org_id
    ).options(
        joinedload(Event.location),
        joinedload(Event.owner),
        joinedload(Event.object_links),
    )

    if q.strip():
        escaped_q = f"%{escape_ilike(q.strip())}%"
        search_filter = or_(
            Event.title.ilike(escaped_q, escape="\\"),
            Event.event_reference_number.ilike(escaped_q, escape="\\"),
            Event.description.ilike(escaped_q, escape="\\"),
            Event.course_code.ilike(escaped_q, escape="\\"),
        )
        query = query.filter(search_filter)

    if status:
        query = query.filter(Event.status == status)
    if event_type:
        query = query.filter(Event.event_type == event_type)
    if owner_user_id:
        query = query.filter(Event.owner_user_id == owner_user_id)

    if sort == "start_at":
        order_col = Event.start_at.desc() if order == "desc" else Event.start_at.asc()
    elif sort == "title":
        order_col = Event.title.asc() if order == "asc" else Event.title.desc()
    elif sort == "created_at":
        order_col = Event.created_at.desc() if order == "desc" else Event.created_at.asc()
    else:
        order_col = Event.start_at.desc()

    total = query.count()
    events = query.order_by(order_col).offset(offset).limit(limit).all()

    return {
        "items": [_serialize_event(e, include_counts=True, db=db) for e in events],
        "total": total,
        "page": page,
        "limit": limit,
        "offset": offset,
    }


@router.get("/api/organizations/{org_id}/collections/events/{event_id}", response_model=EventOut, summary="Get event")
def get_event(
    org_id: UUID,
    event_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EVENTS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get a single event by ID."""
    set_rls_context_for_session(db, str(org_id), str(auth.user_id))

    event = db.query(Event).filter(
        Event.event_id == event_id,
        Event.organization_id == org_id,
    ).options(
        joinedload(Event.location),
        joinedload(Event.owner),
        joinedload(Event.instructor),
        joinedload(Event.object_links).joinedload(EventObjectLink.collection_object),
    ).first()

    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    result = _serialize_event(event, include_counts=True, db=db)

    result["object_links"] = [
        _serialize_event_object_link(link, include_object=True)
        for link in sorted(event.object_links, key=lambda x: x.display_order)
    ]

    participant_xrefs = db.query(ConstituentXref).filter(
        ConstituentXref.entity_type == "event",
        ConstituentXref.entity_id == event_id,
        ConstituentXref.organization_id == org_id,
    ).options(
        joinedload(ConstituentXref.constituent),
    ).order_by(ConstituentXref.display_order).all()

    result["participants"] = [
        _serialize_event_participant(xref, include_constituent=True)
        for xref in participant_xrefs
    ]

    return result


@router.post("/api/organizations/{org_id}/collections/events", status_code=201, response_model=EventOut, summary="Create event")
def create_event(
    org_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.EVENTS_EDIT)),
    db: Session = Depends(get_db),
):
    """Create a new event."""
    set_rls_context_for_session(db, str(org_id), str(auth.user_id))

    if not body:
        raise HTTPException(status_code=400, detail="Request body is required")
    if not body.get("title"):
        raise HTTPException(status_code=400, detail="Title is required")
    if not body.get("event_type"):
        raise HTTPException(status_code=400, detail="Event type is required")

    try:
        ref_number = _generate_event_reference_number(org_id, db)

        event = Event(
            organization_id=org_id,
            event_reference_number=ref_number,
            title=body["title"],
            event_type=body["event_type"],
            status=body.get("status", "draft"),
            start_at=datetime.fromisoformat(body["start_at"]) if body.get("start_at") else None,
            end_at=datetime.fromisoformat(body["end_at"]) if body.get("end_at") else None,
            location_id=UUID(body["location_id"]) if body.get("location_id") else None,
            owner_user_id=UUID(body["owner_user_id"]) if body.get("owner_user_id") else auth.user_id,
            course_code=body.get("course_code"),
            instructor_id=UUID(body["instructor_id"]) if body.get("instructor_id") else None,
            department=body.get("department"),
            institution=body.get("institution"),
            headcount=body.get("headcount"),
            session_format=body.get("session_format"),
            audience=body.get("audience"),
            capacity=body.get("capacity"),
            registration_url=body.get("registration_url"),
            description=body.get("description"),
            notes=body.get("notes"),
            created_by=auth.user_id,
        )

        db.add(event)
        db.commit()
        invalidate_org_cache_by_id(org_id, section="event")

        logger.info(f"Created event {event.event_id} ({event.event_reference_number}) for org {org_id}")

        return _serialize_event(event)

    except IntegrityError as e:
        db.rollback()
        logger.error(f"Integrity error creating event: {e}")
        raise HTTPException(
            status_code=409,
            detail="Event could not be created due to a conflict. A record with this reference number may already exist.",
        )
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error creating event: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to create event: {sanitize_error_message(e)}")


@router.put("/api/organizations/{org_id}/collections/events/{event_id}", response_model=EventOut, summary="Update event")
@router.patch("/api/organizations/{org_id}/collections/events/{event_id}", response_model=EventOut)
def update_event(
    org_id: UUID,
    event_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.EVENTS_EDIT)),
    db: Session = Depends(get_db),
):
    """Update an event."""
    set_rls_context_for_session(db, str(org_id), str(auth.user_id))

    event = db.query(Event).filter(
        Event.event_id == event_id,
        Event.organization_id == org_id,
    ).first()

    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    if not body:
        raise HTTPException(status_code=400, detail="Request body is required")

    try:
        if "title" in body:
            event.title = body["title"]
        if "event_type" in body:
            event.event_type = body["event_type"]
        if "status" in body:
            event.status = body["status"]
        if "start_at" in body:
            event.start_at = datetime.fromisoformat(body["start_at"]) if body["start_at"] else None
        if "end_at" in body:
            event.end_at = datetime.fromisoformat(body["end_at"]) if body["end_at"] else None
        if "location_id" in body:
            event.location_id = UUID(body["location_id"]) if body["location_id"] else None
        if "owner_user_id" in body:
            event.owner_user_id = UUID(body["owner_user_id"]) if body["owner_user_id"] else None

        if "course_code" in body:
            event.course_code = body["course_code"]
        if "instructor_id" in body:
            event.instructor_id = UUID(body["instructor_id"]) if body["instructor_id"] else None
        if "department" in body:
            event.department = body["department"]
        if "institution" in body:
            event.institution = body["institution"]
        if "headcount" in body:
            event.headcount = body["headcount"]
        if "session_format" in body:
            event.session_format = body["session_format"]

        if "audience" in body:
            event.audience = body["audience"]
        if "capacity" in body:
            event.capacity = body["capacity"]
        if "registration_url" in body:
            event.registration_url = body["registration_url"]

        if "description" in body:
            event.description = body["description"]
        if "notes" in body:
            event.notes = body["notes"]

        event.updated_by = auth.user_id
        event.updated_at = datetime.now(timezone.utc)

        db.commit()
        invalidate_org_cache_by_id(org_id, section="event")

        logger.info(f"Updated event {event_id} for org {org_id}")

        return _serialize_event(event)

    except IntegrityError as e:
        db.rollback()
        logger.error(f"Integrity error updating event: {e}")
        raise HTTPException(status_code=409, detail="Event could not be updated due to a conflict")
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error updating event: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to update event")


@router.delete("/api/organizations/{org_id}/collections/events/{event_id}", summary="Delete event")
def delete_event(
    org_id: UUID,
    event_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EVENTS_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete an event."""
    set_rls_context_for_session(db, str(org_id), str(auth.user_id))

    event = db.query(Event).filter(
        Event.event_id == event_id,
        Event.organization_id == org_id,
    ).first()

    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    try:
        db.delete(event)
        db.commit()
        invalidate_org_cache_by_id(org_id, section="event")

        logger.info(f"Deleted event {event_id} for org {org_id}")

        return JSONResponse(status_code=204, content=None)

    except Exception as e:
        db.rollback()
        logger.error(f"Error deleting event: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to delete event")


# ============================================================================
# EVENT OBJECT LINKS
# ============================================================================


@router.get("/api/organizations/{org_id}/collections/events/{event_id}/objects", response_model=EventObjectListResponse, summary="List event objects")
def list_event_objects(
    org_id: UUID,
    event_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EVENTS_VIEW)),
    db: Session = Depends(get_db),
):
    """List objects linked to an event."""
    set_rls_context_for_session(db, str(org_id), str(auth.user_id))

    event = db.query(Event).filter(
        Event.event_id == event_id,
        Event.organization_id == org_id,
    ).first()

    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    links = db.query(EventObjectLink).filter(
        EventObjectLink.event_id == event_id,
        EventObjectLink.organization_id == org_id,
    ).options(
        joinedload(EventObjectLink.collection_object).joinedload(CollectionObject.current_location)
    ).order_by(EventObjectLink.display_order).all()

    return {
        "objects": [_serialize_event_object_link(link, include_object=True) for link in links],
        "total": len(links),
    }


@router.post("/api/organizations/{org_id}/collections/events/{event_id}/objects", status_code=201, response_model=EventObjectLinkOut, summary="Add event object")
def add_event_object(
    org_id: UUID,
    event_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.EVENTS_EDIT)),
    db: Session = Depends(get_db),
):
    """Link an object to an event."""
    set_rls_context_for_session(db, str(org_id), str(auth.user_id))

    event = db.query(Event).filter(
        Event.event_id == event_id,
        Event.organization_id == org_id,
    ).first()

    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    if not body or not body.get("object_id"):
        raise HTTPException(status_code=400, detail="object_id is required")
    if not body.get("planned_use"):
        raise HTTPException(status_code=400, detail="planned_use is required")

    object_id = UUID(body["object_id"])

    obj = db.query(CollectionObject).filter(
        CollectionObject.object_id == object_id,
        CollectionObject.organization_id == org_id,
    ).first()

    if not obj:
        raise HTTPException(status_code=404, detail="Object not found")

    try:
        max_order = db.query(func.max(EventObjectLink.display_order)).filter(
            EventObjectLink.event_id == event_id
        ).scalar() or 0

        link = EventObjectLink(
            organization_id=org_id,
            event_id=event_id,
            object_id=object_id,
            role=body.get("role", "primary"),
            planned_use=body["planned_use"],
            requirements=body.get("requirements"),
            notes=body.get("notes"),
            display_order=max_order + 1,
            created_by=auth.user_id,
        )

        db.add(link)
        db.commit()

        link = db.query(EventObjectLink).filter(
            EventObjectLink.event_object_id == link.event_object_id
        ).options(
            joinedload(EventObjectLink.collection_object)
        ).first()

        logger.info(f"Linked object {object_id} to event {event_id}")

        return _serialize_event_object_link(link, include_object=True)

    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Object is already linked to this event with this role",
        )
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error linking object to event: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to link object")


@router.put("/api/organizations/{org_id}/collections/events/{event_id}/objects/{link_id}", response_model=EventObjectLinkOut, summary="Update event object")
@router.patch("/api/organizations/{org_id}/collections/events/{event_id}/objects/{link_id}", response_model=EventObjectLinkOut)
def update_event_object(
    org_id: UUID,
    event_id: UUID,
    link_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.EVENTS_EDIT)),
    db: Session = Depends(get_db),
):
    """Update an event object link."""
    set_rls_context_for_session(db, str(org_id), str(auth.user_id))

    link = db.query(EventObjectLink).filter(
        EventObjectLink.event_object_id == link_id,
        EventObjectLink.event_id == event_id,
        EventObjectLink.organization_id == org_id,
    ).first()

    if not link:
        raise HTTPException(status_code=404, detail="Object link not found")

    try:
        if "role" in body:
            link.role = body["role"]
        if "planned_use" in body:
            link.planned_use = body["planned_use"]
        if "requirements" in body:
            link.requirements = body["requirements"]
        if "notes" in body:
            link.notes = body["notes"]
        if "display_order" in body:
            link.display_order = body["display_order"]

        db.commit()

        link = db.query(EventObjectLink).filter(
            EventObjectLink.event_object_id == link_id
        ).options(
            joinedload(EventObjectLink.collection_object)
        ).first()

        return _serialize_event_object_link(link, include_object=True)

    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Update would cause a conflict")
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error updating object link: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to update object link")


@router.delete("/api/organizations/{org_id}/collections/events/{event_id}/objects/{link_id}", summary="Remove event object")
def remove_event_object(
    org_id: UUID,
    event_id: UUID,
    link_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EVENTS_EDIT)),
    db: Session = Depends(get_db),
):
    """Remove an object from an event."""
    set_rls_context_for_session(db, str(org_id), str(auth.user_id))

    link = db.query(EventObjectLink).filter(
        EventObjectLink.event_object_id == link_id,
        EventObjectLink.event_id == event_id,
        EventObjectLink.organization_id == org_id,
    ).first()

    if not link:
        raise HTTPException(status_code=404, detail="Object link not found")

    try:
        db.delete(link)
        db.commit()

        logger.info(f"Unlinked object {link.object_id} from event {event_id}")

        return JSONResponse(status_code=204, content=None)

    except Exception as e:
        db.rollback()
        logger.error(f"Error removing object from event: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to remove object")


# ============================================================================
# EVENT PARTICIPANTS
# ============================================================================


@router.get("/api/organizations/{org_id}/collections/events/{event_id}/participants", response_model=EventParticipantListResponse, summary="List event participants")
def list_event_participants(
    org_id: UUID,
    event_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EVENTS_VIEW)),
    db: Session = Depends(get_db),
):
    """List participants for an event (via ConstituentXref)."""
    set_rls_context_for_session(db, str(org_id), str(auth.user_id))

    event = db.query(Event).filter(
        Event.event_id == event_id,
        Event.organization_id == org_id,
    ).first()

    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    xrefs = db.query(ConstituentXref).filter(
        ConstituentXref.entity_type == "event",
        ConstituentXref.entity_id == event_id,
        ConstituentXref.organization_id == org_id,
    ).options(
        joinedload(ConstituentXref.constituent)
    ).order_by(ConstituentXref.display_order).all()

    return {
        "participants": [_serialize_event_participant(x, include_constituent=True) for x in xrefs],
        "total": len(xrefs),
    }


@router.post("/api/organizations/{org_id}/collections/events/{event_id}/participants", status_code=201, response_model=EventParticipantOut, summary="Add event participant")
def add_event_participant(
    org_id: UUID,
    event_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.EVENTS_EDIT)),
    db: Session = Depends(get_db),
):
    """Add a participant to an event (creates ConstituentXref)."""
    set_rls_context_for_session(db, str(org_id), str(auth.user_id))

    event = db.query(Event).filter(
        Event.event_id == event_id,
        Event.organization_id == org_id,
    ).first()

    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    constituent_id_str = body.get("constituent_id") or body.get("contact_id") if body else None
    if not constituent_id_str:
        raise HTTPException(status_code=400, detail="Participant is required")

    constituent_id = UUID(constituent_id_str)

    constituent = db.query(Constituent).filter(
        Constituent.constituent_id == constituent_id,
        Constituent.organization_id == org_id,
    ).first()

    if not constituent:
        raise HTTPException(status_code=404, detail="Constituent not found")

    role = body.get("role", "participant")
    if not validate_role(org_id, "event", role, db=db):
        valid = get_valid_roles(org_id, "event", db=db)
        valid_keys = [r["value"] for r in valid]
        raise HTTPException(
            status_code=400,
            detail=f"Role '{role}' is not valid for events. Valid roles: {', '.join(valid_keys)}",
        )

    try:
        xref = ConstituentXref(
            organization_id=org_id,
            constituent_id=constituent_id,
            entity_type="event",
            entity_id=event_id,
            role=role,
            notes=body.get("notes"),
            created_by=auth.user_id,
        )

        db.add(xref)
        db.commit()

        xref = db.query(ConstituentXref).filter(
            ConstituentXref.xref_id == xref.xref_id
        ).options(
            joinedload(ConstituentXref.constituent)
        ).first()

        logger.info(f"Added participant {constituent_id} to event {event_id}")

        return _serialize_event_participant(xref, include_constituent=True)

    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Constituent is already a participant in this event with this role",
        )
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error adding participant: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to add participant")


@router.delete("/api/organizations/{org_id}/collections/events/{event_id}/participants/{participant_id}", summary="Remove event participant")
def remove_event_participant(
    org_id: UUID,
    event_id: UUID,
    participant_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EVENTS_EDIT)),
    db: Session = Depends(get_db),
):
    """Remove a participant from an event (deletes ConstituentXref)."""
    set_rls_context_for_session(db, str(org_id), str(auth.user_id))

    xref = db.query(ConstituentXref).filter(
        ConstituentXref.xref_id == participant_id,
        ConstituentXref.entity_type == "event",
        ConstituentXref.entity_id == event_id,
        ConstituentXref.organization_id == org_id,
    ).first()

    if not xref:
        raise HTTPException(status_code=404, detail="Participant not found")

    try:
        db.delete(xref)
        db.commit()

        logger.info(f"Removed participant {participant_id} from event {event_id}")

        return JSONResponse(status_code=204, content=None)

    except Exception as e:
        db.rollback()
        logger.error(f"Error removing participant: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to remove participant")


# ============================================================================
# OBJECT EVENTS (reverse lookup)
# ============================================================================


@router.get("/api/organizations/{org_id}/collections/objects/{object_id}/events", response_model=ObjectEventsResponse, summary="Get object events")
def get_object_events(
    org_id: UUID,
    object_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EVENTS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get events that reference a specific object."""
    set_rls_context_for_session(db, str(org_id), str(auth.user_id))

    links = db.query(EventObjectLink).filter(
        EventObjectLink.object_id == object_id,
        EventObjectLink.organization_id == org_id,
    ).options(
        joinedload(EventObjectLink.event).joinedload(Event.location)
    ).all()

    events = []
    for link in links:
        event_data = _serialize_event(link.event)
        event_data["link"] = {
            "event_object_id": str(link.event_object_id),
            "role": link.role,
            "planned_use": link.planned_use,
            "notes": link.notes,
        }
        events.append(event_data)

    return {
        "events": events,
        "total": len(events),
    }


# ============================================================================
# COLLECTIONS IMPACT
# ============================================================================


@router.get("/api/organizations/{org_id}/collections/events/{event_id}/collections-impact", response_model=CollectionsImpactResponse, summary="Get collections impact")
def get_collections_impact(
    org_id: UUID,
    event_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EVENTS_VIEW)),
    db: Session = Depends(get_db),
):
    """Compute collections impact for a scheduled event."""
    set_rls_context_for_session(db, str(org_id), str(auth.user_id))

    event = db.query(Event).filter(
        Event.event_id == event_id,
        Event.organization_id == org_id,
    ).first()

    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    links = db.query(EventObjectLink).filter(
        EventObjectLink.event_id == event_id,
        EventObjectLink.organization_id == org_id,
    ).options(
        joinedload(EventObjectLink.collection_object)
    ).all()

    if not links:
        return {
            "needs_movement_plan": False,
            "needs_condition_checks": False,
            "needs_rights_verification": False,
            "objects_needing_movement": [],
            "objects_needing_condition_check": [],
            "objects_needing_rights_check": [],
            "event_status": event.status,
            "total_objects": 0,
        }

    needs_movement = []
    needs_condition = []
    needs_rights = []

    for link in links:
        obj = link.collection_object
        obj_info = {
            "object_id": str(link.object_id),
            "object_number": obj.object_number if obj else None,
            "title": obj.object_name if obj else None,
            "planned_use": link.planned_use,
            "role": link.role,
        }

        if link.planned_use in ("display", "handle"):
            needs_movement.append(obj_info)
        if link.planned_use == "handle":
            needs_condition.append(obj_info)
        if link.planned_use in ("photograph", "record"):
            needs_rights.append(obj_info)

    return {
        "needs_movement_plan": len(needs_movement) > 0,
        "needs_condition_checks": len(needs_condition) > 0,
        "needs_rights_verification": len(needs_rights) > 0,
        "objects_needing_movement": needs_movement,
        "objects_needing_condition_check": needs_condition,
        "objects_needing_rights_check": needs_rights,
        "event_status": event.status,
        "total_objects": len(links),
    }
