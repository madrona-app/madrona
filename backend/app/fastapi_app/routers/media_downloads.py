"""
Media Download Requests API endpoints (FastAPI).

Phase 9d — 10 routes:
  - List download requests (GET)
  - List my download requests (GET /my)
  - Create download request (POST)
  - Get download request (GET /{request_id})
  - Start review (POST /{request_id}/review)
  - Approve (POST /{request_id}/approve)
  - Deny (POST /{request_id}/deny)
  - Fulfill (POST /{request_id}/fulfill)
  - Get download links (GET /{request_id}/downloads)
  - Record download (POST /{request_id}/downloads/{item_id}/record)
  - Cancel (POST /{request_id}/cancel)

Migrated from app/api/media.py.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import (
    AuthContext,
    check_permission_for_session,
    require_permission,
)
from app.models import MediaDownloadRequest, MediaDownloadRequestItem
from app.permissions import Permission
from app.fastapi_app.schemas.common import SuccessResponse
from app.fastapi_app.schemas.media_downloads import (
    DownloadLinksResponse,
    DownloadRequestListResponse,
    DownloadRequestOut,
)
from app.services.download_requests import DownloadRequestService
from app.services.uploads import get_org_media_url

logger = logging.getLogger(__name__)

router = APIRouter(tags=["media-downloads"])


# ============================================================================
# SERIALIZERS
# ============================================================================


def _serialize_download_request(req: MediaDownloadRequest, include_items: bool = True) -> dict:
    """Serialize a MediaDownloadRequest to JSON."""
    result = {
        "request_id": str(req.request_id),
        "organization_id": str(req.organization_id),
        "request_number": req.request_number,
        "collection_id": str(req.collection_id) if req.collection_id else None,
        "requester_id": str(req.requester_id),
        "requester_name": req.requester_name,
        "requester_email": req.requester_email,
        "requester_institution": req.requester_institution,
        "purpose": req.purpose,
        "intended_use": req.intended_use,
        "project_description": req.project_description,
        "derivative_type_requested": req.derivative_type_requested,
        "status": req.status,
        "reviewed_by_id": str(req.reviewed_by_id) if req.reviewed_by_id else None,
        "review_date": req.review_date.isoformat() if req.review_date else None,
        "review_note": req.review_note,
        "approved_by_id": str(req.approved_by_id) if req.approved_by_id else None,
        "approval_date": req.approval_date.isoformat() if req.approval_date else None,
        "approval_conditions": req.approval_conditions,
        "denial_reason": req.denial_reason,
        "fulfilled_at": req.fulfilled_at.isoformat() if req.fulfilled_at else None,
        "fulfilled_by_id": str(req.fulfilled_by_id) if req.fulfilled_by_id else None,
        "fulfillment_note": req.fulfillment_note,
        "download_expires_at": req.download_expires_at.isoformat() if req.download_expires_at else None,
        "download_count": req.download_count,
        "max_downloads": req.max_downloads,
        "download_token": req.download_token,
        "created_at": req.created_at.isoformat() if req.created_at else None,
        "updated_at": req.updated_at.isoformat() if req.updated_at else None,
    }

    # Add requester user info if available
    if hasattr(req, "requester") and req.requester:
        result["requester"] = {
            "user_id": str(req.requester.user_id),
            "email": req.requester.email,
            "display_name": req.requester.display_name,
        }

    # Add collection info if available
    if hasattr(req, "collection") and req.collection:
        result["collection"] = {
            "collection_id": str(req.collection.collection_id),
            "name": req.collection.name,
        }

    # Always include item_count if items are loaded
    if hasattr(req, "items") and req.items is not None:
        result["item_count"] = len(req.items)
        if include_items:
            result["items"] = [_serialize_download_request_item(item) for item in req.items]
    else:
        result["item_count"] = 0

    return result


def _serialize_download_request_item(item: MediaDownloadRequestItem) -> dict:
    """Serialize a MediaDownloadRequestItem to JSON."""
    result = {
        "item_id": str(item.item_id),
        "request_id": str(item.request_id),
        "media_id": str(item.media_id),
        "item_status": item.item_status,
        "item_note": item.item_note,
        "downloaded": item.downloaded,
        "downloaded_at": item.downloaded_at.isoformat() if item.downloaded_at else None,
    }

    # Add media info if available
    if hasattr(item, "media") and item.media:
        media = item.media
        result["media"] = {
            "media_id": str(media.media_id),
            "filename": media.filename,
            "title": media.title,
            "media_type": media.media_type,
            "mime_type": media.mime_type,
            "file_size": media.file_size,
        }

    return result


# ============================================================================
# DOWNLOAD REQUEST ENDPOINTS
# ============================================================================


# Static routes BEFORE parameterized {request_id} routes


@router.get("/api/organizations/{org_id}/media/download-requests/my", response_model=DownloadRequestListResponse, summary="List my download requests")
def list_my_download_requests(
    org_id: UUID,
    status: str = Query(None),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.DOWNLOAD_REQUESTS_VIEW)),
    db: Session = Depends(get_db),
):
    """List the current user's download requests."""
    status_list = status.split(",") if status else None

    requests_list, total = DownloadRequestService.list_requests(
        organization_id=org_id,
        status=status_list,
        requester_id=auth.user_id,
        limit=limit,
        offset=offset,
        db=db,
    )

    return {
        "items": [_serialize_download_request(r, include_items=False) for r in requests_list],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/api/organizations/{org_id}/media/download-requests", response_model=DownloadRequestListResponse, summary="List download requests")
def list_download_requests(
    org_id: UUID,
    status: str = Query(None),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.DOWNLOAD_REQUESTS_VIEW)),
    db: Session = Depends(get_db),
):
    """
    List download requests.

    Users with review permission see all requests.
    Other users only see their own requests.
    """
    can_review = check_permission_for_session(
        db, auth.user_id, org_id, Permission.DOWNLOAD_REQUESTS_REVIEW,
    )

    status_list = status.split(",") if status else None

    requester_id = None
    if not can_review:
        requester_id = auth.user_id

    requests_list, total = DownloadRequestService.list_requests(
        organization_id=org_id,
        status=status_list,
        requester_id=requester_id,
        limit=limit,
        offset=offset,
        db=db,
    )

    return {
        "items": [_serialize_download_request(r, include_items=False) for r in requests_list],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("/api/organizations/{org_id}/media/download-requests", response_model=DownloadRequestOut, status_code=201, summary="Create download request")
def create_download_request(
    org_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.DOWNLOAD_REQUESTS_CREATE)),
    db: Session = Depends(get_db),
):
    """Create a new download request."""
    # Validate required fields
    required = ["media_ids", "purpose", "intended_use"]
    for field in required:
        if not body.get(field):
            raise HTTPException(status_code=400, detail=f"{field} is required")

    media_ids = body["media_ids"]
    if not isinstance(media_ids, list) or len(media_ids) == 0:
        raise HTTPException(status_code=400, detail="media_ids must be a non-empty list")

    try:
        download_request = DownloadRequestService.create_request(
            organization_id=org_id,
            requester_id=auth.user_id,
            media_ids=media_ids,
            purpose=body["purpose"],
            intended_use=body["intended_use"],
            collection_id=body.get("collection_id"),
            requester_institution=body.get("requester_institution"),
            project_description=body.get("project_description"),
            derivative_type_requested=body.get("derivative_type_requested", "access_master"),
        )

        db.commit()

        # Reload to ensure items are serialized correctly
        download_request = DownloadRequestService.get_request(
            download_request.request_id, org_id, session=db,
        )

        return _serialize_download_request(download_request)
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/api/organizations/{org_id}/media/download-requests/{request_id}", response_model=DownloadRequestOut, summary="Get download request")
def get_download_request(
    org_id: UUID,
    request_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.DOWNLOAD_REQUESTS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get a download request by ID."""
    download_request = DownloadRequestService.get_request(request_id, org_id, session=db)
    if not download_request:
        raise HTTPException(status_code=404, detail="Request not found")

    # Check access - users can see their own requests or need review permission
    can_review = check_permission_for_session(
        db, auth.user_id, org_id, Permission.DOWNLOAD_REQUESTS_REVIEW,
    )

    if str(download_request.requester_id) != str(auth.user_id) and not can_review:
        raise HTTPException(status_code=403, detail="Access denied")

    return _serialize_download_request(download_request)


@router.post("/api/organizations/{org_id}/media/download-requests/{request_id}/review", response_model=DownloadRequestOut, summary="Start download request review")
def start_download_request_review(
    org_id: UUID,
    request_id: UUID,
    body: dict | None = None,
    auth: AuthContext = Depends(require_permission(Permission.DOWNLOAD_REQUESTS_REVIEW)),
    db: Session = Depends(get_db),
):
    """Start review of a download request."""
    body = body or {}
    try:
        download_request = DownloadRequestService.start_review(
            request_id=request_id,
            organization_id=org_id,
            reviewer_id=auth.user_id,
            note=body.get("note"),
        )

        db.commit()
        return _serialize_download_request(download_request)
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/organizations/{org_id}/media/download-requests/{request_id}/approve", response_model=DownloadRequestOut, summary="Approve download request")
def approve_download_request(
    org_id: UUID,
    request_id: UUID,
    body: dict | None = None,
    auth: AuthContext = Depends(require_permission(Permission.DOWNLOAD_REQUESTS_REVIEW)),
    db: Session = Depends(get_db),
):
    """Approve a download request."""
    body = body or {}
    try:
        download_request = DownloadRequestService.approve_request(
            request_id=request_id,
            organization_id=org_id,
            approver_id=auth.user_id,
            conditions=body.get("conditions"),
            item_approvals=body.get("item_approvals"),
        )

        db.commit()
        return _serialize_download_request(download_request)
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/organizations/{org_id}/media/download-requests/{request_id}/deny", response_model=DownloadRequestOut, summary="Deny download request")
def deny_download_request(
    org_id: UUID,
    request_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.DOWNLOAD_REQUESTS_REVIEW)),
    db: Session = Depends(get_db),
):
    """Deny a download request."""
    reason = body.get("reason")
    if not reason:
        raise HTTPException(status_code=400, detail="reason is required")

    try:
        download_request = DownloadRequestService.deny_request(
            request_id=request_id,
            organization_id=org_id,
            denier_id=auth.user_id,
            reason=reason,
        )

        db.commit()
        return _serialize_download_request(download_request)
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/organizations/{org_id}/media/download-requests/{request_id}/fulfill", response_model=DownloadRequestOut, summary="Fulfill download request")
def fulfill_download_request(
    org_id: UUID,
    request_id: UUID,
    body: dict | None = None,
    auth: AuthContext = Depends(require_permission(Permission.DOWNLOAD_REQUESTS_FULFILL)),
    db: Session = Depends(get_db),
):
    """Fulfill an approved download request by generating a download token."""
    body = body or {}
    try:
        download_request = DownloadRequestService.fulfill_request(
            request_id=request_id,
            organization_id=org_id,
            fulfiller_id=auth.user_id,
            expires_days=body.get("expires_days", 7),
            max_downloads=body.get("max_downloads"),
            note=body.get("note"),
        )

        db.commit()

        # Include download token in response
        result = _serialize_download_request(download_request)
        result["download_token"] = download_request.download_token

        return result
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/api/organizations/{org_id}/media/download-requests/{request_id}/downloads", response_model=DownloadLinksResponse, summary="Get download request links")
def get_download_request_links(
    org_id: UUID,
    request_id: UUID,
    request: Request,
    token: str = Query(None),
    auth: AuthContext = Depends(require_permission(Permission.DOWNLOAD_REQUESTS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get download links for a fulfilled request."""
    # Get token from query params or header
    download_token = token or request.headers.get("X-Download-Token")
    if not download_token:
        raise HTTPException(status_code=400, detail="Download token required")

    download_request = DownloadRequestService.get_request(request_id, org_id, session=db)
    if not download_request:
        raise HTTPException(status_code=404, detail="Request not found")

    # Verify the requester or staff can access
    can_fulfill = check_permission_for_session(
        db, auth.user_id, org_id, Permission.DOWNLOAD_REQUESTS_FULFILL,
    )

    if str(download_request.requester_id) != str(auth.user_id) and not can_fulfill:
        raise HTTPException(status_code=403, detail="Access denied")

    try:
        downloads = DownloadRequestService.get_download_links(
            request_id=request_id,
            organization_id=org_id,
            token=download_token,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if downloads is None:
        raise HTTPException(status_code=401, detail="Invalid download token")

    # Generate signed URLs for each item
    for item in downloads:
        try:
            item["download_url"] = get_org_media_url(
                item["s3_key"],
                organization_id=str(org_id),
                db_session=db,
                expiry_seconds=3600,  # 1 hour
            )
        except Exception as e:
            logger.warning(f"Could not generate download URL for {item['media_id']}: {e}")
            item["download_url"] = None

    return {
        "request_id": str(request_id),
        "downloads": downloads,
        "total": len(downloads),
    }


@router.post(
    "/api/organizations/{org_id}/media/download-requests/{request_id}/downloads/{item_id}/record",
    response_model=SuccessResponse, summary="Record download request download")
def record_download_request_download(
    org_id: UUID,
    request_id: UUID,
    item_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.DOWNLOAD_REQUESTS_VIEW)),
    db: Session = Depends(get_db),
):
    """Record that an item was downloaded."""
    success = DownloadRequestService.record_download(
        request_id=request_id,
        organization_id=org_id,
        item_id=item_id,
    )

    if not success:
        raise HTTPException(status_code=404, detail="Item not found")

    db.commit()
    return {"success": True}


@router.post("/api/organizations/{org_id}/media/download-requests/{request_id}/cancel", response_model=DownloadRequestOut, summary="Cancel download request")
def cancel_download_request(
    org_id: UUID,
    request_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.DOWNLOAD_REQUESTS_VIEW)),
    db: Session = Depends(get_db),
):
    """Cancel a download request."""
    download_request = DownloadRequestService.get_request(request_id, org_id, session=db)
    if not download_request:
        raise HTTPException(status_code=404, detail="Request not found")

    # Check permission - requester can cancel their own, or reviewer can cancel any
    can_review = check_permission_for_session(
        db, auth.user_id, org_id, Permission.DOWNLOAD_REQUESTS_REVIEW,
    )

    if str(download_request.requester_id) != str(auth.user_id) and not can_review:
        raise HTTPException(status_code=403, detail="Access denied")

    try:
        download_request = DownloadRequestService.cancel_request(
            request_id=request_id,
            organization_id=org_id,
            user_id=auth.user_id,
        )

        db.commit()
        return _serialize_download_request(download_request)
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
