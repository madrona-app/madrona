"""
Collection object media endpoints (FastAPI).

Migrated from app/api/collections/media.py — 5 routes:
  - POST   /api/organizations/{org_id}/collections/objects/{object_id}/media
  - GET    /api/organizations/{org_id}/collections/objects/{object_id}/media
  - PUT    /api/organizations/{org_id}/collections/objects/{object_id}/media/{media_id}
  - DELETE /api/organizations/{org_id}/collections/objects/{object_id}/media/{media_id}
  - PUT    /api/organizations/{org_id}/collections/objects/{object_id}/media/{media_id}/primary
"""
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, Form
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.models import CollectionObject, CollectionObjectMedia, Media
from app.permissions import Permission
from app.services.uploads import get_org_media_url, detect_media_type, upload_org_media, StorageLimitExceeded
from app.services.api_security import sanitize_error_message
from app.fastapi_app.serializers.collections import _serialize_collection_object_media
from app.fastapi_app.serializers.collections_helpers import _index_collection_object, _reindex_linked_media
from app.fastapi_app.schemas.common import SuccessResponse

logger = logging.getLogger(__name__)


def _reindex_single_media(media: Media) -> None:
    """Re-index a single media item in the media search index."""
    try:
        from app.search.media import MediaSearchService, get_media_search_service

        if MediaSearchService.is_available():
            service = get_media_search_service()
            service.index_media(media)
    except Exception as e:
        logger.warning(f"Failed to re-index media {media.media_id}: {e}")
from app.fastapi_app.schemas.collections_media import (
    CollectionObjectMediaOut,
    ObjectMediaListResponse,
    SetPrimaryMediaResponse,
)

logger = logging.getLogger(__name__)


def _org_scoped_link(db: Session, org_id: UUID, object_id: UUID, media_id: UUID) -> CollectionObjectMedia:
    """Load an object↔media link, proving the OBJECT belongs to `org_id`.

    `collection_object_media` carries no organization_id of its own, so a bare
    filter on (object_id, media_id) matches another institution's row.
    `require_permission` only proves membership of the org in the PATH, not of
    the ids in it, so an ordinary user of org A could pass org B's ids and
    edit, unlink or re-point B's object imagery — which also renders on B's
    public Discover and IIIF pages.

    There is now an FK-subquery RLS policy on the table as well
    (collection_object_media_via_parent). This check is the app-layer half:
    it returns a clean 404 instead of relying on the row simply being
    invisible, and it holds on admin/BYPASSRLS sessions where RLS does not.
    """
    link = (
        db.query(CollectionObjectMedia)
        .join(CollectionObject, CollectionObject.object_id == CollectionObjectMedia.object_id)
        .filter(
            CollectionObjectMedia.object_id == object_id,
            CollectionObjectMedia.media_id == media_id,
            CollectionObject.organization_id == org_id,
        )
        .first()
    )
    if not link:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Media link not found",
        })
    return link


router = APIRouter(tags=["collections-media"])


# ============================================================================
# LIST OBJECT MEDIA
# ============================================================================

@router.get("/api/organizations/{org_id}/collections/objects/{object_id}/media", response_model=ObjectMediaListResponse, summary="List object media")
def list_object_media(
    org_id: UUID,
    object_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """List all media linked to a collection object."""
    obj = db.query(CollectionObject).filter(
        CollectionObject.object_id == object_id,
        CollectionObject.organization_id == org_id,
    ).first()

    if not obj:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Collection object not found",
        })

    links = db.query(CollectionObjectMedia).filter(
        CollectionObjectMedia.object_id == object_id,
    ).options(
        joinedload(CollectionObjectMedia.media),
    ).order_by(
        CollectionObjectMedia.sort_order,
        CollectionObjectMedia.created_at,
    ).all()

    return {
        "media": [_serialize_collection_object_media(link, session=db, user_id=str(auth.user_id)) for link in links],
        "total": len(links),
    }


# ============================================================================
# LINK MEDIA TO OBJECT
# ============================================================================

@router.post("/api/organizations/{org_id}/collections/objects/{object_id}/media", status_code=201, response_model=CollectionObjectMediaOut, summary="Upload and link media to object")
def upload_and_link_media_to_object(
    org_id: UUID,
    object_id: UUID,
    file: UploadFile = File(...),
    is_primary: bool = Form(False),
    sort_order: int = Form(0),
    caption_override: str | None = Form(None),
    usage_type: str | None = Form(None),
    title: str | None = Form(None),
    description: str | None = Form(None),
    alt_text: str | None = Form(None),
    credit: str | None = Form(None),
    copyright_status: str | None = Form(None),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Upload a file and link it to a collection object."""
    obj = db.query(CollectionObject).filter(
        CollectionObject.object_id == object_id,
        CollectionObject.organization_id == org_id,
    ).first()

    if not obj:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Collection object not found",
        })

    if not file.filename:
        raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "No filename provided"})

    content_type = file.content_type or 'application/octet-stream'
    media_type = detect_media_type(content_type)
    if not media_type:
        raise HTTPException(status_code=400, detail={"code": "bad_request", "message": f"Unsupported file type: {content_type}"})

    # Upload file to storage
    try:
        s3_key, file_size = upload_org_media(
            organization_id=str(org_id),
            file_data=file.file,
            content_type=content_type,
            media_type=media_type,
            filename=file.filename,
            db_session=db,
        )
    except StorageLimitExceeded as e:
        raise HTTPException(status_code=413, detail={
            "code": "STORAGE_LIMIT_EXCEEDED",
            "message": sanitize_error_message(e),
        })
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"code": "bad_request", "message": sanitize_error_message(e)})

    # Create media record
    media = Media(
        organization_id=org_id,
        s3_key=s3_key,
        filename=file.filename,
        file_size=file_size,
        mime_type=content_type,
        media_type=media_type.value,
        title=title or file.filename,
        description=description,
        alt_text=alt_text,
        credit=credit,
        copyright_status=copyright_status,
        processing_status='pending',
        created_by=auth.user_id,
    )
    db.add(media)
    db.flush()

    # Process (thumbnails, etc.)
    from app.services.uploads import MediaType as MT
    processable = {MT.IMAGE, MT.VIDEO, MT.DOCUMENT, MT.AUDIO}
    if media_type in processable:
        try:
            from app.tasks.media import process_upload_task
            process_upload_task.delay(str(media.media_id), str(org_id), generate_webp=False)
        except Exception as e:
            logger.warning(f"Failed to queue processing task: {e}")
            media.processing_status = 'completed'

    # If first media on object, make it primary
    existing_count = db.query(CollectionObjectMedia).filter(
        CollectionObjectMedia.object_id == object_id,
    ).count()
    if existing_count == 0:
        is_primary = True

    if is_primary:
        db.query(CollectionObjectMedia).filter(
            CollectionObjectMedia.object_id == object_id,
            CollectionObjectMedia.is_primary == True,
        ).update({'is_primary': False})

    link = CollectionObjectMedia(
        object_id=object_id,
        media_id=media.media_id,
        is_primary=is_primary,
        sort_order=sort_order,
        caption_override=caption_override,
        usage_type=usage_type,
        created_by=auth.user_id,
    )
    db.add(link)
    db.commit()

    # Re-index
    _reindex_single_media(media)

    # Reload with media relationship
    link = db.query(CollectionObjectMedia).filter(
        CollectionObjectMedia.object_id == object_id,
        CollectionObjectMedia.media_id == media.media_id,
    ).options(joinedload(CollectionObjectMedia.media)).first()

    return _serialize_collection_object_media(link, session=db, user_id=str(auth.user_id))


# ============================================================================
# UPDATE MEDIA LINK
# ============================================================================

@router.put("/api/organizations/{org_id}/collections/objects/{object_id}/media/{media_id}", response_model=CollectionObjectMediaOut, summary="Update object media link")
async def update_object_media_link(
    org_id: UUID,
    object_id: UUID,
    media_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Update the link between media and object (is_primary, sort_order, caption_override, usage_type)."""
    link = _org_scoped_link(db, org_id, object_id, media_id)

    data = await request.json()

    if 'is_primary' in data and data['is_primary']:
        db.query(CollectionObjectMedia).filter(
            CollectionObjectMedia.object_id == object_id,
            CollectionObjectMedia.media_id != media_id,
            CollectionObjectMedia.is_primary == True,
        ).update({'is_primary': False})
        link.is_primary = True
    elif 'is_primary' in data:
        link.is_primary = data['is_primary']

    if 'sort_order' in data:
        link.sort_order = data['sort_order']
    if 'caption_override' in data:
        link.caption_override = data['caption_override']
    if 'usage_type' in data:
        link.usage_type = data['usage_type']

    db.commit()

    link = db.query(CollectionObjectMedia).filter(
        CollectionObjectMedia.object_id == object_id,
        CollectionObjectMedia.media_id == media_id,
    ).options(joinedload(CollectionObjectMedia.media)).first()

    return _serialize_collection_object_media(link, session=db, user_id=str(auth.user_id))


# ============================================================================
# UNLINK MEDIA FROM OBJECT
# ============================================================================

@router.delete("/api/organizations/{org_id}/collections/objects/{object_id}/media/{media_id}", response_model=SuccessResponse, summary="Unlink media from object")
def unlink_media_from_object(
    org_id: UUID,
    object_id: UUID,
    media_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Remove the link between media and object (does not delete the media)."""
    link = _org_scoped_link(db, org_id, object_id, media_id)

    # Get the media before deleting the link so we can reindex it
    media = db.query(Media).filter(Media.media_id == media_id).first()

    db.delete(link)
    db.commit()

    # Re-index the media so the removed object metadata is cleared
    if media:
        _reindex_single_media(media)

    return {"success": True}


# ============================================================================
# SET PRIMARY MEDIA
# ============================================================================

@router.put("/api/organizations/{org_id}/collections/objects/{object_id}/media/{media_id}/primary", response_model=SetPrimaryMediaResponse, summary="Set primary media")
def set_primary_media(
    org_id: UUID,
    object_id: UUID,
    media_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Set a media item as the primary image for an object."""
    link = _org_scoped_link(db, org_id, object_id, media_id)

    db.query(CollectionObjectMedia).filter(
        CollectionObjectMedia.object_id == object_id,
        CollectionObjectMedia.is_primary == True,
    ).update({'is_primary': False})

    link.is_primary = True
    db.commit()

    return {"success": True, "media_id": str(media_id)}
