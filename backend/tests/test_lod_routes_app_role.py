"""Anonymous LOD / IIIF / JSON-LD routes under the production database roles.

Every other test of these routes runs on the superuser connection, which
bypasses row-level security, so it could not tell whether the routes work in
production. Here ``rls_client`` hands ``get_db`` requests the app role
(``madrona_app``, NOBYPASSRLS) and ``get_admin_db`` requests the owner role,
as production does.

The LOD routes used to run on ``get_db``. Anonymous requests set no org
context, so under the app role every org-scoped read came back empty — the
organization lookup by slug included — and the routes 404'd for public
records too. They now run on the owner session like the rest of the public
surface (Discover, /iiif/3/), with every query scoped to the organization in
the URL and the Discover gates applied in code. These tests pin all three
properties: a public record renders, another organization's records never
come back through this organization's URLs, and unpublished or
non-discoverable records stay hidden.
"""

import json
import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import text

from app.services.uri_persistence import BASE_URI

MASTER = "MASTER-DO-NOT-SERVE"


def _seed_org(db, label):
    from app.models import (
        CollectionObject, CollectionObjectMedia, Media, MediaDerivative, ObjectTitle,
        Organization, URIRegistry,
    )
    from app.models.contacts import Constituent

    org = Organization(name=f"Museum {label}", slug=f"lod-{label}-{uuid.uuid4().hex[:6]}",
                       status="active", is_demo=False)
    db.add(org)
    db.flush()
    oid = org.organization_id

    def obj(number, **kw):
        o = CollectionObject(organization_id=oid, object_number=number, object_name=f"Object {number}",
                             is_discoverable=kw.pop("is_discoverable", True), **kw)
        db.add(o)
        db.flush()
        db.add(ObjectTitle(organization_id=oid, object_id=o.object_id,
                           title=f"{label} title {number}", is_preferred=True))
        db.flush()
        return o

    def media(published=True):
        m = Media(organization_id=oid, filename="scan.tif",
                  s3_key=f"orgs/{oid}/media/{MASTER}-{uuid.uuid4().hex[:6]}.tif",
                  media_type="image", mime_type="image/tiff", file_size=1_000,
                  width=6000, height=4000, is_published=published, title=f"{label} image")
        db.add(m)
        db.flush()
        db.add(MediaDerivative(media_id=m.media_id, organization_id=oid, derivative_type="large",
                               format="jpeg", s3_key=f"orgs/{oid}/media/derivatives/{m.media_id}/large.jpeg",
                               width=2000, height=1333, file_size=100))
        db.flush()
        return m

    def link(o, m, primary=True, order=0):
        db.add(CollectionObjectMedia(object_id=o.object_id, media_id=m.media_id,
                                     is_primary=primary, sort_order=order))
        db.flush()

    # The same object number in both orgs, so a lookup that ignores the org
    # in the URL can land on the other org's record.
    public = obj("2024.1")
    shown, hidden_media = media(), media(published=False)
    link(public, shown)
    link(public, hidden_media, primary=False, order=1)

    private = obj("2024.2", is_discoverable=False)
    private_media = media()
    link(private, private_media)

    from app.models.contacts import ConstituentXref

    person = Constituent(organization_id=oid, constituent_type="person", name=f"{label} Donor",
                         biography="Private donor notes")
    artist = Constituent(organization_id=oid, constituent_type="person", name=f"{label} Artist",
                         nationality="Dutch")
    hidden_artist = Constituent(organization_id=oid, constituent_type="person", name=f"{label} Hidden",
                                biography="Only on a private record")
    db.add_all([person, artist, hidden_artist])
    db.flush()
    for c, o, role in ((person, public, "donor"), (artist, public, "artist"), (hidden_artist, private, "creator")):
        db.add(ConstituentXref(organization_id=oid, constituent_id=c.constituent_id,
                               entity_type="collection_object", entity_id=o.object_id, role=role))
    db.flush()

    for etype, eid, pid in (
        ("collection_object", public.object_id, "2024-1"),
        ("collection_object", private.object_id, "2024-2"),
        ("person_authority", person.constituent_id, f"donor-{label}"),
        ("person_authority", artist.constituent_id, f"artist-{label}"),
        ("person_authority", hidden_artist.constituent_id, f"hidden-{label}"),
        ("media", shown.media_id, str(shown.media_id)),
    ):
        segment = {"collection_object": "object", "person_authority": "agent", "media": "media"}[etype]
        db.add(URIRegistry(organization_id=oid, entity_type=etype, entity_id=eid, public_id=pid,
                           full_uri=f"{BASE_URI}/org/{org.slug}/{segment}/{pid}", status="active"))
    db.flush()

    return SimpleNamespace(org=org, slug=org.slug, public=public, private=private,
                           shown=shown, hidden_media=hidden_media, private_media=private_media,
                           person=person, artist=artist, label=label)


@pytest.fixture
def tenants(rls_db_session):
    from tests.conftest import _RLS_TEST_ROLE

    connection = rls_db_session.connection()
    connection.execute(text("RESET ROLE"))
    try:
        a = _seed_org(rls_db_session, "alpha")
        b = _seed_org(rls_db_session, "beta")
        rls_db_session.commit()
    finally:
        connection.execute(text(f"SET ROLE {_RLS_TEST_ROLE}"))
    return a, b


def _text(resp):
    return resp.data.decode() if hasattr(resp, "data") else resp.text


def _json(resp):
    return json.loads(_text(resp))


def test_app_role_really_is_restricted(rls_db_session, tenants):
    """Sanity: with no org context the app role sees none of the seeded rows,
    which is what the routes used to run into."""
    a, _ = tenants
    assert rls_db_session.execute(text("SELECT current_user")).scalar() == "madrona_app"
    assert rls_db_session.execute(
        text("SELECT count(*) FROM public.organizations WHERE organization_id = :o"),
        {"o": str(a.org.organization_id)},
    ).scalar() == 0


# ---------------------------------------------------------------------------
# A public record renders
# ---------------------------------------------------------------------------


class TestPublicRecordsRender:
    def test_object_manifest(self, rls_client, tenants):
        a, _ = tenants
        for path in ("2024-1/manifest", "2024-1/manifest.json", "2024-1"):
            resp = rls_client.get(f"/org/{a.slug}/object/{path}", headers={"Accept": "application/ld+json"})
            assert resp.status_code == 200, (path, _text(resp)[:200])
            manifest = _json(resp)
            assert manifest["type"] == "Manifest"
            assert len(manifest["items"]) == 1  # published media only
            assert "alpha title 2024.1" in _text(resp)

    def test_object_manifest_without_registry_record(self, rls_client, rls_db_session, tenants):
        """Fallback lookup by slugified object number."""
        a, _ = tenants
        resp = rls_client.get(f"/org/{a.slug}/object/2024-1/manifest")
        assert resp.status_code == 200

    def test_canvas(self, rls_client, tenants):
        a, _ = tenants
        resp = rls_client.get(f"/org/{a.slug}/object/2024-1/canvas/1")
        assert resp.status_code == 200, _text(resp)[:200]
        assert _json(resp)["type"] == "Canvas"
        assert rls_client.get(f"/org/{a.slug}/object/2024-1/canvas/2").status_code == 404

    def test_collection_and_activity(self, rls_client, tenants):
        a, _ = tenants
        coll = rls_client.get(f"/org/{a.slug}/collection/all")
        assert coll.status_code == 200, _text(coll)[:200]
        assert len(_json(coll)["items"]) == 1
        named = rls_client.get(f"/org/{a.slug}/collection/c?object_ids=2024-1,2024-2")
        assert len(_json(named)["items"]) == 1
        act = rls_client.get(f"/org/{a.slug}/activity")
        assert act.status_code == 200, _text(act)[:200]
        assert _json(act)["totalItems"] == 1

    def test_media_lod(self, rls_client, tenants):
        a, _ = tenants
        resp = rls_client.get(f"/org/{a.slug}/media/{a.shown.media_id}")
        assert resp.status_code == 200, _text(resp)[:200]
        data = _json(resp)
        assert data["@type"] == "ImageObject"
        assert [p["@id"] for p in data["isPartOf"]] == [f"{BASE_URI}/org/{a.slug}/object/2024-1"]

    def test_public_jsonld(self, rls_client, tenants):
        a, _ = tenants
        resp = rls_client.get(
            f"/api/public/v1/organizations/{a.org.organization_id}/objects/{a.public.object_id}/jsonld")
        assert resp.status_code == 200, _text(resp)[:200]
        assert "alpha title 2024.1" in _text(resp)

    def test_uri_resolver_and_head(self, rls_client, tenants):
        """The generic resolver (segments other than object/media, which
        media_iiif answers): a creator of a public object is public."""
        a, _ = tenants
        resp = rls_client.get(f"/org/{a.slug}/agent/artist-alpha", headers={"Accept": "application/json"})
        assert resp.status_code == 200, _text(resp)[:200]
        assert _json(resp)["preferred_name"] == "alpha Artist"
        ld = rls_client.get(f"/org/{a.slug}/agent/artist-alpha", headers={"Accept": "application/ld+json"})
        assert _json(ld)["@type"] == "Person"
        html = rls_client.get(f"/org/{a.slug}/agent/artist-alpha", headers={"Accept": "text/html"})
        assert html.status_code == 303
        assert rls_client.head(f"/org/{a.slug}/agent/artist-alpha").status_code == 200
        assert rls_client.get(f"/org/{a.slug}/agent/artist-alpha/history").status_code == 200

    def test_iiif3_routes(self, rls_client, tenants):
        a, _ = tenants
        assert rls_client.get(f"/iiif/3/{a.public.object_id}/manifest.json").status_code == 200
        assert rls_client.get(f"/iiif/3/media/{a.shown.media_id}/info.json").status_code == 200

    def test_uri_history(self, rls_client, tenants):
        a, _ = tenants
        resp = rls_client.get(f"/org/{a.slug}/media/{a.shown.media_id}/history")
        assert resp.status_code == 200, _text(resp)[:200]
        assert _json(resp)["entity_id"] == str(a.shown.media_id)


# ---------------------------------------------------------------------------
# Another organization's records never come back
# ---------------------------------------------------------------------------


class TestNoCrossOrg:
    def test_object_number_resolves_in_the_url_org_only(self, rls_client, tenants):
        a, b = tenants
        text_a = _text(rls_client.get(f"/org/{a.slug}/object/2024-1/manifest"))
        assert "alpha title" in text_a and "beta" not in text_a
        text_b = _text(rls_client.get(f"/org/{b.slug}/object/2024-1/manifest"))
        assert "beta title" in text_b and "alpha" not in text_b

    def test_media_of_another_org(self, rls_client, tenants):
        a, b = tenants
        assert rls_client.get(f"/org/{a.slug}/media/{b.shown.media_id}").status_code == 404
        assert rls_client.get(f"/org/{a.slug}/media/{b.shown.media_id}/history").status_code == 404

    def test_jsonld_of_another_org(self, rls_client, tenants):
        a, b = tenants
        resp = rls_client.get(
            f"/api/public/v1/organizations/{a.org.organization_id}/objects/{b.public.object_id}/jsonld")
        assert resp.status_code == 404

    def test_collection_names_only_own_objects(self, rls_client, tenants):
        a, b = tenants
        data = _json(rls_client.get(f"/org/{a.slug}/collection/all"))
        assert "beta" not in json.dumps(data)

    def test_resolver_fallback_does_not_cross_orgs(self, rls_client, tenants):
        """The resolver's fallback matched public_id + entity_type with no
        org at all, so org A's URL could resolve org B's record."""
        a, b = tenants
        assert rls_client.get(f"/org/{b.slug}/agent/artist-beta", headers={"Accept": "application/json"}).status_code == 200
        resp = rls_client.get(f"/org/{a.slug}/agent/artist-beta", headers={"Accept": "application/json"})
        assert resp.status_code == 404
        assert rls_client.head(f"/org/{a.slug}/agent/artist-beta").status_code == 404
        assert rls_client.get(f"/org/{a.slug}/agent/artist-beta/history").status_code == 404

    def test_unknown_org(self, rls_client, tenants):
        a, _ = tenants
        assert rls_client.get("/org/no-such-org/object/2024-1/manifest").status_code == 404
        assert rls_client.get(f"/org/no-such-org/media/{a.shown.media_id}").status_code == 404


# ---------------------------------------------------------------------------
# Unpublished and non-discoverable stay hidden
# ---------------------------------------------------------------------------


class TestHiddenStaysHidden:
    def test_non_discoverable_object(self, rls_client, tenants):
        a, _ = tenants
        for path in ("2024-2/manifest", "2024-2/canvas/1"):
            assert rls_client.get(f"/org/{a.slug}/object/{path}").status_code == 404, path
        resp = rls_client.get(
            f"/api/public/v1/organizations/{a.org.organization_id}/objects/{a.private.object_id}/jsonld")
        assert resp.status_code == 404

    def test_unpublished_media(self, rls_client, tenants):
        a, _ = tenants
        assert rls_client.get(f"/org/{a.slug}/media/{a.hidden_media.media_id}").status_code == 404
        assert rls_client.get(f"/iiif/3/media/{a.hidden_media.media_id}/info.json").status_code == 404
        manifest = _text(rls_client.get(f"/org/{a.slug}/object/2024-1/manifest"))
        assert str(a.hidden_media.media_id) not in manifest

    def test_media_of_a_private_object(self, rls_client, tenants):
        """Published, but only linked to a non-discoverable object."""
        a, _ = tenants
        assert rls_client.get(f"/org/{a.slug}/media/{a.private_media.media_id}").status_code == 404
        assert rls_client.get(f"/iiif/3/media/{a.private_media.media_id}/info.json").status_code == 404

    @pytest.mark.parametrize("pid", ["donor-alpha", "hidden-alpha"])
    def test_non_creator_and_private_creator_are_not_public(self, rls_client, tenants, pid):
        """Constituents include donors and lenders; only a creator of a public
        object resolves. A donor of a public object, and the creator of a
        non-discoverable one, are 404 in every representation."""
        a, _ = tenants
        for accept in ("application/json", "application/ld+json", "text/html"):
            resp = rls_client.get(f"/org/{a.slug}/agent/{pid}", headers={"Accept": accept})
            assert resp.status_code == 404, accept
            assert "Private donor notes" not in _text(resp)
            assert "Only on a private record" not in _text(resp)
        assert rls_client.head(f"/org/{a.slug}/agent/{pid}").status_code == 404
        assert rls_client.get(f"/org/{a.slug}/agent/{pid}/history").status_code == 404

    def test_creators_hidden_when_the_field_is_not_public(self, rls_client, rls_db_session, tenants):
        from app.models import DiscoverConfig
        from tests.conftest import _RLS_TEST_ROLE

        a, _ = tenants
        connection = rls_db_session.connection()
        connection.execute(text("RESET ROLE"))
        try:
            rls_db_session.add(DiscoverConfig(organization_id=a.org.organization_id,
                                              public_object_fields=["brief_description"]))
            rls_db_session.commit()
        finally:
            connection.execute(text(f"SET ROLE {_RLS_TEST_ROLE}"))
        resp = rls_client.get(f"/org/{a.slug}/agent/artist-alpha", headers={"Accept": "application/json"})
        assert resp.status_code == 404

    def test_master_never_appears(self, rls_client, tenants):
        a, _ = tenants
        for path in (f"/org/{a.slug}/object/2024-1/manifest", f"/org/{a.slug}/object/2024-1/canvas/1",
                     f"/org/{a.slug}/media/{a.shown.media_id}"):
            assert MASTER not in _text(rls_client.get(path)), path
