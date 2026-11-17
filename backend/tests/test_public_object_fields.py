"""
Admin-configurable public object fields (Collections configuration > Public
Fields; services/public_object_fields.py).

Invariants under test:
  * with no saved choice the public field set is the defaults, and the
    record page and exports carry exactly what they carried before;
  * a field switched off disappears from every public output path: Discover
    object detail, search hits (and its search fields, filters and facets),
    related/featured/exhibition cards, CSV/JSON exports, the social preview
    tags, the URI resolver, the public DAM API and the LOD IIIF manifest;
  * only allowlisted descriptive fields can be enabled (422 otherwise), and
    locked fields stay public;
  * changing the setting needs discover.publish or org.manage_settings;
  * one organization's choice never touches another's, including under the
    NOBYPASSRLS application role.
"""

from __future__ import annotations

import csv
import io
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy import text

from app.models import CollectionObject, DiscoverConfig, ObjectTitle, Organization
from app.services import public_object_fields as pof

HIDDEN = "HIDDEN-PROVENANCE-9b1c"
MAKER = "Hidden Maker 42"


def _url(org_id):
    return f"/api/organizations/{org_id}/collections/discover/public-fields"


def _activate_slug(db, org_id, slug):
    # Unique per run: public responses are cached by slug (Redis, if running).
    slug = f"{slug}-{uuid.uuid4().hex[:8]}"
    org = db.query(Organization).filter_by(organization_id=org_id).one()
    org.slug = slug
    db.commit()
    return slug


def _obj(db, org_id, title="Public Painting", **kw):
    defaults = dict(
        organization_id=org_id,
        object_number=f"PF-{uuid.uuid4().hex[:6].upper()}",
        is_discoverable=True,
        brief_description="A brief public description",
        provenance=HIDDEN,
        creators=[{"name": MAKER, "role": "artist"}],
        creation_date_display="1901",
        object_type="painting",
        object_name="painting",
        subjects=["landscapes"],
        physical_description="Oil on canvas, varnished",
        edition="3/50",
        credit_line="Gift of a friend",
        current_value=1_000_000,
    )
    defaults.update(kw)
    obj = CollectionObject(**defaults)
    db.add(obj)
    db.flush()
    db.add(ObjectTitle(organization_id=org_id, object_id=obj.object_id, title=title, is_preferred=True))
    db.commit()
    return obj


def _search_service(objects, facets=None):
    """A fake collections search service; records the requests it gets."""
    from app.search.collections.schemas import CollectionsSearchHit, Facet, FacetBucket

    calls = []

    def search(req, org_id, db_session=None):
        calls.append(req)
        page = objects[req.offset:req.offset + req.limit]
        resp = MagicMock()
        resp.hits = [
            CollectionsSearchHit(
                object_id=str(o.object_id), object_number=o.object_number, title="Public Painting",
                brief_description=o.brief_description, object_type=o.object_type,
                classification=None, creators=o.creators,
                creation_date={"display": o.creation_date_display},
            )
            for o in page
        ]
        resp.total = len(objects)
        resp.facets = [
            Facet(field=name, buckets=[FacetBucket(key=key, doc_count=1)])
            for name, key in (facets or [])
        ]
        resp.next_offset = None
        return resp

    service = MagicMock()
    service.search.side_effect = search
    return service, calls


def _patch_search(service):
    return (
        patch("app.search.collections.service.CollectionsSearchService.is_available", return_value=True),
        patch("app.search.collections.service.get_collections_search_service", return_value=service),
    )


# ---------------------------------------------------------------------------
# The allowlist itself
# ---------------------------------------------------------------------------


class TestCatalog:
    def test_defaults_are_the_previous_record_page_fields(self):
        # The fields the record page published before the setting existed,
        # plus object name and subjects, which Discover already exposed
        # through full-text search and the subject facet.
        before = {
            "object_number", "title", "titles", "brief_description", "full_description",
            "object_type", "classification", "creators", "creation_date", "creation_place",
            "materials", "techniques", "measurements", "inscriptions", "style_period",
            "provenance", "credit_line", "external_links",
        }
        assert pof.DEFAULT_KEYS == before | {"object_name", "subjects"}
        assert pof.resolve_stored(None) == pof.DEFAULT_KEYS

    def test_default_search_fields_are_unchanged(self):
        from app.search.collections.query_builder import CollectionsQueryBuilder

        base = CollectionsQueryBuilder.DEFAULT_SEARCH_FIELDS
        assert pof.search_fields(base, pof.DEFAULT_KEYS) == base

    def test_sensitive_fields_are_not_in_the_catalog(self):
        assert not set(pof.NEVER_PUBLIC) & pof.ALL_KEYS
        for key in ("current_value", "insurance_value", "current_location", "acquisition_source",
                    "comments", "associated_cultural_affinity", "excavation_site"):
            assert key in pof.NEVER_PUBLIC

    def test_non_descriptive_facets_are_never_public(self):
        for facet in ("location", "condition", "object_status", "acquisition_method"):
            assert not pof.facet_public(facet, pof.ALL_KEYS)
        assert pof.facet_public("on_display", frozenset())


# ---------------------------------------------------------------------------
# Settings API
# ---------------------------------------------------------------------------


class TestSettingsApi:
    def test_get_defaults(self, auth_setup):
        client, org, _ = auth_setup
        r = client.get(_url(org.organization_id))
        assert r.status_code == 200, r.text
        data = r.get_json()
        assert data["is_default"] is True
        assert set(data["public_fields"]) == pof.DEFAULT_KEYS
        assert {g["key"] for g in data["groups"]} == {f.group for f in pof.FIELD_CATALOG}
        by_key = {f["key"]: f for f in data["fields"]}
        assert by_key["title"]["locked"] is True and by_key["title"]["public"] is True
        assert by_key["edition"]["public"] is False and by_key["edition"]["default_public"] is False
        assert {n["key"] for n in data["never_public"]} == set(pof.NEVER_PUBLIC)

    def test_put_saves_and_adds_locked_fields(self, auth_setup, db_session):
        client, org, _ = auth_setup
        r = client.put(_url(org.organization_id), json={"public_fields": ["brief_description", "edition"]})
        assert r.status_code == 200, r.text
        data = r.get_json()
        assert data["is_default"] is False
        assert set(data["public_fields"]) == {"brief_description", "edition", "object_number", "title"}
        stored = db_session.query(DiscoverConfig.public_object_fields).filter_by(
            organization_id=org.organization_id).scalar()
        assert set(stored) == {"brief_description", "edition", "object_number", "title"}
        assert client.get(_url(org.organization_id)).get_json()["public_fields"] == data["public_fields"]

    @pytest.mark.parametrize("bad", [["insurance_value"], ["current_location", "title"], ["not_a_field"], [1]])
    def test_non_publishable_field_is_refused(self, auth_setup, db_session, bad):
        client, org, _ = auth_setup
        r = client.put(_url(org.organization_id), json={"public_fields": bad})
        assert r.status_code == 422, r.text
        body = r.get_json()
        assert "can never be made public" in r.text or "not publishable" in r.text or "must be strings" in r.text
        assert body  # error envelope present
        stored = db_session.query(DiscoverConfig.public_object_fields).filter_by(
            organization_id=org.organization_id).scalar()
        assert stored is None

    def test_viewer_can_read_but_not_change(self, viewer_auth_setup):
        client, org, _ = viewer_auth_setup
        assert client.get(_url(org.organization_id)).status_code == 200
        r = client.put(_url(org.organization_id), json={"public_fields": ["title"]})
        assert r.status_code == 403

    def test_additional_fields_listed_with_their_own_flag(self, auth_setup, db_session):
        from app.models import CustomFieldDefinition

        client, org, _ = auth_setup
        db_session.add_all([
            CustomFieldDefinition(organization_id=org.organization_id, entity_type="collection_object",
                                  key="gallery_label", label="Gallery label", field_type="text", is_public=True),
            CustomFieldDefinition(organization_id=org.organization_id, entity_type="collection_object",
                                  key="internal_ref", label="Internal ref", field_type="text", is_public=False),
        ])
        db_session.commit()
        extra = client.get(_url(org.organization_id)).get_json()["additional_fields"]
        assert {(f["key"], f["is_public"]) for f in extra} == {("gallery_label", True), ("internal_ref", False)}


# ---------------------------------------------------------------------------
# Public output paths
# ---------------------------------------------------------------------------


class TestPublicOutputs:
    def _hide(self, client, org_id, *fields):
        keep = [k for k in pof.DEFAULT_KEYS if k not in fields]
        r = client.put(_url(org_id), json={"public_fields": keep})
        assert r.status_code == 200, r.text

    def test_defaults_detail_matches_previous_behaviour(self, auth_setup, client, db_session):
        auth, org, _ = auth_setup
        slug = _activate_slug(db_session, org.organization_id, "pf-default")
        obj = _obj(db_session, org.organization_id)
        d = client.get(f"/api/discover/{slug}/objects/{obj.object_id}").get_json()
        assert d["provenance"] == HIDDEN
        assert d["creators"] == [MAKER]
        assert d["brief_description"] == "A brief public description"
        assert d["credit_line"] == "Gift of a friend"
        # Publishable but off by default.
        assert d["physical_description"] is None and d["edition"] is None
        assert "1000000" not in str(d)

    def test_disabled_field_disappears_from_detail(self, auth_setup, client, db_session):
        auth, org, _ = auth_setup
        slug = _activate_slug(db_session, org.organization_id, "pf-detail")
        obj = _obj(db_session, org.organization_id)
        self._hide(auth, org.organization_id, "provenance", "creators")
        r = client.get(f"/api/discover/{slug}/objects/{obj.object_id}")
        d = r.get_json()
        assert d["provenance"] is None
        assert d["creators"] == []
        assert HIDDEN not in r.text and MAKER not in r.text
        # Unaffected fields are still there.
        assert d["brief_description"] == "A brief public description"
        assert d["title"] == "Public Painting"

    def test_enabled_optional_field_appears(self, auth_setup, client, db_session):
        auth, org, _ = auth_setup
        slug = _activate_slug(db_session, org.organization_id, "pf-optin")
        obj = _obj(db_session, org.organization_id)
        auth.put(_url(org.organization_id), json={"public_fields": sorted(pof.DEFAULT_KEYS | {"edition", "physical_description"})})
        d = client.get(f"/api/discover/{slug}/objects/{obj.object_id}").get_json()
        assert d["edition"] == "3/50"
        assert d["physical_description"] == "Oil on canvas, varnished"

    def test_disabled_field_disappears_from_search(self, auth_setup, client, db_session):
        auth, org, _ = auth_setup
        slug = _activate_slug(db_session, org.organization_id, "pf-search")
        obj = _obj(db_session, org.organization_id)
        self._hide(auth, org.organization_id, "provenance", "creators", "brief_description")
        service, calls = _search_service(
            [obj],
            facets=[("creator", MAKER), ("object_type", "painting"), ("location", "Vault 3"),
                    ("acquisition_method", "purchase"), ("on_display", "true")],
        )
        a, b = _patch_search(service)
        with a, b:
            r = client.get(f"/api/discover/{slug}/search?q=hidden&creator={MAKER}")
        assert r.status_code == 200, r.text
        data = r.get_json()
        hit = data["hits"][0]
        assert hit["creators"] == [] and hit["brief_description"] is None
        assert hit["object_type"] == "painting"
        assert MAKER not in r.text and "Vault 3" not in r.text
        assert {f["field"] for f in data["facets"]} == {"object_type", "on_display"}
        req = calls[0]
        assert "provenance" not in req.query.fields
        assert "creators.name^2" not in req.query.fields
        assert "brief_description" not in req.query.fields
        assert "title^3" in req.query.fields
        # A filter on a hidden field is ignored rather than probing it.
        assert req.filters.creator_name is None
        assert req.filters.is_discoverable is True

    def test_default_search_keeps_filters_and_fields(self, auth_setup, client, db_session):
        from app.search.collections.query_builder import CollectionsQueryBuilder

        auth, org, _ = auth_setup
        slug = _activate_slug(db_session, org.organization_id, "pf-search-default")
        obj = _obj(db_session, org.organization_id)
        service, calls = _search_service([obj], facets=[("creator", MAKER), ("location", "Vault 3")])
        a, b = _patch_search(service)
        with a, b:
            data = client.get(f"/api/discover/{slug}/search?q=x&creator=Someone&sort=date_asc").get_json()
        assert data["hits"][0]["creators"] == [MAKER]
        # Location facets were never meant to be public; only creator remains.
        assert [f["field"] for f in data["facets"]] == ["creator"]
        assert calls[0].query.fields == CollectionsQueryBuilder.DEFAULT_SEARCH_FIELDS
        assert calls[0].filters.creator_name == "Someone"
        assert calls[0].sort.field == "creation_date"

    def test_hidden_date_disables_date_sort(self, auth_setup, client, db_session):
        auth, org, _ = auth_setup
        slug = _activate_slug(db_session, org.organization_id, "pf-sort")
        self._hide(auth, org.organization_id, "creation_date")
        service, calls = _search_service([])
        a, b = _patch_search(service)
        with a, b:
            client.get(f"/api/discover/{slug}/search?sort=date_desc&date_from=1900")
        assert calls[0].sort.field == "_score"
        assert calls[0].filters.date_from is None

    def test_exports_leave_hidden_fields_out(self, auth_setup, client, db_session):
        auth, org, _ = auth_setup
        slug = _activate_slug(db_session, org.organization_id, "pf-export")
        obj = _obj(db_session, org.organization_id)
        self._hide(auth, org.organization_id, "provenance")
        service, _ = _search_service([obj])
        a, b = _patch_search(service)
        with a, b:
            csv_resp = client.get(f"/api/discover/{slug}/search/export?format=csv")
            json_resp = client.get(f"/api/discover/{slug}/search/export?format=json")
        assert csv_resp.status_code == 200
        rows = list(csv.DictReader(io.StringIO(csv_resp.content.decode("utf-8-sig"))))
        assert "Provenance" not in rows[0] and "Creators" in rows[0]
        assert HIDDEN not in csv_resp.text
        objects = json_resp.get_json()["objects"]
        assert "provenance" not in objects[0] and objects[0]["creators"] == [MAKER]

    def test_related_featured_and_exhibition_cards(self, auth_setup, client, db_session):
        from app.models import Exhibition, ExhibitionObject

        auth, org, _ = auth_setup
        slug = _activate_slug(db_session, org.organization_id, "pf-cards")
        obj = _obj(db_session, org.organization_id)
        db_session.add(DiscoverConfig(organization_id=org.organization_id, featured_object_ids=[str(obj.object_id)]))
        exh = Exhibition(organization_id=org.organization_id, title="Show", public_url_slug="show", is_public=True)
        db_session.add(exh)
        db_session.flush()
        db_session.add(ExhibitionObject(exhibition_id=exh.exhibition_id, object_id=obj.object_id, organization_id=org.organization_id))
        db_session.commit()
        self._hide(auth, org.organization_id, "creators", "creation_date")

        featured = client.get(f"/api/discover/{slug}/featured")
        assert featured.get_json()["hits"][0]["creators"] == []
        assert featured.get_json()["hits"][0]["creation_date_display"] is None
        exhibit = client.get(f"/api/discover/{slug}/exhibitions/show")
        assert exhibit.status_code == 200, exhibit.text
        assert MAKER not in exhibit.text

    def test_staff_preview_matches_public_record(self, auth_setup, db_session):
        auth, org, _ = auth_setup
        obj = _obj(db_session, org.organization_id)
        self._hide(auth, org.organization_id, "provenance")
        r = auth.get(f"/api/organizations/{org.organization_id}/collections/objects/{obj.object_id}/discover-preview")
        assert r.status_code == 200, r.text
        assert r.get_json()["provenance"] is None

    def test_uri_resolver_dam_and_lod_manifest(self, auth_setup, db_session):
        from app.serializers.uri_resolution import format_object_json, format_object_jsonld
        from app.services.iiif_lod import get_iiif_lod_service

        auth, org, _ = auth_setup
        obj = _obj(db_session, org.organization_id)
        self._hide(auth, org.organization_id, "creators", "brief_description", "provenance")
        db_session.expire_all()
        obj = db_session.get(CollectionObject, obj.object_id)

        as_json = format_object_json(obj)
        assert as_json["creators"] == [] and as_json["brief_description"] is None
        as_ld = format_object_jsonld(obj, "pf-lod")
        assert as_ld["creator"] is None and as_ld["description"] is None

        org_row = db_session.get(Organization, org.organization_id)
        manifest = get_iiif_lod_service().generate_manifest(obj=obj, media_items=[], organization=org_row, org_slug="pf-lod")
        labels = [e["label"]["en"][0] for e in manifest["metadata"]]
        assert "Creator" not in labels and "Provenance" not in labels
        assert "summary" not in manifest
        assert MAKER not in str(manifest) and HIDDEN not in str(manifest)

    def test_dam_public_object(self, auth_setup, db_session):
        from app.serializers.dam_public import serialize_public_object

        auth, org, _ = auth_setup
        obj = _obj(db_session, org.organization_id)
        self._hide(auth, org.organization_id, "creators", "credit_line")
        db_session.expire_all()
        obj = db_session.get(CollectionObject, obj.object_id)
        with patch("app.serializers.dam_public.current_session", return_value=db_session):
            out = serialize_public_object(obj, include_media=False)
        assert out["creator"] is None and out["credit_line"] is None
        assert out["description"] == "A brief public description"

    def test_aggregated_metadata_drops_non_public_sections(self):
        meta = {
            "object": {"object_id": "1", "object_number": "A", "primary_title": "T", "category": "x",
                       "brief_description": "b", "titles": [{"title": "T"}]},
            "creators": [{"name": MAKER}],
            "dates": {"display": "1901", "earliest": None, "latest": None, "creation_place": "Paris"},
            "subjects": {"terms": ["a"], "depicted_people": [{"name": "Private Person"}], "style_period": "x"},
            "rights": {"credit_line": "c", "copyright_status": "public_domain"},
            "provenance": {"acquisition_method": "purchase"},
            "repository": {"name": "M", "location": {"name": "Vault 3"}},
        }
        out = pof.redact_aggregated_metadata(meta, pof.DEFAULT_KEYS - {"creators"})
        assert out["creators"] == []
        assert "category" not in out["object"]
        assert "provenance" not in out
        assert "location" not in out["repository"]
        assert "depicted_people" not in out["subjects"]
        assert out["rights"]["copyright_status"] == "public_domain"

    def test_social_preview_tags(self, auth_setup, client, db_session):
        auth, org, _ = auth_setup
        slug = _activate_slug(db_session, org.organization_id, "pf-og")
        obj = _obj(db_session, org.organization_id)
        self._hide(auth, org.organization_id, "creators", "brief_description")
        with patch("app.fastapi_app.routers.discover_ssr._read_index_html",
                   return_value="<html><head><title>x</title></head><body></body></html>"):
            r = client.get(f"/c/{slug}/objects/{obj.object_number}")
        assert r.status_code == 200
        assert MAKER not in r.text
        assert "A brief public description" not in r.text

    def test_other_org_unaffected(self, auth_setup, client, db_session):
        auth, org, _ = auth_setup
        other = Organization(name="Other", slug="pf-other", is_demo=False, status="active")
        db_session.add(other)
        db_session.commit()
        other_obj = _obj(db_session, other.organization_id)
        self._hide(auth, org.organization_id, "provenance")
        d = client.get(f"/api/discover/pf-other/objects/{other_obj.object_id}").get_json()
        assert d["provenance"] == HIDDEN
        # (auth_setup's user is a platform admin, who can reach any org; the
        # cross-org write refusal is covered by TestUnderRls with plain staff.)


# ---------------------------------------------------------------------------
# Under the NOBYPASSRLS application role
# ---------------------------------------------------------------------------


def _seed_tenant(session, slug):
    from app.models import OrganizationMembership, Role, User
    from app.services.auth_utils import generate_access_token
    from tests.conftest import _create_permission, _create_role_permission

    org = Organization(name=slug, slug=slug, is_demo=False, status="active")
    session.add(org)
    session.flush()
    role = Role(role_key=f"pub-{slug}", display_name="Publisher", description="", is_system=False)
    session.add(role)
    session.flush()
    for key in ("collections.view", "data.view", "discover.publish"):
        _create_role_permission(session, role, _create_permission(session, key))
    user = User(email=f"pub@{slug}.example.com", password_hash="x", status="active",
                email_verified_at=datetime.now(timezone.utc))
    session.add(user)
    session.flush()
    session.add(OrganizationMembership(organization_id=org.organization_id, user_id=user.user_id,
                                       role="member", role_id=role.role_id, status="active"))
    session.flush()
    return SimpleNamespace(
        org_id=org.organization_id,
        token=generate_access_token(user_id=str(user.user_id), email=user.email,
                                    active_organization_id=str(org.organization_id), expires_minutes=60),
    )


@pytest.fixture
def rls_tenants(rls_db_session):
    from tests.conftest import _RLS_TEST_ROLE

    connection = rls_db_session.connection()
    connection.execute(text("RESET ROLE"))
    try:
        alpha = _seed_tenant(rls_db_session, f"pfa-{uuid4().hex[:8]}")
        beta = _seed_tenant(rls_db_session, f"pfb-{uuid4().hex[:8]}")
        rls_db_session.commit()
    finally:
        connection.execute(text(f"SET ROLE {_RLS_TEST_ROLE}"))
    return alpha, beta


class TestUnderRls:
    def test_settings_are_per_org(self, rls_client, rls_db_session, rls_tenants):
        from tests.conftest import AuthenticatedClient, _RLS_TEST_ROLE

        alpha, beta = rls_tenants
        as_alpha = AuthenticatedClient(rls_client, alpha.token)
        as_beta = AuthenticatedClient(rls_client, beta.token)

        r = as_alpha.put(_url(alpha.org_id), json={"public_fields": ["brief_description"]})
        assert r.status_code == 200, r.text[:300]
        assert set(r.get_json()["public_fields"]) == {"brief_description", "object_number", "title"}
        assert set(as_alpha.get(_url(alpha.org_id)).get_json()["public_fields"]) == {
            "brief_description", "object_number", "title"}

        # Beta still has the defaults and cannot write alpha's setting.
        assert as_beta.get(_url(beta.org_id)).get_json()["is_default"] is True
        assert as_beta.put(_url(alpha.org_id), json={"public_fields": ["title"]}).status_code in (403, 404)

        # At the SQL level, beta's org context cannot see alpha's row.
        rls_db_session.execute(text(f"SET ROLE {_RLS_TEST_ROLE}"))
        rls_db_session.execute(text("SELECT set_config('app.current_org_id', :o, true)"), {"o": str(beta.org_id)})
        assert rls_db_session.execute(text(
            "SELECT count(*) FROM collections.discover_configs WHERE organization_id = :o"
        ), {"o": str(alpha.org_id)}).scalar() == 0
