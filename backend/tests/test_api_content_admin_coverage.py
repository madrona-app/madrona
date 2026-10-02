"""
Coverage tests for ``app/fastapi_app/routers/content_admin.py``.

Targets the CMS admin endpoints for public-facing content sites:
- Pages (CRUD + tree)
- Content blocks (full-save replace)
- Publish / unpublish / preview-token
- Categories (CRUD)
- Menus (get, save upsert, delete) + nested items
- Redirects (CRUD) + automatic slug-change redirect chain collapse
- Viewer (read-only) receives 403 on edit routes

All endpoints are org-scoped and protected by ``content.*`` permissions.
The ``auth_setup`` fixture provides ``platform.admin`` which bypasses RBAC;
the ``viewer_auth_setup`` fixture has only read scopes on unrelated
resources, so content edit routes return 403 for it.
"""
from __future__ import annotations

from uuid import uuid4


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _base(org) -> str:
    return f"/api/organizations/{org.organization_id}/content"


def _create_page_via_api(auth_client, org, **overrides):
    body = {
        "title": overrides.pop("title", "Untitled Page"),
    }
    body.update(overrides)
    return auth_client.post(f"{_base(org)}/pages", json=body)


def _create_category_via_api(auth_client, org, **overrides):
    body = {"name": overrides.pop("name", "News")}
    body.update(overrides)
    return auth_client.post(f"{_base(org)}/categories", json=body)


# ===========================================================================
# PAGES: list / create / get / update / delete / tree
# ===========================================================================


class TestListPages:
    def test_list_pages_empty(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(f"{_base(org)}/pages")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["items"] == []
        assert body["total"] == 0
        assert body["limit"] == 50
        assert body["offset"] == 0

    def test_list_pages_returns_created(self, auth_setup):
        auth_client, org, _ = auth_setup
        r1 = _create_page_via_api(auth_client, org, title="About Us")
        assert r1.status_code == 201
        r2 = _create_page_via_api(auth_client, org, title="Contact", page_type="page")
        assert r2.status_code == 201

        resp = auth_client.get(f"{_base(org)}/pages")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["total"] == 2
        titles = [p["title"] for p in body["items"]]
        assert "About Us" in titles
        assert "Contact" in titles

    def test_list_pages_filter_by_type(self, auth_setup):
        auth_client, org, _ = auth_setup
        _create_page_via_api(auth_client, org, title="Static A", page_type="page")
        _create_page_via_api(auth_client, org, title="Post A", page_type="post")

        resp = auth_client.get(f"{_base(org)}/pages?page_type=post")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["total"] == 1
        assert body["items"][0]["page_type"] == "post"

    def test_list_pages_filter_by_status(self, auth_setup):
        auth_client, org, _ = auth_setup
        _create_page_via_api(auth_client, org, title="Still a Draft")

        resp = auth_client.get(f"{_base(org)}/pages?status=draft")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["total"] == 1

        resp2 = auth_client.get(f"{_base(org)}/pages?status=published")
        assert resp2.status_code == 200
        assert resp2.get_json()["total"] == 0

    def test_list_pages_search_by_title(self, auth_setup):
        auth_client, org, _ = auth_setup
        _create_page_via_api(auth_client, org, title="Annual Exhibition")
        _create_page_via_api(auth_client, org, title="Volunteer Opportunities")

        resp = auth_client.get(f"{_base(org)}/pages?search=Exhibition")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["total"] == 1
        assert body["items"][0]["title"] == "Annual Exhibition"

    def test_list_pages_pagination(self, auth_setup):
        auth_client, org, _ = auth_setup
        for i in range(3):
            _create_page_via_api(auth_client, org, title=f"Page {i}")

        resp = auth_client.get(f"{_base(org)}/pages?limit=2&offset=0")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["total"] == 3
        assert body["limit"] == 2
        assert len(body["items"]) == 2


class TestCreatePage:
    def test_create_page_defaults_slug(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = _create_page_via_api(auth_client, org, title="Hello World!")
        assert resp.status_code == 201
        body = resp.get_json()["data"]
        assert body["title"] == "Hello World!"
        assert body["slug"] == "hello-world"
        assert body["page_type"] == "page"
        assert body["status"] == "draft"
        assert body["blocks"] == []

    def test_create_post_with_custom_slug_and_meta(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            f"{_base(org)}/pages",
            json={
                "title": "Winter Show",
                "slug": "winter-2026",
                "page_type": "post",
                "excerpt": "A seasonal exhibit",
                "meta_title": "Winter Show 2026",
                "meta_description": "Visit our winter show",
                "sort_order": 3,
            },
        )
        assert resp.status_code == 201
        body = resp.get_json()["data"]
        assert body["slug"] == "winter-2026"
        assert body["page_type"] == "post"
        assert body["excerpt"] == "A seasonal exhibit"
        assert body["meta_title"] == "Winter Show 2026"
        assert body["sort_order"] == 3

    def test_create_page_rejects_empty_title(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(f"{_base(org)}/pages", json={"title": "   "})
        assert resp.status_code == 422

    def test_create_page_rejects_invalid_page_type(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            f"{_base(org)}/pages",
            json={"title": "Bad", "page_type": "article"},
        )
        assert resp.status_code == 422

    def test_create_page_rejects_duplicate_slug(self, auth_setup):
        auth_client, org, _ = auth_setup
        r1 = _create_page_via_api(auth_client, org, title="About", slug="about")
        assert r1.status_code == 201
        r2 = _create_page_via_api(auth_client, org, title="About Museum", slug="about")
        assert r2.status_code == 409

    def test_create_page_rejects_invalid_template(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            f"{_base(org)}/pages",
            json={"title": "Valid", "template": "mega-template"},
        )
        assert resp.status_code == 422

    def test_create_page_rejects_invalid_publish_at(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            f"{_base(org)}/pages",
            json={"title": "Scheduled", "publish_at": "tomorrow morning"},
        )
        assert resp.status_code == 422

    def test_create_page_with_inline_blocks(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            f"{_base(org)}/pages",
            json={
                "title": "Rich Page",
                "blocks": [
                    {"block_type": "rich_text", "content": {"html": "<p>Hi</p>"}},
                    {"block_type": "image", "content": {"alt": "Logo"}},
                    # unknown block_type gets silently skipped
                    {"block_type": "not_a_real_type", "content": {}},
                ],
            },
        )
        assert resp.status_code == 201
        data = resp.get_json()["data"]
        assert len(data["blocks"]) == 2
        assert {b["block_type"] for b in data["blocks"]} == {"rich_text", "image"}

    def test_create_page_accepts_iso_publish_at(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            f"{_base(org)}/pages",
            json={
                "title": "Scheduled",
                "publish_at": "2030-01-01T12:00:00Z",
            },
        )
        assert resp.status_code == 201
        assert resp.get_json()["data"]["publish_at"] is not None


class TestGetPage:
    def test_get_page_returns_blocks(self, auth_setup):
        auth_client, org, _ = auth_setup
        create_resp = auth_client.post(
            f"{_base(org)}/pages",
            json={
                "title": "Docs",
                "blocks": [
                    {"block_type": "rich_text", "content": {"html": "body"}},
                ],
            },
        )
        page_id = create_resp.get_json()["data"]["page_id"]

        resp = auth_client.get(f"{_base(org)}/pages/{page_id}")
        assert resp.status_code == 200
        data = resp.get_json()["data"]
        assert data["page_id"] == page_id
        assert len(data["blocks"]) == 1
        assert data["blocks"][0]["block_type"] == "rich_text"

    def test_get_post_includes_categories(self, auth_setup, db_session, client):
        auth_client, org, _ = auth_setup
        cat_resp = _create_category_via_api(auth_client, org, name="Features")
        assert cat_resp.status_code == 201
        category_id = cat_resp.get_json()["data"]["category_id"]

        post_resp = _create_page_via_api(
            auth_client, org, title="Featured Story", page_type="post"
        )
        page_id = post_resp.get_json()["data"]["page_id"]

        # Attach the category via update
        update_resp = auth_client.put(
            f"{_base(org)}/pages/{page_id}",
            json={"category_ids": [category_id]},
        )
        assert update_resp.status_code == 200

        resp = auth_client.get(f"{_base(org)}/pages/{page_id}")
        assert resp.status_code == 200
        data = resp.get_json()["data"]
        assert "categories" in data
        cat_names = [c["name"] for c in data["categories"]]
        assert "Features" in cat_names

    def test_get_page_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(f"{_base(org)}/pages/{uuid4()}")
        assert resp.status_code == 404


class TestUpdatePage:
    def test_update_page_metadata(self, auth_setup):
        auth_client, org, _ = auth_setup
        create = _create_page_via_api(auth_client, org, title="Original")
        page_id = create.get_json()["data"]["page_id"]

        resp = auth_client.put(
            f"{_base(org)}/pages/{page_id}",
            json={
                "title": "Updated Title",
                "excerpt": "New excerpt",
                "meta_title": "meta",
                "meta_description": "desc",
                "template": "landing",
                "sort_order": 7,
            },
        )
        assert resp.status_code == 200
        data = resp.get_json()["data"]
        assert data["title"] == "Updated Title"
        assert data["excerpt"] == "New excerpt"
        assert data["template"] == "landing"
        assert data["sort_order"] == 7

    def test_update_page_rejects_empty_title(self, auth_setup):
        auth_client, org, _ = auth_setup
        create = _create_page_via_api(auth_client, org, title="Before")
        page_id = create.get_json()["data"]["page_id"]

        resp = auth_client.put(
            f"{_base(org)}/pages/{page_id}", json={"title": "   "}
        )
        assert resp.status_code == 422

    def test_update_page_rejects_invalid_template(self, auth_setup):
        auth_client, org, _ = auth_setup
        create = _create_page_via_api(auth_client, org, title="Page")
        page_id = create.get_json()["data"]["page_id"]

        resp = auth_client.put(
            f"{_base(org)}/pages/{page_id}", json={"template": "moon"}
        )
        assert resp.status_code == 422

    def test_update_page_slug_conflict(self, auth_setup):
        auth_client, org, _ = auth_setup
        first = _create_page_via_api(auth_client, org, title="First", slug="first")
        second = _create_page_via_api(auth_client, org, title="Second", slug="second")
        second_id = second.get_json()["data"]["page_id"]

        resp = auth_client.put(
            f"{_base(org)}/pages/{second_id}", json={"slug": "first"}
        )
        assert resp.status_code == 409

    def test_update_page_slug_creates_redirect(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        create = _create_page_via_api(auth_client, org, title="Old", slug="old-slug")
        page_id = create.get_json()["data"]["page_id"]

        resp = auth_client.put(
            f"{_base(org)}/pages/{page_id}", json={"slug": "new-slug"}
        )
        assert resp.status_code == 200
        assert resp.get_json()["data"]["slug"] == "new-slug"

        # Auto-created redirect should exist
        rlist = auth_client.get(f"{_base(org)}/redirects")
        assert rlist.status_code == 200
        sources = [r["source_path"] for r in rlist.get_json()["items"]]
        assert "/pages/old-slug" in sources

    def test_update_page_slug_collapses_redirect_chain(self, auth_setup, db_session):
        """When a slug changes A -> B -> C, redirects that point to B get collapsed to C."""
        auth_client, org, _ = auth_setup
        create = _create_page_via_api(auth_client, org, title="T", slug="aaa")
        page_id = create.get_json()["data"]["page_id"]

        r1 = auth_client.put(
            f"{_base(org)}/pages/{page_id}", json={"slug": "bbb"}
        )
        assert r1.status_code == 200

        r2 = auth_client.put(
            f"{_base(org)}/pages/{page_id}", json={"slug": "ccc"}
        )
        assert r2.status_code == 200

        # /pages/aaa should now target /pages/ccc (collapsed from /pages/bbb)
        rlist = auth_client.get(f"{_base(org)}/redirects").get_json()["items"]
        aaa = next((r for r in rlist if r["source_path"] == "/pages/aaa"), None)
        assert aaa is not None
        assert aaa["target_path"] == "/pages/ccc"

    def test_update_page_rejects_invalid_publish_at(self, auth_setup):
        auth_client, org, _ = auth_setup
        create = _create_page_via_api(auth_client, org, title="P")
        page_id = create.get_json()["data"]["page_id"]

        resp = auth_client.put(
            f"{_base(org)}/pages/{page_id}", json={"publish_at": "next week"}
        )
        assert resp.status_code == 422

    def test_update_page_clears_publish_at(self, auth_setup):
        auth_client, org, _ = auth_setup
        create = auth_client.post(
            f"{_base(org)}/pages",
            json={"title": "P", "publish_at": "2030-01-01T00:00:00Z"},
        )
        page_id = create.get_json()["data"]["page_id"]

        resp = auth_client.put(
            f"{_base(org)}/pages/{page_id}", json={"publish_at": ""}
        )
        assert resp.status_code == 200
        assert resp.get_json()["data"]["publish_at"] is None

    def test_update_page_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.put(
            f"{_base(org)}/pages/{uuid4()}", json={"title": "ghost"}
        )
        assert resp.status_code == 404


class TestDeletePage:
    def test_delete_page(self, auth_setup):
        auth_client, org, _ = auth_setup
        create = _create_page_via_api(auth_client, org, title="Doomed")
        page_id = create.get_json()["data"]["page_id"]

        resp = auth_client.delete(f"{_base(org)}/pages/{page_id}")
        assert resp.status_code == 204

        get_resp = auth_client.get(f"{_base(org)}/pages/{page_id}")
        assert get_resp.status_code == 404

    def test_delete_page_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.delete(f"{_base(org)}/pages/{uuid4()}")
        assert resp.status_code == 404


class TestPageTree:
    def test_page_tree_builds_hierarchy(self, auth_setup):
        auth_client, org, _ = auth_setup
        root = _create_page_via_api(auth_client, org, title="Root")
        root_id = root.get_json()["data"]["page_id"]
        child = _create_page_via_api(
            auth_client, org, title="Child", parent_page_id=root_id
        )
        assert child.status_code == 201

        resp = auth_client.get(f"{_base(org)}/pages/tree")
        assert resp.status_code == 200
        tree = resp.get_json()["data"]
        assert len(tree) == 1
        assert tree[0]["title"] == "Root"
        assert tree[0]["depth"] == 0
        assert len(tree[0]["children"]) == 1
        assert tree[0]["children"][0]["title"] == "Child"
        assert tree[0]["children"][0]["depth"] == 1

    def test_page_tree_excludes_posts(self, auth_setup):
        auth_client, org, _ = auth_setup
        _create_page_via_api(auth_client, org, title="A Page", page_type="page")
        _create_page_via_api(auth_client, org, title="A Post", page_type="post")

        resp = auth_client.get(f"{_base(org)}/pages/tree")
        tree = resp.get_json()["data"]
        titles = [n["title"] for n in tree]
        assert "A Page" in titles
        assert "A Post" not in titles


# ===========================================================================
# BLOCKS: replace
# ===========================================================================


class TestReplaceBlocks:
    def test_replace_blocks_full_save(self, auth_setup):
        auth_client, org, _ = auth_setup
        create = _create_page_via_api(auth_client, org, title="Editable")
        page_id = create.get_json()["data"]["page_id"]

        resp = auth_client.put(
            f"{_base(org)}/pages/{page_id}/blocks",
            json={
                "blocks": [
                    {"block_type": "hero_banner", "content": {"heading": "Welcome"}},
                    {"block_type": "rich_text", "content": {"html": "<p>x</p>"}},
                    {"block_type": "divider", "content": {}},
                ]
            },
        )
        assert resp.status_code == 200
        blocks = resp.get_json()["data"]
        assert len(blocks) == 3
        # Verify sort_order is set by index
        assert [b["sort_order"] for b in blocks] == [0, 1, 2]
        assert blocks[0]["block_type"] == "hero_banner"

    def test_replace_blocks_overwrites_existing(self, auth_setup):
        auth_client, org, _ = auth_setup
        create = auth_client.post(
            f"{_base(org)}/pages",
            json={
                "title": "Has Blocks",
                "blocks": [{"block_type": "rich_text", "content": {}}],
            },
        )
        page_id = create.get_json()["data"]["page_id"]

        resp = auth_client.put(
            f"{_base(org)}/pages/{page_id}/blocks",
            json={
                "blocks": [
                    {"block_type": "quote", "content": {"text": "q"}},
                ]
            },
        )
        assert resp.status_code == 200
        blocks = resp.get_json()["data"]
        assert len(blocks) == 1
        assert blocks[0]["block_type"] == "quote"

    def test_replace_blocks_rejects_invalid_type(self, auth_setup):
        auth_client, org, _ = auth_setup
        create = _create_page_via_api(auth_client, org, title="X")
        page_id = create.get_json()["data"]["page_id"]

        resp = auth_client.put(
            f"{_base(org)}/pages/{page_id}/blocks",
            json={"blocks": [{"block_type": "laser_beam", "content": {}}]},
        )
        assert resp.status_code == 422

    def test_replace_blocks_page_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.put(
            f"{_base(org)}/pages/{uuid4()}/blocks",
            json={"blocks": []},
        )
        assert resp.status_code == 404


# ===========================================================================
# PUBLISH / UNPUBLISH / PREVIEW-TOKEN
# ===========================================================================


class TestPublishUnpublish:
    def test_publish_page_immediate(self, auth_setup):
        auth_client, org, _ = auth_setup
        create = _create_page_via_api(auth_client, org, title="To Publish")
        page_id = create.get_json()["data"]["page_id"]

        resp = auth_client.post(
            f"{_base(org)}/pages/{page_id}/publish", json={}
        )
        assert resp.status_code == 200
        data = resp.get_json()["data"]
        assert data["status"] == "published"
        assert data["published_at"] is not None
        assert data["publish_at"] is None

    def test_publish_with_future_schedule(self, auth_setup):
        auth_client, org, _ = auth_setup
        create = _create_page_via_api(auth_client, org, title="Scheduled")
        page_id = create.get_json()["data"]["page_id"]

        resp = auth_client.post(
            f"{_base(org)}/pages/{page_id}/publish",
            json={"publish_at": "2030-06-15T08:00:00Z"},
        )
        assert resp.status_code == 200
        data = resp.get_json()["data"]
        # Scheduled publish keeps draft status
        assert data["status"] == "draft"
        assert data["publish_at"] is not None

    def test_publish_rejects_invalid_publish_at(self, auth_setup):
        auth_client, org, _ = auth_setup
        create = _create_page_via_api(auth_client, org, title="S")
        page_id = create.get_json()["data"]["page_id"]

        resp = auth_client.post(
            f"{_base(org)}/pages/{page_id}/publish",
            json={"publish_at": "tomorrow"},
        )
        assert resp.status_code == 422

    def test_publish_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            f"{_base(org)}/pages/{uuid4()}/publish", json={}
        )
        assert resp.status_code == 404

    def test_unpublish_page(self, auth_setup):
        auth_client, org, _ = auth_setup
        create = _create_page_via_api(auth_client, org, title="P")
        page_id = create.get_json()["data"]["page_id"]
        auth_client.post(f"{_base(org)}/pages/{page_id}/publish", json={})

        resp = auth_client.post(f"{_base(org)}/pages/{page_id}/unpublish")
        assert resp.status_code == 200
        assert resp.get_json()["data"]["status"] == "draft"

    def test_unpublish_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(f"{_base(org)}/pages/{uuid4()}/unpublish")
        assert resp.status_code == 404


class TestPreviewToken:
    def test_create_preview_token(self, auth_setup):
        auth_client, org, _ = auth_setup
        create = _create_page_via_api(auth_client, org, title="Draft")
        page_id = create.get_json()["data"]["page_id"]

        resp = auth_client.post(
            f"{_base(org)}/pages/{page_id}/preview-token"
        )
        assert resp.status_code == 200
        data = resp.get_json()["data"]
        assert data["page_id"] == page_id
        assert isinstance(data["preview_token"], str) and len(data["preview_token"]) > 0
        assert isinstance(data["preview_expires"], str)

    def test_create_preview_token_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            f"{_base(org)}/pages/{uuid4()}/preview-token"
        )
        assert resp.status_code == 404


# ===========================================================================
# CATEGORIES
# ===========================================================================


class TestCategories:
    def test_list_categories_empty(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(f"{_base(org)}/categories")
        assert resp.status_code == 200
        assert resp.get_json()["data"] == []

    def test_create_category(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = _create_category_via_api(
            auth_client, org, name="News", description="Press releases"
        )
        assert resp.status_code == 201
        data = resp.get_json()["data"]
        assert data["name"] == "News"
        assert data["slug"] == "news"
        assert data["description"] == "Press releases"

    def test_create_category_rejects_empty_name(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            f"{_base(org)}/categories", json={"name": "  "}
        )
        assert resp.status_code == 422

    def test_create_category_duplicate_slug(self, auth_setup):
        auth_client, org, _ = auth_setup
        r1 = _create_category_via_api(auth_client, org, name="X", slug="dup")
        assert r1.status_code == 201
        r2 = _create_category_via_api(auth_client, org, name="Y", slug="dup")
        assert r2.status_code == 409

    def test_update_category(self, auth_setup):
        auth_client, org, _ = auth_setup
        create = _create_category_via_api(auth_client, org, name="Before")
        cat_id = create.get_json()["data"]["category_id"]

        resp = auth_client.put(
            f"{_base(org)}/categories/{cat_id}",
            json={"name": "After", "slug": "after", "sort_order": 5},
        )
        assert resp.status_code == 200
        data = resp.get_json()["data"]
        assert data["name"] == "After"
        assert data["slug"] == "after"
        assert data["sort_order"] == 5

    def test_update_category_empty_name_rejected(self, auth_setup):
        auth_client, org, _ = auth_setup
        create = _create_category_via_api(auth_client, org, name="Name")
        cat_id = create.get_json()["data"]["category_id"]

        resp = auth_client.put(
            f"{_base(org)}/categories/{cat_id}", json={"name": " "}
        )
        assert resp.status_code == 422

    def test_update_category_slug_conflict(self, auth_setup):
        auth_client, org, _ = auth_setup
        first = _create_category_via_api(auth_client, org, name="A", slug="aaa")
        second = _create_category_via_api(auth_client, org, name="B", slug="bbb")
        second_id = second.get_json()["data"]["category_id"]

        resp = auth_client.put(
            f"{_base(org)}/categories/{second_id}", json={"slug": "aaa"}
        )
        assert resp.status_code == 409

    def test_update_category_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.put(
            f"{_base(org)}/categories/{uuid4()}", json={"name": "x"}
        )
        assert resp.status_code == 404

    def test_delete_category(self, auth_setup):
        auth_client, org, _ = auth_setup
        create = _create_category_via_api(auth_client, org, name="Trashable")
        cat_id = create.get_json()["data"]["category_id"]

        resp = auth_client.delete(f"{_base(org)}/categories/{cat_id}")
        assert resp.status_code == 204

        # List no longer contains it
        listing = auth_client.get(f"{_base(org)}/categories").get_json()["data"]
        assert all(c["category_id"] != cat_id for c in listing)

    def test_delete_category_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.delete(f"{_base(org)}/categories/{uuid4()}")
        assert resp.status_code == 404


# ===========================================================================
# MENUS
# ===========================================================================


class TestMenus:
    def test_get_empty_menu_returns_defaults(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(f"{_base(org)}/menus/header")
        assert resp.status_code == 200
        data = resp.get_json()["data"]
        assert data["location"] == "header"
        assert data["items"] == []

    def test_get_menu_invalid_location(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(f"{_base(org)}/menus/sidebar")
        assert resp.status_code == 400

    def test_save_menu_with_nested_items(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.put(
            f"{_base(org)}/menus/header",
            json={
                "name": "Main Nav",
                "items": [
                    {
                        "label": "About",
                        "link_type": "url",
                        "url": "/about",
                        "highlight": True,
                        "children": [
                            {
                                "label": "Our Story",
                                "link_type": "url",
                                "url": "/about/story",
                            }
                        ],
                    },
                    # Unknown link_type at top level -> silently skipped
                    {"label": "Skip", "link_type": "foobar", "url": "/nope"},
                    {"label": "Contact", "link_type": "url", "url": "/contact"},
                ],
            },
        )
        assert resp.status_code == 200
        data = resp.get_json()["data"]
        assert data["name"] == "Main Nav"
        # Skip item dropped, 2 top-level survive
        assert len(data["items"]) == 2
        labels = [i["label"] for i in data["items"]]
        assert "About" in labels
        assert "Skip" not in labels

        # 'About' should have one child
        about = next(i for i in data["items"] if i["label"] == "About")
        assert len(about["children"]) == 1
        assert about["children"][0]["label"] == "Our Story"
        assert about["highlight"] is True

    def test_save_menu_updates_existing(self, auth_setup):
        auth_client, org, _ = auth_setup
        first = auth_client.put(
            f"{_base(org)}/menus/footer",
            json={
                "name": "v1",
                "items": [{"label": "a", "link_type": "url", "url": "/a"}],
            },
        )
        assert first.status_code == 200

        second = auth_client.put(
            f"{_base(org)}/menus/footer",
            json={
                "name": "v2",
                "items": [
                    {"label": "b", "link_type": "url", "url": "/b"},
                    {"label": "c", "link_type": "url", "url": "/c"},
                ],
            },
        )
        assert second.status_code == 200
        data = second.get_json()["data"]
        assert data["name"] == "v2"
        labels = [i["label"] for i in data["items"]]
        assert labels == ["b", "c"]

    def test_save_menu_invalid_location(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.put(
            f"{_base(org)}/menus/sidebar",
            json={"name": "x", "items": []},
        )
        assert resp.status_code == 400

    def test_delete_menu(self, auth_setup):
        auth_client, org, _ = auth_setup
        auth_client.put(
            f"{_base(org)}/menus/header",
            json={"name": "n", "items": [{"label": "x", "link_type": "url", "url": "/"}]},
        )

        resp = auth_client.delete(f"{_base(org)}/menus/header")
        assert resp.status_code == 204

        get_resp = auth_client.get(f"{_base(org)}/menus/header")
        assert get_resp.status_code == 200
        # Empty defaults after deletion
        assert get_resp.get_json()["data"]["items"] == []

    def test_delete_menu_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.delete(f"{_base(org)}/menus/footer")
        assert resp.status_code == 404

    def test_delete_menu_invalid_location(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.delete(f"{_base(org)}/menus/widget")
        assert resp.status_code == 400


# ===========================================================================
# REDIRECTS
# ===========================================================================


class TestRedirects:
    def test_list_redirects_empty(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(f"{_base(org)}/redirects")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["items"] == []
        assert body["total"] == 0

    def test_create_redirect(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            f"{_base(org)}/redirects",
            json={
                "source_path": "/old",
                "target_path": "/new",
                "redirect_type": 302,
                "is_active": True,
                "note": "Temporary",
            },
        )
        assert resp.status_code == 201
        data = resp.get_json()["data"]
        assert data["source_path"] == "/old"
        assert data["target_path"] == "/new"
        assert data["redirect_type"] == 302
        assert data["is_active"] is True
        assert data["note"] == "Temporary"

    def test_create_redirect_empty_paths(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            f"{_base(org)}/redirects",
            json={"source_path": "", "target_path": "/new"},
        )
        assert resp.status_code == 422

    def test_create_redirect_invalid_type(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            f"{_base(org)}/redirects",
            json={"source_path": "/a", "target_path": "/b", "redirect_type": 418},
        )
        assert resp.status_code == 422

    def test_create_redirect_conflict(self, auth_setup):
        auth_client, org, _ = auth_setup
        r1 = auth_client.post(
            f"{_base(org)}/redirects",
            json={"source_path": "/dup", "target_path": "/one"},
        )
        assert r1.status_code == 201
        r2 = auth_client.post(
            f"{_base(org)}/redirects",
            json={"source_path": "/dup", "target_path": "/two"},
        )
        assert r2.status_code == 409

    def test_update_redirect(self, auth_setup):
        auth_client, org, _ = auth_setup
        create = auth_client.post(
            f"{_base(org)}/redirects",
            json={"source_path": "/u", "target_path": "/v"},
        )
        redirect_id = create.get_json()["data"]["redirect_id"]

        resp = auth_client.put(
            f"{_base(org)}/redirects/{redirect_id}",
            json={
                "source_path": "/u2",
                "target_path": "/v2",
                "redirect_type": 302,
                "is_active": False,
                "note": "updated",
            },
        )
        assert resp.status_code == 200
        data = resp.get_json()["data"]
        assert data["source_path"] == "/u2"
        assert data["target_path"] == "/v2"
        assert data["redirect_type"] == 302
        assert data["is_active"] is False
        assert data["note"] == "updated"

    def test_update_redirect_source_conflict(self, auth_setup):
        auth_client, org, _ = auth_setup
        auth_client.post(
            f"{_base(org)}/redirects",
            json={"source_path": "/alpha", "target_path": "/one"},
        )
        second = auth_client.post(
            f"{_base(org)}/redirects",
            json={"source_path": "/beta", "target_path": "/two"},
        )
        beta_id = second.get_json()["data"]["redirect_id"]

        resp = auth_client.put(
            f"{_base(org)}/redirects/{beta_id}", json={"source_path": "/alpha"}
        )
        assert resp.status_code == 409

    def test_update_redirect_invalid_type(self, auth_setup):
        auth_client, org, _ = auth_setup
        create = auth_client.post(
            f"{_base(org)}/redirects",
            json={"source_path": "/x", "target_path": "/y"},
        )
        redirect_id = create.get_json()["data"]["redirect_id"]

        resp = auth_client.put(
            f"{_base(org)}/redirects/{redirect_id}", json={"redirect_type": 999}
        )
        assert resp.status_code == 422

    def test_update_redirect_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.put(
            f"{_base(org)}/redirects/{uuid4()}", json={"note": "x"}
        )
        assert resp.status_code == 404

    def test_delete_redirect(self, auth_setup):
        auth_client, org, _ = auth_setup
        create = auth_client.post(
            f"{_base(org)}/redirects",
            json={"source_path": "/kill", "target_path": "/me"},
        )
        redirect_id = create.get_json()["data"]["redirect_id"]

        resp = auth_client.delete(f"{_base(org)}/redirects/{redirect_id}")
        assert resp.status_code == 204

        listing = auth_client.get(f"{_base(org)}/redirects").get_json()["items"]
        assert all(r["redirect_id"] != redirect_id for r in listing)

    def test_delete_redirect_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.delete(f"{_base(org)}/redirects/{uuid4()}")
        assert resp.status_code == 404

    def test_list_redirects_pagination(self, auth_setup):
        auth_client, org, _ = auth_setup
        for i in range(3):
            auth_client.post(
                f"{_base(org)}/redirects",
                json={"source_path": f"/s{i}", "target_path": f"/t{i}"},
            )

        resp = auth_client.get(f"{_base(org)}/redirects?limit=2&offset=0")
        body = resp.get_json()
        assert body["total"] == 3
        assert len(body["items"]) == 2
        assert body["limit"] == 2


# ===========================================================================
# VIEWER (read-only) gets 403 on mutating routes
# ===========================================================================


class TestViewerForbidden:
    """Viewer role lacks ``content.*`` permissions — every admin route 403s."""

    def test_viewer_cannot_list_pages(self, viewer_auth_setup):
        viewer_client, org, _ = viewer_auth_setup
        resp = viewer_client.get(f"{_base(org)}/pages")
        assert resp.status_code == 403

    def test_viewer_cannot_create_page(self, viewer_auth_setup):
        viewer_client, org, _ = viewer_auth_setup
        resp = viewer_client.post(
            f"{_base(org)}/pages", json={"title": "Unauthorized"}
        )
        assert resp.status_code == 403

    def test_viewer_cannot_update_page(self, viewer_auth_setup):
        viewer_client, org, _ = viewer_auth_setup
        resp = viewer_client.put(
            f"{_base(org)}/pages/{uuid4()}", json={"title": "N"}
        )
        assert resp.status_code == 403

    def test_viewer_cannot_delete_page(self, viewer_auth_setup):
        viewer_client, org, _ = viewer_auth_setup
        resp = viewer_client.delete(f"{_base(org)}/pages/{uuid4()}")
        assert resp.status_code == 403

    def test_viewer_cannot_replace_blocks(self, viewer_auth_setup):
        viewer_client, org, _ = viewer_auth_setup
        resp = viewer_client.put(
            f"{_base(org)}/pages/{uuid4()}/blocks", json={"blocks": []}
        )
        assert resp.status_code == 403

    def test_viewer_cannot_publish(self, viewer_auth_setup):
        viewer_client, org, _ = viewer_auth_setup
        resp = viewer_client.post(
            f"{_base(org)}/pages/{uuid4()}/publish", json={}
        )
        assert resp.status_code == 403

    def test_viewer_cannot_unpublish(self, viewer_auth_setup):
        viewer_client, org, _ = viewer_auth_setup
        resp = viewer_client.post(f"{_base(org)}/pages/{uuid4()}/unpublish")
        assert resp.status_code == 403

    def test_viewer_cannot_save_menu(self, viewer_auth_setup):
        viewer_client, org, _ = viewer_auth_setup
        resp = viewer_client.put(
            f"{_base(org)}/menus/header",
            json={"name": "n", "items": []},
        )
        assert resp.status_code == 403

    def test_viewer_cannot_create_redirect(self, viewer_auth_setup):
        viewer_client, org, _ = viewer_auth_setup
        resp = viewer_client.post(
            f"{_base(org)}/redirects",
            json={"source_path": "/a", "target_path": "/b"},
        )
        assert resp.status_code == 403

    def test_viewer_cannot_create_category(self, viewer_auth_setup):
        viewer_client, org, _ = viewer_auth_setup
        resp = viewer_client.post(
            f"{_base(org)}/categories", json={"name": "Nope"}
        )
        assert resp.status_code == 403
