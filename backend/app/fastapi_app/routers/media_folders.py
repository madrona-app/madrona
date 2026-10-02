"""
Media Folders API endpoints (FastAPI).

Phase 9a — 7 routes:
  - Folder CRUD (5 routes)
  - Folder contents (1 route)
  - Move items to folder (1 route)

Migrated from app/api/media.py.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.models import MediaFolder
from app.permissions import Permission
from app.services.media_folders import MediaFolderService
from app.fastapi_app.schemas.media_folders import (
    DeleteFolderResponse,
    FolderContentsResponse,
    FolderListResponse,
    MediaFolderOut,
    MoveItemsResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["media-folders"])


# ============================================================================
# SERIALIZERS
# ============================================================================


def _serialize_folder(folder: MediaFolder) -> dict:
    return {
        "folder_id": str(folder.folder_id),
        "organization_id": str(folder.organization_id),
        "name": folder.name,
        "parent_folder_id": str(folder.parent_folder_id) if folder.parent_folder_id else None,
        "path": folder.path,
        "depth": folder.depth,
        "sort_order": folder.sort_order,
        "created_at": folder.created_at.isoformat() if folder.created_at else None,
        "updated_at": folder.updated_at.isoformat() if folder.updated_at else None,
    }


# ============================================================================
# FOLDER ROUTES
# ============================================================================


@router.get("/api/organizations/{org_id}/media/folders", response_model=FolderListResponse, summary="List folders")
def list_folders(
    org_id: UUID,
    include_counts: bool = Query(True),
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """List folders."""
    service = MediaFolderService(db)
    folders = service.get_folder_tree(org_id, include_counts=include_counts)

    unfiled_count = service.get_unfiled_count(org_id) if include_counts else None

    return {
        "folders": folders,
        "unfiled_count": unfiled_count,
    }


@router.post("/api/organizations/{org_id}/media/folders", response_model=MediaFolderOut, status_code=201, summary="Create folder")
def create_folder(
    org_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Create folder."""
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Folder name is required")

    parent_folder_id = body.get("parent_folder_id")
    if parent_folder_id:
        parent_folder_id = UUID(parent_folder_id)

    service = MediaFolderService(db)
    try:
        folder = service.create_folder(
            organization_id=org_id,
            name=name,
            parent_folder_id=parent_folder_id,
            created_by_id=auth.user_id,
        )
        db.commit()
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    except IntegrityError as e:
        db.rollback()
        if "uq_media_folders_org_parent_name" in str(e):
            raise HTTPException(status_code=409, detail="A folder with this name already exists in this location")
        raise HTTPException(status_code=400, detail="Database constraint violation")

    return _serialize_folder(folder)


@router.get("/api/organizations/{org_id}/media/folders/{folder_id}", response_model=MediaFolderOut, summary="Get folder")
def get_folder(
    org_id: UUID,
    folder_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """Get folder."""
    service = MediaFolderService(db)
    folder = service.get_folder(folder_id)

    if not folder or folder.organization_id != org_id:
        raise HTTPException(status_code=404, detail="Folder not found")

    breadcrumbs = service.get_folder_path(folder_id)

    result = _serialize_folder(folder)
    result["breadcrumbs"] = breadcrumbs
    return result


@router.patch("/api/organizations/{org_id}/media/folders/{folder_id}", response_model=MediaFolderOut, summary="Update folder")
def update_folder(
    org_id: UUID,
    folder_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Update folder."""
    service = MediaFolderService(db)
    folder = service.get_folder(folder_id)

    if not folder or folder.organization_id != org_id:
        raise HTTPException(status_code=404, detail="Folder not found")

    try:
        if "name" in body:
            name = body["name"].strip()
            if not name:
                raise HTTPException(status_code=400, detail="Folder name cannot be empty")
            folder = service.rename_folder(folder_id, name)

        if "parent_folder_id" in body:
            new_parent = body["parent_folder_id"]
            if new_parent is not None:
                new_parent = UUID(new_parent)
            folder = service.move_folder(folder_id, new_parent)

        db.commit()
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    except IntegrityError as e:
        db.rollback()
        if "uq_media_folders_org_parent_name" in str(e):
            raise HTTPException(status_code=409, detail="A folder with this name already exists in this location")
        raise HTTPException(status_code=400, detail="Database constraint violation")

    return _serialize_folder(folder)


@router.delete("/api/organizations/{org_id}/media/folders/{folder_id}", response_model=DeleteFolderResponse, summary="Delete folder")
def delete_folder(
    org_id: UUID,
    folder_id: UUID,
    move_to: str | None = Query(None),
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete folder."""
    service = MediaFolderService(db)
    folder = service.get_folder(folder_id)

    if not folder or folder.organization_id != org_id:
        raise HTTPException(status_code=404, detail="Folder not found")

    move_to_uuid = UUID(move_to) if move_to else None

    try:
        affected_count = service.delete_folder(folder_id, move_contents_to=move_to_uuid)
        db.commit()
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Cannot delete folder with existing contents")

    return {
        "success": True,
        "media_items_affected": affected_count,
    }


@router.get("/api/organizations/{org_id}/media/folders/{folder_id}/contents", response_model=FolderContentsResponse, summary="Get folder contents")
def get_folder_contents(
    org_id: UUID,
    folder_id: str,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """Get folder contents."""
    service = MediaFolderService(db)

    if folder_id.lower() in ("root", "unfiled"):
        folder_uuid = None
    else:
        folder_uuid = UUID(folder_id)
        folder = service.get_folder(folder_uuid)
        if not folder or folder.organization_id != org_id:
            raise HTTPException(status_code=404, detail="Folder not found")

    contents = service.get_folder_contents(
        folder_id=folder_uuid,
        organization_id=org_id,
        limit=limit,
        offset=offset,
    )

    return contents


@router.post("/api/organizations/{org_id}/media/folders/{folder_id}/move-items", response_model=MoveItemsResponse, summary="Move items to folder")
def move_items_to_folder(
    org_id: UUID,
    folder_id: str,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Move items to folder."""
    media_ids = body.get("media_ids", [])
    if not media_ids:
        raise HTTPException(status_code=400, detail="media_ids is required")

    media_uuids = [UUID(mid) for mid in media_ids]

    if folder_id.lower() in ("root", "unfiled"):
        folder_uuid = None
    else:
        folder_uuid = UUID(folder_id)

    service = MediaFolderService(db)
    try:
        moved_count = service.move_media_to_folder(
            media_ids=media_uuids,
            folder_id=folder_uuid,
            organization_id=org_id,
        )
        db.commit()
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

    return {
        "success": True,
        "moved_count": moved_count,
    }
