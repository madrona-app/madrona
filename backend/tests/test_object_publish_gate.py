"""Publishing a record is a separate, permission-gated action.

The generic object create/update must not change is_discoverable: otherwise any
editor could publish a record (and skip the NAGPRA display-consent gate) by
sending the field. NFB's requirement: publishing restricted by role.
"""
import json
from unittest.mock import patch


def _url(org):
    return f"/api/organizations/{org.organization_id}/collections/objects"


@patch("app.fastapi_app.routers.collections_objects._index_collection_object")
class TestPublishGate:
    def _create(self, client, org, number):
        resp = client.post(_url(org), data=json.dumps({"object_number": number, "object_name": "x"}), content_type="application/json")
        assert resp.status_code == 201, resp.get_json()
        return resp.get_json()["object_id"]

    def test_put_cannot_publish(self, _idx, auth_setup, db_session):
        client, org, _ = auth_setup
        oid = self._create(client, org, "PUB.1")
        resp = client.put(f"{_url(org)}/{oid}", data=json.dumps({"is_discoverable": True}), content_type="application/json")
        assert resp.status_code == 403
        assert "publish" in json.dumps(resp.get_json()).lower()
        assert client.get(f"{_url(org)}/{oid}").get_json()["is_discoverable"] is False

    def test_post_cannot_create_published(self, _idx, auth_setup):
        client, org, _ = auth_setup
        resp = client.post(_url(org), data=json.dumps({"object_number": "PUB.2", "object_name": "x", "is_discoverable": True}), content_type="application/json")
        assert resp.status_code == 403

    def test_unchanged_value_is_accepted(self, _idx, auth_setup):
        # Clients that echo the current value back on save are not broken.
        client, org, _ = auth_setup
        oid = self._create(client, org, "PUB.3")
        resp = client.put(f"{_url(org)}/{oid}", data=json.dumps({"is_discoverable": False, "object_name": "renamed"}), content_type="application/json")
        assert resp.status_code == 200
        assert resp.get_json()["object_name"] == "renamed"

    def test_publish_endpoint_still_works(self, _idx, auth_setup):
        client, org, _ = auth_setup
        oid = self._create(client, org, "PUB.4")
        with patch("app.fastapi_app.routers.collections_discover._index_collection_object"):
            resp = client.patch(f"{_url(org)}/{oid}/discoverable", data=json.dumps({"is_discoverable": True}), content_type="application/json")
        assert resp.status_code == 200
        assert resp.get_json()["is_discoverable"] is True
