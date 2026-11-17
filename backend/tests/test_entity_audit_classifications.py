"""Classification links are recorded on the object's history.

Adding or removing a classification, from the object form or from the
dedicated link/unlink endpoints, is a link_added / link_removed event on the
object with child_entity_type "object_classification" and the term's label
(not its id). Object saves reconcile the links in place, so saving the same
classifications again records nothing.
"""
import json
import uuid
from unittest.mock import patch

import pytest

from app.models import EntityAuditEvent, LookupCategory, LookupValue, ObjectClassification

_INDEX = "app.fastapi_app.routers.collections_objects._index_collection_object"


def _base(org):
    return f"/api/organizations/{org.organization_id}/collections/objects"


@pytest.fixture()
def terms(db_session):
    cat = db_session.query(LookupCategory).filter(LookupCategory.category_key == "classification").first()
    if cat is None:
        cat = LookupCategory(category_key="classification", display_name="Classification")
        db_session.add(cat)
        db_session.flush()
    values = {
        label: LookupValue(category_id=cat.category_id, organization_id=None, value_key=label.lower(), label=label)
        for label in ("Textiles", "Tactile graphics", "Ephemera")
    }
    db_session.add_all(values.values())
    db_session.commit()
    return values


def _events(db, org, oid, change_type=None):
    db.expire_all()
    q = db.query(EntityAuditEvent).filter(
        EntityAuditEvent.organization_id == org.organization_id,
        EntityAuditEvent.entity_type == "collection_object",
        EntityAuditEvent.entity_id == oid,
        EntityAuditEvent.child_entity_type == "object_classification",
    )
    if change_type:
        q = q.filter(EntityAuditEvent.change_type == change_type)
    return q.order_by(EntityAuditEvent.changed_at).all()


def _put(client, org, oid, payload):
    with patch(_INDEX):
        resp = client.put(f"{_base(org)}/{oid}", data=json.dumps(payload), content_type="application/json")
    assert resp.status_code == 200, resp.get_json()


def _create(client, org):
    with patch(_INDEX):
        resp = client.post(_base(org), data=json.dumps({"object_number": "CLA.1", "object_name": "Map"}),
                           content_type="application/json")
    assert resp.status_code == 201, resp.get_json()
    return uuid.UUID(resp.get_json()["object_id"])


def test_object_save_records_added_and_removed_terms(auth_setup, db_session, terms):
    client, org, user = auth_setup
    oid = _create(client, org)

    _put(client, org, oid, {"classifications": [{"term": "Textiles"}, {"term": "Tactile graphics"}]})
    added = _events(db_session, org, oid, "link_added")
    assert sorted(e.child_display_key for e in added) == ["Tactile graphics", "Textiles"]
    textiles = next(e for e in added if e.child_display_key == "Textiles")
    assert textiles.summary == "Added classification: Textiles"
    assert {d.field_name: (d.old_value, d.new_value) for d in textiles.field_diffs}["classification"] == (None, "Textiles")
    assert textiles.changed_by == user.user_id
    link_ids = {l.value_id: l.link_id for l in db_session.query(ObjectClassification).filter_by(object_id=oid)}

    # Saving the same terms (even reordered) records nothing and keeps the rows.
    _put(client, org, oid, {"classifications": [{"term": "Tactile graphics"}, {"term": "Textiles"}]})
    assert len(_events(db_session, org, oid)) == 2
    assert {l.value_id: l.link_id for l in db_session.query(ObjectClassification).filter_by(object_id=oid)} == link_ids

    # Swap one term for another.
    _put(client, org, oid, {"classifications": [{"term": "Textiles"}, {"term": "Ephemera"}]})
    removed = _events(db_session, org, oid, "link_removed")
    assert [e.child_display_key for e in removed] == ["Tactile graphics"]
    assert removed[0].summary == "Removed classification: Tactile graphics"
    assert {d.field_name: (d.old_value, d.new_value) for d in removed[0].field_diffs}["classification"] == ("Tactile graphics", None)
    assert removed[0].changed_by == user.user_id
    assert [e.child_display_key for e in _events(db_session, org, oid, "link_added")][-1] == "Ephemera"
    # Textiles was never touched.
    assert [e.child_display_key for e in _events(db_session, org, oid)].count("Textiles") == 1

    # The history API returns the label, never a bare id.
    resp = client.get(f"/api/organizations/{org.organization_id}/entity-history/collection_object/{oid}")
    assert resp.status_code == 200
    items = [e for e in resp.get_json()["items"] if e["child_entity_type"] == "object_classification"]
    assert {(e["change_type"], e["child_display_key"]) for e in items} == {
        ("link_added", "Textiles"), ("link_added", "Tactile graphics"),
        ("link_removed", "Tactile graphics"), ("link_added", "Ephemera"),
    }
    for e in items:
        for d in e["field_diffs"]:
            for v in (d["old_value"], d["new_value"]):
                if isinstance(v, str):
                    with pytest.raises(ValueError):
                        uuid.UUID(v)


def test_link_and_unlink_endpoints_are_recorded(auth_setup, db_session, terms):
    client, org, user = auth_setup
    oid = _create(client, org)
    url = f"{_base(org)}/{oid}/classifications"

    resp = client.post(url, data=json.dumps({"value_id": str(terms["Ephemera"].value_id)}), content_type="application/json")
    assert resp.status_code == 201, resp.get_json()
    link_id = resp.get_json()["link_id"]
    added = _events(db_session, org, oid, "link_added")
    assert [(e.child_display_key, e.changed_by) for e in added] == [("Ephemera", user.user_id)]
    assert str(added[0].child_entity_id) == link_id

    assert client.delete(f"{url}/{link_id}").status_code == 200
    removed = _events(db_session, org, oid, "link_removed")
    assert [(e.child_display_key, e.changed_by) for e in removed] == [("Ephemera", user.user_id)]
    assert str(removed[0].child_entity_id) == link_id


def test_new_term_created_on_save_is_recorded_by_label(auth_setup, db_session, terms):
    client, org, _ = auth_setup
    oid = _create(client, org)
    _put(client, org, oid, {"classifications": [{"term": "Braille music"}]})
    assert [e.child_display_key for e in _events(db_session, org, oid, "link_added")] == ["Braille music"]
