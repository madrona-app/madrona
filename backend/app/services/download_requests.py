"""
Media Download Request Service.

Handles the workflow for users requesting high-resolution downloads from lightboxes.
Workflow: submitted → review → approved/denied → fulfilled → (expired)

Usage:
    from app.services.download_requests import DownloadRequestService

    # Create a new request
    request = DownloadRequestService.create_request(
        organization_id=org_id,
        requester_id=user_id,
        collection_id=collection_id,
        media_ids=[media_id1, media_id2],
        purpose='research',
        intended_use='Academic publication',
    )

    # Approve a request
    DownloadRequestService.approve_request(request_id, approver_id, conditions='Credit required')

    # Fulfill a request
    DownloadRequestService.fulfill_request(request_id, fulfiller_id, expires_days=7)
"""

from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import select, func, and_
from sqlalchemy.orm import joinedload, Session

from app.database import current_session
from app.models import (
    User,
    Media,
    MediaCollection,
    MediaCollectionItem,
    MediaDownloadRequest,
    MediaDownloadRequestItem,
)

logger = logging.getLogger(__name__)


# Request purposes that match the check constraint
VALID_PURPOSES = [
    "research",
    "publication",
    "exhibition",
    "commercial",
    "educational",
    "personal",
    "other",
]

# Request statuses that match the check constraint
VALID_STATUSES = [
    "submitted",
    "review",
    "approved",
    "denied",
    "fulfilled",
    "expired",
    "cancelled",
]

# Derivative types that can be requested
VALID_DERIVATIVE_TYPES = [
    "access_master",
    "large",
    "original",
    "watermarked",
]

# Item statuses for partial approval
VALID_ITEM_STATUSES = [
    "pending",
    "approved",
    "denied",
]


class DownloadRequestService:
    """Service for managing media download requests."""

    @classmethod
    def generate_request_number(cls, organization_id: UUID) -> str:
        """
        Generate a unique request number for a new download request.

        Format: DL-YYYYMMDD-NNNN (e.g., DL-20260128-0001)
        """
        today = datetime.now(timezone.utc).strftime("%Y%m%d")
        prefix = f"DL-{today}-"

        # Count existing requests for today
        count = current_session().execute(
            select(func.count(MediaDownloadRequest.request_id))
            .where(MediaDownloadRequest.organization_id == organization_id)
            .where(MediaDownloadRequest.request_number.like(f"{prefix}%"))
        ).scalar_one()

        next_num = count + 1
        return f"{prefix}{next_num:04d}"

    @classmethod
    def create_request(
        cls,
        organization_id: UUID | str,
        requester_id: UUID | str,
        media_ids: list[UUID | str],
        purpose: str,
        intended_use: str,
        collection_id: UUID | str | None = None,
        requester_institution: str | None = None,
        project_description: str | None = None,
        derivative_type_requested: str = "access_master",
    ) -> MediaDownloadRequest:
        """
        Create a new download request.

        Args:
            organization_id: The organization ID
            requester_id: The user making the request
            media_ids: List of media IDs to request
            purpose: Purpose of the request (research, publication, etc.)
            intended_use: Description of intended use
            collection_id: Optional source collection (lightbox)
            requester_institution: Optional institution affiliation
            project_description: Optional project description
            derivative_type_requested: Type of derivative to request

        Returns:
            The created MediaDownloadRequest

        Raises:
            ValueError: If validation fails
        """
        org_uuid = UUID(str(organization_id))
        requester_uuid = UUID(str(requester_id))

        # Validate purpose
        if purpose not in VALID_PURPOSES:
            raise ValueError(f"Invalid purpose: {purpose}. Must be one of: {VALID_PURPOSES}")

        # Validate derivative type
        if derivative_type_requested not in VALID_DERIVATIVE_TYPES:
            raise ValueError(
                f"Invalid derivative type: {derivative_type_requested}. "
                f"Must be one of: {VALID_DERIVATIVE_TYPES}"
            )

        # Get requester info
        requester = current_session().get(User, requester_uuid)
        if not requester:
            raise ValueError(f"Requester not found: {requester_id}")

        # Generate request number
        request_number = cls.generate_request_number(org_uuid)

        # Create request
        request = MediaDownloadRequest(
            organization_id=org_uuid,
            request_number=request_number,
            collection_id=UUID(str(collection_id)) if collection_id else None,
            requester_id=requester_uuid,
            requester_name=requester.display_name or requester.email,
            requester_email=requester.email,
            requester_institution=requester_institution,
            purpose=purpose,
            intended_use=intended_use,
            project_description=project_description,
            derivative_type_requested=derivative_type_requested,
            status="submitted",
        )

        current_session().add(request)
        current_session().flush()

        # Add request items
        for media_id in media_ids:
            item = MediaDownloadRequestItem(
                request_id=request.request_id,
                media_id=UUID(str(media_id)),
                item_status="pending",
            )
            current_session().add(item)

        current_session().flush()

        logger.info(
            f"Created download request {request_number} for {len(media_ids)} items "
            f"by user {requester_uuid}"
        )

        return request

    @classmethod
    def get_request(
        cls,
        request_id: UUID | str,
        organization_id: UUID | str,
        session: Session | None = None,
    ) -> MediaDownloadRequest | None:
        """
        Get a download request by ID.

        Args:
            request_id: The request ID
            organization_id: The organization ID (for security)
            session: Optional DB session (falls back to current_session())

        Returns:
            The request or None if not found
        """
        db = session or current_session()
        request_uuid = UUID(str(request_id))
        org_uuid = UUID(str(organization_id))

        return db.execute(
            select(MediaDownloadRequest)
            .options(
                joinedload(MediaDownloadRequest.items).joinedload(MediaDownloadRequestItem.media),
                joinedload(MediaDownloadRequest.requester),
                joinedload(MediaDownloadRequest.reviewer),
                joinedload(MediaDownloadRequest.approver),
                joinedload(MediaDownloadRequest.fulfiller),
                joinedload(MediaDownloadRequest.collection),
            )
            .where(MediaDownloadRequest.request_id == request_uuid)
            .where(MediaDownloadRequest.organization_id == org_uuid)
        ).unique().scalar_one_or_none()

    @classmethod
    def list_requests(
        cls,
        organization_id: UUID | str,
        status: str | list[str] | None = None,
        requester_id: UUID | str | None = None,
        limit: int = 50,
        offset: int = 0,
        db: Session | None = None,
    ) -> tuple[list[MediaDownloadRequest], int]:
        """
        List download requests for an organization.

        Args:
            organization_id: The organization ID
            status: Optional status filter (single or list)
            requester_id: Optional filter by requester
            limit: Maximum number of results
            offset: Offset for pagination

        Returns:
            Tuple of (requests list, total count)
        """
        org_uuid = UUID(str(organization_id))

        # Build query
        query = (
            select(MediaDownloadRequest)
            .options(
                joinedload(MediaDownloadRequest.items),
                joinedload(MediaDownloadRequest.requester),
            )
            .where(MediaDownloadRequest.organization_id == org_uuid)
            .order_by(MediaDownloadRequest.created_at.desc())
        )

        count_query = (
            select(func.count(MediaDownloadRequest.request_id))
            .where(MediaDownloadRequest.organization_id == org_uuid)
        )

        # Apply filters
        if status:
            if isinstance(status, str):
                status = [status]
            query = query.where(MediaDownloadRequest.status.in_(status))
            count_query = count_query.where(MediaDownloadRequest.status.in_(status))

        if requester_id:
            requester_uuid = UUID(str(requester_id))
            query = query.where(MediaDownloadRequest.requester_id == requester_uuid)
            count_query = count_query.where(MediaDownloadRequest.requester_id == requester_uuid)

        # Get total count
        session = db or current_session()
        total = session.execute(count_query).scalar_one()

        # Get paginated results
        requests = session.execute(
            query.limit(limit).offset(offset)
        ).scalars().unique().all()

        return list(requests), total

    @classmethod
    def start_review(
        cls,
        request_id: UUID | str,
        organization_id: UUID | str,
        reviewer_id: UUID | str,
        note: str | None = None,
    ) -> MediaDownloadRequest:
        """
        Move a request to review status.

        Args:
            request_id: The request ID
            organization_id: The organization ID
            reviewer_id: The user starting the review
            note: Optional review note

        Returns:
            The updated request

        Raises:
            ValueError: If request not found or in invalid state
        """
        request = cls.get_request(request_id, organization_id)
        if not request:
            raise ValueError(f"Request not found: {request_id}")

        if request.status not in ("submitted",):
            raise ValueError(f"Cannot start review: request is in '{request.status}' status")

        request.status = "review"
        request.reviewed_by_id = UUID(str(reviewer_id))
        request.review_date = datetime.now(timezone.utc)
        request.review_note = note

        current_session().flush()

        logger.info(f"Request {request.request_number} moved to review by {reviewer_id}")

        return request

    @classmethod
    def approve_request(
        cls,
        request_id: UUID | str,
        organization_id: UUID | str,
        approver_id: UUID | str,
        conditions: str | None = None,
        item_approvals: dict[str, bool] | None = None,
    ) -> MediaDownloadRequest:
        """
        Approve a download request.

        Args:
            request_id: The request ID
            organization_id: The organization ID
            approver_id: The user approving
            conditions: Optional approval conditions
            item_approvals: Optional dict mapping item_id to approval status
                           for partial approvals

        Returns:
            The updated request

        Raises:
            ValueError: If request not found or in invalid state
        """
        request = cls.get_request(request_id, organization_id)
        if not request:
            raise ValueError(f"Request not found: {request_id}")

        if request.status not in ("submitted", "review"):
            raise ValueError(f"Cannot approve: request is in '{request.status}' status")

        approver_uuid = UUID(str(approver_id))

        # Handle partial approvals
        if item_approvals:
            for item in request.items:
                item_id_str = str(item.item_id)
                if item_id_str in item_approvals:
                    item.item_status = "approved" if item_approvals[item_id_str] else "denied"
        else:
            # Approve all items
            for item in request.items:
                item.item_status = "approved"

        # Check if any items were approved
        any_approved = any(item.item_status == "approved" for item in request.items)
        if not any_approved:
            raise ValueError("Cannot approve request: no items would be approved")

        request.status = "approved"
        request.approved_by_id = approver_uuid
        request.approval_date = datetime.now(timezone.utc)
        request.approval_conditions = conditions

        # If reviewer wasn't set, set it now
        if not request.reviewed_by_id:
            request.reviewed_by_id = approver_uuid
            request.review_date = datetime.now(timezone.utc)

        current_session().flush()

        logger.info(f"Request {request.request_number} approved by {approver_id}")

        return request

    @classmethod
    def deny_request(
        cls,
        request_id: UUID | str,
        organization_id: UUID | str,
        denier_id: UUID | str,
        reason: str,
    ) -> MediaDownloadRequest:
        """
        Deny a download request.

        Args:
            request_id: The request ID
            organization_id: The organization ID
            denier_id: The user denying the request
            reason: Reason for denial

        Returns:
            The updated request

        Raises:
            ValueError: If request not found or in invalid state
        """
        request = cls.get_request(request_id, organization_id)
        if not request:
            raise ValueError(f"Request not found: {request_id}")

        if request.status not in ("submitted", "review"):
            raise ValueError(f"Cannot deny: request is in '{request.status}' status")

        denier_uuid = UUID(str(denier_id))

        # Deny all items
        for item in request.items:
            item.item_status = "denied"

        request.status = "denied"
        request.denial_reason = reason

        # If reviewer wasn't set, set it now
        if not request.reviewed_by_id:
            request.reviewed_by_id = denier_uuid
            request.review_date = datetime.now(timezone.utc)

        current_session().flush()

        logger.info(f"Request {request.request_number} denied by {denier_id}")

        return request

    @classmethod
    def fulfill_request(
        cls,
        request_id: UUID | str,
        organization_id: UUID | str,
        fulfiller_id: UUID | str,
        expires_days: int = 7,
        max_downloads: int | None = None,
        note: str | None = None,
    ) -> MediaDownloadRequest:
        """
        Fulfill an approved request by generating a download token.

        Args:
            request_id: The request ID
            organization_id: The organization ID
            fulfiller_id: The user fulfilling the request
            expires_days: Number of days until token expires
            max_downloads: Optional limit on download count
            note: Optional fulfillment note

        Returns:
            The updated request with download token

        Raises:
            ValueError: If request not found or in invalid state
        """
        request = cls.get_request(request_id, organization_id)
        if not request:
            raise ValueError(f"Request not found: {request_id}")

        if request.status not in ("approved",):
            raise ValueError(f"Cannot fulfill: request is in '{request.status}' status")

        fulfiller_uuid = UUID(str(fulfiller_id))

        # Generate secure download token
        token = secrets.token_urlsafe(48)

        request.status = "fulfilled"
        request.fulfilled_at = datetime.now(timezone.utc)
        request.fulfilled_by_id = fulfiller_uuid
        request.fulfillment_note = note
        request.download_token = token
        request.download_expires_at = datetime.now(timezone.utc) + timedelta(days=expires_days)
        request.max_downloads = max_downloads

        current_session().flush()

        logger.info(
            f"Request {request.request_number} fulfilled by {fulfiller_id}, "
            f"expires in {expires_days} days"
        )

        return request

    @classmethod
    def get_download_links(
        cls,
        request_id: UUID | str,
        organization_id: UUID | str,
        token: str,
    ) -> list[dict[str, Any]] | None:
        """
        Get download links for a fulfilled request.

        Args:
            request_id: The request ID
            organization_id: The organization ID
            token: The download token

        Returns:
            List of download info dicts or None if token invalid

        Raises:
            ValueError: If request not found or token expired
        """
        request = cls.get_request(request_id, organization_id)
        if not request:
            raise ValueError(f"Request not found: {request_id}")

        # Validate token
        if request.download_token != token:
            return None

        # Check expiration
        if request.download_expires_at and request.download_expires_at < datetime.now(timezone.utc):
            # Mark as expired
            request.status = "expired"
            current_session().flush()
            raise ValueError("Download token has expired")

        # Check download count
        if request.max_downloads and request.download_count >= request.max_downloads:
            raise ValueError("Maximum download count exceeded")

        # Build download info for approved items
        downloads = []
        for item in request.items:
            if item.item_status != "approved":
                continue

            media = item.media
            if not media:
                continue

            downloads.append({
                "item_id": str(item.item_id),
                "media_id": str(media.media_id),
                "filename": media.filename,
                "mime_type": media.mime_type,
                "file_size": media.file_size,
                "s3_key": media.s3_key,
                "downloaded": item.downloaded,
            })

        return downloads

    @classmethod
    def record_download(
        cls,
        request_id: UUID | str,
        organization_id: UUID | str,
        item_id: UUID | str,
    ) -> bool:
        """
        Record that an item was downloaded.

        Args:
            request_id: The request ID
            organization_id: The organization ID
            item_id: The item ID that was downloaded

        Returns:
            True if recorded successfully
        """
        request = cls.get_request(request_id, organization_id)
        if not request:
            return False

        item_uuid = UUID(str(item_id))

        for item in request.items:
            if item.item_id == item_uuid:
                if not item.downloaded:
                    item.downloaded = True
                    item.downloaded_at = datetime.now(timezone.utc)
                    request.download_count += 1
                    current_session().flush()
                return True

        return False

    @classmethod
    def cancel_request(
        cls,
        request_id: UUID | str,
        organization_id: UUID | str,
        user_id: UUID | str,
    ) -> MediaDownloadRequest:
        """
        Cancel a download request.

        Args:
            request_id: The request ID
            organization_id: The organization ID
            user_id: The user cancelling (must be requester or have review permission)

        Returns:
            The updated request

        Raises:
            ValueError: If request not found or cannot be cancelled
        """
        request = cls.get_request(request_id, organization_id)
        if not request:
            raise ValueError(f"Request not found: {request_id}")

        # Can only cancel submitted or review requests
        if request.status not in ("submitted", "review"):
            raise ValueError(f"Cannot cancel: request is in '{request.status}' status")

        request.status = "cancelled"
        current_session().flush()

        logger.info(f"Request {request.request_number} cancelled by {user_id}")

        return request

    @classmethod
    def check_and_expire_requests(cls) -> int:
        """
        Check for fulfilled requests with expired tokens and mark them as expired.

        Returns:
            Number of requests marked as expired
        """
        now = datetime.now(timezone.utc)

        expired_requests = current_session().execute(
            select(MediaDownloadRequest)
            .where(MediaDownloadRequest.status == "fulfilled")
            .where(MediaDownloadRequest.download_expires_at < now)
        ).scalars().all()

        for request in expired_requests:
            request.status = "expired"

        current_session().flush()

        if expired_requests:
            logger.info(f"Marked {len(expired_requests)} requests as expired")

        return len(expired_requests)
