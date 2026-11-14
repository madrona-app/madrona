"""Scoped exports of collection objects (selection, work set, current search).

The staff object list exports exactly what the user is looking at: a set of
selected objects, a work set, or the current search. CSV/Excel go through
POST /collections/export; JSON-LD through POST /collections/export/jsonld.
"""
import csv
import io
import uuid

import pytest

from app.models import CollectionObject


def _obj(db_session, org_id, number, **kw):
    obj = CollectionObject(
        organization_id=org_id, object_number=number, object_name=f"Object {number}",
        object_type="painting", **kw,
    )
    db_session.add(obj)
    db_session.commit()
    return obj


def _export(client, org_id, body):
    return client.post(f"/api/organizations/{org_id}/collections/export", json=body)


def _csv_numbers(resp):
    text = resp.content.decode("utf-8-sig") if isinstance(resp.content, bytes) else resp.content
    rows = list(csv.DictReader(io.StringIO(text)))
    return sorted(r["Object Number"] for r in rows)


@pytest.fixture
def three_objects(auth_setup, db_session):
    client, org, user = auth_setup
    objs = [_obj(db_session, org.organization_id, n) for n in ("EXP.1", "EXP.2", "EXP.3")]
    return client, org, user, objs


class TestCsvExcelScope:
    def test_unscoped_exports_everything(self, three_objects):
        client, org, _, _ = three_objects
        resp = _export(client, org.organization_id, {"record_type": "collection_objects", "format": "csv"})
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/csv")
        assert _csv_numbers(resp) == ["EXP.1", "EXP.2", "EXP.3"]

    def test_object_ids_selection(self, three_objects):
        client, org, _, objs = three_objects
        resp = _export(client, org.organization_id, {
            "record_type": "collection_objects", "format": "csv",
            "object_ids": [str(objs[0].object_id), str(objs[2].object_id)],
        })
        assert resp.status_code == 200
        assert _csv_numbers(resp) == ["EXP.1", "EXP.3"]

    def test_excel_selection(self, three_objects):
        client, org, _, objs = three_objects
        resp = _export(client, org.organization_id, {
            "record_type": "collection_objects", "format": "excel",
            "object_ids": [str(objs[1].object_id)],
        })
        assert resp.status_code == 200
        assert "spreadsheetml" in resp.headers["content-type"]
        assert resp.headers["content-disposition"].endswith('.xlsx"')
        assert resp.content[:2] == b"PK"  # xlsx is a zip

    def test_empty_selection_exports_no_rows(self, three_objects):
        client, org, _, _ = three_objects
        resp = _export(client, org.organization_id, {
            "record_type": "collection_objects", "format": "csv", "object_ids": [],
        })
        assert resp.status_code == 200
        assert _csv_numbers(resp) == []

    def test_other_org_ids_are_not_exported(self, three_objects, db_session):
        from app.models import Organization

        client, org, _, objs = three_objects
        other = Organization(name="Other", slug=f"other-{uuid.uuid4().hex[:6]}", status="active", is_demo=False)
        db_session.add(other)
        db_session.commit()
        foreign = _obj(db_session, other.organization_id, "FOREIGN.1")
        resp = _export(client, org.organization_id, {
            "record_type": "collection_objects", "format": "csv",
            "object_ids": [str(objs[0].object_id), str(foreign.object_id)],
        })
        assert _csv_numbers(resp) == ["EXP.1"]

    def test_workspace_scope(self, three_objects, db_session):
        from app.models.workspaces import Workspace, WorkspaceItem

        client, org, user, objs = three_objects
        ws = Workspace(organization_id=org.organization_id, owner_user_id=user.user_id, name="Board review")
        db_session.add(ws)
        db_session.flush()
        db_session.add(WorkspaceItem(workspace_id=ws.workspace_id, object_id=objs[1].object_id))
        db_session.commit()
        resp = _export(client, org.organization_id, {
            "record_type": "collection_objects", "format": "csv", "workspace_id": str(ws.workspace_id),
        })
        assert resp.status_code == 200
        assert _csv_numbers(resp) == ["EXP.2"]

    def test_private_workspace_of_another_user_is_404(self, three_objects, db_session):
        from app.models import User
        from app.models.workspaces import Workspace

        client, org, _, _ = three_objects
        someone = User(email=f"other-{uuid.uuid4().hex[:6]}@example.com", password_hash="x", status="active")
        db_session.add(someone)
        db_session.flush()
        ws = Workspace(organization_id=org.organization_id, owner_user_id=someone.user_id,
                       name="Private", visibility="private")
        db_session.add(ws)
        db_session.commit()
        resp = _export(client, org.organization_id, {
            "record_type": "collection_objects", "format": "csv", "workspace_id": str(ws.workspace_id),
        })
        assert resp.status_code == 404

    def test_search_scope_uses_search_results(self, three_objects, monkeypatch):
        client, org, _, objs = three_objects
        captured = {}

        class _Svc:
            def matching_object_ids(self, request, organization_id, db_session=None, max_ids=0):
                captured["q"] = request.query.q if request.query else None
                captured["object_type"] = request.filters.object_type if request.filters else None
                captured["max_ids"] = max_ids
                return [str(objs[2].object_id)]

        monkeypatch.setattr(
            "app.search.collections.service.CollectionsSearchService.is_available",
            staticmethod(lambda: True),
        )
        monkeypatch.setattr(
            "app.search.collections.service.get_collections_search_service", lambda: _Svc(),
        )
        resp = _export(client, org.organization_id, {
            "record_type": "collection_objects", "format": "csv",
            "search": {"query": {"q": "braille"}, "filters": {"object_type": ["painting"]}},
        })
        assert resp.status_code == 200, resp.get_json()
        assert _csv_numbers(resp) == ["EXP.3"]
        assert captured == {"q": "braille", "object_type": ["painting"], "max_ids": 10_000}

    def test_search_scope_without_search_service_is_503(self, three_objects, monkeypatch):
        client, org, _, _ = three_objects
        monkeypatch.setattr(
            "app.search.collections.service.CollectionsSearchService.is_available",
            staticmethod(lambda: False),
        )
        resp = _export(client, org.organization_id, {
            "record_type": "collection_objects", "format": "csv", "search": {"query": {"q": "x"}},
        })
        assert resp.status_code == 503

    def test_two_scopes_rejected(self, three_objects):
        client, org, _, objs = three_objects
        resp = _export(client, org.organization_id, {
            "record_type": "collection_objects", "format": "csv",
            "object_ids": [str(objs[0].object_id)], "search": {"query": {"q": "x"}},
        })
        assert resp.status_code == 400

    def test_scope_only_for_objects(self, three_objects):
        client, org, _, objs = three_objects
        resp = _export(client, org.organization_id, {
            "record_type": "loans_in", "format": "csv", "object_ids": [str(objs[0].object_id)],
        })
        assert resp.status_code == 400

    def test_non_member_refused(self, three_objects, viewer_auth_setup):
        _, org, _, _ = three_objects
        viewer_client, _, _ = viewer_auth_setup
        resp = _export(viewer_client, org.organization_id, {"record_type": "collection_objects"})
        assert resp.status_code == 403

    def test_viewer_can_export_own_org(self, viewer_auth_setup, db_session):
        client, org, _ = viewer_auth_setup
        o = _obj(db_session, org.organization_id, "VIEW.1")
        resp = _export(client, org.organization_id, {
            "record_type": "collection_objects", "format": "csv", "object_ids": [str(o.object_id)],
        })
        assert resp.status_code == 200
        assert _csv_numbers(resp) == ["VIEW.1"]


class TestJsonLdScopedExport:
    def test_post_selection(self, three_objects):
        client, org, _, objs = three_objects
        resp = client.post(
            f"/api/organizations/{org.organization_id}/collections/export/jsonld",
            json={"object_ids": [str(objs[0].object_id), str(objs[1].object_id)]},
        )
        assert resp.status_code == 200, resp.get_json()
        assert resp.headers["content-type"].startswith("application/ld+json")
        body = resp.get_json()
        assert body["@type"] == "Collection"
        assert body["numberOfItems"] == 2
        assert body["totalItems"] == 2
        assert "view" not in body

    def test_post_paging(self, three_objects):
        client, org, _, objs = three_objects
        ids = [str(o.object_id) for o in objs]
        resp = client.post(
            f"/api/organizations/{org.organization_id}/collections/export/jsonld",
            json={"object_ids": ids, "limit": 2, "offset": 2},
        )
        body = resp.get_json()
        assert body["numberOfItems"] == 1
        assert body["totalItems"] == 3

    def test_get_bulk_unchanged(self, three_objects):
        client, org, _, _ = three_objects
        resp = client.get(f"/api/organizations/{org.organization_id}/collections/export/jsonld?limit=2")
        body = resp.get_json()
        assert body["numberOfItems"] == 2
        assert "next" in body["view"]

    def test_post_non_member_refused(self, three_objects, viewer_auth_setup):
        _, org, _, objs = three_objects
        viewer_client, _, _ = viewer_auth_setup
        resp = viewer_client.post(
            f"/api/organizations/{org.organization_id}/collections/export/jsonld",
            json={"object_ids": [str(objs[0].object_id)]},
        )
        assert resp.status_code == 403


class TestMatchingObjectIds:
    def test_builds_id_only_query(self, monkeypatch):
        from app.search.collections.schemas import CollectionsSearchRequest
        from app.search.collections.service import CollectionsSearchService

        captured = {}

        class _Index:
            def search(self, query, org):
                captured["query"] = query
                return {"hits": {"hits": [
                    {"_source": {"object_id": "a"}}, {"_source": {}}, {"_source": {"object_id": "b"}},
                ]}}

        class _Builder:
            def build(self, request, org, db_session=None):
                return {"query": {"match_all": {}}, "from": 40, "size": 20,
                        "aggs": {"x": {}}, "highlight": {"fields": {}}}

        svc = CollectionsSearchService.__new__(CollectionsSearchService)
        svc.index_manager = _Index()
        svc.query_builder = _Builder()
        ids = svc.matching_object_ids(CollectionsSearchRequest(), uuid.uuid4(), max_ids=500)
        assert ids == ["a", "b"]
        q = captured["query"]
        assert q["from"] == 0 and q["size"] == 500
        assert "aggs" not in q and "highlight" not in q
        assert q["_source"] == ["object_id"]
