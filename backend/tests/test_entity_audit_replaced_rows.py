"""Rows that used to be replaced wholesale are reconciled in place.

Authority variant names, portal page blocks, post categories and menu
items, media tag assignments, a tag's allowed values, department
memberships, a person's and an entry item's media links and lookup sort
positions are recorded as child rows on their parent record. Each save now
edits only what changed, so an unchanged save records nothing and an edit
reads as one change, not a removal plus an addition.
"""
import json
import uuid

import pytest

from app import context as ctx
from app.models import (
    Constituent,
    Department,
    EntityAuditEvent,
    Media,
    MediaTagDefinition,
    ObjectEntry,
    ObjectEntryItem,
    Role,
)
from app.models.contacts import ConstituentMedia
from app.models.media import MediaTag, MediaTagValue
from app.models.procedures import ObjectEntryItemMedia
from app.services import entity_audit as ea
from tests.conftest import _create_permission, _create_role_permission


def _send(c, method, url, body):
    return getattr(c, method)(url, data=json.dumps(body), content_type="application/json")


def _child_events(db, org_id, entity_type, entity_id, child_type):
    db.expire_all()
    return (
        db.query(EntityAuditEvent)
        .filter(
            EntityAuditEvent.organization_id == org_id,
            EntityAuditEvent.entity_type == entity_type,
            EntityAuditEvent.entity_id == entity_id,
            EntityAuditEvent.child_entity_type == child_type,
        )
        .order_by(EntityAuditEvent.changed_at)
        .all()
    )


def _diffs(event):
    return {d.field_name: (d.old_value, d.new_value) for d in event.field_diffs}


@pytest.fixture()
def editor(auth_setup, db_session):
    """The test admin, with the edit permissions these saves need."""
    client, org, user = auth_setup
    role = db_session.query(Role).filter(Role.role_key == "admin").first()
    have = {rp.permission.permission_key for rp in role.role_permissions}
    for key in ("content.view", "content.edit", "lookups.view", "lookups.manage", "departments.view",
                "departments.manage_members", "media.admin", "place_authorities.view", "place_authorities.edit",
                "place_authorities.create"):
        if key not in have:
            _create_role_permission(db_session, role, _create_permission(db_session, key))
    db_session.commit()
    return client, org, user


@pytest.fixture()
def acting_user(auth_setup):
    _, org, user = auth_setup
    token = ctx.request_user_id.set(str(user.user_id))
    try:
        yield org, user
    finally:
        ctx.request_user_id.reset(token)


def _media(db, org_id, name="photo.jpg"):
    m = Media(organization_id=org_id, s3_key=f"k/{uuid.uuid4()}", filename=name, file_size=10,
              mime_type="image/jpeg", media_type="image")
    db.add(m)
    db.flush()
    return m


# ---------------------------------------------------------------------------
# Authority variant names (polymorphic: attributed to the authority)
# ---------------------------------------------------------------------------


def test_variant_names_are_reconciled_on_the_authority(editor, db_session):
    client, org, _ = editor
    base = f"/api/organizations/{org.organization_id}/collections/place-authorities"
    resp = _send(client, "post", base, {"preferred_name": "Toronto", "place_type": "city",
                                        "variant_names": [{"name": "Tkaronto"}, {"name": "York"}]})
    assert resp.status_code == 201, resp.get_json()
    pid = uuid.UUID(resp.get_json()["place_authority_id"])
    added = _child_events(db_session, org.organization_id, "place_authority", pid, "variant_term")
    assert sorted(e.child_display_key for e in added) == ["Tkaronto", "York"]

    # Same names again: nothing recorded.
    same = {"variant_names": [{"name": "Tkaronto"}, {"name": "York"}]}
    assert _send(client, "put", f"{base}/{pid}", same).status_code == 200
    assert len(_child_events(db_session, org.organization_id, "place_authority", pid, "variant_term")) == 2

    # One name changes language, one is dropped, one is new.
    resp = _send(client, "put", f"{base}/{pid}", {"variant_names": [
        {"name": "Tkaronto", "language": "moh"}, {"name": "Muddy York"}]})
    assert resp.status_code == 200, resp.get_json()
    events = _child_events(db_session, org.organization_id, "place_authority", pid, "variant_term")[2:]
    kinds = sorted((e.change_type, e.child_display_key) for e in events)
    assert ("link_updated", "Tkaronto") in kinds
    assert len(events) == 2  # Tkaronto updated; York edited to Muddy York in place
    upd = {e.child_display_key: _diffs(e) for e in events}
    assert upd["Tkaronto"] == {"language": (None, "moh")}
    assert upd["Muddy York"] == {"term": ("York", "Muddy York")}


def test_variant_names_for_untracked_types_are_ignored(acting_user, db_session):
    from app.models import VariantTerm

    org, _ = acting_user
    vt = VariantTerm(organization_id=org.organization_id, entity_type="not_a_record", entity_id=uuid.uuid4(), term="x")
    db_session.add(vt)
    db_session.commit()
    assert db_session.query(EntityAuditEvent).filter(EntityAuditEvent.child_entity_type == "variant_term").count() == 0


# ---------------------------------------------------------------------------
# Portal pages, posts and menus
# ---------------------------------------------------------------------------


def test_page_blocks_are_reconciled(editor, db_session):
    client, org, _ = editor
    base = f"/api/organizations/{org.organization_id}/content/pages"
    resp = _send(client, "post", base, {"title": "Visit"})
    assert resp.status_code == 201, resp.get_json()
    page_id = resp.get_json()["data"]["page_id"]
    blocks = [
        {"block_type": "rich_text", "content": {"html": "<p>Open daily</p>"}},
        {"block_type": "divider", "content": {}},
    ]
    resp = _send(client, "put", f"{base}/{page_id}/blocks", {"blocks": blocks})
    assert resp.status_code == 200, resp.get_json()
    saved = resp.get_json()["data"]
    pid = uuid.UUID(page_id)
    assert [e.change_type for e in _child_events(db_session, org.organization_id, "page", pid, "content_block")] == [
        "link_added", "link_added"]

    # Unchanged save (the editor sends back the ids it was given): nothing recorded.
    resp = _send(client, "put", f"{base}/{page_id}/blocks", {"blocks": saved})
    assert resp.status_code == 200
    assert len(_child_events(db_session, org.organization_id, "page", pid, "content_block")) == 2

    # Edit the text, reorder, drop the divider.
    edited = [{**saved[0], "content": {"html": "<p>Open daily, 10 to 5</p>"}}]
    resp = _send(client, "put", f"{base}/{page_id}/blocks", {"blocks": edited})
    assert resp.status_code == 200
    events = _child_events(db_session, org.organization_id, "page", pid, "content_block")[2:]
    assert sorted(e.change_type for e in events) == ["link_removed", "link_updated"]
    upd = next(e for e in events if e.change_type == "link_updated")
    assert _diffs(upd)["content"] == ({"html": "<p>Open daily</p>"}, {"html": "<p>Open daily, 10 to 5</p>"})


def test_post_categories_are_reconciled(editor, db_session):
    from app.models import Category

    client, org, _ = editor
    news = Category(organization_id=org.organization_id, name="News", slug="news")
    events_cat = Category(organization_id=org.organization_id, name="Events", slug="events")
    db_session.add_all([news, events_cat])
    db_session.commit()
    base = f"/api/organizations/{org.organization_id}/content/pages"
    resp = _send(client, "post", base, {"title": "Braille labels arrive", "page_type": "post"})
    page_id = resp.get_json()["data"]["page_id"]
    pid = uuid.UUID(page_id)
    for ids in ([news.category_id], [news.category_id], [events_cat.category_id]):
        resp = _send(client, "put", f"{base}/{page_id}", {"category_ids": [str(i) for i in ids]})
        assert resp.status_code == 200, resp.get_json()
    events = _child_events(db_session, org.organization_id, "page", pid, "page_category")
    # Saving News twice records it once; switching to Events is one removal and one addition.
    assert sorted((e.change_type, e.child_display_key) for e in events) == [
        ("link_added", "Events"), ("link_added", "News"), ("link_removed", "News")]


def test_menu_items_are_reconciled(editor, db_session):
    from app.models import Menu

    client, org, _ = editor
    url = f"/api/organizations/{org.organization_id}/content/menus/header"
    items = [
        {"label": "Visit", "link_type": "url", "url": "/visit",
         "children": [{"label": "Hours", "link_type": "url", "url": "/visit/hours"}]},
        {"label": "Collection", "link_type": "collection"},
    ]
    assert _send(client, "put", url, {"name": "Main", "items": items}).status_code == 200
    menu = db_session.query(Menu).filter(Menu.organization_id == org.organization_id, Menu.location == "header").one()
    first = _child_events(db_session, org.organization_id, "menu", menu.menu_id, "menu_item")
    assert sorted(e.child_display_key for e in first) == ["Collection", "Hours", "Visit"]

    assert _send(client, "put", url, {"name": "Main", "items": items}).status_code == 200
    assert len(_child_events(db_session, org.organization_id, "menu", menu.menu_id, "menu_item")) == 3

    items[0]["children"][0]["url"] = "/visit/opening-hours"
    items = items[:1]
    assert _send(client, "put", url, {"name": "Main", "items": items}).status_code == 200
    later = _child_events(db_session, org.organization_id, "menu", menu.menu_id, "menu_item")[3:]
    assert sorted((e.change_type, e.child_display_key) for e in later) == [
        ("link_removed", "Collection"), ("link_updated", "Hours")]


# ---------------------------------------------------------------------------
# Media tags and a tag's allowed values
# ---------------------------------------------------------------------------


def test_media_tags_are_reconciled(editor, db_session):
    client, org, _ = editor
    media = _media(db_session, org.organization_id)
    subject = MediaTagDefinition(organization_id=org.organization_id, tag_key="subject", display_name="Subject",
                                 field_type="dynamic_keywords", allow_multiple=True)
    note = MediaTagDefinition(organization_id=org.organization_id, tag_key="note", display_name="Note", field_type="text")
    db_session.add_all([subject, note])
    db_session.commit()
    url = f"/api/organizations/{org.organization_id}/media/{media.media_id}/tags"
    body = {"tags": [
        {"definition_id": str(subject.definition_id), "tag_value": "Chairs"},
        {"definition_id": str(subject.definition_id), "tag_value": "Oak"},
        {"definition_id": str(note.definition_id), "tag_value": "Needs a caption"},
    ]}
    resp = _send(client, "put", url, body)
    assert resp.status_code == 200, resp.get_json()
    assert len(_child_events(db_session, org.organization_id, "media", media.media_id, "media_tag")) == 3

    assert _send(client, "put", url, body).status_code == 200
    assert len(_child_events(db_session, org.organization_id, "media", media.media_id, "media_tag")) == 3

    body["tags"] = [
        {"definition_id": str(subject.definition_id), "tag_value": "Chairs"},
        {"definition_id": str(note.definition_id), "tag_value": "Caption written"},
    ]
    assert _send(client, "put", url, body).status_code == 200
    later = _child_events(db_session, org.organization_id, "media", media.media_id, "media_tag")[3:]
    assert sorted(e.change_type for e in later) == ["link_removed", "link_updated"]
    upd = next(e for e in later if e.change_type == "link_updated")
    assert _diffs(upd) == {"tag_value": ("Needs a caption", "Caption written")}


def test_workspace_bulk_tag_edit_records_only_real_changes(acting_user, db_session):
    from app.fastapi_app.routers.media_tags import set_media_tags

    org, user = acting_user
    media = _media(db_session, org.organization_id)
    d = MediaTagDefinition(organization_id=org.organization_id, tag_key="room", display_name="Room", field_type="text")
    db_session.add(d)
    db_session.commit()
    want = [{"definition_id": d.definition_id, "value_id": None, "tag_value": "Gallery 2"}]
    set_media_tags(db_session, org.organization_id, media.media_id, want, user.user_id, definition_ids=[d.definition_id])
    db_session.commit()
    set_media_tags(db_session, org.organization_id, media.media_id, want, user.user_id, definition_ids=[d.definition_id])
    db_session.commit()
    events = _child_events(db_session, org.organization_id, "media", media.media_id, "media_tag")
    assert [e.change_type for e in events] == ["link_added"]
    assert db_session.query(MediaTag).filter(MediaTag.media_id == media.media_id).count() == 1


def test_allowed_tag_values_are_child_rows_of_the_definition(acting_user, db_session):
    org, _ = acting_user
    d = MediaTagDefinition(organization_id=org.organization_id, tag_key="mat", display_name="Material", field_type="dropdown")
    db_session.add(d)
    db_session.commit()
    v = MediaTagValue(definition_id=d.definition_id, value="Wool")
    db_session.add(v)
    db_session.commit()
    v.value = "Merino wool"
    v.sort_order = 7  # a reorder alone is not recorded
    db_session.commit()
    db_session.delete(v)
    db_session.commit()
    events = _child_events(db_session, org.organization_id, "media_tag_definition", d.definition_id, "media_tag_value")
    assert [e.change_type for e in events] == ["link_added", "link_updated", "link_removed"]
    assert _diffs(events[1]) == {"value": ("Wool", "Merino wool")}


# ---------------------------------------------------------------------------
# Department memberships and media links (primary flag moved row by row)
# ---------------------------------------------------------------------------


def test_department_membership_primary_moves_are_recorded(editor, db_session):
    client, org, user = editor
    a = Department(organization_id=org.organization_id, name="Archives", code="ARC", path="ARC")
    b = Department(organization_id=org.organization_id, name="Library", code="LIB", path="LIB")
    db_session.add_all([a, b])
    db_session.commit()
    base = f"/api/organizations/{org.organization_id}/departments"
    resp = _send(client, "post", f"{base}/{a.department_id}/members", {"user_id": str(user.user_id), "is_primary": True})
    assert resp.status_code == 201, resp.get_json()
    resp = _send(client, "post", f"{base}/{b.department_id}/members", {"user_id": str(user.user_id), "is_primary": True})
    assert resp.status_code == 201, resp.get_json()
    on_a = _child_events(db_session, org.organization_id, "department", a.department_id, "department_membership")
    assert [e.change_type for e in on_a] == ["link_added", "link_updated"]
    assert _diffs(on_a[1]) == {"is_primary": (True, False)}
    assert on_a[0].child_display_key == user.email


def test_constituent_media_links_and_primary(acting_user, db_session):
    org, _ = acting_user
    person = Constituent(organization_id=org.organization_id, constituent_type="person", name="Ada")
    db_session.add(person)
    db_session.flush()
    m1, m2 = _media(db_session, org.organization_id, "ada1.jpg"), _media(db_session, org.organization_id, "ada2.jpg")
    db_session.add(ConstituentMedia(constituent_id=person.constituent_id, media_id=m1.media_id, is_primary=True))
    db_session.commit()
    from app.fastapi_app.routers.collections_constituents import _clear_primary_media

    _clear_primary_media(db_session, person.constituent_id)
    db_session.add(ConstituentMedia(constituent_id=person.constituent_id, media_id=m2.media_id, is_primary=True))
    db_session.commit()
    events = _child_events(db_session, org.organization_id, "constituent", person.constituent_id, "constituent_media")
    assert sorted((e.change_type, e.child_display_key) for e in events) == [
        ("link_added", "ada1.jpg"), ("link_added", "ada2.jpg"), ("link_updated", "ada1.jpg")]
    assert all(e.organization_id == org.organization_id for e in events)  # org taken from the person


def test_entry_item_media_is_recorded_on_the_entry(acting_user, db_session):
    from datetime import date

    org, _ = acting_user
    entry = ObjectEntry(organization_id=org.organization_id, entry_number="EN-1", entry_date=date.today(),
                        entry_reason="loan_consideration")
    db_session.add(entry)
    db_session.flush()
    item = ObjectEntryItem(entry_id=entry.entry_id, organization_id=org.organization_id, item_number=1)
    db_session.add(item)
    db_session.flush()
    m = _media(db_session, org.organization_id, "crate.jpg")
    link = ObjectEntryItemMedia(entry_item_id=item.entry_item_id, media_id=m.media_id, is_primary=False)
    db_session.add(link)
    db_session.commit()
    link.caption = "On arrival"
    db_session.commit()
    events = _child_events(db_session, org.organization_id, "object_entry", entry.entry_id, "object_entry_item_media")
    assert [e.change_type for e in events] == ["link_added", "link_updated"]
    assert events[0].child_display_key == "crate.jpg"


# ---------------------------------------------------------------------------
# Lookup sort positions
# ---------------------------------------------------------------------------


def test_lookup_sort_positions_are_reconciled(editor, db_session):
    from app.models import LookupCategory, LookupValue

    client, org, _ = editor
    cat = LookupCategory(category_key=f"cat{uuid.uuid4().hex[:6]}", display_name="Materials")
    db_session.add(cat)
    db_session.flush()
    vals = [LookupValue(category_id=cat.category_id, value_key=k, label=k.title()) for k in ("wood", "metal", "glass")]
    db_session.add_all(vals)
    db_session.commit()
    url = f"/api/organizations/{org.organization_id}/lookups/{cat.category_key}/sort"
    order = [str(v.value_id) for v in vals]
    assert _send(client, "put", url, {"value_ids": order}).status_code == 200
    assert _send(client, "put", url, {"value_ids": order}).status_code == 200
    swapped = [order[1], order[0], order[2]]
    assert _send(client, "put", url, {"value_ids": swapped}).status_code == 200

    wood = _child_events(db_session, org.organization_id, "lookup_value", vals[0].value_id, "lookup_sort_override")
    assert [e.change_type for e in wood] == ["link_added", "link_updated"]
    assert _diffs(wood[1]) == {"sort_order": (0, 1)}
    glass = _child_events(db_session, org.organization_id, "lookup_value", vals[2].value_id, "lookup_sort_override")
    assert [e.change_type for e in glass] == ["link_added"]


def test_polymorphic_parents_are_tracked():
    tracked = {c["entity_type"] for c in ea.TRACKED_ENTITIES.values()}
    for name, mapping in ea.POLYMORPHIC_LINK_PARENTS.items():
        assert ea.TRACKED_LINKS[name]["parent_type_field"]
        for model, parent_type in mapping.values():
            assert model in ea.TRACKED_ENTITIES and parent_type in tracked, (name, model)
