"""
Collections Plans API endpoints (FastAPI).

Provides CRUD + approval for:
- Documentation Plans (Procedure 9) — 6 routes
- Emergency Plans (Procedure 15) — 6 routes

Migrated from app/api/collections_cdwa_procedure.py.

Key side effects:
  Approve routes call notify_approval() from entity_notifications.
  Auto-numbering: DP-NNNN for doc plans, EP-NNNN for emergency plans.
"""

import logging
from datetime import date, datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.models import DocumentationPlan, EmergencyPlan
from app.permissions import Permission
from app.services.api_security import escape_ilike
from app.services.entity_notifications import notify_approval
from app.fastapi_app.schemas.common import MessageResponse
from app.fastapi_app.schemas.collections_procedure_plans import (
    DocumentationPlanOut,
    DocumentationPlanListResponse,
    EmergencyPlanOut,
    EmergencyPlanListResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["collections-procedure-plans"])


# ============================================================================
# FIELD MAPPINGS (Flask API name → Model column name)
# ============================================================================

_DOC_PLAN_API_TO_MODEL = {
    "resources_required": "resources_needed",
    "approved_at": "approval_date",
    "notes": "plan_note",
}

_EMERGENCY_PLAN_API_TO_MODEL = {
    "notes": "plan_note",
}


# ============================================================================
# SERIALIZERS
# ============================================================================

def _get_plan_actions(dp: DocumentationPlan) -> list[dict]:
    """Actions for a plan, from the polymorphic compliance_actions table.

    The serializer read `dp.actions`, which no column or relationship provides,
    so listing documentation plans raised AttributeError and returned 500 on
    every call. Actions live in compliance_actions keyed by entity_type /
    entity_id — the same shape collections_procedure_compliance uses for audit
    campaigns and collections_procedure_incidents for incident reports.
    """
    from sqlalchemy.orm import object_session

    from app.models.compliance import ComplianceAction

    db = object_session(dp)
    if not db:
        return []
    actions = (
        db.query(ComplianceAction)
        .filter(
            ComplianceAction.entity_type == "documentation_plan",
            ComplianceAction.entity_id == dp.plan_id,
        )
        .order_by(ComplianceAction.display_order)
        .all()
    )
    return [
        {
            "action_id": str(a.action_id),
            "action_type": a.action_type,
            "title": a.title,
            "description": a.description,
            "assigned_to": a.assigned_to,
            "due_date": a.due_date.isoformat() if a.due_date else None,
            "completed_date": a.completed_date.isoformat() if a.completed_date else None,
            "status": a.status,
            "priority": a.priority,
        }
        for a in actions
    ]


def _serialize_documentation_plan(dp: DocumentationPlan) -> dict:
    return {
        "plan_id": str(dp.plan_id),
        "organization_id": str(dp.organization_id),
        "plan_number": dp.plan_number,
        "title": dp.title,
        "plan_type": dp.plan_type,
        "scope_description": dp.scope_description,
        "target_collections": dp.target_collections,
        "target_object_types": dp.target_object_types,
        "priority_criteria": dp.priority_criteria,
        "objectives": dp.objectives,
        "measurable_results": dp.measurable_results,
        "actions": _get_plan_actions(dp),
        # "milestones" is gone with dp.milestones: no column or table in the
        # schema provides it, so reading it returned 500 on every call to this
        # endpoint. Nothing can depend on the key, because it never answered.
        # If milestones are wanted they belong in compliance_actions beside the
        # actions above, under their own action_type.
        "resources_required": dp.resources_needed,
        "start_date": dp.start_date.isoformat() if dp.start_date else None,
        "end_date": dp.end_date.isoformat() if dp.end_date else None,
        "review_frequency": dp.review_frequency,
        "next_review_date": dp.next_review_date.isoformat() if dp.next_review_date else None,
        "last_review_date": dp.last_review_date.isoformat() if dp.last_review_date else None,
        "review_notes": dp.review_notes,
        "proposed_by": str(dp.proposed_by) if dp.proposed_by else None,
        "proposed_date": dp.proposed_date.isoformat() if dp.proposed_date else None,
        "status": dp.status,
        "approved_by": str(dp.approved_by) if dp.approved_by else None,
        "approved_at": dp.approval_date.isoformat() if dp.approval_date else None,
        "approval_note": dp.approval_note,
        "completion_date": dp.completion_date.isoformat() if dp.completion_date else None,
        "notes": dp.plan_note,
        "internal_note": dp.internal_note,
        "created_by": str(dp.created_by) if dp.created_by else None,
        "created_at": dp.created_at.isoformat() if dp.created_at else None,
        "updated_at": dp.updated_at.isoformat() if dp.updated_at else None,
    }


def _serialize_emergency_plan(ep: EmergencyPlan) -> dict:
    return {
        "plan_id": str(ep.plan_id),
        "organization_id": str(ep.organization_id),
        "plan_number": ep.plan_number,
        "title": ep.title,
        "plan_version": ep.plan_version,
        "facility_name": ep.facility_name,
        "facility_address": ep.facility_address,
        "covered_locations": ep.covered_locations,
        "risk_assessments": [
            {
                "assessment_id": str(ra.assessment_id),
                "risk_type": ra.risk_type,
                "likelihood": ra.likelihood,
                "impact": ra.impact,
                "risk_level": ra.risk_level,
                "description": ra.description,
                "mitigation_measures": ra.mitigation_measures,
                "responsible_party": ra.responsible_party,
                "review_date": ra.review_date.isoformat() if ra.review_date else None,
                "display_order": ra.display_order,
            }
            for ra in (ep.risk_assessments_list or [])
        ],
        "emergency_contacts": [
            {
                "contact_id": str(c.contact_id),
                "name": c.name,
                "title": c.title,
                "phone": c.phone,
                "phone_secondary": c.phone_secondary,
                "email": c.email,
                "role": c.role,
                "priority_order": c.priority_order,
                "available_24h": c.available_24h,
                "note": c.note,
            }
            for c in (ep.contacts or [])
        ],
        "external_services": [
            {
                "service_id": str(s.service_id),
                "service_type": s.service_type,
                "provider_name": s.provider_name,
                "phone": s.phone,
                "email": s.email,
                "address": s.address,
                "account_number": s.account_number,
                "response_time": s.response_time,
                "notes": s.notes,
                "display_order": s.display_order,
            }
            for s in (ep.external_services_list or [])
        ],
        "evacuation_routes": [
            {
                "route_id": str(r.route_id),
                "route_name": r.route_name,
                "description": r.description,
                "floor_plan_reference": r.floor_plan_reference,
                "accessibility_notes": r.accessibility_notes,
                "priority_order": r.priority_order,
            }
            for r in (ep.evacuation_routes_list or [])
        ],
        "assembly_points": [
            {
                "point_id": str(p.point_id),
                "name": p.name,
                "description": p.description,
                "location_reference": p.location_reference,
                "capacity": p.capacity,
                "accessibility_notes": p.accessibility_notes,
                "display_order": p.display_order,
            }
            for p in (ep.assembly_points_list or [])
        ],
        "evacuation_procedures": ep.evacuation_procedures,
        "site_plan_references": ep.site_plan_references,
        "floor_plan_references": ep.floor_plan_references,
        "equipment_inventory": [
            {
                "item_id": str(eq.item_id),
                "equipment_type": eq.equipment_type,
                "name": eq.name,
                "location": eq.location,
                "quantity": eq.quantity,
                "condition": eq.condition,
                "last_inspection_date": eq.last_inspection_date.isoformat() if eq.last_inspection_date else None,
                "next_inspection_date": eq.next_inspection_date.isoformat() if eq.next_inspection_date else None,
                "notes": eq.notes,
                "display_order": eq.display_order,
            }
            for eq in (ep.equipment or [])
        ],
        "salvage_priority_guidance": ep.salvage_priority_guidance,
        "response_procedures": ep.response_procedures,
        "recovery_procedures": ep.recovery_procedures,
        "training_requirements": ep.training_requirements,
        "last_drill_date": ep.last_drill_date.isoformat() if ep.last_drill_date else None,
        "next_drill_date": ep.next_drill_date.isoformat() if ep.next_drill_date else None,
        "effective_date": ep.effective_date.isoformat() if ep.effective_date else None,
        "review_frequency": ep.review_frequency,
        "next_review_date": ep.next_review_date.isoformat() if ep.next_review_date else None,
        "last_review_date": ep.last_review_date.isoformat() if ep.last_review_date else None,
        "status": ep.status,
        "approved_by": str(ep.approved_by) if ep.approved_by else None,
        "approval_date": ep.approval_date.isoformat() if ep.approval_date else None,
        "plan_note": ep.plan_note,
        "created_by": str(ep.created_by) if ep.created_by else None,
        "created_at": ep.created_at.isoformat() if ep.created_at else None,
        "updated_at": ep.updated_at.isoformat() if ep.updated_at else None,
    }


# ============================================================================
# DOCUMENTATION PLANS (Procedure 9) — 6 routes
# ============================================================================


@router.get("/api/organizations/{org_id}/collections/documentation-plans", response_model=DocumentationPlanListResponse, summary="List documentation plans")
def list_documentation_plans(
    org_id: UUID,
    limit: int = Query(50, le=500),
    offset: int = Query(0, ge=0),
    status: str | None = None,
    plan_type: str | None = None,
    q: str | None = None,
    auth: AuthContext = Depends(require_permission(Permission.DOCUMENTATION_PLANS_VIEW)),
    db: Session = Depends(get_db),
):
    """List documentation plans."""
    query = db.query(DocumentationPlan).filter(
        DocumentationPlan.organization_id == org_id,
    )

    if status:
        query = query.filter(DocumentationPlan.status == status)
    if plan_type:
        query = query.filter(DocumentationPlan.plan_type == plan_type)
    if q:
        term = f"%{escape_ilike(q)}%"
        query = query.filter(or_(
            DocumentationPlan.plan_number.ilike(term, escape="\\"),
            DocumentationPlan.title.ilike(term, escape="\\"),
            DocumentationPlan.objectives.ilike(term, escape="\\"),
            DocumentationPlan.plan_note.ilike(term, escape="\\"),
        ))

    total = query.count()
    plans = query.order_by(DocumentationPlan.created_at.desc()).offset(offset).limit(limit).all()

    return {
        "items": [_serialize_documentation_plan(p) for p in plans],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("/api/organizations/{org_id}/collections/documentation-plans", response_model=DocumentationPlanOut, status_code=201, summary="Create documentation plan")
def create_documentation_plan(
    org_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.DOCUMENTATION_PLANS_CREATE)),
    db: Session = Depends(get_db),
):
    """Create documentation plan."""
    if not body.get("title"):
        raise HTTPException(status_code=400, detail="Missing: title")

    # Auto-generate plan number if not supplied
    plan_number = body.get("plan_number")
    if not plan_number:
        from app.services.sequence import next_sequential_number
        plan_number = next_sequential_number(db, org_id, 'DP', include_year=False, separator='-')

    user_uuid = auth.user_id

    plan = DocumentationPlan(
        organization_id=org_id,
        plan_number=plan_number,
        title=body["title"],
        plan_type=body.get("plan_type", "collection_wide"),
        scope_description=body.get("scope_description"),
        target_collections=body.get("target_collections"),
        target_object_types=body.get("target_object_types"),
        priority_criteria=body.get("priority_criteria"),
        objectives=body.get("objectives", ""),
        measurable_results=body.get("measurable_results"),
        actions=body.get("actions"),
        milestones=body.get("milestones"),
        resources_needed=body.get("resources_required"),
        start_date=body.get("start_date"),
        end_date=body.get("end_date"),
        review_frequency=body.get("review_frequency"),
        next_review_date=body.get("next_review_date"),
        status=body.get("status", "draft"),
        plan_note=body.get("notes"),
        internal_note=body.get("internal_note"),
        created_by=user_uuid,
        updated_by=user_uuid,
    )

    db.add(plan)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A plan with this number may already exist")

    db.refresh(plan)
    return _serialize_documentation_plan(plan)


@router.get("/api/organizations/{org_id}/collections/documentation-plans/{plan_id}", response_model=DocumentationPlanOut, summary="Get documentation plan")
def get_documentation_plan(
    org_id: UUID,
    plan_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.DOCUMENTATION_PLANS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get documentation plan."""
    plan = db.query(DocumentationPlan).filter(
        DocumentationPlan.plan_id == plan_id,
        DocumentationPlan.organization_id == org_id,
    ).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Documentation plan not found")

    return _serialize_documentation_plan(plan)


@router.put("/api/organizations/{org_id}/collections/documentation-plans/{plan_id}", response_model=DocumentationPlanOut, summary="Update documentation plan")
def update_documentation_plan(
    org_id: UUID,
    plan_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.DOCUMENTATION_PLANS_EDIT)),
    db: Session = Depends(get_db),
):
    """Update documentation plan."""
    plan = db.query(DocumentationPlan).filter(
        DocumentationPlan.plan_id == plan_id,
        DocumentationPlan.organization_id == org_id,
    ).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Documentation plan not found")

    protected = {"plan_id", "organization_id", "created_at", "created_by", "updated_by", "approved_by", "approved_at", "approval_date"}
    for key, value in body.items():
        if key in protected:
            continue
        model_key = _DOC_PLAN_API_TO_MODEL.get(key, key)
        if hasattr(plan, model_key):
            setattr(plan, model_key, value)

    plan.updated_by = auth.user_id
    plan.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(plan)
    return _serialize_documentation_plan(plan)


@router.post("/api/organizations/{org_id}/collections/documentation-plans/{plan_id}/approve", response_model=DocumentationPlanOut, summary="Approve documentation plan")
def approve_documentation_plan(
    org_id: UUID,
    plan_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.DOCUMENTATION_PLANS_APPROVE)),
    db: Session = Depends(get_db),
):
    """Approve documentation plan."""
    plan = db.query(DocumentationPlan).filter(
        DocumentationPlan.plan_id == plan_id,
        DocumentationPlan.organization_id == org_id,
    ).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Documentation plan not found")

    if plan.status != "draft":
        raise HTTPException(status_code=400, detail=f"Cannot approve plan with status '{plan.status}'")

    plan.status = "approved"
    plan.approved_by = auth.user_id
    plan.approval_date = date.today()
    plan.updated_by = auth.user_id
    plan.updated_at = datetime.now(timezone.utc)

    db.commit()

    try:
        notify_approval(org_id, "documentation_plan", plan.plan_id, plan.title, auth.user_id, entity=plan)
    except Exception:
        logger.warning("Failed to send approval notification for documentation plan %s", plan_id)

    db.refresh(plan)
    return _serialize_documentation_plan(plan)


@router.delete("/api/organizations/{org_id}/collections/documentation-plans/{plan_id}", response_model=MessageResponse, summary="Delete documentation plan")
def delete_documentation_plan(
    org_id: UUID,
    plan_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.DOCUMENTATION_PLANS_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete documentation plan."""
    plan = db.query(DocumentationPlan).filter(
        DocumentationPlan.plan_id == plan_id,
        DocumentationPlan.organization_id == org_id,
    ).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Documentation plan not found")

    if plan.status not in ("draft", "completed"):
        raise HTTPException(status_code=400, detail=f"Cannot delete plan with status '{plan.status}'")

    db.delete(plan)
    db.commit()
    return {"message": "Documentation plan deleted successfully"}


# ============================================================================
# EMERGENCY PLANS (Procedure 15) — 6 routes
# ============================================================================


@router.get("/api/organizations/{org_id}/collections/emergency-plans", response_model=EmergencyPlanListResponse, summary="List emergency plans")
def list_emergency_plans(
    org_id: UUID,
    limit: int = Query(50, le=500),
    offset: int = Query(0, ge=0),
    status: str | None = None,
    q: str | None = None,
    auth: AuthContext = Depends(require_permission(Permission.EMERGENCY_PLANS_VIEW)),
    db: Session = Depends(get_db),
):
    """List emergency plans."""
    query = db.query(EmergencyPlan).filter(
        EmergencyPlan.organization_id == org_id,
    )

    if status:
        query = query.filter(EmergencyPlan.status == status)
    if q:
        term = f"%{escape_ilike(q)}%"
        query = query.filter(or_(
            EmergencyPlan.plan_number.ilike(term, escape="\\"),
            EmergencyPlan.title.ilike(term, escape="\\"),
            EmergencyPlan.plan_note.ilike(term, escape="\\"),
        ))

    total = query.count()
    plans = query.order_by(EmergencyPlan.created_at.desc()).offset(offset).limit(limit).all()

    return {
        "items": [_serialize_emergency_plan(p) for p in plans],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("/api/organizations/{org_id}/collections/emergency-plans", response_model=EmergencyPlanOut, status_code=201, summary="Create emergency plan")
def create_emergency_plan(
    org_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.EMERGENCY_PLANS_CREATE)),
    db: Session = Depends(get_db),
):
    """Create emergency plan."""
    if not body.get("title"):
        raise HTTPException(status_code=400, detail="Missing: title")

    plan_number = body.get("plan_number")
    if not plan_number:
        from app.services.sequence import next_sequential_number
        plan_number = next_sequential_number(db, org_id, 'EP', include_year=False, separator='-')

    user_uuid = auth.user_id

    plan = EmergencyPlan(
        organization_id=org_id,
        plan_number=plan_number,
        title=body["title"],
        plan_version=body.get("plan_version", "1.0"),
        facility_name=body.get("facility_name"),
        facility_address=body.get("facility_address"),
        covered_locations=body.get("covered_locations"),
        response_procedures=body.get("response_procedures"),
        salvage_priority_guidance=body.get("salvage_priority_guidance"),
        recovery_procedures=body.get("recovery_procedures"),
        training_requirements=body.get("training_requirements"),
        last_drill_date=body.get("last_drill_date"),
        next_drill_date=body.get("next_drill_date"),
        next_review_date=body.get("next_review_date"),
        status=body.get("status", "draft"),
        plan_note=body.get("plan_note") or body.get("notes"),
        created_by=user_uuid,
        updated_by=user_uuid,
    )

    db.add(plan)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A plan with this number may already exist")

    # Create child records from request body
    from app.models import (EmergencyRiskAssessment, EmergencyPlanContact,
                            EmergencyExternalService, EmergencyEvacuationRoute,
                            EmergencyAssemblyPoint, EmergencyEquipment)

    for idx, item in enumerate(body.get("risk_assessments") or []):
        db.add(EmergencyRiskAssessment(
            organization_id=plan.organization_id, plan_id=plan.plan_id,
            risk_type=item.get("type", item.get("risk_type", "unspecified")),
            likelihood=item.get("likelihood"), impact=item.get("impact"),
            description=item.get("description"),
            mitigation_measures=item.get("mitigation_measures"),
            display_order=idx,
        ))
    for idx, item in enumerate(body.get("emergency_contacts") or []):
        db.add(EmergencyPlanContact(
            organization_id=plan.organization_id, plan_id=plan.plan_id,
            name=item.get("name", "unnamed"),
            phone=item.get("phone"), email=item.get("email"),
            role=item.get("role"), priority_order=idx,
        ))
    for idx, item in enumerate(body.get("external_services") or []):
        db.add(EmergencyExternalService(
            organization_id=plan.organization_id, plan_id=plan.plan_id,
            service_type=item.get("service_type", "other"),
            provider_name=item.get("provider_name", item.get("provider", "unnamed")),
            phone=item.get("phone"), email=item.get("email"),
            display_order=idx,
        ))
    for idx, item in enumerate(body.get("evacuation_routes") or []):
        db.add(EmergencyEvacuationRoute(
            organization_id=plan.organization_id, plan_id=plan.plan_id,
            route_name=item.get("route_name"),
            description=item.get("description"),
            priority_order=idx,
        ))
    for idx, item in enumerate(body.get("assembly_points") or []):
        db.add(EmergencyAssemblyPoint(
            organization_id=plan.organization_id, plan_id=plan.plan_id,
            name=item.get("name", item.get("location", "unnamed")),
            description=item.get("description"),
            capacity=item.get("capacity"),
            display_order=idx,
        ))
    for idx, item in enumerate(body.get("equipment_inventory") or []):
        db.add(EmergencyEquipment(
            organization_id=plan.organization_id, plan_id=plan.plan_id,
            equipment_type=item.get("type", item.get("equipment_type", "other")),
            name=item.get("name"),
            location=item.get("location"),
            quantity=item.get("quantity"),
            display_order=idx,
        ))

    db.commit()
    db.refresh(plan)
    return _serialize_emergency_plan(plan)


@router.get("/api/organizations/{org_id}/collections/emergency-plans/{plan_id}", response_model=EmergencyPlanOut, summary="Get emergency plan")
def get_emergency_plan(
    org_id: UUID,
    plan_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EMERGENCY_PLANS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get emergency plan."""
    plan = db.query(EmergencyPlan).filter(
        EmergencyPlan.plan_id == plan_id,
        EmergencyPlan.organization_id == org_id,
    ).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Emergency plan not found")

    return _serialize_emergency_plan(plan)


@router.put("/api/organizations/{org_id}/collections/emergency-plans/{plan_id}", response_model=EmergencyPlanOut, summary="Update emergency plan")
def update_emergency_plan(
    org_id: UUID,
    plan_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.EMERGENCY_PLANS_EDIT)),
    db: Session = Depends(get_db),
):
    """Update emergency plan."""
    plan = db.query(EmergencyPlan).filter(
        EmergencyPlan.plan_id == plan_id,
        EmergencyPlan.organization_id == org_id,
    ).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Emergency plan not found")

    protected = {"plan_id", "organization_id", "created_at", "created_by", "updated_by", "approved_by", "approved_at", "approval_date"}
    for key, value in body.items():
        if key in protected:
            continue
        model_key = _EMERGENCY_PLAN_API_TO_MODEL.get(key, key)
        if hasattr(plan, model_key):
            setattr(plan, model_key, value)

    plan.updated_by = auth.user_id
    plan.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(plan)
    return _serialize_emergency_plan(plan)


@router.post("/api/organizations/{org_id}/collections/emergency-plans/{plan_id}/approve", response_model=EmergencyPlanOut, summary="Approve emergency plan")
def approve_emergency_plan(
    org_id: UUID,
    plan_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EMERGENCY_PLANS_APPROVE)),
    db: Session = Depends(get_db),
):
    """Approve emergency plan."""
    plan = db.query(EmergencyPlan).filter(
        EmergencyPlan.plan_id == plan_id,
        EmergencyPlan.organization_id == org_id,
    ).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Emergency plan not found")

    if plan.status != "draft":
        raise HTTPException(status_code=400, detail=f"Cannot approve plan with status '{plan.status}'")

    plan.status = "approved"
    plan.approved_by = auth.user_id
    plan.approval_date = date.today()
    plan.updated_by = auth.user_id
    plan.updated_at = datetime.now(timezone.utc)

    db.commit()

    try:
        notify_approval(org_id, "emergency_plan", plan.plan_id, plan.title, auth.user_id, entity=plan)
    except Exception:
        logger.warning("Failed to send approval notification for emergency plan %s", plan_id)

    db.refresh(plan)
    return _serialize_emergency_plan(plan)


@router.delete("/api/organizations/{org_id}/collections/emergency-plans/{plan_id}", response_model=MessageResponse, summary="Delete emergency plan")
def delete_emergency_plan(
    org_id: UUID,
    plan_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EMERGENCY_PLANS_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete emergency plan."""
    plan = db.query(EmergencyPlan).filter(
        EmergencyPlan.plan_id == plan_id,
        EmergencyPlan.organization_id == org_id,
    ).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Emergency plan not found")

    if plan.status not in ("draft", "archived"):
        raise HTTPException(status_code=400, detail=f"Cannot delete plan with status '{plan.status}'")

    db.delete(plan)
    db.commit()
    return {"message": "Emergency plan deleted successfully"}
