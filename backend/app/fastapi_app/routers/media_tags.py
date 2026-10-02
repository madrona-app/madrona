"""
Media Tags API endpoints (FastAPI).

Phase 9a — 11 routes:
  - Tag Definitions CRUD + reorder (6 routes)
  - Media Tags CRUD + bulk update (4 routes)
  - Tag Values autocomplete (1 route)

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
from sqlalchemy import func

from app.models import (
    Media,
    MediaTag,
    MediaTagDefinition,
    MediaTagValue,
)
from app.models.media import MEDIA_TAG_FIELD_TYPES
from app.permissions import Permission
from app.services.api_security import escape_ilike
from app.fastapi_app.schemas.common import SuccessResponse
from app.fastapi_app.schemas.media_tags import (
    DeleteTagDefinitionResponse,
    MediaTagListResponse,
    MediaTagOut,
    TagDefinitionListResponse,
    TagDefinitionOut,
    TagValueListResponse,
    TagValueOut,
    TagValuesResponse,
)

# Field types that use MediaTagValue rows (vs. free-form text/date).
_CONTROLLED_TYPES = {"dropdown", "multi_select", "category_tree", "dynamic_keywords"}

logger = logging.getLogger(__name__)

router = APIRouter(tags=["media-tags"])


# ============================================================================
# SERIALIZERS
# ============================================================================


def _serialize_tag_definition(definition: MediaTagDefinition, value_count: int | None = None) -> dict:
    out = {
        "definition_id": str(definition.definition_id),
        "organization_id": str(definition.organization_id),
        "tag_key": definition.tag_key,
        "display_name": definition.display_name,
        "description": definition.description,
        "field_type": definition.field_type,
        "allow_multiple": definition.allow_multiple,
        "is_required": definition.is_required,
        "sort_order": definition.sort_order,
        "is_active": definition.is_active,
        "created_at": definition.created_at.isoformat() if definition.created_at else None,
        "created_by": str(definition.created_by) if definition.created_by else None,
        "updated_at": definition.updated_at.isoformat() if definition.updated_at else None,
    }
    if value_count is not None:
        out["value_count"] = value_count
    return out


def _serialize_tag_value(value: MediaTagValue, depth: int | None = None, usage_count: int | None = None) -> dict:
    out = {
        "value_id": str(value.value_id),
        "definition_id": str(value.definition_id),
        "parent_id": str(value.parent_id) if value.parent_id else None,
        "value": value.value,
        "sort_order": value.sort_order,
        "is_active": value.is_active,
    }
    if depth is not None:
        out["depth"] = depth
    if usage_count is not None:
        out["usage_count"] = usage_count
    return out


def _serialize_media_tag(tag: MediaTag, include_definition: bool = True) -> dict:
    result = {
        "tag_id": str(tag.tag_id),
        "organization_id": str(tag.organization_id),
        "media_id": str(tag.media_id),
        "definition_id": str(tag.definition_id),
        "value_id": str(tag.value_id) if tag.value_id else None,
        "tag_value": tag.tag_value,
        "created_at": tag.created_at.isoformat() if tag.created_at else None,
        "created_by": str(tag.created_by) if tag.created_by else None,
    }
    if include_definition and tag.definition:
        result["tag_key"] = tag.definition.tag_key
        result["display_name"] = tag.definition.display_name
    return result


# ─────────────────────────────────────────────────────────────────────────────
# Controlled-vocab helpers
# ─────────────────────────────────────────────────────────────────────────────

def _resolve_value(
    db: Session,
    definition: MediaTagDefinition,
    *,
    value_id: UUID | None,
    tag_value: str | None,
    user_id: UUID | None,
    auto_create: bool,
) -> MediaTagValue | None:
    """
    Resolve a value_id + tag_value request into a MediaTagValue row.

    - If ``value_id`` is given: look it up and verify it belongs to ``definition``.
    - Else if ``tag_value`` matches an existing active value (case-insensitive),
      return it.
    - Else if ``auto_create`` (dynamic_keywords): create a new value row.
    - Else: raise 400.
    """
    if value_id is not None:
        node = db.query(MediaTagValue).filter(
            MediaTagValue.value_id == value_id,
            MediaTagValue.definition_id == definition.definition_id,
        ).first()
        if node is None:
            raise HTTPException(status_code=400, detail="value_id does not belong to this definition")
        if not node.is_active:
            raise HTTPException(status_code=400, detail="Cannot assign a deprecated value")
        return node

    if tag_value:
        clean = tag_value.strip()
        if not clean:
            raise HTTPException(status_code=400, detail="tag_value is empty")
        existing = db.query(MediaTagValue).filter(
            MediaTagValue.definition_id == definition.definition_id,
            MediaTagValue.is_active.is_(True),
            func.lower(MediaTagValue.value) == clean.lower(),
        ).first()
        if existing:
            return existing
        if auto_create:
            node = MediaTagValue(
                definition_id=definition.definition_id,
                value=clean,
                sort_order=0,
                is_active=True,
                created_by=user_id,
            )
            db.add(node)
            db.flush()
            return node
        raise HTTPException(
            status_code=400,
            detail=f"Value '{clean}' is not a valid option for this field",
        )

    return None


# ============================================================================
# HELPERS
# ============================================================================


def _reindex_media_for_tags(media: Media, db: Session) -> None:
    try:
        from app.search.media import MediaSearchService, get_media_search_service

        if MediaSearchService.is_available():
            db.refresh(media)
            service = get_media_search_service()
            service.index_media(media)
            logger.debug("Reindexed media %s after tag change", media.media_id)
    except Exception as e:
        logger.warning("Failed to reindex media %s after tag change: %s", media.media_id, e)


# ============================================================================
# TAG DEFINITIONS (Admin-managed)
# ============================================================================


@router.get("/api/organizations/{org_id}/media/tag-definitions", response_model=TagDefinitionListResponse, summary="List tag definitions")
def list_tag_definitions(
    org_id: UUID,
    include_inactive: bool = Query(False),
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """List tag definitions."""
    query = db.query(MediaTagDefinition).filter(
        MediaTagDefinition.organization_id == org_id,
    )
    if not include_inactive:
        query = query.filter(MediaTagDefinition.is_active == True)  # noqa: E712

    definitions = query.order_by(MediaTagDefinition.sort_order).all()
    return {
        "definitions": [_serialize_tag_definition(d) for d in definitions],
        "total": len(definitions),
    }


@router.post("/api/organizations/{org_id}/media/tag-definitions", response_model=TagDefinitionOut, status_code=201, summary="Create tag definition")
def create_tag_definition(
    org_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Create tag definition."""
    tag_key = (body.get("tag_key") or "").strip()
    display_name = (body.get("display_name") or "").strip()

    if not tag_key:
        raise HTTPException(status_code=400, detail="tag_key is required")
    if not display_name:
        raise HTTPException(status_code=400, detail="display_name is required")

    existing = db.query(MediaTagDefinition).filter(
        MediaTagDefinition.organization_id == org_id,
        MediaTagDefinition.tag_key == tag_key,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Tag key '{tag_key}' already exists")

    field_type = (body.get("field_type") or "text").strip()
    if field_type not in MEDIA_TAG_FIELD_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid field_type: {field_type}")
    allow_multiple = bool(body.get("allow_multiple", False))
    # multi_select / category_tree are inherently multi-value.
    if field_type in ("multi_select", "category_tree"):
        allow_multiple = True

    definition = MediaTagDefinition(
        organization_id=org_id,
        tag_key=tag_key,
        display_name=display_name,
        description=body.get("description"),
        field_type=field_type,
        allow_multiple=allow_multiple,
        is_required=body.get("is_required", False),
        sort_order=body.get("sort_order", 0),
        created_by=auth.user_id,
    )
    db.add(definition)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Tag key already exists")

    db.refresh(definition)
    return _serialize_tag_definition(definition)


@router.put("/api/organizations/{org_id}/media/tag-definitions/reorder", response_model=SuccessResponse, summary="Reorder tag definitions")
def reorder_tag_definitions(
    org_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Reorder tag definitions."""
    order = body.get("order", [])
    if not order:
        raise HTTPException(status_code=400, detail="order array is required")

    for index, def_id in enumerate(order):
        defn = db.query(MediaTagDefinition).filter(
            MediaTagDefinition.definition_id == UUID(def_id),
            MediaTagDefinition.organization_id == org_id,
        ).first()
        if defn:
            defn.sort_order = index

    db.commit()
    return {"success": True}


@router.get("/api/organizations/{org_id}/media/tag-definitions/{definition_id}", response_model=TagDefinitionOut, summary="Get tag definition")
def get_tag_definition(
    org_id: UUID,
    definition_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """Get tag definition."""
    definition = db.query(MediaTagDefinition).filter(
        MediaTagDefinition.definition_id == definition_id,
        MediaTagDefinition.organization_id == org_id,
    ).first()
    if not definition:
        raise HTTPException(status_code=404, detail="Tag definition not found")
    return _serialize_tag_definition(definition)


@router.put("/api/organizations/{org_id}/media/tag-definitions/{definition_id}", response_model=TagDefinitionOut, summary="Update tag definition")
def update_tag_definition(
    org_id: UUID,
    definition_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Update tag definition."""
    definition = db.query(MediaTagDefinition).filter(
        MediaTagDefinition.definition_id == definition_id,
        MediaTagDefinition.organization_id == org_id,
    ).first()
    if not definition:
        raise HTTPException(status_code=404, detail="Tag definition not found")

    for field in ["display_name", "description", "is_required", "sort_order", "is_active", "allow_multiple"]:
        if field in body:
            setattr(definition, field, body[field])
    if "field_type" in body:
        ft = (body.get("field_type") or "").strip()
        if ft not in MEDIA_TAG_FIELD_TYPES:
            raise HTTPException(status_code=400, detail=f"Invalid field_type: {ft}")
        # Retyping a definition that already has tags is safe from a schema
        # standpoint (tag_value remains readable) but may orphan value_id
        # references if moving from controlled -> text. Keep the value rows
        # around so admins can switch back without data loss; existing tags
        # simply stop validating against allowed values going forward.
        definition.field_type = ft
        if ft in ("multi_select", "category_tree"):
            definition.allow_multiple = True

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Tag definition conflict")

    db.refresh(definition)
    return _serialize_tag_definition(definition)


@router.delete("/api/organizations/{org_id}/media/tag-definitions/{definition_id}", response_model=DeleteTagDefinitionResponse, summary="Delete tag definition")
def delete_tag_definition(
    org_id: UUID,
    definition_id: UUID,
    hard_delete: bool = Query(False),
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete tag definition."""
    definition = db.query(MediaTagDefinition).filter(
        MediaTagDefinition.definition_id == definition_id,
        MediaTagDefinition.organization_id == org_id,
    ).first()
    if not definition:
        raise HTTPException(status_code=404, detail="Tag definition not found")

    try:
        if hard_delete:
            db.delete(definition)
        else:
            definition.is_active = False
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Cannot delete tag definition with existing tags")

    return {"success": True, "hard_deleted": hard_delete}


# ============================================================================
# MEDIA TAGS (User-assigned values)
# ============================================================================


@router.get("/api/organizations/{org_id}/media/{media_id}/tags", response_model=MediaTagListResponse, summary="Get media tags")
def get_media_tags(
    org_id: UUID,
    media_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """Get media tags."""
    media = db.query(Media).filter(
        Media.media_id == media_id,
        Media.organization_id == org_id,
    ).first()
    if not media:
        raise HTTPException(status_code=404, detail="Media not found")

    tags = db.query(MediaTag).join(MediaTagDefinition).filter(
        MediaTag.media_id == media_id,
        MediaTag.organization_id == org_id,
    ).order_by(MediaTagDefinition.sort_order).all()

    return {
        "tags": [_serialize_media_tag(t) for t in tags],
        "total": len(tags),
    }


@router.post("/api/organizations/{org_id}/media/{media_id}/tags", response_model=MediaTagOut, summary="Set media tag")
def set_media_tag(
    org_id: UUID,
    media_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """
    Set (or add) a media tag.

    Request body:
        definition_id: UUID (required)
        value_id:      UUID (optional — for controlled field types)
        tag_value:     str  (optional — display string; required for text/date,
                             used to look up / create nodes for controlled types)

    Behavior by field_type:
        - text / date: one row per (media, definition). Upsert by updating
          tag_value. ``value_id`` is ignored.
        - dropdown: single value from allowed list. If ``allow_multiple`` is
          False (the default), replaces any existing tag for this definition.
        - multi_select / category_tree: always multi-valued. Adds the value;
          if already present, returns the existing row (idempotent).
        - dynamic_keywords: looks up existing value, or auto-creates a new
          ``MediaTagValue`` row. Respects ``allow_multiple``.
    """
    raw_def = body.get("definition_id")
    if not raw_def:
        raise HTTPException(status_code=400, detail="definition_id is required")
    def_uuid = UUID(raw_def)

    raw_value_id = body.get("value_id")
    value_uuid = UUID(raw_value_id) if raw_value_id else None
    tag_value = (body.get("tag_value") or "").strip() or None

    media = db.query(Media).filter(
        Media.media_id == media_id,
        Media.organization_id == org_id,
    ).first()
    if not media:
        raise HTTPException(status_code=404, detail="Media not found")

    definition = db.query(MediaTagDefinition).filter(
        MediaTagDefinition.definition_id == def_uuid,
        MediaTagDefinition.organization_id == org_id,
        MediaTagDefinition.is_active == True,  # noqa: E712
    ).first()
    if not definition:
        raise HTTPException(status_code=404, detail="Tag definition not found")

    is_controlled = definition.field_type in _CONTROLLED_TYPES

    if is_controlled:
        node = _resolve_value(
            db,
            definition,
            value_id=value_uuid,
            tag_value=tag_value,
            user_id=auth.user_id,
            auto_create=(definition.field_type == "dynamic_keywords"),
        )
        if node is None:
            raise HTTPException(status_code=400, detail="value_id or tag_value is required")

        if definition.allow_multiple:
            existing = db.query(MediaTag).filter(
                MediaTag.media_id == media_id,
                MediaTag.definition_id == def_uuid,
                MediaTag.value_id == node.value_id,
            ).first()
            if existing:
                tag = existing
            else:
                tag = MediaTag(
                    organization_id=org_id,
                    media_id=media_id,
                    definition_id=def_uuid,
                    value_id=node.value_id,
                    tag_value=node.value,
                    created_by=auth.user_id,
                )
                db.add(tag)
        else:
            existing = db.query(MediaTag).filter(
                MediaTag.media_id == media_id,
                MediaTag.definition_id == def_uuid,
            ).first()
            if existing:
                existing.value_id = node.value_id
                existing.tag_value = node.value
                tag = existing
            else:
                tag = MediaTag(
                    organization_id=org_id,
                    media_id=media_id,
                    definition_id=def_uuid,
                    value_id=node.value_id,
                    tag_value=node.value,
                    created_by=auth.user_id,
                )
                db.add(tag)
    else:
        # text / date: single value per (media, definition).
        if not tag_value:
            raise HTTPException(status_code=400, detail="tag_value is required")
        existing = db.query(MediaTag).filter(
            MediaTag.media_id == media_id,
            MediaTag.definition_id == def_uuid,
            MediaTag.value_id.is_(None),
        ).first()
        if existing:
            existing.tag_value = tag_value
            tag = existing
        else:
            tag = MediaTag(
                organization_id=org_id,
                media_id=media_id,
                definition_id=def_uuid,
                tag_value=tag_value,
                created_by=auth.user_id,
            )
            db.add(tag)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Tag already exists for this media")

    db.refresh(tag)
    _reindex_media_for_tags(media, db)

    return _serialize_media_tag(tag)


@router.delete("/api/organizations/{org_id}/media/{media_id}/tags/{definition_id}", response_model=SuccessResponse, summary="Delete media tag")
def delete_media_tag(
    org_id: UUID,
    media_id: UUID,
    definition_id: UUID,
    value_id: str | None = Query(None, description="For multi-valued definitions, delete just this value. Omit to delete all tags for the definition."),
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete media tag(s) for a definition, optionally filtered to one value_id."""
    media = db.query(Media).filter(
        Media.media_id == media_id,
        Media.organization_id == org_id,
    ).first()
    if not media:
        raise HTTPException(status_code=404, detail="Media not found")

    query = db.query(MediaTag).filter(
        MediaTag.media_id == media_id,
        MediaTag.definition_id == definition_id,
    )
    if value_id:
        query = query.filter(MediaTag.value_id == UUID(value_id))

    tags = query.all()
    if not tags:
        raise HTTPException(status_code=404, detail="Tag not found")
    for t in tags:
        db.delete(t)
    db.commit()
    _reindex_media_for_tags(media, db)

    return {"success": True}


@router.put("/api/organizations/{org_id}/media/{media_id}/tags", response_model=MediaTagListResponse, summary="Bulk update media tags")
def bulk_update_media_tags(
    org_id: UUID,
    media_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """
    Replace the full set of tags for a media item.

    Body: ``{"tags": [{"definition_id", "value_id"?, "tag_value"?}, ...]}``

    Controlled definitions validate against MediaTagValue; dynamic_keywords
    auto-creates missing values. Text/date definitions use tag_value directly.
    """
    tags_data = body.get("tags", [])

    media = db.query(Media).filter(
        Media.media_id == media_id,
        Media.organization_id == org_id,
    ).first()
    if not media:
        raise HTTPException(status_code=404, detail="Media not found")

    # Remove all existing tags for this media, then reinsert from scratch.
    db.query(MediaTag).filter(MediaTag.media_id == media_id).delete(synchronize_session=False)

    new_tags: list[MediaTag] = []
    seen_single: set[UUID] = set()  # enforce single-value for non-multi controlled
    seen_pairs: set[tuple[UUID, UUID]] = set()  # (definition_id, value_id)

    for tag_data in tags_data:
        raw_def = tag_data.get("definition_id")
        if not raw_def:
            continue
        def_uuid = UUID(raw_def)

        definition = db.query(MediaTagDefinition).filter(
            MediaTagDefinition.definition_id == def_uuid,
            MediaTagDefinition.organization_id == org_id,
            MediaTagDefinition.is_active == True,  # noqa: E712
        ).first()
        if not definition:
            continue

        raw_value_id = tag_data.get("value_id")
        tag_value_in = (tag_data.get("tag_value") or "").strip() or None

        if definition.field_type in _CONTROLLED_TYPES:
            try:
                node = _resolve_value(
                    db,
                    definition,
                    value_id=UUID(raw_value_id) if raw_value_id else None,
                    tag_value=tag_value_in,
                    user_id=auth.user_id,
                    auto_create=(definition.field_type == "dynamic_keywords"),
                )
            except HTTPException:
                continue
            if node is None:
                continue
            if not definition.allow_multiple:
                if def_uuid in seen_single:
                    continue
                seen_single.add(def_uuid)
            if (def_uuid, node.value_id) in seen_pairs:
                continue
            seen_pairs.add((def_uuid, node.value_id))
            new_tags.append(MediaTag(
                organization_id=org_id,
                media_id=media_id,
                definition_id=def_uuid,
                value_id=node.value_id,
                tag_value=node.value,
                created_by=auth.user_id,
            ))
        else:
            if not tag_value_in:
                continue
            if def_uuid in seen_single:
                continue
            seen_single.add(def_uuid)
            new_tags.append(MediaTag(
                organization_id=org_id,
                media_id=media_id,
                definition_id=def_uuid,
                tag_value=tag_value_in,
                created_by=auth.user_id,
            ))

    for t in new_tags:
        db.add(t)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Duplicate tag in batch operation")

    _reindex_media_for_tags(media, db)

    return {
        "tags": [_serialize_media_tag(t, include_definition=False) for t in new_tags],
        "total": len(new_tags),
    }


# ============================================================================
# TAG VALUES (allowed values / "nodes")
# ============================================================================


def _require_definition(db: Session, org_id: UUID, definition_id: UUID) -> MediaTagDefinition:
    definition = db.query(MediaTagDefinition).filter(
        MediaTagDefinition.definition_id == definition_id,
        MediaTagDefinition.organization_id == org_id,
    ).first()
    if not definition:
        raise HTTPException(status_code=404, detail="Tag definition not found")
    return definition


@router.get(
    "/api/organizations/{org_id}/media/tag-definitions/{definition_id}/values",
    response_model=TagValueListResponse,
    summary="List allowed values for a tag definition",
)
def list_tag_values_for_definition(
    org_id: UUID,
    definition_id: UUID,
    include_inactive: bool = Query(False),
    include_usage: bool = Query(False),
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """
    List allowed values for a definition. For ``category_tree`` definitions
    values are returned in pre-order with a ``depth`` field.
    """
    definition = _require_definition(db, org_id, definition_id)

    query = db.query(MediaTagValue).filter(MediaTagValue.definition_id == definition_id)
    if not include_inactive:
        query = query.filter(MediaTagValue.is_active.is_(True))

    rows = query.order_by(MediaTagValue.sort_order, MediaTagValue.value).all()

    # Optional usage counts per value.
    usage_map: dict[UUID, int] = {}
    if include_usage:
        from sqlalchemy import func as _func
        counts = (
            db.query(MediaTag.value_id, _func.count(MediaTag.tag_id))
            .filter(
                MediaTag.organization_id == org_id,
                MediaTag.definition_id == definition_id,
                MediaTag.value_id.isnot(None),
            )
            .group_by(MediaTag.value_id)
            .all()
        )
        usage_map = {vid: int(cnt) for vid, cnt in counts}

    serialized: list[dict]
    if definition.field_type == "category_tree":
        # Build adjacency and pre-order with depth.
        children_by_parent: dict[UUID | None, list[MediaTagValue]] = {}
        for r in rows:
            children_by_parent.setdefault(r.parent_id, []).append(r)
        for lst in children_by_parent.values():
            lst.sort(key=lambda v: (v.sort_order, v.value))

        out: list[dict] = []

        def walk(parent_id: UUID | None, depth: int) -> None:
            for node in children_by_parent.get(parent_id, []):
                out.append(_serialize_tag_value(
                    node,
                    depth=depth,
                    usage_count=usage_map.get(node.value_id) if include_usage else None,
                ))
                walk(node.value_id, depth + 1)

        walk(None, 0)
        serialized = out
    else:
        serialized = [
            _serialize_tag_value(
                r,
                usage_count=usage_map.get(r.value_id) if include_usage else None,
            )
            for r in rows
        ]

    return {"values": serialized, "total": len(serialized)}


@router.post(
    "/api/organizations/{org_id}/media/tag-definitions/{definition_id}/values",
    response_model=TagValueOut,
    status_code=201,
    summary="Add allowed value to a tag definition",
)
def add_tag_value(
    org_id: UUID,
    definition_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    definition = _require_definition(db, org_id, definition_id)
    if definition.field_type not in _CONTROLLED_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot add values to a '{definition.field_type}' field",
        )

    value = (body.get("value") or "").strip()
    if not value:
        raise HTTPException(status_code=400, detail="value is required")

    parent_id_raw = body.get("parent_id")
    parent_uuid: UUID | None = None
    if parent_id_raw:
        if definition.field_type != "category_tree":
            raise HTTPException(status_code=400, detail="parent_id is only valid for category_tree")
        parent_uuid = UUID(parent_id_raw)
        parent = db.query(MediaTagValue).filter(
            MediaTagValue.value_id == parent_uuid,
            MediaTagValue.definition_id == definition_id,
        ).first()
        if not parent:
            raise HTTPException(status_code=400, detail="parent_id does not belong to this definition")

    node = MediaTagValue(
        definition_id=definition_id,
        parent_id=parent_uuid,
        value=value,
        sort_order=int(body.get("sort_order", 0)),
        is_active=bool(body.get("is_active", True)),
        created_by=auth.user_id,
    )
    db.add(node)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Value already exists at this level")
    db.refresh(node)
    return _serialize_tag_value(node)


@router.put(
    "/api/organizations/{org_id}/media/tag-definitions/{definition_id}/values/reorder",
    response_model=SuccessResponse,
    summary="Reorder allowed values within a parent",
)
def reorder_tag_values(
    org_id: UUID,
    definition_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Body: ``{"order": ["<value_id>", ...]}`` — order applies within each sibling group."""
    _require_definition(db, org_id, definition_id)
    order = body.get("order") or []
    for idx, value_id in enumerate(order):
        db.query(MediaTagValue).filter(
            MediaTagValue.value_id == UUID(value_id),
            MediaTagValue.definition_id == definition_id,
        ).update({MediaTagValue.sort_order: idx}, synchronize_session=False)
    db.commit()
    return {"success": True}


@router.put(
    "/api/organizations/{org_id}/media/tag-definitions/{definition_id}/values/{value_id}",
    response_model=TagValueOut,
    summary="Update allowed value",
)
def update_tag_value(
    org_id: UUID,
    definition_id: UUID,
    value_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    _require_definition(db, org_id, definition_id)
    node = db.query(MediaTagValue).filter(
        MediaTagValue.value_id == value_id,
        MediaTagValue.definition_id == definition_id,
    ).first()
    if not node:
        raise HTTPException(status_code=404, detail="Value not found")

    if "value" in body:
        new_value = (body.get("value") or "").strip()
        if not new_value:
            raise HTTPException(status_code=400, detail="value cannot be empty")
        node.value = new_value
    if "sort_order" in body:
        node.sort_order = int(body["sort_order"])
    if "is_active" in body:
        node.is_active = bool(body["is_active"])
    if "parent_id" in body:
        parent_raw = body["parent_id"]
        if parent_raw is None:
            node.parent_id = None
        else:
            parent_uuid = UUID(parent_raw)
            if parent_uuid == node.value_id:
                raise HTTPException(status_code=400, detail="A value cannot be its own parent")
            parent = db.query(MediaTagValue).filter(
                MediaTagValue.value_id == parent_uuid,
                MediaTagValue.definition_id == definition_id,
            ).first()
            if not parent:
                raise HTTPException(status_code=400, detail="parent_id does not belong to this definition")
            node.parent_id = parent_uuid

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Value conflict (duplicate sibling)")
    db.refresh(node)
    # If the canonical value string changed, keep denormalized MediaTag rows in sync.
    if "value" in body:
        db.query(MediaTag).filter(
            MediaTag.value_id == node.value_id,
            MediaTag.organization_id == org_id,
        ).update({MediaTag.tag_value: node.value}, synchronize_session=False)
        db.commit()
    return _serialize_tag_value(node)


@router.delete(
    "/api/organizations/{org_id}/media/tag-definitions/{definition_id}/values/{value_id}",
    response_model=SuccessResponse,
    summary="Delete or deprecate an allowed value",
)
def delete_tag_value(
    org_id: UUID,
    definition_id: UUID,
    value_id: UUID,
    hard_delete: bool = Query(False),
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """
    Soft-delete (deprecate) by default. Pass ``hard_delete=true`` to remove
    the value and cascade-delete any MediaTag rows referencing it.
    """
    _require_definition(db, org_id, definition_id)
    node = db.query(MediaTagValue).filter(
        MediaTagValue.value_id == value_id,
        MediaTagValue.definition_id == definition_id,
    ).first()
    if not node:
        raise HTTPException(status_code=404, detail="Value not found")

    if hard_delete:
        db.delete(node)
    else:
        node.is_active = False
    db.commit()
    return {"success": True}


@router.get("/api/organizations/{org_id}/media/tags/values", response_model=TagValuesResponse, summary="Legacy autocomplete (flat strings)")
def get_tag_values(
    org_id: UUID,
    definition_id: str = Query(...),
    prefix: str = Query(""),
    limit: int = Query(50, ge=1, le=100),
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """
    Legacy flat-string autocomplete. Pulls from MediaTagValue (controlled)
    when available, falling back to distinct MediaTag.tag_value (for text
    fields). New callers should prefer
    ``GET /tag-definitions/{definition_id}/values`` which returns full objects.
    """
    def_uuid = UUID(definition_id)
    definition = _require_definition(db, org_id, def_uuid)

    if definition.field_type in _CONTROLLED_TYPES:
        query = db.query(MediaTagValue.value).filter(
            MediaTagValue.definition_id == def_uuid,
            MediaTagValue.is_active.is_(True),
        )
        if prefix:
            escaped = escape_ilike(prefix)
            query = query.filter(MediaTagValue.value.ilike(f"{escaped}%", escape="\\"))
        values = query.order_by(MediaTagValue.sort_order, MediaTagValue.value).limit(limit).all()
    else:
        query = db.query(MediaTag.tag_value).filter(
            MediaTag.organization_id == org_id,
            MediaTag.definition_id == def_uuid,
        ).distinct()
        if prefix:
            escaped = escape_ilike(prefix)
            query = query.filter(MediaTag.tag_value.ilike(f"{escaped}%", escape="\\"))
        values = query.order_by(MediaTag.tag_value).limit(limit).all()

    return {
        "values": [v[0] for v in values],
        "total": len(values),
    }
