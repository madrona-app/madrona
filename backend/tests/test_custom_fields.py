"""User-defined fields on object records: admin, validation, permissions, portal."""
import json
from unittest.mock import patch

import pytest

from tests.test_record_workflow import _member  # non-admin member helper

_INDEX = "app.fastapi_app.routers.collections_objects._index_collection_object"


def _defs(org):
    return f"/api/organizations/{org.organization_id}/collections/settings/custom-fields"


def _objs(org):
    return f"/api/organizations/{org.organization_id}/collections/objects"


def _j(r):
    return r.get_json()


def _post(c, url, body):
    with patch(_INDEX):
        return c.post(url, data=json.dumps(body), content_type="application/json")


def _put(c, url, body):
    with patch(_INDEX):
        return c.put(url, data=json.dumps(body), content_type="application/json")


@pytest.fixture
def setup(client, db_session, auth_setup):
    admin, org, _ = auth_setup
    intern, _ = _member(client, db_session, org.organization_id,
                        ["collections.view", "collections.create", "collections.edit"], "intern2@example.com")
    for body in [
        {"label": "Braille grade", "field_type": "select", "options": ["Grade 1", "Grade 2"], "is_public": True},
        {"label": "Pages", "field_type": "number"},
        {"label": "Transcribed on", "field_type": "date"},
        {"label": "Accessible format", "field_type": "multi_select", "options": ["Braille", "Large print", "Audio"]},
        {"label": "Donor contact notes", "field_type": "long_text", "view_roles": ["admin"]},
        {"label": "Shelf check", "field_type": "boolean", "edit_roles": ["admin"]},
    ]:
        assert _post(admin, _defs(org), body).status_code == 201
    return admin, intern, org


def test_admin_defines_fields_and_values_round_trip(setup):
    admin, intern, org = setup
    keys = [d["key"] for d in _j(admin.get(_defs(org)))["items"]]
    assert keys == ["braille_grade", "pages", "transcribed_on", "accessible_format", "donor_contact_notes", "shelf_check"]
    r = _post(intern, _objs(org), {"object_number": "CF.1", "object_name": "Book", "custom_fields": {
        "braille_grade": "grade 2", "pages": "312", "transcribed_on": "1958-03-01", "accessible_format": ["Braille", "Audio"]}})
    assert r.status_code == 201, _j(r)
    cf = _j(intern.get(f"{_objs(org)}/{_j(r)['object_id']}"))["custom_fields"]
    assert cf == {"braille_grade": "Grade 2", "pages": 312, "transcribed_on": "1958-03-01",
                  "accessible_format": ["Braille", "Audio"]}


@pytest.mark.parametrize("values, msg", [
    ({"pages": "many"}, "must be a number"),
    ({"braille_grade": "Grade 3"}, "must be one of"),
    ({"transcribed_on": "March 1958"}, "must be a date"),
    ({"accessible_format": ["Tactile"]}, "not one of the choices"),
    ({"nonexistent": "x"}, "no active field"),
])
def test_validation(setup, values, msg):
    admin, _, org = setup
    r = _post(admin, _objs(org), {"object_number": "CF.V", "object_name": "x", "custom_fields": values})
    assert r.status_code == 422 and msg in json.dumps(_j(r))


def test_field_level_permissions(setup):
    admin, intern, org = setup
    oid = _j(_post(admin, _objs(org), {"object_number": "CF.P", "object_name": "x", "custom_fields": {
        "donor_contact_notes": "Call after 5pm", "shelf_check": True}}))["object_id"]
    # Hidden from the intern's role, read-only for it where edit_roles is set.
    seen = _j(intern.get(f"{_objs(org)}/{oid}"))["custom_fields"]
    assert "donor_contact_notes" not in seen and seen["shelf_check"] is True
    assert "donor_contact_notes" not in [d["key"] for d in _j(intern.get(_defs(org)))["items"]]
    assert _put(intern, f"{_objs(org)}/{oid}", {"custom_fields": {"shelf_check": False}}).status_code == 403
    # Echoing an unchanged read-only value back is fine; other fields still save.
    r = _put(intern, f"{_objs(org)}/{oid}", {"custom_fields": {"shelf_check": True, "pages": 10}})
    assert r.status_code == 200, _j(r)
    # The hidden value survives the intern's edit.
    assert _j(admin.get(f"{_objs(org)}/{oid}"))["custom_fields"]["donor_contact_notes"] == "Call after 5pm"
    # Only administrators define fields.
    assert _post(intern, _defs(org), {"label": "Mine"}).status_code == 403


def test_required_and_deactivate(setup):
    admin, _, org = setup
    fid = _j(_post(admin, _defs(org), {"label": "Call number", "is_required": True}))["field_id"]
    r = _post(admin, _objs(org), {"object_number": "CF.R", "object_name": "x", "custom_fields": {"pages": 1}})
    assert r.status_code == 422 and "Required: Call number" in json.dumps(_j(r))
    # A plain create that doesn't send custom fields is not blocked.
    assert _post(admin, _objs(org), {"object_number": "CF.R2", "object_name": "x"}).status_code == 201
    assert admin.delete(f"{_defs(org)}/{fid}").status_code == 200
    assert _post(admin, _objs(org), {"object_number": "CF.R3", "object_name": "x", "custom_fields": {"pages": 1}}).status_code == 201


def test_type_cannot_change(setup):
    admin, _, org = setup
    d = [x for x in _j(admin.get(_defs(org)))["items"] if x["key"] == "pages"][0]
    assert _put(admin, f"{_defs(org)}/{d['field_id']}", {"field_type": "text"}).status_code == 422


def test_public_portal_shows_only_public_fields(setup, db_session):
    from app.fastapi_app.routers.discover_public import _public_custom_fields
    from app.models import CollectionObject
    import uuid as _uuid
    admin, _, org = setup
    oid = _j(_post(admin, _objs(org), {"object_number": "CF.PUB", "object_name": "x", "custom_fields": {
        "braille_grade": "Grade 1", "donor_contact_notes": "private", "pages": 3}}))["object_id"]
    obj = db_session.get(CollectionObject, _uuid.UUID(oid))
    assert _public_custom_fields(obj) == [{"label": "Braille grade", "value": "Grade 1"}]


def test_search_by_custom_field(setup):
    admin, intern, org = setup
    a = _j(_post(admin, _objs(org), {"object_number": "S.1", "object_name": "a", "custom_fields": {
        "braille_grade": "Grade 2", "accessible_format": ["Braille", "Audio"], "donor_contact_notes": "secret"}}))["object_id"]
    _post(admin, _objs(org), {"object_number": "S.2", "object_name": "b", "custom_fields": {"braille_grade": "Grade 1"}})
    def nums(r):
        body = _j(r)
        return [o["object_number"] for o in body.get("items", body.get("objects", []))]
    assert nums(admin.get(f"{_objs(org)}?custom_field=braille_grade:grade%202")) == ["S.1"]
    assert nums(admin.get(f"{_objs(org)}?custom_field=accessible_format:Audio")) == ["S.1"]
    # A field hidden from the caller cannot be used to probe values.
    assert intern.get(f"{_objs(org)}?custom_field=donor_contact_notes:secret").status_code == 422
    assert admin.get(f"{_objs(org)}?custom_field=nope:x").status_code == 422
