"""
Media Collections & Metadata Templates API endpoints (FastAPI).

Phase 9a — 23 routes:
  - Media Collections CRUD (5 routes)
  - Collection Items (3 routes)
  - Collection Sharing (3 routes)
  - Public Sharing (2 routes)
  - Consent Clearance (2 routes)
  - Public Collection View (1 route, unauthenticated)
  - Metadata Templates (6 routes)

Migrated from app/api/media.py.
"""

import logging
import secrets
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.models import (
    Media,
    MediaCollection,
    MediaCollectionItem,
    MediaCollectionShare,
    MediaCollectionShareAccess,
    MediaConsent,
    MetadataTemplate,
)
from app.services.auth_utils import hash_password, verify_password
from app.services.media_field_validation import validate_template_fields

# Allowed values for public_share_download_level.
_SHARE_DOWNLOAD_LEVELS = {"none", "derivatives", "originals"}
from app.fastapi_app.schemas.common import SuccessResponse
from app.fastapi_app.schemas.media_collections import (
    CollectionDeletedResponse,
    CollectionItemCreatedResponse,
    CollectionItemListResponse,
    CollectionItemRemovedResponse,
    CollectionShareListResponse,
    CollectionShareOut,
    ConsentClearanceResponse,
    ConsentClearedResponse,
    MediaCollectionListResponse,
    MediaCollectionOut,
    MetadataTemplateCreatedResponse,
    MetadataTemplateDeletedResponse,
    MetadataTemplateListResponse,
    MetadataTemplateOut,
    MetadataTemplateSetDefaultResponse,
    PublicCollectionResponse,
    PublicSharingEnabledResponse,
    ShareRemovedResponse,
)
from app.permissions import Permission
from app.services.uploads import get_org_media_url

logger = logging.getLogger(__name__)

router = APIRouter(tags=["media-collections"])


# ============================================================================
# SERIALIZERS
# ============================================================================


def _serialize_collection(
    collection: MediaCollection,
    db: Session,
    include_cover_url: bool = True,
) -> dict:
    result = {
        "collection_id": str(collection.collection_id),
        "organization_id": str(collection.organization_id),
        "name": collection.name,
        "description": collection.description,
        "cover_media_id": str(collection.cover_media_id) if collection.cover_media_id else None,
        "visibility": collection.visibility,
        "public_share_token": collection.public_share_token,
        "public_share_enabled": collection.public_share_enabled,
        "public_share_expires_at": collection.public_share_expires_at.isoformat() if collection.public_share_expires_at else None,
        "public_share_has_password": bool(collection.public_share_password_hash),
        "public_share_download_level": collection.public_share_download_level,
        "consent_clearance_required": collection.consent_clearance_required,
        "consent_cleared_at": collection.consent_cleared_at.isoformat() if collection.consent_cleared_at else None,
        "item_count": collection.item_count,
        "created_by": str(collection.created_by) if collection.created_by else None,
        "created_at": collection.created_at.isoformat() if collection.created_at else None,
        "updated_at": collection.updated_at.isoformat() if collection.updated_at else None,
    }

    if include_cover_url and collection.cover_media_id:
        try:
            cover_media = db.query(Media).filter(
                Media.media_id == collection.cover_media_id
            ).first()
            if cover_media and cover_media.thumbnail_s3_key:
                result["cover_url"] = get_org_media_url(
                    cover_media.thumbnail_s3_key,
                    organization_id=str(collection.organization_id),
                    db_session=db,
                    expiry_seconds=3600,
                )
        except Exception as e:
            logger.warning("Failed to get cover URL for collection %s: %s", collection.collection_id, e)

    return result


def _serialize_collection_item(item: MediaCollectionItem, db: Session, include_media: bool = True) -> dict:
    result = {
        "collection_id": str(item.collection_id),
        "media_id": str(item.media_id),
        "sort_order": item.sort_order,
        "notes": item.notes,
        "added_at": item.added_at.isoformat() if item.added_at else None,
        "added_by": str(item.added_by) if item.added_by else None,
    }

    if include_media and item.media:
        media = item.media
        result["media"] = {
            "media_id": str(media.media_id),
            "filename": media.filename,
            "title": media.title,
            "media_type": media.media_type,
            "mime_type": media.mime_type,
            "width": media.width,
            "height": media.height,
            "thumbnail_url": get_org_media_url(
                media.thumbnail_s3_key,
                organization_id=str(media.organization_id),
                db_session=db,
                expiry_seconds=3600,
            ) if media.thumbnail_s3_key else None,
        }

    return result


def _serialize_share(share: MediaCollectionShare) -> dict:
    if share.user_id:
        principal_type = "user"
        principal_id = str(share.user_id)
        principal_name = None
        user_email = None
        if share.user:
            principal_name = share.user.display_name
            user_email = share.user.email
    elif share.role_id:
        principal_type = "role"
        principal_id = str(share.role_id)
        principal_name = share.shared_role.display_name if share.shared_role else None
        user_email = None
    else:
        principal_type = "unknown"
        principal_id = None
        principal_name = None
        user_email = None

    return {
        "share_id": str(share.share_id),
        "collection_id": str(share.collection_id),
        "user_id": str(share.user_id) if share.user_id else None,
        "user_name": principal_name if share.user_id else None,
        "user_email": user_email,
        "principal_type": principal_type,
        "principal_id": principal_id,
        "principal_name": principal_name,
        "role": share.role,
        "shared_by": str(share.shared_by) if share.shared_by else None,
        "shared_at": share.shared_at.isoformat() if share.shared_at else None,
    }


def _serialize_metadata_template(t: MetadataTemplate) -> dict:
    return {
        "template_id": str(t.template_id),
        "name": t.name,
        "description": t.description,
        "template_fields": t.template_fields or {},
        "is_default": t.is_default,
        "is_active": t.is_active,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "created_by": str(t.created_by) if t.created_by else None,
        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
        "updated_by": str(t.updated_by) if t.updated_by else None,
    }


# ============================================================================
# HELPERS
# ============================================================================


def _user_can_access_collection(
    collection: MediaCollection,
    user_id: UUID,
    db: Session,
    required_role: str = "viewer",
) -> bool:
    if collection.created_by == user_id:
        return True
    if collection.visibility == "org":
        return True

    share = db.query(MediaCollectionShare).filter(
        MediaCollectionShare.collection_id == collection.collection_id,
        MediaCollectionShare.user_id == user_id,
    ).first()

    if not share:
        return False
    if required_role == "editor":
        return share.role == "editor"
    return True


# ============================================================================
# COLLECTION CRUD
# ============================================================================


@router.get("/api/organizations/{org_id}/media-collections", response_model=MediaCollectionListResponse, summary="List collections")
def list_collections(
    org_id: UUID,
    visibility: str | None = Query(None),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """List collections."""
    query = db.query(MediaCollection).filter(
        MediaCollection.organization_id == org_id,
    )

    # Filter to accessible collections
    shared_ids_query = db.query(MediaCollectionShare.collection_id).filter(
        MediaCollectionShare.user_id == auth.user_id,
    )
    query = query.filter(
        or_(
            MediaCollection.created_by == auth.user_id,
            MediaCollection.collection_id.in_(shared_ids_query),
            MediaCollection.visibility == "org",
        )
    )

    if visibility:
        query = query.filter(MediaCollection.visibility == visibility)

    total = query.count()
    collections = query.order_by(
        MediaCollection.updated_at.desc(),
    ).offset(offset).limit(limit).all()

    return {
        "items": [_serialize_collection(c, db) for c in collections],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("/api/organizations/{org_id}/media-collections", response_model=MediaCollectionOut, status_code=201, summary="Create collection")
def create_collection(
    org_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Create collection."""
    if not body.get("name"):
        raise HTTPException(status_code=400, detail="name is required")

    collection = MediaCollection(
        organization_id=org_id,
        name=body["name"],
        description=body.get("description"),
        visibility=body.get("visibility", "private"),
        consent_clearance_required=body.get("consent_clearance_required", True),
        created_by=auth.user_id,
    )

    db.add(collection)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Collection with this name already exists")

    db.refresh(collection)
    return _serialize_collection(collection, db)


@router.get("/api/organizations/{org_id}/media-collections/{collection_id}", response_model=MediaCollectionOut, summary="Get collection")
def get_collection(
    org_id: UUID,
    collection_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """Get collection."""
    collection = db.query(MediaCollection).filter(
        MediaCollection.collection_id == collection_id,
        MediaCollection.organization_id == org_id,
    ).first()

    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")

    if not _user_can_access_collection(collection, auth.user_id, db):
        raise HTTPException(status_code=403, detail="Access denied")

    return _serialize_collection(collection, db)


@router.patch("/api/organizations/{org_id}/media-collections/{collection_id}", response_model=MediaCollectionOut, summary="Update collection")
def update_collection(
    org_id: UUID,
    collection_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Update collection."""
    collection = db.query(MediaCollection).filter(
        MediaCollection.collection_id == collection_id,
        MediaCollection.organization_id == org_id,
    ).first()

    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")

    if not _user_can_access_collection(collection, auth.user_id, db, required_role="editor"):
        raise HTTPException(status_code=403, detail="Access denied")

    if "name" in body:
        collection.name = body["name"]
    if "description" in body:
        collection.description = body["description"]
    if "visibility" in body:
        collection.visibility = body["visibility"]
    if "cover_media_id" in body:
        collection.cover_media_id = UUID(body["cover_media_id"]) if body["cover_media_id"] else None
    if "consent_clearance_required" in body:
        collection.consent_clearance_required = body["consent_clearance_required"]

    collection.updated_at = datetime.now(timezone.utc)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Collection with this name already exists")

    db.refresh(collection)
    return _serialize_collection(collection, db)


@router.delete("/api/organizations/{org_id}/media-collections/{collection_id}", response_model=CollectionDeletedResponse, summary="Delete collection")
def delete_collection(
    org_id: UUID,
    collection_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete collection."""
    collection = db.query(MediaCollection).filter(
        MediaCollection.collection_id == collection_id,
        MediaCollection.organization_id == org_id,
    ).first()

    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")

    if collection.created_by != auth.user_id:
        raise HTTPException(status_code=403, detail="Only the owner can delete this collection")

    db.delete(collection)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Cannot delete collection with existing references")

    return {"success": True, "collection_id": str(collection_id)}


# ============================================================================
# COLLECTION ITEMS
# ============================================================================


@router.get("/api/organizations/{org_id}/media-collections/{collection_id}/items", response_model=CollectionItemListResponse, summary="List collection items")
def list_collection_items(
    org_id: UUID,
    collection_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """List collection items."""
    collection = db.query(MediaCollection).filter(
        MediaCollection.collection_id == collection_id,
        MediaCollection.organization_id == org_id,
    ).first()

    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")

    if not _user_can_access_collection(collection, auth.user_id, db):
        raise HTTPException(status_code=403, detail="Access denied")

    items = db.query(MediaCollectionItem).options(
        joinedload(MediaCollectionItem.media),
    ).filter(
        MediaCollectionItem.collection_id == collection_id,
    ).order_by(MediaCollectionItem.sort_order).all()

    return {
        "items": [_serialize_collection_item(item, db) for item in items],
        "total": len(items),
    }


@router.post("/api/organizations/{org_id}/media-collections/{collection_id}/items", response_model=CollectionItemCreatedResponse, status_code=201, summary="Add collection item")
def add_collection_item(
    org_id: UUID,
    collection_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Add collection item."""
    collection = db.query(MediaCollection).filter(
        MediaCollection.collection_id == collection_id,
        MediaCollection.organization_id == org_id,
    ).first()

    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")

    if not _user_can_access_collection(collection, auth.user_id, db, required_role="editor"):
        raise HTTPException(status_code=403, detail="Access denied")

    if not body.get("media_id"):
        raise HTTPException(status_code=400, detail="media_id is required")

    media_uuid = UUID(body["media_id"])

    media = db.query(Media).filter(
        Media.media_id == media_uuid,
        Media.organization_id == org_id,
    ).first()
    if not media:
        raise HTTPException(status_code=404, detail="Media not found")

    existing = db.query(MediaCollectionItem).filter(
        MediaCollectionItem.collection_id == collection_id,
        MediaCollectionItem.media_id == media_uuid,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Media is already in this collection")

    max_order = db.query(func.max(MediaCollectionItem.sort_order)).filter(
        MediaCollectionItem.collection_id == collection_id,
    ).scalar() or 0

    item = MediaCollectionItem(
        collection_id=collection_id,
        media_id=media_uuid,
        sort_order=body.get("sort_order", max_order + 1),
        notes=body.get("notes"),
        added_by=auth.user_id,
    )

    db.add(item)
    db.flush()

    collection.item_count = db.query(MediaCollectionItem).filter(
        MediaCollectionItem.collection_id == collection_id,
    ).count()
    collection.updated_at = datetime.now(timezone.utc)

    if not collection.cover_media_id:
        collection.cover_media_id = media_uuid

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Media item already exists in collection")

    return {
        "collection_id": str(collection_id),
        "media_id": body["media_id"],
        "sort_order": item.sort_order,
    }


@router.delete("/api/organizations/{org_id}/media-collections/{collection_id}/items/{media_id}", response_model=CollectionItemRemovedResponse, summary="Remove collection item")
def remove_collection_item(
    org_id: UUID,
    collection_id: UUID,
    media_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Remove collection item."""
    collection = db.query(MediaCollection).filter(
        MediaCollection.collection_id == collection_id,
        MediaCollection.organization_id == org_id,
    ).first()

    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")

    if not _user_can_access_collection(collection, auth.user_id, db, required_role="editor"):
        raise HTTPException(status_code=403, detail="Access denied")

    item = db.query(MediaCollectionItem).filter(
        MediaCollectionItem.collection_id == collection_id,
        MediaCollectionItem.media_id == media_id,
    ).first()

    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    db.delete(item)
    db.flush()

    collection.item_count = db.query(MediaCollectionItem).filter(
        MediaCollectionItem.collection_id == collection_id,
    ).count()
    collection.updated_at = datetime.now(timezone.utc)

    if collection.cover_media_id == media_id:
        first_item = db.query(MediaCollectionItem).filter(
            MediaCollectionItem.collection_id == collection_id,
        ).order_by(MediaCollectionItem.sort_order).first()
        collection.cover_media_id = first_item.media_id if first_item else None

    db.commit()
    return {"success": True, "media_id": str(media_id)}


@router.patch("/api/organizations/{org_id}/media-collections/{collection_id}/items/reorder", response_model=SuccessResponse, summary="Reorder collection items")
def reorder_collection_items(
    org_id: UUID,
    collection_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Reorder collection items."""
    collection = db.query(MediaCollection).filter(
        MediaCollection.collection_id == collection_id,
        MediaCollection.organization_id == org_id,
    ).first()

    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")

    if not _user_can_access_collection(collection, auth.user_id, db, required_role="editor"):
        raise HTTPException(status_code=403, detail="Access denied")

    items_data = body.get("items", [])
    for item_data in items_data:
        media_uuid = UUID(item_data["media_id"])
        item = db.query(MediaCollectionItem).filter(
            MediaCollectionItem.collection_id == collection_id,
            MediaCollectionItem.media_id == media_uuid,
        ).first()
        if item:
            item.sort_order = item_data["sort_order"]

    collection.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"success": True}


# ============================================================================
# SHARING
# ============================================================================


@router.get("/api/organizations/{org_id}/media-collections/{collection_id}/shares", response_model=CollectionShareListResponse, summary="List collection shares")
def list_collection_shares(
    org_id: UUID,
    collection_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """List collection shares."""
    collection = db.query(MediaCollection).filter(
        MediaCollection.collection_id == collection_id,
        MediaCollection.organization_id == org_id,
    ).first()

    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")

    if collection.created_by != auth.user_id:
        raise HTTPException(status_code=403, detail="Only the owner can view shares")

    shares = db.query(MediaCollectionShare).filter(
        MediaCollectionShare.collection_id == collection_id,
    ).all()

    return {
        "shares": [_serialize_share(s) for s in shares],
        "total": len(shares),
    }


@router.post("/api/organizations/{org_id}/media-collections/{collection_id}/shares", response_model=CollectionShareOut, summary="Share collection")
def share_collection(
    org_id: UUID,
    collection_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Share collection."""
    collection = db.query(MediaCollection).filter(
        MediaCollection.collection_id == collection_id,
        MediaCollection.organization_id == org_id,
    ).first()

    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")

    if collection.created_by != auth.user_id:
        raise HTTPException(status_code=403, detail="Only the owner can share this collection")

    principal_type = body.get("principal_type", "user")
    principal_id = body.get("principal_id") or body.get("user_id")

    if not principal_id:
        raise HTTPException(status_code=400, detail="principal_id or user_id is required")

    if principal_type not in ("user", "role"):
        raise HTTPException(status_code=400, detail="principal_type must be 'user' or 'role'")

    principal_uuid = UUID(principal_id)
    role = body.get("role", "viewer")

    if role not in ("viewer", "editor"):
        raise HTTPException(status_code=400, detail="role must be 'viewer' or 'editor'")

    if principal_type == "user":
        existing = db.query(MediaCollectionShare).filter(
            MediaCollectionShare.collection_id == collection_id,
            MediaCollectionShare.user_id == principal_uuid,
        ).first()

        if existing:
            existing.role = role
            db.commit()
            return _serialize_share(existing)

        share = MediaCollectionShare(
            collection_id=collection_id,
            user_id=principal_uuid,
            role=role,
            shared_by=auth.user_id,
        )
    else:
        existing = db.query(MediaCollectionShare).filter(
            MediaCollectionShare.collection_id == collection_id,
            MediaCollectionShare.role_id == principal_uuid,
        ).first()

        if existing:
            existing.role = role
            db.commit()
            return _serialize_share(existing)

        share = MediaCollectionShare(
            collection_id=collection_id,
            role_id=principal_uuid,
            role=role,
            shared_by=auth.user_id,
        )

    db.add(share)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Share already exists")

    db.refresh(share)
    return JSONResponse(status_code=201, content=_serialize_share(share))


@router.delete("/api/organizations/{org_id}/media-collections/{collection_id}/shares/{share_id}", response_model=ShareRemovedResponse, summary="Remove collection share")
def remove_collection_share(
    org_id: UUID,
    collection_id: UUID,
    share_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Remove collection share."""
    collection = db.query(MediaCollection).filter(
        MediaCollection.collection_id == collection_id,
        MediaCollection.organization_id == org_id,
    ).first()

    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")

    if collection.created_by != auth.user_id:
        raise HTTPException(status_code=403, detail="Only the owner can remove shares")

    share = db.query(MediaCollectionShare).filter(
        MediaCollectionShare.share_id == share_id,
        MediaCollectionShare.collection_id == collection_id,
    ).first()

    if not share:
        raise HTTPException(status_code=404, detail="Share not found")

    db.delete(share)
    db.commit()
    return {"success": True, "share_id": str(share_id)}


# ============================================================================
# PUBLIC SHARING
# ============================================================================


# ─────────────────────────────────────────────────────────────────────────────
# Public share helpers
# ─────────────────────────────────────────────────────────────────────────────

def _log_share_access(
    db: Session,
    collection: MediaCollection,
    request: Request | None,
    action: str,
    *,
    media_id: UUID | None = None,
    auth_success: bool | None = None,
) -> None:
    """Best-effort audit log; never fails the request."""
    try:
        client_ip = None
        user_agent = None
        referrer = None
        if request is not None:
            client_ip = request.client.host if request.client else None
            user_agent = request.headers.get("user-agent")
            referrer = request.headers.get("referer")
        entry = MediaCollectionShareAccess(
            collection_id=collection.collection_id,
            action=action,
            media_id=media_id,
            auth_success=auth_success,
            ip_address=client_ip,
            user_agent=user_agent,
            referrer=referrer,
        )
        db.add(entry)
        db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()
        logger.warning("Failed to log share access", exc_info=True)


def _apply_share_settings(collection: MediaCollection, body: dict) -> None:
    """Apply share settings from a request body onto the collection."""
    if "expires_at" in body:
        raw = body.get("expires_at")
        if raw in (None, "", False):
            collection.public_share_expires_at = None
        else:
            try:
                dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                collection.public_share_expires_at = dt
            except ValueError:
                raise HTTPException(status_code=400, detail="expires_at must be ISO 8601")
    if "password" in body:
        raw = body.get("password")
        if raw in (None, "", False):
            collection.public_share_password_hash = None
        else:
            collection.public_share_password_hash = hash_password(str(raw))
    if "download_level" in body:
        level = (body.get("download_level") or "none").strip()
        if level not in _SHARE_DOWNLOAD_LEVELS:
            raise HTTPException(status_code=400, detail="Invalid download_level")
        collection.public_share_download_level = level


# ─────────────────────────────────────────────────────────────────────────────
# Owner endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/api/organizations/{org_id}/media-collections/{collection_id}/enable-public", response_model=PublicSharingEnabledResponse, summary="Enable public sharing")
def enable_public_sharing(
    org_id: UUID,
    collection_id: UUID,
    body: dict | None = None,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """
    Enable public sharing and apply optional settings in one step.

    Body (all optional):
        expires_at:     ISO 8601 — pass null to clear
        password:       plaintext — hashed server-side; pass null to clear
        download_level: 'none' | 'derivatives' | 'originals'
    """
    collection = db.query(MediaCollection).filter(
        MediaCollection.collection_id == collection_id,
        MediaCollection.organization_id == org_id,
    ).first()

    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")

    if collection.created_by != auth.user_id:
        raise HTTPException(status_code=403, detail="Only the owner can enable public sharing")

    if collection.consent_clearance_required and not collection.consent_cleared_at:
        raise HTTPException(
            status_code=400,
            detail="Consent clearance is required before enabling public sharing",
        )

    if not collection.public_share_token:
        collection.public_share_token = secrets.token_urlsafe(32)

    if body:
        _apply_share_settings(collection, body)

    collection.public_share_enabled = True
    collection.visibility = "public"
    collection.updated_at = datetime.now(timezone.utc)

    db.commit()

    return {
        "public_share_token": collection.public_share_token,
        "public_url": f"/public/collections/{collection.public_share_token}",
    }


@router.put("/api/organizations/{org_id}/media-collections/{collection_id}/public-share/settings", response_model=SuccessResponse, summary="Update public share settings")
def update_public_share_settings(
    org_id: UUID,
    collection_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """
    Update expiration, password, or download_level on an existing public
    share without re-issuing the token. Body fields are identical to
    ``enable_public_sharing``.
    """
    collection = db.query(MediaCollection).filter(
        MediaCollection.collection_id == collection_id,
        MediaCollection.organization_id == org_id,
    ).first()
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")
    if collection.created_by != auth.user_id:
        raise HTTPException(status_code=403, detail="Only the owner can update share settings")

    _apply_share_settings(collection, body)
    collection.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"success": True}


@router.post("/api/organizations/{org_id}/media-collections/{collection_id}/public-share/rotate", response_model=PublicSharingEnabledResponse, summary="Rotate public share token")
def rotate_public_share_token(
    org_id: UUID,
    collection_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """
    Generate a new share token, invalidating the previous one. Use when a
    token has leaked or you want to revoke access for current holders.
    """
    collection = db.query(MediaCollection).filter(
        MediaCollection.collection_id == collection_id,
        MediaCollection.organization_id == org_id,
    ).first()
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")
    if collection.created_by != auth.user_id:
        raise HTTPException(status_code=403, detail="Only the owner can rotate the token")

    collection.public_share_token = secrets.token_urlsafe(32)
    collection.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {
        "public_share_token": collection.public_share_token,
        "public_url": f"/public/collections/{collection.public_share_token}",
    }


@router.get("/api/organizations/{org_id}/media-collections/{collection_id}/public-share/access-log", summary="List public share access events")
def list_public_share_access(
    org_id: UUID,
    collection_id: UUID,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """List access-log entries for this collection's public share (owner only)."""
    collection = db.query(MediaCollection).filter(
        MediaCollection.collection_id == collection_id,
        MediaCollection.organization_id == org_id,
    ).first()
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")
    if collection.created_by != auth.user_id:
        raise HTTPException(status_code=403, detail="Only the owner can view the access log")

    q = db.query(MediaCollectionShareAccess).filter(
        MediaCollectionShareAccess.collection_id == collection_id,
    ).order_by(MediaCollectionShareAccess.accessed_at.desc())
    total = q.count()
    rows = q.offset(offset).limit(limit).all()

    return {
        "total": total,
        "entries": [
            {
                "access_id": str(r.access_id),
                "accessed_at": r.accessed_at.isoformat() if r.accessed_at else None,
                "action": r.action,
                "media_id": str(r.media_id) if r.media_id else None,
                "auth_success": r.auth_success,
                "ip_address": r.ip_address,
                "user_agent": r.user_agent,
                "referrer": r.referrer,
            }
            for r in rows
        ],
    }


@router.delete("/api/organizations/{org_id}/media-collections/{collection_id}/disable-public", response_model=SuccessResponse, summary="Disable public sharing")
def disable_public_sharing(
    org_id: UUID,
    collection_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Disable public sharing and clear the token."""
    collection = db.query(MediaCollection).filter(
        MediaCollection.collection_id == collection_id,
        MediaCollection.organization_id == org_id,
    ).first()

    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")

    if collection.created_by != auth.user_id:
        raise HTTPException(status_code=403, detail="Only the owner can disable public sharing")

    collection.public_share_enabled = False
    collection.public_share_token = None
    collection.public_share_password_hash = None
    collection.public_share_expires_at = None
    collection.public_share_download_level = "none"
    collection.visibility = "private"
    collection.updated_at = datetime.now(timezone.utc)

    db.commit()
    return {"success": True}


# ============================================================================
# CONSENT CLEARANCE
# ============================================================================


@router.get("/api/organizations/{org_id}/media-collections/{collection_id}/consent-clearance", response_model=ConsentClearanceResponse, summary="Check consent clearance")
def check_consent_clearance(
    org_id: UUID,
    collection_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """Check consent clearance."""
    collection = db.query(MediaCollection).filter(
        MediaCollection.collection_id == collection_id,
        MediaCollection.organization_id == org_id,
    ).first()

    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")

    if not _user_can_access_collection(collection, auth.user_id, db):
        raise HTTPException(status_code=403, detail="Access denied")

    items = db.query(MediaCollectionItem).options(
        joinedload(MediaCollectionItem.media),
    ).filter(
        MediaCollectionItem.collection_id == collection_id,
    ).all()

    media_without_consent = []
    media_with_expired_consent = []

    for item in items:
        if not item.media:
            continue

        valid_consent = db.query(MediaConsent).filter(
            MediaConsent.media_id == item.media_id,
            MediaConsent.is_valid == True,  # noqa: E712
            MediaConsent.consent_scope.in_(["public", "commercial", "all"]),
        ).first()

        if not valid_consent:
            media_without_consent.append({
                "media_id": str(item.media_id),
                "title": item.media.title,
                "filename": item.media.filename,
            })
        elif valid_consent.expiry_date and valid_consent.expiry_date < datetime.now(timezone.utc).date():
            media_with_expired_consent.append({
                "media_id": str(item.media_id),
                "title": item.media.title,
                "filename": item.media.filename,
                "expiry_date": valid_consent.expiry_date.isoformat(),
            })

    is_cleared = len(media_without_consent) == 0 and len(media_with_expired_consent) == 0

    return {
        "is_cleared": is_cleared,
        "media_count": len(items),
        "media_without_consent": media_without_consent,
        "media_with_expired_consent": media_with_expired_consent,
    }


@router.post("/api/organizations/{org_id}/media-collections/{collection_id}/clear-consent", response_model=ConsentClearedResponse, summary="Clear collection consent")
def clear_collection_consent(
    org_id: UUID,
    collection_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Clear collection consent."""
    collection = db.query(MediaCollection).filter(
        MediaCollection.collection_id == collection_id,
        MediaCollection.organization_id == org_id,
    ).first()

    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")

    if collection.created_by != auth.user_id:
        raise HTTPException(status_code=403, detail="Only the owner can clear consent")

    items = db.query(MediaCollectionItem).filter(
        MediaCollectionItem.collection_id == collection_id,
    ).all()

    for item in items:
        valid_consent = db.query(MediaConsent).filter(
            MediaConsent.media_id == item.media_id,
            MediaConsent.is_valid == True,  # noqa: E712
            MediaConsent.consent_scope.in_(["public", "commercial", "all"]),
        ).first()

        if not valid_consent:
            raise HTTPException(
                status_code=400,
                detail=f"Media {item.media_id} does not have valid public consent",
            )

        if valid_consent.expiry_date and valid_consent.expiry_date < datetime.now(timezone.utc).date():
            raise HTTPException(
                status_code=400,
                detail=f"Media {item.media_id} has expired consent",
            )

    collection.consent_cleared_at = datetime.now(timezone.utc)
    collection.consent_cleared_by = auth.user_id
    db.commit()

    return {
        "success": True,
        "cleared_at": collection.consent_cleared_at.isoformat(),
    }


# ============================================================================
# OWNER'S SHARES INDEX
# ============================================================================


@router.get(
    "/api/organizations/{org_id}/media/my-shares",
    summary="List public share links owned by the current user",
)
def list_my_public_shares(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """
    Return one row per enabled public share token owned by the caller.
    Includes aggregate access stats so owners can spot unusual activity and
    revoke or rotate from a single view.
    """
    cols = (
        db.query(MediaCollection)
        .filter(
            MediaCollection.organization_id == org_id,
            MediaCollection.created_by == auth.user_id,
            MediaCollection.public_share_enabled == True,  # noqa: E712
        )
        .order_by(MediaCollection.updated_at.desc())
        .all()
    )

    if not cols:
        return {"shares": []}

    # Aggregate access counts per collection in one pass.
    collection_ids = [c.collection_id for c in cols]
    rows = (
        db.query(
            MediaCollectionShareAccess.collection_id,
            MediaCollectionShareAccess.action,
            func.count().label("n"),
            func.max(MediaCollectionShareAccess.accessed_at).label("last"),
        )
        .filter(MediaCollectionShareAccess.collection_id.in_(collection_ids))
        .group_by(
            MediaCollectionShareAccess.collection_id,
            MediaCollectionShareAccess.action,
        )
        .all()
    )

    stats: dict[UUID, dict] = {cid: {"views": 0, "downloads": 0, "failed_auth": 0, "last_accessed_at": None} for cid in collection_ids}
    for cid, action, n, last in rows:
        entry = stats[cid]
        if action == "view":
            entry["views"] += int(n)
        elif action == "download":
            entry["downloads"] += int(n)
        elif action == "auth":
            # Failed-auth counts require a second query; approximate here as 0.
            pass
        if last and (entry["last_accessed_at"] is None or last > entry["last_accessed_at"]):
            entry["last_accessed_at"] = last

    # Failed-auth count (where auth_success = false) — separate query so the
    # group-by above stays simple.
    failed_rows = (
        db.query(
            MediaCollectionShareAccess.collection_id,
            func.count().label("n"),
        )
        .filter(
            MediaCollectionShareAccess.collection_id.in_(collection_ids),
            MediaCollectionShareAccess.action == "auth",
            MediaCollectionShareAccess.auth_success.is_(False),
        )
        .group_by(MediaCollectionShareAccess.collection_id)
        .all()
    )
    for cid, n in failed_rows:
        stats[cid]["failed_auth"] = int(n)

    return {
        "shares": [
            {
                "collection_id": str(c.collection_id),
                "name": c.name,
                "item_count": c.item_count,
                "public_share_token": c.public_share_token,
                "public_share_expires_at": c.public_share_expires_at.isoformat() if c.public_share_expires_at else None,
                "public_share_has_password": bool(c.public_share_password_hash),
                "public_share_download_level": c.public_share_download_level,
                "created_at": c.created_at.isoformat() if c.created_at else None,
                "updated_at": c.updated_at.isoformat() if c.updated_at else None,
                "views": stats[c.collection_id]["views"],
                "downloads": stats[c.collection_id]["downloads"],
                "failed_auth": stats[c.collection_id]["failed_auth"],
                "last_accessed_at": stats[c.collection_id]["last_accessed_at"].isoformat() if stats[c.collection_id]["last_accessed_at"] else None,
            }
            for c in cols
        ],
    }


# ============================================================================
# PUBLIC ACCESS (NO AUTH)
# ============================================================================


def _resolve_public_collection(
    share_token: str,
    db: Session,
    request: Request | None,
    password_header: str | None,
) -> MediaCollection:
    """
    Resolve a share token into a collection, enforcing enable / expire /
    password. Side-effects: logs auth success/failure. Raises:
        404 — token unknown or disabled
        410 — share has expired (logged)
        401 — password required / wrong (logged)
    """
    collection = db.query(MediaCollection).filter(
        MediaCollection.public_share_token == share_token,
        MediaCollection.public_share_enabled == True,  # noqa: E712
    ).first()
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")

    # Expiration
    if collection.public_share_expires_at:
        now = datetime.now(timezone.utc)
        exp = collection.public_share_expires_at
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp < now:
            _log_share_access(db, collection, request, "view", auth_success=False)
            raise HTTPException(
                status_code=410,
                detail={"code": "share_expired", "message": "This share link has expired"},
            )

    # Password
    if collection.public_share_password_hash:
        if not password_header or not verify_password(password_header, collection.public_share_password_hash):
            _log_share_access(db, collection, request, "auth", auth_success=False)
            raise HTTPException(
                status_code=401,
                detail={"code": "password_required", "message": "Password required"},
            )
        _log_share_access(db, collection, request, "auth", auth_success=True)

    return collection


@router.get("/public/collections/{share_token}", response_model=PublicCollectionResponse, summary="Get public collection")
def get_public_collection(
    share_token: str,
    request: Request,
    x_share_password: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """
    Return the public collection + items.

    Sends ``X-Share-Password`` as the challenge response when the share is
    password-protected. Clients on receiving 401 should prompt the viewer
    for the password and retry.
    """
    collection = _resolve_public_collection(share_token, db, request, x_share_password)

    items = db.query(MediaCollectionItem).options(
        joinedload(MediaCollectionItem.media),
    ).filter(
        MediaCollectionItem.collection_id == collection.collection_id,
    ).order_by(MediaCollectionItem.sort_order).all()

    _log_share_access(db, collection, request, "view")

    return {
        "collection": _serialize_collection(collection, db),
        "items": [_serialize_collection_item(item, db) for item in items],
    }


@router.get(
    "/public/collections/{share_token}/media/{media_id}/download",
    summary="Download media from a public share",
)
def public_collection_download(
    share_token: str,
    media_id: UUID,
    request: Request,
    variant: str = Query("original", description="'original' or a derivative key"),
    x_share_password: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """
    Serve a file from a public share, gated by the share's download_level.

        download_level = 'none'        → always 403
        download_level = 'derivatives' → variant != 'original' only
        download_level = 'originals'   → any variant including 'original'
    """
    collection = _resolve_public_collection(share_token, db, request, x_share_password)
    level = collection.public_share_download_level or "none"
    if level == "none":
        raise HTTPException(status_code=403, detail="Downloads are not permitted on this share")
    if level == "derivatives" and variant == "original":
        raise HTTPException(status_code=403, detail="Originals are not permitted on this share")

    # Item must actually be in this collection.
    item = db.query(MediaCollectionItem).filter(
        MediaCollectionItem.collection_id == collection.collection_id,
        MediaCollectionItem.media_id == media_id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not in collection")

    media = db.query(Media).filter(Media.media_id == media_id).first()
    if not media:
        raise HTTPException(status_code=404, detail="Media not found")

    # Resolve the target S3 key.
    if variant == "original":
        s3_key = media.s3_key
    else:
        deriv = next(
            (d for d in getattr(media, "derivatives", []) if d.variant == variant),
            None,
        )
        if not deriv or not deriv.s3_key:
            raise HTTPException(status_code=404, detail="Variant not found")
        s3_key = deriv.s3_key

    url = get_org_media_url(
        s3_key,
        organization_id=str(media.organization_id),
        db_session=db,
        expiry_seconds=300,
    )
    _log_share_access(db, collection, request, "download", media_id=media_id)
    return JSONResponse({"url": url, "variant": variant, "expires_in": 300})


# ============================================================================
# METADATA TEMPLATES
# ============================================================================


@router.get("/api/organizations/{org_id}/media/metadata-templates", response_model=MetadataTemplateListResponse, summary="List metadata templates")
def list_metadata_templates(
    org_id: UUID,
    include_inactive: bool = Query(False),
    search: str | None = Query(None),
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """List metadata templates."""
    query = db.query(MetadataTemplate).filter(
        MetadataTemplate.organization_id == org_id,
    )

    if not include_inactive:
        query = query.filter(MetadataTemplate.is_active == True)  # noqa: E712

    if search:
        from app.services.api_security import escape_ilike
        escaped = escape_ilike(search.strip())
        query = query.filter(MetadataTemplate.name.ilike(f"%{escaped}%", escape="\\"))

    templates = query.order_by(
        MetadataTemplate.is_default.desc(),
        MetadataTemplate.name,
    ).all()

    return {
        "templates": [_serialize_metadata_template(t) for t in templates],
    }


@router.post("/api/organizations/{org_id}/media/metadata-templates", response_model=MetadataTemplateCreatedResponse, status_code=201, summary="Create metadata template")
def create_metadata_template(
    org_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Create metadata template."""
    if not body.get("name"):
        raise HTTPException(status_code=400, detail="name is required")

    # Reject template_fields that would fail Media CHECK constraints at apply time.
    field_errors = validate_template_fields(body.get("template_fields"))
    if field_errors:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "validation_error",
                "message": "Invalid template field values",
                "details": {"errors": field_errors},
            },
        )

    if body.get("is_default"):
        existing_defaults = db.query(MetadataTemplate).filter(
            MetadataTemplate.organization_id == org_id,
            MetadataTemplate.is_default == True,  # noqa: E712
        ).all()
        for t in existing_defaults:
            t.is_default = False

    template = MetadataTemplate(
        organization_id=org_id,
        name=body["name"],
        description=body.get("description"),
        template_fields=body.get("template_fields", {}),
        is_default=body.get("is_default", False),
        is_active=True,
        created_by=auth.user_id,
    )

    db.add(template)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Metadata template with this name already exists")

    db.refresh(template)
    return {
        "template_id": str(template.template_id),
        "name": template.name,
        "description": template.description,
        "template_fields": template.template_fields or {},
        "is_default": template.is_default,
    }


@router.get("/api/organizations/{org_id}/media/metadata-templates/{template_id}", response_model=MetadataTemplateOut, summary="Get metadata template")
def get_metadata_template(
    org_id: UUID,
    template_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """Get metadata template."""
    template = db.query(MetadataTemplate).filter(
        MetadataTemplate.template_id == template_id,
        MetadataTemplate.organization_id == org_id,
    ).first()

    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    return _serialize_metadata_template(template)


@router.patch("/api/organizations/{org_id}/media/metadata-templates/{template_id}", response_model=MetadataTemplateCreatedResponse, summary="Update metadata template")
def update_metadata_template(
    org_id: UUID,
    template_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Update metadata template."""
    template = db.query(MetadataTemplate).filter(
        MetadataTemplate.template_id == template_id,
        MetadataTemplate.organization_id == org_id,
    ).first()

    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    if "name" in body:
        template.name = body["name"]
    if "description" in body:
        template.description = body["description"]
    if "template_fields" in body:
        # Reject values that would fail Media CHECK constraints at apply time.
        field_errors = validate_template_fields(body["template_fields"])
        if field_errors:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "validation_error",
                    "message": "Invalid template field values",
                    "details": {"errors": field_errors},
                },
            )
        template.template_fields = body["template_fields"]

    if body.get("is_default") and not template.is_default:
        existing_defaults = db.query(MetadataTemplate).filter(
            MetadataTemplate.organization_id == org_id,
            MetadataTemplate.is_default == True,  # noqa: E712
            MetadataTemplate.template_id != template_id,
        ).all()
        for t in existing_defaults:
            t.is_default = False
        template.is_default = True
    elif "is_default" in body:
        template.is_default = body["is_default"]

    template.updated_by = auth.user_id

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Metadata template with this name already exists")

    db.refresh(template)
    return {
        "template_id": str(template.template_id),
        "name": template.name,
        "description": template.description,
        "template_fields": template.template_fields or {},
        "is_default": template.is_default,
    }


@router.delete("/api/organizations/{org_id}/media/metadata-templates/{template_id}", response_model=MetadataTemplateDeletedResponse, summary="Delete metadata template")
def delete_metadata_template(
    org_id: UUID,
    template_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete metadata template."""
    template = db.query(MetadataTemplate).filter(
        MetadataTemplate.template_id == template_id,
        MetadataTemplate.organization_id == org_id,
    ).first()

    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    template.is_active = False
    db.commit()
    return {"success": True, "template_id": str(template_id)}


@router.post("/api/organizations/{org_id}/media/metadata-templates/{template_id}/set-default", response_model=MetadataTemplateSetDefaultResponse, summary="Set default metadata template")
def set_default_metadata_template(
    org_id: UUID,
    template_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_ADMIN)),
    db: Session = Depends(get_db),
):
    """Set default metadata template."""
    template = db.query(MetadataTemplate).filter(
        MetadataTemplate.template_id == template_id,
        MetadataTemplate.organization_id == org_id,
        MetadataTemplate.is_active == True,  # noqa: E712
    ).first()

    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    existing_defaults = db.query(MetadataTemplate).filter(
        MetadataTemplate.organization_id == org_id,
        MetadataTemplate.is_default == True,  # noqa: E712
        MetadataTemplate.template_id != template_id,
    ).all()
    for t in existing_defaults:
        t.is_default = False

    template.is_default = True
    template.updated_by = auth.user_id
    db.commit()

    return {
        "success": True,
        "template_id": str(template_id),
        "message": f"'{template.name}' is now the default metadata template",
    }
