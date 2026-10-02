"""
Email Events and SES Webhooks API endpoints (FastAPI).

Batch F — 8 routes:
  - Email Events (7 routes): list, get, stats, users by email status,
    update user email status, delete event, bulk delete
  - SES Webhooks (1 route): SNS webhook handler

Migrated from app/api/email_events.py and app/api/ses_webhooks.py.
"""

import json
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.models import EmailEvent, User
from app.permissions import Permission
from app.services.api_security import escape_ilike
from app.services.email_event_service import process_bounce, process_complaint, verify_sns_signature
from app.fastapi_app.schemas.common import MessageResponse
from app.fastapi_app.schemas.email_webhooks import (
    EmailEventListResponse,
    EmailStatsResponse,
    EmailEventDetailOut,
    BulkDeleteResponse,
    UserEmailStatusListResponse,
    UserEmailStatusUpdateResponse,
    SesWebhookResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["email-webhooks"])


# ============================================================================
# EMAIL EVENTS ENDPOINTS
# ============================================================================


@router.get("/api/email-events", response_model=EmailEventListResponse, summary="List email events")
def list_email_events(
    event_type: str = Query(None),
    email: str = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.PLATFORM_ADMIN)),
    db: Session = Depends(get_db),
):
    """List email events with filtering and pagination."""
    query = db.query(EmailEvent)

    if event_type:
        query = query.filter(EmailEvent.event_type == event_type)
    if email:
        query = query.filter(EmailEvent.email.ilike(f"%{escape_ilike(email)}%", escape="\\"))

    total_count = query.count()
    query = query.order_by(desc(EmailEvent.created_at))
    events = query.limit(limit).offset(offset).all()

    return {
        "items": [
            {
                "event_id": str(event.event_id),
                "email": event.email,
                "event_type": event.event_type,
                "bounce_type": event.bounce_type,
                "bounce_subtype": event.bounce_subtype,
                "complaint_feedback_type": event.complaint_feedback_type,
                "message_id": event.message_id,
                "created_at": event.created_at.isoformat() if event.created_at else None,
            }
            for event in events
        ],
        "total": total_count,
        "limit": limit,
        "offset": offset,
    }


@router.get("/api/email-events/stats", response_model=EmailStatsResponse, summary="Get email stats")
def get_email_stats(
    auth: AuthContext = Depends(require_permission(Permission.PLATFORM_ADMIN)),
    db: Session = Depends(get_db),
):
    """Get email event statistics for the last 30 days."""
    thirty_days_ago = datetime.now(timezone.utc) - timedelta(days=30)

    bounce_count = db.query(func.count(EmailEvent.event_id)).filter(
        EmailEvent.event_type == "bounce", EmailEvent.created_at >= thirty_days_ago,
    ).scalar() or 0

    complaint_count = db.query(func.count(EmailEvent.event_id)).filter(
        EmailEvent.event_type == "complaint", EmailEvent.created_at >= thirty_days_ago,
    ).scalar() or 0

    active_count = db.query(func.count(User.user_id)).filter(User.email_status == "active").scalar() or 0
    bounced_count = db.query(func.count(User.user_id)).filter(User.email_status == "bounced").scalar() or 0
    complaint_user_count = db.query(func.count(User.user_id)).filter(User.email_status == "complaint").scalar() or 0

    return {
        "last_30_days": {
            "bounces": bounce_count,
            "complaints": complaint_count,
            "total_events": bounce_count + complaint_count,
        },
        "user_email_status": {
            "active": active_count,
            "bounced": bounced_count,
            "complaint": complaint_user_count,
            "total": active_count + bounced_count + complaint_user_count,
        },
    }


@router.get("/api/email-events/{event_id}", response_model=EmailEventDetailOut, summary="Get email event")
def get_email_event(
    event_id: str,
    auth: AuthContext = Depends(require_permission(Permission.PLATFORM_ADMIN)),
    db: Session = Depends(get_db),
):
    """Get detailed information about a specific email event."""
    event = db.query(EmailEvent).filter_by(event_id=event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    return {
        "event_id": str(event.event_id),
        "email": event.email,
        "event_type": event.event_type,
        "bounce_type": event.bounce_type,
        "bounce_subtype": event.bounce_subtype,
        "complaint_feedback_type": event.complaint_feedback_type,
        "message_id": event.message_id,
        "sns_message_id": event.sns_message_id,
        "raw_message": event.raw_message,
        "created_at": event.created_at.isoformat() if event.created_at else None,
    }


@router.delete("/api/email-events/{event_id}", response_model=MessageResponse, summary="Delete email event")
def delete_email_event(
    event_id: str,
    auth: AuthContext = Depends(require_permission(Permission.PLATFORM_ADMIN)),
    db: Session = Depends(get_db),
):
    """Delete a single email event."""
    event = db.query(EmailEvent).filter_by(event_id=event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    db.delete(event)
    db.commit()
    return {"message": "Email event deleted successfully"}


@router.post("/api/email-events/bulk-delete", response_model=BulkDeleteResponse, summary="Bulk delete email events")
def bulk_delete_email_events(
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.PLATFORM_ADMIN)),
    db: Session = Depends(get_db),
):
    """Bulk delete email events."""
    body = body or {}
    event_type = body.get("event_type")
    before_date = body.get("before_date")
    delete_all = body.get("delete_all", False)

    query = db.query(EmailEvent)

    if not delete_all:
        if event_type:
            query = query.filter(EmailEvent.event_type == event_type)
        if before_date:
            try:
                cutoff_date = datetime.fromisoformat(before_date.replace("Z", "+00:00"))
                query = query.filter(EmailEvent.created_at < cutoff_date)
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid date format. Use ISO 8601")

        if not event_type and not before_date:
            raise HTTPException(status_code=400, detail="Must specify filters (event_type or before_date) or delete_all=true")

    count = query.count()
    query.delete(synchronize_session=False)
    db.commit()

    return {"message": f"Deleted {count} email event(s)", "deleted_count": count}


@router.get("/api/users/email-status", response_model=UserEmailStatusListResponse, summary="List users by email status")
def list_users_by_email_status(
    status: str = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.PLATFORM_ADMIN)),
    db: Session = Depends(get_db),
):
    """List users with their email status."""
    query = db.query(User)

    if status:
        query = query.filter(User.email_status == status)

    total_count = query.count()
    query = query.order_by(desc(User.created_at))
    users = query.limit(limit).offset(offset).all()

    return {
        "items": [
            {
                "user_id": str(user.user_id),
                "email": user.email,
                "email_status": user.email_status,
                "status": user.status,
                "created_at": user.created_at.isoformat() if user.created_at else None,
            }
            for user in users
        ],
        "total": total_count,
        "limit": limit,
        "offset": offset,
    }


@router.patch("/api/users/{user_id}/email-status", response_model=UserEmailStatusUpdateResponse, summary="Update user email status")
def update_user_email_status(
    user_id: str,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.PLATFORM_ADMIN)),
    db: Session = Depends(get_db),
):
    """Update a user's email status (admin override)."""
    new_status = body.get("email_status")
    if not new_status:
        raise HTTPException(status_code=400, detail="email_status is required")

    if new_status not in ["active", "bounced", "complaint"]:
        raise HTTPException(status_code=400, detail="Invalid email_status value")

    user = db.query(User).filter_by(user_id=user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    old_status = user.email_status
    user.email_status = new_status
    db.commit()

    return {
        "user_id": str(user.user_id),
        "email": user.email,
        "email_status": user.email_status,
        "message": f"Email status updated from {old_status} to {new_status}",
    }


# ============================================================================
# SES WEBHOOK ENDPOINT
# ============================================================================


@router.post("/api/webhooks/ses", response_model=SesWebhookResponse, summary="Ses webhook")
async def ses_webhook(
    request: Request,
    db: Session = Depends(get_db),
):
    """Handle SNS notifications from AWS SES."""
    # Parsed outside the try below: that block ends in `except Exception -> 500`,
    # which swallowed the JSONDecodeError the app-level handler turns into a
    # 400. This endpoint is public and unauthenticated, so any empty or
    # malformed POST reported itself as a server fault.
    try:
        message = await request.json()
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON body: {exc.msg}") from exc

    try:
        if not message:
            raise HTTPException(status_code=400, detail="Empty message")

        message_type = message.get("Type")
        if not message_type:
            raise HTTPException(status_code=400, detail="Missing Type field")

        if not verify_sns_signature(message):
            raise HTTPException(status_code=401, detail="Invalid signature")

        if message_type == "SubscriptionConfirmation":
            subscribe_url = message.get("SubscribeURL")
            if not subscribe_url:
                raise HTTPException(status_code=400, detail="Missing SubscribeURL")

            logger.info(f"SNS subscription confirmation received. Visit: {subscribe_url}")
            return {"message": "Please confirm subscription manually", "subscribe_url": subscribe_url}

        if message_type == "Notification":
            ses_message_str = message.get("Message")
            if not ses_message_str:
                raise HTTPException(status_code=400, detail="Missing Message field")

            try:
                ses_message = json.loads(ses_message_str)
            except json.JSONDecodeError:
                raise HTTPException(status_code=400, detail="Invalid SES message JSON")

            event_type = ses_message.get("eventType") or ses_message.get("notificationType")
            if not event_type:
                raise HTTPException(status_code=400, detail="Missing eventType")

            event_type_lower = event_type.lower()

            if event_type_lower == "bounce":
                process_bounce(ses_message, message.get("MessageId"))
                return {"status": "bounce processed"}
            elif event_type_lower == "complaint":
                process_complaint(ses_message, message.get("MessageId"))
                return {"status": "complaint processed"}
            else:
                raise HTTPException(status_code=400, detail=f"Unknown event type: {event_type}")

        raise HTTPException(status_code=400, detail=f"Unknown message type: {message_type}")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing SES webhook: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Error processing SES webhook")
