"""
Deaccessioned records are kept out of general search
(Organization.hide_deaccessioned_in_search, services/deaccession_visibility.py).

  * the setting is on by default and can be switched by org.manage_settings;
  * staff object lists and search leave deaccessioned objects out unless
    include_deaccessioned is set or the status filter asks for them;
  * the public portal never shows them while the setting is on, and shows
    discoverable ones again when it is off.
"""

from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch

from app.models import CollectionObject, DiscoverConfig, ObjectTitle, Organization

SETTING = "/api/organizations/{}/collections/settings/deaccessioned-search"


def _obj(db, org_id, title, status="accessioned", **kw):
    obj = CollectionObject(
        organization_id=org_id,
        object_number=f"DA-{uuid.uuid4().hex[:6].upper()}",
        object_name=title,
        object_status=status,
        is_discoverable=True,
        **kw,
    )
    db.add(obj)
    db.flush()
    db.add(ObjectTitle(organization_id=org_id, object_id=obj.object_id, title=title, is_preferred=True))
    db.commit()
    return obj


def _set_slug(db, org_id, slug):
    org = db.query(Organization).filter_by(organization_id=org_id).one()
    org.slug = slug
    db.commit()


def _capturing_search(objects=()):
    from app.search.collections.schemas import CollectionsSearchHit

    calls = []

    def search(req, org_id, db_session=None):
        calls.append(req)
        resp = MagicMock()
        resp.hits = [CollectionsSearchHit(object_id=str(o.object_id), title=o.object_name) for o in objects]
        resp.total = len(objects)
        resp.facets = None
        resp.next_offset = None
        resp.model_dump.return_value = {"hits": [], "total": 0, "facets": None, "took_ms": 1}
        return resp

    service = MagicMock()
    service.search.side_effect = search
    return service, calls


def _patch_search(service):
    return (
        patch("app.search.collections.service.CollectionsSearchService.is_available", return_value=True),
        patch("app.search.collections.service.get_collections_search_service", return_value=service),
    )


class TestSetting:
    def test_on_by_default_and_toggles(self, auth_setup, db_session):
        client, org, _ = auth_setup
        url = SETTING.format(org.organization_id)
        assert client.get(url).get_json() == {"hide_deaccessioned": True}
        r = client.put(url, json={"hide_deaccessioned": False})
        assert r.status_code == 200 and r.get_json() == {"hide_deaccessioned": False}
        assert client.get(url).get_json() == {"hide_deaccessioned": False}
        db_session.expire_all()
        assert db_session.get(Organization, org.organization_id).hide_deaccessioned_in_search is False

    def test_rejects_non_boolean(self, auth_setup):
        client, org, _ = auth_setup
        r = client.put(SETTING.format(org.organization_id), json={"hide_deaccessioned": "no"})
        assert r.status_code == 422

    def test_viewer_reads_but_cannot_change(self, viewer_auth_setup):
        client, org, _ = viewer_auth_setup
        url = SETTING.format(org.organization_id)
        assert client.get(url).status_code == 200
        assert client.put(url, json={"hide_deaccessioned": False}).status_code == 403


class TestStaffList:
    def _titles(self, client, org_id, query=""):
        r = client.get(f"/api/organizations/{org_id}/collections/objects{query}")
        assert r.status_code == 200, r.text
        return sorted(o["object_name"] for o in r.get_json()["items"])

    def test_database_list_excludes_unless_asked(self, auth_setup, db_session):
        client, org, _ = auth_setup
        _obj(db_session, org.organization_id, "Kept vase")
        _obj(db_session, org.organization_id, "Gone vase", status="deaccessioned")
        assert self._titles(client, org.organization_id) == ["Kept vase"]
        assert self._titles(client, org.organization_id, "?include_deaccessioned=true") == ["Gone vase", "Kept vase"]
        assert self._titles(client, org.organization_id, "?object_status=deaccessioned") == ["Gone vase"]

        client.put(SETTING.format(org.organization_id), json={"hide_deaccessioned": False})
        assert self._titles(client, org.organization_id) == ["Gone vase", "Kept vase"]

    def test_search_term_path_excludes(self, auth_setup, db_session):
        client, org, _ = auth_setup
        service, calls = _capturing_search()
        a, b = _patch_search(service)
        with a, b:
            client.get(f"/api/organizations/{org.organization_id}/collections/objects?search=vase")
            client.get(f"/api/organizations/{org.organization_id}/collections/objects?search=vase&include_deaccessioned=true")
        assert calls[0].filters.exclude_object_status == ["deaccessioned"]
        assert not calls[1].filters.exclude_object_status


class TestStaffSearch:
    def _search(self, client, org_id, body):
        service, calls = _capturing_search()
        a, b = _patch_search(service)
        with a, b:
            r = client.post(f"/api/organizations/{org_id}/collections/search", json=body)
        assert r.status_code == 200, r.text
        return calls[0]

    def test_excluded_by_default(self, auth_setup):
        client, org, _ = auth_setup
        req = self._search(client, org.organization_id, {"query": {"q": "vase"}})
        assert req.filters.exclude_object_status == ["deaccessioned"]

    def test_include_flag_and_status_filter(self, auth_setup):
        client, org, _ = auth_setup
        req = self._search(client, org.organization_id, {"include_deaccessioned": True})
        assert not (req.filters and req.filters.exclude_object_status)
        req = self._search(client, org.organization_id, {"filters": {"object_status": ["deaccessioned"]}})
        assert not req.filters.exclude_object_status

    def test_setting_off(self, auth_setup):
        client, org, _ = auth_setup
        client.put(SETTING.format(org.organization_id), json={"hide_deaccessioned": False})
        req = self._search(client, org.organization_id, {})
        assert not (req.filters and req.filters.exclude_object_status)

    def test_query_builder_emits_must_not(self):
        from app.search.collections.query_builder import CollectionsQueryBuilder
        from app.search.collections.schemas import CollectionsSearchFilters, CollectionsSearchRequest

        query = CollectionsQueryBuilder().build(
            CollectionsSearchRequest(filters=CollectionsSearchFilters(exclude_object_status=["deaccessioned"]),
                                     include_facets=False),
            "org",
        )
        assert {"bool": {"must_not": [{"terms": {"object_status": ["deaccessioned"]}}]}} in query["query"]["bool"]["filter"]


class TestDiscover:
    def test_record_page_and_lists_hide_deaccessioned(self, auth_setup, client, db_session):
        auth, org, _ = auth_setup
        slug = f"da-portal-{uuid.uuid4().hex[:8]}"  # public responses are cached by slug
        _set_slug(db_session, org.organization_id, slug)
        kept = _obj(db_session, org.organization_id, "Kept vase")
        gone = _obj(db_session, org.organization_id, "Gone vase", status="deaccessioned")
        db_session.add(DiscoverConfig(organization_id=org.organization_id,
                                      featured_object_ids=[str(kept.object_id), str(gone.object_id)]))
        db_session.commit()

        assert client.get(f"/api/discover/{slug}/objects/{kept.object_id}").status_code == 200
        assert client.get(f"/api/discover/{slug}/objects/{gone.object_id}").status_code == 404
        assert client.get(f"/api/discover/{slug}/objects/{gone.object_number}").status_code == 404
        featured = client.get(f"/api/discover/{slug}/featured").get_json()["hits"]
        assert [h["object_id"] for h in featured] == [str(kept.object_id)]
        assert client.get(f"/api/discover/{slug}/info").get_json()["total_discoverable"] == 1

        # A stale index that still returns the deaccessioned object: the
        # export re-checks in SQL; the search request itself excludes it.
        service, calls = _capturing_search([kept, gone])
        a, b = _patch_search(service)
        with a, b:
            client.get(f"/api/discover/{slug}/search?q=vase")
            data = client.get(f"/api/discover/{slug}/search/export?format=json").get_json()
        assert calls[0].filters.exclude_object_status == ["deaccessioned"]
        assert [o["object_id"] for o in data["objects"]] == [str(kept.object_id)]

        sitemap = client.get(f"/api/content/{slug}/sitemap.xml")
        assert sitemap.status_code == 200
        assert gone.object_number not in sitemap.text and kept.object_number in sitemap.text

    def test_setting_off_shows_them_again(self, auth_setup, client, db_session):
        auth, org, _ = auth_setup
        slug = f"da-off-{uuid.uuid4().hex[:8]}"
        _set_slug(db_session, org.organization_id, slug)
        gone = _obj(db_session, org.organization_id, "Gone vase", status="deaccessioned")
        auth.put(SETTING.format(org.organization_id), json={"hide_deaccessioned": False})
        assert client.get(f"/api/discover/{slug}/objects/{gone.object_id}").status_code == 200
        service, calls = _capturing_search()
        a, b = _patch_search(service)
        with a, b:
            client.get(f"/api/discover/{slug}/search")
        assert not calls[0].filters.exclude_object_status

    def test_other_org_setting_independent(self, auth_setup, client, db_session):
        auth, org, _ = auth_setup
        other = Organization(name="Other", slug="da-other", is_demo=False, status="active")
        db_session.add(other)
        db_session.commit()
        gone = _obj(db_session, other.organization_id, "Other gone", status="deaccessioned")
        auth.put(SETTING.format(org.organization_id), json={"hide_deaccessioned": False})
        assert client.get(f"/api/discover/da-other/objects/{gone.object_id}").status_code == 404
