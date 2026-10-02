"""
Media Workspaces API endpoints (FastAPI).

Phase 9h — 20 routes:
  - Workspace CRUD (5 routes): list, create, get, update, delete
  - Workspace Items (3 routes): add, remove, reorder
  - Sharing (3 routes): list shares, create share, delete share
  - Active Context (4 routes): get context, set workspace context, set asset context, clear context
  - Bulk Actions (5 routes): list actions, preview, validate, execute, get run status

Migrated from app/api/media_workspaces.py.
"""

import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy import and_, or_, func
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.models import (
    Media,
    MediaDerivative,
    MediaTag,
    MediaTagDefinition,
    MediaTagValue,
    MediaWorkspace,
    MediaWorkspaceItem,
    MediaWorkspaceShare,
    MediaWorkspaceActionRun,
    MetadataTemplate,
    User,
    UserActiveContext,
)
from app.fastapi_app.schemas.media_workspaces import (
    ActionRunResponse,
    ActiveContextResponse,
    BulkActionAsyncResponse,
    BulkActionExecuteResponse,
    BulkActionPreviewResponse,
    BulkActionsListResponse,
    BulkActionValidateResponse,
    SuccessMessageResponse,
    WorkspaceCreatedResponse,
    WorkspaceDetailResponse,
    WorkspaceItemsAddedResponse,
    WorkspaceItemsRemovedResponse,
    WorkspaceListResponse,
    WorkspaceShareCreatedResponse,
    WorkspaceShareListResponse,
    WorkspaceUpdatedResponse,
)
from app.permissions import Permission
from app.services.api_security import escape_ilike, sanitize_error_message
from app.services.dynamic_media_workspace import (
    count_dynamic_media_workspace_total,
    resolve_dynamic_media_workspace_media_ids,
)
from app.services.media_field_validation import VALID_COPYRIGHT_STATUSES
from app.services.uploads import get_org_media_url

logger = logging.getLogger(__name__)

router = APIRouter(tags=["media-workspaces"])


# ============================================================================
# SERIALIZERS / HELPERS
# ============================================================================


def _can_access_workspace(db: Session, workspace: MediaWorkspace, user_id: UUID, org_id: UUID) -> bool:
    """Check if user can access the workspace."""
    if workspace.owner_user_id == user_id:
        return True
    share = db.query(MediaWorkspaceShare).filter(
        MediaWorkspaceShare.workspace_id == workspace.workspace_id,
        MediaWorkspaceShare.principal_type == "user",
        MediaWorkspaceShare.principal_id == user_id,
    ).first()
    if share:
        return True
    if workspace.visibility == "org":
        return True
    return False


def _get_user_permission_level(db: Session, workspace: MediaWorkspace, user_id: UUID) -> str:
    """Get user's permission level on a workspace."""
    if workspace.owner_user_id == user_id:
        return "admin"
    share = db.query(MediaWorkspaceShare).filter(
        MediaWorkspaceShare.workspace_id == workspace.workspace_id,
        MediaWorkspaceShare.principal_type == "user",
        MediaWorkspaceShare.principal_id == user_id,
    ).first()
    if share:
        return share.permission
    if workspace.visibility == "org":
        return "view"
    return "none"


def _has_sufficient_permission(user_level: str, required_level: str) -> bool:
    """Check if user has sufficient permission."""
    levels = ["none", "view", "edit", "execute", "admin"]
    user_idx = levels.index(user_level) if user_level in levels else 0
    required_idx = levels.index(required_level) if required_level in levels else 0
    return user_idx >= required_idx


def _get_media_thumbnail_url(db: Session, media: Media) -> str | None:
    """Get thumbnail URL for a media item."""
    if not media:
        return None
    thumbnail = db.query(MediaDerivative).filter(
        MediaDerivative.media_id == media.media_id,
        MediaDerivative.derivative_type == "thumbnail",
    ).first()
    if thumbnail and thumbnail.s3_key:
        return get_org_media_url(thumbnail.s3_key, organization_id=str(media.organization_id))
    # A missing thumbnail is not a reason to serve the master into a
    # thumbnail slot; drop to a smaller rendition or show nothing.
    if media.media_type == "image":
        from app.serializers.media import _display_key_for_image

        key = _display_key_for_image(media, db) or media.thumbnail_s3_key
        if key:
            return get_org_media_url(key, organization_id=str(media.organization_id))
    return None


def _serialize_workspace_summary(db: Session, workspace: MediaWorkspace, user_id: UUID) -> dict:
    """Serialize workspace for list view."""
    # Counts dynamic results too — pinned-only counts misreport workspaces
    # whose contents are driven by a saved query.
    asset_count = count_dynamic_media_workspace_total(workspace, workspace.organization_id, db)

    cover_thumbnail_url = None
    if workspace.cover_media:
        cover_thumbnail_url = _get_media_thumbnail_url(db, workspace.cover_media)
    elif asset_count > 0:
        first_item = db.query(MediaWorkspaceItem).filter(
            MediaWorkspaceItem.workspace_id == workspace.workspace_id
        ).order_by(MediaWorkspaceItem.sort_order).first()
        if first_item and first_item.media:
            cover_thumbnail_url = _get_media_thumbnail_url(db, first_item.media)

    return {
        "workspace_id": str(workspace.workspace_id),
        "name": workspace.name,
        "description": workspace.description,
        "visibility": workspace.visibility,
        "owner_user_id": str(workspace.owner_user_id),
        "owner_name": workspace.owner.display_name if workspace.owner else None,
        "is_owner": workspace.owner_user_id == user_id,
        "asset_count": asset_count,
        "cover_thumbnail_url": cover_thumbnail_url,
        "created_at": workspace.created_at.isoformat(),
        "updated_at": workspace.updated_at.isoformat(),
    }


def _serialize_workspace_item(db: Session, item: MediaWorkspaceItem) -> dict:
    """Serialize a workspace item with media details."""
    media = item.media
    return {
        "workspace_item_id": str(item.workspace_item_id),
        "media_id": str(item.media_id),
        "filename": media.filename if media else None,
        "title": media.title if media else None,
        "thumbnail_url": _get_media_thumbnail_url(db, media) if media else None,
        "media_type": media.media_type if media else None,
        "mime_type": media.mime_type if media else None,
        "width": media.width if media else None,
        "height": media.height if media else None,
        "file_size": media.file_size if media else None,
        "note": item.note,
        "sort_order": item.sort_order,
        "added_at": item.added_at.isoformat(),
        "copyright_status": media.copyright_status if media else None,
        "rights_statement": media.rights_statement if media else None,
    }


def _load_workspace_media(
    db: Session,
    workspace: MediaWorkspace,
    org_id: UUID,
    media_ids_filter: list[UUID] | None = None,
) -> list[Media]:
    """
    Load Media rows for every asset in a workspace, including dynamic results.

    Bulk-action endpoints (preview/validate/execute) used to query
    MediaWorkspaceItem directly, which silently skipped dynamic items. This
    helper resolves the effective contents (pinned + dynamic) and returns
    the Media rows in a single bulk fetch, optionally filtered to a
    subset of media IDs supplied by the client.
    """
    all_ids = resolve_dynamic_media_workspace_media_ids(workspace, org_id, db)
    if media_ids_filter is not None:
        wanted = set(media_ids_filter)
        all_ids = [mid for mid in all_ids if mid in wanted]
    if not all_ids:
        return []
    rows = (
        db.query(Media)
        .filter(Media.media_id.in_(all_ids))
        .all()
    )
    # Preserve resolver order (pinned first, then dynamic)
    by_id = {row.media_id: row for row in rows}
    return [by_id[mid] for mid in all_ids if mid in by_id]


def _get_workspace_or_404(db: Session, org_id: UUID, ws_id: UUID) -> MediaWorkspace:
    workspace = db.query(MediaWorkspace).filter(
        MediaWorkspace.workspace_id == ws_id,
        MediaWorkspace.organization_id == org_id,
        MediaWorkspace.workspace_type == 'media',
        MediaWorkspace.is_deleted == False,  # noqa: E712
    ).first()
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return workspace


# Available DAM bulk actions
DAM_BULK_ACTIONS = {
    "download_assets": {
        "key": "download_assets",
        "label": "Download Assets",
        "description": "Generate download links for selected assets",
        "required_params": [],
        "optional_params": ["derivative_type"],
        "is_async": False,
        "requires_permission": "execute",
        "category": "sharing",
    },
    "bulk_tag": {
        "key": "bulk_tag",
        "label": "Add/Remove Tags",
        "description": "Add, remove, or replace tag values on selected assets (structured tags)",
        "required_params": ["definition_id", "mode"],
        # value_ids: UUIDs of MediaTagValue rows (controlled types)
        # values:    raw strings (text/date/dynamic_keywords auto-create)
        # mode:      "append" | "remove" | "replace"
        "optional_params": ["value_ids", "values"],
        "is_async": False,
        "requires_permission": "execute",
        "category": "metadata",
    },
    "move_to_folder": {
        "key": "move_to_folder",
        "label": "Move to Folder",
        "description": "Move selected assets to a folder",
        "required_params": ["folder_id"],
        "optional_params": [],
        "is_async": False,
        "requires_permission": "execute",
        "category": "organization",
    },
    "add_to_lightbox": {
        "key": "add_to_lightbox",
        "label": "Add to Lightbox",
        "description": "Add selected assets to a lightbox (workspace) for sharing",
        "required_params": ["target_workspace_id"],
        "optional_params": ["note"],
        "is_async": False,
        "requires_permission": "execute",
        "category": "sharing",
    },
    "apply_metadata_template": {
        "key": "apply_metadata_template",
        "label": "Apply Metadata Template",
        "description": "Apply a metadata template to selected assets",
        "required_params": ["template_id"],
        "optional_params": ["overwrite_existing"],
        "is_async": False,
        "requires_permission": "execute",
        "category": "metadata",
    },
    "set_rights_policy": {
        "key": "set_rights_policy",
        "label": "Set Rights Policy",
        "description": "Set rights and restrictions on selected assets",
        "required_params": [],
        "optional_params": ["rights_statement", "license", "copyright_status"],
        "is_async": False,
        "requires_permission": "execute",
        "category": "rights",
    },
    "create_renditions": {
        "key": "create_renditions",
        "label": "Create Renditions",
        "description": "Generate derivatives for selected assets",
        "required_params": ["derivative_configs"],
        "optional_params": [],
        "is_async": True,
        "requires_permission": "execute",
        "category": "processing",
    },
}


# ============================================================================
# WORKSPACE CRUD
# ============================================================================


@router.get("/api/organizations/{org_id}/media/workspaces", summary="List media workspaces")
def list_media_workspaces(
    request: Request,
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_WORKSPACES_VIEW)),
    db: Session = Depends(get_db),
):
    """List DAM workspaces visible to the current user."""
    filter = request.query_params.get("filter", "all")
    search = request.query_params.get("search", "").strip()
    limit = int(request.query_params.get("limit", "50"))
    offset = int(request.query_params.get("offset", "0"))
    user_id = auth.user_id

    query = db.query(MediaWorkspace).filter(
        MediaWorkspace.organization_id == org_id,
        MediaWorkspace.is_deleted == False,  # noqa: E712
        MediaWorkspace.workspace_type == 'media',
    )

    visibility_conditions = []
    if filter in ("all", "owned"):
        visibility_conditions.append(MediaWorkspace.owner_user_id == user_id)
    if filter in ("all", "shared"):
        shared_workspace_ids = db.query(MediaWorkspaceShare.workspace_id).filter(
            MediaWorkspaceShare.organization_id == org_id,
            MediaWorkspaceShare.principal_type == "user",
            MediaWorkspaceShare.principal_id == user_id,
        ).subquery()
        visibility_conditions.append(MediaWorkspace.workspace_id.in_(shared_workspace_ids))
        visibility_conditions.append(MediaWorkspace.visibility == "org")

    if visibility_conditions:
        query = query.filter(or_(*visibility_conditions))

    if search:
        query = query.filter(MediaWorkspace.name.ilike(f"%{escape_ilike(search)}%", escape="\\"))

    total = query.count()
    query = query.order_by(MediaWorkspace.updated_at.desc())
    query = query.offset(offset).limit(limit)
    workspaces = query.all()

    results = [_serialize_workspace_summary(db, ws, user_id) for ws in workspaces]

    return {
        "items": results,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("/api/organizations/{org_id}/media/workspaces", response_model=WorkspaceCreatedResponse, status_code=201, summary="Create dam workspace")
def create_dam_workspace(
    org_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_WORKSPACES_CREATE)),
    db: Session = Depends(get_db),
):
    """Create a new DAM workspace."""
    user_id = auth.user_id

    name = body.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="Name is required")

    visibility = body.get("visibility", "private")
    if visibility not in ("private", "shared", "org"):
        raise HTTPException(status_code=400, detail="Invalid visibility value")

    workspace = MediaWorkspace(
        organization_id=org_id,
        owner_user_id=user_id,
        workspace_type='media',
        name=name,
        description=body.get("description"),
        visibility=visibility,
    )
    db.add(workspace)
    db.flush()

    media_ids = body.get("media_ids", [])
    added_count = 0
    for media_id_str in media_ids:
        try:
            media_id = UUID(media_id_str)
            media = db.query(Media).filter(
                Media.media_id == media_id,
                Media.organization_id == org_id,
            ).first()
            if media:
                item = MediaWorkspaceItem(
                    workspace_id=workspace.workspace_id,
                    media_id=media_id,
                    added_by_user_id=user_id,
                    sort_order=added_count,
                )
                db.add(item)
                added_count += 1
        except (ValueError, TypeError):
            continue

    db.commit()

    return {
        "workspace_id": str(workspace.workspace_id),
        "name": workspace.name,
        "description": workspace.description,
        "visibility": workspace.visibility,
        "asset_count": added_count,
        "created_at": workspace.created_at.isoformat(),
    }


@router.get("/api/organizations/{org_id}/media/workspaces/{workspace_id}", response_model=WorkspaceDetailResponse, summary="Get dam workspace")
def get_dam_workspace(
    org_id: UUID,
    workspace_id: UUID,
    page: int = Query(1),
    page_size: int = Query(50, le=100),
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_WORKSPACES_VIEW)),
    db: Session = Depends(get_db),
):
    """Get DAM workspace details including items with pagination."""
    user_id = auth.user_id
    workspace = _get_workspace_or_404(db, org_id, workspace_id)

    if not _can_access_workspace(db, workspace, user_id, org_id):
        raise HTTPException(status_code=403, detail="Access denied")

    item_offset = (page - 1) * page_size

    items_query = db.query(MediaWorkspaceItem).filter(
        MediaWorkspaceItem.workspace_id == workspace_id
    ).options(joinedload(MediaWorkspaceItem.media))

    # asset_count needs to include dynamic results; the paginated items
    # listing here still only returns pinned rows by design (dynamic
    # resolution lives in get_dam_workspace_items).
    total_items = count_dynamic_media_workspace_total(workspace, org_id, db)
    items_list = items_query.order_by(MediaWorkspaceItem.sort_order).offset(item_offset).limit(page_size).all()

    items = [_serialize_workspace_item(db, item) for item in items_list]

    permission_level = _get_user_permission_level(db, workspace, user_id)

    cover_thumbnail_url = None
    if workspace.cover_media:
        cover_thumbnail_url = _get_media_thumbnail_url(db, workspace.cover_media)
    elif items:
        cover_thumbnail_url = items[0].get("thumbnail_url")

    return {
        "workspace_id": str(workspace.workspace_id),
        "name": workspace.name,
        "description": workspace.description,
        "visibility": workspace.visibility,
        "owner_user_id": str(workspace.owner_user_id),
        "owner_name": workspace.owner.display_name if workspace.owner else None,
        "is_owner": workspace.owner_user_id == user_id,
        "permission_level": permission_level,
        "asset_count": total_items,
        "cover_thumbnail_url": cover_thumbnail_url,
        "items": items,
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total": total_items,
            "total_pages": (total_items + page_size - 1) // page_size if page_size > 0 else 0,
        },
        "created_at": workspace.created_at.isoformat(),
        "updated_at": workspace.updated_at.isoformat(),
    }


@router.patch("/api/organizations/{org_id}/media/workspaces/{workspace_id}", response_model=WorkspaceUpdatedResponse, summary="Update dam workspace")
def update_dam_workspace(
    org_id: UUID,
    workspace_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_WORKSPACES_EDIT)),
    db: Session = Depends(get_db),
):
    """Update DAM workspace details."""
    user_id = auth.user_id
    workspace = _get_workspace_or_404(db, org_id, workspace_id)

    permission_level = _get_user_permission_level(db, workspace, user_id)
    if permission_level not in ("admin", "edit") and workspace.owner_user_id != user_id:
        raise HTTPException(status_code=403, detail="Permission denied")

    if "name" in body:
        name = body["name"].strip()
        if not name:
            raise HTTPException(status_code=422, detail="Name cannot be empty")
        workspace.name = name

    if "description" in body:
        workspace.description = body["description"]

    if "visibility" in body:
        if workspace.owner_user_id != user_id and permission_level != "admin":
            raise HTTPException(status_code=403, detail="Only owner can change visibility")
        if body["visibility"] not in ("private", "shared", "org"):
            raise HTTPException(status_code=400, detail="Invalid visibility value")
        workspace.visibility = body["visibility"]

    if "cover_media_id" in body:
        if body["cover_media_id"]:
            cover_id = UUID(body["cover_media_id"])
            item = db.query(MediaWorkspaceItem).filter(
                MediaWorkspaceItem.workspace_id == workspace_id,
                MediaWorkspaceItem.media_id == cover_id,
            ).first()
            if item:
                workspace.cover_media_id = cover_id
        else:
            workspace.cover_media_id = None

    workspace.updated_at = datetime.now(timezone.utc)
    db.commit()

    return {
        "workspace_id": str(workspace.workspace_id),
        "name": workspace.name,
        "description": workspace.description,
        "visibility": workspace.visibility,
        "updated_at": workspace.updated_at.isoformat(),
    }


@router.delete("/api/organizations/{org_id}/media/workspaces/{workspace_id}", response_model=SuccessMessageResponse, summary="Delete dam workspace")
def delete_dam_workspace(
    org_id: UUID,
    workspace_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_WORKSPACES_DELETE)),
    db: Session = Depends(get_db),
):
    """Soft-delete a DAM workspace (owner only)."""
    user_id = auth.user_id
    workspace = _get_workspace_or_404(db, org_id, workspace_id)

    if workspace.owner_user_id != user_id:
        raise HTTPException(status_code=403, detail="Only owner can delete workspace")

    workspace.is_deleted = True
    workspace.deleted_at = datetime.now(timezone.utc)
    workspace.deleted_by = user_id
    db.commit()

    return {"success": True, "message": "Workspace deleted"}


# ============================================================================
# WORKSPACE ITEMS
# ============================================================================


@router.get("/api/organizations/{org_id}/media/workspaces/{workspace_id}/items", summary="List dam workspace items")
def list_dam_workspace_items(
    org_id: UUID,
    workspace_id: UUID,
    limit: int = Query(100, le=500),
    offset: int = Query(0),
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_WORKSPACES_VIEW)),
    db: Session = Depends(get_db),
):
    """List items in a DAM workspace."""
    user_id = auth.user_id
    workspace = _get_workspace_or_404(db, org_id, workspace_id)

    if not _can_access_workspace(db, workspace, user_id, org_id):
        raise HTTPException(status_code=403, detail="Access denied")

    # Dynamic media workspace — resolve pinned + live MediaSearchRequest results
    if workspace.is_dynamic:
        from app.services.dynamic_media_workspace import resolve_dynamic_media_items
        resolved = resolve_dynamic_media_items(
            workspace, org_id, db, limit=limit, offset=offset
        )
        return {
            "items": resolved["items"],
            "total": resolved["total"],
            "pinned_count": resolved["pinned_count"],
            "dynamic_count": resolved["dynamic_count"],
            "search_unavailable": resolved["search_unavailable"],
            "limit": limit,
            "offset": offset,
        }

    query = db.query(MediaWorkspaceItem).filter(
        MediaWorkspaceItem.workspace_id == workspace_id
    ).options(joinedload(MediaWorkspaceItem.media))

    total = query.count()
    items_list = query.order_by(MediaWorkspaceItem.sort_order).offset(offset).limit(limit).all()

    items = []
    for item in items_list:
        media = item.media
        items.append({
            "workspace_item_id": str(item.workspace_item_id),
            "media_id": str(item.media_id),
            "filename": media.filename if media else None,
            "title": media.title if media else None,
            "thumbnail_url": _get_media_thumbnail_url(db, media) if media else None,
            "media_type": media.media_type if media else None,
            "mime_type": media.mime_type if media else None,
            "width": media.width if media else None,
            "height": media.height if media else None,
            "file_size": media.file_size if media else None,
            "copyright_status": media.copyright_status if media else None,
            "rights_statement": media.rights_statement if media else None,
            "note": item.note,
            "sort_order": item.sort_order,
            "added_at": item.added_at.isoformat() if item.added_at else None,
        })

    return {
        "items": items,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("/api/organizations/{org_id}/media/workspaces/{workspace_id}/items", response_model=WorkspaceItemsAddedResponse, summary="Add dam workspace items")
def add_dam_workspace_items(
    org_id: UUID,
    workspace_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_WORKSPACES_EDIT)),
    db: Session = Depends(get_db),
):
    """Add assets to a DAM workspace."""
    user_id = auth.user_id
    workspace = _get_workspace_or_404(db, org_id, workspace_id)

    permission_level = _get_user_permission_level(db, workspace, user_id)
    if permission_level not in ("admin", "edit") and workspace.owner_user_id != user_id:
        raise HTTPException(status_code=403, detail="Permission denied")

    media_ids = body.get("media_ids", [])
    if not media_ids:
        raise HTTPException(status_code=400, detail="No media IDs provided")

    max_sort = db.query(func.max(MediaWorkspaceItem.sort_order)).filter(
        MediaWorkspaceItem.workspace_id == workspace_id
    ).scalar() or 0

    added = []
    skipped = []
    for media_id_str in media_ids:
        try:
            media_id = UUID(media_id_str)

            existing = db.query(MediaWorkspaceItem).filter(
                MediaWorkspaceItem.workspace_id == workspace_id,
                MediaWorkspaceItem.media_id == media_id,
            ).first()
            if existing:
                skipped.append(media_id_str)
                continue

            media = db.query(Media).filter(
                Media.media_id == media_id,
                Media.organization_id == org_id,
            ).first()
            if not media:
                skipped.append(media_id_str)
                continue

            max_sort += 1
            item = MediaWorkspaceItem(
                workspace_id=workspace_id,
                media_id=media_id,
                added_by_user_id=user_id,
                sort_order=max_sort,
            )
            db.add(item)
            added.append(media_id_str)

        except (ValueError, TypeError):
            skipped.append(media_id_str)

    workspace.updated_at = datetime.now(timezone.utc)
    db.commit()

    return {
        "added": added,
        "skipped": skipped,
        "added_count": len(added),
    }


@router.delete("/api/organizations/{org_id}/media/workspaces/{workspace_id}/items", response_model=WorkspaceItemsRemovedResponse, summary="Remove dam workspace items")
def remove_dam_workspace_items(
    org_id: UUID,
    workspace_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_WORKSPACES_EDIT)),
    db: Session = Depends(get_db),
):
    """Remove assets from a DAM workspace."""
    user_id = auth.user_id
    workspace = _get_workspace_or_404(db, org_id, workspace_id)

    permission_level = _get_user_permission_level(db, workspace, user_id)
    if permission_level not in ("admin", "edit") and workspace.owner_user_id != user_id:
        raise HTTPException(status_code=403, detail="Permission denied")

    media_ids = body.get("media_ids", [])
    if not media_ids:
        raise HTTPException(status_code=400, detail="No media IDs provided")

    removed_count = 0
    for media_id_str in media_ids:
        try:
            media_id = UUID(media_id_str)
            item = db.query(MediaWorkspaceItem).filter(
                MediaWorkspaceItem.workspace_id == workspace_id,
                MediaWorkspaceItem.media_id == media_id,
            ).first()
            if item:
                db.delete(item)
                removed_count += 1
        except (ValueError, TypeError):
            continue

    workspace.updated_at = datetime.now(timezone.utc)
    db.commit()

    return {"removed_count": removed_count}


@router.post("/api/organizations/{org_id}/media/workspaces/{workspace_id}/items/reorder", response_model=SuccessMessageResponse, summary="Reorder dam workspace items")
def reorder_dam_workspace_items(
    org_id: UUID,
    workspace_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_WORKSPACES_EDIT)),
    db: Session = Depends(get_db),
):
    """Reorder items in a DAM workspace."""
    user_id = auth.user_id
    workspace = _get_workspace_or_404(db, org_id, workspace_id)

    permission_level = _get_user_permission_level(db, workspace, user_id)
    if permission_level not in ("admin", "edit") and workspace.owner_user_id != user_id:
        raise HTTPException(status_code=403, detail="Permission denied")

    item_ids = body.get("item_ids", [])
    if not item_ids:
        raise HTTPException(status_code=400, detail="No item IDs provided")

    for idx, item_id_str in enumerate(item_ids):
        try:
            item_id = UUID(item_id_str)
            item = db.query(MediaWorkspaceItem).filter(
                MediaWorkspaceItem.workspace_item_id == item_id,
                MediaWorkspaceItem.workspace_id == workspace_id,
            ).first()
            if item:
                item.sort_order = idx
        except (ValueError, TypeError):
            continue

    workspace.updated_at = datetime.now(timezone.utc)
    db.commit()

    return {"success": True, "message": "Items reordered"}


# ============================================================================
# SHARING
# ============================================================================


@router.get("/api/organizations/{org_id}/media/workspaces/{workspace_id}/shares", response_model=WorkspaceShareListResponse, summary="List dam workspace shares")
def list_dam_workspace_shares(
    org_id: UUID,
    workspace_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_WORKSPACES_VIEW)),
    db: Session = Depends(get_db),
):
    """List shares for a DAM workspace."""
    user_id = auth.user_id
    workspace = _get_workspace_or_404(db, org_id, workspace_id)

    permission_level = _get_user_permission_level(db, workspace, user_id)
    if permission_level != "admin" and workspace.owner_user_id != user_id:
        raise HTTPException(status_code=403, detail="Permission denied")

    shares = db.query(MediaWorkspaceShare).filter(
        MediaWorkspaceShare.workspace_id == workspace_id
    ).all()

    result = []
    for share in shares:
        user = None
        if share.principal_type == "user":
            user = db.query(User).filter(User.user_id == share.principal_id).first()

        result.append({
            "share_id": str(share.share_id),
            "principal_type": share.principal_type,
            "principal_id": str(share.principal_id),
            "principal_name": user.display_name if user else None,
            "principal_email": user.email if user else None,
            "permission": share.permission,
            "created_at": share.created_at.isoformat(),
        })

    return {"shares": result}


@router.post("/api/organizations/{org_id}/media/workspaces/{workspace_id}/shares", response_model=WorkspaceShareCreatedResponse, status_code=201, summary="Create dam workspace share")
def create_dam_workspace_share(
    org_id: UUID,
    workspace_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_WORKSPACES_SHARE)),
    db: Session = Depends(get_db),
):
    """Share a DAM workspace with a user."""
    user_id = auth.user_id
    workspace = _get_workspace_or_404(db, org_id, workspace_id)

    permission_level = _get_user_permission_level(db, workspace, user_id)
    if permission_level != "admin" and workspace.owner_user_id != user_id:
        raise HTTPException(status_code=403, detail="Permission denied")

    target_user_id = body.get("user_id")
    permission = body.get("permission", "view")

    if not target_user_id:
        raise HTTPException(status_code=422, detail="user_id is required")

    if permission not in ("view", "edit", "execute", "admin"):
        raise HTTPException(status_code=400, detail="Invalid permission value")

    target_user_uuid = UUID(target_user_id)

    existing = db.query(MediaWorkspaceShare).filter(
        MediaWorkspaceShare.workspace_id == workspace_id,
        MediaWorkspaceShare.principal_type == "user",
        MediaWorkspaceShare.principal_id == target_user_uuid,
    ).first()

    if existing:
        existing.permission = permission
        share = existing
    else:
        share = MediaWorkspaceShare(
            workspace_id=workspace_id,
            organization_id=org_id,
            principal_type="user",
            principal_id=target_user_uuid,
            permission=permission,
            created_by=user_id,
        )
        db.add(share)

    if workspace.visibility == "private":
        workspace.visibility = "shared"

    workspace.updated_at = datetime.now(timezone.utc)
    db.commit()

    return {
        "share_id": str(share.share_id),
        "permission": share.permission,
        "created_at": share.created_at.isoformat(),
    }


@router.delete("/api/organizations/{org_id}/media/workspaces/{workspace_id}/shares/{share_id}", response_model=SuccessMessageResponse, summary="Delete dam workspace share")
def delete_dam_workspace_share(
    org_id: UUID,
    workspace_id: UUID,
    share_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_WORKSPACES_SHARE)),
    db: Session = Depends(get_db),
):
    """Remove a share from a DAM workspace."""
    user_id = auth.user_id
    workspace = _get_workspace_or_404(db, org_id, workspace_id)

    permission_level = _get_user_permission_level(db, workspace, user_id)
    if permission_level != "admin" and workspace.owner_user_id != user_id:
        raise HTTPException(status_code=403, detail="Permission denied")

    share = db.query(MediaWorkspaceShare).filter(
        MediaWorkspaceShare.share_id == share_id,
        MediaWorkspaceShare.workspace_id == workspace_id,
    ).first()

    if not share:
        raise HTTPException(status_code=404, detail="Share not found")

    db.delete(share)
    # Force the delete to flush before counting so we don't include the
    # row we just removed in the "remaining shares" count. The default
    # session config disables autoflush, so a count() right after delete()
    # would otherwise still see the share.
    db.flush()

    remaining = db.query(MediaWorkspaceShare).filter(
        MediaWorkspaceShare.workspace_id == workspace_id
    ).count()

    if remaining == 0 and workspace.visibility == "shared":
        workspace.visibility = "private"

    workspace.updated_at = datetime.now(timezone.utc)
    db.commit()

    return {"success": True, "message": "Share removed"}


# ============================================================================
# ACTIVE CONTEXT
# ============================================================================


@router.get("/api/organizations/{org_id}/dam/context", response_model=ActiveContextResponse, summary="Get dam context")
def get_dam_context(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """Get the user's current active DAM context."""
    user_id = auth.user_id

    context = db.query(UserActiveContext).filter(
        UserActiveContext.user_id == user_id,
        UserActiveContext.app == "media",
        UserActiveContext.organization_id == org_id,
    ).first()

    if not context or not context.context_type:
        return {"context": None}

    # Translate internal DB value to API contract
    api_type = "media_workspace" if context.context_type == "dam_workspace" else context.context_type

    result = {
        "type": api_type,
        "id": str(context.context_id) if context.context_id else None,
        "set_at": context.set_at.isoformat() if context.set_at else None,
    }

    if context.context_type == "dam_workspace" and context.context_id:
        workspace = db.query(MediaWorkspace).filter(
            MediaWorkspace.workspace_id == context.context_id,
            MediaWorkspace.is_deleted == False,  # noqa: E712
        ).first()
        if workspace:
            asset_count = count_dynamic_media_workspace_total(workspace, org_id, db)
            result["workspace"] = {
                "workspace_id": str(workspace.workspace_id),
                "name": workspace.name,
                "asset_count": asset_count,
            }

    elif context.context_type == "asset" and context.context_id:
        media = db.query(Media).filter(
            Media.media_id == context.context_id,
        ).first()
        if media:
            result["asset"] = {
                "media_id": str(media.media_id),
                "filename": media.filename,
                "title": media.title,
                "thumbnail_url": _get_media_thumbnail_url(db, media),
            }

    return {"context": result}


@router.post("/api/organizations/{org_id}/dam/context/workspace/{workspace_id}", response_model=ActiveContextResponse, summary="Set dam workspace context")
def set_dam_workspace_context(
    org_id: UUID,
    workspace_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_WORKSPACES_VIEW)),
    db: Session = Depends(get_db),
):
    """Set a DAM workspace as the active context."""
    user_id = auth.user_id
    workspace = _get_workspace_or_404(db, org_id, workspace_id)

    if not _can_access_workspace(db, workspace, user_id, org_id):
        raise HTTPException(status_code=403, detail="Access denied")

    context = db.query(UserActiveContext).filter(
        UserActiveContext.user_id == user_id,
        UserActiveContext.app == "media",
    ).first()

    if context:
        context.organization_id = org_id
        context.context_type = "dam_workspace"
        context.context_id = workspace_id
        context.set_at = datetime.now(timezone.utc)
    else:
        context = UserActiveContext(
            user_id=user_id,
            app="media",
            organization_id=org_id,
            context_type="dam_workspace",
            context_id=workspace_id,
        )
        db.add(context)

    db.commit()

    asset_count = count_dynamic_media_workspace_total(workspace, org_id, db)

    return {
        "context": {
            "type": "media_workspace",
            "id": str(workspace_id),
            "set_at": context.set_at.isoformat(),
            "workspace": {
                "workspace_id": str(workspace.workspace_id),
                "name": workspace.name,
                "asset_count": asset_count,
            },
        }
    }


@router.post("/api/organizations/{org_id}/dam/context/asset/{media_id}", response_model=ActiveContextResponse, summary="Set dam asset context")
def set_dam_asset_context(
    org_id: UUID,
    media_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """Set a media asset as the active context."""
    user_id = auth.user_id

    media = db.query(Media).filter(
        Media.media_id == media_id,
        Media.organization_id == org_id,
    ).first()

    if not media:
        raise HTTPException(status_code=404, detail="Media not found")

    context = db.query(UserActiveContext).filter(
        UserActiveContext.user_id == user_id,
        UserActiveContext.app == "media",
    ).first()

    if context:
        context.organization_id = org_id
        context.context_type = "asset"
        context.context_id = media_id
        context.set_at = datetime.now(timezone.utc)
    else:
        context = UserActiveContext(
            user_id=user_id,
            app="media",
            organization_id=org_id,
            context_type="asset",
            context_id=media_id,
        )
        db.add(context)

    db.commit()

    return {
        "context": {
            "type": "asset",
            "id": str(media_id),
            "set_at": context.set_at.isoformat(),
            "asset": {
                "media_id": str(media.media_id),
                "filename": media.filename,
                "title": media.title,
                "thumbnail_url": _get_media_thumbnail_url(db, media),
            },
        }
    }


@router.delete("/api/organizations/{org_id}/dam/context", response_model=SuccessMessageResponse, summary="Clear dam context")
def clear_dam_context(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """Clear the user's active DAM context."""
    user_id = auth.user_id

    context = db.query(UserActiveContext).filter(
        UserActiveContext.user_id == user_id,
        UserActiveContext.app == "media",
    ).first()

    if context:
        context.context_type = None
        context.context_id = None
        context.set_at = datetime.now(timezone.utc)
        db.commit()

    return {"success": True, "message": "Context cleared"}


# ============================================================================
# BULK ACTIONS
# ============================================================================


@router.get("/api/organizations/{org_id}/media/workspaces/{workspace_id}/actions", response_model=BulkActionsListResponse, summary="List dam workspace actions")
def list_dam_workspace_actions(
    org_id: UUID,
    workspace_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_WORKSPACES_VIEW)),
    db: Session = Depends(get_db),
):
    """List available bulk actions for a DAM workspace."""
    user_id = auth.user_id
    workspace = _get_workspace_or_404(db, org_id, workspace_id)

    if not _can_access_workspace(db, workspace, user_id, org_id):
        raise HTTPException(status_code=403, detail="Access denied")

    permission_level = _get_user_permission_level(db, workspace, user_id)

    available_derivatives = db.query(
        MediaDerivative.derivative_type
    ).join(
        MediaWorkspaceItem,
        MediaWorkspaceItem.media_id == MediaDerivative.media_id
    ).filter(
        MediaWorkspaceItem.workspace_id == workspace_id,
        MediaDerivative.organization_id == org_id
    ).distinct().all()

    derivative_types = sorted([d[0] for d in available_derivatives])

    derivative_labels = {
        "original": "Original Files",
        "access_master": "Access Master",
        "large": "Large (2000px)",
        "medium": "Medium (1200px)",
        "small": "Small (600px)",
        "thumbnail": "Thumbnail (200px)",
        "square_thumb": "Square Thumbnail",
        "poster": "Poster",
        "preview": "Preview",
        "web": "Web Optimized",
        "tile": "Deep Zoom Tiles",
    }

    available_actions = []
    for action_key, action_config in DAM_BULK_ACTIONS.items():
        required_perm = action_config.get("requires_permission", "execute")
        if _has_sufficient_permission(permission_level, required_perm):
            action_data = dict(action_config)
            if action_key == "download_assets":
                download_options = [{"value": "original", "label": "Original Files"}]
                for dt in derivative_types:
                    download_options.append({
                        "value": dt,
                        "label": derivative_labels.get(dt, dt.replace("_", " ").title())
                    })
                action_data["download_options"] = download_options
            available_actions.append(action_data)

    return {"actions": available_actions}


@router.post("/api/organizations/{org_id}/media/workspaces/{workspace_id}/actions/{action}/preview", response_model=BulkActionPreviewResponse, summary="Preview dam workspace action")
def preview_dam_workspace_action(
    org_id: UUID,
    workspace_id: UUID,
    action: str,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_WORKSPACES_EXECUTE)),
    db: Session = Depends(get_db),
):
    """Preview a bulk action on a DAM workspace."""
    user_id = auth.user_id

    if action not in DAM_BULK_ACTIONS:
        raise HTTPException(status_code=400, detail="Invalid action")

    workspace = _get_workspace_or_404(db, org_id, workspace_id)

    if not _can_access_workspace(db, workspace, user_id, org_id):
        raise HTTPException(status_code=403, detail="Access denied")

    # Includes dynamic results, not just pinned items.
    media_rows = _load_workspace_media(db, workspace, org_id)

    action_params = body.get("action_params", {})

    preview_items = []
    total_size = 0
    warnings = []

    for media in media_rows:
        item_warnings = []

        if action == "download_assets":
            total_size += media.file_size or 0
            if media.copyright_status in (
                "rights_reserved",
                "in_copyright",
                "orphan_work",
                "copyright_undetermined",
            ):
                item_warnings.append("Rights restrictions may apply")

        if action == "set_rights_policy":
            if media.copyright_status and action_params.get("copyright_status"):
                item_warnings.append("Existing rights will be overwritten")

        preview_items.append({
            "media_id": str(media.media_id),
            "filename": media.filename,
            "title": media.title,
            "thumbnail_url": _get_media_thumbnail_url(db, media),
            "file_size": media.file_size,
            "mime_type": media.mime_type,
            "warnings": item_warnings,
        })

    if action == "download_assets" and total_size > 100 * 1024 * 1024:
        size_mb = total_size / (1024 * 1024)
        warnings.append(f"Total download size is {size_mb:.0f} MB")

    action_config = DAM_BULK_ACTIONS.get(action, {})
    has_warnings = len(warnings) > 0 or any(item.get("warnings") for item in preview_items)

    return {
        "action": action,
        "action_label": action_config.get("label", action),
        "workspace_id": str(workspace_id),
        "workspace_name": workspace.name,
        "assets": preview_items,
        "total_count": len(preview_items),
        "has_warnings": has_warnings,
        "total_size_bytes": total_size if action == "download_assets" else None,
        "warnings": warnings,
    }


@router.post("/api/organizations/{org_id}/media/workspaces/{workspace_id}/actions/{action}/validate", response_model=BulkActionValidateResponse, summary="Validate dam workspace action")
def validate_dam_workspace_action(
    org_id: UUID,
    workspace_id: UUID,
    action: str,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_WORKSPACES_EXECUTE)),
    db: Session = Depends(get_db),
):
    """Validate a bulk action on a DAM workspace."""
    user_id = auth.user_id

    if action not in DAM_BULK_ACTIONS:
        raise HTTPException(status_code=400, detail="Invalid action")

    action_config = DAM_BULK_ACTIONS[action]
    action_params = body.get("action_params", {})

    for param in action_config.get("required_params", []):
        if param not in action_params:
            raise HTTPException(status_code=422, detail=f"Missing required parameter: {param}")

    # Validate apply_metadata_template: check template exists
    if action == "apply_metadata_template":
        try:
            template_id = UUID(action_params.get("template_id"))
            template_for_validation = db.query(MetadataTemplate).filter(
                MetadataTemplate.template_id == template_id,
                MetadataTemplate.organization_id == org_id,
                MetadataTemplate.is_active == True,  # noqa: E712
            ).first()
            if not template_for_validation:
                return {
                    "action": action,
                    "action_valid": False,
                    "allowed": [],
                    "blocked": [],
                    "allowed_count": 0,
                    "blocked_count": 0,
                    "error": "Template not found or inactive",
                }
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="Invalid template_id")

    workspace = _get_workspace_or_404(db, org_id, workspace_id)

    if not _can_access_workspace(db, workspace, user_id, org_id):
        raise HTTPException(status_code=403, detail="Access denied")

    media_ids_raw = body.get("media_ids")
    media_ids_filter = (
        [UUID(m) for m in media_ids_raw] if media_ids_raw else None
    )
    # Includes dynamic results, not just pinned items.
    media_rows = _load_workspace_media(db, workspace, org_id, media_ids_filter)

    allowed = []
    blocked = []

    for media in media_rows:
        block_reason = None
        block_code = None

        if action == "download_assets":
            # Block download for media whose rights state forbids redistribution.
            # The valid enum values come from check_media_copyright_status; the
            # historical "restricted" string was never a real enum member.
            if media.copyright_status in (
                "rights_reserved",
                "in_copyright",
                "orphan_work",
                "copyright_undetermined",
            ):
                block_reason = "Download restricted by rights policy"
                block_code = "RIGHTS_RESTRICTED"

        if block_reason:
            blocked.append({
                "media_id": str(media.media_id),
                "filename": media.filename,
                "title": media.title,
                "reason": block_reason,
                "code": block_code,
            })
        else:
            allowed.append({
                "media_id": str(media.media_id),
                "filename": media.filename,
                "title": media.title,
            })

    return {
        "action": action,
        "action_valid": len(allowed) > 0,
        "allowed": allowed,
        "blocked": blocked,
        "allowed_count": len(allowed),
        "blocked_count": len(blocked),
    }


@router.post("/api/organizations/{org_id}/media/workspaces/{workspace_id}/actions/{action}/execute", response_model=BulkActionExecuteResponse, summary="Execute dam workspace action")
def execute_dam_workspace_action(
    org_id: UUID,
    workspace_id: UUID,
    action: str,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_WORKSPACES_EXECUTE)),
    db: Session = Depends(get_db),
):
    """Execute a bulk action on a DAM workspace."""
    user_id = auth.user_id

    if action not in DAM_BULK_ACTIONS:
        raise HTTPException(status_code=400, detail="Invalid action")

    action_config = DAM_BULK_ACTIONS[action]
    action_params = body.get("action_params", {})

    workspace = _get_workspace_or_404(db, org_id, workspace_id)

    permission_level = _get_user_permission_level(db, workspace, user_id)
    if not _has_sufficient_permission(permission_level, "execute"):
        raise HTTPException(status_code=403, detail="Permission denied")

    media_ids_raw = body.get("media_ids")
    media_ids_filter = (
        [UUID(m) for m in media_ids_raw] if media_ids_raw else None
    )
    # Includes dynamic results, not just pinned items.
    media_rows = _load_workspace_media(db, workspace, org_id, media_ids_filter)

    # For async actions, create a run record
    if action_config.get("is_async"):
        run = MediaWorkspaceActionRun(
            workspace_id=workspace_id,
            organization_id=org_id,
            action_key=action,
            action_params=action_params,
            status="pending",
            total_items=len(media_rows),
            created_by=user_id,
        )
        db.add(run)
        db.commit()

        from app.tasks.media import execute_workspace_bulk_action_task
        execute_workspace_bulk_action_task.delay(
            run_id=str(run.run_id),
            organization_id=str(org_id),
            workspace_id=str(workspace_id),
            action=action,
            action_params=action_params,
            media_ids=[str(m.media_id) for m in media_rows],
            user_id=str(user_id),
        )

        return JSONResponse(status_code=202, content={
            "run_id": str(run.run_id),
            "action": action,
            "status": "pending",
            "total_count": len(media_rows),
            "workspace_id": str(workspace_id),
            "message": f"{action_config['label']} job queued. Use run_id to check progress.",
        })

    # Synchronous execution
    results = []
    succeeded = 0
    failed = 0

    for media in media_rows:

        try:
            if action == "bulk_tag":
                # Apply a structured-tag change to this asset.
                # Params (shared across all assets, resolved once above):
                #   definition_id: required
                #   mode:          "append" | "remove" | "replace"
                #   value_ids:     list[UUID]  (controlled types)
                #   values:        list[str]   (text/date/dynamic_keywords auto-create)
                from app.fastapi_app.routers.media_tags import (
                    _CONTROLLED_TYPES,
                    _resolve_value,
                )

                def_id_raw = action_params.get("definition_id")
                mode = (action_params.get("mode") or "append").lower()
                if not def_id_raw or mode not in ("append", "remove", "replace"):
                    raise ValueError("definition_id and mode (append|remove|replace) are required")

                def_uuid = UUID(def_id_raw)
                definition = db.query(MediaTagDefinition).filter(
                    MediaTagDefinition.definition_id == def_uuid,
                    MediaTagDefinition.organization_id == org_id,
                    MediaTagDefinition.is_active == True,  # noqa: E712
                ).first()
                if not definition:
                    raise ValueError("Tag definition not found")

                is_controlled = definition.field_type in _CONTROLLED_TYPES

                # Resolve incoming values once per asset. For dynamic_keywords
                # the auto_create path creates the node on first encounter; by
                # the time subsequent assets in the batch reach here, the node
                # exists and is reused.
                target_value_ids: list[UUID] = []
                target_texts: list[str] = []

                if is_controlled:
                    for vid in action_params.get("value_ids") or []:
                        try:
                            uid = UUID(str(vid))
                        except Exception:
                            continue
                        target_value_ids.append(uid)
                    for txt in action_params.get("values") or []:
                        node = _resolve_value(
                            db, definition,
                            value_id=None,
                            tag_value=txt,
                            user_id=user_id,
                            auto_create=(definition.field_type == "dynamic_keywords"),
                        )
                        if node is not None:
                            target_value_ids.append(node.value_id)
                    target_value_ids = list(dict.fromkeys(target_value_ids))  # dedupe, keep order
                else:
                    target_texts = [t for t in (action_params.get("values") or []) if (t or "").strip()]

                if mode == "replace":
                    db.query(MediaTag).filter(
                        MediaTag.media_id == media.media_id,
                        MediaTag.definition_id == def_uuid,
                    ).delete(synchronize_session=False)

                if mode in ("append", "replace"):
                    if is_controlled:
                        # Enforce single-value semantics when allow_multiple is False.
                        if not definition.allow_multiple and target_value_ids:
                            db.query(MediaTag).filter(
                                MediaTag.media_id == media.media_id,
                                MediaTag.definition_id == def_uuid,
                            ).delete(synchronize_session=False)
                            target_value_ids = [target_value_ids[0]]
                        # Existing values to skip (idempotent).
                        existing_value_ids = {
                            r[0] for r in db.query(MediaTag.value_id).filter(
                                MediaTag.media_id == media.media_id,
                                MediaTag.definition_id == def_uuid,
                                MediaTag.value_id.isnot(None),
                            ).all()
                        }
                        for vid in target_value_ids:
                            if vid in existing_value_ids:
                                continue
                            node = db.query(MediaTagValue).filter_by(value_id=vid).first()
                            if not node:
                                continue
                            db.add(MediaTag(
                                organization_id=org_id,
                                media_id=media.media_id,
                                definition_id=def_uuid,
                                value_id=vid,
                                tag_value=node.value,
                                created_by=user_id,
                            ))
                    else:
                        # text / date: single value only — pick first.
                        if target_texts:
                            db.query(MediaTag).filter(
                                MediaTag.media_id == media.media_id,
                                MediaTag.definition_id == def_uuid,
                            ).delete(synchronize_session=False)
                            db.add(MediaTag(
                                organization_id=org_id,
                                media_id=media.media_id,
                                definition_id=def_uuid,
                                tag_value=target_texts[0].strip(),
                                created_by=user_id,
                            ))

                elif mode == "remove":
                    if is_controlled and target_value_ids:
                        db.query(MediaTag).filter(
                            MediaTag.media_id == media.media_id,
                            MediaTag.definition_id == def_uuid,
                            MediaTag.value_id.in_(target_value_ids),
                        ).delete(synchronize_session=False)
                    elif not is_controlled:
                        # For text/date, remove means clear the single value regardless.
                        db.query(MediaTag).filter(
                            MediaTag.media_id == media.media_id,
                            MediaTag.definition_id == def_uuid,
                        ).delete(synchronize_session=False)

                results.append({
                    "media_id": str(media.media_id),
                    "status": "success",
                    "message": f"Tags {mode}ed",
                })
                succeeded += 1

            elif action == "move_to_folder":
                # Frontend sends folder_id from the folder tree picker.
                # "unfiled" (or empty) means root → folder_id = None.
                folder_id_raw = action_params.get("folder_id") or ""
                if folder_id_raw and folder_id_raw != "unfiled":
                    media.folder_id = UUID(folder_id_raw)
                else:
                    media.folder_id = None
                media.updated_by = user_id
                results.append({
                    "media_id": str(media.media_id),
                    "status": "success",
                    "message": "Moved",
                })
                succeeded += 1

            elif action == "set_rights_policy":
                if "rights_statement" in action_params:
                    media.rights_statement = action_params["rights_statement"]
                if "license" in action_params:
                    media.license = action_params["license"]
                if "copyright_status" in action_params:
                    media.copyright_status = action_params["copyright_status"]
                results.append({
                    "media_id": str(media.media_id),
                    "status": "success",
                    "message": "Rights updated",
                })
                succeeded += 1

            elif action == "add_to_lightbox":
                target_ws_id = UUID(action_params["target_workspace_id"])
                note = action_params.get("note", "")

                existing = db.query(MediaWorkspaceItem).filter(
                    MediaWorkspaceItem.workspace_id == target_ws_id,
                    MediaWorkspaceItem.media_id == media.media_id,
                ).first()

                if existing:
                    results.append({
                        "media_id": str(media.media_id),
                        "status": "skipped",
                        "message": "Already in target lightbox",
                    })
                    continue

                max_sort = db.query(func.max(MediaWorkspaceItem.sort_order)).filter(
                    MediaWorkspaceItem.workspace_id == target_ws_id
                ).scalar() or 0

                new_item = MediaWorkspaceItem(
                    workspace_id=target_ws_id,
                    media_id=media.media_id,
                    added_by_user_id=user_id,
                    sort_order=max_sort + 1,
                    note=note if note else None,
                )
                db.add(new_item)
                results.append({
                    "media_id": str(media.media_id),
                    "status": "success",
                    "filename": media.filename,
                    "message": "Added to lightbox",
                })
                succeeded += 1

            elif action == "download_assets":
                derivative_type = action_params.get("derivative_type", "original")
                s3_key = None
                filename = media.filename

                if derivative_type == "original":
                    s3_key = media.s3_key
                else:
                    derivative = db.query(MediaDerivative).filter(
                        MediaDerivative.media_id == media.media_id,
                        MediaDerivative.derivative_type == derivative_type,
                        MediaDerivative.organization_id == org_id,
                    ).first()
                    if derivative:
                        s3_key = derivative.s3_key
                        base_name = media.filename.rsplit('.', 1)[0] if '.' in media.filename else media.filename
                        filename = f"{base_name}_{derivative_type}.{derivative.format}"

                if s3_key:
                    artifact_url = get_org_media_url(
                        s3_key,
                        organization_id=str(org_id),
                        db_session=db,
                        expiry_seconds=3600,
                        use_cdn=False,
                    )
                    results.append({
                        "media_id": str(media.media_id),
                        "status": "success",
                        "filename": filename,
                        "artifact_url": artifact_url,
                    })
                    succeeded += 1
                else:
                    results.append({
                        "media_id": str(media.media_id),
                        "status": "error",
                        "message": f"Derivative '{derivative_type}' not found",
                    })
                    failed += 1

            elif action == "apply_metadata_template":
                template_id = UUID(action_params.get("template_id"))
                overwrite = action_params.get("overwrite_existing", False)

                template = db.query(MetadataTemplate).filter(
                    MetadataTemplate.template_id == template_id,
                    MetadataTemplate.organization_id == org_id,
                    MetadataTemplate.is_active == True,  # noqa: E712
                ).first()

                if not template:
                    results.append({
                        "media_id": str(media.media_id),
                        "status": "error",
                        "message": "Template not found or inactive",
                    })
                    failed += 1
                    continue

                fields = template.template_fields or {}

                if fields.get("title_prefix") and media.title:
                    media.title = fields["title_prefix"] + media.title
                if fields.get("title_suffix") and media.title:
                    media.title = media.title + fields["title_suffix"]

                simple_fields = [
                    "description", "alt_text", "creator", "credit",
                    "source", "copyright_status", "rights_statement", "license"
                ]
                skipped_fields: list[str] = []
                for field in simple_fields:
                    template_value = fields.get(field)
                    if not template_value:
                        continue
                    # Per-field validation against DB CHECK constraints —
                    # without this, a bad template value (e.g. an obsolete
                    # copyright_status string) would fail the whole commit
                    # and 500 every other media in the batch.
                    if field == "copyright_status" and template_value not in VALID_COPYRIGHT_STATUSES:
                        skipped_fields.append(
                            f"copyright_status='{template_value}' is not an allowed value"
                        )
                        continue
                    current_value = getattr(media, field, None)
                    if overwrite or not current_value:
                        setattr(media, field, template_value)

                # Free-form metadata template `tags` field was removed along with
                # media.tags (superseded by structured tags). Templates that need
                # to set tag values should be extended to declare structured-tag
                # entries via (definition_id, value_id) pairs.
                if fields.get("extra_metadata"):
                    existing_meta = media.extra_metadata or {}
                    existing_meta.update(fields["extra_metadata"])
                    media.extra_metadata = existing_meta

                if skipped_fields:
                    results.append({
                        "media_id": str(media.media_id),
                        "status": "partial",
                        "message": f"Applied template '{template.name}' with skipped fields: "
                                   + "; ".join(skipped_fields),
                    })
                else:
                    results.append({
                        "media_id": str(media.media_id),
                        "status": "success",
                        "message": f"Applied template '{template.name}'",
                    })
                succeeded += 1

            else:
                results.append({
                    "media_id": str(media.media_id),
                    "status": "error",
                    "message": f"Action {action} not implemented for sync execution",
                })
                failed += 1

        except Exception as e:
            logger.exception(f"Error executing {action} on media {media.media_id}")
            results.append({
                "media_id": str(media.media_id),
                "status": "error",
                "message": sanitize_error_message(e),
            })
            failed += 1

    # Wrap the batch commit so a leaked constraint violation on one row
    # surfaces as an action-level error instead of a 500 that loses all
    # the per-item results we already accumulated.
    try:
        db.commit()
    except Exception as e:
        db.rollback()
        logger.exception(f"Bulk action {action} commit failed")
        return {
            "action": action,
            "status": "failed",
            "workspace_id": str(workspace_id),
            "total_count": len(media_rows),
            "success_count": 0,
            "error_count": len(media_rows),
            "results": results,
            "error": sanitize_error_message(e),
        }

    return {
        "action": action,
        "status": "completed",
        "workspace_id": str(workspace_id),
        "total_count": len(media_rows),
        "success_count": succeeded,
        "error_count": failed,
        "results": results,
    }


@router.get("/api/organizations/{org_id}/media/workspaces/{workspace_id}/actions/runs/{run_id}", response_model=ActionRunResponse, summary="Get dam workspace action run")
def get_dam_workspace_action_run(
    org_id: UUID,
    workspace_id: UUID,
    run_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_WORKSPACES_VIEW)),
    db: Session = Depends(get_db),
):
    """Get the status of a bulk action run."""
    user_id = auth.user_id
    workspace = _get_workspace_or_404(db, org_id, workspace_id)

    if not _can_access_workspace(db, workspace, user_id, org_id):
        raise HTTPException(status_code=403, detail="Access denied")

    run = db.query(MediaWorkspaceActionRun).filter(
        MediaWorkspaceActionRun.run_id == run_id,
        MediaWorkspaceActionRun.workspace_id == workspace_id,
    ).first()

    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    return {
        "run_id": str(run.run_id),
        "action": run.action_key,
        "action_params": run.action_params,
        "status": run.status,
        "total_count": run.total_items,
        "processed_count": run.processed_items,
        "success_count": run.succeeded_items,
        "error_count": run.failed_items,
        "results": run.results,
        "error_message": run.error_message,
        "artifact_url": run.artifact_url,
        "artifact_expires_at": run.artifact_expires_at.isoformat() if run.artifact_expires_at else None,
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "completed_at": run.completed_at.isoformat() if run.completed_at else None,
        "created_at": run.created_at.isoformat(),
    }
