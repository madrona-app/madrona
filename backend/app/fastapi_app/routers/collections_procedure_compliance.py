"""
Collections Compliance API endpoints (FastAPI).

Provides CRUD for:
- Collections Reviews (Procedure 20) — 6 routes
- Audit Campaigns + Results (Procedure 21) — 6 routes

Migrated from app/api/collections_cdwa_procedure.py.

Key side effects:
  Review assessments: increments review.objects_reviewed.
  Audit results: increments audit.objects_audited, discrepancies_found,
    recalculates accuracy_rate.
"""

import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, object_session

from app.fastapi_app.integrity_errors import integrity_http_error
from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.models import (
    CollectionObject,
    Location,
    ObjectTitle,
    CollectionsReview,
    ObjectReviewAssessment,
    AuditCampaign,
    AuditResult,
)
from app.permissions import Permission
from app.services.audit_checklist_service import (
    CheckListError,
    apply_check_outcome,
    generate_check_list,
    outcome_of,
    recompute_campaign_counters,
)
from app.services.api_security import escape_ilike
from app.services.validation_utils import parse_uuid_or_raise
from app.fastapi_app.schemas.collections_procedure_compliance import (
    CollectionsReviewOut,
    CollectionsReviewListResponse,
    ObjectReviewAssessmentOut,
    AssessmentListResponse,
    AuditCampaignOut,
    AuditCampaignListResponse,
    AuditResultOut,
    AuditResultListResponse,
    CheckListItemOut,
    CheckListResponse,
    BulkUpdateResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["collections-procedure-compliance"])


# ============================================================================
# FIELD MAPPINGS
# ============================================================================

_REVIEW_API_TO_MODEL = {
    "scope": "scope_description",
    "start_date": "planned_start_date",
    "end_date": "planned_end_date",
    "lead_reviewer": "review_lead_id",
    "notes": "review_note",
}

_AUDIT_API_TO_MODEL = {
    "audit_number": "campaign_number",
    "scope": "scope_description",
    "start_date": "planned_start_date",
    "end_date": "planned_end_date",
    "lead_auditor": "audit_lead_id",
    "items_total": "objects_total",
    "items_audited": "objects_audited",
    "notes": "campaign_note",
}


# ============================================================================
# SERIALIZERS
# ============================================================================

def _serialize_collections_review(cr: CollectionsReview) -> dict:
    return {
        "review_id": str(cr.review_id),
        "organization_id": str(cr.organization_id),
        "review_number": cr.review_number,
        "title": cr.title,
        "review_type": cr.review_type,
        "review_reason": cr.review_reason,
        "scope": cr.scope_description,
        "methodology": cr.methodology,
        "assessment_criteria": cr.assessment_criteria,
        "scoring_guidance": cr.scoring_guidance,
        "start_date": cr.planned_start_date.isoformat() if cr.planned_start_date else None,
        "end_date": cr.planned_end_date.isoformat() if cr.planned_end_date else None,
        "objects_total": cr.objects_total,
        "objects_reviewed": cr.objects_reviewed,
        "findings_summary": cr.findings_summary,
        "recommendations": cr.recommendations,
        "follow_up_actions": None,
        "status": cr.status,
        "lead_reviewer": str(cr.review_lead_id) if cr.review_lead_id else None,
        "notes": cr.review_note,
        "created_by": str(cr.created_by_id) if cr.created_by_id else None,
        "created_at": cr.created_at.isoformat() if cr.created_at else None,
        "updated_at": cr.updated_at.isoformat() if cr.updated_at else None,
    }


def _serialize_object_review_assessment(ora: ObjectReviewAssessment) -> dict:
    return {
        "assessment_id": str(ora.assessment_id),
        "review_id": str(ora.review_id),
        "object_id": str(ora.object_id),
        "reviewer_id": str(ora.assessed_by_id) if ora.assessed_by_id else None,
        "reviewed_at": ora.assessed_date.isoformat() if ora.assessed_date else None,
        "scores": ora.scores,
        "overall_score": float(ora.overall_score) if ora.overall_score else None,
        "recommendation": ora.recommendation,
        "justification": ora.recommendation_rationale,
        "follow_up_required": ora.follow_up_required,
        # follow_up_notes is gone: it read ora.follow_up_actions, which no
        # column in any table provides, so listing assessments raised
        # AttributeError and returned 500 on every call. No client can be
        # relying on the key, because the endpoint has never once answered.
        # follow_up_required and notes below carry the surviving fields.
        "notes": ora.assessment_note,
    }


def _get_remedial_actions(ac: AuditCampaign) -> list[dict]:
    """Query remedial actions from the polymorphic compliance_actions table."""
    from app.models.compliance import ComplianceAction
    db = object_session(ac)
    if not db:
        return []
    actions = db.query(ComplianceAction).filter(
        ComplianceAction.entity_type == "audit_campaign",
        ComplianceAction.entity_id == ac.campaign_id,
        ComplianceAction.action_type == "remedial",
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


def _save_remedial_actions(db: Session, audit: AuditCampaign, body: dict, user_id) -> None:
    """remedial_actions from the form (one per line) or as records -> rows."""
    if "remedial_actions" not in body:
        return
    from app.services.compliance_actions import action_items, save_actions

    save_actions(
        db,
        organization_id=audit.organization_id,
        entity_type="audit_campaign",
        entity_id=audit.campaign_id,
        action_type="remedial",
        desired=action_items(body.get("remedial_actions")),
        user_id=user_id,
    )


def _serialize_audit_campaign(ac: AuditCampaign) -> dict:
    return {
        "audit_id": str(ac.campaign_id),
        "organization_id": str(ac.organization_id),
        "audit_number": ac.campaign_number,
        "title": ac.title,
        "audit_type": ac.audit_type,
        "scope": ac.scope_description,
        "methodology": ac.methodology,
        "sample_method": ac.sample_method,
        "sample_size": ac.sample_size,
        "sample_percentage": float(ac.sample_percentage) if ac.sample_percentage else None,
        "sampling_criteria": ac.sampling_criteria,
        "target_locations": ac.target_locations,
        "target_object_types": ac.target_object_types,
        "check_list_seed": ac.check_list_seed,
        "check_list_generated_at": ac.check_list_generated_at.isoformat() if ac.check_list_generated_at else None,
        "check_list_generated_by": str(ac.check_list_generated_by_id) if ac.check_list_generated_by_id else None,
        "check_list_params": ac.check_list_params,
        "start_date": ac.planned_start_date.isoformat() if ac.planned_start_date else None,
        "end_date": ac.planned_end_date.isoformat() if ac.planned_end_date else None,
        "items_total": ac.objects_total,
        "items_audited": ac.objects_audited,
        "discrepancies_found": ac.discrepancies_found,
        "accuracy_rate": float(ac.accuracy_rate) if ac.accuracy_rate else None,
        "findings_summary": ac.findings_summary,
        # The form edits both; they were never returned, so every save
        # through the form blanked what the user had typed.
        "verification_procedures": ac.verification_procedures,
        "recommendations": ac.recommendations,
        "remedial_actions": _get_remedial_actions(ac),
        "status": ac.status,
        "lead_auditor": str(ac.audit_lead_id) if ac.audit_lead_id else None,
        "notes": ac.campaign_note,
        "created_by": str(ac.created_by_id) if ac.created_by_id else None,
        "created_at": ac.created_at.isoformat() if ac.created_at else None,
        "updated_at": ac.updated_at.isoformat() if ac.updated_at else None,
    }


def _serialize_audit_result(ar: AuditResult) -> dict:
    return {
        "result_id": str(ar.result_id),
        "audit_id": str(ar.campaign_id),
        "object_id": str(ar.object_id) if ar.object_id else None,
        "location_id": str(ar.location_id) if ar.location_id else None,
        "auditor_id": str(ar.verified_by_id) if ar.verified_by_id else None,
        "audited_at": ar.verification_date.isoformat() if ar.verification_date else None,
        "location_verified": ar.location_correct,
        "expected_location_id": str(ar.expected_location_id) if ar.expected_location_id else None,
        "actual_location_id": str(ar.actual_location_id) if ar.actual_location_id else None,
        "condition_verified": not ar.condition_changed if ar.condition_changed is not None else None,
        "expected_condition": ar.expected_condition,
        "actual_condition": ar.actual_condition,
        "documentation_verified": ar.documentation_complete,
        # No column backs this; reading ar.documentation_issues raised
        # AttributeError, so listing any campaign with results returned 500.
        "documentation_issues": None,
        "discrepancy_found": ar.result_status == "discrepancy",
        "discrepancy_type": ar.discrepancy_type,
        "discrepancy_description": ar.location_discrepancy_note,
        "resolution_status": ar.follow_up_action,
        "resolution_notes": ar.follow_up_note,
        "resolved_at": ar.follow_up_date.isoformat() if ar.follow_up_date else None,
        "notes": ar.result_note,
        "result_status": ar.result_status,
        "check_sequence": ar.check_sequence,
    }


# ============================================================================
# COLLECTIONS REVIEWS (Procedure 20) — 6 routes
# ============================================================================


@router.get("/api/organizations/{org_id}/collections/reviews", response_model=CollectionsReviewListResponse, summary="List collections reviews")
def list_collections_reviews(
    org_id: UUID,
    limit: int = Query(50, le=500),
    offset: int = Query(0, ge=0),
    status: str | None = None,
    review_type: str | None = None,
    q: str | None = None,
    auth: AuthContext = Depends(require_permission(Permission.REVIEWS_VIEW)),
    db: Session = Depends(get_db),
):
    """List collections reviews."""
    query = db.query(CollectionsReview).filter(
        CollectionsReview.organization_id == org_id,
    )

    if status:
        query = query.filter(CollectionsReview.status == status)
    if review_type:
        query = query.filter(CollectionsReview.review_type == review_type)
    if q:
        term = f"%{escape_ilike(q)}%"
        query = query.filter(or_(
            CollectionsReview.review_number.ilike(term, escape="\\"),
            CollectionsReview.title.ilike(term, escape="\\"),
            CollectionsReview.scope_description.ilike(term, escape="\\"),
            CollectionsReview.review_note.ilike(term, escape="\\"),
        ))

    total = query.count()
    reviews = query.order_by(CollectionsReview.created_at.desc()).offset(offset).limit(limit).all()

    return {
        "items": [_serialize_collections_review(r) for r in reviews],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("/api/organizations/{org_id}/collections/reviews", response_model=CollectionsReviewOut, status_code=201, summary="Create collections review")
def create_collections_review(
    org_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.REVIEWS_CREATE)),
    db: Session = Depends(get_db),
):
    """Create collections review."""
    if not body.get("title"):
        raise HTTPException(status_code=400, detail="Missing: title")
    if not body.get("review_type"):
        raise HTTPException(status_code=400, detail="Missing: review_type")

    from app.services.lookup_fields import check_lookup_values
    check_lookup_values(db, org_id, CollectionsReview, body)

    review_number = body.get("review_number")
    if not review_number:
        from app.services.sequence import next_sequential_number
        review_number = next_sequential_number(db, org_id, 'REV', include_year=False, separator='-')

    user_uuid = auth.user_id

    lead_reviewer = body.get("lead_reviewer")
    if lead_reviewer:
        lead_reviewer = UUID(lead_reviewer) if isinstance(lead_reviewer, str) else lead_reviewer
    else:
        lead_reviewer = user_uuid

    review = CollectionsReview(
        organization_id=org_id,
        review_number=review_number,
        title=body["title"],
        review_type=body["review_type"],
        scope_description=body.get("scope"),
        methodology=body.get("methodology"),
        assessment_criteria=body.get("assessment_criteria"),
        scoring_guidance=body.get("scoring_guidance"),
        planned_start_date=body.get("start_date"),
        planned_end_date=body.get("end_date"),
        objects_total=body.get("objects_total", 0),
        objects_reviewed=0,
        status=body.get("status", "draft"),
        review_lead_id=lead_reviewer,
        review_note=body.get("notes"),
        created_by_id=user_uuid,
        updated_by_id=user_uuid,
    )

    db.add(review)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise integrity_http_error(exc, "A review with this number may already exist") from None

    db.refresh(review)
    return _serialize_collections_review(review)


@router.get("/api/organizations/{org_id}/collections/reviews/{review_id}", response_model=CollectionsReviewOut, summary="Get collections review")
def get_collections_review(
    org_id: UUID,
    review_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.REVIEWS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get collections review."""
    review = db.query(CollectionsReview).filter(
        CollectionsReview.review_id == review_id,
        CollectionsReview.organization_id == org_id,
    ).first()
    if not review:
        raise HTTPException(status_code=404, detail="Collections review not found")

    return _serialize_collections_review(review)


@router.put("/api/organizations/{org_id}/collections/reviews/{review_id}", response_model=CollectionsReviewOut, summary="Update collections review")
def update_collections_review(
    org_id: UUID,
    review_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.REVIEWS_EDIT)),
    db: Session = Depends(get_db),
):
    """Update collections review."""
    review = db.query(CollectionsReview).filter(
        CollectionsReview.review_id == review_id,
        CollectionsReview.organization_id == org_id,
    ).first()
    if not review:
        raise HTTPException(status_code=404, detail="Collections review not found")

    from app.services.lookup_fields import check_lookup_values
    check_lookup_values(db, org_id, CollectionsReview, body, current=review)

    # Attribute names, not column names — see the note in
    # collections_procedure_rights.py. CollectionsReview maps
    # `approved_by_id` onto the column "approved_by".
    protected = {
        "review_id", "organization_id", "created_at", "created_by", "created_by_id",
        "updated_by_id", "approved_by", "approved_by_id", "review_lead_id",
    }
    for key, value in body.items():
        if key in protected:
            continue
        model_key = _REVIEW_API_TO_MODEL.get(key, key)
        if model_key == "review_lead_id" and value is not None:
            value = UUID(value) if isinstance(value, str) else value
        if hasattr(review, model_key):
            setattr(review, model_key, value)

    review.updated_by_id = auth.user_id
    review.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(review)
    return _serialize_collections_review(review)


@router.get("/api/organizations/{org_id}/collections/reviews/{review_id}/assessments", response_model=AssessmentListResponse, summary="List review assessments")
def list_review_assessments(
    org_id: UUID,
    review_id: UUID,
    limit: int = Query(50, le=500),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.REVIEWS_VIEW)),
    db: Session = Depends(get_db),
):
    """List review assessments."""
    review = db.query(CollectionsReview).filter(
        CollectionsReview.review_id == review_id,
        CollectionsReview.organization_id == org_id,
    ).first()
    if not review:
        raise HTTPException(status_code=404, detail="Collections review not found")

    query = db.query(ObjectReviewAssessment).filter(
        ObjectReviewAssessment.review_id == review_id,
    )

    total = query.count()
    assessments = query.order_by(ObjectReviewAssessment.assessed_date.desc()).offset(offset).limit(limit).all()

    return {
        "items": [_serialize_object_review_assessment(a) for a in assessments],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("/api/organizations/{org_id}/collections/reviews/{review_id}/assessments", response_model=ObjectReviewAssessmentOut, status_code=201, summary="Create review assessment")
def create_review_assessment(
    org_id: UUID,
    review_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.REVIEWS_EDIT)),
    db: Session = Depends(get_db),
):
    """Create review assessment."""
    if not body.get("object_id"):
        raise HTTPException(status_code=400, detail="Missing: object_id")

    object_uuid = parse_uuid_or_raise(body["object_id"])

    review = db.query(CollectionsReview).filter(
        CollectionsReview.review_id == review_id,
        CollectionsReview.organization_id == org_id,
    ).first()
    if not review:
        raise HTTPException(status_code=404, detail="Collections review not found")

    obj = db.query(CollectionObject).filter(
        CollectionObject.object_id == object_uuid,
        CollectionObject.organization_id == org_id,
    ).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Object not found")

    overall_score = None
    if body.get("overall_score") is not None:
        overall_score = float(body["overall_score"])

    assessment = ObjectReviewAssessment(
        review_id=review_id,
        organization_id=org_id,
        object_id=object_uuid,
        scores=body.get("scores"),
        overall_score=overall_score,
        recommendation=body.get("recommendation"),
        recommendation_rationale=body.get("justification"),
        follow_up_required=body.get("follow_up_required", False),
        assessment_note=body.get("notes"),
        assessed_by_id=auth.user_id,
    )

    db.add(assessment)

    # Increment reviewed count
    review.objects_reviewed = (review.objects_reviewed or 0) + 1

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise integrity_http_error(exc, "An assessment for this object already exists in this review") from None

    db.refresh(assessment)
    return _serialize_object_review_assessment(assessment)


# ============================================================================
# AUDIT CAMPAIGNS + RESULTS (Procedure 21) — 6 routes
# ============================================================================


@router.get("/api/organizations/{org_id}/collections/audits", response_model=AuditCampaignListResponse, summary="List audit campaigns")
def list_audit_campaigns(
    org_id: UUID,
    limit: int = Query(50, le=500),
    offset: int = Query(0, ge=0),
    status: str | None = None,
    audit_type: str | None = None,
    q: str | None = None,
    auth: AuthContext = Depends(require_permission(Permission.AUDITS_VIEW)),
    db: Session = Depends(get_db),
):
    """List audit campaigns."""
    query = db.query(AuditCampaign).filter(
        AuditCampaign.organization_id == org_id,
    )

    if status:
        query = query.filter(AuditCampaign.status == status)
    if audit_type:
        query = query.filter(AuditCampaign.audit_type == audit_type)
    if q:
        term = f"%{escape_ilike(q)}%"
        query = query.filter(or_(
            AuditCampaign.campaign_number.ilike(term, escape="\\"),
            AuditCampaign.title.ilike(term, escape="\\"),
            AuditCampaign.scope_description.ilike(term, escape="\\"),
            AuditCampaign.campaign_note.ilike(term, escape="\\"),
        ))

    total = query.count()
    audits = query.order_by(AuditCampaign.created_at.desc()).offset(offset).limit(limit).all()

    return {
        "items": [_serialize_audit_campaign(a) for a in audits],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("/api/organizations/{org_id}/collections/audits", response_model=AuditCampaignOut, status_code=201, summary="Create audit campaign")
def create_audit_campaign(
    org_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.AUDITS_CREATE)),
    db: Session = Depends(get_db),
):
    """Create audit campaign."""
    if not body.get("title"):
        raise HTTPException(status_code=400, detail="Missing: title")
    if not body.get("audit_type"):
        raise HTTPException(status_code=400, detail="Missing: audit_type")

    from app.services.lookup_fields import check_lookup_values
    check_lookup_values(db, org_id, AuditCampaign, body)

    audit_number = body.get("audit_number")
    if not audit_number:
        from app.services.sequence import next_sequential_number
        audit_number = next_sequential_number(db, org_id, 'AUD', include_year=False, separator='-')

    user_uuid = auth.user_id

    lead_auditor = body.get("lead_auditor")
    if lead_auditor:
        lead_auditor = UUID(lead_auditor) if isinstance(lead_auditor, str) else lead_auditor
    else:
        lead_auditor = user_uuid

    sample_percentage = None
    if body.get("sample_percentage") is not None:
        sample_percentage = float(body["sample_percentage"])

    audit = AuditCampaign(
        organization_id=org_id,
        campaign_number=audit_number,
        title=body["title"],
        audit_type=body["audit_type"],
        scope_description=body.get("scope"),
        methodology=body.get("methodology"),
        sample_method=body.get("sample_method"),
        sample_size=body.get("sample_size"),
        sample_percentage=sample_percentage,
        planned_start_date=body.get("start_date"),
        planned_end_date=body.get("end_date"),
        objects_total=body.get("items_total", 0),
        objects_audited=0,
        discrepancies_found=0,
        status=body.get("status", "draft"),
        audit_lead_id=lead_auditor,
        campaign_note=body.get("notes"),
        sampling_criteria=body.get("sampling_criteria"),
        verification_procedures=body.get("verification_procedures"),
        findings_summary=body.get("findings_summary"),
        recommendations=body.get("recommendations"),
        created_by_id=user_uuid,
        updated_by_id=user_uuid,
    )

    db.add(audit)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise integrity_http_error(exc, "An audit with this number already exists") from None
    _save_remedial_actions(db, audit, body, user_uuid)
    db.commit()

    db.refresh(audit)
    return _serialize_audit_campaign(audit)


@router.get("/api/organizations/{org_id}/collections/audits/{audit_id}", response_model=AuditCampaignOut, summary="Get audit campaign")
def get_audit_campaign(
    org_id: UUID,
    audit_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.AUDITS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get audit campaign."""
    audit = db.query(AuditCampaign).filter(
        AuditCampaign.campaign_id == audit_id,
        AuditCampaign.organization_id == org_id,
    ).first()
    if not audit:
        raise HTTPException(status_code=404, detail="Audit campaign not found")

    return _serialize_audit_campaign(audit)


@router.put("/api/organizations/{org_id}/collections/audits/{audit_id}", response_model=AuditCampaignOut, summary="Update audit campaign")
def update_audit_campaign(
    org_id: UUID,
    audit_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.AUDITS_EDIT)),
    db: Session = Depends(get_db),
):
    """Update audit campaign."""
    audit = db.query(AuditCampaign).filter(
        AuditCampaign.campaign_id == audit_id,
        AuditCampaign.organization_id == org_id,
    ).first()
    if not audit:
        raise HTTPException(status_code=404, detail="Audit campaign not found")

    from app.services.lookup_fields import check_lookup_values
    check_lookup_values(db, org_id, AuditCampaign, body, current=audit)

    # Attribute names, not column names. AuditCampaign maps `approved_by_id`
    # and `signed_off_by_id` onto the columns "approved_by"/"signed_off_by";
    # sign-off is a registrar's attestation that an inventory was completed.
    protected = {
        # "audit_id" is the API-facing name; the mapped attribute — and the
        # primary key — is campaign_id, so the deny-list was not protecting the
        # PK at all and a PUT could rewrite it.
        "audit_id", "campaign_id",
        "organization_id", "created_at", "created_by", "created_by_id",
        "updated_by_id", "approved_by", "approved_by_id",
        "signed_off_by", "signed_off_by_id", "audit_lead_id",
        # Written only by check-list generation, so a list stays reproducible.
        "check_list_seed", "check_list_generated_at", "check_list_generated_by",
        "check_list_generated_by_id", "check_list_params",
    }
    # Status moves through approve / start / complete; the only status a plain
    # update may set is "cancelled" (from any status but completed).
    if "status" in body and body["status"] != audit.status:
        if body["status"] != "cancelled":
            raise HTTPException(status_code=422, detail={
                "code": "validation_error", "field": "status",
                "message": "Use Approve, Start or Complete to change a campaign's status; only cancelling is an update.",
            })
        if audit.status == "completed":
            raise HTTPException(status_code=409, detail={"code": "conflict", "message": "A completed campaign cannot be cancelled"})
    for key, value in body.items():
        if key in protected:
            continue
        model_key = _AUDIT_API_TO_MODEL.get(key, key)
        if model_key == "audit_lead_id" and value is not None:
            value = UUID(value) if isinstance(value, str) else value
        if model_key == "remedial_actions":
            continue
        if hasattr(audit, model_key):
            setattr(audit, model_key, value)
    _save_remedial_actions(db, audit, body, auth.user_id)

    audit.updated_by_id = auth.user_id
    audit.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(audit)
    return _serialize_audit_campaign(audit)


def _get_audit(db: Session, org_id: UUID, audit_id: UUID) -> AuditCampaign:
    audit = db.query(AuditCampaign).filter(
        AuditCampaign.campaign_id == audit_id,
        AuditCampaign.organization_id == org_id,
    ).first()
    if not audit:
        raise HTTPException(status_code=404, detail="Audit campaign not found")
    return audit


def _transition(audit: AuditCampaign, allowed_from: tuple[str, ...], to: str, verb: str) -> None:
    if audit.status not in allowed_from:
        raise HTTPException(status_code=409, detail={
            "code": "invalid_transition",
            "message": f"A campaign that is {audit.status.replace('_', ' ')} cannot be {verb}.",
            "current_status": audit.status,
        })
    audit.status = to


@router.post("/api/organizations/{org_id}/collections/audits/{audit_id}/approve", response_model=AuditCampaignOut, summary="Approve audit campaign")
def approve_audit_campaign(
    org_id: UUID,
    audit_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.AUDITS_APPROVE)),
    db: Session = Depends(get_db),
):
    """Draft -> approved. The person who created the campaign cannot approve it."""
    audit = _get_audit(db, org_id, audit_id)
    if audit.created_by_id and audit.created_by_id == auth.user_id:
        raise HTTPException(status_code=403, detail={
            "code": "forbidden", "message": "Someone other than the campaign's creator must approve it.",
        })
    _transition(audit, ("draft",), "approved", "approved")
    audit.approved_by_id = auth.user_id
    audit.approval_date = datetime.now(timezone.utc).date()
    audit.updated_by_id = auth.user_id
    audit.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(audit)
    return _serialize_audit_campaign(audit)


@router.post("/api/organizations/{org_id}/collections/audits/{audit_id}/start", response_model=AuditCampaignOut, summary="Start audit campaign")
def start_audit_campaign(
    org_id: UUID,
    audit_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.AUDITS_EDIT)),
    db: Session = Depends(get_db),
):
    """Approved -> in progress; records the actual start date."""
    audit = _get_audit(db, org_id, audit_id)
    _transition(audit, ("approved",), "in_progress", "started")
    audit.actual_start_date = audit.actual_start_date or datetime.now(timezone.utc).date()
    audit.updated_by_id = auth.user_id
    audit.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(audit)
    return _serialize_audit_campaign(audit)


@router.post("/api/organizations/{org_id}/collections/audits/{audit_id}/complete", response_model=AuditCampaignOut, summary="Complete audit campaign")
def complete_audit_campaign(
    org_id: UUID,
    audit_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.AUDITS_EDIT)),
    db: Session = Depends(get_db),
):
    """In progress -> completed, signed off by the caller.

    Refused while objects on the check list are still unchecked: an audit is
    complete when every listed object has a result (found, not found, ...).
    """
    audit = _get_audit(db, org_id, audit_id)
    if audit.status == "in_progress":
        pending = db.query(AuditResult).filter(
            AuditResult.campaign_id == audit.campaign_id,
            AuditResult.result_status == "pending",
        ).count()
        if pending:
            raise HTTPException(status_code=409, detail={
                "code": "checks_pending",
                "message": f"{pending} object{'s' if pending != 1 else ''} on the check list "
                           f"{'have' if pending != 1 else 'has'} not been checked yet.",
                "pending": pending,
            })
    _transition(audit, ("in_progress",), "completed", "completed")
    today = datetime.now(timezone.utc).date()
    audit.actual_end_date = today
    audit.signed_off_by_id = auth.user_id
    audit.sign_off_date = today
    audit.updated_by_id = auth.user_id
    audit.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(audit)
    return _serialize_audit_campaign(audit)


@router.delete("/api/organizations/{org_id}/collections/audits/{audit_id}", response_model=dict, summary="Delete audit campaign")
def delete_audit_campaign(
    org_id: UUID,
    audit_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.AUDITS_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete a draft or cancelled campaign that has no recorded checks.

    Campaigns that were run are audit evidence: they can be cancelled, never
    deleted.
    """
    audit = _get_audit(db, org_id, audit_id)
    if audit.status not in ("draft", "cancelled"):
        raise HTTPException(status_code=409, detail={
            "code": "conflict",
            "message": "Only draft or cancelled campaigns can be deleted. Cancel this campaign instead.",
        })
    recorded = db.query(AuditResult).filter(
        AuditResult.campaign_id == audit.campaign_id,
        AuditResult.result_status != "pending",
    ).count()
    if recorded:
        raise HTTPException(status_code=409, detail={
            "code": "conflict",
            "message": f"This campaign has {recorded} recorded check{'s' if recorded != 1 else ''} and is kept as audit evidence.",
        })
    db.delete(audit)
    db.commit()
    return {"success": True}


@router.get("/api/organizations/{org_id}/collections/audits/{audit_id}/results", response_model=AuditResultListResponse, summary="List audit results")
def list_audit_results(
    org_id: UUID,
    audit_id: UUID,
    limit: int = Query(50, le=500),
    offset: int = Query(0, ge=0),
    discrepancy_only: str = "false",
    auth: AuthContext = Depends(require_permission(Permission.AUDITS_VIEW)),
    db: Session = Depends(get_db),
):
    """List audit results."""
    audit = db.query(AuditCampaign).filter(
        AuditCampaign.campaign_id == audit_id,
        AuditCampaign.organization_id == org_id,
    ).first()
    if not audit:
        raise HTTPException(status_code=404, detail="Audit campaign not found")

    query = db.query(AuditResult).filter(
        AuditResult.campaign_id == audit_id,
    )

    if discrepancy_only.lower() == "true":
        query = query.filter(AuditResult.result_status == "discrepancy")

    total = query.count()
    results = query.order_by(AuditResult.verification_date.desc()).offset(offset).limit(limit).all()

    return {
        "items": [_serialize_audit_result(r) for r in results],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("/api/organizations/{org_id}/collections/audits/{audit_id}/results", response_model=AuditResultOut, status_code=201, summary="Create audit result")
def create_audit_result(
    org_id: UUID,
    audit_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.AUDITS_EDIT)),
    db: Session = Depends(get_db),
):
    """Create audit result."""
    if not body.get("object_id") and not body.get("location_id"):
        raise HTTPException(status_code=400, detail="Missing: object_id or location_id")

    audit = db.query(AuditCampaign).filter(
        AuditCampaign.campaign_id == audit_id,
        AuditCampaign.organization_id == org_id,
    ).first()
    if not audit:
        raise HTTPException(status_code=404, detail="Audit campaign not found")

    object_uuid = parse_uuid_or_raise(body["object_id"]) if body.get("object_id") else None
    location_uuid = parse_uuid_or_raise(body["location_id"]) if body.get("location_id") else None
    expected_loc = parse_uuid_or_raise(body["expected_location_id"]) if body.get("expected_location_id") else None
    actual_loc = parse_uuid_or_raise(body["actual_location_id"]) if body.get("actual_location_id") else None

    # Determine if discrepancy
    location_correct = body.get("location_verified", True)
    condition_changed = not body.get("condition_verified", True)
    documentation_complete = body.get("documentation_verified", True)

    has_discrepancy = body.get("discrepancy_found", False)
    if not location_correct or condition_changed or not documentation_complete:
        has_discrepancy = True

    result_status = "discrepancy" if has_discrepancy else "verified"

    result = AuditResult(
        campaign_id=audit_id,
        organization_id=org_id,
        object_id=object_uuid,
        location_id=location_uuid,
        verified=not has_discrepancy,
        verified_by_id=auth.user_id,
        expected_location_id=expected_loc,
        actual_location_id=actual_loc,
        location_correct=location_correct,
        expected_condition=body.get("expected_condition"),
        actual_condition=body.get("actual_condition"),
        condition_changed=condition_changed,
        documentation_complete=documentation_complete,
        result_status=result_status,
        discrepancy_type=body.get("discrepancy_type"),
        location_discrepancy_note=body.get("discrepancy_description"),
        follow_up_required=has_discrepancy,
        follow_up_action=body.get("resolution_status", "unresolved") if has_discrepancy else None,
        follow_up_note=body.get("notes"),
        result_note=body.get("notes"),
    )

    db.add(result)

    try:
        # Counters are derived from the results so generated check lists,
        # barcode scans and ad hoc results all agree.
        recompute_campaign_counters(db, audit)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise integrity_http_error(exc, "A result for this object/location may already exist") from None

    db.refresh(result)
    return _serialize_audit_result(result)


# ============================================================================
# CHECK LISTS — generate a sampled list, record found / not found / moved
# ============================================================================


def _get_campaign_or_404(db: Session, org_id: UUID, audit_id: UUID) -> AuditCampaign:
    audit = db.query(AuditCampaign).filter(
        AuditCampaign.campaign_id == audit_id,
        AuditCampaign.organization_id == org_id,
    ).first()
    if not audit:
        raise HTTPException(status_code=404, detail="Audit campaign not found")
    return audit


def _check_list_error(exc: CheckListError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail={"code": exc.code, "message": str(exc)})


def _preferred_titles(db: Session, object_ids: list) -> dict:
    """object_id -> preferred title (else lowest display_order)."""
    if not object_ids:
        return {}
    rows = db.query(ObjectTitle.object_id, ObjectTitle.title, ObjectTitle.is_preferred, ObjectTitle.display_order).filter(
        ObjectTitle.object_id.in_(object_ids),
    ).all()
    best: dict = {}
    for r in rows:
        rank = (0 if r.is_preferred else 1, r.display_order or 0)
        if r.object_id not in best or rank < best[r.object_id][0]:
            best[r.object_id] = (rank, r.title)
    return {k: v[1] for k, v in best.items()}


def _check_list_rows(db: Session, results: list[AuditResult]) -> list[dict]:
    object_ids = [r.object_id for r in results if r.object_id]
    objects = {}
    if object_ids:
        for o in db.query(
            CollectionObject.object_id, CollectionObject.object_number,
            CollectionObject.object_name, CollectionObject.current_location_id,
        ).filter(CollectionObject.object_id.in_(object_ids)).all():
            objects[o.object_id] = o
    titles = _preferred_titles(db, object_ids)

    loc_ids = set()
    for r in results:
        loc_ids.update(x for x in (r.expected_location_id, r.actual_location_id) if x)
    locations = {}
    if loc_ids:
        for loc in db.query(Location.location_id, Location.name, Location.path).filter(Location.location_id.in_(loc_ids)).all():
            locations[loc.location_id] = loc

    def loc(field):
        found = locations.get(field) if field else None
        return (found.name if found else None, found.path if found else None)

    rows = []
    for r in results:
        obj = objects.get(r.object_id)
        exp_name, exp_path = loc(r.expected_location_id)
        act_name, act_path = loc(r.actual_location_id)
        rows.append({
            "result_id": str(r.result_id),
            "check_sequence": r.check_sequence,
            "object_id": str(r.object_id) if r.object_id else None,
            "object_number": obj.object_number if obj else None,
            "title": titles.get(r.object_id) or (obj.object_name if obj else None),
            "expected_location_id": str(r.expected_location_id) if r.expected_location_id else None,
            "expected_location_name": exp_name,
            "expected_location_path": exp_path,
            "actual_location_id": str(r.actual_location_id) if r.actual_location_id else None,
            "actual_location_name": act_name,
            "actual_location_path": act_path,
            "current_location_id": str(obj.current_location_id) if obj and obj.current_location_id else None,
            "outcome": outcome_of(r),
            "result_status": r.result_status,
            "checked_at": r.verification_date.isoformat() if r.verification_date and r.result_status != "pending" else None,
            "checked_by": str(r.verified_by_id) if r.verified_by_id else None,
            "note": r.result_note,
            "follow_up_action": r.follow_up_action,
        })
    return rows


@router.get(
    "/api/organizations/{org_id}/collections/audits/{audit_id}/check-list",
    response_model=CheckListResponse,
    summary="Get audit check list",
)
def get_check_list(
    org_id: UUID,
    audit_id: UUID,
    limit: int = Query(5000, ge=1, le=5000),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.AUDITS_VIEW)),
    db: Session = Depends(get_db),
):
    """The campaign's check list in walking order, with how it was drawn."""
    audit = _get_campaign_or_404(db, org_id, audit_id)

    base = db.query(AuditResult).filter(AuditResult.campaign_id == audit_id)
    total = base.count()
    counts = {"pending": 0, "found": 0, "not_found": 0, "wrong_location": 0, "other": 0}
    for status, dtype, loc_ok in db.query(
        AuditResult.result_status, AuditResult.discrepancy_type, AuditResult.location_correct,
    ).filter(AuditResult.campaign_id == audit_id).all():
        if status == "pending":
            counts["pending"] += 1
        elif status == "not_found":
            counts["not_found"] += 1
        elif dtype == "location_mismatch" or loc_ok is False:
            counts["wrong_location"] += 1
        elif status == "verified":
            counts["found"] += 1
        else:
            counts["other"] += 1

    results = base.order_by(
        AuditResult.check_sequence.asc().nulls_last(),
        AuditResult.verification_date.asc(),
    ).offset(offset).limit(limit).all()

    return {
        "audit_id": str(audit.campaign_id),
        "generated_at": audit.check_list_generated_at.isoformat() if audit.check_list_generated_at else None,
        "generated_by": str(audit.check_list_generated_by_id) if audit.check_list_generated_by_id else None,
        "seed": audit.check_list_seed,
        "params": audit.check_list_params,
        "total": total,
        "checked": total - counts["pending"],
        "counts": counts,
        "items": _check_list_rows(db, results),
        "limit": limit,
        "offset": offset,
    }


@router.post(
    "/api/organizations/{org_id}/collections/audits/{audit_id}/check-list/generate",
    response_model=CheckListResponse,
    summary="Generate audit check list",
)
def generate_audit_check_list(
    org_id: UUID,
    audit_id: UUID,
    body: dict | None = None,
    auth: AuthContext = Depends(require_permission(Permission.AUDITS_EDIT)),
    db: Session = Depends(get_db),
):
    """Draw the check list from the campaign's scope and sampling method.

    Body (all optional): ``seed`` to reproduce an earlier draw, ``replace``
    true to replace an unchecked list. Refused once any check is recorded.
    """
    body = body or {}
    audit = _get_campaign_or_404(db, org_id, audit_id)

    seed = body.get("seed")
    if seed is not None:
        try:
            seed = int(seed)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail={"code": "invalid_seed", "message": "Seed must be a whole number."})

    try:
        generate_check_list(db, audit, auth.user_id, seed=seed, replace=bool(body.get("replace")))
    except CheckListError as exc:
        db.rollback()
        raise _check_list_error(exc)
    db.commit()
    db.refresh(audit)
    return get_check_list(org_id, audit_id, limit=5000, offset=0, auth=auth, db=db)


@router.put(
    "/api/organizations/{org_id}/collections/audits/{audit_id}/check-list/{result_id}",
    response_model=CheckListItemOut,
    summary="Record a check",
)
def record_check(
    org_id: UUID,
    audit_id: UUID,
    result_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.AUDITS_EDIT)),
    db: Session = Depends(get_db),
):
    """Record one check: ``outcome`` is found, not_found, wrong_location, or
    pending (to undo). wrong_location needs ``actual_location_id``."""
    audit = _get_campaign_or_404(db, org_id, audit_id)
    if audit.status in ("completed", "cancelled"):
        raise HTTPException(status_code=409, detail={"code": "campaign_closed", "message": f"This campaign is {audit.status}; checks can't be changed."})

    result = db.query(AuditResult).filter(
        AuditResult.result_id == result_id,
        AuditResult.campaign_id == audit_id,
    ).first()
    if not result:
        raise HTTPException(status_code=404, detail="Check not found")

    actual = None
    if body.get("actual_location_id"):
        actual = parse_uuid_or_raise(body["actual_location_id"])
        exists = db.query(Location.location_id).filter(
            Location.location_id == actual,
            Location.organization_id == org_id,
        ).first()
        if not exists:
            raise HTTPException(status_code=404, detail={"code": "location_not_found", "message": "Found location not found"})

    try:
        apply_check_outcome(result, body.get("outcome", ""), auth.user_id, actual_location_id=actual, note=body.get("note"))
    except CheckListError as exc:
        raise _check_list_error(exc)

    recompute_campaign_counters(db, audit)
    audit.updated_by_id = auth.user_id
    audit.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(result)
    return _check_list_rows(db, [result])[0]


# ============================================================================
# BULK UPDATE FROM RESULTS — move records to found locations, mark inventoried
# ============================================================================


def _plan_bulk_update(db: Session, org_id: UUID, audit: AuditCampaign, body: dict, auth: AuthContext) -> dict:
    """Validate a bulk-update request and work out what each row would do."""
    from app.services.rbac_service import check_permission
    from app.services.bulk_movement_service import FieldWriteRestricted, ensure_object_fields_writable

    raw_ids = body.get("result_ids") or []
    if not isinstance(raw_ids, list) or not raw_ids:
        raise HTTPException(status_code=400, detail={"code": "no_selection", "message": "Select at least one result."})
    result_ids = [parse_uuid_or_raise(r) for r in raw_ids]
    update_location = bool(body.get("update_location"))
    mark_inv = bool(body.get("mark_inventoried"))
    if not update_location and not mark_inv:
        raise HTTPException(status_code=400, detail={"code": "no_operation", "message": "Choose at least one update to apply."})

    if update_location and not check_permission(str(auth.user_id), str(org_id), Permission.MOVEMENTS_CREATE, session=db):
        raise HTTPException(status_code=403, detail={"code": "forbidden", "message": "You don't have permission to record movements."})
    if mark_inv and not check_permission(str(auth.user_id), str(org_id), Permission.COLLECTIONS_EDIT, session=db):
        raise HTTPException(status_code=403, detail={"code": "forbidden", "message": "You don't have permission to edit object records."})
    fields = (["current_location_id"] if update_location else []) + (
        ["last_inventoried_date", "last_inventoried_by"] if mark_inv else []
    )
    try:
        ensure_object_fields_writable(db, org_id, auth.user_id, fields)
    except FieldWriteRestricted as exc:
        raise HTTPException(status_code=403, detail={"code": "field_restricted", "message": f"You don't have permission to change: {exc}"})

    results = db.query(AuditResult).filter(
        AuditResult.campaign_id == audit.campaign_id,
        AuditResult.result_id.in_(result_ids),
    ).all()
    if len(results) != len(set(result_ids)):
        raise HTTPException(status_code=404, detail={
            "code": "result_not_found",
            "message": "One or more selected results aren't part of this campaign.",
        })
    order = {rid: i for i, rid in enumerate(result_ids)}
    results.sort(key=lambda r: (r.check_sequence is None, r.check_sequence or 0, order[r.result_id]))

    object_ids = [r.object_id for r in results if r.object_id]
    objects = {
        o.object_id: o for o in db.query(CollectionObject).filter(
            CollectionObject.object_id.in_(object_ids),
            CollectionObject.organization_id == org_id,
        ).all()
    } if object_ids else {}
    loc_ids = {r.actual_location_id for r in results if r.actual_location_id}
    loc_ids |= {o.current_location_id for o in objects.values() if o.current_location_id}
    locations = {
        loc.location_id: loc for loc in db.query(Location).filter(
            Location.location_id.in_(loc_ids), Location.organization_id == org_id,
        ).all()
    } if loc_ids else {}
    titles = _preferred_titles(db, list(objects))

    rows = []
    for r in results:
        obj = objects.get(r.object_id)
        outcome = outcome_of(r)
        current = locations.get(obj.current_location_id) if obj and obj.current_location_id else None
        found = locations.get(r.actual_location_id) if r.actual_location_id else None
        out = {
            "result_id": str(r.result_id),
            "object_id": str(r.object_id) if r.object_id else None,
            "object_number": obj.object_number if obj else None,
            "title": titles.get(r.object_id) or (obj.object_name if obj else None),
            "outcome": outcome,
            "current_location_name": current.name if current else None,
            "found_location_name": found.name if found else None,
            "changes": [],
            "skipped": [],
        }
        row = {"result": r, "object": obj, "move_to": None, "inventory": False, "out": out}
        rows.append(row)
        if obj is None or obj.is_deleted:
            out["skipped"].append("The object record no longer exists.")
            continue
        if update_location:
            if outcome != "wrong_location":
                out["skipped"].append("Location: only wrong-location results have a found location to apply.")
            elif not found:
                out["skipped"].append("Location: the found location no longer exists.")
            elif obj.current_location_id == found.location_id:
                out["skipped"].append(f"Location: the record already shows {found.name}.")
            else:
                row["move_to"] = found
                out["changes"].append(
                    f"Record a movement from {current.name if current else 'no location'} to {found.name}."
                )
        if mark_inv:
            if outcome in ("found", "wrong_location"):
                row["inventory"] = True
                when = r.verification_date.date().isoformat() if r.verification_date else "today"
                out["changes"].append(f"Set last inventoried to {when}.")
            else:
                out["skipped"].append("Inventoried: the object wasn't seen in this check.")

    return {"update_location": update_location, "mark_inventoried": mark_inv, "rows": rows}


def _bulk_response(audit: AuditCampaign, plan: dict, executed: bool) -> dict:
    return {
        "audit_id": str(audit.campaign_id),
        "update_location": plan["update_location"],
        "mark_inventoried": plan["mark_inventoried"],
        "rows": [p["out"] for p in plan["rows"]],
        "location_update_count": sum(1 for p in plan["rows"] if p["move_to"] is not None),
        "inventoried_count": sum(1 for p in plan["rows"] if p["inventory"]),
        "skipped_count": sum(1 for p in plan["rows"] if p["move_to"] is None and not p["inventory"]),
        "executed": executed,
    }


@router.post(
    "/api/organizations/{org_id}/collections/audits/{audit_id}/check-list/bulk-update/preview",
    response_model=BulkUpdateResponse,
    summary="Preview bulk update from audit results",
)
def preview_bulk_update_from_results(
    org_id: UUID,
    audit_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.AUDITS_EDIT)),
    db: Session = Depends(get_db),
):
    """Show what applying the selected results would change, row by row.

    Body: ``result_ids``; ``update_location`` records a movement to the found
    location for wrong-location results; ``mark_inventoried`` sets last
    inventoried date/by from the check for objects that were seen.
    """
    audit = _get_campaign_or_404(db, org_id, audit_id)
    plan = _plan_bulk_update(db, org_id, audit, body, auth)
    return _bulk_response(audit, plan, executed=False)


@router.post(
    "/api/organizations/{org_id}/collections/audits/{audit_id}/check-list/bulk-update/execute",
    response_model=BulkUpdateResponse,
    summary="Apply bulk update from audit results",
)
def execute_bulk_update_from_results(
    org_id: UUID,
    audit_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.AUDITS_EDIT)),
    db: Session = Depends(get_db),
):
    """Apply what preview showed. Movements go through the same service as
    the workspace record_movement bulk action; moved results are marked
    resolved (follow_up_action = location_updated)."""
    from datetime import date as date_cls
    from app.services.bulk_movement_service import (
        mark_inventoried,
        next_movement_base,
        record_bulk_movement,
    )

    audit = _get_campaign_or_404(db, org_id, audit_id)
    plan = _plan_bulk_update(db, org_id, audit, body, auth)

    reason = (body.get("reason") or "inventory").strip()[:50] or "inventory"
    note = body.get("movement_note") or f"Found in this location during audit {audit.campaign_number}"

    # One record_bulk_movement call per destination.
    by_destination: dict = {}
    for p in plan["rows"]:
        if p["move_to"] is not None:
            by_destination.setdefault(p["move_to"].location_id, (p["move_to"], []))[1].append(p)
    base = next_movement_base(db, org_id)
    today = date_cls.today()
    for to_location, group in by_destination.values():
        results, _, _, used = record_bulk_movement(
            db, org_id, auth.user_id, [p["object"] for p in group], to_location,
            {"reason": reason, "movement_note": note}, skip_blocked=True, base_count=base,
        )
        base += used
        for p, res in zip(group, results):
            p["out"]["status"] = res["status"]
            if res["status"] == "success":
                p["out"]["movement_reference"] = res.get("reference_number")
                r = p["result"]
                r.follow_up_action = "location_updated"
                r.follow_up_completed = True
                r.follow_up_date = today
            else:
                p["out"]["message"] = res.get("message")

    inv_rows = [p for p in plan["rows"] if p["inventory"]]
    if inv_rows:
        mark_inventoried(
            db, org_id, auth.user_id,
            [(p["object"], p["result"].verification_date, p["result"].verified_by_id) for p in inv_rows],
        )
        for p in inv_rows:
            p["out"]["status"] = p["out"].get("status") or "success"

    for p in plan["rows"]:
        p["out"].setdefault("status", "skipped")

    audit.updated_by_id = auth.user_id
    audit.updated_at = datetime.now(timezone.utc)
    db.commit()

    # The search index carries current location; refresh moved objects.
    moved = [p["object"] for p in plan["rows"] if p["move_to"] is not None]
    if moved:
        try:
            from app.fastapi_app.serializers.collections_helpers import _index_collection_object
            for obj in moved:
                _index_collection_object(obj)
        except Exception:
            logger.warning("Could not re-index objects after audit bulk update", exc_info=True)

    return _bulk_response(audit, plan, executed=True)
