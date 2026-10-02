"""
Collections Condition Reports (Contacts) API endpoints (FastAPI).

Batch F — 7 routes:
  - Condition Reports CRUD (7 routes): create, list, get, update,
    complete, review, delete

Migrated from app/api/collections/contacts.py.
"""

import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.models import ConditionReport
from app.permissions import Permission
from app.services.api_security import escape_ilike
from app.services.rls import set_rls_context_for_session
from app.services.field_access_service import apply_field_access, get_write_restricted_fields
from app.services.entity_notifications import notify_status_change
from app.fastapi_app.schemas.collections_contacts import (
    ConditionReportOut,
    ConditionReportListResponse,
    ConditionReportDeleteResponse,
)
from app.fastapi_app.schemas.condition_reports import (
    CreateConditionReportRequest,
    UpdateConditionReportRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["collections-contacts"])


# ============================================================================
# SERIALIZER
# ============================================================================


def _serialize_condition_report(report: ConditionReport) -> dict:
    from app.fastapi_app.serializers.collections import _serialize_condition_report as _sr_condition_report
    return _sr_condition_report(report)


# ============================================================================
# CONDITION REPORT ENDPOINTS
# ============================================================================


@router.post("/api/organizations/{organization_id}/collections/condition-reports", status_code=201, response_model=ConditionReportOut, summary="Create condition report")
def create_condition_report(
    organization_id: str,
    body: CreateConditionReportRequest,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_CREATE)),
    db: Session = Depends(get_db),
):
    """Create a new condition report."""
    set_rls_context_for_session(db, organization_id)
    org_uuid = UUID(organization_id)

    has_object = body.object_id is not None
    has_linked_entity = body.linked_entity_type is not None and body.linked_entity_id is not None
    if not has_object and not has_linked_entity:
        raise HTTPException(status_code=400, detail="A condition report must be linked to an object or other entity")

    from app.services.sequence import next_sequential_number
    report_number = next_sequential_number(db, org_uuid, 'CR')

    from app.services.approval_service import check_approval_required, create_approval_request
    approval_rule = check_approval_required(org_uuid, 'condition_report', 'create', db)
    initial_status = "draft"

    from app.services.constituent_service import find_or_create_staff_constituent
    _examiner = find_or_create_staff_constituent(db, org_uuid, auth.user_id)
    report = ConditionReport(
        organization_id=org_uuid,
        report_number=report_number,
        report_type=body.report_type,
        report_date=datetime.now(timezone.utc).date(),
        # examiner_id references a constituent (the staff constituent for this user).
        examiner_id=_examiner.constituent_id if _examiner else None,
        examiner_name=body.examiner_name or None,
        object_id=body.object_id,
        linked_entity_type=body.linked_entity_type or None,
        linked_entity_id=body.linked_entity_id,
        overall_condition=body.overall_condition or None,
        condition_summary=body.condition_summary or None,
        detailed_findings=body.detailed_findings,
        hazards=body.hazards,
        recommendations=body.recommendations or None,
        conservation_needed=body.conservation_needed,
        conservation_priority=body.conservation_priority or None,
        handling_requirements=body.handling_requirements or None,
        packing_requirements=body.packing_requirements or None,
        display_restrictions=body.display_restrictions or None,
        report_note=body.report_note or None,
        status="pending_approval" if approval_rule else initial_status,
        created_by=auth.user_id,
        updated_by=auth.user_id,
    )

    db.add(report)
    db.flush()
    if approval_rule:
        create_approval_request(
            rule=approval_rule,
            entity_type='condition_report',
            entity_id=report.report_id,
            requested_by=auth.user_id,
            requested_action={"action": "create", "initial_status": initial_status},
            session=db,
        )
    db.commit()

    return _serialize_condition_report(report)


@router.get("/api/organizations/{organization_id}/collections/condition-reports", response_model=ConditionReportListResponse, summary="List condition reports")
def list_condition_reports(
    organization_id: str,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    object_id: str = Query(None),
    report_type: str = Query(None),
    status: str = Query(None),
    q: str = Query(""),
    auth: AuthContext = Depends(require_permission(Permission.CONDITION_REPORTS_VIEW)),
    db: Session = Depends(get_db),
):
    """List condition reports with filtering and search."""
    set_rls_context_for_session(db, organization_id)
    org_uuid = UUID(organization_id)

    query = db.query(ConditionReport).filter(ConditionReport.organization_id == org_uuid)

    search = q.strip()
    if search:
        search_term = f"%{escape_ilike(search)}%"
        query = query.filter(
            or_(
                ConditionReport.report_number.ilike(search_term, escape="\\"),
                ConditionReport.examiner_name.ilike(search_term, escape="\\"),
                ConditionReport.condition_summary.ilike(search_term, escape="\\"),
                ConditionReport.recommendations.ilike(search_term, escape="\\"),
                ConditionReport.report_note.ilike(search_term, escape="\\"),
            )
        )

    if object_id:
        query = query.filter(ConditionReport.object_id == UUID(object_id))
    if report_type:
        query = query.filter(ConditionReport.report_type == report_type)
    if status:
        query = query.filter(ConditionReport.status == status)

    total = query.count()
    reports = query.order_by(ConditionReport.report_date.desc()).offset(offset).limit(limit).all()

    return {
        "items": [
            apply_field_access(_serialize_condition_report(r), 'condition_report', organization_id, str(auth.user_id), session=db, role_override=auth.role_override)
            for r in reports
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/api/organizations/{organization_id}/collections/condition-reports/{report_id}", response_model=ConditionReportOut, summary="Get condition report")
def get_condition_report(
    organization_id: str,
    report_id: str,
    auth: AuthContext = Depends(require_permission(Permission.CONDITION_REPORTS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get a single condition report."""
    set_rls_context_for_session(db, organization_id)
    org_uuid = UUID(organization_id)

    report = db.query(ConditionReport).filter(
        ConditionReport.report_id == UUID(report_id),
        ConditionReport.organization_id == org_uuid,
    ).first()

    if not report:
        raise HTTPException(status_code=404, detail="Condition report not found")

    serialized = _serialize_condition_report(report)
    filtered = apply_field_access(serialized, "condition_report", organization_id, str(auth.user_id), session=db, role_override=auth.role_override)
    return filtered


@router.put("/api/organizations/{organization_id}/collections/condition-reports/{report_id}", response_model=ConditionReportOut, summary="Update condition report")
def update_condition_report(
    organization_id: str,
    report_id: str,
    body: UpdateConditionReportRequest,
    auth: AuthContext = Depends(require_permission(Permission.CONDITION_REPORTS_EDIT)),
    db: Session = Depends(get_db),
):
    """Update a condition report."""
    set_rls_context_for_session(db, organization_id)
    org_uuid = UUID(organization_id)

    report = db.query(ConditionReport).filter(
        ConditionReport.report_id == UUID(report_id),
        ConditionReport.organization_id == org_uuid,
    ).first()

    if not report:
        raise HTTPException(status_code=404, detail="Condition report not found")

    old_status = report.status

    check_constraint_fields = {"overall_condition", "conservation_priority", "linked_entity_type", "status"}
    protected_fields = {"report_id", "organization_id", "report_number", "created_at", "created_by", "updated_by"}
    protected_fields |= get_write_restricted_fields('condition_report', organization_id, str(auth.user_id), session=db, role_override=auth.role_override)

    updates = body.model_dump(exclude_unset=True)
    # Empty string clears a CHECK-constrained field (treat as NULL); normalize
    # before validating so "" isn't rejected as an out-of-set enum value.
    for _f in check_constraint_fields:
        if updates.get(_f) == "":
            updates[_f] = None
    from app.services.collections.field_enums import validate_enum_fields
    validate_enum_fields(ConditionReport, updates)
    for key, value in updates.items():
        if hasattr(report, key) and key not in protected_fields:
            if key in check_constraint_fields and value == "":
                value = None
            if key.endswith("_id") and value:
                setattr(report, key, UUID(str(value)) if not isinstance(value, UUID) else value)
            else:
                setattr(report, key, value)

    has_object = report.object_id is not None
    has_linked_entity = report.linked_entity_type is not None and report.linked_entity_id is not None
    if not has_object and not has_linked_entity:
        raise HTTPException(status_code=400, detail="A condition report must be linked to an object or other entity")

    report.updated_by = auth.user_id
    report.updated_at = datetime.now(timezone.utc)

    db.commit()

    if "status" in updates and report.status and report.status != old_status:
        notify_status_change(
            org_uuid, "condition_report", report.report_id, report.report_number,
            old_status or "draft", report.status, str(auth.user_id), entity=report,
        )

    return _serialize_condition_report(report)


@router.post("/api/organizations/{organization_id}/collections/condition-reports/{report_id}/complete", response_model=ConditionReportOut, summary="Complete condition report")
def complete_condition_report(
    organization_id: str,
    report_id: str,
    auth: AuthContext = Depends(require_permission(Permission.CONDITION_REPORTS_EDIT)),
    db: Session = Depends(get_db),
):
    """Mark a condition report as completed."""
    set_rls_context_for_session(db, organization_id)
    org_uuid = UUID(organization_id)

    report = db.query(ConditionReport).filter(
        ConditionReport.report_id == UUID(report_id),
        ConditionReport.organization_id == org_uuid,
    ).first()

    if not report:
        raise HTTPException(status_code=404, detail="Condition report not found")

    old_status = report.status
    report.status = "completed"
    report.updated_by = auth.user_id
    report.updated_at = datetime.now(timezone.utc)

    db.commit()

    notify_status_change(
        org_uuid, "condition_report", report.report_id, report.report_number,
        old_status or "draft", "completed", str(auth.user_id), entity=report,
    )

    return _serialize_condition_report(report)


@router.post("/api/organizations/{organization_id}/collections/condition-reports/{report_id}/review", response_model=ConditionReportOut, summary="Review condition report")
def review_condition_report(
    organization_id: str,
    report_id: str,
    auth: AuthContext = Depends(require_permission(Permission.CONDITION_REPORTS_REVIEW)),
    db: Session = Depends(get_db),
):
    """Mark a condition report as reviewed."""
    set_rls_context_for_session(db, organization_id)
    org_uuid = UUID(organization_id)

    report = db.query(ConditionReport).filter(
        ConditionReport.report_id == UUID(report_id),
        ConditionReport.organization_id == org_uuid,
    ).first()

    if not report:
        raise HTTPException(status_code=404, detail="Condition report not found")

    old_status = report.status
    report.status = "reviewed"
    report.reviewed_by = auth.user_id
    report.reviewed_date = datetime.now(timezone.utc).date()
    report.updated_by = auth.user_id
    report.updated_at = datetime.now(timezone.utc)

    db.commit()

    notify_status_change(
        org_uuid, "condition_report", report.report_id, report.report_number,
        old_status or "draft", "reviewed", str(auth.user_id), entity=report,
    )

    return _serialize_condition_report(report)


@router.delete("/api/organizations/{organization_id}/collections/condition-reports/{report_id}", response_model=ConditionReportDeleteResponse, summary="Delete condition report")
def delete_condition_report(
    organization_id: str,
    report_id: str,
    auth: AuthContext = Depends(require_permission(Permission.CONDITION_REPORTS_DELETE)),
    db: Session = Depends(get_db),
):
    """Delete a condition report."""
    set_rls_context_for_session(db, organization_id)
    org_uuid = UUID(organization_id)

    report = db.query(ConditionReport).filter(
        ConditionReport.report_id == UUID(report_id),
        ConditionReport.organization_id == org_uuid,
    ).first()

    if not report:
        raise HTTPException(status_code=404, detail="Condition report not found")

    db.delete(report)
    db.commit()

    return {"success": True, "message": "Condition report deleted successfully"}
