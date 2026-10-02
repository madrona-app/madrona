"""
Media Rights, Publishing, Consent, Usage Analytics, and Expiration Alerts API endpoints (FastAPI).

Phase 9b — 20 routes:
  - Publishing (4 routes): publish, unpublish, review-metadata, clear-metadata-review
  - Rights CRUD (4 routes)
  - Consent CRUD + revoke (5 routes)
  - Usage Analytics (3 routes): log, stats, report
  - Expiration Alerts (4 routes): list, summary, dismiss, acknowledge

Consent document upload/download deferred to Phase 9c (requires S3/file upload).
Migrated from app/api/media.py.
"""

import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.models import (
    ExpirationAlert,
    Media,
    MediaConsent,
    MediaRights,
    MediaUsageEvent,
)
from app.fastapi_app.schemas.common import SuccessResponse
from app.fastapi_app.schemas.media_rights_publishing import (
    ClearMetadataReviewResponse,
    ExpirationAlertActionResponse,
    ExpirationAlertListResponse,
    ExpirationAlertSummaryResponse,
    MediaConsentCreatedResponse,
    MediaConsentDeletedResponse,
    MediaConsentListResponse,
    MediaConsentRevokedResponse,
    MediaConsentUpdatedResponse,
    MediaRightsCreatedResponse,
    MediaRightsListResponse,
    MediaRightsUpdatedResponse,
    MediaUsageReportResponse,
    MediaUsageStatsResponse,
    PublishMediaResponse,
    ReviewMetadataResponse,
    UnpublishMediaResponse,
    UsageEventCreatedResponse,
)
from app.permissions import Permission

logger = logging.getLogger(__name__)

router = APIRouter(tags=["media-rights-publishing"])


# ============================================================================
# SERIALIZERS
# ============================================================================


def _serialize_rights(r: MediaRights) -> dict:
    return {
        "rights_id": str(r.rights_id),
        "media_id": str(r.media_id),
        "organization_id": str(r.organization_id),
        "rights_type": r.rights_type,
        "rights_status": r.rights_status,
        "rights_holder": r.rights_holder,
        "license_type": r.license_type,
        "license_url": r.license_url,
        "rights_statement": r.rights_statement,
        "start_date": r.start_date.isoformat() if r.start_date else None,
        "end_date": r.end_date.isoformat() if r.end_date else None,
        "territory": r.territory,
        "usage_restrictions": r.usage_restrictions,
        "is_active": r.is_active,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


def _serialize_consent(c: MediaConsent) -> dict:
    return {
        "consent_id": str(c.consent_id),
        "media_id": str(c.media_id),
        "subject_name": c.subject_name,
        "subject_role": c.subject_role,
        "consent_type": c.consent_type,
        "consent_scope": c.consent_scope,
        "consent_date": c.consent_date.isoformat() if c.consent_date else None,
        "expiry_date": c.expiry_date.isoformat() if c.expiry_date else None,
        "consent_document_key": c.consent_document_key,
        "is_valid": c.is_valid,
        "revocation_date": c.revocation_date.isoformat() if c.revocation_date else None,
        "revocation_reason": c.revocation_reason,
        "notes": c.notes,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


def _serialize_alert(a: ExpirationAlert, media_lookup: dict | None = None) -> dict:
    result = {
        "alert_id": str(a.alert_id),
        "media_id": str(a.media_id),
        "alert_type": a.alert_type,
        "related_id": str(a.related_id),
        "expiry_date": a.expiry_date.isoformat() if a.expiry_date else None,
        "days_until_expiry": a.days_until_expiry,
        "severity": a.severity,
        "status": a.status,
        "email_sent_at": a.email_sent_at.isoformat() if a.email_sent_at else None,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }
    if media_lookup:
        media = media_lookup.get(a.media_id)
        if media:
            result["media_title"] = media.title
            result["media_filename"] = media.filename
    return result


# ============================================================================
# HELPERS
# ============================================================================


def _get_media_or_404(db: Session, org_id: UUID, media_id: UUID) -> Media:
    media = db.query(Media).filter(
        Media.media_id == media_id,
        Media.organization_id == org_id,
    ).first()
    if not media:
        raise HTTPException(status_code=404, detail="Media not found")
    return media


# ============================================================================
# PUBLISHING ENDPOINTS
# ============================================================================


@router.post("/api/organizations/{org_id}/media/{media_id}/publish", response_model=PublishMediaResponse, summary="Publish media")
def publish_media(
    org_id: UUID,
    media_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Publish media — HARD-GATED on rights + sensitive-content review.

    Refuses (409) unless active rights are on file AND the metadata has been
    reviewed, via the same applier the orchestrated publish-clearance flow uses.
    The UI mirrors this gate (the Publish action is disabled until both are
    satisfied), so a 409 here is a backstop, not the primary UX. Processing
    completeness remains a non-blocking advisory."""
    media = _get_media_or_404(db, org_id, media_id)
    from app.services.media.creation._support import MediaPublishBlocked
    from app.services.media.creation.media_publish import apply_media_publish

    try:
        media = apply_media_publish(db, org_id, {"media_id": media_id}, auth.user_id)
    except MediaPublishBlocked as e:
        db.rollback()
        # 409: already-published; 422: a rights/review precondition is unmet.
        code = 409 if "already published" in str(e) else 422
        raise HTTPException(status_code=code, detail=str(e))

    warnings = []
    if media.processing_status != "completed":
        warnings.append(f"Processing status is '{media.processing_status}'")
    db.commit()

    return {
        "success": True,
        "media_id": str(media_id),
        "is_published": True,
        "warnings": warnings,
    }


@router.post("/api/organizations/{org_id}/media/{media_id}/unpublish", response_model=UnpublishMediaResponse, summary="Unpublish media")
def unpublish_media(
    org_id: UUID,
    media_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Unpublish media."""
    media = _get_media_or_404(db, org_id, media_id)

    media.is_published = False
    media.published_at = None
    media.published_by = None
    db.commit()

    return {"success": True, "media_id": str(media_id), "is_published": False}


@router.post("/api/organizations/{org_id}/media/{media_id}/review-metadata", response_model=ReviewMetadataResponse, summary="Review metadata")
def review_metadata(
    org_id: UUID,
    media_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Review metadata."""
    _get_media_or_404(db, org_id, media_id)
    from app.services.media.creation.media_review import apply_media_review

    media = apply_media_review(
        db, org_id, {"media_id": media_id, "notes": body.get("notes")}, auth.user_id
    )
    db.commit()

    return {
        "success": True,
        "media_id": str(media_id),
        "metadata_reviewed": True,
        "metadata_reviewed_at": media.metadata_reviewed_at.isoformat(),
        "metadata_reviewed_by": str(auth.user_id) if auth.user_id else None,
    }


@router.post("/api/organizations/{org_id}/media/{media_id}/clear-metadata-review", response_model=ClearMetadataReviewResponse, summary="Clear metadata review")
def clear_metadata_review(
    org_id: UUID,
    media_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Clear metadata review."""
    media = _get_media_or_404(db, org_id, media_id)

    media.metadata_reviewed = False
    media.metadata_reviewed_at = None
    media.metadata_reviewed_by = None
    media.metadata_review_notes = None
    db.commit()

    return {"success": True, "media_id": str(media_id), "metadata_reviewed": False}


# ============================================================================
# MEDIA RIGHTS ENDPOINTS
# ============================================================================


@router.get("/api/organizations/{org_id}/media/{media_id}/rights", response_model=MediaRightsListResponse, summary="Get media rights")
def get_media_rights(
    org_id: UUID,
    media_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """Get media rights."""
    rights = db.query(MediaRights).filter(
        MediaRights.media_id == media_id,
    ).all()

    return {
        "media_id": str(media_id),
        "rights": [_serialize_rights(r) for r in rights],
    }


@router.post("/api/organizations/{org_id}/media/{media_id}/rights", response_model=MediaRightsCreatedResponse, status_code=201, summary="Create media rights")
def create_media_rights(
    org_id: UUID,
    media_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Create media rights."""
    _get_media_or_404(db, org_id, media_id)
    # Single source of truth: the draft applier and this route share create_fn.
    from app.services.media.creation.media_rights import (
        create_media_rights as _create_media_rights,
    )

    rights = _create_media_rights(
        db, org_id, {**body, "media_id": media_id}, auth.user_id
    )

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Rights record already exists")

    return {
        "rights_id": str(rights.rights_id),
        "media_id": str(media_id),
        "rights_type": rights.rights_type,
    }


@router.put("/api/organizations/{org_id}/media/{media_id}/rights/{rights_id}", response_model=MediaRightsUpdatedResponse, summary="Update media rights")
def update_media_rights(
    org_id: UUID,
    media_id: UUID,
    rights_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Update media rights."""
    rights = db.query(MediaRights).filter(
        MediaRights.rights_id == rights_id,
        MediaRights.media_id == media_id,
    ).first()
    if not rights:
        raise HTTPException(status_code=404, detail="Rights record not found")

    for field in [
        "rights_type", "rights_status", "rights_holder", "license_type",
        "license_url", "rights_statement", "territory", "usage_restrictions",
        "is_active",
    ]:
        if field in body:
            setattr(rights, field, body[field])

    if "start_date" in body:
        rights.start_date = datetime.fromisoformat(body["start_date"]).date() if body["start_date"] else None
    if "end_date" in body:
        rights.end_date = datetime.fromisoformat(body["end_date"]).date() if body["end_date"] else None

    rights.updated_at = datetime.now(timezone.utc)
    rights.updated_by = auth.user_id

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Rights record conflict")

    return {"rights_id": str(rights.rights_id)}


@router.delete("/api/organizations/{org_id}/media/{media_id}/rights/{rights_id}", response_model=SuccessResponse, summary="Delete media rights")
def delete_media_rights(
    org_id: UUID,
    media_id: UUID,
    rights_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete media rights."""
    rights = db.query(MediaRights).filter(
        MediaRights.rights_id == rights_id,
        MediaRights.media_id == media_id,
    ).first()
    if not rights:
        raise HTTPException(status_code=404, detail="Rights record not found")

    try:
        db.delete(rights)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Cannot delete rights with existing references")

    return {"success": True}


# ============================================================================
# MEDIA CONSENT ENDPOINTS
# ============================================================================


@router.get("/api/organizations/{org_id}/media/{media_id}/consent", response_model=MediaConsentListResponse, summary="List media consent")
def list_media_consent(
    org_id: UUID,
    media_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """List media consent."""
    consent_records = db.query(MediaConsent).filter(
        MediaConsent.media_id == media_id,
    ).order_by(MediaConsent.created_at.desc()).all()

    return {
        "media_id": str(media_id),
        "consent_records": [_serialize_consent(c) for c in consent_records],
        "total": len(consent_records),
        "has_valid_consent": any(c.is_valid for c in consent_records),
    }


@router.post("/api/organizations/{org_id}/media/{media_id}/consent", response_model=MediaConsentCreatedResponse, status_code=201, summary="Create media consent")
def create_media_consent(
    org_id: UUID,
    media_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Create media consent."""
    _get_media_or_404(db, org_id, media_id)

    subject_name = (body.get("subject_name") or "").strip()
    if not subject_name:
        raise HTTPException(status_code=400, detail="subject_name is required")

    from app.services.media.creation.media_consent import (
        create_media_consent as _create_media_consent,
    )

    consent = _create_media_consent(
        db, org_id, {**body, "media_id": media_id, "subject_name": subject_name},
        auth.user_id,
    )

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Consent record already exists")

    return {
        "consent_id": str(consent.consent_id),
        "media_id": str(media_id),
        "subject_name": consent.subject_name,
        "consent_type": consent.consent_type,
        "consent_scope": consent.consent_scope,
        "is_valid": consent.is_valid,
    }


@router.put("/api/organizations/{org_id}/media/{media_id}/consent/{consent_id}", response_model=MediaConsentUpdatedResponse, summary="Update media consent")
def update_media_consent(
    org_id: UUID,
    media_id: UUID,
    consent_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Update media consent."""
    _get_media_or_404(db, org_id, media_id)

    consent = db.query(MediaConsent).filter(
        MediaConsent.consent_id == consent_id,
        MediaConsent.media_id == media_id,
    ).first()
    if not consent:
        raise HTTPException(status_code=404, detail="Consent record not found")

    for field in [
        "subject_name", "subject_role", "consent_type", "consent_scope",
        "consent_document_key", "is_valid", "notes",
    ]:
        if field in body:
            setattr(consent, field, body[field])

    if "consent_date" in body:
        consent.consent_date = datetime.fromisoformat(body["consent_date"]).date() if body["consent_date"] else None
    if "expiry_date" in body:
        consent.expiry_date = datetime.fromisoformat(body["expiry_date"]).date() if body["expiry_date"] else None

    consent.updated_at = datetime.now(timezone.utc)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Consent record conflict")

    return {
        "consent_id": str(consent.consent_id),
        "media_id": str(media_id),
        "subject_name": consent.subject_name,
        "is_valid": consent.is_valid,
        "message": "Consent record updated",
    }


@router.delete("/api/organizations/{org_id}/media/{media_id}/consent/{consent_id}", response_model=MediaConsentDeletedResponse, summary="Delete media consent")
def delete_media_consent(
    org_id: UUID,
    media_id: UUID,
    consent_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete media consent."""
    _get_media_or_404(db, org_id, media_id)

    consent = db.query(MediaConsent).filter(
        MediaConsent.consent_id == consent_id,
        MediaConsent.media_id == media_id,
    ).first()
    if not consent:
        raise HTTPException(status_code=404, detail="Consent record not found")

    try:
        db.delete(consent)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Cannot delete consent with existing references")

    return {"success": True, "consent_id": str(consent_id)}


@router.post("/api/organizations/{org_id}/media/{media_id}/consent/{consent_id}/revoke", response_model=MediaConsentRevokedResponse, summary="Revoke media consent")
def revoke_media_consent(
    org_id: UUID,
    media_id: UUID,
    consent_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Revoke media consent."""
    _get_media_or_404(db, org_id, media_id)

    consent = db.query(MediaConsent).filter(
        MediaConsent.consent_id == consent_id,
        MediaConsent.media_id == media_id,
    ).first()
    if not consent:
        raise HTTPException(status_code=404, detail="Consent record not found")

    if not consent.is_valid:
        raise HTTPException(status_code=400, detail="Consent is already revoked")

    consent.is_valid = False
    consent.revocation_date = datetime.now(timezone.utc).date()
    consent.revocation_reason = body.get("revocation_reason")
    db.commit()

    return {
        "consent_id": str(consent.consent_id),
        "media_id": str(media_id),
        "subject_name": consent.subject_name,
        "is_valid": consent.is_valid,
        "revocation_date": consent.revocation_date.isoformat() if consent.revocation_date else None,
        "message": "Consent revoked successfully",
    }


# ============================================================================
# USAGE ANALYTICS ENDPOINTS
# ============================================================================

VALID_EVENT_TYPES = {"view", "download", "embed", "api_access", "share"}


@router.post("/api/organizations/{org_id}/media/{media_id}/usage", response_model=UsageEventCreatedResponse, status_code=201, summary="Log media usage")
def log_media_usage(
    org_id: UUID,
    media_id: UUID,
    body: dict,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """Log media usage."""
    _get_media_or_404(db, org_id, media_id)

    event_type = body.get("event_type", "view")
    if event_type not in VALID_EVENT_TYPES:
        raise HTTPException(status_code=400, detail="Invalid event type")

    client_host = request.client.host if request.client else None
    user_agent = (request.headers.get("User-Agent") or "")[:500]
    referrer = (request.headers.get("Referer") or "")[:500] or None

    event = MediaUsageEvent(
        organization_id=org_id,
        media_id=media_id,
        event_type=event_type,
        user_id=auth.user_id,
        derivative_type=body.get("derivative_type"),
        access_context=body.get("access_context", "internal"),
        ip_address=client_host,
        user_agent=user_agent,
        referrer=referrer,
        event_metadata=body.get("metadata"),
    )
    db.add(event)
    db.commit()

    return {
        "event_id": str(event.event_id),
        "media_id": str(media_id),
        "event_type": event_type,
        "logged_at": event.created_at.isoformat() if event.created_at else None,
    }


@router.get("/api/organizations/{org_id}/media/{media_id}/usage", response_model=MediaUsageStatsResponse, summary="Get media usage stats")
def get_media_usage_stats(
    org_id: UUID,
    media_id: UUID,
    days: int = Query(30, ge=1, le=365),
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """Get media usage stats."""
    _get_media_or_404(db, org_id, media_id)

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    event_counts = db.query(
        MediaUsageEvent.event_type, func.count(MediaUsageEvent.event_id)
    ).filter(
        MediaUsageEvent.media_id == media_id,
        MediaUsageEvent.created_at >= cutoff,
    ).group_by(MediaUsageEvent.event_type).all()

    counts_dict = {row[0]: row[1] for row in event_counts}
    total = sum(counts_dict.values())

    unique_users = db.query(
        func.count(func.distinct(MediaUsageEvent.user_id))
    ).filter(
        MediaUsageEvent.media_id == media_id,
        MediaUsageEvent.created_at >= cutoff,
        MediaUsageEvent.user_id.isnot(None),
    ).scalar() or 0

    return {
        "media_id": str(media_id),
        "period_days": days,
        "total_events": total,
        "unique_users": unique_users,
        "by_event_type": {
            "views": counts_dict.get("view", 0),
            "downloads": counts_dict.get("download", 0),
            "embeds": counts_dict.get("embed", 0),
            "api_access": counts_dict.get("api_access", 0),
            "shares": counts_dict.get("share", 0),
        },
    }


@router.get("/api/organizations/{org_id}/media/usage/report", response_model=MediaUsageReportResponse, summary="Get media usage report")
def get_media_usage_report(
    org_id: UUID,
    days: int = Query(30, ge=1, le=365),
    limit: int = Query(10, ge=1, le=100),
    event_type: str = Query(None),
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """Get media usage report."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    # Total counts by event type
    total_counts = db.query(
        MediaUsageEvent.event_type, func.count(MediaUsageEvent.event_id)
    ).filter(
        MediaUsageEvent.organization_id == org_id,
        MediaUsageEvent.created_at >= cutoff,
    ).group_by(MediaUsageEvent.event_type).all()
    totals_dict = {row[0]: row[1] for row in total_counts}

    # Top media by event count
    top_media_query = db.query(
        MediaUsageEvent.media_id, func.count(MediaUsageEvent.event_id).label("event_count")
    ).filter(
        MediaUsageEvent.organization_id == org_id,
        MediaUsageEvent.created_at >= cutoff,
    )
    if event_type:
        top_media_query = top_media_query.filter(MediaUsageEvent.event_type == event_type)

    top_media = top_media_query.group_by(MediaUsageEvent.media_id).order_by(
        func.count(MediaUsageEvent.event_id).desc()
    ).limit(limit).all()

    media_ids = [row[0] for row in top_media]
    media_lookup = {}
    if media_ids:
        media_items = db.query(Media).filter(Media.media_id.in_(media_ids)).all()
        media_lookup = {m.media_id: m for m in media_items}

    top_media_list = [
        {
            "media_id": str(mid),
            "title": media_lookup[mid].title if mid in media_lookup else None,
            "filename": media_lookup[mid].filename if mid in media_lookup else None,
            "event_count": count,
        }
        for mid, count in top_media
    ]

    return {
        "organization_id": str(org_id),
        "period_start": cutoff.isoformat(),
        "period_end": datetime.now(timezone.utc).isoformat(),
        "period_days": days,
        "total_events": sum(totals_dict.values()),
        "by_event_type": {
            "views": totals_dict.get("view", 0),
            "downloads": totals_dict.get("download", 0),
            "embeds": totals_dict.get("embed", 0),
            "api_accesses": totals_dict.get("api_access", 0),
            "shares": totals_dict.get("share", 0),
        },
        "top_media": top_media_list,
    }


# ============================================================================
# EXPIRATION ALERTS ENDPOINTS
# ============================================================================


@router.get("/api/organizations/{org_id}/media/expiration-alerts", response_model=ExpirationAlertListResponse, summary="List expiration alerts")
def list_expiration_alerts(
    org_id: UUID,
    status: str = Query("active"),
    severity: str = Query(None),
    alert_type: str = Query(None),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """List expiration alerts."""
    query = db.query(ExpirationAlert).filter(
        ExpirationAlert.organization_id == org_id,
    )
    if status:
        query = query.filter(ExpirationAlert.status == status)
    if severity:
        query = query.filter(ExpirationAlert.severity == severity)
    if alert_type:
        query = query.filter(ExpirationAlert.alert_type == alert_type)

    total = query.count()
    alerts = query.order_by(ExpirationAlert.expiry_date.asc()).offset(offset).limit(limit).all()

    media_ids = list({a.media_id for a in alerts})
    media_lookup = {}
    if media_ids:
        media_items = db.query(Media).filter(Media.media_id.in_(media_ids)).all()
        media_lookup = {m.media_id: m for m in media_items}

    return {
        "items": [_serialize_alert(a, media_lookup) for a in alerts],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/api/organizations/{org_id}/media/expiration-alerts/summary", response_model=ExpirationAlertSummaryResponse, summary="Get expiration alerts summary")
def get_expiration_alerts_summary(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """Get expiration alerts summary."""
    counts = db.query(
        ExpirationAlert.severity, func.count(ExpirationAlert.alert_id)
    ).filter(
        ExpirationAlert.organization_id == org_id,
        ExpirationAlert.status == "active",
    ).group_by(ExpirationAlert.severity).all()
    counts_dict = {row[0]: row[1] for row in counts}

    type_counts = db.query(
        ExpirationAlert.alert_type, func.count(ExpirationAlert.alert_id)
    ).filter(
        ExpirationAlert.organization_id == org_id,
        ExpirationAlert.status == "active",
    ).group_by(ExpirationAlert.alert_type).all()
    type_dict = {row[0]: row[1] for row in type_counts}

    return {
        "total_active": sum(counts_dict.values()),
        "by_severity": {
            "critical": counts_dict.get("critical", 0),
            "urgent": counts_dict.get("urgent", 0),
            "warning": counts_dict.get("warning", 0),
        },
        "by_type": {
            "rights": type_dict.get("rights", 0),
            "consent": type_dict.get("consent", 0),
        },
    }


# Static path "summary" must be before parameterized "{alert_id}" paths
@router.patch("/api/organizations/{org_id}/media/expiration-alerts/{alert_id}/dismiss", response_model=ExpirationAlertActionResponse, summary="Dismiss expiration alert")
def dismiss_expiration_alert(
    org_id: UUID,
    alert_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Dismiss expiration alert."""
    alert = db.query(ExpirationAlert).filter(
        ExpirationAlert.alert_id == alert_id,
        ExpirationAlert.organization_id == org_id,
    ).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    if alert.status == "dismissed":
        raise HTTPException(status_code=400, detail="Alert is already dismissed")

    alert.status = "dismissed"
    alert.dismissed_at = datetime.now(timezone.utc)
    alert.dismissed_by = auth.user_id
    if body.get("notes"):
        alert.notes = body["notes"]
    db.commit()

    return {
        "alert_id": str(alert.alert_id),
        "status": alert.status,
        "dismissed_at": alert.dismissed_at.isoformat() if alert.dismissed_at else None,
        "message": "Alert dismissed",
    }


@router.patch("/api/organizations/{org_id}/media/expiration-alerts/{alert_id}/acknowledge", response_model=ExpirationAlertActionResponse, summary="Acknowledge expiration alert")
def acknowledge_expiration_alert(
    org_id: UUID,
    alert_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Acknowledge expiration alert."""
    alert = db.query(ExpirationAlert).filter(
        ExpirationAlert.alert_id == alert_id,
        ExpirationAlert.organization_id == org_id,
    ).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    alert.status = "acknowledged"
    if body.get("notes"):
        alert.notes = body["notes"]
    db.commit()

    return {
        "alert_id": str(alert.alert_id),
        "status": alert.status,
        "message": "Alert acknowledged",
    }
