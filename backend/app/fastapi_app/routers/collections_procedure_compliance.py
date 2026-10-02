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

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.models import (
    CollectionObject,
    CollectionsReview,
    ObjectReviewAssessment,
    AuditCampaign,
    AuditResult,
)
from app.permissions import Permission
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
        "start_date": ac.planned_start_date.isoformat() if ac.planned_start_date else None,
        "end_date": ac.planned_end_date.isoformat() if ac.planned_end_date else None,
        "items_total": ac.objects_total,
        "items_audited": ac.objects_audited,
        "discrepancies_found": ac.discrepancies_found,
        "accuracy_rate": float(ac.accuracy_rate) if ac.accuracy_rate else None,
        "findings_summary": ac.findings_summary,
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
        "documentation_issues": ar.documentation_issues,
        "discrepancy_found": ar.result_status == "discrepancy",
        "discrepancy_type": ar.discrepancy_type,
        "discrepancy_description": ar.location_discrepancy_note,
        "resolution_status": ar.follow_up_action,
        "resolution_notes": ar.follow_up_note,
        "resolved_at": ar.follow_up_date.isoformat() if ar.follow_up_date else None,
        "notes": ar.result_note,
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
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A review with this number may already exist")

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
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="An assessment for this object already exists in this review")

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
        created_by_id=user_uuid,
        updated_by_id=user_uuid,
    )

    db.add(audit)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="An audit with this number may already exist")

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
    }
    for key, value in body.items():
        if key in protected:
            continue
        model_key = _AUDIT_API_TO_MODEL.get(key, key)
        if model_key == "audit_lead_id" and value is not None:
            value = UUID(value) if isinstance(value, str) else value
        if hasattr(audit, model_key):
            setattr(audit, model_key, value)

    audit.updated_by_id = auth.user_id
    audit.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(audit)
    return _serialize_audit_campaign(audit)


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

    # Update audit counters
    audit.objects_audited = (audit.objects_audited or 0) + 1
    if has_discrepancy:
        audit.discrepancies_found = (audit.discrepancies_found or 0) + 1

    # Recalculate accuracy rate
    if audit.objects_audited > 0:
        audit.accuracy_rate = ((audit.objects_audited - audit.discrepancies_found) / audit.objects_audited) * 100

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A result for this object/location may already exist")

    db.refresh(result)
    return _serialize_audit_result(result)
