"""
Notifications API — FastAPI router.

5 routes for managing user notifications:
- List notifications (paginated, unread filter)
- Get unread count
- Mark notification read
- Mark all read
- Delete notification
"""

import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_auth
from app.fastapi_app.schemas.common import SuccessResponse
from app.fastapi_app.schemas.notifications import (
    NotificationListResponse,
    UnreadCountResponse,
    MarkAllReadResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["notifications"])

DEFAULT_LIMIT = 20
MAX_LIMIT = 100


def _serialize_notification(notification) -> dict:
    """Serialize a notification for API response."""
    return {
        "notification_id": str(notification.notification_id),
        "notification_type": notification.notification_type,
        "title": notification.title,
        "message": notification.message,
        "entity_type": notification.entity_type,
        "entity_id": str(notification.entity_id) if notification.entity_id else None,
        "actor": {
            "user_id": str(notification.actor_id) if notification.actor_id else None,
            "display_name": notification.actor.display_name if notification.actor else None,
        } if notification.actor_id else None,
        "is_read": notification.is_read,
        "read_at": notification.read_at.isoformat() if notification.read_at else None,
        "created_at": notification.created_at.isoformat() if notification.created_at else None,
    }


@router.get("/api/organizations/{org_id}/notifications", response_model=NotificationListResponse, summary="List notifications")
def list_notifications(
    org_id: UUID,
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    offset: int = Query(0, ge=0),
    unread_only: bool = Query(False),
    auth: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """List notifications."""
    from app.models import Notification

    query = (
        db.query(Notification)
        .filter(
            Notification.organization_id == org_id,
            Notification.user_id == auth.user_id,
        )
    )

    if unread_only:
        query = query.filter(Notification.is_read == False)  # noqa: E712

    total_count = query.count()

    unread_count = (
        db.query(Notification)
        .filter(
            Notification.organization_id == org_id,
            Notification.user_id == auth.user_id,
            Notification.is_read == False,  # noqa: E712
        )
        .count()
    )

    notifications = (
        query
        .order_by(Notification.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    return {
        "items": [_serialize_notification(n) for n in notifications],
        "unread_count": unread_count,
        "total": total_count,
        "has_more": offset + limit < total_count,
        "limit": limit,
        "offset": offset,
    }


@router.get("/api/organizations/{org_id}/notifications/unread-count", response_model=UnreadCountResponse, summary="Get unread count")
def get_unread_count(
    org_id: UUID,
    auth: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Get unread count."""
    from app.models import Notification

    count = (
        db.query(Notification)
        .filter(
            Notification.organization_id == org_id,
            Notification.user_id == auth.user_id,
            Notification.is_read == False,  # noqa: E712
        )
        .count()
    )

    return {"unread_count": count}


@router.post("/api/organizations/{org_id}/notifications/{notification_id}/read", response_model=SuccessResponse, summary="Mark as read")
def mark_as_read(
    org_id: UUID,
    notification_id: UUID,
    auth: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Mark as read."""
    from app.models import Notification

    notification = (
        db.query(Notification)
        .filter(
            Notification.notification_id == notification_id,
            Notification.organization_id == org_id,
            Notification.user_id == auth.user_id,
        )
        .first()
    )

    if not notification:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Notification not found",
        })

    if not notification.is_read:
        notification.is_read = True
        notification.read_at = datetime.now(timezone.utc)
        db.commit()

    return {"success": True}


@router.post("/api/organizations/{org_id}/notifications/read-all", response_model=MarkAllReadResponse, summary="Mark all as read")
def mark_all_as_read(
    org_id: UUID,
    auth: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Mark all as read."""
    from app.models import Notification

    now = datetime.now(timezone.utc)

    result = (
        db.query(Notification)
        .filter(
            Notification.organization_id == org_id,
            Notification.user_id == auth.user_id,
            Notification.is_read == False,  # noqa: E712
        )
        .update({
            Notification.is_read: True,
            Notification.read_at: now,
        })
    )

    db.commit()

    return {"success": True, "marked_count": result}


@router.delete("/api/organizations/{org_id}/notifications/{notification_id}", response_model=SuccessResponse, summary="Delete notification")
def delete_notification(
    org_id: UUID,
    notification_id: UUID,
    auth: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Delete notification."""
    from app.models import Notification

    notification = (
        db.query(Notification)
        .filter(
            Notification.notification_id == notification_id,
            Notification.organization_id == org_id,
            Notification.user_id == auth.user_id,
        )
        .first()
    )

    if not notification:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Notification not found",
        })

    db.delete(notification)
    db.commit()

    return {"success": True}
