"""
Shipment and Crate tracking API endpoints (FastAPI).

Migrated from app/api/shipments.py (22 routes):
  - Shipment CRUD (5 routes)
  - Status transition (1 route)
  - Shipment items (3 routes)
  - Shipment legs (3 routes)
  - Shipment references (2 routes)
  - Shipment documents (2 routes)
  - Shipment enums (1 route)
  - Crate CRUD (5 routes)
"""

import logging
from datetime import date, datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse, Response
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.models import (
    Shipment, ShipmentLeg, ShipmentItem, ShipmentReference,
    ShipmentStatusHistory, ShipmentDocument, Crate,
    CollectionObject, Contact, Location,
)
from app.permissions import Permission
from app.services.api_security import escape_ilike
from app.services.entity_notifications import notify_status_change
from app.fastapi_app.schemas.shipments import (
    ShipmentEnumsResponse,
    ShipmentOut,
    ShipmentListResponse,
    ShipmentStatusUpdateResponse,
    ShipmentItemOut,
    ShipmentLegOut,
    ShipmentReferenceOut,
    ShipmentDocumentOut,
    CrateOut,
    CrateListResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["shipments"])


def _parse_date(val):
    """Parse a date string or return None."""
    if val is None:
        return None
    if isinstance(val, str):
        return datetime.fromisoformat(val).date() if "T" in val else datetime.strptime(val, "%Y-%m-%d").date()
    return val


# =============================================================================
# Constants / enums
# =============================================================================

from enum import StrEnum


class ShipmentType(StrEnum):
    OUTBOUND = "outbound"
    RETURN = "return"
    INTERNAL_TRANSFER = "internal_transfer"
    COURIER_DELIVERY = "courier_delivery"


SHIPMENT_TYPE_LABELS = {
    "outbound": "Outbound", "return": "Return",
    "internal_transfer": "Internal Transfer", "courier_delivery": "Courier Delivery",
}


class ShipmentDirection(StrEnum):
    INBOUND = "inbound"
    OUTBOUND = "outbound"


SHIPMENT_DIRECTION_LABELS = {"inbound": "Inbound", "outbound": "Outbound"}


class ShipmentPurpose(StrEnum):
    LOAN = "loan"
    EXHIBITION = "exhibition"
    CONSERVATION = "conservation"
    ACQUISITION = "acquisition"
    REPATRIATION = "repatriation"
    OTHER = "other"


SHIPMENT_PURPOSE_LABELS = {
    "loan": "Loan", "exhibition": "Exhibition", "conservation": "Conservation",
    "acquisition": "Acquisition", "repatriation": "Repatriation", "other": "Other",
}


class ShipmentStatus(StrEnum):
    DRAFT = "draft"
    CONFIRMED = "confirmed"
    DISPATCHED = "dispatched"
    IN_TRANSIT = "in_transit"
    DELAYED = "delayed"
    DELIVERED = "delivered"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


SHIPMENT_STATUS_LABELS = {
    "draft": "Draft", "confirmed": "Confirmed", "dispatched": "Dispatched",
    "in_transit": "In Transit", "delayed": "Delayed", "delivered": "Delivered",
    "completed": "Completed", "cancelled": "Cancelled",
}


class ShipmentItemStatus(StrEnum):
    PENDING = "pending"
    PACKED = "packed"
    DISPATCHED = "dispatched"
    IN_TRANSIT = "in_transit"
    DELIVERED = "delivered"


SHIPMENT_ITEM_STATUS_LABELS = {
    "pending": "Pending", "packed": "Packed", "dispatched": "Dispatched",
    "in_transit": "In Transit", "delivered": "Delivered",
}


class ShippingMethod(StrEnum):
    AIR = "air"
    GROUND = "ground"
    SEA = "sea"
    COURIER = "courier"
    HAND_CARRY = "hand_carry"


SHIPPING_METHOD_LABELS = {"air": "Air", "ground": "Ground", "sea": "Sea", "courier": "Courier", "hand_carry": "Hand Carry"}


class LegStatus(StrEnum):
    SCHEDULED = "scheduled"
    IN_TRANSIT = "in_transit"
    ARRIVED = "arrived"


LEG_STATUS_LABELS = {"scheduled": "Scheduled", "in_transit": "In Transit", "arrived": "Arrived"}

class ShipmentDocumentType:
    ALL = [
        "bill_of_lading", "packing_list", "condition_report", "customs_declaration",
        "insurance_certificate", "courier_receipt", "delivery_receipt", "crate_specs", "other",
    ]
    LABELS = {
        "bill_of_lading": "Bill of Lading", "packing_list": "Packing List",
        "condition_report": "Condition Report", "customs_declaration": "Customs Declaration",
        "insurance_certificate": "Insurance Certificate", "courier_receipt": "Courier Receipt",
        "delivery_receipt": "Delivery Receipt", "crate_specs": "Crate Specifications", "other": "Other",
    }

class ProcedureType:
    ALL = ["loan_out", "loan_in", "object_exit", "object_entry", "exhibition_venue", "deaccession", "movement", "conservation"]
    LABELS = {
        "loan_out": "Loan Out", "loan_in": "Loan In", "object_exit": "Object Exit",
        "object_entry": "Object Entry", "exhibition_venue": "Exhibition Venue", "deaccession": "Deaccession",
        "movement": "Movement", "conservation": "Conservation",
    }

class CrateCondition:
    ALL = ["good", "fair", "poor", "damaged"]
    LABELS = {"good": "Good", "fair": "Fair", "poor": "Poor", "damaged": "Damaged"}


# =============================================================================
# SERIALIZERS
# =============================================================================

def _serialize_contact_ref(contact):
    if not contact:
        return None
    return {
        "contact_id": str(contact.contact_id),
        "display_name": contact.display_name if hasattr(contact, "display_name") else contact.name if hasattr(contact, "name") else None,
    }


def _serialize_location_ref(location):
    if not location:
        return None
    return {
        "location_id": str(location.location_id),
        "name": location.name if hasattr(location, "name") else None,
    }


def _serialize_leg(leg: ShipmentLeg) -> dict:
    return {
        "leg_id": str(leg.leg_id),
        "shipment_id": str(leg.shipment_id),
        "leg_number": leg.leg_number,
        "shipping_method": leg.shipping_method,
        "shipping_method_label": SHIPPING_METHOD_LABELS.get(leg.shipping_method, leg.shipping_method) if leg.shipping_method else None,
        "carrier_id": str(leg.carrier_id) if leg.carrier_id else None,
        "carrier_name": leg.carrier_name,
        "tracking_number": leg.tracking_number,
        "flight_vessel_number": leg.flight_vessel_number,
        "departure_location": leg.departure_location,
        "departure_date": leg.departure_date.isoformat() if leg.departure_date else None,
        "departure_time": leg.departure_time.isoformat() if leg.departure_time else None,
        "arrival_location": leg.arrival_location,
        "arrival_date": leg.arrival_date.isoformat() if leg.arrival_date else None,
        "arrival_time": leg.arrival_time.isoformat() if leg.arrival_time else None,
        "climate_controlled": leg.climate_controlled,
        "status": leg.status,
        "status_label": LEG_STATUS_LABELS.get(leg.status, leg.status),
        "instructions": leg.instructions,
        "cost": str(leg.cost) if leg.cost is not None else None,
        "cost_currency": leg.cost_currency,
        "notes": leg.notes,
    }


def _serialize_item(item: ShipmentItem) -> dict:
    obj = item.object if hasattr(item, "object") and item.object else None
    crate = item.crate if hasattr(item, "crate") and item.crate else None
    return {
        "shipment_item_id": str(item.shipment_item_id),
        "shipment_id": str(item.shipment_id),
        "object_id": str(item.object_id),
        "object_number": obj.object_number if obj and hasattr(obj, "object_number") else None,
        "object_title": obj.title if obj and hasattr(obj, "title") else None,
        "part_id": str(item.part_id) if item.part_id else None,
        "crate_id": str(item.crate_id) if item.crate_id else None,
        "crate_number": crate.crate_number if crate else None,
        "item_number": item.item_number,
        "insurance_value": str(item.insurance_value) if item.insurance_value is not None else None,
        "insurance_currency": item.insurance_currency,
        "status": item.status,
        "status_label": SHIPMENT_ITEM_STATUS_LABELS.get(item.status, item.status),
        "condition_out_note": item.condition_out_note,
        "condition_in_note": item.condition_in_note,
        "special_instructions": item.special_instructions,
        "packing_notes": item.packing_notes,
    }


def _serialize_reference(ref: ShipmentReference) -> dict:
    return {
        "reference_id": str(ref.reference_id),
        "shipment_id": str(ref.shipment_id),
        "procedure_type": ref.procedure_type,
        "procedure_type_label": ProcedureType.LABELS.get(ref.procedure_type, ref.procedure_type),
        "procedure_id": str(ref.procedure_id),
        "notes": ref.notes,
        "created_at": ref.created_at.isoformat() if ref.created_at else None,
    }


def _serialize_document(doc: ShipmentDocument) -> dict:
    return {
        "document_id": str(doc.document_id),
        "shipment_id": str(doc.shipment_id),
        "media_id": str(doc.media_id),
        "document_type": doc.document_type,
        "document_type_label": ShipmentDocumentType.LABELS.get(doc.document_type, doc.document_type) if doc.document_type else None,
        "label": doc.label,
        "created_at": doc.created_at.isoformat() if doc.created_at else None,
    }


def _serialize_status_history(entry: ShipmentStatusHistory) -> dict:
    return {
        "history_id": str(entry.history_id),
        "status": entry.status,
        "status_label": SHIPMENT_STATUS_LABELS.get(entry.status, entry.status),
        "notes": entry.notes,
        "changed_at": entry.changed_at.isoformat() if entry.changed_at else None,
        "changed_by": str(entry.changed_by) if entry.changed_by else None,
    }


def _serialize_shipment(shipment: Shipment, include_relations: bool = True) -> dict:
    data = {
        "shipment_id": str(shipment.shipment_id),
        "organization_id": str(shipment.organization_id),
        "department_id": str(shipment.department_id) if shipment.department_id else None,
        "shipment_number": shipment.shipment_number,
        "shipment_type": shipment.shipment_type,
        "shipment_type_label": SHIPMENT_TYPE_LABELS.get(shipment.shipment_type, shipment.shipment_type),
        "direction": shipment.direction,
        "direction_label": SHIPMENT_DIRECTION_LABELS.get(shipment.direction, shipment.direction) if shipment.direction else None,
        "purpose": shipment.purpose,
        "purpose_label": SHIPMENT_PURPOSE_LABELS.get(shipment.purpose, shipment.purpose) if shipment.purpose else None,
        "status": shipment.status,
        "status_label": SHIPMENT_STATUS_LABELS.get(shipment.status, shipment.status),
        "ship_from_contact_id": str(shipment.ship_from_contact_id) if shipment.ship_from_contact_id else None,
        "ship_from_contact": _serialize_contact_ref(shipment.ship_from_contact) if hasattr(shipment, "ship_from_contact") else None,
        "ship_from_location_id": str(shipment.ship_from_location_id) if shipment.ship_from_location_id else None,
        "ship_from_location": _serialize_location_ref(shipment.ship_from_location) if hasattr(shipment, "ship_from_location") else None,
        "ship_from_address": shipment.ship_from_address,
        "ship_to_contact_id": str(shipment.ship_to_contact_id) if shipment.ship_to_contact_id else None,
        "ship_to_contact": _serialize_contact_ref(shipment.ship_to_contact) if hasattr(shipment, "ship_to_contact") else None,
        "ship_to_location_id": str(shipment.ship_to_location_id) if shipment.ship_to_location_id else None,
        "ship_to_location": _serialize_location_ref(shipment.ship_to_location) if hasattr(shipment, "ship_to_location") else None,
        "ship_to_address": shipment.ship_to_address,
        "requested_date": shipment.requested_date.isoformat() if shipment.requested_date else None,
        "estimated_dispatch_date": shipment.estimated_dispatch_date.isoformat() if shipment.estimated_dispatch_date else None,
        "estimated_arrival_date": shipment.estimated_arrival_date.isoformat() if shipment.estimated_arrival_date else None,
        "actual_dispatch_date": shipment.actual_dispatch_date.isoformat() if shipment.actual_dispatch_date else None,
        "actual_arrival_date": shipment.actual_arrival_date.isoformat() if shipment.actual_arrival_date else None,
        "insurance_value_total": str(shipment.insurance_value_total) if shipment.insurance_value_total is not None else None,
        "insurance_currency": shipment.insurance_currency,
        "insurance_note": shipment.insurance_note,
        "courier_required": shipment.courier_required,
        "is_international": shipment.is_international,
        "is_high_value": shipment.is_high_value,
        "authorized_by": str(shipment.authorized_by) if shipment.authorized_by else None,
        "authorization_date": shipment.authorization_date.isoformat() if shipment.authorization_date else None,
        "remarks": shipment.remarks,
        "internal_notes": shipment.internal_notes,
        "created_at": shipment.created_at.isoformat() if shipment.created_at else None,
        "updated_at": shipment.updated_at.isoformat() if shipment.updated_at else None,
        "created_by": str(shipment.created_by) if shipment.created_by else None,
        "updated_by": str(shipment.updated_by) if shipment.updated_by else None,
    }
    if include_relations:
        data["legs"] = [_serialize_leg(l) for l in (shipment.legs or [])]
        data["items"] = [_serialize_item(i) for i in (shipment.items or [])]
        data["references"] = [_serialize_reference(r) for r in (shipment.references or [])]
        data["documents"] = [_serialize_document(d) for d in (shipment.documents or [])]
        data["status_history"] = [_serialize_status_history(h) for h in (shipment.status_history or [])]
        data["item_count"] = len(shipment.items or [])
        data["leg_count"] = len(shipment.legs or [])
        data["document_count"] = len(shipment.documents or [])
    else:
        data["item_count"] = len(shipment.items) if shipment.items is not None else 0
        data["leg_count"] = len(shipment.legs) if shipment.legs is not None else 0
        data["document_count"] = len(shipment.documents) if shipment.documents is not None else 0
    return data


def _serialize_crate(crate: Crate) -> dict:
    return {
        "crate_id": str(crate.crate_id),
        "organization_id": str(crate.organization_id),
        "crate_number": crate.crate_number,
        "description": crate.description,
        "height_cm": str(crate.height_cm) if crate.height_cm is not None else None,
        "width_cm": str(crate.width_cm) if crate.width_cm is not None else None,
        "depth_cm": str(crate.depth_cm) if crate.depth_cm is not None else None,
        "weight_empty_kg": str(crate.weight_empty_kg) if crate.weight_empty_kg is not None else None,
        "interior_height_cm": str(crate.interior_height_cm) if crate.interior_height_cm is not None else None,
        "interior_width_cm": str(crate.interior_width_cm) if crate.interior_width_cm is not None else None,
        "interior_depth_cm": str(crate.interior_depth_cm) if crate.interior_depth_cm is not None else None,
        "materials": crate.materials,
        "condition": crate.condition,
        "condition_label": CrateCondition.LABELS.get(crate.condition, crate.condition) if crate.condition else None,
        "climate_controlled": crate.climate_controlled,
        "is_stackable": crate.is_stackable,
        "is_oversized": crate.is_oversized,
        "location_id": str(crate.location_id) if crate.location_id else None,
        "location": _serialize_location_ref(crate.location) if hasattr(crate, "location") and crate.location else None,
        "home_location_id": str(crate.home_location_id) if crate.home_location_id else None,
        "home_location": _serialize_location_ref(crate.home_location) if hasattr(crate, "home_location") and crate.home_location else None,
        "is_active": crate.is_active,
        "notes": crate.notes,
        "created_at": crate.created_at.isoformat() if crate.created_at else None,
        "updated_at": crate.updated_at.isoformat() if crate.updated_at else None,
    }


def _generate_shipment_number(db: Session, org_id: UUID, shipment_type: str, direction: str | None) -> str:
    from app.services.sequence import next_sequential_number

    prefix = "SHP"
    if direction == "inbound":
        prefix = "SHP-IN"
    elif direction == "outbound":
        prefix = "SHP-OUT"
    elif shipment_type == "internal_transfer":
        prefix = "SHP-INT"
    elif shipment_type == "courier_delivery":
        prefix = "SHP-CDL"

    return next_sequential_number(db, org_id, prefix, include_year=False, separator='-')


# =============================================================================
# SHIPMENT ENUMS (static route before parameterized)
# =============================================================================


@router.get("/api/organizations/{org_id}/collections/shipments/enums", response_model=ShipmentEnumsResponse, summary="Get shipment enums")
def get_shipment_enums(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get shipment enums."""
    return {
        "shipment_types": [{"value": v, "label": SHIPMENT_TYPE_LABELS[v]} for v in list(ShipmentType)],
        "directions": [{"value": v, "label": SHIPMENT_DIRECTION_LABELS[v]} for v in list(ShipmentDirection)],
        "purposes": [{"value": v, "label": SHIPMENT_PURPOSE_LABELS[v]} for v in list(ShipmentPurpose)],
        "statuses": [{"value": v, "label": SHIPMENT_STATUS_LABELS[v]} for v in list(ShipmentStatus)],
        "item_statuses": [{"value": v, "label": SHIPMENT_ITEM_STATUS_LABELS[v]} for v in list(ShipmentItemStatus)],
        "shipping_methods": [{"value": v, "label": SHIPPING_METHOD_LABELS[v]} for v in list(ShippingMethod)],
        "leg_statuses": [{"value": v, "label": LEG_STATUS_LABELS[v]} for v in list(LegStatus)],
        "document_types": [{"value": v, "label": ShipmentDocumentType.LABELS[v]} for v in ShipmentDocumentType.ALL],
        "procedure_types": [{"value": v, "label": ProcedureType.LABELS[v]} for v in ProcedureType.ALL],
        "crate_conditions": [{"value": v, "label": CrateCondition.LABELS[v]} for v in CrateCondition.ALL],
    }


# =============================================================================
# SHIPMENT CRUD
# =============================================================================


@router.get("/api/organizations/{org_id}/collections/shipments", response_model=ShipmentListResponse, summary="List shipments")
def list_shipments(
    org_id: UUID,
    status: str = Query(None),
    direction: str = Query(None),
    purpose: str = Query(None),
    shipment_type: str = Query(None),
    q: str = Query(None),
    reference: str = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """List shipments."""
    query = db.query(Shipment).filter(Shipment.organization_id == org_id)

    if status and status in list(ShipmentStatus):
        query = query.filter(Shipment.status == status)
    if direction and direction in list(ShipmentDirection):
        query = query.filter(Shipment.direction == direction)
    if purpose and purpose in list(ShipmentPurpose):
        query = query.filter(Shipment.purpose == purpose)
    if shipment_type and shipment_type in list(ShipmentType):
        query = query.filter(Shipment.shipment_type == shipment_type)

    if q and q.strip():
        search_term = f"%{escape_ilike(q.strip())}%"
        query = query.filter(or_(
            Shipment.shipment_number.ilike(search_term, escape="\\"),
            Shipment.remarks.ilike(search_term, escape="\\"),
            Shipment.internal_notes.ilike(search_term, escape="\\"),
        ))

    if reference and ":" in reference:
        proc_type, proc_id = reference.split(":", 1)
        query = query.join(ShipmentReference).filter(
            ShipmentReference.procedure_type == proc_type,
            ShipmentReference.procedure_id == proc_id,
        )

    query = query.order_by(
        Shipment.estimated_dispatch_date.desc().nullslast(),
        Shipment.created_at.desc(),
    )

    total = query.count()
    shipments = query.offset(offset).limit(limit).all()

    # Summary stats
    all_q = db.query(Shipment).filter(Shipment.organization_id == org_id)
    all_shipments = all_q.all()
    summary = {
        "total": len(all_shipments),
        "in_transit": len([s for s in all_shipments if s.status in ("dispatched", "in_transit")]),
        "delayed": len([s for s in all_shipments if s.status == "delayed"]),
        "completed": len([s for s in all_shipments if s.status == "completed"]),
    }

    return {
        "items": [_serialize_shipment(s, include_relations=False) for s in shipments],
        "summary": summary,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("/api/organizations/{org_id}/collections/shipments", response_model=ShipmentOut, status_code=201, summary="Create shipment")
def create_shipment(
    org_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_CREATE)),
    db: Session = Depends(get_db),
):
    """Create shipment."""
    shipment_type = body.get("shipment_type", "outbound")
    if shipment_type not in list(ShipmentType):
        raise HTTPException(status_code=422, detail=f"Invalid shipment_type. Must be one of: {list(ShipmentType)}")

    direction = body.get("direction")
    if direction and direction not in list(ShipmentDirection):
        raise HTTPException(status_code=422, detail=f"Invalid direction. Must be one of: {list(ShipmentDirection)}")

    purpose = body.get("purpose")
    if purpose and purpose not in list(ShipmentPurpose):
        raise HTTPException(status_code=422, detail=f"Invalid purpose. Must be one of: {list(ShipmentPurpose)}")

    status = body.get("status", "draft")
    if status not in list(ShipmentStatus):
        raise HTTPException(status_code=422, detail=f"Invalid status. Must be one of: {list(ShipmentStatus)}")

    shipment_number = body.get("shipment_number") or _generate_shipment_number(db, org_id, shipment_type, direction)

    shipment = Shipment(
        organization_id=org_id,
        shipment_number=shipment_number,
        shipment_type=shipment_type,
        direction=direction,
        purpose=purpose,
        status=status,
        department_id=body.get("department_id"),
        ship_from_contact_id=body.get("ship_from_contact_id"),
        ship_from_location_id=body.get("ship_from_location_id"),
        ship_from_address=body.get("ship_from_address"),
        ship_to_contact_id=body.get("ship_to_contact_id"),
        ship_to_location_id=body.get("ship_to_location_id"),
        ship_to_address=body.get("ship_to_address"),
        requested_date=_parse_date(body.get("requested_date")),
        estimated_dispatch_date=_parse_date(body.get("estimated_dispatch_date")),
        estimated_arrival_date=_parse_date(body.get("estimated_arrival_date")),
        actual_dispatch_date=_parse_date(body.get("actual_dispatch_date")),
        actual_arrival_date=_parse_date(body.get("actual_arrival_date")),
        insurance_value_total=body.get("insurance_value_total"),
        insurance_currency=body.get("insurance_currency", "USD"),
        insurance_note=body.get("insurance_note"),
        courier_required=body.get("courier_required", False),
        is_international=body.get("is_international", False),
        is_high_value=body.get("is_high_value", False),
        remarks=body.get("remarks"),
        internal_notes=body.get("internal_notes"),
        created_by=auth.user_id,
        updated_by=auth.user_id,
    )
    db.add(shipment)
    db.flush()

    history = ShipmentStatusHistory(
        organization_id=org_id,
        shipment_id=shipment.shipment_id,
        status=status,
        notes="Shipment created",
        changed_by=auth.user_id,
    )
    db.add(history)
    db.commit()
    db.refresh(shipment)

    return _serialize_shipment(shipment)


@router.get("/api/organizations/{org_id}/collections/shipments/{shipment_id}", response_model=ShipmentOut, summary="Get shipment")
def get_shipment(
    org_id: UUID,
    shipment_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get shipment."""
    shipment = db.query(Shipment).filter(
        Shipment.shipment_id == shipment_id,
        Shipment.organization_id == org_id,
    ).first()
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    return _serialize_shipment(shipment)


@router.patch("/api/organizations/{org_id}/collections/shipments/{shipment_id}", response_model=ShipmentOut, summary="Update shipment")
def update_shipment(
    org_id: UUID,
    shipment_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Update shipment."""
    shipment = db.query(Shipment).filter(
        Shipment.shipment_id == shipment_id,
        Shipment.organization_id == org_id,
    ).first()
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")

    old_status = shipment.status

    if "shipment_type" in body and body["shipment_type"] not in list(ShipmentType):
        raise HTTPException(status_code=422, detail="Invalid shipment_type")
    if "direction" in body and body["direction"] is not None and body["direction"] not in list(ShipmentDirection):
        raise HTTPException(status_code=422, detail="Invalid direction")
    if "purpose" in body and body["purpose"] is not None and body["purpose"] not in list(ShipmentPurpose):
        raise HTTPException(status_code=422, detail="Invalid purpose")
    if "status" in body and body["status"] not in list(ShipmentStatus):
        raise HTTPException(status_code=422, detail="Invalid status")

    updatable = [
        "shipment_number", "shipment_type", "direction", "purpose", "status",
        "department_id", "ship_from_contact_id", "ship_from_location_id", "ship_from_address",
        "ship_to_contact_id", "ship_to_location_id", "ship_to_address",
        "requested_date", "estimated_dispatch_date", "estimated_arrival_date",
        "actual_dispatch_date", "actual_arrival_date",
        "insurance_value_total", "insurance_currency", "insurance_note",
        "courier_required", "is_international", "is_high_value",
        "authorized_by", "authorization_date",
        "remarks", "internal_notes",
    ]
    for field in updatable:
        if field in body:
            setattr(shipment, field, body[field])

    shipment.updated_at = datetime.now(timezone.utc)
    shipment.updated_by = auth.user_id

    if "status" in body and body["status"] != old_status:
        history = ShipmentStatusHistory(
            organization_id=org_id,
            shipment_id=shipment.shipment_id,
            status=body["status"],
            notes=body.get("status_notes"),
            changed_by=auth.user_id,
        )
        db.add(history)

    db.commit()
    db.refresh(shipment)

    return _serialize_shipment(shipment)


@router.delete("/api/organizations/{org_id}/collections/shipments/{shipment_id}", summary="Delete shipment")
def delete_shipment(
    org_id: UUID,
    shipment_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_DELETE)),
    db: Session = Depends(get_db),
):
    """Delete shipment."""
    shipment = db.query(Shipment).filter(
        Shipment.shipment_id == shipment_id,
        Shipment.organization_id == org_id,
    ).first()
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")

    db.delete(shipment)
    db.commit()
    return Response(status_code=204)


# =============================================================================
# STATUS TRANSITION
# =============================================================================


@router.post("/api/organizations/{org_id}/collections/shipments/{shipment_id}/status", response_model=ShipmentStatusUpdateResponse, summary="Update shipment status")
def update_shipment_status(
    org_id: UUID,
    shipment_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Update shipment status."""
    shipment = db.query(Shipment).filter(
        Shipment.shipment_id == shipment_id,
        Shipment.organization_id == org_id,
    ).first()
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")

    new_status = body.get("status")
    if not new_status or new_status not in list(ShipmentStatus):
        raise HTTPException(status_code=422, detail=f"Invalid status. Must be one of: {list(ShipmentStatus)}")

    old_status = shipment.status
    shipment.status = new_status
    shipment.updated_at = datetime.now(timezone.utc)
    shipment.updated_by = auth.user_id

    if new_status == "dispatched" and not shipment.actual_dispatch_date:
        shipment.actual_dispatch_date = date.today()
    if new_status in ("delivered", "completed") and not shipment.actual_arrival_date:
        shipment.actual_arrival_date = date.today()

    history = ShipmentStatusHistory(
        organization_id=org_id,
        shipment_id=shipment.shipment_id,
        status=new_status,
        notes=body.get("notes"),
        changed_by=auth.user_id,
    )
    db.add(history)
    db.commit()

    if new_status != old_status:
        try:
            ref = getattr(shipment, "shipment_number", None) or str(shipment.shipment_id)[:8]
            notify_status_change(
                str(org_id), "shipment", shipment.shipment_id, ref,
                old_status, new_status, str(auth.user_id), entity=shipment,
            )
        except Exception:
            logger.warning("Failed to send status change notification for shipment %s", shipment_id)

    return {
        "shipment_id": str(shipment.shipment_id),
        "old_status": old_status,
        "new_status": new_status,
        "status_label": SHIPMENT_STATUS_LABELS.get(new_status, new_status),
    }


# =============================================================================
# SHIPMENT ITEMS
# =============================================================================


@router.post("/api/organizations/{org_id}/collections/shipments/{shipment_id}/items", response_model=ShipmentItemOut, status_code=201, summary="Add shipment item")
def add_shipment_item(
    org_id: UUID,
    shipment_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Add shipment item."""
    shipment = db.query(Shipment).filter(
        Shipment.shipment_id == shipment_id,
        Shipment.organization_id == org_id,
    ).first()
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")

    if not body.get("object_id"):
        raise HTTPException(status_code=422, detail="Object is required")

    existing = db.query(ShipmentItem).filter(
        ShipmentItem.shipment_id == shipment_id,
        ShipmentItem.object_id == body["object_id"],
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Object already linked to this shipment")

    item_status = body.get("status", "pending")
    if item_status not in list(ShipmentItemStatus):
        raise HTTPException(status_code=422, detail="Invalid item status")

    item = ShipmentItem(
        organization_id=org_id,
        shipment_id=shipment_id,
        object_id=body["object_id"],
        part_id=body.get("part_id"),
        crate_id=body.get("crate_id"),
        item_number=body.get("item_number"),
        insurance_value=body.get("insurance_value"),
        insurance_currency=body.get("insurance_currency", "USD"),
        status=item_status,
        condition_out_note=body.get("condition_out_note"),
        condition_in_note=body.get("condition_in_note"),
        special_instructions=body.get("special_instructions"),
        packing_notes=body.get("packing_notes"),
        created_by=auth.user_id,
        updated_by=auth.user_id,
    )
    db.add(item)
    db.commit()
    db.refresh(item)

    return _serialize_item(item)


@router.patch("/api/organizations/{org_id}/collections/shipments/{shipment_id}/items/{item_id}", response_model=ShipmentItemOut, summary="Update shipment item")
def update_shipment_item(
    org_id: UUID,
    shipment_id: UUID,
    item_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Update shipment item."""
    item = db.query(ShipmentItem).filter(
        ShipmentItem.shipment_item_id == item_id,
        ShipmentItem.shipment_id == shipment_id,
        ShipmentItem.organization_id == org_id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Shipment item not found")

    if "status" in body and body["status"] not in list(ShipmentItemStatus):
        raise HTTPException(status_code=422, detail="Invalid item status")

    updatable = [
        "crate_id", "part_id", "item_number", "insurance_value", "insurance_currency",
        "status", "condition_out_note", "condition_in_note",
        "special_instructions", "packing_notes",
        "condition_report_out_id", "condition_report_in_id",
    ]
    for field in updatable:
        if field in body:
            setattr(item, field, body[field])

    item.updated_at = datetime.now(timezone.utc)
    item.updated_by = auth.user_id
    db.commit()
    db.refresh(item)

    return _serialize_item(item)


@router.delete("/api/organizations/{org_id}/collections/shipments/{shipment_id}/items/{item_id}", summary="Remove shipment item")
def remove_shipment_item(
    org_id: UUID,
    shipment_id: UUID,
    item_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Remove shipment item."""
    item = db.query(ShipmentItem).filter(
        ShipmentItem.shipment_item_id == item_id,
        ShipmentItem.shipment_id == shipment_id,
        ShipmentItem.organization_id == org_id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Shipment item not found")

    db.delete(item)
    db.commit()
    return Response(status_code=204)


# =============================================================================
# SHIPMENT LEGS
# =============================================================================


@router.post("/api/organizations/{org_id}/collections/shipments/{shipment_id}/legs", response_model=ShipmentLegOut, status_code=201, summary="Add shipment leg")
def add_shipment_leg(
    org_id: UUID,
    shipment_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Add shipment leg."""
    shipment = db.query(Shipment).filter(
        Shipment.shipment_id == shipment_id,
        Shipment.organization_id == org_id,
    ).first()
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")

    shipping_method = body.get("shipping_method")
    if shipping_method and shipping_method not in list(ShippingMethod):
        raise HTTPException(status_code=422, detail="Invalid shipping_method")

    leg_status = body.get("status", "scheduled")
    if leg_status not in list(LegStatus):
        raise HTTPException(status_code=422, detail="Invalid leg status")

    max_leg = db.query(func.max(ShipmentLeg.leg_number)).filter(
        ShipmentLeg.shipment_id == shipment_id,
    ).scalar() or 0

    leg = ShipmentLeg(
        organization_id=org_id,
        shipment_id=shipment_id,
        leg_number=body.get("leg_number", max_leg + 1),
        shipping_method=shipping_method,
        carrier_id=body.get("carrier_id"),
        carrier_name=body.get("carrier_name"),
        tracking_number=body.get("tracking_number"),
        flight_vessel_number=body.get("flight_vessel_number"),
        departure_location=body.get("departure_location"),
        departure_date=_parse_date(body.get("departure_date")),
        departure_time=body.get("departure_time"),
        arrival_location=body.get("arrival_location"),
        arrival_date=_parse_date(body.get("arrival_date")),
        arrival_time=body.get("arrival_time"),
        climate_controlled=body.get("climate_controlled", False),
        status=leg_status,
        instructions=body.get("instructions"),
        cost=body.get("cost"),
        cost_currency=body.get("cost_currency", "USD"),
        notes=body.get("notes"),
        created_by=auth.user_id,
        updated_by=auth.user_id,
    )
    db.add(leg)
    db.commit()
    db.refresh(leg)

    return _serialize_leg(leg)


@router.patch("/api/organizations/{org_id}/collections/shipments/{shipment_id}/legs/{leg_id}", response_model=ShipmentLegOut, summary="Update shipment leg")
def update_shipment_leg(
    org_id: UUID,
    shipment_id: UUID,
    leg_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Update shipment leg."""
    leg = db.query(ShipmentLeg).filter(
        ShipmentLeg.leg_id == leg_id,
        ShipmentLeg.shipment_id == shipment_id,
        ShipmentLeg.organization_id == org_id,
    ).first()
    if not leg:
        raise HTTPException(status_code=404, detail="Shipment leg not found")

    if "shipping_method" in body and body["shipping_method"] is not None and body["shipping_method"] not in list(ShippingMethod):
        raise HTTPException(status_code=422, detail="Invalid shipping_method")
    if "status" in body and body["status"] not in list(LegStatus):
        raise HTTPException(status_code=422, detail="Invalid leg status")

    updatable = [
        "leg_number", "shipping_method", "carrier_id", "carrier_name",
        "tracking_number", "flight_vessel_number",
        "departure_location", "departure_date", "departure_time",
        "arrival_location", "arrival_date", "arrival_time",
        "climate_controlled", "status", "instructions",
        "cost", "cost_currency", "notes",
    ]
    for field in updatable:
        if field in body:
            setattr(leg, field, body[field])

    leg.updated_at = datetime.now(timezone.utc)
    leg.updated_by = auth.user_id
    db.commit()
    db.refresh(leg)

    return _serialize_leg(leg)


@router.delete("/api/organizations/{org_id}/collections/shipments/{shipment_id}/legs/{leg_id}", summary="Remove shipment leg")
def remove_shipment_leg(
    org_id: UUID,
    shipment_id: UUID,
    leg_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Remove shipment leg."""
    leg = db.query(ShipmentLeg).filter(
        ShipmentLeg.leg_id == leg_id,
        ShipmentLeg.shipment_id == shipment_id,
        ShipmentLeg.organization_id == org_id,
    ).first()
    if not leg:
        raise HTTPException(status_code=404, detail="Shipment leg not found")

    db.delete(leg)
    db.commit()
    return Response(status_code=204)


# =============================================================================
# SHIPMENT REFERENCES
# =============================================================================


@router.post("/api/organizations/{org_id}/collections/shipments/{shipment_id}/references", response_model=ShipmentReferenceOut, status_code=201, summary="Add shipment reference")
def add_shipment_reference(
    org_id: UUID,
    shipment_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Add shipment reference."""
    shipment = db.query(Shipment).filter(
        Shipment.shipment_id == shipment_id,
        Shipment.organization_id == org_id,
    ).first()
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")

    procedure_type = body.get("procedure_type")
    if not procedure_type or procedure_type not in ProcedureType.ALL:
        raise HTTPException(status_code=422, detail=f"Invalid procedure_type. Must be one of: {ProcedureType.ALL}")

    if not body.get("procedure_id"):
        raise HTTPException(status_code=422, detail="Procedure is required")

    existing = db.query(ShipmentReference).filter(
        ShipmentReference.shipment_id == shipment_id,
        ShipmentReference.procedure_type == procedure_type,
        ShipmentReference.procedure_id == body["procedure_id"],
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="This procedure is already linked to this shipment")

    ref = ShipmentReference(
        organization_id=org_id,
        shipment_id=shipment_id,
        procedure_type=procedure_type,
        procedure_id=body["procedure_id"],
        notes=body.get("notes"),
        created_by=auth.user_id,
    )
    db.add(ref)
    db.commit()
    db.refresh(ref)

    return _serialize_reference(ref)


@router.delete("/api/organizations/{org_id}/collections/shipments/{shipment_id}/references/{ref_id}", summary="Remove shipment reference")
def remove_shipment_reference(
    org_id: UUID,
    shipment_id: UUID,
    ref_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Remove shipment reference."""
    ref = db.query(ShipmentReference).filter(
        ShipmentReference.reference_id == ref_id,
        ShipmentReference.shipment_id == shipment_id,
        ShipmentReference.organization_id == org_id,
    ).first()
    if not ref:
        raise HTTPException(status_code=404, detail="Shipment reference not found")

    db.delete(ref)
    db.commit()
    return Response(status_code=204)


# =============================================================================
# SHIPMENT DOCUMENTS
# =============================================================================


@router.post("/api/organizations/{org_id}/collections/shipments/{shipment_id}/documents", response_model=ShipmentDocumentOut, status_code=201, summary="Add shipment document")
def add_shipment_document(
    org_id: UUID,
    shipment_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Add shipment document."""
    shipment = db.query(Shipment).filter(
        Shipment.shipment_id == shipment_id,
        Shipment.organization_id == org_id,
    ).first()
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")

    if not body.get("media_id"):
        raise HTTPException(status_code=422, detail="Media item is required")

    doc_type = body.get("document_type")
    if doc_type and doc_type not in ShipmentDocumentType.ALL:
        raise HTTPException(status_code=422, detail=f"Invalid document_type. Must be one of: {ShipmentDocumentType.ALL}")

    doc = ShipmentDocument(
        organization_id=org_id,
        shipment_id=shipment_id,
        media_id=body["media_id"],
        document_type=doc_type,
        label=body.get("label"),
        created_by=auth.user_id,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    return _serialize_document(doc)


@router.delete("/api/organizations/{org_id}/collections/shipments/{shipment_id}/documents/{doc_id}", summary="Remove shipment document")
def remove_shipment_document(
    org_id: UUID,
    shipment_id: UUID,
    doc_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Remove shipment document."""
    doc = db.query(ShipmentDocument).filter(
        ShipmentDocument.document_id == doc_id,
        ShipmentDocument.shipment_id == shipment_id,
        ShipmentDocument.organization_id == org_id,
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Shipment document not found")

    db.delete(doc)
    db.commit()
    return Response(status_code=204)


# =============================================================================
# CRATE CRUD
# =============================================================================


@router.get("/api/organizations/{org_id}/collections/crates", response_model=CrateListResponse, summary="List crates")
def list_crates(
    org_id: UUID,
    active: str = Query("true"),
    condition: str = Query(None),
    q: str = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """List crates."""
    query = db.query(Crate).filter(Crate.organization_id == org_id)

    if active == "true":
        query = query.filter(Crate.is_active == True)  # noqa: E712
    elif active == "false":
        query = query.filter(Crate.is_active == False)  # noqa: E712

    if condition and condition in CrateCondition.ALL:
        query = query.filter(Crate.condition == condition)

    if q and q.strip():
        search_term = f"%{escape_ilike(q.strip())}%"
        query = query.filter(or_(
            Crate.crate_number.ilike(search_term, escape="\\"),
            Crate.description.ilike(search_term, escape="\\"),
            Crate.materials.ilike(search_term, escape="\\"),
        ))

    query = query.order_by(Crate.crate_number.asc())
    total = query.count()
    crates = query.offset(offset).limit(limit).all()

    return {
        "items": [_serialize_crate(c) for c in crates],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("/api/organizations/{org_id}/collections/crates", response_model=CrateOut, status_code=201, summary="Create crate")
def create_crate(
    org_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_CREATE)),
    db: Session = Depends(get_db),
):
    """Create crate."""
    if not body.get("crate_number"):
        raise HTTPException(status_code=422, detail="Crate number is required")

    condition = body.get("condition")
    if condition and condition not in CrateCondition.ALL:
        raise HTTPException(status_code=422, detail=f"Invalid condition. Must be one of: {CrateCondition.ALL}")

    existing = db.query(Crate).filter(
        Crate.organization_id == org_id,
        Crate.crate_number == body["crate_number"],
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="A crate with this number already exists")

    crate = Crate(
        organization_id=org_id,
        crate_number=body["crate_number"],
        description=body.get("description"),
        height_cm=body.get("height_cm"),
        width_cm=body.get("width_cm"),
        depth_cm=body.get("depth_cm"),
        weight_empty_kg=body.get("weight_empty_kg"),
        interior_height_cm=body.get("interior_height_cm"),
        interior_width_cm=body.get("interior_width_cm"),
        interior_depth_cm=body.get("interior_depth_cm"),
        materials=body.get("materials"),
        condition=condition,
        climate_controlled=body.get("climate_controlled", False),
        is_stackable=body.get("is_stackable", True),
        is_oversized=body.get("is_oversized", False),
        location_id=body.get("location_id"),
        home_location_id=body.get("home_location_id"),
        is_active=body.get("is_active", True),
        notes=body.get("notes"),
        created_by=auth.user_id,
        updated_by=auth.user_id,
    )
    db.add(crate)
    db.commit()
    db.refresh(crate)

    return _serialize_crate(crate)


@router.get("/api/organizations/{org_id}/collections/crates/{crate_id}", response_model=CrateOut, summary="Get crate")
def get_crate(
    org_id: UUID,
    crate_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get crate."""
    crate = db.query(Crate).filter(
        Crate.crate_id == crate_id,
        Crate.organization_id == org_id,
    ).first()
    if not crate:
        raise HTTPException(status_code=404, detail="Crate not found")
    return _serialize_crate(crate)


@router.patch("/api/organizations/{org_id}/collections/crates/{crate_id}", response_model=CrateOut, summary="Update crate")
def update_crate(
    org_id: UUID,
    crate_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Update crate."""
    crate = db.query(Crate).filter(
        Crate.crate_id == crate_id,
        Crate.organization_id == org_id,
    ).first()
    if not crate:
        raise HTTPException(status_code=404, detail="Crate not found")

    if "condition" in body and body["condition"] is not None and body["condition"] not in CrateCondition.ALL:
        raise HTTPException(status_code=422, detail="Invalid condition")

    if "crate_number" in body and body["crate_number"] != crate.crate_number:
        existing = db.query(Crate).filter(
            Crate.organization_id == org_id,
            Crate.crate_number == body["crate_number"],
            Crate.crate_id != crate_id,
        ).first()
        if existing:
            raise HTTPException(status_code=409, detail="A crate with this number already exists")

    updatable = [
        "crate_number", "description",
        "height_cm", "width_cm", "depth_cm", "weight_empty_kg",
        "interior_height_cm", "interior_width_cm", "interior_depth_cm",
        "materials", "condition",
        "climate_controlled", "is_stackable", "is_oversized",
        "location_id", "home_location_id",
        "is_active", "notes",
    ]
    for field in updatable:
        if field in body:
            setattr(crate, field, body[field])

    crate.updated_at = datetime.now(timezone.utc)
    crate.updated_by = auth.user_id
    db.commit()
    db.refresh(crate)

    return _serialize_crate(crate)


@router.delete("/api/organizations/{org_id}/collections/crates/{crate_id}", summary="Delete crate")
def delete_crate(
    org_id: UUID,
    crate_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete crate."""
    crate = db.query(Crate).filter(
        Crate.crate_id == crate_id,
        Crate.organization_id == org_id,
    ).first()
    if not crate:
        raise HTTPException(status_code=404, detail="Crate not found")

    crate.is_active = False
    crate.updated_at = datetime.now(timezone.utc)
    crate.updated_by = auth.user_id
    db.commit()

    return Response(status_code=204)
