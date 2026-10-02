"""
Unified Workspaces API endpoints (FastAPI).

Handles both collections and media workspace types via a single set of routes
at /api/organizations/{org_id}/workspaces. The workspace_type field on the
Workspace model ('collections' or 'media') determines which item models are
used (WorkspaceItem vs MediaWorkspaceItem).

Also provides collections-specific active context management at
/api/organizations/{org_id}/context.

Migrated from app/api/workspaces.py (Flask).
"""

import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import and_, or_, func
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.fastapi_app.schemas.common import MessageResponse
from app.fastapi_app.schemas.workspaces import (
    ActiveContextResponse,
    BulkActionExecuteResponse,
    BulkActionListResponse,
    BulkActionPreviewResponse,
    BulkActionValidateResponse,
    ShareCreateResponse,
    ShareListResponse,
    WorkspaceAddItemsResponse,
    WorkspaceCreateResponse,
    WorkspaceDetailOut,
    WorkspaceItemListResponse,
    WorkspaceListResponse,
    WorkspacePinResponse,
    WorkspaceRemoveItemsResponse,
    WorkspaceUpdateResponse,
)
from app.models import (
    CollectionObject,
    CollectionObjectMedia,
    Media,
    MediaDerivative,
    MediaWorkspaceItem,
    OrganizationMembership,
    User,
    Workspace,
    WorkspaceItem,
    WorkspaceShare,
    UserActiveContext,
)
from app.permissions import Permission
from app.services.nagpra_restrictions import display_restricted_ids
from app.services.api_security import escape_ilike, sanitize_error_message
from app.services.uploads import get_org_media_url

logger = logging.getLogger(__name__)

router = APIRouter(tags=["workspaces"])


# ============================================================================
# HELPERS
# ============================================================================


def _can_access_workspace(db: Session, workspace: Workspace, user_id: UUID, org_id: UUID) -> bool:
    """Check if user can access (view) a workspace."""
    if workspace.owner_user_id == user_id:
        return True
    if workspace.visibility == "org":
        return True
    if workspace.visibility == "shared":
        share = db.query(WorkspaceShare).filter(
            WorkspaceShare.workspace_id == workspace.workspace_id,
            WorkspaceShare.principal_type == "user",
            WorkspaceShare.principal_id == user_id,
        ).first()
        if share:
            return True
    return False


def _get_user_permission_level(db: Session, workspace: Workspace, user_id: UUID) -> str:
    """Get user's permission level on a workspace."""
    if workspace.owner_user_id == user_id:
        return "admin"
    share = db.query(WorkspaceShare).filter(
        WorkspaceShare.workspace_id == workspace.workspace_id,
        WorkspaceShare.principal_type == "user",
        WorkspaceShare.principal_id == user_id,
    ).first()
    if share:
        return share.permission
    if workspace.visibility == "org":
        return "view"
    return "none"


def _get_workspace_or_404(db: Session, org_id: UUID, workspace_id: UUID) -> Workspace:
    workspace = db.query(Workspace).filter(
        Workspace.workspace_id == workspace_id,
        Workspace.organization_id == org_id,
        Workspace.is_deleted == False,  # noqa: E712
    ).first()
    if not workspace:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Workspace not found"})
    return workspace


def _get_object_thumbnail(db: Session, obj: CollectionObject) -> str | None:
    """Get thumbnail URL for a collection object."""
    if not obj:
        return None
    primary = db.query(CollectionObjectMedia).filter(
        CollectionObjectMedia.object_id == obj.object_id,
        CollectionObjectMedia.is_primary == True,  # noqa: E712
    ).first()
    if primary:
        thumb = db.query(MediaDerivative).filter(
            MediaDerivative.media_id == primary.media_id,
            MediaDerivative.derivative_type == "thumbnail",
        ).first()
        if thumb:
            return get_org_media_url(thumb.s3_key, organization_id=str(obj.organization_id))
    return None


def _get_object_primary_media_id(db: Session, obj: CollectionObject) -> UUID | None:
    """
    Return the media_id of the object's primary image, or None.

    Used when building workspace item responses so the frontend can offer
    a "set as cover" action on collection-object items the same way it does
    for media items — the media_id sent to the update endpoint is this
    primary image's media_id.
    """
    if not obj:
        return None
    primary = db.query(CollectionObjectMedia).filter(
        CollectionObjectMedia.object_id == obj.object_id,
        CollectionObjectMedia.is_primary == True,  # noqa: E712
    ).first()
    return primary.media_id if primary else None


def _get_media_thumbnail(db: Session, media: Media) -> str | None:
    """Get thumbnail URL for a media item."""
    if not media:
        return None
    thumbnail = db.query(MediaDerivative).filter(
        MediaDerivative.media_id == media.media_id,
        MediaDerivative.derivative_type == "thumbnail",
    ).first()
    if thumbnail and thumbnail.s3_key:
        return get_org_media_url(thumbnail.s3_key, organization_id=str(media.organization_id))
    # Never the master in a thumbnail slot — see _display_key_for_image.
    if media.media_type == "image":
        from app.serializers.media import _display_key_for_image

        key = _display_key_for_image(media, db) or media.thumbnail_s3_key
        if key:
            return get_org_media_url(key, organization_id=str(media.organization_id))
    return None


# ============================================================================
# WORKSPACE CRUD
# ============================================================================


@router.get("/api/organizations/{org_id}/workspaces", response_model=WorkspaceListResponse, summary="List workspaces")
def list_workspaces(
    org_id: UUID,
    filter: str = Query("all", alias="filter"),
    type: str | None = Query(None, alias="type"),
    visibility: str | None = Query(None, alias="visibility"),
    search: str = Query("", alias="search"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.WORKSPACES_VIEW)),
    db: Session = Depends(get_db),
):
    """List workspaces visible to the current user."""
    user_id = auth.user_id

    query = db.query(Workspace).filter(
        Workspace.organization_id == org_id,
        Workspace.is_deleted == False,  # noqa: E712
    )

    # Filter by workspace type (default to collections to prevent media bleed-over)
    if type:
        if type not in ("collections", "media"):
            raise HTTPException(status_code=400, detail={"code": "validation_error", "message": "Invalid workspace type. Must be 'collections' or 'media'"})
        query = query.filter(Workspace.workspace_type == type)
    else:
        query = query.filter(Workspace.workspace_type == 'collections')

    # Exact-visibility filter (optional). Applied before the "who can see this?"
    # filter below so e.g. ?visibility=private can narrow to personal workspaces
    # even within a `filter=all` view.
    if visibility is not None:
        if visibility not in ("private", "shared", "org"):
            raise HTTPException(status_code=400, detail={"code": "validation_error", "message": "Invalid visibility. Must be 'private', 'shared', or 'org'"})
        query = query.filter(Workspace.visibility == visibility)

    # Visibility filter
    visibility_conditions = []
    if filter in ("all", "owned"):
        visibility_conditions.append(Workspace.owner_user_id == user_id)
    if filter in ("all", "shared"):
        shared_ws_ids = db.query(WorkspaceShare.workspace_id).filter(
            WorkspaceShare.organization_id == org_id,
            WorkspaceShare.principal_type == "user",
            WorkspaceShare.principal_id == user_id,
        ).subquery()
        visibility_conditions.append(Workspace.workspace_id.in_(shared_ws_ids))
        visibility_conditions.append(Workspace.visibility == "org")
    if visibility_conditions:
        query = query.filter(or_(*visibility_conditions))

    # Search
    search = search.strip()
    if search:
        query = query.filter(Workspace.name.ilike(f"%{escape_ilike(search)}%", escape="\\"))

    total = query.count()
    query = query.order_by(Workspace.updated_at.desc()).offset(offset).limit(limit)
    workspaces = query.all()

    results = []
    for ws in workspaces:
        if ws.workspace_type == "media":
            item_count = db.query(func.count(MediaWorkspaceItem.workspace_item_id)).filter(
                MediaWorkspaceItem.workspace_id == ws.workspace_id
            ).scalar()
            item_key = "asset_count"
        else:
            item_count = db.query(func.count(WorkspaceItem.workspace_item_id)).filter(
                WorkspaceItem.workspace_id == ws.workspace_id
            ).scalar()
            item_key = "object_count"

        result = {
            "workspace_id": str(ws.workspace_id),
            "workspace_type": ws.workspace_type,
            "name": ws.name,
            "description": ws.description,
            "visibility": ws.visibility,
            "owner_user_id": str(ws.owner_user_id),
            "owner_name": ws.owner.display_name if ws.owner else None,
            "is_owner": ws.owner_user_id == user_id,
            "is_dynamic": ws.is_dynamic,
            item_key: item_count,
            "item_count": item_count,
            "created_at": ws.created_at.isoformat(),
            "updated_at": ws.updated_at.isoformat(),
        }

        # Cover image — available on both workspace types. For media
        # workspaces we fall back to the first item's thumbnail; for
        # collections workspaces we only show an explicit cover (no
        # fallback) to keep the list page lean.
        result["cover_media_id"] = str(ws.cover_media_id) if ws.cover_media_id else None
        cover_thumbnail_url = None
        if ws.cover_media:
            cover_thumbnail_url = _get_media_thumbnail(db, ws.cover_media)
        elif ws.workspace_type == "media" and item_count and item_count > 0:
            first_item = db.query(MediaWorkspaceItem).filter(
                MediaWorkspaceItem.workspace_id == ws.workspace_id
            ).order_by(MediaWorkspaceItem.sort_order).first()
            if first_item and first_item.media:
                cover_thumbnail_url = _get_media_thumbnail(db, first_item.media)
        result["cover_thumbnail_url"] = cover_thumbnail_url

        results.append(result)

    return {
        "items": results,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("/api/organizations/{org_id}/workspaces", status_code=201, response_model=WorkspaceCreateResponse, summary="Create workspace")
async def create_workspace(
    org_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.WORKSPACES_CREATE)),
    db: Session = Depends(get_db),
):
    """Create a new workspace."""
    user_id = auth.user_id
    data = await request.json()

    name = (data.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail={"code": "validation_error", "message": "Name is required"})

    visibility = data.get("visibility", "private")
    if visibility not in ("private", "shared", "org"):
        raise HTTPException(status_code=400, detail={"code": "validation_error", "message": "Invalid visibility value"})

    workspace_type = data.get("workspace_type", "collections")
    if workspace_type not in ("collections", "media"):
        raise HTTPException(status_code=400, detail={"code": "validation_error", "message": "Invalid workspace_type. Must be 'collections' or 'media'"})

    # Handle dynamic workspace fields. Both collections and media types
    # support dynamic worksets — the query is validated against the
    # appropriate search request schema for the workspace type.
    is_dynamic = bool(data.get("is_dynamic", False))
    dynamic_query = None

    if is_dynamic:
        raw_query = data.get("dynamic_query")
        if not raw_query or not isinstance(raw_query, dict):
            raise HTTPException(status_code=400, detail="dynamic_query is required for dynamic workspaces")

        if workspace_type == "collections":
            try:
                from app.search.collections.schemas import CollectionsSearchRequest
                CollectionsSearchRequest(**raw_query)
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Invalid dynamic_query: {e}")

            from app.services.dynamic_workspace import sanitize_dynamic_query
            dynamic_query = sanitize_dynamic_query(raw_query)
        else:  # media
            try:
                from app.search.media.schemas import MediaSearchRequest
                # Drop unknown fields — the dataclass will error on unexpected
                # kwargs, so we validate against known fields only.
                allowed = set(MediaSearchRequest.__dataclass_fields__.keys())
                cleaned = {k: v for k, v in raw_query.items() if k in allowed}
                # Reconstruct tag_filters if saved as plain dicts
                if "tag_filters" in cleaned and isinstance(cleaned["tag_filters"], list):
                    from app.search.media.schemas import TagFilter
                    cleaned["tag_filters"] = [
                        TagFilter(**tf) if isinstance(tf, dict) else tf
                        for tf in cleaned["tag_filters"]
                    ]
                MediaSearchRequest(**cleaned)
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Invalid dynamic_query: {e}")

            from app.services.dynamic_media_workspace import sanitize_media_dynamic_query
            dynamic_query = sanitize_media_dynamic_query(raw_query)

    workspace = Workspace(
        organization_id=org_id,
        owner_user_id=user_id,
        name=name,
        description=data.get("description"),
        visibility=visibility,
        workspace_type=workspace_type,
        is_dynamic=is_dynamic,
        dynamic_query=dynamic_query,
    )
    db.add(workspace)
    db.flush()

    added_count = 0

    if workspace_type == "collections":
        object_ids = data.get("object_ids", [])
        for obj_id_str in object_ids:
            try:
                obj_id = UUID(obj_id_str)
                obj = db.query(CollectionObject).filter(
                    CollectionObject.object_id == obj_id,
                    CollectionObject.organization_id == org_id,
                ).first()
                if obj:
                    item = WorkspaceItem(
                        workspace_id=workspace.workspace_id,
                        object_id=obj_id,
                        added_by_user_id=user_id,
                        sort_order=added_count,
                    )
                    db.add(item)
                    added_count += 1
            except (ValueError, TypeError):
                continue
    else:
        media_ids = data.get("media_ids", [])
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

    response = {
        "workspace_id": str(workspace.workspace_id),
        "workspace_type": workspace.workspace_type,
        "name": workspace.name,
        "description": workspace.description,
        "visibility": workspace.visibility,
        "is_owner": workspace.owner_user_id == user_id,
        "is_dynamic": workspace.is_dynamic,
        "created_at": workspace.created_at.isoformat(),
    }

    if workspace_type == "media":
        response["asset_count"] = added_count
    else:
        response["object_count"] = added_count

    return response


@router.get("/api/organizations/{org_id}/workspaces/{workspace_id}", response_model=WorkspaceDetailOut, summary="Get workspace")
def get_workspace(
    org_id: UUID,
    workspace_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.WORKSPACES_VIEW)),
    db: Session = Depends(get_db),
):
    """Get workspace details including items."""
    user_id = auth.user_id
    workspace = _get_workspace_or_404(db, org_id, workspace_id)

    if not _can_access_workspace(db, workspace, user_id, org_id):
        raise HTTPException(status_code=403, detail="Access denied")

    permission_level = _get_user_permission_level(db, workspace, user_id)

    if workspace.workspace_type == "media":
        # Dynamic media workspace — resolve pinned + saved-search results
        if workspace.is_dynamic:
            from app.services.dynamic_media_workspace import resolve_dynamic_media_items
            resolved = resolve_dynamic_media_items(
                workspace, org_id, db, limit=100, offset=0
            )
            dyn_cover_thumbnail = (
                _get_media_thumbnail(db, workspace.cover_media)
                if workspace.cover_media
                else None
            )
            return {
                "workspace_id": str(workspace.workspace_id),
                "workspace_type": "media",
                "name": workspace.name,
                "description": workspace.description,
                "visibility": workspace.visibility,
                "owner_user_id": str(workspace.owner_user_id),
                "owner_name": workspace.owner.display_name if workspace.owner else None,
                "is_owner": workspace.owner_user_id == user_id,
                "permission_level": permission_level,
                "is_dynamic": True,
                "dynamic_query": workspace.dynamic_query,
                "search_unavailable": resolved["search_unavailable"],
                "pinned_count": resolved["pinned_count"],
                "dynamic_count": resolved["dynamic_count"],
                "items": resolved["items"],
                "asset_count": resolved["total"],
                "item_count": resolved["total"],
                "cover_media_id": str(workspace.cover_media_id) if workspace.cover_media_id else None,
                "cover_thumbnail_url": dyn_cover_thumbnail,
                "created_at": workspace.created_at.isoformat(),
                "updated_at": workspace.updated_at.isoformat(),
            }

        # Static media workspace items
        items_query = db.query(MediaWorkspaceItem).filter(
            MediaWorkspaceItem.workspace_id == workspace_id
        ).options(
            joinedload(MediaWorkspaceItem.media)
        ).order_by(MediaWorkspaceItem.sort_order)

        items = []
        for item in items_query:
            media = item.media
            items.append({
                "workspace_item_id": str(item.workspace_item_id),
                "media_id": str(item.media_id),
                "filename": media.filename if media else None,
                "title": media.title if media else None,
                "thumbnail_url": _get_media_thumbnail(db, media) if media else None,
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
            })

        cover_thumbnail_url = None
        if workspace.cover_media:
            cover_thumbnail_url = _get_media_thumbnail(db, workspace.cover_media)
        elif items:
            cover_thumbnail_url = items[0].get("thumbnail_url")

        return {
            "workspace_id": str(workspace.workspace_id),
            "workspace_type": "media",
            "name": workspace.name,
            "description": workspace.description,
            "visibility": workspace.visibility,
            "owner_user_id": str(workspace.owner_user_id),
            "owner_name": workspace.owner.display_name if workspace.owner else None,
            "is_owner": workspace.owner_user_id == user_id,
            "permission_level": permission_level,
            "is_dynamic": False,
            "items": items,
            "asset_count": len(items),
            "item_count": len(items),
            "cover_media_id": str(workspace.cover_media_id) if workspace.cover_media_id else None,
            "cover_thumbnail_url": cover_thumbnail_url,
            "created_at": workspace.created_at.isoformat(),
            "updated_at": workspace.updated_at.isoformat(),
        }
    else:
        # Dynamic workspace
        if workspace.is_dynamic:
            from app.services.dynamic_workspace import resolve_dynamic_items
            resolved = resolve_dynamic_items(
                workspace, org_id, db, limit=100, offset=0
            )
            dyn_cover_thumbnail = (
                _get_media_thumbnail(db, workspace.cover_media)
                if workspace.cover_media
                else None
            )
            return {
                "workspace_id": str(workspace.workspace_id),
                "workspace_type": "collections",
                "name": workspace.name,
                "description": workspace.description,
                "visibility": workspace.visibility,
                "owner_user_id": str(workspace.owner_user_id),
                "owner_name": workspace.owner.display_name if workspace.owner else None,
                "is_owner": workspace.owner_user_id == user_id,
                "permission_level": permission_level,
                "is_dynamic": True,
                "dynamic_query": workspace.dynamic_query,
                "search_unavailable": resolved["search_unavailable"],
                "pinned_count": resolved["pinned_count"],
                "dynamic_count": resolved["dynamic_count"],
                "items": resolved["items"],
                "object_count": resolved["total"],
                "item_count": resolved["total"],
                "cover_media_id": str(workspace.cover_media_id) if workspace.cover_media_id else None,
                "cover_thumbnail_url": dyn_cover_thumbnail,
                "created_at": workspace.created_at.isoformat(),
                "updated_at": workspace.updated_at.isoformat(),
            }

        # Static collections workspace
        items_query = db.query(WorkspaceItem).filter(
            WorkspaceItem.workspace_id == workspace_id
        ).options(
            joinedload(WorkspaceItem.object)
        ).order_by(WorkspaceItem.sort_order)

        items = []
        for item in items_query:
            obj = item.object
            primary_media_id = _get_object_primary_media_id(db, obj) if obj else None
            items.append({
                "workspace_item_id": str(item.workspace_item_id),
                "object_id": str(item.object_id),
                "accession_number": obj.object_number if obj else None,
                "title": (obj.title_links[0].title if obj.title_links else None) if obj else None,
                "thumbnail_url": _get_object_thumbnail(db, obj) if obj else None,
                "primary_media_id": str(primary_media_id) if primary_media_id else None,
                "note": item.note,
                "sort_order": item.sort_order,
                "added_at": item.added_at.isoformat(),
            })

        static_cover_thumbnail = (
            _get_media_thumbnail(db, workspace.cover_media)
            if workspace.cover_media
            else None
        )
        return {
            "workspace_id": str(workspace.workspace_id),
            "workspace_type": "collections",
            "name": workspace.name,
            "description": workspace.description,
            "visibility": workspace.visibility,
            "owner_user_id": str(workspace.owner_user_id),
            "owner_name": workspace.owner.display_name if workspace.owner else None,
            "is_owner": workspace.owner_user_id == user_id,
            "permission_level": permission_level,
            "is_dynamic": False,
            "items": items,
            "object_count": len(items),
            "item_count": len(items),
            "cover_media_id": str(workspace.cover_media_id) if workspace.cover_media_id else None,
            "cover_thumbnail_url": static_cover_thumbnail,
            "created_at": workspace.created_at.isoformat(),
            "updated_at": workspace.updated_at.isoformat(),
        }


@router.patch("/api/organizations/{org_id}/workspaces/{workspace_id}", response_model=WorkspaceUpdateResponse, summary="Update workspace")
async def update_workspace(
    org_id: UUID,
    workspace_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.WORKSPACES_EDIT)),
    db: Session = Depends(get_db),
):
    """Update workspace details."""
    user_id = auth.user_id
    data = await request.json()
    workspace = _get_workspace_or_404(db, org_id, workspace_id)

    permission_level = _get_user_permission_level(db, workspace, user_id)
    if permission_level not in ("admin", "edit") and workspace.owner_user_id != user_id:
        raise HTTPException(status_code=403, detail="Permission denied")

    if "name" in data:
        name = data["name"].strip()
        if not name:
            raise HTTPException(status_code=400, detail="Name cannot be empty")
        workspace.name = name

    if "description" in data:
        workspace.description = data["description"]

    if "visibility" in data:
        if workspace.owner_user_id != user_id and permission_level != "admin":
            raise HTTPException(status_code=403, detail="Only owner can change visibility")
        if data["visibility"] not in ("private", "shared", "org"):
            raise HTTPException(status_code=400, detail={"code": "validation_error", "message": "Invalid visibility value"})
        workspace.visibility = data["visibility"]

    # Dynamic query update — validator and sanitizer are workspace-type-specific
    if "dynamic_query" in data and workspace.is_dynamic:
        raw_query = data["dynamic_query"]
        if raw_query and isinstance(raw_query, dict):
            if workspace.workspace_type == "collections":
                try:
                    from app.search.collections.schemas import CollectionsSearchRequest
                    CollectionsSearchRequest(**raw_query)
                except Exception as e:
                    raise HTTPException(status_code=400, detail=f"Invalid dynamic_query: {e}")
                from app.services.dynamic_workspace import sanitize_dynamic_query
                workspace.dynamic_query = sanitize_dynamic_query(raw_query)
            else:  # media
                try:
                    from app.search.media.schemas import MediaSearchRequest, TagFilter
                    allowed = set(MediaSearchRequest.__dataclass_fields__.keys())
                    cleaned = {k: v for k, v in raw_query.items() if k in allowed}
                    if "tag_filters" in cleaned and isinstance(cleaned["tag_filters"], list):
                        cleaned["tag_filters"] = [
                            TagFilter(**tf) if isinstance(tf, dict) else tf
                            for tf in cleaned["tag_filters"]
                        ]
                    MediaSearchRequest(**cleaned)
                except Exception as e:
                    raise HTTPException(status_code=400, detail=f"Invalid dynamic_query: {e}")
                from app.services.dynamic_media_workspace import sanitize_media_dynamic_query
                workspace.dynamic_query = sanitize_media_dynamic_query(raw_query)
        elif raw_query is None:
            workspace.dynamic_query = None

    # Cover image — available on both workspace types.
    # For media workspaces, the cover must be one of the workspace's items.
    # For collections workspaces, the cover is any org-owned media (picked
    # from the primary image of one of the contained collection objects,
    # though we don't enforce that — any valid org media works).
    if "cover_media_id" in data:
        if data["cover_media_id"]:
            cover_id = UUID(data["cover_media_id"])
            if workspace.workspace_type == "media" and not workspace.is_dynamic:
                # Static media workspace — cover must be a pinned item.
                item = db.query(MediaWorkspaceItem).filter(
                    MediaWorkspaceItem.workspace_id == workspace_id,
                    MediaWorkspaceItem.media_id == cover_id,
                ).first()
                if item:
                    workspace.cover_media_id = cover_id
            else:
                # Collections workspace OR dynamic media workspace —
                # validate org membership only. Dynamic items have no row
                # in MediaWorkspaceItem, but they are still org-owned media
                # that matched the saved query.
                media_row = db.query(Media).filter(
                    Media.media_id == cover_id,
                    Media.organization_id == org_id,
                ).first()
                if media_row:
                    workspace.cover_media_id = cover_id
        else:
            workspace.cover_media_id = None

    workspace.updated_at = datetime.now(timezone.utc)
    db.commit()

    response = {
        "workspace_id": str(workspace.workspace_id),
        "workspace_type": workspace.workspace_type,
        "name": workspace.name,
        "description": workspace.description,
        "visibility": workspace.visibility,
        "updated_at": workspace.updated_at.isoformat(),
    }

    # Always include cover info in the response so both workspace types can
    # use the same client-side update path.
    response["cover_media_id"] = str(workspace.cover_media_id) if workspace.cover_media_id else None

    return response


@router.delete("/api/organizations/{org_id}/workspaces/{workspace_id}", response_model=MessageResponse, summary="Delete workspace")
def delete_workspace(
    org_id: UUID,
    workspace_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.WORKSPACES_DELETE)),
    db: Session = Depends(get_db),
):
    """Soft-delete a workspace (owner only)."""
    user_id = auth.user_id
    workspace = _get_workspace_or_404(db, org_id, workspace_id)

    if workspace.owner_user_id != user_id:
        raise HTTPException(status_code=403, detail="Only owner can delete workspace")

    workspace.is_deleted = True
    workspace.deleted_at = datetime.now(timezone.utc)
    workspace.deleted_by = user_id
    db.commit()

    return {"message": "Workspace deleted"}


# ============================================================================
# WORKSPACE ITEMS
# ============================================================================


@router.get("/api/organizations/{org_id}/workspaces/{workspace_id}/items", response_model=WorkspaceItemListResponse, summary="List workspace items")
def list_workspace_items(
    org_id: UUID,
    workspace_id: UUID,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.WORKSPACES_VIEW)),
    db: Session = Depends(get_db),
):
    """List items in a workspace with pagination."""
    user_id = auth.user_id
    workspace = _get_workspace_or_404(db, org_id, workspace_id)

    if not _can_access_workspace(db, workspace, user_id, org_id):
        raise HTTPException(status_code=403, detail="Access denied")

    # Dynamic workspace — branch on type so media dynamic worksets use the
    # MediaSearchRequest resolver, not the collections one.
    if workspace.is_dynamic:
        if workspace.workspace_type == "media":
            from app.services.dynamic_media_workspace import resolve_dynamic_media_items
            resolved = resolve_dynamic_media_items(
                workspace, org_id, db, limit=limit, offset=offset
            )
        else:
            from app.services.dynamic_workspace import resolve_dynamic_items
            resolved = resolve_dynamic_items(
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

    # Static workspace — branch on type
    if workspace.workspace_type == "media":
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
                "thumbnail_url": _get_media_thumbnail(db, media) if media else None,
                "note": item.note,
                "sort_order": item.sort_order,
                "added_at": item.added_at.isoformat(),
            })
    else:
        query = db.query(WorkspaceItem).filter(
            WorkspaceItem.workspace_id == workspace_id
        ).options(joinedload(WorkspaceItem.object))
        total = query.count()
        items_list = query.order_by(WorkspaceItem.sort_order).offset(offset).limit(limit).all()

        items = []
        for item in items_list:
            obj = item.object
            items.append({
                "workspace_item_id": str(item.workspace_item_id),
                "object_id": str(item.object_id),
                "accession_number": obj.object_number if obj else None,
                "title": (obj.title_links[0].title if obj.title_links else None) if obj else None,
                "thumbnail_url": _get_object_thumbnail(db, obj) if obj else None,
                "note": item.note,
                "sort_order": item.sort_order,
                "added_at": item.added_at.isoformat(),
            })

    return {
        "items": items,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("/api/organizations/{org_id}/workspaces/{workspace_id}/items", response_model=WorkspaceAddItemsResponse, summary="Add workspace items")
async def add_workspace_items(
    org_id: UUID,
    workspace_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.WORKSPACES_EDIT)),
    db: Session = Depends(get_db),
):
    """Add items to a workspace."""
    user_id = auth.user_id
    data = await request.json()
    workspace = _get_workspace_or_404(db, org_id, workspace_id)

    permission_level = _get_user_permission_level(db, workspace, user_id)
    if permission_level not in ("admin", "edit") and workspace.owner_user_id != user_id:
        raise HTTPException(status_code=403, detail="Permission denied")

    added = []
    skipped = []

    if workspace.workspace_type == "media":
        media_ids = data.get("media_ids", [])
        if not media_ids:
            raise HTTPException(status_code=400, detail="No media IDs provided")

        max_sort = db.query(func.max(MediaWorkspaceItem.sort_order)).filter(
            MediaWorkspaceItem.workspace_id == workspace_id
        ).scalar() or 0

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
    else:
        object_ids = data.get("object_ids", [])
        if not object_ids:
            raise HTTPException(status_code=400, detail="No object IDs provided")

        max_sort = db.query(func.max(WorkspaceItem.sort_order)).filter(
            WorkspaceItem.workspace_id == workspace_id
        ).scalar() or 0

        for obj_id_str in object_ids:
            try:
                obj_id = UUID(obj_id_str)
                existing = db.query(WorkspaceItem).filter(
                    WorkspaceItem.workspace_id == workspace_id,
                    WorkspaceItem.object_id == obj_id,
                ).first()
                if existing:
                    skipped.append(obj_id_str)
                    continue
                obj = db.query(CollectionObject).filter(
                    CollectionObject.object_id == obj_id,
                    CollectionObject.organization_id == org_id,
                ).first()
                if not obj:
                    skipped.append(obj_id_str)
                    continue
                max_sort += 1
                item = WorkspaceItem(
                    workspace_id=workspace_id,
                    object_id=obj_id,
                    added_by_user_id=user_id,
                    sort_order=max_sort,
                )
                db.add(item)
                added.append(obj_id_str)
            except (ValueError, TypeError):
                skipped.append(obj_id_str)

    workspace.updated_at = datetime.now(timezone.utc)
    db.commit()

    return {
        "added": added,
        "skipped": skipped,
        "added_count": len(added),
    }


@router.delete("/api/organizations/{org_id}/workspaces/{workspace_id}/items", response_model=WorkspaceRemoveItemsResponse, summary="Remove workspace items")
async def remove_workspace_items(
    org_id: UUID,
    workspace_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.WORKSPACES_EDIT)),
    db: Session = Depends(get_db),
):
    """Remove items from a workspace."""
    user_id = auth.user_id
    data = await request.json()
    workspace = _get_workspace_or_404(db, org_id, workspace_id)

    permission_level = _get_user_permission_level(db, workspace, user_id)
    if permission_level not in ("admin", "edit") and workspace.owner_user_id != user_id:
        raise HTTPException(status_code=403, detail="Permission denied")

    removed_count = 0

    if workspace.workspace_type == "media":
        media_ids = data.get("media_ids", [])
        if not media_ids:
            raise HTTPException(status_code=400, detail="No media IDs provided")
        for media_id_str in media_ids:
            try:
                media_id = UUID(media_id_str)
                deleted = db.query(MediaWorkspaceItem).filter(
                    MediaWorkspaceItem.workspace_id == workspace_id,
                    MediaWorkspaceItem.media_id == media_id,
                ).delete()
                removed_count += deleted
            except (ValueError, TypeError):
                continue
    else:
        object_ids = data.get("object_ids", [])
        if not object_ids:
            raise HTTPException(status_code=400, detail="No object IDs provided")
        for obj_id_str in object_ids:
            try:
                obj_id = UUID(obj_id_str)
                deleted = db.query(WorkspaceItem).filter(
                    WorkspaceItem.workspace_id == workspace_id,
                    WorkspaceItem.object_id == obj_id,
                ).delete()
                removed_count += deleted
            except (ValueError, TypeError):
                continue

    workspace.updated_at = datetime.now(timezone.utc)
    db.commit()

    return {"removed_count": removed_count}


@router.post("/api/organizations/{org_id}/workspaces/{workspace_id}/items/reorder", response_model=MessageResponse, summary="Reorder workspace items")
async def reorder_workspace_items(
    org_id: UUID,
    workspace_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.WORKSPACES_EDIT)),
    db: Session = Depends(get_db),
):
    """Reorder items in a workspace."""
    user_id = auth.user_id
    data = await request.json()
    workspace = _get_workspace_or_404(db, org_id, workspace_id)

    permission_level = _get_user_permission_level(db, workspace, user_id)
    if permission_level not in ("admin", "edit") and workspace.owner_user_id != user_id:
        raise HTTPException(status_code=403, detail="Permission denied")

    item_ids = data.get("item_ids", [])

    if workspace.workspace_type == "media":
        for index, item_id_str in enumerate(item_ids):
            try:
                item_id = UUID(item_id_str)
                db.query(MediaWorkspaceItem).filter(
                    MediaWorkspaceItem.workspace_item_id == item_id,
                    MediaWorkspaceItem.workspace_id == workspace_id,
                ).update({"sort_order": index})
            except (ValueError, TypeError):
                continue
    else:
        for index, item_id_str in enumerate(item_ids):
            try:
                item_id = UUID(item_id_str)
                db.query(WorkspaceItem).filter(
                    WorkspaceItem.workspace_item_id == item_id,
                    WorkspaceItem.workspace_id == workspace_id,
                ).update({"sort_order": index})
            except (ValueError, TypeError):
                continue

    workspace.updated_at = datetime.now(timezone.utc)
    db.commit()

    return {"message": "Items reordered"}


@router.patch("/api/organizations/{org_id}/workspaces/{workspace_id}/items/{object_id}/pin", response_model=WorkspacePinResponse, summary="Pin workspace item")
def pin_workspace_item(
    org_id: UUID,
    workspace_id: UUID,
    object_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.WORKSPACES_EDIT)),
    db: Session = Depends(get_db),
):
    """
    Pin an item to a dynamic workspace (idempotent).

    For collections workspaces the path param is an object_id; for media
    workspaces it's a media_id. The path is named ``object_id`` for
    backwards compatibility but is treated as a generic item identifier.
    """
    user_id = auth.user_id
    workspace = _get_workspace_or_404(db, org_id, workspace_id)

    if not workspace.is_dynamic:
        raise HTTPException(status_code=400, detail="Pin is only supported for dynamic workspaces")

    permission_level = _get_user_permission_level(db, workspace, user_id)
    if permission_level not in ("admin", "edit") and workspace.owner_user_id != user_id:
        raise HTTPException(status_code=403, detail="Permission denied")

    if workspace.workspace_type == "media":
        media = db.query(Media).filter(
            Media.media_id == object_id,
            Media.organization_id == org_id,
        ).first()
        if not media:
            raise HTTPException(status_code=404, detail="Media not found")

        existing = db.query(MediaWorkspaceItem).filter(
            MediaWorkspaceItem.workspace_id == workspace_id,
            MediaWorkspaceItem.media_id == object_id,
        ).first()
        if existing:
            return {
                "workspace_item_id": str(existing.workspace_item_id),
                "object_id": str(object_id),
                "already_pinned": True,
            }

        max_sort = db.query(func.max(MediaWorkspaceItem.sort_order)).filter(
            MediaWorkspaceItem.workspace_id == workspace_id
        ).scalar() or 0

        item = MediaWorkspaceItem(
            workspace_id=workspace_id,
            media_id=object_id,
            added_by_user_id=user_id,
            sort_order=max_sort + 1,
        )
        db.add(item)
        workspace.updated_at = datetime.now(timezone.utc)
        db.commit()

        return {
            "workspace_item_id": str(item.workspace_item_id),
            "object_id": str(object_id),
            "already_pinned": False,
        }

    # Collections dynamic workspace
    obj = db.query(CollectionObject).filter(
        CollectionObject.object_id == object_id,
        CollectionObject.organization_id == org_id,
    ).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Object not found")

    existing = db.query(WorkspaceItem).filter(
        WorkspaceItem.workspace_id == workspace_id,
        WorkspaceItem.object_id == object_id,
    ).first()

    if existing:
        return {
            "workspace_item_id": str(existing.workspace_item_id),
            "object_id": str(object_id),
            "already_pinned": True,
        }

    max_sort = db.query(func.max(WorkspaceItem.sort_order)).filter(
        WorkspaceItem.workspace_id == workspace_id
    ).scalar() or 0

    item = WorkspaceItem(
        workspace_id=workspace_id,
        object_id=object_id,
        added_by_user_id=user_id,
        sort_order=max_sort + 1,
    )
    db.add(item)

    workspace.updated_at = datetime.now(timezone.utc)
    db.commit()

    return {
        "workspace_item_id": str(item.workspace_item_id),
        "object_id": str(object_id),
        "already_pinned": False,
    }


# ============================================================================
# SHARING
# ============================================================================


@router.get("/api/organizations/{org_id}/workspaces/{workspace_id}/shares", response_model=ShareListResponse, summary="List workspace shares")
def list_workspace_shares(
    org_id: UUID,
    workspace_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.WORKSPACES_VIEW)),
    db: Session = Depends(get_db),
):
    """List shares for a workspace."""
    user_id = auth.user_id
    workspace = _get_workspace_or_404(db, org_id, workspace_id)

    permission_level = _get_user_permission_level(db, workspace, user_id)
    if workspace.owner_user_id != user_id and permission_level != "admin":
        raise HTTPException(status_code=403, detail="Permission denied")

    shares = db.query(WorkspaceShare).filter(
        WorkspaceShare.workspace_id == workspace_id
    ).all()

    results = []
    for share in shares:
        result = {
            "share_id": str(share.share_id),
            "principal_type": share.principal_type,
            "principal_id": str(share.principal_id),
            "permission": share.permission,
            "created_at": share.created_at.isoformat(),
        }
        if share.principal_type == "user":
            user = db.query(User).filter(User.user_id == share.principal_id).first()
            result["principal_name"] = user.display_name if user else None
            result["principal_email"] = user.email if user else None
        results.append(result)

    return {"shares": results}


@router.post("/api/organizations/{org_id}/workspaces/{workspace_id}/shares", status_code=201, response_model=ShareCreateResponse, summary="Create workspace share")
async def create_workspace_share(
    org_id: UUID,
    workspace_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.WORKSPACES_SHARE)),
    db: Session = Depends(get_db),
):
    """Share a workspace with a user."""
    user_id = auth.user_id
    data = await request.json()
    workspace = _get_workspace_or_404(db, org_id, workspace_id)

    permission_level = _get_user_permission_level(db, workspace, user_id)
    if workspace.owner_user_id != user_id and permission_level != "admin":
        raise HTTPException(status_code=403, detail="Permission denied")

    target_user_id = data.get("user_id")
    permission = data.get("permission", "view")

    if not target_user_id:
        raise HTTPException(status_code=400, detail="user_id is required")
    if permission not in ("view", "edit", "execute", "admin"):
        raise HTTPException(status_code=400, detail="Invalid permission value")

    target_user_uuid = UUID(target_user_id)

    # Verify target user is in org
    membership = db.query(OrganizationMembership).filter(
        OrganizationMembership.organization_id == org_id,
        OrganizationMembership.user_id == target_user_uuid,
        OrganizationMembership.status == "active",
    ).first()
    if not membership:
        raise HTTPException(status_code=404, detail="User not found in organization")

    # Check for existing share
    existing = db.query(WorkspaceShare).filter(
        WorkspaceShare.workspace_id == workspace_id,
        WorkspaceShare.principal_type == "user",
        WorkspaceShare.principal_id == target_user_uuid,
    ).first()

    if existing:
        existing.permission = permission
        db.commit()
        return {"share_id": str(existing.share_id), "updated": True}

    share = WorkspaceShare(
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

    db.commit()

    return {"share_id": str(share.share_id), "created": True}


@router.delete("/api/organizations/{org_id}/workspaces/{workspace_id}/shares/{share_id}", response_model=MessageResponse, summary="Delete workspace share")
def delete_workspace_share(
    org_id: UUID,
    workspace_id: UUID,
    share_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.WORKSPACES_SHARE)),
    db: Session = Depends(get_db),
):
    """Remove a share from a workspace."""
    user_id = auth.user_id
    workspace = _get_workspace_or_404(db, org_id, workspace_id)

    permission_level = _get_user_permission_level(db, workspace, user_id)
    if workspace.owner_user_id != user_id and permission_level != "admin":
        raise HTTPException(status_code=403, detail="Permission denied")

    deleted = db.query(WorkspaceShare).filter(
        WorkspaceShare.share_id == share_id,
        WorkspaceShare.workspace_id == workspace_id,
    ).delete()

    if not deleted:
        raise HTTPException(status_code=404, detail="Share not found")

    db.commit()

    return {"message": "Share removed"}


# ============================================================================
# ACTIVE CONTEXT (collections)
# ============================================================================


@router.get("/api/organizations/{org_id}/context", response_model=ActiveContextResponse, summary="Get active context")
def get_active_context(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get the current active context for the user."""
    user_id = auth.user_id

    context = db.query(UserActiveContext).filter(
        UserActiveContext.user_id == user_id,
        UserActiveContext.app == "collections",
        UserActiveContext.organization_id == org_id,
    ).first()

    if not context or not context.context_type:
        return {"context": None}

    result = {
        "type": context.context_type,
        "id": str(context.context_id) if context.context_id else None,
        "set_at": context.set_at.isoformat() if context.set_at else None,
    }

    if context.context_type == "object" and context.context_id:
        obj = db.query(CollectionObject).filter(
            CollectionObject.object_id == context.context_id,
            CollectionObject.organization_id == org_id,
        ).first()
        if obj:
            result["object"] = {
                "object_id": str(obj.object_id),
                "accession_number": obj.object_number,
                "title": obj.title_links[0].title if obj.title_links else None,
            }
    elif context.context_type == "workspace" and context.context_id:
        ws = db.query(Workspace).filter(
            Workspace.workspace_id == context.context_id,
            Workspace.organization_id == org_id,
            Workspace.workspace_type == "collections",
            Workspace.is_deleted == False,  # noqa: E712
        ).first()
        if ws:
            item_count = db.query(func.count(WorkspaceItem.workspace_item_id)).filter(
                WorkspaceItem.workspace_id == ws.workspace_id
            ).scalar()
            result["workspace"] = {
                "workspace_id": str(ws.workspace_id),
                "name": ws.name,
                "object_count": item_count,
            }
        else:
            # Workspace not found or wrong type — stale context, clear it
            return {"context": None}
    return {"context": result}


@router.post("/api/organizations/{org_id}/context/workspace/{workspace_id}", response_model=ActiveContextResponse, summary="Set workspace context")
def set_workspace_context(
    org_id: UUID,
    workspace_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.WORKSPACES_VIEW)),
    db: Session = Depends(get_db),
):
    """Set a workspace as the active context."""
    user_id = auth.user_id
    workspace = _get_workspace_or_404(db, org_id, workspace_id)

    if not _can_access_workspace(db, workspace, user_id, org_id):
        raise HTTPException(status_code=403, detail="Access denied")

    context = db.query(UserActiveContext).filter(
        UserActiveContext.user_id == user_id,
        UserActiveContext.app == "collections",
    ).first()

    if context:
        context.organization_id = org_id
        context.context_type = "workspace"
        context.context_id = workspace_id
        context.set_at = datetime.now(timezone.utc)
    else:
        context = UserActiveContext(
            user_id=user_id,
            app="collections",
            organization_id=org_id,
            context_type="workspace",
            context_id=workspace_id,
        )
        db.add(context)

    db.commit()

    item_count = db.query(func.count(WorkspaceItem.workspace_item_id)).filter(
        WorkspaceItem.workspace_id == workspace_id
    ).scalar()

    return {
        "context": {
            "type": "workspace",
            "id": str(workspace_id),
            "workspace": {
                "workspace_id": str(workspace.workspace_id),
                "name": workspace.name,
                "object_count": item_count,
            },
        }
    }


@router.post("/api/organizations/{org_id}/context/object/{object_id}", response_model=ActiveContextResponse, summary="Set object context")
def set_object_context(
    org_id: UUID,
    object_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Set an object as the active context."""
    user_id = auth.user_id

    obj = db.query(CollectionObject).filter(
        CollectionObject.object_id == object_id,
        CollectionObject.organization_id == org_id,
    ).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Object not found")

    context = db.query(UserActiveContext).filter(
        UserActiveContext.user_id == user_id,
        UserActiveContext.app == "collections",
    ).first()

    if context:
        context.organization_id = org_id
        context.context_type = "object"
        context.context_id = object_id
        context.set_at = datetime.now(timezone.utc)
    else:
        context = UserActiveContext(
            user_id=user_id,
            app="collections",
            organization_id=org_id,
            context_type="object",
            context_id=object_id,
        )
        db.add(context)

    db.commit()

    return {
        "context": {
            "type": "object",
            "id": str(object_id),
            "object": {
                "object_id": str(obj.object_id),
                "accession_number": obj.object_number,
                "title": obj.title_links[0].title if obj.title_links else None,
            },
        }
    }


@router.delete("/api/organizations/{org_id}/context", response_model=MessageResponse, summary="Clear active context")
def clear_active_context(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Clear the active context."""
    user_id = auth.user_id

    context = db.query(UserActiveContext).filter(
        UserActiveContext.user_id == user_id,
        UserActiveContext.app == "collections",
        UserActiveContext.organization_id == org_id,
    ).first()

    if context:
        context.context_type = None
        context.context_id = None
        context.set_at = datetime.now(timezone.utc)
        db.commit()

    return {"message": "Context cleared", "success": True}


# ============================================================================
# BULK ACTIONS
# ============================================================================

SUPPORTED_BULK_ACTIONS = {
    "record_movement": {
        "label": "Record Movement",
        "description": "Move all objects to a new location",
        "permission": Permission.MOVEMENTS_CREATE,
        "required_params": ["to_location_id", "reason"],
        "optional_params": ["movement_note", "location_fitness", "movement_method"],
        "category": "location",
    },
    "set_cataloging_status": {
        "label": "Set Cataloging Status",
        "description": "Mark objects as cataloged, pending review, or needs research",
        "permission": Permission.COLLECTIONS_EDIT,
        "required_params": ["cataloging_status"],
        "optional_params": ["cataloging_notes", "assigned_to_user_id", "due_date"],
        "category": "cataloging",
    },
    "set_object_status": {
        "label": "Set Object Status",
        "description": "Change collection status (permanent, loan, study, etc.)",
        "permission": Permission.COLLECTIONS_EDIT,
        "required_params": ["object_status"],
        "optional_params": ["status_date", "status_notes"],
        "category": "cataloging",
    },
    "add_to_loan": {
        "label": "Add to Loan",
        "description": "Associate objects with an existing or new loan record",
        "permission": Permission.LOANS_EDIT,
        "required_params": ["loan_id"],
        "optional_params": ["loan_notes"],
        "category": "loans",
    },
    "set_loan_availability": {
        "label": "Set Loan Availability",
        "description": "Mark objects as available or unavailable for loan",
        "permission": Permission.COLLECTIONS_EDIT,
        "required_params": ["loan_availability"],
        "optional_params": ["availability_reason", "review_date"],
        "category": "loans",
    },
    "create_condition_report": {
        "label": "Create Condition Reports",
        "description": "Create condition reports for all objects",
        "permission": Permission.CONDITION_REPORTS_CREATE,
        "required_params": ["report_type"],
        "optional_params": ["overall_condition", "condition_summary", "conservation_needed"],
        "category": "condition",
    },
    "schedule_condition_check": {
        "label": "Schedule Condition Check",
        "description": "Create condition check tasks for later completion",
        "permission": Permission.CONDITION_REPORTS_CREATE,
        "required_params": ["check_type", "due_date"],
        "optional_params": ["assigned_to_user_id", "priority", "notes"],
        "category": "condition",
    },
    "flag_for_conservation": {
        "label": "Flag for Conservation",
        "description": "Mark objects as needing conservation attention",
        "permission": Permission.CONSERVATION_CREATE,
        "required_params": ["urgency", "concern_type"],
        "optional_params": ["concern_description", "assigned_to_user_id"],
        "category": "condition",
    },
    "set_handling_requirements": {
        "label": "Set Handling Requirements",
        "description": "Apply handling instructions to objects",
        "permission": Permission.COLLECTIONS_EDIT,
        "required_params": ["handling_requirements"],
        "optional_params": ["handling_notes"],
        "category": "condition",
    },
    "report_incident": {
        "label": "Report Incident",
        "description": "Create an incident report linking all objects",
        "permission": Permission.INCIDENTS_CREATE,
        "required_params": ["incident_type", "incident_description"],
        "optional_params": ["incident_location_id"],
        "category": "incidents",
    },
    "set_discoverable": {
        "label": "Set Discoverable",
        "description": "Publish or unpublish objects on the public collection page",
        "permission": Permission.DISCOVER_PUBLISH,
        "required_params": ["is_discoverable"],
        "optional_params": [],
        "category": "discovery",
    },
}


@router.get("/api/organizations/{org_id}/workspaces/{workspace_id}/actions", response_model=BulkActionListResponse, summary="List bulk actions")
def list_bulk_actions(
    org_id: UUID,
    workspace_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.WORKSPACES_VIEW)),
    db: Session = Depends(get_db),
):
    """List available bulk actions for a workspace."""
    from app.services.rbac_service import check_permission

    user_id = auth.user_id
    workspace = _get_workspace_or_404(db, org_id, workspace_id)

    if not _can_access_workspace(db, workspace, user_id, org_id):
        raise HTTPException(status_code=403, detail="Access denied")

    perm_level = _get_user_permission_level(db, workspace, user_id)
    if perm_level not in ("admin", "execute"):
        raise HTTPException(status_code=403, detail="Execute permission required")

    actions = []
    for action_key, action_config in SUPPORTED_BULK_ACTIONS.items():
        if check_permission(str(user_id), str(org_id), action_config["permission"], session=db):
            actions.append({
                "key": action_key,
                "label": action_config["label"],
                "description": action_config["description"],
                "required_params": action_config["required_params"],
                "optional_params": action_config["optional_params"],
            })

    return {
        "workspace_id": str(workspace_id),
        "actions": actions,
    }


@router.post("/api/organizations/{org_id}/workspaces/{workspace_id}/actions/{action}/preview", response_model=BulkActionPreviewResponse, summary="Preview bulk action")
async def preview_bulk_action(
    org_id: UUID,
    workspace_id: UUID,
    action: str,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.WORKSPACES_EXECUTE)),
    db: Session = Depends(get_db),
):
    """Preview a bulk action on workspace objects."""
    from app.services.rbac_service import check_permission

    user_id = auth.user_id

    if action not in SUPPORTED_BULK_ACTIONS:
        raise HTTPException(status_code=400, detail=f"Unknown action: {action}")

    action_config = SUPPORTED_BULK_ACTIONS[action]

    if not check_permission(str(user_id), str(org_id), action_config["permission"], session=db):
        raise HTTPException(status_code=403, detail="Permission denied for this action")

    workspace = _get_workspace_or_404(db, org_id, workspace_id)

    if not _can_access_workspace(db, workspace, user_id, org_id):
        raise HTTPException(status_code=403, detail="Access denied")

    perm_level = _get_user_permission_level(db, workspace, user_id)
    if perm_level not in ("admin", "execute"):
        raise HTTPException(status_code=403, detail="Execute permission required")

    data = await request.json()
    action_params = data.get("action_params", {})

    items = db.query(WorkspaceItem, CollectionObject).join(
        CollectionObject,
        WorkspaceItem.object_id == CollectionObject.object_id
    ).filter(
        WorkspaceItem.workspace_id == workspace_id,
    ).order_by(WorkspaceItem.sort_order, WorkspaceItem.added_at).all()

    objects = []
    has_warnings = False

    for item, obj in items:
        obj_data = {
            "object_id": str(obj.object_id),
            "accession_number": obj.object_number,
            "title": obj.title_links[0].title if obj.title_links and len(obj.title_links) > 0 else None,
            "thumbnail_url": _get_object_thumbnail(db, obj),
            "warnings": [],
        }

        if action == "record_movement":
            if not obj.current_location_id:
                obj_data["warnings"].append("Object has no current location")
            to_loc_id = action_params.get("to_location_id")
            if to_loc_id and obj.current_location_id and str(obj.current_location_id) == to_loc_id:
                obj_data["warnings"].append("Object is already at destination")
        elif action == "create_condition_report":
            from app.models import ConditionReport
            recent = db.query(ConditionReport).filter(
                ConditionReport.object_id == obj.object_id,
                ConditionReport.report_date >= (datetime.now(timezone.utc).date() - timedelta(days=30))
            ).first()
            if recent:
                obj_data["warnings"].append("Object has a condition report within the last 30 days")
        elif action == "set_discoverable":
            is_discoverable = action_params.get("is_discoverable")
            if is_discoverable and obj.is_discoverable:
                obj_data["warnings"].append("Object is already discoverable")
            elif not is_discoverable and not obj.is_discoverable:
                obj_data["warnings"].append("Object is already private")

        if obj_data["warnings"]:
            has_warnings = True

        objects.append(obj_data)

    return {
        "action": action,
        "action_label": action_config["label"],
        "workspace_id": str(workspace_id),
        "workspace_name": workspace.name,
        "objects": objects,
        "total_count": len(objects),
        "has_warnings": has_warnings,
    }


@router.post("/api/organizations/{org_id}/workspaces/{workspace_id}/actions/{action}/validate", response_model=BulkActionValidateResponse, summary="Validate bulk action")
async def validate_bulk_action(
    org_id: UUID,
    workspace_id: UUID,
    action: str,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.WORKSPACES_EXECUTE)),
    db: Session = Depends(get_db),
):
    """Validate a bulk action before execution."""
    from app.services.rbac_service import check_permission

    user_id = auth.user_id

    if action not in SUPPORTED_BULK_ACTIONS:
        raise HTTPException(status_code=400, detail=f"Unknown action: {action}")

    action_config = SUPPORTED_BULK_ACTIONS[action]

    if not check_permission(str(user_id), str(org_id), action_config["permission"], session=db):
        raise HTTPException(status_code=403, detail="Permission denied for this action")

    workspace = _get_workspace_or_404(db, org_id, workspace_id)

    if not _can_access_workspace(db, workspace, user_id, org_id):
        raise HTTPException(status_code=403, detail="Access denied")

    perm_level = _get_user_permission_level(db, workspace, user_id)
    if perm_level not in ("admin", "execute"):
        raise HTTPException(status_code=403, detail="Execute permission required")

    data = await request.json()
    action_params = data.get("action_params", {})
    object_ids = data.get("object_ids")

    # Validate required params
    missing = [p for p in action_config["required_params"] if p not in action_params]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing required parameters: {', '.join(missing)}")

    # Action-specific param validation
    if action == "record_movement":
        from app.models import Location
        to_loc = db.query(Location).filter(
            Location.location_id == UUID(action_params["to_location_id"]),
            Location.organization_id == org_id,
        ).first()
        if not to_loc:
            raise HTTPException(status_code=404, detail="Destination location not found")

    # Get workspace items
    query = db.query(WorkspaceItem, CollectionObject).join(
        CollectionObject,
        WorkspaceItem.object_id == CollectionObject.object_id
    ).filter(
        WorkspaceItem.workspace_id == workspace_id,
    )

    if object_ids:
        query = query.filter(CollectionObject.object_id.in_([UUID(oid) for oid in object_ids]))

    items = query.all()

    allowed = []
    blocked = []

    for item, obj in items:
        obj_data = {
            "object_id": str(obj.object_id),
            "accession_number": obj.object_number,
            "title": obj.title_links[0].title if obj.title_links else None,
        }

        block_reason = None
        if action == "record_movement":
            to_loc_id = action_params.get("to_location_id")
            if obj.current_location_id and str(obj.current_location_id) == to_loc_id:
                block_reason = "Already at destination location"

        if block_reason:
            obj_data["reason"] = block_reason
            blocked.append(obj_data)
        else:
            allowed.append(obj_data)

    return {
        "action": action,
        "action_valid": True,
        "allowed": allowed,
        "blocked": blocked,
        "allowed_count": len(allowed),
        "blocked_count": len(blocked),
    }


@router.post("/api/organizations/{org_id}/workspaces/{workspace_id}/actions/{action}/execute", response_model=BulkActionExecuteResponse, summary="Execute bulk action")
async def execute_bulk_action(
    org_id: UUID,
    workspace_id: UUID,
    action: str,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.WORKSPACES_EXECUTE)),
    db: Session = Depends(get_db),
):
    """Execute a bulk action on workspace objects."""
    from app.models import (
        Movement, ConditionReport, Location, IncidentReport, IncidentReportObject,
        Task, LoanOut, LoanOutObject, ConservationTreatment,
    )
    from app.services.rbac_service import check_permission

    user_id = auth.user_id

    if action not in SUPPORTED_BULK_ACTIONS:
        raise HTTPException(status_code=400, detail=f"Unknown action: {action}")

    action_config = SUPPORTED_BULK_ACTIONS[action]

    if not check_permission(str(user_id), str(org_id), action_config["permission"], session=db):
        raise HTTPException(status_code=403, detail="Permission denied for this action")

    workspace = _get_workspace_or_404(db, org_id, workspace_id)

    if not _can_access_workspace(db, workspace, user_id, org_id):
        raise HTTPException(status_code=403, detail="Access denied")

    perm_level = _get_user_permission_level(db, workspace, user_id)
    if perm_level not in ("admin", "execute"):
        raise HTTPException(status_code=403, detail="Execute permission required")

    data = await request.json()
    action_params = data.get("action_params", {})
    object_ids = data.get("object_ids")
    skip_blocked = data.get("skip_blocked", False)

    missing = [p for p in action_config["required_params"] if p not in action_params]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing required parameters: {', '.join(missing)}")

    query = db.query(WorkspaceItem, CollectionObject).join(
        CollectionObject,
        WorkspaceItem.object_id == CollectionObject.object_id
    ).filter(
        WorkspaceItem.workspace_id == workspace_id,
    )

    if object_ids:
        query = query.filter(CollectionObject.object_id.in_([UUID(oid) for oid in object_ids]))

    items = query.all()

    if not items:
        raise HTTPException(status_code=400, detail="No objects to process")

    results = []
    success_count = 0
    error_count = 0

    try:
        if action == "record_movement":
            to_location = db.query(Location).filter(
                Location.location_id == UUID(action_params["to_location_id"]),
                Location.organization_id == org_id,
            ).first()
            if not to_location:
                raise HTTPException(status_code=404, detail="Destination location not found")

            base_count = db.query(func.count(Movement.movement_id)).filter(
                Movement.organization_id == org_id
            ).scalar()

            for idx, (item, obj) in enumerate(items):
                result = {"object_id": str(obj.object_id), "accession_number": obj.object_number}

                if obj.current_location_id == to_location.location_id:
                    if skip_blocked:
                        result["status"] = "skipped"
                        result["message"] = "Already at destination"
                    else:
                        result["status"] = "error"
                        result["message"] = "Already at destination"
                        error_count += 1
                    results.append(result)
                    continue

                ref_number = f"M.{datetime.now(timezone.utc).year}.{base_count + idx + 1:04d}"
                mov = Movement(
                    organization_id=org_id,
                    movement_reference_number=ref_number,
                    object_id=obj.object_id,
                    from_location_id=obj.current_location_id,
                    to_location_id=to_location.location_id,
                    movement_date=datetime.now(timezone.utc),
                    reason=action_params["reason"],
                    movement_note=action_params.get("movement_note"),
                    location_fitness=action_params.get("location_fitness"),
                    movement_method=action_params.get("movement_method"),
                    authorized_by=user_id,
                    authorization_date=datetime.now(timezone.utc).date(),
                    moved_by=user_id,
                    created_by=user_id,
                    status="completed",
                )

                old_location_id = obj.current_location_id
                obj.current_location_id = to_location.location_id
                obj.current_location_date = datetime.now(timezone.utc)
                obj.current_location_fitness = action_params.get("location_fitness")
                obj.updated_by = user_id

                if old_location_id:
                    old_loc = db.query(Location).filter(Location.location_id == old_location_id).first()
                    if old_loc and old_loc.current_count > 0:
                        old_loc.current_count -= 1
                to_location.current_count += 1

                db.add(mov)
                result["status"] = "success"
                result["record_id"] = str(mov.movement_id)
                result["reference_number"] = ref_number
                results.append(result)
                success_count += 1

        elif action == "create_condition_report":
            base_count = db.query(func.count(ConditionReport.report_id)).filter(
                ConditionReport.organization_id == org_id
            ).scalar()

            for idx, (item, obj) in enumerate(items):
                result = {"object_id": str(obj.object_id), "accession_number": obj.object_number}
                report_number = f"CR{datetime.now(timezone.utc).year}.{base_count + idx + 1:04d}"
                from app.services.constituent_service import find_or_create_staff_constituent
                _examiner = find_or_create_staff_constituent(db, org_id, user_id)
                report = ConditionReport(
                    organization_id=org_id,
                    report_number=report_number,
                    report_type=action_params["report_type"],
                    report_date=datetime.now(timezone.utc).date(),
                    # examiner_id is a constituent ref (staff constituent for this user).
                    examiner_id=_examiner.constituent_id if _examiner else None,
                    object_id=obj.object_id,
                    overall_condition=action_params.get("overall_condition") or None,
                    condition_summary=action_params.get("condition_summary") or None,
                    conservation_needed=action_params.get("conservation_needed", False),
                    status="draft",
                    created_by=user_id,
                    updated_by=user_id,
                )
                db.add(report)
                result["status"] = "success"
                result["record_id"] = str(report.report_id)
                result["reference_number"] = report_number
                results.append(result)
                success_count += 1

        elif action == "report_incident":
            from app.services.sequence import next_sequential_number
            report_number = next_sequential_number(db, org_id, 'IR')

            incident = IncidentReport(
                organization_id=org_id,
                report_number=report_number,
                report_date=datetime.now(timezone.utc).date(),
                incident_type=action_params["incident_type"],
                incident_description=action_params["incident_description"],
                discovered_date=datetime.now(timezone.utc),
                incident_location_id=UUID(action_params["incident_location_id"]) if action_params.get("incident_location_id") else None,
                status="draft",
                created_by=user_id,
                updated_by=user_id,
            )
            db.add(incident)
            db.flush()

            for item, obj in items:
                link = IncidentReportObject(
                    report_id=incident.report_id,
                    organization_id=org_id,
                    object_id=obj.object_id,
                    damage_description=action_params.get("damage_description"),
                )
                db.add(link)
                results.append({
                    "object_id": str(obj.object_id),
                    "accession_number": obj.object_number,
                    "status": "success",
                    "record_id": str(incident.report_id),
                    "reference_number": report_number,
                })
                success_count += 1

        elif action == "set_cataloging_status":
            status = action_params["cataloging_status"]
            notes = action_params.get("cataloging_notes")
            for item, obj in items:
                result = {"object_id": str(obj.object_id), "accession_number": obj.object_number}
                obj_metadata = obj.extra_metadata or {}
                obj_metadata["cataloging_status"] = status
                if notes:
                    obj_metadata["cataloging_notes"] = notes
                if action_params.get("assigned_to_user_id"):
                    obj_metadata["cataloging_assigned_to"] = action_params["assigned_to_user_id"]
                if action_params.get("due_date"):
                    obj_metadata["cataloging_due_date"] = action_params["due_date"]
                obj.extra_metadata = obj_metadata
                obj.updated_by = user_id
                result["status"] = "success"
                results.append(result)
                success_count += 1

        elif action == "set_object_status":
            status = action_params["object_status"]
            status_notes = action_params.get("status_notes")
            for item, obj in items:
                result = {"object_id": str(obj.object_id), "accession_number": obj.object_number}
                obj.object_status = status
                if status_notes:
                    obj_metadata = obj.extra_metadata or {}
                    obj_metadata["status_change_notes"] = status_notes
                    obj_metadata["status_change_date"] = action_params.get("status_date") or datetime.now(timezone.utc).isoformat()
                    obj.extra_metadata = obj_metadata
                obj.updated_by = user_id
                result["status"] = "success"
                results.append(result)
                success_count += 1

        elif action == "add_to_loan":
            loan_id = UUID(action_params["loan_id"])
            loan = db.query(LoanOut).filter(
                LoanOut.loan_out_id == loan_id,
                LoanOut.organization_id == org_id,
            ).first()
            if not loan:
                raise HTTPException(status_code=404, detail="Loan not found")

            for item, obj in items:
                result = {"object_id": str(obj.object_id), "accession_number": obj.object_number}
                existing = db.query(LoanOutObject).filter(
                    LoanOutObject.loan_out_id == loan_id,
                    LoanOutObject.object_id == obj.object_id,
                ).first()
                if existing:
                    if skip_blocked:
                        result["status"] = "skipped"
                        result["message"] = "Already in loan"
                    else:
                        result["status"] = "error"
                        result["message"] = "Already in loan"
                        error_count += 1
                    results.append(result)
                    continue

                loan_obj = LoanOutObject(
                    loan_out_id=loan_id,
                    organization_id=org_id,
                    object_id=obj.object_id,
                )
                if action_params.get("loan_notes"):
                    obj_metadata = obj.extra_metadata or {}
                    obj_metadata["loan_notes"] = action_params["loan_notes"]
                    obj.extra_metadata = obj_metadata
                db.add(loan_obj)
                result["status"] = "success"
                result["loan_number"] = loan.loan_number
                results.append(result)
                success_count += 1

        elif action == "set_loan_availability":
            availability = action_params["loan_availability"]
            for item, obj in items:
                result = {"object_id": str(obj.object_id), "accession_number": obj.object_number}
                obj_metadata = obj.extra_metadata or {}
                obj_metadata["loan_availability"] = availability
                if action_params.get("availability_reason"):
                    obj_metadata["loan_availability_reason"] = action_params["availability_reason"]
                if action_params.get("review_date"):
                    obj_metadata["loan_availability_review_date"] = action_params["review_date"]
                obj.extra_metadata = obj_metadata
                obj.updated_by = user_id
                result["status"] = "success"
                results.append(result)
                success_count += 1

        elif action == "schedule_condition_check":
            check_type = action_params["check_type"]
            due_date = action_params["due_date"]
            assigned_to = action_params.get("assigned_to_user_id")
            priority = action_params.get("priority", "normal")
            notes = action_params.get("notes", "")

            for item, obj in items:
                result = {"object_id": str(obj.object_id), "accession_number": obj.object_number}
                task = Task(
                    organization_id=org_id,
                    title=f"Condition Check: {obj.object_number}",
                    description=f"{check_type} condition check scheduled for {obj.object_number}. {notes}",
                    status="todo",
                    priority=priority,
                    due_date=due_date if isinstance(due_date, datetime) else datetime.fromisoformat(due_date) if due_date else None,
                    assignee_id=UUID(assigned_to) if assigned_to else None,
                    related_entity_type="collection_object",
                    related_entity_id=obj.object_id,
                    created_by=user_id,
                )
                db.add(task)
                result["status"] = "success"
                result["task_id"] = str(task.task_id)
                results.append(result)
                success_count += 1

        elif action == "flag_for_conservation":
            urgency = action_params["urgency"]
            concern_type = action_params["concern_type"]
            description = action_params.get("concern_description", "")

            base_count = db.query(func.count(ConservationTreatment.treatment_id)).filter(
                ConservationTreatment.organization_id == org_id
            ).scalar()

            for idx, (item, obj) in enumerate(items):
                result = {"object_id": str(obj.object_id), "accession_number": obj.object_number}
                treatment_number = f"CON{datetime.now(timezone.utc).year}.{base_count + idx + 1:04d}"
                treatment = ConservationTreatment(
                    organization_id=org_id,
                    treatment_number=treatment_number,
                    object_id=obj.object_id,
                    treatment_status="proposed",
                    treatment_type=concern_type,
                    treatment_reason=description,
                    priority=urgency,
                    conservator_id=UUID(action_params["assigned_to_user_id"]) if action_params.get("assigned_to_user_id") else None,
                    created_by=user_id,
                    updated_by=user_id,
                )
                db.add(treatment)
                result["status"] = "success"
                result["record_id"] = str(treatment.treatment_id)
                result["reference_number"] = treatment_number
                results.append(result)
                success_count += 1

        elif action == "set_handling_requirements":
            requirements = action_params["handling_requirements"]
            notes = action_params.get("handling_notes", "")
            for item, obj in items:
                result = {"object_id": str(obj.object_id), "accession_number": obj.object_number}
                if isinstance(requirements, list):
                    obj.handling_requirements = ", ".join(requirements)
                else:
                    obj.handling_requirements = requirements
                if notes:
                    obj_metadata = obj.extra_metadata or {}
                    obj_metadata["handling_notes"] = notes
                    obj.extra_metadata = obj_metadata
                obj.updated_by = user_id
                result["status"] = "success"
                results.append(result)
                success_count += 1

        elif action == "set_discoverable":
            is_discoverable = bool(action_params["is_discoverable"])
            now = datetime.now(timezone.utc)
            affected_objects = []

            # NAGPRA display gate (43 CFR 10 duty of care). The single-object
            # endpoint refuses with a 409 here; this bulk path set the flag
            # directly, so the same user with the same permission could publish
            # objects one at a time (blocked) or a hundred at once (allowed).
            # Restricted objects are reported per-row rather than failing the
            # whole batch, so the rest of the selection still applies.
            restricted_ids: set = set()
            if is_discoverable:
                restricted_ids = display_restricted_ids(
                    db, org_id, [obj.object_id for _, obj in items]
                )

            for item, obj in items:
                result = {"object_id": str(obj.object_id), "accession_number": obj.object_number}
                if is_discoverable and obj.object_id in restricted_ids:
                    result["status"] = "skipped"
                    result["message"] = (
                        "NAGPRA action without granted display consent; "
                        "cannot be made publicly discoverable."
                    )
                    results.append(result)
                    continue
                if obj.is_discoverable == is_discoverable:
                    result["status"] = "skipped"
                    result["message"] = "Object is already discoverable" if is_discoverable else "Object is already private"
                    results.append(result)
                    continue

                obj.is_discoverable = is_discoverable
                if is_discoverable:
                    obj.discoverable_at = now
                    obj.discoverable_by = user_id
                else:
                    obj.discoverable_at = None
                    obj.discoverable_by = None
                obj.updated_by = user_id
                affected_objects.append(obj)
                result["status"] = "success"
                results.append(result)
                success_count += 1

        db.commit()

        # Re-index for set_discoverable
        if action == "set_discoverable" and affected_objects:
            try:
                from app.fastapi_app.serializers.collections_helpers import _index_collection_object
                for obj in affected_objects:
                    _index_collection_object(obj)
            except Exception:
                logger.warning("Could not import _index_collection_object for re-indexing")

        return {
            "action": action,
            "status": "completed",
            "workspace_id": str(workspace_id),
            "results": results,
            "success_count": success_count,
            "error_count": error_count,
            "total_count": len(results),
        }

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Bulk action execution error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Bulk action failed: {sanitize_error_message(e)}")
