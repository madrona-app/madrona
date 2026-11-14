"""JSON-LD and profile exports honour field-level access.

A field hidden from a role (here provenance) must not reach that role
through any staff export, including the JSON-LD buttons on the object list
and the object record.
"""
import json
from uuid import uuid4

import pytest

from app.models import CollectionObject
from tests.conftest import AuthenticatedClient
from tests.test_api_library import TestPermissions as _LibraryPermissions

SECRET = "Bought from the estate of a private collector, 1962"


@pytest.fixture
def restricted_setup(auth_setup, client, db_session):
    from app.models import Application, FieldAccessPolicy

    admin, org, _ = auth_setup
    app_row = db_session.query(Application).filter_by(key="collections").first()
    if app_row is None:
        app_row = Application(key="collections", display_name="Collections")
        db_session.add(app_row)
        db_session.flush()
    db_session.add(FieldAccessPolicy(
        application_id=app_row.application_id, entity_type="collection_object",
        field_path="provenance", policy_type="restricted",
        display_name="Provenance", default_visible=False,
    ))
    obj = CollectionObject(
        organization_id=org.organization_id, object_number=f"FA.{uuid4().hex[:6]}",
        object_name="Braille slate", object_type="tool", provenance=SECRET,
        credit_line="Gift of the Federation",
    )
    db_session.add(obj)
    db_session.commit()
    token, _ = _LibraryPermissions()._member(db_session, org, ["collections.view"])
    viewer = AuthenticatedClient(client, token)
    return admin, viewer, org, obj


def _body(resp):
    data = resp.content if hasattr(resp, "content") else resp.data
    return json.loads(data)


class TestJsonLdFieldAccess:
    def test_single_object_hides_restricted_field(self, restricted_setup):
        admin, viewer, org, obj = restricted_setup
        url = f"/api/organizations/{org.organization_id}/collections/objects/{obj.object_id}/jsonld"
        r = viewer.get(url)
        assert r.status_code == 200
        doc = _body(r)
        assert "provenance" not in doc
        assert SECRET not in json.dumps(doc)
        assert "Gift of the Federation" in json.dumps(doc)
        assert SECRET in json.dumps(_body(admin.get(url)))

    def test_bulk_get_and_scoped_post_hide_field(self, restricted_setup):
        admin, viewer, org, obj = restricted_setup
        base = f"/api/organizations/{org.organization_id}/collections/export/jsonld"
        r = viewer.get(base)
        assert r.status_code == 200
        assert SECRET not in json.dumps(_body(r))
        r = viewer.post(base, json={"object_ids": [str(obj.object_id)]})
        assert r.status_code == 200
        assert SECRET not in json.dumps(_body(r))
        assert SECRET in json.dumps(_body(admin.post(base, json={"object_ids": [str(obj.object_id)]})))

    def test_viewer_export_does_not_modify_the_record(self, restricted_setup, db_session):
        _, viewer, org, obj = restricted_setup
        viewer.get(f"/api/organizations/{org.organization_id}/collections/export/jsonld")
        db_session.expire_all()
        fresh = db_session.get(CollectionObject, obj.object_id)
        assert fresh.provenance == SECRET
