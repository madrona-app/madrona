"""
Object entry and acquisition endpoints (procedures) - FastAPI.

Manages object entries, entry media, and acquisition workflows.
"""

import logging
from datetime import date, datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, File, Request, UploadFile
from fastapi.responses import Response, JSONResponse
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_auth, require_permission
from app.models import (
    CollectionObject,
    CollectionObjectMedia,
    Media,
    MediaDerivative,
    ObjectEntry,
    ObjectEntryItem,
    ObjectEntryItemMedia,
    ObjectExit,
    Acquisition,
    AcquisitionObject,
)
from app.services.uploads import (
    MediaType,
    StorageLimitExceeded,
    upload_org_media,
    delete_org_media,
    get_org_media_url,
    detect_media_type,
)
from app.permissions import Permission
from app.services.api_security import escape_ilike, sanitize_error_message
from app.services.field_access_service import apply_field_access, get_write_restricted_fields
from app.serializers.media import _serialize_media
from app.services.entity_notifications import notify_status_change, notify_approval
from app.fastapi_app.serializers.collections import (
    _serialize_object_entry,
    _serialize_object_entry_item,
    _serialize_acquisition,
    _serialize_collection_object,
)
from app.fastapi_app.schemas.collections_procedures import (
    ObjectEntryListResponse,
    EntryMediaListResponse,
    EntryMediaAddedResponse,
    EntryMediaSetPrimaryResponse,
    AcquisitionListResponse,
    AcquisitionObjectOut,
    AcquisitionObjectListResponse,
    ObjectAcquisitionResponse,
)
from app.fastapi_app.schemas.common import MessageResponse
from app.services.procedure_enforcement import check_blocking_requirements

logger = logging.getLogger(__name__)

router = APIRouter(tags=["collections-procedures"])


def _enforce_procedure(organization_id: UUID, procedure_type: str, entity, target_status: str, db: Session):
    """Raise 422 if procedure enforcement is enabled and blocking requirements are unmet."""
    missing = check_blocking_requirements(organization_id, procedure_type, entity, target_status, db)
    if missing:
        raise HTTPException(status_code=422, detail={
            "code": "procedure_requirements_not_met",
            "message": f"Cannot advance to {target_status}: unmet requirements",
            "blocking_requirements": missing,
        })


# ============================================================================
# OBJECT ENTRY ENDPOINTS
# ============================================================================


@router.post("/api/organizations/{organization_id}/collections/entries", status_code=201, response_model=dict, summary="Create object entry")
def create_object_entry(
    organization_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_CREATE)),
    db: Session = Depends(get_db),
):
    """Create a new object entry record."""
    if not data.get("reason"):
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "Missing: reason",
            "field": "reason",
        })

    # Create via the shared service — the same code the draft applier runs.
    from app.services.collections.creation.object_entry import (
        create_object_entry as _create_object_entry,
    )

    try:
        entry = _create_object_entry(db, organization_id, data, auth.user_id, open_approval=True)
        db.commit()
    except ValueError as e:
        # Malformed field in the payload — bad input, not a server fault.
        db.rollback()
        raise HTTPException(
            status_code=400, detail={"code": "bad_request", "message": str(e)}
        ) from None
    except Exception:
        db.rollback()
        raise

    return _serialize_object_entry(entry)


@router.get("/api/organizations/{organization_id}/collections/entries", response_model=ObjectEntryListResponse, summary="List object entries")
def list_object_entries(
    organization_id: UUID,
    limit: int = Query(50, le=500),
    offset: int = Query(0),
    status: str | None = Query(None),
    reason: str | None = Query(None),
    q: str = Query(""),
    auth: AuthContext = Depends(require_permission(Permission.ENTRIES_VIEW)),
    db: Session = Depends(get_db),
):
    """List object entries with filtering and search."""
    query = db.query(ObjectEntry).filter(ObjectEntry.organization_id == organization_id)

    search = q.strip()
    if search:
        search_term = f"%{escape_ilike(search)}%"
        query = query.filter(
            or_(
                ObjectEntry.entry_number.ilike(search_term, escape="\\"),
                ObjectEntry.depositor_name.ilike(search_term, escape="\\"),
                ObjectEntry.current_owner.ilike(search_term, escape="\\"),
                ObjectEntry.objects_description.ilike(search_term, escape="\\"),
                ObjectEntry.entry_note.ilike(search_term, escape="\\"),
            )
        )
    if status:
        query = query.filter(ObjectEntry.status == status)
    if reason:
        query = query.filter(ObjectEntry.entry_reason == reason)

    total = query.count()
    entries = query.order_by(ObjectEntry.entry_date.desc()).offset(offset).limit(limit).all()

    serialized = [
        apply_field_access(_serialize_object_entry(e), 'object_entry', str(organization_id), str(auth.user_id), session=db, role_override=auth.role_override)
        for e in entries
    ]
    return {
        "items": serialized,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/api/organizations/{organization_id}/collections/entries/{entry_id}", response_model=dict, summary="Get object entry")
def get_object_entry(
    organization_id: UUID,
    entry_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.ENTRIES_VIEW)),
    db: Session = Depends(get_db),
):
    """Get a single object entry."""
    entry = db.query(ObjectEntry).filter(
        ObjectEntry.entry_id == entry_id,
        ObjectEntry.organization_id == organization_id,
    ).first()

    if not entry:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Object entry not found",
        })

    result = _serialize_object_entry(entry)

    # Include items ordered by item_number
    items = (
        db.query(ObjectEntryItem)
        .filter(ObjectEntryItem.entry_id == entry.entry_id)
        .order_by(ObjectEntryItem.item_number)
        .all()
    )
    result["items"] = [_serialize_object_entry_item(i) for i in items]

    filtered = apply_field_access(result, 'object_entry', str(organization_id), str(auth.user_id), session=db, role_override=auth.role_override)
    return filtered


@router.put("/api/organizations/{organization_id}/collections/entries/{entry_id}", response_model=dict, summary="Update object entry")
def update_object_entry(
    organization_id: UUID,
    entry_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.ENTRIES_EDIT)),
    db: Session = Depends(get_db),
):
    """Update an object entry."""
    entry = db.query(ObjectEntry).filter(
        ObjectEntry.entry_id == entry_id,
        ObjectEntry.organization_id == organization_id,
    ).first()

    if not entry:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Object entry not found",
        })

    # Map API field names to model attributes
    field_mapping = {'reason': 'entry_reason'}
    # Validate enum fields against the model's CHECK sets (map API->column names
    # and treat "" as NULL) so a bad entry_reason returns 422, not a 500.
    from app.services.collections.field_enums import validate_enum_fields
    validate_enum_fields(ObjectEntry, {
        field_mapping.get(k, k): (None if v == '' else v) for k, v in data.items()
    })

    # Optimistic concurrency — reject stale updates
    from app.services.coerce import check_version, coerce_value_for_column
    check_version(entry, data)

    # Handle status change separately with validation
    old_status = entry.status
    new_status = data.pop('status', None)

    protected_fields = {'entry_id', 'organization_id', 'entry_number', 'created_at', 'created_by', 'updated_by', 'version'}
    protected_fields |= get_write_restricted_fields('object_entry', str(organization_id), str(auth.user_id), session=db, role_override=auth.role_override)
    for key, value in data.items():
        attr_name = field_mapping.get(key, key)
        if hasattr(entry, attr_name) and key not in protected_fields:
            if value == '':
                value = None
            if attr_name.endswith('_id') and value:
                setattr(entry, attr_name, UUID(value))
            else:
                setattr(entry, attr_name, coerce_value_for_column(ObjectEntry, attr_name, value))

    if new_status and new_status != old_status:
        from app.services.workflow_definitions import WORKFLOW_DEFINITIONS
        workflow = WORKFLOW_DEFINITIONS.get('object_entry')
        if workflow and new_status not in workflow.valid_statuses:
            raise HTTPException(status_code=409, detail={"code": "invalid_status", "message": f"'{new_status}' is not a valid status"})
        _enforce_procedure(organization_id, "object_entry", entry, new_status, db)
        entry.status = new_status

    entry.updated_by = auth.user_id
    entry.updated_at = datetime.now(timezone.utc)


    db.commit()

    if new_status and new_status != old_status:
        notify_status_change(organization_id, 'object_entry', entry.entry_id, entry.entry_number,
                             old_status, new_status, str(auth.user_id), entity=entry)

    return _serialize_object_entry(entry)


@router.post(
    "/api/organizations/{organization_id}/collections/entries/{entry_id}/mark-returned",
    response_model=dict,
    summary="Mark entry as returned via signature on entry form (no separate Object Exit record)",
)
def mark_entry_returned(
    organization_id: UUID,
    entry_id: UUID,
    data: dict | None = None,
    auth: AuthContext = Depends(require_permission(Permission.ENTRIES_EDIT)),
    db: Session = Depends(get_db),
):
    """
    Object Exit Note 1 allows simple returns of unaccessioned
    deposits to be captured as a second signature on the original Object Entry
    form, without creating a separate Object Exit record. This endpoint is
    that lightweight path — it sets the entry's outcome, return_date, and
    transitions the status to 'returned', and records the returned-to name and
    a signature reference.

    Payload:
    - return_date (optional, ISO date — defaults to today)
    - returned_to (optional, string — name of person receiving the objects)
    - signature_reference (optional, string — paper form ref / media id)
    - outcome_note (optional, string)
    """
    data = data or {}
    entry = db.query(ObjectEntry).filter(
        ObjectEntry.entry_id == entry_id,
        ObjectEntry.organization_id == organization_id,
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Object entry not found",
        })

    from datetime import date as _date
    raw_date = data.get("return_date")
    if raw_date:
        try:
            entry.return_date = _date.fromisoformat(raw_date)
        except ValueError:
            raise HTTPException(status_code=422, detail={
                "code": "validation_error",
                "message": "return_date must be ISO date (YYYY-MM-DD)",
                "field": "return_date",
            })
    else:
        entry.return_date = datetime.now(timezone.utc).date()

    if "returned_to" in data:
        entry.returned_to = data.get("returned_to") or None
    if "outcome_note" in data:
        entry.outcome_note = data.get("outcome_note") or None
    if "signature_reference" in data:
        entry.signature_reference = data.get("signature_reference") or None

    # Procedure: this path explicitly does NOT create a separate Object Exit
    # record, so outcome_reference_id stays null.
    entry.outcome = "returned"
    entry.outcome_reference_id = None

    old_status = entry.status
    if entry.status != "returned":
        _enforce_procedure(UUID(str(organization_id)), "object_entry", entry, "returned", db)
        entry.status = "returned"

    entry.updated_by = auth.user_id
    entry.updated_at = datetime.now(timezone.utc)
    db.commit()

    if old_status != "returned":
        notify_status_change(
            UUID(str(organization_id)), 'object_entry', entry.entry_id, entry.entry_number,
            old_status, "returned", str(auth.user_id), entity=entry,
        )

    return _serialize_object_entry(entry)


# ============================================================================
# OBJECT ENTRY ITEMS
# ============================================================================

_ITEM_UPDATABLE_FIELDS = {
    'brief_description', 'detailed_description', 'lender_object_number',
    'declared_value', 'declared_value_currency',
    'condition_note', 'condition_report_id',
    'location_id',
    'item_status', 'item_outcome', 'item_outcome_note',
}


@router.post(
    "/api/organizations/{organization_id}/collections/entries/{entry_id}/items",
    status_code=201,
    response_model=dict,
    summary="Add item to object entry",
)
def add_object_entry_item(
    organization_id: UUID,
    entry_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.ENTRIES_EDIT)),
    db: Session = Depends(get_db),
):
    """Create an item on an object entry. Auto-assigns item_number."""
    from decimal import Decimal

    entry = db.query(ObjectEntry).filter(
        ObjectEntry.entry_id == entry_id,
        ObjectEntry.organization_id == organization_id,
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Object entry not found"})

    # Auto-assign item_number based on existing max
    max_num = db.query(func.max(ObjectEntryItem.item_number)).filter(
        ObjectEntryItem.entry_id == entry.entry_id,
    ).scalar() or 0

    declared_value = data.get("declared_value")
    item = ObjectEntryItem(
        entry_id=entry.entry_id,
        organization_id=organization_id,
        item_number=max_num + 1,
        brief_description=data.get("brief_description"),
        detailed_description=data.get("detailed_description"),
        lender_object_number=data.get("lender_object_number"),
        declared_value=Decimal(str(declared_value)) if declared_value is not None else None,
        declared_value_currency=data.get("declared_value_currency") or "USD",
        condition_note=data.get("condition_note"),
        item_status=data.get("item_status") or "pending",
    )
    db.add(item)
    db.commit()
    db.refresh(item)

    return _serialize_object_entry_item(item)


@router.put(
    "/api/organizations/{organization_id}/collections/entries/{entry_id}/items/{entry_item_id}",
    response_model=dict,
    summary="Update object entry item",
)
def update_object_entry_item(
    organization_id: UUID,
    entry_id: UUID,
    entry_item_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.ENTRIES_EDIT)),
    db: Session = Depends(get_db),
):
    """Update an entry item's fields."""
    from decimal import Decimal

    item = db.query(ObjectEntryItem).filter(
        ObjectEntryItem.entry_item_id == entry_item_id,
        ObjectEntryItem.entry_id == entry_id,
        ObjectEntryItem.organization_id == organization_id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Entry item not found"})

    for key, value in data.items():
        if key not in _ITEM_UPDATABLE_FIELDS:
            continue
        if value == "":
            value = None
        if key == "declared_value" and value is not None:
            value = Decimal(str(value))
        if key in ("condition_report_id", "location_id") and value is not None:
            value = UUID(str(value))
        setattr(item, key, value)

    db.commit()
    db.refresh(item)

    return _serialize_object_entry_item(item)


@router.delete(
    "/api/organizations/{organization_id}/collections/entries/{entry_id}/items/{entry_item_id}",
    summary="Remove item from object entry",
)
def remove_object_entry_item(
    organization_id: UUID,
    entry_id: UUID,
    entry_item_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.ENTRIES_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete an entry item."""
    item = db.query(ObjectEntryItem).filter(
        ObjectEntryItem.entry_item_id == entry_item_id,
        ObjectEntryItem.entry_id == entry_id,
        ObjectEntryItem.organization_id == organization_id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Entry item not found"})

    db.delete(item)
    db.commit()

    return {"success": True}


@router.post("/api/organizations/{organization_id}/collections/entries/{entry_id}/receive", response_model=dict, summary="Receive object entry")
def receive_object_entry(
    organization_id: UUID,
    entry_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.ENTRIES_EDIT)),
    db: Session = Depends(get_db),
):
    """Mark objects as received."""
    entry = db.query(ObjectEntry).filter(
        ObjectEntry.entry_id == entry_id,
        ObjectEntry.organization_id == organization_id,
    ).first()

    if not entry:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Object entry not found",
        })

    from app.services.status_transitions import require_status, InvalidTransitionError
    _enforce_procedure(organization_id, "object_entry", entry, "received", db)
    try:
        require_status(entry, ["pending", "in_transit"], "receive")
    except InvalidTransitionError as e:
        raise HTTPException(status_code=409, detail={"code": "invalid_transition", "message": str(e)})

    old_status = entry.status
    entry.status = "received"
    entry.updated_by = auth.user_id
    entry.updated_at = datetime.now(timezone.utc)

    db.commit()

    notify_status_change(organization_id, 'object_entry', entry.entry_id, entry.entry_number,
                         old_status, 'received', str(auth.user_id), entity=entry)

    return _serialize_object_entry(entry)


@router.post("/api/organizations/{organization_id}/collections/entries/{entry_id}/process", response_model=dict, summary="Process object entry")
def process_object_entry(
    organization_id: UUID,
    entry_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.ENTRIES_EDIT)),
    db: Session = Depends(get_db),
):
    """Mark entry as processed."""
    entry = db.query(ObjectEntry).filter(
        ObjectEntry.entry_id == entry_id,
        ObjectEntry.organization_id == organization_id,
    ).first()

    if not entry:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Object entry not found",
        })

    _enforce_procedure(organization_id, "object_entry", entry, "processed", db)
    from app.services.status_transitions import require_status, InvalidTransitionError
    try:
        require_status(entry, ["received"], "process")
    except InvalidTransitionError as e:
        raise HTTPException(status_code=409, detail={"code": "invalid_transition", "message": str(e)})

    user_uuid = auth.user_id
    old_status = entry.status
    entry.status = "processed"
    entry.processed_date = datetime.now(timezone.utc).date()
    entry.processed_by = user_uuid
    entry.updated_by = user_uuid
    entry.updated_at = datetime.now(timezone.utc)

    db.commit()

    notify_status_change(organization_id, 'object_entry', entry.entry_id, entry.entry_number,
                         old_status, 'processed', str(auth.user_id), entity=entry)

    return _serialize_object_entry(entry)


@router.post("/api/organizations/{organization_id}/collections/entries/{entry_id}/return", response_model=dict, summary="Return object entry")
def return_object_entry(
    organization_id: UUID,
    entry_id: UUID,
    data: dict | None = None,
    auth: AuthContext = Depends(require_permission(Permission.ENTRIES_EDIT)),
    db: Session = Depends(get_db),
):
    """Mark entry as returned and create an Object Exit record."""
    data = data or {}
    user_uuid = auth.user_id

    entry = db.query(ObjectEntry).filter(
        ObjectEntry.entry_id == entry_id,
        ObjectEntry.organization_id == organization_id,
    ).first()

    if not entry:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Object entry not found",
        })

    # Generate exit number (normalized to EX prefix to match other exit generation sites)
    from app.services.sequence import next_sequential_number
    exit_number = next_sequential_number(db, organization_id, 'EX')

    # Create Object Exit record (links to entry via entry_id)
    exit_record = ObjectExit(
        exit_id=uuid4(),
        organization_id=organization_id,
        exit_number=exit_number,
        exit_date=datetime.now(timezone.utc).date(),
        exit_reason="enquiry_return",
        entry_id=entry.entry_id,
        recipient_name=data.get("returned_to") or entry.depositor_name,
        exit_method=data.get("exit_method"),
        exit_note=data.get("exit_note"),
        status="acknowledged",
        receipt_acknowledged=True,
        receipt_acknowledged_date=datetime.now(timezone.utc).date(),
        created_by=user_uuid,
    )
    db.add(exit_record)

    # Update entry with return info
    old_status = entry.status
    entry.status = "returned"
    entry.outcome = "returned"
    entry.return_date = datetime.now(timezone.utc).date()
    entry.returned_to = data.get("returned_to") or entry.depositor_name
    entry.return_method = data.get("return_method")
    entry.return_receipt_reference = data.get("return_receipt_reference")
    entry.updated_by = user_uuid
    entry.updated_at = datetime.now(timezone.utc)

    # Flush to resolve FK timing, then link exit record
    db.flush()
    entry.exit_id = exit_record.exit_id

    try:
        db.commit()
    except Exception:
        db.rollback()
        raise

    notify_status_change(organization_id, 'object_entry', entry.entry_id, entry.entry_number,
                         old_status, 'returned', str(auth.user_id), entity=entry)

    result = _serialize_object_entry(entry)
    result["exit_id"] = str(exit_record.exit_id)
    result["exit_number"] = exit_record.exit_number
    return result


@router.post("/api/organizations/{organization_id}/collections/entries/{entry_id}/accession", response_model=dict, summary="Accession object entry")
def accession_object_entry(
    organization_id: UUID,
    entry_id: UUID,
    data: dict | None = None,
    auth: AuthContext = Depends(require_permission(Permission.ENTRIES_EDIT)),
    db: Session = Depends(get_db),
):
    """Mark entry as acquired, linking it to an existing acquisition."""
    data = data or {}

    acquisition_id = data.get("acquisition_id")
    if not acquisition_id:
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": "acquisition_id is required",
        })

    entry = db.query(ObjectEntry).filter(
        ObjectEntry.entry_id == entry_id,
        ObjectEntry.organization_id == organization_id,
    ).first()

    if not entry:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Object entry not found",
        })

    acquisition = db.query(Acquisition).filter(
        Acquisition.acquisition_id == UUID(acquisition_id),
        Acquisition.organization_id == organization_id,
    ).first()

    if not acquisition:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Acquisition not found",
        })

    user_uuid = auth.user_id
    old_status = entry.status
    entry.status = "acquired"
    entry.outcome = "acquired"
    entry.outcome_reference_id = acquisition.acquisition_id
    entry.outcome_note = data.get("outcome_note")
    entry.updated_by = user_uuid
    entry.updated_at = datetime.now(timezone.utc)

    db.commit()

    notify_status_change(organization_id, 'object_entry', entry.entry_id, entry.entry_number,
                         old_status, 'acquired', str(auth.user_id), entity=entry)

    return _serialize_object_entry(entry)


# ============================================================================
# OBJECT ENTRY MEDIA ENDPOINTS
# ============================================================================


def _get_entry_media_urls(media: Media, db: Session) -> tuple[str | None, str | None]:
    """Get thumbnail and preview URLs for a media item."""
    if not media:
        return None, None

    thumbnail_url = None
    preview_url = None

    # Check for derivatives
    derivatives = db.query(MediaDerivative).filter(
        MediaDerivative.media_id == media.media_id,
        MediaDerivative.derivative_type.in_(["thumbnail", "preview"])
    ).all()

    for deriv in derivatives:
        if deriv.derivative_type == "thumbnail" and deriv.s3_key:
            thumbnail_url = get_org_media_url(deriv.s3_key, organization_id=str(media.organization_id))
        elif deriv.derivative_type == "preview" and deriv.s3_key:
            preview_url = get_org_media_url(deriv.s3_key, organization_id=str(media.organization_id))

    # Fall back to another rendition, never the master: these URLs are minted
    # with url_type=VIEW, so falling back to media.s3_key would put the
    # full-resolution original in a thumbnail slot for anyone with media.view.
    from app.serializers.media import (
        _THUMBNAIL_DERIVATIVE_ORDER,
        _display_key_for_image,
    )

    if media.media_type == "image":
        # Two orders, on purpose. A thumbnail slot takes the smallest usable
        # rendition; the preview slot is rendered large, so it takes the best.
        # Sharing one key made a missing thumbnail fall up to `large`.
        thumb_key = (
            _display_key_for_image(media, db, prefer=_THUMBNAIL_DERIVATIVE_ORDER)
            or media.thumbnail_s3_key
        )
        preview_key = _display_key_for_image(media, db) or media.thumbnail_s3_key
        if not thumbnail_url and thumb_key:
            thumbnail_url = get_org_media_url(thumb_key, organization_id=str(media.organization_id))
        if not preview_url and preview_key:
            preview_url = get_org_media_url(preview_key, organization_id=str(media.organization_id))
    elif not preview_url and media.s3_key:
        # Non-image: no rendition stands in for the file itself.
        preview_url = get_org_media_url(media.s3_key, organization_id=str(media.organization_id))

    return thumbnail_url, preview_url


def _serialize_item_media_link(
    link: ObjectEntryItemMedia,
    db: Session,
    item: ObjectEntryItem | None = None,
    *,
    user_perms: list[str] | None = None,
) -> dict:
    """Serialize an item media link with thumbnail/preview URLs.

    When ``user_perms`` is provided, includes the rights-derived
    ``download_access`` ('direct' | 'request' | 'blocked') — computed the same
    way as the Media app — so the Collections object workspace can offer inline
    download / request actions without sending the user over to the Media app.
    """
    media = link.media
    thumbnail_url, preview_url = _get_entry_media_urls(media, db)
    result = {
        "media_id": str(media.media_id),
        "entry_item_id": str(link.entry_item_id),
        "filename": media.filename,
        "media_type": media.media_type,
        "mime_type": media.mime_type,
        "thumbnail_url": thumbnail_url,
        "preview_url": preview_url,
        "is_primary": link.is_primary,
        "sort_order": link.sort_order,
        "caption": link.caption,
        "usage_type": link.usage_type,
    }
    if user_perms is not None:
        from app.services.download_access import compute_download_access
        result["download_access"] = compute_download_access(
            media.media_id, media.organization_id, user_perms, db,
        )
    if item is not None:
        result["item_number"] = item.item_number
        result["item_description"] = item.brief_description
    return result


def _require_entry_item(
    db: Session, organization_id: UUID, entry_id: UUID, entry_item_id: UUID
) -> ObjectEntryItem:
    item = db.query(ObjectEntryItem).filter(
        ObjectEntryItem.entry_item_id == entry_item_id,
        ObjectEntryItem.entry_id == entry_id,
        ObjectEntryItem.organization_id == organization_id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Entry item not found",
        })
    return item


@router.get(
    "/api/organizations/{organization_id}/collections/entries/{entry_id}/media",
    response_model=EntryMediaListResponse,
    summary="List all media across entry items (aggregated)",
)
def list_object_entry_all_media(
    organization_id: UUID,
    entry_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.ENTRIES_VIEW)),
    db: Session = Depends(get_db),
):
    """List all media across every item on an entry — used for the slideshow rail."""
    entry = db.query(ObjectEntry).filter(
        ObjectEntry.entry_id == entry_id,
        ObjectEntry.organization_id == organization_id,
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Object entry not found",
        })

    rows = (
        db.query(ObjectEntryItemMedia, ObjectEntryItem)
        .join(ObjectEntryItem, ObjectEntryItem.entry_item_id == ObjectEntryItemMedia.entry_item_id)
        .filter(ObjectEntryItem.entry_id == entry_id)
        .order_by(
            ObjectEntryItem.item_number.asc().nullslast(),
            ObjectEntryItemMedia.sort_order.asc(),
        )
        .all()
    )

    from app.services.rbac_service import get_user_permissions
    user_perms = list(get_user_permissions(str(auth.user_id), str(organization_id), session=db))
    result = [_serialize_item_media_link(link, db, item, user_perms=user_perms) for link, item in rows]
    return {"media": result, "count": len(result)}


@router.get(
    "/api/organizations/{organization_id}/collections/entries/{entry_id}/items/{entry_item_id}/media",
    response_model=EntryMediaListResponse,
    summary="List media linked to an entry item",
)
def list_object_entry_item_media(
    organization_id: UUID,
    entry_id: UUID,
    entry_item_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.ENTRIES_VIEW)),
    db: Session = Depends(get_db),
):
    """List media linked to a single entry item."""
    item = _require_entry_item(db, organization_id, entry_id, entry_item_id)
    media_links = db.query(ObjectEntryItemMedia).filter(
        ObjectEntryItemMedia.entry_item_id == item.entry_item_id,
    ).order_by(ObjectEntryItemMedia.sort_order).all()

    from app.services.rbac_service import get_user_permissions
    user_perms = list(get_user_permissions(str(auth.user_id), str(organization_id), session=db))
    return {
        "media": [_serialize_item_media_link(link, db, item, user_perms=user_perms) for link in media_links],
        "count": len(media_links),
    }


@router.post(
    "/api/organizations/{organization_id}/collections/entries/{entry_id}/items/{entry_item_id}/media",
    status_code=201,
    response_model=EntryMediaAddedResponse,
    summary="Add media to an entry item",
)
async def add_object_entry_item_media(
    organization_id: UUID,
    entry_id: UUID,
    entry_item_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.ENTRIES_EDIT)),
    db: Session = Depends(get_db),
):
    """
    Add media to an entry item.

    Can either:
    1. Upload a new file (multipart/form-data with 'file')
    2. Link existing media (JSON with 'media_id')

    Additional fields (form or JSON):
    - is_primary: Set as primary image
    - caption: Caption for this image
    - usage_type: entry_condition, packing, identification, documentation, etc.
    """
    user_uuid = auth.user_id
    item = _require_entry_item(db, organization_id, entry_id, entry_item_id)

    # FastAPI's automatic body parsing forces a single content-type per
    # endpoint; this route legitimately supports both multipart (uploads) and
    # JSON (link existing). Parse the request manually so both work.
    content_type = (request.headers.get("content-type") or "").lower()
    file: UploadFile | None = None
    data: dict | None = None
    if "multipart/form-data" in content_type:
        form = await request.form()
        upload = form.get("file")
        if isinstance(upload, UploadFile):
            file = upload
        # Coerce remaining form fields into the data dict for downstream code
        # paths that expect them under is_primary/caption/usage_type/media_id.
        form_data = {k: v for k, v in form.items() if k != "file"}
        if form_data:
            data = form_data
    elif "application/json" in content_type:
        try:
            data = await request.json()
        except Exception:
            data = None

    media = None

    # Check if this is a file upload or linking existing media
    if file and file.filename:
        # Upload new file
        content_type = file.content_type or 'application/octet-stream'
        media_type = detect_media_type(content_type)
        if not media_type:
            raise HTTPException(status_code=400, detail={
                "code": "bad_request",
                "message": f"Unsupported file type: {content_type}",
            })

        # Upload to S3
        try:
            s3_key, file_size = upload_org_media(
                organization_id=str(organization_id),
                file_data=file.file,
                content_type=content_type,
                media_type=media_type,
                filename=file.filename,
                db_session=db,
            )
        except StorageLimitExceeded as e:
            raise HTTPException(status_code=413, detail={
                "code": "STORAGE_LIMIT_EXCEEDED",
                "message": sanitize_error_message(e),
                "details": {
                    "used_bytes": e.used_bytes,
                    "limit_bytes": e.limit_bytes,
                    "file_size": e.file_size,
                },
            })
        except ValueError as e:
            raise HTTPException(status_code=400, detail={
                "code": "bad_request",
                "message": sanitize_error_message(e),
            })

        # Create media record
        media = Media(
            organization_id=organization_id,
            s3_key=s3_key,
            filename=file.filename,
            file_size=file_size,
            mime_type=content_type,
            media_type=media_type.value,
            title=file.filename,
            processing_status='pending',
            created_by=user_uuid,
        )
        db.add(media)
        db.flush()

        # Trigger derivative generation for images
        if media_type.value == 'image':
            try:
                from app.tasks.media import process_upload_task
                process_upload_task.delay(
                    media_id=str(media.media_id),
                    organization_id=str(organization_id),
                )
                logger.info(f"Triggered derivative generation for media {media.media_id}")
            except Exception as e:
                logger.warning(f"Failed to queue derivative generation for {media.media_id}: {e}")
                media.processing_status = 'completed'

        # For file uploads, is_primary/caption/usage_type would come from form data
        # but in FastAPI we handle them via the data dict or query params
        is_primary_str = ''
        caption = None
        usage_type = None

    else:
        # Link existing media
        if not data or 'media_id' not in data:
            raise HTTPException(status_code=400, detail={
                "code": "bad_request",
                "message": "Either upload a file or provide media_id",
            })

        media_uuid = UUID(data['media_id'])

        # Verify media exists and belongs to org
        media = db.query(Media).filter(
            Media.media_id == media_uuid,
            Media.organization_id == organization_id,
        ).first()

        if not media:
            raise HTTPException(status_code=404, detail={
                "code": "not_found",
                "message": "Media not found",
            })

        # Check if already linked
        existing = db.query(ObjectEntryItemMedia).filter(
            ObjectEntryItemMedia.entry_item_id == item.entry_item_id,
            ObjectEntryItemMedia.media_id == media_uuid,
        ).first()

        if existing:
            raise HTTPException(status_code=409, detail={
                "code": "conflict",
                "message": "Media already linked",
            })

        is_primary_str = str(data.get('is_primary', '')).lower()
        caption = data.get('caption')
        usage_type = data.get('usage_type')

    # Get max sort order for this item
    max_order = db.query(func.max(ObjectEntryItemMedia.sort_order)).filter(
        ObjectEntryItemMedia.entry_item_id == item.entry_item_id
    ).scalar() or -1

    # Check if this should be primary (first media added to this item or explicitly set)
    is_primary = is_primary_str == 'true' or max_order < 0

    # If setting as primary, unset other primaries for this item
    if is_primary:
        db.query(ObjectEntryItemMedia).filter(
            ObjectEntryItemMedia.entry_item_id == item.entry_item_id,
            ObjectEntryItemMedia.is_primary == True
        ).update({"is_primary": False})

    link = ObjectEntryItemMedia(
        entry_item_id=item.entry_item_id,
        media_id=media.media_id,
        is_primary=is_primary,
        sort_order=max_order + 1,
        caption=caption,
        usage_type=usage_type,
        created_by=user_uuid,
    )
    try:
        db.add(link)
        db.commit()
    except Exception:
        db.rollback()
        raise

    return {
        "message": "Media added",
        "data": {"media_id": str(media.media_id), "is_primary": is_primary},
    }


@router.delete(
    "/api/organizations/{organization_id}/collections/entries/{entry_id}/items/{entry_item_id}/media/{media_id}",
    response_model=MessageResponse,
    summary="Remove media from an entry item",
)
def remove_object_entry_item_media(
    organization_id: UUID,
    entry_id: UUID,
    entry_item_id: UUID,
    media_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.ENTRIES_EDIT)),
    db: Session = Depends(get_db),
):
    """Unlink media from an entry item."""
    item = _require_entry_item(db, organization_id, entry_id, entry_item_id)

    link = db.query(ObjectEntryItemMedia).filter(
        ObjectEntryItemMedia.entry_item_id == item.entry_item_id,
        ObjectEntryItemMedia.media_id == media_id,
    ).first()

    if not link:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Media link not found",
        })

    was_primary = link.is_primary
    db.delete(link)

    # If this was primary, promote the next one on this item
    if was_primary:
        next_link = db.query(ObjectEntryItemMedia).filter(
            ObjectEntryItemMedia.entry_item_id == item.entry_item_id
        ).order_by(ObjectEntryItemMedia.sort_order).first()
        if next_link:
            next_link.is_primary = True

    db.commit()
    return {"message": "Media unlinked"}


@router.put(
    "/api/organizations/{organization_id}/collections/entries/{entry_id}/items/{entry_item_id}/media/{media_id}/primary",
    response_model=EntryMediaSetPrimaryResponse,
    summary="Set primary media for an entry item",
)
def set_object_entry_item_primary_media(
    organization_id: UUID,
    entry_id: UUID,
    entry_item_id: UUID,
    media_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.ENTRIES_EDIT)),
    db: Session = Depends(get_db),
):
    """Set a media item as the primary image for an entry item."""
    item = _require_entry_item(db, organization_id, entry_id, entry_item_id)

    link = db.query(ObjectEntryItemMedia).filter(
        ObjectEntryItemMedia.entry_item_id == item.entry_item_id,
        ObjectEntryItemMedia.media_id == media_id,
    ).first()

    if not link:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Media link not found",
        })

    # Unset other primaries for this item
    db.query(ObjectEntryItemMedia).filter(
        ObjectEntryItemMedia.entry_item_id == item.entry_item_id,
        ObjectEntryItemMedia.is_primary == True
    ).update({'is_primary': False})

    # Set this as primary
    link.is_primary = True
    db.commit()

    return {"message": "Primary media set", "data": {"media_id": str(media_id)}}


# ============================================================================
# ACQUISITIONS ENDPOINTS (procedures + CDWA 23)
# ============================================================================


@router.post("/api/organizations/{organization_id}/collections/acquisitions", status_code=201, response_model=dict, summary="Create acquisition")
def create_acquisition(
    organization_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.ACQUISITIONS_CREATE)),
    db: Session = Depends(get_db),
):
    """Create a new acquisition record."""
    if not data.get("acquisition_method"):
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "Missing: acquisition_method",
            "field": "acquisition_method",
        })

    from app.services.collections.field_enums import validate_enum_fields
    validate_enum_fields(Acquisition, data)

    # Create via the shared service — the same code the draft applier runs. It
    # owns the ACQ number and the acquisition/create approval gate. This router
    # is the thin adapter: validate, create, commit.
    from app.services.collections.creation.acquisition import (
        create_acquisition as _create_acquisition,
    )

    try:
        acquisition = _create_acquisition(db, organization_id, data, auth.user_id, open_approval=True)
        db.commit()
    except Exception:
        db.rollback()
        raise

    return _serialize_acquisition(acquisition)


@router.get("/api/organizations/{organization_id}/collections/acquisitions", response_model=AcquisitionListResponse, summary="List acquisitions")
def list_acquisitions(
    organization_id: UUID,
    limit: int = Query(50, le=500),
    offset: int = Query(0),
    status: str | None = Query(None),
    acquisition_method: str | None = Query(None),
    entry_id: str | None = Query(None),
    q: str = Query(""),
    auth: AuthContext = Depends(require_permission(Permission.ACQUISITIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """List acquisitions with filtering and search."""
    query = db.query(Acquisition).filter(Acquisition.organization_id == organization_id)

    search = q.strip()
    if search:
        search_term = f"%{escape_ilike(search)}%"
        query = query.filter(
            or_(
                Acquisition.acquisition_number.ilike(search_term, escape="\\"),
                Acquisition.source_name.ilike(search_term, escape="\\"),
                Acquisition.acquisition_note.ilike(search_term, escape="\\"),
                Acquisition.provenance_note.ilike(search_term, escape="\\"),
                Acquisition.credit_line.ilike(search_term, escape="\\"),
            )
        )
    if status:
        query = query.filter(Acquisition.status == status)
    if acquisition_method:
        query = query.filter(Acquisition.acquisition_method == acquisition_method)
    if entry_id:
        query = query.filter(Acquisition.entry_id == UUID(entry_id))

    total = query.count()
    acquisitions = query.order_by(Acquisition.created_at.desc()).offset(offset).limit(limit).all()

    serialized = [
        apply_field_access(_serialize_acquisition(a), 'acquisition', str(organization_id), str(auth.user_id), session=db, role_override=auth.role_override)
        for a in acquisitions
    ]
    return {
        "items": serialized,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/api/organizations/{organization_id}/collections/acquisitions/{acquisition_id}", response_model=dict, summary="Get acquisition")
def get_acquisition(
    organization_id: UUID,
    acquisition_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.ACQUISITIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get a single acquisition."""
    acq = db.query(Acquisition).filter(
        Acquisition.acquisition_id == acquisition_id,
        Acquisition.organization_id == organization_id,
    ).first()

    if not acq:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Acquisition not found",
        })

    serialized = _serialize_acquisition(acq)
    filtered = apply_field_access(serialized, 'acquisition', str(organization_id), str(auth.user_id), session=db, role_override=auth.role_override)
    return filtered


@router.put("/api/organizations/{organization_id}/collections/acquisitions/{acquisition_id}", response_model=dict, summary="Update acquisition")
def update_acquisition(
    organization_id: UUID,
    acquisition_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.ACQUISITIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Update an acquisition."""
    acq = db.query(Acquisition).filter(
        Acquisition.acquisition_id == acquisition_id,
        Acquisition.organization_id == organization_id,
    ).first()

    if not acq:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Acquisition not found",
        })

    from app.services.collections.field_enums import validate_enum_fields
    validate_enum_fields(Acquisition, data)

    from app.services.coerce import check_version, coerce_value_for_column
    check_version(acq, data)

    old_status = acq.status
    new_status = data.pop('status', None)

    protected_fields = {
        'acquisition_id', 'organization_id', 'acquisition_number', 'created_at', 'created_by',
        'updated_by', 'approved_by', 'approved_by_id', 'approval_date', 'authorization_id', 'authorization_date',
    }
    protected_fields |= get_write_restricted_fields('acquisition', organization_id, str(auth.user_id), session=db, role_override=auth.role_override)
    for key, value in data.items():
        if hasattr(acq, key) and key not in protected_fields:
            if key.endswith('_id') and value:
                setattr(acq, key, UUID(value))
            else:
                setattr(acq, key, coerce_value_for_column(Acquisition, key, value))

    if new_status and new_status != old_status:
        from app.services.workflow_definitions import WORKFLOW_DEFINITIONS
        workflow = WORKFLOW_DEFINITIONS.get('acquisition')
        if workflow and new_status not in workflow.valid_statuses:
            raise HTTPException(status_code=409, detail={"code": "invalid_status", "message": f"'{new_status}' is not a valid status"})
        _enforce_procedure(organization_id, "acquisition", acq, new_status, db)
        acq.status = new_status

    acq.updated_by = auth.user_id
    acq.updated_at = datetime.now(timezone.utc)

    # If edited while pending_approval, resubmit so approver reviews fresh data
    if acq.status == 'pending_approval':
        from app.services.approval_service import resubmit_approval
        changed = [k for k in data.keys() if k not in protected_fields and hasattr(acq, k)]
        resubmit_approval(organization_id, 'acquisition', acq.acquisition_id, auth.user_id, db, changed_fields=changed)

    db.commit()

    if new_status and new_status != old_status:
        notify_status_change(organization_id, 'acquisition', acq.acquisition_id, acq.acquisition_number,
                             old_status, new_status, str(auth.user_id), entity=acq)

    return _serialize_acquisition(acq)


@router.post("/api/organizations/{organization_id}/collections/acquisitions/{acquisition_id}/approve", response_model=dict, summary="Approve acquisition")
def approve_acquisition(
    organization_id: UUID,
    acquisition_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.ACQUISITIONS_APPROVE)),
    db: Session = Depends(get_db),
):
    """Approve an acquisition."""
    acq = db.query(Acquisition).filter(
        Acquisition.acquisition_id == acquisition_id,
        Acquisition.organization_id == organization_id,
    ).first()

    if not acq:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Acquisition not found",
        })

    _enforce_procedure(organization_id, "acquisition", acq, "approved", db)
    from app.services.status_transitions import require_status, InvalidTransitionError
    try:
        require_status(acq, ["proposed"], "approve")
    except InvalidTransitionError as e:
        raise HTTPException(status_code=409, detail={"code": "invalid_transition", "message": str(e)})

    user_uuid = auth.user_id
    old_status = acq.status
    acq.status = "approved"
    acq.authorization_id = user_uuid
    acq.authorization_date = datetime.now(timezone.utc).date()
    acq.updated_by = user_uuid
    acq.updated_at = datetime.now(timezone.utc)

    db.commit()

    notify_approval(organization_id, 'acquisition', acq.acquisition_id, acq.acquisition_number,
                    str(auth.user_id), entity=acq)

    return _serialize_acquisition(acq)


@router.post("/api/organizations/{organization_id}/collections/acquisitions/{acquisition_id}/complete", response_model=dict, summary="Complete acquisition")
def complete_acquisition(
    organization_id: UUID,
    acquisition_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.ACQUISITIONS_APPROVE)),
    db: Session = Depends(get_db),
):
    """Complete an acquisition."""
    acq = db.query(Acquisition).filter(
        Acquisition.acquisition_id == acquisition_id,
        Acquisition.organization_id == organization_id,
    ).first()

    if not acq:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Acquisition not found",
        })

    _enforce_procedure(organization_id, "acquisition", acq, "completed", db)
    from app.services.status_transitions import require_status, InvalidTransitionError
    try:
        require_status(acq, ["approved"], "complete")
    except InvalidTransitionError as e:
        raise HTTPException(status_code=409, detail={"code": "invalid_transition", "message": str(e)})

    old_status = acq.status
    acq.status = "completed"
    acq.completed_date = datetime.now(timezone.utc).date()
    acq.updated_by = auth.user_id
    acq.updated_at = datetime.now(timezone.utc)

    db.commit()

    notify_status_change(organization_id, 'acquisition', acq.acquisition_id, acq.acquisition_number,
                         old_status, 'completed', str(auth.user_id), entity=acq)

    return _serialize_acquisition(acq)


@router.post("/api/organizations/{organization_id}/collections/acquisitions/{acquisition_id}/rollback", response_model=dict, summary="Rollback acquisition")
def rollback_acquisition(
    organization_id: UUID,
    acquisition_id: UUID,
    data: dict | None = None,
    auth: AuthContext = Depends(require_permission(Permission.ACQUISITIONS_ROLLBACK)),
    db: Session = Depends(get_db),
):
    """Rollback an acquisition to a previous status."""
    from app.services.workflow_definitions import WORKFLOW_DEFINITIONS
    from app.services.status_transitions import rollback_entity, InvalidTransitionError
    from app.services.audit_service import log_audit_event

    data = data or {}

    target_status = data.get("target_status")
    if not target_status:
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "Missing: target_status",
            "field": "target_status",
        })

    reason = (data.get("reason") or "").strip()
    if not reason:
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "A reason is required when reverting status",
            "field": "reason",
        })

    workflow = WORKFLOW_DEFINITIONS["acquisition"]

    acq = db.query(Acquisition).filter(
        Acquisition.acquisition_id == acquisition_id,
        Acquisition.organization_id == organization_id,
    ).first()

    if not acq:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Acquisition not found",
        })

    try:
        old_status = rollback_entity(
            acq, target_status, workflow, auth.user_id,
            session=db, organization_id=organization_id,
        )
    except InvalidTransitionError as e:
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": str(e),
        })

    log_audit_event(
        session=db,
        organization_id=organization_id,
        acting_user_id=auth.user_id,
        action="acquisition.rollback",
        details={
            "entity_id": str(acquisition_id),
            "old_status": old_status,
            "new_status": target_status,
            "reason": reason,
        },
    )

    db.commit()

    notify_status_change(organization_id, 'acquisition', acq.acquisition_id, acq.acquisition_number,
                         old_status, target_status, str(auth.user_id), entity=acq)

    return _serialize_acquisition(acq)


# ============================================================================
# ACQUISITION OBJECTS (LINK/UNLINK)
# ============================================================================


def _serialize_acquisition_object(ao: AcquisitionObject) -> dict:
    """Serialize an AcquisitionObject link."""
    return {
        "acquisition_object_id": str(ao.acquisition_object_id),
        "acquisition_id": str(ao.acquisition_id),
        "object_id": str(ao.object_id),
        "organization_id": str(ao.organization_id),
        "note": ao.note,
        "created_at": ao.created_at.isoformat() if ao.created_at else None,
    }


@router.get("/api/organizations/{organization_id}/collections/acquisitions/{acquisition_id}/objects", response_model=AcquisitionObjectListResponse, summary="List acquisition objects")
def list_acquisition_objects(
    organization_id: UUID,
    acquisition_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.ACQUISITIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """List objects linked to an acquisition."""
    acq = db.query(Acquisition).filter(
        Acquisition.acquisition_id == acquisition_id,
        Acquisition.organization_id == organization_id,
    ).first()

    if not acq:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Acquisition not found",
        })

    # Get linked objects
    links = db.query(AcquisitionObject).options(
        joinedload(AcquisitionObject.object)
    ).filter(
        AcquisitionObject.acquisition_id == acquisition_id,
        AcquisitionObject.organization_id == organization_id,
    ).all()

    objects = []
    for link in links:
        obj_data = _serialize_acquisition_object(link)
        if link.object:
            obj_data["object"] = {
                "object_id": str(link.object.object_id),
                "object_number": link.object.object_number,
                "title": link.object.title_links[0].title if link.object.title_links else None,
                "object_name": link.object.object_name,
                "object_status": link.object.object_status,
            }
        objects.append(obj_data)

    return {
        "objects": objects,
        "total": len(objects),
    }


@router.post("/api/organizations/{organization_id}/collections/acquisitions/{acquisition_id}/objects", status_code=201, response_model=AcquisitionObjectOut, summary="Link acquisition object")
def link_acquisition_object(
    organization_id: UUID,
    acquisition_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.ACQUISITIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Link an object to an acquisition."""
    if not data.get("object_id"):
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "Missing: object_id",
            "field": "object_id",
        })

    object_uuid = UUID(data["object_id"])

    # Verify acquisition exists
    acq = db.query(Acquisition).filter(
        Acquisition.acquisition_id == acquisition_id,
        Acquisition.organization_id == organization_id,
    ).first()

    if not acq:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Acquisition not found",
        })

    # Verify object exists
    obj = db.query(CollectionObject).filter(
        CollectionObject.object_id == object_uuid,
        CollectionObject.organization_id == organization_id,
    ).first()

    if not obj:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Object not found",
        })

    # Check if link already exists
    existing = db.query(AcquisitionObject).filter(
        AcquisitionObject.acquisition_id == acquisition_id,
        AcquisitionObject.object_id == object_uuid,
    ).first()

    if existing:
        raise HTTPException(status_code=409, detail={
            "code": "conflict",
            "message": "Object is already linked to this acquisition",
        })

    # Create link
    user_uuid = auth.user_id
    link = AcquisitionObject(
        acquisition_id=acquisition_id,
        object_id=object_uuid,
        organization_id=organization_id,
        note=data.get("note"),
        created_by=user_uuid,
    )

    try:
        db.add(link)
        db.commit()
    except Exception:
        db.rollback()
        raise

    result = _serialize_acquisition_object(link)
    result["object"] = {
        "object_id": str(obj.object_id),
        "object_number": obj.object_number,
        "title": obj.title_links[0].title if obj.title_links else None,
        "object_name": obj.object_name,
    }

    return result


@router.delete("/api/organizations/{organization_id}/collections/acquisitions/{acquisition_id}/objects/{object_id}", response_model=MessageResponse, summary="Unlink acquisition object")
def unlink_acquisition_object(
    organization_id: UUID,
    acquisition_id: UUID,
    object_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.ACQUISITIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Unlink an object from an acquisition."""
    link = db.query(AcquisitionObject).filter(
        AcquisitionObject.acquisition_id == acquisition_id,
        AcquisitionObject.object_id == object_id,
        AcquisitionObject.organization_id == organization_id,
    ).first()

    if not link:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Link not found",
        })

    db.delete(link)
    db.commit()

    return {"message": "Link removed"}


@router.get("/api/organizations/{organization_id}/collections/objects/{object_id}/acquisition", response_model=ObjectAcquisitionResponse, summary="Get object acquisition")
def get_object_acquisition(
    organization_id: UUID,
    object_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get the acquisition linked to an object."""
    link = db.query(AcquisitionObject).options(
        joinedload(AcquisitionObject.acquisition)
    ).filter(
        AcquisitionObject.object_id == object_id,
        AcquisitionObject.organization_id == organization_id,
    ).first()

    if not link or not link.acquisition:
        return {"acquisition": None}

    return {
        "acquisition": _serialize_acquisition(link.acquisition),
        "link": _serialize_acquisition_object(link),
    }


@router.put("/api/organizations/{organization_id}/collections/objects/{object_id}/acquisition", response_model=ObjectAcquisitionResponse, summary="Set object acquisition")
def set_object_acquisition(
    organization_id: UUID,
    object_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Set or change the acquisition linked to an object."""
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

    # Remove existing link if any
    existing = db.query(AcquisitionObject).filter(
        AcquisitionObject.object_id == object_id,
        AcquisitionObject.organization_id == organization_id,
    ).first()

    if existing:
        db.delete(existing)

    # If acquisition_id provided, create new link
    if data.get("acquisition_id"):
        acq_uuid = UUID(data["acquisition_id"])

        # Verify acquisition exists
        acq = db.query(Acquisition).filter(
            Acquisition.acquisition_id == acq_uuid,
            Acquisition.organization_id == organization_id,
        ).first()

        if not acq:
            raise HTTPException(status_code=404, detail={
                "code": "not_found",
                "message": "Acquisition not found",
            })

        user_uuid = auth.user_id
        link = AcquisitionObject(
            acquisition_id=acq_uuid,
            object_id=object_id,
            organization_id=organization_id,
            note=data.get("note"),
            created_by=user_uuid,
        )
        try:
            db.add(link)
            db.commit()
        except Exception:
            db.rollback()
            raise

        return {
            "acquisition": _serialize_acquisition(acq),
            "link": _serialize_acquisition_object(link),
        }

    db.commit()
    return {"acquisition": None}


# ============================================================================
# WORKFLOW DEFINITIONS ENDPOINT
# ============================================================================


@router.get("/api/workflow-definitions", response_model=dict, summary="Get workflow definitions")
def get_workflow_definitions():
    """Return all procedure workflow status definitions.

    Provides a single source of truth for valid statuses, status ordering,
    and milestone field-clearing rules used by frontend compliance checks
    and rollback operations.
    """
    from app.services.workflow_definitions import WORKFLOW_DEFINITIONS

    return {
        "workflows": {
            key: {
                "entity_type": wf.entity_type,
                "valid_statuses": wf.valid_statuses,
                "status_order": wf.status_order,
            }
            for key, wf in WORKFLOW_DEFINITIONS.items()
        }
    }
