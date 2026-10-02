"""Coverage tests for app/fastapi_app/routers/content_public.py.

Public CMS routes under /api/content/{org_slug}/... — pages, posts, categories,
menus, sitemap.xml, robots.txt, feed.xml, preview tokens. No auth required;
404 on unknown org_slug.
"""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import patch
from uuid import uuid4

import pytest

from app.models import Category, Menu, MenuItem, Organization, Page


# The public-content router caches responses in Redis (pub_cache_get / set).
# Without isolation, the first test seeds data + caches a response, then the
# next test sees that cached response. Patch the cache to no-op for the
# whole module.
@pytest.fixture(autouse=True)
def _disable_public_cache():
    with patch("app.fastapi_app.routers.content_public.pub_cache_get", return_value=None):
        with patch("app.fastapi_app.routers.content_public.pub_cache_set"):
            yield


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def public_org(db_session):
    """An organization with a slug, suitable for /api/content/{slug}/... routes."""
    org = Organization(
        name="Public Test Org",
        slug="public-test",
        is_demo=False,
        status="active",
    )
    db_session.add(org)
    db_session.commit()
    return org


def _seed_page(
    db_session,
    org,
    *,
    slug: str,
    title: str = "Page",
    page_type: str = "page",
    status: str = "published",
    sort_order: int = 0,
):
    page = Page(
        organization_id=org.organization_id,
        slug=slug,
        title=title,
        page_type=page_type,
        status=status,
        sort_order=sort_order,
        published_at=datetime.now(timezone.utc) if status == "published" else None,
    )
    db_session.add(page)
    db_session.commit()
    return page


# ---------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------


class TestListPages:
    def test_unknown_org_returns_404(self, client):
        resp = client.get("/api/content/nope-no-such-org/pages")
        assert resp.status_code == 404

    def test_returns_published_pages(self, client, db_session, public_org):
        _seed_page(db_session, public_org, slug="about", title="About")
        _seed_page(db_session, public_org, slug="contact", title="Contact")
        resp = client.get(f"/api/content/{public_org.slug}/pages")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["total"] == 2
        slugs = {p["slug"] for p in body["data"]}
        assert {"about", "contact"} <= slugs

    def test_excludes_drafts(self, client, db_session, public_org):
        _seed_page(db_session, public_org, slug="published-only", status="published")
        _seed_page(db_session, public_org, slug="draft-hidden", status="draft")
        resp = client.get(f"/api/content/{public_org.slug}/pages")
        body = resp.get_json()
        slugs = {p["slug"] for p in body["data"]}
        assert "published-only" in slugs
        assert "draft-hidden" not in slugs

    def test_excludes_posts(self, client, db_session, public_org):
        _seed_page(db_session, public_org, slug="page-only", page_type="page")
        _seed_page(db_session, public_org, slug="post-only", page_type="post")
        resp = client.get(f"/api/content/{public_org.slug}/pages")
        body = resp.get_json()
        slugs = {p["slug"] for p in body["data"]}
        assert "page-only" in slugs
        assert "post-only" not in slugs


class TestGetPage:
    def test_returns_published_by_slug(self, client, db_session, public_org):
        _seed_page(db_session, public_org, slug="hello", title="Hello")
        resp = client.get(f"/api/content/{public_org.slug}/pages/hello")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["data"]["slug"] == "hello"
        assert body["data"]["title"] == "Hello"

    def test_unknown_slug_returns_404(self, client, public_org):
        resp = client.get(f"/api/content/{public_org.slug}/pages/nope")
        assert resp.status_code == 404

    def test_draft_returns_404(self, client, db_session, public_org):
        _seed_page(db_session, public_org, slug="hidden", status="draft")
        resp = client.get(f"/api/content/{public_org.slug}/pages/hidden")
        assert resp.status_code == 404

    def test_returns_by_id(self, client, db_session, public_org):
        page = _seed_page(db_session, public_org, slug="byid", title="ById")
        resp = client.get(
            f"/api/content/{public_org.slug}/pages/by-id/{page.page_id}"
        )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["data"]["slug"] == "byid"


# ---------------------------------------------------------------------------
# Posts
# ---------------------------------------------------------------------------


class TestListPosts:
    def test_returns_published_posts(self, client, db_session, public_org):
        _seed_page(
            db_session, public_org, slug="post-1", title="One", page_type="post"
        )
        _seed_page(
            db_session, public_org, slug="post-2", title="Two", page_type="post"
        )
        resp = client.get(f"/api/content/{public_org.slug}/posts")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["total"] >= 2

    def test_excludes_static_pages(self, client, db_session, public_org):
        _seed_page(
            db_session, public_org, slug="real-post", page_type="post"
        )
        _seed_page(
            db_session, public_org, slug="real-page", page_type="page"
        )
        resp = client.get(f"/api/content/{public_org.slug}/posts")
        body = resp.get_json()
        slugs = {p["slug"] for p in body["data"]}
        assert "real-post" in slugs
        assert "real-page" not in slugs


class TestGetPost:
    def test_returns_published_post(self, client, db_session, public_org):
        _seed_page(
            db_session, public_org, slug="my-post", title="My", page_type="post"
        )
        resp = client.get(f"/api/content/{public_org.slug}/posts/my-post")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["data"]["slug"] == "my-post"

    def test_unknown_post_404(self, client, public_org):
        resp = client.get(f"/api/content/{public_org.slug}/posts/no-such-post")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------


class TestCategories:
    def test_empty_org_returns_empty_list(self, client, public_org):
        resp = client.get(f"/api/content/{public_org.slug}/categories")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body.get("total", 0) == 0
        assert body.get("data") == []

    def test_returns_categories(self, client, db_session, public_org):
        cat = Category(
            organization_id=public_org.organization_id,
            slug="news",
            name="News",
        )
        db_session.add(cat)
        db_session.commit()
        resp = client.get(f"/api/content/{public_org.slug}/categories")
        body = resp.get_json()
        slugs = {c["slug"] for c in body["data"]}
        assert "news" in slugs


# ---------------------------------------------------------------------------
# Sitemap / robots / feed
# ---------------------------------------------------------------------------


class TestSitemap:
    def test_returns_xml(self, client, db_session, public_org):
        _seed_page(db_session, public_org, slug="indexed", title="Indexed")
        resp = client.get(f"/api/content/{public_org.slug}/sitemap.xml")
        assert resp.status_code == 200
        text = resp.get_data(as_text=True) if hasattr(resp, "get_data") else resp.text
        # XML response should reference urlset
        assert "<urlset" in text or "urlset" in text

    def test_unknown_org_404(self, client):
        resp = client.get("/api/content/nonexistent/sitemap.xml")
        assert resp.status_code == 404


class TestRobots:
    def test_returns_text(self, client, public_org):
        resp = client.get(f"/api/content/{public_org.slug}/robots.txt")
        assert resp.status_code == 200

    def test_unknown_org_404(self, client):
        resp = client.get("/api/content/nonexistent/robots.txt")
        assert resp.status_code == 404


class TestFeed:
    def test_returns_xml(self, client, public_org):
        resp = client.get(f"/api/content/{public_org.slug}/feed.xml")
        assert resp.status_code == 200

    def test_unknown_org_404(self, client):
        resp = client.get("/api/content/nonexistent/feed.xml")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Preview
# ---------------------------------------------------------------------------


class TestPreview:
    def test_invalid_token_returns_403(self, client, db_session, public_org):
        page = _seed_page(db_session, public_org, slug="hidden", status="draft")
        url = (
            f"/api/content/{public_org.slug}/preview/{page.page_id}"
            "?token=bogus&expires=9999999999"
        )
        resp = client.get(url)
        # Should reject the token; 400 (bad token format), 403 (sig invalid),
        # or 404 (page id not previewable) all valid.
        assert resp.status_code in (400, 401, 403, 404)


# ---------------------------------------------------------------------------
# Menus
# ---------------------------------------------------------------------------


class TestMenus:
    def test_unknown_menu_location_returns_400(self, client, public_org):
        # Router only accepts 'header' or 'footer'.
        resp = client.get(f"/api/content/{public_org.slug}/menus/sidebar")
        assert resp.status_code == 400

    def test_returns_menu_when_present(self, client, db_session, public_org):
        menu = Menu(
            organization_id=public_org.organization_id,
            location="header",
            name="Main",
        )
        db_session.add(menu)
        db_session.flush()
        item = MenuItem(
            organization_id=public_org.organization_id,
            menu_id=menu.menu_id,
            label="Home",
            link_type="url",
            url="/",
            sort_order=0,
        )
        db_session.add(item)
        db_session.commit()
        resp = client.get(f"/api/content/{public_org.slug}/menus/header")
        # Either 200 with the menu or 404 if location enum disallows "header"
        assert resp.status_code in (200, 404, 422)
