"""
Barcode & Inventory API endpoints (FastAPI).

Provides barcode label management, scan transaction logging,
barcode resolution, and inventory statistics.

Migrated from app/api/barcodes.py.
"""

import uuid as uuid_mod
from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.models import (
    AuditCampaign,
    AuditResult,
    BarcodeLabel,
    BarcodeScan,
    CollectionObject,
    Location,
    ObjectPart,
    Organization,
)
from app.models.locations import Movement
from app.permissions import Permission
from app.services.api_security import escape_ilike
from app.fastapi_app.schemas.common import DeletedResponse
from app.fastapi_app.schemas.barcodes import (
    BarcodeLabelListResponse,
    BarcodeLabelOut,
    BarcodeLabelBatchResponse,
    BarcodeScanOut,
    BarcodeScanListResponse,
    BarcodeLookupResponse,
    BarcodeStatsResponse,
    BarcodeEnumsResponse,
    CreateLabelRequest,
    CreateLabelsBatchRequest,
    UpdateLabelRequest,
    PerformScanRequest,
)

# Actions that require a scan location to be meaningful
LOCATION_REQUIRED_ACTIONS = {"verify", "move", "checkin"}

router = APIRouter(tags=["barcodes"])


# ============================================================================
# Helpers — movement reference numbers
# ============================================================================


def _next_movement_ref(db: Session, org_id) -> str:
    year = datetime.now(timezone.utc).year
    prefix = f"M.{year}."
    latest = db.query(
        func.max(Movement.movement_reference_number),
    ).filter(
        Movement.organization_id == str(org_id),
        Movement.movement_reference_number.like(f"{prefix}%"),
    ).scalar()
    last_num = 0
    if latest:
        try:
            last_num = int(latest.split(".")[-1])
        except (ValueError, IndexError):
            pass
    return f"{prefix}{last_num + 1:04d}"


# ============================================================================
# Constants / enums
# ============================================================================


from enum import StrEnum


class EntityType(StrEnum):
    COLLECTION_OBJECT = "collection_object"
    OBJECT_PART = "object_part"
    LOCATION = "location"
    CRATE = "crate"


ENTITY_TYPE_LABELS = {e.value: e.value.replace("_", " ").title() for e in EntityType}


class LabelFormat(StrEnum):
    CODE128 = "code128"
    QR = "qr"
    DATAMATRIX = "datamatrix"
    EAN13 = "ean13"
    CODE39 = "code39"


LABEL_FORMAT_LABELS = {
    "code128": "Code 128",
    "qr": "QR Code",
    "datamatrix": "Data Matrix",
    "ean13": "EAN-13",
    "code39": "Code 39",
}


class LabelStatus(StrEnum):
    ACTIVE = "active"
    VOID = "void"


LABEL_STATUS_LABELS = {"active": "Active", "void": "Void"}


class ScanActionType(StrEnum):
    VERIFY = "verify"
    MOVE = "move"
    AUDIT = "audit"
    LOOKUP = "lookup"
    CHECKOUT = "checkout"
    CHECKIN = "checkin"


SCAN_ACTION_LABELS = {
    "verify": "Verify",
    "move": "Move",
    "audit": "Audit",
    "lookup": "Lookup",
    "checkout": "Check Out",
    "checkin": "Check In",
}


class ScanResultStatus(StrEnum):
    SUCCESS = "success"
    NOT_FOUND = "not_found"
    MISMATCH = "mismatch"
    ERROR = "error"


SCAN_RESULT_LABELS = {
    "success": "Success",
    "not_found": "Not Found",
    "mismatch": "Mismatch",
    "error": "Error",
}


ENTITY_PREFIX = {
    "collection_object": "OBJ",
    "object_part": "PRT",
    "location": "LOC",
    "crate": "CRT",
}


# ============================================================================
# Helpers
# ============================================================================


def generate_barcode_value(db: Session, org_id, entity_type: str) -> str:
    from app.services.sequence import next_sequential_number
    prefix = ENTITY_PREFIX.get(entity_type, "UNK")
    return next_sequential_number(
        db, org_id, f"BC-{prefix}", include_year=False, separator='-', pad=6,
    )


def _build_public_url(request: Request, db: Session, org_id, entity_type: str, entity_id) -> str | None:
    """Build a public Discover URL for a discoverable collection object."""
    if entity_type != "collection_object":
        return None
    obj = db.query(CollectionObject).filter(
        CollectionObject.object_id == entity_id,
    ).first()
    if not obj or not obj.is_discoverable:
        return None
    org = db.query(Organization).filter(
        Organization.organization_id == str(org_id),
    ).first()
    if not org:
        return None
    identifier = obj.object_number or str(obj.object_id)
    base = str(request.base_url).rstrip("/")
    return f"{base}/c/{org.slug}/objects/{identifier}"


def _extract_barcode_from_url(value: str, db: Session, org_id) -> str | None:
    """If value is a public Discover URL, extract the object identifier and resolve it."""
    import re
    # Match /c/<slug>/objects/<identifier> in a URL
    m = re.search(r"/c/[^/]+/objects/([^/?#]+)", value)
    if not m:
        return None
    identifier = m.group(1)
    # Try to find the object by object_number or object_id
    obj = db.query(CollectionObject).filter(
        CollectionObject.organization_id == str(org_id),
        CollectionObject.object_number == identifier,
    ).first()
    if not obj:
        try:
            obj = db.query(CollectionObject).filter(
                CollectionObject.organization_id == str(org_id),
                CollectionObject.object_id == identifier,
            ).first()
        except Exception:
            pass
    if not obj:
        return None
    # Check if the object has an active barcode label
    label = db.query(BarcodeLabel).filter(
        BarcodeLabel.organization_id == str(org_id),
        BarcodeLabel.entity_type == "collection_object",
        BarcodeLabel.entity_id == str(obj.object_id),
        BarcodeLabel.status == "active",
    ).first()
    if label:
        return label.barcode_value
    # Fall back to the object's barcode field
    if obj.barcode:
        return obj.barcode
    # Return a sentinel so resolve_barcode can find the object directly
    return f"__object_id__{obj.object_id}"


def resolve_barcode(db: Session, org_id, barcode_value: str):
    # If the scanned value is a URL (public gallery QR), extract the identifier
    if barcode_value.startswith("http://") or barcode_value.startswith("https://"):
        extracted = _extract_barcode_from_url(barcode_value, db, org_id)
        if extracted and extracted.startswith("__object_id__"):
            # Direct object match from URL — resolve without barcode label
            oid = extracted.replace("__object_id__", "")
            obj = db.query(CollectionObject).filter(
                CollectionObject.object_id == oid,
            ).first()
            if obj:
                return ("collection_object", str(obj.object_id), {
                    "object_number": obj.object_number,
                    "title": obj.title_links[0].title if obj.title_links else None,
                })
        elif extracted:
            barcode_value = extracted  # Continue with the extracted barcode value

    label = db.query(BarcodeLabel).filter(
        BarcodeLabel.organization_id == str(org_id),
        BarcodeLabel.barcode_value == barcode_value,
        BarcodeLabel.status == "active",
    ).first()

    if label:
        summary = _get_entity_summary(db, label.entity_type, label.entity_id)
        return (label.entity_type, str(label.entity_id), summary)

    # Direct UUID lookup — QR codes encode the entity's primary key
    from uuid import UUID as _UUID
    try:
        scanned_uuid = str(_UUID(barcode_value))
        # Try collection object
        obj = db.query(CollectionObject).filter(
            CollectionObject.object_id == scanned_uuid,
        ).first()
        if obj:
            return ("collection_object", str(obj.object_id), {
                "object_number": obj.object_number,
                "title": obj.title_links[0].title if obj.title_links else None,
            })
        # Try object part
        part = db.query(ObjectPart).filter(
            ObjectPart.part_id == scanned_uuid,
        ).first()
        if part:
            return ("object_part", str(part.part_id), {
                "part_name": part.name if hasattr(part, "name") else None,
            })
        # Try location
        loc = db.query(Location).filter(
            Location.location_id == scanned_uuid,
        ).first()
        if loc:
            return ("location", str(loc.location_id), {
                "name": loc.name,
                "code": loc.code,
            })
    except ValueError:
        pass  # Not a UUID — fall through

    return None


def _get_entity_summary(db: Session, entity_type: str, entity_id) -> dict:
    if entity_type == "collection_object":
        obj = db.query(CollectionObject).filter(
            CollectionObject.object_id == entity_id,
        ).first()
        if obj:
            return {
                "object_number": obj.object_number,
                "title": obj.title_links[0].title if obj.title_links else None,
            }
    elif entity_type == "object_part":
        part = db.query(ObjectPart).filter(
            ObjectPart.part_id == entity_id,
        ).first()
        if part:
            return {"part_name": part.name if hasattr(part, "name") else None}
    elif entity_type == "location":
        loc = db.query(Location).filter(
            Location.location_id == entity_id,
        ).first()
        if loc:
            return {"name": loc.name, "code": loc.code}
    return {}


def serialize_label(label: BarcodeLabel) -> dict:
    return {
        "label_id": str(label.label_id),
        "organization_id": str(label.organization_id),
        "department_id": str(label.department_id) if label.department_id else None,
        "entity_type": label.entity_type,
        "entity_type_label": ENTITY_TYPE_LABELS.get(label.entity_type, label.entity_type),
        "entity_id": str(label.entity_id),
        "barcode_value": label.barcode_value,
        "label_format": label.label_format,
        "label_format_label": LABEL_FORMAT_LABELS.get(label.label_format, label.label_format),
        "is_printed": label.is_printed,
        "print_count": label.print_count,
        "last_printed_at": label.last_printed_at.isoformat() if label.last_printed_at else None,
        "batch_id": str(label.batch_id) if label.batch_id else None,
        "status": label.status,
        "status_label": LABEL_STATUS_LABELS.get(label.status, label.status),
        "note": label.note,
        "created_at": label.created_at.isoformat() if label.created_at else None,
        "updated_at": label.updated_at.isoformat() if label.updated_at else None,
        "created_by": str(label.created_by_id) if label.created_by_id else None,
        "updated_by": str(label.updated_by_id) if label.updated_by_id else None,
    }


def serialize_scan(scan: BarcodeScan) -> dict:
    return {
        "scan_id": str(scan.scan_id),
        "organization_id": str(scan.organization_id),
        "department_id": str(scan.department_id) if scan.department_id else None,
        "barcode_value": scan.barcode_value,
        "resolved_entity_type": scan.resolved_entity_type,
        "resolved_entity_type_label": ENTITY_TYPE_LABELS.get(scan.resolved_entity_type, scan.resolved_entity_type) if scan.resolved_entity_type else None,
        "resolved_entity_id": str(scan.resolved_entity_id) if scan.resolved_entity_id else None,
        "action_type": scan.action_type,
        "action_type_label": SCAN_ACTION_LABELS.get(scan.action_type, scan.action_type),
        "scan_location_id": str(scan.scan_location_id) if scan.scan_location_id else None,
        "device_id": scan.device_id,
        "device_name": scan.device_name,
        "campaign_id": str(scan.campaign_id) if scan.campaign_id else None,
        "movement_id": str(scan.movement_id) if scan.movement_id else None,
        "result_status": scan.result_status,
        "result_status_label": SCAN_RESULT_LABELS.get(scan.result_status, scan.result_status),
        "note": scan.note,
        "scanned_at": scan.scanned_at.isoformat() if scan.scanned_at else None,
        "scanned_by": str(scan.scanned_by) if scan.scanned_by else None,
    }


# ============================================================================
# LABEL CRUD
# ============================================================================


@router.get("/api/organizations/{org_id}/collections/barcodes/labels", response_model=BarcodeLabelListResponse, summary="List labels")
def list_labels(
    org_id: UUID,
    entity_type: str = Query(None),
    status: str = Query(None),
    batch_id: str = Query(None),
    q: str = Query(""),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """List barcode labels with filters, search, and pagination."""
    query = db.query(BarcodeLabel).filter(BarcodeLabel.organization_id == str(org_id))

    if entity_type and entity_type in list(EntityType):
        query = query.filter(BarcodeLabel.entity_type == entity_type)
    if status and status in list(LabelStatus):
        query = query.filter(BarcodeLabel.status == status)
    if batch_id:
        query = query.filter(BarcodeLabel.batch_id == batch_id)

    q = q.strip()
    if q:
        search_term = f"%{escape_ilike(q)}%"
        query = query.filter(or_(
            BarcodeLabel.barcode_value.ilike(search_term, escape="\\"),
            BarcodeLabel.note.ilike(search_term, escape="\\"),
        ))

    query = query.order_by(BarcodeLabel.created_at.desc())
    total = query.count()
    labels = query.offset(offset).limit(limit).all()

    all_q = db.query(BarcodeLabel).filter(BarcodeLabel.organization_id == str(org_id))
    total_active = all_q.filter(BarcodeLabel.status == "active").count()
    total_void = all_q.filter(BarcodeLabel.status == "void").count()
    total_printed = all_q.filter(BarcodeLabel.is_printed == True).count()
    total_unprinted = all_q.filter(BarcodeLabel.is_printed == False, BarcodeLabel.status == "active").count()

    results = []
    for label in labels:
        data = serialize_label(label)
        data["entity_summary"] = _get_entity_summary(db, label.entity_type, label.entity_id)
        results.append(data)

    return {
        "items": results,
        "summary": {
            "total_active": total_active,
            "total_void": total_void,
            "total_printed": total_printed,
            "total_unprinted": total_unprinted,
        },
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("/api/organizations/{org_id}/collections/barcodes/labels", response_model=BarcodeLabelOut, status_code=201, summary="Create label")
def create_label(
    org_id: UUID,
    body: CreateLabelRequest,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Create a single barcode label."""
    if body.entity_type not in list(EntityType):
        raise HTTPException(status_code=422, detail=f"Invalid entity_type. Must be one of: {list(EntityType)}")

    if body.label_format not in list(LabelFormat):
        raise HTTPException(status_code=422, detail=f"Invalid label_format. Must be one of: {list(LabelFormat)}")

    barcode_value = body.barcode_value or generate_barcode_value(db, org_id, body.entity_type)

    existing = db.query(BarcodeLabel).filter(
        BarcodeLabel.organization_id == str(org_id),
        BarcodeLabel.barcode_value == barcode_value,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail=f'Barcode value "{barcode_value}" already exists in this organization')

    label = BarcodeLabel(
        organization_id=str(org_id),
        department_id=str(body.department_id) if body.department_id else None,
        entity_type=body.entity_type,
        entity_id=str(body.entity_id),
        barcode_value=barcode_value,
        label_format=body.label_format,
        note=body.note,
        created_by_id=auth.user_id,
        updated_by_id=auth.user_id,
    )

    db.add(label)
    db.commit()
    db.refresh(label)

    result = serialize_label(label)
    result["entity_summary"] = _get_entity_summary(db, label.entity_type, label.entity_id)
    if label.label_format in ("qr", "datamatrix"):
        result["public_url"] = _build_public_url(request, db, org_id, label.entity_type, label.entity_id)
    return result


@router.post("/api/organizations/{org_id}/collections/barcodes/labels/batch", response_model=BarcodeLabelBatchResponse, status_code=201, summary="Create labels batch")
def create_labels_batch(
    org_id: UUID,
    body: CreateLabelsBatchRequest,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Batch generate barcode labels for multiple entities."""
    if body.label_format not in list(LabelFormat):
        raise HTTPException(status_code=422, detail=f"Invalid label_format. Must be one of: {list(LabelFormat)}")

    batch_id = uuid_mod.uuid4()
    created_labels = []

    for entry in body.entries:
        if entry.entity_type not in list(EntityType):
            continue

        barcode_value = generate_barcode_value(db, org_id, entry.entity_type)

        label = BarcodeLabel(
            organization_id=str(org_id),
            department_id=str(body.department_id) if body.department_id else None,
            entity_type=entry.entity_type,
            entity_id=str(entry.entity_id),
            barcode_value=barcode_value,
            label_format=body.label_format,
            batch_id=batch_id,
            created_by_id=auth.user_id,
            updated_by_id=auth.user_id,
        )
        db.add(label)
        created_labels.append(label)

    db.commit()

    results = []
    for label in created_labels:
        db.refresh(label)
        result = serialize_label(label)
        result["entity_summary"] = _get_entity_summary(db, label.entity_type, label.entity_id)
        results.append(result)

    return {
        "labels": results,
        "batch_id": str(batch_id),
        "count": len(results),
    }


@router.get("/api/organizations/{org_id}/collections/barcodes/labels/{label_id}", response_model=BarcodeLabelOut, summary="Get label")
def get_label(
    org_id: UUID,
    label_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get a single barcode label with entity summary."""
    label = db.query(BarcodeLabel).filter(
        BarcodeLabel.label_id == label_id,
        BarcodeLabel.organization_id == str(org_id),
    ).first()

    if not label:
        raise HTTPException(status_code=404, detail="BarcodeLabel not found")

    result = serialize_label(label)
    result["entity_summary"] = _get_entity_summary(db, label.entity_type, label.entity_id)
    if label.label_format in ("qr", "datamatrix"):
        result["public_url"] = _build_public_url(request, db, org_id, label.entity_type, label.entity_id)
    return result


@router.patch("/api/organizations/{org_id}/collections/barcodes/labels/{label_id}", response_model=BarcodeLabelOut, summary="Update label")
def update_label(
    org_id: UUID,
    label_id: UUID,
    body: UpdateLabelRequest,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Update a barcode label (void, notes)."""
    label = db.query(BarcodeLabel).filter(
        BarcodeLabel.label_id == label_id,
        BarcodeLabel.organization_id == str(org_id),
    ).first()

    if not label:
        raise HTTPException(status_code=404, detail="BarcodeLabel not found")

    if body.status is not None:
        if body.status not in list(LabelStatus):
            raise HTTPException(status_code=422, detail=f"Invalid status. Must be one of: {list(LabelStatus)}")
        label.status = body.status

    if body.note is not None:
        label.note = body.note

    if body.label_format is not None:
        if body.label_format not in list(LabelFormat):
            raise HTTPException(status_code=422, detail=f"Invalid label_format. Must be one of: {list(LabelFormat)}")
        label.label_format = body.label_format

    label.updated_by_id = auth.user_id
    db.commit()
    db.refresh(label)

    result = serialize_label(label)
    result["entity_summary"] = _get_entity_summary(db, label.entity_type, label.entity_id)
    return result


@router.delete("/api/organizations/{org_id}/collections/barcodes/labels/{label_id}", response_model=DeletedResponse, summary="Delete label")
def delete_label(
    org_id: UUID,
    label_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete a barcode label."""
    label = db.query(BarcodeLabel).filter(
        BarcodeLabel.label_id == label_id,
        BarcodeLabel.organization_id == str(org_id),
    ).first()

    if not label:
        raise HTTPException(status_code=404, detail="BarcodeLabel not found")

    db.delete(label)
    db.commit()
    return {"deleted": True}


@router.post("/api/organizations/{org_id}/collections/barcodes/labels/{label_id}/print", response_model=BarcodeLabelOut, summary="Mark printed")
def mark_printed(
    org_id: UUID,
    label_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Mark a label as printed and increment print count."""
    label = db.query(BarcodeLabel).filter(
        BarcodeLabel.label_id == label_id,
        BarcodeLabel.organization_id == str(org_id),
    ).first()

    if not label:
        raise HTTPException(status_code=404, detail="BarcodeLabel not found")

    label.is_printed = True
    label.print_count += 1
    label.last_printed_at = datetime.now(timezone.utc)
    label.updated_by_id = auth.user_id

    db.commit()
    db.refresh(label)

    result = serialize_label(label)
    result["entity_summary"] = _get_entity_summary(db, label.entity_type, label.entity_id)
    return result


# ============================================================================
# SCAN ENDPOINTS
# ============================================================================


@router.post("/api/organizations/{org_id}/collections/barcodes/scan", response_model=BarcodeScanOut, status_code=201, summary="Perform scan")
def perform_scan(
    org_id: UUID,
    body: PerformScanRequest,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Core scan endpoint: resolve barcode and execute the requested action."""
    barcode_value = body.barcode_value

    action_type = body.action_type
    if action_type not in list(ScanActionType):
        raise HTTPException(status_code=422, detail=f"Invalid action_type. Must be one of: {list(ScanActionType)}")

    scan_location_id = str(body.scan_location_id) if body.scan_location_id else None

    # Some actions are meaningless without a location
    if action_type in LOCATION_REQUIRED_ACTIONS and not scan_location_id:
        raise HTTPException(
            status_code=422,
            detail=f"Scan location is required for '{action_type}' action",
        )

    resolved = resolve_barcode(db, org_id, barcode_value)

    resolved_entity_type = None
    resolved_entity_id = None
    entity_summary = {}
    result_status = "not_found"
    action_detail = {}

    if resolved:
        resolved_entity_type, resolved_entity_id, entity_summary = resolved
        result_status = "success"

    # Load the object for actions that modify it
    obj = None
    if resolved and resolved_entity_type == "collection_object":
        obj = db.query(CollectionObject).filter(
            CollectionObject.object_id == resolved_entity_id,
        ).first()

    # ── Verify ───────────────────────────────────────────────────────
    # Compare where the object thinks it is vs where it was just scanned.
    if action_type == "verify" and obj:
        expected = str(obj.current_location_id) if obj.current_location_id else None
        actual = str(scan_location_id)
        if expected and expected != actual:
            result_status = "mismatch"
            # Look up names for the response
            expected_loc = db.query(Location).filter(Location.location_id == expected).first()
            action_detail["expected_location"] = expected_loc.name if expected_loc else expected
            scan_loc = db.query(Location).filter(Location.location_id == actual).first()
            action_detail["actual_location"] = scan_loc.name if scan_loc else actual
        elif not expected:
            # Object has no recorded location — record where we found it
            obj.current_location_id = scan_location_id
            obj.current_location_date = datetime.now(timezone.utc)
            action_detail["note"] = "No prior location recorded; set to scan location"
        obj.last_inventoried_date = date.today()
        obj.last_inventoried_by = auth.user_id

    # ── Move ─────────────────────────────────────────────────────────
    # Physically relocate the object. Creates a Movement record.
    if action_type == "move" and obj:
        from_location_id = obj.current_location_id
        mov = Movement(
            organization_id=str(org_id),
            movement_reference_number=_next_movement_ref(db, org_id),
            object_id=obj.object_id,
            from_location_id=from_location_id,
            to_location_id=scan_location_id,
            movement_date=datetime.now(timezone.utc),
            reason="inventory",
            movement_note=f"Moved via barcode scan ({barcode_value})",
            status="completed",
            moved_by=auth.user_id,
            created_by=auth.user_id,
        )
        db.add(mov)
        obj.current_location_id = scan_location_id
        obj.current_location_date = datetime.now(timezone.utc)
        action_detail["movement_ref"] = mov.movement_reference_number
        from_loc = db.query(Location).filter(Location.location_id == from_location_id).first() if from_location_id else None
        to_loc = db.query(Location).filter(Location.location_id == scan_location_id).first()
        action_detail["from_location"] = from_loc.name if from_loc else None
        action_detail["to_location"] = to_loc.name if to_loc else str(scan_location_id)

    # ── Audit ────────────────────────────────────────────────────────
    # Verify object against an inventory campaign.
    if action_type == "audit" and obj:
        obj.last_inventoried_date = date.today()
        obj.last_inventoried_by = auth.user_id

        if body.campaign_id:
            campaign = db.query(AuditCampaign).filter(
                AuditCampaign.campaign_id == body["campaign_id"],
                AuditCampaign.organization_id == str(org_id),
            ).first()

            if campaign:
                # Check location match if scan location provided
                location_ok = True
                if scan_location_id and obj.current_location_id:
                    location_ok = str(obj.current_location_id) == str(scan_location_id)

                audit_result = AuditResult(
                    campaign_id=campaign.campaign_id,
                    organization_id=str(org_id),
                    object_id=resolved_entity_id,
                    location_id=scan_location_id,
                    verified=True,
                    verified_by_id=auth.user_id,
                    actual_location_id=scan_location_id,
                    result_status="verified" if location_ok else "location_discrepancy",
                )
                db.add(audit_result)
                campaign.objects_audited += 1
                if location_ok:
                    campaign.objects_verified += 1
                else:
                    campaign.objects_location_discrepancy += 1
                    result_status = "mismatch"

    # ── Check Out ────────────────────────────────────────────────────
    # Object is leaving its location. Record where it was.
    if action_type == "checkout" and obj:
        if not obj.current_location_id:
            action_detail["note"] = "Object has no recorded location"
        else:
            from_loc = db.query(Location).filter(
                Location.location_id == obj.current_location_id,
            ).first()
            action_detail["from_location"] = from_loc.name if from_loc else str(obj.current_location_id)
        action_detail["checked_out_by"] = str(auth.user_id)
        obj.current_location_id = None
        obj.current_location_date = datetime.now(timezone.utc)
        obj.current_location_note = f"Checked out via scan by user {auth.user_id}"

    # ── Check In ─────────────────────────────────────────────────────
    # Object is returned to a location. Creates a Movement record.
    if action_type == "checkin" and obj:
        from_location_id = obj.current_location_id  # might be None if checked out
        mov = Movement(
            organization_id=str(org_id),
            movement_reference_number=_next_movement_ref(db, org_id),
            object_id=obj.object_id,
            from_location_id=from_location_id,
            to_location_id=scan_location_id,
            movement_date=datetime.now(timezone.utc),
            reason="inventory",
            movement_note=f"Checked in via barcode scan ({barcode_value})",
            status="completed",
            moved_by=auth.user_id,
            created_by=auth.user_id,
        )
        db.add(mov)
        obj.current_location_id = scan_location_id
        obj.current_location_date = datetime.now(timezone.utc)
        obj.current_location_note = None
        action_detail["movement_ref"] = mov.movement_reference_number
        to_loc = db.query(Location).filter(Location.location_id == scan_location_id).first()
        action_detail["to_location"] = to_loc.name if to_loc else str(scan_location_id)

    # ── Log the scan ─────────────────────────────────────────────────
    scan = BarcodeScan(
        organization_id=str(org_id),
        department_id=body.department_id,
        barcode_value=barcode_value,
        resolved_entity_type=resolved_entity_type,
        resolved_entity_id=resolved_entity_id,
        action_type=action_type,
        scan_location_id=scan_location_id,
        device_id=body.device_id,
        device_name=body.device_name,
        campaign_id=body.campaign_id if action_type == "audit" else None,
        result_status=result_status,
        note=body.note,
        scanned_by=auth.user_id,
    )
    db.add(scan)

    db.commit()
    db.refresh(scan)

    result = serialize_scan(scan)
    result["entity_summary"] = entity_summary
    if action_detail:
        result["action_detail"] = action_detail
    return result


@router.get("/api/organizations/{org_id}/collections/barcodes/scans", response_model=BarcodeScanListResponse, summary="List scans")
def list_scans(
    org_id: UUID,
    action_type: str = Query(None),
    result_status: str = Query(None),
    campaign_id: str = Query(None),
    device_id: str = Query(None),
    date_from: str = Query(None),
    date_to: str = Query(None),
    q: str = Query(""),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """List scan history with filters."""
    query = db.query(BarcodeScan).filter(BarcodeScan.organization_id == str(org_id))

    if action_type and action_type in list(ScanActionType):
        query = query.filter(BarcodeScan.action_type == action_type)
    if result_status and result_status in list(ScanResultStatus):
        query = query.filter(BarcodeScan.result_status == result_status)
    if campaign_id:
        query = query.filter(BarcodeScan.campaign_id == campaign_id)
    if device_id:
        query = query.filter(BarcodeScan.device_id == device_id)
    if date_from:
        query = query.filter(BarcodeScan.scanned_at >= date_from)
    if date_to:
        query = query.filter(BarcodeScan.scanned_at <= date_to)

    q = q.strip()
    if q:
        search_term = f"%{escape_ilike(q)}%"
        query = query.filter(BarcodeScan.barcode_value.ilike(search_term, escape="\\"))

    query = query.order_by(BarcodeScan.scanned_at.desc())
    total = query.count()
    scans = query.offset(offset).limit(limit).all()

    return {
        "items": [serialize_scan(s) for s in scans],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/api/organizations/{org_id}/collections/barcodes/scans/{scan_id}", response_model=BarcodeScanOut, summary="Get scan")
def get_scan(
    org_id: UUID,
    scan_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get a single scan detail."""
    scan = db.query(BarcodeScan).filter(
        BarcodeScan.scan_id == scan_id,
        BarcodeScan.organization_id == str(org_id),
    ).first()

    if not scan:
        raise HTTPException(status_code=404, detail="BarcodeScan not found")

    result = serialize_scan(scan)
    if scan.resolved_entity_type and scan.resolved_entity_id:
        result["entity_summary"] = _get_entity_summary(
            db, scan.resolved_entity_type, scan.resolved_entity_id,
        )
    return result


# ============================================================================
# LOOKUP
# ============================================================================


@router.get("/api/organizations/{org_id}/collections/barcodes/lookup/{barcode_value}", response_model=BarcodeLookupResponse, summary="Lookup barcode")
def lookup_barcode(
    org_id: UUID,
    barcode_value: str,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Resolve a barcode to an entity with summary."""
    resolved = resolve_barcode(db, org_id, barcode_value)

    if not resolved:
        raise HTTPException(status_code=404, detail="Barcode not found")

    entity_type, entity_id, entity_summary = resolved
    return {
        "found": True,
        "barcode_value": barcode_value,
        "entity_type": entity_type,
        "entity_type_label": ENTITY_TYPE_LABELS.get(entity_type, entity_type),
        "entity_id": entity_id,
        "entity_summary": entity_summary,
    }


# ============================================================================
# STATS
# ============================================================================


@router.get("/api/organizations/{org_id}/collections/barcodes/stats", response_model=BarcodeStatsResponse, summary="Get stats")
def get_stats(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get barcode/inventory statistics."""
    labels_active = db.query(func.count(BarcodeLabel.label_id)).filter(
        BarcodeLabel.organization_id == str(org_id),
        BarcodeLabel.status == "active",
    ).scalar() or 0

    labels_void = db.query(func.count(BarcodeLabel.label_id)).filter(
        BarcodeLabel.organization_id == str(org_id),
        BarcodeLabel.status == "void",
    ).scalar() or 0

    today = date.today()
    scans_today = db.query(func.count(BarcodeScan.scan_id)).filter(
        BarcodeScan.organization_id == str(org_id),
        func.date(BarcodeScan.scanned_at) == today,
    ).scalar() or 0

    week_ago = today - timedelta(days=7)
    scans_this_week = db.query(func.count(BarcodeScan.scan_id)).filter(
        BarcodeScan.organization_id == str(org_id),
        func.date(BarcodeScan.scanned_at) >= week_ago,
    ).scalar() or 0

    unresolved_count = db.query(func.count(BarcodeScan.scan_id)).filter(
        BarcodeScan.organization_id == str(org_id),
        BarcodeScan.result_status == "not_found",
    ).scalar() or 0

    return {
        "labels_active": labels_active,
        "labels_void": labels_void,
        "scans_today": scans_today,
        "scans_this_week": scans_this_week,
        "unresolved_count": unresolved_count,
    }


# ============================================================================
# ENUMS
# ============================================================================


@router.get("/api/organizations/{org_id}/collections/barcodes/enums", response_model=BarcodeEnumsResponse, summary="Get enums")
def get_enums(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Return valid enum values for dropdowns."""
    return {
        "entity_types": [{"value": v, "label": ENTITY_TYPE_LABELS[v]} for v in list(EntityType)],
        "label_formats": [{"value": v, "label": LABEL_FORMAT_LABELS[v]} for v in list(LabelFormat)],
        "label_statuses": [{"value": v, "label": LABEL_STATUS_LABELS[v]} for v in list(LabelStatus)],
        "action_types": [{"value": v, "label": SCAN_ACTION_LABELS[v]} for v in list(ScanActionType)],
        "result_statuses": [{"value": v, "label": SCAN_RESULT_LABELS[v]} for v in list(ScanResultStatus)],
    }
