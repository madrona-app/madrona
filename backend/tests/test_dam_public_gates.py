"""Public DAM API: the Discover gates apply to every object it describes.

A published file can be linked to a record that is not public. The DAM API
(``/public/v1``) runs on a BYPASSRLS session, so its own filters are the only
control. These pin that

* ``include=object_metadata`` on a media item only embeds objects of the
  same organization that are discoverable, not deleted and not hidden as
  deaccessioned, with the organization's public field set applied;
* the object list/detail/media/IIIF routes and ``/sync`` apply the same
  gates;
* the IIIF manifest shows images from a rendition, and the uploaded master
  only when the file's public download level allows originals.
"""

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest

from tests.test_fastapi_dam_public import fastapi_app, fastapi_client, org_and_key  # noqa: F401

SECRET_DESCRIPTION = "Internal note: kept in vault B"


@pytest.fixture(autouse=True)
def fake_signing():
    with patch(
        "app.services.iiif_presentation.get_org_media_url",
        side_effect=lambda key, **kw: f"https://media.test/{key}",
    ), patch(
        "app.services.discover_media.get_org_media_url",
        side_effect=lambda key, **kw: f"https://media.test/{key}",
    ):
        yield


def _obj(db, org, **kw):
    from app.models import CollectionObject, ObjectTitle

    o = CollectionObject(
        organization_id=org.organization_id,
        object_number=kw.pop("object_number", f"DAM.{uuid.uuid4().hex[:6]}"),
        object_name="Tactile map",
        brief_description=kw.pop("brief_description", "A raised-line map"),
        is_discoverable=kw.pop("is_discoverable", True),
        **kw,
    )
    db.add(o)
    db.flush()
    db.add(ObjectTitle(
        organization_id=org.organization_id, object_id=o.object_id,
        title=f"Title {o.object_number}", is_preferred=True,
    ))
    db.flush()
    return o


def _media(db, org, *, rendition=True, **kw):
    from app.models import Media, MediaDerivative

    tag = uuid.uuid4().hex[:8]
    m = Media(
        organization_id=org.organization_id,
        filename=f"scan-{tag}.tif",
        s3_key=f"orgs/{org.organization_id}/media/MASTER-{tag}.tif",
        media_type="image",
        mime_type="image/tiff",
        file_size=9_000_000,
        width=4000, height=3000,
        is_published=kw.pop("is_published", True),
        **kw,
    )
    db.add(m)
    db.flush()
    if rendition:
        db.add(MediaDerivative(
            media_id=m.media_id, organization_id=org.organization_id,
            derivative_type="large", format="jpeg",
            s3_key=f"orgs/{org.organization_id}/media/derivatives/{m.media_id}/large.jpeg",
            width=2000, height=1500, file_size=300_000,
        ))
        db.flush()
    return m


def _link(db, obj, media, primary=True):
    from app.models import CollectionObjectMedia

    db.add(CollectionObjectMedia(object_id=obj.object_id, media_id=media.media_id, is_primary=primary))
    db.flush()


def _get(client, key, url):
    resp = client.get(url, headers={"X-API-Key": key})
    assert resp.status_code == 200, resp.text
    return resp.json()


def _embedded_ids(data):
    return {o["object_id"] for o in data.get("object_metadata") or []}


class TestMediaObjectMetadata:
    @pytest.mark.parametrize("hidden", ["not_discoverable", "deleted", "deaccessioned"])
    def test_non_public_object_is_not_embedded(self, fastapi_client, org_and_key, db_session, hidden):
        org, key = org_and_key
        public = _obj(db_session, org)
        kw = {
            "not_discoverable": {"is_discoverable": False},
            "deleted": {"is_deleted": True},
            "deaccessioned": {"object_status": "deaccessioned"},
        }[hidden]
        private = _obj(db_session, org, brief_description=SECRET_DESCRIPTION, **kw)
        media = _media(db_session, org)
        _link(db_session, public, media)
        _link(db_session, private, media, primary=False)
        db_session.commit()

        data = _get(
            fastapi_client, key,
            f"/public/v1/{org.organization_id}/media/{media.media_id}?include=object_metadata",
        )["data"]
        assert _embedded_ids(data) == {str(public.object_id)}
        assert SECRET_DESCRIPTION not in str(data)

        listed = _get(
            fastapi_client, key, f"/public/v1/{org.organization_id}/media?include=object_metadata",
        )["data"]
        assert [_embedded_ids(m) for m in listed] == [{str(public.object_id)}]

    def test_deaccessioned_embedded_when_org_shows_them(self, fastapi_client, org_and_key, db_session):
        org, key = org_and_key
        org.hide_deaccessioned_in_search = False
        obj = _obj(db_session, org, object_status="deaccessioned")
        media = _media(db_session, org)
        _link(db_session, obj, media)
        db_session.commit()

        data = _get(
            fastapi_client, key,
            f"/public/v1/{org.organization_id}/media/{media.media_id}?include=object_metadata",
        )["data"]
        assert _embedded_ids(data) == {str(obj.object_id)}

    def test_object_from_another_org_is_not_embedded(self, fastapi_client, org_and_key, db_session):
        from app.models import Organization

        org, key = org_and_key
        other = Organization(name="Other", slug=f"other-{uuid.uuid4().hex[:8]}", status="active")
        db_session.add(other)
        db_session.flush()
        foreign = _obj(db_session, other, brief_description=SECRET_DESCRIPTION)
        media = _media(db_session, org)
        _link(db_session, foreign, media)
        db_session.commit()

        data = _get(
            fastapi_client, key,
            f"/public/v1/{org.organization_id}/media/{media.media_id}?include=object_metadata",
        )["data"]
        assert not data.get("object_metadata")
        assert SECRET_DESCRIPTION not in str(data)

    def test_public_field_set_still_applies(self, fastapi_client, org_and_key, db_session):
        from app.models import DiscoverConfig
        from app.services.public_object_fields import FIELD_CATALOG

        org, key = org_and_key
        keys = [f.key for f in FIELD_CATALOG if f.default and f.key != "brief_description"]
        db_session.add(DiscoverConfig(organization_id=org.organization_id, public_object_fields=keys))
        obj = _obj(db_session, org, brief_description=SECRET_DESCRIPTION)
        media = _media(db_session, org)
        _link(db_session, obj, media)
        db_session.commit()

        data = _get(
            fastapi_client, key,
            f"/public/v1/{org.organization_id}/media/{media.media_id}?include=object_metadata",
        )["data"]
        assert _embedded_ids(data) == {str(obj.object_id)}
        assert SECRET_DESCRIPTION not in str(data)


class TestObjectRoutes:
    @pytest.mark.parametrize("hidden", ["deleted", "deaccessioned"])
    def test_hidden_object_is_not_served(self, fastapi_client, org_and_key, db_session, hidden):
        org, key = org_and_key
        kw = {"is_deleted": True} if hidden == "deleted" else {"object_status": "deaccessioned"}
        visible = _obj(db_session, org)
        gone = _obj(db_session, org, **kw)
        media = _media(db_session, org)
        _link(db_session, gone, media)
        db_session.commit()
        base = f"/public/v1/{org.organization_id}"
        headers = {"X-API-Key": key}

        listed = _get(fastapi_client, key, f"{base}/objects")["data"]
        assert [o["id"] for o in listed] == [str(visible.object_id)]
        for path in (
            f"{base}/objects/{gone.object_id}",
            f"{base}/objects/{gone.object_id}/media",
            f"{base}/iiif/{gone.object_id}/manifest.json",
        ):
            assert fastapi_client.get(path, headers=headers).status_code == 404, path

    def test_sync_lists_only_public_objects(self, fastapi_client, org_and_key, db_session):
        org, key = org_and_key
        public = _obj(db_session, org)
        _obj(db_session, org, is_discoverable=False, brief_description=SECRET_DESCRIPTION)
        _obj(db_session, org, is_deleted=True)
        _obj(db_session, org, object_status="deaccessioned")
        db_session.commit()
        since = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()

        resp = fastapi_client.get(
            f"/public/v1/{org.organization_id}/sync", params={"since": since},
            headers={"X-API-Key": key},
        )
        assert resp.status_code == 200
        objects = resp.json()["data"]["objects"]
        assert [o["id"] for o in objects] == [str(public.object_id)]
        assert SECRET_DESCRIPTION not in resp.text


class TestIIIFManifestMaster:
    def _manifest(self, client, key, org, obj):
        return client.get(
            f"/public/v1/{org.organization_id}/iiif/{obj.object_id}/manifest.json",
            headers={"X-API-Key": key},
        )

    def test_image_served_from_rendition(self, fastapi_client, org_and_key, db_session):
        org, key = org_and_key
        obj = _obj(db_session, org)
        media = _media(db_session, org)
        _link(db_session, obj, media)
        db_session.commit()

        resp = self._manifest(fastapi_client, key, org, obj)
        assert resp.status_code == 200
        assert "large.jpeg" in resp.text
        assert media.s3_key not in resp.text

    def test_image_without_rendition_never_mints_master(self, fastapi_client, org_and_key, db_session):
        org, key = org_and_key
        obj = _obj(db_session, org)
        media = _media(db_session, org, rendition=False)
        _link(db_session, obj, media)
        db_session.commit()

        resp = self._manifest(fastapi_client, key, org, obj)
        assert resp.status_code == 200
        assert media.s3_key not in resp.text
        assert resp.json()["items"] == []

    def test_master_allowed_when_level_is_originals(self, fastapi_client, org_and_key, db_session):
        org, key = org_and_key
        obj = _obj(db_session, org)
        media = _media(db_session, org, rendition=False, public_download_level="originals")
        _link(db_session, obj, media)
        db_session.commit()

        resp = self._manifest(fastapi_client, key, org, obj)
        assert resp.status_code == 200
        assert len(resp.json()["items"]) == 1
        assert media.s3_key in resp.text
