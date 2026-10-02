"""
Discussions API — FastAPI router.

7 routes for record-bound discussion comments and watches:
- List/create/count comments
- Get/start/stop watch
- Export comments
"""

import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_auth
from app.fastapi_app.schemas.discussions import (
    CommentCountResponse,
    CommentCreatedResponse,
    CommentExportResponse,
    CommentListResponse,
    WatchStatusResponse,
)
from app.fastapi_app.schemas.misc import CreateCommentBody

logger = logging.getLogger(__name__)

router = APIRouter(tags=["discussions"])

DEFAULT_LIMIT = 50
MAX_LIMIT = 200


def _validate_entity_type(entity_type: str) -> bool:
    from app.models import DISCUSSION_ENTITY_TYPES
    return entity_type in DISCUSSION_ENTITY_TYPES


def _serialize_comment(comment) -> dict:
    return {
        "comment_id": str(comment.comment_id),
        "entity_type": comment.entity_type,
        "entity_id": str(comment.entity_id),
        "author": {
            "user_id": str(comment.author_id),
            "display_name": comment.author.display_name if comment.author else None,
            "email": comment.author.email if comment.author else None,
        },
        "content": comment.content,
        "kind": comment.kind,
        "created_at": comment.created_at.isoformat() if comment.created_at else None,
    }


# =============================================================================
# Comments
# =============================================================================


@router.get("/api/organizations/{org_id}/records/{entity_type}/{entity_id}/comments", response_model=CommentListResponse, summary="List comments")
def list_comments(
    org_id: UUID,
    entity_type: str,
    entity_id: UUID,
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """List comments."""
    if not _validate_entity_type(entity_type):
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": f"Invalid entity type: {entity_type}",
        })

    from app.models import RecordComment

    query = (
        db.query(RecordComment)
        .filter(
            RecordComment.organization_id == org_id,
            RecordComment.entity_type == entity_type,
            RecordComment.entity_id == entity_id,
        )
        .order_by(RecordComment.created_at.asc())
    )

    total_count = query.count()
    comments = query.options(joinedload(RecordComment.author)).offset(offset).limit(limit).all()

    return {
        "items": [_serialize_comment(c) for c in comments],
        "total": total_count,
        "has_more": offset + limit < total_count,
        "limit": limit,
        "offset": offset,
    }


@router.post("/api/organizations/{org_id}/records/{entity_type}/{entity_id}/comments", status_code=201, response_model=CommentCreatedResponse, summary="Create comment")
def create_comment(
    org_id: UUID,
    entity_type: str,
    entity_id: UUID,
    body: CreateCommentBody,
    auth: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Create comment."""
    if not _validate_entity_type(entity_type):
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": f"Invalid entity type: {entity_type}",
        })

    content = body.content.strip()
    if not content:
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "Comment content is required and cannot be empty",
            "field": "content",
        })

    if body.kind not in ("user", "system"):
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "Invalid comment kind. Must be 'user' or 'system'",
            "field": "kind",
        })

    from app.models import RecordComment

    comment = RecordComment(
        organization_id=org_id,
        entity_type=entity_type,
        entity_id=entity_id,
        author_id=auth.user_id,
        content=content,
        kind=body.kind,
    )

    db.add(comment)
    db.commit()

    logger.info(
        "Discussion comment created: %s on %s/%s by user %s",
        comment.comment_id, entity_type, entity_id, auth.user_id,
    )

    # Notify watchers (non-blocking)
    try:
        from app.services.notification_service import notify_watchers_of_comment

        notify_watchers_of_comment(
            organization_id=org_id,
            entity_type=entity_type,
            entity_id=entity_id,
            comment_author_id=auth.user_id,
            comment_content=content,
        )
    except Exception as e:
        logger.warning("Failed to notify watchers: %s", e)

    return {"comment": _serialize_comment(comment)}


@router.get("/api/organizations/{org_id}/records/{entity_type}/{entity_id}/comments/count", response_model=CommentCountResponse, summary="Get comment count")
def get_comment_count(
    org_id: UUID,
    entity_type: str,
    entity_id: UUID,
    auth: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Get comment count."""
    if not _validate_entity_type(entity_type):
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": f"Invalid entity type: {entity_type}",
        })

    from app.models import RecordComment

    count = (
        db.query(func.count(RecordComment.comment_id))
        .filter(
            RecordComment.organization_id == org_id,
            RecordComment.entity_type == entity_type,
            RecordComment.entity_id == entity_id,
        )
        .scalar()
    )

    return {"count": count}


# =============================================================================
# Watch
# =============================================================================


@router.get("/api/organizations/{org_id}/records/{entity_type}/{entity_id}/watch", response_model=WatchStatusResponse, summary="Get watch status")
def get_watch_status(
    org_id: UUID,
    entity_type: str,
    entity_id: UUID,
    auth: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Get watch status."""
    if not _validate_entity_type(entity_type):
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": f"Invalid entity type: {entity_type}",
        })

    from app.models import RecordWatch

    watch = (
        db.query(RecordWatch)
        .filter(
            RecordWatch.organization_id == org_id,
            RecordWatch.user_id == auth.user_id,
            RecordWatch.entity_type == entity_type,
            RecordWatch.entity_id == entity_id,
        )
        .first()
    )

    return {
        "watching": watch is not None,
        "watch_id": str(watch.watch_id) if watch else None,
    }


@router.post("/api/organizations/{org_id}/records/{entity_type}/{entity_id}/watch", status_code=201, response_model=WatchStatusResponse, summary="Watch record")
def watch_record(
    org_id: UUID,
    entity_type: str,
    entity_id: UUID,
    auth: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Watch record."""
    if not _validate_entity_type(entity_type):
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": f"Invalid entity type: {entity_type}",
        })

    from app.models import RecordWatch

    existing = (
        db.query(RecordWatch)
        .filter(
            RecordWatch.organization_id == org_id,
            RecordWatch.user_id == auth.user_id,
            RecordWatch.entity_type == entity_type,
            RecordWatch.entity_id == entity_id,
        )
        .first()
    )

    if existing:
        return {
            "watch_id": str(existing.watch_id),
            "watching": True,
        }

    watch = RecordWatch(
        organization_id=org_id,
        user_id=auth.user_id,
        entity_type=entity_type,
        entity_id=entity_id,
    )

    db.add(watch)
    db.commit()

    logger.info(
        "Record watch created: user %s watching %s/%s",
        auth.user_id, entity_type, entity_id,
    )

    return {
        "watch_id": str(watch.watch_id),
        "watching": True,
    }


@router.delete("/api/organizations/{org_id}/records/{entity_type}/{entity_id}/watch", response_model=WatchStatusResponse, summary="Unwatch record")
def unwatch_record(
    org_id: UUID,
    entity_type: str,
    entity_id: UUID,
    auth: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Unwatch record."""
    if not _validate_entity_type(entity_type):
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": f"Invalid entity type: {entity_type}",
        })

    from app.models import RecordWatch

    watch = (
        db.query(RecordWatch)
        .filter(
            RecordWatch.organization_id == org_id,
            RecordWatch.user_id == auth.user_id,
            RecordWatch.entity_type == entity_type,
            RecordWatch.entity_id == entity_id,
        )
        .first()
    )

    if not watch:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Watch not found",
        })

    db.delete(watch)
    db.commit()

    logger.info(
        "Record watch removed: user %s unwatching %s/%s",
        auth.user_id, entity_type, entity_id,
    )

    return {"watching": False}


# =============================================================================
# Export
# =============================================================================


@router.get("/api/organizations/{org_id}/records/{entity_type}/{entity_id}/comments/export", response_model=CommentExportResponse, summary="Export comments")
def export_comments(
    org_id: UUID,
    entity_type: str,
    entity_id: UUID,
    auth: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Export comments."""
    if not _validate_entity_type(entity_type):
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": f"Invalid entity type: {entity_type}",
        })

    from app.models import RecordComment

    comments = (
        db.query(RecordComment)
        .filter(
            RecordComment.organization_id == org_id,
            RecordComment.entity_type == entity_type,
            RecordComment.entity_id == entity_id,
        )
        .order_by(RecordComment.created_at.asc())
        .all()
    )

    return {
        "record": {
            "entity_type": entity_type,
            "entity_id": str(entity_id),
            "organization_id": str(org_id),
        },
        "comments": [
            {
                "author_name": c.author.display_name if c.author else "Unknown",
                "author_email": c.author.email if c.author else None,
                "content": c.content,
                "kind": c.kind,
                "created_at": c.created_at.isoformat() if c.created_at else None,
            }
            for c in comments
        ],
        "total_count": len(comments),
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "exported_by": str(auth.user_id),
    }
