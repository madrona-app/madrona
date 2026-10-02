"""
Public Content CMS API router — 11 routes migrated from Flask.

Source: app/api/content_public.py

Provides unauthenticated access to published CMS pages and blog posts.
Rate limiting is handled by the RateLimitMiddleware in the FastAPI middleware
stack. Also serves sitemap.xml and RSS feed.xml for SEO.

Access control note
-------------------
Routes here use ``get_admin_db`` (BYPASSRLS) by design. Public callers
have no session and no ``current_org_id`` to set, so under the
default RLS-enforced session every lookup returns zero rows. Access
control is at the app layer:

  * URL must include a valid ``org_slug``.
  * Pages and blog posts are filtered to ``status == 'published'``.

See ``discover_public.py`` for the canonical writeup of this pattern.
"""

import hashlib
import hmac as hmac_mod
import html
import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse, Response
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_admin_db
from app.models import (
    Organization,
    User,
    Page,
    ContentBlock,
    Category,
    PageCategory,
    Menu,
    MenuItem,
    CollectionObject,
    Event,
    MediaDerivative,
    Venue,
    Exhibition,
)
from app.services.public_cache import pub_cache_get, pub_cache_set, pub_cache_key_with_params
from app.services.uploads import get_org_media_url
from app.fastapi_app.schemas.content_public import (
    CategoryListResponse,
    MenuResponse,
    PageDetailResponse,
    PageListResponse,
    PostDetailResponse,
    PostListResponse,
    PreviewPageResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["content-public"])


# =============================================================================
# Helpers
# =============================================================================

def _get_org_by_slug(db: Session, slug: str) -> Organization | None:
    """Look up an active organization by slug."""
    return db.query(Organization).filter(
        Organization.slug == slug,
        Organization.status == "active",
    ).first()


def _serialize_page_summary(page: Page) -> dict:
    """Serialize a page for list views (no blocks)."""
    return {
        "page_id": str(page.page_id),
        "slug": page.slug,
        "title": page.title,
        "page_type": page.page_type,
        "status": page.status,
        "published_at": page.published_at.isoformat() if page.published_at else None,
        "author_id": str(page.author_id) if page.author_id else None,
        "featured_image_media_id": str(page.featured_image_media_id) if page.featured_image_media_id else None,
        "excerpt": page.excerpt,
        "template": page.template,
        "sort_order": page.sort_order,
    }


def _serialize_page_detail(db: Session, page: Page, include_hierarchy: bool = True) -> dict:
    """Serialize a page with its blocks for detail views."""
    data = _serialize_page_summary(page)
    data["meta_title"] = page.meta_title
    data["meta_description"] = page.meta_description
    data["parent_page_id"] = str(page.parent_page_id) if page.parent_page_id else None
    data["blocks"] = [_serialize_block(b) for b in page.blocks]
    # Enrich image/hero_banner blocks with resolved URLs + srcset
    data["blocks"] = _enrich_blocks_with_srcset(db, data["blocks"], page.organization_id)

    if include_hierarchy and page.page_type == "page":
        # Build ancestors (root-to-parent)
        ancestors = []
        current = page
        visited: set[str] = set()
        while current.parent_page_id and str(current.parent_page_id) not in visited:
            visited.add(str(current.parent_page_id))
            parent = db.query(Page).filter(
                Page.page_id == current.parent_page_id,
                Page.status == "published",
            ).first()
            if not parent:
                break
            ancestors.insert(0, {
                "page_id": str(parent.page_id),
                "slug": parent.slug,
                "title": parent.title,
            })
            current = parent
        data["ancestors"] = ancestors

        # Published children
        children = (
            db.query(Page)
            .filter(
                Page.parent_page_id == page.page_id,
                Page.status == "published",
                Page.page_type == "page",
            )
            .order_by(Page.sort_order, Page.title)
            .all()
        )
        data["children"] = [{
            "page_id": str(c.page_id),
            "slug": c.slug,
            "title": c.title,
        } for c in children]

    return data


def _serialize_block(block: ContentBlock) -> dict:
    """Serialize a content block."""
    return {
        "block_id": str(block.block_id),
        "block_type": block.block_type,
        "content": block.content or {},
        "sort_order": block.sort_order,
    }


def _build_block_srcset(db: Session, media_id: UUID, organization_id: UUID) -> tuple[str | None, dict | None]:
    """Build resolved URL and srcset for a media_id in a content block.

    Returns (resolved_url, srcset_data) tuple.
    """
    org_id_str = str(organization_id)
    # Get the full-res URL
    from app.models import Media
    media = db.query(Media).filter(Media.media_id == media_id).first()
    resolved_url = None
    if media and media.s3_key:
        try:
            resolved_url = get_org_media_url(
                media.s3_key,
                organization_id=org_id_str,
                db_session=db,
                expiry_seconds=3600,
            )
        except Exception:
            pass

    # Build srcset from derivatives
    derivatives = (
        db.query(MediaDerivative)
        .filter(
            MediaDerivative.media_id == media_id,
            MediaDerivative.derivative_type.in_(["thumbnail", "small", "medium", "large"]),
            MediaDerivative.format.in_(["webp", "jpeg"]),
        )
        .order_by(MediaDerivative.width.asc())
        .all()
    )

    if not derivatives:
        return resolved_url, None

    srcset: dict[str, list[dict]] = {}
    for d in derivatives:
        try:
            url = get_org_media_url(
                d.s3_key,
                organization_id=org_id_str,
                db_session=db,
                expiry_seconds=3600,
            )
            fmt = d.format if d.format in ("webp", "jpeg") else "jpeg"
            srcset.setdefault(fmt, []).append({
                "url": url,
                "width": d.width,
                "height": d.height,
            })
        except Exception:
            continue

    return resolved_url, srcset if srcset else None


def _enrich_blocks_with_srcset(db: Session, blocks: list[dict], organization_id: UUID) -> list[dict]:
    """Walk blocks and resolve media_id in image/hero_banner blocks to URLs + srcset."""
    enrichable_types = {"image", "hero_banner"}
    for block in blocks:
        if block.get("block_type") not in enrichable_types:
            continue
        content = block.get("content", {})
        media_id_str = content.get("media_id")
        if not media_id_str:
            continue
        try:
            mid = UUID(media_id_str)
        except (ValueError, TypeError):
            continue
        resolved_url, srcset = _build_block_srcset(db, mid, organization_id)
        if resolved_url:
            content["resolved_url"] = resolved_url
        if srcset:
            content["resolved_srcset"] = srcset
    return blocks


def _serialize_category(cat: Category) -> dict:
    """Serialize a category."""
    return {
        "category_id": str(cat.category_id),
        "name": cat.name,
        "slug": cat.slug,
        "description": cat.description,
        "sort_order": cat.sort_order,
    }


def _xml_escape(text: str) -> str:
    """Escape text for safe inclusion in XML."""
    return html.escape(text, quote=True)


def _verify_preview_token(page_id: str, token: str, expires: str) -> bool:
    """Verify an HMAC-based preview token."""
    settings = get_settings()
    key = settings.secret_key.encode("utf-8")
    message = f"preview:{page_id}:{expires}".encode("utf-8")
    expected = hmac_mod.new(key, message, hashlib.sha256).hexdigest()
    return hmac_mod.compare_digest(expected, token)


# =============================================================================
# Public Pages
# =============================================================================

@router.get("/api/content/{org_slug}/pages", response_model=PageListResponse, summary="List published pages")
def list_published_pages(
    org_slug: str,
    response: Response,
    db: Session = Depends(get_admin_db),
):
    """List published pages (type=page) for an organization."""
    response.headers["Cache-Control"] = "public, max-age=60, stale-while-revalidate=300"

    cache_key = f"{org_slug}:pages"
    cached = pub_cache_get(cache_key)
    if cached is not None:
        return cached

    org = _get_org_by_slug(db, org_slug)
    if not org:
        raise HTTPException(status_code=404, detail={
            "code": "NOT_FOUND",
            "message": "Organization not found",
        })

    pages = (
        db.query(Page)
        .filter(
            Page.organization_id == org.organization_id,
            Page.page_type == "page",
            Page.status == "published",
        )
        .order_by(Page.sort_order, Page.title)
        .all()
    )

    result = {
        "data": [_serialize_page_summary(p) for p in pages],
        "total": len(pages),
    }
    pub_cache_set(cache_key, result)
    return result


@router.get("/api/content/{org_slug}/pages/by-id/{page_id}", response_model=PageDetailResponse, summary="Get published page by id")
def get_published_page_by_id(
    org_slug: str,
    page_id: str,
    response: Response,
    db: Session = Depends(get_admin_db),
):
    """Get a single published page by UUID (used for homepage rendering)."""
    response.headers["Cache-Control"] = "public, max-age=60, stale-while-revalidate=300"

    cache_key = f"{org_slug}:page-id:{page_id}"
    cached = pub_cache_get(cache_key)
    if cached is not None:
        return cached

    org = _get_org_by_slug(db, org_slug)
    if not org:
        raise HTTPException(status_code=404, detail={
            "code": "NOT_FOUND",
            "message": "Organization not found",
        })

    try:
        page_uuid = UUID(page_id)
    except ValueError:
        raise HTTPException(status_code=400, detail={
            "code": "INVALID_UUID",
            "message": "Invalid page ID",
        })

    page = (
        db.query(Page)
        .filter(
            Page.page_id == page_uuid,
            Page.organization_id == org.organization_id,
            Page.status == "published",
        )
        .first()
    )

    if not page:
        raise HTTPException(status_code=404, detail={
            "code": "NOT_FOUND",
            "message": "Page not found",
        })

    result = {"data": _serialize_page_detail(db, page)}
    pub_cache_set(cache_key, result)
    return result


@router.get("/api/content/{org_slug}/pages/{slug}", response_model=PageDetailResponse, summary="Get published page")
def get_published_page(
    org_slug: str,
    slug: str,
    response: Response,
    db: Session = Depends(get_admin_db),
):
    """Get a single published page by slug, with its blocks."""
    response.headers["Cache-Control"] = "public, max-age=60, stale-while-revalidate=300"

    cache_key = f"{org_slug}:page:{slug}"
    cached = pub_cache_get(cache_key)
    if cached is not None:
        return cached

    org = _get_org_by_slug(db, org_slug)
    if not org:
        raise HTTPException(status_code=404, detail={
            "code": "NOT_FOUND",
            "message": "Organization not found",
        })

    page = (
        db.query(Page)
        .filter(
            Page.organization_id == org.organization_id,
            Page.slug == slug,
            Page.page_type == "page",
            Page.status == "published",
        )
        .first()
    )

    if not page:
        raise HTTPException(status_code=404, detail={
            "code": "NOT_FOUND",
            "message": "Page not found",
        })

    result = {"data": _serialize_page_detail(db, page)}
    pub_cache_set(cache_key, result)
    return result


# =============================================================================
# Public Blog Posts
# =============================================================================

@router.get("/api/content/{org_slug}/posts", response_model=PostListResponse, summary="List published posts")
def list_published_posts(
    org_slug: str,
    response: Response,
    db: Session = Depends(get_admin_db),
    limit: int = Query(default=20, le=100, ge=1),
    offset: int = Query(default=0, ge=0),
    category: str | None = Query(default=None),
):
    """List published blog posts with pagination and optional category filter."""
    response.headers["Cache-Control"] = "public, max-age=60, stale-while-revalidate=300"

    cache_key = pub_cache_key_with_params(org_slug, "posts", limit=limit, offset=offset, category=category)
    cached = pub_cache_get(cache_key)
    if cached is not None:
        return cached

    org = _get_org_by_slug(db, org_slug)
    if not org:
        raise HTTPException(status_code=404, detail={
            "code": "NOT_FOUND",
            "message": "Organization not found",
        })

    query = (
        db.query(Page)
        .filter(
            Page.organization_id == org.organization_id,
            Page.page_type == "post",
            Page.status == "published",
        )
    )

    if category:
        query = (
            query
            .join(PageCategory, PageCategory.page_id == Page.page_id)
            .join(Category, Category.category_id == PageCategory.category_id)
            .filter(Category.slug == category)
        )

    total = query.count()
    posts = (
        query
        .order_by(Page.published_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    # Get categories for each post
    post_ids = [p.page_id for p in posts]
    post_categories: dict[str, list[dict]] = {}
    if post_ids:
        rows = (
            db.query(PageCategory.page_id, Category)
            .join(Category, Category.category_id == PageCategory.category_id)
            .filter(PageCategory.page_id.in_(post_ids))
            .all()
        )
        for page_id, cat in rows:
            post_categories.setdefault(str(page_id), []).append(_serialize_category(cat))

    # Bulk-fetch author names
    author_ids = list({p.author_id for p in posts if p.author_id})
    author_names: dict[str, str] = {}
    if author_ids:
        authors = db.query(User).filter(User.user_id.in_(author_ids)).all()
        for u in authors:
            author_names[str(u.user_id)] = u.display_name or u.email

    results = []
    for post in posts:
        data = _serialize_page_summary(post)
        data["categories"] = post_categories.get(str(post.page_id), [])
        data["author_name"] = author_names.get(str(post.author_id)) if post.author_id else None
        results.append(data)

    result = {
        "data": results,
        "total": total,
        "limit": limit,
        "offset": offset,
    }
    pub_cache_set(cache_key, result)
    return result


@router.get("/api/content/{org_slug}/posts/{slug}", response_model=PostDetailResponse, summary="Get published post")
def get_published_post(
    org_slug: str,
    slug: str,
    response: Response,
    db: Session = Depends(get_admin_db),
):
    """Get a single published blog post by slug, with blocks and categories."""
    response.headers["Cache-Control"] = "public, max-age=60, stale-while-revalidate=300"

    cache_key = f"{org_slug}:post:{slug}"
    cached = pub_cache_get(cache_key)
    if cached is not None:
        return cached

    org = _get_org_by_slug(db, org_slug)
    if not org:
        raise HTTPException(status_code=404, detail={
            "code": "NOT_FOUND",
            "message": "Organization not found",
        })

    post = (
        db.query(Page)
        .filter(
            Page.organization_id == org.organization_id,
            Page.slug == slug,
            Page.page_type == "post",
            Page.status == "published",
        )
        .first()
    )

    if not post:
        raise HTTPException(status_code=404, detail={
            "code": "NOT_FOUND",
            "message": "Post not found",
        })

    # Get categories
    categories = (
        db.query(Category)
        .join(PageCategory, PageCategory.category_id == Category.category_id)
        .filter(PageCategory.page_id == post.page_id)
        .order_by(Category.sort_order)
        .all()
    )

    # Get author name
    author_name = None
    if post.author_id:
        author = db.query(User).filter(User.user_id == post.author_id).first()
        if author:
            author_name = author.display_name or author.email

    data = _serialize_page_detail(db, post)
    data["categories"] = [_serialize_category(c) for c in categories]
    data["author_name"] = author_name

    result = {"data": data}
    pub_cache_set(cache_key, result)
    return result


# =============================================================================
# Public Categories
# =============================================================================

@router.get("/api/content/{org_slug}/categories", response_model=CategoryListResponse, summary="List categories")
def list_categories(
    org_slug: str,
    response: Response,
    db: Session = Depends(get_admin_db),
):
    """List all categories for an organization."""
    response.headers["Cache-Control"] = "public, max-age=60, stale-while-revalidate=300"

    cache_key = f"{org_slug}:categories"
    cached = pub_cache_get(cache_key)
    if cached is not None:
        return cached

    org = _get_org_by_slug(db, org_slug)
    if not org:
        raise HTTPException(status_code=404, detail={
            "code": "NOT_FOUND",
            "message": "Organization not found",
        })

    categories = (
        db.query(Category)
        .filter(Category.organization_id == org.organization_id)
        .order_by(Category.sort_order, Category.name)
        .all()
    )

    result = {
        "data": [_serialize_category(c) for c in categories],
        "total": len(categories),
    }
    pub_cache_set(cache_key, result)
    return result


# =============================================================================
# Public Menus
# =============================================================================

@router.get("/api/content/{org_slug}/menus/{location}", response_model=MenuResponse, summary="Get public menu")
def get_public_menu(
    org_slug: str,
    location: str,
    response: Response,
    db: Session = Depends(get_admin_db),
):
    """Get a public menu by location with resolved page slugs."""
    response.headers["Cache-Control"] = "public, max-age=60, stale-while-revalidate=300"

    if location not in ("header", "footer"):
        raise HTTPException(status_code=400, detail={
            "code": "INVALID_INPUT",
            "message": "Invalid location",
        })

    cache_key = f"{org_slug}:menu:{location}"
    cached = pub_cache_get(cache_key)
    if cached is not None:
        return cached

    org = _get_org_by_slug(db, org_slug)
    if not org:
        raise HTTPException(status_code=404, detail={
            "code": "NOT_FOUND",
            "message": "Organization not found",
        })

    menu = db.query(Menu).filter(
        Menu.organization_id == org.organization_id,
        Menu.location == location,
    ).first()

    if not menu:
        return {"data": {"location": location, "items": []}}

    # Build item tree with resolved page slugs
    items = db.query(MenuItem).filter(
        MenuItem.menu_id == menu.menu_id,
    ).all()

    # Pre-fetch pages for page link types
    page_ids = [i.page_id for i in items if i.page_id]
    pages_map: dict[str, Page] = {}
    if page_ids:
        for p in db.query(Page).filter(
            Page.page_id.in_(page_ids),
            Page.status == "published",
        ).all():
            pages_map[str(p.page_id)] = p

    def _serialize_public_item(item: MenuItem) -> dict | None:
        # If it's a page link, resolve the slug; skip if page not published
        page_slug = None
        if item.link_type == "page" and item.page_id:
            page = pages_map.get(str(item.page_id))
            if not page:
                return None  # Skip unpublished page links
            page_slug = page.slug

        return {
            "label": item.label,
            "link_type": item.link_type,
            "page_slug": page_slug,
            "url": item.url,
            "description": item.description,
            "image_media_id": str(item.image_media_id) if item.image_media_id else None,
            "highlight": item.highlight,
        }

    # Separate top-level from children
    top_level = sorted(
        [i for i in items if i.parent_item_id is None],
        key=lambda i: i.sort_order,
    )
    children_by_parent: dict[str, list[MenuItem]] = {}
    for item in items:
        if item.parent_item_id:
            children_by_parent.setdefault(str(item.parent_item_id), []).append(item)

    menu_items = []
    for item in top_level:
        data = _serialize_public_item(item)
        if data is None:
            continue
        kids = children_by_parent.get(str(item.menu_item_id), [])
        data["children"] = [
            d for d in (
                _serialize_public_item(c)
                for c in sorted(kids, key=lambda c: c.sort_order)
            ) if d is not None
        ]
        menu_items.append(data)

    result = {"data": {"location": location, "items": menu_items}}
    pub_cache_set(cache_key, result)
    return result


# =============================================================================
# Sitemap
# =============================================================================

@router.get("/api/content/{org_slug}/sitemap.xml", summary="Get sitemap")
def get_sitemap(
    org_slug: str,
    request: Request,
    db: Session = Depends(get_admin_db),
):
    """XML sitemap of all public content: pages, posts, venues, exhibitions, events, objects."""
    org = _get_org_by_slug(db, org_slug)
    if not org:
        return PlainTextResponse("Not found", status_code=404)

    base_url = str(request.base_url).rstrip("/")
    org_id = org.organization_id

    def _url_entry(loc: str, lastmod: str | None = None, priority: str = "0.5") -> str:
        entry = f'  <url>\n    <loc>{_xml_escape(loc)}</loc>\n'
        if lastmod:
            entry += f'    <lastmod>{lastmod}</lastmod>\n'
        entry += f'    <priority>{priority}</priority>\n  </url>'
        return entry

    urls = []

    # -- Static section indexes -------------------------------------------
    urls.append(_url_entry(f"{base_url}/c/{org_slug}", priority="1.0"))
    urls.append(_url_entry(f"{base_url}/c/{org_slug}/blog", priority="0.8"))
    urls.append(_url_entry(f"{base_url}/c/{org_slug}/visit", priority="0.7"))
    urls.append(_url_entry(f"{base_url}/c/{org_slug}/exhibitions", priority="0.7"))
    urls.append(_url_entry(f"{base_url}/c/{org_slug}/events", priority="0.7"))

    # -- CMS pages & posts ------------------------------------------------
    pages = (
        db.query(Page)
        .filter(Page.organization_id == org_id, Page.status == "published")
        .order_by(Page.updated_at.desc())
        .all()
    )
    for page in pages:
        lastmod = page.updated_at.strftime("%Y-%m-%d") if page.updated_at else None
        if page.page_type == "post":
            urls.append(_url_entry(
                f"{base_url}/c/{org_slug}/blog/{page.slug}",
                lastmod=lastmod, priority="0.6",
            ))
        else:
            urls.append(_url_entry(
                f"{base_url}/c/{org_slug}/pages/{page.slug}",
                lastmod=lastmod, priority="0.7",
            ))

    # -- Public venues -----------------------------------------------------
    venues = (
        db.query(Venue)
        .filter(Venue.organization_id == org_id, Venue.is_public == True, Venue.slug.isnot(None))
        .order_by(Venue.sort_order.asc())
        .all()
    )
    for v in venues:
        lastmod = v.updated_at.strftime("%Y-%m-%d") if v.updated_at else None
        urls.append(_url_entry(
            f"{base_url}/c/{org_slug}/visit/{v.slug}",
            lastmod=lastmod, priority="0.6",
        ))

    # -- Public exhibitions ------------------------------------------------
    exhibitions = (
        db.query(Exhibition)
        .filter(
            Exhibition.organization_id == org_id,
            Exhibition.is_public == True,
            Exhibition.public_url_slug.isnot(None),
        )
        .order_by(Exhibition.updated_at.desc())
        .all()
    )
    for exh in exhibitions:
        lastmod = exh.updated_at.strftime("%Y-%m-%d") if exh.updated_at else None
        urls.append(_url_entry(
            f"{base_url}/c/{org_slug}/exhibitions/{exh.public_url_slug}",
            lastmod=lastmod, priority="0.6",
        ))

    # -- Public events (scheduled, public audience, with slug) -------------
    events = (
        db.query(Event)
        .filter(
            Event.organization_id == org_id,
            Event.audience == "public",
            Event.status == "scheduled",
            Event.slug.isnot(None),
        )
        .order_by(Event.start_at.asc())
        .all()
    )
    for evt in events:
        lastmod = evt.updated_at.strftime("%Y-%m-%d") if evt.updated_at else None
        urls.append(_url_entry(
            f"{base_url}/c/{org_slug}/events/{evt.slug}",
            lastmod=lastmod, priority="0.5",
        ))

    # -- Discoverable collection objects -----------------------------------
    objects = (
        db.query(
            CollectionObject.object_number,
            CollectionObject.updated_at,
        )
        .filter(
            CollectionObject.organization_id == org_id,
            CollectionObject.is_discoverable == True,
        )
        .order_by(CollectionObject.updated_at.desc())
        .limit(5000)  # Cap to avoid massive sitemaps
        .all()
    )
    for obj_number, obj_updated in objects:
        lastmod = obj_updated.strftime("%Y-%m-%d") if obj_updated else None
        urls.append(_url_entry(
            f"{base_url}/c/{org_slug}/objects/{obj_number}",
            lastmod=lastmod, priority="0.5",
        ))

    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "\n".join(urls) + "\n"
        '</urlset>'
    )

    return Response(
        content=xml,
        media_type="application/xml",
        headers={"Cache-Control": "public, max-age=3600, stale-while-revalidate=7200"},
    )


# =============================================================================
# Robots.txt
# =============================================================================

@router.get("/api/content/{org_slug}/robots.txt", summary="Get robots txt")
def get_robots_txt(
    org_slug: str,
    request: Request,
    db: Session = Depends(get_admin_db),
):
    """Robots.txt for the public museum site."""
    org = _get_org_by_slug(db, org_slug)
    if not org:
        return PlainTextResponse("Not found", status_code=404)

    base_url = str(request.base_url).rstrip("/")
    sitemap_url = f"{base_url}/api/content/{org_slug}/sitemap.xml"

    txt = (
        "User-agent: *\n"
        "Allow: /\n"
        "\n"
        f"Sitemap: {sitemap_url}\n"
    )

    return PlainTextResponse(
        txt,
        headers={"Cache-Control": "public, max-age=86400, stale-while-revalidate=86400"},
    )


# =============================================================================
# RSS Feed
# =============================================================================

@router.get("/api/content/{org_slug}/feed.xml", summary="Get rss feed")
def get_rss_feed(
    org_slug: str,
    request: Request,
    db: Session = Depends(get_admin_db),
):
    """RSS 2.0 feed of the latest 20 published blog posts."""
    org = _get_org_by_slug(db, org_slug)
    if not org:
        return PlainTextResponse("Not found", status_code=404)

    base_url = str(request.base_url).rstrip("/")
    blog_url = f"{base_url}/c/{org_slug}/blog"

    posts = (
        db.query(Page)
        .filter(
            Page.organization_id == org.organization_id,
            Page.page_type == "post",
            Page.status == "published",
        )
        .order_by(Page.published_at.desc())
        .limit(20)
        .all()
    )

    items = []
    for post in posts:
        link = f"{base_url}/c/{org_slug}/blog/{post.slug}"
        pub_date = ""
        if post.published_at:
            pub_date = post.published_at.strftime("%a, %d %b %Y %H:%M:%S +0000")

        item = (
            f'    <item>\n'
            f'      <title>{_xml_escape(post.title)}</title>\n'
            f'      <link>{_xml_escape(link)}</link>\n'
            f'      <guid isPermaLink="true">{_xml_escape(link)}</guid>\n'
        )
        if post.excerpt:
            item += f'      <description>{_xml_escape(post.excerpt)}</description>\n'
        if pub_date:
            item += f'      <pubDate>{pub_date}</pubDate>\n'
        item += '    </item>'
        items.append(item)

    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n'
        '  <channel>\n'
        f'    <title>{_xml_escape(org.name)} Blog</title>\n'
        f'    <link>{_xml_escape(blog_url)}</link>\n'
        f'    <description>Latest posts from {_xml_escape(org.name)}</description>\n'
        f'    <atom:link href="{_xml_escape(base_url)}/api/content/{_xml_escape(org_slug)}/feed.xml" rel="self" type="application/rss+xml"/>\n'
        + "\n".join(items) + "\n"
        '  </channel>\n'
        '</rss>'
    )

    return Response(
        content=xml,
        media_type="application/rss+xml",
        headers={"Cache-Control": "public, max-age=1800, stale-while-revalidate=3600"},
    )


# =============================================================================
# Draft Preview
# =============================================================================

@router.get("/api/content/{org_slug}/preview/{page_id}", response_model=PreviewPageResponse, summary="Get preview page")
def get_preview_page(
    org_slug: str,
    page_id: str,
    token: str = Query(default=""),
    expires: str = Query(default=""),
    db: Session = Depends(get_admin_db),
):
    """Fetch a page regardless of status for preview. Requires signed token."""
    org = _get_org_by_slug(db, org_slug)
    if not org:
        raise HTTPException(status_code=404, detail={
            "code": "NOT_FOUND",
            "message": "Organization not found",
        })

    if not token or not expires:
        raise HTTPException(status_code=400, detail={
            "code": "MISSING_FIELD",
            "message": "Missing preview token or expires",
        })

    # Check expiry
    try:
        expires_dt = datetime.fromisoformat(expires)
        if expires_dt < datetime.now(timezone.utc):
            raise HTTPException(status_code=403, detail={
                "code": "FORBIDDEN",
                "message": "Preview link has expired",
            })
    except ValueError:
        raise HTTPException(status_code=400, detail={
            "code": "INVALID_INPUT",
            "message": "Invalid expires format",
        })

    # Verify HMAC
    if not _verify_preview_token(page_id, token, expires):
        raise HTTPException(status_code=403, detail={
            "code": "FORBIDDEN",
            "message": "Invalid preview token",
        })

    try:
        page_uuid = UUID(page_id)
    except ValueError:
        raise HTTPException(status_code=400, detail={
            "code": "INVALID_UUID",
            "message": "Invalid page ID",
        })

    page = (
        db.query(Page)
        .filter(
            Page.page_id == page_uuid,
            Page.organization_id == org.organization_id,
        )
        .first()
    )

    if not page:
        raise HTTPException(status_code=404, detail={
            "code": "NOT_FOUND",
            "message": "Page not found",
        })

    # Get categories if it's a post
    data = _serialize_page_detail(db, page, include_hierarchy=True)
    data["is_preview"] = True

    if page.page_type == "post":
        categories = (
            db.query(Category)
            .join(PageCategory, PageCategory.category_id == Category.category_id)
            .filter(PageCategory.page_id == page.page_id)
            .order_by(Category.sort_order)
            .all()
        )
        data["categories"] = [_serialize_category(c) for c in categories]

        # Author name
        if page.author_id:
            author = db.query(User).filter(User.user_id == page.author_id).first()
            if author:
                data["author_name"] = author.display_name or author.email

    return {"data": data}
