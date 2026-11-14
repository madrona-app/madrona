"""Exhibition and crate history.

Their workspace history panels used to get 422 because the history endpoint
did not accept the entity types and nothing was recorded. Exhibitions and
crates are now tracked records; an exhibition's objects and venues are
child rows on the exhibition's history.
"""
import json
import uuid

from app.models import CollectionObject, Location


def _post(c, url, body):
    return c.post(url, data=json.dumps(body), content_type="application/json")


def _patch(c, url, body):
    return c.patch(url, data=json.dumps(body), content_type="application/json")


def _history(client, org, entity_type, entity_id):
    resp = client.get(f"/api/organizations/{org.organization_id}/entity-history/{entity_type}/{entity_id}")
    assert resp.status_code == 200, resp.get_json()
    return resp.get_json()["items"]


def _diffs(event):
    return {d["field_name"]: (d["old_value"], d["new_value"]) for d in event["field_diffs"]}


def test_exhibition_history_records_fields_and_objects(auth_setup, db_session):
    client, org, user = auth_setup
    base = f"/api/organizations/{org.organization_id}/collections/exhibitions"
    obj = CollectionObject(organization_id=org.organization_id, object_number="EX.1")
    db_session.add(obj)
    db_session.commit()

    resp = _post(client, base, {"title": "Touch and Tell"})
    assert resp.status_code == 201, resp.get_json()
    ex_id = resp.get_json()["exhibition_id"]
    assert _patch(client, f"{base}/{ex_id}", {"title": "Touch and Tell: Tactile Art"}).status_code == 200

    resp = _post(client, f"{base}/{ex_id}/objects", {"object_id": str(obj.object_id), "section": "Gallery 1"})
    assert resp.status_code == 201, resp.get_json()
    eo_id = resp.get_json()["exhibition_object_id"]
    assert _patch(client, f"{base}/{ex_id}/objects/{eo_id}", {"object_status": "on_display"}).status_code == 200
    assert client.delete(f"{base}/{ex_id}/objects/{eo_id}").status_code == 200

    items = _history(client, org, "exhibition", ex_id)
    by_kind = {}
    for e in items:
        by_kind.setdefault(e["change_type"], []).append(e)
        assert e["changed_by_email"] == user.email
    assert len(by_kind["created"]) == 1
    title_change = next(e for e in by_kind["updated"] if "title" in e["changed_fields"])
    assert _diffs(title_change)["title"] == ("Touch and Tell", "Touch and Tell: Tactile Art")

    added = by_kind["link_added"]
    assert [(e["child_entity_type"], e["child_display_key"]) for e in added] == [("exhibition_object", "EX.1")]
    assert _diffs(added[0])["section"] == (None, "Gallery 1")
    updated = by_kind["link_updated"]
    assert _diffs(updated[0])["object_status"] == ("planned", "on_display")
    assert updated[0]["child_entity_id"] == eo_id
    removed = by_kind["link_removed"]
    assert removed[0]["summary"] == "Removed object: EX.1"


def test_crate_history_records_location_by_code(auth_setup, db_session):
    client, org, user = auth_setup
    a = Location(organization_id=org.organization_id, name="Dock", code="DOCK", path="DOCK", location_type="room")
    b = Location(organization_id=org.organization_id, name="Store", code="ST-2", path="ST-2", location_type="room")
    db_session.add_all([a, b])
    db_session.commit()
    base = f"/api/organizations/{org.organization_id}/collections/crates"

    resp = _post(client, base, {"crate_number": "CR-7", "location_id": str(a.location_id), "height_cm": 120})
    assert resp.status_code == 201, resp.get_json()
    crate_id = resp.get_json()["crate_id"]
    resp = _patch(client, f"{base}/{crate_id}", {"location_id": str(b.location_id), "condition": "fair"})
    assert resp.status_code == 200, resp.get_json()

    items = _history(client, org, "crate", crate_id)
    created = [e for e in items if e["change_type"] == "created"]
    assert len(created) == 1
    assert _diffs(created[0])["location_id"] == (None, "DOCK")
    updated = [e for e in items if e["change_type"] == "updated"]
    assert len(updated) == 1
    assert _diffs(updated[0])["location_id"] == ("DOCK", "ST-2")
    assert _diffs(updated[0])["condition"] == (None, "fair")
    assert updated[0]["changed_by_email"] == user.email


def test_history_rejects_unknown_types_still(auth_setup):
    client, org, _ = auth_setup
    resp = client.get(f"/api/organizations/{org.organization_id}/entity-history/not_a_type/{uuid.uuid4()}")
    assert resp.status_code == 422
