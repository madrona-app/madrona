"""Audit coverage across record types.

Every tracked record type can be read back through the history API (with
its area's view permission), every child-row type is attached to a tracked
parent, and the workspaces whose history panels used to get 422 (shipment,
event, place/subject/style-period authorities) now record and return
events.
"""
import json
import uuid
from datetime import date

import pytest

from app import context as ctx
from app.fastapi_app.routers.collections_discover import ENTITY_TYPE_PERMISSIONS
from app.models import (
    CollectionObject,
    Deaccession,
    DeaccessionVote,
    Department,
    EntityAuditEvent,
    Page,
    Redirect,
)
from app.services import entity_audit as ea


def _post(c, url, body):
    return c.post(url, data=json.dumps(body), content_type="application/json")


def _put(c, url, body):
    return c.put(url, data=json.dumps(body), content_type="application/json")


def _patch(c, url, body):
    return c.patch(url, data=json.dumps(body), content_type="application/json")


@pytest.fixture()
def history_reader(auth_setup, db_session):
    """The test admin, granted every area's view permission (history checks it)."""
    from app.models import Role
    from tests.conftest import _create_permission, _create_role_permission

    client, org, user = auth_setup
    role = db_session.query(Role).filter(Role.role_key == "admin").first()
    have = {rp.permission.permission_key for rp in role.role_permissions} if hasattr(role, "role_permissions") else set()
    for key in {p.value for p in ENTITY_TYPE_PERMISSIONS.values()} - have:
        try:
            _create_role_permission(db_session, role, _create_permission(db_session, key))
        except Exception:
            db_session.rollback()
    db_session.commit()
    return client, org, user


def _history(client, org, entity_type, entity_id):
    resp = client.get(f"/api/organizations/{org.organization_id}/entity-history/{entity_type}/{entity_id}")
    assert resp.status_code == 200, (entity_type, resp.status_code, resp.get_json())
    return resp.get_json()["items"]


def _diffs(event):
    return {d["field_name"]: (d["old_value"], d["new_value"]) for d in event["field_diffs"]}


# ---------------------------------------------------------------------------
# Configuration is consistent
# ---------------------------------------------------------------------------


def test_every_tracked_type_is_readable_through_the_history_api():
    tracked = {c["entity_type"] for c in ea.TRACKED_ENTITIES.values()}
    assert tracked - set(ENTITY_TYPE_PERMISSIONS) == set()


def test_every_child_row_type_has_a_tracked_parent():
    tracked_models = set(ea.TRACKED_ENTITIES)
    tracked_types = {c["entity_type"] for c in ea.TRACKED_ENTITIES.values()}
    for name, cfg in ea.TRACKED_LINKS.items():
        assert cfg["parent_model"] in tracked_models, name
        assert cfg["parent_type"] in tracked_types, name


def test_history_api_answers_for_every_tracked_type(history_reader):
    client, org, _ = history_reader
    for config in ea.TRACKED_ENTITIES.values():
        assert _history(client, org, config["entity_type"], uuid.uuid4()) == []


# ---------------------------------------------------------------------------
# Workspaces whose history panels used to get 422
# ---------------------------------------------------------------------------


def test_shipment_records_fields_and_items(history_reader, db_session):
    client, org, user = history_reader
    obj = CollectionObject(organization_id=org.organization_id, object_number="SH.1")
    db_session.add(obj)
    db_session.commit()
    base = f"/api/organizations/{org.organization_id}/collections/shipments"
    resp = _post(client, base, {"shipment_type": "outbound", "purpose": "loan"})
    assert resp.status_code == 201, resp.get_json()
    sid = resp.get_json()["shipment_id"]
    assert _patch(client, f"{base}/{sid}", {"remarks": "Keep upright"}).status_code == 200
    resp = _post(client, f"{base}/{sid}/items", {"object_id": str(obj.object_id)})
    assert resp.status_code == 201, resp.get_json()

    items = _history(client, org, "shipment", sid)
    kinds = [e["change_type"] for e in items]
    assert "created" in kinds and "updated" in kinds
    item_added = [e for e in items if e["child_entity_type"] == "shipment_item"]
    assert len(item_added) == 1 and item_added[0]["child_display_key"] == "SH.1"
    assert all(e["changed_by_email"] == user.email for e in items)


def test_event_records_fields_and_objects(history_reader, db_session):
    client, org, user = history_reader
    obj = CollectionObject(organization_id=org.organization_id, object_number="EV.1")
    db_session.add(obj)
    db_session.commit()
    base = f"/api/organizations/{org.organization_id}/collections/events"
    resp = _post(client, base, {"title": "Tactile tour", "event_type": "program"})
    assert resp.status_code == 201, resp.get_json()
    eid = resp.get_json()["event_id"]
    assert _patch(client, f"{base}/{eid}", {"title": "Tactile tour for members"}).status_code == 200
    resp = _post(client, f"{base}/{eid}/objects", {"object_id": str(obj.object_id), "planned_use": "handle"})
    assert resp.status_code == 201, resp.get_json()

    items = _history(client, org, "event", eid)
    title = next(e for e in items if e["change_type"] == "updated" and "title" in e["changed_fields"])
    assert _diffs(title)["title"] == ("Tactile tour", "Tactile tour for members")
    linked = [e for e in items if e["child_entity_type"] == "event_object"]
    assert [e["child_display_key"] for e in linked] == ["EV.1"]


@pytest.mark.parametrize("path,entity_type,id_key,name_key,create,update", [
    ("place-authorities", "place_authority", "place_authority_id", "preferred_name",
     {"preferred_name": "Baltimore", "place_type": "city"}, {"preferred_name": "Baltimore, Maryland"}),
    ("subject-authorities", "subject_authority", "authority_id", "preferred_term",
     {"preferred_term": "Braille"}, {"preferred_term": "Braille (writing system)"}),
    ("style-period-authorities", "style_period_authority", "authority_id", "preferred_term",
     {"preferred_term": "Art Deco"}, {"preferred_term": "Art Deco (style)"}),
])
def test_authority_history(history_reader, path, entity_type, id_key, name_key, create, update):
    client, org, user = history_reader
    base = f"/api/organizations/{org.organization_id}/collections/{path}"
    resp = _post(client, base, create)
    assert resp.status_code == 201, resp.get_json()
    aid = resp.get_json()[id_key]
    resp = _put(client, f"{base}/{aid}", update)
    assert resp.status_code == 200, resp.get_json()

    items = _history(client, org, entity_type, aid)
    assert [e["change_type"] for e in items].count("created") == 1
    changed = next(e for e in items if e["change_type"] == "updated")
    assert _diffs(changed)[name_key] == (create[name_key], update[name_key])
    assert changed["changed_by_email"] == user.email


# ---------------------------------------------------------------------------
# A few of the other newly tracked types, through the ORM
# ---------------------------------------------------------------------------


@pytest.fixture()
def acting_user(auth_setup):
    _, org, user = auth_setup
    token = ctx.request_user_id.set(str(user.user_id))
    try:
        yield org, user
    finally:
        ctx.request_user_id.reset(token)


def _events(db, org, entity_type, entity_id, change_type=None):
    db.expire_all()
    q = db.query(EntityAuditEvent).filter(
        EntityAuditEvent.organization_id == org.organization_id,
        EntityAuditEvent.entity_type == entity_type,
        EntityAuditEvent.entity_id == entity_id,
    )
    if change_type:
        q = q.filter(EntityAuditEvent.change_type == change_type)
    return q.all()


def test_settings_and_portal_records_are_tracked(acting_user, db_session):
    org, user = acting_user
    dept = Department(organization_id=org.organization_id, name="Archives", code="ARC", path="ARC")
    page = Page(organization_id=org.organization_id, slug="visit", title="Visit", page_type="page", status="draft")
    redirect = Redirect(organization_id=org.organization_id, source_path="/old", target_path="/visit")
    db_session.add_all([dept, page, redirect])
    db_session.commit()
    page.title = "Plan your visit"
    redirect.target_path = "/plan-your-visit"
    db_session.commit()

    assert len(_events(db_session, org, "department", dept.department_id, "created")) == 1
    upd = _events(db_session, org, "page", page.page_id, "updated")
    assert len(upd) == 1 and {d.field_name: (d.old_value, d.new_value) for d in upd[0].field_diffs}["title"] == (
        "Visit", "Plan your visit")
    assert upd[0].changed_by == user.user_id
    assert len(_events(db_session, org, "redirect", redirect.redirect_id, "updated")) == 1


def test_deaccession_votes_are_child_rows(acting_user, db_session):
    org, user = acting_user
    obj = CollectionObject(organization_id=org.organization_id, object_number="DA.OBJ")
    db_session.add(obj)
    db_session.flush()
    d = Deaccession(organization_id=org.organization_id, deaccession_number="DA-1", object_id=obj.object_id, reason="duplicate")
    db_session.add(d)
    db_session.flush()
    vote = DeaccessionVote(organization_id=org.organization_id, deaccession_id=d.deaccession_id,
                           voter_name="Board chair", vote="approve", vote_date=date.today())
    db_session.add(vote)
    db_session.commit()
    db_session.delete(vote)
    db_session.commit()
    kinds = sorted(e.change_type for e in _events(db_session, org, "deaccession", d.deaccession_id)
                   if e.child_entity_type == "deaccession_vote")
    assert kinds == ["link_added", "link_removed"]
