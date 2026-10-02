"""
Content CMS Admin API — FastAPI router.

Migrated from app/api/content_admin.py (21 routes).
Provides authenticated CRUD operations for CMS pages, blog posts,
content blocks, categories, menus, and redirects.
All endpoints are org-scoped and protected by content.* permissions.
"""

import hashlib
import hmac
import logging
import re
import uuid
from datetime import datetime, timezone, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_auth, require_permission
from app.fastapi_app.schemas.content_admin import (
    CategoryDataResponse,
    CategoryListResponse,
    ContentBlockListResponse,
    ContentPageDataResponse,
    ContentPageListResponse,
    CreateCategoryBody,
    CreatePageBody,
    CreateRedirectBody,
    MenuDataResponse,
    PageTreeResponse,
    PreviewTokenResponse,
    PublishBody,
    RedirectDataResponse,
    RedirectListResponse,
    ReplaceBlocksBody,
    SaveMenuBody,
    UpdateCategoryBody,
    UpdatePageBody,
    UpdateRedirectBody,
)
from app.models import Page, ContentBlock, Category, PageCategory, Menu, MenuItem, Redirect
from app.permissions import Permission
from app.services.api_security import escape_ilike
from app.services.public_cache import invalidate_org_cache_by_id
from app.services.rls import set_rls_context_for_session

logger = logging.getLogger(__name__)

router = APIRouter(tags=["content-admin"])


# =============================================================================
# Helpers
# =============================================================================

def _slugify(text: str) -> str:
    """Generate a URL-safe slug from text."""
    slug = text.lower().strip()
    slug = re.sub(r'[^\w\s-]', '', slug)
    slug = re.sub(r'[\s_]+', '-', slug)
    slug = re.sub(r'-+', '-', slug)
    return slug.strip('-')[:255]


def _serialize_page(page: Page, include_blocks: bool = False) -> dict:
    """Serialize a page to dict."""
    data = {
        "page_id": str(page.page_id),
        "organization_id": str(page.organization_id),
        "slug": page.slug,
        "title": page.title,
        "page_type": page.page_type,
        "status": page.status,
        "published_at": page.published_at.isoformat() if page.published_at else None,
        "publish_at": page.publish_at.isoformat() if page.publish_at else None,
        "author_id": str(page.author_id) if page.author_id else None,
        "featured_image_media_id": str(page.featured_image_media_id) if page.featured_image_media_id else None,
        "og_image_media_id": str(page.og_image_media_id) if page.og_image_media_id else None,
        "excerpt": page.excerpt,
        "meta_title": page.meta_title,
        "meta_description": page.meta_description,
        "template": page.template,
        "parent_page_id": str(page.parent_page_id) if page.parent_page_id else None,
        "sort_order": page.sort_order,
        "created_at": page.created_at.isoformat() if page.created_at else None,
        "updated_at": page.updated_at.isoformat() if page.updated_at else None,
        "created_by": str(page.created_by) if page.created_by else None,
        "updated_by": str(page.updated_by) if page.updated_by else None,
    }
    if include_blocks:
        data["blocks"] = [_serialize_block(b) for b in page.blocks]
    return data


def _serialize_block(block: ContentBlock) -> dict:
    """Serialize a content block."""
    return {
        "block_id": str(block.block_id),
        "page_id": str(block.page_id),
        "block_type": block.block_type,
        "content": block.content or {},
        "sort_order": block.sort_order,
    }


def _serialize_category(cat: Category) -> dict:
    """Serialize a category."""
    return {
        "category_id": str(cat.category_id),
        "organization_id": str(cat.organization_id),
        "name": cat.name,
        "slug": cat.slug,
        "description": cat.description,
        "sort_order": cat.sort_order,
        "created_at": cat.created_at.isoformat() if cat.created_at else None,
        "updated_at": cat.updated_at.isoformat() if cat.updated_at else None,
    }


def _serialize_menu_item(item: MenuItem) -> dict:
    """Serialize a single menu item."""
    return {
        "menu_item_id": str(item.menu_item_id),
        "label": item.label,
        "link_type": item.link_type,
        "page_id": str(item.page_id) if item.page_id else None,
        "url": item.url,
        "sort_order": item.sort_order,
        "description": item.description,
        "image_media_id": str(item.image_media_id) if item.image_media_id else None,
        "highlight": item.highlight,
    }


def _serialize_menu_items_tree(items: list[MenuItem]) -> list[dict]:
    """Build a nested tree of menu items from a flat list."""
    top_level = [i for i in items if i.parent_item_id is None]
    children_by_parent: dict[str, list[MenuItem]] = {}
    for item in items:
        if item.parent_item_id:
            key = str(item.parent_item_id)
            children_by_parent.setdefault(key, []).append(item)

    result = []
    for item in sorted(top_level, key=lambda i: i.sort_order):
        data = _serialize_menu_item(item)
        kids = children_by_parent.get(str(item.menu_item_id), [])
        data["children"] = [
            _serialize_menu_item(c)
            for c in sorted(kids, key=lambda c: c.sort_order)
        ]
        result.append(data)
    return result


def _serialize_menu(menu: Menu) -> dict:
    """Serialize a menu with its nested items."""
    return {
        "menu_id": str(menu.menu_id),
        "location": menu.location,
        "name": menu.name,
        "items": _serialize_menu_items_tree(menu.items),
    }


def _serialize_redirect(r: Redirect) -> dict:
    """Serialize a redirect."""
    return {
        "redirect_id": str(r.redirect_id),
        "organization_id": str(r.organization_id),
        "source_path": r.source_path,
        "target_path": r.target_path,
        "redirect_type": r.redirect_type,
        "is_active": r.is_active,
        "note": r.note,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
        "created_by": str(r.created_by) if r.created_by else None,
    }


def _generate_preview_token(page_id: str, expires_iso: str) -> str:
    """Generate HMAC-based signed preview token."""
    from app.config import get_settings
    settings = get_settings()
    key = settings.secret_key.encode("utf-8")
    message = f"preview:{page_id}:{expires_iso}".encode("utf-8")
    return hmac.new(key, message, hashlib.sha256).hexdigest()


VALID_PAGE_TYPES = {"page", "post"}
VALID_STATUSES = {"draft", "published", "archived"}
VALID_TEMPLATES = {"default", "full_width", "sidebar", "landing"}
VALID_MENU_LOCATIONS = {"header", "footer"}
VALID_LINK_TYPES = {"page", "url", "collection", "category", "exhibition", "event"}
VALID_BLOCK_TYPES = {
    "rich_text", "image", "hero_banner", "gallery", "video",
    "divider", "quote", "html", "call_to_action",
    # Phase 2: museum-specific blocks
    "collection_grid", "object_spotlight", "exhibition_preview",
    "staff_grid", "event_list", "map", "accordion", "columns",
    # Phase 6: extended blocks
    "newsletter_signup", "membership_cta", "venue_card", "exhibition_grid",
    "event_calendar", "testimonial", "social_embed", "sponsor_grid",
    "countdown", "tabs", "form", "gallery_3d",
}


# =============================================================================
# Pages CRUD
# =============================================================================


@router.get("/api/organizations/{organization_id}/content/pages", response_model=ContentPageListResponse, summary="List pages")
def list_pages(
    organization_id: UUID,
    page_type: str | None = Query(None),
    status: str | None = Query(None),
    search: str | None = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.CONTENT_VIEW)),
    db: Session = Depends(get_db),
):
    """List all pages (including drafts) for the organization."""
    set_rls_context_for_session(db, str(organization_id), str(auth.user_id))

    query = db.query(Page).filter(Page.organization_id == organization_id)

    if page_type and page_type in VALID_PAGE_TYPES:
        query = query.filter(Page.page_type == page_type)
    if status and status in VALID_STATUSES:
        query = query.filter(Page.status == status)
    if search:
        search = search.strip()
        if search:
            query = query.filter(Page.title.ilike(f"%{escape_ilike(search)}%", escape="\\"))

    total = query.count()
    pages = (
        query
        .order_by(Page.updated_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    return {
        "items": [_serialize_page(p) for p in pages],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("/api/organizations/{organization_id}/content/pages", status_code=201, response_model=ContentPageDataResponse, summary="Create page")
def create_page(
    organization_id: UUID,
    body: CreatePageBody,
    auth: AuthContext = Depends(require_permission(Permission.CONTENT_EDIT)),
    db: Session = Depends(get_db),
):
    """Create a new page or blog post."""
    set_rls_context_for_session(db, str(organization_id), str(auth.user_id))

    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "Title is required",
            "field": "title",
        })

    slug = (body.slug or "").strip() or _slugify(title)
    page_type = body.page_type
    if page_type not in VALID_PAGE_TYPES:
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": f"Invalid page_type: {page_type}",
            "field": "page_type",
        })

    # Check for duplicate slug
    existing = db.query(Page).filter(
        Page.organization_id == organization_id,
        Page.slug == slug,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail={
            "code": "conflict",
            "message": f"A page with slug '{slug}' already exists",
        })

    template = body.template
    if template and template not in VALID_TEMPLATES:
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": f"Invalid template: {template}",
            "field": "template",
        })

    # Parse publish_at if provided
    publish_at = None
    if body.publish_at:
        try:
            publish_at = datetime.fromisoformat(body.publish_at.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            raise HTTPException(status_code=422, detail={
                "code": "validation_error",
                "message": "Invalid publish_at datetime",
                "field": "publish_at",
            })

    page = Page(
        page_id=uuid.uuid4(),
        organization_id=organization_id,
        slug=slug,
        title=title,
        page_type=page_type,
        status="draft",
        template=template,
        excerpt=body.excerpt,
        meta_title=body.meta_title,
        meta_description=body.meta_description,
        featured_image_media_id=body.featured_image_media_id,
        og_image_media_id=body.og_image_media_id,
        parent_page_id=body.parent_page_id,
        sort_order=body.sort_order,
        publish_at=publish_at,
        author_id=auth.user_id,
        created_by=auth.user_id,
        updated_by=auth.user_id,
    )

    db.add(page)

    # Create initial blocks if provided
    for i, block_data in enumerate(body.blocks):
        block_type = block_data.get("block_type", "")
        if block_type not in VALID_BLOCK_TYPES:
            continue
        block = ContentBlock(
            block_id=uuid.uuid4(),
            page_id=page.page_id,
            organization_id=organization_id,
            block_type=block_type,
            content=block_data.get("content", {}),
            sort_order=i,
        )
        db.add(block)

    db.commit()

    # Re-query to get blocks in the response
    db.refresh(page)
    return {"data": _serialize_page(page, include_blocks=True)}


@router.get("/api/organizations/{organization_id}/content/pages/tree", response_model=PageTreeResponse, summary="Get page tree")
def get_page_tree(
    organization_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.CONTENT_VIEW)),
    db: Session = Depends(get_db),
):
    """Get all pages as a nested tree (for hierarchy view and menu builder)."""
    set_rls_context_for_session(db, str(organization_id), str(auth.user_id))

    pages = (
        db.query(Page)
        .filter(
            Page.organization_id == organization_id,
            Page.page_type == "page",
        )
        .order_by(Page.sort_order, Page.title)
        .all()
    )

    # Build tree
    pages_by_id = {str(p.page_id): p for p in pages}
    children_map: dict[str, list[Page]] = {}
    roots: list[Page] = []

    for p in pages:
        parent_id = str(p.parent_page_id) if p.parent_page_id else None
        if parent_id and parent_id in pages_by_id:
            children_map.setdefault(parent_id, []).append(p)
        else:
            roots.append(p)

    def _build_node(page: Page, depth: int = 0) -> dict:
        node = {
            "page_id": str(page.page_id),
            "slug": page.slug,
            "title": page.title,
            "status": page.status,
            "template": page.template,
            "sort_order": page.sort_order,
            "depth": depth,
            "updated_at": page.updated_at.isoformat() if page.updated_at else None,
        }
        kids = children_map.get(str(page.page_id), [])
        node["children"] = [_build_node(c, depth + 1) for c in kids]
        return node

    tree = [_build_node(r) for r in roots]
    return {"data": tree}


@router.get("/api/organizations/{organization_id}/content/pages/{page_id}", response_model=ContentPageDataResponse, summary="Get page")
def get_page(
    organization_id: UUID,
    page_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.CONTENT_VIEW)),
    db: Session = Depends(get_db),
):
    """Get a single page with its blocks."""
    set_rls_context_for_session(db, str(organization_id), str(auth.user_id))

    page = db.query(Page).filter(
        Page.page_id == page_id,
        Page.organization_id == organization_id,
    ).first()

    if not page:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": f"Page {page_id} not found",
        })

    data = _serialize_page(page, include_blocks=True)

    # Include categories for posts
    if page.page_type == "post":
        categories = (
            db.query(Category)
            .join(PageCategory, PageCategory.category_id == Category.category_id)
            .filter(PageCategory.page_id == page.page_id)
            .order_by(Category.sort_order)
            .all()
        )
        data["categories"] = [_serialize_category(c) for c in categories]

    return {"data": data}


@router.put("/api/organizations/{organization_id}/content/pages/{page_id}", response_model=ContentPageDataResponse, summary="Update page")
def update_page(
    organization_id: UUID,
    page_id: UUID,
    body: UpdatePageBody,
    auth: AuthContext = Depends(require_permission(Permission.CONTENT_EDIT)),
    db: Session = Depends(get_db),
):
    """Update a page's metadata (not blocks -- use PUT /blocks for that)."""
    set_rls_context_for_session(db, str(organization_id), str(auth.user_id))

    page = db.query(Page).filter(
        Page.page_id == page_id,
        Page.organization_id == organization_id,
    ).first()

    if not page:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": f"Page {page_id} not found",
        })

    # Update fields
    if body.title is not None:
        title = body.title.strip()
        if not title:
            raise HTTPException(status_code=422, detail={
                "code": "validation_error",
                "message": "Title cannot be empty",
                "field": "title",
            })
        page.title = title

    if body.slug is not None:
        new_slug = body.slug.strip()
        if new_slug and new_slug != page.slug:
            existing = db.query(Page).filter(
                Page.organization_id == organization_id,
                Page.slug == new_slug,
                Page.page_id != page.page_id,
            ).first()
            if existing:
                raise HTTPException(status_code=409, detail={
                    "code": "conflict",
                    "message": f"A page with slug '{new_slug}' already exists",
                })

            # Auto-create redirect from old slug to new slug
            old_slug = page.slug
            prefix = "/pages" if page.page_type == "page" else "/blog"
            old_path = f"{prefix}/{old_slug}"
            new_path = f"{prefix}/{new_slug}"

            # Upsert: update existing redirect or create new one
            existing_redirect = db.query(Redirect).filter(
                Redirect.organization_id == organization_id,
                Redirect.source_path == old_path,
            ).first()
            if existing_redirect:
                existing_redirect.target_path = new_path
                existing_redirect.is_active = True
            else:
                db.add(Redirect(
                    organization_id=organization_id,
                    source_path=old_path,
                    target_path=new_path,
                    redirect_type=301,
                    is_active=True,
                    note="Auto-created on slug change",
                    created_by=auth.user_id,
                ))

            # Collapse redirect chains: update any redirect pointing to old_path
            db.query(Redirect).filter(
                Redirect.organization_id == organization_id,
                Redirect.target_path == old_path,
                Redirect.is_active == True,
            ).update({"target_path": new_path})

            page.slug = new_slug

    if body.excerpt is not None:
        page.excerpt = body.excerpt
    if body.meta_title is not None:
        page.meta_title = body.meta_title
    if body.meta_description is not None:
        page.meta_description = body.meta_description
    if body.template is not None:
        if body.template and body.template not in VALID_TEMPLATES:
            raise HTTPException(status_code=422, detail={
                "code": "validation_error",
                "message": f"Invalid template: {body.template}",
                "field": "template",
            })
        page.template = body.template
    if body.featured_image_media_id is not None:
        page.featured_image_media_id = body.featured_image_media_id
    if body.og_image_media_id is not None:
        page.og_image_media_id = body.og_image_media_id
    if body.publish_at is not None:
        if body.publish_at:
            try:
                page.publish_at = datetime.fromisoformat(body.publish_at.replace("Z", "+00:00"))
            except (ValueError, AttributeError):
                raise HTTPException(status_code=422, detail={
                    "code": "validation_error",
                    "message": "Invalid publish_at datetime",
                    "field": "publish_at",
                })
        else:
            page.publish_at = None
    if body.parent_page_id is not None:
        page.parent_page_id = body.parent_page_id
    if body.sort_order is not None:
        page.sort_order = body.sort_order

    # Update categories for posts
    if body.category_ids is not None and page.page_type == "post":
        # Remove existing
        db.query(PageCategory).filter(
            PageCategory.page_id == page.page_id,
        ).delete()
        # Add new
        for cat_id in body.category_ids:
            db.add(PageCategory(
                page_id=page.page_id,
                category_id=cat_id,
            ))

    page.updated_by = auth.user_id
    db.commit()
    db.refresh(page)

    return {"data": _serialize_page(page, include_blocks=True)}


@router.delete("/api/organizations/{organization_id}/content/pages/{page_id}", summary="Delete page")
def delete_page(
    organization_id: UUID,
    page_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.CONTENT_DELETE)),
    db: Session = Depends(get_db),
):
    """Delete a page and all its blocks."""
    set_rls_context_for_session(db, str(organization_id), str(auth.user_id))

    page = db.query(Page).filter(
        Page.page_id == page_id,
        Page.organization_id == organization_id,
    ).first()

    if not page:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": f"Page {page_id} not found",
        })

    db.delete(page)
    db.commit()
    invalidate_org_cache_by_id(organization_id)

    return Response(status_code=204)


# =============================================================================
# Blocks -- full save (replace all blocks for a page)
# =============================================================================


@router.put("/api/organizations/{organization_id}/content/pages/{page_id}/blocks", response_model=ContentBlockListResponse, summary="Replace blocks")
def replace_blocks(
    organization_id: UUID,
    page_id: UUID,
    body: ReplaceBlocksBody,
    auth: AuthContext = Depends(require_permission(Permission.CONTENT_EDIT)),
    db: Session = Depends(get_db),
):
    """Replace all blocks for a page (full save from editor)."""
    set_rls_context_for_session(db, str(organization_id), str(auth.user_id))

    page = db.query(Page).filter(
        Page.page_id == page_id,
        Page.organization_id == organization_id,
    ).first()

    if not page:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": f"Page {page_id} not found",
        })

    # Delete existing blocks
    db.query(ContentBlock).filter(
        ContentBlock.page_id == page.page_id,
    ).delete()

    # Create new blocks
    new_blocks = []
    for i, block_data in enumerate(body.blocks):
        block_type = block_data.get("block_type", "")
        if block_type not in VALID_BLOCK_TYPES:
            raise HTTPException(status_code=422, detail={
                "code": "validation_error",
                "message": f"Invalid block_type: {block_type}",
                "field": f"blocks[{i}].block_type",
            })
        block = ContentBlock(
            block_id=UUID(block_data["block_id"]) if block_data.get("block_id") else uuid.uuid4(),
            page_id=page.page_id,
            organization_id=organization_id,
            block_type=block_type,
            content=block_data.get("content", {}),
            sort_order=i,
        )
        db.add(block)
        new_blocks.append(block)

    page.updated_by = auth.user_id
    db.commit()
    invalidate_org_cache_by_id(organization_id)

    return {"data": [_serialize_block(b) for b in new_blocks]}


# =============================================================================
# Publish / Unpublish
# =============================================================================


@router.post("/api/organizations/{organization_id}/content/pages/{page_id}/publish", response_model=ContentPageDataResponse, summary="Publish page")
def publish_page(
    organization_id: UUID,
    page_id: UUID,
    body: PublishBody | None = None,
    auth: AuthContext = Depends(require_permission(Permission.CONTENT_PUBLISH)),
    db: Session = Depends(get_db),
):
    """Publish a page -- sets status to 'published' and published_at if not already set."""
    set_rls_context_for_session(db, str(organization_id), str(auth.user_id))

    page = db.query(Page).filter(
        Page.page_id == page_id,
        Page.organization_id == organization_id,
    ).first()

    if not page:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": f"Page {page_id} not found",
        })

    publish_at = body.publish_at if body else None

    if publish_at:
        # Scheduled publish -- keep as draft, Celery will flip status
        try:
            page.publish_at = datetime.fromisoformat(publish_at.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            raise HTTPException(status_code=422, detail={
                "code": "validation_error",
                "message": "Invalid publish_at datetime",
                "field": "publish_at",
            })
        page.updated_by = auth.user_id
    else:
        # Immediate publish
        page.status = "published"
        if not page.published_at:
            page.published_at = datetime.now(timezone.utc)
        page.publish_at = None  # Clear any existing schedule
        page.updated_by = auth.user_id

    db.commit()
    invalidate_org_cache_by_id(organization_id)
    return {"data": _serialize_page(page)}


@router.post("/api/organizations/{organization_id}/content/pages/{page_id}/unpublish", response_model=ContentPageDataResponse, summary="Unpublish page")
def unpublish_page(
    organization_id: UUID,
    page_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.CONTENT_PUBLISH)),
    db: Session = Depends(get_db),
):
    """Unpublish a page -- sets status back to 'draft'."""
    set_rls_context_for_session(db, str(organization_id), str(auth.user_id))

    page = db.query(Page).filter(
        Page.page_id == page_id,
        Page.organization_id == organization_id,
    ).first()

    if not page:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": f"Page {page_id} not found",
        })

    page.status = "draft"
    page.updated_by = auth.user_id

    db.commit()
    invalidate_org_cache_by_id(organization_id)
    return {"data": _serialize_page(page)}


# =============================================================================
# Preview Token
# =============================================================================


@router.post("/api/organizations/{organization_id}/content/pages/{page_id}/preview-token", response_model=PreviewTokenResponse, summary="Create preview token")
def create_preview_token(
    organization_id: UUID,
    page_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.CONTENT_VIEW)),
    db: Session = Depends(get_db),
):
    """Generate a signed preview URL token (1 hour expiry)."""
    set_rls_context_for_session(db, str(organization_id), str(auth.user_id))

    page = db.query(Page).filter(
        Page.page_id == page_id,
        Page.organization_id == organization_id,
    ).first()

    if not page:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": f"Page {page_id} not found",
        })

    expires = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    token = _generate_preview_token(str(page_id), expires)

    return {
        "data": {
            "preview_token": token,
            "preview_expires": expires,
            "page_id": str(page_id),
        }
    }


# =============================================================================
# Categories CRUD
# =============================================================================


@router.get("/api/organizations/{organization_id}/content/categories", response_model=CategoryListResponse, summary="List admin categories")
def list_admin_categories(
    organization_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.CONTENT_VIEW)),
    db: Session = Depends(get_db),
):
    """List all categories."""
    set_rls_context_for_session(db, str(organization_id), str(auth.user_id))

    categories = (
        db.query(Category)
        .filter(Category.organization_id == organization_id)
        .order_by(Category.sort_order, Category.name)
        .all()
    )

    return {"data": [_serialize_category(c) for c in categories]}


@router.post("/api/organizations/{organization_id}/content/categories", status_code=201, response_model=CategoryDataResponse, summary="Create category")
def create_category(
    organization_id: UUID,
    body: CreateCategoryBody,
    auth: AuthContext = Depends(require_permission(Permission.CONTENT_EDIT)),
    db: Session = Depends(get_db),
):
    """Create a new category."""
    set_rls_context_for_session(db, str(organization_id), str(auth.user_id))

    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "Name is required",
            "field": "name",
        })

    slug = (body.slug or "").strip() or _slugify(name)

    existing = db.query(Category).filter(
        Category.organization_id == organization_id,
        Category.slug == slug,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail={
            "code": "conflict",
            "message": f"Category with slug '{slug}' already exists",
        })

    cat = Category(
        category_id=uuid.uuid4(),
        organization_id=organization_id,
        name=name,
        slug=slug,
        description=body.description,
        sort_order=body.sort_order,
    )
    db.add(cat)
    db.commit()
    invalidate_org_cache_by_id(organization_id, section="categories")

    return {"data": _serialize_category(cat)}


@router.put("/api/organizations/{organization_id}/content/categories/{category_id}", response_model=CategoryDataResponse, summary="Update category")
def update_category(
    organization_id: UUID,
    category_id: UUID,
    body: UpdateCategoryBody,
    auth: AuthContext = Depends(require_permission(Permission.CONTENT_EDIT)),
    db: Session = Depends(get_db),
):
    """Update a category."""
    set_rls_context_for_session(db, str(organization_id), str(auth.user_id))

    cat = db.query(Category).filter(
        Category.category_id == category_id,
        Category.organization_id == organization_id,
    ).first()

    if not cat:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": f"Category {category_id} not found",
        })

    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=422, detail={
                "code": "validation_error",
                "message": "Name cannot be empty",
                "field": "name",
            })
        cat.name = name

    if body.slug is not None:
        new_slug = body.slug.strip()
        if new_slug and new_slug != cat.slug:
            existing = db.query(Category).filter(
                Category.organization_id == organization_id,
                Category.slug == new_slug,
                Category.category_id != cat.category_id,
            ).first()
            if existing:
                raise HTTPException(status_code=409, detail={
                    "code": "conflict",
                    "message": f"Category with slug '{new_slug}' already exists",
                })
            cat.slug = new_slug

    if body.description is not None:
        cat.description = body.description
    if body.sort_order is not None:
        cat.sort_order = body.sort_order

    db.commit()
    invalidate_org_cache_by_id(organization_id, section="categories")
    return {"data": _serialize_category(cat)}


@router.delete("/api/organizations/{organization_id}/content/categories/{category_id}", summary="Delete category")
def delete_category(
    organization_id: UUID,
    category_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.CONTENT_DELETE)),
    db: Session = Depends(get_db),
):
    """Delete a category."""
    set_rls_context_for_session(db, str(organization_id), str(auth.user_id))

    cat = db.query(Category).filter(
        Category.category_id == category_id,
        Category.organization_id == organization_id,
    ).first()

    if not cat:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": f"Category {category_id} not found",
        })

    db.delete(cat)
    db.commit()
    invalidate_org_cache_by_id(organization_id, section="categories")

    return Response(status_code=204)


# =============================================================================
# Menus CRUD
# =============================================================================


@router.get("/api/organizations/{organization_id}/content/menus/{location}", response_model=MenuDataResponse, summary="Get menu")
def get_menu(
    organization_id: UUID,
    location: str,
    auth: AuthContext = Depends(require_permission(Permission.CONTENT_VIEW)),
    db: Session = Depends(get_db),
):
    """Get a menu by location (header/footer) with nested items."""
    set_rls_context_for_session(db, str(organization_id), str(auth.user_id))

    if location not in VALID_MENU_LOCATIONS:
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": f"Invalid menu location: {location}",
        })

    menu = db.query(Menu).filter(
        Menu.organization_id == organization_id,
        Menu.location == location,
    ).first()

    if not menu:
        return {"data": {"location": location, "name": "", "items": []}}

    return {"data": _serialize_menu(menu)}


@router.put("/api/organizations/{organization_id}/content/menus/{location}", response_model=MenuDataResponse, summary="Save menu")
def save_menu(
    organization_id: UUID,
    location: str,
    body: SaveMenuBody,
    auth: AuthContext = Depends(require_permission(Permission.CONTENT_EDIT)),
    db: Session = Depends(get_db),
):
    """Upsert a menu -- full replace of all items."""
    set_rls_context_for_session(db, str(organization_id), str(auth.user_id))

    if location not in VALID_MENU_LOCATIONS:
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": f"Invalid menu location: {location}",
        })

    # Upsert menu
    menu = db.query(Menu).filter(
        Menu.organization_id == organization_id,
        Menu.location == location,
    ).first()

    if not menu:
        menu = Menu(
            menu_id=uuid.uuid4(),
            organization_id=organization_id,
            location=location,
            name=body.name or "",
        )
        db.add(menu)
        db.flush()
    else:
        menu.name = body.name if body.name is not None else menu.name
        # Delete existing items (full replace)
        db.query(MenuItem).filter(
            MenuItem.menu_id == menu.menu_id,
        ).delete()

    # Create new items from nested tree
    for i, item_data in enumerate(body.items):
        link_type = item_data.get("link_type", "url")
        if link_type not in VALID_LINK_TYPES:
            continue
        parent = MenuItem(
            menu_item_id=uuid.uuid4(),
            menu_id=menu.menu_id,
            organization_id=organization_id,
            parent_item_id=None,
            label=(item_data.get("label") or "").strip()[:100],
            link_type=link_type,
            page_id=UUID(item_data["page_id"]) if item_data.get("page_id") else None,
            url=item_data.get("url"),
            sort_order=i,
            description=item_data.get("description"),
            image_media_id=UUID(item_data["image_media_id"]) if item_data.get("image_media_id") else None,
            highlight=bool(item_data.get("highlight", False)),
        )
        db.add(parent)
        db.flush()

        # Children (one level of nesting -- supports 2 levels total)
        for j, child_data in enumerate(item_data.get("children", [])):
            child_link_type = child_data.get("link_type", "url")
            if child_link_type not in VALID_LINK_TYPES:
                continue
            child = MenuItem(
                menu_item_id=uuid.uuid4(),
                menu_id=menu.menu_id,
                organization_id=organization_id,
                parent_item_id=parent.menu_item_id,
                label=(child_data.get("label") or "").strip()[:100],
                link_type=child_link_type,
                page_id=UUID(child_data["page_id"]) if child_data.get("page_id") else None,
                url=child_data.get("url"),
                sort_order=j,
                description=child_data.get("description"),
                image_media_id=UUID(child_data["image_media_id"]) if child_data.get("image_media_id") else None,
                highlight=bool(child_data.get("highlight", False)),
            )
            db.add(child)

    db.commit()
    db.refresh(menu)
    invalidate_org_cache_by_id(organization_id, section="menu")

    return {"data": _serialize_menu(menu)}


@router.delete("/api/organizations/{organization_id}/content/menus/{location}", summary="Delete menu")
def delete_menu(
    organization_id: UUID,
    location: str,
    auth: AuthContext = Depends(require_permission(Permission.CONTENT_DELETE)),
    db: Session = Depends(get_db),
):
    """Delete a menu and all its items."""
    set_rls_context_for_session(db, str(organization_id), str(auth.user_id))

    if location not in VALID_MENU_LOCATIONS:
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": f"Invalid menu location: {location}",
        })

    menu = db.query(Menu).filter(
        Menu.organization_id == organization_id,
        Menu.location == location,
    ).first()

    if not menu:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": f"Menu for '{location}' not found",
        })

    db.delete(menu)
    db.commit()
    invalidate_org_cache_by_id(organization_id, section="menu")

    return Response(status_code=204)


# =============================================================================
# Redirects CRUD
# =============================================================================


@router.get("/api/organizations/{organization_id}/content/redirects", response_model=RedirectListResponse, summary="List redirects")
def list_redirects(
    organization_id: UUID,
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.CONTENT_VIEW)),
    db: Session = Depends(get_db),
):
    """List all redirects for the organization."""
    set_rls_context_for_session(db, str(organization_id), str(auth.user_id))

    query = db.query(Redirect).filter(Redirect.organization_id == organization_id)
    total = query.count()
    redirects = (
        query
        .order_by(Redirect.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    return {
        "items": [_serialize_redirect(r) for r in redirects],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("/api/organizations/{organization_id}/content/redirects", status_code=201, response_model=RedirectDataResponse, summary="Create redirect")
def create_redirect(
    organization_id: UUID,
    body: CreateRedirectBody,
    auth: AuthContext = Depends(require_permission(Permission.CONTENT_EDIT)),
    db: Session = Depends(get_db),
):
    """Create a new redirect."""
    set_rls_context_for_session(db, str(organization_id), str(auth.user_id))

    source_path = body.source_path.strip()
    target_path = body.target_path.strip()
    if not source_path or not target_path:
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "source_path and target_path are required",
        })

    redirect_type = body.redirect_type
    if redirect_type not in (301, 302):
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "redirect_type must be 301 or 302",
            "field": "redirect_type",
        })

    # Check uniqueness
    existing = db.query(Redirect).filter(
        Redirect.organization_id == organization_id,
        Redirect.source_path == source_path,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail={
            "code": "conflict",
            "message": f"A redirect for '{source_path}' already exists",
        })

    redirect = Redirect(
        redirect_id=uuid.uuid4(),
        organization_id=organization_id,
        source_path=source_path,
        target_path=target_path,
        redirect_type=redirect_type,
        is_active=body.is_active,
        note=body.note,
        created_by=auth.user_id,
    )
    db.add(redirect)
    db.commit()

    return {"data": _serialize_redirect(redirect)}


@router.put("/api/organizations/{organization_id}/content/redirects/{redirect_id}", response_model=RedirectDataResponse, summary="Update redirect")
def update_redirect(
    organization_id: UUID,
    redirect_id: UUID,
    body: UpdateRedirectBody,
    auth: AuthContext = Depends(require_permission(Permission.CONTENT_EDIT)),
    db: Session = Depends(get_db),
):
    """Update a redirect."""
    set_rls_context_for_session(db, str(organization_id), str(auth.user_id))

    redirect = db.query(Redirect).filter(
        Redirect.redirect_id == redirect_id,
        Redirect.organization_id == organization_id,
    ).first()

    if not redirect:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": f"Redirect {redirect_id} not found",
        })

    if body.source_path is not None:
        new_source = body.source_path.strip()
        if new_source and new_source != redirect.source_path:
            existing = db.query(Redirect).filter(
                Redirect.organization_id == organization_id,
                Redirect.source_path == new_source,
                Redirect.redirect_id != redirect.redirect_id,
            ).first()
            if existing:
                raise HTTPException(status_code=409, detail={
                    "code": "conflict",
                    "message": f"A redirect for '{new_source}' already exists",
                })
            redirect.source_path = new_source

    if body.target_path is not None:
        redirect.target_path = body.target_path.strip()
    if body.redirect_type is not None:
        if body.redirect_type not in (301, 302):
            raise HTTPException(status_code=422, detail={
                "code": "validation_error",
                "message": "redirect_type must be 301 or 302",
                "field": "redirect_type",
            })
        redirect.redirect_type = body.redirect_type
    if body.is_active is not None:
        redirect.is_active = body.is_active
    if body.note is not None:
        redirect.note = body.note

    db.commit()
    return {"data": _serialize_redirect(redirect)}


@router.delete("/api/organizations/{organization_id}/content/redirects/{redirect_id}", summary="Delete redirect")
def delete_redirect(
    organization_id: UUID,
    redirect_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.CONTENT_DELETE)),
    db: Session = Depends(get_db),
):
    """Delete a redirect."""
    set_rls_context_for_session(db, str(organization_id), str(auth.user_id))

    redirect = db.query(Redirect).filter(
        Redirect.redirect_id == redirect_id,
        Redirect.organization_id == organization_id,
    ).first()

    if not redirect:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": f"Redirect {redirect_id} not found",
        })

    db.delete(redirect)
    db.commit()

    return Response(status_code=204)
