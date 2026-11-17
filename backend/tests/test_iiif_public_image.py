"""Public IIIF Image API: renditions only, capped (services/iiif_public_image.py).

With a Cantaloupe image server configured, anonymous manifests used to point
at the server's ``{org_id}/{media_id}`` identifier, which resolves to the
uploaded master, so ``.../full/max/0/default.jpg`` handed anyone the master at
full resolution. Anonymous IIIF now goes through Madrona's
``/iiif/3/media/{id}/...`` service, which serves the published rendition
only and caps the output size. The image server is mocked at
``iiif_public_image.fetch_upstream``.
"""

import json
import uuid
from unittest.mock import patch
from urllib.parse import unquote

import pytest

from app.services import iiif_public_image as pub

MASTER = "MASTER-DO-NOT-SERVE"
JPEG = b"\xff\xd8\xff\xe0fake-jpeg"


@pytest.fixture(autouse=True)
def image_server_on():
    with patch("app.services.iiif_image.IIIF_IMAGE_SERVER_ENABLED", True):
        yield


@pytest.fixture()
def upstream():
    calls = []

    def _fetch(url):
        calls.append(url)
        return 200, JPEG, "image/jpeg"

    with patch("app.services.iiif_public_image.fetch_upstream", side_effect=_fetch):
        yield calls


@pytest.fixture()
def org(db_session):
    from app.models import Organization

    o = Organization(name="IIIF Museum", slug=f"iiif-{uuid.uuid4().hex[:8]}", status="active", is_demo=False)
    db_session.add(o)
    db_session.flush()
    return o


def _obj(db, org, **kw):
    from app.models import CollectionObject, ObjectTitle

    o = CollectionObject(
        organization_id=org.organization_id,
        object_number=kw.pop("object_number", f"P.{uuid.uuid4().hex[:6]}"),
        object_name="Tactile map",
        is_discoverable=kw.pop("is_discoverable", True),
        **kw,
    )
    db.add(o)
    db.flush()
    db.add(ObjectTitle(organization_id=org.organization_id, object_id=o.object_id,
                       title="Tactile map", is_preferred=True))
    db.flush()
    return o


def _media(db, org, *, published=True, rendition=True, rendition_size=(4000, 3000)):
    from app.models import Media, MediaDerivative

    m = Media(
        organization_id=org.organization_id,
        filename="scan.tif",
        s3_key=f"orgs/{org.organization_id}/media/{MASTER}-{uuid.uuid4().hex[:6]}.tif",
        media_type="image", mime_type="image/tiff", file_size=90_000_000,
        width=12000, height=9000, is_published=published,
    )
    db.add(m)
    db.flush()
    if rendition:
        w, h = rendition_size
        db.add(MediaDerivative(
            media_id=m.media_id, organization_id=org.organization_id,
            derivative_type="access_master", format="jpeg",
            s3_key=f"orgs/{org.organization_id}/media/derivatives/{m.media_id}/access_master.jpeg",
            width=w, height=h, file_size=2_000_000,
        ))
        db.flush()
    return m


def _link(db, obj, media):
    from app.models import CollectionObjectMedia

    db.add(CollectionObjectMedia(object_id=obj.object_id, media_id=media.media_id, is_primary=True))
    db.flush()


def _public(db, org, **kw):
    obj = _obj(db, org)
    m = _media(db, org, **kw)
    _link(db, obj, m)
    return obj, m


def _body(resp):
    return resp.data if hasattr(resp, "data") else resp.content


def _json(resp):
    return json.loads(_body(resp))


# ---------------------------------------------------------------------------
# Image requests
# ---------------------------------------------------------------------------


class TestImageRequests:
    def test_full_max_never_resolves_to_the_master(self, client, db_session, org, upstream):
        _, m = _public(db_session, org)
        resp = client.get(f"/iiif/3/media/{m.media_id}/full/max/0/default.jpg")
        assert resp.status_code == 200
        assert _body(resp) == JPEG
        assert resp.headers["content-type"].startswith("image/jpeg")
        assert len(upstream) == 1
        url = unquote(upstream[0])
        assert MASTER not in url
        assert f"{org.organization_id}/{m.media_id}/" not in url  # the master identifier
        assert f"derivatives/{m.media_id}/access_master.jpeg" in url

    def test_full_max_is_capped_at_the_default_long_edge(self, client, db_session, org, upstream):
        _, m = _public(db_session, org)  # 4000x3000 rendition
        resp = client.get(f"/iiif/3/media/{m.media_id}/full/max/0/default.jpg")
        assert resp.status_code == 200
        assert upstream[0].endswith("/0,0,4000,3000/3000,2250/0/default.jpg")

    def test_configured_cap_applies(self, client, db_session, org, upstream, monkeypatch):
        monkeypatch.setenv("IIIF_PUBLIC_MAX_DIMENSION", "1000")
        _, m = _public(db_session, org)
        for size in ("max", "^max", "full"):
            resp = client.get(f"/iiif/3/media/{m.media_id}/full/{size}/0/default.jpg")
            assert resp.status_code == 200, size
        assert all(u.endswith("/0,0,4000,3000/1000,750/0/default.jpg") for u in upstream)

    def test_max_never_exceeds_a_small_rendition(self, client, db_session, org, upstream):
        _, m = _public(db_session, org, rendition_size=(1200, 800))
        resp = client.get(f"/iiif/3/media/{m.media_id}/full/max/0/default.jpg")
        assert resp.status_code == 200
        assert upstream[0].endswith("/0,0,1200,800/1200,800/0/default.jpg")

    @pytest.mark.parametrize("size", ["3001,", ",2251", "4000,3000", "^4000,", "pct:100", "!5000,5000"])
    def test_size_beyond_the_cap_is_400(self, client, db_session, org, upstream, size):
        _, m = _public(db_session, org)
        resp = client.get(f"/iiif/3/media/{m.media_id}/full/{size}/0/default.jpg")
        assert resp.status_code == 400
        assert upstream == []

    def test_upscaling_without_caret_is_400(self, client, db_session, org, upstream):
        _, m = _public(db_session, org)
        resp = client.get(f"/iiif/3/media/{m.media_id}/0,0,100,100/200,/0/default.jpg")
        assert resp.status_code == 400
        assert upstream == []

    def test_sizes_within_the_cap_pass_through(self, client, db_session, org, upstream):
        _, m = _public(db_session, org)
        ok = [
            ("full", "200,", "0,0,4000,3000/200,150"),
            ("full", "!800,800", "0,0,4000,3000/800,600"),
            ("0,0,512,512", "max", "0,0,512,512/512,512"),
            ("square", "max", "500,0,3000,3000/2250,2250"),
            ("pct:50,50,50,50", "pct:50", "2000,1500,2000,1500/1000,750"),
            ("3900,2900,512,512", "max", "3900,2900,100,100/100,100"),
        ]
        for region, size, expected in ok:
            resp = client.get(f"/iiif/3/media/{m.media_id}/{region}/{size}/0/default.jpg")
            assert resp.status_code == 200, (region, size)
            assert upstream[-1].endswith(f"/{expected}/0/default.jpg"), upstream[-1]

    @pytest.mark.parametrize("path", [
        "5000,0,10,10/max/0/default.jpg",   # region outside the image
        "full/max/400/default.jpg",          # rotation
        "full/max/0/sepia.jpg",              # quality
        "full/max/0/default.exe",            # format
        "full/bogus/0/default.jpg",          # size
    ])
    def test_invalid_requests_are_400(self, client, db_session, org, upstream, path):
        _, m = _public(db_session, org)
        resp = client.get(f"/iiif/3/media/{m.media_id}/{path}")
        assert resp.status_code == 400
        assert upstream == []

    def test_image_server_error_is_502(self, client, db_session, org):
        _, m = _public(db_session, org)
        with patch("app.services.iiif_public_image.fetch_upstream", return_value=(500, b"", None)):
            resp = client.get(f"/iiif/3/media/{m.media_id}/full/max/0/default.jpg")
        assert resp.status_code == 502


# ---------------------------------------------------------------------------
# info.json
# ---------------------------------------------------------------------------


class TestInfoJson:
    def test_advertises_the_cap(self, client, db_session, org):
        _, m = _public(db_session, org)
        resp = client.get(f"/iiif/3/media/{m.media_id}/info.json")
        assert resp.status_code == 200
        info = _json(resp)
        assert info["id"].endswith(f"/iiif/3/media/{m.media_id}")
        assert (info["width"], info["height"]) == (4000, 3000)  # the rendition, not 12000x9000
        assert (info["maxWidth"], info["maxHeight"]) == (3000, 2250)
        assert info["sizes"][-1] == {"width": 3000, "height": 2250}
        assert all(s["width"] <= 3000 and s["height"] <= 2250 for s in info["sizes"])
        assert MASTER not in _body(resp).decode()

    def test_cap_follows_configuration(self, client, db_session, org, monkeypatch):
        monkeypatch.setenv("IIIF_PUBLIC_MAX_DIMENSION", "1000")
        _, m = _public(db_session, org)
        info = _json(client.get(f"/iiif/3/media/{m.media_id}/info.json"))
        assert (info["maxWidth"], info["maxHeight"]) == (1000, 750)

    def test_no_longer_redirects_to_the_image_server(self, client, db_session, org):
        _, m = _public(db_session, org)
        resp = client.get(f"/iiif/3/media/{m.media_id}/info.json", follow_redirects=False)
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Gates
# ---------------------------------------------------------------------------


def _hidden_cases(db, org):
    cases = {}
    obj = _obj(db, org)
    m = _media(db, org, published=False)
    _link(db, obj, m)
    cases["unpublished"] = m
    obj = _obj(db, org, is_discoverable=False)
    m = _media(db, org)
    _link(db, obj, m)
    cases["non_discoverable_object"] = m
    obj = _obj(db, org, is_deleted=True)
    m = _media(db, org)
    _link(db, obj, m)
    cases["deleted_object"] = m
    cases["unlinked"] = _media(db, org)
    obj = _obj(db, org)
    m = _media(db, org, rendition=False)
    _link(db, obj, m)
    cases["no_rendition"] = m
    return cases


class TestGates:
    def test_hidden_media_is_404_everywhere(self, client, db_session, org, upstream):
        for name, m in _hidden_cases(db_session, org).items():
            for path in ("info.json", "full/max/0/default.jpg", "full/200,/0/default.jpg"):
                resp = client.get(f"/iiif/3/media/{m.media_id}/{path}")
                assert resp.status_code == 404, (name, path)
        assert upstream == []

    def test_nonexistent_media_is_404(self, client, upstream):
        resp = client.get(f"/iiif/3/media/{uuid.uuid4()}/full/max/0/default.jpg")
        assert resp.status_code == 404
        assert upstream == []


# ---------------------------------------------------------------------------
# Manifests reference the public service, never the master identifier
# ---------------------------------------------------------------------------


class TestManifests:
    def _assert_public_image(self, canvas, m):
        body = canvas["items"][0]["items"][0]["body"]
        assert body["id"].endswith(f"/iiif/3/media/{m.media_id}/full/max/0/default.jpg")
        assert body["service"][0]["id"].endswith(f"/iiif/3/media/{m.media_id}")
        assert (body["width"], body["height"]) == (3000, 2250)
        assert (canvas["width"], canvas["height"]) == (4000, 3000)

    def test_object_manifest(self, client, db_session, org):
        obj, m = _public(db_session, org)
        resp = client.get(f"/iiif/3/{obj.object_id}/manifest.json")
        assert resp.status_code == 200
        text = _body(resp).decode()
        assert "iiif.example.com" not in text  # the image server itself
        assert MASTER not in text
        manifest = _json(resp)
        self._assert_public_image(manifest["items"][0], m)

    def test_object_manifest_skips_image_without_rendition(self, client, db_session, org):
        obj, m = _public(db_session, org)
        bare = _media(db_session, org, rendition=False)
        _link(db_session, obj, bare)
        manifest = _json(client.get(f"/iiif/3/{obj.object_id}/manifest.json"))
        assert len(manifest["items"]) == 1
        assert str(bare.media_id) not in json.dumps(manifest)

    def test_lod_manifest_and_canvas(self, client, db_session, org):
        obj, m = _public(db_session, org)
        from app.services.iiif_lod import IIIFLODService

        public_id = IIIFLODService._slugify(obj.object_number)
        resp = client.get(f"/org/{org.slug}/object/{public_id}/manifest")
        assert resp.status_code == 200
        text = _body(resp).decode()
        assert "iiif.example.com" not in text
        assert MASTER not in text
        self._assert_public_image(_json(resp)["items"][0], m)

        canvas = _json(client.get(f"/org/{org.slug}/object/{public_id}/canvas/1"))
        self._assert_public_image(canvas, m)

    def test_media_lod_url_is_the_public_service(self, client, db_session, org):
        _, m = _public(db_session, org)
        data = _json(client.get(f"/org/{org.slug}/media/{m.media_id}"))
        assert data["url"].endswith(f"/iiif/3/media/{m.media_id}/info.json")

    def test_staff_manifest_is_unchanged(self, auth_setup):
        """Authenticated manifests still use the image server directly."""
        from app.database import current_session

        auth_client, staff_org, _ = auth_setup
        db = current_session()
        obj, m = _public(db, staff_org)
        db.commit()
        resp = auth_client.get(
            f"/api/organizations/{staff_org.organization_id}/iiif/objects/{obj.object_id}/manifest.json"
        )
        assert resp.status_code == 200
        body = _json(resp)["items"][0]["items"][0]["items"][0]["body"]
        assert body["service"][0]["id"].startswith("https://iiif.example.com/iiif/3/")
        assert unquote(body["service"][0]["id"]).endswith(f"{staff_org.organization_id}/{m.media_id}")


# ---------------------------------------------------------------------------
# Unit
# ---------------------------------------------------------------------------


class TestSource:
    def test_master_is_never_a_source(self, db_session, org):
        m = _media(db_session, org, rendition=False)
        assert pub.public_iiif_source(m) is None

    def test_rendition_order(self, db_session, org):
        from app.models import MediaDerivative

        m = _media(db_session, org, rendition=False)
        for kind, w in (("small", 400), ("large", 2000), ("medium", 1000)):
            db_session.add(MediaDerivative(
                media_id=m.media_id, organization_id=org.organization_id,
                derivative_type=kind, format="jpeg", s3_key=f"k/{kind}.jpeg",
                width=w, height=w, file_size=1,
            ))
        db_session.flush()
        db_session.refresh(m)
        assert pub.public_iiif_source(m).s3_key == "k/large.jpeg"
