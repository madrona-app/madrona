"""
Insurance Management API endpoints (FastAPI) — Procedure 14.

Migrated from app/api/insurance.py (29 routes):
  - Policies CRUD + approve (6 routes)
  - Coverages CRUD + confirm (6 routes)
  - Entity-specific insurance lookups (4 routes)
  - Indemnities CRUD + submit + objects management (7 routes)
  - Claims CRUD + file + settle (6 routes)
  - Enums (1 route)
"""

import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse, Response
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.models import (
    InsurancePolicy,
    InsuranceCoverage,
    IndemnityArrangement,
    IndemnityObject,
    InsuranceClaim,
    PolicyType,
    PolicyStatus,
    CoveredEntityType,
    CoverageStatus,
    IndemnityProgram,
    IndemnityStatus,
    LossType,
    ClaimStatus,
    CollectionObject,
    LoanIn,
    LoanOut,
    ObjectEntry,
    ObjectExit,
    Movement,
    Shipment as ExhibitionShipment,
    Exhibition,
)
from app.permissions import Permission
from app.services.entity_notifications import notify_status_change, notify_approval
from app.fastapi_app.schemas.insurance import (
    InsuranceEnumsResponse,
    InsurancePolicyOut,
    InsurancePolicyListResponse,
    InsuranceCoverageOut,
    InsuranceCoverageListResponse,
    IndemnityArrangementOut,
    IndemnityListResponse,
    IndemnityObjectAddedResponse,
    InsuranceClaimOut,
    InsuranceClaimListResponse,
)
from app.fastapi_app.schemas.common import SuccessResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["insurance"])


def _parse_date(val):
    """Parse a date string or return None."""
    if val is None:
        return None
    if isinstance(val, str):
        return datetime.fromisoformat(val).date() if "T" in val else datetime.strptime(val, "%Y-%m-%d").date()
    return val


# ============================================================================
# HELPERS
# ============================================================================


def _get_covered_entity_reference(db: Session, entity_type: str, entity_id: str) -> dict:
    """Look up the referenced entity and return display info."""
    result = {
        "reference": None,
        "title": None,
        "url_path": None,
    }
    try:
        # The column is UUID; compare as UUID to avoid silent type-coercion
        # mismatches that drop rows on the way out of the query.
        try:
            entity_uuid = UUID(str(entity_id))
        except (ValueError, TypeError):
            return result
        entity_id = entity_uuid

        if entity_type == CoveredEntityType.COLLECTION_OBJECT:
            entity = db.query(CollectionObject).filter(
                CollectionObject.object_id == entity_id
            ).first()
            if entity:
                result["reference"] = entity.object_number
                # CollectionObject doesn't have a `title` column; the
                # canonical display string is object_name. (Accessing the
                # missing attribute used to AttributeError into the outer
                # `except Exception: pass`, leaving url_path null.)
                result["title"] = entity.object_name
                result["url_path"] = f"collections/objects/{entity_id}"

        elif entity_type == CoveredEntityType.LOAN_IN:
            entity = db.query(LoanIn).filter(LoanIn.loan_id == entity_id).first()
            if entity:
                result["reference"] = entity.loan_number or entity.reference_number
                result["title"] = entity.title or entity.lender_name
                result["url_path"] = f"collections/loans-in/{entity_id}"

        elif entity_type == CoveredEntityType.LOAN_OUT:
            entity = db.query(LoanOut).filter(LoanOut.loan_id == entity_id).first()
            if entity:
                result["reference"] = entity.loan_number or entity.reference_number
                result["title"] = entity.title or entity.borrower_name
                result["url_path"] = f"collections/loans-out/{entity_id}"

        elif entity_type == CoveredEntityType.SHIPMENT:
            entity = db.query(ExhibitionShipment).filter(
                ExhibitionShipment.shipment_id == entity_id
            ).first()
            if entity:
                result["reference"] = entity.shipment_number
                result["title"] = entity.remarks
                result["url_path"] = f"collections/shipments/{entity_id}"

        elif entity_type == CoveredEntityType.EXHIBITION:
            entity = db.query(Exhibition).filter(
                Exhibition.exhibition_id == entity_id
            ).first()
            if entity:
                result["reference"] = entity.exhibition_number
                result["title"] = entity.title
                result["url_path"] = f"exhibit/exhibitions/{entity_id}"

        elif entity_type == CoveredEntityType.MOVEMENT:
            entity = db.query(Movement).filter(
                Movement.movement_id == entity_id
            ).first()
            if entity:
                result["reference"] = entity.movement_number or entity.reference_number
                result["title"] = entity.reason
                result["url_path"] = f"collections/movements/{entity_id}"

        elif entity_type == CoveredEntityType.OBJECT_ENTRY:
            entity = db.query(ObjectEntry).filter(
                ObjectEntry.entry_id == entity_id
            ).first()
            if entity:
                result["reference"] = entity.entry_number
                result["title"] = entity.reason
                result["url_path"] = f"collections/object-entries/{entity_id}"

        elif entity_type == CoveredEntityType.OBJECT_EXIT:
            entity = db.query(ObjectExit).filter(
                ObjectExit.exit_id == entity_id
            ).first()
            if entity:
                result["reference"] = entity.exit_number
                result["title"] = entity.reason
                result["url_path"] = f"collections/object-exits/{entity_id}"

    except Exception:
        pass

    return result


# ============================================================================
# SERIALIZERS
# ============================================================================


def _serialize_policy(policy: InsurancePolicy, include_coverages: bool = False) -> dict:
    data = {
        "policy_id": str(policy.policy_id),
        "organization_id": str(policy.organization_id),
        "policy_number": policy.policy_number,
        "policy_name": policy.policy_name,
        "policy_type": policy.policy_type,
        "policy_type_label": PolicyType.LABELS.get(policy.policy_type, policy.policy_type),
        "provider_name": policy.provider_name,
        "provider_contact_id": str(policy.provider_contact_id) if policy.provider_contact_id else None,
        "broker_name": policy.broker_name,
        "effective_date": policy.effective_date.isoformat() if policy.effective_date else None,
        "expiration_date": policy.expiration_date.isoformat() if policy.expiration_date else None,
        "coverage_limit": float(policy.coverage_limit) if policy.coverage_limit else None,
        "coverage_limit_currency": policy.coverage_limit_currency,
        "per_occurrence_limit": float(policy.per_occurrence_limit) if policy.per_occurrence_limit else None,
        "deductible": float(policy.deductible) if policy.deductible else None,
        "annual_premium": float(policy.annual_premium) if policy.annual_premium else None,
        "status": policy.status,
        "status_label": PolicyStatus.LABELS.get(policy.status, policy.status),
        "renewal_of_policy_id": str(policy.renewal_of_policy_id) if policy.renewal_of_policy_id else None,
        "authorizer_id": str(policy.authorizer_id) if policy.authorizer_id else None,
        "authorization_date": policy.authorization_date.isoformat() if policy.authorization_date else None,
        "authorization_note": policy.authorization_note,
        "notes": policy.notes,
        "created_at": policy.created_at.isoformat() if policy.created_at else None,
        "updated_at": policy.updated_at.isoformat() if policy.updated_at else None,
        "is_active": policy.status == PolicyStatus.ACTIVE,
        "is_expired": policy.status == PolicyStatus.EXPIRED,
    }
    if include_coverages:
        data["coverages"] = [
            _serialize_coverage(c, include_policy=False, db=None)
            for c in (policy.coverages or [])
        ]
        data["coverage_count"] = len(policy.coverages or [])
    return data


def _serialize_coverage(
    coverage: InsuranceCoverage,
    include_policy: bool = True,
    include_entity: bool = True,
    db: Session | None = None,
) -> dict:
    data = {
        "coverage_id": str(coverage.coverage_id),
        "organization_id": str(coverage.organization_id),
        "policy_id": str(coverage.policy_id) if coverage.policy_id else None,
        "covered_entity_type": coverage.covered_entity_type,
        "covered_entity_type_label": CoveredEntityType.LABELS.get(
            coverage.covered_entity_type, coverage.covered_entity_type
        ),
        "covered_entity_id": str(coverage.covered_entity_id),
        "coverage_start_date": coverage.coverage_start_date.isoformat() if coverage.coverage_start_date else None,
        "coverage_end_date": coverage.coverage_end_date.isoformat() if coverage.coverage_end_date else None,
        "declared_value": float(coverage.declared_value) if coverage.declared_value else None,
        "agreed_value": float(coverage.agreed_value) if coverage.agreed_value else None,
        "value_currency": coverage.value_currency,
        "third_party_provider": coverage.third_party_provider,
        "third_party_policy_number": coverage.third_party_policy_number,
        "certificate_requested": coverage.certificate_requested,
        "certificate_received": coverage.certificate_received,
        "certificate_received_date": coverage.certificate_received_date.isoformat() if coverage.certificate_received_date else None,
        "certificate_number": coverage.certificate_number,
        "status": coverage.status,
        "status_label": CoverageStatus.LABELS.get(coverage.status, coverage.status),
        "notes": coverage.notes,
        "created_at": coverage.created_at.isoformat() if coverage.created_at else None,
        "updated_at": coverage.updated_at.isoformat() if coverage.updated_at else None,
        "is_third_party": coverage.third_party_provider is not None,
        "has_certificate": coverage.certificate_received,
    }
    if include_policy and coverage.policy:
        data["policy"] = {
            "policy_id": str(coverage.policy.policy_id),
            "policy_number": coverage.policy.policy_number,
            "policy_name": coverage.policy.policy_name,
            "provider_name": coverage.policy.provider_name,
        }
    if include_entity and db:
        entity_info = _get_covered_entity_reference(
            db, coverage.covered_entity_type, str(coverage.covered_entity_id)
        )
        data["covered_entity"] = entity_info
    return data


def _serialize_indemnity(indemnity: IndemnityArrangement, include_objects: bool = False) -> dict:
    data = {
        "indemnity_id": str(indemnity.indemnity_id),
        "organization_id": str(indemnity.organization_id),
        "program": indemnity.program,
        "program_label": IndemnityProgram.LABELS.get(indemnity.program, indemnity.program),
        "reference_number": indemnity.reference_number,
        "internal_reference": indemnity.internal_reference,
        "exhibition_id": str(indemnity.exhibition_id) if indemnity.exhibition_id else None,
        "loan_in_id": str(indemnity.loan_in_id) if indemnity.loan_in_id else None,
        "application_date": indemnity.application_date.isoformat() if indemnity.application_date else None,
        "requested_coverage": float(indemnity.requested_coverage) if indemnity.requested_coverage else None,
        "awarded_coverage": float(indemnity.awarded_coverage) if indemnity.awarded_coverage else None,
        "coverage_currency": indemnity.coverage_currency,
        "coverage_start_date": indemnity.coverage_start_date.isoformat() if indemnity.coverage_start_date else None,
        "coverage_end_date": indemnity.coverage_end_date.isoformat() if indemnity.coverage_end_date else None,
        "commercial_gap_required": indemnity.commercial_gap_required,
        "gap_coverage_id": str(indemnity.gap_coverage_id) if indemnity.gap_coverage_id else None,
        "status": indemnity.status,
        "status_label": IndemnityStatus.LABELS.get(indemnity.status, indemnity.status),
        "authorizer_id": str(indemnity.authorizer_id) if indemnity.authorizer_id else None,
        "authorization_date": indemnity.authorization_date.isoformat() if indemnity.authorization_date else None,
        "authorization_note": indemnity.authorization_note,
        "notes": indemnity.notes,
        "created_at": indemnity.created_at.isoformat() if indemnity.created_at else None,
        "updated_at": indemnity.updated_at.isoformat() if indemnity.updated_at else None,
    }
    if include_objects:
        data["objects"] = [
            {
                "link_id": str(obj.link_id),
                "object_id": str(obj.object_id),
                "object_number": obj.object_number,
                "object_title": obj.object_title,
                "declared_value": float(obj.declared_value) if obj.declared_value else None,
                "approved_value": float(obj.approved_value) if obj.approved_value else None,
                "value_currency": obj.value_currency,
            }
            for obj in (indemnity.objects or [])
        ]
        data["object_count"] = len(indemnity.objects or [])
        data["total_declared_value"] = sum(
            float(obj.declared_value or 0) for obj in (indemnity.objects or [])
        )
        data["total_approved_value"] = sum(
            float(obj.approved_value or 0) for obj in (indemnity.objects or [])
        )
    return data


def _serialize_claim(claim: InsuranceClaim) -> dict:
    return {
        "claim_id": str(claim.claim_id),
        "organization_id": str(claim.organization_id),
        "claim_number": claim.claim_number,
        "insurer_claim_number": claim.insurer_claim_number,
        "coverage_id": str(claim.coverage_id) if claim.coverage_id else None,
        "indemnity_id": str(claim.indemnity_id) if claim.indemnity_id else None,
        "incident_report_id": str(claim.incident_report_id) if claim.incident_report_id else None,
        "date_of_loss": claim.date_of_loss.isoformat() if claim.date_of_loss else None,
        "loss_description": claim.loss_description,
        "loss_type": claim.loss_type,
        "loss_type_label": LossType.LABELS.get(claim.loss_type, claim.loss_type) if claim.loss_type else None,
        "claimed_amount": float(claim.claimed_amount) if claim.claimed_amount else None,
        "settlement_amount": float(claim.settlement_amount) if claim.settlement_amount else None,
        "amount_currency": claim.amount_currency,
        "adjuster_name": claim.adjuster_name,
        "adjuster_contact": claim.adjuster_contact,
        "status": claim.status,
        "status_label": ClaimStatus.LABELS.get(claim.status, claim.status),
        "filed_date": claim.filed_date.isoformat() if claim.filed_date else None,
        "settled_date": claim.settled_date.isoformat() if claim.settled_date else None,
        "notes": claim.notes,
        "created_at": claim.created_at.isoformat() if claim.created_at else None,
        "updated_at": claim.updated_at.isoformat() if claim.updated_at else None,
    }


# ============================================================================
# POLICY ENDPOINTS
# ============================================================================


@router.get("/api/organizations/{org_id}/collections/insurance/enums", response_model=InsuranceEnumsResponse, summary="Get insurance enums")
def get_insurance_enums(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.INSURANCE_VIEW)),
    db: Session = Depends(get_db),
):
    """Get all insurance-related enums for dropdowns."""
    return {
        "policy_types": [
            {"value": t, "label": PolicyType.LABELS[t]} for t in PolicyType.ALL
        ],
        "policy_statuses": [
            {"value": s, "label": PolicyStatus.LABELS[s]} for s in PolicyStatus.ALL
        ],
        "covered_entity_types": [
            {"value": t, "label": CoveredEntityType.LABELS[t]} for t in CoveredEntityType.ALL
        ],
        "coverage_statuses": [
            {"value": s, "label": CoverageStatus.LABELS[s]} for s in CoverageStatus.ALL
        ],
        "indemnity_programs": [
            {"value": p, "label": IndemnityProgram.LABELS[p]} for p in IndemnityProgram.ALL
        ],
        "indemnity_statuses": [
            {"value": s, "label": IndemnityStatus.LABELS[s]} for s in IndemnityStatus.ALL
        ],
        "loss_types": [
            {"value": t, "label": LossType.LABELS[t]} for t in LossType.ALL
        ],
        "claim_statuses": [
            {"value": s, "label": ClaimStatus.LABELS[s]} for s in ClaimStatus.ALL
        ],
    }


@router.get("/api/organizations/{org_id}/collections/insurance/policies", response_model=InsurancePolicyListResponse, summary="List policies")
def list_policies(
    org_id: UUID,
    status: str = Query(None),
    policy_type: str = Query(None),
    active_only: str = Query(None),
    limit: int = Query(50, le=500),
    offset: int = Query(0),
    auth: AuthContext = Depends(require_permission(Permission.INSURANCE_VIEW)),
    db: Session = Depends(get_db),
):
    """List policies."""
    query = db.query(InsurancePolicy).filter(
        InsurancePolicy.organization_id == org_id
    )
    if status and status in PolicyStatus.ALL:
        query = query.filter(InsurancePolicy.status == status)
    if policy_type and policy_type in PolicyType.ALL:
        query = query.filter(InsurancePolicy.policy_type == policy_type)
    if active_only == "true":
        query = query.filter(InsurancePolicy.status.in_(PolicyStatus.ACTIVE_STATUSES))

    total = query.count()
    query = query.order_by(InsurancePolicy.expiration_date.desc())
    policies = query.offset(offset).limit(limit).all()

    return {
        "items": [_serialize_policy(p) for p in policies],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("/api/organizations/{org_id}/collections/insurance/policies", response_model=InsurancePolicyOut, status_code=201, summary="Create policy")
def create_policy(
    org_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.INSURANCE_CREATE)),
    db: Session = Depends(get_db),
):
    """Create policy."""
    if not body.get("policy_number"):
        raise HTTPException(status_code=422, detail="Policy number is required")
    if not body.get("provider_name"):
        raise HTTPException(status_code=422, detail="Provider name is required")
    if not body.get("effective_date"):
        raise HTTPException(status_code=422, detail="Effective date is required")
    if not body.get("expiration_date"):
        raise HTTPException(status_code=422, detail="Expiration date is required")

    existing = db.query(InsurancePolicy).filter(
        InsurancePolicy.organization_id == org_id,
        InsurancePolicy.policy_number == body["policy_number"],
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Policy number already exists")

    policy_type = body.get("policy_type", PolicyType.FINE_ARTS)
    if policy_type not in PolicyType.ALL:
        raise HTTPException(status_code=422, detail=f"Invalid policy_type. Must be one of: {PolicyType.ALL}")

    status = body.get("status", PolicyStatus.DRAFT)
    if status not in PolicyStatus.ALL:
        raise HTTPException(status_code=422, detail=f"Invalid status. Must be one of: {PolicyStatus.ALL}")

    from app.services.approval_service import check_approval_required, create_approval_request
    approval_rule = check_approval_required(org_id, 'insurance_policy', 'create', db)
    initial_status = status

    policy = InsurancePolicy(
        organization_id=org_id,
        policy_number=body["policy_number"],
        policy_name=body.get("policy_name"),
        policy_type=policy_type,
        provider_name=body["provider_name"],
        provider_contact_id=body.get("provider_contact_id"),
        broker_name=body.get("broker_name"),
        effective_date=_parse_date(body["effective_date"]),
        expiration_date=_parse_date(body["expiration_date"]),
        coverage_limit=body.get("coverage_limit"),
        coverage_limit_currency=body.get("coverage_limit_currency", "USD"),
        per_occurrence_limit=body.get("per_occurrence_limit"),
        deductible=body.get("deductible"),
        annual_premium=body.get("annual_premium"),
        status="pending_approval" if approval_rule else initial_status,
        renewal_of_policy_id=body.get("renewal_of_policy_id"),
        notes=body.get("notes"),
        created_by=auth.user_id,
        updated_by=auth.user_id,
    )
    db.add(policy)
    db.flush()
    if approval_rule:
        create_approval_request(
            rule=approval_rule,
            entity_type='insurance_policy',
            entity_id=policy.policy_id,
            requested_by=auth.user_id,
            requested_action={"action": "create", "initial_status": initial_status},
            session=db,
        )
    db.commit()
    db.refresh(policy)

    return _serialize_policy(policy)


@router.get("/api/organizations/{org_id}/collections/insurance/policies/{policy_id}", response_model=InsurancePolicyOut, summary="Get policy")
def get_policy(
    org_id: UUID,
    policy_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.INSURANCE_VIEW)),
    db: Session = Depends(get_db),
):
    """Get policy."""
    policy = db.query(InsurancePolicy).filter(
        InsurancePolicy.policy_id == policy_id,
        InsurancePolicy.organization_id == org_id,
    ).first()
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")
    return _serialize_policy(policy, include_coverages=True)


@router.patch("/api/organizations/{org_id}/collections/insurance/policies/{policy_id}", response_model=InsurancePolicyOut, summary="Update policy")
def update_policy(
    org_id: UUID,
    policy_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.INSURANCE_EDIT)),
    db: Session = Depends(get_db),
):
    """Update policy."""
    policy = db.query(InsurancePolicy).filter(
        InsurancePolicy.policy_id == policy_id,
        InsurancePolicy.organization_id == org_id,
    ).first()
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")

    if "policy_number" in body:
        existing = db.query(InsurancePolicy).filter(
            InsurancePolicy.organization_id == org_id,
            InsurancePolicy.policy_number == body["policy_number"],
            InsurancePolicy.policy_id != policy_id,
        ).first()
        if existing:
            raise HTTPException(status_code=409, detail="Policy number already exists")
        policy.policy_number = body["policy_number"]

    if "policy_name" in body:
        policy.policy_name = body["policy_name"]
    if "policy_type" in body:
        if body["policy_type"] not in PolicyType.ALL:
            raise HTTPException(status_code=422, detail="Invalid policy_type")
        policy.policy_type = body["policy_type"]
    if "provider_name" in body:
        policy.provider_name = body["provider_name"]
    if "provider_contact_id" in body:
        policy.provider_contact_id = body["provider_contact_id"]
    if "broker_name" in body:
        policy.broker_name = body["broker_name"]
    if "effective_date" in body:
        policy.effective_date = _parse_date(body["effective_date"])
    if "expiration_date" in body:
        policy.expiration_date = _parse_date(body["expiration_date"])
    if "coverage_limit" in body:
        policy.coverage_limit = body["coverage_limit"]
    if "coverage_limit_currency" in body:
        policy.coverage_limit_currency = body["coverage_limit_currency"]
    if "per_occurrence_limit" in body:
        policy.per_occurrence_limit = body["per_occurrence_limit"]
    if "deductible" in body:
        policy.deductible = body["deductible"]
    if "annual_premium" in body:
        policy.annual_premium = body["annual_premium"]
    if "status" in body:
        if body["status"] not in PolicyStatus.ALL:
            raise HTTPException(status_code=422, detail="Invalid status")
        policy.status = body["status"]
    if "renewal_of_policy_id" in body:
        policy.renewal_of_policy_id = body["renewal_of_policy_id"]
    if "authorizer_id" in body:
        policy.authorizer_id = body["authorizer_id"] or None
    if "authorization_date" in body:
        policy.authorization_date = _parse_date(body["authorization_date"])
    if "authorization_note" in body:
        policy.authorization_note = body["authorization_note"]
    if "notes" in body:
        policy.notes = body["notes"]

    policy.updated_at = datetime.now(timezone.utc)
    policy.updated_by = auth.user_id
    db.commit()
    db.refresh(policy)

    return _serialize_policy(policy, include_coverages=True)


@router.delete("/api/organizations/{org_id}/collections/insurance/policies/{policy_id}", summary="Delete policy")
def delete_policy(
    org_id: UUID,
    policy_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.INSURANCE_DELETE)),
    db: Session = Depends(get_db),
):
    """Delete policy."""
    policy = db.query(InsurancePolicy).filter(
        InsurancePolicy.policy_id == policy_id,
        InsurancePolicy.organization_id == org_id,
    ).first()
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")

    db.delete(policy)
    db.commit()
    return Response(status_code=204)


@router.post("/api/organizations/{org_id}/collections/insurance/policies/{policy_id}/approve", response_model=InsurancePolicyOut, summary="Approve policy")
def approve_policy(
    org_id: UUID,
    policy_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.INSURANCE_APPROVE)),
    db: Session = Depends(get_db),
):
    """Approve policy."""
    policy = db.query(InsurancePolicy).filter(
        InsurancePolicy.policy_id == policy_id,
        InsurancePolicy.organization_id == org_id,
    ).first()
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")

    if policy.status not in [PolicyStatus.DRAFT, PolicyStatus.PENDING_APPROVAL]:
        raise HTTPException(status_code=400, detail="Policy cannot be approved from current status")

    policy.status = PolicyStatus.ACTIVE
    policy.updated_at = datetime.now(timezone.utc)
    policy.updated_by = auth.user_id
    db.commit()

    try:
        notify_approval(
            str(org_id), "insurance_policy", policy.policy_id,
            policy.policy_number, str(auth.user_id), entity=policy,
        )
    except Exception:
        logger.warning("Failed to send approval notification for policy %s", policy_id)

    return _serialize_policy(policy)


# ============================================================================
# COVERAGE ENDPOINTS
# ============================================================================


@router.get("/api/organizations/{org_id}/collections/insurance/coverages", response_model=InsuranceCoverageListResponse, summary="List coverages")
def list_coverages(
    org_id: UUID,
    policy_id: str = Query(None),
    entity_type: str = Query(None),
    status: str = Query(None),
    auth: AuthContext = Depends(require_permission(Permission.INSURANCE_VIEW)),
    db: Session = Depends(get_db),
):
    """List coverages."""
    query = db.query(InsuranceCoverage).filter(
        InsuranceCoverage.organization_id == org_id
    )
    if policy_id:
        query = query.filter(InsuranceCoverage.policy_id == policy_id)
    if entity_type and entity_type in CoveredEntityType.ALL:
        query = query.filter(InsuranceCoverage.covered_entity_type == entity_type)
    if status and status in CoverageStatus.ALL:
        query = query.filter(InsuranceCoverage.status == status)

    query = query.order_by(InsuranceCoverage.created_at.desc())
    coverages = query.all()

    return {
        "coverages": [_serialize_coverage(c, db=db) for c in coverages],
        "total": len(coverages),
    }


@router.post("/api/organizations/{org_id}/collections/insurance/coverages", response_model=InsuranceCoverageOut, status_code=201, summary="Create coverage")
def create_coverage(
    org_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.INSURANCE_CREATE)),
    db: Session = Depends(get_db),
):
    """Create coverage."""
    if not body.get("covered_entity_type"):
        raise HTTPException(status_code=422, detail="Covered entity type is required")
    if not body.get("covered_entity_id"):
        raise HTTPException(status_code=422, detail="Covered entity is required")

    entity_type = body["covered_entity_type"]
    if entity_type not in CoveredEntityType.ALL:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid entity type. Must be one of: {', '.join(CoveredEntityType.ALL)}",
        )

    status = body.get("status", CoverageStatus.PENDING)
    if status not in CoverageStatus.ALL:
        raise HTTPException(status_code=422, detail=f"Invalid status. Must be one of: {CoverageStatus.ALL}")

    coverage = InsuranceCoverage(
        organization_id=org_id,
        policy_id=body.get("policy_id"),
        covered_entity_type=entity_type,
        covered_entity_id=body["covered_entity_id"],
        coverage_start_date=_parse_date(body.get("coverage_start_date")),
        coverage_end_date=_parse_date(body.get("coverage_end_date")),
        declared_value=body.get("declared_value"),
        agreed_value=body.get("agreed_value"),
        value_currency=body.get("value_currency", "USD"),
        third_party_provider=body.get("third_party_provider"),
        third_party_policy_number=body.get("third_party_policy_number"),
        certificate_requested=body.get("certificate_requested", False),
        certificate_received=body.get("certificate_received", False),
        certificate_received_date=_parse_date(body.get("certificate_received_date")),
        certificate_number=body.get("certificate_number"),
        status=status,
        notes=body.get("notes"),
        created_by=auth.user_id,
        updated_by=auth.user_id,
    )
    db.add(coverage)
    db.commit()
    db.refresh(coverage)

    return _serialize_coverage(coverage, db=db)


@router.get("/api/organizations/{org_id}/collections/insurance/coverages/{coverage_id}", response_model=InsuranceCoverageOut, summary="Get coverage")
def get_coverage(
    org_id: UUID,
    coverage_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.INSURANCE_VIEW)),
    db: Session = Depends(get_db),
):
    """Get coverage."""
    coverage = db.query(InsuranceCoverage).filter(
        InsuranceCoverage.coverage_id == coverage_id,
        InsuranceCoverage.organization_id == org_id,
    ).first()
    if not coverage:
        raise HTTPException(status_code=404, detail="Coverage not found")
    return _serialize_coverage(coverage, db=db)


@router.patch("/api/organizations/{org_id}/collections/insurance/coverages/{coverage_id}", response_model=InsuranceCoverageOut, summary="Update coverage")
def update_coverage(
    org_id: UUID,
    coverage_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.INSURANCE_EDIT)),
    db: Session = Depends(get_db),
):
    """Update coverage."""
    coverage = db.query(InsuranceCoverage).filter(
        InsuranceCoverage.coverage_id == coverage_id,
        InsuranceCoverage.organization_id == org_id,
    ).first()
    if not coverage:
        raise HTTPException(status_code=404, detail="Coverage not found")

    if "policy_id" in body:
        coverage.policy_id = body["policy_id"]
    if "coverage_start_date" in body:
        coverage.coverage_start_date = _parse_date(body["coverage_start_date"])
    if "coverage_end_date" in body:
        coverage.coverage_end_date = _parse_date(body["coverage_end_date"])
    if "declared_value" in body:
        coverage.declared_value = body["declared_value"]
    if "agreed_value" in body:
        coverage.agreed_value = body["agreed_value"]
    if "value_currency" in body:
        coverage.value_currency = body["value_currency"]
    if "third_party_provider" in body:
        coverage.third_party_provider = body["third_party_provider"]
    if "third_party_policy_number" in body:
        coverage.third_party_policy_number = body["third_party_policy_number"]
    if "certificate_requested" in body:
        coverage.certificate_requested = body["certificate_requested"]
    if "certificate_received" in body:
        coverage.certificate_received = body["certificate_received"]
    if "certificate_received_date" in body:
        coverage.certificate_received_date = _parse_date(body["certificate_received_date"])
    if "certificate_number" in body:
        coverage.certificate_number = body["certificate_number"]
    if "status" in body:
        if body["status"] not in CoverageStatus.ALL:
            raise HTTPException(status_code=422, detail="Invalid status")
        coverage.status = body["status"]
    if "notes" in body:
        coverage.notes = body["notes"]

    coverage.updated_at = datetime.now(timezone.utc)
    coverage.updated_by = auth.user_id
    db.commit()
    db.refresh(coverage)

    return _serialize_coverage(coverage, db=db)


@router.post("/api/organizations/{org_id}/collections/insurance/coverages/{coverage_id}/confirm", response_model=InsuranceCoverageOut, summary="Confirm coverage")
def confirm_coverage(
    org_id: UUID,
    coverage_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.INSURANCE_EDIT)),
    db: Session = Depends(get_db),
):
    """Confirm coverage."""
    coverage = db.query(InsuranceCoverage).filter(
        InsuranceCoverage.coverage_id == coverage_id,
        InsuranceCoverage.organization_id == org_id,
    ).first()
    if not coverage:
        raise HTTPException(status_code=404, detail="Coverage not found")

    if coverage.status != CoverageStatus.PENDING:
        raise HTTPException(status_code=400, detail="Coverage cannot be confirmed from current status")

    coverage.status = CoverageStatus.CONFIRMED
    coverage.updated_at = datetime.now(timezone.utc)
    coverage.updated_by = auth.user_id
    db.commit()

    try:
        ref = getattr(coverage, "coverage_number", None) or str(coverage.coverage_id)[:8]
        notify_status_change(
            str(org_id), "insurance_coverage", coverage.coverage_id, ref,
            "pending", "confirmed", str(auth.user_id), entity=coverage,
        )
    except Exception:
        logger.warning("Failed to send status change notification for coverage %s", coverage_id)

    return _serialize_coverage(coverage, db=db)


# ============================================================================
# ENTITY-SPECIFIC INSURANCE LOOKUPS
# ============================================================================


@router.get("/api/organizations/{org_id}/collections/objects/{object_id}/insurance", response_model=InsuranceCoverageListResponse, summary="Get object insurance")
def get_object_insurance(
    org_id: UUID,
    object_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.INSURANCE_VIEW)),
    db: Session = Depends(get_db),
):
    """Get object insurance."""
    coverages = db.query(InsuranceCoverage).filter(
        InsuranceCoverage.organization_id == org_id,
        InsuranceCoverage.covered_entity_type == CoveredEntityType.COLLECTION_OBJECT,
        InsuranceCoverage.covered_entity_id == object_id,
    ).order_by(InsuranceCoverage.created_at.desc()).all()

    return {
        "coverages": [_serialize_coverage(c, db=db) for c in coverages],
        "total": len(coverages),
    }


@router.get("/api/organizations/{org_id}/collections/loans-in/{loan_id}/insurance", response_model=InsuranceCoverageListResponse, summary="Get loan in insurance")
def get_loan_in_insurance(
    org_id: UUID,
    loan_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.INSURANCE_VIEW)),
    db: Session = Depends(get_db),
):
    """Get loan in insurance."""
    coverages = db.query(InsuranceCoverage).filter(
        InsuranceCoverage.organization_id == org_id,
        InsuranceCoverage.covered_entity_type == CoveredEntityType.LOAN_IN,
        InsuranceCoverage.covered_entity_id == loan_id,
    ).order_by(InsuranceCoverage.created_at.desc()).all()

    return {
        "coverages": [_serialize_coverage(c, db=db) for c in coverages],
        "total": len(coverages),
    }


@router.get("/api/organizations/{org_id}/collections/loans-out/{loan_id}/insurance", response_model=InsuranceCoverageListResponse, summary="Get loan out insurance")
def get_loan_out_insurance(
    org_id: UUID,
    loan_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.INSURANCE_VIEW)),
    db: Session = Depends(get_db),
):
    """Get loan out insurance."""
    coverages = db.query(InsuranceCoverage).filter(
        InsuranceCoverage.organization_id == org_id,
        InsuranceCoverage.covered_entity_type == CoveredEntityType.LOAN_OUT,
        InsuranceCoverage.covered_entity_id == loan_id,
    ).order_by(InsuranceCoverage.created_at.desc()).all()

    return {
        "coverages": [_serialize_coverage(c, db=db) for c in coverages],
        "total": len(coverages),
    }


@router.get("/api/organizations/{org_id}/collections/shipments/{shipment_id}/insurance", response_model=InsuranceCoverageListResponse, summary="Get shipment insurance")
def get_shipment_insurance(
    org_id: UUID,
    shipment_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.INSURANCE_VIEW)),
    db: Session = Depends(get_db),
):
    """Get shipment insurance."""
    coverages = db.query(InsuranceCoverage).filter(
        InsuranceCoverage.organization_id == org_id,
        InsuranceCoverage.covered_entity_type == CoveredEntityType.SHIPMENT,
        InsuranceCoverage.covered_entity_id == shipment_id,
    ).order_by(InsuranceCoverage.created_at.desc()).all()

    return {
        "coverages": [_serialize_coverage(c, db=db) for c in coverages],
        "total": len(coverages),
    }


# ============================================================================
# INDEMNITY ENDPOINTS
# ============================================================================


@router.get("/api/organizations/{org_id}/collections/insurance/indemnities", response_model=IndemnityListResponse, summary="List indemnities")
def list_indemnities(
    org_id: UUID,
    program: str = Query(None),
    status: str = Query(None),
    exhibition_id: str = Query(None),
    auth: AuthContext = Depends(require_permission(Permission.INSURANCE_VIEW)),
    db: Session = Depends(get_db),
):
    """List indemnities."""
    query = db.query(IndemnityArrangement).filter(
        IndemnityArrangement.organization_id == org_id
    )
    if program and program in IndemnityProgram.ALL:
        query = query.filter(IndemnityArrangement.program == program)
    if status and status in IndemnityStatus.ALL:
        query = query.filter(IndemnityArrangement.status == status)
    if exhibition_id:
        query = query.filter(IndemnityArrangement.exhibition_id == exhibition_id)

    query = query.order_by(IndemnityArrangement.created_at.desc())
    indemnities = query.all()

    return {
        "indemnities": [_serialize_indemnity(i) for i in indemnities],
        "total": len(indemnities),
    }


@router.post("/api/organizations/{org_id}/collections/insurance/indemnities", response_model=IndemnityArrangementOut, status_code=201, summary="Create indemnity")
def create_indemnity(
    org_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.INSURANCE_CREATE)),
    db: Session = Depends(get_db),
):
    """Create indemnity."""
    if not body.get("program"):
        raise HTTPException(status_code=422, detail="Indemnity program is required")

    program = body["program"]
    if program not in IndemnityProgram.ALL:
        raise HTTPException(status_code=422, detail=f"Invalid program. Must be one of: {IndemnityProgram.ALL}")

    status = body.get("status", IndemnityStatus.DRAFT)
    if status not in IndemnityStatus.ALL:
        raise HTTPException(status_code=422, detail=f"Invalid status. Must be one of: {IndemnityStatus.ALL}")

    indemnity = IndemnityArrangement(
        organization_id=org_id,
        program=program,
        reference_number=body.get("reference_number"),
        internal_reference=body.get("internal_reference"),
        exhibition_id=body.get("exhibition_id"),
        loan_in_id=body.get("loan_in_id"),
        application_date=_parse_date(body.get("application_date")),
        requested_coverage=body.get("requested_coverage"),
        awarded_coverage=body.get("awarded_coverage"),
        coverage_currency=body.get("coverage_currency", "USD"),
        coverage_start_date=_parse_date(body.get("coverage_start_date")),
        coverage_end_date=_parse_date(body.get("coverage_end_date")),
        commercial_gap_required=body.get("commercial_gap_required", False),
        gap_coverage_id=body.get("gap_coverage_id"),
        status=status,
        authorizer_id=body.get("authorizer_id"),
        authorization_date=_parse_date(body.get("authorization_date")),
        authorization_note=body.get("authorization_note"),
        notes=body.get("notes"),
        created_by=auth.user_id,
        updated_by=auth.user_id,
    )
    db.add(indemnity)
    db.flush()

    for obj_data in body.get("objects", []):
        if obj_data.get("object_id"):
            obj = IndemnityObject(
                indemnity_id=indemnity.indemnity_id,
                object_id=obj_data["object_id"],
                declared_value=obj_data.get("declared_value"),
                approved_value=obj_data.get("approved_value"),
                value_currency=obj_data.get("value_currency", "USD"),
                object_number=obj_data.get("object_number"),
                object_title=obj_data.get("object_title"),
                notes=obj_data.get("notes"),
            )
            db.add(obj)

    db.commit()
    db.refresh(indemnity)

    return _serialize_indemnity(indemnity, include_objects=True)


@router.get("/api/organizations/{org_id}/collections/insurance/indemnities/{indemnity_id}", response_model=IndemnityArrangementOut, summary="Get indemnity")
def get_indemnity(
    org_id: UUID,
    indemnity_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.INSURANCE_VIEW)),
    db: Session = Depends(get_db),
):
    """Get indemnity."""
    indemnity = db.query(IndemnityArrangement).filter(
        IndemnityArrangement.indemnity_id == indemnity_id,
        IndemnityArrangement.organization_id == org_id,
    ).first()
    if not indemnity:
        raise HTTPException(status_code=404, detail="Indemnity arrangement not found")
    return _serialize_indemnity(indemnity, include_objects=True)


@router.patch("/api/organizations/{org_id}/collections/insurance/indemnities/{indemnity_id}", response_model=IndemnityArrangementOut, summary="Update indemnity")
def update_indemnity(
    org_id: UUID,
    indemnity_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.INSURANCE_EDIT)),
    db: Session = Depends(get_db),
):
    """Update indemnity."""
    indemnity = db.query(IndemnityArrangement).filter(
        IndemnityArrangement.indemnity_id == indemnity_id,
        IndemnityArrangement.organization_id == org_id,
    ).first()
    if not indemnity:
        raise HTTPException(status_code=404, detail="Indemnity arrangement not found")

    if "program" in body:
        if body["program"] not in IndemnityProgram.ALL:
            raise HTTPException(status_code=422, detail="Invalid program")
        indemnity.program = body["program"]
    if "reference_number" in body:
        indemnity.reference_number = body["reference_number"]
    if "internal_reference" in body:
        indemnity.internal_reference = body["internal_reference"]
    if "exhibition_id" in body:
        indemnity.exhibition_id = body["exhibition_id"]
    if "loan_in_id" in body:
        indemnity.loan_in_id = body["loan_in_id"]
    if "application_date" in body:
        indemnity.application_date = _parse_date(body["application_date"])
    if "requested_coverage" in body:
        indemnity.requested_coverage = body["requested_coverage"]
    if "awarded_coverage" in body:
        indemnity.awarded_coverage = body["awarded_coverage"]
    if "coverage_currency" in body:
        indemnity.coverage_currency = body["coverage_currency"]
    if "coverage_start_date" in body:
        indemnity.coverage_start_date = _parse_date(body["coverage_start_date"])
    if "coverage_end_date" in body:
        indemnity.coverage_end_date = _parse_date(body["coverage_end_date"])
    if "commercial_gap_required" in body:
        indemnity.commercial_gap_required = body["commercial_gap_required"]
    if "gap_coverage_id" in body:
        indemnity.gap_coverage_id = body["gap_coverage_id"]
    if "status" in body:
        if body["status"] not in IndemnityStatus.ALL:
            raise HTTPException(status_code=422, detail="Invalid status")
        indemnity.status = body["status"]
    if "authorizer_id" in body:
        indemnity.authorizer_id = body["authorizer_id"] or None
    if "authorization_date" in body:
        indemnity.authorization_date = _parse_date(body["authorization_date"])
    if "authorization_note" in body:
        indemnity.authorization_note = body["authorization_note"]
    if "notes" in body:
        indemnity.notes = body["notes"]

    indemnity.updated_at = datetime.now(timezone.utc)
    indemnity.updated_by = auth.user_id
    db.commit()
    db.refresh(indemnity)

    return _serialize_indemnity(indemnity, include_objects=True)


@router.post("/api/organizations/{org_id}/collections/insurance/indemnities/{indemnity_id}/submit", response_model=IndemnityArrangementOut, summary="Submit indemnity")
def submit_indemnity(
    org_id: UUID,
    indemnity_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.INSURANCE_EDIT)),
    db: Session = Depends(get_db),
):
    """Submit indemnity."""
    indemnity = db.query(IndemnityArrangement).filter(
        IndemnityArrangement.indemnity_id == indemnity_id,
        IndemnityArrangement.organization_id == org_id,
    ).first()
    if not indemnity:
        raise HTTPException(status_code=404, detail="Indemnity arrangement not found")

    if indemnity.status != IndemnityStatus.DRAFT:
        raise HTTPException(status_code=400, detail="Indemnity can only be submitted from draft status")

    indemnity.status = IndemnityStatus.SUBMITTED
    indemnity.updated_at = datetime.now(timezone.utc)
    indemnity.updated_by = auth.user_id
    db.commit()

    try:
        ref = getattr(indemnity, "internal_reference", None) or str(indemnity.indemnity_id)[:8]
        notify_status_change(
            str(org_id), "indemnity", indemnity.indemnity_id, ref,
            "draft", "submitted", str(auth.user_id), entity=indemnity,
        )
    except Exception:
        logger.warning("Failed to send status change notification for indemnity %s", indemnity_id)

    return _serialize_indemnity(indemnity, include_objects=True)


@router.post("/api/organizations/{org_id}/collections/insurance/indemnities/{indemnity_id}/objects", response_model=IndemnityObjectAddedResponse, status_code=201, summary="Add indemnity object")
def add_indemnity_object(
    org_id: UUID,
    indemnity_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.INSURANCE_EDIT)),
    db: Session = Depends(get_db),
):
    """Add indemnity object."""
    indemnity = db.query(IndemnityArrangement).filter(
        IndemnityArrangement.indemnity_id == indemnity_id,
        IndemnityArrangement.organization_id == org_id,
    ).first()
    if not indemnity:
        raise HTTPException(status_code=404, detail="Indemnity arrangement not found")

    if not body.get("object_id"):
        raise HTTPException(status_code=422, detail="Object is required")

    existing = db.query(IndemnityObject).filter(
        IndemnityObject.indemnity_id == indemnity_id,
        IndemnityObject.object_id == body["object_id"],
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Object already linked to this indemnity")

    obj = IndemnityObject(
        indemnity_id=indemnity_id,
        object_id=body["object_id"],
        declared_value=body.get("declared_value"),
        approved_value=body.get("approved_value"),
        value_currency=body.get("value_currency", "USD"),
        object_number=body.get("object_number"),
        object_title=body.get("object_title"),
        notes=body.get("notes"),
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)

    return {
        "link_id": str(obj.link_id),
        "object_id": str(obj.object_id),
        "declared_value": float(obj.declared_value) if obj.declared_value else None,
        "approved_value": float(obj.approved_value) if obj.approved_value else None,
    }


@router.delete("/api/organizations/{org_id}/collections/insurance/indemnities/{indemnity_id}/objects/{link_id}", summary="Remove indemnity object")
def remove_indemnity_object(
    org_id: UUID,
    indemnity_id: UUID,
    link_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.INSURANCE_EDIT)),
    db: Session = Depends(get_db),
):
    """Remove indemnity object."""
    # indemnity_objects has no organization_id of its own, so
    # (link_id, indemnity_id) alone matches another institution's row —
    # removing an object from their government-indemnity schedule.
    # add_indemnity_object already loads the arrangement org-scoped.
    obj = (
        db.query(IndemnityObject)
        .join(
            IndemnityArrangement,
            IndemnityArrangement.indemnity_id == IndemnityObject.indemnity_id,
        )
        .filter(
            IndemnityObject.link_id == link_id,
            IndemnityObject.indemnity_id == indemnity_id,
            IndemnityArrangement.organization_id == org_id,
        )
        .first()
    )
    if not obj:
        raise HTTPException(status_code=404, detail="Object link not found")

    db.delete(obj)
    db.commit()
    return Response(status_code=204)


# ============================================================================
# CLAIMS ENDPOINTS
# ============================================================================


@router.get("/api/organizations/{org_id}/collections/insurance/claims", response_model=InsuranceClaimListResponse, summary="List claims")
def list_claims(
    org_id: UUID,
    status: str = Query(None),
    loss_type: str = Query(None),
    coverage_id: str = Query(None),
    indemnity_id: str = Query(None),
    auth: AuthContext = Depends(require_permission(Permission.INSURANCE_VIEW)),
    db: Session = Depends(get_db),
):
    """List claims."""
    query = db.query(InsuranceClaim).filter(
        InsuranceClaim.organization_id == org_id
    )
    if status and status in ClaimStatus.ALL:
        query = query.filter(InsuranceClaim.status == status)
    if loss_type and loss_type in LossType.ALL:
        query = query.filter(InsuranceClaim.loss_type == loss_type)
    if coverage_id:
        query = query.filter(InsuranceClaim.coverage_id == coverage_id)
    if indemnity_id:
        query = query.filter(InsuranceClaim.indemnity_id == indemnity_id)

    query = query.order_by(InsuranceClaim.created_at.desc())
    claims = query.all()

    return {
        "claims": [_serialize_claim(c) for c in claims],
        "total": len(claims),
    }


@router.post("/api/organizations/{org_id}/collections/insurance/claims", response_model=InsuranceClaimOut, status_code=201, summary="Create claim")
def create_claim(
    org_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.INSURANCE_CLAIMS_CREATE)),
    db: Session = Depends(get_db),
):
    """Create claim."""
    if not body.get("coverage_id") and not body.get("indemnity_id"):
        raise HTTPException(status_code=400, detail="Either a coverage or indemnity arrangement is required")

    loss_type = body.get("loss_type")
    if loss_type and loss_type not in LossType.ALL:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid loss type. Must be one of: {', '.join(LossType.ALL)}",
        )

    status = body.get("status", ClaimStatus.DRAFT)
    if status not in ClaimStatus.ALL:
        raise HTTPException(status_code=422, detail=f"Invalid status. Must be one of: {ClaimStatus.ALL}")

    claim = InsuranceClaim(
        organization_id=org_id,
        claim_number=body.get("claim_number"),
        insurer_claim_number=body.get("insurer_claim_number"),
        coverage_id=body.get("coverage_id"),
        indemnity_id=body.get("indemnity_id"),
        incident_report_id=body.get("incident_report_id"),
        date_of_loss=_parse_date(body.get("date_of_loss")),
        loss_description=body.get("loss_description"),
        loss_type=loss_type,
        claimed_amount=body.get("claimed_amount"),
        settlement_amount=body.get("settlement_amount"),
        amount_currency=body.get("amount_currency", "USD"),
        adjuster_name=body.get("adjuster_name"),
        adjuster_contact=body.get("adjuster_contact"),
        status=status,
        filed_date=_parse_date(body.get("filed_date")),
        settled_date=_parse_date(body.get("settled_date")),
        notes=body.get("notes"),
        created_by=auth.user_id,
        updated_by=auth.user_id,
    )
    db.add(claim)
    db.commit()
    db.refresh(claim)

    return _serialize_claim(claim)


@router.get("/api/organizations/{org_id}/collections/insurance/claims/{claim_id}", response_model=InsuranceClaimOut, summary="Get claim")
def get_claim(
    org_id: UUID,
    claim_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.INSURANCE_VIEW)),
    db: Session = Depends(get_db),
):
    """Get claim."""
    claim = db.query(InsuranceClaim).filter(
        InsuranceClaim.claim_id == claim_id,
        InsuranceClaim.organization_id == org_id,
    ).first()
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")
    return _serialize_claim(claim)


@router.patch("/api/organizations/{org_id}/collections/insurance/claims/{claim_id}", response_model=InsuranceClaimOut, summary="Update claim")
def update_claim(
    org_id: UUID,
    claim_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.INSURANCE_CLAIMS_MANAGE)),
    db: Session = Depends(get_db),
):
    """Update claim."""
    claim = db.query(InsuranceClaim).filter(
        InsuranceClaim.claim_id == claim_id,
        InsuranceClaim.organization_id == org_id,
    ).first()
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")

    if "claim_number" in body:
        claim.claim_number = body["claim_number"]
    if "insurer_claim_number" in body:
        claim.insurer_claim_number = body["insurer_claim_number"]
    if "incident_report_id" in body:
        claim.incident_report_id = body["incident_report_id"]
    if "date_of_loss" in body:
        claim.date_of_loss = _parse_date(body["date_of_loss"])
    if "loss_description" in body:
        claim.loss_description = body["loss_description"]
    if "loss_type" in body:
        if body["loss_type"] and body["loss_type"] not in LossType.ALL:
            raise HTTPException(status_code=422, detail="Invalid loss_type")
        claim.loss_type = body["loss_type"]
    if "claimed_amount" in body:
        claim.claimed_amount = body["claimed_amount"]
    if "settlement_amount" in body:
        claim.settlement_amount = body["settlement_amount"]
    if "amount_currency" in body:
        claim.amount_currency = body["amount_currency"]
    if "adjuster_name" in body:
        claim.adjuster_name = body["adjuster_name"]
    if "adjuster_contact" in body:
        claim.adjuster_contact = body["adjuster_contact"]
    if "status" in body:
        if body["status"] not in ClaimStatus.ALL:
            raise HTTPException(status_code=422, detail="Invalid status")
        claim.status = body["status"]
    if "filed_date" in body:
        claim.filed_date = _parse_date(body["filed_date"])
    if "settled_date" in body:
        claim.settled_date = _parse_date(body["settled_date"])
    if "notes" in body:
        claim.notes = body["notes"]

    claim.updated_at = datetime.now(timezone.utc)
    claim.updated_by = auth.user_id
    db.commit()
    db.refresh(claim)

    return _serialize_claim(claim)


@router.post("/api/organizations/{org_id}/collections/insurance/claims/{claim_id}/file", response_model=InsuranceClaimOut, summary="File claim")
def file_claim(
    org_id: UUID,
    claim_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.INSURANCE_CLAIMS_MANAGE)),
    db: Session = Depends(get_db),
):
    """File claim."""
    claim = db.query(InsuranceClaim).filter(
        InsuranceClaim.claim_id == claim_id,
        InsuranceClaim.organization_id == org_id,
    ).first()
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")

    if claim.status != ClaimStatus.DRAFT:
        raise HTTPException(status_code=400, detail="Claim can only be filed from draft status")

    claim.status = ClaimStatus.FILED
    claim.filed_date = datetime.now(timezone.utc).date()
    claim.updated_at = datetime.now(timezone.utc)
    claim.updated_by = auth.user_id
    db.commit()

    try:
        ref = getattr(claim, "claim_number", None) or str(claim.claim_id)[:8]
        notify_status_change(
            str(org_id), "insurance_claim", claim.claim_id, ref,
            "draft", "filed", str(auth.user_id), entity=claim,
        )
    except Exception:
        logger.warning("Failed to send status change notification for claim %s", claim_id)

    return _serialize_claim(claim)


@router.post("/api/organizations/{org_id}/collections/insurance/claims/{claim_id}/settle", response_model=InsuranceClaimOut, summary="Settle claim")
def settle_claim(
    org_id: UUID,
    claim_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.INSURANCE_CLAIMS_MANAGE)),
    db: Session = Depends(get_db),
):
    """Settle claim."""
    claim = db.query(InsuranceClaim).filter(
        InsuranceClaim.claim_id == claim_id,
        InsuranceClaim.organization_id == org_id,
    ).first()
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")

    if claim.status not in [ClaimStatus.FILED, ClaimStatus.UNDER_INVESTIGATION, ClaimStatus.APPROVED]:
        raise HTTPException(status_code=400, detail="Claim cannot be settled from current status")

    if "settlement_amount" in body:
        claim.settlement_amount = body["settlement_amount"]

    old_status = claim.status
    claim.status = ClaimStatus.SETTLED
    claim.settled_date = datetime.now(timezone.utc).date()
    claim.updated_at = datetime.now(timezone.utc)
    claim.updated_by = auth.user_id
    db.commit()

    try:
        ref = getattr(claim, "claim_number", None) or str(claim.claim_id)[:8]
        notify_status_change(
            str(org_id), "insurance_claim", claim.claim_id, ref,
            old_status, "settled", str(auth.user_id), entity=claim,
        )
    except Exception:
        logger.warning("Failed to send status change notification for claim %s", claim_id)

    return _serialize_claim(claim)
