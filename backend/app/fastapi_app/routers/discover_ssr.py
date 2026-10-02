"""
Server-side OG meta tag injection for Discover pages (FastAPI).

Social crawlers (Facebook, Twitter/X, Slack, iMessage) don't execute JavaScript.
This router intercepts /c/* requests and injects Open Graph tags into
the built index.html before serving it.

Migrated from app/api/discover_ssr.py.
"""

import logging
import os
import re
from html import escape
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import (
    CollectionObject,
    CollectionObjectMedia,
    DiscoverConfig,
    Event,
    Exhibition,
    Media,
    Organization,
    Page,
    Redirect,
    Venue,
)
from app.services.uploads import get_org_media_url

logger = logging.getLogger(__name__)

router = APIRouter(tags=["discover-ssr"])


# Cache the built index.html content (read once in production)
_index_html_cache: str | None = None


def _read_index_html() -> str | None:
    """Read the built frontend index.html file."""
    global _index_html_cache

    settings = get_settings()
    if not settings.is_development and _index_html_cache is not None:
        return _index_html_cache

    dist_path = os.environ.get(
        "FRONTEND_DIST_PATH",
        os.path.join(os.path.dirname(__file__), "..", "..", "..", "frontend", "dist", "index.html"),
    )
    dist_path = os.path.abspath(dist_path)

    try:
        with open(dist_path, "r") as f:
            html = f.read()
        if not settings.is_development:
            _index_html_cache = html
        return html
    except FileNotFoundError:
        logger.warning("Frontend dist not found at %s, SSR OG tags disabled", dist_path)
        return None


def _serve_404(html: str | None) -> Response:
    """Serve a 404 response with noindex meta tag."""
    if not html:
        return Response("Not found", status_code=404)
    noindex_tag = '<meta name="robots" content="noindex">'
    html = html.replace("</head>", f"    {noindex_tag}\n  </head>", 1)
    return HTMLResponse(html, status_code=404)


def _inject_og_tags(html: str, tags: dict[str, str]) -> str:
    """Inject OG meta tags into HTML <head>."""
    meta_lines = []

    title = tags.get("title", "")
    description = tags.get("description", "")
    image = tags.get("image", "")
    url = tags.get("url", "")
    site_name = tags.get("site_name", "")

    if title:
        html = re.sub(r"<title>[^<]*</title>", f"<title>{escape(title)}</title>", html, count=1)
        meta_lines.append(f'<meta property="og:title" content="{escape(title)}" />')
        meta_lines.append(f'<meta name="twitter:title" content="{escape(title)}" />')

    if description:
        meta_lines.append(f'<meta property="og:description" content="{escape(description)}" />')
        meta_lines.append(f'<meta name="twitter:description" content="{escape(description)}" />')
        meta_lines.append(f'<meta name="description" content="{escape(description)}" />')

    if image:
        meta_lines.append(f'<meta property="og:image" content="{escape(image)}" />')
        meta_lines.append(f'<meta name="twitter:image" content="{escape(image)}" />')
        meta_lines.append('<meta name="twitter:card" content="summary_large_image" />')
    else:
        meta_lines.append('<meta name="twitter:card" content="summary" />')

    if url:
        meta_lines.append(f'<meta property="og:url" content="{escape(url)}" />')
        meta_lines.append(f'<link rel="canonical" href="{escape(url)}" />')

    meta_lines.append('<meta property="og:type" content="website" />')

    if site_name:
        meta_lines.append(f'<meta property="og:site_name" content="{escape(site_name)}" />')

    org_slug = tags.get("org_slug", "")
    if org_slug:
        base = url.rsplit("/c/", 1)[0] if url else ""
        if base:
            meta_lines.append(
                f'<link rel="alternate" type="application/rss+xml" '
                f'title="{escape(site_name or org_slug)} Blog" '
                f'href="{escape(base)}/api/content/{escape(org_slug)}/feed.xml" />'
            )
            meta_lines.append(
                f'<link rel="sitemap" type="application/xml" '
                f'href="{escape(base)}/api/content/{escape(org_slug)}/sitemap.xml" />'
            )

    injection = "\n    ".join(meta_lines)
    html = html.replace("</head>", f"    {injection}\n  </head>", 1)
    return html


def _get_org_by_slug(db: Session, slug: str) -> Organization | None:
    return db.query(Organization).filter(
        Organization.slug == slug,
        Organization.status == "active",
    ).first()


def _get_primary_image_url(db: Session, object_id: UUID, organization_id: UUID) -> str | None:
    row = (
        db.query(Media.s3_key)
        .join(CollectionObjectMedia, CollectionObjectMedia.media_id == Media.media_id)
        .filter(
            CollectionObjectMedia.object_id == object_id,
            Media.is_published == True,
        )
        .order_by(
            CollectionObjectMedia.is_primary.desc(),
            CollectionObjectMedia.sort_order,
        )
        .first()
    )
    if not row or not row.s3_key:
        return None
    try:
        return get_org_media_url(
            row.s3_key, organization_id=str(organization_id), db_session=db, expiry_seconds=3600,
        )
    except Exception:
        return None


def _get_display_title(title_links):
    if not title_links:
        return None
    preferred = next((t for t in title_links if t.is_preferred), None)
    if preferred:
        return preferred.title
    return title_links[0].title if title_links else None


def _extract_creators_list(creators):
    if not creators:
        return []
    result = []
    for c in creators:
        if isinstance(c, dict):
            name = c.get("value") or c.get("name")
            if name:
                result.append(name)
        elif isinstance(c, str) and c.strip():
            result.append(c.strip())
    return result


def _resolve_object(db: Session, org: Organization, identifier: str) -> CollectionObject | None:
    try:
        obj_uuid = UUID(identifier)
        obj = db.query(CollectionObject).filter(
            CollectionObject.object_id == obj_uuid,
            CollectionObject.organization_id == org.organization_id,
            CollectionObject.is_discoverable == True,
        ).first()
        if obj:
            return obj
    except ValueError:
        pass

    return db.query(CollectionObject).filter(
        CollectionObject.organization_id == org.organization_id,
        CollectionObject.object_number == identifier,
        CollectionObject.is_discoverable == True,
    ).first()


def _get_ssr_media_url(db: Session, media_id, organization_id):
    if not media_id:
        return None
    media = db.query(Media).filter(Media.media_id == media_id).first()
    if not media or not media.s3_key:
        return None
    try:
        return get_org_media_url(
            media.s3_key, organization_id=str(organization_id), db_session=db, expiry_seconds=3600,
        )
    except Exception:
        return None


def _check_redirect(db: Session, path: str):
    """Check for URL redirects."""
    match = re.match(r"^/c/([^/]+)(/.+)$", path)
    if not match:
        return None

    org_slug = match.group(1)
    relative_path = match.group(2)

    org = _get_org_by_slug(db, org_slug)
    if not org:
        return None

    redirect_rule = db.query(Redirect).filter(
        Redirect.organization_id == org.organization_id,
        Redirect.source_path == relative_path,
        Redirect.is_active == True,
    ).first()

    if redirect_rule:
        target_url = f"/c/{org_slug}{redirect_rule.target_path}"
        return RedirectResponse(url=target_url, status_code=redirect_rule.redirect_type)

    return None


# ============================================================================
# Routes
# ============================================================================


@router.get("/c/{org_slug}", summary="Discover collection page")
def discover_collection_page(
    org_slug: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """Serve collection landing page with OG tags."""
    redirect = _check_redirect(db, request.url.path)
    if redirect:
        return redirect

    html = _read_index_html()
    if not html:
        return Response("Not found", status_code=404)

    settings = get_settings()
    base_url = settings.app_base_url.rstrip("/")

    org = _get_org_by_slug(db, org_slug)
    if not org:
        return _serve_404(html)

    config = db.query(DiscoverConfig).filter(
        DiscoverConfig.organization_id == org.organization_id,
    ).first()

    title = (config.page_title if config and config.page_title else org.name) or "Explore the Collection"
    description = (config.page_subtitle if config else None) or f"Browse the collection of {org.name}"

    image_url = None
    if config and config.hero_media_id:
        media = db.query(Media).filter(
            Media.media_id == config.hero_media_id,
            Media.is_published == True,
        ).first()
        if media and media.s3_key:
            try:
                image_url = get_org_media_url(
                    media.s3_key, organization_id=str(org.organization_id),
                    db_session=db, expiry_seconds=3600,
                )
            except Exception:
                pass

    tags = {
        "title": title,
        "description": description,
        "url": f"{base_url}/c/{org_slug}",
        "site_name": org.name,
        "org_slug": org_slug,
    }
    if image_url:
        tags["image"] = image_url

    return HTMLResponse(_inject_og_tags(html, tags))


@router.get("/c/{org_slug}/objects/{object_id}", summary="Discover object page")
def discover_object_page(
    org_slug: str,
    object_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """Serve object detail page with OG tags."""
    redirect = _check_redirect(db, request.url.path)
    if redirect:
        return redirect

    html = _read_index_html()
    if not html:
        return Response("Not found", status_code=404)

    settings = get_settings()
    base_url = settings.app_base_url.rstrip("/")

    org = _get_org_by_slug(db, org_slug)
    if not org:
        return _serve_404(html)

    obj = _resolve_object(db, org, object_id)
    if not obj:
        return _serve_404(html)

    obj_title = _get_display_title(obj.title_links) or "Untitled"
    creators = _extract_creators_list(obj.creators)
    creator_str = ", ".join(creators) if creators else ""

    title_parts = [obj_title]
    if creator_str:
        title_parts.append(creator_str)
    title_parts.append(org.name)
    title = " | ".join(title_parts)

    desc_parts = []
    if creator_str:
        desc_parts.append(creator_str)
    if obj.creation_date_display:
        desc_parts.append(obj.creation_date_display)
    if obj.brief_description:
        desc_parts.append(obj.brief_description)
    description = " — ".join(desc_parts)[:200] if desc_parts else f"View this object from {org.name}"

    canonical_id = obj.object_number or str(obj.object_id)
    canonical_url = f"{base_url}/c/{org_slug}/objects/{canonical_id}"

    image_url = _get_primary_image_url(db, obj.object_id, org.organization_id)

    tags = {
        "title": title,
        "description": description,
        "url": canonical_url,
        "site_name": org.name,
        "org_slug": org_slug,
    }
    if image_url:
        tags["image"] = image_url

    return HTMLResponse(_inject_og_tags(html, tags))


@router.get("/c/{org_slug}/pages/{page_slug}", summary="Discover cms page")
def discover_cms_page(
    org_slug: str,
    page_slug: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """Serve CMS page with OG tags."""
    redirect = _check_redirect(db, request.url.path)
    if redirect:
        return redirect

    html = _read_index_html()
    if not html:
        return Response("Not found", status_code=404)

    settings = get_settings()
    base_url = settings.app_base_url.rstrip("/")

    org = _get_org_by_slug(db, org_slug)
    if not org:
        return _serve_404(html)

    page = db.query(Page).filter(
        Page.organization_id == org.organization_id,
        Page.slug == page_slug,
        Page.page_type == "page",
        Page.status == "published",
    ).first()

    if not page:
        return _serve_404(html)

    title = page.meta_title or page.title
    description = page.meta_description or page.excerpt or ""

    image_url = None
    if page.featured_image_media_id:
        media = db.query(Media).filter(Media.media_id == page.featured_image_media_id).first()
        if media and media.s3_key:
            try:
                image_url = get_org_media_url(
                    media.s3_key, organization_id=str(org.organization_id),
                    db_session=db, expiry_seconds=3600,
                )
            except Exception:
                pass

    tags = {
        "title": f"{title} | {org.name}",
        "description": description,
        "url": f"{base_url}/c/{org_slug}/pages/{page_slug}",
        "site_name": org.name,
        "org_slug": org_slug,
    }
    if image_url:
        tags["image"] = image_url

    return HTMLResponse(_inject_og_tags(html, tags))


@router.get("/c/{org_slug}/blog/{post_slug}", summary="Discover blog post")
def discover_blog_post(
    org_slug: str,
    post_slug: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """Serve blog post with OG tags."""
    redirect = _check_redirect(db, request.url.path)
    if redirect:
        return redirect

    html = _read_index_html()
    if not html:
        return Response("Not found", status_code=404)

    settings = get_settings()
    base_url = settings.app_base_url.rstrip("/")

    org = _get_org_by_slug(db, org_slug)
    if not org:
        return _serve_404(html)

    post = db.query(Page).filter(
        Page.organization_id == org.organization_id,
        Page.slug == post_slug,
        Page.page_type == "post",
        Page.status == "published",
    ).first()

    if not post:
        return _serve_404(html)

    title = post.meta_title or post.title
    description = post.meta_description or post.excerpt or ""

    image_url = None
    if post.featured_image_media_id:
        media = db.query(Media).filter(Media.media_id == post.featured_image_media_id).first()
        if media and media.s3_key:
            try:
                image_url = get_org_media_url(
                    media.s3_key, organization_id=str(org.organization_id),
                    db_session=db, expiry_seconds=3600,
                )
            except Exception:
                pass

    tags = {
        "title": f"{title} | {org.name}",
        "description": description,
        "url": f"{base_url}/c/{org_slug}/blog/{post_slug}",
        "site_name": org.name,
        "org_slug": org_slug,
    }
    if image_url:
        tags["image"] = image_url

    injected = _inject_og_tags(html, tags)
    injected = injected.replace(
        '<meta property="og:type" content="website" />',
        '<meta property="og:type" content="article" />',
    )

    return HTMLResponse(injected)


@router.get("/c/{org_slug}/visit", summary="Discover venue list")
def discover_venue_list(
    org_slug: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """Serve venue list page with OG tags."""
    redirect = _check_redirect(db, request.url.path)
    if redirect:
        return redirect

    html = _read_index_html()
    if not html:
        return Response("Not found", status_code=404)

    settings = get_settings()
    base_url = settings.app_base_url.rstrip("/")

    org = _get_org_by_slug(db, org_slug)
    if not org:
        return _serve_404(html)

    tags = {
        "title": f"Visit | {org.name}",
        "description": f"Plan your visit to {org.name}. View locations, hours, and admission information.",
        "url": f"{base_url}/c/{org_slug}/visit",
        "site_name": org.name,
        "org_slug": org_slug,
    }

    return HTMLResponse(_inject_og_tags(html, tags))


@router.get("/c/{org_slug}/visit/{venue_slug}", summary="Discover venue detail")
def discover_venue_detail(
    org_slug: str,
    venue_slug: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """Serve venue detail page with OG tags."""
    redirect = _check_redirect(db, request.url.path)
    if redirect:
        return redirect

    html = _read_index_html()
    if not html:
        return Response("Not found", status_code=404)

    settings = get_settings()
    base_url = settings.app_base_url.rstrip("/")

    org = _get_org_by_slug(db, org_slug)
    if not org:
        return _serve_404(html)

    venue = db.query(Venue).filter(
        Venue.organization_id == org.organization_id,
        Venue.slug == venue_slug,
        Venue.is_public == True,
    ).first()

    if not venue:
        return _serve_404(html)

    image_url = _get_ssr_media_url(db, venue.hero_media_id, org.organization_id)

    tags = {
        "title": f"{venue.name} | {org.name}",
        "description": venue.description[:200] if venue.description else f"Visit {venue.name}",
        "url": f"{base_url}/c/{org_slug}/visit/{venue_slug}",
        "site_name": org.name,
        "org_slug": org_slug,
    }
    if image_url:
        tags["image"] = image_url

    return HTMLResponse(_inject_og_tags(html, tags))


@router.get("/c/{org_slug}/exhibitions", summary="Discover exhibition list")
def discover_exhibition_list(
    org_slug: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """Serve exhibition list page with OG tags."""
    redirect = _check_redirect(db, request.url.path)
    if redirect:
        return redirect

    html = _read_index_html()
    if not html:
        return Response("Not found", status_code=404)

    settings = get_settings()
    base_url = settings.app_base_url.rstrip("/")

    org = _get_org_by_slug(db, org_slug)
    if not org:
        return _serve_404(html)

    tags = {
        "title": f"Exhibitions | {org.name}",
        "description": f"Explore current and upcoming exhibitions at {org.name}.",
        "url": f"{base_url}/c/{org_slug}/exhibitions",
        "site_name": org.name,
        "org_slug": org_slug,
    }

    return HTMLResponse(_inject_og_tags(html, tags))


@router.get("/c/{org_slug}/exhibitions/{slug}", summary="Discover exhibition detail")
def discover_exhibition_detail(
    org_slug: str,
    slug: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """Serve exhibition detail page with OG tags."""
    redirect = _check_redirect(db, request.url.path)
    if redirect:
        return redirect

    html = _read_index_html()
    if not html:
        return Response("Not found", status_code=404)

    settings = get_settings()
    base_url = settings.app_base_url.rstrip("/")

    org = _get_org_by_slug(db, org_slug)
    if not org:
        return _serve_404(html)

    exhibition = db.query(Exhibition).filter(
        Exhibition.organization_id == org.organization_id,
        Exhibition.public_url_slug == slug,
    ).first()

    if not exhibition:
        return _serve_404(html)

    image_url = _get_ssr_media_url(
        db, exhibition.hero_media_id or exhibition.thumbnail_media_id, org.organization_id,
    )

    desc = exhibition.short_description or exhibition.description or ""
    tags = {
        "title": f"{exhibition.title} | {org.name}",
        "description": desc[:200] if desc else f"Exhibition at {org.name}",
        "url": f"{base_url}/c/{org_slug}/exhibitions/{slug}",
        "site_name": org.name,
        "org_slug": org_slug,
    }
    if image_url:
        tags["image"] = image_url

    return HTMLResponse(_inject_og_tags(html, tags))


@router.get("/c/{org_slug}/events", summary="Discover event list")
def discover_event_list(
    org_slug: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """Serve event list page with OG tags."""
    redirect = _check_redirect(db, request.url.path)
    if redirect:
        return redirect

    html = _read_index_html()
    if not html:
        return Response("Not found", status_code=404)

    settings = get_settings()
    base_url = settings.app_base_url.rstrip("/")

    org = _get_org_by_slug(db, org_slug)
    if not org:
        return _serve_404(html)

    tags = {
        "title": f"Events | {org.name}",
        "description": f"Upcoming events, programs, and activities at {org.name}.",
        "url": f"{base_url}/c/{org_slug}/events",
        "site_name": org.name,
        "org_slug": org_slug,
    }

    return HTMLResponse(_inject_og_tags(html, tags))


@router.get("/c/{org_slug}/events/{slug}", summary="Discover event detail")
def discover_event_detail(
    org_slug: str,
    slug: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """Serve event detail page with OG tags."""
    redirect = _check_redirect(db, request.url.path)
    if redirect:
        return redirect

    html = _read_index_html()
    if not html:
        return Response("Not found", status_code=404)

    settings = get_settings()
    base_url = settings.app_base_url.rstrip("/")

    org = _get_org_by_slug(db, org_slug)
    if not org:
        return _serve_404(html)

    event = db.query(Event).filter(
        Event.organization_id == org.organization_id,
        Event.slug == slug,
        Event.audience == "public",
    ).first()

    if not event:
        return _serve_404(html)

    image_url = _get_ssr_media_url(db, event.hero_media_id, org.organization_id)

    desc = event.short_description or event.description or ""
    tags = {
        "title": f"{event.title} | {org.name}",
        "description": desc[:200] if desc else f"Event at {org.name}",
        "url": f"{base_url}/c/{org_slug}/events/{slug}",
        "site_name": org.name,
        "org_slug": org_slug,
    }
    if image_url:
        tags["image"] = image_url

    return HTMLResponse(_inject_og_tags(html, tags))


# ============================================================================
# Catch-all: any unmatched /c/<org_slug>/... path returns 404
# ============================================================================


@router.get("/c/{org_slug}/{rest:path}", summary="Discover catch all")
def discover_catch_all(
    org_slug: str,
    rest: str,
    db: Session = Depends(get_db),
):
    """Catch-all for unmatched public site paths -- returns HTTP 404."""
    html = _read_index_html()
    return _serve_404(html)
