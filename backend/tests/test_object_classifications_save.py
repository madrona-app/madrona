"""Classifications edited on the object record are saved.

The object form sends classifications as [{term, value_key?, value_id?}];
before this they were silently dropped by the object update.
"""
import json
from unittest.mock import patch

from app.models import LookupCategory, LookupValue

_INDEX = "app.fastapi_app.routers.collections_objects._index_collection_object"


def _setup(db_session, org_id):
    cat = db_session.query(LookupCategory).filter(LookupCategory.category_key == "classification").first()
    if cat is None:
        cat = LookupCategory(category_key="classification", display_name="Classification")
        db_session.add(cat)
        db_session.flush()
    db_session.add(LookupValue(category_id=cat.category_id, organization_id=None, value_key="textiles", label="Textiles"))
    db_session.commit()
    return cat


def test_classifications_round_trip(auth_setup, db_session):
    client, org, _ = auth_setup
    cat = _setup(db_session, org.organization_id)
    base = f"/api/organizations/{org.organization_id}/collections/objects"
    with patch(_INDEX):
        oid = client.post(base, data=json.dumps({"object_number": "CL.1", "object_name": "Banner"}),
                          content_type="application/json").get_json()["object_id"]
        resp = client.put(f"{base}/{oid}", data=json.dumps({"classifications": [
            {"term": "textiles"}, {"term": "Protest ephemera"}, {"term": "Textiles"}, {"term": ""},
        ]}), content_type="application/json")
    assert resp.status_code == 200, resp.get_json()
    terms = [c["term"] for c in client.get(f"{base}/{oid}").get_json()["classifications"]]
    assert terms == ["Textiles", "Protest ephemera"]
    local = db_session.query(LookupValue).filter(LookupValue.category_id == cat.category_id,
                                                 LookupValue.organization_id == org.organization_id).all()
    assert [v.label for v in local] == ["Protest ephemera"]

    with patch(_INDEX):
        resp = client.put(f"{base}/{oid}", data=json.dumps({"classifications": []}), content_type="application/json")
    assert resp.status_code == 200
    assert client.get(f"{base}/{oid}").get_json()["classifications"] == []
