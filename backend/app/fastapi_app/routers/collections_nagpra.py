"""
NAGPRA compliance endpoints (FastAPI).

Per-object NAGPRA actions with consultation event audit trail.
Accessed from the CollectionObject workspace page.
"""

import logging
from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_auth, require_permission
from app.models import NagpraAction, NagpraConsultationEvent
from app.permissions import Permission

from app.fastapi_app.serializers.collections import (
    _serialize_nagpra_action,
    _serialize_nagpra_consultation_event,
)
from app.fastapi_app.schemas.collections_nagpra import (
    NagpraActionOut,
    NagpraConsultationEventOut,
    ConsultationEventListResponse,
)
from app.fastapi_app.schemas.common import DeletedResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["collections-nagpra"])


def _sync_object_after_nagpra_change(
    db: Session,
    object_id: UUID,
    organization_id: UUID,
    display_consent: str | None,
) -> None:
    """
    Re-enforce the NAGPRA gates on the linked object after its action changed.

    - If display consent is anything other than granted and the object is
      currently publicly discoverable, unpublish it (consent is authoritative).
    - Always re-index the object so the access-consent redaction in the
      search transformer is applied or lifted.

    ``display_consent=None`` means the action was deleted — restrictions are
    lifted, so only the re-index runs.
    """
    from app.models import CollectionObject
    from app.services.nagpra_restrictions import CONSENT_GRANTED
    from app.services.public_cache import invalidate_org_cache_by_id
    from app.fastapi_app.serializers.collections_helpers import _index_collection_object

    obj = db.query(CollectionObject).filter(
        CollectionObject.object_id == object_id,
        CollectionObject.organization_id == organization_id,
    ).first()
    if not obj:
        return

    if (
        display_consent is not None
        and display_consent != CONSENT_GRANTED
        and obj.is_discoverable
    ):
        obj.is_discoverable = False
        obj.discoverable_at = None
        obj.discoverable_by = None
        db.commit()
        invalidate_org_cache_by_id(str(organization_id))
        logger.info(
            "NAGPRA display consent %s: unpublished object %s",
            display_consent, object_id,
        )

    _index_collection_object(obj)


# ============================================================================
# NAGPRA Actions (per-object)
# ============================================================================


@router.get("/api/organizations/{organization_id}/collections/objects/{object_id}/nagpra", response_model=NagpraActionOut, summary="Get object nagpra action")
def get_object_nagpra_action(
    organization_id: UUID,
    object_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.NAGPRA_VIEW)),
    db: Session = Depends(get_db),
):
    """Get the NAGPRA action for an object (at most one per object)."""
    action = db.query(NagpraAction).filter(
        NagpraAction.organization_id == organization_id,
        NagpraAction.object_id == object_id,
    ).first()

    if not action:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "NAGPRA action not found",
        })

    return _serialize_nagpra_action(action)


@router.post("/api/organizations/{organization_id}/collections/objects/{object_id}/nagpra", status_code=201, response_model=NagpraActionOut, summary="Create nagpra action")
def create_nagpra_action(
    organization_id: UUID,
    object_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.NAGPRA_CREATE)),
    db: Session = Depends(get_db),
):
    """Create a NAGPRA action for an object."""
    if not data.get("origin_type"):
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "Missing required field: origin_type",
        })

    # Check for existing action (unique index on object_id)
    existing = db.query(NagpraAction).filter(
        NagpraAction.object_id == object_id,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": "Object already has a NAGPRA action",
        })

    # Generate action number
    from app.services.sequence import next_sequential_number
    action_number = next_sequential_number(db, organization_id, 'NA')

    user_uuid = auth.user_id

    action = NagpraAction(
        action_id=uuid4(),
        organization_id=organization_id,
        object_id=object_id,
        action_number=action_number,
        group_reference=data.get("group_reference"),
        origin_type=data["origin_type"],
        nagpra_category=data.get("nagpra_category", "undetermined"),
        funerary_association=data.get("funerary_association"),
        category_basis=data.get("category_basis"),
        category_determined_date=data.get("category_determined_date"),
        category_determined_by=UUID(data["category_determined_by"]) if data.get("category_determined_by") else None,
        geographic_origin=data.get("geographic_origin"),
        site_name=data.get("site_name"),
        state=data.get("state"),
        county=data.get("county"),
        affiliation_status=data.get("affiliation_status", "pending"),
        affiliated_party_id=UUID(data["affiliated_party_id"]) if data.get("affiliated_party_id") else None,
        affiliation_basis=data.get("affiliation_basis"),
        affiliation_evidence_types=data.get("affiliation_evidence_types"),
        affiliation_determined_date=data.get("affiliation_determined_date"),
        display_consent=data.get("display_consent", "restricted"),
        display_consent_date=data.get("display_consent_date"),
        access_consent=data.get("access_consent", "restricted"),
        access_consent_date=data.get("access_consent_date"),
        research_consent=data.get("research_consent", "restricted"),
        research_consent_date=data.get("research_consent_date"),
        handling_preferences=data.get("handling_preferences"),
        storage_preferences=data.get("storage_preferences"),
        hold_active=data.get("hold_active", True),
        notice_type=data.get("notice_type"),
        notice_submitted_date=data.get("notice_submitted_date"),
        notice_published_date=data.get("notice_published_date"),
        notice_fr_citation=data.get("notice_fr_citation"),
        waiting_period_end_date=data.get("waiting_period_end_date"),
        transfer_date=data.get("transfer_date"),
        transfer_recipient_id=UUID(data["transfer_recipient_id"]) if data.get("transfer_recipient_id") else None,
        transfer_method=data.get("transfer_method"),
        transfer_note=data.get("transfer_note"),
        deaccession_id=UUID(data["deaccession_id"]) if data.get("deaccession_id") else None,
        coordinator_id=UUID(data["coordinator_id"]) if data.get("coordinator_id") else user_uuid,
        identified_date=data.get("identified_date", datetime.now(timezone.utc).date().isoformat()),
        consultation_initiated_date=data.get("consultation_initiated_date"),
        closed_date=data.get("closed_date"),
        inventory_deadline=data.get("inventory_deadline"),
        status=data.get("status", "identified"),
        action_note=data.get("action_note"),
        internal_note=data.get("internal_note"),
        created_by=user_uuid,
        updated_by=user_uuid,
    )

    db.add(action)
    db.commit()

    _sync_object_after_nagpra_change(db, object_id, organization_id, action.display_consent)

    return _serialize_nagpra_action(action)


@router.get("/api/organizations/{organization_id}/collections/nagpra-actions/{action_id}", response_model=NagpraActionOut, summary="Get nagpra action")
def get_nagpra_action(
    organization_id: UUID,
    action_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.NAGPRA_VIEW)),
    db: Session = Depends(get_db),
):
    """Get a NAGPRA action by ID."""
    action = db.query(NagpraAction).filter(
        NagpraAction.organization_id == organization_id,
        NagpraAction.action_id == action_id,
    ).first()

    if not action:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "NAGPRA action not found",
        })

    return _serialize_nagpra_action(action)


@router.put("/api/organizations/{organization_id}/collections/nagpra-actions/{action_id}", response_model=NagpraActionOut, summary="Update nagpra action")
def update_nagpra_action(
    organization_id: UUID,
    action_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.NAGPRA_EDIT)),
    db: Session = Depends(get_db),
):
    """Update a NAGPRA action."""
    action = db.query(NagpraAction).filter(
        NagpraAction.organization_id == organization_id,
        NagpraAction.action_id == action_id,
    ).first()

    if not action:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "NAGPRA action not found",
        })

    # Update simple fields
    simple_fields = [
        "group_reference", "origin_type", "nagpra_category",
        "funerary_association", "category_basis", "category_determined_date",
        "geographic_origin", "site_name", "state", "county",
        "affiliation_status", "affiliation_basis", "affiliation_evidence_types",
        "affiliation_determined_date",
        "display_consent", "display_consent_date",
        "access_consent", "access_consent_date",
        "research_consent", "research_consent_date",
        "handling_preferences", "storage_preferences", "hold_active",
        "notice_type", "notice_submitted_date", "notice_published_date",
        "notice_fr_citation", "waiting_period_end_date",
        "transfer_date", "transfer_method", "transfer_note",
        "identified_date", "consultation_initiated_date",
        "closed_date", "inventory_deadline",
        "status", "action_note", "internal_note",
    ]
    for field in simple_fields:
        if field in data:
            setattr(action, field, data[field])

    # Update UUID foreign key fields
    uuid_fields = [
        "category_determined_by", "affiliated_party_id",
        "transfer_recipient_id", "deaccession_id", "coordinator_id",
    ]
    for field in uuid_fields:
        if field in data:
            setattr(action, field, UUID(data[field]) if data[field] else None)

    action.updated_by = auth.user_id
    db.commit()

    _sync_object_after_nagpra_change(db, action.object_id, organization_id, action.display_consent)

    return _serialize_nagpra_action(action)


@router.delete("/api/organizations/{organization_id}/collections/nagpra-actions/{action_id}", response_model=DeletedResponse, summary="Delete nagpra action")
def delete_nagpra_action(
    organization_id: UUID,
    action_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.NAGPRA_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete a NAGPRA action and its consultation events."""
    action = db.query(NagpraAction).filter(
        NagpraAction.organization_id == organization_id,
        NagpraAction.action_id == action_id,
    ).first()

    if not action:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "NAGPRA action not found",
        })

    linked_object_id = action.object_id
    db.delete(action)
    db.commit()

    # Restrictions are lifted with the action — re-index the object unredacted
    _sync_object_after_nagpra_change(db, linked_object_id, organization_id, None)

    return {"deleted": True}


# ============================================================================
# Consultation Events (nested under NAGPRA action)
# ============================================================================


@router.get("/api/organizations/{organization_id}/collections/nagpra-actions/{action_id}/consultation-events", response_model=ConsultationEventListResponse, summary="List consultation events")
def list_consultation_events(
    organization_id: UUID,
    action_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.NAGPRA_VIEW)),
    db: Session = Depends(get_db),
):
    """List consultation events for a NAGPRA action."""
    # Verify action exists
    action = db.query(NagpraAction).filter(
        NagpraAction.organization_id == organization_id,
        NagpraAction.action_id == action_id,
    ).first()
    if not action:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "NAGPRA action not found",
        })

    events = db.query(NagpraConsultationEvent).filter(
        NagpraConsultationEvent.action_id == action_id,
    ).order_by(NagpraConsultationEvent.event_date.desc()).all()

    return {
        "consultation_events": [_serialize_nagpra_consultation_event(e) for e in events],
        "total": len(events),
    }


@router.post("/api/organizations/{organization_id}/collections/nagpra-actions/{action_id}/consultation-events", status_code=201, response_model=NagpraConsultationEventOut, summary="Create consultation event")
def create_consultation_event(
    organization_id: UUID,
    action_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.NAGPRA_CREATE)),
    db: Session = Depends(get_db),
):
    """Create a consultation event on a NAGPRA action."""
    # Verify action exists
    action = db.query(NagpraAction).filter(
        NagpraAction.organization_id == organization_id,
        NagpraAction.action_id == action_id,
    ).first()
    if not action:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "NAGPRA action not found",
        })

    # Validate required fields
    for field in ("event_date", "event_type", "direction", "subject"):
        if not data.get(field):
            raise HTTPException(status_code=422, detail={
                "code": "validation_error",
                "message": f"Missing required field: {field}",
            })

    user_uuid = auth.user_id

    event = NagpraConsultationEvent(
        event_id=uuid4(),
        action_id=action_id,
        organization_id=organization_id,
        consulting_party_id=UUID(data["consulting_party_id"]) if data.get("consulting_party_id") else None,
        consulting_party_name=data.get("consulting_party_name"),
        event_date=data["event_date"],
        event_type=data["event_type"],
        direction=data["direction"],
        subject=data["subject"],
        description=data.get("description"),
        participants=data.get("participants"),
        outcomes=data.get("outcomes"),
        follow_up_required=data.get("follow_up_required", False),
        follow_up_date=data.get("follow_up_date"),
        follow_up_note=data.get("follow_up_note"),
        document_references=data.get("document_references"),
        recorded_by=user_uuid,
    )

    db.add(event)
    db.commit()

    return _serialize_nagpra_consultation_event(event)


@router.put("/api/organizations/{organization_id}/collections/nagpra-actions/{action_id}/consultation-events/{event_id}", response_model=NagpraConsultationEventOut, summary="Update consultation event")
def update_consultation_event(
    organization_id: UUID,
    action_id: UUID,
    event_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.NAGPRA_EDIT)),
    db: Session = Depends(get_db),
):
    """Update a consultation event."""
    event = db.query(NagpraConsultationEvent).filter(
        NagpraConsultationEvent.action_id == action_id,
        NagpraConsultationEvent.event_id == event_id,
        NagpraConsultationEvent.organization_id == organization_id,
    ).first()

    if not event:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Consultation event not found",
        })

    simple_fields = [
        "consulting_party_name", "event_date", "event_type", "direction",
        "subject", "description", "participants", "outcomes",
        "follow_up_required", "follow_up_date", "follow_up_note",
        "document_references",
    ]
    for field in simple_fields:
        if field in data:
            setattr(event, field, data[field])

    if "consulting_party_id" in data:
        event.consulting_party_id = UUID(data["consulting_party_id"]) if data["consulting_party_id"] else None

    db.commit()

    return _serialize_nagpra_consultation_event(event)


@router.delete("/api/organizations/{organization_id}/collections/nagpra-actions/{action_id}/consultation-events/{event_id}", response_model=DeletedResponse, summary="Delete consultation event")
def delete_consultation_event(
    organization_id: UUID,
    action_id: UUID,
    event_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.NAGPRA_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete a consultation event."""
    event = db.query(NagpraConsultationEvent).filter(
        NagpraConsultationEvent.action_id == action_id,
        NagpraConsultationEvent.event_id == event_id,
        NagpraConsultationEvent.organization_id == organization_id,
    ).first()

    if not event:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Consultation event not found",
        })

    db.delete(event)
    db.commit()

    return {"deleted": True}
