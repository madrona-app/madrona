"""
Public export of groups of object records (search results, exhibitions).

Invariants under test:
  * only discoverable, non-deleted objects of the URL's org are emitted,
    even when the search index still returns something that is no longer
    public;
  * the emitted fields are exactly the public object-detail fields (minus
    media) — never a private column such as insurance value;
  * the export is capped at EXPORT_MAX_OBJECTS and says so;
  * responses are attachments, and exports have their own rate limit.
"""

import csv
import io
import uuid
from unittest.mock import MagicMock, patch

from app.fastapi_app.routers import discover_public
from app.models import CollectionObject, Exhibition, ExhibitionObject, Organization, ObjectTitle

PRIVATE_SENTINEL = "PRIVATE-SENTINEL-7f3a"

# Keys of the public object detail response, minus the media block.
EXPECTED_FIELDS = {
    "object_id", "object_number", "canonical_url", "title", "titles",
    "brief_description", "full_description", "object_type", "classification",
    "classifications", "creators", "creation_date_display",
    "creation_date_earliest", "creation_date_latest", "creation_place",
    "materials", "techniques", "measurements", "inscriptions", "style_period",
    "provenance", "credit_line", "external_links",
}


def _org(db, slug):
    org = Organization(name=f"{slug} museum", slug=slug, is_demo=False, status="active")
    db.add(org)
    db.flush()
    return org


def _obj(db, org, title, **kw):
    defaults = dict(
        organization_id=org.organization_id,
        object_number=f"EXP-{uuid.uuid4().hex[:6].upper()}",
        is_discoverable=True,
        brief_description="Public description",
        object_type="painting",
        creators=[{"value": "Public Artist"}],
        # Private fields that must never appear in an export.
        insurance_note=PRIVATE_SENTINEL,
        acquisition_note=PRIVATE_SENTINEL,
        condition_note=PRIVATE_SENTINEL,
        current_location_note=PRIVATE_SENTINEL,
    )
    defaults.update(kw)
    obj = CollectionObject(**defaults)
    db.add(obj)
    db.flush()
    db.add(ObjectTitle(organization_id=org.organization_id, object_id=obj.object_id, title=title, is_preferred=True))
    db.flush()
    return obj


def _fake_search(objects, total=None):
    """A search service whose results page through ``objects``."""
    def search(req, org_id, db_session=None):
        page = objects[req.offset:req.offset + req.limit]
        resp = MagicMock()
        resp.hits = [MagicMock(object_id=str(o.object_id)) for o in page]
        resp.total = len(objects) if total is None else total
        resp.facets = None
        resp.next_offset = None
        return resp

    service = MagicMock()
    service.search.side_effect = search
    return service


def _patch_search(service):
    return (
        patch("app.search.collections.service.CollectionsSearchService.is_available", return_value=True),
        patch("app.search.collections.service.get_collections_search_service", return_value=service),
    )


class TestSearchExport:
    def test_csv_published_only_and_whitelisted(self, client, db_session):
        org = _org(db_session, "exp-csv")
        other = _org(db_session, "exp-other")
        public = _obj(db_session, org, "Public Painting", creation_date_display="1901")
        hidden = _obj(db_session, org, "Hidden Painting", is_discoverable=False)
        deleted = _obj(db_session, org, "Deleted Painting", is_deleted=True)
        foreign = _obj(db_session, other, "Other Org Painting")
        db_session.commit()

        # A stale index still returns the hidden, deleted and foreign objects.
        service = _fake_search([public, hidden, deleted, foreign])
        a, b = _patch_search(service)
        with a, b:
            resp = client.get("/api/discover/exp-csv/search/export?q=painting&format=csv")

        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/csv")
        disp = resp.headers["content-disposition"]
        assert disp.startswith("attachment;") and 'filename="exp-csv-search-results-' in disp and disp.endswith('.csv"')
        body = resp.content.decode("utf-8-sig")
        rows = list(csv.DictReader(io.StringIO(body)))
        assert [r["Title"] for r in rows] == ["Public Painting"]
        assert rows[0]["Date"] == "1901"
        assert rows[0]["Creators"] == "Public Artist"
        assert rows[0]["Record path"] == f"/c/exp-csv/objects/{public.object_number}"
        assert PRIVATE_SENTINEL not in body
        assert "Hidden Painting" not in body and "Deleted Painting" not in body and "Other Org" not in body
        assert resp.headers["X-Export-Count"] == "1"
        assert resp.headers["X-Export-Total"] == "1"
        assert resp.headers["X-Export-Truncated"] == "false"

    def test_json_fields_match_public_detail(self, client, db_session):
        org = _org(db_session, "exp-json")
        obj = _obj(db_session, org, "Json Painting")
        db_session.commit()

        a, b = _patch_search(_fake_search([obj]))
        with a, b:
            resp = client.get("/api/discover/exp-json/search/export?format=json&object_type=painting&sort=title_asc")
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("application/json")
        assert resp.headers["content-disposition"].endswith('.json"')
        data = resp.get_json()
        assert data["count"] == 1 and data["truncated"] is False
        assert data["cap"] == discover_public.EXPORT_MAX_OBJECTS
        assert data["source"]["query"] == {"object_type": "painting", "sort": "title_asc"}
        assert set(data["objects"][0]) == EXPECTED_FIELDS
        assert PRIVATE_SENTINEL not in resp.text

        # And the whitelist is exactly the detail endpoint's, minus media.
        detail = client.get(f"/api/discover/exp-json/objects/{obj.object_id}").get_json()
        assert set(detail) - {"media", "has_image"} == EXPECTED_FIELDS
        for key in EXPECTED_FIELDS:
            assert data["objects"][0][key] == detail[key], key

    def test_search_filters_are_forwarded(self, client, db_session):
        org = _org(db_session, "exp-filters")
        db_session.commit()
        service = _fake_search([])
        a, b = _patch_search(service)
        with a, b:
            client.get(
                "/api/discover/exp-filters/search/export?q=bowl&classification=Ceramic"
                "&classification=Glass&on_display=true&sort=date_desc"
            )
        req = service.search.call_args[0][0]
        assert req.query.q == "bowl"
        assert req.filters.classification == ["Ceramic", "Glass"]
        assert req.filters.on_display is True
        assert req.filters.is_discoverable is True
        assert req.sort.field == "creation_date"

    def test_cap_and_truncation(self, client, db_session, monkeypatch):
        monkeypatch.setattr(discover_public, "EXPORT_MAX_OBJECTS", 3)
        monkeypatch.setattr(discover_public, "_EXPORT_SEARCH_PAGE", 2)
        org = _org(db_session, "exp-cap")
        objs = [_obj(db_session, org, f"Item {i}") for i in range(5)]
        db_session.commit()

        service = _fake_search(objs)
        a, b = _patch_search(service)
        with a, b:
            resp = client.get("/api/discover/exp-cap/search/export?format=json")
        data = resp.get_json()
        assert [o["title"] for o in data["objects"]] == ["Item 0", "Item 1", "Item 2"]
        assert data["count"] == 3 and data["total_matches"] == 5
        assert data["truncated"] is True and data["cap"] == 3
        assert resp.headers["X-Export-Truncated"] == "true"
        # Paged 2 + 1, never asked the index for more than the cap.
        assert [c[0][0].limit for c in service.search.call_args_list] == [2, 1]

    def test_search_unavailable_gives_empty_file(self, client, db_session):
        _org(db_session, "exp-off")
        db_session.commit()
        with patch("app.search.collections.service.CollectionsSearchService.is_available", return_value=False):
            resp = client.get("/api/discover/exp-off/search/export")
        assert resp.status_code == 200
        rows = list(csv.reader(io.StringIO(resp.content.decode("utf-8-sig"))))
        assert rows[0][0] == "Object number" and len(rows) == 1

    def test_unknown_org_404_and_bad_format_422(self, client, db_session):
        assert client.get("/api/discover/no-such-org/search/export").status_code == 404
        _org(db_session, "exp-fmt")
        db_session.commit()
        assert client.get("/api/discover/exp-fmt/search/export?format=xlsx").status_code == 422

    def test_rate_limited(self, client, db_session):
        _org(db_session, "exp-rl")
        db_session.commit()
        with patch.object(discover_public._export_limiter, "allow", return_value=False):
            resp = client.get("/api/discover/exp-rl/search/export")
        assert resp.status_code == 429
        assert resp.headers["Retry-After"] == "60"

    def test_csv_formula_injection_neutralised(self, client, db_session):
        org = _org(db_session, "exp-inj")
        obj = _obj(db_session, org, "=HYPERLINK(\"http://evil\")")
        db_session.commit()
        a, b = _patch_search(_fake_search([obj]))
        with a, b:
            resp = client.get("/api/discover/exp-inj/search/export")
        rows = list(csv.DictReader(io.StringIO(resp.content.decode("utf-8-sig"))))
        assert rows[0]["Title"].startswith("'=")


class TestExhibitionExport:
    def _exhibition(self, db, org, slug="spring-show", is_public=True):
        exh = Exhibition(
            organization_id=org.organization_id, title="Spring Show", status="open",
            exhibition_type="temporary", is_public=is_public, public_url_slug=slug,
        )
        db.add(exh)
        db.flush()
        return exh

    def _link(self, db, org, exh, obj, order):
        db.add(ExhibitionObject(
            exhibition_id=exh.exhibition_id, organization_id=org.organization_id,
            object_id=obj.object_id, object_status="planned", display_order=order,
        ))
        db.flush()

    def test_exports_public_objects_in_display_order(self, client, db_session):
        org = _org(db_session, "exh-exp")
        exh = self._exhibition(db_session, org)
        second = _obj(db_session, org, "Second")
        first = _obj(db_session, org, "First")
        hidden = _obj(db_session, org, "Hidden Loan", is_discoverable=False)
        self._link(db_session, org, exh, second, 2)
        self._link(db_session, org, exh, first, 1)
        self._link(db_session, org, exh, hidden, 0)
        db_session.commit()

        resp = client.get("/api/discover/exh-exp/exhibitions/spring-show/export?format=json")
        assert resp.status_code == 200
        assert 'filename="exh-exp-spring-show-objects-' in resp.headers["content-disposition"]
        data = resp.get_json()
        assert [o["title"] for o in data["objects"]] == ["First", "Second"]
        assert data["total_matches"] == 2 and data["truncated"] is False
        assert data["source"]["exhibition"] == "Spring Show"
        assert "Hidden Loan" not in resp.text and PRIVATE_SENTINEL not in resp.text

        csv_resp = client.get("/api/discover/exh-exp/exhibitions/spring-show/export")
        rows = list(csv.DictReader(io.StringIO(csv_resp.content.decode("utf-8-sig"))))
        assert [r["Title"] for r in rows] == ["First", "Second"]

    def test_private_exhibition_404(self, client, db_session):
        org = _org(db_session, "exh-priv")
        self._exhibition(db_session, org, slug="secret", is_public=False)
        db_session.commit()
        assert client.get("/api/discover/exh-priv/exhibitions/secret/export").status_code == 404

    def test_cap(self, client, db_session, monkeypatch):
        monkeypatch.setattr(discover_public, "EXPORT_MAX_OBJECTS", 2)
        org = _org(db_session, "exh-cap")
        exh = self._exhibition(db_session, org)
        for i in range(4):
            self._link(db_session, org, exh, _obj(db_session, org, f"Obj {i}"), i)
        db_session.commit()
        data = client.get("/api/discover/exh-cap/exhibitions/spring-show/export?format=json").get_json()
        assert [o["title"] for o in data["objects"]] == ["Obj 0", "Obj 1"]
        assert data["total_matches"] == 4 and data["truncated"] is True

    def test_exhibition_page_hides_non_discoverable_objects(self, client, db_session):
        """The public exhibition page previously listed every linked object."""
        org = _org(db_session, "exh-page")
        exh = self._exhibition(db_session, org)
        self._link(db_session, org, exh, _obj(db_session, org, "Shown"), 0)
        self._link(db_session, org, exh, _obj(db_session, org, "Not Public", is_discoverable=False), 1)
        db_session.commit()
        data = client.get("/api/discover/exh-page/exhibitions/spring-show").get_json()
        assert [o["title"] for o in data["related_objects"]] == ["Shown"]


def test_detail_hides_soft_deleted_object(client, db_session):
    org = _org(db_session, "del-detail")
    obj = _obj(db_session, org, "Gone", is_deleted=True)
    db_session.commit()
    assert client.get(f"/api/discover/del-detail/objects/{obj.object_id}").status_code == 404
