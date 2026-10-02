"""
Conservation, exit, and deaccession endpoints (FastAPI).

Manages conservation treatments, object exits, and deaccession workflows.
"""

import logging
from uuid import UUID
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_auth, require_permission
from app.models import (
    CollectionObject,
    ConservationTreatment,
    ObjectEntry,
    ObjectExit,
    ObjectExitItem,
    Deaccession,
    DeaccessionAudit,
)
from app.permissions import Permission
from app.services.api_security import escape_ilike
from app.services.field_access_service import apply_field_access, get_write_restricted_fields
from app.services.entity_notifications import notify_status_change, notify_approval
from app.fastapi_app.serializers.collections import (
    _serialize_conservation_treatment,
    _serialize_object_exit,
    _serialize_object_exit_item,
    _serialize_deaccession,
    _serialize_deaccession_audit,
)
from app.fastapi_app.schemas.collections_conservation import (
    ConservationTreatmentListResponse,
    ObjectExitListResponse,
    DeaccessionListResponse,
    DeaccessionAuditListResponse,
)
from app.services.procedure_enforcement import check_blocking_requirements

logger = logging.getLogger(__name__)

router = APIRouter(tags=["collections-conservation"])


def _enforce_procedure(organization_id: UUID, procedure_type: str, entity, target_status: str, db: Session):
    """Raise 422 if procedure enforcement is enabled and blocking requirements are unmet."""
    missing = check_blocking_requirements(organization_id, procedure_type, entity, target_status, db)
    if missing:
        raise HTTPException(status_code=422, detail={
            "code": "procedure_requirements_not_met",
            "message": f"Cannot advance to {target_status}: unmet requirements",
            "blocking_requirements": missing,
        })


def _sync_entry_outcome_from_exit(
    db: Session,
    exit_rec: "ObjectExit",
    previous_entry_id: UUID | None,
) -> None:
    """
    Keep ObjectEntry.outcome / outcome_reference_id / return_date in sync with
    ObjectExit.entry_id.

    Object Entry expects entries to flow into Object Exit when the
    depositor's objects are returned. This helper wires the FK both ways so the
    entry workspace can display the exit reference without requiring a separate
    API call and without leaving outcome_reference_id dead.

    Call sites:
    - On POST /exits: previous_entry_id=None (no prior link).
    - On PUT /exits: pass the entry_id the exit had *before* the update so we
      can clear the outcome on an entry that has been unlinked.
    """
    # If the exit was previously linked to a different entry, clear the stale
    # outcome pointer on that entry.
    if previous_entry_id and previous_entry_id != exit_rec.entry_id:
        old_entry = db.query(ObjectEntry).filter(
            ObjectEntry.entry_id == previous_entry_id
        ).first()
        if old_entry and old_entry.outcome_reference_id == exit_rec.exit_id:
            old_entry.outcome = None
            old_entry.outcome_reference_id = None
            old_entry.return_date = None

    if not exit_rec.entry_id:
        return

    entry = db.query(ObjectEntry).filter(
        ObjectEntry.entry_id == exit_rec.entry_id
    ).first()
    if not entry:
        return

    entry.outcome = "returned"
    entry.outcome_reference_id = exit_rec.exit_id
    if exit_rec.exit_date and not entry.return_date:
        entry.return_date = exit_rec.exit_date


# ============================================================================
# CONSERVATION TREATMENTS ENDPOINTS
# ============================================================================


@router.post("/api/organizations/{organization_id}/collections/conservation", status_code=201, response_model=dict, summary="Create conservation treatment")
def create_conservation_treatment(
    organization_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.CONSERVATION_CREATE)),
    db: Session = Depends(get_db),
):
    """Create a new conservation treatment record."""
    if not data.get("treatment_type"):
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "Missing: treatment_type",
            "field": "treatment_type",
        })

    if not data.get("object_id"):
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "A conservation treatment must be linked to an object",
            "field": "object_id",
        })

    from app.services.collections.field_enums import validate_enum_fields
    validate_enum_fields(ConservationTreatment, data)

    # Create via the shared service — the same code the draft applier runs.
    from app.services.collections.creation.conservation_treatment import (
        create_conservation_treatment as _create_conservation_treatment,
    )

    try:
        treatment = _create_conservation_treatment(
            db, organization_id, data, auth.user_id, open_approval=True
        )
        db.commit()
    except Exception:
        db.rollback()
        raise

    return _serialize_conservation_treatment(treatment)


@router.get("/api/organizations/{organization_id}/collections/conservation", response_model=ConservationTreatmentListResponse, summary="List conservation treatments")
def list_conservation_treatments(
    organization_id: UUID,
    limit: int = Query(50, le=500),
    offset: int = Query(0, ge=0),
    status: str | None = Query(None),
    treatment_type: str | None = Query(None),
    object_id: str | None = Query(None),
    q: str = Query(""),
    auth: AuthContext = Depends(require_permission(Permission.CONSERVATION_VIEW)),
    db: Session = Depends(get_db),
):
    """List conservation treatments with filtering and search."""
    query = db.query(ConservationTreatment).filter(
        ConservationTreatment.organization_id == organization_id
    )

    search = q.strip()
    if search:
        search_term = f"%{escape_ilike(search)}%"
        query = query.filter(
            or_(
                ConservationTreatment.treatment_number.ilike(search_term, escape="\\"),
                ConservationTreatment.conservator_name.ilike(search_term, escape="\\"),
                ConservationTreatment.conservator_institution.ilike(search_term, escape="\\"),
                ConservationTreatment.treatment_description.ilike(search_term, escape="\\"),
                ConservationTreatment.treatment_note.ilike(search_term, escape="\\"),
            )
        )
    if status:
        query = query.filter(ConservationTreatment.status == status)
    if treatment_type:
        query = query.filter(ConservationTreatment.treatment_type == treatment_type)
    if object_id:
        query = query.filter(ConservationTreatment.object_id == UUID(object_id))

    total = query.count()
    treatments = query.order_by(ConservationTreatment.proposal_date.desc()).offset(offset).limit(limit).all()

    serialized = [
        apply_field_access(_serialize_conservation_treatment(t), 'conservation_treatment', str(organization_id), str(auth.user_id), session=db, role_override=auth.role_override)
        for t in treatments
    ]
    return {
        "items": serialized,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/api/organizations/{organization_id}/collections/conservation/{treatment_id}", response_model=dict, summary="Get conservation treatment")
def get_conservation_treatment(
    organization_id: UUID,
    treatment_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.CONSERVATION_VIEW)),
    db: Session = Depends(get_db),
):
    """Get a single conservation treatment."""
    treatment = db.query(ConservationTreatment).filter(
        ConservationTreatment.treatment_id == treatment_id,
        ConservationTreatment.organization_id == organization_id,
    ).first()

    if not treatment:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Conservation treatment not found",
        })

    serialized = _serialize_conservation_treatment(treatment)
    filtered = apply_field_access(serialized, 'conservation_treatment', str(organization_id), str(auth.user_id), session=db, role_override=auth.role_override)
    return filtered


@router.put("/api/organizations/{organization_id}/collections/conservation/{treatment_id}", response_model=dict, summary="Update conservation treatment")
def update_conservation_treatment(
    organization_id: UUID,
    treatment_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.CONSERVATION_EDIT)),
    db: Session = Depends(get_db),
):
    """Update a conservation treatment."""
    treatment = db.query(ConservationTreatment).filter(
        ConservationTreatment.treatment_id == treatment_id,
        ConservationTreatment.organization_id == organization_id,
    ).first()

    if not treatment:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Conservation treatment not found",
        })

    from app.services.collections.field_enums import validate_enum_fields
    validate_enum_fields(ConservationTreatment, data)

    old_status = treatment.status

    # Optimistic concurrency — reject stale updates
    from app.services.coerce import check_version, coerce_value_for_column
    check_version(treatment, data)

    # Prevent removing object_id
    if "object_id" in data and not data["object_id"]:
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "A conservation treatment must be linked to an object",
            "field": "object_id",
        })

    old_status = treatment.status
    new_status = data.pop('status', None)

    protected_fields = {
        'treatment_id', 'organization_id', 'treatment_number', 'created_at', 'created_by',
        'updated_by', 'approved_by', 'approval_date', 'approved_at', 'version',
    }
    protected_fields |= get_write_restricted_fields('conservation_treatment', str(organization_id), str(auth.user_id), session=db, role_override=auth.role_override)
    for key, value in data.items():
        if hasattr(treatment, key) and key not in protected_fields:
            if key.endswith('_id') and value:
                setattr(treatment, key, UUID(value))
            else:
                setattr(treatment, key, coerce_value_for_column(ConservationTreatment, key, value))

    if new_status and new_status != old_status:
        from app.services.workflow_definitions import WORKFLOW_DEFINITIONS
        workflow = WORKFLOW_DEFINITIONS.get('conservation_treatment')
        if workflow and new_status not in workflow.valid_statuses:
            raise HTTPException(status_code=409, detail={"code": "invalid_status", "message": f"'{new_status}' is not a valid status"})
        _enforce_procedure(organization_id, "conservation_treatment", treatment, new_status, db)
        treatment.status = new_status

    treatment.updated_by = auth.user_id
    treatment.updated_at = datetime.now(timezone.utc)

    db.commit()

    if new_status and new_status != old_status:
        notify_status_change(organization_id, 'conservation_treatment', treatment.treatment_id,
                             treatment.treatment_number, old_status, new_status,
                             str(auth.user_id), entity=treatment)

    return _serialize_conservation_treatment(treatment)


@router.post("/api/organizations/{organization_id}/collections/conservation/{treatment_id}/approve", response_model=dict, summary="Approve conservation treatment")
def approve_conservation_treatment(
    organization_id: UUID,
    treatment_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.CONSERVATION_APPROVE)),
    db: Session = Depends(get_db),
):
    """Approve a conservation treatment."""
    treatment = db.query(ConservationTreatment).filter(
        ConservationTreatment.treatment_id == treatment_id,
        ConservationTreatment.organization_id == organization_id,
    ).first()

    if not treatment:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Conservation treatment not found",
        })

    from app.services.status_transitions import require_status, InvalidTransitionError
    try:
        require_status(treatment, ["proposed"], "approve")
    except InvalidTransitionError as e:
        raise HTTPException(status_code=409, detail={"code": "invalid_transition", "message": str(e)})

    old_status = treatment.status
    treatment.status = "approved"
    treatment.approval_date = datetime.now(timezone.utc).date()
    treatment.approved_by = auth.user_id
    treatment.updated_by = auth.user_id
    treatment.updated_at = datetime.now(timezone.utc)

    db.commit()

    notify_approval(organization_id, 'conservation_treatment', treatment.treatment_id,
                    treatment.treatment_number, str(auth.user_id), entity=treatment)

    return _serialize_conservation_treatment(treatment)


@router.post("/api/organizations/{organization_id}/collections/conservation/{treatment_id}/start", response_model=dict, summary="Start conservation treatment")
def start_conservation_treatment(
    organization_id: UUID,
    treatment_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.CONSERVATION_EDIT)),
    db: Session = Depends(get_db),
):
    """Start a conservation treatment."""
    treatment = db.query(ConservationTreatment).filter(
        ConservationTreatment.treatment_id == treatment_id,
        ConservationTreatment.organization_id == organization_id,
    ).first()

    if not treatment:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Conservation treatment not found",
        })

    from app.services.status_transitions import require_status, InvalidTransitionError
    try:
        require_status(treatment, ["approved"], "start")
    except InvalidTransitionError as e:
        raise HTTPException(status_code=409, detail={"code": "invalid_transition", "message": str(e)})

    old_status = treatment.status
    treatment.status = "in_progress"
    treatment.start_date = datetime.now(timezone.utc).date()
    treatment.updated_by = auth.user_id
    treatment.updated_at = datetime.now(timezone.utc)

    db.commit()

    notify_status_change(organization_id, 'conservation_treatment', treatment.treatment_id,
                         treatment.treatment_number, old_status, 'in_progress',
                         str(auth.user_id), entity=treatment)

    return _serialize_conservation_treatment(treatment)


@router.post("/api/organizations/{organization_id}/collections/conservation/{treatment_id}/complete", response_model=dict, summary="Complete conservation treatment")
def complete_conservation_treatment(
    organization_id: UUID,
    treatment_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.CONSERVATION_EDIT)),
    db: Session = Depends(get_db),
):
    """Complete a conservation treatment."""
    treatment = db.query(ConservationTreatment).filter(
        ConservationTreatment.treatment_id == treatment_id,
        ConservationTreatment.organization_id == organization_id,
    ).first()

    if not treatment:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Conservation treatment not found",
        })

    from app.services.status_transitions import require_status, InvalidTransitionError
    try:
        require_status(treatment, ["in_progress"], "complete")
    except InvalidTransitionError as e:
        raise HTTPException(status_code=409, detail={"code": "invalid_transition", "message": str(e)})

    old_status = treatment.status
    treatment.status = "completed"
    treatment.end_date = datetime.now(timezone.utc).date()
    if treatment.start_date:
        treatment.actual_duration_days = (datetime.now(timezone.utc).date() - treatment.start_date).days
    treatment.updated_by = auth.user_id
    treatment.updated_at = datetime.now(timezone.utc)

    db.commit()

    notify_status_change(organization_id, 'conservation_treatment', treatment.treatment_id,
                         treatment.treatment_number, old_status, 'completed',
                         str(auth.user_id), entity=treatment)

    return _serialize_conservation_treatment(treatment)


# ============================================================================
# OBJECT EXITS ENDPOINTS
# ============================================================================


@router.post("/api/organizations/{organization_id}/collections/exits", status_code=201, response_model=dict, summary="Create object exit")
def create_object_exit(
    organization_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.EXITS_CREATE)),
    db: Session = Depends(get_db),
):
    """Create a new object exit record."""
    if not data.get("exit_reason"):
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "Missing: exit_reason",
            "field": "exit_reason",
        })

    from app.services.collections.field_enums import validate_enum_fields
    validate_enum_fields(ObjectExit, data)

    # Create via the shared service — the same code the draft applier runs. It
    # owns the EX number, the object_exit/create approval gate, and the
    # entry-outcome link. This router is the thin adapter.
    from app.services.collections.creation.object_exit import (
        create_object_exit as _create_object_exit,
    )

    try:
        exit_rec = _create_object_exit(db, organization_id, data, auth.user_id, open_approval=True)
        db.commit()
    except Exception:
        db.rollback()
        raise

    return _serialize_object_exit(exit_rec)


@router.get("/api/organizations/{organization_id}/collections/exits", response_model=ObjectExitListResponse, summary="List object exits")
def list_object_exits(
    organization_id: UUID,
    limit: int = Query(50, le=500),
    offset: int = Query(0, ge=0),
    status: str | None = Query(None),
    exit_reason: str | None = Query(None),
    entry_id: str | None = Query(None),
    reference_type: str | None = Query(None),
    reference_id: str | None = Query(None),
    q: str = Query(""),
    auth: AuthContext = Depends(require_permission(Permission.EXITS_VIEW)),
    db: Session = Depends(get_db),
):
    """List object exits with filtering and search."""
    query = db.query(ObjectExit).filter(ObjectExit.organization_id == organization_id)

    search = q.strip()
    if search:
        search_term = f"%{escape_ilike(search)}%"
        query = query.filter(
            or_(
                ObjectExit.exit_number.ilike(search_term, escape="\\"),
                ObjectExit.recipient_name.ilike(search_term, escape="\\"),
                ObjectExit.exit_note.ilike(search_term, escape="\\"),
            )
        )
    if status:
        query = query.filter(ObjectExit.status == status)
    if exit_reason:
        query = query.filter(ObjectExit.exit_reason == exit_reason)
    if entry_id:
        query = query.filter(ObjectExit.entry_id == UUID(entry_id))
    if reference_type:
        query = query.filter(ObjectExit.reference_type == reference_type)
    if reference_id:
        query = query.filter(ObjectExit.reference_id == UUID(reference_id))

    total = query.count()
    exits = query.order_by(ObjectExit.exit_date.desc()).offset(offset).limit(limit).all()

    serialized = [
        apply_field_access(_serialize_object_exit(e), 'object_exit', str(organization_id), str(auth.user_id), session=db, role_override=auth.role_override)
        for e in exits
    ]
    return {
        "items": serialized,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/api/organizations/{organization_id}/collections/exits/{exit_id}", response_model=dict, summary="Get object exit")
def get_object_exit(
    organization_id: UUID,
    exit_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXITS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get a single object exit."""
    exit_rec = db.query(ObjectExit).filter(
        ObjectExit.exit_id == exit_id,
        ObjectExit.organization_id == organization_id,
    ).first()

    if not exit_rec:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Object exit not found",
        })

    result = _serialize_object_exit(exit_rec)

    # Include items
    items = db.query(ObjectExitItem).filter(ObjectExitItem.exit_id == exit_rec.exit_id).all()
    result["items"] = [_serialize_object_exit_item(i) for i in items]

    filtered = apply_field_access(result, 'object_exit', str(organization_id), str(auth.user_id), session=db, role_override=auth.role_override)
    return filtered


@router.put("/api/organizations/{organization_id}/collections/exits/{exit_id}", response_model=dict, summary="Update object exit")
def update_object_exit(
    organization_id: UUID,
    exit_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.EXITS_EDIT)),
    db: Session = Depends(get_db),
):
    """Update an object exit."""
    exit_rec = db.query(ObjectExit).filter(
        ObjectExit.exit_id == exit_id,
        ObjectExit.organization_id == organization_id,
    ).first()

    if not exit_rec:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Object exit not found",
        })

    from app.services.collections.field_enums import validate_enum_fields
    validate_enum_fields(ObjectExit, data)

    from app.services.coerce import check_version, coerce_value_for_column
    check_version(exit_rec, data)

    old_status = exit_rec.status
    new_status = data.pop('status', None)
    previous_entry_id = exit_rec.entry_id

    protected_fields = {'exit_id', 'organization_id', 'exit_number', 'created_at', 'created_by', 'updated_by'}
    protected_fields |= get_write_restricted_fields('object_exit', str(organization_id), str(auth.user_id), session=db, role_override=auth.role_override)
    for key, value in data.items():
        if hasattr(exit_rec, key) and key not in protected_fields:
            if key.endswith('_id') and value:
                setattr(exit_rec, key, UUID(value))
            elif key.endswith('_id') and value in (None, ""):
                setattr(exit_rec, key, None)
            else:
                setattr(exit_rec, key, coerce_value_for_column(ObjectExit, key, value))

    if new_status and new_status != old_status:
        from app.services.workflow_definitions import WORKFLOW_DEFINITIONS
        workflow = WORKFLOW_DEFINITIONS.get('object_exit')
        if workflow and new_status not in workflow.valid_statuses:
            raise HTTPException(status_code=409, detail={"code": "invalid_status", "message": f"'{new_status}' is not a valid status"})
        _enforce_procedure(organization_id, "object_exit", exit_rec, new_status, db)
        exit_rec.status = new_status

    exit_rec.updated_by = auth.user_id
    exit_rec.updated_at = datetime.now(timezone.utc)

    _sync_entry_outcome_from_exit(db, exit_rec, previous_entry_id=previous_entry_id)

    db.commit()

    if new_status and new_status != old_status:
        notify_status_change(organization_id, 'object_exit', exit_rec.exit_id, exit_rec.exit_number,
                             old_status, new_status, str(auth.user_id), entity=exit_rec)

    return _serialize_object_exit(exit_rec)


@router.post("/api/organizations/{organization_id}/collections/exits/{exit_id}/dispatch", response_model=dict, summary="Dispatch object exit")
def dispatch_object_exit(
    organization_id: UUID,
    exit_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXITS_EDIT)),
    db: Session = Depends(get_db),
):
    """Mark exit as dispatched."""
    exit_rec = db.query(ObjectExit).filter(
        ObjectExit.exit_id == exit_id,
        ObjectExit.organization_id == organization_id,
    ).first()

    if not exit_rec:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Object exit not found",
        })

    _enforce_procedure(organization_id, "object_exit", exit_rec, "dispatched", db)

    from app.services.status_transitions import require_status, InvalidTransitionError
    try:
        require_status(exit_rec, ["pending", "preparing"], "dispatch")
    except InvalidTransitionError as e:
        raise HTTPException(status_code=409, detail={"code": "invalid_transition", "message": str(e)})

    exit_rec.status = "dispatched"
    exit_rec.updated_by = auth.user_id
    exit_rec.updated_at = datetime.now(timezone.utc)

    db.commit()
    return _serialize_object_exit(exit_rec)


@router.post("/api/organizations/{organization_id}/collections/exits/{exit_id}/acknowledge", response_model=dict, summary="Acknowledge object exit")
def acknowledge_object_exit(
    organization_id: UUID,
    exit_id: UUID,
    data: dict | None = None,
    auth: AuthContext = Depends(require_permission(Permission.EXITS_EDIT)),
    db: Session = Depends(get_db),
):
    """Mark exit as acknowledged by recipient."""
    if data is None:
        data = {}

    exit_rec = db.query(ObjectExit).filter(
        ObjectExit.exit_id == exit_id,
        ObjectExit.organization_id == organization_id,
    ).first()

    if not exit_rec:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Object exit not found",
        })

    _enforce_procedure(organization_id, "object_exit", exit_rec, "acknowledged", db)

    from app.services.status_transitions import require_status, InvalidTransitionError
    try:
        require_status(exit_rec, ["dispatched", "in_transit"], "acknowledge")
    except InvalidTransitionError as e:
        raise HTTPException(status_code=409, detail={"code": "invalid_transition", "message": str(e)})

    exit_rec.status = "acknowledged"
    exit_rec.receipt_acknowledged = True
    exit_rec.receipt_acknowledged_date = datetime.now(timezone.utc).date()
    exit_rec.receipt_acknowledged_by = data.get("acknowledged_by")
    exit_rec.receipt_reference = data.get("receipt_reference")
    exit_rec.receipt_note = data.get("receipt_note")
    exit_rec.updated_by = auth.user_id
    exit_rec.updated_at = datetime.now(timezone.utc)

    db.commit()
    return _serialize_object_exit(exit_rec)


@router.post("/api/organizations/{organization_id}/collections/exits/{exit_id}/rollback", response_model=dict, summary="Rollback object exit")
def rollback_object_exit(
    organization_id: UUID,
    exit_id: UUID,
    data: dict | None = None,
    auth: AuthContext = Depends(require_permission(Permission.EXITS_ROLLBACK)),
    db: Session = Depends(get_db),
):
    """Rollback an object exit to a previous status."""
    from app.services.workflow_definitions import WORKFLOW_DEFINITIONS
    from app.services.status_transitions import rollback_entity, InvalidTransitionError
    from app.services.audit_service import log_audit_event

    if data is None:
        data = {}

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

    workflow = WORKFLOW_DEFINITIONS["object_exit"]

    exit_rec = db.query(ObjectExit).filter(
        ObjectExit.exit_id == exit_id,
        ObjectExit.organization_id == organization_id,
    ).first()

    if not exit_rec:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Object exit not found",
        })

    try:
        old_status = rollback_entity(
            exit_rec, target_status, workflow, auth.user_id,
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
        action="object_exit.rollback",
        details={
            "entity_id": str(exit_id),
            "old_status": old_status,
            "new_status": target_status,
            "reason": reason,
        },
    )

    db.commit()

    notify_status_change(organization_id, 'object_exit', exit_rec.exit_id, exit_rec.exit_number,
                         old_status, target_status, str(auth.user_id), entity=exit_rec)

    return _serialize_object_exit(exit_rec)


# ============================================================================
# DEACCESSIONS ENDPOINTS
# ============================================================================


@router.post("/api/organizations/{organization_id}/collections/deaccessions", status_code=201, response_model=dict, summary="Create deaccession")
def create_deaccession(
    organization_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.DEACCESSION_CREATE)),
    db: Session = Depends(get_db),
):
    """Create a new deaccession proposal."""
    missing = []
    if not data.get("object_id"):
        missing.append("object_id")
    if not data.get("reason"):
        missing.append("reason")
    if missing:
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": f"Missing required fields: {', '.join(missing)}",
            "fields": missing,
        })

    from app.services.collections.field_enums import validate_enum_fields
    validate_enum_fields(Deaccession, data)

    # Create via the shared service — the same code the draft applier runs. It
    # owns the DA number, the deaccession/create approval gate, and the
    # DeaccessionAudit record. This router is the thin adapter.
    from app.services.collections.creation.deaccession import (
        create_deaccession as _create_deaccession,
    )

    try:
        deacc = _create_deaccession(db, organization_id, data, auth.user_id, open_approval=True)
        db.commit()
    except Exception:
        db.rollback()
        raise

    return _serialize_deaccession(deacc)


@router.get("/api/organizations/{organization_id}/collections/deaccessions", response_model=DeaccessionListResponse, summary="List deaccessions")
def list_deaccessions(
    organization_id: UUID,
    limit: int = Query(50, le=500),
    offset: int = Query(0, ge=0),
    status: str | None = Query(None),
    reason: str | None = Query(None),
    q: str = Query(""),
    auth: AuthContext = Depends(require_permission(Permission.DEACCESSION_VIEW)),
    db: Session = Depends(get_db),
):
    """List deaccessions with filtering and search."""
    query = db.query(Deaccession).filter(Deaccession.organization_id == organization_id)

    search = q.strip()
    if search:
        search_term = f"%{escape_ilike(search)}%"
        query = query.filter(
            or_(
                Deaccession.deaccession_number.ilike(search_term, escape="\\"),
                Deaccession.recipient_name.ilike(search_term, escape="\\"),
                Deaccession.justification.ilike(search_term, escape="\\"),
                # Deaccession has no single 'notes' column; the model
                # records committee/board/legal notes separately.
                Deaccession.committee_note.ilike(search_term, escape="\\"),
                Deaccession.board_note.ilike(search_term, escape="\\"),
                Deaccession.legal_review_note.ilike(search_term, escape="\\"),
            )
        )
    if status:
        query = query.filter(Deaccession.status == status)
    if reason:
        query = query.filter(Deaccession.reason == reason)

    total = query.count()
    deaccessions = query.order_by(Deaccession.proposal_date.desc()).offset(offset).limit(limit).all()

    serialized = [
        apply_field_access(_serialize_deaccession(d), 'deaccession', str(organization_id), str(auth.user_id), session=db, role_override=auth.role_override)
        for d in deaccessions
    ]
    return {
        "items": serialized,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/api/organizations/{organization_id}/collections/deaccessions/{deaccession_id}", response_model=dict, summary="Get deaccession")
def get_deaccession(
    organization_id: UUID,
    deaccession_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.DEACCESSION_VIEW)),
    db: Session = Depends(get_db),
):
    """Get a single deaccession with audit trail."""
    deacc = db.query(Deaccession).filter(
        Deaccession.deaccession_id == deaccession_id,
        Deaccession.organization_id == organization_id,
    ).first()

    if not deacc:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Deaccession not found",
        })

    result = _serialize_deaccession(deacc)

    # Include audit trail
    audits = db.query(DeaccessionAudit).filter(
        DeaccessionAudit.deaccession_id == deacc.deaccession_id
    ).order_by(DeaccessionAudit.performed_at.desc()).all()
    result["audit_trail"] = [_serialize_deaccession_audit(a) for a in audits]

    filtered = apply_field_access(result, 'deaccession', str(organization_id), str(auth.user_id), session=db, role_override=auth.role_override)
    return filtered


@router.put("/api/organizations/{organization_id}/collections/deaccessions/{deaccession_id}", response_model=dict, summary="Update deaccession")
def update_deaccession(
    organization_id: UUID,
    deaccession_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.DEACCESSION_EDIT)),
    db: Session = Depends(get_db),
):
    """Update a deaccession."""
    deacc = db.query(Deaccession).filter(
        Deaccession.deaccession_id == deaccession_id,
        Deaccession.organization_id == organization_id,
    ).first()

    if not deacc:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Deaccession not found",
        })

    from app.services.collections.field_enums import validate_enum_fields
    validate_enum_fields(Deaccession, data)

    # Optimistic concurrency — reject stale updates
    from app.services.coerce import check_version, coerce_value_for_column
    check_version(deacc, data)

    old_status = deacc.status
    new_status = data.pop('status', None)

    protected_fields = {'deaccession_id', 'organization_id', 'deaccession_number', 'created_at', 'created_by', 'updated_by', 'version'}
    protected_fields |= get_write_restricted_fields('deaccession', str(organization_id), str(auth.user_id), session=db, role_override=auth.role_override)

    # Track changes for audit
    changes = []
    for key, value in data.items():
        if hasattr(deacc, key) and key not in protected_fields:
            old_value = getattr(deacc, key)
            if key.endswith('_id') and value:
                setattr(deacc, key, UUID(value))
            else:
                setattr(deacc, key, coerce_value_for_column(Deaccession, key, value))

            if str(old_value) != str(value):
                changes.append({
                    "field": key,
                    "old": str(old_value) if old_value else None,
                    "new": str(value) if value else None,
                })

    if new_status and new_status != old_status:
        from app.services.workflow_definitions import WORKFLOW_DEFINITIONS
        workflow = WORKFLOW_DEFINITIONS.get('deaccession')
        if workflow and new_status not in workflow.valid_statuses:
            raise HTTPException(status_code=409, detail={"code": "invalid_status", "message": f"'{new_status}' is not a valid status"})
        _enforce_procedure(organization_id, "deaccession", deacc, new_status, db)
        deacc.status = new_status
        changes.append({"field": "status", "old": old_status, "new": new_status})

    deacc.updated_by = auth.user_id
    deacc.updated_at = datetime.now(timezone.utc)

    # Create audit records for changes
    for change in changes:
        audit = DeaccessionAudit(
            deaccession_id=deacc.deaccession_id,
            organization_id=organization_id,
            action="field_updated",
            field_name=change["field"],
            old_value=change["old"],
            new_value=change["new"],
            performed_by=auth.user_id,
            performed_at=datetime.now(timezone.utc),
        )
        db.add(audit)

    # If status changed to completed, update linked object status
    if new_status == "completed" and deacc.object_id:
        obj = db.query(CollectionObject).filter(
            CollectionObject.object_id == deacc.object_id
        ).first()
        if obj:
            obj.object_status = "deaccessioned"
            obj.updated_by = auth.user_id
            obj.updated_at = datetime.now(timezone.utc)

    # If edited while pending_approval, resubmit so approver reviews fresh data
    if deacc.status == 'pending_approval':
        from app.services.approval_service import resubmit_approval
        changed = [k for k in data.keys() if k not in protected_fields and hasattr(deacc, k)]
        resubmit_approval(organization_id, 'deaccession', deacc.deaccession_id, auth.user_id, db, changed_fields=changed)

    db.commit()

    if new_status and new_status != old_status:
        notify_status_change(organization_id, 'deaccession', deacc.deaccession_id, deacc.deaccession_number,
                             old_status, new_status, str(auth.user_id), entity=deacc)

    return _serialize_deaccession(deacc)


@router.post("/api/organizations/{organization_id}/collections/deaccessions/{deaccession_id}/review", response_model=dict, summary="Review deaccession")
def review_deaccession(
    organization_id: UUID,
    deaccession_id: UUID,
    data: dict | None = None,
    auth: AuthContext = Depends(require_permission(Permission.DEACCESSION_REVIEW)),
    db: Session = Depends(get_db),
):
    """Record committee review of deaccession."""
    if data is None:
        data = {}

    deacc = db.query(Deaccession).filter(
        Deaccession.deaccession_id == deaccession_id,
        Deaccession.organization_id == organization_id,
    ).first()

    if not deacc:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Deaccession not found",
        })

    old_status = deacc.status

    # The committee's recommendation must be stated, never defaulted.
    #
    # This used to be data.get("recommendation", "approve"), so a request with
    # an empty body recorded a committee recommendation to APPROVE the
    # permanent removal of an object from the collection. A governance
    # decision nobody made is worse than a missing one.
    recommendation = (data.get("recommendation") or "").strip()
    if not recommendation:
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "A committee recommendation is required.",
        })

    deacc.status = "committee_reviewed"
    deacc.committee_review_date = datetime.now(timezone.utc).date()
    deacc.committee_recommendation = recommendation
    deacc.committee_note = data.get("note")
    # Create vote records from members data
    from app.models import DeaccessionVote
    members = data.get("members") or []
    for idx, member in enumerate(members):
        voter_name = (
            member.get("member_name") or member.get("name") or ""
        ).strip()
        if not voter_name:
            raise HTTPException(status_code=422, detail={
                "code": "validation_error",
                "message": f"Vote {idx + 1} is missing the voting member's name.",
            })
        vote = DeaccessionVote(
            organization_id=deacc.organization_id,
            deaccession_id=deacc.deaccession_id,
            voter_name=voter_name,
            voter_title=member.get("role"),
            vote=member.get("vote"),
            display_order=idx,
            # Record who entered the roster. The votes themselves are typed in
            # by one staff member on the committee's behalf, so without this
            # there is nothing tying the recorded ballot to a real person.
            created_by=auth.user_id,
        )
        db.add(vote)
    deacc.updated_by = auth.user_id
    deacc.updated_at = datetime.now(timezone.utc)

    # Create audit record
    audit = DeaccessionAudit(
        deaccession_id=deacc.deaccession_id,
        organization_id=organization_id,
        action="committee_reviewed",
        field_name="status",
        old_value=old_status,
        new_value="committee_reviewed",
        performed_by=auth.user_id,
        performed_at=datetime.now(timezone.utc),
        note=f"Committee recommendation: {deacc.committee_recommendation}",
    )
    db.add(audit)

    try:
        db.commit()
    except Exception:
        db.rollback()
        raise

    notify_status_change(organization_id, 'deaccession', deacc.deaccession_id,
                         deacc.deaccession_number, old_status, 'committee_reviewed',
                         str(auth.user_id), entity=deacc)

    return _serialize_deaccession(deacc)


@router.post("/api/organizations/{organization_id}/collections/deaccessions/{deaccession_id}/approve", response_model=dict, summary="Approve deaccession")
def approve_deaccession(
    organization_id: UUID,
    deaccession_id: UUID,
    data: dict | None = None,
    auth: AuthContext = Depends(require_permission(Permission.DEACCESSION_APPROVE)),
    db: Session = Depends(get_db),
):
    """Board approval of deaccession."""
    if data is None:
        data = {}

    deacc = db.query(Deaccession).filter(
        Deaccession.deaccession_id == deaccession_id,
        Deaccession.organization_id == organization_id,
    ).first()

    if not deacc:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Deaccession not found",
        })

    _enforce_procedure(organization_id, "deaccession", deacc, "approved", db)

    from app.services.status_transitions import require_status, InvalidTransitionError
    try:
        require_status(deacc, ["under_review", "committee_reviewed", "pending_board"], "approve")
    except InvalidTransitionError as e:
        raise HTTPException(status_code=409, detail={"code": "invalid_transition", "message": str(e)})

    old_status = deacc.status

    deacc.status = "approved"
    deacc.board_approval_date = datetime.now(timezone.utc).date()
    deacc.board_approval_reference = data.get("reference")
    deacc.board_resolution = data.get("resolution")
    deacc.board_note = data.get("note")
    deacc.updated_by = auth.user_id
    deacc.updated_at = datetime.now(timezone.utc)

    # Create audit record
    audit = DeaccessionAudit(
        deaccession_id=deacc.deaccession_id,
        organization_id=organization_id,
        action="board_approved",
        field_name="status",
        old_value=old_status,
        new_value="approved",
        performed_by=auth.user_id,
        performed_at=datetime.now(timezone.utc),
        note=f"Board approval reference: {deacc.board_approval_reference}",
    )
    db.add(audit)

    try:
        db.commit()
    except Exception:
        db.rollback()
        raise

    notify_approval(organization_id, 'deaccession', deacc.deaccession_id,
                    deacc.deaccession_number, str(auth.user_id), entity=deacc)

    return _serialize_deaccession(deacc)


@router.post("/api/organizations/{organization_id}/collections/deaccessions/{deaccession_id}/complete", response_model=dict, summary="Complete deaccession")
def complete_deaccession(
    organization_id: UUID,
    deaccession_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.DEACCESSION_COMPLETE)),
    db: Session = Depends(get_db),
):
    """Complete deaccession process."""
    deacc = db.query(Deaccession).filter(
        Deaccession.deaccession_id == deaccession_id,
        Deaccession.organization_id == organization_id,
    ).first()

    if not deacc:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Deaccession not found",
        })

    _enforce_procedure(organization_id, "deaccession", deacc, "completed", db)

    old_status = deacc.status

    deacc.status = "completed"
    deacc.completion_date = datetime.now(timezone.utc).date()
    deacc.deaccession_date = datetime.now(timezone.utc).date()
    deacc.updated_by = auth.user_id
    deacc.updated_at = datetime.now(timezone.utc)

    # Create audit record
    audit = DeaccessionAudit(
        deaccession_id=deacc.deaccession_id,
        organization_id=organization_id,
        action="disposal_completed",
        field_name="status",
        old_value=old_status,
        new_value="completed",
        performed_by=auth.user_id,
        performed_at=datetime.now(timezone.utc),
        note="Deaccession process completed",
    )
    db.add(audit)

    # Update the collection object status
    obj = db.query(CollectionObject).filter(
        CollectionObject.object_id == deacc.object_id
    ).first()
    if obj:
        obj.object_status = "deaccessioned"
        obj.updated_by = auth.user_id
        obj.updated_at = datetime.now(timezone.utc)

    try:
        db.commit()
    except Exception:
        db.rollback()
        raise

    notify_status_change(organization_id, 'deaccession', deacc.deaccession_id,
                         deacc.deaccession_number, old_status, 'completed',
                         str(auth.user_id), entity=deacc)

    return _serialize_deaccession(deacc)


@router.get("/api/organizations/{organization_id}/collections/deaccessions/{deaccession_id}/audit", response_model=DeaccessionAuditListResponse, summary="Get deaccession audit")
def get_deaccession_audit(
    organization_id: UUID,
    deaccession_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.DEACCESSION_VIEW)),
    db: Session = Depends(get_db),
):
    """Get audit trail for a deaccession."""
    deacc = db.query(Deaccession).filter(
        Deaccession.deaccession_id == deaccession_id,
        Deaccession.organization_id == organization_id,
    ).first()

    if not deacc:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Deaccession not found",
        })

    audits = db.query(DeaccessionAudit).filter(
        DeaccessionAudit.deaccession_id == deacc.deaccession_id
    ).order_by(DeaccessionAudit.performed_at.desc()).all()

    return {
        "audit_trail": [_serialize_deaccession_audit(a) for a in audits],
        "total": len(audits),
    }


@router.post("/api/organizations/{organization_id}/collections/deaccessions/{deaccession_id}/rollback", response_model=dict, summary="Rollback deaccession")
def rollback_deaccession(
    organization_id: UUID,
    deaccession_id: UUID,
    data: dict | None = None,
    auth: AuthContext = Depends(require_permission(Permission.DEACCESSION_ROLLBACK)),
    db: Session = Depends(get_db),
):
    """Rollback a deaccession to a previous status."""
    from app.services.workflow_definitions import WORKFLOW_DEFINITIONS
    from app.services.status_transitions import rollback_entity, InvalidTransitionError
    from app.services.audit_service import log_audit_event

    if data is None:
        data = {}

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

    workflow = WORKFLOW_DEFINITIONS["deaccession"]

    deacc = db.query(Deaccession).filter(
        Deaccession.deaccession_id == deaccession_id,
        Deaccession.organization_id == organization_id,
    ).first()

    if not deacc:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Deaccession not found",
        })

    # Deaccession has special rollback side-effects beyond field clearing
    old_status = deacc.status
    status_order = workflow.status_order
    current_index = status_order.index(old_status) if old_status in status_order else -1
    target_index = status_order.index(target_status) if target_status in status_order else -1

    # Restore linked object status when rolling back past "completed"
    if (current_index >= status_order.index("completed")
            and target_index < status_order.index("completed")):
        if deacc.object_id:
            obj = db.query(CollectionObject).filter(
                CollectionObject.object_id == deacc.object_id,
                CollectionObject.organization_id == organization_id,
            ).first()
            if obj and obj.object_status == "deaccessioned":
                obj.object_status = "accessioned"
                obj.updated_by = auth.user_id
                obj.updated_at = datetime.now(timezone.utc)

    # Clear committee votes when rolling back past "committee_reviewed"
    if (current_index >= status_order.index("committee_reviewed")
            and target_index < status_order.index("committee_reviewed")):
        from app.models import DeaccessionVote
        db.query(DeaccessionVote).filter(
            DeaccessionVote.deaccession_id == deacc.deaccession_id
        ).delete()

    try:
        rollback_entity(
            deacc, target_status, workflow, auth.user_id,
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
        action="deaccession.rollback",
        details={
            "entity_id": str(deaccession_id),
            "old_status": old_status,
            "new_status": target_status,
            "reason": reason,
        },
    )

    db.commit()
    return _serialize_deaccession(deacc)
