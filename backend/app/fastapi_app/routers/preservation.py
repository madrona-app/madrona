"""
Preservation API endpoints (FastAPI).

17 routes:
  - Preservation Events (2): list org events, list media events
  - Format Risk (2): format-risk-summary, at-risk-media
  - Preservation Policies (4): list, create, update, deactivate
  - Action Plans (3): list, approve, cancel
  - Retention Report (1)
  - Information Packages (3): list media packages, AIP manifest, list org packages
  - Replication (2): list media replicas, replication summary

Migrated from app/api/preservation.py.
"""

import logging
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.fastapi_app.schemas.common import MessageResponse
from app.fastapi_app.schemas.preservation import (
    ActionPlanListResponse,
    AipManifestResponse,
    AtRiskMediaResponse,
    FormatRiskSummaryResponse,
    InformationPackageListResponse,
    InformationPackagePaginatedResponse,
    PreservationActionPlanOut,
    PreservationEventListResponse,
    PreservationPolicyListResponse,
    PreservationPolicyOut,
    ReplicationRecordListResponse,
    ReplicationSummaryResponse,
    RetentionReportResponse,
)
from app.models import Media
from app.models.preservation import (
    InformationPackage,
    PreservationActionPlan,
    PreservationEvent,
    PreservationPolicy,
    ReplicationRecord,
)
from app.permissions import Permission

logger = logging.getLogger(__name__)

router = APIRouter(tags=["preservation"])


# ============================================================================
# SERIALIZERS
# ============================================================================


def _serialize_event(event: PreservationEvent) -> dict:
    return {
        "event_id": str(event.event_id),
        "organization_id": str(event.organization_id),
        "event_type": event.event_type,
        "media_id": str(event.media_id) if event.media_id else None,
        "outcome": event.outcome,
        "outcome_detail": event.outcome_detail,
        "detail": event.detail,
        "agent_type": event.agent_type,
        "agent_name": event.agent_name,
        "linked_entity_type": event.linked_entity_type,
        "linked_entity_id": str(event.linked_entity_id) if event.linked_entity_id else None,
        "created_at": event.created_at.isoformat() if event.created_at else None,
    }


def _serialize_policy(policy: PreservationPolicy) -> dict:
    return {
        "policy_id": str(policy.policy_id),
        "organization_id": str(policy.organization_id),
        "name": policy.name,
        "description": policy.description,
        "policy_type": policy.policy_type,
        "scope": policy.scope,
        "rules": policy.rules,
        "is_active": policy.is_active,
        "priority": policy.priority,
        "approved_by": str(policy.approved_by) if policy.approved_by else None,
        "approved_at": policy.approved_at.isoformat() if policy.approved_at else None,
        "created_by": str(policy.created_by) if policy.created_by else None,
        "created_at": policy.created_at.isoformat() if policy.created_at else None,
        "updated_at": policy.updated_at.isoformat() if policy.updated_at else None,
    }


def _serialize_action_plan(plan: PreservationActionPlan) -> dict:
    return {
        "action_id": str(plan.action_id),
        "organization_id": str(plan.organization_id),
        "policy_id": str(plan.policy_id),
        "media_id": str(plan.media_id),
        "action_type": plan.action_type,
        "detail": plan.detail,
        "status": plan.status,
        "scheduled_for": plan.scheduled_for.isoformat() if plan.scheduled_for else None,
        "started_at": plan.started_at.isoformat() if plan.started_at else None,
        "completed_at": plan.completed_at.isoformat() if plan.completed_at else None,
        "result": plan.result,
        "error_message": plan.error_message,
        "created_at": plan.created_at.isoformat() if plan.created_at else None,
    }


def _serialize_information_package(ip: InformationPackage) -> dict:
    return {
        "package_id": str(ip.package_id),
        "organization_id": str(ip.organization_id),
        "media_id": str(ip.media_id),
        "package_type": ip.package_type,
        "status": ip.status,
        "structure": ip.structure,
        "provenance_event_ids": ip.provenance_event_ids,
        "export_profile_id": ip.export_profile_id,
        "external_identifier": ip.external_identifier,
        "created_at": ip.created_at.isoformat() if ip.created_at else None,
        "updated_at": ip.updated_at.isoformat() if ip.updated_at else None,
        "expires_at": ip.expires_at.isoformat() if ip.expires_at else None,
    }


def _serialize_replication_record(record: ReplicationRecord) -> dict:
    return {
        "record_id": str(record.record_id),
        "organization_id": str(record.organization_id),
        "media_id": str(record.media_id),
        "storage_location": record.storage_location,
        "storage_provider": record.storage_provider,
        "storage_region": record.storage_region,
        "storage_key": record.storage_key,
        "copy_type": record.copy_type,
        "checksum_sha256": record.checksum_sha256,
        "last_verified_at": record.last_verified_at.isoformat() if record.last_verified_at else None,
        "verification_status": record.verification_status,
        "created_at": record.created_at.isoformat() if record.created_at else None,
    }


# ============================================================================
# PRESERVATION EVENTS
# ============================================================================


@router.get("/api/organizations/{org_id}/preservation-events", response_model=PreservationEventListResponse, summary="List preservation events")
def list_preservation_events(
    org_id: UUID,
    media_id: UUID = Query(None),
    event_type: str = Query(None),
    outcome: str = Query(None),
    since: str = Query(None),
    until: str = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.ORG_VIEW_AUDIT_LOGS)),
    db: Session = Depends(get_db),
):
    """List preservation events for an organization."""
    query = db.query(PreservationEvent).filter(
        PreservationEvent.organization_id == org_id
    )

    if media_id:
        query = query.filter(PreservationEvent.media_id == media_id)
    if event_type:
        query = query.filter(PreservationEvent.event_type == event_type)
    if outcome:
        query = query.filter(PreservationEvent.outcome == outcome)

    if since:
        try:
            since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid 'since' date format. Use ISO 8601.")
        query = query.filter(PreservationEvent.created_at >= since_dt)

    if until:
        try:
            until_dt = datetime.fromisoformat(until.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid 'until' date format. Use ISO 8601.")
        query = query.filter(PreservationEvent.created_at <= until_dt)

    total_count = query.count()
    events = (
        query.order_by(desc(PreservationEvent.created_at))
        .limit(limit)
        .offset(offset)
        .all()
    )

    return {
        "items": [_serialize_event(e) for e in events],
        "total": total_count,
        "page": {
            "limit": limit,
            "offset": offset,
            "has_more": (offset + limit) < total_count,
        },
    }


@router.get("/api/organizations/{org_id}/media/{media_id}/preservation-events", response_model=PreservationEventListResponse, summary="List media preservation events")
def list_media_preservation_events(
    org_id: UUID,
    media_id: UUID,
    event_type: str = Query(None),
    outcome: str = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """List preservation events for a specific media asset."""
    query = db.query(PreservationEvent).filter(
        PreservationEvent.organization_id == org_id,
        PreservationEvent.media_id == media_id,
    )

    if event_type:
        query = query.filter(PreservationEvent.event_type == event_type)
    if outcome:
        query = query.filter(PreservationEvent.outcome == outcome)

    total_count = query.count()
    events = (
        query.order_by(desc(PreservationEvent.created_at))
        .limit(limit)
        .offset(offset)
        .all()
    )

    return {
        "items": [_serialize_event(e) for e in events],
        "total": total_count,
        "page": {
            "limit": limit,
            "offset": offset,
            "has_more": (offset + limit) < total_count,
        },
    }


# ============================================================================
# FORMAT RISK
# ============================================================================


@router.get("/api/organizations/{org_id}/preservation/format-risk-summary", response_model=FormatRiskSummaryResponse, summary="Format risk summary")
def format_risk_summary(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.ORG_VIEW_AUDIT_LOGS)),
    db: Session = Depends(get_db),
):
    """Format distribution by risk level."""
    from app.services.format_identification import get_format_risk_summary

    summary = get_format_risk_summary(org_id, db)
    return {"formats": summary}


@router.get("/api/organizations/{org_id}/preservation/at-risk-media", response_model=AtRiskMediaResponse, summary="At risk media")
def at_risk_media(
    org_id: UUID,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.ORG_VIEW_AUDIT_LOGS)),
    db: Session = Depends(get_db),
):
    """Media with high or critical risk formats."""
    query = db.query(Media).filter(
        Media.organization_id == org_id,
        Media.format_risk_level.in_(["high", "critical"]),
    )

    total_count = query.count()
    media_items = (
        query.order_by(Media.created_at.desc())
        .limit(limit)
        .offset(offset)
        .all()
    )

    return {
        "items": [
            {
                "media_id": str(m.media_id),
                "filename": m.filename,
                "mime_type": m.mime_type,
                "pronom_puid": m.pronom_puid,
                "format_name": m.format_name,
                "format_risk_level": m.format_risk_level,
                "file_size": m.file_size,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in media_items
        ],
        "total": total_count,
        "page": {
            "limit": limit,
            "offset": offset,
            "has_more": (offset + limit) < total_count,
        },
    }


# ============================================================================
# PRESERVATION POLICIES
# ============================================================================


@router.get("/api/organizations/{org_id}/preservation/policies", response_model=PreservationPolicyListResponse, summary="List policies")
def list_policies(
    org_id: UUID,
    is_active: str = Query(None),
    auth: AuthContext = Depends(require_permission(Permission.ORG_VIEW_AUDIT_LOGS)),
    db: Session = Depends(get_db),
):
    """List preservation policies."""
    query = db.query(PreservationPolicy).filter(
        PreservationPolicy.organization_id == org_id
    )

    if is_active is not None:
        query = query.filter(
            PreservationPolicy.is_active == (is_active.lower() == "true")
        )

    policies = query.order_by(PreservationPolicy.priority.desc()).all()
    return {"policies": [_serialize_policy(p) for p in policies]}


@router.post("/api/organizations/{org_id}/preservation/policies", response_model=PreservationPolicyOut, status_code=201, summary="Create policy")
def create_policy(
    org_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_ADMIN)),
    db: Session = Depends(get_db),
):
    """Create a preservation policy."""
    if not body:
        raise HTTPException(status_code=400, detail="Request body required")

    name = body.get("name")
    policy_type = body.get("policy_type")
    if not name or not policy_type:
        raise HTTPException(status_code=400, detail="name and policy_type are required")

    valid_types = ("retention", "format_migration", "normalization", "fixity_schedule")
    if policy_type not in valid_types:
        raise HTTPException(
            status_code=400,
            detail=f"policy_type must be one of: {', '.join(valid_types)}",
        )

    policy = PreservationPolicy(
        organization_id=org_id,
        name=name,
        description=body.get("description"),
        policy_type=policy_type,
        scope=body.get("scope", {"target": "all"}),
        rules=body.get("rules", {}),
        is_active=body.get("is_active", True),
        priority=body.get("priority", 0),
        created_by=auth.user_id,
    )
    db.add(policy)
    db.commit()

    return _serialize_policy(policy)


@router.put("/api/organizations/{org_id}/preservation/policies/{policy_id}", response_model=PreservationPolicyOut, summary="Update policy")
def update_policy(
    org_id: UUID,
    policy_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_ADMIN)),
    db: Session = Depends(get_db),
):
    """Update a preservation policy."""
    policy = db.query(PreservationPolicy).filter(
        PreservationPolicy.policy_id == policy_id,
        PreservationPolicy.organization_id == org_id,
    ).first()

    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")

    if not body:
        raise HTTPException(status_code=400, detail="Request body required")

    for field in ("name", "description", "scope", "rules", "is_active", "priority"):
        if field in body:
            setattr(policy, field, body[field])

    db.commit()
    return _serialize_policy(policy)


@router.delete("/api/organizations/{org_id}/preservation/policies/{policy_id}", response_model=MessageResponse, summary="Deactivate policy")
def deactivate_policy(
    org_id: UUID,
    policy_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_ADMIN)),
    db: Session = Depends(get_db),
):
    """Deactivate a preservation policy (soft delete)."""
    policy = db.query(PreservationPolicy).filter(
        PreservationPolicy.policy_id == policy_id,
        PreservationPolicy.organization_id == org_id,
    ).first()

    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")

    policy.is_active = False
    db.commit()
    return {"message": "Policy deactivated"}


# ============================================================================
# ACTION PLANS
# ============================================================================


@router.get("/api/organizations/{org_id}/preservation/action-plans", response_model=ActionPlanListResponse, summary="List action plans")
def list_action_plans(
    org_id: UUID,
    status: str = Query(None),
    action_type: str = Query(None),
    media_id: UUID = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.ORG_VIEW_AUDIT_LOGS)),
    db: Session = Depends(get_db),
):
    """List preservation action plans with filters."""
    query = db.query(PreservationActionPlan).filter(
        PreservationActionPlan.organization_id == org_id
    )

    if status:
        query = query.filter(PreservationActionPlan.status == status)
    if action_type:
        query = query.filter(PreservationActionPlan.action_type == action_type)
    if media_id:
        query = query.filter(PreservationActionPlan.media_id == media_id)

    total_count = query.count()
    plans = (
        query.order_by(desc(PreservationActionPlan.created_at))
        .limit(limit)
        .offset(offset)
        .all()
    )

    return {
        "items": [_serialize_action_plan(p) for p in plans],
        "total": total_count,
        "page": {
            "limit": limit,
            "offset": offset,
            "has_more": (offset + limit) < total_count,
        },
    }


@router.post("/api/organizations/{org_id}/preservation/action-plans/{action_id}/approve", response_model=PreservationActionPlanOut, summary="Approve action plan")
def approve_action_plan(
    org_id: UUID,
    action_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_ADMIN)),
    db: Session = Depends(get_db),
):
    """Approve a pending action plan."""
    plan = db.query(PreservationActionPlan).filter(
        PreservationActionPlan.action_id == action_id,
        PreservationActionPlan.organization_id == org_id,
    ).first()

    if not plan:
        raise HTTPException(status_code=404, detail="Action plan not found")

    if plan.status != "pending":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot approve plan in '{plan.status}' status",
        )

    plan.status = "approved"
    db.commit()
    return _serialize_action_plan(plan)


@router.post("/api/organizations/{org_id}/preservation/action-plans/{action_id}/cancel", response_model=PreservationActionPlanOut, summary="Cancel action plan")
def cancel_action_plan(
    org_id: UUID,
    action_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_ADMIN)),
    db: Session = Depends(get_db),
):
    """Cancel a pending or approved action plan."""
    plan = db.query(PreservationActionPlan).filter(
        PreservationActionPlan.action_id == action_id,
        PreservationActionPlan.organization_id == org_id,
    ).first()

    if not plan:
        raise HTTPException(status_code=404, detail="Action plan not found")

    if plan.status not in ("pending", "approved"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot cancel plan in '{plan.status}' status",
        )

    plan.status = "cancelled"
    db.commit()
    return _serialize_action_plan(plan)


# ============================================================================
# RETENTION REPORT
# ============================================================================


@router.get("/api/organizations/{org_id}/preservation/retention-report", response_model=RetentionReportResponse, summary="Retention report")
def retention_report(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.ORG_VIEW_AUDIT_LOGS)),
    db: Session = Depends(get_db),
):
    """Retention status overview."""
    from app.services.preservation_policy import get_retention_report

    report = get_retention_report(org_id, db)
    return report


# ============================================================================
# INFORMATION PACKAGES
# ============================================================================


@router.get("/api/organizations/{org_id}/media/{media_id}/information-packages", response_model=InformationPackageListResponse, summary="List media information packages")
def list_media_information_packages(
    org_id: UUID,
    media_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """List information packages for a specific media asset."""
    packages = (
        db.query(InformationPackage)
        .filter(
            InformationPackage.organization_id == org_id,
            InformationPackage.media_id == media_id,
        )
        .order_by(desc(InformationPackage.created_at))
        .all()
    )

    return {"information_packages": [_serialize_information_package(p) for p in packages]}


@router.get("/api/organizations/{org_id}/media/{media_id}/aip-manifest", response_model=AipManifestResponse, summary="Get aip manifest")
def get_aip_manifest(
    org_id: UUID,
    media_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """Get the full AIP manifest for a media asset."""
    from app.services.information_package import get_aip_manifest as _get_manifest

    manifest = _get_manifest(media_id, db)
    if not manifest:
        raise HTTPException(status_code=404, detail="No active AIP found for this media")

    return manifest


@router.get("/api/organizations/{org_id}/preservation/information-packages", response_model=InformationPackagePaginatedResponse, summary="List information packages")
def list_information_packages(
    org_id: UUID,
    package_type: str = Query(None),
    status: str = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.ORG_VIEW_AUDIT_LOGS)),
    db: Session = Depends(get_db),
):
    """List all information packages with filters."""
    query = db.query(InformationPackage).filter(
        InformationPackage.organization_id == org_id
    )

    if package_type:
        query = query.filter(InformationPackage.package_type == package_type)
    if status:
        query = query.filter(InformationPackage.status == status)

    total_count = query.count()
    packages = (
        query.order_by(desc(InformationPackage.created_at))
        .limit(limit)
        .offset(offset)
        .all()
    )

    return {
        "items": [_serialize_information_package(p) for p in packages],
        "total": total_count,
        "page": {
            "limit": limit,
            "offset": offset,
            "has_more": (offset + limit) < total_count,
        },
    }


# ============================================================================
# REPLICATION
# ============================================================================


@router.get("/api/organizations/{org_id}/media/{media_id}/replicas", response_model=ReplicationRecordListResponse, summary="List media replicas")
def list_media_replicas(
    org_id: UUID,
    media_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """List replica copies for a specific media asset."""
    records = (
        db.query(ReplicationRecord)
        .filter(
            ReplicationRecord.organization_id == org_id,
            ReplicationRecord.media_id == media_id,
        )
        .order_by(desc(ReplicationRecord.created_at))
        .all()
    )

    return {"replicas": [_serialize_replication_record(r) for r in records]}


@router.get("/api/organizations/{org_id}/preservation/replication-summary", response_model=ReplicationSummaryResponse, summary="Replication summary")
def replication_summary(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.ORG_VIEW_AUDIT_LOGS)),
    db: Session = Depends(get_db),
):
    """Replication coverage overview."""
    total_media = (
        db.query(func.count(Media.media_id))
        .filter(
            Media.organization_id == org_id,
            Media.processing_status == "completed",
        )
        .scalar()
    )

    replicated_count = (
        db.query(func.count(func.distinct(ReplicationRecord.media_id)))
        .filter(ReplicationRecord.organization_id == org_id)
        .scalar()
    )

    by_status = (
        db.query(
            ReplicationRecord.verification_status,
            func.count(ReplicationRecord.record_id),
        )
        .filter(ReplicationRecord.organization_id == org_id)
        .group_by(ReplicationRecord.verification_status)
        .all()
    )

    return {
        "total_media": total_media,
        "replicated_media": replicated_count,
        "unreplicated_media": total_media - replicated_count,
        "coverage_percent": round(
            (replicated_count / total_media * 100) if total_media else 0, 1
        ),
        "by_verification_status": {
            status: count for status, count in by_status
        },
    }
