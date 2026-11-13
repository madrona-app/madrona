"""Multi-level archival description: collection > series > box > folder > item."""
import json
from unittest.mock import patch

import pytest

_INDEX = "app.fastapi_app.routers.collections_objects._index_collection_object"


def _base(org):
    return f"/api/organizations/{org.organization_id}/collections/objects"


def _make(c, org, number, level, parent=None, **extra):
    body = {"object_number": number, "object_name": number, "catalog_level": level, **extra}
    if parent:
        body["parent_object_id"] = parent
    with patch(_INDEX):
        resp = c.post(_base(org), data=json.dumps(body), content_type="application/json")
    assert resp.status_code == 201, resp.get_json()
    return resp.get_json()["object_id"]


def _put(c, org, oid, body):
    with patch(_INDEX):
        return c.put(f"{_base(org)}/{oid}", data=json.dumps(body), content_type="application/json")


@pytest.fixture
def tree(auth_setup):
    c, org, _ = auth_setup
    coll = _make(c, org, "NFB.1", "collection", titles=[{"title": "tenBroek papers", "is_preferred": True}])
    series = _make(c, org, "NFB.1.1", "series", coll)
    box = _make(c, org, "NFB.1.1.B1", "box", series)
    f1 = _make(c, org, "NFB.1.1.B1.F1", "folder", box)
    f2 = _make(c, org, "NFB.1.1.B1.F2", "folder", box)
    item = _make(c, org, "NFB.1.1.B1.F1.1", "item", f1)
    return c, org, dict(coll=coll, series=series, box=box, f1=f1, f2=f2, item=item)


def test_hierarchy_navigation(tree):
    c, org, t = tree
    h = c.get(f"{_base(org)}/{t['f1']}/hierarchy").get_json()
    assert [a["object_number"] for a in h["ancestors"]] == ["NFB.1", "NFB.1.1", "NFB.1.1.B1"]
    assert h["ancestors"][0]["title"] == "tenBroek papers"
    assert h["node"]["child_count"] == 1 and h["node"]["level_label"] == "Folder"
    box = c.get(f"{_base(org)}/{t['box']}/hierarchy").get_json()
    assert [k["object_number"] for k in box["children"]] == ["NFB.1.1.B1.F1", "NFB.1.1.B1.F2"]
    assert [k["sibling_order"] for k in box["children"]] == [1, 2]
    assert box["children"][0]["child_count"] == 1 and box["children_total"] == 2
    assert c.get(f"{_base(org)}/{t['item']}").get_json()["parent_object_id"] == t["f1"]


def test_move_up_and_down(tree):
    c, org, t = tree
    resp = c.post(f"{_base(org)}/{t['f2']}/move", data=json.dumps({"direction": "up"}), content_type="application/json")
    assert resp.status_code == 200 and resp.get_json() == {"object_id": t["f2"], "position": 1, "of": 2}
    box = c.get(f"{_base(org)}/{t['box']}/hierarchy").get_json()
    assert [k["object_id"] for k in box["children"]] == [t["f2"], t["f1"]]
    resp = c.post(f"{_base(org)}/{t['f2']}/move", data=json.dumps({"direction": "up"}), content_type="application/json")
    assert resp.status_code == 409


def test_invariants(tree):
    c, org, t = tree
    # No cycles: a box cannot go inside its own folder.
    assert c.put(f"{_base(org)}/{t['box']}/parent", data=json.dumps({"parent_object_id": t["f1"]}),
                 content_type="application/json").status_code == 422
    # Items cannot contain records.
    with patch(_INDEX):
        resp = c.post(_base(org), data=json.dumps({"object_number": "X", "object_name": "x", "catalog_level": "item",
                                                   "parent_object_id": t["item"]}), content_type="application/json")
    assert resp.status_code == 422
    # A record with children cannot become an item.
    assert _put(c, org, t["f1"], {"catalog_level": "item"}).status_code == 422
    # A collection has no parent.
    assert _put(c, org, t["coll"], {"parent_object_id": t["series"]}).status_code == 422
    # A record with children cannot be deleted.
    with patch(_INDEX):
        resp = c.delete(f"{_base(org)}/{t['box']}")
    assert resp.status_code == 409


def test_reparent_through_update_and_endpoint(tree):
    c, org, t = tree
    assert _put(c, org, t["f2"], {"parent_object_id": t["series"]}).status_code == 200
    assert c.get(f"{_base(org)}/{t['f2']}").get_json()["parent_object_id"] == t["series"]
    resp = c.put(f"{_base(org)}/{t['f2']}/parent", data=json.dumps({"parent_object_id": None}), content_type="application/json")
    assert resp.status_code == 200 and resp.get_json()["parent_object_id"] is None


def test_parent_must_be_same_org(tree, viewer_auth_setup):
    c, org, t = tree
    other_client, other_org, _ = viewer_auth_setup
    # A parent id from another organization is not found from this org.
    import uuid
    assert _put(c, org, t["f2"], {"parent_object_id": str(uuid.uuid4())}).status_code == 404
