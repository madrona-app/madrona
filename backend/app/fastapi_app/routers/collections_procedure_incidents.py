"""
Collections Incidents API endpoints (FastAPI).

Provides CRUD for:
- Incident Reports (Procedure 16) — 7 routes
  Including: incident object linking and incident close workflow.

Migrated from app/api/collections_cdwa_procedure.py.

Key side effects:
  Close route calls notify_status_change() from entity_notifications.
  Auto-numbering: INC-NNNN.
"""

import logging
from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.orm import object_session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.models import CollectionObject, IncidentReport, IncidentReportObject
from app.models.compliance import ComplianceAction, EntityImage
from app.permissions import Permission
from app.services.api_security import escape_ilike
from app.services.entity_notifications import notify_status_change
from app.services.validation_utils import parse_uuid_or_raise
from app.fastapi_app.schemas.common import MessageResponse
from app.fastapi_app.schemas.collections_procedure_incidents import (
    IncidentReportOut,
    IncidentReportListResponse,
    IncidentObjectOut,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["collections-procedure-incidents"])


# ============================================================================
# SERIALIZERS
# ============================================================================

def _get_incident_preventive_actions(ir: IncidentReport) -> list[dict]:
    """Query preventive actions from the polymorphic compliance_actions table."""
    db = object_session(ir)
    if not db:
        return []
    actions = db.query(ComplianceAction).filter(
        ComplianceAction.entity_type == "incident_report",
        ComplianceAction.entity_id == ir.report_id,
        ComplianceAction.action_type == "preventive",
    ).order_by(ComplianceAction.display_order).all()
    return [
        {
            "action_id": str(a.action_id),
            "title": a.title,
            "description": a.description,
            "assigned_to": a.assigned_to,
            "due_date": a.due_date.isoformat() if a.due_date else None,
            "status": a.status,
        }
        for a in actions
    ]


def _get_incident_image_references(ir: IncidentReport) -> list[dict]:
    """Query image references from the polymorphic entity_images table."""
    db = object_session(ir)
    if not db:
        return []
    images = db.query(EntityImage).filter(
        EntityImage.entity_type == "incident_report",
        EntityImage.entity_id == ir.report_id,
    ).order_by(EntityImage.display_order).all()
    return [
        {
            "image_id": str(img.image_id),
            "media_id": str(img.media_id) if img.media_id else None,
            "caption": img.caption,
            "date_taken": img.date_taken.isoformat() if img.date_taken else None,
            "taken_by": img.taken_by,
        }
        for img in images
    ]


def _serialize_incident_report(ir: IncidentReport, include_objects: bool = False) -> dict:
    result = {
        "report_id": str(ir.report_id),
        "organization_id": str(ir.organization_id),
        "report_number": ir.report_number,
        "report_date": ir.report_date.isoformat() if ir.report_date else None,
        "incident_type": ir.incident_type,
        "incident_subtype": ir.incident_subtype,
        "incident_date": ir.incident_date.isoformat() if ir.incident_date else None,
        "incident_date_approximate": ir.incident_date_approximate,
        "incident_location_id": str(ir.incident_location_id) if ir.incident_location_id else None,
        "incident_location_description": ir.incident_location_description,
        "discovered_date": ir.discovered_date.isoformat() if ir.discovered_date else None,
        "discovered_by": str(ir.discovered_by) if ir.discovered_by else None,
        "discovered_by_name": ir.discovered_by_name,
        "discovery_circumstances": ir.discovery_circumstances,
        "incident_description": ir.incident_description,
        "cause_analysis": ir.cause_analysis,
        "contributing_factors": ir.contributing_factors,
        "immediate_actions": ir.immediate_actions,
        "police_notified": ir.police_notified,
        "police_report_number": ir.police_report_number,
        "police_report_date": ir.police_report_date.isoformat() if ir.police_report_date else None,
        "police_contact": ir.police_contact,
        "police_note": ir.police_note,
        "insurance_claim_filed": ir.insurance_claim_filed,
        "insurance_claim_number": ir.insurance_claim_number,
        "insurance_claim_date": ir.insurance_claim_date.isoformat() if ir.insurance_claim_date else None,
        "insurance_adjuster": ir.insurance_adjuster,
        "insurance_claim_status": ir.insurance_claim_status,
        "insurance_claim_amount": float(ir.insurance_claim_amount) if ir.insurance_claim_amount else None,
        "insurance_settlement_amount": float(ir.insurance_settlement_amount) if ir.insurance_settlement_amount else None,
        "insurance_currency": ir.insurance_currency,
        "insurance_note": ir.insurance_note,
        "director_notified": ir.director_notified,
        "director_notified_date": ir.director_notified_date.isoformat() if ir.director_notified_date else None,
        "board_notified": ir.board_notified,
        "board_notified_date": ir.board_notified_date.isoformat() if ir.board_notified_date else None,
        "investigation_required": ir.investigation_required,
        "investigation_lead": str(ir.investigation_lead) if ir.investigation_lead else None,
        "investigation_findings": ir.investigation_findings,
        "investigation_completed_date": ir.investigation_completed_date.isoformat() if ir.investigation_completed_date else None,
        "resolution_summary": ir.resolution_summary,
        "resolved_date": ir.resolved_date.isoformat() if ir.resolved_date else None,
        "lessons_learned": ir.lessons_learned,
        "preventive_actions": _get_incident_preventive_actions(ir),
        "image_references": _get_incident_image_references(ir),
        "document_references": ir.document_references,
        "status": ir.status,
        "assigned_to_user_id": str(ir.assigned_to_user_id) if ir.assigned_to_user_id else None,
        "report_note": ir.report_note,
        "internal_note": ir.internal_note,
        "created_by": str(ir.created_by) if ir.created_by else None,
        "created_at": ir.created_at.isoformat() if ir.created_at else None,
        "updated_at": ir.updated_at.isoformat() if ir.updated_at else None,
    }
    if include_objects:
        result["affected_objects"] = [_serialize_incident_object(io) for io in (ir.affected_objects or [])]
    return result


def _serialize_incident_object(io: IncidentReportObject) -> dict:
    result = {
        "incident_object_id": str(io.incident_object_id),
        "report_id": str(io.report_id),
        "object_id": str(io.object_id),
        "damage_description": io.damage_description,
        "damage_extent": io.damage_extent,
        "condition_before": io.condition_before,
        "condition_after": io.condition_after,
        "condition_report_id": str(io.condition_report_id) if io.condition_report_id else None,
        "treatment_id": str(io.treatment_id) if io.treatment_id else None,
        "estimated_loss_value": float(io.estimated_loss_value) if io.estimated_loss_value else None,
        "estimated_loss_currency": io.estimated_loss_currency,
        "recovered": io.recovered,
        "recovered_date": io.recovered_date.isoformat() if io.recovered_date else None,
        "recovery_note": io.recovery_note,
        "created_at": io.created_at.isoformat() if io.created_at else None,
    }
    if io.object:
        result["object"] = {
            "object_id": str(io.object.object_id),
            "object_number": io.object.object_number,
            "object_name": io.object.object_name,
        }
    return result


# ============================================================================
# INCIDENT REPORTS (Procedure 16) — 7 routes
# ============================================================================


@router.get("/api/organizations/{org_id}/collections/incidents", response_model=IncidentReportListResponse, summary="List incidents")
def list_incidents(
    org_id: UUID,
    limit: int = Query(50, le=500),
    offset: int = Query(0, ge=0),
    status: str | None = None,
    incident_type: str | None = None,
    q: str | None = None,
    auth: AuthContext = Depends(require_permission(Permission.INCIDENTS_VIEW)),
    db: Session = Depends(get_db),
):
    """List incidents."""
    query = db.query(IncidentReport).filter(
        IncidentReport.organization_id == org_id,
    )

    if status:
        query = query.filter(IncidentReport.status == status)
    if incident_type:
        query = query.filter(IncidentReport.incident_type == incident_type)
    if q:
        term = f"%{escape_ilike(q)}%"
        query = query.filter(or_(
            IncidentReport.report_number.ilike(term, escape="\\"),
            IncidentReport.incident_description.ilike(term, escape="\\"),
            IncidentReport.discovered_by_name.ilike(term, escape="\\"),
        ))

    total = query.count()
    reports = query.order_by(IncidentReport.created_at.desc()).offset(offset).limit(limit).all()

    return {
        "items": [_serialize_incident_report(r) for r in reports],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("/api/organizations/{org_id}/collections/incidents", status_code=201, response_model=IncidentReportOut, summary="Create incident")
def create_incident(
    org_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.INCIDENTS_CREATE)),
    db: Session = Depends(get_db),
):
    """Create incident."""
    if not body.get("incident_type"):
        raise HTTPException(status_code=400, detail="Missing: incident_type")
    if not body.get("incident_description"):
        raise HTTPException(status_code=400, detail="Missing: incident_description")

    report_number = body.get("report_number")
    if not report_number:
        from app.services.sequence import next_sequential_number
        report_number = next_sequential_number(db, org_id, 'INC', include_year=False, separator='-')

    user_uuid = auth.user_id

    incident_location_id = None
    if body.get("incident_location_id"):
        incident_location_id = parse_uuid_or_raise(body["incident_location_id"])

    report = IncidentReport(
        organization_id=org_id,
        report_number=report_number,
        report_date=body.get("report_date", date.today()),
        incident_type=body["incident_type"],
        incident_subtype=body.get("incident_subtype"),
        incident_description=body["incident_description"],
        incident_date=body.get("incident_date"),
        incident_date_approximate=body.get("incident_date_approximate", False),
        incident_location_id=incident_location_id,
        incident_location_description=body.get("incident_location_description"),
        discovered_date=body.get("discovered_date", datetime.now(timezone.utc)),
        discovered_by=user_uuid,
        discovered_by_name=body.get("discovered_by_name"),
        discovery_circumstances=body.get("discovery_circumstances"),
        cause_analysis=body.get("cause_analysis"),
        contributing_factors=body.get("contributing_factors"),
        immediate_actions=body.get("immediate_actions"),
        police_notified=body.get("police_notified", False),
        police_report_number=body.get("police_report_number"),
        police_contact=body.get("police_contact"),
        insurance_claim_filed=body.get("insurance_claim_filed", False),
        investigation_required=body.get("investigation_required", False),
        status=body.get("status", "draft"),
        report_note=body.get("report_note"),
        created_by=user_uuid,
        updated_by=user_uuid,
    )

    db.add(report)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A report with this number may already exist")

    db.refresh(report)
    return _serialize_incident_report(report)


@router.get("/api/organizations/{org_id}/collections/incidents/{incident_id}", response_model=IncidentReportOut, summary="Get incident")
def get_incident(
    org_id: UUID,
    incident_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.INCIDENTS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get incident."""
    report = db.query(IncidentReport).options(
        joinedload(IncidentReport.affected_objects).joinedload(IncidentReportObject.object),
    ).filter(
        IncidentReport.report_id == incident_id,
        IncidentReport.organization_id == org_id,
    ).first()
    if not report:
        raise HTTPException(status_code=404, detail="Incident report not found")

    return _serialize_incident_report(report, include_objects=True)


@router.put("/api/organizations/{org_id}/collections/incidents/{incident_id}", response_model=IncidentReportOut, summary="Update incident")
def update_incident(
    org_id: UUID,
    incident_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.INCIDENTS_EDIT)),
    db: Session = Depends(get_db),
):
    """Update incident."""
    report = db.query(IncidentReport).filter(
        IncidentReport.report_id == incident_id,
        IncidentReport.organization_id == org_id,
    ).first()
    if not report:
        raise HTTPException(status_code=404, detail="Incident report not found")

    protected = {"report_id", "organization_id", "created_at", "created_by", "updated_by"}
    uuid_fields = {"incident_location_id", "discovered_by", "investigation_lead", "assigned_to_user_id"}

    for key, value in body.items():
        if key in protected:
            continue
        if hasattr(report, key):
            if key in uuid_fields and value is not None:
                value = UUID(value) if isinstance(value, str) else value
            setattr(report, key, value)

    report.updated_by = auth.user_id
    report.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(report)
    return _serialize_incident_report(report)


@router.post("/api/organizations/{org_id}/collections/incidents/{incident_id}/objects", status_code=201, response_model=IncidentObjectOut, summary="Add incident object")
def add_incident_object(
    org_id: UUID,
    incident_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.INCIDENTS_EDIT)),
    db: Session = Depends(get_db),
):
    """Add incident object."""
    if not body.get("object_id"):
        raise HTTPException(status_code=400, detail="Missing: object_id")

    object_uuid = parse_uuid_or_raise(body["object_id"])

    report = db.query(IncidentReport).filter(
        IncidentReport.report_id == incident_id,
        IncidentReport.organization_id == org_id,
    ).first()
    if not report:
        raise HTTPException(status_code=404, detail="Incident report not found")

    obj = db.query(CollectionObject).filter(
        CollectionObject.object_id == object_uuid,
        CollectionObject.organization_id == org_id,
    ).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Object not found")

    estimated_loss_value = None
    if body.get("estimated_loss_value"):
        estimated_loss_value = Decimal(str(body["estimated_loss_value"]))

    condition_report_id = None
    if body.get("condition_report_id"):
        condition_report_id = parse_uuid_or_raise(body["condition_report_id"])

    treatment_id = None
    if body.get("treatment_id"):
        treatment_id = parse_uuid_or_raise(body["treatment_id"])

    link = IncidentReportObject(
        report_id=incident_id,
        organization_id=org_id,
        object_id=object_uuid,
        damage_description=body.get("damage_description"),
        damage_extent=body.get("damage_extent"),
        condition_before=body.get("condition_before"),
        condition_after=body.get("condition_after"),
        condition_report_id=condition_report_id,
        treatment_id=treatment_id,
        estimated_loss_value=estimated_loss_value,
        estimated_loss_currency=body.get("estimated_loss_currency", "USD"),
        recovered=body.get("recovered", False),
        recovery_note=body.get("recovery_note"),
    )

    db.add(link)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="This object is already linked to this incident")

    db.refresh(link)
    return _serialize_incident_object(link)


@router.delete("/api/organizations/{org_id}/collections/incidents/{incident_id}/objects/{object_id}", response_model=MessageResponse, summary="Remove incident object")
def remove_incident_object(
    org_id: UUID,
    incident_id: UUID,
    object_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.INCIDENTS_EDIT)),
    db: Session = Depends(get_db),
):
    """Remove incident object."""
    link = db.query(IncidentReportObject).filter(
        IncidentReportObject.report_id == incident_id,
        IncidentReportObject.object_id == object_id,
        IncidentReportObject.organization_id == org_id,
    ).first()
    if not link:
        raise HTTPException(status_code=404, detail="Incident object link not found")

    db.delete(link)
    db.commit()
    return {"message": "Object removed from incident"}


@router.post("/api/organizations/{org_id}/collections/incidents/{incident_id}/close", response_model=IncidentReportOut, summary="Close incident")
def close_incident(
    org_id: UUID,
    incident_id: UUID,
    body: dict | None = None,
    auth: AuthContext = Depends(require_permission(Permission.INCIDENTS_EDIT)),
    db: Session = Depends(get_db),
):
    """Close incident."""
    body = body or {}

    report = db.query(IncidentReport).filter(
        IncidentReport.report_id == incident_id,
        IncidentReport.organization_id == org_id,
    ).first()
    if not report:
        raise HTTPException(status_code=404, detail="Incident report not found")

    if report.status == "resolved":
        raise HTTPException(status_code=400, detail="Incident is already resolved")

    old_status = report.status
    report.status = "resolved"
    report.resolved_date = date.today()

    if body.get("resolution_summary"):
        report.resolution_summary = body["resolution_summary"]
    if body.get("lessons_learned"):
        report.lessons_learned = body["lessons_learned"]
    if body.get("preventive_actions"):
        # Create compliance action records for preventive actions
        from app.models import ComplianceAction
        for idx, action in enumerate(body.get("preventive_actions") or []):
            db.add(ComplianceAction(
                organization_id=report.organization_id,
                entity_type='incident_report', entity_id=report.report_id,
                action_type='preventive',
                title=action.get("action", action.get("title", "untitled")),
                description=action.get("description"),
                assigned_to=action.get("responsible"),
                display_order=idx,
            ))

    report.updated_by = auth.user_id
    report.updated_at = datetime.now(timezone.utc)

    db.commit()

    ref = report.report_number
    try:
        notify_status_change(
            org_id, "incident_report", report.report_id, ref,
            old_status, "resolved", auth.user_id, entity=report,
        )
    except Exception:
        logger.warning("Failed to send status change notification for incident %s", incident_id)

    db.refresh(report)
    return _serialize_incident_report(report)
