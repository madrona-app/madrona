"""Anonymous routes: Discover gates on objects, renditions instead of masters.

Every route reachable without signing in that names or describes a
collection object must apply the Discover gates (discoverable, not deleted,
not hidden as deaccessioned), and every image it signs must be a rendition —
the uploaded master only when that file's public download level allows
originals. Covered here, beyond the Discover API itself:

* IIIF: /iiif/3/{id}/manifest.json, /iiif/3/collection/.../manifest.json,
  /org/{slug}/collection/..., /org/{slug}/activity, /org/{slug}/media/{id}
* JSON-LD: /api/public/v1/organizations/{org}/objects/{id}/jsonld and the
  URI resolver's object loader
* social preview tags (/c/...), CMS image blocks, Discover logos/heroes,
  chat object-card thumbnails, the content sitemap
"""

import ast
import json
import uuid
from datetime import date
from pathlib import Path
from unittest.mock import patch

import pytest

MASTER = "MASTER-DO-NOT-SERVE"
SECRET = "Internal: shelf 4, vault B"


def _fake_url(key, **kw):
    return f"https://media.test/{key}"


@pytest.fixture(autouse=True)
def fake_signing():
    targets = (
        "app.services.discover_media.get_org_media_url",
        "app.services.iiif_presentation.get_org_media_url",
        "app.services.discovery_service.get_org_media_url",
        "app.fastapi_app.routers.content_public.get_org_media_url",
    )
    patches = [patch(t, side_effect=_fake_url) for t in targets]
    for p in patches:
        p.start()
    with patch("app.fastapi_app.routers.discover_public.pub_cache_get", return_value=None), \
            patch("app.fastapi_app.routers.discover_public.pub_cache_set"), \
            patch("app.fastapi_app.routers.content_public.pub_cache_get", return_value=None), \
            patch("app.fastapi_app.routers.content_public.pub_cache_set"):
        yield
    for p in patches:
        p.stop()


@pytest.fixture()
def org(db_session):
    from app.models import Organization

    o = Organization(
        name="Gate Museum", slug=f"gate-{uuid.uuid4().hex[:8]}", status="active", is_demo=False,
    )
    db_session.add(o)
    db_session.flush()
    return o


def _obj(db, org, **kw):
    from app.models import CollectionObject, ObjectTitle

    o = CollectionObject(
        organization_id=org.organization_id,
        object_number=kw.pop("object_number", f"G.{uuid.uuid4().hex[:6]}"),
        object_name="Braille watch",
        brief_description=kw.pop("brief_description", "A tactile watch"),
        is_discoverable=kw.pop("is_discoverable", True),
        **kw,
    )
    db.add(o)
    db.flush()
    db.add(ObjectTitle(
        organization_id=org.organization_id, object_id=o.object_id,
        title=f"Watch {o.object_number}", is_preferred=True,
    ))
    db.flush()
    return o


HIDDEN = {
    "not_discoverable": {"is_discoverable": False},
    "deleted": {"is_deleted": True},
    "deaccessioned": {"object_status": "deaccessioned"},
}


def _media(db, org, *, rendition=True, published=True, **kw):
    from app.models import Media, MediaDerivative

    tag = uuid.uuid4().hex[:8]
    m = Media(
        organization_id=org.organization_id,
        filename=f"scan-{tag}.tif",
        s3_key=f"orgs/{org.organization_id}/media/{MASTER}-{tag}.tif",
        media_type="image", mime_type="image/tiff", file_size=9_000_000,
        width=4000, height=3000, is_published=published, **kw,
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


def _text(resp):
    return resp.data.decode() if hasattr(resp, "data") else resp.text


def _json(resp):
    return json.loads(_text(resp))


# ---------------------------------------------------------------------------
# IIIF
# ---------------------------------------------------------------------------


class TestIIIFObjectManifest:
    @pytest.mark.parametrize("hidden", ["deleted", "deaccessioned"])
    def test_hidden_object_is_404(self, client, db_session, org, hidden):
        obj = _obj(db_session, org, **HIDDEN[hidden])
        _link(db_session, obj, _media(db_session, org))
        db_session.commit()
        assert client.get(f"/iiif/3/{obj.object_id}/manifest.json").status_code == 404

    def test_image_without_rendition_never_mints_master(self, client, db_session, org):
        obj = _obj(db_session, org)
        _link(db_session, obj, _media(db_session, org, rendition=False))
        db_session.commit()
        resp = client.get(f"/iiif/3/{obj.object_id}/manifest.json")
        assert resp.status_code == 200
        assert MASTER not in _text(resp)
        assert _json(resp)["items"] == []

    def test_rendition_is_served(self, client, db_session, org):
        obj = _obj(db_session, org)
        _link(db_session, obj, _media(db_session, org))
        db_session.commit()
        resp = client.get(f"/iiif/3/{obj.object_id}/manifest.json")
        assert "large.jpeg" in _text(resp)
        assert MASTER not in _text(resp)

    def test_master_when_level_is_originals(self, client, db_session, org):
        obj = _obj(db_session, org)
        _link(db_session, obj, _media(db_session, org, rendition=False, public_download_level="originals"))
        db_session.commit()
        resp = client.get(f"/iiif/3/{obj.object_id}/manifest.json")
        assert MASTER in _text(resp)


class TestIIIFCollections:
    @pytest.mark.parametrize("hidden", ["deleted", "deaccessioned"])
    def test_collection_manifest_drops_hidden(self, client, db_session, org, hidden):
        shown = _obj(db_session, org)
        gone = _obj(db_session, org, **HIDDEN[hidden])
        db_session.commit()
        resp = client.get(
            f"/iiif/3/collection/c1/manifest.json?object_ids={shown.object_id},{gone.object_id}"
        )
        assert resp.status_code == 200
        ids = [i["id"] for i in _json(resp)["items"]]
        assert any(str(shown.object_id) in i for i in ids)
        assert not any(str(gone.object_id) in i for i in ids)

    @pytest.mark.parametrize("hidden", list(HIDDEN))
    def test_lod_collection_by_ids_drops_hidden(self, client, db_session, org, hidden):
        shown = _obj(db_session, org, object_number=f"SHOWN{uuid.uuid4().hex[:4]}")
        gone = _obj(db_session, org, object_number=f"GONE{uuid.uuid4().hex[:4]}", **HIDDEN[hidden])
        db_session.commit()
        resp = client.get(
            f"/org/{org.slug}/collection/c1?object_ids={shown.object_number.lower()},{gone.object_number.lower()}"
        )
        assert resp.status_code == 200
        body = _text(resp)
        assert shown.object_number.lower() in body
        assert gone.object_number.lower() not in body

    @pytest.mark.parametrize("hidden", ["deleted", "deaccessioned"])
    def test_lod_collection_listing_and_activity_drop_hidden(self, client, db_session, org, hidden):
        shown = _obj(db_session, org, object_number=f"SHOWN{uuid.uuid4().hex[:4]}")
        gone = _obj(db_session, org, object_number=f"GONE{uuid.uuid4().hex[:4]}", **HIDDEN[hidden])
        db_session.commit()
        for path in (f"/org/{org.slug}/collection/c1", f"/org/{org.slug}/activity"):
            resp = client.get(path)
            assert resp.status_code == 200, path
            body = _text(resp)
            assert shown.object_number.lower() in body, path
            assert gone.object_number.lower() not in body, path

    @pytest.mark.parametrize("hidden", list(HIDDEN))
    def test_media_lod_names_only_public_parents(self, client, db_session, org, hidden):
        shown = _obj(db_session, org, object_number=f"SHOWN{uuid.uuid4().hex[:4]}")
        gone = _obj(db_session, org, object_number=f"GONE{uuid.uuid4().hex[:4]}", **HIDDEN[hidden])
        media = _media(db_session, org)
        _link(db_session, shown, media)
        _link(db_session, gone, media, primary=False)
        db_session.commit()
        resp = client.get(f"/org/{org.slug}/media/{media.media_id}")
        assert resp.status_code == 200
        parents = [p["@id"] for p in _json(resp).get("isPartOf", [])]
        assert any(shown.object_number.lower() in p for p in parents)
        assert not any(gone.object_number.lower() in p for p in parents)


# ---------------------------------------------------------------------------
# JSON-LD
# ---------------------------------------------------------------------------


class TestPublicJsonLd:
    def _url(self, org, obj):
        return f"/api/public/v1/organizations/{org.organization_id}/objects/{obj.object_id}/jsonld"

    @pytest.mark.parametrize("hidden", list(HIDDEN))
    def test_hidden_object_is_404(self, client, db_session, org, hidden):
        obj = _obj(db_session, org, **HIDDEN[hidden])
        db_session.commit()
        assert client.get(self._url(org, obj)).status_code == 404

    def test_public_field_set_applies(self, client, db_session, org):
        from app.models import DiscoverConfig
        from app.services.public_object_fields import FIELD_CATALOG

        keys = [f.key for f in FIELD_CATALOG if f.default and f.key not in ("brief_description", "provenance")]
        db_session.add(DiscoverConfig(organization_id=org.organization_id, public_object_fields=keys))
        obj = _obj(db_session, org, brief_description=SECRET, provenance=SECRET,
                   credit_line="Gift of the Federation", acquisition_method="purchase")
        db_session.commit()
        resp = client.get(self._url(org, obj))
        assert resp.status_code == 200
        body = _text(resp)
        assert SECRET not in body
        assert '"acquisitionMethod":"purchase"' not in body.replace(" ", "")
        assert "Gift of the Federation" in body

    def test_unpublished_media_links_survive_the_request(self, client, db_session, org):
        from app.models import CollectionObjectMedia

        obj = _obj(db_session, org)
        _link(db_session, obj, _media(db_session, org))
        _link(db_session, obj, _media(db_session, org, published=False), primary=False)
        db_session.commit()
        assert client.get(self._url(org, obj)).status_code == 200
        db_session.expire_all()
        count = db_session.query(CollectionObjectMedia).filter_by(object_id=obj.object_id).count()
        assert count == 2

    @pytest.mark.parametrize("hidden", list(HIDDEN))
    def test_uri_resolver_object_loader(self, db_session, org, hidden):
        from app.serializers.uri_resolution import load_collection_object

        shown = _obj(db_session, org)
        gone = _obj(db_session, org, **HIDDEN[hidden])
        db_session.commit()
        assert load_collection_object(shown.object_id, "application/json", org.slug)
        assert load_collection_object(gone.object_id, "application/json", org.slug) is None


# ---------------------------------------------------------------------------
# Social preview tags, CMS blocks, Discover images, card thumbnails, sitemap
# ---------------------------------------------------------------------------


INDEX_HTML = "<html><head><title>x</title></head><body></body></html>"


@pytest.fixture()
def ssr_html(monkeypatch, tmp_path):
    from app.fastapi_app.routers import discover_ssr

    index = tmp_path / "index.html"
    index.write_text(INDEX_HTML)
    monkeypatch.setenv("FRONTEND_DIST_PATH", str(index))
    monkeypatch.setattr(discover_ssr, "_index_html_cache", INDEX_HTML)


class TestSocialPreview:
    def test_og_image_is_a_rendition(self, client, db_session, org, ssr_html):
        obj = _obj(db_session, org)
        _link(db_session, obj, _media(db_session, org))
        db_session.commit()
        resp = client.get(f"/c/{org.slug}/objects/{obj.object_number}")
        assert resp.status_code == 200
        assert "large.jpeg" in _text(resp)
        assert MASTER not in _text(resp)

    def test_og_image_never_the_master(self, client, db_session, org, ssr_html):
        obj = _obj(db_session, org)
        _link(db_session, obj, _media(db_session, org, rendition=False))
        db_session.commit()
        resp = client.get(f"/c/{org.slug}/objects/{obj.object_number}")
        assert resp.status_code == 200
        assert MASTER not in _text(resp)

    def test_deleted_object_has_no_preview(self, client, db_session, org, ssr_html):
        obj = _obj(db_session, org, is_deleted=True)
        db_session.commit()
        assert client.get(f"/c/{org.slug}/objects/{obj.object_number}").status_code == 404

    def test_non_public_exhibition_has_no_preview(self, client, db_session, org, ssr_html):
        from app.models import Exhibition

        db_session.add(Exhibition(
            organization_id=org.organization_id, title=SECRET, status="open",
            exhibition_type="temporary", is_public=False, public_url_slug="secret-show",
            planned_start_date=date.today(),
        ))
        db_session.commit()
        resp = client.get(f"/c/{org.slug}/exhibitions/secret-show")
        assert resp.status_code == 404
        assert SECRET not in _text(resp)


class TestCmsImageBlocks:
    def test_block_image_is_a_rendition(self, db_session, org):
        from app.fastapi_app.routers.content_public import _build_block_srcset

        media = _media(db_session, org)
        url, _ = _build_block_srcset(db_session, media.media_id, org.organization_id)
        assert url and "large.jpeg" in url

    def test_block_image_never_the_master(self, db_session, org):
        from app.fastapi_app.routers.content_public import _build_block_srcset

        media = _media(db_session, org, rendition=False)
        url, _ = _build_block_srcset(db_session, media.media_id, org.organization_id)
        assert url is None

    def test_block_cannot_name_another_orgs_media(self, db_session, org):
        from app.fastapi_app.routers.content_public import _build_block_srcset
        from app.models import Organization

        other = Organization(name="Other", slug=f"o-{uuid.uuid4().hex[:8]}", status="active")
        db_session.add(other)
        db_session.flush()
        foreign = _media(db_session, other)
        assert _build_block_srcset(db_session, foreign.media_id, org.organization_id) == (None, None)


class TestDiscoverImages:
    def test_logo_is_a_rendition_and_never_the_master(self, client, db_session, org):
        from app.models import DiscoverConfig

        logo = _media(db_session, org)
        bare = _media(db_session, org, rendition=False)
        db_session.add(DiscoverConfig(
            organization_id=org.organization_id,
            header_logo_media_id=logo.media_id, footer_logo_media_id=bare.media_id,
        ))
        db_session.commit()
        resp = client.get(f"/api/discover/{org.slug}/info")
        assert resp.status_code == 200
        data = _json(resp)
        assert "large.jpeg" in data["header_logo_url"]
        assert data["footer_logo_url"] is None
        assert MASTER not in _text(resp)

    def test_media_url_helper_is_org_scoped(self, db_session, org):
        from app.models import Organization
        from app.services.discovery_service import get_media_url

        other = Organization(name="Other", slug=f"o-{uuid.uuid4().hex[:8]}", status="active")
        db_session.add(other)
        db_session.flush()
        foreign = _media(db_session, other)
        assert get_media_url(foreign.media_id, org.organization_id, db_session) is None

    def test_card_thumbnails_never_the_master(self, db_session, org):
        from app.services.discovery_service import get_object_card_thumbnails

        obj = _obj(db_session, org)
        _link(db_session, obj, _media(db_session, org, rendition=False))
        db_session.flush()
        assert get_object_card_thumbnails([obj.object_id], org.organization_id, db_session) == {}

    def test_featured_and_info_count_skip_deleted(self, client, db_session, org):
        from app.models import DiscoverConfig

        shown = _obj(db_session, org)
        gone = _obj(db_session, org, is_deleted=True)
        db_session.add(DiscoverConfig(
            organization_id=org.organization_id, show_object_count=True,
            featured_object_ids=[str(shown.object_id), str(gone.object_id)],
        ))
        db_session.commit()
        info = _json(client.get(f"/api/discover/{org.slug}/info"))
        assert info["total_discoverable"] == 1
        featured = _json(client.get(f"/api/discover/{org.slug}/featured"))
        assert [h["object_id"] for h in featured["hits"]] == [str(shown.object_id)]


class TestSitemap:
    def test_sitemap_skips_deleted_objects(self, client, db_session, org):
        shown = _obj(db_session, org, object_number=f"SHOWN{uuid.uuid4().hex[:4]}")
        gone = _obj(db_session, org, object_number=f"GONE{uuid.uuid4().hex[:4]}", is_deleted=True)
        db_session.commit()
        resp = client.get(f"/api/content/{org.slug}/sitemap.xml")
        assert resp.status_code == 200
        assert shown.object_number in _text(resp)
        assert gone.object_number not in _text(resp)


# ---------------------------------------------------------------------------
# Static guard: no anonymous module hands a master key to the URL signer
# ---------------------------------------------------------------------------

APP = Path(__file__).resolve().parent.parent / "app"
ANONYMOUS_MODULES = (
    "fastapi_app/routers/discover_public.py",
    "fastapi_app/routers/discover_ssr.py",
    "fastapi_app/routers/content_public.py",
    "fastapi_app/routers/dam_public.py",
    "fastapi_app/routers/media_iiif.py",
    "fastapi_app/routers/lod_exports.py",
    "fastapi_app/routers/mcp_server.py",
    "services/discovery_service.py",
    "serializers/dam_public.py",
    "serializers/uri_resolution.py",
)


@pytest.mark.parametrize("module", ANONYMOUS_MODULES)
def test_no_master_key_reaches_the_signer(module):
    path = APP / module
    assert path.exists(), f"{module} moved; update this guard"
    bad = []
    for node in ast.walk(ast.parse(path.read_text())):
        if not isinstance(node, ast.Call):
            continue
        fn = node.func
        name = fn.attr if isinstance(fn, ast.Attribute) else getattr(fn, "id", None)
        if name not in ("get_org_media_url", "get_org_media_url_byob"):
            continue
        for arg in node.args[:1]:
            if (
                isinstance(arg, ast.Attribute)
                and arg.attr == "s3_key"
                and isinstance(arg.value, ast.Name)
                and arg.value.id in {"media", "Media", "row", "m"}
            ):
                bad.append(node.lineno)
    assert not bad, (
        f"{module} signs a media master key directly at line(s) {bad}; "
        "use discover_media.sign_public_image (a rendition)."
    )
